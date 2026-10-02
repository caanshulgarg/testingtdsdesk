"""python3 run_migration35.py - migration-35-bridge-control (02-Oct-2026: a hanging Tally must not recur). On a throwaway
PostgreSQL (pg_stand) with tally_devices as on staging (migration.sql + migration-22) and made-up rows; never on staging.
Checks: the file runs twice, drops and deletes nothing; Stop reading / Resume (tally_read_stop, tally_read_resume) and
the staged release (tally_release_pilot, tally_release_approve) are for an owner of the firm only (a staff member, an
owner of another firm and someone with no firm are refused, 42501), for a computer of the firm only (not another firm's,
not a removed one); a stop for one computer and for all; asking twice keeps one stop; Resume clears (cleared_at/by), never
deletes, and records a resume row (also when FinCom had no stop: a bridge that stopped itself); the rows cannot be
deleted; members read their own firm's rows only and write none; approve is refused before a working day on the pilot
(20 hours since the pilot started, the pilot computer seen on the version, for 6 hours, without stopping itself), then
allowed; anon cannot call the functions."""
import os, re, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQL = os.path.join(HERE, "..", "server", "tally-cloud", "migration-35-bridge-control.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"

# tally_devices as on staging: migration.sql's table, migration-13's wake_token, migration-4's want_*, migration-22's main_*
SCHEMA = """
drop table if exists tally_devices, tally_read_stops, tally_bridge_releases cascade;
create table tally_devices (id uuid primary key default gen_random_uuid(), firm_id uuid not null references firms(id) on delete cascade, name text not null,
  key_hash text not null unique, created_at timestamptz not null default now(), created_by uuid, last_seen timestamptz, version text, info jsonb not null default '{}'::jsonb,
  revoked boolean not null default false, wake_token text, want_update_at timestamptz, want_sent_at timestamptz, main_bridge text, main_set_at timestamptz, main_set_by uuid);
alter table tally_devices enable row level security;
create policy tally_devices_read on tally_devices for select to authenticated using (firm_id = my_firm());
grant usage on schema public, auth to authenticated, anon;
grant select on members to authenticated;
"""
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, OTHER, NOBODY, GONE = ("55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333",
                                     "22222222-2222-2222-2222-222222222222", "11111111-1111-1111-1111-111111111111")
D1, D2, D3, DREV = ("d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002", "d3000000-0000-0000-0000-000000000003", "d4000000-0000-0000-0000-000000000004")

db = pg_stand.start(55445)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
def as_user(uid, stmt):
    """runs stmt as a signed-in person (role authenticated, auth.uid() = uid); returns (ok, output or error)"""
    try: return True, db.one("set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
def refused(uid, stmt):
    """not an owner: 42501; an owner of another firm: the computer or version is not of their firm"""
    good, out = as_user(uid, stmt)
    if uid == OTHER: return (not good) and ("not a computer of your firm" in out or "start a pilot first" in out), out
    return (not good) and ("42501" in out or "only an owner" in out), out
try:
    db.sql(SCHEMA)
    db.sql("""insert into firms values (%(F)s, 'Firm'), (%(F2)s, 'Other') on conflict do nothing;
      insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true), (%(S)s, %(F)s, 'Staff', 'staff', true), (%(X)s, %(F2)s, 'Them', 'owner', true), (%(G)s, %(F)s, 'Left', 'owner', false);
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.1.5'), (%(D2)s, %(F)s, 'OFFICE-2', 'h2', '2.1.4'),
        (%(D3)s, %(F2)s, 'THEIRS', 'h3', '2.1.4');
      insert into tally_devices (id, firm_id, name, key_hash, revoked) values (%(DR)s, %(F)s, 'OLD-PC', 'h4', true);""" % {
        "F": q(F), "F2": q(F2), "O": q(OWNER), "S": q(STAFF), "X": q(OTHER), "G": q(GONE), "D1": q(D1), "D2": q(D2), "D3": q(D3), "DR": q(DREV)})
    counts = lambda: {t: db.one("select count(*) from %s" % t) for t in ["tally_devices", "members", "firms"]}
    before = counts()
    # 1. the file as the owner runs it (psql, stop at the first error), twice
    for i in (1, 2):
        r = psql_file(SQL)
        ok(r.returncode == 0, "migration-35 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if not os.path.exists(SQL) or r.returncode:
        raise SystemExit("cannot go on without the migration")
    ok(counts() == before, "nothing deleted by the migration (%s)" % counts())
    body = open(SQL).read().lower()
    code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
    ok(not any(w in code for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column", "delete from"]) and not re.search(r"truncate\s+(table\s+)?(public\.)?tally_", code),
       "the file drops and deletes nothing")
    ok(code.strip().startswith("begin;") and code.strip().endswith("commit;"), "one transaction (begin; ... commit;)")

    # 2. Stop reading: owner only, the firm's computers only
    stop = lambda dev, why="Tally hung": "select tally_read_stop(%s, %s)::text;" % ("null" if dev is None else q(dev) + "::uuid", q(why))
    resume = lambda dev: "select tally_read_resume(%s)::text;" % ("null" if dev is None else q(dev) + "::uuid")
    for who, name in [(STAFF, "a staff member"), (OTHER, "an owner of another firm"), (NOBODY, "someone with no firm"), (GONE, "an owner no longer active")]:
        r, out = refused(who, stop(D1))
        ok(r, "%s cannot stop reading (%s)" % (name, out.strip()[-120:]))
        r, out = refused(who, resume(D1))
        ok(r, "%s cannot resume reading" % name)
    good, out = as_user(OWNER, stop(D3))
    ok(not good and "computer" in out, "the owner cannot stop another firm's computer (%s)" % out.strip()[-120:])
    good, out = as_user(OWNER, stop(DREV))
    ok(not good and "computer" in out, "nor a removed computer")
    good, out = as_user(OWNER, stop("00000000-0000-0000-0000-00000000dead"))
    ok(not good, "nor a computer that does not exist")
    ok(db.one("select count(*) from tally_read_stops") == "0", "nothing recorded by the refused calls")

    good, out = as_user(OWNER, stop(D1, "  The 900-second read on 02-Oct  " + "x" * 600))
    ok(good and '"ok": true' in out, "the owner stops reading on NWS144 (%s)" % out[:200])
    row = db.rows("select firm_id, device_id, action, reason, stopped_by, stopped_at, cleared_at from tally_read_stops")
    ok(len(row) == 1 and row[0]["firm_id"] == F and row[0]["device_id"] == D1 and row[0]["action"] == "stop" and row[0]["stopped_by"] == OWNER and row[0]["stopped_at"] and not row[0]["cleared_at"],
       "kept: the firm, the computer, who and when (%s)" % row)
    ok(row and row[0]["reason"].startswith("The 900-second read") and len(row[0]["reason"]) <= 300, "the reason trimmed and kept to 300 letters")
    good, out = as_user(OWNER, stop(D1, "again"))
    ok(good and db.one("select count(*) from tally_read_stops where action = 'stop' and cleared_at is null and device_id = %s" % q(D1)) == "1", "asked twice: still one stop for it")
    good, out = as_user(OWNER, stop(None, ""))
    ok(good and db.one("select count(*) from tally_read_stops where device_id is null and action = 'stop' and cleared_at is null and firm_id = %s" % q(F)) == "1",
       "the owner stops reading on all the firm's computers (a row with no computer)")
    ok(db.one("select reason from tally_read_stops where device_id is null") != "", "an empty reason gets a plain one")

    # 3. Resume: clears, never deletes, records a resume row
    good, out = as_user(OWNER, resume(D1))
    ok(not good and "all" in out, "Resume for NWS144 while all computers are stopped: refused, resume all first (%s)" % out.strip()[-160:])
    n0 = int(db.one("select count(*) from tally_read_stops"))
    good, out = as_user(OWNER, resume(None))
    left = db.one("select count(*) from tally_read_stops where action = 'stop' and cleared_at is null")
    ok(good and left == "0", "Resume all: every stop of the firm cleared (one computer's and all) (%s)" % out[:200])
    ok(int(db.one("select count(*) from tally_read_stops")) == n0 + 1 and db.one("select count(*) from tally_read_stops where action = 'resume' and device_id is null") == "1",
       "the stops kept (cleared, not deleted) and a resume row added")
    ok(db.one("select count(*) from tally_read_stops where action = 'stop' and (cleared_by is distinct from %s or cleared_at is null)" % q(OWNER)) == "0", "who cleared them and when, on each")
    as_user(OWNER, stop(D2, "slow"))
    good, out = as_user(OWNER, resume(D2))
    ok(good and db.one("select cleared_at is not null from tally_read_stops where device_id = %s and action = 'stop'" % q(D2)) == "t", "one computer stopped and resumed")
    n1 = int(db.one("select count(*) from tally_read_stops"))
    good, out = as_user(OWNER, resume(D1))
    ok(good and int(db.one("select count(*) from tally_read_stops")) == n1 + 1 and db.one("select count(*) from tally_read_stops where action = 'resume' and device_id = %s" % q(D1)) == "1",
       "Resume with no stop from FinCom (the bridge stopped itself): a resume row the beat passes on (%s)" % out[:200])
    # the rows stay
    try:
        db.sql("delete from tally_read_stops"); ok(False, "the stops could be deleted")
    except RuntimeError as e:
        ok("kept" in str(e) or "42501" in str(e), "the stops cannot be deleted, even by the database's owner (%s)" % str(e).strip()[-100:])
    good, out = as_user(OWNER, "insert into tally_read_stops (firm_id, device_id, action) values (%s, %s, 'stop') returning id;" % (q(F), q(D1)))
    ok(not good, "a signed-in person cannot write a stop directly (only through the functions)")
    good, out = as_user(OWNER, "update tally_read_stops set cleared_at = now() returning id;")
    ok(not good or not out, "nor change one")

    # 4. the firm reads its own rows only
    mine = as_user(STAFF, "select count(*) from tally_read_stops;")[1]
    ok(mine == db.one("select count(*) from tally_read_stops where firm_id = %s" % q(F)) and mine != "0", "a staff member reads the firm's stops (%s)" % mine)
    ok(as_user(OTHER, "select count(*) from tally_read_stops;")[1] == "0", "another firm reads none of them")

    # 5. the staged release: pilot and approve, owner only
    pilot = lambda v, dev: "select tally_release_pilot(%s, %s)::text;" % (q(v), q(dev) + "::uuid")
    approve = lambda v: "select tally_release_approve(%s)::text;" % q(v)
    for who, name in [(STAFF, "a staff member"), (OTHER, "an owner of another firm"), (NOBODY, "someone with no firm")]:
        ok(refused(who, pilot("2.1.5", D1))[0], "%s cannot start a pilot" % name)
        ok(refused(who, approve("2.1.5"))[0], "%s cannot approve a version" % name)
    good, out = as_user(OWNER, pilot("2.1.5", D3))
    ok(not good and "computer" in out, "the pilot computer must be the firm's own (%s)" % out.strip()[-120:])
    good, out = as_user(OWNER, pilot("2.1.5", DREV))
    ok(not good, "and not a removed one")
    good, out = as_user(OWNER, pilot("latest; drop", D1))
    ok(not good and "version" in out, "a version is a plain number (2.1.5)")
    good, out = as_user(OWNER, approve("2.1.5"))
    ok(not good and "pilot" in out, "a version never piloted cannot be approved (%s)" % out.strip()[-120:])
    good, out = as_user(OWNER, pilot("2.1.5", D1))
    rel = db.rows("select firm_id, version, pilot_device, pilot_started_at, pilot_by, approved_at from tally_bridge_releases")
    ok(good and len(rel) == 1 and rel[0]["pilot_device"] == D1 and rel[0]["pilot_by"] == OWNER and rel[0]["pilot_started_at"] and not rel[0]["approved_at"],
       "the owner makes NWS144 the pilot for 2.1.5 (%s)" % rel)
    good, out = as_user(OWNER, approve("2.1.5"))
    ok(not good and "working day" in out, "approve at once: refused, the pilot has not run a working day (%s)" % out.strip()[-160:])
    # 21 hours on, but the pilot computer never beat on 2.1.5
    db.sql("update tally_bridge_releases set pilot_started_at = now() - interval '21 hours'")
    good, out = as_user(OWNER, approve("2.1.5"))
    ok(not good and "NWS144" in out, "21 hours on, the pilot computer never seen on 2.1.5: refused, named (%s)" % out.strip()[-160:])
    # seen once only, an hour in
    db.sql("update tally_bridge_releases set pilot_seen_at = now() - interval '20 hours', pilot_last_seen_at = now() - interval '20 hours', pilot_beats = 1")
    good, out = as_user(OWNER, approve("2.1.5"))
    ok(not good, "seen on 2.1.5 for a moment only (not 6 hours): refused (%s)" % out.strip()[-160:])
    # ran the day, but stopped reading by itself during it
    db.sql("update tally_bridge_releases set pilot_last_seen_at = now() - interval '1 hour', pilot_beats = 2000, pilot_self_stop = '{\"reason\": \"a request took 31 s\", \"at\": \"x\"}'")
    good, out = as_user(OWNER, approve("2.1.5"))
    ok(not good and "stopped" in out, "the pilot stopped reading by itself during the pilot: refused (%s)" % out.strip()[-160:])
    db.sql("update tally_bridge_releases set pilot_self_stop = null")
    good, out = as_user(STAFF, approve("2.1.5"))
    ok(not good, "a staff member still cannot approve it")
    good, out = as_user(OWNER, approve("2.1.5"))
    rel = db.rows("select approved_at, approved_by from tally_bridge_releases")[0]
    ok(good and rel["approved_at"] and rel["approved_by"] == OWNER, "after a working day on the pilot the owner approves 2.1.5 for all (%s)" % out[:200])
    good, out = as_user(OWNER, approve("2.1.5"))
    ok(good and db.one("select count(*) from tally_bridge_releases") == "1", "approving again changes nothing")
    good, out = as_user(OWNER, pilot("2.1.5", D2))
    ok(not good and "approved" in out, "an approved version cannot be piloted again (%s)" % out.strip()[-120:])
    # a new pilot computer for a new version starts the day again
    as_user(OWNER, pilot("2.1.6", D1))
    db.sql("update tally_bridge_releases set pilot_started_at = now() - interval '30 hours', pilot_seen_at = now() - interval '29 hours', pilot_last_seen_at = now() where version = '2.1.6'")
    good, out = as_user(OWNER, pilot("2.1.6", D2))
    r = db.rows("select pilot_device, pilot_started_at > now() - interval '1 minute' as fresh, pilot_seen_at from tally_bridge_releases where version = '2.1.6'")[0]
    ok(good and r["pilot_device"] == D2 and r["fresh"] == "t" and not r["pilot_seen_at"], "another pilot computer: the pilot day starts again, the evidence cleared (%s)" % r)
    good, out = as_user(OWNER, pilot("2.1.6", D2))
    ok(good and db.one("select pilot_started_at > now() - interval '1 minute' from tally_bridge_releases where version = '2.1.6'") == "t", "the same pilot asked again: kept")
    try:
        db.sql("delete from tally_bridge_releases"); ok(False, "the releases could be deleted")
    except RuntimeError as e:
        ok("kept" in str(e), "the releases cannot be deleted")
    ok(as_user(STAFF, "select count(*) from tally_bridge_releases;")[1] == "2" and as_user(OTHER, "select count(*) from tally_bridge_releases;")[1] == "0", "the firm reads its releases, another firm none")
    good, out = as_user(OWNER, "update tally_bridge_releases set approved_at = now() returning version;")
    ok(not good or not out, "a signed-in person cannot approve by writing the row")

    # 6. grants: signed-in people may call the functions (they check the owner), anon may not
    for fn in ["tally_read_stop(uuid, text)", "tally_read_resume(uuid)", "tally_release_pilot(text, uuid)", "tally_release_approve(text)"]:
        ok(db.one("select has_function_privilege('authenticated', %s, 'execute')" % q("public." + fn)) == "t" and db.one("select has_function_privilege('anon', %s, 'execute')" % q("public." + fn)) == "f",
           "%s: authenticated yes, anon no" % fn)
    # 6b. every security definer function of the file pins search_path to public, pg_temp (pg_temp last: no temp-table shadowing)
    names = sorted(set(re.findall(r"function\s+public\.(\w+)\s*\(", open(SQL).read())))
    definers = 0
    for fn in names:
        row = db.one("select string_agg(case when prosecdef then 'definer' else 'invoker' end || '|' || coalesce(array_to_string(proconfig, ','), ''), ';') "
                     "from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn))
        for one in (row or "").split(";"):
            kind, conf = (one.split("|", 1) + [""])[:2]
            if kind == "definer":
                definers += 1
                ok(conf.replace(" ", "") == "search_path=public,pg_temp", "%s: security definer with search_path = public, pg_temp (has %r)" % (fn, conf))
    ok(definers >= 4, "the security definer functions checked: %d" % definers)
    # 7. run once more over the rows: nothing lost
    n = {t: db.one("select count(*) from %s" % t) for t in ["tally_read_stops", "tally_bridge_releases"]}
    r = psql_file(SQL)
    ok(r.returncode == 0 and {t: db.one("select count(*) from %s" % t) for t in n} == n, "run again over the rows: they are all kept (%s)" % n)
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
