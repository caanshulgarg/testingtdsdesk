-- Migration 47 (04-Oct-2026, round 20 part c: the cloud side of the live recorder; docs/cloud-recorder-plan.md). Runs AFTER 46
-- (fresh database: ... -> 45 -> 46 -> 47; staging: after 46; docs/MIGRATION-ORDER.md). Add-only (tables and columns added if
-- missing, a queue and a bucket made if missing, functions created or replaced, cron jobs scheduled by name; the one CHECK on
-- tally_jobs.kind widened in place, below; nothing removed), safe to run twice. It holds no statement that removes rows.
-- Shown to the owner before it runs; run by Claude after its review, with the md5 of every function body.
--
--   1. THE RECORDER QUEUE (docs/cloud-recorder-plan.md 1). A burst of full recorder lines (more than 50 with an entry body in
--      one request) is not applied while the bridge waits: tally-ingest puts the request's cleaned lines on the pgmq queue
--      tally_recorder as ONE message and answers {queued: n} at once.
--        tally_recorder_enqueue(p_firm, p_book, p_device, p_lines) returns jsonb {ok, msg, queued}: the service role's; the
--          book of the firm, the computer of the firm (or none), the lines a list of 1..1000 objects; else an error with words.
--        tally_recorder_drain(p_budget_ms) returns jsonb {ok, done, retried, failed, lines}: the service role's (and pg_cron's,
--          which runs it as the owner). One message at a time, oldest first: tally_recorder_apply (44/45's, unchanged) with the
--          message's firm, book, computer and lines, then pgmq.archive (kept, never removed). A message whose apply raises
--          (no such book, the computer moved firm, a lock timeout ...) is left for its visibility time (120 s) and read again;
--          its 5th failure (pgmq's read_ct) is archived and kept in tally_recorder_failures with the words (one row per
--          message: firm, book, computer, msg_id, tries, lines, line_ids, why, at). The budget (ms, at most 25 s) stops it
--          taking a new message; each message runs in its own savepoint, so a failure undoes that message only.
--        pg_cron 'tally-recorder-drain' every 30 seconds: select public.tally_recorder_drain(15000) - the SQL directly, no
--          HTTP hop.
--   2. ALERTS (docs/cloud-recorder-plan.md 2). tally_alerts (id, firm_id, client_id, book_id, device_id, kind gap | silent |
--      summary, day (India's date), words, data, at, read_at, read_by); one row per firm, kind, book (or none), computer (or
--      none) and day (a unique index on those expressions); RLS: the firm reads; nobody writes directly.
--        tally_alert_scan_gaps(): each book whose tally_sync_cursor.gap is set (tally_recorder_gap_check, 44/45) -> the day's
--          'gap' alert for that book, its words "<company>: up to N changes not received since ...", the gap as data; the same
--          gap again changes nothing; a gap that GREW is written in place and shown unread again.
--        tally_alert_scan_silent(): inside Mon-Sat 09:00-19:00 IST only (tally_alert_working_now; outside it answers skipped),
--          tally_recorder_silent (44) for each firm with a live computer -> the day's 'silent' alert per computer.
--        tally_alert_daily_summary(): per firm with a book, the day's 'summary': the recorder lines received today (applied,
--          held, failed, duplicate, stale), the queued sends that failed today, the open gaps, the postings today (done,
--          failed) and the entries their results say need review.
--        THE RULE (owner, 04-Oct): each job reads, and writes alert rows only (tests/run_migration47.py hashes every other table
--          before and after each job). They are granted to nobody: pg_cron runs them as the owner.
--        tally_alert_read(p_id): an active member of the alert's firm marks it read (the first reader and time kept); anyone
--          else: 'not an alert of your firm'.
--        pg_cron: 'tally-alert-gaps' every 10 minutes; 'tally-alert-silent' '*/30 3-13 * * 1-6' (UTC: 03:00 to 13:30 UTC is
--          08:30 to 19:00 IST, Monday to Saturday; the 08:30 IST run is skipped by tally_alert_working_now, so the alerts are
--          09:00 to 19:00 IST exactly); 'tally-alert-summary' '30 13 * * *' (13:30 UTC = 19:00 IST, every day).
--   3. THE RECORDER SOURCE PER COMPUTER. tally_devices.recorder_source text not null default 'addon' check in ('addon',
--      'alterid', 'both') (+ recorder_source_at, recorder_source_by; readable by the firm); the owner's
--      tally_device_recorder_source(p_device, p_source) (the owner check of tally_device_trial_tools, 46). tally-ingest's beat
--      answers recorderSource from it.
--   4. A LEDGER RENAME SEEN BY GUID. tally_recorder_line is 45's text with one addition: a ledger_altered line whose GUID the
--      copy holds (live) under another name than the line's is a rename: tally_ledger_rename(book, guid, old, new), as
--      ledger_renamed is (a release never makes it; a refusal or roll-back is held with its words). Anything else of
--      ledger_created / ledger_altered is held for the next ledger list as before.
--   5. LARGE DAY BOOK UPLOADS (docs/cloud-recorder-plan.md 3). Storage bucket 'tally-uploads': private, 2 GB per file. Members
--      of a firm add and read objects under '<firm id>/' only; no update or delete policy (tally-ingest reads them with the
--      service role). tally_jobs takes kind 'upload', and tally_jobs.upload jsonb (added; null on every other job) keeps the
--      stored file's path, the period (from, to: yyyymmdd), its size and name for the worker (upload_done carries only the job).
--      THE CHECK ON tally_jobs.kind: a CHECK constraint cannot be widened by adding another (constraints are ANDed), so the
--      add-only-safe way is to swap it in ONE ALTER TABLE statement (atomic: there is no moment without a check) for the
--      same name with one more allowed value. It is widening only: every row that passed the old check passes the new one, so
--      nothing can be refused or lost. It runs only while the check in force lacks 'upload' (a second run changes nothing).
--      This is the only constraint statement in the file.
--   6. ROUND 21 (docs/reviews/migration-47-48-review.md; tests/run_migration47.py, against the real pgmq 1.5.1 when it can be
--      installed): H1 the book's order: tally_recorder_send(firm, book, device, lines, queue) is tally-ingest's one call for
--      recorder lines: it queues them when asked (a burst) OR while the book has a queued message not yet applied or failed
--      (tally_recorder_pending, one row per message: written by enqueue, marked done / failed by the drain; an indexed look-up,
--      never a scan of the queue), else applies them directly; the drain takes a book's messages in order (a later one waits
--      its turn, which is not a try) and, when a message fails for good, writes its lines into tally_recorder_lines as
--      'failed' with words, writes a 'gap' alert for the book at once, and the gap check (tally_recorder_gap_check, 45's text
--      + one addition) counts those lines as not received until a later line or a day read brings them. M1 every try counted
--      BEFORE the apply: pg_cron calls the procedure tally_recorder_drain_run, which commits after each read and each message
--      (a cancel or a timeout cannot undo the count), each message in its own subtransaction under its own lock timeout
--      (within the budget); a cancel is caught and counted; the 5th try archives it with words. M2-M5 are tally-ingest's
--      (index.ts); M3's guard is tally_upload_advance (an upload piece's days and next piece queued once, in one
--      transaction, keyed by the job's cursor; the late days added to the total once). M6 the queue's tables closed to anon
--      and authenticated (revoke all, RLS on); their retention is migration 48's (this file removes no row). M7 the kind
--      CHECK swapped only when its text is exactly migration 13's, else the file stops with words. M8 a ledger_altered
--      rename only above the AlterID last seen for that ledger (tally_ledgers.alter_id, added), never a merge. L5 plain words
--      for a failed send (the raw error to the server's log only). L6 no JWT passes only for the owner's own logins. L7 each
--      firm in its own block in every alert job. L8 revoke all, then select (PG17's MAINTAIN goes with all).
--   Every function here: security definer, search_path = public, pg_temp (but the pg_cron procedure tally_recorder_drain_run:
--   PostgreSQL refuses COMMIT in a security definer procedure or one with SET, so it is security invoker without SET, every
--   name in it public.-qualified, and executable by nobody but the owner). The service role's revoked from public, anon and
--   authenticated; the members' granted to authenticated (the checks inside); the jobs and the internal line granted to
--   nobody. Every new table: RLS on, a read-only firm_id = my_firm() select policy; anon nothing; authenticated select only.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- ---------------------------------------------------------------- A. tables, columns, the queue, the bucket
create table if not exists public.tally_alerts (
  id         bigserial primary key,
  firm_id    uuid not null,
  client_id  text,
  book_id    uuid references public.tally_books(book_id) on delete restrict,
  device_id  uuid,
  kind       text not null check (kind in ('gap', 'silent', 'summary')),
  day        date not null,                                   -- India's date
  words      text not null default '',
  data       jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now(),
  read_at    timestamptz,
  read_by    uuid
);
create unique index if not exists tally_alerts_once on public.tally_alerts (firm_id, kind, (coalesce(book_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  (coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)), day);
create index if not exists tally_alerts_firm on public.tally_alerts (firm_id, at desc);

create table if not exists public.tally_recorder_failures (
  id         bigserial primary key,
  firm_id    uuid,
  book_id    uuid,
  device_id  uuid,
  msg_id     bigint not null unique,                          -- the archived pgmq message (pgmq.a_tally_recorder)
  tries      integer not null,
  lines      integer not null default 0,
  line_ids   jsonb,
  why        text not null,
  at         timestamptz not null default now()
);
create index if not exists tally_recorder_failures_firm on public.tally_recorder_failures (firm_id, at desc);

alter table public.tally_alerts enable row level security;
alter table public.tally_recorder_failures enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_alerts' and policyname = 'tally_alerts_read') then
    create policy tally_alerts_read on public.tally_alerts for select to authenticated using (firm_id = my_firm());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_recorder_failures' and policyname = 'tally_recorder_failures_read') then
    create policy tally_recorder_failures_read on public.tally_recorder_failures for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
-- review L8: everything revoked (on PostgreSQL 17 that includes MAINTAIN, so no version check is needed), then select only
revoke all on public.tally_alerts, public.tally_recorder_failures from anon, authenticated;
grant select on public.tally_alerts, public.tally_recorder_failures to authenticated;
revoke all on sequence public.tally_alerts_id_seq, public.tally_recorder_failures_id_seq from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tally_alerts') then
    alter publication supabase_realtime add table public.tally_alerts;
  end if;
end $$;

alter table public.tally_devices add column if not exists recorder_source text not null default 'addon' check (recorder_source in ('addon', 'alterid', 'both'));
alter table public.tally_devices add column if not exists recorder_source_at timestamptz;
alter table public.tally_devices add column if not exists recorder_source_by uuid;
grant select (recorder_source, recorder_source_at, recorder_source_by) on public.tally_devices to authenticated;

do $$ begin
  if not exists (select 1 from pg_namespace where nspname = 'pgmq') then create extension if not exists pgmq; end if;
end $$;
select pgmq.create('tally_recorder') where not exists (select 1 from pgmq.list_queues() where queue_name = 'tally_recorder');
-- review M6: the queue and its archive hold full voucher bodies: closed to the API roles whatever Supabase's defaults in the
-- pgmq schema give them (RLS on, no policy; the owner, whose functions read them, is not subject to it). Kept 90 days:
-- migration 48's tally_recorder_archive_trim (this file removes no row)
revoke all on pgmq.q_tally_recorder, pgmq.a_tally_recorder from public, anon, authenticated;
do $$ begin
  if to_regclass('pgmq.q_tally_recorder_msg_id_seq') is not null then execute 'revoke all on sequence pgmq.q_tally_recorder_msg_id_seq from public, anon, authenticated'; end if;
  if (select relowner from pg_class where oid = 'pgmq.q_tally_recorder'::regclass) = (select oid from pg_roles where rolname = current_user) then
    alter table pgmq.q_tally_recorder enable row level security;
    alter table pgmq.a_tally_recorder enable row level security;
  else
    raise notice 'migration 47: pgmq.q_tally_recorder is not owned by %; RLS not set on it (the revokes above stand)', current_user;
  end if;
end $$;

-- review H1, M1: one row per queued message, written by tally_recorder_enqueue, marked done or failed by the drain: whether a
-- book has a message not applied yet (an indexed look-up, never a scan of the queue) and the tries counted before each apply
create table if not exists public.tally_recorder_pending (
  msg_id     bigint primary key,                              -- the pgmq message
  book_id    uuid,
  firm_id    uuid,
  device_id  uuid,
  lines      integer not null default 0,
  tries      integer not null default 0,
  state      text not null default 'pending' check (state in ('pending', 'done', 'failed')),
  why        text,
  at         timestamptz not null default now(),
  tried_at   timestamptz,
  done_at    timestamptz
);
create index if not exists tally_recorder_pending_open on public.tally_recorder_pending (book_id, msg_id) where state = 'pending';
alter table public.tally_recorder_pending enable row level security;
revoke all on public.tally_recorder_pending from public, anon, authenticated;

-- review M8: the AlterID of the last ledger change applied from a recorder line (a rename by ledger_altered only above it)
alter table public.tally_ledgers add column if not exists alter_id bigint;

insert into storage.buckets (id, name, public, file_size_limit) values ('tally-uploads', 'tally-uploads', false, 2147483648) on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tally_uploads_add') then
    create policy tally_uploads_add on storage.objects for insert to authenticated
      with check (bucket_id = 'tally-uploads' and (storage.foldername(name))[1] = public.my_firm()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tally_uploads_read') then
    create policy tally_uploads_read on storage.objects for select to authenticated
      using (bucket_id = 'tally-uploads' and (storage.foldername(name))[1] = public.my_firm()::text);
  end if;
end $$;

alter table public.tally_jobs add column if not exists upload jsonb;     -- kind upload: {path, from, to, size, name} (tally-ingest's upload_new)

-- tally_jobs.kind: the one CHECK swapped for the same name with 'upload' added, in one statement, only while it lacks it.
-- Review M7: chosen by its EXACT text as migration 13 made it; anything else (a kind added by hand, no such check) stops the
-- file with words rather than replacing a rule blindly. Another CHECK that names kind is never touched.
do $$
declare old_def constant text := 'CHECK ((kind = ANY (ARRAY[''daybook''::text, ''reparse''::text])))';
  new_def constant text := 'CHECK ((kind = ANY (ARRAY[''daybook''::text, ''reparse''::text, ''upload''::text])))';
  c text; n int; found text;
begin
  if exists (select 1 from pg_constraint con where con.conrelid = 'public.tally_jobs'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) = new_def) then return; end if;
  select count(*), min(con.conname) into n, c from pg_constraint con
   where con.conrelid = 'public.tally_jobs'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) = old_def;
  if n = 1 then
    execute format('alter table public.tally_jobs drop constraint %I, add constraint %I check (kind in (''daybook'', ''reparse'', ''upload''))', c, c);
    raise notice 'migration 47: tally_jobs.% takes kind upload', c;
  else
    select string_agg(con.conname || ' ' || pg_get_constraintdef(con.oid), '; ') into found from pg_constraint con
     where con.conrelid = 'public.tally_jobs'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) ~ '\mkind\M';
    raise exception 'migration 47 stopped, nothing changed: tally_jobs has no CHECK on kind exactly as migration 13 made it (daybook, reparse), so it is not replaced blindly (found: %). Widen it by hand to take upload, then run 47 again', coalesce(found, 'none');
  end if;
end $$;

-- ---------------------------------------------------------------- 1. the recorder queue
-- review L6: who may call the service role's functions. auth.role() is null when no JWT came (pg_cron, the SQL Editor, a
-- migration); then only the owner's own logins pass (session_user postgres or supabase_admin: pg_cron runs as the job's
-- owner), never another role given EXECUTE by mistake. Inside a security definer function current_user is always the owner,
-- so session_user is what says who logged in.
create or replace function public.tally_service_or_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(auth.role() = 'service_role', session_user in ('postgres', 'supabase_admin'))
$function$;

create or replace function public.tally_try_uuid(p text) returns uuid
language plpgsql immutable security definer set search_path = public, pg_temp as $function$
begin
  return nullif(btrim(coalesce(p, '')), '')::uuid;
exception when others then return null;
end $function$;

-- review L5: the words a firm reads for a failed queued send (tally_recorder_failures, the lines, the alert); the raw error
-- goes to the server's log only (raise log in the drain)
create or replace function public.tally_recorder_why(p_state text, p_msg text) returns text
language sql immutable security definer set search_path = public, pg_temp as $function$
  select case
    when p_state = 'P0001' then left(coalesce(p_msg, ''), 200)          -- FinCom's own words (a raise in these functions)
    when p_state = '57014' then 'it did not finish in time (cancelled)'
    when p_state = '55P03' then 'the database was busy: a lock was not free in time'
    when p_state in ('40P01', '40001') then 'the database was busy: two changes crossed'
    when p_state = '42501' then 'not allowed'
    when left(coalesce(p_state, ''), 2) = '22' then 'the queued send holds a value FinCom cannot read'
    when left(coalesce(p_state, ''), 2) = '23' then 'a row was refused by a rule of the copy'
    else 'an internal error (code ' || coalesce(p_state, '?') || ')' end
$function$;

create or replace function public.tally_recorder_enqueue(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare mid bigint;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  if p_device is not null and not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = p_firm) then raise exception 'not a computer of this firm'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'the lines must be a list of 1 to 1000'; end if;
  if jsonb_array_length(p_lines) > 1000 then raise exception 'at most 1000 lines a message (% given)', jsonb_array_length(p_lines); end if;
  -- round 21 (review H1): a book's queue order is decided under one lock per book (tally_recorder_send takes it too)
  perform pg_advisory_xact_lock(hashtext('tally_recorder_queue:' || p_book::text));
  select s into mid from pgmq.send('tally_recorder', jsonb_build_object('firm', p_firm, 'book', p_book, 'device', p_device, 'lines', p_lines, 'at', now())) s;
  insert into tally_recorder_pending (msg_id, book_id, firm_id, device_id, lines) values (mid, p_book, p_firm, p_device, jsonb_array_length(p_lines));
  return jsonb_build_object('ok', true, 'msg', mid, 'queued', jsonb_array_length(p_lines));
end $function$;
revoke all on function public.tally_recorder_enqueue(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tally_recorder_enqueue(uuid, uuid, uuid, jsonb) to service_role;

-- review H1: tally-ingest's one call for a request's recorder lines. Queued when asked (p_queue: a burst of full lines) or
-- while the book has a queued message not applied or failed yet (so a later request never overtakes it); else applied now
create or replace function public.tally_recorder_send(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb, p_queue boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare n int;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_recorder_queue:' || p_book::text));
  select count(*) into n from tally_recorder_pending where book_id = p_book and state = 'pending';
  if coalesce(p_queue, false) or n > 0 then
    return tally_recorder_enqueue(p_firm, p_book, p_device, p_lines) || jsonb_build_object('behind', n);
  end if;
  return tally_recorder_apply(p_firm, p_book, p_device, p_lines);
end $function$;
revoke all on function public.tally_recorder_send(uuid, uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.tally_recorder_send(uuid, uuid, uuid, jsonb, boolean) to service_role;

-- the drain's three steps (granted to nobody: tally_recorder_drain and the pg_cron procedure call them as the owner).
-- take: the oldest visible message (its visibility time, 60 s, longer than any budget); a message of a book with an older
-- one still pending waits its turn (not a try); else its try is counted on tally_recorder_pending (review M1: the procedure
-- commits this before the apply); a message whose 5 tries all ended without an answer (killed, cancelled) fails now
create or replace function public.tally_recorder_take(p_vt integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare m record; p tally_recorder_pending%rowtype; b uuid;
begin
  select x.msg_id, x.read_ct, x.message into m from pgmq.read('tally_recorder', greatest(coalesce(p_vt, 60), 30), 1) x;
  if m.msg_id is null then return null; end if;
  b := tally_try_uuid(m.message->>'book');
  insert into tally_recorder_pending (msg_id, book_id, firm_id, device_id, lines)
  values (m.msg_id, b, tally_try_uuid(m.message->>'firm'), tally_try_uuid(m.message->>'device'),
          case when jsonb_typeof(m.message->'lines') = 'array' then jsonb_array_length(m.message->'lines') else 0 end)
  on conflict (msg_id) do nothing;
  if b is not null and exists (select 1 from tally_recorder_pending o where o.book_id = b and o.state = 'pending' and o.msg_id < m.msg_id) then
    return jsonb_build_object('msg', m.msg_id, 'wait', true);
  end if;
  update tally_recorder_pending set tries = tries + 1, tried_at = now() where msg_id = m.msg_id returning * into p;
  if p.tries > 5 then
    perform tally_recorder_fail(m.msg_id, m.message, 5, coalesce(p.why, 'it did not finish in time'));
    return jsonb_build_object('msg', m.msg_id, 'failed', true);
  end if;
  return jsonb_build_object('msg', m.msg_id, 'tries', p.tries, 'message', m.message);
end $function$;

-- settle: the apply (44/48's tally_recorder_apply), then archived and marked done in the same transaction; the book's next
-- message is made visible now (it waited its turn)
create or replace function public.tally_recorder_settle(p_msg bigint, p_message jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r jsonb; b uuid := tally_try_uuid(p_message->>'book');
begin
  r := tally_recorder_apply((p_message->>'firm')::uuid, (p_message->>'book')::uuid, nullif(p_message->>'device', '')::uuid, p_message->'lines');
  perform pgmq.archive('tally_recorder', p_msg);
  update tally_recorder_pending set state = 'done', done_at = now(), why = null where msg_id = p_msg;
  perform pgmq.set_vt('tally_recorder', o.msg_id, 0) from (select x.msg_id from tally_recorder_pending x where x.book_id = b and x.state = 'pending' order by x.msg_id limit 1) o;
  return r;
end $function$;

-- fail: before the 5th try the words are kept and the message is read again after its visibility time (true: retried is
-- false); at the 5th it is archived (kept), tally_recorder_failures gets its row, its lines go into tally_recorder_lines as
-- 'failed' with words (outside the rolled-back apply: Sync activity shows them, the gap check counts them), the book gets a
-- 'gap' alert at once, and the book's next message is made visible
create or replace function public.tally_recorder_fail(p_msg bigint, p_message jsonb, p_tries integer, p_why text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := tally_try_uuid(p_message->>'firm'); b uuid := tally_try_uuid(p_message->>'book'); d uuid := tally_try_uuid(p_message->>'device');
  ls jsonb := case when jsonb_typeof(p_message->'lines') = 'array' then p_message->'lines' else '[]'::jsonb end;
  bk tally_books%rowtype; n int; days text; dev_name text; words text; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if coalesce(p_tries, 0) < 5 then
    update tally_recorder_pending set why = left(p_why, 300) where msg_id = p_msg;
    return false;
  end if;
  perform pgmq.archive('tally_recorder', p_msg);
  n := jsonb_array_length(ls);
  insert into tally_recorder_failures (firm_id, book_id, device_id, msg_id, tries, lines, line_ids, why)
  values (f, b, d, p_msg, p_tries, n, (select jsonb_agg(left(e->>'line_id', 80)) from (select e from jsonb_array_elements(ls) e limit 1000) s),
          left(format('stopped after %s tries: %s', p_tries, p_why), 400))
  on conflict (msg_id) do nothing;
  update tally_recorder_pending set state = 'failed', done_at = now(), why = left(p_why, 300) where msg_id = p_msg;
  if f is not null then select * into bk from tally_books where book_id = b and firm_id = f; end if;
  select name into dev_name from tally_devices where id = d;
  select left(string_agg(to_char(dd, 'DD-Mon-YYYY'), ', ' order by dd), 200) into days
    from (select distinct tally_d8(replace(coalesce(e->>'vch_date', ''), '-', '')) as dd from jsonb_array_elements(ls) e where jsonb_typeof(e) = 'object') z where dd is not null;
  if bk.book_id is not null then
    insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, tally_user, company_guid, company, line_id, event, object_guid, master_id, alter_id,
                                      vch_type, vch_no, vch_date, state, held_why, payload)
    select bk.firm_id, bk.client_id, bk.book_id, d, left(e->>'bridge', 80), left(e->>'pc', 60), left(e->>'user', 60), left(e->>'company_guid', 100), left(e->>'company', 200),
           left(e->>'line_id', 80), left(btrim(coalesce(e->>'event', '')), 40), nullif(left(btrim(coalesce(e->>'object_guid', '')), 100), ''), left(e->>'master_id', 40),
           case when coalesce(e->>'alter_id', '') ~ '^[0-9]{1,15}$' then (e->>'alter_id')::bigint end,
           left(e->>'vch_type', 60), left(e->>'vch_no', 60), tally_d8(replace(coalesce(e->>'vch_date', ''), '-', '')), 'failed',
           left(format('queued send failed after %s tries (%s): not applied; read this day again or send it again', p_tries, p_why), 300),
           case when length((e - 'vouchers' - 'lines')::text) > 8000 then jsonb_build_object('cut', true, 'queued', p_msg) else e - 'vouchers' - 'lines' end
      from jsonb_array_elements(ls) with ordinality as t(e, o)
     where jsonb_typeof(e) = 'object' and o <= 1000
     order by o;
    words := left(format('%s: %s %s sent by %s not applied (tried %s times: %s); read %s again from Tally or send them again',
                         bk.company, n, case when n = 1 then 'change' else 'changes' end, coalesce(dev_name, 'a computer'), p_tries, p_why, coalesce('the Day Book of ' || days, 'those days')), 600);
    insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
    values (bk.firm_id, bk.client_id, bk.book_id, d, 'gap', today, words,
            jsonb_build_object('queueFailed', jsonb_build_array(jsonb_build_object('msg', p_msg, 'lines', n, 'why', p_why, 'days', days, 'at', now()))))
    on conflict (firm_id, kind, (coalesce(book_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)), day)
    do update set words = excluded.words, at = now(), read_at = null, read_by = null,
       data = tally_alerts.data || jsonb_build_object('queueFailed', case when jsonb_typeof(tally_alerts.data->'queueFailed') = 'array' then tally_alerts.data->'queueFailed' else '[]'::jsonb end || (excluded.data->'queueFailed'));
  elsif f is not null and exists (select 1 from firms x where x.id = f) then
    words := left(format('%s %s sent by %s for a company FinCom does not hold any more not applied (tried %s times: %s)',
                         n, case when n = 1 then 'change' else 'changes' end, coalesce(dev_name, 'a computer'), p_tries, p_why), 600);
    insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
    values (f, null, null, d, 'gap', today, words, jsonb_build_object('queueFailed', jsonb_build_array(jsonb_build_object('msg', p_msg, 'lines', n, 'why', p_why, 'at', now()))))
    on conflict (firm_id, kind, (coalesce(book_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)), day)
    do update set words = excluded.words, at = now(), read_at = null, read_by = null,
       data = tally_alerts.data || jsonb_build_object('queueFailed', case when jsonb_typeof(tally_alerts.data->'queueFailed') = 'array' then tally_alerts.data->'queueFailed' else '[]'::jsonb end || (excluded.data->'queueFailed'));
  end if;
  perform pgmq.set_vt('tally_recorder', o.msg_id, 0) from (select x.msg_id from tally_recorder_pending x where x.book_id = b and x.state = 'pending' order by x.msg_id limit 1) o;
  return true;
end $function$;
revoke all on function public.tally_service_or_owner(), public.tally_try_uuid(text), public.tally_recorder_why(text, text), public.tally_recorder_take(integer),
  public.tally_recorder_settle(bigint, jsonb), public.tally_recorder_fail(bigint, jsonb, integer, text) from public, anon, authenticated, service_role;

-- the drain for the service role (one transaction: the tries it counts are kept when it returns, a cancel included, which is
-- caught); pg_cron uses the procedure below, which commits per message
create or replace function public.tally_recorder_drain(p_budget_ms integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare stop_at timestamptz := clock_timestamp() + make_interval(secs => greatest(0, least(coalesce(p_budget_ms, 15000), 25000)) / 1000.0);
  t jsonb; r jsonb; st text; er text; n_done int := 0; n_retry int := 0; n_failed int := 0; n_wait int := 0; n_lines int := 0;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  loop
    exit when clock_timestamp() >= stop_at;
    t := tally_recorder_take(60);
    exit when t is null;
    if t ? 'wait' then n_wait := n_wait + 1; continue; end if;
    if t ? 'failed' then n_failed := n_failed + 1; continue; end if;
    begin
      -- each message its own lock timeout, within what is left of the budget (a message stuck on a lock fails by itself)
      perform set_config('lock_timeout', greatest(1000, least(10000, floor(extract(epoch from stop_at - clock_timestamp()) * 1000)))::bigint || 'ms', true);
      r := tally_recorder_settle((t->>'msg')::bigint, t->'message');
      n_done := n_done + 1;
      n_lines := n_lines + coalesce(jsonb_array_length(r->'results'), 0);
    exception when query_canceled or others then
      get stacked diagnostics st = returned_sqlstate, er = message_text;
      raise log 'tally_recorder_drain: message % try %: % %', t->>'msg', t->>'tries', st, er;
      if tally_recorder_fail((t->>'msg')::bigint, t->'message', (t->>'tries')::int, tally_recorder_why(st, er)) then n_failed := n_failed + 1; else n_retry := n_retry + 1; end if;
      exit when st = '57014';           -- cancelled: stop here (the next run goes on)
    end;
  end loop;
  return jsonb_build_object('ok', true, 'done', n_done, 'retried', n_retry, 'failed', n_failed, 'waiting', n_wait, 'lines', n_lines);
end $function$;
revoke all on function public.tally_recorder_drain(integer) from public, anon, authenticated;
grant execute on function public.tally_recorder_drain(integer) to service_role;

-- review M1: pg_cron's drain. A procedure, so that it can COMMIT: after each read (the try counted before the apply: a cancel,
-- a statement timeout or a killed run never undoes it) and after each message (an abort later never undoes the messages
-- applied before). Each message in its own subtransaction with its own lock timeout within the budget; a cancel (57014) is
-- caught, counted, and ends the run. pg_cron (1.6 on staging) runs CALL with COMMIT. Security invoker without SET (COMMIT
-- needs both), so every name here is public.-qualified; executable by nobody but its owner, as whom pg_cron runs it.
create or replace procedure public.tally_recorder_drain_run(p_budget_ms integer)
language plpgsql as $procedure$
declare stop_at timestamptz := clock_timestamp() + make_interval(secs => greatest(0, least(coalesce(p_budget_ms, 15000), 25000)) / 1000.0);
  t jsonb; st text; er text; stop_now boolean := false;
begin
  loop
    exit when clock_timestamp() >= stop_at;
    t := public.tally_recorder_take(60);
    commit;
    exit when t is null;
    continue when t ? 'wait' or t ? 'failed';
    begin
      perform set_config('lock_timeout', greatest(1000, least(10000, floor(extract(epoch from stop_at - clock_timestamp()) * 1000)))::bigint || 'ms', true);
      perform public.tally_recorder_settle((t->>'msg')::bigint, t->'message');
    exception when query_canceled or others then
      get stacked diagnostics st = returned_sqlstate, er = message_text;
      raise log 'tally_recorder_drain_run: message % try %: % %', t->>'msg', t->>'tries', st, er;
      perform public.tally_recorder_fail((t->>'msg')::bigint, t->'message', (t->>'tries')::int, public.tally_recorder_why(st, er));
      stop_now := st = '57014';
    end;
    commit;
    exit when stop_now;
  end loop;
end $procedure$;
revoke all on procedure public.tally_recorder_drain_run(integer) from public, anon, authenticated, service_role;

select cron.schedule('tally-recorder-drain', '30 seconds', 'call public.tally_recorder_drain_run(15000)');

-- ---------------------------------------------------------------- 2. alerts
-- Monday to Saturday, 09:00 to 19:00 India time (both ends in)
create or replace function public.tally_alert_working_now(p_at timestamptz) returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select extract(isodow from (p_at at time zone 'Asia/Kolkata')) between 1 and 6
     and (p_at at time zone 'Asia/Kolkata')::time between time '09:00' and time '19:00'
$function$;

create or replace function public.tally_alert_scan_gaps()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare today date := (now() at time zone 'Asia/Kolkata')::date; f uuid; n int := 0; k int; bad int := 0;
begin
  -- review L7: each firm in its own block: one firm's bad row is logged and counted, never stops the others
  for f in select distinct b.firm_id from tally_sync_cursor c join tally_books b on b.book_id = c.book_id where jsonb_typeof(c.gap) = 'object' order by 1 loop
  begin
  insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
  select b.firm_id, b.client_id, b.book_id, null, 'gap', today,
         left(b.company || ': ' || coalesce(nullif(c.gap->>'words', ''), 'changes not received'), 600), c.gap
    from tally_sync_cursor c join tally_books b on b.book_id = c.book_id
   where jsonb_typeof(c.gap) = 'object' and b.firm_id = f
  on conflict (firm_id, kind, (coalesce(book_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)), day)
  do update set words = excluded.words, data = excluded.data, at = now(),
     read_at = case when coalesce(excluded.data->>'missing', '') ~ '^[0-9]{1,15}$' and coalesce(tally_alerts.data->>'missing', '') ~ '^[0-9]{1,15}$'
                     and (excluded.data->>'missing')::bigint > (tally_alerts.data->>'missing')::bigint then null else tally_alerts.read_at end,
     read_by = case when coalesce(excluded.data->>'missing', '') ~ '^[0-9]{1,15}$' and coalesce(tally_alerts.data->>'missing', '') ~ '^[0-9]{1,15}$'
                     and (excluded.data->>'missing')::bigint > (tally_alerts.data->>'missing')::bigint then null else tally_alerts.read_by end
   where tally_alerts.data is distinct from excluded.data or tally_alerts.words is distinct from excluded.words;
  get diagnostics k = row_count;
  n := n + k;
  exception when others then
    bad := bad + 1; raise log 'tally_alert_scan_gaps: firm %: % %', f, sqlstate, sqlerrm;
  end;
  end loop;
  return jsonb_build_object('ok', true, 'written', n, 'day', today) || case when bad > 0 then jsonb_build_object('firmsFailed', bad) else '{}'::jsonb end;
end $function$;

create or replace function public.tally_alert_scan_silent()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare today date := (now() at time zone 'Asia/Kolkata')::date; f uuid; s jsonb; x jsonb; n int := 0; k int; bad int := 0;
begin
  if not tally_alert_working_now(now()) then
    return jsonb_build_object('ok', true, 'written', 0, 'skipped', 'outside Monday to Saturday, 09:00 to 19:00 India time');
  end if;
  for f in select distinct d.firm_id from tally_devices d where not coalesce(d.revoked, false) order by 1 loop
  begin                                  -- review L7: each firm in its own block
    s := tally_recorder_silent(f);
    for x in select e from jsonb_array_elements(coalesce(s->'silent', '[]'::jsonb)) e loop
      insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
      values (f, null, null, (x->>'device')::uuid, 'silent', today,
              left(format('%s: Tally open today and no recorder line for %s working hours', coalesce(x->>'name', 'a computer'), coalesce(x->>'workingHours', '?')), 600), x)
      on conflict (firm_id, kind, (coalesce(book_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)), day)
      do update set words = excluded.words, data = excluded.data, at = now()
       where tally_alerts.words is distinct from excluded.words;
      get diagnostics k = row_count;
      n := n + k;
    end loop;
  exception when others then
    bad := bad + 1; raise log 'tally_alert_scan_silent: firm %: % %', f, sqlstate, sqlerrm;
  end;
  end loop;
  return jsonb_build_object('ok', true, 'written', n, 'day', today) || case when bad > 0 then jsonb_build_object('firmsFailed', bad) else '{}'::jsonb end;
end $function$;

create or replace function public.tally_alert_daily_summary()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare today date := (now() at time zone 'Asia/Kolkata')::date; since timestamptz := (now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata';
  f uuid; d jsonb; n int := 0; k int; bad int := 0;
begin
  for f in select distinct b.firm_id from tally_books b order by 1 loop
  begin                                  -- review L7: each firm in its own block
    select jsonb_build_object(
             'applied', count(*) filter (where r.state = 'applied'), 'held', count(*) filter (where r.state = 'held'), 'failed', count(*) filter (where r.state = 'failed'),
             'duplicate', count(*) filter (where r.state = 'duplicate'), 'stale', count(*) filter (where r.state = 'stale'), 'lines', count(*))
      into d from tally_recorder_lines r where r.firm_id = f and r.received_at >= since;
    d := d || jsonb_build_object(
      'queueFailed', (select count(*) from tally_recorder_failures x where x.firm_id = f and x.at >= since),
      'gaps', (select count(*) from tally_sync_cursor c join tally_books b on b.book_id = c.book_id where b.firm_id = f and jsonb_typeof(c.gap) = 'object'),
      'postingsDone', (select count(*) from tally_post_jobs j where j.firm_id = f and j.updated_at >= since and j.status = 'done'),
      'postingsFailed', (select count(*) from tally_post_jobs j where j.firm_id = f and j.updated_at >= since and j.status = 'failed'),
      'needsReview', (select count(*) from tally_post_jobs j, jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) e
                       where j.firm_id = f and j.updated_at >= since and lower(coalesce(e->>'needsReview', '')) in ('true', 'yes', '1')),
      'day', today);
    insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
    values (f, null, null, null, 'summary', today,
            format('Today: %s recorder lines applied, %s held, %s failed; %s %s in the queue; %s open %s; postings: %s done, %s failed, %s %s review',
                   d->>'applied', d->>'held', d->>'failed', d->>'queueFailed', case when (d->>'queueFailed')::int = 1 then 'send failed' else 'sends failed' end,
                   d->>'gaps', case when (d->>'gaps')::int = 1 then 'gap' else 'gaps' end, d->>'postingsDone', d->>'postingsFailed',
                   d->>'needsReview', case when (d->>'needsReview')::int = 1 then 'needs' else 'need' end), d)
    on conflict (firm_id, kind, (coalesce(book_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)), day)
    do update set words = excluded.words, data = excluded.data, at = now()
     where tally_alerts.data is distinct from excluded.data;
    get diagnostics k = row_count;
    n := n + k;
  exception when others then
    bad := bad + 1; raise log 'tally_alert_daily_summary: firm %: % %', f, sqlstate, sqlerrm;
  end;
  end loop;
  return jsonb_build_object('ok', true, 'written', n, 'day', today) || case when bad > 0 then jsonb_build_object('firmsFailed', bad) else '{}'::jsonb end;
end $function$;

create or replace function public.tally_alert_read(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); a tally_alerts%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and coalesce(m.active, true))
     or not exists (select 1 from tally_alerts x where x.id = p_id and x.firm_id = f) then
    raise exception 'not an alert of your firm' using errcode = '42501';
  end if;
  update tally_alerts set read_at = coalesce(read_at, now()), read_by = coalesce(read_by, auth.uid()) where id = p_id and firm_id = f
  returning * into a;
  return jsonb_build_object('ok', true, 'id', a.id, 'readAt', a.read_at, 'readBy', a.read_by);
end $function$;

revoke all on function public.tally_alert_working_now(timestamptz), public.tally_alert_scan_gaps(), public.tally_alert_scan_silent(), public.tally_alert_daily_summary()
  from public, anon, authenticated, service_role;
revoke all on function public.tally_alert_read(bigint) from public, anon;
grant execute on function public.tally_alert_read(bigint) to authenticated;

select cron.schedule('tally-alert-gaps', '*/10 * * * *', 'select public.tally_alert_scan_gaps()');
select cron.schedule('tally-alert-silent', '*/30 3-13 * * 1-6', 'select public.tally_alert_scan_silent()');
select cron.schedule('tally-alert-summary', '30 13 * * *', 'select public.tally_alert_daily_summary()');

-- ---------------------------------------------------------------- 3. the recorder source per computer (the owner's)
create or replace function public.tally_device_recorder_source(p_device uuid, p_source text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); d tally_devices%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can choose where a computer''s changes come from' using errcode = '42501'; end if;
  if p_device is null or not exists (select 1 from tally_devices x where x.id = p_device and x.firm_id = f and not coalesce(x.revoked, false))
    then raise exception 'not a computer of your firm'; end if;
  if p_source is null or p_source not in ('addon', 'alterid', 'both') then raise exception 'say where the changes come from: addon, alterid or both (% given)', coalesce(p_source, 'nothing'); end if;
  perform pg_advisory_xact_lock(hashtext('tally_device_recorder_source:' || p_device::text));
  update tally_devices set recorder_source = p_source, recorder_source_at = now(), recorder_source_by = auth.uid()
   where id = p_device and firm_id = f;
  select * into d from tally_devices where id = p_device;
  return jsonb_build_object('ok', true, 'device', p_device, 'recorderSource', d.recorder_source, 'at', d.recorder_source_at, 'by', d.recorder_source_by);
end $function$;
revoke all on function public.tally_device_recorder_source(uuid, text) from public, anon;
grant execute on function public.tally_device_recorder_source(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 4. 45's tally_recorder_line + a ledger rename seen by GUID
create or replace function public.tally_recorder_line(p_book uuid, p_device uuid, p_line jsonb, p_row bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; rid bigint := p_row; ev text := left(btrim(coalesce(p_line->>'event', '')), 40);
  og text := nullif(left(btrim(coalesce(p_line->>'object_guid', '')), 100), '');
  alt bigint := case when coalesce(p_line->>'alter_id', '') ~ '^[0-9]{1,15}$' then (p_line->>'alter_id')::bigint end;     -- below 10^15 (review L9)
  vd date := tally_d8(replace(coalesce(p_line->>'vch_date', ''), '-', ''));
  sa timestamptz; pl jsonb; pltxt text; bd jsonb; stt text; wy text; t text; res jsonb; vs jsonb; lk date;
  c_found boolean := false; c_alter bigint; c_day date; c_del timestamptz; c_fid text;
  frm text; dst text; l_name text; l_del timestamptz; l_alt bigint;
  -- 45: the FinCom id of a short line (fid, else "TDSDesk:<id>" in the narration it carries) and its posting
  lf text := coalesce(case when coalesce(p_line->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then p_line->>'fid' end,
                      substring(coalesce(p_line->>'narration', '') from 'TDSDesk:([A-Za-z0-9._-]{1,80})'));
  is_short boolean; m_job uuid; m_fid text; m_guid text; m_done boolean := false; sh_changed boolean := false;
  vno text := nullif(left(btrim(coalesce(p_line->>'vch_no', '')), 60), ''); mid text := nullif(left(btrim(coalesce(p_line->>'master_id', '')), 40), '');
  known constant text[] := array['created', 'altered', 'deleted', 'cancelled', 'imported', 'ledger_created', 'ledger_altered', 'ledger_renamed', 'ledger_deleted'];
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then raise exception 'no such book'; end if;
  -- a short line: FinCom's own entry, its FinCom id and no body of its own (tally-ingest marks it short when it built the body
  -- from the posting)
  is_short := lf is not null and (coalesce(p_line->>'short', '') = 'true' or jsonb_typeof(p_line->'vouchers') is distinct from 'array' or jsonb_array_length(p_line->'vouchers') = 0);
  if rid is null then
    begin sa := (p_line->>'saved_at')::timestamptz; exception when others then sa := null; end;
    pl := coalesce(p_line->'payload', p_line - 'vouchers' - 'lines'); pltxt := pl::text;
    if length(pltxt) > 8000 then pl := jsonb_build_object('cut', true, 'bytes', length(pltxt), 'head', left(pltxt, 8000)); end if;
    -- the body: the line's own voucher (its GUID) and that voucher's lines alone, never the rest of the add-on's XML (review L1)
    bd := jsonb_strip_nulls(jsonb_build_object(
            'vouchers', (select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where og is not null and x->>'guid' = og),
            'lines', (select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(p_line->'lines') = 'array' then p_line->'lines' else '[]'::jsonb end) x where og is not null and x->>0 = og),
            'name', left(p_line->>'name', 300), 'from', left(p_line->>'from', 300), 'to', left(p_line->>'to', 300)));
    insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, tally_user, company_guid, company, line_id, event, object_guid, master_id, alter_id,
                                      vch_type, vch_no, vch_date, saved_at, state, ledgers, payload, body, save_ms)
    values (b.firm_id, b.client_id, p_book, p_device, left(p_line->>'bridge', 80), left(p_line->>'pc', 60), left(p_line->>'user', 60), left(p_line->>'company_guid', 100), left(p_line->>'company', 200),
            left(p_line->>'line_id', 80), ev, og, left(p_line->>'master_id', 40), alt, left(p_line->>'vch_type', 60), left(p_line->>'vch_no', 60), vd, sa, 'received',
            case when jsonb_typeof(p_line->'ledgers') = 'array' then (select jsonb_agg(e) from (select e from jsonb_array_elements(p_line->'ledgers') e limit 50) s) end,
            pl, bd, case when coalesce(p_line->>'save_ms', '') ~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then (p_line->>'save_ms')::numeric end)
    returning id into rid;
  end if;
  begin
    if not (ev = any(known)) then
      stt := 'failed'; wy := 'unknown event: ' || ev;
    elsif og is null and ev <> 'ledger_renamed' then
      stt := 'held'; wy := 'no GUID on the line: held, never a new row';
    end if;
    -- the same change already here: another arrival applied or held (owner items 26, 102)
    if stt is null and og is not null then
      select 'line ' || r.id || ' (' || r.state || coalesce(', from ' || nullif(r.pc, ''), '') || ')' into t from tally_recorder_lines r
       where r.book_id = p_book and r.object_guid = og and r.alter_id is not distinct from alt and r.event = ev and r.id <> rid
         -- a held arrival is the original only when a release can apply it (review M1): an entry line with its body, a
         -- delete / cancel held for a locked month; a held line without a body never swallows the same change sent with one
         and (r.state = 'applied' or (r.state = 'held' and case when ev in ('created', 'altered', 'imported') then coalesce(r.body ? 'vouchers', false)
                                                                when ev in ('deleted', 'cancelled') then coalesce(r.held_why, '') like 'month locked%'
                                                                else true end))
       order by r.id limit 1;
      if t is not null then stt := 'duplicate'; wy := 'the same change already came as ' || t; end if;
    end if;
    if stt is null and ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') then
      select true, coalesce(v.alter_id, 0), v.day, v.deleted_at into c_found, c_alter, c_day, c_del from tally_vouchers v where v.book_id = p_book and v.guid = og;
      c_found := coalesce(c_found, false);
      if ev in ('deleted', 'cancelled') then
        res := tally_ingest_delete(p_book, og, alt, ev = 'cancelled', 'recorder ' || coalesce(left(p_line->>'pc', 60), ''));
        stt := res->>'state'; wy := res->>'why';
      else
        -- the entry's body: the voucher of this GUID alone, dated by the line when it has no date of its own
        select coalesce(jsonb_agg(case when tally_d8(replace(coalesce(x->>'day', ''), '-', '')) is null then x || jsonb_build_object('day', vd) else x end), '[]'::jsonb) into vs
          from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where x->>'guid' = og;
        -- review H2: a short line builds the entry from FinCom's posted XML only when it is FinCom's creation: never for an
        -- 'altered' line, never for an entry the copy holds (a person changed it in Tally after the posting: the posted
        -- content is not Tally's now). Such a line is matched, held, and its AlterID is not received (the gap check shows it)
        sh_changed := is_short and (ev = 'altered' or c_found);
        if sh_changed then vs := '[]'::jsonb; end if;
        -- 45: a short line lands on FinCom's posting (the live, accepted one of this firm for this book) or is held
        if is_short then
          select r.post_job, r.post_fid, r.post_guid into m_job, m_fid, m_guid from tally_post_live_for(b.firm_id, p_book, lf) r;
          if m_job is null then
            stt := 'held'; wy := format('FinCom id %s matches no posting of this firm', lf);
          elsif m_guid is not null and m_guid <> og then
            stt := 'held'; wy := format('FinCom id %s is matched to another Tally entry (GUID %s) already: held, never a second entry', lf, m_guid);
          else
            update tally_post_ids p set matched_at = coalesce(p.matched_at, now()),
                   matched_vch = coalesce(vno, nullif(left(btrim(coalesce(vs->0->>'no', '')), 60), ''), p.matched_vch),
                   matched_guid = og, matched_mid = coalesce(mid, p.matched_mid),
                   matched_alter = case when alt is null then p.matched_alter else greatest(coalesce(p.matched_alter, alt), alt) end
             where p.job_id = m_job and p.fincom_id = m_fid;
            m_done := true;
          end if;
        end if;
        if stt is null then
          lk := tally_month_locked(p_book, array(select tally_d8(replace(coalesce(x->>'day', ''), '-', '')) from jsonb_array_elements(vs) x) || array[c_day, vd]);
          if lk is not null then
            stt := 'held'; wy := format('month locked: %s', to_char(lk, 'YYYY-MM'));
          elsif c_found and alt is not null and alt < c_alter then
            stt := 'stale'; wy := format('AlterID %s is older than the %s held', alt, c_alter);
          elsif c_found and alt is not null and alt = c_alter and c_del is null then
            stt := 'duplicate'; wy := format('the copy holds this entry at AlterID %s already (a day read or another line)', alt);
          elsif jsonb_array_length(vs) = 0 then
            stt := 'held'; wy := case when m_done and sh_changed then format('FinCom posting %s matched; changed in Tally after posting: the next full line or Day Book upload applies it', m_fid)
                                      when m_done then format('FinCom posting %s matched; no entry body (its posted XML could not be read): the next day read applies it', m_fid)
                                      else 'no entry body on the line: the next day read applies it' end;
          else
            res := tally_ingest_entries(p_book, vs, p_line->'lines');
            if coalesce((res->>'locked')::boolean, false) then stt := 'held'; wy := res->>'refused';
            else
              stt := 'applied';
              if m_done then wy := format('FinCom posting %s matched', m_fid);
              else
                -- a FinCom posting coming back in a full line: matched by its FinCom id (43's columns, 45's GUID, MasterID, AlterID);
                -- review L4: only the firm's LIVE row of that id whose posting's company is this book's (never an old failed
                -- posting's or another company's row of the same id)
                select v.fincom_id into c_fid from tally_vouchers v where v.book_id = p_book and v.guid = og;
                if c_fid is not null then
                  update tally_post_ids p set matched_at = coalesce(p.matched_at, now()), matched_vch = coalesce(vno, p.matched_vch),
                         matched_guid = coalesce(p.matched_guid, og), matched_mid = coalesce(mid, p.matched_mid),
                         matched_alter = case when alt is null then p.matched_alter else greatest(coalesce(p.matched_alter, alt), alt) end
                   where p.firm_id = b.firm_id and p.fincom_id = c_fid and p.live
                     and exists (select 1 from tally_post_jobs j where j.id = p.job_id and j.firm_id = b.firm_id and j.company = b.company);
                  wy := format('FinCom posting %s matched', c_fid);
                end if;
              end if;
            end if;
          end if;
        end if;
      end if;
    elsif stt is null and ev = 'ledger_renamed' then
      frm := left(btrim(coalesce(p_line->>'from', '')), 300); dst := left(btrim(coalesce(p_line->>'to', '')), 300);
      if dst = '' then stt := 'failed'; wy := 'a rename without the new name';
      elsif coalesce(current_setting('fincom.recorder_release', true), '') ~ '^[0-9]+$' then stt := 'held'; wy := 'a rename is applied by the bridge (tally_ledger_rename), not by a release: the next ledger list makes it';
      else
        begin
          res := tally_ledger_rename(p_book, og, frm, dst);
          if coalesce((res->>'renamed')::boolean, false) or coalesce((res->>'merged')::boolean, false) then stt := 'applied'; wy := res->>'note';
          elsif res->>'note' = 'already named so' then stt := 'applied'; wy := 'already named so';
          else stt := 'held'; wy := coalesce(res->>'note', 'not renamed');
          end if;
          -- round 21 (review M8): the ledger's AlterID seen, so an older ledger_altered never undoes this rename
          if stt = 'applied' and alt is not null and og is not null then
            update tally_ledgers set alter_id = greatest(coalesce(alter_id, 0), alt) where book_id = p_book and tally_guid = og and deleted_at is null;
          end if;
        exception when others then stt := 'held'; wy := left('rename not made: ' || sqlerrm, 300);
        end;
      end if;
    elsif stt is null and ev = 'ledger_altered' and og is not null and left(btrim(coalesce(p_line->>'name', '')), 300) <> ''
          and exists (select 1 from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null and l.name <> left(btrim(p_line->>'name'), 300)) then
      -- 47: a ledger_altered line whose GUID the copy holds (live) under another name is a rename: tally_ledger_rename, as
      -- ledger_renamed. Round 21 (review M8): only with an AlterID above the last one seen for that ledger (an older line
      -- arriving late never undoes a newer rename: 'stale'), and never a merge (a name another ledger holds is left to the
      -- next ledger list); a line without an AlterID is held for the ledger list
      select l.name, l.alter_id into frm, l_alt from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null order by l.name limit 1;
      dst := left(btrim(p_line->>'name'), 300);
      if alt is null then stt := 'held'; wy := 'a ledger change without its AlterID: the next ledger list applies it';
      elsif l_alt is not null and alt <= l_alt then stt := 'stale'; wy := format('ledger AlterID %s is not above the %s seen: an older change, not applied', alt, l_alt);
      elsif exists (select 1 from tally_ledgers l where l.book_id = p_book and l.name = dst) then
        stt := 'held'; wy := format('a ledger named %s is in the copy already: a merge is left to the next ledger list', dst);
      elsif coalesce(current_setting('fincom.recorder_release', true), '') ~ '^[0-9]+$' then stt := 'held'; wy := 'a rename is applied by the bridge (tally_ledger_rename), not by a release: the next ledger list makes it';
      else
        begin
          res := tally_ledger_rename(p_book, og, frm, dst);
          if coalesce((res->>'renamed')::boolean, false) or coalesce((res->>'merged')::boolean, false) then stt := 'applied'; wy := res->>'note';
          elsif res->>'note' = 'already named so' then stt := 'applied'; wy := 'already named so';
          else stt := 'held'; wy := coalesce(res->>'note', 'not renamed');
          end if;
          if stt = 'applied' then
            update tally_ledgers set alter_id = greatest(coalesce(alter_id, 0), alt) where book_id = p_book and tally_guid = og and deleted_at is null;
          end if;
        exception when others then stt := 'held'; wy := left('rename not made: ' || sqlerrm, 300);
        end;
      end if;
    elsif stt is null and ev in ('ledger_created', 'ledger_altered') then
      stt := 'held'; wy := 'ledger lines applied by the next ledger list';
    elsif stt is null and ev = 'ledger_deleted' then
      select l.name, l.deleted_at into l_name, l_del from tally_ledgers l where l.book_id = p_book and l.tally_guid = og order by (l.deleted_at is null) desc limit 1;
      if l_name is null then stt := 'held'; wy := 'unknown ledger: not in the copy';
      elsif l_del is not null then stt := 'applied'; wy := 'already marked deleted';
      else
        perform set_config('fincom.ledger_list', jsonb_build_object('reason', format('deleted in Tally (recorder line %s)', rid),
          'list', jsonb_build_object('source', 'recorder', 'at', now(), 'device', p_device, 'bridge', left(p_line->>'bridge', 80), 'line', rid))::text, true);
        update tally_ledgers set deleted_at = now() where book_id = p_book and name = l_name;
        perform set_config('fincom.ledger_list', '', true);
        if exists (select 1 from tally_ledgers where book_id = p_book and name = l_name and deleted_at is null) then
          select 'kept by the guard: ' || coalesce(tally_ledger_hold_reason(l), 'unknown reason') into wy from tally_ledgers l where l.book_id = p_book and l.name = l_name;
          stt := 'held';
        else stt := 'applied'; end if;
      end if;
    end if;
  exception when others then
    stt := 'failed'; wy := left(sqlerrm, 300);
  end;
  update tally_recorder_lines set state = stt, held_why = wy,
         applied_at = case when stt = 'applied' then now() else applied_at end,
         body = case when stt = 'duplicate' then null else body end
   where id = rid;
  return jsonb_build_object('id', rid, 'line_id', p_line->>'line_id', 'state', stt, 'why', wy);
end $function$;
revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- 7. round 21: the gap check counts a failed queued send (review H1)
-- 45's tally_recorder_gap_check, its text unchanged but two things: the lines of a queued send that failed for good and were
-- not brought since are counted as not received ('lost', in the words), and the caller check of review L6
create or replace function public.tally_recorder_gap_check(p_book uuid, p_device uuid, p_altvchid bigint, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; bk tally_books%rowtype; c tally_sync_cursor%rowtype; dmax bigint; base bigint; g jsonb; byd jsonb; at_ timestamptz := coalesce(p_at, now()); missing bigint;
  mbase bigint; since_ timestamptz; w record; lo bigint; hi bigint; above bigint; kk bigint; dup bigint; cr bigint; credit bigint := 0; ww text := ''; wins jsonb := '[]'::jsonb;
  fb bigint := 0; fbm bigint := 0; wm bigint := 0; since_fb timestamptz; cg text; lost bigint := 0; lost_w text := '';
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into bk from tally_books where book_id = p_book;
  f := bk.firm_id;
  if f is null then raise exception 'no such book'; end if;
  if p_altvchid is null or p_altvchid >= 1000000000000000 then raise exception 'the check needs Tally''s highest voucher AlterID'; end if;
  -- 0 or less is unknown (the bridge read no ALTVCHID): never a starting point, never a rewind; the cursor untouched (review M2)
  if p_altvchid <= 0 then return jsonb_build_object('ok', true, 'gap', null, 'unknown', true); end if;
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  insert into tally_sync_cursor (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
  select * into c from tally_sync_cursor where book_id = p_book;
  -- no starting point yet: this number is it (7.), and there is no gap
  if c.start_at is null then
    update tally_sync_cursor set last_voucher_alterid = p_altvchid, start_at = now(), start_device = p_device, start_guid = coalesce(start_guid, company_guid), gap = null, gap_at = null, updated_at = now() where book_id = p_book;
    return jsonb_build_object('ok', true, 'startRecorded', true, 'gap', null, 'startVoucher', p_altvchid);
  end if;
  -- below the starting point: a backup restored or the data rewritten - needs_baseline as today, never a gap (45: the last
  -- match's number cleared too)
  if p_altvchid < coalesce(c.last_voucher_alterid, 0) then
    update tally_sync_cursor set state = 'needs_baseline', state_at = now(), gap = null, gap_at = null, match_alter = null, match_start = null, updated_at = now(),
           state_why = format('Tally''s highest voucher AlterID (%s) is below the starting point (%s): a backup restored or the data rewritten', p_altvchid, c.last_voucher_alterid)
     where book_id = p_book;
    return jsonb_build_object('ok', true, 'gap', null, 'needsBaseline', true, 'why', format('below the starting point (%s < %s)', p_altvchid, c.last_voucher_alterid));
  end if;
  select max(d.alter_max) into dmax from tally_days d where d.book_id = p_book;
  -- 45: the last check that matched under this starting point accounted everything up to its number
  mbase := case when c.match_start is not distinct from c.start_at then c.match_alter end;
  -- review L10: below that number, read after that match, is a restore as below the start (needs_baseline as 44, never
  -- matched); a reading older than the match (two beats crossing) changes nothing and says nothing
  if mbase is not null and p_altvchid < mbase then
    if c.last_match_at is null or at_ > c.last_match_at then
      update tally_sync_cursor set state = 'needs_baseline', state_at = now(), gap = null, gap_at = null, updated_at = now(),
             state_why = format('Tally''s highest voucher AlterID (%s) is below the last matched check''s (%s): a backup restored or the data rewritten', p_altvchid, mbase)
       where book_id = p_book;
      return jsonb_build_object('ok', true, 'gap', null, 'needsBaseline', true, 'why', format('below the last match (%s < %s)', p_altvchid, mbase));
    end if;
    return jsonb_build_object('ok', true, 'gap', null, 'behind', true, 'why', format('a reading older than the last match (%s < %s)', p_altvchid, mbase));
  end if;
  base := greatest(coalesce(c.last_voucher_alterid, 0), coalesce(c.recorder_max_alter, 0), coalesce(dmax, 0), coalesce(mbase, 0));
  since_ := coalesce(c.last_match_at, c.start_at);
  missing := p_altvchid - base;
  if missing > 0 then
    -- (a) the posting windows above the baseline and below Tally's number now (review M1), of this book's company GUID
    cg := coalesce(c.start_guid, c.company_guid);
    for w in select pw.job_id, pw.a0, pw.a1, pw.created_vch, pw.created_mst, pw.company_guid, coalesce(j.taken_at, j.created_at, pw.at) as posted_at
               from tally_post_windows pw left join tally_post_jobs j on j.id = pw.job_id
              where pw.book_id = p_book and pw.a1 > base and pw.a0 < p_altvchid and pw.a1 >= pw.a0 order by pw.a0, pw.id loop
      if w.company_guid is null or cg is null or w.company_guid <> cg then
        ww := ww || format('; FinCom''s posting of %s not counted (made in company GUID %s; this book''s is %s)', to_char(w.posted_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'),
                           coalesce(w.company_guid, 'not sent'), coalesce(cg, 'not known yet'));
        wins := wins || jsonb_build_array(jsonb_build_object('job', w.job_id, 'a0', w.a0, 'a1', w.a1, 'created', w.created_vch, 'counted', 0, 'otherCompany', true));
        continue;
      end if;
      lo := greatest(w.a0, base); hi := least(w.a1, p_altvchid); above := greatest(hi - lo, 0);
      -- the changes in the window that are not FinCom's vouchers (a person's, or its masters'): at most kk; of the part above
      -- the baseline at least above - kk is FinCom's (review M1), and only vouchers raise ALTVCHID's count here (review M2)
      kk := greatest(w.a1 - w.a0 - w.created_vch, 0); wm := wm + w.created_mst;
      -- never subtract twice: the window's entries a recorder line matched carry their AlterID into recorder_max_alter, so they
      -- are inside the baseline already; counted here they are taken off (review L7: empty by construction, kept as the guard)
      select count(*) into dup from tally_post_ids p where p.job_id = w.job_id and p.matched_at is not null and p.matched_alter > lo and p.matched_alter <= w.a1
         and p.matched_alter <= coalesce(c.recorder_max_alter, 0);
      cr := greatest(least(above, w.created_vch, above - kk) - dup, 0);
      if kk > 0 then     -- not fully accounted: someone else changed something while it ran (or it made ledgers)
        ww := ww || format('; up to %s changes not received during the posting of %s', kk, to_char(w.posted_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'));
      end if;
      credit := credit + cr;
      wins := wins || jsonb_build_array(jsonb_build_object('job', w.job_id, 'a0', w.a0, 'a1', w.a1, 'created', w.created_vch, 'masters', w.created_mst, 'full', kk = 0, 'counted', cr));
    end loop;
    -- (c) the fallback: the vouchers of FinCom's postings without a window, accepted after the last match (else the starting
    -- point), not matched by a recorder line and not in the copy (a day read or a line brought them: inside the baseline;
    -- review L1: also when the copy marked it deleted since). Review H1: "after" is the SERVER's time of the latest thing that
    -- set the baseline: the last match (match_at, the server's clock), the last recorder line that raised recorder_max_alter
    -- (recorder_last_at), the day read that brought the highest AlterID. A posting accepted before it has its changes under
    -- the baseline already; no posting is subtracted at two checks. Residual: these are the times acceptances REACHED the
    -- cloud, not Tally's; a batch reported seconds after a later person's line still counts (at most one request; closed by
    -- 2.2.0's windows; docs/reviews/migration-45-review.md, Fixed)
    since_fb := greatest(coalesce(case when c.match_start is not distinct from c.start_at then coalesce(c.match_at, c.last_match_at) end, c.start_at),
                         case when coalesce(c.recorder_max_alter, 0) > coalesce(c.last_voucher_alterid, 0) then c.recorder_last_at end,
                         (select max(d.at) from tally_days d where d.book_id = p_book and d.alter_max >= base));
    select count(*) into fb from tally_post_ids p join tally_post_jobs j on j.id = p.job_id
     where p.firm_id = f and j.firm_id = f and j.company = bk.company
       and not exists (select 1 from tally_post_windows pw where pw.job_id = j.id)
       and p.accepted_at is not null and p.accepted_at > since_fb and p.released_at is null and p.matched_at is null
       and not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.fincom_id = p.fincom_id);
    if fb > 0 then
      select coalesce(sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) r
                            where r->>'kind' = 'master' and tally_post_result_accepted(r))), 0) into fbm
        from tally_post_jobs j
       where j.firm_id = f and j.company = bk.company and not exists (select 1 from tally_post_windows pw where pw.job_id = j.id)
         and exists (select 1 from tally_post_ids p where p.job_id = j.id and p.accepted_at > since_fb);
    end if;
    missing := p_altvchid - base - credit - fb;
    fbm := fbm + wm;
  end if;
  -- 47 (review H1): the lines of a queued send that failed for good are NOT received, though later lines raised the
  -- recorder's highest AlterID above them: each one not brought since (a later line of that entry at its AlterID or above,
  -- or the copy holding the entry so: a day read) is counted, so the check is never fooled into a match
  select count(*) into lost from tally_recorder_lines r
   where r.book_id = p_book and r.state = 'failed' and r.held_why like 'queued send failed%'
     and r.event in ('created', 'altered', 'imported', 'deleted', 'cancelled') and r.object_guid is not null and r.alter_id is not null
     and not exists (select 1 from tally_recorder_lines r2 where r2.book_id = p_book and r2.object_guid = r.object_guid and r2.alter_id >= r.alter_id and r2.state in ('applied', 'duplicate', 'stale'))
     and case when r.event = 'deleted' then exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and v.deleted_at is null and coalesce(v.alter_id, 0) < r.alter_id)
              when r.event = 'cancelled' then exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and v.deleted_at is null and not coalesce(v.cancelled, false) and coalesce(v.alter_id, 0) < r.alter_id)
              else not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and coalesce(v.alter_id, 0) >= r.alter_id) end;
  if lost > 0 then
    missing := greatest(coalesce(missing, 0), 0) + lost;
    lost_w := format('; %s of them in a queued send that failed (Sync activity: failed): send them again or read those days again', lost);
  end if;
  if missing > 0 then
    -- an UPPER bound: each create, alter or delete raises ALTVCHID by at least one, so the changes missed are at most this
    select jsonb_object_agg(s.device_id::text, jsonb_build_object('max', s.mx, 'lastAt', s.la)) into byd
      from (select r.device_id, max(r.alter_id) mx, max(r.received_at) la from tally_recorder_lines r
             where r.book_id = p_book and r.device_id is not null and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported') group by r.device_id) s;
    g := jsonb_build_object('tally_altvchid', p_altvchid, 'recorder_max', c.recorder_max_alter, 'day_max', dmax, 'start_point', c.last_voucher_alterid, 'missing', missing, 'missingMax', missing,
           'since', since_, 'last_match_at', c.last_match_at, 'by_device', coalesce(byd, '{}'::jsonb), 'device', p_device, 'at', at_,
           'accounted', credit, 'posted', fb, 'windows', wins, 'ledgers', fbm, 'lost', lost,
           'words', format('up to %s changes not received since %s', missing, to_char(since_ at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI')) || ww || lost_w
                    || case when fbm > 0 then format('; of which up to %s may be FinCom''s own new ledgers', least(fbm, missing)) else '' end);
    update tally_sync_cursor set gap = g, gap_at = coalesce(gap_at, now()), updated_at = now() where book_id = p_book;
    return jsonb_build_object('ok', true, 'gap', g, 'missing', missing, 'missingMax', missing);
  end if;
  update tally_sync_cursor set gap = null, gap_at = null, last_match_at = at_, match_at = now(), match_alter = greatest(coalesce(mbase, 0), p_altvchid), match_start = c.start_at, updated_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'gap', null, 'matched', true, 'lastMatchAt', at_, 'accounted', credit + fb);
end $function$;
revoke all on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) to service_role;

-- ---------------------------------------------------------------- 8. round 21: an upload piece's work queued once (review M3)
-- tally-ingest's upload piece hands over everything it queues (its day files and the next piece) in ONE call: queued only
-- while the job's cursor (tally_jobs.upload->>'at': 'main:<byte>' / 'late:<byte>' / 'end') is the piece's own, then the cursor
-- moves to the next piece's, all in one transaction. A piece run again (killed after this, its message not archived) finds
-- the cursor moved and queues nothing; the late days are added to the job's total by the same step, so once.
create or replace function public.tally_upload_advance(p_job uuid, p_at text, p_next text, p_msgs jsonb, p_late integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare j tally_jobs%rowtype; m jsonb; n int := 0;
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_msgs) is distinct from 'array' or jsonb_array_length(p_msgs) > 500 then raise exception 'the pieces must be a list of at most 500'; end if;
  select * into j from tally_jobs where id = p_job and kind = 'upload' for update;
  if j.id is null then raise exception 'no such upload'; end if;
  if coalesce(j.upload ? 'at', false) and j.upload->>'at' is distinct from p_at then
    return jsonb_build_object('ok', true, 'moved', false, 'at', j.upload->>'at');
  end if;
  for m in select e from jsonb_array_elements(p_msgs) e loop
    if jsonb_typeof(m) is distinct from 'object' or m->>'job' is distinct from p_job::text then raise exception 'a piece of another job'; end if;
    perform pgmq.send('tally_work', m);
    n := n + 1;
  end loop;
  update tally_jobs set upload = coalesce(upload, '{}'::jsonb) || jsonb_build_object('at', coalesce(p_next, 'end')),
         total = total + greatest(coalesce(p_late, 0), 0), updated_at = now()
   where id = p_job;
  return jsonb_build_object('ok', true, 'moved', true, 'sent', n, 'at', coalesce(p_next, 'end'));
end $function$;
revoke all on function public.tally_upload_advance(uuid, text, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.tally_upload_advance(uuid, text, text, jsonb, integer) to service_role;

commit;
