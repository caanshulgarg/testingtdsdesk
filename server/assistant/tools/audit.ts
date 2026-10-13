// FinCom Assistant's audit tools (docs/assistant-tools.md): audit_run (the summary of the audit of the books for a period)
// and audit_check (one check's entries). The audit is FinCom's own code, run in the browser on the client's books
// (src/js/77-audit.js, AuditWP: the TDS, GST, 26AS and MIS rules are there and are not written again here); each run is
// kept with the books as items, and asst_audit_wp (migration-78-audit.sql, read-only, as the signed-in user) reads them
// back. So every figure here is the Audit screen's figure, never the model's. The model may add words only, through
// ctx.aiText (commentary: true), and is given totals, not entries.
// Plain module (no Deno, no SDK import), so the tests load it anywhere.
import type { ExtTool, ExtCtx, ExtResult, ToolTable } from "./types.ts";

// the checks, in AuditWP.CHECKS's order (the tool list must be deterministic: it is part of the cached prompt)
export const CHECKS: [string, string][] = [
  ["cash40A3", "Cash payments above 10,000 a day to one party (40A(3))"],
  ["cash269ST", "Cash received of 2 lakh or more (269ST)"],
  ["cashLoans", "Loans or deposits taken or repaid in cash, 20,000 or more (269SS, 269T)"],
  ["tds", "TDS not deducted, short deducted or paid late (40(a)(ia), 201(1A))"],
  ["msme43Bh", "MSME suppliers unpaid beyond 45 days (43B(h))"],
  ["itc2b", "Input tax in the books not in GSTR-2B"],
  ["turnover", "Turnover in the books against GSTR-1 and 3B filed"],
  ["tds26as", "TDS in the books against 26AS"],
  ["duplicates", "Possible duplicate entries"],
  ["backdated", "Entries after the books were closed, or backdated"],
  ["ledgers", "Unusual ledgers: rarely used, or a reversed balance"],
  ["round", "Round-sum entries"],
  ["benford", "Benford's law: first digits of the amounts"],
  ["weekend", "Entries dated on a Sunday or a national holiday"],
];
const STATUS: Record<string, string> = { nr: "Not reviewed", rev: "Reviewed", issue: "Issue" };
const RESULT: Record<string, string> = { flag: "Flag", ok: "OK", na: "Does not apply", error: "Could not check" };

// the period as AuditWP.parsePeriod reads it (src/js/77-audit.js; tests/run_audit_wp_tool.py checks both give the same):
// "2025-26", "Q2 2025-26", "2026-02", "2025-04-01..2026-03-31", "20250401-20260331". Returns "YYYYMMDD-YYYYMMDD" or null.
export function periodKey(p: unknown): string | null {
  const s = String(p ?? "").trim();
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})\s*(?:\.\.|to|-|–)\s*(\d{4})-?(\d{2})-?(\d{2})$/i);
  if (m) return m[1] + m[2] + m[3] + "-" + m[4] + m[5] + m[6];
  m = s.match(/^(?:FY\s*)?(\d{4})\s*-\s*(\d{2}|\d{4})$/i);
  if (m && (m[2].length === 2 ? (+m[1] + 1) % 100 === +m[2] : +m[2] === +m[1] + 1)) return m[1] + "0401-" + (+m[1] + 1) + "0331";
  m = s.match(/^(Q[1-4])\s*(?:FY\s*)?(\d{4})\s*-\s*\d{2}$/i);
  if (m) {
    const y = +m[2], q = m[1].toUpperCase();
    const a = ({ Q1: [y, "04", "0630"], Q2: [y, "07", "0930"], Q3: [y, "10", "1231"], Q4: [y + 1, "01", "0331"] } as Record<string, [number, string, string]>)[q];
    return a[0] + a[1] + "01-" + a[0] + a[2];
  }
  m = s.match(/^(\d{4})-?(\d{2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) { const last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate(); return m[1] + m[2] + "01-" + m[1] + m[2] + String(last).padStart(2, "0"); }
  return null;
}
const iso = (d: string) => d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
const dmy = (d: string) => d.slice(6, 8) + "-" + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+d.slice(4, 6) - 1] + "-" + d.slice(0, 4);
const inr = (v: number) => "₹" + Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Kept = { run: any | null, wp: any[], periods: { period: string, at: string }[] };
const NOT_RUN = (period: string) => "The audit of the books for " + period + " has not been run in FinCom yet. Open the client's Audit page, Working papers, choose the period and press Run (it runs on the books in FinCom; then ask again).";

// the kept run for the period asked (the latest run when none is named), and whether the client named is the open one
async function kept(input: Record<string, unknown>, ctx: ExtCtx): Promise<{ k: Kept, period: string } | { error: string }> {
  const c = input.client == null ? "" : String(input.client).trim().toLowerCase();
  if (c && c !== String(ctx.clientId || "").toLowerCase() && c !== String(ctx.clientName || "").toLowerCase())
    return { error: "The audit tools work on the client open in FinCom (" + (ctx.clientName || "none") + "). Open " + String(input.client) + " first." };
  let period = input.period == null || input.period === "" ? "" : periodKey(input.period);
  if (period === null) return { error: "Say the period as a financial year (2025-26), a quarter (Q2 2025-26), a month (2026-02) or dates (2025-04-01..2026-03-31)." };
  let k: Kept = await ctx.rpc("asst_audit_wp", { p_period: period || null }) || { run: null, wp: [], periods: [] };
  if (!period) {
    if (!(k.periods || []).length) return { error: NOT_RUN("any period") };
    period = k.periods[0].period;
    k = await ctx.rpc("asst_audit_wp", { p_period: period }) || { run: null, wp: [], periods: [] };
  }
  if (!k.run) return { error: NOT_RUN(dmy(period.slice(0, 8)) + " to " + dmy(period.slice(9))) };
  return { k, period };
}
const basis = (run: any) => "FinCom's own checks on the books (no AI), run " + String(run.at || "").slice(0, 16).replace("T", " ") + " UTC" + (run.by ? " by " + run.by : "") + ", result code " + run.code + ", " + run.entries + " entries in the period.";

export function summaryTable(run: any, wp: any[]): ToolTable {
  const st = (id: string) => wp.find((w) => w.check === id) || { status: "nr", remark: "" };
  const rows = (run.checks as any[]).slice().sort((a, c) => (a.rank ?? 99) - (c.rank ?? 99) || c.score - a.score || String(a.id).localeCompare(String(c.id)))
    .map((c) => ({ rank: c.rank ?? null, check: c.title, id: c.id, law: c.law, result: RESULT[c.status] || c.status, entries: c.count, amount: c.amount, score: c.score, review: STATUS[st(c.id).status] || "Not reviewed", remark: st(c.id).remark || "" }));
  const flagged = (run.checks as any[]).filter((c) => c.status === "flag");
  return { tool: "audit_run", title: "Audit of the books, " + dmy(run.from) + " to " + dmy(run.to),
    columns: [{ k: "rank", label: "Rank", t: "int" }, { k: "check", label: "Check" }, { k: "law", label: "Law" }, { k: "result", label: "Result" }, { k: "entries", label: "Entries", t: "int" },
      { k: "amount", label: "Amount", t: "amount" }, { k: "score", label: "Risk score" }, { k: "review", label: "Review" }, { k: "remark", label: "Remarks" }],
    rows, summary: { flagged: flagged.length, checks: run.checks.length, entries: flagged.reduce((s, c) => s + c.count, 0), amount: Math.round(flagged.reduce((s, c) => s + c.amount, 0) * 100) / 100, code: run.code },
    basis: basis(run), period: { from: iso(run.from), to: iso(run.to) } };
}
export function checkTable(run: any, id: string): ToolTable | null {
  const c = (run.checks as any[]).find((x) => x.id === id);
  if (!c) return null;
  const rows = (c.entries as any[]).map((e) => ({ date: e.date ? iso(e.date) : null, no: e.no || "", type: e.type || "", party: e.party || "", amount: e.amount, note: e.note || "", ...(e.vid ? { guid: e.vid } : {}) }));
  return { tool: "audit_check", title: c.title + " (" + (RESULT[c.status] || c.status) + ")",
    columns: [{ k: "date", label: "Date", t: "date" }, { k: "no", label: "Voucher" }, { k: "type", label: "Type" }, { k: "party", label: "Party or ledger" }, { k: "amount", label: "Amount", t: "amount" }, { k: "note", label: "Note" }],
    rows, summary: { status: c.status, count: c.count, amount: c.amount, score: c.score, rank: c.rank ?? null, shown: rows.length, ...(c.benford ? { chi2: c.benford.chi2, pass: c.benford.pass, n: c.benford.n } : {}) },
    basis: basis(run) + (c.count > rows.length ? " The first " + rows.length + " of " + c.count + " entries; all of them are on the Audit page and in its Excel." : "") + (c.note ? " " + c.note : ""),
    period: { from: iso(run.from), to: iso(run.to) } };
}
// what the model reads back: totals only (FinCom masks it)
export function forModelRun(run: any): string {
  const fl = (run.checks as any[]).filter((c) => c.status === "flag").sort((a, c) => (a.rank ?? 99) - (c.rank ?? 99));
  return "Audit " + dmy(run.from) + " to " + dmy(run.to) + " (FinCom's figures, shown to the user as a table; result code " + run.code + "): " + fl.length + " of " + run.checks.length + " checks flagged. " +
    fl.map((c) => "#" + c.rank + " " + c.id + ": " + c.count + " entries, " + inr(c.amount) + ", score " + c.score).join("; ") +
    ". Not flagged: " + (run.checks as any[]).filter((c) => c.status !== "flag").map((c) => c.id + " " + (RESULT[c.status] || c.status).toLowerCase()).join(", ") + ". Use audit_check for a check's entries. Quote these figures only.";
}

const STR_N = { type: ["string", "null"] };
export const TOOLS: ExtTool[] = [
  {
    name: "audit_run",
    description: "Audit the open client's books for a period: FinCom's 14 rule checks (40A(3) cash payments, 269ST, 269SS/269T cash loans, TDS not deducted/short/late, 43B(h) MSME dues, ITC against 2B, turnover against GSTR-1/3B, TDS against 26AS, duplicates, round sums, weekend and holiday entries, backdated or after close, unusual ledgers, Benford) with status, count, amount and a risk score and rank, and the reviewer's status and remark per check. The figures are FinCom's (from the run on the Audit page); quote them, never work them out. commentary: true adds a short AI-drafted note on the risks.",
    input_schema: { type: "object", additionalProperties: false, required: ["client", "period", "commentary"], properties: {
      client: { type: ["string", "null"], description: "the client's name or id; null for the client open in FinCom" },
      period: { type: ["string", "null"], description: "2025-26, Q2 2025-26, 2026-02 or 2025-04-01..2026-03-31; null for the latest run" },
      commentary: { type: ["boolean", "null"], description: "true: also an AI-drafted note ranking the risks (words only)" } } },
    task: "heavy",
    label: "books",
    words: /\b(audit (of )?(the |my |his |her |their |client'?s )?books|working papers?|audit (run|checks?|findings)|benford)\b/i,
    run: async (input, ctx): Promise<ExtResult> => {
      const r = await kept(input, ctx);
      if ("error" in r) return { error: r.error };
      const run = r.k.run;
      const out: ExtResult = { tables: [summaryTable(run, r.k.wp || [])], forModel: forModelRun(run) };
      if (input.commentary === true) {
        ctx.progress("Writing the note on the risks");
        const fl = (run.checks as any[]).filter((c) => c.status === "flag").sort((a, c) => (a.rank ?? 99) - (c.rank ?? 99));
        out.aiText = await ctx.aiText("Write a short note (at most 200 words) for a chartered accountant on the audit risks below, most serious first: what each means for the tax audit (Form 3CD clause) and what to ask the client. Do not state any figure that is not given here; refer to checks by name.\n\n" +
          fl.map((c) => "Rank " + c.rank + ": " + c.title + " (" + c.law + "): " + c.count + " entries, " + inr(c.amount) + ".").join("\n"), { maxTokens: 1200 });
      }
      return out;
    },
  },
  {
    name: "audit_check",
    description: "One audit check's detail for the open client and a period: its entries (date, voucher, party, amount, why), status, count, amount and risk score, as FinCom worked them out on the Audit page. Use after audit_run, for 'show me the 40A(3) entries'.",
    input_schema: { type: "object", additionalProperties: false, required: ["client", "period", "check"], properties: {
      client: { type: ["string", "null"], description: "the client's name or id; null for the client open in FinCom" },
      period: STR_N,
      check: { type: "string", enum: CHECKS.map(([id]) => id), description: CHECKS.map(([id, t]) => id + ": " + t).join("; ") } } },
    task: "heavy",
    label: "books",
    words: /\b(40A\(3\)|269ST|269SS|269T|43B\(h\)|benford)\b/i,
    run: async (input, ctx): Promise<ExtResult> => {
      const id = String(input.check || "");
      if (!CHECKS.some(([c]) => c === id)) return { error: "check must be one of " + CHECKS.map(([c]) => c).join(", ") };
      const r = await kept(input, ctx);
      if ("error" in r) return { error: r.error };
      const t = checkTable(r.k.run, id);
      if (!t) return { error: "That check is not in the run kept for this period; run the audit again on the Audit page." };
      const s = t.summary as Record<string, unknown>;
      return { tables: [t], forModel: "Check " + id + " (" + String(s.status) + "): " + s.count + " entries, " + inr(Number(s.amount)) + ", risk score " + s.score + (s.rank ? ", rank " + s.rank : "") + "; the entries are shown to the user as a table. Quote these figures only." };
    },
  },
];
