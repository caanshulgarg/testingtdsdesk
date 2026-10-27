"""python3 run_tally_firstlink.py - the first-time Tally connection, as a brand-new firm meets it (24-Oct-2026,
next-tally-firstlink; the owner: "Tally link is still a big problem when linking first time.. don't know how to get
code.. how to link.. that is main problem now").
A new firm, signed in, no client, no bridge heard by FinCom's cloud; a stub FinCom Bridge 2.4.5 answering on
127.0.0.1:9100 (its /ping proofs are real HMAC-SHA256s, its pairing window and code as bridge-go/server.go has them) and
a stub cloud (TCloud/Cloud):
  1. Clients (no client): "Start with Tally" with Connect Tally, which opens the Tally page at step 1.
  2. Connect Tally › Connect this computer: 1 Download (the one button) · 2 Open it · 3 Type its code; no bridge yet:
     "Waiting for FinCom Bridge on this computer…" and "Not found? What to check" (same computer / Remote Desktop,
     another Windows user, the browser's Allow, the icon near the clock).
  3. The bridge starts: found by itself (nothing secret sent); step 3 shows the tray's exact words and its picture,
     and one big code box.
  4. A wrong code: said plainly, and NOT sent to the bridge (it never spends one of the bridge's five tries).
  5. The pairing window closed: "The code has run out…" with how to get a new one.
  6. Another Windows user's bridge; an older bridge: each its own plain line.
  7. The right code: connects by itself after the 6th digit (no button): /pair once, the key kept, then at once the
     firm's computer key (tally_device_create) handed to the bridge (/cloudlink), "✓ Connected to FinCom Bridge on
     NWS144 (anshul). Linking it to Test Firm… Tally found · 2 companies open."
  8. The cloud hears the bridge: step 1 ticks, step 2 says the companies open, and Companies in Tally lists them with
     Add as client; one click links the first one and the steps give way to the one green line.
  9. Failures: the firm link refused (plain words + Try again, which then works); Tally not answering on this computer
     (F1 (Help) → Settings → Connectivity);
 10. Help & support's Connect (no key yet) opens the code box (it only re-checked before); #pair=123456 in the address
     connects without typing.
 11. No sideways scroll at 1440 and 390; --shots DIR saves each step at both widths.
 12. Migration 104: each state reached is sent once to tally_connect_step (step, version, detail), never the code or a key.
 13. FinCom Bridge 2.4.7 (no proof over the 6-digit code any more): a typed code is checked by SPAKE2 (/pair2, then /pair
     with the page's confirmation; the six digits never leave the page; a wrong code is one online try); FinCom opened
     with #pair=<code>-<secret> pairs with the window's 128-bit secret after the bridge proved it holds it; a secret that
     does not prove itself is not sent, and an address never starts a SPAKE2 run by itself (that would use up a try with
     nobody typing). Older bridges (2.4.6 and before) as in 1-10.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_firstlink.py [--shots DIR]"""
import hashlib, hmac, json, os, re, sys, threading, functools, http.server
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8657
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

VMS, GSC = "VMS EVENTS PRIVATE LIMITED (2024-25)", "GARG SHEKHAR & COMPANY (2025-26)"
CODE, KEY, BID = "482913", "k" * 40, "go-6b1ba45fbb1d"
D1 = "58d73e82-0000-4000-8000-000000000001"
# ---------------------------------------------------------------- the stub FinCom Bridge (bridge-go/server.go's answers)
BR = {}
def bridge_reset(**kw):
    BR.clear(); BR.update({"on": True, "yours": True, "old": False, "window": True, "code": CODE, "tally": True, "open": [VMS, GSC], "log": [], "linked": False, "user": "NW144\\anshul",
        "v": 1, "secret": "5e" * 16, "salt": "a1" * 16, "pending": {}, "runs": 0}); BR.update(kw)
bridge_reset(on=False)
def mac(secret, msg): return hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
# ---- FinCom Bridge 2.4.7's SPAKE2 (bridge-go/pairspake.go), the bridge's side, for the stub
SP_P = int("FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD"
           "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED"
           "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F"
           "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B"
           "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510"
           "15728E5A8AACAA68FFFFFFFFFFFFFFFF", 16)
SP_Q = (SP_P - 1) // 2
def sp_expand(label): return int.from_bytes(b"".join(hashlib.sha256(("%s|%d" % (label, i)).encode()).digest() for i in range(9)), "big")
SP_M = pow(sp_expand("FinCom pair v2 M") % SP_P, 2, SP_P); SP_N = pow(sp_expand("FinCom pair v2 N") % SP_P, 2, SP_P)
def sp_w(code, ctx): return sp_expand("FinCom pair v2 w|" + code + "|" + ctx) % SP_Q
def sp_tt(parts):
    h = hashlib.sha256()
    for x in parts: b = x.encode(); h.update(len(b).to_bytes(8, "big")); h.update(b)
    return h.digest()
def sp_server(Xs, code, ctx):
    if not re.match(r"^[0-9a-f]{512}$", Xs or ""): return None
    X = int(Xs, 16)
    if not (1 < X < SP_P - 1) or pow(X, SP_Q, SP_P) != 1: return None
    w = sp_w(code, ctx); y = int.from_bytes(os.urandom(32), "big") or 1
    Y = pow(2, y, SP_P) * pow(SP_N, w, SP_P) % SP_P
    Z = pow(X * pow(SP_M, SP_Q - w, SP_P) % SP_P, y, SP_P)
    Ys = "%0512x" % Y; k = sp_tt(["FinCom pair v2", ctx, Xs, Ys, "%0512x" % Z, "%0512x" % w])
    return Ys, hmac.new(k, b"bridge", hashlib.sha256).hexdigest(), hmac.new(k, b"page", hashlib.sha256).hexdigest()
def on_bridge(route):
    req = route.request; u = urlparse(req.url); port = u.port; q = parse_qs(u.query); path = u.path
    origin = req.headers.get("origin", "")
    H = {"Access-Control-Allow-Origin": origin or "*", "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin"}
    if port != 9100 or not BR["on"]: return route.abort("connectionrefused")
    if req.method == "OPTIONS": return route.fulfill(status=204, headers=H, body="")
    send = lambda st, o: route.fulfill(status=st, headers=H, content_type="application/json", body=json.dumps(o))
    BR["log"].append((req.method, path, dict((k, v[0]) for k, v in q.items())))
    if path == "/ping":
        if BR["old"]: return send(200, {"ok": True, "bridge": "FinCom Tally Bridge", "version": "1.15.0"})
        p = {"ok": True, "bridge": "FinCom Tally Bridge", "version": "2.4.5", "impl": "go", "yours": BR["yours"]}
        if BR["yours"]:
            p.update({"bridgeId": BID, "port": 9100}); n = q.get("n", [""])[0]
            if n and origin:
                p["proof"] = mac(KEY, n + BID + "9100")
                if BR["window"] and BR["v"] == 2: p.update({"version": "2.4.7", "pairWindow": True, "pairV": 2, "pairSalt": BR["salt"], "pairProofS": mac(BR["secret"], n + BID + "9100")})
                elif BR["window"]: p["pairProof"] = mac(BR["code"], n + BID + "9100")
        return send(200, p)
    if not BR["yours"]: return send(403, {"ok": False, "error": "This FinCom Bridge works for another Windows user.", "notYours": True})
    if path == "/pair2" and BR["v"] == 2:
        if not BR["window"]: return send(403, {"ok": False, "error": "The connect window has closed."})
        Xs = q.get("X", [""])[0]; r = sp_server(Xs, BR["code"], BID + "9100|" + BR["salt"])
        if not r: return send(400, {"ok": False, "error": "That is not a connect request from FinCom."})
        BR["runs"] += 1
        if BR["runs"] > 5: BR["window"] = False; return send(403, {"ok": False, "error": "The connect window has closed."})
        BR["pending"][Xs] = r[2]
        return send(200, {"ok": True, "Y": r[0], "confirm": r[1]})
    if path == "/pair" and BR["v"] == 2 and BR["window"]:
        Xs, cf, code = q.get("X", [""])[0], q.get("confirm", [""])[0], q.get("code", [""])[0]
        good = (Xs and BR["pending"].pop(Xs, None) == cf and cf) or (code and code in (BR["code"], BR["secret"]))
        if good:
            BR["window"] = False
            return send(200, {"ok": True, "key": KEY, "computer": "NWS144", "user": BR["user"], "version": "2.4.7", "bridgeId": BID, "port": 9100})
        return send(403, {"ok": False, "error": "That is not the code shown in the bridge window.", "needCode": True})
    if path == "/pair":
        if BR["window"] and q.get("code", [""])[0] == BR["code"]:
            BR["window"] = False
            return send(200, {"ok": True, "key": KEY, "computer": "NWS144", "user": BR["user"], "version": "2.4.5", "bridgeId": BID, "port": 9100})
        return send(403, {"ok": False, "error": "That is not the code shown in the bridge window.", "needCode": True})
    if req.headers.get("x-bridge-key") != KEY: return send(401, {"ok": False, "error": "Wrong bridge key."})
    if path == "/status":
        ses = [{"port": 9000, "ok": BR["tally"], "mine": True, "companies": [{"name": c} for c in (BR["open"] if BR["tally"] else [])]}]
        return send(200, {"ok": True, "version": "2.4.5", "sessions": ses, "computer": "NWS144", "user": BR["user"], "mode": "auto", "tally": {"state": "open" if BR["tally"] else "closed"}})
    if path == "/diagnose": return send(200, {"ok": True, "findings": [], "tallies": [], "user": BR["user"], "mySession": 1})
    if path == "/cloudlink":
        if req.method == "POST":
            b = json.loads(req.post_data or "{}"); BR["linked"] = bool(re.match(r"^fcd_[0-9a-f]{48}$", b.get("key", ""))); BR["cloudKey"] = b.get("key")
            return send(200, {"ok": True, "connected": True, "firm": "Test Firm", "device": "NWS144 · NW144\\anshul"})
        return send(200, {"ok": True, "connected": BR["linked"], "url": ""})
    return send(200, {"ok": True})
pairs = lambda: [x for x in BR["log"] if x[1] == "/pair"]

def dev(at="ago:0.2", opened=(VMS, GSC), tally="open"):
    bt = {"at": at, "every": 30, "tally": tally == "open", "tallyState": tally, "open": list(opened), "paused": False}
    b = {"at": at, "version": "2.4.5", "computer": "NWS144", "user": "NW144\\anshul", "mode": "main", "runMode": "user", "tally": tally == "open", "tallyState": tally, "open": list(opened)}
    return {"id": D1, "name": "NWS144 · NW144\\anshul", "revoked": False, "last_seen": at, "version": "2.4.5", "main_bridge": BID, "created_at": "2026-10-24T09:53:11Z",
            "info": {"computer": "NWS144", "user": "NW144\\anshul", "beat": bt, "bridges": {BID: b}}}
def cos():
    r = lambda c: {"company": c, "client_id": None, "device_id": D1, "gstin": "", "last_seen": "ago:0.2", "linked_at": None, "linked_by": None}
    return [r(VMS), r(GSC)]
SETUP = """([devs, companies]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  window.__fix = fix; window.__devs = fix(devs); window.__companies = fix(companies); window.__calls = window.__calls || []; window.__failCreate = false;
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path, opt) => {
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_companies/.test(path)) return copy(window.__companies);
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === "tally_device_create") { if (window.__failCreate) throw new Error("not allowed"); return {id: "d-new", key: "fcd_" + "0a".repeat(24)}; }
    if (fn === "tally_company_link") window.__companies.forEach(r => { if (r.company === a.p_company) { r.client_id = a.p_client || null; r.linked_at = new Date().toISOString(); r.linked_by = "u-1"; } });
    if (fn === "tally_status") return [];
    if (fn === "tally_period_status") return {};
    return {ok: true}; };
  Cloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  TCloudUp.post = async (body, who) => { window.__calls.push(["post", JSON.parse(JSON.stringify(body))]); return {ok: true, woken: 1, asked: 1}; };
  window.cloudPushNow = async () => {};
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner", id: "u-1"})});
  TCloud.pane.devices = window.__devs; TCloud.pane.companies = window.__companies; TCloud.pane.at = Date.now(); TCloud.pane.err = ""; TCloud.pane.stops = [];
  TLight.st.at = Date.now(); TLight.st.devs = window.__devs; TLight.st.cos = window.__companies; TLight.st.stops = [];
  TCloud.refreshPane = async () => { TCloud.pane.devices = window.__devs; TCloud.pane.companies = window.__companies; TCloud.pane.at = Date.now(); };
  TLight.refresh = function () { this.st.devs = window.__devs; this.st.cos = window.__companies; this.st.at = Date.now(); return Promise.resolve(); };
  S.tcoSync = {}; document.body.classList.add("is-test"); S.firm.firmName = "Test Firm";
  return true;
}"""
FRESH = "() => { Bridge.setCfg({key: '', bridgeId: '', url: 'http://127.0.0.1:9100'}); Bridge.st = {state: 'off', sessions: [], open: [], at: Date.now(), error: ''}; Bridge.foundAt = 0; window.FCFirstLink && window.FCFirstLink.reset(); TCloud.autoAt = 0; TCloud.autoBusy = false; TCloud.autoErr = ''; return true; }"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def open_page(w, h, path="/"):
            pg = br.new_page(viewport={"width": w, "height": h}); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"setup": {"version": "2.4.5", "url": "https://x/FinComBridge-Setup-2.4.5.exe", "sha256": "ab" * 32}})))
            pg.route(re.compile(r"^http://127\.0\.0\.1:\d+/"), on_bridge)
            pg.goto("http://localhost:%d%s" % (PORT, path)); pg.wait_for_timeout(2500)
            if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            return pg
        pg = open_page(1440, 900)
        E = lambda js, *a: pg.evaluate(js, *a)
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        calls = lambda kind=None: [c for c in E("window.__calls || []") if kind is None or c[0] == kind]
        state = lambda: E("() => (document.querySelector('#app [data-firstlink]') || {}).getAttribute ? document.querySelector('#app [data-firstlink]').getAttribute('data-firstlink') : ''")
        def wait_state(s, ms=15000):
            try: pg.wait_for_function("(s) => { const e = document.querySelector('#app [data-firstlink]'); return !!e && e.getAttribute('data-firstlink') === s; }", arg=s, timeout=ms); return True
            except Exception: return False
        def wide():
            return E("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        def shot(name):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True)
            for w, h in ((1440, 900), (390, 844)):
                pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(350)
                el = pg.locator("#app [data-connect-guide]")
                pg.screenshot(path=os.path.join(SHOTS, "%s-%d.png" % (name, w)), full_page=True)
            pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(200)
        def check_narrow(where):
            pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(400)
            ok(wide() <= 0, "11. no sideways scroll at 390 (%s): %d px" % (where, wide()))
            pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(250)
            ok(wide() <= 0, "11. no sideways scroll at 1440 (%s)" % where)
        def scene(devs, companies):
            E(SETUP, [devs, companies]); pg.wait_for_timeout(200)
        def type_code(c):
            pg.fill("#app [data-fl-code]", ""); pg.locator("#app [data-fl-code]").press_sequentially(c, delay=40)

        # ---- 1. a brand-new firm: no client, no bridge heard
        bridge_reset(on=False); E(FRESH); scene([], [])
        E("() => { navHome('clients'); }"); pg.wait_for_timeout(900)
        ok(pg.locator("#app [data-fl-first]").count() == 1, "1. Clients with no client: 'Start with Tally'")
        ok("Add as client" in txt("#app [data-fl-first]") and pg.locator("#app [data-fl-start]").inner_text().strip() == "Connect Tally", "1. it says what Connect Tally gives, with one Connect Tally button (%s)" % txt("#app [data-fl-first]"))
        shot("01-clients-first-run")
        pg.click("#app [data-fl-start]"); pg.wait_for_timeout(900)
        ok(E("() => S.view === 'tally' || /tally/.test(location.hash)") or pg.locator("#app [data-connect-guide]").count() == 1, "1. Connect Tally opens the Tally page")
        # ---- 2. step 1: Download · Open it · Type its code; waiting
        ok(pg.locator("#app [data-firstlink]").count() == 1, "2. Connect this computer is on the Tally page, under the three steps (not under Help & support)")
        ok(pg.locator("#app [data-firstlink] [data-fl-step=download] [data-bridge-download]").count() == 1, "2. step 1: the one Download button")
        steps = [txt('#app [data-fl-step="%s"] b' % k) for k in ("download", "open", "code")]
        ok(steps == ["Download FinCom Bridge", "Open it and press Next until Finish", "Type its code here"], "2. the three sub-steps in plain words (%s)" % steps)
        ok("Windows protected your PC" in txt("#app [data-fl-step=download]") and "More info" in txt("#app [data-fl-step=download]"), "2. the SmartScreen words, where the download is")
        ok("Just for me" in txt("#app [data-fl-step=open]"), "2. 'Just for me' is right: nothing else to choose")
        ok(wait_state("waiting"), "2. no bridge yet: waiting (%s)" % state())
        ok(txt("#app [data-fl-status]") == "Waiting for FinCom Bridge on this computer…", "2. 'Waiting for FinCom Bridge on this computer…' (%s)" % txt("#app [data-fl-status]"))
        fixes = E("() => [...document.querySelectorAll('#app [data-fl-fix]')].map(x => x.getAttribute('data-fl-fix'))")
        ok(fixes == ["same-pc", "user", "browser", "icon"], "2. Not found? same computer/Remote Desktop, Windows user, the browser's Allow, the icon (%s)" % fixes)
        pg.click("#app [data-fl-help] summary"); pg.wait_for_timeout(200)
        ok("Remote Desktop" in txt("#app [data-fl-help]") and "Allow" in txt("#app [data-fl-help]"), "2. the fixes are plain words")
        ok(pg.locator("#app [data-fl-code]").count() == 0, "2. no code box before the bridge is found")
        ok(pg.locator("#app [data-connect-step=install]:not([data-done])").count() == 1, "2. Connect Tally's step 1 is not done yet")
        shot("02-waiting"); check_narrow("waiting")
        # ---- 6. another Windows user's bridge; an older bridge
        bridge_reset(yours=False)
        ok(wait_state("other"), "6. another Windows user's bridge: its own line (%s)" % state())
        ok("another Windows user" in txt("#app [data-fl-status]") and "Just for me" in txt("#app [data-fl-status]"), "6. '…belongs to another Windows user… Just for me' (%s)" % txt("#app [data-fl-status]"))
        shot("06-other-user")
        bridge_reset(old=True)
        ok(wait_state("old"), "6. an older bridge: its own line (%s)" % state())
        ok("older FinCom Bridge (1.15.0)" in txt("#app [data-fl-status]") and "Download the new one" in txt("#app [data-fl-status]"), "6. 'An older FinCom Bridge (1.15.0)… Download the new one' (%s)" % txt("#app [data-fl-status]"))
        shot("06-older-bridge")
        # ---- 3. the bridge starts: found by itself, nothing secret sent
        bridge_reset()
        ok(wait_state("code"), "3. the bridge starts: found by itself (%s)" % state())
        ok(not pairs() and not any(x[1] != "/ping" for x in BR["log"]), "3. only /ping was asked; nothing secret sent (%s)" % sorted(set(x[1] for x in BR["log"])))
        ok("Found FinCom Bridge 2.4.5 on this computer" in txt("#app [data-fl-status]"), "3. 'Found FinCom Bridge 2.4.5 on this computer. Now type its code.' (%s)" % txt("#app [data-fl-status]"))
        where = txt("#app [data-fl-step=code] .fl-where")
        ok("Right-click the FinCom icon near the clock" in where and "Connect FinCom on this computer…" in where and "six digits" in where, "3. the tray's exact words: right-click the icon › Connect FinCom on this computer… (%s)" % where[:160])
        ok(pg.locator("#app [data-fl-tray] .fl-pick").inner_text().strip() == "Connect FinCom on this computer…", "3. the picture of the icon's menu marks that line")
        fs = E("() => parseFloat(getComputedStyle(document.querySelector('#app [data-fl-code]')).fontSize)")
        ok(fs >= 28, "3. one big code box (%.0f px)" % fs)
        ok(pg.locator("#app [data-firstlink] button:has-text('Connect')").count() == 0, "3. no Connect button: six digits connect by themselves")
        ok(pg.locator("#app [data-fl-step=download][data-done]").count() == 1 and pg.locator("#app [data-fl-step=open][data-done]").count() == 1, "3. Download and Open it ticked")
        shot("03-code"); check_narrow("code")
        # ---- 4. a wrong code: plain words, never sent
        type_code("111111"); pg.wait_for_timeout(1500)
        ok(not pairs(), "4. a wrong code is not sent to the bridge (no /pair): the bridge's five tries are untouched")
        ok("That is not the code in the FinCom Bridge box" in txt("#app [data-fl-code-msg]") and "Nothing was sent" in txt("#app [data-fl-code-msg]"), "4. 'That is not the code in the FinCom Bridge box. Nothing was sent…' (%s)" % txt("#app [data-fl-code-msg]"))
        ok(E("() => Bridge.cfg().key") == "", "4. no key kept")
        shot("04-wrong-code")
        # ---- 5. the code ran out (the window closed)
        BR["window"] = False; pg.wait_for_timeout(5600)
        type_code(CODE); pg.wait_for_timeout(1500)
        ok(not pairs() and "The code has run out" in txt("#app [data-fl-code-msg]") and "Connect FinCom on this computer… again" in txt("#app [data-fl-code-msg]"), "5. the window closed: 'The code has run out… again' (%s)" % txt("#app [data-fl-code-msg]"))
        shot("05-code-ran-out")
        # ---- 7. the right code: connects by itself, then the firm link at once
        BR["window"] = True; BR["code"] = "905117"; pg.wait_for_timeout(5600)
        type_code("905117")
        ok(wait_state("linking", 8000), "7. six digits: connected with no button (%s)" % state())
        ok(len(pairs()) == 1 and pairs()[0][2].get("code") == "905117", "7. /pair once, with the code (%s)" % pairs())
        ok(E("() => Bridge.cfg().key") == KEY, "7. the bridge's key is kept in this browser")
        pg.wait_for_timeout(2500)
        ok(any(c[0] == "tally_device_create" for c in calls()), "7. the firm's computer key made at once (tally_device_create), not after a minute")
        ok(BR.get("linked") and BR.get("cloudKey", "").startswith("fcd_"), "7. and handed to the bridge (/cloudlink)")
        st = txt("#app [data-fl-status]")
        ok(st.startswith("✓ Connected to FinCom Bridge on NWS144 (anshul). Linking it to Test Firm…"), "7. '✓ Connected to FinCom Bridge on NWS144 (anshul). Linking it to Test Firm…' (%s)" % st)
        ok("Tally found · 2 companies open." in st, "7. '… Tally found · 2 companies open.' (%s)" % st)
        ok(pg.locator("#app [data-fl-step=code][data-done]").count() == 1, "7. Type its code ticked")
        shot("07-linking")
        # ---- 8. the cloud hears it: step 1 ticks, the companies, Add as client
        E("([d, c]) => { window.__devs = window.__fix(d); window.__companies = window.__fix(c); }", [[dev()], cos()])
        try: pg.wait_for_selector("#app [data-connect-step=install][data-done]", timeout=12000); heard = True
        except Exception: heard = False
        ok(heard, "8. the cloud hears the bridge: step 1 ticks by itself")
        ok(pg.locator("#app [data-firstlink]").count() == 0, "8. Connect this computer gives way")
        ok(pg.locator("#app [data-connect-step=open][data-done]").count() == 1 and "2 companies open in Tally on NWS144" in txt("#app [data-connect-step=open]"), "8. step 2: '2 companies open in Tally on NWS144.' (%s)" % txt("#app [data-connect-step=open]"))
        rows = E("() => [...document.querySelectorAll('#app [data-tco-list=firm] [data-tco-row]')].map(r => [r.getAttribute('data-tco-row'), (r.querySelector('[data-tco-act]') || {}).innerText || ''])")
        ok(sorted(r[0] for r in rows) == sorted([VMS, GSC]) and all(r[1] == "Add as client" for r in rows), "8. Companies in Tally: both, each with Add as client (%s)" % rows)
        shot("08-companies")
        pg.click('#app [data-tco-row="%s"] [data-tco-act]' % VMS); pg.wait_for_timeout(1500)
        ok(any(c[0] == "tally_company_link" and c[1].get("p_company") == VMS for c in calls()), "8. Add as client: linked in one click (tally_company_link)")
        try: pg.wait_for_selector("#app [data-connect-guide=done]", timeout=8000); done = True
        except Exception: done = False
        ok(done and pg.locator("#app [data-connect-guide=open], #app section[data-connect-guide]").count() == 0, "8. the three steps give way to 'Connected computers: NWS144 ● online'")
        shot("08-first-link-done")
        # ---- 9. failures: the firm link refused; Tally not answering
        bridge_reset(); E(FRESH); scene([], []); E("() => { window.__failCreate = true; openConnectTally(1, ''); }")
        ok(wait_state("code"), "9. (again, a new computer) found")
        type_code(CODE)
        ok(wait_state("error", 10000), "9. the firm link refused: said (%s)" % state())
        ok("linking it to Test Firm did not work: not allowed" in txt("#app [data-fl-status]"), "9. 'Connected to the bridge, but linking it to Test Firm did not work: not allowed.' (%s)" % txt("#app [data-fl-status]"))
        ok(pg.locator("#app [data-fl-retry]").count() == 1, "9. with Try again")
        shot("09-link-refused")
        E("() => { window.__failCreate = false; }"); BR["linked"] = False
        pg.click("#app [data-fl-retry]")
        wait_state("linking", 8000)
        for _ in range(20):
            if BR.get("linked"): break
            pg.wait_for_timeout(250)
        ok(state() == "linking" and BR.get("linked"), "9. Try again: linked (%s)" % state())
        BR["tally"] = False
        E("([d]) => { window.__devs = window.__fix(d); window.__companies = []; }", [[dev(opened=(), tally="closed")]]); E("() => Bridge.refresh().then(() => render())"); pg.wait_for_timeout(1500)
        try: pg.wait_for_selector("#app [data-connect-step=install][data-done]", timeout=12000)
        except Exception: pass
        pg.wait_for_timeout(600)
        lt = txt("#app [data-fl-local]")
        ok("Tally is not answering" in lt and "F1 (Help) → Settings → Connectivity" in lt and "Both" in lt, "9. Tally not answering on this computer: F1 (Help) → Settings → Connectivity, Both (%s)" % lt)
        ok("Open TallyPrime" in txt("#app [data-connect-step=open]"), "9. step 2 says to open TallyPrime")
        shot("09-tally-not-open"); check_narrow("tally not open")
        # ---- 12. migration 104: each state once per change to tally_connect_step; never the code or a key
        st = [c[1] for c in calls("tally_connect_step")]
        seq = [x.get("p_step") for x in st]
        ok(all(k in seq for k in ("waiting", "other_user", "old_bridge", "found", "wrong_code", "code_ran_out", "paired", "linked", "link_failed")), "12. every state logged (%s)" % seq)
        ok(all(seq[i] != seq[i + 1] or seq[i] == "wrong_code" for i in range(len(seq) - 1)), "12. once per change, not at every look (%s)" % seq)
        raw = json.dumps(st)
        ok(CODE not in raw and "905117" not in raw and KEY not in raw and "fcd_" not in raw, "12. never the code or a key")
        ok(all(set(x) == {"p_step", "p_version", "p_detail"} for x in st) and any(x.get("p_version") == "2.4.5" for x in st), "12. step, the bridge's version, a short detail")
        # ---- 10. Help & support's Connect opens the code box; #pair= connects without typing
        E(FRESH); bridge_reset(); scene([dev()], cos()); E("() => { S.tallyGuide = {}; navHome('tally'); }"); pg.wait_for_timeout(800)
        if pg.locator("#app [data-bridge-details]").count(): pg.click("#app [data-bridge-details]"); pg.wait_for_timeout(500)
        b = pg.locator("#app [data-connect-section] .row button.primary")
        ok(b.count() == 1 and b.inner_text().strip() == "Connect", "10. Help & support › This computer: Connect")
        if b.count():
            b.click(); pg.wait_for_timeout(600)
            ok(pg.locator("#bridgeCode").is_visible(), "10. it opens the code box (it only re-checked with no key before)")
            pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
            if pg.locator('#confirmBox [data-cbx="no"]').is_visible(): pg.click('#confirmBox [data-cbx="no"]')
        pg2 = open_page(1440, 900, "/#pair=" + CODE)
        pg2.wait_for_timeout(2500)
        ok(any(x[1] == "/pair" and x[2].get("code") == CODE for x in BR["log"]), "10. #pair=… in the address: connected without typing")
        ok("pair=" not in pg2.evaluate("() => location.hash"), "10. the code is taken off the address at once")
        pg2.close()

        # ---- 13. FinCom Bridge 2.4.7: a typed code by SPAKE2; the address's secret
        E(FRESH); bridge_reset(v=2, code="314159"); scene([], []); E("() => { S.tallyGuide = {}; navHome('tally'); }"); pg.wait_for_timeout(800)
        ok(wait_state("code"), "13. a 2.4.7 bridge (no pairProof) found with its window open (%s)" % state())
        type_code("271828"); pg.wait_for_timeout(3000)
        runs = [x for x in BR["log"] if x[1] == "/pair2"]
        ok(len(runs) == 1 and not pairs(), "13. a wrong code: one SPAKE2 run (one online try), no /pair (%s)" % [x[1] for x in BR["log"] if x[1] != "/ping"])
        ok("That is not the code in the FinCom Bridge box" in txt("#app [data-fl-code-msg]") and E("() => Bridge.cfg().key") == "", "13. a wrong code: said plainly, no key kept (%s)" % txt("#app [data-fl-code-msg]"))
        type_code("314159")
        ok(wait_state("linking", 15000), "13. the right code: connected by itself (%s)" % state())
        fin = [x for x in BR["log"] if x[1] == "/pair"]
        ok(len(fin) == 1 and fin[0][2].get("X") and len(fin[0][2].get("confirm", "")) == 64 and not fin[0][2].get("code"), "13. finished with the page's confirmation, no code sent (%s)" % [sorted(x[2]) for x in fin])
        ok(E("() => Bridge.cfg().key") == KEY, "13. the bridge's key kept")
        ok(not any("314159" in json.dumps(x[2]) or "271828" in json.dumps(x[2]) for x in BR["log"]), "13. the six digits never left the page")
        # ---- 14. 2.4.7: FinCom opened with #pair=<code>-<secret>
        bridge_reset(v=2, code="161803")
        pg3 = open_page(1440, 900, "/#pair=161803-" + BR["secret"]); pg3.wait_for_timeout(3000)
        fin = [x for x in BR["log"] if x[1] == "/pair"]
        ok(len(fin) == 1 and fin[0][2].get("code") == BR["secret"], "14. #pair=<code>-<secret>: paired with the window's secret (%s)" % [x[2] for x in fin])
        ok("pair=" not in pg3.evaluate("() => location.hash") and pg3.evaluate("() => Bridge.cfg().key") == KEY, "14. taken off the address at once; the key kept")
        pg3.close()
        # ---- 15. a secret the bridge does not prove (an old or made-up address): nothing sent, no try used
        bridge_reset(v=2, code="161803")
        pg4 = open_page(1440, 900, "/#pair=161803-" + "6f" * 16); pg4.wait_for_timeout(4000)
        ok(not any(x[1] == "/pair" and x[2].get("code") for x in BR["log"]), "15. a secret that does not prove itself is not sent (%s)" % [x[2] for x in BR["log"] if x[1] == "/pair"])
        ok(not any(x[1] == "/pair2" for x in BR["log"]) and pg4.evaluate("() => Bridge.cfg().key") == "", "15. no SPAKE2 run by itself (none of the bridge's tries used), no key")
        t4 = re.sub(r"\s+", " ", pg4.inner_text("body"))
        ok("This link from FinCom Bridge has run out" in t4, "15. it says the link ran out and how to get a new one")
        pg4.close()

        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
