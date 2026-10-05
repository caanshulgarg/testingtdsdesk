"""python3 run_bridge_ports_ui.py - FinCom Bridge 2.3.0 on a shared Windows server: each Windows user's bridge has its own
port of 9100..9119. FinCom never takes a listener on its word (the owner's condition of 05-Oct-2026): before the bridge
key, a pairing code or a computer key goes anywhere, the bridge proves itself on /ping?n=<fresh nonce> (HMAC of its key,
nonce, id and port; of the pairing code while its window is open). A rogue listener on a LOWER port (9100) that claims to
be "yours", names this user's bridge id and replays a proof it saw is recorded: every request it gets carries no key, no
code and no computer key, and FinCom never saves its address.
  1. connecting with the code: the rogue on 9100, this user's bridge on 9102: connected to 9102 (its proof checked);
  2. the bridge moved to 9105: found again by its proof; the rogue never picked;
  3. only the rogue (replaying an old proof): nothing sent, FinCom says it did not prove itself; the address not saved;
  4. only another Windows user's bridge: said plainly;
  5. an older bridge (no proof) on 9100: not connected, said plainly, the code never sent."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from bridge_proof import ping_body, is_ping, nonce_of, mac
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8163), functools.partial(Q, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test")))); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
CORS = {"Access-Control-Allow-Origin": "*"}
def js(r, status, body): return r.fulfill(status=status, content_type="application/json", headers=CORS, body=json.dumps(body))
KEY, BID, CODE = "k" * 24, "go-ab12cd34ef56", "482913"
seen = []          # (nonce, proof) the real bridge gave: the rogue replays them
rogue_got = []     # every request the rogue received: (url, headers)
def rogue(r):
    rogue_got.append((r.request.url, dict(r.request.headers), r.request.post_data or ""))
    if is_ping(r.request.url):
        old = seen[-1] if seen else ("x", "0" * 64)
        return js(r, 200, {"ok": True, "impl": "go", "version": "2.3.0", "yours": True, "bridgeId": BID, "port": 9100, "proof": old[1], "pairProof": old[1]})
    return js(r, 200, {"ok": True, "key": "r" * 24, "computer": "NW144", "version": "2.3.0", "bridgeId": BID, "sessions": [], "jobs": []})
def mine(port, code=CODE):
    def h(r):
        u = r.request.url
        if is_ping(u):
            b = ping_body(u, KEY, BID, port, code)
            seen.append((nonce_of(u), b.get("proof", "")))
            return js(r, 200, b)
        if r.request.headers.get("x-bridge-key", "") not in ("", KEY): return js(r, 401, {"ok": False, "error": "Wrong bridge key."})
        if "/pair?code=" + CODE in u: return js(r, 200, {"ok": True, "key": KEY, "computer": "NW144", "user": "NW144\\anshul", "version": "2.3.0", "bridgeId": BID, "port": port})
        if "/pair" in u: return js(r, 403, {"ok": False, "error": "That is not the code shown in the bridge window."})
        return js(r, 200, {"ok": True, "version": "2.3.0", "sessions": [], "jobs": [], "computer": "NW144", "user": "NW144\\anshul"})
    return h
def other_user(r):
    if is_ping(r.request.url): return js(r, 200, {"ok": True, "impl": "go", "version": "2.3.0", "yours": False})
    return js(r, 403, {"ok": False, "error": "not your FinCom Bridge", "notYours": True})
def nothing(r): return r.abort("connectionrefused")
def route_all(pg, plan):
    pg.unroute("**/*") if False else None
    for p in range(9100, 9120):
        pg.unroute("http://127.0.0.1:%d/**" % p)
        pg.route("http://127.0.0.1:%d/**" % p, plan.get(p, nothing))
def rogue_clean(tag):
    bad = [u for u, h, body in rogue_got if h.get("x-bridge-key") or "code=" in u or CODE in u or KEY in (u + body) or "fcd_" in (u + body) or not is_ping(u)]
    ok(not bad and rogue_got, "%s: the rogue on 9100 got only /ping with a nonce: no key, no code, no computer key (%d requests%s)" % (tag, len(rogue_got), "; BAD: " + str(bad[:2]) if bad else ""))
with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    route_all(pg, {9100: rogue, 9102: mine(9102)})
    pg.goto("http://localhost:8163/#pair=" + CODE); pg.wait_for_timeout(4000)
    cfg = pg.evaluate("Bridge.cfg()")
    ok(cfg.get("key") == KEY and cfg.get("url") == "http://127.0.0.1:9102" and cfg.get("bridgeId") == BID, "1. connected to this user's bridge on 9102 (proved with the code, then with its key), not the rogue on 9100: %r" % {k: cfg.get(k) for k in ("url", "bridgeId")})
    ok("Connected to FinCom Bridge on NW144" in pg.inner_text("body"), "1. and says so")
    rogue_clean("1")
    # 2. moved to 9105 (9102 now free): found again by its proof, the rogue (replaying) never picked
    route_all(pg, {9100: rogue, 9105: mine(9105, None)})
    pg.evaluate("Bridge.foundAt = 0; Bridge.proven = {}")
    st = pg.evaluate("Bridge.call('/status', null, 8000).then(j => ({ok: true, v: j.version}), e => ({ok: false, e: e.message}))")
    ok(st.get("ok") and pg.evaluate("Bridge.cfg().url") == "http://127.0.0.1:9105", "2. the moved bridge is found on 9105 by its proof and answers: %r" % st)
    rogue_clean("2")
    # 3. only the rogue, replaying the last proof it saw: nothing sent, the address not saved
    route_all(pg, {9100: rogue})
    pg.evaluate("Bridge.foundAt = 0; Bridge.proven = {}")
    st = pg.evaluate("Bridge.call('/status', null, 8000).then(j => ({ok: true}), e => ({ok: false, code: e.code, e: e.message}))")
    ok(not st.get("ok") and pg.evaluate("Bridge.cfg().url") == "http://127.0.0.1:9105", "3. a replayed proof fails: nothing done, the rogue's address never saved (%s)" % st.get("e"))
    pg.evaluate("Bridge.setCfg({url: 'http://127.0.0.1:9100'}); Bridge.proven = {}; Bridge.foundAt = Date.now()")
    st = pg.evaluate("Bridge.call('/status', null, 8000).then(j => ({ok: true}), e => ({ok: false, code: e.code, e: e.message}))")
    ok(not st.get("ok") and st.get("code") == "bridge_unproven" and "did not prove" in st.get("e", ""), "3. even at the rogue's own address: refused, said plainly (%s)" % st.get("e"))
    rogue_clean("3")
    # 4. only another Windows user's bridge: said plainly
    route_all(pg, {9100: other_user})
    pg.evaluate("Bridge.foundAt = 0; Bridge.proven = {}; Bridge.setCfg({url: 'http://127.0.0.1:9100', bridgeId: ''})")
    st = pg.evaluate("Bridge.call('/status', null, 8000).then(j => ({ok: true}), e => ({ok: false, code: e.code, e: e.message}))")
    ok(not st.get("ok") and st.get("code") == "bridge_other_user" and "another Windows user" in st.get("e", ""), "4. another user's bridge only: said plainly (%s)" % st.get("e"))
    pg.close()
    # 5. an older bridge (no proof) on 9100: not connected; the code never sent
    pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    old_got = []
    def old(r):
        old_got.append(r.request.url)
        if "/pair" in r.request.url: return js(r, 200, {"ok": True, "key": "o" * 24, "computer": "OFFICE-PC", "version": "2.2.2"})
        return js(r, 200, {"ok": True, "version": "2.2.2", "impl": "go", "sessions": [], "jobs": []})
    route_all(pg, {9100: old})
    pg.goto("http://localhost:8163/#pair=" + CODE); pg.wait_for_timeout(3500)
    ok(not pg.evaluate("Bridge.cfg().key") and not any("code=" in u for u in old_got) and "proved" in pg.inner_text("body"), "5. an older bridge (no proof): not connected, the code never sent, said plainly")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
