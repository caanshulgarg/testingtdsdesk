// Projected statements (the owner, 13-Nov-2026: asked Ask FinCom 4-5 times to "prepare a projected balance sheet" and it
// never made one, asking again what they had already said; "do it with its own mind"). One call makes them: the client's
// last complete year of books as FinCom's Schedule III engine (FSX, the Reports screen's, as dcf_model uses) works it out,
// then each projected year from the assumptions; every assumption the user did not give is FinCom's default, taken from the
// books' own trend and said in the Assumptions table. Nothing is asked first: the user changes an assumption and asks again.
//   - revenue grows at last year's growth (kept between -10% and 25%; 10% with no earlier year); the running year's books to
//     date, annualised, set its growth when they hold three months or more;
//   - each cost and each working-capital balance moves with revenue (last year's amount x the growth: the same ratio to
//     revenue, and the same amounts grown when last year had no or very small sales); other income stays the same;
//   - depreciation at last year's rate on the opening block; no capex, no new loans, no repayment, no dividend or drawings,
//     unless the user gives them; tax at last year's effective rate (25.17% company, 31.2% otherwise, when none);
//   - interest at last year's rate on the borrowings; the other heads as at the base year's end; the profit to reserves (a
//     company) or the capital account; cash balances the balance sheet, a shortfall is shown as bank borrowing;
//   - the base year is a complete year (a partial one is annualised and said; the running or a future year is refused);
//   - what is wrong in the books (a difference in the trial balance, ledgers not placed, failed checks) is said first and
//     kept as its own line, never absorbed into reserves or cash.
// The figures are FinCom's arithmetic on the books, labelled "projection" (not "checked against the books").
import type { ExtCtx, ExtResult, ExtTool, ToolTable } from "./types.ts";
import { fyOf, inputFor } from "./reports.ts";
import { manyOf, numOf, oneOf } from "./num.ts";
export { numOf };
// deno-lint-ignore no-explicit-any
const FSX: any = (globalThis as any).FSX;

export type Lines = Record<string, number>;          // a Schedule III line id (FSX.LINES) -> rupees
export type Assume = Record<string, unknown>;        // the tool's assumptions as given (numbers or text such as "25%"); clean() reads them
type Year = { fy: number, kind: string, l: Lines, cf?: Lines, gap?: number };
export type Projection = { base: Year, years: Year[], assumptions: string[], warnings: string[], kind: string };
export type Base = { fy: number, months: number, kind: string, warnings: string[], ytd?: { months: number, rev: number } | null };

const LIAB = ["share", "capital", "current", "reserves", "ltb", "dtl", "oltl", "ltp", "stb", "tp", "ocl", "stp"];
const ASSET = ["ppe", "intang", "cwip", "nci", "dta", "ltla", "onca", "ci", "inv", "tr", "cash", "stla", "oca"];
const PL = ["rev", "oth", "mat", "pur", "chg", "emp", "fin", "dep", "exp", "exc", "xo", "tax"];
const r1 = (v: number) => Math.round(v * 10) / 10;
const pc = (v: number) => r1(v * 100) + "%";
const fyL = (y: number) => y + "-" + String((y + 1) % 100).padStart(2, "0");
const sum = (l: Lines, ks: string[]) => ks.reduce((s, k) => s + (l[k] || 0), 0);
const fin = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);
const rs = (v: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(fin(v)));
export const costOf = (l: Lines) => (l.mat || 0) + (l.pur || 0) + (l.chg || 0);
export const pbtOf = (l: Lines) => (l.rev || 0) + (l.oth || 0) - costOf(l) - (l.emp || 0) - (l.fin || 0) - (l.dep || 0) - (l.exp || 0) - (l.exc || 0) - (l.xo || 0);

// ---------------------------------------------------------------- the user's assumptions, read and bounded
type Clean = { years: number | null, growth: number[] | null, mat: number | null, emp: number | null, exp: number | null, tax: number | null, capex: number[] | null, loans: number[] | null,
  repay: number[] | null, div: number[] | null, trDays: number | null, invDays: number | null, tpDays: number | null, other: string[] };
// each value checked against its range: outside it, the nearest bound is used and said; not a number, it is left out and said
export function clean(A: Assume, notes: string[]): Clean {
  const one = (k: string, lo: number, hi: number, words: string, int = false) => oneOf(A[k], lo, hi, words, notes, int);
  const many = (k: string, lo: number, hi: number, words: string) => manyOf(A[k], lo, hi, words, notes);
  const BIG = 1e13;
  return { years: one("years", 1, 5, "Years to project", true), growth: many("revenue_growth_pct", -50, 200, "Revenue growth %"),
    mat: one("material_cost_pct", 0, 100, "Cost of materials %"), emp: one("employee_cost_pct", 0, 100, "Employee costs %"), exp: one("other_expenses_pct", 0, 100, "Other expenses %"),
    tax: one("tax_rate_pct", 0, 60, "Tax rate %"), capex: many("capex", 0, BIG, "Capital expenditure"), loans: many("new_loans", 0, BIG, "New loans"), repay: many("loan_repayment", 0, BIG, "Loan repayment"),
    div: many("dividend_or_drawings", 0, BIG, "Dividend or drawings"), trDays: one("receivable_days", 0, 730, "Debtors' days"), invDays: one("inventory_days", 0, 730, "Stock days"),
    tpDays: one("payable_days", 0, 730, "Creditors' days"), other: (Array.isArray(A.other_assumptions) ? A.other_assumptions : []).map((s) => String(s || "").trim()).filter(Boolean).slice(0, 10) };
}
const at = (a: number[] | null, i: number) => (a && a.length ? a[Math.min(i, a.length - 1)] : 0);

// the base year's lines from FSX's model (paise, CY and PY)
export function linesOf(nm: Record<string, number>, y: "CY" | "PY"): Lines {
  const out: Lines = {};
  for (const z of FSX.LINES) out[z.id] = fin(Number(nm["L_" + z.id + "_" + y]) / 100);
  return out;
}

// ---------------------------------------------------------------- the projection
// base: the base year's lines (P&L already annualised when b.months < 12), py: the year before (for the trend)
export function project(base: Lines, py: Lines | null, b: Base, firstOpenFy: number, A0: Assume): Projection {
  const said: string[] = [], warnings = [...b.warnings], kind = b.kind, baseFy = b.fy;
  const A = clean(A0 || {}, said);
  const rev0 = base.rev || 0, rev1 = py ? py.rev || 0 : 0;
  const n = A.years ?? Math.max(1, Math.min(5, firstOpenFy + 1 - baseFy));
  if (b.months < 12) said.push(fyL(baseFy) + " is taken from " + b.months + " months of books, its profit and loss annualised (x 12/" + b.months + "); its balance sheet is as on the last entry.");
  // revenue growth
  const trend = rev1 > 0 && rev0 > 0 ? rev0 / rev1 - 1 : null;
  const g0 = trend == null ? 0.10 : Math.max(-0.10, Math.min(0.25, trend));
  const ytdG = !A.growth && b.ytd && b.ytd.months >= 3 && rev0 > 0 ? Math.max(-0.5, Math.min(2, b.ytd.rev * 12 / b.ytd.months / rev0 - 1)) : null;
  const gs = Array.from({ length: n }, (_, i) => A.growth ? at(A.growth, i) / 100 : i === 0 && ytdG != null && baseFy + 1 === firstOpenFy ? ytdG : g0);
  if (A.growth) said.push("Revenue growth as you said: " + gs.map(pc).join(", ") + ".");
  else {
    if (ytdG != null && baseFy + 1 === firstOpenFy) said.push(fyL(firstOpenFy) + ": revenue " + (ytdG >= 0 ? "grows " : "falls ") + pc(Math.abs(ytdG)) + ", from this year's books to date (" + b.ytd!.months + " months, " + rs(b.ytd!.rev) + ", annualised).");
    said.push((ytdG != null && baseFy + 1 === firstOpenFy ? "Later years: revenue grows " : "Revenue grows ") + pc(g0) + " a year: " + (trend == null ? "no earlier year with sales in the books to take a trend from, so a moderate 10%." : "last year's growth was " + pc(trend) + (Math.abs(trend - g0) > 1e-9 ? ", capped at " + pc(g0) + " (FinCom keeps a default within -10% to 25%)." : ", carried forward.")));
  }
  const idx: number[] = [];                   // revenue of each year against the base year's (the cumulative growth)
  gs.forEach((g, i) => idx.push((i ? idx[i - 1] : 1) * (1 + g)));
  // sales too small to carry ratios (nil, or under 5% of the costs): the amounts themselves are grown
  const costs0 = costOf(base) + (base.emp || 0) + (base.exp || 0);
  const thin = rev0 <= 0 || rev0 < 0.05 * costs0;
  if (thin) said.push("Sales in " + fyL(baseFy) + " were " + (rev0 > 0 ? "very small (" + rs(rev0) + ")" : "nil") + ", so each cost and each balance of debtors, stock and creditors is last year's amount grown at the rate above, not a share of sales.");
  const cost = (k: string[], given: number | null, words: string) => {
    if (given != null) { said.push(words + " " + r1(given) + "% of revenue (as you said)."); return (i: number, rev: number) => rev * given / 100; }
    const amt = sum(base, k);
    if (!thin) said.push(words + " " + pc(amt / rev0) + " of revenue (last year's ratio).");
    return (i: number) => amt * idx[i];
  };
  const cm = cost(["mat", "pur", "chg"], A.mat, "Cost of materials and goods (net of stock change):");
  const em = cost(["emp"], A.emp, "Employee costs:");
  const ox = cost(["exp"], A.exp, "Other expenses:");
  said.push("Other income stays at " + rs(base.oth || 0) + " a year; no exceptional items.");
  // depreciation: last year's rate on the opening block
  const nb = (l: Lines) => (l.ppe || 0) + (l.intang || 0);
  const open0 = py && nb(py) > 0 ? nb(py) : nb(base) + (base.dep || 0);
  const dr0 = open0 > 0 ? (base.dep || 0) / open0 : 0, dr = Math.min(0.6, dr0);
  said.push("Depreciation at " + pc(dr) + " of the opening fixed assets (last year's rate" + (dr0 > dr ? " of " + pc(dr0) + ", capped at 60%" : "") + ").");
  said.push(A.capex ? "Capital expenditure as you said: " + Array.from({ length: n }, (_, i) => rs(at(A.capex, i))).join(", ") + "." : "No new fixed assets (capital expenditure nil).");
  // borrowings and interest
  const debt = (l: Lines) => (l.ltb || 0) + (l.stb || 0);
  const avg0 = py ? (debt(py) + debt(base)) / 2 : debt(base);
  const ir0 = avg0 > 0 ? (base.fin || 0) / avg0 : 0, ir = Math.min(0.30, ir0);
  said.push((A.loans ? "New loans as you said: " + Array.from({ length: n }, (_, i) => rs(at(A.loans, i))).join(", ") : "No new loans") + "; " +
    (A.repay ? "term loans repaid as you said: " + Array.from({ length: n }, (_, i) => rs(at(A.repay, i))).join(", ") + " (never more than the loan outstanding)" : "no repayment of term loans") + ".");
  said.push(avg0 > 0 ? "Interest at " + pc(ir) + " of the average borrowings (last year's rate" + (ir0 > ir ? " of " + pc(ir0) + ", capped at 30%" : "") + ")." : "Finance costs stay at " + rs(base.fin || 0) + " (no borrowings to take a rate from).");
  // tax
  const pbt0 = pbtOf(base), eff = pbt0 > 0 ? (base.tax || 0) / pbt0 : 0, effOk = eff > 0.05 && eff < 0.5;
  const tr = A.tax != null ? A.tax / 100 : effOk ? eff : kind === "company" ? 0.2517 : 0.312;
  said.push("Tax at " + pc(tr) + " of the profit before tax" + (A.tax != null ? " (as you said)." : effOk ? " (last year's effective rate)." : kind === "company" ? " (section 115BAA rate with surcharge and cess)." : " (30% with cess)."));
  // working capital: with revenue (last year's days), or the days the user gives
  const wc = (k: string, days: number | null, on: (l: Lines) => number, words: string) => {
    if (days != null) { said.push(words + " at " + days + " days (as you said)."); return (i: number, l: Lines) => on(l) * days / 365; }
    const b0 = base[k] || 0;
    if (!thin) said.push(words + " keep last year's " + Math.round(b0 / rev0 * 365) + " days of sales.");
    return (i: number) => b0 * idx[i];
  };
  const trF = wc("tr", A.trDays, (l) => l.rev || 0, "Trade receivables");
  const invF = wc("inv", A.invDays, (l) => costOf(l), "Inventories");
  const tpF = wc("tp", A.tpDays, (l) => costOf(l) + (l.exp || 0), "Trade payables");
  const toCap = kind !== "company" && !(base.share || 0) ? ((base.current || 0) ? "current" : "capital") : "reserves";
  said.push((A.div ? (toCap === "reserves" ? "Dividend" : "Drawings") + " as you said: " + Array.from({ length: n }, (_, i) => rs(at(A.div, i))).join(", ") + "; " : (toCap === "reserves" ? "No dividend" : "No drawings") + "; ") +
    "the profit goes to " + (toCap === "reserves" ? "reserves and surplus." : "the partners'/proprietor's " + (toCap === "current" ? "current account." : "capital account.")));
  said.push("Investments, loans and advances, other current assets and liabilities, provisions and deferred tax stay as at the end of " + fyL(baseFy) + "; cash and bank is the balancing figure, and any shortfall is shown as bank borrowing (short-term).");
  // the books' own difference: kept as it is, apart, never in reserves or cash
  const diff = sum(base, LIAB) - sum(base, ASSET);
  if (Math.abs(diff) >= 1) warnings.unshift("The books do not balance by " + rs(Math.abs(diff)) + " (" + (diff > 0 ? "liabilities more than assets" : "assets more than liabilities") + "): shown as “Difference in the books”, carried unchanged; the figures may be off until it is reconciled.");
  for (const s of A.other) said.push(s.slice(0, 300) + " (as you said; not in the figures unless covered above).");

  const years: Year[] = [];
  let prev: Lines = { ...base, sus: diff };
  for (let i = 0; i < n; i++) {
    const l: Lines = { sus: diff };
    for (const k of [...LIAB, ...ASSET]) l[k] = prev[k] || 0;
    l.rev = rev0 * idx[i];
    l.oth = base.oth || 0;
    l.mat = cm(i, l.rev); l.pur = 0; l.chg = 0; l.emp = em(i, l.rev); l.exp = ox(i, l.rev); l.exc = 0; l.xo = 0;
    l.dep = nb(prev) * dr;
    l.ppe = (prev.ppe || 0) * (1 - dr) + at(A.capex, i); l.intang = (prev.intang || 0) * (1 - dr);
    const repaid = Math.min(prev.ltb || 0, at(A.repay, i));
    l.ltb = (prev.ltb || 0) + at(A.loans, i) - repaid;
    l.stb = prev.stb || 0;
    l.fin = avg0 > 0 ? ir * (debt(prev) + debt(l)) / 2 : base.fin || 0;
    const pbt = pbtOf(l);
    l.tax = Math.max(0, pbt) * tr;
    const pat = pbt - l.tax;
    l.tr = trF(i, l); l.inv = invF(i, l); l.tp = tpF(i, l);
    l[toCap] = (prev[toCap] || 0) + pat - at(A.div, i);
    let cash = sum(l, LIAB) - sum(l, ASSET.filter((k) => k !== "cash")) - diff, gap = 0;
    if (cash < 0) { gap = -cash; l.stb += gap; cash = 0; }
    l.cash = cash;
    for (const k of Object.keys(l)) l[k] = fin(l[k]);
    const cf: Lines = { pat, dep: l.dep, tr: -(l.tr - (prev.tr || 0)), inv: -(l.inv - (prev.inv || 0)), tp: l.tp - (prev.tp || 0), capex: -at(A.capex, i),
      loans: l.ltb - (prev.ltb || 0), div: -at(A.div, i), gap, open: prev.cash || 0, close: l.cash };
    for (const k of Object.keys(cf)) cf[k] = fin(cf[k]);
    years.push({ fy: baseFy + 1 + i, kind: baseFy + 1 + i < firstOpenFy + 1 ? "estimated" : "projected", l, cf, gap });
    if (gap > 0) said.push(fyL(baseFy + 1 + i) + ": cash falls short by " + rs(gap) + "; shown as bank borrowing (short-term), its interest not included.");
    prev = l;
  }
  return { base: { fy: baseFy, kind: b.months < 12 ? "actual, " + b.months + " months annualised" : "actual", l: { ...base, sus: diff } }, years, assumptions: said, warnings, kind };
}

// ---------------------------------------------------------------- the tables and the Excel
export function tablesOf(p: Projection): ToolTable[] {
  const all = [p.base, ...p.years];
  const cols = [{ k: "item", label: "Particulars" }, ...all.map((y, i) => ({ k: "y" + i, label: fyL(y.fy) + " (" + y.kind + ")", t: "amount" as const }))];
  const row = (item: string, f: ((y: Year) => number | null) | null) => Object.assign({ item }, ...all.map((y, i) => ({ ["y" + i]: f ? (() => { const v = f(y); return v == null || !isFinite(v) ? null : Math.round(v); })() : null })));
  const L = (k: string) => (y: Year) => y.l[k] || 0;
  const name = (id: string) => (FSX.LINES.find((z: any) => z.id === id) || { face: id }).face;
  const per = { from: (p.years[0].fy) + "-04-01", to: (p.years[p.years.length - 1].fy + 1) + "-03-31" };
  const basis = "FinCom's projection from the books of " + fyL(p.base.fy) + " (Schedule III, as the Reports screen works it out) and the assumptions listed";
  const T = (title: string, rows: Record<string, unknown>[], columns = cols): ToolTable => ({ tool: "projected_statements", title, columns, period: per, basis, label: "projection", rows });
  const pl = T("Projected profit and loss", [
    row("Revenue from operations", L("rev")), row("Other income", L("oth")), row("Total income", (y) => (y.l.rev || 0) + (y.l.oth || 0)),
    row("Cost of materials and goods (net of stock change)", (y) => costOf(y.l)), row(name("emp"), L("emp")), row(name("fin"), L("fin")), row(name("dep"), L("dep")),
    row(name("exp"), L("exp")), row("Exceptional and extraordinary items", (y) => (y.l.exc || 0) + (y.l.xo || 0)), row("Profit before tax", (y) => pbtOf(y.l)), row("Tax", L("tax")),
    row("Profit after tax", (y) => pbtOf(y.l) - (y.l.tax || 0))]);
  const lines = (ks: string[]) => ks.filter((k) => all.some((y) => Math.round(y.l[k] || 0))).map((k) => row(name(k), L(k)));
  const sus = Math.round(p.base.l.sus || 0);
  const bs = T("Projected balance sheet (as at 31 March)", [
    row("EQUITY AND LIABILITIES", null), ...lines(["share", "capital", "current", "reserves"]), ...lines(["ltb", "dtl", "oltl", "ltp"]), ...lines(["stb", "tp", "ocl", "stp"]),
    ...(sus < 0 ? [row("Difference in the books (to be reconciled)", () => -sus)] : []),
    row("Total equity and liabilities", (y) => sum(y.l, LIAB) + Math.max(0, -sus)), row("ASSETS", null), ...lines(["ppe", "intang", "cwip", "nci", "dta", "ltla", "onca"]), ...lines(["ci", "inv", "tr", "cash", "stla", "oca"]),
    ...(sus > 0 ? [row("Difference in the books (to be reconciled)", () => sus)] : []),
    row("Total assets", (y) => sum(y.l, ASSET) + Math.max(0, sus))]);
  const C = (k: string) => (y: Year) => (y.cf ? y.cf[k] : null);
  const cf = T("Projected cash flow", [
    row("Profit after tax", C("pat")), row("Add: depreciation", C("dep")), row("(Increase) in trade receivables", C("tr")), row("(Increase) in inventories", C("inv")),
    row("Increase in trade payables", C("tp")), row("Capital expenditure", C("capex")), row("Term loans taken less repaid", C("loans")), row("Dividend or drawings", C("div")),
    row("Bank borrowing to meet the shortfall", C("gap")), row("Opening cash and bank", C("open")), row("Closing cash and bank", C("close"))]);
  const eq = (y: Year) => sum(y.l, ["share", "capital", "current", "reserves"]);
  const ca = (y: Year) => sum(y.l, ["ci", "inv", "tr", "cash", "stla", "oca"]), cl = (y: Year) => sum(y.l, ["stb", "tp", "ocl", "stp"]);
  const rat = (item: string, f: (y: Year) => number | null) => ({ item, ...Object.fromEntries(all.map((y, i) => { const v = f(y); return ["y" + i, v == null || !isFinite(v) ? "-" : (Math.round(v * 100) / 100).toFixed(2)]; })) });
  const ratios = T("Key ratios", [rat("Current ratio", (y) => cl(y) ? ca(y) / cl(y) : null), rat("Debt / equity", (y) => eq(y) > 0 ? ((y.l.ltb || 0) + (y.l.stb || 0)) / eq(y) : null),
    rat("Net profit (% of revenue)", (y) => y.l.rev > 0 ? (pbtOf(y.l) - (y.l.tax || 0)) / y.l.rev * 100 : null)], cols.map((c, i) => i ? { k: c.k, label: c.label } : c));
  const notes = [...p.warnings.map((w) => "Check: " + w), ...p.assumptions];
  const as: ToolTable = { tool: "projected_statements", title: "Assumptions (tell me any to change and I'll redo it)", columns: [{ k: "n", label: "No.", t: "int" }, { k: "item", label: "Assumption" }], label: "projection",
    rows: notes.map((item, i) => ({ n: i + 1, item })) };
  return [pl, bs, cf, ratios, as];
}

// the Excel: one sheet per table, whole rupees, the assumptions (and what to check in the books) first
export function excelOf(p: Projection, client: string): Uint8Array {
  const [pl, bs, cf, ratios, as] = tablesOf(p);
  const warn = p.warnings.length ? [["CHECK THE BOOKS: " + p.warnings.join(" ")]] : [];
  const head = (t: ToolTable) => [[String(client || "").toUpperCase()], [t.title + " - PROJECTED, prepared by FinCom from the books of " + fyL(p.base.fy) + " and the assumptions listed; not audited"], ...warn, [FSX.UNITS], []];
  const cell = (v: unknown, s: number) => (typeof v === "number" && isFinite(v) ? { v, s } : "");
  const sheet = (nm: string, t: ToolTable) => ({ name: nm, widths: [52, ...t.columns.slice(1).map(() => 20)],
    rows: [...head(t), t.columns.map((c) => ({ v: c.label, s: 1 })), ...t.rows.map((r) => t.columns.map((c, i) => i ? cell(r[c.k], /^Total|after tax|Closing/.test(String(r.item)) ? 3 : 2) : { v: String(r.item), s: r.y0 == null && r.y1 == null ? 1 : 0 }))] });
  return FSX.xlsx([{ name: "Assumptions", widths: [6, 120], rows: [...head(as), [{ v: "No.", s: 1 }, { v: "Assumption", s: 1 }], ...as.rows.map((r) => [{ v: Number(r.n), s: 6 }, String(r.item)])] },
    sheet("Profit and loss", pl), sheet("Balance sheet", bs), sheet("Cash flow", cf), { name: "Key ratios", widths: [52, ...ratios.columns.slice(1).map(() => 20)], rows: [...head(ratios), ratios.columns.map((c) => ({ v: c.label, s: 1 })), ...ratios.rows.map((r) => ratios.columns.map((c) => String(r[c.k] ?? "")))] }], {});
}

// ---------------------------------------------------------------- the months the books cover
const ym = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
// whole months of a financial year the books cover: a month counts when the books run to its 25th or later (the end) and
// start on its 5th or earlier (the start); null when the books' dates are not known
export function monthsIn(fy: number, from: string | null, to: string | null): number | null {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}/.test(from) || !/^\d{4}-\d{2}-\d{2}/.test(to)) return null;
  const s = from > fy + "-04-01" ? from : fy + "-04-01", e = to < (fy + 1) + "-03-31" ? to : (fy + 1) + "-03-31";
  if (s > e) return 0;
  const first = ym(s) + (Number(s.slice(8, 10)) > 5 ? 1 : 0), last = ym(e) - (Number(e.slice(8, 10)) < 25 ? 1 : 0);
  return Math.max(0, Math.min(12, last - first + 1));
}

const NUM = (d: string) => ({ type: ["number", "string", "null"], description: d });
const ARR = (d: string) => ({ type: ["array", "null"], items: { type: ["number", "string"] }, description: d });
const strict = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });

export const TOOLS: ExtTool[] = [{
  name: "projected_statements",
  description: "Prepare projected (or estimated) financial statements for the client open, for the next year(s): profit and loss, balance sheet, cash flow and key ratios, with an Excel file. For a projected or estimated balance sheet or P&L, a forecast, projections for a bank loan, CMA data, or next year's figures. FinCom takes the client's last complete year from the books and works out each year from the assumptions; every assumption you leave null is FinCom's default from the books' trend (last year's growth, the same cost ratios and days, no new loans, no capex, last year's tax rate), and all are listed in the Assumptions table with anything to check in the books. Call it at once, with what the user said in this conversation; never ask for assumptions first. Amounts in rupees; percentages as numbers (12 for 12%).",
  input_schema: strict({ base_year: { type: ["string", "null"], description: "the completed year to start from, e.g. 2025-26 (null: the last complete year in the books)" },
    assumptions: strict({ years: NUM("how many years to project, 1 to 5 (null: to the end of next financial year)"), revenue_growth_pct: ARR("revenue growth % for each year (the last repeats), -50 to 200"),
      material_cost_pct: NUM("cost of materials and goods, % of revenue"), employee_cost_pct: NUM("employee costs, % of revenue"), other_expenses_pct: NUM("other expenses, % of revenue"),
      tax_rate_pct: NUM("tax rate %, 0 to 60"), capex: ARR("new fixed assets each year, rupees"), new_loans: ARR("new term loans each year, rupees"), loan_repayment: ARR("term loan repaid each year, rupees"),
      dividend_or_drawings: ARR("dividend (company) or drawings (firm, proprietor) each year, rupees"), receivable_days: NUM("debtors' days on revenue, 0 to 730"), inventory_days: NUM("stock days on cost of goods, 0 to 730"),
      payable_days: NUM("creditors' days on cost of goods and expenses, 0 to 730"), other_assumptions: { type: ["array", "null"], items: { type: "string" }, description: "anything else the user said, listed as given" } }) }),
  task: "heavy", label: "books",
  words: /\b(projected|projections?|forecast(ed|s)?|cma(\s+data)?|pro[\s-]?forma|estimated\s+(balance\s*sheet|p\s*&\s*l|profit|financials?|statements?)|budgeted\s+(balance\s*sheet|p\s*&\s*l|profit))\b/i,
  async run(input, ctx: ExtCtx): Promise<ExtResult> {
    const today = ctx.today, open = Number(fyOf(null, today)) + 1;           // the financial year now running
    const want = input.base_year ? Number(fyOf(input.base_year, today)) : null;
    if (want != null && want >= open) return { error: fyL(want) + " is " + (want === open ? "the year now running" : "a future year") + ", not a completed year: start from " + fyL(open - 1) + " or earlier (or leave the base year empty), and project " + fyL(want) + " from it." };
    // the months the books cover (asst_books: each company's first and last entry)
    let from: string | null = null, to: string | null = null, known = false;
    try {
      const b = await ctx.rpc("asst_books", {});
      const rows = (b && !b.none && Array.isArray(b.rows) ? b.rows : []) as any[];
      const fs = rows.map((r) => String(r.from || "")).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort(), ts = rows.map((r) => String(r.to || "")).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort();
      if (fs.length && ts.length) { from = fs[0].slice(0, 10); to = ts[ts.length - 1].slice(0, 10); known = true; }
    } catch (_e) { /* not known: each year read is taken as complete, and said */ }
    const months = (y: number) => (known ? monthsIn(y, from, to) ?? 12 : 12);
    // the base: the year asked, else the latest complete year of the last three, else the latest with 3 months or more
    const tries = want != null ? [want] : [open - 1, open - 2, open - 3];
    let got: any = null, fy = 0, m = 12;
    for (const pass of want != null ? [3] : [12, 3]) {
      for (const y of tries) {
        if (months(y) < pass) continue;
        const g = await inputFor(ctx, String(y));
        if (!("error" in g)) { got = g; fy = y; m = months(y); break; }
      }
      if (got) break;
    }
    if (!got) return { error: "No year of books for " + (ctx.clientName || "this client") + (want != null ? " for " + fyL(want) + " with three months or more" : " in the last three years") + ": link its Tally company or upload its books, then ask again." };
    const run = FSX.run(got.inp), M = run.model;
    const base = linesOf(M.nm, "CY"), pyL = linesOf(M.nm, "PY"), py = Object.values(pyL).some((v) => v) ? pyL : null;
    if (m < 12) for (const k of PL) base[k] = (base[k] || 0) * 12 / m;
    // what is wrong in the books, said first
    const warnings: string[] = [];
    if (!known) warnings.push("The months the books cover could not be read; " + fyL(fy) + " is taken as a complete year.");
    const unplaced = (M.unplaced || []) as string[];
    if (unplaced.length) warnings.push(unplaced.length + " ledger" + (unplaced.length > 1 ? "s are" : " is") + " not placed in the statements (" + unplaced.slice(0, 3).join(", ") + (unplaced.length > 3 ? ", …" : "") + "): place them on the Reports screen; the figures may be off.");
    const fails = (run.fails || []) as any[];
    if (fails.length) warnings.push(fails.length + " of the statements' checks fail (" + fails.slice(0, 3).map((c) => c.title).join("; ") + "): the figures may be off.");
    // the running year's books to date (its revenue, annualised, for the estimated year)
    let ytd: Base["ytd"] = null;
    if (fy === open - 1 && months(open) >= 3 && known) {
      try { const g = await inputFor(ctx, String(open)); if (!("error" in g)) ytd = { months: months(open), rev: linesOf(FSX.run(g.inp).model.nm, "CY").rev || 0 }; } catch (_e) { ytd = null; }
    }
    const p = project(base, py, { fy, months: m, kind: String(got.inp.entity.kind || "company"), warnings, ytd }, open, (input.assumptions || {}) as Assume);
    const tables = tablesOf(p);
    const name = String(ctx.clientName || "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client";
    const f = await ctx.uploadFile(excelOf(p, ctx.clientName), name + "-projected-" + fyL(p.years[0].fy) + "-to-" + fyL(p.years[p.years.length - 1].fy) + ".xlsx", "xlsx");
    const last = p.years[p.years.length - 1];
    return { tables, files: f ? [f] : [],
      forModel: JSON.stringify({ shown: "Projected profit and loss, balance sheet, cash flow, key ratios and the assumptions are shown to the user as tables" + (f ? ", with the Excel file" : ""),
        base_year: fyL(fy) + " (" + p.base.kind + ", from the books)", years: p.years.map((y) => fyL(y.fy) + " (" + y.kind + ")"),
        last_year: { revenue: Math.round(last.l.rev), profit_after_tax: Math.round(pbtOf(last.l) - last.l.tax), total_assets: Math.round(sum(last.l, ASSET)), cash: Math.round(last.l.cash), bank_gap: Math.round(last.gap || 0) },
        check_the_books: p.warnings, assumptions: p.assumptions,
        say: (p.warnings.length ? "First say plainly what to check in the books (check_the_books). " : "") + "In two or three lines say what was prepared and the main points; then list the assumptions in short bullets; end with: Tell me any assumption to change and I'll redo it. Do not copy the tables." }) };
  },
}];
