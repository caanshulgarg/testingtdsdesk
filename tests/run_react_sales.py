"""python3 run_react_sales.py - Sales in React: an invoice created here (items, GST, totals), the list with its tabs,
ticking, the bar and Undo, an invoice opened and changed, and Sales settings. Offline, a made-up client.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_sales.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8159), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LEDGERS = ["Alpha Retail LLP", "Beta Stores", "Gamma Mart", "Sales @ 18% Local", "Sales @ 18% Interstate", "Output CGST", "Output SGST", "Output IGST", "Round Off", "HDFC Bank"]
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8159/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate("""(leds) => { const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.bank.ledgers = {list: leds.map(n => ({name: n, group: /Sales/.test(n) ? "Sales Accounts" : /Output|Round/.test(n) ? "Duties & Taxes" : /Bank/.test(n) ? "Bank Accounts" : "Sundry Debtors"})), importedAt: new Date().toISOString(), live: true}; S.tab = "sales"; S.step = null; return loadSales(c.id); }); }""", LEDGERS)
    pg.wait_for_timeout(800)
    app = lambda: pg.inner_text("#app")
    bar = lambda: pg.inner_text("#app .actionbar")
    ok("Add sales invoices" in app() and pg.locator("#salesDrop").count() == 1 and pg.locator("#app .actionbar").count() == 0, "no invoices: the upload box, no bar")
    # an invoice created here
    pg.click('#app button:has-text("Create invoice")'); pg.wait_for_timeout(500)
    ok("New sales invoice" in app() and "invoice total" in bar(), "Create invoice: the form, and its own bar")
    cust = pg.locator('#app input[data-sdcust]'); cust.click(); pg.keyboard.type("Beta St", delay=15); pg.wait_for_timeout(300); pg.keyboard.press("Enter"); pg.wait_for_timeout(600)
    ok(pg.evaluate("SL().draft.customerLedger") == "Beta Stores" and pg.locator('#app label:has-text("Name on invoice") input').input_value() == "Beta Stores", "customer picked from the Tally list: the name on the invoice follows")
    g = pg.evaluate("(() => { const b = '07AAACB1234C1Z'; for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid(b + c)) return b + c; })()")
    pg.fill('#app label:has-text("GSTIN (blank") input', g.lower()); pg.wait_for_timeout(400)
    ok(pg.evaluate("SL().draft.x.pos") == "07" and "IGST" in pg.inner_text("#app .si-grid >> nth=1"), "a Delhi GSTIN: place of supply Delhi, IGST charged")
    d = pg.locator('#app input[aria-label="Item 1"]'); d.click(); pg.keyboard.type("Cotton yarn", delay=10)
    ok(pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Item 1" and d.input_value() == "Cotton yarn", "typing an item: the cursor stays in the box")
    pg.fill('#app input[aria-label="Quantity"]', "10"); pg.fill('#app input[aria-label="Rate"]', "1000"); pg.select_option('#app select[aria-label="GST rate"]', "18"); pg.wait_for_timeout(400)
    ok(pg.evaluate("SL().draft.x.taxable") == 10000 and pg.evaluate("SL().draft.x.total") == 11800 and "11,800" in bar(), "10 × 1,000 at 18%: taxable 10,000, total 11,800")
    pg.click('#app button:has-text("+ Add item")'); pg.wait_for_timeout(300)
    ok(pg.locator('#app input[aria-label="Item 2"]').count() == 1, "+ Add item")
    pg.click('#app button[aria-label="Remove item"] >> nth=1'); pg.wait_for_timeout(300)
    pg.click('#app .actionbar button:has-text("Save invoice")'); pg.wait_for_timeout(700)
    ok(pg.evaluate("SL().list.length") == 1 and pg.evaluate("SL().view") == "list" and pg.locator("#app .bk-overlay").count() == 1, "Save: in the list, and opened")
    pg.click('#app .bk-panel button[aria-label="Close"]'); pg.wait_for_timeout(300)
    # more invoices, as if uploaded
    pg.evaluate("""() => { const s = SL(); [["S/101", "Alpha Retail LLP", 5000], ["S/102", "Gamma Mart", 7000], ["S/103", "Unknown Buyer", 3000]].forEach(([n, c, t], i) => {
        const v = newInvoice({number: n, date: "2026-09-1" + i, customerName: c, customerGstin: "", pos: "09", taxable: t, cgst: r2(t * .09), sgst: r2(t * .09), igst: 0, cess: 0, total: r2(t * 1.18), items: []}, "upload");
        v.fileName = n + ".pdf"; s.list.push(v); mapInvoice(v); v.status = "review"; });
      s.filter = "review"; render(); }""")
    pg.wait_for_timeout(500)
    rows = lambda: pg.locator("#app table.bk-table tbody tr")
    n = pg.evaluate("salesVisible().length")
    ok(rows().count() == n and n >= 3, "To review: %d invoices" % n)
    pg.fill('#app input[aria-label="Search the invoices"]', "gamma"); pg.wait_for_timeout(500)
    ok(rows().count() == 1 and pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Search the invoices", "search: one invoice, the cursor stays")
    pg.fill('#app input[aria-label="Search the invoices"]', ""); pg.wait_for_timeout(400)
    # a customer ledger typed in the row
    box = pg.locator('#app input[aria-label="Customer ledger for S/103"]')
    box.fill("Nobody Ltd"); box.press("Tab"); pg.wait_for_timeout(400)
    ok(box.input_value() == pg.evaluate("inv(SL().list.find(v => v.x.number === 'S/103').id).customerLedger || ''"), "a name not in Tally: refused, the box goes back")
    box.fill("Gamma Mart"); box.press("Tab"); pg.wait_for_timeout(500)
    ok(pg.evaluate("SL().list.find(v => v.x.number === 'S/103').customerLedger") == "Gamma Mart" and "Gamma Mart" in bar(), "a Tally ledger: set, and the bar offers Undo")
    # ticking with Shift, and the bar
    pg.click("#app table.bk-table tbody tr >> nth=0 >> input[type=checkbox]")
    pg.click("#app table.bk-table tbody tr >> nth=2 >> input[type=checkbox]", modifiers=["Shift"]); pg.wait_for_timeout(300)
    ok(pg.evaluate("SL().sel.size") == 3 and "3 selected" in bar(), "tick, Shift-tick: three selected")
    pg.click('#app .actionbar button:has-text("Ignore")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("SL().list.filter(v => v.status === 'ignored').length") == 3 and "ignored" in bar(), "Ignore three, and Undo offered")
    pg.click('#app .actionbar .bk-snack button:has-text("Undo")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("SL().list.filter(v => v.status === 'ignored').length") == 0, "Undo")
    # an invoice opened and changed
    pg.click('#app table.bk-table button.linkbtn:has-text("S/101")'); pg.wait_for_timeout(400)
    ok(pg.locator("#app .bk-panel").count() == 1 and "Sales voucher for Tally" in pg.inner_text("#app .bk-panel"), "an invoice opens in a panel, with its voucher")
    t = pg.locator('#app .bk-panel label:has-text("Taxable value") input'); t.fill("5100"); t.press("Tab"); pg.wait_for_timeout(500)
    ok(pg.evaluate("SL().list.find(v => v.x.number === 'S/101').x.taxable") == 5100, "a figure changed on the invoice is kept")
    dr, cr = pg.evaluate("(() => { const ls = salesLines(SL().list.find(v => v.x.number === 'S/101')); const t = s => r2(ls.filter(l => l.side === s).reduce((a, l) => a + l.amt, 0)); return [t('Dr'), t('Cr')]; })()")
    ok(dr == cr, "the voucher balances (%s = %s)" % (dr, cr))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    ok(pg.locator("#app .bk-panel").count() == 0, "Esc closes it")
    # confirm one
    pg.click('#app tr:has-text("S/102") button:has-text("Confirm")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("SL().list.find(v => v.x.number === 'S/102').status") == "ready", "Confirm: ready to post")
    pg.click('#app .bk-tabs button:has-text("Ready")'); pg.wait_for_timeout(300)
    ok(rows().count() == pg.evaluate("SL().list.filter(v => v.status === 'ready').length"), "the Ready tab")
    # settings
    pg.click('#app .bk-actions button:has-text("Settings")'); pg.wait_for_timeout(400)
    ser = pg.locator('#app .bk-panel label:has-text("Series") input'); ser.fill("ZZ/{FY}/"); ser.press("Tab"); pg.wait_for_timeout(400)
    ok(pg.evaluate("SL().cfg.series") == "ZZ/{FY}/" and "ZZ/" in pg.inner_text("#app .bk-panel"), "Sales settings: the invoice series, and the next number shown")
    pg.screenshot(path=OUT + "/react-sales.png")
    pg.click('#app .bk-panel button[aria-label="Close"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#app .bk-panel").count() == 0, "closed")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
