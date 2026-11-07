"""python3 run_tally_basics.py - the basic Tally functions, reliably (next-tally-basics, 06-Nov-2026; the owner: "the masters
in Tally should get updated, and right now I can't tell whether they update or not"; "I can't even tell how many Tallys are
open, which ones, and where and how to connect or link each one"; "next time, do I have to do anything to connect?"; the
port problem of a shared server). Made-up firm, logins, clients and companies only (run_tally_simple.py's stand-in cloud):
one shared Windows server SRV01, login A (this browser's, made-up-a) and login B (made-up-b, its own Tally with Kestrel).
   1. Open in your Tally now (made-up-a): A's Tally and its port, connected; each company open in it: a client matches:
      Connect; none: Link (the picker); never B's company; the old one-company strip is not drawn beside it.
   2. a company linked: the client, Reading / Up to date, Update now.
   3. a client linked but not connected now (its company not open anywhere): Connect again, what is missing in plain
      words; its company open in A's Tally under the next year's name: Link the client to it.
   4. A's Tally running with its connection off / its port held by B's Tally: said on the panel (connection off / port taken).
   5. the port FinCom gives A (option A, the page's part): the same number on every look, whatever A tried before, and
      never a port B's Tally or bridge uses.
   6. the masters' result words: "Updated: 3 new, 1 changed" (FCMastersResult).
   7. the top bar's Tally icon: with this login's step not done, Check again beside See the 6 steps.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_basics.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 9561
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

        HERE_ = "#app [data-tsm-here]"
        up = {"port": 9041, "ok": True, "skipped": False, "n": 2, "error": "", "reason": "open"}
        ORB, NOVA = "ORBIT SPACE", "NOVA WIDGETS"

        print("== 1. Open in your Tally now: A's Tally, its port, each company with its one action")
        ZETA = "ZETA WORKS"
        dA1 = adev([up], opened=(ORB, NOVA, ZETA))
        c1 = cos + [{"company": c, "client_id": None, "device_id": dA1["id"], "gstin": "", "last_seen": "ago:0.5"} for c in (ORB, NOVA, ZETA)]
        ids = scene([dA1, bdev()], c1, CL, A_PINGS)
        t = txt(HERE_)
        ok(n(HERE_) == 1 and t.startswith("Open in your Tally now (made-up-a)") and "1 Tally running in this login" in t, "1. the panel, this login named, how many Tallys (%s)" % t[:160])
        ok(n(HERE_ + ' [data-tsm-here-tally="9041"] [data-tsm-here-tstate="connected"]') == 1 and "port 9041" in t, "1. A's Tally on port 9041, connected")
        ok("Kestrel" not in t, "1. never B's company in A's panel")
        ok(n("#app [data-tsm-strip]") == 0, "1. the one-company strip is not drawn beside the panel")
        # (Connect Tally's step 5 links one company: its button is there only; the panel says so for that company)
        s5 = [c for c in (ORB, NOVA, ZETA) if n(HERE_ + ' [data-tsm-here-co="%s"] [data-tsm-here-step5]' % c)]
        ok(len(s5) == 1 and ("“%s”" % s5[0]) in txt("#app [data-tsm-now]") and n(HERE_ + ' [data-tsm-here-co="%s"] button' % s5[0]) == 0, "6 (review). step 5's company: no second Link in the panel (%s | %s)" % (s5, txt("#app [data-tsm-now]")[:100]))
        others = [c for c in (NOVA, ZETA) if c not in s5]
        ok(ORB not in s5 and attr(HERE_ + ' [data-tsm-here-co="%s"]' % ORB, "data-tsm-here-kind") == "match" and n(HERE_ + ' [data-tsm-here-co="%s"] [data-tsm-here-connect]' % ORB) == 1, "1. ORBIT SPACE: client Orbit Space matches, Connect")
        ok(others and all(attr(HERE_ + ' [data-tsm-here-co="%s"]' % c, "data-tsm-here-kind") == "none" and n(HERE_ + ' [data-tsm-here-co="%s"] [data-tsm-here-link]' % c) == 1 for c in others), "1. %s: no client matches, Link" % others)
        if others:
            pg.click(HERE_ + ' [data-tsm-here-co="%s"] [data-tsm-here-link]' % others[0]); pg.wait_for_timeout(600)
            ok(n(HERE_ + " [data-tsm-here-pick]") == 1, "1. Link opens the client picker (pick a client or + New client)")
        if n(HERE_ + ' [data-tsm-here-co="%s"] [data-tsm-here-connect]' % ORB):
            pg.click(HERE_ + ' [data-tsm-here-co="%s"] [data-tsm-here-connect]' % ORB); pg.wait_for_timeout(2500)
        lk = E("(c) => { const k = typeof tallyLinkOf === 'function' ? tallyLinkOf(S.companies[c]) : null; return k ? k.company || '' : ''; }", ids[ORBIT])
        ok(lk.upper() == ORB, "1. Connect links ORBIT SPACE to client Orbit Space (%s)" % lk)

        print("== 1b (review 5). two of A's Tallys: one answering, one with its connection off; a company with no port known")
        # (the bridge's real shape: the port's reason "closed", the beat's tallyWhy "connection off" for this login's tallyPort;
        # another program on a port, "not tally", is no Tally)
        off43 = {"port": 9043, "ok": False, "skipped": False, "n": 0, "error": "Tally is not open (nothing listens on this port)", "reason": "closed"}
        nt44 = {"port": 9044, "ok": False, "skipped": False, "n": 0, "error": "not TallyPrime", "reason": "not tally"}
        dA1b = adev([up, off43, nt44], opened=(ORB,), why="connection off"); dA1b["info"]["beat"]["tallyPort"] = 9043
        scene([dA1b, bdev()], c1, CL, A_PINGS)
        ok(attr(HERE_ + ' [data-tsm-here-tally="9043"] [data-tsm-here-tstate]', "data-tsm-here-tstate") == "connection off" and n(HERE_ + ' [data-tsm-here-tally="9041"] [data-tsm-here-co="%s"]' % ORB) == 1,
           "1b. 9041 connected with ORBIT SPACE, 9043 listed with its connection off (%s)" % txt(HERE_)[:220])
        ok(n(HERE_ + ' [data-tsm-here-tally="9044"]') == 0, "1b (re-review 3). another program on 9044 ('not tally') is not listed as a Tally")
        up45 = {"port": 9045, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}
        scene([adev([up, up45], opened=(ORB,)), bdev()], c1, CL, A_PINGS)
        ok(n(HERE_ + ' [data-tsm-here-tally="unknown"] [data-tsm-here-co="%s"]' % ORB) == 1 and n(HERE_ + " [data-tsm-here-noco]") == 0 and "port ?" not in txt(HERE_),
           "1b. two answering, the company's port not named: under 'port not known', no false 'No company open' (%s)" % txt(HERE_)[:220])
        scene([adev([], opened=(ORB,)), bdev()], c1, CL, A_PINGS)
        ok(n(HERE_ + ' [data-tsm-here-tally="unknown"] [data-tsm-here-co="%s"]' % ORB) == 1 and n(HERE_ + ' [data-tsm-here-tstate="connected"]') == 0, "1b. a bridge that names no port: the company listed, never 'connected' (%s)" % txt(HERE_)[:200])

        print("== 1c (review 9). another login's bridge record from before, on A's port: not a holder")
        bOld = bdev(port=9041); bOld["info"]["bridges"]["go-8"]["at"] = "ago:600"
        scene([adev([up], opened=(ORB,)), bOld], c1, CL, A_PINGS)
        ok("(port 9041): this login’s own" in guide()["all"], "1c. step 3 done: this login's own port (%s)" % re.findall(r"connection is on[^✓]*", guide()["all"])[:1])

        print("== 2. a company linked: the client, its state, Update now")
        dA = adev([up], opened=(ORB, NOVA))
        c2 = cos + [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"},
                    {"company": NOVA, "client_id": None, "device_id": dA["id"], "gstin": "", "last_seen": "ago:0.5"}]
        ids = ids0 = scene([dA, bdev()], c2, CL, A_PINGS)
        R2 = HERE_ + ' [data-tsm-here-co="%s"]' % ORB
        ok(attr(R2, "data-tsm-here-kind") == "linked" and txt(R2 + " [data-tsm-here-client]") == ORBIT and n(R2 + " [data-tsm-here-update]") == 1, "2. linked: client, Update now (%s)" % txt(R2))
        st = attr(R2 + " [data-tsm-here-state]", "data-tsm-here-state")
        ok(st in ("reading", "done", "need") and re.search(r"Reading…|Up to date|Ledgers|Entries", txt(R2 + " [data-tsm-here-state]")), "2. its state in words (%s: %s)" % (st, txt(R2 + " [data-tsm-here-state]")))
        E("() => { window.__upd = []; window.__tun0 = window.tallyUpdateNow; window.tallyUpdateNow = (c) => window.__upd.push(c); }")
        pg.click(R2 + " [data-tsm-here-update]"); pg.wait_for_timeout(300)
        ok(E("() => window.__upd") == [ids[ORBIT]], "2. Update now asks the existing update for that client (%s)" % E("() => window.__upd"))
        E("() => { window.tallyUpdateNow = window.__tun0; }")

        print("== 3. a client linked but not connected now: Connect again, the reason, and the company open under the next year's name")
        AOLD, ANEW = "ACME TRADERS 2025-26", "ACME TRADERS 2026-27"
        dA3 = adev([up], opened=(ANEW,))
        c3 = cos + [{"company": AOLD, "client_id": "NAME:" + ACME, "device_id": dA3["id"], "gstin": "", "last_seen": "ago:3000"},
                    {"company": ANEW, "client_id": None, "device_id": dA3["id"], "gstin": "", "last_seen": "ago:0.5"}]
        ids = scene([dA3, bdev()], c3, CL, A_PINGS)
        AW = HERE_ + ' [data-tsm-away="%s"]' % ids[ACME]
        ok(n(AW) == 1 and n(AW + " [data-tsm-away-again]") == 1 and AOLD in txt(AW), "3. Acme Traders listed with Connect again (%s)" % txt(HERE_ + " [data-tsm-here-away]")[:200])
        ok(n(AW + ' [data-tsm-away-near="%s"] [data-tsm-away-relink]' % ANEW) == 1, "3. the close name open in A's Tally: Link Acme Traders to it")
        E("() => { window.__probed = []; }")
        pg.click(AW + " [data-tsm-away-again]"); pg.wait_for_timeout(2500)
        why = txt(AW + " [data-tsm-away-why]")
        ok(why.startswith("“ACME TRADERS 2025-26” is not open in your Tally.") or why.startswith("Step "), "3. Connect again: what is missing, plainly (%s)" % why)
        ok(len(E("() => window.__probed || []")) >= 1, "3. Connect again looks again (the shared look of this login's bridge)")
        ok(n(HERE_ + ' [data-tsm-away]') == 1, "3. only the client not connected is listed")

        print("== 8. the client's Tally section (Books › From Tally): the masters' one line, Update now, by itself when")
        dA["info"]["beat"]["changeNumbers"] = {ORB: {"altvchid": 10, "altmstid": 4, "at": "2026-11-06T15:04:05"}}
        scene([dA, bdev()], c2, CL, A_PINGS)
        E("(c) => { location.hash = '#/c/' + encodeURIComponent(c) + '/from-tally'; if (typeof Route === 'object' && Route.apply) Route.apply(location.hash); else openCompany(c).then(() => { S.tab = 'books'; S.booksTab = 'import'; render(); }); }", ids0[ORBIT]); pg.wait_for_timeout(4000)
        M = "#app [data-upload-page] [data-masters]"
        mt = txt(M)
        ok(n(M) == 1 and mt.startswith("Ledgers & groups from Tally:") and "every 10 minutes while the company is open in Tally" in mt, "8. the masters' one line, and when it updates by itself (%s)" % mt[:200])
        ok(n(M + " [data-masters-update]") == 1 or "not linked" in mt or "not in FinCom yet" in mt, "8. one Update now (%s)" % mt[:120])
        ok(n("#app [data-upload-page] [data-up-drop]") == 1, "8. the upload (the fallback) is on the same page")
        ok(n("#app [data-upload-page] [data-tco-masters]") == 0, "8 (review 10). no second masters uploader beside the drop")
        lt = re.search(r"last checked ([^;)]*)", mt)
        ok(lt is not None and re.match(r"^(\d{1,2}-\w{3}-\d{4} )?\d{1,2}:\d\d( ?[ap]m)?$", lt.group(1).strip(), re.I), "8 (review 10). 'last checked' as the IST time (with its day when not today) of the computer's 15:04 (%s)" % (lt and lt.group(1)))
        ok(lt is not None and ("3:04" in lt.group(1) or "15:04" in lt.group(1)), "8 (review 10). the computer's own clock read as IST, not cut from the text")
        # review 4: two presses in a row start one read
        E("() => { S.tcoSync = {}; render(); }"); pg.wait_for_timeout(600)
        E("() => { window.__ask = 0; window.__askO = Ledgers.askTally; Ledgers.askTally = function () { window.__ask++; return window.__askO.apply(this, arguments); }; }")
        E("() => { const b = document.querySelector('#app [data-masters-update]'); if (b) { b.click(); b.click(); } }"); pg.wait_for_timeout(2500)
        ok(E("() => window.__ask") == 1 and attr(M + " [data-masters-update]", "disabled") is not None, "8 (review 4). a double press asks Tally once, the button off while it reads (%s)" % E("() => window.__ask"))
        E("() => { Ledgers.askTally = window.__askO; S.tcoSync = {}; }")

        print("== 8b (review 2). From Tally with this login's step 3 not done: the step's title only, no login name, no port")
        own9000b = {"port": 9000, "ok": False, "skipped": False, "n": 0, "error": "Tally is not open (nothing listens on this port)", "reason": "closed"}
        dA8 = adev([own9000b], why="connection off", say=MODE)
        c8 = cos + [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": dA8["id"], "gstin": "", "last_seen": "ago:30"}]
        ids8 = scene([dA8, bdev()], c8, CL, A_PINGS)
        E("(c) => { location.hash = '#/c/' + encodeURIComponent(c) + '/from-tally'; if (typeof Route === 'object' && Route.apply) Route.apply(location.hash); else openCompany(c).then(() => { S.tab = 'books'; S.booksTab = 'import'; render(); }); }", ids8[ORBIT]); pg.wait_for_timeout(4000)
        pt = txt("#app [data-upload-page]")
        ok(n("#app [data-upload-page] [data-masters-step='3']") == 1 and "Step 3 of 6: Tally’s connection on, with this login’s own port" in pt, "8b. step 3's title, with Check again (%s)" % txt("#app [data-masters-step]"))
        ok("made-up" not in pt and "SRV01" not in pt and not re.search(r"\b9\d{3}\b", pt), "8b. no login name and no port on From Tally (%s)" % (re.findall(r"made-up[\w-]*|\b9\d{3}\b", pt)[:5]))
        dC = T.dev(9, "PC9", "made-up-c", tally="open", opened=(), version="2.5.4", rec=(), beat={"bridgePort": 9100, "windowsUser": "PC9\\made-up-c"})
        c8c = cos + [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": dC["id"], "gstin": "", "last_seen": "ago:30"}]
        ids8 = scene([dA8, dC, bdev()], c8c, CL, A_PINGS)
        E("(c) => { location.hash = '#/c/' + encodeURIComponent(c) + '/from-tally'; if (typeof Route === 'object' && Route.apply) Route.apply(location.hash); else openCompany(c).then(() => { S.tab = 'books'; S.booksTab = 'import'; render(); }); }", ids8[ORBIT]); pg.wait_for_timeout(4000)
        ok(n("#app [data-upload-page] [data-masters]") == 1 and n("#app [data-upload-page] [data-masters-step]") == 0, "8b. a client whose Tally is on another computer: no step of this login (%s)" % txt("#app [data-masters]")[:160])

        print("== 8d (re-review 1). From Tally, a read stuck with this login's step 2 not done: Update now, 30 s, Try again: no login, no port")
        skipped_b2 = {"port": 9070, "ok": False, "skipped": True, "n": 0, "error": "Tally of made-up-b", "reason": "another user"}
        dA2 = adev([skipped_b2], why="no tally running in this login", tally="closed")
        cd = cos + [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": dA2["id"], "gstin": "", "last_seen": "ago:30"}]
        idsd = scene([dA2, bdev()], cd, CL, A_PINGS)
        E("(c) => { S.tcoSync = {}; location.hash = '#/c/' + encodeURIComponent(c) + '/from-tally'; if (typeof Route === 'object' && Route.apply) Route.apply(location.hash); else openCompany(c).then(() => { S.tab = 'books'; S.booksTab = 'import'; render(); }); }", idsd[ORBIT]); pg.wait_for_timeout(4000)
        PG = "#app [data-upload-page]"
        leak = lambda t: re.findall(r"made-up[\w-]*|SRV01|\b9\d{3}\b", t)
        if n(PG + " [data-masters-update]"): pg.click(PG + " [data-masters-update]")
        def later30(c):
            E("(c) => { const x = (S.tcoSync || {})[c]; if (x) { x.at -= 40000; x.moveAt = x.at; x.upAsked = x.upAsked || Date.now(); } }", c); pg.wait_for_timeout(12000)
        pg.wait_for_timeout(2000); later30(idsd[ORBIT])
        w1 = txt(PG + " [data-tco-sync-why]"); p1 = txt(PG)
        ok(bool(w1) and not leak(p1), "8d. after 30 s: the bar's reason without a login name or port (%s | leaks %s)" % (w1[:140], leak(p1)[:4]))
        ok(not w1.startswith("Step ") or (w1.startswith("Step 2 of 6 is not done: TallyPrime running in this login") and n(PG + " [data-tco-sync-steps]") == 1), "8d. a step: its title only, with See the 6 steps (%s)" % w1[:140])
        if n(PG + " [data-tco-sync-again]"):
            pg.click(PG + " [data-tco-sync-again]"); pg.wait_for_timeout(2000); later30(idsd[ORBIT])
            w2 = txt(PG + " [data-tco-sync-why]"); p2 = txt(PG)
            ok(not leak(p2) and (not w2.startswith("Step ") or w2.startswith("Step 2 of 6 is not done: ")), "8d. Try again, 30 s more: still no login name or port (%s | leaks %s)" % (w2[:140], leak(p2)[:4]))
        else: ok(False, "8d. Try again on the stuck bar (%s)" % txt(PG + " [data-masters]")[:200])

        print("== 8c (review 3). Bank: Bring in from Tally, and the Excel ledger list still imported (the old path)")
        ids3 = scene([adev([up]), bdev()], cos, CL, A_PINGS)
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'bank'; render(); }", ids3[ACME]); pg.wait_for_timeout(3000)
        if n("#app [data-led-excel]"):
            E("() => { window.__led = 0; const i = document.getElementById('ledIn'); if (i) { window.__ledC = i.click; i.click = () => { window.__led++; }; } }")
            pg.click("#app [data-led-excel]"); pg.wait_for_timeout(300)
            ok(n("#app [data-go-from-tally]") >= 1 and E("() => window.__led") == 1, "8c. Bank: Bring in from Tally and 'Import ledger list from Excel' (the file box #ledIn)")
            ok((E("() => (document.getElementById('ledIn') || {}).accept") or "").lower().find(".xls") >= 0, "8c. the ledger list box takes Excel (%s)" % E("() => (document.getElementById('ledIn') || {}).accept"))
        else:
            ok(False, "8c. Bank's ledger notice with Import ledger list from Excel (%s)" % txt("#app main")[:200])

        print("== 9. next time: after Windows, the bridge or Tally restarts, it reconnects by itself (no click)")
        dOff = adev([up], opened=(ORB,)); dOff["last_seen"] = "ago:600"; dOff["info"]["beat"]["at"] = "ago:600"
        for b in dOff["info"]["bridges"].values(): b["at"] = "ago:600"
        scene([dOff, bdev()], c2, CL, B_ONLY)
        g0 = guide()
        ok(g0["now"] == "1", "9. the bridge stopped (Windows restarted): step 1 (%s %s)" % (g0["now"], g0["say"][:100]))
        E("""() => { const t = new Date().toISOString(), d = window.__devs.find(x => x.info && x.info.user === 'made-up-a');
          d.last_seen = t; d.info.beat.at = t; Object.values(d.info.bridges || {}).forEach(b => { b.at = t; }); }""")
        E(TS.PINGS, A_PINGS)
        pg.wait_for_timeout(36000)
        g1 = guide()
        ok(g1["now"] != "1" and g1["states"][:4] == ["done"] * 4, "9. its beat back: steps 1-4 done again by themselves, nothing pressed (%s %s)" % (g1["now"], g1["states"]))
        ok(attr(HERE_ + ' [data-tsm-here-co="%s"]' % ORB, "data-tsm-here-kind") == "linked", "9. the linked company is listed as linked again")

        print("== 4. A's Tally running, its connection off, or its port held by B's Tally")
        own9000 = {"port": 9000, "ok": False, "skipped": False, "n": 0, "error": "Tally is not open (nothing listens on this port)", "reason": "closed"}
        scene([adev([own9000], why="connection off", say=MODE), bdev()], cos, CL, A_PINGS)
        ok((attr(HERE_ + ' [data-tsm-here-tally="9000"] [data-tsm-here-tstate]', "data-tsm-here-tstate") == "connection off" or attr(HERE_ + ' [data-tsm-here-tally="off"] [data-tsm-here-tstate]', "data-tsm-here-tstate") == "mode")
           and "connection off" in txt(HERE_), "4. connection off, said on the panel (%s)" % txt(HERE_)[:200])
        held = {"port": 9000, "ok": False, "skipped": True, "n": 0, "error": "Tally of made-up-b", "reason": "another user"}
        scene([adev([held], why="connection off", say=CLASH), bdev(port=9000)], cos, CL, A_PINGS)
        ok(attr(HERE_ + ' [data-tsm-here-tally="off"] [data-tsm-here-tstate]', "data-tsm-here-tstate") == "clash" and "port taken" in txt(HERE_), "4. port taken (%s)" % txt(HERE_)[:200])

        print("== 5. this login's own port: the same number on every look, never B's")
        def proposed(ports, b_port=9070):
            scene([adev(ports, why="connection off", say=MODE), bdev(port=b_port)], cos, CL, A_PINGS)
            m = re.search(r"Port (\d+), ODBC", guide()["say"]); return int(m.group(1)) if m else 0
        p1 = proposed([own9000])
        p2 = proposed([own9000, {"port": p1, "ok": False, "skipped": False, "n": 0, "error": "x", "reason": "closed"}])
        ok(p1 and p1 == p2, "5. the same port after A tried it (%s, %s)" % (p1, p2))
        p3 = proposed([own9000], b_port=p1)
        ok(p3 and p3 != p1, "5. once B's Tally takes it, another one, never B's (%s -> %s)" % (p1, p3))
        p4 = proposed([own9000], b_port=p1)
        ok(p4 == p3, "5. and that one again on the next look (%s)" % p4)

        print("== 6. the masters' result words")
        R = lambda b, a, r: E("([b, a, r]) => FCMastersResult(b, a, r)", [b, a, r])
        E("() => import('/' + (performance.getEntriesByType('resource').map(e => e.name).find(n => /TallyCompanies-[^/]*\\.js$/.test(n)) || '').split('/').slice(3).join('/')).catch(() => null)")
        pg.wait_for_timeout(500)
        if E("() => typeof FCMastersResult") == "function":
            ok(R({"n": 10, "g": 3}, {"n": 13, "g": 3}, 4) == "Updated: 3 new, 1 changed", "6. Updated: 3 new, 1 changed")
            ok(R({"n": 10, "g": 3}, {"n": 10, "g": 3}, 0) == "Updated: no changes in Tally", "6. nothing changed: said so")
            ok(R({"n": 10, "g": 3}, {"n": 10, "g": 4}, 2) == "Updated: 2 changed, 1 new group", "6. groups too")
            full = E("() => FCRoundsOf([{rows_received: 1240, rows_read: 1240, complete: true}])")
            ok(full == {"changed": 0, "full": 1240} and R({"n": 1240, "g": 38}, {"n": 1240, "g": 38}, full) == "Updated: whole list read (1,240 ledgers)", "6 (review 1). a whole round of 1,240: 'whole list read', never '1,240 changed' (%s)" % full)
            mix = E("() => FCRoundsOf([{rows_received: 4, rows_read: 1240, complete: true}, {rows_received: 2, rows_read: null, complete: true}])")
            ok(mix == {"changed": 4, "full": 0} and R({"n": 1239, "g": 38}, {"n": 1240, "g": 38}, mix) == "Updated: 1 new, 3 changed", "6 (review 1). only the rounds that sent the changes count (%s)" % mix)
        else: ok(False, "6. FCMastersResult loaded with the Tally page's code")

        print("== 7. the top bar's Tally icon: Check again beside See the 6 steps")
        scene([adev([]), bdev()], cos, CL, B_ONLY)
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector("header.top .tally-pop [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(500)
        ok(n("header.top .tally-pop [data-tally-pop-steps]") == 1 and n("header.top .tally-pop [data-tally-pop-recheck], header.top .tally-pop [data-tally-pop-act=check]") >= 1, "7. See the 6 steps and Check again (%s)" % txt("header.top .tally-pop")[:200])
        if n("header.top .tally-pop [data-tally-pop-recheck]"):
            pg.click("header.top .tally-pop [data-tally-pop-recheck]"); pg.wait_for_timeout(1500)
            ok(txt("header.top .tally-pop [data-tally-pop-msg]").startswith("Checked at "), "7. Check again says when it looked (%s)" % txt("header.top .tally-pop [data-tally-pop-msg]"))
        print("== 10 (the owner: Books › From Tally is the only place that updates ledgers). The Ledgers page and its unknown-ledgers box: the way there")
        import ledpage_setup as LP
        LP.open_page(pg, "owner")
        ok(n("#app [data-led-read]") == 0 and n("#app [data-unk-read]") == 0, "10. no Read again now, no Read the ledgers now")
        ok(txt("#app [data-led-go='cloud']") == "Update ledgers in Books › From Tally", "10. the status line: 'Update ledgers in Books › From Tally' (%s)" % txt("#app [data-led-status]")[:160])
        ok(txt("#app [data-led-line=unknown] [data-unk-go]") == "Update ledgers in Books › From Tally" and n("#app [data-led-line=unknown] [data-unk-why]") == 1, "10. the unknown-ledgers box: the same link, its reason kept (%s)" % txt("#app [data-led-line=unknown]")[:160])
        E("() => { window.__bridge = window.__bridge || []; }"); b0 = len(E("() => window.__bridge"))
        # (scene 7 left the top bar's Tally popover open; the app's rule (parts/dismiss.js) is that the first click outside an
        # open overlay only closes it. Closed first, as a person would see it, then a real mouse click)
        ov = E("() => [...document.querySelectorAll('header.top .tally-pop, details[open]')].map(e => e.className || e.tagName)")
        print("   open before the click: %s" % ov)
        for _ in range(3):
            if not E("() => !!document.querySelector('header.top .tally-pop')"): break
            pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        ok(not E("() => !!document.querySelector('header.top .tally-pop')"), "10. the popover left open by scene 7 is closed (Esc)")
        pg.click("#app [data-led-go='cloud']"); pg.wait_for_timeout(1500)
        ok(E("() => S.tab === 'books' && booksTab() === 'import'") and n("#app [data-upload-page]") == 1 and len(E("() => window.__bridge")) == b0, "10. the link opens Books › From Tally and asks nothing of Tally by itself")
        ok(n("#app [data-upload-page] [data-masters] [data-masters-update]") == 1, "10. From Tally has the masters' one Update now")
    print("\npage errors: %s" % errors[:5])
    ok(not errors, "no page errors")
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
