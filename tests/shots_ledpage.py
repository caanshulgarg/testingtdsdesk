"""python3 shots_ledpage.py OUTDIR - screenshots of a client's GST and TDS ledgers page (Books -> Tally ledgers) with the
made-up client of ledpage_setup.py (fixture books and masters, FinCom's cloud made up in the page, offline), for
docs/ui-pass/ledpage/before and after: owner and staff at desktop width (1366) and at phone width (390), and the page with
no bridge or cloud copy. Works on the build before the simpler page too (it only sets data and opens the tab).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 shots_ledpage.py ../docs/ui-pass/ledpage/after"""
import os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ledpage_setup as L
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    srv, br, pg = L.start(p, 8397, SITE)
    def shot(name, w, h=900):
        pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(700)
        pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); window.scrollTo(0, 0); }"); pg.wait_for_timeout(200)
        path = os.path.join(OUT, name + ".png"); pg.screenshot(path=path, full_page=True); print("  " + path)
    L.open_page(pg, "owner")
    shot("1-owner-desktop", 1366)
    shot("2-owner-phone", 390, 844)
    pg.set_viewport_size({"width": 1366, "height": 900})
    L.open_page(pg, "staff")
    shot("3-staff-desktop", 1366)
    L.open_page(pg, "owner", cloud=False)
    shot("4-no-bridge-desktop", 1366)
    shot("5-no-bridge-phone", 390, 844)
    br.close(); srv.shutdown()
