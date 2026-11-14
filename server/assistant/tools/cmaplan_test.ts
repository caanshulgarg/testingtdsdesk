// deno test --allow-read --allow-env --allow-net --allow-sys server/assistant/tools/cmaplan_test.ts
// CMA data on the user's own projections (the owner, 14-Nov-2026), on made-up look-alikes of the files of that day
// (cma_fixtures.ts): a bank-style CMA in crores with bare years over its columns, FinCom's own audited base year, a Word
// road map; the request as written (lists) and as pasted (tables). The reading (cmaread.ts, docxtext.ts, cmaplan.ts), the
// projections (cmaproj.ts) and the tool end to end with its Projections summary and Excel.
import ExcelJS from "npm:exceljs@4.4.0";
import { gridsFromXlsx } from "../filetable.ts";
import { bareYears, readGrids, yearOf } from "./cmaread.ts";
import { docxText } from "../docxtext.ts";
import { fyOfText, planAi, planRules, readPlan } from "./cmaplan.ts";
import { evalF } from "./cmaengine.ts";
import { runCma } from "./cma.ts";
import { cmaFollow, cmaInput, cmaWanted } from "../cmaask.ts";
import { B25, B26, bankCmaXlsx, baseXlsx, PLAN_PASTED, PLAN_REQUEST, roadmapDocx } from "./cma_fixtures.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const near = (a: number | null | undefined, b: number, w: string, tol = 1) => assert(a != null && Math.abs(a - b) <= tol, w + ": " + a + " vs " + b);
const CR = 1e7;

Deno.test("reading: a bank CMA's bare years, short kinds, parts and headings", async () => {
  assert(JSON.stringify(bareYears([null, "Financial Year", 2023, 2024, 2025])) === JSON.stringify([{ c: 2, fy: 2022 }, { c: 3, fy: 2023 }, { c: 4, fy: 2024 }]), "bare years: the year to 31 March");
  assert(bareYears([null, "Net sales", 2023, 5.5]) === null && bareYears(["x", 2023]) === null, "not a heading row");
  assert(yearOf("FY27-28") === 2027 && yearOf("FY 2027–28") === 2027 && yearOf("FY28") === 2027, "FY27-28 is the year from April 2027");
  const r = readGrids("cma.xlsx", "p", await gridsFromXlsx(await bankCmaXlsx()), "cma");
  const at = (fy: number) => r.years.find((y) => y.fy === fy && y.kind !== "projected")!;
  assert(r.years.length === 5 && at(2022).kind === "audited" && at(2025).kind === "provisional" && r.years.some((y) => y.fy === 2026 && y.kind === "projected"), "years and kinds: " + r.years.map((y) => y.fy + y.kind));
  assert(r.ties.filter((t) => !t.ok).length === 0, "every year ties to the CMA's own totals: " + JSON.stringify(r.ties.filter((t) => !t.ok)));
  const y = at(2023).l;
  near(y.tr, 1.3 * CR, "receivables (\"less than 6 months\" is not a holding-period row)"); near(y.onca, 0.22 * CR, "investments and debtors over six months: the line, its parts not again");
  near(y.inv, 1.5 * CR, "the stock once, not with its parts"); near(y.ocl, 0.06 * CR + 0.02 * CR + 0.12 * CR, "other current liabilities once (\"Expenses payable\" is its part)");
  near(y.stb, 1 * CR, "(i.) From banks under the three-row heading"); near(y.stbo, 0.05 * CR, "(ii) From others: borrowings from others");
  near(y.reserves, (0.91 + 0.53 + 0 + 0.1) * CR, "reserves: opening, the year's surplus, others (share premium once)"); near(y.dtl, 0.01 * CR, "\"Deffered\" tax liability");
  near(y.chg, -0.3 * CR, "the change in stock as printed, not again from the opening and closing stock");
  near(r.years.find((x) => x.fy === 2023)!.tot.PBT, 0.71 * CR, "the profit before tax, not PBT/Sales");
});

Deno.test("reading: FinCom's own base-year workbook (split trade payables, a bare TOTAL, the borrowings' break-up)", async () => {
  const r = readGrids("base.xlsx", "p", await gridsFromXlsx(await baseXlsx()), "");
  const y = r.years.find((x) => x.fy === 2025)!;
  assert(y && y.kind === "audited", "FY 2025-26 audited");
  near(y.l.tp, B26.tp, "trade payables: both rows"); near(y.l.ltb, B26.ltb, "long-term borrowings once (the break-up is a note)"); near(y.l.stb, B26.stb, "short-term borrowings once");
  near(y.tot.L, 50750000, "the bare TOTAL is the printed total"); near(y.tot.PAT, -1950000, "Profit (Loss) for the Year");
  assert(r.ties.every((t) => t.ok), "it ties and balances: " + JSON.stringify(r.ties.filter((t) => !t.ok)));
  near(r.years.find((x) => x.fy === 2024)!.l.tr, B25.tr, "the year before too");
});

Deno.test("Word: paragraphs and tables, read on the server", async () => {
  const d = (await docxText(await roadmapDocx()))!;
  assert(d && d.blocks.filter((b) => b.type === "table").length === 4, "four tables");
  assert(/FY 2027–28\t₹9\.00 Cr\t25%/.test(d.text) && /Gross Margin\t30%\t31%/.test(d.text) && /Showroom & Web Sales\t60%\t55%/.test(d.text), "rows with their cells");
  assert(/Phase 1: Consolidation \(FY 2027–28\)/.test(d.text), "paragraphs");
  assert(await docxText(new TextEncoder().encode("not a zip")) === null, "not a docx: null");
});

Deno.test("the user's projections: lists, pasted tables and the road map, read alike; a date is not a year", async () => {
  assert(fyOfText("July 2018") === null && fyOfText("FY 2026–27 (Base)") === 2026, "a year as a projection names it");
  for (const [name, text] of [["list", PLAN_REQUEST], ["pasted", PLAN_PASTED], ["docx", (await docxText(await roadmapDocx()))!.text]]) {
    const p = planRules([{ name, text }]);
    const Y = p.years;
    near(Y[2026].rev, 7.2 * CR, name + ": FY 2026-27"); near(Y[2031].rev, 20 * CR, name + ": FY 2031-32");
    assert(Y[2027].gm === 30 && Y[2031].gm === 34 && Y[2028].em === 7.5 && Y[2030].em === 9, name + ": margins " + JSON.stringify(Y[2028]));
    near(Y[2029].dep, 0.25 * CR, name + ": depreciation"); near(Y[2031].fin, 0.38 * CR, name + ": interest");
    assert(Y[2028].growth === 22, name + ": the growth said");
    assert(!Y[2018] && !Object.keys(Y).some((k) => Number(k) < 2026), name + ": no year from a date or a phase");
    if (name === "list") assert(p.taxRate === 25, "tax at ~25%");
    if (name === "docx") assert(p.verticals.length === 3 && p.verticals[0].share[2026] === 60 && p.verticals[2].share[2031] === 15, "verticals: " + JSON.stringify(p.verticals));
    if (name === "docx") assert(!p.notes.length, "nothing read twice from prose: " + p.notes);
  }
});

Deno.test("the AI's reading of the projections: strict, every figure one written", () => {
  const text = "Revenue FY 2027-28 Rs 9 crore, growing about a quarter; FY 2028-29 Rs 11 crore. EBITDA margin 7%.";
  const ans = JSON.stringify({ unit: "crores", tax_rate_pct: null, last_year: "FY 2028-29", verticals: [{ name: "Retail", year: "FY 2027-28", share_pct: 64, amount: null }],
    years: [{ year: "FY 2027-28", revenue: 9, revenue_growth_pct: 25, gross_profit: null, gross_margin_pct: null, ebitda: null, ebitda_margin_pct: 7, depreciation: null, interest: null, profit_before_tax: null, tax: null, tax_rate_pct: null, profit_after_tax: null },
      { year: "July 2028", revenue: 11, revenue_growth_pct: null, gross_profit: null, gross_margin_pct: null, ebitda: null, ebitda_margin_pct: null, depreciation: null, interest: null, profit_before_tax: null, tax: null, tax_rate_pct: null, profit_after_tax: null }] });
  const p = planAi(text, ans);
  near(p.years[2027].rev, 9 * CR, "a written amount, in its unit"); assert(p.years[2027].em === 7, "a written %");
  assert(p.years[2027].growth == null, "25 is not written: left out"); assert(!p.verticals.length, "64 is not written: left out");
  assert(!p.years[2028], "a column whose year is a date: left out"); assert(p.lastFy === 2028, "the last year");
  assert(p.notes.some((n) => /not written/.test(n)), "said: " + p.notes);
  assert(planAi(text, "nonsense").notes.length === 1, "not in the schema: said");
});

Deno.test("the AI reads prose the rules cannot, once, its figures checked; never when the rules read it all", async () => {
  const prose = "For the bank: revenue for FY 2027-28 should be Rs 9 crore, about a quarter up, and EBITDA margin 7%; the retail vertical brings 64 percent.";
  let asked = 0;
  const ans = JSON.stringify({ unit: "crores", tax_rate_pct: null, last_year: null, verticals: [{ name: "Retail", year: "FY 2027-28", share_pct: 64, amount: null }],
    years: [{ year: "FY 2027-28", revenue: 9, revenue_growth_pct: 25, gross_profit: null, gross_margin_pct: null, ebitda: null, ebitda_margin_pct: 7, depreciation: null, interest: null, profit_before_tax: null, tax: null, tax_rate_pct: null, profit_after_tax: null }] });
  const p = await readPlan([{ name: "your message", text: prose }], async (prompt, text) => { asked++; assert(/strict|exactly as written/.test(prompt) && text.includes("Rs 9 crore"), "the prompt and the text"); return ans; });
  assert(asked === 1, "asked once"); near(p.years[2027].rev, 9 * CR, "the AI's written figure"); assert(p.years[2027].growth == null, "an unwritten one left out");
  assert(p.verticals[0].share[2027] === 64 && p.byAi.length === 2, "the vertical; what the AI read is listed: " + p.byAi);
  let again = 0;
  await readPlan([{ name: "your message", text: PLAN_REQUEST }, { name: "road.docx", text: (await docxText(await roadmapDocx()))!.text }], async () => { again++; return ans; });
  assert(again === 0, "the rules read it all: no AI");
});

Deno.test("routing: the follow-up with the road map's tables pasted is the CMA's; its words go to the tool", () => {
  const shown = [{ role: "user", content: "please prepare cma data for the client" }, { role: "assistant", content: "DRAFT, NOT FINAL: 2 checks fail. CMA data in the standard bank format for K: …" }];
  assert(cmaFollow(PLAN_PASTED) && cmaWanted(PLAN_PASTED, shown), "the pasted tables after a CMA");
  for (const q of ["keep revenue growth at 20% and EBITDA margin 9%", "use the projections as per the attached road map", "gross margin 35/36/37%"]) assert(cmaWanted(q, shown), "a projection change: " + q);
  for (const q of ["what is the GST on this?", "show the loan ledger again", "sales register for October"]) assert(!cmaWanted(q, shown), "not a CMA change: " + q);
  const i = cmaInput(PLAN_PASTED, shown) as any;
  assert(/Projected Revenue/.test(i.projection_text) && /please prepare cma data/.test(i.projection_text), "the words since the CMA was asked: " + String(i.projection_text).slice(0, 80));
  assert((cmaInput("prepare cma data with 5 years projections", []) as any).years === 5, "five years");
});

// the workbook's formulas worked out again from its own cells (cma_test.ts's check), each against its cached result
async function recalc(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes as any);
  const valOf = (sheet: string, addr: string) => { const v: any = wb.getWorksheet(sheet)!.getCell(addr.replace(/\$/g, "")).value; const x = v && typeof v === "object" && "formula" in v ? v.result : v; return x == null ? "" : x; };
  let n = 0;
  const bad: string[] = [];
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((cell) => {
    const v: any = cell.value;
    if (!v || typeof v !== "object" || !("formula" in v)) return;
    n++;
    const f = String(v.formula).replace(/(?:'([^']+)'|([A-Za-z]+))!(\$?[A-Z]{1,2}\$?\d+)|\b(\$?[A-Z]{1,2}\$?\d+)\b/g, (_m, q, s, a, b) => {
      const x = valOf(q || s || ws.name, a || b);
      return typeof x === "string" ? JSON.stringify(x) : typeof x === "boolean" ? (x ? "1" : "0") : "(" + String(x) + ")";
    });
    let got: any; try { got = evalF(f, { ref: () => null, param: () => null }); } catch (e) { bad.push(ws.name + "!" + cell.address + " " + (e as Error).message); return; }
    const want = v.result;
    const ok = typeof want === "boolean" ? (got === want || got === (want ? 1 : 0)) : want === "" || want === undefined ? got === "" || got == null || (want === undefined && Math.abs(Number(got)) < 0.01) : Math.abs(Number(got) - Number(want)) <= 0.01;
    if (!ok) bad.push(ws.name + "!" + cell.address + " =" + v.formula + " gives " + got + ", cached " + want);
  }));
  return { n, bad, wb };
}

const ctxOf = async (aiRead?: (p: string) => Promise<string>) => {
  const files: Record<string, Uint8Array> = { "f/k/uploads/a-cma.xlsx": await bankCmaXlsx(), "f/k/uploads/b-base.xlsx": await baseXlsx(), "f/k/uploads/c-road.docx": await roadmapDocx() };
  const up: { name: string, bytes: Uint8Array }[] = [];
  const ctx: any = { clientId: "k", clientName: "Kestrel Widgets Private Limited", today: "2026-11-14", firm: { name: "Test firm", lines: [] }, rpc: async () => ({ none: true }), progress: () => {},
    uploads: Object.keys(files).map((path) => ({ path, name: path.split("/").pop()!, type: "" })),
    files: [{ path: "f/k/uploads/a-cma.xlsx", name: "a-cma.xlsx", type: "", kind: "cma", summary: "CMA data" }, { path: "f/k/uploads/b-base.xlsx", name: "b-base.xlsx", type: "", kind: "balance_sheet", summary: "" }],
    readFile: async (p: string) => files[p] || null, aiRead,
    uploadFile: async (b: Uint8Array, name: string, kind: string) => { up.push({ name, bytes: b }); return { id: "1", name, kind, path: "x/" + name, expires: "" }; } };
  return { ctx, up };
};

Deno.test("the tool, end to end: five years on the user's figures from the audited base, the summary agrees with the forms", async () => {
  let ai = 0;
  const { ctx, up } = await ctxOf(async () => { ai++; return ""; });
  const r: any = await runCma(cmaInput(PLAN_REQUEST, []), ctx);
  assert(!r.error, String(r.error));
  assert(ai === 0, "no AI: FinCom's rules read every figure and the verticals: " + ai);
  const titles = r.tables.map((t: any) => t.title);
  assert(/^Projections summary - A/.test(titles[0]) && /^Projections summary - B/.test(titles[1]) && /^Projections summary - C/.test(titles[2]), "the summary first: " + titles.slice(0, 3));
  assert(/All \d+ checks pass/.test(r.line), "every check passes (balance sheet, fund flow, ties): " + r.line);
  assert(/2031-32 projected/.test(r.line) && /2025-26 audited/.test(r.line) && /2026-27 estimate/.test(r.line), "to FY 2031-32, from the audited FY 2025-26: " + r.line);
  const A = r.tables[0].rows, B = r.tables[1], C = r.tables[2].rows;
  assert(A.map((x: any) => x.rev).join() === "7.20,9.00,11.00,13.50,16.50,20.00", "A: the revenue as given: " + A.map((x: any) => x.rev));
  assert(A[0].year === "FY 2026-27 (estimate)" && A[1].g === "25%" && A[2].g === "22.2%", "A: the growth the amounts give: " + JSON.stringify(A.slice(0, 3)));
  const row = (item: string) => B.rows.find((x: any) => x.item === item);
  assert(B.columns.length === 6 && B.columns[1].label === "FY27-28" && B.columns[5].label === "FY31-32", "B: FY27-28 to FY31-32: " + B.columns.map((c: any) => c.label));
  assert(["30%", "31%", "32%", "33%", "34%"].join() === [0, 1, 2, 3, 4].map((k) => row("Gross margin")["y" + k]).join(), "B: gross margin");
  assert(["7%", "7.5%", "8%", "9%", "10%"].join() === [0, 1, 2, 3, 4].map((k) => row("EBITDA margin")["y" + k]).join(), "B: EBITDA margin");
  assert(["0.20", "0.22", "0.25", "0.28", "0.30"].join() === [0, 1, 2, 3, 4].map((k) => row("Depreciation")["y" + k]).join() && row("Interest").y4 === "0.38", "B: depreciation and interest");
  for (let k = 0; k < 5; k++) near(Number(row("EBITDA")["y" + k]) - Number(row("Depreciation")["y" + k]) - Number(row("Interest")["y" + k]), Number(row("Profit before tax")["y" + k]), "EBITDA - depreciation - interest = PBT, year " + k, 0.011);
  assert(["0.13", "0.29", "0.49", "0.85", "1.32"].join() === [0, 1, 2, 3, 4].map((k) => row("Profit before tax")["y" + k]).join(), "B: PBT as in the road map: " + [0, 1, 2, 3, 4].map((k) => row("Profit before tax")["y" + k]));
  near(Number(row("Tax").y4), 0.33, "tax at 25%", 0.006);
  assert(C.length === 4 && /^4\.32 \(60%\)$/.test(C[0].y0) && /^11\.00 \(55%\)$/.test(C[0].y5) && C[3].y5 === "20.00 (100%)", "C: the verticals' shares (in a line between the years given) and amounts: " + JSON.stringify(C.map((x: any) => x.y0 + " / " + x.y5)));
  const as = r.tables.find((t: any) => /^Assumptions/.test(t.title)).rows.map((x: any) => x.item).join("\n");
  assert(/Your figures differ: 2028-29: revenue ₹11\.00 Cr is 22\.2% over 2027-28's ₹9\.00 Cr; you said 22%\. The amount is used\./.test(as), "the growth that does not match the amounts, listed");
  assert(/Tax at 25% \(as you said\)/.test(as) && /2026-27 30% \(not given: 2027-28's\)/.test(as), "the stated and the nearest-year assumptions: " + as.slice(0, 300));
  assert(/Your projections were read from your message, c-road\.docx/.test(as), "the sources");
  // the Excel: the summary sheet's formulas are Form II's, and recalculate
  assert(up.length === 1 && /CMA-2023-24-to-2031-32\.xlsx$/.test(up[0].name), "the Excel: " + up.map((u) => u.name));
  const { bad, wb } = await recalc(up[0].bytes);
  assert(!bad.length, "every formula recalculates: " + bad.slice(0, 4).join(" | "));
  const ps = wb.getWorksheet("Projections summary")!;
  assert(ps && wb.worksheets[1].name === "Projections summary", "the summary sheet beside Form I: " + wb.worksheets.map((w) => w.name));
  let rev: any = null, chk: any[] = [];
  ps.eachRow((rw) => { const l = String(rw.getCell(1).value); if (l === "FY 2031-32") rev = rw.getCell(2).value; if (/^Check: EBITDA/.test(l)) chk = [2, 3, 4, 5, 6].map((c) => rw.getCell(c).value); });
  assert(rev && /'Form II'!/.test(rev.formula) && Math.abs(rev.result - 20) < 1e-9, "A's revenue is Form II's: " + JSON.stringify(rev));
  assert(chk.length === 5 && chk.every((x) => x && Math.abs(Number(x.result ?? 0)) < 1e-6), "the check row is nil: " + JSON.stringify(chk));
});

Deno.test("the tool: the pasted tables as a follow-up right after a CMA", async () => {
  const { ctx } = await ctxOf();
  const hist = [{ role: "user", content: "please prepare cma data" }, { role: "assistant", content: "CMA data in the standard bank format for K: …" }];
  const r: any = await runCma(cmaInput(PLAN_PASTED, hist), ctx);
  assert(!r.error && /All \d+ checks pass/.test(r.line), "made, every check passing: " + (r.error || r.line));
  const B = r.tables[1];
  assert(B.rows.find((x: any) => x.item === "Gross profit").y3 === "5.45" && B.rows.find((x: any) => x.item === "Profit after tax").y4 === "0.99", "B from the pasted table: " + JSON.stringify(B.rows.slice(0, 3)));
});

Deno.test("the tool: no projections given keeps FinCom's defaults (two years after the running one), the summary still shown", async () => {
  const { ctx } = await ctxOf();
  ctx.uploads = ctx.uploads.filter((u: any) => !/docx/.test(u.path));
  const r: any = await runCma({}, ctx);
  assert(!r.error, String(r.error));
  assert(/2028-29 projected\./.test(r.line) && !/2029-30/.test(r.line), "the years as before (the running year and two more): " + r.line.slice(0, 200));
  assert(/^Projections summary - A/.test(r.tables[0].title), "the summary");
});
