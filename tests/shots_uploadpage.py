"""python3 shots_uploadpage.py OUTDIR - screenshots of a client's Tally data upload page (Books -> From Tally) with the
made-up client of uploadpage_setup.py (fixture books and masters, FinCom's cloud made up in the page, offline), for
docs/ui-pass/uploadpage/before and after: owner and staff at desktop width (1366) and at phone width (390), and a new
client with nothing yet. Works on the build before the simpler page too (it only sets data and opens the tab).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 shots_uploadpage.py ../docs/ui-pass/uploadpage/after"""
import os, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import uploadpage_setup as U
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    srv, br, pg = U.start(p, 8398, SITE)
    def shot(name, w, h=900):
        pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(700)
        pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); window.scrollTo(0, 0); }"); pg.wait_for_timeout(200)
        path = os.path.join(OUT, name + ".png"); pg.screenshot(path=path, full_page=True); print("  " + path)
    U.open_page(pg, "owner")
    shot("1-owner-desktop", 1366)
    shot("2-owner-phone", 390, 844)
    pg.set_viewport_size({"width": 1366, "height": 900})
    U.open_page(pg, "staff")
    shot("3-staff-desktop", 1366)
    U.open_page(pg, "owner", cloud=False, books=False)
    shot("4-new-client-desktop", 1366)
    shot("5-new-client-phone", 390, 844)
    br.close(); srv.shutdown()
