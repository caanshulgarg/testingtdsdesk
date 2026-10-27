"""coupons_pg_fixture.py - the made-up database the coupons' tests share (run_migration120.py, run_coupon_box_ui.py): on a
pg_stand database (never a real one), stand-ins for Supabase's auth tables and FinCom's firm tables, my_firm() as staging
has it, made-up firms, logins and plans; CREDIT_STUB, billing's console_credit_post (migration 119, another branch) with
the same signature, made by a TEST only (it records each call in test_credit_posts and adds to firms.balance)."""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
M118 = os.path.join(HERE, "..", "server", "console", "migration-118-console-foundation.sql")
M120 = os.path.join(HERE, "..", "server", "console", "migration-120-coupons.sql")
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
create table if not exists plans (id uuid primary key, name text, monthly_fee numeric, includes jsonb, active boolean default true);
create table if not exists wallet_entries (id bigserial primary key, firm_id uuid, at timestamptz default now(), kind text, code text, qty numeric, amount numeric, balance_after numeric, note text, ref text, by_user uuid);
create table if not exists activity (id bigserial primary key, firm_id uuid, user_id uuid, client_id text, what text, detail text, at timestamptz default now());
create table if not exists clients (id text, firm_id uuid, name text, gstin text, deleted boolean default false);
create table if not exists platform_admins (user_id uuid primary key);
create table if not exists tally_devices (id uuid primary key default gen_random_uuid(), firm_id uuid, name text, last_seen timestamptz, version text, revoked boolean default false);
create table if not exists tally_post_jobs (id uuid primary key default gen_random_uuid(), firm_id uuid, client_id text, status text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists assistant_usage (firm_id uuid, day date, calls integer, cost_inr numeric, primary key (firm_id, day));
-- my_firm() as staging has it: its own search_path (pg_stand's plain one leans on the caller's)
create or replace function public.my_firm() returns uuid language sql stable security definer set search_path = public as $$ select firm_id from public.members where user_id = auth.uid() and active $$;
"""
# billing's function (migration 119, another branch): a stub with the same signature, made by the TEST only
CREDIT_STUB = r"""
create table if not exists test_credit_posts (n bigserial, firm uuid, amount bigint, kind text, ref text, reason text, by_user uuid);
create or replace function public.console_credit_post(p_firm uuid, p_amount_paise bigint, p_kind text, p_ref text, p_reason text, p_by uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  insert into public.test_credit_posts (firm, amount, kind, ref, reason, by_user) values (p_firm, p_amount_paise, p_kind, p_ref, p_reason, p_by);
  update public.firms set balance = balance + p_amount_paise / 100.0 where id = p_firm;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.console_credit_post(uuid, bigint, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.console_credit_post(uuid, bigint, text, text, text, uuid) to service_role;
"""
U = lambda n: "00000000-0000-4000-8000-%012d" % n
OWNER, BILL, SUP, VIEW = U(1), U(3), U(4), U(5)
A1, A2, B1, C1, D1, E1, G1, H1 = U(11), U(12), U(13), U(14), U(15), U(16), U(17), U(18)   # firm logins (owners, but A2 staff)
F1, F2, F3, F4, F5, F6, F7 = U(101), U(102), U(103), U(104), U(105), U(106), U(107)
P1, P2 = U(201), U(202)
FIX = r"""
insert into auth.users (id, email) values ('%(O)s', 'anshul@fincom.live'), ('%(B)s', 'bill@fincom.live'), ('%(S)s', 'sup@fincom.live'), ('%(V)s', 'view@fincom.live'),
 ('%(A1)s', 'owner@abc.test'), ('%(A2)s', 'staff@abc.test'), ('%(B1)s', 'owner@gsc.test'), ('%(C1)s', 'owner@old.test'), ('%(D1)s', 'owner@paused.test'),
 ('%(E1)s', 'owner@e.test'), ('%(G1)s', 'owner@g.test'), ('%(H1)s', 'owner@h.test');
insert into plans values ('%(P1)s', 'Pay as you go', 0, '{}'), ('%(P2)s', 'Monthly, all included', 4000, '{}');
insert into firms (id, name, plan_id, balance, created_at) values
 ('%(F1)s', 'ABC Associates', '%(P1)s', 0, now() - interval '3 days'), ('%(F2)s', 'Garg Shekhar & Co', '%(P2)s', 0, now() - interval '2 days'),
 ('%(F3)s', 'Old Firm', '%(P1)s', 0, now() - interval '400 days'), ('%(F4)s', 'Paused Firm', '%(P1)s', 0, now() - interval '1 day'),
 ('%(F5)s', 'E Firm', '%(P1)s', 0, now() - interval '1 day'), ('%(F6)s', 'G Firm', '%(P1)s', 0, now() - interval '1 day'), ('%(F7)s', 'H Firm', '%(P1)s', 0, now() - interval '1 day');
insert into members (user_id, firm_id, name, email, role, active) values ('%(A1)s', '%(F1)s', 'Asha', 'owner@abc.test', 'owner', true),
 ('%(A2)s', '%(F1)s', 'Ravi', 'staff@abc.test', 'staff', true), ('%(B1)s', '%(F2)s', 'Bina', 'owner@gsc.test', 'owner', true),
 ('%(C1)s', '%(F3)s', 'Chand', 'owner@old.test', 'owner', true), ('%(D1)s', '%(F4)s', 'Dev', 'owner@paused.test', 'owner', true),
 ('%(E1)s', '%(F5)s', 'Esha', 'owner@e.test', 'owner', true), ('%(G1)s', '%(F6)s', 'Gita', 'owner@g.test', 'owner', true), ('%(H1)s', '%(F7)s', 'Hari', 'owner@h.test', 'owner', true);
""" % {"O": OWNER, "B": BILL, "S": SUP, "V": VIEW, "A1": A1, "A2": A2, "B1": B1, "C1": C1, "D1": D1, "E1": E1, "G1": G1, "H1": H1,
       "F1": F1, "F2": F2, "F3": F3, "F4": F4, "F5": F5, "F6": F6, "F7": F7, "P1": P1, "P2": P2}


def setup(db, run120=True, stub=False):
    """the stand-ins, the made-up rows, migration 118, the console admins; then 120 (and the credit stub) when asked"""
    import pg_stand
    db.sql(AUTH); db.sql(FIX)
    db.sql(pg_stand.migration_body(M118))
    db.sql("insert into public.console_admins (user_id, role) values ('%s', 'owner'), ('%s', 'billing'), ('%s', 'support'), ('%s', 'viewer')" % (OWNER, BILL, SUP, VIEW))
    db.sql("update firms set status = 'suspended' where id = '%s'" % F4)
    if run120: db.sql(open(M120).read())
    if stub: db.sql(CREDIT_STUB)
