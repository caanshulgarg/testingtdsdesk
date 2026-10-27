"""python3 run_migration70.py - migration-70-alert-dismissals-tighten (08-Oct-2026, the review of next-alerts-clear,
M2 and L(a)). Migration 68 is already run on staging and is never edited; 70 tightens it, add-only. On throwaway
PostgreSQL (pg_stand, port 30700; never a real database), with Supabase's default grants: 68, rows written, then 70 three
times. Checks:
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from', no drop, no
     truncate, no real database named; runs three times; nothing removed (the rows kept).
  1. M2: authenticated may no longer INSERT into app_alert_dismissals directly (select kept; the read-own policy kept);
     alert_dismiss (security definer) still adds; a row the RPC writes still lists.
  2. M2: CHECK constraints on the lengths (alert_key and fingerprint <= 2000, words <= 500), validated; a longer row
     written by anyone (even the service role) is refused; the RPC still cuts long text and succeeds.
  3. L(a): alert_dismissals_list lists up to 20000 rows (was 5000), own and not undone, newest first.
RED: before the file exists it stops at the first check."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M68 = os.path.join(SQLDIR, "migration-68-alert-dismissals.sql")
M70 = os.environ.get("M70_FILE") or os.path.join(SQLDIR, "migration-70-alert-dismissals-tighten.sql")
PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, OTHER, NOBODY = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777"


text = open(M70).read() if os.path.exists(M70) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M70))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low), "0. add-only (no drop, no truncate)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref", low), "0. names no real database")
db = pg_stand.start(30700)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=sql, capture_output=True, text=True)
def privs(role, t): return [p for p in PRIVS if db.one("select has_table_privilege(%s, %s, %s)::text" % (q(role), q("public." + t), q(p))) == "true"]
def as_user(uid, sql):
    """sql run as authenticated with auth.uid() = uid; (ok, output or error)"""
    r = psql_text("set fincom.uid = '%s'; set role authenticated;\n%s" % (uid, sql))
    return r.returncode == 0, (r.stdout if r.returncode == 0 else r.stderr)
def call(uid, sql):
    r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
                       input="set fincom.uid = '%s'; set role authenticated;\n%s" % (uid, sql), capture_output=True, text=True)
    if r.returncode: return {"error": r.stderr.strip()}
    out = r.stdout.strip().splitlines()
    return json.loads(out[-1]) if out else None
try:
    db.sql("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;")
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Anshul', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      grant usage on schema public, auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated;
      grant select on members, firms to authenticated;   -- as on Supabase: my_firm() reads the member's own row""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "X": q(OTHER)})
    db.sql("alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on sequences to anon, authenticated; alter default privileges in schema public grant all on functions to anon, authenticated;")
    r = psql_text(open(M68).read()); ok(r.returncode == 0, "68 runs first (as on staging) %s" % r.stderr[-300:])
    j = call(OWNER, "select alert_dismiss(%s::jsonb)::text;" % q(json.dumps([{"key": "alert:1", "fp": "alert:1", "words": "kept"}])))
    good, out = as_user(STAFF, "insert into app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, batch) values (%s, %s, 'book:x', 'gap:x', gen_random_uuid());" % (q(F), q(STAFF)))
    ok(good, "before 70: a direct insert is possible (the review's M2) %s" % out[-120:])
    n0 = db.one("select count(*) from app_alert_dismissals")
    for rnd in (1, 2, 3):
        r = psql_text(text)
        ok(r.returncode == 0, "0. pass %d: migration 70 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    ok(db.one("select count(*) from app_alert_dismissals") == n0 == "2", "0. nothing removed (%s rows)" % n0)
    ok(privs("authenticated", "app_alert_dismissals") == ["SELECT"] and privs("anon", "app_alert_dismissals") == [], "1. authenticated: select only now (%s)" % privs("authenticated", "app_alert_dismissals"))
    good, out = as_user(STAFF, "insert into app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, batch) values (%s, %s, 'book:y', 'gap:y', gen_random_uuid());" % (q(F), q(STAFF)))
    ok(not good and "permission denied" in out, "1. a direct insert is refused (%s)" % out.strip()[-100:])
    ok(db.one("select count(*) from pg_policies where tablename = 'app_alert_dismissals' and policyname = 'app_alert_dismissals_read_own'") == "1", "1. the read-own policy kept")
    j = call(STAFF, "select alert_dismiss(%s::jsonb)::text;" % q(json.dumps([{"key": "book:z", "fp": "gap:z", "words": "w"}])))
    ok(j.get("ok") and j.get("n") == 1 and "book:z" in [x["key"] for x in call(STAFF, "select alert_dismissals_list()::text;")], "1. alert_dismiss still adds, and it lists (%s)" % j)
    cons = {r["n"]: r["v"] for r in db.rows("select conname as n, convalidated::text as v from pg_constraint where conrelid = 'public.app_alert_dismissals'::regclass and contype = 'c'")}
    ok(len(cons) >= 3 and all(v == "true" for v in cons.values()), "2. the length checks, validated (%s)" % cons)
    for col, n in (("alert_key", 2001), ("fingerprint", 2001), ("words", 501)):
        vals = {"alert_key": "'k'", "fingerprint": "'f'", "words": "''"}; vals[col] = "repeat('x', %d)" % n
        r = psql_text("insert into app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, words, batch) values (%s, %s, %s, %s, %s, gen_random_uuid());" % (q(F), q(OWNER), vals["alert_key"], vals["fingerprint"], vals["words"]))
        ok(r.returncode != 0 and "check constraint" in r.stderr, "2. %s longer than %d refused even for the database's owner (%s)" % (col, n - 1, r.stderr.strip()[-90:]))
    j = call(OWNER, "select alert_dismiss(%s::jsonb)::text;" % q(json.dumps([{"key": "k" * 3000, "fp": "f" * 3000, "words": "w" * 900}])))
    ok(j.get("ok") and j.get("n") == 1, "2. the RPC cuts long text to the limits and succeeds (%s)" % str(j)[:120])
    fn = db.one("select pg_get_functiondef('public.alert_dismissals_list()'::regprocedure)")
    ok("limit 20000" in fn and "undone_at is null" in fn and "auth.uid()" in fn, "3. the list: up to 20000 rows, own, not undone")
    row = db.rows("select prosecdef::text as d, coalesce(array_to_string(proconfig, ','), '') as c from pg_proc where proname = 'alert_dismissals_list'")
    ok(row[0]["d"] == "true" and row[0]["c"].replace(" ", "") == "search_path=public,pg_temp" and db.one("select has_function_privilege('anon', 'public.alert_dismissals_list()', 'execute')::text") == "false",
       "3. still security definer, search_path = public, pg_temp, not for anon")
    db.sql("insert into app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, batch) select %s, %s, 'k' || g, 'f' || g, gen_random_uuid() from generate_series(1, 6000) g" % (q(F), q(OWNER)))
    ok(len(call(OWNER, "select alert_dismissals_list()::text;")) == 6002, "3. 6002 rows of one person all listed (more than 68's 5000)")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
