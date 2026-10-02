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
    # review of 02-Oct-2026 (C15-C18): one line, one table of the entries, one main button, the rest under More
    T = "#app [data-post-table]"
    ok(pg.locator("#app [data-post-line]").count() == 1 and pg.locator(T + " tbody tr").count() == 3 and pg.inner_text("#app [data-post-main]") == "Post 3 to Tally", "Post to Tally: one line, the three bills in one table, Post 3 to Tally")
    # second pass of 02-Oct-2026: the ledgers on one line, the party first
    ok("Alpha Consultants · Professional Charges · TDS" in pg.inner_text(T), "each bill's ledgers on one line: party, expense, TDS")
    pg.evaluate("document.querySelector(\"#app details[data-more='post']\").open = true"); pg.click('#app [data-more="post"] button:has-text("How to import the file into Tally")'); pg.wait_for_timeout(300)
    ok("Import into Tally" in app() and "Professional Charges" in pg.inner_text("#app [data-import-steps]"), "no Tally connected: More → how to import the file, naming the ledgers it needs")
    # one back to review
    pg.click(T + ' tr:has-text("Kappa Labs") button:has-text("Back to review")'); pg.wait_for_timeout(500)
    ok(pg.locator(T + " tbody tr").count() == 2 and pg.evaluate("Object.values(D().entries).find(e => e.x.vendorName === 'Kappa Labs').status") == "draft" and pg.locator("#app [data-post-page]").count() == 1, "Back to review: out of the list, a draft again, still on this page")
    # a ledger Tally does not have (Tally's ledger list known from the bank side)
    pg.evaluate("""() => { S.bank = S.bank && S.bank.cid === S.coId ? S.bank : {cid: S.coId, rows: [], stmts: [], sel: new Set(), sticky: new Set(), f: {}}; S.bank.loading = false;
      S.bank.ledgers = Object.assign({}, S.bank.ledgers, {list: ['Alpha Consultants', 'Gamma Rentals', 'Legal and Professional Charges', 'TDS Payable', 'Input IGST', 'Input CGST', 'Input SGST', 'Round Off'].map(n => ({name: n}))}); render(); }""")
    pg.wait_for_timeout(500)
    # second pass of 02-Oct-2026: a bill using a ledger Tally lacks needs attention (one line each, with the choice of
    # Tally's ledger), and is not in Ready to post
    led = pg.locator('#app [data-post-attention] li[data-attn-kind="ledger"]')
    ok(led.count() == 2 and "Ledger “Professional Charges” is not in Tally" in led.first.inner_text() and pg.locator('#app select[aria-label="Tally ledger for Professional Charges"]').count() == 2
       and pg.locator(T).count() == 0 and pg.locator("#app [data-post-main]").count() == 0, "a ledger not in Tally: its bills need attention, with a choice of Tally's ledgers, and are not ready")
    led.first.locator("select").select_option("Legal and Professional Charges"); pg.wait_for_timeout(200)
    led.first.locator('button:has-text("Replace")').click(); pg.wait_for_timeout(500)
    print(pg.evaluate("Object.values(D().entries).filter(e => e.status === 'approved').map(e => e.snapshot.lines.map(l => l.ledger + '/' + l.role + '/' + !!exactLedger(l.ledger)).join(','))"), pg.inner_text('#app [data-post-page]')[:600])
    ok(pg.evaluate("Object.values(D().entries).filter(e => e.status === 'approved').every(e => e.snapshot.lines.some(l => l.ledger === 'Legal and Professional Charges'))") and pg.locator(T + " tbody tr").count() == 2,
       "Replace: the waiting bills use Tally's ledger, and are ready to post again")
    pg.screenshot(path=OUT + "/react-post.png", full_page=True)
    # the Tally file, marked as sent
    pg.evaluate("document.querySelector(\"#app details[data-more='post']\").open = true")
    with pg.expect_download() as dl: pg.click('#app [data-more="post"] button:has-text("Download Tally file")')
    ok(dl.value.suggested_filename.endswith((".zip", ".xml")), "Download Tally file: " + dl.value.suggested_filename)
    pg.wait_for_timeout(800)
    # review of 02-Oct-2026: a Tally file is not "in Tally" until Tally confirms it; the bills stay listed, marked so, and
    # are not posted again from here (one count everywhere: 2 for Tally)
    # second pass of 02-Oct-2026: they need attention (once each), Ready to post says so, no "Post 0 to Tally"
    rows = pg.inner_text("#app [data-post-attention]") if pg.locator("#app [data-post-attention]").count() else ""
    ok(pg.evaluate("Object.values(D().entries).filter(e => e.exportedAt).length") == 2 and rows.count("In a Tally file") == 2 and pg.locator("#app [data-post-main]").count() == 0
       and pg.inner_text("#app [data-post-empty]") == "Nothing waiting to post" and pg.evaluate("postCounts(S.coId)") == {"ready": 0, "attention": 2}, "marked as sent: listed as in a Tally file, needing attention; nothing ready to post")
    # Done: what went to Tally
    pg.evaluate("""() => { S.firm.postLog = (S.firm.postLog || []).concat([
      {at: '2026-09-20T10:00:00Z', what: 'bill', co: S.coId, ref: 'A/1', amount: 100000, tally: {vchType: 'Purchase', masterId: '77', company: 'Zeta Exports'}, by: 'a@b.c'},
      {at: '2026-09-21T10:00:00Z', what: 'bank', co: 'other-client', ref: 'NEFT 1', amount: 500, tally: {vchType: 'Payment', masterId: '78'}, by: 'a@b.c'}]); goStep('done', 'bills'); }""")
    pg.wait_for_timeout(600)
    ok("Bills posted\n0" in pg.inner_text("#app .post-sum") and "2 approved in all" in pg.inner_text("#app .post-sum"), "Done: a Tally file is not counted as posted until Tally confirms it (0 posted, 2 approved)")
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
