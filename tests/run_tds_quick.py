"""python3 run_tds_quick.py - TDS quick accuracy fixes (the owner's list of 10-Oct-2026), on the fixture books
(tests/fixtures/books, 2025-26, and the same books a year on), as a user would use them:

  T-E1  "Mark filed" (date and token number) on a return's File tab, per form and quarter: a person confirms it; the year's
        grid shows it filed; the late fee is worked out to that date (no "if filed today" fee for a filed quarter, and the
        fee is no error to fix); the date typed earlier under Settings > Closed periods is read for every form of its
        quarter, and marking fills that date when it is empty; a cancelled or wrong entry keeps nothing.
  T-A2  the rate that applies decided by the PAN's 4th letter and what was paid for: 194C to a company at 1% and 194J
        professional fees at 2% are rate questions; 194C to an individual at 1% is not; 206AA (no PAN) unchanged.
  T-S3  interest and late fee for 26Q, 27Q, 27EQ and 24Q: 1% a month for deducting late (a TDS entry after the bill),
        1.5% for paying late (1% for TCS), the 234E fee (27EQ due on the 15th), 271H in words, "pay with the next challan".
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDSQ_PORT") or 8317)
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

def go(pg, fy, q="", form="", tab=""):
    pg.evaluate("(a) => { S.booksTab = 'tds'; S.tdsFy = a[0]; S.tdsQ = a[1]; if (a[2]) { S.tdsView = 'return'; S.tdsForm = a[2]; S.tdsTab = a[3] || 'summary'; } else { S.tdsView = 'year'; S.tdsPickForm = ''; } render(); }", [fy, q, form, tab])
    pg.wait_for_timeout(400)

def app(pg): return pg.inner_text("#app")
def cell(pg, k): return pg.get_attribute('#app [data-cell="%s"]' % k, "data-status")

def type_date(pg, sel, text):
    pg.click(sel); pg.fill(sel, text); pg.keyboard.press("Tab"); pg.wait_for_timeout(200)

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        start(pg)
        ok(pg.evaluate("BOOKS_KEYS.includes('tdsFiled')"), "the filed marks are kept with the books (BOOKS_KEYS), so they are shared like the challans")

        # ---------------- T-E1: Mark filed ----------------
        go(pg, "2025-26")
        ok(cell(pg, "26Q|Q1") != "filed", "before: 26Q Q1 2025-26 is not shown filed (%s)" % cell(pg, "26Q|Q1"))
        go(pg, "2025-26", "Q1", "26Q", "checks")
        t = app(pg)
        ok("if filed today" in t, "before: Errors to fix shows a late fee 'if filed today'")
        go(pg, "2025-26", "Q1", "26Q", "file")
        box = '#app [data-filed="26Q|Q1"]'
        ok(pg.locator(box).count() == 1 and "Mark filed" in pg.inner_text(box), "the File tab has Mark filed with the date and the token number")
        # a wrong token is refused before anything is asked
        type_date(pg, box + ' input[aria-label="Filed on"]', "25-07-2025"); pg.fill(box + ' input[aria-label="Token number"]', "12345")
        pg.click(box + ' [data-mark-filed]'); pg.wait_for_timeout(400)
        ok(pg.evaluate("!(S.books.tdsFiled || {})['2025-26|Q1|26Q']") and not pg.is_visible("#confirmBox [data-cbx=yes]"), "a token that is not 15 digits: refused, nothing kept, nothing asked")
        ok("before the quarter ended" in pg.evaluate("TDSFiled.problem('2025-26', 'Q1', '2025-06-20', '')"), "a date before the quarter ended is refused, in words")
        ok("after today" in pg.evaluate("TDSFiled.problem('2026-27', 'Q2', '2099-01-01', '')"), "a date after today is refused")
        # cancelled: nothing kept
        pg.fill(box + ' input[aria-label="Token number"]', "123456789012345")
        pg.click(box + ' [data-mark-filed]'); pg.wait_for_timeout(400)
        ok(pg.is_visible("#confirmBox [data-cbx=yes]") and "Mark 26Q, Q1 2025-26 filed?" in pg.inner_text("#confirmBox"), "Mark filed asks the person to confirm first")
        pg.click("#confirmBox [data-cbx=no]"); pg.wait_for_timeout(300)
        ok(pg.evaluate("!(S.books.tdsFiled || {})['2025-26|Q1|26Q']"), "cancelled: nothing kept")
        pg.click(box + ' [data-mark-filed]'); pg.wait_for_timeout(400)
        pg.click("#confirmBox [data-cbx=yes]"); pg.wait_for_timeout(500)
        f = pg.evaluate("S.books.tdsFiled['2025-26|Q1|26Q']")
        ok(f and f["on"] == "2025-07-25" and f["token"] == "123456789012345", "confirmed: kept with the date and token (%s)" % f)
        ok(pg.evaluate("ClosedP.cfg(CO()).tdsFiled['2025-26|Q1']") == "2025-07-25", "the quarter's date under Settings > Closed periods is filled from it")
        lf = pg.evaluate("TDS.lateFee('2025-26', 'Q1', TDSFiled.get('2025-26', 'Q1', '26Q').on, '26Q')")
        ok(lf["fee"] == 0 and lf["days"] == 0, "filed by the due date: no late fee (%s)" % lf)
        t = pg.inner_text(box)
        ok("25-Jul-2025" in t and "123456789012345" in t, "the File tab shows the filed date and token")
        go(pg, "2025-26", "Q1", "26Q", "checks"); t = app(pg)
        ok("if filed today" not in t and "filed on 25-Jul-2025" in t, "Errors to fix: the fee is worked out to the filed date, not 'if filed today'")
        go(pg, "2025-26")
        ok(cell(pg, "26Q|Q1") == "filed" and "Filed" in pg.inner_text('#app [data-cell="26Q|Q1"]'), "the year's grid: 26Q Q1 shows Filed (green)")

        # the date typed earlier under Settings > Closed periods: read for every form of its quarter
        pg.evaluate("() => { const co = CO(); ClosedP.set(co, 'tdsFiled', Object.assign({}, ClosedP.cfg(co).tdsFiled, {'2025-26|Q2': '2025-11-05'})); render(); }"); pg.wait_for_timeout(400)
        ok(cell(pg, "26Q|Q2") == "filed" and cell(pg, "24Q|Q2") == "filed", "a date typed under Settings > Closed periods: 26Q and 24Q of Q2 show Filed")
        lf = pg.evaluate("TDS.lateFee('2025-26', 'Q2', TDSFiled.get('2025-26', 'Q2', '26Q').on, '26Q')")
        ok(lf["days"] == 5 and lf["fee"] == 1000, "filed 05-Nov-2025, due 31-Oct: 5 days at 200 = 1,000 (%s)" % lf)
        go(pg, "2025-26", "Q2", "26Q", "checks"); t = app(pg)
        ok("filed on 05-Nov-2025" in t and "₹1,000.00" in t and "if filed today" not in t, "Errors to fix: the fee to the date typed under Closed periods, ₹1,000.00")
        go(pg, "2025-26", "Q2", "26Q", "file")
        ok("Settings › Closed periods" in pg.inner_text('#app [data-filed="26Q|Q2"]'), "the File tab says where the date came from")
        # an unfiled quarter of an earlier year still has its fee 'if filed today', counted as an error
        go(pg, "2025-26", "Q3", "26Q", "checks"); t = app(pg)
        ok("if filed today" in t, "an unfiled quarter (Q3 2025-26): the fee 'if filed today' is still shown")
        # take the mark off: asked first
        pg.evaluate("() => { TDSFiled.unmark('2025-26', 'Q1', '26Q'); }"); pg.wait_for_timeout(300)
        ok(pg.is_visible("#confirmBox [data-cbx=yes]"), "taking the filed mark off asks first")
        pg.click("#confirmBox [data-cbx=yes]"); pg.wait_for_timeout(300)
        ok(pg.evaluate("!(S.books.tdsFiled || {})['2025-26|Q1|26Q'] && !TDSFiled.get('2025-26', 'Q1', '26Q') && !ClosedP.cfg(CO()).tdsFiled['2025-26|Q1']"), "taken off: the mark goes, and the Closed periods date it filled")
        # 24Q marked filed from its own File tab
        go(pg, "2025-26", "Q3", "24Q", "file")
        b24 = '#app [data-filed="24Q|Q3"]'
        ok(pg.locator(b24).count() == 1, "24Q's File tab has Mark filed")
        type_date(pg, b24 + ' input[aria-label="Filed on"]', "20-01-2026"); pg.click(b24 + ' [data-mark-filed]'); pg.wait_for_timeout(400); pg.click("#confirmBox [data-cbx=yes]"); pg.wait_for_timeout(400)
        go(pg, "2025-26")
        ok(cell(pg, "24Q|Q3") == "filed" and cell(pg, "26Q|Q3") != "filed", "24Q Q3 filed shows Filed; 26Q Q3 (not marked) does not, though the Closed periods date was filled from 24Q's")
        ok(pg.evaluate("ClosedP.cfg(CO()).tdsFiled['2025-26|Q3']") == "2026-01-20", "the Closed periods date for Q3 is filled from 24Q's")

        # ---------------- T-A2: the rate by who the deductee is ----------------
        Q = "(a) => Certs.issues(a[0], a[1]).filter(x => x.row.party === a[2]).map(x => ({exp: x.expected, why: x.why, short: x.short, rate: x.row.rate}))"
        pg.evaluate("() => { S.books.pans = Object.assign({}, S.books.pans, {'Peregrine Tent Works': 'AABCP1234Q'}); }")
        iss = pg.evaluate(Q, ["2025-26", "Q2", "Peregrine Tent Works"])
        ok(len(iss) == 1 and iss[0]["exp"] == 2 and "company" in iss[0]["why"] and iss[0]["short"] == 2000, "194C at 1%% to a company (PAN AABCP…): 2%% applies, ₹2,000 short (%s)" % iss)
        pg.evaluate("() => { S.books.pans['Peregrine Tent Works'] = 'ABCPP1234Q'; }")
        ok(pg.evaluate(Q, ["2025-26", "Q2", "Peregrine Tent Works"]) == [], "194C at 1% to an individual (PAN ABCPP…): as expected")
        pg.evaluate("() => { S.books.pans['Nightjar Sound & Light Co'] = 'ABCHN1234Q'; }")
        iss = pg.evaluate(Q, ["2025-26", "Q1", "Nightjar Sound & Light Co"])
        ok(len(iss) == 2 and all(x["exp"] == 1 and "HUF" in x["why"] and x["short"] == -1000 for x in iss), "194C at 2%% to a HUF: 1%% applies, ₹1,000 deducted in excess on each (%s)" % iss)
        pg.evaluate("() => { S.books.pans['Nightjar Sound & Light Co'] = 'AABFN1234Q'; }")
        ok(pg.evaluate(Q, ["2025-26", "Q1", "Nightjar Sound & Light Co"]) == [], "194C at 2% to a firm: as expected")
        # 194J professional fees deducted at 2%: plant it on Juniper's November bill
        pg.evaluate("() => { S.books.pans['Juniper Legal Associates'] = 'AAFFJ1234Q'; const v = S.books.vouchers.find(v => v.party === 'Juniper Legal Associates' && v.date === '20251105'); v.ent.find(e => /TDS ON PROFESSIONAL/.test(e.l)).a = 1200; }")
        row = pg.evaluate("TDS.rows().find(r => r.party === 'Juniper Legal Associates' && r.date === '20251105')")
        ok(row["rate"] == 2 and row["pay"] == "professional", "the planted row: 2%% on ₹60,000, paid for professional fees (its expense ledger) (%s, %s)" % (row["rate"], row["pay"]))
        iss = pg.evaluate(Q, ["2025-26", "Q3", "Juniper Legal Associates"])
        ok(len(iss) == 1 and iss[0]["exp"] == 10 and "professional" in iss[0]["why"] and iss[0]["short"] == 4800, "194J professional fees at 2%%: 10%% applies, ₹4,800 short (%s)" % iss)
        go(pg, "2025-26", "Q3", "26Q", "checks"); t = app(pg)
        ok("194J, professional fees: 10%" in t and "₹4,800.00" in t, "Errors to fix lists it with the reason in words")
        E = "(r) => Certs.expected(Object.assign({party: 'X', date: '20251001', paid: 100000, fy: '2025-26', q: 'Q3'}, r))"
        ok(pg.evaluate(E, {"section": "194I", "pan": "ABCPX1234K", "rate": 2, "pay": "rent_building"})["rate"] == 10, "194-I rent of a building at 2%: 10% applies")
        ok(pg.evaluate(E, {"section": "194I", "pan": "ABCPX1234K", "rate": 2, "pay": "rent_machinery"})["rate"] == 2, "194-I rent of machinery at 2%: as expected")
        ok(pg.evaluate(E, {"section": "194J", "pan": "AABCX1234K", "rate": 10, "pay": "technical"})["rate"] == 2, "194J technical services: 2%")
        e = pg.evaluate(E, {"section": "194C", "pan": "", "rate": 1, "pay": ""})
        ok(e["rate"] == 20 and "206AA" in e["why"], "no PAN: 206AA's 20%%, unchanged (%s)" % e)
        e = pg.evaluate(E, {"section": "194J", "pan": "AABCX1234K", "rate": 10, "pay": ""})
        ok(e["rate"] == 10 and "usual rate" in e["why"], "194J with nothing to say what for: the nearest usual rate, as before (%s)" % e)
        ok(pg.evaluate("TDSRate.kindOf('Fees for Technical Services')") == "technical" and pg.evaluate("TDSRate.kindOf('Hire of Plant and Machinery')") == "rent_machinery"
           and pg.evaluate("TDSRate.kindOf('Office Rent')") == "rent_building", "Tally's nature of payment and ledger names read as the payment type")

        # ---------------- T-S3: interest and late fee for every form ----------------
        # a TDS entry of its own on 05-Aug-2025 for a bill of 10-Jun-2025: deducted late, Jun to Aug = 3 months at 1%
        pg.evaluate("""() => { const b = S.books;
          b.vouchers.push({id: 'zz-bill', date: '20250610', no: 'KM/1', type: 'Journal', party: 'Kestrel Movers', ent: [{l: 'Freight Charges', a: -50000}, {l: 'Kestrel Movers', a: 50000}]});
          b.vouchers.push({id: 'zz-tds', date: '20250805', no: 'JV/9', type: 'Journal', party: 'Kestrel Movers', ent: [{l: 'Kestrel Movers', a: -1000}, {l: 'TDS ON CONTRACT 194C', a: 1000}]});
          // 27Q: a payment to a non-resident, paid late; 27EQ: TCS collected, paid late
          b.map['TDS ON NON RESIDENT 195'] = {kind: 'tds_payable', section: '195', rate: null}; b.map['TCS PAYABLE 206C1H'] = {kind: 'tcs_payable', section: '206C1H', rate: null};
          b.vouchers.push({id: 'zz-nr', date: '20250812', no: 'NR/1', type: 'Journal', party: 'Oslo Design AS', ent: [{l: 'Design Fees', a: -100000}, {l: 'TDS ON NON RESIDENT 195', a: 20800}, {l: 'Oslo Design AS', a: 79200}]});
          b.vouchers.push({id: 'zz-tcs', date: '20250814', no: 'S/77', type: 'Sales', party: 'Tern Traders', ent: [{l: 'Tern Traders', a: -100100}, {l: 'Sales', a: 100000}, {l: 'TCS PAYABLE 206C1H', a: 100}]});
          b.challans.push({id: 'chNR', bsr: '0240020', serial: '20001', date: '20251020', tax: 20800, interest: 0}, {id: 'chTC', bsr: '0240020', serial: '20002', date: '20251020', tax: 100, interest: 0});
          b.alloc['zz-nr|TDS ON NON RESIDENT 195'] = 'chNR'; b.alloc['zz-tcs|TCS PAYABLE 206C1H'] = 'chTC'; render(); }""")
        pg.wait_for_timeout(300)
        it = pg.evaluate("TDS.interest('2025-26', 'Q2', '26Q').filter(x => x.row.party === 'Kestrel Movers').map(x => [x.kind, x.months, x.amount, x.from])")
        ok(it == [["deduct", 3, 30, "20250610"]], "26Q: deducted on 05-Aug for the bill of 10-Jun: 1%% x 3 months on ₹1,000 = ₹30 (%s)" % it)
        it = pg.evaluate("TDS.interest('2025-26', 'Q2', '27Q').map(x => [x.kind, x.rate, x.months, x.amount])")
        ok(it == [["pay", 1.5, 3, 936]], "27Q: ₹20,800 deducted 12-Aug, paid 20-Oct (due 07-Sep): 1.5%% x 3 months = ₹936 (%s)" % it)
        it = pg.evaluate("TDS.interest('2025-26', 'Q2', '27EQ').map(x => [x.kind, x.rate, x.months, x.amount])")
        ok(it == [["pay", 1, 3, 3]], "27EQ: ₹100 TCS collected 14-Aug, paid 20-Oct: 1%% x 3 months = ₹3 (%s)" % it)
        ok(pg.evaluate("TDS.returnDue('2025-26', 'Q2', '27EQ')") == "20251015" and pg.evaluate("TDS.returnDue('2025-26', 'Q2', '27Q')") == "20251031", "due dates: 27EQ on the 15th (15-Oct), 27Q on 31-Oct")
        lf = pg.evaluate("TDS.lateFee('2025-26', 'Q2', '2025-10-20', '27EQ')")
        ok(lf["days"] == 5 and lf["fee"] == 100 and lf["cap"] == 100, "27EQ filed 20-Oct: 5 days late, ₹1,000 capped at the TCS of ₹100 (%s)" % lf)
        lf = pg.evaluate("TDS.lateFee('2025-26', 'Q1', '', '24Q')")
        ok(lf["cap"] == 22968 and lf["fee"] == 22968 and lf["p271h"], "24Q Q1 2025-26 not filed: the fee capped at the salary sheet's TDS ₹22,968, and past a year: 271H (%s)" % lf)
        go(pg, "2025-26", "Q2", "27Q", "checks"); t = app(pg)
        ok(pg.locator('#app [data-interest="27Q"]').count() == 1 and "₹936.00" in t and "paid late" in t, "27Q's Errors to fix: interest and late fee, ₹936.00 paid late")
        ok(pg.locator('#app [data-next-challan]').count() == 1, "it says what to pay with the next challan")
        go(pg, "2025-26", "Q2", "27EQ", "checks"); t = app(pg)
        ok(pg.locator('#app [data-interest="27EQ"]').count() == 1 and "206C(7)" in t, "27EQ's Errors to fix: interest under 206C(7)")
        go(pg, "2025-26", "Q1", "24Q", "checks"); t = app(pg)
        ok(pg.locator('#app [data-interest="24Q"]').count() == 1 and "271H" in t and "₹22,968.00" in t, "24Q's Errors to fix: the late fee (₹22,968.00) and 271H")
        go(pg, "2025-26", "Q2", "26Q", "checks"); t = app(pg)
        ok("deducted late: bill of 10-Jun-2025" in t and "₹30.00" in t, "26Q's Errors to fix: the late deduction, in words")
        go(pg, "2026-27", "Q2", "26Q", "checks"); t = app(pg)
        ok("if filed today" in t and "271H" not in t, "the quarter due now (Q2 2026-27, due 31-Oct): no fee yet, no 271H line")
        br.close()
finally:
    srv.shutdown()
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
