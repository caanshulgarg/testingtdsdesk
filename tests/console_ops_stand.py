"""The shared stand-in for migrations 122 and 123 (tests/run_migration122.py, run_migration123.py): Supabase's auth tables,
FinCom's firm tables as the console reads them, the support desk (server/support/migration.sql, run for real on a
stand-in storage schema), tally_alerts as migration 47 makes it, platform_secrets as on staging, Vault's gsp_secret_get /
gsp_secret_put (a plain table here), pg_cron's and pgmq's tables (stand-ins), and made-up firms. Then migration 118.
    db = console_ops_stand.start(port)  ->  pg_stand.DB with all of it, 118 run"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand

U = lambda n: "00000000-0000-4000-8000-%012d" % n
OWNER, OWNER2, BILL, SUP, VIEW, NOBODY = U(1), U(2), U(3), U(4), U(5), U(6)
A1, A2, B1, C1 = U(11), U(12), U(13), U(14)          # firm logins
F1, F2, F3 = U(101), U(102), U(103)
P1, P2 = U(201), U(202)
DEV1, DEV2, DEV3 = U(301), U(302), U(303)

AUTH = r"""
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz,
  email_confirmed_at timestamptz default now(), banned_until timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, friendly_name text, factor_type text, status text, created_at timestamptz default now());
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
alter table firms add column if not exists plan_id uuid, add column if not exists balance numeric default 0, add column if not exists active boolean default true,
  add column if not exists created_at timestamptz default now(), add column if not exists low_balance_warn numeric default 500, add column if not exists period_start date;
alter table members add column if not exists email text;
-- my_firm() as on staging (security definer, search_path public: server/security/migration-2-mfa-audit.sql)
create or replace function public.my_firm() returns uuid language sql stable security definer set search_path to 'public' as $f$ select firm_id from public.members where user_id = auth.uid() and active $f$;
create table if not exists plans (id uuid primary key, name text, monthly_fee numeric, includes jsonb, active boolean default true);
create table if not exists wallet_entries (id bigserial primary key, firm_id uuid, at timestamptz default now(), kind text, code text, qty numeric, amount numeric, balance_after numeric, note text, ref text, by_user uuid);
create table if not exists activity (id bigserial primary key, firm_id uuid, user_id uuid, client_id text, what text, detail text, at timestamptz default now());
create table if not exists clients (id text, firm_id uuid, name text, gstin text, deleted boolean default false);
create table if not exists platform_admins (user_id uuid primary key, name text);
create table if not exists tally_devices (id uuid primary key default gen_random_uuid(), firm_id uuid, name text, last_seen timestamptz, version text, revoked boolean default false, created_at timestamptz default now());
create table if not exists tally_post_jobs (id uuid primary key default gen_random_uuid(), firm_id uuid, client_id text, status text, message text not null default '', created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists tally_jobs (id uuid primary key default gen_random_uuid(), firm_id uuid, client_id text not null, kind text, status text not null default 'queued', message text not null default '', created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists tally_recorder_failures (id bigserial primary key, firm_id uuid, why text, at timestamptz default now());
create table if not exists assistant_usage (firm_id uuid, day date, calls integer, cost_inr numeric, primary key (firm_id, day));
-- as on staging (migration 61's stand: name, value, set_at, set_by; RLS on, no select policy)
create table if not exists platform_secrets (name text primary key, value text not null, set_at timestamptz not null default now(), set_by uuid);
alter table platform_secrets enable row level security;
-- Vault, as gsp_secret_get / gsp_secret_put show it (migration 16; a plain table here)
create table if not exists vault_stand (name text primary key, value text);
create or replace function public.gsp_secret_put(p_name text, p_value text) returns uuid language plpgsql security definer set search_path = public as $f$
begin insert into vault_stand values (p_name, p_value) on conflict (name) do update set value = excluded.value; return gen_random_uuid(); end $f$;
create or replace function public.gsp_secret_get(p_name text) returns text language sql stable security definer set search_path = public as $f$ select value from vault_stand where name = p_name $f$;
revoke all on function public.gsp_secret_put(text, text), public.gsp_secret_get(text) from public, anon, authenticated;
grant execute on function public.gsp_secret_put(text, text), public.gsp_secret_get(text) to service_role;
-- the bell's table, as migration 47 makes it
create table if not exists public.tally_alerts (id bigserial primary key, firm_id uuid not null, client_id text, book_id uuid, device_id uuid,
  kind text not null check (kind in ('gap', 'silent', 'summary')), day date not null, words text not null default '', data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now(), read_at timestamptz, read_by uuid);
create unique index if not exists tally_alerts_once on public.tally_alerts (firm_id, kind, (coalesce(book_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  (coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)), day);
-- storage, for the support desk's own migration
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $f$ select string_to_array(name, '/') $f$;
"""
CRON = r"""
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, schedule text, command text, active boolean default true, jobname text);
create table if not exists cron.job_run_details (runid bigserial primary key, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz);
create schema if not exists pgmq;
create or replace function pgmq.metrics_all() returns table (queue_name text, queue_length bigint, newest_msg_age_sec integer, oldest_msg_age_sec integer, total_messages bigint, scrape_time timestamptz)
language sql as $f$ select 'tally_recorder'::text, 4::bigint, 10, 900, 1200::bigint, now() union all select 'books_sync', 0, null, null, 50, now() $f$;
insert into cron.job (schedule, command, jobname) values ('* * * * *', 'select 1', 'tally-post-register-settle'), ('0 2 * * *', 'select 2', 'monthly-run');
insert into cron.job_run_details (jobid, status, return_message, start_time, end_time) values
  (1, 'succeeded', '1 row', now() - interval '2 minutes', now() - interval '119 seconds'),
  (1, 'failed', 'ERROR: deadlock detected', now() - interval '3 hours', now() - interval '3 hours'),
  (2, 'succeeded', 'ok', now() - interval '2 days', now() - interval '2 days');
"""
FIX = r"""
insert into auth.users (id, email, last_sign_in_at) values
 ('%(O)s', 'anshul@fincom.live', now()), ('%(O2)s', 'second@fincom.live', now()), ('%(B)s', 'bill@fincom.live', now()),
 ('%(S)s', 'sup@fincom.live', now()), ('%(V)s', 'view@fincom.live', null), ('%(N)s', 'nobody@fincom.live', null),
 ('%(A1)s', 'owner@abc.test', now() - interval '1 day'), ('%(A2)s', 'staff@abc.test', now() - interval '10 days'),
 ('%(B1)s', 'owner@gsc.test', now() - interval '20 days'), ('%(C1)s', 'off@gsc.test', null);
insert into plans values ('%(P1)s', 'Pay as you go', 0, '{}'), ('%(P2)s', 'Monthly, all included', 4000, '{}');
insert into firms (id, name, plan_id, balance, created_at) values ('%(F1)s', 'ABC Associates', '%(P1)s', 1000, now() - interval '30 days'),
  ('%(F2)s', 'Garg Shekhar & Co', '%(P2)s', 175, now() - interval '2 days'), ('%(F3)s', 'Third Firm', '%(P2)s', 50, now() - interval '1 day');
insert into members (user_id, firm_id, name, email, role, active) values ('%(A1)s', '%(F1)s', 'Asha', 'owner@abc.test', 'owner', true),
 ('%(A2)s', '%(F1)s', 'Ravi', 'staff@abc.test', 'staff', true), ('%(B1)s', '%(F2)s', 'Bina', 'owner@gsc.test', 'owner', true), ('%(C1)s', '%(F2)s', 'Chand', 'off@gsc.test', 'readonly', false);
insert into clients (id, firm_id, name, gstin) values ('c1', '%(F1)s', 'SECRET CLIENT ONE', '27AAACS1234A1Z5'), ('c2', '%(F1)s', 'SECRET CLIENT TWO', ''), ('c3', '%(F1)s', 'GONE', ''), ('c4', '%(F2)s', 'SECRET THREE', '');
update clients set deleted = true where id = 'c3';
insert into activity (firm_id, user_id, client_id, what, detail, at) values ('%(F1)s', '%(A1)s', 'c1', 'post.voucher', 'SECRET CLIENT ONE detail', now() - interval '1 hour');
insert into tally_devices (id, firm_id, name, last_seen, version) values ('%(D1)s', '%(F1)s', 'PC1', now() - interval '1 minute', '2.4.7'),
  ('%(D2)s', '%(F2)s', 'PC2', now() - interval '2 hours', '2.4.5'), ('%(D3)s', '%(F2)s', 'PC3', now() - interval '3 days', '2.3.0');
insert into tally_devices (firm_id, name, last_seen, revoked) values ('%(F1)s', 'OLD', now(), true);
insert into tally_post_jobs (firm_id, client_id, status, message, created_at, updated_at) values
  ('%(F1)s', 'c1', 'failed', 'Tally said: ledger SECRET not found', now() - interval '1 hour', now() - interval '1 hour'),
  ('%(F1)s', 'c1', 'failed', 'old failure', now() - interval '40 days', now() - interval '40 days'),
  ('%(F1)s', 'c2', 'waiting', '', now() - interval '10 minutes', now() - interval '10 minutes'),
  ('%(F2)s', 'c4', 'running', '', now() - interval '2 hours', now() - interval '1 hour'),
  ('%(F1)s', 'c1', 'done', '', now() - interval '1 day', now() - interval '1 day');
insert into tally_jobs (firm_id, client_id, kind, status, message) values ('%(F1)s', 'c1', 'daybook', 'queued', ''), ('%(F2)s', 'c4', 'reparse', 'failed', 'bad xml');
insert into tally_recorder_failures (firm_id, why) values ('%(F1)s', 'x');
insert into assistant_usage values ('%(F1)s', (now() at time zone 'Asia/Kolkata')::date, 7, 12.5);
insert into wallet_entries (firm_id, kind, code, qty, amount, balance_after, note, at) values ('%(F1)s', 'topup', null, 1, 1000, 1000, 'opening', now() - interval '10 days'),
  ('%(F1)s', 'charge', 'claude', 1, -3.5, 996.5, null, now() - interval '2 hours'), ('%(F1)s', 'charge', 'vision', 2, -2, 994.5, null, now() - interval '3 days'),
  ('%(F2)s', 'charge', 'bill', 1, -2, 173, null, now() - interval '1 day');
insert into platform_secrets (name, value, set_at) values ('claude_api_key', 'sk-ant-OLDKEY-abcd', now() - interval '200 days'), ('call_guest_secret', 'short', now());
insert into vault_stand values ('gsp:taxpro:aspid', 'ASP-0000-OLD-1234');
"""
FIXV = {"O": OWNER, "O2": OWNER2, "B": BILL, "S": SUP, "V": VIEW, "N": NOBODY, "A1": A1, "A2": A2, "B1": B1, "C1": C1, "F1": F1, "F2": F2, "F3": F3,
        "P1": P1, "P2": P2, "D1": DEV1, "D2": DEV2, "D3": DEV3}
ADMINS = r"""
insert into public.console_admins (user_id, role) values ('%(O)s', 'owner'), ('%(B)s', 'billing'), ('%(S)s', 'support'), ('%(V)s', 'viewer') on conflict do nothing;
""" % FIXV
SUPPORT = r"""
-- support_new as a firm person would (auth.uid() from the stand's setting)
set fincom.uid = '%(A1)s';
select public.support_new('Cannot post to Tally', 'Tally', 'problem', 'high', 'It fails every time', '{}'::jsonb, '[]'::jsonb);
set fincom.uid = '%(B1)s';
select public.support_new('Billing question', 'Billing', 'billing', 'low', 'Why this charge?', '{}'::jsonb, '[]'::jsonb);
reset fincom.uid;
update public.support_tickets set created_at = now() - interval '10 hours', respond_by = now() - interval '6 hours' where subject = 'Cannot post to Tally';
""" % FIXV

ROOT = os.path.normpath(os.path.join(HERE, ".."))
M118 = os.path.join(ROOT, "server", "console", "migration-118-console-foundation.sql")
SUPPORT_SQL = os.path.join(ROOT, "server", "support", "migration.sql")

def start(port, cron=True):
    db = pg_stand.start(port)
    db.sql(AUTH)
    db.sql(open(SUPPORT_SQL).read())
    db.sql(FIX % FIXV)
    if cron: db.sql(CRON)
    db.sql(open(M118).read())
    db.sql(ADMINS)
    db.sql(SUPPORT)
    return db
