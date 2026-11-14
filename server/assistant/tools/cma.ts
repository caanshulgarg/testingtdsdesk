// CMA data for a bank (the owner, 14-Nov-2026): "Prepare CMA data" in Ask FinCom, in the STANDARD bank format (no one
// bank's own), acting first: it asks only for what it cannot know (the loan's type and amount, a term loan's repayment
// schedule) and makes everything else on stated defaults. One call:
//   1. Past years: the balance sheets and the earlier CMA uploaded in this chat (or earlier in it), read and checked
//      (cmaread.ts: Excel by FinCom, a PDF by the AI into a strict schema). Where an audited balance sheet and the
//      earlier CMA give a year, the audited figures are used and every difference is listed. With no file, the books'
//      last complete years (FSX, the Reports screen's Schedule III, as projection.ts reads them).
//   2. The year now running: the books to date (FSX's own sums), the P&L annualised, labelled "estimate".
//   3. Projections: as many years as asked (to the year the user names, up to five after the year now running). On the
//      user's own figures where given (cmaplan.ts reads them from the question, pasted tables included, and from a Word
//      road map or an Excel attached: the rules first, then the AI into a strict schema, every figure checked against
//      the text; cmaproj.ts projects on them from the latest audited year), else projection.ts's project() on its
//      defaults; every assumption listed, and where the user's figures disagree with each other, the amounts are used
//      and the difference listed. A "Projections summary" in the user's own layout (A revenue and growth, B the
//      profitability, C the revenue by business vertical), worked from the forms' own figures.
//   4. The forms, the ratios and the checks (cmaengine.ts); a check that fails makes the whole a DRAFT, said first.
//   5. The bank-format Excel with live formulas (cmaxl.ts).
// Figures are FinCom's (the files' cells, the books' sums, the engine's formulas); the AI only reads a PDF.
import type { ExtCtx, ExtResult, ExtTool, ToolTable } from "./types.ts";
import { fyOf, inputFor } from "./reports.ts";
import { Assume, linesOf, monthsIn, project } from "./projection.ts";
import { numOf } from "./num.ts";
import { gridsFromCsv, gridsFromXlsx } from "../filetable.ts";
import { Cma, cmaCompute, CYear, fyL, KIND_WORD, Lines, Opts, pbtLines, PLK, rowOf, sumOf } from "./cmaengine.ts";
import { FileKind, pastYears, READ_PROMPT, READ_SCHEMA, readAi, readGrids, RFile } from "./cmaread.ts";
import { cmaExcel, rowCells, Summary, XlMeta } from "./cmaxl.ts";
import { emptyPlan, Plan, PLAN_PROMPT, PLAN_SCHEMA, planned, readPlan, Src } from "./cmaplan.ts";
import { projectPlan, verticalShares } from "./cmaproj.ts";
import { docxText } from "../docxtext.ts";
import { blocksText } from "../docxtext.ts";
// deno-lint-ignore no-explicit-any
const FSX: any = (globalThis as any).FSX;

const rs = (v: number | null | undefined) => v == null || !isFinite(v) ? "-" : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(v));
const TO_GIVE = "[To be given by you]";

// ---------------------------------------------------------------- the user's inputs, read and bounded
export type CmaIn = { loanType: "working_capital" | "term_loan" | "both" | null, wcLimit: number | null, tlAmount: number | null, tlYears: number | null, moratorium: number | null,
  existingRepay: number[] | null, method: "I" | "II", years: number, yearsSaid: boolean, stockMargin: number, recMargin: number, A: Assume, said: string[], text: string };
const nOf = (v: unknown, lo: number, hi: number) => { const x = numOf(v); return x == null ? null : Math.max(lo, Math.min(hi, x)); };
export function cleanIn(inp: Record<string, unknown>): CmaIn {
  const said: string[] = [];
  const lt = String(inp.loan_type || "").toLowerCase();
  const loanType = /both/.test(lt) ? "both" : /term/.test(lt) ? "term_loan" : /work|cc|cash|od|over/.test(lt) ? "working_capital" : null;
  const arr = (v: unknown) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map((x) => numOf(x)).filter((x): x is number => x != null && x >= 0).slice(0, 5);
  const er = arr(inp.existing_repayment);
  const m = String(inp.method || "").toUpperCase().replace(/[^IV12]/g, "");
  const years = nOf(inp.years, 1, 5);
  const sm = nOf(inp.stock_margin_pct, 0, 90), rm = nOf(inp.receivable_margin_pct, 0, 90);
  const A0 = (inp.assumptions && typeof inp.assumptions === "object" ? inp.assumptions : {}) as Assume;
  return { loanType, wcLimit: nOf(inp.working_capital_limit, 0, 1e12), tlAmount: nOf(inp.term_loan_amount, 0, 1e12), tlYears: nOf(inp.term_loan_years, 0.5, 30), moratorium: nOf(inp.moratorium_months, 0, 60),
    existingRepay: er.length ? er : null, method: m === "I" || m === "1" ? "I" : "II", years: years == null ? 2 : Math.round(years), yearsSaid: years != null, stockMargin: sm == null ? 0.25 : sm / 100, recMargin: rm == null ? 0.25 : rm / 100, A: A0, said,
    text: String(inp.projection_text || "").slice(0, 40000) };
}
// a new term loan's repayment in each projected year: drawn at the start of the first, monthly instalments after the
// moratorium over the rest of its tenure
export function tlSchedule(amount: number, years: number, moratorium: number, n: number): number[] {
  const months = Math.round(years * 12), inst = months - moratorium > 0 ? amount / (months - moratorium) : 0;
  return Array.from({ length: n }, (_, i) => { let k = 0; for (let mth = 12 * i; mth < 12 * i + 12; mth++) if (mth >= moratorium && mth < months) k++; return inst * k; });
}

// ---------------------------------------------------------------- the files of this chat to read
type Cand = { path: string, name: string, type: string, kind: string, summary: string };
const STMT_WORDS = /balance\s*sheet|\bbs\b|financial\s+statements?|final\s+accounts|audited|schedule\s*(iii|3)|\bcma\b|credit\s+monitoring|operating\s+statement|p\s*&\s*l|profit\s*(and|&)\s*loss/i;
// the uploads of this chat (the panel's list) in the client's own folder; the thread's files give their kinds and summaries
export function candidates(ctx: Pick<ExtCtx, "uploads" | "files" | "clientId">): Cand[] {
  const folder = [String(ctx.clientId || ""), String(ctx.clientId || "").replace(/[^A-Za-z0-9_-]/g, "_")];
  const all = new Map<string, Cand>(), up = new Set((ctx.uploads || []).map((u) => u.path));
  for (const f of [...(ctx.files || []).filter((x) => up.has(x.path)), ...(ctx.uploads || [])] as any[]) {
    const p = String(f && f.path || ""), seg = p.split("/");
    if (seg.length !== 4 || seg[2] !== "uploads" || !folder.includes(seg[1]) || p.includes("..")) continue;
    const prev = all.get(p);
    all.set(p, { path: p, name: String(f.name || prev?.name || seg[3]), type: String(f.type || prev?.type || ""), kind: String(f.kind || prev?.kind || ""), summary: String(f.summary || prev?.summary || "") });
  }
  return [...all.values()].filter((f) => f.kind !== "notice" && /\.(xlsx|xlsm|csv|xls|pdf|png|jpe?g|docx)$/i.test(f.name)).reverse().slice(0, 10);
}
const looksStatement = (f: Cand) => f.kind === "cma" || f.kind === "balance_sheet" || STMT_WORDS.test(f.name + " " + f.summary);
// a Word file (a road map, a projection note): its text and tables, read here, for the projections (cmaplan.ts)
export type RDoc = { name: string, path: string, text: string };
async function readFiles(ctx: ExtCtx, notes: string[], docs: RDoc[] = []): Promise<RFile[]> {
  const out: RFile[] = [];
  let pdfs = 0;
  const seen = new Set<string>();
  // only this same user's own uploads (earlier.ts's rule: another member's file is never pulled into a turn)
  const cs = candidates(ctx), own = ctx.ownFiles ? new Set(await ctx.ownFiles(cs.map((f) => f.path)).catch(() => [] as string[])) : null;
  for (const f of cs) {
    if (own && !own.has(f.path)) { if (looksStatement(f)) notes.push(f.name + ": not read (uploaded by another member of the firm)."); continue; }
    const hint: FileKind | "" = f.kind === "cma" ? "cma" : f.kind === "balance_sheet" ? "balance_sheet" : /\bcma\b|credit\s+monitoring/i.test(f.name) ? "cma" : "";
    if (/\.xls$/i.test(f.name)) { if (looksStatement(f)) notes.push(f.name + ": an old .xls workbook FinCom cannot open; save it as .xlsx and upload it again."); continue; }
    const pdf = /\.(pdf|png|jpe?g)$/i.test(f.name);
    if (pdf && (!looksStatement(f) || pdfs >= 2 || !ctx.aiRead)) { if (looksStatement(f) && pdfs >= 2) notes.push(f.name + ": not read (two PDFs a CMA at most)."); continue; }
    const isDoc = /\.docx$/i.test(f.name);
    if (isDoc && docs.length >= 3) continue;
    const bytes = ctx.readFile ? await ctx.readFile(f.path).catch(() => null) : null;
    if (!bytes) { if (looksStatement(f) || isDoc) notes.push(f.name + ": could not be read from the firm's folder."); continue; }
    // the same file uploaded again in the chat: read once
    const h = await sha256(bytes);
    if (seen.has(h)) continue;
    seen.add(h);
    if (isDoc) {
      const d = await docxText(bytes).catch(() => null);
      if (!d) notes.push(f.name + ": the Word file could not be opened (not a .docx?); paste its projections in the chat.");
      else docs.push({ name: f.name, path: f.path, text: blocksText(d.blocks).slice(0, 60000) });
      continue;
    }
    // read once: the reading kept by the file's own bytes (its hash) and path, so a follow-up never pays the AI again
    const key = "cma-read-" + READ_VERSION + "-" + h + "-" + (await sha256(new TextEncoder().encode(f.path + "|" + hint))).slice(0, 16);
    const kept = ctx.memo ? await ctx.memo.get(key).catch(() => null) : null;
    if (kept && Array.isArray(kept.years)) { out.push({ ...(kept as RFile), name: f.name, path: f.path }); if (pdf) pdfs++; continue; }
    const keep = async (r: RFile) => { if (ctx.memo && r.years.length) await ctx.memo.set(key, r).catch(() => {}); };
    if (pdf) {
      pdfs++;
      ctx.progress("Reading " + f.name + " (AI)");
      const type = /\.pdf$/i.test(f.name) ? "application/pdf" : /\.png$/i.test(f.name) ? "image/png" : "image/jpeg";
      const txt = await ctx.aiRead!(READ_PROMPT, { bytes, type }, { schema: READ_SCHEMA, feature: "cma", maxTokens: 6000 }).catch(() => "");
      const r = readAi(f.name, f.path, txt);
      if (hint) r.kind = hint;
      out.push(r);
      await keep(r);
      continue;
    }
    let grids;
    try { grids = /\.csv$/i.test(f.name) ? gridsFromCsv(new TextDecoder().decode(bytes)) : await gridsFromXlsx(bytes); } catch { notes.push(f.name + ": the workbook could not be opened."); continue; }
    const r = readGrids(f.name, f.path, grids, hint);
    if (r.years.length || looksStatement(f)) { out.push(r); await keep(r); }
  }
  return out;
}

// the readings kept (ctx.memo) are keyed by this: change it when what a reading holds changes
export const READ_VERSION = "v3";
const sha256 = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b as unknown as ArrayBuffer)), (x) => x.toString(16).padStart(2, "0")).join("");

// the books' short-term borrowings told apart by their ledgers (FSX's model.L: name, groups, line): current maturities of
// long-term debt, loans from directors, partners or related parties (or under Unsecured Loans), bank OD / CC; the rest is
// counted as bank borrowing and listed
export function booksSplit(L: any[], col: "cy" | "py"): { cm: number, stbo: number, unknown: { name: string, amt: number }[] } {
  const out = { cm: 0, stbo: 0, unknown: [] as { name: string, amt: number }[] };
  for (const x of L || []) {
    if (!x || x.line !== "stb") continue;
    const amt = -(Number(x[col]) || 0) / 100;        // paise, a credit negative: the borrowing as a positive figure
    if (!amt) continue;
    const words = String(x.l || "") + " | " + (x.g || []).join(" | ");
    if (/current\s+maturit|cmltd|instal+ments?\s+(due|of|on)|term\s+loans?\s+.*\bdue\b/i.test(words)) out.cm += amt;
    else if (/director|partner|promoter|related|relative|shareholder|proprietor|unsecured\s+loans?/i.test(words)) out.stbo += amt;
    else if (/\bbank\s+od\b|\bod\b|\bcc\b|cash\s+credit|overdraft|bank\s+o\/?d|working\s+capital|packing\s+credit|bills?\s+discount/i.test(words)) { /* bank: stays */ }
    else out.unknown.push({ name: String(x.l || ""), amt });
  }
  return out;
}
const applySplit = (l: Lines, sp: { cm: number, stbo: number }) => {
  const stb = l.stb || 0, cm = Math.max(0, Math.min(sp.cm, stb)), ot = Math.max(0, Math.min(sp.stbo, stb - cm));
  l.stb = stb - cm - ot; if (cm) l.cm = (l.cm || 0) + cm; if (ot) l.stbo = (l.stbo || 0) + ot;
};

// ---------------------------------------------------------------- the books: the last complete years and the year now running
type BookYears = { past: CYear[], cur: CYear | null, kind: string, warnings: string[], notes: string[], todate?: { l: Lines, asOn: string | null, months: number } | null };
async function fromBooks(ctx: ExtCtx, open: number): Promise<BookYears> {
  const out: BookYears = { past: [], cur: null, kind: "", warnings: [], notes: [], todate: null };
  const split = (fy: number, l: Lines, L: any[], col: "cy" | "py") => {
    const sp = booksSplit(L, col);
    applySplit(l, sp);
    const unk = sp.unknown.reduce((t, u) => t + u.amt, 0);
    if (unk > 1) out.notes.push(fyL(fy) + " (books): short-term borrowings of " + rs(unk) + " in " + sp.unknown.slice(0, 4).map((u) => u.name + " " + rs(u.amt)).join(", ") + (sp.unknown.length > 4 ? ", …" : "") + " could not be told apart by their ledgers: counted as bank borrowings for working capital.");
    return l;
  };
  let from: string | null = null, to: string | null = null, known = false;
  try {
    const b = await ctx.rpc("asst_books", {});
    const rows = (b && !b.none && Array.isArray(b.rows) ? b.rows : []) as any[];
    const fs = rows.map((r) => String(r.from || "")).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort(), ts = rows.map((r) => String(r.to || "")).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
    if (fs.length && ts.length) { from = fs[0].slice(0, 10); to = ts[ts.length - 1].slice(0, 10); known = true; }
  } catch (_e) { /* not known */ }
  const months = (y: number) => (known ? monthsIn(y, from, to) ?? 0 : 0);
  const say = (fy: number, run: any) => {
    const unplaced = (run.model.unplaced || []) as string[], fails = (run.fails || []) as any[];
    if (unplaced.length) out.warnings.push(fyL(fy) + " (books): " + unplaced.length + " ledger" + (unplaced.length > 1 ? "s" : "") + " not placed in the statements (" + unplaced.slice(0, 3).join(", ") + (unplaced.length > 3 ? ", …" : "") + "); place them on the Reports screen.");
    if (fails.length) out.warnings.push(fyL(fy) + " (books): " + fails.length + " of the statements' checks fail (" + fails.slice(0, 2).map((c: any) => c.title).join("; ") + ").");
  };
  if (!known) return out;
  if (months(open - 1) === 12) {
    try {
      const g = await inputFor(ctx, String(open - 1));
      if (!("error" in g)) {
        const run = FSX.run(g.inp), nm = run.model.nm;
        out.kind = String(g.inp.entity.kind || "");
        out.past.push({ fy: open - 1, kind: "actual", src: "books", l: split(open - 1, linesOf(nm, "CY"), run.model.L, "cy") });
        const py = linesOf(nm, "PY");
        if (months(open - 2) === 12 && Object.values(py).some((v) => v)) out.past.unshift({ fy: open - 2, kind: "actual", src: "books", l: split(open - 2, py, run.model.L, "py") });
        say(open - 1, run);
      }
    } catch (_e) { out.warnings.push(fyL(open - 1) + ": the books' statements could not be worked out."); }
  }
  const m = months(open);
  if (m >= 1) {
    try {
      const g = await inputFor(ctx, String(open));
      if (!("error" in g)) {
        const run = FSX.run(g.inp), l = split(open, linesOf(run.model.nm, "CY"), run.model.L, "cy");
        out.kind = out.kind || String(g.inp.entity.kind || "");
        const asOn = to && to < (open + 1) + "-03-31" ? to : null;
        out.todate = { l: { ...l }, asOn, months: m };
        out.cur = yearEnd(l, m, asOn, open, out.kind);
        say(open, run);
      }
    } catch (_e) { out.warnings.push(fyL(open) + ": the books to date could not be worked out."); }
  }
  return out;
}

// the year now running, to 31 March (the reviewer's choice of 14-Nov-2026): the profit and loss annualised from the books
// to date (x 12/months), and the balance sheet carried to the year end from the books' own balances on the last entry:
// the rest of the year's profit added to the net worth (no drawings or dividend), the rest of the year's depreciation taken
// off the fixed assets, and the two through cash and bank (a shortfall shown as bank borrowing). Nothing else is invented.
export function yearEnd(l0: Lines, m: number, asOn: string | null, fy: number, kind: string): CYear {
  const l: Lines = { ...l0 };
  const pat0 = pbtLines(l0) - (l0.tax || 0), dep0 = l0.dep || 0;
  // every line annualised but the change in stock: the closing stock is taken at the same holding period as to date (the
  // stock on the last entry), so the year's change in stock is the change to date
  for (const k of PLK) l[k] = k === "chg" ? (l0.chg || 0) : (l0[k] || 0) * 12 / m;
  const dPat = pbtLines(l) - (l.tax || 0) - pat0, dDep = Math.min((l.dep || 0) - dep0, Math.max(0, (l.ppe || 0)));
  const toCap = kind !== "company" && !(l.share || 0) ? ((l.current || 0) ? "current" : "capital") : "reserves";
  l[toCap] = (l[toCap] || 0) + dPat;
  l.ppe = (l.ppe || 0) - dDep;
  let cash = (l.cash || 0) + dPat + dDep;
  if (cash < 0) { l.stb = (l.stb || 0) - cash; cash = 0; }
  l.cash = cash;
  return { fy, kind: "estimate", src: "books to " + (asOn || "31-03-" + (fy + 1)) + " (" + m + " month" + (m > 1 ? "s" : "") + "): profit and loss annualised x 12/" + m + "; balance sheet carried to 31-03-" + (fy + 1), l, asOn: null, months: m };
}

// why the CMA is a DRAFT (none: final): failing checks, file totals that do not tie, the books' statements needing attention
export function draftWhy(fails: number, ties: number, books: number): string[] {
  return [...(fails ? [fails + " check" + (fails > 1 ? "s fail" : " fails")] : []), ...(ties ? [ties + " file total" + (ties > 1 ? "s do" : " does") + " not tie"] : []),
    ...(books ? ["the books' statements need attention (" + books + ": unplaced ledgers or failing checks)"] : [])];
}

// ---------------------------------------------------------------- the tool
const strict = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const NUM = (d: string) => ({ type: ["number", "string", "null"], description: d });
const ARR = (d: string) => ({ type: ["array", "null"], items: { type: ["number", "string"] }, description: d });
const STR = (d: string) => ({ type: ["string", "null"], description: d });
export const INPUT_SCHEMA = strict({
  loan_type: STR("working_capital (cash credit / overdraft), term_loan, or both; null when the user has not said"),
  working_capital_limit: NUM("the working capital limit sought, rupees (null: not said)"),
  term_loan_amount: NUM("the term loan sought, rupees (null: not said)"),
  term_loan_years: NUM("the term loan's tenure in years, incl. the moratorium (null: not said)"),
  moratorium_months: NUM("the term loan's moratorium in months (null: none said)"),
  existing_repayment: ARR("the existing term loans' repayment in each projected year, rupees (null: not said)"),
  method: STR("II (Nayak/Tandon second method, the default) or I"),
  years: NUM("projected years after the year now running, 1 to 5 (null: 2, or to the last year the user's projections name)"),
  projection_text: STR("the user's own words and pasted tables about the projections (revenue, growth, margins, EBITDA, depreciation, interest, tax, verticals), verbatim; null when none"),
  stock_margin_pct: NUM("the bank's margin on stock for drawing power, % (null: 25)"),
  receivable_margin_pct: NUM("the bank's margin on receivables, % (null: 25)"),
  assumptions: strict({ revenue_growth_pct: ARR("revenue growth % for each projected year"), capex: ARR("new fixed assets each projected year, rupees"), dividend_or_drawings: ARR("each projected year, rupees"),
    receivable_days: NUM("debtors' days"), inventory_days: NUM("stock days"), payable_days: NUM("creditors' days"), tax_rate_pct: NUM("tax rate %"),
    other_assumptions: { type: ["array", "null"], items: { type: "string" }, description: "anything else the user said, as given" } }),
});

export async function runCma(input: Record<string, unknown>, ctx: ExtCtx): Promise<ExtResult> {
  const I = cleanIn(input || {});
  const open = Number(fyOf(null, ctx.today)) + 1;
  const notes: string[] = [];
  ctx.progress("Reading the balance sheets and the earlier CMA");
  const docs: RDoc[] = [];
  const files = await readFiles(ctx, notes, docs);
  for (const f of files) notes.push(...f.notes);
  // the user's own projections: their words since the CMA was asked (pasted tables too), the Word files, an Excel's
  // assumptions or projections sheet (cmaplan.ts: the rules, then the AI into a strict schema, every figure checked)
  const srcs: Src[] = [...(I.text.trim() ? [{ name: "your message", text: I.text }] : []), ...docs.map((d) => ({ name: d.name, text: d.text }))];
  let plan: Plan = emptyPlan();
  if (srcs.length) {
    ctx.progress("Reading your projections");
    plan = await readPlan(srcs, ctx.aiRead ? async (prompt, fenced, raw) => {
      // read once: the AI's reading kept by the text's own hash (not the fence's nonce), so a follow-up never pays again
      const key = "cma-plan-" + READ_VERSION + "-" + (await sha256(new TextEncoder().encode(PLAN_PROMPT + "\n" + raw))).slice(0, 40);
      const kept = ctx.memo ? await ctx.memo.get(key).catch(() => null) : null;
      if (kept && typeof kept.answer === "string") return kept.answer;
      const answer = await ctx.aiRead!(prompt + "\n\n" + fenced, null, { schema: PLAN_SCHEMA, feature: "cma", maxTokens: 4000 }).catch(() => "");
      if (answer && ctx.memo) await ctx.memo.set(key, { answer }).catch(() => {});
      return answer;
    } : null);
  }
  const hasPlan = planned(plan), planFys = Object.keys(plan.years).map(Number).sort((a, b) => a - b);
  ctx.progress("Reading the books");
  const B = await fromBooks(ctx, open);
  notes.push(...B.notes);
  const P = pastYears(files, B.past, B.cur ? B.cur.fy : open, notes);
  const past = P.years.slice(-3);
  let cur = B.cur;
  // the user's figures for the year now running: it is projected from the latest audited (or provisional) year on them,
  // not estimated from the books to date (a road map's "FY 2026-27 (base)" revenue)
  const lastKnown = past.length ? past[past.length - 1] : null;
  if (cur && hasPlan && lastKnown && lastKnown.fy >= cur.fy - 1 && planFys.some((fy) => fy <= cur!.fy)) {
    notes.push("The books to date for " + fyL(cur.fy) + " are not used for the forms: you gave the figures for that year, so it is projected from " + fyL(lastKnown.fy) + " (" + KIND_WORD[lastKnown.kind].toLowerCase() + ") on them.");
    cur = null;
  }
  if (!past.length && !cur) return { error: "No figures for " + (ctx.clientName || "this client") + ": upload its last balance sheets (Excel or PDF) or the earlier CMA here, or link its Tally company; then ask again." };
  if (cur) P.sources.push([fyL(cur.fy), "Estimate", cur.src]);
  const kind = B.kind || (past.length && (sumOf(past[past.length - 1].l, ["share"]) > 0) ? "company" : past.length && sumOf(past[past.length - 1].l, ["capital", "current"]) > 0 ? "firm" : "company");
  // the projections, from the latest year (the estimate when the books run into this year)
  const base = cur || past[past.length - 1], prevY = [...past].reverse().find((y) => y.fy < base.fy) || null;
  // the years to the running one, then the years asked; with the user's own projections, to the last year they name (at most
  // five after the year now running)
  let n = Math.min(5, I.years + (cur ? 0 : Math.max(0, open - base.fy)));
  const lastNamed = Math.max(hasPlan ? planFys[planFys.length - 1] : 0, plan.lastFy ?? 0);
  if (lastNamed > base.fy) n = Math.max(lastNamed - base.fy, I.yearsSaid ? n : 0);
  const nMax = Math.max(1, open + 5 - base.fy);
  if (n > nMax) { notes.push("Projections run to " + fyL(base.fy + nMax) + " (five years after the year now running); the years after it are left out."); n = nMax; }
  n = Math.max(1, n);
  const early = planFys.filter((fy) => fy <= base.fy);
  if (hasPlan && early.length) notes.push("Your figures for " + early.map(fyL).join(", ") + " are not used: " + (early.length > 1 ? "those years are" : "that year is") + " in the accounts (" + fyL(base.fy) + " is the base).");
  const tlNew = I.loanType !== "working_capital" && I.tlAmount ? I.tlAmount : 0;
  const sched = tlNew && I.tlYears ? tlSchedule(tlNew, I.tlYears, I.moratorium || 0, n) : null;
  const exist = sumOf(base.l, ["ltb", "cm"]) > 0;
  // the existing term loans' instalments: as the user gave them, else the current maturities shown a year earlier (the
  // instalments due in the year), stated
  const cmProxy = !I.existingRepay && (base.l.cm || 0) > 0 ? base.l.cm : null;
  const existRepay = I.existingRepay ?? (cmProxy ? [cmProxy] : null);
  const repay = Array.from({ length: n }, (_, i) => (sched ? sched[i] : 0) + (existRepay ? existRepay[Math.min(i, existRepay.length - 1)] : 0));
  const A: Assume = { years: n, revenue_growth_pct: I.A.revenue_growth_pct ?? null, capex: I.A.capex ?? (tlNew ? [tlNew, 0] : null), new_loans: tlNew ? [tlNew, 0] : null,
    loan_repayment: repay.some((x) => x > 0) ? repay : null, dividend_or_drawings: I.A.dividend_or_drawings ?? null, receivable_days: I.A.receivable_days ?? null, inventory_days: I.A.inventory_days ?? null,
    payable_days: I.A.payable_days ?? null, tax_rate_pct: I.A.tax_rate_pct ?? (plan.taxRate ?? null), other_assumptions: I.A.other_assumptions ?? null, material_cost_pct: null, employee_cost_pct: null, other_expenses_pct: null };
  const divs = Array.isArray(I.A.dividend_or_drawings) ? (I.A.dividend_or_drawings as unknown[]).map((x) => numOf(x) || 0) : null;
  let projL: Lines[], projSaid: string[], projWarn: string[] = [], planDiffs: string[] = [];
  if (hasPlan) {
    const fys = Array.from({ length: n }, (_, i) => base.fy + 1 + i);
    const nums = (v: unknown) => Array.isArray(v) ? (v as unknown[]).map((x) => numOf(x) || 0) : v == null ? null : [numOf(v) || 0];
    // the user's figures always win: a growth or a tax rate said in words or passed to the tool ("sales growth 20% a year",
    // "tax 25%") fills every year the plan gives no revenue or growth (no rate) for
    const gArr = Array.isArray(I.A.revenue_growth_pct) || I.A.revenue_growth_pct != null ? nums(I.A.revenue_growth_pct)!.filter((x) => isFinite(x)) : null;
    if (gArr && gArr.length) fys.forEach((fy, i) => { const y = plan.years[fy] ||= {}; if (y.rev == null && y.growth == null) y.growth = Math.max(-50, Math.min(200, gArr[Math.min(i, gArr.length - 1)])); });
    const tArg = numOf(I.A.tax_rate_pct);
    if (tArg != null && tArg >= 0 && tArg < 60 && plan.taxRate == null && !fys.some((fy) => plan.years[fy]?.taxRate != null)) plan.taxRate = tArg;
    const pp = projectPlan(base, prevY, fys, plan, { kind, newLoans: tlNew ? [tlNew, 0] : null, repay: repay.some((x) => x > 0) ? repay : null, capex: nums(I.A.capex) ?? (tlNew ? [tlNew, 0] : null), div: divs,
      trDays: numOf(I.A.receivable_days), invDays: numOf(I.A.inventory_days), tpDays: numOf(I.A.payable_days) });
    projL = pp.lines; projSaid = pp.said; planDiffs = pp.diffs;
  } else {
    // project() knows Schedule III's lines only: the borrowings from others and the current maturities ride in other current
    // liabilities through it and are put back as they were at the base year's end
    const fold = { stbo: base.l.stbo || 0, cm: base.l.cm || 0 };
    const baseP: Lines = { ...base.l, ocl: (base.l.ocl || 0) + fold.stbo + fold.cm, stbo: 0, cm: 0 };
    const p = project(baseP, prevY ? prevY.l : null, { fy: base.fy, months: 12, kind, warnings: [], ytd: null }, base.fy, A);
    for (const y of p.years) { y.l.ocl = (y.l.ocl || 0) - fold.stbo - fold.cm; y.l.stbo = fold.stbo; y.l.cm = fold.cm; }
    projL = p.years.map((y) => y.l); projSaid = p.assumptions; projWarn = p.warnings;
  }
  const proj: CYear[] = projL.map((l, i) => ({ fy: base.fy + 1 + i, kind: base.fy + 1 + i <= open ? "estimate" : "projected", src: "projected by FinCom from " + fyL(base.fy) + (hasPlan ? " on your figures (" + plan.from.join(", ") + ")" : "") + " and the assumptions listed", l,
    div: divs ? divs[Math.min(i, divs.length - 1)] : 0, repay: (exist && !existRepay) || (tlNew && !sched) ? null : repay[i] }));
  // the past years and the estimate: the instalments due in the year are the current maturities shown a year earlier
  const known = [...past, ...(cur ? [cur] : [])];
  known.forEach((y, i) => { if (y.repay == null && i > 0 && (known[i - 1].l.cm || 0) > 0) y.repay = known[i - 1].l.cm; });
  const years: CYear[] = [...known, ...proj];
  const inForms = new Set(years.map((y) => fyL(y.fy)));
  P.sources = [P.sources[0], ...P.sources.slice(1).filter((r) => inForms.has(r[0]))];
  P.diffs = P.diffs.filter((d) => inForms.has(String(d[0])));
  for (const y of proj) P.sources.push([fyL(y.fy), KIND_WORD[y.kind], y.src]);
  const opts: Opts = { method: I.method, stockMargin: I.stockMargin, recMargin: I.recMargin, limit: I.loanType === "term_loan" ? null : I.wcLimit };
  const c = cmaCompute(years, opts);

  // what is still needed (asked once, at the end; Form I keeps a placeholder)
  const need: string[] = [];
  if (!I.loanType) need.push("the type of loan (working capital / term loan) and the amount sought");
  else {
    if (I.loanType !== "term_loan" && I.wcLimit == null) need.push("the working capital limit sought");
    if (I.loanType !== "working_capital" && I.tlAmount == null) need.push("the term loan amount sought");
  }
  if (tlNew && !sched) need.push("the term loan's repayment schedule (tenure and moratorium)");
  if (exist && !existRepay) need.push("the repayment schedule of the existing term loans (" + rs(sumOf(base.l, ["ltb"])) + ")");
  const negTnw = c.years.filter((_y, i) => (rowOf(c, "III", "tnw").vals[i] ?? 0) < 0).map((y) => fyL(y.fy));
  // the assumptions, all of them
  // a file's own estimates are not used, nor its years outside the forms
  const usedTie = (f: RFile, t: { year: string }) => !/\((estimated|projected)\)/.test(t.year) && past.some((y) => fyL(y.fy) === t.year.slice(0, 7) && y.src.includes(f.name));
  const fails = c.checks.filter((x) => !x.ok), tiesBad = files.flatMap((f) => f.ties.filter((t) => !t.ok && usedTie(f, t)).map((t) => ({ f: f.name, ...t })));
  // the projections summary: the years after the accounts, in the user's own layout (A, B, C)
  const sumCols = c.years.map((y, i) => (lastKnown == null || y.fy > lastKnown.fy ? i : -1)).filter((i) => i >= 0);
  const plFys = planFys.filter((fy) => { const y = plan.years[fy]; return ["gp", "gm", "ebitda", "em", "dep", "fin", "pbt", "tax", "pat"].some((k) => (y as Record<string, unknown>)[k] != null); });
  const bCols = plFys.length ? sumCols.filter((i) => c.years[i].fy >= plFys[0]) : sumCols;
  const salesAt = (fy: number) => { const i = c.years.findIndex((y) => y.fy === fy); return i < 0 ? 0 : rowOf(c, "II", "sales").vals[i] || 0; };
  const vs = verticalShares(plan, sumCols.map((i) => c.years[i].fy), salesAt);
  const summary: Summary = { cols: sumCols, bCols: bCols.length ? bCols : sumCols, verts: vs.map((v) => ({ name: v.name, share: v.share })), notes: vs.notes || [] };
  const assumptions = [
    ...B.warnings.map((w) => "Check the books: " + w),
    "Format: the standard CMA (Forms I to VI and the key ratios), not one bank's own. Past years from the sources listed in Sources; where an audited balance sheet and the earlier CMA give the same year, the audited figures are used and every difference is listed.",
    ...(cur ? ["The year now running (" + fyL(cur.fy) + ") is an estimate from the books to " + (B.todate?.asOn || "the last entry") + ": the profit and loss annualised (x 12/" + cur.months + ") but for the change in stock: the closing stock at 31 March is taken at the same holding period as to date (the stock on the last entry), so the change in stock is the books' to date; the balance sheet carried to 31 March from the books' balances, the rest of the year's profit added to the net worth (no drawings or dividend) and the rest of the year's depreciation taken off the fixed assets, both through cash and bank."] : []),
    ...(negTnw.length ? ["Net worth negative (tangible net worth below nil) in " + negTnw.join(", ") + ": TOL/TNW and debt/equity are not meaningful there and are left blank."] : []),
    "MPBF by Method " + I.method + (I.method === "II" ? " (the second method: 25% of the current assets from long-term funds), FinCom's default" : " (the first method: 25% of the working capital gap from long-term funds), as you said") + "; the other method is shown for comparison. Export receivables are taken as nil.",
    "Drawing power: paid stock (inventory less trade creditors) less a " + Math.round(I.stockMargin * 100) + "% margin, and receivables less a " + Math.round(I.recMargin * 100) + "% margin" + (input.stock_margin_pct == null && input.receivable_margin_pct == null ? " (FinCom's defaults)." : "."),
    "Form II: Schedule III does not split other expenses, so all are under selling, general and administrative expenses; employee costs and depreciation are under cost of sales. Short-term borrowings are split into bank borrowings, borrowings from directors and related parties, and current maturities of term loans (shown with the other current liabilities), from the lines, the notes or the books' ledgers; any amount that could not be told apart is counted as bank borrowing and listed below.",
    "Interest on term loans (for the DSCR) is the finance costs in proportion to the term loans' share of the borrowings; the DSCR is shown for the years whose repayment is known" + (cmProxy ? "; with no repayment schedule given, each year's instalments are taken as the current maturities of the year before (" + rs(cmProxy) + " a year in the projections)." : "."),
    "Debt / equity: term loans with their instalments due within a year over the tangible net worth; deferred tax and long-term provisions are left out.",
    ...(tlNew ? ["Term loan of " + rs(tlNew) + " taken at the start of " + fyL(proj[0]?.fy || open) + (I.A.capex == null ? " and spent on fixed assets in that year (tell me the project cost to change it)" : "") + (sched ? "; repaid in monthly instalments over " + I.tlYears + " years" + (I.moratorium ? " after a " + I.moratorium + "-month moratorium" : "") + "." : "; its repayment schedule is not known yet.")] : []),
    ...(hasPlan || plan.verticals.length ? ["Your projections were read from " + plan.from.join(", ") + (plan.byAi.length ? "; read by the AI (check them): " + plan.byAi.slice(0, 12).join(", ") + (plan.byAi.length > 12 ? ", …" : "") : "") + "."] : []),
    ...planDiffs.map((d) => "Your figures differ: " + d), ...plan.notes, ...(summary.notes || []),
    ...projSaid, ...projWarn.map((w) => "Check: " + w), ...notes, ...I.said,
  ];
  // the books' own statements failing a check or with ledgers not placed: the CMA built on them is a draft too
  const fromBooksUsed = !!cur || past.some((y) => /^books/.test(y.src));
  const why = draftWhy(fails.length, tiesBad.length, fromBooksUsed ? B.warnings.length : 0);
  const status = !why.length ? "All " + c.checks.length + " checks pass." : "DRAFT, NOT FINAL: " + why.join("; ") + " (see Checks and Assumptions).";
  const lastPast = past[past.length - 1] || cur!;
  const form1: [string, string][] = [
    ["Name of the borrower", ctx.clientName || ""], ["Constitution", ({ company: "Company", llp: "Limited liability partnership", firm: "Partnership firm", proprietor: "Proprietorship" } as Record<string, string>)[kind] || kind],
    ["Facility sought", I.loanType === "both" ? "Working capital and term loan" : I.loanType === "term_loan" ? "Term loan" : I.loanType === "working_capital" ? "Working capital (cash credit / overdraft)" : TO_GIVE],
    ["Working capital limit sought", I.loanType === "term_loan" ? "Not sought" : I.wcLimit != null ? rs(I.wcLimit) : TO_GIVE],
    ["Term loan sought", I.loanType === "working_capital" ? "Not sought" : I.tlAmount != null ? rs(I.tlAmount) : TO_GIVE],
    ["Term-loan repayment schedule", I.loanType === "working_capital" && !exist ? "Not applicable" : sched ? I.tlYears + " years" + (I.moratorium ? " incl. " + I.moratorium + " months' moratorium" : "") + ", monthly instalments" : TO_GIVE],
    ["Existing term loans' repayment", !exist ? "None in the balance sheet" : I.existingRepay ? I.existingRepay.map(rs).join(", ") + " a year" : TO_GIVE],
    ["Existing bank borrowings for working capital (" + fyL(lastPast.fy) + ")", rs(sumOf(lastPast.l, ["stb"]))], ["Existing term loans (" + fyL(lastPast.fy) + ")", rs(sumOf(lastPast.l, ["ltb"]))],
    ["Years in the forms", c.labels.join("; ")], ["MPBF method", "Method " + I.method + (I.method === "II" ? " (default)" : "")], ["Status", status],
  ];
  const ties = files.flatMap((f) => f.ties.filter((t) => usedTie(f, t)).map((t) => [f.name + ", " + t.year + ": " + t.head, "", "", Math.round(t.file), Math.round(t.mapped), Math.round(t.gap)] as (string | number)[]));
  const meta: XlMeta = { client: ctx.clientName, firm: ctx.firm?.name || "", today: ctx.today, status, assumptions, form1, sources: P.sources, diffs: P.diffs, ties, summary };
  ctx.progress("Making the Excel");
  const xl = await cmaExcel(c, meta);
  const safe = String(ctx.clientName || "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client";
  const f = await ctx.uploadFile(xl, safe + "-CMA-" + fyL(c.years[0].fy) + "-to-" + fyL(c.years[c.years.length - 1].fy) + ".xlsx", "xlsx");
  const tables = tablesOf(c, meta, fails);
  const last = c.years.length - 1, mp = rowOf(c, "V", "mpbf").vals[last], alt = rowOf(c, "V", I.method === "II" ? "mpbf1" : "mpbf2").vals[last], gap = rowOf(c, "V", "dpgap").vals[last];
  const byAi = files.filter((x) => x.by === "ai" && x.years.length).map((x) => x.name);
  const line = cmaLine({ client: ctx.clientName, c, method: I.method, mp, alt, gap, status, fails: why.length, diffs: P.diffs.length, need, file: !!f, limit: opts.limit })
    + (negTnw.length ? " Net worth negative in " + negTnw.join(", ") + "." : "")
    + (byAi.length ? " The figures of " + byAi.join(", ") + " were read by the AI from the PDF: check them against the copy." : "")
    + (hasPlan ? " Projections " + fyL(base.fy + 1) + " to " + fyL(base.fy + n) + " on your figures (" + plan.from.join(", ") + ") from " + fyL(base.fy) + (planDiffs.length ? "; where your figures disagree the amounts are used (" + planDiffs.length + " difference" + (planDiffs.length > 1 ? "s" : "") + " in the Assumptions)" : "") + "; the Projections summary is first." : "");
  return { tables, files: f ? [f] : [], line,
    forModel: JSON.stringify({ shown: "CMA data (the projections summary, Forms I-VI, ratios, checks, assumptions) shown as tables" + (f ? " with the bank-format Excel" : ""), years: c.labels, status, mpbf_last_year: Math.round(mp || 0), method: I.method,
      drawing_power_gap_last_year: Math.round(gap || 0), dscr_average_projected: c.dscrAvg == null ? null : Math.round(c.dscrAvg * 100) / 100, differences_audited_vs_cma: P.diffs.length, still_needed: need,
      say: "Say plainly first if the checks fail (the figures are then a DRAFT). In three or four lines give what was prepared, the MPBF and the main ratios; ask only for still_needed; end with: Tell me any assumption to change and I'll redo it. Do not copy the tables." }) } as ExtResult;
}

export function cmaLine(o: { client: string, c: Cma, method: string, mp: number | null, alt: number | null, gap: number | null, status: string, fails: number, diffs: number, need: string[], file: boolean, limit: number | null }): string {
  const c = o.c, last = c.years[c.years.length - 1], out: string[] = [];
  if (o.fails) out.push(o.status + " The figures below are not final until the failing checks are cleared.");
  out.push("CMA data in the standard bank format for " + (o.client || "the client") + ": " + c.labels.join(", ") + ".");
  const cr = rowOf(c, "R", "cr").vals[c.years.length - 1];
  out.push("MPBF for " + fyL(last.fy) + " (Method " + o.method + "): " + rs(o.mp) + " (Method " + (o.method === "II" ? "I" : "II") + ": " + rs(o.alt) + "); drawing-power gap " + (o.gap != null && o.gap > 0 ? rs(o.gap) + " (the stock and receivables do not support " + (o.limit != null ? "the limit sought" : "the MPBF") + ")" : "nil (the drawing power is " + rs(o.gap == null ? null : -o.gap) + " more)") +
    "; current ratio " + (cr == null ? "-" : cr.toFixed(2)) + (c.dscrAvg != null ? "; average DSCR of the projected years " + c.dscrAvg.toFixed(2) : "") + ".");
  if (!o.fails) out.push(o.status);
  if (o.diffs) out.push("The audited figures are used where they differ from the earlier CMA or the books: " + o.diffs + " difference" + (o.diffs > 1 ? "s" : "") + " listed below.");
  if (o.need.length) out.push("Still needed (Form I shows them as placeholders): " + o.need.join("; ") + ".");
  out.push((o.file ? "The Excel below has live formulas, the Assumptions and the Checks. " : "") + "Tell me any assumption to change and I'll redo it.");
  return out.join(" ");
}

function tablesOf(c: Cma, meta: XlMeta, fails: Cma["checks"]): ToolTable[] {
  const n = c.years.length;
  const cols = [{ k: "item", label: "Particulars" }, ...c.years.map((_y, i) => ({ k: "y" + i, label: c.labels[i], t: "amount" as const }))];
  const per = { from: c.years[0].fy + "-04-01", to: (c.years[n - 1].fy + 1) + "-03-31" };
  const T = (title: string, rows: Record<string, unknown>[], columns: ToolTable["columns"] = cols): ToolTable => ({ tool: "cma_data", title, columns, rows, period: per, label: "cma",
    basis: "FinCom's CMA (standard format) from the files and books listed in Sources and the assumptions listed; " + meta.status });
  const out: ToolTable[] = [];
  if (meta.summary) out.push(...summaryTables(c, meta.summary).map((t) => T(t.title, t.rows, t.columns)));
  if (fails.length) out.push(T("Checks that fail (the figures are not final)", fails.map((x) => ({ n: x.n, item: x.label, year: x.year, gap: Math.round(x.gap) })), [{ k: "n", label: "No.", t: "int" }, { k: "item", label: "Check" }, { k: "year", label: "Year" }, { k: "gap", label: "Difference", t: "amount" }]));
  out.push(T("Form I: particulars", meta.form1.map(([k, v]) => ({ item: k, v })), [{ k: "item", label: "Particulars" }, { k: "v", label: "" }]));
  for (const s of c.sheets) out.push(T(s.name === "Ratios" ? "Key ratios" : s.name + ": " + s.title.replace(/^FORM [IVX]+ - /, "").toLowerCase().replace(/^./, (x) => x.toUpperCase()), s.rows.map((r) => rowCells(r, n))));
  if (meta.diffs.length) out.push(T("Differences: the figures used against the earlier CMA and the books", meta.diffs.map((d) => ({ year: d[0], item: d[1], used: d[2], other: d[3], gap: d[4], src: d[5] })),
    [{ k: "year", label: "Year" }, { k: "item", label: "Line" }, { k: "used", label: "Used", t: "amount" }, { k: "other", label: "Other", t: "amount" }, { k: "gap", label: "Difference", t: "amount" }, { k: "src", label: "Other source" }]));
  out.push(T("Sources", meta.sources.slice(1).map((r) => ({ year: r[0], kind: r[1], item: r[2] })), [{ k: "year", label: "Year" }, { k: "kind", label: "Kind" }, { k: "item", label: "Figures from" }]));
  out.push(T("Assumptions (tell me any to change and I'll redo it)", meta.assumptions.map((a, i) => ({ n: i + 1, item: a })), [{ k: "n", label: "No.", t: "int" }, { k: "item", label: "Assumption" }]));
  return out;
}

// the projections summary in the owner's layout (₹ crore, as the user writes them): A. revenue and its growth by year; B. the
// profitability (revenue, gross profit and margin, EBITDA and margin, depreciation, interest, PBT, tax, PAT); C. the revenue
// by business vertical. Every figure from the forms (Form II), so it agrees with them; the Excel writes the same as formulas.
// (half a paisa-crore up: 0.245 shows 0.25, not float's 0.24)
const crS = (v: number | null | undefined) => v == null || !isFinite(v) ? "" : (Math.round(v / 1e5 + Math.sign(v) * 1e-7) / 100).toFixed(2);
const pcS = (v: number | null | undefined) => v == null || !isFinite(v) ? "—" : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "") + "%";
export function summaryRows(c: Cma, i: number) {
  const v = (k: string) => rowOf(c, "II", k).vals[i] ?? 0;
  const rev = v("sales"), gp = rev - v("mat") - v("chg"), ebitda = v("opbi") + v("dep"), prev = i > 0 ? rowOf(c, "II", "sales").vals[i - 1] ?? 0 : 0;
  return { rev, growth: prev > 0 ? (rev / prev - 1) * 100 : null, gp, gm: rev ? gp / rev * 100 : null, ebitda, em: rev ? ebitda / rev * 100 : null, dep: v("dep"), int: v("int"), oth: v("oth") - v("nox"), pbt: v("pbt"), tax: v("tax"), pat: v("pat") };
}
export function summaryTables(c: Cma, s: Summary): { title: string, rows: Record<string, unknown>[], columns: ToolTable["columns"] }[] {
  const out: { title: string, rows: Record<string, unknown>[], columns: ToolTable["columns"] }[] = [];
  if (!s.cols.length) return out;
  const yl = (i: number) => "FY " + fyL(c.years[i].fy) + (c.years[i].kind === "estimate" ? " (estimate)" : "");
  out.push({ title: "Projections summary - A. Revenue growth (₹ crore)", columns: [{ k: "year", label: "Financial year" }, { k: "rev", label: "Revenue (₹ Cr)" }, { k: "g", label: "Annual growth" }],
    rows: s.cols.map((i) => { const r = summaryRows(c, i); return { year: yl(i), rev: crS(r.rev), g: pcS(r.growth) }; }) });
  const B = s.bCols.map((i) => summaryRows(c, i)), oth = B.some((r) => Math.abs(r.oth) >= 1);
  const line = (item: string, f: (r: ReturnType<typeof summaryRows>) => string) => ({ item, ...Object.fromEntries(B.map((r, k) => ["y" + k, f(r)])) });
  out.push({ title: "Projections summary - B. Profitability (₹ crore)", columns: [{ k: "item", label: "Particulars" }, ...s.bCols.map((i, k) => ({ k: "y" + k, label: "FY" + fyL(c.years[i].fy).slice(2) }))],
    rows: [line("Revenue", (r) => crS(r.rev)), line("Gross profit", (r) => crS(r.gp)), line("Gross margin", (r) => pcS(r.gm)), line("EBITDA", (r) => crS(r.ebitda)), line("EBITDA margin", (r) => pcS(r.em)),
      line("Depreciation", (r) => crS(r.dep)), line("Interest", (r) => crS(r.int)), ...(oth ? [line("Other income less exceptional items", (r) => crS(r.oth))] : []), line("Profit before tax", (r) => crS(r.pbt)),
      line("Tax", (r) => crS(r.tax)), line("Profit after tax", (r) => crS(r.pat))] });
  if (s.verts.length) {
    const cols = s.cols;
    out.push({ title: "Projections summary - C. Revenue by business vertical (₹ crore, share of revenue)", columns: [{ k: "item", label: "Business vertical" }, ...cols.map((i, k) => ({ k: "y" + k, label: "FY" + fyL(c.years[i].fy).slice(2) }))],
      rows: [...s.verts.map((v) => ({ item: v.name, ...Object.fromEntries(cols.map((i, k) => ["y" + k, crS(summaryRows(c, i).rev * v.share[k] / 100) + " (" + pcS(v.share[k]) + ")"])) })),
        { item: "Total revenue", ...Object.fromEntries(cols.map((i, k) => ["y" + k, crS(summaryRows(c, i).rev) + " (100%)"])) }] });
  }
  return out;
}

export const TOOLS: ExtTool[] = [{
  name: "cma_data",
  description: "Prepare CMA data for a bank (credit monitoring arrangement) for the client open, in the standard format: Form I particulars, Form II operating statement, Form III analysis of balance sheet, Form IV current assets and liabilities, Form V MPBF (Method II by default, Method I on request) with the drawing-power gap, Form VI fund flow, the ratios (current ratio, TOL/TNW, debt/equity, DSCR, interest cover, NWC), the checks and a bank-format Excel. FinCom reads the balance sheets and the earlier CMA uploaded in this conversation, a Word road map, the books to date for the year now running, and projects up to five years on the user's own figures (revenue or growth, gross and EBITDA margins, depreciation, interest, tax rate, verticals) or its defaults, with a projections summary. Call it at once for CMA, MPBF, Tandon or 'projections for the bank', or a change to the projections right after one; pass what the user said (projection_text: their words and pasted tables, verbatim) and null for the rest; never ask first.",
  input_schema: INPUT_SCHEMA,
  task: "heavy", label: "books",
  words: /\b(cma(\s+data)?|credit\s+monitoring|mpbf|maximum\s+permissible\s+bank\s+finance|tandon|nayak\s+committee|drawing\s+power)\b/i,
  run: runCma,
}];
