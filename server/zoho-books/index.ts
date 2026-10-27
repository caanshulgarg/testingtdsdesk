// zoho-books: a client's Zoho Books (India) organisation in FinCom, read and posted (the owner's decisions of 13-Oct-2026).
//
// Reading. A Zoho organisation linked to a FinCom client gets a book in FinCom's cloud copy (migration 75), and its
// documents are written there in the SAME rows the Tally bridge writes (map.js: invoices, credit notes, bills, vendor
// credits, customer and vendor payments, expenses, journals, bank transfers; contacts with GSTIN, PAN and TDS; the chart
// of accounts; the GST and TDS taxes), marked source 'zoho', so TDS, GST, MIS, the due list and posting work unchanged.
//   - only changes: each kind is listed newest-changed first (last_modified_time) down to where the last run got to, and
//     a document is fetched only when its id or modified time is new (zoho_seen);
//   - every few minutes (pg_cron -> {kind:"sync"}, migration 75b), each organisation on its own schedule; a Zoho webhook
//     (Settings -> Automation -> Webhooks, the URL FinCom shows once) only brings that schedule forward;
//   - Zoho's limits: 100 calls a minute per organisation (FinCom keeps under 90, one call every ZOHO_MIN_GAP_MS) and the
//     plan's daily cap (zoho_connections.daily_cap; FinCom stops at 95% of it until midnight IST); a 429 from Zoho stops
//     the minute (or the day) whatever the count says, and the run waits or ends, to go on next time;
//   - deletions: once a day every id Zoho lists is compared with those held (zoho_gone; a list that would take away a
//     fifth of a kind at once is held and said, never applied).
// Posting. FinCom's approved purchase bills and bank entries go into Zoho as bills, expenses or journals, with the
// safeguards of posting to Tally: FinCom's id in the reference ("FC:<id>") and the notes ("TDSDesk:<id>"), a duplicate
// check in Zoho before each one, one posting at a time per organisation (a lease), and each entry Posted or Errors with
// Zoho's own words. FinCom never edits or deletes anything in Zoho: no PUT or DELETE is ever sent (zohoWrite allows POST
// to bills, expenses, journals and contacts only).
// Secrets. The Zoho sign-in's refresh and access tokens are in Supabase Vault (zoho_secret_put / zoho_secret_get, names
// zoho:<firm>:<grant>:refresh|access), never in a table, a log or an answer. The client id and secret are this function's
// secrets ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET, set by the owner; without them the function says "not set up".
//
// Requests:
//   GET  ?code=&state=&location=      Zoho's redirect after the client approves (the redirect URI is this function's URL)
//   POST ?hook=<token>                 a Zoho webhook: the organisation is read within a minute or two
//   POST {kind:"sync"} + x-fincom-zoho-cron    the scheduled run (the key in Vault, zoho_cron_ok)
//   POST + Authorization: Bearer <FinCom sign-in>:
//     {kind:"config"}                  -> {configured, redirectUri, scopes} (never the id or the secret)
//     {kind:"connect_start", back}     -> {url}: Zoho's own approval page (the owner only)
//     {kind:"link", grant, org, client, from?}   -> the organisation linked to the client, its first read started (owner)
//     {kind:"sync_now", connection}    -> read now (owner or staff)
//     {kind:"disconnect", connection}  -> FinCom's access revoked; nothing deleted anywhere (owner)
//     {kind:"hook_new", connection}    -> {url}: the webhook address, shown once (owner)
//     {kind:"post", client, entries, masters}    -> {ok, results: [{id, ok, message, zoho}]} (owner or staff)
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsFor, allowedOrigins } from "../_shared/cors.ts";
import * as Z from "./map.js";
import { firmGate, viaClient } from "../_shared/firmgate.ts";   // the console's switches (migration 118)

const env = (k: string, d = "") => (Deno.env.get(k) ?? d);
const URL_ = env("SUPABASE_URL");
const SERVICE = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON = env("SUPABASE_ANON_KEY");
const ACCOUNTS = env("ZOHO_ACCOUNTS_URL", "https://accounts.zoho.in").replace(/\/+$/, "");
const API = env("ZOHO_API_URL", "https://www.zohoapis.in").replace(/\/+$/, "");
const REDIRECT = env("ZOHO_REDIRECT_URI", URL_.replace(/\/+$/, "") + "/functions/v1/zoho-books");
const GAP_MS = Number(env("ZOHO_MIN_GAP_MS", "650"));
const RUN_MS = Number(env("ZOHO_RUN_SECS", "120")) * 1000;
const MINUTE_MAX = 90;
export const SCOPES = ["ZohoBooks.settings.READ", "ZohoBooks.accountants.READ", "ZohoBooks.accountants.CREATE", "ZohoBooks.contacts.READ", "ZohoBooks.contacts.CREATE",
  "ZohoBooks.invoices.READ", "ZohoBooks.creditnotes.READ", "ZohoBooks.customerpayments.READ", "ZohoBooks.bills.READ", "ZohoBooks.bills.CREATE", "ZohoBooks.debitnotes.READ",
  "ZohoBooks.vendorpayments.READ", "ZohoBooks.expenses.READ", "ZohoBooks.expenses.CREATE", "ZohoBooks.banking.READ"];
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const clientId = () => env("ZOHO_CLIENT_ID").trim();
const clientSecret = () => env("ZOHO_CLIENT_SECRET").trim();
const configured = () => !!(clientId() && clientSecret());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function sha256(s: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join(""); }
function randomHex(n: number) { return Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x.toString(16).padStart(2, "0")).join(""); }
async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
// nothing a person reads ever carries a token: Zoho's answers are cut to their message, and any token-like text masked
export function clean(s: unknown) {
  return String(s ?? "").replace(/(1000\.[0-9a-f]{20,}\.[0-9a-f]{20,})/gi, "[hidden]").replace(/(Zoho-oauthtoken|Bearer)\s+\S+/gi, "$1 [hidden]")
    .replace(/(refresh_token|access_token|client_secret|code)=[^&\s]+/gi, "$1=[hidden]").slice(0, 400);
}

// ---------------------------------------------------------------- tokens (Vault only)
const secretName = (firm: string, grant: string, k: "refresh" | "access") => `zoho:${firm}:${grant}:${k}`;
async function form(url: string, params: Record<string, string>) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
  let j: any = {}; try { j = await r.json(); } catch (_) { j = {}; }
  return { status: r.status, j };
}
type Conn = { id: string, firm_id: string, grant_id: string, org_id: string, org_gstin?: string, client_id?: string, book_id: string, sync_from?: string, daily_cap?: number, full_check_at?: string | null, token_expires_at?: string | null, sync_every_min?: number };
const access: Record<string, { token: string, until: number }> = {};
async function accessToken(c: Conn, force = false): Promise<string> {
  const k = c.grant_id, held = access[k];
  if (!force && held && held.until > Date.now() + 120000) return held.token;
  if (!force && c.token_expires_at && Date.parse(c.token_expires_at) > Date.now() + 120000) {
    const t = await rpc("zoho_secret_get", { p_name: secretName(c.firm_id, c.grant_id, "access") });
    if (t) { access[k] = { token: String(t), until: Date.parse(c.token_expires_at) }; return String(t); }
  }
  const refresh = await rpc("zoho_secret_get", { p_name: secretName(c.firm_id, c.grant_id, "refresh") });
  if (!refresh) throw new ZohoError("Sign in to Zoho Books again (Integrations → Zoho Books → Reconnect).", "sign_in");
  const { status, j } = await form(ACCOUNTS + "/oauth/v2/token", { refresh_token: String(refresh), client_id: clientId(), client_secret: clientSecret(), grant_type: "refresh_token" });
  if (status !== 200 || !j.access_token) {
    const why = clean(j.error || ("HTTP " + status));
    await rpc("zoho_grant_token", { p_grant: c.grant_id, p_expires: null, p_error: why });
    throw new ZohoError("Zoho did not renew FinCom's access (" + why + "). Reconnect from Integrations → Zoho Books.", "sign_in");
  }
  const until = Date.now() + Number(j.expires_in || 3600) * 1000;
  await rpc("zoho_secret_put", { p_name: secretName(c.firm_id, c.grant_id, "access"), p_value: j.access_token });
  await rpc("zoho_grant_token", { p_grant: c.grant_id, p_expires: new Date(until).toISOString(), p_error: null });
  c.token_expires_at = new Date(until).toISOString();
  access[k] = { token: j.access_token, until };
  return j.access_token;
}
class ZohoError extends Error { code: string; status: number; constructor(m: string, code = "", status = 0) { super(m); this.code = code; this.status = status; } }

// ---------------------------------------------------------------- one call to Zoho, within its limits
let lastCall = 0;
const usedToday: Record<string, { used: number, cap: number }> = {};
async function zoho(c: Conn, method: "GET" | "POST", path: string, query: Record<string, string | number> = {}, body?: unknown, deadline = Date.now() + RUN_MS): Promise<any> {
  if (method !== "GET" && !(method === "POST" && /^(bills|expenses|journals|contacts)$/.test(path))) throw new ZohoError("FinCom does not change anything in Zoho except creating its own entries (" + method + " " + path + ")");
  for (let attempt = 0; ; attempt++) {
    // the count in the database: 90 a minute, 95% of the day's cap
    const t = await rpc("zoho_api_take", { p_conn: c.id, p_n: 1, p_minute: MINUTE_MAX });
    if (t.used != null) usedToday[c.id] = { used: Number(t.used), cap: Number(t.cap) };
    if (!t.ok) {
      if (t.daily) throw new ZohoError("Zoho's daily limit for this organisation is nearly used (" + t.used + " of " + t.cap + " calls today); FinCom goes on after midnight.", "daily", 429);
      const wait = Math.max(1, Number(t.wait || 60)) * 1000;
      if (Date.now() + wait > deadline) throw new ZohoError("Zoho's limit of calls a minute was reached; the rest is read on the next run.", "minute", 429);
      await sleep(wait); continue;
    }
    const gap = lastCall + GAP_MS - Date.now(); if (gap > 0) await sleep(gap);
    lastCall = Date.now();
    const q = new URLSearchParams(Object.assign({ organization_id: c.org_id }, Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])))).toString();
    const tok = await accessToken(c);
    let r: Response;
    try {
      r = await fetch(`${API}/books/v3/${path}?${q}`, { method, headers: { Authorization: "Zoho-oauthtoken " + tok, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      if (attempt < 3) { await sleep(1000 * 2 ** attempt); continue; }
      throw new ZohoError("Zoho could not be reached: " + clean((e as Error).message), "network");
    }
    let j: any = {}; try { j = await r.json(); } catch (_) { j = {}; }
    if (r.status === 401 && attempt < 2) { await accessToken(c, true); continue; }
    if (r.status === 429) {
      const daily = /day|daily/i.test(String(j.message || ""));
      // the minute (or the day) closed for every run of this organisation; when Zoho says how long, only that long here
      if (daily || !Number(r.headers.get("retry-after") || 0)) await rpc("zoho_api_block", { p_conn: c.id, p_daily: daily });
      if (daily) throw new ZohoError("Zoho says the daily limit of calls is reached for this organisation; FinCom goes on tomorrow.", "daily", 429);
      const ra = Number(r.headers.get("retry-after") || 0), wait = (ra > 0 ? ra : 60) * 1000;
      if (attempt < 3 && Date.now() + wait < deadline) { await sleep(wait); continue; }
      throw new ZohoError("Zoho asked FinCom to slow down (429); the rest is read on the next run.", "minute", 429);
    }
    if (r.status >= 500 && attempt < 3) { await sleep(1000 * 2 ** attempt); continue; }
    if (r.status >= 400 || (j.code !== undefined && j.code !== 0)) throw new ZohoError(clean(j.message || ("Zoho answered HTTP " + r.status)), String(j.code ?? r.status), r.status);
    return j;
  }
}
// every page of a list (200 a page), newest-changed first; stop(rows) ends it early
async function listAll(c: Conn, path: string, key: string, query: Record<string, string | number>, stop?: (rows: any[]) => boolean, deadline?: number) {
  const out: any[] = [];
  for (let page = 1; page <= 500; page++) {
    const j = await zoho(c, "GET", path, Object.assign({ page, per_page: 200 }, query), undefined, deadline);
    const rows = Z.listOf(j, key);
    out.push(...rows);
    if (stop && stop(rows)) return { rows: out, complete: false };
    if (!(j.page_context && j.page_context.has_more_page)) return { rows: out, complete: true };
  }
  return { rows: out, complete: false };
}

// a kind's list; bank transactions per bank, cash or card account when Zoho asks for the account (account_id)
async function listKind(c: Conn, ent: string, query: Record<string, string | number>, stop: ((rows: any[]) => boolean) | undefined, deadline: number, accounts: any[]) {
  const E = (Z.ENTITIES as any)[ent];
  try { return await listAll(c, E.path, E.list, query, stop, deadline); }
  catch (e) {
    const ze = e as ZohoError;
    if (ent !== "banktransactions" || !(ze.status >= 400 && ze.status < 500 && ze.status !== 401 && ze.status !== 429)) throw e;
    const out: any[] = []; let complete = true;
    for (const a of accounts.filter((x: any) => /^(bank|cash|credit_card|prepaid_card|payment_clearing)$/.test(String(x.account_type || "")))) {
      const l = await listAll(c, E.path, E.list, Object.assign({ account_id: a.account_id }, query), stop, deadline);
      out.push(...l.rows); complete = complete && l.complete;
    }
    // a transfer is in both its accounts' lists: once
    const once = new Map(out.map((r: any) => [String(r[E.id]), r]));
    return { rows: Array.from(once.values()), complete };
  }
}

// ---------------------------------------------------------------- the sync of one organisation
const MASTERS_EVERY_MS = 6 * 3600 * 1000, FULL_EVERY_MS = 24 * 3600 * 1000, OVERLAP = 600;
async function syncOne(c: Conn, deadline: number) {
  const counts: Record<string, any> = { fetched: 0, entries: 0, skipped: 0, gone: 0 };
  if (!(await rpc("zoho_sync_lease", { p_conn: c.id, p_secs: Math.ceil((deadline - Date.now()) / 1000) + 30 }))) return { busy: true };
  let err: string | null = null, full = false, nextMin = c.sync_every_min || 15;
  try {
    const cur = (await rpc("zoho_cursor", { p_conn: c.id })) || {};
    const objs = (await rpc("zoho_objects_for", { p_conn: c.id })) || [];
    const m: any = Z.mastersFromObjects(objs);
    // the organisation's masters: accounts, taxes and openings now and then (and on the first run); contacts that changed every run
    let mastersChanged = false;
    const mastersDue = !objs.length || !cur.__masters || (Date.now() / 1000 - Number(cur.__masters)) * 1000 > MASTERS_EVERY_MS;
    let opening: any = null;
    if (mastersDue) {
      m.accounts = (await listAll(c, "chartofaccounts", "chartofaccounts", {}, undefined, deadline)).rows;
      m.taxes = Z.listOf(await zoho(c, "GET", "settings/taxes", {}, undefined, deadline), "taxes");
      try { m.tdsTaxes = Z.listOf(await zoho(c, "GET", "settings/taxes", { is_tds_request: "true" }, undefined, deadline), "taxes").filter((t: any) => /tds|tcs/i.test(String(t.tax_specific_type || t.tax_type || "")) || Z.sectionOf(t)); } catch (_) { /* an organisation without TDS */ }
      try { opening = Z.oneOf(await zoho(c, "GET", "settings/openingbalances", {}, undefined, deadline), "opening_balance"); } catch (_) { opening = null; }
      mastersChanged = true;
    }
    const cc = Number(cur.contacts || 0);
    const cl = await listAll(c, "contacts", "contacts", { sort_column: "last_modified_time", sort_order: "D" }, (rows) => rows.some((r: any) => Z.modSec(r.last_modified_time) && Z.modSec(r.last_modified_time) < cc - OVERLAP), deadline);
    const byId = new Map(m.contacts.map((x: any) => [String(x.contact_id), x]));
    let cmax = cc;
    for (const r of cl.rows) {
      const ms = Z.modSec(r.last_modified_time); if (ms > cmax) cmax = ms;
      const had: any = byId.get(String(r.contact_id));
      if (had && ms && had.modified === ms) continue;
      const d = Z.oneOf(await zoho(c, "GET", "contacts/" + r.contact_id, {}, undefined, deadline), "contact") || r;
      byId.set(String(r.contact_id), d); mastersChanged = true;
    }
    m.contacts = Array.from(byId.values());
    let ctx = Z.makeCtx({ org: { gst_no: c.org_gstin }, accounts: m.accounts, contacts: m.contacts, taxes: m.taxes, tdsTaxes: m.tdsTaxes, known: m.known });
    const pushMasters = async (withOpening: any) => {
      const L = Z.orgLedgers(ctx, withOpening);
      await rpc("zoho_masters", { p_conn: c.id, p_ledgers: L.ledgers.map((l: any) => withOpening ? l : Object.assign({}, l, { open: null })), p_groups: L.groups, p_objects: L.objects });
    };
    if (mastersChanged) {
      await pushMasters(opening);
      if (mastersDue) await rpc("zoho_cursor_set", { p_conn: c.id, p_entity: "__masters", p_cursor: Math.floor(Date.now() / 1000), p_listed: m.accounts.length, p_fetched: 0 });
      await rpc("zoho_cursor_set", { p_conn: c.id, p_entity: "contacts", p_cursor: cmax, p_listed: cl.rows.length, p_fetched: 0 });
    }
    // an account or contact made in Zoho since the masters were read: read it now (the accounts once a run, a contact by
    // its id), the masters kept, and the documents mapped again, so no entry lands on a ledger FinCom does not know
    let accountsAgain = mastersDue;
    const tried = new Set<string>();
    const mapWithMasters = async (ent: string, docs: any[]) => {
      ctx.miss = { acc: new Set(), con: new Set() };
      let out = Z.mapDocs(ent, docs, ctx);
      const acc = [...ctx.miss.acc].filter((x) => !tried.has("a" + x)), con = [...ctx.miss.con].filter((x) => !tried.has("c" + x)).slice(0, 20);
      if (!acc.length && !con.length) return out;
      acc.forEach((x) => tried.add("a" + x)); con.forEach((x) => tried.add("c" + x));
      if (acc.length && !accountsAgain) { m.accounts = (await listAll(c, "chartofaccounts", "chartofaccounts", {}, undefined, deadline)).rows; accountsAgain = true; }
      for (const id of con) { const d = Z.oneOf(await zoho(c, "GET", "contacts/" + id, {}, undefined, deadline), "contact"); if (d) byId.set(String(id), d); }
      m.contacts = Array.from(byId.values());
      ctx = Z.makeCtx({ org: { gst_no: c.org_gstin }, accounts: m.accounts, contacts: m.contacts, taxes: m.taxes, tdsTaxes: m.tdsTaxes, known: Z.knownOf(ctx) });
      await pushMasters(null);
      counts.masters = (counts.masters || 0) + acc.length + con.length;
      out = Z.mapDocs(ent, docs, ctx);
      return out;
    };
    // the documents of each kind that changed
    const from = String(c.sync_from || "").slice(0, 10);
    for (const ent of Z.ENTITY_ORDER) {
      const E = (Z.ENTITIES as any)[ent], since = Number(cur[ent] || 0);
      const l = await listKind(c, ent, { sort_column: "last_modified_time", sort_order: "D" }, (rows) => rows.some((r: any) => Z.modSec(r.last_modified_time) && Z.modSec(r.last_modified_time) < since - OVERLAP), deadline, m.accounts);
      const rows = l.rows.filter((r: any) => r && r[E.id]);
      const want: string[] = (await rpc("zoho_changed", { p_conn: c.id, p_entity: ent, p_docs: rows.map((r: any) => [String(r[E.id]), Z.modSec(r.last_modified_time)]) })) || [];
      const wantSet = new Set(want.map(String));
      const todo = rows.filter((r: any) => wantSet.has(String(r[E.id]))).sort((a: any, b: any) => Z.modSec(a.last_modified_time) - Z.modSec(b.last_modified_time));
      let batch: any[] = [], seen: any[] = [];
      const flush = async () => {
        if (!batch.length && !seen.length) return;
        const out = await mapWithMasters(ent, batch);
        await rpc("zoho_ingest", { p_conn: c.id, p_vouchers: out.vouchers, p_lines: out.lines, p_seen: seen });
        counts.entries += out.vouchers.length; counts.skipped += out.skipped.length;
        if (out.notes.length) counts.notes = (counts.notes || []).concat(out.notes.slice(0, 5));
        batch = []; seen = [];
      };
      for (const r of todo) {
        // the run's time is up (an edge function has about two and a half minutes): what is stored stays, the rest next run
        if (Date.now() > deadline - 8000) { await flush(); throw new ZohoError("This run's time is up; the rest is read in a minute.", "time"); }
        const id = String(r[E.id]), ms = Z.modSec(r.last_modified_time), guid = Z.guidOf(ent, id);
        const day = String(r[E.date] || r.date || "").slice(0, 10);
        if (day && from && day < from) { seen.push([ent, id, guid, ms, "before the books begin"]); continue; }
        if (ent === "banktransactions" && !Z.ownBankLine(r)) { seen.push([ent, id, guid, ms, "booked by its own document"]); continue; }
        const d = Z.oneOf(await zoho(c, "GET", E.path + "/" + id, {}, undefined, deadline), E.key);
        counts.fetched++;
        if (!d) continue;
        const one = Z.mapDoc(ent, d, ctx);
        if ((one as any).skip) seen.push([ent, id, guid, Z.modSec(d.last_modified_time) || ms, (one as any).skip]);
        else { batch.push(d); seen.push([ent, id, guid, Z.modSec(d.last_modified_time) || ms, null]); }
        if (batch.length >= 25) await flush();
      }
      await flush();
      // the cursor moves only once every changed document of the kind is stored (a run cut short lists again next time,
      // and zoho_changed skips what it stored)
      const top = rows.reduce((a: number, r: any) => Math.max(a, Z.modSec(r.last_modified_time)), since);
      await rpc("zoho_cursor_set", { p_conn: c.id, p_entity: ent, p_cursor: top, p_listed: rows.length, p_fetched: counts.fetched });
    }
    // once a day: every id each kind lists now, against those held (deletions)
    if (!c.full_check_at || Date.now() - Date.parse(String(c.full_check_at)) > FULL_EVERY_MS) {
      full = true;
      for (const ent of Z.ENTITY_ORDER) {
        if (Date.now() > deadline - 15000) { full = false; break; }     // not finished: tried again next run
        const E = (Z.ENTITIES as any)[ent];
        const l = await listKind(c, ent, {}, undefined, deadline, m.accounts);
        if (!l.complete) { full = false; continue; }
        const g = await rpc("zoho_gone", { p_conn: c.id, p_entity: ent, p_alive: l.rows.map((r: any) => String(r[E.id])), p_confirm: false });
        counts.gone += Number(g?.gone || 0);
        if (g && g.refused) counts.held = (counts.held || 0) + Number(g.missing || 0);
      }
    }
  } catch (e) {
    const ze = e as ZohoError;
    err = ze.message;
    if (ze.code === "minute" || ze.code === "time") { err = null; nextMin = 1; counts.paused = ze.code === "time" ? "time up" : "minute limit"; }
    else if (ze.code === "daily") {
      // after midnight IST (18:30 UTC), when Zoho's day starts again
      let m = Math.ceil((new Date(new Date().toISOString().slice(0, 10) + "T18:31:00Z").getTime() - Date.now()) / 60000);
      if (m <= 0) m += 24 * 60;
      nextMin = Math.max(30, m);
    }
    else nextMin = 15;
  }
  // past half of the day's cap, the reads slow down (twice the interval; three times past three quarters)
  const u = usedToday[c.id];
  if (!err && u && u.cap) nextMin = nextMin * (u.used > u.cap * 0.75 ? 3 : u.used > u.cap * 0.5 ? 2 : 1);
  counts.calls = u ? u.used : undefined;
  await rpc("zoho_sync_end", { p_conn: c.id, p_next_min: nextMin, p_error: err, p_full: full && !err, p_counts: counts });
  return { error: err, counts, full };
}

// ---------------------------------------------------------------- posting
type Line = { ledger: string, dr: boolean, amount: number };
type Entry = { id: string, type?: string, date: string, no?: string, ref?: string, party?: string, narration?: string, lines: Line[] };
const r2 = Z.r2;
export function planPost(e: Entry, objs: any[], orgState: string) {
  const key = (s: string) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const by = new Map<string, any>(); objs.forEach((o) => { if (o.ledger) by.set(key(o.ledger) + "|" + o.kind, o); });
  const find = (l: string, kind: string) => by.get(key(l) + "|" + kind);
  const taxes = objs.filter((o) => o.kind === "tax");
  const roles = e.lines.map((l) => {
    const g = find(l.ledger, "gst_ledger"); if (g) return { l, role: g.data.side === "rcm" ? "rcm" : "gst", head: g.data.head, side: g.data.side };
    const t = find(l.ledger, "tds_tax"); if (t) return { l, role: "tds", obj: t };
    const c = find(l.ledger, "contact"); if (c) return { l, role: "contact", obj: c };
    const a = find(l.ledger, "account"); if (a) {
      const ty = String(a.data.account_type || "");
      return { l, role: /^(bank|cash|credit_card|prepaid_card|payment_clearing)$/.test(ty) ? "bank" : /rounding/i.test(a.name) ? "round" : "account", obj: a };
    }
    if (/^round(ing)?\s*off$/i.test(l.ledger.trim())) return { l, role: "round" };
    return { l, role: "unknown" };
  });
  const unknown = roles.filter((x) => x.role === "unknown").map((x) => x.l.ledger);
  if (unknown.length) return { error: "Not in Zoho Books: " + unknown.join(", ") + ". Create " + (unknown.length === 1 ? "it" : "them") + " in Zoho first (FinCom makes only parties there), or choose a ledger Zoho has." };
  const amt = (x: any) => r2(x.l.amount);
  const party = roles.find((x) => x.role === "contact" && !x.l.dr);
  const exp = roles.filter((x) => x.role === "account" && x.l.dr);
  const gst = roles.filter((x) => x.role === "gst" && x.l.dr), rcm = roles.filter((x) => x.role === "rcm" && !x.l.dr), tds = roles.filter((x) => x.role === "tds" && !x.l.dr);
  const banks = roles.filter((x) => x.role === "bank");
  const round = r2(roles.filter((x) => x.role === "round").reduce((a, x) => a + (x.l.dr ? x.l.amount : -x.l.amount), 0));
  const base = r2(exp.reduce((a, x) => a + amt(x), 0));
  const heads: Record<string, number> = {}; gst.forEach((x) => { heads[x.head] = r2((heads[x.head] || 0) + amt(x)); });
  const taxSum = r2(Object.values(heads).reduce((a, x) => a + x, 0));
  const ref = "FC:" + e.id, notes = ((e.narration || "").replace(/TDSDesk:[A-Za-z0-9._-]+/g, "").trim() + " TDSDesk:" + e.id).trim().slice(0, 500);
  // the tax Zoho will apply: one tax (IGST) or a group (CGST + SGST) at the bill's rate, its amounts checked to the rupee
  const pickTax = () => {
    if (!taxSum) return { id: "" };
    const rate = base ? r2((heads.IGST || 0) ? heads.IGST / base * 100 : ((heads.CGST || 0) + (heads.SGST || 0)) / base * 100) : 0;
    const snap = [0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40].reduce((a, x) => Math.abs(x - rate) < Math.abs(a - rate) ? x : a, 0);
    let t: any;
    if (heads.IGST) t = taxes.find((x) => x.data.head === "IGST" && Math.abs(Number(x.data.pct) - snap) < 0.001 && !(x.data.taxes || []).length);
    else t = taxes.find((x) => (x.data.taxes || []).length === 2 && Math.abs(Number(x.data.pct) - snap) < 0.001 && (x.data.taxes || []).every((k: any) => taxes.some((y) => y.id === String(k.tax_id) && /CGST|SGST/.test(y.data.head))));
    if (!t) return { error: "Zoho Books has no " + (heads.IGST ? "IGST" : "GST (CGST + SGST)") + " tax at " + snap + "%. Add it in Zoho (Settings → Taxes) and post again." };
    const want = r2(base * snap / 100);
    if (Math.abs(want - taxSum) > 1) return { error: "The GST on this entry (" + taxSum.toFixed(2) + ") is not " + snap + "% of " + base.toFixed(2) + " (" + want.toFixed(2) + "), which is what Zoho would book. Post it by hand in Zoho, or correct it here." };
    return { id: t.id, pct: snap, want };
  };
  if (party && exp.length && !banks.length) {
    // a purchase bill
    const c = party.obj, tx: any = pickTax(); if (tx.error) return { error: tx.error };
    const tdsAmt = r2(tds.reduce((a, x) => a + amt(x), 0));
    let tdsId = "";
    if (tds.length) {
      const t = tds[0].obj, want = r2(base * Number(t.data.pct) / 100);
      if (Math.abs(want - tdsAmt) > 1) return { error: "The TDS on this entry (" + tdsAmt.toFixed(2) + ") is not " + t.data.pct + "% of " + base.toFixed(2) + " as Zoho's TDS tax " + t.name + " would deduct (" + want.toFixed(2) + ")." };
      tdsId = t.id;
    }
    const payable = amt(party), zohoTotal = r2(base + (rcm.length ? 0 : (tx.want ?? 0)) - (tdsId ? r2(base * Number(tds[0].obj.data.pct) / 100) : 0));
    const adjustment = r2(payable - zohoTotal);
    if (Math.abs(adjustment) > 1) return { error: "The amount payable (" + payable.toFixed(2) + ") does not agree with what Zoho would work out (" + zohoTotal.toFixed(2) + ")." };
    const sos = String(c.data.place_of_contact || "") || Z.zohoStateOf(c.data.gst_no);
    const doc: any = { vendor_id: c.id, bill_number: String(e.ref || e.no || e.id).slice(0, 100), date: e.date, reference_number: ref, notes,
      gst_treatment: c.data.gst_treatment || (c.data.gst_no ? "business_gst" : "business_none"), gst_no: c.data.gst_no || undefined,
      source_of_supply: sos || orgState, destination_of_supply: orgState, is_reverse_charge_applied: rcm.length > 0,
      line_items: exp.map((x) => ({ account_id: x.obj.id, rate: amt(x), quantity: 1, tax_id: tx.id || undefined })) };
    if (tdsId) doc.tds_tax_id = tdsId;
    if (Math.abs(adjustment) >= 0.01) { doc.adjustment = adjustment; doc.adjustment_description = "Rounding (FinCom)"; }
    return { kind: "bill", path: "bills", key: "bill", idField: "bill_id", noField: "bill_number", doc };
  }
  if (banks.length === 1 && !banks[0].l.dr && exp.length && !party && !tds.length && !rcm.length) {
    // money paid out of a bank or cash account for an expense
    const tx: any = pickTax(); if (tx.error) return { error: tx.error };
    if (exp.length > 1 && tx.id) return { kind: "journal" as const, ...journal() };
    const doc: any = { account_id: exp[0].obj.id, paid_through_account_id: banks[0].obj.id, date: e.date, amount: base, reference_number: ref, description: notes, is_inclusive_tax: false };
    if (exp.length > 1) { delete doc.account_id; delete doc.amount; doc.line_items = exp.map((x) => ({ account_id: x.obj.id, amount: amt(x) })); }
    if (tx.id) doc.tax_id = tx.id;
    if (Math.abs(r2(amt(banks[0]) - base - taxSum - round)) > 0.01) return { error: "The entry does not balance as an expense." };
    return { kind: "expense", path: "expenses", key: "expense", idField: "expense_id", noField: "reference_number", doc };
  }
  return { kind: "journal" as const, ...journal() };
  function journal() {
    if (gst.length || rcm.length || roles.some((x) => x.role === "gst" || x.role === "rcm")) return { error: "An entry with GST that is not a purchase bill or an expense is not posted to Zoho as a journal (its GST would not reach Zoho's returns). Post it by hand in Zoho." };
    const items = roles.map((x) => {
      const it: any = { debit_or_credit: x.l.dr ? "debit" : "credit", amount: amt(x) };
      if (x.role === "contact") {
        const vendor = /vendor/i.test(String(x.obj.data.contact_type || ""));
        const ap = objs.find((o) => o.kind === "account" && (vendor ? /accounts_payable/ : /accounts_receivable/).test(String(o.data.account_type || "")));
        if (!ap) return { error: "Zoho has no " + (vendor ? "Accounts Payable" : "Accounts Receivable") + " account." };
        it.account_id = ap.id; it.customer_id = x.obj.id;
      } else if (x.role === "tds") {
        const a = objs.find((o) => o.kind === "account" && /tds payable/i.test(o.name));
        if (!a) return { error: "Zoho has no TDS Payable account for " + x.l.ledger + "." };
        it.account_id = a.id;
      } else if (x.obj) it.account_id = x.obj.id;
      else { const a = objs.find((o) => o.kind === "account" && /round/i.test(o.name)); if (!a) return { error: "Zoho has no account for " + x.l.ledger + "." }; it.account_id = a.id; }
      return it;
    });
    const bad = items.find((x: any) => x.error); if (bad) return { error: bad.error };
    return { path: "journals", key: "journal", idField: "journal_id", noField: "entry_number", doc: { journal_date: e.date, reference_number: ref, notes, line_items: items } };
  }
}
// the id FinCom keeps for an entry in Zoho (its reference "FC:<id>"): FinCom's own id when it is plain, else a hash of it
// (a new ledger's id carries its name)
async function safeId(id: string) { return /^[A-Za-z0-9._:-]{1,80}$/.test(id) ? id : "h:" + (await sha256(id)).slice(0, 40); }
async function postEntries(user: string, body: any) {
  const entries0: Entry[] = Array.isArray(body.entries) ? body.entries.slice(0, 200) : [];
  const masters0: any[] = Array.isArray(body.masters) ? body.masters.slice(0, 50) : [];
  if (entries0.concat(masters0).some((x) => !x || !String(x.id || "").trim() || String(x.id).length > 300)) return { ok: false, error: "bad entry id" };
  const entries: Entry[] = [], masters: any[] = [], orig: Record<string, string> = {};
  for (const e of entries0) { const k = await safeId(String(e.id)); orig[k] = String(e.id); entries.push(Object.assign({}, e, { id: k })); }
  for (const m of masters0) { const k = await safeId(String(m.id)); orig[k] = String(m.id); masters.push(Object.assign({}, m, { id: k })); }
  const ids = entries.map((e) => e.id).concat(masters.map((m) => m.id));
  const b = await rpc("zoho_post_begin", { p_user: user, p_client: String(body.client || ""), p_ids: ids });
  if (!b.ok) return b;
  const job = b.job as string, known = b.known || {}, results: any[] = [];
  const c: Conn = (await rpc("zoho_connection", { p_conn: b.connection })) as Conn;
  const deadline = Date.now() + RUN_MS;
  let message = "";
  try {
    let objs: any[] = (await rpc("zoho_objects_for", { p_conn: c.id })) || [];
    const orgState = Z.zohoStateOf(c.org_gstin);
    // new parties first (only parties: an account FinCom never makes in Zoho)
    for (const m of masters) {
      const name = String(m.name || "").trim(), grp = String(m.group || "");
      if (!/sundry (creditors|debtors)/i.test(grp)) { results.push({ id: m.id, ok: false, kind: "master", message: "Create the account “" + name + "” in Zoho Books first: FinCom makes only parties there." }); continue; }
      if (objs.some((o) => o.kind === "contact" && o.ledger.toLowerCase() === name.toLowerCase())) { results.push({ id: m.id, ok: true, kind: "master", existed: true, message: "Already in Zoho Books" }); continue; }
      const vendor = /creditors/i.test(grp), g = String(m.gstin || "").toUpperCase();
      const doc: any = { contact_name: name.slice(0, 200), contact_type: vendor ? "vendor" : "customer", gst_treatment: g ? "business_gst" : "business_none" };
      if (g) { doc.gst_no = g; doc.place_of_contact = Z.zohoStateOf(g) || undefined; }
      try {
        await rpc("zoho_post_mark", { p_job: job, p_fincom_id: m.id, p_kind: "contact", p_state: "posting", p_zoho_id: null, p_number: null, p_message: "", p_request: doc });
        const j = await zoho(c, "POST", "contacts", {}, doc, deadline), made = Z.oneOf(j, "contact") || {};
        await rpc("zoho_post_mark", { p_job: job, p_fincom_id: m.id, p_kind: "contact", p_state: "posted", p_zoho_id: String(made.contact_id || ""), p_number: name, p_message: "Created in Zoho Books", p_request: null });
        objs.push({ kind: "contact", id: String(made.contact_id || ""), name, ledger: name, data: { contact_type: doc.contact_type, gst_no: g, gst_treatment: doc.gst_treatment, place_of_contact: doc.place_of_contact || "" } });
        results.push({ id: m.id, ok: true, kind: "master", message: "Created in Zoho Books", zoho: { kind: "contact", id: made.contact_id } });
      } catch (e) {
        await rpc("zoho_post_mark", { p_job: job, p_fincom_id: m.id, p_kind: "contact", p_state: "error", p_zoho_id: null, p_number: null, p_message: (e as Error).message, p_request: null });
        results.push({ id: m.id, ok: false, kind: "master", message: "Zoho: " + (e as Error).message });
      }
    }
    for (const e of entries) {
      const id = String(e.id), k = known[id];
      if (k && k.state === "posted") { results.push({ id, ok: true, already: true, alreadyThere: true, zoho: { kind: k.kind, id: k.zoho_id, number: k.number }, message: "Already in Zoho Books (" + (k.kind || "entry") + " " + (k.number || k.zoho_id) + "): not sent again" }); continue; }
      const p: any = planPost(e, objs, orgState);
      if (p.error) { await rpc("zoho_post_mark", { p_job: job, p_fincom_id: id, p_kind: "", p_state: "error", p_zoho_id: null, p_number: null, p_message: p.error, p_request: null }); results.push({ id, ok: false, message: p.error }); continue; }
      try {
        // the duplicate check in Zoho itself: FinCom's reference on any document of the kind
        const hit = Z.listOf(await zoho(c, "GET", p.path, { reference_number: "FC:" + id }, undefined, deadline), p.path).find((x: any) => String(x.reference_number || "") === "FC:" + id);
        if (hit) {
          await rpc("zoho_post_mark", { p_job: job, p_fincom_id: id, p_kind: p.kind, p_state: "posted", p_zoho_id: String(hit[p.idField] || ""), p_number: String(hit[p.noField] || ""), p_message: "Found in Zoho Books (posted before)", p_request: null });
          results.push({ id, ok: true, already: true, alreadyThere: true, zoho: { kind: p.kind, id: hit[p.idField], number: hit[p.noField] }, message: "Already in Zoho Books (" + p.kind + " " + (hit[p.noField] || hit[p.idField]) + "): not sent again" });
          continue;
        }
        await rpc("zoho_post_mark", { p_job: job, p_fincom_id: id, p_kind: p.kind, p_state: "posting", p_zoho_id: null, p_number: null, p_message: "", p_request: p.doc });
        const j = await zoho(c, "POST", p.path, {}, p.doc, deadline), made = Z.oneOf(j, p.key) || {};
        const zid = String(made[p.idField] || ""), no = String(made[p.noField] || "");
        await rpc("zoho_post_mark", { p_job: job, p_fincom_id: id, p_kind: p.kind, p_state: "posted", p_zoho_id: zid, p_number: no, p_message: "Posted to Zoho Books", p_request: null });
        results.push({ id, ok: true, byReply: true, zoho: { kind: p.kind, id: zid, number: no }, message: "Posted to Zoho Books (" + p.kind + " " + (no || zid) + ")" });
      } catch (err) {
        const msg = (err as Error).message;
        await rpc("zoho_post_mark", { p_job: job, p_fincom_id: id, p_kind: p.kind, p_state: "error", p_zoho_id: null, p_number: null, p_message: "Zoho: " + msg, p_request: null });
        results.push({ id, ok: false, message: "Zoho: " + msg });
        if ((err as ZohoError).code === "daily" || (err as ZohoError).code === "sign_in") { message = msg; break; }
      }
    }
  } finally {
    entries.forEach((e) => { if (!results.some((r) => r.id === String(e.id))) results.push({ id: String(e.id), ok: false, message: message || "Not posted: the posting stopped. Post again: entries already in Zoho are recognised and not sent twice." }); });
    const okN = results.filter((r) => r.ok).length;
    await rpc("zoho_post_end", { p_job: job, p_status: "done", p_results: results, p_message: message || (okN + " of " + results.length + " posted") });
  }
  return { ok: true, job, results: results.map((x) => Object.assign({}, x, { id: orig[x.id] || x.id })) };
}

// ---------------------------------------------------------------- the HTTP side
function json(status: number, body: unknown, req: Request | null) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ "Content-Type": "application/json" }, corsFor(req)) });
}
function backTo(back: string, hash: string) {
  let u = "";
  try { const x = new URL(back); if (allowedOrigins().includes(x.origin)) u = x.origin + x.pathname; } catch (_) { u = ""; }
  return (u || "https://staging.fincom.live/") + hash;
}
async function callback(url: URL) {
  const st = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "", err = url.searchParams.get("error") || "";
  const s = st ? await rpc("zoho_state_take", { p_state_hash: await sha256(st) }) : null;
  const go = (hash: string) => new Response(null, { status: 302, headers: { Location: backTo(s?.back || "", hash) } });
  if (!s) return go("#/integrations/zoho?zoho=expired");
  if (err || !code) return go("#/integrations/zoho?zoho=refused");
  const loc = (url.searchParams.get("location") || "in").toLowerCase();
  if (loc && loc !== "in") return go("#/integrations/zoho?zoho=not-india");
  const { status, j } = await form(ACCOUNTS + "/oauth/v2/token", { code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: REDIRECT, grant_type: "authorization_code" });
  if (status !== 200 || !j.access_token || !j.refresh_token) return go("#/integrations/zoho?zoho=failed");
  // the organisations this sign-in reaches (names and GSTINs only)
  let orgs: any[] = [];
  try {
    const r = await fetch(API + "/books/v3/organizations", { headers: { Authorization: "Zoho-oauthtoken " + j.access_token } });
    const o = await r.json();
    orgs = Z.listOf(o, "organizations").map((x: any) => ({ id: String(x.organization_id), name: String(x.name || ""), gstin: String(x.gst_no || x.tax_reg_no || "").toUpperCase(), plan: String(x.plan_name || ""), cap: capOf(x) }));
  } catch (_) { orgs = []; }
  const until = new Date(Date.now() + Number(j.expires_in || 3600) * 1000).toISOString();
  const g = await rpc("zoho_grant_save", { p_firm: s.firm, p_user: s.user, p_scopes: String(j.scope || SCOPES.join(",")), p_orgs: orgs, p_expires: until });
  await rpc("zoho_secret_put", { p_name: secretName(s.firm, g, "refresh"), p_value: j.refresh_token });
  await rpc("zoho_secret_put", { p_name: secretName(s.firm, g, "access"), p_value: j.access_token });
  return go("#/integrations/zoho?grant=" + encodeURIComponent(g));
}
// the daily cap by plan (Zoho: Free 1,000; Standard 2,000; Professional 5,000; Premium and above 10,000)
function capOf(o: any) { const p = String(o.plan_name || "").toLowerCase(); return /premium|elite|ultimate/.test(p) ? 10000 : /professional/.test(p) ? 5000 : /standard/.test(p) ? 2000 : 1000; }

async function asMember(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return null;
  const asUser = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await asUser.auth.getUser();
  if (!who?.user) return null;
  const { data: mfaOk } = await asUser.rpc("mfa_ok");
  if (mfaOk !== true) return { user: who.user.id, mfa: false };
  return { user: who.user.id, mfa: true };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  try {
    if (req.method === "GET" && (url.searchParams.has("code") || url.searchParams.has("error")) && url.searchParams.has("state")) return await callback(url);
    if (req.method !== "POST") return json(405, { ok: false, error: "POST only" }, req);
    const hook = url.searchParams.get("hook");
    if (hook) { const ok = await rpc("zoho_hook", { p_hash: await sha256(hook) }); return json(ok ? 200 : 404, { ok: !!ok }, req); }
    let body: any = {};
    try { body = JSON.parse(await req.text() || "{}"); } catch (_) { return json(400, { ok: false, error: "Bad request" }, req); }
    const cron = req.headers.get("x-fincom-zoho-cron") || "";
    if (cron) {
      if ((await rpc("zoho_cron_ok", { k: cron })) !== true) return json(401, { ok: false, error: "not allowed" }, req);
      if (!configured()) return json(200, { ok: true, skipped: "not set up" }, req);
      const deadline = Date.now() + RUN_MS, done: any[] = [];
      for (const c of ((await rpc("zoho_due", { p_limit: 10 })) || []) as Conn[]) {
        if (Date.now() > deadline - 15000) break;
        // console phase 1b: a paused firm's books are not written (its schedule simply waits)
        const gate = await firmGate(viaClient(db), String((c as any).firm_id || ""), (c as any).client_id ? String((c as any).client_id) : null);
        if (gate) { done.push({ connection: c.id, skipped: gate.reason }); continue; }
        done.push({ connection: c.id, ...(await syncOne(c, deadline)) });
      }
      return json(200, { ok: true, done }, req);
    }
    const me = await asMember(req);
    if (!me) return json(401, { ok: false, error: "Sign in to FinCom again." }, req);
    if (!me.mfa) return json(403, { ok: false, error: "Finish the two-step sign-in first." }, req);
    const kind = String(body.kind || "");
    if (kind === "config") return json(200, { ok: true, configured: configured(), redirectUri: REDIRECT, scopes: SCOPES, dc: "India (accounts.zoho.in)" }, req);
    // console phase 1b: a paused firm (FinCom's console) connects, reads into its books and posts nothing; it may still
    // give up a connection (disconnect). The service role skips can_write(), so it is asked here
    if (["connect_start", "link", "sync_now", "hook_new", "post"].includes(kind)) {
      const mine = await rpc("zoho_member", { p_user: me.user }).catch(() => null);
      const gate = mine && mine.firm ? await firmGate(viaClient(db), String(mine.firm), body.client ? String(body.client) : null) : null;
      if (gate) return json(gate.status, { ok: false, reason: gate.reason, error: gate.error }, req);
    }
    if (!configured() && kind !== "disconnect") return json(200, { ok: false, notSetUp: true, error: "Zoho Books is not set up for FinCom yet: the owner's Zoho API client id and secret are not in place." }, req);
    if (kind === "connect_start") {
      const st = randomHex(24);
      await rpc("zoho_state_new", { p_user: me.user, p_state_hash: await sha256(st), p_back: String(body.back || "") });
      const q = new URLSearchParams({ scope: SCOPES.join(","), client_id: clientId(), response_type: "code", access_type: "offline", prompt: "consent", redirect_uri: REDIRECT, state: st });
      return json(200, { ok: true, url: ACCOUNTS + "/oauth/v2/auth?" + q.toString() }, req);
    }
    if (kind === "link") {
      const r = await rpc("zoho_link", { p_user: me.user, p_grant: String(body.grant || ""), p_org: String(body.org || ""), p_client: String(body.client || ""), p_from: body.from || null });
      // the first read starts now (as much as fits; the schedule carries on)
      const c = (await rpc("zoho_connection", { p_conn: r.connection })) as Conn;
      const s = await syncOne(c, Date.now() + Math.min(RUN_MS, 100000));
      return json(200, { ok: true, connection: r.connection, book: r.book, first: { error: s.error || null, counts: (s as any).counts || {} } }, req);
    }
    if (kind === "sync_now") {
      await rpc("zoho_need", { p_user: me.user, p_owner: false });
      const firm = (await rpc("zoho_member", { p_user: me.user }))?.firm;
      const c = (await rpc("zoho_connection", { p_conn: String(body.connection || "") })) as any;
      if (!c || c.firm_id !== firm || c.status !== "connected") return json(404, { ok: false, error: "No such connection." }, req);
      const s = await syncOne(c, Date.now() + Math.min(RUN_MS, 100000));
      return json(200, { ok: !s.error, ...s }, req);
    }
    if (kind === "disconnect") {
      const r = await rpc("zoho_disconnect", { p_user: me.user, p_conn: String(body.connection || "") });
      let revoked = false;
      if (r.revoke && configured()) {
        const t = await rpc("zoho_secret_get", { p_name: secretName(r.firm, r.grant, "refresh") });
        if (t) { const x = await form(ACCOUNTS + "/oauth/v2/token/revoke", { token: String(t) }); revoked = x.status === 200; }
      }
      return json(200, { ok: true, revoked, message: "FinCom's access to this Zoho organisation is given up. Nothing was deleted, in FinCom or in Zoho." }, req);
    }
    if (kind === "hook_new") {
      const tok = randomHex(24);
      await rpc("zoho_hook_set", { p_user: me.user, p_conn: String(body.connection || ""), p_hash: await sha256(tok) });
      return json(200, { ok: true, url: REDIRECT + "?hook=" + tok }, req);
    }
    if (kind === "post") return json(200, await postEntries(me.user, body), req);
    return json(400, { ok: false, error: "unknown kind" }, req);
  } catch (e) {
    const msg = clean((e as Error).message);
    const status = /not allowed|only the firm|look-only|not a member/i.test(msg) ? 403 : 500;
    console.error("zoho-books", msg);
    return json(status, { ok: false, error: msg }, req);
  }
});
