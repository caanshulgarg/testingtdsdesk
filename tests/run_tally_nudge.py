"""python3 run_tally_nudge.py - "Tally is open: link it", wherever the person is (24-Oct-2026, next-tally-firstlink; the
owner: "I could not find how to link.. what to do after installing bridge and opening Tally").
Stub cloud as run_tally_suvit.py (TLight: the computers' beats and the companies FinCom keeps):
  1. On Today (any firm page), a company open in Tally that is no client's: "Tally is open on NWS144 with <company>.
     Link it:" [Add as new client] [Link to existing client ▾] · Not now; "+ 1 more open in Tally: see them on the
     Tally page". A client of the same name: [Link to <client>] instead of Add.
  2. Add as new client: one click: the client made, tally_company_link once, the ledgers' wake; the line goes on to the
     next company. Link to existing client: one choice in the list links it.
  3. Not now: that company's line is hidden in this browser.
  4. A client's own page while not linked: "<client> is not linked to Tally. Open in Tally now:" [Link <company>] (one
     click links THIS client); none open: what to do; Choose on the Tally page.
  5. The Tally page shows the line at its top too.
  6. No Tally computer heard: "Tally is not connected yet…" with Connect Tally (to the Tally page); a bridge heard, no
     company open or linked: "FinCom Bridge on NWS144 is connected. Open your company in TallyPrime there…".
  7. No sideways scroll at 1440 and 390; --shots DIR.
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
NB = "#app [data-tally-nudge]"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(SV.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps({"setup": {"version": "2.4.5", "url": "https://x/s.exe", "sha256": "ab" * 32}})))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        SV.GST[0] = SV.VMS_GST[:14] + E("(g) => gstinCheckChar(g)", SV.VMS_GST[:14] + "0")
        E("""() => { const g = newCompany({name: 'Garg Shekhar & Company', gstin: '09AANFG3202D1ZR'}); S.companies[g.id] = g; S.data[g.id] = {parties: {}, entries: {}, loaded: true}; g.stats = {};
            Store.saveCompany(g); window.__ids = {GS: g.id}; try { localStorage.removeItem('fc:tallyNudgeHide'); } catch (e) {} }""")
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        calls = lambda kind=None: [c for c in E("window.__calls || []") if kind is None or c[0] == kind]
        kind = lambda: E("() => { const e = document.querySelector('#app [data-tally-nudge]'); return e ? e.getAttribute('data-tally-nudge') : ''; }")
        def shot(name):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True)
            for w, h in ((1440, 900), (390, 844)):
                pg.set_viewport_size({"width": w, "height": h}); pg.wait_for_timeout(350)
                pg.screenshot(path=os.path.join(SHOTS, "nudge-%s-%d.png" % (name, w)), full_page=False)
            pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(200)
        def narrow(where):
            pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(400)
            sc = E("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            ok(sc <= 0, "7. no sideways scroll at 390 (%s): %d" % (where, sc))
            pg.set_viewport_size({"width": 1440, "height": 900}); pg.wait_for_timeout(250)
        def scene(devs, cos, where="today"):
            E(SETUP, [devs, cos, {}, {}]); pg.wait_for_timeout(150)
            E("(w) => { navHome(w); }", where); pg.wait_for_timeout(1300)

        # ---- 1. on Today: the company open in Tally, its line with one click
        scene([SV.dev(opened=(VMS, GSC))], SV.cos())
        ok(pg.locator(NB).count() == 1 and kind() == "open", "1. on Today: one Tally line (%s)" % kind())
        first = E("() => document.querySelector('#app [data-tally-nudge]').getAttribute('data-tally-nudge-co')")
        t = txt(NB)
        ok(t.startswith("T Tally is open on NWS144 with " + first + ". Link it:") or ("Tally is open on NWS144 with " + first + ". Link it:") in t, "1. 'Tally is open on NWS144 with <company>. Link it:' (%s)" % t[:120])
        ok("+ 1 more open in Tally: see them on the Tally page" in t, "1. '+ 1 more open in Tally: see them on the Tally page'")
        if first == GSC:
            ok(pg.locator(NB + " [data-tally-nudge-twin]").inner_text().strip() == "Link to Garg Shekhar & Company", "1. a client of the same name: 'Link to Garg Shekhar & Company'")
            shot("1-open-twin")
            pg.click(NB + " [data-tally-nudge-hide]"); pg.wait_for_timeout(500)
            ok(E("() => document.querySelector('#app [data-tally-nudge]').getAttribute('data-tally-nudge-co')") == VMS, "3. Not now: the next company's line")
        ok(pg.locator(NB + " [data-tally-nudge-add]").inner_text().strip() == "Add as new client" and pg.locator(NB + " [data-tally-nudge-link]").count() == 1, "1. [Add as new client] [Link to existing client ▾]")
        ok(E("() => document.querySelector('#app [data-tally-nudge-link] option').textContent") == "Link to existing client ▾", "1. the list says 'Link to existing client ▾'")
        shot("1-open"); narrow("Today line")
        # ---- 2. Add as new client: one click
        E("() => { window.__calls = []; }")
        pg.click(NB + " [data-tally-nudge-add]"); pg.wait_for_timeout(1800)
        vm = E("(n) => Object.values(S.companies).filter(c => !c.deleted && c.tallyName === n).map(c => c.id)", VMS)
        ok(len(vm) == 1 and calls("tally_company_link") == [["tally_company_link", {"p_company": VMS, "p_client": vm[0]}]], "2. Add as new client: the client made and linked once (%s)" % calls("tally_company_link"))
        ok(any(c[0] == "post" and c[1].get("what") == "ledgers" for c in calls()), "2. and the ledgers' first sync asked")
        E("() => { TLight.st.at = 0; render(); }"); pg.wait_for_timeout(800)
        ok(E("() => { const e = document.querySelector('#app [data-tally-nudge]'); return e ? e.getAttribute('data-tally-nudge-co') : ''; }") != VMS, "2. VMS EVENTS' line is gone (linked)")
        # Link to existing client: one choice
        try: E("() => { localStorage.removeItem('fc:tallyNudgeHide'); }")
        except Exception: pass
        scene([SV.dev(opened=(SAL,))], SV.cos(vms="GS"))
        E("() => { window.__calls = []; }")
        ok(E("() => document.querySelector('#app [data-tally-nudge]').getAttribute('data-tally-nudge-co')") == SAL, "2. Salesify open, no client: its line")
        gs = E("window.__ids.GS")
        pg.select_option(NB + " [data-tally-nudge-link]", gs); pg.wait_for_timeout(800)
        # Garg Shekhar & Company has VMS EVENTS: asked once (the Tally page's own question), then linked
        ok(pg.locator('#confirmBox [data-cbx="yes"]').is_visible() and "is linked to" in txt("#confirmBox"), "2. the client has another company: asked once (%s)" % txt("#confirmBox")[:120])
        pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(1500)
        ok(calls("tally_company_link")[:1] == [["tally_company_link", {"p_company": SAL, "p_client": gs}]], "2. Link to existing client: one choice links it (the company it had is let go, as asked) (%s)" % calls("tally_company_link"))
        # ---- 4. a client's own page while not linked
        scene([SV.dev(opened=(VMS, SAL))], SV.cos())
        E("(c) => openCompany(c)", gs); pg.wait_for_timeout(1500)
        ok(kind() == "client", "4. the client's page: its own line (%s)" % kind())
        t = txt(NB)
        ok("Garg Shekhar & Company is not linked to Tally. Open in Tally now:" in t and "Link " + VMS in t and "Choose on the Tally page" in t, "4. 'Garg Shekhar & Company is not linked to Tally. Open in Tally now: [Link …]' (%s)" % t[:160])
        shot("4-client-not-linked"); narrow("client line")
        E("() => { window.__calls = []; }")
        pg.click(NB + ' [data-tally-nudge-client-link="%s"]' % VMS); pg.wait_for_timeout(1500)
        ok(calls("tally_company_link") == [["tally_company_link", {"p_company": VMS, "p_client": gs}]], "4. one click links THIS client (%s)" % calls("tally_company_link"))
        scene([SV.dev(opened=())], SV.cos())
        E("(c) => openCompany(c)", gs); pg.wait_for_timeout(1500)
        ok("Open its company in TallyPrime on the Tally computer: it shows here to link." in txt(NB), "4. none open: what to do (%s)" % txt(NB)[:140])
        # ---- 5. the Tally page shows it at its top
        scene([SV.dev(opened=(VMS,))], SV.cos(), where="tally")
        ok(E("() => { const n = document.querySelector('#app [data-tally-nudge]'), l = document.querySelector('#app [data-tco-list]'); return !!n && !!l && !!(n.compareDocumentPosition(l) & 4); }"), "5. the Tally page: the line at its top, above the list")
        shot("5-tally-page")
        # ---- 6. nothing connected yet; connected, nothing open
        scene([], [])
        ok(kind() == "connect" and "Tally is not connected yet." in txt(NB) and "download FinCom Bridge, open it, then type the code it shows" in txt(NB), "6. no Tally computer: 'Tally is not connected yet…' (%s)" % txt(NB)[:140])
        shot("6-not-connected")
        pg.click(NB + " [data-tally-nudge-connect]"); pg.wait_for_timeout(1000)
        ok(E("() => S.homeTab") == "tally" and pg.locator("#app [data-firstlink]").count() == 1, "6. Connect Tally: the Tally page with Connect this computer")
        scene([SV.dev(opened=())], [])
        ok(kind() == "openit" and "FinCom Bridge on NWS144 is connected. Open your company in TallyPrime there" in txt(NB), "6. a bridge heard, nothing open: 'Open your company in TallyPrime there' (%s)" % txt(NB)[:140])
        shot("6-open-your-company")
        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
