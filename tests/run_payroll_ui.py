"""python3 run_payroll_ui.py - bridge 2.4.4: the salary pages under the client's TDS, on the payroll test company
(tests/fixtures/payroll-e2e: tables.json, the cloud copy's rows as run_e2e_payroll.py stores them; the answers in
expected.json, worked out apart). Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test).
  1. 24Q's Employees & declarations (the TDS page's Salary tab until 14-Oct-2026): Employees (each from Tally with PAN, group, designation, joined, left; "no PAN" said), the regime
     and declarations typed in under an employee and kept with the books as items (payDetails); the senior-citizen question
     only for the old regime; no date of birth asked anywhere
  2. the pay register of a month: each pay head, gross, deductions, net, TDS as expected
  3. Form 16 Part B: every figure of an employee as expected (old regime with HRA and Chapter VI-A; new with surcharge)
  4. the 24Q return of a quarter from Tally's payroll: Annexure I with each month's challan; Annexure II in Q4; the text
     file marked check before filing (a _DRAFT name), its download
  5. light and dark, desktop and phone: no page error, no horizontal scroll on the phone
Run under flock /tmp/fincom-app.lock with the other screen tests."""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("PAYUI_PORT") or 8344)
OUT = os.path.join(HERE, "out", "payroll-ui"); os.makedirs(OUT, exist_ok=True)
FX = os.path.join(HERE, "fixtures", "payroll-e2e")
TABLES, SETUP, EXP = json.load(open(os.path.join(FX, "tables.json"))), json.load(open(os.path.join(FX, "setup.json"))), json.load(open(os.path.join(FX, "expected.json")))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
LOAD = """(a) => {
  const c = newCompany({name: "PE Payroll Test Co"}); c.tan = "DELP01234E"; c.pan = "AAACP1234Q"; S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const T = a.tables.tables, b = {cid: c.id, loading: false, vouchers: [], meta: {from: "20260401", to: "20270331"}, challans: [], alloc: {}, certs: []};
  S.books = b;
  BookSrc.apply(b, T.tally_vouchers, T.tally_lines, []);
  b.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(b);
  TDSTally.sync(b);
  Payroll.take(b, {book: a.tables.book, employees: T.tally_employees, heads: T.tally_ledgers, allocs: T.tally_cost_allocs, pays: T.tally_salary_pays, vouchers: T.tally_vouchers});
  for (const [name, d] of Object.entries(a.details)) { const e = Payroll.employees().find(z => z.name === name); for (const [k, v] of Object.entries(d)) Payroll.setDetail(e, k, v); }
  // next-challan-match: Tally's payroll no longer tags by itself; its challans are suggested (From Tally: the months each
  // payment pays) and confirmed, as a person does on Form 138's Challans tab
  ["Q1", "Q2", "Q3", "Q4"].forEach(q => TDSMatch.confirmAll("24Q", "2026-27", q));
  S.booksTab = "tds"; S.tdsFy = "2026-27"; S.tdsView = "salary"; S.paySub = "employees"; render();
}"""
def txt(pg): return pg.inner_text("#app")
money = lambda v: "₹" + "{:,}".format(v)
def inr(v):
    # Indian grouping, as INR.format shows it (12,34,567.5 -> 12,34,567.5)
    v = float(v); neg = v < 0; v = abs(v); whole = int(round(v * 100)) // 100; paise = int(round(v * 100)) % 100
    s = str(whole)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2: parts.insert(0, head[-2:]); head = head[:-2]
        if head: parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if neg else "") + "₹" + s + (("." + ("%02d" % paise).rstrip("0")) if paise else "")
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1400, "height": 1000}, accept_downloads=True); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, {"tables": TABLES, "details": SETUP["details"]}); pg.wait_for_timeout(800)
        print("== 1. the Salary tab and the employees")
        # tds-layout (14-Oct-2026): no Salary tab on the TDS page; the salary pages are 24Q's "Employees & declarations"
        ok(pg.locator('[data-ret-tab="people"][aria-selected="true"]').count() == 1 and pg.evaluate("[S.tdsForm, S.tdsTab]") == ["24Q", "people"],
           "the salary pages: 24Q's Employees & declarations (the old Salary address leads there)")
        t = txt(pg)
        names = sorted(e[0] for e in SETUP["employees"])
        ok(all(n in t for n in names), "every employee from Tally is listed")
        ok(pg.locator('[data-list="payEmployees"] .tag:has-text("no PAN")').count() == 1, "the employee without a PAN is said (one)")
        ok("ABCPS1007G" in t and "Director" in t and "PE Office Staff" in t, "PAN, designation and group shown")
        ok("birth" not in t.lower() and "aadhaar" not in t.lower(), "no date of birth or Aadhaar asked or shown")
        pg.click('[data-pay-open]:has-text("PE Asha Rao")'); pg.wait_for_timeout(300)
        det = '[data-pay-details]'
        ok(pg.locator(det + ' [data-pay-field="senior"]').count() == 0, "new regime: no senior-citizen question")
        pg.select_option(det + ' select[data-pay-field="regime"]', "old"); pg.wait_for_timeout(300)
        ok(pg.locator(det + ' [data-pay-field="senior"]').count() == 1 and pg.locator(det + ' [data-pay-field="d80C"]').count() == 1, "old regime: the senior-citizen yes/no and the declarations appear")
        ok(pg.locator(det + ' [data-pay-field="parentsSenior"]').count() == 1, "old regime: whether a parent is a senior citizen, yes / no (80D's limit; no date of birth)")
        pg.fill(det + ' input[data-pay-field="d80C"]', "150000"); pg.press(det + ' input[data-pay-field="d80C"]', "Enter"); pg.wait_for_timeout(300)
        d = pg.evaluate("() => (S.books.payDetails || []).find(x => x.name === 'PE Asha Rao')")
        ok(d and d.get("regime") == "old" and d.get("d80C") == 150000 and d.get("id", "").startswith("emp:"), "kept with the books as an item with its id (%s)" % d)
        ok("payDetails" in pg.evaluate("BOOKS_KEYS"), "payDetails is one of the books' keys (saved and merged item by item)")
        pg.select_option(det + ' select[data-pay-field="regime"]', "new"); pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(OUT, "employees-desktop.png"), full_page=True)
        print("== 2. the pay register")
        pg.click('[data-pay-sub="register"]'); pg.wait_for_timeout(300)
        pg.select_option('[data-pay-register] select', "202604"); pg.wait_for_timeout(300)
        reg = pg.inner_text('[data-pay-register]')
        want = EXP["registers"]["202604"]
        g = sum(float(r["gross"]) for r in want); tds = sum(float(r["tds"]) for r in want)
        ok(inr(g) in reg and inr(tds) in reg, "April 2026: gross %s and TDS %s" % (inr(g), inr(tds)))
        ok(all(h in reg for h in ["PE Basic", "PE HRA", "PE Income Tax"]), "each pay head a column")
        pg.screenshot(path=os.path.join(OUT, "register-desktop.png"), full_page=True)
        print("== 3. Form 16 Part B")
        pg.click('[data-pay-sub="form16"]'); pg.wait_for_timeout(300)
        for name in ("PE Chitra Iyer", "PE Gita Sharma"):
            guid = pg.evaluate("(n) => Payroll.employees().find(e => e.name === n).guid", name)
            pg.select_option('[data-pay-form16] select', guid); pg.wait_for_timeout(300)
            f16 = pg.inner_text('[data-form16]'); w = EXP["annex2"][name]
            miss = [k for k in ("gross", "hraExempt", "standard", "incomeSalary", "chapter6", "totalIncome", "cess", "taxPayable", "tdsHere") if float(w[k]) and inr(w[k]) not in f16]
            ok(not miss, "%s: every figure of Part B as expected (missing %s)" % (name, [(k, inr(w[k])) for k in miss]))
        pg.screenshot(path=os.path.join(OUT, "form16-desktop.png"), full_page=True)
        print("== 4. 24Q from Tally's payroll")
        pg.evaluate("() => { S.tdsView = 'return'; S.tdsForm = '24Q'; S.tdsQ = 'Q1'; S.tdsTab = 'employees'; render(); }"); pg.wait_for_timeout(400)
        a1 = pg.inner_text('[data-list="q24Annex1"]')
        ok(pg.locator('[data-list="q24Annex1"] tbody tr').count() == len(EXP["annex1"]["Q1"]), "Q1 Annexure I: one row per employee per month (%d)" % len(EXP["annex1"]["Q1"]))
        cells = pg.locator('[data-list="q24Annex1"] [data-ch-cell]').all_inner_texts()
        # next-tds-clear: one line, serial · date · section (the BSR on a hover)
        tts = pg.locator('[data-list="q24Annex1"] [data-ch-cell]').evaluate_all("(l) => l.map(e => e.title)")
        ok(cells and all(re.match(r"^\d{5} · \d\d-\w{3} · 192$", c.strip()) for c in cells) and all(t.startswith("0510308 · ") for t in tts), "each month's challan beside its TDS: serial · date · section, the BSR on a hover, opening the Move dialog (%s)" % cells[:3])
        ok(pg.evaluate("Payroll.annexI('2026-27', 'Q1').filter(r => r.tds > 0).map(r => r.challanNo).sort().join(',')").count("01001") >= 1 and pg.evaluate("Payroll.annexI('2026-27', 'Q1').filter(r => r.tds > 0).every(r => r.challan)"), "every month's TDS on its challan (01001 … 01003), from Tally's payment's months")
        pg.evaluate("() => { S.tdsQ = 'Q4'; S.tdsTab = 'annex2'; render(); }"); pg.wait_for_timeout(400)
        a2 = pg.inner_text('[data-list="q24Annex2"]')
        ok(inr(EXP["annex2"]["PE Gita Sharma"]["taxPayable"]) in a2 and inr(EXP["annex2"]["PE Chitra Iyer"]["hraExempt"]) in a2, "Q4 Annexure II: the year's tax and exemptions")
        pg.screenshot(path=os.path.join(OUT, "annex2-desktop.png"), full_page=True)
        pg.evaluate("() => { S.tdsTab = 'file'; render(); }"); pg.wait_for_timeout(300)
        ok("draft" in pg.inner_text('[data-file="24Q-tally"]').lower() or "FVU" in pg.inner_text('[data-file="24Q-tally"]'), "the file is marked check before filing (a draft, run through the FVU)")
        # next-tds-forms-2025: Form 138 (tax year 2026-27) is built to Protean's file format 1.1, which is for Q1 to Q3: the Q4
        # file (Annexure II's salary records) is refused until Protean's Q4 layout is in hand; Q1's file downloads, a draft
        q4 = pg.evaluate("() => TDS24Q_FILE.build('2026-27', 'Q4', TDS26Q.firmDetails())")
        ok(q4.get("error") == "Protean has not yet released the Q4 layout for Form 138", "Q4 2026-27: Form 138's file is not made yet (%s)" % q4.get("error"))
        pg.evaluate("() => { S.tdsQ = 'Q1'; S.tdsTab = 'file'; render(); }"); pg.wait_for_timeout(300)
        with pg.expect_download() as dl:
            pg.click('[data-pay-fvu]')
        fn = dl.value.suggested_filename
        body = open(dl.value.path(), encoding="ascii").read()
        ok(fn.endswith("_Form138_Q1_202627_DRAFT.txt") and body.startswith("1^FH^SL1^") and body.count("^SD^") == 0 and body.count("^CD^") == 3 and all(len(l.split("^")) == {"FH": 18, "BH": 72, "CD": 30, "DD": 45}[l.split("^")[1]] for l in body.strip().splitlines()),
           "the Q1 text file downloads: a Form 138 draft, every record with the workbook's number of fields (%s %d CD %s)" % (fn, body.count("^CD^"), sorted(set((l.split("^")[1], len(l.split("^"))) for l in body.strip().splitlines()))))
        print("== 5. light and dark, desktop and phone")
        for scheme in ("light", "dark"):
            for w, h, tag in ((1400, 1000, "desktop"), (390, 844, "phone")):
                ctx = br.new_context(viewport={"width": w, "height": h}, color_scheme=scheme); p2 = ctx.new_page(); p2.on("pageerror", lambda e: errors.append(str(e)))
                p2.goto("http://localhost:%d/" % PORT); p2.wait_for_timeout(2000); p2.click('button[data-act="useOffline"]'); p2.wait_for_timeout(1000)
                p2.evaluate(LOAD, {"tables": TABLES, "details": SETUP["details"]}); p2.wait_for_timeout(800)
                p2.screenshot(path=os.path.join(OUT, "salary-%s-%s.png" % (tag, scheme)), full_page=True)
                if tag == "phone":
                    sw = p2.evaluate("document.documentElement.scrollWidth"); cw = p2.evaluate("document.documentElement.clientWidth")
                    ok(sw <= cw + 1, "%s phone: no horizontal page scroll (%d / %d)" % (scheme, sw, cw))
                ctx.close()
        br.close()
finally:
    srv.shutdown()
ok(not errors, "no page error %s" % errors[:3])
print("\n%s: %d (screenshots in %s)" % ("FAILED" if fails else "ALL OK", len(fails), OUT))
if fails: raise SystemExit(1)
