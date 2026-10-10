"""python3 run_tds_smart.py - smarter TDS (the owner's list of 10-Oct-2026, group 2), on the fixture books
(tests/fixtures/books, 2025-26, and the same books a year on), faults planted and found:

  T-A3  lower-deduction certificates with a PAN, an amount limit and dates: the lower rate up to the limit (a payment
        that crosses it at a blended rate), the usual rate once it is used or after the last day; matched by PAN (a name
        spelt differently still matches; another PAN does not); used and left, a warning at 80% and near the end.
  T-A4  the TDS payable ledgers in Tally against TDS deducted less challans, per quarter: the fixture agrees (opening
        1,200; deducted 20,000; paid 11,200, EXPECTED.md); a journal adjusting a TDS ledger and a missing challan named.
  T-S1  each party's running total against the TDS limit; Ashvattha's freight of 40,000 (over 30,000 a bill, no TDS)
        on the "should have deducted" list with the TDS due, interest to today and the 40(a)(ia) amount at risk.
  T-S2  a filed return whose entries change in Tally: added, changed, PAN-only (C5) and deleted rows; the grid shows the
        correction; "Correction filed" asks first and takes the copy again. The copy is kept with the books (BOOKS_KEYS,
        the client_books row): no new table or migration.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDSSMART_PORT") or 8319)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

def go(pg, fy, q="", form="", tab="", view=""):
    pg.evaluate("(a) => { S.booksTab = 'tds'; S.tdsFy = a[0]; S.tdsQ = a[1]; if (a[4]) { S.tdsView = a[4]; } else if (a[2]) { S.tdsView = 'return'; S.tdsForm = a[2]; S.tdsTab = a[3] || 'summary'; } else { S.tdsView = 'year'; S.tdsPickForm = ''; } render(); }", [fy, q, form, tab, view])
    pg.wait_for_timeout(400)
def app(pg): return pg.inner_text("#app")
def yes(pg):
    pg.wait_for_selector("#confirmBox [data-cbx=yes]", timeout=5000); pg.click("#confirmBox [data-cbx=yes]"); pg.wait_for_timeout(400)

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500); pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
        pg.evaluate("() => { S.books.pans = Object.assign({}, S.books.pans, {'Nightjar Sound & Light Co': 'AABFN1234Q', 'Peregrine Tent Works': 'ABCPP1234Q', 'Juniper Legal Associates': 'AAFFJ1234Q'}); render(); }")

        # ---------------- T-A3: certificate limits ----------------
        go(pg, "2025-26", view="certs")
        row = '#app tr.lt-new '
        ok(pg.locator(row + 'input[aria-label="New certificate: amount limit"]').count() == 1, "a new certificate has an amount limit box")
        for k, v in [("from", "2025-04-01"), ("to", "2026-03-31")]:
            pg.fill(row + 'input[aria-label="New certificate: %s"]' % k, v)
        for k, v in [("number", "LDC2025NJ01"), ("deductee", "Nightjar Sound and Light"), ("PAN", "AABFN1234Q"), ("section", "194C"), ("rate", "0.5"), ("amount limit", "150000")]:
            pg.fill(row + 'input[aria-label="New certificate: %s"]' % k, v)
        pg.click(row + 'button:has-text("Add")'); pg.wait_for_timeout(400)
        c = pg.evaluate("S.books.certs[0]")
        ok(c and c["limit"] == 150000 and c["pan"] == "AABFN1234Q" and c["rate"] == 0.5, "added with its PAN, rate and limit (%s)" % c)
        E = "(d) => { const r = TDS.rows().find(r => r.party === 'Nightjar Sound & Light Co' && r.date === d); const e = Certs.expected(r); return [e.rate, e.why]; }"
        e1, e2, e3 = pg.evaluate(E, "20250505"), pg.evaluate(E, "20250508"), pg.evaluate(E, "20260115")
        ok(e1[0] == 0.5 and "LDC2025NJ01" in e1[1], "05-May ₹1,00,000: within the limit, the certificate's 0.5%%, matched by PAN though the name differs (%s)" % e1)
        ok(e2[0] == 1.25 and "50,000" in e2[1], "08-May ₹1,00,000: ₹50,000 left at 0.5%% and ₹50,000 at 2%% = 1.25%% (%s)" % e2)
        ok(e3[0] == 2 and "used up" in e3[1], "15-Jan ₹1,50,000: the limit used up, the usual 2%% (%s)" % e3)
        iss = pg.evaluate("Certs.issues('2025-26', 'Q1').filter(x => x.row.party === 'Nightjar Sound & Light Co').map(x => [x.expected, x.short])")
        ok(iss == [[0.5, -1500], [1.25, -750]], "rate questions: deducted 2%% where the certificate allowed less (excess ₹1,500 and ₹750) (%s)" % iss)
        ok(pg.evaluate("TDSLdc.state(S.books.certs[0]).st") == "ended", "a certificate past its last day: 'Ended'")
        # running on to a date after today: the 2026-27 copies of May (₹2,00,000) are covered too, ₹5,50,000 in all
        pg.evaluate("() => { const c = S.books.certs[0]; c.to = '2026-12-31'; c.limit = 500000; }")
        st = pg.evaluate("TDSLdc.state(S.books.certs[0])")
        ok(st["used"] == 550000 and st["st"] == "full" and "used up" in st["words"], "used ₹5,50,000 of ₹5,00,000: 'Amount used up' (%s)" % st)
        pg.evaluate("() => { S.books.certs[0].limit = 650000; }")
        st = pg.evaluate("TDSLdc.state(S.books.certs[0])")
        ok(st["st"] == "warn" and st["words"].startswith("84%") and st["left"] == 100000, "limit ₹6,50,000: 84%% used, ₹1,00,000 left, warned (%s)" % st)
        pg.evaluate("() => { S.books.certs[0].limit = 150000; S.books.certs[0].to = '2025-12-31'; }")
        ok(pg.evaluate(E, "20260115")[0] == 2, "after the certificate's last day: the usual rate")
        pg.evaluate("() => { S.books.certs[0].pan = 'AABFZ9999Q'; }")
        ok(pg.evaluate(E, "20250505")[0] == 2, "a certificate for another PAN does not cover Nightjar, whatever the name")
        pg.evaluate("() => { const c = S.books.certs[0]; c.pan = 'AABFN1234Q'; c.to = (() => { const d = new Date(Date.now() + 330 * 60000 + 10 * 86400000); return d.toISOString().slice(0, 10); })(); }")
        st = pg.evaluate("TDSLdc.state(S.books.certs[0])")
        ok(st["days"] == 10, "ends in 10 days: said (%s)" % st)
        pg.evaluate("() => { S.books.certs[0].limit = 1000000; render(); }"); pg.wait_for_timeout(300)
        go(pg, "2025-26", view="certs"); t = pg.inner_text('#app [data-certs]')
        ok("Ends in 10 days" in t and "₹5,50,000.00" in t and "₹4,50,000.00" in t, "the certificates list: used ₹5,50,000.00, left ₹4,50,000.00, 'Ends in 10 days'")
        pg.evaluate("() => { S.books.certs = []; render(); }")

        # ---------------- T-A4: the TDS payable ledgers ----------------
        pg.evaluate("() => { S.books.challans = [{id: 'cA', bsr: '0240020', serial: '1', date: '20250407', tax: 1200, interest: 0}, {id: 'cB', bsr: '0240020', serial: '2', date: '20260207', tax: 10000, interest: 0}]; S.books.alloc = {}; render(); }")
        T = "(q) => { const x = TDSTie.quarter('2025-26', q); return [x.deducted, x.challans, x.moved, x.gap, x.paidBooks, x.chGap]; }"
        ok(pg.evaluate(T, "Q1") == [4000, 1200, 2800, 0, 1200, 0], "Q1: deducted 4,000, challan 1,200 (March's TDS paid 07-Apr), ledgers moved 2,800: agrees (%s)" % pg.evaluate(T, "Q1"))
        ok(pg.evaluate(T, "Q4") == [8000, 10000, -2000, 0, 10000, 0], "Q4: deducted 8,000, paid 10,000 through the month-end account: moved -2,000, agrees (%s)" % pg.evaluate(T, "Q4"))
        tot = pg.evaluate("TDSTie.quarters('2025-26').reduce((a, x) => [a[0] + x.deducted, a[1] + x.challans], [0, 0])")
        ok(tot == [20000, 11200], "the year: deducted 20,000 and paid 11,200, as worked out by hand (EXPECTED.md) (%s)" % tot)
        pg.evaluate("() => { S.books.vouchers.push({id: 'zz-adj', date: '20250915', no: 'JV/5', type: 'Journal', party: '', ent: [{l: 'TDS ON CONTRACT 194C', a: -500}, {l: 'Sundry Balances Written Off', a: 500}]}); render(); }")
        x = pg.evaluate("TDSTie.quarter('2025-26', 'Q2')")
        ok(x["gap"] == -500 and any("fell by ₹500" in w for w in pg.evaluate("TDSTie.why(TDSTie.quarter('2025-26', 'Q2'))")), "a journal taking ₹500 out of a TDS ledger in Q2: a ₹500 difference, named (%s)" % x["gap"])
        pg.evaluate("() => { S.books.challans = S.books.challans.filter(c => c.id !== 'cB'); render(); }")
        x = pg.evaluate("TDSTie.quarter('2025-26', 'Q4')")
        ok(x["chGap"] == -10000 and any("make a challan" in w for w in pg.evaluate("TDSTie.why(TDSTie.quarter('2025-26', 'Q4'))")), "the February payment with no challan here: named (%s)" % x["chGap"])
        go(pg, "2025-26"); t = pg.inner_text('#app [data-tieout="2025-26"]')
        ok("TDS payable in Tally" in t and "₹-500.00" in t and "2 quarters differ" in t, "the year's page: the tie-out, two quarters differ")

        # ---------------- T-S1: limits and missed TDS ----------------
        y = pg.evaluate("TDSWatch.year('2025-26').map(x => [x.party, x.rule, x.credited, x.over, x.uncovered, x.due])")
        nj = [r for r in y if r[0] == "Nightjar Sound & Light Co"]
        ok(nj and nj[0][3] and nj[0][4] == 0, "Nightjar: over the limit, all covered by its TDS (%s)" % nj)
        ash = pg.evaluate("TDSWatch.missed('2025-26').find(x => x.party === 'Ashvattha Transport Co')")
        ok(ash and ash["rule"] == "contractor" and ash["base"] == 40000 and ash["rate"] == 20 and ash["due"] == 8000, "Ashvattha's freight ₹40,000 (over ₹30,000 a bill), no TDS, no PAN: ₹8,000 due at 20%% (%s)" % (ash and [ash["base"], ash["rate"], ash["due"]]))
        pg.evaluate("() => { S.books.pans['Ashvattha Transport Co'] = 'ABCPA1234K'; }")
        ash = pg.evaluate("TDSWatch.missed('2025-26').find(x => x.party === 'Ashvattha Transport Co')")
        months = pg.evaluate("TDS.monthsBetween('20260205', TDSFiled.todayIst())")
        ok(ash["due"] == 400 and ash["interest"] == round(400 * 0.01 * months, 2) and ash["disallow"] == 12000,
           "with an individual's PAN: ₹400 due at 1%%, interest 1%% x %d months = ₹%s, ₹12,000 at risk under 40(a)(ia) (%s)" % (months, ash["interest"], [ash["due"], ash["interest"], ash["disallow"]]))
        ok(not pg.evaluate("TDSWatch.missed('2025-26').some(x => x.party === 'Juniper Legal Associates' || x.party === 'Nightjar Sound & Light Co')"), "parties whose TDS covers their payments are not on the list")
        go(pg, "2025-26"); t = pg.inner_text('#app [data-limits="2025-26"]')
        ok("Ashvattha Transport Co" in t and "Should have deducted" in t and "₹12,000.00" in t, "the year's page: the limits and 'Should have deducted' with the 40(a)(ia) amount")

        # ---------------- T-S2: a filed quarter changed in Tally ----------------
        go(pg, "2025-26", "Q3", "26Q", "file")
        box = '#app [data-filed="26Q|Q3"]'
        pg.click(box + ' input[aria-label="Filed on"]'); pg.fill(box + ' input[aria-label="Filed on"]', "20-01-2026"); pg.keyboard.press("Tab"); pg.wait_for_timeout(200)
        pg.click(box + ' [data-mark-filed]'); pg.wait_for_timeout(300)
        ok("copy of the quarter's entries is kept" in pg.inner_text("#confirmBox"), "marking filed says a copy of the entries is kept")
        yes(pg)
        snap = pg.evaluate("Object.keys((S.books.tdsSnap['2025-26|Q3|26Q'] || {}).rows || {}).length")
        ok(snap == 1 and pg.evaluate("BOOKS_KEYS.includes('tdsSnap')"), "the copy of Q3's one entry is kept with the books (%s)" % snap)
        ok(pg.evaluate("TDSDrift.check('2025-26', 'Q3', '26Q').rows.length") == 0, "nothing changed yet")
        pg.evaluate("""() => { const b = S.books; const v = b.vouchers.find(v => v.party === 'Juniper Legal Associates' && v.date === '20251105'); v.ent.find(e => /TDS ON PROFESSIONAL/.test(e.l)).a = 5000;
          b.vouchers.push({id: 'zz-q3', date: '20251210', no: 'P/90', type: 'Purchase', party: 'Peregrine Tent Works', ent: [{l: 'Tent Hire', a: -50000}, {l: 'TDS ON CONTRACT 194C', a: 500}, {l: 'Peregrine Tent Works', a: 49500}]}); render(); }""")
        d = pg.evaluate("TDSDrift.check('2025-26', 'Q3', '26Q').rows.map(x => [x.party, x.what, x.type])")
        ok(sorted(d) == sorted([["Juniper Legal Associates", "changed", "C3"], ["Peregrine Tent Works", "added", "C3"]]), "Juniper's TDS changed and a new deduction added in Tally: two C3 changes (%s)" % d)
        go(pg, "2025-26")
        c = pg.evaluate("(() => { const c = document.querySelector('#app [data-cell=\"26Q|Q3\"]'); return [c.dataset.status, c.innerText.replace(/\\s+/g, ' ')]; })()")
        ok(c[0] == "bad" and "Correction 2" in c[1], "the grid: 26Q Q3 shows 'Correction 2' in red, with its filed date (%s)" % c)
        go(pg, "2025-26", "Q3", "26Q", "checks"); t = app(pg)
        ok(pg.locator('#app [data-correction="26Q|Q3"]').count() == 1 and "Correction needed: 2 entries changed in Tally since filing" in t, "Errors to fix: the correction needed, with each change")
        pg.evaluate("() => { const v = S.books.vouchers.find(v => v.id === 'zz-q3'); S.books.vouchers.splice(S.books.vouchers.indexOf(v), 1); const j = S.books.vouchers.find(v => v.party === 'Juniper Legal Associates' && v.date === '20251105'); j.ent.find(e => /TDS ON PROFESSIONAL/.test(e.l)).a = 6000; S.books.pans['Juniper Legal Associates'] = 'AAFFJ9999Q'; render(); }")
        d = pg.evaluate("TDSDrift.check('2025-26', 'Q3', '26Q').rows.map(x => [x.what, x.type])")
        ok(d == [["changed", "C5"]], "put back, but Juniper's PAN changed: one C5 (%s)" % d)
        pg.evaluate("() => { const j = S.books.vouchers.find(v => v.party === 'Juniper Legal Associates' && v.date === '20251105'); S.books.vouchers.splice(S.books.vouchers.indexOf(j), 1); render(); }")
        d = pg.evaluate("TDSDrift.check('2025-26', 'Q3', '26Q').rows.map(x => [x.what, x.type])")
        ok(d == [["deleted", "C3"]], "the entry deleted in Tally: a C3 to set it to nil (%s)" % d)
        go(pg, "2025-26", "Q3", "26Q", "checks")
        pg.click('#app [data-corrected]'); pg.wait_for_timeout(300)
        ok(pg.is_visible("#confirmBox [data-cbx=yes]"), "Correction filed asks first")
        pg.click("#confirmBox [data-cbx=no]"); pg.wait_for_timeout(300)
        ok(pg.evaluate("TDSDrift.check('2025-26', 'Q3', '26Q').rows.length") == 1, "cancelled: the change still shows")
        pg.click('#app [data-corrected]'); pg.wait_for_timeout(300); yes(pg)
        ok(pg.evaluate("TDSDrift.check('2025-26', 'Q3', '26Q').rows.length") == 0 and len(pg.evaluate("S.books.tdsFiled['2025-26|Q3|26Q'].corrected")) == 1, "confirmed: the copy taken again, the correction recorded")
        br.close()
finally:
    srv.shutdown()
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
