"""python3 run_migration40.py - migration-40-states-carried (03-Oct-2026, round 11). Staging's order on a throwaway PostgreSQL
(pg_stand): 32 -> 33 -> 35 -> 34 (as first run on staging) -> 36b -> 37 -> 36 -> 38 -> 39, made-up rows, then 40 twice.
Checks: (1) a rename copies the per-ledger items of map, ledInfo, gstins, pans AND states to the new name (string- and
object-valued alike), the old item's data byte-identical and `carried` = {to, at}; the clash rule; (2) tally_ledgers.state;
(3) tally_post_result_taken with tally_post_result_confirmed as its wrapper, tally_post_job_accepted and tally_post_ids_sync
calling it, the 36b / 38 / 39 behaviour unchanged; (4) owner's item 5: a re-read of an entry whose version row has no
lines writes the lines (both tally_ingest_day forms); the file runs twice."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql", "migration-39-rename-map-empty-day.sql")]
M40 = os.path.join(SQLDIR, "migration-40-states-carried.sql")
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
    counts = lambda: {t: int(db.one("select count(*) from %s" % t)) for t in ["tally_vouchers", "tally_lines", "tally_voucher_versions", "tally_post_ids", "tally_post_jobs", "tally_ledgers", "client_book_items"]}
    # the ledgers and a day of entries (37's made-up rows), the saved choices of Alpha Traders (string- and object-valued items)
    j("select tally_ingest_ledgers_g(%s, '2026-04-01', '2026-03-31', %s, %s)::text" % (q(B), js(LEDGERS + [["Alpha Traders", "Sundry Debtors", "0"], ["Beta Traders", "Sundry Debtors", "0"]]), js(GROUPS + GROUPS40)))
    db.sql("update tally_ledgers set tally_guid = 'g-alpha' where book_id = %s and name = 'Alpha Traders'; update tally_ledgers set tally_guid = 'g-beta' where book_id = %s and name = 'Beta Traders';" % (q(B), q(B)))
    r = j(day(["g1", "g2", "g3"], 3)); ok(r.get("marked") == 0 and db.one("select count(*) from tally_voucher_versions where book_id = %s and lines is not null" % q(B)) == "3", "(a day of 3 entries loaded; every version row has its lines)")
    ITEMS = [("map", {"kind": "party", "side": "", "ok": True}), ("ledInfo", {"seen": 2, "last": "2026-05-01"}), ("pans", "AABCF1234K"), ("gstins", "09AABCF1234K1Z5"), ("states", "Uttar Pradesh")]
    for k, v in ITEMS: db.sql("insert into client_book_items (firm_id, client_id, key, item, data) values (%s, 'c1', %s, '.Alpha Traders', %s);" % (q(F), q(k), q(json.dumps(v))))
    db.sql("insert into client_book_items (firm_id, client_id, key, item, data) values (%s, 'c1', 'map', '.Gamma Co', '{\"kind\": \"party\", \"ok\": false}');" % q(F))
    before = counts(); old_data = {k: db.one("select data::text from client_book_items where firm_id = %s and client_id = 'c1' and key = %s and item = '.Alpha Traders'" % (q(F), q(k))) for k, _ in ITEMS}
    for i in (1, 2):
        r = psql_file(M40); ok(r.returncode == 0, "migration-40 runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if r.returncode: raise SystemExit("cannot go on without the migration")
    ok(counts() == before, "nothing deleted by the migration")
    body = open(M40).read().lower(); code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
    ok(not any(w in code for w in ["drop table", "drop view", "drop function", "drop trigger", "drop policy", "drop column", "drop constraint", "delete from"]) and code.strip().startswith("begin;") and code.strip().endswith("commit;"), "the file drops and deletes nothing; one transaction")
    ok("tally_ingest_day" not in code, "the file does not touch tally_ingest_day (39's day part may be applied before or after it)")
    cols = {(r["t"], r["c"]) for r in db.rows("select table_name as t, column_name as c from information_schema.columns where (table_name, column_name) in (('client_book_items', 'carried'), ('tally_ledgers', 'state'))")}
    ok(cols == {("client_book_items", "carried"), ("tally_ledgers", "state")}, "1/2. client_book_items.carried and tally_ledgers.state added")
    # ---- 1. the rename carries every item, data untouched, the mark in carried
    r = j("select tally_ledger_rename(%s, 'g-alpha', 'Alpha Traders', 'Alpha Traders Ltd')::text" % q(B))
    ok(r.get("renamed") and (r.get("carried") or {}).get("items") == 5, "1. renamed; 5 items carried: map, ledInfo, pans, gstins, states (%s)" % r.get("carried"))
    for k, v in ITEMS:
        new, old = item(k, "Alpha Traders Ltd"), item(k, "Alpha Traders")
        ok(new and json.loads(new["d"]) == v and new["deleted"] == "f" and (new["c"] or "") == "", "1. %s: the new-name item holds the same %s value, no carried mark" % (k, "string" if isinstance(v, str) else "object"))
        ok(old and old["d"] == old_data[k] and old["deleted"] == "f" and json.loads(old["c"] or "{}").get("to") == "Alpha Traders Ltd" and json.loads(old["c"] or "{}").get("at"), "1. %s: the old item's data byte-identical (%s), kept, carried = {to, at}" % (k, old["d"][:40]))
    # the clash: both names have a map item: the new name's stands
    db.sql("update tally_ledgers set tally_guid = null where book_id = %s and name = 'Gamma Co'" % q(B)) if db.one("select count(*) from tally_ledgers where book_id = %s and name = 'Gamma Co'" % q(B)) != "0" else db.sql("insert into tally_ledgers (book_id, firm_id, name, parent, open) values (%s, %s, 'Gamma Co', 'Sundry Debtors', 0)" % (q(B), q(F)))
    r = j("select tally_ledger_rename(%s, 'g-beta', 'Beta Traders', 'Gamma Co')::text" % q(B))
    db.sql("insert into client_book_items (firm_id, client_id, key, item, data) values (%s, 'c1', 'map', '.Beta Two', '{\"kind\": \"party\", \"ok\": true}');" % q(F))
    ok(r.get("merged") and "map" not in (r.get("carried") or {}).get("clash", []), "(Beta had no items: nothing to clash yet)")
    r = j("select tally_ledger_rename(%s, 'g-beta', 'Gamma Co', 'Beta Two')::text" % q(B))
    gm = item("map", "Beta Two")
    ok(r.get("renamed") and "map" in (r.get("carried") or {}).get("clash", []) and json.loads(gm["d"]).get("ok") is True and json.loads(item("map", "Gamma Co")["c"] or "{}").get("to") == "Beta Two", "1. a clash (both names mapped): the new name's item stands, the old marked carried, the clash said (%s)" % r.get("carried"))
    # ---- 3. the name: tally_post_result_taken, the old name a wrapper; the rules unchanged
    ok(db.one("select tally_post_result_taken('{\"state\": \"in_tally\"}'::jsonb)") == "t" and db.one("select tally_post_result_confirmed('{\"verified\": true}'::jsonb)") == "t" and db.one("select tally_post_result_taken('{\"state\": \"failed\"}'::jsonb)") == "f", "3. tally_post_result_taken; tally_post_result_confirmed answers the same")
    ok("tally_post_result_taken" in db.one("select pg_get_functiondef('tally_post_result_confirmed'::regproc)") and "tally_post_result_taken" in db.one("select pg_get_functiondef('tally_post_job_accepted'::regproc)") and "tally_post_result_taken" in db.one("select pg_get_functiondef('tally_post_ids_sync'::regproc)"), "3. the wrapper, tally_post_job_accepted and tally_post_ids_sync call the new name")
    db.sql(job(J(1), ["K1", "K2", "K3"]))
    db.sql("update tally_post_jobs set results = %s, items = %s where id = %s" % (js([{"id": "K1", "ok": True, "verified": True, "state": "in_tally"}, {"id": "K2", "ok": False, "message": "refused"}, {"id": "K3", "ok": False, "accepted": True, "lastVchId": "26500"}]), js([{"id": "K1", "state": "in_tally"}, {"id": "K2", "state": "failed", "reason": "refused"}, {"id": "K3", "state": "unknown"}]), q(J(1))))
    ok(db.one("select tally_post_job_accepted(%s::uuid, results, items) from tally_post_jobs where id = %s" % (q(J(1)), q(J(1)))) == "K3", "3. 36b's rule as before: the accepted-unconfirmed K3 alone blocks a re-send (the confirmed K1 does not)")
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(1)))
    ok(live(J(1), "K1") == "t" and live(J(1), "K2") == "f" and live(J(1), "K3") == "t", "3. 39's rule as before: the confirmed K1 and the accepted K3 stay live, the refused K2 is freed")
    try: db.sql("update tally_post_jobs set status = 'waiting' where id = %s" % q(J(1))); ok(False, "Retry went through")
    except RuntimeError as e: ok("K3" in str(e) and "K1" not in str(e).split("accepted")[1][:40], "3. the resend guard as before (K3 named, not K1)")
    # ---- 4. owner's item 5: a version row without lines (as the rows from before migration 37; the append-only trigger lets
    # an insert through, never a blanking) gets them on the next read of the entry
    def strip_version(alter):
        db.sql("insert into tally_voucher_versions (book_id, firm_id, tally_guid, alter_id, payload) values (%s, %s, 'g1', %d, '{\"guid\": \"g1\"}'); update tally_vouchers set alter_id = %d where book_id = %s and guid = 'g1';" % (q(B), q(F), alter, alter, q(B)))
    def day_g1(alter, extra=""):
        vs = [dict(G["g1"][0][0], alter=alter)] + G["g2"][0] + G["g3"][0]; ls = sum((G[k][1] for k in ("g1", "g2", "g3")), [])
        return "select tally_ingest_day(%s, %s, %s, %s, 3, %d, 1000%s)::text" % (q(B), q(DAY), js(vs), js(ls), alter + 10, extra)
    strip_version(5)
    ok(db.one("select lines is null from tally_voucher_versions where book_id = %s and tally_guid = 'g1' and alter_id = 5" % q(B)) == "t", "(g1's current version row, AlterID 5, has no lines)")
    j(day_g1(5))
    ok(db.one("select lines is not null and jsonb_array_length(lines) = 2 from tally_voucher_versions where book_id = %s and tally_guid = 'g1' and alter_id = 5" % q(B)) == "t", "4. re-read through the 7-argument tally_ingest_day: the version row has its 2 lines")
    has8 = db.one("select count(*) from pg_proc where proname = 'tally_ingest_day' and pronargs = 8") == "1"
    if has8:
        strip_version(6); j(day_g1(6, ", false"))
        ok(db.one("select lines is not null from tally_voucher_versions where book_id = %s and tally_guid = 'g1' and alter_id = 6" % q(B)) == "t", "4. and through the 8-argument form (39's day part applied here)")
    else: print("  note: the 8-argument tally_ingest_day is not here (39's day part not applied): the 7-argument check stands")
    for fn, args in [("tally_ledger_carry_choices", "uuid, text, text"), ("tally_post_job_accepted", "uuid, jsonb, jsonb"), ("tally_post_ids_sync", "")]:
        d = db.one("select pg_get_functiondef(%s::regprocedure)" % q("public.%s(%s)" % (fn, args)))
        ok("SECURITY DEFINER" in d and "pg_temp" in d, "%s: security definer, search_path public, pg_temp" % fn)
    k = counts(); r = psql_file(M40); ok(r.returncode == 0 and counts() == k, "migration-40 runs a third time over used tables")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
