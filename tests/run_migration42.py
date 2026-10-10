"""python3 run_migration42.py - migration-42-empty-day-second-read (03-Oct-2026, round 12: the owner's decision). Staging's order
on a throwaway PostgreSQL (pg_stand): 32 -> 33 -> 35 -> 34 (first) -> 36b -> 37 -> 36 -> 38 -> 39 -> 40 -> 41, made-up rows, then
42 twice. Checks: an empty read the bridge vouches for marks a day's entries only on the SECOND consecutive empty read, for ANY
day with live entries, fewer than 10 days of a book within 24 hours (a day of 3: the first is refused 'empty day with 3 live entries: confirm by a second empty read',
emptyPending, recorded; the second marks and its note names the first); tally_days.n is not zeroed by the refused read nor by a
short read; a short read in between neither sets nor clears empty_at; a file with entries clears it (the next empty read is a
first one again); a day with no live entries is recorded as empty at once with nothing to mark; the 30-entry day the same as the
day of 3; the 7-argument wrapper still answers; security definer; the file runs twice and a third time over used tables.
The cap: book B2, 12 days with one entry each: an all-empty round records 10 as pending and refuses 2 (emptyCapped, not
recorded, n kept), the same round again refuses all 12 and marks nothing; days with no live entries stay outside the cap.
RED (before 42): run with SKIP42=1; RED for the cap: M42_FILE=<the 42 of commit 915aca1>: the first empty read on the day of 3 marks at once (41's rule) and the checks fail."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql", "migration-40-states-carried.sql", "migration-41-day-counts.sql")]
M42 = os.environ.get("M42_FILE") or os.path.join(SQLDIR, "migration-42-empty-day-second-read.sql")
SKIP42 = os.environ.get("SKIP42") == "1"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
SCHEMA33 = part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")
SCHEMA35 = part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")
SCHEMA_X = part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X")
F, OWNER = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555"
B, D1 = "11111111-1111-1111-1111-111111111111", "d1000000-0000-0000-0000-000000000001"
B2 = "22222222-2222-2222-2222-222222222222"
DAY, BIG, NEVER = "2026-05-01", "2026-05-02", "2026-05-03"
GROUPS = [["Current Assets", ""], ["Cash-in-hand", "Current Assets"], ["Sales Accounts", ""], ["Indirect Expenses", ""], ["Capital Account", ""]]
LEDGERS = [["Cash", "Cash-in-Hand", "-1000"], ["Sales", "Sales Accounts", "0"], ["Rent", "Indirect Expenses", "0"], ["Capital", "Capital Account", "1000"]]
def V(guid, alter): return {"guid": guid, "alter": alter, "type": "Sales", "no": guid.upper(), "party": "", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": ""}
L = lambda guid, ledger, amount: [guid, ledger, amount, "", None, []]
G = {"g1": ([V("g1", 1)], [L("g1", "Sales", 250), L("g1", "Cash", -250)]), "g2": ([V("g2", 1)], [L("g2", "Sales", 100), L("g2", "Cash", -100)]), "g3": ([V("g3", 1)], [L("g3", "Rent", -50), L("g3", "Cash", 50)])}
def day(keys, n, alter=5, d=DAY):
    vs = sum((G[k][0] for k in keys), []); ls = sum((G[k][1] for k in keys), [])
    return "select tally_ingest_day(%s, %s, %s, %s, %d, %d, 1000)::text" % (q(B), q(d), js(vs), js(ls), n, alter)
empty8 = lambda d, b=B: "select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10, true)::text" % (q(b), q(d))
empty7 = lambda d: "select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10)::text" % (q(B), q(d))
# the cap: book B2, 12 days with one entry each (plus 2 weekend days with none)
def oneday(b, d, i, alter=5): return "select tally_ingest_day(%s, %s, %s, %s, 1, %d, 100)::text" % (q(b), q(d), js([dict(V("c%02d" % i, 1), no="C%02d" % i)]), js([L("c%02d" % i, "Sales", 10), L("c%02d" % i, "Cash", -10)]), alter)
DAYS12 = ["2026-06-%02d" % d for d in range(1, 13)]
db = pg_stand.start(55449)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
j = lambda s: json.loads(db.one(s))
tday = lambda d=DAY, b=B: (db.rows("select n, empty_at, note from tally_days where book_id = %s and day = %s" % (q(b), q(d))) or [{}])[0]
livev = lambda d=DAY, b=B: int(db.one("select count(*) from tally_vouchers where book_id = %s and day = %s and deleted_at is null" % (q(b), q(d))))
liveb = lambda b: int(db.one("select count(*) from tally_vouchers where book_id = %s and deleted_at is null" % q(b)))
try:
    db.sql(SCHEMA33); db.sql(SCHEMA35); db.sql(SCHEMA_X)
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31'), (%(B2)s, %(F)s, 'c2', 'ZZ CAP', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.1.6');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "B2": q(B2), "D1": q(D1)})
    for path in FILES:
        r = psql_file(path); ok(r.returncode == 0, "%s runs %s" % (os.path.basename(path), (r.stderr or "").strip()[-300:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_vouchers", "tally_lines", "tally_days", "tally_post_ids", "tally_post_jobs", "tally_ledgers", "client_book_items"]}
    j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s)::text" % (q(B), js(LEDGERS), js(GROUPS)))
    j(day(["g1", "g2", "g3"], 3))
    vs = [dict(V("b%02d" % i, 1), no="B%02d" % i) for i in range(30)]; ls = sum(([L("b%02d" % i, "Sales", 10), L("b%02d" % i, "Cash", -10)] for i in range(30)), [])
    j("select tally_ingest_day(%s, %s, %s, %s, 30, 5, 1000)::text" % (q(B), q(BIG), js(vs), js(ls)))
    before = counts()
    if SKIP42: print("  (SKIP42: migration-42 not applied; 41's rule is tested, the checks below are expected to FAIL)")
    else:
        for i in (1, 2):
            r = psql_file(M42); ok(r.returncode == 0, "migration-42 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on without the migration")
        ok(counts() == before, "nothing deleted by the migration")
        body = open(M42).read().lower(); code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
        code2 = re.sub(r"delete from tally_(bills|lines) \w where \w\.book_id = p_book and \w\.guid = any\(sent\);|delete from tally_ledger_day t where t\.book_id = p_book and t\.day = any\(touched\);", "", code)
        ok(code2.count("delete from") == 0 and not any(w in code2 for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column", "drop constraint", "alter table"]) and code.strip().startswith("begin;") and code.strip().endswith("commit;"), "the file drops, deletes and alters nothing (37's cache / re-send deletes inside tally_ingest_day aside); one transaction")
        ok("supersedes 41" in body and "never tally_days.n" in body and "what clears empty_at" in body and "fewer than" in body and "24 hours" in body, "the header says it supersedes 41's 8-argument tally_ingest_day, that n never decides, what clears empty_at, and the 24-hour cap")
    # ---- a day of 3 entries: the first empty read is refused and recorded, n kept
    ok(livev() == 3 and tday()["n"] == "3" and tday()["empty_at"] == "", "(a day of 3 entries, n 3, no empty read yet)")
    r = j(empty8(DAY)); t = tday()
    ok(r.get("refused") == "empty day with 3 live entries: confirm by a second empty read" and r.get("emptyPending") is True and r.get("marked") == 0 and "empty" not in r and livev() == 3,
       "1. the first empty read on a day of 3: nothing marked, refused, emptyPending (%s)" % (r.get("refused") or r))
    ok(t["empty_at"] != "" and t["note"] == r.get("refused") and t["n"] == "3", "2. recorded: empty_at set, the note, and tally_days.n still 3 (not zeroed) (n=%s)" % t["n"])
    first_at = t["empty_at"]
    # ---- a short read in between: says nothing, neither sets nor clears
    r = j(empty7(DAY)); t = tday()
    ok(r.get("refused") == "short read: 0 of 0" and livev() == 3 and t["empty_at"] == first_at and t["n"] == "3", "3. a short read (no flag) in between: nothing marked, empty_at unchanged, n still 3")
    # ---- the second empty read marks
    r = j(empty8(DAY)); t = tday()
    ok(r.get("empty") is True and r.get("marked") == 3 and "refused" not in r and livev() == 0, "4. the second consecutive empty read marks the 3")
    ok(t["n"] == "0" and t["note"].startswith("3 entries marked deleted on the second empty read (the first at ") and t["empty_at"] != "", "5. recorded: n 0, the note names the first read (%s)" % t["note"])
    # ---- a file with entries clears the record; the next empty read is a first one again
    r = j(day(["g1", "g2", "g3"], 3, alter=6)); t = tday()
    ok("refused" not in r and livev() == 3 and t["empty_at"] == "" and t["note"] == "" and t["n"] == "3", "6. a file with entries: un-marked, the record cleared, n 3")
    r = j(empty8(DAY))
    ok(r.get("emptyPending") is True and livev() == 3, "7. after it the next empty read is the first one once more (refused)")
    j(day(["g1", "g2", "g3"], 3, alter=7))
    # ---- a day that never had entries: nothing to mark, recorded as empty at once
    r = j(empty8(NEVER)); t = tday(NEVER)
    ok(r.get("empty") is True and r.get("marked") == 0 and "refused" not in r and t["note"] == "empty day, nothing to mark" and t["empty_at"] != "" and t["n"] == "0", "8. a day with no live entries: empty at once, nothing to mark, recorded (%s)" % t["note"])
    # ---- a day of 30: the same rule as the day of 3
    r = j(empty8(BIG)); t = tday(BIG)
    ok(r.get("refused") == "empty day with 30 live entries: confirm by a second empty read" and livev(BIG) == 30 and t["n"] == "30", "9. a day of 30: first empty read refused, n kept 30")
    r = j(empty8(BIG)); t = tday(BIG)
    ok(r.get("empty") is True and r.get("marked") == 30 and livev(BIG) == 0 and t["n"] == "0", "10. a day of 30: the second marks the 30")
    # ---- the cap (book B2): a round that lists no entries for a book with entries records at most 9 days and marks nothing, twice
    j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s)::text" % (q(B2), js(LEDGERS), js(GROUPS)))
    for i, d in enumerate(DAYS12): j(oneday(B2, d, i))
    ok(liveb(B2) == 12, "(book B2: 12 days with one entry each)")
    r1 = [j(empty8(d, B2)) for d in DAYS12]
    pend = [x for x in r1 if x.get("emptyPending")]; capd = [x for x in r1 if x.get("emptyCapped")]
    ok(len(pend) == 10 and len(capd) == 2 and all(x.get("marked") == 0 and "empty" not in x for x in r1) and liveb(B2) == 12, "C1. an all-empty round over 12 days: 10 recorded as pending, 2 refused by the cap, nothing marked (%d pending, %d capped)" % (len(pend), len(capd)))
    ok((capd or [{}])[0].get("refused", "").startswith("10 days of this book read empty within 24 hours: a read fault") and tday(DAYS12[11], B2)["empty_at"] == "" and tday(DAYS12[11], B2)["n"] == "1", "C2. a capped day: the words, not recorded (empty_at empty), n kept (%s)" % (capd or [{}])[0].get("refused", "")[:60])
    r2 = [j(empty8(d, B2)) for d in DAYS12]
    ok(all(x.get("emptyCapped") and x.get("marked") == 0 for x in r2) and liveb(B2) == 12, "C3. the same round again within 24 hours: every day refused by the cap, nothing marked (the 10 pending days too)")
    j("select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10, true)::text" % (q(B2), "'2026-06-13'")); j("select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10, true)::text" % (q(B2), "'2026-06-14'"))
    ok(tday("2026-06-13", B2)["note"] == "empty day, nothing to mark" and tday("2026-06-14", B2)["note"] == "empty day, nothing to mark", "C4. days with no live entries are recorded empty at once, outside the cap")
    # a genuine emptying of 2 days on a book under the cap: book B's day of 3 (pending from check 7) and the day of 30 (marked) count 2
    ok(int(db.one("select count(*) from tally_days where book_id = %s and empty_at >= now() - interval '24 hours' and coalesce(note, '') <> 'empty day, nothing to mark'" % q(B))) < 10, "(book B is under the cap)")
    # ---- a full file still marks what is missing at once (not an empty read)
    r = j(day(["g1", "g2"], 2, alter=8)); t = tday()
    ok(r.get("marked") == 1 and "refused" not in r and livev() == 2 and t["n"] == "2" and t["empty_at"] == "", "11. a full file with 2 of 3: the missing one marked at once, as before")
    for fn, args in [("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer, boolean"), ("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer")]:
        d = db.one("select pg_get_functiondef(%s::regprocedure)" % q("public.%s(%s)" % (fn, args)))
        ok("SECURITY DEFINER" in d and "pg_temp" in d, "%s(%s): security definer, search_path public, pg_temp" % (fn, args[-30:]))
    ok("null::boolean" in db.one("select pg_get_functiondef('public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer)'::regprocedure)"), "the 7-argument wrapper (41's) is untouched and calls the 8-argument one")
    if not SKIP42:
        k = counts(); r = psql_file(M42); ok(r.returncode == 0 and counts() == k, "migration-42 runs a third time over used tables")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
