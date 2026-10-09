"""python3 run_tdsgst_ui.py - the TDS and GST return pages as redesigned on 09-Oct-2026 (the owner: "there should be a drop
down … year-wise and then quarter-wise or form-wise … new act for 2026-27 forms and section name … shown with old name to
identify"; Computax and Winman as the pattern), used as a user would, on the fixture books (2025-26) and the same books a
year on (2026-27, the forms of the Income-tax Act, 2025):

  - year → quarter → form in the bar opens that return;
  - 2026-27: the year is a "Tax Year", the form "Form 140 (earlier 26Q)", a section "393(1) Sl. 6(i) [old 194C]", and
    the find box finds a deduction by its old section or its new one; 2025-26: the old names alone;
  - the year's status grid: a cell opens its return; the colours (grey, blue, red, green) by status;
  - GST: the grid of returns × months, a cell opening the return and month with its tabs;
  - Back and Refresh keep the year, quarter, form and tab (the address);
  - a phone's width: nothing wider than the screen;
  - every file the pages make (the TDS text files, the GSTR-1 and 3B JSON) byte for byte, and every amount they show, as
    the build before the redesign made and showed them (tests/fixtures/tdsgst-before.json, by tdsgst_snapshot.py).
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS, snapshot, compare
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDSGST_PORT") or 8295)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

def start(pg):
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500); pg.evaluate(CHALLANS); pg.wait_for_timeout(300)

def app(pg): return pg.inner_text("#app")

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        start(pg)
        pg.evaluate("() => { S.booksTab = 'tds'; S.tdsView = 'year'; S.tdsFy = '2025-26'; render(); }"); pg.wait_for_timeout(400)
        bar = '#app [data-tds-bar] '
        ok(pg.locator(bar + 'select[aria-label="Year"]').count() == 1 and pg.locator(bar + 'select[aria-label="Quarter"]').count() == 1 and pg.locator(bar + 'select[aria-label="Form"]').count() == 1,
           "the bar: year, quarter and form")
        # 2025-26: old names only
        ok("Financial Year" in pg.inner_text("#app [data-tds-bar]"), "2025-26: the year is a Financial Year")
        forms = pg.evaluate("[...document.querySelectorAll('#app [data-tds-bar] select[aria-label=Form] option')].map(o => o.textContent)")
        ok(forms[1:] == ["24Q · Salary", "26Q · Non-salary, residents", "27Q · Non-residents", "27EQ · TCS"], "2025-26: the forms by their old names (%s)" % forms)
        pg.select_option(bar + 'select[aria-label="Quarter"]', "Q4"); pg.wait_for_timeout(300)
        ok(pg.evaluate("S.tdsView") == "year" and pg.locator('#app [data-tds-grid] [data-cell]').count() == 4, "a quarter alone: the grid shows that quarter's forms")
        pg.select_option(bar + 'select[aria-label="Form"]', "26Q"); pg.wait_for_timeout(400)
        st = pg.evaluate("[S.tdsView, S.tdsFy, S.tdsQ, S.tdsForm, S.tdsTab]")
        ok(st == ["return", "2025-26", "Q4", "26Q", "summary"], "year → quarter → form opens 26Q Q4 2025-26 on its Summary (%s)" % st)
        tabs = pg.evaluate("[...document.querySelectorAll('#app nav[aria-label=Return] button')].map(b => b.textContent.replace(/\\s*\\d+$/, '').trim())")
        ok(tabs == ["Summary", "Challans", "Deductees", "Entries", "Errors to fix", "File"], "the return's tabs: %s" % tabs)
        pg.click('#app nav[aria-label="Return"] button:has-text("Entries")'); pg.wait_for_timeout(400)
        t = app(pg)
        ok("194C" in t and "393(" not in t and "Form 140" not in t and "earlier" not in t, "2025-26 entries: the old section alone (194C), no new form or section")
        # 2026-27: the new names with the old ones
        pg.select_option(bar + 'select[aria-label="Year"]', "2026-27"); pg.wait_for_timeout(400)
        st = pg.evaluate("[S.tdsView, S.tdsFy, S.tdsQ, S.tdsForm]")
        ok(st == ["return", "2026-27", "Q4", "26Q"], "the year changed: the same quarter and form of 2026-27 (%s)" % st)
        ok("Tax Year" in pg.inner_text("#app [data-tds-bar]"), "2026-27: the year is a Tax Year")
        forms = pg.evaluate("[...document.querySelectorAll('#app [data-tds-bar] select[aria-label=Form] option')].map(o => o.textContent)")
        ok(forms[1:] == ["Form 138 (earlier 24Q) · Salary", "Form 140 (earlier 26Q) · Non-salary, residents", "Form 144 (earlier 27Q) · Non-residents", "Form 143 (earlier 27EQ) · TCS"],
           "2026-27: the new forms with the old ones in brackets (%s)" % forms)
        ok("Form 140 (earlier 26Q)" in pg.inner_text("#app [data-return-title]"), "the return's title: Form 140 (earlier 26Q)")
        pg.click('#app nav[aria-label="Return"] button:has-text("Entries")'); pg.wait_for_timeout(400)
        t = pg.inner_text("#tdsDnTable")
        ok("393(1) Sl. 6(i) [old 194C]" in t and "393(1) Sl. 6(iii) [old 194J]" in t and "393(1) Sl. 5(iii) [old 194A]" in t, "2026-27 entries: each section new with the old beside it")
        n0 = pg.locator("#tdsDnTable > tbody > tr").count()
        opts = pg.evaluate("[...document.querySelectorAll('#app select[aria-label=Section] option')].map(o => o.textContent)")
        ok(any(o.startswith("393(1) Sl. 6(i) [old 194C]") for o in opts), "the section filter: new and old (%s)" % opts[1:])
        for q, want in [("194C", "old number"), ("393(1) Sl. 6(i)", "new provision")]:
            pg.fill('#app input[aria-label="Find a deductee, PAN, voucher or ledger"]', q); pg.wait_for_timeout(500)
            rows = pg.locator("#tdsDnTable > tbody > tr").count()
            ok(0 < rows < n0 and "[old 194C]" in pg.inner_text("#tdsDnTable > tbody"), "find by the %s “%s”: %d of %d" % (want, q, rows, n0))
        pg.click('#app button:has-text("Clear filters")'); pg.wait_for_timeout(300)
        pg.click('#app nav[aria-label="Return"] button:has-text("File")'); pg.wait_for_timeout(300)
        ok(pg.locator('#app button:has-text("Download the Form 140 text file (draft)")').count() == 1 and pg.locator('#app [data-draft="140"]').count() == 1,
           "File: the download (a draft for Form 140) and the warning")
        # the address: Back and Refresh
        h = pg.evaluate("location.hash")
        ok(h.endswith("/books/tds/2026-27/Q4/26Q/file"), "the address keeps year, quarter, form and tab (%s)" % h)
        pg.go_back(); pg.wait_for_timeout(700)
        ok(pg.evaluate("[S.tdsFy, S.tdsQ, S.tdsForm, S.tdsTab]") == ["2026-27", "Q4", "26Q", "deductions"], "Back: the tab before (Entries)")
        pg.go_forward(); pg.wait_for_timeout(700)
        # Refresh: the page starts from the address (Route.apply, as on loading)
        pg.evaluate("() => { S.tdsFy = ''; S.tdsQ = ''; S.tdsForm = ''; S.tdsTab = ''; S.tdsView = ''; S.booksTab = ''; }")
        pg.evaluate("async () => { await Route.apply(location.hash); if (!S.books || !S.books.vouchers || S.books.vouchers.length !== window.__bk.vouchers.length) { S.books = window.__bk; render(); } }"); pg.wait_for_timeout(800)
        ok(pg.evaluate("[S.booksTab, S.tdsView, S.tdsFy, S.tdsQ, S.tdsForm, S.tdsTab]") == ["tds", "return", "2026-27", "Q4", "26Q", "file"], "Refresh: the same return and tab")
        # the grid
        pg.evaluate("tdsGo('2026-27')"); pg.wait_for_timeout(400)
        st = pg.evaluate("Object.fromEntries([...document.querySelectorAll('#app [data-tds-grid] [data-cell]')].map(c => [c.dataset.cell, c.dataset.status]))")
        ok(len(st) == 16 and st.get("27Q|Q1") == "none" and st.get("26Q|Q4") in ("bad", "ready") and st.get("24Q|Q2") in ("bad", "ready"), "the grid: 4 forms × 4 quarters, each with a status (%s)" % st)
        bg = pg.evaluate("[...['none', 'bad', 'ready']].map(s => { const c = document.querySelector('#app [data-tds-grid] [data-status=' + s + ']'); return c ? getComputedStyle(c).borderLeftColor : ''; })")
        ok(len(set(x for x in bg if x)) == len([x for x in bg if x]) >= 2, "each status its own colour (%s)" % bg)
        ok("Form 144 (earlier 27Q)" in pg.inner_text("#app [data-tds-grid]"), "the grid names the forms new and old")
        pg.click('#app [data-cell="24Q|Q3"]'); pg.wait_for_timeout(400)
        ok(pg.evaluate("[S.tdsView, S.tdsQ, S.tdsForm]") == ["return", "Q3", "24Q"] and "Form 138 (earlier 24Q)" in pg.inner_text("#app [data-return-title]"), "a grid cell opens its return (Form 138, Q3)")
        pg.evaluate("tdsGo('2025-26')"); pg.wait_for_timeout(300); pg.click('#app [data-cell="26Q|Q1"]'); pg.wait_for_timeout(400)
        ok(pg.evaluate("[S.tdsFy, S.tdsQ, S.tdsForm]") == ["2025-26", "Q1", "26Q"] and pg.inner_text("#app [data-return-title]").startswith("Q1 (Apr–Jun) · 26Q"), "2025-26 grid: 26Q Q1 opens as 26Q")
        # GST: the grid and a cell
        pg.evaluate("() => { S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = '202603'; render(); }"); pg.wait_for_timeout(600)
        ok(pg.locator('#app [data-gst-bar] select[aria-label="Financial year"]').count() == 1 and pg.locator('#app [data-gst-bar] select[aria-label="Month"]').count() == 1, "GST: the bar of year and month")
        rows = pg.evaluate("[...document.querySelectorAll('#app [data-gst-grid] tr[data-ret]')].map(r => r.dataset.ret)")
        ok(rows == ["r1", "r3b", "r2b", "g9"], "GST grid: GSTR-1/IFF, 3B, 2B and GSTR-9 (%s)" % rows)
        ok(pg.locator('#app [data-gst-grid] tr[data-ret=r1] [data-cell]').count() == 12, "GST grid: twelve months")
        pg.click('#app [data-cell="GSTR-3B|202602"]'); pg.wait_for_timeout(700)
        ok(pg.evaluate("[S.gstView, S.gstPart, S.gstYm, S.gstSub]") == ["return", "r3b", "202602", "summary"], "a GST cell opens GSTR-3B Feb-2026 on its Summary")
        subs = pg.evaluate("[...document.querySelectorAll('#app nav[aria-label=Return] button')].map(b => b.textContent)")
        ok(subs == ["Summary", "Details", "2B match", "File / JSON"], "GSTR-3B's tabs: %s" % subs)
        pg.click('#app nav[aria-label="Return"] button:has-text("File / JSON")'); pg.wait_for_timeout(400)
        ok(pg.locator('#app button:has-text("Download GSTR-3B JSON for the portal")').count() == 1, "File / JSON: the 3B JSON download")
        h = pg.evaluate("location.hash")
        ok(h.endswith("/books/gst/07/202602/r3b/file"), "the GST address (%s)" % h)
        pg.go_back(); pg.wait_for_timeout(700)
        ok(pg.evaluate("[S.gstPart, S.gstYm, S.gstSub]") == ["r3b", "202602", "summary"], "Back: GSTR-3B's Summary")
        # QRMP: IFF in the first two months of a quarter
        pg.evaluate("() => { GSTSet.history = () => [{from: '202504', type: 'qrmp'}]; S.gstView = 'year'; render(); }"); pg.wait_for_timeout(600)
        c = pg.evaluate("[...document.querySelectorAll('#app [data-gst-grid] tr[data-ret=r1] [data-cell]')].slice(0, 3).map(x => x.innerText.replace(/\\s+/g, ' '))")
        ok(len(c) == 3 and "IFF" in c[0] and "IFF" in c[1] and "IFF" not in c[2], "QRMP: IFF in the first two months, GSTR-1 at the quarter's end (%s)" % c)
        br.close()
        # a phone
        ph = p.chromium.launch(); pg = ph.new_page(viewport={"width": 390, "height": 844}); pg.on("pageerror", lambda e: errors.append(str(e)))
        start(pg)
        for js, what in [("tdsGo('2026-27')", "the TDS grid"), ("tdsGo('2026-27', 'Q4', '26Q'); S.tdsTab = 'deductions'; render();", "Form 140's entries"),
                         ("S.booksTab = 'gst'; S.gstView = 'year'; render();", "the GST grid"), ("gstOpen('202603', 'r1')", "GSTR-1")]:
            if "gst" not in js: pg.evaluate("S.booksTab = 'tds'; render();")
            pg.evaluate("() => { " + js + " }"); pg.wait_for_timeout(500)
            w = pg.evaluate("document.documentElement.scrollWidth")
            ok(w <= 391, "phone, %s: %dpx wide, no sideways scrolling" % (what, w))
        ph.close()
    # every figure and file, as before the redesign
    before = json.load(open(os.path.join(HERE, "fixtures", "tdsgst-before.json")))
    after = snapshot(SITE, PORT + 1)
    d = compare(before, after)
    ok(len(after["files"]) == len(before["files"]) and not [x for x in d if x.startswith("file")], "every file byte for byte as before: %d files (%s)" % (len(after["files"]), "; ".join([x for x in d if x.startswith("file")][:3])))
    ok(not [x for x in d if x.startswith("figures")], "every amount shown before is shown: %d pages (%s)" % (len(before["figures"]), "; ".join([x for x in d if x.startswith("figures")][:3])))
    errors += after["errors"]
finally:
    srv.shutdown()
ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
