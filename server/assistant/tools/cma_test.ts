// deno test --allow-read --allow-env --allow-net --allow-sys server/assistant/tools/cma_test.ts
// CMA data (tools/cma.ts, cmaxl.ts) on made-up figures (cma_fixtures.ts): the Excel's live formulas, worked out again from
// its own cells, give FinCom's figures and the method is the Assumptions cell; a term loan's schedule; the tool end to end
// with files only (no books, no AI; another client's file never read), what is still asked, and nothing to work from.
// The engine: cmaengine_test.ts; the extraction: cmaread_test.ts.
import ExcelJS from "npm:exceljs@4.4.0";
import { cmaCompute, evalF } from "./cmaengine.ts";
import { cmaExcel } from "./cmaxl.ts";
import { runCma, tlSchedule } from "./cma.ts";
import { bsXlsx, cmaXlsx, YA, YB } from "./cma_fixtures.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const near = (a: number | null, b: number, w: string, tol = 1) => assert(a != null && Math.abs(a - b) <= tol, w + ": " + a + " vs " + b);
const II = { method: "II" as const, stockMargin: 0.25, recMargin: 0.25, limit: null };

// the workbook's formulas worked out again from its own cells (the cached results), each against its cached result
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
    // (ExcelJS reads a cached "" or 0 back as no result)
    const ok = typeof want === "boolean" ? (got === want || got === (want ? 1 : 0)) : want === "" || want === undefined ? got === "" || got == null || (want === undefined && Math.abs(Number(got)) < 0.01) : Math.abs(Number(got) - Number(want)) <= 0.01;
    if (!ok) bad.push(ws.name + "!" + cell.address + " =" + v.formula + " gives " + got + ", cached " + want);
  }));
  return { n, bad, wb };
}

Deno.test("Excel: live formulas give FinCom's figures; the method is a cell", async () => {
  const c = cmaCompute([YA, YB], II);
  const bytes = await cmaExcel(c, { client: "Kestrel", firm: "Test firm", today: "2026-11-14", status: "All checks pass.", assumptions: ["a"], form1: [["Facility sought", "[To be given by you]"]], sources: [["Year", "Kind", "From"]], diffs: [["2024-25", "Trade Receivables", 1900000, 1950000, -50000, "earlier CMA"]], ties: [] });
  const { n, bad, wb } = await recalc(bytes);
  assert(n > 150, "formulas written: " + n);
  assert(!bad.length, "every formula gives its cached result: " + bad.slice(0, 5).join(" | "));
  for (const nm of ["Form I", "Form II", "Form III", "Form IV", "Form V", "Form VI", "Ratios", "Assumptions", "Checks", "Differences", "Sources"]) assert(wb.getWorksheet(nm), "sheet " + nm);
  const v5 = wb.getWorksheet("Form V")!;
  let mpbf: any = null;
  v5.eachRow((r) => { if (/^8\. Maximum permissible/.test(String(r.getCell(1).value))) mpbf = r.getCell(3).value; });
  assert(mpbf && mpbf.formula && Math.abs(mpbf.result - 1400000) < 1, "MPBF formula with its result");
  let mn: any = null;
  v5.eachRow((r) => { if (/^4\. Minimum/.test(String(r.getCell(1).value))) mn = r.getCell(3).value; });
  assert(/Assumptions!\$C\$4/.test(mn.formula), "the method is the Assumptions cell: " + mn.formula);
  assert(wb.getWorksheet("Assumptions")!.getCell("C4").value === "II", "Method II by default");
});

Deno.test("term loan schedule: monthly after the moratorium", () => {
  const s = tlSchedule(6000000, 5, 6, 3);
  near(s[0], 6000000 / 54 * 6, "first year: six instalments", 1e-6); near(s[1], 6000000 / 54 * 12, "then twelve", 1e-6);
});

Deno.test("the tool: files only (no books, no AI), forms, checks, Excel and what is still needed", async () => {
  const files: Record<string, Uint8Array> = { "firm1/kestrel/uploads/a-old-cma.xlsx": await cmaXlsx(), "firm1/kestrel/uploads/b-audited.xlsx": await bsXlsx(), "firm1/other/uploads/c-bs.xlsx": await bsXlsx(), "firm1/kestrel/uploads/d-staff-bs.xlsx": await bsXlsx() };
  const up: { name: string, bytes: Uint8Array }[] = [], read: string[] = [];
  let ai = 0;
  const ctx: any = { clientId: "kestrel", clientName: "Kestrel Widgets Private Limited", today: "2026-11-14", firm: { name: "Test firm", lines: [] },
    rpc: async (fn: string) => (fn === "asst_books" ? { none: true } : null), progress: () => {}, aiRead: async () => { ai++; return ""; },
    uploads: [{ path: "firm1/kestrel/uploads/a-old-cma.xlsx", name: "old-cma.xlsx", type: "" }, { path: "firm1/other/uploads/c-bs.xlsx", name: "bs.xlsx", type: "" }, { path: "firm1/kestrel/uploads/b-audited.xlsx", name: "b.xlsx", type: "" },
      { path: "firm1/kestrel/uploads/d-staff-bs.xlsx", name: "staff BS.xlsx", type: "" }],
    ownFiles: async (ps: string[]) => ps.filter((p) => !p.includes("staff")),
    files: [{ path: "firm1/kestrel/uploads/b-audited.xlsx", name: "Audited BS FY25.xlsx", type: "", kind: "balance_sheet", summary: "" }],
    readFile: async (p: string) => { read.push(p); return files[p] || null; },
    uploadFile: async (b: Uint8Array, name: string, kind: string) => { up.push({ name, bytes: b }); return { id: "1", name, kind, path: "x/" + name, expires: "" }; } };
  const r: any = await runCma({ loan_type: "working_capital", working_capital_limit: 1800000 }, ctx);
  assert(!r.error, "no error: " + r.error);
  assert(!read.some((p) => p.includes("/other/")), "another client's file is never read");
  assert(!read.some((p) => p.includes("staff")), "another member's upload is never read");
  assert(ai === 0, "no AI for Excel files");
  assert(up.length === 1 && /CMA-2023-24-to-2028-29\.xlsx$/.test(up[0].name), "the Excel: " + up.map((u) => u.name));
  const titles = r.tables.map((t: any) => t.title);
  for (const w of ["Form I", "Form II", "Form III", "Form IV", "Form V", "Form VI", "Key ratios", "Differences", "Sources", "Assumptions"]) assert(titles.some((t: string) => t.startsWith(w)), "table " + w + ": " + titles.join(" | "));
  assert(r.tables.every((t: any) => t.label === "cma"), "labelled cma");
  assert(/CMA data in the standard bank format/.test(r.line) && /MPBF for 2028-29 \(Method II\)/.test(r.line), "FinCom's line: " + r.line);
  assert(/All \d+ checks pass/.test(r.line), "checks pass: " + r.line);
  assert(!/Still needed/.test(r.line) || /existing term loans/.test(r.line), "only the existing loans' schedule may be asked: " + r.line);
  const f1 = r.tables.find((t: any) => t.title.startsWith("Form I"));
  assert(f1.rows.some((x: any) => x.item === "Working capital limit sought" && x.v === "₹18,00,000"), "the limit in Form I");
  const { bad } = await recalc(up[0].bytes);
  assert(!bad.length, "the tool's Excel recalculates: " + bad.slice(0, 3).join(" | "));
  // nothing said: the loan is asked for, and Form I keeps placeholders
  const r2: any = await runCma({}, ctx);
  assert(/Still needed/.test(r2.line) && /type of loan/.test(r2.line), "the loan is asked for: " + r2.line);
  assert(r2.tables.find((t: any) => t.title.startsWith("Form I")).rows.some((x: any) => x.v === "[To be given by you]"), "placeholders");
});

Deno.test("the tool: nothing to work from is said plainly", async () => {
  const r: any = await runCma({}, { clientId: "k", clientName: "K", today: "2026-11-14", rpc: async () => ({ none: true }), progress: () => {}, uploads: [], files: [] } as any);
  assert(/No figures for K/.test(r.error), r.error);
});

Deno.test("books (review High): short-term borrowings told apart by their ledgers; the rest listed", async () => {
  const { booksSplit } = await import("./cma.ts");
  const L = [{ l: "HDFC Bank OD A/c", g: ["Bank OD A/c", "Loans (Liability)"], line: "stb", cy: -40000000 }, { l: "Loan from Director Mr A", g: ["Unsecured Loans"], line: "stb", cy: -5000000 },
    { l: "Term loan - current maturities", g: ["Secured Loans"], line: "stb", cy: -12000000 }, { l: "Suspense loan", g: ["Loans (Liability)"], line: "stb", cy: -1000000 }, { l: "Trade payable", g: ["Sundry Creditors"], line: "tp", cy: -9 }];
  const s = booksSplit(L, "cy");
  near(s.cm, 120000, "current maturities"); near(s.stbo, 50000, "directors"); assert(s.unknown.length === 1 && s.unknown[0].name === "Suspense loan" && Math.abs(s.unknown[0].amt - 10000) < 1, "the rest listed");
});

Deno.test("the running year (review Medium): the annualised P&L with a balance sheet carried to 31 March, no drawings invented", async () => {
  const { yearEnd } = await import("./cma.ts");
  // six months of books: profit after tax to date 4,00,000, depreciation 1,00,000
  const l = { ...YB.l, rev: 6900000, mat: 4025000, emp: 825000, fin: 190000, dep: 160000, exp: 1000000, oth: 50000, tax: 200000 };
  const pat0 = 6900000 + 50000 - 4025000 - 825000 - 190000 - 160000 - 1000000 - 200000;
  const y = yearEnd(l, 6, "2025-09-30", 2025, "company");
  near(y.l.rev, 13800000, "annualised"); near(y.l.reserves, YB.l.reserves + pat0, "the rest of the year's profit to reserves");
  near(y.l.ppe, YB.l.ppe - 160000, "the rest of the year's depreciation off the fixed assets");
  const c = cmaCompute([YA, y], II);
  assert(c.checks.find((x) => /balance sheet balances/.test(x.label) && x.year === "2025-26")!.ok, "it balances");
  assert(y.asOn == null && /carried to 31-03-2026/.test(y.src), "labelled: " + y.src);
});

Deno.test("DRAFT (review Medium): failing checks, untied totals or the books' own warnings", async () => {
  const { draftWhy } = await import("./cma.ts");
  assert(draftWhy(0, 0, 0).length === 0, "final"); assert(/books' statements/.test(draftWhy(0, 0, 2).join()), "the books' warnings make it a draft");
});

Deno.test("cache (review Medium): a PDF is read by the AI once; a follow-up uses the reading kept", async () => {
  const lines = Object.fromEntries(Object.keys(YB.l).filter((k) => !["stbo", "cm"].includes(k)).map((k) => [k, YB.l[k]]));
  const answer = JSON.stringify({ document: "balance_sheet", unit: "rupees", years: [{ column: "As at 31 March 2025", kind: "audited", lines, parts: { stb_current_maturities: null, stb_related_parties: null, inv_raw_materials: null, inv_stock_in_process: null, inv_finished_goods: null },
    total_liabilities: 8150000, total_assets: 8150000, profit_before_tax: 1500000, profit_after_tax: 1100000 }] });
  let ai = 0;
  const kept = new Map<string, unknown>();
  const ctx: any = { clientId: "k", clientName: "K", today: "2026-11-14", firm: { name: "", lines: [] }, rpc: async () => ({ none: true }), progress: () => {},
    uploads: [{ path: "f/k/uploads/a-audited-bs.pdf", name: "Audited BS FY25.pdf", type: "application/pdf" }], files: [],
    readFile: async () => new TextEncoder().encode("%PDF-1.4 made up"), aiRead: async () => { ai++; return answer; },
    memo: { get: async (k: string) => kept.get(k) ?? null, set: async (k: string, v: unknown) => { kept.set(k, JSON.parse(JSON.stringify(v))); } },
    uploadFile: async (_b: Uint8Array, name: string) => ({ id: "1", name, kind: "xlsx", path: "x", expires: "" }) };
  const r1: any = await runCma({}, ctx), r2: any = await runCma({ method: "I" }, ctx);
  assert(!r1.error && !r2.error, "made: " + (r1.error || r2.error));
  assert(ai === 1, "the AI read the PDF once: " + ai);
  assert(/read by the AI/.test(r2.line), "still said to be read by the AI");
});

Deno.test("DSCR (review High): with no schedule, the instalments are the current maturities of the year before (said)", async () => {
  const files: Record<string, Uint8Array> = { "f/k/uploads/b.xlsx": await bsXlsx() };
  const ctx: any = { clientId: "k", clientName: "K", today: "2026-11-14", firm: { name: "", lines: [] }, rpc: async () => ({ none: true }), progress: () => {},
    uploads: [{ path: "f/k/uploads/b.xlsx", name: "Audited BS.xlsx", type: "" }], files: [], readFile: async (p: string) => files[p],
    uploadFile: async (_b: Uint8Array, name: string) => ({ id: "1", name, kind: "xlsx", path: "x", expires: "" }) };
  // the fixture's balance sheet with a current-maturities line inside short-term borrowings, from its notes
  const ExcelJS = (await import("npm:exceljs@4.4.0")).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(files["f/k/uploads/b.xlsx"] as any);
  const nt = wb.getWorksheet("Notes")!;
  nt.addRow(["", "As at 31 March 2025", "As at 31 March 2024"]); nt.addRow(["Note 5 Short-term borrowings"]); nt.addRow(["Cash credit from bank", 1100000, 1000000]); nt.addRow(["Current maturities of long-term debt", 300000, 200000]); nt.addRow(["Total", 1400000, 1200000]);
  files["f/k/uploads/b.xlsx"] = new Uint8Array(await wb.xlsx.writeBuffer());
  const r: any = await runCma({ loan_type: "working_capital", working_capital_limit: 1500000 }, ctx);
  assert(!r.error, String(r.error));
  const R = r.tables.find((t: any) => t.title === "Key ratios"), dscr = R.rows.find((x: any) => /^DSCR/.test(x.item));
  const ys = R.columns.slice(1).map((c: any) => c.k);
  assert(dscr[ys[ys.length - 1]] != null && dscr[ys[1]] != null, "DSCR for the projected and the later past years: " + JSON.stringify(dscr));
  const as = r.tables.find((t: any) => /^Assumptions/.test(t.title)).rows.map((x: any) => x.item).join(" ");
  assert(/current maturities of the year before/.test(as), "said in the assumptions");
  assert(!/existing term loans/.test(r.line), "not asked for when the current maturities stand in: " + r.line);
});
