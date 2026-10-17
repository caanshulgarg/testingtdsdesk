"""python3 run_migration96.py - migration-96-assistant-monthly-cap (17-Oct-2026, branch next-ai-monthly; the owner's decision of
17-Oct-2026: the firm's AI cost limit is MONTHLY, Rs 3,000 a firm a calendar month by India's date, shared by Ask FinCom and the
2B matching; the warning at 80% stays; the owner can change it in Settings), on a throwaway PostgreSQL (pg_stand through
assistant_stand, port 30960; never a real database), after 77 and the assistant's later migrations as staging has them.
  0. the file: one transaction (lock_timeout 10 s), add-only (no "delete from", nothing dropped or truncated; the only
     table change is the new column), names no real database.
  1. runs, and runs a second time with nothing changed; assistant_caps.monthly_inr: default 3000, 0 to 10,000,000; a firm's
     row from before keeps its daily figures and gets 3000.
  2. nothing else changed: every other function, column, row and policy as before; the four functions replaced keep their
     arguments, SECURITY DEFINER, search_path and grants.
  3. the cap counts the calendar month (India's date): the 1st of the month counts, the last day of the month before does
     not; the warning at 80% (2,400 of 3,000); at 3,000 no new AI call (why "inr"); the status the same; 'period': 'month'.
  4. a new month starts at 0: a firm that spent over the cap last month makes a call this month.
  5. the daily call count (daily_calls) still limits the calls of a day (why "calls").
  6. the owner's setter sets monthly_inr (staff cannot; out of 0..10,000,000 refused; null keeps it); daily_inr untouched.
  7. the JSON keeps its keys (callers keep working), plus 'period': 'month'.
RED_WITHOUT_96=1: the same checks without running the file (1, 3, 4, 6, 7 fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ["ASST_SKIP_96"] = "1"          # the stand's chain without 96: this test runs it itself
import assistant_stand as A
M96 = os.path.join(HERE, "..", "server", "assistant", "migration-96-assistant-monthly-cap.sql")
RED = os.environ.get("RED_WITHOUT_96") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M96).read() if os.path.exists(M96) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M96), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
low = text.lower(); code = "\n".join(l.split("--")[0] for l in low.splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "0. one transaction, lock_timeout 10 s")
alters = re.findall(r"\balter\s+table\b[^;]*;", code)
ok(text and "delete from" not in code and not re.search(r"\b(drop|truncate)\b", code)
   and alters == ["alter table public.assistant_caps add column if not exists monthly_inr numeric(12,2) not null default 3000 check (monthly_inr between 0 and 10000000);"],
   "0. add-only: no delete from, drop or truncate; the one table change is the new column (%s)" % alters)
ok(text and not re.search(r"supabase\.co|https?://", low), "0. names no real database")

REPLACED = ("asst_cap_take", "asst_cost_add", "asst_usage", "asst_set_cap")
FIRM, OTHER, THIRD = A.FIRM, A.OTHER, "33333333-3333-4333-8333-333333333333"
OWNER, STAFF, OWNER3 = A.ME, A.STAFF, "aaaaaaaa-0000-4000-8000-000000000009"
db = A.start(int(os.environ.get("PG96_PORT") or 30960))
J = lambda q: json.loads(db.one(q))
def err(q, uid=None):
    try:
        (A.ask(db, q, uid) if uid else db.one(q)); return ""
    except RuntimeError as e: return str(e)
def R(q):
    try: return db.rows(q)
    except RuntimeError as e: return [{"error": str(e)[:120]}]
def snap():
    fn = {r["sig"]: r for r in db.rows("select p.oid::regprocedure::text sig, md5(p.prosrc) src, p.prosecdef::text def, coalesce(array_to_string(p.proconfig, ','), '') cfg, "
                                         "coalesce(p.proacl::text, '') acl, pg_get_function_result(p.oid) res from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")}
    cols = {(r["t"], r["c"]): r for r in db.rows("select table_name t, column_name c, data_type || coalesce(numeric_precision::text, '') ty, coalesce(column_default, '') dflt, is_nullable nn "
                                                 "from information_schema.columns where table_schema = 'public'")}
    data = {t: db.one("select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from %s x" % t)
            for t in ("assistant_usage", "assistant_usage_feature", "assistant_log", "assistant_settings")}
    data["caps"] = db.one("select coalesce(string_agg(firm_id || ':' || daily_calls || ':' || daily_inr || ':' || inr_per_usd, ','), '') from assistant_caps")
    pol = db.one("select md5(coalesce(string_agg(tablename || policyname || coalesce(qual, '') || coalesce(with_check, ''), '|' order by tablename, policyname), '')) from pg_policies")
    tacl = db.one("select md5(coalesce(string_agg(relname || coalesce(relacl::text, ''), '|' order by relname), '')) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'")
    return fn, cols, data, pol, tacl
try:
    A.migrate(db)
    D = db.one("select (now() at time zone 'Asia/Kolkata')::date")
    M0 = db.one("select date_trunc('month', (now() at time zone 'Asia/Kolkata')::date)::date")
    PREV = db.one("select (date_trunc('month', (now() at time zone 'Asia/Kolkata')::date) - interval '1 day')::date")
    print("  India's date %s; this month from %s; the day before it %s" % (D, M0, PREV))
    db.sql("insert into firms values ('%s', 'A'), ('%s', 'B'), ('%s', 'C') on conflict do nothing;" % (FIRM, OTHER, THIRD) +
           " insert into members (user_id, firm_id, name, role) values ('%s', '%s', 'Owner', 'owner'), ('%s', '%s', 'Staff', 'staff'), ('%s', '%s', 'Owner C', 'owner');" % (OWNER, FIRM, STAFF, FIRM, OWNER3, THIRD) +
           # a firm whose owner set a daily cap before 96, and its use last month (over any cap)
           " insert into assistant_caps (firm_id, daily_calls, daily_inr, inr_per_usd) values ('%s', 2, 500, 90);" % OTHER +
           " insert into assistant_usage (firm_id, day, calls, cost_inr) values ('%s', '%s', 40, 5000);" % (OTHER, PREV) +
           # this firm: 2,500 on the last day of last month (not counted), 1,000 on the 1st of this month (counted)
           " insert into assistant_usage (firm_id, day, calls, cost_inr) values ('%s', '%s', 9, 2500), ('%s', '%s', 3, 1000);" % (FIRM, PREV, FIRM, M0))
    before = snap()
    if not RED:
        db.sql(text); first = snap(); db.sql(text); second = snap()
    else:
        first = second = snap()
    # ---- 1
    col = db.rows("select column_default d, is_nullable n, numeric_precision p, numeric_scale s from information_schema.columns where table_name = 'assistant_caps' and column_name = 'monthly_inr'")
    ok(col and col[0]["d"] == "3000" and col[0]["n"] == "NO" and (col[0]["p"], col[0]["s"]) == ("12", "2"), "1. assistant_caps.monthly_inr numeric(12,2) not null default 3000 (%s)" % col)
    ok(first == second, "1. the second run changes nothing (functions, columns, rows, policies, grants)")
    bad = [err("insert into assistant_caps (firm_id, monthly_inr) values ('%s', 10000001)" % THIRD), err("insert into assistant_caps (firm_id, monthly_inr) values ('%s', -1)" % THIRD)]
    ok(all("check" in b for b in bad), "1. over 10,000,000 or below 0 is refused by the column's check")
    o = R("select daily_calls, daily_inr, inr_per_usd, monthly_inr from assistant_caps where firm_id = '%s'" % OTHER)
    ok(o == [{"daily_calls": "2", "daily_inr": "500.00", "inr_per_usd": "90.00", "monthly_inr": "3000.00"}], "1. a firm's row from before: its daily figures kept, 3,000 a month (%s)" % o)
    # ---- 2
    fb, cb, db_, pb, tb = before; fa, ca, da, pa, ta = first
    other = [s for s in fb if s.split("(")[0] not in REPLACED and (s not in fa or fa[s] != fb[s])]
    ok(not other and set(fa) == set(fb), "2. every other function as before, none added or removed (%s)" % other[:5])
    keep = [s for s in fb if s.split("(")[0] in REPLACED]
    same = all(fa[s]["def"] == fb[s]["def"] == "true" and fa[s]["cfg"] == fb[s]["cfg"] == "search_path=public, pg_temp" and fa[s]["acl"] == fb[s]["acl"] and fa[s]["res"] == fb[s]["res"] for s in keep)
    ok(len(keep) == 4 and same, "2. the four replaced keep their arguments, result, SECURITY DEFINER, search_path and grants (%s)" % keep)
    ok(RED or all(fa[s]["src"] != fb[s]["src"] for s in keep), "2. and their text is 96's")
    newcols = sorted(set(ca) - set(cb))
    ok(newcols == [("assistant_caps", "monthly_inr")] and all(ca[k] == cb[k] for k in cb), "2. one column added, every other column as before (%s)" % newcols)
    ok(da == db_ and pa == pb and ta == tb, "2. every row, policy and table grant as before")
    # ---- 3: the month, by India's date
    take = lambda f=FIRM: J("select asst_cap_take('%s', 1)" % f)
    cost = lambda usd, f=FIRM, feat="book": J("select asst_cost_add('%s', '%s', %s, 1000, 100, 0, 0)" % (f, feat, usd))
    t = take()
    ok(t.get("ok") and t.get("cap_inr") == 3000 and t.get("spent_inr") == 1000 and not t.get("warn") and t.get("period") == "month",
       "3. the cap is 3,000 a month; the 1st of the month counts (1,000), the last day of last month (2,500) does not (%s)" % t)
    c = cost(16)
    ok(c.get("inr") == 1360 and c.get("spent_inr") == 2360 and not c.get("warn") and not c.get("over") and c.get("period") == "month", "3. a call of $16 at Rs 85: 1,360; the month at 2,360, no warning (%s)" % c)
    c = cost(1)
    ok(c.get("spent_inr") == 2445 and c.get("warn") and not c.get("over"), "3. at 2,445 of 3,000 (over 80%%) the warning is on (%s)" % c)
    t = take()
    ok(t.get("ok") and t.get("warn"), "3. under the cap: the call is taken, with the warning")
    c = cost(7)
    ok(c.get("spent_inr") == 3040 and c.get("over"), "3. at 3,040 the month is over the cap (%s)" % c)
    t = take()
    ok(not t.get("ok") and t.get("why") == "inr" and t.get("spent_inr") == 3040 and t.get("cap_inr") == 3000 and t.get("period") == "month", "3. no new AI call this month (%s)" % t)
    u = json.loads(A.ask(db, "select asst_usage(30)", OWNER) or "{}")
    ok(u.get("spent_inr") == 3040 and u.get("cap_inr") == 3000 and u.get("over") and u.get("warn") and u.get("period") == "month", "3. the status: this month's spend against the monthly cap (%s)" % {k: u.get(k) for k in ("spent_inr", "cap_inr", "warn", "over", "period", "today")})
    ok(all("Asia/Kolkata" in db.one("select prosrc from pg_proc where proname = '%s'" % f) for f in REPLACED[:3]), "3. the month is India's (Asia/Kolkata)")
    # ---- 4: a new month starts at 0
    t = take(OTHER)
    ok(t.get("ok") and t.get("spent_inr") == 0 and t.get("cap_inr") == 3000, "4. a firm that spent 5,000 last month starts this month at 0 (%s)" % t)
    # ---- 5: the daily call count
    t2 = take(OTHER); t3 = take(OTHER)
    ok(t2.get("ok") and not t3.get("ok") and t3.get("why") == "calls" and t3.get("used") == 2 and t3.get("cap") == 2, "5. daily_calls 2: the third call of the day is refused, why 'calls' (%s)" % t3)
    # ---- 6: the owner's setter
    e = err("select asst_set_cap(5000, null)", STAFF)
    ok("only the firm's owner" in e, "6. staff cannot set the cap")
    r = json.loads(A.ask(db, "select asst_set_cap(5000, null)", OWNER) or "{}")
    row = R("select daily_inr, monthly_inr, inr_per_usd from assistant_caps where firm_id = '%s'" % FIRM)
    ok(r.get("cap_inr") == 5000 and r.get("rate") == 85 and r.get("period") == "month" and row == [{"daily_inr": "150.00", "monthly_inr": "5000.00", "inr_per_usd": "85.00"}], "6. the owner sets 5,000 a month; daily_inr untouched (%s; %s)" % (r, row))
    ok(take().get("ok"), "6. at 3,040 of 5,000: calls again")
    r = json.loads(A.ask(db, "select asst_set_cap(null, 84.5)", OWNER) or "{}")
    ok(r.get("cap_inr") == 5000 and r.get("rate") == 84.5, "6. null keeps the cap; the rate set (%s)" % r)
    rng = [err("select asst_set_cap(10000001, null)", OWNER), err("select asst_set_cap(-1, null)", OWNER)]
    ok(all("cap out of range" in x for x in rng), "6. above 10,000,000 or below 0 is refused (%s)" % [x[:60] for x in rng])
    r = json.loads(A.ask(db, "select asst_set_cap(10000000, null)", OWNER) or "{}")
    ok(r.get("cap_inr") == 10000000, "6. 10,000,000 is allowed")
    r = json.loads(A.ask(db, "select asst_set_cap(1200, null)", OWNER3) or "{}")
    ok(r.get("cap_inr") == 1200 and R("select monthly_inr || '/' || daily_inr x from assistant_caps where firm_id = '%s'" % THIRD) == [{"x": "1200.00/150.00"}], "6. a firm with no row: the setter makes one with the monthly cap")
    # ---- 7: the keys
    t = take(THIRD); c = cost(0.1, THIRD); u = json.loads(A.ask(db, "select asst_usage(30)", OWNER) or "{}"); us = json.loads(A.ask(db, "select asst_usage(30)", STAFF) or "{}")
    ok(set(t) >= {"ok", "used", "cap", "spent_inr", "cap_inr", "rate", "day", "warn", "period"}, "7. asst_cap_take's keys (%s)" % sorted(t))
    ok(set(c) >= {"inr", "spent_inr", "cap_inr", "warn", "over", "period"}, "7. asst_cost_add's keys (%s)" % sorted(c))
    ok(set(u) >= {"cap", "today", "owner", "cap_inr", "rate", "spent_inr", "warn", "over", "days", "months", "features", "questions", "fell_through", "period"} and isinstance(u.get("days"), list)
       and us.get("owner") is False and us.get("days") is None and us.get("spent_inr") == u.get("spent_inr"), "7. asst_usage's keys; staff see the month's spend and the cap only")
    e = [err("select asst_cap_take('%s', 1)" % FIRM, OWNER), err("select asst_cost_add('%s', 'x', 0, 0, 0, 0, 0)" % FIRM, OWNER)]
    ok(all("permission denied" in x for x in e), "7. a member still cannot take calls or add cost (the function's service role only)")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
