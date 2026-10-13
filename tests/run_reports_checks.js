// node run_reports_checks.js - Step 3: the 27 checks of the spec (section 4) before any output (FSX.check, src/js/78-reports.js).
// For each check: the clean made-up books pass it, and one seeded error (most of them the errors found in the owner's two
// samples: the MSME split, shares x face value, premium without an issue, negative additions, a short-term loan in the
// long-term table, a broken note reference, duplicated text, a 7-digit DIN, a 1-2 rupee difference between a note and the
// face) makes it fail with a message. Nothing is fixed by the checks. Test data only.
const F = require("./reports_fixtures"), X = F.loadFSX();
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const clone = o => JSON.parse(JSON.stringify(o));
const tbSet = (fx, l, f) => { fx.tb = fx.tb.map(t => t.l === l ? Object.assign({}, t, f(t)) : t); return fx; };
const build = (fx, mapEdit) => { let st = F.confirmed(X, fx); if (mapEdit) st = mapEdit(st); return X.run(Object.assign({}, fx, {mapStore: st})); };
const clean = {company: build(F.company()), firm: build(F.firm())};
const after = (r, mutate) => { mutate(r.model); X.number(r.model); return X.check(r.model); };
// [check, which books, what is seeded, (fixture) => checks]
const SEEDS = [
  [1, "company", "an opening balance typed ₹5,000 wrong: the balance sheet does not tally", () => build(tbSet(F.company(), "Cash", t => ({o: t.o + 5000}))).checks],
  [2, "company", "the profit for the year altered by hand on the face", () => after(build(F.company()), M => { M.nm.T_pat_CY += 10000; })],
  [3, "firm", "the income-tax block's opening WDV ₹2 off the books: the note's closing WDV differs from the face by ₹1-2", () => { const fx = F.firm(); fx.det.itBlocks.cy[0].open = 340002; return build(fx).checks; }],
  [4, "company", "an amount in a note changed, so the note no longer adds up", () => after(build(F.company()), M => { const n = M.notes.find(z => z.key === "ocl"); n.tables[0].rows[0].c[0].v += 10000; })],
  [5, "company", "last year's closing of a deposit is not this year's opening", () => build(tbSet(F.company(), "Rent Deposit", t => ({po: t.po + 5000, o: t.o}))).checks],
  [6, "company", "the current year's payables ageing puts the whole balance in the MSME row (Sample B)", () => { const fx = F.company(); const a = fx.age.tp.cy; const all = [0, 1, 2, 3, 4, 5].map(i => F.r2(a.msme[i] + a.others[i])); a.msme = all; a.others = [0, 0, 0, 0, 0, 0]; return build(fx).checks; }],
  [7, "company", "the face value changed from last year with no shares issued (Sample B)", () => { const fx = F.company(); fx.det.shares.issued.cy.fv = 5; return build(fx).checks; }],
  [8, "company", "a securities premium added with no shares issued in the reconciliation (Sample B)", () => { const fx = F.company(); fx.det.shares.issuedDuring.cy.n = 0; fx.det.shares.issued.py.n = 120000; return build(fx).checks; }],
  [9, "company", "an adjustment in the surplus with no caption (Sample B)", () => { const fx = F.company(); tbSet(fx, "Profit & Loss A/c", t => ({d: t.d + 10000})); tbSet(fx, "Kite Bank Current A/c", t => ({c: t.c + 10000})); return build(fx).checks; }],
  [10, "firm", "the partners' shares add to 90%", () => { const fx = F.firm(); fx.det.partners[1].share = 30; return build(fx).checks; }],
  [11, "company", "negative additions in the fixed asset register (Sample B nets depreciation that way)", () => { const fx = F.company(); fx.det.far.cy[0].gAdd = -50000; fx.det.far.cy[0].gDel = -250000; return build(fx).checks; }],
  [12, "company", "the cash credit, a short-term borrowing, listed in the long-term repayment terms (Sample B)", () => { const fx = F.company(); fx.det.loans[2].table = "ltb"; return build(fx).checks; }],
  [13, "company", "last year's closing stock given is not this year's opening stock", () => { const fx = F.company(); fx.det.stock.py = {"Finished Goods": 290000, "Raw Materials": 200000}; return build(fx).checks; }],
  [14, "company", "the deferred tax charge does not match the movement in the deferred tax asset", () => { const fx = F.company(); tbSet(fx, "Deferred Tax", t => ({d: t.d + 1000})); tbSet(fx, "Kite Bank Current A/c", t => ({c: t.c + 1000})); return build(fx).checks; }],
  [15, "company", "diluted EPS differs from basic with no potential equity shares", () => { const fx = F.company(); fx.det.eps = {dilEarn: 5000}; return build(fx).checks; }],
  [16, "company", "a ratio varies by more than 25% with no explanation (both samples)", () => { const fx = F.company(); const r = build(fx).model.ratioList.find(z => z.needs); delete fx.det.ratioExplain[r.key]; return build(fx).checks; }],
  [17, "company", "a loan to a director, but the loans-to-directors table left blank (Sample B)", () => { const fx = F.company(); fx.det.rpLoans = []; return build(fx).checks; }],
  [18, "company", "a note printed but its line taken off the face", () => after(build(F.company()), M => { M.nm.L_oca_CY = 0; M.nm.L_oca_PY = 0; })],
  [19, "company", "\"Refer Note -, 16\" in the regulatory information (Sample B)", () => { const fx = F.company(); fx.det.ari = {rpLoans: {yes: true, text: "Refer Note -, 16."}}; return build(fx).checks; }],
  [20, "company", "the impairment paragraph repeated under Investments (Sample B)", () => { const fx = F.company(); const imp = X.policies("company").find(p => p.title === "Impairment of Assets").text.replace(/\{E\}/g, "the Company"); fx.det.policies = {text: {"2.5": imp.replace(/^at/, "At")}}; return build(fx).checks; }],
  [21, "company", "the CIN left out: \"The CIN of the Company is\" with no value (Sample B)", () => { const fx = F.company(); fx.entity.cin = ""; return build(fx).checks; }],
  [22, "firm", "a firm's policy says \"the Proprietor\" (Sample A)", () => { const fx = F.firm(); fx.det.policies = {text: {"2.1": "The Financial Statements of the Proprietor have been prepared under the historical cost convention."}}; return build(fx).checks; }],
  [23, "company", "a related party's previous-year balance left blank (Sample B)", () => { const fx = F.company(); fx.det.rp.bal.push({name: "C Shah", relation: "Relative of a director", nature: "Advance (Asset)", cy: 10000, py: null}); return build(fx).checks; }],
  [24, "company", "a 7-digit DIN, and no UDIN or date (Sample B)", () => { const fx = F.company(); fx.det.sign.directors[1].din = "7654321"; fx.det.sign.auditor.udin = ""; fx.det.sign.auditor.date = ""; return build(fx).checks; }],
  [25, "company", "the units line says lakhs while whole rupees are used, and a column dated two years back", () => after(build(F.company()), M => { M.units = "(All amounts in ₹ lakhs)"; M.notes.find(n => n.key === "ocl").tables[0].cols[2].h = "As at March 31, 2023"; })],
  [26, "company", "a term loan from a bank shown as unsecured (a warning)", () => build(F.company(), st => X.editMap(st, "Kite Bank Term Loan", "ltb", "Unsecured|Term loans from banks", "company")).checks],
  [27, "company", "a blank page between the notes (Sample A's page 6)", () => after(build(F.company()), M => { M.pages.splice(4, 0, {kind: "notes", items: []}); })]
];
ok(SEEDS.length === 27 && SEEDS.every((s, i) => s[0] === i + 1), "one seeded error for each of the 27 checks");
ok(clean.company.checks.length === 27 && clean.company.checks.every(c => c.ok) && clean.firm.checks.every(c => c.ok), "the clean company and firm pass all 27");
SEEDS.forEach(([id, which, what, seed]) => {
  const before = clean[which].checks.find(c => c.id === id);
  let checks; try { checks = seed(); } catch (e){ ok(false, "check " + id + ": the seed failed to build: " + e.message); return; }
  const c = checks.find(z => z.id === id);
  ok(before.ok && c && !c.ok && c.items.length > 0, "check " + String(id).padStart(2) + " (" + c.level + "): " + what + "\n         -> " + (c && c.items[0] || "NOT CAUGHT"));
});
// nothing is fixed: the statements built with an error keep it, and the failure is listed for the user
const r = build(tbSet(F.company(), "Cash", t => ({o: t.o + 5000})));
ok(r.fails.some(c => c.id === 1) && r.model.res.CY.round.v !== 0 && r.summary.checksFailed >= 1, "a failure is listed for the user; nothing is auto-fixed (the difference stays visible in Rounding Off)");
// the checks run before output: the Excel has a Checks sheet listing the failures
const ex = X.excel(r.model, r.checks);
ok(ex.sheets.some(s => s.name === "Checks" && s.rows.some(row => row[2] === "FAIL")), "the Excel carries the failed checks on its Checks sheet");
console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
