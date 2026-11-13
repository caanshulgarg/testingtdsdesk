// FinCom help desk emails: the rules (13-Nov-2026: taken out of index.ts so the Deno tests, handler_test.ts, run them
// with fake services; index.ts wires the real ones). After a ticket is raised or answered, the app calls this with the
// ticket's id. The ticket is read as the caller (so only someone who can see it can cause mail about it) and emailed:
//   a new ticket, or the firm's reply  -> FinCom support (SUPPORT_MAIL_TO)
//   support's reply                    -> the person who raised the ticket
//   an internal note                   -> nobody
// Until RESEND_API_KEY and SUPPORT_MAIL_TO are set it answers {sent: false} and the ticket itself is unaffected.
// Security review of 13-Nov-2026, L1: the caller's two-step sign-in must be finished (mfa_ok), as every other member
// function asks.
import { publicError } from "../_shared/errors.ts";
export type Mail = { from: string; to: string[]; subject: string; text: string; reply_to?: string };
export interface Deps {
  cors: Record<string, string>;
  key: string; to: string; from: string; app: string;       // RESEND_API_KEY, SUPPORT_MAIL_TO, SUPPORT_MAIL_FROM, APP_URL
  mfaOk(jwt: string): Promise<boolean>;                      // the caller finished two-step sign-in (rpc mfa_ok as them)
  ticket(jwt: string, id: string): Promise<{ t: any | null; error: string | null }>;   // support_get as the caller
  send(m: Mail): Promise<{ ok: boolean; status: number; message?: string }>;           // Resend
  // the shared counts of migration 112 (auth_rate_count / auth_rate_add / auth_rate_hit, service role); keys are SHA-256
  count(bucket: string, key: string, windowS: number): Promise<number>;
  add(bucket: string, key: string): Promise<void>;
  hit(bucket: string, key: string, max: number, windowS: number): Promise<boolean>;
}
// 13-Nov-2026 (security review, L9): a message of a ticket is emailed once (asked again, nothing is sent), and a ticket
// causes at most TICKET_DAY_MAX emails a day. Counted in the shared table; when it cannot be reached nothing is sent
// (the ticket itself is unaffected, as when email is not set up).
export const TICKET_DAY_MAX = 20;
const TWO_DAYS = 172800;
async function sha256hex(t: string) { const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))); return [...h].map((b) => b.toString(16).padStart(2, "0")).join(""); }
const PRI: Record<string, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };

export function makeHandler(d: Deps) {
  const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...d.cors, "Content-Type": "application/json" } });
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: d.cors });
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return reply(401, { ok: false, error: "Sign in first." });
    let body: any = {};
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
    if (!body || typeof body !== "object") return reply(400, { ok: false, error: "Bad request" });
    let mfa = false;
    try { mfa = (await d.mfaOk(jwt)) === true; } catch { mfa = false; }
    if (!mfa) return reply(403, { ok: false, reason: "mfa", error: "Finish the two-step sign-in first." });
    const { t, error } = await d.ticket(jwt, String(body.ticket || ""));
    // L3: the database's own words are not passed on (publicError logs them under a number)
    if (error || !t) return reply(403, { ok: false, error: error ? publicError("support-mail", new Error(error)) : "Not your ticket." });
    if (!d.key || !d.to) return reply(200, { ok: true, sent: false, reason: "Email is not set up yet (RESEND_API_KEY, SUPPORT_MAIL_TO)." });

    const thread: any[] = t.thread || [];
    const last = [...thread].reverse().find((m) => !m.internal);
    if (!last || thread[thread.length - 1]?.internal) return reply(200, { ok: true, sent: false, reason: "internal note" });
    const toSupport = !last.from_support;
    const to = toSupport ? d.to.split(",").map((s: string) => s.trim()).filter(Boolean) : [t.created_email].filter(Boolean);
    if (!to.length) return reply(200, { ok: true, sent: false, reason: "no address" });
    // L9: this message, once; this ticket, a few a day
    const tid = String(t.id || body.ticket || "");
    const msgKey = await sha256hex("support-mail:" + tid + ":" + thread.length + ":" + String(last.id ?? last.at ?? ""));
    try {
      if ((await d.count("support-mail", msgKey, TWO_DAYS)) > 0) return reply(200, { ok: true, sent: false, reason: "already sent" });
      if (!(await d.hit("support-ticket", await sha256hex("support-ticket:" + tid), TICKET_DAY_MAX, 86400))) return reply(200, { ok: true, sent: false, reason: "this ticket's emails for today are used up" });
    } catch { return reply(200, { ok: true, sent: false, reason: "Email could not be sent just now." }); }
    const isNew = body.event === "new" && thread.length === 1;
    const files = (last.files || []).map((f: any) => f.name).join(", ");
    const subject = (isNew ? "New ticket " : toSupport ? "Reply on " : "Support replied: ") + t.code + " · " + t.subject;
    const text = [
      isNew ? "A new ticket was raised in TDS Desk." : toSupport ? "The firm replied on a ticket." : "TDS Desk support replied to your ticket.",
      "",
      "Ticket: " + t.code + " · " + t.subject,
      "Firm: " + (t.firm_name || "") + "   Raised by: " + (t.created_name || t.created_email || ""),
      "Module: " + t.module + "   Priority: " + (PRI[t.priority] || t.priority) + "   Status: " + t.status,
      "",
      (last.author_name ? last.author_name + " wrote:" : "Message:"),
      String(last.body || "").slice(0, 4000),
      files ? "\nFiles: " + files : "",
      "",
      "Open it in TDS Desk → Help: " + d.app,
    ].join("\n");
    const r = await d.send({ from: d.from, to, subject, text, ...(toSupport && t.created_email ? { reply_to: t.created_email } : {}) });
    if (!r.ok) return reply(200, { ok: false, sent: false, error: publicError("support-mail", new Error("the email service answered HTTP " + r.status + ": " + (r.message || ""))) });
    await d.add("support-mail", msgKey).catch(() => {});
    return reply(200, { ok: true, sent: true, to: toSupport ? "support" : "raiser" });
  };
}
