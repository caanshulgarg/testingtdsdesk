"""python3 run_migration38.py - migration-38-post-followups (03-Oct-2026, round 9: the posting follow-ups 6, 7 and 9). On a
throwaway PostgreSQL (pg_stand) with the cloud tables as on staging (run_migration33's schema, tally_bills, tally_devices),
then staging's order 32 -> 33 -> 35 -> 34 (as first run on staging) -> 36b -> 37 -> 36, then 38 twice, over made-up rows
sent through the real tally_ingest_day; never on staging.
Checks: the file runs twice; (6) a failed posting whose results carry an acceptance by Tally but whose id was never stamped
keeps that id live (a plain refused one is freed), and a new posting for the id is refused; (7) tally_post_marks' foreign
keys no longer cascade: deleting a job with a mark is refused; (9) a short day file (no entries, or fewer than the bridge
counted) upserts what came and marks nothing, answering refused: 'short read: n of p_n'; a full file marks the missing one."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql")]
M38 = os.path.join(SQLDIR, "migration-38-post-followups.sql")
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
try:
    db.sql(SCHEMA33); db.sql(SCHEMA35); db.sql(SCHEMA_X)
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing; insert into members values (%(O)s, %(F)s, 'Owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(B)s, %(F)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31');
      insert into tally_devices (id, firm_id, name, key_hash, version) values (%(D1)s, %(F)s, 'NWS144', 'h1', '2.1.5');""" % {"F": q(F), "O": q(OWNER), "B": q(B), "D1": q(D1)})
    for path in FILES:
        r = psql_file(path); ok(r.returncode == 0, "%s runs %s" % (os.path.basename(path), (r.stderr or "").strip()[-300:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_vouchers", "tally_lines", "tally_post_ids", "tally_post_jobs", "tally_post_marks", "tally_ledgers"]}
    db.sql(job(J(9), ["Z9"]))
    db.sql("insert into tally_post_marks (firm_id, job_id, entry_id, action, note, by_user) values (%s, %s, 'Z9', 'released', 'kept', %s)" % (q(F), q(J(9)), q(OWNER)))
    before = counts()
    for i in (1, 2):
        r = psql_file(M38); ok(r.returncode == 0, "migration-38 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if r.returncode: raise SystemExit("cannot go on without the migration")
    ok(counts() == before, "nothing deleted by the migration (%s)" % counts())
    body = open(M38).read().lower(); code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
    # the only deletes: migration 37's replace of a RE-SENT entry's lines and bills inside tally_ingest_day (its old lines are on its version row)
    # and the tally_ledger_day cache of the touched days, rebuilt from the live lines just after (37's text too)
    code2 = re.sub(r"delete from tally_(bills|lines) \w where \w\.book_id = p_book and \w\.guid = any\(sent\);|delete from tally_ledger_day t where t\.book_id = p_book and t\.day = any\(touched\);", "", code)
    ok(code2.count("delete from") == 0 and code.count("delete from") == 3 and not any(w in code2 for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column"]) and not re.search(r"truncate\s+(table\s+)?(public\.)?tally_", code2),
       "the file drops nothing but the two cascading keys it re-makes; the only deletes are 37's replace of a re-sent entry's lines and bills and the day cache's rebuild")
    ok(code.strip().startswith("begin;") and code.strip().endswith("commit;"), "one transaction (begin; ... commit;)")
    # 6. an acceptance in the posting's own words keeps the id live, stamped or not
    db.sql(job(J(1), ["A1", "A2"]))
    db.sql("update tally_post_jobs set results = %s, items = %s where id = %s" % (q(json.dumps([{"id": "A1", "ok": False, "message": "Tally replied CREATED 1 LASTVCHID 26298; not found on read-back"}, {"id": "A2", "ok": False, "message": "Tally refused it: ledger missing"}])),
                                                                                q(json.dumps([{"id": "A1", "state": "failed", "reason": "read-back failed"}, {"id": "A2", "state": "failed", "reason": "ledger missing"}])), q(J(1))))
    ok(db.one("select accepted_at from tally_post_ids where job_id = %s and fincom_id = 'A1'" % q(J(1))) in ("", None), "(A1 never stamped accepted_at: an older tally-ingest, or stamped 0)")
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(1)))
    ok(live(J(1), "A1") == "t" and live(J(1), "A2") == "f", "6. the posting failed: A1 (CREATED in its result) stays live without a stamp, A2 (refused) is freed")
    try: db.sql(job(J(2), ["A1"])); ok(False, "6. A1 was queued again")
    except RuntimeError as e: ok("already being posted" in str(e), "6. a new posting for A1 is refused")
    db.sql(job(J(3), ["A2"])); ok(live(J(3), "A2") == "t", "6. A2 may be queued again")
    db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J(1)))
    ok(live(J(1), "A1") == "t", "6. cancelled: A1 still live")
    # 7. the marks are history: a job with a mark cannot be deleted
    ok(db.one("select string_agg(confdeltype::text, '' order by conname) from pg_constraint where conrelid = 'public.tally_post_marks'::regclass and contype = 'f'") == "rr", "7. both foreign keys of tally_post_marks are ON DELETE RESTRICT")
    try: db.sql("delete from tally_post_jobs where id = %s" % q(J(9))); ok(False, "7. a job with a mark was deleted")
    except RuntimeError as e: ok("violates foreign key" in str(e) or "23503" in str(e), "7. deleting a job with a mark is refused (%s)" % str(e).strip()[-80:])
    ok(db.one("select count(*) from tally_post_marks") == "1" and db.one("select count(*) from tally_post_jobs where id = %s" % q(J(9))) == "1", "7. the mark and the job are still there")
    # 9. short reads mark nothing
    j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s)::text" % (q(B), js(LEDGERS), js(GROUPS)))
    r = j(day(["g1", "g2", "g3"], 3))
    ok(r.get("ok") and r.get("marked") == 0 and "refused" not in r and db.one("select count(*) from tally_vouchers where book_id = %s and deleted_at is null" % q(B)) == "3", "9. a full day of 3 entries loaded (%s)" % r)
    r = j(day(["g1", "g2"], 3, alter=6))
    ok(r.get("refused") == "short read: 2 of 3" and r.get("marked") == 0 and vrow("g3")["deleted_at"] == "" and r.get("sent") == 2, "9. 2 entries of a day of 3: refused 'short read: 2 of 3', nothing marked (%s)" % r)
    ok(vrow("g1")["alter_id"] == "1" and db.one("select count(*) from tally_vouchers where book_id = %s" % q(B)) == "3", "9. what came was still upserted; no entry removed")
    r = j("select tally_ingest_day(%s, %s, '[]'::jsonb, '[]'::jsonb, 0, 7, 10)::text" % (q(B), q(DAY)))
    ok(r.get("refused") == "short read: 0 of 0" and r.get("marked") == 0 and db.one("select count(*) from tally_vouchers where book_id = %s and deleted_at is null" % q(B)) == "3", "9. an empty file marks nothing (%s)" % r.get("refused"))
    r = j(day(["g1", "g2"], 2, alter=8))
    ok("refused" not in r and r.get("marked") == 1 and vrow("g3")["deleted_at"] != "" and vrow("g1")["deleted_at"] == "", "9. a full file of 2 (the bridge counted 2): the missing g3 marked deleted, kept (%s)" % r)
    ok(db.one("select coalesce(sum(amount), 0) from tally_ledger_day where book_id = %s and ledger = 'Rent'" % q(B)) in ("0", "0.00"), "9. the day cache follows: Rent nil (g3 marked)")
    for fn in ("tally_post_ids_sync()", "tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer)"):
        d = db.one("select pg_get_functiondef(%s::regprocedure)" % q("public." + fn))
        ok("SECURITY DEFINER" in d and "pg_temp" in d, "%s: security definer, search_path public, pg_temp" % fn.split("(")[0])
    ok(db.one("select has_function_privilege('authenticated', 'tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer)', 'execute')") == "f", "a member cannot call tally_ingest_day")
    r = psql_file(M38); ok(r.returncode == 0 and counts()["tally_vouchers"] == 3, "migration-38 runs a third time over used tables %s" % ((r.stderr or "").strip()[-300:] if r.returncode else ""))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
