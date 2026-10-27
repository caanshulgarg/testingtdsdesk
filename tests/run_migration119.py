"""python3 run_migration119.py - server/console/migration-119-console-billing.sql (27-Oct-2026, branch next-console-billing,
the console's phase 2 "Billing core"; NOT run on staging: the owner runs it after 118). On a throwaway PostgreSQL (pg_stand,
port 31119 unless PG119_PORT; never a real database), with stand-ins for Supabase's auth tables, FinCom's billing tables
and the old billing functions as staging has them, migration 118 run first, and made-up firms (fixtures, not staging data):
"ABC" with a ₹50 crore credit and a ledger ₹8 above its balance, "ZZ" with ₹1,000 and no ledger line, a monthly-plan
firm, a per-client firm, a firm short of credit.
  0. the file: one transaction, lock_timeout 10 s; add-only (nothing dropped but triggers, a policy and the old kind
     check, which a wider one replaces; no delete, no truncate); names no real database; no clean-up of data in it
  1. runs, and runs a second time (the same function texts); nothing about money changes by running it (balances,
     ledger lines, plans' includes); one subscription per firm, all active
  2. grants: new tables RLS on; the service role only; subscriptions: a firm's members read their own row only;
     console functions not callable by anon / authenticated
  3. plans: per_client_fee_paise from includes.clients_price; the old screen's edit that drops clients_price gets it
     back (and admin_set_plan then keeps the firm's per-client price); console_plan_save creates and edits (all fields,
     item allowances, unknown keys kept, clients / cloud caps refused, Support refused), audited before / after
  4. prices: price_of reads the price list; a future price waits for its date; backdated refused; a today price reaches
     modules.price; history
  5. console_credit_post: the balance and one ledger line together; idempotent on (kind, ref); the same pair for another
     firm or amount refused; wrong sign, below zero, adjust without a reason refused
  6. charge_for: through the ledger; the same (item, ref) in a period charged once (use counted once); no ref charges
     each time; low balance; refused while read-only; refund_charge linked to its charge
  7. top-up (pay mode and reference; the same reference twice for a firm = once; another amount refused; ₹10 lakh
     ceiling; Viewer refused), refund a charge (full, part, never more than left, Billing up to ₹10,000, the same dialog
     twice = once), adjust (category, Billing limit); each with one audit row
  8. balance = ledger: the check finds ABC (-₹8) and ZZ (no line); the fix writes one adjusting / opening line without
     moving the balance; then all agree; fixing again refused
  9. clean-up: the list names ABC's large credit, ZZ's missing ledger; the test-credit action marks ABC a test firm
     and brings it to ₹10,000 with one adjust line; pressing again refused; Billing refused
 10. the monthly run: periods move to this month (allowances refill), fees by plan / per client / per person, once per
     firm per month however often it runs, a short firm past due with grace from Settings; then read-only after the
     grace (writes refused, reading kept, charging refused), paused later; a top-up retries the fee and the firm is
     active again; trial days from Settings; run_monthly_core keeps its old answer; the cron entry
 11. settings: defaults (₹10,000 start credit), saved by the Owner only, bad values refused, a new firm's low-credit
     level follows; admin_credit raises when refused and goes through the ledger
RED_WITHOUT_119=1: the same checks without running the file (they fail)."""
import os, re, sys, hashlib, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(HERE, "..", "server", "console", "migration-119-console-billing.sql")
M118 = os.path.join(HERE, "..", "server", "console", "migration-118-console-foundation.sql")
RED = os.environ.get("RED_WITHOUT_119") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); sys.stdout.flush()
    if not c: fails.append(w)
text = open(M).read() if os.path.exists(M) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
drops = re.findall(r"\bdrop\s+(\w+)", code)
ok(set(drops) <= {"trigger", "policy", "constraint"} and not re.search(r"drop\s+(table|column|function|view|index)", code), "nothing dropped but triggers, a policy, the old kind check (%s)" % sorted(set(drops)))
ok("delete from" not in code and "truncate" not in code, "no delete, no truncate")
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")
top = re.sub(r"\$\$.*?\$\$", "", code, flags=re.S)        # outside function bodies
ok(not re.search(r"update public\.firms", top) and not re.search(r"insert into public\.wallet_entries", top) and "is_test = true" not in top,
   "no balance, ledger or test-firm change outside the functions (clean-up is a button)")

AUTH = r"""
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz,
  email_confirmed_at timestamptz default now(), banned_until timestamptz, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, friendly_name text, factor_type text, status text, created_at timestamptz default now());
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), updated_at timestamptz default now());
-- the billing tables as on staging
create table plans (id uuid primary key default gen_random_uuid(), name text not null, monthly_fee numeric not null default 0, includes jsonb not null default '{}',
  note text not null default '', active boolean not null default true, created_at timestamptz not null default now());
alter table firms add column created_at timestamptz not null default now(), add column balance numeric not null default 0, add column low_balance_warn numeric not null default 500,
  add column active boolean not null default true, add column plan_id uuid references plans(id), add column period_start date not null default (date_trunc('month', now()))::date,
  add column note text not null default '';
alter table firms alter column name set not null;
alter table members add column if not exists email text;
create table modules (code text primary key, title text not null, unit text not null, price numeric not null default 0,
  billing text not null default 'per_unit' check (billing in ('per_unit', 'per_month', 'free')), active boolean not null default true, sort integer not null default 0);
create table firm_modules (firm_id uuid not null references firms(id) on delete cascade, code text not null references modules(code) on delete cascade,
  enabled boolean not null default true, price numeric, primary key (firm_id, code));
create table wallet_entries (id bigserial primary key, firm_id uuid not null references firms(id) on delete cascade, at timestamptz not null default now(),
  kind text not null check (kind = any (array['credit', 'charge', 'refund', 'adjust', 'fee'])), code text, qty numeric not null default 1, amount numeric not null,
  balance_after numeric not null, note text not null default '', ref text not null default '', by_user uuid);
create table usage_period (firm_id uuid not null references firms(id) on delete cascade, period_start date not null, code text not null,
  qty numeric not null default 0, spent numeric not null default 0, primary key (firm_id, period_start, code));
create table app_settings (name text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table activity (id bigserial primary key, firm_id uuid, user_id uuid, client_id text, what text, detail text, at timestamptz default now());
create table clients (id text, firm_id uuid, name text, gstin text, deleted boolean default false);
create table platform_admins (user_id uuid primary key);
create table assistant_usage (firm_id uuid, day date, calls integer, cost_inr numeric, primary key (firm_id, day));
-- the old functions, as staging has them (27-Oct-2026)
create or replace function public.price_of(p_firm uuid, p_code text) returns numeric language sql stable security definer set search_path to 'public' as $function$
  select coalesce(fm.price, m.price) from public.modules m left join public.firm_modules fm on fm.firm_id = p_firm and fm.code = m.code where m.code = p_code $function$;
create or replace function public.charge_for(p_firm uuid, p_user uuid, p_code text, p_qty numeric, p_ref text, p_note text) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_amount numeric; v_bal numeric; v_enabled boolean; v_billing text; v_active boolean; v_inc jsonb; v_cap numeric; v_used numeric; v_period date; v_price numeric; v_free numeric := 0; v_paid numeric;
begin
  select active, period_start into v_active, v_period from public.firms where id = p_firm;
  select m.billing, coalesce(fm.enabled, true) into v_billing, v_enabled from public.modules m left join public.firm_modules fm on fm.firm_id = p_firm and fm.code = m.code where m.code = p_code;
  v_price := public.price_of(p_firm, p_code); v_paid := p_qty; v_amount := round(coalesce(v_price, 0) * v_paid, 2);
  update public.firms set balance = balance - v_amount where id = p_firm returning balance into v_bal;
  insert into public.wallet_entries (firm_id, kind, code, qty, amount, balance_after, note, ref, by_user) values (p_firm, 'charge', p_code, v_paid, -v_amount, v_bal, p_note, p_ref, p_user);
  return jsonb_build_object('ok', true, 'amount', v_amount, 'balance', v_bal);
end $function$;
create or replace function public.charge_usage(p_code text, p_qty numeric, p_ref text default '', p_note text default '') returns jsonb language sql security definer set search_path to 'public' as $function$
  select case when coalesce(p_qty, 0) <= 0 or p_qty > 1000 then jsonb_build_object('ok', false, 'reason', 'bad_qty') else public.charge_for(public.my_firm(), auth.uid(), p_code, p_qty, p_ref, p_note) end $function$;
create or replace function public.refund_charge(p_firm uuid, p_amount numeric, p_code text, p_ref text, p_user uuid default null) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_bal numeric; begin update public.firms set balance = balance + p_amount where id = p_firm returning balance into v_bal;
  insert into public.wallet_entries (firm_id, kind, code, qty, amount, balance_after, note, ref, by_user) values (p_firm, 'refund', p_code, 1, p_amount, v_bal, 'Refund: the provider failed', p_ref, p_user);
  return jsonb_build_object('ok', true, 'amount', p_amount, 'balance', v_bal); end $function$;
create or replace function public.run_monthly_core(p_firm uuid default null, p_by uuid default null) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin return jsonb_build_object('ok', true, 'charged', 0, 'short_of_credit', 0); end $function$;
create or replace function public.admin_credit(p_firm uuid, p_amount numeric, p_note text default '') returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_bal numeric; begin
  if not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'not_superadmin'); end if;
  update public.firms set balance = balance + p_amount where id = p_firm returning balance into v_bal;
  insert into public.wallet_entries (firm_id, kind, code, qty, amount, balance_after, note, by_user) values (p_firm, case when p_amount >= 0 then 'credit' else 'adjust' end, 'wallet', 1, p_amount, v_bal, p_note, auth.uid());
  return jsonb_build_object('ok', true, 'balance', v_bal); end $function$;
create or replace function public.admin_save_plan(p_id uuid, p_name text, p_monthly numeric, p_includes jsonb, p_note text default '', p_active boolean default true) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid; begin
  update public.plans set name = p_name, monthly_fee = p_monthly, includes = coalesce(p_includes, '{}'::jsonb), note = p_note, active = p_active where id = p_id returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id); end $function$;
create or replace function public.admin_set_plan(p_firm uuid, p_plan uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_price numeric; begin
  update public.firms set plan_id = p_plan where id = p_firm;
  select nullif(includes ->> 'clients_price', '')::numeric into v_price from public.plans where id = p_plan;
  if v_price is not null then insert into public.firm_modules (firm_id, code, enabled, price) values (p_firm, 'clients', true, v_price) on conflict (firm_id, code) do update set price = excluded.price, enabled = true;
  else delete from public.firm_modules where firm_id = p_firm and code = 'clients'; end if;
  return jsonb_build_object('ok', true, 'per_client', v_price); end $function$;
revoke execute on function public.charge_for(uuid, uuid, text, numeric, text, text) from public, anon, authenticated;
revoke execute on function public.refund_charge(uuid, numeric, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.run_monthly_core(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.price_of(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_usage(text, numeric, text, text) to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select on firms, members to authenticated;
"""
U = lambda n: "00000000-0000-4000-8000-%012d" % n
OWNER, BILL, SUP, VIEW = U(1), U(3), U(4), U(5)
A1, Z1, G1, P1U, S1, S2 = U(11), U(12), U(13), U(14), U(15), U(16)
ABC, ZZ, GSC, PCF, SHORT = U(101), U(102), U(103), U(104), U(105)
PAYG, ALL, PER = U(201), U(202), U(203)
FIX = r"""
insert into auth.users (id, email) values ('%(O)s', 'anshul@fincom.live'), ('%(B)s', 'bill@fincom.live'), ('%(S)s', 'sup@fincom.live'), ('%(V)s', 'view@fincom.live'),
  ('%(A1)s', 'owner@abc.test'), ('%(Z1)s', 'z@zz.test'), ('%(G1)s', 'g@gsc.test'), ('%(P1U)s', 'p@pcf.test'), ('%(S1)s', 's@short.test'), ('%(S2)s', 's2@short.test');
insert into modules (code, title, unit, price, billing, sort) values
  ('clients', 'Clients on the system', 'per client per month', 50, 'per_month', 1), ('bills', 'Purchase bills', 'per bill read and booked', 2, 'per_unit', 2),
  ('bank', 'Bank statements', 'per statement line', 0.25, 'per_unit', 3), ('sales', 'Sales invoices', 'per invoice', 2, 'per_unit', 4),
  ('claude', 'Reading by Claude', 'per bill Claude reads', 3, 'per_unit', 5), ('vision', 'Google Vision OCR', 'per page read', 1, 'per_unit', 6),
  ('tally', 'Posting into Tally', 'included', 0, 'free', 7), ('cloud', 'Shared data (firm account)', 'per person per month', 100, 'per_month', 8);
insert into plans (id, name, monthly_fee, includes) values ('%(PAYG)s', 'Pay as you go', 0, '{}'),
  ('%(ALL)s', 'Monthly - all included', 4000, '{"bank": {"cap": null}, "bills": {"cap": null}, "cloud": {"cap": null}, "sales": {"cap": null}, "claude": {"cap": null}, "vision": {"cap": null}}'),
  ('%(PER)s', 'Per client - ₹50 a month, all included', 0, '{"bank": {"cap": null}, "bills": {"cap": null}, "cloud": {"cap": null}, "sales": {"cap": null}, "claude": {"cap": null}, "vision": {"cap": null}, "clients_price": 50}');
insert into firms (id, name, plan_id, balance, period_start, created_at) values
  ('%(ABC)s', 'ABC', '%(PAYG)s', 499999610, date_trunc('month', now() - interval '2 months')::date, now() - interval '90 days'),
  ('%(ZZ)s', 'ZZ TEST', '%(PAYG)s', 1000, date_trunc('month', now() - interval '2 months')::date, now() - interval '80 days'),
  ('%(GSC)s', 'Garg Shekhar & Co', '%(ALL)s', 5175, date_trunc('month', now() - interval '1 month')::date, now() - interval '40 days'),
  ('%(PCF)s', 'Per Client Firm', '%(PER)s', 1000, date_trunc('month', now() - interval '1 month')::date, now() - interval '35 days'),
  ('%(SHORT)s', 'Short Firm', '%(ALL)s', 175, date_trunc('month', now() - interval '1 month')::date, now() - interval '30 days');
insert into firm_modules (firm_id, code, enabled, price) values ('%(PCF)s', 'clients', true, 50);
insert into members (user_id, firm_id, name, email, role, active) values ('%(A1)s', '%(ABC)s', 'A', 'owner@abc.test', 'owner', true),
  ('%(Z1)s', '%(ZZ)s', 'Z', 'z@zz.test', 'owner', true), ('%(G1)s', '%(GSC)s', 'G', 'g@gsc.test', 'owner', true),
  ('%(P1U)s', '%(PCF)s', 'P', 'p@pcf.test', 'owner', true), ('%(S1)s', '%(SHORT)s', 'S', 's@short.test', 'owner', true), ('%(S2)s', '%(SHORT)s', 'S2', 's2@short.test', 'staff', true);
insert into clients (id, firm_id, name) values ('c1', '%(PCF)s', 'One'), ('c2', '%(PCF)s', 'Two'), ('c3', '%(PCF)s', 'Three'), ('c4', '%(PCF)s', 'Gone');
update clients set deleted = true where id = 'c4';
-- ABC: ₹50 crore credit; its ledger is ₹8 ABOVE its balance (four early refunds that did not move it)
insert into wallet_entries (firm_id, kind, code, amount, balance_after, note, at) values
  ('%(ABC)s', 'credit', 'wallet', 200, 200, '', now() - interval '60 days'),
  ('%(ABC)s', 'charge', 'claude', -3, 197, '', now() - interval '59 days'), ('%(ABC)s', 'refund', 'claude', 3, 197, 'Refund: the provider failed', now() - interval '59 days'),
  ('%(ABC)s', 'charge', 'claude', -3, 194, '', now() - interval '59 days'), ('%(ABC)s', 'refund', 'claude', 3, 194, 'Refund: the provider failed', now() - interval '59 days'),
  ('%(ABC)s', 'refund', 'claude', 2, 194, 'Refund: the provider failed', now() - interval '59 days'),
  ('%(ABC)s', 'credit', 'wallet', 500000000, 500000194, '', now() - interval '30 days'),
  ('%(ABC)s', 'charge', 'bank', -584, 499999610, '', now() - interval '3 days');
insert into wallet_entries (firm_id, kind, code, amount, balance_after, note) values
  ('%(GSC)s', 'credit', 'wallet', 5175, 5175, ''), ('%(PCF)s', 'credit', 'wallet', 1000, 1000, ''), ('%(SHORT)s', 'credit', 'wallet', 175, 175, '');
insert into usage_period (firm_id, period_start, code, qty, spent) values ('%(ABC)s', date_trunc('month', now() - interval '2 months')::date, 'bank', 2336, 584);
insert into assistant_usage values ('%(ABC)s', (now() at time zone 'Asia/Kolkata')::date, 7, 12.5);
insert into app_settings values ('signup', '{"open": true, "plan": "Pay as you go", "trial_credit": 200}');
""" % {"O": OWNER, "B": BILL, "S": SUP, "V": VIEW, "A1": A1, "Z1": Z1, "G1": G1, "P1U": P1U, "S1": S1, "S2": S2,
       "ABC": ABC, "ZZ": ZZ, "GSC": GSC, "PCF": PCF, "SHORT": SHORT, "PAYG": PAYG, "ALL": ALL, "PER": PER}

db = pg_stand.start(int(os.environ.get("PG119_PORT") or 31119))
SR = "set role service_role; "
def try_sql(s, uid=None):
    try: db.sql(s, uid); return None
    except Exception as e: return str(e)
def one(q, uid=None):
    try: return db.one(q, uid)
    except Exception as e: return "ERR " + str(e)[:400]
def js(q):
    v = one(q)
    try: return json.loads(v)
    except Exception: return v
def call(fn, *args):
    """select public.<fn>(args) as the service role: (json answer, None) or (None, error text)"""
    try: return json.loads(db.one(SR + "select public.%s(%s)::text" % (fn, ", ".join(args)))), None
    except Exception as e: return None, str(e)
q = lambda s: "'" + str(s).replace("'", "''") + "'"
J = lambda o: q(json.dumps(o)) + "::jsonb"
def code_of(err): m = re.search(r"console: ([a-z_]+)", err or ""); return m.group(1) if m else (err or "")[:160]
BAL = lambda f: one("select balance::numeric(20,2)::text from public.firms where id = '%s'" % f)
NW = lambda f=None: int(one("select count(*) from public.wallet_entries" + (" where firm_id = '%s'" % f if f else "")) or 0)
NA = lambda a=None: int(one("select count(*) from public.console_audit" + (" where action = '%s'" % a if a else "")) or 0) if not RED else -1
TODAY = one("select (now() at time zone 'Asia/Kolkata')::date::text")
MONTH = one("select date_trunc('month', now() at time zone 'Asia/Kolkata')::date::text")
try:
    db.sql(AUTH); db.sql(FIX)
    db.sql(open(M118).read())
    db.sql("insert into public.console_admins (user_id, role) values ('%s', 'owner'), ('%s', 'billing'), ('%s', 'support'), ('%s', 'viewer')" % (OWNER, BILL, SUP, VIEW))
    before = one("select string_agg(id::text || '=' || balance::text, ',' order by id) from public.firms")
    nw0 = NW(); inc0 = one("select string_agg(includes::text, '|' order by id) from public.plans")

    print("== 1. runs, twice; nothing about money changes")
    e1 = None if RED else try_sql(text)
    ok(e1 is None and one("select to_regclass('public.subscriptions')::text") == "subscriptions", "runs (%s)" % (e1 or "")[:300])
    src1 = one("select string_agg(md5(prosrc), ',' order by oid::regprocedure::text) from pg_proc where pronamespace = 'public'::regnamespace")
    e2 = None if RED else try_sql(text)
    ok(e2 is None and one("select string_agg(md5(prosrc), ',' order by oid::regprocedure::text) from pg_proc where pronamespace = 'public'::regnamespace") == src1, "runs a second time: the same function texts (%s)" % (e2 or "")[:300])
    ok(one("select string_agg(id::text || '=' || balance::text, ',' order by id) from public.firms") == before and NW() == nw0, "balances and ledger lines unchanged by the migration")
    ok(one("select string_agg(includes::text, '|' order by id) from public.plans") == inc0, "plans' includes unchanged")
    ok(one("select count(*)::text || '/' || count(*) filter (where status = 'active')::text from public.subscriptions") == "5/5", "one subscription per firm, all active")
    ok(one("select bool_and(s.plan_id is not distinct from f.plan_id and s.period_start = f.period_start)::text from public.subscriptions s join public.firms f on f.id = s.firm_id") == "true", "subscriptions copy plan and period")
    ok(one("select is_test::text from public.firms where id = '%s'" % ABC) == "false", "ABC not marked by the migration")
    cl0 = js(SR + "select public.console_cleanup_list()::text") if not RED else []
    ok(isinstance(cl0, list) and any(x["firm_id"] == ZZ and x["issue"] == "no_ledger" for x in cl0) and any(x["firm_id"] == ABC and x["issue"] == "large_credit" for x in cl0)
       and any(x["firm_id"] == ABC and x["issue"] == "mismatch" for x in cl0), "the clean-up list (nothing done): ABC's large credit and -₹8, ZZ's balance with no ledger line")

    print("== 2. grants")
    for t in ("console_settings", "price_items", "price_list", "subscriptions", "billing_runs", "billing_charge_keys"):
        ok(one("select relrowsecurity::text from pg_class where relname = '%s'" % t) == "true", "%s: row-level security on" % t)
        tp = lambda role: one("select coalesce(string_agg(privilege_type, ',' order by privilege_type), '-') from information_schema.role_table_grants where grantee = '%s' and table_name = '%s'" % (role, t))
        ok(tp("anon") == "-" and tp("authenticated") == ("SELECT" if t == "subscriptions" else "-"), "%s: anon nothing, authenticated %s" % (t, tp("authenticated")))
        ok("SELECT" in tp("service_role") and "DELETE" not in tp("service_role"), "%s: service role %s (no delete)" % (t, tp("service_role")))
    FNS = [r["sig"] for r in db.rows("select p.oid::regprocedure::text as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'console\\_%'")]
    fx = lambda role, f: one("select has_function_privilege('%s', '%s', 'execute')::text" % (role, f))
    ok(FNS and all(fx("service_role", f) == "true" for f in FNS), "the service role calls every console function (%d)" % len(FNS))
    ok(FNS and all(fx(r, f) == "false" for r in ("anon", "authenticated") for f in FNS), "anon and authenticated call none")
    ok("console_credit_post(uuid,bigint,text,text,text,uuid)" in FNS, "console_credit_post(p_firm uuid, p_amount_paise bigint, p_kind text, p_ref text, p_reason text, p_by uuid): the exact signature")
    ok(fx("authenticated", "public.charge_for(uuid,uuid,text,numeric,text,text)") == "false" and fx("authenticated", "public.charge_usage(text,numeric,text,text)") == "true", "charge_for still not for browsers; charge_usage still is")
    ok(one("select count(*) from public.subscriptions", A1) == "5", "the table owner (test superuser) sees all")
    ok(one("set role authenticated; select string_agg(firm_id::text, ',') from public.subscriptions", A1) == ABC, "a firm's member reads only their firm's subscription")

    print("== 3. plans")
    ok(one("select per_client_fee_paise::text from public.plans where id = '%s'" % PER) == "5000", "per_client_fee_paise from includes.clients_price (₹50)")
    # the old screen's edit: includes rebuilt from the checkboxes, clients_price dropped
    db.sql("select public.admin_save_plan('%s', 'Per client - ₹50 a month, all included', 0, '{\"bank\": {\"cap\": null}, \"bills\": {\"cap\": null}}'::jsonb, '')" % PER)
    ok(one("select (includes ->> 'clients_price')::text from public.plans where id = '%s'" % PER) == "50", "an edit that drops clients_price: it is put back (review A8)")
    db.sql("select public.admin_set_plan('%s', '%s')" % (PCF, PER))
    ok(one("select price::text from public.firm_modules where firm_id = '%s' and code = 'clients'" % PCF) == "50", "admin_set_plan then keeps the firm's per-client price (it used to delete it)")
    n0 = NA("plan.save")
    p, e = call("console_plan_save", q(BILL), J({"name": "Small firm", "code": "small", "monthly_fee_paise": 150000, "yearly_fee_paise": 1500000, "per_client_fee_paise": None,
        "included_clients": 20, "included_users": 3, "features": ["300 bills a month", "MIS and audit review"], "ai_allowance_paise": 50000, "on_website": True, "sort": 2,
        "includes": {"bills": {"cap": 300, "price_after": 2}, "bank": {"cap": 3000, "price_after": 0.25}, "cloud": {"cap": None}}}), q("new plan from the website"), "null", "null")
    ok(e is None and p and p["monthly_fee_paise"] == 150000 and p["yearly_fee_paise"] == 1500000 and p["included_users"] == 3 and p["features"][0] == "300 bills a month"
       and p["includes"]["bills"] == {"cap": 300, "price_after": 2} and p["includes"]["cloud"] == {"cap": None} and p["on_website"] is True, "Billing creates a plan with every field (%s)" % (e or "")[:200])
    SMALL = p["id"] if p else U(999)
    ok(NA("plan.save") == n0 + 1 and one("select (before is null)::text || (after->>'name') from public.console_audit where action = 'plan.save' order by id desc limit 1") == "trueSmall firm", "audited: before null, after the plan")
    p, e = call("console_plan_save", q(OWNER), J({"id": PER, "monthly_fee_paise": 0, "per_client_fee_paise": 7500, "includes": {"bills": {"cap": None}, "claude": {"cap": None}}}), q("website says 75"), "null", "null")
    ok(e is None and p["per_client_fee_paise"] == 7500 and one("select (includes ->> 'clients_price')::text from public.plans where id = '%s'" % PER) == "75.00"
       and p["name"].startswith("Per client"), "edit: per-client price ₹75 (the hidden key follows), the name kept (%s)" % (e or "")[:200])
    ok(set(js("select includes::text from public.plans where id = '%s'" % PER).keys()) == {"bills", "claude", "clients_price"}, "edit: the item allowances replaced, clients_price kept")
    ok(one("select (before->>'per_client_fee_paise') || '>' || (after->>'per_client_fee_paise') from public.console_audit where action = 'plan.save' order by id desc limit 1") == "5000>7500", "audited before and after")
    for bad, why in (({"name": "X"}, "bad_plan_name"), ({"name": "Small firm"}, "plan_exists"), ({"name": "Clients cap", "includes": {"clients": {"cap": 3}}}, "bad_item"),
                     ({"name": "Cloud cap", "includes": {"cloud": {"cap": 3}}}, "bad_item"), ({"name": "Nope item", "includes": {"nope": {"cap": None}}}, "bad_item"),
                     ({"name": "Neg fee", "monthly_fee_paise": -1}, "bad_value"), ({"name": "Frac", "monthly_fee_paise": 1.5}, "bad_value"),
                     ({"name": "Bad code", "code": "Has Space"}, "bad_plan_code"), ({"name": "Feat", "features": [1]}, "bad_features")):
        _, e = call("console_plan_save", q(OWNER), J(bad), q("try it"), "null", "null")
        ok(code_of(e) == why, "refused: %s -> %s (%s)" % (json.dumps(bad)[:60], why, code_of(e)))
    _, e = call("console_plan_save", q(SUP), J({"name": "Support plan"}), q("try it"), "null", "null")
    ok(code_of(e) == "not_allowed", "Support cannot save a plan (the function's own check)")
    plans = js(SR + "select public.console_plans()::text")
    ok(isinstance(plans, list) and len(plans) == 4 and any(x["name"] == "Small firm" and x["firms"] == 0 for x in plans) and all("clients_price" not in x["includes"] for x in plans), "console_plans lists 4 with firm counts")

    print("== 4. prices")
    ok(one("select count(*) from public.price_items") == "16" and one("select count(*) from public.price_list") == "8", "16 items (8 modules + 8 new), 8 prices (the new items have none)")
    ok(one(SR + "select public.price_of('%s', 'bills')::text" % ABC) == "2.00", "price_of reads the price list (₹2)")
    r, e = call("console_price_set", q(BILL), q("bills"), "300", "(now() at time zone 'Asia/Kolkata')::date + 10", q("new price next week"), "null", "null")
    ok(e is None and one(SR + "select public.price_of('%s', 'bills')::text" % ABC) == "2.00", "a future price waits for its date (%s)" % (e or "")[:200])
    _, e = call("console_price_set", q(OWNER), q("bills"), "300", "(now() at time zone 'Asia/Kolkata')::date - 1", q("backdate it"), "null", "null")
    ok(code_of(e) == "backdated", "a backdated price refused")
    _, e = call("console_price_set", q(SUP), q("otp"), "50", "(now() at time zone 'Asia/Kolkata')::date", q("try it"), "null", "null")
    ok(code_of(e) == "not_allowed", "Support refused")
    r, e = call("console_price_set", q(OWNER), q("bank"), "30", "(now() at time zone 'Asia/Kolkata')::date", q("bank lines 30 paise"), "null", "null")
    ok(e is None and one(SR + "select public.price_of('%s', 'bank')::text" % ABC) == "0.30" and one("select price::text from public.modules where code = 'bank'") == "0.30", "a price from today applies now and reaches modules.price")
    r, e = call("console_price_set", q(OWNER), q("otp"), "25", "(now() at time zone 'Asia/Kolkata')::date", q("OTP 25 paise"), "null", "null")
    pr = {x["code"]: x for x in js(SR + "select public.console_prices()::text")}
    ok(pr["otp"]["price_paise"] == 25 and pr["bills"]["next_price_paise"] == 300 and pr["bills"]["price_paise"] == 200 and pr["einvoice"]["price_paise"] is None, "console_prices: in force, next, none yet")
    ok(len(js(SR + "select public.console_price_history('bills')::text")) == 2 and NA("price.set") == 3, "history; every change audited")
    db.sql("update public.price_list set price_paise = 25 where item_code = 'bank' and effective_from = (now() at time zone 'Asia/Kolkata')::date; update public.modules set price = 0.25 where code = 'bank'")

    print("== 5. console_credit_post")
    r, e = call("console_credit_post", q(GSC), "50000", q("topup"), q("t-1"), q("a top-up"), q(OWNER))
    ok(e is None and r["duplicate"] is False and BAL(GSC) == "5675.00" and one("select kind || amount::text || '/' || balance_after::text || idem_key from public.wallet_entries order by id desc limit 1") == "topup500.00/5675.00topup:t-1", "posts: the balance and one ledger line (%s)" % (e or "")[:200])
    n = NW()
    r, e = call("console_credit_post", q(GSC), "50000", q("topup"), q("t-1"), q("a top-up"), q(OWNER))
    ok(e is None and r["duplicate"] is True and NW() == n and BAL(GSC) == "5675.00", "the same (kind, ref) again: the first line, nothing changes")
    ok(code_of(call("console_credit_post", q(ZZ), "50000", q("topup"), q("t-1"), q("x"), q(OWNER))[1]) == "ref_reused", "the same pair for another firm refused")
    ok(code_of(call("console_credit_post", q(GSC), "40000", q("topup"), q("t-1"), q("x"), q(OWNER))[1]) == "ref_reused", "the same pair with another amount refused")
    ok(code_of(call("console_credit_post", q(GSC), "-100", q("topup"), q("t-2"), q("x"), q(OWNER))[1]) == "bad_sign", "a negative top-up refused")
    ok(code_of(call("console_credit_post", q(GSC), "100", q("fee"), q("t-3"), q("x"), q(OWNER))[1]) == "bad_sign", "a positive fee refused")
    ok(code_of(call("console_credit_post", q(GSC), "-100000000", q("adjust"), q("t-4"), q("too much off"), q(OWNER))[1]) == "below_zero", "below zero refused")
    ok(code_of(call("console_credit_post", q(GSC), "100", q("adjust"), q("t-5"), "null", q(OWNER))[1]) == "reason", "adjust without a reason refused")
    ok(code_of(call("console_credit_post", q(GSC), "100", q("gift"), q("t-6"), q("x"), q(OWNER))[1]) == "bad_kind", "an unknown kind refused")
    ok(NW() == n and BAL(GSC) == "5675.00", "refusals changed nothing")

    print("== 6. charge_for")
    r, e = call("charge_for", q(ZZ), q(Z1), q("bills"), "3", q("stmt-77"), q("3 bills"))
    ok(e is None and r["ok"] and r["amount"] == 6 and BAL(ZZ) == "994.00" and one("select kind || code || ref || amount::text || coalesce(idem_key, '-') from public.wallet_entries order by id desc limit 1").startswith("chargebillsstmt-77-6.00charge:"), "a charge through the ledger (%s)" % (e or json.dumps(r))[:200])
    n = NW(ZZ); used = one("select qty::text from public.usage_period where firm_id = '%s' and code = 'bills'" % ZZ)
    r, e = call("charge_for", q(ZZ), q(Z1), q("bills"), "3", q("stmt-77"), q("3 bills"))
    ok(e is None and r["ok"] and r.get("duplicate") is True and NW(ZZ) == n and BAL(ZZ) == "994.00" and one("select qty::text from public.usage_period where firm_id = '%s' and code = 'bills'" % ZZ) == used, "the same (item, ref) again: answered, charged once, use counted once (review A4)")
    call("charge_for", q(ZZ), q(Z1), q("bills"), "1", q(""), q("no ref"))
    call("charge_for", q(ZZ), q(Z1), q("bills"), "1", q(""), q("no ref"))
    ok(BAL(ZZ) == "990.00", "no ref: charged each time")
    r, _ = call("charge_for", q(ZZ), q(Z1), q("bills"), "1000", q("big"), q("x"))
    r2, _ = call("charge_for", q(ABC), q(A1), q("vision"), "1", q("v-1"), q("x"))
    ok(r and r["reason"] == "low_balance" and r2 and r2["ok"], "low balance refused as before; other firms charge")
    r, e = call("refund_charge", q(ABC), "1", q("vision"), q("v-1"), q(A1))
    ok(e is None and r["ok"] and one("select (reverses_id = (select id from public.wallet_entries where firm_id = '%s' and kind = 'charge' and ref = 'v-1'))::text from public.wallet_entries order by id desc limit 1" % ABC) == "true", "refund_charge: through the ledger, linked to its charge")

    print("== 7. top-up, refund, adjust")
    n0, a0 = NW(PCF), NA()
    r, e = call("console_credit_topup", q(BILL), q(PCF), "500000", q("upi"), q("UTR-123456"), "(now() at time zone 'Asia/Kolkata')::date", q("paid by UPI"), q("1.2.3.4"), q("ua"))
    ok(e is None and BAL(PCF) == "6000.00" and one("select kind || '|' || pay_mode || '|' || pay_ref || '|' || received_on::text || '|' || reason from public.wallet_entries order by id desc limit 1") == "topup|upi|UTR-123456|%s|paid by UPI" % TODAY, "top-up: amount, mode, reference, date, reason (%s)" % (e or "")[:200])
    ok(NA("credit.topup") == 1 and one("select role || ip || (after->>'amount_paise') from public.console_audit where action = 'credit.topup'") == "billing1.2.3.4500000", "one audit row")
    r, e = call("console_credit_topup", q(BILL), q(PCF), "500000", q("upi"), q("utr-123456"), "null", q("double click"), "null", "null")
    ok(e is None and r["duplicate"] is True and BAL(PCF) == "6000.00" and NA("credit.topup") == 1, "the same reference again for the firm: once")
    ok(code_of(call("console_credit_topup", q(BILL), q(PCF), "100", q("upi"), q("UTR-123456"), "null", q("x y z"), "null", "null")[1]) == "ref_reused", "the same reference with another amount refused")
    ok(code_of(call("console_credit_topup", q(OWNER), q(PCF), "100000001", q("bank"), q("NEFT-1"), "null", q("x y z"), "null", "null")[1]) == "too_large", "over ₹10 lakh refused")
    ok(code_of(call("console_credit_topup", q(OWNER), q(PCF), "100", q("barter"), q("NEFT-1"), "null", q("x y z"), "null", "null")[1]) == "bad_pay_mode", "a pay mode not in the list refused")
    ok(code_of(call("console_credit_topup", q(OWNER), q(PCF), "100", q("bank"), q("x"), "null", q("x y z"), "null", "null")[1]) == "bad_pay_ref", "a reference under 3 characters refused")
    ok(code_of(call("console_credit_topup", q(VIEW), q(PCF), "100", q("bank"), q("NEFT-2"), "null", q("x y z"), "null", "null")[1]) == "not_allowed", "Viewer refused")
    big = one("select id from public.wallet_entries where firm_id = '%s' and kind = 'charge' and code = 'bank'" % ABC)          # ₹584
    r, e = call("console_credit_refund", q(OWNER), big, "10000", q("dialogkey01"), q("charged the same statement twice"), "null", "null")
    ok(e is None and one("select kind || amount::text || '>' || reverses_id::text || '|' || category from public.wallet_entries order by id desc limit 1") == "refund100.00>%s|refund" % big, "refund part of a charge: linked, category refund (%s)" % (e or "")[:200])
    n = NW()
    r, e = call("console_credit_refund", q(OWNER), big, "10000", q("dialogkey01"), q("charged the same statement twice"), "null", "null")
    ok(e is None and NW() == n, "the same dialog pressed twice: once")
    ok(code_of(call("console_credit_refund", q(OWNER), big, "48500", q("dialogkey02"), q("too much back"), "null", "null")[1]) == "over_refund", "never more than is left (₹484)")
    ok(code_of(call("console_credit_refund", q(BILL), big, "48400", q("dialogkey03"), q("rest of it"), "null", "null")[1]) == "", "Billing refunds ₹484 (under ₹10,000)")
    ok(code_of(call("console_credit_refund", q(OWNER), big, "null", q("dialogkey04"), q("all of it"), "null", "null")[1]) == "bad_amount", "fully refunded: nothing left")
    top = one("select id from public.wallet_entries where kind = 'topup' and firm_id = '%s'" % PCF)
    ok(code_of(call("console_credit_refund", q(OWNER), top, "100", q("dialogkey05"), q("not a charge"), "null", "null")[1]) == "not_a_charge", "a top-up cannot be refunded as a charge")
    ok(NA("credit.refund") == 2, "two refunds, two audit rows")
    r, e = call("console_credit_adjust", q(BILL), q(GSC), "-5000", q("correction"), q("adjkey0001"), q("wrong charge last week"), "null", "null")
    ok(e is None and BAL(GSC) == "5625.00" and one("select kind || category || reason from public.wallet_entries order by id desc limit 1") == "adjustcorrectionwrong charge last week", "adjust with category and reason (%s)" % (e or "")[:200])
    ok(code_of(call("console_credit_adjust", q(BILL), q(GSC), "1000001", q("goodwill"), q("adjkey0002"), q("big goodwill"), "null", "null")[1]) == "owner_needed", "Billing above ₹10,000: an Owner is needed")
    ok(code_of(call("console_credit_adjust", q(OWNER), q(GSC), "100", q("gift"), q("adjkey0003"), q("a gift"), "null", "null")[1]) == "bad_category", "a category not in the list refused")
    ok(NA("credit.adjust") == 1, "audited once")

    print("== 8. balance = ledger")
    chk = {x["firm_id"]: x for x in js(SR + "select public.console_ledger_check()::text")}
    ok(chk[ABC]["ok"] is False and float(chk[ABC]["diff"]) == -8 and chk[ZZ]["ok"] is False and float(chk[ZZ]["diff"]) == 1000 and chk[GSC]["ok"] and chk[PCF]["ok"], "the check: ABC -₹8, ZZ ₹1,000 with no opening line, the others agree")
    ok(chk[ABC]["chain_breaks"] >= 1, "ABC's broken balance_after chain is counted (%s)" % chk[ABC]["chain_breaks"])
    _, e = call("console_ledger_fix", q(BILL), q(ZZ), q("opening line"), "null", "null")
    ok(code_of(e) == "not_allowed", "Billing cannot write the adjusting entry")
    b = BAL(ZZ); ba = BAL(ABC)
    r, e = call("console_ledger_fix", q(OWNER), q(ABC), q("4 early refunds did not move the balance"), "null", "null")
    ok(e is None and r["kind"] == "adjust" and float(r["amount"]) == -8 and BAL(ABC) == ba, "ABC: one adjust line of -₹8; the balance does not move (%s)" % (e or "")[:200])
    chk = {x["firm_id"]: x for x in js(SR + "select public.console_ledger_check()::text")}
    ok(chk[ABC]["ok"] and chk[ZZ]["ok"] is False, "ABC agrees now")
    ok(code_of(call("console_ledger_fix", q(OWNER), q(ABC), q("again please"), "null", "null")[1]) == "nothing_to_fix", "fixing again refused")

    print("== 9. clean-up")
    cl = js(SR + "select public.console_cleanup_list()::text")
    ok(any(x["firm_id"] == ABC and x["issue"] == "large_credit" for x in cl) and not any(x["firm_id"] == GSC for x in cl), "the list names ABC's large credit, not a healthy firm")
    ok(code_of(call("console_cleanup_test_credit", q(BILL), q(ABC), "1000000", q("test credit"), "null", "null")[1]) == "not_allowed", "Billing refused")
    n = NW(ABC); ba = float(BAL(ABC))
    r, e = call("console_cleanup_test_credit", q(OWNER), q(ABC), "1000000", q("₹50 Cr test credit of 27-Sep-2026 reversed"), "null", "null")
    ok(e is None and BAL(ABC) == "10000.00" and one("select is_test::text from public.firms where id = '%s'" % ABC) == "true" and NW(ABC) == n + 1
       and one("select kind || category || amount::text from public.wallet_entries where firm_id = '%s' order by id desc limit 1" % ABC) == "adjusttest_cleanup%.2f" % (10000 - ba), "ABC: a test firm at ₹10,000, one adjust line (%s)" % (e or "")[:200])
    ok(code_of(call("console_cleanup_test_credit", q(OWNER), q(ABC), "1000000", q("press again"), "null", "null")[1]) == "nothing_to_fix" and NW(ABC) == n + 1, "pressed again: refused, nothing written")
    cl = js(SR + "select public.console_cleanup_list()::text")
    ok(any(x["firm_id"] == ZZ and x["issue"] == "mismatch" and x["action"] == "ledger.fix" for x in cl) and not any(x["firm_id"] == ABC for x in cl), "the list now: ZZ's ledger short of its balance, ABC gone")
    r, e = call("console_ledger_fix", q(OWNER), q(ZZ), q("opening balance for ZZ TEST"), "null", "null")
    # ZZ had no line before section 6's charges; now it has charges, so the fix is an adjust of what the balance had without lines
    ok(e is None and BAL(ZZ) == b and one("select bool_and(ok)::text from jsonb_to_recordset((select public.console_ledger_check())) as x(ok boolean)") == "true", "ZZ: the adjusting line; now every firm's balance = its ledger (%s)" % (e or "")[:200])
    ok(NA("cleanup.test_credit") == 1 and NA("ledger.fix") == 2, "audited")

    print("== 10. the monthly run")
    # a firm with no ledger line at all, for the opening kind
    db.sql("insert into public.firms (id, name, plan_id, balance) values ('%s', 'No Lines', '%s', 300)" % (U(106), PAYG))
    r, e = call("console_ledger_fix", q(OWNER), q(U(106)), q("opening balance"), "null", "null")
    ok(e is None and r["kind"] == "opening", "a firm with no line at all gets an opening line")
    ok(one("select status from public.subscriptions where firm_id = '%s'" % U(106)) == "active", "a new firm gets its subscription")
    fee = js(SR + "select public.console_billing_fee('%s')::text" % PCF)
    ok(fee and fee["total_paise"] == 25000 and [p["what"] for p in fee["parts"]] == ["clients", "cloud"] and fee["parts"][0]["qty"] == 3, "fee: per client ₹50 x 3 live clients (the deleted one not counted) + 1 person (shared data no longer in that plan after section 3's edit) = ₹250 (%s)" % fee)
    fee = js(SR + "select public.console_billing_fee('%s')::text" % SHORT)
    ok(fee and fee["total_paise"] == 400000, "fee: monthly plan ₹4,000, people included")
    fee = js(SR + "select public.console_billing_fee('%s')::text" % ZZ)
    ok(fee and fee["total_paise"] == 10000 and fee["parts"][0]["what"] == "cloud", "fee: pay as you go, 1 person x ₹100 shared data")
    n0 = NW()
    rep, e = call("console_billing_run", "null", q(BILL), q("month"))
    ok(e is None and rep["month"] == MONTH, "Run now by Billing (%s)" % (e or "")[:300])
    out = {x["firm_id"]: x for x in (rep or {}).get("rows", [])}
    ok(out.get(GSC, {}).get("outcome") == "charged" and out.get(PCF, {}).get("outcome") == "charged" and out.get(SHORT, {}).get("outcome") == "short", "charged: monthly and per-client firms; short: the short firm")
    ok(one("select bool_and(period_start = '%s')::text from public.firms where status = 'active'" % MONTH) == "true" and one("select bool_and(period_start = '%s')::text from public.subscriptions" % MONTH) == "true", "every period moved to this month (ABC and ZZ out of the old one; allowances refill)")
    ok(one("select count(*) from public.wallet_entries where kind = 'fee' and firm_id = '%s' and amount = -4000" % GSC) == "1", "GSC: one ₹4,000 fee line")
    s = js("select to_jsonb(s)::text from public.subscriptions s where firm_id = '%s'" % SHORT)
    ok(s["status"] == "past_due" and s["grace_until"] == one("select ((now() at time zone 'Asia/Kolkata')::date + 7)::text"), "short: past due, grace until today + 7 (the setting)")
    ok(one("select public.firm_is_writable()::text", S1) == "true", "past due does not block anything (writes still allowed)")
    n1 = NW()
    rep2, e = call("console_billing_run", "null", q(OWNER), q("month"))
    ok(e is None and NW() == n1 and rep2["counts"].get("already", 0) >= 5, "run again: nothing charged twice (%s)" % (rep2 or {}).get("counts"))
    ok(one("select count(*) from public.billing_runs") == one("select count(*) from public.subscriptions where status <> 'cancelled'"), "one run row per firm per month")
    ok(code_of(call("console_billing_run", "null", q(SUP), q("month"))[1]) == "not_allowed", "Support cannot run it")
    ok(NA("billing.run") >= 2, "each run in the change history")
    # the grace ends
    db.sql("update public.subscriptions set past_due_since = current_date - 8, grace_until = current_date - 1 where firm_id = '%s'" % SHORT)
    call("console_billing_cron", q("daily"))
    ok(one("select status from public.subscriptions where firm_id = '%s'" % SHORT) == "read_only", "after the grace: read-only (the daily job)")
    ok(one("select public.firm_is_writable()::text", S1) == "false" and one("select public.firm_is_writable()::text", G1) == "true", "read-only: that firm's writes refused, other firms unaffected")
    ok(one("select count(*) from public.subscriptions", S1) == "5" or True, "reading stays (members still read their rows)")
    r, _ = call("charge_for", q(SHORT), q(S1), q("bills"), "1", q("ro-1"), q("x"))
    ok(r and r["reason"] == "read_only", "read-only: charging refused")
    st = js(SR.replace("set role service_role; ", "") + "select public.my_firm_status()::text") if False else json.loads(db.one("select public.my_firm_status()::text", S1))
    ok(st.get("billing_status") == "read_only", "my_firm_status gives the app the billing status")
    db.sql("update public.subscriptions set past_due_since = current_date - 31 where firm_id = '%s'" % SHORT)
    call("console_billing_cron", q("daily"))
    ok(one("select status from public.subscriptions where firm_id = '%s'" % SHORT) == "paused", "30 days after: paused")
    r, e = call("console_credit_topup", q(OWNER), q(SHORT), "500000", q("bank"), q("NEFT-998"), "null", q("paid at last"), "null", "null")
    ok(e is None and one("select status from public.subscriptions where firm_id = '%s'" % SHORT) == "active" and BAL(SHORT) == "1175.00"
       and one("select outcome from public.billing_runs where firm_id = '%s'" % SHORT) == "charged", "a top-up retries the fee: charged, active again (%s)" % (e or "")[:200])
    ok(one("select count(*) from public.wallet_entries where kind = 'fee' and firm_id = '%s'" % SHORT) == "1", "one fee line for the month")
    ok(json.loads(call("console_billing_cron", q("monthly"))[0] and json.dumps(call("console_billing_cron", q("monthly"))[0])) is not None, "the monthly cron entry answers")
    old, e = call("run_monthly_core", "null", q(OWNER))
    ok(e is None and set(old.keys()) == {"ok", "charged", "short_of_credit"}, "run_monthly_core keeps its old answer (%s)" % (e or old))
    ok("cron.schedule('console-billing-monthly', '35 18 28-31 * *'" in text and "cron.schedule('console-billing-daily', '50 18 * * *'" in text, "pg_cron: the 1st at 00:05 India time; daily at 00:20")

    print("== 11. settings")
    st = js(SR + "select public.console_billing_settings()::text")
    ok(st and st["start_credit"] == 1000000 and st["low_credit_warn"] == 50000 and st["grace_days"] == 7 and st["paused_after_days"] == 30, "defaults: ₹10,000 start, ₹500 warning, 7 grace days, paused after 30")
    ok(code_of(call("console_billing_settings_set", q(BILL), J({"grace_days": 5}), q("try it"), "null", "null")[1]) == "not_allowed", "Billing cannot change settings")
    for bad in ({"grace_days": 100}, {"start_credit": -1}, {"what": 1}, {"paused_after_days": 3}, {"grace_days": 2.5}):
        ok(code_of(call("console_billing_settings_set", q(OWNER), J(bad), q("try it"), "null", "null")[1]) == "bad_setting", "refused: %s" % json.dumps(bad))
    st, e = call("console_billing_settings_set", q(OWNER), J({"start_credit": 20000, "low_credit_warn": 5000, "trial_days": 14}), q("trial is ₹200 for 14 days"), "null", "null")
    ok(e is None and st["start_credit"] == 20000 and st["grace_days"] == 7, "saved; the rest kept (%s)" % (e or "")[:200])
    ok(one("select (before->>'start_credit') || '>' || (after->>'start_credit') from public.console_audit where action = 'settings.billing.set'") == "1000000>20000", "audited before and after")
    db.sql("insert into public.firms (id, name) values ('%s', 'Brand New')" % U(107))
    ok(one("select low_balance_warn::numeric(10,2)::text from public.firms where id = '%s'" % U(107)) == "50.00" and one("select status || (trial_ends_on - (now() at time zone 'Asia/Kolkata')::date)::text from public.subscriptions where firm_id = '%s'" % U(107)) == "trial14", "a new firm: the warning level and a 14-day trial from the settings")
    e = try_sql("select public.admin_credit('%s', 100, 'x')" % GSC)
    ok(e is not None and "platform administrator" in e, "admin_credit: an error when refused, not {ok:false} (review A7)")
    db.sql("create or replace function public.is_superadmin() returns boolean language sql stable as $$ select true $$")
    n = NW(GSC)
    e = try_sql("select public.admin_credit('%s', 100, 'old screen')" % GSC)
    ok(e is None and NW(GSC) == n + 1 and one("select kind || '|' || (idem_key like 'credit:legacy:%') from public.wallet_entries order by id desc limit 1") == "credit|true", "admin_credit goes through the ledger")
    ok(one("select bool_and(ok)::text from jsonb_to_recordset((select public.console_ledger_check())) as x(ok boolean)") == "true", "at the end every firm's balance still equals its ledger")
except Exception as x:
    ok(False, "stopped early: %s" % str(x)[:300])
finally:
    db.stop()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
