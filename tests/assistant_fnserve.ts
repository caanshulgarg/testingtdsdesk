// deno run -A tests/assistant_fnserve.ts PORT - the fincom-assistant function (server/assistant/index.ts) served for the
// screen test (run_assistant_ui.py), against the Supabase stand-in at STAND_URL, with Claude MOCKED: a fixed transcript for
// each question the test asks (chosen by words in the question). Everything else is the real function: the book tools'
// figures come from the stand-in database, the labels, the citation check, the figures' cross-check, masking and files.
import { handler } from "../server/assistant/index.ts";

type Block = Record<string, unknown>;
const tool = (name: string, input: Record<string, unknown>): Block => ({ type: "tool_use", name, input });
const text = (t: string, extra: Block = {}): Block => ({ type: "text", text: t, ...extra });
const SCRIPTS: [RegExp, (Block[] | ((p: any) => Block[]))[]][] = [
  [/194C/, [[tool("tds_missed", { from: null, to: null, section: "194C" })],
    [text("One supplier crossed the 194C limit with no TDS in the books: ₹40,000.00 of freight in February 2026. TDS of ₹400.00 is due, and 30% of the expense (₹12,000.00) is exposed to disallowance under section 40(a)(ia) until it is deducted and paid.")]]],
  [/Cash payments over 10,000/i, [[tool("entries_filter", { from: "2025-09-01", to: "2025-09-30", min_amount: 10000, max_amount: null, mode: "cash", direction: "payment", ledger: null, party: null, voucher_type: null, narration: null, limit: null })],
    [text("No cash payment over ₹10,000 in September 2025: the only cash paid in the year is ₹2,500.00 for printing, in February.")]]],
  [/Rukmini/, [[tool("daybook_slice", { from: "2026-03-01", to: "2026-03-31", ledger: null, party: "Rukmini", narration: null })],
    [tool("record_figures", { figures: [
      { name: "paid to Rukmini in March 2026", value: 60000, text: "₹60,000.00", tool: "entries_filter", input: { from: "2026-03-01", to: "2026-03-31", min_amount: null, max_amount: null, mode: "bank", direction: "payment", ledger: null, party: "Rukmini", voucher_type: null, narration: null, limit: null }, field: "summary.total" },
      { name: "reverse charge on March's rent", value: 4000, text: "₹4,000.00", tool: "rcm", input: { from: "2026-03-31", to: "2026-03-31" }, field: "summary.tax" }] })],
    [text("Rukmini Sethuraman was paid ₹60,000.00 on 31-Mar-2026 for the godown rent of January to March [V:77|2026-03-31]. March's rent carried reverse charge of ₹4,000.00 [V:76|2026-03-31], booked by journal. An advance was also paid [V:301|2026-03-14].")]]],
  [/rate on rent/i, [[
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "TDS rate rent company section 194-I section 393 Income-tax Act 2025" } },
    { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://incometaxindia.gov.in/Pages/tds-rates.aspx", title: "TDS rates - Income Tax Department", encrypted_content: "x" }] },
    text("For rent of land, building or furniture paid by a company: TDS at 10% where the rent is more than ₹50,000 in a month - section 194-I of the Income-tax Act, 1961 for payments up to 31-Mar-2026, and section 393(1) (Table, Sl. 2(ii)) of the Income-tax Act, 2025 from 1-Apr-2026. Plant and machinery: 2%.",
      { citations: [{ type: "web_search_result_location", url: "https://incometaxindia.gov.in/Pages/tds-rates.aspx", title: "TDS rates - Income Tax Department", cited_text: "10%", encrypted_index: "x" }] })]]],
  [/notice/i, [[tool("record_notice", { summary: "The officer says GSTR-3B for February 2026 took ₹11,000 of input tax but GSTR-2B shows ₹5,400, so ₹5,600 is excess and is to be explained.", law: "GST", form: "ASMT-10", kind: "gst_asmt10",
      notice_no: "ZD0711260123456", din: "ZD0711260123456", notice_date: "2026-10-20", section: "Section 61 of the CGST Act, 2017, read with rule 99", period: "February 2026 (FY 2025-26)", id_no: "07AAGCL4827M1Z3",
      amount: 5600, reply_by: "2026-11-15", asked: ["Explain the excess input tax credit of ₹5,600 for February 2026"], issues: [{ type: "itc_mismatch", point: "ITC in 3B more than in 2B", amount: 5600, period: "2026-02" }], months: ["2026-02"], fy: "2025-26" })],
    [{ type: "server_tool_use", id: "srvtoolu_f1", name: "web_fetch", input: { url: "https://indiankanoon.org/doc/123456789/" } },
     { type: "web_fetch_tool_result", tool_use_id: "srvtoolu_f1", content: { type: "web_fetch_result", url: "https://indiankanoon.org/doc/123456789/", content: { type: "document", title: "Shiv Shakti Traders v. Commissioner of Central Tax (made-up test page)",
       source: { type: "text", media_type: "text/plain", data: "Shiv Shakti Traders v. Commissioner of Central Tax. Delhi High Court (made-up test page), 12 March 2025. The credit of tax paid under reverse charge cannot be denied merely because it is not reflected in GSTR-2B." } } } },
     tool("record_citation", { citations: [{ n: 1, case_name: "Shiv Shakti Traders v. Commissioner of Central Tax", court: "Delhi High Court (made-up test page)", date: "12-Mar-2025", citation: "W.P.(C) 1234/2025", url: "https://indiankanoon.org/doc/123456789/",
       quote: "credit of tax paid under reverse charge cannot be denied merely because it is not reflected in GSTR-2B", point: "reverse-charge credit is never in 2B", authority: "high_court_jurisdictional", flags: [], act: "CGST Act 2017" }] })],
    [tool("draft", { title: "Reply to ASMT-10 (ref. ZD0711260123456) for February 2026", kind: "notice_reply", body: "To\nThe Proper Officer, Ward 7, Delhi\n\n# 1. Input tax credit of ₹11,000 against ₹5,400 in GSTR-2B\nThe input tax credit of ₹11,000 in table 4(A) of GSTR-3B for February 2026 has two parts: ₹5,400 on the invoice of Juniper Legal Associates (JLA/388), which is in GSTR-2B (Annexure 1, Annexure 3), and ₹5,600 of tax paid by us under reverse charge (Annexure 2): freight from Ashvattha Transport Co ₹2,000 under section 9(3) and godown rent from Rukmini Sethuraman ₹3,600 under section 9(4), taken in table 4(A)(3). Reverse-charge credit is never in GSTR-2B [C:1].\n# 2. The suppliers\nTheir accounts are at Annexure 4 and our payments to them at Annexure 5.\n\n[Authorised signatory]\n[Place, date]" })],
    [text("The difference is reverse-charge credit, which GSTR-2B never shows: February's ₹5,400 from registered suppliers agrees with 2B, and the other ₹5,600 is reverse charge on freight and rent. The DRAFT reply and the reply pack are ready; you must still attach the purchase invoices and the other documents listed. The reply is due by 15-Nov-2026.")]]],
  [/Excel/i, [[tool("make_file", { format: "xlsx", title: "TDS by deductee 2025-26", file_name: "tds-deductees-2025-26", sections: [{ heading: "TDS by deductee", text: null, table_tool: "tds_deductees", table_input_json: JSON.stringify({ from: "2025-04-01", to: "2026-03-31", section: null }) }] })],
    [text("The Excel of every deductee with their PAN is ready below.")]]],
  [/Post these/i, [[tool("point_to_screen", { screen: "post_to_tally", why: "Posting is done on Post to Tally, after you check each bill." })], [text("I can't post anything to Tally. Use Post to Tally on the client's Purchase page; I can list what is ready to post.")]]],
  [/check my Q4 26Q/i, [[tool("prefiling_check", { return: "26Q", fy: "2025-26", quarter: "Q4", month: null, gstin_state: null })], [text("Here is FinCom's checklist for 26Q, Q4 2025-26 (January to March 2026). Each line is FinCom's own check of the books.")]]],
  [/Top 10 customers/i, [[tool("top_parties", { side: "customers", measure: "turnover", from: "2025-04-01", to: "2026-03-31", limit: 10 })],
    [text("Six customers had sales in 2025-26, ₹15,50,000.00 in all; Quillfeather Weddings LLP is first with ₹9,00,000.00.")]]],
];
let n = 0;
function claude() {
  return { beta: { messages: { stream: (p: any) => {
    if (/^You route a question/.test(String(p.system?.[0]?.text || ""))) {
      const msg = { content: [text("NONE")], stop_reason: "end_turn", usage: { input_tokens: 2100, output_tokens: 10 } };
      return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => msg };
    }
    const q = String(((p.messages as any[]).filter((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b: any) => b.type === "text")).pop()?.content as any[] || []).map((b: any) => b.text || "").join(" "));
    const script = (SCRIPTS.find(([re]) => re.test(q)) || [null, [[text("I can help with the books, tax and notices.")]]])[1];
    const turns = (p.messages as any[]).filter((m) => m.role === "assistant" && Array.isArray(m.content)).length;   // this turn's (history is text)
    const step = script[turns] ?? [text("Done.")];
    const content = (typeof step === "function" ? step(p) : step).map((b, i) => b.type === "tool_use" ? { id: "toolu_" + (++n) + "_" + i, ...b } : b);
    const events: any[] = [];
    content.forEach((b, i) => {
      events.push({ type: "content_block_start", index: i, content_block: b.type === "text" ? { type: "text", text: "" } : b });
      if (b.type === "text") for (const piece of String(b.text).match(/.{1,24}/gs) || []) events.push({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: piece } });
      events.push({ type: "content_block_stop", index: i });
    });
    const msg = { content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 1500, output_tokens: 180 } };
    return { async *[Symbol.asyncIterator]() { for (const e of events) { await new Promise((r) => setTimeout(r, 15)); yield e; } }, finalMessage: async () => msg };
  } } } };
}
const h = handler({ env: (k) => ({ SUPABASE_URL: Deno.env.get("STAND_URL")!, SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key", ALLOWED_ORIGINS: "http://localhost:8178" } as Record<string, string>)[k],
  fetch: (...a) => fetch(...a), anthropic: () => claude() as never });
// one address for the page: /functions/v1/fincom-assistant is the function; anything else (rpc, tables, storage) goes on to
// the Supabase stand-in, with the browser's headers allowed
Deno.serve({ port: Number(Deno.args[0] || 9477), hostname: "127.0.0.1", onListen: () => console.log("listening") }, async (req) => {
  const u = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" } });
  const res = u.pathname.startsWith("/functions/v1/fincom-assistant") ? await h(req)
    : await fetch(Deno.env.get("STAND_URL")! + u.pathname + u.search, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : await req.arrayBuffer() });
  const headers = new Headers(res.headers); headers.set("Access-Control-Allow-Origin", "*"); headers.set("Access-Control-Allow-Headers", "*");
  return new Response(res.body, { status: res.status, headers });
});
