"""python3 run_gst_recon.py - GST against the filed returns (request of 02-Oct-2026, items 2-13), on Testing AAD's FY 2025-26:
input tax on an entry with only a tax line, the tax type against the customer's state, IFF for a quarterly filer's first two
months, the figures read from return PDFs, GSTR-1 + IFF against 3B and reverse charge by quarter, days late / late fee /
interest, the filed GSTR-1 / IFF invoice by invoice (Excel and JSON), credit notes, 2B against the books for the year,
credit in 2B not claimed, "filed returns are final" and the corrections Excel, Optional entries, entries deleted in Tally,
returns marked filed from the portal, and a returns-filed PDF removed softly.
The filed figures and dates are those of the workbook FinCom_GST_vs_Filed_FY2025-26.xlsx (the portal PDFs themselves are
not here), put in as the PDFs' reading would. Uses tests/data/books-cache.json and gst-cache.json (client data, not in git).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_gst_recon.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
import gstfix
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8196), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books, gst = gstfix.load()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the workbook: filing dates (Filing dates sheet) and 3B / GSTR-1 + IFF figures by quarter (Summary sheet)
FILED = [("iff", "202504", "2025-05-13"), ("iff", "202505", "2025-06-13"), ("r1", "202506", "2025-07-12"), ("r3b", "202506", "2025-10-24"),
         ("r1", "202509", "2025-11-04"), ("r3b", "202509", "2026-02-07"), ("r1", "202512", "2026-02-13"), ("r3b", "202512", "2026-02-13"),
         ("iff", "202601", "2026-02-13"), ("iff", "202602", "2026-03-12"), ("r1", "202603", "2026-04-13"), ("r3b", "202603", "2026-04-24")]
Q31A = {"202506": [4050869.93, 286824.59, 221166.00], "202509": [3009711.87, 143048.14, 199350.00], "202512": [2795531.14, 134460.00, 184367.81], "202603": [7507230.50, 387810.00, 481745.74]}
RCM = {"202506": 3645, "202509": 3645, "202512": 4320, "202603": 4860}
ITC = {"202506": [37555.52, 78118.59], "202509": [32508.60, 54551.08], "202512": [786568.91, 40729.89], "202603": [970835.68, 61483.60]}

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8196/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    pg.evaluate(gstfix.SETUP, [books, gst]); pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render()"); pg.wait_for_timeout(600)
    E = lambda js, *a: pg.evaluate(js, *a)

    # 2. input tax on an entry with only an IGST line (bank payments 855 and 859 of 18-Sep-2025)
    pay = E("GSTR.inward('202509', '09').filter(x => x.taxOnly).map(x => [x.voucher, x.igst])")
    ok(["855", 9180] in pay and ["859", 900] in pay, "2. bank payments 855 and 859 with only an IGST line now take input tax (%s)" % pay)
    # 3. the tax type against the customer's state
    tt = E("GSTX.taxType('09', GSTX.fyMonths('2025-26')).map(t => [t.no, t.date.slice(0, 6), t.gstin.slice(0, 2), t.should])")
    ok(sorted(tt) == [["2025-26/GST/561", "202601", "07", "IGST"], ["2025-26/GST/562", "202601", "23", "IGST"]], "3. Jan-2026 invoices 561 (Delhi) and 562 (Madhya Pradesh), booked CGST + SGST, flagged as IGST (%s)" % tt)
    # 4. a quarterly filer's GSTR-1 PDF for Apr or May is an IFF; June stays GSTR-1; a record read before is put right
    ok(E("[GSTV.formFor('r1', '202504', '09'), GSTV.formFor('r1', '202505', '09'), GSTV.formFor('r1', '202506', '09')]") == ["iff", "iff", "r1"], "4. GSTR-1 for Apr-2025 / May-2025 of a quarterly filer is an IFF; Jun-2025 a GSTR-1")
    E("() => { S.books.gstVault = [{id: 'old1', reg: '09', form: 'r1', per: '202505', arnDate: '2025-06-13', name: 'GSTR1_052025.pdf', at: '2025-06-14T00:00:00Z'}]; GSTF.rec('202505', '09').r1 = '2025-06-13'; }")
    rec = E("(() => { const x = GSTV.all()[0]; return [x.form, x.formRead, GSTF.peek('202505', '09').iff || '', GSTF.peek('202505', '09').r1 || '']; })()")
    ok(rec == ["iff", "r1", "2025-06-13", ""], "4. an Apr/May record filed before as GSTR-1 becomes the IFF, with its filing date (%s)" % rec)
    # the figures on the PDFs: the GSTR-1 Total Liability line and 3B tables 3.1(a), 3.1(d), 4A(5)
    f1 = E("GSTV.figures('GSTR-1 ... Total Liability (Outward supplies other than Reverse charge) 112 40,50,869.93 2,86,824.59 2,21,166.00 2,21,166.00 0.00 Total', 'r1')")
    ok(f1 and f1["tl"]["taxable"] == 4050869.93 and f1["tl"]["igst"] == 286824.59 and f1["tl"]["cgst"] == 221166, "4. a GSTR-1 PDF's Total Liability line is read (value and tax)")
    f3 = E("GSTV.figures('3.1 Details ... (a) Outward taxable supplies (other than zero rated, nil rated and exempted) 40,50,869.93 2,86,824.59 2,21,166.00 2,21,166.00 0.00 (b) ... (d) Inward supplies (liable to reverse charge) 40,500.00 0.00 3,645.00 3,645.00 0.00 (e) ... (5) All other ITC 37,555.52 78,118.59 78,118.59 0.00 B. ITC Reversed', 'r3b')")
    ok(f3 and f3["a"]["taxable"] == 4050869.93 and f3["d"]["cgst"] == 3645 and f3["itc"]["cgst"] == 78118.59, "4. a 3B PDF's 3.1(a), 3.1(d) and 4A(5) are read")

    # the returns filed: records as the PDFs would give them (filing dates; figures of 3B and of GSTR-1 + IFF by quarter)
    E("""([filed, q31a, rcm, itc]) => { S.books.gstVault = []; S.books.gstFiled = {};
      filed.forEach(([form, per, date], i) => {
        let fig;
        if (form === 'r3b'){ const a = q31a[per]; fig = {kind: 'r3b', a: {taxable: a[0], igst: a[1], cgst: a[2], sgst: a[2], cess: 0}, d: {taxable: rcm[per] * 100 / 9, igst: 0, cgst: rcm[per], sgst: rcm[per], cess: 0},
          itc: {igst: itc[per][0], cgst: itc[per][1], sgst: itc[per][1], cess: 0}}; }
        if (form === 'r1') fig = {kind: 'r1', tl: {taxable: q31a[per][0], igst: q31a[per][1], cgst: q31a[per][2], sgst: q31a[per][2], cess: 0}};
        GSTV.addRecord({reg: '09', form, per, arn: 'AA09' + per + i, arnDate: date, name: form + per + '.pdf', size: 1000, fig});
      }); render(); }""", [FILED, Q31A, RCM, ITC])
    # the cross-check: GSTR-1 + IFF = 3B 3.1(a) = Rs 1,73,63,343.44 for the year; reverse charge equal each quarter
    c = E("(() => { const c = GSTX.cross('09', '2025-26'); return {r1: c.r1, r3b: c.r3b, diffs: c.rows.map(r => r.diff), rcm: c.rows.map(r => [r.rcm3b.cgst, r.rcmBooks.cgst, r.rcmDiff])}; })()")
    ok(c["r1"] == 17363343.44 and c["r3b"] == 17363343.44 and all(x == 0 for x in c["diffs"]), "test: GSTR-1 + IFF = 3B 3.1(a) = Rs 1,73,63,343.44 for the year, every quarter agreeing (%s)" % c["r1"])
    ok(all(r[0] == r[1] and r[2] == 0 for r in c["rcm"]) and [r[1] for r in c["rcm"]] == [3645, 3645, 4320, 4860], "test: reverse charge in 3B 3.1(d) = the books in all four quarters (%s)" % [r[1] for r in c["rcm"]])
    # 9. days late, late fee and interest
    late = {x["label"]: [x["days"], x["fee"], x["interest"]] for x in E("GSTX.late('09', '2025-26')")}
    want = {"GSTR-3B Q1 2025-26": 92, "GSTR-3B Q2 2025-26": 106, "GSTR-3B Q3 2025-26": 20, "GSTR-1 Q2 2025-26": 22, "GSTR-1 Q3 2025-26": 31}
    ok(all(late[k][0] == v for k, v in want.items()), "9. days late: 3B Q1 92, Q2 106, Q3 20; GSTR-1 Q2 22, Q3 31 (%s)" % {k: late[k][0] for k in want})
    ok(all(late[k][0] == 0 for k in late if k not in want and late[k][0] is not None), "9. every other return of the year on time")
    ok(all(late[k][1] == late[k][0] * 50 for k in want) and all(late[k][2] is not None and late[k][2] > 0 for k in want if "3B" in k), "9. late fee Rs 50 a day (within the cap) and interest on each late 3B (%s)" % {k: late[k][1:] for k in want})
    # 8. credit in 2B not claimed (3B 4A(5) against 2B, net of suppliers' credit notes)
    un = {q: E("(q) => GSTX.unclaimed('09', q).rows.find(r => r.h === 'cgst').not", q) for q in ["202506", "202509", "202512", "202603"]}
    ok(un == {"202506": 1089.78, "202509": 1342.08, "202512": 937.07, "202603": 860.34}, "8. CGST in 2B not claimed: Q1 1,089.78, Q2 1,342.08, Q3 937.07 (after a supplier's credit note of 7,398.31), Q4 860.34 (%s)" % un)
    # 6. 2B against the books for the year
    tb = E("""(() => { const t = GSTX.twoBYear('09', '2025-26'); return t.only2b.filter(x => /YOTTA|BMS/.test(x.party)).map(x => [x.no, x.say]); })()""")
    ok(sorted(x[0] for x in tb) == ["BMS/25-26/05", "YO/DL/25-26/10", "YO/DL/25-26/11"] and all(x[1] == "credit claimed in 3B but no entry in books" for x in tb),
       "6. Yottacto (2 invoices) and BMS Services: credit claimed in 3B but no entry in books (%s)" % tb)

    # 5 and 7. the filed GSTR-1 / IFF, invoice by invoice: Jan-2026 IFF brought in as the portal's Excel; Q2 GSTR-1 as JSON
    jan = E("""async () => { await ensureXlsx();
      const inv = GSTX.bookDocs('09', '2025-26').filter(d => d.ym === '202601' && d.kind === 'B2B');
      const rows = [['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess Amount']];
      const fmt = d => d.slice(6, 8) + '-' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+d.slice(4, 6) - 1] + '-' + d.slice(0, 4);
      const left = inv[0], igstOne = inv[1];
      inv.slice(1).forEach(d => { const i = d === igstOne; rows.push([d.gstin, d.party, d.no, fmt(d.date), 0, d.gstin.slice(0, 2) + '-State', 'N', '', 'Regular B2B', '', 18, d.taxable,
        i ? d.taxable * 0.18 : d.igst, i ? 0 : d.cgst, i ? 0 : d.sgst, 0]); });
      rows.push(['09AAACZ9999Z1Z5', 'Someone Else', 'NOT-IN-BOOKS-1', '15-Jan-2026', 1180, '09-Uttar Pradesh', 'N', '', 'Regular B2B', '', 18, 1000, 0, 90, 90, 0]);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Summary For B2B,SEZ,DE (4A, 4B, 6B, 6C)'], [], []].concat(rows)), 'b2b,sez,de');
      const f = new File([XLSX.write(wb, {bookType: 'xlsx', type: 'array'})], 'GSTR1_09AANFG3202D1ZR_012026.xlsx');
      await gstxImport([f]);
      return {left: left.no, igst: igstOne.no, n: inv.length, kept: Object.keys(S.books.filedDocs || {})}; }""")
    ok(jan["kept"] == ["09|iff|202601"], "5. the Jan-2026 IFF's Excel brought in, as an IFF (%s)" % jan["kept"])
    st = E("(() => { const m = GSTX.r1Match('09', '2025-26'); const of = no => (m.rows.find(r => (r.b || r.f).no === no) || {}); return {left: of(%s).st, igst: [of(%s).st, of(%s).issues], extra: of('NOT-IN-BOOKS-1').st, c: m.counts}; })()" % (json.dumps(jan["left"]), json.dumps(jan["igst"]), json.dumps(jan["igst"])))
    ok(st["left"] == "booksOnly" and st["extra"] == "filedOnly" and st["igst"][1] == ["taxtype"], "5. in the books not in the return, in the return not in the books, another tax type (%s)" % {k: st[k] for k in ("left", "extra", "igst")})
    # a December invoice reported in January: another period
    E("""() => { const d = GSTX.bookDocs('09', '2025-26').find(x => x.ym === '202512' && x.kind === 'B2B'); const k = '09|iff|202601';
      S.books.filedDocs[k].docs.push({kind: 'B2B', gstin: d.gstin, no: d.no, date: d.date, pos: d.gstin.slice(0, 2), taxable: d.taxable, igst: d.igst, cgst: d.cgst, sgst: d.sgst, cess: 0}); window.__dec = d.no; }""")
    ok(E("GSTX.r1Match('09', '2025-26').rows.find(r => r.b && r.b.no === window.__dec).issues.includes('period')"), "5. a Dec-2025 invoice reported in the Jan-2026 IFF: another period")
    # 7. credit notes: Q2 GSTR-1 JSON with the quarter's credit notes but Girimadhukant and IX Solutions; Q4 without Puresens
    cn = E("""async () => {
      const cns = GSTX.bookDocs('09', '2025-26').filter(d => d.kind === 'CDNR');
      const mk = (fp, list) => ({gstin: '09AANFG3202D1ZR', fp, cdnr: list.filter(d => d.gstin).map(d => ({ctin: d.gstin, nt: [{ntty: 'C', nt_num: d.no, nt_dt: d.date.slice(6, 8) + '-' + d.date.slice(4, 6) + '-' + d.date.slice(0, 4), val: 0,
        pos: d.gstin.slice(0, 2), itms: [{num: 1, itm_det: {txval: d.taxable, rt: 18, iamt: d.igst, camt: d.cgst, samt: d.sgst, csamt: 0}}]}]})),
        cdnur: list.filter(d => !d.gstin).map(d => ({ntty: 'C', nt_num: d.no, nt_dt: d.date.slice(6, 8) + '-' + d.date.slice(4, 6) + '-' + d.date.slice(0, 4), val: 0, pos: '09', itms: [{num: 1, itm_det: {txval: d.taxable, rt: 18, iamt: d.igst, camt: d.cgst, samt: d.sgst, csamt: 0}}]}))});
      const q2 = cns.filter(d => d.ym >= '202507' && d.ym <= '202509' && !/GIRIMADHU|IX SOL/i.test(d.party)), q4 = cns.filter(d => d.ym >= '202601' && d.ym <= '202603' && !/PURESENS/i.test(d.party));
      await gstxImport([new File([JSON.stringify(mk('092025', q2))], 'returns_092025_R1.json', {type: 'application/json'}), new File([JSON.stringify(mk('032026', q4))], 'returns_032026_R1.json', {type: 'application/json'})]);
      return GSTX.creditNotes('09', '2025-26').filter(r => r.st === 'booksOnly').map(r => [r.b.party, r.b.date]); }""")
    names = sorted(x[0].upper()[:12] for x in cn)
    ok(any("GIRIMADHU" in n for n in names) and any(n.startswith("IX SOLUTION") for n in names) and any("PURESENS" in n for n in names) and len(cn) == 3,
       "7. credit notes in the books in no return: Girimadhukant and IX Solutions (29-08-2025), Puresens (31-03-2026) (%s)" % cn)

    # 10. filed returns are final: the corrections, and the Excel
    E("GSTX.setFinal('09', true)")
    fx = E("GSTX.corrections('09', '2025-26').rows.map(r => [r.no, r.action])")
    act = {n: a for n, a in fx}
    ok(any("Make it Optional" in a for n, a in fx) and act.get("NOT-IN-BOOKS-1", "").startswith("Book this invoice") and any("Change the tax type in Tally to IGST" in a for a in act.values())
       and any(n == "YO/DL/25-26/10" and "Book this bill" in a for n, a in fx), "10. final: corrections to make in Tally (make Optional, book this invoice, change the tax type, book the 2B bill)")
    E("() => { window.__saved = []; window.saveFile = (n, b) => window.__saved.push(n); }")
    E("GSTX.correctionsExcel('09', '2025-26')")
    ok(any("GST-book-corrections_2025-26.xlsx" in n for n in E("window.__saved")), "10. the corrections as Excel, with a 'Book corrections' sheet")
    # 11. Optional entries, never in a return
    op = E("GSTX.optional('09', '2025-26')")
    ok(len(op) > 0 and sum(1 for o in op if "CONCEPT" in o["party"].upper() and o["date"] == "20250730") == 2, "11. Optional entries with GST listed (%d), Concept Engineers' two of 30-07-2025 among them" % len(op))
    # 12. an entry deleted in Tally: kept, marked, credit to reverse when its bill is in 2B
    g = E("""(() => { const b = S.books, pr = GST2B.run('09').pairs, v = b.vouchers.find(x => x.date.startsWith('202512') && !Books.isSale(x) && pr.some(p => p.books && p.books.some(z => z.id === x.id)));
      const keep = b.vouchers.filter(x => x.date >= '20251201' && x.date <= '20251231' && x !== v);
      TallyRead.merge(b, {vouchers: keep, meta: {gstins: []}}, '20251201', '20251231'); GST2B._memo = null;
      const list = GSTX.gone('09'); const x = list.find(z => z.id === v.id);
      return {id: v.id, there: b.vouchers.some(z => z.id === v.id), kept: !!(b.gone[v.id] && b.gone[v.id].v), say: x && x.say, reverse: x && x.reverse}; })()""")
    ok(not g["there"] and g["kept"] and g["reverse"] and "credit to reverse" in (g["say"] or ""), "12. a December purchase deleted in Tally: kept, marked deleted, credit to reverse (%s)" % g["say"])
    back = E("""(id) => { const b = S.books, v = b.gone[id].v; TallyRead.merge(b, {vouchers: b.vouchers.filter(x => x.date >= '20251201' && x.date <= '20251231').concat([v]), meta: {gstins: []}}, '20251201', '20251231');
      return [!!b.gone[id], !!b.gone[id].back, GSTX.gone('09').some(z => z.id === id)]; }""", g["id"])
    ok(back == [True, True, False], "12. sent again by Tally: marked back, not removed from the record (%s)" % back)
    E("""(id) => { const b = S.books; TallyRead.merge(b, {vouchers: b.vouchers.filter(x => x.date >= '20251201' && x.date <= '20251231' && x.id !== id), meta: {gstins: []}}, '20251201', '20251231'); }""", g["id"])
    ok(E("(id) => GSTX.gone('09').some(z => z.id === id)", g["id"]), "12. deleted again: listed again")
    # 13. marked filed from the portal (RETTRACK): ARN and date; Apr-2025's GSTR-1 entry is the IFF
    n = E("""GSTX.takePortal('09', [{rtntype: 'GSTR3B', ret_prd: '062025', arn: 'AA0906250PORTAL', dof: '24-10-2025', status: 'Filed'}, {rtntype: 'GSTR1', ret_prd: '042025', arn: 'AA0904250PORTAL', dof: '13-05-2025', status: 'Filed'}, {rtntype: 'GSTR3B', ret_prd: '092025', status: 'Not Filed'}])""")
    pt = E("[GSTX.portal('09', 'r3b', '202506'), GSTX.portal('09', 'iff', '202504'), GSTX.portal('09', 'r3b', '202509'), GSTX.late('09', '2025-26').find(x => x.form === 'r3b' && x.per === '202506')]")
    ok(n == 2 and pt[0]["arn"] == "AA0906250PORTAL" and pt[0]["dof"] == "2025-10-24" and pt[1]["arn"] == "AA0904250PORTAL" and pt[2] is None and pt[3]["source"] == "portal" and pt[3]["days"] == 92,
       "13. returns marked filed from the portal with ARN and date (the Apr GSTR-1 entry as the IFF; a return not filed left alone)")

    # the pages: Filed vs books, the 3B page's unclaimed credit, Returns filed with days late
    E("() => { S.books = window.__bk; S.gstYm = '202603'; S.gstPart = 'recon'; S.gstvFy = '2025-26'; render(); }"); pg.wait_for_timeout(1200)
    ok(pg.locator('#app nav[aria-label="GST"] button[data-part="recon"]').count() == 1 and pg.locator("#app [data-recon]").count() == 1, "the GST tab has Filed vs books")
    for t, sel in [["Tax type", "#reconTax tbody tr"], ["2B vs books", "#recon2b tbody tr"], ["Credit notes", "#reconCn tbody tr"], ["Optional – not in returns", "#reconOpt tbody tr"], ["Deleted in Tally", "#reconGone tbody tr"], ["Corrections", "#reconFix tbody tr"]]:
        pg.click('#app nav[aria-label="Filed vs books"] button:has-text("%s")' % t); pg.wait_for_timeout(700)
        ok(pg.locator(sel).count() > 0, "Filed vs books → %s: listed (%d)" % (t, pg.locator(sel).count()))
    ok(pg.is_checked('input[aria-label="Filed returns are final"]'), "10. 'Filed returns are final' shown on, per client GSTIN")
    E("() => { S.gstPart = 'r3b'; S.gstYm = '202506'; render(); }"); pg.wait_for_timeout(1000)
    ok(pg.locator("#app [data-unclaimed] tr[data-head=cgst]").count() == 1 and "1,089.78" in pg.inner_text("#app [data-unclaimed]"), "8. the 3B page shows CGST 1,089.78 in 2B not claimed (Q1)")
    ok(pg.locator("#app [data-optional-note]").count() == 1, "11. the return pages say how many Optional entries are in no return")
    E("() => { S.gstPart = 'vault'; render(); }"); pg.wait_for_timeout(1000)
    ok(pg.inner_text('#app [data-late="r3b|202506"]').startswith("92 days") and "agrees" in pg.inner_text("#app [data-cross]"), "9. Returns filed: 92 days late on 3B Q1; the GSTR-1 + IFF against 3B cross-check agrees")
    ok(E("document.querySelector('#app [data-cross] [data-r1-year]').textContent").replace(",", "").startswith("17363343.44") or "1,73,63,343.44" in pg.inner_text("#app [data-cross]"), "9. the year's GSTR-1 + IFF shown: 1,73,63,343.44")
    # a returns-filed PDF taken off the list: kept, marked, restored
    rid = E("GSTV.list()[0].id")
    E("(id) => { gstvRemove(id); }", rid); pg.wait_for_timeout(300); pg.fill("#cbxWhy", "wrong file"); pg.click('[data-cbx="yes"]'); pg.wait_for_timeout(500)
    x = E("(id) => { const x = GSTV.all().find(z => z.id === id); return [!!x, x && x.removed && x.removed.reason, GSTV.list().some(z => z.id === id)]; }", rid)
    ok(x == [True, "wrong file", False], "a returns-filed PDF removed: kept and marked removed with the reason, off the list (%s)" % x)
    pg.click("#app button:text-is('restore')"); pg.wait_for_timeout(400)
    ok(E("(id) => GSTV.list().some(z => z.id === id)", rid), "and restored")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nFAILED: %d" % len(fails) if fails else "\nall passed")
