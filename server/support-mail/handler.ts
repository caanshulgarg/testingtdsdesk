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
}
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
    return reply(200, { ok: true, sent: true, to: toSupport ? "support" : "raiser" });
  };
}
