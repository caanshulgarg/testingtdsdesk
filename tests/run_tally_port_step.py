"""python3 run_tally_port_step.py - Connect Tally's step 2, Set Tally's port (26-Oct-2026, next-tally-port; the owner: "You
said we don't have to set the port, but we still need to set the port. I don't mind setting it, but FinCom needs a step:
this port is free, and do this step in Tally. Everything should be clearly spoken").
  1. The steps in order: Install FinCom Bridge, Set Tally's port, Open your company, Add as client ("N of 4 done").
  2. Proposed (the owner on the first draft: "too lengthy, make it small and clear"): "Use port <n> (free for you)", the
     number large, with Copy: in 9000-9099, never a port seen on that computer (any Windows user's Tally, the
     beat's ports, another user's bridge's Tally port) and never a well-known one (9000, 9001, 9090 ...); TallyPrime's menu
     in ONE line with that port filled in ("In TallyPrime: F1 → Settings → Connectivity → Client/Server configuration →
     Acts as Both, Port <n>, ODBC Yes → Ctrl+A → restart Tally."); the ports in use only behind "Ports in use (N)"; step 3
     short ("Open TallyPrime on NWS144 and open your company.").
  3. His Tally already answers on a port no other user's has: "Your Tally uses port 9002 ✓", the step ticked.
  4. Clash: his Tally's port is another Windows user's on the same computer: needs action, "Your Tally is on 9000, same as
     another user. Change it to <n> as above." (and, here only, the one sentence about a shared TallyPrime folder)
  5. Check: after the stub reports his Tally on the proposed port, Check turns the step green (and the guide's own read
     does it by itself).
  6. No bridge yet / offline: "Finish step 1 first".
  7. Phone 390: no sideways scroll.
  8. (next-link-record; the TallyPrime 7.2 proof of 26-Oct-2026: bridge 2.4.7 connects to Tally on any port it finds) his
     Tally on 4125 or 8000, the bridge connected: done, no warning; a clash says "Use a port between 9000 and 9999 — <n> is
     free." above its own sentence.
Options: --shots DIR  saves the step (proposed, done, clash) at desktop 1440 and phone 390.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_port_step.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8431
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
AVOID = {9000, 9001, 9009, 9030, 9042, 9043, 9050, 9051, 9060, 9080, 9090, 9091, 9092, 9093, 9094, 9095, 9099}
DID = "d0000000-0000-4000-8000-000000000001"
# NWS144 as on 26-Oct-2026: several Windows users' TallyPrime at once (ports 1950, 2022, 2929, 3543, 9000, 9002 ...)
OTHERS = [1950, 2022, 2929, 3543, 9000, 9002] + list(range(9003, 9090, 3))
def bridge(user, port, tally, at):
    return {"at": at, "version": "2.4.5", "computer": "NWS144", "user": user, "mode": "main", "runMode": "user", "tally": tally == "open", "tallyState": tally,
            "open": ["GB TEXCOAT"] if tally == "open" else [], "tallyPort": port, "dataFolder": "C:\\Users\\Public\\TallyPrime\\Data"}
def nws(my_port=None, my_tally="closed", others=OTHERS, ravi_port=9004, my_at="ago:0.5"):
    """anshul's bridge (main, online) and ravi's (heard an hour ago) on NWS144; the beat is anshul's: his Tally (if any) and
    every other user's Tally (skipped)"""
    ports = ([{"port": my_port, "ok": my_tally == "open", "skipped": False, "n": 1, "error": "", "state": my_tally}] if my_port else []) + \
            [{"port": p, "ok": False, "skipped": True, "n": 0, "error": "Tally of Windows session 2", "state": ""} for p in others]
    beat = {"at": my_at, "every": 30, "tally": my_tally == "open", "tallyState": my_tally, "open": ["GB TEXCOAT"] if my_tally == "open" else [], "paused": False,
            "ports": ports, "windowsUser": "anshul", "tallyPort": my_port or 0, "companies": []}
    bridges = {"go-1": bridge("anshul", my_port, my_tally, my_at), "go-2": bridge("ravi", ravi_port, "open", "ago:60")}
    return [{"id": DID, "name": "NWS144", "revoked": False, "last_seen": my_at, "version": "2.4.5", "main_bridge": "go-1",
             "info": {"computer": "NWS144", "user": "anshul", "beat": beat, "bridges": bridges}, "created_at": "2026-09-01T00:00:00Z",
             "post_only": [], "post_batch_bills": 10, "post_batch_bank": 50, "trial_tools": False, "recorder_source": "addon"}]
SEEN = [{"company": "GB TEXCOAT", "client_id": None, "device_id": DID, "gstin": "", "last_seen": "ago:1"}]
SETUP = """([devs, companies]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  window.__fix = fix;
  window.__devs = fix(devs); window.__companies = fix(companies); window.__calls = []; window.__reads = 0; window.__wakes = [];
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    if (/^tally_devices/.test(path)) { window.__reads++; return copy(window.__devs); }
    if (/^tally_companies/.test(path)) return copy(window.__companies);
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, a || {}]); return {ok: true}; };
  Cloud.rpc = async (fn, a) => { window.__calls.push([fn, a || {}]); return {ok: true}; };
  if (typeof TCloudUp === "object") TCloudUp.post = async (body) => { window.__wakes.push(body); return {}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner"})});
  TCloud.pane.devices = null; TCloud.pane.companies = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  TLight.st.at = Date.now(); TLight.st.devs = window.__devs.filter(d => !d.revoked); TLight.st.cos = window.__companies; TLight.st.stops = [];
  Rec.act = {rows: [], at: Date.now()};
  document.body.classList.add("is-test"); S.firm.firmName = "ABC";
  S.tallyOld = false; S.tallyTab = "computers"; S.tallyMore = {}; S.tallyFocus = ""; S.tallyGuide = {}; S.coId = null; navHome("tally");
}"""
STEP = '#app [data-connect-step="port"]'

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def open_page(w, h):
            pg = br.new_page(viewport={"width": w, "height": h}, color_scheme="light"); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
                body=json.dumps({"setup": {"version": "2.4.5", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.5.exe", "sha256": "ab" * 32}})))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            return pg
        for (w, h, tag) in [(1440, 900, "desktop"), (390, 844, "phone")]:
            pg = open_page(w, h)
            E = lambda js, *a: pg.evaluate(js, *a)
            n = lambda sel: pg.locator(sel).count()
            txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
            def scene(devs, cos=SEEN):
                E(SETUP, [devs, cos]); pg.wait_for_timeout(1800)
            def shot(name):
                if SHOTS:
                    os.makedirs(SHOTS, exist_ok=True)
                    # the whole guide, from the page (an element shot scrolls it under the sticky top bar)
                    b = E("() => { const r = document.querySelector('#app [data-status-card], #app [data-connect-guide]').getBoundingClientRect(); return {x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height}; }")
                    pg.screenshot(path=os.path.join(SHOTS, "%s-%s.png" % (name, tag)), full_page=True, clip=b)
            state = lambda: pg.get_attribute(STEP + " [data-port-state]", "data-port-state") if n(STEP + " [data-port-state]") else None
            # next-tally-smart (28-Oct-2026): once a computer is connected the step is on the status card, only while his Tally is
            # not answering on a port of its own; done: no step, the card says Connected
            done = lambda: n(STEP) == 0 and "Connected" in txt("#app [data-tsc-word]")
            say = "%s: " % tag

            # ---- 1, 2. proposed: his Tally not answering yet; every other user's port skipped
            scene(nws())
            ok(n("#app [data-connect-guide]") == 0 and n("#app [data-status-card] " + STEP[5:]) == 1 and "Tally not open" in txt("#app [data-tsc-word]"),
               say + "connected, Tally not answering: no wizard; 'Set Tally’s port' on the status card (%s)" % txt("#app [data-status-card]")[:120])
            ok(txt(STEP + " > b") == "Set Tally’s port", say + "its title")
            ok(state() == "set" and not done(), say + "proposed: the step needs him (%s)" % state())
            free = int(pg.get_attribute(STEP + " [data-port-free]", "data-port-free") or 0)
            big = txt(STEP + " [data-port-free-big]")
            seen = set(OTHERS) | {9004}
            ok(9000 <= free <= 9099 and free not in seen and free not in AVOID, say + "one free port in 9000-9099, none seen on NWS144, none well-known (%s)" % free)
            ok(big == str(free) and n(STEP + " [data-port-copy]") == 1, say + "the port in large text with Copy (%s)" % big)
            fs = E("(s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize)", STEP + " [data-port-free-big]")
            ok(fs >= 24, say + "large: %spx" % fs)
            ok(txt(STEP + " .tc3-port") == "Use port %d (free for you) Copy" % free, say + "one line: 'Use port %d (free for you)' with Copy (%s)" % (free, txt(STEP + " .tc3-port")))
            how = txt(STEP + " [data-port-how]")
            ok(how == "In TallyPrime: F1 → Settings → Connectivity → Client/Server configuration → Acts as Both, Port %d, ODBC Yes → Ctrl+A → restart Tally." % free,
               say + "TallyPrime's menu in ONE short line, the port filled in (%s)" % how)
            ok(n(STEP + " [data-port-used]") == 0 and "share one TallyPrime folder" not in txt(STEP) and n(STEP + " [data-port-not-yet]") == 0,
               say + "short: no ports list, no shared-folder note by default (%d words)" % len(txt(STEP).split()))
            ok(txt(STEP + " [data-port-used-toggle]") == "Ports in use (%d)" % len(set(OTHERS) | {9004}), say + "a small 'Ports in use (N)' link (%s)" % txt(STEP + " [data-port-used-toggle]"))
            pg.click(STEP + " [data-port-used-toggle]"); pg.wait_for_timeout(200)
            ok(txt(STEP + " [data-port-used]").startswith("In use on NWS144: 1950, 2022, 2929, 3543, 9000, 9002"), say + "it opens the list (%s)" % txt(STEP + " [data-port-used]")[:60])
            pg.click(STEP + " [data-port-used-toggle]"); pg.wait_for_timeout(200)
            ok("Open TallyPrime and your company" in txt("#app [data-tsc-need=tally]"), say + "the card's line: open TallyPrime and your company: %r" % txt("#app [data-tsc-need=tally]"))
            ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), say + "no sideways scroll (%s)" % E("() => [document.documentElement.scrollWidth, window.innerWidth]"))
            shot("proposed")

            # ---- 5. Check: the stub now reports his Tally on that port
            E("""(p) => { const d = window.__devs[0], b = d.info.beat, me = d.info.bridges['go-1'];
                b.ports.unshift({port: p, ok: true, skipped: false, n: 1, error: '', state: 'open'}); b.tally = true; b.tallyState = 'open'; b.tallyPort = p;
                Object.assign(me, {tallyPort: p, tally: true, tallyState: 'open', open: ['GB TEXCOAT']}); }""", free)
            r0 = E("window.__reads")
            pg.click(STEP + " [data-port-check]"); pg.wait_for_timeout(1500)
            ok(E("window.__reads") > r0 and done(), say + "Check: read again, the step gives way, Connected: %r" % txt("#app [data-status-card]")[:100])

            # ---- 3. his Tally already on a port of its own: ticked
            scene(nws(my_port=9002, my_tally="open", others=[1950, 2022, 2929, 3543, 9000]))
            ok(done() and state() is None and n(STEP + " [data-port-how]") == 0 and "port" not in txt("#app [data-status-card]").lower(),
               say + "already on 9002, nobody else: Connected, no port step, no port words (%s)" % txt("#app [data-status-card]")[:100])
            shot("done")

            # ---- 4. clash: his Tally on 9000, ravi's Tally on 9000 too
            scene(nws(my_port=9000, my_tally="open", others=[1950, 2022, 2929], ravi_port=9000))
            free = int(pg.get_attribute(STEP + " [data-port-free]", "data-port-free") or 0)
            cl = txt(STEP + " [data-port-clash]")
            ok(state() == "clash" and not done() and cl.startswith("Your Tally is on 9000, same as another user. Change it to %d as above." % free) and "share one TallyPrime folder" in cl and "Port clash" in txt("#app [data-tsc-word]"),
               say + "clash: needs action, in plain words, the card's word Port clash (%r)" % cl)
            ok(free not in {9000, 1950, 2022, 2929} and free not in AVOID and "Port %d," % free in txt(STEP + " [data-port-how]"), say + "clash: a free port and the menu with it (%s)" % free)
            ok(txt(STEP + " [data-port-warn]") == "Use a port between 9000 and 9999 — %d is free." % free, say + "clash: the one warning too (%s)" % txt(STEP + " [data-port-warn]"))
            shot("clash")
            # the guide's own read (every 20 s) ticks it without a click once ravi moves away
            E("() => { window.__devs[0].info.bridges['go-2'].tallyPort = 9070; }")
            E("() => TCloud.refreshPane()"); pg.wait_for_timeout(1200)
            ok(done() and state() is None, say + "re-read: ravi moved, his 9000 is his own: Connected, no step (%s)" % state())

            # ---- 8. his Tally on a port outside 9000-9999 that his bridge reaches (the TallyPrime 7.2 proof, 26-Oct-2026: bridge
            # 2.4.7 connects on 4125): done, no warning
            for other in (4125, 8000):
                scene(nws(my_port=other, my_tally="open", others=[1950, 2022, 2929]))
                ok(state() is None and done() and n(STEP + " [data-port-warn]") == 0, say + "port %d, the bridge connected: Connected, no step, no warning (%s)" % (other, txt("#app [data-status-card]")[:80]))

            # ---- 6. no bridge yet; offline
            scene([], [])
            ok(state() == "wait" and txt(STEP + " [data-port-state]").startswith("Finish step 1 first") and not done(), say + "no bridge: 'Finish step 1 first' (%s)" % txt(STEP))
            scene(nws(my_at="ago:30"))
            ok(state() is None and n("#app [data-tsc-need=offline]") == 1, say + "offline: the card says the computer is not connected, no port step (%s)" % txt("#app [data-status-card]")[:100])
            pg.close()
        ok(not errors, "no page errors " + str(errors[:2]))
        br.close()
    srv.shutdown()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
