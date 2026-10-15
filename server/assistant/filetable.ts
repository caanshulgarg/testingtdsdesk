// A table from the user's own sheet, for a file FinCom makes (the owner, 15-Oct-2026: "can you pls make this presentable. i
// need to present it to investor" on an uploaded MIS was refused, because a file's table could only come from a book tool).
// The rule stays the one of every figure in FinCom Assistant: the AI never writes a figure. Here:
//   - FinCom reads the sheet itself (the bytes from the firm's storage: xlsx with ExcelJS, csv; else the text FinCom took
//     out of it on the page) and shows it to the model with row numbers and column letters (masked like any attachment);
//   - the model says only WHICH cells (file, sheet, heading row, columns and rows, group headings, a sum it wants) and the
//     words (column headings, group headings);
//   - FinCom copies the cells, unchanged and unmasked, into the table; a sum is FinCom's, of the copied cells;
//   - every figure the model writes in the file's text must be one of those cells (fileFigures checks it in code).
// The file says under the table: "Figures as in your file <name>; not checked against the books."
import ExcelJS from "npm:exceljs@4.4.0";
import type { Col, TableData } from "./files.ts";
import { figuresIn } from "./checks.ts";

export type Cell = string | number | null;
export type Grid = { name: string, rows: Cell[][], pct: Set<string> };     // pct: "r:c" (0-based) cells that are percentages
export type SheetFile = { n: number, name: string, sheets: Grid[] };

const MAX_ROWS = 2000, MAX_COLS = 60;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
export const colLetter = (i: number): string => { let s = "", n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
export const colIndex = (s: string): number => { const t = String(s || "").trim().toUpperCase(); if (!/^[A-Z]{1,2}$/.test(t)) return -1; let n = 0; for (const ch of t) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateText = (d: Date) => (d.getUTCDate() === 1 ? "" : String(d.getUTCDate()).padStart(2, "0") + "-") + MON[d.getUTCMonth()] + "-" + d.getUTCFullYear();

// a written number as a sheet shows it: 1,23,450.00 / (1,234) / -5 / ₹ 12,000 / 12.5% ; anything else is text
export function parseNum(s0: string): { v: number, pct: boolean } | null {
  let s = String(s0 ?? "").trim();
  if (!s || s.length > 30) return null;
  const pct = /%$/.test(s); if (pct) s = s.slice(0, -1).trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/^(₹|Rs\.?|INR)\s*/i, "");
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1).trim(); }
  if (!/^(\d{1,3}(,\d{2,3})+|\d+)(\.\d+)?$/.test(s)) return null;
  const v = Number(s.replace(/,/g, ""));
  return isFinite(v) ? { v: neg ? -v : v, pct } : null;
}

function gridOf(name: string, lines: string[][]): Grid {
  const pct = new Set<string>();
  const rows = lines.slice(0, MAX_ROWS).map((r, ri) => r.slice(0, MAX_COLS).map((x, ci) => {
    const t = String(x ?? "").trim();
    if (!t) return null;
    const n = parseNum(t);
    if (!n) return t;
    if (n.pct) pct.add(ri + ":" + ci);
    return n.v;
  }));
  return { name, rows, pct };
}
// the text FinCom took out of a sheet on the page: rows on lines, cells by tabs, sheets apart by a blank line
export function gridsFromText(text: string): Grid[] {
  const blocks = String(text || "").replace(/\r/g, "").split(/\n[ \t]*\n/).map((b) => b.split("\n")).filter((b) => b.some((l) => l.trim()));
  return blocks.map((b, i) => gridOf("Sheet " + (i + 1), b.map((l) => l.split("\t"))));
}
// a CSV file (quotes as Excel writes them)
export function gridsFromCsv(text: string): Grid[] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cur); cur = ""; } else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; } else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return [gridOf("Sheet 1", rows)];
}
// an xlsx file, every sheet: values as Excel holds them (a formula's result; a percentage as the percent shown)
export async function gridsFromXlsx(bytes: Uint8Array): Promise<Grid[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as any);
  const out: Grid[] = [];
  for (const ws of wb.worksheets) {
    if ((ws as any).state && (ws as any).state !== "visible") continue;
    const rows: Cell[][] = [], pct = new Set<string>();
    const last = Math.min(ws.rowCount, MAX_ROWS), cols = Math.min(ws.columnCount, MAX_COLS);
    for (let r = 1; r <= last; r++) {
      const row = ws.getRow(r), cells: Cell[] = [];
      for (let c = 1; c <= cols; c++) {
        const cell = row.getCell(c);
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) { cells.push(null); continue; }
        let v: any = cell.value;
        if (v && typeof v === "object" && !(v instanceof Date)) v = "result" in v ? v.result : "richText" in v ? (v.richText || []).map((x: any) => x.text).join("") : "text" in v ? v.text : "error" in v ? null : null;
        if (v instanceof Date) { cells.push(dateText(v)); continue; }
        if (typeof v === "number") {
          if (isFinite(v) && /%/.test(String(cell.numFmt || ""))) { pct.add((r - 1) + ":" + (c - 1)); cells.push(round(v * 100, 4)); }
          else cells.push(isFinite(v) ? v : null);
          continue;
        }
        if (typeof v === "boolean") { cells.push(String(v)); continue; }
        const t = v == null ? "" : String(v).trim();
        const n = t ? parseNum(t) : null;
        if (n) { if (n.pct) pct.add((r - 1) + ":" + (c - 1)); cells.push(n.v); } else cells.push(t || null);
      }
      rows.push(cells);
    }
    while (rows.length && rows[rows.length - 1].every((x) => x == null)) rows.pop();
    if (rows.length) out.push({ name: ws.name, rows, pct });
  }
  return out;
}
// the attached file as FinCom reads it: the bytes first (xlsx, csv), else the page's text
export async function readSheetFile(n: number, name: string, type: string, bytes: Uint8Array | null, pageText: string): Promise<SheetFile | null> {
  let sheets: Grid[] = [];
  const zip = !!bytes && bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  try {
    if (zip && /\.(xlsx|xlsm)$/i.test(name) || zip && /spreadsheetml/.test(type)) sheets = await gridsFromXlsx(bytes as Uint8Array);
    else if (bytes && (/\.csv$/i.test(name) || /text\/csv/.test(type))) sheets = gridsFromCsv(new TextDecoder().decode(bytes));
  } catch { sheets = []; }
  if (!sheets.length && pageText.trim()) sheets = gridsFromText(pageText);
  return sheets.length ? { n, name, sheets } : null;
}
export const isSheetName = (name: string, type: string) => /\.(xlsx|xlsm|xls|csv)$/i.test(name) || /spreadsheet|ms-excel|text\/csv/.test(type);

// the file as the model reads it: each sheet with row numbers and column letters (the attachment is masked after this)
export function renderSheetFile(f: SheetFile, max = 20000): string {
  const out: string[] = [];
  let len = 0;
  for (const g of f.sheets) {
    const width = Math.max(0, ...g.rows.map((r) => { let k = r.length; while (k > 0 && r[k - 1] == null) k--; return k; }));
    const head = "[File " + f.n + ": " + f.name + " - sheet \"" + g.name + "\" - row numbers on the left, column letters on top; use them in table_from_file]\n#\t" + Array.from({ length: width }, (_x, i) => colLetter(i)).join("\t");
    out.push(head); len += head.length;
    for (let r = 0; r < g.rows.length; r++) {
      const row = g.rows[r];
      if (row.every((x) => x == null)) continue;
      const line = (r + 1) + "\t" + row.slice(0, width).map((v, c) => v == null ? "" : typeof v === "number" ? String(v) + (g.pct.has(r + ":" + c) ? "%" : "") : String(v).replace(/\s+/g, " ").slice(0, 80)).join("\t");
      if (len + line.length > max) { out.push("[rows after " + r + " of this sheet are not shown to you; they are in the file]"); return out.join("\n"); }
      out.push(line); len += line.length + 1;
    }
    out.push("");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- the table the model asks for
export type FileTableSpec = {
  file?: number | string | null, sheet?: string | number | null, header_row?: number | null,
  columns?: { col: string, heading?: string | null }[],
  rows?: (number | string)[] | null,
  groups?: { heading: string, rows: (number | string)[] }[] | null,
  sum?: { label?: string | null, columns: string[] } | null,
};
const rowList = (xs: unknown[], last: number): number[] | string => {
  const out: number[] = [];
  for (const x of xs || []) {
    const m = String(x).trim().match(/^(\d+)\s*(?:[-–:]|to)\s*(\d+)$/);
    if (m) { const a = Number(m[1]), b = Number(m[2]); if (a < 1 || b < a || b > last) return "rows " + x + " are not in the sheet (it has " + last + " rows)"; for (let i = a; i <= b; i++) out.push(i); continue; }
    const n = Number(x);
    if (!Number.isInteger(n) || n < 1 || n > last) return "row " + x + " is not in the sheet (it has " + last + " rows)";
    out.push(n);
  }
  return out;
};
const TOTAL_WORD = /\b(total|sub-?total|grand total|net (profit|loss|total)|ebitda|pat|pbt)\b/i;

export function tableFromFile(files: SheetFile[], spec: FileTableSpec): { table: TableData, numbers: number[], file: string } | { error: string } {
  if (!files.length) return { error: "no sheet is attached in this chat: ask the user to attach the file with Upload" };
  const f = spec.file == null || spec.file === "" ? files[0] : typeof spec.file === "number" || /^\d+$/.test(String(spec.file)) ? files.find((x) => x.n === Number(spec.file)) : files.find((x) => x.name.toLowerCase() === String(spec.file).toLowerCase());
  if (!f) return { error: "no attached file " + spec.file + "; the files are: " + files.map((x) => x.n + " " + x.name).join("; ") };
  const g = spec.sheet == null || spec.sheet === "" ? f.sheets[0] : typeof spec.sheet === "number" || /^\d+$/.test(String(spec.sheet)) ? f.sheets[Number(spec.sheet) - 1] : f.sheets.find((s) => s.name.toLowerCase() === String(spec.sheet).trim().toLowerCase());
  if (!g) return { error: "no sheet " + spec.sheet + " in " + f.name + "; its sheets are: " + f.sheets.map((s) => s.name).join("; ") };
  const last = g.rows.length;
  const hr = spec.header_row == null ? 0 : Number(spec.header_row);
  if (!Number.isInteger(hr) || hr < 0 || hr > last) return { error: "header_row " + spec.header_row + " is not in the sheet" };
  const headCells = hr ? g.rows[hr - 1] : [];
  const cols = Array.isArray(spec.columns) ? spec.columns.slice(0, 20) : [];
  if (!cols.length) return { error: "give the columns to copy (column letters as shown, e.g. {\"col\":\"A\"})" };
  const picked: { i: number, label: string }[] = [];
  for (const c of cols) {
    let i = colIndex(String(c?.col ?? ""));
    if (i < 0 && hr) i = headCells.findIndex((h) => h != null && String(h).trim().toLowerCase() === String(c?.col ?? "").trim().toLowerCase());
    if (i < 0 || i >= MAX_COLS) return { error: "column " + c?.col + " is not in the sheet: use its letter as shown" };
    const own = hr && headCells[i] != null ? String(headCells[i]) : "";
    picked.push({ i, label: String(c?.heading || own || colLetter(i)).slice(0, 80) });
  }
  // the rows: groups (a heading over its rows), or rows, or everything under the heading row
  type Part = { heading: string | null, rows: number[] };
  const parts: Part[] = [];
  if (Array.isArray(spec.groups) && spec.groups.length) {
    for (const gr of spec.groups.slice(0, 30)) { const rs = rowList(gr?.rows || [], last); if (typeof rs === "string") return { error: rs }; parts.push({ heading: String(gr?.heading || "").slice(0, 120) || null, rows: rs }); }
  } else if (Array.isArray(spec.rows) && spec.rows.length) {
    const rs = rowList(spec.rows, last); if (typeof rs === "string") return { error: rs }; parts.push({ heading: null, rows: rs });
  } else parts.push({ heading: null, rows: Array.from({ length: last - hr }, (_x, k) => hr + 1 + k) });
  const columns: Col[] = picked.map((p, k) => {
    let nums = 0, pcts = 0, texts = 0;
    for (const part of parts) for (const r of part.rows) { const v = g.rows[r - 1]?.[p.i]; if (typeof v === "number") { nums++; if (g.pct.has((r - 1) + ":" + p.i)) pcts++; } else if (v != null) texts++; }
    return { k: "c" + k, label: p.label, t: nums && pcts === nums ? "pct" : nums >= texts && nums ? "amount" : undefined };
  });
  const out: Record<string, unknown>[] = [];
  const numbers: number[] = [];
  const dataRows: Record<string, unknown>[] = [];
  for (const part of parts) {
    if (part.heading) out.push({ __h: part.heading });
    for (const r of part.rows) {
      const src = g.rows[r - 1] || [];
      if (picked.every((p) => src[p.i] == null)) continue;
      const row: Record<string, unknown> = {};
      picked.forEach((p, k) => { const v = src[p.i]; row["c" + k] = v; if (typeof v === "number") numbers.push(v); });
      const label = picked.map((p) => src[p.i]).find((v) => typeof v === "string");
      if (label && TOTAL_WORD.test(String(label))) row.__b = true; else dataRows.push(row);
      out.push(row);
    }
  }
  if (!out.some((r) => !r.__h)) return { error: "those rows and columns of " + f.name + " are empty" };
  // a sum the model asked for: FinCom's, of the copied rows (not the file's own total rows)
  if (spec.sum && Array.isArray(spec.sum.columns) && spec.sum.columns.length) {
    const row: Record<string, unknown> = { __sum: true };
    const labelCol = columns.findIndex((c) => !c.t);
    row["c" + (labelCol >= 0 ? labelCol : 0)] = String(spec.sum.label || "Total").slice(0, 60);
    for (const sc of spec.sum.columns) {
      const k = picked.findIndex((p) => p.i === colIndex(sc) || p.label.toLowerCase() === String(sc).toLowerCase());
      if (k < 0) return { error: "the sum's column " + sc + " is not one of the columns copied" };
      if (columns[k].t !== "amount") return { error: "the sum's column " + sc + " has no amounts" };
      const s = round(dataRows.reduce((a, d) => a + (typeof d["c" + k] === "number" ? d["c" + k] as number : 0), 0));
      row["c" + k] = s; numbers.push(s);
    }
    out.push(row);
  }
  return { table: { title: g.name, columns, rows: out, fromFile: f.name, note: "Figures as in your file " + f.name + "; not checked against the books." }, numbers, file: f.name };
}

// ---------------------------------------------------------------- the model's figures in the file's text
// every figure it writes must be a copied cell: amounts (₹ / grouped / with paise), percentages, and "1.25 crore" / "45 lakh"
const UNIT: Record<string, number> = { lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7, cr: 1e7, mn: 1e6, million: 1e6, thousand: 1e3 };
export function fileFigures(text: string, allowed: number[]): string[] {
  const have = allowed.filter((x) => isFinite(x)).map((x) => Math.abs(x));
  const near = (v: number, tol: number) => have.some((h) => Math.abs(h - Math.abs(v)) <= tol);
  const bad: string[] = [];
  const t = String(text || "");
  const taken: [number, number][] = [];
  for (const m of t.matchAll(/(₹\s?|Rs\.?\s?)?(\d+(?:,\d{2,3})*(?:\.(\d+))?)\s?(lakhs?|lacs?|crores?|cr|mn|million|thousand)\b\.?/gi)) {
    const v = Number(m[2].replace(/,/g, "")), unit = UNIT[m[4].toLowerCase()], dec = (m[3] || "").length;
    taken.push([m.index || 0, (m.index || 0) + m[0].length]);
    // the cell to the precision written: 1.25 crore stands for 1,24,50,000 to 1,25,49,999
    if (!near(v * unit, 0.5 * unit * 10 ** -dec + 0.01) && !near(v, 0.005)) bad.push(m[0].trim());
  }
  for (const m of t.matchAll(/(-?\d+(?:\.\d+)?)\s?%/g)) {
    const at = m.index || 0;
    if (taken.some(([a, b]) => at >= a && at < b)) continue;
    const v = Number(m[1]), dec = (m[1].split(".")[1] || "").length;
    if (!near(v, 0.5 * 10 ** -dec + 1e-9)) bad.push(m[0]);
  }
  for (const f of figuresIn(t)) {
    if (taken.some(([a, b]) => f.at >= a && f.at < b)) continue;
    if (!near(f.value, 0.005)) bad.push(f.text.trim());
  }
  return Array.from(new Set(bad));
}
// the sentences that hold a figure not in the file are left out (after the model was asked twice to use the file's cells)
export function dropSentences(text: string, bad: string[]): string {
  if (!bad.length) return text;
  return String(text).split("\n").map((line) => line.split(/(?<=[.!?])\s+/).filter((s) => !bad.some((b) => s.includes(b))).join(" ")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
