"""python3 run_migration_order.py - the order the cloud migrations run in on a fresh database (03-Oct-2026, round 4 items
1-3; docs/MIGRATION-ORDER.md): 32 -> 33 -> 35 -> 34 -> 36 -> 36b, applied TWICE in that order on a throwaway PostgreSQL (pg_stand)
with the tables as on staging (run_migration33's schema, tally_devices, tally_bills) and made-up rows; never on staging.
Checks: every file runs, twice, and deletes nothing; after the run the release functions are migration-34's
(tally_release_approve checks pilot_allowlist_measured; tally_release_pilot clears it), which holds only because the
revised migration-35 no longer defines tally_release_pilot / tally_release_approve (asserted on the file's text: running
35 after 34 would otherwise put back the older functions without the allow-list check); migration-36's functions are
there; every function of 35, 34 and 36 is security definer with search_path = public, pg_temp."""
import os, re, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
ORDER = [(32, "migration-32-sync-safety.sql"), (33, "migration-33-ledger-lists.sql"), (35, "migration-35-bridge-control.sql"), (34, "migration-34-ledger-safety.sql"), (36, "migration-36-ledger-rename.sql"), ("36b", "migration-36b-post-acceptance.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
SCHEMA33 = part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")
SCHEMA35 = part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")
BILLS = """create table if not exists tally_bills (book_id uuid not null references tally_books (book_id) on delete cascade, firm_id uuid not null, guid text not null, day date not null,
  ledger text not null, name text not null default '', type text not null default '', amount numeric not null, bill_date date, credit_days integer, due date);"""
F, U, B, DEV = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555", "11111111-1111-1111-1111-111111111111", "d1000000-0000-0000-0000-000000000001"
db = pg_stand.start(55448)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
def fdef(fn, args=None):
    """the text of a function; args (a type list) when the name is overloaded"""
    return db.one("select pg_get_functiondef(%s::%s)" % (q("public." + fn + ("(" + args + ")" if args else "")), "regprocedure" if args else "regproc")) or ""
try:
    db.sql(SCHEMA33); db.sql(SCHEMA35); db.sql(BILLS)
    db.sql("insert into firms values (%s, 'Firm') on conflict do nothing; insert into members values (%s, %s, 'Me', 'owner', true);" % (q(F), q(U), q(F)))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31');" % (q(B), q(F)))
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, version) values (%s, %s, 'NWS144', 'h1', '2.1.5');" % (q(DEV), q(F)))
    db.sql("""insert into tally_ledgers (book_id, firm_id, name, parent, open) values (%s, %s, 'Cash', 'Cash-in-Hand', -100), (%s, %s, 'Sales', 'Sales Accounts', 100);
              insert into tally_vouchers (book_id, firm_id, guid, day) values (%s, %s, 'g-1', '2026-05-01');
              insert into tally_ledger_day (book_id, firm_id, ledger, day, amount) values (%s, %s, 'Cash', '2026-05-01', -50), (%s, %s, 'Sales', '2026-05-01', 50);""" % ((q(B), q(F)) * 5))
    tables = lambda: [r["t"] for r in db.rows("select table_name as t from information_schema.tables where table_schema = 'public' and table_name like 'tally_%' order by 1")]
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in tables()}
    before = counts()
    for round_ in (1, 2):
        for n, f in ORDER:
            r = psql_file(os.path.join(SQLDIR, f))
            ok(r.returncode == 0, "pass %d: migration-%s runs %s" % (round_, n, (r.stderr or "").strip()[-400:] if r.returncode else ""))
            if r.returncode: raise SystemExit("cannot go on: migration-%s failed" % n)
        k = counts()
        ok(all(k.get(t) == v for t, v in before.items()), "pass %d: nothing deleted (%s rows kept)" % (round_, sum(before.values())))
    # the release functions are migration-34's, because 35 ran before 34 and no longer defines them
    ok("pilot_allowlist_measured" in fdef("tally_release_approve"), "tally_release_approve is migration-34's: it checks pilot_allowlist_measured")
    ok("pilot_allowlist_measured = null" in fdef("tally_release_pilot").replace("  ", " "), "tally_release_pilot is migration-34's: a new pilot clears pilot_allowlist_measured")
    ok(db.one("select array_to_string(proconfig, ',') from pg_proc where proname = 'tally_release_approve'").replace(" ", "") == "search_path=public,pg_temp", "tally_release_approve searches public, pg_temp")
    m35 = open(os.path.join(SQLDIR, "migration-35-bridge-control.sql")).read()
    ok("create or replace function public.tally_release_" not in m35, "the revised migration-35 no longer defines tally_release_pilot / tally_release_approve")
    ok("tally_release_pilot" not in re.sub(r"(?m)^\s*--.*$", "", m35) and "tally_release_approve" not in re.sub(r"(?m)^\s*--.*$", "", m35), "and its revoke/grant lines no longer name them")
    ok(re.search(r"(?i)never run this file after migration 34", m35) is not None, "the file says at its top: never run it after migration 34")
    for fn in ["tally_ledger_rename", "tally_ledger_round_seen", "tally_ledger_round_batch", "tally_ledgers_mark_gone", "tally_ledger_hold_reason", "tally_read_stop", "tally_ingest_ledgers_g"]:
        ok(db.one("select count(*) from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn)) not in (None, "0"), "%s is there" % fn)
    ok("tally_balances" in fdef("tally_ledger_rename") and "trial balance" in fdef("tally_ledger_rename"), "tally_ledger_rename is migration-36's (the trial-balance check)")
    ok("seen_round" not in fdef("tally_ledger_round_batch", "uuid, text, integer, integer, boolean, uuid, text, jsonb") and "seen_round" in fdef("tally_ledger_round_seen"), "the batch counts, the stamp is tally_ledger_round_seen's (migration-36)")
    # every function of 35, 34 and 36: security definer, search_path = public, pg_temp (32 and 33 ran on staging with 'public';
    # 34 replaces their ingest functions)
    n = 0
    for _, f in ORDER[2:]:
        for fn in sorted(set(re.findall(r"function\s+public\.(\w+)\s*\(", open(os.path.join(SQLDIR, f)).read()))):
            for row in db.rows("select prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn)):
                if row["prosecdef"] != "t": continue       # plain trigger functions touch no table
                n += 1
                if row["conf"].replace(" ", "") != "search_path=public,pg_temp": ok(False, "%s (%s): search_path = %r" % (fn, f, row["conf"]))
    ok(n >= 20, "%d security definer functions all search public, pg_temp" % n)
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
