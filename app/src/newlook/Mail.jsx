// Settings › Email and messages (the new look; the owner, 23-Nov-2026): Daily Check's sending to clients, shown here
// instead of under Daily Check › Send. Only where it is shown changes: the same form (daily/MailForm.jsx), the same row
// (assistant_mail) and the same call (assistant_mail_set); real sending off is test mode, and the server's guard decides.
// Framed as every other Settings section (a .setcard). Someone who may not read the row is told it is not known, never
// "Test mode" (the review of 23-Nov-2026).
import { useEffect, useState } from "react";
import MailForm from "../screens/daily/MailForm.jsx";
import { loadMail, isOwner } from "../screens/daily/data.js";

const DEF = { real_send: false, test_to: "", test_whatsapp: "" };
export default function NLMail() {
  const [mail, setMail] = useState(undefined), [err, setErr] = useState("");
  useEffect(() => { loadMail().then(setMail, (e) => setErr(String((e && e.message) || e))); }, []);
  const owner = isOwner();
  return <section className="setcard" data-nl-mail="">
    <h3>Email and WhatsApp to clients</h3>
    <p className="note">While “Send to clients for real” is off (test mode), emails go to the firm’s test email and WhatsApp opens the firm’s test number, never a client’s.</p>
    {err ? <p className="bk-alert bad">Could not read the setting: {err}</p>
      : mail === undefined ? <div className="nl-skel on" aria-busy="true" style={{ height: 120 }} />
      : owner ? <div className="nl-mail-form" style={{ maxWidth: 420, display: "grid", gap: 8 }}><MailForm mail={mail || DEF} done={setMail} /></div>
      : <p className="note" data-mail-owner-only="">{mail === null ? "Whether emails go to clients for real is not known here." : mail.real_send ? "Sending to clients for real." : "Test mode: emails go to the firm only."} Only the firm’s owner changes this.</p>}
  </section>;
}
