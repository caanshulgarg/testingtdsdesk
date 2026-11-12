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
-- Second review of acfb96e8c: the stop flag is cleared whenever the posting leaves waiting / taken / running and when a
-- Retry or a check's re-send brings it back (the version trigger); a posting once taken goes back only to the bridge that
-- took it on its own key too (take: taken_by empty or this bridge; tally_post_reroute, 54's text, no longer moves or fails
-- a posting once taken when its bridge can no longer post - the main bridge switched, changes only, the posts_take
-- refusal's rescue -: it is held for the owner, "Started on <computer>; it can't be moved to another bridge safely. Open
-- it on that computer, or check in Tally and Retry with check-first."; a posting never taken is moved as before);
-- "never taken" for the hold is taken_by and taken_at empty and attempts 0.
-- Third review of 347dcd5c3: a stop-flagged posting its bridge no longer holds is held for checking (done, checking), never
-- back to waiting, and the flag stays while it is so held; a posting its bridge reported on and that bridge can no longer
-- post is held so too; acceptances stamped before the not-main 403 (index.ts); reroute judges a posting once taken by the
-- bridge that took it (taken_by; taken_at or attempts > 0 count as taken: v1 bridges set no taken_by); its words give
-- the real ways forward; Cancel of a posting once taken warns "check Tally first"; the 6-hour words written only when
-- they change and never over the held words, and never tell an owner to cancel or use another computer for a posting
-- once taken; a Retried posting no bridge holds is failed plainly when posting stops; the rescue counts held postings.
-- Fifth review of 9582d4c3f: the take's history backfilled for postings taken before 174 (attempts > 0 also counts as taken
-- in reroute, Cancel and the 6-hour words); Cancel keeps live only the ids of entries that may be in Tally
-- (tally_post_entry_maybe_in), and the register's judge calls such an entry needs_review, never released; a check
-- whose bridge is gone may be answered by another bridge of the firm with the very company (its GUID) open; "I looked in
-- Tally: not there" on a cancelled posting says "released; you can post it again"; an owner's own "I checked in Tally:
-- not there" (tally_post_owner_release: a reason, the name and time kept; "if it is in Tally, it will be posted twice").
-- Replaced (each from its latest text, every line kept but those named): tally_post_take_for (142), tally_post_requeue (36b),
-- tally_post_reroute (54), tally_post_rescue (54), tally_post_cancel (116), tally_post_register_judged (111),
-- tally_post_check_bridge_ok (55), tally_post_check_confirm (55).
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
-- (fourth review PERF) the requeue's scans, every minute: the postings still in the queue only
create index if not exists tally_post_jobs_live_age on public.tally_post_jobs (status, updated_at) where status in ('waiting', 'taken', 'running');
-- (fourth review LOW 1) the take's history: set by every take (tally_post_take_for), never cleared, so a posting a bridge
-- once had stays "once taken" though a Retry clears taken_at and a v1 bridge sets no taken_by. Rows taken before 174 have
-- none: there taken_by / taken_at say it, as before (LOW 3: staging was read: no posting is both Retried after a v1 take
-- and waiting, so none is misjudged)
alter table public.tally_post_jobs add column if not exists first_taken_at timestamptz;
-- (fifth review M1) the history of postings already taken before 174 (safe twice: only where none is kept yet)
update public.tally_post_jobs set first_taken_at = coalesce(taken_at, updated_at, created_at)
 where first_taken_at is null and (taken_at is not null or taken_by is not null or coalesce(attempts, 0) > 0);

-- ---------------------------------------------------------------- 3. the row's version
-- (second review H1) and the stop flag (2b) is cleared whenever the posting leaves waiting / taken / running (failed, done,
-- cancelled: settled by its bridge's last word or a person) and whenever it comes back to them from there (a person's
-- Retry, a check's re-send): a posting stopped once is never skipped for ever by the take, the requeue or the triggers.
-- (third review HIGH 1) Kept while it is held for checking (done + checking): its bridge, if it speaks again, is still
-- told to stop; cleared once an owner settles it (done, failed, cancelled)
create or replace function public.tally_post_jobs_version() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  new.row_version := coalesce(old.row_version, 0) + 1;
  if (new.status not in ('waiting', 'taken', 'running') and not (new.status = 'done' and coalesce(new.checking, false)))
     or (old.status not in ('waiting', 'taken', 'running') and new.status in ('waiting', 'taken', 'running')) then
    new.stop_reason := null; new.stop_at := null;
  end if;
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
-- 'failed' (waiting, never taken and never Retried: no taken_by, taken_at or first_taken_at, attempts 0; fourth review
-- LOW 2), 'stopped' (any other: a Retried one is held by the requeue for checking 10 minutes after the stop: the stop flag; never failed or
-- freed from here), null (may post)
create or replace function public.tally_post_hold_job(p_job uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $function$
declare why text := tally_post_job_blocked(p_job);
begin
  if why is null then return null; end if;
  update tally_post_jobs set status = 'failed', updated_at = now(), message = left(why, 500)
   where id = p_job and status = 'waiting' and taken_by is null and taken_at is null and first_taken_at is null and coalesce(attempts, 0) = 0 and stop_reason is null;
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

-- ---------------------------------------------------------------- 4c. a waiting posting whose bridge can no longer post
-- (second review H2b) 54's tally_post_reroute (the main bridge switched, changes only, the posts_take refusal's rescue, a
-- Retry): its text kept for a posting NEVER taken (moved to the same Windows user's bridge that may post, else stranded);
-- a posting once taken (taken_by or taken_at set, or attempts > 0) is never moved to another bridge nor failed here: ok
-- while the bridge that took it may post, else held for the owner in plain words, state 'stranded' (a Retry is refused
-- with them; tally_post_rescue counts it as held)
create or replace function public.tally_post_reroute(p_id uuid, p_fail boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare j record; nb text; w text;
begin
  select x.id, x.device_id, x.target_bridge, x.company, x.taken_by, x.taken_at, x.attempts, x.first_taken_at, x.status into j from tally_post_jobs x where x.id = p_id;
  if not found then return jsonb_build_object('state', 'none'); end if;
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
  w := tally_post_stranded_words(j.device_id, j.target_bridge);
  if coalesce(p_fail, false) then
    update tally_post_jobs set status = 'failed', taken_at = null, updated_at = now(), message = 'Not posted into ' || j.company || ': ' || w
     where id = p_id and status = 'waiting';
  end if;
  return jsonb_build_object('state', 'stranded', 'words', w);
end $function$;
revoke all on function public.tally_post_reroute(uuid, boolean) from public, anon, authenticated;

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
    if jid is null then return; end if;
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
end $function$;
revoke all on function public.tally_post_take_for(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_take_for(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------- 4. the requeue (36b's, cron tally-post-requeue)
-- 36b's text; changed: a posting its bridge still holds (4b) or one stop-flagged (2b) is left to its bridge; M1's ceiling
-- (2 hours without a report while the bridge beats: back to the same bridge, attempts kept); (third review) HIGH 1: a
-- stop-flagged posting its bridge no longer holds (past the 10 / 30-minute marks, a requeued one 10 minutes after the
-- stop, or 2 hours without a word while it beats) is held for checking (done, checking), never back to waiting; MED 2: a
-- posting its bridge reported on (seq) whose bridge can no longer post is held so too; LOW 5: the words never tell an
-- owner to cancel or use another computer for a posting once taken, and are written only when they change
create or replace function public.tally_post_requeue() returns integer language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare n integer; m integer;
begin
  -- HIGH 1: stopped (2b) and its bridge silent: held for an owner, its ids kept
  update tally_post_jobs set status = 'done', checking = true, updated_at = now(),
         message = left('Stopped: ' || stop_reason || ' Its FinCom Bridge said nothing more of it, so how far it got is not known: held for checking, not posted again. Check in Tally: Mark posted what is there, release the rest (Not in Tally).', 500)
   where stop_reason is not null
     and ((status = 'taken' and coalesce(updated_at, taken_at) < now() - interval '10 minutes' and not tally_post_bridge_holds(id))
       or (status = 'running' and updated_at < now() - interval '30 minutes' and not tally_post_bridge_holds(id))
       or (status = 'waiting' and stop_at < now() - interval '10 minutes')
       or (status in ('taken', 'running') and coalesce(updated_at, taken_at) < now() - interval '2 hours'));
  -- MED 2: reported on by its bridge, which can no longer post (not the main bridge, Changes only, its key revoked): held
  update tally_post_jobs j set status = 'done', checking = true, updated_at = now(),
         message = left('Held: ' || coalesce(nullif(tally_bridge_words(j.device_id, j.taken_by), ''), 'the FinCom Bridge') || ' was posting this and can no longer post (not the main bridge any more, or Changes only); how far it got is not known: held for checking, not sent again. Make it able to post again, or check in Tally: Mark posted what is there, release the rest (Not in Tally).', 500)
   where j.stop_reason is null and j.seq is not null and coalesce(j.taken_by, '') ~ '^go-[0-9a-f]{6,32}$'
     and ((j.status = 'taken' and coalesce(j.updated_at, j.taken_at) < now() - interval '10 minutes') or (j.status = 'running' and j.updated_at < now() - interval '30 minutes'))
     and (not tally_bridge_may_post(j.device_id, j.taken_by) or exists (select 1 from tally_devices d where d.id = j.device_id and coalesce(d.revoked, false)));
  update tally_post_jobs j set status = 'done', checking = true, updated_at = now(),
         message = left('Held: Tally accepted ' || who || ' of this posting but nobody has confirmed it; being checked, not sent again. An owner marks it posted or releases it.', 500)
    from (select id, tally_post_job_accepted(id, results, items) who from tally_post_jobs
           where ((status = 'taken' and coalesce(updated_at, taken_at) < now() - interval '10 minutes') or (status = 'running' and updated_at < now() - interval '30 minutes'))
             and stop_reason is null and not tally_post_bridge_holds(id)) a
   where j.id = a.id and a.who is not null;
  update tally_post_jobs set status = case when attempts >= 5 then 'failed' else 'waiting' end, attempts = attempts + 1, updated_at = now(),
         message = case when attempts >= 5 then 'The Tally computer did not finish this posting after 5 tries; part of it may be in Tally. Check Tally on that computer first: Mark posted what is there, then post the rest again.'
                        else 'Sent to the Tally computer again: it had not answered for a while.' end
   where ((status = 'taken' and coalesce(updated_at, taken_at) < now() - interval '10 minutes')
      or (status = 'running' and updated_at < now() - interval '30 minutes'))
     and tally_post_job_accepted(id, results, items) is null
     and stop_reason is null and not tally_post_bridge_holds(id);
  get diagnostics n = row_count;
  -- M1: held by a bridge that beats but has said nothing of it for 2 hours: back to the SAME bridge (taken_by, taken_at,
  -- attempts kept: 142's pick-up never takes a posting once taken), in words for the owner
  update tally_post_jobs set status = 'waiting', updated_at = now(),
         message = 'No word from the FinCom Bridge on this posting for 2 hours, though the bridge is running: put back for the same bridge (it is never posted from another computer). If it stays so, restart FinCom Bridge on that computer.'
   where status in ('taken', 'running') and coalesce(updated_at, taken_at) < now() - interval '2 hours'
     and stop_reason is null and tally_post_bridge_holds(id) and tally_post_job_accepted(id, results, items) is null;
  get diagnostics m = row_count;
  n := n + m;
  -- 4a: waiting more than 6 hours: the reason, written only when it changes (updated_at not moved); never over a held
  -- posting's words ("Started on ..."); for one never taken: any bridge with the company open; once taken: its own
  update tally_post_jobs set message = w.t
    from (select x.id, left(case when x.taken_by is null and x.taken_at is null and x.first_taken_at is null and coalesce(x.attempts, 0) = 0
             then 'Still waiting after 6 hours (since ' || to_char(coalesce(x.updated_at, x.created_at) at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST): no FinCom Bridge with '
                  || x.company || ' open in Tally has taken it. Open ' || x.company || ' in Tally on a computer with FinCom Bridge, or cancel this posting.'
             else 'Still waiting after 6 hours (since ' || to_char(coalesce(x.updated_at, x.created_at) at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST) for '
                  || coalesce(nullif(tally_bridge_words(x.device_id, coalesce(x.taken_by, x.target_bridge)), ''), 'the FinCom Bridge that started it')
                  || ', which started it (it is never posted from another computer). Open ' || x.company || ' in Tally there.' end, 500) t
            from tally_post_jobs x
           where x.status = 'waiting' and x.stop_reason is null and coalesce(x.updated_at, x.created_at) < now() - interval '6 hours'
             and coalesce(x.message, '') not like 'Started on %') w
   where tally_post_jobs.id = w.id and tally_post_jobs.message is distinct from w.t;
  return n;
end $function$;
revoke all on function public.tally_post_requeue() from public, anon, authenticated;

-- ---------------------------------------------------------------- LOW 8. the rescue's counts (54's text)
-- 54's tally_post_rescue; a posting held by tally_post_reroute (once taken, never moved) is counted as held, not failed
create or replace function public.tally_post_rescue(p_device uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r record; x jsonb; moved int := 0; failed int := 0; held int := 0;
begin
  for r in select j.id from tally_post_jobs j where j.device_id = p_device and j.status = 'waiting' order by j.created_at for update skip locked loop
    x := tally_post_reroute(r.id, true);
    if x ->> 'state' = 'moved' then moved := moved + 1; elsif x ->> 'state' = 'stranded' and coalesce((x ->> 'held')::boolean, false) then held := held + 1; elsif x ->> 'state' = 'stranded' then failed := failed + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'moved', moved, 'failed', failed, 'held', held);
end $function$;
revoke all on function public.tally_post_rescue(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- fifth review H1. may this entry be in Tally?
-- what a posting's own results / items say of one entry (by its FinCom id or entry id): false only when Tally clearly did
-- not take it (a refusal, nothing accepted, nothing sent without an answer) or it was never sent (its item still
-- waiting); nothing said of it: it may be (its bridge had it). Internal
create or replace function public.tally_post_entry_maybe_in(p_results jsonb, p_items jsonb, p_fid text, p_eid text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  with k as (select regexp_replace(coalesce(p_fid, ''), '[^A-Za-z0-9]', '', 'g') kf, regexp_replace(coalesce(p_eid, ''), '[^A-Za-z0-9]', '', 'g') ke),
  r as (select t.r from k, jsonb_array_elements(case when jsonb_typeof(p_results) = 'array' then p_results else '[]'::jsonb end) with ordinality t(r, o)
         where jsonb_typeof(t.r) = 'object' and regexp_replace(coalesce(t.r ->> 'id', ''), '[^A-Za-z0-9]', '', 'g') <> ''
           and regexp_replace(coalesce(t.r ->> 'id', ''), '[^A-Za-z0-9]', '', 'g') in (k.kf, k.ke) order by t.o desc limit 1),
  i as (select t.i from k, jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) t(i)
         where jsonb_typeof(t.i) = 'object' and regexp_replace(coalesce(t.i ->> 'id', ''), '[^A-Za-z0-9]', '', 'g') <> ''
           and regexp_replace(coalesce(t.i ->> 'id', ''), '[^A-Za-z0-9]', '', 'g') in (k.kf, k.ke) limit 1)
  select case
    when exists (select 1 from r) then (select tally_post_result_accepted(r.r) or tally_post_bool(r.r ->> 'ok') or tally_post_bool(r.r ->> 'sent') or tally_post_bool(r.r ->> 'outcomeUnknown')
                                               or tally_post_bool(r.r ->> 'alreadySent') or tally_post_bool(r.r ->> 'held') or coalesce(r.r ->> 'state', '') in ('sending', 'sent', 'in_tally', 'unknown', 'posted', 'needs_review') from r)
    when exists (select 1 from i) then (select case when coalesce(i.i ->> 'state', 'waiting') = 'waiting' then false
                                                    when i.i ->> 'state' in ('failed', 'notfound') then tally_post_accept_text(i.i ->> 'reason') else true end from i)
    else true end
$function$;
revoke all on function public.tally_post_entry_maybe_in(jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.tally_post_entry_maybe_in(jsonb, jsonb, text, text) to service_role;

-- ---------------------------------------------------------------- fifth review H1. the posting register's judge (111's text)
-- 111's tally_post_register_judged; changed: an entry of a posting cancelled after its bridge had it whose id
-- tally_post_cancel kept live (it may be in Tally) is needs_review (settled by a person: Mark posted, or Not in Tally -
-- post again), never released (Post again would be refused by the live id for ever)
create or replace function public.tally_post_register_judged(j public.tally_post_jobs)
returns table (fincom_id text, entry_id text, ord integer, state text, source text, master_id text, id_inferred boolean, words text,
               by_user uuid, at timestamptz, vch_type text, vch_no text, vch_date date, amount numeric)
language sql stable security definer set search_path = public, pg_temp as $judge$
with vs as (
  select tally_fincom_id(t.v) as fid, t.v->>'id' as eid, coalesce(t.v->>'xml', '') as xml, t.o::int as ord
    from jsonb_array_elements(case when jsonb_typeof((j).payload->'vouchers') = 'array' then (j).payload->'vouchers' else '[]'::jsonb end) with ordinality as t(v, o)
   where jsonb_typeof(t.v) = 'object' and tally_fincom_id(t.v) is not null),
v1 as (
  select distinct on (vs.fid) vs.fid, vs.eid, vs.xml, vs.ord, regexp_replace(vs.fid, '[^A-Za-z0-9]', '', 'g') as kf, regexp_replace(coalesce(vs.eid, ''), '[^A-Za-z0-9]', '', 'g') as ke
    from vs order by vs.fid, vs.ord),
rs as (
  select t.r, t.o::int as ord, regexp_replace(t.r->>'id', '[^A-Za-z0-9]', '', 'g') as k,
         (row_number() over (partition by t.r->>'sentAt', t.r->>'batchEnd', t.r->>'batchN' order by t.o))::int - 1 as pos,
         (count(*) over (partition by t.r->>'sentAt', t.r->>'batchEnd', t.r->>'batchN'))::int as gn
    from jsonb_array_elements(case when jsonb_typeof((j).results) = 'array' then (j).results else '[]'::jsonb end) with ordinality as t(r, o)
   where jsonb_typeof(t.r) = 'object' and coalesce(t.r->>'id', '') <> '' and coalesce(t.r->>'kind', '') <> 'master'),
its as (
  select t.i, regexp_replace(t.i->>'id', '[^A-Za-z0-9]', '', 'g') as k
    from jsonb_array_elements(case when jsonb_typeof((j).items) = 'array' then (j).items else '[]'::jsonb end) as t(i)
   where jsonb_typeof(t.i) = 'object' and coalesce(t.i->>'id', '') <> ''),
b as (
  select v1.fid, v1.eid, v1.ord, v1.xml, r.r, r.pos, r.gn, it.i,
         mk.action as mk_action, mk.vch as mk_vch, mk.note as mk_note, mk.by_user as mk_by, mk.at as mk_at,
         pid.accepted_at, pid.released_at, pid.released_by, pid.matched_at, pid.matched_mid, pid.live as pid_live,
         ((j).status in ('waiting', 'taken', 'running') and (jsonb_typeof((j).resend_only) is distinct from 'array' or jsonb_array_length((j).resend_only) = 0
            or (j).resend_only ? coalesce(v1.eid, '') or (j).resend_only ? v1.fid)) as in_scope
    from v1
    left join lateral (select rs.r, rs.pos, rs.gn from rs where rs.k <> '' and (rs.k = v1.kf or rs.k = v1.ke) order by rs.ord desc limit 1) r on true
    left join lateral (select its.i from its where its.k <> '' and (its.k = v1.kf or its.k = v1.ke) limit 1) it on true
    left join lateral (select m.action, m.vch, m.note, m.by_user, m.at from tally_post_marks m
                        where m.job_id = (j).id and regexp_replace(m.entry_id, '[^A-Za-z0-9]', '', 'g') in (v1.kf, v1.ke) order by m.at desc, m.id desc limit 1) mk on true
    left join lateral (select p.accepted_at, p.released_at, p.released_by, p.matched_at, p.matched_mid, p.live from tally_post_ids p
                        where p.job_id = (j).id and p.fincom_id = v1.fid limit 1) pid on true),
c as (
  select b.*,
         (b.r is not null and lower(coalesce(b.r->>'byOwner', '')) in ('true', 't', '1')) or (b.i is not null and lower(coalesce(b.i->>'byOwner', '')) in ('true', 't', '1')) as own,
         case when b.r->>'batchN' ~ '^\d{1,6}$' then (b.r->>'batchN')::int else 0 end as n,
         case when b.r->>'created' ~ '^\d{1,9}$' then (b.r->>'created')::int else 0 end as created,
         case when b.r->>'altered' ~ '^\d{1,9}$' then (b.r->>'altered')::int else 0 end as altered,
         case when b.r->>'errors' ~ '^\d{1,9}$' then (b.r->>'errors')::int else 0 end as errs,
         case when b.r->>'exceptions' ~ '^\d{1,9}$' then (b.r->>'exceptions')::int else 0 end as excs,
         case when jsonb_typeof(b.r->'lineError') = 'array' then (select nullif(string_agg(x.t, '; '), '') from jsonb_array_elements_text(b.r->'lineError') as x(t) where x.t <> '')
              else nullif(b.r->>'lineError', '') end as le,
         coalesce(nullif(b.r->>'batchEnd', ''), nullif(b.r->>'lastVchId', '')) as lv,
         (tally_post_bool(b.r->>'byReply') or tally_post_bool(b.r->>'needsReview')) as has_reply
    from b),
d as (
  select c.*,
         (c.has_reply and c.errs = 0 and c.excs = 0 and c.le is null and c.altered = 0 and c.n >= 1 and c.created = c.n) as clean,
         case when c.r is null then null
              when tally_post_bool(c.r->>'alreadySent') then 'needs_review'                                    -- the bridge's own record: sent before
              when tally_post_bool(c.r->>'refused') and tally_post_bool(c.r->>'postOnly') then 'refused'       -- refused by the bridge, nothing sent
              when c.has_reply and c.errs = 0 and c.excs = 0 and c.le is null and c.altered = 0 and c.n = 1 and c.created = 1 and coalesce(c.lv, '') ~ '^\d+$' then 'in_tally'
              when c.has_reply and c.errs = 0 and c.excs = 0 and c.le is null and c.altered = 0 and c.n > 1 and c.created = c.n then 'in_tally'
              when c.has_reply and c.created = 0 and c.altered = 0 and (c.errs + c.excs > 0 or c.le is not null) then 'refused'
              when c.has_reply then 'needs_review'                                                             -- the proof's rule: never in_tally
              when tally_post_bool(c.r->>'outcomeUnknown') or c.r->>'state' in ('unknown', 'sent') or tally_post_bool(c.r->>'sent') then
                   case when tally_post_bool(c.r->>'ok') and tally_post_bool(c.r->>'verified') then 'in_tally' else 'needs_review' end
              when tally_post_bool(c.r->>'ok') and (tally_post_bool(c.r->>'verified') or c.r->>'state' = 'in_tally' or tally_post_bool(c.r->>'already') or tally_post_bool(c.r->>'alreadyThere')) then 'in_tally'
              when tally_post_bool(c.r->>'ok') then 'needs_review'                                             -- an older bridge: posted, not read back
              when tally_post_bool(c.r->>'already') or coalesce(c.r->>'message', '') ~* '^Already in Tally \(voucher no\.' then 'in_tally'
              when tally_post_result_accepted(c.r) then 'needs_review'                                        -- Tally accepted it, unconfirmed
              else 'refused' end as rstate
    from c),
e as (
  select d.*,
         case
           -- a person's word on this posting (Mark posted, Not in Tally): the mark, unless the bridge reported the entry again since
           when d.own or (d.r is null and d.mk_action is not null and not d.in_scope) then
             case when d.mk_action = 'posted' then 'in_tally' when d.mk_action = 'released' then 'released'
                  when coalesce(d.r->>'state', d.i->>'state') = 'in_tally' then 'in_tally' when coalesce(d.r->>'state', d.i->>'state') = 'notfound' then 'released' else 'needs_review' end
           when d.rstate is not null then d.rstate
           when d.i is not null and d.i->>'state' in ('in_tally', 'posted') then 'in_tally'
           when d.i is not null and d.i->>'state' in ('needs_review', 'unknown') then 'needs_review'
           when d.i is not null and d.i->>'state' in ('failed', 'notfound') then case when tally_post_accept_text(d.i->>'reason') then 'needs_review' else 'refused' end
           when (j).status = 'waiting' then 'queued'
           when (j).status in ('taken', 'running') then 'sent'
           -- (174, fifth review H1) cancelled after its bridge had it, the id kept live (tally_post_cancel): it may be in Tally
           when (j).status = 'cancelled' and coalesce(d.pid_live, false) and d.released_at is null then 'needs_review'
           when (j).status = 'cancelled' and (j).taken_at is null then 'released'
           when (j).status in ('failed', 'cancelled') and (j).taken_at is null then 'refused'
           else 'needs_review' end as s0,
         case when d.own or (d.r is null and d.mk_action is not null and not d.in_scope) then 'owner'
              when d.rstate is not null or (d.i is not null and d.i->>'state' in ('in_tally', 'posted', 'needs_review', 'unknown', 'failed', 'notfound')) then 'reply'
              else 'status' end as src0
    from d),
f as (
  select e.*,
         case when e.in_scope and (j).status = 'waiting' and e.s0 not in ('in_tally', 'needs_review') then 'queued'
              when e.in_scope and (j).status in ('taken', 'running') and e.s0 in ('released', 'queued') then 'sent'
              when e.matched_at is not null and e.s0 in ('needs_review', 'refused', 'sent', 'in_tally') and e.src0 <> 'owner' then 'in_tally'
              when e.accepted_at is not null and e.released_at is null and e.s0 = 'refused' and e.src0 <> 'owner' then 'needs_review'
              when e.released_by = 'owner' and e.released_at is not null and e.mk_action is null and e.src0 <> 'owner' and e.s0 <> 'in_tally' and not e.in_scope then 'released'
              else e.s0 end as st
    from e)
select f.fid, f.eid, f.ord, f.st,
       case when f.in_scope and f.st in ('queued', 'sent') and f.s0 <> f.st then 'status'
            when f.matched_at is not null and f.st = 'in_tally' and f.src0 <> 'owner' then 'recorder'
            when f.src0 = 'owner' and coalesce(f.mk_note, '') like 'Found in % by the FinCom Bridge%' then 'bridge'
            when f.released_by = 'owner' and f.st = 'released' and f.src0 <> 'owner' and f.s0 <> 'released' then 'owner'
            else f.src0 end,
       case when f.st <> 'in_tally' then null
            when f.src0 = 'owner' then coalesce(nullif(btrim(f.mk_vch), ''), nullif(f.r->>'vchNumber', ''))
            when f.matched_at is not null and nullif(f.matched_mid, '') is not null then f.matched_mid
            when f.has_reply and f.n = 1 then coalesce(nullif(f.r->>'vchId', ''), f.lv)
            when f.has_reply and f.n > 1 and f.gn = f.n and coalesce(f.lv, '') ~ '^\d{1,18}$' then (f.lv::bigint - (f.n - 1 - f.pos))::text
            when f.has_reply then null
            else coalesce(nullif(f.r->>'masterId', ''), nullif(f.matched_mid, '')) end,
       (f.st = 'in_tally' and f.src0 = 'reply' and f.has_reply and f.n > 1 and f.matched_at is null),
       case when f.src0 = 'owner' and f.st in ('in_tally', 'released', 'needs_review') then left(coalesce(nullif(f.mk_note, ''), nullif(f.r->>'reason', ''), nullif(f.i->>'reason', '')), 1000)
            when f.st in ('in_tally', 'queued', 'sent') then null
            else left(coalesce(nullif(f.r->>'message', ''), f.le, nullif(f.r->>'reason', ''), nullif(f.i->>'reason', ''),
                               case when f.st = 'released' and f.released_why is not null then f.released_why end, nullif((j).message, '')), 1000) end,
       case when f.src0 = 'owner' then f.mk_by end,
       case when f.src0 = 'owner' then f.mk_at end,
       coalesce(nullif(f.r->>'vchType', ''), nullif(substring(f.xml from '<VOUCHERTYPENAME>([^<]{1,100})</VOUCHERTYPENAME>'), ''), nullif(substring(f.xml from 'VCHTYPE="([^"]{1,100})"'), '')),
       coalesce(nullif(f.r->>'vchNumber', ''), nullif(f.r->>'vchNo', ''), nullif(substring(f.xml from '<VOUCHERNUMBER>([^<]{1,60})</VOUCHERNUMBER>'), '')),
       case when coalesce(nullif(f.r->>'vchDate', ''), substring(f.xml from '<DATE>(\d{8})</DATE>')) ~ '^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$'
            then to_date(coalesce(nullif(f.r->>'vchDate', ''), substring(f.xml from '<DATE>(\d{8})</DATE>')), 'YYYYMMDD') end,
       (select max(abs(m.a[1]::numeric)) from regexp_matches(f.xml, '<AMOUNT>\s*(-?\d{1,15}(?:\.\d{1,4})?)\s*</AMOUNT>', 'g') as m(a))
  from (select f0.*, (select p.released_why from tally_post_ids p where p.job_id = (j).id and p.fincom_id = f0.fid limit 1) as released_why from f f0) f
 order by f.ord
$judge$;
revoke all on function public.tally_post_register_judged(public.tally_post_jobs) from public, anon, authenticated;
grant execute on function public.tally_post_register_judged(public.tally_post_jobs) to service_role;

-- ---------------------------------------------------------------- fifth review M2. the check when the bridge is gone
-- the bridge that took (or is named in) a posting is gone: its key revoked, it may no longer post on it, or not heard
-- from for 7 days (info.bridges[bridge].at). Internal
create or replace function public.tally_post_check_bridge_gone(p_job uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce((select coalesce(d.revoked, false) or not tally_bridge_may_post(d.id, b.b)
                          or not coalesce(case when coalesce(d.info -> 'bridges' -> b.b ->> 'at', '') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d'
                                               then (d.info -> 'bridges' -> b.b ->> 'at')::timestamptz > now() - interval '7 days' end, false)
                     from tally_post_jobs j cross join lateral (select coalesce(j.taken_by, j.target_bridge) b) b
                     left join tally_devices d on d.id = j.device_id
                    where j.id = p_job and b.b is not null), false)
$function$;
revoke all on function public.tally_post_check_bridge_gone(uuid) from public, anon, authenticated;
grant execute on function public.tally_post_check_bridge_gone(uuid) to service_role;

-- 55's tally_post_check_bridge_ok; changed: when that bridge is gone, another bridge of the firm with the very company open
-- (its GUID) may answer the check (it only looks in Tally; the person's confirm still releases)
create or replace function public.tally_post_check_bridge_ok(p_job uuid, p_device uuid, p_bridge text, p_main boolean)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select exists (select 1 from tally_post_jobs j where j.id = p_job and p_device is not null and coalesce(p_bridge, '') <> '' and
           (case when j.taken_by is not null then j.taken_by = p_bridge and (j.device_id = p_device or tally_bridge_device(j.firm_id, p_bridge) is not distinct from p_device)
                when j.target_bridge is not null then j.target_bridge = p_bridge and j.device_id = p_device
                else j.device_id = p_device and coalesce(p_main, false) and tally_bridge_takes_unnamed(p_device, p_bridge) end
         -- (174, fifth review M2) the bridge that took it is gone (its key revoked, it may no longer post, or not heard for 7
         -- days): another bridge of the same firm, bound to its key, that may post and has the very company open now (the
         -- link's GUID known and named in its key's beat): it only looks in Tally; a person still confirms
         or (coalesce(j.taken_by, j.target_bridge) is not null and p_bridge ~ '^go-[0-9a-f]{6,32}$' and p_bridge <> coalesce(j.taken_by, j.target_bridge)
             and tally_post_check_bridge_gone(j.id)
             and tally_bridge_device(j.firm_id, p_bridge) = p_device and tally_bridge_may_post(p_device, p_bridge)
             and exists (select 1 from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
                          join tally_devices d on d.id = p_device and d.firm_id = j.firm_id and not coalesce(d.revoked, false)
                         where l.firm_id = j.firm_id and tc.company = j.company and l.state = 'linked' and nullif(btrim(coalesce(l.company_guid, '')), '') is not null
                           and tally_bridge_serves(p_device, p_bridge, j.company, l.company_guid)
                           and jsonb_typeof(d.info -> 'beat' -> 'companies') = 'array'
                           and exists (select 1 from jsonb_array_elements(d.info -> 'beat' -> 'companies') c where jsonb_typeof(c) = 'object'
                                        and lower(tally_nm(c ->> 'name')) = lower(tally_nm(j.company)) and lower(btrim(coalesce(c ->> 'guid', ''))) = lower(btrim(l.company_guid)))))))
$function$;
revoke all on function public.tally_post_check_bridge_ok(uuid, uuid, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- fifth review L1. "I looked in Tally: not there" (55's text)
-- 55's tally_post_check_confirm; changed: its words for a cancelled posting ("released; you can post it again")
create or replace function public.tally_post_check_confirm(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); v_why text := left(btrim(coalesce(p_why, '')), 500); j tally_post_jobs%rowtype; c tally_post_checks%rowtype; eid text; r jsonb; v_resent boolean := false; said text;
begin
  if f is null or not can_write() then raise exception 'only a member of the firm who may post can confirm this' using errcode = '42501'; end if;
  if v_why = '' then raise exception 'give a reason: where you looked in Tally (kept with your name and the time)'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f for update;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  select v->>'id' into eid from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v where tally_post_id_match(tally_fincom_id(v), v->>'id', p_id) limit 1;
  if eid is null then raise exception 'the entry % is not in this posting', p_id; end if;
  select * into c from tally_post_checks k where k.job_id = p_job and k.entry_id = eid order by k.id desc limit 1 for update;
  if c.id is null or c.state <> 'notseen' then
    return jsonb_build_object('ok', false, 'state', coalesce(c.state, ''), 'error', 'Not sent again: the FinCom Bridge has not reported this entry as not seen in Tally (or that check was closed). Press "Not in Tally - post again" first: the bridge looks in Tally.');
  end if;
  if not tally_post_check_bridge_ok(p_job, c.checked_device, c.checked_bridge, true) then
    return jsonb_build_object('ok', false, 'error', 'Not sent again: the check was not answered by the bridge that posts this posting.');
  end if;
  if exists (select 1 from tally_post_marks m where m.job_id = p_job and m.entry_id = eid and m.action = 'posted' and m.at > c.asked_at) then
    return jsonb_build_object('ok', false, 'error', 'Not sent again: the entry was marked posted after the check was asked.');
  end if;
  r := tally_post_release_core(f, auth.uid(), p_job, eid,
         left(v_why || ' (the FinCom Bridge did not see it in ' || j.company || ' on ' || to_char(c.checked_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST; confirmed by ' || tally_member_name(f, auth.uid()) || ')', 500));
  select * into j from tally_post_jobs where id = p_job;
  update tally_post_jobs set resend_only = case when coalesce(resend_only, '[]'::jsonb) @> jsonb_build_array(eid) then resend_only else coalesce(resend_only, '[]'::jsonb) || jsonb_build_array(eid) end,
         target_bridge = case when c.checked_bridge ~ '^go-[0-9a-f]{6,32}$' then c.checked_bridge else target_bridge end, device_id = coalesce(c.checked_device, device_id)
   where id = p_job;
  if j.status in ('failed', 'done') and not coalesce(j.checking, false) then
    begin
      update tally_post_jobs set status = 'waiting', message = 'Not in Tally (looked by ' || tally_member_name(f, auth.uid()) || '): sent again', taken_at = null, updated_at = now(),
             attempts = coalesce(attempts, 0) + 1 where id = p_job;
      v_resent := true;
    exception when others then
      said := sqlerrm;
    end;
  else
    -- (174, fifth review L1) a cancelled posting is not sent again: the entry is free to post anew
    said := case when j.status = 'cancelled' then 'released; you can post it again' else 'released; it is sent again when the posting''s other entries are settled' end;
  end if;
  update tally_post_checks set state = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now(), confirmed_why = v_why, resent = v_resent where id = c.id;
  return jsonb_build_object('ok', true, 'state', 'confirmed', 'resent', v_resent, 'job', p_job, 'entry', eid, 'check', c.id, 'words', said);
end $function$;
revoke all on function public.tally_post_check_confirm(uuid, text, text) from public, anon;
grant execute on function public.tally_post_check_confirm(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- fifth review M2. the owner's own word
-- "I checked in Tally: not there", an OWNER only, a reason required, kept with the name and the time (tally_post_marks, by
-- tally_post_release_core): the entry's id is released with no check of the bridge (when the bridge that took it is gone
-- and no check can be answered). If the entry is in Tally after all, it will be posted twice: the words say so. Not while
-- the posting is still being sent
create or replace function public.tally_post_owner_release(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); why text := left(btrim(coalesce(p_why, '')), 400); j tally_post_jobs%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true)) then
    raise exception 'only an owner of the firm can say this' using errcode = '42501'; end if;
  if why = '' then raise exception 'say where you looked in Tally (kept with your name and the time)'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f for update;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if j.status in ('waiting', 'taken', 'running') and not coalesce(j.checking, false) then
    return jsonb_build_object('ok', false, 'error', 'This posting is still being sent to Tally; wait for it to finish, then settle the entry.');
  end if;
  return tally_post_release_core(f, auth.uid(), p_job, p_id, left('I checked in Tally: not there (' || why || '). If it is in Tally, it will be posted twice.', 500)) || jsonb_build_object('owner', true);
end $function$;
revoke all on function public.tally_post_owner_release(uuid, text, text) from public, anon;
grant execute on function public.tally_post_owner_release(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- MED 4. Cancel (116's text)
-- 116's tally_post_cancel; a posting once taken (its bridge had it: taken_by, taken_at or first_taken_at) is cancelled with
-- a warning to check Tally first, in its message and in the answer (warn), and its ids kept live until a person settles them
create or replace function public.tally_post_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; started boolean; j tally_post_jobs%rowtype; w text := 'Cancelled after the Tally computer had started it: part of it may be in Tally. Check Tally first; Mark posted what is there before posting it again.';
begin
  if auth.uid() is not null and not can_write() then raise exception 'Only the firm''s owner or staff can cancel a posting to Tally.' using errcode = '42501'; end if;
  select taken_by is not null or taken_at is not null or first_taken_at is not null or coalesce(attempts, 0) > 0 into started from tally_post_jobs where id = p_id and firm_id = my_firm() and status = 'waiting';
  update tally_post_jobs set status = 'cancelled', message = case when coalesce(started, false) then w else 'Cancelled before the Tally computer took it' end, updated_at = now()
   where id = p_id and firm_id = my_firm() and status = 'waiting';
  get diagnostics n = row_count;
  select * into j from tally_post_jobs where id = p_id;
  -- (fourth review) its ids stay live (the cancel freed them: tally_post_ids_sync): a new posting of the same entries is
  -- refused until a person settles them (Mark posted, or Not in Tally: the FinCom Bridge looks first); another posting's
  -- live id is left as it is
  if n > 0 and coalesce(started, false) then
    update tally_post_ids i set live = true
     where i.job_id = p_id and i.released_at is null and not i.live
       and not exists (select 1 from tally_post_ids o where o.firm_id = i.firm_id and o.fincom_id = i.fincom_id and o.job_id <> p_id and o.live)
       -- (fifth review H1) only an entry that may be in Tally; one Tally clearly refused, or never sent, is free as before
       and (i.accepted_at is not null or tally_post_entry_maybe_in(j.results, j.items, i.fincom_id, i.entry_id));
  end if;
  -- (fifth review L3) and the entries that stay with it (its FinCom entry ids)
  return jsonb_build_object('ok', n > 0) || case when n > 0 and coalesce(started, false) then jsonb_build_object('warn', w,
    'entries', (select coalesce(jsonb_agg(i.entry_id order by i.entry_id), '[]'::jsonb) from tally_post_ids i where i.job_id = p_id and i.live)) else '{}'::jsonb end;
end $$;
revoke all on function public.tally_post_cancel(uuid) from public, anon;
grant execute on function public.tally_post_cancel(uuid) to authenticated;

commit;
