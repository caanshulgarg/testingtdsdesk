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

// a grid as filetable.ts gives it
const G = (name: string, rows: (string | number | null)[][]) => ({ name, rows, pct: new Set<string>() });

Deno.test("extraction (review High): the change in inventories keeps its printed sign, a rise and a fall", () => {
  const pl = (v: number) => readGrids("pl.xlsx", "p", [G("Statement of Profit and Loss", [["Particulars", "Year ended 31 March 2025"], ["Revenue from operations", 1000],
    ["Cost of materials consumed", 500], ["Changes in inventories of finished goods and work-in-progress", v], ["Other expenses", 100], ["Profit before tax", 400 - v]])]).years[0];
  const rise = pl(-20), fall = pl(30);
  near(rise.l.chg, -20, "(20): the stock rose, the cost of sales is less"); near(fall.l.chg, 30, "30: the stock fell");
  near(rise.tot.PBT! - (1000 - 500 - rise.l.chg - 100), 0, "the rise ties to the printed profit"); near(fall.tot.PBT! - (1000 - 500 - fall.l.chg - 100), 0, "and the fall");
  // a CMA's "add opening stock / deduct closing stock" lines
  const cma = readGrids("c.xlsx", "p", [G("CMA", [["FORM II - OPERATING STATEMENT"], ["Particulars", "2024-25"], ["Net sales", 1000], ["Add: opening stock of finished goods", 50], ["Deduct: closing stock of finished goods", 80]])], "cma").years[0];
  near(cma.l.chg, -30, "opening 50 less closing 80");
});

Deno.test("extraction (review High): short-term borrowings split from the notes and from the CMA's lines; the rest said", () => {
  const bs = [["Audited Balance Sheet"], ["Particulars", "Note", "As at 31 March 2025"], ["EQUITY AND LIABILITIES"], ["Share capital", 1, 100], ["Current liabilities"], ["Short-term borrowings", 5, 600], ["Trade payables", 6, 100],
    ["ASSETS"], ["Current assets"], ["Inventories", 7, 500], ["Trade receivables", 8, 300]];
  const notes = [["Notes to the financial statements"], ["", "As at 31 March 2025"], ["Note 5 Short-term borrowings"], ["Cash credit from State Bank (secured)", 350], ["Current maturities of long-term debt", 150], ["Loans from directors", 100], ["Total", 600],
    ["Note 7 Inventories"], ["Raw materials", 200], ["Work-in-progress", 100], ["Finished goods", 200], ["Total", 500]];
  const y = readGrids("bs.xlsx", "p", [G("Balance Sheet", bs), G("Notes", notes)]).years[0];
  near(y.l.stb, 350, "bank borrowings"); near(y.l.cm, 150, "current maturities"); near(y.l.stbo, 100, "directors' loans");
  assert(y.stbUnknown == null, "all told apart"); near(y.l.inv_rm, 200, "raw materials"); near(y.l.inv_wip, 100, "WIP"); near(y.l.inv_fg, 200, "FG");
  assert(y.kind === "audited", "the file says audited");
  const bare = readGrids("bs2.xlsx", "p", [G("Balance Sheet", bs)]).years[0];
  near(bare.l.stb, 600, "no note: all counted as bank"); near(bare.stbUnknown!, 600, "and said"); assert(bare.kind === "audited", "audited in its title");
  const notes2: string[] = [];
  pastYears([{ name: "bs2.xlsx", path: "p", kind: "balance_sheet", by: "file", years: [bare], ties: [], unplaced: [], notes: [] }], [], 2026, notes2);
  assert(notes2.some((n) => /short-term borrowings of ₹600 .*counted as bank borrowings/.test(n)), "the amount listed in the notes: " + notes2.join(" | "));
  const cma = readGrids("c.xlsx", "p", [G("CMA", [["FORM III - ANALYSIS OF BALANCE SHEET"], ["Particulars", "2024-25"], ["CURRENT LIABILITIES"], ["Short term borrowings from banks", 400],
    ["Short term borrowings from others", 50], ["Instalments of term loans due within one year", 120], ["TERM LIABILITIES"], ["Loans from directors", 70], ["Term loans", 300]])], "cma").years[0];
  near(cma.l.stb, 400, "from banks"); near(cma.l.stbo, 50, "from others"); near(cma.l.cm, 120, "instalments"); near(cma.l.ltb, 370, "directors' loans under term liabilities stay long-term");
  assert(cma.stbUnknown == null, "named lines: nothing unknown");
  // the AI's reading: the parts it gives move out of short-term borrowings
  const ai = readAi("b.pdf", "p", JSON.stringify({ document: "balance_sheet", unit: "rupees", years: [{ column: "31-03-2025", kind: "audited", lines: { stb: 600, share: 100 },
    parts: { stb_current_maturities: 150, stb_related_parties: 100, inv_raw_materials: null, inv_stock_in_process: null, inv_finished_goods: null }, total_liabilities: null, total_assets: null, profit_before_tax: null, profit_after_tax: null }] })).years[0];
  near(ai.l.stb, 350, "AI: bank"); near(ai.l.cm, 150, "AI: current maturities"); near(ai.l.stbo, 100, "AI: related parties");
});

Deno.test("extraction (review Low): an unlabelled column is provisional; 'Actual' is not audited", () => {
  const y = readGrids("x.xlsx", "p", [G("Balance Sheet", [["Particulars", "As at 31 March 2025", "2023-24 Actual"], ["EQUITY AND LIABILITIES"], ["Share capital", 100, 100], ["ASSETS"], ["Cash and bank balances", 100, 100]])]).years;
  assert(y.every((x) => x.kind === "provisional"), "provisional: " + y.map((x) => x.kind));
});

Deno.test("extraction (re-review 3): both parts given as nil is a known split, not 'could not be told apart'", () => {
  const one = (parts: Record<string, number | null>) => readAi("b.pdf", "p", JSON.stringify({ document: "balance_sheet", unit: "rupees", years: [{ column: "31-03-2025", kind: "audited", lines: { stb: 600, share: 100 },
    parts: { inv_raw_materials: null, inv_stock_in_process: null, inv_finished_goods: null, ...parts }, total_liabilities: null, total_assets: null, profit_before_tax: null, profit_after_tax: null }] })).years[0];
  const zero = one({ stb_current_maturities: 0, stb_related_parties: 0 });
  assert(zero.stbUnknown == null && zero.l.stb === 600, "nil parts: all bank, known");
  assert(one({ stb_current_maturities: null, stb_related_parties: null }).stbUnknown === 600, "no parts: not told apart");
});
