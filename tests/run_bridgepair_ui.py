"""python3 run_bridgepair_ui.py - Connect asks for the 6-digit code shown in the bridge window and sends it; the bridge's refusal is shown."""
import os, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8152), functools.partial(Q, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test")))); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, seen, errors = [], [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def bridge(route):
    u = route.request.url; seen.append(u)
    if "/pair" in u:
        if "code=482913" in u: return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "key": "K" * 32, "computer": "TALLY-PC", "version": "1.11.0"}))
        return route.fulfill(status=403, content_type="application/json", body=json.dumps({"ok": False, "error": "That is not the code shown in the bridge window.", "needCode": True}))
    return route.fulfill(status=200, content_type="application/json", body=json.dumps({"ok": True, "sessions": [], "companies": [], "open": []}))
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1300, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("http://127.0.0.1:9100/**", bridge)
    pg.goto("http://localhost:8152/"); pg.wait_for_timeout(2000); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    pg.evaluate("() => { const b = document.createElement('button'); b.dataset.act = 'bridgeConnect'; b.id = 'bc'; document.body.appendChild(b); }")
    pg.click("#bc"); pg.wait_for_timeout(400)
    ok("6-digit code" in pg.inner_text("#confirmBox") and pg.locator("#bridgeCode").count() == 1, "Connect asks for the code from the bridge window")
    pg.fill("#bridgeCode", "12"); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(300)
    ok("Type the 6 digits" in pg.inner_text("#confirmBox") and not any("/pair" in u for u in seen), "fewer than 6 digits: asked again, nothing sent")
    pg.fill("#bridgeCode", "111111"); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(800)
    ok(any("/pair?code=111111" in u for u in seen) and "not the code" in (pg.evaluate("document.getElementById('toast').textContent") or ""), "a wrong code: the bridge's answer is shown")
    ok(not pg.evaluate("Bridge.cfg().key"), "no key kept")
    pg.click("#bc"); pg.wait_for_timeout(300); pg.fill("#bridgeCode", "482 913"); pg.press("#bridgeCode", "Enter"); pg.wait_for_timeout(1200)
    ok(pg.evaluate("Bridge.cfg().key") == "K" * 32, "the right code (spaces allowed): connected, the key kept")
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
