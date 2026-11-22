// The Computation of Income as a CA's sheet: the lines in order with their sections (rows()), the print view the
// browser saves as PDF (html()), and the Excel workbook (workbook(ExcelJS), every total a formula with its value).
const N = (v) => +v || 0;
const INR = (v) => { const x = Math.round(N(v)); const s = Math.abs(x).toString(); const last3 = s.slice(-3), rest = s.slice(0, -3); return (x < 0 ? "-" : "") + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last3; };
export const money = INR;
const H = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const SECTIONS = [["bp", "Profits and gains of business or profession"], ["oh", "Income under other heads"], ["sl", "Set-off of losses"], ["ti", "Total income"], ["tx", "Tax on total income"], ["in", "Interest and fee"], ["pd", "Taxes paid and the balance"]];

export function rows(S) {
  const out = [];
  SECTIONS.forEach(([k, t]) => {
    const ls = (S.lines || []).filter((l) => l.sec === k);
    if (!ls.length) return;
    out.push({ head: true, label: t, sec: k });
    ls.forEach((l) => out.push(Object.assign({}, l, { shown: l.sign < 0 ? -l.amt : l.amt })));
  });
  return out;
}
export function title(X) { return "Computation of Income · AY 2026-27"; }
export function html(X) {
  const S = X.comp, P = X.profile || {};
  const body = rows(S).map((r) => r.head ? '<tr class="h"><td colspan="2">' + H(r.label) + "</td></tr>"
    : '<tr class="' + (r.total ? "t" : "") + '"><td>' + H(r.label) + (r.src ? '<div class="s">' + H(r.src) + "</div>" : "") + '</td><td class="n">' + H(INR(r.shown)) + "</td></tr>").join("");
  const css = "body{font:12px/1.45 Inter,system-ui,sans-serif;color:#18202E;margin:28px}h1{font:600 18px Georgia,serif;margin:0 0 4px}p{margin:0 0 2px;color:#4A5466}table{width:100%;border-collapse:collapse;margin-top:16px}td{padding:5px 6px;border-bottom:1px solid #E6E9EF;vertical-align:top}td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;width:140px}tr.h td{font-weight:600;background:#F3F5F9;border-bottom:0;padding-top:10px}tr.t td{font-weight:600;border-top:1px solid #9AA3B2}.s{font-size:10px;color:#6A7385}.f{margin-top:18px;font-size:10px;color:#6A7385}@page{size:A4;margin:14mm}";
  const head = "<h1>" + H(title(X)) + "</h1><p>" + H((P.orgName || [P.first, P.sur].filter(Boolean).join(" ")) + " · PAN " + (P.pan || "")) + "</p><p>" + H(X.form + " · " + (S.tax && S.tax.rateName || "")) + "</p>";
  return { title: title(X), css, body: head + "<table>" + body + "</table><p class=\"f\">FinCom " + H(X.version || "") + ". Worked out twice, independently; both agree to the rupee. Amounts in rupees.</p>" };
}
export function openPdf(X, win) {
  const w = win || window.open("", "_blank");
  if (!w) { if (typeof toast === "function") toast("Allow pop-ups for this site to save the PDF."); return null; }
  const x = html(X);
  w.document.open(); w.document.write("<!doctype html><html><head><meta charset=\"utf-8\"><title>" + H(x.title) + "</title><style>" + x.css + "</style></head><body>" + x.body + "</body></html>"); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* printed from the window */ } }, 400);
  return w;
}
export async function workbook(ExcelJS, X) {
  const S = X.comp, wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Computation", { views: [{ showGridLines: false }] });
  wb.creator = "FinCom";
  ws.getColumn(1).width = 78; ws.getColumn(2).width = 18; ws.getColumn(3).width = 60;
  const P = X.profile || {};
  ws.getCell("A1").value = title(X); ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = (P.orgName || [P.first, P.sur].filter(Boolean).join(" ")) + " · PAN " + (P.pan || "") + " · " + X.form;
  let r = 4, start = 0; const nf = "#,##,##0;(#,##,##0)";
  const cells = [];
  rows(S).forEach((x) => {
    if (x.head) { if (start) start = 0; ws.getCell("A" + r).value = x.label; ws.getCell("A" + r).font = { bold: true }; r++; start = r; return; }
    const c = ws.getCell("B" + r);
    if (x.total && x.key === "pgbp") c.value = { formula: "SUM(B" + start + ":B" + (r - 1) + ")", result: x.shown };
    else c.value = x.shown;
    c.numFmt = nf; ws.getCell("A" + r).value = x.label; ws.getCell("C" + r).value = x.src || "";
    if (x.total) { ws.getCell("A" + r).font = { bold: true }; c.font = { bold: true }; }
    cells.push({ addr: "B" + r, key: x.key, v: x.shown }); r++;
  });
  return { wb, cells };
}
