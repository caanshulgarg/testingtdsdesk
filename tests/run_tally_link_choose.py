"""python3 run_tally_link_choose.py - a link is chosen, never made silently (next-link-choose, 11-Nov-2026; the owner:
"while linking tally company to fincom company system should ask both ways with opened tally which company would you like
to connect" and "when we unlink and again link then the same company has linked again without giving option of the
company"; a client had been linked to an empty copy of its company with a near-identical name while the real one was open).
Made-up firm, logins, clients and companies only (run_tally_simple.py's stand-in cloud; nothing real is read or changed).
  1. two companies that look alike open in this login's Tally ("ORION TRADERS" and "Orion Traders (Depot)"): the client's
     row has no one-click Connect; its Link opens the list of Tally companies, each saying what it holds (entries and
     masters from the beat's change numbers, "no entries" for the empty copy; no computer's name); the person's pick is linked;
  2. a company a person unlinked (linked_at kept, no client), open again: no one-click Connect or Link on the client's
     row, the list instead; the Tally icon's Link list chooses nothing for the person;
  3. from the Tally company's side: a company whose look-alike is open too has no one-click Connect to the client of its
     name; its Link opens the clients' list (that client chosen first) and names the look-alikes with what they hold;
  4. the list offers the companies open now in ANOTHER Tally of the firm (another login's), in their own group;
  5. one company only, never unlinked: one click, as before.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_link_choose.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
import run_tally_simple as TS
from run_tally_other_login import LOCAL_UP, LATEST
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 9547
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
PC = "SRV07"
UA, UB = PC + "\\made-up-a", PC + "\\made-up-b"
ORION, ORIOND, LUMEN, DELTA, KITE = "ORION TRADERS", "Orion Traders (Depot)", "LUMEN WORKS", "Delta Exports", "KITE WORKS"
ZEN, ZENO = "ZEN MILLS", "Zen Mills (Old)"

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
        def scene(devs, cos, clients, own, pings, local=None):
            ids = E(T.SETUP, [devs, cos, [], "owner", clients, True, {}])
            E("() => { window.__linksApi = false; }")
            E(TS.EXTRA, [[], [], [], {}, []])
            E(TS.PINGS, pings)
            E(TS.FORGET)
            E("() => { try { localStorage.removeItem('tdsdesk:bridge'); } catch (e) {} if (window.__bridge0) Object.assign(Bridge, window.__bridge0); Bridge.setCfg({key: '', bridgeId: '', url: 'http://127.0.0.1:9100'}); }")
            E(TS.MINE, own); pg.wait_for_timeout(1500)
            if local: E(LOCAL_UP, local)
            pg.wait_for_timeout(2200)
            return ids
        def row(name): return '#app [data-tsm-table] tr[data-tsm-row="%s"]' % name
        def options(sel):
            return E("(s) => [...document.querySelectorAll(s + ' optgroup')].map(g => [g.label, [...g.querySelectorAll('option')].map(o => [o.value, o.text])])", sel)
        links = lambda: [c[1] for c in E("window.__calls") if c[0] == "tally_company_link" and c[1].get("p_client")]
        PINGS = {"9101": TS.ping(9101, True, UA, version="2.5.4", bridgeId="go-7"), "9150": TS.ping(9150, False, UB, version="2.5.4")}
        OWN = ["linked", "go-7", "d0000000-0000-4000-8000-000000000007"]
        # this login's Tally: the real Orion (1,204 entries, 310 masters) and its empty copy (a GUID, no change number)
        opened = (ORION, ORIOND, LUMEN, DELTA, ZEN, ZENO)
        bcos = [{"name": c, "open": True, "phase": "live", "waiting": 0, "lastRead": "ago:30", "guid": "g-%d" % i} for i, c in enumerate(opened)]
        bcos[0].update(altvchid=1204, altmstid=310); bcos[4].update(altvchid=88, altmstid=40)
        da = T.dev(7, PC, "made-up-a", tally="open", opened=opened, version="2.5.4", rec=opened, cos=bcos, beat={"bridgePort": 9101, "windowsUser": UA})
        db = T.dev(8, PC, "made-up-b", tally="open", opened=(KITE,), version="2.5.4", rec=(KITE,), beat={"bridgePort": 9150, "windowsUser": UB})
        seen = lambda c, d, **kw: dict({"company": c, "client_id": None, "device_id": d["id"], "gstin": "", "last_seen": "ago:0.5"}, **kw)
        cos = [seen(c, da) for c in (ORION, ORIOND, DELTA, ZEN, ZENO)] + [seen(LUMEN, da, linked_at="ago:20", linked_by="u-1"), seen(KITE, db)]
        clients = ["Orion Traders", "Lumen Works", DELTA]
        ids = scene([da, db], cos, clients, OWN, PINGS, local=[list(opened), UA, "go-7", 9101])

        print("== 1. two companies alike: the client's Link is a list, each saying what it holds")
        r1 = row("Orion Traders")
        ok(n(r1) == 1 and n(r1 + " [data-tsm-connect]") == 0 and n(r1 + ' [data-tsm-act="connect"]') == 0, "1. Orion Traders: no one-click Connect or Link (%s)" % txt(r1))
        pg.click(r1 + ' [data-tsm-act="pickco"]'); pg.wait_for_timeout(700)
        gs = options(r1 + " [data-tlk-pick-box]")
        flat = dict((v, t) for (l, vs) in gs for (v, t) in vs)
        same = [v for (l, vs) in gs if l.startswith("Named like") for (v, t) in vs]
        ok(ORION in same and ORIOND in same, "1. both Orion companies are offered first, named like the client (%s)" % gs)
        ok("up to 1,204 entries" in flat.get(ORION, "") and "310 masters" in flat.get(ORION, "") , "1. the real one says what it holds (%s)" % flat.get(ORION))
        ok(PC not in " ".join(t for (l, vs) in gs for (v, t) in vs), "1. no computer's name in the list (the owner's rule)")
        ok("no entries" in flat.get(ORIOND, ""), "1. the empty copy says no entries (%s)" % flat.get(ORIOND))
        ok(E("(s) => document.querySelector(s + ' [data-tlk-pick]').value", r1 + " [data-tlk-pick-box]") == "", "1. nothing chosen for the person")
        E("() => { window.__calls = []; }")
        pg.select_option(r1 + " [data-tlk-pick]", ORION); pg.click(r1 + " [data-tlk-go]"); pg.wait_for_timeout(2500)
        ok(links() == [{"p_company": ORION, "p_client": ids["Orion Traders"]}], "1. the company the person chose is linked (%s)" % links())

        print("== 2. unlinked by a person, open again: chosen again, never one click")
        ids = scene([da, db], cos, clients, OWN, PINGS, local=[list(opened), UA, "go-7", 9101])
        r2 = row("Lumen Works")
        ok(n(r2) == 1 and n(r2 + " [data-tsm-connect]") == 0 and n(r2 + ' [data-tsm-act="connect"]') == 0 and n(r2 + ' [data-tsm-act="pickco"]') == 1,
           "2. Lumen Works: Link opens the list, no one-click (%s)" % txt(r2))
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", ids["Lumen Works"]); pg.wait_for_timeout(1500)
        POP = "header.top .tally-pop"
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector(POP + " [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(500)
        sel = E("(s) => { const e = document.querySelector(s + ' [data-tally-pop-pick]'); return e ? e.value : null; }", POP)
        ok(sel == "", "2. the Tally icon's Link list chooses nothing (%r)" % sel)
        pg.keyboard.press("Escape"); E("() => { S.coId = null; S.view = 'home'; navHome('tally'); }"); pg.wait_for_timeout(1200)

        print("== 3. from the Tally company: the client is chosen, the look-alikes named")
        ids = scene([da, db], cos, clients + ["Zen Mills"], OWN, PINGS, local=[list(opened), UA, "go-7", 9101])
        zr = row("Zen Mills")
        zc = next((c for c in (ZEN, ZENO) if n(row(c)) == 1), "")
        ok(n(zr + " [data-tsm-connect]") == 0 and zc and n(row(zc) + " [data-tsm-connect]") == 0 and n(row(zc) + ' [data-tsm-act="connect"]') == 0,
           "3. neither Zen Mills company links in one click (client row %s | company row %r %s)" % (txt(zr), zc, txt(row(zc)) if zc else ""))
        if zc:
            pg.click(row(zc) + ' [data-tsm-act="choose"]'); pg.wait_for_timeout(700)
            first = E("(s) => { const e = document.querySelector(s + ' select[data-tco-relink-pick]'); return e ? [...e.options].filter(o => o.value).map(o => o.value)[0] : null; }", row(zc))
            ok(first == ids["Zen Mills"], "3. the clients' list, Zen Mills first (%r)" % first)
            al = txt(row(zc) + " [data-tco-alike]")
            ok(ZEN in al and ZENO in al and "up to 88 entries" in al and "no entries" in al, "3. the look-alikes named with what they hold (%s)" % al)

        print("== 4. the list: a company open in another Tally of the firm")
        ids = scene([da, db], cos, clients, OWN, PINGS, local=[list(opened), UA, "go-7", 9101])
        r4 = row(DELTA)
        if n(r4 + " [data-tsm-connect]"):   # Delta is one click (5); its Change list is reached from Orion's row
            r4 = row("Orion Traders")
        pg.click(r4 + ' [data-tsm-act="pickco"]'); pg.wait_for_timeout(700)
        gs = options(r4 + " [data-tlk-pick-box]")
        ok(any(l == "Open in another Tally of the firm" and any(v == KITE for v, t in vs) for (l, vs) in gs), "4. %s (another login's Tally) offered in its own group (%s)" % (KITE, gs))
        ok(not any(l == "Open in Tally now" and any(v == KITE for v, t in vs) for (l, vs) in gs), "4. never as open in this login's Tally")

        print("== 5. one company, never unlinked: one click as before")
        ok(txt(row(DELTA) + " [data-tsm-connect]") == "Connect", "5. Delta Exports: Connect (%s)" % txt(row(DELTA)))
        E("() => { window.__calls = []; }")
        pg.click(row(DELTA) + " [data-tsm-connect]"); pg.wait_for_timeout(2500)
        ok(links() == [{"p_company": DELTA, "p_client": ids[DELTA]}], "5. one click, one link (%s)" % links())

        print("== 6. review: a linked client away, a close name open and free: the list, never one click")
        PAX0, PAX1 = "PAX MEDIA (2024-25)", "PAX MEDIA (2025-26)"
        d6 = T.dev(7, PC, "made-up-a", tally="open", opened=(PAX1,), version="2.5.4", rec=(PAX1,), beat={"bridgePort": 9101, "windowsUser": UA})
        c6 = [seen(PAX0, d6, client_id="NAME:Pax Media", linked_at="ago:900", last_seen="ago:600"), seen(PAX1, d6)]
        ids = scene([d6, db], c6, ["Pax Media"], OWN, PINGS, local=[[PAX1], UA, "go-7", 9101])
        r6 = row("Pax Media")
        ok(n(r6 + " [data-tsm-away-relink]") == 0 and n(r6 + " [data-tsm-away-choose]") == 1, "6. no one-click 'Link Pax Media to it'; a Choose button (%s)" % txt(r6))
        if n(r6 + " [data-tsm-away-choose]"):
            E("() => { window.__calls = []; }")
            pg.click(r6 + " [data-tsm-away-choose]"); pg.wait_for_timeout(700)
            ok(n(r6 + " [data-tlk-pick-box]") == 1 and E("(s) => document.querySelector(s + ' [data-tlk-pick]').value", r6) == "" and links() == [],
               "6. the list opens, nothing chosen, nothing linked (%s)" % links())

        print("== 7. review: asked, the clients' list chooses nothing (a company a person unlinked, a year of a client)")
        c7 = [seen(PAX0, d6, client_id="NAME:Pax Media", linked_at="ago:900"), seen(PAX1, d6, linked_at="ago:20", linked_by="u-1")]
        d7 = T.dev(7, PC, "made-up-a", tally="open", opened=(PAX0, PAX1), version="2.5.4", rec=(PAX0, PAX1), beat={"bridgePort": 9101, "windowsUser": UA})
        ids = scene([d7, db], c7, ["Pax Media"], OWN, PINGS, local=[[PAX0, PAX1], UA, "go-7", 9101])
        r7 = row(PAX1)
        ok(n(r7) == 1 and n(r7 + " [data-tsm-act-client]") == 0 and n(r7 + " [data-tsm-connect]") == 0, "7. %s: no one-click (%s)" % (PAX1, txt(r7)))
        if n(r7 + ' [data-tsm-act="choose"]'):
            pg.click(r7 + ' [data-tsm-act="choose"]'); pg.wait_for_timeout(700)
            v = E("(s) => { const e = document.querySelector(s + ' select[data-tco-relink-pick]'); return e ? e.value : null; }", r7)
            ok(v == "", "7. the clients' list: nothing chosen (%r)" % v)

        print("== 8. review: the Tally icon's list offers what the page's list offers (another login's Tally too)")
        ids = scene([da, db], cos, clients, OWN, PINGS, local=[list(opened), UA, "go-7", 9101])
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", ids["Orion Traders"]); pg.wait_for_timeout(1500)
        pg.click("header.top [data-tally-icon]"); pg.wait_for_selector(POP + " [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(500)
        po = E("(s) => { const e = document.querySelector(s + ' [data-tally-pop-pick]'); return e ? [...e.options].map(o => o.value).filter(Boolean) : []; }", POP)
        ok(KITE in po and ORION in po and ORIOND in po, "8. the icon's list: %s (another login's) and both Orions (%s)" % (KITE, po))
        ok(E("(s) => { const e = document.querySelector(s + ' [data-tally-pop-pick]'); return e ? e.value : null; }", POP) == "", "8. nothing chosen: two Orions look alike")
        pg.keyboard.press("Escape")
        br.close()
    srv.shutdown()
    ok(not errors, "no page error (%s)" % errors[:3])
    print("\n%d check(s) failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
