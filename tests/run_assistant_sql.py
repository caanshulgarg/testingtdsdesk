"""python3 run_assistant_sql.py - migration 77 (FinCom Assistant's book tools, cap, log, mismatches) on a throwaway PostgreSQL
(assistant_stand.py: the cloud copy's tables as on staging, the report functions it reuses from the repository's
migrations, the made-up books of tests/fixtures/books loaded as the bridge and the app keep them).
Checks, each against figures worked out by hand (tests/fixtures/books/EXPECTED.md) or a second route here in Python:
  - the file runs twice and removes nothing; it is add-only (no "delete from", no "drop");
  - every book tool, as the firm's member, to the paisa;
  - row-level security: another firm's member gets nothing of this client, and the anon role may not run a tool; a tool
    cannot write (STABLE: an insert inside it fails);
  - the cap: asst_cap_take takes calls only under the cap, atomically; the log keeps the question, the tools, the tokens and
    the time only; the owner sees the days and questions, staff only today's count;
  - mismatches: add-only (the service role cannot change or remove a row), read by the owner only."""
# The database is a throwaway PostgreSQL from tests/pg_stand.py (through assistant_stand.py): CI runs this as root.
import os, sys, json, re, hashlib, datetime, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import assistant_stand as A
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
MIG = A.MIG77
text = open(MIG).read()
print("migration-77 md5 " + hashlib.md5(open(MIG, "rb").read()).hexdigest())
body = re.sub(r"\b(revoke|grant)\b[^;]*;", "", re.sub(r"--[^\n]*", "", text).lower())   # privileges named in a grant or revoke are not statements
ok(not re.search(r"\bdelete\s+from\b|\bdrop\s+(table|column|function|index|policy)\b|\btruncate\b|\balter\s+table\s+\S+\s+drop\b", body), "add-only: no delete, drop or truncate in the file")
ok(body.count("begin;") == 1 and "commit;" in body and "lock_timeout" in body, "one transaction with a lock timeout")

db = A.start(55478)
try:
    A.migrate(db)
    A.migrate(db)
    ok(True, "migration 77 (and 82, 84) run twice")
    b = A.load_fixture(db)
    J = lambda q, uid=A.ME: A.askj(db, q, uid)
    C = "'larkspur'"
    rows = lambda r: r.get("rows") or []

    # ---- every tool against the fixture books
    r = J("select asst_books(%s)" % C)
    ok(rows(r)[0]["from"] == "2025-04-01" and rows(r)[0]["to"] == "2026-03-31" and rows(r)[0]["entries"] == 76, "books held: 01-Apr-2025 to 31-Mar-2026, 76 entries (77 less the cancelled one)")
    r = J("select asst_ledger_balance(%s, 'tamarind bank', '2026-03-31')" % C)
    ok(r["summary"] == {"closing": 219250, "side": "Dr"}, "bank on 31-Mar-2026: 2,19,250 Dr (EXPECTED.md: the bank works out)")
    r = J("select asst_cash_bank(%s, '2026-03-31')" % C)
    ok(r["summary"]["total"] == 231750, "cash and bank 2,31,750 (bank 2,19,250 + cash 12,500)")
    r = J("select asst_profit_loss(%s, null, null)" % C)
    s = r["summary"]
    ok((s["revenue"], s["otherIncome"], s["expenses"], s["pbt"], s["gross"]) == (1550000, 9200, 1164650, 394550, 940000),
       "P&L: revenue 15,50,000, other income 9,200 (with finance costs' excess 5,000), expenses 11,64,650, PBT 3,94,550, gross 9,40,000 (%s)" % s)
    hd = {x["head"]: x["amount"] for x in rows(r)}
    ok(hd["Employee costs"] == 180000 and hd["Finance costs"] == 0 and hd["Other expenses"] == 314650 and hd["Direct expenses"] == 610000, "heads: employee 1,80,000 (a company's own group), finance nil, other 3,14,650, direct 6,10,000")
    r = J("select asst_top_parties(%s, 'customers', 'turnover', null, null, 10)" % C)
    # second route: Sales Accounts lines by party, from the vouchers
    sales = collections.Counter()
    sl = {l["name"] for l in b["ledgers"] if "Sales Accounts" in l["chain"]}
    for v in b["vouchers"]:
        if v["cancelled"]: continue
        for l, a in v["lines"]:
            if l in sl: sales[v["party"]] += a
    ok([(x["party"], x["amount"]) for x in rows(r)] == sorted(sales.items(), key=lambda kv: (-kv[1], kv[0])) and r["summary"]["total"] == 1550000, "top customers by sales, as the vouchers add up (Quillfeather 9,00,000 first)")
    r = J("select asst_top_parties(%s, 'customers', 'balance', null, '2026-03-31', 10)" % C)
    ok([(x["party"], x["amount"]) for x in rows(r)] == [("Quillfeather Weddings LLP", 430000), ("Orchid Lane Hospitality Pvt Ltd (Noida)", 159800), ("Brindle Corporate Travels", 69400), ("Marigold Expo Services", 59000)] and r["summary"]["total"] == 718200,
       "customers' balances: 4,30,000 / 1,59,800 / 69,400 / 59,000 = trade receivables 7,18,200")
    r = J("select asst_top_parties(%s, 'suppliers', 'balance', null, '2026-03-31', 10)" % C)
    ok({x["party"]: x["amount"] for x in rows(r)} == {"Nightjar Sound & Light Co": 290000, "Juniper Legal Associates": 32400} and r["summary"]["total"] == 322400, "trade payables 3,22,400 (Nightjar 2,90,000, Juniper 32,400)")
    r = J("select asst_entries_filter(%s, '2025-09-01', '2025-09-30', 10000, null, 'cash', 'payment', null, null, null, null, 50)" % C)
    ok(r["count"] == 0, "cash payments over 10,000 in September: none in the fixture")
    r = J("select asst_entries_filter(%s, '2025-09-01', '2025-09-30', 10000, null, 'any', 'any', null, null, null, null, 50)" % C)
    want = [(v["day"], v["vno"]) for v in b["vouchers"] if v["day"].startswith("2025-09") and not v["cancelled"] and max(sum(-a for _, a in v["lines"] if a < 0), sum(a for _, a in v["lines"] if a > 0)) >= 10000]
    ok([(x["day"], x["vno"]) for x in rows(r)] == sorted(want), "entries of 10,000 or more in September: %d, as the vouchers say" % len(want))
    r = J("select asst_entries_filter(%s, null, null, null, null, 'any', 'any', null, null, null, 'reverse charge', 50)" % C)
    ok(sorted(x["vno"] for x in rows(r)) == sorted(v["vno"] for v in b["vouchers"] if "reverse charge" in v["narration"].lower() and not v["cancelled"]), "narration words: the entries that say 'reverse charge'")
    r = J("select asst_voucher(%s, 'NSL/112', null)" % C)
    ok(r["count"] == 2 and len(rows(r)) == 10, "bill NSL/112: two entries, five lines each")
    r = J("select asst_ledger_movement(%s, 'office rent', '2025-12-01', '2026-03-31')" % C)
    ok([x["debit"] for x in rows(r)] == [30000] * 4 and rows(r)[-1]["balance"] == 120000, "office rent 30,000 a month, 1,20,000 by March")
    r = J("select asst_ledger_entries(%s, 'nightjar', null, null, 200)" % C)
    ok(r["count"] == 5 and rows(r)[-1]["balance"] == 290000 and r["summary"]["opening"] == 30000, "Nightjar's account: opening 30,000, five entries, 2,90,000 at the end")
    r = J("select asst_sales_by_month(%s, null, null)" % C)
    ok(r["summary"]["sales"] == 1550000 and {x["month"]: x["sales"] for x in rows(r)}["Oct-2025"] == 300000, "sales by month add to 15,50,000 (Oct 3,00,000)")
    r = J("select asst_tds_summary(%s, null, null)" % C)
    t = {x["ledger"]: (x["open"], x["deducted"], x["paid"], x["close"]) for x in rows(r)}
    ok(t["TDS ON CONTRACT 194C"] == (1200, 9000, 5200, 5000) and t["TDS ON PROFESSIONAL 194J"][3] == 3000 and t["TDS ON INTEREST 194A"][3] == 2000 and r["summary"]["deducted"] == 20000,
       "TDS: deducted 20,000; closing 194C 5,000, 194J 3,000, 194A 2,000 (EXPECTED.md TDS)")
    r = J("select asst_tds_missed(%s, null, null, null)" % C)
    ok([(x["party"], x["section"], x["amount"], x["tds"]) for x in rows(r)] == [("Ashvattha Transport Co", "194C", 40000, 400)], "TDS missed: Ashvattha's freight 40,000 over 30,000 (194C, 1%% of a firm... PAN AGWPA: 1%%), TDS 400")
    r = J("select asst_tds_late(%s, null, null)" % C)
    st = [(x["day"], x["amount"], x["status"], x["paid_on"]) for x in rows(r)]
    ok(st == [("2025-03-31", 1200, "paid on time", "2025-04-07"), ("2025-05-05", 2000, "paid late", "2026-02-07"), ("2025-05-08", 2000, "paid late", "2026-02-07"), ("2025-09-20", 2000, "not paid, overdue", None),
              ("2025-11-05", 6000, "paid late", "2026-02-07"), ("2026-01-15", 3000, "not paid, overdue", None), ("2026-02-25", 3000, "not paid, overdue", None), ("2026-03-31", 2000, "not yet due", None)],
       "TDS late: May's and November's paid on 07-Feb-2026 through the month-end account; Sep, Jan and Feb unpaid; March's due 30-Apr")
    r = J("select asst_tds_deductees(%s, null, null, null)" % C)
    ok([(x["party"], x["section"], x["base"], x["tds"]) for x in rows(r)] == [("Hemant Zaverchand (Loan)", "194A", 20000, 2000), ("Nightjar Sound & Light Co", "194C", 350000, 7000), ("Peregrine Tent Works", "194C", 200000, 2000), ("Juniper Legal Associates", "194J", 90000, 9000)],
       "deductees: Nightjar 7,000 on 3,50,000; Peregrine 2,000 on 2,00,000; Juniper 9,000 on 90,000; Hemant 2,000 on 20,000")
    r = J("select asst_gst_summary(%s, '2025-04-01', '2026-03-31')" % C)
    g = {x["month"]: (x["output"], x["input"], x["rcm"]) for x in rows(r)}
    ok(g["Apr-2025"] == (72000, 0, 0) and g["Jan-2026"] == (36000, 30600, 3600) and g["Feb-2026"] == (0, 11000, 5600) and g["Mar-2026"] == (23000, 10800, 10800) and sum(v[2] for v in g.values()) == 20000,
       "GST by month (EXPECTED.md): Apr 72,000 out; Jan 36,000 / 30,600 / RCM 3,600; Feb 0 / 11,000 / 5,600; Mar 23,000 / 10,800 / 10,800; RCM for the year 20,000")
    r = J("select asst_itc_vs_2b(%s, '2026-02-01', '2026-03-31', null)" % C)
    ok(r["summary"]["byMonth"] == {"202602": {"books": 5400, "twob": 5400, "diff": 0}, "202603": {"books": 0, "twob": 27000, "diff": -27000}}, "ITC vs 2B: February agrees (5,400); March's 2B has 27,000 not in March's books")
    ok("in the books in Jan-2026, entry 43" in rows(r)[1]["note"], "and says where it is: Nightjar's NSL/140, entered in January (%s)" % rows(r)[1]["note"])
    r = J("select asst_sales_vs_r1(%s, '2026-03-01', '2026-03-31', null)" % C)
    ok(rows(r)[0]["books"] == 200000 and rows(r)[0]["btax"] == 23000 and rows(r)[0]["note"] == "no GSTR-1 on file in FinCom", "sales vs GSTR-1, March: books 2,00,000 and tax 23,000; no GSTR-1 on file")
    db.sql("insert into gst_returns (firm_id, gstin, form, period, data) values ('%s', '07AAGCL4827M1Z3', 'R1', '032026', %s::jsonb);" % (A.FIRM, A.q(json.dumps({"b2b": [{"ctin": "09AACCO6624H1ZC", "inv": [{"inum": "LFE/25-26/015", "itms": [{"itm_det": {"txval": 50000, "iamt": 9000}}]}]},
        {"ctin": "07AACCW5512Q1Z1", "inv": [{"inum": "LFE/25-26/016", "itms": [{"itm_det": {"txval": 100000, "camt": 2500, "samt": 2500}}, {"itm_det": {"txval": 40000, "camt": 3600, "samt": 3600}}]}]}]}))))
    r = J("select asst_sales_vs_r1(%s, '2026-03-01', '2026-03-31', null)" % C)
    x = rows(r)[0]
    ok((x["r1"], x["diff"], x["rtax"], x["note"]) == (190000, 10000, 21200, "differs"), "with a GSTR-1 that left out 10,000 of Wisteria's second item: differs by 10,000 (%s)" % x)
    r = J("select asst_rcm(%s, null, null)" % C)
    ok((r["summary"]["value"], r["summary"]["tax"], r["summary"]["entries"]) == (140000, 20000, 5), "reverse charge: 1,40,000 of value, tax 20,000, five entries (EXPECTED.md)")
    r = J("select asst_msme_43bh(%s, '2026-03-31', 45)" % C)
    ok(r["summary"]["amount"] == 290000 and [(x["vno"], x["amount"], x["age"]) for x in rows(r)] == [("5", 116000, 327), ("43", 174000, 75)], "43B(h): 2,90,000 owed to Nightjar (micro) beyond 45 days (EXPECTED.md)")
    r = J("select asst_duplicates(%s, null, null)" % C)
    ok([(x["kind"], x["vno"], x["ref"]) for x in rows(r)] == [("same bill entered twice", "5", "NSL/112")], "duplicates: NSL/112 entered twice (voucher 5 repeats voucher 4)")
    r = J("select asst_weekend(%s, null, null, false)" % C)
    sun = sorted((v["day"], v["vno"]) for v in b["vouchers"] if not v["cancelled"] and re.search("sales|purchase|receipt|payment", v["vtype"], re.I)
                 and (datetime.date.fromisoformat(v["day"]).weekday() == 6 or v["day"][5:] in ("01-26", "08-15", "10-02")))
    ok([(x["day"], x["vno"]) for x in rows(r)] == sun and len(sun) == 5, "Sundays and holidays: %d entries, as the calendar says" % len(sun))
    r = J("select asst_round_sums(%s, null, null, 100000)" % C)
    ok(rows(r) == [], "no round-sum journals of 1 lakh or more")
    r = J("select asst_payroll(%s, null, null)" % C)
    ok(r["summary"]["cost"] == 180000 and [x["cost"] for x in rows(r) if x["cost"]] == [45000] * 4, "payroll: 45,000 a quarter, 1,80,000 for the year")
    r = J("select asst_turnover(%s, null, null)" % C)
    ok(r["summary"]["turnover"] == 1550000 and r["summary"]["cashReceiptsPct"] == 0, "turnover 15,50,000; no cash receipts")
    r = J("select asst_cash_40a3(%s, null, null)" % C)
    ok(rows(r) == [], "40A(3): none in the fixture")
    r = J("select asst_cash_269st(%s, null, null)" % C)
    ok(rows(r) == [], "269ST: none in the fixture")
    r = J("select asst_daybook_slice(%s, '2026-03-01', '2026-03-31', null, 'rukmini', null, 300)" % C)
    ok(r["count"] == 2 and [e["no"] for e in r["entries"]] == ["76", "77"], "Day Book slice: Rukmini's two March entries, with their lines")
    r = J("select asst_ageing(%s, 'customers', '2026-03-31')" % C)
    ok(r["summary"]["total"] == 718200, "ageing adds to the receivables, 7,18,200")
    r = J("select asst_due_list(%s, '2026-01-01', '2026-03-31')" % C)
    d = {x["what"]: x["status"] for x in rows(r)}
    ok(d.get("TDS deposit for Jan-2026") == "overdue" and d.get("TDS deposit for Nov-2025") == "paid 07-Feb-2026", "due list: January's TDS overdue, November's paid on 07-Feb-2026")
    r = J("select asst_find_ledgers(%s, 'tds', null, '2026-03-31')" % C)
    ok(r["count"] == 5, "find ledgers: five with 'tds' in the name")

    # ---- planted faults: a cash payment of 12,000 and a cash receipt of 2,50,000 are found
    plant = [{"guid": "zz-plant-1", "day": "2025-09-12", "vtype": "Payment", "vno": "P1", "party": "Travelling Expenses", "narration": "planted", "cancelled": False, "lines": [["Travelling Expenses", -12000], ["Cash", 12000]]},
             {"guid": "zz-plant-2", "day": "2025-09-13", "vtype": "Receipt", "vno": "R1", "party": "Brindle Corporate Travels", "narration": "planted", "cancelled": False, "lines": [["Cash", -250000], ["Brindle Corporate Travels", 250000]]}]
    db.sql("insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party, narration) values " + ",".join("('%s', '%s', '%s', '%s', '%s', '%s', %s, 'planted')" % (A.BOOK, A.FIRM, v["guid"], v["day"], v["vtype"], v["vno"], A.q(v["party"])) for v in plant) + ";" +
           "insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values " + ",".join("('%s', '%s', '%s', '%s', %s, %s)" % (A.BOOK, A.FIRM, v["guid"], v["day"], A.q(l), a) for v in plant for l, a in v["lines"]) + ";")
    r = J("select asst_cash_40a3(%s, null, null)" % C)
    ok([(x["day"], x["party"], x["amount"]) for x in rows(r)] == [("2025-09-12", "Travelling Expenses", 12000)], "40A(3): a planted cash payment of 12,000 is found")
    r = J("select asst_cash_269st(%s, null, null)" % C)
    ok([(x["day"], x["party"], x["amount"]) for x in rows(r)] == [("2025-09-13", "Brindle Corporate Travels", 250000)], "269ST: a planted cash receipt of 2,50,000 is found")
    r = J("select asst_entries_filter(%s, '2025-09-01', '2025-09-30', 10000, null, 'cash', 'payment', null, null, null, null, 50)" % C)
    ok([(x["vno"], x["amount"]) for x in rows(r)] == [("P1", 12000)], "'cash payments over 10,000 in September': the planted one")
    db.sql("delete from tally_lines where guid like 'zz-plant-%'; delete from tally_vouchers where guid like 'zz-plant-%';")

    # ---- row-level security and read-only
    for fn in ["asst_books(%s)", "asst_ledger_balance(%s, 'tamarind', null)", "asst_tds_missed(%s, null, null, null)", "asst_daybook_slice(%s, null, null, null, null, null, 10)", "asst_itc_vs_2b(%s, null, null, null)"]:
        r = J("select " + fn % C, A.STRANGER)
        ok(r.get("none") is True and not rows(r) and not r.get("entries"), "another firm's member gets nothing: " + fn.split("(")[0])
    r = J("select asst_clients(null)", A.STRANGER)
    ok([x["client"] for x in rows(r)] == ["zz-other-client"], "another firm's member lists only their own client")
    try:
        db._psql([], "set role anon; select asst_books('larkspur');"); ok(False, "anon may not run a tool")
    except RuntimeError as e: ok("permission denied" in str(e), "anon may not run a tool")
    try:
        A.ask(db, "do $$ begin perform 1; end $$; select asst_books('larkspur'); insert into tally_vouchers (book_id, firm_id, guid, day) values ('%s', '%s', 'x', '2026-01-01');" % (A.BOOK, A.FIRM)); ok(False, "a member cannot write the books")
    except RuntimeError as e: ok("permission denied" in str(e) or "row-level security" in str(e), "a member cannot write the books (no insert grant)")
    vol = db.one("select count(*) from pg_proc where proname like 'asst\\_%' and proname not in ('asst_cap_take', 'asst_cost_add', 'asst_log_add', 'asst_set_cap', 'asst_usage', 'asst_set_settings', 'asst_settings', 'asst_notice_tick', 'asst_notice_status') and (provolatile <> 's' and provolatile <> 'i')")
    ok(str(vol) == "0", "every book tool is STABLE (cannot write)")
    inv = db.one("select count(*) from pg_proc where proname like 'asst\\_%' and proname not in ('asst_cap_take', 'asst_cost_add', 'asst_log_add', 'asst_set_cap', 'asst_usage', 'asst_set_settings', 'asst_settings', 'asst_notice_tick', 'asst_notice_status') and prosecdef")
    ok(str(inv) == "0", "every book tool runs as the caller (security invoker)")
    # Sentry FINCOM-CLOUD-STAGING-1: on staging signed-in users may not run tally_pick (security migration-3-phase2), and
    # the book tools must work without it (migration 85: asst_span picks the book itself, under RLS and my_firm())
    try:
        A.ask(db, "select tally_pick('larkspur', null)"); ok(False, "a member may not run tally_pick (as on staging)")
    except RuntimeError as e: ok("permission denied" in str(e), "a member may not run tally_pick (as on staging)")
    ok("tally_pick(" not in db.one("select prosrc from pg_proc where proname = 'asst_span'"), "asst_span does not call tally_pick (migration 85)")
    db.sql(open(A.MIG85).read())
    r = J("select asst_tds_missed(%s, null, null, '194C')" % C)
    ok([x["party"] for x in rows(r)] == ["Ashvattha Transport Co"], "migration 85 runs twice; 194C without TDS as a member: Ashvattha Transport Co")
    r = J("select asst_tds_missed(%s, null, null, null)" % C, A.STRANGER)
    ok(r.get("none") is True and not rows(r), "after migration 85 another firm's member still gets no book")
    # migration 86 (staging, 14-Oct-2026): a book the bridge filled without a start date (from_date null; GB TEXCOAT, 863
    # entries) was invisible to every tool; an empty book (Master Cad: no entries, no ledgers) must answer "none", not an
    # empty green table
    db.sql(open(A.MIG86).read())          # 86 after 85 (85 was run again just above)
    ok("from_date is not null" not in db.one("select prosrc from pg_proc where proname = 'asst_span'").lower().split("-- the fallback")[-1], "asst_span's fallback does not need a start date (migration 86)")
    db.sql("update tally_books set from_date = null where book_id = '%s';" % A.BOOK)
    r = J("select asst_tds_missed(%s, null, null, '194C')" % C)
    ok([x["party"] for x in rows(r)] == ["Ashvattha Transport Co"], "a book with entries and no start date: 194C without TDS still found (%s)" % (r.get("why") or ""))
    first, last = db.rows("select min(day)::text f, max(day)::text l from tally_vouchers where book_id = '%s'" % A.BOOK)[0].values()
    ok(r.get("period") == {"from": max("2025-04-01", first), "to": last}, "its period: to its last entry, from the financial year's start or its first entry, whichever is later (%s)" % r.get("period"))
    r = J("select asst_tds_missed(%s, null, null, null)" % C, A.STRANGER)
    ok(r.get("none") is True, "a book with no start date: still nothing for another firm's member")
    db.sql("update tally_books set from_date = '2025-04-01' where book_id = '%s';" % A.BOOK)
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date) values ('00000000-0000-4000-8000-0000000000e1', '%s', 'zz-empty', 'Empty Co', null), "
           "('00000000-0000-4000-8000-0000000000e2', '%s', 'zz-empty-dated', 'Empty Dated Co', '2025-04-01');" % (A.FIRM, A.FIRM))
    for cl in ["zz-empty", "zz-empty-dated"]:
        r = J("select asst_tds_missed('%s', null, null, '194C')" % cl)
        ok(r.get("none") is True and not rows(r), "a book with no entries and no ledgers (%s): 'none', not an empty table" % cl)
    db.sql("delete from tally_books where client_id in ('zz-empty', 'zz-empty-dated');")
    db.sql(open(A.MIG86).read())
    ok([x["party"] for x in rows(J("select asst_tds_missed(%s, null, null, '194C')" % C))] == ["Ashvattha Transport Co"], "migration 86 runs twice")

    # migration 87 (FINCOM-CLOUD-STAGING-2): the due list timed out (57014) on a book of GARG SHEKHAR's size, because each
    # read policy called my_firm() once per row. A book of that size: 1,110 ledgers, 4,120 entries, about 10,300 lines,
    # 5,400 kept items, TDS deducted on every bill and paid from the bank each month
    big, bk = "zz-big", "00000000-0000-4000-8000-0000000000f1"
    db.sql(f"""
insert into clients (id, firm_id, name) values ('{big}', '{A.FIRM}', 'Big Books Co');
insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values ('{bk}', '{A.FIRM}', '{big}', 'Big Books Co', '2026-04-01', '2026-04-01');
insert into tally_ledgers (book_id, firm_id, name, parent, open, chain)
  select '{bk}', '{A.FIRM}', 'Supplier ' || g, 'Sundry Creditors', 0, array['Sundry Creditors', 'Current Liabilities'] from generate_series(1, 1100) g
  union all values ('{bk}'::uuid, '{A.FIRM}'::uuid, 'Freight Charges', 'Direct Expenses', 0::numeric, array['Direct Expenses']),
    ('{bk}', '{A.FIRM}', 'TDS Payable 194C', 'Duties & Taxes', 0, array['Duties & Taxes', 'Current Liabilities']),
    ('{bk}', '{A.FIRM}', 'Kotak Bank', 'Bank Accounts', 0, array['Bank Accounts', 'Current Assets']);
insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party, narration, cancelled, optional)
  select '{bk}', '{A.FIRM}', 'big-' || g, date '2026-04-01' + (g % 190), 'Journal', 'J' || g, 'Supplier ' || (1 + g % 1100), 'freight', false, false from generate_series(1, 4000) g;
insert into tally_lines (book_id, firm_id, guid, day, ledger, amount)
  select '{bk}', '{A.FIRM}', 'big-' || g, date '2026-04-01' + (g % 190), x.l, x.a from generate_series(1, 4000) g,
    lateral (values ('Freight Charges', -10000), ('Supplier ' || (1 + g % 1100), 9900), ('TDS Payable 194C', 100)) x(l, a);
insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party, narration, cancelled, optional)
  select '{bk}', '{A.FIRM}', 'bigpay-' || m, (date '2026-05-07' + (m || ' month')::interval)::date, 'Payment', 'P' || m, 'Kotak Bank', 'TDS', false, false from generate_series(0, 5) m;
insert into tally_lines (book_id, firm_id, guid, day, ledger, amount)
  select '{bk}', '{A.FIRM}', 'bigpay-' || m, (date '2026-05-07' + (m || ' month')::interval)::date, x.l, x.a from generate_series(0, 5) m,
    lateral (values ('TDS Payable 194C', -60000), ('Kotak Bank', 60000)) x(l, a);
insert into client_book_items (firm_id, client_id, key, item, data) select '{A.FIRM}', '{big}', 'ledInfo', '.Supplier ' || g, '{{"pan": ""}}' from generate_series(1, 1100) g;
insert into client_book_items (firm_id, client_id, key, item, data) select '{A.FIRM}', 'zz-noise-' || (g % 50), 'map', '.L' || g, '{{}}' from generate_series(1, 4300) g;
analyze;""")
    import time
    def timed(q):
        t0 = time.time()
        out = A.ask(db, "set statement_timeout = '8s';\n" + q)
        return time.time() - t0, json.loads(out)
    pol = db.one("select string_agg(qual, ' | ') from pg_policies where tablename in ('tally_lines', 'tally_vouchers', 'tally_ledgers', 'client_book_items') and cmd = 'SELECT'")
    ok(pol.lower().count("select my_firm()") >= 4, "the read policies work out my_firm() once per query (migration 87): " + pol)
    try:
        sec, r = timed("select asst_due_list('%s', null, null)" % big)
        ok(not r.get("none") and any(x["what"].startswith("TDS deposit for") for x in rows(r)) and sec < 8, "a book of GARG SHEKHAR's size: the due list as a member inside the 8 s limit (%.1f s)" % sec)
        sec, r = timed("select asst_tds_missed('%s', null, null, '194C')" % big)
        ok(not r.get("none") and sec < 8, "and 194C without TDS (%.1f s)" % sec)
    except RuntimeError as e:
        ok(False, "a book of GARG SHEKHAR's size: the due list as a member inside the 8 s limit: " + str(e)[-200:])
    r = J("select asst_due_list('%s', null, null)" % big, A.STRANGER)
    ok(r.get("none") is True, "after migration 87 another firm's member still gets nothing of it")
    # migration 88 (the owner, 14-Oct-2026: "balance of air Ess exim" found no ledger): a ledger or party name typed as
    # people say it: case, spaces, punctuation, & / and, and the company's suffix do not matter
    db.sql(f"""insert into tally_ledgers (book_id, firm_id, name, parent, open, chain) values
      ('{bk}', '{A.FIRM}', 'AIR ESS EXIM PRIVATE LIMITED', 'Sundry Creditors', 0, array['Sundry Creditors']),
      ('{bk}', '{A.FIRM}', 'Mehta & Sons', 'Sundry Creditors', 0, array['Sundry Creditors']),
      ('{bk}', '{A.FIRM}', 'Mehta Traders LLP', 'Sundry Creditors', 0, array['Sundry Creditors']),
      ('{bk}', '{A.FIRM}', 'Mehta Brothers', 'Sundry Creditors', 0, array['Sundry Creditors']);""")
    pick = lambda t, u=A.ME: J("select asst_ledger_pick('%s', %s)" % (big, A.q(t)), u)
    for typed in ["air Ess exim", "Air-Ess Exim Pvt Ltd", "AIR ESS EXIM PRIVATE LIMITED", "air ess exim pvt. ltd.", "Airess Exim Limited"]:
        r = pick(typed)
        ok(r.get("ledger") == "AIR ESS EXIM PRIVATE LIMITED" and not r.get("choices"), "'%s' finds AIR ESS EXIM PRIVATE LIMITED (%s)" % (typed, r))
    r = pick("mehta")
    ok(r.get("ledger") is None and r.get("ask") is True and sorted(r.get("choices") or []) == ["Mehta & Sons", "Mehta Brothers", "Mehta Traders LLP"], "an ambiguous name asks which one (%s)" % r)
    r = pick("Mehta and Sons")
    ok(r.get("ledger") == "Mehta & Sons", "& and 'and' are the same (%s)" % r)
    r = pick("air ess exin")
    ok(r.get("ledger") is None and not r.get("ask") and (r.get("choices") or [None])[0] == "AIR ESS EXIM PRIVATE LIMITED" and len(r["choices"]) <= 5, "a typo: no ledger, the closest names first (%s)" % r)
    r = pick("zzqx")
    ok(r.get("ledger") is None and (r.get("choices") or []) == [], "nothing like it: no suggestions (%s)" % r)
    r = pick("air ess exim", A.STRANGER)
    ok(r.get("ledger") is None and not r.get("choices"), "another firm's member: nothing (%s)" % r)
    ok(db.one("select asst_match_ledger('%s', 'Air-Ess Exim Pvt Ltd')" % bk) == "AIR ESS EXIM PRIVATE LIMITED", "the tools' own match (asst_match_ledger) uses the same rule")
    ok(db.one("select prosecdef::text from pg_proc where proname = 'asst_ledger_pick'") == "false", "asst_ledger_pick runs as the caller")
    db.sql(open(A.MIG88).read())
    db.sql(open(A.MIG87).read())
    ok(db.one("select string_agg(qual, ' | ') from pg_policies where tablename in ('tally_lines', 'tally_vouchers', 'tally_ledgers', 'client_book_items') and cmd = 'SELECT'") == pol, "migration 87 runs twice (policies unchanged the second time)")

    # ---- the cap (in rupees: Rs 150 a day at Rs 85 a dollar unless the owner sets others) and the log
    take = lambda n=1: json.loads(db.one("select asst_cap_take('%s', %d)" % (A.FIRM, n)))
    cost = lambda usd, feat="book": json.loads(db.one("select asst_cost_add('%s', '%s', %s, 1000, 100, 500, 0)" % (A.FIRM, feat, usd)))
    t = take()
    ok(t["ok"] and t["cap_inr"] == 150 and t["rate"] == 85 and t["spent_inr"] == 0, "default cap Rs 150 a day at Rs 85 to the dollar (%s)" % t)
    c1 = cost(1.0)
    ok(c1["inr"] == 85 and c1["spent_inr"] == 85 and not c1["warn"], "a call of $1.00 costs Rs 85 at the firm's rate")
    c2 = cost(0.5, "notice")
    ok(c2["spent_inr"] == 127.5 and c2["warn"] and not c2["over"], "at Rs 127.50 of 150 (85%%) the warning is on")
    t = take()
    ok(t["ok"] and t["warn"], "still under the cap: the call is taken, with the warning")
    cost(0.3)
    t = take()
    ok(not t["ok"] and t["why"] == "inr" and t["spent_inr"] == 153, "at Rs 153 (over 150) no new AI call (%s)" % t)
    try: A.ask(db, "select asst_cap_take('%s', 1)" % A.FIRM); ok(False, "a member cannot take calls")
    except RuntimeError as e: ok("permission denied" in str(e), "only the function (service role) takes calls")
    try: A.ask(db, "select asst_cost_add('%s', 'x', 0, 0, 0, 0, 0)" % A.FIRM); ok(False, "a member cannot add cost")
    except RuntimeError as e: ok("permission denied" in str(e), "only the function adds cost")
    db.sql("select asst_log_add('%s', '%s', 'larkspur', 'Top 10 customers by sales', array['top_parties'], 3100, 420, 2, 5400, 'book', 'keyword', array[]::text[], 0, 0, 0, false);" % (A.FIRM, A.ME))
    db.sql("select asst_log_add('%s', '%s', 'larkspur', 'What was the advance to Rukmini about?', array['daybook_slice'], 9100, 620, 2, 7400, 'book', 'model', array['claude-sonnet-5-5'], 4000, 0, 2.31, true);" % (A.FIRM, A.ME))
    lg = db.rows("select * from assistant_log order by id")
    ok(len(lg) == 2 and set(lg[0].keys()) == {"id", "firm_id", "user_id", "client_id", "at", "question", "tools", "input_tokens", "output_tokens", "calls", "ms", "feature", "route", "models", "cache_read", "cache_write", "cost_inr", "fell_through"}
       and lg[0]["tools"] == "{top_parties}", "the log: question, tools, route, models, tokens, cost and time; no answer")
    u = J("select asst_usage(30)")
    ok(u["owner"] is True and u["spent_inr"] == 153 and u["over"] and u["days"][0]["inr"] == 153 and u["months"][0]["inr"] == 153, "the owner sees today's spend in rupees, by day and by month")
    fe = {x["feature"]: x for x in u["features"]}
    ok(fe["book"]["inr"] == 110.5 and fe["notice"]["inr"] == 42.5 and fe["book"]["questions"] == 2, "and which features use the money (%s)" % u["features"])
    ok(u["fell_through"] == [{"q": "What was the advance to Rukmini about?", "n": 1}], "the questions no fixed question fitted, for new intents")
    u = J("select asst_usage(30)", A.STAFF)
    ok(u["owner"] is False and u["spent_inr"] == 153 and u["days"] is None and u["questions"] is None and u["features"] is None, "staff see today's spend and the cap only")
    try: A.ask(db, "select count(*) from assistant_log", A.ME); ok(False, "the log is not read directly")
    except RuntimeError as e: ok("permission denied" in str(e), "the log table is not read directly by members")
    try: A.ask(db, "select asst_set_cap(300, null)", A.STAFF); ok(False, "staff cannot set the cap")
    except RuntimeError as e: ok("only the firm's owner" in str(e), "only the owner sets the cap")
    r = J("select asst_set_cap(300, 84.5)")
    ok(r["cap_inr"] == 300 and r["rate"] == 84.5 and take()["ok"], "the owner raises the cap to Rs 300 (rate 84.50): calls again")
    ok(cost(1.0)["inr"] == 84.5, "the new rate applies to the next call")
    # the answer cache's data version: changes when the books change
    v1 = A.ask(db, "select asst_data_version('larkspur')")
    db.sql("update tally_books set days_at = days_at + interval '1 minute' where book_id = '%s';" % A.BOOK)
    v2 = A.ask(db, "select asst_data_version('larkspur')")
    ok(v1 and v2 and v1 != v2 and A.ask(db, "select asst_data_version('larkspur')", A.STRANGER) != v2, "the books' version changes when the bridge brings anything in (and differs for another firm)")
    try: A.ask(db, "select count(*) from assistant_answers"); ok(False, "the answer cache is not read directly")
    except RuntimeError as e: ok("permission denied" in str(e), "the answer cache is the function's only")

    # ---- the notice annexures' tools (made-up TDS credit, 26AS and February's GSTR-3B: assistant_stand.add_notice_data)
    A.add_notice_data(db)
    r = J("select asst_purchase_register(%s, '2026-02-01', '2026-02-28', null)" % C)
    ok([(x["party"], x["ref"], x["taxable"], x["tax"], x["total"]) for x in rows(r)] == [("Ashvattha Transport Co", "ATC/56", 40000, 2000, 40000), ("Juniper Legal Associates", "JLA/388", 30000, 5400, 32400), ("Rukmini Sethuraman", "", 20000, 3600, 20000)]
       and r["summary"]["tax"] == 11000, "purchase register, February 2026: three bills, input tax 11,000 (5,400 invoices + 5,600 reverse charge)")
    r = J("select asst_payments_list(%s, '2026-03-01', '2026-03-31', 'Rukmini')" % C)
    ok([(x["day"], x["vno"], x["amount"]) for x in rows(r)] == [("2026-03-31", "77", 60000)], "payments to Rukmini in March: 60,000 on 31-Mar")
    r = J("select asst_itc_3way(%s, '2026-02-01', '2026-02-28', null)" % C)
    x = rows(r)[0]
    ok((x["books"], x["twob"], x["b3oth"], x["b3rcm"], x["b3all"], x["rcm"], x["excess"]) == (5400, 5400, 5400, 5600, 11000, 5600, 5600) and "reverse-charge credit only" in x["note"],
       "ITC three ways, Feb 2026: books 5,400 = 2B 5,400; 3B 11,000 = 5,400 + 5,600 reverse charge (books 5,600)")
    r = J("select asst_tds_vs_26as(%s, '2025-26')" % C)
    ok(r["summary"]["books"] == 15000 and r["summary"]["in26as"] == 13000 and r["summary"]["diff"] == -2000 and
       sorted((x["party"], x["in26as"], x["books"]) for x in rows(r)) == [("Quillfeather Weddings LLP", 13000, 13000), ("Vellichor Learning Foundation", 0, 2000)], "26AS against the books, 2025-26: 13,000 against 15,000; Vellichor's 2,000 not in 26AS")
    r = J("select asst_turnover_3way(%s, '2026-01-01', '2026-03-31', null)" % C)
    ok([x["books"] for x in rows(r)] == [200000, 0, 200000] and r["summary"]["books"] == 400000, "turnover three ways, Q4: books 2,00,000 + 0 + 2,00,000")
    for fn in ["asst_tds_vs_26as(%s, '2025-26')", "asst_itc_3way(%s, null, null, null)", "asst_purchase_register(%s, null, null, null)"]:
        r = J("select " + fn % C, A.STRANGER)
        ok(r.get("none") is True or not rows(r), "another firm's member gets nothing: " + fn.split("(")[0])
    # ---- a notice tracked: the function adds it; the firm's owner and staff tick documents and mark it filed; a viewer cannot
    nid = db.one("set role service_role; insert into assistant_notices (firm_id, client_id, form, due, checklist) values ('%s', 'larkspur', 'ASMT-10', '2026-11-15', '[{\"id\": \"invoices\", \"status\": \"attach\", \"done\": false}, {\"id\": \"itc_recon\", \"status\": \"ready\", \"done\": true}]') returning id;" % A.FIRM)
    nid = nid.strip().splitlines()[-1] if nid else nid
    n = J("select asst_notice_tick('%s', 'invoices', true)" % nid, A.STAFF)
    ok([x["done"] for x in n["checklist"]] == [True, True], "staff tick a document as attached")
    try: A.ask(db, "select asst_notice_status('%s', 'filed', null)" % nid); ok(False, "filed needs the acknowledgement")
    except RuntimeError as e: ok("acknowledgement" in str(e), "marking it filed needs the acknowledgement number")
    n = J("select asst_notice_status('%s', 'filed', 'AA0711260045678')" % nid)
    ok(n["status"] == "filed" and n["ack_no"] == "AA0711260045678" and n["filed_on"], "the owner marks the reply filed, with the acknowledgement")
    try: A.ask(db, "select asst_notice_tick('%s', 'invoices', false)" % nid, A.VIEWER); ok(False, "a viewer cannot change a notice")
    except RuntimeError as e: ok("only the firm's owner and staff" in str(e), "a viewer cannot change a notice")
    ok(A.ask(db, "select count(*) from assistant_notices", A.STRANGER) == "0" and A.ask(db, "select count(*) from assistant_notice_events", A.ME) == "2", "another firm sees none; each change is kept (add-only events)")
    try: A.ask(db, "insert into assistant_notices (firm_id, client_id) values ('%s', 'larkspur')" % A.FIRM, A.ME); ok(False, "members do not add notices directly")
    except RuntimeError as e: ok("permission denied" in str(e) or "row-level security" in str(e), "notices are added by the function only")

    # ---- mismatches: add-only, the owner reads
    db.sql("insert into assistant_mismatches (firm_id, client_id, kind, question, figure, figure_key, ai_value, fincom_value, tool, params, entry_ids) values ('%s', 'larkspur', 'auto', 'q', 'total', 'rcm.summary.tax', 4000, 3600, 'rcm', '{}', '{abc}');" % A.FIRM)
    mid = db.one("select id from assistant_mismatches limit 1")
    for stmt in ["update assistant_mismatches set fincom_value = 4000", "delete from assistant_mismatches"]:
        try: db._psql([], "set role service_role; " + stmt + ";"); ok(False, "add-only: " + stmt)
        except RuntimeError as e: ok("permission denied" in str(e), "add-only even for the service role: " + stmt.split()[0])
    db.sql("set role service_role; insert into assistant_mismatch_status (mismatch_id, status, note) values ('%s', 'cause_found', 'the rcm tool read the wrong side');" % mid)
    m = J("select asst_mismatches(50)")
    ok(m["counts"]["cause_found"] == 1 and m["rows"][0]["status"] == "cause_found" and m["rows"][0]["ai"] == 4000, "the owner's list: the latest status, with counts")
    m = J("select asst_mismatches(50)", A.STAFF)
    ok(m["counts"]["all"] == 0, "staff see no mismatches (the owner only)")
    m = J("select asst_mismatches(50)", A.STRANGER)
    ok(m["counts"]["all"] == 0, "another firm's owner sees none")
    # chats and tasks: the firm's members read; owner and staff write; a viewer cannot
    A.ask(db, "insert into assistant_chats (client_id, title, turns) values ('larkspur', 'TDS', '[]');", A.STAFF)
    ok(A.ask(db, "select count(*) from assistant_chats", A.ME) == "1" and A.ask(db, "select count(*) from assistant_chats", A.STRANGER) == "0", "a saved conversation: the firm reads it, another firm does not")
    try: A.ask(db, "insert into client_due_tasks (client_id, title, due) values ('larkspur', 'Reply to ASMT-10', '2026-11-15');", A.VIEWER); ok(False, "a viewer cannot add a task")
    except RuntimeError as e: ok("row-level security" in str(e), "a viewer cannot add a task")
    A.ask(db, "insert into client_due_tasks (client_id, title, due, ref) values ('larkspur', 'Reply to ASMT-10', '2026-11-15', 'ZD0711260123456');", A.STAFF)
    r = J("select asst_due_list(%s, '2026-10-01', '2026-11-30')" % C)
    ok(any(x["what"] == "Task: Reply to ASMT-10" and x["due"] == "2026-11-15" for x in rows(r)), "a task added from a notice is on the due list")
    # the owner's decision of 14-Oct-2026 (migration 82): on for every firm unless its owner switches it off; no consent tick
    st = J("select asst_settings()")
    ok(st["enabled"] is True and st["default_on"] is True and st["owner"] is True, "on by default: a firm that never set it is on (82)")
    ok(J("select asst_settings()", A.STRANGER)["enabled"] is True, "another firm, never set: on too")
    try: A.ask(db, "select asst_set_settings(false, true)", A.STAFF); ok(False, "staff cannot switch it off")
    except RuntimeError as e: ok("only the firm's owner" in str(e), "only the owner switches the assistant off or on")
    st = J("select asst_set_settings(false, true)")
    ok(st["enabled"] is False and st["default_on"] is False, "the owner switches it off; it is kept")
    ok(J("select asst_settings()", A.STAFF)["enabled"] is False and J("select asst_settings()", A.STRANGER)["enabled"] is True, "staff see it off; another firm's is still on")
    A.migrate(db)
    ok(J("select asst_settings()")["enabled"] is False, "running 77 and 82 again does not flip a firm that switched it off")
    st = J("select asst_set_settings(true, false)")
    ok(st["enabled"] is True and st["consent"] is True, "on again; consent is not asked any more (answered true)")
    ok(db.one("select column_default from information_schema.columns where table_name = 'assistant_settings' and column_name = 'enabled'") == "true", "a new row defaults to on")
    pol = db.one("select count(*) from pg_policies where tablename = 'objects' and policyname like 'assistant files:%'")
    ok(str(pol) == "3", "the bucket's three policies (read own firm; add notices, add uploads to own firm)")
    # one Upload (migration 84, 14-Oct-2026): a firm's uploads under <firm>/<client>/uploads/, of its own firm only
    up = A.FIRM + "/larkspur/uploads/k1-bill.pdf"
    A.ask(db, "insert into storage.objects (bucket_id, name) values ('assistant-files', '%s');" % up, A.STAFF)
    ok(A.ask(db, "select count(*) from storage.objects where name = '%s'" % up, A.ME) == "1", "staff store an upload under the firm's uploads/")
    for who, path, why in [(A.VIEWER, up.replace("k1", "k2"), "a viewer cannot upload"), (A.STRANGER, up.replace("k1", "k3"), "another firm cannot upload into this firm"),
                           (A.STAFF, A.FIRM + "/larkspur/elsewhere/k4.pdf", "only notices/ and uploads/ take files")]:
        try: A.ask(db, "insert into storage.objects (bucket_id, name) values ('assistant-files', '%s');" % path, who); ok(False, why)
        except RuntimeError as e: ok("row-level security" in str(e), why)
    A.ask(db, "insert into assistant_uploads (client_id, path, name, size, kind, kind_by, summary) values (null, '%s', 'bill.pdf', 1200, 'bill', 'rules', 'A tax invoice');" % up, A.STAFF)
    ok(A.ask(db, "select kind || '/' || kind_by from assistant_uploads", A.ME) == "bill/rules" and A.ask(db, "select count(*) from assistant_uploads", A.STRANGER) == "0", "an upload's record: the firm reads it, another firm does not")
    try: A.ask(db, "insert into assistant_uploads (path, name, kind) values ('%s', 'x.pdf', 'weird');" % up, A.STAFF); ok(False, "an unknown kind is refused")
    except RuntimeError as e: ok("check" in str(e), "an unknown kind is refused")
    try: A.ask(db, "insert into assistant_uploads (path, name) values ('%s/larkspur/uploads/x.pdf', 'x.pdf');" % A.OTHER, A.STAFF); ok(False, "a record cannot point at another firm's file")
    except RuntimeError as e: ok("row-level security" in str(e), "a record cannot point at another firm's file")
    A.ask(db, "update assistant_uploads set action = 'purchase';", A.STAFF)
    ok(A.ask(db, "select action from assistant_uploads", A.ME) == "purchase", "the step the user picked is kept")
    A.migrate(db, A.MIG84)
    ok(A.ask(db, "select count(*) from assistant_uploads", A.ME) == "1", "84 runs twice and keeps what is there")
finally:
    db.stop()
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed"))
sys.exit(1 if fails else 0)
