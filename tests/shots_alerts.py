"""python3 shots_alerts.py OUTDIR - screenshots of the pages the round 3 alerts change (05-Oct-2026), with the made-up
05-Oct fault of alerts_seed.py: a client's dashboard, purchase, books (Reports) and the Tally page, and the bell opened.
Writes OUTDIR/<page>.png. Run on the React build: TDSDESK_SITE=../app/dist-test python3 shots_alerts.py OUTDIR"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from alerts_seed import dev, GAP, ALERTS, SETUP
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shots-alerts"; os.makedirs(OUT, exist_ok=True)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8353), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1366, "height": 768})
    pg.goto("http://localhost:8353/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    cid = pg.evaluate(SETUP, [{"devs": [dev(recording=False)], "alerts": ALERTS, "gap": GAP}, "owner"])
    for name, js in [("client-dashboard", "(c) => { S.view = 'company'; S.coId = c; S.loadingCo = false; goClient('dash'); }"),
                     ("client-purchase", "(c) => { goClient('bills'); }"), ("client-books-reports", "(c) => { goClient('books:reports'); }"),
                     ("tally-page", "(c) => { navHome('tally'); }"),
                     ("bell-open", "(c) => { S.view = 'company'; S.coId = c; goClient('dash'); setTimeout(() => { const b = document.querySelector('#cobar [data-bell]'); if (b) b.click(); }, 600); }")]:
        pg.evaluate(js, cid); pg.wait_for_timeout(2200)
        pg.evaluate("() => { if (typeof AlertHub === 'object') AlertHub.refresh(true); }"); pg.wait_for_timeout(900)
        pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }"); pg.wait_for_timeout(250)
        f = os.path.join(OUT, name + ".png"); pg.screenshot(path=f); print(f)
    br.close()
srv.shutdown()
