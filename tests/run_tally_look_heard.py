"""python3 run_tally_look_heard.py - the Tally page's look for this computer's FinCom Bridge (speed, 11-Nov-2026: 102 of
a linked firm's 170 calls on opening the page were /ping of the whole range 9100-9199, all at once). On the stand-in of
FinCom's cloud with the made-up firm of tally_shapes.py; /ping answered in the page (nothing listens). Nothing known here
of this login's own bridge (lib/tallyConnect.js lookHere): the ports the firm's bridges' beats give (FinCom's cloud) are
asked with the remembered address first; this login's bridge among them: found and remembered, the range not asked;
none of them this login's: the range, at most 16 ports at a time.
RED on the build before this change: the range asked (101 ports), 100 at once.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_look_heard.py"""
import os, sys, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from run_tally_connect_norekey import open_page, Q, ok, fails, errors
import threading, functools, http.server
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))

# ---------- look: the firm's bridges heard in the cloud asked before the range
SCENE = """(o) => {
  window.__ocMsScale = 0.05; window.__asked = []; window.__at = 0; window.__most = 0;
  const P = o.p || {};
  Bridge.blocked = () => false;
  Bridge.probeUrl = (base, ms) => { const port = Bridge.urlPort(base); window.__asked.push(port); window.__at++; window.__most = Math.max(window.__most, window.__at); const j = P[String(port)];
    return new Promise((r) => setTimeout(() => { window.__at--; r(j ? Object.assign({ port, url: 'http://127.0.0.1:' + port }, j, { proven: false, pairProven: false }) : null); }, 20)); };
  Bridge.probe = (port, ms) => Bridge.probeUrl('http://127.0.0.1:' + port, ms);
  const cfg = { url: 'http://127.0.0.1:' + o.url, key: '', follow: true };
  Bridge.cfg = () => Object.assign({}, cfg); Bridge.setCfg = (x) => Object.assign(cfg, x); window.__cfg = cfg;
  const K = ((typeof LocalOwner === 'object' && LocalOwner && LocalOwner.P) || 'tdsdesk:') + 'ownbridge';
  localStorage.removeItem(K);
  TCloud.bridgesHeard = () => (o.heard || []).map((port, i) => ({ id: 'go-heard' + i, port, user: 'PC\\\\u' + i, at: new Date().toISOString(), go: true }));
  FCTallyConnect.resetHere();
}"""
LOOK = "async (full) => { const h = await FCTallyConnect.lookHere({ full: !!full }); return { mine: h.mine ? h.mine.port : 0, asked: window.__asked.length, most: window.__most, url: window.__cfg.url }; }"
def ping(port, same):
    return {"ok": True, "bridge": "FinCom Tally Bridge", "version": "2.5.13", "yours": True, "sameSession": same, "bridgeId": "go-%d" % port, "port": port, "windowsUser": "PC\\u"}

def look(E, pg):
    print("== look: this computer's bridge, nothing known of it here")
    E(SCENE, {"url": 9100, "heard": [9101, 9150], "p": {"9101": ping(9101, True), "9150": ping(9150, False)}})
    r = E(LOOK, False)
    ok(r["mine"] == 9101 and r["asked"] <= 4, "look: the port the cloud's beat gives answers as this login's: found, no range (%s)" % r)
    ok(r["url"].endswith(":9101"), "look: remembered there (%s)" % r["url"])
    E(SCENE, {"url": 9100, "heard": [9150], "p": {"9177": ping(9177, True), "9150": ping(9150, False)}})
    r = E(LOOK, False)
    ok(r["mine"] == 9177 and r["asked"] >= 100, "look: none of the known ports is this login's: the range (%s)" % r)
    ok(r["most"] <= 16, "look: the range at most 16 ports at a time (%d at once)" % r["most"])

PORT = int(os.environ.get("TALLY_PORT", "9584"))

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx, pg = open_page(br, "http://localhost:%d/" % PORT)
        E = lambda js, *a: pg.evaluate(js, *a)
        look(E, pg)
        ok(not errors, "no page errors (%s)" % errors[:3])
        ctx.close(); br.close()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
