"""python3 shots_tallypage.py OUTDIR - screenshots of the Tally page in the states of run_tally_page_simple.py (made-up
computers, offline), for docs/ui-pass/tallypage/before and after: the page with nothing linked yet, a bridge heard from
with no company linked, four computers (owner) with everything folded and with everything open, and staff.
Works on a build before the simpler page too (whatever Details / More toggles it has are opened).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 shots_tallypage.py ../docs/ui-pass/tallypage/after"""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_simple as T
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
srv = http.server.ThreadingHTTPServer(("localhost", 8392), functools.partial(T.Q, directory=T.SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
OPEN = """() => { document.querySelectorAll('#app [data-more-toggle][aria-expanded="false"]').forEach(b => b.click());
  const d = document.querySelector('#app [data-bridge-details]'); if (d && !d.hasAttribute('data-more-toggle') && !document.querySelector('#app [data-bridge-more]')) d.click();
  const a = document.querySelector('#app [data-bridge-download-again]'); if (a && !document.querySelector('#app [data-bridge-card]')) a.click(); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 768})
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
        body=json.dumps({"setup": {"version": "2.3.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.3.4.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8392/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    def scene(name, devs, cos, role="owner", more=False):
        pg.evaluate(T.SETUP, [devs, T.STOPS, cos, role]); pg.wait_for_timeout(1800)
        if more: pg.evaluate(OPEN); pg.wait_for_timeout(800)
        pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }"); pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(OUT, name + ".png"), full_page=True); print("  " + os.path.join(OUT, name + ".png"))
    scene("1-nothing-yet", [], [])
    scene("2-bridge-heard-no-company-linked", [T.OK_DEV], T.UNLINKED)
    scene("3-owner-four-computers", T.DEVS, T.LINKED)
    scene("4-owner-everything-open", T.DEVS, T.LINKED, more=True)
    scene("5-staff-four-computers", T.DEVS, T.LINKED, role="member")
    br.close()
srv.shutdown()
