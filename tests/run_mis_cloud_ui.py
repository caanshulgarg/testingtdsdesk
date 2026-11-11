"""python3 run_mis_cloud_ui.py - next-cloud-mis: the MIS page in a browser, its figures from FinCom's cloud or worked out
here. The fixture books (tests/fixtures/books), the React test build (TDSDESK_SITE, else app/dist-test). The cloud is
played by the page itself: Cloud.fn answers mis-run "now" with the figures of the page's own run (the parts the cloud works
out, and every balance on the day), so what is checked is the page's choice and what it shows:
  1. no cloud version kept with the books: worked out here, "Worked out here"; the cloud not asked (no cloud copy)
  2. the cloud's answer fits the books (its book and version kept with them, MIS.cloudWork the same): Run now shows
     "Worked out in FinCom's cloud at HH:MM", the same figures as worked out here (the summary's words, the result code),
     a customer opens to its bills, the Excel still has them
  3. another version of the books in the cloud: worked out here, and the cloud was asked
  4. the books changed here since the version was kept (an MSME type): worked out here, the cloud asked again (refresh)
"""
import os, sys, re, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import DATA, CACHE, FIXTURE, GSTIN, COMPANY
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Quiet, directory=SITE)
srv = http.server.ThreadingHTTPServer(("localhost", int(os.environ.get("MIS_CLOUD_PORT") or 8197)), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the cloud, played here: the answer mis-run "now" gives, made of the page's own run (r) and the day's balances
CLOUD = """(o) => {
  const b = S.books, r = b.mis.last, at = Audit.balances(r.from, r.to).at(r.to);
  window.__c = {v: 3, misV: MIS.V, partial: false, kind: "mis-now.2", book: "b-made-up", version: o.version, at: o.at, from: r.from, to: r.to,
    sales: Object.assign({masters: true}, r.sales), purchases: r.purchases, goods: r.goods, pl: r.pl, prev: r.prev, ly: r.ly, prevRange: r.prevRange, lyRange: r.lyRange, mtd: r.mtd, ytd: r.ytd,
    cash: r.cash, p2: {cash: r.p2.cash}, comp: {gst: r.comp.gst.map(g => ({ym: g.ym, pay: g.pay})), tds: r.comp.tds, tdsRoll: r.comp.tdsRoll, audit: null}, owed: r.owed,
    balances: {asOn: r.to, cash: r.balances.cash, bank: r.balances.bank, at: JSON.parse(JSON.stringify(at))}};
  window.__asked = [];
  Cloud.on = () => true; Cloud.sess = () => ({access_token: "made-up"});
  Cloud.fn = async (name, body) => { window.__asked.push([name, body.action, body.client, body.from, body.to]); return {ok: true, kept: true, result: JSON.parse(JSON.stringify(window.__c))}; };
}"""
KEEP = "(v) => { const m = S.books.meta = S.books.meta || {}; m.cloud = Object.assign({}, m.cloud, {book: 'b-made-up', ver: v, verWork: MIS.cloudWork(S.books)}); }"
def run_now(pg):
    was = pg.evaluate("((S.books.mis || {}).last || {}).at || ''")
    pg.click('section[data-mis-head] button:text-is("Run now")')
    pg.wait_for_function("(was) => !MIS._again && ((S.books.mis || {}).last || {}).at > was && document.querySelector('[data-mis-where]')", arg=was, timeout=30000); pg.wait_for_timeout(600)
def summary(pg):
    # the page's words without its run line (when, how and where)
    t = pg.inner_text("#app"); return re.sub(r"Worked out [^\n]*", "", t)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}, accept_downloads=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % srv.server_address[1]); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (MIS cloud)", gstin: "@GSTIN@", tallyName: "@CO@"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); window.__bk = S.books; S.booksTab = "import"; render(); }""".replace("@GSTIN@", GSTIN).replace("@CO@", COMPANY), books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    pg.set_input_files("#mastersIn", os.path.join(DATA, "Master.xml")); pg.wait_for_timeout(12000)
    pg.evaluate("S.booksTab = 'mis'; render();"); pg.wait_for_timeout(800)
    pg.click('button:text-is("Last year")'); pg.wait_for_timeout(300)
    # 1. worked out here
    run_now(pg)
    where = pg.get_attribute("[data-mis-where]", "data-mis-where"); line = pg.inner_text("[data-mis-where]")
    ok(where == "here" and line == "Worked out here", "1. no cloud version kept with the books: \"%s\"" % line)
    here_txt, here_code = summary(pg), pg.evaluate("S.books.mis.last.code")
    if FIXTURE: ok("15,50,000.00" in here_txt and "7,18,200.00" in here_txt, "1. the fixture's sales 15,50,000 and receivables 7,18,200 (EXPECTED.md)")
    # 2. the cloud's answer fits
    pg.evaluate(CLOUD, {"version": "v1", "at": "2026-11-11T10:12:00.000Z"}); pg.evaluate(KEEP, "v1")
    run_now(pg)
    where = pg.get_attribute("[data-mis-where]", "data-mis-where"); line = pg.inner_text("[data-mis-where]")
    asked = pg.evaluate("window.__asked")
    ok(where == "cloud" and re.fullmatch(r"Worked out in FinCom’s cloud at 15:42( on \d\d-\w{3}-\d{4})?", line) is not None,
       "2. the cloud's answer fits these books: \"%s\" (10:12 UTC is 15:42 IST)" % line)
    ok(len(asked) == 1 and asked[0][:2] == ["mis-run", "now"] and asked[0][3:] == ["20250401", "20260331"], "2. asked once: %s" % asked)
    cl_txt, cl_code = summary(pg), pg.evaluate("S.books.mis.last.code")
    ok(cl_txt == here_txt and cl_code == here_code, "2. the same figures as worked out here: every word of the page, result code %s = %s" % (cl_code, here_code))
    pg.screenshot(path=os.path.join(HERE, "out", "mis-cloud.png"), full_page=False)
    pg.click('nav[aria-label="MIS"] button:text-is("Receivables")'); pg.wait_for_timeout(500)
    party = pg.locator("#misAge tbody tr[data-key]").first.get_attribute("data-key")
    pg.click('#misAge tr[data-key="%s"] button.linkbtn' % party); pg.wait_for_timeout(400)
    ok(pg.locator("#misAge table").count() == 1 and pg.evaluate("S.books.mis.last.recv.rows.every(p => Array.isArray(p.bills))"), "2. a customer opens to its bills (%s)" % party)
    ok(pg.evaluate("typeof misPackHtml === 'function' && misPackHtml(S.books.mis.last).length > 1000"), "2. the MIS pack is made from the cloud's run")
    pg.click('nav[aria-label="MIS"] button:text-is("Summary")'); pg.wait_for_timeout(400)
    # 3. another version in the cloud: worked out here
    pg.evaluate(CLOUD, {"version": "v2", "at": "2026-11-11T10:20:00.000Z"}); pg.evaluate(KEEP, "v1")
    run_now(pg)
    line, asked = pg.inner_text("[data-mis-where]"), pg.evaluate("window.__asked")
    ok(line == "Worked out here" and len(asked) == 1 and summary(pg) == here_txt, "3. another version of the books in the cloud: \"%s\", the cloud asked (%d)" % (line, len(asked)))
    # 4. the books changed here since the version was kept: worked out here, the cloud asked again
    pg.evaluate(CLOUD, {"version": "v1", "at": "2026-11-11T10:25:00.000Z"}); pg.evaluate(KEEP, "v1")
    pg.evaluate("S.books.msme = Object.assign({}, S.books.msme, {'Made-up Not A Party': 'Micro'})")
    run_now(pg); pg.wait_for_timeout(300)
    line, asked = pg.inner_text("[data-mis-where]"), pg.evaluate("window.__asked")
    ok(line == "Worked out here" and len(asked) == 1, "4. the books changed here since: \"%s\", the cloud asked again to refresh (%d)" % (line, len(asked)))
    ok(not errors, "no page errors %s" % errors[:3])
    br.close()
srv.shutdown()
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
