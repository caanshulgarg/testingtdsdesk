// TDS Desk help desk emails: after a ticket is raised or answered, the app calls this with the ticket's id.
// It reads the ticket as the caller (so only someone who can see it can trigger mail about it) and emails:
//   a new ticket, or the firm's reply  -> TDS Desk support (SUPPORT_MAIL_TO)
//   support's reply                    -> the person who raised the ticket
//   an internal note                   -> nobody
// Mail goes through Resend. Secrets: RESEND_API_KEY, SUPPORT_MAIL_TO, SUPPORT_MAIL_FROM (a sender on a domain
// verified in Resend), APP_URL. Until RESEND_API_KEY and SUPPORT_MAIL_TO are set it answers {sent:false} and
// the ticket itself is unaffected.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const KEY = Deno.env.get("RESEND_API_KEY") || "";
const TO = Deno.env.get("SUPPORT_MAIL_TO") || "";
const FROM = Deno.env.get("SUPPORT_MAIL_FROM") || "TDS Desk Support <onboarding@resend.dev>";
const APP = Deno.env.get("APP_URL") || "https://caanshulgarg.github.io/testingtdsdesk/";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
const PRI: Record<string, string> = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { ok: false, error: "Sign in first." });
  let body: any = {};
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const { data: t, error } = await asUser.rpc("support_get", { p_ticket: String(body.ticket || "") });
  if (error || !t) return reply(403, { ok: false, error: (error && error.message) || "Not your ticket." });
  if (!KEY || !TO) return reply(200, { ok: true, sent: false, reason: "Email is not set up yet (RESEND_API_KEY, SUPPORT_MAIL_TO)." });

  const thread: any[] = t.thread || [];
  const last = [...thread].reverse().find((m) => !m.internal);
  if (!last || thread[thread.length - 1]?.internal) return reply(200, { ok: true, sent: false, reason: "internal note" });
  const toSupport = !last.from_support;
  const to = toSupport ? TO.split(",").map((s: string) => s.trim()).filter(Boolean) : [t.created_email].filter(Boolean);
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
    "Open it in TDS Desk → Help: " + APP,
  ].join("\n");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, text, ...(toSupport && t.created_email ? { reply_to: t.created_email } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return reply(200, { ok: false, sent: false, error: j.message || ("Resend answered HTTP " + r.status) });
  return reply(200, { ok: true, sent: true, to: toSupport ? "support" : "raiser" });
});
