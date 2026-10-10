// node e2e_tdsgst_app.js <in.json> <out.json> - round 43: FinCom's own TDS and GST code (the code the TDS and GST pages and
// their downloads use: TDS.rows / nrRows / tcsRows / salaryRows, Certs, TDS26Q.build for Forms 140 / 144 / 143, TCS27EQ.checks,
// GSTR.toJson (GSTR-1 JSON with GSTAmend's amendments), GSTR.threeBJson (GSTR-3B JSON)) run on the books as FinCom has them:
// the day files the cloud keeps (read by Books.importDayBook as TCloud.load reads them) and the ledger masters (Books.importMasters,
// as "From Tally -> ledger masters" reads them), with the CA's setup (setup.json: ledgers, certificate, challans) applied as
// a person would. Called by run_e2e_tdsgst.py; prints nothing it compares itself (the comparison is the Python test's).
//   in.json: {setup, phases: [{name, months: [{ym, files: [day file paths]}], masters, gstr1: [yyyymm], threeB: [yyyymm], fileGstr1: [yyyymm]}]}
const fs = require("fs"), path = require("path"), {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "TDS26Q", "TDS_FORMS",
  "TCS27EQ", "PAY_CODES", "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "GSTSet", "GSTF", "GSTQ"];
(async () => {
  const inp = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), outPath = process.argv[3];
  const setup = JSON.parse(fs.readFileSync(inp.setup, "utf8"));
  const avail = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
  const {ctx, x} = load(HTML, avail);
  const cl = setup.client;
  ctx.S.companies = {[cl.id]: {id: cl.id, name: cl.name, tallyName: cl.tallyName, gstin: cl.gstin, pan: cl.pan, tan: cl.tan, choices: {}}};
  ctx.S.coId = cl.id; ctx.CO = () => ctx.S.companies[cl.id]; ctx.D = () => ({parties: {}, entries: {}});
  const out = {loaded: avail, phases: {}};
  let keep = {};          // what the person did and FinCom keeps between the phases: filed returns, certificates, challans, allocation, ledger choices
  for (const ph of inp.phases){
    const R = out.phases[ph.name] = {};
    // ---- the books: every month's day files, as TCloud.load brings them in (one envelope a month, Books.importDayBook)
    const vouchers = [], gst = new Set(); const days = {};
    for (const m of ph.months){
      const parts = m.files.map(f => fs.readFileSync(f, "utf8"));
      const res = await x.Books.importDayBook(new Blob(["<ENVELOPE>" + parts.join("") + "</ENVELOPE>"], {type: "text/xml"}));
      res.vouchers.forEach(v => vouchers.push(v)); (res.meta.gstins || []).forEach(g => gst.add(g)); days[m.ym] = res.vouchers.length;
    }
    vouchers.sort((a, c) => String(a.date).localeCompare(String(c.date)));
    const dates = vouchers.map(v => v.date).sort();
    const b = {cid: cl.id, vouchers, meta: {from: dates[0], to: dates[dates.length - 1], gstins: Array.from(gst), bills: 1, cc: 1}, challans: [], alloc: {}, certs: []};
    const ms = await x.Books.importMasters(new Blob([fs.readFileSync(ph.masters)], {type: "text/xml"}));
    Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, gstins: ms.gstins, pans: ms.pans, states: ms.states});
    b.map = x.Books.mapLedgers(b.vouchers, keep.map || {});
    ctx.S.books = b;
    R.books = {vouchers: vouchers.length, byMonth: days, gstins: b.meta.gstins, pans: ms.pans, ledgerGstins: ms.gstins, count: ms.count,
      entries: vouchers.map(v => ({no: v.no, type: v.type, date: v.date, party: v.party, gstin: v.gstin, pos: v.pos, cmp: v.cmp, regType: v.regType, country: v.country, rcm: v.rcm,
        taxability: v.taxability, ineligible: v.ineligibleFlag, cancel: v.cancel, opt: v.opt, narr: v.narr, ent: v.ent.map(e => [e.l, e.a, e.h || "", e.gr == null ? null : e.gr])}))};
    // ---- the ledgers: FinCom's own proposal from Tally's masters and the day book, then the CA's choices applied
    x.LedMaster.refresh(b);
    R.proposals = {};
    Object.keys(setup.ledgers).forEach(n => { const m = b.map[n] || {}; R.proposals[n] = {what: m.what || "", tax: m.tax || "", side: m.side || "", section: m.section || "", why: m.why || ""}; });
    Object.entries(setup.ledgers).forEach(([n, s]) => {
      const m = b.map[n] = b.map[n] || {n: 0};
      x.LedMaster.applyWhat(m, s.what);
      if (s.tax) m.tax = s.tax; if (s.side) m.side = s.side; if (s.reg) m.reg = s.reg; if (s.section) m.section = s.section;
      m.ok = true; m.byHand = true;
    });
    b.mapV = (b.mapV || 0) + 1;
    // ---- what the person keeps: the certificate, the challans, the filed returns
    b.certs = JSON.parse(JSON.stringify(setup.certs));
    b.challans = setup.challans.map(c => ({id: c.id, bsr: c.bsr, serial: c.serial, date: c.date, tax: c.tax, interest: c.interest, section: c.section || ""}));
    b.alloc = Object.assign({}, keep.alloc || {});
    if (keep.filed) b.filed = JSON.parse(JSON.stringify(keep.filed));
    const T = x.TDS;
    // the rows whose entry changed since the last allocation go again: a person allocates what is new
    const ids = new Set(T.rows().concat(T.nrRows(), T.tcsRows()).map(r => r.id));
    Object.keys(b.alloc).forEach(k => { if (!ids.has(k)) delete b.alloc[k]; });
    R.allocated = T.autoAllocate();
    // ---- TDS and TCS
    const fy = "2026-27", q = "Q1";
    const row = r => ({party: r.party, pan: r.pan, section: r.section, date: r.date, paid: r.paid, tds: r.tds, rate: r.rate, rateFrom: r.rateFrom, voucher: r.voucher, ledger: r.ledger, code: r.code,
      remark: x.TDS26Q.remark(r, r.code !== undefined ? "27EQ" : (T.NR.test(T.sec(r.section)) ? "27Q" : "26Q")), challan: r.challan});
    R.tds = {rows: T.rows().filter(r => r.fy === fy && r.q === q).map(row), nr: T.nrRows().filter(r => r.fy === fy && r.q === q).map(row),
      tcs: T.tcsRows().filter(r => r.fy === fy && r.q === q).map(row), salary: T.salaryRows().filter(r => r.fy === fy).map(row),
      forms: {"26Q": T.formName("26Q", fy), "27Q": T.formName("27Q", fy), "27EQ": T.formName("27EQ", fy), "24Q": T.formName("24Q", fy)},
      tcsChecks: x.TCS27EQ.checks(fy, q).map(c => ({party: c.row.party, ledger: c.row.ledger, code: c.row.code, why: c.why})),
      certIssues: x.Certs.issues(fy, q).map(i => ({party: i.row.party, expected: i.expected, why: i.why, short: i.short})), files: {}};
    const firm = {tan: cl.tan, pan: cl.pan, name: cl.name, deductorType: "F"};
    ["26Q", "27Q", "27EQ"].forEach(f => {
      const r = x.TDS26Q.build(fy, q, firm, f);
      if (r.error){ R.tds.files[f] = {error: r.error}; return; }
      const dd = r.text.split("\r\n").filter(Boolean).map(l => l.split("^")).filter(a => a[1] === "DD").map(a => ({code: a[6], pan: a[7], party: a[8], paid: a[10], tds: a[11], total: a[16],
        dateCredit: a[17], dateDeduct: a[18], rate: a[19], section: a[20], remark: a[21], certNo: a[22], tail: a.slice(30)}));
      R.tds.files[f] = {name: r.name, formNo: r.formNo, draft: r.draft, missingCodes: r.missingCodes, rows: r.rows, challans: r.challans, remarks: r.remarks, dd};
    });
    // ---- GST
    const reg = cl.gstin.slice(0, 2);
    R.gstr1 = {}; R.gstr3b = {}; R.pending = {};
    (ph.gstr1 || []).forEach(ym => { R.gstr1[ym] = x.GSTR.toJson(ym, reg); });
    (ph.threeB || []).forEach(ym => { R.gstr3b[ym] = x.GSTR.threeBJson(ym, reg); });
    (ph.gstr1 || []).forEach(ym => { try { R.pending[ym] = x.GSTAmend.pending(ym, reg).rows.map(r => ({P: r.P, kind: r.kind, what: r.what, act: r.act, changes: r.changes, num: (r.now || r.was || {}).num})); } catch (e){ R.pending[ym] = {error: String(e)}; } });
    R.optional = (b.vouchers || []).filter(v => v.opt).map(v => v.no);
    // the returns filed now (May's GSTR-1, as downloaded and filed from here): what later amendments are measured against
    (ph.fileGstr1 || []).forEach(ym => { x.GSTAmend.keep(JSON.parse(JSON.stringify(R.gstr1[ym] || x.GSTR.toJson(ym, reg))), "downloaded"); });
    keep = {filed: b.filed, alloc: b.alloc, map: b.map};
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
