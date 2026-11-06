-- Migration 142 (06-Nov-2026, branch next-tally-link-any-bridge; written, NOT run: the owner reads it and runs it).
-- The owner's decision (staging only): a client <-> Tally company link belongs to the COMPANY, not to one Windows login's
-- bridge. Whichever FinCom Bridge of the firm has that company open in its own Tally now reads it and posts to it, so
-- nobody re-links when the company is opened in another Windows login on the shared server.
-- Found on staging: a posting for a company linked while it was open in one login's Tally waited for that login's bridge
-- while the company was open in another login's bridge on the same server.
-- Reading already follows the company in the cloud (tally-ingest takes a linked company's data from any of the firm's
-- bridges; tally_link_place_check refuses only data from another real data FOLDER, kept as it is). This file is postings:
--   1. tally_bridge_serves(device, bridge, company, guid): the bridge was heard from within 3 minutes and its own beat
--      (info.bridges[bridge].open) has the company open by name; when the link's GUID is known and the computer key's beat
--      lists that name under ANOTHER GUID, it is another company of the same name: no.
--   2. tally_post_serving_bridge(firm, company, guid, preferred key): of the firm's bridges ("go-" ids bound to their key,
--      that may post: not Changes only, the main one of its Windows user) the one serving the company and reading the
--      link's data location (tally_link_loc = tally_links.data_loc, when the link has one), the preferred key first (the
--      link record's), else the newest heard. {device, bridge} or null.
--   3. tally_post_pickable_ok(job, device, bridge): a WAITING posting may be taken by a bridge other than the one it was
--      queued for only when it was NEVER taken (taken_by and taken_at empty, attempts 0, no re-send list, not checking, no
--      check asked), names a bridge (an older posting naming none is left to its key's main bridge, as before), that bridge
--      does not have the company open now (1.), this bridge does (1.) and may post through its own key, and this bridge
--      reads the link's data location (tally_link_loc = tally_links.data_loc, when the link has one; a bridge whose place is
--      not known then does not take it): never into a copy of the company in another data folder.
--   4. tally_post_take_for (54's text, its own postings first; review 2: a "go-" bridge only for a company its own beat
--      has open, tally_post_mine_ok, else the posting waits in the cloud): when it has none, the oldest posting of its firm
--      pickable by it (3.), locked (for update skip locked) and taken in the same statement only while still waiting and
--      never taken; the posting then belongs to this bridge and its key (device_id, target_bridge, taken_by), so its
--      updates, checks and re-sends go to it alone (posts_update is keyed by the key; tally_post_check_bridge_ok by
--      taken_by). A posting taken by a bridge is never handed to another: no double posting.
--   5. tally_post_pickable(device, bridge): how many (3.) wait for this bridge; tally_post_count_for(device, bridge, main):
--      the beat's posts count (its own takeable now, 4., plus 3.), which tally-ingest's postsFor asks, so a bridge whose
--      Tally lacks the company is not told of its posting and one that has it open asks posts_take (bridge-go asks only when
--      posts > 0). Service role only.
--   6. tally_post_enqueue_to (116's text; one branch changed): no target named and no own bridge of the poster has the
--      company open: any bridge serving it now (2., the link record's key first) instead of refusing; none: the poster's own
--      linked bridge as before (it waits; 4. hands it to a bridge that opens the company), else refused in plain words
--      ("Open <company> in Tally ..., then post again. Nothing was queued."). An explicit target: unchanged (owners only
--      for another member's bridge).
-- ADD-ONLY: create or replace only (seven new functions, two replaced with the same signatures); no table, column or row
-- added or removed; grants explicit (service_role for the internal ones; enqueue_to's grants restated). One transaction,
-- lock_timeout 10 s, safe twice. Runs after 54, 55, 110, 116, 127.
--   7. The note of a posting queued for a bridge not heard from for 3 minutes (116: "Queued: waits for your FinCom Bridge on
--      <computer · Windows user> ...", untrue after 142: whichever bridge has the company open takes it): "Queued: waits
--      for the Tally that has <company> open. It is posted as soon as a FinCom Bridge of the firm is heard with <company>
--      open in its Tally (none is now; the one chosen was last heard <time> IST)." (the owner's decision, 06-Nov-2026:
--      postings go to whichever login has the company open). Its time is read only from a well-formed time (case).
--   8. tally_post_any_bridge(): true. The page's one-time check that 142 is here (authenticated may execute it; it reads
--      nothing): only then does the Post confirm name another login's bridge and Post follow the reading sign; a cloud
--      without 142 answers "no such function" and the page keeps the poster's own bridge's rule.
-- Deploy order: 142, then the tally-ingest of this branch (postsFor asks tally_post_count_for; with the older tally-ingest
-- a bridge whose Tally lacks the company is still told of its posting, asks, and is handed none; a bridge with only a
-- pickable posting is not told to ask, and the posting waits as before), then the app build (it asks tally_post_any_bridge
-- once: without 142 the page keeps the poster's own bridge's rule).
-- Tested on pg_stand: tests/run_migration142.py (RED_WITHOUT_142=1 fails).

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. a bridge serves a company now
create or replace function public.tally_bridge_serves(p_device uuid, p_bridge text, p_company text, p_guid text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((
    select coalesce(case when coalesce(d.info -> 'bridges' -> p_bridge ->> 'at', '') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d'
                         then (d.info -> 'bridges' -> p_bridge ->> 'at')::timestamptz > now() - interval '3 minutes' end, false)
       and not coalesce(d.revoked, false)
       and tally_bridge_has_open(d.id, p_bridge, p_company)
       and not (nullif(btrim(coalesce(p_guid, '')), '') is not null and jsonb_typeof(d.info -> 'beat' -> 'companies') = 'array'
                and exists (select 1 from jsonb_array_elements(d.info -> 'beat' -> 'companies') c
                             where jsonb_typeof(c) = 'object' and lower(tally_nm(c ->> 'name')) = lower(tally_nm(p_company))
                               and nullif(btrim(coalesce(c ->> 'guid', '')), '') is not null and lower(btrim(c ->> 'guid')) <> lower(btrim(p_guid))))
      from tally_devices d where d.id = p_device and coalesce(p_bridge, '') <> '' and jsonb_typeof(d.info -> 'bridges' -> p_bridge) = 'object'), false)
$function$;
revoke all on function public.tally_bridge_serves(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.tally_bridge_serves(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------- 2. the bridge serving a company now
create or replace function public.tally_post_serving_bridge(p_firm uuid, p_company text, p_guid text, p_pref uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select jsonb_build_object('device', d.id, 'bridge', k.key)
    from tally_devices d, jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
   where d.firm_id = p_firm and not coalesce(d.revoked, false) and k.key ~ '^go-[0-9a-f]{6,32}$'
     and tally_bridge_device(p_firm, k.key) = d.id and tally_bridge_may_post(d.id, k.key)
     and tally_bridge_serves(d.id, k.key, p_company, p_guid)
     -- review 1: the link's data location (tally_links.data_loc, when it has one): never a copy of the company elsewhere
     and coalesce((select l.data_loc is null or (tally_link_loc(d.id, k.key, p_company) ->> 'loc') is not distinct from l.data_loc
                     from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
                    where l.firm_id = p_firm and tc.company = p_company and l.state = 'linked' limit 1), true)
   order by (d.id = p_pref) desc nulls last, k.value ->> 'at' desc nulls last, k.key limit 1
$function$;
revoke all on function public.tally_post_serving_bridge(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.tally_post_serving_bridge(uuid, text, text, uuid) to service_role;

-- ---------------------------------------------------------------- 3. a waiting posting another bridge may take
create or replace function public.tally_post_pickable_ok(p_job uuid, p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((
    select j.status = 'waiting' and j.taken_by is null and j.taken_at is null and coalesce(j.attempts, 0) = 0 and j.resend_only is null
       and not coalesce(j.checking, false) and j.target_bridge is not null and j.target_bridge <> p_bridge
       and coalesce(p_bridge, '') ~ '^go-[0-9a-f]{6,32}$' and me.firm_id = j.firm_id
       and not exists (select 1 from tally_post_checks c where c.job_id = j.id)
       and tally_bridge_device(j.firm_id, p_bridge) = p_device and tally_bridge_may_post(p_device, p_bridge)
       and not tally_bridge_serves(j.device_id, j.target_bridge, j.company, l.company_guid)
       and tally_bridge_serves(p_device, p_bridge, j.company, l.company_guid)
       and (l.data_loc is null or (tally_link_loc(p_device, p_bridge, j.company) ->> 'loc') is not distinct from l.data_loc)
      from tally_post_jobs j
      join tally_devices me on me.id = p_device and not coalesce(me.revoked, false)
      left join tally_companies tc on tc.firm_id = j.firm_id and tc.company = j.company
      left join tally_links l on l.firm_id = j.firm_id and l.book_id = tc.book_id and l.state = 'linked'
     where j.id = p_job), false)
$function$;
revoke all on function public.tally_post_pickable_ok(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_pickable_ok(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- 4a. a posting for this bridge it may take now
-- 54's hand-out rule (the posting names this bridge, or none and it is the key's main bridge; not changes only; heard from
-- on its key), and review 2: a FinCom Bridge 2.x ("go-" id) is handed a posting only while its own beat has the company
-- open (info.bridges[id].open). Not open: it waits in the cloud (the bridge is not told of it, and does not take it), so
-- the bridge that has the company open can pick it up (3.) once it was never taken
create or replace function public.tally_post_mine_ok(p_job uuid, p_device uuid, p_bridge text, p_main boolean)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((
    select j.device_id = p_device and j.status = 'waiting'
       and (j.target_bridge = p_bridge or (j.target_bridge is null and coalesce(p_main, false)))
       and not tally_bridge_changes_only_on(p_device, p_bridge)
       and exists (select 1 from tally_devices d where d.id = p_device and d.info -> 'bridges' ? p_bridge)
       and (coalesce(p_bridge, '') !~ '^go-[0-9a-f]{6,32}$' or tally_bridge_has_open(p_device, p_bridge, j.company))
      from tally_post_jobs j where j.id = p_job), false)
$function$;
revoke all on function public.tally_post_mine_ok(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_mine_ok(uuid, uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------- 5. how many wait for this bridge (tally-ingest's beat)
create or replace function public.tally_post_pickable(p_device uuid, p_bridge text)
returns integer language sql stable security definer set search_path = public, pg_temp as $function$
  select count(*)::int from tally_post_jobs j join tally_devices me on me.id = p_device
   where j.firm_id = me.firm_id and j.status = 'waiting' and j.taken_by is null and tally_post_pickable_ok(j.id, p_device, p_bridge)
$function$;
revoke all on function public.tally_post_pickable(uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_pickable(uuid, text) to service_role;
-- the beat's posts count: the postings this bridge may take now (4a.) and those it may pick up (3.); tally-ingest's postsFor
-- (a cloud without 142: its own count, as before)
create or replace function public.tally_post_count_for(p_device uuid, p_bridge text, p_main boolean)
returns integer language sql stable security definer set search_path = public, pg_temp as $function$
  select (select count(*)::int from tally_post_jobs j where j.device_id = p_device and j.status = 'waiting' and tally_post_mine_ok(j.id, p_device, p_bridge, p_main))
       + case when coalesce(p_bridge, '') ~ '^go-[0-9a-f]{6,32}$' then tally_post_pickable(p_device, p_bridge) else 0 end
$function$;
revoke all on function public.tally_post_count_for(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_count_for(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------- 4. the hand-out, per bridge (54's, then a pick-up)
create or replace function public.tally_post_take_for(p_device uuid, p_bridge text, p_main boolean)
returns setof public.tally_post_jobs language plpgsql security definer set search_path = public, pg_temp as $function$
declare jid uuid;
begin
  -- 54's text: the bridge's own postings first (4a.: a go- bridge only for a company its own beat has open)
  return query
  update tally_post_jobs set status = 'taken', taken_at = now(), updated_at = now(), seq = null, message = 'Taken by the Tally computer',
         taken_by = case when p_bridge ~ '^go-[0-9a-f]{6,32}$' then p_bridge else taken_by end   -- final review M1: the bridge that took it
   where id = (select j.id from tally_post_jobs j
                where j.device_id = p_device and j.status = 'waiting' and tally_post_mine_ok(j.id, p_device, p_bridge, p_main)
                order by j.created_at limit 1 for update skip locked)
  returning *;
  if found then return; end if;
  -- 142: a posting of the firm never taken, whose bridge does not have the company open now while this one does
  select j.id into jid from tally_post_jobs j join tally_devices me on me.id = p_device
   where j.firm_id = me.firm_id and j.status = 'waiting' and j.taken_by is null and tally_post_pickable_ok(j.id, p_device, p_bridge)
   order by j.created_at limit 1 for update of j skip locked;
  if jid is null then return; end if;
  return query
  update tally_post_jobs set status = 'taken', taken_at = now(), updated_at = now(), seq = null, device_id = p_device, target_bridge = p_bridge, taken_by = p_bridge,
         message = left('Taken by the FinCom Bridge that has ' || company || ' open now (the one it was queued for did not have it open)', 300)
   where id = jid and status = 'waiting' and taken_by is null and taken_at is null
  returning *;
end $function$;
revoke all on function public.tally_post_take_for(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_take_for(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------- 8. the page's check that 142 is here
create or replace function public.tally_post_any_bridge()
returns boolean language sql stable security invoker set search_path = public, pg_temp as $function$
  select true
$function$;
revoke all on function public.tally_post_any_bridge() from public, anon;
grant execute on function public.tally_post_any_bridge() to authenticated, service_role;

-- ---------------------------------------------------------------- 6. a new posting: any bridge with the company open
create or replace function public.tally_post_enqueue_to(p_id uuid, p_client text, p_payload jsonb, p_target text default null, p_device uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); t text := nullif(left(btrim(coalesce(p_target, '')), 40), ''); own record; tdev uuid; is_owner boolean; r jsonb; seen record; co text;
        allowed text; pick jsonb; lk boolean; mine boolean := true; note text; srv jsonb; lnk record;
begin
  if f is null then raise exception 'not allowed'; end if;
  if not can_write() then raise exception 'Only the firm''s owner or staff can post to Tally.' using errcode = '42501'; end if;
  -- the same posting again: the core decides, by 36b's rules, and never moves it to another computer key
  if exists (select 1 from tally_post_jobs j where j.id = p_id) then
    r := tally_post_enqueue_core(p_id, p_client, p_payload, null, null);
    return r || jsonb_build_object('target', (select j.target_bridge from tally_post_jobs j where j.id = p_id and j.firm_id = f));
  end if;
  -- no Tally company for the client, or not the one it may post to: the core's own words (nothing queued)
  select t2.company into co from tally_companies t2 where t2.firm_id = f and t2.client_id = p_client and t2.device_id is not null order by t2.last_seen desc nulls last limit 1;
  allowed := tally_link_post_to(f, p_client, co);
  if co is null or allowed is null or lower(tally_nm(allowed)) <> lower(tally_nm(co)) then
    return tally_post_enqueue_core(p_id, p_client, p_payload, null, null) || jsonb_build_object('target', null); end if;
  is_owner := exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true));
  select mb.device_id, mb.bridge_id into own from tally_member_bridges mb where mb.firm_id = f and mb.user_id = auth.uid() and mb.bridge_id is not null;
  if t is null then
    -- 9a: the poster's own bridge: the linked one (when it may post, is still bound to the linked computer, and has the
    -- company open or no other own bridge has it), else the newest of their own that may post with the company open
    lk := own.bridge_id is not null and own.device_id is not null and tally_bridge_device(f, own.bridge_id) is not distinct from own.device_id
          and tally_bridge_may_post(own.device_id, own.bridge_id);
    pick := tally_post_own_bridge(f, co, auth.uid());
    if lk and tally_bridge_has_open(own.device_id, own.bridge_id, co) then
      t := own.bridge_id; tdev := own.device_id;
    elsif pick is not null then
      tdev := (pick ->> 'device')::uuid; t := pick ->> 'bridge';
    else
      -- 142 (the owner, 06-Nov-2026: a link belongs to the COMPANY): no own bridge has it open: any bridge of the firm that
      -- has it open now (heard within 3 minutes, may post), the link record's computer key first, else the newest heard
      select l.device_id, l.company_guid into lnk from tally_links l join tally_companies tc on tc.book_id = l.book_id and tc.firm_id = l.firm_id
       where l.firm_id = f and tc.company = co and l.state = 'linked' limit 1;
      srv := tally_post_serving_bridge(f, co, lnk.company_guid, lnk.device_id);
      if srv is not null then
        tdev := (srv ->> 'device')::uuid; t := srv ->> 'bridge'; mine := false;
      elsif lk then
        -- (as before: the poster's own linked bridge; the posting waits, and a bridge that opens the company takes it, 142)
        t := own.bridge_id; tdev := own.device_id;
      else
        return jsonb_build_object('ok', false, 'company', co, 'error', 'Open ' || co || ' in Tally (in any Windows login with FinCom Bridge), then post again. Nothing was queued.');
      end if;
    end if;
  else
    tdev := tally_bridge_device(f, t);
    mine := tally_bridge_is_own(f, auth.uid(), tdev, t);
    if not mine and not is_owner then
      return jsonb_build_object('ok', false, 'error', 'Only an owner of the firm can post through another bridge than your own.'); end if;
    if tdev is null then
      return jsonb_build_object('ok', false, 'error', 'FinCom has not heard from that bridge on any of the firm''s computers; nothing was queued.'); end if;
    -- review M3: named with its computer, the one the bridge id is bound to
    if p_device is null or p_device <> tdev then
      return jsonb_build_object('ok', false, 'error', 'That bridge is not on the computer named; nothing was queued. Refresh the Tally page and choose it again.'); end if;
    if tally_bridge_changes_only_on(tdev, t) then
      return jsonb_build_object('ok', false, 'error', 'That bridge is set to changes only: it reads Tally''s changes and never posts. Nothing was queued.'); end if;
    if not tally_bridge_may_post(tdev, t) then
      return jsonb_build_object('ok', false, 'error', 'That bridge only reads Tally: another bridge of the same Windows user is the main one on its computer. Nothing was queued.'); end if;
  end if;
  -- 9b: not heard from for more than 3 minutes: queued all the same; the bridge takes it when it is back
  if t is not null then
    select d.info -> 'bridges' -> t ->> 'at' as at, d.info -> 'bridges' -> t ->> 'user' as u into seen from tally_devices d where d.id = tdev;
    if coalesce(case when coalesce(seen.at, '') ~ '^\d{4}-\d\d-\d\dT' then seen.at::timestamptz >= now() - interval '3 minutes' end, false) is not true then
      -- 142 (7.): whichever bridge has the company open takes it, so the note names the company's Tally, not one login's
      note := 'Queued: waits for the Tally that has ' || co || ' open. It is posted as soon as a FinCom Bridge of the firm is heard with ' || co || ' open in its Tally (none is now'
        || coalesce('; the one chosen was last heard ' || to_char(case when coalesce(seen.at, '') ~ '^\d{4}-\d\d-\d\dT' then seen.at::timestamptz end at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST', '') || ').';
    end if;
  end if;
  r := tally_post_enqueue_core(p_id, p_client, p_payload, tdev, t);
  if note is not null and coalesce((r ->> 'ok')::boolean, false) then
    update tally_post_jobs set message = left(note, 300) where id = p_id and firm_id = f and status = 'waiting';
    r := r || jsonb_build_object('note', note);
  end if;
  return r || jsonb_build_object('target', (select j.target_bridge from tally_post_jobs j where j.id = p_id and j.firm_id = f));
end $function$;
revoke all on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) to authenticated, service_role;

commit;
