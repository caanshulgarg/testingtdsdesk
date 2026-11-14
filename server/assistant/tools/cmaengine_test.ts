// deno test --allow-read --allow-env --allow-net --allow-sys server/assistant/tools/cmaengine_test.ts
// The CMA engine (cmaengine.ts) on made-up figures (cma_fixtures.ts): two balancing years tie out on every check (the balance
// sheet balances, each form's totals are the balance sheet's, the fund flow reconciles to the change in net working capital
// and in bank borrowings), the forms' figures by hand, Method I against Method II and the drawing power, the DSCR by hand,
// and a year that does not balance is shown and fails, never forced.
import { cmaCompute, CYear, evalF, rowOf } from "./cmaengine.ts";
import { YA, YB } from "./cma_fixtures.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const near = (a: number | null, b: number, w: string, tol = 1) => assert(a != null && Math.abs(a - b) <= tol, w + ": " + a + " vs " + b);
const II = { method: "II" as const, stockMargin: 0.25, recMargin: 0.25, limit: null };

Deno.test("engine: two balancing years tie out on every check; the forms' figures by hand", () => {
  const c = cmaCompute([YB, YA], II);
  assert(c.ok, "every check passes: " + c.checks.filter((x) => !x.ok).map((x) => x.label + " " + x.year).join("; "));
  assert(c.years[0].fy === 2023, "years in order");
  const v = (s: string, k: string, i = 1) => rowOf(c, s, k).vals[i];
  near(v("III", "tca"), 4650000, "current assets"); near(v("III", "tcl"), 2850000, "current liabilities"); near(v("III", "nwc"), 1800000, "NWC");
  near(v("III", "tl"), 8150000, "total liabilities"); near(v("III", "gap"), 0, "no gap");
  near(v("V", "wcg"), 3200000, "working capital gap"); near(v("V", "mnwc"), 1162500, "Method II minimum NWC"); near(v("V", "mpbf"), 1400000, "MPBF");
  near(v("II", "pbt"), 1500000, "Form II PBT"); near(v("II", "pat"), 1100000, "PAT"); near(v("II", "growth"), 15, "growth %", 0.001);
  assert(rowOf(c, "II", "growth").vals[0] == null, "no growth for the first year");
  // the fund flow
  near(v("VI", "ltsur"), 600000, "long-term surplus"); near(v("VI", "dnwc"), 600000, "change in NWC"); near(v("VI", "net"), -200000, "net deficit"); near(v("VI", "dbank"), 200000, "bank up");
  near(v("VI", "fainc"), 520000, "capex = change in net block + depreciation"); near(v("VI", "tldec"), 300000, "term loans repaid");
  assert(rowOf(c, "VI", "ltsur").vals[0] == null, "no fund flow for the first year");
  // holding periods
  near(v("IV", "tr_m"), 1900000 / 13800000 * 12, "receivables' months", 1e-6);
  // ratios
  near(v("R", "cr"), 4650000 / 2850000, "current ratio", 1e-9);
  near(v("R", "toltnw"), (2850000 + 1700000) / 3500000, "TOL/TNW", 1e-9);
  near(v("R", "icr"), (1500000 + 380000) / 380000, "interest cover", 1e-9);
});

Deno.test("engine: DSCR by hand, and none without the repayment", () => {
  const c = cmaCompute([YA, YB], II);
  const intTL = 380000 * (1700000 + 2000000) / (1700000 + 2000000 + 1400000 + 1200000);
  near(rowOf(c, "R", "inttl").vals[1], intTL, "interest on term loans", 1e-6);
  near(rowOf(c, "R", "dscr").vals[1], (1100000 + 320000 + intTL) / (intTL + 300000), "DSCR", 1e-9);
  assert(rowOf(c, "R", "dscr").vals[0] == null, "no DSCR when the repayment is not known");
});

Deno.test("engine: Method I against Method II", () => {
  // current assets 1,000, other current liabilities 300, bank 600 (NWC 100, gap 700)
  const y: CYear = { fy: 2025, kind: "projected", src: "t", l: { share: 200, ltb: 300, stb: 600, tp: 300, ppe: 400, inv: 500, tr: 500 } };
  const two = cmaCompute([y], II), one = cmaCompute([y], { ...II, method: "I" });
  const v = (c: typeof two, k: string) => rowOf(c, "V", k).vals[0];
  near(v(two, "mnwc"), 250, "II: 25% of current assets"); near(v(two, "mpbf"), 450, "II: MPBF"); near(v(two, "excess"), 150, "II: excess borrowing");
  near(v(one, "mnwc"), 175, "I: 25% of the gap"); near(v(one, "mpbf"), 525, "I: MPBF"); near(v(one, "excess"), 75, "I: excess borrowing");
  near(v(two, "mpbf1"), 525, "the other method shown"); near(v(one, "mpbf2"), 450, "the other method shown");
  // drawing power: paid stock (500-300) x 75% + receivables 500 x 75% = 525; limit = MPBF 450 -> gap -75
  near(v(two, "dp"), 525, "drawing power"); near(v(two, "dpgap"), -75, "drawing-power gap");
  const lim = cmaCompute([y], { ...II, limit: 600 });
  near(rowOf(lim, "V", "dpgap").vals[0], 75, "the limit sought over the drawing power");
});

Deno.test("engine: a year that does not balance is shown and fails, never forced", () => {
  const bad: CYear = { ...YB, l: { ...YB.l, cash: YB.l.cash + 12345 } };
  const c = cmaCompute([YA, bad], II);
  assert(!c.ok, "not ok");
  const f = c.checks.filter((x) => !x.ok).map((x) => x.label);
  assert(f.some((x) => /balance sheet balances/.test(x)), "the balance check fails");
  assert(f.some((x) => /long-term surplus/.test(x)), "the fund flow does not reconcile");
  near(rowOf(c, "III", "gap").vals[1], 12345, "the gap is shown");
});

Deno.test("evaluator: Excel's syntax", () => {
  const env = { ref: () => null, param: (p: string) => (p === "M" ? "II" : null) };
  assert(evalF('IF({M}="I",1,2)', env) === 2, "IF on text"); assert(evalF('IF({LIM}="",5,6)', env) === 5, "a blank is \"\"");
  assert(evalF("MAX(0,MIN(3,-4))", env) === 0, "MAX/MIN"); assert(evalF("-(2+3)*4/2", env) === -10, "arithmetic");
});
