"""python3 run_migration_corp.py - Corporate phase 1's migrations (07-Nov-2026, branch next-corporate), each that is in the
tree: 143 corp_profiles, 144 corp_filings, 145 corp_documents (server/corporate). On a throwaway PostgreSQL (pg_stand,
port 31430 unless CORP_PG_PORT; never a real database) with Supabase's roles and NO default privileges (as Supabase from
30-Oct-2026, tests/run_migration_grants.py), two made-up firms and their members only. For each file:
  0. the file: one transaction (begin; set local lock_timeout '10s'; ... commit;), add-only (no drop, truncate or delete,
     no other table altered), explicit grants, names no real database; its md5; it runs three times, nothing removed;
  1. the table: row security on; the policies (read, add, change, and remove where it is allowed); authenticated has
     exactly its privileges, anon none, service_role all;
  2. by firm: the owner and staff add and change their firm's rows (firm and who/when set by the database, the firm and
     client never changed by an update); a viewer reads but cannot write; another firm's member sees nothing and cannot
     write a row for this firm; an upsert on the app's conflict key works (PostgREST's on_conflict);
  3. the checks of the table (shapes, sizes, statuses, an SRN and date when filed, a reason when not needed, a final
     document cannot be removed);
  4. the rollback file: refuses while the table has rows; with fincom.corp_rollback = 'drop-with-rows' drops it; runs twice.
RED: the migration files absent -> "the migration file is there" fails."""
import os, re, sys, hashlib, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQL = os.path.join(HERE, "..", "server", "corporate")
FILES = [(143, "migration-143-corp-profiles.sql", "rollback-143-corp-profiles.sql", "corp_profiles"),
         (144, "migration-144-corp-filings.sql", "rollback-144-corp-filings.sql", "corp_filings"),
         (145, "migration-145-corp-documents.sql", "rollback-145-corp-documents.sql", "corp_documents")]
ONLY = [int(x) for x in os.environ.get("CORP_ONLY", "").split(",") if x.strip()]
PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, VIEW, OTHER = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333", "66666666-6666-6666-6666-666666666666"
present = [x for x in FILES if os.path.exists(os.path.join(SQL, x[1])) and (not ONLY or x[0] in ONLY)]
ok(bool(present), "the migration file is there (%s)" % [x[1] for x in present])
if not present:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)

PORT = int(os.environ.get("CORP_PG_PORT") or 31430)
db = pg_stand.start(PORT)
def psql(text, uid=None, role=None):
    pre = ("set fincom.uid = '%s'; " % uid if uid else "") + ("set role %s;\n" % role if role else "")
    r = subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(PORT), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"],
                       input=pre + text, capture_output=True, text=True)
    return r.returncode == 0, (r.stdout.strip() if r.returncode == 0 else r.stderr.strip())
def as_user(uid, sql): return psql(sql, uid, "authenticated")
def privs(role, t): return [p for p in PRIVS if db.one("select has_table_privilege(%s, %s, %s)::text" % (q(role), q("public." + t), q(p))) == "true"]
def last(out): return out.splitlines()[-1] if out else ""

# per table: an insert of the app's shape, the conflict key, its own checks, what a viewer may not do, a remove rule
INS = {
    "corp_profiles": lambda cid, extra="": "insert into corp_profiles (client_id, profile, directors%s) values (%s, '{\"cin\": \"U17299DL2019PTC000000\", \"name\": \"Kestrel Textiles Private Limited\"}', '[{\"name\": \"A. Director\", \"din\": \"00000001\"}]'%s)" % (extra[0] if extra else "", q(cid), extra[1] if extra else ""),
    "corp_filings": lambda cid, extra="": "insert into corp_filings (client_id, ref, form, period, status, steps, due_on%s) values (%s, 'annual:AOC-4:2025-26', 'AOC-4', '2025-26', 'in_progress', 2, '2026-10-30'%s)" % (extra[0] if extra else "", q(cid), extra[1] if extra else ""),
    "corp_documents": lambda cid, extra="": "insert into corp_documents (client_id, template, title, kind, status, fields%s) values (%s, 'bank-open', 'Opening of bank account', 'resolution', 'draft', '{\"bank\": \"Made-up Bank\"}'%s)" % (extra[0] if extra else "", q(cid), extra[1] if extra else ""),
}
UPSERT = {
    "corp_profiles": "insert into corp_profiles (client_id, profile) values ('c-up', '{\"cin\": \"A\"}') on conflict (firm_id, client_id) do update set profile = excluded.profile; insert into corp_profiles (client_id, profile) values ('c-up', '{\"cin\": \"B\"}') on conflict (firm_id, client_id) do update set profile = excluded.profile; select profile->>'cin' from corp_profiles where client_id = 'c-up';",
    "corp_filings": "insert into corp_filings (client_id, ref, form, steps) values ('c-up', 'annual:MGT-7:2025-26', 'MGT-7', 1) on conflict (firm_id, client_id, ref) do update set steps = excluded.steps; insert into corp_filings (client_id, ref, form, steps) values ('c-up', 'annual:MGT-7:2025-26', 'MGT-7', 3) on conflict (firm_id, client_id, ref) do update set steps = excluded.steps; select steps from corp_filings where client_id = 'c-up';",
    "corp_documents": "insert into corp_documents (id, client_id, template, title) values ('11111111-2222-4333-8444-555555555555', 'c-up', 'minutes', 'A') on conflict (id) do update set title = excluded.title; insert into corp_documents (id, client_id, template, title) values ('11111111-2222-4333-8444-555555555555', 'c-up', 'minutes', 'B') on conflict (id) do update set title = excluded.title; select title from corp_documents where client_id = 'c-up';",
}
WANT_UPSERT = {"corp_profiles": "B", "corp_filings": "3", "corp_documents": "B"}
POLICIES = {"corp_profiles": {"corp_profiles_read": "SELECT", "corp_profiles_add": "INSERT", "corp_profiles_change": "UPDATE"},
            "corp_filings": {"corp_filings_read": "SELECT", "corp_filings_add": "INSERT", "corp_filings_change": "UPDATE", "corp_filings_remove": "DELETE"},
            "corp_documents": {"corp_documents_read": "SELECT", "corp_documents_add": "INSERT", "corp_documents_change": "UPDATE", "corp_documents_remove": "DELETE"}}
AUTH_PRIVS = {"corp_profiles": ["SELECT", "INSERT", "UPDATE"], "corp_filings": ["SELECT", "INSERT", "UPDATE", "DELETE"], "corp_documents": ["SELECT", "INSERT", "UPDATE", "DELETE"]}
BAD = {
    "corp_profiles": [("directors not a list", "insert into corp_profiles (client_id, directors) values ('k1', '{}')"),
                      ("an empty client id", "insert into corp_profiles (client_id) values ('')"),
                      ("a letterhead over 300 KB", "insert into corp_profiles (client_id, letterhead) values ('k2', jsonb_build_object('logo', (select string_agg(md5(i::text), '') from generate_series(1, 12000) i)))")],
    "corp_filings": [("a status not known", "insert into corp_filings (client_id, ref, form, status) values ('k1', 'annual:X:1', 'AOC-4', 'done')"),
                     ("filed without an SRN", "insert into corp_filings (client_id, ref, form, status, filed_on) values ('k1', 'annual:X:2', 'AOC-4', 'filed', '2026-10-01')"),
                     ("filed without a date", "insert into corp_filings (client_id, ref, form, status, srn) values ('k1', 'annual:X:3', 'AOC-4', 'filed', 'AB1234567')"),
                     ("a wrong SRN", "insert into corp_filings (client_id, ref, form, status, srn, filed_on) values ('k1', 'annual:X:4', 'AOC-4', 'filed', '12-34', '2026-10-01')"),
                     ("not needed without a reason", "insert into corp_filings (client_id, ref, form, status) values ('k1', 'annual:X:5', 'MSME-1', 'not_needed')"),
                     ("steps over 4", "insert into corp_filings (client_id, ref, form, steps) values ('k1', 'annual:X:6', 'AOC-4', 5)"),
                     ("a form name not a form's", "insert into corp_filings (client_id, ref, form) values ('k1', 'annual:X:7', 'aoc4; drop')")],
    "corp_documents": [("a kind not known", "insert into corp_documents (client_id, template, kind) values ('k1', 'bank-open', 'letter')"),
                       ("a status not known", "insert into corp_documents (client_id, template, status) values ('k1', 'bank-open', 'signed')"),
                       ("a template key not a key", "insert into corp_documents (client_id, template) values ('k1', 'Bank Open!')")],
}
GOOD = {"corp_filings": [("filed with its SRN and date", "insert into corp_filings (client_id, ref, form, status, srn, filed_on, steps) values ('k1', 'annual:ADT-1:2025-26', 'ADT-1', 'filed', 'AB1234567', '2026-10-05', 4)"),
                         ("not needed with its reason", "insert into corp_filings (client_id, ref, form, status, reason) values ('k1', 'annual:MSME-1:2025-26:H1', 'MSME-1', 'not_needed', 'no dues over 45 days')"),
                         ("a DIR-3 KYC row (a space in the form)", "insert into corp_filings (client_id, ref, form, director) values ('k1', 'annual:DIR-3 KYC:2025-26:00000001', 'DIR-3 KYC', '00000001')"),
                         ("an event form", "insert into corp_filings (client_id, ref, form, kind, event_on, due_on) values ('k1', 'event:DIR-12:abc', 'DIR-12', 'event', '2026-11-01', '2026-12-01')")]}

try:
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$;
      insert into firms values (%(F)s, 'Made-up Firm'), (%(F2)s, 'Other Made-up Firm') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(V)s, %(F)s, 'Viewer', 'viewer', true), (%(X)s, %(F2)s, 'Other', 'owner', true);
      grant usage on schema public, auth to anon, authenticated, service_role; grant execute on all functions in schema auth to anon, authenticated;
      grant select on members, firms to authenticated; grant execute on function my_firm(), can_write(), is_superadmin() to authenticated;""" % {"F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "V": q(VIEW), "X": q(OTHER)})
    for n, mf, rf, t in present:
        print("\nmigration %d (%s)" % (n, t))
        path = os.path.join(SQL, mf); text = open(path).read(); low = text.lower()
        print("  md5 %s  %s (%d bytes)" % (hashlib.md5(text.encode()).hexdigest(), mf, len(text.encode())))
        ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
        ok(low.count("delete from") == 0 and not re.search(r"\bdrop\b", low) and not re.search(r"\btruncate\b", low), "0. add-only (no drop, truncate or delete from)")
        ok(not re.findall(r"alter table (?!public\.%s )" % t, low), "0. no other table altered")
        ok("grant select" in low and "grant all on public.%s to service_role" % t in low and "revoke all on public.%s from public, anon, authenticated" % t in low, "0. explicit grants (revoke all, then exactly what each role gets)")
        ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocskaiewaxqcvaunzc", low), "0. names no real database")
        for rnd in (1, 2, 3):
            good, out = psql(text)
            ok(good, "0. pass %d: migration %d runs %s" % (rnd, n, "" if good else out[-400:]))
            if not good: raise SystemExit("cannot go on")
            if rnd == 1: db.sql(INS[t]("seed", (", firm_id", ", " + q(F))))
        ok(db.one("select count(*) from %s" % t) == "1", "0. nothing removed by the second and third runs (the row kept)")
        # 1. the table
        ok(db.one("select relrowsecurity::text from pg_class where oid = 'public.%s'::regclass" % t) == "true", "1. row security on")
        pols = {r["p"]: r["c"] for r in db.rows("select policyname as p, cmd as c from pg_policies where tablename = '%s'" % t)}
        ok(pols == POLICIES[t], "1. the policies (%s)" % pols)
        ok(privs("authenticated", t) == AUTH_PRIVS[t] and privs("anon", t) == [] and privs("service_role", t) == PRIVS,
           "1. authenticated %s, anon none, service_role all (%s; %s; %s)" % (AUTH_PRIVS[t], privs("authenticated", t), privs("anon", t), privs("service_role", t)))
        ok(db.one("select has_function_privilege('anon', 'public.%s_touch()', 'execute')::text" % t) == "false" and db.one("select has_function_privilege('authenticated', 'public.%s_touch()', 'execute')::text" % t) == "false",
           "1. the trigger function is not callable by anon or authenticated")
        # 2. by firm
        good, out = as_user(OWNER, INS[t]("c1") + "; select count(*) from %s;" % t)
        ok(good and last(out) == "2", "2. the owner adds a row and reads the firm's rows (%s)" % out[-200:])
        ok(db.one("select (firm_id = %s and updated_by = %s and updated_at > now() - interval '1 minute')::text from %s where client_id = 'c1'" % (q(F), q(OWNER), t)) == "true", "2. the firm and who/when set by the database")
        good, out = as_user(STAFF, "update %s set client_id = 'moved', firm_id = %s where client_id = 'c1'; select count(*) from %s where client_id = 'c1' and firm_id = %s;" % (t, q(F), t, q(F)))
        ok(good and last(out) == "1", "2. staff change a row; its client and firm stay (%s)" % out[-200:])
        ok(db.one("select updated_by::text from %s where client_id = 'c1'" % t) == STAFF, "2. the change is in staff's name")
        good, out = as_user(VIEW, "select count(*) from %s;" % t)
        ok(good and out == "2", "2. a viewer reads the firm's rows (%s)" % out)
        good, out = as_user(VIEW, INS[t]("v1"))
        ok(not good, "2. a viewer cannot add (%s)" % out[-100:])
        good, out = as_user(VIEW, "update %s set client_id = client_id where client_id = 'c1' returning 1;" % t)
        ok(good and out == "", "2. a viewer's change touches nothing (%s)" % out[-100:])
        good, out = as_user(OTHER, "select count(*) from %s;" % t)
        ok(good and out == "0", "2. another firm's member sees none (%s)" % out)
        good, out = as_user(OTHER, INS[t]("x1", (", firm_id", ", " + q(F))))
        ok(not good, "2. a row for another firm is refused")
        good, out = as_user(OTHER, "update %s set client_id = client_id returning 1;" % t)
        ok(good and out == "", "2. another firm's member changes nothing (%s)" % out[-100:])
        good, out = as_user(OWNER, UPSERT[t])
        ok(good and last(out) == WANT_UPSERT[t], "2. an upsert on the app's conflict key (%s)" % out[-200:])
        if "DELETE" in AUTH_PRIVS[t]:
            good, out = as_user(VIEW, "delete from %s where client_id = 'c-up' returning 1;" % t)
            ok(good and out == "", "2. a viewer removes nothing (%s)" % out[-100:])
            good, out = as_user(OTHER, "delete from %s returning 1;" % t)
            ok(good and out == "", "2. another firm's member removes nothing")
            if t == "corp_documents":
                as_user(OWNER, "update corp_documents set status = 'final' where client_id = 'c-up';")
                good, out = as_user(OWNER, "delete from corp_documents where client_id = 'c-up' returning 1;")
                ok(good and out == "", "3. a final document cannot be removed (%s)" % out[-100:])
                as_user(OWNER, "update corp_documents set status = 'draft' where client_id = 'c-up';")
            good, out = as_user(STAFF, "delete from %s where client_id = 'c-up' returning 1;" % t)
            ok(good and out == "1", "2. staff remove a row of the firm (a draft) (%s)" % out[-100:])
        else:
            good, out = as_user(OWNER, "delete from %s where client_id = 'c-up';" % t)
            ok(not good, "2. nobody deletes a profile (no grant)")
        # 3. the checks
        for what, sql in BAD[t]:
            good, out = as_user(OWNER, sql)
            ok(not good, "3. refused: %s" % what)
        for what, sql in GOOD.get(t, []):
            good, out = as_user(OWNER, sql)
            ok(good, "3. kept: %s %s" % (what, "" if good else out[-200:]))
        # 4. the rollback
        rb = os.path.join(SQL, rf)
        ok(os.path.exists(rb), "4. the rollback file is there (%s)" % rf)
        if os.path.exists(rb):
            rtext = open(rb).read()
            print("  md5 %s  %s" % (hashlib.md5(rtext.encode()).hexdigest(), rf))
            good, out = psql(rtext)
            ok(not good and "keep a copy first" in out and db.one("select to_regclass('public.%s')::text" % t) == t, "4. the rollback refuses while the table has rows, the table kept")
            good, out = psql("set fincom.corp_rollback = 'drop-with-rows';\n" + rtext)
            ok(good and db.one("select coalesce(to_regclass('public.%s')::text, 'gone')" % t) == "gone" and db.one("select count(*) from pg_proc where proname = '%s_touch'" % t) == "0", "4. with fincom.corp_rollback set: dropped, its function too %s" % ("" if good else out[-200:]))
            good, out = psql(rtext)
            ok(good, "4. the rollback runs again (nothing left to do)")
            good, out = psql(text)
            ok(good and db.one("select to_regclass('public.%s')::text" % t) == t, "4. the migration runs again after the rollback")
finally:
    db.stop()
    shutil.rmtree(db.data, ignore_errors=True)
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
