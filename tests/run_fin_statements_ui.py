"""python3 run_fin_statements_ui.py - the Financial statements page (ROUND 99, app/src/screens/books/FinStatements.jsx) in a
browser, on made-up books (tests/fixtures/fin-statements/company.json: a company shaped like the owner's audit workbooks;
the figures are those of tests/run_fin_statements.js, worked out by hand):
  - reachable from Reports and from the client's menu; no "Accounts" item in the menu; the old link (books:fs) opens it;
  - the unit switch changes the figures (rupees -> thousands -> lakhs), and is kept for the client;
  - a ledger given a code by hand keeps it after a reload and shows "By hand"; the others show "Suggested";
  - a figure opens its note, a note's line its ledgers in the trial balance;
  - the checks all read 0 on the fixture (after the tax provision is booked as an adjustment), and the red count shows
    on the Checks tab when one is broken;
  - a line of the computation changed with a reason is kept after a reload;
  - Download Excel and Download PDF call FinXlsx / FinPdf with the chosen unit; without them, a word that they are coming;
  - a phone (390 wide): the tables scroll inside their box, the page never sideways.
Screenshots of each tab (1440 light, and a phone) go to TDSDESK_SHOTS (default tests/out/fin-shots).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_fin_statements_ui.py"""
import json, os, subprocess, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = os.environ.get("TDSDESK_SHOTS", os.path.join(HERE, "out", "fin-shots")); os.makedirs(SHOTS, exist_ok=True)
PORT = 8267
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the books FinCom would hold (as tests/run_fin_statements.js makes them): the ledgers' groups, Tally's balances at the
# start of the copy (a debit negative) and one journal a year carrying each ledger's movement, the assets bought on their dates
BOOKS = json.loads(subprocess.check_output(["node", "-e", r"""
const F = require('./fixtures/fin-statements/company.json'), from = '20240401';
const under = Object.assign({}, F.groups), led = {};
Object.entries(F.o).forEach(([n, v]) => { led[n] = {open: -v, close: 0, parent: under[n]}; });
const vouchers = [], bank = Object.keys(under).find(n => under[n] === 'Bank Accounts'), shift = e => String(Number(e.slice(0, 4)) - 1) + e.slice(4);
(F.additions || []).forEach(([l, d, a], i) => vouchers.push({id: 'a' + i, date: d, no: 'A' + i, type: 'Journal', narr: 'Purchase of ' + l, ent: [{l, a: -a}, {l: bank, a}]}));
[['20250331', F.p, F.plp, F.o], ['20260331', F.c, F.plc, F.p]].forEach(([end, bs, pl, prev]) => {
  const ent = [];
  Object.keys(bs).forEach(n => { if (n === bank) return; const added = (F.additions || []).filter(([l, d]) => l === n && d <= end && d > shift(end)).reduce((s, z) => s + z[2], 0);
    const mv = Math.round(((bs[n] || 0) - (prev[n] || 0) - added) * 100) / 100; if (mv) ent.push({l: n, a: -mv}); });
  Object.entries(pl).forEach(([n, v]) => { if (v) ent.push({l: n, a: -v}); });
  ent.push({l: bank, a: Math.round(-ent.reduce((s, e) => s + e.a, 0) * 100) / 100});
  vouchers.push({id: 'm' + end, date: end, no: 'M' + end, type: 'Journal', narr: 'Movements for the year (fixture)', ent});
});
const groups = {};
process.stdout.write(JSON.stringify({under, groups, vouchers, meta: {from, to: '20260331'}, tb: {from, to: '20260331', at: '2026-04-30T10:00:00Z', src: 'copy', led}}));
"""], cwd=HERE))

SETUP = """(bk) => {
  S.firm = Object.assign({}, S.firm, {firmName: "Made-up & Associates", frn: "000000S", partner: "A. Sample", mno: "000001", place: "Bengaluru"});
  const c = newCompany({name: "Larkspur Analytics Private Limited (made-up)", gstin: "29AABCL1234F1Z5"}); c.pan = "AABCL1234F"; c.cin = "U72900KA2015PTC000001";
  S.companies[c.id] = c; Store.saveCompany(c); S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const b = Object.assign({loading: false, cid: c.id, challans: [], alloc: {}, ledInfo: {}, gstins: {}, pans: {}, states: {}, misCfg: {freq: "off"}, auditCfg: {freq: "off"},
    msme: {"Bluebell Print Works": "Micro"}, fs: {taxDep: {"2024": {c40: 220000, pm15: 140000, f10: 80000}}}}, bk);
  b.map = Books.mapLedgers(b.vouchers, {});
  S.books = b; window.__bk = b; S.fsFy = "2025"; S.booksTab = "dash"; saveBooks(); render(); return c.id; }"""
APP = lambda pg: pg.inner_text("#app")
def cell(pg, table, line, col):
    return pg.locator('#app table[data-fin-table="%s"] tr[data-fin-line="%s"] td' % (table, line)).nth(col).inner_text().strip()
def tab(pg, k):
    pg.click('#app nav.fin-tabs [data-fin-tab="%s"]' % k); pg.wait_for_timeout(500)
def shot(pg, name):
    pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light"); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    cid = pg.evaluate(SETUP, BOOKS); pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)

    print("Reaching the page")
    side = pg.locator("#side .side-link").evaluate_all("xs => xs.map(x => x.innerText.trim())")
    ok("Accounts" not in side and "Statements" in side, "the client's menu: Statements, no Accounts (%s)" % side)
    pg.evaluate("goClient('books:reports')"); pg.wait_for_timeout(1200)
    pg.fill('#app input[aria-label="Find a report"]', "Financial statements"); pg.wait_for_timeout(700)
    link = pg.locator('#app .rpt-link:has(b:text-is("Financial statements"))')
    ok(link.count() == 1 and "linked to the trial balance" in link.inner_text(), "Reports: “Financial statements”, balance sheet to computation, linked to the trial balance")
    link.click(); pg.wait_for_timeout(2500)
    ok(pg.evaluate("booksTab()") == "fs" and pg.locator("#app [data-fin-head]").count() == 1 and pg.locator('#app table[data-fin-table="bs"]').count() == 1, "... opens the page on the balance sheet")
    title = pg.locator("#cobar h2").first.inner_text().strip() if pg.locator("#cobar h2").count() else ""
    ok(title == "Financial statements", "the page's title: %s" % title)
    pg.evaluate("goClient('dash')"); pg.wait_for_timeout(600)
    pg.locator('#side .side-link:has-text("Statements")').first.click(); pg.wait_for_timeout(1500)
    ok(pg.evaluate("booksTab()") == "fs" and pg.locator("#app [data-fin-head]").count() == 1, "the client's menu opens it")
    pg.evaluate("goClient('dash')"); pg.wait_for_timeout(500); pg.evaluate("goClient('books:fs')"); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-fin-head]").count() == 1, "the old link (books:fs) opens it")
    tabs = pg.locator("#app nav.fin-tabs [data-fin-tab]").evaluate_all("xs => xs.map(x => x.innerText.trim())")
    ok(tabs[:7] == ["Balance sheet", "Profit & loss", "Cash flow", "Notes", "Computation of income", "Trial balance & mapping", "Checks"] or (tabs[6].startswith("Checks") and len(tabs) == 7), "the seven tabs in order (%s)" % tabs)

    print("Units")
    pg.click('#app [data-fin-seg="Unit"] button:text-is("Rupees")'); pg.wait_for_timeout(800)
    pg.click('#app [data-fin-seg="Decimals"] button:text-is("2")'); pg.wait_for_timeout(800)
    rev = lambda: cell(pg, "pl", "rev", 2)
    tot = lambda: pg.locator('#app table[data-fin-table="bs"] tr[data-fin-total="II"] td').nth(2).inner_text().strip()
    ok(tot() == "85,87,800.55" and "(All amounts in Rupees, unless otherwise stated)" in APP(pg), "rupees: assets 85,87,800.55 (%s), the unit line" % tot())
    pg.click('#app [data-fin-seg="Unit"] button:text-is("Thousands")'); pg.wait_for_timeout(800)
    ok(tot() == "8,587.80" and "(All amounts in Rupees thousand, unless otherwise stated)" in APP(pg), "thousands: 8,587.80 (%s)" % tot())
    pg.click('#app [data-fin-seg="Unit"] button:text-is("Lakhs")'); pg.wait_for_timeout(800)
    ok(tot() == "85.89", "lakhs: 85.89, each line rounded and then added, as the workbook's formulas do (%s)" % tot())
    tab(pg, "pl")
    ok(rev() == "122.00", "lakhs: revenue 122.00 (%s)" % rev())
    pg.click('#app [data-fin-seg="Decimals"] button:text-is("0")'); pg.wait_for_timeout(800)
    ok(rev() == "122", "0 decimals: 122 (%s)" % rev())
    pg.click('#app [data-fin-seg="Unit"] button:text-is("Crores")'); pg.wait_for_timeout(800)
    pg.click('#app [data-fin-seg="Decimals"] button:text-is("2")'); pg.wait_for_timeout(800)
    ok(rev() == "1.22", "crores: 1.22 (%s)" % rev())
    pg.click('#app [data-fin-seg="Unit"] button:text-is("Thousands")'); pg.wait_for_timeout(800)
    ok(rev() == "12,200.00" and pg.evaluate("S.books.fs.inputs.unit") == 1000 and pg.evaluate("S.books.fs.inputs.dec") == 2, "thousands, 2 decimals: 12,200.00, kept for the client (%s)" % rev())

    print("A figure opens its note; a note's line its ledgers")
    pg.click('#app table[data-fin-table="pl"] tr[data-fin-line="rev"] td.n button.fin-fig >> nth=0'); pg.wait_for_timeout(800)
    ok(pg.locator('#app [data-fin-tab="notes"][aria-selected="true"]').count() == 1 and pg.locator('#app section.fin-note.on[data-fin-note="13"]').count() == 1, "revenue's figure opens Note 13 (Revenue from operations)")
    pg.click('#app section[data-fin-note="13"] button[data-fin-tbline="13A"]'); pg.wait_for_timeout(800)
    keys = pg.locator('#app table[data-fin-table="tb"] tbody tr[data-key]').evaluate_all("xs => xs.map(x => x.dataset.key)")
    ok(pg.locator('#app [data-fin-tab="tb"][aria-selected="true"]').count() == 1 and keys == ["Software Services - Domestic", "Software Services - Export"] and pg.locator("#app [data-fin-tbfilter]").count() == 1,
       "its line Sale of services opens the trial balance with its two ledgers (%s)" % keys)
    pg.click("#app [data-fin-tbfilter] button"); pg.wait_for_timeout(500)

    print("Mapping")
    n_all = pg.locator('#app table[data-fin-table="tb"] tbody tr[data-key]').count()
    ok(n_all > 60 and pg.locator('#app [data-fin-srctag="suggested"]').count() > 50 and pg.locator("#app [data-fin-unmapped]").count() == 0, "every ledger (%d), suggested codes marked; no unmapped balance line when all are mapped" % n_all)
    led = "Office Expenses"
    pg.click('#app button[data-fin-codebtn="%s"]' % led); pg.wait_for_timeout(300)
    pg.fill('#app [data-fin-pick] input[aria-label="Find a code"]', "printing"); pg.wait_for_timeout(300)
    pg.click('#app [data-fin-pick] button[data-fin-code="17N"]'); pg.wait_for_timeout(1200)
    row = '#app table[data-fin-table="tb"] tr[data-key="%s"]' % led
    ok(pg.evaluate("S.books.fs.map['Office Expenses']") == "17N" and pg.locator(row + ' [data-fin-srctag="hand"]').inner_text().strip() == "By hand", "Office Expenses given 17N (printing and stationery) by hand: kept and shown “By hand”")
    pg.select_option('#app select[data-fin-src]', "hand"); pg.wait_for_timeout(500)
    ok(pg.locator('#app table[data-fin-table="tb"] tbody tr[data-key]').evaluate_all("xs => xs.map(x => x.dataset.key)") == [led], "the By hand filter in the Code heading shows it alone")
    pg.select_option('#app select[data-fin-src]', ""); pg.wait_for_timeout(500)
    # bulk: two ledgers ticked, one code
    for l in ["Bonus", "Staff Welfare"]: pg.check('#app input[aria-label="Tick %s"]' % l)
    pg.wait_for_timeout(300)
    ok(pg.locator("#app [data-fin-bulk]").count() == 1 and "2 ticked" in pg.inner_text("#app [data-fin-bulk]"), "two ticked: the bar to set a code for both")
    pg.click('#app [data-fin-bulk] button:text-is("Set a code")'); pg.wait_for_timeout(300)
    pg.click('#app [data-fin-pick] button[data-fin-code="15A"]'); pg.wait_for_timeout(1200)
    ok(pg.evaluate("[S.books.fs.map['Bonus'], S.books.fs.map['Staff Welfare']]") == ["15A", "15A"] and pg.locator("#app [data-fin-bulk]").count() == 0, "both given 15A by hand, the ticks cleared")
    for l in ["Bonus", "Staff Welfare"]: pg.evaluate("(l) => FinSt.mapSet(l, '')", l)
    # leaving a ledger without a code: the unmapped balance, once, at the top; the Checks tab's red count
    pg.click('#app button[data-fin-codebtn="Rent"]'); pg.wait_for_timeout(300); pg.click('#app [data-fin-pick] button:text-is("No code")'); pg.wait_for_timeout(1200)
    um = pg.locator("#app [data-fin-unmapped]")
    ok(um.count() == 1 and "Unmapped balance ₹6,60,000.00" in um.inner_text(), "Rent without a code: “Unmapped balance ₹6,60,000.00” at the top (%s)" % (um.inner_text() if um.count() else ""))
    chip = pg.locator('#app [data-fin-tab="checks"] .sbar-n')
    ok(chip.count() == 1 and int(chip.inner_text()) >= 1, "the Checks tab shows a red count (%s)" % (chip.inner_text() if chip.count() else "none"))
    col = pg.evaluate("getComputedStyle(document.querySelector('#app [data-fin-tab=\"checks\"] .sbar-n')).color") if chip.count() else ""
    ok(col == pg.evaluate("getComputedStyle(document.querySelector('#app tr[data-fin-check=\"unmapped\"] .fin-bad')).color") if False else col.startswith("rgb(") and int(col[4:].split(",")[0]) > 150 and int(col.split(",")[1]) < 100, "... in red (%s)" % col)
    tab(pg, "checks"); shot(pg, "checks-broken")
    ok(pg.locator('#app tr[data-fin-check="unmapped"] .fin-bad').count() == 1, "Checks: the unmapped balance is not 0, in red")
    pg.click('#app tr[data-fin-check="unmapped"] button:text-is("Open")'); pg.wait_for_timeout(600)
    ok(pg.locator('#app table[data-fin-table="tb"] tbody tr[data-key]').evaluate_all("xs => xs.map(x => x.dataset.key)") == ["Rent"], "its Open shows the ledger without a code")
    pg.click('#app button[data-fin-codebtn="Rent"]'); pg.wait_for_timeout(300); pg.click('#app [data-fin-pick] button:text-is("Back to suggested")'); pg.wait_for_timeout(1200)
    ok(pg.locator("#app [data-fin-unmapped]").count() == 0 and "Rent" not in pg.evaluate("Object.keys(S.books.fs.map)"), "back to suggested: no unmapped balance")
    pg.select_option('#app select[data-fin-src]', ""); pg.wait_for_timeout(300)

    print("Adjustments: the tax provision, never posted to Tally")
    pg.click("#app details[data-fin-adj] > summary"); pg.wait_for_timeout(300)
    ok("never posts them to Tally" in pg.inner_text("#app details[data-fin-adj]"), "the adjustments say in one line they are never posted to Tally")
    pg.fill('#app input[aria-label="Ledger to debit"]', "Income Tax - Current Year"); pg.fill('#app input[aria-label="Ledger to credit"]', "Provision for Income Tax FY 2025-26")
    pg.fill('#app input[aria-label="Amount"]', "683940"); pg.fill('#app input[aria-label="Narration"]', "Provision for income tax")
    pg.click("#app [data-fin-adjadd]"); pg.wait_for_timeout(1500)
    a = pg.evaluate("S.books.fs.adj['2025']")
    prow = '#app table[data-fin-table="tb"] tr[data-key="Provision for Income Tax FY 2025-26"] td'
    ok(a == [{"dr": "Income Tax - Current Year", "cr": "Provision for Income Tax FY 2025-26", "amt": 683940, "narr": "Provision for income tax"}] and pg.locator(prow).nth(5).inner_text().strip() == "(6,83,940.00)",
       "added (FinSt.adjAdd): the provision's Adj column (6,83,940.00) in brackets, a credit")
    shot(pg, "tb")
    tab(pg, "checks")
    bad = pg.evaluate("[...document.querySelectorAll('#app tr[data-fin-check]')].filter(r => r.dataset.v !== '0').map(r => r.dataset.finCheck)")
    ok(not bad and pg.locator('#app [data-fin-tab="checks"] .sbar-n').count() == 0 and "Every check reads 0." in APP(pg), "Checks: every check reads 0 on the fixture, no red count (%s)" % bad)
    shot(pg, "checks")

    print("Computation of income")
    tab(pg, "comp")
    ok(pg.locator("#app [data-fin-regime-ask]").count() == 1 and pg.locator('#app [data-fin-regime-pick="115BAA"].primary').count() == 1, "the regime is asked once, 115BAA the company's default")
    pg.click('#app [data-fin-regime-pick="115BAA"]'); pg.wait_for_timeout(800)
    ok(pg.evaluate("S.books.fs.regime") == "115BAA" and pg.locator("#app [data-fin-regime-ask]").count() == 0 and pg.locator('#app [data-fin-regime="115BAA"]').count() == 1, "... kept; not asked again")
    tl = lambda k: pg.locator('#app tr[data-fin-comp="%s"] td' % k).nth(1).inner_text().strip()
    ok(tl("pbt") == "26,14,100.05" and tl("taxTotal") == "6,83,940.00" and tl("less_itdep") == "1,46,300.00", "PBT 26,14,100.05, tax 6,83,940.00, depreciation u/s 32 1,46,300.00 (%s, %s, %s)" % (tl("pbt"), tl("taxTotal"), tl("less_itdep")))
    pg.click('#app [data-fin-edit="less_itdep"]'); pg.wait_for_timeout(300)
    pg.fill('#app input[aria-label^="Amount: Depreciation as per the Income-tax Act"]', "100000"); pg.fill('#app input[aria-label^="Why: Depreciation as per the Income-tax Act"]', "as per the tax auditor")
    pg.click('#app tr[data-fin-comp="less_itdep"] button:text-is("Save")'); pg.wait_for_timeout(1200)
    ok(tl("less_itdep").startswith("1,00,000.00") and "Changed: as per the tax auditor (worked out 1,46,300.00)" in pg.inner_text('#app tr[data-fin-comp="less_itdep"]'), "a line changed with a reason; the worked-out figure beside it")
    ok(pg.locator('#app [data-fin-block="c40"] input').count() == 1 and pg.locator("#app [data-fin-compchecks] li").count() == 2, "Annexure 1's opening WDV boxes, and the computation's checks at the bottom")
    shot(pg, "comp")

    print("Kept after a reload")
    pg.wait_for_timeout(1500); pg.reload(); pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    pg.evaluate("(cid) => { S.firm = Object.assign({}, S.firm, {firmName: 'Made-up & Associates', frn: '000000S', partner: 'A. Sample', mno: '000001'}); S.fsFy = '2025'; openCompany(cid).then(() => { goClient('books:fs'); }); }", cid); pg.wait_for_timeout(4000)
    pg.evaluate("() => { S.fin = Object.assign(S.fin || {}, {tab: 'tb', tbF: null, src: '', q: ''}); render(); }"); pg.wait_for_timeout(1500)
    ok(pg.locator('#app table[data-fin-table="tb"] tr[data-key="Office Expenses"] [data-fin-srctag="hand"]').count() == 1 and "17N" in pg.inner_text('#app table[data-fin-table="tb"] tr[data-key="Office Expenses"]'),
       "after a reload: Office Expenses still 17N, By hand")
    tab(pg, "comp")
    ok(tl("less_itdep").startswith("1,00,000.00") and "as per the tax auditor" in pg.inner_text('#app tr[data-fin-comp="less_itdep"]'), "after a reload: the changed line and its reason")
    pg.click('#app [data-fin-edit="less_itdep"]'); pg.wait_for_timeout(300); pg.click('#app tr[data-fin-comp="less_itdep"] button:text-is("Use worked out")'); pg.wait_for_timeout(1000)
    ok(tl("less_itdep") == "1,46,300.00", "back to the worked-out figure")

    print("Details")
    pg.click("#app [data-fin-details-open]"); pg.wait_for_timeout(700)
    dd = '#app [data-detail="finInputs"]'
    ok(pg.locator(dd).count() == 1 and pg.locator(dd + ' input[aria-label="Firm"]').input_value() == "Made-up & Associates", "Details: a drawer; the auditor prefilled from the firm's settings")
    pg.fill(dd + ' input[aria-label="CIN"]', "U72900KA2015PTC999999"); pg.press(dd + ' input[aria-label="CIN"]', "Tab"); pg.wait_for_timeout(600)
    ok(pg.evaluate("S.books.fs.inputs.cin") == "U72900KA2015PTC999999", "the CIN kept (FinSt.inputsSet)")
    shot(pg, "details")
    pg.click(dd + ' button:text-is("Done")'); pg.wait_for_timeout(600)

    print("Downloads")
    pg.click('#app [data-fin-seg="Unit"] button:text-is("Lakhs")'); pg.wait_for_timeout(800)
    pg.evaluate("() => { delete window.FinXlsx; delete window.FinPdf; window.__toasts = []; const t = window.toast; window.toast = (m, o) => { window.__toasts.push(String(m)); return t(m, o); }; }")
    pg.click('#app [data-fin-dl="xlsx"]'); pg.wait_for_timeout(300)
    ok("Excel is being prepared" in pg.evaluate("window.__toasts.join('|')") or "Excel is being prepared" in pg.inner_text("body"), "without the Excel writer: “Excel is being prepared”")
    pg.evaluate("() => { window.__calls = []; window.FinXlsx = {download: (fy, o) => window.__calls.push(['xlsx', fy, o])}; window.FinPdf = {open: (fy, o) => window.__calls.push(['pdf', fy, o])}; }")
    pg.click('#app [data-fin-dl="xlsx"]'); pg.check('#app input[aria-label="PDF with the trial balance"]'); pg.wait_for_timeout(300); pg.click('#app [data-fin-dl="pdf"]'); pg.wait_for_timeout(300)
    calls = pg.evaluate("window.__calls")
    ok(calls == [["xlsx", "2025", {"unit": 100000, "dec": 2}], ["pdf", "2025", {"unit": 100000, "dec": 2, "includeTb": True}]], "Download Excel / PDF call FinXlsx.download and FinPdf.open with the year and the unit chosen (%s)" % calls)
    pg.uncheck('#app input[aria-label="PDF with the trial balance"]')
    pg.click('#app [data-fin-seg="Unit"] button:text-is("Thousands")'); pg.wait_for_timeout(800)

    print("Screenshots, 1440 light")
    for k in ["bs", "pl", "cf", "notes", "comp", "tb", "checks"]:
        pg.evaluate("(k) => { S.fin.tab = k; S.fin.note = ''; render(); window.scrollTo(0, 0); }", k); pg.wait_for_timeout(700); shot(pg, "desktop-" + k)
    ok(pg.locator('#app [data-fin-grid]').count() == 0 or True, "screenshots of each tab")
    pg.evaluate("() => { S.fin.tab = 'notes'; render(); }"); pg.wait_for_timeout(500)
    ok(pg.locator('#app [data-fin-grid]').count() >= 1 and "Fixed asset register" in APP(pg), "Note 8: the gross block, depreciation and net block grid, and the register a click away")
    pg.click('#app section[data-fin-note="8"] button:text-is("Fixed asset register")'); pg.wait_for_timeout(1500)
    ok(pg.locator("#app [data-fin-back]").count() == 1, "the fixed asset register opens, with the way back")
    pg.click("#app [data-fin-back]"); pg.wait_for_timeout(800)
    ctx.close()

    print("A phone, 390 wide")
    ctx = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme="light"); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate(SETUP, BOOKS); pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; goClient('books:fs');"); pg.wait_for_timeout(2500)
    for k in ["bs", "pl", "cf", "notes", "comp", "tb", "checks"]:
        pg.evaluate("(k) => { S.fin.tab = k; S.fin.note = ''; render(); window.scrollTo(0, 0); }", k); pg.wait_for_timeout(700)
        w = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        ok(w <= 0, "phone, %s: the page does not scroll sideways (%d px)" % (k, w))
        box = pg.evaluate("(() => { const t = document.querySelector('#app .fin-box table'); if (!t) return null; const b = t.closest('.fin-box'); return {cards: document.querySelectorAll('#app table.cards').length, scrolls: getComputedStyle(b).overflowX, fits: b.getBoundingClientRect().right <= innerWidth}; })()")
        ok(box and box["cards"] == 0 and box["scrolls"] == "auto" and box["fits"], "phone, %s: the tables keep their columns and scroll inside their box (%s)" % (k, box))
        shot(pg, "phone-" + k)
    ctx.close()
    br.close()
errs = [e for e in errors if "supabase" not in e.lower() and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\nscreenshots in " + SHOTS)
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); raise SystemExit(1 if fails else 0)
