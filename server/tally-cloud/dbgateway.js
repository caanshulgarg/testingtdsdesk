// next-fix-devlookup (18-Nov-2026; Sentry FINCOM-CLOUD-STAGING-8, -B, -C, -9): the database's gateway error pages.
// While staging's Postgres restarted (16 Nov 12:46, 17 Nov 12:48, 13:34 and 14:04, 18 Nov 06:01 UTC: "database system was
// not properly shut down"), the gateway in front of Supabase answered every REST call with a whole HTML page (Cloudflare's
// 520 unknown error, 521 web server is down, 522 connection timed out, 525 SSL handshake failed), and supabase-js handed
// the page over as the error's message. Each page carries its own Ray ID and time, so the same outage became many Sentry
// events in several issues, each a scrubbed page ("… Connection timed out … Browser …"), and the log line was a page's
// first 200 characters. Here: the page as one short line (its status and title), whether an error is worth one more try
// (a lost connection only, never a statement timeout: that would add to the load that caused it), one more try for a READ,
// and the fixed words a Sentry report of it carries (its status and code as tags). Pure; tested by dbgateway_test.ts.

// what the Sentry report of any gateway page says: words the scrubber (server/_shared/sentry-scrub.js) keeps whole, so the
// report is one issue whatever the page; the status goes as a tag
export const UNREACHABLE = "the database server is unreachable";
// the gateway's own statuses: Bad Gateway, Unavailable, Gateway Timeout, and Cloudflare's 520-527 and 530
const GATEWAY = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);
// PostgREST's "could not connect" (PGRST000-002) and Postgres's "shutting down / starting up / connection lost"
const LOST_CODES = new Set(["PGRST000", "PGRST001", "PGRST002", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006"]);
const LOST_WORDS = /fetch failed|error sending request|connection (?:reset|refused|closed|terminated|timed out)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|network ?error|socket hang up|tls handshake/i;

const looksHtml = (s) => typeof s === "string" && /^\s*(?:<!doctype html|<html|<head|<body|<\?xml)|<\/html>\s*$|<title>/i.test(s.slice(0, 400)) ;
const msgOf = (e) => (e && typeof e === "object" && typeof e.message === "string" ? e.message : typeof e === "string" ? e : "");

// the error as one short line when it is a gateway's HTML page ({code: "GW522", message: "the database gateway answered
// 522: Connection timed out", status, gateway: true, transient: true}); any other error is handed back as it is
export function dbErrorShort(err, status) {
  const m = msgOf(err);
  if (!looksHtml(m)) return err;
  const title = (m.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i) || [])[1] || "";
  const t = title.match(/(?:^|\|)\s*([1-5]\d{2})\s*:\s*([^<|]{1,120})/);
  let st = Number(status) || 0;
  if (t && (!st || st < 500)) st = Number(t[1]);
  if (!st) { const c = m.match(/cf-error-code[^>]*>\s*(\d{3})\s*</i); if (c) st = Number(c[1]); }
  // the title's words only: letters, digits, spaces and plain marks, nothing of the page beyond them
  const words = t ? t[2].replace(/[^A-Za-z0-9 .,'()-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) : "";
  const message = ("the database gateway answered " + (st || "an error page") + (words ? ": " + words : "")).slice(0, 200);
  return { code: st ? "GW" + st : "GW000", message, status: st || undefined, gateway: true, transient: true };
}

// worth one more try: the gateway's page or status, or the connection to the database lost; never an answer of the
// database itself (a statement timeout, a constraint, no such row, a permission)
export function isTransientDb(err, status) {
  if (!err) return false;
  const st = Number(status) || 0;
  const m = msgOf(err);
  const code = err && typeof err === "object" && typeof err.code === "string" ? err.code : "";
  if (code === "57014") return false;
  if (looksHtml(m)) return true;
  if (LOST_CODES.has(code)) return true;
  if (GATEWAY.has(st) && !code) return true;
  if (/^GW\d{3}$/.test(code)) return true;
  return LOST_WORDS.test(m);
}

// a Sentry report of a gateway page: the fixed short words and its status and code as tags ({err, tags}); null for any
// other error (reported as before)
export function dbReport(err, status) {
  const s = dbErrorShort(err, status);
  if (!s || s === err || !s.gateway) return null;
  const tags = { db_code: s.code };
  if (s.status) tags.status = String(s.status);
  return { err: { message: UNREACHABLE }, tags, short: s.message };
}

// a READ, tried once more after a short wait when its error is worth it (isTransientDb) and the first try came back
// within maxMs (a 522 often comes after the gateway's own long wait; a second one would hold the caller twice as long).
// read() answers as supabase-js does ({data, error, status}) or throws (fetch itself failed). The answer: the last one,
// its error shortened (dbErrorShort), and tries. Never for a write: a write the gateway timed out may have been done
export async function readRetry(read, o = {}) {
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = o.now || (() => Date.now());
  const maxMs = o.maxMs ?? 5000;
  const wait = o.waitMs ?? 400 + Math.floor(Math.random() * 400);
  const once = async () => { try { return await read(); } catch (e) { return { data: null, error: { message: String((e && e.message) || e) }, status: 0 }; } };
  const t0 = now();
  let r = await once(), tries = 1;
  if (r && r.error && isTransientDb(r.error, r.status) && now() - t0 <= maxMs) {
    await sleep(wait);
    r = await once(); tries = 2;
  }
  const error = r && r.error ? dbErrorShort(r.error, r.status) : null;
  return { ...r, error, tries };
}
