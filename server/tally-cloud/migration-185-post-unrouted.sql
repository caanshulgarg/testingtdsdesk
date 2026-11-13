-- Migration 185 (13-Nov-2026, branch next-post-queue-anyway; written, NOT run: the owner reads it and runs it). Item D of
-- the posting reliability plan, approved by the owner: a posting is queued even when no computer has the company open in
-- Tally. Cloud side only: no bridge change, no new request to Tally; the bridge's rules (a request at most 2 s, one in
-- flight, postings first, the typing gate) untouched. Builds on 174 (live on staging) and 184 (item C; run 184 first).
--
-- Before: with no FinCom Bridge having the company open (and no bridge of the poster's own to wait on), with a bridge
-- named that could not post (not heard from, another computer, Changes only, not the main bridge, another member's), or
-- with the company's computer key removed, a posting was refused ("Open <company> in Tally ..., then post again. Nothing
-- was queued."), and a waiting posting never taken whose bridge could no longer post was failed.
--
--   1. A posting queued for NO computer ("unrouted"): tally_post_jobs.device_id null, target_bridge null, waiting, its
--      message "Queued: posts by itself when <company> is opened in Tally on <computer> (<data folder>) with FinCom Bridge"
--      (the link record's computer and data folder: only a bridge reading that very place can take it). Only when
--      the client's link record can prove the company to a bridge: linked to that client, posting allowed, its Tally GUID
--      and its data location known, and a FinCom Bridge 2.x has been seen reading that data location (tally_link_places)
--      or reports it now (tally_post_unrouted_can); else: refused in the words as before (a posting no bridge could ever
--      prove itself for is never left waiting).
--   2. tally_post_unrouted_ok(job, device, bridge): may this bridge take it now? The posting waits, for no computer, never
--      taken (taken_by, taken_at, first_taken_at empty), no re-send list, not checking, no check asked, not stopped, not a
--      posting only recorded (132); the bridge a FinCom Bridge 2.x ("go-" id) bound to its key, of the same firm, its key
--      not revoked, one that may post (not Changes only, the main one of its Windows user); and 174's check for another
--      bridge, all of it required: heard within 3 minutes with the company open by name (tally_bridge_serves), the link's
--      GUID named for that company in the bridge's own list (info.bridges[id].cos; its key's beat when it sends none), and
--      its data location the link's (tally_link_loc = data_loc): never
--      a company of the same name, a restored backup, or a copy of the data in another folder or on another computer.
--   3. tally_post_take_for (174's text): after its own postings and 142's pick-up, a third loop for a "go-" bridge: the
--      oldest posting of its firm it may take by 2., its row locked (for update skip locked) and taken in ONE update that
--      holds only while it is still waiting, for no computer and never taken; it then belongs to that bridge and its key
--      (device_id, target_bridge, taken_by), so its updates, checks and re-sends go to it alone and 174's rule holds from
--      there (once taken, never another bridge). Two bridges asking at the same moment: exactly one is handed it. A
--      posting that may no longer be posted (unlinked, posting stopped: tally_post_job_blocked) is held as 174 does.
--   4. tally_post_count_for (142's text): the beat's posts count also counts those (2.), so a bridge that opens the
--      company is told to ask posts_take at its next beat. A bridge with no "go-" id (1.15.0) is never told of one and
--      never handed one (tally_post_take reads its own key's postings only).
--   5. tally_post_reroute (174's text): a waiting posting NEVER taken that no bridge of its computer may post any more
--      (the main bridge switched, Changes only, the rescue) is no longer failed: it is queued for no computer (1.), in one
--      update that holds only while it is still never taken; a Retry of such a failed one likewise. One already queued for
--      no computer is left as it is (state 'unrouted') while the link can still prove the company (else: stranded, in words). A posting once taken: exactly as 174 (never moved, held in words).
--      tally_post_rescue (174's text): its answer counts them (unrouted).
--   6. tally_post_enqueue_core (184's text): no computer keeps the company (its key removed): the link record's company;
--      no computer named and none found (or tally_post_enqueue_to asks for none: p_target '*'): queued for no computer
--      (1.), the answer {ok, id, company, unrouted: true, note: the words}. tally_post_enqueue_to (142's text): no bridge
--      of the poster's own and none of the firm has the company open, or the bridge named cannot post it (the same reasons,
--      in the same order): queued for no computer instead of refused, the answer and the posting saying why that bridge was not
--      used (targetWhy). Everything else (the poster's own bridge first, any
--      bridge serving the company now, a named bridge not heard for 3 minutes: queued for it with a note) as before.
-- No double posting: a posting queued for no computer is in no bridge's hands until the one update of 3.; nothing here
-- sends an entry again. No lost posting: nothing is failed or dropped that was queued before; a posting is refused only
-- where it was refused before.
-- Left as they are: tally_post_requeue (its 6-hour words already say "no FinCom Bridge with <company> open in Tally has
-- taken it"), tally_post_cancel, tally_post_pickable_ok (142's pick-up: a posting naming a bridge), tally_post_hold*.
-- ADD-ONLY: one partial index added (tally_post_jobs_unrouted); create or replace only (three new functions; six replaced
-- with the same signatures, each from its latest text); no table, column, row or policy changed; nothing dropped or deleted. Grants explicit: the new helpers
-- service_role only; the replaced ones as before, and tally_post_reroute / tally_post_rescue now granted to service_role
-- explicitly (tally-ingest calls the rescue). One transaction, lock_timeout 10 s, safe twice.
-- Runs after 54, 110, 127, 142, 161, 174 and 184. Deploy order: 184, 185, then the app build of this branch (it shows the
-- words while such a posting waits; an older page says "Queued for the Tally computer ..."). No tally-ingest change
-- (postsFor asks tally_post_count_for; posts_take asks tally_post_take_for) and no bridge change.
-- Tested on pg_stand: tests/run_migration185.py (RED_WITHOUT_185=1 fails).

begin;
set local lock_timeout = '10s';

-- the postings queued for no computer, read at every beat of a "go-" bridge (tally_post_count_for): few, found by firm
create index if not exists tally_post_jobs_unrouted on public.tally_post_jobs (firm_id) where status = 'waiting' and device_id is null;

-- ---------------------------------------------------------------- 1. the words; can the link prove the company?
-- the words name where it can be posted: the computer and data folder of the client's link record (only a bridge reading
-- that very place can take it: 2.)
create or replace function public.tally_post_unrouted_words(p_firm uuid, p_client text, p_company text)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select left('Queued: posts by itself when ' || coalesce(p_company, 'the company') || ' is opened in Tally on '
      || coalesce((select coalesce(nullif(btrim(l.computer), ''), 'the computer it is linked on') || coalesce(' (' || nullif(btrim(l.data_folder), '') || ')', '')
                     from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
                    where l.firm_id = p_firm and l.client_id = p_client and l.state = 'linked' and lower(tally_nm(tc.company)) = lower(tally_nm(p_company))
                    order by l.posting_allowed desc limit 1), 'the computer it is linked on')
      || ' with FinCom Bridge', 300)
$function$;
revoke all on function public.tally_post_unrouted_words(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tally_post_unrouted_words(uuid, text, text) to service_role;

-- the client's link record of that company (names compared with tally_nm, as enqueue and tally_post_job_blocked do):
-- linked to the client, posting allowed, its Tally GUID and its data location known; and a FinCom Bridge 2.x ("go-" id,
-- still bound to a key of the firm) has been seen reading that very data location (tally_link_places), or reports it
-- now: a place no such bridge ever read from could never be posted to this way. Internal
create or replace function public.tally_post_unrouted_can(p_firm uuid, p_client text, p_company text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select exists (select 1 from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
                  where l.firm_id = p_firm and l.client_id = p_client and l.state = 'linked' and l.posting_allowed
                    and lower(tally_nm(tc.company)) = lower(tally_nm(p_company))
                    and nullif(btrim(coalesce(l.company_guid, '')), '') is not null and l.data_loc is not null
                    and (exists (select 1 from tally_link_places p where p.firm_id = l.firm_id and p.book_id = l.book_id and p.data_loc = l.data_loc
                                    and coalesce(p.bridge_id, '') ~ '^go-[0-9a-f]{6,32}$' and tally_bridge_device(l.firm_id, p.bridge_id) is not null)
                      or exists (select 1 from tally_devices d, jsonb_object_keys(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
                                  where d.firm_id = l.firm_id and not coalesce(d.revoked, false) and k ~ '^go-[0-9a-f]{6,32}$' and tally_bridge_device(l.firm_id, k) = d.id
                                    and (tally_link_loc(d.id, k, tc.company) ->> 'loc') = l.data_loc)))
$function$;
revoke all on function public.tally_post_unrouted_can(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tally_post_unrouted_can(uuid, text, text) to service_role;

-- ---------------------------------------------------------------- 2. may this bridge take a posting queued for no computer?
create or replace function public.tally_post_unrouted_ok(p_job uuid, p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((
    select j.status = 'waiting' and j.device_id is null and j.target_bridge is null
       and j.taken_by is null and j.taken_at is null and j.first_taken_at is null and j.resend_only is null
       and not coalesce(j.checking, false) and j.stop_reason is null and coalesce(j.payload ->> 'recorded', '') <> 'true'
       and coalesce(p_bridge, '') ~ '^go-[0-9a-f]{6,32}$' and me.firm_id = j.firm_id
       and not exists (select 1 from tally_post_checks c where c.job_id = j.id)
       and tally_bridge_device(j.firm_id, p_bridge) = p_device and tally_bridge_may_post(p_device, p_bridge)
       -- 174's check for another bridge (tally_post_check_bridge_ok), all of it required: the very company (the link's
       -- GUID named for it in this key's beat), open in this bridge's Tally now, read from the link's data location
       and exists (select 1 from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
                    -- (posting stopped since it was queued is not judged here: the take holds it with the reason, as 174)
                    where l.firm_id = j.firm_id and l.client_id = j.client_id and l.state = 'linked'
                      and lower(tally_nm(tc.company)) = lower(tally_nm(j.company))
                      and nullif(btrim(coalesce(l.company_guid, '')), '') is not null
                      and tally_bridge_serves(p_device, p_bridge, j.company, l.company_guid)
                      and l.data_loc is not null and (tally_link_loc(p_device, p_bridge, j.company) ->> 'loc') = l.data_loc
                      -- the bridge's own list of open companies with their GUIDs (info.bridges[id].cos, migration 146) when it
                      -- sends one; else its key's beat
                      and case when jsonb_typeof(me.info -> 'bridges' -> p_bridge -> 'cos') = 'array'
                            then exists (select 1 from jsonb_array_elements(me.info -> 'bridges' -> p_bridge -> 'cos') c where jsonb_typeof(c) = 'array'
                                          and lower(tally_nm(c ->> 0)) = lower(tally_nm(j.company)) and lower(btrim(coalesce(c ->> 1, ''))) = lower(btrim(l.company_guid)))
                            else jsonb_typeof(me.info -> 'beat' -> 'companies') = 'array'
                             and exists (select 1 from jsonb_array_elements(me.info -> 'beat' -> 'companies') c where jsonb_typeof(c) = 'object'
                                          and lower(tally_nm(c ->> 'name')) = lower(tally_nm(j.company)) and lower(btrim(coalesce(c ->> 'guid', ''))) = lower(btrim(l.company_guid))) end)
      from tally_post_jobs j
      join tally_devices me on me.id = p_device and not coalesce(me.revoked, false)
     where j.id = p_job), false)
$function$;
revoke all on function public.tally_post_unrouted_ok(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_unrouted_ok(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- 3. the hand-out (174's text)
-- 174's tally_post_take_for; changed: the pick-up loop ends without leaving (one line), and the third loop
create or replace function public.tally_post_take_for(p_device uuid, p_bridge text, p_main boolean)
returns setof public.tally_post_jobs language plpgsql security definer set search_path = public, pg_temp as $function$
declare jid uuid; fm uuid; i integer;
begin
  -- 174: the posting about to be handed out is checked (tally_post_job_blocked); one that may no longer be posted is held
  -- (tally_post_hold_job: failed when never taken, else the stop flag) and the next is looked at; a stop-flagged one never
  select d.firm_id into fm from tally_devices d where d.id = p_device;
  -- 54's text: the bridge's own postings first (4a.: a go- bridge only for a company its own beat has open)
  for i in 1..20 loop
    select j.id into jid from tally_post_jobs j
     where j.device_id = p_device and j.status = 'waiting' and tally_post_mine_ok(j.id, p_device, p_bridge, p_main)
       and j.firm_id = fm and j.stop_reason is null
       and (j.taken_by = p_bridge or (j.taken_by is null and ((j.taken_at is null and j.first_taken_at is null) or p_bridge !~ '^go-[0-9a-f]{6,32}$')))   -- once taken: only by the bridge that took it (H2a; a v1 take, by its history too: a v1 bridge, LOW 6 / fourth review LOW 1)
     order by j.created_at limit 1 for update skip locked;
    exit when jid is null;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, message = 'Taken by the Tally computer',
             taken_by = case when p_bridge ~ '^go-[0-9a-f]{6,32}$' then p_bridge else taken_by end   -- final review M1: the bridge that took it
       where id = jid
      returning *;
      return;
    end if;
    perform tally_post_hold_job(jid);
  end loop;
  -- 142: a posting of the firm never taken, whose bridge does not have the company open now while this one does
  for i in 1..20 loop
    select j.id into jid from tally_post_jobs j join tally_devices me on me.id = p_device
     where j.firm_id = me.firm_id and j.status = 'waiting' and j.taken_by is null and tally_post_pickable_ok(j.id, p_device, p_bridge)
       and j.stop_reason is null
     order by j.created_at limit 1 for update of j skip locked;
    exit when jid is null;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, device_id = p_device, target_bridge = p_bridge, taken_by = p_bridge,
             message = left('Taken by the FinCom Bridge that has ' || company || ' open now (the one it was queued for did not have it open)', 300)
       where id = jid and status = 'waiting' and taken_by is null and taken_at is null
      returning *;
      return;
    end if;
    perform tally_post_hold_job(jid);
  end loop;
  -- 185: a posting queued for no computer (device_id null), never taken: the first FinCom Bridge 2.x that has that very
  -- company open (tally_post_unrouted_ok: the link's GUID in its beat and the link's data location) takes it. The row is
  -- locked (skip locked: a second bridge asking at the same moment is handed nothing) and taken in ONE update that holds
  -- only while it is still waiting, for no computer and never taken: it then belongs to this bridge and its key
  -- (device_id, target_bridge, taken_by), as a posting picked up (142) does. An older bridge (no "go-" id) never comes here
  if coalesce(p_bridge, '') !~ '^go-[0-9a-f]{6,32}$' then return; end if;
  for i in 1..20 loop
    select j.id into jid from tally_post_jobs j
     where j.firm_id = fm and j.status = 'waiting' and j.device_id is null and j.stop_reason is null and tally_post_unrouted_ok(j.id, p_device, p_bridge)
     order by j.created_at limit 1 for update of j skip locked;
    if jid is null then return; end if;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, device_id = p_device, target_bridge = p_bridge, taken_by = p_bridge,
             message = left('Taken by the FinCom Bridge that has ' || company || ' open now (it was queued for whichever computer opens it)', 300)
       where id = jid and status = 'waiting' and device_id is null and taken_by is null and taken_at is null and first_taken_at is null
      returning *;
      return;
    end if;
    perform tally_post_hold_job(jid);
  end loop;
end $function$;
revoke all on function public.tally_post_take_for(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_take_for(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------- 4. the beat's count (142's text)
-- 142's tally_post_count_for; added: the postings queued for no computer this bridge may take now
create or replace function public.tally_post_count_for(p_device uuid, p_bridge text, p_main boolean)
returns integer language sql stable security definer set search_path = public, pg_temp as $function$
  select (select count(*)::int from tally_post_jobs j where j.device_id = p_device and j.status = 'waiting' and tally_post_mine_ok(j.id, p_device, p_bridge, p_main))
       + case when coalesce(p_bridge, '') ~ '^go-[0-9a-f]{6,32}$' then tally_post_pickable(p_device, p_bridge) else 0 end
       -- 185: and the postings queued for no computer that this bridge may take now (a "go-" bridge only)
       + case when coalesce(p_bridge, '') ~ '^go-[0-9a-f]{6,32}$' then (select count(*)::int from tally_post_jobs j join tally_devices me on me.id = p_device
                    where j.firm_id = me.firm_id and j.status = 'waiting' and j.device_id is null and tally_post_unrouted_ok(j.id, p_device, p_bridge)) else 0 end
$function$;
revoke all on function public.tally_post_count_for(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_count_for(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------- 5. a posting whose bridge can no longer post (174's text)
-- 174's tally_post_reroute; changed: a posting never taken that no bridge of its computer may post is queued for no
-- computer instead of failed; one already so queued is left as it is. A posting once taken: as 174 (never moved)
create or replace function public.tally_post_reroute(p_id uuid, p_fail boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare j record; nb text; w text;
begin
  select x.id, x.device_id, x.target_bridge, x.company, x.taken_by, x.taken_at, x.attempts, x.first_taken_at, x.status, x.firm_id, x.client_id, coalesce(x.payload ->> 'recorded', '') = 'true' as recorded into j from tally_post_jobs x where x.id = p_id;
  if not found then return jsonb_build_object('state', 'none'); end if;
  -- 185: queued for no computer and never taken (by the take's history; a Retry's attempts do not count: no bridge ever
  -- had it): it waits for the first bridge that opens its company; nothing to move. (A posting only recorded, 132, has no
  -- computer either: it was "taken" when made and is judged below, as before)
  if j.device_id is null and j.taken_by is null and j.taken_at is null and j.first_taken_at is null and not j.recorded then
    if tally_post_unrouted_can(j.firm_id, j.client_id, j.company) then return jsonb_build_object('state', 'unrouted'); end if;
    -- the link can no longer prove the company to a bridge (its GUID or data location gone, posting stopped, unlinked):
    -- no bridge could take it: not left waiting (a Retry is refused in these words; one still waiting is failed with them)
    w := 'the link of this client no longer says where ' || j.company || ' is kept in Tally (its Tally identity and data folder, read by a FinCom Bridge 2.x), or posting into it is not allowed. '
      || 'Open ' || j.company || ' in Tally on a computer with FinCom Bridge and check the client''s link on the Tally page, then Retry.';
    if coalesce(p_fail, false) then
      update tally_post_jobs set status = 'failed', updated_at = now(), message = left('Not posted into ' || j.company || ': ' || w, 500)
       where id = p_id and status = 'waiting' and device_id is null and taken_by is null and taken_at is null and first_taken_at is null;
    end if;
    return jsonb_build_object('state', 'stranded', 'words', w);
  end if;
  -- (third review MED 3, LOW 6) once taken (taken_by or taken_at set, or attempts > 0: a v1 bridge sets no taken_by and a
  -- Retry clears taken_at): ok only when the bridge that took it may still post; else held in words, never moved
  -- (fourth review LOW 1) once taken by the take's history (first_taken_at), not by attempts alone: a posting never taken,
  -- failed and Retried, is moved as before
  if j.taken_by is not null or j.taken_at is not null or j.first_taken_at is not null or coalesce(j.attempts, 0) > 0 then   -- (fifth review M1: attempts too)
    if (j.taken_by is not null and tally_bridge_may_post(j.device_id, j.taken_by))
       or (j.taken_by is null and ((j.target_bridge is not null and tally_bridge_may_post(j.device_id, j.target_bridge))
                                   or (j.target_bridge is null and tally_device_may_post(j.device_id)))) then return jsonb_build_object('state', 'ok'); end if;
    -- (third review MED 4) the real ways forward
    w := 'Started on ' || coalesce(nullif(tally_bridge_words(j.device_id, coalesce(j.taken_by, j.target_bridge)), ''), 'the computer that took it')
      || ', and that FinCom Bridge can no longer post; it is never moved to another bridge (part of it may be in Tally). Make that bridge able to post again (the main bridge again, or Changes only off), or check in Tally by hand: Mark posted what is there, '
      -- (fourth review LOW 4) a failed or cancelled posting (a Retry refused) cannot be cancelled: not said
      || case when j.status in ('failed', 'cancelled') then 'then post the rest again.' else 'Cancel this posting, then post the rest again.' end;
    if coalesce(p_fail, false) then
      update tally_post_jobs set message = left(w, 500) where id = p_id and status = 'waiting' and message is distinct from left(w, 500);
    end if;
    return jsonb_build_object('state', 'stranded', 'held', true, 'words', w);
  end if;
  if (j.target_bridge is not null and tally_bridge_may_post(j.device_id, j.target_bridge))
     or (j.target_bridge is null and tally_device_may_post(j.device_id)) then return jsonb_build_object('state', 'ok'); end if;
  nb := case when j.target_bridge is not null then tally_bridge_poster(j.device_id, tally_bridge_user(j.device_id, j.target_bridge)) end;
  if nb is not null then
    -- a bridge 1.15.0 ("v1") has no id of its own: the posting then names none (the computer's main bridge)
    update tally_post_jobs set target_bridge = case when nb ~ '^go-[0-9a-f]{6,32}$' then nb end, updated_at = now(),
           message = left('Moved to ' || coalesce(nullif(tally_bridge_words(j.device_id, nb), ''), nb) || ' (the same Windows user, the same computer): the bridge it was for can no longer post', 300)
     where id = p_id;
    return jsonb_build_object('state', 'moved', 'bridge', nb);
  end if;
  -- 185: never taken, and no bridge of its computer may post it: no longer failed (or a Retry refused): queued for no
  -- computer, when the link can prove the company to a bridge (its GUID and data location); in one update that holds only
  -- while it is still never taken. Else as before
  if tally_post_unrouted_can(j.firm_id, j.client_id, j.company) then
    update tally_post_jobs set device_id = null, target_bridge = null, updated_at = now(), message = tally_post_unrouted_words(j.firm_id, j.client_id, j.company)
     where id = p_id and status in ('waiting', 'failed', 'cancelled') and taken_by is null and taken_at is null and first_taken_at is null;
    if found then return jsonb_build_object('state', 'unrouted', 'words', tally_post_unrouted_words(j.firm_id, j.client_id, j.company)); end if;
  end if;
  w := tally_post_stranded_words(j.device_id, j.target_bridge);
  if coalesce(p_fail, false) then
    update tally_post_jobs set status = 'failed', taken_at = null, updated_at = now(), message = 'Not posted into ' || j.company || ': ' || w
     where id = p_id and status = 'waiting';
  end if;
  return jsonb_build_object('state', 'stranded', 'words', w);
end $function$;
revoke all on function public.tally_post_reroute(uuid, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_reroute(uuid, boolean) to service_role;

-- 174's tally_post_rescue; added: its count of the postings queued for no computer
create or replace function public.tally_post_rescue(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r record; x jsonb; moved int := 0; failed int := 0; held int := 0; unrouted int := 0;
begin
  for r in select j.id from tally_post_jobs j where j.device_id = p_device and j.status = 'waiting' order by j.created_at for update skip locked loop
    x := tally_post_reroute(r.id, true);
    if x ->> 'state' = 'moved' then moved := moved + 1; elsif x ->> 'state' = 'unrouted' then unrouted := unrouted + 1; elsif x ->> 'state' = 'stranded' and coalesce((x ->> 'held')::boolean, false) then held := held + 1; elsif x ->> 'state' = 'stranded' then failed := failed + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'moved', moved, 'failed', failed, 'held', held, 'unrouted', unrouted);
end $function$;
revoke all on function public.tally_post_rescue(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_rescue(uuid) to service_role;   -- tally-ingest (the service role) calls it

-- ---------------------------------------------------------------- 6. a new posting (184's core, 142's tally_post_enqueue_to)
-- 184's tally_post_enqueue_core; changed: the company from the link record when no computer keeps it; no computer: queued
-- for none (when the link can prove the company) instead of refused; a Retry of one so queued says so
create or replace function public.tally_post_enqueue_core(p_id uuid, p_client text, p_payload jsonb, p_device uuid, p_target text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); c record; n int; dup text; allowed text; cname text; j record; dev uuid; rr jsonb;
        vs jsonb; dupes jsonb;   -- 184: the entries queued now, and those an earlier posting holds
        unr boolean := false;    -- 185: queued for no computer
begin
  if f is null then raise exception 'not allowed'; end if;
  if not can_write() then raise exception 'Only the firm''s owner or staff can post to Tally.' using errcode = '42501'; end if;
  -- 184: one posting of a client is queued at a time (two pages posting overlapping entries at the same moment: the second
  -- waits here, then sees the first one's posting); held to the end of the transaction
  perform pg_advisory_xact_lock(hashtext('tally_post_enqueue'), hashtext(f::text || ':' || coalesce(p_client, '')));
  select t.company, t.device_id into c from tally_companies t
   where t.firm_id = f and t.client_id = p_client and t.device_id is not null
     and not exists (select 1 from tally_split_links x where x.firm_id = f and x.book_id = t.book_id and x.client_id = p_client and x.state = 'linked')
   order by t.last_seen desc nulls last limit 1;
  -- 185: no computer keeps the company now (its key removed): the company of the client's link record
  if c.company is null then c.company := tally_link_post_to(f, p_client, null); end if;
  if c.company is null then return jsonb_build_object('ok', false, 'error', 'No Tally computer keeps this client''s company yet.'); end if;
  -- the one Tally company this client may post to: its link record's (migration 110), never clients.data postTo
  select tally_link_post_to(f, p_client, c.company), cl.name into allowed, cname from clients cl where cl.firm_id = f and cl.id = p_client;
  if allowed is null then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', case when exists (select 1 from tally_links l where l.firm_id = f and l.client_id = p_client and l.state = 'linked')
        then 'Posting into Tally is stopped for ' || coalesce(cname, 'this client') || ': allow it on the Tally page (the company''s ⋯ Post entries here). Nothing was posted.'
        else 'Link ' || coalesce(cname, 'this client') || ' to its company in Tally first (the Tally page). Its books in FinCom''s cloud come from ' || c.company || '.' end); end if;
  if lower(tally_nm(allowed)) <> lower(tally_nm(c.company)) then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', coalesce(cname, 'This client') || ' may post only to ' || allowed || ', but its books in FinCom''s cloud come from ' || c.company || '. Nothing was posted.'); end if;
  -- the same posting again (Retry, by its id alone): a failed or cancelled one waits again, under the same id (and on the
  -- same computer as before: never moved to another computer key, review M2; its bridge no longer able to post: that
  -- computer's bridge that may post, else refused in plain words, review M-B)
  select * into j from tally_post_jobs where id = p_id;
  if found then
    if j.firm_id <> f or j.client_id <> p_client then raise exception 'not allowed'; end if;
    if j.status in ('failed', 'cancelled') then
      select coalesce(i.entry_id, i.fincom_id) into dup from tally_post_ids i
       where i.job_id = p_id and exists (select 1 from tally_post_ids o where o.firm_id = i.firm_id and o.fincom_id = i.fincom_id and o.job_id <> p_id and o.live) limit 1;
      if dup is not null then return jsonb_build_object('ok', false, 'error', 'Not queued again: the entry ' || dup || ' is being posted in another posting; wait for that one to finish (or cancel it).'); end if;
      rr := tally_post_reroute(p_id, false);
      if rr ->> 'state' = 'stranded' then return jsonb_build_object('ok', false, 'company', j.company, 'error', 'Not queued again for ' || j.company || ': ' || (rr ->> 'words')); end if;
      update tally_post_jobs set status = 'waiting', message = case when rr ->> 'state' = 'unrouted' then tally_post_unrouted_words(f, p_client, j.company) else 'Retry: waiting for the Tally computer' end, taken_at = null, updated_at = now(),
             attempts = coalesce(attempts, 0) + 1, resend_only = null where id = p_id;     -- final review M1: a person's Retry is a whole Retry
      return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'retry', true);
    end if;
    -- still waiting for a bridge that can no longer post: moved, or failed in plain words (review M-B)
    if j.status = 'waiting' then
      rr := tally_post_reroute(p_id, true);
      if rr ->> 'state' = 'stranded' then return jsonb_build_object('ok', false, 'company', j.company, 'error', 'Not posted into ' || j.company || ': ' || (rr ->> 'words')); end if;
    end if;
    return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'again', true);
  end if;
  if octet_length(p_payload::text) > 8 * 1024 * 1024 then return jsonb_build_object('ok', false, 'error', 'Too many entries in one go; post fewer at a time.'); end if;
  n := coalesce(jsonb_array_length(p_payload->'vouchers'), 0) + coalesce(jsonb_array_length(p_payload->'masters'), 0);
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'Nothing to post.'); end if;
  -- 184: an entry an earlier posting holds is left out of this one, not a reason to refuse the rest: one in a posting
  -- still waiting, taken or running (by its entry id, as before), or one whose FinCom id is live in another posting
  -- (tally_post_ids: sent and not settled, or in Tally; before 184 the insert below raised on it and refused them all).
  -- Each is answered with the posting that holds it (dupes: [{id, job, status}]); the page follows that posting
  with lv as (select v->>'id' as id, j2.id as job, j2.status, j2.created_at
                from tally_post_jobs j2, jsonb_array_elements(case when jsonb_typeof(j2.payload->'vouchers') = 'array' then j2.payload->'vouchers' else '[]'::jsonb end) v
               where j2.firm_id = f and j2.client_id = p_client and j2.status in ('waiting', 'taken', 'running')),
       x as (select t.v, t.o, coalesce(a.job, b.job) as job, coalesce(a.status, b.status) as status
               from jsonb_array_elements(case when jsonb_typeof(p_payload->'vouchers') = 'array' then p_payload->'vouchers' else '[]'::jsonb end) with ordinality t(v, o)
               left join lateral (select lv.job, lv.status from lv where lv.id = t.v->>'id' order by lv.created_at limit 1) a on true
               left join lateral (select i.job_id as job, j3.status from tally_post_ids i join tally_post_jobs j3 on j3.id = i.job_id
                                   where i.firm_id = f and i.live and i.fincom_id = tally_fincom_id(t.v) and i.job_id <> p_id limit 1) b on true)
  select coalesce(jsonb_agg(x.v order by x.o) filter (where x.job is null), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('id', x.v->>'id', 'job', x.job, 'status', x.status) order by x.o) filter (where x.job is not null), '[]'::jsonb)
    into vs, dupes from x;
  -- every entry is in an earlier posting: nothing is queued (ok false with the words an older page shows; none: the page
  -- of this branch follows the posting named instead)
  if jsonb_array_length(dupes) > 0 and jsonb_array_length(vs) = 0 then
    return jsonb_build_object('ok', false, 'none', true, 'company', c.company, 'dupes', dupes,
      'error', case when exists (select 1 from jsonb_array_elements(dupes) d where d->>'status' in ('waiting', 'taken', 'running'))
        then 'These entries are already waiting to be posted in an earlier posting, which goes on by itself. Nothing was queued again.'
        else 'These entries are held by an earlier posting (sent to Tally, or waiting to be settled there); they are not sent twice. Nothing was queued again.' end);
  end if;
  n := jsonb_array_length(vs) + coalesce(jsonb_array_length(p_payload->'masters'), 0);
  -- review M4: the computer: the target's; else the newest that may post and has the company open
  -- 185: no computer named and none has the company open (or tally_post_enqueue_to asks for none: p_target '*'): queued
  -- all the same, for no computer (device_id null), when the link can prove the company to a bridge (its GUID and data
  -- location); else refused in the words as before
  dev := case when p_device is null and p_target = '*' then null else coalesce(p_device, tally_post_device_for(f, c.company, c.device_id)) end;
  if dev is null and not tally_post_unrouted_can(f, p_client, c.company) then return jsonb_build_object('ok', false, 'company', c.company, 'error', tally_post_nobody_words(f, c.company)); end if;
  unr := dev is null;
  insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, target_bridge)
    values (p_id, f, p_client, c.company, dev, jsonb_build_object('masters', coalesce(p_payload->'masters', '[]'::jsonb), 'vouchers', vs, 'ledger', coalesce(p_payload->>'ledger', '')), n,
            case when p_device is null then null else p_target end);
  if unr then
    update tally_post_jobs set message = tally_post_unrouted_words(f, p_client, c.company) where id = p_id and status = 'waiting' and device_id is null;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'company', c.company) || case when unr then jsonb_build_object('unrouted', true, 'note', tally_post_unrouted_words(f, p_client, c.company)) else '{}'::jsonb end || case when jsonb_array_length(dupes) > 0 then jsonb_build_object('dupes', dupes) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) to service_role;

-- 142's tally_post_enqueue_to; changed: no bridge has the company open, or the bridge named cannot post it: queued for no
-- computer (when the link can prove the company) instead of refused
create or replace function public.tally_post_enqueue_to(p_id uuid, p_client text, p_payload jsonb, p_target text default null, p_device uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); t text := nullif(left(btrim(coalesce(p_target, '')), 40), ''); own record; tdev uuid; is_owner boolean; r jsonb; seen record; co text;
        allowed text; pick jsonb; lk boolean; mine boolean := true; note text; srv jsonb; lnk record;
        unr boolean := false; why text;   -- 185: queued for no computer; why the bridge named cannot post it
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
  if co is null then co := tally_link_post_to(f, p_client, null); end if;   -- 185: no computer keeps it now: the link record's company
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
      elsif tally_post_unrouted_can(f, p_client, co) then
        -- 185 (the owner, 13-Nov-2026): no computer has the company open: queued all the same, for no computer; the first
        -- FinCom Bridge that opens that very company (the link's GUID and data location) takes it
        unr := true;
      else
        return jsonb_build_object('ok', false, 'company', co, 'error', 'Open ' || co || ' in Tally (in any Windows login with FinCom Bridge), then post again. Nothing was queued.');
      end if;
    end if;
  else
    tdev := tally_bridge_device(f, t);
    mine := tally_bridge_is_own(f, auth.uid(), tdev, t);
    -- 185: the bridge named cannot post it (the reasons and their words as before, in the same order): the posting is not
    -- sent through it; it is queued for no computer when the link can prove the company to a bridge, else refused as before
    why := case when not mine and not is_owner then 'Only an owner of the firm can post through another bridge than your own.'
                when tdev is null then 'FinCom has not heard from that bridge on any of the firm''s computers; nothing was queued.'
                -- review M3: named with its computer, the one the bridge id is bound to
                when p_device is null or p_device <> tdev then 'That bridge is not on the computer named; nothing was queued. Refresh the Tally page and choose it again.'
                when tally_bridge_changes_only_on(tdev, t) then 'That bridge is set to changes only: it reads Tally''s changes and never posts. Nothing was queued.'
                when not tally_bridge_may_post(tdev, t) then 'That bridge only reads Tally: another bridge of the same Windows user is the main one on its computer. Nothing was queued.' end;
    if why is not null then
      if not tally_post_unrouted_can(f, p_client, co) then return jsonb_build_object('ok', false, 'error', why); end if;
      unr := true;
    end if;
  end if;
  -- 9b: not heard from for more than 3 minutes: queued all the same; the bridge takes it when it is back
  if unr then t := null; tdev := null; end if;
  if t is not null then
    select d.info -> 'bridges' -> t ->> 'at' as at, d.info -> 'bridges' -> t ->> 'user' as u into seen from tally_devices d where d.id = tdev;
    if coalesce(case when coalesce(seen.at, '') ~ '^\d{4}-\d\d-\d\dT' then seen.at::timestamptz >= now() - interval '3 minutes' end, false) is not true then
      -- 142 (7.): whichever bridge has the company open takes it, so the note names the company's Tally, not one login's
      note := 'Queued: waits for the Tally that has ' || co || ' open. It is posted as soon as a FinCom Bridge of the firm is heard with ' || co || ' open in its Tally (none is now'
        || coalesce('; the one chosen was last heard ' || to_char(case when coalesce(seen.at, '') ~ '^\d{4}-\d\d-\d\dT' then seen.at::timestamptz end at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST', '') || ').';
    end if;
  end if;
  r := tally_post_enqueue_core(p_id, p_client, p_payload, tdev, case when unr then '*' else t end);
  -- 185: the bridge named was not used: said, in the answer and after the posting's words
  if why is not null and coalesce((r ->> 'unrouted')::boolean, false) then
    why := 'Not sent through the bridge chosen: ' || regexp_replace(why, '[;:.]? ?[Nn]othing was queued\..*$', '.');
    update tally_post_jobs set message = left(message || '. ' || why, 500) where id = p_id and firm_id = f and status = 'waiting' and device_id is null;
    r := r || jsonb_build_object('note', (r ->> 'note') || '. ' || why, 'targetWhy', why);
  end if;
  if note is not null and coalesce((r ->> 'ok')::boolean, false) then
    update tally_post_jobs set message = left(note, 300) where id = p_id and firm_id = f and status = 'waiting';
    r := r || jsonb_build_object('note', note);
  end if;
  return r || jsonb_build_object('target', (select j.target_bridge from tally_post_jobs j where j.id = p_id and j.firm_id = f));
end $function$;
revoke all on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) to authenticated, service_role;

commit;
