"""python3 run_gst9_ui.py - GSTR-9 and 9C tabs in a browser."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8135), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json")))); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8135/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
      S.booksTab = "gst"; S.gstPart = "g9"; S.gstYm = "202603"; S.gstReg = "07"; render(); }""", books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(2500)
    t = pg.inner_text("#app")
    ok("GSTR-9 for 2025-26" in t and "Supplies made to registered persons (B2B)" in t and "17. HSN summary of outward supplies" in t, "GSTR-9 renders, parts II to VI")
    ok("6J:" not in t, "no 6J difference: credit notes from suppliers reduce credit in 3B as in 6B")
    pg.screenshot(path=OUT + "/gst9.png", full_page=False)
    pg.click('button[data-gstpart="g9c"]'); pg.wait_for_timeout(2500)
    t = pg.inner_text("#app")
    ok("GSTR-9C for 2025-26" in t and "5Q" in t and "12F" in t, "GSTR-9C renders")
    pg.fill('input[data-g9c="adj.5B"]', "100000"); pg.press('input[data-g9c="adj.5B"]', "Tab"); pg.wait_for_timeout(2500)
    ok(pg.evaluate("S.books.gst9c['2025|07'].adj['5B']") == 100000, "an adjustment typed is kept")
    pg.fill('textarea[data-g9c="reasons.6"]', "Unbilled revenue of March booked in April"); pg.press('textarea[data-g9c="reasons.6"]', "Tab"); pg.wait_for_timeout(2500)
    ok("Unbilled revenue of March" in pg.evaluate("S.books.gst9c['2025|07'].reasons['6']"), "a reason typed is kept")
    with ctx.expect_page() as pop:
        pg.click('button[data-act="gst9cPdf"]')
    rp = pop.value; rp.wait_for_timeout(700); ok("GSTR-9C" in rp.inner_text("body") and "Unbilled revenue of March" in rp.inner_text("body"), "9C as PDF, with the reasons"); rp.close()
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('button[data-act="gst9cExcel"]'); pg.wait_for_timeout(3000)
    pg.click('button[data-gstpart="g9"]'); pg.wait_for_timeout(2500); pg.click('button[data-act="gst9Excel"]'); pg.wait_for_timeout(4000)
    ok(len([n for n in pg.evaluate("window.__saved") if "GSTR-9" in n]) == 2, "9 and 9C as Excel: " + ", ".join(pg.evaluate("window.__saved")))
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
