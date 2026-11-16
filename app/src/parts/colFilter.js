// next-ui-table-filters (the owner, 16-Nov-2026: "there has to be filters in the column sections"): the Excel-style
// filter on each column heading of the one list table (ListTable.jsx). The filtering itself lives here, in the first
// file, so a list is filtered on ALL its rows before it is sorted and cut short (limit); the box that sets a filter
// (ColFilterPop.jsx) is loaded only when a funnel is first pressed.
//   kind "date": from / to (yyyy-mm-dd, yyyymmdd, dd-Mon-yyyy, dd/mm/yyyy, a timestamp by its IST day); "num": from / to
//   (1,25,000.00, ₹, Dr / Cr); "text": words, and a tick list of the values when a column has few of them (state,
//   voucher type, status, computer), each with its count. A value that cannot be read as a date or an amount is never
//   hidden by a range.
// The filters are kept per list in S.listF[name] = {k: {q, sel, min, max, from, to}} while the page is open;
// S.listFPop = {name, k} is the box open. Each list drawn says what it holds (REG), so the pages' own actions (Select
// all, Post, bulk actions) can keep to the rows the filters show: window.listShows(name, key), listPass(name, row).
import { textOf } from "./ListTable.jsx";

const blank = (v) => v === null || v === undefined || v === "" || (typeof v === "number" && isNaN(v));
export const LIST_FEW = 30;

// a column that gets a funnel: a heading in words, not the tick box, the S. no. or the buttons, and no filter of its own
export const filterable = (c) => !!c && typeof c.label === "string" && !!c.label.trim() && c.head === undefined && !c.filter && c.colFilter !== false && !["pick", "row", "act"].includes(c.role);

export const listF = (name) => (S.listF && S.listF[name]) || {};
export const fActive = (f) => !!f && (!!(f.sel && f.sel.length) || !!String(f.q || "").trim() || !!f.from || !!f.to || (f.min !== undefined && f.min !== "") || (f.max !== undefined && f.max !== ""));
export const anyOn = (name) => Object.values(listF(name)).some(fActive);

// ---- amounts and dates as people write them ----
// "1,25,000.50", "₹ 1,250", "1,250.00 Dr", "500 Cr" (Cr counts below nil, as ListTable's sums read it), "(250)"; NaN when not one
export function amt(v) {
  if (typeof v === "number") return v;
  let s = String(v == null ? "" : v).replace(/[₹,\s]/g, "").replace(/^Rs\.?/i, "");
  if (!s) return NaN;
  let sign = 1;
  const m = s.match(/^(.*?)(Dr|Cr)$/i); if (m) { s = m[1]; if (/cr/i.test(m[2])) sign = -1; }
  if (/^\(.*\)$/.test(s)) { s = s.slice(1, -1); sign = -sign; }
  s = s.replace(/^[−–]/, "-");
  return /^-?\d+(\.\d+)?$/.test(s) ? sign * Number(s) : NaN;
}
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n) => String(n).padStart(2, "0");
const okDay = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 ? y + "-" + p2(m) + "-" + p2(d) : "";
// a date to yyyy-mm-dd ("" when it is not one); a timestamp by its day in India (IST, +5:30)
export function day(v) {
  const s = String(v == null ? "" : v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/))) {
    if (m[4] !== undefined && /[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) { const t = Date.parse(s); if (!isNaN(t)) { const d = new Date(t + 5.5 * 3600e3); return d.toISOString().slice(0, 10); } }
    return okDay(m[1], +m[2], +m[3]);
  }
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return okDay(m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[\s\-\/.]+([A-Za-z]{3,4})[\s\-\/.,]+(\d{4})\b/))) return MON[m[2].toLowerCase()] ? okDay(m[3], MON[m[2].toLowerCase()], +m[1]) : "";
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/))) return okDay(m[3], +m[2], +m[1]);
  return "";
}
const bound = (x) => (x === undefined || x === "" ? NaN : amt(x));

// what a cell says (for the words and the tick list) and the value it is filtered by; one filtering reads each cell once
function textCache() { const m = new Map(); return (c, r, p, i) => { const k = c.k; let per = m.get(r); if (!per) m.set(r, per = {}); if (!(k in per)) per[k] = cellText(c, r, p, i); return per[k]; }; }
export function cellText(c, r, p, i) {
  let t = "";
  try { t = textOf(c.cell(r, p, i)); } catch (e) { t = ""; }
  return String(t || "").replace(/\s+/g, " ").trim();
}
// the value ticked in the list: the column's own (fv), else its sort value when that is words, else what the cell says
export function pickVal(c, r, p, i, txt) {
  if (c.fv) { const v = c.fv(r); return blank(v) ? "" : String(v); }
  const v = c.v ? c.v(r) : undefined;
  if (typeof v === "string" && v.trim()) return v.trim();
  return txt ? txt(c, r, p, i) : cellText(c, r, p, i);
}
export function kindOf(c, rows) {
  if (c.fkind) return c.fkind;
  if (c.role === "date") return "date";
  if (c.role === "amount") return "num";
  if (!c.v) return "text";
  let n = 0, nums = 0, dates = 0;
  for (const r of rows.slice(0, 300)) { const v = c.v(r); if (blank(v)) continue; n++; if (typeof v === "number") nums++; else if (day(v)) dates++; }
  return n && nums === n ? "num" : n && dates === n ? "date" : "text";
}
const dateOf = (c, r) => day(c.v ? c.v(r) : "");

// the rows a list's filters let through, with its funnel columns
export function filterRows(name, cols, rows, prep) {
  const f = listF(name), on = cols.filter((c) => filterable(c) && fActive(f[c.k]));
  if (!on.length) return rows;
  const kinds = {}, txt = textCache();
  on.forEach((c) => { kinds[c.k] = kindOf(c, rows); });
  return rows.filter((r, i) => {
    let p, pd = false;
    const P = () => { if (!pd) { p = prep ? prep(r) : undefined; pd = true; } return p; };
    return on.every((c) => {
      const x = f[c.k], kind = kinds[c.k];
      if (x.sel && x.sel.length && !x.sel.includes(pickVal(c, r, P(), i, txt))) return false;
      if (kind === "date" && (x.from || x.to)) {
        const d = dateOf(c, r);
        if (d && ((x.from && d < x.from) || (x.to && d > x.to))) return false;   // a date not read: never hidden by a range
      }
      if (kind === "num") {
        const lo = bound(x.min), hi = bound(x.max);
        if (!isNaN(lo) || !isNaN(hi)) {
          const n = amt(c.v ? c.v(r) : txt(c, r, P(), i));
          if (!isNaN(n) && ((!isNaN(lo) && n < lo) || (!isNaN(hi) && n > hi))) return false;   // an amount not read: kept
        }
      }
      const q = String(x.q || "").trim().toLowerCase();
      if (q) { const hay = (txt(c, r, P(), i) + " " + (c.v ? String(c.v(r) ?? "") : "")).toLowerCase(); if (!q.split(",").map((w) => w.trim()).filter(Boolean).some((w) => hay.includes(w))) return false; }
      return true;
    });
  });
}

// ---- each list as last drawn: its columns, all its rows, its key ----
const REG = {};
export function register(name, cs, rows, prep, rowKey) { REG[name] = { cs, rows, prep, rowKey }; }
const keyOf = (g, r, i) => (g.rowKey ? g.rowKey(r, i) : i);
// the keys of the rows the column filters show, or null when no column filter is on (every row shows)
// worked out once per drawing and filter (re-review of fdeb79bd8: Select all on 50,000 rows asked it per row), so a page's
// action looks each row up in one Set
export function listShownKeys(name) {
  const g = REG[name], f = S.listF && S.listF[name];
  if (!g || !anyOn(name)) return null;
  if (g.memo && g.memo.f === f) return g.memo.set;
  const idx = new Map(g.rows.map((r, i) => [r, i]));
  const set = new Set(filterRows(name, g.cs, g.rows, g.prep).map((r) => keyOf(g, r, idx.get(r))));
  g.memo = { f, set };
  return set;
}
export function listShows(name, key) { const s = listShownKeys(name); return !s || s.has(key); }
// one row (on this tab or not) against the list's column filters
export function listPass(name, row) { const g = REG[name]; return !g || !anyOn(name) || filterRows(name, g.cs, [row], g.prep).length === 1; }
// the ticked rows a filter now hides are unticked, so a bulk action (approve, delete, ledger, post) never reaches them
export function pruneSel(name, sel) {
  const g = REG[name], shown = listShownKeys(name);
  if (!g || !shown || !sel || !sel.size) return false;
  let out = false;
  g.rows.forEach((r, i) => { const k = keyOf(g, r, i); if (sel.has(k) && !shown.has(k)) { sel.delete(k); out = true; } });
  return out;
}
if (typeof window !== "undefined") Object.assign(window, { listShows, listShownSet: listShownKeys, listPass, listFOn: anyOn, listFParse: { amt, day } });

export function setListF(name, k, patch) {
  S.listF = S.listF || {};
  const all = S.listF[name] = { ...(S.listF[name] || {}) };
  const x = { ...(all[k] || {}), ...patch };
  if (fActive(x)) all[k] = x; else delete all[k];
  render();
}
export function clearListF(name) { if (S.listF) delete S.listF[name]; if (S.listFPop && S.listFPop.name === name) S.listFPop = null; render(); }
export function openListF(name, k) {
  S.listFPop = S.listFPop && S.listFPop.name === name && S.listFPop.k === k ? null : { name, k };
  render();
}
