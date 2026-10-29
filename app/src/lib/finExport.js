// The financial statements as downloads (ROUND 99, stage 2B): window.FinXlsx (the audit workbook, every figure a formula
// linked to the trial balance) and window.FinPdf (the statements for printing, A4 portrait). Both are built on FinSt.build
// (src/js/88-fin-statements.js; docs/fin-statements-api.md "The workbook"), so the screen, the Excel and the PDF agree.
// A lazy module: the Financial statements page imports it (or window.loadFinExport(), app/src/main.jsx); nothing here is in
// legacy.js. ExcelJS is not bundled: its prebuilt browser file is served from this site (assets/exceljs.min.js, ExcelJS
// 4.4.0 from npm, sha256 7e49da68588e250dbb8bba190d2caa8ab3787cc0284bda1d8b2f805c4df742c9, MIT: assets/exceljs-LICENSE.txt)
// and loaded the first time a workbook is made (ensureExcelJs, like ensureXlsx in src/js/01).
//
//   FinXlsx.download(fy, {unit, dec})      saves "<client> Financial statements FY 2025-26.xlsx"
//   FinXlsx.make(fy, {unit, dec})          -> {buffer, name, cells: [{sheet, addr, v, src}], sheets} (the tests read it)
//   FinPdf.open(fy, {unit, dec, includeTb}, win?)  opens the print view (win: a window opened already, e.g. by a stub)
//   FinPdf.html(fy, {unit, dec, includeTb})        the same pages as HTML
//   FinSt.ratios(d)                        Schedule III accounting ratios from the balance sheet and P&L (companies)
import "./finGlobals.js";

const G = globalThis;
const FS = () => G.FinSt;
const EXCELJS = "exceljs.min.js";
const EXCELJS_SHA256 = "7e49da68588e250dbb8bba190d2caa8ab3787cc0284bda1d8b2f805c4df742c9";

// ---------- ExcelJS, loaded once from this site ----------
export async function ensureExcelJs() {
  if (G.ExcelJS) return G.ExcelJS;
  if (!G.TDS_ASSETS || typeof G.loadScriptOnce !== "function") throw { code: "lib_missing", message: EXCELJS + " could not be loaded" };
  await G.loadScriptOnce(EXCELJS);
  if (!G.ExcelJS) throw { code: "lib_missing", message: EXCELJS + " could not be loaded" };
  return G.ExcelJS;
}

const N = (v) => +v || 0;
const RND = (v, d) => FS().RND(v, d);
const yearOf = (fy) => Number(String(fy).slice(0, 4));
const asAt = (fy) => "March 31, " + (yearOf(fy) + 1);
const fyLabel = (fy) => yearOf(fy) + "-" + String(yearOf(fy) + 1).slice(2);

// ---------- Schedule III accounting ratios (companies), from the balance sheet and P&L figures ----------
// Each ratio: numerator / denominator on the closing balances of the year (as the owner's workbook); 0 when the
// denominator is nil. The variance is (CY - PY) / PY.
const RATIOS = [
  ["current", "Current ratio", "Current assets", "Current liabilities", ["CA"], ["CL"], false],
  ["debtEq", "Debt-equity ratio", "Total borrowings (long-term + short-term)", "Shareholders' funds", ["ltb", "stb"], ["EQ"], false],
  ["dscr", "Debt service coverage ratio", "Earnings available for debt service (profit + depreciation + finance costs)", "Debt service (finance costs)", ["pat", "dep", "fin"], ["fin"], false],
  ["roe", "Return on equity", "Profit for the year", "Shareholders' funds", ["pat"], ["EQ"], true],
  ["invTurn", "Inventory turnover ratio", "Cost of goods sold (materials, purchases, change in inventories)", "Inventories", ["mat", "pur", "chg"], ["inv"], false],
  ["trTurn", "Trade receivables turnover ratio", "Revenue from operations", "Trade receivables", ["rev"], ["tr"], false],
  ["tpTurn", "Trade payables turnover ratio", "Purchases and other expenses", "Trade payables", ["mat", "pur", "exp"], ["tpm", "tpo"], false],
  ["ncTurn", "Net capital turnover ratio", "Revenue from operations", "Working capital (current assets - current liabilities)", ["rev"], ["CA", "-CL"], false],
  ["np", "Net profit ratio", "Profit for the year", "Revenue from operations", ["pat"], ["rev"], true],
  ["roce", "Return on capital employed", "Profit before tax + finance costs", "Capital employed (shareholders' funds + borrowings + deferred tax liabilities)", ["pbt", "fin"], ["EQ", "ltb", "stb", "dtl"], true],
  ["roi", "Return on investment", "Interest income (Note 14)", "Investments and other bank balances", ["int14A", "int14D"], ["nci", "ci", "obb"], true],
];
const COMP_LABEL = { CA: "Current assets", CL: "Current liabilities", EQ: "Shareholders' funds", ltb: "Long-term borrowings", stb: "Short-term borrowings", dtl: "Deferred tax liabilities (net)",
  tr: "Trade receivables", inv: "Inventories", tpm: "Trade payables: micro and small enterprises", tpo: "Trade payables: others", nci: "Non-current investments", ci: "Current investments",
  obb: "Other bank balances", rev: "Revenue from operations", mat: "Cost of materials consumed", pur: "Purchases of stock-in-trade", chg: "Changes in inventories", exp: "Other expenses",
  pat: "Profit for the year", dep: "Depreciation and amortisation", fin: "Finance costs", pbt: "Profit before tax", int14A: "Interest on fixed deposits", int14D: "Interest on income tax refund" };
function comps(d) {
  const bsl = (id) => { for (const s of Object.values(d.bs.sections)) { const l = s.lines.find((z) => z.id === id); if (l) return { cy: l.cy, py: l.py }; } return { cy: 0, py: 0 }; };
  const sec = (k) => ({ cy: d.bs.sections[k].total.cy, py: d.bs.sections[k].total.py });
  const note = (k) => d.notes.find((n) => n.key === k);
  const grp = (k, g) => { const n = note(k), z = n && n.groups[g]; return z ? { cy: N(z.cy), py: N(z.py) } : { cy: 0, py: 0 }; };
  const ln = (k, code) => { const n = note(k), l = n && n.lines.find((z) => z.code === code); return l ? { cy: N(l.cy), py: N(l.py) } : { cy: 0, py: 0 }; };
  const pl = (k) => ({ cy: N(d.pl[k].cy), py: N(d.pl[k].py) });
  const o = { CA: sec("CA"), CL: sec("CL"), EQ: sec("EQ"), obb: grp("11", "obb"), int14A: ln("14", "14A"), int14D: ln("14", "14D") };
  ["ltb", "stb", "dtl", "tr", "inv", "tpm", "tpo", "nci", "ci"].forEach((k) => { o[k] = bsl(k); });
  ["rev", "mat", "pur", "chg", "exp", "pat", "dep", "fin", "pbt"].forEach((k) => { o[k] = pl(k); });
  return o;
}
export function ratios(d) {
  if (!d || d.error || d.kind !== "co") return null;
  const c = comps(d), sum = (keys, col) => keys.reduce((s, k) => s + (k[0] === "-" ? -c[k.slice(1)][col] : c[k][col]), 0);
  const list = RATIOS.map(([key, label, numL, denL, num, den, pct]) => {
    const r = (col) => { const a = sum(num, col), b = sum(den, col); return b === 0 ? 0 : a / b; };
    const cy = r("cy"), py = r("py");
    return { key, label, numL, denL, num, den, pct, cy, py, variance: py === 0 ? 0 : (cy - py) / py };
  });
  return { comps: c, list };
}
if (FS() && !FS().ratios) FS().ratios = ratios;

// ---------- the workbook ----------
const NF = (dec) => (dec ? '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* \\-??_);_(@_)' : '_(* #,##0_);_(* \\(#,##0\\);_(* \\-??_);_(@_)');
const NF2 = NF(2), NF0 = NF(0);
const FONT = "Cambria";
const SH = { inp: "Inputs", bs: "Balance Sheet", pl: "Profit-Loss", cf: "CF", notes: "Notes", ppe: "PPE", comp: "Computation of Income", tb: "Trial Balance", jv: "JV", ar: "Accounting Ratios" };
const Q = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "'" + name.replace(/'/g, "''") + "'");
const A = (sheet, col, row) => Q(sheet) + "!$" + col + "$" + row;
const TBc = (c) => Q(SH.tb) + "!$" + c + ":$" + c;
const qs = (s) => '"' + String(s).replace(/"/g, '""') + '"';
// the trial balance by code: in the unit (CY H, PY I) and in rupees (CY F, PY C)
const SC = (code) => "SUMIFS(" + TBc("H") + "," + TBc("G") + "," + qs(code) + ")";
const SP = (code) => "SUMIFS(" + TBc("I") + "," + TBc("G") + "," + qs(code) + ")";
const RS = (code) => "SUMIFS(" + TBc("F") + "," + TBc("G") + "," + qs(code) + ")";
const RSp = (code) => "SUMIFS(" + TBc("C") + "," + TBc("G") + "," + qs(code) + ")";
// depreciation credited straight to the assets of a gross code (Trial Balance L), in the unit
const SD = (code) => "SUMIFS(" + TBc("L") + "," + TBc("G") + "," + qs(code) + ")/UNIT";
// a part of the year (or last year's balance sheet uploaded as the PY): the balances at the start of the period, in the
// unit (Trial Balance N = M / UNIT), where the cash flow and the PPE schedule start
const SO = (code) => "SUMIFS(" + TBc("N") + "," + TBc("G") + "," + qs(code) + ")";
const LVf = (col, code, sign) => "ROUND(" + (sign < 0 ? "-" : "") + (col === "cy" ? SC(code) : col === "op" ? SO(code) : SP(code)) + ",DEC)";
const plus = (xs) => (xs.filter((x) => x && x !== "0").join("+") || "0");

function workbook(ExcelJS, d) {
  const fs = FS(), inp = d.inputs, unit = inp.unit, dec = inp.dec, kind = d.kind, co = kind === "co", nf = NF(dec);
  // the period (FinSt.periodOf): a part of the year says its dates in every heading; the cash flow starts from the balances
  // at the start of the period (OBc), the PPE schedule too (PBc; also when the PY column is an uploaded balance sheet)
  const per = d.period || { full: true }, part = !per.full, OBc = part ? "op" : "py", PBc = d.tb.hasOp ? "op" : "py";
  const cyAt = part ? per.asAt : asAt(d.fy), pyAt = part ? per.pyAsAt : asAt(String(yearOf(d.fy) - 1));
  const forWhat = part ? per.forWhat : "for the year ended " + asAt(d.fy);
  const wb = new ExcelJS.Workbook();
  wb.creator = "FinCom"; wb.created = new Date();
  const order = co ? ["inp", "bs", "pl", "cf", "notes", "ppe", "comp", "tb", "jv", "ar"] : ["inp", "bs", "pl", "cf", "notes", "ppe", "comp", "tb", "jv"];
  const WS = {};
  order.forEach((k) => { WS[k] = wb.addWorksheet(SH[k], { views: [{ showGridLines: k === "tb" || k === "jv" ? true : false }], properties: { defaultRowHeight: 15 } }); });
  const pend = [], cells = [];
  // a cell: a value, or {f: formula (string or function, resolved once every sheet is laid out), v: its value, src: the
  // FinSt figure it is (a path in FinSt.build's result)}
  const put = (k, addr, val, st) => {
    const c = WS[k].getCell(addr);
    if (val && typeof val === "object" && "f" in val) pend.push({ k, addr, c, val });
    else if (val !== undefined && val !== null) c.value = val;
    style(c, st || {});
    return c;
  };
  const style = (c, st) => {
    c.font = { name: FONT, size: st.sz || 11, bold: !!st.b, italic: !!st.i, color: st.color ? { argb: st.color } : undefined };
    if (st.nf) c.numFmt = st.nf;
    const bd = {};
    if (st.top) bd.top = { style: "thin" };
    if (st.dbl) { bd.top = { style: "thin" }; bd.bottom = { style: "double" }; }
    if (st.box) { bd.top = bd.bottom = bd.left = bd.right = { style: "thin" }; }
    if (Object.keys(bd).length) c.border = bd;
    if (st.al || st.wrap) c.alignment = { horizontal: st.al, wrapText: !!st.wrap };
    if (st.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: st.fill } };
  };
  const widths = (k, w) => Object.entries(w).forEach(([c, x]) => { WS[k].getColumn(c).width = x; });
  const page = (k, area, land, one) => { WS[k].pageSetup = { paperSize: 9, orientation: land ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: one ? 1 : 0,
    // ExcelJS puts a $ before each part ("A1:H9" -> $A1:$H9); the rows need theirs too ($A$1:$H$9)
    margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }, printArea: area.replace(/([A-Z]+)(\d+)/g, "$1$$$2") }; };

  const fixedPy = (v) => (N(v) ? "ROUND(" + N(v) + (unit === 1 ? "" : "*" + unit) + "/UNIT,DEC)" : "0");
  const R = { note: {}, grp: {}, line: {}, pl: {}, bs: {}, bsSec: {}, bsTot: {}, ppe: {}, int: {}, cf: {}, comp: {}, tbRow: {}, chk: {} };
  const ref = (o, k, col) => ((o[k] || {})[col]) || "0";
  const IN = {};   // Inputs cells by field

  // ---- Inputs: company details, the unit, the checks ----
  const inRows = [["name", "Name of the entity", inp.name], ["entity", "Constitution", (G.FS && G.FS.ENTITY && G.FS.ENTITY[d.entity]) || (co ? "Company" : "Firm")],
    ["cin", co ? "CIN" : "LLPIN / registration number", inp.cin], ["pan", "PAN", inp.pan], ["address", "Registered office / address", inp.address], ["holding", "Holding company", inp.holding],
    ["shares", "Number of equity shares (CY and PY)", inp.shares.number === "" ? "" : N(inp.shares.number)], ["face", "Face value per share (Rs)", inp.shares.face === "" ? "" : N(inp.shares.face)],
    ["auth", "Authorised equity shares", inp.shares.authorised === "" ? "" : N(inp.shares.authorised)], ["fy", "Financial year", fyLabel(d.fy)]].concat(part ? [["period", "Period", per.range + (per.spans ? " (spans two financial years)" : "")], ["cmp", "Comparative", per.cmpNote.replace(/^Comparative: /, "")]] : []).concat([["asat", "Balance sheet date", cyAt],
    ["afirm", "Auditor: firm", inp.auditor.firm], ["frn", "Firm registration number", inp.auditor.frn], ["partner", "Auditor: partner", inp.auditor.partner], ["mno", "Membership number", inp.auditor.mno],
    ["aplace", "Auditor: place of signing", inp.auditor.place], ["place", co ? "Directors: place of signing" : "Partners: place of signing", inp.place], ["date", "Date of signing", inp.date],
    ["udin", "UDIN", inp.udin], ["regime", "Tax regime", inp.regime]]);
  put("inp", "B2", "Company details, inputs and checks", { b: true, sz: 14 });
  put("inp", "B3", "Change a yellow cell; every statement follows.", { i: true });
  inRows.forEach(([k, label, v], i) => { const r = 4 + i; IN[k] = A(SH.inp, "C", r); put("inp", "B" + r, label); put("inp", "C" + r, v == null ? "" : v, { fill: "FFFFFF99", al: "left" }); });
  WS.inp.getCell(IN.shares.replace(/^.*!/, "").replace(/\$/g, "")).name = "SHARES";
  // the unit block
  put("inp", "E3", "Presentation unit", { b: true });
  put("inp", "E4", unit, { b: true, fill: "FFFFFF00" }); put("inp", "F4", "1 = Rupees, 1000 = thousands, 100000 = lakhs, 10000000 = crores", { i: true, sz: 9 });
  put("inp", "E5", dec, { b: true, fill: "FFFFFF00" }); put("inp", "F5", "Decimals (0 or 2)", { i: true, sz: 9 });
  put("inp", "E6", { f: '"(All amounts in "&IF(UNIT=1,"Rupees",IF(UNIT=1000,"Rupees thousand",IF(UNIT=100000,"Rupees lakhs",IF(UNIT=10000000,"Rupees crores","Rupees"))))&", unless otherwise stated)"', v: inp.unitLine, src: ["inputs", "unitLine"] });
  put("inp", "F6", "The unit line on every statement", { i: true, sz: 9 });
  put("inp", "E7", inp.tol, { nf: "0.000" }); put("inp", "F7", "Rounding tolerance, in the unit (the most Note 17 may absorb)", { i: true, sz: 9 });
  put("inp", "E8", { f: 'IF(UNIT=1,"Rs",IF(UNIT=1000,"Rs \'000",IF(UNIT=100000,"Rs lakhs",IF(UNIT=10000000,"Rs crores","Rs / "&UNIT))))', v: ({ 1: "Rs", 1000: "Rs '000", 100000: "Rs lakhs", 10000000: "Rs crores" })[unit] || "Rs / " + unit });
  put("inp", "F8", "The unit, short", { i: true, sz: 9 });
  WS.inp.getCell("E4").name = "UNIT"; WS.inp.getCell("E5").name = "DEC"; WS.inp.getCell("E7").name = "TOL";
  const UNITLINE = A(SH.inp, "E", 6), UWORD = A(SH.inp, "E", 8);
  // stock (Rs), as on each date, with where it comes from: the trial balance's stock rows read these cells (STOCK_*)
  const sk = d.stock || {}, hasStk = d.tb.rows.some((x) => x.stk), STK = {};
  if (hasStk) {
    put("inp", "E10", "Stock (Rs)", { b: true });
    const SD2 = [["A", "STOCK_FY_OPEN", "Opening stock at the start of the year"]].concat(sk.dates.B !== sk.dates.A ? [["B", "STOCK_OPEN", "Opening stock at the start of the period"]] : [], [["C", "STOCK_CLOSE", "Closing stock"]]);
    SD2.forEach(([k, nm, label], i) => {
      const r = 11 + i, z = sk[k] || {};
      put("inp", "E" + r, z.v == null ? 0 : z.v, { b: true, fill: "FFFFFF00", nf: NF2 }); WS.inp.getCell("E" + r).name = nm; STK[k] = nm;
      put("inp", "F" + r, label + " (as on " + fs.DMY(sk.dates[k]) + "): " + (z.v == null ? "not known" : z.label), { i: true, sz: 9 });
    });
    if (!STK.B) STK.B = STK.A;
  }
  const stkF = (e) => e.replace(/[ABC]/g, (k) => STK[k]);
  // directors / partners, three rows each (name, DIN, designation)
  let r = 4 + inRows.length + 1;
  const ppl = (co ? inp.directors : (inp.partners && inp.partners.length ? inp.partners : inp.directors)) || [];
  const who = co ? "Director" : "Partner";
  put("inp", "B" + r, co ? "Directors" : "Partners", { b: true }); r++;
  IN.ppl = [];
  for (let i = 0; i < Math.max(2, ppl.length); i++) {
    const p = ppl[i] || {};
    IN.ppl.push({ name: A(SH.inp, "C", r), din: A(SH.inp, "C", r + 1), desig: A(SH.inp, "C", r + 2) });
    put("inp", "B" + r, who + " " + (i + 1)); put("inp", "C" + r, p.name || "", { fill: "FFFFFF99", al: "left" });
    put("inp", "B" + (r + 1), who + " " + (i + 1) + (co ? " DIN" : " DIN / DPIN")); put("inp", "C" + (r + 1), p.din || "", { fill: "FFFFFF99", al: "left" });
    put("inp", "B" + (r + 2), who + " " + (i + 1) + " designation"); put("inp", "C" + (r + 2), p.desig || (co ? "Director" : "Partner"), { fill: "FFFFFF99", al: "left" });
    r += 3;
  }
  const holders = (inp.shares.holders || []).filter((h) => h && h.name);
  IN.holders = [];
  if (co && holders.length) {
    r++; put("inp", "B" + r, "Shareholders holding more than 5% (number of shares)", { b: true }); r++;
    holders.forEach((h) => { IN.holders.push({ name: h.name, n: A(SH.inp, "C", r), nv: N(h.n) }); put("inp", "B" + r, h.name); put("inp", "C" + r, N(h.n), { fill: "FFFFFF99", nf: "#,##0" }); r++; });
  }
  r++;
  const chkStart = r;
  put("inp", "B" + r, "Checks (all should be zero)", { b: true }); r++;
  const chkRows = {};
  d.checks.forEach((c) => { chkRows[c.key] = r; put("inp", "B" + r, c.label); r++; });
  widths("inp", { A: 3, B: 52, C: 60, D: 3, E: 22, F: 48 });
  page("inp", "A1:F" + r);

  // ---- Trial Balance (rows from 5) and JV ----
  const T = d.tb.rows, t0 = 5, tN = t0 + T.length - 1, tTot = tN + 1;
  put("tb", "A1", { f: IN.name, v: inp.name }, { b: true, sz: 12 });
  put("tb", "A2", "Trial balance " + forWhat + ", with the adjustments (JV) and the code of each ledger" + (part ? " (balance sheet ledgers as on " + per.asAt + ", income and expenses for the period)" : ""), { b: true });
  put("tb", "A3", { f: '"Columns C to F in rupees; H and I in the presentation unit ("&' + UWORD + '&")"', v: "Columns C to F in rupees; H and I in the presentation unit (" + (({ 1: "Rs", 1000: "Rs '000", 100000: "Rs lakhs", 10000000: "Rs crores" })[unit] || "Rs / " + unit) + ")" }, { i: true });
  ["Ledger", "Group", "PY (Rs)", "CY (Rs)", "Adjustments (JV)", "Final (Rs)", "Code", "CY in unit", "PY in unit", "Side", "Code means", "Depreciation credited to the asset (Rs)"].forEach((h, i) => put("tb", "ABCDEFGHIJKL"[i] + "4", h, { b: true, box: true, al: i >= 2 && i <= 8 && i !== 6 ? "right" : undefined, wrap: true }));
  const hasOp = !!d.tb.hasOp;
  if (hasOp) ["At the start of the " + (part ? "period" : "year") + " (Rs)", "At the start in unit"].forEach((h, i) => put("tb", "MN"[i] + "4", h, { b: true, box: true, al: "right", wrap: true }));
  const jvList = (d.tb.adj || []), jv0 = 5, jvN = jv0 + Math.max(0, jvList.length - 1);
  const jvR = (c) => "JV!$" + c + "$" + jv0 + ":$" + c + "$" + jvN;
  const isGross = (c) => !!(c && fs.CODES[c] && fs.CODES[c].ppe === "gross");
  T.forEach((x, i) => {
    const rr = t0 + i; R.tbRow[x.ledger] = rr;
    put("tb", "A" + rr, x.ledger); put("tb", "B" + rr, x.group || "");
    put("tb", "C" + rr, x.py, { nf: NF2 }); put("tb", "D" + rr, x.stk ? { f: stkF(x.stk.cy), v: x.cy, src: ["tb", "rows", i, "cy"] } : x.cy, { nf: NF2 });
    const crit = /[*?~]|^[=<>]/.test(x.ledger) ? null : "$A" + rr;
    const adjF = crit ? "SUMIF(JV!$B:$B," + crit + ",JV!$D:$D)-SUMIF(JV!$C:$C," + crit + ",JV!$D:$D)"
      : "SUMPRODUCT((JV!$B$" + jv0 + ":$B$" + jvN + "=$A" + rr + ")*JV!$D$" + jv0 + ":$D$" + jvN + ")-SUMPRODUCT((JV!$C$" + jv0 + ":$C$" + jvN + "=$A" + rr + ")*JV!$D$" + jv0 + ":$D$" + jvN + ")";
    put("tb", "E" + rr, { f: adjF, v: x.adj, src: ["tb", "rows", i, "adj"] }, { nf: NF2 });
    put("tb", "F" + rr, { f: "D" + rr + "+E" + rr, v: x.final, src: ["tb", "rows", i, "final"] }, { nf: NF2 });
    put("tb", "G" + rr, x.code || ""); put("tb", "J" + rr, x.side || "");
    put("tb", "H" + rr, { f: "F" + rr + "/UNIT", v: x.final / unit }, { nf: nf }); put("tb", "I" + rr, { f: "C" + rr + "/UNIT", v: x.py / unit }, { nf: nf });
    put("tb", "K" + rr, x.code && fs.CODES[x.code] ? fs.CODES[x.code].label : x.code ? "" : "(no code)", { i: true, sz: 9, color: x.code ? undefined : "FFC00000" });
    if (hasOp) { put("tb", "M" + rr, x.stk && x.stk.op !== "0" ? { f: stkF(x.stk.op), v: N(x.op) } : N(x.op), { nf: NF2 }); put("tb", "N" + rr, { f: "M" + rr + "/UNIT", v: N(x.op) / unit }, { nf: nf }); }
    // L (a gross block): the year's depreciation credited straight to this asset (no accumulated-depreciation ledger):
    // the day book's entries debiting 8E / 34D (a value) and the JV rows Dr depreciation / Cr this asset (less the reverse)
    if (isGross(x.code)) put("tb", "L" + rr, { f: N(x.depCrBook) + "+SUMPRODUCT((" + jvR("C") + "=$A" + rr + ")*(" + jvR("E") + '="dep")*' + jvR("D") + ")-SUMPRODUCT((" + jvR("B") + "=$A" + rr + ")*(" + jvR("F") + '="dep")*' + jvR("D") + ")",
      v: N(x.depCr), src: ["tb", "rows", i, "depCr"] }, { nf: NF2 });
  });
  const tsum = (col, key) => T.reduce((s, x) => s + (key === "h" ? x.final / unit : key === "i" ? x.py / unit : N(x[key])), 0);
  put("tb", "A" + tTot, "Total", { b: true });
  [["C", "py"], ["D", "cy"], ["E", "adj"], ["F", "final"], ["H", "h"], ["I", "i"]].forEach(([c, k]) => put("tb", c + tTot, { f: T.length ? "SUM(" + c + t0 + ":" + c + tN + ")" : "0", v: tsum(c, k) }, { b: true, top: true, nf: c === "H" || c === "I" ? nf : NF2 }));
  widths("tb", { A: 46, B: 26, C: 16, D: 16, E: 16, F: 16, G: 7, H: 15, I: 15, J: 6, K: 40, L: 18, M: 16, N: 15 });
  WS.tb.views = [{ state: "frozen", ySplit: 4, showGridLines: true }];
  page("tb", "A1:J" + tTot, true);
  const TBrng = (c) => Q(SH.tb) + "!$" + c + "$" + t0 + ":$" + c + "$" + Math.max(t0, tN);

  put("jv", "A1", { f: IN.name, v: inp.name }, { b: true, sz: 12 });
  put("jv", "A2", "Adjustments for " + (part ? per.range : fyLabel(d.fy)) + " (audit entries kept in FinCom, not posted to Tally): the trial balance's Adjustments column reads them", { b: true });
  ["Narration", "Dr ledger", "Cr ledger", "Amount (Rs)", "Dr is depreciation", "Cr is depreciation"].forEach((h, i) => put("jv", "ABCDEF"[i] + "4", h, { b: true, box: true, al: i === 3 ? "right" : undefined, wrap: i > 3 }));
  if (!jvList.length) put("jv", "A5", "No adjustments", { i: true });
  // E / F: "dep" when the Dr / Cr ledger's code (Trial Balance G) is 8E or 34D: the Trial Balance's L reads them
  const codeOfL = (l) => ((T.find((x) => x.ledger === l) || {}).code || "");
  const depFlag = (c, rr) => ({ f: "IF(SUMPRODUCT((" + TBrng("A") + "=" + c + rr + ")*((" + TBrng("G") + '="8E")+(' + TBrng("G") + '="34D")))>0,"dep","")', v: "" });
  jvList.forEach((a, i) => { const rr = jv0 + i; put("jv", "A" + rr, a.narr || ""); put("jv", "B" + rr, a.dr || ""); put("jv", "C" + rr, a.cr || ""); put("jv", "D" + rr, N(a.amt), { nf: NF2 });
    [["E", "B", a.dr], ["F", "C", a.cr]].forEach(([c, s, l]) => { const z = depFlag(s, rr); z.v = /^(8E|34D)$/.test(codeOfL(l)) ? "dep" : ""; put("jv", c + rr, z, { sz: 9, i: true }); }); });
  if (jvList.length) { put("jv", "A" + (jvN + 2), "Total", { b: true }); put("jv", "D" + (jvN + 2), { f: "SUM(D" + jv0 + ":D" + jvN + ")", v: jvList.reduce((s, a) => s + N(a.amt), 0) }, { b: true, top: true, nf: NF2 }); }
  widths("jv", { A: 50, B: 40, C: 40, D: 18, E: 11, F: 11 });
  page("jv", "A1:D" + (jvN + 3));

  // the title lines of a statement sheet (rows 2-4) and its column heads (row 6)
  const titles = (k, what, c0) => {
    c0 = c0 || "C";
    put(k, c0 + "2", { f: IN.name, v: inp.name }, { b: true, sz: 14 });
    put(k, c0 + "3", what, { b: true, sz: 12 });
    put(k, c0 + "4", { f: UNITLINE, v: inp.unitLine }, { i: true });
  };
  const heads = (k, row, isPL, noteCol) => {
    put(k, "C" + row, "Particulars", { b: true });
    if (noteCol !== false) put(k, "E" + row, "Note", { b: true, al: "center" });
    const w = isPL ? (part ? "For the period\n" : "Year ended\n") : "As at\n";
    put(k, "F" + row, w + (isPL && part ? per.range : cyAt), { b: true, al: "right", wrap: true }); put(k, "H" + row, isPL && part ? per.pyPlHead.join("\n") : w + pyAt, { b: true, al: "right", wrap: true });
    WS[k].getRow(row).height = 31;
  };
  const stdWidths = (k) => widths(k, { A: 3, B: 4, C: 62, D: 3, E: 8, F: 18, G: 3, H: 18 });

  // ---- PPE (Note 8) and intangibles (Note 34) ----
  titles("ppe", "Notes forming part of the financial statements " + forWhat);
  let pr = 6;
  const PPEH = ["Particulars", "Gross block\nopening", "Additions", "(Sales) /\nadjustments", "Gross block\nclosing", "Acc. dep.\nopening", "Charge for\nthe year", "(Sales)\ndep.", "Acc. dep.\nclosing", "Net block\nopening", "Net block\nclosing"];
  const COLS = "DEFGHIJKLM".split("");
  const grid = (key, title, sched, list, store) => {
    const no = d.noteOf[key];
    put("ppe", "C" + pr, "Note " + (no || "-") + "   " + title, { b: true }); pr += 2;
    const adjs = ((((G.S || {}).books || {}).fs || {}).ppeAdj || {})[fs.periodKey ? fs.periodKey(d.fy, per) : d.fy] || {};
    const one = (col, g) => {
      const gr = g[col], partial = !!gr.partial;
      put("ppe", "C" + pr, (part ? (col === "cy" ? "For the period " + per.range : per.pyForWhat.replace(/^f/, "F")) : "As at " + asAt(col === "cy" ? d.fy : String(yearOf(d.fy) - 1))), { b: true }); pr++;
      PPEH.forEach((h, i) => put("ppe", "CDEFGHIJKLM"[i] + pr, h, { b: true, sz: 9, al: i ? "center" : undefined, wrap: true }));
      WS.ppe.getRow(pr).height = 31; pr++;
      if (!gr.rows.length) { put("ppe", "C" + pr, "Nil", { i: true }); pr++; store[col] = {}; return; }
      const r0 = pr;
      gr.rows.forEach((x, i) => {
        const rr = pr, sp = (c) => "$" + c + "$" + rr;
        put("ppe", "C" + rr, x.label);
        const path = (k2) => ["ppeRow", key, col, i, k2];
        if (col === "cy") {
          const adj = adjs[x.g] || {}, S = N(adj.sale) ? "+ROUND(" + N(adj.sale) + "/UNIT,DEC)" : "";
          const f = {
            D: "ROUND(" + (PBc === "op" ? SO : SP)(x.g) + ",DEC)", G: "ROUND(" + SC(x.g) + "+" + SD(x.g) + ",DEC)",
            E: "ROUND(MAX(0," + sp("G") + "-" + sp("D") + ")" + S + ",DEC)", F: "ROUND(-(MAX(0," + sp("D") + "-" + sp("G") + ")" + S + "),DEC)",
            H: x.a ? "ROUND(-" + (PBc === "op" ? SO : SP)(x.a) + ",DEC)" : "0", K: "ROUND(" + (x.a ? "-" + SC(x.a) + "+" : "") + SD(x.g) + ",DEC)",
            J: N(adj.dep) ? "-ROUND(" + N(adj.dep) + "/UNIT,DEC)" : "0", I: "ROUND(" + sp("K") + "-" + sp("H") + "-" + sp("J") + ",DEC)",
            L: "ROUND(" + sp("D") + "-" + sp("H") + ",DEC)", M: "ROUND(" + sp("G") + "-" + sp("K") + ",DEC)" };
          COLS.forEach((c) => put("ppe", c + rr, { f: f[c], v: x[c], src: path(c) }, { nf }));
        } else if (partial) {
          put("ppe", "G" + rr, { f: "ROUND(" + SP(x.g) + ",DEC)", v: x.G, src: path("G") }, { nf });
          put("ppe", "K" + rr, { f: x.a ? "ROUND(-" + SP(x.a) + ",DEC)" : "0", v: x.K, src: path("K") }, { nf });
          put("ppe", "M" + rr, { f: "ROUND(" + sp("G") + "-" + sp("K") + ",DEC)", v: x.M, src: path("M") }, { nf });
        } else {
          // the year before's schedule, as that year worked it out: values, in this unit when the workbook's unit changes
          // (as the owner's workbooks carry last year's figures: value x the unit they were in / UNIT)
          COLS.forEach((c) => put("ppe", c + rr, x[c] == null ? null : { f: fixedPy(x[c]), v: x[c], src: path(c) }, { nf }));
        }
        pr++;
      });
      put("ppe", "C" + pr, "Total", { b: true });
      const tot = {};
      COLS.forEach((c) => {
        if (gr.total[c] == null) return;
        put("ppe", c + pr, { f: "SUM(" + c + r0 + ":" + c + (pr - 1) + ")", v: gr.total[c], src: ["ppeTot", key, col, c] }, { b: true, dbl: true, nf });
        tot[c] = A(SH.ppe, c, pr);
      });
      store[col] = Object.assign(tot, { partial });
      pr += 2;
    };
    one("cy", sched); one("py", sched);
    if (sched.py.partial && sched.py.rows.length) { put("ppe", "C" + pr, d.tb.pySrc === "upload" ? "The previous year's figures are last year's balance sheet as uploaded (net block)." : "The previous year's additions, sales and depreciation are not shown: FinCom has no books for the year before.", { i: true }); pr += 2; }
  };
  grid("8", "Property, plant and equipment", d.ppe, fs.PPE, R.ppe);
  if (d.intang.cy.rows.length || d.intang.py.rows.length) grid("34", "Intangible assets", d.intang, fs.INT, R.int);
  else { R.int.cy = {}; R.int.py = {}; }
  widths("ppe", { A: 3, B: 2, C: 30, D: 13.5, E: 13.5, F: 13.5, G: 13.5, H: 13.5, I: 13.5, J: 13.5, K: 13.5, L: 13.5, M: 13.5 });
  page("ppe", "A1:M" + pr, true);

  // ---- P&L rows, laid out before the notes (Note 4 / Note 3 read this year's profit from it) ----
  const PLR = {}, plVis = [];
  const noteVis = (k) => d.notes.some((n) => n.key === k);
  const plShow = { mat: noteVis("40"), pur: noteVis("41"), chg: noteVis("42"), exc: noteVis("43") };
  {
    let rr = 7, expHead = false;
    d.pl.lines.forEach((l) => {
      if (plShow[l.key] === false) return;
      if (l.key === "rev") { plVis.push({ head: "Income", row: rr }); rr++; }
      if (["mat", "pur", "chg", "emp"].includes(l.key) && !expHead) { expHead = true; plVis.push({ head: "Expenses", row: rr }); rr++; }
      if (l.key === "cur") { plVis.push({ head: "Tax expense", row: rr }); rr++; }
      PLR[l.key] = rr; plVis.push({ l, row: rr }); rr++;
      if (["inc", "tot", "pbe", "pbt", "tax"].includes(l.key)) { plVis.push({ gap: true, row: rr }); rr++; }
    });
    PLR._end = rr;
  }
  ["cy", "py"].forEach((col) => Object.entries(PLR).forEach(([k, rr]) => { if (k[0] !== "_") (R.pl[k] = R.pl[k] || {})[col] = A(SH.pl, col === "cy" ? "F" : "H", rr); }));

  // ---- Notes (all but 8 and 34, which are on the PPE sheet) ----
  titles("notes", "Notes forming part of the financial statements " + forWhat);
  let nr = 6;
  const raw17 = {};
  const NCOLS = part ? ["cy", "py", "op"] : ["cy", "py"], NC = { cy: "F", py: "H", op: "M" };
  const lineRef = (key, code, col, addr) => { (R.line[key + "." + code] = R.line[key + "." + code] || {})[col] = addr; };
  d.notes.forEach((n) => {
    if (n.key === "8" || n.key === "34") {
      R.note[n.key] = { cy: (n.key === "8" ? R.ppe : R.int).cy.M || "0", py: (n.key === "8" ? R.ppe : R.int).py.M || "0", op: (n.key === "8" ? R.ppe : R.int).cy.L || "0" };
      R.grp[n.key + "." + (n.key === "8" ? "ppe" : "int")] = R.note[n.key];
      return;
    }
    put("notes", "C" + nr, "Note " + n.no, { b: true }); nr++;
    put("notes", "C" + nr, n.title, { b: true });
    const w = n.st === "PL" ? (part ? "For the period\n" : "Year ended\n") : "As at\n", isPLn = n.st === "PL";
    put("notes", "F" + nr, w + (isPLn && part ? per.range : cyAt), { b: true, al: "right", wrap: true }); put("notes", "H" + nr, isPLn && part ? per.pyPlHead.join("\n") : w + pyAt, { b: true, al: "right", wrap: true });
    if (part) put("notes", "M" + nr, "At the start of the period\n(for the cash flow)", { b: true, al: "right", wrap: true, sz: 9 });
    WS.notes.getRow(nr).height = 31; nr++;
    const ix = d.notes.indexOf(n);
    const gTot = {}, gRows = {}, totals = n.lines.filter((l) => l.total);
    let first = nr;
    n.lines.forEach((l, li) => {
      const path = (c) => ["notesByKey", n.key, "lines", li, c];
      if (l.head) { put("notes", "C" + nr, l.label, { b: true }); nr++; return; }
      if (l.total) {
        const rs = gRows[l.group] || [];
        const single = totals.length === 1;
        NCOLS.forEach((col) => {
          const c = NC[col];
          put("notes", c + nr, { f: rs.length ? "SUM(" + c + rs[0] + ":" + c + rs[rs.length - 1] + ")" : "0", v: l[col], src: path(col) }, { b: true, nf, top: true, dbl: single });
        });
        put("notes", "C" + nr, l.label, { b: true });
        gTot[l.group] = nr; nr++; return;
      }
      (gRows[l.group] = gRows[l.group] || []).push(nr);
      put("notes", "C" + nr, l.label);
      if (l.code) put("notes", "A" + nr, l.code, { i: true, sz: 9 });
      NCOLS.forEach((col) => {
        const c = NC[col], sign = fs.CODES[l.code] ? fs.CODES[l.code].sign : 1;
        let f;
        if (l.profit) f = col === "op" ? "0" : () => R.pl.pat[col];
        else if (l.code === "17J" && col === "op") f = LVf("op", "17J", 1);
        else if (l.code === "17J") {
          f = () => LVf(col, "17J", 1) + (R.plug ? "+" + R.plug[col] : "");
          raw17[col] = { addr: A(SH.notes, col === "cy" ? "J" : "K", nr), v: RND(N(l[col]) - N((l.plug || {})[col]), dec), row: nr };
        } else f = LVf(col, l.code, sign);
        put("notes", c + nr, { f, v: l[col], src: path(col) }, { nf });
        if (l.code) lineRef(n.key, l.code, col, A(SH.notes, c, nr));
      });
      if (l.code === "17J") {
        put("notes", "J" + nr, { f: LVf("cy", "17J", 1), v: raw17.cy.v }, { nf, i: true, sz: 9 });
        put("notes", "K" + nr, { f: LVf("py", "17J", 1), v: raw17.py.v }, { nf, i: true, sz: 9 });
        put("notes", "J" + (first - 1), "17J before rounding (CY / PY)", { i: true, sz: 9 });
      }
      nr++;
    });
    // the note's total: its one group total, else a Total row
    let tot;
    if (totals.length === 1) tot = gTot[totals[0].group];
    else {
      const pick = totals.length ? totals.map((l) => gTot[l.group]) : null;
      const allRows = Object.values(gRows).flat();
      put("notes", "C" + nr, "Total", { b: true });
      NCOLS.forEach((col) => {
        const c = NC[col];
        const f = pick ? (pick.length ? "SUM(" + pick.map((x) => c + x).join(",") + ")" : "0") : allRows.length ? "SUM(" + c + Math.min(...allRows) + ":" + c + Math.max(...allRows) + ")" : "0";
        put("notes", c + nr, { f, v: n.total[col], src: ["notesByKey", n.key, "total", col] }, { b: true, nf, dbl: true });
      });
      tot = nr; nr++;
    }
    R.note[n.key] = { cy: A(SH.notes, "F", tot), py: A(SH.notes, "H", tot), op: part ? A(SH.notes, "M", tot) : "0" };
    // a group's figure: its total row, else (the one group with lines) the note's total, else nil
    Object.keys(n.groups).forEach((g) => {
      const at = gTot[g] ? gTot[g] : gRows[g] && gRows[g].length ? tot : null;
      R.grp[n.key + "." + g] = at ? { cy: A(SH.notes, "F", at), py: A(SH.notes, "H", at), op: part ? A(SH.notes, "M", at) : "0" } : { cy: "0", py: "0", op: "0" };
    });
    // Note 3 (a company): the authorised capital and the shareholders above 5%, from the Inputs
    if (n.key === "3" && co) {
      const auth = N(inp.shares.authorised), face = N(inp.shares.face), sh = N(inp.shares.number);
      if (auth && face) {
        put("notes", "C" + nr, { f: '"Authorised: "&TEXT(' + IN.auth + ',"#,##0")&" equity shares of Rs "&' + IN.face + '&" each"', v: "Authorised: " + auth.toLocaleString("en-US") + " equity shares of Rs " + face + " each" }, { i: true });
        ["F", "H"].forEach((c) => put("notes", c + nr, { f: "ROUND(" + IN.auth + "*" + IN.face + "/UNIT,DEC)", v: RND(auth * face / unit, dec) }, { nf, i: true }));
        nr++;
      }
      if (sh) { put("notes", "C" + nr, { f: '"Issued, subscribed and fully paid up: "&TEXT(SHARES,"#,##0")&" equity shares"', v: "Issued, subscribed and fully paid up: " + sh.toLocaleString("en-US") + " equity shares" }, { i: true }); nr++; }
      if (IN.holders.length && sh) {
        put("notes", "C" + nr, "Shareholders holding more than 5% of the shares", { b: true }); put("notes", "F" + nr, "No. of shares", { b: true, sz: 9, al: "right" }); put("notes", "H" + nr, "% holding", { b: true, sz: 9, al: "right" }); nr++;
        IN.holders.forEach((h) => {
          put("notes", "C" + nr, h.name); put("notes", "F" + nr, { f: h.n, v: h.nv }, { nf: "#,##0" });
          put("notes", "H" + nr, { f: h.n + "/SHARES", v: h.nv / sh }, { nf: "0.00%" }); nr++;
        });
      }
    }
    nr++;
    void ix; first = nr;
  });
  // groups of notes left out (nil): read as 0
  fs.NOTES.forEach((n) => { if (!R.note[n.key]) R.note[n.key] = { cy: "0", py: "0" }; n.groups.forEach(([g]) => { if (!R.grp[n.key + "." + g]) R.grp[n.key + "." + g] = { cy: "0", py: "0" }; }); });
  if (!R.grp["8.ppe"] || R.grp["8.ppe"].cy === "0") R.grp["8.ppe"] = { cy: R.ppe.cy.M || "0", py: R.ppe.py.M || "0", op: R.ppe.cy.L || "0" };
  if (!R.grp["34.int"] || R.grp["34.int"].cy === "0") R.grp["34.int"] = { cy: R.int.cy.M || "0", py: R.int.py.M || "0", op: R.int.cy.L || "0" };
  widths("notes", { A: 6, B: 2, C: 62, D: 3, E: 8, F: 18, G: 3, H: 18, I: 3, J: 14, K: 14, L: 3, M: 18 });
  page("notes", "A1:H" + nr);
  const grp = (k, g, col) => ref(R.grp, k + "." + g, col), ln = (k, code, col) => ref(R.line, k + "." + code, col), NT = (k, col) => ref(R.note, k, col);

  // ---- Balance Sheet ----
  titles("bs", "Balance Sheet as at " + cyAt);
  heads("bs", 6, false);
  let br = 8;
  const BSG = { sc: ["3", ["sc", "cap"]], rs: ["4", ["res", "sur"]], ltb: ["30"], dtl: ["31"], oltl: ["32"], ltp: ["5", ["lt"]], stb: ["33"], tpm: ["6", ["msme"]], tpo: ["6", ["oth"]], ocl: ["7"], stp: ["5", ["st"]],
    ppe: ["8", ["ppe"]], intang: ["34", ["int"]], cwip: ["35", ["cwip"]], iaud: ["35", ["iaud"]], nci: ["36"], dta: ["9"], ltla: ["38", ["la"]], onca: ["38", ["onca"]], ci: ["37"], inv: ["39"], tr: ["10"], cash: ["11"], stla: ["12", ["la"]], oca: ["12", ["oca"]] };
  const bsRefs = (id, col) => { const [k, gs] = BSG[id]; const cat = fs.NOTES.filter((n) => n.key === k && (!n.only || n.only === kind))[0]; const all = gs || (cat ? cat.groups.map((z) => z[0]) : []); return all.map((g) => grp(k, g, col)).filter((x) => x !== "0"); };
  const secOrder = [["EQUITY AND LIABILITIES", ["EQ", "NCL", "CL"], "eqL"], ["ASSETS", ["NCA", "CA"], "assets"]];
  const secRow = {};
  secOrder.forEach(([title, secs, tk], si) => {
    put("bs", "C" + br, title, { b: true }); br += 2;
    secs.forEach((s) => {
      const S = d.bs.sections[s];
      const vis = S.lines.filter((l) => bsRefs(l.id, "cy").length || bsRefs(l.id, "py").length);
      // a section with no line (a firm without non-current liabilities) is left out; its total reads 0
      if (!vis.length) { R.bsSec[s] = { cy: "0", py: "0" }; return; }
      put("bs", "C" + br, S.label, { b: true }); br++;
      const r0 = br;
      let tpCap = false;
      vis.forEach((l) => {
        const li = S.lines.indexOf(l), tp = l.id === "tpm" || l.id === "tpo";
        // trade payables as the workbooks show them: a caption with the note, then the two kinds of dues
        if (tp && !tpCap) { tpCap = true; put("bs", "C" + br, "Trade payables"); if (l.no) put("bs", "E" + br, l.no, { al: "center" }); br++; }
        put("bs", "C" + br, tp ? "   - " + l.label.replace(/^Trade payables: o/, "O") : l.label, { wrap: tp });
        if (l.no && !tp) put("bs", "E" + br, l.no, { al: "center" });
        if (tp && l.label.length > 60) WS.bs.getRow(br).height = 30;
        ["cy", "py"].forEach((col) => put("bs", (col === "cy" ? "F" : "H") + br, { f: () => (bsRefs(l.id, col).length > 1 ? "ROUND(" + plus(bsRefs(l.id, col)) + ",DEC)" : plus(bsRefs(l.id, col))), v: l[col], src: ["bs", "sections", s, "lines", li, col] }, { nf }));
        (R.bs[l.id] = {}).cy = A(SH.bs, "F", br); R.bs[l.id].py = A(SH.bs, "H", br);
        br++;
      });
      ["cy", "py"].forEach((col) => { const c = col === "cy" ? "F" : "H"; put("bs", c + br, { f: vis.length ? "SUM(" + c + r0 + ":" + c + (br - 1) + ")" : "0", v: S.total[col], src: ["bs", "sections", s, "total", col] }, { b: true, top: true, nf }); });
      R.bsSec[s] = { cy: A(SH.bs, "F", br), py: A(SH.bs, "H", br) }; secRow[s] = br;
      br += 2;
    });
    put("bs", "C" + br, "TOTAL", { b: true });
    ["cy", "py"].forEach((col) => { const c = col === "cy" ? "F" : "H"; put("bs", c + br, { f: secs.filter((s) => secRow[s]).map((s) => c + secRow[s]).join("+") || "0", v: d.bs.total[tk][col], src: ["bs", "total", tk, col] }, { b: true, dbl: true, nf }); });
    R.bsTot[tk] = { cy: A(SH.bs, "F", br), py: A(SH.bs, "H", br) };
    br += 2;
    void si;
  });
  const lastNote = d.notes.length ? d.notes[d.notes.length - 1].no : 2;
  put("bs", "C" + br, "The accompanying notes form an integral part of the financial statements", {}); put("bs", "E" + br, "1-" + lastNote, { al: "center" }); br += 2;
  // the signature blocks, from the Inputs
  const sig = (k, row) => {
    const txt = (addr, pre, v) => ({ f: (pre ? qs(pre) + "&" : '""&') + addr, v: (pre || "") + (v == null ? "" : v) });
    put(k, "C" + row, "As per our report of even date attached");
    put(k, "E" + row, co ? "For and on behalf of the Board of Directors of" : "For and on behalf of"); row++;
    put(k, "C" + row, txt(IN.afirm, "For ", inp.auditor.firm), { b: true }); put(k, "E" + row, txt(IN.name, "", inp.name), { b: true }); row++;
    put(k, "C" + row, "Chartered Accountants"); if (co) put(k, "E" + row, txt(IN.cin, "CIN: ", inp.cin)); row++;
    put(k, "C" + row, txt(IN.frn, "FRN: ", inp.auditor.frn)); row += 4;
    put(k, "C" + row, txt(IN.partner, "", inp.auditor.partner), { b: true });
    const p = (i) => ppl[i] || {};
    [0, 1].forEach((i) => { const c = i ? "H" : "E"; put(k, c + row, txt(IN.ppl[i].name, "", p(i).name || ""), { b: true }); });
    row++;
    put(k, "C" + row, "Partner");
    [0, 1].forEach((i) => { const c = i ? "H" : "E"; put(k, c + row, txt(IN.ppl[i].desig, "", p(i).desig || (co ? "Director" : "Partner"))); });
    row++;
    put(k, "C" + row, txt(IN.mno, "Membership No. ", inp.auditor.mno));
    [0, 1].forEach((i) => { const c = i ? "H" : "E"; put(k, c + row, txt(IN.ppl[i].din, co ? "DIN: " : "DIN / DPIN: ", p(i).din || "")); });
    row++;
    put(k, "C" + row, txt(IN.udin, "UDIN: ", inp.udin)); row += 2;
    put(k, "C" + row, txt(IN.aplace, "Place: ", inp.auditor.place)); put(k, "E" + row, txt(IN.place, "Place: ", inp.place)); row++;
    put(k, "C" + row, txt(IN.date, "Date: ", inp.date)); put(k, "E" + row, txt(IN.date, "Date: ", inp.date)); row++;
    return row;
  };
  br = sig("bs", br);
  stdWidths("bs"); page("bs", "A1:H" + br);

  // ---- Profit-Loss ----
  titles("pl", "Statement of Profit and Loss " + forWhat);
  heads("pl", 5, true);
  const P = (k, col) => ref(R.pl, k, col);
  const ROUNDs = (xs) => "ROUND(" + plus(xs) + ",DEC)";
  const depF = (col) => {
    const g = col === "cy" ? R.ppe.cy : R.ppe.py, gi = col === "cy" ? R.int.cy : R.int.py;
    const part = (s, code) => (s && s.partial ? "ROUND(" + SP(code) + ",DEC)" : (s && s.I) || "0");
    return "ROUND(" + part(g, "8E") + "+" + part(gi, "34D") + ",DEC)";
  };
  const plF = {
    rev: (c) => grp("13", "rev", c), oth: (c) => grp("14", "oth", c), inc: (c) => ROUNDs([P("rev", c), P("oth", c)]),
    mat: (c) => grp("40", "mat", c), pur: (c) => grp("41", "pur", c), chg: (c) => grp("42", "chg", c), emp: (c) => grp("15", "emp", c), fin: (c) => grp("16", "fin", c),
    dep: depF, exp: (c) => grp("17", "exp", c),
    tot: (c) => "ROUND(" + ["mat", "pur", "chg", "emp", "fin", "dep", "exp"].map((k) => P(k, c)).join("+") + ",DEC)",
    pbe: (c) => "ROUND(" + P("inc", c) + "-" + P("tot", c) + ",DEC)", exc: (c) => grp("43", "exc", c), pbt: (c) => "ROUND(" + P("pbe", c) + "-" + P("exc", c) + ",DEC)",
    cur: (c) => LVf(c, "22A", 1), prior: (c) => LVf(c, "22B", 1), def: (c) => LVf(c, "22C", 1),
    tax: (c) => "ROUND(" + P("cur", c) + "+" + P("prior", c) + "+" + P("def", c) + ",DEC)", pat: (c) => "ROUND(" + P("pbt", c) + "-" + P("tax", c) + ",DEC)" };
  const bold = { inc: 1, tot: 1, pbe: 1, pbt: 1, tax: 1, pat: 1 };
  plVis.forEach((x) => {
    if (x.head) { put("pl", "C" + x.row, x.head, { b: true }); return; }
    if (x.gap) return;
    const l = x.l, li = d.pl.lines.indexOf(l);
    put("pl", "C" + x.row, l.label, { b: !!bold[l.key] }); if (l.no) put("pl", "E" + x.row, l.no, { al: "center" });
    ["cy", "py"].forEach((col) => put("pl", (col === "cy" ? "F" : "H") + x.row, { f: () => { const f = plF[l.key](col); return f === "0" ? "0" : f; }, v: l[col], src: ["pl", l.key, col] },
      { nf, b: !!bold[l.key], top: !!bold[l.key] && l.key !== "pat", dbl: l.key === "pat" }));
  });
  let plr = PLR._end + 1;
  if (d.pl.eps) {
    put("pl", "C" + plr, { f: '"Earnings per equity share (face value Rs "&' + IN.face + '&" each), basic and diluted (Rs)"', v: "Earnings per equity share (face value Rs " + N(inp.shares.face) + " each), basic and diluted (Rs)" });
    put("pl", "F" + plr, { f: "ROUND(-SUMIFS(" + TBc("F") + "," + TBc("J") + ',"PL")/SHARES,2)', v: d.pl.eps.cy, src: ["pl", "eps", "cy"] }, { nf: "0.00" });
    put("pl", "H" + plr, { f: "ROUND(-SUMIFS(" + TBc("C") + "," + TBc("J") + ',"PL")/SHARES,2)', v: d.pl.eps.py, src: ["pl", "eps", "py"] }, { nf: "0.00" });
    plr += 2;
  }
  put("pl", "C" + plr, "The accompanying notes form an integral part of the financial statements"); put("pl", "E" + plr, "1-" + lastNote, { al: "center" }); plr += 2;
  plr = sig("pl", plr);
  stdWidths("pl"); widths("pl", { I: 3, J: 52, K: 16, L: 16 }); page("pl", "A1:H" + plr);
  // the rounding Note 17 absorbs (docs: "<plug>"), worked out beside the statement (columns J-L, outside the print area)
  if (raw17.cy) {
    const n17 = d.notes.find((n) => n.key === "17"), ls = n17.lines.filter((l) => l.code), j = ls.findIndex((l) => l.code === "17J");
    const rows17 = (col) => { const c = col === "cy" ? "F" : "H", rs = []; let rr = raw17.cy.row - j; ls.forEach((l, i) => { if (i !== j) rs.push(c + (rr + i)); }); return rs; };
    // the rows of Note 17's lines run together (one group, no heads): checked here
    const contiguous = n17.lines.filter((l) => !l.total && !l.head).length === ls.length && Object.keys(n17.groups).length === 1;
    const exRaw = (col) => { const others = contiguous ? rows17(col).map((x) => Q(SH.notes) + "!" + x) : []; return "ROUND(" + plus(others.concat([raw17[col].addr])) + ",DEC)"; };
    let hr = 6;
    put("pl", "J" + hr, "Rounding put in Note 17 (not printed)", { b: true }); put("pl", "K" + hr, "CY", { b: true, al: "right" }); put("pl", "L" + hr, "PY", { b: true, al: "right" }); hr++;
    const pre = {};
    ["cy", "py"].forEach((col) => {
      const p = d.pl, plug = N(d.plug[col]), x = {};
      x.exp = RND(N(p.exp[col]) - plug, dec);
      x.tot = RND(N(p.mat[col]) + N(p.pur[col]) + N(p.chg[col]) + N(p.emp[col]) + N(p.fin[col]) + N(p.dep[col]) + x.exp, dec);
      x.pbt = RND(RND(N(p.inc[col]) - x.tot, dec) - N(p.exc[col]), dec);
      x.pat = RND(x.pbt - N(p.tax[col]), dec);
      const S = d.bs.sections, n4 = d.notes.find((n) => n.key === "4"), n3 = d.notes.find((n) => n.key === "3");
      const lnv = (n, code) => (n ? N((n.lines.find((l) => l.code === code) || {})[col]) : 0);
      const eqPre = co ? (n3 ? N(n3.total[col]) : 0) + (n4 ? N((n4.groups.res || {})[col]) : 0) + lnv(n4, "4A") + lnv(n4, "4E")
        : lnv(n3, "3P") + lnv(n3, "3Q") + lnv(n3, "3R") + (n4 ? N(n4.total[col]) : 0);
      x.bsp = (N(S.NCA.total[col]) + N(S.CA.total[col])) - (eqPre + N(S.NCL.total[col]) + N(S.CL.total[col]));
      x.res = RND(x.pat - x.bsp, dec); x.plug = plug;
      pre[col] = x;
    });
    const C = (col) => (col === "cy" ? "K" : "L"), at = (col, rr) => A(SH.pl, C(col), rr);
    const rowsH = [["exp", "Other expenses (Note 17) before rounding", (col) => exRaw(col)],
      ["tot", "Total expenses before rounding", (col, rr) => "ROUND(" + ["mat", "pur", "chg", "emp", "fin", "dep"].map((k) => P(k, col)).join("+") + "+" + at(col, rr.exp) + ",DEC)"],
      ["pbt", "Profit before tax before rounding", (col, rr) => "ROUND(ROUND(" + P("inc", col) + "-" + at(col, rr.tot) + ",DEC)-" + P("exc", col) + ",DEC)"],
      ["pat", "Profit for the year before rounding", (col, rr) => "ROUND(" + at(col, rr.pbt) + "-" + P("tax", col) + ",DEC)"],
      ["bsp", "Balance sheet: assets - (equity before this year's profit + liabilities)", (col) => {
        const eqPre = co ? plus([NT("3", col), grp("4", "res", col), ln("4", "4A", col), ln("4", "4E", col)]) : plus([ln("3", "3P", col), ln("3", "3Q", col), ln("3", "3R", col), NT("4", col)]);
        return R.bsTot.assets[col] + "-(" + eqPre + "+" + R.bsSec.NCL[col] + "+" + R.bsSec.CL[col] + ")"; }],
      ["res", "Difference, rounded", (col, rr) => "ROUND(" + at(col, rr.pat) + "-" + at(col, rr.bsp) + ",DEC)"],
      ["plug", "Rounding put in Note 17 (within the tolerance, else nil)", (col, rr) => "IF(ABS(" + at(col, rr.res) + ")<=TOL," + at(col, rr.res) + ",0)"]];
    const RR = {};
    rowsH.forEach(([k], i) => { RR[k] = hr + i; });
    rowsH.forEach(([k, label, f]) => {
      put("pl", "J" + RR[k], label, { i: k !== "plug", b: k === "plug" });
      ["cy", "py"].forEach((col) => put("pl", C(col) + RR[k], { f: () => f(col, RR), v: pre[col][k], src: k === "plug" ? ["plug", col] : undefined }, { nf: k === "bsp" ? NF2 : nf }));
    });
    R.plug = { cy: at("cy", RR.plug), py: at("py", RR.plug) };
  }

  // ---- CF ----
  titles("cf", "Cash Flow Statement " + forWhat);
  heads("cf", 6, true, false);
  const CFH = { pbt: "A. Cash flow from operating activities", dep: "Adjustments for:", wc_tp: "Changes in working capital:", capex: "B. Cash flow from investing activities", equity: "C. Cash flow from financing activities" };
  const CFB = { opBefore: 1, cashGen: 1, op: 1, inv: 1, fin: 1, net: 1, close: 1 };
  const CR = {};
  {
    let rr = 8;
    d.cf.lines.forEach((l) => { if (CFH[l.key]) rr++; CR[l.key] = rr; rr++; if (["op", "inv", "fin", "net"].includes(l.key)) rr++; });
    CR._end = rr;
  }
  const cf = (k) => A(SH.cf, "F", CR[k]);
  const D = (k) => "ROUND(" + NT(k, "cy") + "-" + NT(k, OBc) + ",DEC)";
  const DG = (k, g) => "ROUND(" + grp(k, g, "cy") + "-" + grp(k, g, OBc) + ",DEC)";
  const DL = (k, code) => "ROUND(" + ln(k, code, "cy") + "-" + ln(k, code, OBc) + ",DEC)";
  const L = (k, code) => ln(k, code, "cy");
  const ppeT = (s, c) => (s.cy && s.cy[c]) || "0";
  const R5 = (xs) => "ROUND(" + xs.join("+") + ",DEC)";
  const cfF = {
    pbt: () => P("pbt", "cy"), dep: () => P("dep", "cy"), finc: () => P("fin", "cy"),
    psale: () => "ROUND(-" + L("14", "14B") + "+" + L("17", "17T") + ",DEC)", intinc: () => "ROUND(-(" + L("14", "14A") + "+" + L("14", "14D") + "),DEC)",
    opBefore: () => R5(["pbt", "dep", "finc", "psale", "intinc"].map(cf)),
    wc_tp: () => D("6"), wc_ocl: () => "ROUND(" + D("7") + "-" + DL("7", "7D") + "-" + DL("7", "7F") + ",DEC)", wc_prov: () => D("5"), wc_oltl: () => D("32"),
    wc_la: () => "ROUND(-(" + DG("12", "la") + "-" + DL("12", "12B") + ")-" + DG("38", "la") + "-" + DG("38", "onca") + ",DEC)",
    wc_tr: () => "ROUND(-" + D("10") + ",DEC)", wc_inv: () => "ROUND(-" + D("39") + ",DEC)", wc_oca: () => "ROUND(-(" + DG("12", "oca") + "-" + DL("12", "12E") + "),DEC)",
    cashGen: () => R5(["opBefore", "wc_tp", "wc_ocl", "wc_prov", "wc_oltl", "wc_la", "wc_tr", "wc_inv", "wc_oca"].map(cf)),
    taxPaid: () => "ROUND(-((" + P("cur", "cy") + "+" + P("prior", "cy") + ")-" + DL("7", "7D") + "+" + DL("12", "12B") + "),DEC)",
    op: () => R5([cf("cashGen"), cf("taxPaid")]),
    capex: () => "ROUND(-(" + ppeT(R.ppe, "E") + "+" + ppeT(R.int, "E") + ")-" + D("35") + "+" + DL("7", "7F") + ",DEC)",
    sale: () => "ROUND(" + L("14", "14B") + "-" + L("17", "17T") + "-" + ppeT(R.ppe, "F") + "-" + ppeT(R.int, "F") + "+" + ppeT(R.ppe, "J") + "+" + ppeT(R.int, "J") + ",DEC)",
    obb: () => "ROUND(-" + DG("11", "obb") + ",DEC)", invest: () => "ROUND(-(" + D("36") + "+" + D("37") + "),DEC)", intRec: () => "ROUND(" + L("14", "14A") + "+" + L("14", "14D") + "-" + DL("12", "12E") + ",DEC)",
    inv: () => R5(["capex", "sale", "obb", "invest", "intRec"].map(cf)),
    equity: () => (co ? "ROUND(" + D("3") + "+" + DG("4", "res") + ",DEC)" : "ROUND(" + D("3") + "-" + P("pat", "cy") + "+" + D("4") + ",DEC)"),
    surplus: () => (co ? "ROUND(" + plus([L("4", "4A"), L("4", "4E")]) + "-" + grp("4", "sur", OBc) + ",DEC)" : "0"),
    borrow: () => "ROUND(" + D("30") + "+" + D("33") + ",DEC)", finPaid: () => "ROUND(-" + P("fin", "cy") + ",DEC)",
    fin: () => R5(["equity", "surplus", "borrow", "finPaid"].map(cf)),
    net: () => R5(["op", "inv", "fin"].map(cf)), open: () => grp("11", "cce", OBc), close: () => R5([cf("open"), cf("net")]), perNote: () => grp("11", "cce", "cy"),
    diff: () => "ROUND(" + cf("close") + "-" + cf("perNote") + ",DEC)" };
  d.cf.lines.forEach((l, li) => {
    const rr = CR[l.key];
    if (CFH[l.key]) put("cf", "C" + (rr - 1), CFH[l.key], { b: true });
    put("cf", "C" + rr, l.label, { b: !!CFB[l.key], i: l.key === "diff" });
    if (d.cf.cy) put("cf", "F" + rr, { f: cfF[l.key], v: l.cy, src: ["cf", "cy", l.key] }, { nf, b: !!CFB[l.key], top: !!CFB[l.key] && l.key !== "close", dbl: l.key === "close" });
    if (l.py != null) put("cf", "H" + rr, { f: fixedPy(l.py), v: l.py, src: ["cf", "py", l.key] }, { nf, b: !!CFB[l.key], top: !!CFB[l.key] && l.key !== "close", dbl: l.key === "close" });
    R.cf[l.key] = { cy: A(SH.cf, "F", rr), py: l.py != null ? A(SH.cf, "H", rr) : null };
  });
  let cr = CR._end + 1;
  if (!d.cf.py) { put("cf", "C" + cr, part && per.pyNote ? per.pyNote : "The previous year's cash flow is not shown: FinCom has no books for the year before.", { i: true }); cr += 2; }
  else { put("cf", "C" + cr, "The previous year's figures are as that year's statements work them out (values).", { i: true, sz: 9 }); cr += 2; }
  cr = sig("cf", cr);
  stdWidths("cf"); page("cf", "A1:H" + cr);

  // ---- Computation of Income (rupees): a full financial year only; a part of the year has the line that says so ----
  const cchk = {};
  if (!d.comp) {
    put("comp", "C2", { f: IN.name, v: inp.name }, { b: true, sz: 14 });
    put("comp", "C3", "Computation of total income and tax liability", { b: true, sz: 12 });
    put("comp", "C5", d.compNote || "The computation of income is for a full financial year.", { i: true });
    widths("comp", { A: 3, B: 4, C: 90 }); page("comp", "A1:C6");
  } else {
  const comp = d.comp, CL = {};
  put("comp", "C2", { f: IN.name, v: inp.name }, { b: true, sz: 14 });
  put("comp", "C3", "Computation of total income and tax liability", { b: true, sz: 12 });
  const RGL = { "115BAA": "Section 115BAA (22% + 10% surcharge + 4% cess)", normal: "Normal rates (company)", firm: "Firm / LLP: 30% + surcharge + 4% cess", slab: "Section 115BAC slab rates" };
  [["PAN", { f: '""&' + IN.pan, v: inp.pan || "" }], ["Assessment year", comp.ay], ["Previous year", fyLabel(d.fy) + " (April 1, " + yearOf(d.fy) + " to " + asAt(d.fy) + ")"], ["Tax regime", RGL[comp.regime] || comp.regime]]
    .forEach(([k, v], i) => { put("comp", "C" + (5 + i), k); put("comp", "D" + (5 + i), v); });
  put("comp", "D10", "Amount (Rs)", { b: true, al: "right" }); put("comp", "E10", "Amount (Rs)", { b: true, al: "right" }); put("comp", "F10", "Worked out (Rs)", { b: true, al: "right", sz: 9 }); put("comp", "G10", "Reason for a changed figure", { b: true, sz: 9 });
  let kr = 11;
  const cl = {}; comp.lines.forEach((l) => { cl[l.key] = l; });
  const CE = (k) => CL[k] || "0";
  const tbCells = (rows, col) => (rows || []).map((l) => R.tbRow[l]).filter(Boolean).map((rr) => Q(SH.tb) + "!" + col + rr);
  const rg = comp.regime;
  // tax at the regime's rates (FinSt.taxOn), its surcharge with marginal relief at each threshold
  const steps = rg === "115BAA" ? [[0, 0.10]] : rg === "firm" ? [[1e7, 0.12]] : rg === "normal" ? [[1e7, 0.07], [1e8, 0.12]] : [[5e6, 0.10], [1e7, 0.15], [2e7, 0.25]];
  const rateNormal = inp.small400 === false ? 0.30 : 0.25;
  const baseF = (ti) => (rg === "115BAA" ? ti + "*22%" : rg === "firm" ? ti + "*30%" : rg === "normal" ? ti + "*" + rateNormal
    : "IF(" + ti + "<=1200000,0,SUMPRODUCT(--(" + ti + ">{0;400000;800000;1200000;1600000;2000000;2400000}),(" + ti + "-{0;400000;800000;1200000;1600000;2000000;2400000}),{0;0.05;0.05;0.05;0.05;0.05;0.05}))");
  const rateAt = (i) => steps.reduce((r2, [t, s]) => (i > t ? s : r2), 0);
  const surF = (ti, tax) => {
    const rate = steps.slice().reverse().reduce((acc, [t, s]) => "IF(" + ti + ">" + t + "," + s + "," + acc + ")", "0");
    let f = "ROUND(" + tax + "*" + rate + ",2)";
    if (rg !== "115BAA") steps.forEach(([t]) => { const atT = Math.round(fs.taxOn(t, rg, inp).tax * 100) / 100 * (1 + rateAt(t)); f = "IF(" + ti + ">" + t + ",MIN(" + f + ",ROUND(MAX(0," + atT + "+" + ti + "-" + t + "-" + tax + "),2))," + f + ")"; });
    return f;
  };
  const sumOf = (keys) => keys.map(CE).join("+");
  const ADDS = comp.lines.filter((l) => l.sec === "A+").map((l) => l.key), LESS = comp.lines.filter((l) => l.sec === "A-").map((l) => l.key);
  const itd = comp.itdep;
  let itdTotal = null;
  const compF = {
    pbt: () => "ROUND(-SUMIFS(" + TBc("F") + "," + TBc("J") + ',"PL")+' + RS("22A") + "+" + RS("22B") + "+" + RS("22C") + ",2)",
    add_dep: () => "ROUND(" + RS("8E") + "+" + RS("34D") + ",2)", add_40a7: () => "ROUND(MAX(0," + RS("15E") + "),2)", add_43b_leave: () => "ROUND(-(" + RS("5B") + "+" + RS("5C") + "),2)",
    add_int_tds: () => "ROUND(" + plus(tbCells(cl.add_int_tds.rows, "F")) + ",2)", add_gst_int: () => "ROUND(" + plus(tbCells(cl.add_gst_int.rows, "F")) + ",2)", add_penalty: () => "ROUND(" + plus(tbCells(cl.add_penalty.rows, "F")) + ",2)",
    add_csr: () => "ROUND(" + RS("17R") + ",2)", add_loss_sale: () => "ROUND(" + RS("17T") + ",2)",
    less_itdep: () => itdTotal || "0",
    less_grat_paid: () => "ROUND(MAX(0,-(" + RSp("5A") + "+" + RSp("5E") + ")+" + RS("15E") + "+(" + RS("5A") + "+" + RS("5E") + ")),2)",
    less_43b_paid: () => { const base = "-(" + RSp("5B") + "+" + RSp("5C") + ")", rows = d.tb.rows, bv = -rows.filter((x) => x.code === "5B" || x.code === "5C").reduce((s, x) => s + x.py, 0), extra = Math.round((cl.less_43b_paid.calc - bv) * 100) / 100; return "ROUND(" + base + (extra ? "+" + extra : "") + ",2)"; },
    less_profit_sale: () => "ROUND(-" + RS("14B") + ",2)", less_ifos: () => "ROUND(-(" + RS("14A") + "+" + RS("14D") + "),2)",
    pgbp: () => "ROUND(" + CE("pbt") + "+" + sumOf(ADDS) + "-(" + sumOf(LESS) + "),2)",
    ifos: () => "ROUND(-(" + RS("14A") + "+" + RS("14D") + "),2)", gti: () => "ROUND(" + CE("pgbp") + "+" + CE("ifos") + ",2)",
    ti: () => "MAX(0,ROUND(" + CE("gti") + "-" + CE("ded") + ",-1))",
    tax: () => "ROUND(" + baseF(CE("ti")) + ",2)", sur: () => surF(CE("ti"), CE("tax")), cess: () => "ROUND((" + CE("tax") + "+" + CE("sur") + ")*4%,2)",
    taxTotal: () => "ROUND(" + CE("tax") + "+" + CE("sur") + "+" + CE("cess") + ",0)",
    tds: () => "ROUND(" + plus(d.tb.rows.filter((x) => x.code === "12B" && /\bTDS\b|\bTCS\b/i.test(x.ledger)).map((x) => "MAX(0," + Q(SH.tb) + "!D" + R.tbRow[x.ledger] + "-" + Q(SH.tb) + "!C" + R.tbRow[x.ledger] + ")")) + ",2)",
    adv: () => "ROUND(" + plus(d.tb.rows.filter((x) => x.code === "12B" && /ADVANCE TAX|SELF ASSESSMENT/i.test(x.ledger)).map((x) => "MAX(0," + Q(SH.tb) + "!D" + R.tbRow[x.ledger] + "-" + Q(SH.tb) + "!C" + R.tbRow[x.ledger] + ")")) + ",2)",
    payable: () => "ROUND(" + CE("taxTotal") + "-" + CE("tds") + "-" + CE("adv") + ",-1)" };
  const SECH = { A: "A. Profits and gains of business or profession", B: "B. Income from other sources", C: "C. Total income", D: "D. Tax liability" };
  let lastSec = "";
  const inD = (l) => l.sec === "A+" || l.sec === "A-";
  comp.lines.forEach((l, li) => {
    const s0 = l.sec[0];
    if (s0 !== lastSec) { if (lastSec) kr++; put("comp", "C" + kr, SECH[s0], { b: true }); kr++; lastSec = s0; }
    if (l.key === ADDS[0]) { put("comp", "C" + kr, "Add: inadmissible or considered separately", { b: true }); kr++; }
    if (l.key === LESS[0]) { put("comp", "C" + kr, "Less: allowable or considered separately", { b: true }); kr++; }
    const c = inD(l) ? "D" : "E", tot = ["pgbp", "gti", "ti", "taxTotal", "payable"].includes(l.key);
    put("comp", "C" + kr, (inD(l) ? "      " : "") + l.label + (l.edited ? " (changed: " + (l.why || "no reason given") + "; worked out in column F)" : ""), { b: tot, wrap: !!l.edited });
    const addr = A(SH.comp, c, kr); CL[l.key] = addr;
    const val = l.edited ? l.v : { f: compF[l.key] ? (() => compF[l.key]()) : String(l.v), v: l.v, src: ["comp", "lines", li, "v"] };
    if (!compF[l.key] && !l.edited) put("comp", c + kr, l.v, { nf: NF2 });   // a figure FinCom takes as it is (43B(h), 43B dues, Chapter VI-A)
    else put("comp", c + kr, val, { nf: NF2, b: tot, top: tot, fill: l.edited ? "FFFFFF99" : undefined });
    if (l.edited) { if (compF[l.key]) put("comp", "F" + kr, { f: () => compF[l.key](), v: l.calc, src: ["comp", "lines", li, "calc"] }, { nf: NF2, i: true }); put("comp", "G" + kr, l.why || "", { i: true, sz: 9 }); }
    kr++;
    if (l.key === "add_43b_stat" && (l.items || []).length) {
      put("comp", "C" + kr, "        To check, paid by the due date of the return: " + l.items.map(([n, a]) => n + " " + a).join("; "), { i: true, sz: 9, wrap: true });
      WS.comp.mergeCells("C" + kr + ":E" + kr); WS.comp.getRow(kr).height = 15 * Math.min(4, Math.ceil(l.items.length / 3) + 1); kr++;
    }
    if (l.key === ADDS[ADDS.length - 1]) { put("comp", "E" + kr, { f: () => "SUM(D" + (kr0(ADDS[0])) + ":D" + (kr0(ADDS[ADDS.length - 1])) + ")", v: ADDS.reduce((s, k) => s + cl[k].v, 0) }, { nf: NF2, top: true }); kr++; }
    if (l.key === LESS[LESS.length - 1]) { put("comp", "E" + kr, { f: () => "-SUM(D" + (kr0(LESS[0])) + ":D" + (kr0(LESS[LESS.length - 1])) + ")", v: -LESS.reduce((s, k) => s + cl[k].v, 0) }, { nf: NF2, top: true }); kr++; }
  });
  function kr0(k) { return Number(CL[k].replace(/^.*\$/, "")); }
  kr++;
  put("comp", "C" + kr, "Checks (should be nil)", { b: true }); kr++;
  comp.checks.forEach((c, i) => {
    put("comp", "C" + kr, c.label);
    const f = c.key === "pbt" ? () => { const x = R.pl.pbt.cy + "*UNIT-" + CE("pbt"); return "IF(ABS(ROUND(" + x + ",2))<=2*TOL*UNIT+0.011,0,ROUND(" + x + ",2))"; }
      : c.key === "provision" ? () => "ROUND(" + RS("22A") + "-" + CE("taxTotal") + ",0)" : null;
    put("comp", "E" + kr, f ? { f, v: c.value, src: ["comp", "checks", i, "value"] } : c.value, { nf: NF2 });
    cchk[c.key] = A(SH.comp, "E", kr); kr++;
  });
  kr++;
  // Annexure 1: depreciation under the Income-tax Act, by block
  put("comp", "C" + kr, "Annexure 1 - Depreciation as per the Income-tax Act (section 32)", { b: true }); kr++;
  // a block at a time, down the page (the sheet prints in portrait): depreciation at the full rate on the opening WDV
  // and the additions to 30 September less the sales, at half the rate on the additions after (FinSt.taxDep)
  const depCells = [];
  itd.blocks.forEach((b2, i) => {
    put("comp", "C" + kr, b2.name, { b: true }); kr++;
    const at = {};
    [["open", "Opening written-down value"], ["addA", "Add: additions up to 30 September"], ["addB", "Add: additions after 30 September (half the rate)"], ["sale", "Less: sales"], ["rate", "Rate"]].forEach(([k, label]) => {
      put("comp", "C" + kr, "      " + label); put("comp", "D" + kr, b2[k], { nf: k === "rate" ? "0%" : NF2 }); at[k] = "$D$" + kr; kr++;
    });
    const base = at.open + "+" + at.addA + "-" + at.sale;
    put("comp", "C" + kr, "      Depreciation");
    put("comp", "E" + kr, { f: "ROUND(MAX(0," + base + ")*" + at.rate + "+MAX(0," + at.addB + "+MIN(0," + base + "))*" + at.rate + "/2,0)", v: b2.dep, src: ["comp", "itdep", "blocks", i, "dep"] }, { nf: NF2 });
    depCells.push("E" + kr); const dc = "$E$" + kr; kr++;
    put("comp", "C" + kr, "      Closing written-down value", { i: true });
    put("comp", "D" + kr, { f: "ROUND(MAX(0," + at.open + "+" + at.addA + "+" + at.addB + "-" + at.sale + "-" + dc + "),2)", v: b2.close, src: ["comp", "itdep", "blocks", i, "close"] }, { nf: NF2, i: true, top: true });
    kr += 2;
  });
  put("comp", "C" + kr, "Total depreciation as per the Income-tax Act", { b: true });
  put("comp", "E" + kr, { f: depCells.length ? "ROUND(" + depCells.join("+") + ",2)" : "0", v: itd.total, src: ["comp", "itdep", "total"] }, { nf: NF2, b: true, dbl: true });
  itdTotal = A(SH.comp, "E", kr); kr++;
  if (!itd.blocks.length) { put("comp", "C" + kr, "No block: type the opening written-down values once on the Computation tab.", { i: true }); kr++; }
  widths("comp", { A: 3, B: 4, C: 72, D: 18, E: 18, F: 16, G: 40 });
  page("comp", "A1:E" + kr);
  }

  // ---- the checks on Inputs ----
  const half = "0.5*10^-DEC-1E-9", zf = (x, t) => "IF(ABS(ROUND(" + x + ",DEC+2))<=" + t + ",0,ROUND(" + x + ",DEC))";
  const ckF = {
    bsCy: () => zf(R.bsTot.eqL.cy + "-" + R.bsTot.assets.cy, half), bsPy: () => zf(R.bsTot.eqL.py + "-" + R.bsTot.assets.py, half),
    tbCy: () => (T.length ? "IF(ABS(ROUND(SUM(" + TBrng("F") + "),2))<0.011,0,ROUND(SUM(" + TBrng("F") + "),2))" : "0"),
    tbPy: () => (T.length ? "IF(ABS(ROUND(SUM(" + TBrng("C") + "),2))<0.011,0,ROUND(SUM(" + TBrng("C") + "),2))" : "0"),
    unmapped: () => (T.length ? zf("SUMPRODUCT((" + TBrng("G") + '="")*(ABS(' + TBrng("H") + ")+ABS(" + TBrng("I") + ")))", half) : "0"),
    surplus: () => zf(ln("4", "4A", "cy") + "-" + grp("4", "sur", "py"), "TOL"),
    ppeDep: () => zf("(" + ppeT(R.ppe, "I") + "+" + ppeT(R.int, "I") + ")-(" + LVf("cy", "8E", 1) + "+" + LVf("cy", "34D", 1) + ")", "TOL"),
    ppeNet: () => { const codes = fs.PPE.concat(fs.INT).reduce((a, c) => a.concat(c[3] ? [c[2], c[3]] : [c[2]]), []);
      return zf("(" + ppeT(R.ppe, "M") + "+" + ppeT(R.int, "M") + ")-ROUND(SUMPRODUCT(ISNUMBER(MATCH(" + TBrng("G") + ",{" + codes.map(qs).join(",") + "},0))*" + TBrng("H") + "),DEC)", "TOL"); },
    cfCy: () => zf(R.cf.diff.cy, "TOL"), cfPy: () => zf(R.cf.diff.py || "0", "TOL"),
    deferredTax: () => zf(P("def", "cy") + "-(ROUND(" + grp("31", "dtl", "cy") + "-" + grp("31", "dtl", OBc) + ",DEC)-ROUND(" + grp("9", "dta", "cy") + "-" + grp("9", "dta", OBc) + ",DEC))", "TOL"),
    compPbt: () => cchk.pbt,
    stockOpen: () => { const u2 = N(sk.upInv); return "IF(ABS(ROUND(" + (STK.A || N(sk.A && sk.A.v)) + "-" + u2 + ",2))<0.011,0,ROUND(" + (STK.A || N(sk.A && sk.A.v)) + "-" + u2 + ",2))"; }, unit: () => "IF(OR(UNIT=1,UNIT=1000,UNIT=100000,UNIT=10000000),0,1)" };
  d.checks.forEach((c, i) => put("inp", "C" + chkRows[c.key], ckF[c.key] ? { f: ckF[c.key], v: c.value, src: ["checks", i, "value"] } : c.value, { nf, fill: undefined }));
  void chkStart;

  // ---- Accounting Ratios (companies) ----
  if (co) {
    const ra = ratios(d);
    titles("ar", "Accounting ratios (Schedule III)");
    ["Sr. no.", "Ratio", "Numerator", "Denominator", part ? per.range : fyLabel(d.fy), part ? per.pyPlLabel : fyLabel(String(yearOf(d.fy) - 1)), "Variance"].forEach((h, i) => put("ar", "BCDEFGH"[i] + "6", h, { b: true, box: true, al: "center", wrap: true }));
    WS.ar.getRow(6).height = 31;
    // the figures the ratios use, linked to the statements, below the table
    const c0 = 7 + ra.list.length + 2, CA = {};
    put("ar", "C" + c0, "Figures used", { b: true }); put("ar", "F" + c0, part ? per.range : fyLabel(d.fy), { b: true, al: "right" }); put("ar", "G" + c0, part ? per.pyPlLabel : fyLabel(String(yearOf(d.fy) - 1)), { b: true, al: "right" });
    const refOf = (k, col) => (R.bsSec[k] ? R.bsSec[k][col] || "0" : k === "obb" ? grp("11", "obb", col) : k === "int14A" ? ln("14", "14A", col) : k === "int14D" ? ln("14", "14D", col) : R.bs[k] ? R.bs[k][col] : R.pl[k] ? R.pl[k][col] : "0");
    Object.keys(ra.comps).forEach((k, i) => {
      const rr = c0 + 1 + i; CA[k] = rr;
      put("ar", "C" + rr, COMP_LABEL[k] || k);
      ["cy", "py"].forEach((col) => put("ar", (col === "cy" ? "F" : "G") + rr, { f: () => refOf(k, col), v: ra.comps[k][col] }, { nf }));
    });
    const expr = (keys, c) => keys.map((k, i) => (k[0] === "-" ? "-" : i ? "+" : "") + c + "$" + CA[k[0] === "-" ? k.slice(1) : k]).join("");
    ra.list.forEach((x, i) => {
      const rr = 7 + i;
      put("ar", "B" + rr, i + 1, { box: true, al: "center" }); put("ar", "C" + rr, x.label, { box: true }); put("ar", "D" + rr, x.numL, { box: true, wrap: true, sz: 9 }); put("ar", "E" + rr, x.denL, { box: true, wrap: true, sz: 9 });
      ["F", "G"].forEach((c) => { const col = c === "F" ? "cy" : "py", den = "(" + expr(x.den, c) + ")";
        put("ar", c + rr, { f: "IF(" + den + "=0,0,(" + expr(x.num, c) + ")/" + den + ")", v: x[col], src: ["ratios", "list", i, col] }, { box: true, nf: x.pct ? "0.00%" : "0.00", al: "center" }); });
      put("ar", "H" + rr, { f: "IF(G" + rr + "=0,0,(F" + rr + "-G" + rr + ")/G" + rr + ")", v: x.variance, src: ["ratios", "list", i, "variance"] }, { box: true, nf: "0.00%", al: "center" });
      WS.ar.getRow(rr).height = 30;
    });
    widths("ar", { A: 3, B: 7, C: 34, D: 36, E: 36, F: 14, G: 14, H: 12 });
    page("ar", "A1:H" + (c0 + Object.keys(ra.comps).length + 1), true, true);
  }

  // every formula, now that each sheet is laid out
  pend.forEach(({ k, addr, c, val }) => {
    let f = typeof val.f === "function" ? val.f() : val.f;
    f = String(f).replace(/^=/, "");
    const v = typeof val.v === "number" ? (Object.is(val.v, -0) ? 0 : val.v) : val.v;
    c.value = { formula: f, result: v };
    cells.push({ sheet: SH[k], addr, f, v, src: val.src || null });
  });
  return { wb, cells, sheets: order.map((k) => SH[k]) };
}

function built(fy, opt) {
  const d = FS().build(String(fy), { unit: opt && opt.unit, dec: opt && opt.dec, period: opt && opt.period });
  if (!d || d.error) throw { code: "fin_error", message: (d && d.error) || "The statements could not be worked out." };
  return d;
}
const fileBase = (d) => String(d.inputs.name || "Client").replace(/[\\/:*?"<>|]+/g, " ").trim() + " Financial statements " + (d.period && !d.period.full ? d.period.range : "FY " + fyLabel(d.fy));

// the entries accepted to match the audited balance sheet (FinRecon.journal), as journal vouchers for Tally: one row a
// voucher, the date, the ledgers and the amount (FinCom never posts them)
async function journalBook(fy) {
  const ExcelJS = await ensureExcelJs(), rows = G.FinRecon ? G.FinRecon.journal(fy) : [];
  const wb = new ExcelJS.Workbook(); wb.creator = "FinCom";
  const ws = wb.addWorksheet("Journal");
  const name = (G.FinSt.inputs().name || "Client").replace(/[\\/:*?"<>|]+/g, " ").trim();
  ws.addRow([name + ": journal entries to match the audited balance sheet (" + (rows[0] ? rows[0].date : "") + "), to pass in Tally"]).font = { bold: true };
  ws.addRow(["Date", "Voucher type", "Debit ledger", "Credit ledger", "Amount (Rs)", "Narration"]).font = { bold: true };
  rows.forEach((r) => { const x = ws.addRow([r.date, r.type, r.dr, r.cr, r.amt, r.narr]); x.getCell(5).numFmt = "#,##0.00"; });
  [12, 12, 40, 40, 16, 70].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return { buffer: await wb.xlsx.writeBuffer(), name: name + " Journal entries for Tally " + (rows[0] ? rows[0].date : "") + ".xlsx", rows };
}

export const FinXlsx = {
  journalMake: journalBook,
  async journal(fy) {
    const x = await journalBook(fy);
    const blob = new Blob([x.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (typeof G.saveFile === "function") await G.saveFile(x.name, blob);
    else { const a = document.createElement("a"), u = URL.createObjectURL(blob); a.href = u; a.download = x.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
    return x.name;
  },
  async make(fy, opt) {
    const ExcelJS = await ensureExcelJs(), d = built(fy, opt || {});
    const { wb, cells, sheets } = workbook(ExcelJS, d);
    const buffer = await wb.xlsx.writeBuffer();
    return { buffer, name: fileBase(d) + ".xlsx", cells, sheets, unit: d.inputs.unit, dec: d.inputs.dec };
  },
  async download(fy, opt) {
    const x = await this.make(fy, opt);
    const blob = new Blob([x.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (typeof G.saveFile === "function") await G.saveFile(x.name, blob);
    else { const a = document.createElement("a"), u = URL.createObjectURL(blob); a.href = u; a.download = x.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
    return x.name;
  },
  sha256: EXCELJS_SHA256,
};

// ---------- the PDF: the print view, A4 portrait, each statement on a page of its own ----------
const H = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function money(v, dec) {
  if (v == null || v === "") return "";
  const n = +v || 0;
  if (Math.abs(n) < 0.5 * Math.pow(10, -dec)) return "-";
  const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Math.abs(n));
  return n < 0 ? "(" + s + ")" : s;
}
export function pdfHtml(d, opt) {
  opt = opt || {};
  const inp = d.inputs, dec = inp.dec, co = d.kind === "co", per = d.period || { full: true }, part = !per.full;
  const cy = part ? per.asAt : asAt(d.fy), py = part ? per.pyAsAt : asAt(String(yearOf(d.fy) - 1)), forWhat = part ? per.forWhat : "for the year ended " + cy;
  const M = (v) => money(v, dec);
  const head = (title) => '<header><div class="co">' + H(inp.name) + '</div><div class="st">' + H(title) + '</div><div class="un">' + H(inp.unitLine) + "</div></header>";
  const colHead = (isPL, which) => (isPL && part && which ? per.pyPlHead.map(H).join("<br>") : (isPL ? (part ? "For the period" : "Year ended") : "As at") + "<br>" + H(isPL && part ? per.range : which ? py : cy));
  const cols = (isPL, note) => "<thead><tr><th>Particulars</th>" + (note === false ? "" : '<th class="c">Note</th>') + '<th class="n">' + colHead(isPL, 0) + '</th><th class="n">' + colHead(isPL, 1) + "</th></tr></thead>";
  const row = (label, no, a, b, cls, note) => '<tr class="' + (cls || "") + '"><td>' + H(label) + "</td>" + (note === false ? "" : '<td class="c">' + H(no || "") + "</td>") + '<td class="n">' + M(a) + '</td><td class="n">' + M(b) + "</td></tr>";
  const ppl = (co ? inp.directors : (inp.partners && inp.partners.length ? inp.partners : inp.directors)) || [];
  const sig = () => {
    const p = (i) => ppl[i] || {};
    const person = (i) => '<div class="who"><b>' + H(p(i).name || "") + "</b><br>" + H(p(i).desig || (co ? "Director" : "Partner")) + "<br>" + (p(i).din ? (co ? "DIN: " : "DIN / DPIN: ") + H(p(i).din) : "&nbsp;") + "</div>";
    return '<div class="sig"><div class="aud">As per our report of even date attached<br><b>For ' + H(inp.auditor.firm) + "</b><br>Chartered Accountants<br>FRN: " + H(inp.auditor.frn) +
      '<div class="gap"></div><b>' + H(inp.auditor.partner) + "</b><br>Partner<br>Membership No. " + H(inp.auditor.mno) + "<br>UDIN: " + H(inp.udin) + "<br>Place: " + H(inp.auditor.place) + "<br>Date: " + H(inp.date) + "</div>" +
      '<div class="brd">' + (co ? "For and on behalf of the Board of Directors of" : "For and on behalf of") + "<br><b>" + H(inp.name) + "</b>" + (co && inp.cin ? "<br>CIN: " + H(inp.cin) : "") +
      '<div class="gap"></div><div class="two">' + person(0) + person(1) + "</div>Place: " + H(inp.place) + "<br>Date: " + H(inp.date) + "</div></div>";
  };
  const pages = [];
  // Balance sheet
  {
    let t = "";
    [["EQUITY AND LIABILITIES", ["EQ", "NCL", "CL"], "eqL"], ["ASSETS", ["NCA", "CA"], "assets"]].forEach(([title, secs, tk]) => {
      t += '<tr class="h1"><td colspan="4">' + title + "</td></tr>";
      secs.forEach((s) => {
        const S = d.bs.sections[s], vis = S.lines.filter((l) => l.cy || l.py);
        if (!vis.length) return;
        t += '<tr class="h2"><td colspan="4">' + H(S.label) + "</td></tr>";
        let cap = false;
        vis.forEach((l) => {
          const tp = l.id === "tpm" || l.id === "tpo";
          if (tp && !cap) { cap = true; t += '<tr><td>Trade payables</td><td class="c">' + H(l.no || "") + '</td><td></td><td></td></tr>'; }
          t += tp ? row("\u2003- " + l.label.replace(/^Trade payables: o/, "O"), "", l.cy, l.py) : row(l.label, l.no, l.cy, l.py);
        });
        t += row("", "", S.total.cy, S.total.py, "tot");
      });
      t += row("TOTAL", "", d.bs.total[tk].cy, d.bs.total[tk].py, "grand");
    });
    pages.push(["bs", "Balance Sheet as at " + cy, "<table>" + cols(false) + "<tbody>" + t + "</tbody></table>" + notesLine() + sig()]);
  }
  function notesLine() { const last = d.notes.length ? d.notes[d.notes.length - 1].no : 2; return (part ? [per.cmpNote, per.spansNote].filter(Boolean).map((t) => '<p class="ref" data-fs-cmp="">' + H(t) + "</p>").join("") : "") + '<p class="ref">The accompanying notes 1-' + last + " form an integral part of the financial statements.</p>"; }
  // P&L
  {
    const B = { inc: 1, tot: 1, pbe: 1, pbt: 1, tax: 1 };
    let t = "";
    d.pl.lines.forEach((l) => {
      if (l.key === "rev") t += '<tr class="h2"><td colspan="4">Income</td></tr>';
      if (l.key === "mat") t += '<tr class="h2"><td colspan="4">Expenses</td></tr>';
      if (l.key === "cur") t += '<tr class="h2"><td colspan="4">Tax expense</td></tr>';
      if (["mat", "pur", "chg", "exc"].includes(l.key) && !l.cy && !l.py) return;
      t += row(l.label, l.no, l.cy, l.py, l.key === "pat" ? "grand" : B[l.key] ? "tot" : "");
    });
    if (d.pl.eps) t += '<tr><td>Earnings per equity share (face value Rs ' + H(inp.shares.face) + ' each), basic and diluted (Rs)</td><td></td><td class="n">' + money(d.pl.eps.cy, 2) + '</td><td class="n">' + money(d.pl.eps.py, 2) + "</td></tr>";
    pages.push(["pl", "Statement of Profit and Loss " + forWhat, "<table>" + cols(true) + "<tbody>" + t + "</tbody></table>" + notesLine() + sig()]);
  }
  // CF
  {
    const CFH = { pbt: "A. Cash flow from operating activities", dep: "Adjustments for:", wc_tp: "Changes in working capital:", capex: "B. Cash flow from investing activities", equity: "C. Cash flow from financing activities" };
    const B = { opBefore: 1, cashGen: 1, op: 1, inv: 1, fin: 1, net: 1 };
    let t = "";
    d.cf.lines.forEach((l) => { if (CFH[l.key]) t += '<tr class="h2"><td colspan="3">' + H(CFH[l.key]) + "</td></tr>"; t += row(l.label, "", l.cy, l.py, l.key === "close" ? "grand" : B[l.key] ? "tot" : l.key === "diff" ? "it" : "", false); });
    pages.push(["cf", "Cash Flow Statement " + forWhat, "<table>" + cols(true, false) + "<tbody>" + t + "</tbody></table>" + (d.cf.py ? "" : '<p class="ref">' + H(part && per.pyNote ? per.pyNote : "The previous year's cash flow is not shown: FinCom has no books for the year before.") + "</p>") + sig()]);
  }
  // Notes (with the PPE schedules)
  {
    let t = "";
    const grid = (key, title, sched) => {
      let g = '<div class="note"><h3>Note ' + H(d.noteOf[key] || "-") + " " + H(title) + "</h3>";
      ["cy", "py"].forEach((col) => {
        const gr = sched[col];
        g += '<div class="sub">' + (part ? H(col === "cy" ? "For the period " + per.range : per.pyForWhat.replace(/^f/, "F")) : "As at " + H(col === "cy" ? cy : py)) + '</div><table class="grid"><thead><tr><th>Particulars</th>' + ["Gross block opening", "Additions", "(Sales)", "Gross block closing", "Acc. dep. opening", "Charge for the year", "(Sales) dep.", "Acc. dep. closing", "Net block opening", "Net block closing"].map((h) => '<th class="n">' + h + "</th>").join("") + "</tr></thead><tbody>";
        gr.rows.forEach((x) => { g += "<tr><td>" + H(x.label) + "</td>" + "DEFGHIJKLM".split("").map((c) => '<td class="n">' + (x[c] == null ? "" : M(x[c])) + "</td>").join("") + "</tr>"; });
        if (gr.rows.length) g += '<tr class="grand"><td>Total</td>' + "DEFGHIJKLM".split("").map((c) => '<td class="n">' + (gr.total[c] == null ? "" : M(gr.total[c])) + "</td>").join("") + "</tr>";
        else g += '<tr><td colspan="11"><i>Nil</i></td></tr>';
        g += "</tbody></table>";
        // depreciation credited straight to the asset ledgers (no accumulated-depreciation ledger): said under the grid
        const dcs = col === "cy" ? gr.rows.filter((x) => x.dc) : [];
        if (dcs.length) g += '<p style="font-size:9pt;margin:4px 0" data-fs-depcr=""><i>Depreciation of ' + M(dcs.reduce((s, x) => s + x.dc, 0)) + " (" + H(dcs.map((x) => x.label).join(", ")) + ") was credited directly to the asset in the books; it is shown as the charge for the year and added back to the gross block.</i></p>";
      });
      return g + "</div>";
    };
    d.notes.forEach((n) => {
      if (n.key === "8") { t += grid("8", "Property, plant and equipment", d.ppe); return; }
      if (n.key === "34") { t += grid("34", "Intangible assets", d.intang); return; }
      t += '<div class="note"><h3>Note ' + H(n.no) + " " + H(n.title) + "</h3><table>" + cols(n.st === "PL", false) + "<tbody>";
      const totals = n.lines.filter((l) => l.total).length;
      n.lines.forEach((l) => {
        if (l.head) t += '<tr class="h2"><td colspan="3">' + H(l.label) + "</td></tr>";
        else t += row(l.label, "", l.cy, l.py, l.total ? (totals === 1 ? "grand" : "tot") : "", false);
      });
      if (totals !== 1) t += row("Total", "", n.total.cy, n.total.py, "grand", false);
      t += "</tbody></table></div>";
    });
    pages.push(["notes", "Notes forming part of the financial statements " + forWhat, t]);
  }
  // Computation of income (rupees): a full financial year only
  if (d.comp) {
    const c = d.comp, SECH = { A: "A. Profits and gains of business or profession", B: "B. Income from other sources", C: "C. Total income", D: "D. Tax liability" };
    let t = "", last = "";
    const R2 = (v) => money(v, 2);
    c.lines.forEach((l) => {
      if (l.sec[0] !== last) { t += '<tr class="h2"><td colspan="3">' + SECH[l.sec[0]] + "</td></tr>"; last = l.sec[0]; }
      const sub = l.sec === "A+" || l.sec === "A-", tot = ["pgbp", "gti", "ti", "taxTotal", "payable"].includes(l.key);
      t += '<tr class="' + (tot ? "tot" : "") + '"><td' + (sub ? ' class="ind"' : "") + ">" + (l.sec === "A+" ? "Add: " : l.sec === "A-" ? "Less: " : "") + H(l.label) + (l.edited ? ' <span class="why">(changed: ' + H(l.why) + "; worked out " + R2(l.calc) + ")</span>" : "") + "</td>" +
        '<td class="n">' + (sub ? R2(l.v) : "") + '</td><td class="n">' + (sub ? "" : R2(l.v)) + "</td></tr>";
    });
    let a = "";
    if (c.itdep.blocks.length) {
      a = '<div class="sub">Annexure 1 - Depreciation as per the Income-tax Act (section 32)</div><table class="grid"><thead><tr><th>Block</th><th class="n">Opening WDV</th><th class="n">Additions to 30 Sep</th><th class="n">Additions after</th><th class="n">Sales</th><th class="n">Depreciation</th><th class="n">Closing WDV</th></tr></thead><tbody>' +
        c.itdep.blocks.map((b) => "<tr><td>" + H(b.name) + "</td>" + [b.open, b.addA, b.addB, b.sale, b.dep, b.close].map((v) => '<td class="n">' + R2(v) + "</td>").join("") + "</tr>").join("") +
        '<tr class="grand"><td>Total</td><td></td><td></td><td></td><td></td><td class="n">' + R2(c.itdep.total) + "</td><td></td></tr></tbody></table>";
    }
    const info = '<p class="meta">PAN: ' + H(inp.pan) + " &nbsp; Assessment year: " + H(c.ay) + " &nbsp; Previous year: " + H(fyLabel(d.fy)) + " &nbsp; Regime: " + H(c.regime) + "</p>";
    pages.push(["comp", "Computation of total income and tax liability", info + '<table><thead><tr><th>Particulars</th><th class="n">Amount (Rs)</th><th class="n">Amount (Rs)</th></tr></thead><tbody>' + t + "</tbody></table>" + a]);
  }
  if (opt.includeTb) {
    const t = d.tb.rows.map((r) => "<tr><td>" + H(r.ledger) + "</td><td>" + H(r.group) + "</td><td>" + H(r.code || "-") + '</td><td class="n">' + money(r.py, 2) + '</td><td class="n">' + money(r.cy, 2) + '</td><td class="n">' + money(r.adj, 2) + '</td><td class="n">' + money(r.final, 2) + "</td></tr>").join("");
    pages.push(["tb", "Trial balance " + forWhat + " (Rupees)", '<table class="grid"><thead><tr><th>Ledger</th><th>Group</th><th>Code</th><th class="n">PY</th><th class="n">CY</th><th class="n">Adjustments</th><th class="n">Final</th></tr></thead><tbody>' + t + "</tbody></table>"]);
  }
  const css = "@page{size:A4 portrait;margin:14mm 12mm}" +
    "body{font:11px/1.35 Cambria,Georgia,'Times New Roman',serif;color:#111;padding:0;margin:0}" +
    ".fs-page{break-before:page;page-break-before:always}.fs-page:first-child{break-before:auto;page-break-before:auto}" +
    "header{margin-bottom:10px}header .co{font-size:15px;font-weight:700}header .st{font-size:12.5px;font-weight:700;margin-top:2px}header .un{font-style:italic;margin-top:2px}" +
    "table{border-collapse:collapse;width:100%;margin:0 0 8px}th,td{border:0;padding:2px 4px;text-align:left;vertical-align:top;background:none}" +
    "th{font-weight:700;border-bottom:1px solid #111}td.n,th.n{text-align:right;white-space:nowrap;width:17%}td.c,th.c{text-align:center;width:7%}" +
    "tr.h1 td{font-weight:700;padding-top:8px}tr.h2 td{font-weight:700;padding-top:5px}tr.tot td{font-weight:700}tr.tot td.n{border-top:1px solid #111}" +
    "tr.grand td{font-weight:700}tr.grand td.n{border-top:1px solid #111;border-bottom:3px double #111}tr.it td{font-style:italic}td.ind{padding-left:18px}" +
    "table.grid{font-size:9px}table.grid td.n,table.grid th.n{width:auto}.note{break-inside:avoid;margin-bottom:10px}.note h3{font-size:11.5px;margin:6px 0 3px}.sub{font-weight:700;margin:6px 0 2px}" +
    ".sig{display:flex;justify-content:space-between;gap:20px;margin-top:22px;break-inside:avoid}.sig .gap{height:34px}.sig .aud{width:40%}.sig .brd{width:56%}.two{display:flex;gap:16px}.two .who{width:50%;margin-bottom:8px}" +
    "p.ref{margin:8px 0}p.meta{margin:0 0 8px}.why{font-style:italic;font-size:9.5px;color:#444}";
  const body = pages.map(([k, title, html]) => '<section class="fs-page" data-fs-page="' + k + '">' + head(title) + html + "</section>").join("");
  return { css, body, pages: pages.map((p) => p[0]), title: inp.name + " - Financial statements " + (part ? per.range : fyLabel(d.fy)) };
}

export const FinPdf = {
  html(fy, opt) { const d = built(fy, opt || {}); const x = pdfHtml(d, opt || {}); return "<style>" + x.css + "</style>" + x.body; },
  // the print view (as printView in src/js/18), A4 portrait: a window of its own, printed (or saved as PDF) from there
  open(fy, opt, win) {
    opt = opt || {};
    const w = win || window.open("", "_blank");
    if (!w) { if (typeof G.toast === "function") G.toast("Allow pop-ups for this site to print."); return null; }
    let x;
    try { x = pdfHtml(built(fy, opt), opt); }
    catch (e) { w.close(); if (typeof G.toast === "function") G.toast((e && e.message) || "The statements could not be worked out."); return null; }
    w.document.open();
    w.document.write("<!doctype html><html><head><meta charset=\"utf-8\"><title>" + H(x.title) + "</title><style>" + x.css + "</style></head><body>" + x.body + "</body></html>");
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* the person prints from the window */ } }, 400);
    return w;
  },
};

Object.assign(G, { FinXlsx, FinPdf });
