// Review and send (next-assistant, phase 1 design): the owner ticks the questions, edits any, sees the message exactly
// as it will go (server/_shared/asks.js: the same words the send function writes), and sends all with one press.
//   Email      from the server (assistant-send, through Resend as server/support-mail does), to the client's contacts
//              as kept in the cloud (client_contacts), never to an address typed into the request.
//   WhatsApp   a wa.me link with the message ready: the person's own WhatsApp opens, and the person presses send there.
//   Test mode  on until the owner turns real sending on: every email goes ONLY to the firm's own address, marked TEST
//              (the guard is on the server; this page only shows it). docs/ASSISTANT-PHASE1.md, "Safe sending".
// Made-up data in this round: the buttons do nothing.
import { useMemo, useState } from "react";
import { ArrowLeft, Mail, MessageCircle, ShieldCheck } from "lucide-react";
import { sendable, message, waLink } from "../../../../server/_shared/asks.js";
import { STATE_WORD, STATE_TAG } from "./demo.js";

export default function Review({ client, findings, firm, week, back }) {
  const all = useMemo(() => sendable(findings, null), [findings]);
  const [picked, setPicked] = useState(() => new Set(all.map((f) => f.ask.id)));
  const [edits, setEdits] = useState({});
  const [auto, setAuto] = useState(!!client.auto);
  const test = true;   // the firm's real sending is off (the default); the server decides, this only shows it
  const qs = sendable(findings, picked).map((f) => edits[f.ask.id] != null ? { ...f, ask: { ...f.ask, edited: edits[f.ask.id] } } : f);
  const m = message(client, qs, { firm: firm.name, week, test });
  const mails = client.contacts.filter((k) => k.byEmail && k.email), was = client.contacts.filter((k) => k.byWa && k.wa);
  const flip = (id) => { const t = new Set(picked); t.has(id) ? t.delete(id) : t.add(id); setPicked(t); };
  return <section className="as-page as-review" data-as-review={client.id}>
    <button type="button" className="linkbtn as-back" onClick={back}><ArrowLeft width={15} height={15} aria-hidden="true" /> Assistant</button>
    <h2>{"Questions for " + client.name}</h2>
    <p className="note">{"Week of " + week + ". Tick what to ask, change the words if you like, then send."}</p>
    {test && <div className="as-test" role="status" data-test-mode=""><ShieldCheck width={18} height={18} aria-hidden="true" />
      <div><b>Test mode.</b> Email goes only to the firm’s own address, <b>{firm.email}</b>, marked TEST. The client gets nothing.
        <div className="note">Only the firm’s owner can turn real sending on, in Settings › Assistant.</div></div></div>}
    <div className="as-review-grid">
      <div className="dash-card as-review-qs">
        <h3>{"Questions (" + qs.length + " of " + all.length + " ticked)"}</h3>
        <ol className="as-pick">{all.map((f, i) => { const id = f.ask.id, on = picked.has(id); return <li key={id} data-pick={id} className={on ? "" : "off"}>
          <label className="chk as-pick-t"><input type="checkbox" checked={on} onChange={() => flip(id)} /> <span>{i + 1}</span> <span className={"tag " + STATE_TAG[f.ask.state]}>{f.ask.state === "asked" ? "Asked before" : STATE_WORD[f.ask.state]}</span></label>
          <textarea rows={2} aria-label={"Question " + (i + 1)} disabled={!on} value={edits[id] != null ? edits[id] : f.ask.text} onChange={(ev) => setEdits({ ...edits, [id]: ev.target.value })} />
        </li>; })}</ol>
        <label className="chk as-auto"><input type="checkbox" role="switch" checked={auto} onChange={() => setAuto(!auto)} /> Send missing-document reminders by itself <span className="note">(off: you send every time)</span></label>
      </div>
      <div className="dash-card as-preview">
        <h3>What the client gets</h3>
        <div className="as-to"><span className="note">To</span> {test ? <span className="as-chip test">{firm.email} (test)</span> : mails.map((k) => <span key={k.id} className="as-chip">{k.name + " · " + k.email}</span>)}
          {test && mails.length > 0 && <div className="note">{"In real sending: " + mails.map((k) => k.email).join(", ")}</div>}</div>
        <div className="as-subj"><span className="note">Subject</span> {m.subject}</div>
        <pre className="as-msg" data-msg="">{m.text || "Nothing ticked."}</pre>
        <div className="as-send">
          <button type="button" className="btn primary" disabled={!qs.length || !mails.length}><Mail width={15} height={15} aria-hidden="true" />{test ? "Send test email" : "Send email (" + mails.length + ")"}</button>
          {was.map((k) => <a key={k.id} className="btn" role="button" aria-disabled={!qs.length} href={qs.length ? waLink(test ? firm.wa : k.wa, m.wa) : undefined} target="_blank" rel="noopener noreferrer">
            <MessageCircle width={15} height={15} aria-hidden="true" />{"WhatsApp " + (test ? "(to the firm)" : k.name)}</a>)}
        </div>
        <p className="note">WhatsApp opens on your phone or computer with the message ready; you press send there. Each question is marked Asked when sent.</p>
      </div>
    </div>
  </section>;
}
