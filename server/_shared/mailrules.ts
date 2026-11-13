// The rules for an email FinCom sends on a firm's behalf (13-Nov-2026, security review M5): mis-run's scheduled report
// and fincom-call's meeting invites. Plain module, no imports.
//  - to whom: the firm's active members, the addresses saved in the client's own details, and addresses their owners
//    confirmed with a code when joining one of the firm's calls (call_participants.verified). The functions ask the
//    database for the first and the last; savedEmails() reads the second out of a client's saved details;
//  - how many: MAIL_DAY_MAX people a day for a firm, counted in the shared table of migration 112 (bucket mail-firm);
//    when the count cannot be read nothing is sent;
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
// may the firm send n more today? "ok", "limit" (the day's count is reached) or "unknown" (the count cannot be read)
export async function mailFits(rpc: Rpc, firm: string, n: number): Promise<"ok" | "limit" | "unknown"> {
  const key = await sha256hex(MAIL_BUCKET + ":" + firm);
  const had = await rpc("auth_rate_count", { p_bucket: MAIL_BUCKET, p_key: key, p_window_s: 86400 }).then((x) => (typeof x === "number" ? x : NaN), () => NaN);
  return isNaN(had) ? "unknown" : had + n <= MAIL_DAY_MAX ? "ok" : "limit";
}
// n emails were sent for the firm
export async function mailSent(rpc: Rpc, firm: string, n: number): Promise<void> {
  const key = await sha256hex(MAIL_BUCKET + ":" + firm);
  await Promise.all(Array.from({ length: n }, () => rpc("auth_rate_add", { p_bucket: MAIL_BUCKET, p_key: key }).catch(() => null)));
}
