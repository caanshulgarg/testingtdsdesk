// One AI step of the TDS challan matcher (next-challan-match): ONE Claude call for the deductions and challans the rules
// (server/_shared/tdsmatch.js, the same file the app runs) left. Plain module, no Deno globals: the function (index.ts)
// gives it the Claude client and the firm's cap, cost and log; the tests (match_test.ts) a fake.
//   - The call: claude-sonnet-5-5, adaptive thinking at low effort, structured JSON (TM_SCHEMA), the system prompt cached,
//     streamed and read whole at the end, the server-side refusal fallback: as gst-2b-match.
//   - Sent: the left-over deductions (section, month, date, tax, the deductee's name, the PAN masked to its last 4) and the
//     challans with tax or interest left (BSR code, serial, date, section, balance, the Tally payment's narration cut to
//     120 characters): tmAiInput. Nothing else of the client.
//   - Before it: the firm's AI switch and the app's AI help for TDS (aiAllowed), the key, the rupee cap (capTake). After
//     it: the cost (costAdd, feature "tds_match") and one log line without names or figures.
//   - The answer is read (tmAiParse: not JSON of the agreed shape, refused whole) and every pairing checked by the code
//     (tmAiCheck: never over a challan's balance, the tax year, whole rows, a split adding up to the paisa, interest within
//     what is left). Only what passes is returned; the app checks it again against its books before showing it.
// Whatever happens to the AI (off, over the cap, no key, failed, refused, unreadable) the rules' suggestions stand, and
// ai.say says so in one line.
import { tmAiCheck, tmAiInput, tmAiParse, tmAiPrompt, TM_SCHEMA, TM_SYSTEM } from "../_shared/tdsmatch.js";
import { costUsd, SONNET, Usage } from "../assistant/models.ts";

export { SONNET };
type Stream = { [Symbol.asyncIterator](): AsyncIterator<any>, finalMessage(): Promise<any> };
export type AiClient = { beta: { messages: { stream: (p: Record<string, unknown>) => Stream } } };
export type MatchDeps = {
  client: AiClient | null,
  aiAllowed: boolean,
  offSay?: string,          // FinCom's own refusal (the console's AI switches, ai_policy.ts), said instead of the firm's
  model?: string,           // the model set in the console (ai_allowed), else Sonnet
  capTake: () => Promise<{ ok: boolean, why?: string }>,
  costAdd: (usd: number, u: Usage) => Promise<{ inr?: number } | null>,
  log: (x: { question: string, input: number, output: number, calls: number, ms: number, inr: number, route: string, cacheRead: number, cacheWrite: number }) => Promise<unknown>,
};
export type AiInfo = { state: "used" | "off" | "nothing" | "cap" | "failed" | "invalid", say: string, model: string, usd: number, inr: number, input: number, output: number, sent: number, notSent: number, bad: number, dropped: number };

const STANDS = "the rules' suggestions stand.";
const inrStr = (v: number) => "₹" + (Math.round(v * 100) / 100).toFixed(2);

// rows / chs: as the app sends them (handler.ts keeps only the agreed fields); opt: {fy, q}
export async function matchRun(rows: any[], chs: any[], opt: { fy: string, q: string }, deps: MatchDeps) {
  const t0 = Date.now();
  const MODEL = deps.model || SONNET;
  const ai: AiInfo = { state: "nothing", say: "", model: MODEL, usd: 0, inr: 0, input: 0, output: 0, sent: 0, notSent: 0, bad: 0, dropped: 0 };
  const none = { pairs: [] as any[], splits: [] as any[], interest: [] as any[] };
  if (!rows.length || !chs.length) { ai.say = "Nothing left for AI to look at."; return { ai, ...none }; }
  if (!deps.aiAllowed) { ai.state = "off"; ai.say = (deps.offSay ? deps.offSay.replace(/[.\s]+$/, "") + ": " : "AI is off for this firm or client (Settings, AI help): ") + STANDS; return { ai, ...none }; }
  if (!deps.client) { ai.state = "failed"; ai.say = "AI is not set up on the platform yet: " + STANDS; return { ai, ...none }; }
  const inp = tmAiInput(rows, chs);
  ai.sent = inp.d.length + inp.c.length; ai.notSent = inp.notSent;
  let cap: { ok: boolean, why?: string };
  try { cap = await deps.capTake(); } catch { cap = { ok: false, why: "error" }; }
  if (!cap.ok) { ai.state = "cap"; ai.say = (cap.why === "calls" ? "The firm's AI calls for today are used up: " : "The firm's AI budget for this month is used up: ") + STANDS; return { ai, ...none }; }
  let msg: any = null;
  try {
    const stream = deps.client.beta.messages.stream({
      model: MODEL, max_tokens: 16000, thinking: { type: "adaptive" },
      output_config: { effort: "low", format: { type: "json_schema", schema: TM_SCHEMA } },
      system: [{ type: "text", text: TM_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: tmAiPrompt(inp) }],
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    });
    for await (const _ev of stream) { /* read whole at the end */ }
    msg = await stream.finalMessage();
  } catch {
    ai.state = "failed"; ai.say = "AI could not be reached just now: " + STANDS;
    await deps.log({ question: "TDS challan match: AI call failed", input: 0, output: 0, calls: 1, ms: Date.now() - t0, inr: 0, route: "sonnet", cacheRead: 0, cacheWrite: 0 }).catch(() => {});
    return { ai, ...none };
  }
  const u: Usage = msg?.usage || {};
  ai.usd = costUsd(MODEL, u); ai.input = u.input_tokens || 0; ai.output = u.output_tokens || 0;
  const added = await deps.costAdd(ai.usd, u).catch(() => null);
  ai.inr = Number(added?.inr || 0);
  const text = ((msg?.content || []) as any[]).filter((b) => b?.type === "text").map((b) => b.text).join("");
  const parsed: any = msg?.stop_reason === "refusal" || msg?.stop_reason === "max_tokens" ? null : tmAiParse(text, inp.map);
  await deps.log({ question: "TDS challan match: " + inp.d.length + " deductions and " + inp.c.length + " challans left after the rules", input: ai.input, output: ai.output, calls: 1,
    ms: Date.now() - t0, inr: ai.inr, route: "sonnet", cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0 }).catch(() => {});
  if (!parsed) { ai.state = "failed"; ai.say = "AI did not finish its answer: " + STANDS + " Cost " + inrStr(ai.inr) + "."; return { ai, ...none }; }
  if (!parsed.ok) { ai.state = "invalid"; ai.say = "AI's answer could not be read (not in the agreed form): " + STANDS + " Cost " + inrStr(ai.inr) + "."; return { ai, ...none }; }
  // the code's check: only what passes goes back
  const chk = tmAiCheck(parsed, rows, chs, opt), keep = (s: any) => s;
  const same = (a: string[], b: string[]) => a.slice().sort().join(",") === b.slice().sort().join(",");
  const pairs = parsed.pairs.filter((p: any) => chk.sugg.some((s: any) => s.rule === "g" && s.chId === p.chId && same(s.ids, p.ids))).map(keep);
  const splits = parsed.splits.filter((p: any) => chk.sugg.some((s: any) => s.rule === "split" && s.ids[0] === p.rowId)).map(keep);
  const interest = (parsed.interest || []).filter((p: any) => chk.sugg.some((s: any) => s.rule === "int" && s.chId === p.chId)).map(keep);
  ai.state = "used"; ai.bad = parsed.bad; ai.dropped = chk.dropped;
  const n = pairs.reduce((a: number, p: any) => a + p.ids.length, 0) + splits.length;
  ai.say = "AI looked at the " + inp.d.length + " deductions the rules left: " + n + " suggested" + (splits.length ? " (" + splits.length + " split" + (splits.length === 1 ? "" : "s") + ")" : "") +
    (ai.bad + ai.dropped ? ", " + (ai.bad + ai.dropped) + " of its pairings refused by the checks" : "") + (ai.notSent ? "; " + ai.notSent + " not sent (over the limit)" : "") + " · cost " + inrStr(ai.inr);
  return { ai, pairs, splits, interest };
}
