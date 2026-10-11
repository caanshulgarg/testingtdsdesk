"""python3 run_due_list.py - one due list across all clients (TDS/GST round 2, item 1), on the firm's Compliance page
  (round 46, 11-Oct-2026: moved from Today, which keeps one line with the overdue count and "Open Compliance →"):

  every GST and TDS return and TDS deposit of every client, due, overdue or filed, sorted by due date, from the same code
  as each client's TDS and GST pages (DueList, src/js/68-due-list.js), with one click into the client's return.

Four clients, the date fixed at 11-Oct-2026 (window.__dueToday):
  ZZ TDSGST   the fixture books (tests/fixtures/books, 2025-26 and the same a year on), open: monthly GST for two GSTINs,
              26Q and 24Q every quarter, the deposits against the fixture's challans. Q1 2026-27's 26Q marked filed on
              05-Aug-2026 (5 days late, Rs 1,000 fee); Aug-2026 3B typed filed 25-Sep-2026 (5 days late); Aug-2026 GSTR-1
              filed per the portal's return status; Sep-2026's deductions untagged from their challan (not deposited).
  ZZ Second   only a filing date for Sep-2026's GSTR-1 (kept on this computer, not open): listed from Sep-2026, not a year
              of returns "overdue".
  ZZ Quarter  a quarterly (QRMP) filer from Apr-2026: the quarter's GSTR-1 and 3B; IFF never overdue.
  ZZ Blank    no books on this computer: named as not in the list.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("DUE_PORT") or 8331)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

ITEMS = "(cid) => DueList.cache[cid] ? DueList.cache[cid].items.map(x => ({kind: x.kind, what: x.what, form: x.form || '', per: x.per, due: x.due, status: x.status, late: x.late || 0, left: x.left, on: x.on, tds: x.tds || 0, fee: x.fee || 0, unpaid: x.unpaid || 0, source: x.source || '', gstin: x.gstin || ''})) : null"
def find(items, **kw): return [x for x in items if all(x.get(k) == v for k, v in kw.items())]

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate("window.__dueToday = '2026-10-11'")
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500); pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
        c1 = pg.evaluate("S.coId")
        pg.evaluate("""() => {
          const b = S.books;
          b.tdsFiled = {'2026-27|Q1|26Q': {on: '2026-08-05', token: '123456789012345'}};
          b.gstFiled = {'07': {'202608': {r3b: '2026-09-25'}}};
          b.portalFiled = {'07|r1|202608': {arn: 'AA070826000001', dof: '2026-09-10'}};
          b.alloc = Object.assign({}, b.alloc); TDS.rows().filter(r => String(r.date).slice(0, 6) === '202609').forEach(r => { delete b.alloc[r.id]; });
          return saveBooks();
        }""")
        ids = pg.evaluate("""async () => {
          const mk = (name, gstin) => { const c = newCompany({name, gstin}); S.companies[c.id] = c; return c.id; };
          const a = mk('ZZ Second', '27AAACB1234C1Z5'), q = mk('ZZ Quarter', '29AAACQ1234C1Z1'), n = mk('ZZ Blank', '');
          await Books.save(a, {cid: a, gstFiled: {'27': {'202609': {r1: '2026-10-09'}}}});
          await Books.save(q, {cid: q, gstSet: {'29': {filing: [{from: '202604', type: 'qrmp'}]}}, gstFiled: {'29': {'202604': {iff: '2026-05-12'}}}});
          return {a, q, n};
        }""")
        res = pg.evaluate("async () => { const r = await DueList.all(); return {n: r.items.length, missing: r.missing.map(c => c.name), dues: r.items.map(x => x.due)}; }")
        ok(res["missing"] == ["ZZ Blank"], "a client with no books on this computer is named as not in the list (%s)" % res["missing"])
        ok(res["dues"] == sorted(res["dues"]), "the list is sorted by due date")
        it = pg.evaluate(ITEMS, c1)

        # ---- the open client: GST
        x = find(it, kind="gst", what="GSTR-3B", per="Sep-2026", gstin="07AAGCL4827M1Z3")
        ok(len(x) == 1 and x[0]["due"] == "2026-10-20" and x[0]["status"] == "due" and x[0]["left"] == 9, "GSTR-3B Sep-2026: due 20-Oct-2026, in 9 days (%s)" % x)
        x = find(it, kind="gst", what="GSTR-1", per="Sep-2026", gstin="07AAGCL4827M1Z3")
        ok(len(x) == 1 and x[0]["status"] == "due" and x[0]["left"] == 0, "GSTR-1 Sep-2026: due today, 11-Oct (%s)" % x)
        x = find(it, kind="gst", what="GSTR-3B", per="Aug-2026", gstin="07AAGCL4827M1Z3")
        ok(len(x) == 1 and x[0]["status"] == "filed" and x[0]["on"] == "2026-09-25" and x[0]["late"] == 5 and x[0]["source"] == "typed", "GSTR-3B Aug-2026: filed 25-Sep-2026 as typed, 5 days late (%s)" % x)
        x = find(it, kind="gst", what="GSTR-1", per="Aug-2026", gstin="07AAGCL4827M1Z3")
        ok(len(x) == 1 and x[0]["status"] == "filed" and x[0]["on"] == "2026-09-10" and x[0]["late"] == 0 and x[0]["source"] == "portal", "GSTR-1 Aug-2026: filed 10-Sep-2026 per the portal's return status, on time (%s)" % x)
        x = find(it, kind="gst", what="GSTR-3B", per="Jul-2026", gstin="07AAGCL4827M1Z3")
        ok(len(x) == 1 and x[0]["status"] == "overdue" and x[0]["late"] == 52, "GSTR-3B Jul-2026, not filed: overdue 52 days (%s)" % x)
        ok(not find(it, per="Nov-2026") and not find(it, per="Dec-2026"), "nothing due after the next 45 days (Nov-2026 returns are due in December)")
        ok(len(find(it, kind="gst", what="GSTR-3B", per="Sep-2026")) == 2, "each GSTIN of the client has its own returns (07 and 09)")
        # ---- TDS returns
        x = find(it, kind="tds", form="26Q", per="Q1 2026-27")
        ok(len(x) == 1 and x[0]["status"] == "filed" and x[0]["late"] == 5 and x[0]["fee"] == 1000 and x[0]["what"] == "Form 140 (earlier 26Q)", "Form 140 (26Q) Q1 2026-27: filed 05-Aug-2026, 5 days late, fee ₹1,000 (%s)" % x)
        x = find(it, kind="tds", form="26Q", per="Q2 2026-27")
        ok(len(x) == 1 and x[0]["due"] == "2026-10-31" and x[0]["status"] == "due" and x[0]["tds"] == 2000, "Form 140 Q2 2026-27: due 31-Oct-2026, TDS ₹2,000 (%s)" % x)
        x = find(it, kind="tds", form="24Q", per="Q1 2026-27")
        ok(len(x) == 1 and x[0]["status"] == "overdue" and x[0]["late"] == 72 and x[0]["fee"] == 14400, "Form 138 (24Q) Q1 2026-27: overdue 72 days, fee if filed today ₹14,400 (72 x 200) (%s)" % x)
        lf = pg.evaluate("TDS.lateFee('2026-27', 'Q1', '20261011', '24Q').fee")
        ok(lf == 14400, "the fee is TDS.lateFee's, as on the return's own page (%s)" % lf)
        # ---- TDS deposits
        x = find(it, kind="tdspay", per="Sep-2026")
        ok(len(x) == 1 and x[0]["status"] == "overdue" and x[0]["unpaid"] == 2000 and x[0]["due"] == "2026-10-07", "TDS deducted in Sep-2026 and not against a challan: overdue since 07-Oct, ₹2,000 not deposited (%s)" % x)
        x = find(it, kind="tdspay", per="May-2026")
        ok(len(x) == 1 and x[0]["status"] == "filed" and x[0]["unpaid"] == 0, "May-2026's deductions all against a challan: paid (%s)" % x)
        x = find(it, kind="tdspay", per="Mar-2026")
        ok(len(x) == 1 and x[0]["due"] == "2026-04-30", "March's deposit is due on 30 April (%s)" % x)

        # ---- the other clients, from their copy on this computer
        it2 = pg.evaluate(ITEMS, ids["a"])
        ok(it2 is not None and all(x["per"] >= "Sep-2026" or x["per"] in ("Oct-2026",) for x in it2) and not find(it2, status="overdue"), "ZZ Second: listed from Sep-2026, the first month known; no year of returns overdue (%s)" % [(x["what"], x["per"], x["status"]) for x in (it2 or [])])
        x = find(it2 or [], what="GSTR-1", per="Sep-2026")
        ok(len(x) == 1 and x[0]["status"] == "filed" and x[0]["on"] == "2026-10-09", "ZZ Second: Sep-2026 GSTR-1 filed 09-Oct-2026 (%s)" % x)
        x = find(it2 or [], what="GSTR-3B", per="Sep-2026")
        ok(len(x) == 1 and x[0]["due"] == "2026-10-20" and x[0]["status"] == "due", "ZZ Second: Sep-2026 3B due 20-Oct (%s)" % x)
        it3 = pg.evaluate(ITEMS, ids["q"])
        ok(not find(it3 or [], what="IFF", status="overdue"), "ZZ Quarter: an IFF not filed is never 'overdue' (it is optional)")
        x = find(it3 or [], what="GSTR-1", per="Q2 2026-27")
        ok(len(x) == 1 and x[0]["due"] == "2026-10-13" and x[0]["status"] == "due", "ZZ Quarter: the quarter's GSTR-1 (Q2 2026-27) due 13-Oct-2026 (%s)" % x)
        x = find(it3 or [], what="GSTR-3B", per="Q2 2026-27")
        ok(len(x) == 1 and x[0]["due"] == "2026-10-22", "ZZ Quarter: the quarter's 3B due 22-Oct-2026 (Karnataka) (%s)" % x)
        x = find(it3 or [], what="GSTR-3B", per="Q1 2026-27")
        ok(len(x) == 1 and x[0]["status"] == "overdue", "ZZ Quarter: Q1 2026-27's 3B, not filed, overdue (%s)" % x)

        # ---- the Compliance page (round 46: the list moved there from Today, which keeps one line)
        pg.evaluate("navHome('today')"); pg.wait_for_timeout(1500)
        ok(pg.locator("#app [data-due-list]").count() == 0 and pg.locator("#app [data-due-line]").count() == 1 and "overdue" in pg.inner_text("#app [data-due-line]"),
           "Today: no list, one line with the overdue count (%s)" % (pg.inner_text("#app [data-due-line]") if pg.locator("#app [data-due-line]").count() else ""))
        pg.click("#app [data-open-compliance]"); pg.wait_for_timeout(1500)
        ok(pg.evaluate("S.homeTab") == "compliance" and pg.evaluate("location.hash") == "#/compliance", "Open Compliance → the Compliance page, #/compliance")
        box = "#app [data-due-list]"
        ok(pg.locator(box).count() == 1, "Compliance shows the list")
        dues = pg.evaluate("Array.from(document.querySelectorAll('#app [data-due-list] tr[data-due]')).map(t => t.getAttribute('data-status'))")
        ok(dues and set(dues) == {"overdue"}, "opened on 'Overdue': overdue only (%d rows)" % len(dues))
        pg.click('#app [data-due-chip="all"]'); pg.wait_for_timeout(300)
        t = pg.inner_text(box)
        ok("ZZ Second" in t and "ZZ Quarter" in t and "ZZ TDSGST" in t, "every client with books is in the list")
        ok("Not in the list: ZZ Blank" in t, "the client with no books here is named once, with what to do")
        row = '#app [data-due="%s|tdspay|TDS and TCS deposit|Sep-2026"]' % c1
        ok(pg.locator(row).count() == 1 and "₹2,000.00 not deposited" in pg.inner_text(row) and "Overdue 4 days" in pg.inner_text(row), "the Sep-2026 deposit: 'Overdue 4 days', ₹2,000.00 not deposited")
        row24 = '#app [data-due="%s|tds|24Q|Q1 2026-27"]' % c1
        ok(pg.locator(row24).count() == 1 and "late fee ₹14,400.00 if filed today" in pg.inner_text(row24), "Form 138 Q1: late fee ₹14,400.00 if filed today")
        pg.click('#app [data-due-chip="filed"]'); pg.wait_for_timeout(300)
        st = pg.evaluate("Array.from(document.querySelectorAll('#app [data-due-list] tr[data-due]')).map(t => t.getAttribute('data-status'))")
        ok(st and set(st) == {"filed"}, "'Filed or paid' shows only filed returns and paid deposits")
        r140 = '#app [data-due="%s|tds|26Q|Q1 2026-27"]' % c1
        ok(pg.locator(r140).count() == 1 and "Filed 05-Aug-2026, 5 days late" in pg.inner_text(r140), "Form 140 Q1: 'Filed 05-Aug-2026, 5 days late'")
        pg.click('#app [data-due-chip="month"]'); pg.wait_for_timeout(300)
        st = pg.evaluate("Array.from(document.querySelectorAll('#app [data-due-list] tr[data-due]')).map(t => [t.getAttribute('data-status'), t.getAttribute('data-due')])")
        ok(st and all(x[0] == "due" for x in st) and any(x[1].endswith("|Sep-2026") for x in st), "'Due this month': due, not overdue or filed (%d rows)" % len(st))
        pg.click('#app [data-due-chip="overdue"]'); pg.select_option('#app [data-due-tax-pick]', "GST"); pg.wait_for_timeout(300)
        kinds = pg.evaluate("Array.from(document.querySelectorAll('#app [data-due-list] tr[data-due]')).map(t => t.getAttribute('data-due').split('|')[1])")
        ok(kinds and set(kinds) <= {"gst", "gstpay"}, "GST alone: only GST rows")
        # one click into the client's return
        pg.select_option('#app [data-due-client]', ids["a"]); pg.wait_for_timeout(300)
        cl = pg.evaluate("Array.from(document.querySelectorAll('#app [data-due-list] tr[data-due]')).map(t => t.getAttribute('data-due').split('|')[0])")
        ok(all(x == ids["a"] for x in cl), "the client filter: one client's rows only")
        pg.select_option('#app [data-due-tax-pick]', ""); pg.select_option('#app [data-due-client]', ""); pg.click('#app [data-due-chip="all"]'); pg.wait_for_timeout(300)
        pg.click('#app [data-due="%s|gst|GSTR-3B|Sep-2026"] [data-due-open]' % ids["a"]); pg.wait_for_timeout(1500)
        s = pg.evaluate("({co: S.coId, tab: S.tab, bt: S.booksTab, part: S.gstPart, ym: S.gstYm, reg: S.gstReg, view: S.gstView})")
        ok(s["co"] == ids["a"] and s["tab"] == "books" and s["bt"] == "gst" and s["part"] == "vault" and s["ym"] == "202609" and s["reg"] == "27", "a client without a day book: its GST row opens Returns filed for that GSTIN and month (%s)" % s)
        pg.evaluate("navHome('compliance')"); pg.wait_for_timeout(1500); pg.click('#app [data-due-chip="all"]'); pg.wait_for_timeout(300)
        pg.click('#app [data-due="%s|gst|GSTR-3B|Sep-2026"] [data-due-open] >> nth=0' % c1); pg.wait_for_timeout(1800)
        s = pg.evaluate("({co: S.coId, tab: S.tab, bt: S.booksTab, part: S.gstPart, ym: S.gstYm, reg: S.gstReg, view: S.gstView})")
        ok(s["co"] == c1 and s["bt"] == "gst" and s["part"] == "r3b" and s["ym"] == "202609" and s["view"] == "return", "a client with books: the row opens its GSTR-3B for Sep-2026 (%s)" % s)
        ok("GSTR-3B" in (pg.text_content("#app [data-return-title]") or ""), "the GSTR-3B page is shown")
        pg.evaluate("navHome('compliance')"); pg.wait_for_timeout(1200); pg.click('#app [data-due-chip="all"]'); pg.wait_for_timeout(300)
        pg.click('#app [data-due="%s|tds|26Q|Q2 2026-27"] [data-due-open]' % c1); pg.wait_for_timeout(1800)
        s = pg.evaluate("({co: S.coId, bt: S.booksTab, view: S.tdsView, fy: S.tdsFy, q: S.tdsQ, form: S.tdsForm, tab: S.tdsTab})")
        ok(s["co"] == c1 and s["bt"] == "tds" and s["view"] == "return" and s["fy"] == "2026-27" and s["q"] == "Q2" and s["form"] == "26Q" and s["tab"] == "file", "a TDS row opens the return's File tab (%s)" % s)
        ok("Q2" in (pg.text_content("#app [data-return-title]") or ""), "the return's page is shown")
        # marking a return filed there changes the list
        pg.evaluate("() => { S.books.tdsFiled = Object.assign({}, S.books.tdsFiled, {'2026-27|Q2|26Q': {on: '2026-10-10', token: ''}}); }")
        it = pg.evaluate("() => DueList.forClient(CO(), S.books).filter(x => x.kind === 'tds' && x.form === '26Q' && x.per === 'Q2 2026-27').map(x => x.status)")
        ok(it == ["filed"], "marked filed on its page: the list shows it filed (%s)" % it)
        # phone width: the list stays inside the page
        pg.set_viewport_size({"width": 390, "height": 844}); pg.evaluate("navHome('compliance')"); pg.wait_for_timeout(1200)
        w = pg.evaluate("document.documentElement.scrollWidth")
        ok(w <= 392, "phone: no sideways scroll of the page (%s px)" % w)
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
