"""python3 run_reports_step3_ui.py - Step 3's screens under the client's Reports tab (app/src/screens/books/Statements.jsx; FSX,
src/js/78-reports.js), on the React build (app/dist-test, or TDSDESK_SITE), with the made-up company of
tests/reports_fixtures.js loaded as the client's books (two years of vouchers, the opening balances as FinCom's copy holds
them). Test data only.
  1. Reports lists "MIS, tax audit and valuation": cash MIS, 3CD, DCF; the financial statements once (the Financial
     statements page, ROUND 99: the older "Financial statements (Schedule III)" view is gone)
  2. an old link to that view opens the Financial statements page
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
  b.fs = {rx: {map: {versions: [], draft: {}}, det: {}, opts: {}}}; const st = b.fs.rx; st.kind = "company"; st.det["2025"] = JSON.parse(JSON.stringify(B.det)); st.det["2025"].entity = Object.assign({}, B.ent); st.det["2025"].stock.py = {"Finished Goods": 300000, "Raw Materials": 200000};
  S.books = b; window.__bk = b; S.booksTab = "reports"; S.rxView = null; S.rxTab = null; S.rxFy = "2025"; render();
}"""
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}, accept_downloads=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    rx_fetch = []
    pg.on("request", lambda r: rx_fetch.append(r.url) if "78-reports" in r.url else None)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    pg.evaluate(LOAD, B); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; S.booksTab = 'reports'; render();"); pg.wait_for_timeout(800)
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n, blob) => { window.__saved.push([n, blob ? blob.size : 0]); }; }")
    # 1
    t = pg.inner_text("#app")
    ents = pg.eval_on_selector_all("[data-rx-entry]", "xs => xs.map(x => x.dataset.rxEntry)")
    ok("MIS, tax audit and valuation" in t and ents == ["mis", "3cd", "dcf"], "1. Reports lists the cash MIS, 3CD and DCF (%s); the older Schedule III statements view is gone" % ents)
    fin = pg.eval_on_selector_all("#app .rpt-link > b", "xs => xs.map(x => x.textContent.trim()).filter(s => /^Financial statements/.test(s))")
    ok(len(fin) == 1 and "Financial statements (Schedule III)" not in t, "1. the financial statements are listed once, the new page (%s)" % fin)
    # 0. the reports' code is its own file, fetched only when a report is first opened ("Preparing…" meanwhile)
    pg.wait_for_timeout(2500)
    ok(not rx_fetch and pg.evaluate("typeof globalThis.FSX") == "undefined", "0. opening FinCom and the Reports tab does not fetch the reports' code (FSX)")
    pg.route("**/78-reports*", lambda route: (pg.wait_for_timeout(600), route.continue_()))
    pg.click('[data-rx-entry="mis"]')
    ok(pg.locator("[data-rx-preparing]").count() == 1 and "Preparing" in pg.inner_text("[data-rx-preparing]"), "0. opening a report shows Preparing… while its code comes")
    pg.wait_for_selector("[data-rx-mis-summary]", timeout=30000); pg.wait_for_timeout(800)
    ok(len(rx_fetch) == 1 and pg.evaluate("typeof globalThis.FSX") == "object", "0. then fetched once (" + (rx_fetch[0].rsplit("/", 1)[-1] if rx_fetch else "none") + ") and the report is drawn")
    ok(pg.locator("[data-rx-open]").count() == 3 and pg.locator('[data-rx-open="fs"]').count() == 0, "0. the views' tabs: MIS, 3CD, DCF")
    # 2. an old link to the Schedule III view opens the Financial statements page
    pg.evaluate("() => { S.rxView = 'fs'; render(); }"); pg.wait_for_timeout(2000)
    ok(pg.locator("#app [data-fin]").count() == 1 and pg.evaluate("S.rxView") is None, "2. an old link to the Schedule III view (rxView fs) opens the Financial statements page")
    pg.evaluate("() => { S.booksTab = 'reports'; S.rxView = 'mis'; render(); }"); pg.wait_for_timeout(1200)
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
