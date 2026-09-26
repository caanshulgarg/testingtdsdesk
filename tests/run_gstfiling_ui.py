"""python3 run_gstfiling_ui.py - 3B: filed dates, late fee, interest, portal checks, rule 37, kept copy, set-off journal."""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
DATA = os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8144), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(DATA, "books-cache.json")))); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8144/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
      S.booksTab = "gst"; S.gstPart = "r3b"; S.gstYm = "202510"; S.gstReg = "07"; render(); }""", books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(5000)
    t = pg.inner_text("#app")
    ok("Filing, interest and late fee" in t and "Checks the portal runs" in t and "DRC-01B" in t, "3B has the filing section and the portal's checks")
    ok("Rule 37" in t and "BRANDALIVE" not in t, "rule 37 is off by default: no bills listed")
    pg.evaluate("S.tab = 'gstset'; render()"); pg.wait_for_timeout(2500)
    pg.check('input[data-gset="r37"][data-greg="07"]'); pg.wait_for_timeout(800); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(1200)
    pg.evaluate("S.tab = 'books'; render()"); pg.wait_for_timeout(4000); t = pg.inner_text("#app")
    ok("BRANDALIVE" in t and "4(B)(2) reversed" in t and pg.evaluate("S.books.rule37On['07']") is True, "switched on for the GSTIN: October's unpaid bills listed, reversed in 4(B)(2)")
    ok("are the portal\u2019s own figures" in t, "says late fee and interest are the portal's own figures")
    pg.fill('input[data-gstf="r3b"]', "2025-12-05"); pg.press('input[data-gstf="r3b"]', "Tab"); pg.wait_for_timeout(3000)
    t = pg.inner_text("#app")
    ok(pg.evaluate("S.books.gstFiled['07']['202510'].r3b") == "2025-12-05" and "estimate" not in t.lower() and "from the portal" in t, "by default only the portal's late fee and interest are shown, no estimate")
    pg.fill('input[data-gstf="portalInt"]', "12345"); pg.press('input[data-gstf="portalInt"]', "Tab"); pg.wait_for_timeout(2500)
    ok(pg.evaluate("S.books.gstFiled['07']['202510'].portalInt") == 12345, "the portal's interest typed in is kept")
    pg.evaluate("S.tab = 'gstset'; render()"); pg.wait_for_timeout(2000)
    ok(pg.locator('input[data-gset="est"]').is_checked() is False, "the estimate setting is off by default")
    pg.check('input[data-gset="est"]'); pg.wait_for_timeout(1200)
    pg.evaluate("S.tab = 'books'; render()"); pg.wait_for_timeout(4000); t = pg.inner_text("#app")
    ok("TDS Desk\u2019s estimate" in t and "Late fee, estimate" in t.replace("LATE FEE, ESTIMATE", "Late fee, estimate") and "estimate \u20b9" in t, "switched on: the estimate shows beside the portal's figures")
    pg.screenshot(path=OUT + "/gstfiling.png", full_page=True)
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('button[data-gstfact="journal"]'); pg.wait_for_timeout(1500)
    ok(any("GST-setoff-07-202510" in n for n in pg.evaluate("window.__saved")), "the set-off journal for Tally downloads")
    pg.click('button[data-gstfact="snap"]'); pg.wait_for_timeout(2500)
    ok(pg.evaluate("!!S.books.gstFiled['07']['202510'].snap") and "kept as filed" in pg.inner_text("#app"), "3B marked as filed, with a copy kept")
    pg.evaluate("S.gstPart = 'r1'; S.gstYm = '202603'; render()"); pg.wait_for_timeout(3000)
    ok("Rejected by customers in IMS" in pg.inner_text("#app"), "GSTR-1 still draws")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
