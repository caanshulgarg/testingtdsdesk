-- Migration 174 (12-Nov-2026, branch next-fix-post-jobs; written, NOT run: the owner reads it and runs it). The posting
-- queue's state machine (tally_post_jobs), items 2-4 of its review, approved by the owner, reworked after the independent
-- review of ae4949393 (B1, B2, H1, H2, M1, M2, Low). Cloud side only: no bridge change, no new request to Tally; the
-- bridge's rules (a request at most 2 s, one in flight, postings first) untouched.
--
-- The one rule for another computer (B1): a posting is posted by the bridge that took it, and by no other, once it was
-- ever taken. 142's pick-up is kept as it is (tally_post_pickable_ok NOT replaced): another eligible bridge may take a
-- posting only while it was NEVER taken (taken_by and taken_at empty, attempts 0, no re-send list, not checking, no check
-- asked), the bridge it was queued for does not have the company open, and the other has it open and reads the link's
-- data location. A posting put back by the cron keeps taken_by / taken_at and its attempts, so it goes back to the same
-- bridge only. (The owner's "another computer after 15 minutes" is kept only in this form: for postings never taken, at
-- once, as 142 does. For a posting once taken nothing here moves it; the check-first flow of 55 (post_check, resend_only:
-- only entries proven not in Tally sent again) stays the only way an entry is sent twice-safe.)
--
--   2. A posting queued before its client was unlinked, before posting into Tally was stopped, or before its company
--      became the client's earlier years, was still posted.
--      a. tally_post_job_blocked(job): enqueue's own rule read again: the client is linked to that very company (names
--         compared with tally_nm, as enqueue does; tally_links.state 'linked', the same client, the same firm), posting
--         into it is allowed, and it is not the client's earlier-years company (tally_split_links, 161). Null: it may be
--         posted; else the plain reason ("Not posted: posting into Tally was stopped for <client> after this was queued.
--         ..."; a company renamed in Tally since: "... was renamed ...").
--      b. tally_post_hold_job(job) (the row locked by the caller): a WAITING posting never taken (taken_at empty) becomes
--         FAILED with the reason, at once (nothing of it can be in Tally). Any other (taken, running, or waiting after
--         its bridge had it) is NEVER failed or freed from the cloud (H1): stop_reason / stop_at (new columns) are set and
--         the message says why. It is never handed out again (take), never requeued (cron); its bridge's next report is
--         stored and its acceptances stamped, then the bridge is told to stop (posts_update, index.ts): nothing of it
--         sent -> failed with the reason; anything that may be in Tally -> held (done, checking) for an owner.
--         FAILED, not cancelled: cancelled is a person's choice; failed shows the reason with Retry, and Retry
--         (tally_post_enqueue_core) checks the link again: refused while posting stays stopped, the same posting (same id)
--         once it is allowed again.
--      c. tally_post_hold(firm, client): b for every waiting / taken / running posting of that client (the firm's, client
--         null) that may no longer be posted, rows locked in turn. Called by two triggers: the link ends or posting stops
--         (tally_links: linked -> unlinked, posting_allowed true -> false, another client) and a company becomes the
--         client's earlier years (tally_split_links).
--      d. at take time (tally_post_take_for): only the posting about to be handed out is checked (M2: no scan of the
--         firm); one that may no longer be posted is held (b) and the next is looked at.
--   3. posts_update (index.ts) read the posting, did several awaits, and wrote it back guarded only by "not cancelled".
--      tally_post_jobs.row_version (new, bigint, 0) is moved on by every update (a BEFORE UPDATE trigger): the final write
--      is a compare-and-set on the version read; a lost race reads again and merges again (an owner's settlement kept).
--      Acceptances are stamped before every answer, the early ones too (B2); a posting back in the queue its own bridge
--      reports on is taken back by that bridge and the report merged (B2); a posting handed back with a re-send list
--      takes no report of the copy before it (stamped all the same).
--   4a. Waiting more than 6 hours: the message says so, once (not moving updated_at).
--   4b. tally_post_bridge_holds(job): taken or running, reported by its bridge since the take (seq set), that bridge
--      (taken_by, a "go-" id) heard within 3 minutes on the posting's key (info.bridges[taken_by].at, its beat), the key not
--      revoked, the bridge one that may post. Such a posting is not requeued or failed by the cron's 10 / 30-minute rule.
--      M1: the ceiling: no report for 2 hours while its bridge beats (it lost the posting, or its worker hung): put back
--      to waiting for the SAME bridge (taken_by, taken_at, attempts kept: never another computer), with words for the
--      owner (restart FinCom Bridge on that computer, or cancel the posting). Not when Tally took an entry of it that is
--      not confirmed (36b's resend guard: an owner settles those).
--
-- Replaced (each from its latest text, every line kept but those named): tally_post_take_for (142), tally_post_requeue (36b).
-- New: tally_post_job_blocked, tally_post_hold_job, tally_post_hold, tally_post_bridge_holds, and the trigger functions
-- tally_post_jobs_version, tally_post_links_hold, tally_post_split_hold; columns tally_post_jobs.row_version, stop_reason,
-- stop_at; index tally_post_jobs_firm_status (firm_id, status). Nothing dropped or deleted; no row of data changed. Grants
-- explicit: the new helpers service_role only; trigger functions nobody; the replaced ones as before. One transaction,
-- lock_timeout 10 s, safe twice. Runs after 36b, 54, 55, 110, 142, 161.
-- Deploy order: 174, then the tally-ingest of this branch (posts_update reads row_version / stop_reason when they are there;
-- without 174 it writes as before).
-- Tested on pg_stand: tests/run_migration174.py (RED_WITHOUT_174=1 fails); tests/run_post_cas_ingest.py (index.ts).

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- columns, index
alter table public.tally_post_jobs add column if not exists row_version bigint not null default 0;
alter table public.tally_post_jobs add column if not exists stop_reason text;
alter table public.tally_post_jobs add column if not exists stop_at timestamptz;
create index if not exists tally_post_jobs_firm_status on public.tally_post_jobs (firm_id, status);

-- ---------------------------------------------------------------- 3. the row's version
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
    when tc.book_id is null and p.now_to is not null
      then 'Not posted: the Tally company ' || j.company || ' was renamed (or removed) after this was queued; ' || nm || ' now posts to ' || p.now_to || '. Nothing of it was sent to Tally. Post it again to send it there.'
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
  left join lateral (select t.book_id from tally_companies t where t.firm_id = j.firm_id and lower(tally_nm(t.company)) = lower(tally_nm(j.company))
                      order by (t.company = j.company) desc, t.last_seen desc nulls last limit 1) tc on true
  left join tally_links l on l.firm_id = j.firm_id and l.book_id = tc.book_id
  cross join lateral (select tally_link_post_to(j.firm_id, j.client_id, null) now_to) p
  where j.id = p_job
$function$;
revoke all on function public.tally_post_job_blocked(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_job_blocked(uuid) to service_role;

-- ---------------------------------------------------------------- 2b. hold one posting (the caller holds its row lock)
-- 'failed' (waiting, never taken), 'stopped' (any other: the stop flag; never failed or freed from here), null (may post)
create or replace function public.tally_post_hold_job(p_job uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $function$
declare why text := tally_post_job_blocked(p_job);
begin
  if why is null then return null; end if;
  update tally_post_jobs set status = 'failed', updated_at = now(), message = left(why, 500)
   where id = p_job and status = 'waiting' and taken_at is null and stop_reason is null;
  if found then return 'failed'; end if;
  -- (the bridge may have sent some of it already: the words do not say "nothing was sent")
  why := replace(why, ' Nothing of it was sent to Tally.', '');
  update tally_post_jobs set stop_reason = left(why, 400), stop_at = now(),
         message = left(why || ' The FinCom Bridge that has it is told to stop at its next word; nothing more of it is handed out.', 500)
   where id = p_job and status in ('waiting', 'taken', 'running') and stop_reason is null;
  if found then return 'stopped'; end if;
  return null;
end $function$;
revoke all on function public.tally_post_hold_job(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_hold_job(uuid) to service_role;

-- ---------------------------------------------------------------- 2c. hold a client's postings (the triggers)
create or replace function public.tally_post_hold(p_firm uuid, p_client text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare r record; n integer := 0;
begin
  for r in select j.id from tally_post_jobs j
            where j.firm_id = p_firm and (p_client is null or j.client_id = p_client) and j.status in ('waiting', 'taken', 'running') and j.stop_reason is null
            order by j.created_at loop
    if tally_post_job_blocked(r.id) is null then continue; end if;
    perform 1 from tally_post_jobs where id = r.id for update;
    if tally_post_hold_job(r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $function$;
revoke all on function public.tally_post_hold(uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_hold(uuid, text) to service_role;

create or replace function public.tally_post_links_hold() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if old.state = 'linked' and old.client_id is not null
     and (new.state <> 'linked' or not new.posting_allowed or new.client_id is distinct from old.client_id) then
    perform tally_post_hold(old.firm_id, old.client_id);
  end if;
  return null;
end $function$;
revoke all on function public.tally_post_links_hold() from public, anon, authenticated;
create or replace function public.tally_post_split_hold() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if new.state = 'linked' and new.client_id is not null then
    perform tally_post_hold(new.firm_id, new.client_id);
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

-- ---------------------------------------------------------------- 2d. the hand-out, per bridge (142's, with the rule)
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
     order by j.created_at limit 1 for update skip locked;
    exit when jid is null;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', taken_at = now(), updated_at = now(), seq = null, message = 'Taken by the Tally computer',
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
    if jid is null then return; end if;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', taken_at = now(), updated_at = now(), seq = null, device_id = p_device, target_bridge = p_bridge, taken_by = p_bridge,
             message = left('Taken by the FinCom Bridge that has ' || company || ' open now (the one it was queued for did not have it open)', 300)
       where id = jid and status = 'waiting' and taken_by is null and taken_at is null
      returning *;
      return;
    end if;
    perform tally_post_hold_job(jid);
  end loop;
end $function$;
revoke all on function public.tally_post_take_for(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_take_for(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------- 4. the requeue (36b's, cron tally-post-requeue)
-- 36b's text; changed: a posting its bridge still holds (4b) or one stop-flagged (2b) is left to its bridge; M1's ceiling
-- (2 hours without a report while the bridge beats: back to the same bridge, attempts kept); waiting 6 hours: said once
create or replace function public.tally_post_requeue() returns integer language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare n integer; m integer;
begin
  update tally_post_jobs j set status = 'done', checking = true, updated_at = now(),
         message = left('Held: Tally accepted ' || who || ' of this posting but nobody has confirmed it; being checked, not sent again. An owner marks it posted or releases it.', 500)
    from (select id, tally_post_job_accepted(id, results, items) who from tally_post_jobs
           where ((status = 'taken' and coalesce(updated_at, taken_at) < now() - interval '10 minutes') or (status = 'running' and updated_at < now() - interval '30 minutes'))
             and stop_reason is null and not tally_post_bridge_holds(id)) a
   where j.id = a.id and a.who is not null;
  update tally_post_jobs set status = case when attempts >= 5 then 'failed' else 'waiting' end, attempts = attempts + 1, updated_at = now(),
         message = case when attempts >= 5 then 'The Tally computer did not finish this posting after 5 tries. Check Tally on that computer, then post again.'
                        else 'Sent to the Tally computer again: it had not answered for a while.' end
   where ((status = 'taken' and coalesce(updated_at, taken_at) < now() - interval '10 minutes')
      or (status = 'running' and updated_at < now() - interval '30 minutes'))
     and tally_post_job_accepted(id, results, items) is null
     and stop_reason is null and not tally_post_bridge_holds(id);
  get diagnostics n = row_count;
  -- M1: held by a bridge that beats but has said nothing of it for 2 hours: back to the SAME bridge (taken_by, taken_at,
  -- attempts kept: 142's pick-up never takes a posting once taken), in words for the owner
  update tally_post_jobs set status = 'waiting', updated_at = now(),
         message = 'No word from the FinCom Bridge on this posting for 2 hours, though the bridge is running: put back for the same bridge (never another computer). If it stays so, restart FinCom Bridge on that computer, or cancel this posting.'
   where status in ('taken', 'running') and coalesce(updated_at, taken_at) < now() - interval '2 hours'
     and stop_reason is null and tally_post_bridge_holds(id) and tally_post_job_accepted(id, results, items) is null;
  get diagnostics m = row_count;
  n := n + m;
  -- 4a: waiting more than 6 hours: the reason, once (updated_at not moved)
  update tally_post_jobs set message = left('Still waiting after 6 hours (since ' || to_char(coalesce(updated_at, created_at) at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST): no FinCom Bridge with '
           || company || ' open in Tally has taken it. Open ' || company || ' in Tally on a computer with FinCom Bridge, or cancel this posting.', 500)
   where status = 'waiting' and stop_reason is null and coalesce(updated_at, created_at) < now() - interval '6 hours' and coalesce(message, '') not like 'Still waiting after 6 hours%';
  return n;
end $function$;
revoke all on function public.tally_post_requeue() from public, anon, authenticated;

commit;
