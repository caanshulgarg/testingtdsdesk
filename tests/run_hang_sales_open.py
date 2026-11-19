"""python3 tests/run_hang_sales_open.py - "Page blocked" on a client's Sales (FINCOM-APP-STAGING-K, staging 18-Nov-2026:
2,063 ms in React's click handler, A3 = dispatchDiscreteEvent, route client/sales, last_ui side-client). The client card in
the sidebar opens the client switcher (openSwitcher), which draws the whole page again in the click's own task
(FinComReact.redraw, flushSync), Sales with it. Each invoice waiting showed its duplicate check (SalesAsk -> salesDupOf),
and with no index by number (salesOfNo, src/js/25: only while salesRemapWaiting runs) each check went through every
invoice of the client: the drawing went as the square of the invoices. Opening Sales did the same once more for every
invoice waiting (loadSales: invoiceProblems, its two checks of the same number). Now the invoices are listed by number
once for a drawing, and once for that check on opening (salesByNo, src/js/26-sales-invoice.js).
Made-up books only (the fixture's large client copied 14 times, 51,758 entries, as run_hang_gst_year.py makes them) and
SALES (default 4000) made-up sales invoices on it, half posted, half to review. Checks:
  1. opening Sales from the sidebar (the invoices read from this browser): every task within OPEN_MS (default 2200 at
     full speed: drawing the 2,000 rows to review is about 1.3 s of it; 4,100 ms before, 1,150 after), the list shown;
  2. the sidebar's client card on Sales: the click's own task within CLICK_MS (default 900, mostly the
     page laid out again for the switcher's box; 1,650-1,700 ms before, 370 after), the
     switcher open; Esc closes it, Sales still shown;
  3. the duplicate check still says it: an invoice to review of a number already posted (same type and year) shows
     "Already in Tally as ..." on its row and in its problems; one of another year does not.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, json, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_SALES_PORT") or 8348)
OPEN_MS = int(os.environ.get("OPEN_MS") or 2200)
CLICK_MS = int(os.environ.get("CLICK_MS") or 900)
SALES = int(os.environ.get("SALES") or 4000)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangsales-")
os.symlink(os.path.abspath(SITE), os.path.join(root, "site"))
big = os.environ.get("BIG_DIR")
if not big or not os.path.exists(os.path.join(big, "DayBook.xml")):
    big = os.path.join(root, "bigxml")
    subprocess.run([sys.executable, os.path.join(HERE, "mis_big_books.py"), big], check=True, stdout=subprocess.DEVNULL)
os.symlink(os.path.abspath(big), os.path.join(root, "__big"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=root)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
SEED = open(os.path.join(HERE, "run_hang_gst_year.py")).read().split('SEED = """', 1)[1].split('"""', 1)[0].replace("\\\\", "\\")
# made-up invoices, kept in this browser as Sales keeps them: even ones posted, odd ones to review (each its own number),
# and two to review of a posted number: ZS/0 again in the same year (a duplicate), ZS/2 again a year later (not one)
MAKE = """(n) => { const s = SL(), list = [];
  const one = (no, i, date, posted) => { const t = 1000 + (i * 37) % 90000;
    const v = newInvoice({number: no, date, customerName: 'Made Up Buyer ' + (i % 400), customerGstin: '', pos: '07', taxable: t, cgst: r2(t * .09), sgst: r2(t * .09), igst: 0, cess: 0, total: r2(t * 1.18), items: []}, 'upload');
    v.id = 'zs' + list.length; v.fileName = 'zs' + i + '.pdf'; v.status = posted ? 'posted' : 'review'; if (posted) v.postedAt = '2026-09-30T10:00:00Z'; list.push(v); return v; };
  for (let i = 0; i < n; i++) one('ZS/' + i, i, '2025-0' + (4 + i % 6) + '-1' + (i % 9), i % 2 === 0);
  one('ZS/0', 1, '2025-04-12', false).id = 'zsdup'; one('ZS/2', 3, '2026-04-12', false).id = 'zsnext';
  return BankDB.set('sales:' + s.cid, list).then(() => list.length); }"""
INSTR = """() => { window.__ck = null; window.__lt = [];
  window.addEventListener('click', () => { window.__ck = {t0: performance.now()}; }, true);
  window.addEventListener('click', () => { if (window.__ck) window.__ck.ms = Math.round(performance.now() - window.__ck.t0); }, false);
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({type: 'longtask'}); }"""
WHERE = "() => ({open: S.view + '/' + S.tab, co: S.coId, n: SL() ? SL().list.length : -1, loading: !SL() || !!SL().loading, sw: !!S.switcher})"

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        seed = pg.evaluate(SEED); pg.wait_for_timeout(1500)
        cid = seed["cid"]
        pg.evaluate("(cid) => Route.apply('#/c/' + cid + '/sales')", cid); pg.wait_for_timeout(3000)
        n = pg.evaluate(MAKE, SALES); pg.wait_for_timeout(500)
        ok(seed["n"] > 50000 and n == SALES + 2, "large made-up books: %d entries; %d made-up sales invoices kept in this browser" % (seed["n"], n))
        pg.evaluate(INSTR)
        # 1. opening Sales from the sidebar, the invoices read from this browser
        pg.evaluate("(cid) => Route.apply('#/c/' + cid + '/dash')", cid); pg.wait_for_timeout(3000)
        pg.evaluate("() => { S.sales = null; window.__lt = []; }")
        pg.click('#side button:has-text("Sales")')
        pg.wait_for_function("() => SL() && !SL().loading && SL().list.length > 0", timeout=60000); pg.wait_for_timeout(3000)
        lt = pg.evaluate("window.__lt.slice()"); now = pg.evaluate(WHERE)
        rows = pg.locator("#app table.bk-table tbody tr").count()
        ok(now["open"] == "company/sales" and now["n"] == SALES + 2 and rows >= SALES // 2,
           "1. Sales opened from the sidebar: %d invoices, %d rows shown under To review" % (now["n"], rows))
        ok(max([d for (_, d) in lt] or [0]) <= OPEN_MS, "   every task within %d ms while it opened: %s" % (OPEN_MS, [d for (_, d) in lt][:8]))
        # 2. the sidebar's client card on Sales opens the switcher; its own task
        pg.evaluate("() => { window.__ck = null; window.__lt = []; }")
        pg.click('#side [data-side-client="change"]'); pg.wait_for_timeout(1500)
        m = pg.evaluate("() => ({ck: window.__ck, lt: window.__lt.slice()})")
        ck = (m["ck"] or {}).get("ms", 99999); t0 = (m["ck"] or {}).get("t0", 0)
        task = max([ck] + [d for (s, d) in m["lt"] if s <= t0 + 1 and s + d >= t0 - 1])
        ok(task <= CLICK_MS and pg.evaluate(WHERE)["sw"], "2. the client card on Sales: the click's own task %d ms (at most %d; its handler %d ms), the switcher open" % (task, CLICK_MS, ck))
        pg.keyboard.press("Escape"); pg.wait_for_timeout(1200)
        now = pg.evaluate(WHERE)
        ok(not now["sw"] and now["open"] == "company/sales" and pg.locator("#app table.bk-table tbody tr").count() == rows, "   Esc closes it, Sales still shown (%s)" % now["open"])
        # 3. the duplicate check, as before
        d = pg.evaluate("""() => { const a = inv('zsdup'), b = inv('zsnext');
          return {rowA: !!document.querySelector('#app [data-sales-dup="zsdup"]'), rowB: !!document.querySelector('#app [data-sales-dup="zsnext"]'),
            probA: (a.problems || []).filter(p => /^Already in Tally as/.test(p)).length, probB: (b.problems || []).filter(p => /^Already in Tally as/.test(p)).length,
            dupA: !!salesDupOf(a), dupB: !!salesDupOf(b)}; }""")
        ok(d["rowA"] and d["probA"] == 1 and d["dupA"], "3. an invoice to review of a number posted the same year: \"Already in Tally as\" on its row and in its problems (%s)" % d)
        ok(not d["rowB"] and d["probB"] == 0 and not d["dupB"], "   the same number a year later: not a duplicate")
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
