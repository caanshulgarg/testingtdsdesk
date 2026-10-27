-- FinCom Console, phase 5 "Operations" (27-Oct-2026, branch next-console-ops; console-plan.md 3.9, 3.11, 3.13, 3.15 and
-- the "see as this firm" of 4.2). NOT run on staging by the console's builder: the owner runs it.
-- Number: 122. Needs migration 118 (console_audit_add, console_role_check, console_admins). Reads, where they are there,
-- tables other features made (platform_secrets, gsp_secret_get / gsp_secret_put of migration 16, support_tickets /
-- support_messages, tally_devices, tally_post_jobs, tally_jobs, tally_alerts, tally_recorder_failures, wallet_entries,
-- pgmq, pg_cron): each is looked up first, and a missing one is left out, never an error.
--
-- What it adds (add-only; nothing dropped or rewritten; one transaction, lock_timeout 10 s; safe to run twice):
--   console_secret_meta   one row per platform key the console has touched: when it was last replaced or rotated, by whom
--                         and why, the last Test (when, passed or not, the provider's words). NEVER the key itself.
--   console_view_log      one row per "See as this firm": who, which firm, the reason, when (add-only by trigger).
--   console_secret_*()    keys (Owner only, the change and its audit row in one transaction): status (set or not, the
--                         last 4 characters for a key of 12 or more, never more), set (platform_secrets, or Vault for
--                         TaxPro's ASP id and password), rotation note (function secrets the console cannot write),
--                         test result, last used (worked out from the tables each key's features write), and
--                         console_secret_value (the value, for the Test call only; the service role only).
--   console_health_*()    bridges per firm (tally_devices beats), waiting and failed jobs (tally_post_jobs, tally_jobs),
--                         queues (pgmq) and job counts, scheduled jobs and their last runs (cron.job_run_details).
--   console_support_*()   the support desk: every firm's tickets with replies and SLA state; one ticket with internal
--                         notes; reply or note as FinCom support; status, priority and assignee (each with its audit row).
--   console_seeas()       "See as this firm": a read-only summary of one firm's main screens, made here from that firm's
--                         data (never with a firm user's session): plan, credit and its last entries, clients as COUNTS
--                         (names only when the firm's own consent row says so: firm_support_access.include_client_data),
--                         Tally status, team, recent activity (what and when only). In the same transaction: the audit row,
--                         the view log row and a notice in the firm's bell (tally_alerts, kind summary): "FinCom support
--                         viewed your account on <date>: <reason>".
--   console_ledger(), console_export_audit()   the all-firms credit ledger and the change history for the exports.
-- Grants: the tables have RLS on with no policy and the service role only; every console_* function the service role
-- only (anon and authenticated nothing). Tested on pg_stand: tests/run_migration122.py (RED_WITHOUT_122=1 fails).

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- tables
create table if not exists public.console_secret_meta (
  name           text primary key check (name ~ '^[A-Za-z][A-Za-z0-9_:.]{1,60}$'),
  rotated_at     timestamptz,
  rotated_by     uuid,
  rotate_reason  text check (rotate_reason is null or length(rotate_reason) <= 1000),
  last4_before   text,
  last4          text,
  last_test_at   timestamptz,
  last_test_ok   boolean,
  last_test_msg  text check (last_test_msg is null or length(last_test_msg) <= 300),
  last_test_by   uuid,
  updated_at     timestamptz not null default now()
);
alter table public.console_secret_meta enable row level security;
revoke all on public.console_secret_meta from public, anon, authenticated;
grant select, insert, update on public.console_secret_meta to service_role;

create table if not exists public.console_view_log (
  id         uuid primary key default gen_random_uuid(),
  at         timestamptz not null default now(),
  admin_id   uuid not null,
  role       text,
  firm_id    uuid not null,
  reason     text not null check (length(reason) between 5 and 1000),
  client_data boolean not null default false,
  ip         text,
  user_agent text
);
create index if not exists console_view_log_firm on public.console_view_log (firm_id, at desc);
alter table public.console_view_log enable row level security;
revoke all on public.console_view_log from public, anon, authenticated;
grant select, insert on public.console_view_log to service_role;
-- add-only
create or replace function public.console_view_log_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'console_view_log is append-only (% refused)', tg_op using errcode = '42501';
end $$;
drop trigger if exists console_view_log_no_change on public.console_view_log;
create trigger console_view_log_no_change before update or delete on public.console_view_log
  for each row execute function public.console_view_log_guard();

-- ---------------------------------------------------------------- helpers
-- the last 4 characters of a key, only when it is long enough that 4 tell nothing (12 or more); else null
create or replace function public.console_last4(p_value text)
returns text language sql immutable set search_path = '' as $$
  select case when p_value is not null and length(p_value) >= 12 then right(p_value, 4) end
$$;

-- a timestamp from a fixed query of this file's own (never user text), or null when its table or column is missing
create or replace function public.console_try_ts(p_sql text)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare v timestamptz;
begin
  execute p_sql into v;
  return v;
exception when others then
  return null;
end $$;

-- a key's current value: platform_secrets (store 'table') or Vault through gsp_secret_get (store 'vault'); null when unset
create or replace function public.console_secret_value(p_name text, p_store text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  if p_store = 'table' then
    if to_regclass('public.platform_secrets') is null then return null; end if;
    execute 'select value from public.platform_secrets where name = $1' into v using p_name;
  elsif p_store = 'vault' then
    if to_regprocedure('public.gsp_secret_get(text)') is null then return null; end if;
    execute 'select public.gsp_secret_get($1)' into v using p_name;
  end if;
  return nullif(v, '');
end $$;

-- ---------------------------------------------------------------- keys (Owner only)
-- set or not, length, last 4 (12+ characters only), when and by whom, and the console's own notes; never a value
create or replace function public.console_secrets_status(p_table text[], p_vault text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare out jsonb := '[]'::jsonb; n text; v text; s timestamptz; b uuid; has_by boolean;
begin
  has_by := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_secrets' and column_name = 'set_by');
  foreach n in array coalesce(p_table, '{}'::text[]) loop
    v := null; s := null; b := null;
    if to_regclass('public.platform_secrets') is not null then
      if has_by then execute 'select value, set_at, set_by from public.platform_secrets where name = $1' into v, s, b using n;
      else execute 'select value, set_at from public.platform_secrets where name = $1' into v, s using n; end if;
    end if;
    out := out || jsonb_build_object('name', n, 'store', 'table', 'set', coalesce(v, '') <> '', 'length', coalesce(length(v), 0),
      'last4', public.console_last4(v), 'set_at', s, 'set_by', (select u.email from auth.users u where u.id = b));
  end loop;
  foreach n in array coalesce(p_vault, '{}'::text[]) loop
    v := public.console_secret_value(n, 'vault');
    out := out || jsonb_build_object('name', n, 'store', 'vault', 'set', coalesce(v, '') <> '', 'length', coalesce(length(v), 0),
      'last4', public.console_last4(v), 'set_at', null, 'set_by', null);
  end loop;
  return (select coalesce(jsonb_agg(x || coalesce((select jsonb_build_object(
            'rotated_at', m.rotated_at, 'rotated_by', (select u.email from auth.users u where u.id = m.rotated_by), 'rotate_reason', m.rotate_reason,
            'last4_before', m.last4_before, 'last_test_at', m.last_test_at, 'last_test_ok', m.last_test_ok, 'last_test_msg', m.last_test_msg)
          from public.console_secret_meta m where m.name = x->>'name'), '{}'::jsonb)), '[]'::jsonb)
          from jsonb_array_elements(out) x);
end $$;

-- the console's notes on keys it cannot read (function secrets): rotation and tests only
create or replace function public.console_secret_meta_get(p_names text[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(m.name, jsonb_build_object(
           'rotated_at', m.rotated_at, 'rotated_by', (select u.email from auth.users u where u.id = m.rotated_by), 'rotate_reason', m.rotate_reason,
           'last4_before', m.last4_before, 'last4', m.last4, 'last_test_at', m.last_test_at, 'last_test_ok', m.last_test_ok, 'last_test_msg', m.last_test_msg)), '{}'::jsonb)
    from public.console_secret_meta m where m.name = any (p_names)
$$;

-- replace a key (platform_secrets or Vault). The value never reaches the audit row: only "last 4 abcd -> wxyz".
create or replace function public.console_secret_set(p_by uuid, p_name text, p_store text, p_value text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_old text; v_new text := btrim(coalesce(p_value, '')); v_has_by boolean;
begin
  v_role := public.console_role_check(p_by, array['owner']);
  if p_name is null or p_name !~ '^[A-Za-z][A-Za-z0-9_:.]{1,60}$' then raise exception 'console: bad_key' using errcode = '22023'; end if;
  if p_store is null or p_store not in ('table', 'vault') then raise exception 'console: bad_key' using errcode = '22023'; end if;
  if length(v_new) < 4 or length(v_new) > 4000 or (v_new ~ '\s' and p_name <> 'resend_from') then raise exception 'console: bad_value' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('console_secret:' || p_name, 0));
  v_old := public.console_secret_value(p_name, p_store);
  if v_old = v_new then raise exception 'console: same_value' using errcode = '22023'; end if;
  if p_store = 'table' then
    if to_regclass('public.platform_secrets') is null then raise exception 'console: no_store' using errcode = 'P0002'; end if;
    v_has_by := exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'platform_secrets' and column_name = 'set_by');
    if v_has_by then
      execute 'insert into public.platform_secrets (name, value, set_at, set_by) values ($1, $2, now(), $3)
               on conflict (name) do update set value = excluded.value, set_at = now(), set_by = excluded.set_by' using p_name, v_new, p_by;
    else
      execute 'insert into public.platform_secrets (name, value, set_at) values ($1, $2, now())
               on conflict (name) do update set value = excluded.value, set_at = now()' using p_name, v_new;
    end if;
  else
    if to_regprocedure('public.gsp_secret_put(text,text)') is null then raise exception 'console: no_store' using errcode = 'P0002'; end if;
    execute 'select public.gsp_secret_put($1, $2)' using p_name, v_new;
  end if;
  insert into public.console_secret_meta as m (name, rotated_at, rotated_by, rotate_reason, last4_before, last4, last_test_at, last_test_ok, last_test_msg, last_test_by, updated_at)
  values (p_name, now(), p_by, nullif(left(p_reason, 1000), ''), public.console_last4(v_old), public.console_last4(v_new), null, null, null, null, now())
  on conflict (name) do update set rotated_at = now(), rotated_by = p_by, rotate_reason = excluded.rotate_reason, last4_before = excluded.last4_before,
    last4 = excluded.last4, last_test_at = null, last_test_ok = null, last_test_msg = null, last_test_by = null, updated_at = now();
  perform public.console_audit_add(p_by, v_role, 'keys.set', 'key', p_name,
    jsonb_build_object('set', v_old is not null, 'last4', public.console_last4(v_old)),
    jsonb_build_object('set', true, 'last4', public.console_last4(v_new), 'store', p_store), p_reason, p_ip, p_ua);
  return jsonb_build_object('name', p_name, 'last4', public.console_last4(v_new), 'set_at', now());
end $$;

-- a key the console cannot write (a Supabase function secret): the owner changed it there; the console records when and why
create or replace function public.console_secret_rotated(p_by uuid, p_name text, p_last4 text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_before text;
begin
  v_role := public.console_role_check(p_by, array['owner']);
  if p_name is null or p_name !~ '^[A-Za-z][A-Za-z0-9_:.]{1,60}$' then raise exception 'console: bad_key' using errcode = '22023'; end if;
  if p_last4 is not null and p_last4 !~ '^.{4}$' then raise exception 'console: bad_value' using errcode = '22023'; end if;
  select last4 into v_before from public.console_secret_meta where name = p_name for update;
  insert into public.console_secret_meta as m (name, rotated_at, rotated_by, rotate_reason, last4_before, last4, updated_at)
  values (p_name, now(), p_by, nullif(left(p_reason, 1000), ''), v_before, p_last4, now())
  on conflict (name) do update set rotated_at = now(), rotated_by = p_by, rotate_reason = excluded.rotate_reason,
    last4_before = m.last4, last4 = excluded.last4, last_test_at = null, last_test_ok = null, last_test_msg = null, updated_at = now();
  perform public.console_audit_add(p_by, v_role, 'keys.rotated', 'key', p_name, jsonb_build_object('last4', v_before),
    jsonb_build_object('last4', p_last4, 'where', 'function secret'), p_reason, p_ip, p_ua);
  return jsonb_build_object('name', p_name, 'rotated_at', now());
end $$;

-- the Test button's result (the call itself is made by console-admin; its audit row is the router's "keys.test")
create or replace function public.console_secret_tested(p_by uuid, p_name text, p_ok boolean, p_msg text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.console_role_check(p_by, array['owner']);
  if p_name is null or p_name !~ '^[A-Za-z][A-Za-z0-9_:.]{1,60}$' then raise exception 'console: bad_key' using errcode = '22023'; end if;
  insert into public.console_secret_meta as m (name, last_test_at, last_test_ok, last_test_msg, last_test_by, updated_at)
  values (p_name, now(), p_ok, left(p_msg, 300), p_by, now())
  on conflict (name) do update set last_test_at = now(), last_test_ok = excluded.last_test_ok, last_test_msg = excluded.last_test_msg,
    last_test_by = p_by, updated_at = now();
  return jsonb_build_object('name', p_name, 'ok', p_ok, 'at', now());
end $$;

-- when each key was last used, where FinCom can know it: the latest row its features wrote (null: not known)
create or replace function public.console_secret_last_used()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'claude', greatest(
       public.console_try_ts('select max(at) from public.wallet_entries where code = ''claude'''),
       public.console_try_ts('select max(at) from public.assistant_log'),
       public.console_try_ts('select (max(day) + 1)::timestamp at time zone ''Asia/Kolkata'' - interval ''1 second'' from public.assistant_usage')),
    'vision', public.console_try_ts('select max(at) from public.wallet_entries where code = ''vision'''),
    'groq', greatest(public.console_try_ts('select max(created_at) from public.call_captions'), public.console_try_ts('select max(at) from public.call_captions'),
                     public.console_try_ts('select max(created_at) from public.call_transcripts')),
    'resend', greatest(public.console_try_ts('select max(created_at) from public.mis_runs where emailed > 0'), public.console_try_ts('select max(created_at) from public.call_invites')),
    'taxpro', greatest(public.console_try_ts('select max(fetched_at) from public.gst_returns'), public.console_try_ts('select max(at) from public.gst_filing_log'),
                       public.console_try_ts('select max(updated_at) from public.gst_sessions')),
    'zoho', greatest(public.console_try_ts('select max(at) from public.zoho_api_usage'), public.console_try_ts('select max(at) from public.zoho_log'),
                     public.console_try_ts('select max(created_at) from public.zoho_log')),
    'fyn', null,
    'cf_realtime', greatest(public.console_try_ts('select max(created_at) from public.call_rooms'), public.console_try_ts('select max(started_at) from public.call_rooms')),
    'call_guest', public.console_try_ts('select max(created_at) from public.call_invites'));
end $$;

-- ---------------------------------------------------------------- system health (read-only)
-- bridges: one row per computer (revoked ones left out): its firm, version, last beat and state
create or replace function public.console_health_bridges()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '[]'::jsonb;
begin
  if to_regclass('public.tally_devices') is null then return v; end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'firm_id', d.firm_id, 'firm', f.name, 'name', d.name, 'version', d.version, 'last_seen', d.last_seen, 'created_at', d.created_at,
      'state', case when d.last_seen > now() - interval '5 minutes' then 'online' when d.last_seen > now() - interval '24 hours' then 'idle' else 'offline' end,
      'minutes_ago', case when d.last_seen is null then null else floor(extract(epoch from now() - d.last_seen) / 60)::int end)
      order by d.last_seen desc nulls last), '[]'::jsonb)
      from public.tally_devices d left join public.firms f on f.id = d.firm_id
     where not coalesce(d.revoked, false)$q$ into v;
  return v;
end $$;

-- jobs waiting, running or failed: Tally postings (tally_post_jobs) and Tally reads (tally_jobs); failed ones of the last
-- 30 days; the bridge's message cut to 200 characters
create or replace function public.console_health_jobs()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a jsonb := '[]'::jsonb; b jsonb := '[]'::jsonb;
begin
  if to_regclass('public.tally_post_jobs') is not null then
    execute $q$
      select coalesce(jsonb_agg(x order by x->>'updated_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('id', j.id::text, 'source', 'tally_post', 'firm_id', j.firm_id, 'firm', f.name, 'client_id', j.client_id::text,
          'status', j.status, 'message', left(coalesce(j.message, ''), 200), 'created_at', j.created_at, 'updated_at', j.updated_at,
          'stuck', j.status in ('taken', 'running') and j.updated_at < now() - interval '30 minutes',
          'age_min', floor(extract(epoch from now() - j.created_at) / 60)::int) as x
          from public.tally_post_jobs j left join public.firms f on f.id = j.firm_id
         where j.status in ('waiting', 'taken', 'running') or (j.status = 'failed' and j.updated_at > now() - interval '30 days')
         order by j.updated_at desc limit 3000) s$q$ into a;
  end if;
  if to_regclass('public.tally_jobs') is not null then
    execute $q$
      select coalesce(jsonb_agg(x order by x->>'updated_at' desc), '[]'::jsonb) from (
        select jsonb_build_object('id', j.id::text, 'source', 'tally_read', 'firm_id', j.firm_id, 'firm', f.name, 'client_id', j.client_id::text,
          'status', case j.status when 'queued' then 'waiting' else j.status end, 'message', left(coalesce(j.message, ''), 200),
          'created_at', j.created_at, 'updated_at', j.updated_at,
          'stuck', j.status = 'running' and j.updated_at < now() - interval '30 minutes',
          'age_min', floor(extract(epoch from now() - j.created_at) / 60)::int) as x
          from public.tally_jobs j left join public.firms f on f.id = j.firm_id
         where j.status in ('queued', 'running') or (j.status = 'failed' and j.updated_at > now() - interval '30 days')
         order by j.updated_at desc limit 2000) s$q$ into b;
  end if;
  return a || b;
end $$;

-- queues: every pgmq queue's length and oldest message; and the status counts of the job tables
create or replace function public.console_health_queues()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '[]'::jsonb; x jsonb; t text;
begin
  if to_regnamespace('pgmq') is not null and to_regprocedure('pgmq.metrics_all()') is not null then
    begin
      execute $q$select coalesce(jsonb_agg(jsonb_build_object('name', 'pgmq: ' || m.queue_name, 'kind', 'queue', 'waiting', m.queue_length,
                 'oldest_sec', m.oldest_msg_age_sec, 'total', m.total_messages, 'failed', null) order by m.queue_name), '[]'::jsonb)
                 from pgmq.metrics_all() m$q$ into x;
      v := v || x;
    exception when others then null;
    end;
  end if;
  foreach t in array array['tally_post_jobs', 'tally_jobs', 'zoho_post_jobs', 'mis_runs'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    begin
      execute format($q$select jsonb_build_array(jsonb_build_object('name', %L, 'kind', 'table',
          'waiting', count(*) filter (where status in ('waiting', 'queued', 'taken', 'running', 'pending')),
          'failed', count(*) filter (where status = 'failed' and updated_at > now() - interval '24 hours'),
          'oldest_sec', floor(extract(epoch from now() - min(created_at) filter (where status in ('waiting', 'queued', 'pending')))),
          'total', count(*)))
        from public.%I$q$, t, t) into x;
      v := v || x;
    exception when others then
      begin
        execute format($q$select jsonb_build_array(jsonb_build_object('name', %L, 'kind', 'table', 'waiting', null,
            'failed', count(*) filter (where status = 'failed'), 'oldest_sec', null, 'total', count(*))) from public.%I$q$, t, t) into x;
        v := v || x;
      exception when others then null;
      end;
    end;
  end loop;
  if to_regclass('public.tally_recorder_failures') is not null then
    execute $q$select jsonb_build_array(jsonb_build_object('name', 'tally_recorder_failures', 'kind', 'table', 'waiting', null,
               'failed', count(*) filter (where at > now() - interval '24 hours'), 'oldest_sec', null, 'total', count(*)))
               from public.tally_recorder_failures$q$ into x;
    v := v || x;
  end if;
  return v;
end $$;

-- scheduled jobs (pg_cron): each job with its last run and its last failure
create or replace function public.console_health_cron()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '[]'::jsonb;
begin
  if to_regclass('cron.job') is null then return v; end if;
  begin
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object(
        'jobid', j.jobid, 'name', coalesce(j.jobname, 'job ' || j.jobid), 'schedule', j.schedule, 'active', j.active,
        'last_start', r.start_time, 'last_end', r.end_time, 'last_status', r.status, 'last_message', left(coalesce(r.return_message, ''), 200),
        'last_failed_at', fl.start_time, 'runs_24h', (select count(*) from cron.job_run_details x where x.jobid = j.jobid and x.start_time > now() - interval '24 hours'),
        'failed_24h', (select count(*) from cron.job_run_details x where x.jobid = j.jobid and x.status = 'failed' and x.start_time > now() - interval '24 hours'))
        order by j.jobname nulls last, j.jobid), '[]'::jsonb)
        from cron.job j
        left join lateral (select * from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc nulls last limit 1) r on true
        left join lateral (select d.start_time from cron.job_run_details d where d.jobid = j.jobid and d.status = 'failed' order by d.start_time desc limit 1) fl on true$q$
      into v;
  exception when others then
    v := '[]'::jsonb;
  end;
  return v;
end $$;

-- the summary cards
create or replace function public.console_health_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b jsonb := public.console_health_bridges(); j jsonb := public.console_health_jobs(); c jsonb := public.console_health_cron();
begin
  return jsonb_build_object(
    'bridges', jsonb_array_length(b),
    'bridges_online', (select count(*) from jsonb_array_elements(b) x where x->>'state' = 'online'),
    'bridges_idle', (select count(*) from jsonb_array_elements(b) x where x->>'state' = 'idle'),
    'bridges_offline', (select count(*) from jsonb_array_elements(b) x where x->>'state' = 'offline'),
    'jobs_waiting', (select count(*) from jsonb_array_elements(j) x where x->>'status' in ('waiting', 'taken', 'running')),
    'jobs_stuck', (select count(*) from jsonb_array_elements(j) x where (x->>'stuck')::boolean),
    'jobs_failed_24h', (select count(*) from jsonb_array_elements(j) x where x->>'status' = 'failed' and (x->>'updated_at')::timestamptz > now() - interval '24 hours'),
    'cron_jobs', jsonb_array_length(c),
    'cron_failed_24h', (select coalesce(sum((x->>'failed_24h')::int), 0) from jsonb_array_elements(c) x),
    'cron_available', to_regclass('cron.job') is not null,
    'pgmq_available', to_regnamespace('pgmq') is not null,
    'as_of', now());
end $$;

-- ---------------------------------------------------------------- support desk
create or replace function public.console_support_row(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  execute $q$
    select to_jsonb(t) - 'context' || jsonb_build_object(
      'code', 'T-' || t.num, 'firm', f.name, 'plan', p.name,
      'replies', (select count(*) from public.support_messages m where m.ticket_id = t.id and not m.internal),
      'notes', (select count(*) from public.support_messages m where m.ticket_id = t.id and m.internal),
      'last_at', (select max(m.created_at) from public.support_messages m where m.ticket_id = t.id),
      'sla', case when t.status in ('resolved', 'closed') then 'done'
                  when t.first_response_at is null and now() > t.respond_by then 'breached'
                  when now() > t.resolve_by then 'breached'
                  when t.first_response_at is null and now() > t.respond_by - interval '1 hour' then 'due' else 'ok' end)
      from public.support_tickets t left join public.firms f on f.id = t.firm_id left join public.plans p on p.id = f.plan_id
     where t.id = $1$q$ into v using p_ticket;
  return v;
end $$;

create or replace function public.console_support_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if to_regclass('public.support_tickets') is null then return '[]'::jsonb; end if;
  execute $q$select coalesce(jsonb_agg(public.console_support_row(t.id) order by t.updated_at desc), '[]'::jsonb)
               from (select id, updated_at from public.support_tickets order by updated_at desc limit 5000) t$q$ into v;
  return v;
end $$;

-- one ticket: the row, the whole thread (internal notes included: the console is support) and the firm's summary
create or replace function public.console_support_get(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; th jsonb; f uuid;
begin
  if to_regclass('public.support_tickets') is null then return null; end if;
  v := public.console_support_row(p_ticket);
  if v is null then return null; end if;
  f := (v->>'firm_id')::uuid;
  execute $q$select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'author_name', m.author_name, 'from_support', m.from_support, 'internal', m.internal,
             'body', m.body, 'files', m.files, 'created_at', m.created_at) order by m.id), '[]'::jsonb)
             from public.support_messages m where m.ticket_id = $1$q$ into th using p_ticket;
  return v || jsonb_build_object('thread', th, 'context', (select t.context from public.support_tickets t where t.id = p_ticket),
    'firm_summary', (select jsonb_build_object('id', x.id, 'name', x.name, 'status', x.status, 'balance', x.balance, 'plan', p.name,
                       'members', (select count(*) from public.members m where m.firm_id = x.id and m.active))
                       from public.firms x left join public.plans p on p.id = x.plan_id where x.id = f));
end $$;

-- a reply to the firm, or an internal note (the firm never sees it), as FinCom support; the ticket moves as support_reply
-- moves it for support; one audit row (the text's length, never the text)
create or replace function public.console_support_reply(p_by uuid, p_ticket uuid, p_body text, p_internal boolean, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_name text; v_old record;
begin
  v_role := public.console_role_check(p_by, array['owner', 'support']);
  if length(btrim(coalesce(p_body, ''))) < 1 or length(p_body) > 10000 then raise exception 'console: bad_value' using errcode = '22023'; end if;
  select id, status, firm_id into v_old from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'console: no_ticket' using errcode = 'P0002'; end if;
  select 'FinCom support (' || split_part(coalesce(u.email, ''), '@', 1) || ')' into v_name from auth.users u where u.id = p_by;
  insert into public.support_messages (ticket_id, author, author_name, from_support, internal, body, files)
  values (p_ticket, p_by, coalesce(v_name, 'FinCom support'), true, coalesce(p_internal, false), btrim(p_body), '[]'::jsonb);
  if coalesce(p_internal, false) then
    update public.support_tickets set updated_at = now() where id = p_ticket;
  else
    update public.support_tickets set first_response_at = coalesce(first_response_at, now()),
      status = case when status in ('new', 'open') then 'waiting' else status end, last_by = 'support', updated_at = now()
     where id = p_ticket;
  end if;
  perform public.console_audit_add(p_by, v_role, case when coalesce(p_internal, false) then 'support.note' else 'support.reply' end, 'ticket', p_ticket::text,
    jsonb_build_object('status', v_old.status), jsonb_build_object('internal', coalesce(p_internal, false), 'chars', length(btrim(p_body)), 'firm_id', v_old.firm_id),
    nullif(p_reason, ''), p_ip, p_ua);
  return public.console_support_row(p_ticket);
end $$;

-- status, priority, assignee (any of them; null keeps it). A new priority moves the SLA times as support_set does
create or replace function public.console_support_set(p_by uuid, p_ticket uuid, p_status text, p_priority text, p_assignee text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; t record;
begin
  v_role := public.console_role_check(p_by, array['owner', 'support']);
  if p_status is not null and p_status not in ('new', 'open', 'waiting', 'resolved', 'closed') then raise exception 'console: bad_status' using errcode = '22023'; end if;
  if p_priority is not null and p_priority not in ('low', 'medium', 'high', 'urgent') then raise exception 'console: bad_status' using errcode = '22023'; end if;
  if p_assignee is not null and length(p_assignee) > 254 then raise exception 'console: bad_value' using errcode = '22023'; end if;
  select * into t from public.support_tickets where id = p_ticket for update;
  if not found then raise exception 'console: no_ticket' using errcode = 'P0002'; end if;
  if coalesce(p_status, t.status) = t.status and coalesce(p_priority, t.priority) = t.priority and coalesce(p_assignee, t.assignee) = t.assignee then
    raise exception 'console: same_status' using errcode = '22023';
  end if;
  update public.support_tickets set
    status = coalesce(p_status, status),
    resolved_at = case when coalesce(p_status, status) in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end,
    priority = coalesce(p_priority, priority),
    respond_by = case when p_priority is not null and p_priority <> t.priority then public.support_sla(p_priority, t.created_at, 'respond') else respond_by end,
    resolve_by = case when p_priority is not null and p_priority <> t.priority then public.support_sla(p_priority, t.created_at, 'resolve') else resolve_by end,
    assignee = coalesce(p_assignee, assignee),
    updated_at = now()
   where id = p_ticket;
  perform public.console_audit_add(p_by, v_role, 'support.set', 'ticket', p_ticket::text,
    jsonb_build_object('status', t.status, 'priority', t.priority, 'assignee', t.assignee),
    jsonb_build_object('status', coalesce(p_status, t.status), 'priority', coalesce(p_priority, t.priority), 'assignee', coalesce(p_assignee, t.assignee)),
    nullif(p_reason, ''), p_ip, p_ua);
  return public.console_support_row(p_ticket);
end $$;

-- the people a ticket can be given to: active console admins who are not viewers
create or replace function public.console_support_assignees()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('email', u.email, 'role', a.role) order by u.email), '[]'::jsonb)
    from public.console_admins a join auth.users u on u.id = a.user_id where a.active and a.role <> 'viewer'
$$;

-- ---------------------------------------------------------------- "See as this firm"
-- read-only summary of the firm's main screens; in the same transaction: the audit row, the view log row, the firm's bell
create or replace function public.console_seeas(p_by uuid, p_firm uuid, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_view uuid := gen_random_uuid(); v_names boolean := false; v jsonb; t jsonb := '{}'::jsonb; x jsonb; n bigint;
  v_day date := (now() at time zone 'Asia/Kolkata')::date; v_words text;
begin
  v_role := public.console_role_check(p_by, array['owner', 'support']);
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'console: bad_value' using errcode = '22023'; end if;
  if not exists (select 1 from public.firms where id = p_firm) then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  -- client names only with the firm's own consent (a later migration makes firm_support_access; until then: counts only)
  if to_regclass('public.firm_support_access') is not null then
    begin
      execute 'select exists (select 1 from public.firm_support_access where firm_id = $1 and include_client_data and allowed_until > now())' into v_names using p_firm;
    exception when others then v_names := false;
    end;
  end if;
  v := public.console_seeas_body(p_firm, coalesce(v_names, false));
  -- Tally status: the firm's computers, its postings, how many clients have a Tally book
  if to_regclass('public.tally_devices') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'version', d.version, 'last_seen', d.last_seen,
                 'state', case when d.last_seen > now() - interval '5 minutes' then 'online' when d.last_seen > now() - interval '24 hours' then 'idle' else 'offline' end)
                 order by d.last_seen desc nulls last), '[]'::jsonb) from public.tally_devices d where d.firm_id = $1 and not coalesce(d.revoked, false)$q$
      into x using p_firm;
    t := t || jsonb_build_object('devices', x);
  end if;
  if to_regclass('public.tally_post_jobs') is not null then
    execute $q$select jsonb_build_object('waiting', count(*) filter (where status in ('waiting', 'taken', 'running')),
                 'failed_7d', count(*) filter (where status = 'failed' and updated_at > now() - interval '7 days'),
                 'done_7d', count(*) filter (where status = 'done' and updated_at > now() - interval '7 days'),
                 'last_done', max(updated_at) filter (where status = 'done'))
               from public.tally_post_jobs where firm_id = $1$q$ into x using p_firm;
    t := t || jsonb_build_object('postings', x);
  end if;
  if to_regclass('public.tally_books') is not null then
    execute 'select count(distinct client_id) from public.tally_books where firm_id = $1' into n using p_firm;
    t := t || jsonb_build_object('linked_clients', n);
  end if;
  v := v || jsonb_build_object('view_id', v_view, 'at', now(), 'client_data', coalesce(v_names, false), 'tally', t);

  -- the record: the view log, the audit row and the firm's bell, all in this transaction
  insert into public.console_view_log (id, admin_id, role, firm_id, reason, client_data, ip, user_agent)
  values (v_view, p_by, v_role, p_firm, btrim(p_reason), coalesce(v_names, false), left(p_ip, 64), left(p_ua, 300));
  v_words := 'FinCom support viewed your account on ' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY') || ': ' || left(btrim(p_reason), 300);
  perform public.console_audit_add(p_by, v_role, 'seeas.open', 'firm', p_firm::text, null,
    jsonb_build_object('view_id', v_view, 'client_data', coalesce(v_names, false), 'notice', to_regclass('public.tally_alerts') is not null), p_reason, p_ip, p_ua);
  if to_regclass('public.tally_alerts') is not null then
    -- device_id: the view's own id, so a second view on the same day is a notice of its own (tally_alerts_once is per day)
    execute $q$insert into public.tally_alerts (firm_id, client_id, kind, day, words, data, at, device_id)
               values ($1, null, 'summary', $2, $3, $4, now(), $5)$q$
      using p_firm, v_day, v_words, jsonb_build_object('what', 'support_view', 'view_id', v_view), v_view;
  end if;
  return v || jsonb_build_object('notice', v_words);
end $$;

-- the firm's part of the summary (plan, credit, clients, team, activity); used by console_seeas only
create or replace function public.console_seeas_body(p_firm uuid, p_names boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare f record;
begin
  select x.*, p.name as plan_name into f from public.firms x left join public.plans p on p.id = x.plan_id where x.id = p_firm;
  if not found then return null; end if;
  return jsonb_build_object(
    'firm', jsonb_build_object('id', f.id, 'name', f.name, 'status', f.status, 'status_reason', f.status_reason, 'created_at', f.created_at),
    'plan', jsonb_build_object('name', f.plan_name, 'id', f.plan_id, 'period_start', f.period_start),
    'credit', jsonb_build_object('balance', f.balance, 'low_balance_warn', f.low_balance_warn, 'charging', coalesce(f.active, true),
       'entries', (select coalesce(jsonb_agg(jsonb_build_object('at', w.at, 'kind', w.kind, 'code', w.code, 'qty', w.qty, 'amount', w.amount, 'balance_after', w.balance_after)
                    order by w.at desc), '[]'::jsonb)
                    from (select * from public.wallet_entries where firm_id = p_firm order by at desc limit 20) w)),
    'clients', jsonb_build_object(
       'total', (select count(*) from public.clients c where c.firm_id = p_firm and not coalesce(c.deleted, false)),
       'active', (select count(*) from public.clients c where c.firm_id = p_firm and not coalesce(c.deleted, false) and c.status = 'active'),
       'switched_off', (select count(*) from public.clients c where c.firm_id = p_firm and not coalesce(c.deleted, false) and c.status <> 'active'),
       'deleted', (select count(*) from public.clients c where c.firm_id = p_firm and coalesce(c.deleted, false)),
       'with_gstin', (select count(*) from public.clients c where c.firm_id = p_firm and not coalesce(c.deleted, false) and coalesce(c.gstin, '') <> ''),
       'names', case when p_names then (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'gstin', c.gstin, 'status', c.status) order by c.name), '[]'::jsonb)
                                          from public.clients c where c.firm_id = p_firm and not coalesce(c.deleted, false)) else null end),
    'team', jsonb_build_object(
       'active', (select count(*) from public.members m where m.firm_id = p_firm and m.active),
       'by_role', (select coalesce(jsonb_object_agg(r.role, r.n), '{}'::jsonb) from (select role, count(*) as n from public.members where firm_id = p_firm and active group by role) r)),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'what', a.what) order by a.at desc), '[]'::jsonb)
                   from (select at, what from public.activity where firm_id = p_firm order by at desc limit 20) a));
end $$;

-- the views of one firm (or every firm), newest first
create or replace function public.console_view_list(p_firm uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'at', v.at, 'admin', u.email, 'role', v.role, 'firm_id', v.firm_id, 'firm', f.name,
           'reason', v.reason, 'client_data', v.client_data) order by v.at desc), '[]'::jsonb)
    from (select * from public.console_view_log where p_firm is null or firm_id = p_firm order by at desc limit 5000) v
    left join auth.users u on u.id = v.admin_id left join public.firms f on f.id = v.firm_id
$$;

-- ---------------------------------------------------------------- exports
-- the all-firms credit ledger (wallet_entries) between two times (either may be null), newest first, at most p_limit rows
create or replace function public.console_ledger(p_from timestamptz, p_to timestamptz, p_limit integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total', (select count(*) from public.wallet_entries w where (p_from is null or w.at >= p_from) and (p_to is null or w.at < p_to)),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', w.id::text, 'at', w.at, 'firm_id', w.firm_id, 'firm', f.name, 'kind', w.kind, 'code', w.code,
              'qty', w.qty, 'amount', w.amount, 'amount_paise', round(w.amount * 100)::bigint, 'balance_after', w.balance_after, 'note', w.note, 'ref', w.ref)
              order by w.at desc, w.id desc)
              from (select * from public.wallet_entries x where (p_from is null or x.at >= p_from) and (p_to is null or x.at < p_to)
                     order by x.at desc, x.id desc limit least(greatest(coalesce(p_limit, 5000), 1), 50000)) w
              left join public.firms f on f.id = w.firm_id), '[]'::jsonb))
$$;

-- the whole change history for the Owner's export (newest first, at most p_limit rows)
create or replace function public.console_export_audit(p_limit integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total', (select count(*) from public.console_audit),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.at, 'who_email', u.email, 'role', x.role, 'action', x.action,
              'target_type', x.target_type, 'target_id', x.target_id, 'before', x.before, 'after', x.after, 'reason', x.reason, 'ip', x.ip) order by x.id desc)
              from (select * from public.console_audit order by id desc limit least(greatest(coalesce(p_limit, 5000), 1), 50000)) x
              left join auth.users u on u.id = x.who), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------- grants: the service role only
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'console\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

commit;
