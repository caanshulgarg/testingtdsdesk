"""python3 run_migration120.py - server/console/migration-120-coupons.sql (27-Oct-2026, branch next-console-coupons, the
console's coupons; NOT run on staging: the owner runs it). On a throwaway PostgreSQL (pg_stand, port 31120 unless
PG120_PORT; never a real database), with stand-ins for Supabase's auth tables and FinCom's firm tables, migration 118
run first (console_admins, console_audit_add, firms.status), and made-up firms. Billing's console_credit_post (migration
119, another branch) is a STUB made here, in the test only, with the same signature: it records each call.
  0. the file: one transaction, lock_timeout 10 s; add-only (no table, column or function dropped, no delete, no
     truncate); it does not make console_credit_post; names no real database; md5
  1. runs, and runs a second time (the same function texts)
  2. grants: row-level security on for every table; coupons and attempts closed to signed-in people; a firm reads its
     own redemptions and discounts only; coupon_redeem for signed-in people only (not anon); the console functions and
     coupon_discount_apply for the service role only
  3. the console: create every kind (Owner, Billing; Support and Viewer refused by the function itself); the code is
     kept in capitals, unique whatever its case; bad values, dates and plans refused; edit; a used coupon keeps its
     code and kind; total uses not below the uses; pause, resume, end (for good); every change one audit row, a
     refused one none
  4. coupon_redeem, each rule: signed in, a firm, the owner only, the firm not paused, the code (case and spaces do not
     matter), paused, ended, not yet, expired, the plan, new firms only, once per firm, total uses, stacking (no stack,
     one discount at a time, a stackable credit beside a stackable discount), 5 wrong codes an hour; plain words
  5. what it records: the redemption (who, firm, when, source, terms); the use counted; free credit through
     console_credit_post(firm, paise, 'coupon', redemption id, reason, the person); percent, flat, free months and trial
     days as a coupon_discounts row; a free-credit code before 119 is in: refused, nothing used up
  6. races: two firms taking the last use at the same moment (one gets it, uses = total); one firm sending the same
     once-per-firm code twice at once (one redemption)
  7. billing's contract: coupon_discount_apply counts a month down, is idempotent per period, finishes at zero, adds the
     rupees to the redemption; the report gives what was given per coupon and per month; the console's lists
RED_WITHOUT_120=1: the same checks without running the file (1 to 7 fail)."""
import os, re, sys, json, time, hashlib, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(HERE, "..", "server", "console", "migration-120-coupons.sql")
RED = os.environ.get("RED_WITHOUT_120") == "1"
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
ok(all(d == "policy" for d in drops), "nothing dropped but its own policies re-made (%s)" % sorted(set(drops)))
ok("delete from" not in code and "truncate" not in code, "no delete, no truncate")
ok(not re.search(r"create\s+(or\s+replace\s+)?function\s+public\.console_credit_post", code), "it does not make console_credit_post (migration 119's)")
ok("console_credit_post" in code, "it calls console_credit_post for free credit")
ok(not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")

from coupons_pg_fixture import AUTH, FIX, CREDIT_STUB, U, OWNER, BILL, SUP, VIEW, A1, A2, B1, C1, D1, E1, G1, H1, F1, F2, F3, F4, F5, F6, F7, P1, P2
db = pg_stand.start(int(os.environ.get("PG120_PORT") or 31120))
SR = "set role service_role; "
def try_sql(s):
    try: db.sql(s); return None
    except Exception as e: return str(e)
def one(q):
    try: return db.one(q)
    except Exception as e: return "ERR " + str(e)[:300]
def js(q):
    v = one(q)
    try: return json.loads(v) if v and not v.startswith("ERR") else {"_err": v}
    except Exception: return {"_err": v}
AUD = lambda: int(one("select count(*) from public.console_audit") or 0) if not RED else -1
def save(by, data, cid=None, reason="new campaign"):
    return js(SR + "select public.console_coupon_save('%s', %s, '%s'::jsonb, '%s', '1.2.3.4', 'test')::text" % (by, "'%s'" % cid if cid else "null", json.dumps(data).replace("'", "''"), reason))
def status(by, cid, st):
    return js(SR + "select public.console_coupon_set_status('%s', '%s', '%s', 'a reason', null, null)::text" % (by, cid, st))
def redeem(uid, code, source="settings"):
    return js("set role authenticated; set fincom.uid = '%s'; select public.coupon_redeem(%s, '%s')::text" % (uid, "null" if code is None else "'%s'" % code.replace("'", "''"), source))
def err(r): return (r.get("_err") or "")
try:
    import coupons_pg_fixture
    coupons_pg_fixture.setup(db, run120=False)

    print("== 1. runs, twice")
    e1 = None if RED else try_sql(text)
    ok(e1 is None and one("select to_regclass('public.coupons')::text") == "coupons", "runs (%s)" % (e1 or "")[:300])
    FQ = "select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname like 'coupon%' or proname like 'console\\_coupon%'"
    src1 = one(FQ)
    e2 = None if RED else try_sql(text)
    ok(e2 is None and src1 and one(FQ) == src1, "runs a second time: the same function texts (%s)" % (e2 or "")[:200])
    ok(one("select to_regprocedure('public.console_credit_post(uuid,bigint,text,text,text,uuid)') is null")  == "t", "console_credit_post is not there after it (119's)")

    print("== 2. grants")
    TABLES = ["coupons", "coupon_redemptions", "coupon_discounts", "coupon_discount_months", "coupon_attempts"]
    for t in TABLES:
        ok(one("select relrowsecurity::text from pg_class where relname = '%s'" % t) == "true", "%s: row-level security on" % t)
        tp = lambda role: one("select coalesce(string_agg(privilege_type, ',' order by privilege_type), '-') from information_schema.role_table_grants where grantee = '%s' and table_name = '%s'" % (role, t))
        ok(tp("anon") == "-", "%s: anon nothing" % t)
        want = "SELECT" if t in ("coupon_redemptions", "coupon_discounts") else "-"
        ok(tp("authenticated") == want, "%s: signed-in people %s (%s)" % (t, want, tp("authenticated")))
        ok(tp("service_role") in ("INSERT,SELECT,UPDATE", "INSERT,SELECT"), "%s: service role %s (no delete)" % (t, tp("service_role")))
    ok(one("select string_agg(tablename || ':' || cmd, ',' order by tablename) from pg_policies where tablename like 'coupon%'") == "coupon_discounts:SELECT,coupon_redemptions:SELECT", "policies: select own firm's redemptions and discounts only")
    fx = lambda role, f: one("select has_function_privilege('%s', '%s', 'execute')::text" % (role, f))
    ok(fx("authenticated", "public.coupon_redeem(text,text)") == "true" and fx("anon", "public.coupon_redeem(text,text)") == "false", "coupon_redeem: signed-in people yes, anon no")
    CF = [r["sig"] for r in db.rows("select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'console\\_coupon%' or p.proname = 'coupon_discount_apply')")]
    ok(len(CF) >= 9 and all(fx("service_role", f) == "true" and fx("authenticated", f) == "false" and fx("anon", f) == "false" for f in CF), "console functions and coupon_discount_apply: the service role only (%d)" % len(CF))
    ok(one("select bool_and(prosecdef and coalesce(array_to_string(proconfig, ',') like '%search_path=%', false))::text from pg_proc where proname like 'console\\_coupon%' or proname in ('coupon_redeem', 'coupon_discount_apply')") == "true", "security definer, search_path pinned")

    print("== 3. the console")
    a0 = AUD()
    c = save(OWNER, {"code": "welcome10", "kind": "percent", "value": 10, "months": 3, "max_off_paise": 50000, "campaign": "Diwali"})
    ok(c.get("code") == "WELCOME10" and c.get("terms") == "10% off the plan fee for 3 months (up to ₹500 a month)" and c.get("status") == "active", "Owner creates a percent coupon; the code in capitals; its terms in words (%s)" % c)
    ok(AUD() == a0 + 1 and one("select action || '|' || role || '|' || reason from public.console_audit order by id desc limit 1") == "coupon.create|owner|new campaign", "one audit row: coupon.create, the role, the reason")
    PCT = c.get("id")
    c2 = save(BILL, {"code": "FLAT500", "kind": "flat", "value": 50000, "months": 1})
    ok(c2.get("terms") == "₹500 off the plan fee for 1 month", "Billing creates a flat coupon (%s)" % c2.get("terms"))
    for who in (SUP, VIEW):
        a1 = AUD(); r = save(who, {"code": "NOPE1", "kind": "credit", "value": 100})
        ok("console: not_allowed" in err(r) and AUD() == a1, "%s refused by the function itself, no audit row" % ("Support" if who == SUP else "Viewer"))
    a1 = AUD()
    ok("console: coupon_code_taken" in err(save(OWNER, {"code": "Welcome10", "kind": "credit", "value": 100})) and AUD() == a1, "the same code in other letters: refused (not case-sensitive)")
    ok("console: coupon_code" in err(save(OWNER, {"code": "AB", "kind": "credit", "value": 100})), "a code shorter than 4: refused")
    ok("console: coupon_code" in err(save(OWNER, {"code": "AB-CD", "kind": "credit", "value": 100})), "a code with a dash: refused")
    ok("console: coupon_kind" in err(save(OWNER, {"code": "KIND1", "kind": "bogus", "value": 1})), "an unknown kind: refused")
    ok("console: coupon_value" in err(save(OWNER, {"code": "PCT101", "kind": "percent", "value": 101, "months": 1})), "101%: refused")
    ok("console: coupon_value" in err(save(OWNER, {"code": "PCTNOM", "kind": "percent", "value": 10})), "percent without months: refused")
    ok("console: coupon_value" in err(save(OWNER, {"code": "BIG1", "kind": "credit", "value": 10000001})), "free credit over ₹1,00,000: refused")
    ok("console: coupon_value" in err(save(OWNER, {"code": "TXT1", "kind": "credit", "value": "ten"})), "a value that is not a number: refused")
    ok("console: coupon_dates" in err(save(OWNER, {"code": "DATE1", "kind": "credit", "value": 100, "valid_from": "2026-12-01", "valid_to": "2026-11-01"})), "valid to before valid from: refused")
    ok("console: coupon_plan" in err(save(OWNER, {"code": "PLAN1", "kind": "credit", "value": 100, "plan_ids": [U(999)]})), "an unknown plan: refused")
    ok(AUD() == a1, "refusals write no audit row")
    CREDIT = save(OWNER, {"code": "ICAI1000", "kind": "credit", "value": 100000, "stackable": True}).get("id")
    FREE = save(OWNER, {"code": "FIRST2FREE", "kind": "free_months", "value": 2}).get("id")
    TRIAL = save(OWNER, {"code": "TRIAL30", "kind": "trial_days", "value": 30, "stackable": True}).get("id")
    ok(all([CREDIT, FREE, TRIAL]), "credit, free months and trial days coupons made")
    e = save(BILL, {"code": "WELCOME10", "kind": "percent", "value": 15, "months": 3, "max_off_paise": 50000, "campaign": "Diwali", "note": "raised"}, PCT, "raise it")
    ok(e.get("value") == 15 and e.get("note") == "raised" and one("select action || '|' || (before->>'value') || '>' || (after->>'value') from public.console_audit order by id desc limit 1") == "coupon.update|10>15",
       "edit: Billing raises it to 15%; the audit row has before and after")
    s = status(OWNER, PCT, "paused")
    ok(s.get("status") == "paused" and one("select action from public.console_audit order by id desc limit 1") == "coupon.pause", "pause")
    ok("console: same_status" in err(status(OWNER, PCT, "paused")), "pause twice: refused")
    ok(status(BILL, PCT, "active").get("status") == "active" and one("select action from public.console_audit order by id desc limit 1") == "coupon.resume", "resume (Billing)")
    ok("console: not_allowed" in err(status(SUP, PCT, "paused")), "Support cannot pause")
    ENDME = save(OWNER, {"code": "ENDME", "kind": "credit", "value": 100}).get("id")
    ok(status(OWNER, ENDME, "ended").get("status") == "ended" and one("select ended_at is not null from public.coupons where code = 'ENDME'") == "t", "end: for good, with the time")
    ok("console: coupon_ended" in err(status(OWNER, ENDME, "active")) and "console: coupon_ended" in err(save(OWNER, {"code": "ENDME", "kind": "credit", "value": 200}, ENDME)), "an ended coupon is neither resumed nor edited")
    ok("console: no_coupon" in err(status(OWNER, U(998), "paused")), "an unknown coupon: refused")

    print("== 4. coupon_redeem: each rule")
    r = js("set role authenticated; select public.coupon_redeem('WELCOME10')::text")
    ok(r.get("code") == "signin" and r.get("error") == "Sign in first.", "signed out: \"Sign in first.\" (%s)" % r)
    ok(redeem(U(77), "WELCOME10").get("code") == "no_firm", "a login with no firm: refused")
    r = redeem(A2, "WELCOME10")
    ok(r.get("code") == "not_owner" and r.get("error") == "Only the firm's owner can add a coupon.", "a staff member: \"%s\"" % r.get("error"))
    r = redeem(D1, "WELCOME10")
    ok(r.get("code") == "firm_paused" and "paused" in r.get("error", ""), "a suspended firm: \"%s\"" % r.get("error"))
    ok(redeem(A1, "WELCOME10", "console").get("code") == "bad_source", "a source other than signup or settings: refused")
    r = redeem(A1, "NOSUCH")
    ok(r.get("ok") is False and r.get("code") == "bad_code" and r.get("error") == "That code is not valid. Check it and try again.", "an unknown code: \"%s\"" % r.get("error"))
    status(OWNER, PCT, "paused")
    r = redeem(A1, "welcome10")
    ok(r.get("code") == "paused" and r.get("error") == "This code is paused just now. Try again later.", "a paused code: \"%s\"" % r.get("error"))
    status(OWNER, PCT, "active")
    ok(redeem(A1, "ENDME").get("error") == "This code has ended.", "an ended code: \"This code has ended.\"")
    SOON = save(OWNER, {"code": "SOON1", "kind": "credit", "value": 100, "valid_from": "2099-01-01"}).get("id")
    r = redeem(A1, "SOON1")
    ok(r.get("code") == "not_yet" and r.get("error") == "This code can be used from 01 Jan 2099.", "not yet: \"%s\"" % r.get("error"))
    save(OWNER, {"code": "OLD1", "kind": "credit", "value": 100, "valid_from": "2020-01-01", "valid_to": "2020-12-31"})
    r = redeem(A1, "OLD1")
    ok(r.get("code") == "expired" and r.get("error") == "This code expired on 31 Dec 2020.", "expired: \"%s\"" % r.get("error"))
    save(OWNER, {"code": "MONTHLY1", "kind": "trial_days", "value": 5, "plan_ids": [P2]})
    r = redeem(A1, "MONTHLY1")
    ok(r.get("code") == "wrong_plan" and r.get("error") == "This code is not for your firm's plan.", "another plan: \"%s\"" % r.get("error"))
    save(OWNER, {"code": "NEWBIE", "kind": "trial_days", "value": 7, "new_firms_only": True, "new_firm_days": 30})
    r = redeem(C1, "NEWBIE")
    ok(r.get("code") == "not_new" and r.get("error") == "This code is only for firms that joined in the last 30 days.", "an old firm, new firms only: \"%s\"" % r.get("error"))
    ok(int(one("select count(*) from public.coupon_redemptions") or 0) == 0 and int(one("select sum(uses) from public.coupons") or 0) == 0, "no refusal made a redemption or used a code up")

    print("== 5. what it records")
    r = redeem(A1, "  welcome10 ", "signup")
    ok(r.get("ok") is True and r.get("message") == "Applied: 15% off the plan fee for 3 months (up to ₹500 a month), from your next bill.", "WELCOME10 (spaces and small letters): applied, in words (%s)" % r)
    red = db.rows("select firm_id, by_user, source, kind, promised->>'code' as code, status, once::text from public.coupon_redemptions where id = '%s'" % r.get("redemption_id"))
    ok(red and red[0] == {"firm_id": F1, "by_user": A1, "source": "signup", "kind": "percent", "code": "WELCOME10", "status": "active", "once": "true"}, "the redemption: firm, who, source signup, kind, terms (%s)" % red)
    d = db.rows("select firm_id, kind, value, max_off_paise, months_left, status from public.coupon_discounts where from_redemption = '%s'" % r.get("redemption_id"))
    ok(d and d[0] == {"firm_id": F1, "kind": "percent", "value": "15", "max_off_paise": "50000", "months_left": "3", "status": "pending"}, "a pending discount for billing: percent 15, up to ₹500, 3 months (%s)" % d)
    ok(one("select uses from public.coupons where code = 'WELCOME10'") == "1", "the use counted")
    r = redeem(A1, "WELCOME10")
    ok(r.get("code") == "used_by_firm" and r.get("error") == "Your firm has already used this code.", "once per firm: \"%s\"" % r.get("error"))
    r = redeem(A1, "FLAT500")
    ok(r.get("code") == "no_stack" and r.get("error") == "Your firm already has a coupon running, and this code cannot be added to it.", "not stackable, a coupon running: \"%s\"" % r.get("error"))
    # free credit before migration 119: refused, nothing used up
    r = redeem(B1, "ICAI1000")
    ok(r.get("code") == "unavailable" and r.get("error") == "This code cannot be used just now. Try again later." and one("select uses from public.coupons where code = 'ICAI1000'") == "0", "free credit without console_credit_post (119 not in yet): refused, not used up")
    db.sql(CREDIT_STUB)
    r = redeem(B1, "icai1000")
    posts = db.rows("select firm, amount, kind, ref, reason, by_user from test_credit_posts")
    ok(r.get("ok") is True and r.get("message") == "₹1,000 has been added to your credit.", "free credit: \"%s\"" % r.get("message"))
    ok(posts == [{"firm": F2, "amount": "100000", "kind": "coupon", "ref": r.get("redemption_id"), "reason": "Coupon ICAI1000", "by_user": B1}], "through console_credit_post(firm, 100000 paise, 'coupon', the redemption id, reason, the person) (%s)" % posts)
    ok(one("select status || '|' || value_paise from public.coupon_redemptions where id = '%s'" % r.get("redemption_id")) == "finished|100000" and one("select count(*) from public.coupon_discounts where firm_id = '%s'" % F2) == "0", "the credit redemption: finished, ₹1,000 given; no discount row")
    # stacking: a stackable trial beside the (finished) credit; then a non-stackable discount refused while the trial runs
    r = redeem(B1, "TRIAL30")
    ok(r.get("ok") is True and r.get("message") == "Your trial is longer by 30 days.", "a stackable trial: \"%s\"" % r.get("message"))
    ok(one("select kind || '|' || value || '|' || months_left from public.coupon_discounts where firm_id = '%s'" % F2) == "trial_days|30|1", "trial days for billing: 30 days, applied once")
    ok(redeem(B1, "FIRST2FREE").get("code") == "no_stack", "a coupon that does not stack, with a trial running: refused")
    STK1 = save(OWNER, {"code": "STACKPCT", "kind": "percent", "value": 5, "months": 1, "stackable": True}).get("id")
    STK2 = save(OWNER, {"code": "STACKFLAT", "kind": "flat", "value": 10000, "months": 2, "stackable": True}).get("id")
    ok(redeem(B1, "STACKPCT").get("ok") is True, "a stackable percent beside a stackable trial: applied")
    r = redeem(B1, "STACKFLAT")
    ok(r.get("code") == "one_discount" and r.get("error") == "Your firm already has a discount running. Only one discount can run at a time.", "a second fee discount, both stackable: \"%s\"" % r.get("error"))
    r = redeem(E1, "FIRST2FREE")
    ok(r.get("ok") is True and r.get("message") == "Your plan fee is waived for the next 2 months." and one("select kind || '|' || value || '|' || months_left from public.coupon_discounts where firm_id = '%s'" % F5) == "free_months|2|2", "free months: 2 months waived (%s)" % r.get("message"))
    r = redeem(G1, "FLAT500")
    ok(r.get("ok") is True and one("select kind || '|' || value || '|' || months_left from public.coupon_discounts where firm_id = '%s'" % F6) == "flat|50000|1", "flat: ₹500 a month for 1 month")
    # once-per-firm off: the same firm may use it again
    MANY = save(OWNER, {"code": "MANYTIMES", "kind": "credit", "value": 1000, "once_per_firm": False, "stackable": True}).get("id")
    ok(redeem(H1, "MANYTIMES").get("ok") is True and redeem(H1, "MANYTIMES").get("ok") is True and one("select uses from public.coupons where code = 'MANYTIMES'") == "2", "once per firm off: the same firm twice")
    # total uses
    save(OWNER, {"code": "ONEUSE", "kind": "credit", "value": 500, "max_uses": 1, "stackable": True})
    ok(redeem(G1, "ONEUSE").get("code") == "no_stack", "a stackable credit while a coupon that does not stack runs: refused")
    ok(redeem(H1, "ONEUSE").get("ok") is True, "the last use taken")
    r = redeem(C1, "ONEUSE")
    ok(r.get("code") == "used_up" and r.get("error") == "This code has been used up.", "used up: \"%s\"" % r.get("error"))
    ok("console: coupon_in_use" in err(save(OWNER, {"code": "WELCOME11", "kind": "percent", "value": 15, "months": 3}, PCT)), "a used coupon keeps its code")
    ok("console: coupon_in_use" in err(save(OWNER, {"code": "WELCOME10", "kind": "flat", "value": 100, "months": 3}, PCT)), "and its kind")
    MB = save(OWNER, {"code": "MAXB", "kind": "credit", "value": 100, "once_per_firm": False, "stackable": True}).get("id")
    redeem(H1, "MAXB"); redeem(H1, "MAXB")
    ok("console: coupon_max_below_uses" in err(save(OWNER, {"code": "MAXB", "kind": "credit", "value": 100, "max_uses": 1}, MB)), "total uses below the uses already made: refused")
    # RLS: a firm reads its own redemptions only
    ok(one("set role authenticated; set fincom.uid = '%s'; select count(distinct firm_id)::text || '|' || bool_and(firm_id = '%s')::text from public.coupon_redemptions" % (B1, F2)) == "1|true", "a firm reads its own redemptions only")
    ok("permission denied" in (one("set role authenticated; set fincom.uid = '%s'; select count(*) from public.coupons" % B1) or ""), "and never the coupons table")
    # 5 wrong codes an hour (a firm, or a person)
    for i in range(5): redeem(E1, "WRONG%d" % i)
    r = redeem(E1, "TRIAL30")
    ok(r.get("code") == "too_many" and r.get("error") == "Too many wrong codes. Try again in an hour.", "after 5 wrong codes: \"%s\" (even for a good code)" % r.get("error"))
    ok(one("select count(*) from public.coupon_attempts where firm_id = '%s' and reason = 'bad_code'" % F5) == "5", "the tries are recorded")
    ok(redeem(G1, "WRONG9").get("code") == "bad_code", "another firm is not held back")

    print("== 6. races")
    db.sql("create table race_out (who text, res jsonb); grant insert on race_out to authenticated")
    LAST = save(OWNER, {"code": "LASTONE", "kind": "trial_days", "value": 3, "max_uses": 2, "stackable": True}).get("id")
    ok(redeem(B1, "LASTONE").get("ok") is True, "LASTONE: one of two uses taken")
    def race(uid, who, delay, hold):
        time.sleep(delay)
        try: db.sql("set role authenticated; set fincom.uid = '%s'; begin; insert into race_out select '%s', public.coupon_redeem('LASTONE'); select pg_sleep(%s); commit;" % (uid, who, hold))
        except Exception as e: db.sql("insert into race_out values ('%s', jsonb_build_object('err', %s))" % (who, "'" + str(e)[:200].replace("'", "''") + "'"))
    ts = [threading.Thread(target=race, args=(C1, "C", 0, 1.5)), threading.Thread(target=race, args=(H1, "H", 0.4, 0))]
    [t.start() for t in ts]; [t.join() for t in ts]
    out = {r["who"]: json.loads(r["res"]) for r in db.rows("select who, res::text from race_out")}
    oks = sorted(k for k, v in out.items() if v.get("ok"))
    ok(oks == ["C"] and out.get("H", {}).get("code") == "used_up", "two firms take the last use at once: one gets it, the other is told it is used up (%s)" % out)
    ok(one("select uses || '/' || max_uses from public.coupons where code = 'LASTONE'") == "2/2" and one("select count(*) from public.coupon_redemptions where coupon_id = '%s'" % LAST) == "2", "uses 2 of 2, two redemptions")
    db.sql("truncate race_out")
    TWICE = save(OWNER, {"code": "TWICE", "kind": "trial_days", "value": 4, "stackable": True}).get("id")
    def race2(who, delay, hold):
        time.sleep(delay)
        db.sql("set role authenticated; set fincom.uid = '%s'; begin; insert into race_out select '%s', public.coupon_redeem('TWICE'); select pg_sleep(%s); commit;" % (H1, who, hold))
    ts = [threading.Thread(target=race2, args=("1", 0, 1.5)), threading.Thread(target=race2, args=("2", 0.4, 0))]
    [t.start() for t in ts]; [t.join() for t in ts]
    out = {r["who"]: json.loads(r["res"]) for r in db.rows("select who, res::text from race_out")}
    ok(sorted(k for k, v in out.items() if v.get("ok")) == ["1"] and out.get("2", {}).get("code") == "used_by_firm", "one firm sends a once-per-firm code twice at once: one redemption (%s)" % out)
    ok(one("select count(*) from public.coupon_redemptions where coupon_id = '%s'" % TWICE) == "1", "one redemption row")

    print("== 7. billing's contract, the report, the lists")
    did = one("select d.id from public.coupon_discounts d where d.firm_id = '%s' and d.kind = 'percent'" % F1)
    ap = lambda period, amt: js(SR + "select public.coupon_discount_apply(%s, '%s', %d, 'fee:%s')::text" % (did, period, amt, period))
    r = ap("2026-11-01", 50000)
    ok(r.get("applied") is True and r.get("months_left") == 2 and r.get("status") == "active", "November applied: 2 months left (%s)" % r)
    r = ap("2026-11-01", 50000)
    ok(r.get("applied") is False and r.get("months_left") == 2, "November again: nothing changes (idempotent)")
    ap("2026-12-01", 45000); r = ap("2027-01-01", 50000)
    ok(r.get("months_left") == 0 and r.get("status") == "finished", "after 3 months: finished")
    ok(one("select r.status || '|' || r.value_paise from public.coupon_redemptions r join public.coupon_discounts d on d.from_redemption = r.id where d.id = %s" % did) == "finished|145000", "the redemption: finished, ₹1,450 given")
    ok("coupon: discount_done" in err(ap("2027-02-01", 1)), "a fourth month: refused")
    ok("permission denied" in (one("set role authenticated; select public.coupon_discount_apply(%s, '2027-03-01', 1, 'x')" % did) or ""), "signed-in people cannot apply a discount")
    rep = js(SR + "select public.console_coupon_report()::text")
    rows = {(x["code"], x["month"]): x for x in (rep if isinstance(rep, list) else [])}
    ok(rows.get(("WELCOME10", "2026-11-01"), {}).get("discount_paise") == 50000 and rows.get(("WELCOME10", "2026-12-01"), {}).get("discount_paise") == 45000, "report: WELCOME10 per month (₹500 Nov, ₹450 Dec)")
    this_month = one("select date_trunc('month', now() at time zone 'Asia/Kolkata')::date::text")
    ic = rows.get(("ICAI1000", this_month), {})
    ok(ic.get("credit_paise") == 100000 and ic.get("redemptions") == 1 and ic.get("total_inr") == 1000, "report: ICAI1000 this month, ₹1,000 of credit (%s)" % ic)
    lst = js(SR + "select public.console_coupons()::text")
    by = {x["code"]: x for x in (lst if isinstance(lst, list) else [])}
    ok(by.get("ENDME", {}).get("status") == "ended" and by.get("OLD1", {}).get("status") == "expired" and by.get("SOON1", {}).get("status") == "scheduled"
       and by.get("ONEUSE", {}).get("status") == "used_up" and by.get("TRIAL30", {}).get("status") == "active", "list: status worked out (ended, expired, scheduled, used up, active)")
    ok(by.get("ONEUSE", {}).get("usage") == "full" and by.get("SOON1", {}).get("usage") == "unused" and by.get("TRIAL30", {}).get("usage") == "in_use", "list: usage (unused, in use, full)")
    ok(by.get("MONTHLY1", {}).get("plans") == "Monthly, all included" and by.get("TRIAL30", {}).get("plans") == "All plans", "list: plans by name")
    ok(by.get("WELCOME10", {}).get("given_paise") == 145000 and by.get("ICAI1000", {}).get("given_inr") == 1000, "list: rupees given")
    rd = js(SR + "select public.console_coupon_redemptions('%s')::text" % CREDIT)
    ok(isinstance(rd, list) and len(rd) == 1 and rd[0]["firm"] == "Garg Shekhar & Co" and rd[0]["by_email"] == "owner@gsc.test" and rd[0]["value_inr"] == 1000 and rd[0]["source"] == "settings", "redemptions of a coupon: firm, who, source, value (%s)" % (rd[0] if isinstance(rd, list) and rd else rd))
    ok(len(js(SR + "select public.console_coupon_redemptions(null)::text")) >= 10, "every redemption (no coupon given)")
    pl = js(SR + "select public.console_coupon_plans()::text")
    ok(isinstance(pl, list) and [p["name"] for p in pl] == ["Monthly, all included", "Pay as you go"], "plans for the form")
except Exception as e:
    ok(False, "the checks stopped: %s" % str(e)[:400])
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
