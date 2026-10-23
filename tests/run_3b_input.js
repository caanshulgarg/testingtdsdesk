// node run_3b_input.js - GSTR-3B's input side against the books (owner, 23-Oct-2026: "gstr 3b is not matching with books,
// some negative entry is coming, pls check input and 3b calculations"). A service company that keeps credit not yet in 2B
// in an input ledger of its own ("IGST INPUT NOT SHOWN IN 2B"), moves it to Input IGST by journal when 2B shows the bill,
// books its bills as journals, and sets off at the month end against output tax and a GST payable account. Made-up
// entries only. What the books say is what 3B must say:
//   1. tax only moved between two input ledgers (the held ledger to Input IGST) is credit taken that month, once: never
//      the two lines added (it was 36,000 for 18,000), and never in the month the bill was booked to the held ledger
//   2. a bill booked to the held ledger takes no credit until it is moved; written off to an expense, it takes none
//   3. the month-end set-off (output tax debited, or the GST payable account debited) and a rounding of the input ledgers
//      are never a purchase: no negative credit from them
//   4. on the 2B basis, a bill the books hold is neither held back again nor released when 2B shows it (the move does it)
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR",
  "normName", "nameSim", "ITCT", "GSTSet", "CustIMS", "GSTF", "GSTQ"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {ctx, x} = load(HTML, NAMES);
const CMP = "09AAACZ1234A1Z5", reg = "09", G = x.GSTR, H = ["igst", "cgst", "sgst"];
ctx.S.companies = {t: {id: "t", name: "Zeta Brokers", gstin: CMP, choices: {}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
// one entry: [ledger, amount (Tally's sign: debit negative)]
const V = (id, type, date, no, party, gstin, ent) => ({id, type, date, no, party, gstin, pos: "", cmp: CMP, narr: "", ent: ent.map(([l, a]) => ({l, a})), hsn: []});
const VA = "09AABCA1111A1Z1", VB = "07AABCB2222B1Z2";
const vs = [
  // April: a bill in Input CGST/SGST; a bill held (not in 2B yet); a sale; the set-off; a set-off to the payable account
  // with no output line; a rounding of the input ledgers
  V("a1", "Journal", "20260405", "A/101", "Alpha Supplies", VA, [["Office Expenses", -10000], ["Input CGST", -900], ["Input SGST", -900], ["Alpha Supplies", 11800]]),
  V("b1", "Journal", "20260410", "B/7", "Beta Software", VB, [["Software Expenses", -100000], ["IGST INPUT NOT SHOWN IN 2B", -18000], ["Beta Software", 118000]]),
  V("s1", "Sales", "20260415", "Z/1", "Gamma Insurance", "07AABCG3333C1Z3", [["Gamma Insurance", -236000], ["Commission Income", 200000], ["IGST", 36000]]),
  V("j1", "Journal", "20260430", "", "", "", [["IGST", -36000], ["Input CGST", 900], ["Input SGST", 900], ["Gst Payable", 34200]]),
  V("j2", "Journal", "20260430", "", "", "", [["Gst Payable", -1800], ["Input CGST", 900], ["Input SGST", 900]]),
  V("j3", "Journal", "20260430", "", "", "", [["Round Off", -0.18], ["Input CGST", 0.09], ["Input SGST", 0.09]]),
  // May: 2B shows Beta's bill; the books move its credit; an old held credit written off to an expense
  V("t1", "Journal", "20260520", "B/7", "", "", [["Input IGST", -18000], ["IGST INPUT NOT SHOWN IN 2B", 18000]]),
  V("w1", "Journal", "20260521", "W/1", "", "", [["Miscellaneous Expenses", -1759], ["IGST INPUT NOT SHOWN IN 2B", 900], ["GST Interest Cash Ledger", 859]]),
  V("s2", "Sales", "20260522", "Z/2", "Gamma Insurance", "07AABCG3333C1Z3", [["Gamma Insurance", -118000], ["Commission Income", 100000], ["IGST", 18000]]),
  V("j4", "Journal", "20260531", "", "", "", [["IGST", -18000], ["Input IGST", 18000]])
];
function books(twoB){
  const b = {cid: "t", vouchers: vs, meta: {from: "20260401", to: "20260531", gstins: [CMP], bills: 1},
    under: {"Alpha Supplies": "Sundry Creditors", "Beta Software": "Sundry Creditors", "Gamma Insurance": "Sundry Debtors", "IGST INPUT NOT SHOWN IN 2B": "Not in GSTR-2B", "Commission Income": "Sales Accounts"},
    groups: {"Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets", "Not in GSTR-2B": "Current Assets", "Sales Accounts": "Primary"}, gstins: {}, states: {}, challans: [], alloc: {}, certs: [], twoBs: twoB || {}};
  b.map = x.Books.mapLedgers(vs, {});
  const set = (n, o) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, {ok: true, byHand: true}); };
  ["IGST", "CGST", "SGST"].forEach(t => set(t, {what: "gst", kind: "gst", tax: t, side: "output", reg}));
  ["IGST", "CGST", "SGST"].forEach(t => set("Input " + t, {what: "gst", kind: "gst", tax: t, side: "input", reg}));
  set("IGST INPUT NOT SHOWN IN 2B", {what: "gst", kind: "gst", tax: "IGST", side: "input", reg});
  set("Gst Payable", {what: "gst_setoff", kind: "tax_other", tax: "IGST", side: "output", reg});
  ctx.S.books = b; G._carry = null; x.GST2B._memo = null; return b;
}
const near = (a, c) => Math.abs(a - c) < 0.01, f = o => H.map(h => Math.round(((o || {})[h] || 0) * 100) / 100).join("/");
// ---- the books basis (no 2B for these months)
books();
const apr = G.threeBm("202604", reg), may = G.threeBm("202605", reg);
ok(near(apr.other.cgst, 900) && near(apr.other.sgst, 900) && near(apr.other.igst, 0), "April 4(A)(5): CGST 900, SGST 900, no IGST: Beta's bill is held in the books (" + f(apr.other) + ")");
ok(near(may.other.igst, 18000) && near(may.other.cgst, 0) && near(may.other.sgst, 0), "May 4(A)(5): IGST 18,000 once, when the books move it from the held ledger; the write-off takes none (" + f(may.other) + ")");
const rowsApr = G.inward("202604", reg), rowsMay = G.inward("202605", reg);
ok(!rowsApr.concat(rowsMay).some(r => { const s = G.signedIn(r); return s.igst < 0 || s.cgst < 0 || s.sgst < 0; }), "no negative credit from the set-off, the set-off to the payable account, the rounding or the write-off (" + rowsApr.concat(rowsMay).map(r => r.id + ":" + f(G.signedIn(r))).join(" ") + ")");
ok(!rowsApr.some(r => /^j/.test(r.id)) && !rowsMay.some(r => r.id === "w1" || r.id === "j4"), "the set-off, payable, rounding and write-off entries are not inward supplies");
ok(near(apr.net.igst, 36000) && near(may.net.igst, 18000), "3.1(a) unchanged: IGST 36,000 in April, 18,000 in May");
ok(near(apr.netItc.cgst + apr.netItc.sgst + apr.netItc.igst, 1800) && near(may.netItc.igst, 18000), "4(C): 1,800 in April, 18,000 in May, as the input ledgers' movements");
// ---- the 2B basis: April's 2B shows Alpha's bill; May's shows Beta's
const row = (ym, gstin, no, date, taxable, igst, cgst, sgst) => ({no, noN: no.replace(/[^A-Z0-9]/gi, "").toUpperCase(), ym, dir: 1, ims: "N", key: ym.slice(4) + ym.slice(0, 4) + "|b2b|" + gstin + "|" + no + "|" + date, pos: reg, rcm: false, sec: "b2b", typ: "R",
  val: taxable + igst + cgst + sgst, cess: 0, cgst, sgst, igst, date, gstin, party: "", itcavl: "Y", taxable});
books({[CMP + "|042026"]: {ym: "202604", gstin: CMP, period: "042026", rows: [row("202604", VA, "A/101", "20260405", 10000, 0, 900, 900)]},
       [CMP + "|052026"]: {ym: "202605", gstin: CMP, period: "052026", rows: [row("202605", VB, "B/7", "20260410", 100000, 18000, 0, 0)]}});
const a2 = G.threeBm("202604", reg), m2 = G.threeBm("202605", reg);
ok(a2.basis === "2b" && near(a2.other.igst, 0) && near(a2.held.igst, 0) && near(a2.other.cgst, 900), "2B basis, April: Beta's held bill is not held back a second time (4(A)(5) " + f(a2.other) + ", held " + f(a2.held) + ")");
ok(m2.basis === "2b" && near(m2.other.igst, 18000) && near(m2.released.igst, 0), "2B basis, May: IGST 18,000 by the move, not released again from April (4(A)(5) " + f(m2.other) + ", released " + f(m2.released) + ")");
const sc = x.GST2B.run(reg);
ok(sc.pairs.some(p => p.p.no === "B/7" && p.books.some(d => d.id === "b1")) && !sc.books.some(d => d.id === "t1" || d.id === "w1" || /^j/.test(d.id)), "2B reconciliation: Beta's bill matches 2B; the move, the write-off and the set-offs are no documents");
console.log(fails ? "\n" + fails + " FAILED" : "\nall ok"); process.exit(fails ? 1 : 0);
