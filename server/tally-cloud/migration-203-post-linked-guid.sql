-- Migration 203 (19-Nov-2026, branch next-fix-linkedguid; written, NOT run: the owner reads it and runs it). AFTER the applied
-- 202 (migration-202-post-recheck.sql, live on staging), which it refuses to run without.
-- The owner's hard rule: FinCom Bridge posts an entry only into the Tally company the client is linked to, known by the
-- company's GUID (tally_links.company_guid, 110). The applied 202 already hands a posting out, and counts it in the beat,
-- only while the bridge reports the linked GUID open (tally_post_linked_ok), and says why on the posting otherwise
-- (tally_post_linked_why_for). What this branch still needs on top of it (this branch's own first draft of a 202, never
-- run, is withdrawn; what the applied 202 covers is dropped from it):
--
--   1. tally_post_jobs.company_guid (new, lower case): the linked GUID a posting is for, stamped as it is queued (a BEFORE
--      INSERT trigger, tally_post_jobs_guid: no enqueue function is replaced), from tally_links.company_guid then; a
--      posting queued before 203 (no stamp) is stamped by its hand-out. posts_take sends it to the bridge, which posts only
--      into the open company with that GUID and, given none, waits and sends nothing (bridge linkguid.go).
--   2. tally_post_link_guid(firm, client, company): the GUID of the client's linked company of that name; null when the link
--      has none, or two linked books of that name disagree. Service role only.
--   3. 202's tally_post_linked_ok (same arguments), changed: the single linked GUID (2.), open in the bridge's list, and NO
--      other open company of that name with another GUID in the same list (two open companies of one name: Tally is told
--      the company by its name, so neither is posted to). The beat's count and the hand-out follow (both ask it).
--   4. 202's tally_post_linked_why_for, changed: two more plain reasons (two linked books disagree; two open companies of
--      that name), and "an owner picks" while 6. is waiting.
--   5. 202's tally_post_take_for, changed: a posting with no stamp is stamped as it is handed out; the third look (a
--      posting queued for no computer, 185's tally_post_unrouted_ok) asks the gate too.
--      174's tally_post_job_blocked, two cases added: the client linked to another Tally company (another GUID) after the
--      posting was made; or a posting with no stamp (queued while its link had no GUID, or before 203) whose link's GUID
--      changed, or whose client was relinked, after it was made (tally_links.guid_changed_at, 5d., or linked_at, later
--      than the posting): held for a person with that reason (174's hold: failed when never taken, else the stop flag),
--      never stamped with, or handed to, the new company. A link's first GUID (an owner's pick, or filled by itself), its
--      posting switched off and on, a rename or a data location chosen hold nothing: such a posting is handed out by
--      itself, stamped with the GUID the link has then.
--      5d. tally_links.guid_changed_at (new): when the link's GUID last changed from one it had (to another or none), or
--      the client was relinked (client, linked_at, or linked again), kept by a BEFORE INSERT OR UPDATE trigger
--      (tally_links_guid_changed); a first GUID set on a link that had none does not move it. A link not touched since
--      before 203 has none (its changes before 203 are not known): its updated_at stands for it, and the first touch
--      after 203 keeps that time in the column (never forgotten).
--      202's tally_post_count_for: the postings queued for no computer counted only when the gate is open (asked once per
--      client and company), as the hand-out's third look; timed against 185's text (tests/run_migration203.py, 9.).
--   6. "pick which company": tally_links.guid_pick (new, jsonb). A link with no GUID whose name a bridge's beat shows open
--      twice with two GUIDs is never given one by itself: marked {at, guids, device, bridge} for an owner to pick
--      (tally_link_guid_pick, owners only: one of the GUIDs marked, never one another linked book holds).
--      tally_link_guid_fill (155's text, one line added) marks and clears it after each fill (tally_link_guid_pick_mark;
--      the open companies of the bridge's latest beat: tally_post_beat_cos).
--   7. tally_link_guid (110's text): a link made from the beats takes a GUID only when every beat that names the company
--      gives the same one (two companies of that name open: none; then 6.).
-- Not here (the applied 202 covers it, or it was dropped): a second wait function and posts_take's "wait" words (202's
-- count writes the words on the posting), the 3-minute heard check (202's gate reads the bridge's latest list).
-- ADD-ONLY: three columns (if not exists; the jobs column's check added NOT VALID, if not there), two triggers (if not
-- there); new functions; six replaced with the same arguments and their grants restated. No table, nothing dropped, no row
-- changed. One transaction, lock_timeout 3 s, safe twice; then the check validated in a second short transaction of its
-- own (a scan of tally_post_jobs that blocks no writer; nothing to do once valid, or when the first did not run).
-- Deploy: 203, then tally-ingest of this branch (posts_take sends guid; the beat keeps two open companies of one name
-- apart), then the bridge (it posts only a posting that names the GUID).
-- bridge. Tested on a throwaway stand: tests/run_migration203.py.
begin;
set local lock_timeout = '3s';

do $$ begin
  if to_regprocedure('public.tally_post_linked_ok(uuid,text,text,uuid,text)') is null or to_regprocedure('public.tally_post_linked_why_for(uuid,text,text,uuid,text)') is null
     or to_regprocedure('public.tally_post_recheck_job(uuid)') is null or to_regclass('public.tally_post_rechecks') is null then
    raise exception 'migration 203 runs after 202 (migration-202-post-recheck.sql, with 199, 200 and 201)';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. the columns
alter table public.tally_post_jobs add column if not exists company_guid text;
alter table public.tally_links add column if not exists guid_pick jsonb;
alter table public.tally_links add column if not exists guid_changed_at timestamptz;   -- 5d.
-- the column's check: added NOT VALID (no scan under the table's lock), validated at the end in a transaction of its own
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tally_post_jobs_company_guid_check' and conrelid = 'public.tally_post_jobs'::regclass) then
    alter table public.tally_post_jobs add constraint tally_post_jobs_company_guid_check check (company_guid is null or company_guid ~ '^[0-9a-z-]{1,100}$') not valid;
  end if;
end $$;

-- ---------------------------------------------------------------- 2. the linked GUID of a client's company
-- stamped on each posting as it is handed out (5.)
create or replace function public.tally_post_link_guid(p_firm uuid, p_client text, p_company text)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select case when count(distinct lower(btrim(l.company_guid))) = 1 and bool_and(nullif(btrim(coalesce(l.company_guid, '')), '') is not null)
              then min(lower(btrim(l.company_guid))) end
    from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
   where l.firm_id = p_firm and l.client_id = p_client and l.state = 'linked' and lower(tally_nm(tc.company)) = lower(tally_nm(p_company))
$function$;
revoke all on function public.tally_post_link_guid(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tally_post_link_guid(uuid, text, text) to service_role;

-- stamped as it is queued (whatever function queued it: no enqueue function is replaced), from the link's GUID then
create or replace function public.tally_post_jobs_guid()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if new.company_guid is null then
    new.company_guid := tally_post_link_guid(new.firm_id, new.client_id, new.company);
  end if;
  return new;
end $function$;
revoke all on function public.tally_post_jobs_guid() from public, anon, authenticated;
grant execute on function public.tally_post_jobs_guid() to service_role;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_jobs_guid' and tgrelid = 'public.tally_post_jobs'::regclass) then
    create trigger tally_post_jobs_guid before insert on public.tally_post_jobs for each row execute function public.tally_post_jobs_guid();
  end if;
end $$;

-- ---------------------------------------------------------------- 3. the gate (202's tally_post_linked_ok)
-- the open companies the bridge's latest beat names, each (name, guid): its own list (info.bridges[id].cos, 146; two open
-- companies of one name kept apart from this branch's tally-ingest on), else its key's beat (info.beat.companies, open)
create or replace function public.tally_post_beat_cos(p_device uuid, p_bridge text)
returns table (name text, guid text) language sql stable security definer set search_path = public, pg_temp as $function$
  select lower(regexp_replace(tally_nm(x ->> 0), '^[\s\x01-\x1f]+|[\s\x01-\x1f]+$', '', 'g')), lower(btrim(coalesce(x ->> 1, '')))
    from tally_devices d, jsonb_array_elements(case when jsonb_typeof(d.info -> 'bridges' -> p_bridge -> 'cos') = 'array' then d.info -> 'bridges' -> p_bridge -> 'cos' else '[]'::jsonb end) x
   where d.id = p_device and jsonb_typeof(d.info -> 'bridges' -> p_bridge -> 'cos') = 'array' and jsonb_typeof(x) = 'array'
  union all
  select lower(regexp_replace(tally_nm(x ->> 'name'), '^[\s\x01-\x1f]+|[\s\x01-\x1f]+$', '', 'g')), lower(btrim(coalesce(x ->> 'guid', '')))
    from tally_devices d, jsonb_array_elements(case when jsonb_typeof(d.info -> 'beat' -> 'companies') = 'array' then d.info -> 'beat' -> 'companies' else '[]'::jsonb end) x
   where d.id = p_device and jsonb_typeof(d.info -> 'bridges' -> p_bridge -> 'cos') is distinct from 'array'
     and jsonb_typeof(d.info -> 'beat' -> 'companies') = 'array' and jsonb_typeof(x) = 'object' and coalesce(x ->> 'open', 'true') <> 'false'
$function$;
revoke all on function public.tally_post_beat_cos(uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_beat_cos(uuid, text) to service_role;

-- 202's text; changed: the single linked GUID (tally_post_link_guid) open in the bridge's list (as 202: its own list when
-- it sends one, else its key's beat), and no other open company of the same name with another GUID in that list
create or replace function public.tally_post_linked_ok(p_firm uuid, p_client text, p_company text, p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((
    select lg.g is not null
       and exists (select 1 from tally_post_beat_cos(p_device, p_bridge) a where a.guid = lg.g)
       and not exists (select 1 from tally_post_beat_cos(p_device, p_bridge) a join tally_post_beat_cos(p_device, p_bridge) b on b.name = a.name and b.guid <> a.guid
                        where a.guid = lg.g)
      from tally_devices me, (select tally_post_link_guid(p_firm, p_client, p_company) as g) lg
     where me.id = p_device and not coalesce(me.revoked, false)), false)
$function$;
revoke all on function public.tally_post_linked_ok(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_linked_ok(uuid, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------- 4. the words (202's tally_post_linked_why_for)
-- 202's text; changed: two linked books disagree; two open companies of that name; an owner picks (6.)
create or replace function public.tally_post_linked_why_for(p_firm uuid, p_client text, p_company text, p_device uuid, p_bridge text)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select case
    when p_client is null or nullif(btrim(coalesce(p_company, '')), '') is null
      then 'Not posted yet: this posting names no ' || case when p_client is null then 'client' else 'Tally company' end || ', so FinCom cannot tell the linked company (it posts only into the linked company, by its company ID). Cancel it and post again from the client''s page'
    when not exists (select 1 from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
                      where l.firm_id = p_firm and l.client_id = p_client and l.state = 'linked' and lower(tally_nm(tc.company)) = lower(tally_nm(p_company)))
      then 'Not posted yet: the client is not linked to the Tally company ' || p_company || ' in FinCom. FinCom posts only into the linked company, by its company ID'
    when not exists (select 1 from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
                      where l.firm_id = p_firm and l.client_id = p_client and l.state = 'linked' and lower(tally_nm(tc.company)) = lower(tally_nm(p_company))
                        and nullif(btrim(coalesce(l.company_guid, '')), '') is not null)
      then case when exists (select 1 from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
                              where l.firm_id = p_firm and l.client_id = p_client and l.state = 'linked' and lower(tally_nm(tc.company)) = lower(tally_nm(p_company)) and l.guid_pick is not null)
             then 'Not posted yet: two open companies in Tally are named ' || p_company || '; an owner picks which one is the client''s on the Tally page, then it posts by itself (FinCom posts only into the linked company, by its company ID)'
             else 'Not posted yet: the linked company has no company ID yet (FinCom posts only into the linked company, by its company ID). Open ' || p_company || ' in Tally on the computer so the FinCom Bridge reads its ID' end
    -- 203: the name's linked books disagree (no single linked GUID); "pick which company" waiting for an owner
    when tally_post_link_guid(p_firm, p_client, p_company) is null
      then 'Not posted yet: two linked Tally companies of the client named ' || p_company || ' have different company IDs (FinCom posts only into the linked company, by its company ID). Unlink the one that is not the client''s on the Tally page'
    -- 203: the linked GUID open, and another open company of that name too
    when exists (select 1 from tally_post_beat_cos(p_device, p_bridge) a join tally_post_beat_cos(p_device, p_bridge) b on b.name = a.name and b.guid <> a.guid
                  where a.guid = tally_post_link_guid(p_firm, p_client, p_company))
      then 'Not posted yet: two open companies in Tally are named ' || p_company || '; close the one that is not the client''s (FinCom posts only into the linked company, by its company ID)'
    when (select case when jsonb_typeof(me.info -> 'bridges' -> p_bridge -> 'cos') = 'array'
           then exists (select 1 from jsonb_array_elements(me.info -> 'bridges' -> p_bridge -> 'cos') c where jsonb_typeof(c) = 'array' and nullif(btrim(coalesce(c ->> 1, '')), '') is not null)
           else jsonb_typeof(me.info -> 'beat' -> 'companies') = 'array'
            and exists (select 1 from jsonb_array_elements(me.info -> 'beat' -> 'companies') c where jsonb_typeof(c) = 'object' and nullif(btrim(coalesce(c ->> 'guid', ''))  , '') is not null
                         and coalesce(c ->> 'open', 'true') <> 'false') end from tally_devices me where me.id = p_device)
      then 'Not posted yet: the Tally company open on the computer is not the linked one (different company ID). Open ' || p_company || ' (the company its client is linked to) in Tally'
    else 'Not posted yet: the linked Tally company ' || p_company || ' is not open in Tally on the computer' end
$function$;
revoke all on function public.tally_post_linked_why_for(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_linked_why_for(uuid, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------- 5. the hand-out (202's tally_post_take_for)
-- 202's text; changed: each hand-out stamps company_guid (the GUID its gate judged open); the third look asks the gate too
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
       and tally_post_linked_open(j.id, p_device, p_bridge)   -- 202: the linked company's GUID open on this bridge
       -- (the sixth review) put back after FinCom could not confirm in time (tally-ingest's posts_update): taken again after 30 s
       and not (j.message like 'Put back for the same FinCom Bridge%' and j.updated_at > now() - interval '30 seconds')
     order by j.created_at limit 1 for update skip locked;
    exit when jid is null;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', company_guid = coalesce(company_guid, tally_post_link_guid(firm_id, client_id, company)), taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, message = 'Taken by the Tally computer',
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
       and tally_post_linked_open(j.id, p_device, p_bridge)   -- 202
     order by j.created_at limit 1 for update of j skip locked;
    exit when jid is null;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', company_guid = coalesce(company_guid, tally_post_link_guid(firm_id, client_id, company)), taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, device_id = p_device, target_bridge = p_bridge, taken_by = p_bridge,
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
       and tally_post_linked_open(j.id, p_device, p_bridge)   -- 203: here too (two open companies of the name: never)
     order by j.created_at limit 1 for update of j skip locked;
    if jid is null then return; end if;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', company_guid = coalesce(company_guid, tally_post_link_guid(firm_id, client_id, company)), taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, device_id = p_device, target_bridge = p_bridge, taken_by = p_bridge,
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

-- ---------------------------------------------------------------- 5d. when the link's GUID changed (or the client was relinked)
-- a new link, a GUID changed from one the link had (to another, or none), another client, linked again, or linked_at
-- moved: now. Anything else (a first GUID on a link that had none, posting switched, a rename, a data location): kept as
-- it was; a link with none yet (not touched since before 203) keeps its last change before then (updated_at)
create or replace function public.tally_links_guid_changed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if tg_op = 'INSERT'
     or (nullif(btrim(coalesce(old.company_guid, '')), '') is not null and lower(btrim(coalesce(new.company_guid, ''))) is distinct from lower(btrim(old.company_guid)))
     or new.client_id is distinct from old.client_id or new.linked_at is distinct from old.linked_at
     or (new.state = 'linked' and old.state is distinct from 'linked') then
    new.guid_changed_at := now();
  else
    new.guid_changed_at := coalesce(old.guid_changed_at, old.updated_at, old.linked_at, '-infinity'::timestamptz);
  end if;
  return new;
end $function$;
revoke all on function public.tally_links_guid_changed() from public, anon, authenticated;
grant execute on function public.tally_links_guid_changed() to service_role;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_links_guid_changed' and tgrelid = 'public.tally_links'::regclass) then
    create trigger tally_links_guid_changed before insert or update on public.tally_links for each row execute function public.tally_links_guid_changed();
  end if;
end $$;

-- ---------------------------------------------------------------- 5b. the link changed after the posting was made
-- 174's tally_post_job_blocked; added: a posting stamped as queued whose client is now linked to another Tally company
-- (another GUID) is held for a person (174's tally_post_hold_job: failed when never taken, else the stop flag), never
-- handed to the new company. One with no stamp is held when its link's GUID changed, or its client was relinked, after
-- it was made (5d.); else it is stamped at its hand-out with the GUID the link has then
create or replace function public.tally_post_job_blocked(p_job uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select case
    when tc.book_id is null and p.now_to is not null
      then 'Not posted: the Tally company ' || j.company || ' was renamed (or removed) after this was queued; ' || nm || ' now posts to ' || p.now_to || '. Nothing of it was sent to Tally. Post it again to send it there.'
    when tc.book_id is null
      then 'Not posted: ' || j.company || ' is no longer a Tally company of ' || nm || ' in FinCom (renamed or removed after this was queued). Nothing of it was sent to Tally.'
    when l.book_id is null or l.state <> 'linked' or l.client_id is distinct from j.client_id
      then 'Not posted: ' || nm || ' was unlinked from ' || j.company || ' in Tally after this was queued. Nothing of it was sent to Tally. Link it again on the Tally page, then post again.'
    when exists (select 1 from tally_split_links x where x.firm_id = j.firm_id and x.book_id = tc.book_id and x.client_id = j.client_id and x.state = 'linked')
      then 'Not posted: ' || j.company || ' is now the earlier-years company of ' || nm || ' in Tally; postings go to its current company only. Nothing of it was sent to Tally.'
    when j.company_guid is not null and tally_post_link_guid(j.firm_id, j.client_id, j.company) is not null and tally_post_link_guid(j.firm_id, j.client_id, j.company) <> j.company_guid
      then 'The client was linked to another Tally company after this posting was made: check the entries and post again. Nothing of it was sent to Tally.'
    when j.company_guid is null and exists (select 1 from tally_links x join tally_companies t on t.firm_id = x.firm_id and t.book_id = x.book_id where x.firm_id = j.firm_id and x.client_id = j.client_id and x.state = 'linked' and lower(tally_nm(t.company)) = lower(tally_nm(j.company)) and greatest(x.linked_at, coalesce(x.guid_changed_at, x.updated_at)) > j.created_at)
      then 'The client was linked to another Tally company after this posting was made: check the entries and post again. Nothing of it was sent to Tally.'
    when not l.posting_allowed
      then 'Not posted: posting into Tally was stopped for ' || nm || ' after this was queued. Nothing of it was sent to Tally. Allow it on the Tally page (the company''s ⋯ Post entries here), then post again.'
  end
  from tally_post_jobs j
  cross join lateral (select coalesce((select cl.name from clients cl where cl.firm_id = j.firm_id and cl.id = j.client_id), 'this client') nm) c
  left join lateral (select t.book_id from tally_companies t where t.firm_id = j.firm_id and lower(tally_nm(t.company)) = lower(tally_nm(j.company))
                      order by (t.company = j.company) desc, t.last_seen desc nulls last limit 1) tc on true
  left join tally_links l on l.firm_id = j.firm_id and l.book_id = tc.book_id
  cross join lateral (select tally_link_post_to(j.firm_id, j.client_id, null) now_to) p
  where j.id = p_job
$function$;
revoke all on function public.tally_post_job_blocked(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_job_blocked(uuid) to service_role;

-- ---------------------------------------------------------------- 5c. the beat's count (202's tally_post_count_for)
-- 202's text; changed: the postings queued for no computer are counted only when the gate (3.) is open, asked once per
-- client and company as for the bridge's own (the hand-out's third look asks it, 5.)
create or replace function public.tally_post_count_for(p_device uuid, p_bridge text, p_main boolean)
returns integer language plpgsql volatile security definer set search_path = public, pg_temp as $function$
declare n integer; w jsonb; go boolean := coalesce(p_bridge, '') ~ '^go-[0-9a-f]{6,32}$'; r record;
begin
  with mine as materialized (
    select j.id, j.firm_id, j.client_id, j.company, j.message, j.stop_reason, j.created_at from tally_post_jobs j
     where j.device_id = p_device and j.status = 'waiting' and tally_post_mine_ok(j.id, p_device, p_bridge, p_main)
       and not (j.message like 'Put back for the same FinCom Bridge%' and j.updated_at > now() - interval '30 seconds')),   -- (the put-back's pause, as the hand-out)
  gk as materialized (
    select g.firm_id, g.client_id, g.company, tally_post_linked_ok(g.firm_id, g.client_id, g.company, p_device, p_bridge) as ok
      from (select distinct m.firm_id, m.client_id, m.company from mine m) g),
  gw as materialized (select gk.*, case when not gk.ok then left(tally_post_linked_why_for(gk.firm_id, gk.client_id, gk.company, p_device, p_bridge), 300) end as why from gk)
  select (select count(*)::int from mine m join gw on gw.firm_id = m.firm_id and gw.client_id is not distinct from m.client_id and gw.company is not distinct from m.company where gw.ok),
         -- the words: refused, the gate's words (empty over its own once open: never another writer's)
         (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'why', x.why)), '[]'::jsonb) from (
            select m.id, coalesce(gw.why, '') as why from mine m join gw on gw.firm_id = m.firm_id and gw.client_id is not distinct from m.client_id and gw.company is not distinct from m.company
             where m.stop_reason is null and ((not gw.ok and gw.why is not null and m.message is distinct from gw.why and (coalesce(m.message, '') = '' or m.message like 'Not posted yet: %'))
                                              or (gw.ok and m.message like 'Not posted yet: %'))
             order by m.created_at limit 20) x)
    into n, w;
  if go then
    n := n + (with pk as materialized (
                select j.firm_id, j.client_id, j.company from tally_post_jobs j join tally_devices me on me.id = p_device
                 where j.firm_id = me.firm_id and j.status = 'waiting' and j.taken_by is null and tally_post_pickable_ok(j.id, p_device, p_bridge)),
              pg as materialized (select g.*, tally_post_linked_ok(g.firm_id, g.client_id, g.company, p_device, p_bridge) as ok from (select distinct * from pk) g)
              select count(*)::int from pk join pg on pg.firm_id = pk.firm_id and pg.client_id is not distinct from pk.client_id and pg.company is not distinct from pk.company where pg.ok)
           + (with uk as materialized (select j.firm_id, j.client_id, j.company from tally_post_jobs j join tally_devices me on me.id = p_device
                                          where j.firm_id = me.firm_id and j.status = 'waiting' and j.device_id is null and tally_post_unrouted_ok(j.id, p_device, p_bridge)),
                   ug as materialized (select g.*, tally_post_linked_ok(g.firm_id, g.client_id, g.company, p_device, p_bridge) as ok from (select distinct * from uk) g)
              select count(*)::int from uk join ug on ug.firm_id = uk.firm_id and ug.client_id is not distinct from uk.client_id and ug.company is not distinct from uk.company where ug.ok);
  end if;
  if jsonb_array_length(w) > 0 then
    begin
      if tally_bridge_may_post(p_device, p_bridge) then   -- (cleared too only by a bridge that may post: its gate is the one judged)
        for r in select (x->>'id')::uuid as id, x->>'why' as why from jsonb_array_elements(w) x loop
          perform 1 from tally_post_jobs j where j.id = r.id for update skip locked;
          if found then
            update tally_post_jobs set message = r.why
             where id = r.id and status = 'waiting' and stop_reason is null and (coalesce(message, '') = '' or message like 'Not posted yet: %') and message is distinct from r.why;
          end if;
        end loop;
      end if;
    exception when others then null;   -- (the words are a courtesy; the count stands)
    end;
  end if;
  return n;
end $function$;
revoke all on function public.tally_post_count_for(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_count_for(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------- 6. "pick which company"
-- a linked company with no GUID that this bridge's beat shows open under its name with two (or more) GUIDs: marked for an
-- owner to pick (never filled by itself); a link that has its GUID: the mark cleared. Returns the number marked
create or replace function public.tally_link_guid_pick_mark(p_firm uuid, p_device uuid, p_bridge text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare n integer := 0; c record;
begin
  update tally_links set guid_pick = null where firm_id = p_firm and guid_pick is not null and (company_guid is not null or state <> 'linked');
  for c in
    select l.book_id, array_agg(distinct b.guid order by b.guid) as guids
      from tally_links l join tally_post_beat_cos(p_device, p_bridge) b
        on b.name = lower(regexp_replace(tally_nm(l.company_name), '^[\s\x01-\x1f]+|[\s\x01-\x1f]+$', '', 'g'))
     where l.firm_id = p_firm and l.state = 'linked' and l.company_guid is null and b.guid ~ '^[0-9a-z-]{1,100}$'
     group by l.book_id having count(distinct b.guid) > 1
  loop
    update tally_links set guid_pick = jsonb_build_object('at', now(), 'guids', to_jsonb(c.guids), 'device', p_device, 'bridge', p_bridge)
     where firm_id = p_firm and book_id = c.book_id and company_guid is null
       and (guid_pick is null or guid_pick -> 'guids' is distinct from to_jsonb(c.guids));
    if found then n := n + 1; end if;
  end loop;
  return n;
end $function$;
revoke all on function public.tally_link_guid_pick_mark(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_guid_pick_mark(uuid, uuid, text) to service_role;

-- an owner picks which of the marked GUIDs is the client's company (members who are owners only, as 110's
-- tally_link_place_choose); never a GUID another linked book of the firm holds
create or replace function public.tally_link_guid_pick(p_book uuid, p_guid text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); r tally_links%rowtype; g text := lower(btrim(coalesce(p_guid, '')));
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true)) then
    raise exception 'only an owner of the firm picks which Tally company is the client''s' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || f::text));
  select * into r from tally_links where firm_id = f and book_id = p_book and state = 'linked' for update;
  if not found then raise exception 'this Tally company is not linked to a client' using errcode = 'P0001'; end if;
  if r.company_guid is not null then raise exception 'this link already has its Tally company' using errcode = 'P0001'; end if;
  if r.guid_pick is null or not (r.guid_pick -> 'guids') ? g then raise exception 'not one of the companies to pick from' using errcode = 'P0001'; end if;
  if exists (select 1 from tally_links x where x.firm_id = f and x.state = 'linked' and lower(btrim(x.company_guid)) = g) then
    raise exception 'that Tally company is already linked to another client' using errcode = 'P0001';
  end if;
  update tally_links set company_guid = g, guid_pick = null, updated_by = auth.uid(), updated_at = now(), version = version + 1
   where firm_id = f and book_id = p_book returning * into r;
  return to_jsonb(r);
end $function$;
revoke all on function public.tally_link_guid_pick(uuid, text) from public, anon;
grant execute on function public.tally_link_guid_pick(uuid, text) to authenticated, service_role;

-- 155's tally_link_guid_fill; added: one line, the marks after the fill
create or replace function public.tally_link_guid_fill(p_firm uuid, p_device uuid, p_bridge text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare n integer := 0; c record;
begin
  if p_firm is null or p_device is null or coalesce(p_bridge, '') = '' then return 0; end if;
  -- one fill of the firm's links at a time (taken before the links are read)
  perform pg_advisory_xact_lock(hashtext('tally_links:' || p_firm::text));
  for c in
    with src as (
      -- t: l the firm's links (any state), c the firm's company list, m this bridge's own record, r every other bridge's
      -- record of the firm's live computers, b their last beats' companies (what 110's tally_link_guid reads)
      select 'l'::text as t, l.book_id, l.company_name as name, null::text as g, l.state, l.company_guid as cg
        from tally_links l where l.firm_id = p_firm
      union all
      select 'c', null, tc.company, null, null, null from tally_companies tc where tc.firm_id = p_firm
      union all
      select case when d.id = p_device and br.key = p_bridge then 'm' else 'r' end, null, x ->> 0, lower(btrim(x ->> 1)), null, null
        from tally_devices d,
             jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) br,
             jsonb_array_elements(case when jsonb_typeof(br.value -> 'cos') = 'array' then br.value -> 'cos' else '[]'::jsonb end) x
       where d.firm_id = p_firm and not coalesce(d.revoked, false) and jsonb_typeof(x) = 'array'
      union all
      select 'b', null, x ->> 'name', lower(btrim(x ->> 'guid')), null, null
        from tally_devices d,
             jsonb_array_elements(case when jsonb_typeof(d.info -> 'beat' -> 'companies') = 'array' then d.info -> 'beat' -> 'companies' else '[]'::jsonb end) x
       where d.firm_id = p_firm and not coalesce(d.revoked, false) and jsonb_typeof(x) = 'object'),
    k1 as (
      -- the cleaned name: tally_nm, then tally-ingest's coTrim (spaces and control characters such as Tally's chr(4) off
      -- both ends), case folded
      select src.*, lower(regexp_replace(tally_nm(src.name), '^[\s\x01-\x1f]+|[\s\x01-\x1f]+$', '', 'g')) as nk
        from src where coalesce(src.name, '') <> ''),
    k as (
      -- the look-alike key, kept coarser than link-choose's tallyLookKey (server/_shared/tallyname.js) so that two names
      -- it calls alike are alike here too: "(P)" as pvt, bracketed words, digits and punctuation, single letters, the
      -- forms of Pvt/Ltd/LLP/Co, "and"/"the", and the words of a period (from, FY, months) taken off
      select k1.*, btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(k1.nk,
               '\(\s*p\s*\)', ' pvt ', 'g'), '[(\[{][^()\[\]{}]*[)\]}]', ' ', 'g'), '[^a-z]+', ' ', 'g'),
               '\m([a-z]|pvt|private|ltd|limited|llp|co|company|and|the|fy|from|for|year|st|nd|rd|th|onwards|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\M', ' ', 'g'),
               '\s+', ' ', 'g')) as lk
        from k1),
    mine as (
      select k.nk, min(k.g) as g from k where k.t = 'm'
       group by k.nk having count(distinct k.g) = 1 and bool_and(coalesce(k.g, '') ~ '^[0-9a-z-]{1,100}$'))
    select l.book_id, mine.g from k l join mine on mine.nk = l.nk
     where l.t = 'l' and l.state = 'linked' and l.cg is null
       -- review B2: exactly one linked book of the firm has that cleaned name
       and (select count(*) from k y where y.t = 'l' and y.state = 'linked' and y.nk = mine.nk) = 1
       -- another bridge or beat of the firm names a company of that name with another GUID: two companies, a person chooses
       and not exists (select 1 from k y where y.t in ('r', 'b') and y.nk = mine.nk and coalesce(y.g, '') ~ '^[0-9a-z-]{1,100}$' and y.g <> mine.g)
       -- link-choose's rule: a company of another name that looks alike, anywhere in the firm (its links, its list, any
       -- bridge's record or beat): never filled, a person chooses
       and not exists (select 1 from k y where y.lk = l.lk and y.nk <> l.nk)
       -- review B1: the book's own recorded GUID (110's tally_link_guid prefers it) names another: left
       and not exists (select 1 from tally_sync_cursor s where s.book_id = l.book_id
                        and nullif(lower(btrim(coalesce(s.company_guid, ''))), '') is not null and lower(btrim(s.company_guid)) <> mine.g)
       -- another book of the firm records that GUID as its own: left
       and not exists (select 1 from tally_sync_cursor s where s.firm_id = p_firm and s.book_id <> l.book_id
                        and lower(btrim(coalesce(s.company_guid, ''))) = mine.g)
  loop
    begin
      update tally_links l set company_guid = c.g
       where l.firm_id = p_firm and l.book_id = c.book_id and l.state = 'linked' and l.company_guid is null
         and not exists (select 1 from tally_links x where x.firm_id = p_firm and x.state = 'linked' and lower(btrim(x.company_guid)) = c.g);
      if found then n := n + 1; end if;
    exception when unique_violation then null;     -- another link took that GUID meanwhile: left as it is
    end;
  end loop;
  perform tally_link_guid_pick_mark(p_firm, p_device, p_bridge);   -- 203: two open companies of the name: an owner picks
  return n;
end $function$;
revoke all on function public.tally_link_guid_fill(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_guid_fill(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- 7. the GUID a new link takes (110's tally_link_guid)
-- 110's text; changed: a GUID from the beats only when every beat naming the company gives the same one
create or replace function public.tally_link_guid(p_firm uuid, p_company text, p_book uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(
    (select lower(btrim(s.company_guid)) from tally_sync_cursor s where s.book_id = p_book and lower(btrim(s.company_guid)) ~ '^[0-9a-z-]{1,100}$' limit 1),
    (select case when count(distinct g) = 1 then min(g) end from (
       select lower(btrim(x ->> 'guid')) as g from tally_devices d,
              jsonb_array_elements(case when jsonb_typeof(d.info -> 'beat' -> 'companies') = 'array' then d.info -> 'beat' -> 'companies' else '[]'::jsonb end) x
        where d.firm_id = p_firm and not coalesce(d.revoked, false) and lower(tally_nm(x ->> 'name')) = lower(tally_nm(p_company))) b
      where g ~ '^[0-9a-z-]{1,100}$'))
$function$;
revoke all on function public.tally_link_guid(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.tally_link_guid(uuid, text, uuid) to service_role;

commit;

-- ---------------------------------------------------------------- the column's check validated (its own transaction)
-- a scan that takes no lock a writer waits on; nothing to do when already valid, or when the transaction above did not run
begin;
set local lock_timeout = '3s';
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'tally_post_jobs_company_guid_check' and conrelid = 'public.tally_post_jobs'::regclass and not convalidated) then
    alter table public.tally_post_jobs validate constraint tally_post_jobs_company_guid_check;
  end if;
end $$;
commit;
