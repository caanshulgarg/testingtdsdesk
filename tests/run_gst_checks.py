"""python3 run_gst_checks.py - GST checks before filing (the owner's list of 10-Oct-2026), on the fixture books
(tests/fixtures/books, two registrations, 2025-26), faults planted one at a time and found:

  G-A1  a buyer's GSTIN whose check digit (15th character) is wrong, and a supplier's, are flagged before filing;
  G-A2  invoice numbers the portal refuses: over 16 characters, a character other than letters, digits, / and -, only
        zeros, and the same number twice in the financial year (another month counts; capitals and small letters alike;
        invoices and credit notes apart);
  G-E1  the year's grid shows "Errors N" (red) for a month with errors before filing, not "Ready"; checks only for
        information (reverse charge, ITC not taken) are no error; a filed month shows Filed.
Nothing here changes a figure or the GSTR-1 JSON.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("GSTCHK_PORT") or 8318)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

CHECKS = "(a) => Object.fromEntries(GSTR.checks(a[0], a[1]).map(c => [c.what, {n: c.n, info: !!c.info, eg: c.rows.map(r => r.no)}]))"
SALE = "(a) => S.books.vouchers.find(v => (v.no || v.ref) === a)"

def grid(pg):
    pg.evaluate("() => { S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = '202603'; render(); }"); pg.wait_for_timeout(600)

def cell(pg, k):
    return pg.evaluate("(k) => { const c = document.querySelector('#app [data-cell=\"' + k + '\"]'); return c ? [c.dataset.status, c.innerText.replace(/\\s+/g, ' ')] : null; }", k)

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500); pg.evaluate(CHALLANS); pg.wait_for_timeout(300)

        # the books as they are: no check fires on them
        before = {m: pg.evaluate(CHECKS, [m, "07"]) for m in ["202504", "202507", "202510", "202603"]}
        ok(not any(k for m in before for k in before[m] if "GSTIN" in k and "not valid" in k or "Invoice numbers" in k), "the fixture as it is: no invalid GSTIN or invoice-number finding")
        json0 = pg.evaluate("JSON.stringify(GSTR.toJson('202504', '07'))")
        grid(pg)
        c = cell(pg, "GSTR-1|202504")
        ok(c and c[0] == "ready" and "Ready" in c[1], "Apr-2025 GSTR-1, nothing to fix: Ready (%s)" % c)
        c = cell(pg, "GSTR-3B|202602")
        ok(c and c[0] == "bad" and "Errors 2" in c[1], "Feb-2026 3B: two purchases with no supplier GSTIN are errors to fix, 'Errors 2' (reverse charge is not counted) (%s)" % c)

        # G-A1: a buyer's GSTIN with a wrong check digit
        pg.evaluate("(a) => { const v = (" + SALE + ")(a); v.gstin = '07AAJFQ3158R1ZJ'; }", "LFE/25-26/001")
        ok(not pg.evaluate("gstinValid('07AAJFQ3158R1ZJ')") and pg.evaluate("gstinValid('07AAJFQ3158R1ZH')"), "07AAJFQ3158R1ZJ fails the check digit; …ZH passes")
        ch = pg.evaluate(CHECKS, ["202504", "07"])
        ok("Buyer GSTINs that are not valid" in ch and ch["Buyer GSTINs that are not valid"]["n"] == 1 and ch["Buyer GSTINs that are not valid"]["eg"] == ["07AAJFQ3158R1ZJ"], "a buyer's GSTIN with a wrong check digit: flagged, the GSTIN shown (%s)" % ch)
        grid(pg)
        c = cell(pg, "GSTR-1|202504")
        ok(c and c[0] == "bad" and "Errors 1" in c[1], "the grid: Apr-2025 GSTR-1 shows Errors 1 (red), not Ready (%s)" % c)
        pg.evaluate("(a) => { (" + SALE + ")(a).gstin = '07AAJFQ3158R1ZH'; }", "LFE/25-26/001")

        # G-A1: a supplier's GSTIN
        pg.evaluate("() => { const v = S.books.vouchers.find(v => GSTR.inward('202505', '07').some(r => r.id === v.id && r.gstin)); window.__sup = [v, v.gstin]; v.gstin = String(GSTR.inward('202505', '07').find(r => r.id === v.id).gstin).slice(0, 14) + '0'; }")
        ch = pg.evaluate(CHECKS, ["202505", "07"])
        ok(ch.get("Supplier GSTINs that are not valid", {}).get("n") == 1, "a supplier's GSTIN with a wrong check digit: flagged (%s)" % ch)
        grid(pg)
        c = cell(pg, "GSTR-3B|202505")
        ok(c and c[0] == "bad" and "Errors 1" in c[1], "the grid: May-2025 3B shows Errors 1 (%s)" % c)
        pg.evaluate("() => { window.__sup[0].gstin = window.__sup[1]; }")

        # G-A2: invoice numbers
        pg.evaluate("(a) => { (" + SALE + ")(a).no = 'LFE/2025-26/000001'; }", "LFE/25-26/006")
        ch = pg.evaluate(CHECKS, ["202507", "07"])
        ok(ch.get("Invoice numbers longer than 16 characters", {}).get("eg") == ["LFE/2025-26/000001"], "18 characters: flagged (%s)" % ch)
        pg.evaluate("() => { const v = S.books.vouchers.find(v => v.no === 'LFE/2025-26/000001'); v.no = 'LFE#25 006'; }")
        ch = pg.evaluate(CHECKS, ["202507", "07"])
        ok(ch.get("Invoice numbers with characters the portal does not take", {}).get("n") == 1 and "Invoice numbers longer than 16 characters" not in ch, "'LFE#25 006' (a # and a space): flagged (%s)" % list(ch))
        pg.evaluate("() => { const v = S.books.vouchers.find(v => v.no === 'LFE#25 006'); v.no = '0000'; }")
        ok(pg.evaluate(CHECKS, ["202507", "07"]).get("Invoice numbers with characters the portal does not take", {}).get("n") == 1, "'0000' (only zeros): flagged")
        # the same number as April's, in July, small letters: both months flag it
        pg.evaluate("() => { const v = S.books.vouchers.find(v => v.no === '0000'); v.no = 'lfe/25-26/001'; }")
        a, j = pg.evaluate(CHECKS, ["202504", "07"]), pg.evaluate(CHECKS, ["202507", "07"])
        ok(a.get("Invoice numbers used twice in the financial year", {}).get("n") == 1 and j.get("Invoice numbers used twice in the financial year", {}).get("n") == 1,
           "LFE/25-26/001 in April and lfe/25-26/001 in July: both months flag the repeat (%s / %s)" % (list(a), list(j)))
        grid(pg)
        ok(cell(pg, "GSTR-1|202507")[0] == "bad" and cell(pg, "GSTR-1|202504")[0] == "bad", "the grid: April and July GSTR-1 show errors")
        # put the number back
        pg.evaluate("() => { const v = S.books.vouchers.find(v => v.no === 'lfe/25-26/001'); v.no = 'LFE/25-26/006'; }")
        ok("Invoice numbers used twice in the financial year" not in pg.evaluate(CHECKS, ["202504", "07"]), "put back: no repeat")
        # 2026-27's copy of the books has its own year: the same numbers there are no repeat of 2025-26's
        ok("Invoice numbers used twice in the financial year" not in pg.evaluate(CHECKS, ["202604", "07"]), "the next year's LFE/25-26/001 (the books a year on) is not a repeat of this year's")

        # G-E1: a filed month shows Filed, errors or not; the JSON is unchanged by the checks
        pg.evaluate("() => { S.books.gstFiled = {'07': {'202602': {r3b: '2026-03-20'}}}; }")
        grid(pg)
        c = cell(pg, "GSTR-3B|202602")
        ok(c and c[0] == "filed", "Feb-2026 3B marked filed: Filed, not Errors (%s)" % c)
        ok(pg.evaluate("JSON.stringify(GSTR.toJson('202504', '07'))") == json0, "the GSTR-1 JSON is the same as before the checks")
        key = pg.inner_text('#app [data-gst-grid] .rp-key')
        ok("Errors to fix" in key, "the colour key says red is errors to fix (%s)" % key)
        br.close()
finally:
    srv.shutdown()
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
