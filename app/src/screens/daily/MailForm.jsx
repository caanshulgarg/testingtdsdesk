// Sending (Daily Check's emails and WhatsApp to clients): the firm's real sending switch and its test email and WhatsApp.
// One form, drawn in two places: Daily Check › Send › Settings, and (the new look) Settings › Email and messages. The
// same call either way (assistant_mail_set); test mode = real sending off, the default, and the server's guard decides.
import { useState } from "react";
import { setMail } from "./data.js";
/* global toast */

const say = (m) => { try { toast(m); } catch (e) { /* no toast here */ } };
export default function MailForm({ mail, done }) {
  const [real, setReal] = useState(!!mail.real_send), [to, setTo] = useState(mail.test_to || ""), [wa, setWa] = useState(mail.test_whatsapp || ""), [busy, setBusy] = useState(false);
  return <>
    <label className="f"><span>Firm email for tests</span><input type="email" data-mail-to="" value={to} onChange={(e) => setTo(e.target.value)} placeholder="office@yourfirm" /></label>
    <label className="f"><span>Firm WhatsApp for tests</span><input type="tel" data-mail-wa="" value={wa} onChange={(e) => setWa(e.target.value)} placeholder="+91 …" /></label>
    <label className="chk"><input type="checkbox" data-mail-real="" checked={real} onChange={() => setReal(!real)} /> Send to clients for real</label>
    <div><button type="button" className="btn small" data-mail-save="" disabled={busy} onClick={() => { setBusy(true); setMail(real, to, wa).then(() => { say("Saved."); done({ real_send: real, test_to: to, test_whatsapp: wa }); }, (e) => say(String(e.message || e))).finally(() => setBusy(false)); }}>Save</button></div>
  </>;
}
