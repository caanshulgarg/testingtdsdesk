"""python3 run_migration80.py - migration-80-challan-register (14-Oct-2026, branch tds-layout: one challan register per client
TAN, its audit trail). On throwaway PostgreSQL (pg_stand, port 30800; never a real database), with Supabase's default grants,
then 80 twice (and a third time). Checks:
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), no 'delete from', add-only (no drop, no
     truncate, no alter of another table), no real database named; it runs twice and a third time; nothing removed.
  1. tds_challan_allocations: its columns, row security on, a read and an add policy and nothing else; authenticated may
     read and add only (no update, no delete), anon nothing.
  2. a firm's members read their firm's rows only; the owner and staff add rows for their own firm as themselves; a
     viewer (not can_write) cannot add; a row for another firm or as another person is refused; no update, no delete.
  3. the checks: form, year, quarter, action, amounts not below nil; a line sent twice (same client_ref) is kept once.
Prints the file's md5 (docs/MIGRATION-ORDER.md records it as run on staging)."""
import os, re, sys, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M80 = os.environ.get("M80_FILE") or os.path.join(HERE, "..", "server", "tally-cloud", "migration-80-challan-register.sql")
PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, VIEW, OTHER = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333", "66666666-6666-6666-6666-666666666666"

text = open(M80).read() if os.path.exists(M80) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M80))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
print("  md5 %s  %s" % (hashlib.md5(text.encode()).hexdigest(), os.path.basename(M80)))
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file")
ok(not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low), "0. add-only (no drop, no truncate)")
ok(not re.findall(r"alter table (?!public\.tds_challan_allocations)", low), "0. no other table altered")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref", low), "0. names no real database")

db = pg_stand.start(30800)
def as_user(uid, sql):
    r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"],
                       input="set fincom.uid = '%s'; set role authenticated;\n%s" % (uid, sql), capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip() if r.returncode == 0 else r.stderr.strip())
def privs(role, t): return [p for p in PRIVS if db.one("select has_table_privilege(%s, %s, %s)::text" % (q(role), q("public." + t), q(p))) == "true"]
def run_file():
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=text, capture_output=True, text=True)
INS = "insert into tds_challan_allocations (client_id, tan, challan_id, challan_key, form, fy, quarter, deduction_id, action, tax, note, client_ref%s) values ('c1', 'DELZ12345A', 'ch1', '0240020|20260707|00979', %s, %s, %s, 'r1', %s, %s, 'n', %s%s)"
def ins(ref, form="'26Q'", fy="'2026-27'", qq="'Q1'", act="'tag'", tax="100", extra_cols="", extra_vals=""):
    return INS % (extra_cols, form, fy, qq, act, tax, q(ref), extra_vals)
try:
    db.sql("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;")
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Anshul', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      grant usage on schema public, auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated;
      grant select on members, firms to authenticated;""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "V": q(VIEW), "X": q(OTHER)})
    db.sql("alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on sequences to anon, authenticated; alter default privileges in schema public grant all on functions to anon, authenticated;")
    for rnd in (1, 2, 3):
        r = run_file()
        ok(r.returncode == 0, "0. pass %d: migration 80 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
        if rnd == 1:
            db.sql(ins("seed", extra_cols=", firm_id, created_by", extra_vals=", %s, %s" % (q(F), q(OWNER))))
    ok(db.one("select count(*) from tds_challan_allocations") == "1", "0. nothing removed by the second and third runs (the row kept)")
    cols = [r["c"] for r in db.rows("select column_name as c from information_schema.columns where table_name = 'tds_challan_allocations' order by ordinal_position")]
    ok(cols == ["id", "firm_id", "client_id", "tan", "challan_id", "challan_key", "form", "fy", "quarter", "deduction_id", "action", "tax", "interest", "fee", "locked", "note", "client_ref", "created_by", "created_at"], "1. the columns (%s)" % cols)
    ok(db.one("select relrowsecurity::text from pg_class where oid = 'public.tds_challan_allocations'::regclass") == "true", "1. row security on")
    pols = {r["p"]: r["c"] for r in db.rows("select policyname as p, cmd as c from pg_policies where tablename = 'tds_challan_allocations'")}
    ok(pols == {"tds_challan_allocations_read": "SELECT", "tds_challan_allocations_add": "INSERT"}, "1. a read and an add policy, nothing else (%s)" % pols)
    ok(privs("authenticated", "tds_challan_allocations") == ["SELECT", "INSERT"] and privs("anon", "tds_challan_allocations") == [],
       "1. authenticated may read and add only; anon nothing (%s; %s)" % (privs("authenticated", "tds_challan_allocations"), privs("anon", "tds_challan_allocations")))
    # 2. per firm
    good, out = as_user(OWNER, ins("o1") + "; select count(*) from tds_challan_allocations;")
    ok(good and out.splitlines()[-1] == "2", "2. the owner adds a row for the firm (firm and person set by the database) and reads the firm's rows (%s)" % out[-200:])
    ok(db.one("select (firm_id = %s and created_by = %s)::text from tds_challan_allocations where client_ref = 'o1'" % (q(F), q(OWNER))) == "true", "2. firm_id and created_by filled in by the database")
    good, out = as_user(STAFF, ins("s1") + "; select count(*) from tds_challan_allocations;")
    ok(good and out.splitlines()[-1] == "3", "2. staff add too, and read every row of the firm (%s)" % out[-200:])
    good, out = as_user(VIEW, ins("v1"))
    ok(not good, "2. a viewer (not owner or staff) cannot add (%s)" % out[-120:])
    good, out = as_user(VIEW, "select count(*) from tds_challan_allocations;")
    ok(good and out == "3", "2. a viewer reads the firm's rows (%s)" % out)
    good, out = as_user(OTHER, "select count(*) from tds_challan_allocations;")
    ok(good and out == "0", "2. another firm's member sees none (%s)" % out)
    good, out = as_user(OTHER, ins("x1", extra_cols=", firm_id", extra_vals=", %s" % q(F)))
    ok(not good, "2. a row for another firm is refused")
    good, out = as_user(STAFF, ins("x2", extra_cols=", created_by", extra_vals=", %s" % q(OWNER)))
    ok(not good, "2. a row as another person is refused")
    good, out = as_user(OWNER, "update tds_challan_allocations set tax = 1 where client_ref = 'o1';")
    ok(not good, "2. no update")
    good, out = as_user(OWNER, "delete from tds_challan_allocations where client_ref = 'o1';")
    ok(not good, "2. no delete")
    # 3. the checks
    for what, sql in (("form", ins("k1", form="'25Q'")), ("year", ins("k2", fy="'2026'")), ("quarter", ins("k3", qq="'Q5'")), ("action", ins("k4", act="'move'")), ("amounts", ins("k5", tax="-1"))):
        good, out = as_user(OWNER, sql)
        ok(not good, "3. a wrong %s is refused" % what)
    good, out = as_user(OWNER, ins("c1", form="''", fy="''", qq="''", act="'challan-add'") + ";")
    ok(good, "3. a line about the challan itself (no return) is kept (%s)" % out[-200:])
    good, out = as_user(OWNER, ins("o1") + " on conflict (firm_id, client_ref) do nothing; select count(*) from tds_challan_allocations where client_ref = 'o1';")
    ok(good and out.splitlines()[-1] == "1", "3. a line sent twice is kept once (%s)" % out[-200:])
finally:
    db.stop()
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
