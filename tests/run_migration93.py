"""python3 run_migration93.py - migration-93-gst-portal-login (17-Oct-2026, branch next-gst-browser: the GST browser helper's
portal login in Vault and its logs). On throwaway PostgreSQL (pg_stand, port 30930; never a real database), with Supabase's
default grants and Vault stood in as Supabase has it (vault.secrets, vault.decrypted_secrets, create_secret, update_secret;
nothing of it granted to signed-in users), then 93 twice. Checks:
  0. the file: one transaction, lock_timeout 10 s, add-only (no drop, no truncate, no other table altered), the ONE 'delete
     from' is the deleted login's Vault secret, no real database named; it runs twice; nothing removed by the second run.
  1. the tables: row security on, read policies only; signed-in users read the logins without secret_id (refused), may not
     write any of the three tables directly; anon nothing; no function executable by anon.
  2. saving: the owner only; the answer, the table and the log never hold the password; the password is in Vault.
  3. reading the password: the owner, and a staff member the owner allowed; another staff member, a viewer and another
     firm are refused; every read and every refusal logged (who, when, GSTIN), never the password.
  4. changing keeps the same secret; a blank password keeps the saved one; deleting (owner only) removes the Vault secret,
     marks the row deleted; nothing more can be read.
  5. a helper run is logged by the owner or staff for their firm, as themselves; a viewer cannot; another firm sees none.
Prints the file's md5."""
import os, re, sys, json, hashlib, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
M93 = os.environ.get("M93_FILE") or os.path.join(HERE, "..", "server", "gst-browser", "migration-93-gst-portal-login.sql")
PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, STAFF2, VIEW, OTHER = ("55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "47474747-4747-4747-4747-474747474747",
                                     "33333333-3333-3333-3333-333333333333", "66666666-6666-6666-6666-666666666666")
G = "07AABCF1234K1Z5"
PW, PW2 = "Fx#S3cret-pass-0101", "N3w-Pass!word-2026"
from gst_helper_stand import VAULT   # Vault as Supabase has it, stood in

text = open(M93).read() if os.path.exists(M93) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M93))
if not text:
    print("\n1 FAILED"); raise SystemExit(1)
print("  md5 %s  %s" % (hashlib.md5(text.encode()).hexdigest(), os.path.basename(M93)))
code = "\n".join(l.split("--")[0] for l in text.splitlines()).lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
dels = re.findall(r"delete from [^;]*;", code)
ok(len(dels) == 1 and dels[0].startswith("delete from vault.secrets s where s.id = r.secret_id"), "0. the one 'delete from' removes the deleted login's Vault secret by its id (%s)" % dels)
ok(not re.search(r"\bdrop\b", code) and not re.search(r"\btruncate\b", code), "0. add-only (no drop, no truncate)")
ok(not re.findall(r"alter table (?!public\.gst_(portal_logins|portal_login_events|helper_runs) )", code), "0. no other table altered")
ok(not re.search(r"supabase\.co|project[_ ]ref", code), "0. names no real database")

db = pg_stand.start(30930)
def psql(sql, uid=None, role=None):
    pre = ("set fincom.uid = '%s';\n" % uid if uid else "") + ("set role %s;\n" % role if role else "")
    r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
                       input=pre + sql, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip() if r.returncode == 0 else r.stderr.strip())
def call(uid, fn, *args):
    good, out = psql("select public.%s(%s)::text;" % (fn, ", ".join(args)), uid, "authenticated")
    return json.loads(out.splitlines()[-1]) if good else {"sqlerror": out}
def run_file():
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=text, capture_output=True, text=True)
def privs(role, t): return [p for p in PRIVS if db.one("select has_table_privilege(%s, %s, %s)::text" % (q(role), q("public." + t), q(p))) == "true"]
def everything():   # every row of the three tables and the answers, as text: the password must not be in it
    return db.one("select concat_ws('|', (select string_agg(t::text, ';') from gst_portal_logins t), (select string_agg(t::text, ';') from gst_portal_login_events t), (select string_agg(t::text, ';') from gst_helper_runs t))") or ""
try:
    db.sql("do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;")
    db.sql(VAULT)
    # my_firm() as staging has it (security migration-2: security definer, search_path public), so a function with an empty
    # search_path can call it
    db.sql("create or replace function public.my_firm() returns uuid language sql stable security definer set search_path to 'public' as $$ select firm_id from public.members where user_id = auth.uid() and active $$;")
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Anshul', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(S2)s, %(F)s, 'Staff two', 'staff', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      grant usage on schema public, auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated;
      grant select on members, firms to authenticated;""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "S2": q(STAFF2), "V": q(VIEW), "X": q(OTHER)})
    db.sql("alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on sequences to anon, authenticated; alter default privileges in schema public grant all on functions to anon, authenticated;")
    for rnd in (1, 2):
        r = run_file()
        ok(r.returncode == 0, "0. pass %d: migration 93 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
        if rnd == 1:
            s0 = call(OWNER, "gst_portal_login_save", q("c-seed"), q(G), q("seeduser"), q("seed-pass"), "null")
    ok(db.one("select count(*) from gst_portal_logins") == "1" and db.one("select count(*) from vault.secrets") == "1", "0. the second run removes nothing (the login and its secret kept)")
    # 1. tables and grants
    ok(all(db.one("select relrowsecurity::text from pg_class where oid = 'public.%s'::regclass" % t) == "true" for t in ["gst_portal_logins", "gst_portal_login_events", "gst_helper_runs"]), "1. row security on all three tables")
    pols = sorted((r["t"], r["c"]) for r in db.rows("select tablename as t, cmd as c from pg_policies where tablename like 'gst_%'"))
    ok(pols == [("gst_helper_runs", "SELECT"), ("gst_portal_login_events", "SELECT"), ("gst_portal_logins", "SELECT")], "1. read policies only (%s)" % pols)
    ok(all(privs("authenticated", t) == (["SELECT"] if t != "gst_portal_logins" else []) and privs("anon", t) == [] for t in ["gst_portal_logins", "gst_portal_login_events", "gst_helper_runs"]),
       "1. signed-in users cannot insert, update or delete any of them (only through the functions); anon nothing")
    good, out = psql("select secret_id from gst_portal_logins;", OWNER, "authenticated")
    ok(not good and "permission denied" in out, "1. a signed-in user cannot read secret_id (%s)" % out[-80:])
    good, out = psql("select username, gstin from gst_portal_logins;", OWNER, "authenticated")
    ok(good and out == "seeduser|" + G, "1. ... but reads the user id and GSTIN (%s)" % out)
    good, out = psql("select count(*) from vault.decrypted_secrets;", OWNER, "authenticated")
    ok(not good, "1. Vault is not readable by signed-in users")
    anon_fns = db.one("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'gst_portal%' or p.proname = 'gst_helper_run_add') and has_function_privilege('anon', p.oid, 'execute')")
    ok(anon_fns == "0", "1. no function executable by anon")
    # 2. saving
    s = call(OWNER, "gst_portal_login_save", q("c1"), q(G), q("fx_user"), q(PW), "null")
    ok(s.get("ok") and s.get("has_password") is True and PW not in json.dumps(s), "2. the owner saves the login; the answer says only that a password is saved (%s)" % s)
    ok(db.one("select count(*) from vault.secrets where secret = %s" % q(PW)) == "1", "2. the password is in Vault")
    ok(PW not in everything(), "2. the password is in no table row and no log line")
    s = call(STAFF, "gst_portal_login_save", q("c1"), q(G), q("x"), q("y"), "null")
    ok(s.get("ok") is False and "owner" in s["error"], "2. staff cannot save or change a login (%s)" % s.get("error"))
    lst = call(STAFF, "gst_portal_login_list", q("c1"))
    ok(lst == [dict(lst[0], gstin=G, username="fx_user", has_password=True, can_use=False)] and PW not in json.dumps(lst), "2. the list shows the user id, 'saved', and that this staff member may not use it")
    # 3. reading
    r = call(OWNER, "gst_portal_login_read", q("c1"), q(G))
    ok(r.get("ok") and r["password"] == PW and r["username"] == "fx_user", "3. the owner gets the password (for the one fill)")
    r = call(STAFF, "gst_portal_login_read", q("c1"), q(G))
    ok(r.get("ok") is False and "not allowed" in r["error"] and "password" not in r, "3. a staff member not allowed is refused (%s)" % r.get("error"))
    s = call(OWNER, "gst_portal_login_save", q("c1"), q(G), q("fx_user"), q(""), "array[%s, %s]::uuid[]" % (q(STAFF), q(OTHER)))
    ok(s.get("ok") and db.one("select staff_allowed::text from gst_portal_logins where client_id = 'c1' and not deleted") == "{%s}" % STAFF, "3. the owner allows one staff member (another firm's person in the list is dropped)")
    ok(db.one("select count(*) from vault.secrets where secret = %s" % q(PW)) == "1", "3. a blank password keeps the saved one")
    r = call(STAFF, "gst_portal_login_read", q("c1"), q(G))
    ok(r.get("ok") and r["password"] == PW, "3. the allowed staff member gets it")
    r2 = call(STAFF2, "gst_portal_login_read", q("c1"), q(G)); r3 = call(VIEW, "gst_portal_login_read", q("c1"), q(G)); r4 = call(OTHER, "gst_portal_login_read", q("c1"), q(G))
    ok(r2.get("ok") is False and r3.get("ok") is False and r4.get("ok") is False and "No GST portal login" in r4["error"], "3. another staff member, a viewer and another firm's owner get nothing")
    ev = db.rows("select user_id::text as u, action as a, gstin as g from gst_portal_login_events where client_id = 'c1' order by id")
    want = [(OWNER, "saved"), (STAFF, "refused"), (OWNER, "read"), (STAFF, "refused"), (OWNER, "changed"), (STAFF, "read"), (STAFF2, "refused"), (VIEW, "refused")]
    ok([(e["u"], e["a"]) for e in ev] == want and all(e["g"] == G for e in ev), "3. every save, read and refusal logged: who, which GSTIN, what (%s)" % [(e["u"][:4], e["a"]) for e in ev])
    ok(PW not in everything(), "3. still no password in any table or log")
    good, out = psql("select count(*) from gst_portal_login_events;", OTHER, "authenticated")
    ok(good and out == "0", "3. another firm reads none of the log")
    # 4. change and delete
    sid = db.one("select secret_id::text from gst_portal_logins where client_id = 'c1' and not deleted")
    s = call(OWNER, "gst_portal_login_save", q("c1"), q(G), q("fx_user2"), q(PW2), "null")
    ok(s.get("ok") and db.one("select secret_id::text from gst_portal_logins where client_id = 'c1' and not deleted") == sid and db.one("select secret from vault.secrets where id = %s" % q(sid)) == PW2,
       "4. changing the password updates the same Vault secret")
    d = call(STAFF, "gst_portal_login_delete", q("c1"), q(G))
    ok(d.get("ok") is False and db.one("select count(*) from vault.secrets where id = %s" % q(sid)) == "1", "4. staff cannot delete")
    d = call(OWNER, "gst_portal_login_delete", q("c1"), q(G))
    ok(d.get("ok") and db.one("select count(*) from vault.secrets where id = %s" % q(sid)) == "0", "4. the owner deletes: the Vault secret itself is gone")
    ok(db.one("select (deleted and secret_id is null and deleted_by = %s)::text from gst_portal_logins where client_id = 'c1'" % q(OWNER)) == "true", "4. the login's row is kept, marked deleted (who and when)")
    r = call(OWNER, "gst_portal_login_read", q("c1"), q(G))
    ok(r.get("ok") is False and call(OWNER, "gst_portal_login_list", q("c1")) == [], "4. nothing more can be read; the list is empty")
    s = call(OWNER, "gst_portal_login_save", q("c1"), q(G), q("fx_user"), q(PW), "null")
    ok(s.get("ok") and db.one("select count(*) from gst_portal_logins where client_id = 'c1'") == "2", "4. saved again after a delete: a new row and a new secret")
    # 5. helper runs
    args = lambda outcome, arn: [q("c1"), q(G), q("202511"), q("3B"), q(outcome), q(json.dumps([{"id": "t31", "status": "done"}])) + "::jsonb", q(json.dumps([{"key": "pay.itc.igst.cgst", "fincom": "190.25", "portal": "380.50"}])) + "::jsonb", q(arn), q("run-1"), q("0.1.0"), q("2026.10.17-1"), q("")]
    a = call(OWNER, "gst_helper_run_add", *args("yours", "")); b = call(STAFF, "gst_helper_run_add", *args("filed", "AA0711250000002")); c = call(VIEW, "gst_helper_run_add", *args("done", ""))
    ok(a.get("ok") and b.get("ok") and c.get("ok") is False, "5. owner and staff log runs; a viewer cannot")
    ok(db.one("select string_agg(user_id::text || ':' || outcome || ':' || arn, ',' order by id) from gst_helper_runs") == "%s:yours:,%s:filed:AA0711250000002" % (OWNER, STAFF), "5. each run kept as who logged it, with its ARN")
    bad = call(OWNER, "gst_helper_run_add", *args("filed", "NOT-AN-ARN"))
    ok("sqlerror" in bad, "5. an ARN that is not one is refused")
    good, out = psql("select count(*) from gst_helper_runs;", OTHER, "authenticated")
    ok(good and out == "0", "5. another firm sees none of the runs")
    good, out = psql("update gst_helper_runs set arn = '';", OWNER, "authenticated")
    ok(not good, "5. a run cannot be changed by a signed-in user")
finally:
    db.stop()
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
