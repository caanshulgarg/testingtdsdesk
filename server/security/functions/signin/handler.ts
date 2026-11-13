// FinCom sign-in with a lockout (review of 30 Sep 2026, item 21): 5 wrong passwords within 15 minutes lock the
// account for 15 minutes. The app signs in here instead of straight at Supabase Auth; the password check itself is
// still Supabase's (this function passes the email and password on and never stores either).
// The failures are counted in public.auth_lockout (service role only). The lock is enforced by the access-token hook
// (public.lockout_access_token_hook), so it also holds for a sign-in that does not come through here.
//
// 26-Oct-2026 (the owner: "Security of sign in and sign up page should be better"), plain module with no imports so the
// Deno tests (handler_test.ts) run it with fake services; index.ts wires the real ones:
//  - the bot check (Cloudflare Turnstile): the page's token is passed to Supabase Auth (gotrue_meta_security.captcha_token),
//    which checks it once Auth's bot protection is switched on. With CAPTCHA_REQUIRED=1 a sign-in without a token is
//    refused here first (and is not counted as a wrong password). Auth's own "captcha" refusals are never counted either.
//  - failed sign-ins per address, across every running copy (public.auth_rate_hits, migration 112): 20 within 15
//    minutes from one address, whatever the emails, and that address is refused for the rest of the window; on top of
//    the per-email lockout. The address is kept only as a SHA-256.

//
// With migration 189:
//  - Supabase Auth's password hook counts every wrong password of an account. Before the password goes to Auth this
//    function asks auth_signin_begin, which writes a pass for this email and address (ten seconds, one password
//    check); the hook takes a check that carries a pass whatever the account's count is;
//  - the wait belongs to the email and the address together: none for four wrong passwords, then 30 s, 1, 2, 5 and at
//    most 15 minutes. A try during a wait is refused without being counted, and the firm's owner can unlock. The
//    per-address count above stays.
//  Without migration 189 the count is auth_lockout's (5 wrong passwords within 15 minutes).

export const SWITCHED_OFF = "This account is switched off. Contact FinCom support.";
export const MAX_IP_FAILS = 20, IP_WINDOW_S = 15 * 60;
export const BOT_MISSING = "Complete the check that you are not a robot, then sign in again.";
export const BOT_FAILED = "The check that you are not a robot did not pass. Try again.";
export const IP_BLOCKED = "Too many failed sign-ins from this network. Wait 15 minutes and try again.";

export interface Deps {
  cors(req: Request): Record<string, string>;
  captchaRequired: boolean;
  lockoutUntil(email: string): Promise<string | null>;
  lockoutClear(email: string): Promise<void>;
  lockoutFail(email: string): Promise<{ fails: number; locked_until: string | null } | null>;
  // Supabase Auth's password sign-in: its status and answer as they are
  authToken(email: string, password: string, captcha: string): Promise<{ status: number; body: any }>;
  // the shared counts (migration 112); each may fail (not deployed yet): the sign-in then goes on as before
  rateCount(bucket: string, key: string, windowS: number): Promise<number>;
  rateAdd(bucket: string, key: string): Promise<void>;
  // migration 189 (each may fail while it is not run: the count then goes on as before). ipKey: the address as a SHA-256
  signinBegin(email: string, ipKey: string): Promise<{ allowed: boolean; fails: number; wait_s?: number; until?: string } | null>;
  signinFail(email: string, ipKey: string): Promise<{ fails: number; wait_s: number; until: string | null } | null>;
  signinOk(email: string, ipKey: string): Promise<void>;
}
export const FREE_TRIES = 4;   // wrong passwords of one email from one address that cost no wait (migration 189)
export const waitWords = (s: number) => (s < 60 ? Math.max(1, Math.ceil(s)) + " seconds" : Math.ceil(s / 60) + " minute" + (Math.ceil(s / 60) === 1 ? "" : "s"));
const waitMsg = (s: number) => "Too many wrong passwords. Try again in " + waitWords(s) + ", or ask the firm's owner to unlock you.";

// the address as the platform saw it, never a caller's own header: ../_shared/clientip.ts
import { clientIp } from "../_shared/clientip.ts";
export { clientIp };
export async function sha256hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const IST = (t: string) => new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
const lockedMsg = (until: string) => "Too many wrong passwords. Try again after " + IST(until) + ", or ask the firm's owner to unlock you.";

export function makeHandler(d: Deps) {
  return async (req: Request): Promise<Response> => {
    const cors = d.cors(req);
    const reply = (code: number, body: unknown) =>
      new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });

    let body: any = {};
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
    if (!body || typeof body !== "object") return reply(400, { ok: false, error: "Bad request" });
    const email = String(body.email || "").trim().toLowerCase(), password = String(body.password || "");
    const captcha = typeof body.captcha_token === "string" ? body.captcha_token.trim().slice(0, 4096) : "";
    if (!email || !password) return reply(400, { ok: false, error: "Enter your email and password." });
    if (d.captchaRequired && !captcha) return reply(400, { ok: false, reason: "captcha", error: BOT_MISSING });

    const ipKey = await sha256hex("signin-fail-ip:" + clientIp(req));
    let ipFails = 0;
    try { ipFails = await d.rateCount("signin-fail-ip", ipKey, IP_WINDOW_S); } catch { ipFails = 0; }
    if (ipFails >= MAX_IP_FAILS) return reply(429, { ok: false, reason: "rate_limited", error: IP_BLOCKED });

    const until = await d.lockoutUntil(email);
    if (until) return reply(423, { ok: false, locked_until: until, error: lockedMsg(until) });

    // this email from this address: may it be tried now? (and the pass for Auth's hook). null: migration 189 not run
    const pairKey = await sha256hex("signin-pair-ip:" + clientIp(req));
    let gate: Awaited<ReturnType<Deps["signinBegin"]>> = null;
    try { gate = await d.signinBegin(email, pairKey); } catch { gate = null; }
    if (gate && gate.allowed === false) {
      const s = Math.max(1, Number(gate.wait_s) || 1);
      return reply(423, { ok: false, reason: "wait", retry_after_s: s, locked_until: gate.until || new Date(Date.now() + s * 1000).toISOString(), error: waitMsg(s) });
    }

    const r = await d.authToken(email, password, captcha);
    const j = r.body || {};
    if (r.status >= 200 && r.status < 300) {
      if (gate) { try { await d.signinOk(email, pairKey); } catch { /* the pass ends by itself */ } }
      await d.lockoutClear(email);
      return reply(200, j);
    }
    const said = String(j.error_description || j.msg || j.error || "");
    // Auth's bot check refused it: said so, never counted as a wrong password
    if (j.error_code === "captcha_failed" || /captcha/i.test(said)) return reply(400, { ok: false, reason: "captcha", error: captcha ? BOT_FAILED : BOT_MISSING });
    // only a wrong email or password counts; anything else (a locked token, a switched-off login) is passed on as it is
    if (r.status === 400 && (j.error_code === "invalid_credentials" || /invalid/i.test(said))) {
      try { await d.rateAdd("signin-fail-ip", ipKey); } catch { /* migration 112 not run yet: the per-email lockout still holds */ }
      if (gate) {
        let f: Awaited<ReturnType<Deps["signinFail"]>> = null;
        try { f = await d.signinFail(email, pairKey); } catch { f = null; }
        const n = Number((f && f.fails) || 0), s = Number((f && f.wait_s) || 0);
        if (s > 0) return reply(423, { ok: false, reason: "wait", retry_after_s: s, locked_until: (f && f.until) || new Date(Date.now() + s * 1000).toISOString(), error: waitMsg(s) });
        const more = Math.max(1, FREE_TRIES + 1 - n);
        return reply(400, { ok: false, error: "Wrong email or password." + (n >= 3 ? " After " + more + " more wrong password" + (more === 1 ? "" : "s") + " this network must wait before trying this email again." : "") });
      }
      const f = await d.lockoutFail(email);
      const left = Math.max(0, 5 - Number((f && f.fails) || 0));
      if (f && f.locked_until) return reply(423, { ok: false, locked_until: f.locked_until, error: lockedMsg(f.locked_until) });
      return reply(400, { ok: false, error: "Wrong email or password." + (left <= 2 ? " " + left + " more tr" + (left === 1 ? "y" : "ies") + " before the account is locked for 15 minutes." : "") });
    }
    // console phase 1b: a login FinCom switched off from its console (banned in Supabase Auth): said so, never counted
    if (j.error_code === "user_banned" || /banned/i.test(said)) return reply(403, { ok: false, reason: "user_off", error: SWITCHED_OFF });
    return reply(r.status, { ok: false, error: j.error_description || j.msg || j.message || "Sign-in failed." });
  };
}
