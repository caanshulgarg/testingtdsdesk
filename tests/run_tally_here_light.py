"""python3 run_tally_here_light.py - next-tally-connectfix findings 2, 3 and 4 (04-Nov-2026), the one-click card's look for
this computer's FinCom Bridge (lib/tallyConnect.js lookHere) on a shared server, where every port that answers is another
Windows login's bridge reading the computer's TCP table for each /ping. Signed in to a stand-in of FinCom's cloud with the
made-up firm of tally_shapes.py, on the Tally page; /ping answers made up by port in the page (nothing listens):
  4. light: the remembered address and this login's own bridge's port (remembered / its beat's bridgePort) first; when one
     of them is this login's bridge, nothing else is asked; the whole range 9100-9199 at most once a tab by itself (the
     card's 2-minute look asks only the few), again on Connect / "I have opened it"; two looks at once are one.
  3. the remembered address now another login's bridge (it took this login's old port; sameSession false, or another
     Windows user): not trusted, the range asked at once, this login's bridge found and remembered instead.
  2. this login's bridge is known (found in this login before) and only another login's answers: Connect says it is
     installed but not running in this login, start it from the Start menu (FinCom Bridge), never "Install"; nothing known
     of this login's bridge: "another Windows user ... Install" as before.
RED on the build before this change: 4 (the range asked every time the remembered address is not this login's), 3, 2 fail.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_here_light.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tally_shapes as TS
from run_tally_connect_norekey import open_page, Q, ok, fails, errors
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TALLY_PORT", "9572"))
U = lambda n: TS.PC + "\\" + TS.USERS[n]

# /ping answers by port (p: {port: answer}); each port asked counted; the remembered own bridge and Bridge's address set
SCENE = """(o) => {
  window.__ocMsScale = 0.05;
  window.__asked = [];
  const P = o.p || {};
  Bridge.blocked = () => false;
  Bridge.probeUrl = (base, ms) => { const port = Bridge.urlPort(base); window.__asked.push(port); const j = P[String(port)];
    return new Promise((r) => setTimeout(() => r(j ? Object.assign({ port, url: 'http://127.0.0.1:' + port }, j, { proven: false, pairProven: false }) : null), 20)); };
  Bridge.probe = (port, ms) => Bridge.probeUrl('http://127.0.0.1:' + port, ms);
  const cfg = Object.assign({ url: 'http://127.0.0.1:' + o.url, key: '', follow: true }, o.cfg || {});
  Bridge.cfg = () => Object.assign({}, cfg); Bridge.setCfg = (x) => Object.assign(cfg, x); window.__cfg = cfg;
  const K = ((typeof LocalOwner === 'object' && LocalOwner && LocalOwner.P) || 'tdsdesk:') + 'ownbridge';
  if (o.own) localStorage.setItem(K, JSON.stringify(o.own)); else localStorage.removeItem(K);
  if (o.reset !== false) FCTallyConnect.resetHere();
}"""
LOOK = "async (full) => { const h = await FCTallyConnect.lookHere({ full: !!full }); return { mine: h.mine ? h.mine.port : 0, other: h.other ? h.other.port : 0, known: !!h.known, asked: window.__asked.length, url: window.__cfg.url }; }"
def ping(port, same, user, yours=None, bid=True):
    j = {"ok": True, "bridge": "FinCom Tally Bridge", "version": "2.5.3", "impl": "go", "yours": same is True if yours is None else yours, "windowsUser": user, "bridgePort": port}
    if same is not None: j["sameSession"] = same
    if j["yours"] and bid: j.update({"bridgeId": "go-%dabcdef" % port, "port": port})
    return j

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])
        ctx, pg = open_page(br, "http://localhost:%d/" % PORT)
        E = lambda js, *a: pg.evaluate(js, *a)

        print("== 4. light: the remembered address and this login's own port first")
        own = {"id": "go-9104abcdef", "port": 9104, "user": U(1)}
        E(SCENE, {"url": 9104, "own": own, "p": {"9104": ping(9104, True, U(1)), "9100": ping(9100, False, U(0))}})
        r = E(LOOK, False)
        ok(r["mine"] == 9104 and r["asked"] == 1, "4. the remembered address is this login's: found, one port asked (%s)" % r)
        E(SCENE, {"url": 9100, "own": own, "p": {"9104": ping(9104, True, U(1)), "9100": ping(9100, False, U(0))}})
        r = E(LOOK, False)
        ok(r["mine"] == 9104 and r["asked"] == 2, "4. this login's own port (remembered) answers: two ports asked, no range (%s)" % r)
        # nothing of this login answers: the range once, then only the few
        E(SCENE, {"url": 9100, "own": own, "p": {"9100": ping(9100, False, U(0)), "9101": ping(9101, False, U(2))}})
        r1 = E(LOOK, False); a1 = r1["asked"]
        ok(a1 >= 100 and r1["mine"] == 0, "4. nothing of this login answers: the range asked once (%d ports)" % a1)
        for i in range(3): E(LOOK, False)
        a2 = E("() => window.__asked.length")
        ok(a2 - a1 == 3 * 2, "4. three more looks by themselves: only the remembered address and own port each (%d more)" % (a2 - a1))
        r = E(LOOK, True)
        ok(r["asked"] - a2 >= 100, "4. Connect (full): the range asked again (%d)" % (r["asked"] - a2))
        n0 = E("() => window.__asked.length")
        E("async () => { await Promise.all([FCTallyConnect.lookHere(), FCTallyConnect.lookHere(), FCTallyConnect.lookHere()]); }")
        ok(E("() => window.__asked.length") - n0 == 2, "4. three looks at once are one (%d ports)" % (E("() => window.__asked.length") - n0))
        # the card's 2-minute look (useHereProbe) after its clock ran out: the few only; "I have opened it": the range
        E("() => { FCOneClick.OC.hereAt = 0; }"); n1 = E("() => window.__asked.length")
        E("() => { if (typeof render === 'function') render(); }"); pg.wait_for_timeout(800)
        n2 = E("() => window.__asked.length")
        ok(n2 - n1 <= 2, "4. the card's look by itself (clock run out): %d ports (no range)" % (n2 - n1))
        E("() => FCTallySimple.rescanLocal()"); E("() => { FCOneClick.OC.hereAt = 0; render(); }"); pg.wait_for_timeout(1200)
        ok(E("() => FCTallyConnect.HERE.again") is False, "4. I have opened it: the card's look took the ask (HERE.again cleared)")

        print("== 3. the remembered address is another login's now")
        # saurabh-like: another login's 2.5.3 bridge took this login's old port 9102 (sameSession false); this login's is on 9107
        E(SCENE, {"url": 9102, "own": {"id": "go-9102abcdef", "port": 9102, "user": U(1)}, "p": {"9102": ping(9102, False, U(2)), "9107": ping(9107, True, U(1))}})
        r = E(LOOK, False)
        ok(r["mine"] == 9107 and r["asked"] >= 100, "3. sameSession false at the remembered address: not trusted, the range at once, this login's found (%s)" % {k: r[k] for k in ("mine", "asked")})
        ok(r["url"] == "http://127.0.0.1:9107", "3. this login's bridge remembered instead (%s)" % r["url"])
        # an older bridge there (no sameSession) of another Windows user, saying yours: not this login's (its Windows user)
        E(SCENE, {"url": 9102, "own": {"id": "", "port": 9102, "user": U(1)}, "p": {"9102": ping(9102, None, U(2), yours=True), "9108": ping(9108, True, U(1))}})
        r = E(LOOK, False)
        ok(r["mine"] == 9108 and r["url"] == "http://127.0.0.1:9108", "3. another Windows user's bridge at the remembered address (no sameSession): not this login's (%s)" % r)
        # tallySimple's own look (rescanLocal): this login's sure bridge found, the remembered address another login's: fixed
        E(SCENE, {"url": 9102, "own": None, "p": {}})
        E("""() => { const P = {9102: {ok: true, bridge: 'FinCom Tally Bridge', version: '2.5.3', yours: false, sameSession: false, windowsUser: 'X\\\\b', bridgePort: 9102},
                               9103: {ok: true, bridge: 'FinCom Tally Bridge', version: '2.5.3', yours: true, sameSession: true, windowsUser: 'X\\\\a', bridgePort: 9103, bridgeId: 'go-9103abcdef', port: 9103}};
                    Bridge.probe = (port) => Promise.resolve(P[port] ? Object.assign({port, url: 'http://127.0.0.1:' + port}, P[port]) : null); FCTallySimple.rescanLocal(); }""")
        pg.wait_for_timeout(1500)
        ok(E("() => window.__cfg.url") == "http://127.0.0.1:9103", "3. the page's look: the remembered address moved to this login's bridge (%s)" % E("() => window.__cfg.url"))

        print("== 2. start, not install, when this login's bridge is known")
        con = "async () => { const r = await FCTallyConnect.connectNow({}); return [r.st, r.say]; }"
        E("() => { TCloud.on = () => true; Bridge.on = () => false; }")
        E(SCENE, {"url": 9100, "own": {"id": "go-9105abcdef", "port": 9105, "user": U(1)}, "p": {"9100": ping(9100, False, U(0))}})
        E("() => { TCloud.on = () => true; Bridge.on = () => false; }")
        st, say = E(con)
        ok(st == "stopped" and "installed but not running in this login" in say and "Start menu (FinCom Bridge)" in say and "Install" not in say, "2. this login's bridge known, another's answers: start it (%s: %s)" % (st, say))
        E(SCENE, {"url": 9100, "own": {"id": "go-9105abcdef", "port": 9105, "user": U(1)}, "p": {}})
        E("() => { TCloud.on = () => true; Bridge.on = () => false; }")
        st, say = E(con)
        ok(st == "stopped" and "start it from the Start menu" in say, "2. nothing answers, this login's bridge known: start it (%s)" % st)
        E(SCENE, {"url": 9100, "own": None, "p": {"9100": ping(9100, False, U(0))}})
        E("() => { TCloud.on = () => true; Bridge.on = () => false; TCloud.bridgesHeard = () => []; }")
        st, say = E(con)
        ok(st == "other" and "another Windows user" in say, "2. nothing known of this login's bridge: another Windows user's, install (%s)" % st)
        ok(not errors, "no page errors (%s)" % errors[:3])
        ctx.close(); br.close()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
