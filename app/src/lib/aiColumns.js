// The one-time AI reading of a sheet's columns, wherever FinCom reads an uploaded sheet whose columns it does not know by
// name (the owner, 24-Nov-2026: "check everywhere if we require one-time AI; it should work by default"). Purchase and
// Sales registers (registers.js SheetFmt.propose) and Payroll (payrollSheet.js propose) had it; this adds it to a bank
// statement sheet (Excel / CSV) and the 24Q salary sheet, on the same AI path: the firm's assistant function, action
// "sheet_map" (SheetAI.map, registers.js), the cheap model, under FinCom's switch "sheet_map" (on), the firm's AI switch
// (on unless its owner switched it off) and its rupee cap. The key is the platform's, on the server; the bridge never
// calls this.
//
// The AI sees only the header row and a few masked rows (names, references, accounts, UPI ids masked; figures rounded for
// a salary sheet) and answers which column is which, never a figure: FinCom's own readers read every row by that mapping.
// The answer is kept for the client and that header layout (co.aiColumns, key kind + ":" + layoutKey(head): a hash of the
// header row's names), so the AI is asked once per client and layout; a person's correction replaces it ("person").
//   layoutKey(head)                         -> "h…": the header names, normalised, hashed
//   kept(co, kind, head) / keep(co, kind, head, map, how, who)
//   bankHead(grid)                          -> the header row's index of a statement sheet, or -1
//   bankFromGrids(grids, o)                 -> {meta, rows, source, cols} as parseSheetStatement gives, or throws
//   salaryCols(grid, o)                     -> {hi, idx, cols} for TDS24Q.fromFile, or null
//   saidCols(cols, fields)                  -> "Date ← “Txn On” · …": the "Columns read as" words
/* global globalThis */

const norm = (h) => String(h == null ? "" : h).toLowerCase().replace(/[^a-z0-9%]+/g, "");
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
export const layoutKey = (head) => { const n = (head || []).map(norm); return "h" + fnv(n.join("|") + "#" + n.length); };
const text = (v) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, " ").trim());

// what a bank statement's columns can be, in plain words (the order the line says them)
export const BANK_FIELDS = [["date", "Date"], ["narr", "Narration"], ["debit", "Withdrawal"], ["credit", "Deposit"], ["amount", "Amount"], ["drcr", "Dr / Cr"],
  ["balance", "Balance"], ["ref", "Cheque / reference"], ["valueDate", "Value date"]];
// the server's names (sheetmap.ts BANK_FIELDS) -> the bank reader's (20-bank-statements.js findHeader's cols)
const FROM_AI = { date: "date", valuedate: "valueDate", narration: "narr", ref: "ref", no: "ref", debit: "debit", credit: "credit", amount: "amount", drcr: "drcr", balance: "balance" };
// the 24Q salary sheet's columns (TDS24Q.cols) the AI can name (payrollSheet.js FIELDS; pt is the professional tax)
export const SALARY_FIELDS = [["name", "Employee name"], ["pan", "PAN"], ["code", "Employee code"], ["month", "Month"], ["date", "Pay date"], ["gross", "Gross"],
  ["tds", "TDS"], ["profTax", "Professional tax"]];
const FROM_PAY = { name: "name", pan: "pan", code: "code", month: "month", date: "date", gross: "gross", tds: "tds", pt: "profTax" };

// ---------------------------------------------------------------- kept per client and layout
export function kept(co, kind, head) {
  const k = kind + ":" + layoutKey(head), v = co && co.aiColumns && co.aiColumns[k];
  return v && v.map && !v.deleted ? v : null;
}
export function keep(co, kind, head, map, how, who) {
  if (!co) return null;
  const k = kind + ":" + layoutKey(head);
  co.aiColumns = Object.assign({}, co.aiColumns, { [k]: { kind, key: layoutKey(head), head: (head || []).map(text), map: Object.assign({}, map), how, by: who || "", at: new Date().toISOString() } });
  return co.aiColumns[k];
}
// a mapping by header text -> column indexes of this header
export function indexes(map, head) {
  const names = (head || []).map(norm), out = {};
  Object.entries(map || {}).forEach(([f, h]) => { const i = names.indexOf(norm(h)); if (i >= 0 && names[i]) out[f] = i; });
  return out;
}
// "Date ← “Txn On” · Narration ← “Remarks” · …"
export function saidCols(cols, fields) {
  const m = (cols && cols.map) || {};
  return (fields || BANK_FIELDS).filter(([f]) => m[f]).map(([f, w]) => w + " ← “" + m[f] + "”").join(" · ");
}

// ---------------------------------------------------------------- bank statements
const isDate = (v, H) => (v instanceof Date && !isNaN(v)) || !!(H && H.bankDate && H.bankDate(v));
const isMoney = (v) => typeof v === "number" || /^\(?-?[₹\s]*[\d,]+(\.\d{1,2})?\)?\s*(cr|dr)?\.?$/i.test(text(v));
// the header row: the last row of words (three or more, none a figure or a date) before the first row that holds a date
// and an amount, within the first 80
export function bankHead(grid, H) {
  let last = -1;
  for (let i = 0; i < Math.min((grid || []).length, 80); i++) {
    const r = (grid[i] || []).map(text), filled = r.filter(Boolean);
    if (filled.length >= 2 && r.some((c, j) => isDate(grid[i][j], H) || isDate(c, H)) && r.some((c, j) => c && isMoney(grid[i][j]) && !isDate(grid[i][j], H))) return last;
    if (filled.length >= 3 && filled.every((c) => /[a-z]/i.test(c) && !isDate(c, H) && !/^[\d,.\-()₹\s]+$/.test(c))) last = i;
  }
  return -1;
}
// the rows shown to the AI: 10 at most, every word masked to its shape (TEXT_1), long numbers (accounts, references,
// UTRs) to NUMBER_1, UPI ids and e-mails to ID_1; dates and amounts kept, to tell the date and money columns apart
export function bankSample(head, rows) {
  const toks = new Map(), tok = (kind, v) => { const k = kind + "|" + v; if (!toks.has(k)) toks.set(k, kind + "_" + (Array.from(toks.keys()).filter((x) => x.startsWith(kind + "|")).length + 1)); return toks.get(k); };
  const cell = (v) => {
    if (v instanceof Date) return isNaN(v) ? "" : v.toISOString().slice(0, 10);
    const s = text(v);
    if (!s) return "";
    if (/@/.test(s)) return tok("ID", s);
    if (/^[\d,.\s]+(cr|dr)?\.?$/i.test(s) && /\.\d{1,2}\b/.test(s)) return s;                      // an amount
    if (/^\d{1,4}[-\/.\s][\da-z]{1,9}[-\/.\s]\d{1,4}$/i.test(s)) return s;                         // a date
    if (/^(dr|cr|d|c|debit|credit)\.?$/i.test(s)) return s;
    if (/^\+?\d{7,}$/.test(s.replace(/[\s\-]/g, ""))) return tok("NUMBER", s);
    if (/^[\d,.\-()₹\s]+$/.test(s)) return s;
    return tok("TEXT", s);
  };
  const body = (rows || []).filter((r) => (r || []).some((c) => text(c))).slice(0, 10);
  // (the assistant reads at most 80 columns: a wide sheet sends those with a value or a heading a bank uses first)
  let pick = (head || []).map((_, i) => i);
  if (pick.length > 80) {
    const score = (i) => (body.some((r) => text((r || [])[i])) ? 0 : 1) + (/date|narr|partic|desc|remark|debit|credit|withdraw|deposit|amount|bal|chq|cheque|ref|dr|cr/i.test(text(head[i])) ? 0 : 2);
    pick = pick.slice().sort((a, b) => score(a) - score(b) || a - b).slice(0, 80).sort((a, b) => a - b);
  }
  return { head: pick.map((i) => text(head[i])), rows: body.map((r) => pick.map((i) => cell((r || [])[i]))) };
}
const bankOk = (c) => c.date !== undefined && c.narr !== undefined && ((c.debit !== undefined && c.credit !== undefined) || c.amount !== undefined);
// the AI's answer as the bank reader's columns, by header text
export function bankMap(answer, head) {
  const names = (head || []).map(norm), map = {}, used = new Set();
  Object.entries((answer && answer.map) || {}).forEach(([f, h]) => {
    const k = FROM_AI[String(f).toLowerCase()] || (BANK_FIELDS.some((x) => x[0] === f) ? f : "");
    const i = typeof h === "number" ? h : names.indexOf(norm(h));
    if (!k || map[k] || i < 0 || !names[i] || used.has(i)) return;
    map[k] = text(head[i]); used.add(i);
  });
  return map;
}
// o: {co, ai (SheetAI.map), save(co), who, H: the bank reader's own functions {rowsFromCells, statementMeta, cellText, bankDate}}
export async function bankFromGrids(grids, o) {
  const H = o.H, ai = o.ai || (globalThis.SheetAI && globalThis.SheetAI.map && ((r) => globalThis.SheetAI.map(r)));
  let why = null, seen = null;
  for (const grid of grids || []) {
    const hi = bankHead(grid, H);
    if (hi < 0) continue;
    const head = (grid[hi] || []).map(text);
    seen = seen || { head, hi };
    let got = kept(o.co, "bank", head), how = got ? got.how : "";
    let cols = got ? indexes(got.map, head) : null;
    if (!cols || !bankOk(cols)) {
      if (typeof ai !== "function") { why = why || "FinCom's AI is not available here"; continue; }
      let answer;
      try { answer = await ai(Object.assign(bankSample(head, grid.slice(hi + 1)), { side: "bank", fields: ["date", "valuedate", "narration", "ref", "debit", "credit", "amount", "drcr", "balance"] })); }
      catch (e) { why = (e && e.message) || String(e); continue; }
      const map = bankMap(answer, head);
      cols = indexes(map, head);
      if (!bankOk(cols)) { why = "FinCom's AI could not tell the date, narration and amount columns"; continue; }
      got = keep(o.co, "bank", head, map, "ai", o.who); how = "ai";
      if (o.save) try { o.save(o.co); } catch (e) { /* kept on this page */ }
    }
    const body = grid.slice(hi + 1), line = (r) => (r || []).map(text).filter(Boolean).join(" ");
    const top = grid.slice(0, hi).map(line), tail = body.filter((r) => !H.bankDate(r[cols.date])).map(line);
    const rows = H.rowsFromCells(body, cols, (r, c) => r[c], line);
    if (!rows.length) continue;
    return { meta: H.statementMeta(top.concat(tail)), rows, source: "sheet", cols: { kind: "bank", key: layoutKey(head), how, head, map: Object.assign({}, got.map) } };
  }
  throw Object.assign({ code: "bank_no_header" }, why ? { why } : {}, seen ? { head: seen.head } : {});
}

// ---------------------------------------------------------------- the 24Q salary sheet
// o: {co, ai (SheetAI.map), save(co), who, PS: payrollSheet.js}. The client's confirmed Payroll rule for this layout first
// (co.payrollFormats), then a mapping kept here, then the AI once (side "payroll": the header and 3 masked rows)
export async function salaryCols(grid, o) {
  const PS = o.PS, hi = PS.headRow(grid), head = (grid[hi] || []).map(text), co = o.co || {};
  const ai = o.ai || (globalThis.SheetAI && globalThis.SheetAI.map && ((r) => globalThis.SheetAI.map(r)));
  const ok = (m) => m.name && m.tds;
  const from = (m) => { const out = {}; Object.entries(m || {}).forEach(([f, h]) => { const k = FROM_PAY[f]; const i = (head.map(norm)).indexOf(norm(h)); if (k && i >= 0 && !out[k]) out[k] = head[i]; }); return out; };
  let map = null, how = "";
  // (a person's own choice here first, then the confirmed Payroll layout, then the AI's kept answer)
  const was = kept(co, "salary", head);
  if (was && was.how === "person" && ok(was.map)) { map = was.map; how = "person"; }
  const rule = !map && (PS.findRule(head, "", co.payrollFormats) || PS.findRule(head, o.sheet || "", co.payrollFormats));
  if (rule && ok(from(rule.map))) { map = from(rule.map); how = "saved"; }
  if (!map && was && ok(was.map)) { map = was.map; how = was.how; }
  if (!map) {
    if (typeof ai !== "function") return null;
    const m = await PS.propose(head, grid.slice(hi + 1), ai);
    const got = from(m.map);
    if (!ok(got)) return null;
    map = got; how = "ai";
    keep(co, "salary", head, map, "ai", o.who);
    if (o.save) try { o.save(co); } catch (e) { /* kept on this page */ }
  }
  const ix = indexes(map, head), idx = {};
  SALARY_FIELDS.forEach(([f]) => { idx[f] = ix[f] === undefined ? -1 : ix[f]; });
  return { hi, idx, cols: { kind: "salary", key: layoutKey(head), how, head, map } };
}

export const AiCols = { layoutKey, kept, keep, indexes, saidCols, bankHead, bankSample, bankMap, bankFromGrids, salaryCols, BANK_FIELDS, SALARY_FIELDS };

// what the page calls (registers.js: window.AiCols = forPage(window)), on its own globals: the open client, its store,
// who is signed in, the firm's AI (SheetAI.map) and the bank reader's functions (src/js/20-bank-statements.js)
//   AiCols.bank(grids)          readStatement, src/js/21: a statement sheet whose headings were not found by name
//   AiCols.salary(grid, sheet)  TDS24Q.fromFile, src/js/17: a salary sheet without a name and a TDS column by name
export function forPage(g) {
  const co = (id) => { try { return g.CO(id); } catch (e) { return null; } };
  const base = (cid) => ({ co: co(cid), save: (c) => { if (g.Store && g.Store.saveCompany) g.Store.saveCompany(c); }, who: typeof g.whoAmI === "function" ? g.whoAmI() : "",
    ai: g.SheetAI && g.SheetAI.map ? (r) => g.SheetAI.map(r) : null });
  const bankCid = () => { try { const b = typeof g.B === "function" ? g.B() : null; return (b && b.cid) || g.S.coId; } catch (e) { return g.S && g.S.coId; } };
  return Object.assign({}, AiCols, {
    bank: (grids) => bankFromGrids(grids, Object.assign(base(bankCid()), { H: { rowsFromCells: g.rowsFromCells, statementMeta: g.statementMeta, bankDate: g.bankDate } })),
    salary: async (grid, sheet) => salaryCols(grid, Object.assign(base((g.S.books && g.S.books.cid) || g.S.coId), { sheet, PS: await import("./payrollSheet.js") })),
  });
}
export default AiCols;
