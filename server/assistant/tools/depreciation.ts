// The Assistant's depreciation tool (docs/assistant-tools.md): depreciation_schedule. Every figure is worked out by FAR
// (src/js/80-assets.js), the same code the app's Fixed assets & depreciation tab runs, over the register the app keeps
// for the client and year, read back by migration 81's asst_dep_register (SECURITY INVOKER, STABLE: row-level security,
// read only). The model never supplies a figure; nothing writes to the books or to Tally (the journal entry is a
// suggestion). Returns tables (label "books"), the Excel (live formulas) and a short summary for the model.
// Registered in tools/index.ts after the reports.
import "../../../src/js/80-assets.js";
import "../../../src/js/78-reports.js";
import type { ExtTool, ToolTable } from "./types.ts";
import { fyOf } from "./reports.ts";
// deno-lint-ignore no-explicit-any
const FAR: any = (globalThis as any).FAR;
// deno-lint-ignore no-explicit-any
const FSX: any = (globalThis as any).FSX;
const safe = (s: string) => String(s || "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client";
const strict = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });

// FAR's table as the panel's: every amount to the paisa, the rate and life as words
// deno-lint-ignore no-explicit-any
function toTable(t: any, period: { from: string, to: string }, basis: string): ToolTable {
  const cols = t.cols.map((c: [string, number], i: number) => ({ k: "c" + i, label: c[0], t: c[1] && !(t.skip || []).includes(i) ? "amount" as const : "text" as const }));
  const rows = t.rows.map((r: unknown[]) => Object.fromEntries(r.map((v, i) => [("c" + i), cols[i].t === "amount" ? (typeof v === "number" ? Math.round(v * 100) / 100 : null) : String(v == null ? "" : v)])));
  return { tool: "depreciation_schedule", title: t.title, columns: cols, rows, period, basis };
}

export const TOOLS: ExtTool[] = [{
  name: "depreciation_schedule",
  description: "The client's depreciation for a year from the fixed asset register kept in FinCom: under the Companies Act (Schedule II useful lives, SLM or WDV, per asset and per class, gain or loss on sales), under the Income-tax Act (section 32 blocks: opening WDV, additions over and under 180 days, sale value, STCG / STCL, additional depreciation), the deferred tax working and the suggested journal entry (never posted). Use for 'depreciation', 'fixed asset schedule', 'block of assets', 'WDV', 'Schedule II', '3CD clause 18'.",
  input_schema: strict({
    client: { type: ["string", "null"], description: "the client (the one open when null)" },
    year: { type: ["string", "null"], description: "the financial year, e.g. 2025-26 (the last year ended when null)" },
    basis: { type: ["string", "null"], enum: ["companies_act", "income_tax", "both", null], description: "which schedules (both when null)" },
  }),
  task: "heavy", label: "books", words: /\b(depreciation|fixed asset (schedule|register)|block of assets|written down value|wdv|schedule ii|clause 18)\b/i,
  async run(input, ctx) {
    const fy = fyOf(input.year, ctx.today), basis = String(input.basis || "both"), period = { from: fy + "-04-01", to: (Number(fy) + 1) + "-03-31" };
    let got;
    try { got = await ctx.rpc("asst_dep_register", { p_client: ctx.clientId, p_fy: fy }); } catch (_e) { got = null; }
    const reg = got && got.reg;
    if (!reg || !(reg.assets || []).length) {
      const years = ((got && got.years) || []).map((y: string) => FAR.fyLabel(y));
      return { error: "No fixed asset register is kept in FinCom for " + FAR.fyLabel(fy) + (years.length ? " (kept for " + years.join(", ") + ")" : "") + ". Open the client's Books, Accounts, Fixed assets & depreciation once: the register is proposed from the books and kept." };
    }
    const res = FAR.compute(reg, got.prev || null), T = FAR.tables(res);
    const by = (id: string) => T.find((t: { id: string }) => t.id === id);
    const from = "the fixed asset register kept in FinCom for " + FAR.fyLabel(fy) + (res.hasPrev ? " (opening from " + FAR.fyLabel(Number(fy) - 1) + "'s register)" : "");
    const tables: ToolTable[] = [];
    if (basis !== "income_tax") tables.push(toTable(by("classes"), period, from), toTable(by("assets"), period, from));
    if (basis !== "companies_act") tables.push(toTable(by("blocks"), period, from));
    if (basis === "both") tables.push(toTable(by("dt"), period, from));
    if (basis !== "income_tax") tables.push(toTable(by("je"), period, from));
    const pending = (res.confirm || []).length;
    tables[0].summary = { companies_act_depreciation: res.totals.dep, income_tax_depreciation: res.totals.itDep, additional_depreciation: res.totals.itAddl, closing_wdv: res.totals.itClose,
      deferred_tax_movement: res.dt.move, gain_on_sale: res.totals.gain, to_confirm: pending };
    const name = ctx.clientName, base = safe(name) + "-depreciation-" + FAR.fyLabel(fy);
    const f = await ctx.uploadFile(FSX.xlsx(FAR.sheets(res, { name }), {}), base + ".xlsx", "xlsx");
    const ca = "Companies Act depreciation " + res.totals.dep + " (" + res.settings.method + ", residual " + res.settings.residualPct + "%)", it = "income-tax depreciation " + res.totals.itDep + (res.totals.itAddl ? " and additional " + res.totals.itAddl : "") + ", closing WDV " + res.totals.itClose;
    return { tables, files: f ? [f] : [],
      forModel: "Fixed assets " + FAR.fyLabel(fy) + ": " + (basis === "income_tax" ? it : basis === "companies_act" ? ca : ca + "; " + it + "; deferred tax movement " + res.dt.move) + ". " +
        (pending ? pending + " points in the register are still to be confirmed in FinCom (the figures use the proposals meanwhile)." : "Every point of the register is confirmed.") + " The journal entry is a suggestion; nothing is posted." };
  },
}];
