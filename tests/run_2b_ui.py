"""python3 run_2b_ui.py - the 2B screen in a browser: bring in two months, work every tab."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8126), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctxb = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctxb.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8126/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => {
      const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"});
      S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {});
      window.__bk = S.books; S.booksTab = "gst"; S.gstPart = "r2b"; S.gstYm = "202506"; S.gstReg = "07"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    ok("Generate JSON" in pg.inner_text("#app"), "empty state explains where the 2B comes from")
    # the same faults as run_2b.js: remove the GSTIN of the July voucher that test used
    pg.set_input_files("#twoBIn", [os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")), "2B_062025_test.json"), os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")), "2B_072025_test.json")]); pg.wait_for_timeout(1500)
    t = pg.inner_text("#app")
    ok(pg.evaluate("Object.keys(S.books.twoBs).length") == 2, "two months brought in at once")
    ok("To confirm" in t and "In 2B, not in Tally" in t and "In Tally, not in 2B" in t, "tiles shown")
    pg.screenshot(path=OUT + "/2b-top.png", full_page=False)
    # to confirm: say 'Same' to the first
    pg.click('nav[aria-label="2B reconciliation"] button:has-text("To confirm")'); pg.wait_for_timeout(500)
    n0 = pg.locator('#r2Pairs button:text-is("Same")').count()
    ok(n0 >= 1, "matches to confirm listed: %d" % n0)
    pg.locator('#r2Pairs button:text-is("Same")').first.click(); pg.wait_for_timeout(600)
    ok(pg.locator('#r2Pairs button:text-is("Same")').count() == n0 - 1, "'Same' moves it out of To confirm")
    # differences tab, then unlink one
    pg.click('nav[aria-label="2B reconciliation"] button:has-text("Differences")'); pg.wait_for_timeout(500)
    t = pg.inner_text("#app")
    ok("taxable differs by 500.00" in t and "IGST in the books" in t, "differences explained in words")
    pg.screenshot(path=OUT + "/2b-diff.png", full_page=True)
    before = pg.locator("#r2Pairs tbody tr").count()
    pg.locator('#r2Pairs td.ac button').first.click(); pg.wait_for_timeout(600)
    ok(pg.locator("#r2Pairs tbody tr").count() == before - 1, "unlink removes the pair")
    # 2B only: link the unlinked one back by hand
    pg.click('nav[aria-label="2B reconciliation"] button:has-text("In 2B only")'); pg.wait_for_timeout(500)
    sels = pg.locator('select[aria-label="Booked in Tally as"]')
    ok(sels.count() >= 3, "2B-only rows with a Tally choice: %d" % sels.count())
    idx = None
    for i in range(sels.count()):
        if sels.nth(i).locator("option").count() > 1: idx = i; break
    ok(idx is not None, "a close Tally document is offered")
    if idx is not None:
        val = sels.nth(idx).locator("option").nth(1).get_attribute("value")
        sels.nth(idx).select_option(val); pg.wait_for_timeout(600)
        ok(pg.evaluate("Object.keys(GST2B.state().link).length") == 1, "linked by hand")
    pg.locator('select[aria-label="Remark"]').first.select_option("Not our purchase"); pg.wait_for_timeout(400)
    ok(pg.evaluate("Object.values(GST2B.state().tag).map(t => t.tag)") == ["Not our purchase"], "remark kept")
    t = pg.inner_text("#app")
    ok("IMS: rejected" in t and "ITC not available" in t, "IMS and ITC availability shown")
    # Tally only, with filter
    pg.click('nav[aria-label="2B reconciliation"] button:has-text("In Tally only")'); pg.wait_for_timeout(500)
    pg.select_option('select[aria-label="Which documents"]', "nogstin"); pg.wait_for_timeout(500)
    t = pg.inner_text("#app")
    ok("no GSTIN in Tally" in t, "filter: no GSTIN in Tally")
    pg.fill('input[aria-label="Find in the reconciliation"]', "RENT"); pg.wait_for_timeout(700)
    ok(pg.evaluate("document.activeElement && document.activeElement.dataset.r2f") == "q", "search keeps focus")
    pg.click('.revfilter button:text-is("Clear filters")'); pg.wait_for_timeout(300)
    # suppliers: open one with missing invoices and copy the note
    pg.click('nav[aria-label="2B reconciliation"] button:has-text("Supplier by supplier")'); pg.wait_for_timeout(600)
    pg.locator('#r2Sup tbody button.linkbtn').first.click(); pg.wait_for_timeout(400)
    ok(pg.locator("#r2Sup table").count() == 1, "a supplier opens to its documents")
    pg.screenshot(path=OUT + "/2b-sup.png", full_page=True)
    # year scope, Excel
    pg.click('.row:has(> span:text-is("Reconcile")) button >> nth=1'); pg.wait_for_timeout(700)
    ok("the year" in pg.inner_text("#app") and pg.locator('select[aria-label="Which month"]').count() == 1, "the year at once, with a month filter")
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('button[data-act="twoBExcel"]'); pg.wait_for_timeout(2500)
    ok(any("2B-reco" in n for n in pg.evaluate("window.__saved")), "reconciliation downloads: " + ", ".join(pg.evaluate("window.__saved")))
    pg.click('.row:has(> span:text-is("Reconcile")) button >> nth=0'); pg.wait_for_timeout(300)
    # tolerance
    pg.fill('input[aria-label="Allow a difference of"]', "600"); pg.press('input[aria-label="Allow a difference of"]', "Tab"); pg.wait_for_timeout(600)
    ok(pg.evaluate("GST2B.settings().tol") == 600, "allowed difference saved")
    bad = pg.evaluate("""() => { const bad = []; ['month', 'year', 'all'].forEach(sc => ['suppliers', 'matched', 'diff', 'probable', 'only2b', 'books'].forEach(tb => GSTR.months().forEach(m => {
      S.r2Scope = sc; S.r2Tab = tb; S.gstYm = m; try { render(); } catch (e) { bad.push(sc + tb + m + ': ' + e.message); } }))); return bad; }""")
    ok(not bad, "every scope, tab and month renders" + ("" if not bad else ": " + "; ".join(bad[:3])))
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
