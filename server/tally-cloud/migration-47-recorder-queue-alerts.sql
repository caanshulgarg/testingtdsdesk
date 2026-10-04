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
--   Every function here: security definer, search_path = public, pg_temp. The service role's revoked from public, anon and
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
grant select on public.tally_alerts, public.tally_recorder_failures to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.tally_alerts, public.tally_recorder_failures from anon, authenticated;
revoke all on public.tally_alerts, public.tally_recorder_failures from anon;
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

-- tally_jobs.kind: the one CHECK swapped for the same name with 'upload' added, in one statement, only while it lacks it
do $$
declare c text;
begin
  select con.conname into c from pg_constraint con
   where con.conrelid = 'public.tally_jobs'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%kind%' and pg_get_constraintdef(con.oid) not like '%upload%'
   limit 1;
  if c is not null then
    execute format('alter table public.tally_jobs drop constraint %I, add constraint %I check (kind in (''daybook'', ''reparse'', ''upload''))', c, c);
    raise notice 'migration 47: tally_jobs.% takes kind upload', c;
  end if;
end $$;

-- ---------------------------------------------------------------- 1. the recorder queue
create or replace function public.tally_recorder_enqueue(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare mid bigint;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  if p_device is not null and not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = p_firm) then raise exception 'not a computer of this firm'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'the lines must be a list of 1 to 1000'; end if;
  if jsonb_array_length(p_lines) > 1000 then raise exception 'at most 1000 lines a message (% given)', jsonb_array_length(p_lines); end if;
  select s into mid from pgmq.send('tally_recorder', jsonb_build_object('firm', p_firm, 'book', p_book, 'device', p_device, 'lines', p_lines, 'at', now())) s;
  return jsonb_build_object('ok', true, 'msg', mid, 'queued', jsonb_array_length(p_lines));
end $function$;
revoke all on function public.tally_recorder_enqueue(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tally_recorder_enqueue(uuid, uuid, uuid, jsonb) to service_role;

create or replace function public.tally_recorder_drain(p_budget_ms integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare stop_at timestamptz := clock_timestamp() + make_interval(secs => greatest(0, least(coalesce(p_budget_ms, 15000), 25000)) / 1000.0);
  m record; r jsonb; why text; n_done int := 0; n_retry int := 0; n_failed int := 0; n_lines int := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  loop
    exit when clock_timestamp() >= stop_at;
    select x.msg_id, x.read_ct, x.message into m from pgmq.read('tally_recorder', 120, 1) x;
    exit when m.msg_id is null;
    begin
      r := tally_recorder_apply((m.message->>'firm')::uuid, (m.message->>'book')::uuid, nullif(m.message->>'device', '')::uuid, m.message->'lines');
      perform pgmq.archive('tally_recorder', m.msg_id);
      n_done := n_done + 1;
      n_lines := n_lines + coalesce(jsonb_array_length(r->'results'), 0);
    exception when others then
      why := left(sqlerrm, 300);
      if m.read_ct >= 5 then
        perform pgmq.archive('tally_recorder', m.msg_id);
        insert into tally_recorder_failures (firm_id, book_id, device_id, msg_id, tries, lines, line_ids, why)
        values (case when coalesce(m.message->>'firm', '') ~ '^[0-9a-f-]{36}$' then (m.message->>'firm')::uuid end,
                case when coalesce(m.message->>'book', '') ~ '^[0-9a-f-]{36}$' then (m.message->>'book')::uuid end,
                case when coalesce(m.message->>'device', '') ~ '^[0-9a-f-]{36}$' then (m.message->>'device')::uuid end,
                m.msg_id, m.read_ct,
                case when jsonb_typeof(m.message->'lines') = 'array' then jsonb_array_length(m.message->'lines') else 0 end,
                case when jsonb_typeof(m.message->'lines') = 'array' then (select jsonb_agg(left(e->>'line_id', 80)) from (select e from jsonb_array_elements(m.message->'lines') e limit 1000) s) end,
                format('stopped after %s tries: %s', m.read_ct, why))
        on conflict (msg_id) do nothing;
        n_failed := n_failed + 1;
      else
        n_retry := n_retry + 1;
      end if;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'done', n_done, 'retried', n_retry, 'failed', n_failed, 'lines', n_lines);
end $function$;
revoke all on function public.tally_recorder_drain(integer) from public, anon, authenticated;
grant execute on function public.tally_recorder_drain(integer) to service_role;

select cron.schedule('tally-recorder-drain', '30 seconds', 'select public.tally_recorder_drain(15000)');

-- ---------------------------------------------------------------- 2. alerts
-- Monday to Saturday, 09:00 to 19:00 India time (both ends in)
create or replace function public.tally_alert_working_now(p_at timestamptz) returns boolean
language sql stable security definer set search_path = public, pg_temp as $function$
  select extract(isodow from (p_at at time zone 'Asia/Kolkata')) between 1 and 6
     and (p_at at time zone 'Asia/Kolkata')::time between time '09:00' and time '19:00'
$function$;

create or replace function public.tally_alert_scan_gaps()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare today date := (now() at time zone 'Asia/Kolkata')::date; n int;
begin
  insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
  select b.firm_id, b.client_id, b.book_id, null, 'gap', today,
         left(b.company || ': ' || coalesce(nullif(c.gap->>'words', ''), 'changes not received'), 600), c.gap
    from tally_sync_cursor c join tally_books b on b.book_id = c.book_id
   where jsonb_typeof(c.gap) = 'object'
  on conflict (firm_id, kind, (coalesce(book_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)), day)
  do update set words = excluded.words, data = excluded.data, at = now(),
     read_at = case when coalesce(excluded.data->>'missing', '') ~ '^[0-9]{1,15}$' and coalesce(tally_alerts.data->>'missing', '') ~ '^[0-9]{1,15}$'
                     and (excluded.data->>'missing')::bigint > (tally_alerts.data->>'missing')::bigint then null else tally_alerts.read_at end,
     read_by = case when coalesce(excluded.data->>'missing', '') ~ '^[0-9]{1,15}$' and coalesce(tally_alerts.data->>'missing', '') ~ '^[0-9]{1,15}$'
                     and (excluded.data->>'missing')::bigint > (tally_alerts.data->>'missing')::bigint then null else tally_alerts.read_by end
   where tally_alerts.data is distinct from excluded.data or tally_alerts.words is distinct from excluded.words;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'written', n, 'day', today);
end $function$;

create or replace function public.tally_alert_scan_silent()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare today date := (now() at time zone 'Asia/Kolkata')::date; f uuid; s jsonb; x jsonb; n int := 0; k int;
begin
  if not tally_alert_working_now(now()) then
    return jsonb_build_object('ok', true, 'written', 0, 'skipped', 'outside Monday to Saturday, 09:00 to 19:00 India time');
  end if;
  for f in select distinct d.firm_id from tally_devices d where not coalesce(d.revoked, false) order by 1 loop
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
  end loop;
  return jsonb_build_object('ok', true, 'written', n, 'day', today);
end $function$;

create or replace function public.tally_alert_daily_summary()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare today date := (now() at time zone 'Asia/Kolkata')::date; since timestamptz := (now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata';
  f uuid; d jsonb; n int := 0; k int;
begin
  for f in select distinct b.firm_id from tally_books b order by 1 loop
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
  end loop;
  return jsonb_build_object('ok', true, 'written', n, 'day', today);
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
  frm text; dst text; l_name text; l_del timestamptz;
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
        exception when others then stt := 'held'; wy := left('rename not made: ' || sqlerrm, 300);
        end;
      end if;
    elsif stt is null and ev = 'ledger_altered' and og is not null and left(btrim(coalesce(p_line->>'name', '')), 300) <> ''
          and exists (select 1 from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null and l.name <> left(btrim(p_line->>'name'), 300)) then
      -- 47: a ledger_altered line whose GUID the copy holds (live) under another name is a rename: tally_ledger_rename, as ledger_renamed
      select l.name into frm from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null order by l.name limit 1;
      dst := left(btrim(p_line->>'name'), 300);
      if coalesce(current_setting('fincom.recorder_release', true), '') ~ '^[0-9]+$' then stt := 'held'; wy := 'a rename is applied by the bridge (tally_ledger_rename), not by a release: the next ledger list makes it';
      else
        begin
          res := tally_ledger_rename(p_book, og, frm, dst);
          if coalesce((res->>'renamed')::boolean, false) or coalesce((res->>'merged')::boolean, false) then stt := 'applied'; wy := res->>'note';
          elsif res->>'note' = 'already named so' then stt := 'applied'; wy := 'already named so';
          else stt := 'held'; wy := coalesce(res->>'note', 'not renamed');
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

commit;
