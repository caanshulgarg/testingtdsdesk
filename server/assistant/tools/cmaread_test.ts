// deno test --allow-read --allow-env --allow-net --allow-sys server/assistant/tools/cmaread_test.ts
// The CMA's past years (cmaread.ts): a made-up earlier CMA Excel (in lakhs, Form II and Form III stacked, the CMA's own
// estimate) and a made-up audited balance-sheet Excel (Schedule III, a Note column, a Notes sheet) read and tied; the
// audited figures win and the differences are listed (cma.ts pastYears); the AI's reading of a PDF is taken strictly.
import { pastYears, readAi, readGrids, unitOf, yearOf } from "./cmaread.ts";
import { gridsFromXlsx } from "../filetable.ts";
import { bsXlsx, cmaXlsx, YA, YB } from "./cma_fixtures.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const near = (a: number | null, b: number, w: string, tol = 1) => assert(a != null && Math.abs(a - b) <= tol, w + ": " + a + " vs " + b);

Deno.test("extraction: the words of a year, the units", () => {
  assert(yearOf("As at 31 March 2025") === 2024 && yearOf("2024-25") === 2024 && yearOf("31.03.2024") === 2023 && yearOf("FY25") === 2024 && yearOf("Mar-25") === 2024, "years");
  assert(yearOf("Particulars") === null, "no year");
  assert(unitOf("(Rs. in lakhs)") === 1e5 && unitOf("₹ in crore") === 1e7 && unitOf("Amount in '000") === 1e3 && unitOf("Amount in rupees") === 1, "units");
});

Deno.test("extraction: a made-up CMA Excel and a balance-sheet Excel; the audited figures win", async () => {
  const cma = readGrids("old-cma.xlsx", "f/c/uploads/a", await gridsFromXlsx(await cmaXlsx()));
  assert(cma.kind === "cma", "a CMA");
  const y24 = cma.years.find((y) => y.fy === 2024 && y.kind === "audited")!;
  near(y24.l.rev, 13800000, "net sales in rupees"); near(y24.l.inv, 1800000, "inventories added up"); near(y24.l.ppe, 3200000, "net block"); near(y24.l.tr, 1950000, "the CMA's receivables");
  near(y24.l.fin, 380000, "interest"); near(y24.l.tax, 400000, "provision for taxes is tax in Form II");
  assert(cma.years.some((y) => y.kind === "estimated" && y.fy === 2025), "the CMA's estimate is read (and later left out)");
  assert(!cma.years.some((y) => y.l.tr === 46.5e5), "Form V is not read as lines");
  assert(cma.ties.filter((t) => !/estimated/.test(t.year)).every((t) => t.ok), "every audited total ties: " + JSON.stringify(cma.ties.filter((t) => !t.ok)));
  const bs = readGrids("audited-bs.xlsx", "f/c/uploads/b", await gridsFromXlsx(await bsXlsx()));
  assert(bs.kind === "balance_sheet", "a balance sheet");
  for (const want of [YA, YB]) {
    const y = bs.years.find((x) => x.fy === want.fy)!;
    assert(y && y.bs && y.pl, "both statements for " + want.fy);
    for (const [k, v] of Object.entries(want.l)) near(y.l[k] || 0, v, want.fy + " " + k);
  }
  assert(bs.ties.every((t) => t.ok), "the balance sheet ties: " + JSON.stringify(bs.ties.filter((t) => !t.ok)));
  const notes: string[] = [];
  const P = pastYears([cma, bs], [], 2026, notes);
  assert(P.years.map((y) => y.fy).join() === "2023,2024", "two past years");
  near(P.years[1].l.tr, 1900000, "audited receivables used"); near(P.years[1].l.cash, 650000, "audited cash used");
  assert(/audited balance sheet/.test(P.years[1].src), "the source is the audited balance sheet");
  const d = P.diffs.filter((x) => x[0] === "2024-25").map((x) => x[1]);
  assert(d.length === 2 && d.some((x) => /Receivables|tr/.test(String(x))) && d.some((x) => /Cash|cash/.test(String(x))), "the differences listed: " + JSON.stringify(P.diffs));
  assert(notes.some((n) => /estimated and projected columns/.test(n)), "the CMA's own estimates are said to be unused");
});

Deno.test("extraction: the AI's reading is taken strictly", () => {
  const lines = Object.fromEntries(Object.keys(YB.l).map((k) => [k, YB.l[k] / 1e5]));
  const r = readAi("bs.pdf", "p", JSON.stringify({ document: "balance_sheet", unit: "lakhs", years: [{ column: "As at 31 March 2025", kind: "audited", lines: { ...lines, cash: "lots" }, total_liabilities: 81.5, total_assets: 81.5, profit_before_tax: 15, profit_after_tax: 11 },
    { column: "Notes", kind: "audited", lines: {}, total_liabilities: null, total_assets: null, profit_before_tax: null, profit_after_tax: null }] }));
  assert(r.by === "ai" && r.years.length === 1, "the column with no year left out");
  near(r.years[0].l.rev, 13800000, "units applied"); assert(r.years[0].l.cash === undefined, "a non-number left out");
  assert(r.ties.some((t) => !t.ok && /Total assets/.test(t.head)), "and the total no longer ties: shown");
  assert(readAi("x.pdf", "p", "not json").years.length === 0, "an answer outside the schema is not used");
});
