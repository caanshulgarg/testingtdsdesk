// node run_tds_audit_challans.js - the TDS check of 22-Oct-2026 (scratchpad tds-audit), the challans and the matcher. Each
// part is shaped like the entry the audit found (Leads Insurance, Testing AAD); names and figures as the audit gives them.
//   N1  interest paid through Tally ("Interest on TDS" Dr 4,729 / bank, Payment S87 of 30-Jul-2025): a payment with interest
//       4,729 and tax 0; a challan made from it carries the interest; the ledger check calls the ledger TDS interest
//   H3  one Tally payment of five TDS ledgers (Payment 209, 06-Jul-2026, 2,27,543): one challan per section, in whole
//       rupees, adding up to what the bank paid; a payment with paise and a round-off: the tax is what the bank paid
//   H6  a short month never takes a later month's challan (194-I, September short by 1,041): "short-paid" said
//   H7  an April challan equal to the TDS ledger's 1-April balance pays last year's March: not offered to Q1
//   H8  a fee for one return from a challan whose own deductions are not yet on it: refused
//   M2  rules b and c take a challan within ±₹1 (challans are whole rupees)
//   M6  a challan's interest goes to the return whose late deductions are on it, by default
//   N9  a TDS payment far above the section's deductions is said (Testing AAD, 30-Apr-2026: 194C 1,92,270; 194T 3,60,000)
//   L2  a Tally payment of "192B" is named for the 192 deductions
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML} = require("./harness");
const fs = require("fs"), path = require("path");
const NAMES = ["num", "r2", "xesc", "esc", "money", "MONTHS", "MONTHS3", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "TDSSep", "GSTIN_RE", "TDSFiled", "ClosedP",
  "BOOKS_KEYS", "AuditWP", "TDSWatch", "TDSTally", "noPanRate", "NO_PAN_RATE", "AIH", "istParts", "p2ist", "istDay", "istToday", "TDSAdj", "TDSReg", "TDSCH", "Payroll", "TDS24Q", "TDSAudit", "TDSMatch",
  "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES", "challanFromBooks", "uid", "LedCheck"];
const avail = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
const {ctx, x} = load(HTML, avail);
// the matcher's rules (server/_shared/tdsmatch.js) are at the head of the app as plain functions; harness loads by name
const tm = fs.readFileSync(path.join(__dirname, "..", "server", "_shared", "tdsmatch.js"), "utf8").replace(/^export \{[^}]*\};\s*$/m, "");
require("vm").runInContext(tm + "\n;globalThis.__tm = {tmRules, tmReasons, tmDue};", ctx);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
let uidN = 0;
Object.assign(ctx, {saveBooks: () => {}, whoAmI: () => "t", render: () => {}, toast: () => {}, uid: (p) => (p || "id") + (++uidN), istToday: () => "20261022"});
ctx.S.data = {};

let n = 0;
const V = (o) => Object.assign({id: "c" + (++n), no: "", ref: "", party: "", narr: "", upd: o.date}, o);
const UNDER = {"TDS 192B": "TDS", "TDS 94C": "TDS", "TDS 94J 10%": "TDS", "TDS on Rent 94I": "TDS", "TDS 94J 2%": "TDS", "TDS 194 T": "TDS", "TDS": "Duties & Taxes", "DBS BANK(513)": "Bank Accounts",
  "Interest on TDS": "Indirect Expenses", "Round Off": "Indirect Expenses", "Rent": "Indirect Expenses", "Contract Exp": "Indirect Expenses", "Fees": "Indirect Expenses",
  "ALOK SWAROOP GUPTA": "Sundry Creditors", "Builder Co": "Sundry Creditors", "Consult LLP": "Sundry Creditors", "Salary": "Indirect Expenses", "Salary Payable": "Current Liabilities"};
const GROUPS = {"Sundry Creditors": "Current Liabilities", "Duties & Taxes": "Current Liabilities", "TDS": "Duties & Taxes", "Indirect Expenses": "", "Bank Accounts": "Current Assets", "Current Liabilities": "", "Current Assets": ""};
const MAP = {"TDS 192B": {kind: "tds_payable", section: "192B"}, "TDS 94C": {kind: "tds_payable", section: "194C"}, "TDS 94J 10%": {kind: "tds_payable", section: "194J", rate: 10},
  "TDS on Rent 94I": {kind: "tds_payable", section: "194I", rate: 10}, "TDS 94J 2%": {kind: "tds_payable", section: "194J", rate: 2}, "TDS 194 T": {kind: "tds_payable", section: "194T"},
  "DBS BANK(513)": {kind: "bank"}, "Round Off": {kind: "roundoff"}, "Interest on TDS": {kind: "", what: "none"}};
const co = {id: "cc", name: "TDS Challan Fixture"};
ctx.S.coId = "cc"; ctx.S.companies = {cc: co}; ctx.CO = () => co;
function books(vs, o){
  o = o || {};
  const b = {cid: "cc", vouchers: vs, meta: {from: "20250401", to: "20270331", bills: 1}, under: UNDER, groups: GROUPS, ledInfo: Object.fromEntries(Object.keys(UNDER).map(l => [l, {ob: 0, from: "20250401"}])),
    pans: {"ALOK SWAROOP GUPTA": "AAAPG1234A", "Builder Co": "AABCB1234B", "Consult LLP": "AABFC1234C"}, challans: o.challans || [], alloc: o.alloc || {}, certs: [], chPortions: o.portions || {}};
  if (o.tb) b.tb = o.tb;
  ctx.S.books = b;
  const m = {}; Object.entries(MAP).forEach(([k, v]) => { m[k] = Object.assign({byHand: true, ok: true}, v); });
  b.map = x.Books.mapLedgers(vs, m);
  x.TDSReg.forget();
  return b;
}
const ch = (id, date, tax, section, extra) => Object.assign({id, bsr: "0510308", serial: String(10000 + uidN++).slice(-5), date, tax, interest: 0, section: section || "", minorHead: "200"}, extra || {});

// ---------------------------------------------------------------- N1
{
  const s87 = V({type: "Payment", date: "20250730", no: "S87", party: "DBS BANK(513)", narr: "intt on salary", ent: [{l: "Interest on TDS", a: -4729}, {l: "DBS BANK(513)", a: 4729}]});
  const mixed = V({type: "Payment", date: "20250707", no: "S12", party: "DBS BANK(513)", ent: [{l: "TDS 94C", a: -5000}, {l: "Interest on TDS", a: -150}, {l: "DBS BANK(513)", a: 5150}]});
  books([s87, mixed]);
  const P = x.TDS.paymentsFromBooks(), p = P.find(z => z.vid === s87.id), m = P.find(z => z.vid === mixed.id);
  ok(p && p.tax === 0 && p.interest === 4729, "N1: Payment S87 \"Interest on TDS\" ₹4,729 alone is a TDS payment: tax 0, interest 4,729 (" + JSON.stringify(p) + ")");
  ok(m && m.tax === 5000 && m.interest === 150, "N1: tax and interest in one payment: tax 5,000, interest 150 (" + JSON.stringify(m && [m.tax, m.interest]) + ")");
  ok(x.challanFromBooks(s87.id, "0510308", "00087"), "N1: a challan made from it");
  const c = x.TDS.challans().find(z => z.fromVoucher === s87.id);
  ok(c && c.tax === 0 && c.interest === 4729, "N1: the challan carries interest 4,729, tax 0 (" + JSON.stringify(c && [c.tax, c.interest]) + ")");
  if (x.LedCheck && x.LedCheck.suggest){
    const s = x.LedCheck.suggest(ctx.S.books, "Interest on TDS", {n: 2, dr: 2, cr: 0, sale: 0, purch: 0, cn: 0, dn: 0, pay: 2, setoff: 0, other: 0});
    ok(s.what === "tds_interest", "N1: the ledger check calls \"Interest on TDS\" TDS interest, not \"not tax\" (" + s.what + ")");
  }
}
// ---------------------------------------------------------------- H3
{
  const p209 = V({type: "Payment", date: "20260706", no: "209", party: "DBS BANK(513)", ent: [{l: "TDS 192B", a: -198578}, {l: "TDS 94C", a: -16347}, {l: "TDS 94J 10%", a: -3500}, {l: "TDS on Rent 94I", a: -7984},
    {l: "TDS 94J 2%", a: -1134}, {l: "DBS BANK(513)", a: 227543}]});
  const aug = V({type: "Payment", date: "20260807", no: "230", party: "DBS BANK(513)", ent: [{l: "TDS 94C", a: -32081.13}, {l: "Round Off", a: 0.13}, {l: "DBS BANK(513)", a: 32081}]});
  const sep = V({type: "Payment", date: "20260907", no: "251", party: "DBS BANK(513)", ent: [{l: "TDS 94C", a: -18493.91}, {l: "Round Off", a: -1.09}, {l: "DBS BANK(513)", a: 18495}]});
  books([p209, aug, sep]);
  const P = x.TDS.paymentsFromBooks(), p = P.find(z => z.vid === p209.id);
  const parts = (p && p.parts) || [];
  ok(parts.length === 5 && parts.reduce((s, z) => s + z.tax, 0) === 227543 && parts.every(z => z.tax === Math.round(z.tax)), "H3: Payment 209: five parts, one per section, whole rupees, adding up to ₹2,27,543 (" + JSON.stringify(parts) + ")");
  x.challanFromBooks(p209.id, "0510308", "00209");
  const made = x.TDS.challans().filter(c => c.fromVoucher === p209.id);
  ok(made.length === 5 && made.every(c => c.section) && made.reduce((s, c) => s + c.tax, 0) === 227543, "H3: five challans, each naming its section (" + made.map(c => c.section + " " + c.tax).join(", ") + ")");
  ok(made.filter(c => c.serial === "00209").length === 1 && made.filter(c => !c.serial).length === 4, "H3: the serial given goes on one; the other four ask for theirs (drafts)");
  const a = P.find(z => z.vid === aug.id), s = P.find(z => z.vid === sep.id);
  ok(a && a.tax === 32081, "H3: 07-Aug: the bank paid ₹32,081; the challan's tax is 32,081, not 32,081.13 (" + (a && a.tax) + ")");
  ok(s && s.tax === 18495, "H3: 07-Sep: the bank paid ₹18,495; the challan's tax is 18,495, not 18,493.91 (" + (s && s.tax) + ")");
}
// ---------------------------------------------------------------- H6
{
  const {tmRules, tmReasons} = ctx.__tm;
  // Leads' rent: ₹6,943 a month to August 2025, ₹7,984 from September; September's challan (07-Oct) still ₹6,943
  const rows = [{id: "aug", sec: "194I", date: "20250801", tds: 6943, party: "ALOK SWAROOP GUPTA", fy: "2025-26", q: "Q2"}, {id: "sep", sec: "194I", date: "20250901", tds: 7984, party: "ALOK SWAROOP GUPTA", fy: "2025-26", q: "Q2"},
    {id: "oct", sec: "194I", date: "20251001", tds: 7984, party: "ALOK SWAROOP GUPTA", fy: "2025-26", q: "Q3"}];
  const chs = [{id: "c-sep7", sec: "194I", date: "20250907", minor: "200", bal: 6943, fy: "2025-26", label: "07-Sep"}, {id: "c-oct7", sec: "194I", date: "20251007", minor: "200", bal: 6943, fy: "2025-26", label: "07-Oct"},
    {id: "c-nov7", sec: "194I", date: "20251107", minor: "200", bal: 7984, fy: "2025-26", label: "07-Nov"}];
  const S = tmRules(rows, chs, {fy: "2025-26", q: "Q3", today: "20261022"});
  const octOn = S.find(z => z.ids.includes("oct")), sepOn = S.find(z => z.ids.includes("sep"));
  ok(octOn && octOn.chId === "c-nov7", "H6: October's deduction is on October's challan (07-Nov), never September's (07-Oct) (" + (octOn ? octOn.chId : "none") + ")");
  ok(!sepOn || !(sepOn.parts || [{chId: sepOn.chId}]).some(z => z.chId === "c-nov7"), "H6: September's deduction never takes October's challan (" + JSON.stringify(sepOn ? (sepOn.parts || [{chId: sepOn.chId}]) : null) + ")");
  const R = tmReasons(rows, chs, S, {fy: "2025-26", q: "Q3", today: "20261022"}), rs = R.find(z => z.rowId === "sep");
  ok(rs && /short-paid ₹1,041/i.test(rs.words) && /interest/i.test(rs.words), "H6: September says short-paid ₹1,041, with its interest (" + (rs && rs.words) + ")");
}
// ---------------------------------------------------------------- H7
{
  const p152 = V({type: "Payment", date: "20250429", no: "152", party: "DBS BANK(513)", ent: [{l: "TDS 94J 10%", a: -199268}, {l: "DBS BANK(513)", a: 199268}]});
  const apr = V({type: "Journal", date: "20250421", no: "GST/041", party: "Consult LLP", ent: [{l: "Fees", a: -46000}, {l: "TDS 94J 10%", a: 4600}, {l: "Consult LLP", a: 41400}]});
  books([p152, apr], {challans: [ch("ch152", "20250429", 199268, "194J", {fromVoucher: p152.id, from: "books"})],
    tb: {from: "20250401", to: "20260331", at: "2026-10-22", led: {"TDS 94J 10%": {open: 199268.4, close: 0, parent: "TDS"}}}});
  const sg = x.TDSMatch.suggestNow("26Q", "2025-26", "Q1");
  ok(!sg.some(s => s.chId === "ch152"), "H7: the 29-Apr-2025 challan of ₹1,99,268 = the ledger's 1-April balance: not offered to 26Q Q1 2025-26 (" + sg.map(s => s.chId + " " + s.rule).join(", ") + ")");
  ok(x.TDSMatch.lastYear && x.TDSMatch.lastYear(ctx.S.books.challans[0]) === "2024-25", "H7: it is said to pay March of 2024-25 (its Q4)");
}
// ---------------------------------------------------------------- H8
{
  const mar = V({type: "Journal", date: "20260331", no: "M-1", party: "Consult LLP", ent: [{l: "Fees", a: -1421010}, {l: "TDS 94J 10%", a: 142101}, {l: "Consult LLP", a: 1278909}]});
  const may = V({type: "Journal", date: "20260520", no: "N-1", party: "Consult LLP", ent: [{l: "Fees", a: -10000}, {l: "TDS 94J 10%", a: 1000}, {l: "Consult LLP", a: 9000}]});
  const c = ch("chmvd92h6ndjpm8", "20260430", 142101, "194J");
  books([mar, may], {challans: [c, ch("chmay", "20260607", 1000, "194J")]});
  x.TDSCH.tag([may.id + "|TDS 94J 10%"], "chmay", {nosave: true});
  const r = x.TDSReg.setPortion("chmvd92h6ndjpm8", "26Q", "2026-27", "Q1", 0, 16200, {nosave: true});
  ok(r && !r.ok && /own deductions|March/i.test(r.why || ""), "H8: ₹16,200 of the March challan as Q1 2026-27's fee, its March deductions not on it: refused (" + JSON.stringify(r) + ")");
  x.TDSCH.tag([mar.id + "|TDS 94J 10%"], "chmvd92h6ndjpm8", {nosave: true});
  const r2 = x.TDSReg.setPortion("chmvd92h6ndjpm8", "26Q", "2026-27", "Q1", 0, 16200, {nosave: true});
  ok(r2 && !r2.ok, "H8: its own deductions on it, nothing is left over for a fee: refused as before (" + (r2 && r2.why) + ")");
}
// ---------------------------------------------------------------- M2
{
  const {tmRules} = ctx.__tm;
  const rows = [{id: "r1", sec: "194C", date: "20250715", tds: 500.40, fy: "2025-26", q: "Q2"}, {id: "r2", sec: "194C", date: "20250720", tds: 500.20, fy: "2025-26", q: "Q2"}];
  const S = tmRules(rows, [{id: "c1", sec: "194C", date: "20250807", minor: "200", bal: 1001, fy: "2025-26", label: "07-Aug"}], {fy: "2025-26", q: "Q2", today: "20261022"});
  ok(S.some(s => s.rule === "b" && s.chId === "c1" && s.ids.length === 2), "M2: July 194C ₹1,000.60 against a challan of ₹1,001: rule b, exact within ₹1 (" + S.map(s => s.rule).join(",") + ")");
}
// ---------------------------------------------------------------- M6
{
  const late = V({type: "Journal", date: "20250520", no: "L-1", party: "Builder Co", ent: [{l: "Contract Exp", a: -100000}, {l: "TDS 94C", a: 2000}, {l: "Builder Co", a: 98000}]});
  books([late], {challans: [ch("chl", "20250710", 2000, "194C", {interest: 90})]});
  x.TDSCH.tag([late.id + "|TDS 94C"], "chl", {nosave: true});
  const c = ctx.S.books.challans[0], p = x.TDSReg.portionFor(c, "26Q", "2025-26", "Q1");
  ok(p.interest === 60 || p.interest === 90, "M6: the challan's interest goes to the return whose late deduction is on it, without a person allocating it (" + p.interest + ")");
}
// ---------------------------------------------------------------- N9
{
  const p92 = V({type: "Payment", date: "20260430", no: "92", party: "DBS BANK(513)", narr: "DTAX", ent: [{l: "TDS 94C", a: -192270}, {l: "DBS BANK(513)", a: 192270}]});
  const p64 = V({type: "Payment", date: "20260430", no: "64", party: "DBS BANK(513)", ent: [{l: "TDS 194 T", a: -360000}, {l: "DBS BANK(513)", a: 360000}]});
  const d = V({type: "Journal", date: "20260310", no: "B-9", party: "Builder Co", ent: [{l: "Contract Exp", a: -164700}, {l: "TDS 94C", a: 3294}, {l: "Builder Co", a: 161406}]});
  books([p92, p64, d]);
  const notes = x.TDSAudit.notes("2026-27", "Q1", "26Q").filter(z => z.k === "payover");
  ok(notes.some(z => /194C/.test(z.words) && /1,92,270/.test(z.words) && /3,294/.test(z.words)), "N9: 194C paid ₹1,92,270 against ₹3,294 deducted: said (" + notes.map(z => z.words).join(" | ") + ")");
  ok(notes.some(z => /194T/.test(z.words) && /3,60,000/.test(z.words)), "N9: 194T paid ₹3,60,000 with nothing deducted: said");
}
// ---------------------------------------------------------------- L2
{
  const sal = V({type: "Payment", date: "20250507", no: "S20", party: "DBS BANK(513)", ent: [{l: "TDS 192B", a: -50000}, {l: "DBS BANK(513)", a: 50000}]});
  books([sal]);
  const tp = x.TDSMatch.tallyPays("2025-26", "Q1");
  ok(tp.some(p => p.vid === sal.id && p.sections.includes("192")), "L2: a Tally payment of TDS 192B is named for the 192 deductions (" + JSON.stringify(tp.map(p => p.sections)) + ")");
}

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
