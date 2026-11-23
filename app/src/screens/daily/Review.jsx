// Send (next-assistant, phase 1): the firm's owner ticks a client's questions, edits any, sees the message exactly as it
// goes (server/_shared/asks.js, the words the send function writes) and sends. Email from the server (assistant-send:
// the test-mode guard is there); WhatsApp as a wa.me link opened here, to the firm's own number in test mode, and never
// to a client from the test site. Test mode = the firm's real sending off (the default).
import { useMemo, useState } from "react";
import { ArrowLeft, Mail, MessageCircle } from "lucide-react";
import { sendable, message, waLink } from "../../../../server/_shared/asks.js";
import { nameOf, isOwner, askEdit, sendEmail, markWhatsApp, testSite } from "./data.js";
import MailForm from "./MailForm.jsx";
import { newLook } from "../../newlook/flag.js";
/* global toast, S, goSettings */

const say = (m) => { try { toast(m); } catch (e) { /* no toast here */ } };
const week = () => { const t = new Date(); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t.getDate() + "-" + t.toLocaleString("en-GB", { month: "short" }) + "-" + t.getFullYear(); };

function Sending({ mail, done }) {
  // the new look (the owner, 23-Nov-2026): sending's settings are in Settings › Email and messages; here, a link there
  if (newLook()) return <p className="note" data-send-settings-moved="">Sending to clients, and the firm’s test email and WhatsApp: <button type="button" className="linkbtn" onClick={() => goSettings("mail")}>Settings › Email and messages</button></p>;
  return <details className="dc-settings" data-send-settings="">
    <summary className="linkbtn">Settings</summary>
    <MailForm mail={mail} done={done} />
  </details>;
}

export default function Review({ cid, data, back }) {
  const findings = useMemo(() => data.findings.filter((f) => f.cid === cid), [data, cid]);
  const all = useMemo(() => sendable(findings, null), [findings]);
  const [picked, setPicked] = useState(() => new Set(all.map((f) => f.ask.id)));
  const [edits, setEdits] = useState({}), [busy, setBusy] = useState(false), [mail, setMailState] = useState(data.mail || {});
  const contacts = data.contacts[cid] || [], owner = isOwner();
  const test = !mail.real_send, waTest = test || testSite();
  const qs = sendable(findings, picked).map((f) => edits[f.ask.id] != null ? { ...f, ask: { ...f.ask, edited: edits[f.ask.id] } } : f);
  const firm = ((typeof S === "object" && S.firm) || {}).firmName || "";
  const m = message({ name: nameOf(cid) }, qs, { firm, week: week() });
  const mails = contacts.filter((k) => k.by_email && k.email), was = contacts.filter((k) => k.by_whatsapp && k.whatsapp);
  const flip = (id) => { const t = new Set(picked); t.has(id) ? t.delete(id) : t.add(id); setPicked(t); };
  const ids = qs.map((f) => f.ask.id);
  // the words changed here are kept first (ask_edit), so the email is the text on screen
  const keepEdits = async () => { for (const f of qs) if (edits[f.ask.id] != null && edits[f.ask.id].trim() && edits[f.ask.id] !== f.ask.orig) await askEdit(f.ask.id, edits[f.ask.id]); };
  const email = async () => {
    setBusy(true);
    try { await keepEdits(); const r = await sendEmail(cid, ids); say(r && r.ok ? (r.test ? "Test email sent to " + r.to.join(", ") + "." : "Sent to " + r.to.join(", ") + ".") : (r && r.error) || "Not sent."); if (r && r.ok) back(); }
    catch (e) { say(String((e && e.message) || e)); } finally { setBusy(false); }
  };
  const whatsapp = async (k) => {
    const to = waTest ? mail.test_whatsapp : k.whatsapp;
    if (!to) { say(newLook() ? "Add the firm's WhatsApp number for tests in Settings › Email and messages." : "Add the firm's WhatsApp number for tests in Settings below."); return; }
    try { await keepEdits(); } catch (e) { say(String(e.message || e)); return; }
    window.open(waLink(to, (waTest ? "[TEST]\n" : "") + m.wa), "_blank", "noopener");
    markWhatsApp(cid, ids, to).catch(() => null);
  };
  return <section className="dc dc-send" data-send={cid}>
    <button type="button" className="linkbtn dc-back" onClick={back}><ArrowLeft width={15} height={15} aria-hidden="true" /> Daily Check</button>
    <h2 className="dc-h">{nameOf(cid)}</h2>
    {test && <p className="dc-test" role="status" data-test-mode="">Test mode: emails go to your firm only</p>}
    {!owner && <p className="note">Only the firm’s owner sends.</p>}
    <div className="dc-send-grid">
      <ol className="dc-pick">{all.map((f) => { const id = f.ask.id, on = picked.has(id); return <li key={id} data-pick={id} className={on ? "" : "off"}>
        <input type="checkbox" checked={on} onChange={() => flip(id)} aria-label={"Ask: " + (f.short || "")} />
        <textarea rows={2} aria-label="Question" disabled={!on} value={edits[id] != null ? edits[id] : f.ask.text} onChange={(ev) => setEdits({ ...edits, [id]: ev.target.value })} />
      </li>; })}</ol>
      <div className="dc-preview">
        <div className="dc-to">To {test ? (mail.test_to || "your firm") : mails.map((k) => k.email).join(", ") || "no email yet"}</div>
        <pre className="dc-msg" data-msg="">{m.text || "Nothing ticked."}</pre>
        {owner && <div className="dc-send-acts">
          <button type="button" className="btn primary" disabled={busy || !qs.length || (!test && !mails.length)} onClick={email}><Mail width={15} height={15} aria-hidden="true" />Send email</button>
          {(waTest ? [{ id: "firm", name: "firm" }] : was).map((k) => <button key={k.id} type="button" className="btn" disabled={busy || !qs.length} onClick={() => whatsapp(k)}><MessageCircle width={15} height={15} aria-hidden="true" />WhatsApp</button>)}
        </div>}
        {owner && <Sending mail={mail} done={(m2) => setMailState(m2)} />}
      </div>
    </div>
  </section>;
}
