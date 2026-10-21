"""python3 run_migration98.py - migration-98-zoho-rolling-minute (21-Oct-2026, branch next-fix-zoho-take; NOT run on staging) on a
throwaway PostgreSQL (pg_stand through zoho_stand, port 30980 unless PG98_PORT; never a real database), after 75.
75's zoho_api_take counted by the wall-clock minute: 90 calls at :59 and 90 more at :00 all went through (CI run
39637004551: 91 calls that crossed :00, all let through). 98 counts any 60 seconds.
  0. the file: one transaction, lock_timeout 10 s; add-only (no "delete from", nothing dropped or truncated; the one table
     change is the new column zoho_api_usage.recent); only zoho_api_take replaced; names no real database; md5 printed
  1. runs, and runs a second time; the function keeps its arguments, result, SECURITY DEFINER, search_path and grants (a
     member still cannot call it); no row of zoho_api_usage changed
  2. the boundary: 90 calls a second ago in the minute before - 75 lets the next through (RED), 98 does not, and says to
     wait until they are a minute old
  3. 91 calls at once (one statement) and 91 one after another: 90 go through, the 91st waits
  4. calls more than 60 seconds old do not count (and are not kept); 90 calls 30 seconds ago: wait 30 s
  5. just after midnight IST the last minute of the day before still counts (from that day's row, which is not changed)
  6. as in 75: zoho_api_block (Zoho's 429) closes the minute; 95% of the day's cap ends the day; the answer's keys"""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import zoho_stand
M98 = zoho_stand.M98
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
F, OWN = "99999999-9999-9999-9999-999999999998", "55555555-5555-5555-5555-555555555558"

print("== 0. the file")
text = open(M98).read() if os.path.exists(M98) else ""
print("   md5 %s, %d bytes" % (hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
alters = re.findall(r"\balter\s+table\b[^;]*;", code)
ok(text and "delete from" not in code and not re.search(r"\b(drop|truncate)\b", code)
   and alters == ["alter table public.zoho_api_usage add column if not exists recent jsonb not null default '[]'::jsonb;"],
   "add-only: no delete from, drop or truncate; the one table change is the new column (%s)" % alters)
ok(re.findall(r"create or replace function public\.([a-z_0-9]+)\(", code) == ["zoho_api_take"], "only zoho_api_take replaced")
ok(text and not re.search(r"supabase\.co|https?://", text.lower()), "names no real database")

db = zoho_stand.build(int(os.environ.get("PG98_PORT", "30980")), run75=True, run98=False)
try:
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing;
      insert into members (user_id, firm_id, name, role, active) values (%(O)s, %(F)s, 'O', 'owner', true);
      insert into clients (id, firm_id, name, gstin) values ('c1', %(F)s, 'Client', '27AAACZ1234Z1ZG');""" % {"F": q(F), "O": q(OWN)})
    G = db.one("select public.zoho_grant_save(%s, %s, 'x', '[{\"id\": \"o1\", \"name\": \"Org\", \"gstin\": \"27AAACZ1234Z1ZG\"}]'::jsonb, now() + interval '1 hour')" % (q(F), q(OWN)))
    C = json.loads(db.one("select public.zoho_link(%s, %s, 'o1', 'c1', '2026-04-01')::text" % (q(OWN), q(G))))["connection"]
    TAKE = "select public.zoho_api_take(%s, 1, 90)::text" % q(C)
    take = lambda: json.loads(db.one(TAKE))
    DAY = "(now() at time zone 'Asia/Kolkata')::date"
    def ninety_at(ago_ms, day=DAY, minute="date_trunc('minute', now()) - interval '1 minute'"):
        # 90 calls ago_ms milliseconds before now, counted (75's way) in the minute before
        db.sql("delete from zoho_api_usage")   # (the test's own reset of a throwaway database; the migration never removes rows)
        cols = "connection_id, day, calls, minute, minute_calls" + (", recent" if has98 else "")
        vals = "%s, %s, 90, %s, 90" % (q(C), day, minute) + (", jsonb_build_array(jsonb_build_array(floor(extract(epoch from now()) * 1000)::bigint - %d, 90))" % ago_ms if has98 else "")
        db.sql("insert into zoho_api_usage (%s) values (%s)" % (cols, vals))
    has98 = False
    # RED: 75 lets the 91st call through when the 90 were in the minute before, a second ago
    ninety_at(1000)
    ok(take()["ok"] is True, "RED (75): 90 calls a second ago, in the minute before: the next one is let through")

    print("== 1. running it twice")
    SIG = "public.zoho_api_take(uuid, integer, integer)"
    FN = "select pg_get_function_identity_arguments(p.oid) || '|' || pg_get_function_result(p.oid) || '|' || p.prosecdef || '|' || array_to_string(p.proconfig, ',') || '|' || coalesce(p.proacl::text, '') from pg_proc p where p.oid = '%s'::regprocedure" % SIG
    USAGE = "select md5(coalesce(string_agg(concat_ws(':', connection_id, day, calls, minute, minute_calls), '|' order by day), '')) from zoho_api_usage"
    fn0, use0 = db.one(FN), db.one(USAGE)
    for i in (1, 2):
        rc, err = zoho_stand.psql_file(db, M98)
        ok(rc == 0, "run %d: no error %s" % (i, err[-300:] if rc else ""))
    has98 = True
    ok(db.one(FN) == fn0, "zoho_api_take keeps its arguments, result, SECURITY DEFINER, search_path and grants (%s)" % fn0)
    ok(db.one(USAGE) == use0 and db.one("select string_agg(distinct recent::text, ',') from zoho_api_usage") == "[]", "no row of zoho_api_usage changed; the new column reads []")
    try: db.rows("set role authenticated; set fincom.uid = %s; %s" % (q(OWN), TAKE)); ok(False, "a member cannot call zoho_api_take")
    except RuntimeError as e: ok("permission denied" in str(e), "a member cannot call zoho_api_take")
    finally: db.sql("reset role")

    print("== 2. the boundary")
    ninety_at(1000)
    t = take()
    ok(t["ok"] is False and t["daily"] is False and 58 <= t["wait"] <= 60, "90 calls a second ago, in the minute before: the next waits until they are a minute old (%s)" % t)

    print("== 3. 91 calls")
    db.sql("delete from zoho_api_usage")
    one = db.one("select string_agg((public.zoho_api_take(%s, 1, 90))->>'ok', ',' order by i) from generate_series(1, 91) i" % q(C)).split(",")
    ok(one[:90] == ["true"] * 90 and one[90] == "false", "91 at once (one statement, one now()): 90 go through, the 91st waits")
    db.sql("delete from zoho_api_usage")
    seq = [db.one("select (public.zoho_api_take(%s, 1, 90))->>'ok'" % q(C)) for _ in range(91)]
    ok(seq[:90] == ["true"] * 90 and seq[90] == "false", "91 one after another (separate statements, whatever the clock): 90 go through, the 91st waits")
    ok(db.one("select sum((e->>1)::int) from zoho_api_usage, jsonb_array_elements(recent) e") == "90", "the 90 kept in recent")

    print("== 4. older calls")
    ninety_at(60001, minute="date_trunc('minute', now()) - interval '2 minutes'")
    ok(take()["ok"] is True and db.one("select jsonb_array_length(recent) from zoho_api_usage") == "1", "90 calls just over 60 seconds ago: the next goes through, and only it is kept")
    ninety_at(30000)
    t = take()
    ok(t["ok"] is False and 29 <= t["wait"] <= 30, "90 calls 30 seconds ago: wait 30 s (%s)" % t)

    print("== 5. midnight IST")
    ninety_at(1000, day=DAY + " - 1")
    t = take()
    ok(t["ok"] is False and 58 <= t["wait"] <= 60, "90 calls a second ago on the day before (its own row): the first call of the new day waits (%s)" % t)
    ok(db.one("select jsonb_array_length(recent) from zoho_api_usage where day = %s - 1" % DAY) == "1" and db.one("select recent::text from zoho_api_usage where day = %s" % DAY) == "[]",
       "the day before's row not changed; nothing of it copied into the new day's")

    print("== 6. as in 75")
    db.sql("delete from zoho_api_usage")
    t = take()
    ok(t["ok"] is True and sorted(t) == ["cap", "ok", "used"] and t["used"] == 1, "a call taken: ok, used, cap (%s)" % t)
    db.sql("select public.zoho_api_block(%s, false)" % q(C))
    t = take()
    ok(t["ok"] is False and t["daily"] is False and sorted(t) == ["cap", "daily", "ok", "used", "wait"], "Zoho's 429 (zoho_api_block) closes the minute (%s)" % t)
    db.sql("update zoho_api_usage set calls = 950, minute_calls = 0, recent = '[]'")
    t = take()
    ok(t["ok"] is False and t["daily"] is True and t["wait"] > 0, "95%% of the day's cap: no more today, until midnight IST (%s)" % t)
finally:
    db.stop()
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
