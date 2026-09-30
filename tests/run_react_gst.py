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
    pg.select_option('select[aria-label="Part"]', "B2B"); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.r1F.part") == "B2B", "the part filter")
    pg.click('nav[aria-label="GST"] button[data-part="r3b"]'); pg.wait_for_timeout(500)
    before = pg.inner_text('tr:has-text("(C) Net ITC available")')
    inp = pg.locator('input[aria-label="rev2 IGST"]'); inp.fill("1000"); inp.press("Tab"); pg.wait_for_timeout(500)
    k = pg.evaluate("(S.gstReg || '') + '|' + S.gstYm")
    ok(pg.evaluate("S.books.gst3b[%s].rev2.igst" % json.dumps(k)) == 1000 and pg.inner_text('tr:has-text("(C) Net ITC available")') != before, "3B 4(B)(2): 1,000 typed is kept, and net ITC changes")
    pg.click('button.linkbtn:text-is("change in GST settings")'); pg.wait_for_timeout(500)
    ok(pg.evaluate("S.tab") == "gstset", "“change in GST settings” opens them")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
