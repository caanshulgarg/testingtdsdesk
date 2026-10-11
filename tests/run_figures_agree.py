"""python3 run_figures_agree.py - the same figure, for the same year and from the same source, is the same on every page.

The UI audit of 11-Oct-2026 (made-up client "Testing AAD", the fixture books a year on, without the ledgers' groups) saw:
(a) Dashboard "TDS this year Rs 0.00" against the TDS page's Rs 20,000.00 for 2026-27; (b) Reports "Sales 0.00 the year so
far" against MIS's sales of the same year. Causes: (a) the Dashboard's figure was the TDS on bills approved in FinCom, of
every year (it said "for 2026-27" but counted a 2025-26 bill too), and never said the books' TDS is another figure; (b)
Reports read sales from the profit and loss's "Revenue from operations", which without the groups counts only ledgers named
"Sales...", while MIS's sales tile reads the sale entries (MIS.sales). Now the Dashboard says which bills and which year,
counts that year only, and shows the books' TDS of the year as the TDS page does; Reports' sales are MIS.sales.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_figures_agree.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from books_data import CACHE
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Q, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
srv = http.server.ThreadingHTTPServer(("localhost", 8173), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the client of the audit: the fixture books moved a year on, so 2026-27 (this year) has a year of entries; two bills
# approved here with TDS, one of 2026-27 (2,000) and one of 2025-26 (5,000), which is not this year's
SEED = """(bk) => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tan = "DELZ12345A"; S.companies[c.id] = c; c.stats = {};
  const d = S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  const mk = (id, date, vendor, total, tds, fy) => { const e = newEntry(id + ".pdf"); e.id = id;
    e.x = Object.assign(e.x || {}, {vendorName: vendor, invoiceNo: id, invoiceDate: date, total, taxable: total});
    e.status = "approved"; e.approvedAt = date + "T05:00:00Z"; e.snapshot = {lines: [], tds, total, fy}; d.entries[id] = e; };
  mk("b1", "2026-09-12", "LYALLPUR TRADERS", 47200, 2000, "2026-27");
  mk("b0", "2026-03-20", "OLD YEAR SUPPLIER", 59000, 5000, "2025-26");
  S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  const on = (t) => /^\\d{8}$/.test(String(t || "")) ? String(+String(t).slice(0, 4) + 1) + String(t).slice(4) : t;
  const vs = bk.vouchers.map((v) => Object.assign({}, v, {id: v.id + "+1y", date: on(v.date)}));
  S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {vouchers: bk.vouchers.concat(vs), cid: c.id});
  S.books.meta = Object.assign({}, bk.meta, {to: on(bk.meta.to)});
  S.books.map = Books.mapLedgers(S.books.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books; refreshStats(c.id); render(); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8173/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate(SEED, books); pg.wait_for_timeout(800)
    FY = pg.evaluate("fyOf(null)")
    ok(FY == "2026-27", "this year is 2026-27: " + FY)
    # ---------- (b) sales: Reports against MIS, the same year
    pg.evaluate("S.books = window.__bk; goClient('books:reports');"); pg.wait_for_timeout(1200)
    R = pg.evaluate("RPT.range()")
    ok(R["from"] == "20260401" and R["to"] == "20270331", "Reports shows 2026-27: " + json.dumps(R))
    rpt_sales = pg.locator('#app .rpt-overview .dtile:has(span:text-is("Sales")) b').inner_text()
    rpt_head = pg.inner_text("#app .rpt-overview .rpt-ah")
    pg.evaluate("goClient('books:mis'); MIS.run('20260401', '20270331', 'run now'); render();"); pg.wait_for_timeout(1200)
    mis_sales = pg.locator('#app .dtile:has(span:text-is("Sales, the period")) b').inner_text()
    ok(rpt_sales == mis_sales, "Reports' sales %s = MIS's sales %s, 01-Apr-2026 to 31-Mar-2027" % (rpt_sales, mis_sales))
    ok(rpt_sales == "15,50,000.00", "the year's sales, as worked out by hand in tests/fixtures/books/EXPECTED.md: " + rpt_sales)
    ok("2026-27" in rpt_head, "Reports says the year it shows: " + rpt_head.replace("\n", " "))
    # the chart's sales are the same figure, month by month
    ch = pg.evaluate("RPT._d = null; (() => { const d = RPT.data(); return d.months.reduce((a, m) => a + d.sales[m], 0); })()")
    ok(abs(ch - 1550000) < 0.01, "the chart's monthly sales add up to the tile: " + str(ch))
    # without the groups the profit is not known: a dash, as MIS shows it, not 0.00
    pg.evaluate("goClient('books:reports');"); pg.wait_for_timeout(800)
    gp = pg.locator('#app .rpt-overview .dtile:has(span:text-is("Profit before tax")) b').inner_text()
    ok(gp == "—", "profit before tax without the ledgers' groups is a dash, as on MIS: " + gp)
    # ---------- (a) TDS: the Dashboard against the TDS page, the same year and the same source
    pg.evaluate("goClient('books'); S.booksTab = 'tds'; render();"); pg.wait_for_timeout(1500)
    tds_page = pg.locator('#app [data-tds-grid="2026-27"] tr[data-form="26Q"] td:last-child b').inner_text()
    pg.evaluate("goClient('dash');"); pg.wait_for_timeout(1000)
    card = pg.locator('#app .dash-card[data-tone="violet"]')
    ct = card.inner_text()
    ok("2026-27" in card.locator("h3").inner_text(), "the Dashboard's TDS card says its year: " + card.locator("h3").inner_text())
    books_row = card.locator('.dash-row:has-text("In the books")').inner_text() if card.locator('.dash-row:has-text("In the books")').count() else ""
    ok(tds_page in books_row and tds_page == "₹20,000.00", "the books' TDS for 2026-27 on the Dashboard (%s) = the TDS page's Form 140 year (%s)" % (books_row.replace("\n", " "), tds_page))
    bills_row = card.locator('.dash-row:has-text("bills approved here")').inner_text() if card.locator('.dash-row:has-text("bills approved here")').count() else ""
    ok("₹2,000.00" in bills_row, "bills approved here count 2026-27 only (2,000, not the 2025-26 bill's 5,000): " + bills_row.replace("\n", " "))
    stats = pg.evaluate("CO().stats.tdsFy")
    ok(abs(stats - 2000) < 0.01, "the same as the client's figure for the year (refreshStats tdsFy): " + str(stats))
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:200]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
