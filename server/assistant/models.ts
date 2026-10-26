// Which Claude model answers what, at what effort and length, and what each call costs (the owner's choices of 13-Oct-2026).
//   - Haiku 5.5 only picks a book tool and fills its parameters, when the keyword router (router.ts) cannot. It never
//     reasons about tax, never drafts and never answers from the Day Book; its text is thrown away.
//   - Sonnet 5.5 for everyday chat: book questions, general tax questions, files.
//   - Opus 5.5 at high effort for the heavy work: notices (summary, check, reply, attachments, case law) and, in later
//     steps, the audit, 3CD, Schedule III and DCF.
// Thinking is adaptive on all three (neither Sonnet 5.5 nor Opus 5.5 can switch it off; Haiku is only routing, at low
// effort). The server-side refusal fallback ("default") is on for Sonnet and Opus; Haiku has none (the API rejects it).
// Plain module: no Deno; its one import is the router's law rule (also plain).
import { lawQuestion } from "./router.ts";

export type Task = "route" | "book" | "general" | "file" | "notice" | "heavy";
export type Plan = { task: Task, model: string, effort: "low" | "medium" | "high", maxTokens: number, fallbacks: boolean, feature: string, web: boolean };

export const HAIKU = "claude-haiku-5-5", SONNET = "claude-sonnet-5-5", OPUS = "claude-opus-5-5";

// US dollars per million tokens (platform.claude.com pricing as of Oct 2026): input, output, cache read; a 1-hour cache
// write is 2x input, a 5-minute one 1.25x. Web search: $10 per 1,000 searches.
export const PRICES: Record<string, { in: number, out: number, read: number }> = {
  [HAIKU]: { in: 0.10, out: 0.50, read: 0.01 },
  [SONNET]: { in: 2, out: 10, read: 0.20 },
  [OPUS]: { in: 4, out: 20, read: 0.20 },
};
export const WEB_SEARCH_USD = 0.01;

// The user asked for a long answer (the owner, 15-Oct-2026: "should not be so long until asked specifically in detail"):
// these words, or a draft, letter, reply or notice, which keep their own length. Without them an answer is short.
export const DETAIL = /\b(in (full )?details?|detailed|details of|full (details?|answer|explanation|working|note)|in full|explain (it |this |that )?(fully|in full|everything|more|properly)|elaborate|step[- ]by[- ]step|steps to|comprehensive|thorough(ly)?|tell me more|more details?|long answer|draft|letter|reply|replies|notice|memo|write[- ]up|essay|summary of the law)\b/i;
export const detailAsked = (q: string): boolean => DETAIL.test(String(q || ""));

// A short answer (book and general chat when no detail is asked): Sonnet at low effort and max_tokens 4000. max_tokens
// counts adaptive thinking as well as the words; at low effort the thinking is short, and five lines are ~200 tokens, so
// 4000 leaves room for both and for a tool call's input. An answer that still reaches the limit is ended at its last whole
// sentence, or asked once more at the full limit when the thinking used it all (agent.ts).
export const BRIEF_MAX_TOKENS = 4000;

// the chat effort can be lowered (or raised) for the whole platform without a release: ASSISTANT_CHAT_EFFORT=low
export function plan(task: Task, chatEffort: string = "medium", brief = false): Plan {
  const ce = (chatEffort === "low" || chatEffort === "high" ? chatEffort : "medium") as Plan["effort"];
  switch (task) {
    case "route": return { task, model: HAIKU, effort: "low", maxTokens: 1024, fallbacks: false, feature: "routing", web: false };
    case "book": return { task, model: SONNET, effort: brief ? "low" : ce, maxTokens: brief ? BRIEF_MAX_TOKENS : 6000, fallbacks: true, feature: "book", web: false };
    case "general": return { task, model: SONNET, effort: brief ? "low" : ce, maxTokens: brief ? BRIEF_MAX_TOKENS : 6000, fallbacks: true, feature: "general", web: true };
    case "file": return { task, model: SONNET, effort: ce, maxTokens: 12000, fallbacks: true, feature: "file", web: false };
    case "notice": return { task, model: OPUS, effort: "high", maxTokens: 32000, fallbacks: true, feature: "notice", web: true };
    case "heavy": return { task, model: OPUS, effort: "high", maxTokens: 32000, fallbacks: true, feature: "heavy", web: true };
  }
}

// what kind of work a question is (decided from its words and attachments; the user is never asked)
// uploadKind: what the Upload found the attached file to be (a notice when not said: the notice flow as before); any
// other upload is asked about as a file (Sonnet), not as a notice (Opus at high effort)
export function taskOf(question: string, hasAttachment: boolean, clientOpen: boolean, uploadKind?: string): Task {
  const q = String(question || "");
  if (hasAttachment && uploadKind && uploadKind !== "notice" && !/\b(notice|show cause|intimation|demand order)\b/i.test(q)) return "file";
  if (hasAttachment || /\b(notice|show cause|scn|asmt-?10|drc-?0?1a?|reg-?(17|31)|143\s*\(\s*[12]|148a?|133\s*\(\s*6|intimation|demand order|justification report|penalty u\/?s)\b/i.test(q)) return "notice";
  if (clientOpen && /\bwhat('s| is) due\b/i.test(q)) return "book";     // the client's own dues
  if (lawQuestion(q)) return "general";                    // the router's own rule (a due date, a rate, a return's date)
  if (/\b(audit the books|tax audit report|3cd|schedule iii|schedule 3|dcf|valuation)\b/i.test(q)) return "heavy";
  if (/\b(excel|xlsx|spreadsheet|word|docx|pdf|download|letter|file of)\b/i.test(q)) return "file";
  if (!clientOpen) return "general";
  // with a client open, a question about the law (rates, sections, due dates) and not the books is general
  if (/\b(rate|section|due dates?|last dates?|limit|threshold|applicable|what is|how to|treatment|circular|notification|act,? 20(25|17)|new act|old act)\b/i.test(q) &&
      !/\b(my|our|we|us|this client|books?|ledgers?|paid|received|entries|suppliers?|customers?|parties|balances?|total|how much|which|list|payments?|receipts?|sales|purchases?|expenses?|bank|cash|deducted|anyone|who)\b/i.test(q)) return "general";
  return "book";
}

export type Usage = { input_tokens?: number, output_tokens?: number, cache_read_input_tokens?: number, cache_creation_input_tokens?: number,
  cache_creation?: { ephemeral_5m_input_tokens?: number, ephemeral_1h_input_tokens?: number }, server_tool_use?: { web_search_requests?: number, web_fetch_requests?: number } };

// one call's cost in dollars from its usage
export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model] || PRICES[OPUS];
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? (u.cache_creation ? 0 : (u.cache_creation_input_tokens || 0));
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const usd = ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out + (u.cache_read_input_tokens || 0) * p.read + w1h * p.in * 2 + w5m * p.in * 1.25) / 1e6
    + (u.server_tool_use?.web_search_requests || 0) * WEB_SEARCH_USD;
  return Math.round(usd * 1e6) / 1e6;
}

// the firm's AI cost limit (migration 96, the owner's decision of 17-Oct-2026): the rupees are a calendar month's (India's
// date), the count of calls (daily_calls) a day's. `why` is asst_cap_take's: "calls" for the day's count, else the rupees.
export const rupees = (v: number): string => {
  const s = String(Math.round(Math.abs(Number(v) || 0))), last = s.slice(-3), rest = s.slice(0, -3);
  return "₹" + (Number(v) < 0 ? "-" : "") + (rest ? rest.replace(/\B(?=(\d{2})+$)/g, ",") + "," : "") + last;
};
// Migration 109 (the owner's approval of 26-Oct-2026): AI use is charged to the firm's wallet; "balance" is a wallet below
// the platform's minimum, "off" the AI module switched off for the firm by FinCom. The owner may only lower the limit.
export const AI_NO_CREDIT = "The firm's credit has run out, so new AI answers are paused. Ask the administrator to add credit; everything already in FinCom still works.";
export const AI_OFF = "AI help is switched off for your firm's account. Ask FinCom to switch it on.";
export function capWords(why: string | undefined, capInr: number, calls: number): string {
  if (why === "balance") return AI_NO_CREDIT;
  if (why === "off") return AI_OFF;
  return why === "calls" ? "Your firm has used today's " + (Number(calls) || 0) + " AI calls. It starts again at midnight (India time)."
    : "Your firm has used this month's " + rupees(capInr) + " for AI answers. New AI answers start again on the 1st of next month (India time). To raise the limit, ask FinCom.";
}
// the words for a match (2B, TDS challans) or a call summary stopped before its AI step
export function aiStopWords(why: string | undefined): string {
  return why === "balance" ? "The firm's credit has run out, so the AI step is paused: " : why === "off" ? "AI help is switched off for the firm: "
    : why === "calls" ? "The firm's AI calls for today are used up: " : "The firm's AI budget for this month is used up: ";
}
