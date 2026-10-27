"""python3 run_tally_nudge.py - "Tally is open: link it", on the Tally icon (24-Oct-2026, next-tally-firstlink; the owner:
"I could not find how to link.. what to do after installing bridge and opening Tally", then "I do not want 'Tally is
open and link' on every page.. it should be above, on the Tally icon").
Stub cloud as run_tally_suvit.py (TLight: the computers' beats and the companies FinCom keeps):
  1. No line on any page (Today, Clients, a client's page): the top bar's Tally sign carries a badge with the number of
     companies open in Tally that are no client's ("2").
  2. A click on the sign opens the Tally panel, which starts with each one: "Tally is open on NWS144 with <company>."
     [Add as new client] [Link to existing client ▾]; a client of the same name: [Link to Garg Shekhar & Company] first.
  3. Add as new client: one click: the client made, tally_company_link once, the ledgers' wake; the badge goes to 1.
     Link to existing client: one choice (asked first when that client has another company).
  4. On a client's own page not linked: the click opens the panel (not the Tally page) and offers [Link to <this
     client>] first; one click links THIS client.
  5. Only for who may link (owner, staff): a viewer sees no badge and no offer.
  6. Nothing open unlinked: no badge, and a client not linked still goes to its Tally card on a click (as before).
  7. No sideways scroll at 1440 and 390; --shots DIR (the top bar with the badge, the panel open).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_nudge.py [--shots DIR]"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
import run_tally_suvit as SV
SITE = SV.SITE
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8661
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
SETUP = SV.SETUP.replace("TLight.st.at = Date.now();", "TLight.st.at = Date.now(); TLight.st.loaded = true;")
assert SETUP != SV.SETUP
VMS, GSC, SAL = SV.VMS, SV.GSC, SV.SAL
BADGE, SIGN, PANEL = "[data-tally-badge]", "#cobar [data-tally-sign], [data-tally-sign]", '[data-overlay="tallypanel"]'
OFF = PANEL + " [data-tally-offers]"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(SV.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"setup": {"version": "2.4.5", "url": "https://x/s.exe", "sha256": "ab" * 32}})))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        SV.GST[0] = SV.VMS_GST[:14] + E("(g) => gstinCheckChar(g)", SV.VMS_GST[:14] + "0")
        E("""() => { const g = newCompany({name: 'Garg Shekhar & Company', gstin: '09AANFG3202D1ZR'}); S.companies[g.id] = g; S.data[g.id] = {parties: {}, entries: {}, loaded: true}; g.stats = {};
            Store.saveCompany(g); window.__ids = {GS: g.id}; }""")
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        calls = lambda kind=None: [c for c in E("window.__calls || []") if kind is None or c[0] == kind]
        badge = lambda: txt(BADGE) if pg.locator(BADGE).count() else ""
        sign = lambda: pg.locator("[data-tally-sign]").first
        def shot(name, full=False):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True)
            for w, h in ((1440, 900), (390, 844)):
                pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(400)
                pg.screenshot(path=os.path.join(SHOTS, "icon-%s-%d.png" % (name, w)), full_page=full)
            pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(250)
        def narrow(where):
            pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(400)
            sc = E("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            ok(sc <= 0, "7. no sideways scroll at 390 (%s): %d" % (where, sc))
            pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(250)
        def close_panel():
            if pg.locator(PANEL).count(): E("() => doAct('tallyPanelClose')"); pg.wait_for_timeout(400)
        def scene(devs, cos, where="today", role="owner"):
            close_panel()
            E(SETUP, [devs, cos, {}, {}]); E("(r) => { S.account.me.role = r; }", role); pg.wait_for_timeout(150)
            E("(w) => { navHome(w); }", where); pg.wait_for_timeout(1300)
        def open_panel():
            sign().click(); pg.wait_for_timeout(900)

        # ---- 1. no line on the pages; the badge on the Tally sign
        scene([SV.dev(opened=(VMS, GSC))], SV.cos())
        ok(pg.locator("[data-tally-nudge]").count() == 0, "1. Today: no 'Tally is open' line on the page")
        ok(badge() == "2", "1. the Tally sign's badge: 2 companies open in Tally, not linked (%s)" % badge())
        ok("2 companies open in Tally are not linked: click to link" in (sign().get_attribute("aria-label") or ""), "1. the sign says so to a screen reader (%s)" % sign().get_attribute("aria-label"))
        ok(pg.locator(PANEL).count() == 0 and pg.locator("[data-tally-offers]").count() == 0, "1. nothing offered until the sign is clicked")
        shot("1-badge")
        E("() => { navHome('clients'); }"); pg.wait_for_timeout(900)
        ok(pg.locator("[data-tally-nudge]").count() == 0 and badge() == "2", "1. Clients: no line, the same badge")
        E("() => { navHome('today'); }"); pg.wait_for_timeout(700)
        # ---- 2. the click: the panel starts with the offers
        open_panel()
        ok(pg.locator(OFF).count() == 1, "2. a click on the sign opens the Tally panel with the offers")
        offers = E("(s) => [...document.querySelectorAll(s + ' [data-tally-offer]')].map(o => [o.getAttribute('data-tally-offer'), o.innerText.replace(/\\s+/g, ' ').trim()])", OFF)
        ok(sorted(o[0] for o in offers) == sorted([VMS, GSC]), "2. both companies offered (%s)" % [o[0] for o in offers])
        ok(E("(s) => { const p = document.querySelector(s), o = p.querySelector('[data-tally-offers]'), h = p.querySelector('[data-tally-here-card]'); return !!o && (!h || !!(o.compareDocumentPosition(h) & 4)); }", PANEL), "2. at the top of the panel")
        vm = next((o[1] for o in offers if o[0] == VMS), "")
        ok(vm.startswith("Tally is open on NWS144 with " + VMS + ".") and "Add as new client" in vm and "Link to existing client ▾" in vm, "2. 'Tally is open on NWS144 with VMS…' [Add as new client] [Link to existing client ▾] (%s)" % vm[:160])
        gs_btn = PANEL + ' [data-tally-offer="%s"] [data-tally-offer-link-to]' % GSC
        ok(pg.locator(gs_btn).count() == 1 and pg.locator(gs_btn).inner_text().strip() == "Link to Garg Shekhar & Company", "2. the same name: [Link to Garg Shekhar & Company] first")
        shot("2-panel-open"); narrow("panel open")
        # ---- 3. Add as new client
        E("() => { window.__calls = []; }")
        pg.click(PANEL + ' [data-tally-offer="%s"] [data-tally-offer-add]' % VMS); pg.wait_for_timeout(1800)
        ids = E("(n) => Object.values(S.companies).filter(c => !c.deleted && c.tallyName === n).map(c => c.id)", VMS)
        ok(len(ids) == 1 and calls("tally_company_link") == [["tally_company_link", {"p_company": VMS, "p_client": ids[0]}]], "3. Add as new client: the client made and linked once (%s)" % calls("tally_company_link"))
        ok(any(c[0] == "post" and c[1].get("what") == "ledgers" for c in calls()), "3. and the ledgers' first sync asked")
        E("() => { TLight.st.at = 0; render(); }"); pg.wait_for_timeout(900)
        ok(badge() == "1", "3. the badge goes to 1 (%s)" % badge())
        # Link to existing client
        scene([SV.dev(opened=(SAL,))], SV.cos(vms="GS"))
        gs = E("window.__ids.GS")
        open_panel(); E("() => { window.__calls = []; }")
        pg.select_option(PANEL + ' [data-tally-offer="%s"] [data-tally-offer-link]' % SAL, gs); pg.wait_for_timeout(800)
        ok(pg.locator('#confirmBox [data-cbx="yes"]').is_visible(), "3. that client has another company: asked once")
        pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(1500)
        ok(calls("tally_company_link")[:1] == [["tally_company_link", {"p_company": SAL, "p_client": gs}]], "3. Link to existing client: one choice links it (%s)" % calls("tally_company_link"))
        # ---- 4. a client's own page, not linked
        scene([SV.dev(opened=(VMS,))], SV.cos())
        E("(c) => openCompany(c)", gs); pg.wait_for_timeout(1500)
        ok(pg.locator("[data-tally-nudge]").count() == 0 and badge() == "1", "4. the client's page: no line, the badge (%s)" % badge())
        open_panel()
        here = PANEL + ' [data-tally-offer="%s"] [data-tally-offer-link-to="%s"]' % (VMS, gs)
        ok(pg.locator(OFF).count() == 1 and pg.locator(here).count() == 1 and pg.locator(here).inner_text().strip() == "Link to Garg Shekhar & Company", "4. the panel (not the Tally page), with [Link to Garg Shekhar & Company] first")
        shot("4-client-panel")
        E("() => { window.__calls = []; }"); pg.click(here); pg.wait_for_timeout(1500)
        ok(calls("tally_company_link") == [["tally_company_link", {"p_company": VMS, "p_client": gs}]], "4. one click links THIS client (%s)" % calls("tally_company_link"))
        # ---- 5. a viewer: nothing
        scene([SV.dev(opened=(VMS, GSC))], SV.cos(), role="viewer")
        ok(badge() == "", "5. a viewer: no badge")
        open_panel()
        ok(pg.locator(PANEL).count() == 1 and pg.locator(OFF).count() == 0, "5. a viewer: the panel without offers")
        E("() => { S.account.me.role = 'staff'; render(); }"); pg.wait_for_timeout(500)
        close_panel()
        ok(badge() == "2", "5. staff (may link): the badge (%s)" % badge())
        # ---- 6. nothing open unlinked
        scene([SV.dev(opened=())], SV.cos())
        ok(badge() == "", "6. nothing open unlinked: no badge")
        E("(c) => openCompany(c)", gs); pg.wait_for_timeout(1500)
        sign().click(); pg.wait_for_timeout(1000)
        ok(pg.locator(PANEL).count() == 0 and E("() => S.view") == "home" and E("() => S.homeTab") == "tally", "6. a client not linked: the sign still goes to its Tally card (%s)" % E("() => [S.view, S.homeTab]"))
        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
