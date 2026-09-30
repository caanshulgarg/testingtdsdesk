"""python3 run_update_btn.py - build 197: Update now on a computer without Tally asks the Tally computer through the cloud."""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8149), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8149/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate("""() => { const c = newCompany({name: "ZZ BTN"}); S.companies[c.id] = c; S.coId = c.id;
      window.__rpc = []; TCloud.has = () => true; TCloud.rpc = (fn, a) => { window.__rpc.push([fn, a]); return Promise.resolve({ok: true, devices: 1}); };
      Bridge.on = () => false; }""")
    h = pg.evaluate("booksFreshLine({vouchers: [{}], meta: {to: '20260930', at: new Date().toISOString()}})")
    ok('data-act="keepNow"' in h, "Update now is shown on a computer without Tally when the client's books are in the cloud")
    pg.evaluate("() => { const b = document.createElement('button'); b.dataset.act = 'keepNow'; document.getElementById('app').appendChild(b); b.click(); }")
    pg.wait_for_timeout(600)
    r = pg.evaluate("window.__rpc")
    ok(r and r[0][0] == "tally_want_update" and r[0][1]["p_client"] == pg.evaluate("S.coId"), "pressing it asks the Tally computer through the cloud: " + str(r))
    ok("asked to update" in pg.inner_text("body"), "and says so")
    ok(not errs, "no page errors " + " ".join(errs[:2]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED"); sys.exit(1 if fails else 0)
