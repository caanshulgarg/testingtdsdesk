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
    # the other Tally pages: Sync activity (lines the bridge gave up on + one still being fetched), Everything sent, a
    # client's books with held lines, and Post to Tally (pages that exist before the change too)
    def snap(name, js, wait=1800):
        pg.evaluate(js); pg.wait_for_timeout(wait); pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }"); pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(OUT, name + ".png"), full_page=True); print("  " + os.path.join(OUT, name + ".png"))
    pg.evaluate(T.SETUP, [T.DEVS, T.STOPS, T.LINKED, "owner"]); pg.wait_for_timeout(1200)
    cid = pg.evaluate(T.SYNC, T.ENDED + T.FRESH); pg.wait_for_timeout(600)
    snap("6-sync-activity", "() => { Rec.act.at = 0; if (typeof AlertHub === 'object') AlertHub.refresh(true); render(); }")
    snap("7-everything-sent", "() => { S.tallyTab = 'sent'; render(); }")
    snap("8-client-books-held", "async () => { await openCompany(window.__cid || Object.values(S.companies).find(x => x.name === 'ZZ Test Client').id); goClient('books:reports'); }", 2500)
    snap("10-books-tieout", "() => { goClient('books:tieout'); }", 2000)
    snap("9-post-to-tally", "() => { goStep('post', 'bills'); }", 2000)
    br.close()
srv.shutdown()
