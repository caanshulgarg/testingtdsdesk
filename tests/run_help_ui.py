"""python3 run_help_ui.py - "How this tab works" on every GST and TDS tab; customers' IMS rejections on GSTR-1 and in 3B."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
DATA = os.environ.get("TDSDESK_DATA", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8141), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")); books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(DATA, "books-cache.json")))); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8141/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
      S.booksTab = "gst"; S.gstPart = "r1"; S.gstYm = "202511"; S.gstReg = "07"; render(); }""", books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(4000)
    ok(pg.locator('.help-btn').count() == 1, "the GST tab bar has a \u201cHow this tab works\u201d button")
    pg.click('.help-btn'); pg.wait_for_timeout(600)
    t = (pg.inner_text("#helpPanel") if pg.locator("#helpPanel").count() else "").lower()
    ok("gstr-1" in t and "what to do" in t and "where the figures come from" in t and "prepare offline" in t, "it opens a guide for GSTR-1: what it is for, what to do, where the figures come from")
    pg.screenshot(path=OUT + "/help-gstr1.png")
    pg.click('button[data-gstpart="r3b"]'); pg.wait_for_timeout(2500)
    ok("GSTR-3B" in pg.inner_text("#helpPanel") and "opening balance" in pg.inner_text("#helpPanel"), "it stays open and follows the tab: now GSTR-3B")
    for part, word in [("r2b", "2B reconciliation"), ("follow", "ITC follow-up"), ("g9", "GSTR-9"), ("inreg", "Input register")]:
        pg.click('button[data-gstpart="%s"]' % part); pg.wait_for_timeout(2500)
        ok(word in pg.inner_text("#helpPanel"), "guide for " + word)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
    ok(pg.locator("#helpPanel").count() == 0 and pg.evaluate("S.view === 'company' && S.tab === 'books'"), "Esc closes it, and leaves you on the same screen")
    # TDS
    pg.evaluate("S.booksTab = 'tds'; S.tdsView = 'year'; render()"); pg.wait_for_timeout(3000)
    ok(pg.locator(".tds-crumbs .help-btn").count() == 1, "TDS has the button too")
    pg.click(".tds-crumbs .help-btn"); pg.wait_for_timeout(500)
    ok("TDS" in pg.inner_text("#helpPanel"), "and a guide for the TDS screen shown")
    pg.evaluate("S.tdsView = 'return'; S.tdsForm = '26Q'; S.tdsFy = TDS.rows()[0].fy; S.tdsQ = TDS.rows()[0].q; S.tdsTab = 'checks'; render()"); pg.wait_for_timeout(2500)
    ok("234E" in pg.inner_text("#helpPanel") and pg.locator('.tds-crumbs .help-btn').count() == 1, "inside a 26Q return: the guide for its checks tab (interest and late fee)")
    pg.click('#helpPanel [data-help="close"]'); pg.wait_for_timeout(300)
    ok(pg.locator("#helpPanel").count() == 0, "\u2715 closes it")
    # customers' IMS rejections, on GSTR-1
    pg.evaluate("S.booksTab = 'gst'; S.gstPart = 'r1'; render()"); pg.wait_for_timeout(3000)
    cn = pg.evaluate("(() => { const r = CustIMS.docs('07').find(r => r.kind === 'CDNR' && r.date >= '20251001' && r.date < '20251101'); return r ? {id: r.id, no: r.no} : null; })()")
    ok("Rejected by customers in IMS" in pg.inner_text("#app") and cn, "GSTR-1 has a place to mark documents rejected by customers")
    pg.fill("input[data-custimsq]", cn["no"]); pg.wait_for_timeout(2500)
    pg.click('button[data-custimsadd=%s]' % json.dumps(cn["id"])); pg.wait_for_timeout(2500)
    ok(pg.evaluate("S.books.outRej['07'][%s].kind" % json.dumps(cn["id"])) == "cn", "a credit note marked as rejected")
    pg.select_option('select[data-custims=%s][data-cf="addYm"]' % json.dumps(cn["id"]), "202511"); pg.wait_for_timeout(2500)
    pg.click('button[data-gstpart="r3b"]'); pg.wait_for_timeout(3000)
    ok("rejected by customers in IMS" in pg.inner_text("#app"), "3B shows the add-back in 3.1(a)")
    pg.screenshot(path=OUT + "/help-3b-custrej.png")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
