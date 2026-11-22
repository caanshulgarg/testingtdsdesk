// The client's weekly message (next-assistant, phase 1 design, 21-Nov-2026). One plain-JavaScript file, so the browser
// (the Assistant page's preview) and the send function (assistant-send, phase 1 build) write exactly the same words.
//
// The message is built ONLY from questions still waiting on the client: a finding resolved by FinCom, one that needs the
// firm ("Needs you"), a closed or answered question and a question not ticked are never in it (docs/ASSISTANT-PHASE1.md,
// acceptance rule 6; tests/run_assistant_message.mjs proves it). No list of what was resolved, no figures beyond each
// question's own words.
//
//   sendable(findings, picked)   the questions that may go: state "ask", question Draft or Asked, ticked (picked: a Set
//                                of question ids, or null for every one)
//   message(client, qs, o)       {subject, text, wa}: a short greeting, the questions numbered, one line on how to reply;
//                                o.firm the firm's name, o.week the week's date, o.test true adds the test line on top
//   waLink(phone, text)          a wa.me link with the message ready (no WhatsApp Business API: the person sends it)

export function sendable(findings, picked) {
  return (findings || []).filter((f) => f && f.state === "ask" && f.ask && (f.ask.state === "draft" || f.ask.state === "asked")
    && (!picked || picked.has(f.ask.id)));
}

export function message(client, qs, o = {}) {
  // names come from records people typed: no line breaks or control characters in them (the subject is a mail header)
  const one = (v) => String(v || "").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
  const firm = one(o.firm) || "your accountant";
  client = Object.assign({}, client, { name: one(client && client.name) });
  const lines = qs.map((f, i) => (i + 1) + ". " + String((f.ask && (f.ask.edited || f.ask.text)) || "").trim());
  const subject = "A few questions for " + client.name + (o.week ? ", week of " + one(o.week) : "");
  const head = (o.test ? "[TEST: not sent to the client]\n\n" : "") + "Hello,\n\nWe need a few things to finish your books:\n\n";
  const foot = "\n\nYou can reply to this message, or send the documents to us the usual way.\n\nThank you,\n" + firm;
  const text = qs.length ? head + lines.join("\n") + foot : "";
  return { subject, text, wa: text };
}

export function waLink(phone, text) {
  const ph = String(phone || "").replace(/\D/g, "");
  if (!ph) return "";
  return "https://wa.me/" + (ph.length === 10 ? "91" + ph : ph) + "?text=" + encodeURIComponent(String(text || "").slice(0, 1500));
}
