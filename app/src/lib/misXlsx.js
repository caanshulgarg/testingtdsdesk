// "My MIS" (ROUND 105, B5/B6): a worked-out report (misCustom.run's result) as an Excel workbook, for the browser's download
// (misExport.js) and the cloud's scheduled run (server/mis-run, Deno, with ExcelJS from npm). Pure: ExcelJS is passed in,
// and a chart's picture comes from o.chartPng (the browser draws it; the cloud has none and keeps the chart's table only).
// Inputs holds the unit and decimals as the names UNIT and DEC; a sheet per block; every figure a formula on the rupees
// beside it (ROUND(rupees/UNIT, DEC)); totals SUM formulas; % change, % of total and each ratio formulas; every formula
// with its value.
import { scale } from "./misCustom.js";
import { UNITS } from "../../../server/_shared/misdef.js";

const NF = (dec) => (dec ? '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* \\-??_);_(@_)' : '_(* #,##0_);_(* \\(#,##0\\);_(* \\-??_);_(@_)');
const COL = (n) => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const unitLine = (u) => "(All amounts in " + (UNITS[u.unit] || "Rupees") + ", unless otherwise stated)";
const sheetName = (t, used) => { let b = String(t || "Block").replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Block", n = b, i = 2; while (used.has(n.toLowerCase())) n = b.slice(0, 25) + " " + i++; used.add(n.toLowerCase()); return n; };
const num = (v) => typeof v === "number" && isFinite(v);
const RATIO_F = { pct: (n, d) => 'IF(' + d + '=0,"",ROUND(' + n + "/" + d + "*100,1))", x2: (n, d) => 'IF(OR(' + d + "<=0," + n + '<0),"not meaningful",ROUND(' + n + "/" + d + ",2))",
  x1: (n, d) => 'IF(' + d + '=0,"",ROUND(' + n + "/" + d + ",1))", diff: (n, d) => "ROUND((" + n + "-" + d + ")/UNIT,DEC)" };

export async function workbook(ExcelJS, res, o = {}) {
  const u = res.units, dec = u.dec === 0 ? 0 : 2, nf = NF(dec), wb = new ExcelJS.Workbook(), cells = [], used = new Set(["inputs"]);
  wb.creator = "FinCom"; wb.created = new Date();
  const font = (c, st = {}) => { c.font = { name: "Calibri", size: st.sz || 11, bold: !!st.b, italic: !!st.i, color: st.color ? { argb: st.color } : undefined }; if (st.nf) c.numFmt = st.nf; if (st.al) c.alignment = { horizontal: st.al, vertical: "top", wrapText: !!st.wrap }; };
  // a formula cell with its value (kept for a viewer that does not recalculate), recorded for the test
  const F = (ws, addr, f, v, st, rec) => { const c = ws.getCell(addr); c.value = { formula: f, result: v }; font(c, st || {}); if (rec !== false) cells.push({ sheet: ws.name, addr, v, f }); return c; };
  const V = (ws, addr, v, st) => { const c = ws.getCell(addr); c.value = v; font(c, st || {}); return c; };
  // Inputs: the unit and decimals every figure is shown in (change them here and every sheet follows)
  const inp = wb.addWorksheet("Inputs", { views: [{ showGridLines: false }] });
  inp.getColumn(1).width = 26; inp.getColumn(2).width = 48;
  V(inp, "A1", "My MIS", { b: true, sz: 14 }); V(inp, "A2", "Client"); V(inp, "B2", res.company || o.company || ""); V(inp, "A3", "Report"); V(inp, "B3", res.name); V(inp, "A4", "Period"); V(inp, "B4", res.periodLabel);
  V(inp, "A5", "Unit (1, 1000, 100000, 10000000)"); V(inp, "B5", u.unit || 1, { al: "left" }); inp.getCell("B5").name = "UNIT";
  V(inp, "A6", "Decimals (0 or 2)"); V(inp, "B6", dec, { al: "left" }); inp.getCell("B6").name = "DEC";
  V(inp, "A7", "Unit line"); F(inp, "B7", '"(All amounts in "&IF(UNIT=1,"Rupees",IF(UNIT=1000,"Rupees thousand",IF(UNIT=100000,"Rupees lakhs",IF(UNIT=10000000,"Rupees crores","Rupees"))))&", unless otherwise stated)"', unitLine(u), { i: true });
  V(inp, "A9", "Worked out by FinCom from the client's books: each figure as MIS and the Financial statements give it. The figures on each sheet are formulas on the rupees beside them.", { i: true, sz: 9 });
  for (const b of res.blocks) {
    if (b.error) continue;
    const ws = wb.addWorksheet(sheetName(b.title, used), { views: [{ showGridLines: false, state: "frozen", ySplit: 5, xSplit: 1 }], pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    V(ws, "A1", b.title, { b: true, sz: 13 }); V(ws, "A2", (res.company ? res.company + " · " : "") + res.name + " · " + res.periodLabel, { sz: 9 }); F(ws, "A3", "Inputs!$B$7", unitLine(u), { i: true, sz: 9 }, false);
    ws.getColumn(1).width = 38;
    const isRatio = b.by === "ratio", show = b.cols.filter((c) => c.kind !== "pct"), pctCols = b.cols.filter((c) => c.kind === "pct");
    const lines = b.rows.concat(b.total ? [b.total] : []), R0 = 6, last = R0 + lines.length - 1;
    // the columns shown, then (a column apart) the rupees each is worked out from
    const dispCol = {}, rawCol = {}; let ci = 1;
    show.forEach((c) => { dispCol[c.key] = COL(ci++); }); pctCols.forEach((c) => { dispCol[c.key] = COL(ci++); });
    const rawStart = ci + 1;
    V(ws, COL(rawStart) + "4", isRatio ? "Worked out from (rupees)" : "In rupees (the formulas' inputs)", { b: true, sz: 9, color: "FF64748B" });
    if (!isRatio) show.forEach((c, i) => { rawCol[c.key] = COL(rawStart + i); });
    V(ws, "A5", "Particulars", { b: true });
    show.concat(pctCols).forEach((c) => { V(ws, dispCol[c.key] + "5", c.label, { b: true, al: "right", wrap: true }); ws.getColumn(dispCol[c.key]).width = 14; });
    if (!isRatio) show.forEach((c) => { V(ws, rawCol[c.key] + "5", c.label, { b: true, al: "right", sz: 9, color: "FF64748B", wrap: true }); ws.getColumn(rawCol[c.key]).width = 14; });
    const periodKeys = show.filter((c) => c.kind === "period").map((c) => c.key);
    lines.forEach((r, k) => {
      const rr = R0 + k, isTot = r.kind === "total";
      V(ws, "A" + rr, r.label, { b: isTot || r.bold });
      if (isRatio) {
        // a ratio: the figure as a formula on its numerator and denominator (rupees), beside it
        show.forEach((c, i) => {
          const p = (r.parts || {})[c.key === "ly" ? "ly" : c.key], v = r.cells[c.key], nc = COL(rawStart + i * 2), dc = COL(rawStart + i * 2 + 1);
          if (k === 0) { V(ws, nc + "5", c.label + ": numerator", { b: true, sz: 9, al: "right", wrap: true, color: "FF64748B" }); V(ws, dc + "5", c.label + ": denominator", { b: true, sz: 9, al: "right", wrap: true, color: "FF64748B" }); ws.getColumn(nc).width = 15; ws.getColumn(dc).width = 15; }
          // days of purchases only for a client that buys goods (MIS's rule): none, no formula
          if (!p || !p.f || p.f === "days" && !num(p.d) || p.goods === false) { V(ws, dispCol[c.key] + rr, v == null ? "" : v, { al: "right" }); return; }
          V(ws, nc + rr, p.num, { nf: NF(2), sz: 9 }); V(ws, dc + rr, p.den, { nf: NF(2), sz: 9 });
          const n = nc + rr, d = dc + rr;
          const f = p.f === "days" ? 'IF(OR(' + n + "<=0," + d + '<=0),"",ROUND(' + n + "/(" + d + "/" + p.d + "),0))" : RATIO_F[p.f](n, d);
          F(ws, dispCol[c.key] + rr, f, v == null ? "" : p.f === "diff" ? scale(v, u) : v, { al: "right", nf: p.f === "diff" ? nf : p.f === "pct" ? "0.0" : p.f === "days" ? "0" : "0.00" });
        });
        return;
      }
      show.forEach((c) => {
        const rc = rawCol[c.key] + rr, v = r.cells[c.key];
        // the rupees: a row's own figure (a constant), or a SUM: the total row of the rows above, a row's total of its columns
        if (isTot && v == null) return;                                          // nothing to add up (last year not in these books)
        if (isTot && b.total && lines.length > 1) F(ws, rc, "SUM(" + rawCol[c.key] + R0 + ":" + rawCol[c.key] + (rr - 1) + ")", num(v) ? v : 0, { nf: NF(2), sz: 9 });
        else if (c.kind === "total" && periodKeys.length && r.colAdd && num(v) && Math.abs(periodKeys.reduce((s, kk) => s + (+r.cells[kk] || 0), 0) - v) < 0.005) F(ws, rc, "SUM(" + rawCol[periodKeys[0]] + rr + ":" + rawCol[periodKeys[periodKeys.length - 1]] + rr + ")", v, { nf: NF(2), sz: 9 });
        else V(ws, rc, num(v) ? v : null, { nf: NF(2), sz: 9 });
        if (num(v) || (isTot && b.total)) {
          const shown = b.measure === "count" ? v : scale(num(v) ? v : 0, u);
          F(ws, dispCol[c.key] + rr, b.measure === "count" ? rc : "ROUND(" + rc + "/UNIT,DEC)", shown, { nf: b.measure === "count" ? "0" : nf, b: isTot });
        }
      });
      // % change on last year or the budget; % of total
      pctCols.forEach((c) => {
        const v = r.cells[c.key], tc = rawCol.t + rr;
        if (c.key === "chg") { const bc = rawCol[b.cols.some((x) => x.key === "ly") ? "ly" : "bud"] + rr; F(ws, dispCol.chg + rr, 'IF(OR(' + bc + '="",' + bc + "=0),\"\",ROUND((" + tc + "-" + bc + ")/ABS(" + bc + ")*100,1))", v == null ? "" : v, { nf: "0.0", al: "right" }); }
        if (c.key === "share" && b.total) { const tt = rawCol.t + last; F(ws, dispCol.share + rr, "IF(" + tt + '=0,"",ROUND(' + tc + "/" + tt + "*100,1))", v == null ? "" : v, { nf: "0.0", al: "right" }); }
      });
      if (isTot) for (let i = 0; i <= ci; i++) ws.getCell(COL(i) + rr).border = { top: { style: "thin" } };
    });
    let foot = last + 2;
    (b.notes || []).forEach((n) => { V(ws, "A" + foot++, n, { i: true, sz: 9 }); });
    if (b.kpi) { V(ws, "A" + (foot + 1), "Tile: " + b.kpi.label + (b.kpi.baseLabel ? " (against " + b.kpi.baseLabel + ")" : ""), { i: true, sz: 9 }); foot += 2; }
    // the chart's picture under the table (its figures are the table above)
    if (b.type === "chart" && b.chart && o.images !== false) {
      try { if (typeof o.chartPng !== "function") throw new Error("no picture here"); const png = await o.chartPng(b.chart, b.title); const id = wb.addImage({ base64: png.base64, extension: "png" }); ws.addImage(id, { tl: { col: 0, row: foot + 1 }, ext: { width: png.w, height: png.h } }); }
      catch (e) { V(ws, "A" + (foot + 1), "The chart's picture could not be made here: its figures are in the table above.", { i: true, sz: 9 }); }
    }
  }
  return { wb, cells, sheets: wb.worksheets.map((w) => w.name) };
}

