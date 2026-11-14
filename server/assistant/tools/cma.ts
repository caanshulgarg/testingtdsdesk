// CMA data for a bank (the owner, 14-Nov-2026): "Prepare CMA data" in Ask FinCom, in the STANDARD bank format (no one
// bank's own), acting first: it asks only for what it cannot know (the loan's type and amount, a term loan's repayment
// schedule) and makes everything else on stated defaults. One call:
//   1. Past years: the balance sheets and the earlier CMA uploaded in this chat (or earlier in it), read and checked
//      (cmaread.ts: Excel by FinCom, a PDF by the AI into a strict schema). Where an audited balance sheet and the
//      earlier CMA give a year, the audited figures are used and every difference is listed. With no file, the books'
//      last complete years (FSX, the Reports screen's Schedule III, as projection.ts reads them).
//   2. The year now running: the books to date (FSX's own sums), the P&L annualised, labelled "estimate".
//   3. Projections: 1-2 years by projection.ts's project() on its defaults and what the user said, every assumption listed.
//   4. The forms, the ratios and the checks (cmaengine.ts); a check that fails makes the whole a DRAFT, said first.
//   5. The bank-format Excel with live formulas (cmaxl.ts).
// Figures are FinCom's (the files' cells, the books' sums, the engine's formulas); the AI only reads a PDF.
import type { ExtCtx, ExtResult, ExtTool, ToolTable } from "./types.ts";
import { fyOf, inputFor } from "./reports.ts";
import { Assume, linesOf, monthsIn, project } from "./projection.ts";
import { numOf } from "./num.ts";
import { gridsFromCsv, gridsFromXlsx } from "../filetable.ts";
import { Cma, cmaCompute, CYear, fyL, KIND_WORD, Opts, PLK, rowOf, sumOf } from "./cmaengine.ts";
import { FileKind, pastYears, READ_PROMPT, READ_SCHEMA, readAi, readGrids, RFile } from "./cmaread.ts";
import { cmaExcel, rowCells, XlMeta } from "./cmaxl.ts";
// deno-lint-ignore no-explicit-any
const FSX: any = (globalThis as any).FSX;

const rs = (v: number | null | undefined) => v == null || !isFinite(v) ? "-" : "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(v));
const TO_GIVE = "[To be given by you]";

// ---------------------------------------------------------------- the user's inputs, read and bounded
export type CmaIn = { loanType: "working_capital" | "term_loan" | "both" | null, wcLimit: number | null, tlAmount: number | null, tlYears: number | null, moratorium: number | null,
  existingRepay: number[] | null, method: "I" | "II", years: number, stockMargin: number, recMargin: number, A: Assume, said: string[] };
const nOf = (v: unknown, lo: number, hi: number) => { const x = numOf(v); return x == null ? null : Math.max(lo, Math.min(hi, x)); };
export function cleanIn(inp: Record<string, unknown>): CmaIn {
  const said: string[] = [];
  const lt = String(inp.loan_type || "").toLowerCase();
  const loanType = /both/.test(lt) ? "both" : /term/.test(lt) ? "term_loan" : /work|cc|cash|od|over/.test(lt) ? "working_capital" : null;
  const arr = (v: unknown) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map((x) => numOf(x)).filter((x): x is number => x != null && x >= 0).slice(0, 5);
  const er = arr(inp.existing_repayment);
  const m = String(inp.method || "").toUpperCase().replace(/[^IV12]/g, "");
  const years = nOf(inp.years, 1, 3);
  const sm = nOf(inp.stock_margin_pct, 0, 90), rm = nOf(inp.receivable_margin_pct, 0, 90);
  const A0 = (inp.assumptions && typeof inp.assumptions === "object" ? inp.assumptions : {}) as Assume;
  return { loanType, wcLimit: nOf(inp.working_capital_limit, 0, 1e12), tlAmount: nOf(inp.term_loan_amount, 0, 1e12), tlYears: nOf(inp.term_loan_years, 0.5, 30), moratorium: nOf(inp.moratorium_months, 0, 60),
    existingRepay: er.length ? er : null, method: m === "I" || m === "1" ? "I" : "II", years: years == null ? 2 : Math.round(years), stockMargin: sm == null ? 0.25 : sm / 100, recMargin: rm == null ? 0.25 : rm / 100, A: A0, said };
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
export function candidates(ctx: Pick<ExtCtx, "uploads" | "files" | "clientId">): Cand[] {
  const folder = [String(ctx.clientId || ""), String(ctx.clientId || "").replace(/[^A-Za-z0-9_-]/g, "_")];
  const all = new Map<string, Cand>();
  for (const f of [...(ctx.files || []), ...(ctx.uploads || [])] as any[]) {
    const p = String(f && f.path || ""), seg = p.split("/");
    if (seg.length !== 4 || seg[2] !== "uploads" || !folder.includes(seg[1]) || p.includes("..")) continue;
    const prev = all.get(p);
    all.set(p, { path: p, name: String(f.name || prev?.name || seg[3]), type: String(f.type || prev?.type || ""), kind: String(f.kind || prev?.kind || ""), summary: String(f.summary || prev?.summary || "") });
  }
  return [...all.values()].filter((f) => f.kind !== "notice" && /\.(xlsx|xlsm|csv|xls|pdf|png|jpe?g)$/i.test(f.name)).reverse().slice(0, 8);
}
const looksStatement = (f: Cand) => f.kind === "cma" || f.kind === "balance_sheet" || STMT_WORDS.test(f.name + " " + f.summary);
async function readFiles(ctx: ExtCtx, notes: string[]): Promise<RFile[]> {
  const out: RFile[] = [];
  let pdfs = 0;
  for (const f of candidates(ctx)) {
    const hint: FileKind | "" = f.kind === "cma" ? "cma" : f.kind === "balance_sheet" ? "balance_sheet" : /\bcma\b|credit\s+monitoring/i.test(f.name) ? "cma" : "";
    if (/\.xls$/i.test(f.name)) { if (looksStatement(f)) notes.push(f.name + ": an old .xls workbook FinCom cannot open; save it as .xlsx and upload it again."); continue; }
    const pdf = /\.(pdf|png|jpe?g)$/i.test(f.name);
    if (pdf && (!looksStatement(f) || pdfs >= 2 || !ctx.aiRead)) { if (looksStatement(f) && pdfs >= 2) notes.push(f.name + ": not read (two PDFs a CMA at most)."); continue; }
    const bytes = ctx.readFile ? await ctx.readFile(f.path).catch(() => null) : null;
    if (!bytes) { notes.push(f.name + ": could not be read from the firm's folder."); continue; }
    if (pdf) {
      pdfs++;
      ctx.progress("Reading " + f.name + " (AI)");
      const type = /\.pdf$/i.test(f.name) ? "application/pdf" : /\.png$/i.test(f.name) ? "image/png" : "image/jpeg";
      const txt = await ctx.aiRead!(READ_PROMPT, { bytes, type }, { schema: READ_SCHEMA, feature: "cma", maxTokens: 6000 }).catch(() => "");
      const r = readAi(f.name, f.path, txt);
      if (hint) r.kind = hint;
      out.push(r);
      continue;
    }
    let grids;
    try { grids = /\.csv$/i.test(f.name) ? gridsFromCsv(new TextDecoder().decode(bytes)) : await gridsFromXlsx(bytes); } catch { notes.push(f.name + ": the workbook could not be opened."); continue; }
    const r = readGrids(f.name, f.path, grids, hint);
    if (r.years.length || looksStatement(f)) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------- the books: the last complete years and the year now running
type BookYears = { past: CYear[], cur: CYear | null, kind: string, warnings: string[] };
async function fromBooks(ctx: ExtCtx, open: number): Promise<BookYears> {
  const out: BookYears = { past: [], cur: null, kind: "", warnings: [] };
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
        out.past.push({ fy: open - 1, kind: "actual", src: "books", l: linesOf(nm, "CY") });
        const py = linesOf(nm, "PY");
        if (months(open - 2) === 12 && Object.values(py).some((v) => v)) out.past.unshift({ fy: open - 2, kind: "actual", src: "books", l: py });
        say(open - 1, run);
      }
    } catch (_e) { out.warnings.push(fyL(open - 1) + ": the books' statements could not be worked out."); }
  }
  const m = months(open);
  if (m >= 1) {
    try {
      const g = await inputFor(ctx, String(open));
      if (!("error" in g)) {
        const run = FSX.run(g.inp), l = linesOf(run.model.nm, "CY");
        out.kind = out.kind || String(g.inp.entity.kind || "");
        const asOn = to && to < (open + 1) + "-03-31" ? to : null;
        for (const k of PLK) l[k] = (l[k] || 0) * 12 / m;
        out.cur = { fy: open, kind: "estimate", src: "books to " + (asOn || "31-03-" + (open + 1)) + " (" + m + " month" + (m > 1 ? "s" : "") + ", the profit and loss annualised x 12/" + m + ")", l, asOn, months: m };
        say(open, run);
      }
    } catch (_e) { out.warnings.push(fyL(open) + ": the books to date could not be worked out."); }
  }
  return out;
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
  years: NUM("projected years after the year now running, 1 to 3 (null: 2)"),
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
  const files = await readFiles(ctx, notes);
  for (const f of files) notes.push(...f.notes);
  ctx.progress("Reading the books");
  const B = await fromBooks(ctx, open);
  const P = pastYears(files, B.past, B.cur ? B.cur.fy : open, notes);
  const past = P.years.slice(-3);
  const cur = B.cur;
  if (!past.length && !cur) return { error: "No figures for " + (ctx.clientName || "this client") + ": upload its last balance sheets (Excel or PDF) or the earlier CMA here, or link its Tally company; then ask again." };
  if (cur) P.sources.push([fyL(cur.fy), "Estimate", cur.src]);
  const kind = B.kind || (past.length && (sumOf(past[past.length - 1].l, ["share"]) > 0) ? "company" : past.length && sumOf(past[past.length - 1].l, ["capital", "current"]) > 0 ? "firm" : "company");
  // the projections, from the latest year (the estimate when the books run into this year)
  const base = cur || past[past.length - 1], prevY = [...past].reverse().find((y) => y.fy < base.fy) || null;
  const n = Math.min(5, I.years + (cur ? 0 : Math.max(0, open - base.fy)));   // the years to the running one, then the years asked
  const tlNew = I.loanType !== "working_capital" && I.tlAmount ? I.tlAmount : 0;
  const sched = tlNew && I.tlYears ? tlSchedule(tlNew, I.tlYears, I.moratorium || 0, n) : null;
  const exist = sumOf(base.l, ["ltb"]) > 0;
  const repay = Array.from({ length: n }, (_, i) => (sched ? sched[i] : 0) + (I.existingRepay ? I.existingRepay[Math.min(i, I.existingRepay.length - 1)] : 0));
  const A: Assume = { years: n, revenue_growth_pct: I.A.revenue_growth_pct ?? null, capex: I.A.capex ?? (tlNew ? [tlNew, 0] : null), new_loans: tlNew ? [tlNew, 0] : null,
    loan_repayment: repay.some((x) => x > 0) ? repay : null, dividend_or_drawings: I.A.dividend_or_drawings ?? null, receivable_days: I.A.receivable_days ?? null, inventory_days: I.A.inventory_days ?? null,
    payable_days: I.A.payable_days ?? null, tax_rate_pct: I.A.tax_rate_pct ?? null, other_assumptions: I.A.other_assumptions ?? null, material_cost_pct: null, employee_cost_pct: null, other_expenses_pct: null };
  const p = project(base.l, prevY ? prevY.l : null, { fy: base.fy, months: 12, kind, warnings: [], ytd: null }, base.fy, A);
  const divs = Array.isArray(I.A.dividend_or_drawings) ? (I.A.dividend_or_drawings as unknown[]).map((x) => numOf(x) || 0) : null;
  const proj: CYear[] = p.years.map((y, i) => ({ fy: y.fy, kind: y.fy <= open ? "estimate" : "projected", src: "projected by FinCom from " + fyL(base.fy) + " on the assumptions listed", l: y.l,
    div: divs ? divs[Math.min(i, divs.length - 1)] : 0, repay: (exist && !I.existingRepay) || (tlNew && !sched) ? null : repay[i] }));
  for (const y of proj) P.sources.push([fyL(y.fy), KIND_WORD[y.kind], y.src]);
  const years: CYear[] = [...past, ...(cur ? [cur] : []), ...proj];
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
  if (exist && !I.existingRepay) need.push("the repayment schedule of the existing term loans (" + rs(sumOf(base.l, ["ltb"])) + ")");
  // the assumptions, all of them
  const fails = c.checks.filter((x) => !x.ok), tiesBad = files.flatMap((f) => f.ties.filter((t) => !t.ok && !/\((estimated|projected)\)/.test(t.year)).map((t) => ({ f: f.name, ...t })));   // a file's own estimates are not used
  const assumptions = [
    ...B.warnings.map((w) => "Check the books: " + w),
    "Format: the standard CMA (Forms I to VI and the key ratios), not one bank's own. Past years from the sources listed in Sources; where an audited balance sheet and the earlier CMA give the same year, the audited figures are used and every difference is listed.",
    ...(cur ? ["The year now running (" + fyL(cur.fy) + ") is an estimate from the books to date: their own sums, the profit and loss annualised (x 12/" + cur.months + ") and the balance sheet as on " + (cur.asOn || "the last entry") + "; nothing else is added."] : []),
    "MPBF by Method " + I.method + (I.method === "II" ? " (the second method: 25% of the current assets from long-term funds), FinCom's default" : " (the first method: 25% of the working capital gap from long-term funds), as you said") + "; the other method is shown for comparison. Export receivables are taken as nil.",
    "Drawing power: paid stock (inventory less trade creditors) less a " + Math.round(I.stockMargin * 100) + "% margin, and receivables less a " + Math.round(I.recMargin * 100) + "% margin" + (input.stock_margin_pct == null && input.receivable_margin_pct == null ? " (FinCom's defaults)." : "."),
    "Form II: Schedule III does not split other expenses, so all are under selling, general and administrative expenses; employee costs and depreciation are under cost of sales. Short-term borrowings as in the balance sheet are bank borrowings for working capital; term-loan instalments due within a year stay where the balance sheet shows them.",
    "Interest on term loans (for the DSCR) is the finance costs in proportion to the term loans' share of the borrowings; the DSCR is shown for the years whose repayment is known.",
    ...(tlNew ? ["Term loan of " + rs(tlNew) + " taken at the start of " + fyL(proj[0]?.fy || open) + (I.A.capex == null ? " and spent on fixed assets in that year (tell me the project cost to change it)" : "") + (sched ? "; repaid in monthly instalments over " + I.tlYears + " years" + (I.moratorium ? " after a " + I.moratorium + "-month moratorium" : "") + "." : "; its repayment schedule is not known yet.")] : []),
    ...p.assumptions, ...p.warnings.map((w) => "Check: " + w), ...notes, ...I.said,
  ];
  const status = c.ok && !tiesBad.length ? "All " + c.checks.length + " checks pass." : "DRAFT, NOT FINAL: " + (fails.length ? fails.length + " check" + (fails.length > 1 ? "s" : "") + " fail" + (fails.length > 1 ? "" : "s") : "") + (fails.length && tiesBad.length ? "; " : "") + (tiesBad.length ? tiesBad.length + " file total" + (tiesBad.length > 1 ? "s do" : " does") + " not tie" : "") + " (see Checks).";
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
  const ties = files.flatMap((f) => f.ties.filter((t) => !/\((estimated|projected)\)/.test(t.year)).map((t) => [f.name + ", " + t.year + ": " + t.head, "", "", Math.round(t.file), Math.round(t.mapped), Math.round(t.gap)] as (string | number)[]));
  const meta: XlMeta = { client: ctx.clientName, firm: ctx.firm?.name || "", today: ctx.today, status, assumptions, form1, sources: P.sources, diffs: P.diffs, ties };
  ctx.progress("Making the Excel");
  const xl = await cmaExcel(c, meta);
  const safe = String(ctx.clientName || "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client";
  const f = await ctx.uploadFile(xl, safe + "-CMA-" + fyL(c.years[0].fy) + "-to-" + fyL(c.years[c.years.length - 1].fy) + ".xlsx", "xlsx");
  const tables = tablesOf(c, meta, fails);
  const last = c.years.length - 1, mp = rowOf(c, "V", "mpbf").vals[last], alt = rowOf(c, "V", I.method === "II" ? "mpbf1" : "mpbf2").vals[last], gap = rowOf(c, "V", "dpgap").vals[last];
  const byAi = files.filter((x) => x.by === "ai" && x.years.length).map((x) => x.name);
  const line = cmaLine({ client: ctx.clientName, c, method: I.method, mp, alt, gap, status, fails: fails.length + tiesBad.length, diffs: P.diffs.length, need, file: !!f, limit: opts.limit })
    + (byAi.length ? " The figures of " + byAi.join(", ") + " were read by the AI from the PDF: check them against the copy." : "");
  return { tables, files: f ? [f] : [], line,
    forModel: JSON.stringify({ shown: "CMA data (Forms I-VI, ratios, checks, assumptions) shown as tables" + (f ? " with the bank-format Excel" : ""), years: c.labels, status, mpbf_last_year: Math.round(mp || 0), method: I.method,
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
  if (fails.length) out.push(T("Checks that fail (the figures are not final)", fails.map((x) => ({ n: x.n, item: x.label, year: x.year, gap: Math.round(x.gap) })), [{ k: "n", label: "No.", t: "int" }, { k: "item", label: "Check" }, { k: "year", label: "Year" }, { k: "gap", label: "Difference", t: "amount" }]));
  out.push(T("Form I: particulars", meta.form1.map(([k, v]) => ({ item: k, v })), [{ k: "item", label: "Particulars" }, { k: "v", label: "" }]));
  for (const s of c.sheets) out.push(T(s.name === "Ratios" ? "Key ratios" : s.name + ": " + s.title.replace(/^FORM [IVX]+ - /, "").toLowerCase().replace(/^./, (x) => x.toUpperCase()), s.rows.map((r) => rowCells(r, n))));
  if (meta.diffs.length) out.push(T("Differences: the figures used against the earlier CMA and the books", meta.diffs.map((d) => ({ year: d[0], item: d[1], used: d[2], other: d[3], gap: d[4], src: d[5] })),
    [{ k: "year", label: "Year" }, { k: "item", label: "Line" }, { k: "used", label: "Used", t: "amount" }, { k: "other", label: "Other", t: "amount" }, { k: "gap", label: "Difference", t: "amount" }, { k: "src", label: "Other source" }]));
  out.push(T("Sources", meta.sources.slice(1).map((r) => ({ year: r[0], kind: r[1], item: r[2] })), [{ k: "year", label: "Year" }, { k: "kind", label: "Kind" }, { k: "item", label: "Figures from" }]));
  out.push(T("Assumptions (tell me any to change and I'll redo it)", meta.assumptions.map((a, i) => ({ n: i + 1, item: a })), [{ k: "n", label: "No.", t: "int" }, { k: "item", label: "Assumption" }]));
  return out;
}

export const TOOLS: ExtTool[] = [{
  name: "cma_data",
  description: "Prepare CMA data for a bank (credit monitoring arrangement) for the client open, in the standard format: Form I particulars, Form II operating statement, Form III analysis of balance sheet, Form IV current assets and liabilities, Form V MPBF (Method II by default, Method I on request) with the drawing-power gap, Form VI fund flow, the ratios (current ratio, TOL/TNW, debt/equity, DSCR, interest cover, NWC), the checks and a bank-format Excel. FinCom reads the balance sheets and the earlier CMA uploaded in this conversation, the books to date for the year now running, and projects 1-2 years. Call it at once for CMA, MPBF, Tandon or 'projections for the bank'; pass what the user said and null for the rest; never ask first.",
  input_schema: INPUT_SCHEMA,
  task: "heavy", label: "books",
  words: /\b(cma(\s+data)?|credit\s+monitoring|mpbf|maximum\s+permissible\s+bank\s+finance|tandon|nayak\s+committee|drawing\s+power)\b/i,
  run: runCma,
}];
