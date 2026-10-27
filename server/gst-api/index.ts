// TDS Desk GST API: the firm's GST calls go through FYN Gateway (Fynamics, a GSP) from here, so the client key and
// secret never leave the server. Secrets: FYN_CLIENT_ID, FYN_CLIENT_SECRET, FYN_BASE_URL (staging or production).
// Every call needs a signed-in firm member, with two-step sign-in checked as the gateway checks it (rpc mfa_ok).
// GET ?selftest=1 signs in to FYN and says only whether it worked (never FYN's or the relay's address).
// POST {action: "otp" | "auth" | "2b"}: a taxpayer's OTP sign-in, then GSTR-2B for a period, decrypted here.
// A look-only member (any role but owner or staff) may read (2b), not send an OTP or sign in a taxpayer.
// Every call names a GSTIN of one of the caller's firm's clients (clients, read with the service role), and OTP requests
// are limited to 10 an hour per firm (security review F5). The plain relay is gone: nothing in the app called it.
// Error replies are plain; the raw detail is in the function's log only.
// The taxpayer's session (app_key, auth token, SEK) is kept only in the caller's browser, never stored here.
import { createClient } from "jsr:@supabase/supabase-js@2";
import aesjs from "npm:aes-js@3.1.2";
import { makeGstCrypto } from "./gstcrypto.ts";
import { corsFor } from "../_shared/cors.ts";   // the one list of headers for every function (server/_shared/cors.ts)

const C = makeGstCrypto(aesjs);
const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BASE = (Deno.env.get("FYN_BASE_URL") || "https://www.fynamics.co.in/api").replace(/\/+$/, "");
const CID = Deno.env.get("FYN_CLIENT_ID") || "";
const CSEC = Deno.env.get("FYN_CLIENT_SECRET") || "";
// FYN whitelists the IPs it takes calls from; Supabase has no fixed outgoing IP, so when these two are set every
// call to FYN goes through the firm's relay on a server with a fixed IP (server/fyn-relay). Unset: FYN directly.
const RELAY = (Deno.env.get("FYN_RELAY_URL") || "").replace(/\/+$/, "");
const RKEY = Deno.env.get("FYN_RELAY_KEY") || "";
function toFyn(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<Response> {
  if (!RELAY || !RKEY) return fetch(url, init);
  return fetch(RELAY + "/fwd", { method: "POST", headers: { ...init.headers, "x-relay-key": RKEY, "x-target": url, "x-method": init.method }, body: init.method === "GET" ? undefined : init.body });
}

// "*": every call needs a signed-in firm member
const cors = corsFor(null, { any: true, methods: "GET, POST, OPTIONS" });
const reply = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });

// what a person is told is plain: a Plain message as it is, anything else (network, decryption, code) one fixed sentence;
// the raw detail goes to the function's log only (security review F11)
class Plain extends Error {}
const SORRY = "Something went wrong on FinCom's side. Try again in a moment.";
function plain(e: unknown, where: string): string {
  if (e instanceof Plain) return e.message;
  console.error(JSON.stringify({ fn: "gst-api", where, error: String((e as Error)?.message || e).slice(0, 500) }));
  return SORRY;
}
const logged = (where: string, detail: string, say: string) => { console.error(JSON.stringify({ fn: "gst-api", where, error: detail.slice(0, 500) })); return say; };

// FYN's own access token: kept and reused, taken again a few minutes before it runs out
let tok: { token: string; exp: number } | null = null;
async function fynToken(): Promise<{ ok: boolean; token?: string; expiresIn?: number; error?: string; http?: number }> {
  if (!CID || !CSEC) return { ok: false, error: logged("fyn sign-in", "FYN_CLIENT_ID and FYN_CLIENT_SECRET are not set in the project's Edge Function secrets.", "The GST service is not set up for FinCom yet.") };
  if (tok && tok.exp - Date.now() > 5 * 60 * 1000) return { ok: true, token: tok.token, expiresIn: Math.round((tok.exp - Date.now()) / 1000) };
  let r: Response;
  try { r = await toFyn(BASE + "/authenticate", { method: "POST", headers: { clientId: CID, clientSecret: CSEC, "Content-Type": "application/json" } }); }
  catch (e) { return { ok: false, error: logged("fyn sign-in", "Could not reach FYN Gateway at " + BASE + (RELAY ? " through the relay " + RELAY : "") + ": " + String((e as Error).message || e), "The GST service could not be reached. Try again in a moment.") }; }
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!j) return { ok: false, http: r.status, error: logged("fyn sign-in", "FYN Gateway answered HTTP " + r.status + " without JSON: " + text.slice(0, 200), "The GST service answered HTTP " + r.status + ".") };
  if (j.status !== 1 || !j.data?.accessToken) return { ok: false, http: r.status, error: logged("fyn sign-in", String(j.errorMessage || j.message || "refused") + " (HTTP " + r.status + ")", "The GST service refused FinCom's sign-in. Try again in a moment.") };
  const secs = Number(j.data.expiresIn) || 3600;
  tok = { token: j.data.accessToken, exp: Date.now() + secs * 1000 };
  return { ok: true, token: tok.token, expiresIn: secs };
}
async function fyn(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<{ http: number; j: any; text: string }> {
  const t = await fynToken();
  if (!t.ok) throw new Plain(t.error || SORRY);
  const r = await toFyn(BASE + "/" + path, { method, headers: { Authorization: "Bearer " + t.token, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (r.status === 401) tok = null;
  // what FYN answered, for the function's own logs: never tokens, keys or return data
  if (r.status < 200 || r.status >= 300 || !j) console.log(JSON.stringify({ fyn: method + " " + path.replace(/\?.*$/, ""), http: r.status, type: r.headers.get("content-type"), server: r.headers.get("server"), via: RELAY ? "relay" : "direct", length: text.length, head: text.slice(0, 300) }));
  return { http: r.status, j, text };
}
async function fynAt(url: string, headers: Record<string, string>): Promise<{ http: number; j: any; text: string }> {
  const t = await fynToken();
  if (!t.ok) throw new Plain(t.error || SORRY);
  const r = await toFyn(url, { method: "GET", headers: { Authorization: "Bearer " + t.token, "Content-Type": "application/json", ...headers } });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  return { http: r.status, j, text };
}
const gstErr = (x: { http: number; j: any; text: string }) => (x.j && (x.j.error?.message ? x.j.error.message + (x.j.error.error_cd ? " (" + x.j.error.error_cd + ")" : "") : x.j.errorMessage || x.j.message)) || ("The GST service answered HTTP " + x.http + ".");   // its text is in the log (fyn)
const GSTIN = /^\d{2}[A-Z0-9]{13}$/, PERIOD = /^(0[1-9]|1[0-2])20\d{2}$/;

// OTP requests: at most OTP_MAX per firm in OTP_WINDOW_S (security review F5). Counted in the database (auth_rate_hit,
// server/security/migration-112-auth-rate-limits.sql: one count across the function's running copies, the firm's id
// hashed); where that is not there yet, in this running copy only (logged)
const OTP_MAX = 10, OTP_WINDOW_S = 3600;
const otpHere = new Map<string, number[]>();
async function sha256hex(t: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function otpAllowed(admin: any, firm: string): Promise<boolean> {
  const { data, error } = await admin.rpc("auth_rate_hit", { p_bucket: "gst-otp-firm", p_key: await sha256hex("gst-otp:" + firm), p_max: OTP_MAX, p_window_s: OTP_WINDOW_S });
  if (!error) return data === true;
  console.error(JSON.stringify({ fn: "gst-api", where: "otp limit", error: String(error.message || "").slice(0, 300), note: "counted in this running copy only" }));
  const now = Date.now(), seen = (otpHere.get(firm) || []).filter((t) => now - t < OTP_WINDOW_S * 1000);
  if (seen.length >= OTP_MAX) { otpHere.set(firm, seen); return false; }
  seen.push(now); otpHere.set(firm, seen);
  return true;
}
// the GSTIN is one of the firm's clients' (not deleted); read with the service role for the caller's firm
async function firmClient(admin: any, firm: string, gstin: string): Promise<boolean> {
  const { data, error } = await admin.from("clients").select("id").eq("firm_id", firm).eq("gstin", gstin).not("deleted", "is", true).limit(1);
  if (error) throw new Error("clients: " + error.message);
  return Array.isArray(data) && data.length > 0;
}

// who is asking: a signed-in, active member of a firm. Two-step sign-in is checked exactly as the gateway checks it
// (server/security/functions/gateway/index.ts: rpc mfa_ok as the user, which decides when two-step is required)
async function signedIn(req: Request): Promise<{ user: string; firm: string; role: string; admin: any } | Response> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { ok: false, error: "Sign in to the firm account first." });
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const admin = createClient(URL, SERVICE);
  const { data: who } = await asUser.auth.getUser();
  const user = who?.user;
  if (!user) return reply(401, { ok: false, error: "Sign in again." });
  const { data: mfaOk } = await asUser.rpc("mfa_ok");
  if (mfaOk !== true) return reply(403, { ok: false, error: "Finish the two-step sign-in first." });
  const { data: member } = await admin.from("members").select("firm_id, role, active").eq("user_id", user.id).maybeSingle();
  if (!member || !member.active) return reply(403, { ok: false, error: "This account is not part of a firm." });
  return { user: user.id, firm: String(member.firm_id), role: String(member.role || ""), admin };
}
const canWrite = (role: string) => role === "owner" || role === "staff";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new globalThis.URL(req.url);
  if (req.method === "GET" && u.searchParams.get("selftest")) {
    const me = await signedIn(req);
    if (me instanceof Response) return me;
    const t = await fynToken();
    return reply(t.ok ? 200 : 502, t.ok
      ? { ok: true, via: RELAY ? "relay" : "direct", signedIn: true, tokenValidForMinutes: Math.round((t.expiresIn || 0) / 60), note: "The key and secret work. The token itself is never shown." }
      : { ok: false, via: RELAY ? "relay" : "direct", signedIn: false, error: t.error, http: t.http });
  }
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });

  const me = await signedIn(req);
  if (me instanceof Response) return me;

  let body: any = {};
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
  // the person's public address, as GSTN asks for it
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "127.0.0.1";
  const action = String(body.action || "");
  // the plain relay (any gst/... path) is gone: nothing in the app called it (security review F5)
  if (action !== "otp" && action !== "auth" && action !== "2b") return reply(400, { ok: false, error: "Not a GST call this function makes." });
  // a look-only member reads (2b); an OTP or a taxpayer's sign-in is the owner's or staff's (security review F3)
  if ((action === "otp" || action === "auth") && !canWrite(me.role)) return reply(403, { ok: false, error: "Only the firm's owner or staff can do this." });
  const gstin = String(body.gstin || "").toUpperCase(), username = String(body.username || "").trim();

  try {
    if (!GSTIN.test(gstin)) return reply(400, { ok: false, error: "A GSTIN is needed." });
    if (!(await firmClient(me.admin, me.firm, gstin))) return reply(403, { ok: false, error: "That GSTIN is not one of your firm's clients." });
    if (!username) return reply(400, { ok: false, error: "The taxpayer's GST portal username is needed." });
    const h = { "ip-usr": ip, "state-cd": gstin.slice(0, 2) };
    if (action === "otp") {
      if (!(await otpAllowed(me.admin, me.firm))) return reply(429, { ok: false, error: "Your firm has asked for " + OTP_MAX + " OTPs in the last hour. Try again later." });
      const x = await fyn("POST", "gst/requestOTP", h, { action: "OTPREQUEST", username });
      if (x.j?.status_cd != 1 || !x.j?.app_key) return reply(200, { ok: false, error: gstErr(x) });
      return reply(200, { ok: true, app_key: x.j.app_key });
    }
    if (action === "auth") {
      const otp = String(body.otp || "").trim();
      if (!/^\d{6}$/.test(otp)) return reply(400, { ok: false, error: "The OTP has 6 digits." });
      const x = await fyn("POST", "gst/authtoken", h, { action: "AUTHTOKEN", username, otp });
      if (x.j?.status_cd != 1 || !x.j?.auth_token) return reply(200, { ok: false, error: gstErr(x) });
      return reply(200, { ok: true, auth_token: x.j.auth_token, sek: x.j.sek || "", expiryMinutes: Number(x.j.expiry) || 0 });
    }
    // GSTR-2B for a period (MMYYYY); a large 2B comes in parts, which are put together here
    const period = String(body.period || "");
    if (!PERIOD.test(period)) return reply(400, { ok: false, error: "The period is MMYYYY, e.g. 032026." });
    const sess = { ...h, username, authtoken: String(body.auth_token || ""), app_key: String(body.app_key || ""), sek: String(body.sek || "") };
    if (!sess.authtoken) return reply(400, { ok: false, error: "Sign in with the taxpayer's OTP first." });
    const open = (x: { http: number; j: any; text: string }) => {
      if (x.j?.status_cd != 1) throw new Plain(gstErr(x));
      const d = x.j.data;
      if (d && typeof d === "object") return d;                            // already plain
      if (typeof d === "string" && x.j.rek) return C.openData(d, x.j.rek, sess.sek, sess.app_key);
      if (typeof d === "string") { try { return JSON.parse(new TextDecoder().decode(C.b64dec(d))); } catch { /* fall through */ } }
      throw new Plain("2B came back in a form TDS Desk does not know.");
    };
    // FYN's path carries the file number: /1 first, then /2, /3 … when 2B comes in parts (fc)
    const path = "gst/returns/gstr2b/" + gstin + "/" + period;
    const first = await fyn("GET", path + "/1", sess);
    if (first.j === null || first.j === "") {
      // FYN answers some calls with an empty body even with a valid session (seen on production, Sep 2026):
      // say so plainly rather than guess; FYN has to enable or fix the returns APIs for the client ID
      return reply(200, { ok: false, error: "FYN Gateway accepted the call but sent back nothing for the 2B of " + period.slice(0, 2) + "/" + period.slice(2) + ". The portal session is valid; this is on FYN Gateway's side (returns APIs not enabled for the account, or their fault). Until it is fixed, bring in the 2B JSON downloaded from the GST portal." });
    }
    let out = open(first);
    out = out?.data && !out.docdata ? out.data : out;
    const parts = Number(out?.fc || 0);
    if (parts > 1) {
      const all = out; all.docdata = all.docdata || {};
      for (let n = 2; n <= parts; n++) {
        let p = open(await fyn("GET", path + "/" + n, sess)); p = p?.data && !p.docdata ? p.data : p;
        Object.entries(p?.docdata || {}).forEach(([k, v]) => { all.docdata[k] = (all.docdata[k] || []).concat(v as any[]); });
      }
      out = all;
    }
    return reply(200, { ok: true, parts: parts || 1, data: out });
  } catch (e) {
    return reply(200, { ok: false, error: plain(e, action) });
  }
});
