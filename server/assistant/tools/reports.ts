// The Assistant's report tools (Step 3, docs/assistant-tools.md): fs_build, tax_audit_draft, cash_mis, dcf_model.
// Every figure is worked out by FSX (src/js/78-reports.js), the same code the app's Reports screen runs, over the books read
// by the read-only SQL of migration 79 (rpt_tb, rpt_saved, rpt_cash_entries). The model never supplies a figure; nothing
// writes to the books. Each tool returns tables (label "books"), the files (Excel with live formulas, Word) and a short
// summary for the model. Register in tools/index.ts: import { TOOLS as REPORTS } from "./reports.ts".
//
import "../../../src/js/78-reports.js";
// the fixed asset register (FAR): its classes and blocks go into the statements and 3CD clause 18 (migration 81)
import "../../../src/js/80-assets.js";

import type { ExtCtx, ExtResult, ExtTool, ToolTable } from "./types.ts";
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

// "2025", "2025-26", "FY 2025-26" -> "2025" (the year from 1 April)
export function fyOf(y: unknown, today: string): string {
  const m = /(\d{4})/.exec(String(y || ""));
  if (m) return m[1];
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
async function inputFor(ctx: Ctx, fy: string, layout?: string | null) {
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
const NUM = (d: string) => ({ type: ["number", "null"], description: d });
const ARR = (d: string) => ({ type: ["array", "null"], items: { type: "number" }, description: d });

export const TOOLS: ReportTool[] = [
  {
    name: "fs_build",
    description: "Make the client's financial statements for a year in the firm's Schedule III format (company: Division I; firm, LLP or proprietor: the ICAI non-corporate format): balance sheet, profit and loss, notes, ratios, and the 27 checks run before output. Returns the totals, the failed checks and the files (Excel with every figure a live formula to the TB, Word). Use for 'balance sheet', 'final accounts', 'Schedule III', 'financial statements'.",
    input_schema: strict({ client: S("the client (the one open when null)"), year: S("the financial year, e.g. 2025-26 (the last year ended when null)"), layout: { type: ["string", "null"], enum: ["company", "firm", "llp", "proprietor", null], description: "the layout (the one kept for the client when null)" } }),
    task: "heavy", label: "books", words: /\b(balance sheet|final accounts|schedule iii|financial statements?|notes to (the )?accounts)\b/i,
    async run(input, ctx) {
      const fy = fyOf(input.year, ctx.today), got = await inputFor(ctx, fy, N(input.layout) as string | null);
      if ("error" in got) return { error: got.error };
      ctx.progress("Trial balance read: " + got.inp.tb.length + " ledgers");
      const r = FSX.run(got.inp, { files: ["xlsx", "docx"] }), M = r.model, V = (n: string) => rs(M.nm[n] || 0);
      ctx.progress("Statements and the 27 checks: done");
      const face = (rows: any[], title: string, pl: boolean): ToolTable => ({ tool: "fs_build", title, columns: [{ k: "line", label: "Particulars" }, { k: "note", label: "Note" }, { k: "cy", label: pl ? M.D.cyYear : M.D.cyAsAt, t: "amount" }, { k: "py", label: pl ? M.D.pyYear : M.D.pyAsAt, t: "amount" }],
        rows: rows.filter((z) => z.c[0] && !z.c[0].eps).map((z) => ({ line: z.t, note: z.note && z.note !== "-" ? String(M.noteNo[z.note] || "") : "", cy: rs(z.c[0].v), py: z.c[1] ? rs(z.c[1].v) : null })), basis: "FinCom's computation from the trial balance and the confirmed mapping (version " + r.mapping.version + ")", period: { from: got.from, to: got.to } });
      const checks: ToolTable = { tool: "fs_build", title: "The 27 checks: what failed", columns: [{ k: "no", label: "Check", t: "int" }, { k: "title", label: "What is checked" }, { k: "level", label: "Level" }, { k: "item", label: "What to look at" }],
        rows: r.checks.filter((c: any) => !c.ok).flatMap((c: any) => c.items.map((x: string) => ({ no: c.id, title: c.title, level: c.level === "warn" ? "warning" : "fail", item: x }))), summary: { checks: 27, failed: r.fails.length, warnings: r.warns.length } };
      const base = safe(M.ent.name) + "-financial-statements-" + FSX.fyLabel(fy);
      const files = [...await upload(ctx, r.files.xlsx, base + ".xlsx", "xlsx"), ...await upload(ctx, r.files.docx, base + ".docx", "docx")];
      return { tables: [face(M.face2.bs, "Balance Sheet as at " + FSX.fyEnd(fy), false), face(M.face2.pl, "Statement of Profit and Loss for the year ended " + FSX.fyEnd(fy), true), checks], files,
        forModel: FSX.summaryText(r.summary) + (r.fails.length ? " Failed: " + r.fails.map((c: any) => c.id + " " + c.title).join("; ") + "." : "") + " Total assets " + V("T_as_CY") + ", PAT " + V("T_pat_CY") + "." };
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
    description: "A DCF valuation working (FCFF or FCFE): 3-5 years of history from the books, the user's assumptions (never assumed: ask the user for every one that is missing), Excel with live formulas (cash flows, discounting, terminal value, equity value, value per share, WACC x growth grid) and a Word draft that must be issued by a registered valuer / merchant banker.",
    input_schema: strict({ client: S("the client (the one open when null)"), assumptions: strict({ years: NUM("forecast years"), revGrowth: ARR("revenue growth % for each year"), ebitdaMargin: ARR("EBITDA margin % for each year"), depPct: NUM("depreciation % of revenue"),
      capexPct: NUM("capex % of revenue"), nwcPct: NUM("net working capital % of revenue"), taxRate: NUM("tax rate %"), tg: NUM("terminal growth %"), shares: NUM("number of equity shares"), valuationDate: S("YYYY-MM-DD"),
      method: { type: ["string", "null"], enum: ["FCFF", "FCFE", null] }, wacc: NUM("WACC %"), rf: NUM("risk-free rate %"), beta: NUM("beta"), erp: NUM("equity risk premium %"), kd: NUM("pre-tax cost of debt %"), de: NUM("debt / equity"),
      netDebt: NUM("net debt at the valuation date"), ke: NUM("cost of equity % (FCFE)"), interestPct: NUM("interest % of revenue (FCFE)"), netBorrowing: ARR("net borrowing each year (FCFE)") }) }),
    task: "heavy", label: "books", words: /\b(dcf|valuation|value per share|discounted cash flow)\b/i,
    async run(input, ctx) {
      const A = Object.fromEntries(Object.entries((input.assumptions || {}) as Record<string, unknown>).filter(([, v]) => v != null));
      const last = fyOf(null, ctx.today), hist: any[] = [];
      for (let y = Number(last) - 4; y <= Number(last); y++) {
        const got = await inputFor(ctx, String(y));
        if ("error" in got) continue;
        hist.push(FSX.histFrom([FSX.run(got.inp).model])[0]);
      }
      if (!hist.length) return { error: "No year of books to take the history from." };
      const d = FSX.dcf(hist, A);
      if (d.error) return { error: d.error };
      const base = safe(ctx.clientName) + "-DCF-" + String(A.valuationDate || "");
      const files = [...await upload(ctx, FSX.dcfExcel(d, { name: ctx.clientName }), base + ".xlsx", "xlsx"), ...await upload(ctx, FSX.dcfWord(d, { name: ctx.clientName }), base + "-draft-report.docx", "docx")];
      const t: ToolTable = { tool: "dcf_model", title: "DCF (" + (d.fcfe ? "FCFE" : "FCFF") + "): value", columns: [{ k: "item", label: "Particulars" }, { k: "amount", label: "Amount", t: "amount" }],
        rows: [["Sum of present values", d.sumPv], ["Present value of the terminal value", d.pvTv], [d.fcfe ? "Equity value" : "Enterprise value", d.ev], ["Equity value", d.equity], ["Value per share", d.perShare]].map(([item, v]) => ({ item, amount: Math.round(Number(v) * 100) / 100 })),
        summary: { rate: Math.round(d.rate * 1e6) / 1e6, terminal_growth: d.g, years_of_history: hist.length }, basis: "history from the books (" + hist.map((h) => FSX.fyLabel(h.fy)).join(", ") + "); assumptions from the user" };
      return { tables: [t], files, forModel: "DCF " + (d.fcfe ? "FCFE" : "FCFF") + ": value per share " + (Math.round(d.perShare * 100) / 100) + ", equity value " + Math.round(d.equity) + ", rate " + (Math.round(d.rate * 10000) / 100) + "%. A draft: it must be issued by a registered valuer / merchant banker." };
    },
  },
];
