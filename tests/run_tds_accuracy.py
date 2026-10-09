"""python3 run_tds_accuracy.py - stage 5 (tax-accuracy), TDS: the payment types added (194-IB, 194-IA, 194M, 194R, 194-O,
194N, 194T, 195) with their Income-tax Act 2025 references, the higher rate with no PAN or an inoperative PAN, lower
deduction certificates per deductee with their amount, and the 26Q / 27Q / 27EQ text files (remarks A and C, 195 kept
out of 26Q, TCS read from the books). Offline, a made-up client; no client data needed.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tds_accuracy.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8173), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8173/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    cid = pg.evaluate("""() => { const c = newCompany({name: "Testing TDS", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; S.coId = c.id; return c.id; }""")
    party = """(a) => { const [cid, id, x] = a; S.data[cid].parties[id] = Object.assign({id, name: id, pan: "", gstin: "", ledgerName: id, natureDefault: "", expenseLedger: "", ldcRate: "", ldcValidTo: "", ytd: {}}, x); return id; }"""
    bill = """(a) => { const [cid, name, pan, nat, amt, date, extra] = a; const e = newEntry("t.pdf");
      Object.assign(e.x, {vendorName: name, vendorPan: pan, vendorGstin: "", invoiceNo: "T/" + Math.random().toString(36).slice(2, 7), invoiceDate: date || "2026-08-10", taxable: amt, cgst: 0, sgst: 0, igst: 0, total: amt});
      e.natureId = nat; e.partyLedger = name; e.expenseLedger = "Expenses"; Object.assign(e, extra || {}); S.data[cid].entries[e.id] = e; return e.id; }"""
    C = lambda id_, k: pg.evaluate("(a) => compute(S.data[a[0]].entries[a[1]], a[0])[a[2]]", [cid, id_, k])
    F = lambda id_: pg.evaluate("(a) => compute(S.data[a[0]].entries[a[1]], a[0]).flags.map(f => f.t).join(' | ')", [cid, id_])

    # the new payment types, with the Act 2025 references
    R = pg.evaluate("() => Object.fromEntries(rules().map(r => [r.id, {ref: r.ref, old: r.old, rate: r.rateOth, basis: r.basis, limit: r.limit, single: r.single, form: r.form || ''}]))")
    want = {"rent_individual": ("393(1) Sl. 2(i)", "194-IB", 2), "property": ("393(1) Sl. 3(i)", "194-IA", 1), "contract_individual": ("393(1) Sl. 6(ii)", "194M", 2),
            "perquisite": ("393(1) Sl. 8(iv)", "194R", 10), "ecommerce": ("393(1) Sl. 8(v)", "194-O", 0.1), "cash_withdrawal": ("393(3)", "194N", 2),
            "partner": ("393(3)", "194T", 10), "nonresident": ("393(2)", "195", 20.8)}
    for k, (ref, old, rate) in want.items():
        ok(k in R and R[k]["ref"] == ref and R[k]["old"] == old and R[k]["rate"] == rate, "rule %s: %s (old %s) at %s%%" % (k, ref, old, rate))
    ok(R["property"]["form"] == "26QB" and R["rent_individual"]["form"] == "26QC" and R["contract_individual"]["form"] == "26QD" and R["nonresident"]["form"] == "27Q", "each says which form it is reported in")

    PAN_C, PAN_P = "AABCT1234K", "ABCPT1234K"
    pg.evaluate(party, [cid, "Partner A", {"pan": PAN_P}])
    e = pg.evaluate(bill, [cid, "Partner A", PAN_P, "partner", 15000])
    ok(C(e, "tds") == 0, "194T: ₹15,000 to a partner, within ₹20,000: no TDS")
    e = pg.evaluate(bill, [cid, "Partner A", PAN_P, "partner", 25000])
    ok(C(e, "tds") == 2500 and "partnership firm or LLP" in F(e), "194T: ₹25,000: 10% = ₹2,500, and it says it applies to a firm or LLP")
    e = pg.evaluate(bill, [cid, "Seller", "", "property", 6000000])
    ok(C(e, "rate") == 20 and C(e, "tds") == 1200000 and "26QB" in F(e), "194-IA: ₹60 lakh, no PAN: 20% (higher rate), reported in 26QB")
    e = pg.evaluate(bill, [cid, "Seller", PAN_P, "property", 4900000])
    ok(C(e, "tds") == 0, "194-IA: below ₹50 lakh: no TDS")
    e = pg.evaluate(bill, [cid, "Seller", PAN_P, "property", 5000000])
    ok(C(e, "tds") == 50000, "194-IA: ₹50 lakh exactly: 1% = ₹50,000")
    e = pg.evaluate(bill, [cid, "Landlord", PAN_P, "rent_individual", 60000])
    ok(C(e, "tds") == 1200, "194-IB: rent ₹60,000 a month: 2% = ₹1,200")
    e = pg.evaluate(bill, [cid, "Dealer", PAN_C, "perquisite", 30000])
    ok(C(e, "tds") == 3000, "194R: ₹30,000 benefit: 10%")
    e = pg.evaluate(bill, [cid, "Marketplace seller", "", "ecommerce", 800000])
    ok(C(e, "rate") == 5, "194-O, no PAN: 5% (not 20%)")
    e = pg.evaluate(bill, [cid, "Goods seller", "", "goods", 100])
    ok(C(e, "rate") == 5, "194Q, no PAN: 5%")
    # non-resident: 20.8%, a treaty rate with a tax residency certificate
    pg.evaluate(party, [cid, "Foreign Co", {"pan": PAN_C, "trc": True, "dtaaRate": 10}])
    e = pg.evaluate(bill, [cid, "Foreign Co", PAN_C, "nonresident", 100000])
    ok(C(e, "rate") == 10 and C(e, "tds") == 10000 and "27Q" in F(e), "195: treaty rate 10% with a tax residency certificate, reported in 27Q")
    pg.evaluate(party, [cid, "Other Foreign Co", {"pan": "AABCZ9999K"}])
    e = pg.evaluate(bill, [cid, "Other Foreign Co", "AABCZ9999K", "nonresident", 100000])
    ok(C(e, "rate") == 20.8, "195 without a certificate: 20% + 4% cess = 20.8%")
    # inoperative PAN: the higher rate
    pg.evaluate(party, [cid, "Inop Contractor", {"pan": "AABCI7777K", "panInoperative": True}])
    e = pg.evaluate(bill, [cid, "Inop Contractor", "AABCI7777K", "contractor", 50000])
    ok(C(e, "rate") == 20 and "inoperative" in F(e), "PAN inoperative: 194C at 20%, and the bill says why")
    # lower deduction certificate per deductee: its section, dates and amount
    pg.evaluate(party, [cid, "Cert Prof", {"pan": "ABCPC5555K", "ldc": [{"no": "LDC1234567", "rule": "professional", "rate": 2, "from": "2026-04-01", "to": "2027-03-31", "limit": 100000}]}])
    e1 = pg.evaluate(bill, [cid, "Cert Prof", "ABCPC5555K", "professional", 80000])
    ok(C(e1, "tds") == 1600 and C(e1, "rate") == 2, "certificate: ₹80,000 professional fees at 2% = ₹1,600")
    e2 = pg.evaluate(bill, [cid, "Cert Prof", "ABCPC5555K", "technical", 80000])
    ok(C(e2, "rate") == 2 or C(e2, "rate") == 2.0, "the technical-services bill: the certificate is for professional fees only, so the normal 2%")
    # the first bill approved: 80,000 of the 1,00,000 used; the next 50,000: 20,000 at 2% and 30,000 at 10%
    pg.evaluate("(a) => { const e = S.data[a[0]].entries[a[1]], c = compute(e, a[0]); e.status = 'approved'; e.applied = {partyId: 'Cert Prof'}; e.snapshot = {cert: c.cert.no, certBase: c.certBase, base: c.base, tdsBase: c.tdsBase}; \
      const p = S.data[a[0]].parties['Cert Prof']; p.ytd = {'2026-27': {professional: {credited: c.base, tdsBase: c.tdsBase}}}; }", [cid, e1])
    e3 = pg.evaluate(bill, [cid, "Cert Prof", "ABCPC5555K", "professional", 50000])
    ok(C(e3, "tds") == 3400 and "covers" in F(e3), "the certificate's amount: ₹20,000 left at 2% + ₹30,000 at 10% = ₹3,400, flagged")
    e4 = pg.evaluate(bill, [cid, "Cert Prof", "ABCPC5555K", "professional", 50000, "2027-04-05"])
    ok(C(e4, "rate") == 10, "after the certificate's end date: the normal 10%")
    ok(pg.evaluate("(a) => ldcUsed(S.data[a[0]].parties['Cert Prof'], S.data[a[0]].parties['Cert Prof'].ldc[0], a[0])", [cid]) == 80000, "used on the certificate: ₹80,000")

    # the books side: usual rates, 195 out of 26Q, TCS read from the books, remarks in the files
    ok(pg.evaluate("() => JSON.stringify([TDS.STD['194H'], TDS.STD['194IB'], TDS.STD['194D'], TDS.STD['194T']])") == "[[2],[2],[2,10],[10]]", "usual rates: 194H 2%, 194-IB 2%, 194D 2/10%, 194T 10%")
    pg.evaluate("""() => {
      const led = {"TDS 194C": {kind: "tds_payable", section: "194C"}, "TDS 194J": {kind: "tds_payable", section: "194J"}, "TDS 195": {kind: "tds_payable", section: "195"},
        "TCS on Scrap": {kind: "tcs_payable", section: "206C"}, "HDFC Bank": {kind: "bank"}};
      Books.ledgerOf = (l) => led[l] || {};
      const v = (id, date, party, ent) => ({id, date, party, no: id, type: "Journal", ent});
      S.books = {vouchers: [
        v("v1", "20260705", "Ok Contractor", [{l: "Contract", a: -100000}, {l: "TDS 194C", a: 2000}, {l: "Ok Contractor", a: 98000}]),
        v("v2", "20260706", "No Pan Prof", [{l: "Fees", a: -50000}, {l: "TDS 194J", a: 10000}, {l: "No Pan Prof", a: 40000}]),
        v("v3", "20260707", "Cert Contractor", [{l: "Contract", a: -100000}, {l: "TDS 194C", a: 500}, {l: "Cert Contractor", a: 99500}]),
        v("v4", "20260708", "Foreign Co", [{l: "Foreign Services", a: -100000}, {l: "TDS 195", a: 10400}, {l: "Foreign Co", a: 89600}]),
        v("v5", "20260709", "Scrap Buyer", [{l: "Scrap Buyer", a: -101000}, {l: "Scrap Sales", a: 100000}, {l: "TCS on Scrap", a: 1000}])],
        pans: {"Ok Contractor": "AABCO1234K", "Cert Contractor": "AABCC1234K", "Foreign Co": "AABCF1234K", "Scrap Buyer": "AABCS1234K"},
        certs: [{party: "Cert Contractor", pan: "AABCC1234K", section: "194C", certNo: "CERT000001", rate: 0.5, from: "20260401", to: "20270331"}],
        challans: [{id: "c1", date: "20260707", bsr: "0240020", serial: "11111", tax: 12500, section: ""}, {id: "c2", date: "20260707", bsr: "0240020", serial: "22222", tax: 10400, section: "195"},
          {id: "c3", date: "20260710", bsr: "0240020", serial: "33333", tax: 1000, section: "206C"}], alloc: {}};
      TDS.autoAllocate();
    }""")
    rows26 = pg.evaluate("() => TDS.rows().map(r => r.party).join(',')")
    ok("Foreign Co" not in rows26 and "Ok Contractor" in rows26, "26Q leaves out the 195 deduction (%s)" % rows26)
    ok(pg.evaluate("() => TDS.nrRows().map(r => r.party).join(',')") == "Foreign Co", "27Q takes it")
    t = pg.evaluate("() => TDS.tcsRows()[0]")
    ok(t and t["party"] == "Scrap Buyer" and t["tds"] == 1000 and t["paid"] == 100000 and t["code"] == "6CF" and t["rate"] == 1, "27EQ: TCS of ₹1,000 on scrap of ₹1,00,000, code 6CF, from the books")
    ok(pg.evaluate("() => Certs.expected(TDS.rows().find(r => r.party === 'No Pan Prof')).rate") == 20, "no PAN on a 194J deduction: 20% expected")
    pg.evaluate("() => { S.books.nrInfo = {'Foreign Co': {country: 'US', nature: '49', email: 'a@b.com', address: '1 Main St', tin: 'TIN1', dtaa: false}}; }")
    # from 1 April 2026: Forms 140 / 144 / 143, with payment codes, a draft until matched to Protean's format
    n = pg.evaluate("() => { const f = (k) => { const r = TDS26Q.build('2026-27', 'Q2', {tan: 'DELT12345A', name: 'T'}, k); return [r.name, r.formNo, r.draft, r.missingCodes.join(','), r.text.split('\\r\\n')[1].split('^')[4]]; }; return [f('26Q'), f('27Q'), f('27EQ')]; }")
    ok(n[0][0] == "DELT12345A_Form140_Q2_202627_DRAFT.txt" and n[0][1] == "140" and n[0][2] and n[0][4] == "140", "2026-27 Q2 other than salary: Form 140 (was 26Q), file named DRAFT, batch header says 140")
    ok(n[1][1] == "144" and n[1][4] == "144" and n[2][1] == "143" and n[2][4] == "143", "non-residents: Form 144 (was 27Q); TCS: Form 143 (was 27EQ)")
    ok(n[0][3] == "194C,194J" and n[2][3] == "6CF", "the payment codes not yet filled in are named (%s; %s)" % (n[0][3], n[2][3]))
    # up to 2025-26: 26Q / 27Q / 27EQ as before (late returns and corrections)
    pg.evaluate("""() => { S.books.vouchers.forEach(v => { v.date = String(Number(v.date.slice(0, 4)) - 1) + v.date.slice(4); });
      S.books.challans.forEach(c => { c.date = String(Number(c.date.slice(0, 4)) - 1) + c.date.slice(4); }); S.books.certs[0].from = '20250401'; S.books.certs[0].to = '20260331'; }""")
    f26 = pg.evaluate("() => TDS26Q.build('2025-26', 'Q2', {tan: 'DELT12345A', pan: 'AANFG3202D', name: 'Testing TDS'}, '26Q')")
    dd = [l.split("^") for l in f26["text"].strip().split("\r\n") if l.split("^")[1] == "DD"]
    by = {d[8]: d for d in dd}
    ok(f26["name"].endswith("_26Q_Q2_202526.txt") and not f26["draft"] and len(dd) == 3, "2025-26: 26Q file, not a draft, three deductions (%d)" % len(dd))
    ok(by["Cert Contractor"][21] == "A" and by["Cert Contractor"][22] == "CERT000001", "26Q: the certificate deduction carries remark A and the certificate number")
    ok(by["No Pan Prof"][21] == "C" and by["No Pan Prof"][7] == "PANNOTAVBL", "26Q: the deduction without PAN carries remark C and PANNOTAVBL")
    ok(by["Ok Contractor"][21] == "" and by["Ok Contractor"][20] == "94C", "26Q: a plain deduction has no remark; section code 94C")
    f27 = pg.evaluate("() => TDS26Q.build('2025-26', 'Q2', {tan: 'DELT12345A', name: 'Testing TDS'}, '27Q')")
    d27 = [l.split("^") for l in f27["text"].strip().split("\r\n") if l.split("^")[1] == "DD"]
    bh27 = [l.split("^") for l in f27["text"].strip().split("\r\n") if l.split("^")[1] == "BH"][0]
    ok(bh27[4] == "27Q" and len(d27) == 1 and d27[0][20] == "195" and d27[0][30:34] == ["A", "49", "", "US"], "27Q file: form 27Q in the batch header, section 195, Act rate (A), nature 49, country US")
    fq = pg.evaluate("() => TDS26Q.build('2025-26', 'Q2', {tan: 'DELT12345A', name: 'Testing TDS'}, '27EQ')")
    dq = [l.split("^") for l in fq["text"].strip().split("\r\n") if l.split("^")[1] == "DD"]
    ok(fq["name"].endswith("_27EQ_Q2_202526.txt") and len(dq) == 1 and dq[0][20] == "6CF" and dq[0][10] == "100000.00", "27EQ file: the scrap collection, code 6CF, received ₹1,00,000")
    # TCS rates by date: scrap 1% before April 2026, 2% from then; overseas tours 2% flat from then
    ok(pg.evaluate("() => [TDS.tcsRate('6CF', '20251001'), TDS.tcsRate('6CF', '20260401'), TDS.tcsRate('6CJ', '20260501'), TDS.tcsRate('6CO', '20260401'), TDS.tcsRate('6CO', '20250401')].join()") == "1,2,2,2,5",
       "TCS by date: scrap 1% then 2%, minerals 2%, overseas tour 2% from April 2026 (5% before)")
    ok(pg.evaluate("() => TCS27EQ.checks('2025-26', 'Q2').length") == 0, "2025-26: scrap at 1% is right")
    pg.evaluate("() => { S.books.vouchers.forEach(v => { v.date = String(Number(v.date.slice(0, 4)) + 1) + v.date.slice(4); }); S.books.challans.forEach(c => { c.date = String(Number(c.date.slice(0, 4)) + 1) + c.date.slice(4); }); S.books.certs[0].from = '20260401'; S.books.certs[0].to = '20270331'; }")
    ok(any("2% applies to 6CF" in x["why"] for x in pg.evaluate("() => TCS27EQ.checks('2026-27', 'Q2')")), "2026-27: scrap collected at 1% is flagged: 2% applies")
    ok(pg.evaluate("() => TDS26Q.nrChecks('2026-27', 'Q2').length") == 0, "27Q: nothing missing once the deductee's details are in")

    # the TDS screens: the year shows 27Q and 27EQ beside 26Q and 24Q; each opens with its own checks
    pg.evaluate("(cid) => { S.view = 'company'; S.coId = cid; S.tab = 'books'; S.booksTab = 'tds'; S.loadingCo = false; S.books.loading = false; S.books.cid = cid; S.tdsView = 'year'; S.tdsFy = '2026-27'; window.__bk = S.books; render(); }", cid)
    pg.wait_for_timeout(800); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
    txt = pg.inner_text("#app")
    # 09-Oct-2026 (app-tdsgst): the year is a grid of forms × quarters, each form named as the Income Tax Department's PDFs
    # do ("Form No. 140 (Earlier Form No. 26Q)"); a return's downloads and the draft warning are on its File tab, the
    # details to fill on Errors to fix, the totals on the Summary
    tl = txt.lower()
    ok("form 144 (earlier 27q)" in tl and "non-residents" in tl and "form 143 (earlier 27eq)" in tl and "tcs" in tl and "form 140 (earlier 26q)" in tl and "form 138 (earlier 24q)" in tl, "2026-27: the year's grid shows Forms 140, 138, 144 and 143 with the old names beside")
    pg.evaluate("() => { tdsGo('2026-27', 'Q2', '27Q'); S.tdsTab = 'checks'; render(); }"); pg.wait_for_timeout(400)
    txt = pg.inner_text("#app")
    nr = "Non-resident deductees" in txt and pg.locator('[data-nr="Foreign Co"]').count() == 1 and "not yet validated" in txt
    pg.evaluate("() => { S.tdsTab = 'file'; render(); }"); pg.wait_for_timeout(300)
    txt = pg.inner_text("#app")
    ok(nr and "Download the Form 144 text file (draft)" in txt and "draft – not yet validated" in txt, "2026-27 non-residents open as Form 144, marked draft – not yet validated, with the non-resident's details to fill")
    pg.evaluate("() => { tdsGo('2026-27', 'Q2', '27EQ'); S.tdsTab = 'checks'; render(); }"); pg.wait_for_timeout(400)
    codes = "Collection codes" in pg.inner_text("#app")
    pg.evaluate("() => { S.tdsTab = 'summary'; render(); }"); pg.wait_for_timeout(300)
    tcs = "TCS collected" in pg.inner_text("#app")
    pg.evaluate("() => { S.tdsTab = 'file'; render(); }"); pg.wait_for_timeout(300)
    ok(codes and tcs and "Download the Form 143 text file (draft)" in pg.inner_text("#app"), "2026-27 TCS opens as Form 143: TCS collected, and the collection code of each TCS ledger")
    # screens: Parties shows the certificates and the inoperative mark; the year shows 27Q and 27EQ
    pg.evaluate("(cid) => { S.view = 'company'; S.coId = cid; S.step = null; S.tab = 'deductees'; S.partySel = 'Cert Prof'; render(); }", cid)
    pg.wait_for_timeout(500)
    txt = pg.inner_text("#app")
    ok("Lower deduction certificates" in txt and "PAN inoperative" in txt, "Deductees: certificates and the PAN inoperative mark are shown")
print("\nerrors: %s" % errors[:3] if errors else "")
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails))
raise SystemExit(1 if fails else 0)
