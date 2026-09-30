"""python3 run_react_review.py - purchase bills many at a time in React: the review table, its bar, the drawer with one
bill, the bar for one bill, and the deductees. Offline, a made-up client; no client data needed.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_review.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8155), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
BILLS = [("Alpha Consultants", "AAAPA1234A", "A/1", "2026-09-02", 100000, "professional"),
         ("Beta Traders", "", "B/7", "2026-09-05", 5000, "contract"),
         ("Gamma Rentals", "AAAFG5678B", "G/3", "2026-09-08", 60000, "rent_pm")]
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8155/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    cid = pg.evaluate("""(bills) => { const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; S.coId = c.id;
      const known = new Set(rules().map(r => r.id));
      bills.forEach(([n, pan, no, d, amt, nat]) => { const e = newEntry("Manual entry"); Object.assign(e.x, {vendorName: n, vendorPan: pan, invoiceNo: no, invoiceDate: d, taxable: amt, total: amt});
        e.natureId = known.has(nat) ? nat : rules()[1].id; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; });
      return c.id; }""", BILLS)
    pg.evaluate("(cid) => openCompany(cid).then(() => goStep('review', 'bills'))", cid); pg.wait_for_timeout(1200)
    app = lambda: pg.inner_text("#app")
    rows = lambda: pg.locator("#app table.revtbl tbody tr")
    bar = lambda: pg.inner_text("#app .actionbar")
    ok("Review 3 uploaded bills" in app() and rows().count() == 3, "the review table: three bills")
    want_tds = pg.evaluate("money0 ? INR.format(r2(draftRows().reduce((a, r) => a + num(r.c.tds), 0))) : ''")
    ok(want_tds in pg.inner_text("#app .bk-figs"), "the TDS total is the rules' figure (" + want_tds + ")")
    ready = pg.evaluate("draftRows().filter(r => !(r.c.missing || []).length && !r.c.flags.some(f => f.lvl === 'hi') && !r.e.confirmType).length")
    ok("3 to review" in bar().replace("\n", " ") and ("Approve all that are ready (%d)" % ready) in bar(), "the bar: 3 to review, %d ready" % ready)
    # the filter box
    pg.fill('#app input[aria-label="Filter the bills"]', "gamma"); pg.wait_for_timeout(500)
    ok(rows().count() == 1 and "1 of 3 shown" in app() and pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Filter the bills", "filter “gamma”: one bill, “1 of 3 shown”, the cursor stays in the box")
    pg.fill('#app input[aria-label="Filter the bills"]', "zzzz"); pg.wait_for_timeout(400)
    ok(rows().count() == 0 and "No bill matches the filter." in app() and pg.locator('#app input[aria-label="Filter the bills"]').count() == 1, "nothing matches: says so, and the box stays to clear it")
    pg.fill('#app input[aria-label="Filter the bills"]', ""); pg.wait_for_timeout(400)
    # ticking
    pg.click('#app input[aria-label="Select Beta Traders"]'); pg.wait_for_timeout(400)
    ok("1 selected" in bar() and "Approve 1" in bar(), "tick one: “1 selected” and its buttons")
    pg.click('#app input[aria-label="Select all shown"]'); pg.wait_for_timeout(400)
    ok("3 selected" in bar() and pg.is_checked('#app input[aria-label="Select Alpha Consultants"]'), "tick all: three")
    pg.click('#app .actionbar button:has-text("Do not book TDS")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("draftRows().every(r => !r.c.tds)"), "“Do not book TDS” on all three: no TDS booked")
    pg.click('#app .actionbar button:has-text("Book TDS")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("draftRows().every(r => r.c.tds > 0 || r.c.rule.basis === 'never')"), "“Book TDS”: booked on each (deducted even below the limit)")
    pg.click('#app .actionbar button:has-text("Clear")'); pg.wait_for_timeout(400)
    ok("to review" in bar() and "selected" not in bar(), "Clear: nothing selected")
    # one row's own controls
    row = rows().filter(has_text="Beta Traders")
    row.locator('input[aria-label="Book TDS"]').click(); pg.wait_for_timeout(400)
    ok(pg.evaluate("draftRows().find(r => r.e.x.vendorName === 'Beta Traders').c.tds") == 0, "untick the TDS box on one bill: not booked")
    other = pg.evaluate("rules().find(r => r.basis !== 'never' && r.id !== draftRows().find(x => x.e.x.vendorName === 'Beta Traders').e.natureId).id")
    row.locator('select[aria-label="Payment type"]').select_option(other); pg.wait_for_timeout(400)
    ok(pg.evaluate("draftRows().find(r => r.e.x.vendorName === 'Beta Traders').e.natureId") == other, "the payment type chosen in the row is kept")
    # the column filter (an old pop-up) opens under its funnel in the React table
    pg.click('#app button[aria-label="Filter Payment type"]'); pg.wait_for_timeout(500)
    ok(pg.evaluate("(() => { const p = document.getElementById('colpop'); return !!p && getComputedStyle(p).display !== 'none' && p.getBoundingClientRect().top > 0; })()"), "the column filter opens, placed under its column")
    pg.keyboard.press("Escape"); pg.evaluate("S.colPop = null; render()"); pg.wait_for_timeout(300)
    # the filter chips over the list: a chip opens its column's filter box, ✕ removes it, Clear all
    pg.evaluate("S.revF = {sup: 'Alpha', no: 'A/'}; render()"); pg.wait_for_timeout(400)
    ok(pg.locator("#app .chipbar .fchip").count() == 2 and "Supplier has “Alpha”" in pg.inner_text("#app .chipbar"), "the filters set show as chips")
    pg.click('#app .chipbar .fchip-l:has-text("Supplier")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.colPop && S.colPop.k") == "sup", "a chip opens its column's filter box")
    pg.evaluate("S.colPop = null; render()"); pg.wait_for_timeout(200)
    pg.click('#app .chipbar .fchip:has-text("Bill no.") .fchip-x'); pg.wait_for_timeout(400)
    ok(not pg.evaluate("S.revF.no") and pg.locator("#app .chipbar .fchip").count() == 1, "✕ removes that filter")
    pg.click('#app .chipbar button:text-is("Clear all")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("Object.keys(S.revF).length") == 0 and pg.locator("#app .chipbar").count() == 0, "Clear all removes every filter")
    # the drawer
    pg.click('#app button.pn:has-text("Alpha Consultants")'); pg.wait_for_timeout(600)
    ok(pg.locator("#app aside.drawer").count() == 1 and "1 of 3" in pg.inner_text("#app .drawer-head") and pg.locator("#app aside.drawer .detail h2").inner_text() == "Alpha Consultants", "a click on the supplier opens the bill in the drawer (1 of 3)")
    ok("enter" in pg.get_attribute("#app aside.drawer", "class"), "it slides in when it opens")
    ok("No entry needed" in bar(), "the bar is the bill's own now")
    f = pg.locator('#app aside.drawer label:has-text("Invoice no.") input'); f.fill("A/1-X"); pg.wait_for_timeout(500)
    ok(pg.evaluate("draftRows().find(r => r.e.x.vendorName === 'Alpha Consultants').e.x.invoiceNo") == "A/1-X" and "enter" not in pg.get_attribute("#app aside.drawer", "class"), "typing in the drawer changes the bill; it does not slide in again")
    pg.screenshot(path=OUT + "/react-drawer.png")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
    ok(pg.locator("#app aside.drawer").count() == 0 and "to review" in bar(), "Esc closes the drawer")
    pg.click('#app button[aria-label="Open this bill"] >> nth=0'); pg.wait_for_timeout(500)
    pg.click('#app .drawer-head button:has-text("Close")'); pg.wait_for_timeout(500)
    ok(pg.locator("#app aside.drawer").count() == 0, "↗ opens it, Close closes it")
    # approve one from its row, delete one
    n = rows().count()
    ready_row = pg.locator('#app table.revtbl tbody tr button:has-text("Approve")')
    if ready_row.count():
        ready_row.first.click(); pg.wait_for_timeout(500)
        ok(rows().count() == n - 1 and pg.evaluate("Object.values(D().entries).filter(e => e.status === 'approved').length") == 1, "Approve in a row: approved, out of the table")
    else: ok(False, "no row ready to approve")
    n = rows().count()
    rows().first.locator('button[aria-label="Delete this bill"]').click(); pg.wait_for_timeout(400)
    ok(pg.locator("#confirmBox .cbx").is_visible(), "✕ asks first")
    pg.click('#confirmBox button[data-cbx="yes"]'); pg.wait_for_timeout(600)
    ok(rows().count() == n - 1, "and deletes it")
    pg.screenshot(path=OUT + "/react-review.png", full_page=True)
    # one at a time: the bar for one bill
    pg.click('#app button:has-text("One at a time")'); pg.wait_for_timeout(500)
    ok(pg.locator("#app .queue li").count() == 1 and "No entry needed" in bar(), "one at a time: the list, and the bill's bar")
    pg.click('#app .actionbar button:has-text("No entry needed")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("Object.values(D().entries).filter(e => e.status === 'rejected').length") == 1, "“No entry needed” marks it so")
    # deductees
    pg.evaluate("goTab('deductees')"); pg.wait_for_timeout(600)
    ok(pg.inner_text("#app .sethead h2") == "Suppliers" and "Add what was booked before FinCom was used for ZZ Zeta Exports" in app(), "Client setup → Suppliers")
    pg.click('#app button:has-text("Add supplier")'); pg.wait_for_timeout(500)
    nm = pg.locator('#app .pane label:has-text("Name") >> nth=0 >> input')
    nm.fill(""); nm.click(); pg.keyboard.type("Delta Transport", delay=10); pg.wait_for_timeout(400)
    ok(pg.locator("#app .pane h2").inner_text() == "Delta Transport" and "Delta Transport" in pg.inner_text("#app table.data"), "typing the name: the heading and the table follow")
    pg.fill('#app .pane label:has-text("PAN") input', "aaapd9999q"); pg.wait_for_timeout(300)
    ok(pg.evaluate("Object.values(D().parties).find(p => p.name === 'Delta Transport').pan") == "AAAPD9999Q", "PAN kept in capitals")
    cr = pg.locator('#app .pane input[aria-label$=": credited"]').first
    cr.click(); pg.keyboard.type("25000.5", delay=10); pg.wait_for_timeout(300)
    ok(cr.input_value() == "25000.5" and pg.evaluate("money0(25000.5)") in pg.inner_text("#app table.data >> nth=0"), "an amount credited earlier: typed as is, and counted in the table" + " [" + cr.input_value() + "]")
    pg.click('#app .pane label:has-text("Do not book TDS") input'); pg.wait_for_timeout(400)
    ok(pg.locator('#app .pane label:has-text("Reason") select').count() == 1 and pg.evaluate("Object.values(D().parties).find(p => p.name === 'Delta Transport').noTds") is True, "no TDS for this deductee: a reason is asked")
    pg.click('#app .pane button:has-text("Close")'); pg.wait_for_timeout(300)
    ok(pg.locator("#app .pane h2").count() == 0, "Close")
    pg.click('#app button[aria-label="Edit Delta Transport"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#app .pane h2").inner_text() == "Delta Transport", "Edit opens it again")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
