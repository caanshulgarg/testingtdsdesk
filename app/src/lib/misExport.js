// "My MIS" (ROUND 105, B5): the downloads of a worked-out report (misCustom.run's result).
//   MisXlsx.make(res, o) / download: an Excel workbook (ExcelJS, the lazy asset finExport.js loads: ensureExcelJs) with an
//     Inputs sheet holding the unit and decimals as the names UNIT and DEC (as the financial statements' workbook), and a
//     sheet per block. Every figure shown is a formula on the rupees beside it (ROUND(rupees/UNIT, DEC)); totals are SUM
//     formulas, % change and % of total are formulas, each ratio is a formula on its numerator and denominator (shown,
//     in rupees). Every formula carries its value, so a viewer that does not recalculate still shows the figures; a chart
//     block also has its picture (PNG) beside its table, as ExcelJS cannot write a chart.
//   MisPdf.html(res, o) / open: the print view, A4 portrait, the unit line under the title, one block after another.
import { ensureExcelJs } from "./finExport.js";
import { workbook } from "./misXlsx.js";
import { fmt, scale, RND, unitWord } from "./misCustom.js";
import { UNITS } from "../../../server/_shared/misdef.js";
import { chartSvg, themeHex } from "./misChartSvg.js";

const G = globalThis;
const unitLine = (u) => "(All amounts in " + (UNITS[u.unit] || "Rupees") + ", unless otherwise stated)";

// a chart as a PNG picture (the browser draws the SVG on a canvas)
export async function chartPng(spec, title) {
  const { svg, w, h } = chartSvg(spec, { w: 680, h: 260, theme: themeHex("light"), legend: true, bg: true, title });
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("the chart could not be drawn")); i.src = url; });
  const k = 2, c = document.createElement("canvas"); c.width = w * k; c.height = h * k;
  const x = c.getContext("2d"); x.scale(k, k); x.drawImage(img, 0, 0, w, h);
  return { base64: c.toDataURL("image/png"), w, h };
}

const fileBase = (res, o) => [o.company || res.company || "Client", res.name, res.periodLabel].filter(Boolean).join(" ").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
export const MisXlsx = {
  async make(res, o = {}) {
    const ExcelJS = await ensureExcelJs(), { wb, cells, sheets } = await workbook(ExcelJS, res, Object.assign({ chartPng }, o)), buffer = await wb.xlsx.writeBuffer();
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
