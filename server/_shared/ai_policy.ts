// ai_policy.ts: may this firm use this AI feature now? The one question every AI function asks before a model call
// (the AI control centre, console phase 4; docs/CONSOLE-AI.md). The answer is the database's (ai_allowed, migration
// 121): the registry's switch (ai_features), the global kill switch (ai_settings), FinCom's switches for the firm and
// its AI allowance (ai_plan_allowance, ai_firm_settings). The console changes the data; nothing here decides.
//
//   const policy = aiPolicy((fn, args) => rpcAsServiceRole(fn, args));
//   const p = await policy.aiAllowed(firm, "tds_match");
//   if (!p.ok) return reply(403, { ok: false, kind: "ai_off", reason: p.reason, error: p.message });
//   model = p.model || MY_DEFAULT_MODEL;
//
// -> { ok, model (null: the function's own choice), reason, message (plain words, for the person), over (past the
//      allowance, pay per use), ... }.
// Each answer is kept for CACHE_MS (per firm and feature, in this instance of the function), so a burst of calls asks
// once; a switch made in the console reaches every function within that time.
// Before migration 121 is run (the database has no ai_allowed), every feature is allowed as before (reason
// "no_policy"). Any other failure to ask refuses, with a plain message: the kill switch must not be skipped by an error.
// Plain module: no Deno API, so the functions' tests pass their own fake rpc.

export type AiPolicy = {
  ok: boolean;
  model: string | null;
  reason: string;
  message: string;
  feature: string;
  name?: string;
  over?: boolean;
  spent_paise?: number;
  allowance_paise?: number | null;
  price_mode?: string;
  price_per_use_paise?: number;
};
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<any>;

export const CACHE_MS = 15_000;
export const UNAVAILABLE = "FinCom could not check the AI settings just now; try again in a moment.";
// the kind every function answers a refusal with, so the app can say the message as it is
export const AI_OFF_KIND = "ai_off";

// PostgREST's "no such function" (PGRST202), or Postgres's 42883: the migration is not run yet
// (a 404 from /rest/v1/rpc/ai_allowed is the same: PostgREST answers 404 for a function it does not have)
const missing = (e: any) => {
  const s = String((e && (e.code || "")) + " " + (e && (e.message || e)) || "");
  return (e && e.status === 404) || /PGRST202|42883|could not find the function|function .*ai_allowed.* does not exist/i.test(s);
};

export function aiPolicy(rpc: Rpc, opts: { now?: () => number, cacheMs?: number } = {}) {
  const now = opts.now || Date.now, ttl = opts.cacheMs ?? CACHE_MS;
  const cache = new Map<string, { at: number, v: AiPolicy }>();
  async function aiAllowed(firm: string, feature: string): Promise<AiPolicy> {
    const key = firm + "|" + feature, hit = cache.get(key), t = now();
    if (hit && t - hit.at < ttl) return hit.v;
    let v: AiPolicy;
    try {
      const r = await rpc("ai_allowed", { p_firm: firm, p_feature: feature });
      if (!r || typeof r !== "object" || typeof r.ok !== "boolean") throw new Error("bad answer");
      v = { ...r, ok: r.ok, model: r.model ? String(r.model) : null, reason: String(r.reason || (r.ok ? "on" : "off")),
            message: r.ok ? "" : String(r.message || ("AI for " + feature + " is switched off by FinCom.")), feature };
    } catch (e) {
      // not cached: the next call asks again
      if (missing(e)) return { ok: true, model: null, reason: "no_policy", message: "", feature };
      return { ok: false, model: null, reason: "unavailable", message: UNAVAILABLE, feature };
    }
    cache.set(key, { at: t, v });
    if (cache.size > 2000) for (const k of cache.keys()) { cache.delete(k); if (cache.size <= 1000) break; }
    return v;
  }
  return { aiAllowed, clear: () => cache.clear() };
}

// the body every function answers a refusal with ({ok:false, kind:"ai_off", reason, error}); 403 for a switch, 429 for
// a used-up allowance, 503 when the settings could not be read
export function refusal(p: AiPolicy): { status: number, body: Record<string, unknown> } {
  const status = p.reason === "allowance" ? 429 : p.reason === "unavailable" ? 503 : 403;
  return { status, body: { ok: false, kind: AI_OFF_KIND, reason: p.reason, feature: p.feature, error: p.message } };
}
