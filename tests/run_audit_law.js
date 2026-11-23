// node run_audit_law.js - the audit's checks of the law, on small made-up books (review of 22-Nov-2026, track mis-audit):
//   269ST by the person paying (the bill's GST with it), 40A(3) by the person paid (the GST with it), 269SS / 269T lender by
//   lender with what the lender is owed, 206AA's rate without a PAN by section, 43B without TDS and with GST net of the
//   input credit, 43B(h) only from FY 2023-24 and the time allowed asked when not set, no row cut inside a check (so no
//   item is marked put right while still open), and the Form 3CD draft: 21(b)(ii)(A) and 34(a) not counted twice, clause 31
//   as the form numbers it, every row (not the first 1,000), clause 44 without depreciation, salary or provisions.
// Every name and figure is made up. TDSDESK_HTML points at another build (the check before a fix: it fails there).
const {load, HTML} = require("./harness"), fs = require("fs");
const src = fs.readFileSync(HTML, "utf8");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "TDSRate", "TDSInt", "GSTIN_RE", "TDSFiled", "BOOKS_KEYS",
  "TDSWatch", "noPanRate", "NO_PAN_RATE"].concat(/\nconst AuditRep = /.test(src) ? ["AuditRep"] : []);
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const FROM = "20250401", TO = "20260331";
ctx.CO = () => ({name: "Made-up Traders Private Limited", pan: "AAACM0000A"}); ctx.S.coId = "t"; ctx.S.data = {}; ctx.saveBooks = () => {};

const UNDER = {"Cash": "Cash-in-Hand", "Made-up Bank": "Bank Accounts", "Sales": "Sales Accounts", "Purchase": "Purchase Accounts", "Rent": "Indirect Expenses", "Salary": "Indirect Expenses",
  "Depreciation": "Indirect Expenses", "Plant": "Fixed Assets", "Salary Payable": "Current Liabilities", "Mohan Loan": "Unsecured Loans", "Asha Loan": "Unsecured Loans", "Capital": "Capital Account",
  "07 CGST OUTPUT": "Duties & Taxes", "07 SGST OUTPUT": "Duties & Taxes", "07 CGST INPUT": "Duties & Taxes", "07 SGST INPUT": "Duties & Taxes", "07 IGST INPUT": "Duties & Taxes", "TDS Payable 194C": "Duties & Taxes",
  "Professional Tax Payable": "Duties & Taxes", "07 IGST OUTPUT": "Duties & Taxes", "Auditor's Remuneration": "Indirect Expenses", "Staff Welfare": "Indirect Expenses", "Partners Remuneration": "Indirect Expenses",
  "Directors Remuneration": "Indirect Expenses", "Audit Firm": "Sundry Creditors", "Interest on Loan": "Indirect Expenses", "Ravi Stores": "Sundry Debtors", "Supp A": "Sundry Creditors", "Supp B": "Sundry Creditors", "Supp C": "Sundry Creditors", "Supp D": "Sundry Creditors", "Tiny Works": "Sundry Creditors"};
const GROUPS = {"Cash-in-Hand": "Current Assets", "Bank Accounts": "Current Assets", "Sundry Debtors": "Current Assets", "Sundry Creditors": "Current Liabilities", "Duties & Taxes": "Current Liabilities",
  "Unsecured Loans": "Loans (Liability)", "Current Assets": "", "Current Liabilities": "", "Loans (Liability)": "", "Sales Accounts": "", "Purchase Accounts": "", "Indirect Expenses": "", "Capital Account": "", "Fixed Assets": ""};
let n = 0;
const V = (date, type, ent, o) => Object.assign({id: "v" + (++n), no: String(n), date, type, party: "", narr: "", ref: "", ent: ent.map(([l, a]) => ({l, a}))}, o || {});
function books(vouchers, more){
  const ledInfo = {}; Object.keys(UNDER).forEach(l => { ledInfo[l] = {ob: 0, from: FROM}; }); ledInfo["Capital"].ob = 10000000; ledInfo["Cash"].ob = -5000000; ledInfo["Made-up Bank"].ob = -5000000;
  const b = Object.assign({cid: "t", vouchers: vouchers.sort((a, c) => a.date.localeCompare(c.date)), meta: {from: FROM, to: TO, gstins: ["07AAACM0000A1Z5"]}, under: Object.assign({}, UNDER), groups: Object.assign({}, GROUPS),
    ledInfo, pans: {}, gstins: {}, challans: [], alloc: {}, msme: {}}, more || {});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; return b;
}
const ctxOf = () => ({from: FROM, to: TO, bal: x.Audit.balances(FROM, TO)});
const check = (id, vs) => [].concat(x.Audit.checks[id](x.Audit, x.Audit.vouchers(FROM, TO).sort((a, c) => a.date.localeCompare(c.date)), ctxOf()) || []).filter(Boolean);
const rowsOf = (fs2, key) => (fs2.find(f => (f.key || "") === (key || "")) || {rows: []}).rows;

console.log("1. 269ST: cash from one person in a day, the bill's tax with it");
books([V("20250610", "Sales", [["Cash", -212400], ["Sales", 180000], ["07 CGST OUTPUT", 16200], ["07 SGST OUTPUT", 16200]], {party: "Ravi"})]
  .concat(Array.from({length: 25}, (_, i) => V("20250612", "Sales", [["Cash", -9440], ["Sales", 8000], ["07 CGST OUTPUT", 720], ["07 SGST OUTPUT", 720]], {party: "Cash"}))));
let r = rowsOf(check("cash269ST"));
ok(r.length === 1 && r[0].amount === 212400 && r[0].party === "Ravi" && r[0].date === "20250610", "Ravi's one cash bill of 2,12,400 (1,80,000 + GST) is a 269ST receipt: " + JSON.stringify(r.map(z => [z.party, z.amount])));
ok(!r.some(z => z.date === "20250612"), "25 cash sales of 9,440 to no one named on one day are not one person's 2 lakh");

console.log("2. 40A(3): cash paid to one person in a day, the GST with it");
books([V("20250510", "Payment", [["Purchase", -9000], ["07 CGST INPUT", -810], ["07 SGST INPUT", -810], ["Cash", 10620]], {party: "Cash"})]
  .concat(["Supp A", "Supp B", "Supp C", "Supp D"].map(p => V("20250512", "Payment", [["Purchase", -3000], ["Cash", 3000]], {party: "Cash"}))));
r = rowsOf(check("cash40A3"));
ok(r.length === 1 && r[0].amount === 10620 && r[0].date === "20250510", "a direct cash purchase of 9,000 + 1,620 GST = 10,620 is over 10,000: " + JSON.stringify(r.map(z => [z.date, z.party, z.amount])));
ok(!r.some(z => z.date === "20250512"), "four cash purchases of 3,000 to Purchase on one day, no payee named, are not one party's 12,000");
books([V("20250520", "Payment", [["Supp A", -6000], ["Cash", 6000]], {party: "Supp A"}), V("20250520", "Payment", [["Rent", -5000], ["Cash", 5000]], {party: "Supp A"})]);
r = rowsOf(check("cash40A3"));
ok(r.length === 1 && r[0].amount === 11000 && r[0].party === "Supp A", "two cash payments to Supp A the same day (one booked to Rent with Supp A as the party) add up to 11,000");

console.log("3. 269SS / 269T: lender by lender, with what is owed");
books([V("20250805", "Receipt", [["Cash", -15000], ["Mohan Loan", 15000]]), V("20250805", "Receipt", [["Cash", -15000], ["Mohan Loan", 15000]]),
  V("20250901", "Receipt", [["Cash", -25000], ["Asha Loan", 12500], ["Mohan Loan", 12500]])]);
ctx.S.books.ledInfo["Asha Loan"].ob = 0;
let lf = check("cashLoans"), tk = rowsOf(lf, "269SS");
ok(tk.some(z => z.party === "Mohan Loan" && z.date === "20250805" && z.amount === 15000) && tk.filter(z => z.date === "20250805").length === 1, "Mohan Loan's second cash loan of 15,000 the same day (15,000 already owed) is a 269SS breach: " + JSON.stringify(tk.map(z => [z.date, z.party, z.amount])));
ok(!tk.some(z => z.party === "Asha Loan"), "25,000 cash split 12,500 to two lenders: Asha Loan (owed nothing before) crossed no limit");
ok(tk.some(z => z.party === "Mohan Loan" && z.date === "20250901"), "Mohan Loan's 12,500 with 30,000 owed: a breach");
books([V("20250905", "Payment", [["Mohan Loan", -5000], ["Cash", 5000]])]); ctx.S.books.ledInfo["Mohan Loan"].ob = 50000;
lf = check("cashLoans");
ok(rowsOf(lf, "269T").length === 1, "a cash repayment of 5,000 of a loan standing at 50,000 (the opening balance) is a 269T breach");
ok(lf.every(f => !/31\(b\)/.test(f.clause)), "269T is clause 31(c) of Form 3CD, not 31(b): " + lf.map(f => f.clause).join(" | "));

console.log("4. 206AA: the rate without a PAN, by section");
books([]);
const tdsRows = x.TDS.rows, tdsCh = x.TDS.challans;
x.TDS.rows = () => [{id: "q1", date: "20250715", section: "194Q", party: "Big Goods Co", pan: "", paid: 5000000, tds: 5000, rate: 0.1, voucher: "1"}];
let f = check("tdsPan")[0];
ok(f && Math.abs(f.amount - 245000) < 0.01, "194Q, 50 lakh above the limit, 5,000 deducted, no PAN: short 5% of 50 lakh less 5,000 = 2,45,000 (got " + (f && f.amount) + ")");
ok(f && !/at 20% without a PAN;/.test(f.impact), "the effect does not say 20% for every section");

console.log("5. no row cut inside a check: 600 unpaid deductions, one more entered earlier, nothing marked put right");
const mk = k => ({id: "d" + k, voucherId: "dv" + k, date: "202506" + String(10 + (k % 18)).padStart(2, "0"), section: "194C", party: "Contractor " + String(k).padStart(3, "0"), pan: "AAAPC0000C", paid: 10000, tds: 100, rate: 1, voucher: "D" + k});
let list = Array.from({length: 600}, (_, k) => mk(k + 10));
x.TDS.rows = () => list; x.TDS.challans = () => [];
books([V("20250601", "Journal", [["Rent", -1], ["Supp A", 1]])]);
const a1 = x.Audit.run(FROM, TO, "test");
list = [mk(1)].concat(list);
const a2 = x.Audit.run(FROM, TO, "test"), solvedU = (a2.solved || []).filter(z => z.id === "tdsUnpaid").reduce((s, z) => s + z.n, 0);
ok(solvedU === 0, "no unpaid deduction marked put right after one more came in earlier in the list (" + solvedU + " were)");
ok(Object.values(ctx.S.books.audit.items).filter(it => it.f === "tdsUnpaid" && !it.solved).length === 601, "all 601 unpaid deductions are open items");
x.TDS.rows = tdsRows; x.TDS.challans = tdsCh;

console.log("6. 43B: TDS left out, GST net of the input credit");
books([V("20260320", "Journal", [["Rent", -25000], ["TDS Payable 194C", 25000]]), V("20260321", "Sales", [["Ravi Stores", -200000], ["07 CGST OUTPUT", 100000], ["07 SGST OUTPUT", 100000]]),
  V("20260322", "Purchase", [["07 CGST INPUT", -80000], ["07 SGST INPUT", -80000], ["Supp A", 160000]]), V("20260323", "Journal", [["Salary", -2500], ["Professional Tax Payable", 2500]])]);
r = rowsOf(check("balances"), "43B");
const tot = r.reduce((s, z) => s + z.amount, 0);
ok(!r.some(z => /TDS/.test(z.party)), "TDS payable is not a 43B sum: " + JSON.stringify(r.map(z => [z.party, z.amount])));
ok(Math.abs(tot - 42500) < 0.01, "GST payable after credit 20,000 + 20,000, and professional tax 2,500: 42,500 (got " + tot + ")");

console.log("7. 43B(h): from FY 2023-24, and the time allowed asked when not set");
const msmeBooks = (to) => { books([V(to.slice(0, 4) + "0101", "Purchase", [["Purchase", -50000], ["Tiny Works", 50000, ]], {party: "Tiny Works", ref: "T-1"}), V(to.slice(0, 4) + "0305", "Purchase", [["Purchase", -30000], ["Tiny Works", 30000]], {party: "Tiny Works", ref: "T-2"})]);
  ctx.S.books.vouchers.forEach(v => { v.ent[1].b = [[v.ref, "New Ref", -v.ent[0].a]]; }); ctx.S.books.msme = {"Tiny Works": "Micro"}; ctx.S.books.meta.from = to.slice(0, 4) - 1 + "0401"; Object.values(ctx.S.books.ledInfo).forEach(i => { i.from = to.slice(0, 4) - 1 + "0401"; }); };
msmeBooks("20230331");
let old = [].concat(x.Audit.checks.msme43Bh(x.Audit, [], {from: "20220401", to: "20230331"}) || []).filter(Boolean);
ok(!old.length, "FY 2022-23: no 43B(h) finding (the section applies from FY 2023-24)");
msmeBooks("20260331");
let mf = [].concat(x.Audit.checks.msme43Bh(x.Audit, [], {from: "20250401", to: "20260331"}) || []).filter(Boolean);
ok(mf.some(z => !z.key && z.rows.length === 1 && z.rows[0].amount === 50000), "FY 2025-26: the bill 89 days old is beyond 45 days");
ok(mf.some(z => z.key === "days" && z.rows.length === 1 && z.rows[0].amount === 30000), "the bill 26 days old is asked about: the time agreed is not set (15 days without a written agreement)");
ctx.S.books.misCfg = {msmeDays: 15};
mf = [].concat(x.Audit.checks.msme43Bh(x.Audit, [], {from: "20250401", to: "20260331"}) || []).filter(Boolean);
ok(mf.length === 1 && !mf[0].key && mf[0].rows.length === 2 && mf[0].title.includes("15 days"), "set to 15 days: both bills are disallowed, nothing asked");

console.log("8. Form 3CD draft");
if (x.Audit.form3cd){
  // 21(b)(ii)(A) and 34(a): a 194C contractor with 5 bills of 1 lakh, TDS on 3 of them
  const fake = {from: FROM, to: TO, at: "2026-04-10T00:00:00Z", code: "X", findings: [{id: "tdsMissed:K|194C|2025-26", check: "tdsMissed", base: 200000, section: "194C", party: "K", count: 5, amount: 2000,
    rows: [1, 2, 3, 4, 5].map(k => ({date: "2025060" + k, no: String(k), type: "194C", party: "K", amount: 100000, note: "booked to Contract"}))}]};
  books([]);
  const allRows = x.TDS.allRows, iss = x.Certs.issues;
  x.TDS.allRows = () => [1, 2, 3].map(k => ({date: "2025060" + k, section: "194C", party: "K", paid: 100000, tds: 1000})); x.Certs.issues = () => [];
  const d = x.Audit.form3cd(fake), cl = no => d.clauses.find(c => c.no === no);
  const sum = (c, i) => c.rows.reduce((s, z) => s + z[i], 0);
  ok(sum(cl("21(b)(ii)(A)"), 1) === 200000, "21(b)(ii)(A): 2,00,000 disallowable, not the 5 bills' 5,00,000 (got " + sum(cl("21(b)(ii)(A)"), 1) + ")");
  ok(sum(cl("21(b)(ii)(A)"), 2) === 60000 && /Inadmissible/.test(cl("21(b)(ii)(A)").head[2]), "21(b)(ii)(A): 60,000 (30%) inadmissible under 40(a)(ia) (got " + sum(cl("21(b)(ii)(A)"), 2) + ")");
  const s34 = cl("34(a)").rows.find(z => z[0] === "194C") || [];
  ok(s34[1] === 500000 && s34[5] === 200000, "34(a) 194C: paid or credited 5,00,000 and without deduction 2,00,000 (got " + s34[1] + ", " + s34[5] + ")");
  x.TDS.allRows = allRows; x.Certs.issues = iss;
  ok(cl("31(c)") && !d.clauses.some(c => c.no === "31(b), 31(c)"), "clause 31(c) holds the 269T repayments");
  // every row: a finding of 1,400 cash payments keeps 1,000 in the run; the draft has all 1,400
  books([]);
  const big = Array.from({length: 1400}, (_, k) => ({key: "cash40A3|v" + k, vid: "v" + k, date: "20250" + (5 + (k % 4)) + "10", no: String(k), type: "Payment", party: "P" + k, amount: 10001, note: ""}));
  const st = {items: {}};
  big.forEach(z => { st.items[z.key] = {f: "cash40A3", title: "Cash", last: "2026-04-11T00:00:00Z", row: {date: z.date, no: z.no, party: z.party, amount: z.amount, note: z.note, type: z.type}}; });
  ctx.S.books.audit = st;
  const run2 = {from: FROM, to: TO, at: "2026-04-11T00:00:00Z", code: "Y", findings: [{id: "cash40A3", check: "cash40A3", count: 1400, amount: 1400 * 10001, rows: big.slice(0, 1000)}]};
  const d2 = x.Audit.form3cd(run2);
  ok(d2.clauses.find(c => c.no === "21(d)(A)").rows.length === 1400, "21(d)(A): all 1,400 cash payments, not the first 1,000");
  const h = x.Audit.form3cdHtml(d2);
  ok(/1,?200 more/.test(h) || (h.match(/<tr>/g) || []).length > 1400, "the printed draft says how many rows are not shown");
  // clause 44: depreciation, salary and its provision are not expenditure on goods and services
  books([V("20260331", "Journal", [["Depreciation", -500000], ["Plant", 500000]]), V("20260331", "Journal", [["Salary", -300000], ["Salary Payable", 300000]]),
    V("20250601", "Purchase", [["Purchase", -10000], ["Supp A", 10000]], {party: "Supp A"})]);
  const g = x.Audit.form3cd({from: FROM, to: TO, at: "", code: "", findings: []}).clauses.find(c => c.no === "44").rows[0];
  ok(g[0] === 10000 && g[5] === 10000, "clause 44: only the purchase of 10,000 (from an unregistered supplier), not depreciation or salary (got total " + g[0] + ", unregistered " + g[5] + ")");
} else ok(false, "Audit.form3cd is with the Audit screen's file (77-audit.js)");

console.log("9. 43B: GST set off as sections 49(5) and 49A with rule 88A allow (IGST credit first; CGST credit never for SGST)");
books([V("20260321", "Sales", [["Ravi Stores", -200000], ["07 SGST OUTPUT", 100000], ["07 IGST OUTPUT", 100000]]),
  V("20260322", "Purchase", [["07 IGST INPUT", -100000], ["07 CGST INPUT", -100000], ["Supp A", 200000]])]);
r = rowsOf(check("balances"), "43B");
const g9 = r.filter(z => /GST payable/.test(z.party)).reduce((s, z) => s + z.amount, 0);
ok(Math.abs(g9 - 100000) < 0.01, "output SGST 1,00,000 and IGST 1,00,000, credit IGST 1,00,000 and CGST 1,00,000: SGST 1,00,000 payable (got " + g9 + ")");
books([V("20260321", "Sales", [["Ravi Stores", -200000], ["07 IGST OUTPUT", 100000], ["07 CGST OUTPUT", 50000], ["07 SGST OUTPUT", 50000]]),
  V("20260322", "Purchase", [["07 IGST INPUT", -50000], ["07 CGST INPUT", -30000], ["07 SGST INPUT", -80000], ["Supp A", 160000]])]);
r = rowsOf(check("balances"), "43B");
const g9b = r.filter(z => /GST payable/.test(z.party)).reduce((s, z) => s + z.amount, 0);
ok(Math.abs(g9b - 40000) < 0.01, "output IGST 1,00,000, CGST 50,000, SGST 50,000; credit IGST 50,000 to IGST, CGST 30,000 to CGST, SGST 80,000 to SGST then 30,000 to IGST: CGST 20,000 and IGST 20,000 payable, 40,000 (got " + g9b + ")");

console.log("10. 269SS: interest credited to the lender is said, not counted silently");
books([V("20250501", "Receipt", [["Cash", -15000], ["Mohan Loan", 15000]]), V("20250930", "Journal", [["Interest on Loan", -1500], ["Mohan Loan", 1500]]),
  V("20251010", "Receipt", [["Cash", -4000], ["Mohan Loan", 4000]])]);
ctx.S.books.ledInfo["Mohan Loan"].ob = 0;
tk = rowsOf(check("cashLoans"), "269SS");
const t10 = tk.find(z => z.date === "20251010");
ok(t10 && /interest/i.test(t10.note) && /19,000/.test(t10.note), "4,000 in cash with 16,500 owed, 1,500 of it interest: flagged, and the note says the loan alone comes to 19,000 (got " + JSON.stringify(t10 && t10.note) + ")");

if (x.Audit.form3cd){
  console.log("11. Form 3CD 34(a) and 21(b)(ii)(A): a short deduction is at a lower rate, not without deduction; 30% of its uncovered part inadmissible");
  books([]);
  const allRows = x.TDS.allRows, iss = x.Certs.issues;
  x.TDS.allRows = () => [{date: "20250610", fy: "2025-26", section: "194C", party: "K", paid: 100000, tds: 1000, sepShort: true, covers: 50000}]; x.Certs.issues = () => [];
  const d = x.Audit.form3cd({from: FROM, to: TO, at: "", code: "", findings: [{id: "tdsMissed:K|194C|2025-26", check: "tdsMissed", base: 50000, section: "194C", party: "K", fy: "2025-26", count: 1, amount: 1000,
    rows: [{date: "20250610", no: "1", type: "194C", party: "K", amount: 100000, note: "booked to Contract"}]}]}), cl = no => d.clauses.find(c => c.no === no);
  const s34 = cl("34(a)").rows.find(z => z[0] === "194C") || [];
  ok(s34[1] === 100000 && s34[5] === 0 && s34[4] === 100000, "34(a) 194C: paid 1,00,000 (not 1,50,000), at a lower rate 1,00,000, without deduction nil (got " + JSON.stringify(s34) + ")");
  // (the owner, 23-Nov-2026) and 30% of the part its TDS does not cover is inadmissible under section 40(a)(ia), in 21(b),
  // as the ITR adds it back (app/src/lib/itr/books.js): the 50,000 once, not also as "without deduction" in 34(a)
  const kb = cl("21(b)(ii)(A)").rows.filter(z => z[0] === "K");
  ok(kb.length === 1 && kb[0][1] === 50000 && kb[0][2] === 15000 && /short/i.test(kb[0][3]), "21(b)(ii)(A): K's 50,000 not covered by the short TDS, 15,000 (30%) inadmissible under 40(a)(ia) (got " + JSON.stringify(cl("21(b)(ii)(A)").rows) + ")");
  ok(/40\(a\)\(ia\)/.test(cl("21(b)(ii)(A)").note) && /15,000/.test(cl("21(b)(ii)(A)").note) && /34\(a\)/.test(cl("21(b)(ii)(A)").note), "21(b)'s note: the 30% inadmissible, the short part also in 34(a) at a lower rate (" + cl("21(b)(ii)(A)").note + ")");
  // a party with a bill wholly without TDS and another deducted short: the two parts add up to the finding's base, once
  x.TDS.allRows = () => [{date: "20250710", fy: "2025-26", section: "194J", party: "M", paid: 200000, tds: 2000, sepShort: true, covers: 20000}];
  const d2 = x.Audit.form3cd({from: FROM, to: TO, at: "", code: "", findings: [{id: "tdsMissed:M|194J|2025-26", check: "tdsMissed", base: 280000, section: "194J", party: "M", fy: "2025-26", count: 2, amount: 28000,
    rows: [{date: "20250710", no: "7", type: "194J", party: "M", amount: 200000, note: "booked to Fees"}, {date: "20250810", no: "8", type: "194J", party: "M", amount: 100000, note: "booked to Fees"}]}]});
  const mb = d2.clauses.find(c => c.no === "21(b)(ii)(A)").rows.filter(z => z[0] === "M"), m34 = d2.clauses.find(c => c.no === "34(a)").rows.find(z => z[0] === "194J") || [];
  ok(mb.length === 2 && mb.reduce((a2, z) => a2 + z[1], 0) === 280000 && mb.reduce((a2, z) => a2 + z[2], 0) === 84000 && mb.some(z => z[1] === 180000) && mb.some(z => z[1] === 100000),
    "21(b): M's 2,80,000 not covered, once: 1,80,000 short of the rate and 1,00,000 without deduction; 84,000 (30%) inadmissible (got " + JSON.stringify(mb) + ")");
  ok(m34[4] === 200000 && m34[5] === 100000 && m34[1] === 300000, "34(a) 194J: at a lower rate 2,00,000, without deduction 1,00,000 (not 2,80,000), paid 3,00,000 (got " + JSON.stringify(m34) + ")");
  x.TDS.allRows = allRows; x.Certs.issues = iss;

  console.log("12. clause 44: auditor's remuneration and staff welfare are bought from suppliers; partners' and directors' pay is not; a non-employee director's fee is, with reverse charge GST");
  books([V("20250601", "Purchase", [["Purchase", -10000], ["Supp A", 10000]], {party: "Supp A"}), V("20260331", "Journal", [["Auditor's Remuneration", -50000], ["Audit Firm", 50000]], {party: "Audit Firm"}),
    V("20250815", "Payment", [["Staff Welfare", -20000], ["Cash", 20000]]), V("20260331", "Payment", [["Partners Remuneration", -300000], ["Made-up Bank", 300000]]),
    V("20260331", "Payment", [["Directors Remuneration", -200000], ["Made-up Bank", 200000]])]);
  const g12 = x.Audit.form3cd({from: FROM, to: TO, at: "", code: "", findings: []}).clauses.find(c => c.no === "44").rows[0];
  ok(g12[0] === 80000, "clause 44: 10,000 + auditor 50,000 + staff welfare 20,000 = 80,000; not the partners' or directors' 5,00,000 (got " + g12[0] + ")");
  // (the owner, 23-Nov-2026) by default: a whole-time or managing director's pay is an employee's (out, Schedule III); a
  // fee to a director who is not an employee is a supply under reverse charge (Notification 13/2017-CT(Rate), entry 6;
  // circular 140/10/2020-GST): in clause 44 (with unregistered suppliers), its GST under reverse charge said
  Object.assign(UNDER, {"Remuneration to Whole-time Director": "Indirect Expenses", "Managing Director Salary": "Indirect Expenses", "WTD Remuneration": "Indirect Expenses", "Directors Sitting Fees": "Indirect Expenses"});
  books([V("20250601", "Purchase", [["Purchase", -10000], ["Supp A", 10000]], {party: "Supp A"}), V("20260331", "Payment", [["Remuneration to Whole-time Director", -400000], ["Made-up Bank", 400000]]),
    V("20260331", "Payment", [["Managing Director Salary", -300000], ["Made-up Bank", 300000]]), V("20260331", "Payment", [["WTD Remuneration", -100000], ["Made-up Bank", 100000]]),
    V("20250930", "Payment", [["Directors Sitting Fees", -50000], ["Made-up Bank", 50000]])]);
  const c44 = x.Audit.form3cd({from: FROM, to: TO, at: "", code: "", findings: []}).clauses.find(c => c.no === "44"), g44 = c44.rows[0];
  ok(g44[0] === 60000 && g44[5] === 60000, "clause 44: the purchase 10,000 and the sitting fees 50,000 (unregistered); not the whole-time, managing or WTD director's 8,00,000 (got total " + g44[0] + ", unregistered " + g44[5] + ")");
  ok(/sitting fees|director/i.test(c44.note) && /50,000/.test(c44.note) && /reverse charge/i.test(c44.note) && /9,000/.test(c44.note), "clause 44's note: 50,000 of fees to directors who are not employees, GST 9,000 under reverse charge (" + c44.note + ")");

  console.log("13. clause 31(bc): cash paid of 2 lakh or more that 40A(3) leaves out is listed to check");
  books([V("20250720", "Payment", [["Mohan Loan", -250000], ["Cash", 250000]]), V("20250721", "Payment", [["Capital", -300000], ["Cash", 300000]]), V("20250722", "Payment", [["Ravi Stores", -150000], ["Cash", 150000]])]);
  ctx.S.books.ledInfo["Mohan Loan"].ob = 500000;
  const fx = [].concat(check("cash40A3") || []).filter(Boolean).map(z => Object.assign({id: "cash40A3", check: "cash40A3", count: z.rows.length}, z));
  const c31 = x.Audit.form3cd({from: FROM, to: TO, at: "", code: "", findings: fx}).clauses.find(c => c.no === "31(bc)");
  ok(c31.rows.length === 2 && c31.rows.some(z => z[1] === "Mohan Loan" && z[2] === 250000) && c31.rows.some(z => z[1] === "Capital" && z[2] === 300000) && /check/i.test(c31.note),
    "31(bc): the loan repaid (2,50,000) and the capital drawn (3,00,000) in cash are listed to check; 1,50,000 to Ravi Stores is under 2 lakh (got " + JSON.stringify(c31.rows) + ", " + c31.note + ")");
}

console.log("14. the audit run is stale once the MSME days are changed (MIS settings)");
books([V("20250601", "Purchase", [["Purchase", -10000], ["Supp A", 10000]], {party: "Supp A"})]);
const r14 = x.Audit.run(FROM, TO, "test");
ok(!x.Audit.stale(r14), "just run: not stale");
ctx.S.books.misCfg = {msmeDays: 15};
ok(!!x.Audit.stale(r14), "the MSME days set to 15 after the run: the run is stale, so the Audit tab asks to run it again");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
