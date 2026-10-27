"""python3 run_migration121.py - server/console/migration-121-ai-control.sql (27-Oct-2026, branch next-console-ai, the
console's phase 4: the AI control centre; NOT run on staging: the owner runs it). On a throwaway PostgreSQL (pg_stand,
port 31121 unless PG121_PORT; never a real database), after migration 118 (the console's foundation), with stand-ins for
Supabase's auth tables, FinCom's firm, plan and wallet tables and the assistant's usage tables, and made-up firms:
  0. the file: one transaction, lock_timeout 10 s; add-only (nothing dropped, no delete, no truncate); names no real
     database; md5
  1. runs, and runs a second time (the same function texts; a feature the owner changed is not seeded back)
  2. the registry's seed: today's features, every one ON, today's prices; a new row starts OFF
  3. grants: RLS on and no policy on the four tables; the service role only; anon and authenticated nothing on any table
     or function; every function security definer with its search_path pinned
  4. ai_allowed: on; an unregistered feature; the kill switch; a feature off; AI off for a firm; one feature off for a
     firm; a plan's allowance used up (stop: refused with the rupees; charge: allowed, over); the firm's own allowance
     wins; bill reading does not count against it; the words "AI for <feature> is switched off by FinCom."
  5. the console's writes: each checks the caller's role itself (Owner; Owner and Billing), refuses bad values (a model
     not allowed, a billing item's price, an unknown plan or feature, the kill switch twice) with no change and no audit
     row, and writes exactly one audit row with the change
  6. the usage read: assistant_log's labels to the registry's codes (book -> assistant, ledger_guess -> ledger_check,
     build_mis -> mis_describe, call_subs -> call_captions with seconds), the gateway's charges and refunds (what was
     charged, FinCom's estimated cost), India's days, the range; the firms' AI state this month; the overview's plans
RED_WITHOUT_121=1: the same checks without running the file (1 to 6 fail)."""
import os, re, sys, hashlib, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(HERE, "..", "server", "console", "migration-121-ai-control.sql")
M118 = os.path.join(HERE, "..", "server", "console", "migration-118-console-foundation.sql")
RED = os.environ.get("RED_WITHOUT_121") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read() if os.path.exists(M) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\bdrop\s+(table|column|function|view|trigger|policy|index)", code), "nothing dropped")
ok("delete from" not in code and not re.search(r"\btruncate\b", code), "no delete, no truncate")
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")
ok("alter table public.plans" not in code and "update public.plans" not in code, "the billing module's plans table is not touched")

STAND = r"""
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
-- the assistant's tables as migrations 77 and 96 make them (the columns read here)
create table if not exists assistant_usage (firm_id uuid, day date, calls integer not null default 0, cost_inr numeric(14,4) not null default 0, primary key (firm_id, day));
create table if not exists assistant_log (id bigint generated by default as identity primary key, firm_id uuid not null, user_id uuid, client_id text, at timestamptz not null default now(),
  question text not null default '', tools text[] not null default '{}', input_tokens integer not null default 0, output_tokens integer not null default 0, calls integer not null default 0,
  ms integer not null default 0, feature text not null default '', route text not null default '', models text[] not null default '{}', cache_read integer not null default 0,
  cache_write integer not null default 0, cost_inr numeric(12,4) not null default 0, fell_through boolean not null default false);
create table if not exists assistant_settings (firm_id uuid primary key, enabled boolean not null default false, consent boolean not null default false, set_at timestamptz default now(), set_by uuid);
create table if not exists assistant_caps (firm_id uuid primary key, daily_calls integer, daily_inr numeric, inr_per_usd numeric, monthly_inr numeric(12,2) not null default 3000);
"""
U = lambda n: "00000000-0000-4000-8000-%012d" % n
OWNER, BILL, SUP, VIEW = U(1), U(3), U(4), U(5)
F1, F2, F3 = U(101), U(102), U(103)
P1, P2 = U(201), U(202)
FIX = r"""
insert into auth.users (id, email) values ('%(O)s', 'anshul@fincom.live'), ('%(B)s', 'bill@fincom.live'), ('%(S)s', 'sup@fincom.live'), ('%(V)s', 'view@fincom.live');
insert into plans values ('%(P1)s', 'Pay as you go', 0, '{}'), ('%(P2)s', 'Monthly, all included', 4000, '{}');
insert into firms (id, name, plan_id) values ('%(F1)s', 'ABC Associates', '%(P1)s'), ('%(F2)s', 'Garg Shekhar & Co', '%(P2)s'), ('%(F3)s', 'No Plan Firm', null);
insert into assistant_settings (firm_id, enabled) values ('%(F1)s', true);
insert into assistant_caps (firm_id, monthly_inr) values ('%(F1)s', 5000);
""" % {"O": OWNER, "B": BILL, "S": SUP, "V": VIEW, "F1": F1, "F2": F2, "F3": F3, "P1": P1, "P2": P2}

db = pg_stand.start(int(os.environ.get("PG121_PORT") or 31121))
SR = "set role service_role; "
def try_sql(s):
    try: db.sql(s); return None
    except Exception as e: return str(e)
def one(q):
    try: return db.one(q)
    except Exception as e: return "ERR " + str(e)[:300]
def js(q):
    v = one(q)
    try: return json.loads(v) if v and not v.startswith("ERR") else None
    except Exception: return None
allowed = lambda firm, feat: js(SR + "select public.ai_allowed('%s', '%s')" % (firm, feat)) or {}
try:
    db.sql(STAND); db.sql(open(M118).read()); db.sql(FIX)
    db.sql("insert into public.console_admins (user_id, role) values ('%s', 'owner'), ('%s', 'billing'), ('%s', 'support'), ('%s', 'viewer')" % (OWNER, BILL, SUP, VIEW))

    print("== 1. runs, twice")
    e1 = None if RED else try_sql(text)
    ok(e1 is None and one("select to_regclass('public.ai_features')::text") == "ai_features", "runs (%s)" % (e1 or "")[:300])
    FN = "select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname like 'console\\_ai\\_%' or proname in ('ai_allowed', 'ai_code_of', 'ai_month_spend_paise')"
    src1 = one(FN)
    try_sql("update public.ai_features set enabled = false, price_per_use_paise = 250 where code = 'bill_read'")
    e2 = None if RED else try_sql(text)
    ok(e2 is None and one(FN) == src1 and src1 and not src1.startswith("ERR"), "runs a second time: the same function texts (%s)" % (e2 or "")[:200])
    ok(one("select enabled::text || price_per_use_paise from public.ai_features where code = 'bill_read'") == "false250", "a feature the owner changed is not seeded back")
    try_sql("update public.ai_features set enabled = true, price_per_use_paise = 300 where code = 'bill_read'")
    ok(one("select count(*) from public.ai_settings") == "1", "one settings row")

    print("== 2. the seed")
    SEED = ["2b_match", "assistant", "bill_ocr", "bill_read", "call_captions", "call_summary", "certificates", "ledger_check", "mis_describe", "notice", "sheet_map", "tds_match", "upload_classify", "voice"]
    ok(one("select string_agg(code, ',' order by code) from public.ai_features") == ",".join(SEED), "the 14 features found in the code")
    ok(one("select bool_and(enabled)::text from public.ai_features") == "true" and one("select kill::text from public.ai_settings") == "false", "every one ON and the kill switch off: nothing changes until the owner changes it")
    ok(one("select string_agg(code || ':' || price_per_use_paise || ':' || coalesce(billing_item, '-'), ',' order by code) from public.ai_features where billing_item is not null") == "bill_ocr:100:vision,bill_read:300:claude",
       "bill reading ₹3 and OCR ₹1 a use, charged by the gateway's items as today")
    ok(one("select count(*) from public.ai_features where model is not null") == "0", "no model forced: each function's own choice as today")
    ok(one("select string_agg(code, ',' order by code) from public.ai_features where model_settable") == "2b_match,bill_read,call_summary,tds_match", "the model can be set where the function reads it")
    ok(try_sql("insert into public.ai_features (code, name) values ('new_thing', 'A new thing')") is None and one("select enabled::text from public.ai_features where code = 'new_thing'") == "false", "a new feature starts OFF")
    ok(try_sql("insert into public.ai_features (code, name) values ('Bad Code', 'x')") is not None, "a code is lower-case letters, digits and _")

    print("== 3. grants")
    for t in ("ai_features", "ai_settings", "ai_plan_allowance", "ai_firm_settings"):
        ok(one("select relrowsecurity::text from pg_class where relname = '%s'" % t) == "true" and one("select count(*) from pg_policies where tablename = '%s'" % t) == "0", "%s: RLS on, no policy" % t)
        tp = lambda role: one("select coalesce(string_agg(privilege_type, ',' order by privilege_type), '-') from information_schema.role_table_grants where grantee = '%s' and table_name = '%s'" % (role, t))
        ok(tp("anon") == "-" and tp("authenticated") == "-", "%s: anon and authenticated nothing" % t)
        ok(tp("service_role") == ("SELECT,UPDATE" if t == "ai_settings" else "DELETE,INSERT,SELECT,UPDATE"), "%s: the service role %s" % (t, tp("service_role")))
    FNS = [r["sig"] for r in db.rows("select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'console\\_ai\\_%' or p.proname in ('ai_allowed', 'ai_code_of', 'ai_month_spend_paise'))")]
    ok(len(FNS) == 11, "eleven functions (%d)" % len(FNS))
    fx = lambda role, f: one("select has_function_privilege('%s', '%s', 'execute')::text" % (role, f))
    ok(FNS and all(fx("service_role", f) == "true" for f in FNS), "the service role calls every one")
    ok(FNS and all(fx(r, f) == "false" for r in ("anon", "authenticated", "public") for f in FNS), "anon, authenticated and public call none")
    ok(FNS and one("select bool_and(prosecdef and coalesce(array_to_string(proconfig, ',') like '%search_path=%', false))::text from pg_proc where proname like 'console\\_ai\\_%' or proname in ('ai_allowed', 'ai_code_of', 'ai_month_spend_paise')") == "true", "security definer, search_path pinned")
    ok(try_sql("set role authenticated; select public.ai_allowed('%s', 'voice')" % F1) is not None, "a signed-in person cannot ask ai_allowed directly")

    print("== 4. ai_allowed")
    a = allowed(F1, "voice")
    ok(a.get("ok") is True and a.get("reason") == "on" and a.get("model") is None, "on, the function's own model: %s" % a)
    a = allowed(F1, "nope")
    ok(a.get("ok") is False and a.get("reason") == "unregistered", "an unregistered feature refused: %s" % a)
    a = allowed(F1, "new_thing")
    ok(a.get("ok") is False and a.get("reason") == "feature_off" and a.get("message") == "AI for A new thing is switched off by FinCom.", "a new feature, off: %s" % a)
    try_sql("update public.ai_settings set kill = true")
    a, b = allowed(F1, "bill_read"), allowed(F2, "voice")
    ok(a.get("reason") == "killed" and b.get("reason") == "killed" and a.get("message") == "AI for Bill reading is switched off by FinCom.", "the kill switch: every feature, every firm: %s" % a)
    try_sql("update public.ai_settings set kill = false; update public.ai_features set model = 'claude-haiku-5-5' where code = 'tds_match'")
    ok(allowed(F1, "tds_match").get("model") == "claude-haiku-5-5", "a model set in the registry is given")
    try_sql("insert into public.ai_firm_settings (firm_id, ai_off) values ('%s', true)" % F2)
    ok(allowed(F2, "voice").get("reason") == "firm_off" and allowed(F1, "voice").get("ok") is True, "AI off for one firm only")
    try_sql("update public.ai_firm_settings set ai_off = false, features_off = '{voice}' where firm_id = '%s'" % F2)
    ok(allowed(F2, "voice").get("reason") == "firm_feature_off" and allowed(F2, "tds_match").get("ok") is True, "one feature off for one firm")
    try_sql("delete from public.ai_firm_settings where firm_id = '%s'" % F2)
    # ABC has spent ₹600 this month (and ₹900 last month, which does not count)
    try_sql("insert into assistant_usage (firm_id, day, calls, cost_inr) values ('%s', (now() at time zone 'Asia/Kolkata')::date, 5, 600), ('%s', date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)::date - 1, 9, 900)" % (F1, F1))
    ok(one(SR + "select public.ai_month_spend_paise('%s')" % F1) == "60000", "this month's spend in paise (last month's left out)")
    try_sql("insert into public.ai_plan_allowance (plan_id, allowance_paise, after_allowance) values ('%s', 50000, 'stop')" % P1)
    a = allowed(F1, "voice")
    ok(a.get("ok") is False and a.get("reason") == "allowance" and "₹500.00" in a.get("message", "") and a.get("spent_paise") == 60000, "the plan's ₹500 used up, stop: refused with the rupees: %s" % a)
    ok(allowed(F1, "bill_read").get("ok") is True, "bill reading is charged per read, not from the allowance")
    ok(allowed(F2, "voice").get("reason") == "on", "another plan: no allowance set, no limit (today's behaviour)")
    try_sql("update public.ai_plan_allowance set after_allowance = 'charge'")
    a = allowed(F1, "voice")
    ok(a.get("ok") is True and a.get("over") is True and a.get("reason") == "over_allowance", "charge after it: allowed, over: %s" % a)
    try_sql("insert into public.ai_firm_settings (firm_id, allowance_paise, after_allowance) values ('%s', 100000, 'stop')" % F1)
    ok(allowed(F1, "voice").get("reason") == "on", "the firm's own ₹1,000 wins over the plan's")
    try_sql("update public.ai_firm_settings set allowance_paise = null where firm_id = '%s'" % F1)
    ok(allowed(F1, "voice").get("reason") == "allowance", "the firm's own rule (stop) with the plan's allowance")
    try_sql("delete from public.ai_firm_settings; delete from public.ai_plan_allowance; update public.ai_features set model = null")
    ok(allowed(F3, "voice").get("ok") is True, "a firm with no plan: allowed")

    print("== 5. the console's writes")
    AUD = lambda: int(one("select count(*) from public.console_audit") or 0) if not RED else -1
    call = lambda s: try_sql(SR + "select " + s)
    n0 = AUD()
    ok(call("public.console_ai_feature_set('%s', 'voice', '{\"enabled\": false}', 'r', null, null)" % SUP) is not None and AUD() == n0, "Support cannot change a feature (the function's own check); no audit row")
    ok(call("public.console_ai_feature_set('%s', 'voice', '{\"enabled\": false}', 'r', null, null)" % BILL) is not None, "nor Billing")
    e = call("public.console_ai_feature_set('%s', 'voice', '{\"enabled\": false}', 'provider down', '1.2.3.4', 'ua')" % OWNER)
    ok(e is None and allowed(F1, "voice").get("reason") == "feature_off", "the Owner switches voice typing off %s" % (e or ""))
    ok(AUD() == n0 + 1 and one("select action || '|' || target_id || '|' || (before->>'enabled') || '>' || (after->>'enabled') || '|' || reason from public.console_audit order by id desc limit 1") == "ai.feature.set|voice|true>false|provider down", "one audit row with before and after")
    n1 = AUD()
    for p, w in (("'{\"model\": \"gpt-9\"}'", "a model not allowed"), ("'{\"model\": \"whisper-large-v3\"}'", "a model on a feature whose model cannot be set"),
                 ("'{\"price_per_use_paise\": 500}'", "the price of a feature charged by a billing item"), ("'{\"secret\": 1}'", "a field not allowed"),
                 ("'{\"enabled\": \"maybe\"}'", "not a yes or no"), ("'{}'", "nothing")):
        feat = "bill_read" if "price" in p else "voice" if "whisper" in p else "tds_match"
        ok(call("public.console_ai_feature_set('%s', '%s', %s, 'r', null, null)" % (OWNER, feat, p)) is not None, "refused: " + w)
    ok(call("public.console_ai_feature_set('%s', 'tds_match', '{\"price_per_use_paise\": -1}', 'r', null, null)" % OWNER) is not None, "refused: a price below 0")
    ok(call("public.console_ai_feature_set('%s', 'nope', '{\"enabled\": true}', 'r', null, null)" % OWNER) is not None, "refused: a feature not in the registry")
    ok(AUD() == n1 and one("select model is null and price_per_use_paise = 0 from public.ai_features where code = 'tds_match'") == "t", "nothing changed, no audit row")
    e = call("public.console_ai_feature_set('%s', 'tds_match', '{\"model\": \"claude-opus-5-5\", \"price_mode\": \"per_use\", \"price_per_use_paise\": 200}', 'r', null, null)" % OWNER)
    ok(e is None and one("select model || price_mode || price_per_use_paise from public.ai_features where code = 'tds_match'") == "claude-opus-5-5per_use200", "the model and the price set %s" % (e or ""))
    ok(call("public.console_ai_kill('%s', true, 'r', null, null)" % BILL) is not None, "Billing cannot stop all AI")
    e = call("public.console_ai_kill('%s', true, 'a key leaked', null, null)" % OWNER)
    ok(e is None and allowed(F2, "tds_match").get("reason") == "killed" and one("select kill_reason from public.ai_settings") == "a key leaked", "Stop all AI now %s" % (e or ""))
    ok(call("public.console_ai_kill('%s', true, 'again', null, null)" % OWNER) is not None, "stopped twice: refused")
    ok(call("public.console_ai_kill('%s', false, 'key replaced', null, null)" % OWNER) is None and allowed(F2, "tds_match").get("ok") is True, "back on")
    ok(one("select string_agg(action, ',' order by id) from public.console_audit where action like 'ai.%kill'") == "ai.kill,ai.unkill", "both audited")
    ok(call("public.console_ai_plan_set('%s', '%s', 50000, 'stop', 'r', null, null)" % (SUP, P1)) is not None, "Support cannot set a plan's allowance")
    ok(call("public.console_ai_plan_set('%s', '%s', 50000, 'stop', 'r', null, null)" % (BILL, U(299))) is not None, "an unknown plan refused")
    ok(call("public.console_ai_plan_set('%s', '%s', 50000, 'later', 'r', null, null)" % (BILL, P1)) is not None, "an after-rule not in the list refused")
    e = call("public.console_ai_plan_set('%s', '%s', 50000, 'stop', 'plan v2', null, null)" % (BILL, P1))
    ok(e is None and allowed(F1, "voice").get("reason") in ("allowance", "feature_off"), "Billing sets the plan's allowance %s" % (e or ""))
    e = call("public.console_ai_plan_set('%s', '%s', null, 'charge', 'no limit again', null, null)" % (BILL, P1))
    ok(e is None and one("select coalesce(allowance_paise::text, 'none') || after_allowance from public.ai_plan_allowance where plan_id = '%s'" % P1) == "nonecharge", "and back to no limit")
    ok(one("select (before->>'allowance_paise') || '>' || coalesce(after->>'allowance_paise', 'null') from public.console_audit where action = 'ai.plan.set' order by id desc limit 1") == "50000>null", "audited with before and after")
    ok(call("public.console_ai_firm_set('%s', '%s', true, null, null, '{}', 'r', null, null)" % (VIEW, F2)) is not None, "a Viewer cannot change a firm")
    ok(call("public.console_ai_firm_set('%s', '%s', false, null, null, '{nope}', 'r', null, null)" % (BILL, F2)) is not None, "an unknown feature refused")
    ok(call("public.console_ai_firm_set('%s', '%s', false, null, null, '{}', 'r', null, null)" % (BILL, U(199))) is not None, "an unknown firm refused")
    e = call("public.console_ai_firm_set('%s', '%s', false, 20000, 'stop', '{tds_match,voice,voice}', 'firm asked', null, null)" % (BILL, F2))
    ok(e is None and one("select array_to_string(features_off, ',') || '|' || allowance_paise from public.ai_firm_settings where firm_id = '%s'" % F2) == "tds_match,voice|20000", "Billing sets a firm's override (the list kept once, in order) %s" % (e or ""))
    ok(allowed(F2, "tds_match").get("reason") == "firm_feature_off", "and the functions are told")
    try_sql("update public.ai_features set enabled = true, model = null, price_mode = 'included', price_per_use_paise = 0")
    try_sql("update public.ai_features set price_mode = 'per_use', price_per_use_paise = 300 where code = 'bill_read'; update public.ai_features set price_mode = 'per_use', price_per_use_paise = 100 where code = 'bill_ocr'")

    print("== 6. the usage read")
    # India's day: 23:00 IST on the 26th is the 26th; 00:30 IST on the 27th is the 27th
    LOG = r"""
    insert into assistant_log (firm_id, at, feature, tools, models, calls, input_tokens, output_tokens, ms, cost_inr) values
     ('%(F1)s', '2026-10-26 17:30:00+00', 'book', '{}', '{claude-haiku-5-5,claude-sonnet-5-5}', 2, 1000, 200, 900, 1.25),
     ('%(F1)s', '2026-10-26 18:00:00+00', 'general', '{}', '{claude-sonnet-5-5}', 1, 500, 100, 800, 0.75),
     ('%(F1)s', '2026-10-26 19:00:00+00', 'book', '{build_mis}', '{claude-sonnet-5-5}', 1, 100, 10, 500, 0.50),
     ('%(F1)s', '2026-10-26 10:00:00+00', 'ledger_guess', '{}', '{claude-haiku-5-5}', 1, 10, 10, 100, 0.10),
     ('%(F2)s', '2026-10-26 10:00:00+00', 'call_subs', '{ok}', '{whisper-large-v3-turbo}', 1, 0, 0, 5000, 0),
     ('%(F2)s', '2026-10-26 10:01:00+00', 'call_subs', '{ok}', '{whisper-large-v3-turbo}', 1, 0, 0, 6000, 0),
     ('%(F2)s', '2026-10-26 10:02:00+00', 'something_new', '{}', '{}', 1, 0, 0, 0, 0.02),
     ('%(F2)s', '2026-09-01 10:00:00+00', 'book', '{}', '{claude-sonnet-5-5}', 1, 0, 0, 0, 9);
    insert into wallet_entries (firm_id, at, kind, code, qty, amount, note) values
     ('%(F1)s', '2026-10-26 10:00:00+00', 'charge', 'claude', 1, -3, 'read'),
     ('%(F1)s', '2026-10-26 10:00:05+00', 'charge', 'claude', 1, -3, 'usage claude-sonnet-5 in 9000 out 900'),
     ('%(F1)s', '2026-10-26 11:00:00+00', 'charge', 'claude', 1, -3, 'read'),
     ('%(F1)s', '2026-10-26 11:00:01+00', 'refund', 'claude', 1, 3, 'refund'),
     ('%(F1)s', '2026-10-26 12:00:00+00', 'charge', 'vision', 2, -2, 'ocr'),
     ('%(F1)s', '2026-10-26 12:00:00+00', 'charge', 'bill', 1, -2, 'not AI');
    """ % {"F1": F1, "F2": F2}
    try_sql(LOG)
    u = js(SR + "select public.console_ai_usage('2026-10-26', '2026-10-27')") or {}
    rows = u.get("rows") or []
    key = lambda r: (r["day"], r["firm"], r["feature"], r["model"])
    got = {key(r): r for r in rows}
    ok(u.get("total") == len(rows) and u.get("truncated") is False, "rows %d, not truncated" % len(rows))
    A = got.get(("2026-10-26", "ABC Associates", "assistant", "claude-sonnet-5-5"))
    ok(A and A["calls"] == 3 and A["cost_paise"] == 200 and A["tokens_in"] == 1500, "book and general -> Ask FinCom, on India's day 26th (23:00 and 23:30 IST), the last model: %s" % A)
    ok(("2026-10-27", "ABC Associates", "mis_describe", "claude-sonnet-5-5") in got and got[("2026-10-27", "ABC Associates", "mis_describe", "claude-sonnet-5-5")]["cost_paise"] == 50, "build_mis -> My MIS described (00:30 IST on the 27th)")
    ok(("2026-10-26", "ABC Associates", "ledger_check", "claude-haiku-5-5") in got, "ledger_guess -> the GST and TDS ledger check")
    C = got.get(("2026-10-26", "Garg Shekhar & Co", "call_captions", "whisper-large-v3-turbo"))
    ok(C and C["calls"] == 2 and C["seconds"] == 11 and C["cost_paise"] == 0, "call_subs -> call captions, with the seconds heard: %s" % C)
    ok(("2026-10-26", "Garg Shekhar & Co", "other", "") in got, "a label not in the registry: other (seen, not lost)")
    B = got.get(("2026-10-26", "ABC Associates", "bill_read", ""))
    ok(B and B["calls"] == 2 and B["charged_paise"] == 600 and B["cost_paise"] == 850 and B["margin_paise"] == -250, "bill reading: 2 reads, ₹9 charged less ₹3 refunded = ₹6, cost estimated at 2 x ₹4.25: %s" % B)
    V = got.get(("2026-10-26", "ABC Associates", "bill_ocr", ""))
    ok(V and V["charged_paise"] == 200 and V["cost_paise"] == 26, "OCR: ₹2 charged, cost 2 pages x 13 paise: %s" % V)
    ok(not any(r["feature"] == "bill" or r["day"] < "2026-10-26" for r in rows), "not AI (bill entry) and outside the range left out")
    ok(one(SR + "select public.console_ai_usage('2026-10-27', '2026-10-26')").startswith("ERR") and "ai_bad_range" in one(SR + "select public.console_ai_usage('2026-10-27', '2026-10-26')"), "a range backwards refused (console: ai_bad_range)")
    ok((js(SR + "select public.console_ai_usage('2025-01-01', '2026-10-27')") or {}).get("total", 0) >= len(rows), "a range over a year is cut to 366 days, not refused")
    fl = js(SR + "select public.console_ai_firms(5000)") or []
    abc = next((x for x in fl if x["firm"] == "ABC Associates"), {})
    ok(abc.get("spent_paise") == 60000 and abc.get("owner_switch") is True and abc.get("owner_cap_paise") == 500000 and abc.get("allowance_from") == "none" and abc.get("plan") == "Pay as you go",
       "the firms' AI state: spend this month, the owner's own switch and cap, the plan: %s" % {k: abc.get(k) for k in ("spent_paise", "owner_switch", "owner_cap_paise", "allowance_from", "plan")})
    g = next((x for x in fl if x["firm"] == "Garg Shekhar & Co"), {})
    ok(g.get("allowance_from") == "firm" and g.get("allowance_paise") == 20000 and g.get("features_off") == ["tds_match", "voice"], "a firm's override shown: %s" % g)
    ov = js(SR + "select public.console_ai_overview()") or {}
    ok(len(ov.get("features") or []) == 15 and {p["plan"] for p in ov.get("plans") or []} == {"Pay as you go", "Monthly, all included"} and ov.get("settings", {}).get("kill") is False and ov.get("firm_overrides") == 1,
       "the overview: features, the plans with their allowance, the switch, overrides")
finally:
    db.stop()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
