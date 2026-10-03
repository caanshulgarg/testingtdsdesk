"""python3 run_react_txn_dash.py - a client's Dashboard and Transactions in React. Offline, a made-up client.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_txn_dash.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8162), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8162/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate("""() => { const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      [["Alpha Consultants", "A/1", 100000], ["Gamma Rentals", "G/3", 60000], ["Kappa Labs", "K/9", 20000]].forEach(([n, no, amt], i) => { const e = newEntry("Manual entry");
        Object.assign(e.x, {vendorName: n, vendorPan: "AAAPA1234A", invoiceNo: no, invoiceDate: "2026-09-0" + (i + 1), taxable: amt, total: amt}); e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; });
      // review of 02-Oct-2026: a bill is in Tally once its posting is confirmed there (billInTally: postVerified), not when sent
      return openCompany(c.id).then(() => { const es = Object.values(D().entries); approve(es[0]); approve(es[1]); es[0].exportedAt = "2026-09-20T10:00:00Z"; es[0].postVerified = true; refreshStats(c.id); goClient("dash"); }); }""")
    pg.wait_for_timeout(1200)
    tile = lambda label: pg.locator('#app .dtile:has-text("%s") b' % label).inner_text()
    ok(tile("Bills to review") == "1" and tile("Post to Tally") == "1", "Dashboard: 1 bill to review, 1 ready to post")
    ok("Alpha Consultants" in pg.inner_text("#app .dash-list"), "posted lately: the bill sent to Tally")
    tds = pg.evaluate("money0 ? INR.format(r2(Object.values(D().entries).filter(e => e.status !== 'rejected' && e.snapshot).reduce((a, e) => a + num(e.snapshot.tds), 0))) : ''")
    ok(tds in pg.inner_text("#app .dash-big"), "TDS this year: " + tds)
    pg.click('#app .dtile:has-text("Bills to review")'); pg.wait_for_timeout(600)
    ok(pg.evaluate("S.tab") == "invoices", "a tile opens its work")
    pg.evaluate("goClient('dash')"); pg.wait_for_timeout(500)
    pg.fill("#dashAsk", "trial balance"); pg.keyboard.press("Enter"); pg.wait_for_timeout(800)
    ok(pg.evaluate("S.tab") == "books" and pg.evaluate("S.booksTab") == "lookup", "the question box opens Look up")
    # Transactions
    pg.evaluate("goClient('txn')"); pg.wait_for_timeout(800)
    rows = lambda: pg.locator("#app table.txntbl tbody tr")
    ok(rows().count() == 3 and "3 of 3" in pg.inner_text("#app .revfilter"), "Transactions: the three bills")
    ok("In Tally" in pg.inner_text("#app table.txntbl tr:has-text('Alpha Consultants')") and "Post to Tally" in pg.inner_text("#app table.txntbl tr:has-text('Gamma Rentals')"), "where each stands in Tally")
    pg.fill('#app input[aria-label="Find a transaction"]', "kappa"); pg.wait_for_timeout(500)
    ok(rows().count() == 1 and pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Find a transaction", "find: one, the cursor stays")
    pg.fill('#app input[aria-label="Find a transaction"]', ""); pg.wait_for_timeout(400)
    pg.select_option('#app select[aria-label="Status"]', "ok"); pg.wait_for_timeout(400)
    ok(rows().count() == 1, "status In Tally: one")
    pg.select_option('#app select[aria-label="Status"]', ""); pg.wait_for_timeout(300)
    with pg.expect_download() as dl: pg.click('#app button:text-is("CSV")')
    ok(dl.value.suggested_filename.endswith(".csv"), "CSV download")
    pg.click('#app table.txntbl tr:has-text("Kappa Labs") button:has-text("Open")'); pg.wait_for_timeout(600)
    ok(pg.evaluate("S.tab") == "invoices" and pg.evaluate("D().entries[S.selected].x.vendorName") == "Kappa Labs", "Open: the bill, where it is worked on")
    pg.evaluate("goClient('txn')"); pg.wait_for_timeout(500)
    pg.click('#app nav[aria-label="Kind"] button:has-text("Bank")'); pg.wait_for_timeout(1200)
    ok(pg.evaluate("txnTab()") == "bank" and "Nothing here yet." in pg.inner_text("#app"), "the Bank register opens (no statement yet)")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
