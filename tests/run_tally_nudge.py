"""python3 run_tally_nudge.py - NO "Tally is open: link it" anywhere (Task D, 28-Oct-2026, next-tally-linknow; the owner: "No
suggestion to add clients"): no line, badge, count or offer for companies open in Tally that are no client's. Was:
"Tally is open: link it", on the Tally icon (24-Oct-2026, next-tally-firstlink; the owner:
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

        # Task D (the owner, 28-Oct-2026: "No suggestion to add clients"): companies open in Tally that are no client's are
        # never offered: no line, no badge, no count, no "Add as new client" anywhere; the Tally page's Get companies and its
        # list's "Link to client…" are the only places, when the person asks
        for role in ("owner", "staff"):
            scene([SV.dev(opened=(VMS, GSC))], SV.cos(), role=role)
            ok(pg.locator("[data-tally-nudge]").count() == 0, "1. %s, Today: no 'Tally is open' line on the page" % role)
            ok(badge() == "", "1. %s: no badge on the Tally sign (%s)" % (role, badge()))
            ok("not linked" not in (sign().get_attribute("aria-label") or "") if sign().count() else True, "1. %s: the sign says nothing of companies not linked (%s)" % (role, sign().get_attribute("aria-label") if sign().count() else ""))
            E("() => { navHome('clients'); }"); pg.wait_for_timeout(900)
            ok(pg.locator("[data-tally-nudge]").count() == 0 and badge() == "", "1. %s, Clients: no line, no badge" % role)
            E("() => { navHome('today'); }"); pg.wait_for_timeout(700)
            if sign().count():
                open_panel()
                ok(pg.locator("[data-tally-offers], [data-tally-offer]").count() == 0 and "Add as new client" not in (pg.inner_text("body") or ""), "2. %s: the Tally sign's click offers no company to add or link" % role)
                close_panel(); pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
            shot("1-no-badge-" + role)
        narrow("today")
        gs = E("window.__ids.GS")
        E("(c) => openCompany(c)", gs); pg.wait_for_timeout(1500)
        ok(pg.locator("[data-tally-nudge], [data-tally-offers]").count() == 0 and badge() == "", "4. a client's page: no line, no badge, no offers")
        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
