// node run_tds_separate.js - the owner, 19-Oct-2026: "you have shown TDS not deducted case at the top but TDS was deducted
// over it ... in India people sometimes book the bill in one entry without TDS and the TDS in another entry".
// A bill booked without TDS is covered when its TDS is booked in an entry of its own (a journal, or the payment) that
// credits a TDS ledger and debits the same party, dated from the bill's day (an earlier entry of the same day too) to the
// end of its financial year (a March bill to 30 April). The entry is matched to its bills (TDSSep, src/js/66):
//   (a) the bill named: bill-wise Agst Ref on the party's line, or the bill's number in the narration;
//   (b) the same party, the TDS ≈ the rate × the bill (within ₹1 or 1%), of the bill's section;
//   (c) the same party, a month's bills together (several bills' TDS in one journal).
// A covered bill is not "TDS not deducted"; one covered in part (named, but its TDS short) is "short deducted" by the short
// amount only: both in the Audit alone. The TDS entry is a deduction row of the return with the bill's date (date of
// payment or credit) and its amount paid; a bill that carries its own TDS is never counted again.
// Made-up books, FY 2025-26, one party for each case.
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "TDSSep", "GSTIN_RE", "TDSFiled", "ClosedP",
  "BOOKS_KEYS", "AuditWP", "TDSWatch", "TDSTally", "noPanRate", "NO_PAN_RATE", "AIH", "istParts", "p2ist", "istDay", "istToday"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.saveBooks = () => {}; ctx.whoAmI = () => "t"; ctx.S.data = {};

const V = []; let n = 0;
const add = (o) => { const v = Object.assign({id: "s" + (++n), no: String(n), ref: "", party: "", narr: "", upd: o.date}, o); V.push(v); return v; };
// a bill without TDS: the expense debited, the party credited (with its bill-wise New Ref where given)
const bill = (date, party, ledger, amt, ref) => add({type: "Journal", date, party, ref: ref || "", ent: [{l: ledger, a: -amt}, Object.assign({l: party, a: amt}, ref ? {b: [[ref, "New Ref", amt]]} : {})]});
// a TDS entry of its own: the party debited, the TDS ledger credited
const tdsJ = (date, party, ledger, amt, o) => add(Object.assign({type: "Journal", date, ent: [Object.assign({l: party, a: -amt}, o && o.agst ? {b: [[o.agst, "Agst Ref", -amt]]} : {}), {l: ledger, a: amt}]}, o && o.v || {}));

// (a) by the bill named: Rao's two bills of 80,000; the TDS of RC-12 (the earlier) booked first, then RC-11's, each naming
// its bill. By amount alone the first would take the later bill (RC-11): the dates of payment would be swapped.
const rc12 = bill("20250701", "Rao Contractors Pvt Ltd", "Contract Charges", 80000, "RC-12");
const rc11 = bill("20250702", "Rao Contractors Pvt Ltd", "Contract Charges", 80000, "RC-11");
const jRa = tdsJ("20250710", "Rao Contractors Pvt Ltd", "TDS on Contract 194C", 1600, {agst: "RC-12"});
const jRb = tdsJ("20250710", "Rao Contractors Pvt Ltd", "TDS on Contract 194C", 1600, {v: {narr: "TDS on bill RC-11"}});
// (b) by amount: Verma's freight of 50,000 and its TDS of 1,000 (2%, a firm) the same day, the TDS entry made first; the
// journal names no party (Tally leaves it blank)
const jV = tdsJ("20250805", "Verma Transport", "TDS on Contract 194C", 1000);
const vb = bill("20250805", "Verma Transport", "Freight Charges", 50000);
// (c) a month together: Iyer's three bills of September (75,000) and one TDS journal of 7,500 (10%) on 30-Sep
const ib1 = bill("20250903", "Iyer Consultants", "Professional Fees", 30000), ib2 = bill("20250912", "Iyer Consultants", "Professional Fees", 25000), ib3 = bill("20250922", "Iyer Consultants", "Professional Fees", 20000);
const jI = tdsJ("20250930", "Iyer Consultants", "TDS on Professional 194J", 7500, {v: {party: "Iyer Consultants", narr: "TDS for September"}});
// partial: Khan's bill of 1,20,000 (a company: 2%, 2,400) and a TDS journal of 1,200 naming it: short by 1,200
const kb = bill("20251103", "Khan Electricals Pvt Ltd", "Electrical Contract", 120000, "KE-5");
const jK = tdsJ("20251115", "Khan Electricals Pvt Ltd", "TDS on Contract 194C", 1200, {agst: "KE-5"});
// the usual case, unchanged: Nair's bill with its TDS in it
const nb = add({type: "Journal", date: "20251201", party: "Nair Builders Pvt Ltd", ent: [{l: "Contract Charges", a: -60000}, {l: "TDS on Contract 194C", a: 1200}, {l: "Nair Builders Pvt Ltd", a: 58800}]});
// the bill carries its TDS and a journal books it again naming the bill: the bill's amount is not counted twice
const db = add({type: "Journal", date: "20251210", party: "Das Movers", ref: "DM-9", ent: [{l: "Transport Charges", a: -50000}, {l: "TDS on Contract 194C", a: 1000}, {l: "Das Movers", a: 49000, b: [["DM-9", "New Ref", 49000]]}]});
const jD = tdsJ("20251212", "Das Movers", "TDS on Contract 194C", 1000, {agst: "DM-9", v: {party: "Das Movers"}});
// a March bill, its TDS booked on 10 April (by the due date of 30 April): covered in 2025-26
const bb = bill("20260325", "Bose Advertising", "Advertisement Charges", 40000);
const jB = tdsJ("20260410", "Bose Advertising", "TDS on Contract 194C", 800);
// truly not deducted: Gupta's labour bill of 50,000, no TDS anywhere (a TDS journal of another party covers nothing here)
const gb = bill("20250815", "Gupta Labour Contractors", "Labour Charges", 50000);

const under = {"Contract Charges": "Indirect Expenses", "Freight Charges": "Direct Expenses", "Professional Fees": "Indirect Expenses", "Electrical Contract": "Indirect Expenses",
  "Transport Charges": "Direct Expenses", "Advertisement Charges": "Indirect Expenses", "Labour Charges": "Direct Expenses",
  "TDS on Contract 194C": "Duties & Taxes", "TDS on Professional 194J": "Duties & Taxes"};
const PARTIES = {"Rao Contractors Pvt Ltd": "AAACR1234C", "Verma Transport": "AAAFV1234V", "Iyer Consultants": "AAAPI1234I", "Khan Electricals Pvt Ltd": "AAACK1234E",
  "Nair Builders Pvt Ltd": "AAACN5678B", "Das Movers": "AAAFD1234D", "Bose Advertising": "AAAFB1234B", "Gupta Labour Contractors": "AAAFG1234G"};
Object.keys(PARTIES).forEach(p => { under[p] = "Sundry Creditors"; });
const b = {cid: "csep", vouchers: V, meta: {from: "20250401", to: "20260430"}, under,
  groups: {"Sundry Creditors": "Current Liabilities", "Duties & Taxes": "Current Liabilities", "Indirect Expenses": "", "Direct Expenses": "", "Current Liabilities": ""},
  ledInfo: Object.fromEntries(Object.keys(under).map(l => [l, {ob: 0, from: "20250401"}])), pans: Object.assign({}, PARTIES), challans: [], alloc: {}};
const co = {id: "csep", name: "Separate TDS Fixture"};
ctx.S.books = b; ctx.S.coId = "csep"; ctx.S.companies = {csep: co}; ctx.CO = () => co;
b.map = x.Books.mapLedgers(b.vouchers, {});

const rows = x.TDS.allRows(), rowOf = (v) => rows.filter(r => String(r.id).split("|")[0] === v.id);
const missed = x.TDSWatch.missed("2025-26"), mOf = (p) => missed.find(e => e.party === p);
console.log("  TDSWatch.missed 2025-26: " + (missed.map(e => e.party + " " + e.section + " ₹" + e.due).join("; ") || "none"));
const show = (r) => r ? [r.party, r.paid, r.rate, r.credit || "-", r.tds].join(" | ") : "no row";

// ---------------------------------------------------------------- the deduction rows of the return
{
  const a = rowOf(jRa)[0], a2 = rowOf(jRb)[0];
  ok(a && a.party === "Rao Contractors Pvt Ltd" && a.paid === 80000 && a.credit === rc12.date && a.rate === 2 && a.tds === 1600, "(a) Agst Ref RC-12: the row takes RC-12's date (1-Jul) and amount (80,000), 2% (" + show(a) + ")");
  ok(a2 && a2.party === "Rao Contractors Pvt Ltd" && a2.paid === 80000 && a2.credit === rc11.date, "(a) the narration names RC-11: the row takes RC-11's date (2-Jul) (" + show(a2) + ")");
  const v = rowOf(jV)[0];
  ok(v && v.party === "Verma Transport" && v.paid === 50000 && v.credit === vb.date && v.rate === 2, "(b) by amount, a journal naming no party, the same day and entered before the bill: Verma, 50,000 at 2% (" + show(v) + ")");
  const i = rowOf(jI)[0];
  ok(i && i.paid === 75000 && i.credit === ib1.date && i.rate === 10 && (i.bills || []).length === 3, "(c) a month's three bills in one journal: 75,000 at 10%, dated from the first bill (3-Sep) (" + show(i) + ", bills " + (i && (i.bills || []).length) + ")");
  const k = rowOf(jK)[0];
  ok(k && k.paid === 120000 && k.credit === kb.date && k.rate === 1, "partial: Khan's row is the bill (1,20,000) at the 1% booked (" + show(k) + ")");
  const nr = rowOf(nb)[0];
  ok(nr && nr.paid === 60000 && !nr.credit && nr.rate === 2 && nr.party === "Nair Builders Pvt Ltd", "the usual case unchanged: Nair's bill row, 60,000 at 2%, its own date (" + show(nr) + ")");
  const d1 = rowOf(db)[0], d2 = rowOf(jD)[0];
  ok(d1 && d1.paid === 50000 && d2 && d2.paid === 0 && rows.filter(r => r.party === "Das Movers").reduce((s, r) => s + r.paid, 0) === 50000,
    "never twice: Das's bill carries its own TDS; the journal naming it adds TDS but not the bill's 50,000 again (" + show(d1) + " / " + show(d2) + ")");
  const bo = rowOf(jB)[0];
  ok(bo && bo.paid === 40000 && bo.credit === bb.date && bo.fy === "2026-27", "a March bill, TDS on 10 April: the row (a 2026-27 deduction) carries the bill of 25-Mar, 40,000 (" + show(bo) + ")");
  ok(!rows.some(r => !r.party), "every row names its deductee (" + rows.filter(r => !r.party).map(show).join("; ") + ")");
}

// ---------------------------------------------------------------- not deducted: none of these, but Gupta and Khan's short
{
  ["Rao Contractors Pvt Ltd", "Verma Transport", "Iyer Consultants", "Nair Builders Pvt Ltd", "Das Movers", "Bose Advertising"].forEach(p =>
    ok(!mOf(p), p + ": covered, not in TDSWatch.missed" + (mOf(p) ? " (said ₹" + mOf(p).due + ")" : "")));
  const k = mOf("Khan Electricals Pvt Ltd");
  ok(k && k.due === 1200 && k.short === true, "Khan: short deducted by ₹1,200 only (2,400 due, 1,200 booked) (" + (k && [k.due, k.short].join(" | ")) + ")");
  const g = mOf("Gupta Labour Contractors");
  ok(g && g.due === 1000 && !g.short, "Gupta: truly not deducted, ₹1,000 (2% of 50,000) (" + (g && g.due) + ")");
  ok(missed.length === 2, "only Khan and Gupta (" + missed.length + ")");
  // the rate check does not say Khan's short a second time
  const iss = x.Certs.issues("2025-26").filter(z => z.row.party === "Khan Electricals Pvt Ltd");
  ok(!iss.length, "Khan's short is said once (the audit's short deducted), not again as a lower rate (" + iss.map(z => z.short).join(",") + ")");
}

// ---------------------------------------------------------------- the audit says them
{
  const run = x.Audit.run("20250401", "20260331", "test"), fs = run.findings.filter(f => f.check === "tdsMissed");
  console.log("  audit: " + fs.map(f => f.title + " ₹" + f.amount).join("; "));
  ok(!run.errors.length, "every check ran" + (run.errors.length ? " (" + run.errors.join("; ") + ")" : ""));
  const k = fs.find(f => f.party === "Khan Electricals Pvt Ltd"), g = fs.find(f => f.party === "Gupta Labour Contractors");
  ok(fs.length === 2 && k && g, "the audit: Khan and Gupta only");
  ok(k && k.amount === 1200 && /short deducted/i.test(k.title) && /short deducted ₹1,200/.test(k.problem), "Khan: \"short deducted ₹1,200\" (" + (k && k.title + " / " + k.problem) + ")");
  ok(g && g.amount === 1000 && /not deducted/.test(g.title), "Gupta: not deducted ₹1,000 (" + (g && g.title) + ")");
  const late = run.findings.filter(f => f.check === "tdsRate");
  ok(!late.some(f => f.rows.some(r => r.party === "Khan Electricals Pvt Ltd")), "no lower-rate finding for Khan as well");
}
console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
