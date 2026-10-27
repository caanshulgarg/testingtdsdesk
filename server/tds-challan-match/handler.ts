// tds-challan-match: step g of the TDS challan matcher (next-challan-match, 17-Oct-2026). index.ts serves this handler
// with the official Anthropic SDK; the tests (handler_test.ts) give it a fake Supabase and a fake Claude.
//   POST, a signed-in owner or staff member of the firm (two-step sign-in done), for one of the firm's clients:
//     {action: "suggest", client_id, form, fy, q, ai, rows: [...], challans: [...]}
//   rows and challans: what the rules left (the app works the rules out itself, server/_shared/tdsmatch.js); only the
//   agreed fields are kept here, the PAN masked again, text cut. Nothing is stored (no table): the answer goes back to the
//   app, which checks it again against its books and shows each pairing as a suggestion for a person to confirm.
// The AI: only when the app says AI help is on for TDS (ai: true) AND the firm's switch (assistant_settings, as Ask FinCom)
// is on. Claude's key is the platform's (platform_secrets claude_api_key), read with the service role. The firm's rupee cap
// (asst_cap_take), the cost (asst_cost_add, feature "tds_match") and one log line (asst_log_add) as every Ask FinCom call.
// The AI control centre (console phase 4, 27-Oct-2026): before the AI, the console's switches for "tds_match" are asked
// (ai_allowed through ../_shared/ai_policy.ts); off -> the rules' suggestions only, and ai.say gives FinCom's words ("AI
// for TDS challan match is switched off by FinCom: the rules' suggestions stand."). A model set there replaces Sonnet.
import { corsFor } from "../_shared/cors.ts";
import { tmMask } from "../_shared/tdsmatch.js";
import { AiClient, matchRun, SONNET } from "./match.ts";
import { aiPolicy } from "../_shared/ai_policy.ts";

export type Deps = { env: (k: string) => string | undefined, fetch: typeof fetch, anthropic: (key: string) => AiClient };

const FY = /^20\d{2}-\d{2}$/, Q = /^Q[1-4]$/, FORMS = ["26Q", "27Q", "27EQ", "24Q"], D8 = /^\d{8}$/;
const MAX_ROWS = 2000, MAX_CHS = 500;
const str = (v: unknown, n: number) => String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").trim().slice(0, n);
const amt = (v: unknown) => { const n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : 0; };
// only the agreed fields
export function cleanRows(list: unknown): any[] {
  return (Array.isArray(list) ? list : []).slice(0, MAX_ROWS).map((r: any) => ({ id: str(r?.id, 200), sec: str(r?.sec, 12).toUpperCase(), date: str(r?.date, 8), tds: amt(r?.tds),
    party: str(r?.party, 60), pan: tmMask(r?.pan), fy: str(r?.fy, 7), q: str(r?.q, 2) })).filter((r) => r.id && D8.test(r.date) && r.tds > 0);
}
export function cleanChallans(list: unknown): any[] {
  return (Array.isArray(list) ? list : []).slice(0, MAX_CHS).map((c: any) => ({ id: str(c?.id, 200), sec: str(c?.sec, 12).toUpperCase(), date: str(c?.date, 8), minor: str(c?.minor || "200", 3),
    bal: amt(c?.bal), interestLeft: amt(c?.interestLeft), fy: str(c?.fy, 7), bsr: str(c?.bsr, 7).replace(/\D/g, ""), serial: str(c?.serial, 5).replace(/\D/g, ""), narr: str(c?.narr, 120) }))
    .filter((c) => c.id && D8.test(c.date));
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
  const rpc = (fn: string, args: Record<string, unknown>, token = SERVICE) => rest("/rest/v1/rpc/" + fn, token, { method: "POST", body: JSON.stringify(args) });
  const q = (v: string) => encodeURIComponent(v);
  const firmAiOn = async (firm: string) => {
    const s = await rest("/rest/v1/assistant_settings?select=enabled&firm_id=eq." + q(firm), SERVICE).catch(() => null) as any[] | null;
    return s !== null && (s[0] || { enabled: true }).enabled !== false;       // on unless the owner switched it off
  };
  const policy = aiPolicy((fn, args) => rpc(fn, args));
  const keyOf = async () => {
    try { const k = (await rest("/rest/v1/platform_secrets?select=value&name=eq.claude_api_key", SERVICE)) as any[]; return (k && k[0] && k[0].value) || ""; } catch { return ""; }
  };

  return async (req: Request): Promise<Response> => {
    const cors = corsFor(req);
    const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
    let body: any;
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt || jwt === ANON || jwt === SERVICE) return reply(401, { ok: false, kind: "auth", error: "Sign in to the firm account first." });
    // next-tds-match-fast (27-Oct-2026): the checks before the AI were seven round trips one after another (1.1 s on
    // staging, once 6 s); now three waves: the sign-in and the two-step together; then the member, the client and the
    // key together; then the firm's switch. The answers are still read in the same order, with the same refusals.
    const userP = rest("/auth/v1/user", jwt).then((u) => u, () => null), mfaP = rpc("mfa_ok", {}, jwt).then((v) => v === true, () => false);
    const user: any = await userP;
    if (!user?.id) return reply(401, { ok: false, kind: "auth", error: "Sign in again." });
    if (!(await mfaP)) return reply(403, { ok: false, kind: "mfa", error: "Finish the two-step sign-in first." });
    const clientId = String(body?.client_id || "").slice(0, 120), fy = String(body?.fy || ""), qq = String(body?.q || ""), form = String(body?.form || "");
    const asked = String(body?.action || "") === "suggest" && !!clientId && FY.test(fy) && Q.test(qq) && FORMS.includes(form);
    const memP = rest("/rest/v1/members?select=firm_id,role,active&user_id=eq." + q(user.id), SERVICE).catch(() => []) as Promise<any[]>;
    const cliP = asked ? rest("/rest/v1/clients?select=id,deleted&id=eq." + q(clientId), jwt).catch(() => []) as Promise<any[]> : Promise.resolve([]);
    const keyP = asked && body.ai === true ? keyOf() : Promise.resolve("");
    const mem = await memP;
    const member = (mem || []).find((m) => m.active);
    if (!member) return reply(403, { ok: false, kind: "firm", error: "This account is not part of a firm." });
    if (member.role !== "owner" && member.role !== "staff") return reply(403, { ok: false, kind: "role", error: "Only the owner or staff can ask AI to match challans." });
    const firm = String(member.firm_id);
    if (String(body?.action || "") !== "suggest") return reply(400, { ok: false, error: "Unknown request" });
    if (!asked) return reply(400, { ok: false, error: "Say the client, the form, the year (2026-27) and the quarter." });
    const c = await cliP;
    if (!c || !c.length || c[0].deleted) return reply(403, { ok: false, kind: "client", error: "This client is not one of your firm's." });
    try {
      const rows = cleanRows(body.rows), chs = cleanChallans(body.challans);
      // FinCom's switches and the firm's own, asked together (one wave)
      const [pol, on] = body.ai === true ? await Promise.all([policy.aiAllowed(firm, "tds_match"), firmAiOn(firm)]) : [null, false];
      const allowed = body.ai === true && !!pol?.ok && on;
      const key = allowed ? await keyP : "";
      const model = (pol && pol.ok && pol.model) || SONNET;
      const out = await matchRun(rows, chs, { fy, q: qq }, {
        client: key ? deps.anthropic(key) : null, aiAllowed: allowed, offSay: pol && !pol.ok ? pol.message : undefined, model,
        capTake: async () => { const r = await rpc("asst_cap_take", { p_firm: firm, p_n: 1 }); return { ok: !!r?.ok, why: String(r?.why || "") }; },
        costAdd: (usd, u) => rpc("asst_cost_add", { p_firm: firm, p_feature: "tds_match", p_cost_usd: usd, p_in: u.input_tokens || 0, p_out: u.output_tokens || 0, p_cache_read: u.cache_read_input_tokens || 0, p_cache_write: u.cache_creation_input_tokens || 0 }),
        log: (x) => rpc("asst_log_add", { p_firm: firm, p_user: user.id, p_client: clientId, p_question: x.question, p_tools: [], p_in: x.input, p_out: x.output, p_calls: x.calls, p_ms: x.ms,
          p_feature: "tds_match", p_route: x.route, p_models: [model], p_cache_read: x.cacheRead, p_cache_write: x.cacheWrite, p_cost_inr: x.inr, p_fell_through: false }),
      });
      return reply(200, { ok: true, ...out });
    } catch (e) {
      // the detail (a database or API message) to the function's log only (security review 27-Oct-2026, F11)
      console.error(JSON.stringify({ evt: "tds_challan_match_error", at: new Date().toISOString(), firm, error: String((e as Error)?.message || e).slice(0, 500) }));
      return reply(500, { ok: false, kind: "other", error: "The matching could not be finished; try again in a moment." });
    }
  };
}
