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
-- Replaced (each from its latest text, every line kept but those named): tally_post_take_for (142), tally_post_requeue (36b),
-- tally_post_reroute (54), tally_post_rescue (54), tally_post_cancel (116).
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
  if j.taken_by is not null or j.taken_at is not null or j.first_taken_at is not null then
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
    from (select x.id, left(case when x.taken_by is null and x.taken_at is null and x.first_taken_at is null
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

-- ---------------------------------------------------------------- MED 4. Cancel (116's text)
-- 116's tally_post_cancel; a posting once taken (its bridge had it: taken_by, taken_at or first_taken_at) is cancelled with
-- a warning to check Tally first, in its message and in the answer (warn), and its ids kept live until a person settles them
create or replace function public.tally_post_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; started boolean; w text := 'Cancelled after the Tally computer had started it: part of it may be in Tally. Check Tally first; Mark posted what is there before posting it again.';
begin
  if auth.uid() is not null and not can_write() then raise exception 'Only the firm''s owner or staff can cancel a posting to Tally.' using errcode = '42501'; end if;
  select taken_by is not null or taken_at is not null or first_taken_at is not null into started from tally_post_jobs where id = p_id and firm_id = my_firm() and status = 'waiting';
  update tally_post_jobs set status = 'cancelled', message = case when coalesce(started, false) then w else 'Cancelled before the Tally computer took it' end, updated_at = now()
   where id = p_id and firm_id = my_firm() and status = 'waiting';
  get diagnostics n = row_count;
  -- (fourth review) its ids stay live (the cancel freed them: tally_post_ids_sync): a new posting of the same entries is
  -- refused until a person settles them (Mark posted, or Not in Tally: the FinCom Bridge looks first); another posting's
  -- live id is left as it is
  if n > 0 and coalesce(started, false) then
    update tally_post_ids i set live = true
     where i.job_id = p_id and i.released_at is null and not i.live
       and not exists (select 1 from tally_post_ids o where o.firm_id = i.firm_id and o.fincom_id = i.fincom_id and o.job_id <> p_id and o.live);
  end if;
  return jsonb_build_object('ok', n > 0) || case when n > 0 and coalesce(started, false) then jsonb_build_object('warn', w) else '{}'::jsonb end;
end $$;
revoke all on function public.tally_post_cancel(uuid) from public, anon;
grant execute on function public.tally_post_cancel(uuid) to authenticated;

commit;
