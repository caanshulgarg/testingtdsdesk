"""python3 run_gstq_ui.py - QRMP and composition chosen in settings; the simple step screens."""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
DATA = os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8145), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(DATA, "books-cache.json")))); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8145/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); LedMaster.confirm(S.books, LedMaster.pending(S.books).map(x => x[0]), true); window.__bk = S.books;
      S.booksTab = "gst"; S.gstPart = "r1"; S.gstYm = "202511"; S.gstReg = "07"; render(); }""", books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(3000)
    # choose QRMP from Q3 in settings
    pg.evaluate("S.tab = 'gstset'; render()"); pg.wait_for_timeout(2500)
    pg.select_option('select[data-gset="type"][data-greg="07"]', "qrmp"); pg.select_option('select[data-gset="from"][data-greg="07"]', "202510"); pg.click('button[data-gsetadd="07"]'); pg.wait_for_timeout(800); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(1200)
    ok(pg.evaluate("GSTSet.typeOf('202511','07')") == "qrmp" and "Quarterly (QRMP) from Q3 2025-26" in pg.inner_text("#app"), "QRMP from Q3 2025-26 set in GST settings")
    ok("Save only" in pg.inner_text("#app") and pg.evaluate("GSTQ.apiMode()") == "save", "returns through the API: save only by default")
    pg.evaluate("S.tab = 'books'; render()"); pg.wait_for_timeout(3500); t = pg.inner_text("#app")
    ok("This quarter" in t and "IFF" in t and "Pay tax by PMT-06" in t and "This month has no GSTR-1 or 3B" in t, "November: This quarter shows two steps, IFF and PMT-06")
    pg.screenshot(path=OUT + "/qrmp-month.png", full_page=False)
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('button[data-gq="iffjson"]'); pg.wait_for_timeout(1000)
    ok(any(n.startswith("IFF_07AADCV3366N1ZU_112025") for n in pg.evaluate("window.__saved")), "IFF JSON for November downloads")
    pg.fill('input[data-gqpay="igst"]', "200000"); pg.press('input[data-gqpay="igst"]', "Tab"); pg.wait_for_timeout(3000)
    ok(pg.evaluate("GSTF.peek('202511','07').pmt06.igst") == 200000, "PMT-06 paid is kept")
    pg.select_option('select[data-gstym]', "202512"); pg.wait_for_timeout(5000); t = pg.inner_text("#app")
    ok("GSTR-1 for the quarter" in t and "GSTR-3B for the quarter" in t and "Less: paid by PMT-06" in t and "2,00,000" in t, "December: the quarter's two returns, with PMT-06 set against the 3B")
    pg.screenshot(path=OUT + "/qrmp-quarter.png", full_page=False)
    pg.click('button[data-act="gstJson"]'); pg.wait_for_timeout(3000)
    ok(any("GSTR1_" in n and "122025" in n for n in pg.evaluate("window.__saved")), "GSTR-1 JSON for the quarter downloads")
    # composition from Q4
    pg.evaluate("S.tab = 'gstset'; render()"); pg.wait_for_timeout(2500)
    pg.select_option('select[data-gset="type"][data-greg="07"]', "comp"); pg.select_option('select[data-gset="from"][data-greg="07"]', "202601"); pg.click('button[data-gsetadd="07"]'); pg.wait_for_timeout(800); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(1200)
    pg.evaluate("S.tab = 'books'; S.gstYm = '202603'; render()"); pg.wait_for_timeout(4000); t = pg.inner_text("#app")
    nav = pg.inner_text('nav.sbar[aria-label="GST"]')
    print("   nav:", nav.replace("\n", " | "))
    ok("CMP-08" in nav and "GSTR-4" in nav and "Turnover and tax" in t and "ITC follow-up" not in nav and "GSTR-3B" not in nav, "composition: CMP-08 and GSTR-4 instead of GSTR-1 and 3B; no ITC follow-up")
    pg.screenshot(path=OUT + "/comp-cmp08.png", full_page=False)
    pg.click('button[data-gstpart="gstr4"]'); pg.wait_for_timeout(4000)
    ok("Table 4: purchases" in pg.inner_text("#app") and "Table 5" in pg.inner_text("#app"), "GSTR-4 for the year")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
