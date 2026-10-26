// FinCom sign-in with a lockout (review of 30 Sep 2026, item 21); the bot check and the failures per address across
// running copies (26-Oct-2026). The rules are in handler.ts (Deno tests: handler_test.ts); this wires the real services.
// Deployed as uploaded files (index.ts, handler.ts, cors.ts, ../_shared/cors.ts), verify_jwt off.
// Secrets: CAPTCHA_REQUIRED=1 once Supabase Auth's bot protection is on (a sign-in without a token is then refused here).
// Needs migration 112 for the per-address count; without it the count is skipped and the per-email lockout holds as before.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsFor } from "./cors.ts";
import { makeHandler } from "./handler.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const must = <T>(r: { data: T; error: any }) => { if (r.error) throw new Error(r.error.message || String(r.error)); return r.data; };

Deno.serve(makeHandler({
  cors: corsFor,
  captchaRequired: Deno.env.get("CAPTCHA_REQUIRED") === "1",
  lockoutUntil: async (email) => (await admin.rpc("auth_lockout_until", { p_email: email })).data || null,
  lockoutClear: async (email) => { await admin.rpc("auth_lockout_clear", { p_email: email, p_by: null }); },
  lockoutFail: async (email) => (await admin.rpc("auth_lockout_fail", { p_email: email })).data || null,
  authToken: async (email, password, captcha) => {
    const r = await fetch(URL + "/auth/v1/token?grant_type=password", {
      method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify(captcha ? { email, password, gotrue_meta_security: { captcha_token: captcha } } : { email, password }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  },
  rateCount: async (bucket, key, windowS) => Number(must(await admin.rpc("auth_rate_count", { p_bucket: bucket, p_key: key, p_window_s: windowS }))) || 0,
  rateAdd: async (bucket, key) => { must(await admin.rpc("auth_rate_add", { p_bucket: bucket, p_key: key })); },
}));
