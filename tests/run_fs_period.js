// node run_fs_period.js - financial statements for a period of the year (owner, 29-Oct-2026: "if I want to make fs for a
// particular period then I should be able to create that") and last year's balance sheet uploaded to map the ledgers.
// On the made-up books of tests/fixtures/fin-statements, each year's movements spread over four quarter-end journals
// (20% / 30% / 25% / the rest) so a part of the year has figures of its own:
//   - the full year is today's statements to the rupee (the same books with one journal a year give the same figures,
//     and a period of "Full year" is build() without a period);
//   - H1 (April-September): the P&L is exactly the movements of those six months, the balance sheet is as on 30
//     September (opening + movements to that day) and ties, the cash flow ends at the cash on 30 September, and the
//     comparative column is H1 of the year before;
//   - Q2 (July-September): the P&L is the quarter's, the balance sheet the same as H1's, and the profit of April-June sits
//     in Note 4 as its own line, so the balance sheet ties;
//   - no comparative when the copy does not hold the same period of last year (a one-line note);
//   - the computation of income is for a full year only;
//   - FinPyBs (src/js/88-fin-pybs.js) reads last year's balance sheet from sheet rows and from a PDF's text lines (Indian
//     numbers, brackets for a negative), gives each line its code, uses it as the PY column when the copy has no previous
//     year, suggests ledgers' codes from it (never over a hand choice) and compares it with FinCom's opening balances.
const {load, HTML} = require("./harness"), fs = require("fs"), path = require("path");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "FS", "FinSt", "FinPyBs", "INR"];
const {ctx, x} = load(HTML, NAMES);
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const eq = (a, b, w) => ok(Math.abs((a == null ? NaN : a) - b) < 1e-6, w + ": " + a + (Math.abs((a == null ? NaN : a) - b) < 1e-6 ? "" : " (expected " + b + ")"));
const FIX = path.join(__dirname, "fixtures", "fin-statements"), read = f => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const C = read("company.json"), Fm = read("firm.json"), PYBS = read("py-bs-2025.json");
const r2 = v => Math.round(v * 100) / 100, W = [0.2, 0.3, 0.25], QE = ["0630", "0930", "1231", "0331"];
// a movement split over the four quarters: 20%, 30%, 25% and what is left, each to the paisa
const parts = v => { const a = W.map(w => r2(v * w)); return a.concat([r2(v - a[0] - a[1] - a[2])]); };
const shift = end => String(Number(end.slice(0, 4)) - 1) + end.slice(4);
// years: [end, closing BS, P&L, previous closing]; quarters: one journal per quarter end, else one journal at the year end
function books(F, from, years, quarters, open){
  const under = Object.assign({}, F.groups), led = {};
  Object.entries(open || F.o).forEach(([n, v]) => { led[n] = {open: -v, close: 0, parent: under[n]}; });
  const vouchers = [], bank = Object.keys(under).find(n => under[n] === "Bank Accounts");
  (F.additions || []).filter(([, d]) => d >= from).forEach(([l, d, a], i) => vouchers.push({id: "a" + i, date: d, type: "Journal", narr: "Purchase of " + l, ent: [{l, a: -a}, {l: bank, a}]}));
  years.forEach(([end, bs, pl, prev]) => {
    const mv = {}, y = Number(end.slice(0, 4)) - 1;
    Object.keys(bs).forEach(n => { if (n === bank) return; const added = (F.additions || []).filter(([l, d]) => l === n && d <= end && d > shift(end)).reduce((s, z) => s + z[2], 0);
      const m = r2((bs[n] || 0) - (prev[n] || 0) - added); if (m) mv[n] = m; });
    Object.entries(pl).forEach(([n, v]) => { if (v) mv[n] = v; });
    (quarters ? [0, 1, 2, 3] : [3]).forEach(q => {
      const ent = [];
      Object.entries(mv).forEach(([n, v]) => { const a = quarters ? parts(v)[q] : v; if (a) ent.push({l: n, a: -a}); });
      ent.push({l: bank, a: r2(-ent.reduce((s, e) => s + e.a, 0))});
      vouchers.push({id: "m" + end + q, date: (q === 3 ? y + 1 : y) + QE[q], type: "Journal", narr: "Movements (fixture)", ent});
    });
  });
  return {under, groups: {}, ledInfo: {}, vouchers, meta: {from}, tb: {from, to: "20260331", at: "2026-04-30T10:00:00Z", src: "copy", led}, msme: {}, fs: {}};
}
const CO = {name: "Larkspur Analytics Private Limited", pan: "AABCL1234F", cin: "U72900KA2015PTC000001"};
const company = q => { const b = books(C, "20240401", [["20250331", C.p, C.plp, C.o], ["20260331", C.c, C.plc, C.p]], q); b.msme = {"Bluebell Print Works": "Micro"}; b.fs = {taxDep: {"2024": {c40: 220000, pm15: 140000, f10: 80000}}}; return b; };
const use = b => { ctx.S.books = b; ctx.CO = () => CO; return b; };
ctx.S.firm = {firmName: "Made-up & Associates", frn: "000000S", partner: "A. Sample", mno: "000001", place: "Bengaluru"};
const figs = d => JSON.stringify({notes: d.notes, bs: d.bs, pl: d.pl, cf: d.cf, ppe: d.ppe, intang: d.intang, checks: d.checks, comp: d.comp && d.comp.lines});
const note = (d, k) => d.notes.find(z => z.key === k) || {total: {}, lines: [], groups: {}};
const line = (d, k, code) => (note(d, k).lines || []).find(z => z.code === code) || {};
const PLTAX = ["Income Tax - Current Year", "Income Tax - Prior Period", "Deferred Tax Expense"];

try {
  const FinSt = x.FinSt;
  ok(typeof FinSt.periods === "function" && typeof FinSt.periodOf === "function", "FinSt.periods / periodOf are there");

  console.log("\nThe presets of a year (2025-26)");
  const P = Object.fromEntries((FinSt.periods ? FinSt.periods("2025", {today: "20251115"}) : []).map(p => [p.key, p]));
  const want = {fy: ["20250401", "20260331"], h1: ["20250401", "20250930"], q1: ["20250401", "20250630"], q2: ["20250701", "20250930"], q3: ["20251001", "20251231"], q4: ["20260101", "20260331"],
    m9: ["20250401", "20251231"], ytd: ["20250401", "20251115"]};
  Object.entries(want).forEach(([k, [f, t]]) => ok(P[k] && P[k].from === f && P[k].to === t, k + ": " + (P[k] ? P[k].label + " " + P[k].from + "-" + P[k].to : "missing")));
  ok(P.custom && P.fy.label === "Full year" && /H1/.test(P.h1.label) && /9 months/.test(P.m9.label) && /Year to date/.test(P.ytd.label), "the labels: " + Object.values(P).map(p => p.label).join(" · "));
  const cu = FinSt.periodOf ? FinSt.periodOf("2025", {preset: "custom", from: "20250815", to: "20251120"}) : {};
  ok(cu.from === "20250815" && cu.to === "20251120" && !cu.full, "custom: 15-Aug to 20-Nov");
  const cl = FinSt.periodOf ? FinSt.periodOf("2025", {preset: "custom", from: "20250101", to: "20270101"}) : {};
  ok(cl.from === "20250401" && cl.to === "20260331" && cl.full, "custom dates outside the year are held to it (" + cl.from + "-" + cl.to + ")");
  const yt = FinSt.periodOf ? FinSt.periodOf("2024", {preset: "ytd"}, {today: "20261029"}) : {};
  ok(yt.to === "20250331" && yt.full, "year to date of a closed year is the full year");

  console.log("\nThe full year is today's statements, to the rupee");
  const oneF = figs(use(company(false)) && FinSt.build("2025", {unit: 1, dec: 2}));
  use(company(true));
  const base = FinSt.build("2025", {unit: 1, dec: 2}), viaP = FinSt.build("2025", {unit: 1, dec: 2, period: {preset: "fy"}});
  ok(!base.error && figs(base) === figs(viaP), "a period of Full year is build() without a period, figure for figure");
  ok(figs(base) === oneF, "the books in quarters give the full year of the books in one journal a year (notes, statements, cash flow, PPE, checks, computation)");
  eq(base.bs.total.assets.cy, 8587800.55, "assets 85,87,800.55 (as run_fin_statements.js)");
  ok(base.period && base.period.full && base.period.from === "20250401" && base.period.to === "20260331", "d.period: the year");
  [[1000, 0], [100000, 2]].forEach(([u, dc]) => ok(figs(FinSt.build("2025", {unit: u, dec: dc})) === figs(FinSt.build("2025", {unit: u, dec: dc, period: {preset: "fy"}})), "... and in unit " + u + ", " + dc + " decimals"));

  console.log("\nH1 (1-Apr-2025 to 30-Sep-2025)");
  const h1 = FinSt.build("2025", {unit: 1, dec: 2, period: {preset: "h1"}});
  ok(!h1.error, "built" + (h1.error ? ": " + h1.error : ""));
  const mvH1 = (pl, n) => { const p = parts(pl[n] || 0); return r2(p[0] + p[1]); };
  eq(note(h1, "13").total.cy, -r2(mvH1(C.plc, "Software Services - Export") + mvH1(C.plc, "Software Services - Domestic")), "Note 13 revenue = the two quarters' sales");
  const pbtH1 = -r2(Object.keys(C.plc).filter(n => !PLTAX.includes(n)).reduce((s, n) => s + mvH1(C.plc, n), 0));
  eq(h1.pl.pbt.cy, pbtH1, "profit before tax = minus the P&L ledgers' movements of April-September");
  eq(h1.pl.pat.cy, -r2(Object.keys(C.plc).reduce((s, n) => s + mvH1(C.plc, n), 0)), "profit for the period, after tax");
  eq(h1.pl.dep.cy, mvH1(C.plc, "Depreciation"), "depreciation: the schedule's charge for the half year");
  ok(h1.pl.lines.find(z => z.key === "pat").label === "Profit for the period", "the P&L says \"Profit for the period\"");
  const atH1 = n => r2(C.p[n] + parts(r2(C.c[n] - C.p[n] - (C.additions || []).filter(([l, d]) => l === n && d > "20250401" && d <= "20260331").reduce((s, z) => s + z[2], 0)))[0]
    + parts(r2(C.c[n] - C.p[n] - (C.additions || []).filter(([l, d]) => l === n && d > "20250401" && d <= "20260331").reduce((s, z) => s + z[2], 0)))[1]
    + (C.additions || []).filter(([l, d]) => l === n && d >= "20250401" && d <= "20250930").reduce((s, z) => s + z[2], 0));
  eq(line(h1, "10", "10A").cy, atH1("Maple Holdings Inc") + atH1("Willow Labs"), "the balance sheet is as on 30 September: receivables = 31 March + six months' movements");
  eq(h1.ppe.cy.total.G, atH1("Computers") + atH1("Office Equipment") + atH1("Furniture and Fixtures"), "gross block on 30 September (computers bought on 15-Jun-2025 in, 10-Dec-2025 out)");
  eq(h1.bs.total.eqL.cy, h1.bs.total.assets.cy, "the balance sheet ties: " + h1.bs.total.assets.cy);
  ok(h1.checks.every(c => c.value === 0), "every check reads 0: " + h1.checks.filter(c => c.value).map(c => c.key + " " + c.value).join("; "));
  ok(!h1.checks.some(c => c.key === "compPbt" || c.key === "surplus"), "no computation or surplus-against-last-year check for a part of the year");
  ok(h1.comp == null && /full financial year/i.test(h1.compNote || ""), "the computation of income is for a full year only: " + h1.compNote);
  eq(h1.cf.cy.diff, 0, "the cash flow ends at the cash on 30 September");
  eq(h1.cf.cy.close, line(h1, "11", "11D").cy + line(h1, "11", "11A").cy, "... closing cash and cash equivalents " + h1.cf.cy.close);
  eq(h1.cf.cy.open, C.p["Cash"] + C.p["Northbank Current A/c"], "... opening: the cash on 1 April");
  ok(h1.period && !h1.period.full && h1.period.forWhat === "for the period 01-Apr-2025 to 30-Sep-2025" && h1.period.asAt === "30-Sep-2025" && h1.period.pyAsAt === "30-Sep-2024", "headings: " + JSON.stringify(h1.period && [h1.period.forWhat, h1.period.asAt, h1.period.pyAsAt]));
  ok(h1.tb.pySrc === "copy", "PY: the same half of 2024-25, from FinCom's copy (" + h1.tb.pySrc + ")");
  eq(note(h1, "13").total.py, -r2(mvH1(C.plp, "Software Services - Export") + mvH1(C.plp, "Software Services - Domestic")), "PY revenue: April-September 2024");
  eq(h1.bs.total.eqL.py, h1.bs.total.assets.py, "the PY balance sheet (30-Sep-2024) ties: " + h1.bs.total.assets.py);
  ok(h1.cf.py && h1.cf.py.diff === 0, "PY cash flow for April-September 2024");
  [[1000, 0], [100000, 2], [10000000, 2]].forEach(([u, dc]) => { const z = FinSt.build("2025", {unit: u, dec: dc, period: {preset: "h1"}});
    ok(z.bs.total.eqL.cy === z.bs.total.assets.cy && z.checks.every(c => c.value === 0), "unit " + u + ", " + dc + " decimals: ties, checks 0" + z.checks.filter(c => c.value).map(c => " " + c.key + " " + c.value).join("")); });

  console.log("\nQ2 (1-Jul-2025 to 30-Sep-2025): the earlier part of the year in the surplus");
  const q2 = FinSt.build("2025", {unit: 1, dec: 2, period: {preset: "q2"}}), q1 = FinSt.build("2025", {unit: 1, dec: 2, period: {preset: "q1"}});
  eq(q2.bs.total.assets.cy, h1.bs.total.assets.cy, "the balance sheet as on 30 September, as H1's");
  eq(q2.bs.total.eqL.cy, q2.bs.total.assets.cy, "... and it ties");
  eq(r2(q2.pl.pat.cy + q1.pl.pat.cy), h1.pl.pat.cy, "the quarter's profit + April-June's = H1's");
  const e4 = line(q2, "4", "4E");
  eq(e4.cy, q1.pl.pat.cy, "Note 4: the profit of April-June on its own line");
  ok(/01-Apr-2025 to 30-Jun-2025/.test(e4.label || ""), "... labelled with its dates: " + e4.label);
  eq(line(q2, "4", "4A").cy, 4531000, "... the balance at the beginning of the year unchanged (last year's closing)");
  ok(q2.checks.every(c => c.value === 0), "every check reads 0: " + q2.checks.filter(c => c.value).map(c => c.key + " " + c.value).join("; "));
  eq(q2.cf.cy.diff, 0, "the quarter's cash flow ends at the cash on 30 September");
  eq(q2.cf.cy.open, q1.cf.cy.close, "... and starts at the cash on 30 June");
  ok(q2.period.forWhat === "for the period 01-Jul-2025 to 30-Sep-2025", "heading: " + q2.period.forWhat);
  const cu2 = FinSt.build("2025", {unit: 1, dec: 2, period: {preset: "custom", from: "20250815", to: "20251120"}});
  ok(cu2.bs.total.eqL.cy === cu2.bs.total.assets.cy && cu2.checks.every(c => c.value === 0) && cu2.cf.cy.diff === 0, "custom 15-Aug to 20-Nov: ties, checks 0, cash flow ends at the cash");

  console.log("\nAdjustments belong to the period they were made for; the choice is kept for the client");
  const b = ctx.S.books, k = FinSt.periodKey("2025", {preset: "h1"});
  ok(k === "2025:20250401-20250930" && FinSt.periodKey("2025", {preset: "fy"}) === "2025", "the period's key: " + k);
  FinSt.adjAdd(k, {dr: "Rent", cr: "Provision for Expenses", amt: 1000, narr: "H1 rent accrual"});
  ok(FinSt.build("2025", {unit: 1, dec: 2, period: {preset: "h1"}}).pl.pat.cy === r2(h1.pl.pat.cy - 1000) && figs(FinSt.build("2025", {unit: 1, dec: 2})) === figs(base), "an H1 adjustment changes H1 only, not the year");
  FinSt.adjDel(k, 0);
  FinSt.periodSet({preset: "q3"});
  ok(b.fs.period && b.fs.period.preset === "q3" && FinSt.periodGet("2025").from === "20251001", "the period chosen is kept in b.fs.period (synced with the client's books)");
  FinSt.periodSet({preset: "custom", from: "20250815", to: "20251120"});
  ok(FinSt.periodGet("2025").from === "20250815" && FinSt.periodGet("2024").full, "a custom range of another year falls back to the full year (" + FinSt.periodGet("2024").key + ")");
  delete b.fs.period;

  console.log("\nNo comparative when the copy does not hold the same period of last year");
  const fb = use(books(Fm, "20250401", [["20260331", Fm.c, Fm.plc, Fm.o]], true)); ctx.CO = () => ({name: "Kestrel & Co", pan: "AAAFK1234K"}); fb.fs = {};
  const fh = FinSt.build("2025", {unit: 1, dec: 2, period: {preset: "h1"}});
  ok(!fh.error && fh.tb.pySrc === "none" && fh.tb.rows.every(r => !r.py), "the firm (copy from 1-Apr-2025): the PY column blank (" + (fh.tb && fh.tb.pySrc) + ")");
  ok(/not in FinCom/i.test(fh.period.pyNote || ""), "... with a one-line note: " + fh.period.pyNote);
  ok(fh.bs.total.eqL.cy === fh.bs.total.assets.cy && fh.checks.every(c => c.value === 0), "... the firm's H1 ties, checks 0" + fh.checks.filter(c => c.value).map(c => " " + c.key + " " + c.value).join(""));

  console.log("\nLast year's balance sheet: reading it");
  const PB = x.FinPyBs;
  ok(PB && typeof PB.fromRows === "function" && typeof PB.fromText === "function", "FinPyBs is in the program (src/js/88-fin-pybs.js)");
  [["1,23,456.50", 123456.5], ["(12,345)", -12345], ["-", 0], ["₹ 5,00,000", 500000], ["-2,000.25", -2000.25], ["1,00,00,000", 10000000], ["12,345.00 ", 12345], ["(1,234.5)", -1234.5]]
    .forEach(([s, v]) => ok(PB.amount(s) === v, "amount(" + JSON.stringify(s) + ") = " + PB.amount(s)));
  ok(PB.amount("Note 6") == null && PB.amount("31 March 2025") == null, "a word or a date is no amount");
  const rows = [[PYBS.title], [PYBS.what], [PYBS.unit], PYBS.head].concat(PYBS.rows);
  const rd = PB.fromRows([{name: "Balance Sheet", rows}]);
  ok(rd.unit === 1 && rd.cols && rd.cols.cy === 2 && rd.cols.py === 3, "Excel rows: the label, the note, CY (31 March 2025) and PY columns found (" + JSON.stringify(rd.cols) + ")");
  const L = l => rd.lines.find(z => z.label === l) || {};
  ok(L("(a) Share capital").amt === 100000 && L("(a) Share capital").note === 3 && L("(a) Share capital").py === 100000, "a line: label, note, amount, PY");
  ok(L("Juniper Travels").amt === -5000, "a negative amount read");
  ok(!rd.lines.some(z => /^TOTAL$/i.test(z.label) && z.use), "totals are read but not used");
  const th = PB.fromRows([{name: "BS", rows: [["Balance sheet"], ["(Rs in thousands)"], ["Particulars", "As at 31.03.2025", "As at 31.03.2024"], ["Trade receivables", 2655, 2100]]}]);
  ok(th.unit === 1000 && th.lines[0].amt === 2655, "the unit line (Rs in thousands) read: unit " + th.unit);
  const text = [PYBS.title, PYBS.what, PYBS.unit, "Particulars Note As at 31 March 2025 As at 31 March 2024"].concat(PYBS.rows.map(r => {
    const f = v => v === "" || v == null ? "" : typeof v === "number" ? (v < 0 ? "(" + new Intl.NumberFormat("en-IN").format(-v) + ")" : new Intl.NumberFormat("en-IN").format(v)) : String(v);
    return [r[0], r.length > 2 && r[1] !== "" ? String(r[1]) : "", f(r[2]), f(r[3])].filter(Boolean).join("   "); })).join("\n");
  const rt = PB.fromText(text);
  const T = l => rt.lines.find(z => z.label === l) || {};
  ok(T("(b) Reserves and surplus").amt === 4531000 && T("(b) Reserves and surplus").note === 4 && T("(b) Reserves and surplus").py === 2967000, "PDF text: label, note, amount and PY (45,31,000 / 29,67,000)");
  ok(T("Juniper Travels").amt === -5000, "PDF text: (5,000) is a negative");
  ok(rt.lines.filter(z => z.amt != null).length === rd.lines.filter(z => z.amt != null).length, "the PDF's text and the Excel give the same lines (" + rt.lines.length + ")");
  const wr = PB.fromText(["Particulars Note As at 31 March 2025 As at 31 March 2024", "(a) Trade payables 6", "- Total outstanding dues of micro and small", "40,000 30,000", "enterprises", "Juniper Travels (5,000) 8,000"].join("\n"));
  ok(wr.lines.length === 3 && wr.lines[0].isHead && wr.lines[0].note === 6 && wr.lines[1].label === "- Total outstanding dues of micro and small enterprises" && wr.lines[1].amt === 40000 && wr.lines[1].py === 30000,
    "a caption the PDF wraps over lines, its figures on a line of their own, is one line: " + JSON.stringify(wr.lines.map(z => [z.label, z.amt])));
  const scan = PB.fromText("   \n  ");
  ok(scan.lines.length === 0 && /could not/i.test(scan.why || ""), "a PDF without text: said plainly: " + scan.why);

  console.log("\nIts lines get codes; the note lines are used where they add up to the face");
  const pr = PB.prepare(rd, "co"), U = l => pr.lines.find(z => z.label === l) || {};
  [["- Total outstanding dues of micro and small enterprises", "6A"], ["- Total outstanding dues of creditors other than micro and small enterprises", "6B"], ["(a) Share capital", "3A"], ["(b) Reserves and surplus", "4A"],
    ["Bluebell Print Works", "6A"], ["Cedar Cloud Hosting LLP", "6B"], ["Security Deposit - Office Rent", "12A"], ["Loans and advances to related parties", "12H"], ["Computers", "8A"], ["Cash on hand", "11D"],
    ["Balances with banks in current accounts", "11A"], ["Fixed deposits with maturity of more than 3 months", "11B"], ["(a) Long-term provisions", "5D"], ["(b) Other current liabilities", "7A"], ["(d) Other current assets", "12K"]]
    .forEach(([l, c]) => ok(U(l).code === c, l + " -> " + U(l).code + (U(l).code === c ? "" : " (expected " + c + ")")));
  ok(!U("(c) Short-term loans and advances").use && U("Security Deposit - Office Rent").use, "short-term loans: the note's lines add up to the face, so they are used and the face line is not");
  ok(U("(b) Reserves and surplus").use && !U("TOTAL").use, "reserves: the face line used; totals never");
  const sumUsed = side => pr.lines.filter(z => z.use && z.code && FinSt.CODES[z.code].side === "BS" && (FinSt.CODES[z.code].sign < 0) === (side === "L")).reduce((s, z) => s + z.amt, 0);
  eq(sumUsed("L"), 6141000, "the lines used: liabilities 61,41,000"); eq(sumUsed("A"), 6141000, "... assets 61,41,000 (nothing counted twice)");

  console.log("\nUsed as the PY column when the copy has no previous year, and to suggest codes");
  const open25 = Object.assign({}, C.p, {"Profit & Loss A/c": -4531000});
  const nb = use(books(C, "20250401", [["20260331", C.c, C.plc, C.p]], true, open25)); nb.msme = {"Bluebell Print Works": "Micro"}; nb.fs = {};
  let d = FinSt.build("2025", {unit: 1, dec: 2});
  ok(d.tb.pySrc === "opening", "before the upload: PY from the opening balances");
  const rowOf = (dd, l) => dd.tb.rows.find(r => r.ledger === l) || {};
  ok(rowOf(d, "Advance to Staff").code === "12G" && rowOf(d, "Security Deposit - Office Rent").code === "38A", "the rule: staff advance 12G, deposit 38A");
  FinSt.mapSet("Prepaid Expenses", "12H");
  PB.save("2025", Object.assign(pr, {file: "Larkspur BS 2024-25.xlsx", size: 1234, sha256: "ab".repeat(32)}), {by: "test"});
  ok(nb.fs.pyBs && nb.fs.pyBs["2025"].versions.length === 1 && nb.fs.pyBs["2025"].versions[0].v === 1 && nb.fs.pyBs["2025"].versions[0].file === "Larkspur BS 2024-25.xlsx", "kept with the books: b.fs.pyBs[fy].versions (v1, the file's name and checksum)");
  d = FinSt.build("2025", {unit: 1, dec: 2});
  ok(d.tb.pySrc === "upload", "the PY column is now last year's balance sheet (" + d.tb.pySrc + ")");
  eq(d.bs.total.eqL.py, 6141000, "PY equity and liabilities 61,41,000"); eq(d.bs.total.assets.py, 6141000, "PY assets 61,41,000");
  eq(line(d, "10", "10A").py, 2655000, "PY receivables as audited: 26,55,000"); eq(line(d, "6", "6A").py, 40000, "PY MSE payables 40,000");
  ok(d.checks.every(c => c.value === 0), "every check reads 0: " + d.checks.filter(c => c.value).map(c => c.key + " " + c.value).join("; "));
  const sg = l => rowOf(d, l);
  ok(sg("Advance to Staff").code === "12H" && sg("Advance to Staff").codeSrc === "suggested" && sg("Advance to Staff").why === "from last year's balance sheet: Loans and advances to related parties",
    "by amount: the staff advance (10,000) -> 12H, " + sg("Advance to Staff").why);
  ok(sg("Security Deposit - Office Rent").code === "12A" && /Security Deposit - Office Rent/.test(sg("Security Deposit - Office Rent").why || ""), "by name inside a note: the deposit -> 12A, " + sg("Security Deposit - Office Rent").why);
  ok(sg("Bluebell Print Works").code === "6A" && /Bluebell/.test(sg("Bluebell Print Works").why || ""), "the MSME creditor -> 6A, " + sg("Bluebell Print Works").why);
  ok(sg("Prepaid Expenses").code === "12H" && sg("Prepaid Expenses").codeSrc === "hand" && !sg("Prepaid Expenses").why, "a hand choice is never overwritten (Prepaid Expenses, named in last year's note as 12C, stays 12H by hand)");
  ok(!sg("Maple Holdings Inc").why || sg("Maple Holdings Inc").code === "10A", "receivables keep 10A");

  console.log("\nThe check: last year's balance sheet vs FinCom's opening balances");
  const pc = d.pyCheck || {rows: []}, H = id => pc.rows.find(z => z.id === id) || {};
  ok(pc.rows.length >= 10, "a row per head (" + pc.rows.length + ")");
  eq(H("tr").diff, 5000, "trade receivables: 26,55,000 audited - 26,50,000 in FinCom");
  eq(H("cash").diff, -5000, "cash and bank: 21,93,000 - 21,98,000");
  eq(H("stla").diff, 0, "short-term loans: equal once the deposit is coded 12A as last year");
  ok(pc.rows.filter(z => z.diff).length === 2 && pc.bad === 2, "two heads differ (" + pc.rows.filter(z => z.diff).map(z => z.id).join(", ") + ")");
  FinSt.mapSet("Security Deposit - Office Rent", "38D");
  d = FinSt.build("2025", {unit: 1, dec: 2});
  ok((d.pyCheck.rows.find(z => z.id === "ltla") || {}).diff === -150000 && (d.pyCheck.rows.find(z => z.id === "stla") || {}).diff === 150000, "a hand choice against last year shows as a difference per head (deposit by hand in long-term)");
  PB.save("2025", Object.assign({}, pr, {usePy: false}), {by: "test"});
  ok(nb.fs.pyBs["2025"].versions.length === 2 && FinSt.build("2025", {unit: 1, dec: 2}).tb.pySrc === "opening", "a new version (v2) kept beside v1; told not to be the PY column, the opening balances are");
  ok(FinSt.build("2025", {unit: 1, dec: 2}).pyCheck.rows.length > 0, "... the check still shows");
  const cb = use(company(true)); cb.fs.pyBs = nb.fs.pyBs;
  const co = FinSt.build("2025", {unit: 1, dec: 2});
  ok(co.tb.pySrc === "copy", "with last year in the copy, the PY column is the copy's even with an upload");
} catch (e){ console.error(e); fails++; }
console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
