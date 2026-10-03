"""python3 run_migration34.py - migration-34-ledger-safety (02-Oct-2026, round 2 item 3a: a ledger list can never mark a
ledger wrongly). On a throwaway PostgreSQL (pg_stand) with the cloud tables and functions as on staging (the schema of
run_migration33.py, migration-32, migration-33, tally_devices and migration-35 as the owner ran it: the ORIGINAL text
from git, search_path 'public'), then migration-34 twice, then the revised migration-35 (public, pg_temp) and 34 once
more, with made-up rows; never on staging. As on staging, tally_ledgers has no before_clean column at first.
Checks: the file runs twice and deletes nothing; the guard: a ledger with entries or a non-zero opening is never marked
(any path; held and logged); rounds (round 3): each batch carries the GUIDs it read (seen), stamped on the rows (seen_round);
tally_ledgers_mark_gone(book, round) marks the live rows with a GUID the round did not see, only when the round is
complete, the bridge read ledgers and every batch arrived (seen_n = rowsRead), else all held with the note; a poison
ledger in seen is never marked; a twin (merged_into) and a row without a GUID are never counted; the bulk limit
(greatest 25, 5%): over it, only the rows the previous complete round missed too are marked; the guard also holds a
row renamed in the last 30 days or with entries under an old name; a rogue key cannot bloat the rounds (at most 50 new
rounds a day per book) nor the marks (no per-ledger marks for an unknown round, one per round and ledger when
incomplete); renames by GUID in SQL (by GUID, else by the old name, which then takes the GUID; a name taken by another
GUID refused; taken by a row with no GUID: the old row marked merged, or the merge refused and nothing moved when the
guard would keep it; history kept once before_clean exists); the full-list path marks nothing unless declared complete with the right count (the old
signatures still work and mark nothing); approve refused while the pilot's bridge reports its allow-list unmeasured or
has not said; the rounds cannot be deleted, a member reads their own firm's; every function of the file is security
definer with search_path = public, pg_temp; anon and signed-in people cannot call the service functions."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M32, M33, M34, M35 = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-34-ledger-safety.sql", "migration-35-bridge-control.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
def part(path, name):
    """the SCHEMA text of another test (one source for the tables as on staging)"""
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
SCHEMA33 = part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")
SCHEMA35 = part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")
# migration-35 as the owner ran it on staging (its functions with search_path 'public'); the revised file otherwise
# kept as a file (tests/fixtures/migration-35-as-run-on-staging.sql, from git show 195c885) because CI's checkout is
# shallow and cannot show that commit; git only when the file is missing, the revised file as the last resort
M35_FIX = os.path.join(HERE, "fixtures", "migration-35-as-run-on-staging.sql")
if os.path.exists(M35_FIX): M35_ORIG = open(M35_FIX).read()
else:
    try: M35_ORIG = subprocess.run(["git", "-C", HERE, "show", "195c885:server/tally-cloud/migration-35-bridge-control.sql"], capture_output=True, text=True, check=True).stdout
    except Exception: M35_ORIG = open(M35).read()
ok("search_path to 'public'" in M35_ORIG, "the original migration-35 (as run on staging) found in git")

F, F2, U, U2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888", "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444"
STAFF = "66666666-6666-6666-6666-666666666666"
B, B2, BIG = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"
DEV, D2 = "d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002"
GROUPS = [["Current Assets", ""], ["Cash-in-hand", "Current Assets"], ["Sundry Debtors", "Current Assets"], ["Sales Accounts", ""], ["Indirect Expenses", ""], ["Capital Account", ""]]
BASE = [["Cash", "Cash-in-Hand", "-1000"], ["Alpha Traders", "Sundry Debtors", "-300"], ["Beta Traders", "Sundry Debtors", "-200"], ["Sales", "Sales Accounts", "700"],
        ["Rent", "Indirect Expenses", "-100"], ["Capital", "Capital Account", "900"], ["Zero Co", "Sundry Debtors", "0"], ["Zero Two", "Sundry Debtors", "0"],
        ["Cash Two", "Cash-in-Hand", "0"], ["Spare", "Sundry Debtors", "0"], ["Delta Traders", "Sundry Debtors", "0"]]

db = pg_stand.start(55446)
def psql_text(text):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=text, capture_output=True, text=True)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return psql_text(open(path).read())
j = lambda s, uid=None: json.loads(db.one(s, uid))
def call(s, quiet=False):
    """a service-role call; (ok, json or error)"""
    try: return True, j("select " + s + "::text")
    except RuntimeError as e:
        if not quiet: print("  (call failed: %s)" % str(e).strip()[-300:])
        return False, {"error": str(e)}
def as_user(uid, stmt):
    try: return True, db.one("set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
led = lambda book=B: {r["name"]: r for r in db.rows("select name, open, open_sent, tally_guid, deleted_at, deleted_reason, deleted_by_list::text as by_list from tally_ledgers where book_id = %s" % q(book))}
marks = lambda book, ledger=None, action=None: db.rows("select ledger, action, reason, source, device_id, bridge, list::text as list from tally_ledger_marks where book_id = %s%s%s order by id"
                                                       % (q(book), " and ledger = " + q(ledger) if ledger else "", " and action = " + q(action) if action else ""))
try:
    db.sql(SCHEMA33)
    db.sql("insert into firms values (%s, 'Firm'), (%s, 'Other') on conflict do nothing; insert into members values (%s, %s, 'Me', 'owner', true), (%s, %s, 'Them', 'owner', true), (%s, %s, 'Staff', 'staff', true);"
           % (q(F), q(F2), q(U), q(F), q(U2), q(F2), q(STAFF), q(F)))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31'), (%s, %s, 'c9', 'OTHER', '2026-04-01', '2026-03-31'), (%s, %s, 'c2', 'BIG CO', '2026-04-01', '2026-03-31');"
           % (q(B), q(F), q(B2), q(F2), q(BIG), q(F)))
    for path in (M32, M33):
        r = psql_file(path); ok(r.returncode == 0, "%s runs %s" % (os.path.basename(path), (r.stderr or "").strip()[-300:] if r.returncode else ""))
    db.sql(SCHEMA35)
    db.sql("insert into tally_devices (id, firm_id, name, key_hash, version) values (%s, %s, 'NWS144', 'h1', '2.1.5'), (%s, %s, 'OFFICE-2', 'h2', '2.1.4');" % (q(DEV), q(F), q(D2), q(F)))
    r = psql_text(M35_ORIG); ok(r.returncode == 0, "migration-35 as run on staging runs %s" % (r.stderr or "").strip()[-300:])
    ok(db.one("select array_to_string(proconfig, ',') from pg_proc where proname = 'tally_release_approve'") == "search_path=public", "as on staging: tally_release_approve searches 'public' only, before 34")
    # the book as it stands: a full list (migration-33, complete as the lists before 34 were), entries on Cash, Sales and Rent
    LIST = {"source": "bridge ledgers", "device": DEV, "bridge": "go-abc123", "computer": "OFFICE-PC", "user": "accounts"}
    PERSON = {"source": "upload_ledgers", "by": U}
    full = lambda ledgers, src, book=B, extra="": j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s, %s%s)" % (q(book), js(ledgers), js(GROUPS), js(src), extra))
    full(BASE, LIST)
    db.sql("""insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, narration) values (%(B)s, %(F)s, 'g-1', '2026-05-01', 7, 'cash sale');
      insert into tally_ledger_day (book_id, firm_id, ledger, day, amount) values (%(B)s, %(F)s, 'Cash', '2026-05-01', -250), (%(B)s, %(F)s, 'Sales', '2026-05-01', 250), (%(B)s, %(F)s, 'Rent', '2026-05-02', -10);
      update tally_ledgers set tally_guid = case name when 'Alpha Traders' then 'ga' when 'Beta Traders' then 'gb' when 'Cash' then 'gc' end where book_id = %(B)s and name in ('Alpha Traders', 'Beta Traders', 'Cash');""" % {"B": q(B), "F": q(F)})
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_vouchers", "tally_ledgers", "tally_ledger_day", "tally_books", "tally_groups", "tally_ledger_marks", "tally_ledger_lists", "tally_devices", "tally_bridge_releases"]}
    before = counts()

    # 1. the file as the owner runs it (psql, stop at the first error), twice, over migration-35 as run on staging
    for i in (1, 2):
        r = psql_file(M34)
        ok(r.returncode == 0, "migration-34 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if not os.path.exists(M34) or r.returncode: raise SystemExit("cannot go on without the migration")
    ok(counts() == before, "nothing deleted by the migration (%s)" % counts())
    body = open(M34).read().lower()
    code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
    ok(not any(w in code for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column", "delete from"]) and not re.search(r"truncate\s+(table\s+)?(public\.)?tally_", code), "the file drops and deletes nothing")
    ok(code.strip().startswith("begin;") and code.strip().endswith("commit;"), "one transaction (begin; ... commit;)")
    trg = [r["tgname"] for r in db.rows("select tgname from pg_trigger where tgrelid = 'tally_ledgers'::regclass and not tgisinternal order by tgname")]
    ok(len(trg) >= 2 and trg[0] < "tally_ledgers_mark_log" and "tally_ledgers_mark_log" in trg, "the guard trigger sorts before tally_ledgers_mark_log (%s)" % trg)

    # 2. the guard: a ledger with entries, or a non-zero opening, is never marked, whoever tries; held and logged
    db.sql("update tally_ledgers set deleted_at = now() where book_id = %s and name in ('Cash', 'Capital', 'Zero Co')" % q(B))
    L = led()
    ok(L["Cash"]["deleted_at"] == "" and L["Cash"]["deleted_reason"] == "", "Cash (entries): a direct mark is undone, the row stays live")
    ok(L["Capital"]["deleted_at"] == "" and L["Capital"]["deleted_reason"] == "", "Capital (opening 900): not marked")
    ok(L["Zero Co"]["deleted_at"] != "" and L["Zero Co"]["deleted_reason"] != "", "Zero Co (no entries, nil opening): marked as before (%s)" % L["Zero Co"]["deleted_reason"])
    m = {x["ledger"]: x for x in marks(B, action="held")}
    ok(m.get("Cash", {}).get("reason", "").startswith("has entries") and m.get("Capital", {}).get("reason", "").startswith("non-zero opening") and "Zero Co" not in m,
       "held marks say why: %s / %s" % (m.get("Cash", {}).get("reason"), m.get("Capital", {}).get("reason")))
    ok(len(marks(B, "Cash", "marked")) == 0, "no 'marked' log for a ledger the guard kept")
    db.sql("update tally_ledgers set deleted_at = null where book_id = %s and name = 'Zero Co'" % q(B))

    # 3. rounds (round 3): every batch carries the GUIDs it read (seen); a complete round whose batches all arrived marks
    # the live rows with a GUID it did not see; nothing is sent as 'deleted' any more
    many = [["Party %02d" % i, "Sundry Debtors", "0"] for i in range(40)]
    full(many, LIST, book=BIG)
    db.sql("update tally_ledgers set tally_guid = 'g' || substr(name, 7, 2) where book_id = %s and name like 'Party %%'" % q(BIG))
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open) values (%s, %s, 'No Guid', 'Sundry Debtors', 0)" % (q(BIG), q(F)))
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open, tally_guid, merged_into) values (%s, %s, 'Party 39 Twin', 'Sundry Debtors', 0, 'g39t', 'Party 39')" % (q(BIG), q(F)))
    def batch(rnd, rows, read, complete, seen=None, book=BIG, quiet=False):
        args = "%s, %s, %s, %s, %s, %s, 'go-abc123'" % (q(book), q(rnd), rows, "null" if read is None else read, "null" if complete is None else str(complete).lower(), q(DEV))
        return call("tally_ledger_round_batch(%s%s)" % (args, "" if seen is None else ", " + js(seen)), quiet)
    gone = lambda rnd, book=BIG: call("tally_ledgers_mark_gone(%s, %s)" % (q(book), q(rnd)))
    G = lambda a, b: ["g%02d" % i for i in range(a, b)]
    n_marks = lambda book=BIG: int(db.one("select count(*) from tally_ledger_marks where book_id = %s" % q(book)))
    round_marks = lambda rnd, book=BIG: int(db.one("select count(*) from tally_ledger_marks where book_id = %s and action = 'held' and list->>'round' = %s" % (q(book), q(rnd))))
    good, r = batch("r-1", 2000, None, False)
    good2, r2 = batch("r-1", 1500, None, False)
    row = db.rows("select firm_id, batches, rows_received, rows_read, complete, device_id, bridge, seen_n from tally_ledger_rounds where book_id = %s and round_id = 'r-1'" % q(BIG))
    ok(good and good2 and len(row) == 1 and row[0] == {"firm_id": F, "batches": "2", "rows_received": "3500", "rows_read": "", "complete": "f", "device_id": DEV, "bridge": "go-abc123", "seen_n": "0"},
       "two batches of a round (the 7-argument call, no seen) recorded on one row: batches, rows received, who, seen 0 (%s)" % row)
    m0 = n_marks()
    good, r = gone("r-1")
    ok(good and r["marked"] == 0 and r["held"] >= 40 and "complete" in (r["note"] or "") and all(v["deleted_at"] == "" for v in led(BIG).values()), "a round not complete: nothing marked, all held (%s)" % r.get("note"))
    h1 = round_marks("r-1")
    good, r = gone("r-1")
    ok(good and r["marked"] == 0 and round_marks("r-1") == h1 and h1 == r["held"], "held again on the same round: no second 'held' mark per ledger (%d marks for r-1)" % h1)
    ok(db.one("select note from tally_ledger_rounds where round_id = 'r-1'") == r["note"], "the note kept on the round")
    m1 = n_marks()
    good, r = gone("r-9")
    ok(good and r["marked"] == 0 and r["held"] == 0 and "no such round" in (r["note"] or "") and n_marks() == m1, "a round never recorded: nothing marked, no per-ledger marks written (%s)" % r.get("note"))
    # r-2: the bridge read 40 GUIDs (Party 00-38 and a poison ledger it holds, g38, whose row it never sends), in three batches
    batch("r-2", 20, None, None, seen=G(0, 20))
    batch("r-2", 18, 40, True, seen=G(20, 38))
    good, r = gone("r-2")
    L = led(BIG)
    ok(good and r["marked"] == 0 and "38 of 40" in (r["note"] or "") and L["Party 39"]["deleted_at"] == "", "complete and rowsRead 40 but only 38 GUIDs seen (a batch missing): nothing marked (%s)" % r.get("note"))
    ok(db.one("select seen_round from tally_ledgers where book_id = %s and name = 'Party 00'" % q(BIG)) == "r-2" and db.one("select seen_round is null from tally_ledgers where book_id = %s and name = 'Party 39'" % q(BIG)) == "t",
       "the rows seen carry the round (seen_round), the others not")
    batch("r-2", 0, None, None, seen=["g38", "g-poison"])
    ok(db.one("select seen_n || '/' || batches from tally_ledger_rounds where round_id = 'r-2'") == "40/3", "a batch with seen and no rows counts; seen summed over the batches (40/3)")
    good, r = gone("r-2")
    L = led(BIG)
    ok(good and r["marked"] == 1 and L["Party 39"]["deleted_at"] != "" and "round" in (L["Party 39"]["deleted_reason"] or "") and json.loads(L["Party 39"]["by_list"]).get("round") == "r-2",
       "all batches arrived (seen 40 = rowsRead 40): Party 39, not seen, marked with the round on the row (%s)" % L["Party 39"]["deleted_reason"])
    ok(L["Party 38"]["deleted_at"] == "" and len(marks(BIG, "Party 38", "marked")) == 0, "the poison ledger (no row sent, its GUID in seen): not marked")
    ok(L["No Guid"]["deleted_at"] == "" and L["Party 39 Twin"]["deleted_at"] == "" and not any(x["ledger"] == "Party 39 Twin" for x in marks(BIG, action="held") if "r-2" in x["list"]),
       "a row with no GUID, and a twin (merged_into): never counted by a round")
    mk = marks(BIG, "Party 39", "marked")
    ok(len(mk) == 1 and mk[0]["device_id"] == DEV and mk[0]["bridge"] == "go-abc123" and json.loads(mk[0]["list"]).get("round") == "r-2", "the mark logged with the computer, bridge and round (%s)" % mk)
    good, r = gone("r-2")
    ok(good and r["marked"] == 0 and r["held"] == 0 and "nothing" in (r["note"] or ""), "the same round again: nothing more to mark (%s)" % r.get("note"))
    # the bulk limit: 29 of the 40 live with a GUID not seen (limit greatest(25, 5%) = 25): held; the next complete round, missing them too: marked
    batch("r-3", 10, 10, True, seen=G(0, 10))
    good, r = gone("r-3")
    ok(good and r["marked"] == 0 and r["held"] == 29 and "second read" in (r["note"] or "") and not any(led(BIG)["Party %02d" % i]["deleted_at"] for i in range(10, 39)), "29 not seen at once: none marked, held for a second read (%s)" % r.get("note"))
    db.sql("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount) values (%s, %s, 'Party 15', '2026-05-01', -5)" % (q(BIG), q(F)))
    batch("r-4", 10, 10, True, seen=G(0, 10))
    good, r = gone("r-4")
    L = led(BIG)
    ok(good and r["marked"] == 28 and r["held"] == 1 and sum(1 for i in range(10, 39) if L["Party %02d" % i]["deleted_at"]) == 28, "the next complete round not seeing them either: 28 marked (%s)" % {k: r.get(k) for k in ("marked", "held", "note")})
    ok(L["Party 15"]["deleted_at"] == "" and marks(BIG, "Party 15", "held")[-1]["reason"].startswith("has entries"), "Party 15, given an entry meanwhile, is kept by the guard")
    ok(all(L["Party %02d" % i]["deleted_at"] == "" for i in range(10)), "the ten seen stay live")
    batch("r-5", 1, 0, True, seen=[])
    good, r = gone("r-5")
    ok(good and r["marked"] == 0 and "rowsRead 0" in (r["note"] or "") and all(L["Party %02d" % i]["deleted_at"] == "" for i in range(10)), "complete but no ledger read (rowsRead 0): nothing marked (%s)" % r.get("note"))
    batch("r-6", 1, 12, True, seen=G(0, 10))
    good, r = gone("r-6")
    ok(good and r["marked"] == 0 and "10 of 12" in (r["note"] or "") and led(BIG)["Party 15"]["deleted_at"] == "", "a later round short of a batch again: held (%s)" % r.get("note"))
    # a rogue key cannot bloat the rounds: at most 50 new rounds a day per book
    refused = 0
    for i in range(60):
        good, r = batch("x-%02d" % i, 1, None, None, quiet=True)
        if not good: refused += 1
    n24 = int(db.one("select count(*) from tally_ledger_rounds where book_id = %s and started_at > now() - interval '24 hours'" % q(BIG)))
    st = psql_text("do $$ begin perform tally_ledger_round_batch(%s, 'x-99', 1, null, null, %s, 'go', '[]'::jsonb); exception when others then raise notice 'state %%', sqlstate; end $$;" % (q(BIG), q(DEV))).stderr
    ok(refused > 0 and n24 == 51 and "state 54000" in st and "rounds in the last 24 hours" in str(r.get("error")), "more than 50 rounds in a day: a new round refused (54000), %d refused, %d rounds (%s)" % (refused, n24, str(r.get("error")).strip().split("\n")[0][-120:]))
    good, r = batch("r-6", 1, None, None)
    ok(good, "a round already there still takes batches")
    try:
        db.sql("delete from tally_ledger_rounds"); ok(False, "the rounds could be deleted")
    except RuntimeError as e:
        ok("kept" in str(e) or "42501" in str(e), "the rounds cannot be deleted")
    db.sql("grant usage on schema public, auth to authenticated; grant select on members, tally_ledger_marks, tally_ledger_lists to authenticated;")
    ok(as_user(STAFF, "select count(*) from tally_ledger_rounds;")[1] == db.one("select count(*) from tally_ledger_rounds") and as_user(U2, "select count(*) from tally_ledger_rounds;")[1] == "0", "a member reads the firm's rounds, another firm none")
    good, r = call("tally_ledgers_mark_gone(%s, 'r-6', '[[\"g00\", \"Party 00\"]]'::jsonb)" % q(BIG))
    ok(good and r["marked"] == 0 and led(BIG)["Party 00"]["deleted_at"] == "", "the older 3-argument call (a gone list) still answers and marks by the round's seen GUIDs only")

    # 4. renames by GUID in SQL
    ren = lambda guid, frm, to, book=B: call("tally_ledger_rename(%s, %s, %s, %s)" % (q(book), q(guid), q(frm), q(to)))
    good, r = ren("ga", "Alpha Traders", "Alpha Traders Ltd")
    L = led()
    ok(good and r.get("renamed") and "Alpha Traders" not in L and L["Alpha Traders Ltd"]["tally_guid"] == "ga" and L["Alpha Traders Ltd"]["open"] == "-300", "renamed by GUID, the row kept (%s)" % r)
    good, r = ren("gd", "Delta Traders", "Delta Ltd")
    L = led()
    ok(good and r.get("renamed") and L["Delta Ltd"]["tally_guid"] == "gd" and "Delta Traders" not in L, "a row without a GUID found by its old name: renamed and takes the GUID (%s)" % r)
    good, r = ren("ga", "Alpha Traders Ltd", "Beta Traders")
    L = led()
    ok(good and r.get("refused") and "Beta Traders" in (r.get("note") or "") and L["Alpha Traders Ltd"]["tally_guid"] == "ga" and L["Beta Traders"]["tally_guid"] == "gb" and L["Beta Traders"]["deleted_at"] == "",
       "the new name is another GUID's: refused with a note, nothing changed (%s)" % r.get("note"))
    good, r = ren("gz", "Zero Co", "Zero Two")
    L = led()
    ok(good and r.get("merged") and L["Zero Co"]["deleted_at"] != "" and L["Zero Co"]["tally_guid"] == "" and L["Zero Two"]["tally_guid"] == "gz", "the new name is a row with no GUID: the old row marked merged, the other takes the GUID (%s)" % r)
    good, r = ren("gc", "Cash", "Cash Two")
    L = led()
    ok(good and r.get("refused") and not r.get("merged") and L["Cash"]["deleted_at"] == "" and L["Cash"]["tally_guid"] == "gc" and L["Cash Two"]["tally_guid"] == "" and "entries" in (r.get("note") or ""),
       "merging a row with entries: refused with a note, the GUID stays, nothing changed (%s)" % r.get("note"))
    good, r = ren("gk", "Capital", "Spare")
    L = led()
    ok(good and r.get("refused") and L["Capital"]["deleted_at"] == "" and L["Spare"]["tally_guid"] == "" and "opening" in (r.get("note") or ""), "merging a row with an opening: refused (%s)" % r.get("note"))
    # renamed recently: the guard holds the row for 30 days (its days may still be under the old name)
    ok(db.one("select renamed_at > now() - interval '1 minute' from tally_ledgers where book_id = %s and name = 'Delta Ltd'" % q(B)) == "t", "a rename stamps renamed_at")
    db.sql("update tally_ledgers set deleted_at = now() where book_id = %s and name = 'Delta Ltd'" % q(B))
    L = led()
    ok(L["Delta Ltd"]["deleted_at"] == "" and marks(B, "Delta Ltd", "held")[-1]["reason"].startswith("renamed recently"), "a row renamed in the last 30 days: a mark is undone, held 'renamed recently' (%s)" % marks(B, "Delta Ltd", "held")[-1]["reason"])
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open) values (%s, %s, 'Delta Two', 'Sundry Debtors', 0)" % (q(B), q(F)))
    good, r = ren("gd", "Delta Ltd", "Delta Two")
    L = led()
    ok(good and r.get("refused") and L["Delta Ltd"]["tally_guid"] == "gd" and L["Delta Two"]["tally_guid"] == "" and L["Delta Ltd"]["deleted_at"] == "", "merging a row renamed recently: refused, the GUID stays (%s)" % r.get("note"))
    db.sql("update tally_ledgers set renamed_at = now() - interval '31 days' where book_id = %s and name = 'Delta Ltd'" % q(B))
    db.sql("update tally_ledgers set deleted_at = now() where book_id = %s and name = 'Delta Ltd'" % q(B))
    ok(led()["Delta Ltd"]["deleted_at"] != "", "31 days after the rename: marked as any other row")
    db.sql("update tally_ledgers set deleted_at = null where book_id = %s and name = 'Delta Ltd'" % q(B))
    good, r = ren("g-none", "Nobody", "Somebody")
    ok(good and not r.get("renamed") and not r.get("merged"), "no such ledger: nothing done (%s)" % r)
    good, r = ren("gb", "Beta Traders", "Beta Traders")
    ok(good and not r.get("renamed"), "the same name: nothing done")
    ok(db.one("select count(*) from information_schema.columns where table_name = 'tally_ledgers' and column_name = 'before_clean'") == "0", "(tally_ledgers has no before_clean yet, as on staging)")
    db.sql("alter table tally_ledgers add column before_clean jsonb")
    good, r = ren("gb", "Beta Traders", "Beta Ltd")
    h = json.loads(db.one("select coalesce(before_clean::text, '{}') from tally_ledgers where book_id = %s and name = 'Beta Ltd'" % q(B)))
    ok(good and r.get("renamed") and [x.get("from") for x in h.get("renamed", [])] == ["Beta Traders"], "once before_clean exists, the old name is kept in its history (%s)" % h)
    good, r = ren("gb", "Beta Ltd", "Beta Traders")
    h = json.loads(db.one("select coalesce(before_clean::text, '{}') from tally_ledgers where book_id = %s and name = 'Beta Traders'" % q(B)))
    ok([x.get("from") for x in h.get("renamed", [])] == ["Beta Traders", "Beta Ltd"], "and added to (%s)" % [x.get("from") for x in h.get("renamed", [])])
    # entries under an old name (before_clean.renamed): the guard holds the row too
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open, tally_guid) values (%s, %s, 'Temp Row', 'Sundry Debtors', 0, 'gt')" % (q(B), q(F)))
    ren("gt", "Temp Row", "Temp New")
    db.sql("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount) values (%s, %s, 'Temp Row', '2026-05-03', -1); update tally_ledgers set renamed_at = now() - interval '40 days' where book_id = %s and name = 'Temp New'" % (q(B), q(F), q(B)))
    db.sql("update tally_ledgers set deleted_at = now() where book_id = %s and name = 'Temp New'" % q(B))
    ok(led()["Temp New"]["deleted_at"] == "" and "old name" in marks(B, "Temp New", "held")[-1]["reason"], "entries under its old name: held (%s)" % marks(B, "Temp New", "held")[-1]["reason"])
    db.sql("delete from tally_ledger_day where book_id = %s and ledger = 'Temp Row'; update tally_ledgers set deleted_at = now() where book_id = %s and name = 'Temp New'" % (q(B), q(B)))
    ok(led()["Temp New"]["deleted_at"] != "", "those entries gone: marked")

    # 5. the full-list path marks nothing unless declared complete with the right count
    now_list = [x for x in BASE if x[0] not in ("Rent", "Spare", "Zero Co", "Delta Traders", "Alpha Traders")] + [["Alpha Traders Ltd", "Sundry Debtors", "-300"], ["Delta Ltd", "Sundry Debtors", "0"], ["Delta Two", "Sundry Debtors", "0"]]
    n = len(now_list)
    r = full(now_list, PERSON)
    L = led()
    ok(r["marked"] == 0 and r["held"] >= 2 and "complete" in (r["note"] or "") and L["Spare"]["deleted_at"] == "" and L["Rent"]["deleted_at"] == "", "a full list not declared complete: nothing marked, the missing held (%s)" % r.get("note"))
    r = full(now_list, PERSON, extra=", true, %d" % (n + 5))
    ok(r["marked"] == 0 and led()["Spare"]["deleted_at"] == "" and "count" in (r["note"] or ""), "declared complete with the wrong count: nothing marked (%s)" % r.get("note"))
    r = full(now_list, PERSON, extra=", true, %d" % n)
    L = led()
    ok(r["marked"] == 1 and L["Spare"]["deleted_at"] != "" and L["Spare"]["deleted_reason"] == "missing from full list", "declared complete with the right count: Spare (no entries, nil) marked (%s)" % {k: r.get(k) for k in ("marked", "held", "note")})
    ok(L["Rent"]["deleted_at"] == "" and marks(B, "Rent", "held")[-1]["reason"].startswith("has entries"), "Rent (entries) kept by the guard, held (%s)" % marks(B, "Rent", "held")[-1]["reason"])
    r = j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s)" % (q(B), js(now_list[:-1]), js(GROUPS)))
    ok(r["marked"] == 0 and led()["Delta Ltd"]["deleted_at"] == "", "the 5-argument tally_ingest_ledgers_g (tally-ingest before its redeploy) marks nothing")
    r = j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s, %s)" % (q(B), js(now_list[:-1]), js(GROUPS), js(LIST)))
    ok(r["marked"] == 0 and "complete" in (r["note"] or ""), "the 6-argument one (the bridge's trial-balance list, never complete) marks nothing (%s)" % r.get("note"))
    r = j("select tally_ingest_ledgers_list(%s, '2026-04-01', '2026-03-31', %s, %s)" % (q(B), js(now_list[:-1]), js(LIST)))
    ok(r["marked"] == 0, "the 5-argument tally_ingest_ledgers_list marks nothing")
    r = j("select tally_ingest_ledgers(%s, '2026-04-01', '2026-03-31', %s)" % (q(B), js(now_list)))
    ok(r["marked"] == 0 and r["unmarked"] == 0, "the 4-argument tally_ingest_ledgers marks nothing")
    r = full([], PERSON, extra=", true, 0")
    ok(r["marked"] == 0 and "empty" in (r["note"] or ""), "an empty list, even declared complete, marks nothing")

    # 6. approve: refused while the pilot's bridge reports its allow-list unmeasured, or has not said
    db.sql("""insert into tally_bridge_releases (firm_id, version, pilot_device, pilot_started_at, pilot_by, pilot_seen_at, pilot_last_seen_at, pilot_beats)
      values (%s, '2.1.5', %s, now() - interval '30 hours', %s, now() - interval '29 hours', now() - interval '1 hour', 900)""" % (q(F), q(DEV), q(U)))
    approve = lambda: as_user(U, "select tally_release_approve('2.1.5')::text;")
    good, out = approve()
    ok(not good and "allow" in out, "the pilot's bridge has not said whether its allow-list is measured: refused (%s)" % out.strip()[-160:])
    db.sql("update tally_bridge_releases set pilot_allowlist_measured = false, pilot_allowlist_hash = 'h1'")
    good, out = approve()
    ok(not good and "allow" in out, "it reports the allow-list unmeasured: refused (%s)" % out.strip()[-160:])
    db.sql("update tally_bridge_releases set pilot_allowlist_measured = true")
    good, out = approve()
    ok(good and db.one("select approved_at is not null from tally_bridge_releases where version = '2.1.5'") == "t", "measured: approved (%s)" % str(out)[:120])
    db.sql("insert into tally_bridge_releases (firm_id, version, pilot_device, pilot_started_at, pilot_allowlist_measured, pilot_allowlist_hash) values (%s, '2.1.6', %s, now(), true, 'h1')" % (q(F), q(DEV)))
    as_user(U, "select tally_release_pilot('2.1.6', %s::uuid);" % q(D2))
    ok(db.one("select pilot_allowlist_measured is null and pilot_allowlist_hash is null from tally_bridge_releases where version = '2.1.6'") == "t", "another pilot computer: the allow-list evidence starts again")

    # 7. who may call: the service role only; signed-in people and anon cannot
    for fn in ["tally_ledger_round_batch(%s, 'x', 1, 1, true, null, '')" % q(B), "tally_ledger_round_batch(%s, 'x', 1, 1, true, null, '', '[]')" % q(B), "tally_ledgers_mark_gone(%s, 'x')" % q(B), "tally_ledgers_mark_gone(%s, 'x', '[]')" % q(B), "tally_ledger_rename(%s, 'g', 'a', 'b')" % q(B),
               "tally_ingest_ledgers_list(%s, '2026-04-01', '2026-03-31', '[]', '{}', true, 0)" % q(B), "tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', '[]', '[]', '{}', true, 0)" % q(B)]:
        try:
            db.sql("set fincom.role = 'authenticated'; select " + fn + ";"); ok(False, "a member called " + fn)
        except RuntimeError as e:
            ok("not allowed" in str(e), "a member is refused " + fn.split("(")[0])
    for fn in ["tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text)", "tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text, jsonb)", "tally_ledgers_mark_gone(uuid, text)", "tally_ledgers_mark_gone(uuid, text, jsonb)", "tally_ledger_rename(uuid, text, text, text)",
               "tally_ingest_ledgers_list(uuid, date, date, jsonb, jsonb, boolean, integer)", "tally_ingest_ledgers_g(uuid, date, date, jsonb, jsonb, jsonb, boolean, integer)"]:
        ok(db.one("select has_function_privilege('anon', %s, 'execute')" % q("public." + fn)) == "f" and db.one("select has_function_privilege('authenticated', %s, 'execute')" % q("public." + fn)) == "f"
           and db.one("select has_function_privilege('service_role', %s, 'execute')" % q("public." + fn)) == "t", "%s: service role only" % fn.split("(")[0])
    # 8. every function of the file: security definer, search_path = public, pg_temp
    names = sorted(set(re.findall(r"function\s+public\.(\w+)\s*\(", open(M34).read())))
    n = 0
    for fn in names:
        for row in db.rows("select prosecdef, coalesce(array_to_string(proconfig, ','), '') as conf from pg_proc where proname = %s and pronamespace = 'public'::regnamespace" % q(fn)):
            if row["prosecdef"] != "t": continue           # tally_control_kept (migration-35's plain trigger function) touches no table
            n += 1
            ok(row["conf"].replace(" ", "") == "search_path=public,pg_temp", "%s: security definer with search_path = public, pg_temp (has %r)" % (fn, row["conf"]))
    ok(n >= 10, "functions checked: %d" % n)
    # 9. the revised migration-35 (public, pg_temp) on top, then 34 once more: all kept
    k = counts(); k["tally_ledger_rounds"] = int(db.one("select count(*) from tally_ledger_rounds"))
    r = psql_file(M35); ok(r.returncode == 0, "the revised migration-35 runs over 34 %s" % (r.stderr or "").strip()[-300:])
    r = psql_file(M34); ok(r.returncode == 0, "migration-34 runs again over the revised 35 %s" % (r.stderr or "").strip()[-300:])
    k2 = counts(); k2["tally_ledger_rounds"] = int(db.one("select count(*) from tally_ledger_rounds"))
    ok(k2 == k, "run again over the rows: all kept (%s)" % k)
    good, out = approve()
    ok(good, "approve still has the allow-list rule after the revised 35 and 34 again")
    ok(db.one("select array_to_string(proconfig, ',') from pg_proc where proname = 'tally_release_approve'").replace(" ", "") == "search_path=public,pg_temp", "tally_release_approve now searches public, pg_temp")
finally:
    db.stop()
print("\n%d failure(s)" % len(fails) if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
