// node e2e_payroll_app.js <in.json> <out.json> - bridge 2.4.4: FinCom's own payroll code (Payroll, PayTax, TDS24Q_FILE,
// src/js/73; TDSTally's challans, src/js/72; BookSrc, src/js/67) run on the cloud copy as the app reads it: its REST reads
// (TCloud.restPages) answered from the database's rows (copy_rest_stub.js), the entries brought in as BookSrc does, the
// details a person keeps for each employee (setup.json's "details") put in as the Employees page does (Payroll.setDetail).
// Called by run_e2e_payroll.py, which compares; nothing compared here.
//   in.json: {setup, book, tables: {tally_employees, tally_ledgers, tally_cost_allocs, tally_salary_pays, tally_vouchers, tally_lines}}
const fs = require("fs"), {load, HTML} = require("./harness"), {restStub} = require("./copy_rest_stub");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "MONTHS3", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "Certs", "TDS26Q", "TDS_FORMS",
  "TCS27EQ", "PAY_CODES", "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "BookSrc", "TDSCH", "TDSRate", "TDSLdc", "TDSWatch",
  "TDSFiled", "TDSTally", "AIH", "Payroll", "PayTax", "TDS24Q_FILE", "BOOKS_KEYS",
  // tds-layout (14-Oct-2026): the one tagging (TDSCH.tag) asks the challan register (TDSReg) for the balance, the lock, the trail
  "TDSReg", "TDS_SEC_CODES", "uid", "lsGet", "lsSet", "istParts", "p2ist", "istDay", "istToday",
  // next-challan-match: the one matcher (its suggestions confirmed, as a person does on Form 138's Challans tab)
  "money", "TDS24Q", "Market", "TDSMatch"].concat(require("./harness").TM_NAMES);
(async () => {
  const inp = JSON.parse(fs.readFileSync(process.argv[2], "utf8")), outPath = process.argv[3];
  const setup = JSON.parse(fs.readFileSync(inp.setup, "utf8"));
  const avail = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
  const {ctx, x} = load(HTML, avail);
  ctx.S.companies = {pe: {id: "pe", name: setup.company, tallyName: setup.company, tan: "DELP01234E", pan: "AAACP1234Q", choices: {}}};
  ctx.S.coId = "pe"; ctx.CO = () => ctx.S.companies.pe; ctx.D = () => ({parties: {}, entries: {}}); ctx.whoAmI = () => "e2e";
  ctx.saveBooks = () => {}; ctx.render = () => {}; let uidN = 0; ctx.uid = (p) => (p || "id") + ++uidN;
  const T = inp.tables, stub = restStub(T);
  ctx.TCloud = {restPages: stub.api};
  // the entries, as TCloud.load brings in the cloud copy (BookSrc), and the challans TDSTally makes from Tally's payments
  const b = {cid: "pe", vouchers: [], meta: {from: setup.fy.slice(0, 4) + "0401", to: (Number(setup.fy.slice(0, 4)) + 1) + "0331"}, challans: [], alloc: {}, certs: []};
  ctx.S.books = b;
  x.BookSrc.apply(b, T.tally_vouchers, T.tally_lines, []);
  b.map = x.Books.mapLedgers(b.vouchers, {});
  const out = {loaded: avail};
  try { x.TDSTally.sync(b); } catch (e){ out.syncError = String(e && e.stack || e); }
  out.n = await x.Payroll.into(b, inp.book);
  out.asked = stub.asked.length;
  for (const [name, d] of Object.entries(setup.details)){
    const e = x.Payroll.employees().find(z => z.name === name);
    for (const [k, v] of Object.entries(d)) x.Payroll.setDetail(e, k, v);
  }
  // next-challan-match: Tally's payroll no longer tags by itself (autoTag is 0); its challans are suggested, From Tally
  // (the months each payment pays), and confirmed
  out.tagged = x.Payroll.autoTag(b) + ["Q1", "Q2", "Q3", "Q4"].reduce((a, q) => a + x.TDSMatch.confirmAll("24Q", setup.fy, q).n, 0);
  out.employees = x.Payroll.employees().map(e => ({name: e.name, pan: e.pan, group: e.parent, joined: e.joined, left: e.left, designation: e.designation}));
  out.groups = x.Payroll.groups().map(e => e.name);
  out.months = x.Payroll.months(setup.fy);
  out.registers = {};
  out.months.forEach(ym => { const R = x.Payroll.register(ym); out.registers[ym] = R.rows.map(r => ({employee: r.employee, gross: r.gross, ded: r.ded, net: r.net, tds: r.tds})); });
  out.challans = b.challans.map(c => ({id: c.id, bsr: c.bsr, serial: c.serial, date: c.date, tax: c.tax, section: c.section, from: c.from}));
  out.annex1 = {};
  for (const q of ["Q1", "Q2", "Q3", "Q4"]) out.annex1[q] = x.Payroll.annexI(setup.fy, q).map(r => ({employee: r.employee, pan: r.pan, date: r.date, paid: r.paid, tds: r.tds,
    challan: r.challan ? [r.challanBsr, r.challanNo, r.challanDate] : null}));
  out.annex2 = {};
  x.Payroll.annexII(setup.fy).forEach(f => { out.annex2[f.name] = f; });
  out.checks = {}; for (const q of ["Q1", "Q2", "Q3", "Q4"]) out.checks[q] = x.Payroll.checks(setup.fy, q).map(c => c.what + ": " + (c.who || []).join(", "));
  const firm = {tan: "DELP01234E", pan: "AAACP1234Q", name: setup.company, deductorType: "C"};
  out.fvu = {}; for (const q of ["Q1", "Q4"]) out.fvu[q] = x.TDS24Q_FILE.build(setup.fy, q, firm);
  out.salaryRows = x.TDS.salaryRows().filter(r => r.fy === setup.fy).length;
  out.challanUse = x.TDS.challanUse();
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
