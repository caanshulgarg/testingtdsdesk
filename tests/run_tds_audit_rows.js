// node run_tds_audit_rows.js - the TDS check of 22-Oct-2026 (scratchpad tds-audit: the owner's audit, H1-H9, M1-M9, L1-L3,
// and the independent review, N1-N14), the deduction rows. Each part is shaped like the entry the audit found in a client's
// books (Leads Insurance, Testing AAD); names and figures made up or taken as the audit gives them.
//   H1  "Paid" from the expense (or Tally's assessable amount), not worked back from the ledger's rate: Journal 07 of
//       10-Apr-2026, Consultancy Fee 85,815, TDS 8,582 on "TDS 94J 2%": paid 85,815 at 10%, "10% deducted on a 2% ledger",
//       no short deduction; 28-Apr-2025 the same (20,158, TDS 2,016)
//   N4  Tally rounds the TDS: 85,815 at 10% is 8,581.50, booked 8,582 on the 10% ledger: paid 85,815 (not 85,820)
//   H1  Tally's assessable amount (tally_tds_details_marked) where it has one for the entry's TDS
//   H2  optional and cancelled entries are no deductions, payments or collections (ASG/25-26/007 of 01-Oct-2025 twice)
//   H5  ESIC under "Not TDS" (N8: kind tds_payable, section 192 left in the map) is no salary TDS; "TDS 192B" stays TDS
//   N3  a bank payment carrying the expense and the TDS: the bank is never the deductee; an advance with TDS: paid the gross
//   M3  a TDS top-up booked as an expense with no party: no paid amount invented (was 30,001 at 10%)
//   H4  a TDS ledger debited against the party (no bank): the deduction reduced; a filed quarter's: a correction listed
//   N11 194LBB / 194LBC of a resident in 26Q, not 27Q
//   N5  TCS collected in March is due by 7 April (TDS: 30 April)
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "TDSSep", "GSTIN_RE", "TDSFiled", "ClosedP",
  "BOOKS_KEYS", "AuditWP", "TDSWatch", "TDSTally", "noPanRate", "NO_PAN_RATE", "AIH", "istParts", "p2ist", "istDay", "istToday", "TDSAdj", "TDSReg", "TDSCH", "Payroll", "TDS24Q", "TDSAudit", "payTdsHead", "TDS26Q", "TDS_FORMS", "TCS27EQ", "PAY_CODES"];
const avail = NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } });
const {ctx, x} = load(HTML, avail);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.saveBooks = () => {}; ctx.whoAmI = () => "t"; ctx.S.data = {}; ctx.render = () => {}; ctx.toast = () => {};

let n = 0;
const V = (o) => Object.assign({id: "a" + (++n), no: "", ref: "", party: "", narr: "", upd: o.date}, o);
const UNDER = {"Consultancy Fee": "Indirect Expenses", "Accounting Fees": "Indirect Expenses", "Rent": "Indirect Expenses", "Repairs": "Indirect Expenses", "Miscellaneous Expenses": "Indirect Expenses",
  "Round Off": "Indirect Expenses", "TDS 94J 2%": "TDS", "TDS 94J 10%": "TDS", "TDS on Rent 94I": "TDS", "TDS 94C": "TDS", "TDS 192B": "TDS", "ESIC Employee Contribution": "Current Liabilities",
  "TDS": "Duties & Taxes", "DBS BANK(513)": "Bank Accounts", "KIRAN SRIVASTAVA": "Sundry Creditors", "ALOK SWAROOP GUPTA": "Sundry Creditors", "Vendor One": "Sundry Creditors",
  "Mehta Builders": "Sundry Creditors", "Salary Payable": "Current Liabilities", "Salary": "Indirect Expenses", "Unit Trust": "Sundry Creditors", "TDS 194LBB": "TDS",
  "Scrap Sales": "Sales Accounts", "Scrap Buyer": "Sundry Debtors", "TCS 206C": "Duties & Taxes"};
const GROUPS = {"Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets", "Duties & Taxes": "Current Liabilities", "TDS": "Duties & Taxes", "Indirect Expenses": "", "Bank Accounts": "Current Assets",
  "Current Liabilities": "", "Current Assets": "", "Sales Accounts": ""};
const PANS = {"KIRAN SRIVASTAVA": "ABCPS1234K", "ALOK SWAROOP GUPTA": "AAAPG1234A", "Vendor One": "AABCV1234V", "Mehta Builders": "AABFM1234M", "Unit Trust": "AAATU1234T", "Scrap Buyer": "AABCS1234S"};
const MAP = {"TDS 94J 2%": {kind: "tds_payable", section: "194J", rate: 2}, "TDS 94J 10%": {kind: "tds_payable", section: "194J", rate: 10}, "TDS on Rent 94I": {kind: "tds_payable", section: "194I", rate: 10},
  "TDS 94C": {kind: "tds_payable", section: "194C"}, "TDS 192B": {kind: "tds_payable", section: "192B", payTds: false}, "TDS 194LBB": {kind: "tds_payable", section: "194LBB"},
  "ESIC Employee Contribution": {kind: "tds_payable", section: "192", payTds: false}, "DBS BANK(513)": {kind: "bank"}, "Round Off": {kind: "roundoff"}, "TCS 206C": {kind: "tcs_payable", section: "206C"}};
const co = {id: "ca", name: "TDS Audit Fixture"};
ctx.S.coId = "ca"; ctx.S.companies = {ca: co}; ctx.CO = () => co;
function books(vs, o){
  o = o || {};
  const b = {cid: "ca", vouchers: vs, meta: {from: "20250401", to: "20270331", bills: 1}, under: o.noMasters ? {} : UNDER, groups: o.noMasters ? {} : GROUPS,
    ledInfo: Object.fromEntries(Object.keys(UNDER).map(l => [l, {ob: 0, from: "20250401"}])), pans: Object.assign({}, PANS), challans: o.challans || [], alloc: o.alloc || {}, certs: [], tdsFiled: o.filed || {}};
  ctx.S.books = b;
  const m = {}; Object.entries(MAP).forEach(([k, v]) => { m[k] = Object.assign({byHand: true, ok: true}, v); });
  b.map = x.Books.mapLedgers(vs, m);
  if (x.TDSReg && x.TDSReg.forget) x.TDSReg.forget();
  return b;
}
const show = (r) => r ? [r.party || "(blank)", r.pan || "-", r.section, r.paid, r.rate, r.tds, r.rateFrom || ""].join(" | ") : "no row";
const rowsOf = (v) => x.TDS.allRows().filter(r => String(r.id).split("|")[0] === v.id);

// ---------------------------------------------------------------- H1, N4, N14
{
  const kiran = V({type: "Journal", date: "20260410", no: "07", party: "KIRAN SRIVASTAVA", ent: [{l: "Consultancy Fee", a: -85815}, {l: "TDS 94J 2%", a: 8582}, {l: "KIRAN SRIVASTAVA", a: 77233}]});
  const apr25 = V({type: "Journal", date: "20250428", no: "J-12", party: "KIRAN SRIVASTAVA", ent: [{l: "Consultancy Fee", a: -20158}, {l: "TDS 94J 2%", a: 2016}, {l: "KIRAN SRIVASTAVA", a: 18142}]});
  const tenPct = V({type: "Journal", date: "20260415", no: "08", party: "KIRAN SRIVASTAVA", ent: [{l: "Consultancy Fee", a: -85815}, {l: "TDS 94J 10%", a: 8582}, {l: "KIRAN SRIVASTAVA", a: 77233}]});
  const twoPct = V({type: "Journal", date: "20260420", no: "09", party: "Vendor One", ent: [{l: "Consultancy Fee", a: -50580}, {l: "TDS 94J 2%", a: 1012}, {l: "Vendor One", a: 49568}]});
  // a rated ledger with nothing in the entry to read the amount paid from: the ledger's rate, as before
  const lone = V({type: "Journal", date: "20260425", no: "10", party: "Vendor One", ent: [{l: "Vendor One", a: -500}, {l: "TDS 94J 10%", a: 500}]});
  books([kiran, apr25, tenPct, twoPct, lone]);
  const k = rowsOf(kiran)[0];
  ok(k && k.paid === 85815 && k.rate === 10 && k.tds === 8582, "H1: 10% on the 2% ledger: paid 85,815 at 10% (was 4,29,100 at 2%) (" + show(k) + ")");
  ok(k && k.ledgerRate === 2, "H1: the row says the ledger's rate apart: \"10% deducted on a 2% ledger\" (ledgerRate " + (k && k.ledgerRate) + ")");
  const iss = x.Certs.issues("2026-27", "Q1").filter(i => i.row.id === k.id);
  ok(!iss.length, "H1: no short deduction said for it (was ₹34,328 short) (" + JSON.stringify(iss.map(i => [i.expected, i.short])) + ")");
  const a = rowsOf(apr25)[0];
  ok(a && a.paid === 20158 && a.rate === 10 && a.ledgerRate === 2, "H1: 28-Apr-2025, 20,158 with TDS 2,016 on the 2% ledger: paid 20,158 at 10% (was 1,00,800) (" + show(a) + ")");
  const t = rowsOf(tenPct)[0];
  ok(t && t.paid === 85815 && t.rate === 10 && t.ledgerRate == null, "N4: TDS 8,582 rounded by Tally on the 10% ledger: paid 85,815 (was 85,820), no ledger note (" + show(t) + ")");
  const w = rowsOf(twoPct)[0];
  ok(w && w.paid === 50580 && w.rate === 2, "N4: 2% ledger, TDS 1,012 on 50,580: paid 50,580 (was 50,600) (" + show(w) + ")");
  const l = rowsOf(lone)[0];
  ok(l && l.tds === 500, "H1: nothing in the entry to read it from: the ledger's rate is the last resort (" + show(l) + ")");
  // Tally's assessable amount, where Tally has one for the entry's TDS (tally_tds_details_marked, TCloud.tdsLines)
  const rent = V({type: "Journal", date: "20260501", no: "R-5", party: "ALOK SWAROOP GUPTA", ent: [{l: "Rent", a: -60000}, {l: "TDS on Rent 94I", a: 5000}, {l: "ALOK SWAROOP GUPTA", a: 55000}]});
  books([rent]);
  ctx.TCloud = {tdsl: {ca: {rows: [{guid: rent.id, line_no: 2, ledger: "ALOK SWAROOP GUPTA", party: "ALOK SWAROOP GUPTA", nature: "Rent", assessable: 50000, amount: 5000, rate: 10, exempt: false}]}}, tdsLines(){ return this.tdsl.ca; }};
  const r = rowsOf(rent)[0];
  ok(r && r.paid === 50000 && r.rate === 10 && r.rateFrom === "tally", "H1: Tally's assessable amount first: 50,000 (the rent is 60,000; Tally says 50,000 was the base) (" + show(r) + ")");
  delete ctx.TCloud;
}
// ---------------------------------------------------------------- H2
{
  const mk = (opt) => V({type: "Journal", date: "20251001", no: "ASG/25-26/007", party: "ALOK SWAROOP GUPTA", opt, ent: [{l: "Rent", a: -79840}, {l: "TDS on Rent 94I", a: 7984}, {l: "ALOK SWAROOP GUPTA", a: 71856}]});
  const reg = mk(false), opt = mk(true), canc = Object.assign(mk(false), {cancel: true});
  const pay = V({type: "Payment", date: "20251007", no: "P-1", party: "DBS BANK(513)", opt: true, ent: [{l: "TDS on Rent 94I", a: -7984}, {l: "DBS BANK(513)", a: 7984}]});
  const tcs = V({type: "Sales", date: "20251010", no: "S-1", party: "Scrap Buyer", opt: true, ent: [{l: "Scrap Buyer", a: -101000}, {l: "Scrap Sales", a: 100000}, {l: "TCS 206C", a: 1000}]});
  books([reg, opt, canc, pay, tcs]);
  const q3 = x.TDS.rows().filter(r => r.fy === "2025-26" && r.q === "Q3");
  ok(q3.length === 1 && q3[0].tds === 7984, "H2: ASG/25-26/007 in the books twice (one optional) and once cancelled: one deduction, ₹7,984 (got " + q3.length + ", ₹" + q3.reduce((s, r) => s + r.tds, 0) + ")");
  ok(!x.TDS.paymentsFromBooks().some(p => p.vid === pay.id), "H2: an optional TDS payment is no payment");
  ok(!x.TDS.tcsRows().some(r => String(r.id).startsWith(tcs.id + "|")), "H2: an optional sale's TCS is no collection");
}
// ---------------------------------------------------------------- H5 / N8
{
  const pr = V({type: "Payroll", date: "20260131", no: "35", party: "Salary Payable", ent: [{l: "Salary", a: -100000}, {l: "ESIC Employee Contribution", a: 1226}, {l: "TDS 192B", a: 9000}, {l: "Salary Payable", a: 89774}]});
  books([pr]);
  const L = x.Books.lines(pr);
  ok(!L.tds.some(t => t.ledger === "ESIC Employee Contribution"), "H5: ESIC under \"Not TDS\" is no TDS line (" + L.tds.map(t => t.ledger + " " + t.amount).join(", ") + ")");
  ok(L.tds.some(t => t.ledger === "TDS 192B" && t.amount === 9000), "H5: \"TDS 192B\", marked Not TDS too, stays the salary TDS (its name says TDS)");
  const sal = x.TDS.salaryRows().filter(r => r.fy === "2025-26" && r.q === "Q4"), st = sal.reduce((s, r) => s + r.tds, 0);
  ok(Math.abs(st - 9000) < 0.01, "H5: 24Q Q4's salary TDS is the TDS 192B credit alone: ₹9,000 (got ₹" + st + ")");
  if (x.payTdsHead){
    x.payTdsHead("ESIC Employee Contribution", false);
    const m = ctx.S.books.map["ESIC Employee Contribution"];
    ok(m.kind !== "tds_payable" && m.payTds === false, "N8: \"Not TDS\" on a pay head whose name is no TDS takes it off the TDS ledgers (kind \"" + m.kind + "\")");
    x.payTdsHead("TDS 192B", false);
    ok(ctx.S.books.map["TDS 192B"].kind === "tds_payable", "N8: \"Not TDS\" on \"TDS 192B\" leaves the books' own TDS ledger as it is");
  }
}
// ---------------------------------------------------------------- N3
{
  const rep = V({type: "Payment", date: "20260705", no: "209", party: "DBS BANK(513)", ent: [{l: "Repairs", a: -50000}, {l: "TDS 94C", a: 1000}, {l: "DBS BANK(513)", a: 49000}]});
  const adv = V({type: "Payment", date: "20260706", no: "210", party: "DBS BANK(513)", ent: [{l: "Mehta Builders", a: -100000}, {l: "TDS 94C", a: 2000}, {l: "DBS BANK(513)", a: 98000}]});
  books([rep, adv]);
  const r = rowsOf(rep)[0], a = rowsOf(adv)[0];
  ok(r && r.party !== "DBS BANK(513)" && !r.pan, "N3: the expense paid from the bank with TDS: the bank is not the deductee (" + show(r) + ")");
  ok(r && r.paid === 50000, "N3: what was paid is the expense, 50,000 (" + show(r) + ")");
  ok(a && a.party === "Mehta Builders" && a.paid === 100000, "N3: an advance with TDS and no bill: deductee the party, paid 1,00,000, never 0.00 (" + show(a) + ")");
}
// ---------------------------------------------------------------- M3
{
  const top = V({type: "Journal", date: "20260430", no: "", party: "", ent: [{l: "Miscellaneous Expenses", a: -3000.10}, {l: "TDS 94J 10%", a: 3000.10}]});
  books([top]);
  const r = rowsOf(top)[0];
  ok(r && !(r.paid > 0) && r.tds === 3000.1, "M3: a TDS top-up booked as an expense: no paid amount invented (was 30,001 at 10%) (" + show(r) + ")");
  ok(r && r.topUp === true, "M3: marked a top-up, to be put with the deduction it tops up");
  if (x.TDSAudit){
    const notes = x.TDSAudit.notes("2026-27", "Q1", "26Q").filter(z => z.k === "topup");
    ok(notes.length === 1 && /which deduction/i.test(notes[0].words), "M3: Validate asks which deduction it tops up (" + (notes[0] && notes[0].words) + ")");
  }
}
// ---------------------------------------------------------------- H4
{
  const ded = V({type: "Journal", date: "20250515", no: "B-1", party: "Vendor One", ent: [{l: "Repairs", a: -50000}, {l: "TDS 94C", a: 1000}, {l: "Vendor One", a: 49000}]});
  const back = V({type: "Journal", date: "20250610", no: "R-1", party: "Vendor One", narr: "TDS reversed: bill disputed", ent: [{l: "TDS 94C", a: -400}, {l: "Vendor One", a: 400}]});
  books([ded, back]);
  const q1 = x.TDS.rows().filter(r => r.fy === "2025-26" && r.q === "Q1"), t1 = q1.reduce((s, r) => s + r.tds, 0);
  ok(Math.abs(t1 - 600) < 0.01, "H4: TDS 94C debited back without the bank: 26Q Q1's TDS ₹600, not ₹1,000 (got ₹" + t1 + ")");
  const d = q1.find(r => r.party === "Vendor One");
  ok(d && d.paid === 30000 && d.reversed && d.reversed.amount === 400, "H4: the deduction's amount paid in proportion (30,000) and the reversal named on it (" + show(d) + ")");
  // the deduction's quarter filed: the reversal later is a correction of that return, listed, not taken off a later one
  const back2 = V({type: "Journal", date: "20250720", no: "R-2", party: "Vendor One", ent: [{l: "TDS 94C", a: -400}, {l: "Vendor One", a: 400}]});
  books([ded, back2], {filed: {"2025-26|Q1|26Q": {on: "20250715", prn: "123456789012345"}}});
  const filed = x.TDSFiled && x.TDSFiled.get ? x.TDSFiled.get("2025-26", "Q1", "26Q") : null;
  const q1b = x.TDS.rows().filter(r => r.fy === "2025-26" && r.q === "Q1"), corr = x.TDS.reversals ? x.TDS.reversals() : [];
  ok(!filed || (q1b.reduce((s, r) => s + r.tds, 0) === 1000 && corr.some(c => c.vid === back2.id && c.filed)), "H4: Q1 filed: its deduction stays ₹1,000 and the reversal is listed as a correction of 26Q Q1 2025-26 (" + JSON.stringify(corr.map(c => [c.vid, c.fy, c.q, c.filed, c.amount])) + ")");
}
// ---------------------------------------------------------------- N11
{
  const lbb = V({type: "Journal", date: "20250710", no: "U-1", party: "Unit Trust", ent: [{l: "Repairs", a: -10000}, {l: "TDS 194LBB", a: 1000}, {l: "Unit Trust", a: 9000}]});
  books([lbb]);
  ok(x.TDS.rows().some(r => r.section === "194LBB") && !x.TDS.nrRows().some(r => r.section === "194LBB"), "N11: 194LBB of a resident goes in 26Q, not 27Q");
  ok(x.TDS.NR.test("194LB") && x.TDS.NR.test("195") && !x.TDS.NR.test("194LBC"), "N11: 194LB (non-residents) still 27Q; 194LBC not");
}
// ---------------------------------------------------------------- N5
{
  ok(x.TDS.dueDate("20260315") === "20260430", "N5: TDS deducted in March: due 30 April");
  ok(x.TDS.dueDate("20260315", "27EQ") === "20260407", "N5: TCS collected in March: due 7 April (" + x.TDS.dueDate("20260315", "27EQ") + ")");
}

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
