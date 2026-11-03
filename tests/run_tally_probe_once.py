"""python3 run_tally_probe_once.py - the Tally page's look for this Windows login's own bridge (bridge 2.5.3 sameSession,
next-tally-samesession) is asked at most ONCE per tab, plus each explicit "Connect" / "I have opened it", and never
makes the page draw itself again and again (next-fix-probe-loop, 03-Nov-2026: build mw0mxsrv-dd8f8d at review/ was
reported "Site is crashing.. not working properly"). Made-up firm, computers and bridges only; nothing listens.
  1. Today, Clients and a client's Bank: no /ping of the look at all.
  2. Tally: one look (one round of ports), and its answer draws the page at most once.
  3. drawing the page 60 times asks nothing more; the page left idle with its 2-minute clock run out (LOCALB.at = 0, no
     bridge answering) and the firm's ports changed (a beat with another bridgePort) ask nothing more either.
  4. Today and back to Tally: nothing more (once per tab).
  5. "I have opened it": exactly one more round; pressed again at once while asking: no second round in parallel.
  6. Connect (the column's): exactly one more round.
  7. an answer that is the same as the last one does not draw the page again.
  8. idle on Tally with answering bridges (one sameSession true, one false): React commits per second stay low, no
     long task over 200 ms; the own bridge is the one saying sameSession true (the owner's requirement stays).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_probe_once.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 9541
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.3", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.3.exe", "sha256": "ab" * 32}}
# before the page's own scripts: React's commits counted (the devtools hook React calls at each commit), long tasks kept
INIT = """(() => {
  window.__commits = 0; window.__long = [];
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {supportsFiber: true, renderers: new Map(), inject(r){ this.renderers.set(1, r); return 1; },
    onCommitFiberRoot(){ window.__commits++; }, onCommitFiberUnmount(){}, onPostCommitFiberRoot(){}, checkDCE(){}, isDisabled: false};
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({type: 'longtask', buffered: true}); } catch (e) {}
})()"""
# /ping on 127.0.0.1 (made-up answers by port; nothing listens): the page's look (its short wait, under a second) counted
# with the port; the older sweeps (Bridge.find 1.5 s, the card's lookHere 2.5 s: as before this change) counted apart
PROBE = """(pings) => {
  window.__pings = pings || {}; window.__looks = []; window.__finds = 0;
  Bridge.probe = (port, ms, key, code) => { if (key || code || !(ms < 1000)) { window.__finds++; return Promise.resolve(null); }
    window.__looks.push(port); const j = window.__pings[String(port)];
    return new Promise((r) => setTimeout(() => r(j ? Object.assign({port, url: 'http://127.0.0.1:' + port}, j, {proven: false, pairProven: false}) : null), 5)); };
}"""
def ping(port, same, user):
    r = {"ok": True, "bridge": "FinCom Tally Bridge", "version": "2.5.3", "impl": "go", "runMode": "user", "yours": same is True,
         "windowsUser": user, "bridgePort": port, "tallyPorts": [9070], "tallyPortsUnknown": []}
    if same is not None: r["sameSession"] = same
    return r
UA, UB = "PC1\\usera", "PC1\\userb"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.add_init_script(INIT)
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
        pg.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
        pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        looks = lambda: E("window.__looks.length")
        commits = lambda: E("window.__commits")
        # the firm: two Windows logins' bridges on one computer (2.5.3, their own ports); nothing answers yet
        da = T.dev(1, "PC1", UA, opened=("GB TEXCOAT",), version="2.5.3", beat={"bridgePort": 9103, "windowsUser": UA}, rec=("GB TEXCOAT",))
        db = T.dev(2, "PC1", UB, opened=("ABC TRADERS",), version="2.5.3", beat={"bridgePort": 9104, "windowsUser": UB}, rec=("ABC TRADERS",))
        E(PROBE, {})
        # (the scene is set without opening the Tally page: this tab has not been on it yet)
        E("() => { window.__nh = navHome; navHome = () => {}; }")
        E(T.SETUP, [[da, db], T.companies(d=da["id"]), [], "owner", T.CLIENTS, True, {}])
        E("() => { navHome = window.__nh; }"); pg.wait_for_timeout(300)
        cid = E("() => Object.values(S.companies)[0].id")

        print("== 1. other pages: no look")
        E("() => { window.__looks = []; navHome('today'); }"); pg.wait_for_timeout(1500)
        E("() => navHome('clients')"); pg.wait_for_timeout(1500)
        E("(c) => { S.coId = c; S.view = 'company'; S.tab = 'bank'; render(); }", cid); pg.wait_for_timeout(1500)
        for i in range(20): E("() => render()")
        pg.wait_for_timeout(500)
        ok(looks() == 0, "1. Today, Clients, Bank (and 20 drawings there): no /ping of the look (%s)" % E("window.__looks"))

        print("== 2. Tally: one look")
        E("() => { window.__looks = []; navHome('tally'); }"); pg.wait_for_timeout(2500)
        n1 = looks(); rounds = E("() => { const l = window.__looks; return l.filter((p) => p === l[0]).length; }")
        ok(n1 > 0 and rounds == 1 and n1 <= 120, "2. Tally: one round of the look (%d pings, port %s asked %d time(s))" % (n1, E("window.__looks[0]"), rounds))
        ok(E("() => !!document.querySelector('#app [data-tally-simple]')"), "2. the simple Tally page is drawn")

        print("== 3. drawings, the 2-minute clock and a port change ask nothing more")
        c0 = commits()
        for i in range(60): E("() => render()")
        pg.wait_for_timeout(1500)
        ok(looks() == n1, "3. 60 drawings: no more pings (%d -> %d)" % (n1, looks()))
        ok(commits() - c0 <= 60 * 4 + 6, "3. 60 drawings: no drawing of its own in between (%d commits)" % (commits() - c0))
        c1 = commits(); pg.wait_for_timeout(3000)
        ok(commits() - c1 <= 3, "3. idle 3 s: the page does not draw itself again and again (%d commits)" % (commits() - c1))
        E("() => { FCTallySimple.LOCALB.at = 0; render(); render(); }"); pg.wait_for_timeout(1500)
        ok(looks() == n1, "3. the 2-minute clock run out, nothing answering: no look by itself (%d -> %d)" % (n1, looks()))
        E("() => { const d = window.__devs[1]; d.info.beat.bridgePort = 9150; TLight.st.devs = window.__devs.filter((x) => !x.revoked); TCloud.pane.devices = JSON.parse(JSON.stringify(TLight.st.devs)); render(); render(); }")
        pg.wait_for_timeout(1500)
        ok(looks() == n1, "3. the firm's ports changed (a beat says 9150): no look by itself (%d -> %d)" % (n1, looks()))

        print("== 4. once per tab")
        E("() => navHome('today')"); pg.wait_for_timeout(800); E("() => navHome('tally')"); pg.wait_for_timeout(2000)
        ok(looks() == n1, "4. Today and back to Tally: no second look (%d -> %d)" % (n1, looks()))

        print("== 5. I have opened it: one round more")
        # the guided box at step 2 (a bridge of this user, nothing open): the member's own bridge is userA's
        da2 = T.dev(1, "PC1", UA, opened=(), version="2.5.3", beat={"bridgePort": 9103, "windowsUser": UA}, rec=())
        E(T.SETUP, [[da2, db], [], [], "owner", T.CLIENTS, True, {}]); pg.wait_for_timeout(300)
        E("(dev) => { TCloud.me = () => 'made-up-member-a'; const L = [{user_id: 'made-up-member-a', device_id: dev, bridge_id: 'go-1'}]; TCloud.pane.links = L; " "const api = Cloud.api; Cloud.api = async (p, o) => /^tally_member_bridges/.test(p) ? JSON.parse(JSON.stringify(L)) : api(p, o); render(); }", da2["id"])
        pg.wait_for_timeout(1500)
        b = "#app [data-tsm-guide] [data-tsm-go=opened]"
        if pg.locator(b).count():
            n2 = looks(); E("(s) => { const e = document.querySelector(s); e.click(); e.click(); }", b)   # (two clicks at once)
            E("() => FCTallySimple.rescanLocal()")                                                       # (and a third ask while asking)
            pg.wait_for_timeout(2500)
            new = E("(n) => window.__looks.slice(n)", n2)
            ok(len(new) > 0 and len(set(new)) == len(new), "5. I have opened it (pressed while asking too): exactly one round more (%d pings, %d ports)" % (len(new), len(set(new))))
        else: ok(False, "5. the guided box's I have opened it is shown (step %s)" % E("() => (document.querySelector('#app [data-tsm-guide]') || {}).getAttribute && document.querySelector('#app [data-tsm-guide]').getAttribute('data-tsm-guide')"))

        print("== 6. Connect: one round more")
        # the member's own bridge last heard an hour ago, its clients connected: the column says not connected, with Connect
        da3 = T.dev(1, "PC1", UA, at="ago:60", opened=("GB TEXCOAT",), version="2.5.3", beat={"bridgePort": 9103, "windowsUser": UA}, rec=("GB TEXCOAT",))
        E(T.SETUP, [[da3, db], T.companies(d=da3["id"]), [], "owner", T.CLIENTS, True, {}]); pg.wait_for_timeout(1500)
        c = "#app [data-tsm-local-connect]"
        if pg.locator(c).count():
            n3 = looks(); pg.click(c); pg.wait_for_timeout(3500)
            new = E("(n) => window.__looks.slice(n)", n3)
            ok(len(new) > 0 and len(set(new)) == len(new), "6. Connect: exactly one round more (%d pings, %d ports)" % (len(new), len(set(new))))
        else: ok(False, "6. the column's Connect is shown (own: %s)" % E("() => (document.querySelector('#app [data-tally-simple]') || {dataset: {}}).dataset.tsmOwn"))

        print("== 7. the same answer again draws nothing more")
        pg.wait_for_timeout(2000)
        c2 = commits(); E("() => FCTallySimple.rescanLocal()"); pg.wait_for_timeout(2000)
        ok(commits() - c2 == 0, "7. a look whose answer did not change: no drawing (%d commits)" % (commits() - c2))

        print("== 8. answering bridges: calm, and the own bridge is the one saying sameSession true")
        E("(p) => { window.__pings = p; }", {"9103": ping(9103, True, UA), "9104": ping(9104, False, UB)})
        E("() => { window.__devs[0].info.beat.at = new Date().toISOString(); window.__devs[0].last_seen = window.__devs[0].info.beat.at; window.__devs[0].info.bridges['go-1'].at = window.__devs[0].info.beat.at; TLight.st.devs = window.__devs.filter((x) => !x.revoked); TCloud.pane.devices = JSON.parse(JSON.stringify(TLight.st.devs)); FCTallySimple.rescanLocal(); }")
        pg.wait_for_timeout(2000)
        n4, c3, l0 = looks(), commits(), len(E("window.__long"))
        pg.wait_for_timeout(8000)
        ok(looks() == n4, "8. 8 s idle with bridges answering: no more pings (%d -> %d)" % (n4, looks()))
        ok(commits() - c3 <= 4, "8. 8 s idle: %d React commits (at most 4)" % (commits() - c3))
        lt = E("window.__long")[l0:]
        ok(not [x for x in lt if x > 200], "8. no long task over 200 ms (%s)" % lt)
        how = E("() => { const e = document.querySelector('#app [data-tally-simple]'); return e ? [e.dataset.tsmOwn, e.dataset.tsmOwnHow || ''] : null; }")
        ok(how == ["ok", "found"], "8. the own bridge: found by sameSession true (%s)" % how)
        ok("ABC TRADERS" not in E("() => { const a = document.querySelector('#app [data-tally-simple]').cloneNode(true); a.querySelectorAll('[data-for-support]').forEach((e) => e.remove()); return [...a.querySelectorAll('[data-tsm-strip], [data-tsm-now]')].map((e) => e.innerText).join(' '); }"),
           "8. userB's open company (sameSession false) is not offered as this login's")
        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
