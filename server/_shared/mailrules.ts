// The rules for an email FinCom sends on a firm's behalf: mis-run's scheduled report and fincom-call's meeting
// invites. Plain module, no imports.
//  - to whom: the firm's active members, the addresses saved in the client's own details, and addresses their owners
//    confirmed with a code when joining one of the firm's calls (call_participants.verified). The functions ask the
//    database for the first and the last; savedEmails() reads the second out of a client's saved details;
//  - how many: MAIL_DAY_MAX people a day for a firm, counted in the shared table of migration 112 (bucket mail-firm).
//    The places are taken before the email goes out, in one database call that checks and counts together
//    (auth_rate_take, migration 191). When that call fails nothing is sent, and the caller says the count could not
//    be read (not that the day's count is reached);
//  - in whose words: the subject is FinCom's own; names a firm typed go into an email as plain words only (plainWords).
export const MAIL_DAY_MAX = 200;
export const MAIL_BUCKET = "mail-firm";
// an address as FinCom will send to: no quotes, brackets or backslashes
export const EMAIL_STRICT = /^[^@\s,;<>"'()\\]+@[^@\s,;<>"'()\\]+\.[a-z]{2,}$/i;
export const lowEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
// letters, digits, spaces and & ( ) , ' - only: no address or markup can be written with them
export const plainWords = (t: unknown) => String(t ?? "").replace(/[^\p{L}\p{N} &(),'-]/gu, " ").replace(/\s+/g, " ").replace(/ ([,)])/g, "$1").trim().slice(0, 80);
// every email address written anywhere in a client's saved details
export function savedEmails(data: unknown, out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 8 || data == null) return out;
  if (typeof data === "string") { const t = lowEmail(data); if (t.length <= 200 && EMAIL_STRICT.test(t)) out.add(t); }
  else if (Array.isArray(data)) data.slice(0, 500).forEach((x) => savedEmails(x, out, depth + 1));
  else if (typeof data === "object") Object.values(data as Record<string, unknown>).slice(0, 500).forEach((x) => savedEmails(x, out, depth + 1));
  return out;
}
export async function sha256hex(t: string) { const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))); return [...h].map((b) => b.toString(16).padStart(2, "0")).join(""); }
// the PostgREST filter for "one of these addresses" (each already EMAIL_STRICT)
export const emailIn = (list: string[]) => "in.(" + encodeURIComponent(list.map((e) => '"' + e + '"').join(",")) + ")";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
// take n of the firm's places for today: "ok" (taken: send), "limit" (they do not fit: nothing taken) or "unknown"
// (the database call failed, or answered something else: nothing is known to be taken; the failure is logged)
export async function mailTake(rpc: Rpc, firm: string, n: number): Promise<"ok" | "limit" | "unknown"> {
  const key = await sha256hex(MAIL_BUCKET + ":" + firm);
  try {
    const took = await rpc("auth_rate_take", { p_bucket: MAIL_BUCKET, p_key: key, p_n: n, p_max: MAIL_DAY_MAX, p_window_s: 86400 });
    if (took === true) return "ok";
    if (took === false) return "limit";
    console.error("mailrules: auth_rate_take answered neither true nor false");
  } catch (e) { console.error("mailrules: the firm's email count could not be taken: " + String((e as Error)?.message || e).slice(0, 200)); }
  return "unknown";
}
