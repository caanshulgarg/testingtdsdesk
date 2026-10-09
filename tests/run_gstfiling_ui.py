"""python3 run_gstfiling_ui.py - 3B: filed dates, late fee, interest, portal checks, rule 37, kept copy, set-off journal.
On a real client's export (tests/data with Master.xml) it checks VMS's October 2025 as before; with the made-up books
(tests/fixtures/books, books_data.FIXTURE) Delhi's November 2025, where Nightjar's bill NSL/112 reaches 180 days unpaid
(EXPECTED.md, "GST: the Delhi registration's returns")."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from books_data import DATA, CACHE, FIXTURE, GSTIN, COMPANY
# the month, the GSTIN and a supplier whose bill rule 37 reverses: VMS's, or the fixture's worked out by hand
YM, GST07, R37 = ("202511", GSTIN, "NSL/112") if FIXTURE else ("202510", "07AADCV3366N1ZU", "BRANDALIVE")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8144), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); books = json.load(open(CACHE)); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8144/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "@NAME@", gstin: "@GSTIN@"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, twoBs: {}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books;
      S.booksTab = "@TAB@"; S.gstPart = "r3b"; S.gstView = "return"; S.gstSub = "file"; S.gstYm = "@YM@"; S.gstReg = "07"; render(); }""".replace("@NAME@", "ZZ TEST (" + COMPANY + ")" if FIXTURE else "ZZ TEST (VMS books)").replace("@GSTIN@", GST07).replace("@YM@", YM).replace("@TAB@", "import" if FIXTURE else "gst"), books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600 if FIXTURE else 5000)
    if FIXTURE:   # the made-up books' masters: the GST ledgers by registration
        pg.set_input_files("#mastersIn", os.path.join(DATA, "Master.xml")); pg.wait_for_timeout(12000)
        pg.evaluate("S.booksTab = 'gst'; S.gstPart = 'r3b'; S.gstView = 'return'; S.gstSub = 'file'; S.gstYm = '%s'; S.gstReg = '07'; render();" % YM)   # 09-Oct-2026: filing is on GSTR-3B's File / JSON tab; pg.wait_for_timeout(5000)
    t = pg.inner_text("#app")
    ok("Filing, interest and late fee" in t and "Checks the portal runs" in t and "DRC-01B" in t, "3B has the filing section and the portal's checks")
    ok("Rule 37" in t and R37 not in t, "rule 37 is off by default: no bills listed")
    pg.evaluate("S.tab = 'gstset'; render()"); pg.wait_for_timeout(2500)
    pg.check('section[data-greg="07"] input[aria-label="Rule 37"]'); pg.wait_for_timeout(800); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(1200)
    pg.evaluate("S.tab = 'books'; render()"); pg.wait_for_timeout(4000); t = pg.inner_text("#app")
    ok(R37 in t and "4(B)(2) reversed" in t and pg.evaluate("S.books.rule37On['07']") is True, "switched on for the GSTIN: the month's unpaid bills listed, reversed in 4(B)(2)")
    if FIXTURE:   # EXPECTED.md: NSL/112, billed twice (2,32,000, tax 36,000), 1,16,000 paid; half unpaid 180 days after 08-May-2025
        rv = pg.evaluate("(() => { const r = GSTR.threeB('202511', '07').r37.rev; return [r.igst, r.cgst, r.sgst, r.list.map(x => [x.party, x.ref, x.share])]; })()")
        ok(rv == [0, 9000, 9000, [["Nightjar Sound & Light Co", "NSL/112", 0.5]]], "fixture: Nov-2025 reverses CGST 9,000 and SGST 9,000 on NSL/112, as worked out by hand (%s)" % rv)
    ok("are the portal\u2019s own figures" in t, "says late fee and interest are the portal's own figures")
    pg.fill('input[aria-label="GSTR-3B filed on"]', "2025-12-05"); pg.press('input[aria-label="GSTR-3B filed on"]', "Tab"); pg.wait_for_timeout(3000)
    t = pg.inner_text("#app")
    ok(pg.evaluate("S.books.gstFiled['07']['%s'].r3b" % YM) == "2025-12-05" and "estimate" not in t.lower() and "from the portal" in t, "by default only the portal's late fee and interest are shown, no estimate")
    pg.fill('input[aria-label="portalInt"]', "12345"); pg.press('input[aria-label="portalInt"]', "Tab"); pg.wait_for_timeout(2500)
    ok(pg.evaluate("S.books.gstFiled['07']['%s'].portalInt" % YM) == 12345, "the portal's interest typed in is kept")
    pg.evaluate("S.tab = 'gstset'; render()"); pg.wait_for_timeout(2000)
    ok(pg.locator('input[aria-label="Show FinCom’s estimate"]').is_checked() is False, "the estimate setting is off by default")
    pg.check('input[aria-label="Show FinCom’s estimate"]'); pg.wait_for_timeout(1200)
    pg.click('#app [data-confirm-foot="setup:gstset"] [data-cfm="save"]'); pg.wait_for_timeout(500)   # review 18 (02-Oct-2026): saved with Save
    pg.evaluate("S.tab = 'books'; render()"); pg.wait_for_timeout(4000); t = pg.inner_text("#app")
    ok("FinCom\u2019s estimate" in t and "Late fee, estimate" in t.replace("LATE FEE, ESTIMATE", "Late fee, estimate") and "estimate \u20b9" in t, "switched on: the estimate shows beside the portal's figures")
    pg.screenshot(path=OUT + "/gstfiling.png", full_page=True)
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('button:text-is("Set-off journal for Tally")'); pg.wait_for_timeout(1500)
    ok(any("GST-setoff-07-" + YM in n for n in pg.evaluate("window.__saved")), "the set-off journal for Tally downloads")
    pg.click('button:text-is("Mark this 3B as filed and keep a copy")'); pg.wait_for_timeout(2500)
    ok(pg.evaluate("!!S.books.gstFiled['07']['%s'].snap" % YM) and "kept as filed" in pg.inner_text("#app"), "3B marked as filed, with a copy kept")
    pg.evaluate("S.gstPart = 'r1'; S.gstSub = 'diff'; S.gstYm = '202603'; render()")   # 09-Oct-2026: IMS rejections on GSTR-1's Differences tab; pg.wait_for_timeout(3000)
    ok("Rejected by customers in IMS" in pg.inner_text("#app"), "GSTR-1 still draws")
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
