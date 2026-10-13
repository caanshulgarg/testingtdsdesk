"""python3 run_reports_step3_ui.py - Step 3's screens under the client's Reports tab (app/src/screens/books/Statements.jsx; FSX,
src/js/78-reports.js), on the React build (app/dist-test, or TDSDESK_SITE), with the made-up company of
tests/reports_fixtures.js loaded as the client's books (two years of vouchers, the opening balances as FinCom's copy holds
them). Test data only.
  1. Reports lists "Financial statements and reports": Schedule III, cash MIS, 3CD, DCF
  2. the statements: the summary, the preview in the firm's format, Print / Excel / Word / TB downloads
  3. the mapping: suggested by rule, confirmed (version 1); a ledger moved by hand is "to confirm"; confirmed again (version 2)
  4. the details for you: typed in, kept with the client for the year (b.fs.rx.det)
  5. the checks: all 27 listed, failures with what to look at
  6. the cash-basis MIS: receipts and payments, and it agrees with the books
  7. the Form 3CD draft from the audit's checks, with the questions for you
  8. the DCF: refuses without the assumptions; with them, a value per share
Run one at a time (flock /tmp/fincom-app.lock)."""
import os, sys, json, subprocess, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("RX_PORT") or 8341)
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()

# the made-up company as FinCom holds books: vouchers in Tally's sign (a debit negative), dates YYYYMMDD, the ledgers' groups,
# and the opening balances of 1 April 2024 as FinCom's copy gives them
B = json.loads(subprocess.check_output(["node", "-e", """
const F=require('./reports_fixtures'); const c=F.company();
const t=s=>s.replace(/-/g,''); let id=0;
const conv=v=>({id:'rx'+(++id),date:t(v.date),no:v.no,type:v.type,party:'',narr:'',ent:v.ent.map(e=>({l:e.l,a:-e.a})),cmp:'',gstin:'',pos:'',hsn:[]});
const under={}, groups={}; c.tb.forEach(x=>{ if(x.g.length){ under[x.l]=x.g[0]; groups[x.g[0]]=''; } });
const led={}; c.tb.forEach(x=>{ led[x.l]={open:-x.po}; });
const vouchers=(c.vouchersPy||[]).concat(c.vouchers).map(conv);
process.stdout.write(JSON.stringify({vouchers, under, groups, led, det:Object.assign({}, c.det, {age: c.age}), ent:c.entity}));"""], cwd=HERE))

LOAD = """(B) => {
  const c = newCompany({name: "ZZ Kestrel Widgets (made-up)", gstin: "27AAACK1234K1Z5"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const b = {loading: false, cid: c.id, challans: [], alloc: {}, vouchers: B.vouchers, under: B.under, groups: B.groups, ledInfo: {}, gstins: {}, pans: {}, states: {},
    meta: {from: "20240401", to: "20260331"}, tb: {from: "20240401", to: "20260331", led: B.led, src: "copy", at: "2026-10-13"}, misCfg: {freq: "off"}, auditCfg: {freq: "off"}};
  b.map = Books.mapLedgers(b.vouchers, {}); b.msme = {"Alder Components": "small"};
  const st = FSX.store(b); st.kind = "company"; st.det["2025"] = JSON.parse(JSON.stringify(B.det)); st.det["2025"].entity = Object.assign({}, B.ent); st.det["2025"].stock.py = {"Finished Goods": 300000, "Raw Materials": 200000};
  S.books = b; window.__bk = b; S.booksTab = "reports"; S.rxView = null; S.rxTab = null; S.rxFy = "2025"; render();
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}, accept_downloads=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate(LOAD, B); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; S.booksTab = 'reports'; render();"); pg.wait_for_timeout(800)
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n, blob) => { window.__saved.push([n, blob ? blob.size : 0]); }; }")
    # 1
    t = pg.inner_text("#app")
    ok("Financial statements and reports" in t and pg.locator("[data-rx-entry]").count() == 4, "1. Reports lists Financial statements and reports (4: Schedule III, cash MIS, 3CD, DCF)")
    pg.click('[data-rx-entry="fs"]'); pg.wait_for_timeout(1500)
    # 2
    s = pg.inner_text("[data-rx-summary]")
    ok("ZZ Kestrel" not in s or "Company" in s, "2. the summary: " + s[:140])
    fr = pg.frame_locator("[data-rx-preview]")
    ft = fr.locator("body").inner_text()
    ok("Balance Sheet as at March 31, 2026" in ft and "Statement of Profit and Loss for the year ended March 31, 2026" in ft and "Notes to the Financial Statements" in ft, "2. the preview: balance sheet, P&L and notes in the firm's format")
    ok("For and on behalf of Board of Directors" in ft and "UDIN : 26234567ABCDEF1234" in ft and "(All amounts in ₹, unless otherwise stated)" in ft, "2. signatures and the units line")
    pg.click("[data-rx-excel]"); pg.click("[data-rx-word]"); pg.wait_for_timeout(800)
    pg.click(".rx details.more summary"); pg.click("[data-rx-tb]"); pg.wait_for_timeout(600)
    sv = pg.evaluate("window.__saved")
    ok(any(n.endswith("financial-statements-2025.xlsx") and z > 20000 for n, z in sv) and any(n.endswith(".docx") and z > 10000 for n, z in sv) and any("provisional-TB-2025.xlsx" in n for n, z in sv), "2. downloads: Excel, Word, the provisional TB " + str([n for n, z in sv]))
    with ctx.expect_page() as pop:
        pg.click("[data-rx-print]")
    pw = pop.value; pw.wait_for_timeout(800); ok("Balance Sheet as at March 31, 2026" in pw.inner_text("body"), "2. Print / PDF opens the print view"); pw.pdf(path=os.path.join(OUT, "reports-ui-statements.pdf")); pw.close()
    pg.screenshot(path=os.path.join(OUT, "reports-ui-statements.png"))
    # 3 the mapping
    pg.click('[data-rx-tab="mapping"]'); pg.wait_for_timeout(800)
    ok("not confirmed" in pg.inner_text("[data-rx-statements]") if pg.locator("[data-rx-statements]").count() else True, "3. (statements say the mapping is not confirmed)")
    ok("Suggested from the Tally groups" in pg.inner_text("[data-rx-map-version]") and pg.locator("[data-rx-led]").count() > 40, "3. every ledger listed, suggested by rule")
    pg.click("[data-rx-confirm]"); pg.wait_for_timeout(700)
    ok("Mapping version 1 confirmed" in pg.inner_text("[data-rx-map-version]"), "3. confirmed: version 1")
    pg.select_option('select[aria-label="Line for Advertisement"]', "exc"); pg.wait_for_timeout(700)
    ok("owner, to confirm" in pg.inner_text('[data-rx-led="Advertisement"]'), "3. a ledger moved by hand: to confirm")
    pg.click("[data-rx-confirm]"); pg.wait_for_timeout(700)
    ok("Mapping version 2 confirmed" in pg.inner_text("[data-rx-map-version]") and pg.evaluate("FSX.store(S.books).map.versions.length") == 2, "3. confirmed again: version 2 (version 1 kept)")
    pg.select_option('select[aria-label="Line for Advertisement"]', "exp"); pg.wait_for_timeout(500); pg.click("[data-rx-confirm]"); pg.wait_for_timeout(500)
    # 4 the details
    pg.click('[data-rx-tab="details"]'); pg.wait_for_timeout(700)
    pg.click('.rx-details summary:text-is("Signatures")'); pg.wait_for_timeout(300)
    f = pg.locator('[data-rx-field="sign.auditor.frn"]'); f.fill("654321E"); f.blur(); pg.wait_for_timeout(500)
    ok(pg.evaluate("FSX.store(S.books).det['2025'].sign.auditor.frn") == "654321E", "4. a detail typed is kept with the client for the year")
    f = pg.locator('[data-rx-field="sign.auditor.frn"]'); f.fill("123456W"); f.blur(); pg.wait_for_timeout(400)
    # 5 the checks
    pg.click('[data-rx-tab="checks"]'); pg.wait_for_timeout(700)
    ok(pg.locator("[data-rx-check]").count() == 27, "5. all 27 checks listed")
    nf = pg.locator("[data-rx-check].bad").count()
    ok(nf == 0, "5. no check fails on these books (as FinCom holds them, not rolled over, with last year's closing stock given)" + ("" if nf == 0 else ": " + "; ".join(pg.locator("[data-rx-check].bad").all_inner_texts())[:400]))
    tot = pg.evaluate("(() => { const r = FSX.run(FSX.inputFromBooks('2025', {kind: 'company'})); return [r.model.nm.T_as_CY, r.model.nm.T_pat_CY]; })()")
    ok(tot == [469886600, 25699900], "5. the same totals as the node test of the same books (assets 46,98,866; profit 2,56,999): " + str(tot))
    pg.screenshot(path=os.path.join(OUT, "reports-ui-checks.png"))
    # 6 the cash MIS
    pg.click('[data-rx-open="mis"]'); pg.wait_for_timeout(1200)
    s = pg.inner_text("[data-rx-mis-summary]")
    ok("(agrees)" in s and "Received" in s, "6. cash-basis MIS: " + s)
    pg.click("[data-rx-mis-excel]"); pg.wait_for_timeout(500)
    ok(any("cash-MIS" in n for n, z in pg.evaluate("window.__saved")), "6. the MIS as Excel")
    # 7 the 3CD draft
    pg.click('[data-rx-open="3cd"]'); pg.wait_for_timeout(600); pg.click("[data-rx-3cd-make]"); pg.wait_for_timeout(4000)
    n3 = pg.locator("[data-rx-clause]").count(); t3 = pg.inner_text("[data-rx-3cd]")
    ok(n3 == pg.evaluate("FSX.CLAUSES_3CD.length") and "for you" in t3 and "books" in t3 and "21(d)" in t3, "7. the Form 3CD draft: %d clauses, from the books or for you" % n3)
    # 8 the DCF
    pg.click('[data-rx-open="dcf"]'); pg.wait_for_timeout(1500)
    ok("never assumes" in pg.inner_text("[data-rx-dcf-missing]") if pg.locator("[data-rx-dcf-missing]").count() else False, "8. the DCF refuses without the assumptions")
    pg.evaluate("""() => { Object.assign(FSX.store(S.books).dcf, {years: 3, revGrowth: [10, 10, 10], ebitdaMargin: [12, 12, 12], depPct: 3, capexPct: 4, nwcPct: 10, taxRate: 25, tg: 5, shares: 120000, valuationDate: "2026-03-31", method: "FCFF", wacc: 14, netDebt: 500000}); render(); }""")
    pg.wait_for_timeout(1500)
    ok(pg.locator("[data-rx-dcf-result]").count() == 1 and "Value per share" in pg.inner_text("[data-rx-dcf-result]"), "8. with the assumptions: " + (pg.inner_text("[data-rx-dcf-result]") if pg.locator("[data-rx-dcf-result]").count() else "no result"))
    br.close()
errs = [e for e in errors if "supabase" not in e.lower() and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
