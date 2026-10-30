"""python3 run_fs_stock_tally_ui.py - FinCom Bridge 2.5.1 (the owner's decision of 30-Oct-2026, "1"): the stock from Tally ONLY
when a person clicks "Bring stock from Tally" on the Financial statements' stock panel (Trial balance & mapping). On the
React build (app/dist-test, or TDSDESK_SITE), the made-up books of tests/fixtures/fin-statements (as run_fs_period_ui.py),
FinCom's cloud stood in for in the page (TCloud.on, TCloudUp.post, Cloud.api; nothing leaves the page). Written before the
code. Checks:
  1. opening the page and its tabs asks nothing of FinCom's cloud for the stock (no click, no ask);
  2. the click sends exactly {kind:"wake", what:"stock", client, from, to, again:false} for the period on the page, once;
     the answer is looked for in tally_stock_reads (that book and period) until it comes; then the panel says
     "Opening stock ₹X · Closing stock ₹Y · from Tally at HH:MM IST", the rows' source says "from Tally", the figures are
     used (the P&L's changes in inventories, the balance sheet's inventories), kept for the client (b.fs.stockTally);
  3. the button then reads "Ask Tally again" and sends again:true, once per click; a kept answer the cloud gives back
     (cached) is shown without waiting; a figure typed after Tally's answer is used over it;
  4. Tally too slow: the owner's words "Tally took too long; type the stock or try again later"; with no figures from
     Tally, the typed figure is used (the fallback); a click already on its way (pending) waits for its answer; the
     computer never answering: said plainly after the wait;
  5. a phone (390 wide): the bar wraps, the page never scrolls sideways.
Screenshots go to TDSDESK_OUT (tests/out)/fs-stock-tally."""
import os, re, sys, json, shutil, subprocess, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "fs-stock-tally")
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 0), functools.partial(Q, directory=SITE)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
src = open(os.path.join(HERE, "run_fs_period_ui.py")).read()
GEN = re.search(r'GEN = r"""(.*?)"""', src, re.S).group(1)
SETUP = re.search(r'SETUP = """(.*?)"""', src, re.S).group(1)
OPEN = re.search(r'OPEN = "(.*?)"\n', src).group(1)
BOOKS = json.loads(subprocess.check_output(["node", "-e", GEN, "2024"], cwd=HERE))
# FinCom's cloud in the page: every call kept; the click's answer and the rows the page reads, as the test sets them
CLOUD = r"""() => {
  window.__calls = []; window.__reads = []; window.__plan = {post: null, rows: []};
  TCloud.on = () => true;
  TCloudUp.post = async (body, who) => { window.__calls.push(Object.assign({}, who || {}, body)); const p = window.__plan.post; return typeof p === "function" ? p(body) : p; };
  Cloud.api = async (path) => { window.__reads.push(path); if (/tally_stock_reads/.test(path)) { const r = window.__plan.rows.length > 1 ? window.__plan.rows.shift() : window.__plan.rows[0]; return r ? [r] : []; } return []; };
}"""
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, color_scheme="light"); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(1000)
    pg.evaluate(CLOUD)
    cid = pg.evaluate(SETUP, BOOKS); pg.wait_for_timeout(2500)
    tab = lambda k: (pg.click('#app nav.fin-tabs [data-fin-tab="%s"]' % k), pg.wait_for_timeout(600))
    bar = "#app [data-fin-stockpanel] [data-fin-stocktally]"
    calls = lambda: pg.evaluate("window.__calls")
    stock_calls = lambda: [c for c in calls() if c.get("what") == "stock"]

    print("1. nothing asked without a click")
    pg.select_option("#app [data-fin-preset]", "h1"); pg.wait_for_timeout(900)
    for k in ("bs", "pl", "tb", "notes", "checks", "tb"): tab(k)
    ok(pg.locator(bar).count() == 1 and not stock_calls() and not [r for r in pg.evaluate("window.__reads") if "tally_stock" in r], "the bar is there; no stock asked of FinCom's cloud by opening the page (%s)" % stock_calls())
    btn = pg.locator(bar + " button[data-fin-stockask]")
    ok(btn.inner_text().strip() == "Bring stock from Tally", "the button: %s" % btn.inner_text())

    print("2. the click")
    BOOK = "11111111-1111-1111-1111-111111111251"
    pg.evaluate("""(b) => { window.__plan.post = {ok: true, asked: true, at: '2026-10-30T10:12:00.000000Z', book: b, read: {status: 'asked'}};
      window.__plan.rows = [{status: 'asked'}, {status: 'ok', words: '', opening: 908443.58, closing: 1182130.42, read_at: new Date().toISOString()}]; }""", BOOK)
    btn.click()
    pg.wait_for_selector(bar + " [data-fin-stockread]", timeout=15000)
    sc = stock_calls()
    ok(len(sc) == 1 and sc[0] == {"client": cid, "kind": "wake", "what": "stock", "from": "20250401", "to": "20250930", "again": False}, "exactly one click sent, the page's period (%s)" % sc)
    reads = [r for r in pg.evaluate("window.__reads") if "tally_stock_reads" in r]
    ok(len(reads) >= 2 and all(("book_id=eq." + BOOK) in r and "period_from=eq.2025-04-01" in r and "period_to=eq.2025-09-30" in r for r in reads), "the answer looked for in that book and period (%d reads)" % len(reads))
    line = pg.inner_text(bar + " [data-fin-stockread]")
    ok(re.fullmatch(r"Opening stock ₹9,08,443\.58 · Closing stock ₹11,82,130\.42 · from Tally at \d\d:\d\d IST", line) is not None, "the panel says: %s" % line)
    srcA = pg.inner_text('#app [data-fin-stockpanel] tr[data-fin-stock="20250331"] [data-fin-stocksrc]')
    srcC = pg.inner_text('#app [data-fin-stockpanel] tr[data-fin-stock="20250930"] [data-fin-stocksrc]')
    ok(srcA.startswith("from Tally on ") and srcC.startswith("from Tally on ") and "Stock-in-Hand" in srcC, "the rows say where: %s / %s" % (srcA, srcC))
    ok(pg.evaluate("S.books.fs.stockTally['20250401-20250930'].opening") == 908443.58, "kept for the client (b.fs.stockTally)")
    tab("pl")
    chg = pg.locator('#app table[data-fin-table="pl"] tr[data-fin-line="chg"] td').nth(2).inner_text().strip()
    ok(chg == "(2,73,686.84)", "changes in inventories: 9,08,443.58 less 11,82,130.42 = (2,73,686.84) (%s)" % chg)
    model = pg.evaluate("() => { const d = FinSt.build('2025', {unit: 1, dec: 2, period: {preset: 'h1'}}); return [d.stock.B.v, d.stock.C.v, d.stock.C.src]; }")
    ok(model == [908443.58, 1182130.42, "tallyread"], "the statements use Tally's figures (%s)" % model)
    tab("tb"); pg.screenshot(path=os.path.join(OUT, "stock-from-tally.png"), full_page=False)

    print("3. Ask Tally again; a kept answer")
    btn = pg.locator(bar + " button[data-fin-stockask]")
    ok(btn.inner_text().strip() == "Ask Tally again" and btn.get_attribute("data-fin-stockask") == "again", "the button now: %s" % btn.inner_text())
    pg.evaluate("() => { window.__plan.post = {ok: true, asked: false, cached: true, read: {status: 'ok', opening: 908443.58, closing: 1182000, readAt: new Date().toISOString()}}; }")
    btn.click(); pg.wait_for_timeout(1200)
    sc = stock_calls()
    ok(len(sc) == 2 and sc[1]["again"] is True and "Closing stock ₹11,82,000.00" in pg.inner_text(bar), "Ask Tally again: one more click, again true; the answer shown (%s)" % sc[1:])

    # a figure typed after Tally's answer: the person's later word is used (the cell stays typeable)
    box = pg.locator('#app [data-fin-stockpanel] input[aria-label="Stock as on 30-Sep-2025"]')
    ok(box.count() == 1, "the closing from Tally can still be typed over")
    box.fill("1190000"); box.press("Tab"); pg.wait_for_timeout(1000)
    srcC = pg.inner_text('#app [data-fin-stockpanel] tr[data-fin-stock="20250930"] [data-fin-stocksrc]')
    ok(srcC.startswith("typed by ") and pg.evaluate("() => FinSt.build('2025', {unit: 1, dec: 2, period: {preset: 'h1'}}).stock.C.v") == 1190000, "typed after Tally's answer: used (%s)" % srcC)
    ok("Closing stock ₹11,82,000.00" in pg.inner_text(bar), "Tally's answer still shown on the bar")

    print("4. Tally too slow; the typed fallback; no answer")
    pg.select_option("#app [data-fin-preset]", "q3"); pg.wait_for_timeout(900); tab("tb")
    ok(pg.locator(bar + " button[data-fin-stockask]").inner_text().strip() == "Bring stock from Tally", "another period: its own button")
    words = "Tally took too long; type the stock or try again later"
    pg.evaluate("""(a) => { window.__plan.post = {ok: true, asked: true, at: 'x', book: a.b, read: {status: 'asked'}}; window.__plan.rows = [{status: 'slow', words: a.w, opening: null, closing: null, read_at: null}]; }""", {"b": BOOK, "w": words})
    pg.locator(bar + " button[data-fin-stockask]").click()
    pg.wait_for_function("(w) => ((document.querySelector('#app [data-fin-stockmsg]') || {}).textContent || '').trim() === w", arg=words, timeout=15000)
    ok(pg.inner_text(bar + " [data-fin-stockmsg]").strip() == words, "the owner's words: %s" % pg.inner_text(bar + " [data-fin-stockmsg]"))
    box = pg.locator('#app [data-fin-stockpanel] input[aria-label="Stock as on 31-Dec-2025"]')
    ok(box.count() == 1, "the closing as on 31-Dec-2025 can be typed (no figure from Tally)")
    box.fill("1250000"); box.press("Tab"); pg.wait_for_timeout(1000)
    srcC = pg.inner_text('#app [data-fin-stockpanel] tr[data-fin-stock="20251231"] [data-fin-stocksrc]')
    ok(srcC.startswith("typed by "), "the typed figure used: %s" % srcC)
    # a click on its way already (pending): its answer looked for, then shown
    pg.evaluate("""(b) => { window.__plan.post = {ok: true, asked: false, pending: true, book: b, read: {status: 'asked'}}; window.__plan.rows = [{status: 'asked'}, {status: 'ok', words: '', opening: 1000, closing: 2000, read_at: new Date().toISOString()}]; }""", BOOK)
    pg.locator(bar + " button[data-fin-stockask]").click()
    pg.wait_for_selector(bar + " [data-fin-stockread]", timeout=15000)
    ok("Closing stock ₹2,000.00" in pg.inner_text(bar), "pending: the earlier click's answer shown when it comes (%s)" % pg.inner_text(bar))
    pg.evaluate("""(b) => { window.__plan.post = {ok: true, asked: true, at: 'y', book: b, read: {status: 'asked'}}; window.__plan.rows = [{status: 'asked'}]; }""", BOOK)
    pg.evaluate("() => { const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, Math.min(ms || 0, 20), ...a); }")   # the 40 s wait, quickly
    pg.locator(bar + " button[data-fin-stockask]").click()
    pg.wait_for_function("() => /did not answer/.test((document.querySelector('#app [data-fin-stockmsg]') || {}).textContent || '')", timeout=15000)
    ok("Is FinCom Bridge running there, with Tally open?" in pg.inner_text(bar + " [data-fin-stockmsg]"), "no answer: said plainly: %s" % pg.inner_text(bar + " [data-fin-stockmsg]"))
    n = len(stock_calls())
    pg.wait_for_timeout(1500)
    ok(len(stock_calls()) == n, "nothing asked again by itself")

    print("5. a phone")
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(800)
    sw = pg.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]")
    ok(sw[0] <= sw[1], "no sideways scroll at 390 wide (%s)" % sw)
    pg.screenshot(path=os.path.join(OUT, "stock-phone.png"), full_page=False)
    ok(not errors, "no page errors (%s)" % errors[:3])
    br.close()
print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
raise SystemExit(1 if fails else 0)
