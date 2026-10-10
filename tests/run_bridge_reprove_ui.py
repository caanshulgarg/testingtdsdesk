"""python3 run_bridge_reprove_ui.py - review of FinCom Bridge 2.3.0 (97764f7), M2: FinCom kept a bridge's proof for 5 minutes.
A program that takes the port after the bridge restarts (a squatter) then received the bridge key, and a newly created
computer key, within that window. Now FinCom proves the bridge again immediately before EVERY request that carries a secret
(the X-Bridge-Key of any call, /cloudlink, posting, /pair after its own pairProof), and creates a computer key
(tally_device_create) only when a proof was made in that same step.
  1. connected (paired with the code) to this user's bridge on 9102; then the bridge is replaced by a rogue on the SAME port
     that replays the last proof it saw: the next call goes nowhere (the rogue gets /ping with a nonce only: no key);
  2. the automatic link (TCloud.auto): the bridge proves itself and says it is not linked, then is replaced by the rogue:
     no computer key is created (tally_device_create never called) and the rogue gets no key of any kind.
RED (before the change): the cached proof sends the key to the rogue, and the computer key is created and handed to it."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from bridge_proof import ping_body, is_ping, nonce_of
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8171), functools.partial(Q, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test")))); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
CORS = {"Access-Control-Allow-Origin": "*"}
def js(r, status, body): return r.fulfill(status=status, content_type="application/json", headers=CORS, body=json.dumps(body))
KEY, BID, CODE, PORT = "k" * 24, "go-ab12cd34ef56", "482913", 9102
state = {"rogue": False, "flip_after_cloudlink": False}
seen, rogue_got, mine_got = [], [], []
def handler(r):
    u, h, body = r.request.url, dict(r.request.headers), r.request.post_data or ""
    if state["rogue"]:
        rogue_got.append((u, h, body))
        if is_ping(u):
            old = seen[-1] if seen else ("x", "0" * 64)
            return js(r, 200, {"ok": True, "impl": "go", "version": "2.3.0", "yours": True, "bridgeId": BID, "port": PORT, "proof": old[1], "pairProof": old[1]})
        return js(r, 200, {"ok": True, "connected": False, "url": "", "version": "2.3.0", "sessions": [], "jobs": []})
    mine_got.append((u, h, body))
    if is_ping(u):
        b = ping_body(u, KEY, BID, PORT, CODE)
        seen.append((nonce_of(u), b.get("proof", "")))
        return js(r, 200, b)
    if h.get("x-bridge-key", "") not in ("", KEY): return js(r, 401, {"ok": False, "error": "Wrong bridge key."})
    if "/pair?code=" + CODE in u: return js(r, 200, {"ok": True, "key": KEY, "computer": "NW144", "user": "NW144\\anshul", "version": "2.3.0", "bridgeId": BID, "port": PORT})
    if "/cloudlink" in u and r.request.method == "GET":
        if state["flip_after_cloudlink"]: state["rogue"] = True       # the bridge restarts: a squatter takes the port
        return js(r, 200, {"ok": True, "connected": False, "url": ""})
    return js(r, 200, {"ok": True, "version": "2.3.0", "sessions": [], "jobs": [], "computer": "NW144", "user": "NW144\\anshul"})
def nothing(r): return r.abort("connectionrefused")
def secrets(got):
    return [u for u, h, body in got if h.get("x-bridge-key") or "code=" in u or KEY in (u + body) or "fcd_" in (u + body) or not is_ping(u)]
with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    for q in range(9100, 9120): pg.route("http://127.0.0.1:%d/**" % q, handler if q == PORT else nothing)
    pg.goto("http://localhost:8171/#pair=" + CODE); pg.wait_for_timeout(4000)
    cfg = pg.evaluate("Bridge.cfg()")
    ok(cfg.get("key") == KEY and cfg.get("url") == "http://127.0.0.1:%d" % PORT, "connected to this user's bridge on %d: %r" % (PORT, {k: cfg.get(k) for k in ("url", "bridgeId")}))
    st = pg.evaluate("Bridge.call('/status', null, 8000).then(j => ({ok: true}), e => ({ok: false, e: e.message}))")
    ok(st.get("ok"), "a call goes while the bridge proves itself (%s)" % st)
    # 1. the bridge replaced by a rogue on the same port, within seconds of its last proof
    state["rogue"] = True
    pg.evaluate("Bridge.foundAt = Date.now()")       # not looked for anew: only the proof decides
    st = pg.evaluate("Bridge.call('/cloudlink', {url: 'https://x/functions/v1/tally-ingest', key: 'fcd_' + 'e'.repeat(48)}, 8000).then(j => ({ok: true}), e => ({ok: false, code: e.code, e: e.message}))")
    bad = secrets(rogue_got)
    ok(not st.get("ok") and rogue_got and not bad, "1. the next secret request goes nowhere: the rogue got only /ping with a nonce (%d requests%s; %s)" % (len(rogue_got), "; BAD: " + str(bad[:2]) if bad else "", st.get("e")))
    # 2. the automatic link: proven, "not linked", then the squatter: no computer key is made, none handed over
    state["rogue"], state["flip_after_cloudlink"] = False, True
    del rogue_got[:]
    res = pg.evaluate("""async () => {
      const made = [];
      TCloud.on = () => true; Bridge.up = () => true; Bridge.on = () => true; TCloud.autoAt = 0; TCloud.autoBusy = false;
      TCloud.ingestUrl = () => "https://x.supabase.co/functions/v1/tally-ingest";
      TCloud.rpc = async (fn, a) => { made.push(fn); return fn === "tally_device_create" ? {key: "fcd_" + "e".repeat(48)} : {}; };
      await TCloud.auto();
      return {made, err: TCloud.autoErr || ""};
    }""")
    bad = secrets(rogue_got)
    ok(state["rogue"], "2. the bridge was replaced after it said it is not linked")
    ok("tally_device_create" not in res["made"], "2. no computer key is created without a proof made in the same step (%s)" % res)
    ok(not bad, "2. the rogue got nothing secret (%d requests%s)" % (len(rogue_got), "; BAD: " + str(bad[:2]) if bad else ""))
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
