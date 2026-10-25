"""python3 run_tds_challans.py - smart TDS challan tagging (the owner's choice of 10-Oct-2026, all four together; since
next-challan-match, 17-Oct-2026, the suggestions are the one matcher's, TDSMatch, src/js/86, shown on the Challans tab,
confirmed by a person, never applied by themselves; a new challan is no longer placed by itself):
  1. auto-match by section + month: a month's deductions of one section against a challan of that section (minor head
     200 only; a 400 challan is never matched) whose tax + surcharge + cess equals them; exact: one click "Confirm N
     deductions to challan BSR/date/serial"; a difference: the gap in rupees and a review. Nothing is tagged until a person
     confirms;
  2. Tally bill-wise: a TDS payment voucher whose TDS-ledger line pays the deductions' bills (Agst Ref) proposes exactly
     those deductions ("From Tally bill-wise"), ahead of the auto-match;
  3. manual multi-select on Entries: tick many (select all shown, after the section/month filter), running total against
     the challan, Tag to challan / Untag; a challan is never over-allocated (refused, here and in the single picker);
  4. Upload challans: the e-filing portal's Payment History CSV and a challan receipt PDF, many at once; CIN read (BSR,
     date, serial), section, minor head, tax/surcharge/cess/interest; a Tally TDS payment voucher of the same date and
     amount is linked to the uploaded challan.
  And the FVU file's challan (CD) records use the confirmed tagging only.
Fixtures: made-up books built here (42 deductions under 194C, 194J and 192 in Q1 of tax year 2026-27, three Tally TDS
payment vouchers, one paying 194J bills Agst Ref), tests/fixtures/tds-challans/payment-history.csv and a receipt PDF made
with reportlab. Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
TDS_CHALLAN_SHOTS=dir: also the screenshots, desktop and phone, light and dark."""
import os, sys, json, threading, functools, http.server, tempfile
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("TDS_CHALLANS_PORT") or 8271)
CSV = os.path.join(HERE, "fixtures", "tds-challans", "payment-history.csv")
SHOTS = os.environ.get("TDS_CHALLAN_SHOTS", "")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the challan receipt PDF, as the e-filing portal's e-Pay Tax gives it (the rupee sign written Rs. in the base font)
def receipt_pdf(path):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    c = canvas.Canvas(path, pagesize=A4); y = 800
    for t in ["Challan Receipt", "ITNS No. : 281", "TAN : DELZ12345A", "Name : ZZ CHALLAN CO", "Assessment Year : 2027-28", "Financial Year : 2026-27",
              "Major Head : Corporation Tax (0020)", "Minor Head : TDS/TCS Payable by Taxpayer (200)", "Nature of Payment : 194J",
              "Amount (in Rs.) : Rs. 12,465.00", "Amount (in words) : Rupees Twelve Thousand Four Hundred Sixty Five Only",
              "CIN : 05103080705202600456", "Mode of Payment : Net Banking", "Bank Name : HDFC Bank", "Bank Reference Number : HD1234567",
              "Date of Deposit : 07-May-2026", "BSR code : 0510308", "Challan No : 00456", "Tender Date : 07/05/2026",
              "Tax Breakup Details (Amount in Rs.)", "A  Tax  Rs. 12,000.00", "B  Surcharge  Rs. 0.00", "C  Cess  Rs. 345.00",
              "D  Interest  Rs. 120.00", "E  Penalty  Rs. 0.00", "F  Fee under section 234E  Rs. 0.00", "Total (A+B+C+D+E+F)  Rs. 12,465.00"]:
        c.drawString(60, y, t); y -= 22
    c.save()

# the books: Q1 of tax year 2026-27. Deductions credit the TDS ledger (Tally's sign: credit positive)
BOOKS_JS = r"""() => {
  const V = [], tds = {"194C": "TDS 194C Payable", "194J": "TDS 194J Payable", "192": "TDS 192 Payable"};
  const exp = {"194C": "Contract Charges", "194J": "Professional Fees", "192": "Salary"}, rate = {"194C": 2, "194J": 10, "192": 10};
  let n = 0;
  const ded = (sec, date, amt, bill) => {
    n++; const base = Math.round(amt * 100 / rate[sec] * 100) / 100, party = (sec === "192" ? "ZZ Employee " : sec === "194C" ? "ZZ Contractor " : "ZZ Consultant ") + n;
    const t = {l: tds[sec], a: amt}; if (bill) t.b = [[bill, "New Ref", amt]];
    V.push({id: "v" + n, date, type: "Journal", no: "J-" + n, party, ent: [{l: exp[sec], a: -base}, {l: party, a: Math.round((base - amt) * 100) / 100}, t]});
  };
  [1000, 1200, 800, 1500, 900, 1100, 640, 1500].forEach((a, i) => ded("194C", "202604" + String(10 + i), a));     // 8,640.00: the CSV's 94C challan
  [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000].forEach((a, i) => ded("194C", "202605" + String(10 + i), a));  // 8,000.00: the short challan (7,500)
  [2000, 1500, 1000, 2500, 1000, 1500, 1345, 1500].forEach((a, i) => ded("194J", "202604" + String(10 + i), a));  // 12,345.00: the receipt PDF
  [3000, 2000, 1000, 4000].forEach((a, i) => ded("194J", "202605" + String(20 + i), a, "TDSJ-M" + (i + 1)));        // paid bill-wise in Tally
  [500, 700].forEach((a, i) => ded("194J", "202605" + String(25 + i), a));                                         // 1,200.00: the 1,500 challan
  [5000, 5000, 5500, 5500, 5520].forEach((a, i) => ded("192", "202604" + String(20 + i), a));                       // 26,520.00: the CSV's 92B challan
  [5000, 5000, 5000, 5000, 5000].forEach((a, i) => ded("192", "202605" + String(10 + i), a));                       // no challan
  [700, 300].forEach((a, i) => ded("194C", "202606" + String(10 + i), a));                                          // no challan
  // the TDS payment vouchers: bank credited, TDS ledger debited
  V.push({id: "pay194cApr", date: "20260505", type: "Payment", no: "P-1", party: "TDS 194C Payable", ent: [{l: "TDS 194C Payable", a: -8640}, {l: "HDFC Bank", a: 8640}]});
  V.push({id: "pay194jMay", date: "20260606", type: "Payment", no: "P-2", party: "TDS 194J Payable",
    ent: [{l: "TDS 194J Payable", a: -10000, b: [["TDSJ-M1", "Agst Ref", -3000], ["TDSJ-M2", "Agst Ref", -2000], ["TDSJ-M3", "Agst Ref", -1000], ["TDSJ-M4", "Agst Ref", -4000]]}, {l: "HDFC Bank", a: 10000}]});
  const c = newCompany({name: "ZZ CHALLAN CO", gstin: "07AAGCZ1234M1Z5"}); c.tan = "DELZ12345A"; c.pan = "AAGCZ1234M";
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  S.books = {cid: c.id, loading: false, vouchers: V, challans: [], alloc: {}, meta: {from: "20260401", to: "20260630"}};
  S.books.map = Books.mapLedgers(V, {}); try { LedMaster.refresh(S.books); } catch (e) {}
  window.__bk = S.books; S.booksTab = "tds"; S.tdsView = "return"; S.tdsFy = "2026-27"; S.tdsQ = "Q1"; S.tdsForm = "26Q"; S.tdsTab = "challans"; render();
  return V.length;
}"""
GO = "() => { S.books = window.__bk; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2026-27'; S.tdsQ = 'Q1'; S.tdsForm = '26Q'; render(); }"
ids = lambda sec, ym: "TDS.allRows().filter(r => TDS.sec(r.section) === '%s' && TDS.ymd(r.date).slice(0, 6) === '%s').map(r => r.id)" % (sec, ym)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
tmp = tempfile.mkdtemp(prefix="tdsch-"); PDF = os.path.join(tmp, "challan-receipt-00456.pdf"); receipt_pdf(PDF)

def tab(pg, name):
    pg.click('#app nav[aria-label="Return"] button:has-text("%s")' % name); pg.wait_for_timeout(400)

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate("() => { S.tdsDedView = 'table'; S.tdsChView = 'match'; }")   # the Deductions checks here are of the table (All rows), the Challans ones of the two-panel matcher; round 88's grid below
        nv = pg.evaluate(BOOKS_JS); pg.wait_for_timeout(1000); pg.evaluate(GO); pg.wait_for_timeout(600)
        nd = pg.evaluate("TDS.allRows().filter(r => r.fy === '2026-27' && r.q === 'Q1').length")
        ok(nd == 42, "the fixture books: 42 deductions under 194C, 194J and 192 (%d)" % nd)
        ok(pg.evaluate("typeof TDSCH === 'object'"), "the challan tagging logic is there (TDSCH)")
        if pg.evaluate("typeof TDSCH !== 'object'"): raise SystemExit("no TDSCH: nothing more to check")
        ok("error" in pg.evaluate("TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q')"), "before any challan is tagged, the FVU file has no challan record (refused)")

        # ---- 4. upload: the portal's CSV and a receipt PDF, at once (tds-layout, 14-Oct-2026: in the challan register)
        pg.evaluate("() => { S.tdsView = 'register'; render(); }"); pg.wait_for_timeout(400)
        ok(pg.locator('#app input[type="file"][data-challan-upload]').count() == 1 and pg.locator('#app button:has-text("Upload challans")').count() == 1, "the challan register: an “Upload challans” button")
        pg.set_input_files('#app input[type="file"][data-challan-upload]', [CSV, PDF]); pg.wait_for_timeout(2500)
        ch = pg.evaluate("S.books.challans.map(c => ({bsr: c.bsr, serial: c.serial, date: c.date, tax: c.tax, interest: c.interest || 0, section: c.section || '', minor: c.minorHead || '', cin: c.cin || '', from: c.fromVoucher || ''}))")
        by = {c["serial"]: c for c in ch}
        ok(len(ch) == 4, "four challans read: three rows of the CSV and one receipt PDF (%d)" % len(ch))
        a = by.get("00123", {})
        ok(a.get("bsr") == "0510308" and a.get("date") == "20260505" and a.get("tax") == 8640 and a.get("section") == "194C" and a.get("minor") == "200" and a.get("cin") == "05103080505202600123",
           "CSV: CIN, BSR 0510308, 05-May-2026, serial 00123, 94C read as 194C, minor head 200, tax 8,640.00 (%s)" % a)
        ok(a.get("from") == "pay194cApr", "CSV: the Tally TDS payment of the same date and amount is linked to it (%s)" % a.get("from"))
        s = by.get("00124", {})
        ok(s.get("tax") == 26520 and s.get("section") == "192", "CSV: 92B is section 192; tax + cess = 26,520.00 (%s)" % s)
        ok(by.get("00125", {}).get("minor") == "400", "CSV: the minor head 400 challan is kept as 400")
        r = by.get("00456", {})
        ok(r.get("bsr") == "0510308" and r.get("date") == "20260507" and r.get("tax") == 12345 and r.get("interest") == 120 and r.get("section") == "194J" and r.get("minor") == "200",
           "receipt PDF: BSR, 07-May-2026, serial 00456, 194J, tax + cess 12,345.00 and interest 120.00 apart (%s)" % r)
        pg.set_input_files('#app input[type="file"][data-challan-upload]', [CSV]); pg.wait_for_timeout(1500)
        ok(pg.evaluate("S.books.challans.length") == 4, "the same CSV again adds nothing (one challan per BSR, date and serial)")
        # a short challan and a part-used one, typed (with their section), and the bill-wise payment made a challan with its CIN
        pg.evaluate("""() => { S.books.challans.push({id: "chShort", bsr: "0510308", serial: "00301", date: "20260606", tax: 7500, interest: 0, section: "194C", minorHead: "200"},
                                                   {id: "chPart", bsr: "0510308", serial: "00302", date: "20260607", tax: 1500, interest: 0, section: "194J", minorHead: "200"}); render(); }""")
        pg.wait_for_timeout(300)
        # next-challan-match (the owner, 17-Oct-2026: shown first, confirmed with one click, never applied by itself): a new
        # challan is not placed by itself any more; what it pays is suggested
        ok(pg.evaluate("Object.keys(S.books.alloc).length") == 0, "the new challans did not tag anything by themselves")
        ok(pg.evaluate("TDSMatch.suggestNow('26Q', '2026-27', 'Q1').length") > 0 and pg.evaluate("TDSMatch.suggestNow('24Q', '2026-27', 'Q1').length") > 0, "what they pay is suggested on 26Q's and 24Q's Challans tabs")
        ok(pg.evaluate("(S.books.challans.find(c => c.serial === '00125') || {}).autoPlace") == "unknown", "the minor head 400 challan: no return of its own, asked in To fix")
        pg.evaluate("() => { S.tdsView = 'return'; S.tdsTab = 'challans'; render(); }"); pg.wait_for_timeout(400)
        # next-tds-clear: Tally's TDS payments are under Add challan ▾ › From a Tally TDS payment
        pg.click('#app [data-ret-add-challan] > summary'); pg.wait_for_timeout(200); pg.click('#app [data-cm-add="tally"]'); pg.wait_for_timeout(400)
        row = pg.locator('#app tr', has_text="P-2")
        ok(row.count() == 1 and "bill-wise" in row.inner_text().lower(), "the Tally payment P-2 is offered as a challan, with its bill-wise deductions said (%s)" % (row.inner_text()[:120] if row.count() else ""))
        row.locator('input[aria-label="BSR code or CIN"]').fill("05103080606202600222"); row.locator('button:has-text("Make it a challan")').click(); pg.wait_for_timeout(600)
        c4 = pg.evaluate("(S.books.challans.find(c => c.fromVoucher === 'pay194jMay') || {})")
        ok(c4.get("bsr") == "0510308" and c4.get("serial") == "00222" and c4.get("date") == "20260606" and c4.get("tax") == 10000 and c4.get("section") == "194J",
           "the payment made a challan from its CIN: BSR, serial, the voucher's date and amount, section 194J (%s)" % c4)
        ok(pg.evaluate("Object.keys(S.books.alloc).length") == 0, "the payment's challan tagged nothing by itself either")
        pg.evaluate("() => { S.books.alloc = {}; S.books.allocFrom = {}; S.books.challans.forEach(c => { c.autoPlace = 'suggested'; }); render(); }"); pg.wait_for_timeout(300)

        # ---- 1 and 2: the suggestions of the one matcher
        SG = """(form) => TDSMatch.suggestNow(form, '2026-27', 'Q1').map(s => ({key: s.key, rule: s.rule, words: s.words, serial: S.books.challans.find(c => c.id === s.chId).serial, n: s.ids.length, total: s.total, rows: s.ids}))"""
        P = pg.evaluate(SG, "26Q"); bys = {x["serial"]: x for x in P}
        t = bys.get("00222", {})
        want_bw = pg.evaluate(ids("194J", "202605") + ".slice(0, 4)")
        ok(t.get("rule") == "a" and t.get("words") == "From Tally" and sorted(t.get("rows", [])) == sorted(want_bw), "From Tally: the payment's four Agst Ref deductions suggested for its challan (%s)" % {k: t.get(k) for k in ("rule", "n")})
        for ser, sec, n in [("00123", "194C", 8), ("00456", "194J", 8)]:
            x = bys.get(ser, {})
            ok(x.get("rule") == "b" and x.get("n") == n, "same section, same month, exact: %d deductions of %s in April to challan %s (%s)" % (n, sec, ser, {k: x.get(k) for k in ("rule", "n")}))
        P24 = pg.evaluate(SG, "24Q"); x = {y["serial"]: y for y in P24}.get("00124", {})
        ok(x.get("rule") == "b" and x.get("n") == 5, "Form 138 (24Q): the five 192 deductions of April to the 92B challan 00124, exact (%s)" % x)
        sh = next((x for x in P if x["serial"] == "00301" and x["rule"] == "d"), {})
        ok(sh.get("rule") == "d" and sh.get("n") == 7 and sh.get("total") == 700000, "the short challan (₹7,500): May's 194C filled, oldest first, whole rows: 7 of 8, ₹7,000 (%s)" % {k: sh.get(k) for k in ("rule", "n", "total")})
        # next-tds-early (the owner, 20-Oct-2026): what is left on it (₹500) takes June's ₹300 194C as an advance challan (06-Jun
        # for 11-Jun, the same year: Protean's FVU takes it), by rule f, last
        sf = next((x for x in P if x["serial"] == "00301" and x["rule"] == "f"), {})
        ok(sf.get("n") == 1 and sf.get("total") == 30000, "the short challan's ₹500 left: June's ₹300 194C as an advance challan, by rule f (%s)" % {k: sf.get(k) for k in ("rule", "n", "total")})
        pt = bys.get("00302", {})
        ok(pt.get("n") == 2 and pt.get("total") == 120000, "the ₹1,500 challan: the two May 194J deductions not paid bill-wise, ₹1,200 (%s)" % {k: pt.get(k) for k in ("n", "total")})
        ok("00125" not in bys and "00124" not in bys, "the minor head 400 challan is never suggested; the 92B challan not for 26Q's deductions")
        ok(len(set(r for x in P for r in x["rows"])) == sum(x["n"] for x in P), "no deduction is in two suggestions")

        # ---- the screen: suggestions, one click each, Confirm all
        pg.evaluate(GO); tab(pg, "Challans")
        # next-challan-match (18-Oct-2026, as Winman): a challan chosen from the list shows its own suggestions
        chT = pg.evaluate("S.books.challans.find(c => c.serial === '00222').id"); chA = pg.evaluate("S.books.challans.find(c => c.serial === '00123').id")
        pg.click('#app [data-cm-ch="%s"]' % chA); pg.wait_for_timeout(400)
        ta = pg.locator('#app [data-cm-panel="%s"]' % chA).inner_text()
        pg.click('#app [data-cm-ch="%s"]' % chT); pg.wait_for_timeout(400)
        txt = pg.locator('#app [data-cm-panel="%s"]' % chT).inner_text()
        ok("From Tally" in txt and "Same section, same month, exact amount" in ta, "Challans: the suggestions with their rules, “From Tally” and “Same section, same month, exact amount”")
        pg.click('#app [data-cm-panel="%s"] [data-cm-confirm]' % chT); pg.wait_for_timeout(500)
        ok(sorted(pg.evaluate("Object.keys(S.books.alloc).filter(k => S.books.alloc[k] === S.books.challans.find(c => c.serial === '00222').id)")) == sorted(want_bw), "confirmed: exactly those four tagged to it")
        pg.click("#app [data-cm-confirm-all]"); pg.wait_for_timeout(600)
        tagged = pg.evaluate("(() => { const u = {}; Object.entries(S.books.alloc).forEach(([k, v]) => { const s = S.books.challans.find(c => c.id === v).serial; u[s] = (u[s] || 0) + 1; }); return u; })()")
        ok(tagged == {"00222": 4, "00123": 8, "00456": 8, "00301": 8, "00302": 2}, "Confirm all: every suggestion of Form 140 confirmed, nothing else (%s)" % tagged)
        used = pg.evaluate("TDS.challanUse().chShort || 0")
        ok(used == 7300 and used <= 7500, "the short challan: the 7 of May that fit and June's ₹300 in advance (₹7,300.00 of ₹7,500.00); one left, with its next step (%s)" % used)
        # next-24q-auto: opening Form 138 PLACES its sure-rule matches (no suggestion, no Confirm all); 26Q's stay as confirmed
        a26 = pg.evaluate("Object.assign({}, S.books.alloc)")
        pg.evaluate("() => { S.tdsForm = '24Q'; S.tdsTab = 'challans'; render(); }"); pg.wait_for_timeout(900)
        on124 = pg.evaluate("Object.keys(S.books.alloc).filter(k => S.books.challans.find(c => c.id === S.books.alloc[k]).serial === '00124')")
        rule124 = pg.evaluate("(ks) => ks.filter(k => { const l = (S.books.allocLog || []).slice().reverse().find(x => x.row === k) || {}; return l.act === 'auto' && /^rule: Same section, same month, exact amount/.test(l.note || ''); }).length", on124)
        ok(len(on124) == 5 and rule124 == 5 and pg.locator("#app [data-cm-confirm-all]").count() == 0, "Form 138: the 192 deductions placed on 00124 by rule on opening, tagged Rule, nothing left to confirm (%d, %d)" % (len(on124), rule124))
        ok(all(pg.evaluate("S.books.alloc")[k] == v for k, v in a26.items()), "Form 138's opening moved nothing already placed (26Q's confirmed suggestions kept)")
        pg.evaluate("() => { S.tdsForm = '26Q'; render(); }"); pg.wait_for_timeout(300)
        # ---- round 88 (as Winman's grid): the Challans step is one plain table; a row opens that challan's deductions
        pg.evaluate("() => { S.tdsChView = ''; S.tdsChSel = ''; S.tdsTab = 'challans'; render(); }"); pg.wait_for_timeout(600)
        g = pg.locator("#app [data-chg]")
        heads = pg.evaluate("[...document.querySelectorAll('#app [data-chg] thead th')].map(h => h.innerText.trim())")
        # round 94: "Used in all returns" only where some challan is used by another return too (else it repeats Used here)
        differs = pg.evaluate("() => [...document.querySelectorAll('#app [data-chg] tbody tr[data-chg-row]')].some(t => { const cx = TDSReg.ctx(), c = TDS.challans().find(x => x.id === t.dataset.chgRow); return Math.abs(TDSReg.usedTax(c, cx) - +t.querySelector('[data-chg-here]').dataset.chgHere) > 0.005; })")
        want_h = ["No", "Date", "Section", "Tax", "Interest", "Fee", "Others", "Total", "Serial", "BSR", "Type", "Verified", "Interest allocated", "Fee 234E allocated", "Others allocated", "Used here"] + (["Used in all returns"] if differs else []) + ["Balance"]
        ok(g.count() == 1 and pg.locator("#app [data-cm-panel]").count() == 0 and heads == want_h,
           "Challans: one plain table, No · Date · Section · Tax · Interest · Fee · Others · Total · Serial · BSR · Type · Verified · Interest allocated · Fee 234E allocated (next-tds-interest2) · Others allocated · Used here · [Used in all returns, only where it differs: %s] · Balance (%s)" % (differs, heads))
        rows = pg.evaluate("""[...document.querySelectorAll('#app [data-chg] tbody tr[data-chg-row]')].map(t => ({id: t.dataset.chgRow, cells: [...t.cells].map(c => c.innerText.trim())}))""")
        used26 = pg.evaluate("Array.from(new Set(Object.values(S.books.alloc))).filter(id => TDS.rows().some(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan === id))")
        ok(set(used26) <= set(r["id"] for r in rows) and [r["cells"][0] for r in rows] == [str(i + 1) for i in range(len(rows))], "every challan this return uses is a row, numbered 1 to %d" % len(rows))
        a = next((r for r in rows if r["id"] == chA), None)
        wa = pg.evaluate("(id) => { const cx = TDSReg.ctx(), c = TDS.challans().find(x => x.id === id); return {used: TDSReg.usedTax(c, cx), bal: TDSReg.balance(c, cx).tax}; }", chA)
        ok(a and a["cells"][1] == "05-May-2026" and a["cells"][2] == "194C" and a["cells"][3] == "₹8,640.00" and a["cells"][8] == "00123" and a["cells"][9] == "0510308" and a["cells"][15] == "₹" + format(wa["used"], ",.2f") and (not differs or a["cells"][16] == "₹" + format(wa["used"], ",.2f")) and a["cells"][-1] == "₹" + format(wa["bal"], ",.2f"),
           "challan 00123's row: date, section, tax, serial, BSR, used here (only this return uses it: = used in all returns) and balance (%s)" % (a and a["cells"]))
        ft = pg.locator("#app [data-chg] tfoot").inner_text()
        tax = pg.evaluate("(ids) => ids.reduce((a, id) => a + num(TDS.challans().find(c => c.id === id).tax), 0)", [r["id"] for r in rows])
        ok(ft.startswith("Total") and "Number of challans" not in ft and pg.get_attribute("#app [data-chg] tfoot [data-chg-tax]", "data-chg-tax") and abs(float(pg.get_attribute("#app [data-chg] tfoot [data-chg-tax]", "data-chg-tax")) - tax) < 0.01,
           "the footer: Total and the totals, the count of challans only on its tab (round 94; %d, tax %s)" % (len(rows), tax))
        last = pg.evaluate("() => { const t = [...document.querySelectorAll('#app [data-chg] tbody tr')]; return t[t.length - 1].innerText.trim(); }")
        ok(last.startswith("+ Add challan"), "the last row: + Add challan (%s)" % last)
        pg.click("#app [data-chg-add]"); pg.wait_for_timeout(400)
        ok(pg.locator("#app [data-add-challan=new]").count() == 1, "+ Add challan opens the challan form (%d)" % pg.locator("#app [data-add-challan]").count())
        ok(pg.locator("#app [data-cm-allch]").count() == 0 and pg.locator("#app [data-return-card] [data-ret-allch]").count() == 1, "all challans of the year: under the header's ⋯ only (round 94)")
        pg.click('#app [data-chg] tr[data-chg-row="%s"]' % chA); pg.wait_for_timeout(600)
        on = pg.evaluate("[...document.querySelectorAll('#app [data-wd-table] tbody tr[data-wd-row]')].map(t => t.dataset.wdRow)")
        ok(pg.evaluate("S.tdsTab") == "deductions" and pg.input_value("#app select[data-wd-sel]") == chA and sorted(on) == sorted(pg.evaluate("(c) => TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan === c).map(r => r.id)", chA)) and len(on) == 8,
           "a row clicked: Deductions with 00123 chosen, its 8 deductions (%d)" % len(on))
        pg.evaluate("() => { S.tdsChView = 'match'; S.tdsDedView = 'table'; render(); }")
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)
            for w, h, tag in [(1400, 1000, "desktop"), (390, 900, "phone")]:
                for sch in ["light", "dark"]:
                    q = br.new_page(viewport={"width": w, "height": h}, color_scheme=sch)
                    q.goto("http://localhost:%d/" % PORT); q.wait_for_timeout(2000); q.click('button[data-act="useOffline"]'); q.wait_for_timeout(900)
                    q.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", sch)
                    q.evaluate(BOOKS_JS); q.wait_for_timeout(700); q.evaluate(GO); q.wait_for_timeout(400)
                    q.evaluate("(cs) => { S.books.challans = cs; render(); }", pg.evaluate("S.books.challans")); q.wait_for_timeout(300)
                    q.evaluate("() => { S.tdsTab = 'challans'; render(); document.querySelectorAll('.toast').forEach(t => t.remove()); window.scrollTo(0, 0); }"); q.wait_for_timeout(500)
                    q.screenshot(path=os.path.join(SHOTS, "challans-suggestions-%s-%s.png" % (tag, sch)), full_page=(tag == "desktop"))
                    q.close()

        # ---- 3. manual multi-select on Entries: ticked, then Move to challan… (the one dialog) or Take off challan
        two = pg.evaluate(ids("194J", "202605") + ".slice(4)")
        pg.evaluate("(ids) => TDSCH.untag(ids)", two)
        tab(pg, "Deductions")
        pg.select_option('#app select[aria-label="Section"]', "194J"); pg.select_option('#app select[aria-label="Month"]', "202605"); pg.select_option('#app select[aria-label="Challan"]', "no"); pg.wait_for_timeout(400)
        pg.click('#tdsDnTable thead input[type="checkbox"][aria-label="Select all shown"]'); pg.wait_for_timeout(300)
        bar = pg.locator("#app [data-tag-bar]")
        ok(bar.count() == 1 and "2 ticked" in bar.inner_text() and "₹1,200.00" in bar.inner_text(), "select all shown (194J, May, not against a challan): 2 ticked, ₹1,200.00 (%s)" % (bar.inner_text()[:160] if bar.count() else ""))
        pg.click('#app [data-tag-bar] [data-tag-move]'); pg.wait_for_timeout(400)
        pick = pg.locator('[data-cm-pick="chPart"]')
        ok(pick.count() == 1 and "₹300.00 left after" in pick.inner_text(), "the Move dialog: against challan 00302, ₹300.00 left after (%s)" % (pick.inner_text()[:160] if pick.count() else ""))
        if SHOTS:
            pg.screenshot(path=os.path.join(SHOTS, "entries-move-dialog-desktop-light.png"))
        pg.click('[data-cm-pick-go="chPart"]'); pg.wait_for_timeout(500)
        ok(all(pg.evaluate("(i) => S.books.alloc[i]", i) == "chPart" for i in two), "moved: both to challan 00302")
        # take one off
        pg.select_option('#app select[aria-label="Challan"]', ""); pg.wait_for_timeout(300)
        pg.check('#tdsDnTable tbody tr:has-text("ZZ Consultant %s") input[type="checkbox"]' % two[0][1:].split("|")[0]); pg.wait_for_timeout(200)
        pg.click('#app [data-tag-bar] button:has-text("Take off challan")'); pg.wait_for_timeout(400)
        ok(pg.evaluate("(i) => S.books.alloc[i] || ''", two[0]) == "" and pg.evaluate("(i) => S.books.alloc[i]", two[1]) == "chPart", "Take off challan: the one ticked is off its challan, the other stays")
        # over-allocation refused: in the dialog, by the logic and by the single picker
        pg.evaluate("() => { S.tdsSel = {}; render(); }")
        pg.click('#app button:has-text("Clear filters")'); pg.wait_for_timeout(300)
        pg.select_option('#app select[aria-label="Section"]', "194C"); pg.select_option('#app select[aria-label="Month"]', "202606"); pg.wait_for_timeout(300)
        pg.click('#tdsDnTable thead input[type="checkbox"][aria-label="Select all shown"]'); pg.wait_for_timeout(200)
        pg.click('#app [data-tag-bar] [data-tag-move]'); pg.wait_for_timeout(400)
        ok(pg.locator('[data-cm-pick-go="chPart"]').is_disabled() and "more than it has" in pg.locator('[data-cm-pick="chPart"]').inner_text(), "₹1,000.00 against ₹800.00 left: the challan cannot be chosen, “needs ₹200.00 more than it has”")
        pg.evaluate("() => { S.tdsMove = null; S.tdsSel = {}; render(); }"); pg.wait_for_timeout(200)
        before = pg.evaluate("JSON.stringify(S.books.alloc)")
        res = pg.evaluate("(ids) => TDSCH.tag(ids, 'chPart')", pg.evaluate(ids("194C", "202606")))
        ok(not res.get("ok") and pg.evaluate("JSON.stringify(S.books.alloc)") == before, "TDSCH.tag refuses to over-allocate a challan; nothing changes (%s)" % res.get("why"))
        one = pg.evaluate("(TDS.rows().find(r => r.fy === '2026-27' && !r.challan && TDS.sec(r.section) === '194C' && TDS.ymd(r.date).slice(0, 6) === '202605') || {}).id")
        pg.evaluate("(i) => tdsMoveTo([i], 'chPart')", one)   # 1,000.00 against 800.00 left
        ok(pg.evaluate("(i) => S.books.alloc[i] || ''", one) == "", "a single move refuses it too")
        ok(all(pg.evaluate("TDS.challans().every(c => (TDS.challanUse()[c.id] || 0) <= num(c.tax) + 0.001)") for _ in [0]), "no challan is used beyond its amount, to the paisa")
        # next-tds-validate-short (the owner, 25-Oct-2026: "there should not be any blocker"): the file is made without what is
        # on no challan, and says so (never left out silently); then a challan for the rest
        fr = pg.evaluate("TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q')")
        lo = fr.get("leftOut") or []
        ok(not fr.get("error") and len(lo) == 3 and all(x["k"] == "nochallan" for x in lo) and (fr.get("notes") or [""])[0].startswith("Left out of the file: 3 on no challan"), "the file leaves out the 3 deductions on no challan, and says so (%s)" % ((fr.get("error") or "") + str((fr.get("notes") or [""])[0]))[:120])
        pg.evaluate("""(ids) => { S.books.challans.push({id: "chRest", bsr: "0510308", serial: "00303", date: "20260707", tax: 2000, interest: 0, section: "194C", minorHead: "200"});
          TDSCH.tag(ids.r, 'chRest'); TDSCH.tag(ids.j, 'chPart'); render(); }""", {"r": pg.evaluate("TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && !r.challan && TDS.sec(r.section) === '194C').map(r => r.id)"), "j": [two[0]]})

        # ---- the FVU file: the confirmed tagging only
        f = pg.evaluate("TDS26Q.build('2026-27', 'Q1', TDS26Q.firmDetails(), '26Q')")
        lines = [l.split("^") for l in f.get("text", "").split("\r\n") if l]
        cd = [l for l in lines if len(l) > 1 and l[1] == "CD"]; dd = [l for l in lines if len(l) > 1 and l[1] == "DD"]
        want = pg.evaluate("""(() => { const out = {}; TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1' && r.challan).forEach(r => { const c = S.books.challans.find(x => x.id === r.challan);
          const k = c.serial; out[k] = out[k] || {n: 0, tax: 0, bsr: c.bsr, date: c.date.slice(6, 8) + c.date.slice(4, 6) + c.date.slice(0, 4), extra: Math.round((num(c.interest) + num(c.fee) + num(c.others)) * 100) / 100, ctax: num(c.tax)}; out[k].n++; out[k].tax = Math.round((out[k].tax + r.tds) * 100) / 100; });
          Object.values(out).forEach(v => { v.total = Math.round((v.ctax + v.extra) * 100) / 100; }); return out; })()""")
        # next-tds-forms-2025: Form 140's challan record (Protean's file format 1.1): BSR field 15, serial 17, date 19; the
        # challan as deposited in 8 to 12 (Gazette Note 6), the deductions' tax as tagged in field 21
        got = {l[16]: {"n": int(l[4]), "tax": float(l[20]), "bsr": l[14], "date": l[18], "total": float(l[11])} for l in cd}
        ok(len(cd) == 6 and set(got) == {"00123", "00456", "00222", "00301", "00302", "00303"}, "the file: one CD record per challan with confirmed 26Q deductions, none for 192 or the 400 challan (%s)" % sorted(got))
        ok(got == {k: {"n": v["n"], "tax": v["tax"], "bsr": v["bsr"], "date": v["date"], "total": v["total"]} for k, v in want.items()},
           "each CD: BSR, date, serial, number of deductions, tax as tagged; its total the challan as deposited (%s)" % got.get("00456"))
        ok(len(dd) == sum(v["n"] for v in want.values()) == 4 + 8 + 8 + 8 + 2 + 2, "DD records: the 32 deductions, every one on its challan (%d)" % len(dd))
        ok(all(l[22] == "200" for l in cd), "minor head 200 on every CD record")
        ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
        br.close()
finally:
    srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
