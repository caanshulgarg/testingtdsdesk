// deno run -A tests/assistant_cost.ts - the cost levers measured on the fixture questions (run by run_assistant_cost.py,
// which starts the stand). Each question goes through the real function twice: "before" (every question to Opus 5.5 at
// medium effort, no keyword router, no Haiku routing, 40 rows and every column to the model, the system prompt cached for
// 5 minutes only, no answer cache) and "after" (the levers on). The model is MOCKED with the same answers both times; what
// differs is what FinCom sends and to which model. Tokens are ESTIMATED from what is sent (3.3 characters a token; a PDF
// page 1,500 tokens) and from what the mock writes back, plus thinking (low 80, medium 300, high 1,200 tokens a call); the
// prompt cache is simulated as the API keeps it (prefix up to the marker; 1-hour write 2x, 5-minute 1.25x, read 0.1x
// Sonnet / 0.05x Opus). Prices: models.ts. Rupees at Rs 85 to the dollar.
import { handler } from "../server/assistant/index.ts";
import { costUsd, Usage } from "../server/assistant/models.ts";
import { route } from "../server/assistant/router.ts";

const STAND = Deno.env.get("STAND_URL")!;
const ME = "aaaaaaaa-0000-4000-8000-000000000001", FIRM = "11111111-1111-4111-8111-111111111111";
const tok = (s: string) => Math.ceil(s.length / 3.3);
const THINK: Record<string, number> = { low: 80, medium: 300, high: 1200 };
type B = Record<string, unknown>;
const tool = (name: string, input: B): B => ({ type: "tool_use", name, input });
const text = (t: string): B => ({ type: "text", text: t });

// what the model writes for each question (the same before and after)
const Q = {
  tds194c: "Which suppliers crossed 30,000 under 194C without TDS this year?",
  cash: "Cash payments over 10,000 in September",
  top: "Top 10 customers by sales this quarter",
  late: "TDS paid late this year",
  msme: "Owed to MSME suppliers for more than 45 days",
  haiku: "Nightjar entries above 50000 between June and August 2025",
  rukmini: "What did we pay Rukmini in March and what was the reverse charge?",
  rate: "TDS rate on rent for a company?",
  excel: "Excel of all deductees with PAN",
  notice: "Read this notice and prepare the reply",
};
const NIGHTJAR = { from: "2025-06-01", to: "2025-08-31", min_amount: 50000, max_amount: null, mode: "any", direction: "any", ledger: null, party: "Nightjar", voucher_type: null, narration: null, limit: null };
function script(q: string): B[][] {
  const r = route(q, "2026-03-31") as any;
  if (r && r.tool) return [[tool(r.tool, r.input)], [text("Here is what the books show; the table is below with " + r.why + ".")]];
  if (q === Q.haiku) return [[tool("entries_filter", NIGHTJAR)], [text("Two entries with Nightjar over ₹50,000 in June to August 2025; the table is below.")]];
  if (q === Q.rukmini) return [[tool("daybook_slice", { from: "2026-03-01", to: "2026-03-31", ledger: null, party: "Rukmini", narration: null })],
    [tool("record_figures", { figures: [{ name: "paid to Rukmini in March 2026", value: 60000, text: "₹60,000.00", tool: "entries_filter", input_json: JSON.stringify({ from: "2026-03-01", to: "2026-03-31", min_amount: null, max_amount: null, mode: "bank", direction: "payment", ledger: null, party: "Rukmini", voucher_type: null, narration: null, limit: null }), field: "summary.total" }] })],
    [text("Rukmini Sethuraman was paid ₹60,000.00 on 31-Mar-2026 for the godown rent of January to March [V:77|2026-03-31]; March's reverse charge was ₹3,600.00 [V:76|2026-03-31].")]];
  if (q === Q.rate) return [[{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "TDS rate rent company 194-I section 393" } },
    { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://incometaxindia.gov.in/Pages/tds-rates.aspx", title: "TDS rates", encrypted_content: "x".repeat(3000) }] },
    text("For rent of land, building or furniture paid by a company: TDS at 10% where the rent is more than ₹50,000 in a month - section 194-I of the 1961 Act up to 31-Mar-2026 and section 393 of the 2025 Act from 1-Apr-2026. Plant and machinery: 2%.")]];
  if (q === Q.excel) return [[tool("make_file", { format: "xlsx", title: "TDS by deductee 2025-26", file_name: "tds-deductees", sections: [{ heading: "TDS by deductee", text: null, table_tool: "tds_deductees", table_input_json: JSON.stringify({ from: "2025-04-01", to: "2026-03-31", section: null }) }] })],
    [text("The Excel of every deductee with their PAN is ready below.")]];
  if (q === Q.notice) return [
    [tool("record_notice", { summary: "GSTR-3B for February 2026 took ₹11,000 of input tax but GSTR-2B shows ₹5,400.", law: "GST", form: "ASMT-10", kind: "gst_asmt10", notice_no: "ZD0711260123456", din: "ZD0711260123456", notice_date: "2026-10-20",
      section: "Section 61 of the CGST Act, 2017; rule 99", period: "February 2026", id_no: "07AAGCL4827M1Z3", amount: 5600, reply_by: "2026-11-15", asked: ["Explain the excess ITC of ₹5,600"],
      issues: [{ type: "itc_mismatch", point: "ITC in 3B more than 2B", amount: 5600, period: "2026-02" }], months: ["2026-02"], fy: "2025-26" })],
    [tool("draft", { title: "Reply to ASMT-10 for February 2026", kind: "notice_reply", body: "To the Proper Officer\n# 1. The credit of Rs 11,000\nRs 5,400 on invoices agrees with GSTR-2B (Annexure 1, Annexure 3); Rs 5,600 is reverse-charge tax (Annexure 2), taken in table 4(A)(3).\n# 2. The suppliers\nAccounts at Annexure 4, payments at Annexure 5.\n[Authorised signatory]".repeat(3) })],
    [text("The difference is reverse-charge credit, which 2B never shows. The reply and the pack are ready; attach the purchase invoices and the other documents listed.")]];
  return [[text("(no script)")]];
}

// the API, mocked: answers from the script; usage estimated from what was sent, with the prompt cache simulated
const cache = new Map<string, number>();      // prefix -> expiry (ms)
function claude(log: { q: string, model: string, effort: string, u: Usage }[], q: string) {
  let main = 0;
  return { beta: { messages: { stream: (p: any) => {
    const isRouter = /^You route a question/.test(String(p.system?.[0]?.text || ""));
    const steps = script(q);
    const content: B[] = isRouter ? (q === Q.haiku ? [tool("entries_filter", NIGHTJAR)] : [text("NONE")]) : (steps[main++] ?? [text("Done.")]);
    const withIds = content.map((b, i) => b.type === "tool_use" ? { id: "toolu_" + main + "_" + i, ...b } : b);
    // what was sent
    const prefix = JSON.stringify(p.tools || []) + JSON.stringify(p.system || []);
    const msgs = JSON.stringify((p.messages || []).map((m: any) => Array.isArray(m.content) ? { ...m, content: m.content.map((b: any) => b.type === "document" ? { type: "document", pages: 1 } : b) } : m));
    const docs = (p.messages || []).reduce((n: number, m: any) => n + (Array.isArray(m.content) ? m.content.filter((b: any) => b.type === "document").length : 0), 0) * 1500;
    const marker = p.system?.[0]?.cache_control, ttl = marker ? (marker.ttl === "1h" ? 3600e3 : 300e3) : 0;
    const now = Date.now();
    let read = 0, w1h = 0, w5m = 0, input = 0;
    const key = p.model + "|" + prefix;
    if (ttl && (cache.get(key) || 0) > now) { read += tok(prefix); cache.set(key, now + ttl); }
    else if (ttl && tok(prefix) >= 1024) { if (ttl === 3600e3) w1h += tok(prefix); else w5m += tok(prefix); cache.set(key, now + ttl); }
    else input += tok(prefix);
    // the turn's own messages: the automatic marker caches them for the next call of the same turn
    const mkey = p.model + "|" + q + "|msgs";
    const prev = (cache.get(mkey + "|len") || 0);
    if (p.cache_control && prev > 0 && (cache.get(mkey) || 0) > now) { read += prev; input += Math.max(tok(msgs) - prev, 0) + docs; w5m += 0; }
    else input += tok(msgs) + docs;
    if (p.cache_control) { cache.set(mkey, now + 300e3); cache.set(mkey + "|len", tok(msgs) + docs); }
    const out = tok(JSON.stringify(withIds)) + (THINK[p.output_config?.effort] || 300);
    const u: Usage = { input_tokens: input, output_tokens: out, cache_read_input_tokens: read, cache_creation_input_tokens: w1h + w5m,
      cache_creation: { ephemeral_1h_input_tokens: w1h, ephemeral_5m_input_tokens: w5m },
      server_tool_use: { web_search_requests: withIds.filter((b) => b.type === "server_tool_use").length } };
    log.push({ q, model: p.model, effort: p.output_config?.effort, u });
    const msg = { content: withIds, stop_reason: withIds.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: u };
    return { async *[Symbol.asyncIterator]() { for (const b of withIds) if (b.type === "text") yield { type: "content_block_delta", delta: { type: "text_delta", text: b.text } }; }, finalMessage: async () => msg };
  } } } };
}

async function run(levers: Record<string, boolean>, q: string, client: string | null, attachments: B[] = []) {
  const log: { q: string, model: string, effort: string, u: Usage }[] = [];
  const h = handler({ env: (k) => ({ SUPABASE_URL: STAND, SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[k], fetch: (...a) => fetch(...a),
    anthropic: () => claude(log, q) as never, now: () => new Date("2026-10-13T10:00:00Z"), levers });
  const res = await h(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer tok-" + ME, "Content-Type": "application/json" }, body: JSON.stringify({ action: "ask", question: q, client_id: client, attachments }) }));
  const raw = await res.text();
  const done = raw.split("\n\n").filter((x) => x.startsWith("data: ")).map((x) => JSON.parse(x.slice(6))).find((e) => e.t === "done") || {};
  const usd = log.reduce((a, c) => a + costUsd(c.model, c.u), 0);
  return { usd, calls: log.length, models: Array.from(new Set(log.map((c) => c.model.replace("claude-", "")))), route: done.cached ? "cache" : done.route, cacheRead: log.reduce((a, c) => a + (c.u.cache_read_input_tokens || 0), 0) };
}

const BEFORE = { router: false, haiku: false, slim: false, promptCache: false, opusOnly: true, answerCache: false };
const AFTER = {};
const notice = await Deno.readFile(new URL("./fixtures/assistant/asmt10-notice.pdf", import.meta.url));
const up = await fetch(STAND + "/storage/v1/object/assistant-files/" + FIRM + "/larkspur/notices/cost-asmt10.pdf", { method: "POST", headers: { Authorization: "Bearer tok-" + ME, "Content-Type": "application/pdf" }, body: notice });
await up.text();
const ATT = [{ path: FIRM + "/larkspur/notices/cost-asmt10.pdf", name: "asmt10.pdf", type: "application/pdf" }];
const CASES: [string, string, string | null, B[]][] = [
  ["book: TDS 194C missed (keyword)", Q.tds194c, "larkspur", []], ["book: cash payments (keyword)", Q.cash, "larkspur", []], ["book: top customers (keyword)", Q.top, "larkspur", []],
  ["book: TDS paid late (keyword)", Q.late, "larkspur", []], ["book: MSME 43B(h) (keyword)", Q.msme, "larkspur", []], ["book: entries filter (Haiku)", Q.haiku, "larkspur", []],
  ["book: Day Book fallback (Sonnet)", Q.rukmini, "larkspur", []], ["general: TDS rate (Sonnet + web)", Q.rate, null, []], ["general: same question again (answer cache)", Q.rate, null, []],
  ["file: Excel of deductees (Sonnet)", Q.excel, "larkspur", []], ["notice: ASMT-10 reply pack (Opus high)", Q.notice, "larkspur", ATT],
];
// cold: the first question of the hour (the prompt cache is written); warm: the same again within the hour (read). The
// answer cache is off for the warm pass, so it measures the model's own cost.
const out: Record<string, unknown>[] = [];
for (const [what, q, client, att] of CASES) {
  const b = await run(BEFORE, q, client, att);
  const a = await run(AFTER, q, client, att);
  out.push({ what, before_inr: +(b.usd * 85).toFixed(2), after_inr: +(a.usd * 85).toFixed(2), before: b.models.join("+") + " x" + b.calls, after: (a.calls ? a.models.join("+") + " x" + a.calls : a.route) });
}
for (const [i, [what, q, client, att]] of CASES.entries()) {
  if (/answer cache/.test(what)) continue;
  const b = await run(BEFORE, q, client, att);
  const a = await run({ ...AFTER, answerCache: false }, q, client, att);
  Object.assign(out[i], { warm_before_inr: +(b.usd * 85).toFixed(2), warm_after_inr: +(a.usd * 85).toFixed(2) });
}
console.log(JSON.stringify(out));
