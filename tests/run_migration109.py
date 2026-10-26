"""python3 run_migration109.py - migration-109-ai-wallet-roles (26-Oct-2026, branch next-sec-server; the owner's approval of
26-Oct-2026 of the evening security audit's H2 and M4), on a throwaway PostgreSQL (pg_stand through assistant_stand, port
31090; never a real database), after 77 and the assistant's later migrations (to 96) as staging has them, with the wallet
(firms.balance, modules, plans, firm_modules, usage_period, wallet_entries, charge_for, price_of: staging's text of
26-Oct-2026) and the Tally tables 109 touches.
  0. the file: one transaction (lock_timeout 10 s), add-only (no "delete from", drop or truncate), names no real database.
  1. the AI limit: an owner can no longer raise it (Rs 1 crore refused), nor set the rupees to a dollar (1 refused); the
     owner can lower it and set it back to the default; staff cannot; a limit raised before 109 counts only up to the
     ceiling, at the platform's rate; the platform's default and rate come from app_settings 'ai' (bad values: the
     defaults); the superadmin (two-step only) gives one firm a higher ceiling.
  2. the wallet: each AI call's cost is charged (wallet_entries kind 'charge', code 'ai', usage_period); below the
     platform's minimum balance no new AI call (why 'balance'); a call the balance cannot fully cover takes what is
     left, the rest said in the note, and the next is refused; a plan that includes AI is free; the module switched off:
     why 'off'; the 500 calls a day (daily_calls) and the monthly limit still hold; members cannot call the internals.
  3. read-only members: tally_company_link refused with words (staff links); a posting into Tally and its cancelling
     refused (staff, and the server with no signed-in user, as before); the doc inbox and tally-uploads Storage adds
     refused (staff add, as before).
  4. the second run changes nothing; grants explicit (anon nothing; the internals service role only).
RED_WITHOUT_109=1: the same checks without running the file (the attacks pass: 1, 2, 3 fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import assistant_stand as A
M = os.path.join(HERE, "..", "server", "security", "migration-109-ai-wallet-roles.sql")
RED = os.environ.get("RED_WITHOUT_109") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read() if os.path.exists(M) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "0. one transaction, lock_timeout 10 s")
ok(text and "delete from" not in code and not re.search(r"\b(drop|truncate)\b", code), "0. add-only: no delete from, drop or truncate")
ok(text and not re.search(r"supabase\.co|https?://", low), "0. names no real database")
ok(text and not re.search(r"claude-[a-z0-9-]+|sonnet-\d|haiku-\d|opus-\d", low), "0. no model ids")

FIRM, OTHER, THIRD = A.FIRM, A.OTHER, "33333333-3333-4333-8333-333333333333"
OWNER, STAFF, OWNER3 = A.ME, A.STAFF, "aaaaaaaa-0000-4000-8000-000000000009"
RO, ADMIN, OWNER2 = "aaaaaaaa-0000-4000-8000-00000000000a", "aaaaaaaa-0000-4000-8000-00000000000b", "aaaaaaaa-0000-4000-8000-00000000000c"
PAYG, ALLIN = "ca3dbbc4-1148-4265-87f0-b0d561db2b13", "08173e6a-b52e-4722-bf67-96b873c91747"

# the wallet and the platform as on staging (26-Oct-2026: the columns, and charge_for / price_of word for word)
WALLET = r"""
alter table firms add column if not exists balance numeric not null default 0, add column if not exists active boolean not null default true,
  add column if not exists plan_id uuid, add column if not exists period_start date not null default (date_trunc('month', now()))::date;
create table if not exists app_settings (name text primary key, value jsonb, updated_at timestamptz default now());
create table if not exists modules (code text primary key, title text not null, unit text not null, price numeric not null default 0,
  billing text not null default 'per_unit' check (billing in ('per_unit', 'per_month', 'free')), active boolean not null default true, sort integer not null default 0);
create table if not exists firm_modules (firm_id uuid not null, code text not null, enabled boolean not null default true, price numeric, primary key (firm_id, code));
create table if not exists plans (id uuid primary key, name text not null, monthly_fee numeric not null default 0, includes jsonb not null default '{}', note text not null default '', active boolean not null default true, created_at timestamptz not null default now());
create table if not exists usage_period (firm_id uuid not null, period_start date not null, code text not null, qty numeric not null default 0, spent numeric not null default 0, primary key (firm_id, period_start, code));
create table if not exists wallet_entries (id bigserial primary key, firm_id uuid not null, at timestamptz not null default now(),
  kind text not null check (kind in ('credit', 'charge', 'refund', 'adjust', 'fee')), code text, qty numeric not null default 1, amount numeric not null,
  balance_after numeric not null, note text not null default '', ref text not null default '', by_user uuid);
create table if not exists platform_admins (user_id uuid primary key, name text);
alter table app_settings enable row level security; alter table modules enable row level security; alter table plans enable row level security;
create policy settings_read on app_settings for select to authenticated using (true);
grant select on app_settings, modules, plans to authenticated;
-- the two-step session of the stand: fincom.aal
create or replace function is_superadmin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid()) and coalesce(nullif(current_setting('fincom.aal', true), ''), 'aal1') = 'aal2' $$;
insert into modules (code, sort, unit, price, title, active, billing) values ('bills', 1, 'per bill read and booked', 2, 'Purchase bills', true, 'per_unit'),
  ('claude', 4, 'per bill Claude reads', 3, 'Reading by Claude', true, 'per_unit'), ('tally', 6, 'included', 0, 'Posting into Tally', true, 'free');
insert into plans (id, name, includes, monthly_fee) values ('ca3dbbc4-1148-4265-87f0-b0d561db2b13', 'Pay as you go', '{}', 0),
  ('08173e6a-b52e-4722-bf67-96b873c91747', 'Monthly - all included', '{"bank":{"cap":null},"bills":{"cap":null},"claude":{"cap":null},"ai":{"cap":null}}', 4000);
create or replace function public.price_of(p_firm uuid, p_code text) returns numeric language sql stable security definer set search_path to 'public' as $function$
  select coalesce(fm.price, m.price)
  from public.modules m
  left join public.firm_modules fm on fm.firm_id = p_firm and fm.code = m.code
  where m.code = p_code
$function$;
CREATE OR REPLACE FUNCTION public.charge_for(p_firm uuid, p_user uuid, p_code text, p_qty numeric, p_ref text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_amount numeric; v_bal numeric; v_enabled boolean; v_billing text; v_active boolean;
  v_inc jsonb; v_cap numeric; v_used numeric; v_period date; v_price numeric; v_free numeric := 0; v_paid numeric;
begin
  if p_firm is null then return jsonb_build_object('ok', false, 'reason', 'no_firm'); end if;
  select active, period_start into v_active, v_period from public.firms where id = p_firm;
  if not v_active then return jsonb_build_object('ok', false, 'reason', 'firm_off'); end if;
  select m.billing, coalesce(fm.enabled, true) into v_billing, v_enabled
  from public.modules m left join public.firm_modules fm on fm.firm_id = p_firm and fm.code = m.code
  where m.code = p_code;
  if v_billing is null then return jsonb_build_object('ok', false, 'reason', 'unknown_module'); end if;
  if not v_enabled then return jsonb_build_object('ok', false, 'reason', 'module_off'); end if;
  select p.includes -> p_code into v_inc from public.plans p join public.firms f on f.plan_id = p.id where f.id = p_firm;
  select qty into v_used from public.usage_period where firm_id = p_firm and period_start = v_period and code = p_code;
  v_used := coalesce(v_used, 0);
  v_price := public.price_of(p_firm, p_code);
  if v_billing = 'free' then
    v_paid := 0; v_free := p_qty;
  elsif v_inc is not null then
    v_cap := nullif(v_inc ->> 'cap', '')::numeric;
    if v_cap is null then v_free := p_qty; v_paid := 0;
    else
      v_free := greatest(0, least(p_qty, v_cap - v_used));
      v_paid := p_qty - v_free;
      v_price := coalesce(nullif(v_inc ->> 'price_after', '')::numeric, v_price);
    end if;
  else
    v_paid := p_qty;
  end if;
  v_amount := round(coalesce(v_price, 0) * v_paid, 2);
  select balance into v_bal from public.firms where id = p_firm for update;
  if v_amount > 0 and v_bal < v_amount then
    return jsonb_build_object('ok', false, 'reason', 'low_balance', 'needed', v_amount, 'balance', v_bal);
  end if;
  if v_amount > 0 then
    update public.firms set balance = balance - v_amount where id = p_firm returning balance into v_bal;
    insert into public.wallet_entries (firm_id, kind, code, qty, amount, balance_after, note, ref, by_user)
    values (p_firm, 'charge', p_code, v_paid, -v_amount, v_bal, p_note, p_ref, p_user);
  end if;
  insert into public.usage_period (firm_id, period_start, code, qty, spent)
  values (p_firm, v_period, p_code, p_qty, v_amount)
  on conflict (firm_id, period_start, code) do update set qty = usage_period.qty + excluded.qty, spent = usage_period.spent + excluded.spent;
  return jsonb_build_object('ok', true, 'amount', v_amount, 'balance', v_bal, 'included', v_free, 'charged', v_paid);
end $function$;
revoke execute on function public.charge_for(uuid, uuid, text, numeric, text, text), public.price_of(uuid, text) from public, anon, authenticated;
-- the Tally tables 109 touches (the columns it reads), and staging's tally_company_link (migration-2-hardening) and
-- tally_post_cancel (migration-5), and a SECURITY DEFINER stand-in for tally_post_enqueue_to's insert
create table if not exists tally_companies (firm_id uuid, company text, client_id text, gstin text, book_id uuid, device_id uuid, last_seen timestamptz, linked_at timestamptz, linked_by uuid, primary key (firm_id, company));
create table if not exists tally_post_jobs (id uuid primary key, firm_id uuid, client_id text, company text, device_id uuid, status text default 'waiting', message text, updated_at timestamptz default now(), created_at timestamptz default now());
create or replace function public.tally_company_link(p_company text, p_client text)
returns void language plpgsql security definer set search_path = public as $$
declare f uuid := my_firm(); cg text; tg text;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_companies where firm_id = f and company = p_company) then
    raise exception 'no computer has reported % yet; open it in Tally on a connected computer first', p_company;
  end if;
  if p_client is not null then
    select gstin into cg from clients where id = p_client and firm_id = f and not coalesce(deleted, false);
    if not found then raise exception 'no such client'; end if;
    select gstin into tg from tally_companies where firm_id = f and company = p_company;
    if coalesce(cg, '') <> '' and coalesce(tg, '') <> '' and upper(substr(cg, 3, 10)) <> upper(substr(tg, 3, 10)) then
      raise exception 'the GSTIN of % in Tally (%) is not this client''s (%)', p_company, tg, cg;
    end if;
  end if;
  update tally_companies set client_id = p_client, linked_at = now(), linked_by = auth.uid() where firm_id = f and company = p_company;
  update tally_books b set client_id = coalesce(p_client, '') from tally_companies c where c.firm_id = f and c.company = p_company and b.book_id = c.book_id;
end $$;
create or replace function public.tally_post_cancel(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update tally_post_jobs set status = 'cancelled', message = 'Cancelled before the Tally computer took it', updated_at = now()
   where id = p_id and firm_id = my_firm() and status = 'waiting';
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0);
end $$;
create or replace function public.stand_post_enqueue(p_id uuid, p_client text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into tally_post_jobs (id, firm_id, client_id, company, status) values (p_id, my_firm(), p_client, 'Co', 'waiting');
  return jsonb_build_object('ok', true);
end $$;
grant execute on function tally_company_link(text, text), tally_post_cancel(uuid), stand_post_enqueue(uuid, text) to authenticated;
-- Storage's two add policies as on staging (26-Oct-2026), and an add policy that 109 leaves alone
create policy "doc inbox: add to own firm" on storage.objects for insert to authenticated with check ((bucket_id = 'doc-inbox'::text) AND ((storage.foldername(name))[1] = (my_firm())::text));
create policy tally_uploads_add on storage.objects for insert to authenticated with check ((bucket_id = 'tally-uploads'::text) AND ((storage.foldername(name))[1] = (my_firm())::text));
create policy "support files: add" on storage.objects for insert to authenticated with check ((bucket_id = 'support-files'::text) AND ((storage.foldername(name))[1] = (my_firm())::text));
"""

db = A.start(int(os.environ.get("PG109_PORT") or 31090))
J = lambda q: json.loads(db.one(q))
def err(q, uid=None, aal=None):
    try:
        if uid:
            pre = ("set fincom.aal = '%s';\n" % aal) if aal else ""
            db._psql(["-t", "-A"], "set fincom.uid = '%s';\n%sset role authenticated;\n%s" % (uid, pre, q))
        else: db.sql(q)
        return ""
    except RuntimeError as e: return str(e)
def asj(q, uid, aal=None):
    pre = ("set fincom.aal = '%s';\n" % aal) if aal else ""
    out = db._psql(["-t", "-A"], "set fincom.uid = '%s';\n%sset role authenticated;\n%s" % (uid, pre, q)).strip()
    return json.loads(out) if out else None
def R(q):
    try: return db.rows(q)
    except RuntimeError as e: return [{"error": str(e)[:160]}]
def snap():
    fn = db.one("select md5(string_agg(p.oid::regprocedure::text || md5(p.prosrc) || p.prosecdef || coalesce(array_to_string(p.proconfig, ','), '') || coalesce(p.proacl::text, ''), '|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")
    cols = db.one("select md5(string_agg(table_name || column_name || data_type || coalesce(column_default, ''), '|' order by table_name, column_name)) from information_schema.columns where table_schema = 'public'")
    data = {t: db.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from %s x" % t) for t in ("assistant_caps", "app_settings", "modules", "wallet_entries", "firms", "usage_period")}
    pol = db.one("select md5(coalesce(string_agg(schemaname || tablename || policyname || coalesce(qual, '') || coalesce(with_check, ''), '|' order by schemaname, tablename, policyname), '')) from pg_policies")
    trg = db.one("select count(*) from pg_trigger where not tgisinternal")
    return fn, cols, data, pol, trg
try:
    A.migrate(db)
    db.sql(WALLET)
    db.sql("insert into firms (id, name, balance, plan_id) values ('%s', 'A', 1000, '%s'), ('%s', 'B', 0, '%s'), ('%s', 'C', 1000, '%s') on conflict (id) do nothing;" % (FIRM, PAYG, OTHER, PAYG, THIRD, PAYG) +
           " insert into members (user_id, firm_id, name, role) values ('%s', '%s', 'Owner', 'owner'), ('%s', '%s', 'Staff', 'staff'), ('%s', '%s', 'Read only', 'readonly'), ('%s', '%s', 'Owner C', 'owner'), ('%s', '%s', 'Owner B', 'owner');"
           % (OWNER, FIRM, STAFF, FIRM, RO, FIRM, OWNER3, THIRD, OWNER2, OTHER) +
           " insert into platform_admins values ('%s', 'Platform');" % ADMIN +
           # firm C: its owner raised the limit to Rs 1 crore at Rs 1 to a dollar before 109 (the audit's attack, already done)
           " insert into assistant_caps (firm_id, monthly_inr, inr_per_usd) values ('%s', 10000000, 1);" % THIRD +
           " insert into clients (id, firm_id, name) values ('cl-a', '%s', 'Client A') on conflict do nothing;" % FIRM +
           " insert into tally_companies (firm_id, company) values ('%s', 'Larkspur Co');" % FIRM +
           " insert into tally_post_jobs (id, firm_id, client_id, company, status) values ('00000000-0000-4000-8000-0000000000a1', '%s', 'cl-a', 'Co', 'waiting'), ('00000000-0000-4000-8000-0000000000a2', '%s', 'cl-a', 'Co', 'waiting');" % (FIRM, FIRM))
    db.sql("grant select, insert on storage.objects to authenticated;")
    before = snap()
    if not RED:
        db.sql(text); first = snap(); db.sql(text); second = snap()
        ok(first == second, "4. the second run changes nothing (functions, columns, rows, policies, triggers)")
        ok(int(first[4]) == int(before[4]) + 1, "4. one new trigger")
    take = lambda f=FIRM: J("select asst_cap_take('%s', 1)" % f)
    cost = lambda usd, f=FIRM, feat="book": J("select asst_cost_add('%s', '%s', %s, 1000, 100, 0, 0)" % (f, feat, usd))
    bal = lambda f=FIRM: float(db.one("select balance from firms where id = '%s'" % f))

    # ---- 1. the AI limit
    e = err("select asst_set_cap(10000000, null)", OWNER)
    ok("can only be lowered" in e and "3,000" in e, "1. ATTACK: the owner's Rs 1 crore limit is refused, with words (%s)" % e[-140:])
    e = err("select asst_set_cap(null, 1)", OWNER)
    ok("set by FinCom for every firm" in e, "1. ATTACK: the owner's rate of Rs 1 to a dollar is refused (%s)" % e[-140:])
    e = err("select asst_set_cap(3001, null)", OWNER)
    ok("can only be lowered" in e, "1. one rupee above the default is refused too")
    t = take()
    ok(t.get("cap_inr") == 3000 and t.get("rate") == 85, "1. after the refusals the limit is still 3,000 at Rs 85 (%s)" % {k: t.get(k) for k in ("cap_inr", "rate")})
    r = asj("select asst_set_cap(1200, null)", OWNER) if not err("select asst_set_cap(1200, null)", OWNER) else {}
    ok(r.get("cap_inr") == 1200 and take().get("cap_inr") == 1200, "1. normal use: the owner lowers it to 1,200 (%s)" % r)
    r = asj("select asst_set_cap(3000, 85)", OWNER) if not err("select asst_set_cap(3000, 85)", OWNER) else {}
    ok(r.get("cap_inr") == 3000 and r.get("rate") == 85, "1. normal use: and sets it back to the default (the platform's rate given again is fine) (%s)" % r)
    ok("only the firm's owner" in err("select asst_set_cap(100, null)", STAFF), "1. staff cannot set it")
    t3 = take(THIRD)
    ok(t3.get("cap_inr") == 3000 and t3.get("rate") == 85, "1. a firm whose owner set Rs 1 crore at Rs 1 before 109: 3,000 at Rs 85 now (%s)" % {k: t3.get(k) for k in ("cap_inr", "rate")})
    c3 = cost(1, THIRD)
    ok(c3.get("inr") == 85 and c3.get("cap_inr") == 3000, "1. and its calls cost Rs 85 a dollar (%s)" % c3)
    db.sql("insert into app_settings (name, value) values ('ai', '{}') on conflict (name) do update set value = jsonb_build_object('default_monthly_inr', 5000, 'inr_per_usd', 90, 'min_balance_inr', 10)")
    t = take(OTHER)
    ok(t.get("cap_inr") == 5000 and t.get("rate") == 90, "1. the platform's settings (app_settings 'ai'): default 5,000, Rs 90 (%s)" % {k: t.get(k) for k in ("cap_inr", "rate")})
    db.sql("update app_settings set value = jsonb_build_object('default_monthly_inr', 'lots', 'inr_per_usd', 0, 'min_balance_inr', -5) where name = 'ai'")
    t = take(OTHER)
    ok(t.get("cap_inr") == 3000 and t.get("rate") == 85, "1. a bad setting falls back to the defaults (3,000, Rs 85) (%s)" % {k: t.get(k) for k in ("cap_inr", "rate")})
    db.sql("update app_settings set value = jsonb_build_object('default_monthly_inr', 3000, 'inr_per_usd', 85, 'min_balance_inr', 10) where name = 'ai'")
    ok(R("select count(*) n from pg_policies where tablename = 'app_settings' and cmd <> 'SELECT'") == [{"n": "0"}] and "permission denied" in err("update app_settings set value = '{}' where name = 'ai'", OWNER),
       "1. a member cannot change the platform's settings")
    r = asj("select admin_asst_set_cap('%s', 20000)" % FIRM, OWNER) if not RED else {}
    ok(not (r or {}).get("ok"), "1. an owner is not the superadmin: no ceiling (%s)" % r)
    r = asj("select admin_asst_set_cap('%s', 20000)" % FIRM, ADMIN, "aal1") if not RED else {}
    ok(not (r or {}).get("ok"), "1. the superadmin without the two-step: refused (%s)" % r)
    r = asj("select admin_asst_set_cap('%s', 20000)" % FIRM, ADMIN, "aal2") if not RED else {}
    ok((r or {}).get("ok") and r.get("max_inr") == 20000, "1. the superadmin with the two-step gives firm A a ceiling of 20,000 (%s)" % r)
    r = asj("select asst_set_cap(15000, null)", OWNER) if not err("select asst_set_cap(15000, null)", OWNER) else {}
    ok(r.get("cap_inr") == 15000 and "can only be lowered" in err("select asst_set_cap(20001, null)", OWNER), "1. then the owner may set up to 20,000, not above (%s)" % r)
    if not RED: asj("select admin_asst_set_cap('%s', null)" % FIRM, ADMIN, "aal2")
    ok(take().get("cap_inr") == 3000, "1. the ceiling taken away: back to the platform's 3,000")

    # ---- 2. the wallet
    b0 = bal(); n0 = int(db.one("select count(*) from wallet_entries"))
    c = cost(0.5)
    w = R("select kind, code, amount, note, ref from wallet_entries order by id desc limit 1")
    ok(abs(bal() - (b0 - 42.5)) < 0.001 and int(db.one("select count(*) from wallet_entries")) == n0 + 1 and w and w[0]["kind"] == "charge" and w[0]["code"] == "ai" and float(w[0]["amount"]) == -42.5,
       "2. ATTACK closed: a $0.50 AI call is charged to the wallet, Rs 42.50, kind 'charge', code 'ai' (balance %s; %s)" % (bal(), w))
    ok(c.get("charged") == 42.5 and c.get("inr") == 42.5 and "spent_inr" in c and "cap_inr" in c, "2. asst_cost_add says what it charged, and keeps its keys (%s)" % c)
    ok(R("select qty, spent from usage_period where firm_id = '%s' and code = 'ai'" % FIRM) == [{"qty": "42.5000", "spent": "42.50"}] if not RED else False, "2. the month's use of the 'ai' module is counted (usage_period)")
    db.sql("update firms set balance = 5 where id = '%s'" % FIRM)
    u0 = db.one("select calls from assistant_usage where firm_id = '%s' and day = (now() at time zone 'Asia/Kolkata')::date" % FIRM)
    t = take()
    ok(not t.get("ok") and t.get("why") == "balance" and t.get("min_balance_inr") == 10, "2. ATTACK closed: Rs 5 in the wallet (under Rs 10): no new AI call, why 'balance' (%s)" % {k: t.get(k) for k in ("ok", "why", "balance", "min_balance_inr")})
    ok(db.one("select calls from assistant_usage where firm_id = '%s' and day = (now() at time zone 'Asia/Kolkata')::date" % FIRM) == u0, "2. the refused call is not counted")
    db.sql("update firms set balance = 20 where id = '%s'" % FIRM)
    ok(take().get("ok"), "2. normal use: Rs 20 in the wallet: the call is taken")
    c = cost(1)
    w = R("select amount, note from wallet_entries order by id desc limit 1")
    ok(bal() == 0 and c.get("charged") == 20 and c.get("short") == 65 and w and float(w[0]["amount"]) == -20 and "not covered" in w[0]["note"],
       "2. a Rs 85 call with Rs 20 left: the 20 is taken, 65 not covered, said in the note (%s; %s)" % ({k: c.get(k) for k in ("charged", "short")}, w))
    t = take()
    ok(not t.get("ok") and t.get("why") == "balance", "2. and the next call is refused before it is made")
    db.sql("update firms set plan_id = '%s' where id = '%s'" % (ALLIN, FIRM))
    n1 = int(db.one("select count(*) from wallet_entries")); t = take(); c = cost(0.2)
    ok(t.get("ok") and c.get("charged") == 0 and int(db.one("select count(*) from wallet_entries")) == n1 and bal() == 0, "2. a plan that includes AI: free, with Rs 0 in the wallet (%s)" % c)
    db.sql("update firms set plan_id = '%s', balance = 500 where id = '%s'; insert into firm_modules (firm_id, code, enabled) values ('%s', 'ai', false)" % (PAYG, FIRM, FIRM))
    t = take()
    ok(not t.get("ok") and t.get("why") == "off", "2. the 'ai' module switched off for the firm: why 'off' (%s)" % t.get("why"))
    db.sql("update firm_modules set enabled = true, price = 1.5 where firm_id = '%s' and code = 'ai'" % FIRM)
    b1 = bal(); c = cost(0.1)
    ok(abs(bal() - (b1 - 12.75)) < 0.001, "2. the firm's own price (the superadmin's admin_set_module: Rs 1.50 for each Rs 1 of cost): Rs 8.50 of cost charged Rs 12.75 (%s)" % (b1 - bal()))
    db.sql("update assistant_caps set daily_calls = 2 where firm_id = '%s'" % FIRM)
    db.sql("insert into assistant_caps (firm_id, daily_calls) values ('%s', 2) on conflict (firm_id) do update set daily_calls = 2" % FIRM)
    db.sql("update assistant_usage set calls = 0 where firm_id = '%s'" % FIRM)
    t1, t2, t3 = take(), take(), take()
    ok(t1.get("ok") and t2.get("ok") and not t3.get("ok") and t3.get("why") == "calls", "2. the calls a day still limit (daily_calls 2: the third refused, why 'calls')")
    db.sql("update assistant_caps set daily_calls = 500 where firm_id = '%s'; update assistant_usage set cost_inr = 2990 where firm_id = '%s' and day = (now() at time zone 'Asia/Kolkata')::date" % (FIRM, FIRM))
    db.sql("update assistant_usage set cost_inr = 3000 where firm_id = '%s' and day = (now() at time zone 'Asia/Kolkata')::date" % FIRM)
    t = take()
    ok(not t.get("ok") and t.get("why") == "inr", "2. the monthly limit still holds (why 'inr')")
    e = [err("select asst_cap_take('%s', 1)" % FIRM, OWNER), err("select asst_cost_add('%s', 'x', 0, 0, 0, 0, 0)" % FIRM, OWNER),
         err("select asst_wallet_ok('%s')" % FIRM, OWNER), err("select asst_limits('%s')" % FIRM, OWNER), err("select charge_for('%s', null, 'ai', -100, '', '')" % FIRM, OWNER)]
    ok(all("permission denied" in x for x in e), "2. a member cannot call the internals (cap take, cost add, wallet check, limits, charge_for) (%s)" % [x[-60:] for x in e])
    u = asj("select asst_usage(30)", OWNER)
    ok(u.get("cap_inr") == 3000 and u.get("rate") == 85 and u.get("max_inr") == 3000 and "balance" in u and isinstance(u.get("days"), list), "2. asst_usage: the limit in force, the platform's rate, the ceiling, the balance (%s)" % {k: u.get(k) for k in ("cap_inr", "rate", "max_inr", "balance")})

    # ---- 3. read-only members
    e = err("select tally_company_link('Larkspur Co', 'cl-a')", RO)
    ok("Read-only members cannot link" in e, "3. ATTACK: a read-only member's Tally company link is refused, with words (%s)" % e[-120:])
    ok(not err("select tally_company_link('Larkspur Co', 'cl-a')", STAFF) and db.one("select client_id from tally_companies where company = 'Larkspur Co'") == "cl-a", "3. normal use: staff link it")
    e = err("select stand_post_enqueue('00000000-0000-4000-8000-0000000000b9', 'cl-a')", RO)
    ok("Read-only members cannot post" in e and db.one("select count(*) from tally_post_jobs where id = '00000000-0000-4000-8000-0000000000b9'") == "0", "3. ATTACK: a read-only member's posting into Tally is refused (%s)" % e[-120:])
    e = err("select tally_post_cancel('00000000-0000-4000-8000-0000000000a1')", RO)
    ok("Read-only members cannot post" in e and db.one("select status from tally_post_jobs where id = '00000000-0000-4000-8000-0000000000a1'") == "waiting", "3. ATTACK: and their cancelling of one (%s)" % e[-120:])
    ok(not err("select stand_post_enqueue('00000000-0000-4000-8000-0000000000b8', 'cl-a')", STAFF) and not err("select tally_post_cancel('00000000-0000-4000-8000-0000000000a1')", OWNER)
       and db.one("select status from tally_post_jobs where id = '00000000-0000-4000-8000-0000000000a1'") == "cancelled", "3. normal use: staff post, the owner cancels")
    ok(not err("update tally_post_jobs set status = 'taken' where id = '00000000-0000-4000-8000-0000000000a2'; insert into tally_post_jobs (id, firm_id, status) values ('00000000-0000-4000-8000-0000000000b7', '%s', 'waiting')" % FIRM),
       "3. the server and the bridge (no signed-in user) as before")
    ins = lambda bucket, uid: err("insert into storage.objects (bucket_id, name) values ('%s', '%s/x/file.xml')" % (bucket, FIRM), uid)
    ok("row-level security" in ins("doc-inbox", RO) and "row-level security" in ins("tally-uploads", RO), "3. ATTACK: a read-only member's add to the doc inbox and to tally-uploads is refused")
    ok(ins("doc-inbox", STAFF) == "" and ins("tally-uploads", OWNER) == "" and ins("support-files", RO) == "", "3. normal use: staff and the owner add; other buckets as before")
    pol = R("select policyname, with_check from pg_policies where schemaname = 'storage' and policyname in ('doc inbox: add to own firm', 'tally_uploads_add') order by 1")
    ok(len(pol) == 2 and all("can_write()" in p["with_check"] and "my_firm()" in p["with_check"] for p in pol), "3. both policies keep the firm's folder and add can_write()")

    # ---- 4. grants
    acl = {r["f"]: r["a"] for r in db.rows("select p.proname f, coalesce(p.proacl::text, '') a from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in "
                                         "('asst_ai_conf', 'asst_limits', 'asst_wallet_ok', 'asst_cap_take', 'asst_cost_add', 'asst_set_cap', 'asst_usage', 'admin_asst_set_cap', 'tally_company_link', 'tally_post_jobs_readonly_guard')")}
    inner = all("authenticated" not in acl.get(f, "authenticated") and "anon" not in acl.get(f, "anon") and not re.search(r"[{,]=", acl.get(f, "{=")) for f in ("asst_ai_conf", "asst_limits", "asst_wallet_ok", "asst_cap_take", "asst_cost_add"))
    outer = all("authenticated=X" in acl.get(f, "") and "anon" not in acl.get(f, "anon") and not re.search(r"[{,]=", acl.get(f, "{=")) for f in ("asst_set_cap", "asst_usage", "admin_asst_set_cap", "tally_company_link"))
    ok(inner and outer, "4. grants explicit: the internals service role only; the member-facing ones authenticated, never anon or public (%s)" % acl)
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
