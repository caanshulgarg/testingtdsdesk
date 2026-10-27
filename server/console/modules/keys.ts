// API keys and integrations (Owner only; console-plan.md 3.9). Every platform key the server functions use, in one
// list: where it is kept, what stops if it fails, set or not (the last 4 characters of a key of 12 or more, never
// more), when it was last used (where FinCom can know it), the last Test, and its rotation.
//   store "table": platform_secrets (the functions read it with the service role). Replace: write-only, here.
//   store "vault": Supabase Vault through gsp_secret_put / gsp_secret_get (TaxPro's ASP id and password; gst-taxpro
//                  reads Vault first and its function secret only when Vault has none). Replace: write-only, here.
//   store "env":   a Supabase function secret (project-wide, so this function can read it to test it). The console
//                  cannot write these (that needs a Supabase management token, too powerful to keep online): the
//                  Owner changes it with `supabase secrets set NAME=...`, then presses "Record rotation" here.
// The value never leaves the server: not in an answer, a log or an audit row (only "last 4 abcd -> wxyz").
// admin_set_secret (the user app's old Platform page) is not reused: it checks is_superadmin() and auth.uid(), which a
// service-role call does not have, and writes no audit row; console_secret_set (migration 122) does both in one go.
import { ConsoleError, type Ctx, type ListSpec, type Module } from "../core/types.ts";

export type TestKind = "anthropic" | "groq" | "vision" | "resend" | "cf_realtime" | "cf_turn" | "zoho" | "sentry" | "fyn" | "present" | "internal";
export type KeyDef = {
  name: string; label: string; provider: string; store: "table" | "vault" | "env";
  powers: string[]; test: TestKind; pair?: string; usage?: string; warn?: string; setting?: boolean; fallback?: string;
};
const CLAUDE = ["Bill reading", "Ask FinCom (assistant)", "Notices and certificates", "GSTR-2B match", "TDS challan match", "MIS descriptions", "Meeting summaries", "Ledger and sheet guessing"];
const MEET = ["Meetings (audio and video relay)"];
const TAXPRO = ["GST returns fetch", "GST filing", "e-invoice", "e-way bill"];
export const KEYS: KeyDef[] = [
  { name: "claude_api_key", label: "Claude API key", provider: "Anthropic", store: "table", powers: CLAUDE, test: "anthropic", usage: "claude" },
  { name: "google_vision_key", label: "Google Vision key", provider: "Google", store: "table", powers: ["Bill OCR (scanned bills)"], test: "vision", usage: "vision" },
  { name: "groq_api_key", label: "Groq API key", provider: "Groq", store: "table", powers: ["Voice typing", "Meeting captions"], test: "groq", usage: "groq" },
  { name: "resend_api_key", label: "Resend key (meetings and MIS)", provider: "Resend", store: "table", powers: ["Meeting invites and guest codes", "Scheduled MIS emails"], test: "resend", usage: "resend" },
  { name: "resend_from", label: "Resend sender address", provider: "Resend", store: "table", powers: ["Meeting invites and guest codes", "Scheduled MIS emails"], test: "present", setting: true },
  { name: "cf_realtime_app_id", label: "Cloudflare Realtime app id", provider: "Cloudflare", store: "table", powers: MEET, test: "cf_realtime", pair: "cf_realtime_token", usage: "cf_realtime" },
  { name: "cf_realtime_token", label: "Cloudflare Realtime token", provider: "Cloudflare", store: "table", powers: MEET, test: "cf_realtime", pair: "cf_realtime_app_id", usage: "cf_realtime" },
  { name: "cf_turn_key_id", label: "Cloudflare TURN key id", provider: "Cloudflare", store: "table", powers: ["Meetings through office firewalls (TURN)"], test: "cf_turn", pair: "cf_turn_key_token" },
  { name: "cf_turn_key_token", label: "Cloudflare TURN key token", provider: "Cloudflare", store: "table", powers: ["Meetings through office firewalls (TURN)"], test: "cf_turn", pair: "cf_turn_key_id" },
  { name: "call_guest_secret", label: "Meeting guest-link secret", provider: "FinCom (internal)", store: "table", powers: ["Meeting guest links"], test: "internal", usage: "call_guest",
    warn: "Replacing it ends every guest link already sent. The meetings function makes one by itself when there is none." },
  { name: "sentry_api_token", label: "Sentry read-only token", provider: "Sentry", store: "table", powers: ["System health: the errors summary"], test: "sentry", pair: "sentry_org" },
  { name: "sentry_org", label: "Sentry organisation", provider: "Sentry", store: "table", powers: ["System health: the errors summary"], test: "present", setting: true },
  { name: "gsp:taxpro:aspid", label: "TaxPro ASP id", provider: "TaxPro GSP", store: "vault", powers: TAXPRO, test: "present", usage: "taxpro", fallback: "TAXPRO_ASP_ID" },
  { name: "gsp:taxpro:password", label: "TaxPro ASP password", provider: "TaxPro GSP", store: "vault", powers: TAXPRO, test: "present", usage: "taxpro", fallback: "TAXPRO_ASP_PASSWORD" },
  { name: "TAXPRO_ASP_ID", label: "TaxPro ASP id (function secret, used when Vault has none)", provider: "TaxPro GSP", store: "env", powers: TAXPRO, test: "present", usage: "taxpro" },
  { name: "TAXPRO_ASP_PASSWORD", label: "TaxPro ASP password (function secret, used when Vault has none)", provider: "TaxPro GSP", store: "env", powers: TAXPRO, test: "present", usage: "taxpro" },
  { name: "RESEND_API_KEY", label: "Resend key (function secret)", provider: "Resend", store: "env", powers: ["Firm invites", "Support mail", "Console's support replies"], test: "resend" },
  { name: "ZOHO_CLIENT_ID", label: "Zoho client id", provider: "Zoho", store: "env", powers: ["Zoho Books link"], test: "zoho", pair: "ZOHO_CLIENT_SECRET", usage: "zoho" },
  { name: "ZOHO_CLIENT_SECRET", label: "Zoho client secret", provider: "Zoho", store: "env", powers: ["Zoho Books link"], test: "zoho", pair: "ZOHO_CLIENT_ID", usage: "zoho" },
  { name: "FYN_CLIENT_ID", label: "FYN client id (older GST route)", provider: "FYN", store: "env", powers: ["GST through gst-api (older route)"], test: "present", usage: "fyn" },
  { name: "FYN_CLIENT_SECRET", label: "FYN client secret (older GST route)", provider: "FYN", store: "env", powers: ["GST through gst-api (older route)"], test: "present", usage: "fyn" },
  { name: "FYN_RELAY_KEY", label: "FYN relay key", provider: "FYN", store: "env", powers: ["GST through gst-api (older route)"], test: "fyn", usage: "fyn" },
];
export const keyDef = (name: unknown) => KEYS.find((k) => k.name === name);

export const KEYS_LIST: ListSpec = {
  columns: { label: "text", name: "text", provider: "select", store: "select", set: "bool", last4: "text", powers: "text", set_at: "date", last_used: "date",
             last_test_at: "date", last_test_ok: "bool", rotated_at: "date", rotate_by: "date", rotate_due: "bool" },
  search: ["label", "name", "provider", "powers"],
  defaultSort: { col: "provider", dir: "asc" },
};
const ROTATE_DAYS = 180;
const last4 = (v: string | undefined | null) => (v && v.length >= 12 ? v.slice(-4) : null);

async function readValue(ctx: Ctx, k: KeyDef): Promise<string> {
  if (k.store === "env") return (ctx.deps.env?.(k.name) || "").trim();
  const v = await ctx.deps.rpc("console_secret_value", { p_name: k.name, p_store: k.store });
  return typeof v === "string" ? v : "";
}

// ---------------------------------------------------------------- the Test calls (cheap or free, never a change)
type Tested = { ok: boolean; msg: string };
const say = (r: Response, j: any) => String(j?.error?.message || j?.error_description || j?.message || j?.error || j?.detail || ("HTTP " + r.status)).slice(0, 160);
async function jsonOf(r: Response) { try { return await r.json(); } catch { return null; } }
export async function testKey(ctx: Ctx, k: KeyDef, value: string, pair: string): Promise<Tested> {
  const http = ctx.deps.http;
  if (!value) return { ok: false, msg: "Not set." };
  if (k.test === "present") return { ok: true, msg: k.setting ? "Set." : "Set. This provider has no free check call; its features show whether it works." };
  if (k.test === "internal") return value.length >= 32 ? { ok: true, msg: "Set, and long enough (" + value.length + " characters)." } : { ok: false, msg: "Too short: at least 32 characters." };
  if (!http) return { ok: false, msg: "Outbound calls are not available here." };
  try {
    switch (k.test) {
      case "anthropic": {
        const r = await http("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": value, "anthropic-version": "2023-06-01" } });
        const j = await jsonOf(r);
        return r.ok ? { ok: true, msg: "Anthropic accepted the key (models list)." } : { ok: false, msg: "Anthropic answered " + r.status + ": " + say(r, j) };
      }
      case "groq": {
        const r = await http("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + value } });
        const j = await jsonOf(r);
        return r.ok ? { ok: true, msg: "Groq accepted the key (models list)." } : { ok: false, msg: "Groq answered " + r.status + ": " + say(r, j) };
      }
      case "vision": {
        // an empty request: no image, no charge. 200, or a 400 about the request (not the key), means the key is accepted
        const r = await http("https://vision.googleapis.com/v1/images:annotate?key=" + encodeURIComponent(value), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requests: [] }) });
        const j = await jsonOf(r);
        const m = say(r, j);
        if (r.ok || (r.status === 400 && !/api key/i.test(m))) return { ok: true, msg: "Google accepted the key (an empty request, no charge)." };
        return { ok: false, msg: "Google answered " + r.status + ": " + m };
      }
      case "resend": {
        const r = await http("https://api.resend.com/domains", { headers: { Authorization: "Bearer " + value } });
        const j = await jsonOf(r);
        if (r.ok) return { ok: true, msg: "Resend accepted the key (" + ((j?.data || []).length) + " sending domains)." };
        if (r.status === 401 && /restricted/i.test(JSON.stringify(j || {}))) return { ok: true, msg: "Resend accepted the key (a sending-only key)." };
        return { ok: false, msg: "Resend answered " + r.status + ": " + say(r, j) };
      }
      case "cf_realtime": {
        const app = k.name === "cf_realtime_app_id" ? value : pair, tok = k.name === "cf_realtime_app_id" ? pair : value;
        if (!app || !tok) return { ok: false, msg: "Both the app id and the token are needed." };
        // a new empty session: no tracks, nothing billed; it ends by itself
        const r = await http("https://rtc.live.cloudflare.com/v1/apps/" + encodeURIComponent(app) + "/sessions/new", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: "{}" });
        const j = await jsonOf(r);
        return r.ok ? { ok: true, msg: "Cloudflare Realtime accepted the app id and token." } : { ok: false, msg: "Cloudflare answered " + r.status + ": " + say(r, j) };
      }
      case "cf_turn": {
        const id = k.name === "cf_turn_key_id" ? value : pair, tok = k.name === "cf_turn_key_id" ? pair : value;
        if (!id || !tok) return { ok: false, msg: "Both the TURN key id and its token are needed." };
        const r = await http("https://rtc.live.cloudflare.com/v1/turn/keys/" + encodeURIComponent(id) + "/credentials/generate-ice-servers", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: 60 }) });
        const j = await jsonOf(r);
        return r.ok ? { ok: true, msg: "Cloudflare TURN gave one-minute credentials." } : { ok: false, msg: "Cloudflare answered " + r.status + ": " + say(r, j) };
      }
      case "zoho": {
        const id = k.name === "ZOHO_CLIENT_ID" ? value : pair, sec = k.name === "ZOHO_CLIENT_ID" ? pair : value;
        if (!id || !sec) return { ok: false, msg: "Both the Zoho client id and secret are needed." };
        // a refresh with a made-up token: Zoho says "invalid_client" for a bad id or secret, "invalid_code" when they are right
        const acc = (ctx.deps.env?.("ZOHO_ACCOUNTS_URL") || "https://accounts.zoho.in").replace(/\/+$/, "");
        const r = await http(acc + "/oauth/v2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "refresh_token", client_id: id, client_secret: sec, refresh_token: "fincom-console-test" }).toString() });
        const j = await jsonOf(r);
        const e = String(j?.error || "");
        if (e === "invalid_code") return { ok: true, msg: "Zoho accepted the client id and secret." };
        return { ok: false, msg: "Zoho answered: " + (e || ("HTTP " + r.status)) };
      }
      case "sentry": {
        if (!pair) return { ok: false, msg: "Set the Sentry organisation too." };
        const r = await http("https://sentry.io/api/0/organizations/" + encodeURIComponent(pair) + "/", { headers: { Authorization: "Bearer " + value } });
        const j = await jsonOf(r);
        return r.ok ? { ok: true, msg: "Sentry accepted the token (organisation " + String(j?.slug || pair).slice(0, 40) + ")." } : { ok: false, msg: "Sentry answered " + r.status + ": " + say(r, j) };
      }
      case "fyn": {
        const relay = (ctx.deps.env?.("FYN_RELAY_URL") || "").replace(/\/+$/, "");
        if (!relay) return { ok: true, msg: "Set. No FYN relay address (FYN_RELAY_URL), so the relay was not checked." };
        const r = await http(relay + "/health");
        return r.ok ? { ok: true, msg: "Set, and the FYN relay answers." } : { ok: false, msg: "The FYN relay answered " + r.status + "." };
      }
    }
  } catch (e) {
    return { ok: false, msg: "No answer from the provider (" + String((e as Error)?.name === "TimeoutError" ? "timed out" : "network") + ")." };
  }
  return { ok: false, msg: "No test for this key." };
}
// a provider's words, with the key (and its pair) taken out wherever they appear
export function clean(msg: string, ...secrets: string[]): string {
  let m = String(msg || "");
  for (const s of secrets) if (s && s.length >= 4) m = m.split(s).join("[key]");
  return m.replace(/[\r\n]+/g, " ").slice(0, 280);
}

async function rows(ctx: Ctx) {
  const table = KEYS.filter((k) => k.store === "table").map((k) => k.name), vault = KEYS.filter((k) => k.store === "vault").map((k) => k.name);
  const env = KEYS.filter((k) => k.store === "env").map((k) => k.name);
  const [st, meta, used] = await Promise.all([
    ctx.deps.rpc("console_secrets_status", { p_table: table, p_vault: vault }),
    ctx.deps.rpc("console_secret_meta_get", { p_names: env }),
    ctx.deps.rpc("console_secret_last_used", {}).catch(() => ({})),
  ]);
  const by: Record<string, any> = {};
  for (const s of st || []) by[s.name] = s;
  return KEYS.map((k) => {
    let s: any;
    if (k.store === "env") {
      const v = (ctx.deps.env?.(k.name) || "").trim();
      s = { set: !!v, length: v.length, last4: last4(v), ...((meta || {})[k.name] || {}) };
    } else s = by[k.name] || { set: false };
    const since = s.rotated_at || s.set_at || null;
    const rotateBy = since && !k.setting ? new Date(Date.parse(since) + ROTATE_DAYS * 86400000).toISOString() : null;
    const fb = k.fallback ? !!(ctx.deps.env?.(k.fallback) || "").trim() : false;
    return {
      name: k.name, label: k.label, provider: k.provider, store: k.store, powers: k.powers.join(", "), powers_list: k.powers, warn: k.warn || null, setting: !!k.setting,
      set: !!s.set, length: s.length || 0, last4: s.last4 || null, set_at: s.set_at || null, set_by: s.set_by || null,
      last_used: k.usage ? (used || {})[k.usage] || null : null, usage_known: !!k.usage,
      last_test_at: s.last_test_at || null, last_test_ok: s.last_test_ok ?? null, last_test_msg: s.last_test_msg || null,
      rotated_at: s.rotated_at || null, rotated_by: s.rotated_by || null, rotate_reason: s.rotate_reason || null, last4_before: s.last4_before || null,
      rotate_by: rotateBy, rotate_due: !!rotateBy && Date.parse(rotateBy) < Date.now(), fallback: k.fallback || null, fallback_set: fb,
      writable: k.store !== "env", test: k.test,
    };
  });
}

const target = (p: any) => ({ type: "key", id: String(p.name ?? "") });
const mustKey = (p: any) => { const k = keyDef(p.name); if (!k) throw new ConsoleError(400, "That is not a key the console knows.", "bad_key"); return k; };

export const module: Module = {
  name: "keys",
  actions: {
    "keys.list": { roles: ["owner"], kind: "read", list: KEYS_LIST, run: (ctx) => rows(ctx) },
    "key.get": {
      roles: ["owner"], kind: "read", target,
      run: async (ctx, p) => { const k = mustKey(p); return (await rows(ctx)).find((r) => r.name === k.name); },
    },
    // replace (write-only): the value is never sent back or recorded; one transaction writes it, the note and the audit row
    "keys.set": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => {
        const k = mustKey(p);
        if (k.store === "env") throw new ConsoleError(409, `${k.name} is a Supabase function secret: change it with "supabase secrets set ${k.name}=…", then press Record rotation here.`, "env_key");
        const v = typeof p.value === "string" ? p.value.trim() : "";
        if (v.length < 4 || v.length > 4000) throw new ConsoleError(400, "Paste the whole key (4 to 4000 characters).", "bad_value");
        const r = await ctx.deps.rpc("console_secret_set", { p_by: ctx.caller.id, p_name: k.name, p_store: k.store, p_value: v, p_reason: p.reason, p_ip: ctx.caller.ip || null, p_ua: ctx.caller.ua || null });
        return { name: k.name, last4: r?.last4 ?? null, set_at: r?.set_at ?? null };
      },
    },
    // a function secret changed in Supabase: the console records when, why, and its new last 4 (read here, never sent)
    "keys.rotated": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => {
        const k = mustKey(p);
        if (k.store !== "env") throw new ConsoleError(409, "Use Replace for this key: the console keeps it.", "not_env");
        const v = (ctx.deps.env?.(k.name) || "").trim();
        if (!v) throw new ConsoleError(409, `${k.name} is not set in the function secrets.`, "not_set");
        return await ctx.deps.rpc("console_secret_rotated", { p_by: ctx.caller.id, p_name: k.name, p_last4: last4(v), p_reason: p.reason, p_ip: ctx.caller.ip || null, p_ua: ctx.caller.ua || null });
      },
    },
    // one cheap or free call to the provider; the result (passed or not, its words, when) is kept with the key
    "keys.test": {
      roles: ["owner"], kind: "write", target, summary: (p) => ({ name: String(p.name ?? "") }),
      run: async (ctx, p) => {
        const k = mustKey(p);
        const v = await readValue(ctx, k);
        const pk = k.pair ? keyDef(k.pair) : undefined;
        const pv = pk ? await readValue(ctx, pk) : "";
        const t = await testKey(ctx, k, v, pv);
        const msg = clean(t.msg, v, pv);
        await ctx.deps.rpc("console_secret_tested", { p_by: ctx.caller.id, p_name: k.name, p_ok: t.ok, p_msg: msg });
        return { name: k.name, ok: t.ok, msg, at: new Date().toISOString() };
      },
    },
  },
};
