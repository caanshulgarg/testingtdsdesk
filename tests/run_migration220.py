"""python3 tests/run_migration220.py - FinCom Books P1 (server/fincom-books/migration-220-fincom-books.sql) on a throwaway
PostgreSQL (pg_stand), with made-up books from tests/fbooks_fixture.mjs (node) loaded into a stand-in of the cloud copy.
  1. it stops when the copy's tables are not there, and on a name already used by something else (nothing changed);
     it runs, and runs again
  2. grants: nothing for public or anon; members read through RLS and call the readers; the service role runs the
     catch-up and the tie-out; NOBODY inserts, changes or deletes a fb_* row directly (service_role included)
  3. fb_enroll: the owner only; masters (Tally's 28 groups with Schedule III codes, the user's sub-groups, ledgers with
     GSTIN / PAN / state); openings at the window's start carry the older year exactly (D20); the build
  4. the mirror equals the copy: every ledger's balance (a debit positive: the copy's sign negated), voucher counts,
     bill-wise references, cost-centre splits; optional = memo, cancelled kept with its number, the unbalanced entry
     held and named, the entry with no lines a memo; the tie-out is in step except for the held entry
  5. SAME TRANSACTION: a write to the copy that commits has its FinCom Books rows at once; one that rolls back leaves
     nothing; a change makes version 2 (version 1's lines kept); a deletion cancels (number kept); a ledger rename makes
     a new version; an older-year change moves the openings; a mirror failure never fails the copy's write (logged,
     "Not in step")
  6. Dr = Cr and the other commit rules, by the database: unbalanced, one line, cost centres or bill refs off by a paisa
     all refused, even for a superuser's direct insert; a balanced one goes in
  7. the edit log: a row for every change, chained; UPDATE / DELETE / TRUNCATE refused for everyone; a corrupted row
     is named by its seq; a trigger switched off turns the book read-only at the self-check
  8. D3: a posted own voucher changes only as a new version with a reason (the version before kept); no hard delete
  9. the tie-out: a missed change in the copy is found and named by group and amount ("Not in step", since when);
     D18: the filing warning warns and never blocks; D7: an opening difference keeps the book Not in step until the
     owner signs it off; the TODO hook for Tally's own group closings compares when figures are put; D19: a 'sent'
     entry is out of every total and listed
 10. RLS: another firm sees nothing; a book that names its people (fb_grants) is hidden from staff not named
 11. the readers: the trial balance ties and equals the copy; a ledger's running balance and closing; the day book
 12. the review of 23-Nov-2026: a re-run of 220 takes no lock that stops the copy's writes; a landing trigger that cannot
     look at fb_books never fails the copy's write (the catch-up's sweep finds the change); the flush waits at most 2 s;
     a big statement is left to the catch-up; a no-change update notes nothing; the mirror's actor label does not leak
PG_PORT (55620). FB_BIG=n also mirrors a book of n made-up vouchers and times it."""
import os, sys, json, time, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
MIG = os.path.join(HERE, "..", "server", "fincom-books", "migration-220-fincom-books.sql")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
def err(fn):
    try: fn(); return ""
    except RuntimeError as e: return str(e)

from fbooks_stand import F1, F2, OWN, STAFF, OTHER, TB1, COPY, load_sql, books
VIEW = "aaaaaaaa-0000-0000-0000-000000000004"   # a look-only member of the firm

db = pg_stand.start(int(os.environ.get("PG_PORT") or 55620))
try:
    mig = open(MIG).read()
    # 1. the guard
    e = err(lambda: db.sql(mig))
    ok("tally_bills is not here" in e or "is not here" in e, "1. without the copy's tables: stops, saying so (%s)" % e.strip().splitlines()[-1][:90])
    db.sql(COPY)
    db.sql("""insert into firms values ('%s', 'Sample & Co'), ('%s', 'Other Firm');
      insert into members (user_id, firm_id, name, role) values ('%s', '%s', 'Owner', 'owner'), ('%s', '%s', 'Staff', 'staff'), ('%s', '%s', 'Other', 'owner'), ('%s', '%s', 'Viewer', 'viewer');
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('%s', '%s', 'c1', 'Demo Books Pvt Ltd (made up)', '2024-04-01', '2024-04-01');
      grant select on firms, members to authenticated;""" % (F1, F2, OWN, F1, STAFF, F1, OTHER, F2, VIEW, F1, TB1, F1))
    db.sql("create function fb_tb(p int) returns int language sql as 'select 1'")
    e = err(lambda: db.sql(mig))
    ok("function fb_tb" in e and db.one("select to_regclass('public.fb_books')") in (None, ""), "1. a same-named function made by something else: stops naming it, nothing made")
    db.sql("drop function fb_tb(int)")
    db.sql("create function zz_other_trg() returns trigger language plpgsql as 'begin return null; end'; create trigger fb_land_u after update on tally_lines for each statement execute function zz_other_trg();")
    e = err(lambda: db.sql(mig))
    ok("trigger fb_land_u on tally_lines" in e and db.one("select to_regclass('public.fb_books')") in (None, ""), "1. a trigger named like the mirror's (fb_land_u) on a landing table, made by something else: stops naming it")
    db.sql("drop trigger fb_land_u on tally_lines; drop function zz_other_trg();")
    db.sql("create index fb_tieouts_book on tally_groups (name)")
    e = err(lambda: db.sql(mig))
    ok("index fb_tieouts_book" in e and db.one("select to_regclass('public.fb_books')") in (None, ""), "1. an index name already used elsewhere: stops naming it")
    db.sql("drop index fb_tieouts_book")
    db.sql(mig); db.sql(mig)
    ok(True, "1. runs, and runs again")
    db.sql(open(MIG.replace("fincom-books.sql", "cron.sql")).read())
    ok(True, "1. the cron part runs where pg_cron is not there (it schedules nothing and says so)")
    n_tables = int(db.one("select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and obj_description(oid, 'pg_class') = 'fincom books (migration 220)'"))
    ok(n_tables == 29, "1. 29 tables, each marked as FinCom Books' (%d)" % n_tables)

    # 2. grants
    priv = lambda role, t, p: db.one("select has_table_privilege('%s', 'public.%s', '%s')" % (role, t, p)) == "t"
    fx = lambda role, f: db.one("select has_function_privilege('%s', '%s', 'execute')" % (role, f)) == "t"
    T = ["fb_books", "fb_vouchers", "fb_lines", "fb_audit_log", "fb_ledgers", "fb_bill_refs", "fb_tieouts"]
    ok(not any(priv(r, t, p) for r in ("anon", "public") if r != "public" for t in T for p in ("select", "insert", "update", "delete")), "2. anon: no right on any fb_* table")
    ok(all(priv("authenticated", t, "select") or (t == "fb_audit_log" and db.one("select has_any_column_privilege('authenticated', 'public.fb_audit_log', 'select')") == "t") for t in T) and not any(priv(r, t, p) for r in ("authenticated", "service_role") for t in T for p in ("insert", "update", "delete", "truncate")),
       "2. members and the service role read; nobody inserts, changes, deletes or empties a fb_* table directly")
    ok(fx("authenticated", "fb_tb(uuid, date)") and fx("authenticated", "fb_enroll(text)") and not fx("anon", "fb_tb(uuid, date)") and not fx("authenticated", "fb_mirror_catchup(uuid, integer)")
       and not fx("authenticated", "fb_tieout_all()") and fx("service_role", "fb_tieout_all()") and not fx("authenticated", "fb_mirror_voucher(uuid, text)") and not fx("service_role", "fb_mirror_voucher(uuid, text)")
       and not fx("anon", "fb_flush()") and not fx("authenticated", "fb_source_figures_put(uuid, text, date, jsonb, text)"),
       "2. members call the readers and fb_enroll; the service role the catch-up and the tie-out; the builder's parts nobody")
    e = err(lambda: db.sql("set role service_role; insert into fb_books (firm_id, client_id, source) values ('%s', 'c1', 'own');" % F1))
    ok("permission denied" in e, "2. the service role cannot insert a book directly")
    colp = lambda c: db.one("select has_column_privilege('authenticated', 'public.fb_audit_log', '%s', 'select')" % c) == "t"
    ok(colp("seq") and colp("after") and not colp("client_info") and fx("authenticated", "fb_audit_client_info(uuid, bigint, integer)"),
       "2. members read the edit log but not its client_info (IP, browser); the owner reads that through fb_audit_client_info")
    ok(not fx("authenticated", "fb_mirror_catchup_run(integer)") and not fx("service_role", "fb_mirror_catchup_run(integer)"), "2. the catch-up's runner (commits book by book) is for the timer only")

    # 3. enroll (before the copy has entries: only masters) - then load the made-up books
    B = books(int(os.environ.get("FB_N") or 400), 7)
    db.sql(load_sql(TB1, F1, B))
    as_ = lambda uid, q: db.sql("set role authenticated;\n" + q, uid)
    one = lambda uid, q: db.one("set role authenticated;\n" + q, uid)
    stv = json.loads(one(VIEW, "select fb_status('c1')")); sts = json.loads(one(STAFF, "select fb_status('c1')"))
    ok(sts["can_set_up"] is True and stv["can_set_up"] is False, "3. fb_status says who may set it up: staff yes, a look-only member no")
    e = err(lambda: as_(VIEW, "select fb_enroll('c1')"))
    ok("cannot set up" in e, "3. a look-only member cannot set up FinCom Books (%s)" % e.strip().splitlines()[-1][:80])
    e = err(lambda: as_(OTHER, "select fb_enroll('c1')"))
    ok("no books" in e, "3. another firm's owner finds no such client's books")
    t0 = time.time()
    r = json.loads(one(STAFF, "select fb_enroll('c1')"))
    BK = r["books"][0]["book"]
    ok(r["books"][0]["built"]["left"] == 0, "3. staff set it up (owner decision 23-Nov-2026); %d entries built in %.1f s, none left" % (r["books"][0]["built"]["done"], time.time() - t0))
    q = lambda s: db.rows(s.replace("BK", BK))
    g = {x["name"]: x for x in q("select name, reserved, primary_name, nature, sch3_code, is_system from fb_groups where book_id = 'BK'")}
    ok(len([x for x in g.values() if x["is_system"] == "t"]) == 28 and g["Sundry Debtors"]["sch3_code"] == "CA.TR" and g["Debtors - North"]["reserved"] == "Sundry Debtors"
       and g["Debtors - North"]["sch3_code"] == "CA.TR" and g["Debtors - North"]["primary_name"] == "Current Assets" and g["Office Expenses"]["sch3_code"] == "PL.OTH"
       and g["Sundry Creditors"]["nature"] == "liability", "3. Tally's 28 groups with Schedule III codes; a user's sub-group takes its reserved group's code and its primary")
    led = {x["name"]: x for x in q("select l.name, l.kind, l.gstin, l.state_code, l.pan, g.name as grp from fb_ledgers l left join fb_groups g on g.id = l.group_id where l.book_id = 'BK'")}
    ok(led["Alpha Demo Stores"]["kind"] == "party" and led["Alpha Demo Stores"]["state_code"] == "27" and led["Alpha Demo Stores"]["grp"] == "Debtors - North"
       and led["Demo Bank Current A/c"]["kind"] == "bank" and led["Zeta Sample Supplies"]["pan"].startswith("ZZZPZ") and led["Output CGST"]["kind"] == "tax",
       "3. ledgers: kind from the group, GSTIN, state code from the GSTIN, PAN")
    mf = db.one("select mirror_from from fb_books where book_id = '%s'" % BK)
    ok(mf == "2025-04-01", "3. D20: mirrored from the previous financial year's start (%s)" % mf)
    # openings: Tally's opening + every older entry, negated
    o = q("""select g.name, o.amount, (select -(t.open + coalesce((select sum(l.amount) from tally_vouchers v join tally_lines l on l.book_id = v.book_id and l.guid = v.guid
             where v.book_id = '%s' and l.ledger = t.name and v.day < '2025-04-01' and not v.cancelled and not v.optional and v.deleted_at is null), 0)) from tally_ledgers t where t.book_id = '%s' and t.name = g.name) as want
             from fb_openings o join fb_ledgers g on g.id = o.ledger_id where o.book_id = 'BK'""" % (TB1, TB1))
    bad_o = [x for x in o if float(x["amount"]) != float(x["want"] or 0)]
    ok(len(o) > 5 and not bad_o and any(x["name"] == "Owner Capital" and x["amount"] == "-255000.00" for x in o),
       "3. openings at 01-Apr-2025 = Tally's opening plus the older year's entries, a debit positive (%d ledgers)%s" % (len(o), bad_o[:3]))

    # 4. the mirror equals the copy
    cmp = q("""with c as (select l.ledger, -sum(l.amount) a from tally_vouchers v join tally_lines l on l.book_id = v.book_id and l.guid = v.guid
                 where v.book_id = '%s' and v.day >= '2025-04-01' and not v.cancelled and not v.optional and v.deleted_at is null and v.vno <> 'J/ODD-1' group by 1),
               f as (select g.name ledger, sum(l.amount) a from fb_lines l join fb_vouchers v on v.id = l.voucher_id and v.version = l.version join fb_ledgers g on g.id = l.ledger_id
                 where v.book_id = 'BK' and v.status = 'posted' and not v.memo group by 1)
               select count(*) filter (where coalesce(c.a, 0) <> coalesce(f.a, 0)) bad, count(*) n from c full join f on f.ledger = c.ledger""" % TB1)[0]
    ok(cmp["bad"] == "0" and int(cmp["n"]) > 15, "4. every ledger's movement equals the copy's, sign negated (%s ledgers)" % cmp["n"])
    st = {x["number"]: x for x in q("select number, status, memo, mirror_note, cancel_reason from fb_vouchers where book_id = 'BK' and number in ('J/OPT-1', 'PY/CAN-1', 'J/ODD-1', 'DN-1')")}
    ok(st["J/OPT-1"]["memo"] == "t" and st["J/OPT-1"]["status"] == "posted" and "optional" in st["J/OPT-1"]["mirror_note"]
       and st["PY/CAN-1"]["status"] == "cancelled" and st["PY/CAN-1"]["cancel_reason"] == "cancelled in Tally"
       and st["J/ODD-1"]["status"] == "held" and "₹0.01" in st["J/ODD-1"]["mirror_note"] and st["DN-1"]["memo"] == "t",
       "4. optional = memo; cancelled kept with its number; the unbalanced one held ('%s'); no lines = memo" % st["J/ODD-1"]["mirror_note"])
    nb = q("select (select count(*) from tally_bills where book_id = '%s' and day >= '2025-04-01') c, (select count(*) from fb_bill_refs where book_id = 'BK') f, (select count(*) from tally_cost_allocs where book_id = '%s' and day >= '2025-04-01') cc, (select count(*) from fb_line_cc where book_id = 'BK') fcc,"
           " (select count(*) from fb_bill_refs where book_id = 'BK' and ref_type = 'against') ag, (select count(*) from fb_bill_refs r where book_id = 'BK' and ref_type = 'new' and due_date is not null) nw" % (TB1, TB1))[0]
    ok(nb["c"] == nb["f"] and nb["cc"] == nb["fcc"] and int(nb["ag"]) > 0 and int(nb["nw"]) > 0, "4. bill-wise references (%s, new with due dates, against) and cost-centre splits (%s) all mirrored" % (nb["f"], nb["fcc"]))
    ccsum = q("select count(*) bad from (select l.voucher_id, l.line_no, l.amount, sum(c.amount) s from fb_lines l join fb_line_cc c using (voucher_id, version, line_no) where l.book_id = 'BK' group by 1, 2, 3 having sum(c.amount) <> l.amount) z")[0]
    ok(ccsum["bad"] == "0", "4. each cost-centre split adds up to its line")
    tie = json.loads(db.one("set role service_role; select fb_tieout('%s', 'build')" % BK))
    ok(not tie["in_step"] and "held" in tie["words"] and tie["source_read"] is False,
       "4. the tie-out: Not in step only for the held entry ('%s'); Tally's own figures not read yet" % tie["words"])
    kinds = {x["kind"] for x in json.loads(db.one("select differences from fb_tieouts where id = %s" % tie["id"]))}
    ok(kinds == {"ledger_day", "held"}, "4. its differences are the held entry's day and the entry itself (%s)" % sorted(kinds))

    # 5. the same transaction
    N0 = int(db.one("select count(*) from fb_vouchers where book_id = '%s'" % BK))
    # what tally-ingest does for a day: delete the day's lines and bills, upsert the entries, insert again, in one transaction
    ingest = lambda body: db.sql("begin;\n" + body + "\ncommit;")
    ingest("""insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party) values ('%s', '%s', 'g-new-1', '2026-11-21', 90001, 'Sales', 'S/9001', 'Alpha Demo Stores');
      insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values ('%s', '%s', 'g-new-1', '2026-11-21', 'Alpha Demo Stores', -1180), ('%s', '%s', 'g-new-1', '2026-11-21', 'Sales @ 18%%', 1000),
        ('%s', '%s', 'g-new-1', '2026-11-21', 'Output CGST', 90), ('%s', '%s', 'g-new-1', '2026-11-21', 'Output SGST', 90);
      insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due) values ('%s', '%s', 'g-new-1', '2026-11-21', 'Alpha Demo Stores', 'S/9001', 'New Ref', -1180, '2026-11-21', 30, '2026-12-21');""" % ((TB1, F1) * 6))
    v = q("select id, version, status, number, source_alter from fb_vouchers where book_id = 'BK' and source_ref = 'g-new-1'")
    ok(len(v) == 1 and v[0]["status"] == "posted" and v[0]["version"] == "1" and v[0]["source_alter"] == "90001", "5. a new entry written to the copy is in FinCom Books when the transaction commits")
    VID = v[0]["id"]
    ok(db.one("select count(*) from fb_audit_log where voucher_id = '%s' and actor_kind = 'system:mirror'" % VID) == "6", "5. ... with its edit-log rows (the voucher, its four lines, its bill), by the mirror")
    db.sql("begin; insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno) values ('%s', '%s', 'g-rolled', '2026-11-21', 90002, 'Journal', 'J/RB'); rollback;" % (TB1, F1))
    ok(db.one("select count(*) from fb_vouchers where source_ref = 'g-rolled'") == "0", "5. a write that rolls back leaves nothing in FinCom Books")
    ingest("""update tally_vouchers set alter_id = 90010, narration = 'changed in Tally (made up)' where book_id = '%s' and guid = 'g-new-1';
      delete from tally_lines where book_id = '%s' and guid = 'g-new-1';
      insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values ('%s', '%s', 'g-new-1', '2026-11-21', 'Alpha Demo Stores', -2360), ('%s', '%s', 'g-new-1', '2026-11-21', 'Sales @ 18%%', 2000),
        ('%s', '%s', 'g-new-1', '2026-11-21', 'Output CGST', 180), ('%s', '%s', 'g-new-1', '2026-11-21', 'Output SGST', 180);""" % (TB1, TB1, TB1, F1, TB1, F1, TB1, F1, TB1, F1))
    v = q("select version, edit_reason from fb_vouchers where id = '%s'" % VID)[0]
    keep = q("select version, sum(amount) filter (where amount > 0) dr from fb_lines where voucher_id = '%s' group by 1 order by 1" % VID)
    ok(v["version"] == "2" and "AlterID 90001 to 90010" in v["edit_reason"] and [x["dr"] for x in keep] == ["1180.00", "2360.00"]
       and db.one("select (snapshot->>'version') from fb_voucher_versions where voucher_id = '%s'" % VID) == "1",
       "5. a change in Tally makes version 2 ('%s'); version 1 and its lines are kept" % v["edit_reason"])
    ingest("update tally_vouchers set deleted_at = now() where book_id = '%s' and guid = 'g-new-1';" % TB1)
    v = q("select status, number, cancel_reason, source_gone from fb_vouchers where id = '%s'" % VID)[0]
    ok(v["status"] == "cancelled" and v["number"] == "S/9001" and v["cancel_reason"] == "deleted in Tally" and v["source_gone"] == "t", "5. deleted in Tally: cancelled here, number kept, nothing removed")
    ingest("update tally_vouchers set deleted_at = null, alter_id = 90011 where book_id = '%s' and guid = 'g-new-1';" % TB1)
    ok(q("select status, version, edit_reason from fb_vouchers where id = '%s'" % VID)[0]["edit_reason"] == "back in Tally", "5. back in Tally: posted again as a new version")
    # a rename in Tally (the copy's rename carries lines by name: tally_ledger_rename)
    ingest("""insert into tally_ledgers (book_id, firm_id, name, parent, open) values ('%s', '%s', 'Staff Welfare Exp', 'Indirect Expenses', 0);
      update tally_lines set ledger = 'Staff Welfare Exp' where book_id = '%s' and ledger = 'Staff Welfare';
      update tally_ledgers set merged_into = 'Staff Welfare Exp' where book_id = '%s' and name = 'Staff Welfare';""" % (TB1, F1, TB1, TB1))
    rn = q("select count(*) filter (where g.name = 'Staff Welfare Exp') n_new, count(*) filter (where g.name = 'Staff Welfare') n_old from fb_lines l join fb_vouchers v on v.id = l.voucher_id and v.version = l.version join fb_ledgers g on g.id = l.ledger_id where v.book_id = 'BK'")[0]
    ok(int(rn["n_new"]) > 0 and rn["n_old"] == "0" and db.one("select inactive from fb_ledgers where book_id = '%s' and name = 'Staff Welfare'" % BK) == "t",
       "5. a ledger renamed (merged) in Tally: its entries' new versions name the new ledger; the old one is inactive")
    # an older-year entry changes: the openings follow
    old = db.rows("select v.guid, l.ledger from tally_vouchers v join tally_lines l on l.book_id = v.book_id and l.guid = v.guid where v.book_id = '%s' and v.day < '2025-04-01' and v.vtype = 'Contra' limit 1" % TB1)[0]
    before = db.one("select o.amount from fb_openings o join fb_ledgers g on g.id = o.ledger_id where o.book_id = '%s' and g.name = 'Cash'" % BK)
    ingest("update tally_lines set amount = amount - 10 where book_id = '%s' and guid = '%s' and ledger = 'Cash'; update tally_lines set amount = amount + 10 where book_id = '%s' and guid = '%s' and ledger = 'Demo Bank Current A/c';" % (TB1, old["guid"], TB1, old["guid"]))
    after = db.one("select o.amount from fb_openings o join fb_ledgers g on g.id = o.ledger_id where o.book_id = '%s' and g.name = 'Cash'" % BK)
    ok(round(float(after) - float(before), 2) == 10.0, "5. an entry of the older year changed: the opening at 01-Apr-2025 moves with it (%s to %s)" % (before, after))
    # a mirror failure never fails the copy's write
    db.sql("alter table fb_vouchers add constraint test_break check (narration <> 'BREAK THE MIRROR')")
    ingest("update tally_vouchers set narration = 'BREAK THE MIRROR', alter_id = alter_id + 1 where book_id = '%s' and guid = '%s';" % (TB1, B["vouchers"][-5]["guid"]))
    ok(db.one("select narration from tally_vouchers where book_id = '%s' and guid = '%s'" % (TB1, B["vouchers"][-5]["guid"])) == "BREAK THE MIRROR"
       and db.one("select count(*) from fb_mirror_errors where book_id = '%s' and resolved_at is null" % BK) == "1"
       and db.one("select in_step from fb_books where book_id = '%s'" % BK) == "f",
       "5. the mirror fails on a change: the copy's write still commits; the failure is logged and the book is Not in step")
    ok(db.one("select count(*) from fb_mirror_dirty where txid <> 0") == "0" and db.one("select count(*) from fb_mirror_dirty where txid = 0 and book_id = '%s'" % BK) == "1",
       "5. ... the failed flush leaves no rows of its own behind; its entry is kept for the catch-up")
    db.sql("alter table fb_vouchers drop constraint test_break")
    r = json.loads(db.one("set role service_role; select fb_mirror_catchup('%s', 100)" % BK))
    ok(r["by"].get("changed") == 1 and db.one("select count(*) from fb_mirror_errors where book_id = '%s' and resolved_at is null" % BK) == "0", "5. the catch-up applies it later and clears the error")
    # review B1: a copy change WITHOUT a new AlterID (the copy's rename re-points lines, tally_ledger_rename) whose flush fails
    n_sw = int(db.one("select count(distinct guid) from tally_lines where book_id = '%s' and ledger = 'Staff Welfare Exp' and day >= '2025-04-01'" % TB1))
    db.sql("alter table fb_lines add constraint rv_once check (ledger_id > 0 and current_setting('rv.fail', true) is distinct from 'y')")
    ingest("""set local rv.fail = 'y'; insert into tally_ledgers (book_id, firm_id, name, parent, open) values ('%s', '%s', 'Staff Welfare Expenses', 'Indirect Expenses', 0);
      update tally_lines set ledger = 'Staff Welfare Expenses' where book_id = '%s' and ledger = 'Staff Welfare Exp';
      update tally_ledgers set merged_into = 'Staff Welfare Expenses' where book_id = '%s' and name = 'Staff Welfare Exp';""" % (TB1, F1, TB1, TB1))
    db.sql("alter table fb_lines drop constraint rv_once")
    ok(n_sw >= 2 and db.one("select count(*) from fb_mirror_errors where book_id = '%s' and resolved_at is null" % BK) == "1"
       and int(db.one("select count(*) from fb_mirror_dirty where txid = 0 and book_id = '%s' and kind = 'v'" % BK)) == n_sw,
       "5. B1: a rename in the copy (no new AlterID) whose flush fails: logged, and its %d entries kept for the catch-up" % n_sw)
    for _ in range(2): json.loads(db.one("set role service_role; select fb_mirror_catchup_all(5000)"))
    old_left = db.one("select count(*) from fb_lines l join fb_vouchers v on v.id = l.voucher_id and v.version = l.version join fb_ledgers g on g.id = l.ledger_id where v.book_id = '%s' and g.name = 'Staff Welfare Exp'" % BK)
    tie = json.loads(db.one("set role service_role; select fb_tieout('%s')" % BK))
    bad_days = [x for x in json.loads(db.one("select differences from fb_tieouts where id = %s" % tie["id"])) if x["kind"] == "ledger_day" and x.get("cause") != "held"]
    ok(old_left == "0" and not bad_days and db.one("select count(*) from fb_mirror_errors where book_id = '%s' and resolved_at is null" % BK) == "0"
       and db.one("select count(*) from fb_mirror_dirty") == "0",
       "5. B1: the catch-up re-mirrors them: no line on the old name, no ledger-day difference, the error cleared, nothing left (%s, %d)" % (old_left, len(bad_days)))
    # a cost-centre split on the second line of the same ledger lands on that line (tally_cost_allocs.line_no)
    ingest("""insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno) values ('%s', '%s', 'g-cc-2', '2026-11-21', 90020, 'Journal', 'J/CC2');
      insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values ('%s', '%s', 'g-cc-2', '2026-11-21', 'Office Rent', -100), ('%s', '%s', 'g-cc-2', '2026-11-21', 'Office Rent', -50), ('%s', '%s', 'g-cc-2', '2026-11-21', 'Cash', 150);
      insert into tally_cost_allocs (book_id, firm_id, guid, day, line_no, ledger, category, centre, amount) values ('%s', '%s', 'g-cc-2', '2026-11-21', 2, 'Office Rent', 'Primary Cost Category', 'Head Office', -30),
        ('%s', '%s', 'g-cc-2', '2026-11-21', 2, 'Office Rent', 'Primary Cost Category', 'Branch Pune', -20), ('%s', '%s', 'g-cc-2', '2026-11-21', 2, 'Office Rent', 'Departments', 'Admin', -50);""" % ((TB1, F1) * 7))
    ccl = db.rows("select l.amount, count(*) n, sum(c.amount) s from fb_line_cc c join fb_lines l using (voucher_id, version, line_no) join fb_vouchers v on v.id = c.voucher_id where v.source_ref = 'g-cc-2' group by 1")
    ok([(x["amount"], x["n"], x["s"]) for x in ccl] == [("50.00", "3", "100.00")], "5. a split given for the copy's line 2 lands on that line (Office Rent 50, two categories), not on the ledger's first line (%s)" % ccl)

    # 6. Dr = Cr and the commit rules (own entries, as a posting function would write them; here a superuser, directly)
    db.sql("insert into fb_books (book_id, firm_id, client_id, source, mirror_from, state) values ('cccccccc-0000-0000-0000-000000000001', '%s', 'c2', 'own', '2026-04-01', 'live')" % F1)
    OB = "cccccccc-0000-0000-0000-000000000001"
    db.sql("select fb_seed_book('%s'); insert into fb_ledgers (book_id, firm_id, name, kind) values ('%s', '%s', 'Own Cash', 'cash'), ('%s', '%s', 'Own Sales', 'income'), ('%s', '%s', 'Own Customer', 'party');" % (OB, OB, F1, OB, F1, OB, F1))
    L = {x["name"]: x["id"] for x in db.rows("select name, id from fb_ledgers where book_id = '%s'" % OB)}
    cc1 = db.one("select fb_cc_id('%s', '', 'Head Office')" % OB)
    def own(no, lines, status="posted", cc=None, bills=None):
        s = "begin; insert into fb_vouchers (id, book_id, firm_id, fy, number, date, status, source) values ('%s', '%s', '%s', '2026-27', '%s', '2026-05-01', '%s', 'own');\n" % (no, OB, F1, no.split("-")[-1], status)
        for i, (l, a) in enumerate(lines, 1): s += "insert into fb_lines (voucher_id, version, line_no, book_id, firm_id, date, ledger_id, amount) values ('%s', 1, %d, '%s', '%s', '2026-05-01', %s, %s);\n" % (no, i, OB, F1, L[l], a)
        for c in (cc or []): s += "insert into fb_line_cc (voucher_id, version, line_no, part_no, book_id, firm_id, cost_centre_id, amount) values ('%s', 1, %d, %d, '%s', '%s', %s, %s);\n" % (no, c[0], len(s), OB, F1, c[2] if len(c) > 2 else cc1, c[1])
        for (ln, a) in (bills or []): s += "insert into fb_bill_refs (voucher_id, version, line_no, part_no, book_id, firm_id, party_ledger_id, ref_type, ref_name, amount) values ('%s', 1, %d, %d, '%s', '%s', %s, 'new', 'INV-1', %s);\n" % (no, ln, len(s), OB, F1, L["Own Customer"], a)
        return err(lambda: db.sql(s + "commit;"))
    U = "dddddddd-0000-0000-0000-00000000000"
    ok("does not balance" in own(U + "1", [("Own Cash", 100), ("Own Sales", -99.99)]), "6. Dr and Cr differ by a paisa: the commit is refused")
    ok("at least two lines" in own(U + "2", [("Own Cash", 0)]), "6. a voucher of one line: refused")
    ok("cost centres add up" in own(U + "3", [("Own Cash", 100), ("Own Sales", -100)], cc=[(1, 60), (1, 39.99)]), "6. cost-centre parts off by a paisa: refused")
    ok("bill references add up" in own(U + "4", [("Own Customer", 118), ("Own Sales", -118)], bills=[(1, 117.99)]), "6. bill references off by a paisa: refused")
    ok(own(U + "5", [("Own Customer", 118), ("Own Sales", -118)], cc=[(2, -100), (2, -18)], bills=[(1, 118)]) == "" and db.one("select count(*) from fb_vouchers where book_id = '%s'" % OB) == "1",
       "6. a balanced one with exact splits goes in; the refused ones left nothing")
    e = err(lambda: db.sql("begin; update fb_vouchers set status = 'posted' where id = '%s'; insert into fb_lines (voucher_id, version, line_no, book_id, firm_id, date, ledger_id, amount) values ('%s', 1, 9, '%s', '%s', '2026-05-01', %s, 5); commit;" % (U + "5", U + "5", OB, F1, L["Own Cash"])))
    ok("new version" in e, "6. a line added later to a posted voucher, same version: refused (only as a new version) (%s)" % e.strip().splitlines()[-1][:90])
    cc2 = db.one("select fb_cc_id('%s', 'Departments', 'Sales Dept')" % OB)
    ok(own(U + "6", [("Own Customer", 118), ("Own Sales", -118)], cc=[(2, -100), (2, -18), (2, -118, cc2)]) == "", "6. two cost categories on one line, each adding up to the line: goes in")
    ok("cost centres add up" in own(U + "7", [("Own Customer", 118), ("Own Sales", -118)], cc=[(2, -100), (2, -18), (2, -117.99, cc2)]), "6. one category off by a paisa (the other exact): refused")

    # 7. the edit log
    n_log = int(db.one("select count(*) from fb_audit_log"))
    ok(n_log > 1000, "7. %d edit-log rows, written by the database" % n_log)
    for who, pre in (("a superuser", ""), ("the service role", "set role service_role; "), ("a member", "set role authenticated; ")):
        e1 = err(lambda: db.sql(pre + "update fb_audit_log set reason = 'x' where seq = 1"))
        e2 = err(lambda: db.sql(pre + "delete from fb_audit_log where seq = 1"))
        e3 = err(lambda: db.sql(pre + "truncate fb_audit_log"))
        ok(all(e1 and e2 and e3 for _ in [0]), "7. %s cannot change, delete or empty the edit log" % who)
    vr = json.loads(db.one("select fb_audit_verify('%s')" % BK))
    ok(vr["ok"] and vr["checked"] > 500, "7. the chain verifies (%d rows)" % vr["checked"])
    sc = json.loads(db.one("set role service_role; select fb_selfcheck('%s')" % BK))
    ok(sc["ok"], "7. the daily self-check passes and writes the day's anchor (%s)" % sc["problems"])
    # tamper as a superuser who switches the guard off: the chain names the row
    seq = db.one("select seq from fb_audit_log where book_id = '%s' order by seq offset 40 limit 1" % BK)
    db.sql("alter table fb_audit_log disable trigger fb_audit_log_keep; update fb_audit_log set after = jsonb_set(after, '{amount}', '\"1.00\"') where seq = %s; alter table fb_audit_log enable trigger fb_audit_log_keep;" % seq)
    vr = json.loads(db.one("select fb_audit_verify('%s')" % BK))
    ok(not vr["ok"] and str(vr["bad_seq"]) == seq, "7. one row changed behind the guard's back: the chain check names it (seq %s)" % vr["bad_seq"])
    db.sql("alter table fb_vouchers disable trigger fb_audit")
    sc = json.loads(db.one("set role service_role; select fb_selfcheck('%s')" % BK))
    ok(not sc["ok"] and db.one("select state from fb_books where book_id = '%s'" % BK) == "read_only" and any("fb_vouchers" in p for p in sc["problems"]) and any("chain breaks" in p for p in sc["problems"]),
       "7. a trigger switched off: the self-check fails and the book turns read-only (%s)" % "; ".join(sc["problems"])[:140])
    db.sql("alter table fb_vouchers enable trigger fb_audit")
    for tbl, trg in (("fb_vouchers", "fb_vouchers_guard"), ("fb_lines", "fb_lines_guard"), ("fb_lines", "fb_keep"), ("fb_vouchers", "fb_check"), ("tally_lines", "fb_land_u")):
        db.sql("alter table %s disable trigger %s" % (tbl, trg))
        sc = json.loads(db.one("set role service_role; select fb_selfcheck('%s')" % BK))
        db.sql("alter table %s enable trigger %s" % (tbl, trg))
        ok(not sc["ok"] and any(trg + " on " + tbl in p for p in sc["problems"]), "7. %s on %s switched off: the self-check names it" % (trg, tbl))
    mv = db.rows("select id, narration from fb_vouchers where book_id = '%s' and status = 'posted' order by date limit 1" % BK)[0]
    db.sql("alter table fb_vouchers disable trigger fb_audit; alter table fb_vouchers disable trigger fb_vouchers_guard; update fb_vouchers set narration = 'changed behind the log' where id = '%s'; alter table fb_vouchers enable trigger fb_audit; alter table fb_vouchers enable trigger fb_vouchers_guard;" % mv["id"])
    sc = json.loads(db.one("set role service_role; select fb_selfcheck('%s')" % BK))
    ok(any("differ from the edit log" in p and "fb_vouchers" in p for p in sc["problems"]), "7. a row changed with the edit log's trigger off: the self-check finds it differs from the log's last record (%s)" % [p for p in sc["problems"] if "differ" in p])
    db.sql("alter table fb_vouchers disable trigger fb_audit; alter table fb_vouchers disable trigger fb_vouchers_guard; update fb_vouchers set narration = %s where id = '%s'; alter table fb_vouchers enable trigger fb_audit; alter table fb_vouchers enable trigger fb_vouchers_guard;" % ("'" + mv["narration"].replace("'", "''") + "'", mv["id"]))
    sc = json.loads(db.one("set role service_role; select fb_selfcheck('%s')" % BK))
    ok(not any("differ from the edit log" in p and "fb_vouchers" in p for p in sc["problems"]), "7. put back: no voucher differs from the log (the row whose log record was tampered above still does: %s)" % [p for p in sc["problems"] if "differ" in p])

    # 8. D3
    e = err(lambda: db.sql("update fb_vouchers set version = 2, narration = 'edited' where id = '%s'" % (U + "5")))
    ok("reason" in e, "8. a posted own voucher changed without a reason: refused")
    e = err(lambda: db.sql("update fb_vouchers set narration = 'quietly edited' where id = '%s'" % (U + "5")))
    ok("new version" in e, "8. changed in place (no new version): refused")
    db.sql("""begin; select set_config('fincom.fb_actor', 'member', true); update fb_vouchers set version = 2, narration = 'edited', edit_reason = 'wrong narration (made up)' where id = '%s';
      insert into fb_lines (voucher_id, version, line_no, book_id, firm_id, date, ledger_id, amount) values ('%s', 2, 1, '%s', '%s', '2026-05-01', %s, 118), ('%s', 2, 2, '%s', '%s', '2026-05-01', %s, -118); commit;"""
           % (U + "5", U + "5", OB, F1, L["Own Customer"], U + "5", OB, F1, L["Own Sales"]))
    lg = db.rows("select action, reason, version_from, version_to from fb_audit_log where voucher_id = '%s' and entity = 'fb_vouchers' order by seq" % (U + "5"))
    ok(db.one("select count(*) from fb_voucher_versions where voucher_id = '%s'" % (U + "5")) == "1" and lg[-1]["reason"] == "wrong narration (made up)" and lg[-1]["version_to"] == "2",
       "8. with a reason: version 2, version 1 kept whole, the reason in the edit log")
    e = err(lambda: db.sql("delete from fb_vouchers where id = '%s'" % (U + "5")))
    e2 = err(lambda: db.sql("delete from fb_lines where voucher_id = '%s'" % (U + "5")))
    ok("nothing is deleted" in e and "never changed" in e2, "8. no hard delete of a voucher or a line, even for a superuser")
    e = err(lambda: db.sql("update fb_vouchers set status = 'cancelled' where id = '%s'" % (U + "5")))
    ok("reason for cancelling" in e, "8. cancelling needs a reason")
    e = err(lambda: db.sql("update fb_vouchers set status = 'draft' where id = '%s'" % (U + "5")))
    ok("posted" in e and db.one("select status from fb_vouchers where id = '%s'" % (U + "5")) == "posted", "8. a posted voucher cannot go back to draft (%s)" % e.strip().splitlines()[-1][:80])

    # 9. the tie-out
    db.sql("update fb_books set state = 'live', read_only_why = '' where book_id = '%s'" % BK)   # (7 turned it read-only)
    db.sql("update tally_vouchers set narration = narration where false")
    # put the held entry right in Tally, then the copy and FinCom Books tie
    odd = db.one("select guid from tally_vouchers where book_id = '%s' and vno = 'J/ODD-1'" % TB1)
    ingest("update tally_lines set amount = -100 where book_id = '%s' and guid = '%s' and amount = -100.01; update tally_vouchers set alter_id = alter_id + 1 where book_id = '%s' and guid = '%s';" % (TB1, odd, TB1, odd))
    tie = json.loads(db.one("set role service_role; select fb_tieout('%s')" % BK))
    ok(tie["in_step"] and db.one("select not_in_step_since from fb_books where book_id = '%s'" % BK) in (None, ""), "9. the held entry put right in Tally: in step, to the paisa")
    # a change the mirror missed (written with the triggers off, as a fault would)
    gd = db.rows("select l.guid, l.day from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid where l.book_id = '%s' and l.ledger = 'Beta Sample Mart' and v.vtype = 'Sales' and v.day > '2025-06-01' limit 1" % TB1)[0]
    db.sql("begin; set local session_replication_role = replica; update tally_lines set amount = amount - 4200 where book_id = '%s' and guid = '%s' and ledger = 'Beta Sample Mart'; update tally_lines set amount = amount + 4200 where book_id = '%s' and guid = '%s' and ledger = 'Sales @ 18%%'; commit;" % (TB1, gd["guid"], TB1, gd["guid"]))
    tie = json.loads(db.one("set role service_role; select fb_tieout('%s')" % BK))
    bk = db.rows("select in_step, not_in_step_since, not_in_step_why from fb_books where book_id = '%s'" % BK)[0]
    ok(not tie["in_step"] and bk["not_in_step_why"].startswith("Sundry Debtors differs by ₹4,200.00") and bk["not_in_step_since"],
       "9. a change the mirror missed: Not in step, '%s'" % bk["not_in_step_why"])
    since = bk["not_in_step_since"]
    json.loads(db.one("set role service_role; select fb_tieout('%s')" % BK))
    ok(db.one("select not_in_step_since from fb_books where book_id = '%s'" % BK) == since, "9. checked again: 'since' stays the first time it was seen")
    fw = json.loads(one(STAFF, "select fb_filing_warning('c1', '2026-04-01', '2026-06-30')"))
    ok(fw["warn"] and fw["block"] is False and "You can still file" in fw["words"] and "₹4,200.00" in fw["words"], "9. D18: filing for the period WARNS and never blocks ('%s')" % fw["words"][:120])
    ok(json.loads(one(STAFF, "select fb_filing_warning('c9', '2026-04-01', '2026-06-30')"))["warn"] is False, "9. a client without FinCom Books: no warning")
    # heal (the catch-up compares AlterIDs, so mark it changed in Tally as the next read would)
    ingest("update tally_vouchers set alter_id = alter_id + 1 where book_id = '%s' and guid = '%s';" % (TB1, gd["guid"]))
    ok(json.loads(db.one("set role service_role; select fb_tieout('%s')" % BK))["in_step"], "9. the next read brings it: in step again")
    # D7: an opening difference
    db.sql("begin; insert into tally_ledgers (book_id, firm_id, name, parent, open) values ('%s', '%s', 'Old Difference (made up)', 'Suspense A/c', 37.5); commit;" % (TB1, F1))
    tie = json.loads(db.one("set role service_role; select fb_tieout('%s')" % BK))
    ok(not tie["in_step"] and "Difference in opening balances" in tie["words"] and "₹37.50" in tie["words"], "9. D7: the openings do not add up: Not in step ('%s')" % tie["words"])
    e = err(lambda: as_(STAFF, "select fb_opening_signoff('%s', 'known')" % BK))
    ok("Only the firm's owner" in e, "9. D7: staff cannot accept it")
    e = err(lambda: as_(OWN, "select fb_opening_signoff('%s', '')" % BK))
    ok("reason" in e, "9. D7: the owner must give a reason")
    r = json.loads(one(OWN, "select fb_opening_signoff('%s', 'difference carried from the old software (made up)')" % BK))
    ok(r["in_step"] and db.one("select count(*) from fb_audit_log where book_id = '%s' and entity = 'fb_books' and reason like 'difference carried%%'" % BK) == "1",
       "9. D7: the owner accepts it with a reason: in step; the reason is in the edit log")
    db.sql("begin; update tally_ledgers set open = 40 where book_id = '%s' and name = 'Old Difference (made up)'; commit;" % TB1)
    ok(not json.loads(db.one("set role service_role; select fb_tieout('%s')" % BK))["in_step"], "9. D7: the difference then changes: Not in step again (the acceptance was for that amount)")
    db.sql("begin; update tally_ledgers set open = 37.5 where book_id = '%s' and name = 'Old Difference (made up)'; commit;" % TB1)
    # the TODO hook: Tally's own primary-group closings (bridge 2.5.19, after the owner's OK)
    grp = {x["p"]: x["s"] for x in db.rows("select g.primary_name p, sum(c.bal) s from fb_closing('%s', '2026-11-20') c join fb_ledgers l on l.id = c.ledger_id join fb_groups g on g.id = l.group_id group by 1" % BK)}
    db.sql("set role service_role; select fb_source_figures_put('%s', 'group_closing', '2026-11-20', '%s'::jsonb, 'test (made up)')" % (BK, json.dumps(grp)))
    tie = json.loads(db.one("set role service_role; select fb_tieout('%s')" % BK))
    ok(tie["in_step"] and tie["source_read"], "9. Tally's own group closings (the TODO hook), when put: compared, equal: in step")
    grp["Current Assets"] = str(round(float(grp["Current Assets"]) + 500, 2))
    db.sql("set role service_role; select fb_source_figures_put('%s', 'group_closing', '2026-11-20', '%s'::jsonb, 'test (made up)')" % (BK, json.dumps(grp)))
    tie = json.loads(db.one("set role service_role; select fb_tieout('%s')" % BK))
    ok(not tie["in_step"] and tie["words"].startswith("Current Assets differs by ₹500.00"), "9. ... and when Tally says otherwise: '%s'" % tie["words"])
    db.sql("set role service_role; select fb_source_figures_put('%s', 'group_closing', '2026-11-20', '%s'::jsonb, 'test (made up)')" % (BK, json.dumps({k: (str(round(float(v) - 500, 2)) if k == "Current Assets" else v) for k, v in grp.items()})))
    # D19: an entry FinCom sent to Tally, not yet back: out of every total, listed
    tb0 = json.loads(one(STAFF, "select fb_tb('%s', '2026-11-20')" % BK))
    db.sql("""begin; insert into fb_vouchers (id, book_id, firm_id, fy, number, date, status, source) values ('eeeeeeee-0000-0000-0000-000000000001', '%s', '%s', '2026-27', 'FC-1', '2026-11-20', 'sent', 'bank');
      insert into fb_lines (voucher_id, version, line_no, book_id, firm_id, date, ledger_id, amount) select 'eeeeeeee-0000-0000-0000-000000000001', 1, n, '%s', '%s', '2026-11-20', l.id, case n when 1 then 750 else -750 end
        from (values (1, 'Office Rent'), (2, 'Demo Bank Current A/c')) x(n, nm) join fb_ledgers l on l.book_id = '%s' and l.name = x.nm; commit;""" % (BK, F1, BK, F1, BK))
    tb1 = json.loads(one(STAFF, "select fb_tb('%s', '2026-11-20')" % BK))
    stt = json.loads(one(STAFF, "select fb_status('c1')"))["books"][0]
    tie = json.loads(db.one("set role service_role; select fb_tieout('%s')" % BK))
    ok(tb0["dr"] == tb1["dr"] and stt["counts"]["sent"] == 1 and tie["in_step"] and tie["sent"] == 1, "9. D19: a 'sent' entry is out of the trial balance and the tie-out, and listed (1 sent)")

    # 10. RLS
    ok(one(OTHER, "select count(*) from fb_vouchers") == "0" and one(OTHER, "select count(*) from fb_audit_log") == "0", "10. another firm's member sees no row")
    ok("Not a book of your firm" in err(lambda: one(OTHER, "select fb_tb('%s', '2026-11-20')" % BK)), "10. ... and cannot read its trial balance")
    n_staff = int(one(STAFF, "select count(*) from fb_vouchers where book_id = '%s'" % BK))
    db.sql("insert into fb_grants (book_id, firm_id, user_id, role) values ('%s', '%s', '%s', 'viewer')" % (BK, F1, "aaaaaaaa-0000-0000-0000-000000000009"))
    ok(n_staff > 0 and one(STAFF, "select count(*) from fb_vouchers where book_id = '%s'" % BK) == "0" and int(one(OWN, "select count(*) from fb_vouchers where book_id = '%s'" % BK)) == n_staff,
       "10. once a book names its people, staff not named see none of it; the owner still does")
    db.sql("alter table fb_grants disable trigger fb_no_delete; delete from fb_grants; alter table fb_grants enable trigger fb_no_delete;")

    # 11. the readers
    tb = json.loads(one(STAFF, "select fb_tb('%s', '2026-11-20')" % BK))
    copy_bal = {x["ledger"]: x["b"] for x in db.rows("""select coalesce(t.name, m.ledger) ledger, -(coalesce(t.open, 0) + coalesce(m.a, 0)) b from (select name, open from tally_ledgers where book_id = '%s') t full join
        (select l.ledger, sum(l.amount) a from tally_vouchers v join tally_lines l on l.book_id = v.book_id and l.guid = v.guid where v.book_id = '%s' and v.day <= '2026-11-20' and not v.cancelled and not v.optional and v.deleted_at is null group by 1) m on m.ledger = t.name""" % (TB1, TB1))}
    mism = [r["l"] for r in tb["rows"] if abs(float(r["close"]) - float(copy_bal.get(r["l"], 0))) > 0.001]
    ok(tb["ties"] is False and abs(abs(float(tb["dr"]) - float(tb["cr"])) - 37.5) < 0.001, "11. the trial balance: Dr - Cr is exactly the opening difference Tally has (₹37.50)")
    ok(not mism and len(tb["rows"]) > 15, "11. every ledger's closing equals the copy's own balance, opening to 20-Nov-2026 (%d ledgers)%s" % (len(tb["rows"]), (": " + ", ".join(mism[:5])) if mism else ""))
    bank = next(r for r in tb["rows"] if r["l"] == "Demo Bank Current A/c")
    lg = json.loads(one(STAFF, "select fb_ledger('%s', %s, '2025-04-01', '2026-11-20')" % (BK, bank["id"])))
    run_ok = all(abs(float(lg["rows"][i]["bal"]) - float(lg["rows"][i - 1]["bal"]) - float(lg["rows"][i]["amount"])) < 0.001 for i in range(1, len(lg["rows"])))
    ok(run_ok and abs(float(lg["close"]) - float(bank["close"])) < 0.001 and float(lg["open"]) == float(bank["open"]), "11. a ledger: opening, a running balance entry by entry, closing = the trial balance's (%d entries)" % len(lg["rows"]))
    cust = next(r for r in tb["rows"] if r["l"] == "Alpha Demo Stores")
    lg = json.loads(one(STAFF, "select fb_ledger('%s', %s, '2026-04-01', '2026-11-20')" % (BK, cust["id"])))
    ok(len(lg["bills"]) > 0 and lg["ledger"]["gstin"].startswith("27") and abs(float(lg["close"]) - float(cust["close"])) < 0.001, "11. a party ledger carries its bill-wise references and GSTIN")
    dbk = json.loads(one(STAFF, "select fb_daybook('%s', '2026-07-01', '2026-08-31')" % BK))
    st = {r["number"]: r["status"] for r in dbk["rows"]}
    ok(dbk["totals"]["dr"] == dbk["totals"]["cr"] and st.get("J/ODD-1") == "posted" and dbk["totals"]["memo"] >= 1, "11. the day book: Dr total = Cr total; each entry with its status")
    ok("two months" in err(lambda: one(STAFF, "select fb_daybook('%s', '2026-01-01', '2026-06-30')" % BK)), "11. the day book asks for at most two months")
    ok(db.one("select fb_inr(-1234567.5)") == "-₹12,34,567.50" and db.one("select fb_inr(999)") == "₹999.00", "11. money in Indian grouping (₹12,34,567.50)")

    # 12. the review of 23-Nov-2026
    def bg(sql):
        p = subprocess.Popen(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        p.stdin.write(sql); p.stdin.close(); return p
    def vsql(g, d="2026-11-22", nar="t"):
        return ("insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional) values ('%s','%s','%s','%s',1,'Journal','J-%s','','%s',false,false);"
                "insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values ('%s','%s','%s','%s','Cash',-100),('%s','%s','%s','%s','Office Rent',100);") % (TB1, F1, g, d, g, nar, TB1, F1, g, d, TB1, F1, g, d)
    has = lambda g: db.one("select count(*) from tally_vouchers where book_id = '%s' and guid = '%s'" % (TB1, g)) == "1"
    fbh = lambda g: db.one("select count(*) from fb_vouchers where book_id = '%s' and source_ref = '%s'" % (BK, g)) == "1"
    catch = lambda: json.loads(db.one("set role service_role; select fb_mirror_catchup('%s', 5000)" % BK))
    # a re-run of 220 while the copy is written: no lock that stops the copy's write or the mirror
    a = bg(mig.replace("\ncommit;", "\nselect pg_sleep(5);\ncommit;")); time.sleep(3)
    heavy = db.rows("select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation where l.granted and l.pid <> pg_backend_pid() and l.mode in ('AccessExclusiveLock', 'ExclusiveLock', 'ShareRowExclusiveLock', 'ShareLock') and (c.relname like 'fb\\_%' or c.relname like 'tally\\_%')")
    t = time.time(); b = bg("set lock_timeout = '1s'; begin; " + vsql("RR-1") + " commit;"); out_b = b.stdout.read(); b.wait(); dt = time.time() - t
    out_a = a.stdout.read(); a.wait()
    ok(not heavy, "12. a re-run of 220 holds no lock that blocks the copy's writes (%s)" % heavy)
    ok(b.returncode == 0 and has("RR-1") and fbh("RR-1") and dt < 2.5 and a.returncode == 0, "12. ... a copy write during it commits at once (%.1f s) and is mirrored (%s)" % (dt, (out_b + out_a).strip()[-160:]))
    # B2: fb_books held by something else (ACCESS EXCLUSIVE): the landing trigger never waits; the copy's write commits; the sweep finds it
    a = bg("begin; lock table fb_books in access exclusive mode; select pg_sleep(4); commit;"); time.sleep(0.7)
    t = time.time(); b = bg("set lock_timeout = '1s'; begin; " + vsql("RR-2") + " commit;"); out_b = b.stdout.read(); b.wait(); dt = time.time() - t; a.stdout.read(); a.wait()
    ok(b.returncode == 0 and has("RR-2") and not fbh("RR-2") and db.one("select count(*) from fb_mirror_errors where kind = 'missed' and resolved_at is null") != "0",
       "12. B2: fb_books locked by another session: the copy's write still commits (%.1f s); the miss is logged (%s)" % (dt, out_b.strip()[-120:]))
    for _ in range(3): json.loads(db.one("set role service_role; select fb_mirror_catchup_all(5000)"))
    ok(fbh("RR-2") and db.one("select count(*) from fb_mirror_errors where resolved_at is null") == "0" and db.one("select sweep_after from fb_books where book_id = '%s'" % BK) in (None, ""),
       "12. B2: the catch-up's sweep (by content) mirrors it and clears the miss")
    # (1) the flush waits at most 2 s for the book's lock (the catch-up holding it), then leaves the entry to the catch-up
    a = bg("begin; select pg_advisory_xact_lock(hashtextextended('fb_mirror:%s', 0)); select pg_sleep(6); commit;" % BK); time.sleep(0.7)
    t = time.time(); b = bg("begin; " + vsql("RR-3") + " commit;"); b.stdout.read(); b.wait(); dt = time.time() - t; a.stdout.read(); a.wait()
    ok(b.returncode == 0 and has("RR-3") and not fbh("RR-3") and dt < 4.5 and db.one("select count(*) from fb_mirror_dirty where txid = 0 and key = 'RR-3'") == "1",
       "12. the book's mirror lock held elsewhere: the copy's write commits in %.1f s (not 6), the entry kept for the catch-up" % dt)
    catch()
    ok(fbh("RR-3") and db.one("select count(*) from fb_mirror_dirty") == "0", "12. ... and the catch-up mirrors it")
    # (2) a big statement (over the cap) is left to the catch-up instead of the copy's COMMIT
    big = [x["guid"] for x in db.rows("select guid from tally_vouchers where book_id = '%s' and day >= '2026-01-01' and not cancelled order by guid limit 20" % TB1)]
    vers = db.one("select sum(version) from fb_vouchers where book_id = '%s' and source_ref in (%s)" % (BK, ",".join("'%s'" % g for g in big)))
    ingest("set local fincom.fb_sync_cap = '5'; update tally_vouchers set narration = narration || ' (bulk, made up)' where book_id = '%s' and guid in (%s);" % (TB1, ",".join("'%s'" % g for g in big)))
    ok(db.one("select sum(version) from fb_vouchers where book_id = '%s' and source_ref in (%s)" % (BK, ",".join("'%s'" % g for g in big))) == vers
       and db.one("select count(*) from fb_mirror_dirty where txid = 0 and book_id = '%s'" % BK) == "20", "12. a statement touching more entries than the cap (5 here, 2,000 by default): left to the catch-up (20 waiting)")
    ok(json.loads(one(OWN, "select fb_status('c1')"))["books"][0]["counts"]["waiting"] == 20, "12. ... fb_status counts them as waiting")
    catch()
    ok(int(db.one("select sum(version) from fb_vouchers where book_id = '%s' and source_ref in (%s)" % (BK, ",".join("'%s'" % g for g in big)))) == int(vers) + 20
       and db.one("select count(*) from fb_mirror_dirty") == "0", "12. ... the catch-up mirrors them (each a new version)")
    # an update that changes nothing notes nothing
    n0 = db.rows("begin; update tally_vouchers set alter_id = alter_id where book_id = '%s' and day >= '2026-01-01'; update tally_ledgers set open = open where book_id = '%s'; select count(*) n from fb_mirror_dirty where txid = txid_current(); rollback;" % (TB1, TB1))
    ok(n0 and n0[-1]["n"] == "0", "12. an update of the copy that changes nothing (the same day sent again) notes nothing for the mirror (%s)" % n0)
    # (6) the actor label: the mirror's never stays on later writes of the same transaction
    db.sql("begin; set constraints all immediate; " + vsql("RR-4") + " update fb_books set legal_name = 'Demo Books Pvt Ltd (made up)' where book_id = '%s'; commit;" % BK)
    ak = db.rows("select actor_kind from fb_audit_log where book_id = '%s' and entity = 'fb_books' order by seq desc limit 1" % BK)[0]["actor_kind"]
    ok(fbh("RR-4") and ak == "system", "12. a write after the mirror in the same transaction is logged as itself, not as the mirror (%s)" % ak)
    e = err(lambda: db.sql("do $$ begin perform fb_mirror_catchup('%s', 10); perform fb_tieout('%s'); if coalesce(current_setting('fincom.fb_actor', true), '') <> '' then raise exception 'leaked %%', current_setting('fincom.fb_actor', true); end if; end $$;" % (BK, BK)))
    ok(e == "", "12. the catch-up and the tie-out put the actor label back (%s)" % e.strip()[-80:])
    # the timer's runner commits book by book
    db.sql("call fb_mirror_catchup_run(5000)")
    ok(True, "12. fb_mirror_catchup_run runs (a procedure: one transaction per book)")
    ok(json.loads(one(OWN, "select fb_audit_client_info('%s', 0, 5)" % BK)) is not None and "Only the firm's owner" in err(lambda: one(STAFF, "select fb_audit_client_info('%s', 0, 5)" % BK)),
       "12. the edit log's client_info: the owner reads it, staff cannot")

    if os.environ.get("FB_BIG"):
        nbig = int(os.environ["FB_BIG"]); TB2 = "bbbbbbbb-0000-0000-0000-000000000002"
        db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date) values ('%s', '%s', 'c3', 'Big Demo (made up)', '2025-04-01')" % (TB2, F1))
        db.sql(load_sql(TB2, F1, books(nbig, 11)))
        t0 = time.time(); r = json.loads(one(OWN, "select fb_enroll('c3')")); BK2 = r["books"][0]["book"]
        while json.loads(db.one("set role service_role; select fb_mirror_catchup('%s', 5000)" % BK2))["left"] > 0: pass
        t1 = time.time(); tie = json.loads(db.one("set role service_role; select fb_tieout('%s')" % BK2)); t2 = time.time()
        print("  ..   big book: %d entries mirrored in %.1f s; tie-out %.1f s; %s" % (nbig, t1 - t0, t2 - t1, tie["words"]))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
