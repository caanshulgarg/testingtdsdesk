// The server half of the console's DataTable: one shape of search, filters, sort and paging for every list action.
// Plain module, no imports beyond types. The browser sends (all optional):
//   { q: "text", filters: { <col>: Filter }, sort: { col, dir: "asc"|"desc" }, page: 0, size: 25, export: "csv" }
// Filter by the column's type (ListSpec.columns):
//   text    {op:"contains", value}                 case-insensitive
//   select  {op:"in", values:[...]}                one or several values
//   date    {op:"range", from:"YYYY-MM-DD", to:"YYYY-MM-DD"}   India days, both ends included
//   number  {op:"range", from: n, to: n}           both ends included
//   bool    {op:"is", value: true|false}
// A column not in the spec, or an operator that does not fit its type, is refused (400). The action's run() returns
// the candidate rows (it may push q or a date range down to SQL to keep them few); apply() then filters, sorts and
// pages here, on the server. export: every filtered row (up to EXPORT_MAX) as CSV, audited as "<action>.export".
import { type ColType, ConsoleError, type Filter, type ListQuery, type ListSpec } from "./types.ts";

export const PAGE_MAX = 100;
export const EXPORT_MAX = 5000;
const OPS: Record<ColType, string> = { text: "contains", select: "in", date: "range", number: "range", bool: "is" };
const bad = (m: string) => new ConsoleError(400, m, "bad_query");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseQuery(p: any, spec: ListSpec): ListQuery {
  p = p || {};
  const q = typeof p.q === "string" ? p.q.trim().slice(0, 200) : "";
  const filters: Record<string, Filter> = {};
  const raw = p.filters && typeof p.filters === "object" ? p.filters : {};
  if (Object.keys(raw).length > 20) throw bad("Too many filters.");
  for (const [col, f] of Object.entries<any>(raw)) {
    const t = spec.columns[col];
    if (!t) throw bad(`There is no filter "${col}" on this list.`);
    if (!f || f.op !== OPS[t]) throw bad(`The filter on "${col}" does not fit its type.`);
    if (t === "text") {
      if (typeof f.value !== "string" || f.value.length > 200) throw bad(`The filter on "${col}" needs some text.`);
      if (f.value.trim()) filters[col] = { op: "contains", value: f.value.trim() };
    } else if (t === "select") {
      if (!Array.isArray(f.values) || f.values.length > 50 || f.values.some((v: unknown) => typeof v !== "string" || v.length > 200)) throw bad(`The filter on "${col}" needs a list of values.`);
      if (f.values.length) filters[col] = { op: "in", values: f.values };
    } else if (t === "bool") {
      if (typeof f.value !== "boolean") throw bad(`The filter on "${col}" needs yes or no.`);
      filters[col] = { op: "is", value: f.value };
    } else {
      const ok = (v: unknown) => v === undefined || v === null || v === "" || (t === "date" ? typeof v === "string" && DAY.test(v) : typeof v === "number" && isFinite(v));
      if (!ok(f.from) || !ok(f.to)) throw bad(`The filter on "${col}" needs ${t === "date" ? "dates (YYYY-MM-DD)" : "numbers"}.`);
      const from = f.from === "" ? null : f.from ?? null, to = f.to === "" ? null : f.to ?? null;
      if (from !== null || to !== null) filters[col] = { op: "range", from, to };
    }
  }
  let sort = spec.defaultSort;
  if (p.sort) {
    if (!spec.columns[p.sort.col] || !["asc", "desc"].includes(p.sort.dir)) throw bad("That list cannot be sorted that way.");
    sort = { col: p.sort.col, dir: p.sort.dir };
  }
  const page = Number.isInteger(p.page) && p.page >= 0 && p.page < 100000 ? p.page : 0;
  const size = Number.isInteger(p.size) && p.size >= 1 ? Math.min(p.size, PAGE_MAX) : 25;
  return { q, filters, sort, page, size, export: p.export === "csv" };
}

const dayStart = (d: string) => Date.parse(d + "T00:00:00+05:30");
function match(v: unknown, f: Filter, t: ColType): boolean {
  if (f.op === "contains") return String(v ?? "").toLowerCase().includes(f.value.toLowerCase());
  if (f.op === "in") return f.values.includes(String(v ?? ""));
  if (f.op === "is") return !!v === f.value;
  if (v === null || v === undefined || v === "") return false;
  if (t === "date") {
    const x = Date.parse(String(v));
    if (isNaN(x)) return false;
    if (f.from && x < dayStart(String(f.from))) return false;
    if (f.to && x >= dayStart(String(f.to)) + 86400000) return false;
    return true;
  }
  const n = Number(v);
  if (f.from !== null && f.from !== undefined && n < Number(f.from)) return false;
  if (f.to !== null && f.to !== undefined && n > Number(f.to)) return false;
  return true;
}
function cmp(a: unknown, b: unknown, t: ColType): number {
  const na = a === null || a === undefined || a === "", nb = b === null || b === undefined || b === "";
  if (na || nb) return na && nb ? 0 : na ? 1 : -1;          // blanks last
  if (t === "number") return Number(a) - Number(b);
  if (t === "date") return Date.parse(String(a)) - Date.parse(String(b));
  if (t === "bool") return Number(!!a) - Number(!!b);
  return String(a).localeCompare(String(b), "en", { sensitivity: "base" });
}

export function applyQuery<T extends Record<string, unknown>>(rows: T[], q: ListQuery, spec: ListSpec): { total: number; rows: T[] } {
  let out = rows;
  if (q.q) {
    const s = q.q.toLowerCase();
    out = out.filter((r) => spec.search.some((c) => String(r[c] ?? "").toLowerCase().includes(s)));
  }
  for (const [col, f] of Object.entries(q.filters)) out = out.filter((r) => match(r[col], f, spec.columns[col]));
  const t = spec.columns[q.sort.col], dir = q.sort.dir === "asc" ? 1 : -1;
  // blanks stay last whichever way the sort goes
  out = [...out].sort((a, b) => {
    const av = a[q.sort.col], bv = b[q.sort.col];
    const na = av === null || av === undefined || av === "", nb = bv === null || bv === undefined || bv === "";
    if (na || nb) return na && nb ? 0 : na ? 1 : -1;
    return cmp(av, bv, t) * dir;
  });
  const total = out.length;
  if (q.export) return { total, rows: out.slice(0, EXPORT_MAX) };
  return { total, rows: out.slice(q.page * q.size, q.page * q.size + q.size) };
}

// CSV (RFC 4180), with a cell that a spreadsheet would read as a formula made plain text (a leading ')
export function toCsv(rows: Record<string, unknown>[], cols: string[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}
