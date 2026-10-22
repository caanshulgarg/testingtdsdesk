// node run_gstr1_party.js - GSTR-1 when the buyer's name on a sale differs from its party ledger (the owner's reconciliation
// of 22-Oct-2026: one client's GSTR-1 worked out at 20.52 crore against 8.64 crore filed). Tally keeps the buyer's name
// (party) apart from the ledger debited; FinCom took the party line by that name, so the receivable on such a sale was
// read as a 0% sale line, and the receipt before such an invoice stayed in 11A (the invoice never adjusted it). Made-up
// names and figures only, shaped like that client's books.
//   1. the receivable is the party line by structure (its ledger under Sundry Debtors, or its bill allocation), whatever
//      the buyer's name: B2B taxable is the income only, no 0% line
//   2. without masters, the line with the bill allocation on the party's side is the party line
//   3. a nil-rated sale with such a party: no table 8 row of the invoice's gross
//   4. a purchase whose supplier name differs from its creditor ledger: the bill's value is the expense only
//   5. an advance received and invoiced in the same month: nothing in 11A, the invoice in B2B
//   6. an advance received one month and invoiced the next: 11A (with its IGST) the first month, 11B the next; never in B2B
//   7. a sale whose party ledger is named as the buyer: as before
//   8. advances only for a client that turned them on (the owner, 22-Oct-2026: "don't treat advance unless we say"; off by
//      default, existing clients too): off gives no 11A/11B (GSTR-1, its JSON, 3B 3.1(a)) and no advance check, and the
//      same B2B; on gives the figures of 6. Sections 1-7 run with advances on
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "Books", "LedMaster", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "normName", "GSTSet", "GSTF", "CustIMS", "ITCT", "Audit"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const {ctx, x} = load(HTML, NAMES.filter(n => { try { load(HTML, [n]); return true; } catch (e){ return false; } }));
const CMP = "09AAACZ9999Z1Z5", reg = "09", BUYER_GSTIN = "07AAACQ1234Q1Z1", SUPPLIER_GSTIN = "09AAACK1111K1Z1";
const ADV_ON = {value: "on", state: "confirmed", by: "test", at: "2026-10-22T00:00:00Z"};
ctx.S.companies = {t: {id: "t", name: "Test", gstin: CMP, choices: {advGst: ADV_ON}}}; ctx.S.coId = "t"; ctx.CO = () => ctx.S.companies.t;
// [ledger, amount (Tally's sign: debit negative), {h, gr, b: bill allocations [name, type, amount]}]
const V = (id, type, date, no, party, ent, extra) => Object.assign({id, type, date, no, party, gstin: "", pos: "", cmp: CMP, narr: "", ent: ent.map(([l, a, o]) => Object.assign({l, a}, o || {})), hsn: []}, extra || {});
const SV = {h: "997161", gr: 18};
function books(vs, masters){
  const b = {cid: "t", vouchers: vs, meta: {from: "20250401", to: "20260331", gstins: [CMP], bills: 1}, gstins: {}, states: {}, challans: [], alloc: {}, certs: [],
    under: masters === false ? {} : {"Commission Income": "Sales Accounts", "Kestrel Assurance Company Limited-CG": "Sundry Debtors", "Zenith Life Co-DL": "Sundry Debtors",
      "Orbit General Insurance Ltd": "Sundry Debtors", "Office Rent": "Indirect Expenses", "Kite Estates LLP-UP": "Sundry Creditors", "Bank of Nowhere": "Bank Accounts"},
    groups: masters === false ? {} : {"Sales Accounts": "", "Sundry Debtors": "Current Assets", "Current Assets": "", "Sundry Creditors": "Current Liabilities", "Current Liabilities": "", "Indirect Expenses": "", "Bank Accounts": "Current Assets"}};
  b.gstins["Kestrel Assurance Company Limited-CG"] = "22AAACK2222K1Z2"; b.gstins["Zenith Life Co-DL"] = BUYER_GSTIN; b.gstins["Kite Estates LLP-UP"] = SUPPLIER_GSTIN;
  b.map = x.Books.mapLedgers(vs, {});
  const set = (n, o) => { b.map[n] = Object.assign(b.map[n] || {n: 0}, o, {ok: true, byHand: true}); };
  set("Output IGST", {kind: "gst", tax: "IGST", side: "output", reg}); set("Output CGST", {kind: "gst", tax: "CGST", side: "output", reg}); set("Output SGST", {kind: "gst", tax: "SGST", side: "output", reg});
  set("Input CGST", {kind: "gst", tax: "CGST", side: "input", reg}); set("Input SGST", {kind: "gst", tax: "SGST", side: "input", reg});
  set("Bank of Nowhere", {kind: "bank"});
  ctx.S.books = b; x.GSTAdv._memo = null; return b;
}
const G = x.GSTR, A = x.GSTAdv, near = (a, c) => Math.abs(a - c) < 0.02;
const tot = (g) => g.rows.reduce((s, r) => { const sg = r.kind === "CDNR" ? -1 : 1; ["taxable", "igst", "cgst", "sgst"].forEach(k => { s[k] = Math.round((s[k] + sg * r[k]) * 100) / 100; }); return s; }, {taxable: 0, igst: 0, cgst: 0, sgst: 0});

// 1. the buyer's name differs from the ledger debited (as "The Oriental Insurance Co Ltd CG" against "...Company Limited-CG")
const inv1 = V("s1", "Sales", "20250410", "TEST/2526/0001", "Kestrel Assurance Co Ltd CG",
  [["Kestrel Assurance Company Limited-CG", -2950000, {b: [["TEST/2526/0001", "New Ref", -2950000]]}], ["Commission Income", 2500000, SV], ["Output IGST", 450000]], {gstin: "22AAACK2222K1Z2"});
books([inv1]);
let L = x.Books.lines(inv1);
ok(L.taxable === 2500000 && L.party === 2950000, "1. the receivable (ledger under Sundry Debtors, named apart from the buyer) is the party line: taxable 25,00,000, party 29,50,000 (got " + L.taxable + ", " + L.party + ")");
let g = G.one("202504", reg);
ok(g.b2b.length === 1 && g.b2b[0].taxable === 2500000 && g.b2b[0].igst === 450000 && g.b2b[0].parts.length === 1 && g.b2b[0].parts[0].rate === 18,
  "1. GSTR-1 B2B: one line at 18%, taxable 25,00,000, IGST 4,50,000; no 0% line of the invoice's gross (got " + JSON.stringify(g.b2b.map(r => r.parts.map(q => [q.rate, q.taxable]))) + ")");
ok(!g.nil.length && near(tot(g).taxable, 2500000), "1. the month's taxable value is the income only (" + tot(g).taxable + ")");

// 2. no masters (a copy sent before the groups): the bill allocation on the party's side tells the party line
books([inv1], false);
L = x.Books.lines(inv1);
ok(L.taxable === 2500000 && L.party === 2950000, "2. without masters, the line with the bill allocation is the party line (got " + L.taxable + ", " + L.party + ")");

// 3. a nil-rated sale to such a party: table 8 holds the income, not the gross twice
const nil1 = V("s3", "Sales", "20250412", "TEST/2526/0002", "Kestrel Assurance Co Ltd CG",
  [["Kestrel Assurance Company Limited-CG", -50000, {b: [["TEST/2526/0002", "New Ref", -50000]]}], ["Commission Income", 50000, {h: "997161", gr: 0}]], {taxability: "Nil Rated"});
books([nil1]);
g = G.one("202504", reg);
ok(g.nil.length === 1 && g.nil[0].taxable === 50000, "3. a nil-rated sale: table 8 is 50,000, the income (got " + g.nil.map(r => r.taxable) + ")");

// 4. purchase side: the supplier's name on the bill differs from its creditor ledger
const bill1 = V("p1", "Purchase", "20250415", "R-77", "Kite Estates",
  [["Kite Estates LLP-UP", 118000, {b: [["R-77", "New Ref", 118000]]}], ["Office Rent", -100000, {h: "997212", gr: 18}], ["Input CGST", -9000], ["Input SGST", -9000]], {gstin: SUPPLIER_GSTIN, ref: "R-77"});
books([bill1]);
const inn = G.inward("202504", reg);
ok(inn.length === 1 && inn[0].taxable === 100000, "4. the bill's value is the rent, 1,00,000; the creditor's 1,18,000 is the party line (got " + inn.map(r => r.taxable) + ")");

// 5. money received before the invoice, both in June: invoice in B2B, nothing in 11A (as filed: 11A is empty)
const rc5 = V("r5", "Receipt", "20250603", "", "Zenith Life Co-DL", [["Zenith Life Co-DL", 1180000, {b: [["TEST/2526/L012", "New Ref", 1180000]]}], ["Bank of Nowhere", -1180000]]);
const inv5 = V("s5", "Sales", "20250610", "TEST/2526/L012", "Zenith Life Company",
  [["Zenith Life Co-DL", -1180000, {b: [["TEST/2526/L012", "Agst Ref", -1180000]]}], ["Commission Income", 1000000, SV], ["Output IGST", 180000]], {gstin: BUYER_GSTIN});
books([rc5, inv5]);
g = G.one("202506", reg); let a = A.month("202506", reg);
ok(near(tot(g).taxable, 1000000) && near(tot(g).igst, 180000), "5. June B2B: taxable 10,00,000, IGST 1,80,000 (got " + JSON.stringify(tot(g)) + ")");
ok(a.at.length === 0 && a.txpd.length === 0, "5. the receipt is adjusted by the invoice of the same month: nothing in 11A or 11B (11A " + a.at.map(r => r.igst) + ")");
ok(near(G.threeBm("202506", reg).net.igst, 180000), "5. 3B 3.1(a) IGST is the invoice's 1,80,000 only (got " + G.threeBm("202506", reg).net.igst + ")");

// 6. received in July, invoiced in August: 11A in July with its IGST, 11B in August, and never in B2B
const rc6 = V("r6", "Receipt", "20250720", "", "Zenith Life Co-DL", [["Zenith Life Co-DL", 590000, {b: [["TEST/2526/L020", "New Ref", 590000]]}], ["Bank of Nowhere", -590000]]);
const inv6 = V("s6", "Sales", "20250805", "TEST/2526/L020", "Zenith Life Company",
  [["Zenith Life Co-DL", -590000, {b: [["TEST/2526/L020", "Agst Ref", -590000]]}], ["Commission Income", 500000, SV], ["Output IGST", 90000]], {gstin: BUYER_GSTIN});
books([inv5, rc6, inv6]);
const jul = A.month("202507", reg), aug = A.month("202508", reg);
ok(jul.at.length === 1 && near(jul.at[0].taxable, 500000) && near(jul.at[0].igst, 90000) && jul.at[0].cgst === 0, "6. July 11A: advance 5,00,000 with IGST 90,000 (inter-state: the buyer's GSTIN is Delhi's) (got " + JSON.stringify(jul.at.map(r => [r.taxable, r.igst, r.cgst])) + ")");
ok(aug.txpd.length === 1 && near(aug.txpd[0].igst, 90000) && aug.at.length === 0, "6. August 11B: the same 90,000 adjusted by TEST/2526/L020 (got " + JSON.stringify(aug.txpd.map(r => [r.igst, r.by])) + ")");
ok(G.one("202507", reg).rows.length === 0 && near(tot(G.one("202508", reg)).taxable, 500000), "6. the advance is never a B2B line: July has none, August has the invoice's 5,00,000");
ok(jul.at[0].rateFrom !== "assumed", "6. the advance's rate is the customer's invoice's, found through the party ledger (got " + jul.at[0].rateFrom + ")");

// 7. the party ledger is named as the buyer: as before
const inv7 = V("s7", "Sales", "20250901", "TEST/2526/0090", "Orbit General Insurance Ltd",
  [["Orbit General Insurance Ltd", -11800, {b: [["TEST/2526/0090", "New Ref", -11800]]}], ["Commission Income", 10000, SV], ["Output CGST", 900], ["Output SGST", 900]], {gstin: "09AAACO3333O1Z3"});
books([inv7]);
L = x.Books.lines(inv7); g = G.one("202509", reg);
ok(L.taxable === 10000 && L.party === 11800 && g.b2b[0].cgst === 900 && g.b2b[0].parts.length === 1, "7. a party ledger named as the buyer: taxable 10,000, CGST 900, as before");

// 8. advances shown only when turned on for the client: the books of 6, and an advance from a customer never invoiced
// (its rate assumed at 18%, which the checks would list)
const rc8 = V("r8", "Receipt", "20250725", "", "Orbit General Insurance Ltd", [["Orbit General Insurance Ltd", 11800, {b: [["ADV-1", "New Ref", 11800]]}], ["Bank of Nowhere", -11800]]);
const co = ctx.S.companies.t;
const run8 = (choice) => {
  if (choice) co.choices.advGst = choice; else delete co.choices.advGst;
  books([inv5, rc6, inv6, rc8]);
  const jul = A.month("202507", reg), aug = A.month("202508", reg), jj = G.toJson("202507", reg), ja = G.toJson("202508", reg);
  return {jul, aug, jj, ja, b3: G.threeBm("202507", reg).net.igst, b3a: G.threeBm("202508", reg).net.igst, b2bJul: JSON.stringify(G.one("202507", reg).b2b),
    b2bAug: JSON.stringify(G.one("202508", reg).b2b), checks: G.checks("202507", reg).map(c => c.what).filter(w => /advance/i.test(w))};
};
const off = run8(null), offSaid = run8({value: "off", state: "confirmed", by: "test", at: "2026-10-22T00:00:00Z"}), on = run8(ADV_ON);
[["off by default (no choice)", off], ["turned off", offSaid]].forEach(([w, r]) => {
  ok(!r.jul.at.length && !r.jul.txpd.length && !r.aug.at.length && !r.aug.txpd.length && !r.jul.open.length && !r.jul.untaxed.length && !r.jul.unmatched.length,
    "8. " + w + ": 11A and 11B empty in July and August (got 11A " + r.jul.at.length + ", 11B " + r.aug.txpd.length + ")");
  ok(!("at" in r.jj) && !("txpd" in r.jj) && !("at" in r.ja) && !("txpd" in r.ja), "8. " + w + ": the GSTR-1 JSON has no at or txpd");
  ok(r.b3 === 0 && near(r.b3a, 90000), "8. " + w + ": 3B 3.1(a) IGST is the invoices' only: July 0, August 90,000 (got " + r.b3 + ", " + r.b3a + ")");
  ok(!r.checks.length, "8. " + w + ": no check about advances (got " + JSON.stringify(r.checks) + ")");
  ok(r.b2bJul === on.b2bJul && r.b2bAug === on.b2bAug && near(tot(G.one("202508", reg)).taxable, 500000), "8. " + w + ": B2B as with advances on (August 5,00,000)");
});
const z8 = on.jul.at.find(r => r.party === "Zenith Life Co-DL"), o8 = on.jul.at.find(r => r.party === "Orbit General Insurance Ltd");
ok(on.jul.at.length === 2 && z8 && near(z8.igst, 90000) && o8 && near(o8.cgst, 900) && on.aug.txpd.length === 1 && near(on.aug.txpd[0].igst, 90000),
  "8. on: July 11A has Zenith's advance (IGST 90,000) and Orbit's (CGST 900, rate assumed), August 11B the 90,000 (got 11A " + JSON.stringify(on.jul.at.map(r => [r.party, r.igst, r.cgst])) + ")");
ok(on.jj.at && on.jj.at.length && on.ja.txpd && on.ja.txpd.length, "8. on: the JSON has at (July) and txpd (August)");
ok(near(on.b3, 90000) && near(on.b3a, 0), "8. on: 3B 3.1(a) IGST July 90,000 (the advance), August nil (the invoice less 11B) (got " + on.b3 + ", " + on.b3a + ")");
ok(on.checks.includes("Advances where the rate was assumed at 18%"), "8. on: the check on Orbit's advance (rate assumed) is listed (got " + JSON.stringify(on.checks) + ")");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
