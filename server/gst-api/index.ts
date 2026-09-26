// TDS Desk GST API: the firm's GST calls go through FYN Gateway (Fynamics, a GSP) from here, so the client key and
// secret never leave the server. Secrets: FYN_CLIENT_ID, FYN_CLIENT_SECRET, FYN_BASE_URL (staging or production).
// GET ?selftest=1 signs in to FYN and says only whether it worked. Everything else needs a signed-in firm member.
// POST {action: "otp" | "auth" | "2b"}: a taxpayer's OTP sign-in, then GSTR-2B for a period, decrypted here.
// The taxpayer's session (app_key, auth token, SEK) is kept only in the caller's browser, never stored here.
import { createClient } from "jsr:@supabase/supabase-js@2";
import aesjs from "npm:aes-js@3.1.2";
import { makeGstCrypto } from "./gstcrypto.ts";

const C = makeGstCrypto(aesjs);
const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BASE = (Deno.env.get("FYN_BASE_URL") || "https://www.fynamics.co.in/api").replace(/\/+$/, "");
const CID = Deno.env.get("FYN_CLIENT_ID") || "";
const CSEC = Deno.env.get("FYN_CLIENT_SECRET") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const reply = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });

// FYN's own access token: kept and reused, taken again a few minutes before it runs out
let tok: { token: string; exp: number } | null = null;
async function fynToken(): Promise<{ ok: boolean; token?: string; expiresIn?: number; error?: string; http?: number }> {
  if (!CID || !CSEC) return { ok: false, error: "FYN_CLIENT_ID and FYN_CLIENT_SECRET are not set in the project's Edge Function secrets." };
  if (tok && tok.exp - Date.now() > 5 * 60 * 1000) return { ok: true, token: tok.token, expiresIn: Math.round((tok.exp - Date.now()) / 1000) };
  let r: Response;
  try { r = await fetch(BASE + "/authenticate", { method: "POST", headers: { clientId: CID, clientSecret: CSEC, "Content-Type": "application/json" } }); }
  catch (e) { return { ok: false, error: "Could not reach FYN Gateway at " + BASE + ": " + String((e as Error).message || e) }; }
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!j) return { ok: false, http: r.status, error: "FYN Gateway answered HTTP " + r.status + " without JSON: " + text.slice(0, 200) };
  if (j.status !== 1 || !j.data?.accessToken) return { ok: false, http: r.status, error: j.errorMessage || j.message || ("FYN Gateway refused the sign-in (HTTP " + r.status + ")") };
  const secs = Number(j.data.expiresIn) || 3600;
  tok = { token: j.data.accessToken, exp: Date.now() + secs * 1000 };
  return { ok: true, token: tok.token, expiresIn: secs };
}
async function fyn(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<{ http: number; j: any; text: string }> {
  const t = await fynToken();
  if (!t.ok) throw new Error(t.error);
  const r = await fetch(BASE + "/" + path, { method, headers: { Authorization: "Bearer " + t.token, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (r.status === 401) tok = null;
  return { http: r.status, j, text };
}
const gstErr = (x: { http: number; j: any; text: string }) => (x.j && (x.j.error?.message ? x.j.error.message + (x.j.error.error_cd ? " (" + x.j.error.error_cd + ")" : "") : x.j.errorMessage || x.j.message)) || ("HTTP " + x.http + ": " + x.text.slice(0, 200));
const GSTIN = /^\d{2}[A-Z0-9]{13}$/, PERIOD = /^(0[1-9]|1[0-2])20\d{2}$/;

// only GST calls, and only these headers, are passed on by the plain relay
const PATH_OK = /^gst\/[A-Za-z0-9_\-\/]+$/;
const HEAD_OK = new Set(["gstin", "ret_period", "rtnprd", "fy", "state-cd", "username", "authtoken", "app_key", "sek", "txn", "action", "ctin", "from_time", "ref_id", "token", "otp", "action_required", "file_num"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new globalThis.URL(req.url);
  if (req.method === "GET" && u.searchParams.get("selftest")) {
    const t = await fynToken();
    return reply(t.ok ? 200 : 502, t.ok
      ? { ok: true, fyn: BASE, signedIn: true, tokenValidForMinutes: Math.round((t.expiresIn || 0) / 60), note: "The key and secret work. The token itself is never shown." }
      : { ok: false, fyn: BASE, signedIn: false, error: t.error, http: t.http });
  }
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { ok: false, error: "Sign in to the firm account first." });
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const admin = createClient(URL, SERVICE);
  const { data: who } = await asUser.auth.getUser();
  const user = who?.user;
  if (!user) return reply(401, { ok: false, error: "Sign in again." });
  const { data: member } = await admin.from("members").select("firm_id, role, active").eq("user_id", user.id).maybeSingle();
  if (!member || !member.active) return reply(403, { ok: false, error: "This account is not part of a firm." });

  let body: any = {};
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
  // the person's public address, as GSTN asks for it
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "127.0.0.1";
  const action = String(body.action || "");
  const gstin = String(body.gstin || "").toUpperCase(), username = String(body.username || "").trim();

  try {
    if (action === "otp" || action === "auth" || action === "2b") {
      if (!GSTIN.test(gstin)) return reply(400, { ok: false, error: "A GSTIN is needed." });
      if (!username) return reply(400, { ok: false, error: "The taxpayer's GST portal username is needed." });
      const h = { "ip-usr": ip, "state-cd": gstin.slice(0, 2) };
      if (action === "otp") {
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
        if (x.j?.status_cd != 1) throw Object.assign(new Error(gstErr(x)), { gst: true });
        const d = x.j.data;
        if (d && typeof d === "object") return d;                            // already plain
        if (typeof d === "string" && x.j.rek) return C.openData(d, x.j.rek, sess.sek, sess.app_key);
        if (typeof d === "string") { try { return JSON.parse(new TextDecoder().decode(C.b64dec(d))); } catch { /* fall through */ } }
        throw new Error("2B came back in a form TDS Desk does not know.");
      };
      const path = "gst/returns/gstr2b/" + gstin + "/" + period;
      let out = open(await fyn("GET", path, sess));
      out = out?.data && !out.docdata ? out.data : out;
      const parts = Number(out?.fc || 0);
      if (parts > 1) {
        const all = out; all.docdata = all.docdata || {};
        for (let n = 2; n <= parts; n++) {
          let p = open(await fyn("GET", path + "?file_num=" + n, sess)); p = p?.data && !p.docdata ? p.data : p;
          Object.entries(p?.docdata || {}).forEach(([k, v]) => { all.docdata[k] = (all.docdata[k] || []).concat(v as any[]); });
        }
        out = all;
      }
      return reply(200, { ok: true, parts: parts || 1, data: out });
    }

    // the plain relay, for calls not yet given their own step
    const path = String(body.path || "").replace(/^\/+/, "");
    const method = String(body.method || "GET").toUpperCase();
    if (!PATH_OK.test(path) || !["GET", "POST", "PUT"].includes(method)) return reply(400, { ok: false, error: "Not a GST call this relay passes on." });
    const h: Record<string, string> = { "ip-usr": ip };
    Object.entries(body.headers || {}).forEach(([k, v]) => { if (HEAD_OK.has(k.toLowerCase())) h[k] = String(v); });
    const qs = body.query ? "?" + new URLSearchParams(body.query).toString() : "";
    const x = await fyn(method, path + qs, h, method === "GET" ? undefined : (body.body ?? {}));
    return reply(x.http >= 200 && x.http < 300 ? 200 : x.http, { ok: x.http >= 200 && x.http < 300, http: x.http, data: x.j ?? x.text.slice(0, 2000) });
  } catch (e) {
    return reply(200, { ok: false, error: String((e as Error).message || e) });
  }
});
