// node run_audit_wp.js - the audit working papers (src/js/77-audit.js) on the made-up book of tests/audit_fixture.js:
//   1. every check finds exactly its seeded entries (voucher id, party where it is not a voucher, amount to the paisa);
//   2. Benford's test on known distributions (exactly Benford: passes, chi-square 0; equal first digits: fails, and the
//      chi-square equals the hand-worked figure);
//   3. the risk score and the ranking are the documented formula; the same books give the same result code;
//   4. the Excel file opens, its cells equal the computed figures, and its totals are formulas;
//   5. the working papers (status, remark) are kept with the books as items (BOOKS_KEYS), and the run kept for the Assistant;
//   6. nothing is written to the vouchers; the run takes under 5 seconds.
const fs = require("fs"), path = require("path"), vm = require("vm");
const {load, HTML, OUT} = require("./harness"), {makeBooks, finish} = require("./audit_fixture");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev", "GSTAmend",
  "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "gramsOf", "gfN", "Parties", "FS", "GSTSet", "GSTF", "GSTQ", "D", "AS26", "GSTCMP", "GSTAPI", "TDSRate", "TDSInt", "GSTIN_RE", "TDSFiled", "ClosedP",
  "BOOKS_KEYS", "AuditWP"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const f = makeBooks();
ctx.S.books = f.books; ctx.S.coId = "cfix"; ctx.S.companies = {cfix: f.company}; ctx.CO = () => f.company; ctx.S.data = {};
let saved = 0; ctx.saveBooks = () => { saved++; }; ctx.whoAmI = () => "tester@fincom";
finish(f, x);
const before = JSON.stringify(f.books.vouchers);

// ---------------------------------------------------------------- 1. each check finds exactly the seeded entries
const t0 = Date.now(), res = x.AuditWP.run(f.from, f.to), took = Date.now() - t0;
const E = f.expected, key = (e) => [e.vid || "", e.vid ? "" : e.party || "", Number(e.amount).toFixed(2)].join("|");
const want = {cash40A3: E.cash40A3, cash269ST: E.cash269ST, cashLoans: E.cashLoans, tds: E.tds, msme43Bh: E.msme43Bh, itc2b: E.itc2b, turnover: E.turnover, tds26as: E.tds26as,
  duplicates: E.duplicates, backdated: E.backdated, ledgers: E.ledgers, round: E.round, weekend: E.weekend, benford: []};
ok(res.checks.length === 14 && x.AuditWP.CHECKS.every((c) => res.checks.some((r) => r.id === c.id)), "14 checks run");
Object.entries(want).forEach(([id, exp]) => {
  const c = res.checks.find((r) => r.id === id);
  const got = c.entries.map((e) => key(id === "turnover" ? {vid: "", party: e.type, amount: e.amount} : id === "tds26as" && !e.vid ? {vid: "", party: "", amount: e.amount} : e)).sort();
  const w = exp.map((e) => key(id === "turnover" ? {vid: "", party: e.type, amount: e.amount} : e)).sort();
  const same = JSON.stringify(got) === JSON.stringify(w);
  const amt = Math.round(exp.reduce((s, e) => s + Math.abs(e.amount), 0) * 100) / 100;
  ok(same && c.count === exp.length && c.amount === amt && c.status === (exp.length ? "flag" : "ok"),
    id + ": " + c.status + ", " + c.count + " entries, " + c.amount.toFixed(2) + (same ? "" : "\n         got  " + got.join("  ") + "\n         want " + w.join("  ")));
});
// every entry of a voucher links to a voucher in the books
const ids = new Set(f.books.vouchers.map((v) => v.id));
ok(res.checks.every((c) => c.entries.every((e) => !e.vid || ids.has(e.vid))) && res.checks.every((c) => c.entries.every((e) => e.id && e.id.startsWith(c.id + ":"))), "every entry has an id; every voucher id is in the books");
ok(res.checks.find((c) => c.id === "tds").entries.some((e) => /^short/.test(e.note) && e.vid) && res.checks.find((c) => c.id === "tds").entries.some((e) => /^interest/.test(e.note) && e.vid), "TDS: short and late entries keep their voucher (FinCom's TDS rows)");
ok(JSON.stringify(f.books.vouchers) === before, "no write to the vouchers");
ok(took < 5000, "the run on the fixture took " + took + " ms (under 5 s)");

// ---------------------------------------------------------------- 2. Benford
const ben = res.checks.find((c) => c.id === "benford").benford;
let chi = 0; for (let d = 1; d <= 9; d++){ const o = ben.digits[d - 1].obs, e = ben.n * Math.log10(1 + 1 / d); chi += (o - e) * (o - e) / e; }
ok(Math.abs(chi - ben.chi2) < 0.0001 && ben.pass && ben.n === res.entries, "fixture: chi-square " + ben.chi2 + " on " + ben.n + " amounts, worked again here; passes");
// exactly Benford: 1,000 amounts, log-spread over three decades
const exact = Array.from({length: 3000}, (_, i) => Math.pow(10, 1 + 3 * (i + 0.5) / 3000));
const b1 = x.AuditWP.benfordTest(exact);
ok(b1.n === 3000 && b1.pass && b1.chi2 < 0.05, "Benford-distributed amounts pass (chi-square " + b1.chi2 + ")");
// equal first digits: 100 of each; chi-square = sum (100 - 900 p)^2 / (900 p)
const uni = []; for (let d = 1; d <= 9; d++) for (let i = 0; i < 100; i++) uni.push(d * 1000 + i + 0.5);
const b2 = x.AuditWP.benfordTest(uni);
let hand = 0; for (let d = 1; d <= 9; d++){ const e = 900 * Math.log10(1 + 1 / d); hand += (100 - e) * (100 - e) / e; }
ok(!b2.pass && Math.abs(b2.chi2 - Math.round(hand * 10000) / 10000) < 1e-9 && b2.chi2 > 15.507, "equal first digits fail: chi-square " + b2.chi2 + " (hand-worked " + hand.toFixed(4) + ")");
ok(x.AuditWP.benfordTest([12, 250, 3]).n === 3 && x.AuditWP.firstDigit(0.045) === 4 && x.AuditWP.firstDigit(98765.43) === 9, "first digit read right (0.045 is 4, 98,765.43 is 9)");

// ---------------------------------------------------------------- 3. the risk score and ranking
const sc = (w, n, a) => Math.round(w * (1 + Math.log10(1 + a / 1000)) * (1 + Math.log10(n)) * 10) / 10;
ok(res.checks.every((c) => c.score === (c.status === "flag" ? sc(c.weight, c.count, c.amount) : 0)), "every score is weight x (1 + log10(1 + amount/1000)) x (1 + log10(count)); 0 when not flagged");
const ranked = res.ranked.map((id) => res.checks.find((c) => c.id === id));
ok(ranked.every((c, i) => i === 0 || ranked[i - 1].score > c.score || (ranked[i - 1].score === c.score && (ranked[i - 1].weight > c.weight || (ranked[i - 1].weight === c.weight && ranked[i - 1].id < c.id)))), "ranked by score, then weight, then id: " + res.ranked.slice(0, 4).join(", ") + " ...");
const res2 = x.AuditWP.run(f.from, f.to);
ok(res2.code === res.code && JSON.stringify(res2.checks) === JSON.stringify(res.checks), "the same books give the same result (code " + res.code + ")");
const one = x.AuditWP.check("cash269ST", f.from, f.to);
ok(one && one.id === "cash269ST" && one.count === 2 && one.amount === res.checks.find((c) => c.id === "cash269ST").amount && x.AuditWP.check("nope", f.from, f.to) === null, "one check's detail (audit_check) is the same as in the run");
// a shorter period finds only what is in it
const q1 = x.AuditWP.run("20250401", "20250630");
ok(q1.checks.find((c) => c.id === "cash269ST").count === 0 && q1.checks.find((c) => c.id === "cash40A3").count === 3, "Q1 only: 40A(3) 3, 269ST none (July)");
// the period words the Assistant passes
const P = (s) => JSON.stringify(x.AuditWP.parsePeriod(s));
ok(P("2025-26") === JSON.stringify({from: "20250401", to: "20260331"}) && P("Q2 2025-26") === JSON.stringify({from: "20250701", to: "20250930"}) && P("2026-02") === JSON.stringify({from: "20260201", to: "20260228"})
  && P("2025-04-01..2025-12-31") === JSON.stringify({from: "20250401", to: "20251231"}) && P("20250401-20260331") === JSON.stringify({from: "20250401", to: "20260331"}) && P("2025-27") === "null" && P("") === "null", "periods: FY, quarter, month, date range");

// ---------------------------------------------------------------- 5. the working papers, kept with the books
ok(x.BOOKS_KEYS.includes("auditWp"), "auditWp is one of the books' keys (shared through client_books, merged item by item)");
const per = f.from + "-" + f.to;
ok(x.AuditWP.setWp(per, "cash269ST", "status", "issue") && x.AuditWP.setWp(per, "cash269ST", "remark", "Receipts to be explained by the client") && x.AuditWP.setWp(per, "round", "status", "rev"), "status and remark set");
ok(!x.AuditWP.setWp(per, "cash269ST", "status", "maybe") && !x.AuditWP.setWp(per, "nope", "status", "rev"), "an unknown status or check is refused");
const it = f.books.auditWp.find((z) => z.id === "wp|" + per + "|cash269ST");
ok(it && it.kind === "wp" && it.status === "issue" && it.remark === "Receipts to be explained by the client" && it.by === "tester@fincom" && f.books.auditWp.every((z) => typeof z.id === "string"), "kept as an item with an id, who and when");
x.AuditWP.keepRun(res);
const kr = f.books.auditWp.find((z) => z.id === "run|" + per);
ok(kr && kr.code === res.code && kr.checks.length === 14 && kr.checks.every((c, i) => c.amount === res.checks[i].amount && c.count === res.checks[i].count && c.score === res.checks[i].score) && saved >= 4, "the run is kept for the Assistant, with the same figures");

// ---------------------------------------------------------------- 4. the Excel file
const xl = {console, Uint8Array, ArrayBuffer, DataView, Date, Math, JSON, String, Number, Array, Object, RegExp, Error, TypeError, parseInt, parseFloat, isNaN, Buffer, setTimeout, TextEncoder, TextDecoder};
vm.createContext(xl);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "assets", "xlsx.js"), "utf8") + ";globalThis.__X = XLSX;", xl);
ctx.XLSX = xl.__X;
const file = path.join(OUT, "audit-working-papers.xlsx");
fs.writeFileSync(file, xl.__X.write(x.AuditWP.book(res, f.books), {bookType: "xlsx", type: "buffer"}));
const wb = xl.__X.read(fs.readFileSync(file), {type: "buffer", cellFormula: true});
ok(["Summary", "Entries", "Benford"].every((n) => wb.SheetNames.includes(n)), "the file opens: sheets " + wb.SheetNames.join(", "));
const S = wb.Sheets.Summary, rows = xl.__X.utils.sheet_to_json(S, {header: 1, raw: true});
const hi = rows.findIndex((r) => r[0] === "Rank"), body = rows.slice(hi + 1, hi + 15);
ok(body.length === 14 && body.every((r, i) => { const c = ranked[i]; return r[1] === c.title && r[4] === c.count && r[5] === c.amount && r[6] === c.score && typeof r[5] === "number"; }), "Summary: one row per check in rank order, count, amount and score as numbers equal to the run");
ok(body.find((r) => r[1] === res.checks.find((c) => c.id === "cash269ST").title)[7] === "Issue" && body.find((r) => r[1] === res.checks.find((c) => c.id === "cash269ST").title)[8] === "Receipts to be explained by the client", "Summary: the review status and remark");
const tr = hi + 16, fE = S["E" + tr], fF = S["F" + tr], fG = S["G" + tr];
ok(fE && fE.f === "SUM(E" + (hi + 2) + ":E" + (hi + 15) + ")" && fF.f === "SUM(F" + (hi + 2) + ":F" + (hi + 15) + ")" && fG.f && /^SUM/.test(fG.f), "Summary totals are formulas: " + fE.f + ", " + fF.f);
const sumF = Math.round(body.reduce((s, r) => s + r[5], 0) * 100) / 100, sumE = body.reduce((s, r) => s + r[4], 0);
ok(fE.v === sumE && fF.v === sumF && sumF === Math.round(res.checks.reduce((s, c) => s + c.amount, 0) * 100) / 100, "the totals' values equal the cells above and the run: " + sumE + " entries, " + sumF.toFixed(2));
const ER = xl.__X.utils.sheet_to_json(wb.Sheets.Entries, {header: 1, raw: true}), all = res.checks.reduce((s, c) => s + c.entries.length, 0);
ok(ER.length === all + 2 && ER.slice(1, -1).every((r) => typeof r[5] === "number"), "Entries: every entry (" + all + "), amounts as numbers");
const eT = wb.Sheets.Entries["F" + (all + 2)];
ok(eT && eT.f === "SUBTOTAL(9,F2:F" + (all + 1) + ")" && Math.abs(eT.v - ER.slice(1, -1).reduce((s, r) => s + r[5], 0)) < 0.005, "Entries total is a SUBTOTAL formula with the right value");
const BR = xl.__X.utils.sheet_to_json(wb.Sheets.Benford, {header: 1, raw: true});
ok(BR.length === 11 && BR.slice(1, 10).every((r, i) => r[0] === i + 1 && r[1] === ben.digits[i].obs) && wb.Sheets.Benford.D11.f === "SUM(D2:D10)" && wb.Sheets.Benford.D11.v === ben.chi2, "Benford sheet: digits, observed, and the chi-square as a formula");
// the PDF's page: every check and its entries
const h = x.AuditWP.html(res, f.books);
ok(res.checks.every((c) => h.includes(x.esc(c.title))) && h.includes("Receipts to be explained by the client") && (h.match(/<tr>/g) || []).length >= all, "the PDF page lists every check, the remarks and the entries");

// the items as the books keep them, for the Assistant's tool test (tests/run_audit_wp_tool.py): the run and the working papers,
// and the figures the run gave, to compare to the paisa
fs.writeFileSync(path.join(OUT, "audit-wp-items.json"), JSON.stringify({items: f.books.auditWp, period: per, run: {code: res.code, checks: res.checks.map((c) => ({id: c.id, status: c.status, count: c.count, amount: c.amount, score: c.score, rank: c.rank, vids: c.entries.slice(0, 50).map((e) => e.vid)}))},
  periods: ["2025-26", "Q2 2025-26", "Q4 2025-26", "2026-02", "2024-02", "2025-04-01..2026-03-31", "20250401-20260331", "2025-27", "FY 2025-2026", "x"].map((s) => [s, x.AuditWP.parsePeriod(s)])}, null, 1));
console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
