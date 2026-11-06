"""python3 run_tally_connect_steps.py - Connect Tally in six live steps for THIS browser's Windows login
(next-tally-connect-steps, 06-Nov-2026; the owner: "still it is very cumbersome to connect tally.. pls give a clear flow..
instructions to connect the tally and their reliability is still a problem"; "all 6 steps are not visible anywhere").
Made-up firm, logins, clients and companies only (run_tally_simple.py's stand-in cloud; nothing real is read or changed).
One shared Windows server SRV01: login A (this browser's, made-up-a) and login B (made-up-b, its Tally on its own port
with Kestrel open). The Tally page's checklist (data-tsm-guide), in A's browser:
   1. no bridge in this login: step 1 now, Download, no administrator; 2. an old bridge (2.5.1): update;
   3. Tally not running in this login; 4. Tally's connection mode off: the exact menu path with a free port;
   5. A's port held by B's Tally: names B, proposes a port no beat on SRV01 uses; never "ask the administrator";
   6. set but not on yet: close and reopen once; 7. Tally open with no company; 8. a company open, not linked: Link;
   9. linked and reading (step 6); and step 6 done (up to date) from the rows;
  10. a laptop (no bridge answers here): where to do the steps, the firm's state, no per-login step;
  11. never B's company, and never the firm's state as A's, in any step; the top bar's Tally icon, its popover and a
      client's box say the same step's words (one source: lib/connectSteps.js), with the way to the steps; drawing the
      page asks nothing of 127.0.0.1 by itself.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_connect_steps.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 9547
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
PC = "SRV01"
UA, UB = PC + "\\made-up-a", PC + "\\made-up-b"
KESTREL = "Kestrel Worldwide Private Limited"   # B's company: never A's
ORBIT, ACME = "Orbit Space", "Acme Traders"
LATEST = {"setup": {"version": "2.5.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.4.exe", "sha256": "cd" * 32}}
MODE = "Your Tally's connection is off. In TallyPrime: F1 Help > Settings > Connectivity > TallyPrime acts as: Both, then close and reopen Tally."
CLASH = "Your Tally cannot take FinCom's connection: port 9000 is used by another program (on a shared server often another user's Tally). Ask the computer's administrator for a port of your own."
REOPEN = "Your Tally's connection is set but not on yet. Close and reopen Tally once."
MENU = "In TallyPrime: F1 → Settings → Connectivity → Client/Server configuration → Acts as Both, Port "

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
        pg.on("console", lambda m: errors.append(m.text[:300]) if m.type == "error" and "could not be drawn" in m.text else None)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(8000)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        attr = lambda sel, a: pg.get_attribute(sel, a) if pg.locator(sel).count() else None
        G = "#app [data-tsm-guide]"
        def scene(devs, cos, clients, pings, how=("", "", "")):
            ids = E(T.SETUP, [devs, cos, [], "owner", clients, True, {}])
            E("() => { window.__linksApi = false; }")
            E(TS.EXTRA, [[], [], [], {}, []])
            E(TS.PINGS, pings)
            E(TS.FORGET)
            E("() => { try { localStorage.removeItem('tdsdesk:bridge'); } catch (e) {} if (window.__bridge0) Object.assign(Bridge, window.__bridge0); Bridge.setCfg({key: '', bridgeId: '', url: 'http://127.0.0.1:9100'}); }")
            E(TS.MINE, list(how)); E("() => { S.view = 'home'; S.coId = null; S.tallyMore = {}; S.tallyGuide = {}; S.tsm = null; navHome('tally'); }")
            pg.wait_for_timeout(3200)
            return ids
        def guide(): return {"now": attr(G, "data-tsm-guide"), "hook": attr(G, "data-tsm-hook"), "login": attr(G, "data-tsm-login"), "say": txt("#app [data-tsm-now]"),
                             "states": E("() => [...document.querySelectorAll('#app [data-tsm-guide] [data-tsm-step]')].map(e => e.getAttribute('data-tsm-state'))"), "all": txt(G)}
        def bdev(opened=(KESTREL,), port=9070):
            d = T.dev(8, PC, "made-up-b", tally="open", opened=opened, version="2.5.4", rec=opened, beat={"bridgePort": 9150, "windowsUser": UB, "tallyPort": port},
                      ports=[{"port": port, "ok": True, "skipped": False, "n": len(opened), "error": "", "reason": "open"}])
            d["info"]["bridges"]["go-8"]["tallyPort"] = port; return d
        def adev(ports, opened=(), why="", say="", tally="open", version="2.5.4"):
            beat = {"bridgePort": 9101, "windowsUser": UA, "tallyWhy": why, "tallyConnectSay": say}
            return T.dev(7, PC, "made-up-a", tally=tally, opened=opened, version=version, rec=opened, beat=beat, ports=ports)
        A_PINGS = {"9101": TS.ping(9101, True, UA, version="2.5.4", bridgeId="go-7"), "9150": TS.ping(9150, False, UB, version="2.5.4")}
        B_ONLY = {"9150": TS.ping(9150, False, UB, version="2.5.4")}
        cos = [{"company": KESTREL, "client_id": None, "device_id": "d0000000-0000-4000-8000-000000000008", "gstin": "", "last_seen": "ago:0.5"}]
        CL = [ORBIT, ACME]
        def never_b(label, g):
            ok("Kestrel" not in g["all"] and "Kestrel" not in txt("#app [data-tsm-head]"), "%s: nothing of B's Tally in the steps (%s)" % (label, g["all"][:160]))

        print("== 1. no FinCom Bridge in this Windows login (only B's answers here)")
        scene([adev([]), bdev()], cos, CL, B_ONLY)
        g = guide()
        ok(g["now"] == "1" and g["states"] == ["now", "later", "later", "later", "later", "later"], "1. step 1 now, the rest later (%s %s)" % (g["now"], g["states"]))
        ok(g["say"] == "Step 1: FinCom Bridge is not running in this Windows login: start it, or install it. Download installs it just for you: no administrator is needed.", "1. the words: %s" % g["say"])
        ok(n(G + " .tsm-now-act [data-tsm-download]") == 1 and n("#app [data-tsm-recheck]") == 1, "1. one Download in the step, and Check again")
        ok(n("#app [data-tsm-head] [data-tsm-bridge-say]") == 0, "1. the header does not say it a second time")
        never_b("1", g)
        E("() => { window.__probed = []; }"); pg.wait_for_timeout(4000)
        ok(len(E("() => window.__probed")) <= 12, "1. step 1 waiting: no look that starts another look (%s)" % E("() => window.__probed"))

        print("== 2. an old bridge (2.5.1) in this login")
        OLD_P = {"9101": TS.ping(9101, None, UA, version="2.5.1", yours=True, bridgeId="go-7"), "9150": TS.ping(9150, False, UB, version="2.5.4")}
        scene([adev([], version="2.5.1"), bdev()], cos, CL, OLD_P, ("linked", "go-7", "d0000000-0000-4000-8000-000000000007"))
        g = guide()
        ok(g["now"] == "1" and g["hook"] == "old" and g["say"] == "Step 1: Your FinCom Bridge is old (2.5.1). Install 2.5.4 to connect this login’s Tally. Download it and run it in this login: it updates in place and keeps its settings." and n(G + " .tsm-now-act [data-tsm-download]") == 1, "2. update: %s" % g["say"])
        never_b("2", g)

        print("== 3. TallyPrime not running in this login")
        skipped_b = {"port": 9070, "ok": False, "skipped": True, "n": 0, "error": "Tally of made-up-b", "reason": "another user"}
        scene([adev([skipped_b], why="no tally running in this login", tally="closed"), bdev()], cos, CL, A_PINGS)
        g = guide()
        ok(g["login"] == "made-up-a" and "This Windows login: made-up-a" in g["all"], "3. which login: %s" % g["login"])
        ok(g["now"] == "2" and g["states"][:2] == ["done", "now"] and g["say"].startswith("Step 2: Open TallyPrime in this Windows login (made-up-a).") and "the Tally of made-up-b, not yours" in g["say"], "3. step 2: %s" % g["say"])
        never_b("3", g)

        print("== 4. Tally's connection mode off")
        own9000 = {"port": 9000, "ok": False, "skipped": False, "n": 0, "error": "Tally is not open (nothing listens on this port)", "reason": "closed"}
        scene([adev([own9000], why="connection off", say=MODE), bdev()], cos, CL, A_PINGS)
        g = guide(); m = re.search(r"Port (\d+), ODBC", g["say"])
        ok(g["now"] == "3" and g["hook"] == "mode" and g["say"].startswith("Step 3: Your Tally’s connection is off. " + MENU) and m and "restart Tally" in g["say"], "4. the menu path: %s" % g["say"])
        ok(m and int(m.group(1)) not in (9000, 9002, 9070) and 9000 <= int(m.group(1)) <= 9099, "4. a free port proposed (%s)" % (m and m.group(1)))
        ok(n(G + " [data-tsm-port-copy]") == 1, "4. Copy the port")
        never_b("4", g)

        print("== 5. this login's port held by another login's Tally")
        held = {"port": 9000, "ok": False, "skipped": True, "n": 0, "error": "Tally of made-up-b", "reason": "another user"}
        dB = bdev(port=9000)
        dB["info"]["beat"]["ports"].append({"port": 9033, "ok": False, "skipped": False, "n": 0, "error": "", "reason": "closed"})
        dA = adev([held, {"port": 9041, "ok": False, "skipped": False, "n": 0, "error": "x", "reason": "closed"}], why="connection off", say=CLASH)
        scene([dA, dB], cos, CL, A_PINGS)
        g = guide(); m = re.search(r"Port (\d+), ODBC", g["say"])
        seen = set()
        for d in (dA, dB):
            for x in d["info"]["beat"]["ports"]: seen.add(int(x["port"]))
            for b in d["info"]["bridges"].values(): seen.add(int(b.get("tallyPort") or 0))
            seen.add(int(d["info"]["beat"].get("tallyPort") or 0))
        ok(g["now"] == "3" and g["hook"] == "clash" and "port 9000 is taken by the Tally of made-up-b" in g["say"], "5. names whose Tally: %s" % g["say"])
        ok(m and int(m.group(1)) not in seen and 9000 <= int(m.group(1)) <= 9099 and ("own, " + m.group(1)) in g["say"], "5. the free port %s is in no beat of SRV01 (%s)" % (m and m.group(1), sorted(seen)))
        ok("administrator" not in g["all"].lower(), "5. never 'ask the administrator'")
        never_b("5", g)
        # the client's box, the icon and its popover: the same step's words
        ids = scene([dA, dB], cos + [{"company": ORBIT, "client_id": "NAME:" + ORBIT, "device_id": dA["id"], "gstin": "", "last_seen": "ago:30"}], CL, A_PINGS)
        g = guide(); say = re.sub(r"^Step 3: ", "", g["say"])
        cn = E("() => JSON.stringify(FCConnectNow())")
        cj = json.loads(cn) if cn and cn != "null" else {}
        ok(cj.get("n") == 3 and cj.get("say") == say, "11. FCConnectNow says the checklist's step (%s)" % cn[:120])
        icon = E("() => { const b = document.querySelector('header.top [data-tally-icon]'); return b ? b.getAttribute('title') : ''; }")
        ok(("Step 3 of 6: " + say[:60]) in icon, "11. the top bar's Tally icon says the same step (%s)" % icon[:160])
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", ids[ORBIT]); pg.wait_for_timeout(1500)
        POP = "header.top .tally-pop"
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector(POP + " [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(600)
        pt = txt(POP)
        ok(("Step 3 of 6: " + say[:60]) in pt and n(POP + " [data-tally-pop-steps]") == 1, "11. the client's Tally box (popover): the same step, See the 6 steps (%s)" % pt[:200])
        lw = E("(c) => { const w = LinkWord(S.companies[c]); return w ? w.line : ''; }", ids[ORBIT])
        ok(lw.startswith("Step 3 of 6: ") and say[:60] in lw, "11. the client's one word (Clients, title chip, Post): the same step (%s)" % lw[:120])
        pg.click(POP + " [data-tally-pop-steps]"); pg.wait_for_timeout(1500)
        ok(n(G) == 1 and attr(G, "data-tsm-guide") == "3", "11. See the 6 steps opens the Tally page's checklist at step 3")

        print("== 6. set but not on yet")
        scene([adev([own9000], why="connection off", say=REOPEN), bdev()], cos, CL, A_PINGS)
        g = guide()
        ok(g["now"] == "3" and g["hook"] == "reopen" and g["say"] == "Step 3: Your Tally’s connection is set but not on yet. Close TallyPrime and open it again once." and n(G + ' [data-tsm-go="check"]') == 1, "6. %s" % g["say"])

        print("== 7. Tally open in this login, no company")
        up = {"port": 9041, "ok": True, "skipped": False, "n": 0, "error": "", "reason": "open"}
        scene([adev([up, skipped_b]), bdev()], cos, CL, A_PINGS)
        g = guide()
        ok(g["now"] == "4" and g["states"][:4] == ["done", "done", "done", "now"] and g["say"].startswith("Step 4: Tally is open, but no company is open in it."), "7. step 4: %s" % g["say"])
        ok("port 9041" in g["all"], "7. step 3 done says the port (%s)" % g["all"][:300])
        never_b("7", g)
        probes = E("() => { window.__probed = []; return 0; }"); pg.wait_for_timeout(4000)
        ok(E("() => window.__probed.length") == 0, "11. the page asks nothing of 127.0.0.1 by itself while drawn (%s)" % E("() => window.__probed"))

        print("== 8. a company open in this login's Tally, not linked")
        ORBIT_CO = "ORBIT SPACE"
        dA8 = adev([up], opened=(ORBIT_CO,))
        c8 = cos + [{"company": ORBIT_CO, "client_id": None, "device_id": dA8["id"], "gstin": "", "last_seen": "ago:0.5"}]
        ids = scene([dA8, bdev()], c8, CL, A_PINGS)
        g = guide()
        ok(g["now"] == "5" and g["say"].startswith("Step 5: “ORBIT SPACE” is open in your Tally.") and n(G + " .tsm-now-act button") == 1, "8. step 5, one button: %s" % g["say"])
        ok("1 company open in your Tally" in g["all"], "8. step 4 done: this login's count only (%s)" % g["all"][:300])
        never_b("8", g)

        print("== 9. linked and reading")
        c9 = cos + [{"company": ORBIT_CO, "client_id": "NAME:" + ORBIT, "device_id": dA8["id"], "gstin": "", "last_seen": "ago:0.5"}]
        scene([dA8, bdev()], c9, CL, A_PINGS)
        g = guide()
        ok(g["now"] == "6" and g["states"][:5] == ["done"] * 5 and g["say"].startswith("Step 6: Reading “ORBIT SPACE”:"), "9. step 6 now: %s" % g["say"])
        done6 = E("""() => { const R = FCTallySimple.rowsFor({}); const rows = R.rows.map(r => r.kind === 'client' && r.o && r.o.w === 'Yes' ? Object.assign({}, r, {l: {w: 'Yes', note: '312 ledgers'}, e: {w: 'Yes', note: 'Till today'}}) : r);
          const cs = FCConnectSteps({rows, extra: R.extra}); return JSON.stringify([cs.now, cs.steps[5].state, cs.steps[5].doneSay]); }""")
        ok(json.loads(done6)[0] is None and "up to date" in done6, "9. up to date: all six done (%s)" % done6)

        print("== 10. a laptop: no bridge answers here")
        scene([adev([up], opened=(ORBIT_CO,)), bdev()], c9, CL, {})
        g = guide(); fw = txt("#app [data-tsm-firm]")
        ok(g["now"] == "laptop" and "Do these steps on the computer or server where TallyPrime runs" in g["all"], "10. where to do them (%s)" % g["all"][:200])
        ok(fw.startswith("For the firm now: 2 FinCom Bridges are connected") and n(G + " [data-tsm-state]") == 0 and n("#app [data-tsm-now]") == 0, "10. the firm's state, no per-login step (%s)" % fw)
        ok(E("() => FCConnectNow()") is None, "10. no login's step said elsewhere on a laptop")
        print("== 12. FinCom Bridge 2.5.3: it switched the connection on, Tally not reopened yet (no Tally running, it says)")
        SAY253 = "FinCom switched on Tally's connection. Close and reopen Tally once."
        P253 = {"9101": TS.ping(9101, True, UA, version="2.5.3", bridgeId="go-7"), "9150": TS.ping(9150, False, UB, version="2.5.4")}
        scene([adev([skipped_b], why="no tally running in this login", say=SAY253, tally="closed", version="2.5.3"), bdev()], cos, CL, P253)
        g = guide()
        ok(g["now"] == "3" and g["hook"] == "reopen" and g["say"] == "Step 3: " + SAY253 and g["states"][:2] == ["done", "done"], "12. 2.5.3's words as step 3, step 2 ticked (%s)" % g["say"])

        print("== 13. FinCom Bridge 2.5.3: no Tally answering, nothing switched: open Tally, or its connection may be off")
        for why in ("no tally running in this login", "another user"):
            scene([adev([skipped_b], why=why, tally="closed", version="2.5.3"), bdev()], cos, CL, P253)
            g = guide(); m = re.search(r"Port (\d+), ODBC", g["say"])
            ok(g["now"] == "2" and g["say"].startswith("Step 2: Open TallyPrime in this Windows login (made-up-a).") and "If TallyPrime is already open here, its connection may be off: " + MENU in g["say"]
               and m and int(m.group(1)) not in (9070, 9002), "13. %s: open TallyPrime, or the menu path with a free port (%s)" % (why, g["say"][:220]))

        print("== 14. connection off on a computer every login shares (tally.ini not changed by FinCom): the menu, and the warning")
        SHARED = "Tally's connection is off. Every user of this computer shares this TallyPrime's settings, so FinCom does not change them: ask the computer's administrator to give each user's Tally its own port."
        dS = adev([own9000], why="connection off", say=SHARED)
        dS["info"]["beat"]["tallyIni"] = [{"path": "C:\\Program Files\\TallyPrime\\tally.ini", "connect": "off; shared by every user of this computer, not changed"}]
        scene([dS, bdev()], cos, CL, A_PINGS)
        g = guide()
        ok(g["now"] == "3" and g["hook"] == "shared" and g["say"].startswith("Step 3: Your Tally’s connection is off. " + MENU) and "changing the port here changes it for all of them" in g["say"] and "administrator" not in g["all"].lower(),
           "14. the menu path, and that the settings are shared by every login (%s)" % g["say"][:260])

        print("== 15. a browser that may not look on this computer (place unknown): the firm's state, no login's step elsewhere")
        scene([adev([up]), bdev()], cos, CL, {})
        E("() => { window.__blk0 = Bridge.blocked; Bridge.blocked = () => true; Object.assign(FCTallySimple.LOCALB, {list: null, busy: false, n: 0, cut: false}); FCTallySimple.lookOnce(); render(); }"); pg.wait_for_timeout(1500)
        pl = E("() => FCTallySimple.placeOf()"); icon = E("() => { const b = document.querySelector('header.top [data-tally-icon]'); return b ? b.getAttribute('title') : ''; }")
        ok(pl == "unknown" and E("() => FCConnectNow()") is None and "Step " not in icon, "15. unknown place: no step said by the icon or a client's box (%s | %s)" % (pl, icon[:120]))
        E("() => { Bridge.blocked = window.__blk0; }")

        print("== 16. a client's box: only Tally closed / not open on this login's own computer key takes the step")
        ORB = ORBIT.upper()
        dP = adev([held], why="connection off", say=CLASH)
        dC = T.dev(9, "PC9", "made-up-c", at="ago:60", tally="open", opened=(), version="2.5.4", rec=(), beat={"bridgePort": 9100, "windowsUser": "PC9\\made-up-c"})
        c16 = cos + [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": dP["id"], "gstin": "", "last_seen": "ago:30"},
                     {"company": "ACME TRADERS", "client_id": "NAME:" + ACME, "device_id": dC["id"], "gstin": "", "last_seen": "ago:90"}]
        ids = scene([dP, dC], c16, CL, A_PINGS)   # (no other login heard now: the link's own computer key reads it)
        sw = E("(c) => FCStallWhy(c, 'ORBIT SPACE')", ids[ORBIT])
        lw = E("(c) => { const w = LinkWord(S.companies[c]); return w ? [w.line, w.port || null, (w.button || {}).label || ''] : null; }", ids[ORBIT])
        ok(sw.startswith("Step 3 of 6: Your Tally’s port 9000 is taken"), "16. own computer key, company not open: the ledger bar says step 3 (%s)" % sw[:120])
        ok(lw and lw[0].startswith("Step 3 of 6: ") and lw[1] is None and lw[2] == "See the 6 steps", "16. the client's word: step 3, no second port, See the 6 steps (%s)" % lw)
        E("() => { const d = window.__devs.find(x => x.info && x.info.computer === 'SRV01' && x.info.user === 'made-up-a'); d.info.beat.paused = true; [TLight.st.devs, TCloud.pane.devices].forEach(L => (L || []).forEach(x => { if (x.id === d.id) x.info.beat.paused = true; })); }")
        sw = E("(c) => FCStallWhy(c, 'ORBIT SPACE')", ids[ORBIT])
        ok(sw.startswith("Reading is paused on "), "16. reading paused: its own words, not the step (%s)" % sw[:120])
        lc = E("(c) => { const w = LinkWord(S.companies[c]); return w ? [w.kind, w.line] : null; }", ids[ACME])
        sc = E("(c) => FCStallWhy(c, 'ACME TRADERS')", ids[ACME])
        ok(lc and not lc[1].startswith("Step ") and not sc.startswith("Step "), "16. another computer offline: its own words, never this login's step (%s | %s)" % (lc, sc[:100]))
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", ids[ORBIT]); pg.wait_for_timeout(1500)
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector("header.top .tally-pop [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(500)
        if n("header.top .tally-pop [data-link-status-go]"): pg.click("header.top .tally-pop [data-link-status-go]"); pg.wait_for_timeout(1500)
        else: pg.click("header.top .tally-pop [data-tally-pop-steps]"); pg.wait_for_timeout(1500)
        ok(n(G) == 1 and E("() => S.view") == "home", "16. See the 6 steps opens the Tally page's steps")
    print("\npage errors: %s" % errors[:5])
    ok(not errors, "no page errors")
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
