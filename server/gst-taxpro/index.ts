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
// GET ?selftest=1 (a signed-in firm owner, as below; 5 an hour per firm) : always on the sandbox (free): OTP → sign-in → refresh → 2B, GSTR-1 and 3B summaries for GSTN's test
//   taxpayer, the API version that answers for each, Vault, and the e-invoice sign-in for TaxPro's test GSTIN.
// POST, a signed-in firm member (two-step sign-in checked as the gateway checks it: rpc mfa_ok). A look-only member
// (any role but owner or staff) may only read: status, returns, return, einv-status, einvoices, filing. Error replies are plain;
// the raw detail is in the function's log only.
//   {action:"status", gstins}                       sessions: until, access period, ended, error (never the token)
//   {action:"otp" | "auth", gstin, username, otp?, days?}   only for a GSTIN with a client's PAN; OTPs 10 an hour per firm (with
//                                                   gst-api's), 3 per 15 minutes and 10 a day per GSTIN; sign-ins 5 per 15 minutes
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
// Filing through the GST API (17-Oct-2026, docs/gst-filing-api.md; migration-94): an owner or staff member, never the timer:
//   {action:"filing", gstin, form: R1|IFF|3B, period}          where the return stands, and its log
//   {action:"save", gstin, form, period, payload}               RETSAVE, then RETSTATUS until processed
//   {action:"summary", gstin, form, period}                     RETSUM beside FinCom's figures; 3B: the set-off too
//   {action:"confirm", gstin, form, period, accept?, note?}     a person: the summary matches, or these differences accepted
//   {action:"proceed", gstin, form, period}                     GSTR-1/IFF: proceed to file; 3B: offset the liability
//   {action:"evc_otp", gstin, form, period, pan}                the signatory's EVC OTP asked for (the portal sends it); 5 an hour per return
//   {action:"file", gstin, form, period, pan, otp}              a person's click: RETFILE with EVC; the ARN kept
//   {action:"track", gstin, form, period}                       the portal's status of the return (RETTRACK), ARN
// Sent once (item 1 of the state-machine review, 12-Nov-2026; migration-173): every action that writes takes the return's
// lease first (busy_token / busy_until, a compare-and-set), so one action at a time runs on a return and a second is told
// it is already in progress; each write is conditional on the lease. Once proceeded (3B: the tax set off), nothing goes
// back before proceeded. A File whose answer had no ARN is followed by RETTRACK before RETFILE is sent again.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsFor } from "../_shared/cors.ts";   // the one list of headers for every function (server/_shared/cors.ts)
import { clientIp } from "../_shared/clientip.ts";
import { after2b } from "./automatch.ts";
import { firmGate, viaClient } from "../_shared/firmgate.ts";   // the console's switches (migration 118)
import { r1Figures, r1PortalFigures, r3bFigures, compare, sameFigures, setoff, ledgersOf, writeAllowed, cleanR1, cleanR3b, safeText, Plain, reached, offsetDone, refusedClearly } from "./filing.ts";
import { AsyncLocalStorage } from "node:async_hooks";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BASE = (Deno.env.get("TAXPRO_BASE_URL") || "https://gstapi.charteredinfo.com").replace(/\/+$/, "");
const SANDBOX_URL = "https://gstsandbox.charteredinfo.com";
const EINV = (Deno.env.get("TAXPRO_EINV_URL") || SANDBOX_URL).replace(/\/+$/, "");
const admin = createClient(SB_URL, SERVICE);

// "*": the database's timer calls it too (x-cron-key), and every browser call needs a signed-in firm member
const cors = corsFor(null, { any: true, methods: "GET, POST, OPTIONS" });
const reply = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });

// what a person is told is plain: a Plain message as it is, anything else (database, network or code) one fixed sentence;
// the raw detail goes to the function's log only (security review F11)
const SORRY = "Something went wrong on FinCom's side. Try again in a moment.";
function plain(e: unknown, where: string, ...secret: string[]): string {
  if (e instanceof Plain) return e.message;
  console.error(JSON.stringify({ fn: "gst-taxpro", where, error: scrub(String((e as Error)?.message || e), ...secret).slice(0, 500) }));
  return SORRY;
}
// what may go to a log (security review M1): the query of any address cut off (Deno's fetch errors carry the whole URL,
// and the e-invoice API's URLs carry the ASP id and password and the e-invoice password; AUTHTOKEN's carries the OTP),
// credential-like parameters masked wherever they appear, and each value given masked too
function scrub(t: unknown, ...secret: string[]): string {
  let s = String(t ?? "");
  for (const v of secret) if (v && v.length >= 4) s = s.split(v).join("***");
  return s.replace(/(https?:\/\/[^\s?#()]+)\?[^\s()]*/gi, "$1?…").replace(/\b(otp|password|einvpwd|aspid|authtoken|auth-token)=[^&\s()"]*/gi, "$1=***");
}

// ---------- limits (security review H1, L7) ----------
// Counted in the database (auth_rate_hit, server/security/migration-112-auth-rate-limits.sql: one count across the
// function's running copies; the key hashed), as gst-api counts its OTPs. "gst-otp-firm" is gst-api's own bucket and key,
// so the two functions share one count per firm. A database without auth_rate_hit (PGRST202, 42883): counted in this
// running copy only (logged). Any other failure to count: a closed limit refuses (nothing sent), the others count here
const LIMITS = {
  otpFirm: { bucket: "gst-otp-firm", max: 10, window: 3600, closed: true },        // OTPs one firm asks for (each a paid TaxPro call)
  otpGstin: { bucket: "gst-otp-gstin", max: 3, window: 900, closed: true },        // OTPs sent to one taxpayer (SMS and email), whichever firm asks
  otpDay: { bucket: "gst-otp-gstin-day", max: 10, window: 86400, closed: true },   // the same, in a day
  auth: { bucket: "gst-auth", max: 5, window: 900, closed: true },                 // OTPs tried for one firm's GSTIN
  einvLogin: { bucket: "gst-einv-login", max: 5, window: 900, closed: true },      // e-invoice sign-ins for one firm's GSTIN
  selftest: { bucket: "gst-selftest", max: 5, window: 3600, closed: false },       // the sandbox self-test, per firm
  evc: { bucket: "gst-evc-otp", max: 5, window: 3600, closed: false },             // the signatory's EVC OTP, per return
};
type Limit = { bucket: string; max: number; window: number; closed: boolean };
const inWords = (s: number) => s >= 86400 ? "24 hours" : s >= 3600 ? "an hour" : Math.round(s / 60) + " minutes";
const LIMIT_DOWN = "FinCom could not check its limit just now, so nothing was sent. Please try again in a moment.";
async function sha256hex(t: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
const hitsHere = new Map<string, number[]>();
// true: allowed (and counted); false: over the limit; null: not checked (a closed limit when the database failed)
async function allowed(l: Limit, key: string): Promise<boolean | null> {
  const k = await sha256hex(key);
  const { data, error } = await admin.rpc("auth_rate_hit", { p_bucket: l.bucket, p_key: k, p_max: l.max, p_window_s: l.window });
  if (!error) return data === true;
  const missing = error.code === "PGRST202" || error.code === "42883";
  if (l.closed && !missing) {
    console.error(JSON.stringify({ fn: "gst-taxpro", where: "limit " + l.bucket, code: error.code || null, error: String(error.message || "").slice(0, 300), note: "refused: the limit could not be checked" }));
    return null;
  }
  console.error(JSON.stringify({ fn: "gst-taxpro", where: "limit " + l.bucket, code: error.code || null, error: String(error.message || "").slice(0, 300), note: "counted in this running copy only" }));
  const now = Date.now(), id = l.bucket + ":" + k, seen = (hitsHere.get(id) || []).filter((t) => now - t < l.window * 1000);
  if (seen.length >= l.max) { hitsHere.set(id, seen); return false; }
  seen.push(now); hitsHere.set(id, seen);
  return true;
}
// the GSTIN is one of the firm's clients' (not deleted, not deactivated): its PAN (characters 3-12) is a client's PAN, as
// typed or as in the client's own GSTIN, since every registration added to a client must carry the client's PAN
// (src/js/36-gst-settings.js clientPan); a GSTIN without a PAN in it (UIN, TDS/TCS) only by itself
async function firmClient(firm: string, gstin: string): Promise<boolean> {
  const pan = gstin.slice(2, 12), q = () => admin.from("clients").select("id, deleted, status").eq("firm_id", firm);
  const asks = /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) ? [q().ilike("pan", pan), q().ilike("gstin", "__" + pan + "%")] : [q().ilike("gstin", gstin)];
  for (const a of asks) {
    const { data, error } = await a.limit(100);
    if (error) dbFail("clients", error, "Your firm's clients could not be read. Nothing was sent; try again in a moment.");
    if ((data || []).some((c: any) => c.deleted !== true && c.status !== "deactivated")) return true;
  }
  return false;
}
const NOT_CLIENT = "That GSTIN is not one of your firm's clients. Add the client first.";
function dbFail(where: string, error: { message?: string; code?: string }, say: string): never {
  console.error(JSON.stringify({ fn: "gst-taxpro", where, code: error.code || null, error: String(error.message || "").slice(0, 500) }));
  throw new Plain(say);
}

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
  if (error) dbFail("vault", error, "It could not be kept safely. Try again in a moment.");
  kv.set(name, { v: value, at: Date.now() });
  return String(data);
}
async function asp() {
  const id = ((await sget("gsp:taxpro:aspid")) || Deno.env.get("TAXPRO_ASP_ID") || "").trim();
  const pw = (await sget("gsp:taxpro:password")) || Deno.env.get("TAXPRO_ASP_PASSWORD") || "";
  if (!id || !pw) { console.error(JSON.stringify({ fn: "gst-taxpro", where: "asp", error: "TaxPro's ASP id and password are not in Vault (gsp:taxpro:aspid, gsp:taxpro:password)" })); throw new Plain("The GST service is not set up for FinCom yet."); }
  return { id, pw };
}
const sessName = (firm: string, gstin: string) => `gsp:sess:${firm}:${gstin}`;

// time limits of a filing action (12-Nov-2026, migration-173): the worker is stopped at 150 s (the edge's wall clock), so
// an action has ACTION_BUDGET in all; each read waits at most READ_WAIT and each write (PUT, POST) at most WRITE_WAIT, and a
// write is not begun with less than WRITE_MIN left. A write whose answer did not come in time counts as answered unclearly
// (never sent again blindly). Other actions (2B, fetch, e-invoices) have no limit, as before
const WRITE_WAIT = Math.max(1000, Number(Deno.env.get("TAXPRO_WRITE_WAIT_MS") || 60000));
const READ_WAIT = Math.max(1000, Number(Deno.env.get("TAXPRO_READ_WAIT_MS") || 20000));
const ACTION_BUDGET = Math.max(5000, Number(Deno.env.get("TAXPRO_ACTION_BUDGET_MS") || 110000));
const WRITE_MIN = Math.min(WRITE_WAIT, 20000);
const deadline = new AsyncLocalStorage<number>();   // when the filing action running must be done (ms since 1970)
const timeLeft = () => { const d = deadline.getStore(); return d === undefined ? Infinity : d - Date.now(); };
// a call to the portal that failed: sent says whether it may have reached it (filing.ts reached())
class SendErr extends Plain { constructor(msg: string, public sent: boolean) { super(msg); } }
// one call to TaxPro's GST API: query in the URL, ASP credentials and taxpayer details in headers
// (filing: a PUT or POST with a JSON body; the body is never logged)
async function tp(path: string, query: Record<string, string>, headers: Record<string, string>, base = BASE, method = "GET", body?: unknown) {
  const k = await asp();
  const left = timeLeft(), write = method !== "GET";
  if (left !== Infinity && left < (write ? WRITE_MIN : 1000)) throw new SendErr("The GST service is slow to answer today; nothing more was sent. Try again in a few minutes.", false);
  const wait = left === Infinity ? (write ? WRITE_WAIT : 0) : Math.min(write ? WRITE_WAIT : READ_WAIT, left);
  let r: Response, text: string;
  try {
    r = await fetch(base + path + "?" + new URLSearchParams(query), {
      method, body: body === undefined ? undefined : JSON.stringify(body), signal: wait ? AbortSignal.timeout(wait) : undefined,
      headers: { aspid: k.id, password: k.pw, txn: "FC" + Date.now() + Math.floor(Math.random() * 1e6), appver: "FinCom-1.0", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    });
    text = await r.text();
  } catch (e) {
    const sent = reached(e);
    console.log(JSON.stringify({ taxpro: path, action: query.action, failed: String((e as Error)?.name || "") + ": " + scrub(String((e as Error)?.message || e), k.id, k.pw, query.OTP || "").slice(0, 200), sent }));
    throw new SendErr(sent ? "The GST service did not answer in time." : "The GST service could not be reached.", sent);
  }
  let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  // for the function's own logs, failures only (never return data, tokens, the credentials or an OTP)
  if (!j || j.error || String(j.status_cd) === "0") console.log(JSON.stringify({ taxpro: path, action: query.action, http: r.status, head: scrub(safeText(text.slice(0, 300), String((body as any)?.sid || "").split("|")[1] || ""), k.pw, query.OTP || "") }));
  return { http: r.status, j, text };
}
const tpErr = (x: { http: number; j: any; text: string }) =>
  (x.j && (x.j.error?.message ? x.j.error.message + (x.j.error.error_cd ? " (" + x.j.error.error_cd + ")" : "") : x.j.message)) || ("The GST service answered HTTP " + x.http + ".");   // its text is in the log (tp)
const ok = (x: { j: any }) => String(x.j?.status_cd) === "1";
const tokenOf = (x: { j: any }) => x.j?.auth_token || x.j?.authtoken || x.j?.data?.auth_token || "";
const minutesOf = (x: { j: any }) => Number(x.j?.expiry || x.j?.data?.expiry) || 120;

const GSTIN = /^\d{2}[A-Z0-9]{13}$/, PERIOD = /^(0[1-9]|1[0-2])20\d{2}$/;
const AUTH = "/taxpayerapi/dec/v1.0/authenticate", R2B = "/taxpayerapi/dec/v4.2/returns/gstr2b";
// GSTR-1 and GSTR-3B: GSTN has moved these through several versions; the first that answers is used and remembered.
// TAXPRO_R1_PATH / TAXPRO_R3B_PATH pin one
const R1_PATHS = (Deno.env.get("TAXPRO_R1_PATH") ? [Deno.env.get("TAXPRO_R1_PATH")!] : ["v4.0", "v3.1", "v1.1"].map((v) => `/taxpayerapi/dec/${v}/returns/gstr1`));
const R3B_PATHS = (Deno.env.get("TAXPRO_R3B_PATH") ? [Deno.env.get("TAXPRO_R3B_PATH")!] : ["v4.0", "v3.0", "v1.1", "v1.0"].map((v) => `/taxpayerapi/dec/${v}/returns/gstr3b`));
// the return status list (RETTRACK, request of 02-Oct-2026): each return filed for a financial year, with its ARN and date
const TRACK_PATHS = (Deno.env.get("TAXPRO_TRACK_PATH") ? [Deno.env.get("TAXPRO_TRACK_PATH")!] : ["/taxpayerapi/dec/v1.0/returns", "/taxpayerapi/v1.0/returns"]);
const FY = /^20\d{2}-\d{2}$/;
const hdr = (gstin: string, username: string, ip = "127.0.0.1") => ({ "ip-usr": ip, "state-cd": gstin.slice(0, 2), gstin, username });
const ret = (g: { http: number; j: any; text: string }) => ok(g) || (g.j && !g.j.error && (g.j.data || Object.keys(g.j).length > 1));
const wrongPath = (g: { http: number; text: string }) => g.http === 404 || g.http === 405 || /invalid\s+(url|api|version)|no\s+such\s+api|resource\s+not\s+found|not\s+a\s+valid\s+api/i.test(g.text);
const pathAt: Record<string, number> = {};
async function tpv(kind: string, paths: string[], query: Record<string, string>, headers: Record<string, string>, base = BASE, method = "GET", body?: unknown) {
  const start = pathAt[kind + base] || 0;
  let last: any = null;
  for (let i = start; i < paths.length; i++) {
    const g = await tp(paths[i], query, headers, base, method, body);
    if (!wrongPath(g)) { pathAt[kind + base] = i; return { ...g, path: paths[i] }; }
    last = { ...g, path: paths[i] };
  }
  return last;
}
// a return that is not there yet (not filed, not made, nothing in it) is "none", not a failure
// (the sandbox, 01-Oct-2026: "Latest Summary is not available" (RET09001) and "GSTR-2B is being generated" (RET2B1023))
const isNone = (msg: string) => /not\s+(been\s+)?filed|not\s+generated|being\s+generated|generation\s+is\s+(still\s+)?in\s+progress|summary\s+is\s+not\s+available|no\s+(invoices?|data|records?|details)\s+found|is\s+not\s+available|RET1\d{4}|RET09001|RET2B1023|RT-?3B/i.test(msg);

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
  if (error) dbFail("gst_sessions", error, "The portal session could not be kept. Try again in a moment.");
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
    throw new Plain("The portal session could not be renewed: " + tpErr(x) + ". Send an OTP again.");
  }
  await save(s.firm_id, s.gstin, s.username, t, minutesOf(x), false);
  return t;
}
// a live token for this firm's GSTIN, renewed first when it has under 15 minutes left
async function liveSession(firm: string, gstin: string): Promise<{ token: string; s: Sess }> {
  const { data: s } = await admin.from("gst_sessions").select("*").eq("firm_id", firm).eq("gstin", gstin).maybeSingle();
  if (!s) throw new Plain("Connect with the taxpayer's OTP first.");
  if (s.ended_at) throw new Plain("The portal session has ended. Send an OTP again.");
  const left = new Date(s.expires_at).getTime() - Date.now();
  if (left <= 0) throw new Plain("The portal session has ended. Send an OTP again.");
  return { token: left < 15 * 60000 ? await refresh(s) : await tokenOfRow(s), s };
}

// ---------- returns ----------
const unwrap = (x: { j: any }) => { const d = x.j?.data ?? x.j; return d?.data && !d.docdata && !d.b2b ? d.data : d; };
// GSTR-2B for a period; a large 2B comes in files (fc): take each and join their documents
async function get2b(h: Record<string, string>, gstin: string, username: string, period: string, base = BASE) {
  const q = { action: "GET2B", gstin, username, ret_period: period, rtnprd: period };
  const open = (x: { http: number; j: any; text: string }) => {
    // 2B comes back as {chksum, data} with no status_cd; errors carry status_cd 0 and an error
    if (!ok(x) && !(x.j?.data && !x.j.error)) throw new Plain(tpErr(x));
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
  if (!ret(sum)) throw new Plain(tpErr(sum));
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
  if (!ret(g)) throw new Plain(tpErr(g));
  return { parts: 1, data: unwrap(g), path: g.path };
}
async function getTrack(h: Record<string, string>, gstin: string, username: string, fy: string, base = BASE) {
  const g = await tpv("TRACK", TRACK_PATHS, { gstin, username, action: "RETTRACK", fy }, h, base);
  if (!ret(g)) throw new Plain(tpErr(g));
  const d = unwrap(g) || {};
  const list = d.EFiledlist || d.efiledlist || d.EFiledList || (Array.isArray(d) ? d : []);
  return { parts: 1, data: { fy, EFiledlist: Array.isArray(list) ? list : [] }, path: g.path };
}
// the financial year of today, or of n months ago (India time)
function fyBack(n = 0) { const p = periodBack(n), m = +p.slice(0, 2), y = +p.slice(2); const s = m >= 4 ? y : y - 1; return s + "-" + String(s + 1).slice(2); }
// fetched and kept: ok, none (not there yet) or error, each with when
async function fetchStore(firm: string, gstin: string, form: string, period: string, by: string | null) {
  const row: Record<string, unknown> = { firm_id: firm, gstin, form, period, fetched_at: new Date().toISOString(), fetched_by: by };
  try {
    const { token, s } = await liveSession(firm, gstin);
    const h = { ...hdr(gstin, s.username), "auth-token": token, ret_period: period };
    const r = form === "2B" ? await get2b(h, gstin, s.username, period) : form === "R1" ? await getR1(h, gstin, s.username, period)
      : form === "TRACK" ? await getTrack(h, gstin, s.username, period) : await get3b(h, gstin, s.username, period);
    Object.assign(row, { status: "ok", data: r.data, parts: r.parts, error: (r.data as any)?.partial ? "Some tables could not be read: " + (r.data as any).partial.join("; ") : null });
  } catch (e) {
    const m = plain(e, "fetch " + form).slice(0, 500);
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
  if (error) dbFail("gst_returns", error, "The return could not be kept. Try again in a moment.");
  // a 2B fetched: matched against the books by itself (round 72b; automatch.ts, gst-2b-match), never holding up the fetch
  if (form === "2B" && row.status === "ok") {
    const p = after2b({
      rpc: async (fn, args) => { const { data, error: e } = await admin.rpc(fn, args); if (e) throw new Error(e.message); return data; },
      poke: () => fetch(SB_URL + "/functions/v1/gst-2b-match", { method: "POST", headers: { Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }, body: JSON.stringify({ action: "queue" }) }).then((r) => r.body?.cancel()),
    }, firm, gstin, form, period, "ok");
    (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  }
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
    // the returns filed this year (and last year's, until June): marked filed in the books with ARN and date
    want.push(["TRACK", fyBack(0)]); if (fyBack(3) !== fyBack(0)) want.push(["TRACK", fyBack(3)]);
    const { data: have } = await admin.from("gst_returns").select("form, period, status, fetched_at").eq("firm_id", s.firm_id).eq("gstin", s.gstin);
    const seen = new Map((have || []).map((h: any) => [h.form + "|" + h.period, h]));
    for (const [form, period] of want) {
      if (Date.now() > until) break;
      const h: any = seen.get(form + "|" + period);
      // a return fetched is kept; the status list changes as returns are filed, so it is read again after 20 hours
      if (h && ((h.status === "ok" && form !== "TRACK") || Date.now() - Date.parse(h.fetched_at) < 20 * 3600000)) continue;
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
// TaxPro's decrypted e-invoice API takes the ASP id and password, the e-invoice password (eInvPwd) and the token in the
// query (its documented form; unlike the GST API, headers are not documented for it), so the URL is never logged: a
// failure is logged with the query cut off and every credential masked (security review M1)
async function ei(method: string, path: string, q: Record<string, string>, body?: unknown, base = EINV) {
  const k = await asp(), hide = [k.id, k.pw, q.eInvPwd || "", q.AuthToken || ""];
  let r: Response, text: string;
  try {
    r = await fetch(base + path + "?" + new URLSearchParams({ aspid: k.id, password: k.pw, ...q }), {
      method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    text = await r.text();
  } catch (e) {
    console.log(JSON.stringify({ einv: path, failed: String((e as Error)?.name || "") + ": " + scrub(String((e as Error)?.message || e), ...hide).slice(0, 200) }));
    throw new Plain("The e-invoice service could not be reached. Try again in a moment.");
  }
  let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
  let data = j?.Data ?? j?.data;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { /* left as it is */ } }
  const okk = String(j?.Status ?? j?.status) === "1";
  const errs = (j?.ErrorDetails || j?.errorDetails || []).map((e: any) => (e.ErrorMessage || e.errorMessage || "") + (e.ErrorCode ? " (" + e.ErrorCode + ")" : "")).filter(Boolean);
  if (!okk) console.log(JSON.stringify({ einv: path, http: r.status, head: scrub(text.slice(0, 300), ...hide) }));
  return { ok: okk, data, error: errs.join("; ") || (okk ? "" : (j?.message || "The e-invoice service answered HTTP " + r.status + ".")), info: j?.InfoDtls || j?.infoDtls };
}
async function einvToken(firm: string, gstin: string, fresh = false) {
  const { data: a } = await admin.from("gst_einv_accounts").select("*").eq("firm_id", firm).eq("gstin", gstin).maybeSingle();
  if (!a) throw new Plain("Give the e-invoice API user for " + gstin + " first (GST settings → E-invoice and e-way bill).");
  if (!fresh && a.token_until && Date.parse(a.token_until) - Date.now() > 10 * 60000) { const t = await sget(einvName(firm, gstin, "token")); if (t) return { token: t, user: a.username }; }
  const pass = await sget(einvName(firm, gstin, "pass"));
  const x = await ei("GET", "/eivital/dec/v1.04/auth", { Gstin: gstin, user_name: a.username, eInvPwd: pass });
  const t = x.data?.AuthToken || "";
  if (!x.ok || !t) {
    await admin.from("gst_einv_accounts").update({ last_error: x.error, updated_at: new Date().toISOString() }).eq("firm_id", firm).eq("gstin", gstin);
    throw new Plain("The e-invoice portal refused the sign-in: " + x.error);
  }
  await sput(einvName(firm, gstin, "token"), t);
  const until = x.data?.TokenExpiry ? new Date(String(x.data.TokenExpiry).replace(" ", "T") + "+05:30").toISOString() : new Date(Date.now() + 5 * 3600000).toISOString();
  await admin.from("gst_einv_accounts").update({ token_until: until, last_error: null, updated_at: new Date().toISOString() }).eq("firm_id", firm).eq("gstin", gstin);
  return { token: t, user: a.username };
}
const istTs = (s: unknown) => { const t = String(s || ""); if (!t) return null; const d = Date.parse(t.replace(" ", "T") + (/[zZ+]/.test(t.slice(10)) ? "" : "+05:30")); return isNaN(d) ? null : new Date(d).toISOString(); };
async function keepEinv(firm: string, gstin: string, docKey: string, set: Record<string, unknown>) {
  const { error } = await admin.from("gst_einvoices").upsert({ firm_id: firm, gstin, doc_key: docKey, updated_at: new Date().toISOString(), ...set });
  if (error) dbFail("gst_einvoices", error, "The e-invoice could not be kept. Try again in a moment.");
}
async function makeIrn(firm: string, gstin: string, docKey: string, clientId: string, inv: any, by: string) {
  const d = inv?.DocDtls || {};
  if (inv?.SellerDtls?.Gstin !== gstin) throw new Plain("The invoice's seller GSTIN is not " + gstin + ".");
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

// ---------- filing through the GST API (docs/gst-filing-api.md; migration-94) ----------
// The owner's decisions of 17-Oct-2026: FinCom saves; a person compares the portal's summary with FinCom's and confirms
// (or accepts the differences listed, with a reason); a person files with the signatory's EVC OTP. The OTP is sent once
// and kept nowhere. Writes go to TaxPro's sandbox, or to production only when TAXPRO_FILE_LIVE=yes.
const FILE_LIVE = Deno.env.get("TAXPRO_FILE_LIVE") || "";
const FORMS: Record<string, { paths: string[]; kind: string; formType: string; rtn: string; label: string; track: string[] }> = {
  R1: { paths: R1_PATHS, kind: "R1", formType: "R1", rtn: "GSTR1", label: "GSTR-1", track: ["GSTR1"] },
  IFF: { paths: R1_PATHS, kind: "R1", formType: "R1", rtn: "GSTR1", label: "IFF", track: ["IFF", "GSTR1"] },
  "3B": { paths: R3B_PATHS, kind: "R3B", formType: "R3B", rtn: "GSTR3B", label: "GSTR-3B", track: ["GSTR3B"] },
};
const STATUS_PATHS = (Deno.env.get("TAXPRO_STATUS_PATH") ? [Deno.env.get("TAXPRO_STATUS_PATH")!] : TRACK_PATHS);
const LEDGER_PATHS = (Deno.env.get("TAXPRO_LEDGER_PATH") ? [Deno.env.get("TAXPRO_LEDGER_PATH")!] : ["/taxpayerapi/dec/v1.0/ledgers", "/taxpayerapi/dec/v0.3/ledgers"]);
const EVC_PATH = Deno.env.get("TAXPRO_EVC_PATH") || AUTH;
const STATUS_TRIES = Math.max(1, Number(Deno.env.get("TAXPRO_STATUS_TRIES") || 6)), STATUS_WAIT = Math.max(0, Number(Deno.env.get("TAXPRO_STATUS_WAIT_MS") || 2500));
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
type Who = { firm: string; me: string };
type Ret = { gstin: string; form: string; period: string };
// where the return stands; a database that cannot be read stops the action (never taken for "no row yet")
async function filingRow(w: Who, r: Ret) {
  const { data, error } = await admin.from("gst_filings").select("*").eq("firm_id", w.firm).eq("gstin", r.gstin).eq("form", r.form).eq("period", r.period).maybeSingle();
  if (error) dbFail("gst_filings read", error, "Where this return stands could not be read. Nothing was sent; try again in a moment.");
  return data as any;
}
// a first save: the row made (on conflict do nothing, so a row already there is never overwritten), then held by the
// lease like any other; until the save's answer is kept it stands as failed, "not saved yet"
async function newFiling(w: Who, r: Ret) {
  const { error } = await admin.from("gst_filings").upsert({ firm_id: w.firm, gstin: r.gstin, form: r.form, period: r.period, status: "failed", error: "not saved yet", updated_at: new Date().toISOString() },
    { onConflict: "firm_id,gstin,form,period", ignoreDuplicates: true });
  if (error) dbFail("gst_filings new", error, "The filing could not be started. Try again in a moment.");
}
// the return's lease (migration-173): taken by an update conditional on busy_until having passed, so of two actions at
// once one gets it; released by the holder. 10 minutes: longer than any one action (each portal write waits at most
// WRITE_WAIT), so a lease never runs out under an action still sending
const LEASE_MS = 10 * 60000, LEASE_FREE = "1970-01-01T00:00:00.000Z";
const pk = (q: any, w: Who, r: Ret) => q.eq("firm_id", w.firm).eq("gstin", r.gstin).eq("form", r.form).eq("period", r.period);
async function takeLease(w: Who, r: Ret, action: string): Promise<string | null> {
  const token = crypto.randomUUID(), now = Date.now();
  const { data, error } = await pk(admin.from("gst_filings").update({ busy_token: token, busy_action: action, busy_until: new Date(now + LEASE_MS).toISOString() }), w, r)
    .lt("busy_until", new Date(now).toISOString()).select("firm_id");
  if (error) dbFail("gst_filings lease", error, "The filing could not be started. Try again in a moment.");
  return data && data.length ? token : null;
}
async function dropLease(w: Who, r: Ret, token: string) {
  const { error } = await pk(admin.from("gst_filings").update({ busy_token: null, busy_action: null, busy_until: LEASE_FREE }), w, r).eq("busy_token", token);
  if (error) console.error(JSON.stringify({ fn: "gst-taxpro", where: "gst_filings release", code: error.code || null, error: String(error.message || "").slice(0, 500) }));
}
// a write under the lease: only while this action still holds it (compare-and-set)
async function putHeld(w: Who, r: Ret, token: string, set: Record<string, unknown>) {
  const { data, error } = await pk(admin.from("gst_filings").update({ updated_at: new Date().toISOString(), ...set }), w, r).eq("busy_token", token).select("firm_id");
  if (error) dbFail("gst_filings", error, "The filing could not be kept. Try again in a moment.");
  if (!data || !data.length) throw new Plain("Another action changed this return meanwhile; nothing more was done. Read where it stands again.");
}
// the portal's EVC OTP lasts 10 minutes (an older one is refused before anything is sent)
const OTP_MS = 10 * 60000;
// a File whose answer was lost and that the portal does not list yet is sent again only this long after the last try
// (the portal may still be filing it). A set-off whose answer was lost is never sent again (the owner, 12-Nov-2026)
const RESEND_MS = 10 * 60000;
const LOST_OFFSET = "FinCom did not get the portal's answer and will not pay again on its own. Check the Electronic Cash and Credit ledgers on the portal: if the tax was not set off, do the set-off on the portal, then press Check the status here.";
// every call logged: who, when, GSTIN, period, form, action, result, ARN; never the OTP
async function logFiling(w: Who, r: Ret, action: string, ok1: boolean, result: string, extra: { arn?: string; ref?: string; otp?: string } = {}) {
  await admin.from("gst_filing_log").insert({ firm_id: w.firm, gstin: r.gstin, form: r.form, period: r.period, action, by_user: w.me, ok: ok1,
    result: safeText(result, extra.otp || "").slice(0, 1000), arn: extra.arn || null, ref: extra.ref || null });
}
const figsOf = (form: string, j: any) => form === "3B" ? r3bFigures(j) : r1Figures(j);
const portalFigsOf = (form: string, j: any) => form === "3B" ? r3bFigures(j) : r1PortalFigures(j);
async function session(w: Who, r: Ret) {
  const { token, s } = await liveSession(w.firm, r.gstin);
  return { h: { ...hdr(r.gstin, s.username), "auth-token": token, ret_period: r.period, rtn_typ: FORMS[r.form].rtn, userrole: FORMS[r.form].rtn }, username: s.username };
}
async function portalSummary(w: Who, r: Ret) {
  const f = FORMS[r.form], { h, username } = await session(w, r);
  const g = await tpv(f.kind, f.paths, { gstin: r.gstin, username, ret_period: r.period, rtnprd: r.period, action: "RETSUM" }, h);
  if (!ret(g)) throw new Plain("The portal's summary could not be read: " + tpErr(g));
  return { raw: unwrap(g), h, username, path: g.path as string };
}
const statusOf = (x: { j: any }) => String(x.j?.status_cd ?? x.j?.data?.status_cd ?? "");
const reportOf = (x: { j: any }) => x.j?.error_report ?? x.j?.data?.error_report ?? null;
const sleep = (ms: number) => new Promise((ok1) => setTimeout(ok1, ms));
// 3B: the liability lines (tx_pmt of the 3B summary) and the ledgers, set off as the law requires
async function offsetPlan(r: Ret, sum: any, h: Record<string, string>, username: string) {
  const liab = sum?.tx_pmt?.tx_py || sum?.tx_pmt || [];
  if (!Array.isArray(liab) || !liab.length) throw new Plain("The portal's 3B has no liability lines (tx_pmt) yet. Save the 3B again and read the summary.");
  const b = await tpv("LEDGER", LEDGER_PATHS, { gstin: r.gstin, username, ret_period: r.period, action: "BAL" }, h);
  if (!ret(b)) throw new Plain("The ledger balances could not be read: " + tpErr(b));
  const L = ledgersOf(b.j);
  return { ...setoff(liab, L.itc, L.cash), itc: L.itc, cash: L.cash };
}
const planKey = (p: any) => JSON.stringify({ pditc: p?.pditc, pdcash: p?.pdcash });

async function filingAction(w: Who, action: string, body: any, role: string) {
  const form = String(body.form || ""), gstin = String(body.gstin || "").toUpperCase(), period = String(body.period || "");
  if (!FORMS[form]) return { ok: false, error: "Which return: R1, IFF or 3B." };
  if (!PERIOD.test(period)) return { ok: false, error: "The period is MMYYYY, e.g. 082026." };
  const r: Ret = { gstin, form, period }, f = FORMS[form];
  if (action === "filing") {
    const row = await filingRow(w, r);
    const { data: log } = await admin.from("gst_filing_log").select("action, by_user, at, ok, result, arn").eq("firm_id", w.firm).eq("gstin", gstin).eq("form", form).eq("period", period).order("at", { ascending: false }).limit(50);
    if (row) { delete row.payload; delete row.busy_token; }
    return { ok: true, filing: row || null, log: log || [], host: BASE === SANDBOX_URL ? "sandbox" : writeAllowed(BASE, FILE_LIVE) ? "test" : "production" };
  }
  // the same rights as posting: an owner or staff member; a viewer may look, not file
  if (role !== "owner" && role !== "staff") return { ok: false, error: "Only the firm's owner or staff may file returns." };
  if (action !== "track" && !writeAllowed(BASE, FILE_LIVE)) {
    await logFiling(w, r, action, false, "refused: production host without TAXPRO_FILE_LIVE");
    return { ok: false, error: "Filing through the GST API is not switched on for this server yet (it files on the sandbox only)." };
  }
  // one action at a time on a return (migration-173): the row (a first save makes it, never overwriting one), the
  // lease, then the row as it stands now; every write after is conditional on the lease
  let token: string | null = null;
  const put = (set: Record<string, unknown>) => { if (!token) throw new Plain(SORRY); return putHeld(w, r, token, set); };
  try {
    const first = await filingRow(w, r);
    if (first?.status === "filed" && action !== "track") return { ok: false, error: f.label + " for " + period + " is already filed (ARN " + (first.arn || "?") + ")." };
    if (!first && action !== "save") return { ok: false, error: "Save the return to the portal first." };
    if (!first) await newFiling(w, r);
    token = await takeLease(w, r, action);
    if (!token) {
      const b = await filingRow(w, r);
      await logFiling(w, r, action, false, "refused: " + (b?.busy_action || "another action") + " already in progress");
      return { ok: false, busy: true, error: "Another action on this return (" + (b?.busy_action || "?") + ") is already in progress. Wait a moment, then read where it stands." };
    }
    const row = await filingRow(w, r);
    if (!row) return { ok: false, error: "Save the return to the portal first." };
    if (row.status === "filed" && action !== "track") return { ok: false, error: f.label + " for " + period + " is already filed (ARN " + (row.arn || "?") + ")." };
    // 3B only (RETOFFSET moves money; GSTR-1/IFF's proceed to file does not, so they may go back as before): once
    // proceeded, or once a set-off was sent whatever its answer (offset_tried_at), nothing goes back before it: no save,
    // summary or confirm; a proceed only asks the ledgers whether the set-off was done
    const past = form === "3B" && (row.status === "proceeded" || !!row.offset_tried_at);
    const PAST = row.status === "proceeded" ? "The tax for this return has already been set off on the portal; file it, or track it if it was filed."
      : "A set-off was sent to the portal for this return and its answer did not come back, so it is not sent again and the return cannot go back. Press Proceed to have FinCom read the ledgers and see whether the tax was set off.";
    if (past && (action === "save" || action === "summary" || action === "confirm" || (action === "proceed" && row.status === "proceeded"))) {
      await logFiling(w, r, action, false, "refused: " + (row.status === "proceeded" ? "already set off" : "a set-off was sent (answer unclear)"));
      return { ok: false, error: PAST };
    }
    // a save the portal was still processing (IP): asked again (summary, track)
    const repoll = async () => {
      if (!row || row.save_state !== "IP" || !row.save_ref) return;
      const { h, username } = await session(w, r);
      const s1 = await tpv("STATUS", STATUS_PATHS, { gstin, username, ret_period: period, ref_id: row.save_ref, action: "RETSTATUS" }, h);
      const st = statusOf(s1) || "IP";
      if (st === "IP") return;
      row.save_state = st;
      await put({ save_state: st, save_errors: reportOf(s1), status: st === "P" ? (row.status === "failed" ? "saved" : row.status) : "failed", error: st === "P" ? null : "the portal found errors" });
      if (st !== "P") row.status = "failed";
      await logFiling(w, r, "save", st === "P", "RETSTATUS ref " + row.save_ref + ", status " + st, { ref: row.save_ref });
    };
    // the portal's own list of filed returns (RETTRACK): this return's entry with an ARN, or null
    const trackHit = async () => {
      const { h, username } = await session(w, r), fy = (() => { const m = +period.slice(0, 2), y = +period.slice(2); const s1 = m >= 4 ? y : y - 1; return s1 + "-" + String(s1 + 1).slice(2); })();
      const g = await getTrack(h, gstin, username, fy);
      return ((g.data.EFiledlist as any[]).find((e) => String(e.ret_prd) === period && f.track.includes(String(e.rtntype || "").toUpperCase()) && e.arn) || null) as any;
    };
    // 3B, a set-off sent whose answer never came: the ledgers now beside the set-off's plan; "done" marks it proceeded
    // (RETOFFSET is never sent again here)
    const ledgerCheck = async () => {
      const { h, username } = await session(w, r);
      const b = await tpv("LEDGER", LEDGER_PATHS, { gstin, username, ret_period: period, action: "BAL" }, h);
      if (!ret(b)) throw new Plain("The ledger balances could not be read: " + tpErr(b) + ". Nothing was sent; try again in a moment.");
      const d = offsetDone(row.offset_plan, ledgersOf(b.j));
      if (d === "done") {
        await put({ status: "proceeded", proceeded_by: w.me, proceeded_at: new Date().toISOString(), error: null });
        row.status = "proceeded";
        await logFiling(w, r, "proceed", true, "the set-off sent " + row.offset_tried_at + " shows in the ledgers: proceeded (RETOFFSET not sent again)");
      } else await logFiling(w, r, "proceed", false, "a set-off was sent " + row.offset_tried_at + "; the ledgers " + (d === "not" ? "have not moved" : "moved otherwise") + "; not sent again");
      return d;
    };
    const filedAtOf = (hit: any) => { const d = String(hit?.dof || ""); return new Date(/^\d{2}-\d{2}-\d{4}$/.test(d) ? d.split("-").reverse().join("-") + "T00:00:00+05:30" : Date.now()).toISOString(); };
    if (action === "save") {
      const payload = form === "3B" ? cleanR3b(body.payload, gstin, period) : cleanR1(body.payload, gstin, period);
      const { h, username } = await session(w, r);
      const x = await tpv(f.kind, f.paths, { gstin, username, ret_period: period, rtnprd: period, action: "RETSAVE" }, h, BASE, "PUT", payload);
      const ref = String(x?.j?.reference_id ?? x?.j?.data?.reference_id ?? "");
      if (!ref) {
        const m = tpErr(x);
        await put({ status: "failed", error: m, payload, saved_by: w.me, saved_at: new Date().toISOString() });
        await logFiling(w, r, "save", false, m);
        return { ok: false, error: "The portal did not take the return: " + m };
      }
      // RETSTATUS until processed (P), processed with errors (PE) or refused (ER); still in progress (IP) is kept as saved
      // with save_state IP (not failed) and asked again by the summary or track
      let st = "IP", rep: any = null;
      for (let i = 0; i < STATUS_TRIES && st === "IP" && timeLeft() > STATUS_WAIT + 5000; i++) {   // within the action's time; else kept IP
        if (i) await sleep(STATUS_WAIT);
        const s1 = await tpv("STATUS", STATUS_PATHS, { gstin, username, ret_period: period, ref_id: ref, action: "RETSTATUS" }, h);
        st = statusOf(s1) || "IP"; rep = reportOf(s1);
      }
      const good = st === "P", going = st === "IP";
      await put({ status: good || going ? "saved" : "failed", save_ref: ref, save_state: st, save_errors: rep, payload, fincom_sum: figsOf(form, payload), portal_sum: null, diffs: null,
        offset_plan: null, confirmed_by: null, confirmed_at: null, confirmed_sum: null, accepted: null, accept_note: null, proceeded_by: null, proceeded_at: null, otp_sent_at: null, file_tried_at: null, offset_tried_at: null,
        error: good || going ? null : "the portal found errors", saved_by: w.me, saved_at: new Date().toISOString() });
      await logFiling(w, r, "save", good || going, "RETSAVE ref " + ref + ", status " + st, { ref });
      return { ok: good || going, saveState: st, ref, errors: rep, error: good ? undefined : going ? "Saved; the portal is still processing it. Read the summary in a minute." : "The portal found errors in the return; nothing was filed." };
    }
    if (action === "summary") {
      await repoll();
      if (row.save_state !== "P") return { ok: false, error: row.save_state === "IP" ? "The portal is still processing the save." : "The save was not processed; save again." };
      const s = await portalSummary(w, r), portal = portalFigsOf(form, s.raw), c = compare(row.fincom_sum || {}, portal, form);
      const plan = form === "3B" ? await offsetPlan(r, s.raw, s.h, s.username) : null;
      await put({ status: "summary", portal_sum: portal, diffs: c.differs, offset_plan: plan, confirmed_by: null, confirmed_at: null, confirmed_sum: null, accepted: null, accept_note: null, error: null });
      await logFiling(w, r, "summary", true, (c.differs.length ? c.differs.length + " differences: " + c.differs.join(", ") : "matches FinCom") + (c.rounding.length ? "; rounding under ₹1: " + c.rounding.join(", ") : ""));
      return { ok: true, rows: c.rows, differs: c.differs, rounding: c.rounding, plan };
    }
    if (action === "confirm") {
      if (row.status !== "summary") return { ok: false, error: "Read the portal's summary first." };
      const diffs: string[] = row.diffs || [], acc = (Array.isArray(body.accept) ? body.accept : []).map(String), note = String(body.note || "").trim().slice(0, 500);
      const missing = diffs.filter((d) => !acc.includes(d));
      if (missing.length) return { ok: false, error: "Accept each difference, or correct it and save again: " + missing.join(", ") + "." };
      if (diffs.length && !note) return { ok: false, error: "Say why the differences are accepted." };
      await put({ status: "confirmed", confirmed_by: w.me, confirmed_at: new Date().toISOString(), confirmed_sum: row.portal_sum, accepted: diffs, accept_note: note || null });
      await logFiling(w, r, "confirm", true, diffs.length ? "differences accepted (" + diffs.join(", ") + "): " + note : "the summary matches FinCom");
      return { ok: true };
    }
    // proceed, evc_otp and file: only what the person confirmed; the portal's summary is read again first
    if (action === "proceed" || action === "evc_otp" || action === "file") {
      // 3B: a set-off was sent before and its answer never came (or was not kept): never sent again (the owner's decision
      // of 12-Nov-2026: it counts as paid); the ledgers say whether it was done (then proceeded), else the person is told
      // what to check on the portal
      if (action === "proceed" && form === "3B" && row.offset_tried_at && row.status === "confirmed") {
        const d = await ledgerCheck();
        if (d === "done") return { ok: true, found: true };
        return { ok: false, unclear: true, error: (d === "unknown" ? "The ledgers moved, but not as the set-off would move them (another payment or debit, or a different split), so FinCom cannot tell whether it was done. " : "") + LOST_OFFSET };
      }
      if (action === "proceed" ? row.status !== "confirmed" : row.status !== "proceeded") return { ok: false, error: action === "proceed" ? "A person must first confirm the portal's summary against FinCom's." : "Proceed to file first." };
      if (action === "evc_otp") {
        const pan = String(body.pan || "").toUpperCase().trim();
        if (!PAN.test(pan)) return { ok: false, error: "The authorised signatory's PAN is needed." };
        if ((await allowed(LIMITS.evc, "gst-evc-otp:" + w.firm + ":" + gstin + ":" + form + ":" + period)) === false) {
          await logFiling(w, r, "evc_otp", false, "refused: " + LIMITS.evc.max + " EVC OTPs within " + inWords(LIMITS.evc.window));
          return { ok: false, error: "The signatory's OTP has been asked for " + LIMITS.evc.max + " times in the last " + (LIMITS.evc.window >= 3600 ? "hour" : inWords(LIMITS.evc.window)) + " for this return. Try again in " + inWords(LIMITS.evc.window) + "." };
        }
        const { h, username } = await session(w, r);
        const x = await tp(EVC_PATH, { action: "EVCOTP", gstin, username, pan, form_type: f.formType }, h);
        await put(ok(x) ? { otp_sent_at: new Date().toISOString(), signatory_pan: pan } : { error: tpErr(x) });
        await logFiling(w, r, "evc_otp", ok(x), ok(x) ? "EVC OTP sent to the signatory (PAN " + pan + ")" : tpErr(x));
        return ok(x) ? { ok: true } : { ok: false, error: "The portal did not send the OTP: " + tpErr(x) };
      }
      // file: the person's click, with the OTP the signatory received; sent once, kept nowhere. Checked before any call
      const pan = String(body.pan || row.signatory_pan || "").toUpperCase().trim(), otp = String(body.otp || "").trim();
      if (action === "file") {
        if (!PAN.test(pan)) return { ok: false, error: "The authorised signatory's PAN is needed." };
        if (!/^\d{6}$/.test(otp)) return { ok: false, error: "The EVC OTP has 6 digits." };
        if (!row.otp_sent_at) return { ok: false, error: "Send the OTP first." };
        if (!(Date.now() - Date.parse(row.otp_sent_at) < OTP_MS)) return { ok: false, error: "The OTP was sent more than 10 minutes ago and the portal no longer takes it. Send a new OTP." };
        // a File sent before whose answer had no ARN (refused, lost, or timed out): the portal is asked first whether it
        // was filed, and RETFILE is sent again only when it was not
        if (row.file_tried_at) {
          let hit: any;
          try { hit = await trackHit(); } catch (e) {
            const m = plain(e, "filing track before file");
            await logFiling(w, r, "track", false, "before File: " + m);
            return { ok: false, error: "Whether the earlier File reached the portal could not be checked (" + m + "). Nothing was sent; try again in a moment." };
          }
          await logFiling(w, r, "track", true, hit ? "before File: on the portal: " + (hit.status || "filed") + ", ARN " + hit.arn : "before File: not filed on the portal yet", { arn: hit?.arn });
          if (hit) {
            const at = filedAtOf(hit);
            await put({ status: "filed", arn: hit.arn, filed_at: at, filed_by: w.me, error: null, signatory_pan: pan });
            return { ok: true, arn: hit.arn, filedAt: at, tracked: true };
          }
          // not listed yet: the portal may still be filing it; sent again only 10 minutes after the last one
          if (Date.now() - Date.parse(row.file_tried_at) < RESEND_MS)
            return { ok: false, error: "The portal does not list " + f.label + " for " + period.slice(0, 2) + "-" + period.slice(2) + " as filed yet. If you just filed, wait a few minutes and press Check the status on the portal; File sends it again only 10 minutes after the last try." };
        }
      }
      const s = await portalSummary(w, r), portal = portalFigsOf(form, s.raw);
      if (!sameFigures(portal, row.confirmed_sum || {})) {
        if (action === "file" && form === "3B") {   // set off: never moved back; the difference said, nothing filed
          const c = compare(row.confirmed_sum || {}, portal, form), keys = c.differs.concat(c.rounding);
          const m = "the portal's summary is not the one confirmed (" + (keys.join(", ") || "its figures") + ")";
          await put({ error: m });
          await logFiling(w, r, "file", false, m + "; nothing sent");
          return { ok: false, changed: true, differs: keys, error: "The portal's summary is not the one confirmed: " + (keys.join(", ") || "its figures") + ". " +
            "The tax is already set off, so FinCom does not go back: nothing was filed. Check the GSTR-3B for " + period.slice(0, 2) + "-" + period.slice(2) + " on the portal before filing it." };
        }
        await put({ status: "summary", portal_sum: portal, diffs: compare(row.fincom_sum || {}, portal, form).differs, confirmed_by: null, confirmed_at: null, confirmed_sum: null, accepted: null });
        await logFiling(w, r, action, false, "the portal's summary changed since it was confirmed; nothing sent");
        return { ok: false, changed: true, error: "The portal's summary changed since it was confirmed. Nothing was sent: compare it again." };
      }
      if (action === "proceed") {
        let x: any, plan: any = null;
        if (form === "3B") {
          plan = await offsetPlan(r, s.raw, s.h, s.username);
          if (planKey(plan) !== planKey(row.offset_plan)) {
            await put({ status: "summary", offset_plan: plan, confirmed_by: null, confirmed_at: null, confirmed_sum: null, accepted: null });
            await logFiling(w, r, "proceed", false, "the set-off changed (ledgers or liability moved); nothing sent");
            return { ok: false, changed: true, error: "The ledgers or the liability changed since the summary was read, so the set-off changed. Nothing was sent: check it again.", plan };
          }
          if (Object.keys(plan.short).length) {
            await logFiling(w, r, "proceed", false, "cash short: " + JSON.stringify(plan.short));
            return { ok: false, error: "Not enough in the cash ledger: " + Object.entries(plan.short).map(([k, v]) => k.toUpperCase() + " ₹" + v).join(", ") + ". Pay by challan (PMT-06) first.", plan };
          }
          // kept before the set-off goes (under this action's lease): if the worker stops or the write after it fails,
          // the next proceed asks the ledgers instead of sending it again
          await put({ offset_tried_at: new Date().toISOString(), offset_plan: plan, error: null });
          try { x = await tpv(f.kind, f.paths, { gstin, username: s.username, ret_period: period, action: "RETOFFSET" }, s.h, BASE, "PUT", { gstin, ret_period: period, pdcash: plan.pdcash, pditc: plan.pditc }); }
          catch (e) {
            if (!(e instanceof SendErr && e.sent)) {   // it never left (Vault, the keys, DNS, connection refused): nothing sent
              const m = plain(e, "filing proceed");
              await put({ offset_tried_at: null });
              await logFiling(w, r, "proceed", false, "not sent: " + m);
              return { ok: false, error: "Nothing was sent: " + m };
            }
            x = { http: 0, j: null, text: String((e as Error)?.message || e) };
          }
          // anything but a success or a refusal that proves nothing was processed (refusedClearly: timed out, connection
          // lost, not JSON, a 5xx, a GSP's own error): the set-off may have reached the portal, so it is not sent again;
          // offset_tried_at stays and the next proceed reads the ledgers
          const done1 = ok(x) || !!(x?.j && !x.j.error && (x.j.reference_id || x.j.data));
          if (!done1 && !refusedClearly(x?.j, "offset")) {
            const m = "the portal's answer to the set-off was not received or not clear (" + (x?.j ? tpErr(x) : x?.http ? "HTTP " + x.http : "no answer") + ")";
            await put({ error: m });
            await logFiling(w, r, "proceed", false, m + "; not sent again");
            return { ok: false, unclear: true, error: LOST_OFFSET };
          }
          if (!done1) await put({ offset_tried_at: null });   // refused before anything was processed: not set off
        } else {
          // GSTR-1 / IFF: proceed to file moves no money, so a lost answer may simply be tried again
          try { x = await tpv(f.kind, f.paths, { gstin, username: s.username, ret_period: period, action: "RETNEWPTF" }, s.h, BASE, "POST", { gstin, ret_period: period }); }
          catch (e) {
            const m = plain(e, "filing proceed");
            await logFiling(w, r, "proceed", false, (e instanceof SendErr && e.sent ? "answer not received: " : "not sent: ") + m);
            return { ok: false, error: e instanceof SendErr && e.sent ? "The portal's answer to proceed to file was not received; nothing changed here. Press Proceed again (it is safe to repeat for " + f.label + ")." : "Nothing was sent: " + m };
          }
        }
        if (!ok(x) && !(x?.j && !x.j.error && (x.j.reference_id || x.j.data))) { await logFiling(w, r, "proceed", false, tpErr(x)); return { ok: false, error: "The portal refused: " + tpErr(x) }; }
        await put({ status: "proceeded", proceeded_by: w.me, proceeded_at: new Date().toISOString(), error: null });
        await logFiling(w, r, "proceed", true, form === "3B" ? "liability offset (RETOFFSET)" : "proceeded to file (RETNEWPTF)");
        return { ok: true };
      }
      // file: marked tried before RETFILE goes (so a lost answer is tracked first next time), under this action's lease
      await put({ file_tried_at: new Date().toISOString() });
      let x: any;
      try { x = await tpv(f.kind, f.paths, { gstin, username: s.username, ret_period: period, action: "RETFILE" }, s.h, BASE, "POST", { data: s.raw, st: "EVC", sid: pan + "|" + otp }); }
      catch (e) {
        if (!(e instanceof SendErr && e.sent)) {   // it never left (too little time, the keys, DNS, connection refused)
          const m = safeText(plain(e, "filing file", otp), otp);
          await put({ file_tried_at: row.file_tried_at || null });
          await logFiling(w, r, "file", false, "not sent: " + m, { otp });
          return { ok: false, error: "Nothing was sent, so nothing was filed: " + m };
        }
        x = { http: 0, j: null, text: String((e as Error)?.message || e) };
      }
      const arn = String(x?.j?.ack_num ?? x?.j?.data?.ack_num ?? x?.j?.arn ?? x?.j?.data?.arn ?? "");
      // refused before processing (a wrong or expired OTP, the session): not a lost answer, File may be pressed again
      if (!arn && refusedClearly(x?.j, "file")) await put({ file_tried_at: row.file_tried_at || null });
      if (!arn) {
        const m = safeText(x?.j ? tpErr(x) : "the portal's answer was not received (" + (x?.http ? "HTTP " + x.http : "no answer") + "); File again asks the portal first whether it was filed", otp);
        await put({ error: m });
        await logFiling(w, r, "file", false, m, { otp });
        return { ok: false, error: "Not filed: " + m };
      }
      const at = new Date().toISOString();
      await put({ status: "filed", arn, filed_at: at, filed_by: w.me, error: null, signatory_pan: pan });
      await logFiling(w, r, "file", true, "filed with EVC (PAN " + pan + ")", { arn, otp });
      return { ok: true, arn, filedAt: at };
    }
    if (action === "track") {
      try { await repoll(); } catch (e) { await logFiling(w, r, "save", false, "RETSTATUS before track: " + plain(e, "filing track repoll")); }   // RETTRACK all the same
      // 3B, a set-off sent whose answer never came (perhaps set off by hand on the portal since): the ledgers read
      if (form === "3B" && row.offset_tried_at && row.status === "confirmed") {
        try { await ledgerCheck(); } catch (e) { await logFiling(w, r, "track", false, "ledgers before track: " + plain(e, "filing track ledgers")); }
      }
      const hit = await trackHit();
      if (hit && row.status !== "filed") await put({ status: "filed", arn: hit.arn, filed_at: filedAtOf(hit), error: null });
      await logFiling(w, r, "track", true, hit ? "on the portal: " + (hit.status || "filed") + ", ARN " + hit.arn : "not filed on the portal yet", { arn: hit?.arn });
      return { ok: true, filed: !!hit, arn: hit?.arn || row.arn || "", status: hit?.status || row.status, dof: hit?.dof || "" };
    }
    return { ok: false, error: "Unknown action." };
  } catch (e) {
    const m = safeText(plain(e, "filing " + action, String(body.otp || "")), String(body.otp || ""));
    await logFiling(w, r, action, false, m, { otp: String(body.otp || "") }).catch(() => {});
    return { ok: false, error: m };
  } finally {
    if (token) await dropLease(w, r, token);
  }
}

// who is asking: a signed-in, active member of a firm. Two-step sign-in is checked exactly as the gateway checks it
// (server/security/functions/gateway/index.ts: rpc mfa_ok as the user, which decides when two-step is required)
type Member = { me: string; firm: string; role: string };
async function signedIn(req: Request): Promise<Member | Response> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { ok: false, error: "Sign in to the firm account first." });
  const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return reply(401, { ok: false, error: "Sign in again." });
  const { data: mfaOk } = await asUser.rpc("mfa_ok");
  if (mfaOk !== true) return reply(403, { ok: false, error: "Finish the two-step sign-in first." });
  const { data: member } = await admin.from("members").select("firm_id, active, role").eq("user_id", who.user.id).maybeSingle();
  if (!member || !member.active) return reply(403, { ok: false, error: "This account is not part of a firm." });
  return { me: who.user.id, firm: member.firm_id as string, role: String(member.role || "") };
}
// what a look-only member (any role but owner or staff) may do: read what is kept, and where a return's filing stands
// ("filing": the kept row and its log, no TaxPro call). Everything else writes, keeps a password or session, sends an OTP,
// spends a TaxPro call, or saves, submits or files a return (security review F3)
const LOOK_OK = new Set(["status", "returns", "return", "einv-status", "einvoices", "filing"]);
const canWrite = (role: string) => role === "owner" || role === "staff";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new globalThis.URL(req.url);

  if (req.method === "GET" && u.searchParams.get("selftest")) {
    const who = await signedIn(req);
    if (who instanceof Response) return who;
    // the firm's owner only, at most 5 times an hour (security review L7)
    if (who.role !== "owner") return reply(403, { ok: false, error: "Only the firm's owner can run the GST self-test." });
    if ((await allowed(LIMITS.selftest, "gst-selftest:" + who.firm)) === false) return reply(429, { ok: false, error: "The GST self-test has run " + LIMITS.selftest.max + " times in the last hour. Try again in " + inWords(LIMITS.selftest.window) + "." });
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
        try { await get2b(hh, t.gstin, t.username, "012021", SANDBOX_URL); steps.gstr2b = "ok"; } catch (e) { steps.gstr2b = plain(e, "selftest 2b"); }
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
    } catch (e) { steps.error = plain(e, "selftest"); }
    return reply(200, { ok: steps.auth === "ok", tested: "sandbox", inUse: BASE === SANDBOX_URL ? "sandbox" : "production", einvoiceHost: EINV === SANDBOX_URL ? "sandbox" : "production", steps });
  }
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
  let body: any = {};
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
  const action = String(body.action || "");

  // the database's timer: renew sessions (every 20 minutes); the daily run (07:00-11:00 IST, hourly, until done)
  if (action === "refresh-all" || action === "daily") {
    const { data: good } = await admin.rpc("gst_cron_ok", { k: req.headers.get("x-cron-key") || "" });
    if (good !== true) return reply(403, { ok: false });
    if (action === "daily") { try { return reply(200, { ok: true, ...(await daily()) }); } catch (e) { return reply(200, { ok: false, error: plain(e, "daily") }); } }
    const soon = new Date(Date.now() + 40 * 60000).toISOString(), now = new Date().toISOString();
    const { data: rows } = await admin.from("gst_sessions").select("*").lt("expires_at", soon).gt("expires_at", now).is("ended_at", null);
    let done = 0, failed = 0;
    for (const s of rows || []) { try { await refresh(s); done++; } catch { failed++; } }
    return reply(200, { ok: true, renewed: done, failed });
  }

  const who = await signedIn(req);
  if (who instanceof Response) return who;
  if (!canWrite(who.role) && !LOOK_OK.has(action)) return reply(403, { ok: false, error: "Only the firm's owner or staff can do this." });
  const { firm, me } = who;
  // console phase 1b: a paused firm (FinCom's console) reads what is kept; everything that writes, spends a TaxPro call or
  // files waits until the account is active again (the service role skips can_write(), so it is asked here)
  if (!LOOK_OK.has(action)) { const gate = await firmGate(viaClient(admin), firm); if (gate) return reply(gate.status, { ok: false, reason: gate.reason, error: gate.error }); }
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
    // the e-invoice actions keep a password or spend an IRP call: only for one of the firm's clients (review of c405f5104)
    if (["einv-login", "irn", "irn-cancel", "ewb"].includes(action) && !(await firmClient(firm, gstin))) return reply(403, { ok: false, error: NOT_CLIENT });
    if (["filing", "save", "summary", "confirm", "proceed", "evc_otp", "file", "track"].includes(action))
      return reply(200, await deadline.run(Date.now() + ACTION_BUDGET, () => filingAction({ firm, me }, action, body, who.role)));

    if (action === "return") {
      const { data } = await admin.from("gst_returns").select("*").eq("firm_id", firm).eq("gstin", gstin).eq("form", String(body.form || "")).eq("period", String(body.period || "")).maybeSingle();
      return reply(200, { ok: true, ret: data || null });
    }
    if (action === "fetch") {
      const form = String(body.form || ""), period = String(body.period || "");
      if (!["2B", "R1", "3B", "TRACK"].includes(form)) return reply(400, { ok: false, error: "Which return: 2B, R1, 3B or TRACK." });
      if (form === "TRACK" ? !FY.test(period) : !PERIOD.test(period)) return reply(400, { ok: false, error: form === "TRACK" ? "The year is 2025-26." : "The period is MMYYYY, e.g. 032026." });
      const r = await fetchStore(firm, gstin, form, period, me);
      return reply(200, { ok: r.status !== "error", ...r });
    }
    if (action === "einv-login") {
      const username = String(body.username || "").trim(), password = String(body.password || "");
      if (!username || !password) return reply(400, { ok: false, error: "The e-invoice API username and password are needed." });
      const a = await allowed(LIMITS.einvLogin, "gst-einv-login:" + firm + ":" + gstin);
      if (a === null) return reply(503, { ok: false, error: LIMIT_DOWN });
      if (!a) return reply(429, { ok: false, error: "The e-invoice sign-in for " + gstin + " has been tried " + LIMITS.einvLogin.max + " times in the last " + inWords(LIMITS.einvLogin.window) + ". Try again in " + inWords(LIMITS.einvLogin.window) + "." });
      await sput(einvName(firm, gstin, "pass"), password);
      if (body.ewbPassword) await sput(ewbName(firm, gstin, "pass"), String(body.ewbPassword));
      const { error } = await admin.from("gst_einv_accounts").upsert({ firm_id: firm, gstin, username, token_until: null, last_error: null, updated_at: new Date().toISOString() });
      if (error) dbFail("gst_einv_accounts", error, "The e-invoice user could not be kept. Try again in a moment.");
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
    const ip = clientIp(req, "127.0.0.1");   // as the platform saw it (../_shared/clientip.ts; security review L4)
    const h = hdr(gstin, username, ip);
    // an OTP or a sign-in only for one of the firm's clients, and not without limit (security review H1): each OTPREQUEST
    // is a paid call and sends the taxpayer an SMS and an email; AUTHTOKEN binds the taxpayer's portal session to this firm
    if ((action === "otp" || action === "auth") && !(await firmClient(firm, gstin))) return reply(403, { ok: false, error: NOT_CLIENT });

    if (action === "otp") {
      // the firm's count first (a firm over its cap uses none of a GSTIN's), then the GSTIN's: 15 minutes, then the day
      const tooMany = (l: Limit, a: boolean | null) => a === null ? reply(503, { ok: false, error: LIMIT_DOWN }) : !a ? reply(429, { ok: false, error: l === LIMITS.otpFirm
        ? "Your firm has asked for " + l.max + " OTPs in the last hour. Try again in " + inWords(l.window) + "."
        : "The GST portal has been asked for " + l.max + " OTPs for " + gstin + " in the last " + inWords(l.window) + " (the taxpayer gets each by SMS and email), so no more is sent now. Try again in " + inWords(l.window) + "." }) : null;
      for (const [l, key] of [[LIMITS.otpFirm, "gst-otp:" + firm], [LIMITS.otpGstin, "gst-otp-gstin:" + gstin], [LIMITS.otpDay, "gst-otp-gstin-day:" + gstin]] as [Limit, string][]) {
        const no = tooMany(l, await allowed(l, key));
        if (no) return no;
      }
      const x = await tp(AUTH, { action: "OTPREQUEST", gstin, username }, h);
      return reply(200, ok(x) ? { ok: true } : { ok: false, error: tpErr(x) });
    }
    if (action === "auth") {
      const otp = String(body.otp || "").trim();
      if (!/^\d{6}$/.test(otp)) return reply(400, { ok: false, error: "The OTP has 6 digits." });
      const a = await allowed(LIMITS.auth, "gst-auth:" + firm + ":" + gstin);
      if (a === null) return reply(503, { ok: false, error: LIMIT_DOWN });
      if (!a) return reply(429, { ok: false, error: LIMITS.auth.max + " OTPs were tried for " + gstin + " in the last " + inWords(LIMITS.auth.window) + ". Try again in " + inWords(LIMITS.auth.window) + ", with a new OTP." });
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
    return reply(200, { ok: false, error: plain(e, action, String(body.otp || ""), String(body.password || ""), String(body.ewbPassword || "")) });
  }
});
