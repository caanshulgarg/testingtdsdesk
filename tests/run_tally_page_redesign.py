"""python3 run_tally_page_redesign.py [--shots DIR] - the Tally page, redesigned (next-tally-page-redesign, 07-Nov-2026; the
owner: "please make sure the reconnect button is in that table... currently it's very cluttered... can you redesign"; the
approved design: tallydesign Main / NotConnected / Phone). Made-up firm, logins, clients and companies only (the stand-in
cloud of run_tally_simple.py). Login A (made-up-a) on the shared server SRV01; login B's Tally holds Kestrel (never A's).
   1. the top line: "Connected to Tally", "TallyPrime on port 9041 · 3 companies open · last entry …", Check again.
   2. ONE table "Clients · N" (next-tally-simple2): Client · Tally company | Masters | Entries | Action, one button and
      More ▾. Each row type its one button: linked and open: Update now; linked, its company open nowhere: Check again
      ("Open it in Tally first"; the reason; a close name to link to), Connect again when no bridge is heard; a client whose
      company is open here: Connect; a company open here with a client of its name: Connect; open here, no client: Link; a
      client with nothing: Link. More ▾: Answers (the old answers) and Unlink. Rows that need you shaded.
   3. Update now is never silent: "Asking Tally…" at once, "Reading ledgers: 1,200 of 3,400", the result; nothing in 30 s:
      why in plain words. Books › From Tally's Update now the same.
   4. Advanced (for support): closed; open, everything that was on the page (the day check of every client, the computers,
      this computer, each computer, versions, every bridge, install, activity).
   5. not connected (step 3 of 6): the top says so, the six steps under it.
   6. a phone (390 px): the rows are cards, one 44 px button each, no sideways scroll.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_page_redesign.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 9563
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else ''
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
        pg = br.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2 if SHOTS else 1); pg.on("pageerror", lambda e: errors.append(str(e)))
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
        def scene(devs, cos, clients, pings, how=("", "", ""), books=None):
            ids = E(T.SETUP, [devs, cos, [], "owner", clients, True, books or {}])
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

        up = {"port": 9041, "ok": True, "skipped": False, "n": 3, "error": "", "reason": "open"}
        ORB, NOVA, ZETA, AOLD = "ORBIT SPACE", "NOVA WIDGETS", "ZETA WORKS", "ACME TRADERS 2025-26"
        NOVA_C, LARK = "Nova Widgets", "Larkspur & Co"
        CLx = [ORBIT, ACME, NOVA_C, LARK]
        dA = adev([up], opened=(ORB, NOVA, ZETA))
        c1 = cos + [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"},
                    {"company": AOLD, "client_id": "NAME:" + ACME, "device_id": dA["id"], "gstin": "", "last_seen": "ago:3000"},
                    {"company": NOVA, "client_id": None, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"},
                    {"company": ZETA, "client_id": None, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"}]
        TB = "#app [data-tsm-table]"
        R = lambda name: TB + ' tr[data-tsm-row="%s"]' % name
        def mains(name): return E("(s) => [...document.querySelectorAll(s + ' [data-tpt-main]')].map(b => b.getAttribute('data-tpt-main'))", R(name))
        def shot(name, w, h):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True); pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(600)
            pg.screenshot(path=os.path.join(SHOTS, name), full_page=True)

        print("== 1. the top line")
        ids = scene([dA, bdev()], c1, CLx, A_PINGS)
        top = txt("#app [data-tsm-top]")
        ok(attr("#app [data-tsm-top]", "data-tsm-top") == "up" and txt("#app [data-tsm-top-title]") == "Connected to Tally", "1. 'Connected to Tally' (%s)" % top[:160])
        sub = txt("#app [data-tsm-top-sub]")
        ok(sub.startswith("TallyPrime on port 9041 · 3 companies open"), "1. 'TallyPrime on port 9041 · 3 companies open …' (%s)" % sub)
        ok(n("#app [data-tsm-top] [data-tsm-top-check]") == 1 and "Kestrel" not in top and "made-up" not in top, "1. Check again; nothing of B's, no login name")
        ok(n("#app [data-tsm-guide]") == 0 or attr("#app [data-tsm-guide]", "data-tsm-guide") not in ("1", "2", "3", "4"), "1. connected: the six steps are not on the page")

        print("== 2. one table, one button a row")
        ok(n(TB) == 1 and txt(TB + " .tpt-title").startswith("Clients · ") and n("#app [data-tsm-filter]") == 0, "2. one table, 'Clients · N', no filter chips (%s)" % txt(TB + " .tpt-title"))
        heads = E("() => [...document.querySelectorAll('#app [data-tsm-table] thead th')].map(t => t.textContent.trim())")
        # next-tally-simple2: Client · Tally company | Masters | Entries | Action (the state under the client)
        ok(heads == ["Client · Tally company", "Masters", "Entries", "Action"], "2. the columns (%s)" % heads)
        for name, want in ((ORBIT, ("update", "reading")), (ACME, ("again",)), (NOVA_C, ("connect",)), (ZETA, ("link",)), (LARK, ("link",))):
            m = mains(name)
            ok(len(m) == 1 and m[0] in want, "2. %s: exactly one button, %s (%s)" % (name, "/".join(want), m))
            ok(txt(R(name) + " [data-tpt-open]") == "More ▾", "2. %s: and its More ▾" % name)
        ok(n(R(ACME) + ".tpt-need") == 1 and txt(R(ACME) + " [data-tpt-state]").startswith("Not open in Tally"), "2. Acme Traders: shaded, Not open in Tally (the firm's bridge online) (%s)" % txt(R(ACME) + " .tpt-state")[:120])
        ok(txt(R(ACME) + " [data-tsm-away-again]") == "Check again" and txt(R(ACME) + " [data-tpt-note]") == "Open it in Tally first", "2. Check again for the linked client not open (the reconnect button, in the table), Open it in Tally first")
        ok(attr(R(ORBIT) + " [data-tpt-dot]", "data-tpt-dot") in ("ok", "read", "warn") and "Kestrel" not in txt(TB), "2. Orbit Space: its state with a dot; never B's company")
        # More ▾ › Answers: the old answers (linked, open now, ledgers, entries, what to do)
        LR = TB + ' tr[data-tpt-light-of="%s"]' % ORBIT
        pg.click(R(ORBIT) + " [data-tpt-open]"); pg.wait_for_timeout(300)
        ok(n(LR + " [data-tpt-unlink]") == 1 and n(LR + " [data-tpt-details]") == 1, "2. More ▾: Answers and Unlink")
        pg.click(LR + " [data-tpt-details]"); pg.wait_for_timeout(500)
        ok(all(n(LR + ' [data-tsm-details] [data-tsm-col="%s"]' % k) == 1 for k in ("c", "o", "l", "e", "do")), "2. Answers: Linked, Open now, Ledgers, Entries, What to do")
        E("() => { S.tsm.details = {}; S.tsm.more = ''; render(); }"); pg.wait_for_timeout(300)
        # Check again (Connect again): looks again and says what is missing
        pg.click(R(ACME) + " [data-tsm-away-again]"); pg.wait_for_timeout(2500)
        w = txt(R(ACME) + " .tpt-why")
        ok("is not open in Tally" in w or w.startswith("Step "), "2. Connect again: the plain reason (%s)" % w[:140])
        shot("tally-redesign-desktop.png", 1280, 900)

        print("== 3. Update now is never silent")
        cid = ids[ORBIT]
        E("() => { window.__ask = 0; window.__askO = Ledgers.askTally; Ledgers.askTally = function () { window.__ask++; return new Promise(() => {}); }; }")   # (the bridge does not answer yet)
        E("() => { S.tcoSync = {}; render(); }"); pg.wait_for_timeout(400)
        if n(R(ORBIT) + ' [data-tpt-main="update"]'):
            pg.click(R(ORBIT) + ' [data-tpt-main="update"]'); pg.wait_for_timeout(300)
            # (next-tally-simple2, review 5: the read's words in the Masters cell; the client cell just "● Updating")
            ok(txt(R(ORBIT) + " [data-tpg-ms]").startswith("Asking Tally…") and mains(ORBIT) == ["reading"] and txt(R(ORBIT) + " [data-tpt-state]") == "Updating" and n(R(ORBIT) + " .tpt-why") == 0,
               "3. at once: 'Asking Tally…' (Masters), '● Updating', the button Reading… (%s | %s)" % (txt(R(ORBIT) + " [data-tpg-masters]"), mains(ORBIT)))
        else: ok(False, "3. Orbit Space's Update now (%s)" % mains(ORBIT))
        E("() => { Ledgers.askTally = window.__askO; }")
        # the read on its way: its count
        E("""(c) => { const x = S.tcoSync[c] || (S.tcoSync[c] = {cid: c, at: Date.now(), samples: []}); FCRunState[c] = Object.assign(FCRunState[c] || {b: {n: 0, g: 0}}, {at: x.at, asking: false, say: ''});
          x.via = 'cloud'; x.prog = {round: 'r1', read: 1200, of: 3400, done: false, at: new Date().toISOString()}; render(); }""", cid); pg.wait_for_timeout(1300)
        ok(txt(R(ORBIT) + " [data-tpg-ms]").startswith("1,200 of 3,400 ledgers") and n(R(ORBIT) + " .tpt-why") == 0, "3. '1,200 of 3,400 ledgers', once, in Masters (%s)" % txt(R(ORBIT) + " [data-tpg-masters]"))
        # nothing from the bridge in 30 s: why
        E("(c) => { const x = S.tcoSync[c]; x.prog = null; x.at -= 31000; FCRunState[c].at = x.at; x.why = 'Tally is not open on SRV01: open TallyPrime there with ORBIT SPACE.'; render(); }", cid); pg.wait_for_timeout(1300)
        ok(txt(R(ORBIT) + " [data-tpg-ms]").startswith("Not started yet: Tally is not open on SRV01") and attr(R(ORBIT) + " [data-tpg-masters]", "data-tpg-masters") == "waiting", "3. nothing in 30 s: why, plainly, Masters waiting (%s)" % txt(R(ORBIT) + " [data-tpg-masters]"))
        # FinCom Bridge 2.5.5: the beat says why it waits (keepWait): its words, amber, with since; the top line too
        KW = "Waiting: someone is working in Tally on this computer. Reading starts once Tally has had no typing or clicks for 15 s."
        SETKW = """(kw) => { const set = (L) => (L || []).forEach(d => { if (d && d.info && d.info.user === 'made-up-a' && d.info.beat) { if (kw) d.info.beat.keepWait = kw; else delete d.info.beat.keepWait; } });
          set(window.__devs); set(TLight.st.devs); set(TCloud.pane.devices); render(); }"""
        E(SETKW, {"reason": "user-active", "words": KW, "since": "2026-11-07T06:12:00Z", "queued": True}); pg.wait_for_timeout(1300)
        w = txt(R(ORBIT) + " [data-tpg-ms]")
        ok(KW in w and "warn" in (attr(R(ORBIT) + " [data-tpg-mw]", "class") or "") and n(R(ORBIT) + " .tpt-why") == 0, "3. bridge 2.5.5's keepWait: its words, amber, in Masters (%s)" % w)
        ok(txt("#app [data-tsm-top-wait]") == KW + " (since 11:42)", "3. and in the top line (%s)" % txt("#app [data-tsm-top-wait]"))
        E(SETKW, None); pg.wait_for_timeout(1300)
        ok(txt(R(ORBIT) + " [data-tpg-ms]").startswith("Not started yet: ") and n("#app [data-tsm-top-wait]") == 0, "3. an older bridge (no keepWait): the 30 s reason again (%s)" % txt(R(ORBIT) + " [data-tpg-masters]"))
        # done: the result
        E("(c) => { const x = S.tcoSync[c]; x.why = ''; x.prog = {round: 'r1', read: 3400, of: 3400, done: true, at: new Date().toISOString()}; x.ledAt = Date.now(); x.end = Date.now(); render(); }", cid); pg.wait_for_timeout(2500)
        res = txt(R(ORBIT) + " .tpt-why")
        ok(res.startswith("Updated") or res.startswith("Not updated: "), "3. the result in words (%s)" % res)
        # Books › From Tally: the same, at once
        E("(c) => { S.tcoSync = {}; delete FCRunState[c]; window.__askO2 = Ledgers.askTally; Ledgers.askTally = () => new Promise(() => {}); location.hash = '#/c/' + encodeURIComponent(c) + '/from-tally'; if (typeof Route === 'object' && Route.apply) Route.apply(location.hash); }", cid); pg.wait_for_timeout(3500)
        if n("#app [data-masters-update]"):
            pg.click("#app [data-masters-update]"); pg.wait_for_timeout(300)
            ok(txt("#app [data-masters-progress]").startswith("Asking Tally…"), "3. From Tally's Update now: 'Asking Tally…' at once (%s)" % txt("#app [data-masters]")[:160])
            E("(c) => { const x = S.tcoSync[c]; if (x) { x.via = 'cloud'; FCRunState[c].asking = false; FCRunState[c].at = x.at; } }", cid)
            E(SETKW, {"reason": "user-active", "words": KW, "since": "2026-11-07T06:12:00Z", "queued": True}); pg.wait_for_timeout(1300)
            ok(txt("#app [data-masters-progress]") == KW + " (since 11:42)", "3. From Tally: keepWait's words too (%s)" % txt("#app [data-masters-progress]"))
            E(SETKW, None)
        else: ok(False, "3. From Tally's Update now (%s)" % txt("#app [data-upload-page]")[:160])
        E("() => { Ledgers.askTally = window.__askO2; S.tcoSync = {}; }")

        print("== 4. Advanced (for support): closed, and everything in it")
        scene([dA, bdev()], c1, CLx, A_PINGS)
        ok(n("#app [data-for-support]") == 1 and n("#app [data-support-body]") == 0 and "Advanced (for support)" in txt("#app [data-for-support]"), "4. Advanced (for support), closed")
        pg.click("#app [data-support-toggle]"); pg.wait_for_timeout(800)
        ok(n("#app [data-support-body] [data-tsm-check]") == 1 and n("#app [data-support-body] [data-tsm-pcs]") == 1, "4. the day check of every client and the computers")
        ok(n("#app [data-support-body] [data-page-more]") == 1, "4. every support tool")
        if n("#app [data-page-more] [data-more-toggle=page]"): pg.click("#app [data-page-more] [data-more-toggle=page]"); pg.wait_for_timeout(800)
        for sel, what in (("[data-tally-tab=activity]", "sync activity"), ("[data-tally-tab=sent]", "everything sent"), ("[data-guide-again]", "install on another computer"), ("[data-help-part=versions]", "versions"), ("[data-help-part=this-computer]", "this computer")):
            ok(n("#app [data-support-body] " + sel) >= 1, "4. in it: " + what)

        print("== 5. not connected: the top says so, the six steps under it")
        own9000 = {"port": 9000, "ok": False, "skipped": False, "n": 0, "error": "Tally is not open (nothing listens on this port)", "reason": "closed"}
        scene([adev([own9000], why="connection off", say=MODE), bdev()], c1, CLx, A_PINGS)
        ok(txt("#app [data-tsm-top-title]") == "Not connected yet: step 3 of 6" and attr("#app [data-tsm-guide]", "data-tsm-guide") == "3", "5. 'Not connected yet: step 3 of 6', the six steps (%s)" % txt("#app [data-tsm-top]")[:120])
        ok(E("() => { const a = document.querySelector('#app [data-tsm-top]'), b = document.querySelector('#app [data-tsm-guide]'); return !!a && !!b && !!(a.compareDocumentPosition(b) & 4); }"), "5. the steps under the top line")
        shot("tally-redesign-notconnected.png", 1280, 900)

        print("== 7 (the owner: 'I can't see the bridge download button'). Download FinCom Bridge, in sight")
        vis = lambda sel: E("(s) => [...document.querySelectorAll(s)].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })", sel)
        scene([adev([]), bdev()], c1, CLx, B_ONLY)
        ok(attr("#app [data-tsm-guide]", "data-tsm-guide") == "1" and vis("#app [data-tsm-guide] [data-tsm-download]"), "7. no bridge in this login: step 1 with a visible Download FinCom Bridge")
        OLD_P = {"9101": TS.ping(9101, None, UA, version="2.5.1", yours=True, bridgeId="go-7"), "9150": TS.ping(9150, False, UB, version="2.5.4")}
        scene([adev([], version="2.5.1"), bdev()], c1, CLx, OLD_P, ("linked", "go-7", "d0000000-0000-4000-8000-000000000007"))
        ok(attr("#app [data-tsm-guide]", "data-tsm-hook") == "old" and vis("#app [data-tsm-guide] [data-tsm-download]"), "7. an outdated bridge: step 1 with the Download (%s)" % txt("#app [data-tsm-now]")[:120])
        P253 = {"9101": TS.ping(9101, True, UA, version="2.5.3", bridgeId="go-7"), "9150": TS.ping(9150, False, UB, version="2.5.4")}
        scene([adev([up], opened=(ORB, NOVA, ZETA), version="2.5.3"), bdev()], c1, CLx, P253)
        if n("#app [data-tsm-steps-link]"): pg.click("#app [data-tsm-steps-link]"); pg.wait_for_timeout(600)
        else: E("() => { S.tsm = Object.assign(S.tsm || {}, {open: true}); render(); }"); pg.wait_for_timeout(600)
        ok(vis("#app [data-tsm-guide] [data-tsm-step='1'] [data-tsm-step-dl] [data-tsm-download]"), "7. the six steps: step 1 done, its Download still there (%s)" % txt("#app [data-tsm-step='1']")[:120])
        if not n("#app [data-support-body]"): pg.click("#app [data-support-toggle]"); pg.wait_for_timeout(800)
        ok(n("#app [data-support-body] [data-install-again]") == 1 and "Install again or on another computer" in txt("#app [data-install-again]") and vis("#app [data-install-again] a, #app [data-install-again] button"),
           "7. Advanced: Install again or on another computer, its Download, without a second fold (%s)" % txt("#app [data-install-again]")[:160])
        scene([adev([up], opened=(ORB,)), bdev()], c1, CLx, {})
        if n("#app [data-tsm-steps-link='laptop']"): pg.click("#app [data-tsm-steps-link='laptop']"); pg.wait_for_timeout(600)
        ok(attr("#app [data-tsm-guide]", "data-tsm-guide") == "laptop" and vis("#app [data-tsm-laptop-dl] [data-tsm-download]"), "7. no bridge answers in this browser, Connect Tally on this computer: the Download right on the card (%s)" % txt("#app [data-tsm-guide]")[:160])

        print("== 8 (the owner: 'Check Tally is not working… after refresh it connected'). Check again reconnects, no reload")
        dOff = adev([up], opened=(ORB, NOVA, ZETA)); dOff["last_seen"] = "ago:600"; dOff["info"]["beat"]["at"] = "ago:600"
        for b in dOff["info"]["bridges"].values(): b["at"] = "ago:600"
        scene([dOff, bdev()], c1, CLx, B_ONLY)
        ok(txt("#app [data-tsm-top-title]").startswith("Not connected yet: step 1"), "8. the bridge not reachable: not connected, step 1 (%s)" % txt("#app [data-tsm-top-title]"))
        loads = E("() => performance.getEntriesByType('navigation').length + ':' + (window.__navMark = Math.random())")
        E("""() => { const t = new Date().toISOString(), d = window.__devs.find(x => x.info && x.info.user === 'made-up-a');
          d.last_seen = t; d.info.beat.at = t; Object.values(d.info.bridges || {}).forEach(b => { b.at = t; }); }""")
        E(TS.PINGS, A_PINGS)
        WATCH = """() => { window.__seen = []; const mo = new MutationObserver(() => { const b = document.querySelector('#app [data-tsm-top-check]'); if (b) window.__seen.push(b.innerText.trim()); });
          mo.observe(document.getElementById('app'), {subtree: true, childList: true, characterData: true}); window.__mo8 = mo; }"""
        E(WATCH)
        pg.click("#app [data-tsm-top-check]")
        try: pg.wait_for_function("() => { const t = document.querySelector('#app [data-tsm-top-title]'); return t && t.innerText.trim() === 'Connected to Tally'; }", timeout=8000); con = True
        except Exception: con = False
        ok(con and E("() => window.__navMark") is not None, "8. the bridge reachable now, Check again: Connected, without a reload (%s)" % txt("#app [data-tsm-top]")[:160])
        ok("Checking…" in E("() => window.__seen"), "8. Checking… while it looks")
        ok(re.match(r"Checked \d\d:\d\d: ", txt("#app [data-tsm-top-checked]")) and "This computer's FinCom Bridge is connected" in txt("#app [data-tsm-top-checked]"), "8. and says what it found (%s)" % txt("#app [data-tsm-top-checked]"))
        # the owner's case: this browser paired with its bridge, which did not answer when the page opened (Bridge.st: down)
        # and answers now; its beat in the cloud not new yet. Before: Check again never asked the bridge's status again
        scene([dOff, bdev()], c1, CLx, B_ONLY)
        E("""([ua, co]) => { const B = window.__bridge0 = window.__bridge0 || {on: Bridge.on, up: Bridge.up, cfg: Bridge.cfg, refresh: Bridge.refresh};
          const c = {url: 'http://127.0.0.1:9101', key: 'made-up-key', follow: false, port: 0, bridgeId: 'go-7'};
          window.__up = false; window.__refreshes = 0;
          Bridge.cfg = () => c; Bridge.on = () => true; Bridge.up = () => window.__up;
          Bridge.refresh = async () => { window.__refreshes++; Bridge.st = window.__up ? {state: 'ok', sessions: [{port: 9041, ok: true, mine: true, companies: [co]}], open: [{name: co, port: 9041, mine: true}], tallyUp: true,
            version: '2.5.4', user: ua, sameSession: true, tallyWhy: '', at: Date.now(), mode: 'auto'} : {state: 'down', sessions: [], open: [], at: Date.now(), error: 'not answering'}; return Bridge.st; };
          Bridge.refresh(); render(); }""", [UA, ORB]); pg.wait_for_timeout(1500)
        t0 = txt("#app [data-tsm-top-title]")
        ok(t0.startswith("Not connected yet"), "8b. paired bridge not answering at the start: not connected (%s)" % t0)
        E("() => { window.__up = true; }"); E(TS.PINGS, A_PINGS); pg.wait_for_timeout(2500)
        r0 = E("() => window.__refreshes")
        pg.click("#app [data-tsm-top-check]")
        try: pg.wait_for_function("() => { const t = document.querySelector('#app [data-tsm-top-title]'); return t && t.innerText.trim() === 'Connected to Tally'; }", timeout=8000); con = True
        except Exception: con = False
        ok(con and E("() => window.__refreshes") > r0, "8b. Check again asks the bridge's status again: Connected, no reload (%s; status asked %s)" % (txt("#app [data-tsm-top-title]"), E("() => window.__refreshes") - r0))
        E("() => { if (window.__bridge0) Object.assign(Bridge, window.__bridge0); }")

        print("== 9 (the owner's Mac: '0 clients are fine. 8 need you', a blank area). No bridge here, the office's 2 bridges online with the companies open")
        NW = "NW144"
        o1 = T.dev(5, NW, "made-up-o1", tally="open", opened=(ORB,), version="2.5.4", rec=(ORB,), beat={"bridgePort": 9101, "windowsUser": NW + "\\made-up-o1"},
                   ports=[{"port": 9041, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
        o2 = T.dev(6, NW, "made-up-o2", tally="open", opened=(NOVA,), version="2.5.4", rec=(NOVA,), beat={"bridgePort": 9102, "windowsUser": NW + "\\made-up-o2"},
                   ports=[{"port": 9043, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
        c9 = [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": o1["id"], "gstin": "", "last_seen": "ago:0.5"},
              {"company": NOVA, "client_id": "NAME:" + NOVA_C, "device_id": o2["id"], "gstin": "", "last_seen": "ago:0.5"},
              {"company": "LARKSPUR CO", "client_id": "NAME:" + LARK, "device_id": o1["id"], "gstin": "", "last_seen": "ago:3000"}]
        scene([o1, o2], c9, [ORBIT, NOVA_C, LARK], {}, books={ORBIT: T.book(ORBIT), NOVA_C: T.book(NOVA_C)})
        ok(txt("#app [data-tsm-top-title]") == "Connected through the office Tally (Tally open in 2 of 2 bridges)", "9. the top line: through the office Tally, Tally open in 2 of 2 bridges (%s)" % txt("#app [data-tsm-top]")[:160])
        ok(n("#app [data-tsm-guide]") == 0 and txt("#app [data-tsm-steps-link='laptop']") == "How to connect", "9. the six steps folded: 'How to connect'")
        sts = {nm: attr(R(nm) + " [data-tpt-state]", "data-tpt-state") for nm in (ORBIT, NOVA_C)}
        ok(all(v in ("ok", "reading") for v in sts.values()) and n(R(ORBIT) + ".tpt-need") + n(R(NOVA_C) + ".tpt-need") == 0, "9. both clients open in the office's Tally fine or reading, not 'needs you' (%s)" % sts)
        ok(all(mains(nm) in (["update"], ["reading"]) for nm in (ORBIT, NOVA_C)), "9. each its Update now (%s)" % [mains(nm) for nm in (ORBIT, NOVA_C)])
        ok("this Windows login" not in txt(TB) and "on the Tally computer" in txt(R(LARK) + " .tpt-why"), "9. no bridge here: a company open nowhere, 'on the Tally computer', never 'this Windows login' (%s)" % txt(R(LARK) + " .tpt-why"))
        shot("tally-redesign-nobridge.png", 1280, 900)
        pg.set_viewport_size({"width": 1440, "height": 900})
        pg.click("#app [data-tsm-steps-link='laptop']"); pg.wait_for_timeout(600)
        gap = E("""() => { const g = document.querySelector('#app [data-tsm-guide]'); if (!g) return -1; const a = g.querySelector('[data-tsm-laptop]'), b = g.querySelector('[data-tsm-laptop-here]');
          return a && b ? Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom) : -1; }""")
        ok(0 <= gap <= 40, "9. opened: no blank area between its lines (%s px)" % gap)

        print("== 10 (Sentry FINCOM-APP-STAGING-K: opening Advanced ran 2.2 s of script). 10 bridges, 500 history rows, 500 companies seen: no task over 300 ms")
        big = [adev([up], opened=(ORB, NOVA, ZETA))]
        for i in range(10):
            d = T.dev(i % 9 + 1, "PC%02d" % i, "made-up-u%d" % i, tally="open", opened=("BIG CO %03d" % i,), version="2.5.4", rec=("BIG CO %03d" % i,), beat={"bridgePort": 9110 + i, "windowsUser": "PC%02d\\made-up-u%d" % (i, i)})
            d["id"] = "d0000000-0000-4000-8000-0000000001%02d" % i; d["name"] = "PC%02d" % i
            d["info"]["history"] = [{"at": "ago:%d" % (k * 2 + 1), "to": "ago:%d" % (k * 2), "kind": "bridge" if k % 2 else "tally", "state": "offline" if k % 3 else "online"} for k in range(50)]
            big.append(d)
        cbig = c1 + [{"company": "SEEN COMPANY %03d PVT LTD" % k, "client_id": None, "device_id": big[1 + k % 10]["id"], "gstin": "", "last_seen": "ago:%d" % (60 + k)} for k in range(500)]
        scene(big, cbig, CLx + ["Client %03d" % k for k in range(60)], A_PINGS)
        LT = """() => { window.__lt = []; try { const po = new PerformanceObserver((l) => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))); po.observe({type: 'longtask', buffered: false}); window.__po = po; } catch (e) { window.__lt = null; } }"""
        E(LT)
        pg.click("#app [data-support-toggle]"); pg.wait_for_timeout(3000)
        if n("#app [data-page-more] [data-more-toggle=page]"): pg.click("#app [data-page-more] [data-more-toggle=page]")
        pg.wait_for_timeout(4000)
        lt = E("() => window.__lt")
        ok(n("#app [data-support-body] [data-bridge-more]") == 1 and n("#app [data-staged-wait]") == 0, "10. Advanced and every support tool drawn in full")
        ok(lt is not None and (max(lt) if lt else 0) < 300, "10. the longest task while opening them under 300 ms (%s)" % (sorted(lt or [], reverse=True)[:6]))

        print("== 11 (review of dd9288be4)")
        # 1. a client's "Open Tally page": its row marked, Advanced open, the focus kept (the day check reads the rows as they are)
        ids = scene([dA, bdev()], c1, CLx, A_PINGS)
        E("(c) => { S.tallyFocus = c; S.tallyMore = {}; navHome('tally'); render(); }", ids[ACME]); pg.wait_for_timeout(3000)
        ok(n(TB + " tr[data-focus]") == 1 and attr(TB + " tr[data-focus]", "data-tsm-row") == ACME and n("#app [data-support-body]") == 1, "11.1 from a client: its row marked, Advanced open (%s)" % attr(TB + " tr[data-focus]", "data-tsm-row"))
        E("() => { S.tallyFocus = ''; S.tallyMore = {}; render(); }")
        # 2. a row's one button: the missing days' fetch, the Day Book upload, else Update now
        M = lambda r: E("(r) => FCTallyMain(r)", r)
        base_r = {"kind": "client", "c": {"w": "Yes"}, "o": {"w": "Yes"}, "l": {"w": "Yes"}, "company": ORB, "cid": "x"}
        ok(M(dict(base_r, e={"w": "No"}, need=True, act={"kind": "bring", "label": "Bring missing days"}, todo="Press the button: FinCom brings them from Tally.")) == {"main": "bring", "label": "Bring missing days"}, "11.2 missing days: Bring missing days")
        ok(M(dict(base_r, e={"w": "No"}, need=True, act={"kind": "upload", "label": "Upload Day Book"}, todo="Upload the Day Book for those days.")) == {"main": "upload", "label": "Upload Day Book"}, "11.2 held lines: Upload Day Book")
        ok(M(dict(base_r, e={"w": "Yes"}, act=None, todo="Nothing.")) == {"main": "update", "label": "Update now"}, "11.2 up to date: Update now")
        # 3. a stuck read of a company open in Tally: the read's own reason, never "not open"
        E("(c) => { S.tcoSync = {}; S.tcoSync[c] = {cid: c, company: 'ORBIT SPACE', at: Date.now() - 200000, via: 'cloud', err: 'Could not ask Tally: made-up reason', end: 0, late: false, samples: []}; render(); }", ids[ORBIT]); pg.wait_for_timeout(2500)
        w = txt(R(ORBIT) + " .tpt-why")
        ok(mains(ORBIT) == ["again"] and "made-up reason" in w and "not open" not in w, "11.3 stuck, its company open: the read's own reason (%s)" % w)
        E("() => { S.tcoSync = {}; render(); }")
        # 5. the result only of the read pressed for
        E("""(c) => { const x = S.tcoSync[c] = {cid: c, at: Date.now(), via: 'cloud', samples: [], end: Date.now(), led: 5, ledAt: Date.now()}; FCRunState[c] = {b: {n: 5, g: 1}, at: x.at, say: 'Updated: 3 new', ok: true}; render(); }""", ids[ORBIT]); pg.wait_for_timeout(1300)
        ok(txt(R(ORBIT) + " .tpt-why") == "Updated: 3 new", "11.5 the result of the read pressed for")
        E("(c) => { S.tcoSync[c] = {cid: c, at: Date.now() + 5, via: 'cloud', samples: []}; render(); }", ids[ORBIT]); pg.wait_for_timeout(1300)
        ok("Updated: 3 new" not in txt(R(ORBIT) + " .tpt-why"), "11.5 another read started: the old result is not said (%s)" % txt(R(ORBIT) + " .tpt-why"))
        E("(c) => { S.tcoSync = {}; delete FCRunState[c]; render(); }", ids[ORBIT])
        # 6. another login's wait words never shown: a client of a company in B's Tally (B's beat with keepWait)
        KCO = "Kestrel Co"
        ck = cos[:] ; ck[0] = dict(ck[0], client_id="NAME:" + KCO)
        dB = bdev(); dB["info"]["beat"]["keepWait"] = {"reason": "user-active", "words": "Waiting: someone is working in Tally on this computer.", "since": "2026-11-07T06:12:00Z", "queued": True}
        idk = scene([dA, dB], ck + c1[1:], CLx + [KCO], A_PINGS)
        E("() => { window.__askK = Ledgers.askTally; Ledgers.askTally = () => new Promise(() => {}); S.tcoSync = {}; render(); }"); pg.wait_for_timeout(500)
        if n(R(KCO) + ' [data-tpt-main="update"]'):
            pg.click(R(KCO) + ' [data-tpt-main="update"]'); pg.wait_for_timeout(1300)
            E("(c) => { const x = S.tcoSync[c]; if (x) { x.via = 'cloud'; FCRunState[c].asking = false; FCRunState[c].at = x.at; } render(); }", idk[KCO]); pg.wait_for_timeout(1300)
            ok("someone is working" not in txt(R(KCO)) and n("#app [data-tsm-top-wait]") == 0, "11.6 B's wait words are not said on A's page (%s)" % txt(R(KCO))[:200])
        else: ok(False, "11.6 Kestrel Co's Update now (%s)" % mains(KCO))
        E("() => { Ledgers.askTally = window.__askK; S.tcoSync = {}; }")
        # 10. connected: See the 6 steps stays near Check again
        ok(n("#app [data-tsm-top] [data-tsm-steps-link]") == 1, "11.10 See the 6 steps beside Check again when connected")

        print("== 6. a phone: cards, one 44 px button each, no sideways scroll")
        scene([dA, bdev()], c1, CLx, A_PINGS)
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(1000)
        wide = E("() => document.scrollingElement.scrollWidth")
        ok(wide <= 392, "6. no sideways scroll (%s)" % wide)
        disp = E("(s) => getComputedStyle(document.querySelector(s)).display", R(ORBIT))
        ok(disp == "grid", "6. a row is a card (%s)" % disp)
        hs = E("() => [...document.querySelectorAll('#app [data-tsm-table] [data-tpt-main]')].map(b => Math.round(b.getBoundingClientRect().height))")
        ok(hs and min(hs) >= 44, "6. each button at least 44 px (%s)" % hs)
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, "tally-redesign-phone.png"), full_page=True)
        pg.set_viewport_size({"width": 1440, "height": 900})
    print("\npage errors: %s" % errors[:5])
    ok(not errors, "no page errors")
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
