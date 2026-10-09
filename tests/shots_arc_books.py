"""python3 shots_arc_books.py SITE OUTDIR PORT - Arc UI step 2 (09-Oct-2026): the pages that need books, on the made-up
books of tests/fixtures (as run_tdsgst_ui.py loads them): the TDS year grid and a return, the GST year grid and GSTR-1,
Reports, MIS, Look up, Audit and Letters, at desktop (1366) and phone (390) width, light and dark. Each page gets the
checks of shots_round4.py (sideways scroll, cut-off text, WCAG contrast); writes OUTDIR/<width>-<scheme>-books-<page>.png
and prints one line a page."""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE, OUT, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3])
os.makedirs(OUT, exist_ok=True)
# shots_round4's page check, read from its source (importing it would start its web server)
CHECK = re.search(r'CHECK = """(.*?)"""', open(os.path.join(HERE, "shots_round4.py")).read(), re.S).group(1).replace("\\\\n", "\\n")
books = json.load(open(CACHE))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
PAGES = [
    ("tds-year", "goClient('books'); S.booksTab = 'tds'; tdsGo('2026-27');"),
    ("tds-return", "goClient('books'); S.booksTab = 'tds'; tdsGo('2026-27', 'Q4', '26Q');"),
    ("gst-year", "goClient('books'); S.booksTab = 'gst'; S.gstView = 'year'; render();"),
    ("gst-r1", "goClient('books'); S.booksTab = 'gst'; gstOpen('202603', 'r1');"),
    ("reports", "goClient('books:reports');"),
    ("mis", "goClient('books:mis');"),
    ("look-up", "goClient('books:lookup');"),
    ("audit", "goClient('books:audit');"),
    ("letters", "goClient('books:letters');"),
]
bad = 0
with sync_playwright() as p:
    br = p.chromium.launch()
    for vw, vh, wn in [(1366, 768, "desk"), (390, 844, "phone")]:
        for sch in ["light", "dark"]:
            pg = br.new_page(viewport={"width": vw, "height": vh}, color_scheme=sch); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
            pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500); pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
            for name, js in PAGES:
                errs.clear()
                try: pg.evaluate("() => { " + js + " }"); pg.wait_for_timeout(1500)
                except Exception as e: errs.append(str(e)[:160])
                pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); window.scrollTo(0, 0); }"); pg.wait_for_timeout(300)
                c = pg.evaluate(CHECK); notes = []
                if errs: notes.append("errors %s" % errs[:2])
                if c["scroll"] > 0 or c["wide"]: notes.append("sideways %dpx %s" % (c["scroll"], c["wide"][:3]))
                if c["cut"]: notes.append("cut-off %s" % c["cut"][:3])
                if c["nlow"]: notes.append("contrast %d below WCAG AA, worst %s" % (c["nlow"], c["low"][:3]))
                key = "%s-%s-books-%s" % (wn, sch, name)
                pg.screenshot(path=os.path.join(OUT, key + ".png"))
                bad += bool(notes); print(key, "; ".join(notes) if notes else "ok")
            pg.close()
    br.close()
print("pages with a finding:", bad)
