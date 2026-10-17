// One 2B matching run: the rules (server/_shared/match2b.js, the same file the app runs), then ONE Claude call for what
// they leave (round 72b). Plain module, no Deno globals: the function (index.ts) gives it the Claude client and the
// firm's cap, cost and log, the tests (match_test.ts) a fake.
//   - The call: claude-sonnet-5-5, adaptive thinking at low effort, structured JSON (output_config.format, the schema
//     M2B_SCHEMA), the system prompt cached; streamed and read whole at the end, as Ask FinCom's calls are
//     (server/assistant/agent.ts); the server-side refusal fallback as for every Sonnet call there.
//   - Sent: the left-over 2B documents and books entries, each only GSTIN, name, number, date, taxable, IGST, CGST, SGST
//     and cess (m2bAiInput). Nothing else of the client.
//   - Before it: the firm's AI switch and the app's AI help for 2B (aiAllowed), the key, the rupee cap (capTake). After it:
//     the cost added to the firm's day (costAdd) and one log line like Ask FinCom's (log): no supplier, no figure.
//   - The answer is checked (m2bAiParse); not JSON of the agreed shape: refused whole. Each pair is decided from the
//     documents' own figures (m2bAiApply): the AI's text gives ids and a reason, never an amount, never a credit decision.
// Whatever happens to the AI (off, over the cap, no key, failed, refused, unreadable) the rules' result stands, and
// ai.say says so in the run line.
import { m2bAiApply, m2bAiInput, m2bAiParse, m2bAiPrompt, m2bLine, m2bRules, M2B_SCHEMA, M2B_SYSTEM } from "../_shared/match2b.js";
import { costUsd, SONNET, Usage } from "../assistant/models.ts";

export { SONNET };
type Stream = { [Symbol.asyncIterator](): AsyncIterator<any>, finalMessage(): Promise<any> };
export type AiClient = { beta: { messages: { stream: (p: Record<string, unknown>) => Stream } } };
export type MatchDeps = {
  client: AiClient | null,
  aiAllowed: boolean,
  capTake: () => Promise<{ ok: boolean, why?: string }>,
  costAdd: (usd: number, u: Usage) => Promise<{ inr?: number } | null>,
  log: (x: { question: string, input: number, output: number, calls: number, ms: number, inr: number, route: string, cacheRead: number, cacheWrite: number }) => Promise<unknown>,
};
export type AiInfo = { state: "used" | "off" | "nothing" | "cap" | "failed" | "invalid" | "reused", say: string, model: string, usd: number, inr: number,
  input: number, output: number, sent: number, notSent: number, bad: number, pairs: any[] };

const STANDS = "the rules' result stands.";
const inrStr = (v: number) => "₹" + (Math.round(v * 100) / 100).toFixed(2);

// twob / books: rows as m2bRow2b / m2bRowBk read them; decisions: {pairId: "accept" | "reject"}
export async function matchRun(twob: any[], books: any[], decisions: Record<string, string>, deps: MatchDeps) {
  const t0 = Date.now();
  const rules = m2bRules(twob, books);
  const ai: AiInfo = { state: "nothing", say: "", model: SONNET, usd: 0, inr: 0, input: 0, output: 0, sent: 0, notSent: 0, bad: 0, pairs: [] };
  // what a person accepted before is settled first (free); the AI sees only what is left after it
  const settled = m2bAiApply(twob, books, rules, [], decisions);
  const left = { pairs: rules.pairs, left2b: settled.left2b, leftBooks: settled.leftBooks };
  const done = (pairs: any[]) => {
    const res = m2bAiApply(twob, books, rules, pairs, decisions);
    return { result: { ...res, line: m2bLine(res.counts) }, ai };
  };
  if (!left.left2b.length || !left.leftBooks.length) { ai.say = "Nothing left for AI to look at."; return done([]); }
  if (!deps.aiAllowed) { ai.state = "off"; ai.say = "AI is off for this firm or client (Settings, AI help): " + STANDS; return done([]); }
  if (!deps.client) { ai.state = "failed"; ai.say = "AI is not set up on the platform yet: " + STANDS; return done([]); }
  const inp = m2bAiInput(twob, books, left.left2b, left.leftBooks);
  ai.sent = inp.g.length + inp.b.length; ai.notSent = inp.notSent;
  let cap: { ok: boolean, why?: string };
  try { cap = await deps.capTake(); } catch { cap = { ok: false, why: "error" }; }
  // the rupees are the month's (migration 96); the count of calls the day's
  if (!cap.ok) { ai.state = "cap"; ai.say = (cap.why === "calls" ? "The firm's AI calls for today are used up: " : "The firm's AI budget for this month is used up: ") + STANDS; return done([]); }
  let msg: any = null;
  try {
    const stream = deps.client.beta.messages.stream({
      model: SONNET, max_tokens: 16000, thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: M2B_SCHEMA } },
      system: [{ type: "text", text: M2B_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: m2bAiPrompt(inp) }],
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    });
    for await (const _ev of stream) { /* read whole at the end */ }
    msg = await stream.finalMessage();
  } catch {
    ai.state = "failed"; ai.say = "AI could not be reached just now: " + STANDS;
    await deps.log({ question: "2B match: AI call failed", input: 0, output: 0, calls: 1, ms: Date.now() - t0, inr: 0, route: "sonnet", cacheRead: 0, cacheWrite: 0 }).catch(() => {});
    return done([]);
  }
  const u: Usage = msg?.usage || {};
  ai.usd = costUsd(SONNET, u); ai.input = u.input_tokens || 0; ai.output = u.output_tokens || 0;
  const added = await deps.costAdd(ai.usd, u).catch(() => null);
  ai.inr = Number(added?.inr || 0);
  const text = ((msg?.content || []) as any[]).filter((b) => b?.type === "text").map((b) => b.text).join("");
  const parsed: any = msg?.stop_reason === "refusal" || msg?.stop_reason === "max_tokens" ? null : m2bAiParse(text, inp.map);
  await deps.log({ question: "2B match: " + inp.g.length + " 2B and " + inp.b.length + " books documents left after the rules", input: ai.input, output: ai.output, calls: 1,
    ms: Date.now() - t0, inr: ai.inr, route: "sonnet", cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 }).catch(() => {});
  if (!parsed) { ai.state = "failed"; ai.say = "AI did not finish its answer: " + STANDS + " Cost " + inrStr(ai.inr) + "."; return done([]); }
  if (!parsed.ok) { ai.state = "invalid"; ai.say = "AI's answer could not be read (not in the agreed form): " + STANDS + " Cost " + inrStr(ai.inr) + "."; return done([]); }
  ai.state = "used"; ai.pairs = parsed.pairs; ai.bad = parsed.bad;
  const out = done(parsed.pairs);
  const c = out.result.counts;
  ai.say = "AI looked at the " + ai.sent + " documents left: " + c.byAi + " matched by AI, " + c.probable + " to confirm" + (ai.notSent ? "; " + ai.notSent + " more not sent (over " + 300 + " a side)" : "") + " · cost " + inrStr(ai.inr);
  return out;
}

// the same result again with the pairs the AI gave in an earlier run (a person's accept or reject): no call, no cost
export function reapply(twob: any[], books: any[], decisions: Record<string, string>, prev: AiInfo | null) {
  const rules = m2bRules(twob, books);
  const res = m2bAiApply(twob, books, rules, (prev && prev.pairs) || [], decisions);
  const ai = { ...(prev || {}), state: "reused", usd: 0, inr: 0, input: 0, output: 0, say: "Your choice is kept; AI was not asked again." } as AiInfo;
  return { result: { ...res, line: m2bLine(res.counts) }, ai };
}
