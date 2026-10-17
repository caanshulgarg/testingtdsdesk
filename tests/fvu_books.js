// The made-up books the FVU tests build FinCom's own TDS files from (run_fvu_layout.js; run_fvu87.py through
// `node fvu_books.js <out dir>`): Larkspur Fixture Events Private Limited (tests/fixtures/books, made up), FY 2025-26, each
// quarter: 194C to an LLP and to a transporter with no PAN (20%, remark C), 194J professional fees, 194A interest, 195 to a
// non-resident (27Q), TCS on scrap (27EQ), two employees' salary through Tally's payroll (24Q; Annexure II in Q4). Every
// deduction is on a challan of the 7th of the next month. Test data only.
"use strict";
const path = require("path"), fs = require("fs");
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "MONTHS3", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "TDS", "Certs", "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES",
  "NEW_FORMS_VALIDATED", "noPanRate", "NO_PAN_RATE", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "TDSCH", "TDSRate", "TDSLdc", "TDSWatch", "TDSFiled", "TDSInt", "TDSTally", "AIH", "Payroll",
  "PayTax", "TDS24Q", "TDS24Q_FILE", "TDSYear", "TDSReg", "TRF", "istParts", "p2ist", "istDay", "istToday", "TDS_SEC_CODES"];
const FY = "2025-26", QS = ["Q1", "Q2", "Q3", "Q4"];
const FIRM = {tan: "DELL04827E", pan: "AAGCL4827M", name: "Larkspur Fixture Events Private Limited", deductorType: "K", branch: "Head Office", flat: "Unit 4", premises: "Larkspur House", road: "Ring Road",
  area: "Lajpat Nagar", town: "New Delhi", state: "09", pin: "110024", email: "accounts@larkspur.example", phone: "9811000000",
  person: "Devika Larkspur", personDesignation: "Director", personPan: "ABCPL1234D", personFlat: "Unit 4", personPremises: "Larkspur House", personRoad: "Ring Road",
  personArea: "Lajpat Nagar", personTown: "New Delhi", personState: "09", personPin: "110024", personEmail: "devika@larkspur.example", personMobile: "9811000001"};
function books(){
  const have = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
  const {ctx, x} = load(HTML, have);
  ctx.S.companies = {t: {id: "t", name: FIRM.name, tan: FIRM.tan, pan: FIRM.pan}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
  ctx.saveBooks = () => {}; ctx.whoAmI = () => "t"; let u = 0; ctx.uid = (p) => (p || "id") + (++u); ctx.D = () => ({parties: {}}); ctx.render = () => {}; ctx.toast = () => {};
  ctx.Cloud = {on: () => false}; ctx.ClosedP = {cfg: () => ({})}; ctx.lsGet = () => null; ctx.lsSet = () => {};
  const V = (id, date, party, exp, tds, led, expLed) => ({id, date, type: "Journal", no: id, party, ent: [{l: party, a: exp - tds}, {l: led, a: tds}, {l: expLed, a: -exp}]});
  const vs = [], challans = [], alloc = {};
  ["20250510", "20250815", "20251110", "20260210"].forEach((d, i) => {
    const n = i + 1, due = {1: "20250607", 2: "20250905", 3: "20251205", 4: "20260306"}[n];
    vs.push(V("c" + n, d, "Quillfeather Weddings LLP", 100000, 2000, "TDS ON CONTRACT 194C", "Sound and Light Hire"));
    vs.push(V("j" + n, d, "Keshav Rathore", 50000, 5000, "TDS ON PROFESSIONAL 194J", "Legal and Professional Fees"));
    vs.push(V("a" + n, d, "Hemant Zaverchand (Loan)", 20000, 2000, "TDS ON INTEREST 194A", "Interest on Loan"));
    vs.push(V("x" + n, d, "Ashvattha Transport Co", 40000, 8000, "TDS ON CONTRACT 194C", "Freight"));
    vs.push(V("n" + n, d, "Overseas Design GmbH", 100000, 20800, "TDS ON NON RESIDENT 195", "Design Fees"));
    vs.push({id: "s" + n, date: d, type: "Sales", no: "LFE/S/" + n, party: "Scrap Buyer Co", ent: [{l: "Scrap Buyer Co", a: -101000}, {l: "Scrap Sales", a: 100000}, {l: "TCS ON SCRAP", a: 1000}]});
    challans.push({id: "ch" + n, bsr: "0510308", serial: "0000" + n, date: due, tax: 17000, interest: 0, section: "194C"});
    challans.push({id: "nr" + n, bsr: "0510308", serial: "0010" + n, date: due, tax: 20800, interest: 0, section: "195"});
    challans.push({id: "tc" + n, bsr: "0510308", serial: "0020" + n, date: due, tax: 1000, interest: 0, section: "206C"});
    challans.push({id: "sl" + n, bsr: "0510308", serial: "0030" + n, date: due, tax: 15000, interest: 0, section: "192"});
    ["c", "j", "a", "x"].forEach(k => { const v = vs.find(z => z.id === k + n); alloc[v.id + "|" + v.ent[1].l] = "ch" + n; });
    alloc["n" + n + "|TDS ON NON RESIDENT 195"] = "nr" + n; alloc["s" + n + "|TCS ON SCRAP"] = "tc" + n;
  });
  const b = {cid: "t", vouchers: vs, challans, alloc, certs: [], meta: {from: "20250401", to: "20260331"},
    map: {"TDS ON CONTRACT 194C": {kind: "tds_payable", section: "194C"}, "TDS ON PROFESSIONAL 194J": {kind: "tds_payable", section: "194J"}, "TDS ON INTEREST 194A": {kind: "tds_payable", section: "194A"},
      "TDS ON NON RESIDENT 195": {kind: "tds_payable", section: "195"}, "TCS ON SCRAP": {kind: "tcs_payable", section: "206C"}, "Bank": {kind: "bank"}},
    pans: {"Quillfeather Weddings LLP": "AAAFQ1234K", "Keshav Rathore": "ABCPR1234K", "Hemant Zaverchand (Loan)": "ABCPZ1234H", "Scrap Buyer Co": "AABCS1234B"},
    // country: a number of Protean's list (1 to 286); which country 49 is there was not checked (made-up data)
    nrInfo: {"Overseas Design GmbH": {country: "49", nature: "16", email: "acct@overseas.example", address: "1 Hauptstrasse Berlin", tin: "DE123456789", phone: "4930123456"}}};
  ctx.S.books = b;
  // the payroll: Ravi 2,00,000 a month (basic and HRA), TDS 4,000; Sunita 80,000 basic, TDS 1,000
  const emp = [{guid: "e1", name: "Ravi Menon", pan: "ABCPM1234R", joined: "2023-06-01"}, {guid: "e2", name: "Sunita Rao", pan: "ABCPR5678S", joined: "2024-01-15"}];
  const heads = [{name: "Basic", pay_type: "Earnings for Employees", it_component: "Basic Salary"}, {name: "HRA", pay_type: "Earnings for Employees", it_component: "House Rent Allowance"},
    {name: "Income Tax", pay_type: "Deductions from Employees", pay_stat_type: "Income Tax"}];
  const allocs = [], pvs = [];
  for (let m = 4; m <= 15; m++){
    const y = m > 12 ? 2026 : 2025, mm = String(m > 12 ? m - 12 : m).padStart(2, "0"), day = y + "-" + mm + "-28", g = "p" + m;
    pvs.push({guid: g, alter_id: 1, day, vtype: "Payroll", vno: "P" + m});
    allocs.push({guid: g, alter_id: 1, day, ledger: "Basic", centre: "Ravi Menon", amount: -150000}, {guid: g, alter_id: 1, day, ledger: "HRA", centre: "Ravi Menon", amount: -50000},
      {guid: g, alter_id: 1, day, ledger: "Income Tax", centre: "Ravi Menon", amount: 4000});
    allocs.push({guid: g, alter_id: 1, day, ledger: "Basic", centre: "Sunita Rao", amount: -80000}, {guid: g, alter_id: 1, day, ledger: "Income Tax", centre: "Sunita Rao", amount: 1000});
  }
  x.Payroll.take(b, {book: "bk", employees: emp, heads, allocs, pays: [], vouchers: pvs});
  // Ravi chose the old regime: 80C 1,50,000, rent 3,00,000 a year to a landlord with a PAN (HRA exempt 1,20,000); Sunita the new
  const ravi = x.Payroll.employees().find(e => e.name === "Ravi Menon");
  [["regime", "old"], ["d80C", 150000], ["rent", 300000], ["landlordPan", "ABCPL5678L"], ["landlordName", "Lata Iyer"], ["hraMetro", "no"]].forEach(([k, v]) => x.Payroll.setDetail(ravi, k, v));
  x.Payroll.tdsRows().forEach(r => { b.alloc[r.id] = "sl" + (QS.indexOf(r.q) + 1); });
  return {ctx, x, b};
}
// every file: {"26Q1.txt": result, ...}; the names fit the FVU's 12 characters
function buildAll(x, firm){
  const out = {};
  ["26Q", "27Q", "27EQ"].forEach(form => QS.forEach(q => { out[(form === "27EQ" ? "27E" : form) + q.slice(1) + ".txt"] = x.TDS26Q.build(FY, q, firm || FIRM, form); }));
  QS.forEach(q => { out["24Q" + q.slice(1) + ".txt"] = x.TDS24Q_FILE.build(FY, q, firm || FIRM); });
  return out;
}
module.exports = {books, buildAll, FIRM, FY, QS};
if (require.main === module){
  const dir = process.argv[2]; fs.mkdirSync(dir, {recursive: true});
  const {x} = books(), all = buildAll(x), res = {};
  Object.entries(all).forEach(([n, f]) => { if (f.text) fs.writeFileSync(path.join(dir, n), f.text); res[n] = f.error || {name: f.name, rows: f.rows}; });
  console.log(JSON.stringify(res));
}
