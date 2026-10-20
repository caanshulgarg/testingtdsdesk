"""python3 run_salary_tds.py - round 92 (19-Oct-2026): salary TDS (24Q / Form 138) fetched right, from Tally's payroll and
from salary entries kept without payroll. On the React build (app/dist-test: cd app && npm run legacy && npm run build:test).

The fixture is shaped on a real client's 2026-27 payroll as the cloud copy holds it (read-only, staging): the TDS pay head
"TDS 192B" (Deductions From Employees, group TDS) with Tally's statutory type BLANK; each month's TDS of Q1 1,88,296 /
1,88,296 / 1,90,872 (5,67,464) and Q2 1,97,551 / 2,09,880 / 2,09,880, eight employees with TDS, three of them without a PAN
in Tally; an "Arears" head typed as a reimbursement; the salary paid through "Salary <name>" ledgers. Names and PANs are
made up (the amounts are the client's, each kept against a made-up name).
  1. Leads-like payroll, blank statutory type: Form 138 Q1 TDS 5,67,464, each employee as in Tally; Q2 6,17,311
  2. "This pay head is TDS" / "Not TDS": the person's choice, kept in the ledger map, used everywhere
  3. an employee's TDS missing from the payroll's split: the rest kept as "TDS not split by employee", warned, never dropped
  4. arrears typed as a reimbursement count as salary (noted)
  5. PAN: Tally's employee PAN, else the PAN book by the employee's name, else the PAN of the "Salary <name>" ledger
     (PAN book or Tally); "PAN missing for N employees with TDS" with Add PAN (saved to the PAN book)
  6. salary kept without payroll: journals "Salary Dr / TDS on Salary Cr / Salary <name> Cr" (a TDS ledger with no section
     number): one row per employee
  7. a year of payroll months and journal months together
  9. next-tds-tidy2 (the owner on Leads' Form 138 Q1: "7 Apr salary, 30 Apr salary, 7 May salary"): the salary payments
     (Payment vouchers whose "Salary Payable" line Tally allocates to each employee as a cost centre: 7-Apr the March
     salary, 7-May the April salary) and the TDS deposit (TDS 192B debited, 30-Apr) are not deductions: one row per employee
     per payroll month, dated the payroll entry; the pay register, Annexure II and Form 16 count no payment as salary
 10. Form 138's Deductions step as 26Q's: Select challan (the 192 challans), + Add deduction to this challan, tick boxes and
     Move to this challan, the footer's balance; Remove from challan gives the balance back; Annexure I under ⋯
Run under flock /tmp/fincom-app.lock with the other screen tests."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("SALTDS_PORT") or 8361)
OUT = os.path.join(HERE, "out", "salary-tds"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

# ---------------------------------------------------------------- the Leads-like payroll
BOOK = "5a1a7d50-0000-4000-8000-000000000092"
B, H, SA, CV, GMC, PF, TDS_, ARR = "Basic Salary", "HRA", "Special Allowance", "Conveyance Allowances", "Gmc", "PF Employee Contribution", "TDS 192B", "Arears"
def heads(b, s, h, c, gmc=0, pf=0, tds=0):
    d = {B: -b, SA: -s, H: -h, CV: -c}
    if gmc: d[GMC] = gmc
    if pf: d[PF] = pf
    if tds: d[TDS_] = tds
    return d
M = ["2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"]
NAV, ARJ, SAM, DIN, ANI, JAT, RAK, SUB = ("LI Naveen Rawat", "LI Arjun Kapoor", "LI Sameer Hussain", "LI Dinesh Sethi", "LI Dr Anil Joshi",
                                          "LI Jatin Kohli", "LI Rakesh Nath Shukla", "LI Subrata Chakraborty")
ASH, HAR, KIR, SUN = "LI Asha Agarwal", "LI Harish Saxena", "LI Kiran Kaur", "LI Sunil Pal"
PAY = {m: {} for m in M}
for i, m in enumerate(M):
    PAY[m][NAV] = heads(147273, 77491, 73636, 1600, tds=90000) if i == 0 else heads(165000, 50900, 82500, 1600, tds=90000)
    PAY[m][ARJ] = heads(127332, 38915, 63666, 1600, 342 if i < 3 else 393, 1800, 33882)
    PAY[m][SAM] = heads(100188, 30278, 50094, 1600, 1108 if i < 3 else 1509, 0, 19737) if i < 4 else heads(125235, 38248, 62618, 1600, 1509, 0, 32066)
    PAY[m][DIN] = heads(81858, 24446, 40929, 1600, 1127 if i < 3 else 1151, 1800, 12324)
    PAY[m][ANI] = heads(81125, 24213, 40563, 1600, 2057 if i < 3 else 2139, 1800, 12047)
    PAY[m][JAT] = heads(75900, 22550, 37950, 1600, 866 if i < 3 else 891, 0, 10153)
    PAY[m][RAK] = heads(75900, 22550, 37950, 1600, 866 if i < 3 else 891, 0, 10153)
    if i == 2: PAY[m][SUB] = heads(25313, 7574, 12656, 480, 0, 1800, 2576)
    if i > 2: PAY[m][SUB] = heads(84376, 25247, 42188, 1600, 1413, 1800, 9255)
    PAY[m][ASH] = heads(20994, 5080, 10497, 1600, 586)
    PAY[m][HAR] = heads(13750, 2775, 6875, 1600, 586)
    PAY[m][KIR] = heads(18975, 4438, 9488, 1600, 586)
    PAY[m][SUN] = heads(34375, 9338, 17188, 1600, 1108, 1800)
PAY["2026-05-31"][JAT][ARR] = -10000            # arrears, typed in Tally as a reimbursement
PAN = {NAV: "AQZPR4101K", ARJ: "BKXPK4102L", SAM: "CLYPH4103M", JAT: "DMWPK4104N", RAK: "EPVPS4105P", ASH: "FQTPA4106Q", SUN: "GRSPP4107R"}
EMPS = [NAV, ARJ, SAM, DIN, ANI, JAT, RAK, SUB, ASH, HAR, KIR, SUN]
WANT_Q1 = {NAV: 270000, ARJ: 101646, SAM: 59211, DIN: 36972, ANI: 36141, JAT: 30459, RAK: 30459, SUB: 2576}
WANT_Q2 = {NAV: 270000, ARJ: 101646, SAM: 83869, DIN: 36972, ANI: 36141, JAT: 30459, RAK: 30459, SUB: 27765}
assert sum(WANT_Q1.values()) == 567464 and sum(WANT_Q2.values()) == 617311

def payroll_tables(pay=PAY, months=M):
    T = {k: [] for k in ("tally_vouchers", "tally_lines", "tally_employees", "tally_ledgers", "tally_cost_allocs", "tally_salary_pays")}
    for n, (nm, typ, stat, it, par) in enumerate([
            (B, "Earnings for Employees", "Variable", "Basic Salary", "Employee Benfit Expenses"), (H, "Earnings for Employees", "Fixed", "House Rent Allowance", "Employee Benfit Expenses"),
            (SA, "Earnings for Employees", "Variable", "", "Employee Benfit Expenses"), (CV, "Earnings for Employees", "Variable", "", "Employee Benfit Expenses"),
            (ARR, "Reimbursements to Employees", "Variable", "", "Employee Benfit Expenses"), (GMC, "Deductions From Employees", "", "", "Employee Benfit Expenses"),
            (PF, "Employees' Statutory Deductions", "PF Account (A/c No. 1)", "", "EPF & ESIC PAYABLE"), (TDS_, "Deductions From Employees", "", "", "TDS"),
            ("Salary Payable", "", "", "", "Short Term Provision")]):
        T["tally_ledgers"].append({"book_id": BOOK, "for_payroll": True, "name": nm, "pay_type": typ, "pay_stat_type": stat, "it_component": it})
    for i, e in enumerate(EMPS):
        T["tally_employees"].append({"book_id": BOOK, "guid": "li-emp-%02d" % i, "name": e, "parent": "LI Staff", "category": "Primary Cost Category", "is_group": False,
                                     "pan": PAN.get(e, ""), "joined": "2024-04-01", "left_on": None, "designation": "Officer", "gone_at": None})
    for k, m in enumerate(months):
        g, alt = "li-pay-%s" % m, 37000 + k
        T["tally_vouchers"].append({"guid": g, "alter_id": alt, "day": m, "vtype": "Payroll", "vno": str(k + 1), "party": "Salary Payable", "cancelled": False, "optional": False,
                                    "deleted_at": None, "book_id": BOOK, "narration": "", "gstin": "", "cmp_gstin": "", "pos": "", "ref": "", "ref_date": "", "tds_tally": None, "tds_tally_alter_id": ""})
        tot = {}
        for e, hs in pay[m].items():
            for h, a in hs.items():
                T["tally_cost_allocs"].append({"guid": g, "alter_id": str(alt), "day": m, "ledger": h, "centre": e, "amount": str(a), "gone_at": None, "book_id": BOOK})
                tot[h] = tot.get(h, 0) + a
        for h, a in tot.items(): T["tally_lines"].append({"guid": g, "ledger": h, "amount": str(a), "rate": "", "hsn": "", "book_id": BOOK})
        T["tally_lines"].append({"guid": g, "ledger": "Salary Payable", "amount": str(-sum(tot.values())), "rate": "", "hsn": "", "book_id": BOOK})
        # each employee's net paid from "Salary <name>" (a ledger under Salary Payable), the next week
        for e, hs in pay[m].items():
            T["tally_salary_pays"].append({"guid": "li-sp-%s" % m, "alter_id": str(alt + 100), "day": m[:8] + "07", "ledger": "DBS Bank", "employee": e, "amount": str(-sum(hs.values())), "paid_on": m[:5] + "%02d" % (int(m[5:7]) % 12 + 1) + "-07", "gone_at": None})
        T["tally_vouchers"].append({"guid": "li-sp-%s" % m, "alter_id": alt + 100, "day": m[:8] + "07", "vtype": "Payment", "vno": "P%d" % k, "party": "DBS Bank", "cancelled": False, "optional": False,
                                    "deleted_at": None, "book_id": BOOK, "narration": "", "gstin": "", "cmp_gstin": "", "pos": "", "ref": "", "ref_date": "", "tds_tally": None, "tds_tally_alter_id": ""})
    return T

def journal(guid, day, lines, vtype="Journal"):
    v = {"guid": guid, "alter_id": 900, "day": day, "vtype": vtype, "vno": guid[-3:], "party": "", "cancelled": False, "optional": False, "deleted_at": None, "book_id": BOOK,
         "narration": "salary", "gstin": "", "cmp_gstin": "", "pos": "", "ref": "", "ref_date": "", "tds_tally": None, "tds_tally_alter_id": ""}
    return v, [{"guid": guid, "ledger": l, "amount": str(a), "rate": "", "hsn": "", "book_id": BOOK} for l, a in lines]

LOAD = """(a) => {
  const c = newCompany({name: a.name}); c.tan = "DELL01234E"; c.pan = "AAACL1234Q"; S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const T = a.tables, b = {cid: c.id, loading: false, vouchers: [], meta: {from: "20260401", to: "20270331"}, challans: [], alloc: {}, certs: [],
    under: a.under || {}, groups: a.groups || {}, pans: a.pans || {}, panFix: a.panFix || {}};
  S.books = b;
  BookSrc.apply(b, T.tally_vouchers, T.tally_lines, []);
  b.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(b);
  if (T.tally_employees.length) Payroll.take(b, {book: "x", employees: T.tally_employees, heads: T.tally_ledgers, allocs: T.tally_cost_allocs, pays: T.tally_salary_pays, vouchers: T.tally_vouchers});
  S.booksTab = "tds"; S.tdsFy = "2026-27"; S.tdsView = "return"; S.tdsForm = "24Q"; S.tdsQ = "Q1"; S.tdsTab = "deductions"; render();
}"""
Q = """([fy, q]) => { const rows = TDS.salaryRows().filter(r => r.fy === fy && r.q === q), by = {};
  rows.forEach(r => { const k = r.employee || r.party || ""; by[k] = Math.round(((by[k] || 0) + r.tds) * 100) / 100; });
  return {by, n: rows.length, tds: Math.round(rows.reduce((s, r) => s + r.tds, 0) * 100) / 100, unsplit: rows.filter(r => r.unsplit).map(r => r.tds),
    rows: rows.map(r => ({e: r.employee || r.party, pan: r.pan, paid: r.paid, tds: r.tds, date: r.date, src: r.from || r.src, note: r.note || "", unsplit: !!r.unsplit}))}; }"""

def load(pg, tables, **kw):
    pg.evaluate(LOAD, dict({"name": "LI Leads-like Co", "tables": tables}, **kw)); pg.wait_for_timeout(500)

srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)

        print("== 1. Leads-like payroll, TDS pay head with a blank statutory type")
        load(pg, payroll_tables())
        ok(pg.evaluate("Payroll.isTds('TDS 192B') && !Payroll.isTds('Gmc') && !Payroll.isTds('PF Employee Contribution')"), "\"TDS 192B\" (Deductions From Employees, statutory type blank) is the TDS head; Gmc and PF are not")
        q1 = pg.evaluate(Q, ["2026-27", "Q1"])
        ok(q1["tds"] == 567464, "Form 138 Q1 TDS ₹5,67,464 (%s)" % q1["tds"])
        ok({k: v for k, v in q1["by"].items() if v} == WANT_Q1, "each employee's Q1 TDS as in Tally (%s)" % json.dumps(q1["by"]))
        ok(not q1["unsplit"], "nothing left unsplit")
        months = pg.evaluate("() => { const by = {}; TDS.salaryRows().filter(r => r.fy === '2026-27').forEach(r => { const m = TDS.ymd(r.date).slice(0, 6); by[m] = Math.round(((by[m] || 0) + r.tds) * 100) / 100; }); return by; }")
        ok(months == {"202604": 188296, "202605": 188296, "202606": 190872, "202607": 197551, "202608": 209880, "202609": 209880}, "each month's TDS = the books' TDS 192B line (%s)" % months)
        q2 = pg.evaluate(Q, ["2026-27", "Q2"])
        ok(q2["tds"] == 617311 and {k: v for k, v in q2["by"].items() if v} == WANT_Q2, "Q2 ₹6,17,311, each employee as in Tally (%s)" % json.dumps(q2["by"]))
        reg = pg.evaluate("Payroll.register('202604').rows.reduce((s, r) => s + r.tds, 0)")
        ok(reg == 188296, "the pay register's TDS for April ₹1,88,296 (%s)" % reg)
        y = pg.evaluate("Payroll.yearOf(Payroll.empByName('LI Naveen Rawat'), '2026-27').tds")
        ok(y == 540000, "Form 16 / Annexure II: the year's TDS of an employee (%s)" % y)
        pg.wait_for_timeout(300)
        strip = pg.inner_text("#app")
        # next-tds-tidy2: no summary strip; the return's TDS is in the Deductees table's foot
        pg.evaluate("() => { S.tdsTab = 'deductees'; render(); }"); pg.wait_for_timeout(300)
        ok(pg.evaluate("+((document.querySelector('#app [data-dee-tds]') || {dataset: {}}).dataset.deeTds || 0)") == 567464 and "5,67,464" in pg.inner_text("#app [data-dee-total]"),
           "the Form 138 Q1 page shows TDS ₹5,67,464 (Employees' foot)")
        pg.evaluate("() => { S.tdsTab = 'deductions'; S.tdsDedView = 'table'; render(); }"); pg.wait_for_timeout(300)
        ok(pg.locator('[data-list="q24Annex1"] tbody tr').count() == q1["n"], "Annexure I (Deductions › ⋯): one row per employee per month with pay (%d)" % q1["n"])
        pg.evaluate("() => { S.tdsDedView = ''; render(); }")
        pg.screenshot(path=os.path.join(OUT, "q1-deductions.png"), full_page=True)

        print("== 2. the choice: \"This pay head is TDS\"")
        pg.evaluate("() => { S.tdsTab = 'people'; render(); }"); pg.wait_for_timeout(300)
        ok(pg.locator('[data-pay-tds-heads]').count() == 1 and "TDS 192B" in pg.inner_text('[data-pay-tds-heads]'), "the payroll page says which pay head is TDS (TDS 192B)")
        pg.click('[data-pay-tds-no="TDS 192B"]'); pg.wait_for_timeout(300)
        ok(not pg.evaluate("Payroll.isTds('TDS 192B')"), "\"Not TDS\": the head is no longer TDS")
        nt = pg.evaluate(Q, ["2026-27", "Q1"])
        ok(nt["tds"] == 567464 and sum(nt["unsplit"]) == 567464, "then the books' 192 line is kept as \"TDS not split by employee\" (never dropped): %s" % nt["unsplit"])
        ok(pg.locator('[data-pay-tds-yes="TDS 192B"]').count() == 1 and pg.locator('[data-pay-tds-yes="Gmc"]').count() == 1, "the deduction heads are offered: \"This pay head is TDS\"")
        pg.click('[data-pay-tds-yes="TDS 192B"]'); pg.wait_for_timeout(300)
        m = pg.evaluate("S.books.map['TDS 192B']")
        ok(pg.evaluate("Payroll.isTds('TDS 192B')") and m.get("payTds") is True and m.get("ok") and m.get("byHand"), "chosen: kept in the ledger map as a confirmed choice (%s)" % {k: m.get(k) for k in ("payTds", "ok", "byHand", "section")})
        ok(pg.evaluate(Q, ["2026-27", "Q1"])["by"].get(NAV) == 270000, "and the employees' TDS is back")
        # the same choice for a head whose name says nothing
        load(pg, payroll_tables(), )
        pg.evaluate("() => { const h = S.books.payroll.heads; h['Tax Cut'] = h['TDS 192B']; delete h['TDS 192B']; S.books.payroll.allocs.forEach(a => { if (a.head === 'TDS 192B') a.head = 'Tax Cut'; }); render(); }")
        ok(not pg.evaluate("Payroll.isTds('Tax Cut')"), "a head named \"Tax Cut\" is not taken as TDS by itself")
        pg.evaluate("() => payTdsHead('Tax Cut', true)")
        ok(pg.evaluate("Payroll.isTds('Tax Cut')") and pg.evaluate("Payroll.register('202604').rows.reduce((s, r) => s + r.tds, 0)") == 188296, "\"This pay head is TDS\" on it: the register's TDS follows")

        print("== 3. an employee's TDS missing from the split")
        import copy
        p3 = copy.deepcopy(PAY); del p3["2026-06-30"][SUB][TDS_]
        T3 = payroll_tables(p3)
        for l in T3["tally_lines"]:
            if l["guid"] == "li-pay-2026-06-30" and l["ledger"] == TDS_: l["amount"] = "190872"
            if l["guid"] == "li-pay-2026-06-30" and l["ledger"] == "Salary Payable": l["amount"] = str(float(l["amount"]) - 2576)
        load(pg, T3)
        q3 = pg.evaluate(Q, ["2026-27", "Q1"])
        ok(q3["tds"] == 567464 and q3["unsplit"] == [2576], "the June entry's 2,576 not split by employee is kept as its own row (%s)" % q3["unsplit"])
        # next-tds-register: the deductions on no challan are in the Deductions register's Pending tab
        pg.evaluate("() => { S.tdsTab = 'deductions'; S.tdsDedReg = 'pending'; render(); }"); pg.wait_for_timeout(400)
        t3 = pg.inner_text("#app")
        ok("TDS not split by employee" in t3, "the row is said: \"TDS not split by employee\"")
        pg.evaluate("() => { S.tdsDedReg = ''; render(); }")
        ok(pg.locator('[data-pay-split]').count() == 1 and "5,64,888" in pg.inner_text('[data-pay-split]') and "5,67,464" in pg.inner_text('[data-pay-split]'), "the header says deducted ₹5,67,464 · split by employee ₹5,64,888")
        chk = pg.evaluate("Payroll.checks('2026-27', 'Q1').map(c => c.what)")
        ok(any("not split" in c for c in chk), "a check before filing names it (%s)" % chk)
        fe = pg.evaluate("TDS24Q_FILE.rowsOf('2026-27', 'Q1').error || ''")
        ok("not split by employee" in fe, "the file is not made with TDS not split by employee (%s)" % fe[:90])

        print("== 4. arrears")
        load(pg, payroll_tables())
        jat = pg.evaluate("TDS.salaryRows().filter(r => r.employee === 'LI Jatin Kohli' && TDS.ymd(r.date) === '20260531')[0]")
        ok(jat and jat["paid"] == 148000 and "arrear" in (jat.get("note") or "").lower(), "\"Arears\" (typed reimbursement) counts in the salary paid: 1,48,000 with a note (%s)" % str(jat and (jat["paid"], jat.get("note"))))
        ok(pg.evaluate("Payroll.register('202605').rows.find(r => r.employee === 'LI Jatin Kohli').gross") == 148000, "and in the register's gross")

        print("== 5. PAN fallbacks and Add PAN")
        load(pg, payroll_tables())
        npn = pg.evaluate("TDS.salaryRows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.tds > 0 && !Certs.validPan(r.pan)).map(r => r.employee)")
        ok(sorted(set(npn)) == sorted([DIN, ANI, SUB]), "without fallbacks: 3 employees with TDS have no PAN (%s)" % sorted(set(npn)))
        load(pg, payroll_tables(), panFix={DIN: {"pan": "HSRPS4108S", "source": "fincom"}}, pans={"Salary " + ANI: "JTQPJ4109T"})
        pans = pg.evaluate("(() => { const o = {}; TDS.salaryRows().filter(r => r.fy === '2026-27' && r.tds > 0).forEach(r => { o[r.employee] = r.pan; }); return o; })()")
        ok(pans.get(NAV) == PAN[NAV], "Tally's employee PAN first")
        ok(pans.get(DIN) == "HSRPS4108S", "else the PAN book by the employee's name (%s)" % pans.get(DIN))
        ok(pans.get(ANI) == "JTQPJ4109T", "else the PAN of the \"Salary <name>\" ledger (%s)" % pans.get(ANI))
        pg.evaluate("() => { S.tdsTab = 'deductions'; render(); }"); pg.wait_for_timeout(300)
        ok(pg.locator('[data-pay-nopan]').count() == 1 and "PAN missing for 1 employee with TDS" in pg.inner_text('[data-pay-nopan]'), "\"PAN missing for 1 employee with TDS\" (%s)" % (pg.locator('[data-pay-nopan]').all_inner_texts()[:1]))
        box = '[data-pay-nopan] [data-pan-box="%s"] input' % SUB
        ok(pg.locator(box).count() == 1, "with Add PAN for the employee")
        pg.fill(box, "KUWPC4110U"); pg.press(box, "Enter"); pg.wait_for_timeout(400)
        ok(pg.evaluate("TDS.panRec('%s') && TDS.panRec('%s').pan" % (SUB, SUB)) == "KUWPC4110U", "saved to the PAN book")
        ok(pg.locator('[data-pay-nopan]').count() == 0 and pg.evaluate("TDS.salaryRows().filter(r => r.employee === '%s' && r.tds > 0).every(r => r.pan === 'KUWPC4110U')" % SUB), "and used: no PAN missing now")
        pg.screenshot(path=os.path.join(OUT, "q1-pan.png"), full_page=True)

        print("== 6. salary kept without payroll: journals with \"TDS on Salary\"")
        V, L = [], []
        def add(*a, **k):
            v, l = journal(*a, **k); V.append(v); L.extend(l)
        # April: one journal per employee
        add("np-0401", "2026-04-30", [("Salaries", -100000), ("TDS on Salary", 10000), ("Salary Ram Prakash", 90000)])
        add("np-0402", "2026-04-30", [("Salaries", -60000), ("TDS on Salary", 3000), ("Salary Meena Gupta", 57000)])
        add("np-0403", "2026-04-30", [("Salaries", -40000), ("Salary Vikram Rao", 40000)])
        # May: one journal for the three, an expense line for each
        add("np-0501", "2026-05-31", [("Salaries", -100000), ("Salaries", -60000), ("Salaries", -45000), ("TDS on Salary", 14000),
                                      ("Salary Ram Prakash", 90000), ("Salary Meena Gupta", 57000), ("Salary Vikram Rao", 44000)])
        # June: tax deducted when paying: Salary <name> Dr, TDS on Salary Cr, bank Cr
        add("np-0601", "2026-06-07", [("Salary Ram Prakash", -100000), ("TDS on Salary", 10000), ("HDFC Bank", 90000)], vtype="Payment")
        NP = {k: [] for k in ("tally_employees", "tally_ledgers", "tally_cost_allocs", "tally_salary_pays")}; NP["tally_vouchers"] = V; NP["tally_lines"] = L
        load(pg, NP, name="NP Salary Journal Co", under={"Salary Ram Prakash": "Salary Payable", "Salary Meena Gupta": "Salary Payable", "Salary Vikram Rao": "Salary Payable", "HDFC Bank": "Bank Accounts", "Salaries": "Indirect Expenses"},
             groups={"Salary Payable": "Current Liabilities", "Bank Accounts": "Current Assets", "Indirect Expenses": ""}, pans={"Salary Ram Prakash": "LMNPR4111V"})
        ok(pg.evaluate("Books.ledgerOf('TDS on Salary').kind === 'tds_payable' && /^192/.test(Books.ledgerOf('TDS on Salary').section)"), "\"TDS on Salary\" (no section in its name) is read as TDS under 192 (%s)" % pg.evaluate("JSON.stringify(Books.ledgerOf('TDS on Salary'))"))
        ok(pg.evaluate("TDS.rows().every(r => r.ledger !== 'TDS on Salary')"), "and it is not a 26Q deduction")
        n1 = pg.evaluate(Q, ["2026-27", "Q1"])
        apr = sorted((r["e"], r["paid"], r["tds"]) for r in n1["rows"] if r["date"].startswith("202604") and r["tds"] > 0)
        ok(apr == [("Meena Gupta", 60000, 3000), ("Ram Prakash", 100000, 10000)], "April: a row per employee with TDS, from the \"Salary <name>\" ledger (%s)" % apr)
        may = sorted((r["e"], r["paid"], r["tds"]) for r in n1["rows"] if r["date"].startswith("202605"))
        ok(may == [("Meena Gupta", 60000, 3000), ("Ram Prakash", 100000, 10000), ("Vikram Rao", 45000, 1000)], "May, one journal for three: 3 employee rows, the gross from each expense line (%s)" % may)
        jun = [(r["e"], r["paid"], r["tds"]) for r in n1["rows"] if r["date"].startswith("202606")]
        ok(jun == [("Ram Prakash", 100000, 10000)], "June, deducted on payment: the employee debited (%s)" % jun)
        ok(n1["tds"] == 37000 and not n1["unsplit"], "Q1 ₹37,000, all by employee")
        ok(all(r["pan"] == "LMNPR4111V" for r in n1["rows"] if r["e"] == "Ram Prakash"), "the PAN of the \"Salary <name>\" ledger")
        # next-tds-register: with no challan, the employees' rows are in the Deductions register's Pending tab
        pg.evaluate("() => { S.tdsTab = 'deductions'; S.tdsDedReg = 'pending'; render(); }"); pg.wait_for_timeout(400)
        t6 = pg.inner_text("#app")
        ok("Ram Prakash" in t6 and "Meena Gupta" in t6, "the Form 138 Deductions step lists the employees")
        pg.evaluate("() => { S.tdsDedReg = ''; render(); }")
        # next-tds-tidy2: the TDS (it was the summary strip's) in the Employees table's foot
        pg.evaluate("() => { S.tdsTab = 'deductees'; render(); }"); pg.wait_for_timeout(300)
        ok("37,000" in pg.inner_text("#app [data-dee-total]"), "the Form 138 page shows ₹37,000 (Employees' foot)")
        pg.evaluate("() => { S.tdsTab = 'deductions'; render(); }"); pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(OUT, "nonpayroll.png"), full_page=True)

        print("== 7. a year of payroll months and journal months")
        T7 = payroll_tables(PAY, M[:5])
        v1, l1 = journal("mx-0930a", "2026-09-30", [("Salaries", -248500), ("TDS on Salary", 90000), ("Salary " + NAV, 158500)])
        v2, l2 = journal("mx-0930b", "2026-09-30", [("Salaries", -231513), ("TDS on Salary", 33882), ("Salary " + ARJ, 197631)])
        T7["tally_vouchers"] += [v1, v2]; T7["tally_lines"] += l1 + l2
        load(pg, T7)
        q7 = pg.evaluate(Q, ["2026-27", "Q2"])
        sep = sorted((r["e"], r["tds"], r["src"]) for r in q7["rows"] if r["date"].startswith("202609"))
        ok(sep == [(ARJ, 33882, "books"), (NAV, 90000, "books")], "September from the journals, by employee (%s)" % sep)
        ok(q7["tds"] == 197551 + 209880 + 123882 and q7["by"][NAV] == 270000, "Q2: July and August from payroll, September from the books (%s)" % q7["tds"])
        ok(pg.evaluate("Payroll.annexI('2026-27', 'Q2').length") == q7["n"], "Annexure I carries both")
        ok(pg.evaluate("Payroll.yearOf(Payroll.empByName('LI Naveen Rawat'), '2026-27').tds") == 540000, "the year's TDS of an employee counts the journal month too")
        ok(pg.evaluate("TDS.salarySource('2026-27')") == "payroll", "the year's source stays Tally's payroll")

        print("== 9. salary payments and the TDS deposit are not deductions (Leads, Q1 2026-27)")
        def leads_tables():
            T = payroll_tables()
            def vch(g, day, vt, no):
                T["tally_vouchers"].append({"guid": g, "alter_id": 5000 + len(T["tally_vouchers"]), "day": day, "vtype": vt, "vno": no, "party": "DBS Bank", "cancelled": False, "optional": False,
                                            "deleted_at": None, "book_id": BOOK, "narration": "", "gstin": "", "cmp_gstin": "", "pos": "", "ref": "", "ref_date": "", "tds_tally": None, "tds_tally_alter_id": ""})
            def alloc(g, day, led, cen, amt): T["tally_cost_allocs"].append({"guid": g, "alter_id": str(next(x["alter_id"] for x in T["tally_vouchers"] if x["guid"] == g)), "day": day, "ledger": led, "centre": cen, "amount": str(amt), "gone_at": None, "book_id": BOOK})
            def line(g, led, amt): T["tally_lines"].append({"guid": g, "ledger": led, "amount": str(amt), "rate": "", "hsn": "", "book_id": BOOK})
            # one NEFT a person on the 7th (as Leads pays): the March salary on 7-Apr, April's on 7-May, May's on 7-Jun;
            # Tally allocates the "Salary Payable" debit to the employee as a cost centre
            for day, src in (("2026-04-07", "2026-04-30"), ("2026-05-07", "2026-04-30"), ("2026-06-07", "2026-05-31")):
                for i, (e, hs) in enumerate(sorted(PAY[src].items())):
                    net = -sum(hs.values()); g = "li-neft-%s-%02d" % (day, i)
                    vch(g, day, "Payment", "N%s%02d" % (day[5:7], i)); line(g, "Salary Payable", -net); line(g, "DBS Bank", net); alloc(g, day, "Salary Payable", e, -net)
            # the TDS deposits: TDS 192B debited from the bank (one allocated to an employee's cost centre too)
            for day, amt, cen in (("2026-04-30", 161563, "1Primary Cost"), ("2026-05-12", 188296, NAV), ("2026-06-06", 188296, "1Primary Cost")):
                g = "li-tdsdep-" + day; vch(g, day, "Payment", "T" + day[5:7]); line(g, "TDS 192B", -amt); line(g, "DBS Bank", amt); alloc(g, day, "TDS 192B", cen, -amt)
            return T
        load(pg, leads_tables())
        l1 = pg.evaluate(Q, ["2026-27", "Q1"])
        days = sorted(set(r["date"] for r in l1["rows"]))
        ok(days == ["20260430", "20260531", "20260630"], "Form 138 Q1 rows dated the payroll entries only, no 7-Apr / 7-May / 7-Jun salary payment, no 30-Apr deposit (%s)" % days)
        per = {}
        for r in l1["rows"]: per[(r["e"], r["date"][:6])] = per.get((r["e"], r["date"][:6]), 0) + 1
        ok(l1["n"] == q1["n"] and max(per.values()) == 1, "one row per employee per payroll month (%d rows, as without the payments: %d)" % (l1["n"], q1["n"]))
        ok(l1["tds"] == 567464 and {k: v for k, v in l1["by"].items() if v} == WANT_Q1 and not l1["unsplit"], "Q1 TDS ₹5,67,464, each employee as in Tally (%s)" % l1["tds"])
        ok(all(r["tds"] >= 0 for r in l1["rows"]), "no negative TDS row from a deposit")
        ok(pg.evaluate("Payroll.register('202604').rows.reduce((s, r) => s + r.gross, 0)") == pg.evaluate("Object.values(%s).reduce((s, h) => s - Object.entries(h).filter(([k]) => /Basic|HRA|Special|Conveyance/.test(k)).reduce((a, [, v]) => a + v, 0), 0)" % json.dumps(PAY["2026-04-30"])),
           "the pay register's April gross is the payroll's (no salary payment in it)")
        y9 = pg.evaluate("(() => { const s = Payroll.yearOf(Payroll.empByName('LI Naveen Rawat'), '2026-27'); return [s.tds, s.months, s.gross]; })()")
        ok(y9[0] == 540000 and y9[1] == 6, "Form 16 / Annexure II: the year's TDS and months of an employee are the payroll's (%s)" % y9)

        print("== 10. Form 138's Deductions step: Select challan, Add, tick and move, Remove")
        pg.evaluate("""() => { S.books.challans = [
            {id: 'c24a', bsr: '0510308', serial: '80146', date: '2026-05-07', section: '192', tax: 188296, interest: 0, fee: 0, others: 0},
            {id: 'c24b', bsr: '0510308', serial: '86163', date: '2026-06-06', section: '192', tax: 188296, interest: 0, fee: 0, others: 0},
            {id: 'c24c', bsr: '0510308', serial: '95365', date: '2026-07-06', section: '192', tax: 190872, interest: 0, fee: 0, others: 0}];
          TDSReg.forget(); S.tdsTab = 'deductions'; S.tdsDedView = ''; S.tdsWinCh = 'c24a'; render(); }""")
        pg.wait_for_timeout(500)
        opts = pg.evaluate("[...document.querySelectorAll('#app [data-wd-sel] option')].map(o => o.value)")
        # next-tds-register: no "Not on any challan" (the Deductions register's Pending tab is the place)
        ok(opts == ["c24a", "c24b", "c24c"] and pg.locator('#app [data-dreg-open]').count() == 1, "Select challan lists the 192 challans only; Deductions N opens the register (%s)" % opts)
        ok(pg.locator('#app [data-wd-table="c24a"]').count() == 1 and pg.locator('#app [data-wd-add-open="c24a"]').count() == 1, "the chosen challan's table, with + Add deduction to this challan")
        pg.click('#app [data-wd-add-open="c24a"]'); pg.wait_for_timeout(400)
        apr = pg.evaluate("TDS.formRows('24Q').filter(r => r.fy === '2026-27' && TDS.ymd(r.date).startsWith('202604') && r.tds > 0.005).map(r => r.id)")
        ok(pg.locator('[data-wd-addlist="c24a"] [data-wd-cand]').count() >= len(apr) > 0, "the deductions not on a challan are offered (%d April rows)" % len(apr))
        for rid in apr: pg.check('[data-wd-addlist] [data-wd-tick="%s"]' % rid)
        pg.wait_for_timeout(200)
        bk = pg.evaluate("() => { const b = document.querySelector('[data-wd-bulk]'); return b ? [+b.dataset.wdBulk, +b.dataset.tot, +b.dataset.after] : null; }")
        ok(bk == [len(apr), 188296, 0], "ticked April's rows: TDS ₹1,88,296, balance after ₹0 (%s)" % bk)
        pg.click('[data-wd-bulk-move]'); pg.wait_for_timeout(500)
        pg.evaluate("() => { S.tdsWinAdd = ''; render(); }"); pg.wait_for_timeout(300)
        ft = pg.evaluate("() => { const f = document.querySelector('#app [data-wd-foot]'); return f ? [+f.dataset.here, +f.dataset.bal, +f.dataset.n] : null; }")
        ok(ft == [188296, 0, len(apr)], "on the challan: Used here ₹1,88,296, Balance ₹0, %d deductions (%s)" % (len(apr), ft))
        ok(pg.evaluate("TDS.formRows('24Q').filter(r => r.challan === 'c24a').length") == len(apr), "each April row now carries the challan")
        one = apr[0]; t1 = pg.evaluate("(id) => TDS.formRows('24Q').find(r => r.id === id).tds", one)
        pg.check('#app [data-wd-rtick="%s"]' % one); pg.wait_for_timeout(200); pg.click('#app [data-wd-bulk-off]'); pg.wait_for_timeout(400)
        ft2 = pg.evaluate("() => { const f = document.querySelector('#app [data-wd-foot]'); return [+f.dataset.bal, +f.dataset.n]; }")
        ok(ft2 == [t1, len(apr) - 1], "Remove from challan: the balance back to ₹%s, one row fewer (%s)" % (t1, ft2))
        ok(pg.locator('#app [data-wd-more]').count() == 1, "Annexure I is under ⋯")
        pg.screenshot(path=os.path.join(OUT, "q1-by-challan.png"), full_page=True)

        print("== 11. next-24q-load (Leads, Form 138 showed 1 entry, no employees): reopened with nothing new in the cloud")
        # the copy kept in this browser had no payroll (BOOKS_KEYS) and TCloud.load returned before Payroll.into when no day
        # had changed: Form 138 fell back to the books' one "TDS 192B" row per payroll entry, the only rows with challans
        load(pg, leads_tables())
        RE = """async (a) => {
          const b = S.books, T = a.tables; delete b.payroll; b.allocLog = [];
          const ch = (id, serial, date, tax) => ({id, bsr: '0510308', serial, date, section: '192', tax, interest: 0, fee: 0, others: 0});
          b.challans = [ch('c40404', '40404', '2026-05-07', 188296), ch('c10101', '10101', '2026-06-06', 188296), ch('csmall', '77777', '2026-07-06', 1000)];
          b.alloc = {'li-pay-2026-04-30|TDS 192B': 'c40404', 'li-pay-2026-05-31|TDS 192B': 'c10101', 'li-pay-2026-06-30|TDS 192B': 'csmall'};
          TDSReg.forget(); S.tdsTab = 'deductions'; render();
          const rows = () => TDS.salaryRows().filter(r => r.fy === '2026-27' && r.q === 'Q1');
          const st = () => ({has: Payroll.has('2026-27'), n: rows().length, named: rows().filter(r => r.src === 'payroll' && !r.unsplit && r.employee && r.tds > 0.005).length,
            unsplit: rows().filter(r => r.unsplit || /not split/i.test(r.party || '')).length, tally: ((document.querySelector('#app [data-tab-count="deductions"]') || {}).textContent || '') + '/' + ((document.querySelector('#app [data-tab-count="deductees"]') || {}).textContent || ''), pans: rows().filter(r => a.pans[r.employee] && r.pan !== a.pans[r.employee]).length,
            on: Object.fromEntries(['c40404', 'c10101', 'csmall'].map(c => [c, TDS.formRows('24Q').filter(r => r.challan === c).map(r => r.tds)]))});
          const before = st();
          // the cloud as on a reopen with nothing new: the same days, the same ledgers, no entry the bridge sent
          b.meta = Object.assign(b.meta || {}, {cloud: {book: a.book, company: 'LI', ledgersAt: 'L1', days: {'20260430': 'x'}, at: ''}});
          TCloud.on = () => true;
          TCloud.status = async () => [{book: a.book, company: 'LI', from: '2026-04-01', entries: 50, ledgersAt: 'L1'}];
          TCloud.rpcAll = async () => [{day: '20260430', n: 1, at: 'x'}];
          TCloud.copyHeads = async () => ({changes: 0, seen: ''});
          TCloud.restPages = async (path) => (T[path.split('?')[0]] || []).map(r => Object.assign({}, r));
          const res = await TCloud.load(true);
          await new Promise(ok => setTimeout(ok, 300)); TDSReg.forget(); render();
          const after = st();
          await saveBooks({fromCloud: true});
          const saved = await Books.load(b.cid);
          return {before, after, res, saved: !!(saved && saved.payroll && saved.payroll.allocs.length), work: 'payroll' in BookSync.work(b),
            log: (b.allocLog || []).filter(l => /carried from the month's total/.test(l.note)).map(l => [l.ch, l.tax]),
            months: Object.fromEntries(['202604', '202605', '202606'].map(m => [m, rows().filter(r => String(r.date).startsWith(m) && r.tds > 0.005).length]))};
        }"""
        rr = pg.evaluate(RE, {"tables": leads_tables(), "book": BOOK, "pans": PAN}); pg.wait_for_timeout(400)
        print("     before: %s" % json.dumps(rr["before"]))
        ok(rr["res"] is True, "TCloud.load(true) with nothing new still returns true (%s)" % rr["res"])
        ok(rr["after"]["has"] and rr["after"]["tally"] == "34/12", "after the reopen Form 138 is Tally's payroll return again: Deductions 34 (every employee paid), employees 12 (was %s; now %s)" % (rr["before"]["tally"], rr["after"]["tally"]))
        ok(rr["months"] == {"202604": 7, "202605": 7, "202606": 8} and rr["after"]["named"] == 22 and rr["after"]["unsplit"] == 0 and rr["after"]["pans"] == 0,
           "one row per employee with TDS a month, by name, each PAN as in Tally (%s; %d named, %d unsplit, %d PAN wrong)" % (rr["months"], rr["after"]["named"], rr["after"]["unsplit"], rr["after"]["pans"]))
        a40, a10 = rr["after"]["on"]["c40404"], rr["after"]["on"]["c10101"]
        ok(len(a40) == 7 and round(sum(a40), 2) == 188296 and len(a10) == 7 and round(sum(a10), 2) == 188296,
           "challans 40404 / 10101 carry their month's employee rows (%d rows %s / %d rows %s)" % (len(a40), round(sum(a40), 2), len(a10), round(sum(a10), 2)))
        ok(rr["after"]["on"]["csmall"] == [], "a challan smaller than the month's TDS: nothing carried, left for the matcher (%s)" % rr["after"]["on"]["csmall"])
        ok(len(rr["log"]) == 14 and {c for c, _ in rr["log"]} == {"c40404", "c10101"}, "each carry in the audit trail as \"carried from the month's total\" (%d)" % len(rr["log"]))
        ok(rr["saved"] and not rr["work"], "the payroll is kept in this browser's copy, never in the work sent to the firm's database")
        pg.screenshot(path=os.path.join(OUT, "reopen-24q.png"), full_page=True)

        # next-24q-ready (Leads, after next-24q-load went live: "in private window it is not showing.. sometimes in normal
        # window 24Q is not showing", then "now automatically showing"): the page was drawn before the payroll was read and
        # only came right on a later read. Opening a 24Q page reads the payroll itself (PayLoad.ensure, one read at a time),
        # says "Reading payroll from FinCom's copy of Tally…" meanwhile, and a payroll kept here is checked before it is used
        STUB = """(a) => {
          const T = a.tables, b = S.books, cid = b.cid; let fail = a.fail || 0;
          window.__pay = {reads: 0, seen: []};
          TCloud.on = () => true; delete TCloud.st[cid];
          TCloud.status = async (c) => { await new Promise(ok => setTimeout(ok, a.statusMs || 0)); const bs = [{book: a.book, company: 'LI', from: '2026-04-01', entries: 50, ledgersAt: 'L1'}]; TCloud.st[c] = {books: bs, at: Date.now()}; return bs; };
          TCloud.rpcAll = async () => [{day: '20260430', n: 1, at: 'x'}];
          TCloud.copyHeads = async () => ({changes: 0, seen: ''});
          TCloud.restPages = async (path) => {
            // the payroll's first read slow (a.delay), the rest at once
            if (/^tally_employees/.test(path)){ window.__pay.reads++; if (fail > 0){ fail--; throw new Error("FinCom's cloud did not answer (503)."); } await new Promise(ok => setTimeout(ok, a.delay || 0)); }
            return (T[path.split('?')[0]] || []).map(r => Object.assign({}, r)); };
          b.meta = Object.assign(b.meta || {}, {cloud: {book: a.book, company: 'LI', ledgersAt: 'L1', days: {'20260430': 'x'}, at: ''}});
          clearInterval(window.__payT);
          window.__payT = setInterval(() => { const app = document.querySelector('#app'), t = app ? app.innerText : '';
            window.__pay.seen.push({sheet: /Bring in the salary sheet|needs the salary sheet/.test(t), loader: !!document.querySelector('#app [data-pay-loading]'),
              said: /Reading payroll from FinCom.s copy of Tally/.test(t), err: !!document.querySelector('#app [data-pay-load-err]'),
              tally: ((document.querySelector('#app [data-tab-count="deductions"]') || {}).textContent || '') + '/' + ((document.querySelector('#app [data-tab-count="deductees"]') || {}).textContent || '')}); }, 50);
        }"""
        OPEN24 = "() => { window.__pay.seen = []; S.tdsView = 'return'; S.tdsForm = '24Q'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsTab = 'deductees'; TDSReg.forget(); render(); }"
        SEEN = "() => window.__pay.seen"
        # the books opened before the cloud is reachable (the stubs below put it on)
        OFF = lambda: pg.evaluate("() => { TCloud.on = () => false; }")
        print("== 12. next-24q-ready (a): a cold open, the payroll read slowly (2.5 s)")
        OFF(); load(pg, leads_tables())
        pg.evaluate("() => { delete S.books.payroll; render(); }")
        pg.evaluate(STUB, {"tables": leads_tables(), "book": BOOK, "delay": 2500, "statusMs": 200})
        pg.evaluate(OPEN24); pg.wait_for_timeout(600)
        # the copy's own read, with nothing new, at the same time: one read of the payroll between them
        pg.evaluate("() => { window.__load = TCloud.load(true); }")
        s0 = pg.evaluate(SEEN)
        ok(s0 and s0[-1]["loader"] and s0[-1]["said"], "while the payroll is read: \"Reading payroll from FinCom's copy of Tally…\" (%s)" % (s0[-1] if s0 else None))
        ok(not any(x["sheet"] for x in s0), "never the salary-sheet screen while it is read")
        pg.screenshot(path=os.path.join(OUT, "24q-reading.png"), full_page=True)
        pg.wait_for_timeout(3500); pg.evaluate("() => window.__load")
        s1 = pg.evaluate(SEEN)
        ok(s1[-1]["tally"] == "34/12" and not s1[-1]["loader"], "then drawn by itself with Tally's payroll: Deductions 34, employees 12 (%s)" % s1[-1])
        ok(pg.locator('#app [data-list="q24Employees"] tbody tr, #app [data-dee-total]').count() > 0 or pg.evaluate("TDS.salaryRows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.employee && r.src === 'payroll').length") == 22,
           "the employee rows are there")
        ok(not any(x["sheet"] for x in s1) and not any(x["tally"] not in ("/", "34/12") for x in s1 if not x["loader"]), "never the salary-sheet screen or the books' rows in between (%s)" % sorted(set(x["tally"] for x in s1)))
        ok(pg.evaluate("window.__pay.reads") == 1, "the payroll read once, though the page and the copy's read both asked (%d)" % pg.evaluate("window.__pay.reads"))
        ok(pg.evaluate("PayLoad.ok(S.books, '%s')" % BOOK), "the payroll kept is the right book's, whole")

        print("== 13. next-24q-ready (b): a payroll kept here that is not right is read again")
        for what, js in (("another book's", "() => { S.books.payroll.book = 'some-other-book'; }"),
                         ("partial (April only, the books carry May and June's payroll entries)", "() => { const p = S.books.payroll; p.allocs = p.allocs.filter(a => String(a.day).startsWith('202604')); Object.keys(p.vouchers).forEach(g => { if (!String(p.vouchers[g].day).startsWith('202604')) delete p.vouchers[g]; }); }"),
                         ("another shape (an older copy)", "() => { S.books.payroll = {book: '%s', allocs: {}, employees: null}; }" % BOOK)):
            OFF(); load(pg, leads_tables())
            pg.evaluate("() => { S.books.payroll.book = '%s'; }" % BOOK)
            pg.evaluate(js)
            pg.evaluate(STUB, {"tables": leads_tables(), "book": BOOK, "delay": 300})
            ok(not pg.evaluate("PayLoad.ok(S.books, '%s')" % BOOK), "%s: not taken as the payroll" % what)
            pg.evaluate(OPEN24); pg.wait_for_timeout(3000)
            sb = pg.evaluate(SEEN)
            ok(pg.evaluate("window.__pay.reads") == 1 and sb[-1]["tally"] == "34/12", "%s: read again, Form 138 by employee (reads %d, %s)" % (what, pg.evaluate("window.__pay.reads"), sb[-1]["tally"]))
            ok(not any(x["sheet"] for x in sb), "%s: never the salary-sheet screen" % what)
        print("== 14. next-24q-ready (c): the normal reopen, and a read that fails")
        OFF(); load(pg, leads_tables())
        pg.evaluate("() => { S.books.payroll.book = '%s'; }" % BOOK)
        pg.evaluate(STUB, {"tables": leads_tables(), "book": BOOK, "delay": 300})
        ok(pg.evaluate("PayLoad.ok(S.books, '%s')" % BOOK), "a whole payroll of this book kept here is taken")
        pg.evaluate(OPEN24); pg.wait_for_timeout(800)
        sc = pg.evaluate(SEEN)
        ok(sc and sc[-1]["tally"] == "34/12" and not any(x["loader"] or x["sheet"] for x in sc), "opened at once from it, no loader (%s)" % (sc[-1] if sc else None))
        r = pg.evaluate("async () => { const r = await TCloud.load(true); await new Promise(ok => setTimeout(ok, 500)); return r; }")
        ok(r is True and pg.evaluate("window.__pay.reads") == 0 and pg.evaluate(SEEN)[-1]["tally"] == "34/12", "the copy's read with nothing new: not read again, still 34/12 (reads %d)" % pg.evaluate("window.__pay.reads"))
        OFF(); load(pg, leads_tables())
        pg.evaluate("() => { delete S.books.payroll; render(); }")
        pg.evaluate(STUB, {"tables": leads_tables(), "book": BOOK, "delay": 200, "fail": 1})
        pg.evaluate(OPEN24); pg.wait_for_timeout(1200)
        se = pg.evaluate(SEEN)
        ok(se[-1]["err"] and pg.locator('#app [data-pay-load-err] [data-pay-retry]').count() == 1 and "Try again" in pg.inner_text('#app [data-pay-load-err]'),
           "a read that fails: said in a plain line with Try again (%s)" % (pg.locator('#app [data-pay-load-err]').all_inner_texts()[:1]))
        ok(not any(x["sheet"] for x in se), "and not the salary-sheet screen")
        pg.screenshot(path=os.path.join(OUT, "24q-read-failed.png"), full_page=True)
        pg.click('#app [data-pay-retry]'); pg.wait_for_timeout(2000)
        ok(pg.evaluate(SEEN)[-1]["tally"] == "34/12" and pg.evaluate("window.__pay.reads") == 2, "Try again: read, Form 138 by employee (%s, reads %d)" % (pg.evaluate(SEEN)[-1], pg.evaluate("window.__pay.reads")))
        pg.evaluate("() => clearInterval(window.__payT)")

        print("== 8. light and dark, phone")
        for scheme in ("light", "dark"):
            ctx = br.new_context(viewport={"width": 390, "height": 844}, color_scheme=scheme); p2 = ctx.new_page(); p2.on("pageerror", lambda e: errors.append(str(e)))
            p2.goto("http://localhost:%d/" % PORT); p2.wait_for_timeout(2000); p2.click('button[data-act="useOffline"]'); p2.wait_for_timeout(1000)
            load(p2, payroll_tables()); p2.evaluate("() => { S.tdsTab = 'people'; render(); }"); p2.wait_for_timeout(400)
            p2.screenshot(path=os.path.join(OUT, "people-phone-%s.png" % scheme), full_page=True)
            sw = p2.evaluate("document.documentElement.scrollWidth"); cw = p2.evaluate("document.documentElement.clientWidth")
            ok(sw <= cw + 1, "%s phone: no horizontal page scroll (%d / %d)" % (scheme, sw, cw))
            ctx.close()
        br.close()
finally:
    srv.shutdown()
ok(not errors, "no page error %s" % errors[:3])
print("\n%s: %d (screenshots in %s)" % ("FAILED" if fails else "ALL OK", len(fails), OUT))
if fails: raise SystemExit(1)
