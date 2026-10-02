"""python3 run_mis_ui.py - the MIS tab in a browser."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from books_data import DATA, CACHE, FIXTURE, GSTIN, GSTIN09, COMPANY
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8130), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"))
books = json.load(open(CACHE))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8130/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "@GSTIN@", tallyName: "@CO@"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}}); S.books.map = Books.mapLedgers(bk.vouchers, {}); window.__bk = S.books; S.booksTab = "import"; render(); }""".replace("@GSTIN@", GSTIN).replace("@CO@", COMPANY), books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    pg.set_input_files("#mastersIn", os.path.join(DATA, "Master.xml")); pg.wait_for_timeout(12000)
    pg.evaluate("S.booksTab = 'mis'; render();"); pg.wait_for_timeout(500)
    t = pg.inner_text("#app")
    ok("Run now" in t and "Year to date" in t and "Last month" in t, "period picker, quick periods and Run now are always there")
    pg.click('button:text-is("Last year")'); pg.wait_for_timeout(300)
    ok(pg.evaluate("S.misRange.from") == "2025-04-01" and pg.evaluate("S.misRange.to") == "2026-03-31", "Last year sets 1 Apr 2025 to 31 Mar 2026")
    pg.click('section[data-mis-head] button:text-is("Run now")'); pg.wait_for_timeout(3000)
    t = pg.inner_text("#app")
    # the year's sales: the real client's, or the fixture's worked out by hand (tests/fixtures/books/EXPECTED.md)
    ok("sales, the period" in t.lower() and ("14,00,000.00" if FIXTURE else "56,39,22,176.16") in t, "summary: sales for the year")
    if FIXTURE:   # EXPECTED.md: receivables 7,18,200 on the ledger balances, 99,400 of it not bill-wise; MSME past 45 days 2,90,000
        ok("7,18,200.00" in t and "99,400.00 not bill-wise" in t and "3,19,550.00" in t and "2,90,000.00" in t, "fixture: owed to you 7,18,200 (99,400 not bill-wise), profit 3,19,550, MSME 2,90,000, as worked out by hand")
    # review of 02-Oct-2026: with the ledger balances known, what no bill explains is "not bill-wise"; without them, what was
    # settled against older bills is said
    ok("settled against older bills" in t or "not bill-wise" in t, "says plainly that receivables miss bills from before the books")
    pg.screenshot(path=OUT + "/mis-summary.png", full_page=True)
    pg.click('nav[aria-label="MIS"] button:text-is("Profit and loss")'); pg.wait_for_timeout(500)
    t = pg.inner_text("#app")
    ok("Gross profit" in t and "Profit before tax" in t and ("Apr-2025" in t or "Apr 2025" in t) and ("Mar-2026" in t or "Mar 2026" in t), "profit and loss, month by month")
    pg.click('#misPl button:text-is("\u25b8 %d ledgers")' % pg.evaluate("S.books.mis.last.pl.heads.exp.led.length")); pg.wait_for_timeout(400)
    led = pg.evaluate("S.books.mis.last.pl.heads.exp.led[0].l")
    pg.locator("#misPl button.linkbtn").filter(has_text=led).first.click(); pg.wait_for_timeout(500)
    ok(led in pg.inner_text("#app") and "Narration" in pg.inner_text("#app").title(), "a ledger opens to its vouchers: " + led)
    pg.screenshot(path=OUT + "/mis-pl.png", full_page=False)
    pg.click('nav[aria-label="MIS"] button:text-is("Receivables")'); pg.wait_for_timeout(500)
    pg.select_option('select[aria-label="Which parties"]', "90"); pg.wait_for_timeout(400)
    rows = pg.locator("#misAge > tbody > tr").count()
    ok(rows >= 2, "receivables: over 90 days filter (%d rows)" % rows)
    party = pg.locator("#misAge tbody tr[data-key]").first.get_attribute("data-key")
    pg.click('#misAge tr[data-key="%s"] button.linkbtn' % party); pg.wait_for_timeout(400)
    ok("Outstanding" in pg.inner_text("#app").title() or pg.locator("#misAge table").count() == 1, "a customer opens to its bills")
    pg.click('nav[aria-label="MIS"] button:text-is("Payables")'); pg.wait_for_timeout(500)
    pg.select_option('select[aria-label="Which parties"]', "msme"); pg.wait_for_timeout(400)
    t = pg.inner_text("#app")
    ok("MSME suppliers unpaid past 45 days" in t, "payables: MSME past 45 days, section 43B(h)")
    sel = pg.locator('select[aria-label^="MSME: "]').first; sup = sel.get_attribute("aria-label")[6:]
    pg.select_option('select[aria-label="Which parties"]', ""); pg.wait_for_timeout(300)
    pg.locator('select[aria-label^="MSME: "]').nth(3).select_option("Micro"); pg.wait_for_timeout(1500)
    ok(len([v for v in pg.evaluate("Object.values(S.books.msme)") if v == "Micro"]) == 1, "a supplier marked MSME by hand")
    pg.click('nav[aria-label="MIS"] button:text-is("Sales")'); pg.wait_for_timeout(500)
    ok("Top five customers" in pg.inner_text("#app"), "sales by customer")
    pg.click('nav[aria-label="MIS"] button:text-is("Purchases and expenses")'); pg.wait_for_timeout(500)
    ok("Expense heads by month" in pg.inner_text("#app") and "jumped" in pg.inner_text("#app"), "purchases and expense heads, with jumps")
    pg.click('nav[aria-label="MIS"] button:text-is("Compliance")'); pg.wait_for_timeout(500)
    ok("GST by month" in pg.inner_text("#app") and "TDS by month" in pg.inner_text("#app"), "compliance")
    # a month, then the pack
    # a month compared with the one before: June with May (the real books), October with September (the fixture has no May sales)
    MF, MT, PREV = ("2025-10-01", "2025-10-31", "September") if FIXTURE else ("2025-06-01", "2025-06-30", "May")
    pg.fill('input[aria-label="MIS from"]', MF); pg.dispatch_event('input[aria-label="MIS from"]', "change")
    pg.fill('input[aria-label="MIS to"]', MT); pg.dispatch_event('input[aria-label="MIS to"]', "change")
    pg.click('section[data-mis-head] button:text-is("Run now")'); pg.wait_for_timeout(2500)
    ok(pg.evaluate("S.books.mis.last.from") == MF.replace("-", "") and pg.evaluate("S.books.mis.last.prev.sales") > 0, "a month, compared with " + PREV)
    with ctx.expect_page() as pop:
        pg.click('section[data-mis-head] button:text-is("Download the MIS pack (PDF)")')
    rp = pop.value; rp.wait_for_timeout(800); rt = rp.inner_text("body")
    ok("At a glance" in rt and "Profit and loss" in rt and "Receivables, largest 15" in rt and "Due in the coming weeks" in rt, "the MIS pack")
    rp.pdf(path=OUT + "/mis-pack.pdf"); rp.close()
    pg.evaluate("() => { window.__saved = []; window.saveFile = (n) => window.__saved.push(n); }")
    pg.click('section[data-mis-head] button:text-is("Excel")'); pg.wait_for_timeout(3000)
    ok(any("-MIS-" in n for n in pg.evaluate("window.__saved")), "Excel")
    # on its own, monthly: runs for the month just ended
    pg.evaluate("document.querySelectorAll('#app details').forEach(d => d.open = true)")   # settings sit in a closed section
    pg.select_option('select[aria-label="MIS runs on its own"]', "monthly"); pg.wait_for_timeout(300)
    pg.click('#app [data-confirm-foot="books:mis-settings"] [data-cfm="save"]'); pg.wait_for_timeout(300)   # saved with Save (review 18)
    pg.evaluate("S.books.mis.last.at = '2026-08-01T09:00:00.000Z'; MIS.maybeRun(); render();"); pg.wait_for_timeout(2500)
    ok(pg.evaluate("S.books.mis.last.how").startswith("on its own") and pg.evaluate("S.books.mis.last.from") == "20260301" and pg.evaluate("S.books.mis.last.to") == "20260331", "on its own, monthly: the month just ended, or the last month in the books: " + pg.evaluate("S.books.mis.last.from + '-' + S.books.mis.last.to"))
    bad = pg.evaluate("""() => { const bad = []; ['summary', 'pl', 'recv', 'pay', 'sales', 'purch', 'comp'].forEach(tb => { S.misTab = tb; try { render(); } catch (e) { bad.push(tb + ': ' + e.message); } }); return bad; }""")
    ok(not bad, "every tab renders" + ("" if not bad else ": " + "; ".join(bad)))
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
