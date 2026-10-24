// node run_tds_party.js - TDS when the party's name on an entry differs from its ledger (the GSTR-1 fix of 22-Oct-2026,
// Books.partyEnts, left TDS reading the party by that name). Tally keeps the voucher's party name apart from the ledger
// credited: Leads' bills from "Garg Shekhar & Co." credit the ledger "Garg Shekhar & Company" (Sundry Creditors, PAN in
// Tally), Testing AAD's from "Fingate Advisory" credit "Fingate Advisory Services Limited". FinCom took the deductee as
// the name, so the PAN (kept on the ledger) was not found, the same deductee was two in the return, and the checks that
// look for the party's line by that name (TDSInt, TDSSep, TDSWatch, TDSRate.payType) missed the bill. Now the deductee is
// the party's ledger by structure (TDS.led: the ledger named as the party where the entry has it, else Books.partyEnts,
// else the one line under Sundry Creditors/Debtors or with a bill allocation, else the name as before).
// Made-up names and figures, shaped like those books, FY 2025-26.
//   1. a bill (journal with GST) whose party name differs from its creditor ledger: deductee the ledger, its PAN, paid the fee
//   2. the same party's bill named as the ledger: one deductee in the return, not two
//   3. a payment with TDS (no tax; the party debited) whose party name differs: deductee the ledger (what it was paid on
//      comes from the bill it is matched to, as for any TDS entry of its own: TDSSep)
//   4. a bill booked without TDS (name differs, no masters: the bill allocation tells the line) and the TDS in a journal of
//      its own a month later: the journal is matched to the bill (paid = the bill's fee, its date)
//   5. TDSWatch: the bill with the differing name counts for the party (credited), and its deduction covers it
//   6. TDS.adjOnly (f0d4ccd88): the round-off journal is still no deduction; the quarter's TDS is the deductions only
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "TDSSep", "GSTIN_RE", "TDSFiled", "ClosedP",
  "BOOKS_KEYS", "AuditWP", "TDSWatch", "TDSTally", "noPanRate", "NO_PAN_RATE", "AIH", "istParts", "p2ist", "istDay", "istToday", "TDSAdj"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.saveBooks = () => {}; ctx.whoAmI = () => "t"; ctx.S.data = {};

let n = 0;
const V = (o) => Object.assign({id: "p" + (++n), no: "", ref: "", party: "", narr: "", upd: o.date}, o);
const GS = "Garg Shekhar & Company", GS_NAME = "Garg Shekhar & Co.", RAO = "Rao Consultants LLP", KITE = "Kite Estates LLP-UP";
// 1. Leads' shape: Accounting Fees Dr 25,000, Input CGST/SGST Dr 2,250 each, TDS 94J 10% Cr 2,500, the creditor Cr 27,000
const bill1 = V({type: "Journal", date: "20250430", no: "2025-26/GST/049", party: GS_NAME,
  ent: [{l: "Accounting Fees", a: -25000}, {l: "Input CGST", a: -2250}, {l: "Input SGST", a: -2250}, {l: "TDS 94J 10%", a: 2500}, {l: GS, a: 27000}]});
// 2. the same party, its ledger named as the party
const bill2 = V({type: "Journal", date: "20250531", no: "2025-26/GST/105", party: GS,
  ent: [{l: "Accounting Fees", a: -10000}, {l: "Input CGST", a: -900}, {l: "Input SGST", a: -900}, {l: "TDS 94J 10%", a: 1000}, {l: GS, a: 10800}]});
// 3. a payment with TDS: the party debited the gross 20,000, the bank credited 18,000, TDS 2,000 (194J at 10%)
const pay3 = V({type: "Payment", date: "20250610", no: "P-11", party: "Rao Consultants",
  ent: [{l: RAO, a: -20000}, {l: "HDFC Bank", a: 18000}, {l: "TDS 94J 10%", a: 2000}]});
// 6. the round-off journal (f0d4ccd88): no party, the TDS ledger and Round Off only
const ro6 = V({type: "Journal", date: "20250401", ent: [{l: "Round Off", a: -0.71}, {l: "TDS 94J 10%", a: 0.71}]});
const under = {"Accounting Fees": "Indirect Expenses", "Round Off": "Indirect Expenses", "TDS 94J 10%": "TDS", "TDS": "Duties & Taxes", "Input CGST": "Duties & Taxes", "Input SGST": "Duties & Taxes",
  "HDFC Bank": "Bank Accounts", [GS]: "Sundry Creditors", [RAO]: "Sundry Creditors", "Office Rent": "Indirect Expenses", [KITE]: "Sundry Creditors", "TDS 94I": "TDS"};
const groups = {"Sundry Creditors": "Current Liabilities", "Duties & Taxes": "Current Liabilities", "TDS": "Duties & Taxes", "Indirect Expenses": "", "Bank Accounts": "", "Current Liabilities": ""};
const PANS = {[GS]: "AANFG1234D", [RAO]: "AAPFR1234R", [KITE]: "AAJFK1234K"};
const co = {id: "cp", name: "Party TDS Fixture"};
ctx.S.coId = "cp"; ctx.S.companies = {cp: co}; ctx.CO = () => co;
function books(vs, masters){
  const b = {cid: "cp", vouchers: vs, meta: {from: "20250401", to: "20260331", bills: 1}, under: masters === false ? {} : under, groups: masters === false ? {} : groups,
    ledInfo: Object.fromEntries(Object.keys(under).map(l => [l, {ob: 0, from: "20250401"}])), pans: Object.assign({}, PANS), challans: [], alloc: {}, certs: []};
  ctx.S.books = b;
  b.map = x.Books.mapLedgers(vs, {"TDS 94J 10%": {kind: "tds_payable", section: "194J", rate: 10, byHand: true}, "TDS 94I": {kind: "tds_payable", section: "194I", byHand: true},
    "Input CGST": {kind: "gst", tax: "CGST", side: "input", reg: "09", byHand: true}, "Input SGST": {kind: "gst", tax: "SGST", side: "input", reg: "09", byHand: true},
    "HDFC Bank": {kind: "bank", byHand: true}, "Round Off": {kind: "roundoff", byHand: true}});
  return b;
}
const show = (r) => r ? [r.party || "(blank)", r.pan || "(no PAN)", r.section, r.paid, r.rate, r.tds].join(" | ") : "no row";
const rowOf = (rows, v) => rows.filter(r => String(r.id).split("|")[0] === v.id);

// ---------------------------------------------------------------- 1-3, 6: the deductee, its PAN and the amount paid
{
  books([ro6, bill1, bill2, pay3]);
  const rows = x.TDS.allRows();
  console.log("  rows: " + rows.map(show).join("; "));
  const r1 = rowOf(rows, bill1)[0];
  ok(r1 && r1.party === GS && r1.pan === PANS[GS], "1. a bill from \"" + GS_NAME + "\" crediting the ledger \"" + GS + "\": the deductee is the ledger, with its PAN (" + show(r1) + ")");
  ok(r1 && r1.paid === 25000 && r1.tds === 2500 && r1.rate === 10 && r1.section === "194J", "1. paid 25,000 (the fee, not the creditor's 27,000), TDS 2,500 at 10%, 194J (" + show(r1) + ")");
  const r2 = rowOf(rows, bill2)[0];
  const who = new Set(x.TDS.rows().filter(r => r.fy === "2025-26" && r.q === "Q1" && /Garg/.test(r.party)).map(r => r.party));
  ok(r2 && r2.party === GS && who.size === 1, "2. the bill naming the ledger: the same deductee; one deductee for the party in 26Q Q1, not two (" + Array.from(who).join(", ") + ")");
  const r3 = rowOf(rows, pay3)[0];
  ok(r3 && r3.party === RAO && r3.pan === PANS[RAO], "3. a payment to \"Rao Consultants\" debiting \"" + RAO + "\": the deductee is the ledger, with its PAN (" + show(r3) + ")");
  ok(x.TDS.adjOnly(ro6) && !rowOf(rows, ro6).length, "6. TDS.adjOnly: the round-off journal (no party, TDS ledger and Round Off) is still no deduction");
  const q1 = x.TDS.rows().filter(r => r.fy === "2025-26" && r.q === "Q1");
  ok(Math.abs(q1.reduce((a, r) => a + r.tds, 0) - 5500) < 0.005 && !q1.some(r => !r.party), "6. 26Q Q1's TDS is the three deductions, ₹5,500 (not ₹5,500.71), each with its deductee (" + q1.reduce((a, r) => a + r.tds, 0) + ")");
}
// ---------------------------------------------------------------- 4: the TDS in an entry of its own, the bill's name differs
{
  const bill4 = V({type: "Journal", date: "20250705", no: "R-77", party: "Kite Estates",
    ent: [{l: "Office Rent", a: -60000}, {l: KITE, a: 60000, b: [["R-77", "New Ref", 60000]]}]});
  const tds4 = V({type: "Journal", date: "20250805", no: "J-31", party: "Kite Estates", narr: "TDS on rent, July",
    ent: [{l: KITE, a: -6000, b: [["R-77", "Agst Ref", -6000]]}, {l: "TDS 94I", a: 6000}]});
  books([bill4, tds4], false);
  const r = rowOf(x.TDS.allRows(), tds4)[0];
  ok(r && r.party === KITE && r.pan === PANS[KITE], "4. the TDS journal's deductee is the ledger debited, \"" + KITE + "\" (" + show(r) + ")");
  ok(r && r.paid === 60000 && x.TDS.ymd(r.credit) === "20250705" && /^bill/.test(r.rateFrom || ""), "4. matched to the bill booked under the name \"Kite Estates\" (no masters: its bill allocation): paid 60,000, credited 05-Jul-2025 (" + show(r) + ", " + r.credit + ", " + r.rateFrom + ")");
}
// ---------------------------------------------------------------- 5: the limits check counts the bill for its party
{
  const big = V({type: "Journal", date: "20250815", no: "2025-26/GST/241", party: GS_NAME,
    ent: [{l: "Accounting Fees", a: -60000}, {l: "Input CGST", a: -5400}, {l: "Input SGST", a: -5400}, {l: "TDS 94J 10%", a: 6000}, {l: GS, a: 64800}]});
  books([big]);
  const w = x.TDSWatch.year("2025-26").filter(z => z.party === GS);
  ok(w.length === 1 && w[0].credited === 60000, "5. TDSWatch: the bill from \"" + GS_NAME + "\" is " + GS + "'s, credited 60,000 (" + JSON.stringify(w.map(z => [z.party, z.credited])) + ")");
  ok(w.length === 1 && !(w[0].uncovered > 0), "5. its deduction (same deductee) covers it: nothing uncovered (" + JSON.stringify(w.map(z => z.uncovered)) + ")");
}

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
