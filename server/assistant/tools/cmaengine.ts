// CMA data, the engine (the owner, 14-Nov-2026: "Prepare CMA data" in Ask FinCom, the STANDARD bank format). Plain module:
// no Deno, no FSX; its only input is each year's Schedule III lines (the line ids of FSX.LINES, as projection.ts uses them)
// and the few switches below. Every figure of the forms is a FORMULA over those lines, written once here in Excel's own
// syntax ([key] a row of the same form and year, [III:key] another form's, [key@-1] the year before, {M} {SM} {RM} {LIM}
// the Assumptions sheet's cells): FinCom works each one out with the small evaluator below, and the Excel (cmaxl.ts)
// writes the same formula in the cell with FinCom's result beside it, so the file's live figures are FinCom's to the rupee.
//   - Form II operating statement; Form III analysis of the balance sheet; Form IV current assets (with holding periods)
//     and current liabilities; Form V MPBF by Nayak/Tandon's Method II (the default) and Method I, and the drawing-power
//     gap; Form VI fund flow; the ratios (current ratio, TOL/TNW, debt/equity, DSCR, interest cover, NWC).
//   - The checks, each year: the balance sheet balances; Form II's profit is the profit and loss account's; each form's
//     totals are the balance sheet's; the fund flow's long-term surplus is the change in net working capital and its net
//     surplus the change in bank borrowings, and its change in cash the balance sheets'. A check that fails says so; the
//     forms are then a DRAFT (never "final").

export type Lines = Record<string, number>;
export type YKind = "audited" | "provisional" | "actual" | "estimate" | "projected";
export type CYear = {
  fy: number, kind: YKind, src: string,         // src: where the figures came from ("audited balance sheet (file.xlsx)", "books", ...)
  l: Lines,                                     // Schedule III lines, rupees (the P&L for the year; the balance sheet at its end)
  asOn?: string | null,                         // the balance sheet's date when not 31 March (the books to date)
  months?: number | null,                       // months of books behind an estimate (its P&L annualised x 12/months)
  div?: number | null,                          // dividend or drawings of the year (null: not known)
  repay?: number | null,                        // term loans repaid in the year (null: not known)
  tol?: number,                                 // rounding the figures carry (a file in lakhs to 2 decimals: Rs 1,000 a line)
  printed?: { L?: number, A?: number, PBT?: number, PAT?: number },   // the source's own printed totals (a file's), checked against the forms
};
export type Opts = { method: "I" | "II", stockMargin: number, recMargin: number, limit: number | null };
export type Fmt = "amt" | "pct" | "x" | "mo" | "head";
export type Row = { key: string, label: string, fmt: Fmt, input: boolean, f?: string, vals: (number | null)[] };
export type Sheet = { id: string, name: string, title: string, rows: Row[], later?: boolean };   // later: the first year has no column (a movement)
export type Check = { n: number, label: string, year: string, col: number, ok: boolean, a: number | null, b: number | null, gap: number, sheet: string, fa: string, fb: string, tol: number };
export type Cma = { years: CYear[], labels: string[], sheets: Sheet[], checks: Check[], ok: boolean, opts: Opts, dscrAvg: number | null };

// stb here is the bank borrowings for working capital (and any short-term borrowing that could not be told apart); stbo the
// short-term borrowings from directors, partners and related parties; cm the current maturities of long-term debt (since
// the 2021 Schedule III change inside short-term borrowings; here split out). inv_rm, inv_wip, inv_fg: memo parts of inv.
export const LIAB = ["share", "capital", "current", "reserves", "ltb", "dtl", "oltl", "ltp", "stb", "stbo", "cm", "tp", "ocl", "stp"];
export const ASSET = ["ppe", "intang", "cwip", "nci", "dta", "ltla", "onca", "ci", "inv", "tr", "cash", "stla", "oca"];
export const PLK = ["rev", "oth", "mat", "pur", "chg", "emp", "fin", "dep", "exp", "exc", "xo", "tax"];
const g = (l: Lines, k: string) => (typeof l[k] === "number" && isFinite(l[k]) ? l[k] : 0);
export const sumOf = (l: Lines, ks: string[]) => ks.reduce((s, k) => s + g(l, k), 0);
export const pbtLines = (l: Lines) => g(l, "rev") + g(l, "oth") - g(l, "mat") - g(l, "pur") - g(l, "chg") - g(l, "emp") - g(l, "fin") - g(l, "dep") - g(l, "exp") - g(l, "exc") - g(l, "xo");
export const fyL = (y: number) => y + "-" + String((y + 1) % 100).padStart(2, "0");
export const KIND_WORD: Record<YKind, string> = { audited: "Audited", provisional: "Provisional", actual: "Actual (books)", estimate: "Estimate", projected: "Projected" };

// ---------------------------------------------------------------- the formula evaluator (Excel's syntax, the few functions used)
type V = number | string | boolean | null;
type Env = { ref: (sheet: string | null, key: string, back: number) => V, param: (p: string) => V };
const num = (v: V): number => (v == null || v === "" ? 0 : typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" ? v : isFinite(Number(v)) ? Number(v) : NaN);
class Div0 extends Error {}
export function evalF(src: string, env: Env): V {
  const s = src.replace(/^=/, "");
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const peek = (t: string) => { ws(); return s.startsWith(t, i); };
  const eat = (t: string) => { if (!peek(t)) throw new Error("expected " + t + " at " + i + " in " + s); i += t.length; };
  const cmp = (): V => {
    const a = add();
    for (const op of ["<=", ">=", "<>", "=", "<", ">"]) {
      if (peek(op)) {
        i += op.length;
        const b = add();
        const sa = typeof a === "string" || typeof b === "string" || a == null || b == null;
        const x = sa && (typeof a === "string" || typeof b === "string") ? String(a ?? "").toLowerCase() : num(a), y = sa && (typeof a === "string" || typeof b === "string") ? String(b ?? "").toLowerCase() : num(b);
        return op === "=" ? x === y : op === "<>" ? x !== y : op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y;
      }
    }
    return a;
  };
  const add = (): V => { let a = mul(); for (;;) { if (peek("+")) { i++; a = num(a) + num(mul()); } else if (peek("-")) { i++; a = num(a) - num(mul()); } else return a; } };
  const mul = (): V => {
    let a = una();
    for (;;) {
      if (peek("*")) { i++; a = num(a) * num(una()); }
      else if (peek("/")) { i++; const b = num(una()); if (b === 0) throw new Div0(); a = num(a) / b; }
      else return a;
    }
  };
  const una = (): V => (peek("-") ? (i++, -num(una())) : prim());
  const prim = (): V => {
    ws();
    if (s[i] === "(") { i++; const v = cmp(); eat(")"); return v; }
    if (s[i] === '"') { const j = s.indexOf('"', i + 1); const v = s.slice(i + 1, j); i = j + 1; return v; }
    let m = /^\[(?:(\w+):)?(\w+)(?:@-(\d))?\]/.exec(s.slice(i));
    if (m) { i += m[0].length; return env.ref(m[1] || null, m[2], Number(m[3] || 0)); }
    m = /^\{(\w+)\}/.exec(s.slice(i));
    if (m) { i += m[0].length; return env.param(m[1]); }
    m = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (m) { i += m[0].length; return Number(m[0]); }
    m = /^(TRUE|FALSE)\b/.exec(s.slice(i));
    if (m && !s.slice(i + m[0].length).trimStart().startsWith("(")) { i += m[0].length; return m[1] === "TRUE"; }
    m = /^([A-Z]+)\(/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      const fn = m[1];
      if (fn === "IF") { const c = cmp(); eat(","); const a = cmp(); eat(","); const b = cmp(); eat(")"); return (typeof c === "boolean" ? c : num(c) !== 0) ? a : b; }
      const args: V[] = [];
      if (!peek(")")) { args.push(cmp()); while (peek(",")) { i++; args.push(cmp()); } }
      eat(")");
      const n = args.map(num);
      switch (fn) {
        case "MIN": return Math.min(...n);
        case "MAX": return Math.max(...n);
        case "ABS": return Math.abs(n[0]);
        case "ROUND": { const k = 10 ** (n[1] || 0); return Math.round(n[0] * k) / k; }
        case "AND": return n.every((x) => x !== 0);
        case "OR": return n.some((x) => x !== 0);
        default: throw new Error("unknown function " + fn);
      }
    }
    throw new Error("bad formula at " + i + ": " + s);
  };
  const v = cmp();
  ws();
  if (i < s.length) throw new Error("bad formula (left over) " + s.slice(i));
  return v;
}
// a formula's result as a figure of the form: a number, or null for "" (not applicable), a division by nil or a non-number
export function figure(src: string, env: Env): number | null {
  try {
    const v = evalF(src, env);
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v == null || v === "" || typeof v !== "number" || !isFinite(v)) return null;
    return v;
  } catch (e) { if (e instanceof Div0) return null; throw e; }
}

// ---------------------------------------------------------------- the forms
type Def = { key: string, label: string, fmt?: Fmt, v?: (y: CYear, i: number, ys: CYear[]) => number | null, f?: string };
const I = (key: string, label: string, v: (y: CYear, i: number, ys: CYear[]) => number | null, fmt: Fmt = "amt"): Def => ({ key, label, v, fmt });
const C = (key: string, label: string, f: string, fmt: Fmt = "amt"): Def => ({ key, label, f, fmt });
const H = (key: string, label: string): Def => ({ key, label, fmt: "head" });
const L = (...ks: string[]) => (y: CYear) => sumOf(y.l, ks);

// the term loans' share of the year's interest: finance costs x the term loans' share of the borrowings (the average of the
// year's opening and closing, when the year before is known). Term loans include their instalments due within a year;
// the borrowings include the short-term ones from directors and related parties.
function intTL(ys: CYear[], i: number): number {
  const y = ys[i], p = i > 0 ? ys[i - 1] : null;
  const T = (l: Lines) => g(l, "ltb") + g(l, "cm"), B = (l: Lines) => T(l) + g(l, "stb") + g(l, "stbo");
  const tl = T(y.l) + (p ? T(p.l) : T(y.l)), all = B(y.l) + (p ? B(p.l) : B(y.l));
  return all > 0 ? g(y.l, "fin") * tl / all : 0;
}

export const FORMS: { id: string, name: string, title: string, later?: boolean, defs: Def[] }[] = [
  { id: "II", name: "Form II", title: "FORM II - OPERATING STATEMENT", defs: [
    I("sales", "1. Net sales (revenue from operations)", L("rev")),
    C("growth", "2. % rise (+) / fall (-) in net sales over the year before", 'IF([sales@-1]=0,"",([sales]/[sales@-1]-1)*100)', "pct"),
    H("h3", "3. Cost of sales"),
    I("mat", "   (i) Raw materials and goods consumed (incl. purchases of stock-in-trade)", L("mat", "pur")),
    I("purch", "   memo: materials and goods bought (consumed, plus the rise in raw-material stock where the stock is split)", (y, i, ys) => {
      const p = i > 0 ? ys[i - 1] : null, rm = y.l.inv_rm, rm0 = p ? p.l.inv_rm : undefined;
      return g(y.l, "mat") + g(y.l, "pur") + (typeof rm === "number" && typeof rm0 === "number" ? rm - rm0 : 0);
    }),
    I("chg", "   (ii) Change in inventories (opening less closing)", L("chg")),
    I("emp", "   (iii) Employee costs (direct labour and staff)", L("emp")),
    I("dep", "   (iv) Depreciation", L("dep")),
    C("cos", "   (v) Total cost of sales", "[mat]+[chg]+[emp]+[dep]"),
    I("sga", "4. Selling, general and administrative expenses (other expenses)", L("exp")),
    C("opbi", "5. Operating profit before interest (1 - 3 - 4)", "[sales]-[cos]-[sga]"),
    I("int", "6. Interest and finance costs", L("fin")),
    C("opai", "7. Operating profit after interest (5 - 6)", "[opbi]-[int]"),
    I("oth", "8. (i) Other non-operating income", L("oth")),
    I("nox", "   (ii) Exceptional and extraordinary items (net expense)", L("exc", "xo")),
    C("pbt", "9. Profit before tax (7 + 8(i) - 8(ii))", "[opai]+[oth]-[nox]"),
    I("tax", "10. Provision for taxes", L("tax")),
    C("pat", "11. Net profit after tax (9 - 10)", "[pbt]-[tax]"),
    I("div", "12. Dividend / drawings (not known for past years)", (y) => (y.div == null ? null : y.div)),
    C("ret", "13. Retained profit (11 - 12)", 'IF([div]="","",[pat]-[div])'),
    C("npm", "14. Net profit as % of net sales", 'IF([sales]=0,"",[pat]/[sales]*100)', "pct"),
  ] },
  { id: "III", name: "Form III", title: "FORM III - ANALYSIS OF BALANCE SHEET", defs: [
    H("hcl", "CURRENT LIABILITIES"),
    I("bank", "1. Bank borrowings for working capital (cash credit, overdraft, bills; and short-term borrowings not told apart)", L("stb")),
    I("stbo", "1A. Short-term borrowings from others (directors, partners, related parties)", L("stbo")),
    I("tp", "2. Sundry creditors (trade)", L("tp")),
    I("ocl", "3. Other current liabilities (advances from customers, statutory dues, others)", L("ocl")),
    I("cmr", "3A. Instalments of term loans due within a year (current maturities of long-term debt)", L("cm")),
    I("stp", "4. Short-term provisions (incl. taxation)", L("stp")),
    C("tcl", "5. Total current liabilities", "[bank]+[stbo]+[tp]+[ocl]+[cmr]+[stp]"),
    H("htl", "TERM LIABILITIES"),
    I("ltb", "6. Term loans, debentures and other long-term borrowings", L("ltb")),
    I("dtl", "7. Deferred tax liability", L("dtl")),
    I("oltl", "8. Other term liabilities and long-term provisions", L("oltl", "ltp")),
    C("ttl", "9. Total term liabilities", "[ltb]+[dtl]+[oltl]"),
    C("tol", "10. Total outside liabilities (5 + 9)", "[tcl]+[ttl]"),
    H("hnw", "NET WORTH"),
    I("cap", "11. Share capital / partners' or proprietor's capital", L("share", "capital", "current")),
    I("res", "12. Reserves and surplus", L("reserves")),
    C("nw", "13. Net worth (11 + 12)", "[cap]+[res]"),
    C("tl", "14. Total liabilities (10 + 13)", "[tol]+[nw]"),
    H("hca", "CURRENT ASSETS"),
    I("cash", "15. Cash and bank balances", L("cash")),
    I("ci", "16. Investments (current)", L("ci")),
    I("tr", "17. Receivables (trade)", L("tr")),
    I("inv", "18. Inventory", L("inv")),
    I("stla", "19. Advances to suppliers, advance tax and other short-term loans and advances", L("stla")),
    I("oca", "20. Other current assets", L("oca")),
    C("tca", "21. Total current assets", "[cash]+[ci]+[tr]+[inv]+[stla]+[oca]"),
    H("hfa", "FIXED ASSETS"),
    I("nb", "22. Net block (property, plant and equipment, incl. capital work-in-progress)", L("ppe", "cwip")),
    H("hnca", "OTHER NON-CURRENT ASSETS"),
    I("nci", "23. Investments (non-current)", L("nci")),
    I("ltla", "24. Long-term loans and advances, deposits", L("ltla")),
    I("onca", "25. Other non-current assets (incl. deferred tax asset)", L("onca", "dta")),
    C("tnca", "26. Total other non-current assets", "[nci]+[ltla]+[onca]"),
    I("intg", "27. Intangible assets", L("intang")),
    C("ta", "28. Total assets (21 + 22 + 26 + 27)", "[tca]+[nb]+[tnca]+[intg]"),
    C("gap", "Difference: total assets less total liabilities (must be nil)", "[ta]-[tl]"),
    C("tnw", "29. Tangible net worth (13 - 27)", "[nw]-[intg]"),
    C("nwc", "30. Net working capital (21 - 5)", "[tca]-[tcl]"),
    C("cr", "31. Current ratio (21 / 5)", 'IF([tcl]=0,"",[tca]/[tcl])', "x"),
    C("toltnw", "32. Total outside liabilities / tangible net worth (10 / 29)", 'IF([tnw]<=0,"",[tol]/[tnw])', "x"),
    C("ttltnw", "33. Total term liabilities / tangible net worth (9 / 29)", 'IF([tnw]<=0,"",[ttl]/[tnw])', "x"),
  ] },
  { id: "IV", name: "Form IV", title: "FORM IV - COMPARATIVE STATEMENT OF CURRENT ASSETS AND CURRENT LIABILITIES", defs: [
    H("hca", "A. CURRENT ASSETS"),
    C("inv", "1. Inventory", "[III:inv]"),
    C("inv_m", "   (months' cost of sales)", 'IF([II:cos]<=0,"",[inv]/[II:cos]*12)', "mo"),
    I("rm", "   (a) Raw materials (where the source splits the stock)", (y) => (typeof y.l.inv_rm === "number" ? y.l.inv_rm : null)),
    C("rm_m", "       (months' materials consumed)", 'IF(OR([rm]="",[II:mat]<=0),"",[rm]/[II:mat]*12)', "mo"),
    I("wip", "   (b) Stock-in-process", (y) => (typeof y.l.inv_wip === "number" ? y.l.inv_wip : null)),
    C("wip_m", "       (months' cost of sales, as the cost of production)", 'IF(OR([wip]="",[II:cos]<=0),"",[wip]/[II:cos]*12)', "mo"),
    I("fg", "   (c) Finished goods and stock-in-trade", (y) => (typeof y.l.inv_fg === "number" ? y.l.inv_fg : null)),
    C("fg_m", "       (months' cost of sales)", 'IF(OR([fg]="",[II:cos]<=0),"",[fg]/[II:cos]*12)', "mo"),
    C("tr", "2. Receivables (trade)", "[III:tr]"),
    C("tr_m", "   (months' net sales)", 'IF([II:sales]<=0,"",[tr]/[II:sales]*12)', "mo"),
    C("cash", "3. Cash and bank balances", "[III:cash]"),
    C("ci", "4. Investments (current)", "[III:ci]"),
    C("adv", "5. Advances and other current assets", "[III:stla]+[III:oca]"),
    C("tca", "6. Total current assets", "[inv]+[tr]+[cash]+[ci]+[adv]"),
    H("hcl", "B. CURRENT LIABILITIES (other than bank borrowings)"),
    C("tp", "7. Sundry creditors (trade)", "[III:tp]"),
    C("tp_m", "   (months' materials and goods bought, Form II memo)", 'IF([II:purch]<=0,"",[tp]/[II:purch]*12)', "mo"),
    C("stbo", "8. Short-term borrowings from others (directors, related parties)", "[III:stbo]"),
    C("ocl", "9. Other current liabilities", "[III:ocl]"),
    C("cmr", "10. Instalments of term loans due within a year", "[III:cmr]"),
    C("stp", "11. Short-term provisions (incl. taxation)", "[III:stp]"),
    C("tocl", "12. Total current liabilities (other than bank borrowings)", "[tp]+[stbo]+[ocl]+[cmr]+[stp]"),
  ] },
  { id: "V", name: "Form V", title: "FORM V - COMPUTATION OF MAXIMUM PERMISSIBLE BANK FINANCE (MPBF)", defs: [
    C("tca", "1. Total current assets (Form IV, 6)", "[IV:tca]"),
    C("ocl", "2. Other current liabilities, other than bank borrowings (Form IV, 12)", "[IV:tocl]"),
    C("wcg", "3. Working capital gap (1 - 2)", "[tca]-[ocl]"),
    C("mnwc", "4. Minimum stipulated net working capital (Method II: 25% of 1; Method I: 25% of 3)", 'IF({M}="I",[wcg]*0.25,[tca]*0.25)'),
    C("anwc", "5. Actual / projected net working capital (Form III, 30)", "[III:nwc]"),
    C("i6", "6. Item 3 minus item 4", "[wcg]-[mnwc]"),
    C("i7", "7. Item 3 minus item 5", "[wcg]-[anwc]"),
    C("mpbf", "8. Maximum permissible bank finance (the lower of 6 and 7; nil if negative)", "MAX(0,MIN([i6],[i7]))"),
    C("excess", "9. Excess borrowing, the shortfall in net working capital (4 - 5)", "MAX(0,[mnwc]-[anwc])"),
    C("mpbf2", "   MPBF by Method II (25% of current assets from long-term funds)", "MAX(0,MIN([wcg]-[tca]*0.25,[i7]))"),
    C("mpbf1", "   MPBF by Method I (25% of the working capital gap from long-term funds)", "MAX(0,MIN([wcg]*0.75,[i7]))"),
    C("bank", "10. Bank borrowings for working capital (Form III, 1)", "[III:bank]"),
    H("hdp", "DRAWING POWER"),
    C("paid", "11. Paid stock: inventory less trade creditors", "MAX(0,[IV:inv]-[IV:tp])"),
    C("dps", "12. Drawing power on stock (paid stock less the stock margin)", "[paid]*(1-{SM})"),
    C("dpr", "13. Drawing power on receivables (less the receivables margin)", "[IV:tr]*(1-{RM})"),
    C("dp", "14. Total drawing power (12 + 13)", "[dps]+[dpr]"),
    C("lim", "15. Limit to be supported (the working capital limit sought; MPBF when not given)", 'IF({LIM}="",[mpbf],{LIM})'),
    C("dpgap", "16. Drawing-power gap (15 - 14; positive: the stock and receivables do not support the limit)", "[lim]-[dp]"),
  ] },
  { id: "VI", name: "Form VI", title: "FORM VI - FUND FLOW STATEMENT", later: true, defs: [
    H("h1", "1. LONG-TERM SOURCES"),
    C("pat", "   (a) Net profit after tax", "[II:pat]"),
    C("dep", "   (b) Depreciation", "[II:dep]"),
    C("capin", "   (c) Increase in capital (capital introduced less drawings and dividends, when more)", "MAX(0,[III:nw]-[III:nw@-1]-[II:pat])"),
    C("tlinc", "   (d) Increase in term liabilities", "MAX(0,[III:ttl]-[III:ttl@-1])"),
    C("fadec", "   (e) Decrease in fixed assets (net block after depreciation: sales of assets)", "MAX(0,[III:nb@-1]-[III:nb]-[II:dep])"),
    C("ncadec", "   (f) Decrease in other non-current and intangible assets", "MAX(0,[III:tnca@-1]+[III:intg@-1]-[III:tnca]-[III:intg])"),
    C("lts", "   Total long-term sources", "[pat]+[dep]+[capin]+[tlinc]+[fadec]+[ncadec]"),
    H("h2", "2. LONG-TERM USES"),
    C("tldec", "   (a) Decrease in term liabilities (repayments)", "MAX(0,[III:ttl@-1]-[III:ttl])"),
    C("fainc", "   (b) Increase in fixed assets (capital expenditure)", "MAX(0,[III:nb]-[III:nb@-1]+[II:dep])"),
    C("ncainc", "   (c) Increase in other non-current and intangible assets", "MAX(0,[III:tnca]+[III:intg]-[III:tnca@-1]-[III:intg@-1])"),
    C("capout", "   (d) Dividends, drawings and other withdrawals (when more than capital introduced)", "MAX(0,[II:pat]-([III:nw]-[III:nw@-1]))"),
    C("ltu", "   Total long-term uses", "[tldec]+[fainc]+[ncainc]+[capout]"),
    C("ltsur", "3. Long-term surplus (+) / deficit (-) (1 - 2)", "[lts]-[ltu]"),
    C("dca", "4. Increase / (decrease) in current assets", "[III:tca]-[III:tca@-1]"),
    C("docl", "5. Increase / (decrease) in current liabilities other than bank borrowings", "([III:tcl]-[III:bank])-([III:tcl@-1]-[III:bank@-1])"),
    C("dwcg", "6. Increase / (decrease) in working capital gap (4 - 5)", "[dca]-[docl]"),
    C("net", "7. Net surplus (+) / deficit (-) (3 - 6)", "[ltsur]-[dwcg]"),
    C("dbank", "8. Increase / (decrease) in bank borrowings", "[III:bank]-[III:bank@-1]"),
    C("dnwc", "9. Increase / (decrease) in net working capital (Form III, 30)", "[III:nwc]-[III:nwc@-1]"),
    H("h10", "Details of the change in current assets"),
    C("dcash", "   Cash and bank balances", "[III:cash]-[III:cash@-1]"),
    C("dinv", "   Inventory", "[III:inv]-[III:inv@-1]"),
    C("dtr", "   Receivables (trade)", "[III:tr]-[III:tr@-1]"),
    C("doth", "   Investments, advances and other current assets", "([III:ci]+[III:stla]+[III:oca])-([III:ci@-1]+[III:stla@-1]+[III:oca@-1])"),
    C("dsales", "Increase / (decrease) in net sales", "[II:sales]-[II:sales@-1]"),
  ] },
  { id: "R", name: "Ratios", title: "KEY RATIOS", defs: [
    C("cr", "Current ratio (current assets / current liabilities)", "[III:cr]", "x"),
    C("toltnw", "TOL / TNW (total outside liabilities / tangible net worth)", "[III:toltnw]", "x"),
    C("de", "Debt / equity: term loans incl. instalments due within a year / tangible net worth (DTL and provisions excluded)", 'IF([III:tnw]<=0,"",([III:ltb]+[III:cmr])/[III:tnw])', "x"),
    I("repay", "Term loans repaid in the year (the repayment schedule; blank: not known)", (y) => (y.repay == null ? null : y.repay)),
    I("inttl", "Interest on term loans (finance costs x term loans' share of the borrowings)", (_y, i, ys) => intTL(ys, i)),
    C("dscr", "DSCR: (profit after tax + depreciation + interest on term loans) / (interest on term loans + repayment)", 'IF([repay]="","",IF([inttl]+[repay]=0,"",([II:pat]+[II:dep]+[inttl])/([inttl]+[repay])))', "x"),
    C("icr", "Interest cover: (profit before tax + interest) / interest", 'IF([II:int]=0,"",([II:pbt]+[II:int])/[II:int])', "x"),
    C("nwc", "Net working capital (current assets less current liabilities)", "[III:nwc]"),
    C("npm", "Net profit after tax as % of net sales", "[II:npm]", "pct"),
  ] },
];

// the checks: [label, sheet, a, b (a formula, or a function of the year's lines: the statement's own figure), from the 2nd year only]
type CheckDef = { label: string, sheet: string, a: string, b: string | ((y: CYear) => number | null), later?: boolean, when?: (y: CYear) => boolean };
const CHECKS: CheckDef[] = [
  { label: "The balance sheet balances (total assets = total liabilities)", sheet: "III", a: "[ta]", b: "[tl]" },
  // the source's own printed totals (a file's): the lines placed add up to them
  { label: "Form III total liabilities = the total printed in the source", sheet: "III", a: "[tl]", b: (y) => y.printed?.L ?? null },
  { label: "Form III total assets = the total printed in the source", sheet: "III", a: "[ta]", b: (y) => y.printed?.A ?? null },
  { label: "Form II profit before tax = the profit printed in the source", sheet: "II", a: "[pbt]", b: (y) => y.printed?.PBT ?? null },
  { label: "Form II profit after tax = the profit printed in the source", sheet: "II", a: "[pat]", b: (y) => y.printed?.PAT ?? null },
  // a year whose dividend or drawings are known: the net worth moves by the retained profit (no capital introduced)
  { label: "Net worth moves by the retained profit (profit after tax less dividend or drawings)", sheet: "III", a: "[nw]-[nw@-1]", b: "[II:ret]", later: true, when: (y) => y.div != null && (y.kind === "projected" || y.kind === "estimate") },
  { label: "Fund flow: long-term surplus = the change in net working capital", sheet: "VI", a: "[ltsur]", b: "[dnwc]", later: true },
  { label: "Fund flow: net surplus / deficit = the decrease / increase in bank borrowings", sheet: "VI", a: "[net]", b: "0-[dbank]", later: true },
  { label: "Fund flow: the change in current assets = the details' (cash, stock, receivables, others)", sheet: "VI", a: "[dca]", b: "[dcash]+[dinv]+[dtr]+[doth]", later: true },
];

export function cmaCompute(years: CYear[], o: Opts): Cma {
  const ys = [...years].sort((a, b) => a.fy - b.fy);
  const n = ys.length;
  const vals: Record<string, Record<string, (number | null)[]>> = {};
  const params: Record<string, V> = { M: o.method, SM: o.stockMargin, RM: o.recMargin, LIM: o.limit == null ? null : o.limit };
  const envAt = (sheet: string, col: number): Env => ({
    ref: (sh, key, back) => {
      const c = col - back;
      const S = vals[sh || sheet];
      if (!S || !S[key]) throw new Error("unknown " + (sh || sheet) + ":" + key);
      return c < 0 ? null : S[key][c];
    },
    param: (p) => (p in params ? params[p] : null),
  });
  const sheets: Sheet[] = [];
  for (const F of FORMS) {
    const S: Record<string, (number | null)[]> = vals[F.id] = {};
    const rows: Row[] = [];
    for (const d of F.defs) {
      const fmt = d.fmt || "amt";
      const v: (number | null)[] = [];
      for (let i = 0; i < n; i++) {
        if (fmt === "head") v.push(null);
        else if (d.v) { const x = d.v(ys[i], i, ys); v.push(x == null || !isFinite(x) ? null : x); }
        else if (/@-1\]/.test(d.f!) && i === 0) v.push(null);
        else v.push(null);
      }
      S[d.key] = v;
      // computed rows are worked out after the whole column's inputs exist (a row only refers to rows above it or other forms)
      if (d.f) for (let i = 0; i < n; i++) if (!((F.later || /@-1\]/.test(d.f)) && i === 0)) v[i] = figure(d.f, envAt(F.id, i));
      rows.push({ key: d.key, label: d.label, fmt, input: !!d.v, f: d.f, vals: v });
    }
    sheets.push({ id: F.id, name: F.name, title: F.title, rows, later: !!F.later });
  }
  const labels = ys.map((y) => fyL(y.fy) + " " + KIND_WORD[y.kind].toLowerCase() + (y.asOn ? " (to " + y.asOn + ")" : ""));
  const checks: Check[] = [];
  let k = 0;
  for (const c of CHECKS) {
    for (let i = 0; i < n; i++) {
      if (c.later && i === 0) continue;
      if (c.when && !c.when(ys[i])) continue;
      if (typeof c.b !== "string" && c.b(ys[i]) == null) continue;   // nothing printed to check against
      const tol = Math.max(1, ys[i].tol || 1, i > 0 ? ys[i - 1].tol || 1 : 1);
      const a = figure(c.a, envAt(c.sheet, i));
      const bf = typeof c.b === "string" ? c.b : null;
      const b = bf ? figure(bf, envAt(c.sheet, i)) : (c.b as (y: CYear) => number)(ys[i]);
      const gap = (a ?? 0) - (b ?? 0);
      checks.push({ n: ++k, label: c.label, year: fyL(ys[i].fy), col: i, ok: Math.abs(gap) <= tol, a, b, gap, sheet: c.sheet, fa: c.a, fb: bf ?? "", tol });
    }
  }
  const R = sheets.find((s) => s.id === "R")!.rows.find((r) => r.key === "dscr")!;
  const dl = R.vals.filter((v, i) => v != null && ys[i].kind === "projected") as number[];
  return { years: ys, labels, sheets, checks, ok: checks.every((c) => c.ok), opts: o, dscrAvg: dl.length ? dl.reduce((a, b) => a + b, 0) / dl.length : null };
}
// a row of a form by its key
export const rowOf = (c: Cma, sheet: string, key: string) => c.sheets.find((s) => s.id === sheet)!.rows.find((r) => r.key === key)!;
