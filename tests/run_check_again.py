"""python3 run_check_again.py - every Check again (next-fix-check-again, 07-Nov-2026; the owner on mw65mjxc: "Check again is
not working anywhere"). Made-up firm, logins, clients and companies only (the stand-in cloud of run_tally_simple.py).
Each Check again, pressed: "Checking…" at once; this computer looked at again on 127.0.0.1 (the bridge's /ping), the
cloud's beats read again, the page drawn again; then always a line in words, "Checked HH:MM: …", even when nothing changed.
  M. a Mac with no FinCom Bridge, the office's 2 bridges online: the top line, the "Connect Tally on this computer" card,
     a row's Connect again, the top bar's Tally box: "Checked HH:MM: the office Tally is connected (2 bridges, Tally open
     in 2). This computer has no FinCom Bridge."
  M2 (review of 3cfde949f). The Mac's login linked to an office bridge: never "This computer's FinCom Bridge is connected";
     the office's bridges online but Tally closed: "2 bridges online, but Tally is not open"; the browser's block, a look
     still going: said so; the words on the top line go after 3 minutes or when the connection changes; words that
     cannot be worked out: "could not tell, see above"; a part that never answers: the words all the same (no stuck
     Checking…); presses at once: one check; TCloud.rpcAll / restPages: a non-list answer is an error.
  W. a Windows login whose bridge was down when the page opened and answers now: the top line, step 1's Check again, the
     client's Tally box, Books › From Tally's step line: each finds it ("This computer's FinCom Bridge is connected").
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_check_again.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("CHECK_AGAIN_PORT", "9571"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.4.exe", "sha256": "cd" * 32}}
PC, NW = "SRV01", "NW144"
UA = PC + "\\made-up-a"
ORBIT, NOVA_C, LARK = "Orbit Space", "Nova Widgets", "Larkspur & Co"
ORB, NOVA = "ORBIT SPACE", "NOVA WIDGETS"
CHECKED = r"^Checked \d\d:\d\d: "
# what each press did: "Checking…" seen, this computer looked at again, the cloud's beats read again
WATCH = """(on) => { window.__ck = window.__ck || []; if (window.__ckmo) { window.__ckmo.disconnect(); window.__ckmo = null; }
  if (on) { window.__ck = []; window.__seq = []; const mo = new MutationObserver(() => { if (window.__seq.length < 30) window.__seq.push([...document.querySelectorAll('[data-masters-recheck], .tally-pop button')].map((b) => b.textContent + (b.disabled ? '(off)' : '')).join('|'));
      if (!window.__ck.length && /Checking…/.test(document.body.textContent)) window.__ck.push(1); });
    mo.observe(document.body, {subtree: true, childList: true, characterData: true}); window.__ckmo = mo; }
  return {probed: (window.__probed || []).length, reads: window.__reads || 0}; }"""

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
        pg.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        pg.set_default_timeout(8000)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
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
        def press(label, sel, said, want, before=None):
            """click sel; then the words in said (a selector) start "Checked HH:MM: " and hold each of want"""
            if not n(sel): ok(False, "%s: the Check again is there (%s)" % (label, sel)); return
            w0 = E(WATCH, True)
            if before: before()
            E("(s) => { window.__hit = 0; const b = document.querySelector(s); b.addEventListener('click', () => { window.__hit++; }); }", sel)
            pg.click(sel)
            ok(E("() => window.__hit") >= 1, "%s: the press reaches the button (nothing above it takes it)" % label)
            try: pg.wait_for_function("([s, re]) => { const e = document.querySelector(s); return e && new RegExp(re).test(e.innerText.trim()); }", arg=[said, CHECKED], timeout=12000); got = True
            except Exception: got = False
            seen = E("() => window.__ck.length"); w1 = E(WATCH, False)
            words = txt(said)
            ok(seen > 0, "%s: Checking… while it looks%s" % (label, "" if seen else " (the button: %s)" % E("() => window.__seq")))
            ok(got and all(x in words for x in want), "%s: then in words, %s (%s)" % (label, " / ".join(want), words[:220] or "nothing said"))
            ok(w1["probed"] > w0["probed"] and w1["reads"] > w0["reads"], "%s: looked on this computer again and read the cloud again (looks +%d, cloud reads +%d)" % (label, w1["probed"] - w0["probed"], w1["reads"] - w0["reads"]))
            ok(n(sel) == 0 or pg.get_attribute(sel, "disabled") is None, "%s: the button usable again after" % label)

        print("== M. a Mac: no FinCom Bridge here, the office's 2 bridges online")
        o1 = T.dev(5, NW, "made-up-o1", tally="open", opened=(ORB,), version="2.5.4", rec=(ORB,), beat={"bridgePort": 9101, "windowsUser": NW + "\\made-up-o1"},
                   ports=[{"port": 9041, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
        o2 = T.dev(6, NW, "made-up-o2", tally="open", opened=(NOVA,), version="2.5.4", rec=(NOVA,), beat={"bridgePort": 9102, "windowsUser": NW + "\\made-up-o2"},
                   ports=[{"port": 9043, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
        c9 = [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": o1["id"], "gstin": "", "last_seen": "ago:0.5"},
              {"company": NOVA, "client_id": "NAME:" + NOVA_C, "device_id": o2["id"], "gstin": "", "last_seen": "ago:0.5"},
              {"company": "LARKSPUR CO", "client_id": "NAME:" + LARK, "device_id": o1["id"], "gstin": "", "last_seen": "ago:3000"}]
        MAC = ["the office Tally is connected (2 bridges, Tally open in 2).", "This computer has no FinCom Bridge."]
        ids = scene([o1, o2], c9, [ORBIT, NOVA_C, LARK], {}, books={ORBIT: T.book(ORBIT), NOVA_C: T.book(NOVA_C)})
        ok(txt("#app [data-tsm-top-title]") == "Connected through the office Tally (Tally open in 2 of 2 bridges)", "M. the top line: through the office Tally, counted by Tally open (%s)" % txt("#app [data-tsm-top-title]"))
        press("M. the top line's Check again", "#app [data-tsm-top-check]", "#app [data-tsm-top] [data-checked]", MAC)
        pg.click("#app [data-tsm-steps-link='laptop']"); pg.wait_for_timeout(600)
        press("M. Connect Tally on this computer's Check again", "#app [data-tsm-guide] [data-tsm-recheck]", "#app [data-tsm-guide] [data-checked]", MAC)
        LR = '#app [data-tsm-table] tr[data-tsm-row="%s"]' % LARK
        press("M. Connect again (a company open nowhere)", LR + " [data-tsm-away-again]", LR + " [data-checked]", MAC)
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector("header.top .tally-pop [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(500)
        ck = "header.top .tally-pop [data-tally-pop-act=check], header.top .tally-pop [data-tally-pop-recheck]"
        if n(ck): press("M. the top bar's Tally box", ck, "header.top .tally-pop [data-tally-pop-msg]", MAC)
        else: print("      (M. the top bar's Tally box here: no Check again: %s)" % txt("header.top .tally-pop")[:160])
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)

        print("== M2 (review of 3cfde949f)")
        # 1. the Mac's login linked to the office bridge go-5 (tally_member_bridges): that bridge is not this computer's
        scene([o1, o2], c9, [ORBIT, NOVA_C, LARK], {}, how=("linked", "go-5", o1["id"]), books={ORBIT: T.book(ORBIT), NOVA_C: T.book(NOVA_C)})
        ok(E("() => (FCTallySimple.ownBridge() || {}).how") == "linked", "M2. the login's bridge: the member's link (%s)" % E("() => (FCTallySimple.ownBridge() || {}).how"))
        press("M2. linked to an office bridge: the top line", "#app [data-tsm-top-check]", "#app [data-tsm-top] [data-checked]", ["the office Tally is connected (2 bridges, Tally open in 2).", "This computer has no FinCom Bridge: your login uses the office's."])
        ok("This computer's FinCom Bridge is connected" not in txt("#app [data-tsm-top]"), "M2. never 'This computer's FinCom Bridge is connected' for the office's bridge")
        # 3. the top line's words: gone after 3 minutes, gone when the connection changes
        E("() => { S.tsm.said.at -= 181000; render(); }"); pg.wait_for_timeout(400)
        ok(n("#app [data-tsm-top] [data-checked]") == 0, "M2. the top line's words gone after 3 minutes")
        pg.click("#app [data-tsm-top-check]"); pg.wait_for_selector("#app [data-tsm-top] [data-checked]", timeout=12000)
        E("""() => { const t = new Date(Date.now() - 600000).toISOString(); window.__devs.forEach(d => { d.last_seen = t; d.info.beat.at = t; Object.values(d.info.bridges || {}).forEach(b => { b.at = t; }); });
          TLight.st.devs = JSON.parse(JSON.stringify(window.__devs)); TCloud.pane.devices = TLight.st.devs; render(); }"""); pg.wait_for_timeout(500)
        ok(n("#app [data-tsm-top] [data-checked]") == 0, "M2. and as soon as the connection changes (the office's bridges went quiet) (%s)" % txt("#app [data-tsm-top]")[:160])
        # 2. the office's bridges heard, Tally closed on both
        c1s = [T.dev(5, NW, "made-up-o1", tally="closed", opened=(), version="2.5.4", rec=(), beat={"bridgePort": 9101, "windowsUser": NW + "\\made-up-o1"},
                     ports=[{"port": 9041, "ok": False, "skipped": False, "n": 0, "error": "Tally is not open (nothing listens on this port)", "reason": "closed"}]),
               T.dev(6, NW, "made-up-o2", tally="closed", opened=(), version="2.5.4", rec=(), beat={"bridgePort": 9102, "windowsUser": NW + "\\made-up-o2"},
                     ports=[{"port": 9043, "ok": False, "skipped": False, "n": 0, "error": "Tally is not open (nothing listens on this port)", "reason": "closed"}])]
        scene(c1s, c9, [ORBIT, NOVA_C, LARK], {})
        ok(txt("#app [data-tsm-top-title]") == "Office bridges online, but Tally is not open" and E("() => (document.querySelector('#app [data-tsm-top] [data-tpt-dot]') || {}).getAttribute?.('data-tpt-dot')") == "warn",
           "M2. the top line: office bridges online, but Tally is not open, amber (%s)" % txt("#app [data-tsm-top]")[:160])
        say = E("() => FCTallySimple.checkedSay()")
        ok(re.match(CHECKED, say) and "2 bridges online, but Tally is not open." in say and "connected" not in say, "M2. bridges online, Tally closed: not 'connected' (%s)" % say)
        say = E("() => { const L = FCTallySimple.LOCALB, b = L.busy; L.busy = true; try { return FCTallySimple.checkedSay(); } finally { L.busy = b; } }")
        ok("Still looking on this computer." in say, "M2. the look still going: still looking on this computer (%s)" % say)
        say = E("() => { const L = FCTallySimple.LOCALB, p = L.perm; L.perm = 'denied'; try { return FCTallySimple.checkedSay(); } finally { L.perm = p; } }")
        ok("This browser does not let FinCom reach FinCom Bridge on this computer." in say, "M2. the browser blocked this computer: said so (%s)" % say[:160])
        # 4. words that cannot be worked out; a part that never answers
        say = E("""() => { const d = TLight.st.devs; TLight.st.devs = [{id: 'made-up-bad', get info() { throw new Error('made-up'); }}];
          try { return FCTallySimple.checkedSay(); } finally { TLight.st.devs = d; } }""")
        ok(re.match(CHECKED + "could not tell, see above\\.$", say), "M2. words that cannot be worked out: 'could not tell, see above' (%s)" % say)
        E("() => { window.__bref = {on: Bridge.on, refresh: Bridge.refresh}; Bridge.on = () => true; Bridge.refresh = () => new Promise(() => {}); }")
        pg.click("#app [data-tsm-top-check]")
        try: pg.wait_for_selector("#app [data-tsm-top] [data-checked]", timeout=16000); came = True
        except Exception: came = False
        ok(came and txt("#app [data-tsm-top-check]") == "Check again", "M2. the bridge's status never answering: the words all the same, no stuck Checking… (%s)" % txt("#app [data-tsm-top]")[:160])
        E("() => Object.assign(Bridge, window.__bref)")
        # 6. presses at once: one check (the same promise; this computer looked at once)
        r = E("""async () => { window.__probed = []; const a = FCTallySimple.checkAll(), b = FCTallySimple.checkAll(); const same = a === b; await Promise.all([a, b]);
          return {same, looks: window.__probed.length}; }""")
        r1 = E("async () => { window.__probed = []; await FCTallySimple.checkAll(); return window.__probed.length; }")
        ok(r["same"] and r["looks"] == r1, "M2. two presses at once: one check, shared (%s; one press looks %s)" % (r, r1))
        # 5. a list read a thousand rows at a time: an answer that is not a list is an error (the caller says why)
        r = E("""() => { const r0 = TCloud.rpc; let n = 0; const big = Array.from({length: 1000}, (_, i) => ({i}));
          TCloud.rpc = async () => (++n === 1 ? big : {ok: true});
          return Promise.race([TCloud.rpcAll('made_up_list', {}).then((x) => 'rows ' + x.length, (e) => 'error ' + e.message), new Promise((ok) => setTimeout(() => ok('hung'), 3000))])
            .finally(() => { TCloud.rpc = r0; }); }""")
        ok(r == "error not a list: made_up_list", "M2. TCloud.rpcAll: a thousand rows, then an answer that is not a list: an error, not part of the list (%s)" % r)
        r = E("""() => { const a0 = Cloud.api; Cloud.api = async () => ({ok: true});
          return Promise.race([TCloud.restPages('made_up_table?select=*').then((x) => 'rows ' + x.length, (e) => 'error ' + e.message), new Promise((ok) => setTimeout(() => ok('hung'), 3000))])
            .finally(() => { Cloud.api = a0; }); }""")
        ok(r == "error not a list", "M2. TCloud.restPages: the same (%s)" % r)

        print("== W. a Windows login: this computer's bridge down when the page opened, answering now")
        up = {"port": 9041, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}
        def adev():
            d = T.dev(7, PC, "made-up-a", tally="open", opened=(ORB,), version="2.5.4", rec=(ORB,), beat={"bridgePort": 9101, "windowsUser": UA}, ports=[up])
            d["last_seen"] = "ago:600"; d["info"]["beat"]["at"] = "ago:600"
            for b in d["info"]["bridges"].values(): b["at"] = "ago:600"
            return d
        cw = [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": "d0000000-0000-4000-8000-000000000007", "gstin": "", "last_seen": "ago:600"}]
        A_PINGS = {"9101": TS.ping(9101, True, UA, version="2.5.4", bridgeId="go-7")}
        WIN = ["This computer's FinCom Bridge is connected"]
        def comes_up():
            E("""() => { const t = new Date().toISOString(), d = window.__devs.find(x => x.info && x.info.user === 'made-up-a');
              d.last_seen = t; d.info.beat.at = t; Object.values(d.info.bridges || {}).forEach(b => { b.at = t; }); }""")
            E("(p) => { window.__pings = p; }", A_PINGS)
        def down_scene():
            ids = scene([adev()], cw, [ORBIT], {}, books={ORBIT: T.book(ORBIT)})
            return ids
        ids = down_scene()
        ok(txt("#app [data-tsm-top-title]") != "Connected to Tally", "W. not reachable at the start: not connected (%s)" % txt("#app [data-tsm-top-title]"))
        press("W. the top line's Check again", "#app [data-tsm-top-check]", "#app [data-tsm-top] [data-checked]", WIN, before=comes_up)
        ok(txt("#app [data-tsm-top-title]") == "Connected to Tally", "W. and the top line: Connected to Tally (%s)" % txt("#app [data-tsm-top-title]"))
        down_scene()
        sel = "#app [data-tsm-guide] [data-tsm-go=check], #app [data-tsm-guide] [data-tsm-recheck]"
        # (connected, the steps fold away: the words stay, on the top line)
        press("W. step 1's Check again", "#app [data-tsm-guide] [data-tsm-go=check]" if n("#app [data-tsm-guide] [data-tsm-go=check]") else "#app [data-tsm-guide] [data-tsm-recheck]",
              "#app [data-tsm-guide] [data-checked], #app [data-tsm-top] [data-checked]", WIN, before=comes_up)
        # Books › From Tally: its step line shows while this login's step 1-3 is not done: here step 3 (the bridge answers,
        # Tally's connection off), then Tally's connection on
        d3 = T.dev(7, PC, "made-up-a", tally="open", opened=(), version="2.5.4", rec=(), beat={"bridgePort": 9101, "windowsUser": UA, "tallyWhy": "connection off",
                   "tallyConnectSay": "Your Tally's connection is off."}, ports=[{"port": 9000, "ok": False, "skipped": False, "n": 0, "error": "Tally is not open (nothing listens on this port)", "reason": "closed"}])
        ids = scene([d3], [{"company": ORB, "client_id": "NAME:" + ORBIT, "device_id": d3["id"], "gstin": "", "last_seen": "ago:30"}], [ORBIT], A_PINGS, books={ORBIT: T.book(ORBIT)})
        E("(c) => { location.hash = '#/c/' + encodeURIComponent(c) + '/from-tally'; if (typeof Route === 'object' && Route.apply) Route.apply(location.hash); else openCompany(c).then(() => { S.tab = 'books'; S.booksTab = 'import'; render(); }); }", ids[ORBIT])
        pg.wait_for_timeout(4000)
        def tally_on():
            E("""() => { const t = new Date().toISOString(), d = window.__devs[0]; d.last_seen = t; d.info.beat.at = t; d.info.beat.tallyWhy = ''; d.info.beat.tallyConnectSay = '';
              d.info.beat.ports = [{port: 9041, ok: true, skipped: false, n: 1, error: '', reason: 'open'}]; d.info.tally = 'open'; Object.values(d.info.bridges || {}).forEach(b => { b.at = t; }); }""")
        ok(n("#app [data-masters-step]") == 1, "W. Books › From Tally: the step line (%s)" % txt("#app [data-masters]")[:160])
        press("W. Books › From Tally's step line", "#app [data-masters-recheck]", "#app [data-masters] [data-checked]", WIN, before=tally_on)
        ids = down_scene()
        E("(c) => { openCompany(c); }", ids[ORBIT]); pg.wait_for_timeout(2500)
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector("header.top .tally-pop [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(500)
        if n(ck): press("W. the client's Tally box", ck, "header.top .tally-pop [data-tally-pop-msg]", WIN, before=comes_up)
        else: ok(False, "W. the client's Tally box: a Check again (%s)" % txt("header.top .tally-pop")[:160])
        br.close()
    print("errors", errors[:5])
    print("PASSED" if not fails and not errors else "FAILED: %d" % (len(fails) + len(errors)))
    sys.exit(1 if fails or errors else 0)

if __name__ == "__main__":
    main()
