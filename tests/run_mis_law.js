// node run_mis_law.js - MIS figures checked against the rules (review of 22-Nov-2026, track mis-audit), on made-up books:
//   1. debt to equity counts the profit to date in the income and expense ledgers, not only the MIS period's;
//   2. the due-date list gives TCS its own dates (7 April for March, rule 37CA; Form 27EQ on the 15th, rule 31AA), and TDS
//      its own (30 April for March, rule 30(2); returns on the 31st, rule 31A);
//   3. the 13 weeks leave out a bill more than 180 days past when the party pays, and say so.
// TDSDESK_HTML points at another build (the check before a fix: it fails there).
const {load, HTML} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "TDSRate", "TDSWatch", "noPanRate", "NO_PAN_RATE"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.CO = () => ({name: "Made-up Works Private Limited"}); ctx.S.coId = "t"; ctx.S.data = {};
const under = {"Share Capital": "Capital Account", "Made-up Bank": "Bank Accounts", "Sales": "Sales Accounts", "Director Loan": "Unsecured Loans"};
const groups = {"Capital Account": "", "Bank Accounts": "Current Assets", "Current Assets": "", "Sales Accounts": "", "Unsecured Loans": "Loans (Liability)", "Loans (Liability)": ""};
ctx.S.books = {cid: "t", vouchers: [], under, groups, ledInfo: {}, meta: {from: "20250401", to: "20250531", gstins: []}, map: {}, msme: {}};

console.log("1. debt to equity");
// share capital 1,00,000; April sales 50,000; May sales 10,000 and a director's loan of 60,000; MIS for May
const balTo = {"Share Capital": 100000, "Sales": 60000, "Director Loan": 60000, "Made-up Bank": -220000};
const r = {pl: {heads: {rev: {t: 10000}}, gross: {t: 10000}, ebitda: {t: 10000}, pbt: {t: 10000}, pat: {t: 10000}, months: []}, dso: 0, dpo: 0, goods: false, purchases: {total: 0}, sales: {total: 10000}};
const de = (x.MIS.ratios(r, balTo).list.find(l => l[0] === "Debt to equity") || [])[1];
ok(de === 0.38, "60,000 ÷ (1,00,000 + 60,000 profit to date) = 0.38, not 0.55 (got " + de + ")");

console.log("2. due dates");
const d = x.MIS.dues("20270401"), has = (dt, w) => d.some(z => z[0] === dt && z[1] === w);
ok(has("20270407", "TCS deposit for Mar-2027"), "TCS for March: 7 April (rule 37CA)");
ok(has("20270430", "TDS deposit for Mar-2027"), "TDS for March: 30 April (rule 30(2))");
const d4 = x.MIS.dues("20270510");
ok(d4.some(z => z[0] === "20270515" && z[1] === "TCS return (Form 27EQ) for Q4 2026-27") && d4.some(z => z[0] === "20270531" && z[1] === "TDS returns for Q4 2026-27"), "Q4: 27EQ by 15 May, 24Q / 26Q by 31 May");
const d2 = x.MIS.dues("20261002");
ok(d2.some(z => z[0] === "20261015" && /27EQ.*Q2 2026-27/.test(z[1])) && d2.some(z => z[0] === "20261031" && z[1] === "TDS returns for Q2 2026-27"), "Q2: 27EQ by 15 October, TDS returns by 31 October");
ok(!d.concat(d2).some(z => /TDS and TCS/.test(z[1])), "no line gives TDS and TCS one date");

console.log("3. the 13 weeks");
const recv = {rows: [{party: "Old Customer", open: [{date: "20240101", ref: "OC-1", amt: 500000, left: 500000}]}, {party: "New Customer", open: [{date: "20260320", ref: "NC-1", amt: 20000, left: 20000}]}]};
const F = x.MIS.forecast("20260331", recv, {rows: []}, 100000);
const w1 = F.weeks[0].inn + F.weeks.reduce((s, w) => s + w.inn, 0) - F.weeks[0].inn;
ok(!F.weeks.some(w => w.items.some(i => i.who === "Old Customer")), "a bill of 5,00,000 over 400 days overdue is not taken in week 1 (coming in over the weeks: " + w1 + ")");
ok(F.old && F.old.n === 1 && F.old.inn === 500000, "and it is kept apart, said as doubtful: " + JSON.stringify(F.old));
ok(F.weeks.some(w => w.items.some(i => i.who === "New Customer")), "a recent bill is still expected");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
