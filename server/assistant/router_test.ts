// deno test server/assistant/router_test.ts - the parts that need no database: the keyword router (which questions go
// straight to which book tool, and which are left to a model), the task and model for a question, the cost of a call,
// and the case-law check (a page with the name and the quote; a quote not on the page; a link not read in the answer).
import { describe, periodOf, route } from "./router.ts";
import { costUsd, plan, taskOf } from "./models.ts";
import { applyCitations, nameOnPage, NO_CASE, quoteOnPage, verify } from "./citations.ts";
import { annexureCheck, checklistFor, kindOf } from "./notices.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
const ANCHOR = "2026-03-31";   // the fixture's last entry (today is later)

Deno.test("periods are read against the last entry held", () => {
  eq(periodOf("cash payments in September", ANCHOR), { from: "2025-09-01", to: "2025-09-30", fy: "2025-26", label: "Sep 2025" }, "September: the last one");
  eq(periodOf("this quarter", ANCHOR).from, "2026-01-01", "this quarter: Q4 2025-26");
  eq(periodOf("Q2 2025-26", ANCHOR), { from: "2025-07-01", to: "2025-09-30", fy: "2025-26", label: "Q2 2025-26" }, "Q2 of a named year");
  eq([periodOf("last month", ANCHOR).from, periodOf("this year", ANCHOR).from, periodOf("last year", ANCHOR).to], ["2026-02-01", "2025-04-01", "2025-03-31"], "relative periods");
  eq(periodOf("sales in Feb 2026", ANCHOR).to, "2026-02-28", "a month and year");
  eq(periodOf("top customers", ANCHOR).from, null, "nothing named: the tool's default");
});

Deno.test("the keyword router: the questions that keep coming up, with no model", () => {
  const cases: [string, string, Record<string, unknown>?][] = [
    ["Which suppliers crossed 30,000 under 194C without TDS this year?", "tds_missed", { section: "194C", from: "2025-04-01" }],
    ["Cash payments over 10000 in September", "entries_filter", { mode: "cash", direction: "payment", min_amount: 10000, from: "2025-09-01" }],
    ["cash receipts above 2 lakh", "entries_filter", { direction: "receipt", min_amount: 200000 }],
    ["Top 10 customers by sales this quarter", "top_parties", { side: "customers", measure: "turnover", limit: 10, from: "2026-01-01" }],
    ["top 5 suppliers we owe", "top_parties", { side: "suppliers", measure: "balance", limit: 5 }],
    ["TDS paid late this year", "tds_late"], ["Owed to MSME suppliers for more than 45 days", "msme_dues_43bh"], ["ageing of debtors", "ageing", { side: "customers" }],
    ["cash and bank balance on 31 March 2026", "cash_bank", { as_on: "2026-03-31" }], ["profit and loss for 2025-26", "profit_and_loss", { from: "2025-04-01", to: "2026-03-31" }],
    ["monthly sales", "sales_by_month"], ["top expenses", "expenses"], ["ITC vs 2B in February", "itc_vs_2b", { from: "2026-02-01" }], ["3B against 2B for February", "itc_3way"],
    ["sales vs GSTR-1", "sales_vs_gstr1"], ["reverse charge in March", "rcm"], ["any duplicate bills?", "duplicates"], ["round sum journals", "round_sums"],
    ["entries on Sundays", "weekend_entries"], ["salary by month", "payroll"], ["is the client liable to tax audit u/s 44AB", "turnover"], ["26AS vs books 2025-26", "tds_vs_26as", { fy: "2025-26" }],
    ["section 40A(3) cash payments", "cash_payments_40a3"], ["269ST", "cash_receipts_269st"], ["TDS deductees for 194J", "tds_deductees", { section: "194J" }],
    ["purchase register for February", "purchase_register"], ["bank payments in March with UTR", "payments_list"], ["balance of Nightjar Sound & Light Co", "ledger_balance", { ledger: "Nightjar Sound & Light Co" }],
    ["ledger of Kaveri Bank for March", "ledger_entries", { ledger: "Kaveri Bank" }], ["what's due this month", "due_list"], ["which books do you have", "books_held"],
  ];
  for (const [q, tool, want] of cases) {
    const r = route(q, ANCHOR) as any;
    assert(r && r.tool === tool, q + " -> " + tool + " (got " + JSON.stringify(r) + ")");
    for (const [k, v] of Object.entries(want || {})) eq(r.input[k], v, q + ": " + k);
  }
  eq((route("check my Q2 26Q", ANCHOR) as any).prefile, { form: "26Q", fy: "2025-26", quarter: "Q2", month: null, reg: null }, "a check before filing");
  eq((route("is March GST ready to file?", ANCHOR) as any).prefile.month, "2026-03", "a GST month's check");
});

Deno.test("left to a model: why, how, advice, drafts, files, two things at once, notices", () => {
  for (const q of ["Why is GSTR-3B ITC different from 2B in August?", "Explain the TDS late payment interest", "Should we deduct TDS on this rent?", "Draft a reply to the ASMT-10",
    "Excel of all deductees with PAN", "What did we pay Rukmini in March and what was the reverse charge?", "Large bank payments in September, and anyone past a TDS threshold",
    "Read this notice", "Nightjar entries above 50000 between June and August"]) eq(route(q, ANCHOR), null, q);
});

Deno.test("the task and the model: Sonnet for chat, Opus at high effort for notices, Haiku only to route", () => {
  eq(taskOf("Read this notice", true, true), "notice", "an attachment is a notice");
  eq(taskOf("reply to the DRC-01A", false, true), "notice", "a notice by name");
  eq(taskOf("Excel of the deductees", false, true), "file", "a file");
  eq(taskOf("TDS rate on rent for a company?", false, false), "general", "no client: general");
  eq(taskOf("What is the TDS rate on commission?", false, true), "general", "the law, with a client open");
  eq(taskOf("Which payments to Nightjar were over the limit?", false, true), "book", "the books");
  eq([plan("route").model, plan("route").effort], ["claude-haiku-5-5", "low"], "routing: Haiku, low");
  eq([plan("book").model, plan("book").effort, plan("book").fallbacks], ["claude-sonnet-5-5", "medium", true], "chat: Sonnet, medium, fallbacks");
  eq([plan("notice").model, plan("notice").effort, plan("notice").web], ["claude-opus-5-5", "high", true], "notices: Opus, high, web");
  eq(plan("book", "low").effort, "low", "the chat effort can be set lower");
});

Deno.test("cost of a call: input, output, cache reads and the 1-hour cache write, in dollars", () => {
  eq(costUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 100_000 }), 3, "Sonnet: $2 in + $1 out");
  eq(costUsd("claude-opus-5-5", { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 10000, cache_creation: { ephemeral_1h_input_tokens: 10000, ephemeral_5m_input_tokens: 0 } }),
    0.106, "Opus: in 0.004, out 0.02, read 0.002, 1-hour write 2x 0.08");
  eq(costUsd("claude-haiku-5-5", { input_tokens: 2000, output_tokens: 60 }), 0.00023, "Haiku routing: a fraction of a paisa... in dollars");
  eq(costUsd("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 2 } }), 0.02, "web search $10 per 1,000");
});

Deno.test("case law: the page must have the name and the line; a link must have been read in the answer; invented names removed", async () => {
  const page = "<p>In <b>Shiv Shakti Traders</b> v. Commissioner of Central Tax, the Court held: the credit of tax paid under reverse charge cannot be denied merely because it is not reflected in GSTR-2B.</p>";
  assert(nameOnPage("Shiv Shakti Traders v. Commissioner of Central Tax", page), "the name is on the page");
  assert(quoteOnPage("credit of tax paid under reverse charge cannot be denied merely because", page), "the quote is on the page");
  assert(!quoteOnPage("must always allow credit within seven days", page), "a line not on it");
  const base = { court: "Delhi High Court", date: "2025", citation: "W.P.(C) 1/2025", point: "", authority: "high_court_jurisdictional", flags: [], act: "CGST Act 2017" };
  const seen = new Set(["https://indiankanoon.org/doc/1/"]), pages = new Map([["https://indiankanoon.org/doc/1/", page]]);
  const res = await verify([
    { n: 1, case_name: "Shiv Shakti Traders v. Commissioner of Central Tax", url: "https://indiankanoon.org/doc/1/", quote: "cannot be denied merely because it is not reflected in GSTR-2B", ...base },
    { n: 2, case_name: "Made Up Ltd v. Union of India", url: "https://indiankanoon.org/doc/2/", quote: "a line that the model remembers from its training data alone", ...base },
    { n: 3, case_name: "Shiv Shakti Traders v. Commissioner of Central Tax", url: "https://www.taxmann.com/x", quote: "cannot be denied merely because it is not reflected in GSTR-2B", ...base },
    { n: 4, case_name: "Shiv Shakti Traders v. Commissioner of Central Tax", url: "https://indiankanoon.org/doc/3/", quote: "cannot be denied merely because it is not reflected in GSTR-2B", ...base },
  ], new Set([...seen, "https://indiankanoon.org/doc/3/"]), pages, async (u) => (u.endsWith("/3/") ? "<p>Another case altogether, about customs duty on imported goods and valuation.</p>" : null));
  eq(res.map((c) => [c.n, c.ok, c.why]), [[1, true, ""], [2, false, "not found or read in this answer"], [3, false, "a paid database: not used"], [4, false, "the case's name is not on the page"]], "only the first");
  const t = applyCitations("RCM credit [C:1]. Contra [C:2]. Also ABC Industries v. State of Gujarat held so.", res).text;
  assert(t.includes("Shiv Shakti Traders v. Commissioner of Central Tax (Delhi High Court") && t.includes(NO_CASE) && !t.includes("ABC Industries"), t);
});

Deno.test("notices: the kind from the form; the checklist by issue; the reply must cite exactly the annexures there are", () => {
  eq([kindOf({ form: "ASMT-10" }), kindOf({ form: "DRC-01A" }), kindOf({ form: "Intimation u/s 143(1)(a)" }), kindOf({ form: "REG-17" }), kindOf({ form: "Notice", section: "148A(b)" })], ["gst_asmt10", "gst_drc01a", "it_143_1a", "gst_reg17", "it_148"], "kinds");
  const base = { law: "GST", form: "ASMT-10", kind: "gst_asmt10", summary: "", notice_no: "", din: "", notice_date: null, section: "", period: "", id_no: "", amount: null, reply_by: null, asked: [], months: ["2026-02"], fy: null, reference: "" };
  const itc = checklistFor({ ...base, issues: [{ type: "itc_mismatch", point: "", amount: null, period: null }] }).map((i) => i.id);
  assert(itc.includes("itc_recon") && itc.includes("invoices") && !itc.includes("turnover_recon"), "ITC: " + itc);
  const to = checklistFor({ ...base, issues: [{ type: "turnover_mismatch", point: "", amount: null, period: null }] }).map((i) => i.id);
  assert(to.includes("turnover_recon") && to.includes("gstr1_copy") && !to.includes("itc_recon"), "turnover: " + to);
  const reg = checklistFor({ ...base, form: "REG-17", kind: "gst_reg17", issues: [] }).map((i) => i.id);
  assert(reg.includes("premises") && reg.includes("returns_filed"), "registration: " + reg);
  const an = [{ n: 1 }, { n: 2 }] as any;
  eq(annexureCheck("see Annexure 1 and Annexure-2", an).ok, true, "both cited");
  eq(annexureCheck("see Annexure 1 and Annexure 3", an), { ok: false, cited: [1, 3], unknown: [3], uncited: [2] }, "a wrong number");
});

Deno.test("describe: FinCom's own line from a tool's summary", () => {
  const t = describe({ tool: "tds_missed", title: "Suppliers past a TDS limit with no TDS", period: { from: "2025-04-01", to: "2026-03-31" }, rows: [{}], summary: { tds: 400, disallowance30pct: 12000, count: 1 } }, "");
  assert(t.startsWith("Suppliers past a TDS limit with no TDS, 01-Apr-2025 to 31-Mar-2026.") && t.includes("TDS: ₹400.00") && t.includes("entries: 1") && t.includes("1 line"), t);
});
