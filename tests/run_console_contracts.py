"""python3 run_console_contracts.py - the contracts BETWEEN the console's modules (integration branch integ-console,
27-Oct-2026), on a throwaway PostgreSQL (pg_stand, port 31130 unless PGCC_PORT; never a real database) with migrations
118 to 123 run for real, in their order (tests/console_chain_stand.py), and made-up firms:
  1. coupons in billing's monthly run (docs/CONSOLE-COUPONS.md, "the contract with billing"): percent (with its cap),
     flat and free-months discounts are taken off the month's fee with a 'discount' ledger line linked to the redemption
     and coupon_discount_apply() called once per month; a firm short even after the discount keeps its discount for the
     retry (a top-up); trial_days extends the subscription's trial; running again changes nothing; free credit posts
     through console_credit_post with the ledger's kind (coupon_credit)
  2. AI over the allowance (docs/CONSOLE-AI.md): when the plan's (or firm's) rule is 'charge', the daily job
     ai_usage_charge_run(day) posts ONE ledger line per firm, feature and day (kind ai_usage, ref feature:period:firm:day)
     at the feature's price for the uses past the allowance; included features cost nothing; 'stop' and no allowance
     charge nothing; again = nothing; a firm short of credit is retried after a top-up; the pg_cron job
  3. the stages: my_firm_status() says the stage (the console's suspended / closed, billing's past_due / read_only /
     paused / cancelled, or active / trial), whether writing is blocked and whether reading is (paused: sign in and pay
     only); firm_is_writable() agrees
RED: each check fails before the integration's changes (the coupon credit kind, the run's discounts, the AI job, the
stage fields)."""
import os, sys, json, re
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import console_chain_stand as C

fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w); sys.stdout.flush()
    if not c: fails.append(w)

U = lambda n: "00000000-0000-4000-8000-%012d" % n
OWNER, BILL = U(1), U(3)
ALLP, PAYG, NOAI = U(201), U(202), U(203)
# firms (and their owners' logins: firm + 1000)
F = {k: U(400 + i) for i, k in enumerate(["pct", "flat", "free", "trial", "plain", "cred", "shortc", "ai", "ai2", "aistop", "ainone", "ro", "paused", "susp", "pastdue"])}
L = {k: U(1400 + i) for i, k in enumerate(F)}

FIX = """
insert into auth.users (id, email) values ('%(O)s', 'owner@fincom.live'), ('%(B)s', 'bill@fincom.live');
insert into public.console_admins (user_id, role) values ('%(O)s', 'owner'), ('%(B)s', 'billing') on conflict do nothing;
insert into modules (code, title, unit, price, billing, sort) values ('clients', 'Clients', 'per client per month', 50, 'per_month', 1),
  ('cloud', 'Shared data', 'per person per month', 100, 'per_month', 8) on conflict do nothing;
insert into plans (id, name, monthly_fee, includes) values ('%(ALLP)s', 'Monthly, all included', 4000, '{"cloud": {"cap": null}}'),
  ('%(PAYG)s', 'Pay as you go', 0, '{"cloud": {"cap": null}}'), ('%(NOAI)s', 'No AI rule', 0, '{"cloud": {"cap": null}}');
""" % {"O": OWNER, "B": BILL, "ALLP": ALLP, "PAYG": PAYG, "NOAI": NOAI}
BAL = {"pct": 10000, "flat": 3500, "free": 100, "trial": 100, "plain": 10000, "cred": 0, "shortc": 100, "ai": 1000, "ai2": 1, "aistop": 1000,
       "ainone": 1000, "ro": 0, "paused": 0, "susp": 0, "pastdue": 0}
PLAN = {"ai": PAYG, "ai2": PAYG, "aistop": PAYG, "ainone": NOAI}
for k in F:
    FIX += "insert into auth.users (id, email) values ('%s', '%s@firm.test');\n" % (L[k], k)
    FIX += ("insert into firms (id, name, plan_id, balance, period_start, created_at) values ('%s', 'Firm %s', '%s', %s, "
            "date_trunc('month', now() - interval '1 month')::date, now() - interval '40 days');\n") % (F[k], k, PLAN.get(k, ALLP), BAL[k])
    FIX += "insert into members (user_id, firm_id, name, email, role, active) values ('%s', '%s', '%s', '%s@firm.test', 'owner', true);\n" % (L[k], F[k], k, k)
    if BAL[k]: FIX += "insert into wallet_entries (firm_id, kind, code, amount, balance_after, note) values ('%s', 'credit', 'wallet', %s, %s, '');\n" % (F[k], BAL[k], BAL[k])

db = C.start(int(os.environ.get("PGCC_PORT") or 31130))
SR = "set role service_role; "
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
q = lambda s: "null" if s is None else "'" + str(s).replace("'", "''") + "'"
J = lambda d: q(json.dumps(d)) + "::jsonb"
def bal(k): return one("select (round(balance * 100))::bigint::text from firms where id = '%s'" % F[k])
def lines(k, kind=None):
    return [r for r in db.rows("select kind, round(amount * 100)::bigint::text as paise, ref, idem_key, code from wallet_entries where firm_id = '%s'%s order by id"
                               % (F[k], " and kind = '%s'" % kind if kind else ""))]
def coupon(data):
    return js(SR + "select public.console_coupon_save('%s', null, %s, 'a campaign', null, null)::text" % (OWNER, J(data)))
def redeem(k, code):
    return js("set role authenticated; select public.coupon_redeem(%s, 'settings')::text" % q(code), L[k])
def status_of(k): return js("set role authenticated; select public.my_firm_status()::text", L[k])
TODAY = one("select (now() at time zone 'Asia/Kolkata')::date::text")
MONTH = one("select date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date::text")

try:
    print("== 0. the chain runs (118 -> 123)")
    res = C.apply(db)
    ok(all(e is None for _, e in res), "118 to 123 run in order (%s)" % [x for x in res if x[1]])
    e = try_sql(FIX)
    ok(e is None, "made-up firms (%s)" % (e or "")[:300])

    print("== 1. coupons in the monthly run")
    codes = {"pct": {"code": "PCT20", "kind": "percent", "value": 20, "months": 2, "max_off_paise": 50000},
             "flat": {"code": "FLAT1000", "kind": "flat", "value": 100000, "months": 1},
             "free": {"code": "FREEMONTH", "kind": "free_months", "value": 1},
             "trial": {"code": "TRIAL30", "kind": "trial_days", "value": 30},
             "cred": {"code": "CREDIT250", "kind": "credit", "value": 25000},
             "shortc": {"code": "TENOFF", "kind": "percent", "value": 10, "months": 1}}
    for k, d in codes.items():
        c = coupon(d)
        ok(c.get("id"), "coupon %s made (%s)" % (d["code"], c.get("_err", "")[:200]))
    db.sql("update public.subscriptions set status = 'trial', trial_ends_on = (now() at time zone 'Asia/Kolkata')::date - 1 where firm_id = '%s'" % F["trial"])
    for k, d in codes.items():
        r = redeem(k, d["code"])
        ok(r.get("ok") is True, "%s: redeemed (%s)" % (d["code"], r.get("error") or r.get("_err", "")[:300]))
    ok(bal("cred") == "25000" and [(x["kind"], x["paise"]) for x in lines("cred")] == [("coupon_credit", "25000")],
       "free credit: ₹250 through console_credit_post, one coupon_credit line (%s %s)" % (bal("cred"), lines("cred")))

    rep = js(SR + "select public.console_billing_run(null, '%s', 'month', 'the month')::text" % OWNER)
    out = {x["firm_id"]: x for x in rep.get("rows", [])}
    ok(not rep.get("_err"), "the run (%s)" % rep.get("_err", "")[:300])
    # percent: 20% of ₹4,000 = ₹800, capped at ₹500
    ok(out.get(F["pct"], {}).get("outcome") == "charged" and bal("pct") == str(1000000 - 400000 + 50000),
       "percent: ₹4,000 less 20%% capped at ₹500 = ₹3,500 taken (%s)" % bal("pct"))
    pl = lines("pct")
    ok([(x["kind"], x["paise"]) for x in pl[1:]] == [("discount", "50000"), ("fee", "-400000")], "percent: a discount line and the fee line (%s)" % pl[1:])
    red_pct = one("select from_redemption::text from public.coupon_discounts where firm_id = '%s'" % F["pct"])
    ok(any(x["kind"] == "discount" and x["ref"] == red_pct and x["code"] == "coupon" for x in pl), "the discount line's reference is the redemption")
    d = js("select to_jsonb(d)::text from public.coupon_discounts d where firm_id = '%s'" % F["pct"])
    ok(d.get("months_left") == 1 and d.get("status") == "active" and d.get("given_paise") == 50000 and d.get("last_period") == MONTH,
       "percent: coupon_discount_apply called: one month of two left, ₹500 given (%s)" % d)
    ok(one("select count(*) from public.coupon_discount_months m join public.coupon_discounts d on d.id = m.discount_id where d.firm_id = '%s' and m.period = '%s' and m.amount_paise = 50000 and m.ledger_ref like 'discount:%%'" % (F["pct"], MONTH)) == "1",
       "percent: the month recorded with its ledger line")
    ok(bal("flat") == "50000" and one("select status from public.coupon_discounts where firm_id = '%s'" % F["flat"]) == "finished"
       and one("select status || value_paise from public.coupon_redemptions where firm_id = '%s'" % F["flat"]) == "finished100000",
       "flat: ₹1,000 off a ₹4,000 fee with ₹3,500 credit: charged ₹3,000; discount and redemption finished (%s)" % bal("flat"))
    ok(out.get(F["free"], {}).get("outcome") == "charged" and bal("free") == "10000" and [(x["kind"], x["paise"]) for x in lines("free")[1:]] == [("discount", "400000"), ("fee", "-400000")],
       "free month: the whole fee waived (₹100 credit is enough), both lines written (%s)" % lines("free")[1:])
    ok(out.get(F["shortc"], {}).get("outcome") == "short" and bal("shortc") == "10000" and len(lines("shortc")) == 1
       and one("select months_left || status from public.coupon_discounts where firm_id = '%s'" % F["shortc"]) == "1pending",
       "short even after 10%% off: past due, no line, the discount kept for the retry")
    ok(out.get(F["plain"], {}).get("outcome") == "charged" and bal("plain") == "600000" and [x["kind"] for x in lines("plain")[1:]] == ["fee"], "no coupon: the fee alone")
    s = js("select to_jsonb(s)::text from public.subscriptions s where firm_id = '%s'" % F["trial"])
    ok(out.get(F["trial"], {}).get("outcome") == "trial" and s.get("status") == "trial"
       and s.get("trial_ends_on") == one("select ((now() at time zone 'Asia/Kolkata')::date + 30)::text") and bal("trial") == "10000",
       "trial days: the trial ended yesterday; 30 days from today (the later of its end and today), still a trial, nothing charged (%s)" % s)
    ok(one("select status || '/' || months_left from public.coupon_discounts where firm_id = '%s'" % F["trial"]) == "finished/0"
       and one("select count(*) from public.coupon_discount_months m join public.coupon_discounts d on d.id = m.discount_id where d.firm_id = '%s' and m.amount_paise = 0" % F["trial"]) == "1",
       "trial days: coupon_discount_apply(…, 0, …) once; finished")
    n = one("select count(*) from wallet_entries"); t = one("select trial_ends_on::text from public.subscriptions where firm_id = '%s'" % F["trial"])
    rep2 = js(SR + "select public.console_billing_run(null, '%s', 'month', 'again')::text" % OWNER)
    ok(not rep2.get("_err") and one("select count(*) from wallet_entries") == n and one("select trial_ends_on::text from public.subscriptions where firm_id = '%s'" % F["trial"]) == t
       and one("select months_left::text from public.coupon_discounts where firm_id = '%s'" % F["pct"]) == "1", "run again: nothing changes")
    r = js(SR + "select public.console_credit_topup('%s', '%s', 500000, 'bank', 'NEFT-1', null, 'paid', null, null)::text" % (OWNER, F["shortc"]))
    ok(not r.get("_err") and bal("shortc") == str(10000 + 500000 - 360000) and one("select status from public.coupon_discounts where firm_id = '%s'" % F["shortc"]) == "finished",
       "the top-up retries the fee: 10%% off taken then (%s %s)" % (bal("shortc"), r.get("_err", "")[:200]))

    print("== 2. AI over the allowance: the daily job")
    D = "2026-09-15"
    db.sql(SR + "select public.console_ai_plan_set('%s', '%s', 1000, 'charge', 'ten rupees then pay', null, null)" % (OWNER, PAYG))
    db.sql(SR + "select public.console_ai_feature_set('%s', 'assistant', %s, 'two rupees a question', null, null)" % (OWNER, J({"price_mode": "per_use", "price_per_use_paise": 200})))
    db.sql(SR + "select public.console_ai_feature_set('%s', 'call_summary', %s, 'by the token', null, null)" % (OWNER, J({"price_mode": "per_token", "price_in_mtok_paise": 30000, "price_out_mtok_paise": 150000})))
    db.sql("insert into public.ai_firm_settings (firm_id, after_allowance) values ('%s', 'stop')" % F["aistop"])
    for k in ("ai", "ai2", "aistop", "ainone"):
        db.sql("insert into assistant_usage (firm_id, day, calls, cost_inr) values ('%s', '2026-09-10', 3, 8.00)" % F[k])
        rows = [("09:00", "book", 1.50, 0, 0), ("10:00", "general", 1.00, 0, 0), ("11:00", "book", 0.50, 0, 0), ("12:00", "file", 0.50, 0, 0),
                ("13:00", "call_summary", 0.40, 100000, 20000), ("14:00", "voice", 0.10, 0, 0)]
        for at, feat, cost, tin, tout in rows:
            db.sql("insert into assistant_log (firm_id, at, feature, cost_inr, input_tokens, output_tokens, calls) values ('%s', '%s %s+05:30', '%s', %s, %s, %s, 1)" % (F[k], D, at, feat, cost, tin, tout))
        db.sql("insert into assistant_usage (firm_id, day, calls, cost_inr) values ('%s', '%s', 6, 4.00)" % (F[k], D))
    r = js(SR + "select public.ai_usage_charge_run('%s')::text" % D)
    ok(not r.get("_err"), "the job runs for a day (%s)" % r.get("_err", "")[:300])
    al = lines("ai", "ai_usage")
    ok(sorted((x["paise"], x["ref"]) for x in al) == sorted([("-400", "assistant:2026-09:%s:%s" % (F["ai"], D)), ("-6000", "call_summary:2026-09:%s:%s" % (F["ai"], D))]),
       "one line per feature and day: Ask FinCom 2 uses past ₹10 x ₹2, the call summary by its tokens ₹60; voice is included (%s)" % al)
    ok(bal("ai") == str(100000 - 6400), "the balance moved with the lines")
    ok(lines("aistop", "ai_usage") == [] and lines("ainone", "ai_usage") == [], "rule 'stop' and no allowance: nothing charged")
    ok(lines("ai2", "ai_usage") == [] and one("select count(*) from public.ai_usage_charges where firm_id = '%s' and status = 'short'" % F["ai2"]) == "2",
       "short of credit: no line, kept as owed")
    n = one("select count(*) from wallet_entries")
    js(SR + "select public.ai_usage_charge_run('%s')::text" % D)
    ok(one("select count(*) from wallet_entries") == n, "again for the same day: nothing new")
    db.sql(SR + "select public.console_credit_topup('%s', '%s', 100000, 'bank', 'NEFT-2', null, 'paid', null, null)" % (OWNER, F["ai2"]))
    js(SR + "select public.ai_usage_charge_run('2026-09-16')::text")
    ok(len(lines("ai2", "ai_usage")) == 2 and one("select count(*) from public.ai_usage_charges where firm_id = '%s' and status = 'charged'" % F["ai2"]) == "2",
       "after a top-up the next day's job charges what was owed")
    ok(one("select relrowsecurity::text from pg_class where relname = 'ai_usage_charges'") == "true"
       and one("select has_function_privilege('authenticated', 'public.ai_usage_charge_run(date)', 'execute')::text") == "false",
       "the job's table: RLS on; the job: not for signed-in people")
    t121 = open(C.PATHS[3][1]).read()
    ok("cron.schedule('console-ai-usage-daily', '40 18 * * *'" in t121, "pg_cron: daily at 00:10 India time, yesterday's use")

    print("== 3. the stages")
    db.sql("update public.subscriptions set status = 'read_only', read_only_since = current_date where firm_id = '%s'" % F["ro"])
    db.sql("update public.subscriptions set status = 'paused', paused_since = current_date where firm_id = '%s'" % F["paused"])
    db.sql("update public.subscriptions set status = 'past_due', past_due_since = current_date, grace_until = current_date + 7 where firm_id = '%s'" % F["pastdue"])
    db.sql("update firms set status = 'suspended', status_reason = 'asked to stop' where id = '%s'" % F["susp"])
    want = {"plain": ("active", False, True), "trial": ("trial", False, True), "pastdue": ("past_due", False, True), "ro": ("read_only", True, True),
            "paused": ("paused", True, False), "susp": ("suspended", True, True)}
    for k, (stage, ro, rd) in want.items():
        st = status_of(k)
        ok(st.get("stage") == stage and st.get("read_only") is ro and st.get("can_read") is rd,
           "%s: stage %s, writing %s, reading %s (%s)" % (k, stage, "blocked" if ro else "allowed", "allowed" if rd else "blocked", st))
        ok(one("set role authenticated; select public.firm_is_writable()::text", L[k]) == ("false" if ro else "true"), "%s: firm_is_writable agrees" % k)
    st = status_of("susp")
    ok(st.get("status") == "suspended" and st.get("reason") == "asked to stop" and status_of("paused").get("billing_status") == "paused",
       "the old fields kept (status, reason, billing_status)")
finally:
    db.stop()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
