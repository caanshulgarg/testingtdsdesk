// fincom-transcribe: clearer listening for FinCom's voice typing (the owner, 22-Oct-2026: listening "very poor; make it
// best"; his choice: Groq's free Whisper, with the browser's own listening as the backup). The app records what is said
// (app/src/parts/VoiceRecorder.js) while the browser shows live words; when the person stops, the clip comes here and
// Whisper's words replace the browser's. On any failure the app keeps the browser's words.
//   POST the audio itself (Content-Type audio/webm, audio/ogg, audio/mp4 or audio/wav; at most 5 MB and 60 s), with
//     ?lang=hi|en|auto (auto: Hinglish and the other languages), &latin=1 (Hinglish: the words in English letters),
//     &secs=<the clip's length>, &client=<the open client>
//     -> {ok: true, text, changes: [{from, to}], model, ms} | {ok: false, kind: "nokey" | "limit" | "error" | "size" | ...}
//   POST {"action": "usage"} -> {ok, firm_secs, all_secs (the platform administrator only), key: is a key set}
// Who: as fincom-assistant: the signed-in user's token, their two-step sign-in, an active member of a firm whose owner
// has not switched AI help off; a client must be one of that firm's (read with the user's own token: row-level security).
// The model (the owner, 22-Oct-2026: voice "still not good", wrong words and wrong names): Whisper large-v3, the full
// model, for a clip under 30 s; turbo for a longer one, and when Groq says 429 for large-v3 (both are on Groq's free
// tier, each with its own limits: about 20 a minute, 2,000 a day, 2 hours of audio an hour).
// Words prompt (Whisper reads up to about 224 tokens of it, and copies its style): a short sample sentence in the chosen
// style (Hinglish in English letters, English, or Hindi) made of the client's own biggest ledger and party names and the
// firm's words (Tally, GST, TDS 194J, ...), then more names; read from tally_ledgers for that client's books in the
// caller's firm only. For Hinglish an answer mostly in Devanagari is written in English letters (names.ts, toLatin).
// Names corrected (names.ts): each run of 1-4 words is matched against the client's ledger and party names and the
// firm's client names; replaced only on a confident, unique match; the changes go back as {from, to} for the app to show
// (underlined, with one tap to undo). When some name was near but not sure, one cheap AI call (the routing model of
// FinCom Assistant, under the firm's AI switch and rupee cap) may fix names and the firm's words only; its answer is
// refused when any number or any other word changed. Only those near names go with the words (never the whole list),
// and never words with a PAN, GSTIN, Aadhaar, TAN or phone number.
// Groq's key is the platform's (platform_secrets "groq_api_key", set in Settings > Platform > Keys with admin_set_secret
// as the Claude key is), read with the service role, sent only to Groq. The audio and the words are never stored or
// logged: one usage row only (assistant_log: feature "voice", route the language, ms the audio's length, tools ["ok"] or
// why not, with "names:<count of names corrected>" and "ai:<count>" or "ai:refused" (counts only, never the words), the
// models used, question empty).
import { corsFor } from "../_shared/cors.ts";
import { checkAiFix, correctNames, devanagariShare, diffWords, FIRM_ALIASES, Name, toLatin } from "./names.ts";
import { costUsd, HAIKU } from "../assistant/models.ts";
import { ID_PATTERNS } from "../assistant/mask.ts";

export type Env = (k: string) => string | undefined;
export type Deps = { env: Env, fetch: typeof fetch };

export const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const MODEL = "whisper-large-v3-turbo";       // a long clip, and when large-v3 is at its limit
export const MODEL_FULL = "whisper-large-v3";        // a clip under FULL_SECS: the full model, the clearest
export const FULL_SECS = 30;
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_BYTES = 5 * 1024 * 1024, MAX_SECS = 60;
const LANGS = new Set(["hi", "en", "auto"]);
// what the recorder sends -> the file name Groq is given (Safari's mp4/aac as m4a)
const TYPES: Record<string, string> = {
  "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "video/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
  "audio/aac": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
};
export const FIRM_WORDS = ["Tally", "GST", "GSTR-1", "GSTR-3B", "TDS", "TCS", "ledger", "voucher", "invoice", "debit", "credit", "lakh", "crore", "rupees", "₹"];
const PROMPT_CHARS = 640;   // about 200 tokens

export type Style = "hinglish" | "en" | "hi" | "list";
const BANK = /\bbank\b/i, PARTY = /sundry|debtor|creditor|customer|supplier|vendor/i;
const DEVA = /[\u0900-\u097F]/;
// the words prompt: a short sample sentence in the chosen style, made of the client's own names and the firm's words,
// then more names (biggest first) while they fit. Hinglish and English: names in English letters only.
export function buildPrompt(names: Name[], style: Style = "list"): string {
  const seen = new Set<string>(), list: { name: string, group: string }[] = [];
  for (const raw of names) {
    const n = String(typeof raw === "string" ? raw : (raw && raw.name) || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const k = n.toLowerCase();
    if (!n || seen.has(k) || !/[a-z\u0900-\u097F]{2}/i.test(n)) continue;
    if (style !== "list" && style !== "hi" && DEVA.test(n)) continue;
    seen.add(k); list.push({ name: n, group: typeof raw === "string" ? "" : String(raw.group || "") });
  }
  if (style === "list") {
    let p = FIRM_WORDS.join(", ") + ".";
    for (const { name: n } of list) {
      if (p.length + n.length + 2 > PROMPT_CHARS) { if (p.length > PROMPT_CHARS - 12) break; continue; }
      p += " " + n + ",";
    }
    return p.replace(/,$/, ".");
  }
  // the sample sentence: the client (the first name), a bank, a party
  const used = new Set<string>();
  const take = (f: (x: { name: string, group: string }) => boolean) => { const x = list.find((y) => !used.has(y.name) && f(y)); if (x) used.add(x.name); return x ? x.name : ""; };
  const client = take(() => true), bank = take((x) => BANK.test(x.name)), party = take((x) => PARTY.test(x.group)) || take((x) => !BANK.test(x.name));
  const S = {
    hinglish: [(client || "Client") + " ke liye " + (bank || "bank") + " se " + (party || "party") + " ko 1 lakh 25 hazaar rupees ka payment, TDS 194J kata, GSTR-1 aur GSTR-3B file karna hai, Tally mein voucher entry karo.",
      " Ledger, invoice, debit, credit, GST, TCS, 2 crore:"],
    en: ["For " + (client || "the client") + ", a payment of 1 lakh 25 thousand rupees from " + (bank || "the bank") + " to " + (party || "the party") + ", TDS 194J deducted; file GSTR-1 and GSTR-3B, and pass the voucher entry in Tally.",
      " Ledger, invoice, debit, credit, GST, TCS, 2 crore:"],
    hi: [(client || "क्लाइंट") + " के लिए " + (bank || "बैंक") + " से " + (party || "पार्टी") + " को 1 लाख 25 हज़ार rupees का payment, TDS 194J कटा, GSTR-1 और GSTR-3B file करना है, Tally में voucher entry करो।",
      " Ledger, invoice, debit, credit, GST, TCS, 2 crore, lakh:"],
  }[style];
  let p = S[0] + S[1];
  for (const { name: n } of list) {
    if (used.has(n)) continue;
    if (p.length + n.length + 2 > PROMPT_CHARS) { if (p.length > PROMPT_CHARS - 12) break; continue; }
    p += " " + n + ",";
  }
  return p.replace(/[,:]$/, ".");
}

// the optional AI step: only names and the firm's words; the answer is the corrected words alone
export const AI_SYSTEM = "You correct a speech-to-text transcript for an Indian accountant. The person speaks Hinglish, Hindi or English. " +
  "Fix only misheard names (use the candidate names given, spelled exactly as given) and misheard accounting words (Tally, GST, GSTR-1, GSTR-3B, TDS, TCS, ledger, voucher, invoice, lakh, crore). " +
  "Never change, add or remove a number, an amount or a date, never translate, never rephrase, never change the meaning, and keep the script as it is. " +
  "When unsure, leave the word as it is. Reply with the corrected transcript only, nothing else.";

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch;
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || ""), ANON = String(env("SUPABASE_ANON_KEY") || "");
  const rest = async (path: string, token: string, init: RequestInit = {}) => {
    const r = await doFetch(URL_ + path, { ...init, headers: { apikey: token === SERVICE ? SERVICE : ANON, Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
    const t = await r.text();
    let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status });
    return j;
  };
  const rpc = (fn: string, args: Record<string, unknown>, token: string) => rest("/rest/v1/rpc/" + fn, token, { method: "POST", body: JSON.stringify(args) });
  const secret = async (name: string) => { try { const k = (await rest("/rest/v1/platform_secrets?select=value&name=eq." + name, SERVICE)) as any[]; return String((k && k[0] && k[0].value) || ""); } catch { return ""; } };
  const groqKey = () => secret("groq_api_key");
  // one Groq call; -> the Response, or null when Groq could not be reached
  const groq = async (key: string, model: string, audio: BlobPart, ext: string, type: string, lang: string, prompt: string) => {
    const form = new FormData();
    form.append("file", new File([audio], "clip." + ext, { type: type === "video/webm" ? "audio/webm" : type }));
    form.append("model", model);
    form.append("temperature", "0");
    form.append("response_format", "json");
    if (lang !== "auto") form.append("language", lang);
    form.append("prompt", prompt);
    try { return await doFetch(GROQ_URL, { method: "POST", headers: { Authorization: "Bearer " + key }, body: form, signal: AbortSignal.timeout(45_000) }); }
    catch { return null; }
  };

  return async (req: Request): Promise<Response> => {
    const cors = corsFor(req);
    const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
    const t0 = Date.now();
    const drop = async () => { try { await req.body?.cancel(); } catch { /* already read */ } };
    // who: as fincom-assistant
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt || jwt === ANON) { await drop(); return reply(401, { ok: false, kind: "auth", error: "Sign in to the firm account first." }); }
    let user: any;
    try { user = await rest("/auth/v1/user", jwt); } catch { await drop(); return reply(401, { ok: false, kind: "auth", error: "Sign in again." }); }
    if (!user?.id) { await drop(); return reply(401, { ok: false, kind: "auth", error: "Sign in again." }); }
    try { if ((await rpc("mfa_ok", {}, jwt)) !== true) { await drop(); return reply(403, { ok: false, kind: "mfa", error: "Finish the two-step sign-in first." }); } }
    catch { await drop(); return reply(403, { ok: false, kind: "mfa", error: "Finish the two-step sign-in first." }); }
    const mem = (await rest("/rest/v1/members?select=firm_id,role,active&user_id=eq." + encodeURIComponent(user.id), SERVICE).catch(() => [])) as any[];
    const member = (mem || []).find((m) => m.active);
    if (!member) { await drop(); return reply(403, { ok: false, kind: "firm", error: "This account is not part of a firm." }); }
    const firm = String(member.firm_id);
    const setRows = await rest("/rest/v1/assistant_settings?select=enabled&firm_id=eq." + firm, SERVICE).catch(() => null) as any[] | null;
    if (setRows === null) { await drop(); return reply(503, { ok: false, kind: "other", error: "The firm's setting could not be read; try again in a moment." }); }
    if ((setRows[0] || { enabled: true }).enabled === false) { await drop(); return reply(403, { ok: false, kind: "off", error: "AI help is switched off for your firm." }); }

    const type = String(req.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
    // the minutes used today (India's day): the firm's, and all firms' for the platform administrator (Groq's free
    // allowance is the platform key's, about 8 hours of audio a day)
    if (type === "application/json") {
      let body: any = null; try { body = await req.json(); } catch { /* below */ }
      if (body?.action !== "usage") return reply(400, { ok: false, error: "Unknown request" });
      const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      const since = new Date(Date.parse(day + "T00:00:00Z") - 330 * 60_000).toISOString();
      const sum = (rows: any[]) => Math.round((rows || []).reduce((s, r) => s + Number(r.ms || 0), 0) / 1000);
      const q = "/rest/v1/assistant_log?select=firm_id,ms&feature=eq.voice&at=gte." + encodeURIComponent(since);
      try {
        const mine = (await rest(q + "&firm_id=eq." + firm, SERVICE)) as any[];
        const admin = (await rpc("is_superadmin", {}, jwt).catch(() => false)) === true;
        const all = admin ? sum((await rest(q, SERVICE)) as any[]) : undefined;
        return reply(200, { ok: true, firm_secs: sum(mine), all_secs: all, key: !!(await groqKey()) });
      } catch { return reply(503, { ok: false, kind: "other", error: "The minutes used could not be read." }); }
    }

    // the clip
    const ext = TYPES[type];
    if (!ext) { await drop(); return reply(415, { ok: false, kind: "type", error: "Send the recording as webm, ogg, mp4 or wav." }); }
    const u = new URL(req.url);
    const lang = String(u.searchParams.get("lang") || "auto").toLowerCase();
    const latin = u.searchParams.get("latin") === "1" && lang === "auto";       // Hinglish: the words in English letters
    if (!LANGS.has(lang)) { await drop(); return reply(400, { ok: false, kind: "lang", error: "The language must be hi, en or auto." }); }
    const secs = Math.max(0, Number(u.searchParams.get("secs")) || 0);
    if (secs > MAX_SECS) { await drop(); return reply(413, { ok: false, kind: "length", error: "A clip may be at most 60 seconds." }); }
    if (Number(req.headers.get("Content-Length") || 0) > MAX_BYTES) { await drop(); return reply(413, { ok: false, kind: "size", error: "A clip may be at most 5 MB." }); }
    const audio = new Uint8Array(await req.arrayBuffer());
    if (audio.length > MAX_BYTES) return reply(413, { ok: false, kind: "size", error: "A clip may be at most 5 MB." });
    if (!audio.length) return reply(400, { ok: false, kind: "empty", error: "No audio was sent." });
    // the client: one of the firm's (read as the user: row-level security)
    const clientId = u.searchParams.get("client") ? String(u.searchParams.get("client")).slice(0, 120) : null;
    const names: Name[] = [], firmClients: string[] = [];
    if (clientId) {
      const c = (await rest("/rest/v1/clients?select=id,name,deleted&id=eq." + encodeURIComponent(clientId), jwt).catch(() => [])) as any[];
      if (!c || !c.length || c[0].deleted) return reply(403, { ok: false, kind: "client", error: "This client is not one of your firm's." });
      names.push(String(c[0].name || ""));
      // the firm's other clients (read as the user: row-level security), for the names said
      try { for (const x of ((await rest("/rest/v1/clients?select=name&deleted=not.is.true&limit=2000", jwt)) as any[] || [])) firmClients.push(String(x.name || "")); } catch { /* the client's own names */ }
      // its ledgers and parties, the biggest first (the caller's firm only; never a deleted or merged one)
      try {
        const books = ((await rest("/rest/v1/tally_books?select=book_id&firm_id=eq." + firm + "&client_id=eq." + encodeURIComponent(clientId), SERVICE)) as any[] || []).map((b) => String(b.book_id)).filter((b) => /^[0-9a-f-]{36}$/i.test(b));
        if (books.length) {
          const ls = (await rest("/rest/v1/tally_ledgers?select=name,primary_group,open&firm_id=eq." + firm + "&book_id=in.(" + books.join(",") + ")&deleted_at=is.null&merged_into=is.null&limit=5000", SERVICE)) as any[] || [];
          ls.sort((a, b) => Math.abs(Number(b.open) || 0) - Math.abs(Number(a.open) || 0));
          for (const l of ls) names.push({ name: String(l.name || ""), group: String(l.primary_group || "") });
        }
      } catch { /* the firm's words alone */ }
    }
    // the usage row: no words, only what happened (counts)
    const log = (status: string[], models: string[], calls: number, costInr = 0) => rest("/rest/v1/assistant_log", SERVICE, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
      firm_id: firm, user_id: user.id, client_id: clientId, question: "", tools: status, calls, ms: Math.round(Math.min(secs, MAX_SECS) * 1000),
      feature: "voice", route: lang, models, ...(costInr ? { cost_inr: costInr } : {}) }) }).catch(() => null);

    const key = await groqKey();
    if (!key) { await log(["nokey"], [MODEL], 0); return reply(503, { ok: false, kind: "nokey", error: "Clearer listening is not set up yet." }); }
    const style: Style = lang === "en" ? "en" : lang === "hi" ? "hi" : latin ? "hinglish" : "list";
    const prompt = buildPrompt(names, style);
    // the full model for a short clip; turbo for a long one, or when the full model is at its limit
    let model = secs > 0 && secs < FULL_SECS ? MODEL_FULL : MODEL;
    let r = await groq(key, model, audio, ext, type, lang, prompt);
    if (r && r.status === 429 && model === MODEL_FULL) { await r.body?.cancel(); model = MODEL; r = await groq(key, model, audio, ext, type, lang, prompt); }
    if (!r) { await log(["error"], [model], 1); return reply(502, { ok: false, kind: "error", error: "Clearer listening could not be reached." }); }
    if (r.status === 429) { await r.body?.cancel(); await log(["limit"], [model], 1); return reply(429, { ok: false, kind: "limit", error: "Today's limit for clearer listening is reached." }); }
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j || typeof j.text !== "string") { await log(["error"], [model], 1); return reply(502, { ok: false, kind: "error", error: "Clearer listening did not answer (" + r.status + ")." }); }
    let text = j.text.replace(/\s+/g, " ").trim();
    // Hinglish: an answer mostly in Devanagari, in English letters
    const tools = ["ok"];
    if (latin && devanagariShare(text) > 0.5) { text = toLatin(text); tools.push("latin"); }
    // the names said, made right (deterministic)
    const all: Name[] = [...names, ...firmClients];
    const fixed = correctNames(text, all);
    let changes = fixed.changes;
    text = fixed.text;
    tools.push("names:" + changes.length);
    const models = [model];
    let calls = 1, costInr = 0;
    // the optional AI step: some name near but not sure, the firm's AI switch on (checked above), within its rupee cap
    if (fixed.doubts.length && !ID_PATTERNS.some(([, re]) => { re.lastIndex = 0; const hit = re.test(text); re.lastIndex = 0; return hit; })) {
      const ai = await aiFix(text, fixed.doubts);
      if (ai.called) { calls++; models.push(HAIKU); costInr = ai.inr; }
      if (ai.text !== null) {
        const more = diffWords(text, ai.text);
        text = ai.text; changes = [...changes, ...more];
        tools.push("ai:" + more.length);
      } else if (ai.called) tools.push("ai:refused");
    }
    await log(tools, models, calls, costInr);
    return reply(200, { ok: true, text, changes, model, ms: Date.now() - t0 });

    // one cheap call: the words and the near names -> the corrected words, or null (refused, failed, over the cap)
    async function aiFix(words: string, near: string[]): Promise<{ text: string | null, called: boolean, inr: number }> {
      const none = { text: null, called: false, inr: 0 };
      const ckey = await secret("claude_api_key");
      if (!ckey) return none;
      const cap = await rpc("asst_cap_take", { p_firm: firm, p_n: 1 }, SERVICE).catch(() => null);
      if (!cap?.ok) return none;
      let msg: any;
      try {
        const res = await doFetch(ANTHROPIC_URL, { method: "POST", headers: { "x-api-key": ckey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: HAIKU, max_tokens: 600, system: AI_SYSTEM,
            messages: [{ role: "user", content: "Candidate names:\n" + near.map((n) => "- " + n).join("\n") + "\n\nTranscript:\n" + words }] }),
          signal: AbortSignal.timeout(10_000) });
        msg = await res.json().catch(() => null);
        if (!res.ok || !msg) return { ...none, called: true };
      } catch { return { ...none, called: true }; }
      const usd = costUsd(HAIKU, msg.usage || {});
      const added = await rpc("asst_cost_add", { p_firm: firm, p_feature: "voice_names", p_cost_usd: usd, p_in: msg.usage?.input_tokens || 0, p_out: msg.usage?.output_tokens || 0,
        p_cache_read: msg.usage?.cache_read_input_tokens || 0, p_cache_write: msg.usage?.cache_creation_input_tokens || 0 }, SERVICE).catch(() => null);
      const inr = Number(added?.inr || 0);
      const out = String((msg.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("")).replace(/\s+/g, " ").trim();
      const check = checkAiFix(words, out, [...near, ...Object.values(FIRM_ALIASES)]);
      return { text: check.ok && out !== words ? out : null, called: true, inr };
    }
  };
}

export function main() {
  Deno.serve(handler({ env: (k) => Deno.env.get(k), fetch: (...a) => fetch(...a) }));
}
if (import.meta.main) main();
