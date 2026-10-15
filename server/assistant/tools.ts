// FinCom Assistant's tools: the fixed, parameterised questions over the books (each a read-only SQL function of migration 77,
// run as the signed-in user under row-level security), and the few others the assistant has (the Day Book slice for the AI
// fallback, figures to check, a notice's fields, a draft, a file, a screen to point to). Claude only chooses a tool and fills
// its parameters; every figure of the books comes from the database.
// Plain module (no Deno, no SDK import), so the tests load it anywhere.

export type Param = { type: "string" | "number" | "integer" | "boolean" | "date" | "enum" | "array" | "object"; desc: string; values?: string[] };
export type BookTool = {
  name: string;
  fn: string;                      // the SQL function (public.asst_*)
  desc: string;
  params: Record<string, Param>;   // what Claude fills; p_client is added by the server
  args: string[];                  // the SQL function's arguments after p_client, in order, by param name ("" : null)
  fixed?: Record<string, unknown>; // arguments the server sets
};

const D = (desc: string): Param => ({ type: "date", desc });
const S = (desc: string): Param => ({ type: "string", desc });
const N = (desc: string): Param => ({ type: "number", desc });
const FROM = D("first date, YYYY-MM-DD (null: start of the financial year of the last date)");
const TO = D("last date, YYYY-MM-DD (null: the last entry held)");
const ASON = D("the date, YYYY-MM-DD (null: the last entry held)");

export const BOOK_TOOLS: BookTool[] = [
  { name: "books_held", fn: "asst_books", desc: "Which Tally books FinCom holds for the client: each company's period, last entry and when it was last brought up to date. Use first when unsure which dates exist.", params: {}, args: [] },
  { name: "find_ledgers", fn: "asst_find_ledgers", desc: "List ledgers whose name has these words, or under a group (e.g. 'Sundry Creditors', 'Bank'), with each one's balance. Use to find the exact ledger name.",
    params: { text: S("words in the ledger name, or null"), group: S("a Tally group, or null"), as_on: ASON }, args: ["text", "group", "as_on"] },
  { name: "ledger_balance", fn: "asst_ledger_balance", desc: "A ledger's balance on a date: opening, debits and credits to the date, closing (Dr/Cr).",
    params: { ledger: S("the ledger name (words of it are enough)"), as_on: ASON }, args: ["ledger", "as_on"] },
  { name: "ledger_movement", fn: "asst_ledger_movement", desc: "A ledger month by month: debits, credits and the running balance.",
    params: { ledger: S("the ledger name"), from: FROM, to: TO }, args: ["ledger", "from", "to"] },
  { name: "ledger_entries", fn: "asst_ledger_entries", desc: "A ledger's account: every entry in the period with the running balance.",
    params: { ledger: S("the ledger name"), from: FROM, to: TO, limit: { type: "integer", desc: "most entries to list (default 200, at most 500)" } }, args: ["ledger", "from", "to", "limit"] },
  { name: "top_parties", fn: "asst_top_parties", desc: "Top customers by sales (before GST), top suppliers by what they billed, or either by balance owed on the last date.",
    params: { side: { type: "enum", desc: "customers or suppliers", values: ["customers", "suppliers"] }, measure: { type: "enum", desc: "turnover (sales or purchases) or balance", values: ["turnover", "balance"] },
      from: FROM, to: TO, limit: { type: "integer", desc: "how many (default 10)" } }, args: ["side", "measure", "from", "to", "limit"] },
  { name: "entries_filter", fn: "asst_entries_filter", desc: "Entries by any filter: dates, amount range, cash or bank, payments or receipts, a ledger, a party, a voucher type, words in the narration. 'Cash payments over 10,000 in September' is mode cash, direction payment, min 10000.",
    params: { from: FROM, to: TO, min_amount: N("smallest amount, or null"), max_amount: N("largest amount, or null"),
      mode: { type: "enum", desc: "cash, bank or any", values: ["any", "cash", "bank"] }, direction: { type: "enum", desc: "payment, receipt or any", values: ["any", "payment", "receipt"] },
      ledger: S("a ledger in the entry, or null"), party: S("a party's name, or null"), voucher_type: S("Payment, Receipt, Journal, Sales, Purchase..., or null"), narration: S("words in the narration, or null"),
      limit: { type: "integer", desc: "most entries to list (default 200)" } },
    args: ["from", "to", "min_amount", "max_amount", "mode", "direction", "ledger", "party", "voucher_type", "narration", "limit"] },
  { name: "voucher", fn: "asst_voucher", desc: "One entry by its voucher number (or the supplier's bill number), every line.",
    params: { number: S("the voucher or bill number"), date: D("its date, or null") }, args: ["number", "date"] },
  { name: "profit_and_loss", fn: "asst_profit_loss", desc: "The profit and loss by head (revenue, other income, direct, employee, other, finance, depreciation), gross profit and profit before tax.",
    params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "sales_by_month", fn: "asst_sales_by_month", desc: "Sales (before GST) and output GST month by month.", params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "expenses", fn: "asst_expenses", desc: "Expenses and purchases by ledger, largest first.", params: { from: FROM, to: TO, limit: { type: "integer", desc: "how many (default 30)" } }, args: ["from", "to", "limit"] },
  { name: "cash_bank", fn: "asst_cash_bank", desc: "Cash and bank balances on a date.", params: { as_on: ASON }, args: ["as_on"] },
  { name: "ageing", fn: "asst_ageing", desc: "What customers owe (or suppliers are owed) on a date, by age: 0-30, 31-60, 61-90, 91-180, over 180 days.",
    params: { side: { type: "enum", desc: "customers or suppliers", values: ["customers", "suppliers"] }, as_on: ASON }, args: ["side", "as_on"] },
  { name: "tds_summary", fn: "asst_tds_summary", desc: "Each TDS ledger: opening owed, deducted, paid, closing owed.", params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "tds_missed", fn: "asst_tds_missed", desc: "Suppliers who crossed a TDS limit (194C 30,000 a bill or 1,00,000 a year; 194J 50,000; 194H; 194-I; 194A) with no TDS deducted in the books; the TDS due and the 30% disallowance under 40(a)(ia).",
    params: { from: FROM, to: TO, section: S("194C, 194J, 194H, 194-I, 194A or null for all") }, args: ["from", "to", "section"] },
  { name: "tds_late", fn: "asst_tds_late", desc: "TDS deducted, its due date (7th of the next month, 30 April for March) and when it was paid: late, overdue or on time.", params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "tds_deductees", fn: "asst_tds_deductees", desc: "TDS by deductee: the amount paid or credited, the TDS, the section and the PAN.", params: { from: FROM, to: TO, section: S("a section or null") }, args: ["from", "to", "section"] },
  { name: "gst_summary", fn: "asst_gst_summary", desc: "GST month by month: taxable sales, output tax, input tax, reverse charge.", params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "itc_vs_2b", fn: "asst_itc_vs_2b", desc: "Input tax in the books against GSTR-2B, month by month and supplier by supplier, with where a 2B invoice sits in the books. For 'why is 3B ITC different from 2B'.",
    params: { from: FROM, to: TO, gstin: S("the client's GSTIN, or null for all") }, args: ["from", "to", "gstin"] },
  { name: "sales_vs_gstr1", fn: "asst_sales_vs_r1", desc: "Sales in the books against GSTR-1 as filed (fetched from the portal), month by month.", params: { from: FROM, to: TO, gstin: S("GSTIN or null") }, args: ["from", "to", "gstin"] },
  { name: "rcm", fn: "asst_rcm", desc: "Reverse-charge entries: value and tax.", params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "cash_payments_40a3", fn: "asst_cash_40a3", desc: "Section 40A(3): cash paid over 10,000 to one party in a day (35,000 to a transporter).", params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "cash_receipts_269st", fn: "asst_cash_269st", desc: "Section 269ST: cash received of 2 lakh or more from one person in a day.", params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "msme_dues_43bh", fn: "asst_msme_43bh", desc: "Section 43B(h): owed to micro and small suppliers for more than 45 days.", params: { as_on: ASON, days: { type: "integer", desc: "days (default 45)" } }, args: ["as_on", "days"] },
  { name: "duplicates", fn: "asst_duplicates", desc: "Possible duplicate entries: the same supplier bill twice, or the same party and amount within three days.", params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "round_sums", fn: "asst_round_sums", desc: "Round-sum journals to income or expense ledgers, and large journals with no narration.", params: { from: FROM, to: TO, min_amount: N("smallest amount (default 1,00,000)") }, args: ["from", "to", "min_amount"] },
  { name: "weekend_entries", fn: "asst_weekend", desc: "Sales, purchases, receipts and payments dated on a Sunday (or Saturday) or a national holiday.", params: { from: FROM, to: TO, saturdays: { type: "boolean", desc: "include Saturdays" } }, args: ["from", "to", "saturdays"] },
  { name: "payroll", fn: "asst_payroll", desc: "Salary and staff costs month by month, and salary paid per employee where Tally's payroll gives it.", params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "due_list", fn: "asst_due_list", desc: "This client's own dues from its books: TDS deposits, GSTR-1 and 3B, TDS returns and tasks, with status. Never for the law's due date of a return (GSTR-9, ITR, tax audit...): answer that from the law.", params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "turnover", fn: "asst_turnover", desc: "Turnover (revenue from operations), other income, and the share of cash receipts and payments: for the tax-audit limits of section 44AB.", params: { from: FROM, to: TO }, args: ["from", "to"] },
  { name: "purchase_register", fn: "asst_purchase_register", desc: "The purchase register: each purchase or expense bill (bill no., supplier GSTIN, value, input tax, total), party by party.",
    params: { from: FROM, to: TO, party: S("a supplier, or null for all") }, args: ["from", "to", "party"] },
  { name: "payments_list", fn: "asst_payments_list", desc: "Payments through the bank with the UTR, NEFT, RTGS or cheque reference written in the narration: payment proofs.",
    params: { from: FROM, to: TO, party: S("a party, or null for all") }, args: ["from", "to", "party"] },
  { name: "tds_vs_26as", fn: "asst_tds_vs_26as", desc: "The client's own tax credit: Form 26AS (or AIS) brought into FinCom against the TDS receivable in the books, deductor by deductor, for a financial year.",
    params: { fy: S("the financial year, e.g. 2025-26, or null for the latest") }, args: ["fy"] },
  { name: "itc_3way", fn: "asst_itc_3way", desc: "Input tax three ways, month by month: the books (invoices and reverse charge), GSTR-2B, and GSTR-3B as filed (table 4A). For an ASMT-10 or DRC-01 on ITC, and 'why is 3B ITC more than 2B'.",
    params: { from: FROM, to: TO, gstin: S("the client's GSTIN, or null for all") }, args: ["from", "to", "gstin"] },
  { name: "turnover_3way", fn: "asst_turnover_3way", desc: "Turnover three ways, month by month: the books, GSTR-1 as filed and GSTR-3B 3.1(a) as filed.",
    params: { from: FROM, to: TO, gstin: S("GSTIN or null") }, args: ["from", "to", "gstin"] },
];

// the AI fallback: the slice of the Day Book Claude reads when no fixed question fits
export const SLICE_TOOL: BookTool = { name: "daybook_slice", fn: "asst_daybook_slice",
  desc: "ONLY when no other tool answers the question, or a tool gave nothing usable: the entries of the dates the question needs (narrowed by a ledger, a party or words), with their lines (Tally's sign: a debit is negative). Your answer from it is marked 'AI answer, not checked against the books'. Cite every entry you use as [V:<voucher no>|<YYYY-MM-DD>] and record every figure you state with record_figures.",
  params: { from: FROM, to: TO, ledger: S("a ledger, or null"), party: S("a party, or null"), narration: S("words in the narration, or null") },
  args: ["from", "to", "ledger", "party", "narration"], fixed: { p_max: 150 } };

export const ALL_BOOK_TOOLS = [...BOOK_TOOLS, SLICE_TOOL];
export const bookTool = (name: string) => ALL_BOOK_TOOLS.find((t) => t.name === name) || null;

// the screens the user is pointed to for anything the assistant may not do (post, file, delete, change)
export const SCREENS: Record<string, string> = {
  post_to_tally: "Post to Tally (the client's Purchase page, Post to Tally tab)",
  bills: "Purchase bills (the client's Purchase page)",
  bank: "Bank (the client's Bank page)",
  sales: "Sales invoices (the client's Sales page)",
  gst_filing: "GST › File (the GST page's filing tab)",
  gst_settings: "GST settings",
  tds_returns: "TDS › Returns (the TDS page)",
  tds_challans: "TDS › Challans",
  tally_ledgers: "From Tally › Tally ledgers (confirm or change a ledger's kind)",
  tally_sync: "Tally (the bridge and bringing books in)",
  closed_periods: "Settings › Closed periods",
  due_list: "Today › Due list",
};

const STR = { type: "string" }, STRN = { type: ["string", "null"] };
export const OTHER_TOOLS = [
  { name: "record_figures", description: "Record each figure you state that is not copied from a book tool's table (a total, a count, an amount for a party, a month or a ledger), with the book tool and parameters that compute the same figure and the field that holds it. FinCom recomputes each one; where the books differ, FinCom's figure is used and yours is struck out. Call it BEFORE your final answer.",
    input_schema: { type: "object", additionalProperties: false, required: ["figures"], properties: { figures: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "value", "text", "tool", "input_json", "field"], properties: {
      name: { type: "string", description: "what the figure is, in a few words" },
      value: { type: "number", description: "the figure you state" },
      text: { type: "string", description: "the figure exactly as you write it in the answer, e.g. ₹1,23,450" },
      tool: { type: "string", description: "the book tool that computes it, e.g. entries_filter" },
      input_json: { type: "string", description: "that tool's parameters as a JSON object, e.g. {\"from\":\"2026-03-01\",\"to\":\"2026-03-31\"}" },
      field: { type: "string", description: "where the figure is in that tool's result: summary.total, count, or rows[<column>=<value>].<column>" } } } } } } },
  { name: "record_notice", description: "Record what a notice says, after reading it, once per notice and before anything else: the reference fields exactly as printed, a plain summary, the law, the form and FinCom's kind for it, the section, the amount, the date the reply is due, what is asked, each issue raised (typed), and the months or financial year it covers. FinCom then lists the documents the department will expect and makes the ones it can from the books, numbered Annexure 1, 2, ...",
    input_schema: { type: "object", additionalProperties: false, required: ["summary", "law", "form", "kind", "notice_no", "din", "notice_date", "section", "period", "id_no", "amount", "reply_by", "asked", "issues", "months", "fy"], properties: {
      summary: STR, law: { type: "string", enum: ["GST", "Income tax", "TDS", "Other"] }, form: { type: "string", description: "ASMT-10, DRC-01, DRC-01A, REG-17, REG-31, 143(1)(a), 143(2), 148, 148A, 133(6), justification report, 270A..." },
      kind: { type: "string", enum: ["gst_asmt10", "gst_drc01", "gst_drc01a", "gst_reg17", "gst_reg31", "it_143_1a", "it_143_2", "it_148", "it_133_6", "tds_default", "it_penalty", "other"] },
      notice_no: STR, din: { type: "string", description: "the DIN or the reference number (ARN, communication reference)" }, notice_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
      section: { type: "string", description: "the section and rule, old and new Act where both apply" }, period: { type: "string", description: "AY, FY or tax period as printed" },
      id_no: { type: "string", description: "the GSTIN or PAN the notice is addressed to, as printed" }, amount: { type: ["number", "null"] }, reply_by: { type: ["string", "null"], description: "YYYY-MM-DD" },
      asked: { type: "array", items: STR },
      issues: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "point", "amount", "period"], properties: {
        type: { type: "string", enum: ["itc_mismatch", "rcm", "turnover_mismatch", "tds_credit", "tds_default", "cash", "high_value", "registration", "income", "other"] }, point: STR, amount: { type: ["number", "null"] }, period: STRN } } },
      months: { type: "array", items: STR, description: "the tax months it covers, YYYY-MM" }, fy: { type: ["string", "null"], description: "the financial year it covers, 2025-26 (AY 2026-27 is FY 2025-26)" } } } },
  { name: "add_documents", description: "Add documents the department will expect for this notice that FinCom's list does not have, each with the official page (CBIC, CBDT, the GST or income-tax portal) you found it on in this answer. A link not found in this answer is dropped.",
    input_schema: { type: "object", additionalProperties: false, required: ["documents"], properties: { documents: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "why", "source_url"], properties: { name: STR, why: STR, source_url: STR } } } } } },
  { name: "record_citation", description: "Record each case or circular you rely on, ONLY from a page you found with web_search or read with web_fetch in this answer (prefer indiankanoon.org, the Supreme Court, High Courts, ITAT, CESTAT, GSTAT, incometaxindia.gov.in, cbic-gst.gov.in). Never from memory. FinCom checks the page has the case's name and the line you quote; then refer to it in your text and drafts as [C:<n>] (n: its number here) and nothing else. One that fails is replaced by 'No verified case found for this point.'",
    input_schema: { type: "object", additionalProperties: false, required: ["citations"], properties: { citations: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["n", "case_name", "court", "date", "citation", "url", "quote", "point", "authority", "flags", "act"], properties: {
        n: { type: "integer" }, case_name: { type: "string", description: "as on the page, e.g. 'ABC Ltd v. Union of India'; for a circular, its number and date" }, court: STR, date: STR, citation: { type: "string", description: "the citation or appeal number" },
        url: STR, quote: { type: "string", description: "one line copied exactly from the page, showing the point relied on (at least 8 words)" }, point: STR,
        authority: { type: "string", enum: ["statute", "rule", "circular", "notification", "supreme_court", "high_court_jurisdictional", "high_court_other", "tribunal", "other"] },
        flags: { type: "array", items: { type: "string", enum: ["stayed", "reversed", "overruled", "pending_appeal", "old_act_only", "new_act_check"] } },
        act: { type: "string", enum: ["IT Act 1961", "IT Act 2025", "CGST Act 2017", "other"] } } } } } } },
  { name: "draft", description: "Put a draft (a reply to a notice, a letter, a submission, a note) in front of the user, marked DRAFT for the CA to review. Text only; figures in it must come from the book tools of this conversation. A notice reply answers each issue point by point, cites the annexures as 'Annexure N' exactly as FinCom numbered them (every one of them), and cites case law only as [C:n]; FinCom adds the reference block (notice no., DIN, date, section, period, GSTIN or PAN) and builds the reply pack.",
    input_schema: { type: "object", additionalProperties: false, required: ["title", "kind", "body"], properties: { title: STR, kind: { type: "string", enum: ["notice_reply", "letter", "submission", "note"] }, body: { type: "string", description: "the full text; plain paragraphs, a line starting '# ' is a heading" } } } },
  { name: "make_file", description: "Make a file the user can download: xlsx (a sheet per table, numbers as numbers, ₹ format, totals as formulas), docx (headings, tables, the firm's letterhead and the date) or pdf (the same on A4). Tables come ONLY from book tools: give the tool and its parameters and FinCom computes them again; text sections may be your own writing (marked AI-drafted). Kept 30 days in the firm's private storage.",
    input_schema: { type: "object", additionalProperties: false, required: ["format", "title", "file_name", "sections"], properties: {
      format: { type: "string", enum: ["xlsx", "docx", "pdf"] }, title: STR, file_name: STRN,
      sections: { type: "array", items: { type: "object", additionalProperties: false, required: ["heading", "text", "table_tool", "table_input_json"], properties: {
        heading: STRN, text: { type: ["string", "null"], description: "your own text (a letter, a note), or null" },
        table_tool: { type: ["string", "null"], description: "a book tool for this section's table, or null" }, table_input_json: { type: ["string", "null"], description: "that tool's parameters as a JSON object, or null" } } } } } } },
  { name: "prefiling_check", description: "Check a return before it is filed: a TDS quarter (26Q, 27Q, 24Q) or a GST month. FinCom runs every check that applies (deductions missed, rate, challans, late payment and interest, PAN, 26AS, duplicates, GST ITC against 2B, reverse charge, rule 37) from its own logic and shows the checklist; you do not see its figures.",
    input_schema: { type: "object", additionalProperties: false, required: ["return", "fy", "quarter", "month", "gstin_state"], properties: {
      return: { type: "string", enum: ["26Q", "27Q", "24Q", "GST"] }, fy: { type: ["string", "null"], description: "2025-26" }, quarter: { type: ["string", "null"], enum: ["Q1", "Q2", "Q3", "Q4", null] },
      month: { type: ["string", "null"], description: "a GST month, YYYY-MM" }, gstin_state: { type: ["string", "null"], description: "the GSTIN's state code, e.g. 07, or null" } } } },
  { name: "point_to_screen", description: "Point the user to the FinCom screen that does what you may not do: post or change entries, file a return, delete, change settings. You never do these yourself.",
    input_schema: { type: "object", additionalProperties: false, required: ["screen", "why"], properties: { screen: { type: "string", enum: Object.keys(SCREENS) }, why: STR } } },
];
const NOTICE_ONLY = new Set(["record_notice", "add_documents"]);
const WEB_ONLY = new Set(["record_citation"]);
// paid databases are never searched or read (the owner's rule: case search uses free public sources)
export const PAID_DOMAINS = ["taxmann.com", "scconline.com", "manupatra.com", "lexisnexis.com", "westlaw.com", "casemine.com"];

import { EXT_TOOLS } from "./tools/index.ts";

// a book tool's parameters as a strict JSON schema (every object closed, every field required, null where it may be empty)
function bookSchema(t: BookTool, firmWide: boolean) {
  const props: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(t.params)) {
    props[k] = p.type === "date" ? { type: ["string", "null"], description: p.desc } : p.type === "enum" ? { type: ["string", "null"], enum: [...(p.values || []), null], description: p.desc }
      : { type: [p.type, "null"], description: p.desc };
  }
  if (firmWide) props.client = { type: "string", description: "the client's name or id (use list_clients)" };
  return { type: "object", additionalProperties: false, properties: props, required: Object.keys(props) };
}

// Claude's tool list for a task. Deterministic (the same task gives byte-identical tools, so the prompt cache is read):
// every book tool, the Day Book slice, the others the task uses, and the web tools (search at most 3 times an answer;
// fetch for case law and circulars) only for general questions and notices. strict: asked for, and kept only while the
// request stays within the API's limits on strict schemas (fitStrict, below); FinCom checks every input either way.
export function claudeTools(firmWide: boolean, o: { web?: boolean, notice?: boolean, strict?: boolean } = {}): Record<string, unknown>[] {
  const strict = o.strict !== false;
  const tools: Record<string, unknown>[] = ALL_BOOK_TOOLS.map((t) => ({ name: t.name, description: t.desc, input_schema: bookSchema(t, firmWide), eager_input_streaming: true, ...(strict ? { strict: true } : {}) }));
  if (firmWide) tools.push({ name: "list_clients", description: "The firm's clients (name, GSTIN, whether books are held). Use to find the client a question is about.",
    input_schema: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: ["string", "null"] } } }, eager_input_streaming: true, ...(strict ? { strict: true } : {}) });
  for (const t of OTHER_TOOLS) {
    if (NOTICE_ONLY.has(t.name) && !o.notice) continue;
    if (WEB_ONLY.has(t.name) && !o.web) continue;
    tools.push({ ...t, eager_input_streaming: true, ...(strict ? { strict: true } : {}) });
  }
  for (const t of EXT_TOOLS) tools.push({ name: t.name, description: t.description, input_schema: t.input_schema, eager_input_streaming: true, ...(strict ? { strict: true } : {}) });
  if (o.web) {
    tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 3, blocked_domains: PAID_DOMAINS });
    tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: 4, blocked_domains: PAID_DOMAINS });
  }
  return fitStrict(tools);
}
// the routing step's tools (Haiku): the book tools only, no fallback, nothing else
export function routerTools(strict = true): Record<string, unknown>[] {
  return fitStrict(BOOK_TOOLS.map((t) => ({ name: t.name, description: t.desc, input_schema: bookSchema(t, false), ...(strict ? { strict: true } : {}) })));
}

// The API's limits on strict tools, for all the strict schemas of one request together (platform.claude.com, structured
// outputs, checked 14-Oct-2026): at most 20 tools with strict: true, 24 optional parameters, and 16 parameters with a union
// type (anyOf or a type array such as ["string", "null"]). Over any of them the request is refused with a 400 (Sentry
// FINCOM-CLOUD-STAGING-1/-2: every call, Haiku's and Sonnet's, sent 35-52 strict tools with 93-176 union parameters).
// A list over the limits is sent without strict: FinCom checks every tool input itself (safeArgs; eager input streaming
// means the API does not validate it anyway).
export const STRICT_LIMITS = { tools: 20, optional: 24, unions: 16 };
export function strictLoad(tools: Record<string, unknown>[]): { tools: number, optional: number, unions: number } {
  const n = { tools: 0, optional: 0, unions: 0 };
  const walk = (s: any) => {
    if (!s || typeof s !== "object") return;
    const req = new Set(Array.isArray(s.required) ? s.required : []);
    for (const [k, v] of Object.entries<any>(s.properties || {})) {
      if (!req.has(k)) n.optional++;
      if (Array.isArray(v?.type) || Array.isArray(v?.anyOf)) n.unions++;
      walk(v);
    }
    if (s.items) walk(s.items);
    for (const a of s.anyOf || []) walk(a);
  };
  for (const t of tools) if (t.strict === true) { n.tools++; walk(t.input_schema); }
  return n;
}
export function fitStrict(tools: Record<string, unknown>[]): Record<string, unknown>[] {
  const n = strictLoad(tools);
  if (n.tools <= STRICT_LIMITS.tools && n.optional <= STRICT_LIMITS.optional && n.unions <= STRICT_LIMITS.unions) return tools;
  return tools.map(({ strict: _s, ...t }) => t);
}

// a tool's input checked against its parameters (eager input streaming: the API does not validate it). Unknown keys,
// wrong types and bad dates are errors; missing ones are null. Returns the SQL arguments.
export function sqlArgs(t: BookTool, input: Record<string, unknown>, client: string): { ok: true, args: Record<string, unknown> } | { ok: false, error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "input is not an object" };
  const known = new Set([...Object.keys(t.params), "client"]);
  for (const k of Object.keys(input)) if (!known.has(k)) return { ok: false, error: "unknown parameter " + k };
  const args: Record<string, unknown> = { p_client: client };
  t.args.forEach((name, i) => {
    const p = t.params[name];
    let v = (input as Record<string, unknown>)[name];
    if (v === undefined || v === "" ) v = null;
    if (v !== null) {
      if (p.type === "date") { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + "T00:00:00Z")) || new Date(v + "T00:00:00Z").toISOString().slice(0, 10) !== v) throw new Error("bad date in " + name); }
      else if (p.type === "number") { if (typeof v === "string" && /^-?[\d,]+(\.\d+)?$/.test(v)) v = Number(v.replace(/,/g, "")); if (typeof v !== "number" || !isFinite(v)) throw new Error("not a number: " + name); }
      else if (p.type === "integer") { if (typeof v === "string" && /^\d+$/.test(v)) v = Number(v); if (typeof v !== "number" || !Number.isInteger(v)) throw new Error("not a whole number: " + name); }
      else if (p.type === "boolean") { if (typeof v !== "boolean") throw new Error("not true or false: " + name); }
      else if (p.type === "enum") { if (typeof v !== "string" || !(p.values || []).includes(v)) throw new Error("not one of " + (p.values || []).join(", ") + ": " + name); }
      else if (typeof v !== "string") throw new Error("not text: " + name);
      if (typeof v === "string") v = v.slice(0, 200);
    }
    args[sqlName(t, i)] = v;
  });
  Object.assign(args, t.fixed || {});
  return { ok: true, args };
}
// the SQL function's argument names, in order (p_client first)
const SQLNAMES: Record<string, string[]> = {
  asst_books: [], asst_find_ledgers: ["p_text", "p_group", "p_as_on"], asst_ledger_balance: ["p_ledger", "p_as_on"], asst_ledger_movement: ["p_ledger", "p_from", "p_to"],
  asst_ledger_entries: ["p_ledger", "p_from", "p_to", "p_limit"], asst_top_parties: ["p_side", "p_measure", "p_from", "p_to", "p_limit"],
  asst_entries_filter: ["p_from", "p_to", "p_min", "p_max", "p_mode", "p_direction", "p_ledger", "p_party", "p_vtype", "p_text", "p_limit"],
  asst_voucher: ["p_vno", "p_day"], asst_profit_loss: ["p_from", "p_to"], asst_sales_by_month: ["p_from", "p_to"], asst_expenses: ["p_from", "p_to", "p_limit"],
  asst_cash_bank: ["p_as_on"], asst_ageing: ["p_side", "p_as_on"], asst_tds_summary: ["p_from", "p_to"], asst_tds_missed: ["p_from", "p_to", "p_section"],
  asst_tds_late: ["p_from", "p_to"], asst_tds_deductees: ["p_from", "p_to", "p_section"], asst_gst_summary: ["p_from", "p_to"], asst_itc_vs_2b: ["p_from", "p_to", "p_gstin"],
  asst_sales_vs_r1: ["p_from", "p_to", "p_gstin"], asst_rcm: ["p_from", "p_to"], asst_cash_40a3: ["p_from", "p_to"], asst_cash_269st: ["p_from", "p_to"],
  asst_msme_43bh: ["p_as_on", "p_days"], asst_duplicates: ["p_from", "p_to"], asst_round_sums: ["p_from", "p_to", "p_min"], asst_weekend: ["p_from", "p_to", "p_saturday"],
  asst_payroll: ["p_from", "p_to"], asst_due_list: ["p_from", "p_to"], asst_turnover: ["p_from", "p_to"],
  asst_purchase_register: ["p_from", "p_to", "p_party"], asst_payments_list: ["p_from", "p_to", "p_party"], asst_tds_vs_26as: ["p_fy"], asst_itc_3way: ["p_from", "p_to", "p_gstin"], asst_turnover_3way: ["p_from", "p_to", "p_gstin"], asst_daybook_slice: ["p_from", "p_to", "p_ledger", "p_party", "p_text"],
};
function sqlName(t: BookTool, i: number): string {
  const n = (SQLNAMES[t.fn] || [])[i];
  if (!n) throw new Error("no argument " + i + " for " + t.fn);
  return n;
}
export function safeArgs(t: BookTool, input: Record<string, unknown>, client: string) {
  try { return sqlArgs(t, input, client); } catch (e) { return { ok: false as const, error: (e as Error).message }; }
}

// what the user sees while a tool runs
export function toolLabel(name: string, input: Record<string, unknown>): string {
  const p = (k: string) => (input && input[k] != null && input[k] !== "" ? String(input[k]) : "");
  const span = p("from") || p("to") ? " (" + [p("from"), p("to")].filter(Boolean).join(" to ") + ")" : p("as_on") ? " on " + p("as_on") : "";
  const L: Record<string, string> = {
    books_held: "Looking at which books FinCom holds", find_ledgers: "Finding ledgers", ledger_balance: "Reading the balance of " + p("ledger"), ledger_movement: "Reading " + p("ledger") + " month by month",
    ledger_entries: "Reading the entries in " + p("ledger"), top_parties: "Ranking " + (p("side") || "customers"), entries_filter: "Filtering the entries", voucher: "Finding entry " + p("number"),
    profit_and_loss: "Working out the profit and loss", sales_by_month: "Adding up sales by month", expenses: "Adding up expenses", cash_bank: "Reading cash and bank",
    ageing: "Ageing what " + (p("side") === "suppliers" ? "suppliers are owed" : "customers owe"), tds_summary: "Reading the TDS ledgers", tds_missed: "Checking TDS limits", tds_late: "Checking when TDS was paid",
    tds_deductees: "Listing deductees", gst_summary: "Reading GST by month", itc_vs_2b: "Matching input tax with GSTR-2B", sales_vs_gstr1: "Matching sales with GSTR-1", rcm: "Listing reverse charge",
    cash_payments_40a3: "Checking cash payments (40A(3))", cash_receipts_269st: "Checking cash receipts (269ST)", msme_dues_43bh: "Checking MSME dues (43B(h))", duplicates: "Looking for duplicates",
    round_sums: "Looking for round sums", purchase_register: "Reading the purchase register", payments_list: "Listing bank payments", tds_vs_26as: "Matching 26AS with the books", itc_3way: "Matching ITC: books, 2B and 3B", turnover_3way: "Matching turnover: books, GSTR-1 and 3B", weekend_entries: "Looking for weekend entries", payroll: "Reading payroll", due_list: "Reading the due list", turnover: "Working out turnover",
    daybook_slice: "Reading the Day Book", list_clients: "Finding the client", record_figures: "Checking the figures against the books", record_notice: "Reading the notice", draft: "Drafting",
    make_file: "Making the file", point_to_screen: "Finding the right screen", web_search: "Searching the web", web_fetch: "Reading a page", record_citation: "Checking the case law", add_documents: "Adding documents", prefiling_check: "Checking the return before filing",
  };
  return (L[name] || name) + span;
}

// Words the user reads never name FinCom's tools ("Use find_ledgers to list the names", "ledger_balance"): a tool's name
// becomes plain words ("ledger balance"); the old SQL hint to use a tool is dropped (the answer gives buttons instead).
const TOOL_NAMES = () => [...ALL_BOOK_TOOLS.map((t) => t.name), ...OTHER_TOOLS.map((t: any) => String(t.name)), ...EXT_TOOLS.map((t) => t.name), "find_ledgers", "list_clients", "web_search", "web_fetch"];
export function plainWords(text: string): string {
  let t = String(text || "").replace(/\s*Use find_ledgers to list the names\.?/g, "");
  const names = Array.from(new Set(TOOL_NAMES().filter((n) => /_/.test(n)))).sort((a, b) => b.length - a.length);
  if (names.length) t = t.replace(new RegExp("`?\\b(" + names.join("|") + ")\\b`?", "g"), (_m, n: string) => n.replace(/_/g, " "));
  return t;
}
