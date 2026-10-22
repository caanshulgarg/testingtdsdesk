// "My MIS" (ROUND 105, B5): the downloads of a worked-out report (misCustom.run's result).
//   MisXlsx.make(res, o) / download: an Excel workbook (ExcelJS, the lazy asset finExport.js loads: ensureExcelJs) with an
//     Inputs sheet holding the unit and decimals as the names UNIT and DEC (as the financial statements' workbook), and a
//     sheet per block. Every figure shown is a formula on the rupees beside it (ROUND(rupees/UNIT, DEC)); totals are SUM
//     formulas, % change and % of total are formulas, each ratio is a formula on its numerator and denominator (shown,
//     in rupees). Every formula carries its value, so a viewer that does not recalculate still shows the figures; a chart
//     block also has its picture (PNG) beside its table, as ExcelJS cannot write a chart.
//   MisPdf.html(res, o) / open: the print view, A4 portrait, the unit line under the title, one block after another.
import { ensureExcelJs } from "./finExport.js";
import { fmt, scale, RND, unitWord } from "./misCustom.js";
import { UNITS } from "../../../server/_shared/misdef.js";
import { chartSvg, themeHex } from "./misChartSvg.js";

const G = globalThis;
const NF = (dec) => (dec ? '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* \\-??_);_(@_)' : '_(* #,##0_);_(* \\(#,##0\\);_(* \\-??_);_(@_)');
const COL = (n) => { let s = ""; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const unitLine = (u) => "(All amounts in " + (UNITS[u.unit] || "Rupees") + ", unless otherwise stated)";
const sheetName = (t, used) => { let b = String(t || "Block").replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Block", n = b, i = 2; while (used.has(n.toLowerCase())) n = b.slice(0, 25) + " " + i++; used.add(n.toLowerCase()); return n; };
const num = (v) => typeof v === "number" && isFinite(v);
const RATIO_F = { pct: (n, d) => 'IF(' + d + '=0,"",ROUND(' + n + "/" + d + "*100,1))", x2: (n, d) => 'IF(OR(' + d + "<=0," + n + '<0),"not meaningful",ROUND(' + n + "/" + d + ",2))",
  x1: (n, d) => 'IF(' + d + '=0,"",ROUND(' + n + "/" + d + ",1))", diff: (n, d) => "ROUND((" + n + "-" + d + ")/UNIT,DEC)" };

// a chart as a PNG picture (the browser draws the SVG on a canvas)
export async function chartPng(spec, title) {
  const { svg, w, h } = chartSvg(spec, { w: 680, h: 260, theme: themeHex("light"), legend: true, bg: true, title });
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("the chart could not be drawn")); i.src = url; });
  const k = 2, c = document.createElement("canvas"); c.width = w * k; c.height = h * k;
  const x = c.getContext("2d"); x.scale(k, k); x.drawImage(img, 0, 0, w, h);
  return { base64: c.toDataURL("image/png"), w, h };
}

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
      try { const png = await chartPng(b.chart, b.title); const id = wb.addImage({ base64: png.base64, extension: "png" }); ws.addImage(id, { tl: { col: 0, row: foot + 1 }, ext: { width: png.w, height: png.h } }); }
      catch (e) { V(ws, "A" + (foot + 1), "The chart's picture could not be made here: its figures are in the table above.", { i: true, sz: 9 }); }
    }
  }
  return { wb, cells, sheets: wb.worksheets.map((w) => w.name) };
}

const fileBase = (res, o) => [o.company || res.company || "Client", res.name, res.periodLabel].filter(Boolean).join(" ").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
export const MisXlsx = {
  async make(res, o = {}) {
    const ExcelJS = await ensureExcelJs(), { wb, cells, sheets } = await workbook(ExcelJS, res, o), buffer = await wb.xlsx.writeBuffer();
    return { buffer, name: fileBase(res, o) + ".xlsx", cells, sheets };
  },
  async download(res, o = {}) {
    const x = await this.make(res, o), blob = new Blob([x.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    if (typeof G.saveFile === "function") await G.saveFile(x.name, blob);
    return x.name;
  },
};

// ---------- the print view (A4 portrait): the unit line under the title, one block after another
const H = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function pdfHtml(res, o = {}) {
  const u = res.units, cellTxt = (b, r, c) => { const v = r.cells[c.key]; if (v == null || v === "") return ""; if (c.kind === "pct") return v + "%"; if (b.by === "ratio") return fmt(v, u, r.unit === "₹" ? "" : r.unit); return b.measure === "count" ? String(v) : fmt(v, u); };
  const blocks = res.blocks.map((b) => {
    if (b.error) return '<section class="mb"><h2>' + H(b.title) + '</h2><p class="note">Could not be worked out: ' + H(b.error) + "</p></section>";
    let h = '<section class="mb' + (b.type === "kpi" ? " kpi" : "") + '" data-mis-pdf-block="' + H(b.id) + '"><h2>' + H(b.title) + "</h2>";
    if (b.type === "kpi" && b.kpi) {
      const k = b.kpi, unit = k.unit && k.unit !== "₹" ? k.unit : "";
      return h + '<div class="tile"><b>' + H(unit ? fmt(k.value, u, unit) : fmt(k.value, u)) + "</b>" + (unit ? "" : " <span>" + H(unitWord(u)) + "</span>") + (k.chg != null ? '<div class="sub">' + (k.chg >= 0 ? "+" : "") + k.chg + "% on " + H(k.baseLabel) + "</div>" : "") + "</div></section>";
    }
    if (b.type === "chart" && b.chart) h += '<div class="ch">' + chartSvg(b.chart, { w: 680, h: 230, theme: themeHex("light"), legend: true, title: b.title }).svg + "</div>";
    const many = b.cols.length > 8;
    h += '<table class="' + (many ? "many" : "") + '"><thead><tr><th>Particulars</th>' + b.cols.map((c) => '<th class="n">' + H(c.label) + "</th>").join("") + "</tr></thead><tbody>" +
      b.rows.concat(b.total ? [b.total] : []).map((r) => '<tr class="' + (r.kind === "total" ? "tot" : r.bold ? "b" : "") + '"><td>' + H(r.label) + "</td>" + b.cols.map((c) => '<td class="n">' + H(cellTxt(b, r, c)) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
    (b.notes || []).forEach((n) => { h += '<p class="note">' + H(n) + "</p>"; });
    return h + "</section>";
  }).join("");
  const css = "@page{size:A4 portrait;margin:12mm 11mm}body{font:10.5px/1.35 Inter,Arial,sans-serif;color:#111;margin:0}header{margin-bottom:10px}header .co{font-size:15px;font-weight:700}header .st{font-size:12.5px;font-weight:700;margin-top:2px}header .un{font-style:italic;margin-top:2px}" +
    "h2{font-size:12px;margin:12px 0 4px}.mb{break-inside:avoid;margin-bottom:8px}.kpi{display:inline-block;width:31%;margin-right:2%;vertical-align:top;break-inside:avoid}.tile{border:1px solid #cbd5e1;border-radius:6px;padding:8px}.tile b{font-size:16px}.tile span{color:#475569}.sub{color:#475569;font-size:9.5px;margin-top:2px}" +
    "table{border-collapse:collapse;width:100%}th,td{padding:2px 4px;text-align:left;vertical-align:top}th{border-bottom:1px solid #111;font-weight:700}td.n,th.n{text-align:right;white-space:nowrap}table.many{font-size:8.5px}tr.tot td{font-weight:700;border-top:1px solid #111}tr.b td{font-weight:700}.note{color:#475569;font-style:italic;margin:4px 0}.ch svg{max-width:100%;height:auto}";
  const body = "<header><div class=\"co\">" + H(res.company || o.company || "") + '</div><div class="st">' + H(res.name) + " · " + H(res.periodLabel) + '</div><div class="un">' + H(unitLine(u)) + "</div></header>" + blocks;
  return { css, body, title: (res.company ? res.company + " - " : "") + res.name };
}
export const MisPdf = {
  html(res, o) { const x = pdfHtml(res, o); return "<style>" + x.css + "</style>" + x.body; },
  open(res, o, win) {
    const w = win || window.open("", "_blank");
    if (!w) { if (typeof G.toast === "function") G.toast("Allow pop-ups for this site to print."); return null; }
    const x = pdfHtml(res, o || {});
    w.document.open();
    w.document.write("<!doctype html><html><head><meta charset=\"utf-8\"><title>" + H(x.title) + "</title><style>" + x.css + "</style></head><body>" + x.body + "</body></html>");
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* the person prints from the window */ } }, 400);
    return w;
  },
};
export { RND };
