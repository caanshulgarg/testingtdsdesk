"""python3 run_migration68.py - migration-68-alert-dismissals (08-Oct-2026, "clear notifications": the owner's "if one time
any notification is cleared then that notification should not appear"). On throwaway PostgreSQL (pg_stand, port 30680;
never a real database), with Supabase's default grants, then 68 three times. Checks:
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from', add-only (no drop,
     no truncate), no real database named; it runs twice and a third time; nothing removed (rows kept).
  1. app_alert_dismissals: its columns, row security on, the read-own and add-own policies; the three functions security
     definer with search_path = public, pg_temp; revoked from anon, granted to authenticated.
  2. a person reads and adds only their OWN rows in their OWN firm: the owner does not see the staff's rows, the other
     firm's member sees none; an insert for another user or another firm is refused; no update, no delete for authenticated.
  3. alert_dismiss: one batch for one call, the same (key, fingerprint) not added twice, a non-member refused, empty
     key / fingerprint skipped, more than 500 refused; alert_dismissals_list: own rows, not undone, newest first.
  4. alert_dismiss_undo: stamps undone_at on that batch's own rows (kept, never removed); another person's batch untouched;
     the notification listed no more; cleared again afterwards it is listed again (a new row).
RED: before the file exists it stops at the first check."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M68 = os.environ.get("M68_FILE") or os.path.join(SQLDIR, "migration-68-alert-dismissals.sql")
PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, OTHER, NOBODY = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777"

text = open(M68).read() if os.path.exists(M68) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M68))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low), "0. add-only (no drop, no truncate)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref", low), "0. names no real database")

db = pg_stand.start(30680)
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
    for rnd in (1, 2, 3):
        r = psql_text(text)
        ok(r.returncode == 0, "0. pass %d: migration 68 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
        if rnd == 1:
            db.sql("insert into app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, words, batch) values (%s, %s, 'alert:1', 'alert:1', 'kept', gen_random_uuid())" % (q(F), q(OWNER)))
    ok(db.one("select count(*) from app_alert_dismissals") == "1", "0. nothing removed by the second and third runs (the row kept)")
    cols = [r["c"] for r in db.rows("select column_name as c from information_schema.columns where table_name = 'app_alert_dismissals' order by ordinal_position")]
    ok(cols == ["id", "firm_id", "user_id", "alert_key", "fingerprint", "words", "batch", "cleared_at", "undone_at"], "1. the columns (%s)" % cols)
    ok(db.one("select relrowsecurity::text from pg_class where oid = 'public.app_alert_dismissals'::regclass") == "true", "1. row security on")
    pols = {r["p"]: r["c"] for r in db.rows("select policyname as p, cmd as c from pg_policies where tablename = 'app_alert_dismissals'")}
    ok(pols == {"app_alert_dismissals_read_own": "SELECT", "app_alert_dismissals_add_own": "INSERT"}, "1. the read-own and add-own policies, nothing else (%s)" % pols)
    for fn, args in (("alert_dismiss", "jsonb"), ("alert_dismiss_undo", "uuid"), ("alert_dismissals_list", "")):
        row = db.rows("select prosecdef::text as d, coalesce(array_to_string(proconfig, ','), '') as c from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn))
        ok(len(row) == 1 and row[0]["d"] == "true" and row[0]["c"].replace(" ", "") == "search_path=public,pg_temp", "1. %s: security definer, search_path = public, pg_temp (%s)" % (fn, row))
        sig = "public.%s(%s)" % (fn, args)
        ok(db.one("select has_function_privilege('anon', %s, 'execute')::text" % q(sig)) == "false" and db.one("select has_function_privilege('authenticated', %s, 'execute')::text" % q(sig)) == "true",
           "1. %s: not for anon, for authenticated" % fn)
    ok(privs("authenticated", "app_alert_dismissals") == ["SELECT", "INSERT"] and privs("anon", "app_alert_dismissals") == [],
       "2. authenticated may read and add only (no update, no delete); anon nothing (%s; %s)" % (privs("authenticated", "app_alert_dismissals"), privs("anon", "app_alert_dismissals")))
    # 2. own rows only
    good, out = as_user(STAFF, "insert into app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, batch) values (%s, %s, 'book:x', 'gap:x', gen_random_uuid());" % (q(F), q(STAFF)))
    ok(good, "2. the staff adds a row of their own (%s)" % out.strip()[-200:])
    good, out = as_user(STAFF, "insert into app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, batch) values (%s, %s, 'book:x', 'gap:x', gen_random_uuid());" % (q(F), q(OWNER)))
    ok(not good and "row-level security" in out, "2. a row for another person is refused (%s)" % out.strip()[-120:])
    good, out = as_user(STAFF, "insert into app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, batch) values (%s, %s, 'book:x', 'gap:x', gen_random_uuid());" % (q(F2), q(STAFF)))
    ok(not good and "row-level security" in out, "2. a row in another firm is refused (%s)" % out.strip()[-120:])
    good, out = as_user(STAFF, "update app_alert_dismissals set undone_at = now();")
    ok(not good and "permission denied" in out, "2. no update from the browser (%s)" % out.strip()[-80:])
    good, out = as_user(STAFF, "delete from app_alert_dismissals;")
    ok(not good and "permission denied" in out, "2. no delete from the browser (%s)" % out.strip()[-80:])
    def mine(uid):
        good, out = as_user(uid, "copy (select coalesce(string_agg(alert_key || '=' || fingerprint, ',' order by id), '') from app_alert_dismissals) to stdout;")
        return out.strip() if good else "ERR " + out
    ok(mine(OWNER) == "alert:1=alert:1" and mine(STAFF) == "book:x=gap:x" and mine(OTHER) == "", "2. each reads only their own rows (owner %r, staff %r, other firm %r)" % (mine(OWNER), mine(STAFF), mine(OTHER)))
    # 3. alert_dismiss / list
    items = [{"key": "book:c1|b1", "fp": "gap:c1|b1:2026-10-07\nline:5:need", "words": "GARG: 1 entry..."}, {"key": "alert:9", "fp": "alert:9", "words": "Today: ..."}, {"key": "", "fp": "x"}, {"key": "y", "fp": ""}]
    j = call(OWNER, "select alert_dismiss(%s::jsonb)::text;" % q(json.dumps(items)))
    ok(isinstance(j, dict) and j.get("ok") and j.get("n") == 2 and re.match(r"^[0-9a-f-]{36}$", str(j.get("batch", ""))), "3. alert_dismiss: two added under one batch, the empty key and fingerprint skipped (%s)" % j)
    b1 = (j or {}).get("batch")
    ok(db.one("select count(distinct batch) from app_alert_dismissals where batch = %s" % q(b1)) == "1" and db.one("select count(*) from app_alert_dismissals where batch = %s" % q(b1)) == "2", "3. one batch, two rows")
    j2 = call(OWNER, "select alert_dismiss(%s::jsonb)::text;" % q(json.dumps(items[:1])))
    ok(j2.get("n") == 0, "3. the same notification is not added twice (%s)" % j2)
    j3 = call(NOBODY, "select alert_dismiss(%s::jsonb)::text;" % q(json.dumps(items[:1])))
    ok("error" in j3 and "not a member" in j3["error"], "3. someone not a member of a firm is refused (%s)" % str(j3)[:120])
    j4 = call(OWNER, "select alert_dismiss(%s::jsonb)::text;" % q(json.dumps([{"key": "k%d" % i, "fp": "f"} for i in range(501)])))
    ok("error" in j4 and "500" in j4["error"], "3. more than 500 at once refused (%s)" % str(j4)[:120])
    lst = call(OWNER, "select alert_dismissals_list()::text;")
    ok([x["key"] for x in lst] == ["alert:9", "book:c1|b1", "alert:1"] or sorted(x["key"] for x in lst) == ["alert:1", "alert:9", "book:c1|b1"], "3. the list: the owner's own three (%s)" % [x["key"] for x in lst])
    ok(all(set(x) == {"key", "fp", "batch", "clearedAt"} for x in lst), "3. each with key, fp, batch, clearedAt")
    ok([x["key"] for x in call(STAFF, "select alert_dismissals_list()::text;")] == ["book:x"] and call(OTHER, "select alert_dismissals_list()::text;") == [], "3. the staff's list is the staff's own; the other firm's is empty")
    # 4. undo
    n0 = db.one("select count(*) from app_alert_dismissals")
    u = call(STAFF, "select alert_dismiss_undo(%s::uuid)::text;" % q(b1))
    ok(u.get("n") == 0 and db.one("select count(*) from app_alert_dismissals where undone_at is not null") == "0", "4. another person's batch is untouched by the staff's Undo (%s)" % u)
    u = call(OWNER, "select alert_dismiss_undo(%s::uuid)::text;" % q(b1))
    ok(u.get("n") == 2, "4. the owner's Undo stamps the two rows of that Clear (%s)" % u)
    ok(db.one("select count(*) from app_alert_dismissals") == n0 and db.one("select count(*) from app_alert_dismissals where batch = %s and undone_at is not null" % q(b1)) == "2", "4. the rows are kept, stamped undone_at (none removed)")
    ok(sorted(x["key"] for x in call(OWNER, "select alert_dismissals_list()::text;")) == ["alert:1"], "4. undone: not listed any more")
    j5 = call(OWNER, "select alert_dismiss(%s::jsonb)::text;" % q(json.dumps(items[:1])))
    ok(j5.get("n") == 1 and sorted(x["key"] for x in call(OWNER, "select alert_dismissals_list()::text;")) == ["alert:1", "book:c1|b1"], "4. cleared again after the Undo: a new row, listed again (%s)" % j5)
    ok(call(OWNER, "select alert_dismiss_undo(%s::uuid)::text;" % q(b1)).get("n") == 0, "4. an Undo twice changes nothing")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
