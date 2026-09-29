// FinCom GST API through TaxPro GSP's Decrypted GST API: TaxPro does GSTN's encryption, so calls carry only the ASP ID
// and ASP password (server-side here, never in the browser). Staging first; live keeps gst-api (FYN) until switched.
// Secrets: TAXPRO_ASP_PASSWORD (required), TAXPRO_ASP_ID (default below),
//   TAXPRO_BASE_URL (default sandbox https://gstsandbox.charteredinfo.com; production https://gstapi.charteredinfo.com).
// GET ?selftest=1 : sandbox only, asks an OTP for GSTN's test taxpayer and says whether TaxPro took the credentials.
// POST {action: "otp" | "auth" | "2b"} for a signed-in firm member: taxpayer OTP, auth token, GSTR-2B.
// The taxpayer's auth token stays in the caller's browser, never stored here.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BASE = (Deno.env.get("TAXPRO_BASE_URL") || "https://gstsandbox.charteredinfo.com").replace(/\/+$/, "");
const ASPID = (Deno.env.get("TAXPRO_ASP_ID") || "1811650926").trim();
const ASPPW = Deno.env.get("TAXPRO_ASP_PASSWORD") || "";
const SANDBOX = BASE.includes("sandbox");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const reply = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });

// one call to TaxPro: query in the URL, ASP credentials and taxpayer details in headers
async function tp(path: string, query: Record<string, string>, headers: Record<string, string>) {
  if (!ASPPW) throw new Error("TAXPRO_ASP_PASSWORD is not set in Edge Function secrets.");
  const r = await fetch(BASE + path + "?" + new URLSearchParams(query), {
    headers: { aspid: ASPID, password: ASPPW, txn: "FC" + Date.now() + Math.floor(Math.random() * 1e6), appver: "FinCom-1.0", ...headers },
  });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  // for the function's own logs: status and the start of the answer, never the credentials
  if (!j || String(j.status_cd) !== "1") console.log(JSON.stringify({ taxpro: path, http: r.status, head: text.slice(0, 300) }));
  return { http: r.status, j, text };
}
const tpErr = (x: { http: number; j: any; text: string }) =>
  (x.j && (x.j.error?.message ? x.j.error.message + (x.j.error.error_cd ? " (" + x.j.error.error_cd + ")" : "") : x.j.message)) || ("HTTP " + x.http + ": " + x.text.slice(0, 200));
const ok = (x: { j: any }) => String(x.j?.status_cd) === "1";

const GSTIN = /^\d{2}[A-Z0-9]{13}$/, PERIOD = /^(0[1-9]|1[0-2])20\d{2}$/;
const AUTH = "/taxpayerapi/dec/v1.0/authenticate", R2B = "/taxpayerapi/dec/v4.2/returns/gstr2b";

// GSTR-2B for a period; a large 2B comes in files (fc): take each and join their documents
async function get2b(h: Record<string, string>, gstin: string, username: string, period: string) {
  const q = { action: "GET2B", gstin, username, ret_period: period, rtnprd: period };
  const open = (x: { http: number; j: any; text: string }) => {
    if (!ok(x)) throw new Error(tpErr(x));
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
    // sandbox: GSTN's published test taxpayer; its sandbox OTP is 575757. Production is not touched (it costs credit).
    if (!SANDBOX) return reply(200, { ok: !!ASPPW, base: BASE, passwordSet: !!ASPPW, note: "Production: no free check. Fetch a 2B for a real client to test." });
    const t = { gstin: "33AANCS2882A1ZG", username: "TN_NT2.2265" }, h = { "state-cd": "33", gstin: t.gstin, username: t.username, "ip-usr": "127.0.0.1" };
    const steps: Record<string, string> = {};
    try {
      const a = await tp(AUTH, { action: "OTPREQUEST", ...t }, h); steps.otp = ok(a) ? "ok" : tpErr(a);
      const b = await tp(AUTH, { action: "AUTHTOKEN", ...t, OTP: "575757" }, h); steps.auth = ok(b) ? "ok" : tpErr(b);
      const token = b.j?.auth_token || b.j?.authtoken || b.j?.data?.auth_token || "";
      steps.authKeys = Object.keys(b.j || {}).join(",");
      if (token) {
        const g = await tp(R2B, { action: "GET2B", ...t, ret_period: "012021", rtnprd: "012021" }, { ...h, "auth-token": token, ret_period: "012021" });
        steps.gstr2b = ok(g) ? "ok" : tpErr(g);
        steps.gstr2bKeys = Object.keys(g.j?.data ?? g.j ?? {}).slice(0, 12).join(",");
      }
    } catch (e) { steps.error = String((e as Error).message || e); }
    return reply(200, { ok: steps.otp === "ok", base: BASE, steps });
  }
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { ok: false, error: "Sign in to the firm account first." });
  const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const admin = createClient(SB_URL, SERVICE);
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return reply(401, { ok: false, error: "Sign in again." });
  const { data: member } = await admin.from("members").select("firm_id, active").eq("user_id", who.user.id).maybeSingle();
  if (!member || !member.active) return reply(403, { ok: false, error: "This account is not part of a firm." });

  let body: any = {};
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
  const action = String(body.action || "");
  const gstin = String(body.gstin || "").toUpperCase(), username = String(body.username || "").trim();
  if (!["otp", "auth", "2b"].includes(action)) return reply(400, { ok: false, error: "Unknown action." });
  if (!GSTIN.test(gstin)) return reply(400, { ok: false, error: "A GSTIN is needed." });
  if (!username) return reply(400, { ok: false, error: "The taxpayer's GST portal username is needed." });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "127.0.0.1";
  const h = { "ip-usr": ip, "state-cd": gstin.slice(0, 2), gstin, username };

  try {
    if (action === "otp") {
      const x = await tp(AUTH, { action: "OTPREQUEST", gstin, username }, h);
      return reply(200, ok(x) ? { ok: true } : { ok: false, error: tpErr(x) });
    }
    if (action === "auth") {
      const otp = String(body.otp || "").trim();
      if (!/^\d{6}$/.test(otp)) return reply(400, { ok: false, error: "The OTP has 6 digits." });
      const x = await tp(AUTH, { action: "AUTHTOKEN", gstin, username, OTP: otp }, h);
      const token = x.j?.auth_token || x.j?.authtoken || x.j?.data?.auth_token || "";
      if (!ok(x) || !token) return reply(200, { ok: false, error: tpErr(x) });
      return reply(200, { ok: true, auth_token: token, expiryMinutes: Number(x.j.expiry || x.j.data?.expiry) || 0 });
    }
    const period = String(body.period || "");
    if (!PERIOD.test(period)) return reply(400, { ok: false, error: "The period is MMYYYY, e.g. 032026." });
    const token = String(body.auth_token || "");
    if (!token) return reply(400, { ok: false, error: "Sign in with the taxpayer's OTP first." });
    const r = await get2b({ ...h, "auth-token": token, ret_period: period }, gstin, username, period);
    return reply(200, { ok: true, ...r });
  } catch (e) {
    return reply(200, { ok: false, error: String((e as Error).message || e) });
  }
});
