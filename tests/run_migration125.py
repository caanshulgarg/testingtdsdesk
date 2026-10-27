"""python3 run_migration125.py - server/console/migration-125-console-guards.sql (27-Oct-2026, integ-console; 124 is
next-mobile's; NOT run on staging: the owner runs it after 123). On a throwaway PostgreSQL (pg_stand, port 31125 unless
PG125_PORT; never a real database) with migrations 118 to 123 run first (tests/console_chain_stand.py) and made-up firms:
  0. the file: one transaction, lock_timeout 10 s; add-only (nothing dropped but its own triggers and policies re-made;
     no delete, no truncate); names no real database
  1. runs, and runs a second time (the same function texts)
  2. a switched-off company: a firm's login cannot save its records (plain words) nor upload its documents
     (client-docs/<firm>/<company>/...); an active company, a record of no company, another bucket and the service role
     are not touched
  3. the status columns: a firm's login cannot change clients.status (nor make a company with another status),
     firms.status / status_reason / balance / plan_id / is_test / active, or a subscription; its other columns save as
     before; the console's functions (security definer) and the service role still change them
  4. coupons on a read-only or paused firm: coupon_redeem works (the way back); a free-credit coupon retries the month's
     fee at once, so the firm is active again; every other write stays refused (firm_is_writable false before)
  5. firm_signals: one row per firm and one for every firm ('all'); bumped by a change of the firm (status, plan, credit),
     its subscription, a flag rule for it, its AI settings; 'all' by announcements, flags and the AI registry; a member
     reads its firm's row and 'all' only; RLS on; in the Realtime publication
RED_WITHOUT_125=1: the same checks without running the file (they fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import console_chain_stand as C

M = os.path.join(C.CONSOLE, "migration-125-console-guards.sql")
RED = os.environ.get("RED_WITHOUT_125") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); sys.stdout.flush()
    if not c: fails.append(w)
text = open(M).read() if os.path.exists(M) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
drops = set(re.findall(r"\bdrop\s+(\w+)", code))
ok(drops <= {"trigger", "policy"} and not re.search(r"drop\s+(table|column|function|view|index)", code), "nothing dropped but its own triggers and policies re-made (%s)" % sorted(drops))
ok("delete from" not in code and not re.search(r"\btruncate\s", code), "no delete, no truncate")
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")

U = lambda n: "00000000-0000-4000-8000-%012d" % n
OWNER = U(1)
FA, FB, FP = U(501), U(502), U(503)          # an active firm, another firm, a paused firm
LA, LB, LP = U(1501), U(1502), U(1503)
PL = U(601)
FIX = """
insert into auth.users (id, email) values ('%(O)s', 'owner@fincom.live'), ('%(LA)s', 'a@a.test'), ('%(LB)s', 'b@b.test'), ('%(LP)s', 'p@p.test');
insert into public.console_admins (user_id, role) values ('%(O)s', 'owner') on conflict do nothing;
insert into plans (id, name, monthly_fee, includes) values ('%(PL)s', 'Monthly', 4000, '{"cloud": {"cap": null}}');
insert into firms (id, name, plan_id, balance, period_start, created_at) values ('%(FA)s', 'Firm A', '%(PL)s', 10000, date_trunc('month', now())::date, now() - interval '40 days'),
  ('%(FB)s', 'Firm B', '%(PL)s', 10000, date_trunc('month', now())::date, now() - interval '40 days'),
  ('%(FP)s', 'Paused Firm', '%(PL)s', 0, date_trunc('month', now() - interval '1 month')::date, now() - interval '90 days');
insert into members (user_id, firm_id, name, email, role, active) values ('%(LA)s', '%(FA)s', 'A', 'a@a.test', 'owner', true),
  ('%(LB)s', '%(FB)s', 'B', 'b@b.test', 'owner', true), ('%(LP)s', '%(FP)s', 'P', 'p@p.test', 'owner', true);
insert into clients (id, firm_id, name) values ('on1', '%(FA)s', 'On Ltd'), ('off1', '%(FA)s', 'Off Ltd');
insert into public.records (firm_id, kind, id, client_id, data) values ('%(FA)s', 'bills', 'r-off', 'off1', '{"v": 1}');
""" % {"O": OWNER, "LA": LA, "LB": LB, "LP": LP, "FA": FA, "FB": FB, "FP": FP, "PL": PL}

db = C.start(int(os.environ.get("PG125_PORT") or 31125))
SR = "set role service_role; "
AU = "set role authenticated; "
def try_sql(s, uid=None):
    try: db.sql(s, uid); return None
    except Exception as e: return str(e)
def one(q, uid=None):
    try: return db.one(q, uid)
    except Exception as e: return "ERR " + str(e)[:400]
def js(q, uid=None):
    v = one(q, uid)
    try: return json.loads(v) if v and not v.startswith("ERR") else {"_err": v}
    except Exception: return {"_err": v}
FQ = "select string_agg(p.proname || md5(p.prosrc), ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace"
SIG = lambda scope: one("select n::text from public.firm_signals where scope = '%s'" % scope)

try:
    res = C.apply(db, only=[118, 119, 120, 121, 122, 123])
    ok(all(e is None for _, e in res), "118 to 123 first (%s)" % [x for x in res if x[1]])
    e = try_sql(FIX); ok(e is None, "made-up firms (%s)" % (e or "")[:300])
    # the console switches Off Ltd off (its own function: definer, audited)
    e = try_sql(SR + "select public.console_company_set_status('%s', '%s', 'off1', 'deactivated', 'closed down', null, null)" % (OWNER, FA))
    ok(e is None, "Off Ltd switched off by the console (%s)" % (e or "")[:200])

    print("== 1. runs, twice")
    e1 = None if RED else try_sql(text)
    ok(e1 is None and one("select to_regclass('public.firm_signals')::text") == "firm_signals", "runs (%s)" % (e1 or "")[:400])
    f1 = one(FQ)
    e2 = None if RED else try_sql(text)
    ok(e2 is None and one(FQ) == f1, "runs a second time: the same function texts (%s)" % (e2 or "")[:200])

    print("== 2. a switched-off company: no records, no uploads")
    e = try_sql(AU + "insert into public.records (firm_id, kind, id, client_id, data) values ('%s', 'bills', 'r1', 'off1', '{}')" % FA, LA)
    ok(e is not None and "Off Ltd is switched off by FinCom" in e, "a new record of Off Ltd refused, in plain words (%s)" % (e or "")[:200])
    e = try_sql(AU + "update public.records set data = '{\"v\": 2}' where firm_id = '%s' and id = 'r-off'" % FA, LA)
    ok(e is not None and "switched off" in e and one("select data->>'v' from public.records where id = 'r-off'") == "1", "a change to Off Ltd's record refused, kept as it was")
    e = try_sql(AU + "insert into public.records (firm_id, kind, id, client_id, data) values ('%s', 'bills', 'r2', 'on1', '{}'), ('%s', 'firm', 'f', '', '{}')" % (FA, FA), LA)
    ok(e is None, "an active company's record, and a record of no company: saved (%s)" % (e or "")[:200])
    e = try_sql(AU + "insert into storage.objects (bucket_id, name) values ('client-docs', '%s/off1/9-bill.pdf')" % FA, LA)
    ok(e is not None and ("row-level security" in e or "switched off" in e), "a document of Off Ltd: upload refused (%s)" % (e or "")[:160])
    e = try_sql(AU + "insert into storage.objects (bucket_id, name) values ('client-docs', '%s/on1/9-bill.pdf'), ('support-files', '%s/off1/x.png')" % (FA, FA), LA)
    ok(e is None, "an active company's document, another bucket: uploaded (%s)" % (e or "")[:200])
    e = try_sql(SR + "insert into public.records (firm_id, kind, id, client_id, data) values ('%s', 'bills', 'r3', 'off1', '{}')" % FA)
    ok(e is None, "the service role (FinCom's own jobs) is not stopped (%s)" % (e or "")[:200])

    print("== 3. the status columns: the console's only")
    e = try_sql(AU + "update public.clients set status = 'active', status_reason = null, name = 'Off Ltd (renamed)' where firm_id = '%s' and id = 'off1'" % FA, LA)
    ok(e is None and one("select status || '|' || name from public.clients where id = 'off1'") == "deactivated|Off Ltd (renamed)", "a firm's login: the company's name saves, its status stays switched off (%s)" % (e or one("select status || '|' || name from public.clients where id = 'off1'")))
    e = try_sql(AU + "insert into public.clients (id, firm_id, name, status) values ('new1', '%s', 'New Ltd', 'deactivated')" % FA, LA)
    ok(e is None and one("select status from public.clients where id = 'new1'") == "active", "a new company made by the firm starts active, whatever it sent")
    before = one("select status || '|' || balance::numeric(14,2) || '|' || plan_id || '|' || is_test || '|' || active from firms where id = '%s'" % FA)
    e = try_sql(AU + "update firms set status = 'closed', balance = 99999999, plan_id = null, is_test = true, active = false, name = 'Firm A Pvt' where id = '%s'" % FA, LA)
    ok(e is None and one("select status || '|' || balance::numeric(14,2) || '|' || plan_id || '|' || is_test || '|' || active from firms where id = '%s'" % FA) == before
       and one("select name from firms where id = '%s'" % FA) == "Firm A Pvt", "a firm's login: status, credit, plan, test mark and on/off kept; its name saves")
    e = try_sql(AU + "update public.subscriptions set status = 'active' where firm_id = '%s'" % FA, LA)
    ok(e is not None and "permission denied" in e, "a subscription cannot be written by a firm's login")
    e = try_sql(SR + "select public.console_company_set_status('%s', '%s', 'off1', 'active', 'reopened', null, null)" % (OWNER, FA))
    ok(e is None and one("select status from public.clients where id = 'off1'") == "active", "the console still switches it on")
    e = try_sql(SR + "update firms set balance = 12345 where id = '%s'" % FB)
    ok(e is None and one("select balance::numeric(14,2)::text from firms where id = '%s'" % FB) == "12345.00", "the service role still changes a firm")
    e = try_sql(SR + "select public.console_credit_post('%s', 100, 'topup', 'T-125', 'top-up', '%s')" % (FB, OWNER))
    ok(e is None, "billing's ledger (definer) still moves a balance (%s)" % (e or "")[:200])

    print("== 4. coupons on a read-only or paused firm")
    r = js(SR + "select public.console_billing_run('%s', null, 'month', 'test')::text" % FP)
    ok(not r.get("_err") and r.get("rows", [{}])[0].get("outcome") == "short", "the paused firm was short this month (%s)" % r.get("_err", "")[:200])
    db.sql("update public.subscriptions set status = 'paused', past_due_since = current_date - 31, paused_since = current_date where firm_id = '%s'" % FP)
    ok(one(AU + "select public.firm_is_writable()::text", LP) == "false", "paused: writes refused")
    c = js(SR + "select public.console_coupon_save('%s', null, '{\"code\": \"COMEBACK\", \"kind\": \"credit\", \"value\": 500000}'::jsonb, 'win back', null, null)::text" % OWNER)
    ok(c.get("id"), "a free-credit coupon (%s)" % c.get("_err", "")[:200])
    r = js(AU + "select public.coupon_redeem('COMEBACK', 'settings')::text", LP)
    ok(r.get("ok") is True, "the paused firm redeems it (%s)" % (r.get("error") or r.get("_err", ""))[:300])
    s = one("select status from public.subscriptions where firm_id = '%s'" % FP)
    ok(s == "active" and one("select outcome from public.billing_runs where firm_id = '%s'" % FP) == "charged" and one("select (round(balance*100))::bigint::text from firms where id = '%s'" % FP) == "100000",
       "the credit retries the month's fee at once: ₹4,000 taken from ₹5,000, active again (%s)" % s)
    ok(one(AU + "select public.firm_is_writable()::text", LP) == "true", "writes allowed again")
    db.sql("update public.subscriptions set status = 'read_only' where firm_id = '%s'" % FP)
    c = js(SR + "select public.console_coupon_save('%s', null, '{\"code\": \"TENPC\", \"kind\": \"percent\", \"value\": 10, \"months\": 1}'::jsonb, 'win back', null, null)::text" % OWNER)
    r = js(AU + "select public.coupon_redeem('TENPC', 'settings')::text", LP)
    ok(r.get("ok") is True and one(AU + "select public.firm_is_writable()::text", LP) == "false", "read-only: a discount coupon redeems; other writes stay refused (%s)" % (r.get("error") or r.get("_err", ""))[:200])

    print("== 5. firm_signals")
    ok(one("select relrowsecurity::text from pg_class where relname = 'firm_signals'") == "true", "RLS on")
    ok(one("select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'firm_signals'") == "1", "in the Realtime publication")
    n0 = SIG(FA)
    db.sql(SR + "select public.console_firm_set_status('%s', '%s', 'suspended', 'asked', null, null)" % (OWNER, FA))
    n1 = SIG(FA)
    ok(n1 is not None and n1 != n0, "the firm paused by the console: its row bumped (%s -> %s)" % (n0, n1))
    db.sql(SR + "update public.subscriptions set status = 'past_due' where firm_id = '%s'" % FA)
    n2 = SIG(FA); ok(n2 != n1, "its subscription changed: bumped")
    db.sql(SR + "select public.console_credit_post('%s', 500, 'topup', 'T-sig', 'top-up', '%s')" % (FA, OWNER))
    n3 = SIG(FA); ok(n3 != n2, "its credit changed: bumped")
    a0 = SIG("all")
    db.sql(SR + "insert into public.announcements (title, body) values ('Hello all', 'x')")
    a1 = SIG("all"); ok(a1 is not None and a1 != a0, "an announcement: the 'all' row bumped")
    db.sql(SR + "insert into public.feature_flags (key, description) values ('zoho_books', 'Zoho') on conflict do nothing")
    a2 = SIG("all"); ok(a2 != a1, "a flag: 'all' bumped")
    db.sql(SR + "insert into public.feature_flag_rules (flag_key, scope, target_id, value) values ('zoho_books', 'firm', '%s', true)" % FB)
    ok(SIG(FB) is not None and SIG("all") == a2, "a flag rule for firm B: firm B's row, not 'all'")
    db.sql(SR + "update public.ai_settings set kill = true")
    a3 = SIG("all"); ok(a3 != a2, "the AI kill switch: 'all' bumped")
    b0 = SIG(FB)
    db.sql(SR + "insert into public.ai_firm_settings (firm_id, ai_off) values ('%s', true)" % FB)
    ok(SIG(FB) != b0, "AI off for firm B: its row bumped")
    try: seen = [r["scope"] for r in db.rows(AU + "select scope from public.firm_signals order by scope", LB)]
    except Exception as e: seen = [str(e)[:120]]
    ok(sorted(seen) == sorted([FB, "all"]), "firm B's login reads its own row and 'all' only (%s)" % seen)
    ok(one(AU + "select count(*) from public.firm_signals where firm_id = '%s'" % FA, LB) == "0", "not firm A's")
    e = try_sql(AU + "update public.firm_signals set n = 0", LB)
    ok(e is not None and "permission denied" in e, "a firm's login cannot write a signal")
finally:
    db.stop()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
