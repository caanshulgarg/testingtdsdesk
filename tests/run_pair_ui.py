"""python3 run_pair_ui.py - FinCom opened by the FinCom Connector with a connect code in its address connects to the
bridge by itself, and the code is taken off the address at once."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8147), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors, asked = [], [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def bridge(r):
    u = r.request.url; asked.append(u)
    if "/pair?code=482913" in u: return r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({"ok": True, "key": "k" * 24, "computer": "OFFICE-PC", "version": "1.13.0"}))
    if "/pair" in u: return r.fulfill(status=403, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({"ok": False, "error": "That is not the code shown in the bridge window."}))
    return r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps({"ok": True, "version": "1.13.0", "sessions": [], "jobs": []}))
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("http://127.0.0.1:9100/**", bridge)
    pg.goto("http://localhost:8147/#pair=482913"); pg.wait_for_timeout(3000)
    ok(any("/pair?code=482913" in u for u in asked), "FinCom used the code from its address")
    ok(pg.evaluate("Bridge.cfg().key") == "k" * 24, "and keeps the bridge's key: connected")
    ok("pair=" not in pg.url, "the code is taken off the address at once: " + pg.url)
    ok("Connected to FinCom Bridge on OFFICE-PC" in pg.inner_text("body"), "and says so")
    pg2 = br.new_page(); pg2.on("pageerror", lambda e: errors.append(str(e))); pg2.route("http://127.0.0.1:9100/**", bridge)
    pg2.goto("http://localhost:8147/#pair=111111"); pg2.wait_for_timeout(3000)
    ok("Could not connect to the bridge" in pg2.inner_text("body") and not pg2.evaluate("Bridge.cfg().key"), "a wrong or old code does not connect, and says what to do")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
