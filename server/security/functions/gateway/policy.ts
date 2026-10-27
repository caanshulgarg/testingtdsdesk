// What the gateway lets through to Claude, and what a read costs (security review 27-Oct-2026, F6: the caller chose
// the model, max_tokens up to 16,000, a 20,000-character system prompt, any messages and the quantity, and paid one
// bill read whatever it used). Now the server decides:
//   - the model: only the ones the app sends (src/js/01-documents-in-the-firm-account.js API_DEFAULTS: Sonnet 5 for a
//     read, Opus 5 for the careful re-read; Sonnet 4.6 is the app's fallback name). Anything else is refused.
//   - max_tokens: MAX_OUT whatever the caller asks (the longest answers the app asks for, a bank statement page's rows
//     or 50 ledgers with reasons, fit well within it).
//   - the input: one user message of at most MAX_IMAGES base64 images (jpeg/png/webp/gif, each at most MAX_IMAGE_B64
//     characters, the Claude API's own 5 MB limit) and text blocks of at most MAX_TEXT characters in all (the app's
//     longest prompt, the bill prompt with 14,000 characters of PDF text or 400 ledger names, is about 40,000). No
//     system prompt, no tools, no other field.
//   - the charge: units of one bill read (UNIT_USD, about what a normal Sonnet 5 bill read costs the platform). Before
//     the call the model's reserve is charged (Opus 2, the others 1); after it, the real usage the API returns
//     (input, cache and output tokens times the model's price) decides the units, and any units above the reserve are
//     charged then.
export const MODELS: Record<string, { inUsd: number, outUsd: number, reserve: number }> = {
  // US dollars per million tokens (Anthropic's list prices)
  "claude-sonnet-5": { inUsd: 2, outUsd: 10, reserve: 1 },
  "claude-sonnet-4-6": { inUsd: 3, outUsd: 15, reserve: 1 },
  "claude-opus-5": { inUsd: 5, outUsd: 25, reserve: 2 },
};
export const MAX_OUT = 8000;
export const MAX_IMAGES = 6;
export const MAX_IMAGE_B64 = 5 * 1024 * 1024;
export const MAX_TEXT = 60_000;
export const MAX_BODY = 25 * 1024 * 1024;
export const UNIT_USD = 0.05;
export const MAX_UNITS = 40;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type Built = { ok: true, payload: { model: string, max_tokens: number, messages: unknown[] } } | { ok: false, kind: string, why: string };

// the caller's payload -> the request sent to Claude, built from scratch (only the fields above), or why not
export function buildClaude(p: any): Built {
  const model = String(p?.model || "");
  if (!Object.prototype.hasOwnProperty.call(MODELS, model)) return { ok: false, kind: "bad_model", why: "model" };
  const msgs = p?.messages;
  if (!Array.isArray(msgs) || msgs.length !== 1 || msgs[0]?.role !== "user") return { ok: false, kind: "other", why: "messages" };
  let content = msgs[0].content;
  if (typeof content === "string") content = [{ type: "text", text: content }];
  if (!Array.isArray(content) || !content.length) return { ok: false, kind: "other", why: "content" };
  const out: unknown[] = [];
  let images = 0, text = 0;
  for (const b of content) {
    if (b?.type === "text" && typeof b.text === "string") {
      text += b.text.length;
      if (text > MAX_TEXT) return { ok: false, kind: "too_large", why: "text" };
      out.push({ type: "text", text: b.text });
    } else if (b?.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string" && IMAGE_TYPES.has(String(b.source.media_type))) {
      if (++images > MAX_IMAGES) return { ok: false, kind: "too_large", why: "images" };
      if (b.source.data.length > MAX_IMAGE_B64) return { ok: false, kind: "too_large", why: "image" };
      out.push({ type: "image", source: { type: "base64", media_type: b.source.media_type, data: b.source.data } });
    } else return { ok: false, kind: "other", why: "block" };
  }
  if (!text) return { ok: false, kind: "other", why: "no_text" };
  return { ok: true, payload: { model, max_tokens: MAX_OUT, messages: [{ role: "user", content: out }] } };
}

// the API's usage -> US dollars at the model's price (cache writes at 1.25 times, cache reads at 0.1 times the input price)
export function costUsd(model: string, u: any): number {
  const m = MODELS[model];
  if (!m) return 0;
  const n = (x: unknown) => Math.max(0, Number(x) || 0);
  const input = n(u?.input_tokens) + 1.25 * n(u?.cache_creation_input_tokens) + 0.1 * n(u?.cache_read_input_tokens);
  return (input * m.inUsd + n(u?.output_tokens) * m.outUsd) / 1_000_000;
}

// the units one call costs: never less than the model's reserve; usage missing -> the reserve
export function unitsFor(model: string, usage: any): number {
  const m = MODELS[model];
  if (!m) return 0;
  const u = Math.ceil(costUsd(model, usage) / UNIT_USD - 1e-9);
  return Math.min(MAX_UNITS, Math.max(m.reserve, u));
}
