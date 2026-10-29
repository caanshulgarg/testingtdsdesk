// The Financial statements page's small helpers: the page's state (S.fin), the figures in the chosen unit, and the
// worked-out statements kept between drawings (FinSt.build is not cheap: it reads the balances of two years).
import "../../../lib/finGlobals.js";

export const UNITS = [[1, "Rupees"], [1000, "Thousands"], [100000, "Lakhs"], [10000000, "Crores"]];

// the page's own state: tab, note in view, the trial balance's filter, search, ticks, the code list open, an edit
const BASE = { tab: "bs", note: "", tbF: null, q: "", src: "", sel: {}, edit: "" };
export function st() { const f = S.fin; if (!f || Object.keys(BASE).some((k) => f[k] === undefined)) S.fin = Object.assign({}, BASE, f || {}, { sel: (f && f.sel) || {} }); return S.fin; }
export function setFin(patch) { Object.assign(st(), patch); render(); }

const fmts = {};
const fmtOf = (dec) => fmts[dec] || (fmts[dec] = new Intl.NumberFormat("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
// a statement's figure: Indian grouping, the chosen decimals, a minus in brackets, nil as a dash; null (no figure) blank
export function fig(v, dec) {
  if (v == null || v === "") return "";
  const n = +v || 0, z = Math.abs(n) < 0.5 * Math.pow(10, -dec);
  if (z) return "-";
  const t = fmtOf(dec).format(Math.abs(n));
  return n < 0 ? "(" + t + ")" : t;
}
// rupees with two decimals (the trial balance, the computation)
export const rs = (v) => fig(v, 2);
export const inr = (v) => "₹" + fmtOf(2).format(+v || 0);
export const dmy = (ymd) => fmtDate(tallyDate(ymd));
export const fyEnd = (fy) => String(+fy + 1) + "0331";

// the statements for a year in a unit, worked out once for each state of the books and of what the page keeps (b.fs)
let memo = { key: "", d: null };
export function built(b, fy, unit, dec, period) {
  const co = typeof CO === "function" ? CO() : null, firm = S.firm || {};
  // the reports' answers (b.fs.reports, ROUND 100) do not change the statements
  let fsTxt = ""; try { fsTxt = JSON.stringify(Object.assign({}, b.fs, { reports: undefined })); } catch (e) { fsTxt = String(Date.now()); }
  const key = [b.cid, fy, unit, dec, period ? period.from + "-" + period.to : "", (b.vouchers || []).length, (b.tb || {}).at || "", (b.tb || {}).from || "", Object.keys(b.under || {}).length, Object.keys(b.msme || {}).length, fsTxt,
    co ? [co.name, co.pan, co.cin, co.entity, co.address].join("|") : "", [firm.firmName, firm.frn, firm.partner, firm.mno].join("|")].join("\u0001");
  if (memo.key === key && memo.d) return memo.d;
  let d;
  try { d = FinSt.build(fy, { unit, dec, period }); } catch (e) { d = { error: String((e && e.message) || e), fy }; if (typeof console === "object") console.error(e); }
  memo = { key, d };
  return d;
}
export function forget() { memo = { key: "", d: null }; }

// the codes of the catalogue for this kind, by note (for the code list): [[note title, [[code, label]]]]
export function codeGroups(kind) {
  const K = FinSt.codes(kind), out = [], seen = {};
  FinSt.NOTES.forEach((n) => {
    if (n.only && n.only !== kind) return;
    const list = [];
    n.groups.forEach(([, , , cs]) => cs.forEach(([c]) => { if (K[c] && !K[c].sys) list.push([c, K[c].label]); }));
    if (n.key === "8" || n.key === "34") Object.values(K).filter((c) => c.note === n.key && c.ppe).forEach((c) => list.push([c.code, c.label]));
    if (n.key === "8") list.push(["8E", K["8E"].label]);
    if (n.key === "34") list.push(["34D", K["34D"].label]);
    if (!list.length) return;
    const t = n.title; if (seen[t]) seen[t].push(...list); else { seen[t] = list; out.push([t, list]); }
  });
  return out;
}
