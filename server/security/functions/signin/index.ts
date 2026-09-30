// FinCom sign-in with a lockout (review of 30 Sep 2026, item 21): 5 wrong passwords within 15 minutes lock the
// account for 15 minutes. The app signs in here instead of straight at Supabase Auth; the password check itself is
// still Supabase's (this function passes the email and password on and never stores either).
// The failures are counted in public.auth_lockout (service role only). The lock is enforced by the access-token hook
// (public.lockout_access_token_hook), so it also holds for a sign-in that does not come through here.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsFor } from "./cors.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const IST = (t: string) => new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const reply = (code: number, body: unknown) =>
    new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });

  let body: any = {};
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
  const email = String(body.email || "").trim().toLowerCase(), password = String(body.password || "");
  if (!email || !password) return reply(400, { ok: false, error: "Enter your email and password." });

  const admin = createClient(URL, SERVICE);
  const { data: until } = await admin.rpc("auth_lockout_until", { p_email: email });
  if (until) return reply(423, { ok: false, locked_until: until, error: "Too many wrong passwords. Try again after " + IST(until) + ", or ask the firm's owner to unlock you." });

  const r = await fetch(URL + "/auth/v1/token?grant_type=password", {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok) {
    await admin.rpc("auth_lockout_clear", { p_email: email, p_by: null });
    return reply(200, j);
  }
  // only a wrong email or password counts; anything else (a locked token, a switched-off login) is passed on as it is
  if (r.status === 400 && /invalid/i.test(String(j.error_description || j.msg || j.error || ""))) {
    const { data: f } = await admin.rpc("auth_lockout_fail", { p_email: email });
    const left = Math.max(0, 5 - Number((f && f.fails) || 0));
    if (f && f.locked_until) return reply(423, { ok: false, locked_until: f.locked_until, error: "Too many wrong passwords. Try again after " + IST(f.locked_until) + ", or ask the firm's owner to unlock you." });
    return reply(400, { ok: false, error: "Wrong email or password." + (left <= 2 ? " " + left + " more tr" + (left === 1 ? "y" : "ies") + " before the account is locked for 15 minutes." : "") });
  }
  return reply(r.status, { ok: false, error: j.error_description || j.msg || j.message || "Sign-in failed." });
});
