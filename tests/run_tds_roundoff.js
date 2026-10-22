// node run_tds_roundoff.js - the owner, 22-Oct-2026, on Leads Insurance's 26Q Q1 2025-26: a deductee row with no name and
// no PAN, 194J, 01-Apr-2025, paid ₹35.50, TDS ₹0.71 at 2%. "Why there is any blank entry? When tally has every ledger".
// In Tally it is a Journal with no number, party or narration: "TDS 94J 2%" Cr 0.71, Round Off Dr 0.71, a rounding of the
// TDS ledger. FinCom made a deduction of the TDS ledger's line and worked the amount paid back from the ledger's rate
// (0.71 / 2% = 35.50). An entry with no deductee and nothing paid for (every line a TDS ledger, round-off, interest, bank
// or cash; no party) is no deduction (TDS.adjOnly, src/js/09); each is said once on the return's Validate as a note
// (TDSAdj.list, src/js/89): "TDS ledger adjusted without a deductee: Journal 01-Apr-2025, Round Off ₹0.71 — not in the
// return". A normal deduction (in a bill, or a TDS journal naming its party by the party's line) and a TDS payment
// (challan) are unchanged. Made-up books, FY 2025-26.
"use strict";
process.env.TDSDESK_CACHE = process.env.TDSDESK_CACHE || "/dev/null";
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "TDSSep", "GSTIN_RE", "TDSFiled", "ClosedP",
  "BOOKS_KEYS", "AuditWP", "TDSWatch", "TDSTally", "noPanRate", "NO_PAN_RATE", "AIH", "istParts", "p2ist", "istDay", "istToday", "TDSAdj"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.saveBooks = () => {}; ctx.whoAmI = () => "t"; ctx.S.data = {};

const V = []; let n = 0;
const add = (o) => { const v = Object.assign({id: "r" + (++n), no: "", ref: "", party: "", narr: "", upd: o.date}, o); V.push(v); return v; };
// Leads' journal as Tally has it: no number, no party, no narration; the TDS ledger credited 0.71, Round Off debited 0.71
const ro = add({type: "Journal", date: "20250401", ent: [{l: "Round Off", a: -0.71}, {l: "TDS 94J 2%", a: 0.71}]});
// a normal deduction: Mehta's professional fee of 50,000, TDS 1,000 at 2% (194J technical), the party credited the rest
const bill = add({type: "Journal", date: "20250410", no: "J-7", party: "Mehta Tech Services", ent: [{l: "Technical Fees", a: -50000}, {l: "TDS 94J 2%", a: 1000}, {l: "Mehta Tech Services", a: 49000}]});
// a TDS entry of its own naming no party in Tally, the party's line debited (a deduction: the party's line is there)
const tj = add({type: "Journal", date: "20250420", ent: [{l: "Rao Consultants", a: -400}, {l: "TDS 94J 2%", a: 400}]});
const rb = add({type: "Journal", date: "20250420", no: "J-9", party: "Rao Consultants", ent: [{l: "Technical Fees", a: -20000}, {l: "Rao Consultants", a: 20000}]});
// the challan: the TDS ledger debited, the bank credited (a payment, never a deduction)
const pay = add({type: "Payment", date: "20250507", no: "P-3", party: "HDFC Bank", narr: "TDS paid, challan 00123", ent: [{l: "TDS 94J 2%", a: -1000.71}, {l: "HDFC Bank", a: 1000.71}]});

const under = {"Technical Fees": "Indirect Expenses", "Round Off": "Indirect Expenses", "TDS 94J 2%": "TDS", "TDS": "Duties & Taxes", "HDFC Bank": "Bank Accounts",
  "Mehta Tech Services": "Sundry Creditors", "Rao Consultants": "Sundry Creditors"};
const b = {cid: "cro", vouchers: V, meta: {from: "20250401", to: "20260331"}, under,
  groups: {"Sundry Creditors": "Current Liabilities", "Duties & Taxes": "Current Liabilities", "TDS": "Duties & Taxes", "Indirect Expenses": "", "Bank Accounts": "", "Current Liabilities": ""},
  ledInfo: Object.fromEntries(Object.keys(under).map(l => [l, {ob: 0, from: "20250401"}])), pans: {"Mehta Tech Services": "AAACM1234M", "Rao Consultants": "AAAPR1234R"}, challans: [], alloc: {}};
const co = {id: "cro", name: "Round-off TDS Fixture"};
ctx.S.books = b; ctx.S.coId = "cro"; ctx.S.companies = {cro: co}; ctx.CO = () => co;
// "TDS 94J 2%": no section in its name Books.guess can read; Leads' map has it as 194J at 2% (Tally's nature of payment)
b.map = x.Books.mapLedgers(b.vouchers, {"TDS 94J 2%": {kind: "tds_payable", section: "194J", rate: 2, byHand: true}});

const rows = x.TDS.allRows(), rowOf = (v) => rows.filter(r => String(r.id).split("|")[0] === v.id);
const show = (r) => r ? [r.party || "(blank)", r.section, r.paid, r.rate, r.tds].join(" | ") : "no row";
console.log("  rows: " + rows.map(show).join("; "));

// ---------------------------------------------------------------- the round-off journal: no deduction
{
  ok(x.TDS.adjOnly(ro), "TDS.adjOnly: the round-off journal adjusts the TDS ledger (no party, TDS ledger and Round Off only)");
  ok(!rowOf(ro).length, "no deduction row for the round-off journal (was: blank deductee, 194J, paid 35.50, TDS 0.71 at 2%) (" + rowOf(ro).map(show).join("; ") + ")");
  ok(!rows.some(r => !r.party), "every deduction names its deductee (" + rows.filter(r => !r.party).map(show).join("; ") + ")");
  const q1 = x.TDS.rows().filter(r => r.fy === "2025-26" && r.q === "Q1");
  ok(Math.abs(q1.reduce((a, r) => a + r.tds, 0) - 1400) < 0.005, "26Q Q1's TDS is the two deductions, ₹1,400, not ₹1,400.71 (" + q1.reduce((a, r) => a + r.tds, 0) + ")");
}
// ---------------------------------------------------------------- the note, once
{
  const L = x.TDSAdj.list("2025-26", "Q1", "26Q");
  ok(L.length === 1 && L[0].vid === ro.id, "TDSAdj.list: the round-off journal, once (" + L.length + ")");
  const want = "TDS ledger adjusted without a deductee: Journal 01-Apr-2025, Round Off ₹0.71 — not in the return";
  ok(L[0] && L[0].words === want, "the note's words: \"" + (L[0] && L[0].words) + "\"");
  ok(L[0] && L[0].date === "20250401" && L[0].ledgers[0] === "TDS 94J 2%" && L[0].amount === 0.71, "the note carries the entry (its day, the TDS ledger, ₹0.71) to open it");
  ok(!x.TDSAdj.list("2025-26", "Q1", "24Q").length && !x.TDSAdj.list("2025-26", "Q1", "27Q").length && !x.TDSAdj.list("2025-26", "Q2", "26Q").length,
    "said on 26Q Q1 only (not 24Q, 27Q or another quarter)");
  // the entry opened in Look up: its day, the TDS ledger searched (it has no number)
  let went = "", ran = ""; const lk = {}; ctx.LK = {st: () => lk, run: (w) => { ran = w; }}; ctx.FC = {go: (p) => { went = p; }};
  x.TDSAdj.open(L[0]);
  ok(went === "lookup" && ran === "auto" && lk.q === "TDS 94J 2%" && lk.from === "20250401" && lk.to === "20250401", "Open the entry: Look up on 01-Apr-2025 for the TDS ledger (" + [went, lk.q, lk.from, lk.to].join(" | ") + ")");
}
// ---------------------------------------------------------------- a normal deduction: still counted
{
  const r = rowOf(bill)[0];
  ok(r && r.party === "Mehta Tech Services" && r.paid === 50000 && r.tds === 1000 && r.rate === 2 && r.section === "194J", "Mehta's bill: 50,000, TDS 1,000 at 2%, 194J (" + show(r) + ")");
  ok(!x.TDS.adjOnly(bill), "a bill with an expense and a party is not an adjustment");
  const j = rowOf(tj)[0];
  ok(!x.TDS.adjOnly(tj) && j && j.party === "Rao Consultants" && j.tds === 400 && j.paid === 20000, "a TDS journal naming no party in Tally but debiting the party's ledger: a deduction, Rao (" + show(j) + ")");
}
// ---------------------------------------------------------------- the challan: unchanged
{
  ok(!rowOf(pay).length, "the TDS payment makes no deduction row");
  const P = x.TDS.paymentsFromBooks();
  ok(P.length === 1 && P[0].vid === pay.id && P[0].tax === 1000.71, "the TDS payment is the books' challan, ₹1,000.71 (" + P.map(p => p.vid + " " + p.tax).join("; ") + ")");
  ok(!x.TDSAdj.list("2025-26", "Q1", "26Q").some(z => z.vid === pay.id), "the payment is not an adjustment note");
}
console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
