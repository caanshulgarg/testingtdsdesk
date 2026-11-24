"""python3 tests/run_hang_sales_switch.py - "Page blocked" on a client's Sales again (FINCOM-APP-STAGING-K, staging
24-Nov-2026 06:06 UTC, release 92d4843b7: 2,059 ms of script in React's click handler c3 = dispatchDiscreteEvent, route
client/sales, last_ui side-client). The client card in the sidebar opens the client switcher (openSwitcher), and the
switcher was drawn by drawing the WHOLE page again in the click's own task (renderSwitcher -> FinComReact.redraw ->
memoScope -> flushSync): the Sales screen with its list, its bar and its counts, the sidebar, the top bar, all worked out
again for a box that only lists the clients. The same for each letter typed in the switcher, each arrow key, and Esc.
Now the switcher is drawn by itself (FinComReact.sw, app/src/store.js); the page under it is left as it is.
Made-up books only (the fixture's large client copied 14 times, as run_hang_gst_year.py makes them) and SALES (default
3000) made-up sales invoices on it, half posted, half to review. The office computers that reported it are slower than
this one: the steps are measured with the CPU slowed SLOW times (default 3, Chrome's own throttling). Checks:
  1. Sales open on the large list (rows drawn under To review);
  2. the sidebar's client card: no frame with over LONG_MS (default 200) of script from the click until the switcher is
     shown;
     the switcher open, its search box focused, every client listed; the arrow keys move the choice, kept in view;
  3. typing in the switcher's box: no frame with over LONG_MS of script, the list narrowed to the client typed;
  4. Esc: no frame with over LONG_MS of script, the switcher shut, Sales still shown with the same rows;
  5. the switcher still opens a client: F3, then a click on the client, opens it (the page drawn as before).
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, json, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_SWITCH_PORT") or 8349)
LONG_MS = int(os.environ.get("LONG_MS") or 200)
SLOW = float(os.environ.get("SLOW") or 3)
SALES = int(os.environ.get("SALES") or 3000)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangswitch-")
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
# made-up invoices kept in this browser as Sales keeps them: even ones posted, odd ones to review
MAKE = """(n) => { const s = SL(), list = [];
  for (let i = 0; i < n; i++) { const t = 1000 + (i * 37) % 90000, posted = i % 2 === 0;
    const v = newInvoice({number: 'ZW/' + i, date: '2025-0' + (4 + i % 6) + '-1' + (i % 9), customerName: 'Made Up Buyer ' + (i % 400), customerGstin: '', pos: '07', taxable: t, cgst: r2(t * .09), sgst: r2(t * .09), igst: 0, cess: 0, total: r2(t * 1.18), items: []}, 'upload');
    v.id = 'zw' + i; v.fileName = 'zw' + i + '.pdf'; v.status = posted ? 'posted' : 'review'; if (posted) v.postedAt = '2026-09-30T10:00:00Z'; list.push(v); }
  return BankDB.set('sales:' + s.cid, list).then(() => list.length); }"""
# the long frames (Long Animation Frames, as the hang report counts them: src/hangWatch.js): [the scripts' time, the
# whole frame]. A frame's whole time also has the browser's own work (laying the page out, painting, collecting
# garbage), which the CPU slowed makes long on a page of 51,758 entries whatever FinCom's code does; its scripts' time
# (with the page laid out because a script asked: focus, a box measured) is what blocked the page in the reports
# (script_ms 2,059 of 2,063 ms)
INSTR = """() => { window.__lt = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round((e.scripts || []).reduce((a, x) => a + x.duration, 0)), Math.round(e.duration)]))).observe({type: 'long-animation-frame'}); }"""
def worst(lt): return max([x[0] for x in lt] or [0])
WHERE = "() => ({open: S.view + '/' + S.tab, co: S.coId, n: SL() ? SL().list.length : -1, sw: !!S.switcher, shown: !!document.querySelector('#modal .sw'), items: document.querySelectorAll('#modal .swlist li[role=option]').length, focus: !!document.activeElement && !!document.activeElement.closest('#modal .sw')})"
ROWS = "() => document.querySelectorAll('#app table.bk-table tbody tr').length"

def step(pg, cdp, act):
    """act with the CPU slowed; the long frames it made (until the page is quiet again)"""
    pg.evaluate("() => { window.__lt = []; }")
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": SLOW})
    try:
        act(); pg.wait_for_timeout(int(1500 * SLOW))
    finally:
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
    return pg.evaluate("window.__lt.slice()")

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        cdp = pg.context.new_cdp_session(pg)
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        seed = pg.evaluate(SEED); pg.wait_for_timeout(1500)
        cid = seed["cid"]
        # a firm's worth of made-up clients for the switcher to list
        pg.evaluate("() => { for (let i = 1; i <= 60; i++) { const c = newCompany({name: 'Made Up Client ' + String(i).padStart(2, '0'), gstin: ''}); S.companies[c.id] = c; } }")
        others = pg.evaluate("(cid) => Object.values(S.companies).filter((c) => c && !c.deleted && c.id !== cid).map((c) => ({id: c.id, name: c.name}))", cid)
        pg.evaluate("(cid) => Route.apply('#/c/' + cid + '/sales')", cid); pg.wait_for_timeout(3000)
        n = pg.evaluate(MAKE, SALES); pg.wait_for_timeout(500)
        # 1. Sales open on the large list
        pg.evaluate("(cid) => Route.apply('#/c/' + cid + '/dash')", cid); pg.wait_for_timeout(2000)
        pg.evaluate("() => { S.sales = null; }")
        pg.click('#side button:has-text("Sales")')
        pg.wait_for_function("() => SL() && !SL().loading && SL().list.length > 0", timeout=60000); pg.wait_for_timeout(3000)
        rows, now = pg.evaluate(ROWS), pg.evaluate(WHERE)
        ok(seed["n"] > 50000 and n == SALES and now["open"] == "company/sales" and now["n"] == SALES and rows >= 200 and others,
           "1. large made-up books (%d entries); Sales open on %d made-up invoices, %d rows drawn; %d other clients" % (seed["n"], now["n"], rows, len(others)))
        pg.evaluate(INSTR)
        # 2. the client card on Sales
        lt = step(pg, cdp, lambda: pg.click('#side [data-side-client="change"]'))
        now = pg.evaluate(WHERE)
        ok(worst(lt) <= LONG_MS, "2. the client card on Sales (CPU %gx slower): no frame with over %d ms of script ([script, frame] ms: %s)" % (SLOW, LONG_MS, lt[:8]))
        ok(now["sw"] and now["shown"] and now["focus"] and now["items"] == len(others) + 1, "   the switcher open, its box focused, every client listed (%s)" % now)
        # the arrow keys still move the choice and keep it in view (the list scrolled to it)
        for _ in range(40): pg.keyboard.press("ArrowDown")
        pg.wait_for_timeout(400)
        a = pg.evaluate("""() => { const li = [...document.querySelectorAll('#modal .swlist li[role=option]')], i = li.findIndex((x) => x.getAttribute('aria-selected') === 'true'),
          ul = document.querySelector('#modal .swlist').getBoundingClientRect(), r = li[i] ? li[i].getBoundingClientRect() : null;
          return {i, idx: S.switcher.idx, seen: !!r && r.top >= ul.top - 1 && r.bottom <= ul.bottom + 1}; }""")
        for _ in range(40): pg.keyboard.press("ArrowUp")
        pg.wait_for_timeout(400)
        ok(a["i"] == 40 and a["idx"] == 40 and a["seen"] and pg.evaluate("S.switcher.idx") == 0, "   ↓ 40 times: the 41st client chosen and in view of the list; ↑ back to the first (%s)" % a)
        # 3. typing in the switcher's box
        name = "Made Up Client 07"; pick = [c for c in others if c["name"] == name][0]
        lt = step(pg, cdp, lambda: pg.keyboard.type("client 07", delay=60))
        now = pg.evaluate(WHERE)
        ok(worst(lt) <= LONG_MS, "3. typing 'client 07' in the switcher: no frame with over %d ms of script (%s)" % (LONG_MS, lt[:9]))
        ok(now["sw"] and now["items"] == 1 and pg.locator("#modal .swlist li", has_text=name).count() >= 1, "   the list narrowed to it (%d shown)" % now["items"])
        # 4. Esc
        lt = step(pg, cdp, lambda: pg.keyboard.press("Escape"))
        now = pg.evaluate(WHERE)
        ok(worst(lt) <= LONG_MS, "4. Esc: no frame with over %d ms of script (%s)" % (LONG_MS, lt[:8]))
        ok(not now["sw"] and not now["shown"] and pg.evaluate("() => document.getElementById('modal').classList.contains('hidden')") and now["open"] == "company/sales" and pg.evaluate(ROWS) == rows,
           "   the switcher shut, Sales still shown with its %d rows (%s)" % (rows, now["open"]))
        # 5. the switcher still opens a client
        pg.keyboard.press("F3"); pg.wait_for_timeout(800)
        pg.locator("#modal .swlist li", has_text=name).first.click(); pg.wait_for_timeout(3000)
        now = pg.evaluate(WHERE)
        ok(now["co"] == pick["id"] and not now["sw"] and not now["shown"], "5. F3, then a click on another client: it is open (%s), the switcher shut" % now["co"])
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
