// Flexible payroll (next-payroll, docs/PAYROLL.md): any salary sheet layout, read by a saved rule after the AI has studied
// it ONCE and the owner confirmed the mapping; an employee-by-employee entry form; the checks every row must pass; and
// which way the company books salary (a journal, or Tally's Payroll). Plain JavaScript with no globals, so the page and
// the tests (Node) run the same file. A new module, not 17-24q.js (the imports fix track owns TDS24Q's reader).
//
//   readGrid(file | text)        -> {grid, sheet}: CSV (quoted cells, commas inside quotes) or the first sheet of an Excel
//   headRow(grid)                -> the header row's index (it may sit a few rows down, under a title)
//   fingerprint(head, sheet)     -> "p…": the layout's key (the normalised header names, their count, the sheet's name)
//   findRule(head, sheet, rules) -> the client's saved rule for this exact layout, or null (a new or changed layout)
//   samples(head, rows)          -> what the AI is shown: the header and AT MOST 3 rows, names, PANs, codes, e-mails,
//                                   phones and account numbers masked (figures and dates kept, to tell days from amounts)
//   propose(head, rows, ai)      -> the AI's mapping (ai = SheetAI.map, the firm's assistant "sheet_map", side "payroll"),
//                                   checked: only the sheet's own columns, one field a column
//   guess(head)                  -> a mapping by column names only, for the owner to finish when the AI is not available
//   makeRule(head, sheet, m, by) -> the rule to save (per client: co.payrollFormats)
//   apply(rule, grid, hi, o)     -> {rows, skipped, months}: the RULE alone reads every row (no AI)
//   check(rows)                  -> per employee: gross = earnings (when the heads are mapped) and gross = net + deductions,
//                                   to the paisa; the totals
//   builderRows(rows)            -> the rows as Daily Check's payroll builder (server/_shared/dailyjournals.js payrollOne)
//                                   reads them, or why the journal cannot be made from them
//   detectMethod(b)              -> "tally" | "journal" | "" from the books (payroll entries, employees, salary journals),
//                                   for the owner to confirm
// The AI never decides a figure: it says which column is which; FinCom's own rules read the figures.

export const FIELDS = [
  ["name", "Employee name"], ["code", "Employee code"], ["pan", "PAN"], ["days", "Days paid"], ["month", "Month"], ["date", "Pay date"],
  ["gross", "Gross pay"], ["tds", "TDS (income tax)"], ["pt", "Professional tax"], ["pfEmp", "PF (employee)"], ["pfEr", "PF (employer)"],
  ["esiEmp", "ESI (employee)"], ["esiEr", "ESI (employer)"], ["net", "Net pay"],
];
export const SINGLE = FIELDS.map((f) => f[0]);
export const FIELD_WORDS = Object.fromEntries(FIELDS);
// the deductions out of the employee's pay (the employer's PF and ESI are not)
export const DED_FIELDS = ["tds", "pt", "pfEmp", "esiEmp"];
export const MAX_SAMPLE_ROWS = 3;

const P = (x) => Math.round((Number(x) || 0) * 100);
const R = (p) => p / 100;
const r2 = (x) => R(P(x));
export const norm = (h) => String(h == null ? "" : h).toLowerCase().replace(/[^a-z0-9%]+/g, "");
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const lastDay = (ym) => ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-" + String(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(4, 6), 0)).getUTCDate()).padStart(2, "0");
export const monLabel = (ym) => (ym ? MON[+ym.slice(4, 6) - 1].replace(/^./, (c) => c.toUpperCase()) + " " + ym.slice(0, 4) : "");
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };

// ---------------------------------------------------------------- reading the file
// a CSV line by line, with quoted cells ("1,23,456.00", "Kumar, Ravi") and doubled quotes; tab-separated too
export function parseCsv(text) {
  const t = String(text || "").replace(/^﻿/, ""), first = t.split(/\r?\n/)[0] || "";
  const sep = first.includes("\t") && !first.includes(",") ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
  const out = []; let row = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === "") { q = true; continue; }
    if (c === sep) { row.push(cell); cell = ""; continue; }
    if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => String(c).trim() !== ""));
}
// a file (the page) or a text (tests): CSV / TSV as text, Excel by the page's own XLSX (ensureXlsx, loaded on demand)
export async function readGrid(file, xlsx) {
  if (typeof file === "string") return { grid: parseCsv(file), sheet: "" };
  if (/\.(xlsx|xls)$/i.test(file.name || "")) {
    const X = xlsx || (typeof globalThis.ensureXlsx === "function" ? (await globalThis.ensureXlsx(), globalThis.XLSX) : globalThis.XLSX);
    if (!X) throw new Error("Excel files cannot be read here. Save the sheet as CSV.");
    const wb = X.read(await file.arrayBuffer(), { type: "array", cellDates: true }), name = wb.SheetNames[0];
    return { grid: X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" }), sheet: name };
  }
  return { grid: parseCsv(await file.text()), sheet: "" };
}
// an amount as the office writes it: 1,23,456.50 (Indian commas), ₹ / Rs., (1,234) or 1,234- negative, "-" or "nil" none
export function amount(v) {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  let s = String(v == null ? "" : v).trim();
  if (!s || /^(-+|nil|na|n\/a)$/i.test(s)) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/^(rs\.?|inr|₹)\s*/i, "").replace(/[,\s₹]/g, "");
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
  if (!/^\d*\.?\d+$/.test(s)) return 0;
  const n = Number(s);
  return neg ? -n : n;
}
// the header row: the first of the first 15 rows with three or more words, most of its cells not figures
export function headRow(grid) {
  for (let i = 0; i < Math.min(15, grid.length); i++) {
    const r = (grid[i] || []).map((c) => String(c == null ? "" : c).trim()), words = r.filter((c) => /[a-z]/i.test(c) && !/^[\d,.\-()₹\s]+$/.test(c));
    if (words.length >= 3 && words.length >= r.filter(Boolean).length * 0.6) return i;
  }
  return 0;
}
// (review 8) the tab's name without its month ("Oct 2026", "Salary_October", "NOV-26", any case): a monthly tab is the
// same layout every month, so its saved rule is used again
const MONTH_WORDS = /(january|february|march|april|june|july|august|september|october|november|december|sept|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/g;
export const tabKey = (sheet) => String(sheet || "").toLowerCase().replace(MONTH_WORDS, "").replace(/\d+/g, "#").replace(/[^a-z#]+/g, "").replace(/#+/g, "#");
export function fingerprint(head, sheet) {
  const names = (head || []).map(norm);
  return "p" + hash(names.join("|") + "#" + names.length + "#" + tabKey(sheet));
}
// the key rules were saved under before (the tab's name with its month)
const fingerprintWas = (head, sheet) => { const names = (head || []).map(norm), sh = String(sheet || "").toLowerCase().replace(/\d+/g, "#").replace(/[^a-z#]+/g, ""); return "p" + hash(names.join("|") + "#" + names.length + "#" + sh); };
// a known layout: the very same fingerprint, nothing less. A moved, added, renamed or removed column is a new layout,
// and the AI studies it again (the owner's rule)
export function findRule(head, sheet, rules) {
  const fp = fingerprint(head, sheet), was = fingerprintWas(head, sheet);
  return (rules || []).find((r) => r && !r.deleted && r.fp === fp) || (rules || []).find((r) => r && !r.deleted && r.fp === was) || null;
}

// ---------------------------------------------------------------- what the AI is shown, and its answer checked
// (review 8, re-review 8) every date masked to DATE_n (a birth, joining or pay date: "01-01-1990" too); a month kept only
// in the pay month / period column ("Oct-2026", "10/2026", a date of the 1st there as 2026-10). An account, phone or UAN of
// 9 digits or more (spaces, dashes and dots aside) masked; the figures rounded to two significant digits (a salary is
// never sent as it is; a day count up to 31 kept, to tell days from amounts)
export function roundFigure(s) {
  const n = amount(s);
  if (!n) return String(s).trim();
  const a = Math.abs(n);
  if (a <= 31) return String(Math.round(n * 2) / 2);
  const k = Math.pow(10, Math.max(0, Math.floor(Math.log10(a)) - 1));
  return String((n < 0 ? -1 : 1) * Math.round(a / k) * k);
}
export const isMonthColumn = (h) => /^(pay|salary|wage)?(month|period|monthyear|forthemonth|salarymonth|paymonth|payperiod)$/.test(norm(h)) || /^(month|period)of/.test(norm(h));
export function samples(head, rows) {
  const toks = new Map(), tok = (kind, v) => { const k = kind + "|" + v; if (!toks.has(k)) toks.set(k, kind + "_" + (Array.from(toks.keys()).filter((x) => x.startsWith(kind + "|")).length + 1)); return toks.get(k); };
  const monthCol = (head || []).map(isMonthColumn);
  const MONTH_ONLY = new RegExp("^(" + MON.join("|") + ")[a-z]*[-\\s'/]*\\d{2,4}$|^\\d{1,2}[-/]\\d{4}$|^\\d{4}[-/]\\d{1,2}$", "i");
  const cell = (v, i) => {
    const mc = monthCol[i];
    if (v instanceof Date) { const t = isNaN(v) ? "" : v.getFullYear() + "-" + String(v.getMonth() + 1).padStart(2, "0") + "-" + String(v.getDate()).padStart(2, "0"); return mc ? t.slice(0, 7) : tok("DATE", t); }
    let s = String(v == null ? "" : v).trim();
    if (!s) return "";
    if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(s)) return tok("PAN", s.toUpperCase());
    if (/@/.test(s)) return tok("EMAIL", s);
    if (/^\+?\d{9,}$/.test(s.replace(/[\s\-./]/g, "")) && !/^\d{1,3}(,\d{2,3})+(\.\d+)?$/.test(s) && !/\.\d{1,2}$/.test(s)) return tok("NUMBER", s);   // a phone, an account, a UAN
    const full = /^\d{1,4}[-\/.]\d{1,2}[-\/.]\d{1,4}$/.test(s) || /^\d{1,2}[-\s]?[a-z]{3,9}[-\s']*\d{2,4}$/i.test(s);
    if (full || MONTH_ONLY.test(s)) {
      if (!mc) return tok("DATE", s);                                                                    // any date outside the pay month column
      if (!full) return s;                                                                                // the pay month
      const m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.]\d{1,2}$/) || s.match(/^\d{1,2}[-\/.](\d{1,2})[-\/.](\d{4})$/);
      return m ? (m[1].length === 4 ? m[1] + "-" + m[2].padStart(2, "0") : m[2] + "-" + m[1].padStart(2, "0")) : tok("DATE", s);
    }
    if (/^[A-Z]{1,5}[-\/]?\d{1,6}$/i.test(s)) return tok("CODE", s.toUpperCase());                     // an employee code
    if (/^[\d,.\-()₹\s]+$/.test(s) || /^(rs\.?|inr|₹)/i.test(s)) return roundFigure(s);                 // a figure, rounded
    return tok("TEXT", s);                                                                               // a name, a department, a bank
  };
  return { head: head.map((h) => String(h == null ? "" : h)), rows: (rows || []).filter((r) => (r || []).some((c) => String(c == null ? "" : c).trim())).slice(0, MAX_SAMPLE_ROWS).map((r) => (r || []).map((c, i) => cell(c, i))) };
}
// the answer: {map: {field: header}, earn: [header], ded: [header], why}; only the sheet's own headers, one field a column,
// a column in at most one place
export function cleanMapping(r, head) {
  const names = head.map(norm), byName = (c) => { const i = typeof c === "number" ? c : names.indexOf(norm(c)); return i >= 0 && names[i] ? names[i] : ""; };
  const map = {}, used = new Set();
  Object.entries((r && r.map) || {}).forEach(([f, c]) => { const n = byName(c); if (!SINGLE.includes(f) || !n || used.has(n)) return; map[f] = n; used.add(n); });
  const list = (a) => (Array.isArray(a) ? a : []).map(byName).filter((n) => n && !used.has(n) && (used.add(n), true));
  const earn = list(r && r.earn), ded = list(r && r.ded);
  const why = {}; Object.entries((r && r.why) || {}).forEach(([f, w]) => { if (map[f] || f === "earn" || f === "ded") why[f] = String(w || "").slice(0, 80); });
  return { map, earn, ded, why };
}
// (24-Nov-2026, as next-fix-zoho-sales-sheet found for registers: the assistant reads at most 80 columns) a wide sheet
// sends the columns with a value in the sample rows or a name FinCom knows first, at most AI_COLS, in their order
export const AI_COLS = 80;
export function forAi(head, rows) {
  const all = (head || []).map((_, i) => i);
  if (all.length <= AI_COLS) return all;
  const body = (rows || []).filter((r) => (r || []).some((c) => String(c == null ? "" : c).trim())).slice(0, MAX_SAMPLE_ROWS);
  const named = (i) => Object.values(NAMES).some((ps) => ps.some((p) => p.test(norm(head[i])))) || EARN.test(norm(head[i])) || DED.test(norm(head[i]));
  const valued = (i) => body.some((r) => String((r || [])[i] == null ? "" : r[i]).trim() !== "");
  const score = (i) => (named(i) ? 0 : 2) + (valued(i) ? 0 : 1) + (String(head[i] == null ? "" : head[i]).trim() ? 0 : 4);
  return all.slice().sort((a, b) => score(a) - score(b) || a - b).slice(0, AI_COLS).sort((a, b) => a - b);
}
export async function propose(head, rows, ai) {
  if (typeof ai !== "function") throw new Error("FinCom's AI help is not available here: map the columns yourself.");
  const pick = forAi(head, rows), s = samples(pick.map((i) => head[i]), (rows || []).map((r) => pick.map((i) => (r || [])[i])));
  const r = await ai({ head: s.head, rows: s.rows, side: "payroll", fields: SINGLE.concat(["earn", "ded"]) });
  const m = cleanMapping(r, head);
  // an answer that names no column (cut short, or not read) is said, never shown as the AI's mapping
  if (!Object.keys(m.map).length && !m.earn.length && !m.ded.length) throw new Error("FinCom's AI gave no columns for this layout: the columns found by their names are shown.");
  return Object.assign(m, { cost: (r && r.cost) || null, ai: true });
}
// by names only (no AI): what the office usually calls each column. "Date of birth / joining / leaving" is never the pay
// date, and a total or "net" column never an earning
const NAMES = {
  name: [/^(employee|emp|staff)?name$/, /^nameofemployee$/, /^employee$/, /^staffname$/],
  code: [/^(emp|employee|staff)?(code|id|no)$/, /^ecode$/], pan: [/^pan/, /pan$/],
  days: [/^(days|paiddays|dayspaid|daysworked|workingdays|presentdays|attendance)$/],
  month: [/^(month|salarymonth|period|payperiod|monthyear)$/],
  date: [/^(paydate|paymentdate|dateofpayment|creditdate|paidon)$/],
  gross: [/^(gross|grosssalary|grosspay|grossearnings|totalearnings|grosstotal|totalgross)$/],
  tds: [/^(tds|incometax|it|tdsdeducted|tax|taxdeducted|tds192)$/], pt: [/^(pt|ptax|proftax|professionaltax)$/],
  pfEmp: [/^(pf|epf|pfemployee|employeepf|epfemployee|pfee|providentfund)$/, /^pf.*(employee|ee|12%)$/],
  pfEr: [/^(pfemployer|employerpf|epfemployer|pfer)$/, /employer.*pf|pf.*employer/],
  esiEmp: [/^(esi|esic|esiemployee|employeeesi|esiee)$/], esiEr: [/^(esiemployer|employeresi|esier)$/, /employer.*esi|esi.*employer/],
  net: [/^(net|netpay|netsalary|netpayable|takehome|nettransfer|amountpaid|netamount)$/],
};
const EARN = /^(basic|da|hra|conveyance|special|medical|lta|bonus|overtime|ot|incentive|arrears?|allowance|.*allowance|.*allow)$/;
const DED = /^(advance|loan|canteen|lwf|labourwelfare|recovery|.*recovery|otherdeductions?|deduction|insurance|mediclaim)$/;
const NEVER = /birth|dob|joining|doj|leaving|dol|bank|account|ifsc|uan|esino|pfno|aadhaar|designation|department|location|remarks/;
export function guess(head) {
  const m = { map: {}, earn: [], ded: [], why: {} }, used = new Set();
  const names = head.map(norm);
  Object.entries(NAMES).forEach(([f, pats]) => { const n = names.find((x) => x && !used.has(x) && !NEVER.test(x) && pats.some((p) => p.test(x))); if (n) { m.map[f] = n; used.add(n); } });
  names.forEach((x) => { if (!x || used.has(x) || NEVER.test(x) || /total|gross|net/.test(x)) return; if (EARN.test(x)) { m.earn.push(x); used.add(x); } else if (DED.test(x)) { m.ded.push(x); used.add(x); } });
  return m;
}
export function makeRule(head, sheet, m, o = {}) {
  return { id: "pf" + hash(fingerprint(head, sheet) + (o.at || "")), kind: "payroll", name: String(o.name || "Salary sheet").slice(0, 60), fp: fingerprint(head, sheet), cols: head.length,
    headers: head.map(norm), labels: head.map((h) => String(h == null ? "" : h).trim()), map: Object.assign({}, m.map), earn: (m.earn || []).slice(), ded: (m.ded || []).slice(),
    month: o.month || "", by: o.by || "", at: o.at || new Date().toISOString(), ai: !!m.ai, v: 1 };
}
// a mapping that can read a month: an employee, and either gross or the earnings heads, and a month from somewhere
export function mappingProblems(m, o = {}) {
  const p = [];
  if (!m.map.name) p.push("Which column is the employee's name?");
  if (!m.map.gross && !(m.earn || []).length) p.push("Which column is the gross pay (or which are the earnings)?");
  if (!m.map.month && !m.map.date && !o.month) p.push("Which month is this sheet for?");
  return p;
}

// ---------------------------------------------------------------- the rule reads the sheet (no AI)
// the month a cell names: "Oct-2026", "October 2026", "10/2026", "2026-10", a date, an Excel date number
export function monthOf(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return v.getFullYear() + String(v.getMonth() + 1).padStart(2, "0");
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0"); }
  const s = String(v).trim().toLowerCase();
  let x = s.match(/^([a-z]{3,})[^a-z0-9]*(\d{2}|\d{4})$/);
  if (x && MON.includes(x[1].slice(0, 3))) return (x[2].length === 2 ? "20" + x[2] : x[2]) + String(MON.indexOf(x[1].slice(0, 3)) + 1).padStart(2, "0");
  x = s.match(/^(\d{4})[-\/.](\d{1,2})$/); if (x && +x[2] >= 1 && +x[2] <= 12) return x[1] + x[2].padStart(2, "0");
  x = s.match(/^(\d{1,2})[-\/.](\d{4})$/); if (x && +x[1] >= 1 && +x[1] <= 12) return x[2] + x[1].padStart(2, "0");
  x = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (x) return x[1] + x[2];
  x = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/); if (x) return (x[3].length === 2 ? "20" + x[3] : x[3]) + x[2].padStart(2, "0");   // Indian d/m/y
  x = s.match(/^(\d{1,2})[-\s]([a-z]{3})[a-z]*[-\s](\d{2,4})$/); if (x && MON.includes(x[2])) return (x[3].length === 2 ? "20" + x[3] : x[3]) + String(MON.indexOf(x[2]) + 1).padStart(2, "0");
  return "";
}
const TOTAL = /^(grand\s*)?total\b|^sub\s*total|^net\s*total|^totals?$|^total\s+(for|of)\b/i;
export function apply(rule, grid, hi, o = {}) {
  const head = (grid[hi] || []).map(norm), map = rule.map || {}, at = (n) => (n ? head.indexOf(n) : -1);
  const ix = Object.fromEntries(SINGLE.map((f) => [f, at(map[f])]));
  const lab = (n) => (rule.labels || [])[(rule.headers || []).indexOf(n)] || n;
  const earnIx = (rule.earn || []).map((n) => [lab(n), at(n)]).filter((x) => x[1] >= 0), dedIx = (rule.ded || []).map((n) => [lab(n), at(n)]).filter((x) => x[1] >= 0);
  const get = (r, f) => (ix[f] >= 0 ? r[ix[f]] : ""), a = (r, f) => r2(amount(get(r, f)));
  const rows = [], skipped = [], months = new Set();
  grid.slice(hi + 1).forEach((r, k) => {
    const line = hi + 2 + k;
    if (!r || !r.some((c) => String(c == null ? "" : c).trim())) return;
    const name = String(get(r, "name") == null ? "" : get(r, "name")).replace(/\s+/g, " ").trim(), first = String(r.find((c) => String(c == null ? "" : c).trim()) || "").trim();
    if (TOTAL.test(name) || TOTAL.test(first)) { skipped.push({ line, why: "a total row" }); return; }
    if (!name) { skipped.push({ line, why: "no employee name" }); return; }
    const ym = monthOf(get(r, "month")) || monthOf(get(r, "date")) || o.month || rule.month || "";
    const earn = {}, ded = {};
    earnIx.forEach(([l, i]) => { const v = r2(amount(r[i])); if (v) earn[l] = v; });
    dedIx.forEach(([l, i]) => { const v = r2(amount(r[i])); if (v) ded[l] = v; });
    const earnSum = R(Object.values(earn).reduce((s, v) => s + P(v), 0)), otherDed = R(Object.values(ded).reduce((s, v) => s + P(v), 0));
    const gross = ix.gross >= 0 ? a(r, "gross") : earnSum;
    const tds = a(r, "tds"), pt = a(r, "pt"), pf = a(r, "pfEmp"), esi = a(r, "esiEmp");
    const net = ix.net >= 0 ? a(r, "net") : R(P(gross) - P(tds) - P(pt) - P(pf) - P(esi) - P(otherDed));
    if (!gross && !net) { skipped.push({ line, why: "no pay on this row" }); return; }
    if (ym) months.add(ym);
    rows.push({ name, code: String(get(r, "code") == null ? "" : get(r, "code")).trim(), pan: String(get(r, "pan") || "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
      days: ix.days >= 0 ? amount(get(r, "days")) : null, month: ym, date: ym ? lastDay(ym) : "", gross, tds, profTax: pt, pf, esi, net, pfEr: a(r, "pfEr"), esiEr: a(r, "esiEr"),
      earn, ded, otherDed, earnMapped: earnIx.length > 0, grossMapped: ix.gross >= 0, line, surcharge: 0, cess: 0, src: "sheet:" + rule.id });
  });
  return { rows, skipped, months: Array.from(months).sort() };
}

// ---------------------------------------------------------------- the checks (the sheet and manual entry alike)
// each employee: gross = the earnings heads (when the sheet has both) and gross = net + TDS + PT + PF + ESI + other
// deductions, to the paisa; no negative net; no employee twice; one month. The totals in paise
export function check(rows) {
  const per = [], seen = new Map(), T = { gross: 0, tds: 0, pt: 0, pf: 0, esi: 0, other: 0, net: 0, pfEr: 0, esiEr: 0 };
  (rows || []).forEach((r, i) => {
    const earnP = Object.values(r.earn || {}).reduce((s, v) => s + P(v), 0), otherP = Object.values(r.ded || {}).reduce((s, v) => s + P(v), 0);
    const dedP = P(r.tds) + P(r.profTax) + P(r.pf) + P(r.esi) + otherP, why = [];
    if (!String(r.name || "").trim()) why.push("no name");
    if (P(r.gross) <= 0) why.push("no gross pay");
    if (r.grossMapped !== false && Object.keys(r.earn || {}).length && earnP !== P(r.gross)) why.push("earnings " + inr(R(earnP)) + " are not the gross " + inr(r.gross));
    if (P(r.gross) !== P(r.net) + dedP) why.push("gross " + inr(r.gross) + " is not net " + inr(r.net) + " + deductions " + inr(R(dedP)));
    if (P(r.net) < 0) why.push("net pay below zero");
    if (r.days != null && (r.days < 0 || r.days > 31)) why.push(r.days + " days");
    const k = String(r.name || "").toLowerCase().replace(/[^a-z0-9]/g, "") + "|" + String(r.code || r.pan || "");
    if (seen.has(k)) why.push("on the sheet twice (row " + seen.get(k) + ")"); else seen.set(k, r.line || i + 1);
    per.push({ i, name: r.name, ok: !why.length, why, ded: R(dedP) });
    T.gross += P(r.gross); T.tds += P(r.tds); T.pt += P(r.profTax); T.pf += P(r.pf); T.esi += P(r.esi); T.other += otherP; T.net += P(r.net); T.pfEr += P(r.pfEr); T.esiEr += P(r.esiEr);
  });
  const months = Array.from(new Set((rows || []).map((r) => r.month).filter(Boolean)));
  const tot = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, R(v)]));
  const adds = T.gross === T.net + T.tds + T.pt + T.pf + T.esi + T.other;
  return { per, ok: per.length > 0 && per.every((p) => p.ok) && adds && months.length === 1, adds, months, tot, bad: per.filter((p) => !p.ok) };
}
export function inr(v) {
  const n = Math.round((Number(v) || 0) * 100) / 100, neg = n < 0, [a, b] = Math.abs(n).toFixed(2).split(".");
  const s = a.length > 3 ? a.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + a.slice(-3) : a;
  return (neg ? "−" : "") + "₹" + s + (b === "00" ? "" : "." + b);
}

// ---------------------------------------------------------------- to Daily Check's payroll journal builder
// The journal (Dr salary; Cr TDS, PT, PF, ESI and salary payable) is the existing builder's (payrollOne). Its rows are
// {name, code, pan, date, gross, tds, profTax, pf, esi, net}. Other deductions (an advance recovered, canteen) have no
// ledger role there: such a month is not made into a journal (exact or nothing): the person books it by hand, or posts
// it through Tally Payroll, where each deduction is a pay head. The employer's PF and ESI are not in the employee's pay
// and are not in this journal (as before).
export function builderRows(rows) {
  const c = check(rows);
  if (!c.ok) return { why: c.bad.length ? c.bad[0].name + ": " + c.bad[0].why.join("; ") : c.months.length !== 1 ? "The sheet must be one month" : "The sheet does not add up" };
  const other = (rows || []).filter((r) => P(r.otherDed));
  if (other.length) {
    const heads = Array.from(new Set(other.flatMap((r) => Object.keys(r.ded || {}))));
    return { why: "Other deductions (" + heads.join(", ") + ") have no ledger in the payroll journal. Book this month by hand, or post it through Tally Payroll." };
  }
  return { rows: rows.map((r) => ({ name: r.name, code: r.code || "", pan: r.pan || "", date: r.date, gross: r.gross, tds: r.tds, profTax: r.profTax, pf: r.pf, esi: r.esi, net: r.net, surcharge: 0, cess: 0 })) };
}
// the salary sheet kept with the books (b.salary, as TDS24Q keeps it for 24Q): this month's rows replace the same month's.
// (review 7) what 24Q read for an employee that a pay sheet does not carry (the exemptions, the standard deduction,
// Chapter VI-A, the taxable salary, the regime, the PAN) is carried over from that employee's row (by code, PAN, then
// name); replacing() says beforehand what would be replaced
const rowMonth = (r) => r.month || String(r.date || "").slice(0, 7).replace("-", "");
export const CARRY = ["exempt", "standard", "chapter6", "taxable", "regime", "pan"];
const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
// (re-review 9) the old row of the same employee: by code; else (codes missing or not matching) by PAN; else by name
const up = (x) => String(x || "").trim().toUpperCase();
function oldRowOf(was, r, taken) {
  const free = was.filter((w) => !taken.has(w) && rowMonth(w) === rowMonth(r));
  return (up(r.code) && free.find((w) => up(w.code) === up(r.code))) || (up(r.pan) && free.find((w) => up(w.pan) === up(r.pan))) || (nameKey(r.name) && free.find((w) => nameKey(w.name) === nameKey(r.name))) || null;
}
const has = (v) => v != null && v !== "" && v !== 0;
const taxOf = (r) => CARRY.some((k) => k !== "pan" && has(r[k]));
// the pairs: each new row with its old row (or none)
function pairs(old, rows) {
  const months = new Set(rows.map(rowMonth)), was = (old || []).filter((r) => months.has(rowMonth(r))), taken = new Set();
  return { was, list: rows.map((r) => { const o = oldRowOf(was, r, taken); if (o) taken.add(o); return [r, o]; }), taken };
}
// what keeping these rows replaces: n employees kept for the month(s), tax (of them with 24Q's figures), carried (the
// employees whose figures carry over), missed (those with 24Q's figures found on this sheet by none of code, PAN or name)
export function replacing(old, rows) {
  const { was, list, taken } = pairs(old, rows);
  return { n: was.length, months: Array.from(new Set(was.map(rowMonth))).sort(), tax: was.filter(taxOf).length,
    carried: list.filter(([, o]) => o && taxOf(o)).map(([r]) => r.name), missed: was.filter((w) => taxOf(w) && !taken.has(w)).map((w) => w.name) };
}
export function mergeSalary(old, rows) {
  const months = new Set(rows.map(rowMonth)), keep = (old || []).filter((r) => !months.has(rowMonth(r)));
  return keep.concat(pairs(old, rows).list.map(([r, o]) => {
    const carry = {};
    if (o) CARRY.forEach((k) => { if (!has(r[k]) && has(o[k])) carry[k] = o[k]; });
    return Object.assign({ exempt: 0, standard: 0, chapter6: 0, taxable: 0, regime: "" }, r, carry);
  }));
}

// ---------------------------------------------------------------- manual entry (the same rows, typed)
export function blankRow(ym) { return { name: "", code: "", pan: "", days: null, month: ym || "", date: ym ? lastDay(ym) : "", gross: 0, tds: 0, profTax: 0, pf: 0, esi: 0, net: 0, pfEr: 0, esiEr: 0, earn: {}, ded: {}, otherDed: 0, earnMapped: true, grossMapped: false, src: "manual" }; }
// a typed row: gross is the earnings heads (or as typed when there are none); net as typed (checked), else worked out
export function typedRow(t, ym, heads) {
  const earn = {}, ded = {};
  (heads.earn || []).forEach((h) => { const v = r2(amount((t.earn || {})[h])); if (v) earn[h] = v; });
  (heads.ded || []).forEach((h) => { const v = r2(amount((t.ded || {})[h])); if (v) ded[h] = v; });
  const earnSum = R(Object.values(earn).reduce((s, v) => s + P(v), 0)), otherDed = R(Object.values(ded).reduce((s, v) => s + P(v), 0));
  const gross = (heads.earn || []).length ? earnSum : r2(amount(t.gross));
  const tds = r2(amount(t.tds)), pt = r2(amount(t.pt)), pf = r2(amount(t.pf)), esi = r2(amount(t.esi));
  const net = String(t.net == null ? "" : t.net).trim() !== "" ? r2(amount(t.net)) : R(P(gross) - P(tds) - P(pt) - P(pf) - P(esi) - P(otherDed));
  // (review) the employer's PF and ESI of a month kept, changed by hand: carried (not typed here; not in the employee's pay)
  return Object.assign(blankRow(ym), { name: String(t.name || "").trim(), code: String(t.code || "").trim(), days: String(t.days == null ? "" : t.days).trim() === "" ? null : amount(t.days),
    gross, tds, profTax: pt, pf, esi, net, pfEr: r2(amount(t.pfEr)), esiEr: r2(amount(t.esiEr)), earn, ded, otherDed, grossMapped: !(heads.earn || []).length });
}

// ---------------------------------------------------------------- how the company books salary
// From the books FinCom holds (b.payroll, bridge 2.4.4: Tally's employees and the pay heads in payroll entries; the
// vouchers' types; salary journals). FinCom only proposes: the owner confirms, and the setting is kept on the client
// (co.payrollMethod = {value: "journal" | "tally", by, at, from}).
export function detectMethod(b) {
  const p = (b && b.payroll) || {}, emps = (p.employees || []).filter((e) => !e.group && !e.gone), allocs = p.allocs || [];
  const pv = new Set(allocs.map((a) => a.guid));
  const vs = (b && b.vouchers) || [];
  const payrollVch = vs.filter((v) => /^payroll$/i.test(String(v.type || v.vtype || "")));
  if (pv.size || payrollVch.length) return { value: "tally", why: (pv.size || payrollVch.length) + " payroll entr" + ((pv.size || payrollVch.length) === 1 ? "y" : "ies") + " in Tally" + (emps.length ? ", " + emps.length + " employees" : ""), sure: false };
  if (emps.length) return { value: "tally", why: emps.length + " employees in Tally's payroll, no payroll entry yet", sure: false };
  const salJ = vs.filter((v) => /journal/i.test(String(v.type || v.vtype || "")) && (v.ent || v.lines || []).some((e) => /SALAR|WAGES/i.test(String(e.l || e.ledger || "")) && Number(e.a != null ? e.a : -(e.dr || 0)) < 0));
  if (salJ.length) return { value: "journal", why: salJ.length + " salary journal" + (salJ.length === 1 ? "" : "s") + " in the books, no payroll entries", sure: false };
  return { value: "", why: "Nothing in the books says yet", sure: false };
}
export const METHOD_WORDS = { journal: "Journal", tally: "Tally Payroll" };
export function methodOf(co) { const m = (co && co.payrollMethod) || {}; return m.value === "journal" || m.value === "tally" ? m.value : ""; }
