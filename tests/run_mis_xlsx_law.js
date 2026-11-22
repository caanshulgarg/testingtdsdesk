// node run_mis_xlsx_law.js - "My MIS" Excel figures against the screen's (review of 22-Nov-2026, track mis-audit), on the
// made-up fixture books and the same books a year on (so last year is in the books):
//   1. a block of the top 2 expense ledgers with "the rest as Others" off: the Total row's SUM covers every ledger, as the
//      screen's total does (the rows not shown on a hidden row of their own), and so do its % change and % of total;
//   2. a ratio by month compared with last year: the last-year column's numerator and denominator are those of the whole
//      last-year period (the figure the screen shows), not of last year's last month.
// The workbook is built with ExcelJS (assets/exceljs.min.js); each formula is worked out here from the cells it reads.
// MISX_DIR points at another copy of app/src/lib (the check before the fix: it fails there).
const fs = require("fs"), path = require("path"), {load, openBlob, HTML, CACHE, FIXTURE_DIR} = require("./harness");
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "TDS", "Certs", "GSTR", "GSTAdv", "GSTRev",
  "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "Parties", "FS", "FinSt", "GSTSet", "GSTF", "GSTQ", "choiceSplit", "choiceAcc", "choiceLegacy", "choiceDerive", "choiceRec", "choiceGet", "choiceUsable"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const APP = process.env.MISX_DIR || path.join(__dirname, "..", "app", "src", "lib");
const ExcelJS = require(path.join(__dirname, "..", "assets", "exceljs.min.js"));
(async () => {
  const E = await import(path.join(APP, "misCustom.js")), A = await import(path.join(__dirname, "..", "app", "src", "lib", "misData.js")), D = await import(path.join(__dirname, "..", "server", "_shared", "misdef.js"));
  const XL = await import(path.join(APP, "misXlsx.js"));
  const {ctx, x} = load(HTML, NAMES);
  const G = () => Object.assign({}, x, {S: ctx.S, CO: ctx.CO});
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(path.join(FIXTURE_DIR, "Master.xml")));
  Object.assign(b, {ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, states: ms.states, gstins: ms.gstins, pans: ms.pans, challans: [], alloc: {}});
  // the same entries a year on: last year is in the books for FY 2026-27
  const on = d => String(+String(d).slice(0, 4) + 1) + String(d).slice(4);
  b.vouchers = b.vouchers.concat(b.vouchers.map(v => Object.assign({}, v, {id: v.id + "+1y", date: on(v.date)})));
  b.meta = Object.assign({}, b.meta, {to: "20270331"});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.S.coId = "t";
  ctx.S.companies = {t: {id: "t", name: "Made-up Fixture Events Private Limited", choices: {}}}; ctx.CO = () => ctx.S.companies.t;
  x.LedMaster.refresh(b);
  const T = (type, title, rows, cols) => ({type, title, rows, cols: Object.assign({by: "month", compare: "none", pct: []}, cols || {})});
  const def = {name: "Made-up check", period: {kind: "fy", fy: "2026"}, units: {unit: 1, dec: 2}, blocks: [
    T("table", "Top 2 expenses", {by: "ledger", under: ["Indirect Expenses", "Direct Expenses"], top: 2, others: false}, {by: "year", compare: "ly", pct: ["change", "share"]}),
    T("table", "Other expenses to revenue", {by: "ratio", items: ["exp"]}, {by: "month", compare: "ly"})]};
  const n = D.normalizeDef(def);
  ok(!n.problems.length, "the definition is clean" + (n.problems.length ? ": " + n.problems.join("; ") : ""));
  const res = E.run(n.def, A.buildMisData(G(), n.def, {today: "20270415"}), {today: "20270415"});
  const wb = (await XL.workbook(ExcelJS, res, {images: false})).wb;
  // the value of a cell: a number, or a formula worked out from the cells it reads (the shapes misXlsx writes)
  const valOf = (ws, a, depth = 0) => {
    const c = ws.getCell(a), v = c.value;
    if (v == null || v === "") return null;
    if (typeof v !== "object") return v;
    if (!("formula" in v) || depth > 6) return v.result;
    const f = v.formula.replace(/UNIT/g, "1").replace(/DEC/g, "2");
    let m;
    if ((m = /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/.exec(f))) { let s = 0; for (let r = +m[2]; r <= +m[4]; r++) s += +valOf(ws, m[1] + r, depth + 1) || 0; return Math.round(s * 100) / 100; }
    if ((m = /^ROUND\(([A-Z]+\d+)\/1,2\)$/.exec(f))) return Math.round((+valOf(ws, m[1], depth + 1) || 0) * 100) / 100;
    if ((m = /^IF\(([A-Z]+\d+)=0,"",ROUND\(([A-Z]+\d+)\/([A-Z]+\d+)\*100,1\)\)$/.exec(f))) { const d = +valOf(ws, m[1], depth + 1); return d ? Math.round(valOf(ws, m[2], depth + 1) / d * 1000) / 10 : ""; }
    if ((m = /^IF\(OR\(([A-Z]+\d+)="",([A-Z]+\d+)=0\),"",ROUND\(\(([A-Z]+\d+)-([A-Z]+\d+)\)\/ABS\(([A-Z]+\d+)\)\*100,1\)\)$/.exec(f))) { const bb = +valOf(ws, m[1], depth + 1); return bb ? Math.round((valOf(ws, m[3], depth + 1) - bb) / Math.abs(bb) * 1000) / 10 : ""; }
    return v.result;
  };
  console.log("1. the top 2 with no Others row");
  const B1 = res.blocks[0], ws1 = wb.worksheets[1];
  ok(B1.rows.length === 2 && B1.total, "the screen: 2 rows and the total of every ledger (" + (B1.total && B1.total.cells.t) + ")");
  let totRow = 0; ws1.eachRow((r, i) => { if (String(r.getCell(1).value) === "Total") totRow = i; });
  const cols = {}; ws1.getRow(5).eachCell((c, i) => { cols[String(c.value)] = ws1.getColumn(i).letter; });
  const tKey = B1.cols.find(c => c.kind === "total"), tCol = cols[tKey.label];
  const shown = valOf(ws1, tCol + totRow);
  ok(Math.abs(shown - B1.total.cells.t) < 0.01, "the Excel's Total, worked out from its formulas, " + shown + " = the screen's " + B1.total.cells.t);
  const shareCol = cols[(B1.cols.find(c => c.key === "share") || {}).label];
  if (shareCol) { const sh = valOf(ws1, shareCol + 6); ok(Math.abs(sh - B1.rows[0].cells.share) < 0.05, "the first row's % of total " + sh + " = the screen's " + B1.rows[0].cells.share); }
  console.log("2. a ratio by month against last year");
  const B2 = res.blocks[1], row = B2.rows[0], ws2 = wb.worksheets[2];
  ok(row && row.cells.ly != null, "the screen's last-year figure: " + (row && row.cells.ly));
  const p = (row.parts || {}).ly;
  ok(p && p.den && Math.abs(Math.round(p.num / p.den * 1000) / 10 - row.cells.ly) < 0.05, "the parts behind the last-year column are the whole last year's: " + (p && p.num) + " / " + (p && p.den) + " = " + row.cells.ly + "%");
  let lyAddr = ""; ws2.getRow(5).eachCell((c, i) => { if (/^Last year/.test(String(c.value)) && !lyAddr) lyAddr = ws2.getColumn(i).letter + "6"; });
  const fx = (ws2.getCell(lyAddr).value || {}).formula || "", mm = /ROUND\(([A-Z]+\d+)\/([A-Z]+\d+)\*100,1\)/.exec(fx);
  const xv = mm ? Math.round(valOf(ws2, mm[1]) / valOf(ws2, mm[2]) * 1000) / 10 : null;
  ok(xv != null && Math.abs(xv - row.cells.ly) < 0.05, "the Excel's last-year cell, worked out from its inputs, " + xv + "% = the screen's " + row.cells.ly + "%");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
