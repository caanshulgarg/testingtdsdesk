// node run_fin_law.js - the financial statements and the computation of income, against the rules (review of 22-Nov-2026,
// track mis-audit), on small made-up books:
//   1. a Stock-in-Hand ledger no entry moves holds only the opening of FinCom's copy: the closing stock typed is used, and
//      the year's profit and inventories are right;
//   2. a firm's profit credited to the partners by a journal on the Profit & Loss A/c is not counted twice in capital,
//      and is not a negative surplus; a company's transfer to reserve from it is an appropriation, not the opening;
//   3. the slab tax (section 115BAC(1A)) by the year's slabs, the 87A rebate with its marginal relief for an individual
//      only, and a year before FY 2023-24 asked, not guessed.
// TDSDESK_HTML points at another build (the check before a fix: it fails there).
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "FS", "FinSt", "INR"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const near = (a, b) => a != null && Math.abs(a - b) < 0.01;
const FinSt = x.FinSt;
// the books FinCom holds: groups, the copy's openings (Tally's sign: a debit negative) and entries
function books(o, under, vouchers, from){
  const led = {}; Object.entries(o).forEach(([n, v]) => { led[n] = {open: v, close: 0, parent: under[n]}; });
  return {cid: "t", under, groups: {}, ledInfo: {}, vouchers: vouchers.map((v, i) => Object.assign({id: "v" + i, no: String(i + 1), narr: "", party: ""}, v)), meta: {from},
    tb: {from, to: "20260331", at: "2026-04-30T10:00:00Z", src: "copy", led}, msme: {}, fs: {}};
}
const J = (date, ent, type) => ({date, type: type || "Journal", ent: ent.map(([l, a]) => ({l, a}))});

console.log("1. stock in a Stock-in-Hand ledger no entry moves");
ctx.CO = () => ({name: "Made-up Trading Private Limited", pan: "AABCM0000M", entity: "C"});
let b = books({"Share Capital": 300000, "Made-up Bank": -200000, "Closing Stock": -100000},
  {"Share Capital": "Capital Account", "Made-up Bank": "Bank Accounts", "Closing Stock": "Stock-in-Hand", "Purchase": "Purchase Accounts", "Sales": "Sales Accounts"},
  [J("20250610", [["Purchase", -50000], ["Made-up Bank", 50000]], "Purchase"), J("20250910", [["Made-up Bank", -80000], ["Sales", 80000]], "Sales")], "20250401");
b.fs = {cfg: {kind: "co", kindSet: true}, stockAt: {"20260331": {v: 120000, by: "tester", at: "2026-04-20T10:00:00Z"}}};
ctx.S.books = b;
let d = FinSt.build("2025", {unit: 1, dec: 2});
ok(d && !d.error, "built" + (d && d.error ? ": " + d.error : ""));
ok(d.stock && !d.stock.integrated, "the stock is not taken from the ledger's balance (no entry moves it)");
ok(near(d.pl.pat.cy, 50000) || near(d.pl.pbt.cy, 50000), "profit 80,000 - (1,00,000 + 50,000 - 1,20,000) = 50,000 (got pbt " + (d.pl && d.pl.pbt.cy) + ")");
const inv = d.tb.rows.filter(r => r.code === "39A").reduce((s, r) => s + r.final, 0);
ok(near(inv, 120000), "inventories 1,20,000 as typed, not the ledger's 1,00,000 (got " + inv + ")");
ok(near(d.bs.total.eqL.cy, d.bs.total.assets.cy), "the balance sheet tallies: " + d.bs.total.eqL.cy + " / " + d.bs.total.assets.cy);
// the opening stock: the ledger's opening balance in Tally when nothing else is given
ok(d.stock.A && d.stock.A.v === 100000, "the year's opening stock: the Stock-in-Hand ledger's opening in Tally, 1,00,000 (got " + (d.stock.A && d.stock.A.v) + ")");

console.log("2. the Profit & Loss A/c ledger's entries of the year");
ctx.CO = () => ({name: "Made-up & Partners", pan: "AAAFM0000M", entity: "F"});
b = books({"Partner A": 50000, "Partner B": 50000, "Made-up Bank": -100000},
  {"Partner A": "Capital Account", "Partner B": "Capital Account", "Made-up Bank": "Bank Accounts", "Sales": "Sales Accounts", "Rent": "Indirect Expenses"},
  [J("20250701", [["Made-up Bank", -100000], ["Sales", 100000]], "Sales"), J("20251001", [["Rent", -40000], ["Made-up Bank", 40000]], "Payment"),
    J("20260331", [["Profit & Loss A/c", -60000], ["Partner A", 30000], ["Partner B", 30000]])], "20250401");
b.fs = {cfg: {kind: "nc", kindSet: true}};
ctx.S.books = b;
d = FinSt.build("2025", {unit: 1, dec: 2});
const n3 = d.notes.find(z => z.key === "3") || {total: {}}, n4 = d.notes.find(z => z.key === "4") || {total: {}};
ok(near(n3.total.cy, 160000), "partners' capital 1,60,000 (1,00,000 + their 60,000 credited), not 2,20,000 (got " + n3.total.cy + ")");
ok(near(n4.total.cy || 0, 0), "reserves and surplus nil, not -60,000 (got " + n4.total.cy + ")");
ok(near(d.bs.total.eqL.cy, d.bs.total.assets.cy), "the balance sheet tallies");
ctx.CO = () => ({name: "Made-up Works Private Limited", pan: "AABCW0000W", entity: "C"});
b = books({"Share Capital": 100000, "Profit & Loss A/c": 40000, "Made-up Bank": -140000},
  {"Share Capital": "Capital Account", "Profit & Loss A/c": "", "General Reserve": "Reserves & Surplus", "Made-up Bank": "Bank Accounts", "Sales": "Sales Accounts"},
  [J("20250701", [["Made-up Bank", -10000], ["Sales", 10000]], "Sales"), J("20260331", [["Profit & Loss A/c", -15000], ["General Reserve", 15000]])], "20250401");
b.fs = {cfg: {kind: "co", kindSet: true}};
ctx.S.books = b;
d = FinSt.build("2025", {unit: 1, dec: 2});
const sur = (d.notes.find(z => z.key === "4") || {lines: []}).lines, open4A = sur.find(l => l.code === "4A");
ok(open4A && near(open4A.cy, 40000), "the surplus at the beginning of the year: 40,000, last year's closing, not 25,000 (got " + (open4A && open4A.cy) + ")");
ok(sur.some(l => l.code === "4F" && near(l.cy, -15000)), "the transfer to general reserve, 15,000, is its own line in the surplus");
ok(near(d.bs.total.eqL.cy, d.bs.total.assets.cy), "the balance sheet tallies");

console.log("3. slab tax, section 115BAC(1A) and the rebate u/s 87A");
const T = (ti, fy, ent) => FinSt.taxOn(ti, "slab", {}, fy, ent);
ok(T(1210000, "2025", "P").tax === 10000, "FY 2025-26, 12,10,000, an individual: marginal relief caps the tax at 10,000 (got " + T(1210000, "2025", "P").tax + ")");
ok(T(1200000, "2025", "P").tax === 0, "FY 2025-26, 12,00,000, an individual: nil after the rebate");
ok(T(1000000, "2025", "H").tax === 40000, "FY 2025-26, an HUF with 10,00,000: no 87A rebate, 40,000 (got " + T(1000000, "2025", "H").tax + ")");
ok(T(750000, "2024", "P").tax === 25000, "FY 2024-25, 7,50,000, an individual: slabs 3/7/10 lakh, 25,000 (got " + T(750000, "2024", "P").tax + ")");
ok(T(710000, "2024", "P").tax === 10000, "FY 2024-25, 7,10,000: marginal relief over the 7 lakh rebate, 10,000 (got " + T(710000, "2024", "P").tax + ")");
ok(T(700000, "2023", "P").tax === 0 && T(900000, "2023", "P").tax === 45000, "FY 2023-24: 7 lakh nil after the rebate; 9 lakh 45,000 (slabs 3/6/9 lakh)");
ok(T(800000, "2022", "P").unknown === true, "FY 2022-23: not worked out (the old regime was the default): asked, not guessed");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
