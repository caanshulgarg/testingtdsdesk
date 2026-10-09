"""python3 tdsgst_shots.py SITE OUTDIR PORT - the screenshots of the TDS and GST return pages in docs/ui-pass/tdsgst (before: the build of 435945fa; after: app-tdsgst), desktop and phone, on the fixture books and the same books a year on."""
import sys, os, json, time
WT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, WT); os.chdir(WT)
import functools, threading, http.server
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
from playwright.sync_api import sync_playwright
site, out, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
os.makedirs(out, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Q, directory=site)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
STATES = [
 ("tds-year-2025-26", "S.booksTab='tds'; S.tdsFy='2025-26'; S.tdsView='year'; S.tdsQ='';"),
 ("tds-year-2026-27", "S.booksTab='tds'; S.tdsFy='2026-27'; S.tdsView='year'; S.tdsQ='';"),
 ("tds-26q-2025-26-q4-summary", "S.booksTab='tds'; S.tdsFy='2025-26'; S.tdsQ='Q4'; S.tdsForm='26Q'; S.tdsView='return'; S.tdsTab='summary';"),
 ("tds-form140-2026-27-q4-deductions", "S.booksTab='tds'; S.tdsFy='2026-27'; S.tdsQ='Q4'; S.tdsForm='26Q'; S.tdsView='return'; S.tdsTab='deductions';"),
 ("tds-form140-2026-27-q4-checks", "S.booksTab='tds'; S.tdsFy='2026-27'; S.tdsQ='Q4'; S.tdsForm='26Q'; S.tdsView='return'; S.tdsTab='checks';"),
 ("tds-form140-2026-27-q4-file", "S.booksTab='tds'; S.tdsFy='2026-27'; S.tdsQ='Q4'; S.tdsForm='26Q'; S.tdsView='return'; S.tdsTab='file';"),
 ("tds-form138-2026-27-q1", "S.booksTab='tds'; S.tdsFy='2026-27'; S.tdsQ='Q1'; S.tdsForm='24Q'; S.tdsView='return'; S.tdsTab='';"),
 ("gst-year-2025-26", "S.booksTab='gst'; S.gstReg='07'; S.gstYm='202603'; S.gstView='year'; S.gstPart='r1';"),
 ("gst-r1-202603", "S.booksTab='gst'; S.gstReg='07'; S.gstYm='202603'; S.gstView='return'; S.gstPart='r1'; S.gstSub='summary';"),
 ("gst-r3b-202603", "S.booksTab='gst'; S.gstReg='07'; S.gstYm='202603'; S.gstView='return'; S.gstPart='r3b'; S.gstSub='summary';"),
]
with sync_playwright() as p:
    br = p.chromium.launch()
    for w, tag in [(1400, ""), (390, "-phone")]:
        pg = br.new_page(viewport={"width": w, "height": 1000})
        pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600); pg.evaluate(CHALLANS)
        for name, js in STATES:
            if tag and name not in ("tds-year-2026-27", "tds-form140-2026-27-q4-deductions", "gst-year-2025-26", "gst-r1-202603"): continue
            pg.evaluate("() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); S.gstSeen = ''; " + js + " S.gstSeen = (S.gstReg||'') + '|' + GSTSet.typeOf(S.gstYm||'', S.gstReg||''); render(); window.scrollTo(0,0); }"); pg.wait_for_timeout(500)
            pg.screenshot(path=os.path.join(out, name + tag + ".png"), full_page=False if tag else True)
        pg.close()
    br.close()
srv.shutdown(); print("shots in", out)
