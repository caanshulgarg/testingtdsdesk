// FinCom GST API through TaxPro GSP's Decrypted GST API: TaxPro does GSTN's encryption, so calls carry only the ASP ID
// and ASP password (server-side here, never in the browser). Staging first; live keeps gst-api (FYN) until switched.
// Secrets: TAXPRO_ASP_PASSWORD (required), TAXPRO_ASP_ID (default below),
//   TAXPRO_BASE_URL (default production https://gstapi.charteredinfo.com; sandbox https://gstsandbox.charteredinfo.com).
// The taxpayer's portal session is kept here, per firm and GSTIN (table gst_sessions, token encrypted), and renewed
// in the background (cron: action refresh-all), so one OTP lasts the taxpayer's API access period (up to 30 days on
// the portal) for every user and device of the firm. The token never goes to the browser.
// GET ?selftest=1 : always on the sandbox (free): OTP → sign-in → refresh → 2B for GSTN's test taxpayer.
// POST {action: "otp" | "auth" | "status" | "2b"} for a signed-in firm member; {action: "refresh-all"} from the cron.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BASE = (Deno.env.get("TAXPRO_BASE_URL") || "https://gstapi.charteredinfo.com").replace(/\/+$/, "");
const SANDBOX_URL = "https://gstsandbox.charteredinfo.com";
const ASPID = (Deno.env.get("TAXPRO_ASP_ID") || "1811650926").trim();
const ASPPW = Deno.env.get("TAXPRO_ASP_PASSWORD") || "";
const admin = createClient(SB_URL, SERVICE);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const reply = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });

// one call to TaxPro: query in the URL, ASP credentials and taxpayer details in headers
async function tp(path: string, query: Record<string, string>, headers: Record<string, string>, base = BASE) {
  if (!ASPPW) throw new Error("TAXPRO_ASP_PASSWORD is not set in Edge Function secrets.");
  const r = await fetch(base + path + "?" + new URLSearchParams(query), {
    headers: { aspid: ASPID, password: ASPPW, txn: "FC" + Date.now() + Math.floor(Math.random() * 1e6), appver: "FinCom-1.0", ...headers },
  });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  // for the function's own logs, failures only (never return data, tokens or the credentials)
  if (!j || j.error || String(j.status_cd) === "0") console.log(JSON.stringify({ taxpro: path, http: r.status, head: text.slice(0, 300) }));
  return { http: r.status, j, text };
}
const tpErr = (x: { http: number; j: any; text: string }) =>
  (x.j && (x.j.error?.message ? x.j.error.message + (x.j.error.error_cd ? " (" + x.j.error.error_cd + ")" : "") : x.j.message)) || ("HTTP " + x.http + ": " + x.text.slice(0, 200));
const ok = (x: { j: any }) => String(x.j?.status_cd) === "1";
const tokenOf = (x: { j: any }) => x.j?.auth_token || x.j?.authtoken || x.j?.data?.auth_token || "";
const minutesOf = (x: { j: any }) => Number(x.j?.expiry || x.j?.data?.expiry) || 120;

const GSTIN = /^\d{2}[A-Z0-9]{13}$/, PERIOD = /^(0[1-9]|1[0-2])20\d{2}$/;
const AUTH = "/taxpayerapi/dec/v1.0/authenticate", R2B = "/taxpayerapi/dec/v4.2/returns/gstr2b";
const hdr = (gstin: string, username: string, ip = "127.0.0.1") => ({ "ip-usr": ip, "state-cd": gstin.slice(0, 2), gstin, username });

// ---------- the token at rest: AES-GCM, key derived from the service key (rotating it just means new OTPs) ----------
let keyP: Promise<CryptoKey> | null = null;
const key = () => keyP ??= crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE), "HKDF", false, ["deriveKey"])
  .then((k) => crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("fincom-gst-token"), info: new Uint8Array() }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function seal(t: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(t)));
  return b64(iv) + "." + b64(ct);
}
async function unseal(s: string) {
  const [iv, ct] = s.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(ct)));
}

// ---------- sessions ----------
type Sess = { firm_id: string; gstin: string; username: string; token_enc: string; expires_at: string };
async function save(firm: string, gstin: string, username: string, token: string, mins: number, fresh: boolean) {
  const row: Record<string, unknown> = { firm_id: firm, gstin, username, token_enc: await seal(token), expires_at: new Date(Date.now() + mins * 60000).toISOString(), last_error: null };
  if (fresh) row.connected_at = new Date().toISOString(); else row.refreshed_at = new Date().toISOString();
  const { error } = await admin.from("gst_sessions").upsert(row);
  if (error) throw new Error("Could not keep the portal session: " + error.message);
}
// renew with the current token; GSTN refuses once the taxpayer's API access period has ended, then an OTP is needed
async function refresh(s: Sess): Promise<string> {
  const x = await tp(AUTH, { action: "REFRESHTOKEN", gstin: s.gstin, username: s.username }, { ...hdr(s.gstin, s.username), AuthToken: await unseal(s.token_enc), "auth-token": await unseal(s.token_enc) });
  const t = tokenOf(x);
  if (!ok(x) || !t) {
    await admin.from("gst_sessions").update({ last_error: tpErr(x) }).eq("firm_id", s.firm_id).eq("gstin", s.gstin);
    throw new Error("The portal session could not be renewed: " + tpErr(x) + ". Send an OTP again.");
  }
  await save(s.firm_id, s.gstin, s.username, t, minutesOf(x), false);
  return t;
}
// a live token for this firm's GSTIN, renewed first when it has under 15 minutes left
async function liveToken(firm: string, gstin: string): Promise<string> {
  const { data: s } = await admin.from("gst_sessions").select("*").eq("firm_id", firm).eq("gstin", gstin).maybeSingle();
  if (!s) throw new Error("Connect with the taxpayer's OTP first.");
  const left = new Date(s.expires_at).getTime() - Date.now();
  if (left <= 0) throw new Error("The portal session has ended. Send an OTP again.");
  return left < 15 * 60000 ? await refresh(s) : await unseal(s.token_enc);
}

// GSTR-2B for a period; a large 2B comes in files (fc): take each and join their documents
async function get2b(h: Record<string, string>, gstin: string, username: string, period: string) {
  const q = { action: "GET2B", gstin, username, ret_period: period, rtnprd: period };
  const open = (x: { http: number; j: any; text: string }) => {
    // 2B comes back as {chksum, data} with no status_cd; errors carry status_cd 0 and an error
    if (!ok(x) && !(x.j?.data && !x.j.error)) throw new Error(tpErr(x));
    const d = x.j.data ?? x.j;
    return d?.data && !d.docdata ? d.data : d;
  };
  let out = open(await tp(R2B, q, h));
  const parts = Number(out?.fc || 0);
  if (parts > 1) {
    const all: any = { ...out, docdata: {} };
    for (let n = 1; n <= parts; n++) {
      const p = open(await tp(R2B, { ...q, file_num: String(n) }, h));
      Object.entries(p?.docdata || {}).forEach(([k, v]) => { all.docdata[k] = (all.docdata[k] || []).concat(v as any[]); });
    }
    out = all;
  }
  return { parts: parts || 1, data: out };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new globalThis.URL(req.url);

  if (req.method === "GET" && u.searchParams.get("selftest")) {
    // GSTN's published sandbox test taxpayer (sandbox OTP 575757); production is not touched, it costs credit
    const t = { gstin: "33AANCS2882A1ZG", username: "TN_NT2.2265" }, h = hdr(t.gstin, t.username);
    const steps: Record<string, string> = {};
    try {
      const a = await tp(AUTH, { action: "OTPREQUEST", ...t }, h, SANDBOX_URL); steps.otp = ok(a) ? "ok" : tpErr(a);
      const b = await tp(AUTH, { action: "AUTHTOKEN", ...t, OTP: "575757" }, h, SANDBOX_URL); steps.auth = ok(b) ? "ok" : tpErr(b);
      let token = tokenOf(b);
      if (token) {
        const r = await tp(AUTH, { action: "REFRESHTOKEN", ...t }, { ...h, AuthToken: token, "auth-token": token }, SANDBOX_URL);
        steps.refresh = ok(r) && tokenOf(r) ? "ok, new token for " + minutesOf(r) + " min" : tpErr(r);
        token = tokenOf(r) || token;
        const g = await tp(R2B, { action: "GET2B", ...t, ret_period: "012021", rtnprd: "012021" }, { ...h, "auth-token": token, ret_period: "012021" }, SANDBOX_URL);
        steps.gstr2b = ok(g) || (g.j?.data && !g.j.error) ? "ok" : tpErr(g);
      }
      steps.sealed = (await unseal(await seal("check"))) === "check" ? "ok" : "failed";
    } catch (e) { steps.error = String((e as Error).message || e); }
    return reply(200, { ok: steps.auth === "ok", tested: SANDBOX_URL, inUse: BASE, steps });
  }
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
  let body: any = {};
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
  const action = String(body.action || "");

  // the scheduled run: renew every session that ends within 40 minutes (the cron runs every 20)
  if (action === "refresh-all") {
    const { data: good } = await admin.rpc("gst_cron_ok", { k: req.headers.get("x-cron-key") || "" });
    if (good !== true) return reply(403, { ok: false });
    const soon = new Date(Date.now() + 40 * 60000).toISOString(), now = new Date().toISOString();
    const { data: rows } = await admin.from("gst_sessions").select("*").lt("expires_at", soon).gt("expires_at", now).is("last_error", null);
    let done = 0, failed = 0;
    for (const s of rows || []) { try { await refresh(s); done++; } catch { failed++; } }
    return reply(200, { ok: true, renewed: done, failed });
  }

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { ok: false, error: "Sign in to the firm account first." });
  const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return reply(401, { ok: false, error: "Sign in again." });
  const { data: member } = await admin.from("members").select("firm_id, active").eq("user_id", who.user.id).maybeSingle();
  if (!member || !member.active) return reply(403, { ok: false, error: "This account is not part of a firm." });
  const firm = member.firm_id as string;

  try {
    // which of the firm's GSTINs are connected, and until when: never the token itself
    if (action === "status") {
      const want = (Array.isArray(body.gstins) ? body.gstins : []).map((g: unknown) => String(g).toUpperCase()).filter((g: string) => GSTIN.test(g)).slice(0, 200);
      const { data } = await admin.from("gst_sessions").select("gstin, username, expires_at, connected_at, last_error").eq("firm_id", firm).in("gstin", want);
      return reply(200, { ok: true, sessions: (data || []).map((s) => ({ gstin: s.gstin, username: s.username, until: s.expires_at, connectedAt: s.connected_at, error: s.last_error })) });
    }
    const gstin = String(body.gstin || "").toUpperCase(), username = String(body.username || "").trim();
    if (!["otp", "auth", "2b"].includes(action)) return reply(400, { ok: false, error: "Unknown action." });
    if (!GSTIN.test(gstin)) return reply(400, { ok: false, error: "A GSTIN is needed." });
    if (!username) return reply(400, { ok: false, error: "The taxpayer's GST portal username is needed." });
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "127.0.0.1";
    const h = hdr(gstin, username, ip);

    if (action === "otp") {
      const x = await tp(AUTH, { action: "OTPREQUEST", gstin, username }, h);
      return reply(200, ok(x) ? { ok: true } : { ok: false, error: tpErr(x) });
    }
    if (action === "auth") {
      const otp = String(body.otp || "").trim();
      if (!/^\d{6}$/.test(otp)) return reply(400, { ok: false, error: "The OTP has 6 digits." });
      const x = await tp(AUTH, { action: "AUTHTOKEN", gstin, username, OTP: otp }, h);
      const token = tokenOf(x);
      if (!ok(x) || !token) return reply(200, { ok: false, error: tpErr(x) });
      await save(firm, gstin, username, token, minutesOf(x), true);
      return reply(200, { ok: true, until: new Date(Date.now() + minutesOf(x) * 60000).toISOString() });
    }
    const period = String(body.period || "");
    if (!PERIOD.test(period)) return reply(400, { ok: false, error: "The period is MMYYYY, e.g. 032026." });
    const token = await liveToken(firm, gstin);
    const r = await get2b({ ...h, "auth-token": token, ret_period: period }, gstin, username, period);
    return reply(200, { ok: true, ...r });
  } catch (e) {
    return reply(200, { ok: false, error: String((e as Error).message || e) });
  }
});
