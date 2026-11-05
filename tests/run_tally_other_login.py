"""python3 run_tally_other_login.py - FinCom shows only the Tally open in THIS Windows login (next-tally-other-login,
05-Nov-2026; staging, a shared Windows server: a browser in one login, its own FinCom Bridge 2.5.4 answering with its
Tally open and NO company loaded, showed a company open in ANOTHER login's Tally as the one to link a new client to).
Made-up firm, logins, clients and companies only (run_tally_simple.py's stand-in cloud; nothing real is read or changed).
Two Windows logins on one server: A (this browser's, sameSession true, Tally open, no company) and B (another login,
its Tally with Kestrel open). In A's browser:
  1. the simple page says plainly "Tally is open, but no company is open in it." and offers nothing of B's (no strip,
     no row, no step 3);
  2. a new client's Link (the picker, ChangePick): no "Open in Tally now" group with B's company, and the same plain
     line; the Tally icon's Link list (TallyPop) preselects nothing of B's and says the same line;
  3. For support: "Open in Tally now" (also for that client, "Link to <client>") lists none of B's companies; this
     computer's card says "Tally open: no company open";
  4. the top bar's firm sign (tallySignNow) never names B's company, for the client or the firm;
  5. B's own browser: B's company is open in B's Tally (the strip, the picker's "Open in Tally now").
  6. an old bridge (2.5.1, no sameSession) on the same server, this member's own: its companies are never "open in your
     Tally" (another login's Tally may be what it reads); the page says the bridge is old, with Download.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_other_login.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 9541
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
PC = "SRV01"
UA, UB = PC + "\\made-up-a", PC + "\\made-up-b"
KESTREL = "Kestrel Worldwide Private Limited - (from 1-Apr-24) - (from 1-Apr-24)"   # B's, the doubled split suffix as Tally names it
ORBIT, ACME = "Orbit Space", "Acme Traders"
NO_CO = "Tally is open, but no company is open in it."
OLD = "Your FinCom Bridge is old (2.5.1)."
LATEST = {"setup": {"version": "2.5.4", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.4.exe", "sha256": "cd" * 32}}
# this browser's own bridge read here (Bridge.st): A's, its Tally open with no company
LOCAL_UP = """([open, user, bid, port]) => {
  const B = window.__bridge0 = window.__bridge0 || {on: Bridge.on, up: Bridge.up, cfg: Bridge.cfg, refresh: Bridge.refresh};
  const c = {url: 'http://127.0.0.1:' + port, key: 'made-up-key', follow: false, port: 0, bridgeId: bid};
  Bridge.cfg = () => c; Bridge.on = () => true; Bridge.up = () => true; Bridge.refresh = async () => Bridge.st; Bridge.okAt = Date.now() - 50000;
  Bridge.st = {state: 'ok', sessions: [], tallyUp: true, tallyState: 'open', version: '2.5.4', computer: 'SRV01', at: Date.now() - 50000, mode: 'auto', user, sameSession: true,
    beat: {on: true, last: new Date().toISOString()}, open: open.map(n => ({name: n, port: 1646, mine: true}))};
  render();
}"""

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
        def main_text(): return E("() => { const a = document.querySelector('#app').cloneNode(true); a.querySelectorAll('[data-for-support]').forEach(e => e.remove()); return a.innerText; }")
        def scene(devs, cos, clients, own, pings, local=None):
            ids = E(T.SETUP, [devs, cos, [], "owner", clients, True, {}])
            E("() => { window.__linksApi = false; }")
            E(TS.EXTRA, [[], [], [], {}, []])
            E(TS.PINGS, pings)
            E(TS.FORGET)
            # (this browser's bridge address and key as a fresh profile has them: none)
            E("() => { try { localStorage.removeItem('tdsdesk:bridge'); } catch (e) {} if (window.__bridge0) Object.assign(Bridge, window.__bridge0); Bridge.setCfg({key: '', bridgeId: '', url: 'http://127.0.0.1:9100'}); }")
            E(TS.MINE, own); pg.wait_for_timeout(1500)
            if local: E(LOCAL_UP, local)
            pg.wait_for_timeout(2200)
            return ids
        def row(name): return '#app [data-tsm-table] tr[data-tsm-row="%s"]' % name
        def picker_groups(sel):
            return E("(s) => [...document.querySelectorAll(s + ' optgroup')].map(g => [g.label, [...g.querySelectorAll('option')].map(o => o.value)])", sel)

        da = T.dev(7, PC, "made-up-a", tally="open", opened=(), version="2.5.4", rec=(), beat={"bridgePort": 9101, "windowsUser": UA},
                   ports=[{"port": 1646, "ok": True, "skipped": False, "n": 0, "error": "", "reason": "open"},
                          {"port": 511, "ok": False, "skipped": True, "n": 0, "error": "Tally of made-up-b", "reason": "another user"}])
        db = T.dev(8, PC, "made-up-b", tally="open", opened=(KESTREL,), version="2.5.4", rec=(KESTREL,), beat={"bridgePort": 9150, "windowsUser": UB},
                   ports=[{"port": 511, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"}])
        cos = [{"company": KESTREL, "client_id": None, "device_id": db["id"], "gstin": "", "last_seen": "ago:0.5"}]
        A_PINGS = {"9101": TS.ping(9101, True, UA, version="2.5.4", bridgeId="go-7"), "9150": TS.ping(9150, False, UB, version="2.5.4")}
        # the one FinCom login is linked to B's bridge (as on staging: the member link names some other login's bridge)
        LINK_B = ["linked", "go-8", db["id"]]

        print("== 1. A's browser: its own Tally open, no company; B's company never offered")
        ids = scene([da, db], cos, [ORBIT, ACME], LINK_B, A_PINGS, local=[[], UA, "go-7", 9101])
        own = pg.get_attribute("#app [data-tally-simple]", "data-tsm-own")
        mt = main_text()
        ok(own == "ok" and pg.get_attribute("#app [data-tally-simple]", "data-tsm-own-how") == "found", "1. A's own bridge found by its session (%s)" % own)
        ok(txt("#app [data-tsm-why]").startswith(NO_CO), "1. the header says plainly: %s (%s)" % (NO_CO, txt("#app [data-tsm-head]")))
        ok(n("#app [data-tsm-strip]") == 0 and n(row(KESTREL)) == 0 and pg.get_attribute("#app [data-tsm-guide]", "data-tsm-guide") != "3" and "Kestrel" not in mt,
           "1. no strip, no row, no step 3 with B's company (%s)" % mt[:300].replace("\n", " | "))

        print("== 2. the new client's Link: the picker and the Tally icon's list")
        pg.click(row(ORBIT) + ' [data-tsm-act="pickco"]'); pg.wait_for_timeout(600)
        gs = picker_groups(row(ORBIT) + " [data-tlk-pick-box]")
        openg = [v for (l, vs) in gs for v in vs if l == "Open in Tally now"]
        ok(n(row(ORBIT) + " [data-tlk-pick-box]") == 1 and KESTREL not in openg, "2. the picker: B's company is not under Open in Tally now (%s)" % gs)
        ok(NO_CO in txt(row(ORBIT) + " [data-tlk-pick-box]"), "2. the picker says: %s (%s)" % (NO_CO, txt(row(ORBIT) + " [data-tlk-pick-box]")))
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", ids[ORBIT]); pg.wait_for_timeout(1500)
        POP = "header.top .tally-pop"
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector(POP + " [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(500)
        sel = E("(s) => { const e = document.querySelector(s + ' [data-tally-pop-pick]'); return e ? e.value : null; }", POP)
        ok(sel != KESTREL, "2. the Tally icon's Link list: B's company not chosen for the new client (%r)" % sel)
        ok(NO_CO in txt(POP), "2. the Tally icon says: %s (%s)" % (NO_CO, txt(POP)[:200]))
        sign_co = E("(c) => JSON.stringify(tallySignNow(S.companies[c]))", ids[ORBIT]); sign_firm = E("() => JSON.stringify(tallySignNow(null))")
        ok("Kestrel" not in sign_co and "Kestrel" not in sign_firm, "4. the firm sign never names B's company (%s | %s)" % (sign_co[:220], sign_firm[:220]))
        pg.keyboard.press("Escape"); E("() => { S.coId = null; S.view = 'home'; S.tallyMore = {support: true}; navHome('tally'); }"); pg.wait_for_timeout(1500)

        print("== 3. For support: Open in Tally now, this computer's card")
        tco = txt("#app .tcompanies")
        ok(n("#app .tcompanies") == 1 and "Kestrel" not in tco, "3. Open in Tally now: none of B's companies (%s)" % tco[:200])
        E("(c) => openConnectTally(4, c)", ids[ORBIT]); pg.wait_for_timeout(1200); E("() => { S.tallyMore = {support: true}; render(); }"); pg.wait_for_timeout(1200)
        tco = txt("#app .tcompanies")
        ok(n("#app .tcompanies") == 1 and "Kestrel" not in tco, "3. for the new client (Link to %s): none of B's companies (%s)" % (ORBIT, tco[:200]))
        card = txt("#app [data-status-card]")
        ok("Tally open: no company open" in card and "1 company" not in card, "3. this computer's card: Tally open: no company open (%s)" % card[:160])
        E("() => { S.tallyGuide = {}; render(); }")

        print("== 5. B's browser: B's company is open in B's Tally")
        B_PINGS = {"9101": TS.ping(9101, False, UA, version="2.5.4"), "9150": TS.ping(9150, True, UB, version="2.5.4", bridgeId="go-8")}
        scene([da, db], cos, [ORBIT, ACME], LINK_B, B_PINGS, local=[[KESTREL], UB, "go-8", 9150])
        ok((n("#app [data-tsm-strip]") == 1 and pg.get_attribute("#app [data-tsm-strip]", "data-tsm-strip") == KESTREL) or
           (pg.get_attribute("#app [data-tsm-guide]", "data-tsm-guide") == "3" and KESTREL in txt("#app [data-tsm-now]")), "5. B's page: B's company offered (the strip or step 3: %s)" % txt("#app [data-tsm-now]"))
        pg.click(row(ORBIT) + ' [data-tsm-act="pickco"]'); pg.wait_for_timeout(600)
        gs = picker_groups(row(ORBIT) + " [data-tlk-pick-box]")
        ok(any(l == "Open in Tally now" and KESTREL in vs for (l, vs) in gs), "5. B's picker: B's company under Open in Tally now (%s)" % gs)
        E("() => { Object.assign(Bridge, window.__bridge0); Bridge.st = {state: 'off', sessions: [], open: [], at: Date.now(), error: ''}; render(); }")

        print("== 6. an old bridge (2.5.1) of this member on the shared server")
        dold = T.dev(7, PC, "made-up-a", tally="open", opened=(KESTREL,), version="2.5.1", rec=(KESTREL,), beat={"bridgePort": 9101, "windowsUser": UA})
        OLD_PINGS = {"9101": TS.ping(9101, None, UA, version="2.5.1", yours=True, bridgeId="go-7"), "9150": TS.ping(9150, False, UB, version="2.5.4")}
        scene([dold, db], cos, [ORBIT, ACME], ["linked", "go-7", dold["id"]], OLD_PINGS)
        hd = txt("#app [data-tsm-head]")
        say = E("() => { const e = document.querySelector('#app [data-tsm-head] [data-tsm-bridge-say]'); return e ? e.getAttribute('data-tsm-bridge-say') : null; }")
        ok(say == "old" and OLD in hd and n("#app [data-tsm-head] [data-tsm-download]") == 1,
           "6. the header: the bridge is old, with Download (%s)" % hd)
        ok(n("#app [data-tsm-strip]") == 0 and n(row(KESTREL)) == 0 and pg.get_attribute("#app [data-tsm-guide]", "data-tsm-guide") != "3", "6. the old bridge's companies are not offered as open in your Tally")
        if not n(row(ORBIT) + " [data-tlk-pick-box]"): pg.click(row(ORBIT) + ' [data-tsm-act="pickco"]'); pg.wait_for_timeout(600)
        gs = picker_groups(row(ORBIT) + " [data-tlk-pick-box]")
        ok(n(row(ORBIT) + " [data-tlk-pick-box]") == 1 and not any(KESTREL in vs for (l, vs) in gs if l == "Open in Tally now"), "6. the picker: nothing under Open in Tally now (%s)" % gs)
        E("() => { S.tallyMore = {support: true}; render(); }"); pg.wait_for_timeout(1200)
        tco = txt("#app .tcompanies")
        ok(n("#app .tcompanies") == 1 and "Kestrel" not in tco, "6. For support's Open in Tally now: none (%s)" % tco[:160])

        print("== 7. the look on 127.0.0.1 finds no bridge of this login: the member link to B's bridge is never used here")
        for label, pings in (("only B's bridge answers (another session)", {"9150": TS.ping(9150, False, UB, version="2.5.4")}),
                             ("a 2.5.2 bridge answers (no session said)", {"9103": TS.ping(9103, None, UA, version="2.5.2")})):
            scene([da, db], cos, [ORBIT, ACME], LINK_B, pings)
            own = pg.get_attribute("#app [data-tally-simple]", "data-tsm-own")
            if not n(row(ORBIT) + " [data-tlk-pick-box]"): pg.click(row(ORBIT) + ' [data-tsm-act="pickco"]'); pg.wait_for_timeout(600)
            gs = picker_groups(row(ORBIT) + " [data-tlk-pick-box]")
            ok(not any(KESTREL in vs for (l, vs) in gs if l == "Open in Tally now"), "7. %s: the picker never calls B's company open here (%s)" % (label, gs))
            ok(own != "ok" and n("#app [data-tsm-strip]") == 0 and n(row(KESTREL)) == 0 and pg.get_attribute("#app [data-tsm-guide]", "data-tsm-guide") != "3" and n("#app [data-tsm-connect]") == 0,
               "7. %s: B's Tally is not this login's (own %s; no strip, row or step 3 with B's company)" % (label, own))
        # a laptop (nothing answers, no key here): the member link is kept, and the firm's open companies are open as before
        scene([da, db], cos, [ORBIT, ACME], LINK_B, {})
        ok(pg.get_attribute("#app [data-tally-simple]", "data-tsm-own-how") == "linked", "7. a laptop: the member link is used (%s)" % pg.get_attribute("#app [data-tally-simple]", "data-tsm-own-how"))
        if not n(row(ORBIT) + " [data-tlk-pick-box]"): pg.click(row(ORBIT) + ' [data-tsm-act="pickco"]'); pg.wait_for_timeout(600)
        gs = picker_groups(row(ORBIT) + " [data-tlk-pick-box]")
        ok(any(l == "Open in Tally now" and KESTREL in vs for (l, vs) in gs), "7. a laptop: the picker's Open in Tally now is the firm's, as before (%s)" % gs)

        print("== 8. a client named like its Tally company, but for a plural: offered, one click")
        NOVA, NOVAS = "Nova Space", "NOVA SPACES"
        dn = T.dev(7, PC, "made-up-a", tally="open", opened=(NOVAS,), version="2.5.4", rec=(NOVAS,), beat={"bridgePort": 9101, "windowsUser": UA})
        cn = cos + [{"company": NOVAS, "client_id": None, "device_id": dn["id"], "gstin": "", "last_seen": "ago:0.5"}]
        ids = scene([dn, db], cn, [NOVA, ACME], LINK_B, A_PINGS, local=[[NOVAS], UA, "go-7", 9101])
        note = txt(row(NOVA) + ' [data-tsm-col="c"] [data-tsm-note]')
        ok(note == "Found in Tally: “%s”" % NOVAS and txt(row(NOVA) + ' [data-tsm-col="c"] [data-tsm-connect]') == "Connect", "8. %s's row: Found in Tally: %s, Connect (%s)" % (NOVA, NOVAS, txt(row(NOVA))))
        E("() => { window.__calls = []; }")
        pg.click(row(NOVA) + ' [data-tsm-col="c"] [data-tsm-connect]'); pg.wait_for_timeout(2500)
        lk = [c[1] for c in E("window.__calls") if c[0] == "tally_company_link" and c[1].get("p_client")]
        ok(lk == [{"p_company": NOVAS, "p_client": ids[NOVA]}], "8. Link: %s to %s in one call (%s)" % (NOVAS, NOVA, lk))
        # the Tally icon on a client of that name (not linked): its own Tally's company chosen first
        ids = scene([dn, db], cn, [NOVA, ACME], LINK_B, A_PINGS, local=[[NOVAS], UA, "go-7", 9101])
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", ids[NOVA]); pg.wait_for_timeout(1500)
        POP = "header.top .tally-pop"
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector(POP + " [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(500)
        sel = E("(s) => { const e = document.querySelector(s + ' [data-tally-pop-pick]'); return e ? e.value : null; }", POP)
        ok(sel == NOVAS, "8. the Tally icon's Link list chooses %s first (%r)" % (NOVAS, sel))
        pg.keyboard.press("Escape")

        print("== 9. the page with several companies open in this login's Tally, and another login's bridge here")
        DEX, NOVA, NOVAS, ZEN, KITE, IRIS = "Delta Exports", "Nova Space", "NOVA SPACES", "Zen Mills Private Limited", "Kite Works", "IRIS FOODS"
        d9 = T.dev(7, PC, "made-up-a", tally="open", opened=(DEX, NOVAS, ZEN), version="2.5.4", rec=(DEX, NOVAS, ZEN), beat={"bridgePort": 9101, "windowsUser": UA})
        b9 = T.dev(8, PC, "made-up-b", tally="open", opened=(KESTREL, "KITE WORKS"), version="2.5.4", rec=(KESTREL,), beat={"bridgePort": 9150, "windowsUser": UB})
        c9 = [{"company": c, "client_id": None, "device_id": d9["id"], "gstin": "", "last_seen": "ago:0.5"} for c in (DEX, NOVAS, ZEN)] + \
             [{"company": c, "client_id": None, "device_id": b9["id"], "gstin": "", "last_seen": "ago:0.5"} for c in (KESTREL, "KITE WORKS")] + \
             [{"company": IRIS, "client_id": None, "device_id": d9["id"], "gstin": "", "last_seen": "ago:3000"}]
        cl9 = ["Delta Exports", NOVA, KITE, "Iris Foods"]
        # first time: nothing linked. Each of this login's three companies has its row (a client's, or its own), each one click
        ids = scene([d9, b9], c9, cl9, LINK_B, A_PINGS, local=[[DEX, NOVAS, ZEN], UA, "go-7", 9101])
        con = lambda c: txt(row(c) + ' [data-tsm-col="c"] [data-tsm-connect]')
        ok(con(DEX) == "Connect" and con(NOVA) == "Connect", "9. the exact and the near name (%s / %s): Connect in Linked to Tally? (%r, %r)" % (DEX, NOVAS, con(DEX), con(NOVA)))
        ok(n(row(ZEN)) == 1 and txt(row(ZEN) + ' [data-tsm-col="do"] [data-tsm-act]') in ("Link", "Link to a client"), "9. %s (no client of its name): its own row with Link (%s)" % (ZEN, txt(row(ZEN))))
        ok(n(row(KESTREL)) == 0 and con(KITE) == "" and "KITE WORKS" not in txt(row(KITE)) and "Kestrel" not in main_text(), "9. another login's open companies: no row, no Connect, not offered to %s (%s)" % (KITE, txt(row(KITE))))
        ok(con("Iris Foods") == "" and txt(row("Iris Foods") + ' [data-tsm-col="c"] [data-tsm-note]') == "Found in Tally: “%s”" % IRIS, "9. a company not open now: plain words, no Connect (%s)" % txt(row("Iris Foods")))
        E("() => { window.__calls = []; }")
        pg.click(row(NOVA) + ' [data-tsm-col="c"] [data-tsm-connect]'); pg.wait_for_timeout(2500)
        lk = [c[1] for c in E("window.__calls") if c[0] == "tally_company_link" and c[1].get("p_client")]
        ok(lk == [{"p_company": NOVAS, "p_client": ids[NOVA]}], "9. Connect: one click, one link (%s)" % lk)
        pg.click(row(ZEN) + ' [data-tsm-col="do"] [data-tsm-act]'); pg.wait_for_timeout(600)
        ok(n(row(ZEN) + " [data-tco-add-new]") == 1 or n(row(ZEN) + " select[data-tco-relink-pick]") == 1, "9. %s's Link: a short list of clients, + New client" % ZEN)
        # later: one linked and open (its normal state), one not linked and open (Connect)
        c9b = [dict(x, client_id="NAME:" + DEX) if x["company"] == DEX else x for x in c9]
        ids = scene([d9, b9], c9b, cl9, LINK_B, A_PINGS, local=[[DEX, NOVAS, ZEN], UA, "go-7", 9101])
        ok(pg.get_attribute(row(DEX) + ' [data-tsm-col="o"] [data-tsm-word]', "data-tsm-word") == "Yes" and con(DEX) == "" and con(NOVA) == "Connect",
           "9. later: %s linked and open (Yes, no Connect), %s Connect (%s | %s)" % (DEX, NOVA, txt(row(DEX)), txt(row(NOVA))))
        # none open in this login's Tally
        d0 = T.dev(7, PC, "made-up-a", tally="open", opened=(), version="2.5.4", rec=(), beat={"bridgePort": 9101, "windowsUser": UA})
        scene([d0, b9], c9, cl9, LINK_B, A_PINGS, local=[[], UA, "go-7", 9101])
        ok(txt("#app [data-tsm-why]").startswith(NO_CO) and n("#app [data-tsm-connect]") == 0 and n(row(ZEN)) == 0 and n(row(KESTREL)) == 0,
           "9. none open here: %s; no Connect, no company row (%s)" % (NO_CO, txt("#app [data-tsm-head]")))

        print("== 10. a fresh tab: the look on 127.0.0.1 not settled yet")
        ids = scene([da, db], cos, [ORBIT, ACME], LINK_B, A_PINGS)
        E("""() => { Object.assign(FCTallySimple.LOCALB, {list: null, busy: false, at: 0, ports: '', sig: '', n: 0, cut: false});
          const pr = Bridge.probe; Bridge.probe = (port, ms) => new Promise((ok) => setTimeout(() => ok(pr(port, ms)), 2500)); }""")
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", ids[ORBIT]); pg.wait_for_timeout(300)
        POP = "header.top .tally-pop"
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector(POP + " [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(200)
        sel0 = E("(s) => { const e = document.querySelector(s + ' [data-tally-pop-pick]'); return e ? e.value : null; }", POP)
        busy = E("() => FCTallySimple.LOCALB.list === null")
        ok(busy and sel0 != KESTREL, "10. before the look settles: nothing of B's chosen (%r, looking %s)" % (sel0, busy))
        pg.wait_for_timeout(4000)
        sel1 = E("(s) => { const e = document.querySelector(s + ' [data-tally-pop-pick]'); return e ? e.value : null; }", POP)
        ok(E("() => FCTallySimple.LOCALB.list !== null") and sel1 != KESTREL, "10. the look started by the list itself, settled: still nothing of B's (%r)" % sel1)
        pg.keyboard.press("Escape"); E("() => { S.coId = null; S.view = 'home'; navHome('tally'); }"); pg.wait_for_timeout(800)

        print("== 11. the firm's sign with this login's bridge found here, not paired in this browser")
        scene([da, db], cos, [ORBIT, ACME], LINK_B, A_PINGS)
        sg = E("() => JSON.stringify([Bridge.on(), tallySignNow(null)])")
        ok(sg.startswith("[false") and "Kestrel" not in sg, "11. not paired here, a bridge of this login answers: the sign never names B's company (%s)" % sg[:260])

        print("== 12. Tally open only in another login (this login's own Tally not answering): no 'no company' line")
        dc = T.dev(7, PC, "made-up-a", tally="open", opened=(), version="2.5.4", rec=(), beat={"bridgePort": 9101, "windowsUser": UA},
                   ports=[{"port": 511, "ok": False, "skipped": True, "n": 0, "error": "Tally of made-up-b", "reason": "another user"}])
        scene([dc, db], cos, [ORBIT, ACME], LINK_B, A_PINGS)
        ok(pg.get_attribute("#app [data-tally-simple]", "data-tsm-own") == "ok" and not txt("#app [data-tsm-head]").count(NO_CO), "12. not said (%s)" % txt("#app [data-tsm-head]"))

        print("== 13. an office of two computers: a company open only on the other computer is linkable, never chosen")
        LUMEN = "Lumen Traders"
        dp = T.dev(9, "PC2", "made-up-c", tally="open", opened=(LUMEN,), version="2.5.4", rec=(LUMEN,), beat={"bridgePort": 9100, "windowsUser": "PC2\\made-up-c"})
        c13 = cos + [{"company": LUMEN, "client_id": None, "device_id": dp["id"], "gstin": "", "last_seen": "ago:0.5"}]
        ids = scene([da, dp], c13, [LUMEN, ACME], ["paired", "go-7", ""], A_PINGS, local=[[], UA, "go-7", 9101])
        ok(n(row(LUMEN) + ' [data-tsm-connect]') == 0 and "Found in Tally" not in txt(row(LUMEN)), "13. not offered as found or Connect (%s)" % txt(row(LUMEN)))
        if not n(row(LUMEN) + " [data-tlk-pick-box]"): pg.click(row(LUMEN) + ' [data-tsm-act="pickco"]'); pg.wait_for_timeout(600)
        gs = picker_groups(row(LUMEN) + " [data-tlk-pick-box]")
        ok(any(LUMEN in vs for (l, vs) in gs) and not any(LUMEN in vs for (l, vs) in gs if l == "Open in Tally now"), "13. the picker: listed, not under Open in Tally now (%s)" % gs)
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", ids[LUMEN]); pg.wait_for_timeout(1200)
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector(POP + " [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(400)
        opts = E("(s) => { const e = document.querySelector(s + ' [data-tally-pop-pick]'); return e ? [e.value, [...e.options].map(o => o.value)] : null; }", POP)
        ok(opts and opts[0] != LUMEN and LUMEN in opts[1], "13. the Tally icon: listed, not chosen (%s)" % opts)
        pg.keyboard.press("Escape"); E("() => { S.coId = null; S.view = 'home'; navHome('tally'); }"); pg.wait_for_timeout(800)

        print("== 14. a plural name that two clients share: no guess")
        dn2 = T.dev(7, PC, "made-up-a", tally="open", opened=(NOVAS,), version="2.5.4", rec=(NOVAS,), beat={"bridgePort": 9101, "windowsUser": UA})
        cn2 = cos + [{"company": NOVAS, "client_id": None, "device_id": dn2["id"], "gstin": "", "last_seen": "ago:0.5"}]
        scene([dn2, db], cn2, [NOVA, "Nova-Space", ACME], LINK_B, A_PINGS, local=[[NOVAS], UA, "go-7", 9101])
        ok("Found in Tally" not in txt(row(NOVA)) and "Found in Tally" not in txt(row("Nova-Space")) and n(row(NOVAS)) == 1, "14. neither client is guessed; the company has its own row (%s | %s)" % (txt(row(NOVA)), txt(row("Nova-Space"))))

        print("== 15. the remembered address answers: one light look for every caller, never the whole range")
        ids = scene([da, db], cos, [ORBIT, ACME], LINK_B, A_PINGS)
        E("""(own) => { const P = {'9101': own.a, '9150': own.b}; window.__asked = [];
          Bridge.probeUrl = (base, ms) => { const port = Bridge.urlPort(base); window.__asked.push(port); const j = P[String(port)];
            return new Promise((r) => setTimeout(() => r(j ? Object.assign({port, url: 'http://127.0.0.1:' + port}, j, {proven: false, pairProven: false}) : null), 300)); };
          Bridge.probe = (port, ms) => Bridge.probeUrl('http://127.0.0.1:' + port, ms);
          try { localStorage.setItem(LocalOwner.P + 'ownbridge', JSON.stringify({id: 'go-7', port: 9101, user: own.u})); } catch (e) {}
          Bridge.setCfg({url: 'http://127.0.0.1:9101'});
          FCTallyConnect.resetHere(); Object.assign(FCTallySimple.LOCALB, {list: null, busy: false, at: 0, ports: '', sig: '', n: 0, cut: false}); }""",
          {"a": TS.ping(9101, True, UA, version="2.5.4", bridgeId="go-7"), "b": TS.ping(9150, False, UB, version="2.5.4"), "u": UA})
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", ids[ORBIT]); pg.wait_for_timeout(200)
        pg.click("header.top [data-tally-icon]"); E("() => { FCTallyConnect.lookHere(); FCTallySimple.lookOnce(); FCTallyConnect.lookHere(); }")
        pg.wait_for_timeout(3000)
        asked = E("window.__asked"); found = E("() => (FCTallySimple.LOCALB.list || []).some((x) => x.sameSession === true)")
        ok(found and 9101 in asked and len(asked) <= 2 and not (set(range(9102, 9111)) & set(asked)), "15. the picker's look, the card's and another: the remembered address only, asked once (%s)" % asked)
        pg.keyboard.press("Escape"); E("() => { S.coId = null; S.view = 'home'; navHome('tally'); }"); pg.wait_for_timeout(800)
    print("\npage errors: %s" % errors[:5])
    ok(not errors, "no page errors")
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
