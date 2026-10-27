"""python3 run_fixed_assets_ui.py - Books -> Accounts -> Fixed assets & depreciation (app/src/screens/books/FixedAssets.jsx; FAR,
src/js/80-assets.js) on the React build (app/dist-test, or TDSDESK_SITE), with book A of tests/dep_fixtures.js (asset-wise
ledgers under groups carrying the income-tax rate, accumulated depreciation per block, a purchase and a sale in the year)
loaded as FinCom holds books: as a company, then as a firm. Test data only.
  1. the answer first: four figures, the Confirm list, the register (one row per asset, grouped by class, subtotals, the
     grand total), the tabs Register, Books schedule, IT blocks, Deferred tax, Journal
  2. the register's totals against the books (the trial balance worked out here from the same entries): the difference
     shown as one red line, with Show difference
  3. the filters: find, additions this year, sold or scrapped
  4. the drawer: the asset ledger's entries with the running balance and Look up; its depreciation by year; a change
     refused without a reason and kept with it
  5. Export: every file opens; the Excel's formulas are there and its grand total is the screen's; Print / PDF
  6. carry forward to the next year
  7. a firm: the books at the Income-tax rates, no Companies Act, no deferred tax (tab, figures, export); its own policy
     at ICAI Level II shows deferred tax, at Level IV none
  8. the books are unchanged; no page errors
Run one at a time (flock /tmp/fincom-app.lock)."""
import os, sys, json, base64, io, zipfile, re, subprocess, threading, functools, http.server
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
process.stdout.write(JSON.stringify({vouchers, under, groups, led, fa: A.ledgers.map(x => x.l)}));"""], cwd=HERE))

LOAD = """([B, kind]) => {
  const firm = kind === "firm";
  const c = newCompany({name: firm ? "ZZ Edge Binding Partners (made-up)" : "ZZ Edge Binding Works (made-up)", gstin: firm ? "27AAAFE1234E1Z5" : "27AAACE1234E1Z5"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const b = {loading: false, cid: c.id, challans: [], alloc: {}, vouchers: B.vouchers, under: B.under, groups: B.groups, ledInfo: {}, gstins: {}, pans: {}, states: {},
    meta: {from: "20240401", to: "20260331"}, tb: {from: "20240401", to: "20260331", led: B.led, src: "copy", at: "2026-10-14"}, misCfg: {freq: "off"}, auditCfg: {freq: "off"}};
  b.map = Books.mapLedgers(b.vouchers, {});
  S.books = b; window.__bk = b; S.booksTab = "fs"; S.fsTab = "dep"; S.fsFy = "2025"; S.farFy = null; S.farTab = null; S.farF = {}; render();
}"""
STATE = "() => JSON.stringify([window.__bk.vouchers, window.__bk.tb, window.__bk.map, (window.__bk.post || null), (S.tallyQueue || null)])"
# the books at 31-03-2026, worked out here from the same entries: the asset ledgers and the accumulated-depreciation ledgers
FA = B["fa"]; ACC = [l for l in FA if re.search(r"\bdep", l, re.I)]
def close(l):
    o = -B["led"][l]["open"]
    for v in B["vouchers"]:
        if "20240401" <= v["date"] <= "20260331":     # from where FinCom's copy begins (its openings are at 01-04-2024)
            o += sum(-e["a"] for e in v["ent"] if e["l"] == l)
    return o
TB_GROSS = sum(close(l) for l in FA if l not in ACC); TB_ACC = -sum(close(l) for l in ACC)

def page(br, kind):
    ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    pg.evaluate(LOAD, [B, kind]); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; S.booksTab = 'fs'; S.fsTab = 'dep'; S.fsFy = '2025'; render();"); pg.wait_for_timeout(2000)
    pg.wait_for_selector("[data-far-row]", timeout=30000)
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n, blob) => { const r = new FileReader(); r.onload = () => window.__saved.push([n, r.result.split(',')[1]]); r.readAsDataURL(blob); }; }")
    return ctx, pg
rows = lambda pg: pg.eval_on_selector_all("[data-far-row]", "els => els.map(e => e.getAttribute('data-far-row'))")

with sync_playwright() as p:
    br = p.chromium.launch()
    print("== a company")
    ctx, pg = page(br, "company")
    before = pg.evaluate(STATE)
    # 1
    R = pg.evaluate("(() => { const r = FAR.forYear(S.books, '2025'); return {t: r.register.total, basis: r.basis, tie: r.tie, groups: r.register.groups.length}; })()")
    tiles = {k: pg.inner_text("[data-far-tile='%s'] b" % k) for k in ("gross", "acc", "net", "dep")}
    num = lambda s: float(re.sub(r"[^\d.\-]", "", s))
    ok(R["basis"] == "sch2" and abs(num(tiles["gross"]) - R["t"]["gClose"]) < 0.005 and abs(num(tiles["acc"]) - R["t"]["dClose"]) < 0.005 and abs(num(tiles["net"]) - R["t"]["nClose"]) < 0.005 and abs(num(tiles["dep"]) - R["t"]["dep"]) < 0.005,
       "1. the four figures first: gross block, accumulated depreciation, net block, the year's depreciation " + str(tiles))
    ok(sorted(rows(pg)) == ["L:AC - Hitachi", "L:Edge Binding Machine", "L:HP Laptop"] and pg.locator("[data-far-kind='g']").count() == 3 and pg.locator("[data-far-kind='s']").count() == 3 and pg.locator("[data-far-total]").count() == 1,
       "1. the register: one row per asset, grouped by class with subtotals and the grand total; the accumulated-depreciation ledgers are not assets")
    gt = pg.inner_text("[data-far-total]")
    ok("Grand total" in gt and "4,95,000.00" in gt, "1. the grand total row (" + gt.replace("\n", " ")[:90] + ")")
    total = pg.evaluate("FAR.forYear(S.books, '2025').confirm.length")
    ok(pg.locator("[data-far-confirm]").count() == 1 and pg.locator("[data-far-item]").count() == 3 and pg.locator("[data-far-item='settings']").count() == 1 and ("Show %d more" % (total - 3)) in pg.inner_text("[data-far-conf-more]"),
       "1. the Confirm list: the first 3 of %d, then Show %d more" % (total, total - 3))
    pg.click("[data-far-conf-more]"); pg.wait_for_timeout(400)
    ok(pg.locator("[data-far-item]").count() == total, "1. Show more: all %d" % total)
    tabs = pg.eval_on_selector_all("[data-far-tab]", "els => els.map(e => e.getAttribute('data-far-tab'))")
    ok(tabs == ["reg", "books", "it", "dt", "je"], "1. the tabs: Register, Books schedule, IT blocks, Deferred tax, Journal " + str(tabs))
    # 2 the books
    ok(abs(R["tie"]["books"]["gross"] - TB_GROSS) < 0.005 and abs(R["tie"]["books"]["acc"] - TB_ACC) < 0.005 and TB_GROSS == 529000 and TB_ACC == 131000, "2. the books worked out here: asset ledgers %.2f, accumulated depreciation %.2f" % (TB_GROSS, TB_ACC))
    diff = round(R["t"]["nClose"] - (TB_GROSS - TB_ACC), 2)
    ok(pg.locator("[data-far-tie]").count() == 1 and abs(R["tie"]["diff"]["net"] - diff) < 0.005, "2. the difference as one red line: %.2f" % diff)
    pg.click("[data-far-tie-show]"); pg.wait_for_timeout(400)
    ok("Books (trial balance)" in pg.inner_text("[data-far-tie-table]") and "HP Laptop" in pg.inner_text("[data-far-tie-table]"), "2. Show difference: the register against the books, ledger by ledger")
    pg.screenshot(path=os.path.join(OUT, "fixed-assets-ui.png"), full_page=True)
    # 3 the filters
    pg.fill("input[data-fk='farFq']", "laptop"); pg.wait_for_timeout(700)
    ok(rows(pg) == ["L:HP Laptop"], "3. find: the laptop")
    pg.evaluate("clearFilter('farF')"); pg.wait_for_timeout(300); pg.evaluate("setFilter('farF', 'mv', 'add')"); pg.wait_for_timeout(400)
    ok(rows(pg) == ["L:Edge Binding Machine"], "3. additions this year: the machine")
    pg.evaluate("setFilter('farF', 'mv', 'sold')"); pg.wait_for_timeout(400)
    ok(rows(pg) == ["L:HP Laptop"], "3. sold or scrapped: the laptop")
    pg.evaluate("clearFilter('farF')"); pg.wait_for_timeout(400)
    # confirming a point
    pg.click("[data-far-ok='acc:Provision for Dep on P&M @15%']"); pg.wait_for_timeout(600)
    ok(pg.locator("[data-far-item='acc:Provision for Dep on P&M @15%']").count() == 0 and pg.evaluate("!!window.__bk.fixedAssets['2025'].ok['acc:Provision for Dep on P&M @15%'].at"), "3. a point confirmed: off the list, with who and when")
    # 4 the drawer
    pg.click("[data-far-row='L:Edge Binding Machine']"); pg.wait_for_selector("[data-detail='farAsset'] [data-far-ledger]", timeout=10000)
    led = pg.inner_text("[data-far-ledger]")
    ok(pg.locator("[data-far-ledger] tbody tr").count() == 2 and "Opening balance" in led and "Sharma Machines" in led and "4,50,000.00" in led and pg.locator("[data-far-look]").count() == 1, "4. the ledger: opening 3,00,000, the purchase from Sharma Machines, 4,50,000; Look up on the entry")
    ok("2025-26" in pg.inner_text("[data-far-history]") and "from Sharma Machines (Purchase A1)" in pg.inner_text("[data-far-drawer-head]"), "4. its depreciation by year; the supplier and voucher in the drawer")
    f = pg.locator("[data-far-field='location']"); f.fill("Bay 3, Noida"); f.press("Tab"); pg.wait_for_timeout(500)
    ok(pg.evaluate("window.__bk.fixedAssets['2025'].assets.find(a => a.ledger === 'Edge Binding Machine').location || ''") == "", "4. a change without a reason is refused")
    pg.fill("[data-far-why]", "physical verification of 31-03-2026"); f = pg.locator("[data-far-field='location']"); f.fill("Bay 3, Noida"); f.press("Tab"); pg.wait_for_timeout(600)
    a = pg.evaluate("window.__bk.fixedAssets['2025'].assets.find(a => a.ledger === 'Edge Binding Machine')")
    ok(a.get("location") == "Bay 3, Noida" and a["log"][-1]["reason"] == "physical verification of 31-03-2026" and "physical verification" in pg.inner_text("[data-far-log]"), "4. with its reason: kept, and the change shown with the reason")
    pg.screenshot(path=os.path.join(OUT, "fixed-assets-ui-drawer.png"))
    pg.click("[data-far-look]"); pg.wait_for_timeout(1200)
    lk = pg.evaluate("[S.booksTab, typeof LK === 'object' ? LK.st().led : null, typeof LK === 'object' ? LK.st().from : null]")
    ok(lk[0] == "lookup" and lk[1] == "Edge Binding Machine" and lk[2] == "20251120", "4. Look up opens the ledger on that date " + str(lk))
    pg.evaluate("S.booksTab = 'fs'; S.fsTab = 'dep'; render();"); pg.wait_for_timeout(1000)
    # 5 export
    pg.click("[data-far-export] summary"); pg.wait_for_timeout(300)
    items = pg.eval_on_selector_all("[data-far-x]", "els => els.map(e => e.getAttribute('data-far-x'))")
    ok(len(items) == 13 and "dt-xlsx" in items and "all-xlsx" in items, "5. Export: %d choices (register, books, IT blocks, deferred tax; Excel, PDF, Word; everything)" % len(items))
    pg.click("[data-far-export] summary"); pg.wait_for_timeout(200)
    for x in [i for i in items if not i.endswith("-pdf")]:
        pg.evaluate("(x) => { const b = document.querySelector('[data-far-x=\"' + x + '\"]'); b.click(); }", x); pg.wait_for_timeout(900)
    pg.wait_for_timeout(1500)
    saved = pg.evaluate("window.__saved")
    good = 0
    for n, b64 in saved:
        z = zipfile.ZipFile(io.BytesIO(base64.b64decode(b64)))
        if n.endswith(".xlsx"):
            sh = "".join(z.read(k).decode() for k in z.namelist() if k.startswith("xl/worksheets/"))
            good += ("<f>" in sh and "ZZ EDGE BINDING WORKS" in z.read("xl/sharedStrings.xml").decode())
        else: good += "word/document.xml" in z.namelist()
    ok(len(saved) == 9 and good == 9, "5. nine files saved (Excel and Word of four, and everything) and each opens; the Excel with formulas and the client's name " + str([n.split("-2025")[0][-22:] for n, _ in saved]))
    reg_x = next(b64 for n, b64 in saved if "fixed-asset-register-2025.xlsx" in n)
    path = os.path.join(OUT, "fixed-assets-ui-register.xlsx"); open(path, "wb").write(base64.b64decode(reg_x))
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True); ws = wb["Register"]
    gtr = [r for r in ws.iter_rows(values_only=True) if r[0] == "Grand total"][0]
    ok(abs(gtr[5 + 1] - R["t"]["gAdd"]) < 0.005 and abs(gtr[5 + 5] - R["t"]["dep"]) < 0.005 and abs(gtr[5 + 9] - R["t"]["nClose"]) < 0.005, "5. the register's Excel grand total is the screen's")
    import reports_recalc as RC
    bad, used, nf = RC.differences(path, "python")
    ok(not bad and nf >= 20, "5. the register's Excel recalculated apart from FinCom: %d formulas, %d differ (%s)" % (nf, len(bad), used))
    with ctx.expect_page() as pop:
        pg.evaluate("document.querySelector('[data-far-x=\"register-pdf\"]').click()")
    pw = pop.value; pw.wait_for_timeout(800); t = pw.inner_text("body")
    ok("Fixed asset register" in t and "Grand total" in t and "ZZ EDGE BINDING WORKS" in t, "5. Print / PDF: the register"); pw.pdf(path=os.path.join(OUT, "fixed-assets-ui-register.pdf")); pw.close()
    # the tabs
    for k in ("books", "it", "dt", "je"):
        pg.click("[data-far-tab='%s']" % k); pg.wait_for_timeout(400)
        ok(pg.locator("[data-far-pane='%s']" % k).count() == 1, "5. the %s tab" % k)
    pg.click("[data-far-tab='reg']"); pg.wait_for_timeout(300)
    # 6 carry forward
    pg.click("[data-far-carry]"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("Object.keys(window.__bk.fixedAssets).sort().join()") == "2025,2026" and pg.input_value("[data-far-year-pick]") == "2026" and sorted(rows(pg)) == ["L:AC - Hitachi", "L:Edge Binding Machine"],
       "6. carried forward to 2026-27: the two assets still held, the laptop sold stays behind")
    # Confirm all shown
    pg.evaluate("S.farFy = '2025'; render();"); pg.wait_for_timeout(800)
    n0 = pg.evaluate("FAR.forYear(S.books, '2025').confirm.filter(c => !/^need:/.test(c.key)).length")
    pg.click("[data-far-ok-all]"); pg.wait_for_timeout(800)
    ok(n0 > 1 and pg.evaluate("FAR.forYear(S.books, '2025').confirm.filter(c => !/^need:/.test(c.key)).length") == 0 and pg.locator("[data-far-confirm]").count() == 0, "1. Confirm all shown: %d points confirmed, the list gone" % n0)
    ok(pg.evaluate(STATE) == before, "8. the books are unchanged: vouchers, balances, ledger map; nothing queued for Tally")
    ctx.close()

    print("== a firm")
    ctx, pg = page(br, "firm")
    before = pg.evaluate(STATE)
    pg.evaluate("S.farConfAll = true; render();"); pg.wait_for_timeout(400)
    t = pg.inner_text("[data-far]")
    ok(pg.get_attribute("[data-far]", "data-far-basis") == "it" and "Companies Act" not in t and "Schedule II" not in t.replace("no Schedule II", "") and "Partnership firm: the books follow the Income-tax rates" in t, "7. a firm: the books at the Income-tax rates, no Companies Act")
    tabs = pg.eval_on_selector_all("[data-far-tab]", "els => els.map(e => e.getAttribute('data-far-tab'))")
    ok("dt" not in tabs and not pg.locator("[data-far-item='dt']").count(), "7. no Deferred tax tab, no deferred tax rate to confirm " + str(tabs))
    F = pg.evaluate("(() => { const r = FAR.forYear(S.books, '2025'); return [r.totals.dep, r.totals.itDep + r.totals.itAddl, r.dt, r.register.by]; })()")
    ok(abs(F[0] - F[1]) < 0.005 and F[2] is None and F[3] == "block", "7. the books' depreciation is the blocks' (%.2f), the register grouped by block" % F[0])
    pg.click("[data-far-export] summary"); pg.wait_for_timeout(300)
    items = pg.eval_on_selector_all("[data-far-x]", "els => els.map(e => e.getAttribute('data-far-x'))")
    ok(len(items) == 10 and not any(i.startswith("dt-") for i in items), "7. Export: no deferred tax working")
    pg.click("[data-far-export] summary"); pg.wait_for_timeout(200)
    pg.screenshot(path=os.path.join(OUT, "fixed-assets-ui-firm.png"), full_page=True)
    # the layout follow-up: the page's name in full; the block as its rate; the sideways scroll said
    ok(pg.evaluate("(() => { const h = document.querySelector('#cobar .tbar-title h2'); return h && h.scrollWidth <= h.clientWidth + 1; })()") and pg.locator("[data-far-scroll]").count() == 1, "7. the page's name is not cut short; the register says to scroll sideways")
    ok(pg.evaluate("[...document.querySelectorAll('[data-far-kind=a] td:nth-child(2)')].every(td => /^\\d+%$/.test(td.innerText.trim()))"), "7. the block column shows the rate (15%, 40%)")
    # its own policy at ICAI Level II, then Level IV (the statements' switch)
    pg.evaluate("""() => { const b = window.__bk, r = b.fixedAssets['2025']; r.settings = Object.assign({}, r.settings, {bookBasis: 'own', method: 'SLM'});
      b.fs = {rx: {map: {versions: [], draft: {}}, det: {'2025': {policies: {switches: {levelIV: false}}}}, opts: {}}}; render(); }"""); pg.wait_for_timeout(800)
    tabs = pg.eval_on_selector_all("[data-far-tab]", "els => els.map(e => e.getAttribute('data-far-tab'))")
    ok(pg.get_attribute("[data-far]", "data-far-basis") == "own" and "dt" in tabs and "Companies Act" not in pg.inner_text("[data-far]"), "7. its own policy at Level II: the Deferred tax tab, still no Companies Act")
    pg.evaluate("() => { window.__bk.fs.rx.det['2025'].policies.switches.levelIV = true; render(); }"); pg.wait_for_timeout(800)
    tabs = pg.eval_on_selector_all("[data-far-tab]", "els => els.map(e => e.getAttribute('data-far-tab'))")
    ok("dt" not in tabs and "ICAI Level IV" in pg.inner_text("[data-far-entity]"), "7. at Level IV: no deferred tax")
    ok(pg.evaluate(STATE) == before, "8. the books are unchanged")
    ctx.close(); br.close()
errs = [e for e in errors if "supabase" not in e.lower() and "Failed to load" not in e]
ok(not errs, "8. no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
