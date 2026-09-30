"""python3 run_react_gst.py - GSTR-1 and GSTR-3B in React, with the books in tests/data: finding a customer, opening one,
the part filter, typing a reversal into 3B table 4(B)(2), and the link to GST settings.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_react_gst.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8157), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8157/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "gst"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    # the month with the most customers
    pg.evaluate("() => { const n = ym => new Set(Object.values(GSTR.one(ym, S.gstReg || '')).filter(Array.isArray).flat().map(r => r.gstin || r.party)).size; S.gstYm = GSTR.months().reduce((a, m) => n(m) > n(a) ? m : a); render(); }")
    pg.click('nav[aria-label="GST"] button[data-part="r1"]'); pg.wait_for_timeout(500)
    rows = lambda: pg.locator("#r1Table > tbody > tr").count()
    n0 = rows()
    ok(n0 > 1 and "HSN summary (12)" in pg.inner_text("#app"), "GSTR-1: customers, and the HSN summary")
    first = pg.evaluate("document.querySelector('#r1Table tbody tr td button').textContent.slice(2)")
    box = pg.locator('input[aria-label="Find a customer, invoice or GSTIN"]'); box.click(); pg.keyboard.type(first[:6], delay=20); pg.wait_for_timeout(600)
    ok(rows() < n0 and pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Find a customer, invoice or GSTIN", "typing “%s”: fewer customers, the cursor stays in the box" % first[:6])
    pg.click('.revfilter button.linkbtn:text-is("Clear")'); pg.wait_for_timeout(400)
    ok(rows() == n0, "Clear: all of them again")
    pg.click('#r1Table tbody tr td button >> nth=0'); pg.wait_for_timeout(400)
    ok(pg.locator("#r1Table table").count() == 1, "a click on a customer opens its invoices")
    pg.click('#r1Table tbody tr td button >> nth=0'); pg.wait_for_timeout(400)
    ok(pg.locator("#r1Table table").count() == 0, "and again closes them")
    # the funnel on a column heading, as on every old table: filters the customers, and stays through a redraw
    hsn = pg.locator('#r1Table')
    n = hsn.locator("tbody tr").count()
    ok(n >= 4 and hsn.locator("th .gff").count() == 5, "funnels on the customers' headings")
    if n >= 4:
        rate = first[:6]
        hsn.locator('th .gff[data-gfi="0"]').click(); pg.wait_for_timeout(300)
        pg.fill('#gfpop input[data-gfin="q"]', rate); pg.wait_for_timeout(300); pg.click('#gfpop [data-gfx="close"] >> nth=-1'); pg.wait_for_timeout(300)
        vis = lambda: pg.evaluate("(t) => Array.from(t.tBodies[0].rows).filter(r => r.style.display !== 'none').length", hsn.element_handle())
        k = vis(); ok(0 < k < n and "Showing" in pg.inner_text("#app .gf-bar"), "filtered to “%s”: %d of %d rows" % (rate, k, n))
        pg.evaluate("render()"); pg.wait_for_timeout(400)
        ok(vis() == k and hsn.locator("th .gff").count() == hsn.locator("th").count(), "a redraw keeps the filter and one funnel per heading")
        pg.click('#app .gf-bar button[data-gfclear]'); pg.wait_for_timeout(300)
        ok(vis() == n, "Clear filters: all rows")
    pg.select_option('select[aria-label="Part"]', "B2B"); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.r1F.part") == "B2B", "the part filter")
    pg.click('nav[aria-label="GST"] button[data-part="r3b"]'); pg.wait_for_timeout(500)
    before = pg.inner_text('tr:has-text("(C) Net ITC available")')
    inp = pg.locator('input[aria-label="rev2 IGST"]'); inp.fill("1000"); inp.press("Tab"); pg.wait_for_timeout(500)
    k = pg.evaluate("(S.gstReg || '') + '|' + S.gstYm")
    ok(pg.evaluate("S.books.gst3b[%s].rev2.igst" % json.dumps(k)) == 1000 and pg.inner_text('tr:has-text("(C) Net ITC available")') != before, "3B 4(B)(2): 1,000 typed is kept, and net ITC changes")
    # the input register: a chip filters, again clears; the find box keeps the cursor; the whole year
    pg.click('nav[aria-label="GST"] button[data-part="inreg"]'); pg.wait_for_timeout(600)
    reg = lambda: pg.inner_text("#app table.bk-table.fixed tbody tr:last-child")
    all_ = reg()
    pg.click('#app .gf-chips button.gf-chip >> nth=0'); pg.wait_for_timeout(400)
    ok(" of " in reg() and pg.locator("#app .gf-chip.on").count() == 1, "a chip filters the register: " + reg().split("\t")[0])
    pg.click('#app .gf-chip.on'); pg.wait_for_timeout(400)
    ok(reg() == all_ and pg.evaluate("S.inregF") == "", "the chip again: every document")
    box = pg.locator('input[aria-label="Find in the register"]'); box.click(); pg.keyboard.type(first[:4], delay=20); pg.wait_for_timeout(600)
    ok(pg.evaluate("document.activeElement.getAttribute('aria-label')") == "Find in the register", "the find box keeps the cursor while typing")
    box.fill(""); pg.select_option('select[aria-label="Period"]', "year"); pg.wait_for_timeout(800)
    ok("Input register, the year" in pg.inner_text("#app"), "the whole year")
    pg.select_option('select[aria-label="Period"]', "month"); pg.wait_for_timeout(400)
    pg.click('nav[aria-label="GST"] button[data-part="r3b"]'); pg.wait_for_timeout(500)
    pg.click('button.linkbtn:text-is("change in GST settings")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("S.tab") == "gstset", "“change in GST settings” opens them")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
