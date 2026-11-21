// A client's contacts (next-assistant, phase 1 design), in Client setup › Company, under "The client". FinCom had no
// contact for a client itself (Letters and the ITC follow-up keep a supplier's or customer's email and phone, per party;
// those stay as they are). Several contacts a client, each with a name: an email, a WhatsApp number, and whether the
// weekly questions go to them by each. Phase 1 keeps them in the cloud (client_contacts, docs/ASSISTANT-PHASE1.md), so the
// send function reads the addresses itself. This round: kept on the page only (made-up data), not saved.
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import "./assistant.css";

const blank = () => ({ id: "n" + Date.now().toString(36), name: "", role: "", email: "", wa: "", byEmail: true, byWa: true });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneOk = (s) => !s || String(s).replace(/\D/g, "").length >= 10;

export default function ClientContacts({ co }) {
  const [rows, setRows] = useState(() => (co && co.contacts) || []);
  const [auto, setAuto] = useState(!!(co && co.askAuto));
  const set = (id, k, v) => setRows(rows.map((r) => r.id === id ? { ...r, [k]: v } : r));
  return <div className="as-contacts" data-client-contacts="">
    <p className="note" style={{ margin: "0 0 10px" }}>Who gets the weekly questions from the Assistant. Add as many as you need.</p>
    {!rows.length && <p className="note as-none" data-contacts-empty="">No contacts yet. Questions for this client wait until one is added.</p>}
    {rows.length > 0 && <div className="as-ct-wrap"><table className="as-ct">
      <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>WhatsApp</th><th>Send questions by</th><th><span className="sr-only">Remove</span></th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} data-contact={r.id}>
        <td data-label="Name"><input value={r.name} aria-label="Name" placeholder="Name" onChange={(e) => set(r.id, "name", e.target.value)} /></td>
        <td data-label="Role"><input value={r.role} aria-label="Role" placeholder="Accounts" onChange={(e) => set(r.id, "role", e.target.value)} /></td>
        <td data-label="Email"><input type="email" value={r.email} aria-label="Email" placeholder="name@company" aria-invalid={r.email && !EMAIL.test(r.email) ? "true" : undefined} onChange={(e) => set(r.id, "email", e.target.value)} /></td>
        <td data-label="WhatsApp"><input type="tel" value={r.wa} aria-label="WhatsApp number" placeholder="+91 …" aria-invalid={!phoneOk(r.wa) ? "true" : undefined} onChange={(e) => set(r.id, "wa", e.target.value)} /></td>
        <td data-label="Send by" className="as-ct-by">
          <label className="chk"><input type="checkbox" checked={r.byEmail} disabled={!r.email} onChange={() => set(r.id, "byEmail", !r.byEmail)} /> Email</label>
          <label className="chk"><input type="checkbox" checked={r.byWa} disabled={!r.wa} onChange={() => set(r.id, "byWa", !r.byWa)} /> WhatsApp</label></td>
        <td><button type="button" className="btn small" aria-label={"Remove " + (r.name || "contact")} onClick={() => setRows(rows.filter((x) => x.id !== r.id))}><Trash2 width={14} height={14} aria-hidden="true" /></button></td>
      </tr>)}</tbody></table></div>}
    <div className="row" style={{ gap: 8, marginTop: 10 }}><button type="button" className="btn small" data-contact-add="" onClick={() => setRows([...rows, blank()])}><Plus width={14} height={14} aria-hidden="true" />Add contact</button></div>
    <label className="chk as-auto" style={{ marginTop: 14 }}><input type="checkbox" role="switch" checked={auto} onChange={() => setAuto(!auto)} /> Send missing-document reminders by itself
      <span className="note"> Off: you approve every message first.</span></label>
  </div>;
}
