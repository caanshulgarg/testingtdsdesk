"""python3 run_migration108.py - migration-108-client-timings (26-Oct-2026, branch next-timings; NOT run on staging) on a
throwaway PostgreSQL (pg_stand, port 31080 unless PG108_PORT; never a real database), with Supabase's default
privileges (every new table, view, sequence and function in public granted to anon, authenticated and service_role), so
the file's own grants are what is checked.
  0. the file: one transaction, lock_timeout 10 s; add-only (no drop, no table altered but to turn RLS on, no truncate;
     the only delete is the 30-day sweep's); names no real database; md5 printed
  1. it runs, and runs a second time (the same table, policies, functions and view after each run)
  2. grants: anon nothing (table, sequence, view, functions); authenticated select + insert on the table (under RLS), the
     report and the view; service_role everything; the sweep for service_role only
  3. RLS: a member inserts a row for themself and their firm (the defaults fill both); a row for another firm or another
     person is refused; a member who is not the owner reads nothing; the owner reads the firm's rows only; a platform
     administrator reads every firm's; a summary that is not an object, or over 32 KB, is refused
  4. client_timings_report / client_timings_summary: p50 / p95 from the summed histograms (worked by hand), 24 h against
     7 days, the owner's own firm only; the sweep removes rows over 30 days old only
RED_WITHOUT_108=1: the same checks without running the file (0 holds, 1 to 4 fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M = os.path.join(HERE, "..", "server", "security", "migration-108-client-timings.sql")
RED = os.environ.get("RED_WITHOUT_108") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M).read()
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(not re.search(r"\bdrop\s", code) and "truncate" not in code, "nothing dropped or truncated")
ok(re.findall(r"\balter\s+table\s+([\w.]+)\s+(\w+)", code) == [("public.client_timings", "enable")], "no table altered but client_timings' RLS turned on")
ok(re.findall(r"delete from ([\w.]+)", code) == ["public.client_timings"] and "where at < now() - interval '30 days'" in code, "the one delete: the sweep of rows over 30 days old")
ok(not re.search(r"supabase\.co|https?://|qbocskai|nrtczucr", text.lower()), "names no real database")

FA, FB, OWNER, STAFF, OTHER, ADMIN = ("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                                     "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "cccccccc-cccc-cccc-cccc-cccccccccccc", "dddddddd-dddd-dddd-dddd-dddddddddddd")
STAND = """
do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant select on members to authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table if not exists platform_admins (user_id uuid primary key, name text);
grant select on platform_admins to authenticated;
create or replace function is_superadmin() returns boolean language sql stable security definer as $$ select exists (select 1 from platform_admins where user_id = auth.uid()) $$;
-- Supabase's default privileges: new things in public are granted to every API role unless the file says otherwise
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
insert into firms values ('%s', 'A'), ('%s', 'B');
insert into members (user_id, firm_id, name, role) values ('%s', '%s', 'Owner A', 'owner'), ('%s', '%s', 'Staff A', 'staff'), ('%s', '%s', 'Owner B', 'owner');
insert into platform_admins values ('%s', 'Support');
""" % (FA, FB, OWNER, FA, STAFF, FA, OTHER, FB, ADMIN)
def S(k): return json.dumps({"v": 1, "span": 900, "k": k})
def as_(uid, sql): return "set role authenticated;\nset fincom.uid = '%s';\n%s\nreset role;" % (uid, sql)
def try_(sql):
    try: db.sql(sql); return "ok"
    except RuntimeError as e: return str(e).strip().splitlines()[-1][:200] if str(e).strip() else "error"
db = pg_stand.start(int(os.environ.get("PG108_PORT") or 31080))
try:
    db.sql(STAND)
    print("== 1. runs twice")
    shape = """select (select string_agg(column_name || ':' || data_type || ':' || coalesce(column_default, ''), ',' order by ordinal_position) from information_schema.columns where table_name = 'client_timings')
      || '|' || (select string_agg(policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by policyname) from pg_policies where tablename = 'client_timings')
      || '|' || (select string_agg(md5(pg_get_functiondef(p.oid)), ',' order by p.proname) from pg_proc p where p.proname like 'client_timings%')
      || '|' || md5(pg_get_viewdef('public.client_timings_summary'::regclass))"""
    shapes = []
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_108: not run)" % n); continue
        r = try_(text); ok(r == "ok", "run %d %s" % (n, "" if r == "ok" else r))
        try: shapes.append(db.one(shape))
        except RuntimeError as e: shapes.append(None)
    ok(len(shapes) == 2 and shapes[0] and shapes[0] == shapes[1], "the same table, policies, functions and view after each run")
    ok(db.one("select relrowsecurity::text from pg_class where oid = to_regclass('public.client_timings')") == "true", "row level security on")

    print("== 2. grants")
    def privs(role, obj, kind):
        if kind == "table": return [p for p in ("select", "insert", "update", "delete", "truncate", "references", "trigger") if db.one("select has_table_privilege('%s', '%s', '%s')" % (role, obj, p)) == "t"]
        if kind == "seq": return [p for p in ("usage", "select", "update") if db.one("select has_sequence_privilege('%s', '%s', '%s')" % (role, obj, p)) == "t"]
        return ["execute"] if db.one("select has_function_privilege('%s', '%s', 'execute')" % (role, obj)) == "t" else []
    try:
        T, Q, V, R, W = "public.client_timings", "public.client_timings_id_seq", "public.client_timings_summary", "public.client_timings_report(integer)", "public.client_timings_sweep()"
        for obj, kind in ((T, "table"), (Q, "seq"), (V, "table"), (R, "fn"), (W, "fn")):
            ok(privs("anon", obj, kind) == [], "anon: nothing on " + obj + " " + str(privs("anon", obj, kind)))
        ok(privs("authenticated", T, "table") == ["select", "insert"], "authenticated: select + insert on the table (under RLS) " + str(privs("authenticated", T, "table")))
        ok(privs("authenticated", V, "table") == ["select"] and privs("authenticated", R, "fn") == ["execute"], "authenticated: the view and the report")
        ok(privs("authenticated", W, "fn") == [] and privs("service_role", W, "fn") == ["execute"], "the sweep: service_role only")
        ok(len(privs("service_role", T, "table")) == 7 and privs("service_role", Q, "seq") == ["usage", "select", "update"] and privs("service_role", V, "table")[:1] == ["select"], "service_role: everything on the table and its sequence")
        ok(db.one("select has_function_privilege('public', '%s', 'execute')" % R) == "f", "the report not for PUBLIC")
    except RuntimeError as e: ok(False, "grants: " + str(e)[:300])

    print("== 3. RLS")
    k1 = {"rest/records read": {"n": 4, "p50": 180, "p95": 400, "max": 400, "avg": 230, "h": [0, 0, 0, 0, 0, 2, 1, 1]}}
    r = try_(as_(OWNER, "insert into client_timings (browser, net_type, net_rtt, summary) values ('Chrome 141 · Windows', '4g', 150, '%s');" % S(k1)))
    ok(r == "ok", "the owner inserts a row (firm and user from the defaults) " + r)
    r = try_(as_(STAFF, "insert into client_timings (browser, summary) values ('Edge 141 · Windows', '%s');" % S({"fn/tally-ingest": {"n": 2, "p50": 900, "p95": 3000, "max": 3000, "avg": 1950, "h": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1], "i": {"n": 1, "p50": 3000, "max": 3000}}})))
    ok(r == "ok", "a member who is not the owner inserts their own row " + r)
    r = try_(as_(OTHER, "insert into client_timings (summary) values ('%s');" % S(k1)))
    ok(r == "ok", "firm B's owner inserts a row of B's " + r)
    r = try_(as_(STAFF, "insert into client_timings (firm_id, summary) values ('%s', '%s');" % (FB, S(k1))))
    ok("row-level security" in r, "a row for another firm: refused (" + r[:80] + ")")
    r = try_(as_(STAFF, "insert into client_timings (user_id, summary) values ('%s', '%s');" % (OWNER, S(k1))))
    ok("row-level security" in r, "a row in another person's name: refused (" + r[:80] + ")")
    r = try_(as_(STAFF, "insert into client_timings (at, summary) values (now() - interval '2 days', '%s');" % S(k1)))
    ok("row-level security" in r, "a row dated in the past: refused (" + r[:80] + ")")
    r = try_("set role anon;\ninsert into client_timings (firm_id, user_id, summary) values ('%s', '%s', '%s');\nreset role;" % (FA, OWNER, S(k1)))
    ok("permission denied" in r, "anon: refused (" + r[:80] + ")")
    r = try_(as_(OWNER, "insert into client_timings (summary) values ('[1,2]');"))
    ok("check constraint" in r, "a summary that is not an object: refused")
    r = try_(as_(OWNER, "insert into client_timings (summary) values ('%s');" % S({"x%d" % i: {"n": 1, "p50": i, "p95": i, "max": i, "avg": i, "h": [os.urandom(8).hex() for _ in range(10)]} for i in range(400)})))
    ok("check constraint" in r, "a summary over 32 KB: refused")
    r = try_(as_(OWNER, "insert into client_timings (net_type, summary) values ('<script>', '%s');" % S(k1)))
    ok("check constraint" in r, "an odd network type: refused")
    cnt = lambda uid: db.one("set role authenticated;\nset fincom.uid = '%s';\nselect count(*) || '/' || count(distinct firm_id) from client_timings;" % uid)
    try:
        ok(cnt(STAFF) == "0/0", "a member who is not the owner reads nothing (%s)" % cnt(STAFF))
        ok(cnt(OWNER) == "2/1", "firm A's owner reads A's two rows only (%s)" % cnt(OWNER))
        ok(cnt(OTHER) == "1/1", "firm B's owner reads B's one row (%s)" % cnt(OTHER))
        ok(cnt(ADMIN) == "3/2", "a platform administrator reads every firm's (%s)" % cnt(ADMIN))
        ok(db.one("set role authenticated;\nset fincom.uid = '%s';\nselect count(*) from client_timings where user_id = '%s' and firm_id = '%s'" % (OWNER, OWNER, FA)) == "1", "the defaults filled the owner's firm and user")
    except RuntimeError as e: ok(False, "reading: " + str(e)[:300])

    print("== 4. the report, 24 h and 7 days, and the sweep")
    try:
        # 3 days ago (as the service would write it): 100 more records reads, all in (700, 1000]
        db.sql("insert into client_timings (firm_id, user_id, at, summary) values ('%s', '%s', now() - interval '3 days', '%s'), ('%s', '%s', now() - interval '40 days', '%s');"
               % (FA, OWNER, S({"rest/records read": {"n": 100, "p50": 800, "p95": 990, "max": 1000, "avg": 850, "h": [0] * 10 + [100]}}), FA, OWNER, S(k1)))
        rows = lambda uid, h: {r["kind"]: r for r in db.rows("set role authenticated;\nset fincom.uid = '%s';\nselect * from client_timings_report(%d)" % (uid, h))}
        d = rows(OWNER, 24)
        rr = d.get("rest/records read", {})
        # 4 samples: 2 in (150,200], 1 in (200,300], 1 in (300,400]. p50: 2nd of 4 -> bucket (150,200] fully = 200; p95: 3.8 -> (300,400] at 0.8 -> 380
        ok(rr.get("n") == "4" and rr.get("p50_ms") == "200" and rr.get("p95_ms") == "380" and rr.get("max_ms") == "400" and rr.get("avg_ms") == "230", "24 h, records read: n 4, p50 200, p95 380, max 400, avg 230 " + json.dumps({k: rr.get(k) for k in ("n", "p50_ms", "p95_ms", "max_ms", "avg_ms")}))
        fi = d.get("fn/tally-ingest", {})
        ok(fi.get("idle_n") == "1" and fi.get("idle_max_ms") == "3000" and fi.get("users") == "1", "24 h, tally-ingest: one call after idle, 3 s (a cold start)")
        ok(set(d) == {"rest/records read", "fn/tally-ingest"}, "the owner's report: firm A's kinds only " + str(sorted(d)))
        w = rows(OWNER, 168).get("rest/records read", {})
        # 104: 4 as above + 100 in (700,1000]; p50 = 52nd -> (700,1000] at (52-4)/100 = 0.48 -> 844; p95 = 98.8 -> 0.948 -> 984
        ok(w.get("n") == "104" and w.get("p50_ms") == "844" and w.get("p95_ms") == "984" and w.get("rows") == "2", "7 days, records read: n 104, p50 844, p95 984 over 2 rows " + json.dumps({k: w.get(k) for k in ("n", "p50_ms", "p95_ms", "rows")}))
        v = db.rows("set role authenticated;\nset fincom.uid = '%s';\nselect span, kind, n, p50_ms, p95_ms from client_timings_summary order by span, kind" % OWNER)
        ok([(x["span"], x["kind"], x["n"]) for x in v] == [("24 h", "fn/tally-ingest", "2"), ("24 h", "rest/records read", "4"), ("7 days", "fn/tally-ingest", "2"), ("7 days", "rest/records read", "104")], "the view: 24 h and 7 days per kind " + str([(x["span"], x["kind"], x["n"]) for x in v]))
        ok(db.rows("set role authenticated;\nset fincom.uid = '%s';\nselect * from client_timings_summary" % STAFF) == [], "the view for a member who is not the owner: nothing")
        ok(len(db.rows("select * from client_timings_report(24)")) == 2 and db.one("select count(*) from client_timings_report(24) where kind = 'rest/records read' and n = 8") == "1", "in the SQL editor (postgres): every firm's (A's 4 + B's 4 records reads)")
        r = try_(as_(OWNER, "select client_timings_sweep();"))
        ok("permission denied" in r, "a member cannot run the sweep")
        ok(db.one("set role service_role;\nselect client_timings_sweep();") == "1" and db.one("select count(*) from client_timings") == "4", "the sweep (service_role) removes the 40-day-old row only")
    except RuntimeError as e: ok(False, "report: " + str(e)[:400])
finally:
    db.stop()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
raise SystemExit(1 if fails else 0)
