// deno test server/assistant/tools/certlib_test.ts (tests/run_certificates.py). The certificates' arithmetic and reading,
// each figure worked out by hand below. Every company here is made up.
import { blocksText, docx, docxText, fieldsIn, fillDocx, fillText, fyOf, inr, lastYears, netWorth, onLine, readSigned, render, unzip, zip } from "./certlib.ts";
import TPL from "./certificate-templates.json" with { type: "json" };
const ok = (c: unknown, w: string) => { if (!c) throw new Error(w); console.log("  ok   " + w); };
const eq = (a: unknown, b: unknown, w: string) => ok(JSON.stringify(a) === JSON.stringify(b), w + (JSON.stringify(a) === JSON.stringify(b) ? "" : ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b)));

Deno.test("net worth, hand-worked: company with a revaluation reserve and miscellaneous expenditure", () => {
  // 10,00,000 capital + 25,40,000 reserves (of which 5,00,000 revaluation) - 60,000 preliminary expenses not written off
  // = 10,00,000 + 25,40,000 - 5,00,000 - 60,000 = 29,80,000
  const r = netWorth({ share_capital: 1000000, reserves: 2540000, revaluation_reserve: 500000, misc_expenditure: 60000 }, "company");
  eq(r.total, 2980000, "net worth 29,80,000");
  eq(r.rows.map((x) => [x.sign, x.amount]), [["+", 1000000], ["+", 2540000], ["-", 500000], ["-", 0], ["-", 60000], ["=", 2980000]], "the working: capital, reserves, less revaluation, less losses (nil), less misc., total");
  ok(/excluded/.test(r.rows[2].item), "the revaluation reserve is shown as excluded");
});
Deno.test("net worth, hand-worked: accumulated losses, inside the reserves or apart, give the same", () => {
  // 5,00,000 capital; securities premium 2,00,000; profit and loss debit balance 7,50,000
  // inside the reserves: reserves = 2,00,000 - 7,50,000 = -5,50,000; 5,00,000 - 5,50,000 = -50,000
  const a = netWorth({ share_capital: 500000, reserves: -550000 }, "company");
  // apart: reserves 2,00,000, accumulated losses 7,50,000: 5,00,000 + 2,00,000 - 7,50,000 = -50,000
  const b = netWorth({ share_capital: 500000, reserves: 200000, accumulated_losses: 750000 }, "company");
  eq([a.total, b.total], [-50000, -50000], "negative net worth -50,000 both ways");
  eq(inr(a.total, true), "(50,000.00)", "shown in brackets");
});
Deno.test("net worth, hand-worked: an LLP's partners' accounts", () => {
  // capital 12,00,000 + current 3,45,678.90 - debit balance of P&L shown as an asset 1,00,000 = 14,45,678.90
  const r = netWorth({ partners_capital: 1200000, partners_current: 345678.9, accumulated_losses: 100000 }, "llp");
  eq(r.total, 1445678.9, "14,45,678.90 to the paisa");
  eq(r.rows.map((x) => x.item.split(" ")[0]), ["Partners'", "Partners'", "Less:", "Net"], "partners' capital and current accounts, less losses");
  // paise do not drift: 0.1 + 0.2
  eq(netWorth({ partners_capital: 0.1, partners_current: 0.2 }, "firm").total, 0.3, "0.10 + 0.20 = 0.30");
});
Deno.test("years and amounts", () => {
  eq(lastYears(3, "2026-10-14"), ["2023", "2024", "2025"], "last 3 years ended by 14-Oct-2026: 2023-24, 2024-25, 2025-26");
  eq(lastYears(1, "2026-03-15"), ["2024"], "before 1 April the last year ended is 2024-25");
  eq([fyOf("FY 2024-25"), fyOf("2026-03-31"), fyOf("2026-04-01")], ["2024", "2025", "2026"], "years from words and dates");
  eq(inr(123456789.5), "12,34,56,789.50", "Indian grouping");
});
Deno.test("reading a signed statement: each figure with its page and line", () => {
  const lines = [
    { page: 1, line: 1, text: "ALDER BRIGHT CASTINGS PRIVATE LIMITED" },
    { page: 1, line: 2, text: "Balance Sheet as at 31st March, 2025" },
    { page: 1, line: 3, text: "(Amount in Rs. in thousands)" },
    { page: 1, line: 4, text: "Particulars  Note  As at 31.03.2025  As at 31.03.2024" },
    { page: 1, line: 5, text: "(a) Share capital  2  1,000.00  1,000.00" },
    { page: 1, line: 6, text: "(b) Reserves and surplus  3  (250.50)  120.00" },
    { page: 2, line: 3, text: "I Revenue from operations  18  48,215.25  41,000.00" },
    { page: 2, line: 4, text: "II Other income  19  312.40  101.00" },
  ];
  const s = readSigned(lines);
  eq([s.fy, s.units, s.kind], ["2024", 1000, "company"], "FY 2024-25, in thousands, a company");
  eq([s.figures.turnover.value, s.figures.turnover.page, s.figures.turnover.line], [48215250, 2, 3], "revenue from operations 4,82,15,250 from page 2 line 3 (the note number 18 skipped)");
  eq(s.figures.other_income.value, 312400, "other income apart: 3,12,400");
  eq([s.figures.share_capital.value, s.figures.reserves.value], [1000000, -250500], "capital 10,00,000; reserves (2,50,500) from the brackets");
  ok(onLine(lines, 2, 3, 48215250, 1000) && !onLine(lines, 2, 4, 48215250, 1000), "a figure stands only on the line it came from");
});
Deno.test("a format with placeholders and blanks is filled; the UDIN is left blank", async () => {
  const f = fieldsIn("Name of the Company: ________\nTurnover for FY 2024-25: ________\nUDIN: ________\nTender No. {{Tender No}}");
  eq(f.map((x) => [x.key, x.year ?? null]), [["client_name", null], ["turnover", "2024"], ["udin", null], ["tender_no", null]], "fields named by their words");
  const t = fillText("Turnover for FY 2024-25: ________ and UDIN: ________", { "turnover:2024": "1,00,000.00" });
  eq(t.text, "Turnover for FY 2024-25: 1,00,000.00 and UDIN: ____________________", "turnover filled; UDIN kept blank");
  // a Word format: a paragraph with a placeholder split over runs, and a table with a year and an empty cell
  const P = (runs: string[]) => "<w:p>" + runs.map((r) => '<w:r><w:t xml:space="preserve">' + r + "</w:t></w:r>").join("") + "</w:p>";
  const cell = (t: string) => '<w:tc><w:p>' + (t ? '<w:r><w:t>' + t + "</w:t></w:r>" : "") + "</w:p></w:tc>";
  const doc = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + P(["We certify that {{Client", " Name}} has a"]) + P(["Purpose: [Purpose of certificate]"]) +
    "<w:tbl><w:tr>" + cell("Year") + cell("Turnover (Rs.)") + "</w:tr><w:tr>" + cell("2024-25") + cell("") + "</w:tr></w:tbl>" + P(["UDIN: ________"]) + "</w:body></w:document>";
  const bytes = zip([["word/document.xml", doc], ["[Content_Types].xml", "<Types/>"]]);
  const r = await fillDocx(bytes, { client_name: "Made-up Traders", "turnover:2024": "12,34,567.00" });
  const txt = await docxText(r.bytes);
  ok(/We certify that Made-up Traders has a/.test(txt), "the placeholder over two runs is filled");
  ok(/12,34,567\.00/.test(txt), "the table's empty cell for 2024-25 takes the turnover");
  ok(/UDIN: _{10,}/.test(txt), "the UDIN stays blank");
  eq(r.missing.map((m) => m.label), ["Purpose of certificate"], "what FinCom does not have is asked: the purpose");
});
Deno.test("the ICAI and the firm's templates: every element, placeholders only, the UDIN blank", async () => {
  const tpl = TPL as any;
  const s = JSON.stringify(tpl);
  ok(!/\d{5,}|[A-Z]{5}\d{4}[A-Z]|[LU]\d{5}[A-Z]{2}\d{4}/.test(s.replace(/\{\{[a-z_]+\}\}/g, "")), "no number, PAN or CIN in the template file: placeholders only");
  for (const fam of ["icai", "firm"]) for (const t of ["turnover", "networth", "combined"]) ok(tpl.templates[fam][t].filter((i: any) => !i.pb).every((i: any) => /^(approved by the owner on \d{2}-[A-Z][a-z]{2}-\d{4}|to confirm by the owner)$/.test(i.confirm)), fam + " " + t + ": each paragraph carries its approval mark");
  const d = { values: { client_name: "Made-up Castings Pvt Ltd", client_kind_word: "Company", client_ids: "", client_address: "Plot 1, Nowhere", addressee: "The Manager, A Bank", purpose: "a loan", years_text: "2024-25 and 2025-26",
    basis_text: "the audited financial statements", auditor: "the statutory auditor", as_on: "31-03-2026", fy_last: "2025-26", firm_name: "A & Co", frn: "000000X", signatory: "A Partner", designation: "Partner", membership_no: "000000", place: "Somewhere", date: "14-10-2026", udin: "____________________" },
    turnover: [{ fy: "2024", value: 100, basis: "signed" }, { fy: "2025", value: 200, basis: "signed" }], networth: netWorth({ share_capital: 10, reserves: 5 }, "company").rows, bvps: null };
  const b = blocksText(render(tpl, "icai", "combined", d));
  for (const w of ["INDEPENDENT PRACTITIONER'S CERTIFICATE", "To,\nThe Manager, A Bank", "Management's Responsibility", "Practitioner's Responsibility", "Guidance Note on Reports or Certificates for Special Purposes", "Opinion", "Restriction on Use", "FRN: 000000X", "M. No. 000000", "UDIN: ____", "Place: Somewhere", "Date: 14-10-2026", "2(57)"])
    ok(b.includes(w), "ICAI: " + w.replace(/\n/g, " / "));
  ok(!/\{\{/.test(b), "no placeholder left unfilled");
  const f = blocksText(render(tpl, "firm", "turnover", d));
  ok(/Average Turnover \| 150\.00/.test(f), "the firm's turnover format has the average row: (100 + 200) / 2 = 150");
  const w = await docx(render(tpl, "icai", "turnover", d), { kind: "text", lines: ["A & Co", "Chartered Accountants"] }, { title: "t" });
  const z = await unzip(w);
  ok(z.has("word/header1.xml") && /UDIN: _{10,}/.test(await docxText(w)), "Word: the letterhead in the header, the UDIN blank");
});
