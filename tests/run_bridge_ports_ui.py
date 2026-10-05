"""python3 run_bridge_ports_ui.py - FinCom Bridge 2.3.0 on a shared Windows server: each Windows user's bridge has its own
port of 9100..9119 and answers only its own user. FinCom finds this user's bridge by asking /ping on those ports:
  1. connecting with the code: 9100 is another Windows user's bridge (403 "not your FinCom Bridge"), so FinCom finds
     this user's on 9102 (/ping yours) and connects there; the bridge's id is kept;
  2. a later call to a bridge that moved (nothing on its old port) finds it again by its id and goes on;
  3. an older bridge (no "yours" in its /ping) on 9100 still works as before;
  4. only another user's bridge there: FinCom says so plainly, nothing is connected."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8163), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
CORS = {"Access-Control-Allow-Origin": "*"}
def js(r, status, body): return r.fulfill(status=status, content_type="application/json", headers=CORS, body=json.dumps(body))
asked = []
def other_user(r):   # Ravi's bridge: answers /ping (not yours), refuses the rest
    asked.append(r.request.url)
    if r.request.url.endswith("/ping"): return js(r, 200, {"ok": True, "impl": "go", "version": "2.3.0", "yours": False})
    return js(r, 403, {"ok": False, "error": "not your FinCom Bridge", "notYours": True})
def mine(port):
    def h(r):
        asked.append(r.request.url)
        u = r.request.url
        if u.endswith("/ping"): return js(r, 200, {"ok": True, "impl": "go", "version": "2.3.0", "yours": True, "bridgeId": "go-abc123", "port": port})
        if "/pair?code=482913" in u: return js(r, 200, {"ok": True, "key": "k" * 24, "computer": "NW144", "user": "NW144\\anshul", "version": "2.3.0", "bridgeId": "go-abc123", "port": port})
        if "/pair" in u: return js(r, 403, {"ok": False, "error": "That is not the code shown in the bridge window."})
        return js(r, 200, {"ok": True, "version": "2.3.0", "sessions": [], "jobs": [], "computer": "NW144", "user": "NW144\\anshul"})
    return h
def nothing(r): return r.abort("connectionrefused")
def route_all(pg, plan):
    for p in range(9100, 9120): pg.route("http://127.0.0.1:%d/**" % p, plan.get(p, nothing))
with sync_playwright() as p:
    br = p.chromium.launch()
    # 1. connecting: 9100 is Ravi's, this user's is on 9102
    pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    route_all(pg, {9100: other_user, 9102: mine(9102)})
    pg.goto("http://localhost:8163/#pair=482913"); pg.wait_for_timeout(3500)
    cfg = pg.evaluate("Bridge.cfg()")
    ok(cfg.get("key") == "k" * 24 and cfg.get("url") == "http://127.0.0.1:9102", "1. connected to this user's bridge on 9102, not Ravi's on 9100: %r" % {k: cfg.get(k) for k in ("url", "bridgeId")})
    ok(cfg.get("bridgeId") == "go-abc123", "1. its id is kept, to find it again")
    ok("Connected to FinCom Bridge on NW144" in pg.inner_text("body"), "1. and says so")
    # 2. the bridge moved to 9105 (its old port free): found again by its id, the call goes on
    route_all(pg, {9100: other_user, 9105: mine(9105)})
    pg.evaluate("Bridge.foundAt = 0")
    st = pg.evaluate("Bridge.call('/status', null, 8000).then(j => ({ok: true, v: j.version}), e => ({ok: false, e: e.message}))")
    ok(st.get("ok") and pg.evaluate("Bridge.cfg().url") == "http://127.0.0.1:9105", "2. the moved bridge is found on 9105 and answers: %r" % st)
    # 4. only Ravi's bridge: plain words, nothing connected
    pg.evaluate("Bridge.foundAt = 0; Bridge.setCfg({url: 'http://127.0.0.1:9100', bridgeId: ''})")
    route_all(pg, {9100: other_user})
    st = pg.evaluate("Bridge.call('/status', null, 8000).then(j => ({ok: true}), e => ({ok: false, code: e.code, e: e.message}))")
    ok(not st.get("ok") and st.get("code") == "bridge_other_user" and "another Windows user" in st.get("e", ""), "4. another user's bridge only: said plainly (%r)" % st.get("e"))
    pg.close()
    # 3. an older bridge on 9100 (no "yours"): connects there as before
    pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    def old(r):
        u = r.request.url
        if "/pair?code=482913" in u: return js(r, 200, {"ok": True, "key": "o" * 24, "computer": "OFFICE-PC", "version": "2.2.2"})
        return js(r, 200, {"ok": True, "version": "2.2.2", "impl": "go", "sessions": [], "jobs": []})
    route_all(pg, {9100: old})
    pg.goto("http://localhost:8163/#pair=482913"); pg.wait_for_timeout(3000)
    ok(pg.evaluate("Bridge.cfg().url") == "http://127.0.0.1:9100" and pg.evaluate("Bridge.cfg().key") == "o" * 24, "3. an older bridge on 9100 connects as before")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
