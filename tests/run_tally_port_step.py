"""python3 run_tally_port_step.py - Tally's port: Connect Tally's step 3, "Tally's connection on, with this login's own
port" (26-Oct-2026, next-tally-port; the owner: "FinCom needs a step: this port is free, and do this step in Tally.
Everything should be clearly spoken"). Rewritten for next-tally-connect-steps (06-Nov-2026): the step is the third of
the Tally page's six live steps, said from what this login's own FinCom Bridge (2.5.4) reports (tallyWhy "connection
off", tallyConnectSay, its ports), never guessed from the ports alone.
Made-up firm and Windows logins only (run_tally_simple.py's stand-in cloud). A shared server SRV02 where several logins
run their own Tally (ports 1950, 2022, 2929, 3543, 9000, 9002, 9003, 9006 ...):
  1. The steps in order; step 3 waits for steps 1 and 2 ("later"), and with no bridge in this login it is not said.
  2. Connection mode off: TallyPrime's menu in ONE line with a free port filled in ("In TallyPrime: F1 → Settings →
     Connectivity → Client/Server configuration → Acts as Both, Port <n>, ODBC Yes → Ctrl+A → restart Tally."): in
     9000-9099, never a port seen on that computer in any beat (any login's Tally, the ports tried, another login's
     bridge's Tally port), never a well-known one; Copy <n>; one button, Check again.
  3. This login's Tally on a port of its own: step 3 ticked, "Tally’s connection is on (port 9002)".
  4. Clash: this login's port held by another login's Tally: whose ("the Tally of <user>"), a free port; never "ask the
     administrator".
  5. Check again: the computers read again; once the beat says this login's Tally answers, the step ticks.
  6. Set but not on yet: close and reopen once.
  7. A port outside 9000-9999 that the bridge reaches (the TallyPrime 7.2 proof: 4125, 8000): done, no warning.
  8. Phone 390: no sideways scroll.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_port_step.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8431
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
AVOID = {9000, 9001, 9009, 9030, 9042, 9043, 9050, 9051, 9060, 9080, 9090, 9091, 9092, 9093, 9094, 9095, 9099}
PC = "SRV02"
UA, UB = PC + "\\made-up-a", PC + "\\made-up-b"
OTHERS = [1950, 2022, 2929, 3543, 9000, 9002] + list(range(9003, 9090, 3))
LATEST = {"setup": {"version": "2.5.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.4.exe", "sha256": "ab" * 32}}
MENU = "In TallyPrime: F1 → Settings → Connectivity → Client/Server configuration → Acts as Both, Port %d, ODBC Yes → Ctrl+A → restart Tally."
MODE = "Your Tally's connection is off. In TallyPrime: F1 Help > Settings > Connectivity > TallyPrime acts as: Both, then close and reopen Tally."
CLASH = "Your Tally cannot take FinCom's connection: port %d is used by another program (on a shared server often another user's Tally). Ask the computer's administrator for a port of your own."
REOPEN = "Your Tally's connection is set but not on yet. Close and reopen Tally once."
G = "#app [data-tsm-guide]"

def adev(ports, why="", say="", tally="open", tport=0):
    d = T.dev(7, PC, "made-up-a", tally=tally, opened=(), version="2.5.4", rec=(), ports=ports,
              beat={"bridgePort": 9101, "windowsUser": UA, "tallyWhy": why, "tallyConnectSay": say, "tallyPort": tport})
    d["info"]["bridges"]["go-7"]["tallyPort"] = tport; return d
def bdev(port=9070):
    d = T.dev(8, PC, "made-up-b", tally="open", opened=("Kestrel Made-Up Limited",), version="2.5.4", rec=(),
              beat={"bridgePort": 9150, "windowsUser": UB, "tallyPort": port}, ports=[{"port": port, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
    d["info"]["bridges"]["go-8"]["tallyPort"] = port; return d
skipped = lambda ps, who="Windows session 2": [{"port": p, "ok": False, "skipped": True, "n": 0, "error": "Tally of " + who, "reason": "another user"} for p in ps]
closed = lambda p: {"port": p, "ok": False, "skipped": False, "n": 0, "error": "Tally is not open (nothing listens on this port)", "reason": "closed"}
up = lambda p: {"port": p, "ok": True, "skipped": False, "n": 0, "error": "", "reason": "open"}

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        for (w, h, tag) in [(1440, 900, "desktop"), (390, 844, "phone")]:
            pg = br.new_page(viewport={"width": w, "height": h}); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            pg.set_default_timeout(8000)
            E = lambda js, *a: pg.evaluate(js, *a)
            n = lambda sel: pg.locator(sel).count()
            txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
            attr = lambda sel, a: pg.get_attribute(sel, a) if pg.locator(sel).count() else None
            A_PINGS = {"9101": TS.ping(9101, True, UA, version="2.5.4", bridgeId="go-7"), "9150": TS.ping(9150, False, UB, version="2.5.4")}
            def scene(devs, pings=A_PINGS):
                E(T.SETUP, [devs, [], [], "owner", ["Acme Made-Up Traders"], True, {}])
                E("() => { window.__linksApi = false; }"); E(TS.EXTRA, [[], [], [], {}, []]); E(TS.PINGS, pings); E(TS.FORGET)
                E("() => { try { localStorage.removeItem('tdsdesk:bridge'); } catch (e) {} if (window.__bridge0) Object.assign(Bridge, window.__bridge0); Bridge.setCfg({key: '', bridgeId: '', url: 'http://127.0.0.1:9100'}); }")
                E(TS.MINE, ["", "", ""]); E("() => { S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; navHome('tally'); }")
                pg.wait_for_timeout(3000)
            st3 = lambda: attr(G + ' [data-tsm-step="3"]', "data-tsm-state")
            now = lambda: txt("#app [data-tsm-now]")
            freeOf = lambda: int((re.search(r"Port (\d+), ODBC", now()) or [0, 0])[1])
            say = tag + ": "

            # ---- 1. the steps in order; no bridge in this login: step 3 not said
            scene([adev([]), bdev()], {"9150": A_PINGS["9150"]})
            keys = E("() => [...document.querySelectorAll('#app [data-tsm-guide] [data-tsm-step]')].map(e => e.getAttribute('data-tsm-step-key'))")
            ok(keys == ["bridge", "tally", "connect", "company", "link", "reading"], say + "the six steps in order, the port third (%s)" % keys)
            ok(attr(G, "data-tsm-guide") == "1" and st3() == "later" and "Port" not in now(), say + "no bridge in this login: step 1 now, step 3 later and not said (%s)" % now()[:80])

            # ---- 2. connection mode off: the menu in one line, a free port, Copy, Check again
            dA = adev([closed(9000)] + skipped([p for p in OTHERS if p != 9000]), why="connection off", say=MODE)
            dB = bdev(9070)
            scene([dA, dB])
            free = freeOf()
            seen = set(OTHERS) | {9070, 9002}
            ok(attr(G, "data-tsm-guide") == "3" and attr(G, "data-tsm-hook") == "mode" and st3() == "now", say + "connection off: step 3 now (%s)" % now()[:80])
            ok(9000 <= free <= 9099 and free not in seen and free not in AVOID, say + "one free port in 9000-9099, none seen on %s, none well-known (%s)" % (PC, free))
            ok(now() == "Step 3: Your Tally’s connection is off. " + MENU % free, say + "TallyPrime's menu in ONE line, the port filled in (%s)" % now())
            ok(txt(G + " [data-tsm-port-copy]") == "Copy %d" % free and n(G + ' .tsm-now-act [data-tsm-go="check"]') == 1, say + "Copy %d and one button, Check again" % free)
            ok("administrator" not in txt(G).lower(), say + "never 'ask the administrator'")
            ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), say + "no sideways scroll (%s)" % E("() => [document.documentElement.scrollWidth, window.innerWidth]"))

            # ---- 5. Check again: the beat now says this login's Tally answers on the free port: ticked
            E("""(p) => { const d = window.__devs[0], b = d.info.beat, me = d.info.bridges['go-7'];
                b.ports.unshift({port: p, ok: true, skipped: false, n: 0, error: '', reason: 'open'}); b.tallyWhy = ''; b.tallyConnectSay = ''; b.tally = true; b.tallyState = 'open'; b.tallyPort = p;
                Object.assign(me, {tallyPort: p, tally: true, tallyState: 'open'}); }""", free)
            r0 = E("window.__reads")
            pg.click(G + ' .tsm-now-act [data-tsm-go="check"]'); pg.wait_for_timeout(2000)
            ok(E("window.__reads") > r0 and st3() == "done" and ("Tally’s connection is on (port %d)" % free) in txt(G), say + "Check again: read again, step 3 ticked on port %d (%s)" % (free, st3()))

            # ---- 3. on a port of its own: ticked, the port said
            scene([adev([up(9002)] + skipped([1950, 2022, 2929, 3543, 9000]), tport=9002), bdev()])
            ok(st3() == "done" and "Tally’s connection is on (port 9002)" in txt(G) and "Port 9" not in now(), say + "already on 9002: step 3 done, no port words (%s)" % now()[:80])

            # ---- 4. clash: this login's 9000 is the Tally of made-up-b
            dA = adev(skipped([9000], "made-up-b") + skipped([1950, 2022, 2929]), why="connection off", say=CLASH % 9000)
            scene([dA, bdev(9000)])
            free = freeOf()
            ok(attr(G, "data-tsm-hook") == "clash" and now().startswith("Step 3: Your Tally’s port 9000 is taken by the Tally of made-up-b, so your Tally takes no connection. Give it a port of its own, %d." % free),
               say + "clash: whose Tally, and a port of its own (%s)" % now()[:160])
            ok(free not in {9000, 1950, 2022, 2929, 9002} and free not in AVOID and (MENU % free) in now() and "administrator" not in txt(G).lower(), say + "clash: a free port, the menu with it, no administrator (%s)" % free)

            # ---- 6. set but not on yet
            scene([adev([closed(9037)], why="connection off", say=REOPEN), bdev()])
            ok(now() == "Step 3: Your Tally’s connection is set but not on yet. Close TallyPrime and open it again once.", say + "set, not on yet: close and reopen once (%s)" % now())

            # ---- 7. a port outside 9000-9999 the bridge reaches: done, no warning
            for other in (4125, 8000):
                scene([adev([up(other)] + skipped([1950, 2022, 2929]), tport=other), bdev()])
                ok(st3() == "done" and ("(port %d)" % other) in txt(G) and "9999" not in txt(G), say + "port %d, the bridge connected: step 3 done, no warning" % other)
            pg.close()
        ok(not errors, "no page errors " + str(errors[:2]))
        br.close()
    srv.shutdown()
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
