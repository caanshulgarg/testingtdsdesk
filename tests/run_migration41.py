"""python3 run_migration41.py - migration-41-day-counts (03-Oct-2026, round 11s: the security review of rounds 9-11). Staging's
order on a throwaway PostgreSQL (pg_stand): 32 -> 33 -> 35 -> 34 (first) -> 36b -> 37 -> 36 -> 38 -> 39 -> 40, made-up rows,
then 41 twice. Checks: (M5) a PostOnly refusal whose words name a company "Created 1 Pvt Ltd" is never an acceptance
(tally_post_result_accepted, tally_post_job_accepted, the sync frees its id); (L4) an empty read the bridge vouches for is
recorded on tally_days (empty_at, note) when it marks; a day with more than 25 entries is not emptied on the first empty
read (refused, emptyPending, recorded) and is on the second; a file with entries clears the record; (L6) a soft-deleted
new-name item is a clash: not revived, not touched; the 7-argument wrapper still answers; the file runs twice."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql", "migration-40-states-carried.sql")]
M41 = os.path.join(SQLDIR, "migration-41-day-counts.sql")
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
J = lambda n: "%08d-0000-0000-0000-000000000000" % n
DAY = "2026-05-01"
GROUPS = [["Current Assets", ""], ["Cash-in-hand", "Current Assets"], ["Sales Accounts", ""], ["Indirect Expenses", ""], ["Capital Account", ""]]
LEDGERS = [["Cash", "Cash-in-Hand", "-1000"], ["Sales", "Sales Accounts", "0"], ["Rent", "Indirect Expenses", "0"], ["Capital", "Capital Account", "1000"]]
def V(guid, alter): return {"guid": guid, "alter": alter, "type": "Sales", "no": guid.upper(), "party": "", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": ""}
L = lambda guid, ledger, amount: [guid, ledger, amount, "", None, []]
G = {"g1": ([V("g1", 1)], [L("g1", "Sales", 250), L("g1", "Cash", -250)]), "g2": ([V("g2", 1)], [L("g2", "Sales", 100), L("g2", "Cash", -100)]), "g3": ([V("g3", 1)], [L("g3", "Rent", -50), L("g3", "Cash", 50)])}
def day(keys, n, alter=5):
    vs = sum((G[k][0] for k in keys), []); ls = sum((G[k][1] for k in keys), [])
    return "select tally_ingest_day(%s, %s, %s, %s, %d, %d, 1000)::text" % (q(B), q(DAY), js(vs), js(ls), n, alter)
def vch(i): return {"id": i, "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:%s</NARRATION></VOUCHER>" % i}
def job(jid, ids, status="running"):
    return "insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, %d, %s);" % (q(jid), q(F), js({"vouchers": [vch(i) for i in ids]}), len(ids), q(status))
db = pg_stand.start(55448)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
j = lambda s: json.loads(db.one(s))
live = lambda jid, fid: db.one("select live from tally_post_ids where job_id = %s and fincom_id = %s" % (q(jid), q(fid)))
vrow = lambda g: db.rows("select guid, alter_id, deleted_at from tally_vouchers where book_id = %s and guid = %s" % (q(B), q(g)))[0]

GROUPS40 = [["Sundry Debtors", "Current Assets"], ["Current Assets", ""]]
item = lambda key, name: (db.rows("select data::text as d, deleted, carried::text as c from client_book_items where firm_id = %s and client_id = 'c1' and key = %s and item = %s" % (q(F), q(key), q("." + name))) or [None])[0]

item = lambda key, name: (db.rows("select data::text as d, deleted, carried::text as c from client_book_items where firm_id = %s and client_id = 'c1' and key = %s and item = %s" % (q(F), q(key), q("." + name))) or [None])[0]
tday = lambda d=DAY: (db.rows("select n, empty_at, note from tally_days where book_id = %s and day = %s" % (q(B), q(d))) or [{}])[0]
livev = lambda d=DAY: int(db.one("select count(*) from tally_vouchers where book_id = %s and day = %s and deleted_at is null" % (q(B), q(d))))
try:
    db.sql(SCHEMA33); db.sql(SCHEMA35); db.sql(SCHEMA_X)
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.1.5');
      create table if not exists clients (id text, firm_id uuid, name text, data jsonb, deleted boolean default false, tally_name text, gstin text, primary key (firm_id, id));
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'ZZ', '{"choices": {}}');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D1": q(D1)})
    for path in FILES:
        r = psql_file(path); ok(r.returncode == 0, "%s runs %s" % (os.path.basename(path), (r.stderr or "").strip()[-300:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_vouchers", "tally_lines", "tally_days", "tally_post_ids", "tally_post_jobs", "tally_ledgers", "client_book_items"]}
    j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s)::text" % (q(B), js(LEDGERS + [["Alpha Traders", "Sundry Debtors", "0"]]), js(GROUPS + [["Sundry Debtors", "Current Assets"], ["Current Assets", ""]])))
    db.sql("update tally_ledgers set tally_guid = 'g-alpha' where book_id = %s and name = 'Alpha Traders'" % q(B))
    j(day(["g1", "g2", "g3"], 3))
    before = counts()
    for i in (1, 2):
        r = psql_file(M41); ok(r.returncode == 0, "migration-41 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if r.returncode: raise SystemExit("cannot go on without the migration")
    ok(counts() == before, "nothing deleted by the migration")
    body = open(M41).read().lower(); code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
    code2 = re.sub(r"delete from tally_(bills|lines) \w where \w\.book_id = p_book and \w\.guid = any\(sent\);|delete from tally_ledger_day t where t\.book_id = p_book and t\.day = any\(touched\);", "", code)
    ok(code2.count("delete from") == 0 and not any(w in code2 for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column", "drop constraint"]) and code.strip().startswith("begin;") and code.strip().endswith("commit;"), "the file drops and deletes nothing (37's cache / re-send deletes inside tally_ingest_day aside); one transaction")
    ok(re.search(r"supersedes 39", body) is not None and "running this file is enough" in body, "the header says the 8-argument tally_ingest_day here supersedes 39's and that on staging 41 alone is enough")
    ok(db.one("select count(*) from information_schema.columns where table_name = 'tally_days' and column_name in ('empty_at', 'note')") == "2", "L4. tally_days.empty_at and note added")
    # ---- M5. a PostOnly refusal naming "Created 1 Pvt Ltd" is never an acceptance
    PO = {"id": "P1", "ok": False, "refused": True, "postOnly": True, "state": "failed", "message": "This computer posts only to Created 1 Pvt Ltd (PostOnly); posting to ZZ CO refused", "reason": "Tally replied 'created'? no: Created 1 Pvt Ltd is the company's name"}
    ok(db.one("select tally_post_result_accepted(%s::jsonb)" % js(PO)) == "f" and db.one("select tally_post_result_accepted(%s::jsonb)" % js(dict(PO, postOnly=False))) == "t", "M5. tally_post_result_accepted: false with postOnly true, whatever the words (true without the flag: the heuristics do read 'Created 1')")
    db.sql(job(J(1), ["P1", "P2"]))
    db.sql("update tally_post_jobs set results = %s, items = %s where id = %s" % (js([PO, {"id": "P2", "ok": False, "accepted": True, "lastVchId": "26600"}]), js([{"id": "P1", "state": "failed", "postOnly": True, "reason": PO["message"]}, {"id": "P2", "state": "unknown"}]), q(J(1))))
    ok(db.one("select tally_post_job_accepted(%s::uuid, results, items) from tally_post_jobs where id = %s" % (q(J(1)), q(J(1)))) == "P2", "M5. tally_post_job_accepted: P2 alone (the PostOnly P1 never)")
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(1)))
    ok(live(J(1), "P1") == "f" and live(J(1), "P2") == "t", "M5. the posting failed: P1's id freed, P2's kept")
    # ---- L4. an empty read recorded; the cap on a full day
    ok(livev() == 3 and tday().get("empty_at", "") == "", "(a day of 3 entries, no empty read yet)")
    r = j("select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10, true)::text" % (q(B), q(DAY)))
    t = tday()
    ok(r.get("empty") is True and r.get("marked") == 3 and livev() == 0 and t["empty_at"] != "" and t["note"] == "3 entries marked deleted on an empty read", "L4. 3 entries: marked on the first empty read, recorded (%s)" % t["note"])
    r = j(day(["g1", "g2", "g3"], 3, alter=6)); t = tday()
    ok("refused" not in r and livev() == 3 and t["empty_at"] == "" and t["note"] == "", "L4. a file with entries: un-marked, the record cleared")
    BIG = "2026-05-02"
    vs = [dict(V("b%02d" % i, 1), no="B%02d" % i) for i in range(30)]; ls = sum(([L("b%02d" % i, "Sales", 10), L("b%02d" % i, "Cash", -10)] for i in range(30)), [])
    j("select tally_ingest_day(%s, %s, %s, %s, 30, 5, 1000)::text" % (q(B), q(BIG), js(vs), js(ls)))
    ok(livev(BIG) == 30 and tday(BIG)["n"] == "30", "(a day of 30 entries)")
    r = j("select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10, true)::text" % (q(B), q(BIG))); t = tday(BIG)
    ok(r.get("refused") == "empty day with 30 entries before: confirm by a second empty read" and r.get("emptyPending") is True and r.get("marked") == 0 and "empty" not in r and livev(BIG) == 30 and t["empty_at"] != "" and t["note"] == r["refused"],
       "L4. more than 25 entries: the first empty read marks nothing, is refused and recorded (%s)" % t["note"])
    r = j("select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10, true)::text" % (q(B), q(BIG))); t = tday(BIG)
    ok(r.get("empty") is True and r.get("marked") == 30 and livev(BIG) == 0 and t["note"] == "30 entries marked deleted on an empty read", "L4. the second consecutive empty read marks the 30 (%s)" % t["note"])
    j("select tally_ingest_day(%s, %s, %s, %s, 30, 6, 1000, false)::text" % (q(B), q(BIG), js(vs), js(ls)))
    r = j("select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10, true)::text" % (q(B), q(BIG)))
    ok(r.get("emptyPending") is True and livev(BIG) == 30, "L4. after a file with entries the count stands again: the next empty read is the first one once more")
    r = j("select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 9, 10)::text" % (q(B), q(BIG)))
    ok(r.get("refused") == "short read: 0 of 0" and livev(BIG) == 30, "L4/M3. the 7-argument call (no flag): a short read, nothing marked")
    # ---- 2, 6, 7 (code review): the carried choices get at = now() / by = 'rename'; the old map item is marked deleted after the copy,
    # so tally_led_kinds counts the new name alone; only gst:/tds:/bank:/sales:/exp values are rewritten
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open, tally_guid) values (%s, %s, 'Alpha GST', 'Duties & Taxes', 0, 'g-agst')" % (q(B), q(F)))
    db.sql("insert into client_book_items (firm_id, client_id, key, item, data) values (%s, 'c1', 'map', '.Alpha GST', '{\"kind\": \"gst\", \"side\": \"output\", \"tax\": \"CGST\", \"ok\": true}');" % q(F))
    db.sql("update clients set data = %s where firm_id = %s and id = 'c1'" % (js({"choices": {"gst:cgst": {"value": "Alpha GST", "state": "confirmed", "at": "2026-01-01T00:00:00.000Z", "by": "anshul"}, "other:x": {"value": "Alpha GST", "state": "confirmed", "at": "2026-01-01T00:00:00.000Z"}, "flow:Alpha GST": {"value": "loan_given", "state": "confirmed", "at": "2026-01-01T00:00:00.000Z"}}}), q(F)))
    mapped0 = int(db.one("select count(*) from tally_led_kinds('c1')", OWNER))
    r = j("select tally_ledger_rename(%s, 'g-agst', 'Alpha GST', 'Alpha GST New')::text" % q(B))
    old, new = item("map", "Alpha GST"), item("map", "Alpha GST New")
    ok(r.get("renamed") and old["deleted"] == "t" and json.loads(old["c"] or "{}").get("to") == "Alpha GST New" and "clash" not in json.loads(old["c"] or "{}") and new["deleted"] == "f", "6. after the copy the old map item is marked deleted (soft) with carried = {to, at}")
    ok(int(db.one("select count(*) from tally_led_kinds('c1')", OWNER)) == mapped0, "6. tally_led_kinds (the GST / TDS summaries' mapped count) unchanged by the rename (%d)" % mapped0)
    ch = json.loads(db.one("select (data->'choices')::text from clients where firm_id = %s and id = 'c1'" % q(F)))
    ok(ch["gst:cgst"]["value"] == "Alpha GST New" and ch["gst:cgst"]["at"] > "2026-01-01T00:00:00.000Z" and ch["gst:cgst"]["by"] == "rename" and ch["gst:cgst"]["prev"] == "Alpha GST", "2. the rewritten choice's at is newer than before, by = 'rename' (%s)" % ch["gst:cgst"]["at"])
    ok(ch["flow:Alpha GST New"]["value"] == "loan_given" and ch["flow:Alpha GST New"]["at"] > "2026-01-01T00:00:00.000Z" and ch["flow:Alpha GST New"]["by"] == "rename", "2. the added flow:<new> key carries at = now() and by = 'rename'")
    ok(ch["other:x"]["value"] == "Alpha GST", "7. a choice outside gst:/tds:/bank:/sales:/exp is left alone")
    # ---- 5. a book whose trial balance does not tie renames; the sum is unchanged and said
    db.sql("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) values (%s, %s, 'Cash', '2026-04-15', 12.5, 0, 12.5, 1)" % (q(B), q(F)))
    tb = lambda: round(float(db.one("select coalesce(sum(closing), 0) from tally_balances where book_id = %s" % q(B))), 2)
    ok(tb() == 12.5, "(the book made not to tie: sum of closing 12.50)")
    db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open, tally_guid) values (%s, %s, 'Delta Co', 'Sundry Debtors', 0, 'g-delta')" % (q(B), q(F)))
    r = j("select tally_ledger_rename(%s, 'g-delta', 'Delta Co', 'Delta Co Ltd')::text" % q(B))
    ok(r.get("renamed") and float(r.get("tb")) == 12.5 and "12.5" in (r.get("tbNote") or "") and tb() == 12.5, "5. renamed although the book is 12.50 off; the sum unchanged and said in tbNote (%s)" % (r.get("tbNote") or "")[:70])
    db.sql("update tally_ledger_day set amount = 0, cr = 0, n = 0 where book_id = %s and ledger = 'Cash' and day = '2026-04-15'" % q(B))
    # ---- L6. a soft-deleted new-name item is a clash, not revived
    db.sql("insert into client_book_items (firm_id, client_id, key, item, data) values (%s, 'c1', 'map', '.Alpha Traders', '{\"kind\": \"party\", \"ok\": true}'), (%s, 'c1', 'map', '.Alpha Traders Ltd', '{\"kind\": \"old\", \"ok\": false}');" % (q(F), q(F)))
    db.sql("update client_book_items set deleted = true where firm_id = %s and client_id = 'c1' and key = 'map' and item = '.Alpha Traders Ltd'" % q(F))
    r = j("select tally_ledger_rename(%s, 'g-alpha', 'Alpha Traders', 'Alpha Traders Ltd')::text" % q(B))
    new, old = item("map", "Alpha Traders Ltd"), item("map", "Alpha Traders")
    ok(r.get("renamed") and "map" in (r.get("carried") or {}).get("clash", []) and new["deleted"] == "t" and json.loads(new["d"]).get("kind") == "old" and (new["c"] or "") == "" and json.loads(old["c"] or "{}").get("to") == "Alpha Traders Ltd" and json.loads(old["c"] or "{}").get("clash") is True and old["deleted"] == "f",
       "L6/6. a deleted new-name item: a clash, not revived, not touched; the old item stays live, carried = {to, at, clash: true} (%s)" % (r.get("carried")))
    for fn, args in [("tally_ledger_carry_choices", "uuid, text, text"), ("tally_ledger_rename", "uuid, text, text, text"), ("tally_post_job_accepted", "uuid, jsonb, jsonb"), ("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer, boolean"), ("tally_ingest_day", "uuid, date, jsonb, jsonb, integer, bigint, integer")]:
        d = db.one("select pg_get_functiondef(%s::regprocedure)" % q("public.%s(%s)" % (fn, args)))
        ok("SECURITY DEFINER" in d and "pg_temp" in d, "%s(%s): security definer, search_path public, pg_temp" % (fn, args[:20]))
    k = counts(); r = psql_file(M41); ok(r.returncode == 0 and counts() == k, "migration-41 runs a third time over used tables")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
