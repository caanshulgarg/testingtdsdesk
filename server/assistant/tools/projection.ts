// Projected statements (the owner, 13-Nov-2026: asked Ask FinCom 4-5 times to "prepare a projected balance sheet" and it
// never made one, asking again what they had already said; "do it with its own mind"). One call makes them: the client's
// last full year of books as FinCom's Schedule III engine (FSX, the Reports screen's, as dcf_model uses) works it out, then
// each projected year from the assumptions; every assumption the user did not give is FinCom's default, taken from the
// books' own trend and said in the Assumptions table. Nothing is asked first: the user changes an assumption and asks again.
//   - revenue grows at last year's growth (kept between -10% and 25%; 10% with no earlier year);
//   - each cost keeps last year's share of revenue; other income stays the same;
//   - depreciation at last year's rate on the opening block; no capital expenditure, no new loans, no repayment, no
//     dividend or drawings, unless the user gives them;
//   - receivables, inventories and payables keep their ratio to revenue (or the days the user gives);
//   - tax at last year's effective rate (25.17% for a company, 31.2% otherwise, when last year had no profit or no tax);
//   - interest at last year's rate on the borrowings; the other balance sheet heads as at the base year's end;
//   - the profit goes to reserves (a company) or the capital account; cash is what balances the balance sheet, and a gap
//     is shown as bank borrowing (short-term), never as negative cash.
// The figures are FinCom's arithmetic on the books, labelled "projection" (not "checked against the books").
import type { ExtCtx, ExtResult, ExtTool, ToolTable } from "./types.ts";
import { fyOf, inputFor } from "./reports.ts";
// deno-lint-ignore no-explicit-any
const FSX: any = (globalThis as any).FSX;

export type Lines = Record<string, number>;          // a Schedule III line id (FSX.LINES) -> rupees
export type Assume = {
  years?: number | null, revenue_growth_pct?: number[] | null, material_cost_pct?: number | null, employee_cost_pct?: number | null,
  other_expenses_pct?: number | null, tax_rate_pct?: number | null, capex?: number[] | null, new_loans?: number[] | null,
  loan_repayment?: number[] | null, dividend_or_drawings?: number[] | null, receivable_days?: number | null, inventory_days?: number | null,
  payable_days?: number | null, other_assumptions?: string[] | null,
};
type Year = { fy: number, kind: "actual" | "estimated" | "projected", l: Lines, cf?: Lines, gap?: number };
export type Projection = { base: Year, years: Year[], assumptions: string[], kind: string };

const LIAB = ["share", "capital", "current", "reserves", "ltb", "dtl", "oltl", "ltp", "stb", "tp", "ocl", "stp"];
const ASSET = ["ppe", "intang", "cwip", "nci", "dta", "ltla", "onca", "ci", "inv", "tr", "cash", "stla", "oca"];
const r1 = (v: number) => Math.round(v * 10) / 10;
const pc = (v: number) => r1(v * 100) + "%";
const fyL = (y: number) => y + "-" + String((y + 1) % 100).padStart(2, "0");
const at = (a: number[] | null | undefined, i: number, d = 0) => (Array.isArray(a) && a.length ? Number(a[Math.min(i, a.length - 1)]) || 0 : d);
const sum = (l: Lines, ks: string[]) => ks.reduce((s, k) => s + (l[k] || 0), 0);
const lakh = (v: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(v));
export const costOf = (l: Lines) => (l.mat || 0) + (l.pur || 0) + (l.chg || 0);
export const pbtOf = (l: Lines) => (l.rev || 0) + (l.oth || 0) - costOf(l) - (l.emp || 0) - (l.fin || 0) - (l.dep || 0) - (l.exp || 0) - (l.exc || 0) - (l.xo || 0);

// the base year's lines from FSX's model (paise, CY and PY)
export function linesOf(nm: Record<string, number>, y: "CY" | "PY"): Lines {
  const out: Lines = {};
  for (const z of FSX.LINES) out[z.id] = (Number(nm["L_" + z.id + "_" + y]) || 0) / 100;
  return out;
}

// the projection: base (the last full year in the books), py (the year before it, for the trend), the user's assumptions
export function project(base: Lines, py: Lines | null, baseFy: number, firstOpenFy: number, kind: string, A: Assume): Projection {
  const said: string[] = [];
  const rev0 = base.rev || 0, rev1 = py ? py.rev || 0 : 0;
  const n = Math.max(1, Math.min(5, Number(A.years) || Math.max(1, firstOpenFy + 1 - baseFy)));
  // revenue growth
  const trend = rev1 > 0 ? rev0 / rev1 - 1 : null;
  const g0 = trend == null ? 0.10 : Math.max(-0.10, Math.min(0.25, trend));
  const gs = Array.from({ length: n }, (_, i) => Array.isArray(A.revenue_growth_pct) && A.revenue_growth_pct.length ? at(A.revenue_growth_pct, i) / 100 : g0);
  said.push(Array.isArray(A.revenue_growth_pct) && A.revenue_growth_pct.length ? "Revenue growth as you said: " + gs.map(pc).join(", ") + "."
    : "Revenue grows " + pc(g0) + " a year: " + (trend == null ? "no earlier year in the books to take a trend from, so a moderate 10%." : "last year's growth was " + pc(trend) + (Math.abs(trend - g0) > 1e-9 ? ", kept within -10% to 25%." : ", carried forward.")));
  const share = (k: string[], given: number | null | undefined, words: string) => {
    const v = given != null ? given / 100 : rev0 ? sum(base, k) / rev0 : 0;
    said.push(words + " " + pc(v) + " of revenue" + (given != null ? " (as you said)." : " (last year's ratio)."));
    return v;
  };
  const cm = share(["mat", "pur", "chg"], A.material_cost_pct, "Cost of materials and goods (net of stock change):");
  const em = share(["emp"], A.employee_cost_pct, "Employee costs:");
  const ox = share(["exp"], A.other_expenses_pct, "Other expenses:");
  said.push("Other income stays at " + lakh(base.oth || 0) + " a year; no exceptional items.");
  // depreciation: last year's rate on the opening block
  const nb = (l: Lines) => (l.ppe || 0) + (l.intang || 0);
  const open0 = py && nb(py) > 0 ? nb(py) : nb(base) + (base.dep || 0);
  const dr = open0 > 0 ? Math.min(0.6, (base.dep || 0) / open0) : 0;
  said.push("Depreciation at " + pc(dr) + " of the opening fixed assets (last year's rate).");
  const capex = (i: number) => at(A.capex, i);
  said.push(Array.isArray(A.capex) && A.capex.length ? "Capital expenditure as you said: " + Array.from({ length: n }, (_, i) => lakh(capex(i))).join(", ") + "." : "No new fixed assets (capital expenditure nil).");
  // borrowings and interest
  const debt = (l: Lines) => (l.ltb || 0) + (l.stb || 0);
  const avg0 = py ? (debt(py) + debt(base)) / 2 : debt(base);
  const ir = avg0 > 0 ? Math.min(0.30, (base.fin || 0) / avg0) : 0;
  const newL = (i: number) => at(A.new_loans, i), rep = (i: number) => at(A.loan_repayment, i);
  said.push((Array.isArray(A.new_loans) && A.new_loans.length ? "New loans as you said: " + Array.from({ length: n }, (_, i) => lakh(newL(i))).join(", ") : "No new loans") + "; " +
    (Array.isArray(A.loan_repayment) && A.loan_repayment.length ? "loan repayment as you said: " + Array.from({ length: n }, (_, i) => lakh(rep(i))).join(", ") : "no repayment of term loans") + ".");
  said.push(avg0 > 0 ? "Interest at " + pc(ir) + " of the average borrowings (last year's rate)." : "Finance costs stay at " + lakh(base.fin || 0) + " (no borrowings to take a rate from).");
  // tax
  const pbt0 = pbtOf(base), eff = pbt0 > 0 ? (base.tax || 0) / pbt0 : 0;
  const tr = A.tax_rate_pct != null ? A.tax_rate_pct / 100 : eff > 0.05 && eff < 0.5 ? eff : kind === "company" ? 0.2517 : 0.312;
  said.push("Tax at " + pc(tr) + " of the profit before tax" + (A.tax_rate_pct != null ? " (as you said)." : eff > 0.05 && eff < 0.5 ? " (last year's effective rate)." : kind === "company" ? " (section 115BAA rate with surcharge and cess)." : " (30% with cess)."));
  // working capital
  const wc = (k: string, days: number | null | undefined, on: (l: Lines) => number, words: string) => {
    const ratio = days != null ? days / 365 : (on(base) ? (base[k] || 0) / on(base) : 0);
    said.push(words + (days != null ? " at " + days + " days (as you said)." : " keep last year's " + Math.round(ratio * 365) + " days."));
    return ratio;
  };
  const trR = wc("tr", A.receivable_days, (l) => l.rev || 0, "Trade receivables");
  const invR = wc("inv", A.inventory_days, (l) => costOf(l) || l.rev || 0, "Inventories");
  const tpR = wc("tp", A.payable_days, (l) => costOf(l) + (l.exp || 0) || l.rev || 0, "Trade payables");
  const div = (i: number) => at(A.dividend_or_drawings, i);
  const toCap = kind !== "company" && !(base.share || 0) ? ((base.current || 0) ? "current" : "capital") : "reserves";
  said.push((Array.isArray(A.dividend_or_drawings) && A.dividend_or_drawings.length ? (toCap === "reserves" ? "Dividend" : "Drawings") + " as you said: " + Array.from({ length: n }, (_, i) => lakh(div(i))).join(", ") + "; " : (toCap === "reserves" ? "No dividend" : "No drawings") + "; ") +
    "the profit goes to " + (toCap === "reserves" ? "reserves and surplus." : "the partners'/proprietor's " + (toCap === "current" ? "current account." : "capital account.")));
  said.push("Investments, loans and advances, other current assets and liabilities, provisions and deferred tax stay as at 31-Mar-" + (baseFy + 1) + "; cash and bank is the balancing figure, and any shortfall is shown as bank borrowing (short-term).");
  for (const s of (A.other_assumptions || []).slice(0, 10)) if (String(s || "").trim()) said.push(String(s).trim().slice(0, 300) + " (as you said; not in the figures unless covered above).");

  const years: Year[] = [];
  let prev = base;
  for (let i = 0; i < n; i++) {
    const l: Lines = {};
    for (const k of [...LIAB, ...ASSET]) l[k] = prev[k] || 0;
    l.rev = (prev.rev || 0) * (1 + gs[i]);
    l.oth = base.oth || 0;
    l.mat = l.rev * cm; l.pur = 0; l.chg = 0; l.emp = l.rev * em; l.exp = l.rev * ox; l.exc = 0; l.xo = 0;
    const open = nb(prev);
    l.dep = open * dr;
    l.ppe = (prev.ppe || 0) * (1 - dr) + capex(i); l.intang = (prev.intang || 0) * (1 - dr);
    l.ltb = Math.max(0, (prev.ltb || 0) + newL(i) - rep(i));
    l.stb = prev.stb || 0;
    l.fin = avg0 > 0 ? ir * (debt(prev) + debt(l)) / 2 : base.fin || 0;
    const pbt = pbtOf(l);
    l.tax = Math.max(0, pbt) * tr;
    const pat = pbt - l.tax;
    l.tr = l.rev * trR; l.inv = (costOf(l) || l.rev) * invR; l.tp = (costOf(l) + l.exp || l.rev) * tpR;
    l[toCap] = (prev[toCap] || 0) + pat - div(i);
    let cash = sum(l, LIAB) - sum(l, ASSET.filter((k) => k !== "cash")), gap = 0;
    if (cash < 0) { gap = -cash; l.stb += gap; cash = 0; }
    l.cash = cash;
    const cf: Lines = { pat, dep: l.dep, tr: -(l.tr - (prev.tr || 0)), inv: -(l.inv - (prev.inv || 0)), tp: l.tp - (prev.tp || 0), capex: -capex(i),
      loans: l.ltb - (prev.ltb || 0), div: -div(i), gap, open: prev.cash || 0, close: l.cash };
    years.push({ fy: baseFy + 1 + i, kind: baseFy + 1 + i < firstOpenFy + 1 ? "estimated" : "projected", l, cf, gap });
    if (gap > 0) said.push(fyL(baseFy + 1 + i) + ": cash falls short by " + lakh(gap) + "; shown as bank borrowing (short-term), its interest not included.");
    prev = l;
  }
  return { base: { fy: baseFy, kind: "actual", l: base }, years, assumptions: said, kind };
}

// the tables: profit and loss, balance sheet, cash flow, key ratios, assumptions
export function tablesOf(p: Projection): ToolTable[] {
  const all = [p.base, ...p.years];
  const cols = [{ k: "item", label: "Particulars" }, ...all.map((y, i) => ({ k: "y" + i, label: fyL(y.fy) + " (" + y.kind + ")", t: "amount" as const }))];
  const row = (item: string, f: ((y: Year) => number | null) | null) => Object.assign({ item }, ...all.map((y, i) => ({ ["y" + i]: f ? (() => { const v = f(y); return v == null ? null : Math.round(v); })() : null })));
  const L = (k: string) => (y: Year) => y.l[k] || 0;
  const name = (id: string) => (FSX.LINES.find((z: any) => z.id === id) || { face: id }).face;
  const per = { from: (p.years[0].fy) + "-04-01", to: (p.years[p.years.length - 1].fy + 1) + "-03-31" };
  const basis = "FinCom's projection from the books of " + fyL(p.base.fy) + " (Schedule III, as the Reports screen works it out) and the assumptions listed";
  const pl: ToolTable = { tool: "projected_statements", title: "Projected profit and loss", columns: cols, period: per, basis, label: "projection", rows: [
    row("Revenue from operations", L("rev")), row("Other income", L("oth")), row("Total income", (y) => (y.l.rev || 0) + (y.l.oth || 0)),
    row("Cost of materials and goods (net of stock change)", (y) => costOf(y.l)), row(name("emp"), L("emp")), row(name("fin"), L("fin")), row(name("dep"), L("dep")),
    row(name("exp"), L("exp")), row("Exceptional and extraordinary items", (y) => (y.l.exc || 0) + (y.l.xo || 0)), row("Profit before tax", (y) => pbtOf(y.l)), row("Tax", L("tax")),
    row("Profit after tax", (y) => pbtOf(y.l) - (y.l.tax || 0))] };
  const lines = (ks: string[]) => ks.filter((k) => all.some((y) => Math.round(y.l[k] || 0))).map((k) => row(name(k), L(k)));
  const tot = (ks: string[]) => (y: Year) => sum(y.l, ks);
  const bs: ToolTable = { tool: "projected_statements", title: "Projected balance sheet (as at 31 March)", columns: cols, period: per, basis, label: "projection", rows: [
    row("EQUITY AND LIABILITIES", null), ...lines(["share", "capital", "current", "reserves"]), ...lines(["ltb", "dtl", "oltl", "ltp"]), ...lines(["stb", "tp", "ocl", "stp"]),
    row("Total equity and liabilities", tot(LIAB)), row("ASSETS", null), ...lines(["ppe", "intang", "cwip", "nci", "dta", "ltla", "onca"]), ...lines(["ci", "inv", "tr", "cash", "stla", "oca"]),
    row("Total assets", tot(ASSET))] };
  const C = (k: string) => (y: Year) => (y.cf ? y.cf[k] : null);
  const cf: ToolTable = { tool: "projected_statements", title: "Projected cash flow", columns: cols, period: per, basis, label: "projection", rows: [
    row("Profit after tax", C("pat")), row("Add: depreciation", C("dep")), row("(Increase) in trade receivables", C("tr")), row("(Increase) in inventories", C("inv")),
    row("Increase in trade payables", C("tp")), row("Capital expenditure", C("capex")), row("Term loans taken less repaid", C("loans")), row("Dividend or drawings", C("div")),
    row("Bank borrowing to meet the shortfall", C("gap")), row("Opening cash and bank", C("open")), row("Closing cash and bank", C("close"))] };
  const eq = (y: Year) => sum(y.l, ["share", "capital", "current", "reserves"]);
  const ca = (y: Year) => sum(y.l, ["ci", "inv", "tr", "cash", "stla", "oca"]), cl = (y: Year) => sum(y.l, ["stb", "tp", "ocl", "stp"]);
  const rat = (item: string, f: (y: Year) => number | null) => ({ item, ...Object.fromEntries(all.map((y, i) => { const v = f(y); return ["y" + i, v == null || !isFinite(v) ? "-" : (Math.round(v * 100) / 100).toFixed(2)]; })) });
  const ratios: ToolTable = { tool: "projected_statements", title: "Key ratios", columns: cols.map((c, i) => i ? { k: c.k, label: c.label } : c), period: per, basis, label: "projection", rows: [
    rat("Current ratio", (y) => cl(y) ? ca(y) / cl(y) : null), rat("Debt / equity", (y) => eq(y) ? ((y.l.ltb || 0) + (y.l.stb || 0)) / eq(y) : null),
    rat("Net profit (% of revenue)", (y) => y.l.rev ? (pbtOf(y.l) - (y.l.tax || 0)) / y.l.rev * 100 : null)] };
  const as: ToolTable = { tool: "projected_statements", title: "Assumptions (tell me any to change and I'll redo it)", columns: [{ k: "n", label: "No.", t: "int" }, { k: "item", label: "Assumption" }], label: "projection",
    rows: p.assumptions.map((item, i) => ({ n: i + 1, item })) };
  return [pl, bs, cf, ratios, as];
}

// the Excel: one sheet per table, whole rupees, the assumptions first
export function excelOf(p: Projection, client: string): Uint8Array {
  const ts = tablesOf(p), [pl, bs, cf, ratios, as] = ts;
  const head = (t: ToolTable) => [[String(client || "").toUpperCase()], [t.title + " - PROJECTED, prepared by FinCom from the books of " + fyL(p.base.fy) + " and the assumptions listed; not audited"], [FSX.UNITS], []];
  const sheet = (nm: string, t: ToolTable) => ({ name: nm, widths: [52, ...t.columns.slice(1).map(() => 20)],
    rows: [...head(t), t.columns.map((c) => ({ v: c.label, s: 1 })), ...t.rows.map((r) => t.columns.map((c, i) => i ? (r[c.k] == null ? "" : { v: Number(r[c.k]), s: /^Total|after tax|Closing/.test(String(r.item)) ? 3 : 2 }) : { v: String(r.item), s: r.y0 == null && r.y1 == null ? 1 : 0 }))] });
  return FSX.xlsx([{ name: "Assumptions", widths: [6, 120], rows: [...head(as), [{ v: "No.", s: 1 }, { v: "Assumption", s: 1 }], ...as.rows.map((r) => [{ v: Number(r.n), s: 6 }, String(r.item)])] },
    sheet("Profit and loss", pl), sheet("Balance sheet", bs), sheet("Cash flow", cf), { name: "Key ratios", widths: [52, ...ratios.columns.slice(1).map(() => 20)], rows: [...head(ratios), ratios.columns.map((c) => ({ v: c.label, s: 1 })), ...ratios.rows.map((r) => ratios.columns.map((c) => String(r[c.k] ?? "")))] }], {});
}

const NUM = (d: string) => ({ type: ["number", "null"], description: d });
const ARR = (d: string) => ({ type: ["array", "null"], items: { type: "number" }, description: d });
const strict = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });

export const TOOLS: ExtTool[] = [{
  name: "projected_statements",
  description: "Prepare projected (or estimated) financial statements for the next year(s): profit and loss, balance sheet, cash flow and key ratios, with an Excel file. For a projected or estimated balance sheet or P&L, a forecast, projections for a bank loan, CMA data, or next year's figures. FinCom takes the client's last full year from the books and works out each year from the assumptions; every assumption you leave null is FinCom's default from the books' trend (last year's growth, the same cost ratios and days, no new loans, no capex, last year's tax rate), and all are listed in the Assumptions table. Call it at once, with what the user said in this conversation; never ask for assumptions first. Amounts in rupees; percentages as numbers (12 for 12%).",
  input_schema: strict({ client: { type: ["string", "null"], description: "the client (the one open when null)" }, base_year: { type: ["string", "null"], description: "the actual year to start from, e.g. 2025-26 (null: the last full year in the books)" },
    assumptions: strict({ years: NUM("how many years to project (null: to the end of next financial year; at most 5)"), revenue_growth_pct: ARR("revenue growth % for each year (the last repeats)"),
      material_cost_pct: NUM("cost of materials and goods, % of revenue"), employee_cost_pct: NUM("employee costs, % of revenue"), other_expenses_pct: NUM("other expenses, % of revenue"),
      tax_rate_pct: NUM("tax rate %"), capex: ARR("new fixed assets each year, rupees"), new_loans: ARR("new term loans each year, rupees"), loan_repayment: ARR("term loan repaid each year, rupees"),
      dividend_or_drawings: ARR("dividend (company) or drawings (firm, proprietor) each year, rupees"), receivable_days: NUM("debtors' days on revenue"), inventory_days: NUM("stock days on cost of goods"),
      payable_days: NUM("creditors' days on cost of goods and expenses"), other_assumptions: { type: ["array", "null"], items: { type: "string" }, description: "anything else the user said, listed as given" } }) }),
  task: "heavy", label: "books",
  words: /\b(projected|projections?|forecast(ed|s)?|cma(\s+data)?|pro[\s-]?forma|estimated\s+(balance\s*sheet|p\s*&\s*l|profit|financials?|statements?)|budgeted\s+(balance\s*sheet|p\s*&\s*l|profit))\b/i,
  async run(input, ctx: ExtCtx): Promise<ExtResult> {
    const today = ctx.today, open = Number(fyOf(null, today)) + 1;           // the financial year now running
    const want = input.base_year ? Number(fyOf(input.base_year, today)) : null;
    let got: any = null, fy = 0;
    for (const y of want ? [want] : [open - 1, open - 2, open - 3]) {
      const g = await inputFor(ctx, String(y));
      if (!("error" in g)) { got = g; fy = y; break; }
    }
    if (!got) return { error: "No full year of books for " + (ctx.clientName || "this client") + (want ? " for " + fyL(want) : " in the last three years") + ": link its Tally company or upload its books, then ask again." };
    const M = FSX.run(got.inp).model;
    const base = linesOf(M.nm, "CY"), pyL = linesOf(M.nm, "PY"), py = Object.values(pyL).some((v) => v) ? pyL : null;
    const kind = String(got.inp.entity.kind || "company");
    const p = project(base, py, fy, open, kind, (input.assumptions || {}) as Assume);
    const tables = tablesOf(p);
    const name = String(ctx.clientName || "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client";
    const f = await ctx.uploadFile(excelOf(p, ctx.clientName), name + "-projected-" + fyL(p.years[0].fy) + "-to-" + fyL(p.years[p.years.length - 1].fy) + ".xlsx", "xlsx");
    const last = p.years[p.years.length - 1];
    return { tables, files: f ? [f] : [],
      forModel: JSON.stringify({ shown: "Projected profit and loss, balance sheet, cash flow, key ratios and the assumptions are shown to the user as tables" + (f ? ", with the Excel file" : ""),
        base_year: fyL(fy) + " (actual, from the books)", years: p.years.map((y) => fyL(y.fy) + " (" + y.kind + ")"),
        last_year: { revenue: Math.round(last.l.rev), profit_after_tax: Math.round(pbtOf(last.l) - last.l.tax), total_assets: Math.round(sum(last.l, ASSET)), cash: Math.round(last.l.cash), bank_gap: Math.round(last.gap || 0) },
        assumptions: p.assumptions,
        say: "In two or three lines say what was prepared and the main points; then list the assumptions in short bullets; end with: Tell me any assumption to change and I'll redo it. Do not copy the tables." }) };
  },
}];
