// console-admin (FinCom Console, console.fincom.live): the one server function the console calls. Deployed with
// verify_jwt off: the router (core/router.ts) checks the Supabase token itself, then aal2, the rate limit, the active
// console admin, the action's role, the reason, and writes the audit row. Modules: registry.ts.
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Supabase sets both); CONSOLE_ORIGINS (optional, comma-separated
// extra sites, e.g. a local test address). Deploy: python3 -I scratchpad/fn_deploy.py <checkout> console-admin server/console/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
import { DEFAULT_ORIGINS, makeHandler } from "./core/router.ts";
import { type Deps } from "./core/types.ts";
import { MODULES } from "./registry.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const must = (error: any) => { if (error) throw new Error(error.message || String(error)); };
const BAN = "876000h";   // 100 years: until an admin lifts it

const deps: Deps = {
  async getUser(jwt) {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user?.id) return null;
    return { id: data.user.id, email: String(data.user.email || "").toLowerCase() };
  },
  async adminRow(userId) {
    const { data, error } = await admin.from("console_admins").select("role, active").eq("user_id", userId).maybeSingle(); must(error);
    return data as { role: string; active: boolean } | null;
  },
  async rpc(fn, args) {
    const { data, error } = await admin.rpc(fn, args); must(error);
    return data;
  },
  async mfaFactors(userId) {
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId }); must(error);
    return (data?.factors || []).map((f: any) => ({ id: f.id, factor_type: f.factor_type, status: f.status }));
  },
  async mfaDelete(userId, id) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({ userId, id }); must(error);
  },
  async authBan(userId, banned) {
    const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: banned ? BAN : "none" } as any); must(error);
  },
  async rateHit(bucket, key, max, windowS) {
    const { data, error } = await admin.rpc("auth_rate_hit", { p_bucket: bucket, p_key: key, p_max: max, p_window_s: windowS }); must(error);
    return data === true;
  },
  origins: [...DEFAULT_ORIGINS, ...(Deno.env.get("CONSOLE_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean)],
  log: (msg, err) => console.error("console-admin:", msg, err instanceof Error ? err.message : err ?? ""),
  http: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }),
  env: (name) => Deno.env.get(name),
};

Deno.serve(makeHandler(deps, MODULES));
