// 2B reconciliation, one row per supplier invoice (round 72, 17-Oct-2026; the owner: "2B reco should be clear to
// understand"). The matching is GST2B.run / GST2B.scope (src/js/11), unchanged; this only lays its result out as rows
// with a Status, the Books and 2B values side by side and the fields that differ, and adds them up.
//
// Status (row.status): "matched" · "mismatch" (the amount differs: GST2B's "diff") · "probable" (to confirm) ·
// "books" (in books only) · "2b" (in 2B only). A matched row whose date, number or value (with the same tax) differs
// stays matched, as GST2B and the 3B's credit treat it, with that field highlighted (row.diffs).
//
// The automatic matcher's hook (branch next-2b-automatch): window.GSTAutoMatch.result(reg, months) may return
// {results: [{key2b, books: [voucher ids], status: "matched-rules" | "matched-ai" | "probable", reason, confidence}]}.
// applyAuto() puts each on its row (row.auto = {status, reason, confidence}); a pairing of a "2B only" row with
// "books only" rows becomes one row (Matched or Probable match). Nothing here changes an amount or decides credit;
// Accept on such a row is the existing link by hand (r2Link), Reject the existing "not the same" (r2Unlink).

export const STATUS = { matched: "Matched", mismatch: "Mismatch", probable: "Probable match", books: "In books only", "2b": "In 2B only" };
export const STATUS_ORDER = ["mismatch", "probable", "books", "2b", "matched"];
export const AUTO = { "matched-rules": "Matched by rules", "matched-ai": "Matched by AI", probable: "Probable match (AI)" };
const N = (v) => num(v);
const R = (v) => r2(v);
const tx = (o) => R(N(o.igst) + N(o.cgst) + N(o.sgst) + N(o.cess));
const sumOf = (list) => list.reduce((a, d) => ({ taxable: R(a.taxable + N(d.taxable)), igst: R(a.igst + N(d.igst)), cgst: R(a.cgst + N(d.cgst)), sgst: R(a.sgst + N(d.sgst)), cess: R(a.cess + N(d.cess)) }), { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const signed = (o, dir) => ({ taxable: R(N(o.taxable) * dir), igst: R(N(o.igst) * dir), cgst: R(N(o.cgst) * dir), sgst: R(N(o.sgst) * dir), cess: R(N(o.cess) * dir) });

function side2b(p, counted) {
  return { key: p.key, no: p.no, date: p.date, ym: p.ym, sec: p.sec, dir: p.dir || 1, itcavl: p.itcavl, rcm: !!p.rcm, ims: p.ims || "", ...signed(p, p.dir || 1),
    itc: counted && p.itcavl !== "N" ? R(tx(p) * (p.dir || 1)) : 0, counted, notAvl: p.itcavl === "N", p };
}
function sideBooks(list, inSpan) {
  const dir = (list[0] || {}).dir || 1, s = sumOf(list), cnt = list.filter((d) => inSpan(d.ym));
  return { ids: list.map((d) => d.id), no: list.map((d) => d.no).join(", "), date: (list[0] || {}).date, ym: (list[0] || {}).ym, voucher: list.map((d) => d.voucher).join(", "), dir, ...signed(s, dir),
    itc: R(cnt.reduce((a, d) => a + tx(d) * (d.dir || 1), 0)), counted: cnt.length === list.length, part: cnt.length > 0 && cnt.length < list.length, list };
}
// which fields of a pair differ: taxable, tax, the heads (IGST against CGST + SGST), date, number, GSTIN
export function diffsOf(p, books, tol) {
  const t = N(tol) || 1, s = sumOf(books), out = [], bd = books[0] || {};
  if (Math.abs(N(p.taxable) - s.taxable) > t) out.push("taxable");
  if (Math.abs(tx(p) - tx(s)) > t) out.push("tax");
  else if (Math.abs(N(p.igst) - s.igst) > t) out.push("head");
  if (p.date && bd.date && p.date !== bd.date) out.push("date");
  if (p.noN && bd.noN && p.noN !== bd.noN) out.push("no");
  if (p.gstin && bd.gstin && p.gstin !== bd.gstin) out.push("gstin");
  if (!bd.gstin) out.push("nogstin");
  return out;
}
export const DIFF_WORD = { taxable: "taxable value", tax: "tax amount", head: "IGST / CGST+SGST", date: "date", no: "invoice number", gstin: "GSTIN", nogstin: "no GSTIN in books" };
// the kind of a mismatch, for its label: amount, date or number first
export const mismatchKind = (r) => (r.diffs.some((k) => k === "taxable" || k === "tax" || k === "head") ? "amount" : r.diffs.includes("date") ? "date" : r.diffs.includes("no") ? "number" : r.diffs.includes("gstin") ? "GSTIN" : "");

// the rows of a reconciliation: sc is GST2B.scope(reg, months), months the period (null: everything), st GST2B.state()
export function recoRows(sc, months, st, tol) {
  const inSpan = (ym) => !months || months.includes(ym), tags = (st && st.tag) || {};
  const rows = [];
  sc.pairs.forEach((x) => {
    const b2 = side2b(x.p, inSpan(x.p.ym)), bk = sideBooks(x.books, inSpan);
    const status = x.status === "probable" ? "probable" : x.status === "diff" ? "mismatch" : "matched";
    rows.push({ key: x.p.key, status, party: x.p.party || (x.books[0] || {}).party || "", gstin: x.p.gstin || (x.books[0] || {}).gstin || "", twoB: b2, books: bk, diffs: diffsOf(x.p, x.books, tol), issues: x.issues,
      timing: x.timing, how: x.how, tier: x.tier, manual: !!x.manual, confirmed: !!x.confirmed, tag: (tags[x.p.key] || {}).tag || "", pair: x });
  });
  sc.only2b.forEach((p) => rows.push({ key: p.key, status: "2b", party: p.party || "", gstin: p.gstin || "", twoB: side2b(p, inSpan(p.ym)), books: null, diffs: [], issues: [], tag: (tags[p.key] || {}).tag || "", p }));
  sc.onlyBooks.forEach((d) => rows.push({ key: d.id, status: "books", party: d.party || "", gstin: d.gstin || "", twoB: null, books: sideBooks([d], inSpan), diffs: [], issues: [], tag: (tags[d.id] || {}).tag || "", d }));
  rows.forEach((r) => { r.itcBooks = r.books ? r.books.itc : 0; r.itc2b = r.twoB ? r.twoB.itc : 0; r.gap = R(r.itc2b - r.itcBooks); r.kind = r.status === "mismatch" ? mismatchKind(r) : ""; });
  return rows;
}

// the automatic matcher's result on the rows (see the head of this file); returns new rows, amounts untouched
export function applyAuto(rows, auto) {
  if (!auto || !Array.isArray(auto.results) || !auto.results.length) return rows;
  let out = rows.slice();
  auto.results.forEach((a) => {
    if (!a || !AUTO[a.status]) return;
    const i = out.findIndex((r) => r.twoB && r.twoB.key === a.key2b);
    if (i < 0) return;
    const r = out[i], info = { status: a.status, reason: String(a.reason || ""), confidence: a.confidence == null ? null : N(a.confidence) };
    if (r.status !== "2b") { out[i] = Object.assign({}, r, { auto: info, status: a.status === "probable" && r.status === "matched" ? r.status : a.status === "probable" ? "probable" : r.status }); return; }
    const ids = new Set(a.books || []), bk = out.filter((x) => x.status === "books" && x.books && x.books.ids.some((id) => ids.has(id)));
    if (!bk.length) { out[i] = Object.assign({}, r, { auto: info }); return; }
    const list = bk.flatMap((x) => x.books.list), books = Object.assign(sideBooks(list, () => true), { itc: R(bk.reduce((s, x) => s + x.books.itc, 0)) });
    books.counted = bk.every((x) => x.books.counted);
    const merged = Object.assign({}, r, { status: a.status === "probable" ? "probable" : "matched", books, auto: info, merged: true, diffs: diffsOf(r.twoB.p, list, 1), issues: [] });
    merged.itcBooks = books.itc; merged.gap = R(merged.itc2b - merged.itcBooks); merged.kind = "";
    out = out.filter((x) => !bk.includes(x)); out[out.indexOf(r)] = merged;
  });
  return out;
}
export function autoFor(reg, months) {
  try { return typeof window !== "undefined" && window.GSTAutoMatch && typeof window.GSTAutoMatch.result === "function" ? window.GSTAutoMatch.result(reg, months) : null; } catch (e) { return null; }
}

// the counts for the chips, and the totals: ITC as per books, as per 2B, and the difference
export function recoCounts(rows) { const c = { all: rows.length }; Object.keys(STATUS).forEach((k) => { c[k] = rows.filter((r) => r.status === k).length; }); return c; }
export function recoTotals(rows) {
  const books = R(rows.reduce((a, r) => a + r.itcBooks, 0)), twoB = R(rows.reduce((a, r) => a + r.itc2b, 0));
  return { books, twoB, diff: R(twoB - books) };
}

// the Excel: one row an invoice, Books and 2B side by side, ITC and the difference as formulas, a totals row of SUMs
export async function recoExcel(rows, title) {
  await ensureXlsx();
  const X = XLSX, ws = {}, A = (c, r) => X.utils.encode_cell({ c, r }), s = (v) => ({ t: "s", v: String(v == null ? "" : v) });
  const n = (v) => ({ t: "n", v: R(N(v)), z: "#,##0.00" }), f = (formula, v) => ({ t: "n", v: R(v), f: formula, z: "#,##0.00" });
  const d = (x) => (String(x || "").length === 8 ? String(x).slice(6, 8) + "-" + String(x).slice(4, 6) + "-" + String(x).slice(0, 4) : String(x || ""));
  const top = ["", "", "", "AS PER BOOKS", "", "", "", "", "", "", "", "AS PER GSTR-2B", "", "", "", "", "", "", "", "", ""];
  const head = ["Status", "Supplier", "GSTIN", "Invoice no", "Date", "Taxable", "IGST", "CGST", "SGST", "Cess", "ITC", "Invoice no", "Date", "Taxable", "IGST", "CGST", "SGST", "Cess", "ITC", "Difference in ITC (2B less books)", "What differs"];
  top.forEach((h, c) => { ws[A(c, 0)] = s(h); }); head.forEach((h, c) => { ws[A(c, 1)] = s(h); });
  const col = (i) => X.utils.encode_col(i);
  rows.forEach((r, i) => {
    const y = i + 2, Rn = y + 1, b = r.books, t = r.twoB;
    ws[A(0, y)] = s(STATUS[r.status] + (r.kind ? " (" + r.kind + ")" : "") + (r.auto ? " · " + AUTO[r.auto.status] : ""));
    ws[A(1, y)] = s(r.party); ws[A(2, y)] = s(r.gstin);
    if (b) { ws[A(3, y)] = s(b.no); ws[A(4, y)] = s(d(b.date)); ["taxable", "igst", "cgst", "sgst", "cess"].forEach((k, j) => { ws[A(5 + j, y)] = n(b[k]); });
      ws[A(10, y)] = b.counted ? f("SUM(G" + Rn + ":J" + Rn + ")", r.itcBooks) : n(r.itcBooks); }
    if (t) { ws[A(11, y)] = s(t.no); ws[A(12, y)] = s(d(t.date)); ["taxable", "igst", "cgst", "sgst", "cess"].forEach((k, j) => { ws[A(13 + j, y)] = n(t[k]); });
      ws[A(18, y)] = t.counted && !t.notAvl ? f("SUM(O" + Rn + ":R" + Rn + ")", r.itc2b) : n(r.itc2b); }
    ws[A(19, y)] = f("S" + Rn + "-K" + Rn, r.gap);
    ws[A(20, y)] = s([r.diffs.map((k) => DIFF_WORD[k]).join(", "), t && t.notAvl ? "ITC not available in 2B" : "", t && !t.counted ? "2B of another month, not counted" : "", b && !b.counted ? "booked in another month, not counted" : "", r.tag].filter(Boolean).join("; "));
  });
  const T = rows.length + 2, last = rows.length + 2;
  ws[A(1, T)] = s("Total: " + rows.length + " invoices");
  [5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19].forEach((c) => { const v = rows.reduce((a, r) => a + (c === 10 ? r.itcBooks : c === 18 ? r.itc2b : c === 19 ? r.gap : c < 11 ? N((r.books || {})[["taxable", "igst", "cgst", "sgst", "cess"][c - 5]]) : N((r.twoB || {})[["taxable", "igst", "cgst", "sgst", "cess"][c - 13]])), 0);
    ws[A(c, T)] = f("SUM(" + col(c) + "3:" + col(c) + last + ")", v); });
  ws["!ref"] = X.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 20, r: T } });
  ws["!cols"] = [18, 30, 17, 16, 11, 13, 11, 11, 11, 9, 12, 16, 11, 13, 11, 11, 11, 9, 12, 14, 40].map((w) => ({ wch: w }));
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, "2B reconciliation");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return saveFile(String(title).replace(/[^A-Za-z0-9]+/g, "-") + ".xlsx", new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

if (typeof window !== "undefined") window.GSTReco = Object.assign(window.GSTReco || {}, { STATUS, AUTO, recoRows, applyAuto, autoFor, recoCounts, recoTotals, diffsOf, recoExcel });
