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
