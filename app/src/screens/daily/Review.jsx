// Send (next-assistant, phase 1 design): tick, edit, see the message exactly as it goes (server/_shared/asks.js, the
// same words the send function writes), send. Email from the server through Resend to the client's contacts as kept in
// the cloud; WhatsApp as a wa.me link the owner sends. Test mode (the default) sends every email to the firm only: the
// guard is on the server, this page only shows it. Only the firm's owner sends in phase 1. Made-up data this round.
import { useMemo, useState } from "react";
import { ArrowLeft, Mail, MessageCircle } from "lucide-react";
import { sendable, message, waLink } from "../../../../server/_shared/asks.js";

export default function Review({ client, findings, firm, week, back }) {
  const all = useMemo(() => sendable(findings, null), [findings]);
  const [picked, setPicked] = useState(() => new Set(all.map((f) => f.ask.id)));
  const [edits, setEdits] = useState({});
  const test = true;
  const qs = sendable(findings, picked).map((f) => edits[f.ask.id] != null ? { ...f, ask: { ...f.ask, edited: edits[f.ask.id] } } : f);
  const m = message(client, qs, { firm: firm.name, week, test });
  const mails = client.contacts.filter((k) => k.byEmail && k.email), was = client.contacts.filter((k) => k.byWa && k.wa);
  const flip = (id) => { const t = new Set(picked); t.has(id) ? t.delete(id) : t.add(id); setPicked(t); };
  return <section className="dc dc-send" data-send={client.id}>
    <button type="button" className="linkbtn dc-back" onClick={back}><ArrowLeft width={15} height={15} aria-hidden="true" /> Daily Check</button>
    <h2 className="dc-h">{client.name}</h2>
    {test && <p className="dc-test" role="status" data-test-mode="">Test mode: emails go to your firm only</p>}
    <div className="dc-send-grid">
      <ol className="dc-pick">{all.map((f) => { const id = f.ask.id, on = picked.has(id); return <li key={id} data-pick={id} className={on ? "" : "off"}>
        <input type="checkbox" checked={on} onChange={() => flip(id)} aria-label={"Ask: " + f.short} />
        <textarea rows={2} aria-label="Question" disabled={!on} value={edits[id] != null ? edits[id] : f.ask.text} onChange={(ev) => setEdits({ ...edits, [id]: ev.target.value })} />
      </li>; })}</ol>
      <div className="dc-preview">
        <div className="dc-to">To {test ? firm.email : mails.map((k) => k.email).join(", ")}</div>
        <pre className="dc-msg" data-msg="">{m.text || "Nothing ticked."}</pre>
        <div className="dc-send-acts">
          <button type="button" className="btn primary" disabled={!qs.length || !mails.length}><Mail width={15} height={15} aria-hidden="true" />Send email</button>
          {was.map((k) => <a key={k.id} className="btn" role="button" href={qs.length ? waLink(test ? firm.wa : k.wa, m.wa) : undefined} target="_blank" rel="noopener noreferrer">
            <MessageCircle width={15} height={15} aria-hidden="true" />WhatsApp</a>)}
        </div>
      </div>
    </div>
  </section>;
}
