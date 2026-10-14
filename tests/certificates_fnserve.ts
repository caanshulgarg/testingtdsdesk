// deno run -A tests/certificates_fnserve.ts PORT - the fincom-assistant function for the certificates' screen test
// (run_certificates_ui.py), against the Supabase stand-in at STAND_URL, with Claude MOCKED: for each question the call to
// certificate_prepare the model would make, then a reply that relays the tool's questions and flags line by line (as the
// tool tells the model to). Everything else is the real function and the real tool. Made-up clients only.
import { handler } from "../server/assistant/index.ts";

type Block = Record<string, unknown>;
const tool = (input: Record<string, unknown>): Block => ({ type: "tool_use", name: "certificate_prepare", input });
const base = { clients: ["Larkspur", "Birchwood Traders"], types: ["turnover", "net_worth"], years: ["2024-25", "2025-26"], last_years: null, as_on: "2026-03-31", basis: null, format: null, format_name: null,
  addressee: null, purpose: null, date: null, figures: null, use_books: null, answers: null, firm: null, confirm: null };
const firm = { firm_name: "Example & Associates", frn: "000000X", signatory: "A. Example", designation: "Partner", membership_no: "123456", place: "Faketown", letterhead_file: "letterhead.png", default_format: null, use_these: null };
const second = { ...base, firm, figures: [{ client: "Larkspur", year: "2024-25", item: "turnover", value: 1425000 }], use_books: [{ client: "Larkspur", year: "2025-26" }] };
const third = { ...second, firm: null, addressee: "The Branch Manager, Example Bank, Faketown", purpose: "renewal of the cash credit limit",
  answers: [{ client: "Larkspur", field: "address", value: "Plot 4, Fixture Lane, New Delhi" }, { client: "Birchwood Traders", field: "address", value: "12 Lantern Street, Faketown" }], confirm: true };
const SCRIPTS: [RegExp, Record<string, unknown>][] = [[/go ahead/i, third], [/FRN/, second], [/certificate/i, base]];
// the reply: the tool's QUESTIONS and FLAGS, a line each (what the system prompt and the tool's description ask of the model)
function relay(p: any): Block[] {
  const last = (p.messages as any[])[p.messages.length - 1];
  const res = String(((last.content || []) as any[]).find((b) => b.type === "tool_result")?.content || "");
  const lines = res.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  const made = /^Made:/.test(res);
  return [{ type: "text", text: made ? "The certificates are ready in the download pack below (Word and PDF for each client, and the summary Excel). The UDIN is left blank on every certificate: generate it on the UDIN portal and write it in. Nothing has been filed or sent." + (lines.length ? "\n\n" + lines.join("\n") : "")
    : (/QUESTIONS/.test(res) ? "Before I can prepare them:\n\n" : "No question left. Please check the figures in the tables below and tell me to go ahead.\n\n") + lines.join("\n") }];
}
let n = 0;
function claude() {
  return { beta: { messages: { stream: (p: any) => {
    if (/^You route a question/.test(String(p.system?.[0]?.text || ""))) { const msg = { content: [{ type: "text", text: "NONE" }], stop_reason: "end_turn", usage: { input_tokens: 2100, output_tokens: 10 } }; return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => msg }; }
    const q = String(((p.messages as any[]).filter((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b: any) => b.type === "text")).pop()?.content as any[] || []).map((b: any) => b.text || "").join(" "));
    const turns = (p.messages as any[]).filter((m) => m.role === "assistant" && Array.isArray(m.content)).length;
    const input = (SCRIPTS.find(([re]) => re.test(q)) || [null, base])[1];
    const content = (turns === 0 ? [tool(input)] : relay(p)).map((b, i) => b.type === "tool_use" ? { id: "toolu_" + (++n) + "_" + i, ...b } : b);
    const events: any[] = [];
    content.forEach((b: any, i) => { events.push({ type: "content_block_start", index: i, content_block: b.type === "text" ? { type: "text", text: "" } : b }); if (b.type === "text") for (const piece of String(b.text).match(/.{1,40}/gs) || []) events.push({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: piece } }); events.push({ type: "content_block_stop", index: i }); });
    const msg = { content, stop_reason: content.some((b: any) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 1500, output_tokens: 180 } };
    return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; }, finalMessage: async () => msg };
  } } } };
}
const h = handler({ env: (k) => ({ SUPABASE_URL: Deno.env.get("STAND_URL")!, SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key", ALLOWED_ORIGINS: "http://localhost:8179" } as Record<string, string>)[k],
  fetch: (...a) => fetch(...a), anthropic: () => claude() as never });
Deno.serve({ port: Number(Deno.args[0] || 9497), hostname: "127.0.0.1", onListen: () => console.log("listening") }, async (req) => {
  const u = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" } });
  const res = u.pathname.startsWith("/functions/v1/fincom-assistant") ? await h(req)
    : await fetch(Deno.env.get("STAND_URL")! + u.pathname + u.search, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : await req.arrayBuffer() });
  const headers = new Headers(res.headers); headers.set("Access-Control-Allow-Origin", "*"); headers.set("Access-Control-Allow-Headers", "*");
  return new Response(res.body, { status: res.status, headers });
});
