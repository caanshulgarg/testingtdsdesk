// FinCom GST API through TaxPro GSP's Decrypted API: TaxPro does GSTN's and the IRP's encryption, so calls carry only
// the ASP ID and ASP password (server-side here, never in the browser). Staging first; live keeps gst-api (FYN) until switched.
//
// Keys and sessions are kept in Supabase Vault (migration-16), read through gsp_secret_get / gsp_secret_put (service role):
//   gsp:taxpro:aspid, gsp:taxpro:password        TaxPro's ASP id and password (put there by the firm's owner, in the dashboard);
//                                                 until they are, the environment's TAXPRO_ASP_ID / TAXPRO_ASP_PASSWORD
//   gsp:sess:<firm>:<gstin>                       the taxpayer's GST portal session token (gst_sessions keeps its id)
//   gsp:einv:<firm>:<gstin>:pass / :token         the e-invoice (IRP) API user's password, and its token
//   gsp:ewb:<firm>:<gstin>:pass / :token          the e-way bill API user's password (when not the same), and its token
// A session made before migration-16 (token_enc, AES-GCM with a key derived from the service key) is still read, once.
//
// The portal session is per firm and GSTIN and renewed in the background (cron: refresh-all), so one OTP lasts the
// taxpayer's API access period (1 to 30 days, chosen on the portal) for every user of the firm. FinCom is told that period
// with the OTP, shows when it ends and reminds the firm 3 days before (daily run).
//
// Hosts: TAXPRO_BASE_URL (GST returns; default production https://gstapi.charteredinfo.com),
//        TAXPRO_EINV_URL (e-invoice and e-way bill; default the SANDBOX until set: an IRN is a legal document).
//
// GET ?selftest=1 : always on the sandbox (free): OTP → sign-in → refresh → 2B, GSTR-1 and 3B summaries for GSTN's test
//   taxpayer, the API version that answers for each, Vault, and the e-invoice sign-in for TaxPro's test GSTIN.
// POST, a signed-in firm member:
//   {action:"status", gstins}                       sessions: until, access period, ended, error (never the token)
//   {action:"otp" | "auth", gstin, username, otp?, days?}
//   {action:"2b", gstin, username, period}          2B now (kept on the server too)
//   {action:"fetch", gstin, form: 2B|R1|3B, period} fetched and kept on the server (gst_returns)
//   {action:"returns", gstins, forms?, from?, to?}  what is kept: form, period, status, when (no data)
//   {action:"return", gstin, form, period}          one kept return, with its data
//   {action:"einv-login", gstin, username, password, ewbPassword?}   the IRP / EWB API user, kept in Vault
//   {action:"einv-status", gstins}
//   {action:"irn", gstin, docKey, clientId?, inv}   an IRN for the invoice (INV-01 JSON); kept in gst_einvoices
//   {action:"irn-cancel", gstin, docKey, reason, remark}
//   {action:"ewb", gstin, docKey, trans}            an e-way bill for an e-invoiced invoice (by its IRN)
//   {action:"einvoices", gstin?, docKeys?}
// From the database's timer (x-cron-key): {action:"refresh-all"} every 20 minutes; {action:"daily"} 07:00-11:00 IST.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BASE = (Deno.env.get("TAXPRO_BASE_URL") || "https://gstapi.charteredinfo.com").replace(/\/+$/, "");
const SANDBOX_URL = "https://gstsandbox.charteredinfo.com";
const EINV = (Deno.env.get("TAXPRO_EINV_URL") || SANDBOX_URL).replace(/\/+$/, "");
const admin = createClient(SB_URL, SERVICE);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const reply = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });

// ---------- Vault ----------
const kv = new Map<string, { v: string; at: number }>();
async function sget(name: string): Promise<string> {
  const c = kv.get(name);
  if (c && Date.now() - c.at < 5 * 60000) return c.v;
  const { data, error } = await admin.rpc("gsp_secret_get", { p_name: name });
  const v = error ? "" : String(data || "");
  if (!error) kv.set(name, { v, at: Date.now() });
  return v;
}
async function sput(name: string, value: string): Promise<string> {
  const { data, error } = await admin.rpc("gsp_secret_put", { p_name: name, p_value: value });
  if (error) throw new Error("Could not keep it in Vault (" + error.message + "). Is migration-16 applied on this database?");
  kv.set(name, { v: value, at: Date.now() });
  return String(data);
}
async function asp() {
  const id = ((await sget("gsp:taxpro:aspid")) || Deno.env.get("TAXPRO_ASP_ID") || "").trim();
  const pw = (await sget("gsp:taxpro:password")) || Deno.env.get("TAXPRO_ASP_PASSWORD") || "";
  if (!id || !pw) throw new Error("TaxPro's ASP id and password are not in Vault (gsp:taxpro:aspid, gsp:taxpro:password).");
  return { id, pw };
}
const sessName = (firm: string, gstin: string) => `gsp:sess:${firm}:${gstin}`;

// one call to TaxPro's GST API: query in the URL, ASP credentials and taxpayer details in headers
async function tp(path: string, query: Record<string, string>, headers: Record<string, string>, base = BASE) {
  const k = await asp();
  const r = await fetch(base + path + "?" + new URLSearchParams(query), {
    headers: { aspid: k.id, password: k.pw, txn: "FC" + Date.now() + Math.floor(Math.random() * 1e6), appver: "FinCom-1.0", ...headers },
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
// GSTR-1 and GSTR-3B: GSTN has moved these through several versions; the first that answers is used and remembered.
// TAXPRO_R1_PATH / TAXPRO_R3B_PATH pin one
const R1_PATHS = (Deno.env.get("TAXPRO_R1_PATH") ? [Deno.env.get("TAXPRO_R1_PATH")!] : ["v4.0", "v3.1", "v1.1"].map((v) => `/taxpayerapi/dec/${v}/returns/gstr1`));
const R3B_PATHS = (Deno.env.get("TAXPRO_R3B_PATH") ? [Deno.env.get("TAXPRO_R3B_PATH")!] : ["v4.0", "v3.0", "v1.1", "v1.0"].map((v) => `/taxpayerapi/dec/${v}/returns/gstr3b`));
const hdr = (gstin: string, username: string, ip = "127.0.0.1") => ({ "ip-usr": ip, "state-cd": gstin.slice(0, 2), gstin, username });
const ret = (g: { http: number; j: any; text: string }) => ok(g) || (g.j && !g.j.error && (g.j.data || Object.keys(g.j).length > 1));
const wrongPath = (g: { http: number; text: string }) => g.http === 404 || g.http === 405 || /invalid\s+(url|api|version)|no\s+such\s+api|resource\s+not\s+found|not\s+a\s+valid\s+api/i.test(g.text);
const pathAt: Record<string, number> = {};
async function tpv(kind: string, paths: string[], query: Record<string, string>, headers: Record<string, string>, base = BASE) {
  const start = pathAt[kind + base] || 0;
  let last: any = null;
  for (let i = start; i < paths.length; i++) {
    const g = await tp(paths[i], query, headers, base);
    if (!wrongPath(g)) { pathAt[kind + base] = i; return { ...g, path: paths[i] }; }
    last = { ...g, path: paths[i] };
  }
  return last;
}
// a return that is not there yet (not filed, not made, nothing in it) is "none", not a failure
const isNone = (msg: string) => /not\s+(been\s+)?filed|not\s+generated|no\s+(invoices?|data|records?|details)\s+found|is\s+not\s+available|RET1\d{4}|RT-?3B/i.test(msg);

// ---------- the token at rest before migration-16: AES-GCM, key derived from the service key ----------
let keyP: Promise<CryptoKey> | null = null;
const key = () => keyP ??= crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE), "HKDF", false, ["deriveKey"])
  .then((k) => crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("fincom-gst-token"), info: new Uint8Array() }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function unseal(s: string) {
  const [iv, ct] = s.split(".");
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(ct)));
}

// ---------- sessions ----------
type Sess = { firm_id: string; gstin: string; username: string; token_enc: string | null; token_secret: string | null; expires_at: string; access_until?: string; ended_at?: string };
async function save(firm: string, gstin: string, username: string, token: string, mins: number, fresh: boolean, days = 0) {
  const sid = await sput(sessName(firm, gstin), token);
  const row: Record<string, unknown> = { firm_id: firm, gstin, username, token_secret: sid, token_enc: null, expires_at: new Date(Date.now() + mins * 60000).toISOString(), last_error: null, ended_at: null };
  if (fresh) {
    const d = Math.max(1, Math.min(30, Math.floor(days) || 30));
    Object.assign(row, { connected_at: new Date().toISOString(), access_days: d, access_until: new Date(Date.now() + d * 86400000).toISOString(), reminded_at: null });
  } else row.refreshed_at = new Date().toISOString();
  const { error } = await admin.from("gst_sessions").upsert(row);
  if (error) throw new Error("Could not keep the portal session: " + error.message);
}
async function tokenOfRow(s: Sess) {
  if (s.token_secret) return await sget(sessName(s.firm_id, s.gstin));
  return s.token_enc ? await unseal(s.token_enc) : "";
}
// renew with the current token; GSTN refuses once the taxpayer's API access period has ended, then an OTP is needed
async function refresh(s: Sess): Promise<string> {
  const cur = await tokenOfRow(s);
  const x = await tp(AUTH, { action: "REFRESHTOKEN", gstin: s.gstin, username: s.username }, { ...hdr(s.gstin, s.username), AuthToken: cur, "auth-token": cur });
  const t = tokenOf(x);
  if (!ok(x) || !t) {
    await admin.from("gst_sessions").update({ last_error: tpErr(x), ended_at: new Date().toISOString() }).eq("firm_id", s.firm_id).eq("gstin", s.gstin);
    throw new Error("The portal session could not be renewed: " + tpErr(x) + ". Send an OTP again.");
  }
  await save(s.firm_id, s.gstin, s.username, t, minutesOf(x), false);
  return t;
}
// a live token for this firm's GSTIN, renewed first when it has under 15 minutes left
async function liveSession(firm: string, gstin: string): Promise<{ token: string; s: Sess }> {
  const { data: s } = await admin.from("gst_sessions").select("*").eq("firm_id", firm).eq("gstin", gstin).maybeSingle();
  if (!s) throw new Error("Connect with the taxpayer's OTP first.");
  if (s.ended_at) throw new Error("The portal session has ended. Send an OTP again.");
  const left = new Date(s.expires_at).getTime() - Date.now();
  if (left <= 0) throw new Error("The portal session has ended. Send an OTP again.");
  return { token: left < 15 * 60000 ? await refresh(s) : await tokenOfRow(s), s };
}

// ---------- returns ----------
const unwrap = (x: { j: any }) => { const d = x.j?.data ?? x.j; return d?.data && !d.docdata && !d.b2b ? d.data : d; };
// GSTR-2B for a period; a large 2B comes in files (fc): take each and join their documents
async function get2b(h: Record<string, string>, gstin: string, username: string, period: string, base = BASE) {
  const q = { action: "GET2B", gstin, username, ret_period: period, rtnprd: period };
  const open = (x: { http: number; j: any; text: string }) => {
    // 2B comes back as {chksum, data} with no status_cd; errors carry status_cd 0 and an error
    if (!ok(x) && !(x.j?.data && !x.j.error)) throw new Error(tpErr(x));
    return unwrap(x);
  };
  let out = open(await tp(R2B, q, h, base));
  const parts = Number(out?.fc || 0);
  if (parts > 1) {
    const all: any = { ...out, docdata: {} };
    for (let n = 1; n <= parts; n++) {
      const p = open(await tp(R2B, { ...q, file_num: String(n) }, h, base));
      Object.entries(p?.docdata || {}).forEach(([k, v]) => { all.docdata[k] = (all.docdata[k] || []).concat(v as any[]); });
    }
    out = all;
  }
  return { parts: parts || 1, data: out };
}
// filed GSTR-1, put together as the portal's GSTR-1 JSON (so FinCom reads it as it reads a file downloaded from the portal),
// with the return's summary (RETSUM)
const R1_SECTIONS: [string, string][] = [["B2B", "b2b"], ["B2CL", "b2cl"], ["B2CS", "b2cs"], ["CDNR", "cdnr"], ["CDNUR", "cdnur"], ["EXP", "exp"],
  ["AT", "at"], ["TXP", "txpd"], ["NIL", "nil"], ["HSNSUM", "hsn"], ["DOCISS", "doc_issue"]];
async function getR1(h: Record<string, string>, gstin: string, username: string, period: string, base = BASE) {
  const q = { gstin, username, ret_period: period, rtnprd: period };
  const sum = await tpv("R1", R1_PATHS, { ...q, action: "RETSUM" }, h, base);
  if (!ret(sum)) throw new Error(tpErr(sum));
  const out: any = { gstin, fp: period, summary: unwrap(sum), source: "api" };
  const bad: string[] = [];
  for (const [act, k] of R1_SECTIONS) {
    const g = await tp(sum.path, { ...q, action: act }, h, base);
    if (!ret(g)) { const m = tpErr(g); if (!isNone(m)) bad.push(act + ": " + m); continue; }
    const d = unwrap(g), v = d?.[k] ?? d?.[act.toLowerCase()] ?? (k === "hsn" ? d?.hsn : undefined) ?? (k === "txpd" ? d?.txp : undefined);
    if (v !== undefined) out[k] = v;
  }
  if (bad.length) out.partial = bad;
  return { parts: 1 + R1_SECTIONS.length, data: out, path: sum.path };
}
async function get3b(h: Record<string, string>, gstin: string, username: string, period: string, base = BASE) {
  const g = await tpv("R3B", R3B_PATHS, { gstin, username, ret_period: period, rtnprd: period, action: "RETSUM" }, h, base);
  if (!ret(g)) throw new Error(tpErr(g));
  return { parts: 1, data: unwrap(g), path: g.path };
}
// fetched and kept: ok, none (not there yet) or error, each with when
async function fetchStore(firm: string, gstin: string, form: string, period: string, by: string | null) {
  const row: Record<string, unknown> = { firm_id: firm, gstin, form, period, fetched_at: new Date().toISOString(), fetched_by: by };
  try {
    const { token, s } = await liveSession(firm, gstin);
    const h = { ...hdr(gstin, s.username), "auth-token": token, ret_period: period };
    const r = form === "2B" ? await get2b(h, gstin, s.username, period) : form === "R1" ? await getR1(h, gstin, s.username, period) : await get3b(h, gstin, s.username, period);
    Object.assign(row, { status: "ok", data: r.data, parts: r.parts, error: (r.data as any)?.partial ? "Some tables could not be read: " + (r.data as any).partial.join("; ") : null });
  } catch (e) {
    const m = String((e as Error).message || e).slice(0, 500);
    Object.assign(row, { status: isNone(m) ? "none" : "error", error: m });
    if (/Send an OTP again|Connect with the taxpayer/.test(m)) return { status: "error", error: m };   // nothing to keep
  }
  // a later failure never takes away a return already fetched
  const { data: had } = await admin.from("gst_returns").select("status").eq("firm_id", firm).eq("gstin", gstin).eq("form", form).eq("period", period).maybeSingle();
  if (had?.status === "ok" && row.status !== "ok") {
    await admin.from("gst_returns").update({ error: row.error }).eq("firm_id", firm).eq("gstin", gstin).eq("form", form).eq("period", period);
    return { status: "ok", error: row.error, kept: true };
  }
  const { error } = await admin.from("gst_returns").upsert(row);
  if (error) throw new Error("Could not keep it: " + error.message);
  return { status: row.status, error: row.error, data: row.data };
}
// MMYYYY of the month n months before this one (India time)
function periodBack(n: number) {
  const t = new Date(Date.now() + 5.5 * 3600000); let y = t.getUTCFullYear(), m = t.getUTCMonth() + 1 - n;
  while (m < 1) { m += 12; y--; }
  return String(m).padStart(2, "0") + y;
}
// the daily run: every live session's 2B (from the 14th) and filed GSTR-1 / 3B of the last three months not kept yet, and
// a reminder 3 days before a taxpayer's API access period ends. Bounded in time: what is left is done at the next hour's run
async function daily() {
  const until = Date.now() + 110000, istDay = new Date(Date.now() + 5.5 * 3600000).getUTCDate();
  const { data: rows } = await admin.from("gst_sessions").select("*").is("ended_at", null).gt("expires_at", new Date().toISOString());
  let fetched = 0, none = 0, failed = 0;
  for (const s of rows || []) {
    if (Date.now() > until) break;
    const want: [string, string][] = [];
    if (istDay >= 14) want.push(["2B", periodBack(1)]);
    for (const n of [1, 2, 3]) { want.push(["R1", periodBack(n)]); want.push(["3B", periodBack(n)]); }
    const { data: have } = await admin.from("gst_returns").select("form, period, status, fetched_at").eq("firm_id", s.firm_id).eq("gstin", s.gstin);
    const seen = new Map((have || []).map((h: any) => [h.form + "|" + h.period, h]));
    for (const [form, period] of want) {
      if (Date.now() > until) break;
      const h: any = seen.get(form + "|" + period);
      if (h && (h.status === "ok" || Date.now() - Date.parse(h.fetched_at) < 20 * 3600000)) continue;
      const r = await fetchStore(s.firm_id, s.gstin, form, period, null).catch((e) => ({ status: "error", error: String(e) }));
      if (r.status === "ok") fetched++; else if (r.status === "none") none++; else failed++;
      if (/Send an OTP again/.test(String(r.error || ""))) break;
    }
  }
  const reminded = await remind();
  return { sessions: (rows || []).length, fetched, none, failed, reminded };
}
async function remind() {
  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  const { data: rows } = await admin.from("gst_sessions").select("firm_id, gstin, access_until").is("ended_at", null).is("reminded_at", null)
    .lt("access_until", soon).gt("access_until", new Date().toISOString());
  let n = 0;
  for (const s of rows || []) {
    await admin.from("gst_sessions").update({ reminded_at: new Date().toISOString() }).eq("firm_id", s.firm_id).eq("gstin", s.gstin);
    n++;
    await mailOwners(s.firm_id, "GST API access for " + s.gstin + " ends on " + new Date(s.access_until).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
      "The taxpayer's API access period for " + s.gstin + " ends in 3 days. After that, FinCom cannot fetch 2B or filed returns for it until the taxpayer allows API access again on the GST portal (My Profile → Manage API Access) and gives FinCom a new OTP.").catch(() => {});
  }
  return n;
}
// e-mail to the firm's owners, through Resend when it is set up (RESEND_API_KEY); the app shows the same in its view
async function mailOwners(firm: string, subject: string, text: string) {
  const KEY = Deno.env.get("RESEND_API_KEY") || "";
  if (!KEY) return;
  const { data: ms } = await admin.from("members").select("user_id").eq("firm_id", firm).eq("role", "owner").eq("active", true);
  const to: string[] = [];
  for (const m of ms || []) { const { data } = await admin.auth.admin.getUserById(m.user_id); if (data?.user?.email) to.push(data.user.email); }
  if (!to.length) return;
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("SUPPORT_MAIL_FROM") || "FinCom <onboarding@resend.dev>", to, subject, text }) });
}

// ---------- e-invoice (IRP) and e-way bill, through TaxPro's decrypted e-invoice API ----------
const einvName = (firm: string, gstin: string, what: string) => `gsp:einv:${firm}:${gstin}:${what}`;
const ewbName = (firm: string, gstin: string, what: string) => `gsp:ewb:${firm}:${gstin}:${what}`;
async function ei(method: string, path: string, q: Record<string, string>, body?: unknown, base = EINV) {
  const k = await asp();
  const r = await fetch(base + path + "?" + new URLSearchParams({ aspid: k.id, password: k.pw, ...q }), {
    method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  let data = j?.Data ?? j?.data;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { /* left as it is */ } }
  const okk = String(j?.Status ?? j?.status) === "1";
  const errs = (j?.ErrorDetails || j?.errorDetails || []).map((e: any) => (e.ErrorMessage || e.errorMessage || "") + (e.ErrorCode ? " (" + e.ErrorCode + ")" : "")).filter(Boolean);
  if (!okk) console.log(JSON.stringify({ einv: path, http: r.status, head: text.slice(0, 300) }));
  return { ok: okk, data, error: errs.join("; ") || (okk ? "" : (j?.message || "HTTP " + r.status + ": " + text.slice(0, 200))), info: j?.InfoDtls || j?.infoDtls };
}
async function einvToken(firm: string, gstin: string, fresh = false) {
  const { data: a } = await admin.from("gst_einv_accounts").select("*").eq("firm_id", firm).eq("gstin", gstin).maybeSingle();
  if (!a) throw new Error("Give the e-invoice API user for " + gstin + " first (GST settings → E-invoice and e-way bill).");
  if (!fresh && a.token_until && Date.parse(a.token_until) - Date.now() > 10 * 60000) { const t = await sget(einvName(firm, gstin, "token")); if (t) return { token: t, user: a.username }; }
  const pass = await sget(einvName(firm, gstin, "pass"));
  const x = await ei("GET", "/eivital/dec/v1.04/auth", { Gstin: gstin, user_name: a.username, eInvPwd: pass });
  const t = x.data?.AuthToken || "";
  if (!x.ok || !t) {
    await admin.from("gst_einv_accounts").update({ last_error: x.error, updated_at: new Date().toISOString() }).eq("firm_id", firm).eq("gstin", gstin);
    throw new Error("The e-invoice portal refused the sign-in: " + x.error);
  }
  await sput(einvName(firm, gstin, "token"), t);
  const until = x.data?.TokenExpiry ? new Date(String(x.data.TokenExpiry).replace(" ", "T") + "+05:30").toISOString() : new Date(Date.now() + 5 * 3600000).toISOString();
  await admin.from("gst_einv_accounts").update({ token_until: until, last_error: null, updated_at: new Date().toISOString() }).eq("firm_id", firm).eq("gstin", gstin);
  return { token: t, user: a.username };
}
const istTs = (s: unknown) => { const t = String(s || ""); if (!t) return null; const d = Date.parse(t.replace(" ", "T") + (/[zZ+]/.test(t.slice(10)) ? "" : "+05:30")); return isNaN(d) ? null : new Date(d).toISOString(); };
async function keepEinv(firm: string, gstin: string, docKey: string, set: Record<string, unknown>) {
  const { error } = await admin.from("gst_einvoices").upsert({ firm_id: firm, gstin, doc_key: docKey, updated_at: new Date().toISOString(), ...set });
  if (error) throw new Error("Could not keep it: " + error.message);
}
async function makeIrn(firm: string, gstin: string, docKey: string, clientId: string, inv: any, by: string) {
  const d = inv?.DocDtls || {};
  if (inv?.SellerDtls?.Gstin !== gstin) throw new Error("The invoice's seller GSTIN is not " + gstin + ".");
  const base = { client_id: clientId || null, doc_type: d.Typ || "INV", doc_no: d.No || "", doc_date: d.Dt ? d.Dt.split("/").reverse().join("-") : null, request: inv, created_by: by };
  let { token, user } = await einvToken(firm, gstin);
  let x = await ei("POST", "/eicore/dec/v1.03/Invoice", { Gstin: gstin, AuthToken: token, user_name: user }, inv);
  if (!x.ok && /1005|invalid token/i.test(x.error)) { ({ token, user } = await einvToken(firm, gstin, true)); x = await ei("POST", "/eicore/dec/v1.03/Invoice", { Gstin: gstin, AuthToken: token, user_name: user }, inv); }
  // made before (2150: duplicate IRN): the IRP gives the one it has for the same document
  if (!x.ok && /2150|duplicate irn/i.test(x.error)) {
    const g = await ei("GET", "/eicore/dec/v1.03/Invoice/irnbydocdetails", { Gstin: gstin, AuthToken: token, user_name: user, doctype: d.Typ || "INV", docnum: d.No || "", docdate: d.Dt || "" });
    if (g.ok) x = g;
  }
  if (!x.ok) {
    await keepEinv(firm, gstin, docKey, { ...base, irn_status: "failed", error: x.error, response: null });
    return { ok: false, error: x.error };
  }
  const r = x.data || {};
  const rec = { ...base, irn: r.Irn, ack_no: String(r.AckNo || ""), ack_dt: istTs(r.AckDt), signed_qr: r.SignedQRCode || null, signed_invoice: r.SignedInvoice || null,
    irn_status: "active", error: null, response: { AckNo: r.AckNo, AckDt: r.AckDt, Irn: r.Irn, Status: r.Status, EwbNo: r.EwbNo, EwbDt: r.EwbDt, EwbValidTill: r.EwbValidTill } };
  if (r.EwbNo) Object.assign(rec, { ewb_no: String(r.EwbNo), ewb_date: istTs(r.EwbDt), ewb_valid_till: istTs(r.EwbValidTill), ewb_status: "active" });
  await keepEinv(firm, gstin, docKey, rec);
  return { ok: true, irn: r.Irn, ackNo: String(r.AckNo || ""), ackDt: rec.ack_dt, signedQr: rec.signed_qr, ewbNo: r.EwbNo ? String(r.EwbNo) : "", info: x.info };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new globalThis.URL(req.url);

  if (req.method === "GET" && u.searchParams.get("selftest")) {
    // GSTN's published sandbox test taxpayer (sandbox OTP 575757); production is not touched, it costs credit
    const t = { gstin: "33AANCS2882A1ZG", username: "TN_NT2.2265" }, h = hdr(t.gstin, t.username);
    const steps: Record<string, string> = {};
    try {
      steps.vault = (await sget("gsp:taxpro:aspid")) ? "ok: TaxPro keys in Vault" : "TaxPro keys not in Vault yet (using the environment)";
      const a = await tp(AUTH, { action: "OTPREQUEST", ...t }, h, SANDBOX_URL); steps.otp = ok(a) ? "ok" : tpErr(a);
      const b = await tp(AUTH, { action: "AUTHTOKEN", ...t, OTP: "575757" }, h, SANDBOX_URL); steps.auth = ok(b) ? "ok" : tpErr(b);
      let token = tokenOf(b);
      if (token) {
        const r = await tp(AUTH, { action: "REFRESHTOKEN", ...t }, { ...h, AuthToken: token, "auth-token": token }, SANDBOX_URL);
        steps.refresh = ok(r) && tokenOf(r) ? "ok, new token for " + minutesOf(r) + " min" : tpErr(r);
        token = tokenOf(r) || token;
        const hh = { ...h, "auth-token": token, ret_period: "012021" };
        try { await get2b(hh, t.gstin, t.username, "012021", SANDBOX_URL); steps.gstr2b = "ok"; } catch (e) { steps.gstr2b = String((e as Error).message); }
        const r1 = await tpv("R1", R1_PATHS, { gstin: t.gstin, username: t.username, ret_period: "012021", action: "RETSUM" }, hh, SANDBOX_URL);
        steps.gstr1 = (ret(r1) ? "ok" : tpErr(r1)) + " (" + (r1?.path || "") + ")";
        const r3 = await tpv("R3B", R3B_PATHS, { gstin: t.gstin, username: t.username, ret_period: "012021", action: "RETSUM" }, hh, SANDBOX_URL);
        steps.gstr3b = (ret(r3) ? "ok" : tpErr(r3)) + " (" + (r3?.path || "") + ")";
      }
      // the e-invoice sandbox sign-in, with TaxPro's sandbox test user given as TAXPRO_EINV_TEST_GSTIN / _USER / _PASS
      const eg = Deno.env.get("TAXPRO_EINV_TEST_GSTIN") || "", eu = Deno.env.get("TAXPRO_EINV_TEST_USER") || "", ep = Deno.env.get("TAXPRO_EINV_TEST_PASS") || "";
      if (eg && eu && ep) {
        const e = await ei("GET", "/eivital/dec/v1.04/auth", { Gstin: eg, user_name: eu, eInvPwd: ep }, undefined, SANDBOX_URL);
        steps.einvoice = e.ok && e.data?.AuthToken ? "ok" : e.error;
      } else steps.einvoice = "not tried: set TAXPRO_EINV_TEST_GSTIN, _USER and _PASS to TaxPro's e-invoice sandbox user";
    } catch (e) { steps.error = String((e as Error).message || e); }
    return reply(200, { ok: steps.auth === "ok", tested: SANDBOX_URL, inUse: BASE, einvoiceHost: EINV, steps });
  }
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
  let body: any = {};
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
  const action = String(body.action || "");

  // the database's timer: renew sessions (every 20 minutes); the daily run (07:00-11:00 IST, hourly, until done)
  if (action === "refresh-all" || action === "daily") {
    const { data: good } = await admin.rpc("gst_cron_ok", { k: req.headers.get("x-cron-key") || "" });
    if (good !== true) return reply(403, { ok: false });
    if (action === "daily") { try { return reply(200, { ok: true, ...(await daily()) }); } catch (e) { return reply(200, { ok: false, error: String((e as Error).message || e) }); } }
    const soon = new Date(Date.now() + 40 * 60000).toISOString(), now = new Date().toISOString();
    const { data: rows } = await admin.from("gst_sessions").select("*").lt("expires_at", soon).gt("expires_at", now).is("ended_at", null);
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
  const firm = member.firm_id as string, me = who.user.id;
  const list = (v: unknown) => (Array.isArray(v) ? v : []).map((g: unknown) => String(g).toUpperCase()).filter((g: string) => GSTIN.test(g)).slice(0, 500);

  try {
    // which of the firm's GSTINs are connected, until when, and the access period: never the token itself
    if (action === "status") {
      const { data } = await admin.from("gst_sessions").select("gstin, username, expires_at, connected_at, refreshed_at, last_error, access_days, access_until, ended_at, reminded_at").eq("firm_id", firm).in("gstin", list(body.gstins));
      return reply(200, { ok: true, sessions: (data || []).map((s) => ({ gstin: s.gstin, username: s.username, until: s.expires_at, connectedAt: s.connected_at, refreshedAt: s.refreshed_at,
        error: s.last_error, accessDays: s.access_days, accessUntil: s.access_until, endedAt: s.ended_at, remindedAt: s.reminded_at })) });
    }
    if (action === "returns") {
      let q = admin.from("gst_returns").select("gstin, form, period, status, error, parts, fetched_at, fetched_by").eq("firm_id", firm).in("gstin", list(body.gstins));
      if (Array.isArray(body.forms) && body.forms.length) q = q.in("form", body.forms.map(String));
      const { data } = await q.limit(5000);
      return reply(200, { ok: true, returns: data || [] });
    }
    if (action === "einv-status") {
      const { data } = await admin.from("gst_einv_accounts").select("gstin, username, token_until, ewb_token_until, last_error, updated_at").eq("firm_id", firm).in("gstin", list(body.gstins));
      return reply(200, { ok: true, accounts: data || [], host: EINV === SANDBOX_URL ? "sandbox" : "production" });
    }
    if (action === "einvoices") {
      let q = admin.from("gst_einvoices").select("gstin, doc_key, doc_no, doc_date, irn, ack_no, ack_dt, signed_qr, irn_status, cancelled_at, cancel_reason, ewb_no, ewb_date, ewb_valid_till, ewb_status, error, updated_at").eq("firm_id", firm);
      if (body.gstin) q = q.eq("gstin", String(body.gstin).toUpperCase());
      if (Array.isArray(body.docKeys) && body.docKeys.length) q = q.in("doc_key", body.docKeys.map(String).slice(0, 1000));
      const { data } = await q.limit(2000);
      return reply(200, { ok: true, einvoices: data || [], host: EINV === SANDBOX_URL ? "sandbox" : "production" });
    }
    const gstin = String(body.gstin || "").toUpperCase();
    if (!GSTIN.test(gstin)) return reply(400, { ok: false, error: "A GSTIN is needed." });

    if (action === "return") {
      const { data } = await admin.from("gst_returns").select("*").eq("firm_id", firm).eq("gstin", gstin).eq("form", String(body.form || "")).eq("period", String(body.period || "")).maybeSingle();
      return reply(200, { ok: true, ret: data || null });
    }
    if (action === "fetch") {
      const form = String(body.form || ""), period = String(body.period || "");
      if (!["2B", "R1", "3B"].includes(form)) return reply(400, { ok: false, error: "Which return: 2B, R1 or 3B." });
      if (!PERIOD.test(period)) return reply(400, { ok: false, error: "The period is MMYYYY, e.g. 032026." });
      const r = await fetchStore(firm, gstin, form, period, me);
      return reply(200, { ok: r.status !== "error", ...r });
    }
    if (action === "einv-login") {
      const username = String(body.username || "").trim(), password = String(body.password || "");
      if (!username || !password) return reply(400, { ok: false, error: "The e-invoice API username and password are needed." });
      await sput(einvName(firm, gstin, "pass"), password);
      if (body.ewbPassword) await sput(ewbName(firm, gstin, "pass"), String(body.ewbPassword));
      const { error } = await admin.from("gst_einv_accounts").upsert({ firm_id: firm, gstin, username, token_until: null, last_error: null, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
      await einvToken(firm, gstin, true);
      return reply(200, { ok: true, host: EINV === SANDBOX_URL ? "sandbox" : "production" });
    }
    if (action === "irn") {
      const docKey = String(body.docKey || "");
      if (!docKey || !body.inv) return reply(400, { ok: false, error: "The invoice is needed." });
      return reply(200, await makeIrn(firm, gstin, docKey, String(body.clientId || ""), body.inv, me));
    }
    if (action === "irn-cancel") {
      const docKey = String(body.docKey || "");
      const { data: rec } = await admin.from("gst_einvoices").select("irn, ack_dt, irn_status").eq("firm_id", firm).eq("gstin", gstin).eq("doc_key", docKey).maybeSingle();
      if (!rec?.irn || rec.irn_status !== "active") return reply(200, { ok: false, error: "This invoice has no active IRN." });
      if (rec.ack_dt && Date.now() - Date.parse(rec.ack_dt) > 24 * 3600000) return reply(200, { ok: false, error: "An IRN can be cancelled only within 24 hours. Issue a credit note instead." });
      const { token, user } = await einvToken(firm, gstin);
      const x = await ei("POST", "/eicore/dec/v1.03/Invoice/Cancel", { Gstin: gstin, AuthToken: token, user_name: user },
        { Irn: rec.irn, CnlRsn: String(body.reason || "2"), CnlRem: String(body.remark || "Cancelled").slice(0, 100) });
      if (!x.ok) return reply(200, { ok: false, error: x.error });
      await keepEinv(firm, gstin, docKey, { irn_status: "cancelled", cancelled_at: istTs(x.data?.CancelDate) || new Date().toISOString(), cancel_reason: String(body.remark || "") });
      return reply(200, { ok: true });
    }
    if (action === "ewb") {
      const docKey = String(body.docKey || ""), t = body.trans || {};
      const { data: rec } = await admin.from("gst_einvoices").select("irn, irn_status, ewb_no, ewb_status").eq("firm_id", firm).eq("gstin", gstin).eq("doc_key", docKey).maybeSingle();
      if (!rec?.irn || rec.irn_status !== "active") return reply(200, { ok: false, error: "Make the IRN first: the e-way bill is made from it." });
      if (rec.ewb_no && rec.ewb_status === "active") return reply(200, { ok: false, error: "This invoice already has e-way bill " + rec.ewb_no + "." });
      const req1 = { Irn: rec.irn, Distance: Math.max(0, Math.floor(Number(t.distance) || 0)), TransMode: t.vehicleNo ? String(t.mode || "1") : undefined, TransId: t.transporterId || undefined,
        TransName: t.transporterName || undefined, TrnDocNo: t.docNo || undefined, TrnDocDt: t.docDate || undefined, VehNo: t.vehicleNo ? String(t.vehicleNo).replace(/[^A-Z0-9]/gi, "").toUpperCase() : undefined,
        VehType: t.vehicleNo ? (t.odc ? "O" : "R") : undefined };
      let { token, user } = await einvToken(firm, gstin);
      let x = await ei("POST", "/eiewb/dec/v1.03/ewaybill", { Gstin: gstin, AuthToken: token, user_name: user }, req1);
      if (!x.ok && /1005|invalid token/i.test(x.error)) { ({ token, user } = await einvToken(firm, gstin, true)); x = await ei("POST", "/eiewb/dec/v1.03/ewaybill", { Gstin: gstin, AuthToken: token, user_name: user }, req1); }
      if (!x.ok) { await keepEinv(firm, gstin, docKey, { ewb_status: "failed", error: x.error }); return reply(200, { ok: false, error: x.error }); }
      const r = x.data || {};
      await keepEinv(firm, gstin, docKey, { ewb_no: String(r.EwbNo || ""), ewb_date: istTs(r.EwbDt), ewb_valid_till: istTs(r.EwbValidTill), ewb_status: "active", error: null });
      return reply(200, { ok: true, ewbNo: String(r.EwbNo || ""), ewbDate: istTs(r.EwbDt), validTill: istTs(r.EwbValidTill) });
    }

    const username = String(body.username || "").trim();
    if (!["otp", "auth", "2b"].includes(action)) return reply(400, { ok: false, error: "Unknown action." });
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
      const days = Math.max(1, Math.min(30, Math.floor(Number(body.days) || 30)));
      await save(firm, gstin, username, token, minutesOf(x), true, days);
      return reply(200, { ok: true, until: new Date(Date.now() + minutesOf(x) * 60000).toISOString(), accessUntil: new Date(Date.now() + days * 86400000).toISOString(), accessDays: days });
    }
    // 2B now, as before (the browser keeps it with the books), and kept on the server
    const period = String(body.period || "");
    if (!PERIOD.test(period)) return reply(400, { ok: false, error: "The period is MMYYYY, e.g. 032026." });
    const r = await fetchStore(firm, gstin, "2B", period, me);
    if (r.status !== "ok") return reply(200, { ok: false, error: r.error || "2B is not there yet." });
    const { data: kept } = await admin.from("gst_returns").select("data, parts").eq("firm_id", firm).eq("gstin", gstin).eq("form", "2B").eq("period", period).maybeSingle();
    return reply(200, { ok: true, parts: kept?.parts || 1, data: kept?.data });
  } catch (e) {
    return reply(200, { ok: false, error: String((e as Error).message || e) });
  }
});
