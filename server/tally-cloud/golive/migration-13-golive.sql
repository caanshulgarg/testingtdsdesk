-- GO-LIVE COPY of server/tally-cloud/migration-13-fast-sync.sql (md5 d142e44b596319a1e39fed77657e0929), docs/GO-LIVE.md. Run this on live INSTEAD of the original; staging keeps the original.
-- The only differences: the pg_cron job reads this project's address from the Vault secret fincom_project_url at
-- every run (no project address is written here); the file refuses to run until that secret is set, and refuses
-- staging's address; and it adds tally_jobs to
-- the realtime publication only when it is not there yet (so it runs twice cleanly).
-- Set the secret once, before this file (the owner, in the SQL editor of the project it runs on):
--   select vault.create_secret('https://<project id>.supabase.co', 'fincom_project_url', 'FinCom: this project''s own address, for its pg_cron jobs');
-- Original below.
--
-- Fast sync (branch fast-sync, review of 01-Oct-2026). Adds only; nothing is dropped or deleted.
--
-- 1. The bridge woken at once (Supabase Realtime): "Post to Tally", "Update now" and "Send ledgers and groups now" reached
--    the Tally computer with its next heartbeat (up to a minute, or 25 after a failed one). Now the database sends a
--    wake-up on the Tally computer's own channel the moment a posting is queued or an update is asked for, and the
--    bridge (1.15.0) asks for the work straight away. The message says only "post" or "update"; the work itself is
--    fetched with the computer's key as before. The channel's name is a random token of each computer, kept here and
--    given to that computer in the heartbeat's answer.
--      tally_devices + wake_token          the computer's channel ("tb-<token>")
--      tally_wake(device, what)            sends the wake-up (service only)
--      triggers on tally_post_jobs (a posting waiting) and tally_devices (Update now asked)
-- 2. Work done by the server, not the browser (Supabase Queues, pgmq): a day book chosen in FinCom is handed over in
--    pieces and read into the cloud copy by the server, even if the browser is closed; "Read the kept day books again"
--    likewise, a month at a time. A piece that fails is tried again (up to 5 times); progress is kept in tally_jobs,
--    which every computer of the firm sees change as it goes (Realtime).
--      pgmq queue tally_work               pieces of work; on success a piece is archived (kept), not deleted
--      tally_jobs                          one row a job: what, how far, what failed
--      tally_work_send / _read / _done / tally_job_step / tally_work_key_ok   for the cloud function only (service)
--      vault secret tally_work_key         the key the timer sends to the cloud function
--      cron tally-work (every 30 s)        wakes the cloud function while pieces wait (a safety net: a piece handed
--                                          over is started at once anyway)
-- 3. Postings tried again: a posting taken by the Tally computer and not heard of for 10 minutes (taken) or 30 minutes
--    (running) goes back to waiting, at most 5 times; the bridge checks Tally for FinCom's IDs before posting, so
--    nothing is posted twice.
--      tally_post_jobs + attempts, tally_post_requeue(), cron tally-post-requeue (every minute)

begin;

-- ---------- go-live: this project's own address, from Vault (set by the owner first; see docs/GO-LIVE.md 1.1)
do $golive$
declare u text;
begin
  select decrypted_secret into u from vault.decrypted_secrets where name = 'fincom_project_url';
  if u is null or u !~ '^https://[a-z0-9]{20}\.supabase\.co$' then
    raise exception 'go-live copy: first set the Vault secret fincom_project_url to this project''s address, https://<project id>.supabase.co (no slash at the end)';
  end if;
  if position('qbocskaiewaxqcvaunzc' in u) > 0 then
    raise exception 'go-live copy: fincom_project_url names staging; staging keeps its original migration';
  end if;
end $golive$;

-- ---------- 1. waking the bridge
alter table public.tally_devices add column if not exists wake_token text;
update public.tally_devices set wake_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') where wake_token is null;
alter table public.tally_devices alter column wake_token set default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

create or replace function public.tally_wake(p_device uuid, p_what text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare t text;
begin
  select wake_token into t from tally_devices where id = p_device and not coalesce(revoked, false);
  if t is null then return; end if;
  perform realtime.send(jsonb_build_object('what', p_what, 'at', now()), p_what, 'tb-' || t, false);
exception when others then
  null;      -- the heartbeat still carries it, as before
end $function$;
revoke all on function public.tally_wake(uuid, text) from public, anon, authenticated;

create or replace function public.tally_post_jobs_wake() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.status = 'waiting' and new.device_id is not null and (tg_op = 'INSERT' or old.status is distinct from 'waiting') then perform tally_wake(new.device_id, 'post'); end if;
  return new;
end $function$;
drop trigger if exists tally_post_jobs_wake on public.tally_post_jobs;
create trigger tally_post_jobs_wake after insert or update of status on public.tally_post_jobs for each row execute function public.tally_post_jobs_wake();

create or replace function public.tally_devices_wake() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.want_update_at is distinct from old.want_update_at and new.want_update_at is not null then perform tally_wake(new.id, 'update'); end if;
  return new;
end $function$;
drop trigger if exists tally_devices_wake on public.tally_devices;
create trigger tally_devices_wake after update of want_update_at on public.tally_devices for each row execute function public.tally_devices_wake();

-- ---------- 2. work done by the server
create extension if not exists pgmq;
select pgmq.create('tally_work') where not exists (select 1 from pgmq.list_queues() where queue_name = 'tally_work');

create table if not exists public.tally_jobs (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id),
  client_id  text not null,
  book_id    uuid,
  kind       text not null check (kind in ('daybook', 'reparse')),
  status     text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  total      integer not null default 0,
  done       integer not null default 0,
  sealed     boolean not null default false,          -- every piece handed over (the total is final)
  bad        jsonb not null default '[]'::jsonb,
  message    text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tally_jobs_client on public.tally_jobs (firm_id, client_id, created_at desc);
alter table public.tally_jobs enable row level security;
drop policy if exists tally_jobs_read on public.tally_jobs;
create policy tally_jobs_read on public.tally_jobs for select to authenticated using ((firm_id = my_firm()) or is_superadmin());
revoke all on public.tally_jobs from anon, authenticated;
grant select on public.tally_jobs to authenticated;
do $pub$ begin   -- go-live copy: added only when not yet there, so the file can run twice
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tally_jobs') then
    alter publication supabase_realtime add table public.tally_jobs;
  end if;
end $pub$;

create or replace function public.tally_work_send(p_msg jsonb) returns bigint language sql security definer set search_path to 'public' as $function$
  select * from pgmq.send('tally_work', p_msg);
$function$;
create or replace function public.tally_work_read(p_vt integer, p_n integer)
returns table (msg_id bigint, read_ct integer, message jsonb) language sql security definer set search_path to 'public' as $function$
  select r.msg_id, r.read_ct, r.message from pgmq.read('tally_work', p_vt, p_n) r;
$function$;
create or replace function public.tally_work_done(p_msg bigint) returns boolean language sql security definer set search_path to 'public' as $function$
  select pgmq.archive('tally_work', p_msg);
$function$;
-- a piece done (or given up): the job's count moves on; done when every piece of a sealed job is in
create or replace function public.tally_job_step(p_job uuid, p_done integer, p_bad jsonb, p_failed text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update tally_jobs set done = done + coalesce(p_done, 0), bad = bad || coalesce(p_bad, '[]'::jsonb),
         status = case when p_failed is not null then 'failed' when sealed and done + coalesce(p_done, 0) >= total then 'done' else 'running' end,
         message = case when p_failed is not null then left(p_failed, 300) else message end, updated_at = now()
   where id = p_job;
end $function$;
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'tally_work_key') then
    perform vault.create_secret(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'tally_work_key', 'the timer''s key for tally-ingest''s queue worker');
  end if;
end $$;
create or replace function public.tally_work_key_ok(p_key text) returns boolean language sql security definer set search_path to 'public' as $function$
  select coalesce(p_key, '') <> '' and exists (select 1 from vault.decrypted_secrets where name = 'tally_work_key' and decrypted_secret = p_key);
$function$;
revoke all on function public.tally_work_send(jsonb), public.tally_work_read(integer, integer), public.tally_work_done(bigint),
  public.tally_job_step(uuid, integer, jsonb, text), public.tally_work_key_ok(text) from public, anon, authenticated;
grant execute on function public.tally_work_send(jsonb), public.tally_work_read(integer, integer), public.tally_work_done(bigint),
  public.tally_job_step(uuid, integer, jsonb, text), public.tally_work_key_ok(text) to service_role;

select cron.schedule('tally-work', '30 seconds', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/tally-ingest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-fincom-work', (select decrypted_secret from vault.decrypted_secrets where name = 'tally_work_key')),
    body := '{"kind":"work"}'::jsonb)
  where exists (select 1 from pgmq.q_tally_work where vt <= now())
$cron$);

-- ---------- 3. postings tried again
alter table public.tally_post_jobs add column if not exists attempts integer not null default 0;
create or replace function public.tally_post_requeue() returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  update tally_post_jobs set status = case when attempts >= 5 then 'failed' else 'waiting' end, attempts = attempts + 1, updated_at = now(),
         message = case when attempts >= 5 then 'The Tally computer did not finish this posting after 5 tries. Check Tally on that computer, then post again.'
                        else 'Sent to the Tally computer again: it had not answered for a while.' end
   where (status = 'taken' and coalesce(updated_at, taken_at) < now() - interval '10 minutes')
      or (status = 'running' and updated_at < now() - interval '30 minutes');
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.tally_post_requeue() from public, anon, authenticated;
select cron.schedule('tally-post-requeue', '* * * * *', 'select public.tally_post_requeue()');

commit;
