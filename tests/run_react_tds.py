"""python3 run_react_tds.py - a TDS return in React, used as a user would: tabs, find, filters, sorting, a deductee
opened, a deduction put against a challan, a challan added and removed, a certificate added. Needs the books in
tests/data (books-cache.json). Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_tds.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8164), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8164/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "tds"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(800)
    # the quarter with the most deductions
    fy, q = pg.evaluate("(() => { const by = {}; TDS.rows().forEach(r => { const k = r.fy + '|' + r.q; by[k] = (by[k] || 0) + 1; }); return Object.entries(by).sort((a, b) => b[1] - a[1])[0][0].split('|'); })()")
    pg.evaluate("([fy, q]) => tdsGo(fy, q, '26Q')", [fy, q]); pg.wait_for_timeout(600)
    ok(pg.get_attribute('#app nav[aria-label="Return"] button:has-text("Challans")', "aria-selected") == "true", "%s %s 26Q opens on Challans" % (q, fy))
    ok(pg.locator("#app .help-btn").count() == 1, "“How this tab works” is there")
    # a challan typed in
    d = pg.evaluate("(() => { const r = TDS.rows().find(x => x.fy === '%s' && x.q === '%s'); const t = TDS.ymd(r.date); return t.slice(0,4) + '-' + t.slice(4,6) + '-' + t.slice(6,8); })()" % (fy, q))
    pg.fill('#app input[aria-label="New challan: BSR code"]', "0240020"); pg.fill('#app input[aria-label="New challan: serial"]', "00979")
    pg.fill('#app input[aria-label="New challan: date"]', d); pg.fill('#app input[aria-label="New challan: tax"]', "50000")
    pg.click('#app tr:has(input[aria-label="New challan: tax"]) button:has-text("Add")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("S.books.challans.length") == 1 and "0240020" in pg.inner_text("#tdsChTable") and pg.input_value('#app input[aria-label="New challan: BSR code"]') == "", "a challan added: in the table, and the new-challan row empties")
    pg.click('#app button:has-text("Put them against challans")'); pg.wait_for_timeout(600)
    used = pg.evaluate("TDS.challanUse()[S.books.challans[0].id] || 0")
    ok(used > 0, "deductions put against it (%s used)" % used)
    pg.click('#tdsChTable button.linkbtn:has-text("0240020")'); pg.wait_for_timeout(400)
    ok(pg.locator("#tdsChTable table.bk-table tbody tr").count() > 0, "a challan opened: its deductions")
    # deductions: find, filter, sort
    pg.click('#app nav[aria-label="Return"] button:has-text("Deductions")'); pg.wait_for_timeout(500)
    n0 = pg.locator("#tdsDnTable > tbody > tr").count() - 1
    party = pg.evaluate("TDS.rows().filter(x => x.fy === '%s' && x.q === '%s')[0].party" % (fy, q))
    pg.fill('#app input[aria-label="Find a deductee, PAN, voucher or ledger"]', party[:6]); pg.wait_for_timeout(600)
    n1 = pg.locator("#tdsDnTable > tbody > tr").count() - 1
    ok(0 < n1 <= n0 and pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Find a deductee, PAN, voucher or ledger", "find “%s”: %d of %d, the cursor stays" % (party[:6], n1, n0))
    pg.click('#app button:has-text("Clear filters")'); pg.wait_for_timeout(400)
    ok(pg.locator("#tdsDnTable > tbody > tr").count() - 1 == n0, "Clear filters")
    pg.select_option('#app select[aria-label="Challan"]', "yes"); pg.wait_for_timeout(400)
    ok(pg.locator("#tdsDnTable > tbody > tr").count() - 1 == pg.evaluate("TDS.rows().filter(x => x.fy === '%s' && x.q === '%s' && x.challan).length" % (fy, q)), "Challan: against a challan")
    pg.select_option('#app select[aria-label="Challan"]', ""); pg.wait_for_timeout(300)
    pg.click('#tdsDnTable thead button:has-text("TDS")'); pg.click('#tdsDnTable thead button:has-text("TDS")'); pg.wait_for_timeout(400)
    tds = pg.evaluate("Array.from(document.querySelectorAll('#tdsDnTable > tbody > tr')).slice(0, -1).map(r => num(r.cells[8].innerText.replace(/,/g, '')))")
    ok(tds == sorted(tds, reverse=True) and "↓" in pg.inner_text("#tdsDnTable thead"), "sorted by TDS, largest first")
    # a deduction taken off its challan from the list
    rid = pg.evaluate("TDS.rows().find(x => x.fy === '%s' && x.q === '%s' && x.challan).id" % (fy, q))
    sel = pg.locator("#tdsDnTable select").first
    before = pg.evaluate("TDS.rows().filter(x => x.challan).length")
    sel.select_option(""); pg.wait_for_timeout(500)
    ok(pg.evaluate("TDS.rows().filter(x => x.challan).length") == before - 1, "a deduction taken off its challan")
    # deductees: one opened
    pg.click('#app nav[aria-label="Return"] button:has-text("Deductees")'); pg.wait_for_timeout(500)
    pg.click("#tdsDeTable > tbody > tr >> nth=0 >> button.linkbtn >> nth=0"); pg.wait_for_timeout(400)
    ok(pg.locator("#tdsDeTable table.bk-table").count() == 1, "a deductee opened: their deductions")
    pg.click("#tdsDeTable > tbody > tr >> nth=0 >> button.linkbtn >> nth=0"); pg.wait_for_timeout(400)
    ok(pg.locator("#tdsDeTable table.bk-table").count() == 0, "and closed")
    pg.click('#app nav[aria-label="Return"] button:has-text("Interest, late fee")'); pg.wait_for_timeout(500)
    ok("Interest under 201(1A)" in pg.inner_text("#app") and "By section" in pg.inner_text("#app"), "interest, late fee and checks")
    # the challan removed
    pg.click('#app nav[aria-label="Return"] button:has-text("Challans")'); pg.wait_for_timeout(400)
    pg.click('#tdsChTable button[aria-label="Remove this challan"]'); pg.wait_for_timeout(500)
    ok(pg.evaluate("S.books.challans.length") == 0 and pg.evaluate("Object.keys(S.books.alloc || {}).length") == 0, "the challan removed, and nothing is left against it")
    # certificates
    pg.evaluate("tdsNav('certs')"); pg.wait_for_timeout(400)
    pg.fill('#app input[aria-label="New certificate: deductee"]', party); pg.fill('#app input[aria-label="New certificate: PAN"]', "aaapz1234k"); pg.fill('#app input[aria-label="New certificate: rate"]', "1")
    pg.click('#app tr:has(input[aria-label="New certificate: rate"]) button:has-text("Add")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("S.books.certs.length") == 1 and pg.evaluate("S.books.certs[0].pan") == "AAAPZ1234K", "a certificate added (PAN in capitals)")
    pg.click('#app button[aria-label="Remove this certificate"]'); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.books.certs.length") == 0, "and removed")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
