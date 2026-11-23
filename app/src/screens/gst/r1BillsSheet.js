// The GSTR-1 bills Excel's sheet (R1Bills.jsx r1BillsExcel): one row a document, then table 7's lines, a totals row of SUMs.
// next-fix-audit-gst: with a Cess column, and the row Total over taxable, IGST, CGST, SGST and cess (SUM(I:M)), as the
// screen's Total. X: SheetJS (its utils.encode_cell / encode_range); list: the bills; b2cs: table 7's lines;
// o: {day(date), part(row), sumPart} -> the sheet (ws)
const G = globalThis;
const N = (v) => (typeof G.num === "function" ? G.num(v) : Number(v) || 0);
const R = (v) => (typeof G.r2 === "function" ? G.r2(v) : Math.round((Number(v) || 0) * 100) / 100);
export const R1_BILLS_HEAD = ["#", "Date", "Invoice no", "Customer", "GSTIN", "Part", "Place of supply", "Rate %", "Taxable", "IGST", "CGST", "SGST", "Cess", "Total"];
export function r1BillsSheet(X, list, b2cs, o) {
  const ws = {}, head = R1_BILLS_HEAD, TC = head.length - 1;
  const A = (c, r) => X.utils.encode_cell({ c, r }), s = (v) => ({ t: "s", v: String(v == null ? "" : v) }), m = (v, f) => (f ? { t: "n", v: R(v), f, z: "#,##0.00" } : { t: "n", v: R(N(v)), z: "#,##0.00" });
  const total = (l) => R(N(l[8]) + N(l[9]) + N(l[10]) + N(l[11]) + N(l[12]));
  head.forEach((h, c) => { ws[A(c, 0)] = s(h); });
  const lines = list.map((r, i) => [i + 1, o.day(r.date), r.no, r.party, r.gstin || "", o.part(r), r.pos || "", r.rate, r.taxable, r.igst, r.cgst, r.sgst, r.cess])
    .concat(b2cs.map((x) => ["", "", "", "B2C others: summary by state and rate", "", o.sumPart, x.pos, x.rate, x.taxable, x.igst, x.cgst, x.sgst, x.cess]));
  lines.forEach((l, i) => { const y = i + 1, Rw = y + 1; l.forEach((v, c) => { ws[A(c, y)] = c >= 8 ? m(v) : c === 0 || c === 7 ? { t: "n", v: N(v) } : s(v); }); ws[A(TC, y)] = m(total(l), "SUM(I" + Rw + ":M" + Rw + ")"); });
  const T = lines.length + 1, last = lines.length + 1;
  ws[A(3, T)] = s("Total: " + list.length + " bills" + (b2cs.length ? " + " + b2cs.length + " B2C summary lines" : ""));
  ["I", "J", "K", "L", "M", "N"].forEach((col, i) => { const c = 8 + i; ws[A(c, T)] = m(lines.reduce((a, l) => a + (c === TC ? total(l) : N(l[c])), 0), "SUM(" + col + "2:" + col + last + ")"); });
  ws["!ref"] = X.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: TC, r: T } });
  ws["!cols"] = [5, 12, 16, 32, 17, 30, 16, 7, 14, 12, 12, 12, 12, 14].map((w) => ({ wch: w }));
  return ws;
}
