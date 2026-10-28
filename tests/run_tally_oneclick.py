"""python3 run_tally_oneclick.py - Tally on this computer: Connect this computer · Find Tally · Get companies (28-Oct-2026,
next-tally-oneclick; the owner: "Tally is not working at all … sometimes code screen, nothing goes green, nothing shows
afterwards … There should be a simple click to connect and get the company").
The case on staging that day: the firm the bridge on NWS144 was connected to was deleted; its computer key was refused by
tally-ingest (401) on every beat, and nothing on FinCom's side ever made a new key (the bridge says connected:true because
it holds a key; the cloud's tally_bridge_whose says neither mine nor elsewhere). A stub FinCom Bridge on 127.0.0.1:9100
(its /ping proofs real HMAC-SHA256s, /status with its beat, /diagnose, /cloudlink, /pair) and a stub cloud:
  1. a refused key, seen on opening the page (no Tally request): said plainly, with Connect this computer
  2. Connect this computer: ONE tally_device_create, the key handed over (POST /cloudlink, the ingest address), green
     "Connected: NWS144 (anshul) sends Tally to Test Firm. Its old key … was replaced." at once; then Find Tally and Get
     companies run by themselves: the Tally on port 9000 with its companies; each company Link to <client> / Create client
  3. Create client from this company: the client made and linked (tally_company_link); Link to <client>: linked
  4. already connected (the cloud's mine, a fresh beat): "Connected" and no new key
  5. Find Tally with no Tally: "Open TallyPrime and a company, then press Find Tally again", a port to type, Use this port
     (the page's Tally pin), its own answer for that port; "Find it by itself again"
  6. this browser not connected to the bridge: the tray's words (FinCom opens and connects by itself) or the code; the code
     typed connects and the firm's key follows at once, ONE key (the code box's link and the card share it)
  7. no bridge: "FinCom Bridge is not running on this computer" with the Download button; another Windows user's: its line
  8. a bridge that does not answer: a plain reason within the limit, never a spinner for ever
  9. TCloud.auto (opening FinCom, nothing pressed): a refused key is replaced by itself (lib/bridgeFollow.js)
 10. the connect panel's scan keeps the bridge it found for one scan the bridge missed (the code box stays)
 11. no sideways scroll at 1440 and 390; --shots DIR saves the steps at both widths
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_oneclick.py [--shots DIR]"""
import hashlib, hmac, json, os, re, sys, threading, functools, http.server, time
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8661
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

VMS, GSC = "VMS EVENTS PRIVATE LIMITED (2024-25)", "GARG SHEKHAR & COMPANY (2025-26)"
CODE, KEY, BID = "482913", "k" * 40, "go-6b1ba45fbb1d"
OLDKEY = "fcd_" + "ee" * 24
BR, INGEST = {}, ["https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1/tally-ingest"]
def bridge_reset(**kw):
    BR.clear(); BR.update({"on": True, "yours": True, "window": False, "tally": True, "open": [VMS, GSC], "log": [], "cloudKey": OLDKEY, "url": INGEST[0],
        "beat": {"on": True, "last": "", "missedSince": "2026-10-28T10:00:00", "every": 30}, "hang": "", "user": "NW144\\anshul"}); BR.update(kw)
def mac(secret, msg): return hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
def on_bridge(route):
    req = route.request; u = urlparse(req.url); port = u.port; q = parse_qs(u.query); path = u.path
    origin = req.headers.get("origin", "")
    H = {"Access-Control-Allow-Origin": origin or "*", "Access-Control-Allow-Headers": "Content-Type, X-Bridge-Key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin"}
    if port != 9100 or not BR["on"]: return route.abort("connectionrefused")
    if req.method == "OPTIONS": return route.fulfill(status=204, headers=H, body="")
    if BR["hang"] and BR["hang"] == path: return  # never answered (the page's limit says why)
    send = lambda st, o: route.fulfill(status=st, headers=H, content_type="application/json", body=json.dumps(o))
    BR["log"].append((req.method, path, req.post_data or ""))
    if path == "/ping":
        p = {"ok": True, "bridge": "FinCom Tally Bridge", "version": "2.4.7", "impl": "go", "yours": BR["yours"]}
        if BR["yours"]:
            p.update({"bridgeId": BID, "port": 9100}); n = q.get("n", [""])[0]
            if n and origin:
                p["proof"] = mac(KEY, n + BID + "9100")
                if BR["window"]: p["pairProof"] = mac(CODE, n + BID + "9100")
        return send(200, p)
    if not BR["yours"]: return send(403, {"ok": False, "error": "not your FinCom Bridge", "notYours": True})
    if path == "/pair":
        if BR["window"] and q.get("code", [""])[0] == CODE:
            BR["window"] = False
            return send(200, {"ok": True, "key": KEY, "computer": "NWS144", "user": BR["user"], "version": "2.4.7", "bridgeId": BID, "port": 9100})
        return send(403, {"ok": False, "error": "That is not the code shown in the bridge window.", "needCode": True})
    if req.headers.get("x-bridge-key") != KEY: return send(401, {"ok": False, "error": "Wrong bridge key."})
    if path == "/status":
        ses = [{"port": 9000, "ok": BR["tally"], "mine": True, "companies": [{"name": c} for c in (BR["open"] if BR["tally"] else [])], "error": "" if BR["tally"] else "Tally is not open (nothing listens on this port)"},
               {"port": 9001, "ok": True, "mine": False, "skipped": True, "user": "ravi", "companies": []}]
        return send(200, {"ok": True, "version": "2.4.7", "sessions": ses, "computer": "NWS144", "user": BR["user"], "mode": "auto", "tally": {"state": "open" if BR["tally"] else "closed"}, "beat": BR["beat"]})
    if path == "/diagnose": return send(200, {"ok": True, "findings": [{"level": "bad", "text": "Your TallyPrime is not running.", "fix": "Open TallyPrime."}], "tallies": [], "user": BR["user"], "mySession": 1})
    if path == "/cloudlink":
        if req.method == "POST":
            b = json.loads(req.post_data or "{}")
            if not re.match(r"^fcd_[0-9a-f]{48}$", b.get("key", "")): return send(400, {"ok": False, "error": "That is not a FinCom computer key."})
            BR["cloudKey"], BR["url"] = b["key"], b.get("url", "")
            BR["beat"] = {"on": True, "last": "", "missedSince": "", "every": 30}
            return send(200, {"ok": True, "connected": True, "firm": "Test Firm", "device": "NWS144 · NW144\\anshul"})
        return send(200, {"ok": True, "connected": bool(BR["cloudKey"]), "url": BR["url"]})
    if path == "/ledgers/refresh":
        # bridge-go events.go wakeLedgers: a company never kept on this computer is not read
        if not BR.get("kept"): return send(200, {"ok": True, "started": False, "why": "this company is not kept in step on this computer"})
        return send(200, {"ok": True, "started": True})
    if path == "/keep" and req.method == "POST":
        b = json.loads(req.post_data or "{}")
        if b.get("now"): BR["kept"] = True
        return send(200, {"ok": True, "on": True, "running": True})
    return send(200, {"ok": True})
posts = lambda: [x for x in BR["log"] if x[0] == "POST" and x[1] == "/cloudlink"]

# another computer of the firm (LAPTOP), heard now: the guide's step 1 is done, so its connect panel is not drawn
OTHER = {"id": "d-lap", "name": "LAPTOP · ravi", "revoked": False, "version": "2.4.7", "main_bridge": "go-0000aaaa1111", "created_at": "2026-10-28T09:00:00Z",
         "info": {"computer": "LAPTOP", "user": "ravi", "beat": {"every": 30, "tally": False, "tallyState": "closed", "open": []}, "bridges": {"go-0000aaaa1111": {"version": "2.4.7", "computer": "LAPTOP", "user": "ravi", "mode": "main", "runMode": "user", "tally": False, "tallyState": "closed", "open": []}}}}
SETUP = """([whose, devs]) => {
  const now = new Date().toISOString(); (devs || []).forEach(d => { d.last_seen = now; d.info.beat.at = now; Object.values(d.info.bridges).forEach(b => { b.at = now; }); });
  window.__calls = []; window.__whose = whose; window.__devs = devs || []; window.__companies = []; window.__rekeyed = false;
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true; TCloud.me = () => "u-1";
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => { if (/^tally_devices/.test(path)) return copy(window.__devs); if (/^tally_companies/.test(path)) return copy(window.__companies); return []; };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, copy(a || {})]);
    if (fn === "tally_bridge_whose") { if (window.__whose === "throw") throw new Error("no such function"); return window.__rekeyed ? {may: true, mine: true, elsewhere: false, busy: false} : copy(window.__whose); }
    if (fn === "tally_device_create") return (window.__rekeyed = true) && {id: "d-new-" + window.__calls.length, key: "fcd_" + "0a".repeat(24)};
    if (fn === "tally_company_link") return {ok: true};
    if (fn === "tally_status") return copy(window.__books || []);
    if (fn === "tally_period_status") return window.__lp ? {ledger: copy(window.__lp)} : {};
    return {ok: true}; };
  window.tallyLinkClient = async (company, cid) => { window.__calls.push(["link", {company, cid}]); return true; };
  window.cloudPushNow = async () => {}; window.firstSync = () => {};
  // next-tally-linknow: tally-ingest's link_now (registers the company for the bridge's device and links it), or its refusal
  window.__linkNowFail = ""; window.__linkNowHang = false;
  TCloudUp.post = async (body, who) => { window.__calls.push(["post", copy(body)]);
    if (body.kind !== "link_now") return {ok: true};
    if (window.__linkNowHang) return new Promise(() => {});
    if (window.__linkNowFail) throw new Error(window.__linkNowFail);
    return {ok: true, linked: true, company: body.company, client: body.client, device: "d-nws", registered: true}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner", id: "u-1"})});
  TCloud.pane.devices = window.__devs; TCloud.pane.companies = window.__companies; TCloud.pane.at = Date.now(); TCloud.pane.err = ""; TCloud.pane.stops = [];
  TLight.st.at = Date.now(); TLight.st.devs = window.__devs; TLight.st.cos = window.__companies; TLight.st.stops = [];
  TCloud.refreshPane = async () => { TCloud.pane.devices = window.__devs; TCloud.pane.companies = window.__companies; TCloud.pane.at = Date.now(); };
  TLight.refresh = function () { this.st.at = Date.now(); return Promise.resolve(); };
  S.firm.firmName = "Test Firm"; document.body.classList.add("is-test");
  return true;
}"""
PAIRED = "() => { Bridge.setCfg({key: '" + KEY + "', bridgeId: '" + BID + "', url: 'http://127.0.0.1:9100', port: 0}); Bridge.st = {state: 'off', sessions: [], open: [], at: 0, error: ''}; window.FCOneClick && window.FCOneClick.reset(); window.FCFirstLink && window.FCFirstLink.reset(); TCloud.autoAt = Date.now() + 3600e3; TCloud.rekeyed = null; return true; }"
UNPAIRED = PAIRED.replace("key: '" + KEY + "'", "key: ''")
DEAD = {"may": True, "mine": False, "elsewhere": False, "busy": False}
MINE = {"may": True, "mine": True, "elsewhere": False, "busy": False}

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"setup": {"version": "2.4.7", "url": "https://x/FinComBridge-Setup-2.4.7.exe", "sha256": "ab" * 32}})))
        pg.route(re.compile(r"^http://127\.0\.0\.1:\d+/"), on_bridge)
        bridge_reset(on=False)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => doAct('useOffline')"); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        INGEST[0] = E("() => TCloud.ingestUrl()")
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        calls = lambda kind=None: [c for c in E("window.__calls || []") if kind is None or c[0] == kind]
        def wait(js, ms=15000):
            try: pg.wait_for_function(js, timeout=ms); return True
            except Exception: return False
        def wide(): return E("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        def shot(name):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True)
            for w, h in ((1440, 900), (390, 844)):
                pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(350)
                pg.locator("#app [data-oneclick]").screenshot(path=os.path.join(SHOTS, "%s-%s.png" % (name, "desktop" if w > 800 else "phone")))
            pg.set_viewport_size({"width": 1440, "height": 900})
        def open_tally(whose, pair=PAIRED, devs=None):
            E(SETUP, [whose, devs if devs is not None else [OTHER]]); E(pair); E("() => { navHome('tally'); }"); pg.wait_for_timeout(900)

        # 1. a refused key seen on opening the page
        bridge_reset()
        open_tally(DEAD)
        ok(wait("() => !!document.querySelector('#app [data-oc-refused]')"), "1. a refused key is said on opening the page")
        ok("does not accept any more" in txt("#app [data-oc-refused]") and "Connect this computer" in txt("#app [data-oc-refused]"), "1. in plain words, with the button's name (%s)" % txt("#app [data-oc-refused]")[:120])
        ok(not any(x[1] == "/status" and "fresh" in x[2] for x in BR["log"]) and not posts() and not calls("tally_device_create"), "1. nothing changed and Tally not asked by the look")
        shot("1-refused")
        # 1b. with no computer heard yet, the connect panel (this browser connected to the bridge) heals it by itself
        bridge_reset(); open_tally(DEAD, devs=[])
        ok(wait("() => window.__calls.some(c => c[0] === 'tally_device_create')"), "1b. no computer heard yet: the page replaces the refused key by itself")
        pg.wait_for_timeout(1200)
        ok(len(calls("tally_device_create")) == 1 and len(posts()) == 1, "1b. one key (%d, %d)" % (len(calls("tally_device_create")), len(posts())))
        bridge_reset(); open_tally(DEAD)
        wait("() => !!document.querySelector('#app [data-oc-refused]')")
        # 2. Connect this computer
        pg.click("#app [data-oc-connect]")
        ok(wait("() => { const e = document.querySelector('#app [data-oc-say=connect]'); return !!e && e.getAttribute('data-oc-st') === 'ok'; }"), "2. Connected (green) at once")
        say = txt("#app [data-oc-say=connect]")
        ok(say.startswith("✓ Connected: NWS144 (anshul) sends Tally to Test Firm") and "old key" in say, "2. its words (%s)" % say)
        ok(len(calls("tally_device_create")) == 1 and len(posts()) == 1, "2. one key made, handed over once (%d, %d)" % (len(calls("tally_device_create")), len(posts())))
        ok(BR["cloudKey"] == "fcd_" + "0a" * 24 and BR["url"].endswith("/functions/v1/tally-ingest"), "2. the bridge holds the new key and FinCom's ingest address")
        ok(pg.locator("#app [data-oc-refused]").count() == 0, "2. the refused line gives way")
        ok(wait("() => !!document.querySelector('#app [data-oc-cos]')"), "2. Find Tally and Get companies ran by themselves")
        ok("Port 9000" in txt("#app [data-oc-tallies]") and "another Windows user" in txt("#app [data-oc-tally='9001']"), "2. each Tally with its port and whose (%s)" % txt("#app [data-oc-tallies]"))
        ok(pg.locator("#app [data-oc-cos] [data-oc-co]").count() == 2 and pg.locator("#app [data-oc-cos] [data-oc-add]").count() == 2, "2. each company with Create client from this company")
        ok(wide() <= 0, "11. no sideways scroll at 1440")
        shot("2-connected")
        # 3. Create client / Link to <client>
        n0 = E("() => Object.keys(S.companies).length")
        pg.locator("#app [data-oc-co='%s'] [data-oc-add]" % GSC).click()
        ok(wait("() => window.__calls.some(c => c[0] === 'link')"), "3. Create client: linked")
        ok(E("() => Object.keys(S.companies).length") == n0 + 1, "3. the client made")
        E("() => { const co = newCompany({name: 'VMS Events Private Limited', gstin: '', tallyName: ''}); S.companies[co.id] = co; render(); return co.id; }"); pg.wait_for_timeout(400)
        lk = pg.locator("#app [data-oc-co='%s'] [data-oc-link]" % VMS)
        ok(lk.count() == 1 and lk.inner_text().strip() == "Link to VMS Events Private Limited", "3. a client of the same name: Link to <client> (%s)" % (lk.inner_text() if lk.count() else ""))
        # 3b. next-tally-linknow (staging 28-Oct-2026: "no computer has reported Salesify Marketing LLP 2026-27 yet" five times):
        # a company Get companies listed that FinCom's cloud has no row for is registered and linked in the same click
        lnow = lambda: [c[1] for c in calls("post") if c[1].get("kind") == "link_now"]
        ok(len(lnow()) == 1 and lnow()[0]["company"] == GSC and lnow()[0]["bridge"] == BID and lnow()[0]["client"], "3b. Create client on a company not in the cloud: link_now with the company, the new client and this browser's bridge (%s)" % lnow())
        ok(E("() => { const c = window.__calls; const a = c.findIndex(x => x[0] === 'post' && x[1].kind === 'link_now'), b = c.findIndex(x => x[0] === 'link'); return a >= 0 && b > a; }"), "3b. sent to FinCom first, then the usual link")
        ok(wait("() => !!document.querySelector(\"#app [data-oc-co='%s'] [data-oc-linked]\")" % GSC.replace("'", "\\'"), 5000), "3b. the row says Linked at once, no reload (%s)" % txt("#app [data-oc-co='%s']" % GSC))
        # a refusal (the bridge's computer not of this firm): the plain reason, never "done by itself within a minute"
        E("() => { window.__linkNowFail = 'FinCom Bridge on this computer is not connected to your firm yet, so FinCom cannot take it from it. Press Connect this computer, then Link again.'; window.__calls = []; }")
        lk.click()
        ok(wait("() => !!document.querySelector(\"#app [data-oc-co='%s'] [data-oc-act-fail]\")" % VMS), "3b. refused: said on the row")
        f = txt("#app [data-oc-co='%s'] [data-oc-act-fail]" % VMS)
        ok(f.startswith("Not linked: FinCom Bridge on this computer is not connected to your firm yet") and "within a minute" not in f and "by itself" not in f, "3b. its plain reason (%s)" % f)
        ok(not calls("link"), "3b. nothing linked after a refusal")
        # the cloud slow: a reason within the limit, never a spinner
        E("() => { window.__linkNowFail = ''; window.__linkNowHang = true; window.__ocMsScale = 0.05; window.__calls = []; }")
        t0 = time.time(); lk.click()
        ok(wait("() => /did not answer in time/.test((document.querySelector(\"#app [data-oc-co='%s'] [data-oc-act-fail]\") || {}).textContent || '') && !window.__calls.some(c => c[0] === 'link')" % VMS, 10000) and time.time() - t0 < 10, "3b. no answer: the reason within the limit (%s)" % txt("#app [data-oc-co='%s'] [data-oc-act-fail]" % VMS))
        E("() => { window.__linkNowHang = false; window.__ocMsScale = 1; window.__calls = []; }")
        lk.click()
        ok(wait("() => window.__calls.some(c => c[0] === 'link')") and wait("() => !!document.querySelector(\"#app [data-oc-co='%s'] [data-oc-linked]\")" % VMS, 5000), "3b. Link to <client> again: linked, the row says so (%s)" % txt("#app [data-oc-co='%s']" % VMS))
        # 12. next-tally-linknow (Task C; staging: "FinCom Bridge did not read Salesify Marketing LLP 2026-27's ledgers: this
        # company is not kept in step on this computer"): linked, the ledgers are taken by themselves: the bridge here starts
        # keeping the company (POST /keep {now, company}, Update now's request), and the bar shows the count as it comes
        bridge_reset(kept=False, cloudKey="fcd_" + "0a" * 24, beat={"on": True, "last": time.strftime("%Y-%m-%dT%H:%M:%S"), "missedSince": "", "every": 30})
        open_tally(MINE)
        cid = E("() => { Object.keys(S.companies).forEach(k => { if (/^VMS Events/i.test(S.companies[k].name)) delete S.companies[k]; }); const co = newCompany({name: 'VMS Events Private Limited', gstin: '', tallyName: %s}); S.companies[co.id] = co; S.data[co.id] = {parties: {}, entries: {}, loaded: true}; co.stats = {}; window.__books = [{book: 'bk-vms', company: %s, from: '2026-04-01', to: '2026-10-28', days: 0, ledgersAt: ''}]; window.__lp = null; render(); return co.id; }" % (json.dumps(VMS), json.dumps(VMS)))
        pg.click("#app [data-oc-get]")
        wait("() => !!document.querySelector(\"#app [data-oc-co='%s'] [data-oc-link]\")" % VMS)
        pg.locator("#app [data-oc-co='%s'] [data-oc-link]" % VMS).click()
        ok(wait("() => window.__calls.some(c => c[0] === 'link')"), "12. linked")
        for _ in range(40):
            if any(x[0] == "POST" and x[1] == "/keep" for x in BR["log"]): break
            pg.wait_for_timeout(250)
        kp = [json.loads(x[2] or "{}") for x in BR["log"] if x[0] == "POST" and x[1] == "/keep"]
        ok(any(x[1] == "/ledgers/refresh" for x in BR["log"]) and kp and kp[0].get("now") is True and kp[0].get("company") == VMS, "12. not kept here yet: the bridge is asked to keep it now (%s)" % kp)
        ok(E("() => !document.querySelector('#app [data-tco-sync=stuck]')"), "12. no 'did not read … not kept in step' (%s)" % txt("#app [data-tco-sync=stuck]"))
        E("() => { window.__lp = {round: 'r1', read: 312, of: 0, at: new Date().toISOString(), done: false}; }")
        ok(wait("() => /Reading ledgers from Tally… 312 so far/.test((document.querySelector('#app [data-tco-sync=running]') || {}).textContent || '')", 20000), "12. the count as it comes (%s)" % txt("#app [data-tco-sync]"))
        E("() => { window.__lp = {round: 'r1', read: 1240, of: 1240, at: new Date().toISOString(), done: true}; }")
        ok(wait("() => /1,240 ledgers from Tally ✓/.test((document.querySelector('#app [data-tco-sync=done]') || {}).textContent || '')", 20000), "12. done: the ledgers in FinCom (%s)" % txt("#app [data-tco-sync]"))
        shot("12-ledgers")
        # 4. already connected
        bridge_reset(cloudKey="fcd_" + "0a" * 24, beat={"on": True, "last": time.strftime("%Y-%m-%dT%H:%M:%S"), "missedSince": "", "every": 30})
        open_tally(MINE)
        pg.click("#app [data-oc-connect]")
        ok(wait("() => { const e = document.querySelector('#app [data-oc-say=connect]'); return !!e && e.getAttribute('data-oc-st') === 'ok'; }"), "4. already connected: Connected")
        ok(not calls("tally_device_create") and not posts(), "4. no new key")
        ok(pg.locator("#app [data-oc-refused]").count() == 0, "4. nothing refused said")
        # 5. Find Tally, none; a port typed
        bridge_reset(tally=False, cloudKey="fcd_" + "0a" * 24, beat={"on": True, "last": time.strftime("%Y-%m-%dT%H:%M:%S"), "missedSince": "", "every": 30})
        open_tally(MINE)
        pg.click("#app [data-oc-find]")
        ok(wait("() => !!document.querySelector('#app [data-oc-none]')"), "5. no Tally: the one line")
        ok(txt("#app [data-oc-none]") == "Open TallyPrime and a company, then press Find Tally again.", "5. its words (%s)" % txt("#app [data-oc-none]"))
        ok(pg.locator("#app [data-oc-port-in]").count() == 1 and "Open TallyPrime" in txt("#app [data-oc-fix]"), "5. a port to type, and the bridge's own finding")
        shot("5-no-tally")
        pg.fill("#app [data-oc-port-in]", "9123"); pg.click("#app [data-oc-port-use]")
        ok(wait("() => Bridge.cfg().port === 9123"), "5. Use this port: the page's Tally pin")
        ok(wait("() => /port 9123/.test((document.querySelector('#app [data-oc-say=find]') || {}).textContent || '')"), "5. its answer for that port (%s)" % txt("#app [data-oc-say=find]"))
        pg.click("#app [data-oc-port-auto]")
        ok(wait("() => !Bridge.cfg().port"), "5. Find it by itself again: the pin off")
        BR["tally"] = True
        pg.click("#app [data-oc-find]")
        ok(wait("() => { const e = document.querySelector('#app [data-oc-say=find]'); return !!e && e.getAttribute('data-oc-st') === 'found'; }"), "5. Tally opened: found")
        ok("TallyPrime on port 9000: 2 companies open" in txt("#app [data-oc-say=find]"), "5. found in words (%s)" % txt("#app [data-oc-say=find]"))
        # 6. this browser not connected to the bridge: tray or code; the code connects and the firm key follows, one key
        bridge_reset(window=True)
        open_tally(DEAD, UNPAIRED)
        pg.click("#app [data-oc-connect]")
        ok(wait("() => { const e = document.querySelector('#app [data-oc-say=connect]'); return !!e && e.getAttribute('data-oc-st') === 'code'; }"), "6. not connected here yet: the code")
        ok("Connect FinCom on this computer…" in txt("#app [data-oc-say=connect]") and "connects by itself" in txt("#app [data-oc-say=connect]"), "6. the tray's words (%s)" % txt("#app [data-oc-say=connect]")[:140])
        codes = pg.locator("#app [data-fl-code]").count()
        ok(codes == 1, "6. one code box on the page (%d)" % codes)
        shot("6-code")
        pg.locator("#app [data-fl-code]").press_sequentially(CODE, delay=40)
        ok(wait("() => { const e = document.querySelector('#app [data-oc-say=connect]'); return !!e && e.getAttribute('data-oc-st') === 'ok'; }", 20000), "6. the code typed: Connected")
        pg.wait_for_timeout(1500)
        ok(len(calls("tally_device_create")) == 1 and len(posts()) == 1, "6. one key, handed once (%d, %d)" % (len(calls("tally_device_create")), len(posts())))
        # 7. no bridge; another user's
        bridge_reset(on=False); open_tally(DEAD, UNPAIRED)
        pg.click("#app [data-oc-connect]")
        ok(wait("() => { const e = document.querySelector('#app [data-oc-say=connect]'); return !!e && e.getAttribute('data-oc-st') === 'none'; }"), "7. no bridge")
        ok(txt("#app [data-oc-say=connect]").startswith("FinCom Bridge is not running on this computer") and pg.locator("#app [data-oneclick] [data-bridge-download]").count() == 1, "7. its words and the Download button")
        bridge_reset(yours=False); open_tally(DEAD, UNPAIRED)
        pg.click("#app [data-oc-connect]")
        ok(wait("() => { const e = document.querySelector('#app [data-oc-say=connect]'); return !!e && e.getAttribute('data-oc-st') === 'other'; }"), "7. another Windows user's bridge: its line (%s)" % txt("#app [data-oc-say=connect]"))
        # 8. a bridge that does not answer: a reason within the limit
        bridge_reset(hang="/cloudlink"); open_tally(DEAD)
        E("() => { window.__ocMsScale = 0.1; }")
        t0 = time.time(); pg.click("#app [data-oc-connect]")
        ok(wait("() => { const e = document.querySelector('#app [data-oc-say=connect]'); return !!e && e.getAttribute('data-oc-st') === 'error'; }", 20000), "8. no answer: an error, not a spinner")
        ok("in time" in txt("#app [data-oc-say=connect]") and time.time() - t0 < 15, "8. the reason (%s)" % txt("#app [data-oc-say=connect]"))
        ok(pg.locator("#app [data-oc-connect]").inner_text().strip() == "Connect this computer", "8. the button usable again")
        E("() => { window.__ocMsScale = 1; }")
        # 9. TCloud.auto replaces a refused key by itself
        bridge_reset(); open_tally(DEAD)
        E("async () => { await Bridge.refresh(false); TCloud.autoAt = 0; TCloud.autoBusy = false; return TCloud.auto(); }"); pg.wait_for_timeout(1500)
        ok(len(calls("tally_device_create")) == 1 and len(posts()) == 1 and BR["cloudKey"] == "fcd_" + "0a" * 24, "9. TCloud.auto: the refused key replaced by itself (%d, %d)" % (len(calls("tally_device_create")), len(posts())))
        E("() => { window.__calls = []; TCloud.autoBusy = false; return TCloud.auto(); }"); pg.wait_for_timeout(800)
        ok(not calls("tally_device_create"), "9. not again at once (one key at a time)")
        bridge_reset(beat={"on": True, "last": time.strftime("%Y-%m-%dT%H:%M:%S"), "missedSince": "", "every": 30}); open_tally(DEAD)
        E("async () => { await Bridge.refresh(false); TCloud.autoAt = 0; TCloud.autoBusy = false; return TCloud.auto(); }"); pg.wait_for_timeout(1200)
        ok(not calls("tally_device_create"), "9. a bridge whose beat reaches FinCom is left alone")
        # 10. the connect panel keeps the bridge found for a missed scan
        bridge_reset(window=True); open_tally(DEAD, UNPAIRED, devs=[])
        ok(wait("() => { const e = document.querySelector('#app [data-firstlink]'); return !!e && e.getAttribute('data-firstlink') === 'code'; }"), "10. the panel found the bridge")
        BR["on"] = False; pg.wait_for_timeout(6500)
        ok(E("() => document.querySelector('#app [data-firstlink]').getAttribute('data-firstlink')") == "code", "10. one missed scan: the code box stays")
        # 11. phone width
        bridge_reset(); open_tally(DEAD); pg.click("#app [data-oc-connect]"); wait("() => !!document.querySelector('#app [data-oc-cos]')")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(400)
        ok(wide() <= 0, "11. no sideways scroll at 390 (%d)" % wide())
        pg.set_viewport_size({"width": 1440, "height": 900})
        ok(not errors, "no page errors (%s)" % errors[:3])
        try: pg.unroute_all(behavior="ignoreErrors")
        except Exception: pass
        br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
