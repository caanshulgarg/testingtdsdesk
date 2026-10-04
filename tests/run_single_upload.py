"""python3 run_single_upload.py - one Upload (owner's spec I, 04-Oct-2026): every page that uploads (Purchase, Sales,
Bank, Day Book) has exactly one Upload button, in the same place (the top bar, at the right of the page's title row);
no "+ Upload" on the other pages; no second upload button or "Choose files" lower down; the button opens the right
file box. Offline, a made-up client, the React test build (app/dist-test)."""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import shots_ui_pass as U
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8248), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the buttons that upload (or choose a file to upload) on the page, wherever they are
UPLOADS = """() => [...document.querySelectorAll('#app button, #app .btn, #app [role=button], #cobar button, #cobar .btn')].filter(b => b.offsetParent !== null)
  .filter(b => /\\bupload\\b|choose files|choose the day ?book|day book xml/i.test(b.innerText || '') && (b.matches('button, .btn')))
  .map(b => { const r = b.getBoundingClientRect(); return {text: b.innerText.trim(), top: !!b.closest('#cobar'), data: b.getAttribute('data-upload'), right: Math.round(r.right), y: Math.round(r.top)}; })"""
PAGES = [("Purchase · To review", "purchase-review", "bills", "Upload bills"), ("Purchase · upload", "purchase-upload", "bills", "Upload bills"),
         ("Purchase · In Tally", "purchase-in-tally", "bills", "Upload bills"), ("Bank", "bank", "bank", "Upload statement"),
         ("Sales", "sales", "sales", "Upload invoices"), ("Day Book (From Tally)", "from-tally-daybook", "daybook", "Upload Day Book")]
OTHERS = ["dashboard", "transactions", "reports", "letters", "tds-gst", "client-inbox", "home-clients"]
JS = dict(U.PAGES)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 768}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8248/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    pg.evaluate(U.SEED, None); pg.wait_for_timeout(800)
    spots = []
    for label, page, kind, words in PAGES:
        pg.evaluate(JS[page]); pg.wait_for_timeout(900)
        ups = pg.evaluate(UPLOADS)
        ok(len(ups) == 1, "%s: one upload button (%s)" % (label, [u["text"] for u in ups]))
        if ups:
            u = ups[0]; spots.append((u["right"], u["y"]))
            ok(u["top"] and u["data"] == kind and u["text"] == words, "%s: it is “%s”, in the top bar (%s)" % (label, words, u))
    ok(len(set(spots)) == 1, "the same place on every page that uploads (%s)" % sorted(set(spots)))
    for page in OTHERS:
        pg.evaluate(JS[page]); pg.wait_for_timeout(700)
        ups = pg.evaluate(UPLOADS)
        ok(not [u for u in ups if u["top"]] and "+ Upload" not in pg.inner_text("#cobar"), "%s: no Upload in the top bar (%s)" % (page, [u["text"] for u in ups]))
    # the button opens the right file box
    for page, inp in [("purchase-review", "fileIn"), ("bank", "bankIn"), ("sales", "salesIn"), ("from-tally-daybook", "booksIn")]:
        pg.evaluate(JS[page]); pg.wait_for_timeout(700)
        pg.evaluate("(id) => { window.__clicked = ''; const el = document.getElementById(id); if (el) el.click = () => { window.__clicked = id; }; }", inp)
        pg.click("#cobar [data-upload]"); pg.wait_for_timeout(300)
        ok(pg.evaluate("window.__clicked") == inp, "%s: Upload opens the %s file box" % (page, inp))
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
