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
  // (the header kept with it must be this one, name by name: a hash alone could meet another layout)
  const same = v && Array.isArray(v.head) && v.head.map(norm).join("|") === (head || []).map(norm).join("|");
  return v && v.map && !v.deleted && same ? v : null;
}
export function keep(co, kind, head, map, how, who, more) {
  if (!co) return null;
  const k = kind + ":" + layoutKey(head);
  co.aiColumns = Object.assign({}, co.aiColumns, { [k]: Object.assign({ kind, key: layoutKey(head), head: (head || []).map(text), map: Object.assign({}, map), how, by: who || "", at: new Date().toISOString() }, more || {}) });
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
// ---------------------------------------------------------------- an AI mapping checked before it is used or kept
// (the review of aead82472: a mapping with Withdrawal and Deposit swapped posted every line the wrong way). FinCom's
// own checks, never the person's: the running balance decides the direction (a mapping that fits only turned round is
// turned round), the headings decide when there is no balance, and a mapping nothing settles is not used (the person
// chooses the columns). Also not used: lines that often have both a debit and a credit, one Amount with no Dr / Cr when
// a column holds only D / C (that column is taken as Dr / Cr), a running balance that does not fit either way.
// (re-review of 9c49e2da2) only plain money words settle a direction: Withdrawal / Deposit, Paid in / out, Money in /
// out, Received. Debit / Credit and Dr / Cr never do (they depend on whose books it is: the bank's or the client's).
const IN_WORDS = /deposit|paid\s*in\b|money\s*in\b|received|^in$/i, OUT_WORDS = /withdraw|paid\s*out\b|money\s*out\b|^out$/i;
const says = (h) => { const t = String(h || "").replace(/\(?\s*\bin\s+(rs\.?|inr|rupees|₹)[^)]*\)?/gi, " ").replace(/\s+/g, " ").trim(); const i = IN_WORDS.test(t), o = OUT_WORDS.test(t); return i && !o ? "in" : o && !i ? "out" : ""; };
const DC_ONLY = /^(d|c|dr|cr|debit|credit)\.?$/i;
const fit = (p, r, v) => Math.abs(Math.round((p - r.debit + r.credit) * 100) / 100 - v) <= 0.011;
const fitOf = (list) => {
  let as = 0, round = 0, n = 0;
  for (let i = 1; i < list.length; i++) {
    const p = list[i - 1].balance, r = list[i];
    if (p == null || r.balance == null) continue;
    n++;
    if (fit(p, r, r.balance)) as++;
    if (fit(p, { debit: r.credit, credit: r.debit }, r.balance)) round++;
  }
  return { as, round, n };
};
// how many lines fit their running balance as read, and turned round: {as, round, n}. Newest first (a later first
// date) is read oldest first; a statement of one day may be in either order, so both are tried and the better kept
export function balanceFit(rows) {
  if (rows.length > 1 && rows[0].date > rows[rows.length - 1].date) return fitOf(rows.slice().reverse());
  const a = fitOf(rows);
  if (rows.length > 1 && rows[0].date === rows[rows.length - 1].date) { const z = fitOf(rows.slice().reverse()); if (Math.max(z.as, z.round) > Math.max(a.as, a.round)) return z; }
  return a;
}
const swapMap = (m) => { const x = Object.assign({}, m); x.debit = m.credit; x.credit = m.debit; return x; };
// -> {map, rows} to use, or {why} when the mapping is not to be used (the person chooses the columns). A mapping is
// turned round only when the money words of its headings say it was swapped; the running balance must then fit
export function bankCheck(map, head, body, read) {
  let m = Object.assign({}, map);
  const names = (head || []).map(text);
  if (m.amount && !m.drcr) {
    const used = new Set(Object.values(m).map(norm)), filled = (i) => body.map((r) => text((r || [])[i])).filter(Boolean);
    const dc = names.findIndex((h, i) => h && !used.has(norm(h)) && filled(i).length * 2 >= body.length && filled(i).every((v) => DC_ONLY.test(v)));
    if (dc >= 0) m.drcr = names[dc];
  }
  let rows = read(m);
  if (!rows.length) return { why: "no lines were read with FinCom's AI's columns" };
  if (m.debit && m.credit && rows.filter((r) => r.debit && r.credit).length * 5 > rows.length) return { why: "lines read with both a withdrawal and a deposit" };
  const two = !!(m.debit && m.credit), dSays = two ? says(m.debit) : "", cSays = two ? says(m.credit) : "";
  const right = (dSays === "out" || cSays === "in") && dSays !== "in" && cSays !== "out", round = (dSays === "in" || cSays === "out") && dSays !== "out" && cSays !== "in";
  if (m.balance) {
    const f = balanceFit(rows), asFits = f.n && f.as * 2 > f.n && f.as >= f.round, roundFits = f.n && f.round * 2 > f.n && f.round > f.as;
    if (asFits) return round ? { why: "the headings and the balance disagree" } : { map: m, rows };
    if (roundFits && two && round) { const sw = swapMap(m); return { map: sw, rows: read(sw), swapped: true }; }
    // fits only turned round with headings that say it is right: an overdraft printed without its minus (the balance
    // check knows it, src/js/22-bank-guards.js); with headings that say nothing: not settled
    if (roundFits && two && right) return { map: m, rows };
    return { why: roundFits ? "nothing says which column is the withdrawal" : "the running balance does not fit the columns" };
  }
  if (!two) return m.drcr ? { map: m, rows } : { why: "one amount column with nothing saying which way" };
  if (right) return { map: m, rows };
  if (round) { const sw = swapMap(m); return { map: sw, rows: read(sw), swapped: true }; }
  return { why: "nothing says which column is the withdrawal" };
}

// o: {co, ai (SheetAI.map), save(co), who, H: the bank reader's own functions {rowsFromCells, statementMeta, cellText, bankDate}}
export async function bankFromGrids(grids, o) {
  const H = o.H, ai = o.ai || (globalThis.SheetAI && globalThis.SheetAI.map && ((r) => globalThis.SheetAI.map(r)));
  let why = null, seen = null, aiDown = false;
  for (const grid of grids || []) {
    const hi = bankHead(grid, H);
    if (hi < 0) continue;
    const head = (grid[hi] || []).map(text);
    seen = seen || { head, hi };
    const body = grid.slice(hi + 1), line = (r) => (r || []).map(text).filter(Boolean).join(" ");
    const read = (m) => { const c = indexes(m, head); return bankOk(c) ? H.rowsFromCells(body, c, (r, x) => r[x], line) : []; };
    let got = kept(o.co, "bank", head), how = got ? got.how : "", rows = null;
    // (an AI mapping kept by the build before the checks: checked now, kept again marked, or not used)
    if (got && got.how === "ai" && !got.checked) {
      const c = bankOk(indexes(got.map, head)) ? bankCheck(got.map, head, body, read) : { why: "not complete" };
      if (!c.map) { why = c.why; continue; }
      got = keep(o.co, "bank", head, c.map, "ai", got.by, { checked: 1 }); rows = c.rows;
      if (o.save) try { o.save(o.co); } catch (e) { /* kept on this page */ }
    }
    let cols = got ? indexes(got.map, head) : null;
    if (!cols || !bankOk(cols)) {
      // (the AI off, or the firm's cap reached, on one sheet: not asked again for the next sheets of the file)
      if (typeof ai !== "function" || aiDown) { why = why || "FinCom's AI is not available here"; continue; }
      let answer;
      try { answer = await ai(Object.assign(bankSample(head, body), { side: "bank", fields: ["date", "valuedate", "narration", "ref", "debit", "credit", "amount", "drcr", "balance"] })); }
      catch (e) { why = (e && e.message) || String(e); aiDown = true; continue; }
      const map0 = bankMap(answer, head);
      if (!bankOk(indexes(map0, head))) { why = "FinCom's AI could not tell the date, narration and amount columns"; continue; }
      const c = bankCheck(map0, head, body, read);
      if (!c.map) { why = c.why; continue; }
      got = keep(o.co, "bank", head, c.map, "ai", o.who, { checked: 1 }); how = "ai"; rows = c.rows; cols = indexes(c.map, head);
      if (o.save) try { o.save(o.co); } catch (e) { /* kept on this page */ }
    }
    const top = grid.slice(0, hi).map(line), tail = body.filter((r) => !H.bankDate(r[cols.date])).map(line);
    rows = rows || read(got.map);
    if (!rows.length) continue;
    return { meta: H.statementMeta(top.concat(tail)), rows, source: "sheet", cols: { kind: "bank", key: layoutKey(head), how, head, map: Object.assign({}, got.map) } };
  }
  throw Object.assign({ code: "bank_no_header" }, why ? { why } : {}, seen ? { head: seen.head } : {});
}

// ---------------------------------------------------------------- a statement read again with its columns put right
// (re-review of 9c49e2da2) a statement is read again only when none of its lines is in Tally or has anything to do with
// posting: a line in Tally (sent, in Tally, a Tally id), any posting job for it (live, done or posted; on this computer
// or FinCom's cloud; one named in its post error) or held for checking. jobOf(r): any posting job holding the line
export function touched(r, jobOf) {
  if (!r) return false;
  if (r.state === "sent" || r.state === "intally" || r.tally || r.sentAt || r.checking || r.postJob || r.postJobNew) return true;
  if (/, job [A-Za-z0-9-]{8,64}/.test(String(r.postError || ""))) return true;
  return !!(typeof jobOf === "function" && jobOf(r));
}
// the lines read again are charged only beyond those paid for the first time
export const extraLines = (paid, now) => Math.max(0, (now || 0) - (paid || 0));
const nk = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const amt = (r) => Math.round(Math.max(Number(r.debit) || 0, Number(r.credit) || 0) * 100);
const dir = (r) => (Number(r.debit) || 0) > 0 ? "d" : "c";
const CARRY = ["ledger", "userSet", "state", "vtype", "note", "splits", "billId", "billRef", "tdsAtPay", "tdsLedger", "salesIds", "narrEdit", "why"];
const FLIP_DROP = ["vtype", "billId", "billRef", "salesIds", "tdsAtPay", "tdsLedger", "splits"];
// the person's choices on the old lines (a statement with nothing in Tally) carried to the lines read again: first the
// same date, amount and whole narration, over every new line; then, for the lines left, the same date, amount and
// direction when exactly one old line and one new line are left so. A line turned round is to check again (suggested).
// An old line met by none stays in the deleted copy (More → Restore). -> {rows, carried, lost}
export function carry(oldRows, newRows) {
  const left = (oldRows || []).slice(), rows = (newRows || []).slice(), pair = new Map();
  rows.forEach((r) => { const i = left.findIndex((o) => o.date === r.date && amt(o) === amt(r) && nk(o.narr) === nk(r.narr)); if (i >= 0) pair.set(r, left.splice(i, 1)[0]); });
  const key = (r) => r.date + "|" + amt(r) + "|" + dir(r);
  rows.filter((r) => !pair.has(r)).forEach((r, _, rest) => {
    const olds = left.filter((o) => key(o) === key(r)), news = rest.filter((x) => key(x) === key(r));
    if (olds.length === 1 && news.length === 1) { pair.set(r, olds[0]); left.splice(left.indexOf(olds[0]), 1); }
  });
  let carried = 0;
  rows.forEach((r) => {
    const o = pair.get(r);
    if (!o || !(o.userSet || o.ledger)) return;
    const flipped = dir(o) !== dir(r);
    CARRY.forEach((k) => { if (o[k] !== undefined && !(flipped && FLIP_DROP.includes(k))) r[k] = o[k]; });
    // (never "sent" or "intally": a line read again is never marked in Tally by a carry; such a statement is not read again)
    if (r.state === "sent" || r.state === "intally") r.state = r.ledger ? "suggested" : "attention";
    if (flipped && ["ready", "sent", "intally"].includes(r.state)) r.state = "suggested";
    carried++;
  });
  return { rows, carried, lost: left.length };
}

// ---------------------------------------------------------------- the 24Q salary sheet
const tdsSane = (m, head, body, PS) => {
  if (!m.gross) return true;
  const ix = indexes(m, head);
  if (ix.gross === ix.tds) return false;
  return !body.some((r) => { const g = PS.amount((r || [])[ix.gross]), t = PS.amount((r || [])[ix.tds]); return g > 0 && t > g; });
};
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
    // (a date of birth, joining or leaving is never the pay date; TDS is never above the gross)
    if (got.date && /birth|join|leav|dob|doj/i.test(norm(got.date))) delete got.date;
    if (!ok(got) || !tdsSane(got, head, grid.slice(hi + 1), PS)) return null;
    map = got; how = "ai";
    keep(co, "salary", head, map, "ai", o.who);
    if (o.save) try { o.save(co); } catch (e) { /* kept on this page */ }
  }
  const ix = indexes(map, head), idx = {};
  SALARY_FIELDS.forEach(([f]) => { idx[f] = ix[f] === undefined ? -1 : ix[f]; });
  return { hi, idx, cols: { kind: "salary", key: layoutKey(head), how, head, map } };
}

export const AiCols = { layoutKey, kept, keep, indexes, saidCols, bankHead, bankSample, bankMap, bankCheck, balanceFit, bankFromGrids, touched, extraLines, carry, salaryCols, BANK_FIELDS, SALARY_FIELDS };

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
