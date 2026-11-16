// next-ui-table-filters (the owner, 16-Nov-2026: "there has to be filters in the column sections"): the Excel-style
// filter on each column heading of the one list table (ListTable.jsx). The filtering itself lives here, in the first
// file, so a list is filtered on ALL its rows before it is sorted and cut short (limit); the box that sets a filter
// (ColFilterPop.jsx) is loaded only when a funnel is first pressed.
//   kind "date": from / to (yyyy-mm-dd; a timestamp by its day); "num": from / to; "text": words, and a tick list of
//   the values when a column has few of them (state, voucher type, status, computer), each with its count.
// The filters are kept per list in S.listF[name] = {k: {q, sel, min, max, from, to}} while the page is open;
// S.listFPop = {name, k} is the box open.
import { textOf } from "./ListTable.jsx";

const blank = (v) => v === null || v === undefined || v === "" || (typeof v === "number" && isNaN(v));
export const LIST_FEW = 30;

// a column that gets a funnel: a heading in words, not the tick box, the S. no. or the buttons, and no filter of its own
export const filterable = (c) => !!c && typeof c.label === "string" && !!c.label.trim() && c.head === undefined && !c.filter && c.colFilter !== false && !["pick", "row", "act"].includes(c.role);

export const listF = (name) => (S.listF && S.listF[name]) || {};
export const fActive = (f) => !!f && (!!(f.sel && f.sel.length) || !!String(f.q || "").trim() || !!f.from || !!f.to || (f.min !== undefined && f.min !== "") || (f.max !== undefined && f.max !== ""));
export const anyOn = (name) => Object.values(listF(name)).some(fActive);

// what a cell says (for the words and the tick list) and the value it is filtered by
export function cellText(c, r, p, i) {
  let t = "";
  try { t = textOf(c.cell(r, p, i)); } catch (e) { t = ""; }
  return String(t || "").replace(/\s+/g, " ").trim();
}
// the value ticked in the list: the column's own (fv), else its sort value when that is words, else what the cell says
export function pickVal(c, r, p, i) {
  if (c.fv) { const v = c.fv(r); return blank(v) ? "" : String(v); }
  const v = c.v ? c.v(r) : undefined;
  if (typeof v === "string" && v.trim()) return v.trim();
  return cellText(c, r, p, i);
}
const ISO = /^\d{4}-\d{2}-\d{2}/;
export function kindOf(c, rows) {
  if (c.fkind) return c.fkind;
  if (c.role === "date") return "date";
  if (c.role === "amount") return "num";
  if (!c.v) return "text";
  let n = 0, nums = 0, dates = 0;
  for (const r of rows.slice(0, 300)) { const v = c.v(r); if (blank(v)) continue; n++; if (typeof v === "number") nums++; else if (ISO.test(String(v))) dates++; }
  return n && nums === n ? "num" : n && dates === n ? "date" : "text";
}

// the rows a list's filters let through, with its funnel columns
export function filterRows(name, cols, rows, prep) {
  const f = listF(name), on = cols.filter((c) => filterable(c) && fActive(f[c.k]));
  if (!on.length) return rows;
  const kinds = {};
  on.forEach((c) => { kinds[c.k] = kindOf(c, rows); });
  return rows.filter((r, i) => {
    const p = prep ? prep(r) : undefined;
    return on.every((c) => {
      const x = f[c.k], kind = kinds[c.k];
      if (x.sel && x.sel.length && !x.sel.includes(pickVal(c, r, p, i))) return false;
      if (kind === "date" && (x.from || x.to)) { const d = String((c.v && c.v(r)) || "").slice(0, 10); if (!ISO.test(d) || (x.from && d < x.from) || (x.to && d > x.to)) return false; }
      if (kind === "num" && ((x.min !== undefined && x.min !== "") || (x.max !== undefined && x.max !== ""))) {
        const v = c.v ? c.v(r) : NaN, n = typeof v === "number" ? v : Number(String(v).replace(/[₹,\s]/g, ""));
        if (isNaN(n)) return false;
        if (x.min !== undefined && x.min !== "" && n < Number(x.min)) return false;
        if (x.max !== undefined && x.max !== "" && n > Number(x.max)) return false;
      }
      const q = String(x.q || "").trim().toLowerCase();
      if (q) { const hay = (cellText(c, r, p, i) + " " + (c.v ? String(c.v(r) ?? "") : "")).toLowerCase(); if (!q.split(",").map((w) => w.trim()).filter(Boolean).some((w) => hay.includes(w))) return false; }
      return true;
    });
  });
}

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
