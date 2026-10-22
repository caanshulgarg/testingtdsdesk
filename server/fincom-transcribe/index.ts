// fincom-transcribe: clearer listening for FinCom's voice typing (the owner, 22-Oct-2026: listening "very poor; make it
// best"; his choice: Groq's free Whisper, with the browser's own listening as the backup). The app records what is said
// (app/src/parts/VoiceRecorder.js) while the browser shows live words; when the person stops, the clip comes here and
// Whisper's words replace the browser's. On any failure the app keeps the browser's words.
//   POST the audio itself (Content-Type audio/webm, audio/ogg, audio/mp4 or audio/wav; at most 5 MB and 60 s), with
//     ?lang=hi|en|auto (auto: Hinglish and the other languages), &secs=<the clip's length>, &client=<the open client>
//     -> {ok: true, text, ms} | {ok: false, kind: "nokey" | "limit" | "error" | "size" | "length" | "auth" | ...}
//   POST {"action": "usage"} -> {ok, firm_secs, all_secs (the platform administrator only), key: is a key set}
// Who: as fincom-assistant: the signed-in user's token, their two-step sign-in, an active member of a firm whose owner
// has not switched AI help off; a client must be one of that firm's (read with the user's own token: row-level security).
// Words prompt (Whisper reads up to about 224 tokens of it): the firm's words (Tally, GST, ...) and the client's own
// biggest ledger and party names, read from tally_ledgers for that client's books in the caller's firm only.
// Groq's key is the platform's (platform_secrets "groq_api_key", set in Settings > Platform > Keys with admin_set_secret
// as the Claude key is), read with the service role, sent only to Groq. The audio and the words are never stored or
// logged: one usage row only (assistant_log: feature "voice", route the language, ms the audio's length, tools ["ok"] or
// why not, question empty).
import { corsFor } from "../_shared/cors.ts";

export type Env = (k: string) => string | undefined;
export type Deps = { env: Env, fetch: typeof fetch };

export const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const MODEL = "whisper-large-v3-turbo";
const MAX_BYTES = 5 * 1024 * 1024, MAX_SECS = 60;
const LANGS = new Set(["hi", "en", "auto"]);
// what the recorder sends -> the file name Groq is given (Safari's mp4/aac as m4a)
const TYPES: Record<string, string> = {
  "audio/webm": "webm", "video/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "video/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
  "audio/aac": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav",
};
export const FIRM_WORDS = ["Tally", "GST", "GSTR-1", "GSTR-3B", "TDS", "TCS", "ledger", "voucher", "invoice", "debit", "credit", "lakh", "crore", "rupees", "₹"];
const PROMPT_CHARS = 640;   // about 200 tokens

// the words prompt: the firm's words, then names (biggest first) while they fit
export function buildPrompt(names: string[]): string {
  let p = FIRM_WORDS.join(", ") + ".";
  const seen = new Set<string>();
  for (const raw of names) {
    const n = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const k = n.toLowerCase();
    if (!n || seen.has(k) || !/[a-zऀ-ॿ]{2}/i.test(n)) continue;
    if (p.length + n.length + 2 > PROMPT_CHARS) { if (p.length > PROMPT_CHARS - 12) break; continue; }
    seen.add(k); p += " " + n + ",";
  }
  return p.replace(/,$/, ".");
}

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
  const groqKey = async () => { try { const k = (await rest("/rest/v1/platform_secrets?select=value&name=eq.groq_api_key", SERVICE)) as any[]; return String((k && k[0] && k[0].value) || ""); } catch { return ""; } };

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
    if (!LANGS.has(lang)) { await drop(); return reply(400, { ok: false, kind: "lang", error: "The language must be hi, en or auto." }); }
    const secs = Math.max(0, Number(u.searchParams.get("secs")) || 0);
    if (secs > MAX_SECS) { await drop(); return reply(413, { ok: false, kind: "length", error: "A clip may be at most 60 seconds." }); }
    if (Number(req.headers.get("Content-Length") || 0) > MAX_BYTES) { await drop(); return reply(413, { ok: false, kind: "size", error: "A clip may be at most 5 MB." }); }
    const audio = new Uint8Array(await req.arrayBuffer());
    if (audio.length > MAX_BYTES) return reply(413, { ok: false, kind: "size", error: "A clip may be at most 5 MB." });
    if (!audio.length) return reply(400, { ok: false, kind: "empty", error: "No audio was sent." });
    // the client: one of the firm's (read as the user: row-level security)
    const clientId = u.searchParams.get("client") ? String(u.searchParams.get("client")).slice(0, 120) : null;
    const names: string[] = [];
    if (clientId) {
      const c = (await rest("/rest/v1/clients?select=id,name,deleted&id=eq." + encodeURIComponent(clientId), jwt).catch(() => [])) as any[];
      if (!c || !c.length || c[0].deleted) return reply(403, { ok: false, kind: "client", error: "This client is not one of your firm's." });
      names.push(String(c[0].name || ""));
      // its ledgers and parties, the biggest first (the caller's firm only; never a deleted or merged one)
      try {
        const books = ((await rest("/rest/v1/tally_books?select=book_id&firm_id=eq." + firm + "&client_id=eq." + encodeURIComponent(clientId), SERVICE)) as any[] || []).map((b) => String(b.book_id)).filter((b) => /^[0-9a-f-]{36}$/i.test(b));
        if (books.length) {
          const ls = (await rest("/rest/v1/tally_ledgers?select=name,primary_group,open&firm_id=eq." + firm + "&book_id=in.(" + books.join(",") + ")&deleted_at=is.null&merged_into=is.null&limit=5000", SERVICE)) as any[] || [];
          ls.sort((a, b) => Math.abs(Number(b.open) || 0) - Math.abs(Number(a.open) || 0));
          for (const l of ls) names.push(String(l.name || ""));
        }
      } catch { /* the firm's words alone */ }
    }
    const log = (status: string) => rest("/rest/v1/assistant_log", SERVICE, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({
      firm_id: firm, user_id: user.id, client_id: clientId, question: "", tools: [status], calls: status === "nokey" ? 0 : 1, ms: Math.round(Math.min(secs, MAX_SECS) * 1000),
      feature: "voice", route: lang, models: [MODEL] }) }).catch(() => null);

    const key = await groqKey();
    if (!key) { await log("nokey"); return reply(503, { ok: false, kind: "nokey", error: "Clearer listening is not set up yet." }); }
    const form = new FormData();
    form.append("file", new File([audio], "clip." + ext, { type: type === "video/webm" ? "audio/webm" : type }));
    form.append("model", MODEL);
    form.append("temperature", "0");
    form.append("response_format", "json");
    if (lang !== "auto") form.append("language", lang);
    form.append("prompt", buildPrompt(names));
    let r: Response;
    try { r = await doFetch(GROQ_URL, { method: "POST", headers: { Authorization: "Bearer " + key }, body: form, signal: AbortSignal.timeout(45_000) }); }
    catch { await log("error"); return reply(502, { ok: false, kind: "error", error: "Clearer listening could not be reached." }); }
    if (r.status === 429) { await r.body?.cancel(); await log("limit"); return reply(429, { ok: false, kind: "limit", error: "Today's limit for clearer listening is reached." }); }
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j || typeof j.text !== "string") { await log("error"); return reply(502, { ok: false, kind: "error", error: "Clearer listening did not answer (" + r.status + ")." }); }
    await log("ok");
    return reply(200, { ok: true, text: j.text.replace(/\s+/g, " ").trim(), ms: Date.now() - t0 });
  };
}

export function main() {
  Deno.serve(handler({ env: (k) => Deno.env.get(k), fetch: (...a) => fetch(...a) }));
}
if (import.meta.main) main();
