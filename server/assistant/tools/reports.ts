// The Assistant's report tools (Step 3, docs/assistant-tools.md): fs_build, tax_audit_draft, cash_mis, dcf_model.
// fs_build gives the statements card (the Financial statements page's figures, worked out in the browser). For the others
// every figure is worked out by FSX (src/js/78-reports.js), the same code the app's Reports screen runs, over the books read
// by the read-only SQL of migration 79 (rpt_tb, rpt_saved, rpt_cash_entries). The model never supplies a figure; nothing
// writes to the books. Each tool returns tables (label "books"), the files (Excel with live formulas, Word) and a short
// summary for the model. Register in tools/index.ts: import { TOOLS as REPORTS } from "./reports.ts".
//
import "../../../src/js/78-reports.js";
// the fixed asset register (FAR): its classes and blocks go into the statements and 3CD clause 18 (migration 81)
import "../../../src/js/80-assets.js";

import type { ExtCtx, ExtResult, ExtTool, ToolTable } from "./types.ts";
import { dmy } from "../fsask.ts";
import { manyOf, numOf, oneOf } from "./num.ts";
type Ctx = ExtCtx; type Result = ExtResult; type ReportTool = ExtTool;
// deno-lint-ignore no-explicit-any
const FSX: any = (globalThis as any).FSX;
// deno-lint-ignore no-explicit-any
const FAR: any = (globalThis as any).FAR;
// the year's fixed asset register worked out (null when none is kept, or migration 81 has not run)
async function farFor(ctx: Ctx, fy: string) {
  try {
    const [g, saved] = await Promise.all([ctx.rpc("asst_dep_register", { p_client: ctx.clientId, p_fy: fy }), ctx.rpc("rpt_saved", { p_client: ctx.clientId })]);
    // the entity and the ICAI level as the statements keep them (the app's FAR.optsFor)
    const rx = (saved && saved.rx) || {}, sw = ((((rx.det || {})[fy] || {}).policies) || {}).switches || {};
    return g && g.reg && (g.reg.assets || []).length ? FAR.compute(g.reg, g.prev || null, { kind: rx.kind || g.reg.kind || "company", levelIV: !!sw.levelIV }) : null;
  } catch (_e) { return null; }
}
const enc = new TextEncoder();
const safe = (s: string) => String(s || "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client";
const rs = (p: number) => Math.round(p) / 100;
const N = (t: unknown) => t == null ? null : t;

// the financial year (the year from 1 April) a text names: "2025-26", "2025-2026", "FY 2025-26", "FY25-26", "FY26" (2025-26),
// a date in it ("31 March 2026", "31-03-2026", "2026-03-31": 2025-26), or "2025" -> "2025"; the last year ended when none
const MONS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const fyFrom = (y: number, mo: number) => String(mo >= 4 ? y : y - 1);
export function fyOf(y: unknown, today: string): string {
  const s = String(y || "").toLowerCase();
  let m: RegExpExecArray | null;
  if ((m = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(s))) return fyFrom(+m[1], +m[2]);
  if ((m = /\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b/.exec(s)) && +m[2] >= 1 && +m[2] <= 12) return fyFrom(+m[3], +m[2]);
  if ((m = /\b\d{1,2}(?:st|nd|rd|th)?[\s-]+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?[\s-]+(20\d{2})\b/.exec(s))) return fyFrom(+m[2], MONS.indexOf(m[1]) + 1);
  if ((m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(20\d{2})\b/.exec(s))) return fyFrom(+m[2], MONS.indexOf(m[1]) + 1);
  if ((m = /\b(20\d{2})\s*[-–/]\s*(20\d{2}|\d{2})\b/.exec(s)) && +m[2].slice(-2) === (+m[1] + 1) % 100) return m[1];
  if ((m = /\bfy\s*'?(\d{2})\s*[-–/]\s*(\d{2})\b/.exec(s)) && +m[2] === (+m[1] + 1) % 100) return String(2000 + +m[1]);
  if ((m = /\bfy\s*'?(\d{2})\b/.exec(s))) return String(2000 + +m[1] - 1);
  if ((m = /\b(20\d{2})\b/.exec(s))) return m[1];
  const t = today || new Date().toISOString().slice(0, 10), yr = Number(t.slice(0, 4)), mo = Number(t.slice(5, 7));
  return String(mo >= 4 ? yr - 1 : yr - 2);          // the last year that has ended
}
// the trial balance rows in FSX's shape: the group path from the parent up to the primary group
// deno-lint-ignore no-explicit-any
const tbRows = (rows: any[], msme: Record<string, unknown>) => rows.map((r) => {
  const chain = (r.chain || []).filter((g: string) => g && g !== r.parent);
  return { l: r.l, g: (r.parent ? [r.parent] : []).concat(chain), o: Number(r.o) || 0, d: Number(r.d) || 0, c: Number(r.c) || 0,
    po: r.po == null ? undefined : Number(r.po), pd: r.pd == null ? undefined : Number(r.pd), pc: r.pc == null ? undefined : Number(r.pc), msme: /micro|small/i.test(String(msme[r.l] || "")) ? String(msme[r.l]) : "" };
}).filter((t) => t.o || t.d || t.c || t.po || t.pd || t.pc);

// the statements' input for a year, from the books and what the app keeps for the client
export async function inputFor(ctx: Ctx, fy: string, layout?: string | null) {
  const from = fy + "-04-01", to = (Number(fy) + 1) + "-03-31";
  const [tb, saved, far] = await Promise.all([ctx.rpc("rpt_tb", { p_client: ctx.clientId, p_from: from, p_to: to }), ctx.rpc("rpt_saved", { p_client: ctx.clientId }), farFor(ctx, fy)]);
  if (!tb || !tb.ok) return { error: "No books for " + FSX.fyLabel(fy) + ": " + ((tb && tb.why) || "the trial balance could not be read") + "." };
  const rx = (saved && saved.rx) || {}, det = FAR.feedDet((rx.det || {})[fy] || {}, far);
  const kind = layout || rx.kind || "company";
  return { inp: { entity: Object.assign({ name: ctx.clientName, kind }, det.entity || {}, { kind }), fy, tb: tbRows(tb.rows || [], (saved && saved.msme) || {}), mapStore: rx.map || { versions: [] },
    det, opts: Object.assign({ cashflow: false }, rx.opts || {}), age: det.age || null }, rx, from, to };
}
async function upload(ctx: Ctx, bytes: Uint8Array | string, name: string, kind: string) {
  const f = await ctx.uploadFile(typeof bytes === "string" ? enc.encode(bytes) : bytes, name, kind);
  return f ? [f] : [];
}
const strict = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const S = (d: string) => ({ type: ["string", "null"], description: d });
const NUM = (d: string) => ({ type: ["number", "string", "null"], description: d });
const ARR = (d: string) => ({ type: ["array", "null"], items: { type: ["number", "string"] }, description: d });

// the DCF's assumptions (the owner, 13-Nov-2026: act first, as the projections do): what the user gave, read and bounded
// (tools/num.ts), and a stated default for every one missing, from the books where they can give it
// deno-lint-ignore no-explicit-any
export function dcfAssume(A0: Record<string, unknown>, hist: any[], nm: Record<string, number>, kind: string, said: string[]): Record<string, any> {
  const one = (k: string, lo: number, hi: number, w: string, int = false) => oneOf(A0[k], lo, hi, w, said, int);
  const many = (k: string, lo: number, hi: number, w: string) => manyOf(A0[k], lo, hi, w, said, 10);
  const pct = (v: number) => Math.round(v * 100) / 100 + "%", L = (k: string) => (Number(nm["L_" + k + "_CY"]) || 0) / 100;
  const inr = (v: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(v));
  const h = hist[hist.length - 1], p = hist.length > 1 ? hist[hist.length - 2] : null, rev = h.rev || 0;
  // deno-lint-ignore no-explicit-any
  const A: Record<string, any> = {};
  const years = one("years", 1, 10, "Forecast years", true);
  A.years = years ?? 5;
  said.push("Forecast of " + A.years + " years" + (years != null ? " (as you said)." : "."));
  const n = Number(A.years), fill = (a: number[]) => Array.from({ length: n }, (_, i) => a[Math.min(i, a.length - 1)]);
  const g = many("revGrowth", -50, 200, "Revenue growth %");
  const trend = p && p.rev > 0 && rev > 0 ? (rev / p.rev - 1) * 100 : null, g0 = trend == null ? 10 : Math.max(-10, Math.min(25, trend));
  A.revGrowth = g ? fill(g) : fill([g0]);
  said.push(g ? "Revenue growth " + A.revGrowth.map(pct).join(", ") + " (as you said)."
    : "Revenue grows " + pct(g0) + " a year (" + (trend == null ? "no earlier year with sales to take a trend from: a moderate 10%" : "last year's growth was " + pct(trend) + (g0 !== trend ? ", capped at " + pct(g0) : "")) + ").");
  const m = many("ebitdaMargin", -100, 100, "EBITDA margin %"), m0 = rev > 0 ? h.ebitda / rev * 100 : 0;
  A.ebitdaMargin = m ? fill(m) : fill([Math.max(-100, Math.min(100, m0))]);
  said.push(m ? "EBITDA margin " + A.ebitdaMargin.map(pct).join(", ") + " (as you said)." : "EBITDA margin " + pct(A.ebitdaMargin[0]) + " each year (last year's).");
  const share = (k: string, lo: number, hi: number, w: string, v0: number, why: string) => {
    const v = one(k, lo, hi, w);
    if (v != null) { said.push(w + " " + pct(v) + " (as you said)."); return v; }
    const d = Math.max(lo, Math.min(hi, v0));
    said.push(w + " " + pct(d) + " (" + why + ").");
    return d;
  };
  A.depPct = share("depPct", 0, 100, "Depreciation as % of revenue:", rev > 0 ? h.dep / rev * 100 : 0, "last year's");
  A.capexPct = share("capexPct", 0, 100, "Capital expenditure as % of revenue:", A.depPct, "equal to depreciation: the assets kept up, no expansion");
  A.nwcPct = share("nwcPct", -100, 100, "Net working capital as % of revenue:", rev > 0 ? (h.nwc || 0) / rev * 100 : 0, "last year's");
  A.taxRate = share("taxRate", 0, 60, "Tax rate:", kind === "company" ? 25.17 : 31.2, kind === "company" ? "section 115BAA rate with surcharge and cess" : "30% with cess");
  A.method = String(A0.method || "").toUpperCase() === "FCFE" ? "FCFE" : "FCFF";
  said.push(A.method === "FCFE" ? "Method: FCFE (as you said)." : "Method: FCFF (free cash flow to the firm)" + (A0.method ? " (as you said)." : "."));
  const debt = L("ltb") + L("stb"), cash = L("cash"), eq = L("share") + L("reserves") + L("capital") + L("current");
  for (const [k, lo, hi, w] of [["rf", 0, 20, "Risk-free rate %"], ["beta", 0, 5, "Beta"], ["erp", 0, 20, "Equity risk premium %"], ["kd", 0, 40, "Cost of debt %"], ["de", 0, 20, "Debt / equity"]] as [string, number, number, string][]) {
    const v = one(k, lo, hi, w);
    if (v != null) A[k] = v;
  }
  const wacc = one("wacc", 1, 50, "WACC %"), ke = one("ke", 1, 50, "Cost of equity %");
  const BASIS = "risk-free 7% + beta 1 x equity risk premium 7%, a common basis for an unlisted Indian company";
  if (A.method === "FCFE") {
    if (ke != null) { A.ke = ke; said.push("Cost of equity " + pct(ke) + " (as you said)."); }
    else if (A.rf == null || A.beta == null || A.erp == null) { A.ke = 14; said.push("Cost of equity 14% (" + BASIS + ")."); }
    const ip = one("interestPct", 0, 100, "Interest % of revenue");
    A.interestPct = ip ?? (rev > 0 ? Math.round((h.fin || 0) / rev * 1000) / 10 : 0);
    said.push("Interest " + pct(A.interestPct) + " of revenue" + (ip != null ? " (as you said)." : " (last year's)."));
    const nb = many("netBorrowing", -1e13, 1e13, "Net borrowing");
    A.netBorrowing = nb ? fill(nb) : fill([0]);
    if (!nb) said.push("No new net borrowing in the forecast years.");
  } else if (wacc != null) { A.wacc = wacc; said.push("WACC " + pct(wacc) + " (as you said)."); }
  else if (A.rf != null || A.beta != null || A.erp != null || A.kd != null || A.de != null) {
    const kd0 = debt > 0 ? Math.min(40, (h.fin || 0) / debt * 100) : 10, de0 = eq > 0 ? debt / eq : 0;
    A.rf = A.rf ?? 7; A.beta = A.beta ?? 1; A.erp = A.erp ?? 7; A.kd = A.kd ?? Math.round(kd0 * 10) / 10; A.de = A.de ?? Math.round(de0 * 100) / 100;
    said.push("WACC built from risk-free " + pct(A.rf) + ", beta " + A.beta + ", equity risk premium " + pct(A.erp) + ", cost of debt " + pct(A.kd) + ", debt/equity " + A.de + " (yours where given; else 7%, 1, 7%, the books' interest rate and debt/equity).");
  } else { A.wacc = 14; said.push("Discount rate (WACC) 14% (" + BASIS + "; not weighted for debt)."); }
  const rate = A.method === "FCFE" ? Number(A.ke ?? (A.rf + A.beta * A.erp)) : A.wacc != null ? Number(A.wacc) : (1 / (1 + A.de)) * (A.rf + A.beta * A.erp) + (A.de / (1 + A.de)) * A.kd * (1 - A.taxRate / 100);
  let tg = one("tg", -5, 10, "Terminal growth %");
  if (tg == null) { tg = 4; said.push("Terminal growth 4% a year after the forecast (long-run growth, below the discount rate)."); } else said.push("Terminal growth " + pct(tg) + " (as you said).");
  if (tg >= rate) { const t2 = Math.round((rate - 2) * 10) / 10; said.push("Terminal growth " + pct(tg) + " is not below the discount rate " + pct(rate) + "; " + pct(t2) + " is used."); tg = t2; }
  A.tg = tg;
  const nd = numOf(A0.netDebt);
  A.netDebt = nd ?? Math.round(debt - cash);
  said.push("Net debt " + inr(A.netDebt) + (nd != null ? " (as you said)." : " (borrowings less cash and bank in the books at the year end)."));
  const sh = oneOf(A0.shares, 1, 1e12, "Number of equity shares", said, true);
  if (sh != null) { A.shares = sh; said.push("Equity shares " + sh + " (as you said)."); }
  else if (L("share") > 0) { A.shares = Math.max(1, Math.round(L("share") / 10)); said.push("Equity shares " + A.shares + ": share capital " + inr(L("share")) + " at a face value of ₹10 (tell me the real number)."); }
  else { A.shares = 1; said.push("No share capital in the books (a firm or proprietor): the value per share is the equity value."); }
  const vd = typeof A0.valuationDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(A0.valuationDate) ? A0.valuationDate : (Number(h.fy) + 1) + "-03-31";
  A.valuationDate = vd;
  said.push("Valuation date " + vd + (vd === A0.valuationDate ? " (as you said)." : " (the end of the last year in the books)."));
  return A;
}

export const TOOLS: ReportTool[] = [
  {
    // the statements of the Financial statements page (owner, 29-Oct-2026: "provisional balance sheet from 1st April 2026 to
    // 30th September 2026 … not answered properly"): any From-To, the comparative and the notes. The page's engine (FinSt,
    // src/js/88-fin-statements.js) runs in the browser on the books there, with the client's mapping, adjustments, stock and
    // last year's balance sheet; so FinCom does not work the statements out here (the Reports screen's engine, FSX, gave
    // other figures than the page): the tool gives the statements card (app/src/parts/AssistantFs.jsx), which works them out
    // with the page's own code and opens the page or its Excel and PDF. The model never states a figure of the statements.
    name: "fs_build",
    description: "Show the client's financial statements in the Schedule III format (company: Division I; firm, LLP or proprietor: the ICAI non-corporate format) for any period From-To: the balance sheet as on To, the profit and loss, cash flow and notes for the period, with a comparative (the same period last year by default, or the last full year). Use for any balance sheet, provisional or interim balance sheet, final accounts, Schedule III, notes to accounts, a P&L with the balance sheet, or last year's figures. FinCom works out every figure with its Financial statements page from the books, and shows a card with the summary, what is missing (ledgers with no code, stock not known, no previous year), Open Financial statements and the page's Download Excel and PDF. Never state a figure of the statements, and never build them from profit_and_loss, find_ledgers or other tools.",
    input_schema: strict({ client: S("the client (the one open when null)"), from: S("YYYY-MM-DD, the first day of the period (the start of To's financial year when null)"), to: S("YYYY-MM-DD, the balance sheet date (null: the period chosen on the Financial statements page)"),
      compare: { type: ["string", "null"], enum: ["same", "fy", null], description: "the comparative: the same period last year (same, the default) or the last full year (fy)" },
      notes: { type: ["boolean", "null"], description: "with the notes (true when null)" } }),
    task: "book", label: "books", words: /\b(balance sheet|final accounts|schedule iii|financial statements?|notes to (the )?accounts)\b/i,
    // deno-lint-ignore require-await
    async run(input, _ctx) {
      const ok = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
      let from = ok(input.from);
      const to = ok(input.to);
      if (from && !to) return { error: "give the balance sheet date (to) as well as from" };
      if (to && !from) from = String(Number(to.slice(5, 7)) >= 4 ? Number(to.slice(0, 4)) : Number(to.slice(0, 4)) - 1) + "-04-01";
      if (from && to && from > to) return { error: "from (" + from + ") is after to (" + to + ")" };
      const fy = to ? String(Number(to.slice(5, 7)) >= 4 ? Number(to.slice(0, 4)) : Number(to.slice(0, 4)) - 1) : null;
      const cmp = input.compare === "fy" ? "fy" : "same", notes = input.notes !== false, label = from && to ? dmy(from) + " to " + dmy(to) : "";
      return { cards: [{ t: "fs", from, to, fy, cmp, notes, want: null, tallyDiff: false, pyAsked: false, carried: false, alt: null, label, via: "model" }],
        forModel: "FinCom shows the statements card for " + (label || "the period chosen on the Financial statements page") + ", compared with " + (cmp === "fy" ? "the last full year" : "the same period last year") +
          (notes ? ", with the notes" : ", without the notes") + ". FinCom works out every figure on its Financial statements page from the books in the user's browser: never state a figure of the statements. In one or two lines say what the card has: the summary, what is missing, Open Financial statements, Download Excel and PDF." };
    },
  },
  {
    name: "tax_audit_draft",
    description: "Make a DRAFT Form 3CD working for a year: the clauses the books answer (40A(3), 269SS/269T/269ST, the 40(a)(ia) TDS details, 43B and 43B(h), turnover, GST registrations, related-party payments to confirm), and the other clauses as questions for the user. Excel and Word, marked DRAFT.",
    input_schema: strict({ client: S("the client (the one open when null)"), year: S("the financial year, e.g. 2025-26 (the last year ended when null)") }),
    task: "heavy", label: "books", words: /\b(3cd|tax audit|form 3ca|form 3cb|44ab)\b/i,
    async run(input, ctx) {
      const fy = fyOf(input.year, ctx.today), from = fy + "-04-01", to = (Number(fy) + 1) + "-03-31";
      const saved = await ctx.rpc("rpt_saved", { p_client: ctx.clientId }), rx = (saved && saved.rx) || {}, kept = (rx.tax3cd || {})[fy];
      let d3: any, basis: string;
      if (kept && kept.d3) { d3 = kept.d3; basis = "the draft made on the client's Reports screen on " + kept.at + " (" + kept.src + ")"; }
      else {
        // the shared checks as the Assistant's book tools compute them (to merge with 77-audit.js / AuditWP)
        const T = async (tool: string, args: Record<string, unknown>) => { try { return await ctx.book(tool, args); } catch (_e) { return null; } };
        const [c40, cst, ms, tm, tu] = await Promise.all([T("cash_payments_40a3", { from, to }), T("cash_receipts_269st", { from, to }), T("msme_dues_43bh", { as_on: to, days: 45 }), T("tds_missed", { from, to, section: null }), T("turnover", { from, to })]);
        const rows = (t: any, ks: string[]) => ((t && t.rows) || []).map((r: any) => ks.map((k) => r[k] ?? ""));
        const fromBooks = [
          { no: "21(d)", head: ["Date", "Party", "Amount"], rows: rows(c40, ["date", "party", "amount"]) },
          { no: "31(ba)", head: ["Date", "From", "Amount"], rows: rows(cst, ["date", "party", "amount"]) },
          { no: "22", head: ["Supplier", "Bill", "Outstanding", "Days"], rows: rows(ms, ["party", "bill", "amount", "days"]) },
          { no: "26", head: ["Supplier", "Amount", "Note"], rows: rows(ms, ["party", "amount"]).map((r: any[]) => r.concat(["43B(h) MSME"])) },
          { no: "21(b)", head: ["Party", "Amount", "Detail"], rows: rows(tm, ["party", "amount", "section"]) },
          { no: "40", head: ["Item", "This year"], rows: tu && tu.rows ? tu.rows.slice(0, 6).map((r: any) => [r.item ?? r.label ?? "", r.amount ?? r.value ?? ""]) : [] },
        ].filter((c) => c.rows.length || c.no === "21(d)" || c.no === "31(ba)").map((c) => Object.assign(c, { title: "", note: c.rows.length ? "" : "None found in the books." }));
        const far = await farFor(ctx, fy);
        d3 = FSX.form3cd({ entity: Object.assign({ name: ctx.clientName, kind: rx.kind || "company" }, ((rx.det || {})[fy] || {}).entity || {}), fy, fromBooks, partners: ((rx.det || {})[fy] || {}).partners, hasStock: false, itBlocks: far ? far.rows3cd : undefined });
        basis = "the Assistant's book tools (40A(3), 269ST, 43B(h), TDS, turnover); 269SS / 269T and 34(a) are on the client's Reports screen";
      }
      const base = safe(ctx.clientName) + "-3CD-DRAFT-" + FSX.fyLabel(fy);
      const files = [...await upload(ctx, FSX.form3cdExcel(d3), base + ".xlsx", "xlsx"), ...await upload(ctx, FSX.form3cdWord(d3), base + ".docx", "docx")];
      const table: ToolTable = { tool: "tax_audit_draft", title: "Form 3CD draft, " + FSX.fyLabel(fy) + " (DRAFT)", columns: [{ k: "no", label: "Clause" }, { k: "title", label: "Particulars" }, { k: "src", label: "From" }, { k: "rows", label: "Rows", t: "int" }],
        rows: d3.clauses.map((c: any) => ({ no: c.no, title: c.title, src: c.src === "books" ? "books" : c.src === "confirm" ? "books, to confirm" : c.src === "given" ? "given" : "for you", rows: c.rows.length })), basis, period: { from, to } };
      return { tables: [table], files, forModel: "DRAFT Form 3CD for " + FSX.fyLabel(fy) + ": " + d3.clauses.filter((c: any) => c.src === "books" || c.src === "confirm").length + " clauses from the books, " + d3.forYou.length + " questions for the user. From " + basis + "." };
    },
  },
  {
    name: "cash_mis",
    description: "Cash-basis MIS for a period: receipts and payments by head and by month from the cash and bank entries, reconciled to the accrual profit. Excel (formulas over the entries) and a printable page.",
    input_schema: strict({ client: S("the client (the one open when null)"), period: strict({ from: S("YYYY-MM-DD"), to: S("YYYY-MM-DD") }) }),
    task: "book", label: "books", words: /\b(cash basis|receipts and payments|cash mis)\b/i,
    async run(input, ctx) {
      const p = (input.period || {}) as Record<string, string | null>, fy = fyOf(p.from || null, ctx.today);
      const from = p.from || fy + "-04-01", to = p.to || (Number(fy) + 1) + "-03-31";
      const [tb, ents, saved] = await Promise.all([ctx.rpc("rpt_tb", { p_client: ctx.clientId, p_from: from, p_to: to }), ctx.rpc("rpt_cash_entries", { p_client: ctx.clientId, p_from: from, p_to: to }), ctx.rpc("rpt_saved", { p_client: ctx.clientId })]);
      if (!tb || !tb.ok) return { error: "No books for " + from + " to " + to + "." };
      const rows = tbRows(tb.rows || [], {}), rx = (saved && saved.rx) || {}, map = FSX.mapping(rx.map || { versions: [] }, rows, rx.kind || "company").map;
      const cm = FSX.cashMis({ entity: { name: ctx.clientName }, from, to, tb: rows, vouchers: (ents || []).map((v: any) => ({ date: String(v.date).slice(0, 10), no: v.no, type: v.type, ent: v.ent || [] })), map });
      const col = (m: string) => ({ k: m, label: m, t: "amount" as const });
      const t = (title: string, list: any[]): ToolTable => ({ tool: "cash_mis", title, columns: [{ k: "head", label: "Head" }, ...cm.months.map(col), { k: "total", label: "Total", t: "amount" }],
        rows: list.map((h: any) => Object.assign({ head: h.head, total: rs(h.t) }, Object.fromEntries(cm.months.map((m: string) => [m, rs(h.m[m] || 0)])))), period: { from, to }, basis: "the cash and bank entries in FinCom's copy of the books" });
      const recon: ToolTable = { tool: "cash_mis", title: "Reconciliation to the accrual profit", columns: [{ k: "item", label: "Particulars" }, { k: "amount", label: "Amount", t: "amount" }],
        rows: cm.recon.map(([item, v]: [string, number]) => ({ item, amount: rs(v) })).concat([{ item: "Net movement in cash and bank", amount: rs(cm.reconTot) }, { item: "As per the books", amount: rs(cm.cash.move) }]), summary: { difference: rs(cm.diff) } };
      const base = safe(ctx.clientName) + "-cash-MIS-" + from + "-" + to;
      const files = [...await upload(ctx, FSX.cashMisExcel(cm), base + ".xlsx", "xlsx")];
      return { tables: [t("Receipts", cm.rec), t("Payments", cm.pay), recon], files,
        forModel: "Cash basis " + from + " to " + to + ": receipts " + rs(cm.totals.receipts) + ", payments " + rs(cm.totals.payments) + ", net " + rs(cm.totals.net) + "; cash and bank moved " + rs(cm.cash.move) + " in the books (difference " + rs(cm.voucherDiff) + ")." };
    },
  },
  {
    name: "dcf_model",
    description: "A DCF valuation working (FCFF or FCFE) for the client open: 3-5 years of history from the books, the assumptions, Excel with live formulas (cash flows, discounting, terminal value, equity value, value per share, WACC x growth grid) and a Word draft that must be issued by a registered valuer / merchant banker. Call it at once with what the user said in this conversation and null for the rest: FinCom fills every missing assumption with a stated default (growth and margins from the books' trend, a 14% discount rate, 4% terminal growth, the tax rate for the entity, net debt and shares from the books) and lists them all. Never ask for assumptions first. Percentages as numbers (14 for 14%).",
    input_schema: strict({ client: S("the client (the one open when null)"), assumptions: strict({ years: NUM("forecast years, 1 to 10"), revGrowth: ARR("revenue growth % for each year, -50 to 200"), ebitdaMargin: ARR("EBITDA margin % for each year"), depPct: NUM("depreciation % of revenue"),
      capexPct: NUM("capex % of revenue"), nwcPct: NUM("net working capital % of revenue"), taxRate: NUM("tax rate %, 0 to 60"), tg: NUM("terminal growth %, -5 to 10"), shares: NUM("number of equity shares"), valuationDate: S("YYYY-MM-DD"),
      method: { type: ["string", "null"], enum: ["FCFF", "FCFE", null] }, wacc: NUM("WACC %"), rf: NUM("risk-free rate %"), beta: NUM("beta"), erp: NUM("equity risk premium %"), kd: NUM("pre-tax cost of debt %"), de: NUM("debt / equity"),
      netDebt: NUM("net debt at the valuation date"), ke: NUM("cost of equity % (FCFE)"), interestPct: NUM("interest % of revenue (FCFE)"), netBorrowing: ARR("net borrowing each year (FCFE)") }) }),
    task: "heavy", label: "books", words: /\b(dcf|valuation|value per share|discounted cash flow)\b/i,
    async run(input, ctx) {
      const last = fyOf(null, ctx.today), hist: any[] = [];
      let nm: Record<string, number> = {}, kind = "company";
      for (let y = Number(last) - 4; y <= Number(last); y++) {
        const got = await inputFor(ctx, String(y));
        if ("error" in got) continue;
        const M = FSX.run(got.inp).model;
        hist.push(FSX.histFrom([M])[0]);
        nm = M.nm; kind = String(got.inp.entity.kind || "company");
      }
      if (!hist.length) return { error: "No year of books to take the history from: link the client's Tally company or upload its books, then ask again." };
      const said: string[] = [], A = dcfAssume((input.assumptions || {}) as Record<string, unknown>, hist, nm, kind, said);
      const d = FSX.dcf(hist, A);
      if (d.error) return { error: d.error };
      d.notes = said;
      const base = safe(ctx.clientName) + "-DCF-" + String(A.valuationDate || "");
      const files = [...await upload(ctx, FSX.dcfExcel(d, { name: ctx.clientName }), base + ".xlsx", "xlsx"), ...await upload(ctx, FSX.dcfWord(d, { name: ctx.clientName }), base + "-draft-report.docx", "docx")];
      const t: ToolTable = { tool: "dcf_model", title: "DCF (" + (d.fcfe ? "FCFE" : "FCFF") + "): value", columns: [{ k: "item", label: "Particulars" }, { k: "amount", label: "Amount", t: "amount" }],
        rows: [["Sum of present values", d.sumPv], ["Present value of the terminal value", d.pvTv], [d.fcfe ? "Equity value" : "Enterprise value", d.ev], ["Equity value", d.equity], ["Value per share", d.perShare]].map(([item, v]) => ({ item, amount: Math.round(Number(v) * 100) / 100 })),
        summary: { rate: Math.round(d.rate * 1e6) / 1e6, terminal_growth: d.g, years_of_history: hist.length }, basis: "history from the books (" + hist.map((h) => FSX.fyLabel(h.fy)).join(", ") + "); the assumptions listed (the user's, else FinCom's stated defaults)" };
      const at: ToolTable = { tool: "dcf_model", title: "Assumptions (tell me any to change and I'll redo it)", columns: [{ k: "n", label: "No.", t: "int" }, { k: "item", label: "Assumption" }], rows: said.map((item, i) => ({ n: i + 1, item })) };
      return { tables: [t, at], files, forModel: JSON.stringify({ result: "DCF " + (d.fcfe ? "FCFE" : "FCFF") + ": value per share " + (Math.round(d.perShare * 100) / 100) + ", equity value " + Math.round(d.equity) + ", rate " + (Math.round(d.rate * 10000) / 100) + "%. A draft: it must be issued by a registered valuer / merchant banker.",
        assumptions: said, say: "In two or three lines give the value and what drives it; list the assumptions in short bullets; end with: Tell me any assumption to change and I'll redo it." }) };
    },
  },
];
