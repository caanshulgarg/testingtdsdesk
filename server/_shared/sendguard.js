// The test-mode guard for Daily Check's emails (next-assistant, phase 1; docs/ASSISTANT-PHASE1.md "Safe sending"). Plain
// JavaScript: the assistant-send function (Deno) uses it, tests/run_assistant_guard.mjs proves it (Node).
//
// Three layers; a real client address is reached ONLY when all of them say so:
//   1. the firm's switch       assistant_mail.real_send, false by default, changed only by the firm's owner (logged)
//   2. the server's switch     the function secret ASSISTANT_MAIL_LIVE must be exactly "yes" (it is not set on staging)
//   3. test mode otherwise     every email goes ONLY to the firm's own address (assistant_mail.test_to, else the signed-in
//                              owner's email), the subject starts with [TEST], the body says so and names the addresses
//                              it would have gone to. No cc, no bcc, ever.
// The addresses are always the client's contacts as kept in the cloud (client_contacts), never typed into the request.
//   plan({contacts, realSend, live, testTo, ownerEmail})  -> {test, to, meant} or {refused}
//   mail({from, replyTo, plan, subject, text})           -> the body for api.resend.com/emails
//   waTarget({contacts, realSend, live, firmWa})          -> {test, phones}: WhatsApp in test mode opens to the firm's number

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
const clean = (s) => String(s || "").trim().toLowerCase();
export const isLive = (realSend, live) => realSend === true && live === "yes";

export function plan(o) {
  const meant = Array.from(new Set((o.contacts || []).map((c) => clean(c.email)).filter((e) => EMAIL.test(e))));
  const test = !isLive(o.realSend, o.live);
  if (!test) return meant.length ? { test: false, to: meant, meant } : { refused: "This client has no email address. Add one in Client setup." };
  const own = clean(o.testTo) || clean(o.ownerEmail);
  if (!EMAIL.test(own)) return { refused: "Test mode needs the firm's own email address." };
  return { test: true, to: [own], meant };
}

export function mail(o) {
  const p = o.plan;
  if (!p || p.refused || !Array.isArray(p.to) || !p.to.length) throw new Error("nothing to send");
  const subject = (p.test ? "[TEST] " : "") + String(o.subject || "").replace(/^\[TEST\]\s*/i, "");
  const head = p.test ? "[TEST: not sent to the client. In real sending it would go to: " + (p.meant.join(", ") || "no address yet") + "]\n\n" : "";
  const text = head + String(o.text || "").replace(/^\[TEST[^\]]*\]\s*/i, "");
  // only these keys: never cc or bcc, and "to" is the plan's own list
  const body = { from: String(o.from || ""), to: p.to.slice(), subject, text };
  if (EMAIL.test(clean(o.replyTo))) body.reply_to = clean(o.replyTo);
  return body;
}

export function waTarget(o) {
  const test = !isLive(o.realSend, o.live);
  const phones = test ? [String(o.firmWa || "").replace(/\D/g, "")].filter((x) => x.length >= 10)
    : Array.from(new Set((o.contacts || []).map((c) => String(c.whatsapp || "").replace(/\D/g, "")).filter((x) => x.length >= 10)));
  return { test, phones };
}
