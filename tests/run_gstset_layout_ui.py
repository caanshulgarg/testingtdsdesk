"""python3 run_gstset_layout_ui.py - GST settings as redesigned (17-Nov-2026): the tabs (Registrations, Client-wide,
Contacts) are a tablist; links from the GST page land where the setting is (Client-wide, or Registrations with
"Rarely changed" open and the row's box shown); "Stay" after leaving with unsaved changes keeps the tab; blocked credit
does not wait for the books; at phone width (375, 390) and 1280 no tab scrolls sideways. Made-up client only.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_gstset_layout_ui.py"""
import os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8301), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1280, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    E = pg.evaluate
    pg.goto("http://localhost:8301/"); pg.wait_for_timeout(2500)
    E("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    E("""() => { const pan = "AABCE1234F", g = (st) => st + pan + "1Z" + gstinCheckChar(st + pan + "1Z0");
      const c = newCompany({name: "Example Traders Pvt Ltd", gstin: g("09"), pan}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.loadingCo = false;
      window.__bk = {loading: false, cid: c.id, vouchers: [], map: {}, meta: null, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}};
      // the books still loading: blocked credit is shown all the same
      S.books = {loading: true, cid: c.id}; window.toast = () => {}; S.tab = "gstset"; S.gsetTab = "client"; render(); }""")
    pg.wait_for_timeout(1200)
    ok(pg.locator('#app select[aria-label^="Blocked credit: "]').count() > 0, "the books still loading: Client-wide shows blocked credit (it needs no books)")
    ok(pg.locator('#app [role="tablist"] [role="tab"]').count() == 3, "the three tabs, there while the books load, are a tablist")
    E("() => { S.books = window.__bk; GSTRegs.add('07AABCE1234F1Z' + gstinCheckChar('07AABCE1234F1Z0')); S.gsetTab = ''; render(); }"); pg.wait_for_timeout(1200)
    tabs = E("() => [...document.querySelectorAll('#app [role=tablist] [role=tab]')].map(b => [b.dataset.gsetTab, b.getAttribute('aria-selected')])")
    ok(tabs == [["regs", "true"], ["client", "false"], ["contacts", "false"]], "Registrations selected by default (%s)" % tabs)

    # Stay: leaving with an unsaved change asks; Stay comes back on the same tab
    pg.click('#app [data-gset-tab="client"]'); pg.wait_for_timeout(400)
    pg.click('#app input[aria-label="Show FinCom’s estimate"]'); pg.wait_for_timeout(400)
    E("goTab('cotally')"); pg.wait_for_timeout(700)
    ok(pg.locator("#confirmBox [data-leave-ask]").is_visible(), "leaving with a change asks")
    pg.click('#confirmBox [data-leave="stay"]'); pg.wait_for_timeout(900)
    ok(E("S.tab") == "gstset" and pg.locator('#app [data-gset-tab="client"][aria-selected="true"]').count() == 1 and pg.locator('#app input[aria-label="Show FinCom’s estimate"]').count() == 1, "Stay: back on GST settings, still on Client-wide")
    pg.click('#app [data-confirm-foot="setup:gstset"] [data-cfm="discard"]'); pg.wait_for_timeout(500)
    E("goTab('cotally')"); pg.wait_for_timeout(600)
    E("goTab('gstset')"); pg.wait_for_timeout(900)
    ok(pg.locator('#app [data-gset-tab="regs"][aria-selected="true"]').count() == 1, "opened again later: on Registrations")

    # links from the GST page: to Client-wide, and to a rarely changed setting with its box shown
    for name, go, want in [("the estimate", "S.gsetGo = {tab: 'client'}", 'input[aria-label="Show FinCom’s estimate"]'),
                           ("rule 37", "S.gsetGo = {tab: 'regs', rare: 'r37'}", 'input[aria-label="Rule 37"]'),
                           ("the cash ledger", "S.gsetGo = {tab: 'regs', rare: 'cash'}", 'input[aria-label="Tally ledger for GST paid in cash"]'),
                           ("the credit basis", "S.gsetGo = {tab: 'regs', rare: 'basis'}", 'select[aria-label="Credit in 3B table 4"]'),
                           ("the opening balance", "S.gsetGo = {tab: 'regs', rare: 'open'}", 'input[aria-label="Opening IGST"]')]:
        E("() => { S.tab = 'books'; S.booksTab = 'gst'; render(); }"); pg.wait_for_timeout(700)
        E("() => { %s; goGstSettings(); }" % go); pg.wait_for_timeout(900)
        ok(E("S.tab") == "gstset" and pg.locator("#app " + want).is_visible(), "a link to %s lands on it, in view" % name)

    # the GST page's own links use it (the GST screens' code)
    src = {f: open(os.path.join(HERE, "..", "app", "src", "screens", "gst", f), encoding="utf-8").read() for f in ["BrowserHelper.jsx", "Filing.jsx", "Returns.jsx"]}
    ok("tab: \"client\"" in src["BrowserHelper.jsx"] and "<SetLink tab=\"client\">" in src["Filing.jsx"] and "rare=\"r37\"" in src["Filing.jsx"] and "rare=\"cash\"" in src["Filing.jsx"]
       and "rare=\"basis\"" in src["Returns.jsx"] and "rare=\"open\"" in src["Returns.jsx"], "BrowserHelper, Filing and Returns link to the tab and row of the setting")

    # no sideways scroll on any tab, at phone width and on a computer
    for w in [375, 390, 1280]:
        pg.set_viewport_size({"width": w, "height": 900}); bad = []
        for t in ["regs", "client", "contacts"]:
            E("(t) => { S.tab = 'gstset'; S.gsetTab = t; render(); }", t); pg.wait_for_timeout(500)
            E("() => { document.querySelectorAll('#app details').forEach(d => d.open = true); document.querySelectorAll('[data-rare-change][aria-expanded=false]').forEach(b => b.click()); }"); pg.wait_for_timeout(300)
            r = E("""() => { const W = document.documentElement.clientWidth, out = []; document.querySelectorAll('#app [role=tab], #app .gset-chip').forEach(b => { const x = b.getBoundingClientRect(); if (x.width && (x.left < -1 || x.right > W + 1)) out.push(b.textContent); });
              return [document.documentElement.scrollWidth - W, out]; }""")
            if r[0] > 1 or r[1]: bad.append("%s (scroll %d, out %s)" % (t, r[0], r[1][:3]))
        ok(not bad, "%d px: Registrations, Client-wide and Contacts, no sideways scroll, tabs and chips in view%s" % (w, "" if not bad else ": " + "; ".join(bad)))
    br.close()
srv.shutdown()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
sys.exit(1 if fails else 0)
