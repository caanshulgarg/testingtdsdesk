"""python3 run_page_tops.py - the status lines leave the page body (the owner, 14-Oct-2026, round 3 A):
  1. no page shows "Saved 08:07 IST · changes by others appear here at once", "Books as of … · Update now" or
     "Books: last entry … Opened in 0.3 s, every entry in 7.5 s" (TDS, MIS, Reports)
  2. saved: the top bar's save chip says "Saved 08:07", the rest in its tooltip
  3. the Tally chip's panel: "Books up to … · read …" with Update now; the timing only under Details (for support)
  4. books over 2 days old, or reading stopped: no line on the page (next-tally-icon); the header's Tally icon's popover says it
Runs on the React build: app/dist-test, or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("PAGE_TOPS_PORT") or 8364)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
OLD = ["appear here at once", "Books as of", "Opened in", "every entry in", "Books: last entry"]

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
        pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
        J = lambda e, a=None: pg.evaluate(e, a)
        W = pg.wait_for_timeout
        # the firm account signed in and saving live; the books read from Tally an hour ago; a timing to show
        J("""() => {
          Cloud.on = () => true; Cloud.st = Object.assign(Cloud.st || {}, {state: 'in', firm: 'f-1'});
          Live.st = 'live'; Live.sv = {state: '', at: Date.parse('2026-10-14T02:37:00Z'), pending: 0};
          BookItems.on = () => true; BookSync.off = false;
          window.__asof = new Date(Date.now() - 3600e3).toISOString();
          window.booksAsOf = () => ({at: window.__asof, what: 'read', why: "the bridge's last read of this company in Tally", text: 'Books as of x', say: 'Tally cannot send its changes by itself.'});
          S.books.openMs = 300; S.books.readyMs = 7500; render();
        }"""); W(600)
        def body(): return pg.inner_text("#app")
        def page(tab, sub=None):
            J("([t, s]) => { S.view = 'company'; S.tab = 'books'; S.booksTab = t; if (s) S.tdsView = s; S.tdsFy = '2025-26'; S.tdsQ = ''; render(); }", [tab, sub]); W(700)

        print("1. no status lines in the page body")
        for tab, sub in [("tds", "year"), ("mis", None), ("reports", None)]:
            page(tab, sub)
            t = body()
            left = [o for o in OLD if o in t]
            ok(not left and pg.locator("#app [data-books-asof], #app [data-opentime], #app [data-booksave]").count() == 0,
               "%s: none of the old lines (%s)" % (tab, left))
            ok(pg.locator("#app [data-books-stale]").count() == 0, "%s: books read an hour ago: no amber line" % tab)

        print("2. the save chip")
        page("tds", "year")
        chip = pg.locator('#cobar [data-save="saved"]')
        ok(chip.count() == 1 and chip.inner_text().strip().startswith("Saved "), "the top bar says Saved <time> (%s)" % (chip.inner_text() if chip.count() else "none"))
        tip = chip.get_attribute("title") if chip.count() else ""
        ok("appear here at once" in (tip or ""), "its tooltip: changes by others appear here at once (%s)" % tip)
        J("() => { Live.sv.state = 'saving'; render(); }"); W(300)
        ok(pg.locator('#cobar [data-save="saving"]').count() == 1 and chip.count() == 0, "while saving: Saving…")
        J("() => { Live.sv.state = ''; render(); }"); W(300)

        print("3. the Tally panel")
        J("() => { S.tallyPanel = true; render(); }"); W(700)
        pb = pg.locator('[data-overlay="tallypanel"] [data-panel-books]')
        txt = pb.inner_text() if pb.count() else ""
        ok(pb.count() == 1 and "Books up to" in txt and "read" in txt, "the panel: Books up to … · read … (%r)" % txt)
        ok(pg.locator('[data-overlay="tallypanel"] [data-panel-books] [data-update-now]').count() == 1, "with Update now")
        det = pg.locator('[data-overlay="tallypanel"] details[data-panel-details]')
        ok(det.count() == 1 and not det.evaluate("d => d.open"), "the timing is under Details, closed")
        if det.count():
            det.locator("summary").click(); W(200)
            dt = det.inner_text()
            ok("Opened in 0.3 s" in dt and "every entry in 7.5 s" in dt, "Details: the timing, for support (%r)" % dt[:160])
        J("() => { S.tallyPanel = false; render(); }"); W(500)

        print("4. stale books, reading stopped: no line on the page; the header's Tally icon's popover says it")
        # next-tally-icon (27-Oct-2026; the owner: "don't need everywhere tally status"): how fresh the books are from Tally
        # left the page; it is said in the header's Tally icon's popover
        J("() => { window.__asof = new Date(Date.now() - 3 * 86400e3).toISOString(); render(); }"); W(500)
        for tab, sub in [("tds", "year"), ("mis", None)]:
            page(tab, sub)
            ok(pg.locator("#app [data-books-stale]").count() == 0, "%s: books 3 days old: no amber line on the page" % tab)
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector("header.top [data-tally-pop] [data-tally-pop-word]", timeout=15000); W(300)
        st = pg.locator("header.top [data-tally-pop] [data-books-stale]")
        ok(st.count() == 1 and "3 days" in st.inner_text() and not J("!!S.tallyPanel"), "the icon's popover: the books are 3 days old; no side panel (%s)" % (st.inner_text() if st.count() else "none"))
        pg.keyboard.press("Escape"); W(300)
        J("() => { S.tallyPanel = false; window.__asof = new Date(Date.now() - 3600e3).toISOString(); window.__tl = window.tallyLine; window.tallyLine = () => ({state: 'stopped', level: 'bad', text: 'Reading stopped by Anshul at 10:02: Tally slow'}); render(); }"); W(500)
        page("tds", "year")
        ok(pg.locator("#app [data-books-stale]").count() == 0, "reading stopped: no line on the page either")
        J("() => { window.tallyLine = window.__tl; render(); }"); W(300)
        ok(pg.locator("#app [data-books-stale]").count() == 0, "fresh again: no line")
        ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
finally:
    srv.shutdown()
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
