"""python3 run_tds_ui.py - the TDS screens: years -> year -> return tabs, filters, sorting, challans, 24Q."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8124), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")); os.makedirs(OUT, exist_ok=True)
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
open(os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")), "salary.csv"), "w").write("Employee Name,PAN,Month,Gross Salary,TDS\n" + "".join(
    "%s,%s,%s,%d,%d\n" % (n, p, m, g, t) for (n, p, g, t) in [("Asha Verma", "ABCPV1234K", 90000, 6000), ("Ravi Kumar", "", 40000, 0), ("Neha Singh", "AAAPS9999Q", 150000, 18000)]
    for m in ["2026-01-31", "2026-02-28", "2026-03-31"]))
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8124/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => {
      const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"});
      S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {});
      LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "tds"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(800)
    t = pg.inner_text("#app")
    ok("2025-26" in t, "TDS opens on the year (one year in these books)")
    ok("returns by quarter" in t.lower() and "26q, other than salary" in t.lower() and "24q, salary" in t.lower(), "year page shows quarters by form")
    pg.screenshot(path=OUT + "/tds-year.png", full_page=True)
    ok(pg.evaluate("TDS.rows().filter(r => /^192/.test(r.section)).length") == 0 and pg.evaluate("TDS.salaryRows().length") == 13, "salary TDS (192B) kept out of 26Q: 13 entries moved to 24Q")
    ok("in the books under 192" in t, "year page shows salary TDS from the books under 24Q")
    pg.click('button[data-tdsnav="years"]'); pg.wait_for_timeout(400)
    ok("Choose the financial year" in pg.inner_text("#app"), "breadcrumb TDS goes to the years list")
    pg.click('button[data-tdsgo="2025-26"] >> nth=0'); pg.wait_for_timeout(400)
    pg.click('button[data-tdsgo="2025-26|Q1|26Q"]'); pg.wait_for_timeout(800)
    t = pg.inner_text("#app")
    ok("Q1 \u00b7 26Q" in t and "Challans" in t and "Deductees" in t and "Deductions" in t, "26Q Q1 opens with its tabs")
    q1 = pg.evaluate("TDS.rows().filter(r => r.fy === '2025-26' && r.q === 'Q1').length")
    ok(("Deductions %d" % q1) in t.replace("\n", " "), "Deductions tab count matches the quarter: %d" % q1)
    # challans: turn the first two book payments into challans
    pays = pg.locator("input[data-paybsr]")
    ok(pays.count() > 0, "book payments offered as challans: %d" % pays.count())
    for i in range(2):
        vid = pg.locator("input[data-paybsr]").first.get_attribute("data-paybsr")
        pg.fill('input[data-paybsr="%s"]' % vid, "0240020"); pg.fill('input[data-payser="%s"]' % vid, "0097%d" % i)
        pg.click('button[data-paymake="%s"]' % vid); pg.wait_for_timeout(500)
    nch = pg.evaluate("S.books.challans.length")
    ok(nch == 2, "two challans made: %d" % nch)
    pg.click('button[data-act="tdsAuto"]'); pg.wait_for_timeout(800)
    used = pg.evaluate("Object.keys(S.books.alloc).length")
    ok(used > 0, "deductions put against challans: %d" % used)
    cid = pg.evaluate("S.books.challans[0].id")
    pg.click('button[data-chopen="%s"] >> nth=0' % cid); pg.wait_for_timeout(400)
    ok(pg.locator("#tdsChTable table").count() == 1, "a challan opens to show its deductions")
    pg.screenshot(path=OUT + "/tds-challans.png", full_page=True)
    pg.select_option('select[data-tdsf="state"]', "unused"); pg.wait_for_timeout(400)
    ok("0 of 2 challans" in pg.inner_text("#app") or "1 of 2 challans" in pg.inner_text("#app"), "challan filter by use works")
    pg.click('button[data-tdsfclear="challans"]'); pg.wait_for_timeout(300)
    ok("2 of 2 challans" in pg.inner_text("#app"), "clear filters")
    # deductees tab
    pg.click('button[data-tdstab="deductees"]'); pg.wait_for_timeout(600)
    t = pg.inner_text("#app")
    ok("Find a deductee, PAN or voucher" in pg.content() and "Deductee" in t, "Deductees tab")
    first = pg.locator("#tdsDeTable tbody tr").first.inner_text()
    pg.select_option('select[data-tdsf="challan"]', "no"); pg.wait_for_timeout(400)
    un = pg.evaluate("TDS.rows().filter(r => r.fy === '2025-26' && r.q === 'Q1' && !r.challan).length")
    ok(("%d deductees" % 0) not in pg.inner_text("#app") or un == 0, "filter deductees not against a challan")
    pg.fill('input[data-tdsf="q"]', "TECH"); pg.wait_for_timeout(700)
    rows_now = pg.locator("#tdsDeTable tbody tr").count()
    ok(pg.evaluate("document.activeElement && document.activeElement.dataset.tdsf") == "q", "search box keeps focus while typing")
    ok(rows_now >= 1, "search narrows deductees (%d rows)" % rows_now)
    pg.click('button[data-tdsfclear="deductees"]'); pg.wait_for_timeout(300)
    key = pg.locator("#tdsDeTable button[data-tdsopen]").first.get_attribute("data-tdsopen")
    pg.click('#tdsDeTable button[data-tdsopen="%s"] >> nth=0' % key); pg.wait_for_timeout(400)
    ok(pg.locator("#tdsDeTable select[data-alloc]").count() > 0, "a deductee opens to its deductions with a challan choice")
    pg.click('button[data-tdssort="deductees|party"]'); pg.wait_for_timeout(300)
    names = pg.evaluate("Array.from(document.querySelectorAll('#tdsDeTable > tbody > tr > td:first-child button')).map(b => b.textContent.replace(/^[\\u25b8\\u25be] /, '')).slice(0, 5)")
    ok(names == sorted(names), "sort by deductee name: " + ", ".join(names[:3]))
    pg.screenshot(path=OUT + "/tds-deductees.png", full_page=True)
    # deductions tab
    pg.click('button[data-tdstab="deductions"]'); pg.wait_for_timeout(600)
    ok(pg.locator("#tdsDnTable select[data-alloc]").count() == min(q1, 500), "every deduction listed with a challan choice")
    pg.select_option('select[data-tdsf="month"]', "202505"); pg.wait_for_timeout(400)
    may = pg.evaluate("TDS.rows().filter(r => r.fy === '2025-26' && r.q === 'Q1' && String(r.date).slice(0, 6) === '202505').length")
    ok(("%d of %d deductions" % (may, q1)) in pg.inner_text("#app"), "month filter: %d in May" % may)
    secs = pg.evaluate("Array.from(document.querySelectorAll('select[data-tdsf=\"section\"] option')).map(o => o.value).filter(Boolean)")
    pg.select_option('select[data-tdsf="section"]', secs[0]); pg.wait_for_timeout(400)
    both = pg.evaluate("TDS.rows().filter(r => r.fy === '2025-26' && r.q === 'Q1' && String(r.date).slice(0, 6) === '202505' && r.section === '%s').length" % secs[0])
    ok(("%d of %d deductions" % (both, q1)) in pg.inner_text("#app"), "month and section together: %d" % both)
    pg.click('button[data-tdssort="deductions|tds"]'); pg.click('button[data-tdssort="deductions|tds"]'); pg.wait_for_timeout(400)
    tds = pg.evaluate("Array.from(document.querySelectorAll('#tdsDnTable tbody tr')).slice(0, -1).map(r => parseFloat(r.children[8].textContent.replace(/,/g, '')))")
    ok(tds == sorted(tds, reverse=True), "sort by TDS, largest first")
    # a filter on one tab does not leak to another
    pg.click('button[data-tdstab="deductees"]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("((S.tdsFl || {}).deductees || {}).month") in (None, ""), "each tab keeps its own filters")
    pg.click('button[data-tdstab="deductions"]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("S.tdsFl.deductions.month") == "202505", "filters remembered when coming back to a tab")
    pg.screenshot(path=OUT + "/tds-deductions.png", full_page=True)
    # allocate one deduction by hand from the deductions tab
    pg.click('button[data-tdsfclear="deductions"]'); pg.wait_for_timeout(300)
    sel = pg.locator('#tdsDnTable select[data-alloc]').first
    rid = sel.get_attribute("data-alloc"); sel.select_option(cid); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.books.alloc[%s]" % json.dumps(rid)) == cid, "challan chosen by hand is kept")
    pg.click('button[data-tdstab="checks"]'); pg.wait_for_timeout(500)
    t = pg.inner_text("#app")
    ok("Interest and late fee" in t and "Rate questions" in t and "By section" in t, "checks tab")
    # breadcrumb back to the year, then 24Q with a salary sheet
    pg.click('button[data-tdsnav="year"]'); pg.wait_for_timeout(400)
    pg.set_input_files("#salaryIn", os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")), "salary.csv")); pg.wait_for_timeout(1500)
    pg.click('button[data-tdsgo="2025-26|Q4|24Q"]'); pg.wait_for_timeout(600)
    t = pg.inner_text("#app")
    ok("Q4 \u00b7 24Q" in t and "Employees" in t and "Annexure II" in t, "24Q Q4 opens with Employees, Challans, Annexure II")
    ok("Asha Verma" in t and "Neha Singh" in t, "employees listed")
    pg.select_option('select[data-tdsf="pan"]', "no"); pg.wait_for_timeout(400)
    ok("1 of 3 employees" in pg.inner_text("#app"), "employees without PAN: 1")
    pg.click('button[data-tdstab="annex2"]'); pg.wait_for_timeout(400)
    ok("regime" in pg.inner_text("#app").lower(), "Annexure II tab")
    pg.screenshot(path=OUT + "/tds-24q.png", full_page=True)
    # every quarter and form, every tab, renders
    bad = pg.evaluate("""() => { const bad = []; ['Q1','Q2','Q3','Q4'].forEach(q => [['26Q', ['challans','deductees','deductions','checks']], ['24Q', ['employees','challans','annex2','checks']]].forEach(([f, tabs]) => tabs.forEach(tb => {
      S.tdsView = 'return'; S.tdsFy = '2025-26'; S.tdsQ = q; S.tdsForm = f; S.tdsTab = tb; try { render(); } catch (e) { bad.push(q + f + tb + ': ' + e.message); } }))); 
      ['years', 'year', 'certs'].forEach(v => { S.tdsView = v; try { render(); } catch (e) { bad.push(v + ': ' + e.message); } }); return bad; }""")
    ok(not bad, "every quarter, form and tab renders" + ("" if not bad else ": " + "; ".join(bad[:3])))
    br.close()
errs = [e for e in errors if "supabase" not in e and "Failed to load" not in e]
ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
