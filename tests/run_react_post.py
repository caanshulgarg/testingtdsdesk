"""python3 run_react_post.py - Post to Tally and Done in React: the approved bills waiting, sending one back, the Tally
file, ledgers Tally lacks, and the record of what went to Tally. Offline, a made-up client; no client data needed.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_post.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8156), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
BILLS = [("Alpha Consultants", "AAAPA1234A", "A/1", "2026-09-02", 100000), ("Gamma Rentals", "AAAFG5678B", "G/3", "2026-09-08", 60000), ("Kappa Labs", "AAAPK1111K", "K/9", "2026-09-09", 20000)]
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 950}, accept_downloads=True); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8156/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    cid = pg.evaluate("""(bills) => { const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; S.coId = c.id;
      bills.forEach(([n, pan, no, d, amt]) => { const e = newEntry("Manual entry"); Object.assign(e.x, {vendorName: n, vendorPan: pan, invoiceNo: no, invoiceDate: d, taxable: amt, total: amt});
        e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; });
      return c.id; }""", BILLS)
    pg.evaluate("(cid) => openCompany(cid).then(() => { Object.values(D().entries).forEach(e => approve(e)); refreshStats(cid); goStep('post', 'bills'); })", cid); pg.wait_for_timeout(1500)
    app = lambda: pg.inner_text("#app")
    ok(pg.locator("#app .pcard").count() == 3 and "Purchase bills\n3" in pg.inner_text("#app .post-sum"), "Post to Tally: three cards, three bills")
    ok("3 approved entries waiting" in app() and pg.locator("#post-bills table.data tbody tr").count() == 3, "the bills waiting, in a table")
    tds = pg.evaluate("money(Object.values(D().entries).reduce((a, e) => a + e.snapshot.tds, 0))")
    ok(("TDS in these entries: " + tds) in app(), "their TDS: " + tds)
    ok("Import into Tally" in app() and "Professional Charges" in app(), "no Tally connected: how to import the file, naming the ledgers it needs")
    # one back to review
    pg.click('#post-bills tr:has-text("Kappa Labs") button:has-text("Back to review")'); pg.wait_for_timeout(500)
    ok(pg.locator("#post-bills table.data tbody tr").count() == 2 and pg.evaluate("Object.values(D().entries).find(e => e.x.vendorName === 'Kappa Labs').status") == "draft" and "Purchase bills" in pg.inner_text("#post-bills h3"), "Back to review: out of the list, a draft again, still on this page")
    pg.click('#post-bills tr:has-text("Gamma Rentals") button:has-text("Delete")'); pg.wait_for_timeout(300)
    ok(pg.locator("#confirmBox .cbx").is_visible(), "Delete asks first")
    pg.click('#confirmBox button[data-cbx="no"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#post-bills table.data tbody tr").count() == 2, "Cancel keeps it")
    # a ledger Tally does not have (Tally's ledger list known from the bank side)
    pg.evaluate("""() => { S.bank = S.bank && S.bank.cid === S.coId ? S.bank : {cid: S.coId, rows: [], stmts: [], sel: new Set(), sticky: new Set(), f: {}}; S.bank.loading = false;
      S.bank.ledgers = Object.assign({}, S.bank.ledgers, {list: ['Alpha Consultants', 'Gamma Rentals', 'Legal and Professional Charges', 'TDS Payable', 'Input IGST', 'Input CGST', 'Input SGST', 'Round Off'].map(n => ({name: n}))}); render(); }""")
    pg.wait_for_timeout(500)
    ok("not in Tally" in pg.inner_text("#post-bills") and pg.locator('#post-bills select[aria-label="Tally ledger for Professional Charges"]').count() == 1, "a ledger not in Tally is listed, with a choice of Tally's ledgers")
    pg.select_option('#post-bills select[aria-label="Tally ledger for Professional Charges"]', "Legal and Professional Charges"); pg.wait_for_timeout(200)
    pg.click('#post-bills tr:has-text("Professional Charges") button:has-text("Replace")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("Object.values(D().entries).filter(e => e.status === 'approved').every(e => e.snapshot.lines.some(l => l.ledger === 'Legal and Professional Charges'))"), "Replace: the waiting bills use Tally's ledger")
    pg.screenshot(path=OUT + "/react-post.png", full_page=True)
    # the Tally file, marked as sent
    with pg.expect_download() as dl: pg.click('#post-bills button:has-text("Download Tally file")')
    ok(dl.value.suggested_filename.endswith((".zip", ".xml")), "Download Tally file: " + dl.value.suggested_filename)
    pg.wait_for_timeout(800)
    ok(pg.evaluate("Object.values(D().entries).filter(e => e.exportedAt).length") == 2 and "0 approved entries waiting" in app(), "marked as sent: nothing left waiting")
    # Done: what went to Tally
    pg.evaluate("""() => { S.firm.postLog = (S.firm.postLog || []).concat([
      {at: '2026-09-20T10:00:00Z', what: 'bill', co: S.coId, ref: 'A/1', amount: 100000, tally: {vchType: 'Purchase', masterId: '77', company: 'Zeta Exports'}, by: 'a@b.c'},
      {at: '2026-09-21T10:00:00Z', what: 'bank', co: 'other-client', ref: 'NEFT 1', amount: 500, tally: {vchType: 'Payment', masterId: '78'}, by: 'a@b.c'}]); goStep('done', 'bills'); }""")
    pg.wait_for_timeout(600)
    ok("Bills posted\n2" in pg.inner_text("#app .post-sum"), "Done: two bills posted")
    ok("1 entry for ZZ Zeta Exports" in app() and "Purchase 77" in app() and "NEFT 1" not in app(), "the record of what went to Tally, this client only")
    pg.click('#app button:has-text("All clients")'); pg.wait_for_timeout(400)
    ok("2 entries across every client" in app() and "NEFT 1" in app(), "All clients: both")
    pg.click('#app button:has-text("Approved bills")'); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.tab") == "invoices" and pg.evaluate("S.filter") == "approved", "“Approved bills” opens them")
    # the same record in Settings (an old screen around it)
    pg.evaluate("S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'postlog'; render()"); pg.wait_for_timeout(500)
    ok("Everything sent to Tally" in app() and "across every client" in app() and pg.locator('#app button:text-is("All clients")').count() == 0, "in Settings: every client, no per-client switch")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
