// deno test --allow-read --allow-env --allow-net --allow-sys server/assistant/filetable_test.ts (run by
// tests/run_assistant_agent.py). Two of the owner's reports of 15-Oct-2026, through the Assistant's turn (agent.ts runTurn)
// with Claude MOCKED:
//   1. "can you pls make this presentable. i need to present it to investor" on an uploaded MIS: make_file takes its table
//      from the sheet; FinCom copies the cells (real values, never the masked tokens the model read), numbers stay numbers,
//      the file's own totals are formulas, the note says the figures are the file's and not checked against the books; a
//      figure the model types that is not a cell is sent back, and after two tries its sentence is left out.
//   2. "should not be so long until asked specifically in detail": a short answer unless the detail words are there
//      (low effort, max_tokens 4000, the prompt's 5-line rule); an answer cut at max_tokens ends at a whole sentence.
// Every company, person and figure here is made up.
import { endClean, runTurn, SYSTEM, TurnCtx } from "./agent.ts";
import { BRIEF_MAX_TOKENS, detailAsked, plan } from "./models.ts";
import { claudeTools } from "./tools.ts";
import { fileFigures, gridsFromText, gridsFromXlsx, readSheetFile, renderSheetFile, SheetFile, tableFromFile } from "./filetable.ts";
import { DocSpec, makeFile } from "./files.ts";
import ExcelJS from "npm:exceljs@4.4.0";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const ok = (c: unknown, w: string) => { if (!c) throw new Error(w); };
const eq = (a: unknown, b: unknown, w: string) => ok(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

// ---- the owner's MIS (made up): a merged title, a heading row, formulas for the totals, a growth column in %, a party with
// its GSTIN (masked before the model)
const PARTY = "Nightjar Sound & Light Co", GSTIN = "07AAKFN4416E1Z5";
async function misXlsx(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("MIS Q2");
  ws.addRow(["Larkspur Events Pvt Ltd - MIS"]); ws.mergeCells("A1:D1");
  ws.addRow([]);
  ws.addRow(["Particulars", "Apr-Jun 2026", "Jul-Sep 2026", "Growth"]);
  ws.addRow(["Revenue from operations", 4523150.5, 5210400, 0.152]);
  ws.addRow(["Other income", 12000, 15500.75, 0.2917]);
  ws.addRow(["Total income", { formula: "SUM(B4:B5)", result: 4535150.5 }, { formula: "SUM(C4:C5)", result: 5225900.75 }, null]);
  ws.addRow(["Sound and light - " + PARTY + " (GSTIN " + GSTIN + ")", 350000, 410000, null]);
  ws.addRow(["Staff cost", 820000, 905000, null]);
  ws.addRow(["Total expenses", { formula: "SUM(B7:B8)", result: 1170000 }, { formula: "SUM(C7:C8)", result: 1315000 }, null]);
  ws.addRow(["Net profit", { formula: "B6-B9", result: 3365150.5 }, { formula: "C6-C9", result: 3910900.75 }, null]);
  ws.getColumn(4).numFmt = "0.0%";
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ---- Claude, mocked: each step is the content it writes (or a function of the request), with its own stop reason/usage
type B = Record<string, unknown>;
type Step = { content: B[] | ((p: any) => B[]), stop?: string, out?: number };
class MockClaude {
  calls: any[] = [];
  constructor(public script: Step[]) {}
  beta = { messages: { stream: (p: any) => {
    const n = this.calls.length; this.calls.push({ ...p, messages: [...p.messages] });
    const st = this.script[n] ?? { content: [{ type: "text", text: "(end)" }] };
    const content = (typeof st.content === "function" ? st.content(p) : st.content).map((b, i) => b.type === "tool_use" ? { id: "toolu_" + n + "_" + i, ...b } : b);
    const evs: any[] = []; content.forEach((b: any, i: number) => { evs.push({ type: "content_block_start", index: i, content_block: b.type === "text" ? { type: "text", text: "" } : b }); if (b.type === "text") evs.push({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } }); evs.push({ type: "content_block_stop", index: i }); });
    const msg = { content, stop_reason: st.stop || (content.some((b: any) => b.type === "tool_use") ? "tool_use" : "end_turn"), usage: { input_tokens: 5000, output_tokens: st.out ?? 200 } };
    return { async *[Symbol.asyncIterator]() { for (const e of evs) yield e; }, finalMessage: async () => msg };
  } } };
}
const tool = (name: string, input: B): B => ({ type: "tool_use", name, input });
const text = (t: string): B => ({ type: "text", text: t });
const toolResult = (c: MockClaude, n: number) => { const m = c.calls[n].messages; return (m[m.length - 1].content || []).find((b: any) => b.type === "tool_result") || {}; };

function turn(c: MockClaude, question: string, over: Partial<TurnCtx> = {}) {
  const events: any[] = [], made: DocSpec[] = [];
  const ctx: TurnCtx = { client: c as any, question, history: [], attachments: [], clientId: "larkspur", clientName: "Larkspur Events Pvt Ltd", firmWide: false, today: "2026-10-15", books: "",
    exec: async (fn: string, a: any) => fn === "asst_find_ledgers" && a.p_group === "Sundry" ? { rows: [{ ledger: PARTY }] } : { rows: [] },
    capTake: async () => ({ ok: true, used: 0, cap: 500 }), recordMismatch: async () => null, firm: { name: "Garg Shekhar & Company", lines: ["Chartered Accountants"] },
    makeFile: async (spec, name) => { made.push(spec); return { id: "f" + made.length, name: name + "." + spec.format, kind: spec.format, path: "F/larkspur/files/" + name + "." + spec.format, expires: "" }; },
    emit: (e) => events.push(e), noFont: true, strict: true, levers: { router: false, haiku: false }, ...over };
  return { ctx, events, made };
}
async function withMis(question: string, c: MockClaude) {
  const sf = (await readSheetFile(1, "MIS Q2 2026-27.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", await misXlsx(), "")) as SheetFile;
  return turn(c, question, { attachments: [{ type: "text", text: renderSheetFile(sf) }], sheets: [sf], uploadKind: "other" });
}
const MIS_TABLE = { file: 1, sheet: "MIS Q2", header_row: 3, columns: [{ col: "A", heading: "Particulars" }, { col: "C", heading: "Q2 (Jul-Sep 2026)" }, { col: "B", heading: "Q1 (Apr-Jun 2026)" }, { col: "D", heading: "Growth" }],
  groups: [{ heading: "Income", rows: ["4-6"] }, { heading: "Expenses", rows: ["7-9"] }, { heading: "Result", rows: [10] }], sum: null };
const sec = (heading: string | null, txt: string | null, fromFile: unknown = null): B => ({ heading, text: txt, table_tool: null, table_input_json: null, table_from_file_json: fromFile ? JSON.stringify(fromFile) : null });

Deno.test("the sheet as FinCom reads it: every sheet, a formula's result, a percentage as shown, a merged title once; the model sees row numbers and column letters", async () => {
  const g = (await gridsFromXlsx(await misXlsx()))[0];
  eq(g.name, "MIS Q2", "the sheet's name");
  eq([g.rows[0][0], g.rows[0][1]], ["Larkspur Events Pvt Ltd - MIS", null], "a merged title once");
  eq(g.rows[3], ["Revenue from operations", 4523150.5, 5210400, 15.2], "numbers as numbers, % as shown");
  eq([g.rows[5][1], g.rows[9][2]], [4535150.5, 3910900.75], "a formula's result");
  const shown = renderSheetFile({ n: 1, name: "MIS.xlsx", sheets: [g] });
  ok(shown.includes("#\tA\tB\tC\tD") && shown.includes("\n4\tRevenue from operations\t4523150.5\t5210400\t15.2%"), "row numbers and column letters: " + shown.slice(0, 300));
  // the page's text (an .xls FinCom cannot open itself): tabs and lines, Indian grouping and brackets read as numbers
  const t = gridsFromText("Particulars\tFY26\nSales\t1,23,450.00\nLoss\t(2,000)")[0];
  eq(t.rows.slice(1), [["Sales", 123450], ["Loss", -2000]], "the page's text");
});

Deno.test("'make this presentable for an investor' on an uploaded MIS: make_file copies the sheet's cells (real, unmasked, to the paisa); totals are formulas; the note; the AI's text checked", async () => {
  const c = new MockClaude([
    { content: (p) => {
      // the request: the rule in the prompt, the file's table in make_file, the attachment masked
      ok(/make an attached sheet presentable/.test(p.system[0].text) && /table_from_file_json/.test(p.system[0].text), "SYSTEM: a file's table for 'presentable / investors'");
      const mf = p.tools.find((t: any) => t.name === "make_file");
      ok(mf && mf.input_schema.properties.sections.items.properties.table_from_file_json && /investors/.test(mf.description), "make_file takes a table from the file");
      const sent = JSON.stringify(p.messages);
      ok(!sent.includes(GSTIN) && !sent.includes("Nightjar") && sent.includes("GSTIN_1") && sent.includes("PARTY_1"), "the sheet is masked before the model");
      // first try: a growth the model worked out itself (16%) and a total it added (₹62,00,000)
      return [tool("make_file", { format: "pdf", title: "Larkspur Events - Q2 2026-27 results", file_name: "larkspur-q2-investors", sections: [
        sec("Highlights", "Revenue from operations rose 16% to ₹52,10,400. Income and other income together came to ₹62,00,000."),
        sec("Income and profit", null, MIS_TABLE)] })];
    } },
    { content: (p) => {
      const r = toolResult(c, 1) as any;
      ok(r.is_error && /16%/.test(r.content) && /62,00,000/.test(r.content), "figures not in the file are sent back: " + r.content);
      void p;
      return [tool("make_file", { format: "pdf", title: "Larkspur Events - Q2 2026-27 results", file_name: "larkspur-q2-investors", sections: [
        sec("Highlights", "Revenue from operations rose 15.2% to ₹52,10,400 (Q1: ₹45,23,150.50).\nNet profit for the quarter was ₹39,10,900.75, up from ₹33,65,150.50.\nSound and light with PARTY_1 cost ₹4,10,000."),
        sec("Income and profit", null, MIS_TABLE)] })];
    } },
    { content: [text("The investor PDF is ready below.")] },
  ]);
  const { ctx, events, made } = await withMis("can you pls make this presentable. i need to present it to investor", c);
  const res = await runTurn(ctx);
  eq(made.length, 1, "one file made");
  const spec = made[0], t = spec.sections[1].table!;
  eq(t.columns.map((x) => [x.label, x.t]), [["Particulars", undefined], ["Q2 (Jul-Sep 2026)", "amount"], ["Q1 (Apr-Jun 2026)", "amount"], ["Growth", "pct"]], "the model's headings and order; numbers typed by FinCom");
  eq(t.rows.map((r) => r.__h || [r.c0, r.c1, r.c2, r.c3 ?? null]), ["Income", ["Revenue from operations", 5210400, 4523150.5, 15.2], ["Other income", 15500.75, 12000, 29.17], ["Total income", 5225900.75, 4535150.5, null],
    "Expenses", ["Sound and light - " + PARTY + " (GSTIN " + GSTIN + ")", 410000, 350000, null], ["Staff cost", 905000, 820000, null], ["Total expenses", 1315000, 1170000, null], "Result", ["Net profit", 3910900.75, 3365150.5, null]],
    "the cells copied from the file, real values (never PARTY_1 or GSTIN_1)");
  eq(t.note, "Figures as in your file MIS Q2 2026-27.xlsx; not checked against the books.", "the note under the table");
  ok(spec.aiText && spec.sections[0].text!.includes(PARTY) && !spec.sections[0].text!.includes("PARTY_1"), "the AI's text marked AI-drafted, unmasked");
  ok(res.labels.includes("file") && !res.labels.includes("books") && !res.labels.includes("general"), "the source: your file, not the books: " + res.labels);
  ok(events.some((e) => e.t === "file"), "the download button");
  // the files open; numbers stay numbers; the file's own totals are formulas; nothing says 'FinCom's books'
  for (const format of ["xlsx", "docx", "pdf"] as const) {
    const bytes = await makeFile({ ...spec, format }, { noFont: true });
    if (format === "pdf") ok((await PDFDocument.load(bytes)).getPageCount() >= 1, "the PDF opens");
    if (format === "docx") ok(bytes[0] === 0x50 && bytes[1] === 0x4b, "the Word file is a docx");
    if (format !== "xlsx") continue;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes as any);
    const ws = wb.worksheets[0], all: unknown[][] = [];
    ws.eachRow((row) => all.push((row.values as unknown[]).slice(1)));
    const find = (label: string) => all.find((r) => r[0] === label) as any[];
    eq(find("Revenue from operations").slice(1, 3), [5210400, 4523150.5], "cells as numbers");
    eq([find("Total income")[1].formula, find("Total income")[1].result, find("Total expenses")[2].formula], ["SUM(B6:B7)", 5225900.75, "SUM(C10:C11)"], "the file's totals as formulas over the copied rows");
    eq(find("Net profit")[1], 3910900.75, "a total that is not a sum: its value as in the file");
    ok(!all.some((r) => r[0] === "Total"), "no total FinCom made up");
    ok(all.some((r) => String(r[0]).startsWith("Figures as in your file")) && all.some((r) => String(r[0]).startsWith("Made by FinCom")) && !all.some((r) => /FinCom's books/.test(String(r[0]))), "the note and the footer");
    ok(String(ws.getColumn(2).numFmt).includes("₹"), "₹ in the Indian format");
  }
});

Deno.test("a figure the model will not drop: after two tries its sentence is left out and the user told; a sum it asks for is FinCom's", async () => {
  const bad = sec("Highlights", "Revenue grew strongly. EBITDA margin was 61% this quarter.", null);
  const tbl = { ...MIS_TABLE, columns: [{ col: "A", heading: null }, { col: "C", heading: "Jul-Sep 2026" }], groups: null, rows: ["7-8"], sum: { label: "Total of these", columns: ["C"] } };
  const call = () => ({ content: [tool("make_file", { format: "xlsx", title: "Costs", file_name: "costs", sections: [bad, sec("Costs", null, tbl)] })] });
  const c = new MockClaude([call(), call(), call(), { content: [text("Done.")] }]);
  const { ctx, events, made } = await withMis("make an excel of the two costs with their total", c);
  await runTurn(ctx);
  eq(made.length, 1, "made on the third try");
  eq(made[0].sections[0].text, "Revenue grew strongly.", "the sentence with 61% left out");
  ok(events.some((e) => e.t === "warn" && /61%/.test(e.message)), "the user is told");
  const rows = made[0].sections[1].table!.rows;
  eq(rows[rows.length - 1], { __sum: true, c0: "Total of these", c1: 1315000 }, "the sum, FinCom's, of the copied cells");
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await makeFile(made[0])) as any);
  const tot: any = wb.worksheets[0].getRow(7).getCell(2).value;
  eq([tot.formula, tot.result], ["SUM(B5:B6)", 1315000], "the asked-for sum as a formula");
  // no sheet attached: said, nothing made
  const c2 = new MockClaude([{ content: [tool("make_file", { format: "pdf", title: "x", file_name: null, sections: [sec(null, null, MIS_TABLE)] })] }, { content: [text("Please attach the sheet.")] }]);
  const t2 = turn(c2, "make my MIS presentable");
  await runTurn(t2.ctx);
  ok((toolResult(c2, 1) as any).is_error && /no sheet is attached/.test((toolResult(c2, 1) as any).content) && !t2.made.length, "no sheet: asked to attach it");
  // the check itself: cells written as they are, in lakh/crore to the precision written, percentages
  eq(fileFigures("₹52,10,400 is 52.10 lakh or 0.52 crore; 15.2%; ₹99,999", [5210400, 15.2]), ["₹99,999"], "the figure check");
  ok("error" in tableFromFile([], {}), "no file");
});

Deno.test("short answers unless asked: the prompt's 5-line rule; low effort and max_tokens 4000 for book and general chat; the detail words and drafts keep the long limits; notices and files unchanged", async () => {
  ok(/at most 5 short lines or 5 bullets/.test(SYSTEM) && /no headings, no preamble, no repeating the question, no closing offers/.test(SYSTEM) && /never restate them/.test(SYSTEM), "the Writing rule");
  for (const q of ["TDS rate on rent for a company?", "Due date of GSTR-9 for 2025-26?", "Why is cash so low in September?", "How to treat advance received under GST?"]) ok(!detailAsked(q), "short: " + q);
  for (const q of ["Explain in detail how TDS on rent works", "explain fully the ITC rules", "elaborate on section 43B(h)", "step by step, how do I file GSTR-9?", "give me the full answer", "draft a letter to the bank"]) ok(detailAsked(q), "long: " + q);
  eq([plan("general", "medium", true).effort, plan("general", "medium", true).maxTokens, plan("book", "medium", true).maxTokens], ["low", BRIEF_MAX_TOKENS, BRIEF_MAX_TOKENS], "short: low effort, 4000");
  eq([plan("general").effort, plan("general").maxTokens, plan("file", "medium", true).maxTokens, plan("notice", "medium", true).maxTokens, plan("heavy", "medium", true).maxTokens], ["medium", 6000, 12000, 32000, 32000], "the long limits");
  // what is sent
  const sent = async (q: string) => { const c = new MockClaude([{ content: [text("ok.")] }]); const { ctx } = turn(c, q, { clientId: null, clientName: "", firmWide: true }); await runTurn(ctx); return [c.calls[0].max_tokens, c.calls[0].output_config.effort]; };
  eq(await sent("TDS rate on rent for a company?"), [4000, "low"], "a short question");
  eq(await sent("Explain in detail the TDS on rent for a company"), [6000, "medium"], "asked in detail");
});

Deno.test("an answer cut at max_tokens ends at its last whole sentence; one whose limit went on thinking alone is asked once more at the full limit", async () => {
  eq(endClean("TDS on rent is 10% u/s 194-I. Under the 2025 Act it is section 393. The threshold is ₹50,000 a mon"), "TDS on rent is 10% u/s 194-I. Under the 2025 Act it is section 393.\n\n(Cut short: ask “in detail” for the full answer.)", "ends cleanly");
  const c = new MockClaude([{ content: [text("TDS on rent is 10% u/s 194-I. The threshold is ₹50,000 a mon")], stop: "max_tokens", out: 4000 }]);
  const { ctx, events } = turn(c, "TDS rate on rent?", { clientId: null, clientName: "", firmWide: true });
  const r = await runTurn(ctx);
  ok(r.text.startsWith("TDS on rent is 10% u/s 194-I.\n\n(Cut short") && !r.text.includes("a mon"), "never mid-sentence: " + r.text);
  ok(events.find((e) => e.t === "done").text === r.text && !r.cacheable, "the page shows the clean end; not cached");
  const c2 = new MockClaude([{ content: [{ type: "thinking", thinking: "" }], stop: "max_tokens", out: 4000 }, { content: [text("10% u/s 194-I (section 393 of the 2025 Act).")] }]);
  const t2 = turn(c2, "TDS rate on rent?", { clientId: null, clientName: "", firmWide: true });
  const r2 = await runTurn(t2.ctx);
  eq([c2.calls.length, c2.calls[0].max_tokens, c2.calls[1].max_tokens, r2.text], [2, 4000, 6000, "10% u/s 194-I (section 393 of the 2025 Act)."], "asked once more at the full limit, never an empty answer");
});

// the owner's four kinds of question, before and after: output tokens ESTIMATED as tests/assistant_cost.ts does (3.3
// characters a token, thinking 300 tokens a call at medium effort, 80 at low), from replies in the old style (as on staging:
// a heading, the question restated, the table again, a closing offer) and in the new one. No API call is made.
Deno.test("output tokens before and after (estimated, no API call)", () => {
  const tok = (s: string) => Math.ceil(s.length / 3.3), THINK: Record<string, number> = { low: 80, medium: 300 };
  const Q: [string, string, string][] = [
    ["TDS rate on rent for a company?",
      "## TDS on Rent for a Company\n\nYou asked about the TDS rate on rent paid by a company. Here is a complete overview.\n\n**Under the Income-tax Act, 1961 (section 194-I)**\n- Rent for plant and machinery: 2%\n- Rent for land, building or furniture: 10%\n- Threshold: ₹50,000 a month (from 1-Oct-2024; earlier ₹2,40,000 a year)\n\n**Under the Income-tax Act, 2025 (section 393)**\n- The same rates carry over from 1-Apr-2026 for tax year 2026-27 onwards.\n\n**Key points**\n1. Deduct at credit or payment, whichever is earlier.\n2. Without a PAN, 20% under section 206AA.\n3. GST on rent is not part of the amount for TDS where shown separately.\n4. Deposit by the 7th of the next month (30 April for March).\n\n**Summary**: 10% for land and building, 2% for machinery.\n\nWould you like me to check the rent payments in the books, or draft a note for the client?",
      "10% for land, building or furniture; 2% for plant and machinery – section 194-I (1961 Act), section 393 of the 2025 Act from 1-Apr-2026.\n- Threshold: ₹50,000 a month.\n- No PAN: 20%.\n- GST shown separately is left out."],
    ["Due date of GSTR-9 for 2025-26?",
      "## GSTR-9 Due Date for FY 2025-26\n\nYou want to know when the annual return GSTR-9 for 2025-26 is due.\n\nThe due date is **31 December 2026** (section 44 of the CGST Act, 2017 read with rule 80).\n\n**Who must file**: every regular taxpayer with aggregate turnover above ₹2 crore; below that it is optional.\n\n**GSTR-9C**: self-certified reconciliation where turnover exceeds ₹5 crore.\n\n**Late fee**: ₹200 a day (₹100 CGST + ₹100 SGST), capped as notified by turnover slab.\n\n**Tips**\n- Reconcile GSTR-1, 3B and 2B first.\n- Check ITC reversals under rule 42/43.\n\nLet me know if you'd like a checklist for GSTR-9 or a reconciliation from the books.",
      "31-Dec-2026 (section 44, CGST Act; rule 80).\n- Optional up to ₹2 crore turnover; GSTR-9C above ₹5 crore.\n- Late fee ₹200 a day, capped by turnover."],
    ["Why is cash so low in September?",
      "## Cash Position in September 2026\n\nYou asked why cash is low in September. I looked at the cash and bank balances and the entries.\n\nThe table below shows the cash balance by month:\n| Month | Cash |\n|---|---|\n| Jul | ₹2,10,000 |\n| Aug | ₹1,85,000 |\n| Sep | ₹40,500 |\n\n**Reasons**\n1. Two large cash payments to suppliers on 12-Sep and 20-Sep.\n2. Cash deposited into the bank on 25-Sep.\n3. Lower cash sales in September than in August.\n\n**Suggestion**: review cash payments over ₹10,000 for section 40A(3).\n\nWould you like me to list the cash payments above ₹10,000?",
      "Two large cash payments to suppliers (12-Sep, 20-Sep) and the cash deposited into the bank on 25-Sep; cash sales were also lower than August. The month's balances are in the table below."],
    ["How to treat advance received under GST?",
      "## GST on Advances Received\n\nYou asked how to treat an advance received under GST.\n\n**Goods**: no GST on advances (Notification 66/2017-CT).\n\n**Services**: GST is payable when the advance is received (section 13, CGST Act); issue a receipt voucher (rule 50).\n\n**Adjustment**: when the invoice is issued, adjust the tax paid on the advance; if the supply does not happen, issue a refund voucher (rule 51).\n\n**Reporting**: Table 11A of GSTR-1 for advances, 11B for adjustments.\n\n**Example**: an advance of ₹1,18,000 including 18% GST: tax ₹18,000 paid in that month's 3B.\n\nLet me know if you want journal entries for this.",
      "Goods: no GST on advances (Notification 66/2017-CT).\n- Services: GST when the advance is received (section 13, CGST Act); receipt voucher under rule 50.\n- Adjust on the invoice; refund voucher (rule 51) if the supply does not happen.\n- GSTR-1 Table 11A / 11B."],
  ];
  let b = 0, a = 0;
  const lines = Q.map(([q, before, after]) => { const x = tok(before) + THINK.medium, y = tok(after) + THINK.low; b += x; a += y; ok(y < x, q); return "  " + q.padEnd(44) + String(x).padStart(6) + String(y).padStart(7); });
  console.log("\n  question                                    before  after (output tokens, estimated)\n" + lines.join("\n") + "\n  " + "total".padEnd(44) + String(b).padStart(6) + String(a).padStart(7));
  ok(a < b / 2, "less than half");
});
