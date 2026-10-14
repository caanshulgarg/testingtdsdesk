"""python3 run_fixed_assets_ui.py - Books -> Accounts -> Fixed assets & depreciation (app/src/screens/books/FixedAssets.jsx; FAR,
src/js/80-assets.js) on the React build (app/dist-test, or TDSDESK_SITE), with book A of tests/dep_fixtures.js (asset-wise
ledgers under groups that carry the income-tax rate, accumulated depreciation per block, a purchase and a sale in the year)
loaded as FinCom holds books. Test data only.
  1. the tab proposes the register from the books and keeps it with them; one table of the three assets (the two
     accumulated-depreciation ledgers are not assets); the Confirm list at the top
  2. confirming a point takes it off the list, with who confirmed it
  3. the drawer: an override typed by hand asks for its reason; with the reason it is used and shown "by hand"; a sale
     can be marked scrapped
  4. the schedules by class and by block, the deferred tax and the suggested journal (shown only)
  5. downloads: Excel and Word saved, Print / PDF opens the print view
  6. the statements' details take the register (FSX.inputFromBooks), and the books are unchanged: the vouchers, the
     balances and nothing queued for Tally
Run one at a time (flock /tmp/fincom-app.lock)."""
import os, sys, json, subprocess, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("FAR_PORT") or 8346)
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

# book A as FinCom holds books: vouchers in Tally's sign (a debit negative), dates YYYYMMDD, the ledgers' groups, the openings
B = json.loads(subprocess.check_output(["node", "-e", """
const A = require('./dep_fixtures').books.A; const t = s => s.replace(/-/g, '');
const under = {}, groups = {'Fixed Assets': '', 'Current Assets': '', 'Bank Accounts': 'Current Assets', 'Sundry Creditors': 'Current Liabilities', 'Current Liabilities': '', 'Duties & Taxes': 'Current Liabilities', 'Indirect Expenses': ''};
const led = {};
A.ledgers.forEach(x => { under[x.l] = x.path[0]; x.path.slice(0, -1).forEach(g => { groups[g] = 'Fixed Assets'; }); led[x.l] = {open: -x.open}; });
Object.assign(under, {'HDFC Bank': 'Bank Accounts', 'Sharma Machines': 'Sundry Creditors', 'Input IGST': 'Duties & Taxes', 'Depreciation': 'Indirect Expenses'});
led['HDFC Bank'] = {open: -477000}; led['Sharma Machines'] = {open: 0};
const vouchers = A.vouchers.map(v => ({id: 'far' + v.id, date: t(v.date), no: v.no, type: v.type, party: '', narr: '', ent: v.ent.map(e => ({l: e.l, a: -e.a})), cmp: '', gstin: '', pos: '', hsn: []}));
process.stdout.write(JSON.stringify({vouchers, under, groups, led}));"""], cwd=HERE))

LOAD = """(B) => {
  const c = newCompany({name: "ZZ Edge Binding Works (made-up)", gstin: "27AAACE1234E1Z5"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const b = {loading: false, cid: c.id, challans: [], alloc: {}, vouchers: B.vouchers, under: B.under, groups: B.groups, ledInfo: {}, gstins: {}, pans: {}, states: {},
    meta: {from: "20240401", to: "20260331"}, tb: {from: "20240401", to: "20260331", led: B.led, src: "copy", at: "2026-10-14"}, misCfg: {freq: "off"}, auditCfg: {freq: "off"}};
  b.map = Books.mapLedgers(b.vouchers, {});
  S.books = b; window.__bk = b; S.booksTab = "fs"; S.fsTab = "dep"; S.fsFy = "2025"; render();
}"""
STATE = "() => JSON.stringify([window.__bk.vouchers, window.__bk.tb, window.__bk.map, (window.__bk.post || null), (S.tallyQueue || null)])"
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate(LOAD, B); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; S.booksTab = 'fs'; S.fsTab = 'dep'; S.fsFy = '2025'; render();"); pg.wait_for_timeout(1500)
    before = pg.evaluate(STATE)
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n, blob) => { window.__saved.push([n, blob ? blob.size : 0]); }; }")
    # 1
    pg.wait_for_selector("[data-far-row]", timeout=20000)
    rows = pg.eval_on_selector_all("[data-far-row]", "els => els.map(e => e.getAttribute('data-far-row'))")
    ok(sorted(rows) == ["L:AC - Hitachi", "L:Edge Binding Machine", "L:HP Laptop"], "1. one table of the three assets; the accumulated-depreciation ledgers are not assets " + str(rows))
    ok(pg.evaluate("!!(window.__bk.fixedAssets && window.__bk.fixedAssets['2025'] && window.__bk.fixedAssets['2025'].assets.length === 3)"), "1. the register is kept with the books (b.fixedAssets['2025'])")
    items = pg.eval_on_selector_all("[data-far-item]", "els => els.map(e => e.getAttribute('data-far-item'))")
    ok(pg.locator("[data-far-confirm]").count() == 1 and "acc:Provision for Dep on P&M @15%" in items and "move:farA2|1" in items and "settings" in items,
       "1. the Confirm list at the top: the matches, the sale, the defaults (%d points)" % len(items))
    ok(pg.locator("[data-fs-tab='dep'][aria-selected='true']").count() == 1 and "Fixed assets & depreciation" in pg.inner_text("nav[aria-label='Accounts']"), "1. Books -> Accounts -> Fixed assets & depreciation")
    pg.screenshot(path=os.path.join(OUT, "fixed-assets-ui.png"), full_page=True)
    # the one filter bar: find an asset
    pg.fill("input[data-fk='farFq']", "laptop"); pg.wait_for_timeout(700)
    ok(pg.eval_on_selector_all("[data-far-row]", "els => els.map(e => e.getAttribute('data-far-row'))") == ["L:HP Laptop"], "1. the filter bar finds an asset")
    pg.evaluate("clearFilter('farF')"); pg.wait_for_timeout(500)
    # 2
    pg.click("[data-far-ok='acc:Provision for Dep on P&M @15%']"); pg.wait_for_timeout(600)
    ok(pg.locator("[data-far-item='acc:Provision for Dep on P&M @15%']").count() == 0 and pg.evaluate("!!window.__bk.fixedAssets['2025'].ok['acc:Provision for Dep on P&M @15%'].at"), "2. confirmed: off the list, with who and when")
    # 3 the drawer
    pg.click("[data-far-row='L:AC - Hitachi']"); pg.wait_for_selector("[data-detail='farAsset'] [data-far-form]", timeout=10000)
    f = pg.locator("[data-far-field='overrideDep']"); f.fill("1000"); f.press("Tab"); pg.wait_for_timeout(600)
    ok(pg.locator("[data-far-item='need:why:L:AC - Hitachi']").count() == 1, "3. a figure typed by hand asks for its reason")
    f = pg.locator("[data-far-field='overrideWhy']"); f.fill("damaged in the 2025 flood: technical estimate"); f.press("Tab"); pg.wait_for_timeout(600)
    ov = pg.evaluate("window.__bk.fixedAssets['2025'].assets.find(a => a.ledger === 'AC - Hitachi').override")
    dep = pg.evaluate("FAR.forYear(window.__bk, '2025').assets.find(a => a.ledger === 'AC - Hitachi').dep")
    ok(ov["dep"] == 1000 and ov["reason"].startswith("damaged") and dep == 1000 and pg.locator("[data-far-item='need:why:L:AC - Hitachi']").count() == 0, "3. with its reason: 1,000 used, the reason kept (%s)" % ov)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(600)
    pg.click("[data-far-row='L:HP Laptop']"); pg.wait_for_timeout(700)
    pg.select_option("[data-far-move-kind='farA2|1']", "scrap"); pg.wait_for_timeout(600)
    ok(pg.evaluate("window.__bk.fixedAssets['2025'].assets.find(a => a.ledger === 'HP Laptop').moves[0].kind") == "scrap", "3. the laptop's credit marked scrapped")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    ok("by hand" in pg.inner_text("table[data-list='farAssets']"), "3. the table shows the figure typed by hand")
    # 4 the schedules
    for s in ("classes", "blocks", "dt", "je"): pg.click("[data-far-sched='%s'] summary" % s); pg.wait_for_timeout(200)
    blocks = pg.inner_text("[data-far-table='blocks']"); je = pg.inner_text("[data-far-sched='je']")
    ok("Plant and machinery, general" in blocks and "Computers including computer software" in blocks and "Office equipment" in pg.inner_text("[data-far-table='classes']"), "4. by class and by block")
    ok("posts nothing to Tally" in je and "Provision for Dep on P&M @15%" in je and "Deferred tax" in pg.inner_text("[data-far-table='dt']"), "4. the deferred tax working and the suggested journal, shown only")
    # 5 downloads
    pg.click("[data-far-excel]"); pg.wait_for_timeout(2500); pg.click("[data-far-word]"); pg.wait_for_timeout(1200)
    sv = pg.evaluate("window.__saved")
    ok(any(n.endswith("fixed-assets-2025.xlsx") and z > 4000 for n, z in sv) and any(n.endswith("fixed-assets-2025.docx") and z > 4000 for n, z in sv), "5. Excel and Word saved " + str(sv))
    with ctx.expect_page() as pop:
        pg.click("[data-far-print]")
    pw = pop.value; pw.wait_for_timeout(800); t = pw.inner_text("body")
    ok("Fixed assets and depreciation for the year ended March 31, 2026" in t and "ZZ EDGE BINDING WORKS" in t, "5. Print / PDF opens the print view"); pw.pdf(path=os.path.join(OUT, "fixed-assets-ui.pdf")); pw.close()
    # 6 the statements and the books
    far = pg.evaluate("(() => { const i = FSX.inputFromBooks('2025', {kind: 'company'}); const r = FAR.forYear(S.books, '2025'); return [i.det && i.det.farFrom, JSON.stringify(i.det.far.cy) === JSON.stringify(r.far)]; })()")
    ok(far == ["register", True], "6. the statements' details for 2025-26 take the register's classes " + str(far))
    ok(pg.evaluate(STATE) == before, "6. the books are unchanged: vouchers, balances, ledger map; nothing queued for Tally")
    pg.screenshot(path=os.path.join(OUT, "fixed-assets-ui-2.png"), full_page=True)
    br.close()
errs = [e for e in errors if "supabase" not in e.lower() and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
