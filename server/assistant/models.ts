// Which Claude model answers what, at what effort and length, and what each call costs (the owner's choices of 13-Oct-2026).
//   - Haiku 5.5 only picks a book tool and fills its parameters, when the keyword router (router.ts) cannot. It never
//     reasons about tax, never drafts and never answers from the Day Book; its text is thrown away.
//   - Sonnet 5.5 for everyday chat: book questions, general tax questions, files.
//   - Opus 5.5 at high effort for the heavy work: notices (summary, check, reply, attachments, case law) and, in later
//     steps, the audit, 3CD, Schedule III and DCF.
// Thinking is adaptive on all three (neither Sonnet 5.5 nor Opus 5.5 can switch it off; Haiku is only routing, at low
// effort). The server-side refusal fallback ("default") is on for Sonnet and Opus; Haiku has none (the API rejects it).
// Plain module: no Deno, no imports.

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

// the chat effort can be lowered (or raised) for the whole platform without a release: ASSISTANT_CHAT_EFFORT=low
export function plan(task: Task, chatEffort: string = "medium"): Plan {
  const ce = (chatEffort === "low" || chatEffort === "high" ? chatEffort : "medium") as Plan["effort"];
  switch (task) {
    case "route": return { task, model: HAIKU, effort: "low", maxTokens: 1024, fallbacks: false, feature: "routing", web: false };
    case "book": return { task, model: SONNET, effort: ce, maxTokens: 6000, fallbacks: true, feature: "book", web: false };
    case "general": return { task, model: SONNET, effort: ce, maxTokens: 6000, fallbacks: true, feature: "general", web: true };
    case "file": return { task, model: SONNET, effort: ce, maxTokens: 12000, fallbacks: true, feature: "file", web: false };
    case "notice": return { task, model: OPUS, effort: "high", maxTokens: 32000, fallbacks: true, feature: "notice", web: true };
    case "heavy": return { task, model: OPUS, effort: "high", maxTokens: 32000, fallbacks: true, feature: "heavy", web: true };
  }
}

// what kind of work a question is (decided from its words and attachments; the user is never asked)
export function taskOf(question: string, hasAttachment: boolean, clientOpen: boolean): Task {
  const q = String(question || "");
  if (hasAttachment || /\b(notice|show cause|scn|asmt-?10|drc-?0?1a?|reg-?(17|31)|143\s*\(\s*[12]|148a?|133\s*\(\s*6|intimation|demand order|justification report|penalty u\/?s)\b/i.test(q)) return "notice";
  if (/\b(audit the books|tax audit report|3cd|schedule iii|schedule 3|dcf|valuation)\b/i.test(q)) return "heavy";
  if (/\b(excel|xlsx|spreadsheet|word|docx|pdf|download|letter|file of)\b/i.test(q)) return "file";
  if (!clientOpen) return "general";
  // with a client open, a question about the law (rates, sections, due dates) and not the books is general
  if (/\b(rate|section|due date|limit|threshold|applicable|what is|how to|treatment|circular|notification|act,? 20(25|17)|new act|old act)\b/i.test(q) &&
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
