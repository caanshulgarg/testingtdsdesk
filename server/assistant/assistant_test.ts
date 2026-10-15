// deno test (run by tests/run_assistant_agent.py, which starts the stand: a throwaway PostgreSQL with migration 77 and the
// fixture books, and a Supabase stand-in in front of it at STAND_URL). The fincom-assistant function end to end, with Claude
// MOCKED: each test gives the fixed transcript of what Claude does (its tool calls and its text), and checks what FinCom
// does with it: the book tools' figures to the paisa, the labels, the citation check, the cross-check of the AI's figures
// (a mismatch row and one scrubbed Sentry event), files, the refusal to change anything, RLS, the cap and the log.
import { handler } from "./index.ts";
import { apiShape } from "./api_shape.ts";
import { BOOK_TOOLS, claudeTools, routerTools } from "./tools.ts";
import { cloudReporter } from "../_shared/sentry.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import ExcelJS from "npm:exceljs@4.4.0";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const STAND = Deno.env.get("STAND_URL") || "http://127.0.0.1:9476";
const ME = "aaaaaaaa-0000-4000-8000-000000000001", STAFF = "aaaaaaaa-0000-4000-8000-000000000002", STRANGER = "aaaaaaaa-0000-4000-8000-000000000004";
const FIRM = "11111111-1111-4111-8111-111111111111";
const CLIENT = "larkspur", OTHER_CLIENT = "zz-other-client";
function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

// ---- Claude, mocked: a script of model turns (Sonnet or Opus: the main step). Each turn is the content blocks the model
// "writes"; the stream yields text deltas as the API does, finalMessage() the whole message. The routing step (Haiku, and
// Sonnet when Haiku's choice fails the check) is answered by `router` and kept apart in routerCalls. A step may throw.
type Block = Record<string, unknown>;
type Step = Block[] | ((p: Record<string, unknown>, n: number) => Block[]);
const ROUTER = /^You route a question/;
const shapeRefusals: string[] = [];
class MockClaude {
  calls: Record<string, unknown>[] = [];
  routerCalls: Record<string, unknown>[] = [];
  usage: (n: number) => Record<string, unknown> = () => ({ input_tokens: 1200, output_tokens: 150 });
  constructor(public script: Step[], public router: (p: Record<string, unknown>, n: number) => Block[] = () => [text("NONE")]) {}
  beta = { messages: { stream: (p: Record<string, unknown>) => {
    // as the real API: a request outside the documented shape is refused with a 400 (FINCOM-CLOUD-STAGING-1/-2)
    const bad = apiShape(p as Record<string, any>);
    if (bad.length) { shapeRefusals.push(bad.join("; ")); throw Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: bad.join("; ") } }, undefined, new Headers()); }
    const isRouter = ROUTER.test(String(((p.system as any[]) || [])[0]?.text || ""));
    const list = isRouter ? this.routerCalls : this.calls;
    const n = list.length; list.push({ ...p, messages: [...(p.messages as unknown[])] });
    const step: Step = isRouter ? (q: Record<string, unknown>) => this.router(q, n) : (this.script[n] ?? [{ type: "text", text: "(no more script)" }]);
    const content = (typeof step === "function" ? step(p, n) : step).map((b, i) => b.type === "tool_use" ? { id: "toolu_" + (isRouter ? "r" : "") + n + "_" + i, ...b } : b);
    const events: Record<string, unknown>[] = [];
    content.forEach((b, i) => {
      events.push({ type: "content_block_start", index: i, content_block: b.type === "text" ? { type: "text", text: "" } : b });
      if (b.type === "text") for (const piece of String(b.text).match(/.{1,40}/gs) || []) events.push({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: piece } });
      events.push({ type: "content_block_stop", index: i });
    });
    const msg = { id: "msg_" + n, type: "message", role: "assistant", content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      usage: isRouter ? { input_tokens: 2100, output_tokens: 60 } : this.usage(n) };
    return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; }, finalMessage: async () => msg };
  } } };
}
const tool = (name: string, input: Record<string, unknown>): Block => ({ type: "tool_use", name, input });
const text = (t: string, extra: Block = {}): Block => ({ type: "text", text: t, ...extra });

// ---- Sentry, captured: the reporter as on staging, its posts kept
function sentryStand() {
  const sent: string[] = [], later: Promise<unknown>[] = [];
  const r = cloudReporter({ release: "fincom-assistant-1.0.0", env: (k) => ({ SUPABASE_URL: "https://qbocskaiewaxqcvaunzc.supabase.co" } as Record<string, string>)[k],
    fetch: (async (_u: string, init: RequestInit) => { sent.push(String(init.body)); return new Response("{}"); }) as unknown as typeof fetch, waitUntil: (p) => { later.push(p); } });
  return { r, sent, settle: () => Promise.all(later) };
}

async function ask(claude: MockClaude, body: Record<string, unknown>, uid = ME, sentry = sentryStand(), doFetch: typeof fetch = (...a) => fetch(...a)) {
  const h = handler({ env: (k) => ({ SUPABASE_URL: STAND, SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[k], fetch: doFetch,
    anthropic: () => claude as never, sentry: sentry.r, now: () => new Date("2026-10-13T10:00:00Z") });
  const res = await h(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer tok-" + uid, "Content-Type": "application/json", Origin: "https://staging.fincom.live" }, body: JSON.stringify({ action: "ask", ...body }) }));
  const raw = await res.text();
  const events = res.headers.get("content-type")?.startsWith("text/event-stream") ? raw.split("\n\n").filter((x) => x.startsWith("data: ")).map((x) => JSON.parse(x.slice(6))) : [];
  await sentry.settle();
  return { status: res.status, raw, events, done: events.find((e) => e.t === "done"), sentry };
}
const svc = async (path: string) => (await fetch(STAND + path, { headers: { Authorization: "Bearer service-key", apikey: "service-key" } })).json();
const ofType = (evs: any[], t: string) => evs.filter((e) => e.t === t);

Deno.test("the keyword router: common questions go to their book tool with no model call; figures from the database, to the paisa; green", async () => {
  const c = new MockClaude([]);
  const r = await ask(c, { question: "Which suppliers crossed 30,000 under 194C without TDS this year?", client_id: CLIENT });
  eq([c.calls.length, c.routerCalls.length], [0, 0], "no model called");
  const res = ofType(r.events, "result");
  eq(res.map((x) => x.tool), ["tds_missed"], "tds_missed");
  eq(res[0].rows.map((x: any) => [x.party, x.section, x.amount, x.tds, x.pan]), [["Ashvattha Transport Co", "194C", 40000, 400, "AGWPA1185G"]], "194C limit crossed");
  eq(res[0].summary.disallowance30pct, 12000, "30% disallowance");
  eq([r.done.labels, r.done.route], [["books"], "keyword"], "green, by the keyword router");
  assert(/Ashvattha|1 line/.test(r.done.text) && r.done.text.includes("₹"), "FinCom's own line from the summary: " + r.done.text);
  const r2 = await ask(c, { question: "Bank payments over 10,000 in September 2025", client_id: CLIENT });
  const p2 = ofType(r2.events, "result")[0];
  eq([p2.tool, p2.period.from, p2.period.to], ["payments_list", "2025-09-01", "2025-09-30"], "September 2025's bank payments");
  eq(p2.rows.filter((x: any) => x.amount > 10000).map((x: any) => [x.day, x.vno, x.amount]), [["2025-09-30", "31", 45000]], "the salary payment of 45,000");
  const r3 = await ask(c, { question: "Cash payments over 10,000 in September", client_id: CLIENT });
  const p3 = ofType(r3.events, "result")[0];
  eq([p3.tool, p3.filters.mode, p3.filters.direction, p3.filters.min, p3.period.from, p3.count], ["entries_filter", "cash", "payment", 10000, "2025-09-01", 0], "cash, payments, over 10,000, September of the books' year");
  eq(c.calls.length + c.routerCalls.length, 0, "still no model called");
});

Deno.test("no books in the cloud for the client: said plainly with the client's name and the next step; a neutral label, not the green tick; the Tally card; not cached", async () => {
  const c = new MockClaude([]);
  const q = "Which suppliers crossed 30,000 under 194C without TDS this year?";
  const r = await ask(c, { question: q, client_id: "mastercad" });
  eq([c.calls.length, c.routerCalls.length], [0, 0], "no model called");
  eq(r.done.labels, ["nodata"], "the neutral 'no entries' label only");
  assert(!r.done.labels.includes("books"), "never 'Checked against the books'");
  eq(r.done.text, "FinCom has no entries for Master Cad Infra Solutions yet. Link its Tally company or upload its Day Book.", "the words");
  eq(ofType(r.events, "result").length, 0, "no empty table card with the green tick");
  const card = ofType(r.events, "screen")[0];
  eq([card && card.screen, card && card.button], ["tally_sync", "Link Tally company"], "the Tally card with its button");
  const again = await ask(c, { question: q, client_id: "mastercad" });
  assert(!again.events[0].cached, "a 'no entries' answer is not kept in the answer cache (the books may arrive)");
});

Deno.test("a ledger named as people type it: found and named; several: 'Which one?' with buttons; a typo: the closest names; never a tool's name", async () => {
  const c = new MockClaude([]);
  for (const q of ["balance of air Ess exim", "Balance of Air-Ess Exim Pvt Ltd"]) {
    const r = await ask(c, { question: q, client_id: CLIENT });
    const res = ofType(r.events, "result");
    eq([res.length, res[0] && res[0].ledger], [1, "AIR ESS EXIM PRIVATE LIMITED"], q + ": the ledger's balance");
    assert(r.done.text.startsWith("Ledger used: AIR ESS EXIM PRIVATE LIMITED."), q + ": says which ledger: " + r.done.text);
    eq(r.done.labels, ["books"], q + ": green, from the books");
  }
  const amb = await ask(c, { question: "balance of mehta", client_id: CLIENT });
  eq(ofType(amb.events, "result").length, 0, "several: no table");
  const ch = ofType(amb.events, "choices")[0];
  assert(ch && ch.prompt === "Which one?" && ch.options.length === 2 && ch.options.length <= 5, "Which one? with the names: " + JSON.stringify(ch));
  eq(ch.options.map((o: any) => o.label).sort(), ["Mehta & Sons", "Mehta Traders LLP"], "the names");
  eq(ch.options.find((o: any) => o.label === "Mehta & Sons").q, "balance of Mehta & Sons", "each button asks again with the ledger's name");
  eq(amb.done.labels, ["notfound"], "a neutral label, not the green tick");
  const typo = await ask(c, { question: "balance of air ess exin", client_id: CLIENT });
  const sg = ofType(typo.events, "choices")[0];
  assert(sg && sg.options[0].label === "AIR ESS EXIM PRIVATE LIMITED" && sg.options.length <= 5, "a typo: the closest names: " + JSON.stringify(sg));
  assert(/no ledger called .air ess exin./i.test(typo.done.text), "says so plainly: " + typo.done.text);
  eq(typo.done.labels, ["notfound"], "a neutral label");
  for (const t of [amb.done.text, typo.done.text, sg.prompt]) assert(!/\b[a-z]+_[a-z_]+\b/.test(t) && !/find_ledgers|ledger_balance/.test(t), "no tool's name shown: " + t);
  eq([c.calls.length, c.routerCalls.length], [0, 0], "no model called");
});

Deno.test("Haiku routes what the keywords cannot: one book tool, at low effort, no tax reasoning; a bad choice is tried once with Sonnet", async () => {
  const c = new MockClaude([], () => [tool("entries_filter", { from: "2025-06-01", to: "2025-08-31", min_amount: 50000, max_amount: null, mode: "any", direction: "any", ledger: null, party: "Nightjar", voucher_type: null, narration: null, limit: null })]);
  const r = await ask(c, { question: "Nightjar entries above 50000 between June and August 2025", client_id: CLIENT });
  eq([c.routerCalls.length, c.calls.length, r.done.route], [1, 0, "haiku"], "Haiku only");
  const rp = c.routerCalls[0] as any;
  assert(rp.model === "claude-haiku-5-5" && rp.output_config.effort === "low" && !("fallbacks" in rp) && rp.max_tokens <= 1024, "Haiku at low effort, no fallback (Haiku has none): " + JSON.stringify({ m: rp.model, e: rp.output_config }));
  assert(rp.tools.length >= 30 && rp.tools.every((t: any) => !t.type) && !rp.tools.some((t: any) => ["daybook_slice", "draft", "record_notice", "make_file"].includes(t.name)), "only the book tools");
  eq(apiShape(rp), [], "Haiku's request is one the API accepts (strict only within its limits)");
  const res = ofType(r.events, "result")[0];
  eq([res.tool, res.filters.party, res.filters.min], ["entries_filter", "Nightjar Sound & Light Co", 50000], "the tool Haiku chose, run by FinCom (the party as the books name it)");
  assert(r.done.text.startsWith("Party used: Nightjar Sound & Light Co."), "says which party: " + r.done.text);
  eq(r.done.labels, ["books"], "green");
  // a choice that fails FinCom's check (a date that is not a date): once more with Sonnet, then answered
  const c2 = new MockClaude([], (p) => (p as any).model === "claude-haiku-5-5" ? [tool("cash_bank", { as_on: "2026-02-30" })] : [tool("cash_bank", { as_on: "2026-03-31" })]);
  const r2 = await ask(c2, { question: "Where do we stand on liquid funds at the end of March 2026", client_id: CLIENT });
  eq([c2.routerCalls.map((x: any) => x.model), r2.done.route], [["claude-haiku-5-5", "claude-sonnet-5-5"], "sonnet-route"], "Haiku, then Sonnet");
  eq(ofType(r2.events, "result")[0].summary.total, 231750, "cash and bank on 31-Mar-2026: 2,31,750.00");
});

Deno.test("fell through to the model: Sonnet for chat, cached frozen prefix, a request the API accepts, fallbacks on; two tools; logged as fell through", async () => {
  const c = new MockClaude([
    [tool("entries_filter", { from: "2025-09-01", to: "2025-09-30", min_amount: 10000, max_amount: null, mode: "bank", direction: "payment", ledger: null, party: null, voucher_type: null, narration: null, limit: null }),
     tool("tds_missed", { from: null, to: null, section: "194C" })],
    [text("Two things. One bank payment over ₹10,000 in September 2025: ₹45,000.00 of salaries (table below). And Ashvattha Transport Co crossed the 194C limit with ₹40,000.00 of freight and no TDS: ₹400.00 is due.")],
  ]);
  const q = "Large bank payments in September 2025, and anyone past a TDS threshold " + crypto.randomUUID().slice(0, 6);
  const r = await ask(c, { question: q, client_id: CLIENT });
  eq([c.routerCalls.length, c.calls.length], [0, 2], "two questions in one: not routed (no Haiku); the model");
  const res = ofType(r.events, "result");
  eq(res.map((x) => x.tool), ["entries_filter", "tds_missed"], "the two tools ran");
  eq(res[0].rows.map((x: any) => [x.day, x.vno, x.amount]), [["2025-09-30", "31", 45000]], "September's bank payment over 10,000");
  eq(r.done.labels, ["books"], "green: checked against the books");
  eq(r.done.unchecked, [], "every figure in the answer is in the tools' results");
  const p = c.calls[0] as any;
  assert(p.model === "claude-sonnet-5-5" && p.output_config.effort === "low" && p.thinking.type === "adaptive" && p.fallbacks === "default" && p.betas.includes("server-side-fallback-2026-07-01"), "Sonnet, low effort for a short answer (no detail asked), adaptive, fallbacks");
  assert(!("tool_choice" in p) || p.tool_choice?.type === "auto", "no forced tool choice");
  assert(p.tools.filter((t: any) => t.name && !t.type).every((t: any) => t.eager_input_streaming === true), "eager input streaming");
  eq(apiShape(p), [], "Sonnet's request is one the API accepts (strict only within its limits)");
  assert(!p.tools.some((t: any) => t.type), "a book question has no web tools");
  eq(p.system[0].cache_control, { type: "ephemeral", ttl: "1h" }, "the frozen system prompt cached for an hour");
  eq(p.cache_control, { type: "ephemeral" }, "the turn cached automatically");
  assert(/never post, change, delete or file/.test(p.system[0].text), "says it never changes anything");
  assert(!p.tools.some((t: any) => /post|delete|update|insert|write/i.test(t.name || "") && t.name !== "point_to_screen"), "no tool that writes");
  assert(p.max_tokens === 4000, "a short answer: max_tokens 4,000 (thinking included)");
  const lg = (await svc("/rest/v1/assistant_log?select=route,feature,fell_through,models,calls&question=eq." + encodeURIComponent(q)))[0];
  eq([lg.route, lg.feature, lg.fell_through, lg.models, lg.calls], ["model", "book", true, ["claude-sonnet-5-5"], 2], "the log: fell through, models, calls");
});

Deno.test("prompt caching: the prefix (tools and system prompt) is byte-identical between questions; cache reads counted", async () => {
  const c = new MockClaude([[text("A.")], [text("B.")]]);
  c.usage = (n) => n === 0 ? { input_tokens: 300, output_tokens: 20, cache_creation_input_tokens: 9000, cache_creation: { ephemeral_1h_input_tokens: 9000, ephemeral_5m_input_tokens: 0 } }
                           : { input_tokens: 320, output_tokens: 20, cache_read_input_tokens: 9000 };
  const q2 = "What is the threshold for tax audit for a company? " + crypto.randomUUID().slice(0, 6);
  await ask(c, { question: "What is the GST rate on event management services? " + crypto.randomUUID().slice(0, 6), client_id: null });
  await ask(c, { question: q2, client_id: null });
  const [a, b] = c.calls as any[];
  eq(JSON.stringify([a.tools, a.system]), JSON.stringify([b.tools, b.system]), "same tools and system prompt, byte for byte");
  const lg = (await svc("/rest/v1/assistant_log?select=cache_read,cache_write&question=eq." + encodeURIComponent(q2)))[0];
  assert(lg.cache_read > 0, "the second question read the cache: " + JSON.stringify(lg));
  const tools = a.tools as any[];
  const ws = tools.find((t) => t.type === "web_search_20260209"), wf = tools.find((t) => t.type === "web_fetch_20260209");
  assert(ws && ws.max_uses === 3 && wf && ws.blocked_domains.includes("taxmann.com") && ws.blocked_domains.includes("scconline.com") && ws.blocked_domains.includes("manupatra.com"), "web search at most 3, paid databases blocked");
});

Deno.test("fallback: the Day Book slice, amber; citations checked (a made-up voucher dropped); figures recorded and cross-checked", async () => {
  const c = new MockClaude([
    [tool("daybook_slice", { from: "2026-03-01", to: "2026-03-31", ledger: null, party: "Rukmini", narration: null })],
    [tool("record_figures", { figures: [
      { name: "godown rent paid to Rukmini in March 2026", value: 60000, text: "₹60,000.00", tool: "entries_filter", input_json: JSON.stringify({ from: "2026-03-01", to: "2026-03-31", min_amount: null, max_amount: null, mode: "bank", direction: "payment", ledger: null, party: "Rukmini", voucher_type: null, narration: null, limit: null }), field: "summary.total" },
      { name: "reverse charge on the rent in March 2026", value: 4000, text: "₹4,000.00", tool: "rcm", input_json: JSON.stringify({ from: "2026-03-31", to: "2026-03-31" }), field: "summary.tax" },
    ] })],
    [text("Rukmini Sethuraman was paid ₹60,000.00 on 31-Mar-2026 [V:77|2026-03-31] for January to March; March's reverse charge was ₹4,000.00 [V:76|2026-03-31]. A refund was also made [V:999|2026-03-15].")],
  ]);
  const s = sentryStand();
  const r = await ask(c, { question: "What did we pay Rukmini in March and what was the reverse charge?", client_id: CLIENT }, ME, s);
  eq(r.done.labels, ["ai"], "amber: an AI answer from the Day Book");
  const sl = ofType(r.events, "slice")[0];
  eq(sl.count, 2, "the slice: Rukmini's two March entries");
  const sent = JSON.parse(((c.calls[1] as any).messages.at(-1).content[0]).content);
  assert(sent.entries.every((e: any) => Object.keys(e).sort().join() === "date,lines,narration,no,party,type"), "the slice sent with only the columns needed");
  eq(r.done.citations.ok.map((x: any) => x.no), ["77", "76"], "the two real entries cited");
  eq(r.done.citations.dropped, [{ no: "999", date: "2026-03-15" }], "the made-up voucher is dropped");
  assert(!r.done.text.includes("999"), "and is not in the answer");
  const v = r.done.verdicts;
  eq(v.map((x: any) => [x.status, x.ai, x.fincom]), [["match", 60000, 60000], ["mismatch", 4000, 3600]], "60,000 matches; 4,000 is FinCom's 3,600");
  assert(r.done.text.includes("⟦F1⟧") && r.done.text.includes("⟦F2⟧"), "both figures marked in the answer for the panel");
  const rows = await svc("/rest/v1/assistant_mismatches?select=kind,figure,figure_key,ai_value,fincom_value,tool,entry_ids,question&kind=eq.auto");
  const m = rows.find((x: any) => x.figure === "reverse charge on the rent in March 2026");
  assert(m && Number(m.ai_value) === 4000 && Number(m.fincom_value) === 3600 && m.tool === "rcm" && m.figure_key === "rcm.summary.tax" && m.entry_ids.length === 1, "a mismatch row: " + JSON.stringify(m));
  eq(rows.filter((x: any) => x.figure === "godown rent paid to Rukmini in March 2026").length, 0, "no row for the figure that matches");
  // exactly one Sentry event, scrubbed: no amounts, names or words of the question
  eq(s.sent.length, 1, "one Sentry event");
  const ev = JSON.parse(s.sent[0].split("\n")[2]);
  eq(ev.message, "Assistant mismatch: rcm.summary.tax", "title");
  eq(ev.fingerprint, ["assistant-mismatch", "rcm.summary.tax", "rcm"], "grouped by figure and tool");
  eq([ev.tags.kind, ev.tags.tool], ["assistant-mismatch", "rcm"], "tags");
  assert(/^[0-9a-f]{12}$/.test(ev.tags.firm_id) && /^[0-9a-f]{12}$/.test(ev.tags.client_id), "firm and client as hashes");
  eq(Object.keys(ev.extra).sort(), ["entry_ids", "mismatch_id"], "extra: the row's id and the entries' ids only");
  const all = s.sent[0];
  for (const bad of ["4000", "3600", "4,000", "3,600", "Rukmini", "larkspur", FIRM, "reverse charge", "godown"]) assert(!all.includes(bad), "no '" + bad + "' in the Sentry event");
});

Deno.test("a matching total is green: 'matches FinCom'; nothing recorded", async () => {
  const before = (await svc("/rest/v1/assistant_mismatches?select=id")).length;
  const c = new MockClaude([
    [tool("record_figures", { figures: [{ name: "TDS deducted in 2025-26", value: 20000, text: "₹20,000.00", tool: "tds_summary", input_json: "{\"from\": \"2025-04-01\", \"to\": \"2026-03-31\"}", field: "summary.deducted" }] })],
    [text("TDS deducted in 2025-26 was ₹20,000.00.")],
  ]);
  const r = await ask(c, { question: "What was the total tax deducted at source by us over the last financial year?", client_id: CLIENT });
  eq(r.done.verdicts.map((x: any) => x.status), ["match"], "matches");
  eq(r.done.unchecked, [], "nothing unchecked");
  eq((await svc("/rest/v1/assistant_mismatches?select=id")).length, before, "no mismatch row");
});

Deno.test("general guidance: web search links shown, blue label", async () => {
  const c = new MockClaude([[
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "TDS rate rent company section 393 Income-tax Act 2025" } },
    { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://incometaxindia.gov.in/Pages/tds-rates.aspx", title: "TDS rates", encrypted_content: "x" }] },
    text("TDS on rent of land or building paid by a company is 10% (section 194-I of the 1961 Act; section 393 of the Income-tax Act, 2025 from 1-Apr-2026).", { citations: [{ type: "web_search_result_location", url: "https://incometaxindia.gov.in/Pages/tds-rates.aspx", title: "TDS rates", cited_text: "10%", encrypted_index: "x" }] }),
  ]]);
  const r = await ask(c, { question: "TDS rate on rent for a company?", client_id: null });
  eq(r.done.labels, ["general"], "blue: general guidance");
  eq(r.done.links, [{ url: "https://incometaxindia.gov.in/Pages/tds-rates.aspx", title: "TDS rates" }], "the link used");
});

Deno.test("a request to post or delete: refused, with the screen that does it; no tool changes anything", async () => {
  const c = new MockClaude([[tool("point_to_screen", { screen: "post_to_tally", why: "Posting is done there, after you check each bill." })], [text("I can't post anything to Tally. Use Post to Tally on the client's Purchase page.")]]);
  const r = await ask(c, { question: "Post these bills to Tally now", client_id: CLIENT });
  const sc = ofType(r.events, "screen");
  assert(sc.length >= 1 && sc.every((x) => x.screen === "post_to_tally"), "the screen is named: " + JSON.stringify(sc));
  const c2 = new MockClaude([[text("I can't delete entries; delete it in Tally and FinCom follows.")]]);
  const r2 = await ask(c2, { question: "Delete the duplicate entry NSL/112 for me", client_id: CLIENT });
  eq(ofType(r2.events, "screen").map((x) => x.screen), ["tally_sync"], "a delete goes to Tally");
});

Deno.test("files: an Excel whose cells are the tool's figures to the paisa (totals as formulas), a Word letter and a PDF that open", async () => {
  const c = new MockClaude([
    [tool("make_file", { format: "xlsx", title: "TDS by deductee 2025-26", file_name: "tds-deductees", sections: [{ heading: "TDS by deductee", text: null, table: { tool: "tds_deductees", input: { from: "2025-04-01", to: "2026-03-31", section: null } } }] }),
     tool("make_file", { format: "docx", title: "Balance confirmation letter", file_name: null, sections: [{ heading: null, text: "Dear Sir,\nPlease confirm the balance below.", table: { tool: "ledger_balance", input: { ledger: "Nightjar", as_on: "2026-03-31" } } }] }),
     tool("make_file", { format: "pdf", title: "Cash and bank on 31-Mar-2026", file_name: null, sections: [{ heading: null, text: null, table: { tool: "cash_bank", input: { as_on: "2026-03-31" } } }] })],
    [text("The three files are ready.")],
  ]);
  const r = await ask(c, { question: "Excel of all deductees with PAN, a confirmation letter to Nightjar, and a PDF of cash and bank", client_id: CLIENT, firm: { name: "Garg Shekhar & Company", lines: ["Chartered Accountants, New Delhi"] } });
  const files = ofType(r.events, "file");
  eq(files.map((f) => f.kind), ["xlsx", "docx", "pdf"], "three files");
  const get = async (p: string) => new Uint8Array(await (await fetch(STAND + "/storage/v1/object/authenticated/assistant-files/" + p, { headers: { Authorization: "Bearer tok-" + ME } })).arrayBuffer());
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await get(files[0].path)) as any);
  const ws = wb.worksheets[0];
  const head = (ws.getRow(4).values as unknown[]).slice(1);
  eq(head, ["Deductee", "PAN", "Section", "TDS ledger", "Amount paid or credited", "TDS", "Entries"], "header row");
  const res = ofType(r.events, "result");   // none: make_file ran the tool itself
  eq(res.length, 0, "make_file ran the tool itself");
  const rows: unknown[][] = []; for (let i = 5; i <= 8; i++) rows.push((ws.getRow(i).values as unknown[]).slice(1));
  eq(rows.map((x) => [x[0], x[1], x[4], x[5]]), [["Hemant Zaverchand (Loan)", "AFRPZ6610B", 20000, 2000], ["Nightjar Sound & Light Co", "AAKFN4416E", 350000, 7000], ["Peregrine Tent Works", "ACBPP3390L", 200000, 2000], ["Juniper Legal Associates", "AAHFJ6012N", 90000, 9000]], "cells to the paisa, numbers as numbers");
  const tot = ws.getRow(9);
  assert((tot.getCell(5).value as any).formula === "SUM(E5:E8)" && (tot.getCell(6).value as any).formula === "SUM(F5:F8)" && (tot.getCell(6).value as any).result === 20000, "totals as formulas");
  assert(String(ws.getColumn(5).numFmt).includes("₹") && (ws.views[0] as any).state === "frozen" && (ws.views[0] as any).ySplit === 4, "₹ format and frozen header");
  assert(String((ws.getRow(11).values as unknown[])[1]).startsWith("Figures from FinCom's books as of"), "the source footer");
  const docx = await get(files[1].path);
  assert(docx[0] === 0x50 && docx[1] === 0x4b, "the Word file is a zip (docx)");
  const pdf = await PDFDocument.load(await get(files[2].path));
  assert(pdf.getPageCount() >= 1, "the PDF opens");
  const list = await svc("/rest/v1/assistant_files?select=name,kind,client_id&firm_id=eq." + FIRM);
  assert(list.some((f: any) => f.kind === "xlsx" && f.name === "tds-deductees.xlsx"), "the file is listed for 30 days");
  // another firm's member cannot read it
  const other = await fetch(STAND + "/storage/v1/object/authenticated/assistant-files/" + files[0].path, { headers: { Authorization: "Bearer tok-" + STRANGER } });
  await other.body?.cancel();
  assert(other.status >= 400, "private to the firm");
});

async function storeNotice(file: string, name: string) {
  const pdf = await Deno.readFile(new URL("../../tests/fixtures/assistant/" + file, import.meta.url));
  const up = await fetch(STAND + "/storage/v1/object/assistant-files/" + FIRM + "/larkspur/notices/" + name, { method: "POST", headers: { Authorization: "Bearer tok-" + STAFF, "Content-Type": "application/pdf" }, body: pdf });
  await up.text();
  eq(up.status, 200, "the notice is stored by the firm's staff");
  return pdf;
}
async function unzip(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  const { unzipSync } = await import("npm:fflate@0.8.2");
  return unzipSync(bytes);
}
const getFile = async (p: string) => new Uint8Array(await (await fetch(STAND + "/storage/v1/object/authenticated/assistant-files/" + p, { headers: { Authorization: "Bearer tok-" + ME } })).arrayBuffer());
async function sheetRows(bytes: Uint8Array, sheet = 0): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes as any);
  const ws = wb.worksheets[sheet]; const out: unknown[][] = [];
  ws.eachRow((row) => out.push((row.values as unknown[]).slice(1).map((v: any) => v && typeof v === "object" && "result" in v ? v.result : v)));
  return out;
}

Deno.test("a notice (ASMT-10, ITC mismatch): Opus at high effort; fields; the checklist; annexures from the book tools to the paisa; a DRAFT with the reference block; the reply pack opens and its numbering matches", async () => {
  const pdf = await storeNotice("asmt10-notice.pdf", "n1-asmt10.pdf");
  const exp = JSON.parse(await Deno.readTextFile(new URL("../../tests/fixtures/assistant/notice-expected.json", import.meta.url)));
  const body = "To\nThe Proper Officer, Ward 7, Delhi\n\n# 1. Input tax credit of Rs 11,000 against Rs 5,400 in GSTR-2B\nThe credit in table 4(A) of GSTR-3B for February 2026 is Rs 11,000: Rs 5,400 on the invoices of registered suppliers, which agrees with GSTR-2B (Annexure 1, Annexure 3), and Rs 5,600 of tax paid by us under reverse charge (Annexure 2), taken in table 4(A)(3). Reverse-charge credit is never shown in GSTR-2B.\n# 2. The suppliers\nTheir accounts are at Annexure 4 and our payments to them at Annexure 5.\n\n[Authorised signatory]";
  const c = new MockClaude([
    [tool("record_notice", { summary: "The officer says GSTR-3B for February 2026 took Rs 11,000 of input tax but GSTR-2B shows Rs 5,400, so Rs 5,600 is excess.", law: "GST", form: "ASMT-10", kind: "gst_asmt10",
      notice_no: "ZD0711260123456", din: "ZD0711260123456", notice_date: "2026-10-20", section: "Section 61 of the CGST Act, 2017; rule 99", period: "February 2026 (FY 2025-26)", id_no: "07AAGCL4827M1Z3",
      amount: 5600, reply_by: "2026-11-15", asked: ["Explain the excess ITC of Rs 5,600"], issues: [{ type: "itc_mismatch", point: "ITC in 3B more than in 2B", amount: 5600, period: "2026-02" }], months: ["2026-02"], fy: "2025-26" })],
    [tool("draft", { title: "Reply to ASMT-10 for February 2026", kind: "notice_reply", body: "The credit of Rs 5,600 is reverse-charge tax (Annexure 2, Annexure 7)." })],
    [tool("draft", { title: "Reply to ASMT-10 for February 2026", kind: "notice_reply", body })],
    [text("The difference is reverse-charge credit, which 2B never shows. A draft reply and the reply pack are ready; you must still add the purchase invoices and the other documents listed.")],
  ]);
  const r = await ask(c, { question: "Read this notice and prepare the reply", client_id: CLIENT, attachments: [{ path: FIRM + "/larkspur/notices/n1-asmt10.pdf", name: "asmt10.pdf", type: "application/pdf" }] });
  const p0 = c.calls[0] as any;
  assert(p0.model === "claude-opus-5-5" && p0.output_config.effort === "high" && p0.max_tokens >= 16000 && p0.fallbacks === "default", "Opus at high effort for a notice");
  assert(p0.tools.some((t: any) => t.name === "record_notice") && p0.tools.some((t: any) => t.type === "web_fetch_20260209") && p0.tools.some((t: any) => t.name === "record_citation"), "notice tools, web fetch, citations");
  eq(c.routerCalls.length, 0, "no routing step for a notice");
  const first = p0.messages.at(-1).content;
  assert(first[0].type === "document" && first[0].source.media_type === "application/pdf" && first[0].source.data === btoa(Array.from(pdf, (b) => String.fromCharCode(b)).join("")), "the notice went as a PDF document");
  const nev = ofType(r.events, "notice")[0];
  eq([nev.fields.form, nev.fields.amount, nev.fields.reply_by, nev.fields.months], [exp.form, exp.amount, exp.reply_by, exp.periods], "the notice's fields");
  const items = nev.checklist as any[];
  const st = Object.fromEntries(items.map((i) => [i.id, [i.status, i.annex ?? null]]));
  eq(st, { itc_recon: ["ready", 1], rcm_details: ["ready", 2], purchase_register: ["ready", 3], ledger_extracts: ["ready", 4], payment_proofs: ["ready", 5],
    invoices: ["attach", null], gstr3b_copy: ["attach", null], gstr2b_copy: ["attach", null], credit_ledger: ["attach", null], rcm_proof: ["attach", null], eway: ["attach", null] }, "the checklist: ready from FinCom, you must attach");
  // the annexures' figures are the tools' figures
  const an = nev.annexures as any[];
  eq(an.map((a) => [a.n, a.title]), [[1, "Input tax reconciliation: books, GSTR-2B and GSTR-3B"], [2, "Reverse-charge supplies and tax"], [3, "Party-wise purchase register"], [4, "Ledger extracts of the parties in question"], [5, "Payments to the suppliers in question (with UTR or cheque where recorded)"]], "Annexure 1..5");
  const s3 = an[0].tables[0].summary;
  eq([s3.books, s3.twob, s3.b3all, s3.b3rcm, s3.excess], [exp.check.books, exp.check.twob, 11000, exp.check.rcm_credit, 5600], "Annexure 1: books 5,400 = 2B 5,400; 3B 11,000 of which reverse charge 5,600");
  eq([an[1].tables[0].summary.tax, an[2].tables[0].summary.tax, an[2].tables[0].summary.count], [5600, 11000, 3], "Annexure 2: reverse charge 5,600; Annexure 3: 3 bills, input tax 11,000");
  eq(an[3].tables.map((t: any) => t.title.split(",")[0]), ["Ashvattha Transport Co", "Rukmini Sethuraman"], "Annexure 4: the reverse-charge suppliers' accounts");
  // the first draft cited Annexure 7 (there is none) and left some out: refused, then right
  const tr = (c.calls[2] as any).messages.at(-1).content[0];
  assert(tr.is_error && /Not an annexure: 7/.test(tr.content) && /Not cited: 1, 3, 4, 5/.test(tr.content), "a reply citing a missing annexure is sent back: " + tr.content);
  const d = ofType(r.events, "draft");
  eq(d.length, 1, "one DRAFT shown");
  // the reply pack
  const f = ofType(r.events, "file").find((x) => x.pack);
  assert(f && f.kind === "zip", "the reply pack");
  const z = await unzip(await getFile(f.path));
  const names = Object.keys(z).sort();
  eq(names, ["00-Index.xlsx", "01-Reply-DRAFT.docx", "01-Reply-DRAFT.pdf", "Annexure-1-Input-tax-reconciliation-books-GSTR-2B-and-GSTR-3B.xlsx", "Annexure-2-Reverse-charge-supplies-and-tax.xlsx",
    "Annexure-3-Party-wise-purchase-register.xlsx", "Annexure-4-Ledger-extracts-of-the-parties-in-question.xlsx", "Annexure-5-Payments-to-the-suppliers-in-question-with-UTR-or.xlsx", "README.txt"], "the files");
  const cited = Array.from(new Set(Array.from(body.matchAll(/Annexure (\d)/g), (m) => Number(m[1])))).sort();
  eq(cited, names.filter((n) => n.startsWith("Annexure-")).map((n) => Number(n.split("-")[1])).sort(), "the reply's annexure numbers are the files' numbers");
  const a1 = await sheetRows(z[names[3]]);
  const hdr = a1.findIndex((row) => row[0] === "Month");
  eq(a1[hdr + 1].slice(0, 9), ["Feb-2026", 5400, 5400, 5400, 5600, 5600, 11000, 5600, "3B is more than 2B by the reverse-charge credit only (not shown in 2B)"], "Annexure 1's cells to the paisa");
  const idx = await sheetRows(z["00-Index.xlsx"], 1);
  assert(idx.some((row) => row[0] === "Purchase invoices of the suppliers in question"), "the index lists what the user must still add");
  const docx = z["01-Reply-DRAFT.docx"];
  const { unzipSync, strFromU8 } = await import("npm:fflate@0.8.2");
  const xml = strFromU8(unzipSync(docx)["word/document.xml"]);
  for (const want of ["DRAFT", "Notice no.: ZD0711260123456", "Notice date: 2026-10-20", "Section 61", "GSTIN: 07AAGCL4827M1Z3", "Annexure 5"]) assert(xml.includes(want), "the Word reply has " + want);
  assert((await PDFDocument.load(z["01-Reply-DRAFT.pdf"])).getPageCount() >= 1, "the PDF reply opens");
  // tracked for the client: drafted, the checklist, the pack
  const nrow = (await svc("/rest/v1/assistant_notices?select=status,form,due,checklist,annexures,pack_path,din&id=eq." + nev.id))[0];
  eq([nrow.status, nrow.form, nrow.due, nrow.din, nrow.annexures.length, nrow.pack_path === f.path], ["drafted", "ASMT-10", "2026-11-15", "ZD0711260123456", 5, true], "the notice record");
  eq(r.done.labels, ["books", "notice"], "labels");
  // a notice from another firm's folder is refused
  const bad = await ask(new MockClaude([]), { question: "read it", client_id: CLIENT, attachments: [{ path: "22222222-2222-4222-8222-222222222222/x/notices/a.pdf", name: "a.pdf", type: "application/pdf" }] });
  eq(bad.status, 403, "another firm's file is refused");
});

Deno.test("a notice (143(1)(a), TDS credit): 26AS against the books and the TDS receivable account as annexures; Form 16A and the ITR to attach", async () => {
  await storeNotice("it-143-1a-notice.pdf", "n2-143.pdf");
  const exp = JSON.parse(await Deno.readTextFile(new URL("../../tests/fixtures/assistant/notice-143-expected.json", import.meta.url)));
  const c = new MockClaude([
    [tool("record_notice", { summary: "CPC proposes to allow TDS credit of Rs 13,000 against Rs 15,000 claimed for AY 2026-27.", law: "Income tax", form: "143(1)(a)", kind: "it_143_1a",
      notice_no: exp.reference, din: exp.din, notice_date: exp.notice_date, section: "Section 143(1)(a) of the Income-tax Act, 1961", period: "AY 2026-27", id_no: exp.pan,
      amount: 2000, reply_by: exp.reply_by, asked: ["Agree or disagree with the proposed adjustment of TDS credit"], issues: [{ type: "tds_credit", point: "TDS credit claimed more than 26AS", amount: 2000, period: "2025-26" }], months: [], fy: "2025-26" })],
    [tool("draft", { title: "Response to the proposed adjustment u/s 143(1)(a), AY 2026-27", kind: "notice_reply", body: "We disagree in part. Of the Rs 15,000 claimed, Rs 13,000 is in Form 26AS (Annexure 1). The Rs 2,000 was deducted by Vellichor Learning Foundation on 10-Nov-2025 (Annexure 2), who has not yet filed its TDS statement; we have asked them to. [Authorised signatory]" })],
    [text("The 2,000 is Vellichor's TDS, not in your 26AS yet. The response and the pack are ready; attach Form 16A from Vellichor and the ITR computation.")],
  ]);
  const r = await ask(c, { question: "We got this intimation, prepare the response", client_id: CLIENT, attachments: [{ path: FIRM + "/larkspur/notices/n2-143.pdf", name: "143.pdf", type: "application/pdf" }] });
  const nev = ofType(r.events, "notice")[0];
  const st = Object.fromEntries((nev.checklist as any[]).map((i) => [i.id, [i.status, i.annex ?? null]]));
  eq(st, { tds_26as: ["ready", 1], tds_receivable: ["ready", 2], form16a: ["attach", null], itr: ["attach", null], ais: ["attach", null], confirmations: ["attach", null] }, "the checklist for a TDS-credit adjustment");
  const a1 = nev.annexures[0].tables[0].summary, a2 = nev.annexures[1];
  eq([a1.books, a1.in26as, a1.diff], [exp.check.books, exp.check.in26as, exp.check.diff], "Annexure 1: books 15,000, 26AS 13,000");
  eq(a2.tables[0].rows, 3, "Annexure 2: the three TDS credits in the books");
  const f = ofType(r.events, "file").find((x) => x.pack);
  const z = await unzip(await getFile(f.path));
  const rows = await sheetRows(z[Object.keys(z).find((n) => n.startsWith("Annexure-1-"))!]);
  const v = rows.find((x) => x[2] === exp.check.missing_party);
  eq(v && [v[3] ?? 0, v[4], v[5]], [0, 2000, -2000], "Vellichor: 2,000 in the books, nothing in 26AS");
  eq(Object.keys(z).filter((n) => n.startsWith("Annexure-")).length, 2, "two annexures, as the reply cites");
});

Deno.test("case law: only from a page read in this answer, with the name and the line on it; otherwise 'No verified case found for this point'", async () => {
  const page = "<html><body><h1>Shiv Shakti Traders v. Commissioner of Central Tax</h1><p>Delhi High Court, 12 March 2025, W.P.(C) 1234/2025.</p><p>The credit of tax paid under reverse charge cannot be denied merely because it is not reflected in GSTR-2B, as such supplies are never reported by the supplier.</p></body></html>";
  const url = "https://indiankanoon.org/doc/123456789/";
  const fetchBlock = (u: string, html: string) => ({ type: "web_fetch_tool_result", tool_use_id: "srvtoolu_f1", content: { type: "web_fetch_result", url: u, retrieved_at: "2026-10-13T10:00:00Z",
    content: { type: "document", title: "Shiv Shakti Traders", source: { type: "text", media_type: "text/plain", data: html } } } });
  const c = new MockClaude([
    [{ type: "server_tool_use", id: "srvtoolu_f1", name: "web_fetch", input: { url } }, fetchBlock(url, page),
     tool("record_citation", { citations: [
       { n: 1, case_name: "Shiv Shakti Traders v. Commissioner of Central Tax", court: "Delhi High Court", date: "12-Mar-2025", citation: "W.P.(C) 1234/2025", url, quote: "credit of tax paid under reverse charge cannot be denied merely because it is not reflected in GSTR-2B", point: "RCM credit not in 2B", authority: "high_court_jurisdictional", flags: [], act: "CGST Act 2017" },
       { n: 2, case_name: "Shiv Shakti Traders v. Commissioner of Central Tax", court: "Delhi High Court", date: "12-Mar-2025", citation: "W.P.(C) 1234/2025", url, quote: "the officer must always allow credit within seven days of any request made", point: "a quote not on the page", authority: "high_court_jurisdictional", flags: [], act: "CGST Act 2017" },
       { n: 3, case_name: "Imaginary Exports Ltd v. Union of India", court: "Supreme Court", date: "2024", citation: "(2024) 1 SCC 1", url: "https://indiankanoon.org/doc/999/", quote: "a case the model remembers but never read anywhere in this answer", point: "invented", authority: "supreme_court", flags: [], act: "CGST Act 2017" }] })],
    [text("Reverse-charge credit is not in 2B by design [C:1]. On the time limit, [C:2]. The Supreme Court settled it too [C:3]. See also Phantom Traders v. State of Delhi (2023), which held the same.")],
  ]);
  const r = await ask(c, { question: "Is RCM credit allowed when it is not in GSTR-2B? Give case law.", client_id: null });
  const cs = ofType(r.events, "cases")[0].cases;
  eq(cs.map((x: any) => [x.n, x.ok]), [[1, true], [2, false], [3, false]], "verified: the first only");
  eq([cs[0].url, cs[0].label], [url, "Verify before filing"], "shown with its link and the label");
  assert(cs[0].quote.startsWith("credit of tax paid"), "and the line quoted");
  eq([cs[1].why, cs[2].why], ["the line quoted is not on the page", "not found or read in this answer"], "why the others were dropped");
  const t = r.done.text;
  assert(t.includes("Shiv Shakti Traders v. Commissioner of Central Tax (Delhi High Court, W.P.(C) 1234/2025, 12-Mar-2025) - " + url), "the verified case in the answer: " + t);
  eq((t.match(/No verified case found for this point\./g) || []).length, 2, "the two others: no verified case");
  assert(!t.includes("Imaginary Exports") && !t.includes("Phantom Traders") && t.includes("[case removed: not verified]"), "no invented case shown, not even one written in the text");
});

Deno.test("the rupee cap: at 80% a warning; at 100% no AI call, but answers from FinCom's tools and checks keep working", async () => {
  const today = new Date("2026-10-13T10:00:00Z").toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const realDay = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const day = realDay || today;
  const setSpent = async (inr: number) => {
    const r = await fetch(STAND + "/rest/v1/assistant_usage?firm_id=eq." + FIRM + "&day=eq." + day, { method: "PATCH", headers: { Authorization: "Bearer service-key", "Content-Type": "application/json" }, body: JSON.stringify({ cost_inr: inr }) });
    await r.body?.cancel();
  };
  await setSpent(125);
  const c = new MockClaude([[text("A rate question, answered.")]]);
  c.usage = () => ({ input_tokens: 1000, output_tokens: 100 });
  const r = await ask(c, { question: "What is the due date of GSTR-9 for 2025-26? " + crypto.randomUUID().slice(0, 6), client_id: null });
  const w = ofType(r.events, "warn");
  eq([w.length, w[0]?.kind], [1, "cap80"], "the 80% warning");
  await setSpent(150);
  const c2 = new MockClaude([[text("should not be called")]]);
  const r2 = await ask(c2, { question: "What is the due date of GSTR-1 for October? " + crypto.randomUUID().slice(0, 6), client_id: null });
  eq([c2.calls.length, ofType(r2.events, "error")[0]?.kind], [0, "cap"], "at the cap: no AI call, the cap message");
  assert(/₹150/.test(ofType(r2.events, "error")[0].message), "in rupees: " + ofType(r2.events, "error")[0].message);
  const r3 = await ask(c2, { question: "Cash and bank balances on 31 March 2026", client_id: CLIENT });
  eq([ofType(r3.events, "result")[0]?.summary.total, r3.done.labels], [231750, ["books"]], "a keyword answer still works at the cap");
  const r4 = await ask(c2, { question: "check my Q4 26Q", client_id: CLIENT });
  eq(ofType(r4.events, "prefile").length, 1, "and the check before filing");
  await setSpent(0);
});

Deno.test("the answer cache: the same question on the same books is answered again at no cost; a change to the books asks again", async () => {
  const q = "What did we spend on staff welfare compared to last year " + crypto.randomUUID().slice(0, 6);
  const c = new MockClaude([[tool("expenses", { from: "2025-04-01", to: "2026-03-31", limit: null })], [text("Staff welfare is in the expenses table below.")], [tool("expenses", { from: "2025-04-01", to: "2026-03-31", limit: null })], [text("Again.")]]);
  const r1 = await ask(c, { question: q, client_id: CLIENT });
  eq(c.calls.length, 2, "the first time: the model");
  const r2 = await ask(c, { question: q, client_id: CLIENT });
  eq([c.calls.length, !!r2.done.cached, r2.done.text], [2, true, r1.done.text], "the second time: from the cache, no model call");
  eq(JSON.stringify(ofType(r2.events, "result")[0].rows), JSON.stringify(ofType(r1.events, "result")[0].rows), "the same table");
  const lg = await svc("/rest/v1/assistant_log?select=route,calls,cost_inr&question=eq." + encodeURIComponent(q) + "&order=id");
  eq(lg.map((x: any) => [x.route, x.calls]), [["model", 3], ["cache", 0]], "logged: model, then cache at no cost");
  // the bridge brings something in: the books' version changes, the question is answered afresh
  const up = await fetch(STAND + "/rest/v1/tally_books?book_id=eq.00000000-0000-4000-8000-0000000000b1", { method: "PATCH", headers: { Authorization: "Bearer service-key", "Content-Type": "application/json" }, body: JSON.stringify({ days_at: new Date().toISOString() }) });
  await up.body?.cancel();
  await ask(c, { question: q, client_id: CLIENT });
  eq(c.calls.length, 4, "after the books changed: the model again");
});

Deno.test("strict tools refused by the API: the call is made once more without strict", async () => {
  let n = 0;
  const inner = new MockClaude([[text("General answer.")]]);
  const c = { beta: { messages: { stream: (p: Record<string, unknown>) => {
    if (n++ === 0 && (p.tools as any[]).some((t) => t.strict)) throw Object.assign(new Error("400 tools.0.strict: Extra inputs are not permitted"), { status: 400 });
    return inner.beta.messages.stream(p);
  } } } };
  const r = await ask(c as never, { question: "What is section 194Q about? " + crypto.randomUUID().slice(0, 6), client_id: null });
  eq([r.done.text, (inner.calls[0] as any).tools.some((t: any) => t.strict)], ["General answer.", false], "answered without strict");
});

// Sentry FINCOM-CLOUD-STAGING-1: a turn that failed said only "turn failed other" in Sentry and "could not answer just now"
// to the user. Each failure now has its own kind and words, and the Sentry event says what failed and where, in codes only.
const failing = (err: () => unknown) => ({ beta: { messages: { stream: () => { throw err(); } } } });
const apiErr = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers({ "request-id": "req_011CTestAbcdef0123456789" }));
const sentryEvent = (s: { sent: string[] }) => JSON.parse(s.sent[s.sent.length - 1].split("\n")[2]);
Deno.test("a failed turn: the user is told what failed in plain words; Sentry gets the error class, status, API error type, step and model, never the question", async () => {
  const cases: [() => unknown, string, RegExp, Record<string, string>, string][] = [
    [() => apiErr(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."), "billing", /out of credit.*administrator/i,
      { status: "400", api_error: "invalid_request_error", step: "model_call", model: "claude-sonnet-5-5", request_id: "req_011CTestAbcdef0123456789" }, "BadRequestError"],
    [() => apiErr(404, "not_found_error", "model: claude-sonnet-5-5"), "model_unavailable", /claude-sonnet-5-5.*administrator/i,
      { status: "404", api_error: "not_found_error", step: "model_call", model: "claude-sonnet-5-5" }, "NotFoundError"],
    [() => apiErr(400, "invalid_request_error", "tools.12.blocked_domains: Extra inputs are not permitted"), "ai_request", /turned this request down.*reported/i,
      { status: "400", api_error: "invalid_request_error", step: "model_call" }, "BadRequestError"],
    [() => apiErr(529, "overloaded_error", "Overloaded"), "overloaded", /overloaded/i, { status: "529", api_error: "overloaded_error" }, "InternalServerError"],
    [() => new Anthropic.APIConnectionError({ message: "Connection error." }), "network", /could not reach/i, { step: "model_call" }, "APIConnectionError"],
    [() => new TypeError("Cannot read properties of undefined (reading 'content')"), "internal", /went wrong in FinCom/i, { step: "model_call" }, "TypeError"],
  ];
  for (const [err, kind, words, tags, cls] of cases) {
    const marker = "Q" + crypto.randomUUID().slice(0, 8);
    const r = await ask(failing(err) as never, { question: "What is section 194Q about? " + marker, client_id: null });
    const e = ofType(r.events, "error")[0];
    eq(e && e.kind, kind, cls + ": the kind");
    assert(words.test(e.message), cls + ": the words: " + e.message);
    assert(!/could not answer just now/.test(e.message), cls + ": not the generic message");
    eq(r.sentry.sent.length, 1, cls + ": one Sentry event");
    const ev = sentryEvent(r.sentry);
    eq([ev.tags.where, ev.tags.kind, ev.exception.values[0].type], ["assistant_turn", kind, cls], cls + ": where, kind and class");
    for (const [k, v] of Object.entries(tags)) eq(ev.tags[k], v, cls + ": tag " + k);
    if (tags.status && tags.status.startsWith("4")) assert(ev.extra && typeof ev.extra.api_message === "string" && ev.extra.api_message.length > 5, cls + ": the API's own message in extra: " + JSON.stringify(ev.extra));
    if (cls === "BadRequestError" && kind === "ai_request") eq(ev.extra.api_message, "tools.12.blocked_domains: Extra inputs are not permitted", "the API's words kept");
    for (const bad of [marker, "194Q", "section"]) assert(!r.sentry.sent[0].includes(bad), cls + ": no '" + bad + "' of the question in Sentry");
  }
});

Deno.test("a book tool that fails and then a failed model call: Sentry names the tool and the database's error code", async () => {
  const s = sentryStand();
  const marker = "Q" + crypto.randomUUID().slice(0, 8);
  // what PostgREST answered on staging before migration 85, for the book tool the keyword router picked
  const pgrst = (async (u: string | URL | Request, init?: RequestInit) => /\/rest\/v1\/rpc\/asst_tds_missed$/.test(String(u))
    ? new Response(JSON.stringify({ code: "42501", details: null, hint: null, message: "permission denied for function tally_pick" }), { status: 403, headers: { "Content-Type": "application/json" } })
    : fetch(u, init)) as typeof fetch;
  const r = await ask(failing(() => apiErr(400, "invalid_request_error", "Your credit balance is too low")) as never,
    { question: "Which suppliers crossed 30,000 under 194C without TDS this year? " + marker, client_id: CLIENT }, ME, s, pgrst);
  const ev = sentryEvent(r.sentry);
  eq(ofType(r.events, "error")[0].kind, "billing", "the kind");
  eq([ev.tags.tool, ev.tags.db_code, ev.tags.step], ["tds_missed", "42501", "routing_call"], "the failed tool, its code and the step");
  assert(!r.sentry.sent[0].includes(marker) && !r.sentry.sent[0].includes("tally_pick(") && !r.sentry.sent[0].includes(CLIENT), "nothing of the question or the client");
});

Deno.test("the request shape (FINCOM-CLOUD-STAGING-2): every request FinCom builds is one the API accepts; the one that was refused is caught", async () => {
  // what staging sent until now: every book tool strict, each parameter a ["type", "null"] union
  const before = BOOK_TOOLS.map((t) => ({ ...(routerTools(false).find((x: any) => x.name === t.name) as Record<string, unknown>), strict: true }));
  const refused = apiShape({ model: "claude-haiku-5-5", max_tokens: 1024, output_config: { effort: "low" }, thinking: { type: "adaptive" }, tools: before,
    system: [{ type: "text", text: "x", cache_control: { type: "ephemeral", ttl: "1h" } }], messages: [{ role: "user", content: "q" }] });
  assert(refused.some((b) => /strict tools; at most 20/.test(b)) && refused.some((b) => /union types/.test(b)), "the old request is refused: " + refused.join(" | "));
  // each tool list FinCom builds stays within the strict limits
  for (const [w, tools] of [["router", routerTools(true)], ["client", claudeTools(false, { web: true })], ["firm", claudeTools(true, { web: true })], ["notice", claudeTools(false, { web: true, notice: true })]] as const)
    eq(apiShape({ model: "claude-sonnet-5-5", max_tokens: 6000, tools, messages: [{ role: "user", content: "q" }] }).filter((b) => /strict|union|optional/.test(b)), [], w + ": within the strict limits");
  // and every request the tests in this file made was accepted (the mocked Claude refuses as the API does)
  eq(shapeRefusals, [], "no request refused for its shape");
  // the rules themselves: what the 5.5 models refuse
  const base = { model: "claude-sonnet-5-5", max_tokens: 100, messages: [{ role: "user", content: "q" }] };
  assert(apiShape({ ...base, thinking: { type: "enabled", budget_tokens: 2000 } }).length === 1, "a thinking budget");
  assert(apiShape({ ...base, fallbacks: "default" }).length === 1, "fallbacks without their beta");
  assert(apiShape({ ...base, model: "claude-haiku-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] }).length === 1, "fallbacks on Haiku");
  assert(apiShape({ ...base, model: "claude-haiku-5-5", tools: [{ type: "web_search_20260209", name: "web_search" }] }).length === 1, "web search 20260209 on Haiku");
  assert(apiShape({ ...base, tool_choice: { type: "any" } }).length === 1, "forced tool use");
});

Deno.test("RLS: another firm's client is refused; the book tools give a member nothing of another firm", async () => {
  const r = await ask(new MockClaude([]), { question: "Top customers", client_id: OTHER_CLIENT });
  eq(r.status, 403, "refused");
  assert(/not one of your firm/.test(r.raw), "in words");
  // firm-wide: the client named must be the firm's
  const c = new MockClaude([[tool("top_parties", { client: "Another Firm's Client", side: "customers", measure: "turnover", from: null, to: null, limit: 3 })], [text("I could not find that client.")]]);
  const r2 = await ask(c, { question: "Top customers of Another Firm's Client", client_id: null });
  eq(ofType(r2.events, "result").length, 0, "no result for another firm's client");
  const tr = (c.calls[1] as any).messages.at(-1).content[0];
  assert(tr.is_error && /no client of the firm matches/.test(tr.content), "told it is not the firm's: " + JSON.stringify(tr));
});

Deno.test("the 'Wrong answer?' button: a row with the user's note, and one Sentry event without it", async () => {
  const s = sentryStand();
  const h = handler({ env: (k) => ({ SUPABASE_URL: STAND, SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[k], fetch: (...a) => fetch(...a), sentry: s.r });
  const res = await h(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer tok-" + STAFF, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "report", client_id: CLIENT, question: "Cash payments over 10,000 in September", note: "Kestrel was paid 94,400 in cash, not bank", tools: ["entries_filter"], entries: ["5f1c0d2a-7b3e-4c9a-9e21-3d8f6a0b4c71-00000021"] }) }));
  const j = await res.json();
  assert(j.ok && j.id, "a row");
  await s.settle();
  const rows = await svc("/rest/v1/assistant_mismatches?select=kind,note,tool,entry_ids&id=eq." + j.id);
  eq([rows[0].kind, rows[0].note, rows[0].tool], ["user_report", "Kestrel was paid 94,400 in cash, not bank", "entries_filter"], "the row keeps the note");
  eq(s.sent.length, 1, "one event");
  const ev = JSON.parse(s.sent[0].split("\n")[2]);
  eq([ev.tags.kind, ev.message], ["user-report", "Assistant answer reported wrong: user_report"], "kind user-report");
  for (const bad of ["Kestrel", "94,400", "94400", "cash", "September"]) assert(!s.sent[0].includes(bad), "no '" + bad + "' in Sentry");
  eq(ev.extra.entry_ids, ["5f1c0d2a-7b3e-4c9a-9e21-3d8f6a0b4c71-00000021"], "the entry ids");
});

Deno.test("the log: only the question, the tools, how it was answered, the tokens, the cost and the time; never the answer or a figure of the books", async () => {
  const marker = "Q-" + crypto.randomUUID().slice(0, 8);
  const c = new MockClaude([]);
  await ask(c, { question: "Cash and bank at year end " + marker, client_id: CLIENT });
  const rows = await svc("/rest/v1/assistant_log?select=*&question=eq." + encodeURIComponent("Cash and bank at year end " + marker));
  eq(rows.length, 1, "one line");
  const l = rows[0];
  eq(Object.keys(l).sort(), ["at", "cache_read", "cache_write", "calls", "client_id", "cost_inr", "feature", "fell_through", "firm_id", "id", "input_tokens", "models", "ms", "output_tokens", "question", "route", "tools", "user_id"], "its columns");
  eq([l.tools, l.calls, l.route, l.input_tokens, Number(l.cost_inr), l.fell_through], [["cash_bank"], 0, "keyword", 0, 0, false], "the keyword router: no model, no cost");
  const all = JSON.stringify(rows);
  for (const bad of ["2,31,750", "231750", "219250", "Tamarind"]) assert(!all.includes(bad), "no '" + bad + "' in the log");
});

Deno.test("data minimisation: no raw PAN, GSTIN or unnamed party name in anything sent to Claude; the answer and the tool inputs get the real values back", async () => {
  const PANS = /\b[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]\b/, GSTINS = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/;
  const c = new MockClaude([
    [tool("tds_missed", { from: null, to: null, section: null })],
    (p) => {
      const tr = (p.messages as any[]).at(-1).content[0];
      const row = JSON.parse(tr.content).rows[0];
      assert(/^PARTY_\d+$/.test(row.party) && /^PAN_\d+$/.test(row.pan), "Claude sees tokens: " + JSON.stringify(row));
      return [text(row.party + " (PAN " + row.pan + ") crossed the 194C limit; its account follows."), tool("ledger_entries", { ledger: row.party, from: "2026-02-01", to: "2026-03-31", limit: null })];
    },
    [text("Done.")],
  ]);
  const r = await ask(c, { question: "Which suppliers need a look for TDS, and what are their accounts? Our GSTIN is 07AAGCL4827M1Z3.", client_id: CLIENT });
  const sent = JSON.stringify([...c.routerCalls, ...c.calls].map((p: any) => ({ ...p, messages: p.messages.map((m: any) => Array.isArray(m.content) ? { ...m, content: m.content.filter((b: any) => b.type !== "document") } : m) })));
  assert(!PANS.test(sent), "no PAN in what was sent: " + (sent.match(PANS) || [])[0]);
  assert(!GSTINS.test(sent), "no GSTIN in what was sent: " + (sent.match(GSTINS) || [])[0]);
  for (const name of ["Ashvattha", "Nightjar", "Juniper", "Quillfeather", "AGWPA1185G"]) assert(!sent.includes(name), "no '" + name + "' sent to Claude");
  assert(r.done.text.includes("Ashvattha Transport Co (PAN AGWPA1185G) crossed"), "the answer has the real name and PAN: " + r.done.text);
  const streamed = ofType(r.events, "text").map((e) => e.d).join("");
  assert(streamed.includes("Ashvattha Transport Co (PAN AGWPA1185G)") && !/PARTY_|PAN_/.test(streamed), "the streamed words too");
  const led = ofType(r.events, "result").find((x) => x.tool === "ledger_entries");
  eq([led.ledger, led.rows.length, led.rows[0].credit], ["Ashvattha Transport Co", 2, 40000], "the tool input was mapped back to the real ledger");
});

Deno.test("a named party is not masked; the switch: on by default (no row), off when the owner switches it off; no consent tick", async () => {
  const c = new MockClaude([[tool("ledger_balance", { ledger: "Nightjar", as_on: "2026-03-31" })], [text("Nightjar is owed ₹2,90,000.00.")]]);
  await ask(c, { question: "What do we owe Nightjar?", client_id: CLIENT });
  assert(JSON.stringify(c.calls[1]).includes("Nightjar Sound & Light Co"), "the party the question names is sent as it is");
  const set = async (enabled: boolean, consent: boolean) => { const r = await fetch(STAND + "/rest/v1/assistant_settings?firm_id=eq." + FIRM, { method: "PATCH", headers: { Authorization: "Bearer service-key", "Content-Type": "application/json" }, body: JSON.stringify({ enabled, consent }) }); await r.body?.cancel(); };
  try {
    await set(false, true);
    const off = new MockClaude([]);
    const r1 = await ask(off, { question: "What is the TDS rate on rent?", client_id: null });
    eq([r1.status, JSON.parse(r1.raw).kind, off.calls.length], [403, "off", 0], "switched off by the owner: refused, Claude not called");
    await set(true, false);
    const on = new MockClaude([[text("10% under section 194-I.")]]);
    const r2 = await ask(on, { question: "What is the TDS rate on rent? " + crypto.randomUUID().slice(0, 6), client_id: null });
    eq([r2.status, on.calls.length], [200, 1], "on, with the old consent column false: answered (the owner's decision of 14-Oct-2026: no consent tick)");
  } finally { await set(true, true); }
  // another firm that never set anything: on (the stranger's firm has no row)
  const s2 = new MockClaude([[text("General answer.")]]);
  const r3 = await ask(s2, { question: "What is section 194Q? " + crypto.randomUUID().slice(0, 6), client_id: null }, STRANGER);
  eq([r3.status, s2.calls.length], [200, 1], "a firm with no setting row: on by default");
});

Deno.test("'check my Q4 26Q' from the chat: FinCom's own checklist, run in the browser; no figure from Claude", async () => {
  const c = new MockClaude([[tool("prefiling_check", { return: "26Q", fy: "2025-26", quarter: "Q4", month: null, gstin_state: null })], [text("The checklist for 26Q Q4 2025-26 is below.")]]);
  const r = await ask(c, { question: "check my Q4 26Q before I file", client_id: CLIENT });
  const pf = ofType(r.events, "prefile")[0];
  eq([pf.form, pf.fy, pf.quarter, pf.client, c.calls.length + c.routerCalls.length], ["26Q", "2025-26", "Q4", CLIENT, 0], "the checklist event, by the keyword router: no model");
  // asked another way, the model calls prefiling_check
  const r2 = await ask(c, { question: "Is the fourth-quarter TDS return for contractors fine to submit, do you think?", client_id: CLIENT });
  eq(ofType(r2.events, "prefile")[0]?.form, "26Q", "through the model");
});
