-- Migration 174 (12-Nov-2026, branch next-fix-post-jobs; written, NOT run: the owner reads it and runs it). The posting
-- queue's state machine (tally_post_jobs), items 2-4 of its review, approved by the owner. Cloud side only: no bridge
-- change, no new request to Tally; the bridge's rules (a request at most 2 s, one in flight, postings first) untouched.
--
--   2. A posting queued before its client was unlinked, or before posting into Tally was stopped, was still handed out and
--      posted. Now:
--      a. tally_post_job_blocked(job): enqueue's own rule, read again for a queued posting: the client is linked to that
--         very company (tally_links.state 'linked', the same client, the same firm), posting into it is allowed
--         (posting_allowed), and the company is not the client's earlier-years company (tally_split_links, 161). Null when
--         it may be posted; else the plain reason ("Not posted: posting into Tally was stopped for <client> after this
--         was queued. ...").
--      b. tally_post_hold(firm, client, skip_locked): every WAITING posting of the firm (of that client, when named) that
--         may no longer be posted, and every TAKEN one nothing of which reached Tally yet (no result, every item still
--         waiting, no id Tally accepted, not being checked), is moved to FAILED with that reason. Never posted.
--         FAILED, not cancelled: cancelled is a person's choice in FinCom; failed shows the reason with Retry, and Retry
--         (tally_post_enqueue_core) checks the link again, so it is refused while posting stays stopped and posts the
--         same posting (same id) once the owner allows it again. Both stop the bridge's own copy on its next report
--         (posts_update answers a failed posting "settled, cancelled", next-fix-first-read). A taken posting part of
--         which was sent is left to finish (failing it would free ids that may be in Tally).
--      c. at take time (tally_post_take_for): those postings of the bridge's firm are held first (skip locked), and a
--         posting is handed out only when tally_post_job_blocked says it may be posted and the bridge's computer is of
--         the posting's firm.
--      d. when the link ends or posting is stopped (a trigger on tally_links: linked -> unlinked, posting_allowed
--         true -> false, or another client) and when a company becomes a client's earlier-years company (a trigger on
--         tally_split_links), that client's postings are held at once (b, waiting for row locks).
--   3. posts_update (tally-ingest) read the posting, did several awaits, and wrote it back guarded only by "not
--      cancelled": an owner's settlement or the cron's requeue in between was written over. tally_post_jobs.row_version
--      (new, bigint, 0) is moved on by every update (a BEFORE UPDATE trigger), so posts_update's final write is a
--      compare-and-set on the version it read; a lost race reads the posting again and merges again (index.ts).
--   4a. A posting requeued by the cron kept taken_by / taken_at, so no other bridge could ever pick it up (142's
--      pick-up needs a posting never taken). tally_post_requeue now clears taken_by and taken_at when it puts a posting
--      back to waiting, and tally_post_pickable_ok lets another eligible bridge (every rule of 142 kept: a "go-" bridge
--      bound to its key, that may post through its own key - the main bridge of its Windows user, not changes only -,
--      with the company open now, reading the link's data location, while the bridge it was queued for does not have it
--      open) take a posting the cron put back that has waited 15 minutes since (updated_at). A person's Retry keeps
--      taken_by (enqueue_core: never moved to another computer key) and is not picked up so. A posting waiting more than
--      6 hours says so in its message (the reason the app shows), once.
--   4b. The bridge reports a posting waiting for Tally on its own computer as "taken" and sends no report while nothing
--      changes, so the requeue (taken 10 minutes, running 30 minutes, without an update) put such postings back and
--      failed them after 5 rounds while the bridge still held them. tally_post_bridge_holds(job): the posting is taken or
--      running, its bridge reported it since taking it (seq is set by the bridge's posts_update; the take clears it), and
--      that bridge (taken_by, a "go-" id) is heard now on the posting's key (info.bridges[taken_by].at within 3 minutes,
--      the beat the bridge sends every minute; the key not revoked, the bridge still one that may post). Such a posting
--      is not requeued, held or failed by the cron; after 6 hours its message says it is still with the bridge.
--
-- Replaced (each from its latest text, migration 142 / 36b, every line kept but the ones named): tally_post_take_for (142),
-- tally_post_pickable_ok (142), tally_post_requeue (36b). New: tally_post_job_blocked, tally_post_hold,
-- tally_post_bridge_holds, tally_post_jobs_version, tally_post_links_hold, tally_post_split_hold (and their triggers);
-- one column (tally_post_jobs.row_version). Nothing dropped or deleted. Grants explicit: the new helpers service_role only;
-- the trigger functions nobody; the replaced ones as before. One transaction, lock_timeout 10 s, safe twice.
-- Runs after 36b, 54, 55, 110, 142, 161.
-- Deploy order: 174, then the tally-ingest of this branch (posts_update reads row_version when it is there; without 174 it
-- writes as before).
-- Tested on pg_stand: tests/run_migration174.py (RED_WITHOUT_174=1 fails); tests/run_post_cas_ingest.py (index.ts).

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 3. the row's version
alter table public.tally_post_jobs add column if not exists row_version bigint not null default 0;
create or replace function public.tally_post_jobs_version() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  new.row_version := coalesce(old.row_version, 0) + 1;
  return new;
end $function$;
revoke all on function public.tally_post_jobs_version() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_jobs_version' and tgrelid = 'public.tally_post_jobs'::regclass) then
    create trigger tally_post_jobs_version before update on public.tally_post_jobs for each row execute function public.tally_post_jobs_version();
  end if;
end $$;

-- ---------------------------------------------------------------- 2a. may this queued posting still be posted?
create or replace function public.tally_post_job_blocked(p_job uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select case
    when tc.book_id is null
      then 'Not posted: ' || j.company || ' is no longer a Tally company of ' || nm || ' in FinCom (renamed or removed after this was queued). Nothing of it was sent to Tally.'
    when l.book_id is null or l.state <> 'linked' or l.client_id is distinct from j.client_id
      then 'Not posted: ' || nm || ' was unlinked from ' || j.company || ' in Tally after this was queued. Nothing of it was sent to Tally. Link it again on the Tally page, then post again.'
    when exists (select 1 from tally_split_links x where x.firm_id = j.firm_id and x.book_id = tc.book_id and x.client_id = j.client_id and x.state = 'linked')
      then 'Not posted: ' || j.company || ' is now the earlier-years company of ' || nm || ' in Tally; postings go to its current company only. Nothing of it was sent to Tally.'
    when not l.posting_allowed
      then 'Not posted: posting into Tally was stopped for ' || nm || ' after this was queued. Nothing of it was sent to Tally. Allow it on the Tally page (the company''s ⋯ Post entries here), then post again.'
  end
  from tally_post_jobs j
  cross join lateral (select coalesce((select cl.name from clients cl where cl.firm_id = j.firm_id and cl.id = j.client_id), 'this client') nm) c
  left join tally_companies tc on tc.firm_id = j.firm_id and tc.company = j.company
  left join tally_links l on l.firm_id = j.firm_id and l.book_id = tc.book_id
  where j.id = p_job
$function$;
revoke all on function public.tally_post_job_blocked(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_job_blocked(uuid) to service_role;

-- ---------------------------------------------------------------- 2b. hold what may no longer be posted
-- waiting, or taken with nothing of it in Tally yet; failed with the reason (never posted). p_client null: the whole firm
create or replace function public.tally_post_hold(p_firm uuid, p_client text, p_skip_locked boolean)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare r record; why text; n integer := 0;
begin
  for r in select j.id, j.status from tally_post_jobs j
            where j.firm_id = p_firm and (p_client is null or j.client_id = p_client) and j.status in ('waiting', 'taken')
            order by j.created_at loop
    if tally_post_job_blocked(r.id) is null then continue; end if;
    -- the row's lock, then the rule again: the take's own hold never waits for another take (skip); the link's change
    -- waits for it
    if coalesce(p_skip_locked, false) then
      perform 1 from tally_post_jobs where id = r.id for update skip locked;
      if not found then continue; end if;
    else
      perform 1 from tally_post_jobs where id = r.id for update;
    end if;
    why := tally_post_job_blocked(r.id);
    if why is null then continue; end if;
    update tally_post_jobs j set status = 'failed', updated_at = now(),
           message = left(why || case when j.status = 'taken' then ' The FinCom Bridge that took it stops it.' else '' end, 500)
     where j.id = r.id and (j.status = 'waiting'
        or (j.status = 'taken' and not coalesce(j.checking, false)
            and coalesce(jsonb_array_length(case when jsonb_typeof(j.results) = 'array' then j.results end), 0) = 0
            and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(j.items) = 'array' then j.items else '[]'::jsonb end) x
                             where coalesce(x ->> 'state', 'waiting') <> 'waiting')
            and not exists (select 1 from tally_post_ids i where i.job_id = j.id and i.accepted_at is not null)));
    if found then n := n + 1; end if;
  end loop;
  return n;
end $function$;
revoke all on function public.tally_post_hold(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_hold(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------- 2d. the link ends, posting stops, earlier years
create or replace function public.tally_post_links_hold() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if old.state = 'linked' and old.client_id is not null
     and (new.state <> 'linked' or not new.posting_allowed or new.client_id is distinct from old.client_id) then
    perform tally_post_hold(old.firm_id, old.client_id, false);
  end if;
  return null;
end $function$;
revoke all on function public.tally_post_links_hold() from public, anon, authenticated;
create or replace function public.tally_post_split_hold() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if new.state = 'linked' and new.client_id is not null then
    perform tally_post_hold(new.firm_id, new.client_id, false);
  end if;
  return null;
end $function$;
revoke all on function public.tally_post_split_hold() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_links_hold' and tgrelid = 'public.tally_links'::regclass) then
    create trigger tally_post_links_hold after update of state, posting_allowed, client_id on public.tally_links for each row execute function public.tally_post_links_hold();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_split_hold' and tgrelid = 'public.tally_split_links'::regclass) then
    create trigger tally_post_split_hold after insert or update of state, client_id, book_id on public.tally_split_links for each row execute function public.tally_post_split_hold();
  end if;
end $$;

-- ---------------------------------------------------------------- 4b. the bridge still holds it
create or replace function public.tally_post_bridge_holds(p_job uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((
    select j.status in ('taken', 'running') and j.seq is not null and coalesce(j.taken_by, '') ~ '^go-[0-9a-f]{6,32}$'
       and not coalesce(d.revoked, false)
       and coalesce(case when coalesce(d.info -> 'bridges' -> j.taken_by ->> 'at', '') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d'
                         then (d.info -> 'bridges' -> j.taken_by ->> 'at')::timestamptz > now() - interval '3 minutes' end, false)
       and tally_bridge_may_post(d.id, j.taken_by)
      from tally_post_jobs j join tally_devices d on d.id = j.device_id where j.id = p_job), false)
$function$;
revoke all on function public.tally_post_bridge_holds(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_bridge_holds(uuid) to service_role;

-- ---------------------------------------------------------------- 4a. a waiting posting another bridge may take
-- 142's text; one clause changed: never taken, OR put back by the cron (taken_by and taken_at cleared, 4a) 15 minutes ago
create or replace function public.tally_post_pickable_ok(p_job uuid, p_device uuid, p_bridge text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((
    select j.status = 'waiting' and j.taken_by is null and j.taken_at is null and (coalesce(j.attempts, 0) = 0 or j.updated_at < now() - interval '15 minutes') and j.resend_only is null
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

-- ---------------------------------------------------------------- 2c. the hand-out, per bridge (142's, with the rule)
create or replace function public.tally_post_take_for(p_device uuid, p_bridge text, p_main boolean)
returns setof public.tally_post_jobs language plpgsql security definer set search_path = public, pg_temp as $function$
declare jid uuid; fm uuid;
begin
  -- 174 (2c): the firm's postings that may no longer be posted (unlinked, posting stopped, earlier years) are held first
  select d.firm_id into fm from tally_devices d where d.id = p_device;
  if fm is not null then perform tally_post_hold(fm, null, true); end if;
  -- 54's text: the bridge's own postings first (4a.: a go- bridge only for a company its own beat has open)
  return query
  update tally_post_jobs set status = 'taken', taken_at = now(), updated_at = now(), seq = null, message = 'Taken by the Tally computer',
         taken_by = case when p_bridge ~ '^go-[0-9a-f]{6,32}$' then p_bridge else taken_by end   -- final review M1: the bridge that took it
   where id = (select j.id from tally_post_jobs j
                where j.device_id = p_device and j.status = 'waiting' and tally_post_mine_ok(j.id, p_device, p_bridge, p_main)
                  and j.firm_id = fm and tally_post_job_blocked(j.id) is null
                order by j.created_at limit 1 for update skip locked)
  returning *;
  if found then return; end if;
  -- 142: a posting of the firm never taken, whose bridge does not have the company open now while this one does
  select j.id into jid from tally_post_jobs j join tally_devices me on me.id = p_device
   where j.firm_id = me.firm_id and j.status = 'waiting' and j.taken_by is null and tally_post_pickable_ok(j.id, p_device, p_bridge)
     and tally_post_job_blocked(j.id) is null
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

-- ---------------------------------------------------------------- 4. the requeue (36b's, cron tally-post-requeue)
-- 36b's text; changed: a posting its bridge still holds (4b) is left alone; put back to waiting, taken_by and taken_at are
-- cleared (4a); a posting waiting (or held by its bridge) for more than 6 hours says so, once (not moving updated_at)
create or replace function public.tally_post_requeue() returns integer language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare n integer;
begin
  update tally_post_jobs j set status = 'done', checking = true, updated_at = now(),
         message = left('Held: Tally accepted ' || who || ' of this posting but nobody has confirmed it; being checked, not sent again. An owner marks it posted or releases it.', 500)
    from (select id, tally_post_job_accepted(id, results, items) who from tally_post_jobs
           where ((status = 'taken' and coalesce(updated_at, taken_at) < now() - interval '10 minutes') or (status = 'running' and updated_at < now() - interval '30 minutes'))
             and not tally_post_bridge_holds(id)) a
   where j.id = a.id and a.who is not null;
  update tally_post_jobs set status = case when attempts >= 5 then 'failed' else 'waiting' end, attempts = attempts + 1, updated_at = now(),
         taken_by = case when attempts >= 5 then taken_by end, taken_at = case when attempts >= 5 then taken_at end,
         message = case when attempts >= 5 then 'The Tally computer did not finish this posting after 5 tries. Check Tally on that computer, then post again.'
                        else 'Sent to the Tally computer again: it had not answered for a while.' end
   where ((status = 'taken' and coalesce(updated_at, taken_at) < now() - interval '10 minutes')
      or (status = 'running' and updated_at < now() - interval '30 minutes'))
     and tally_post_job_accepted(id, results, items) is null
     and not tally_post_bridge_holds(id);
  get diagnostics n = row_count;
  -- 4a: waiting more than 6 hours: the reason, once
  update tally_post_jobs set message = left('Still waiting after 6 hours (since ' || to_char(coalesce(updated_at, created_at) at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST): no FinCom Bridge with '
           || company || ' open in Tally has taken it. Open ' || company || ' in Tally on a computer with FinCom Bridge, or cancel this posting.', 500)
   where status = 'waiting' and coalesce(updated_at, created_at) < now() - interval '6 hours' and coalesce(message, '') not like 'Still waiting after 6 hours%';
  -- 4b: still with its bridge (waiting for Tally there) more than 6 hours: said once, before the bridge's own words
  update tally_post_jobs set message = left('Still with the FinCom Bridge after 6 hours: ' || coalesce(nullif(message, ''), 'waiting for Tally on that computer'), 500)
   where status in ('taken', 'running') and coalesce(updated_at, taken_at) < now() - interval '6 hours'
     and coalesce(message, '') not like 'Still with the FinCom Bridge after 6 hours%' and tally_post_bridge_holds(id);
  return n;
end $function$;
revoke all on function public.tally_post_requeue() from public, anon, authenticated;

commit;
