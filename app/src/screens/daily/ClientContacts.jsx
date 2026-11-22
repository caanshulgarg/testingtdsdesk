// A client's contacts (next-assistant, phase 1), in Client setup › Company: who gets Daily Check's questions. FinCom had
// no contact for a client itself (Letters and the ITC follow-up keep a supplier's or customer's email and phone, per party;
// those stay as they are). Several contacts a client, each with a name, an email, a WhatsApp number and how questions go
// to each. Kept in the cloud (client_contacts, migration 206: owners and staff change them, every change logged), so the
// send function reads the addresses itself. "Remind by itself": the owner only (prefs_set), off by default.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cloudOn, isOwner, canWrite, loadContacts, saveContacts, loadPrefs, setPrefs } from "./data.js";
import "./daily.css";
/* global toast */

const say = (m) => { try { toast(m); } catch (e) { /* no toast here */ } };
const blank = () => ({ id: "new-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: "", role: "", email: "", whatsapp: "", by_email: true, by_whatsapp: true });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneOk = (s) => !s || (/^\+?[0-9 ]{0,20}$/.test(s) && String(s).replace(/\D/g, "").length >= 10);

export default function ClientContacts({ co }) {
  const cid = co && co.id, [before, setBefore] = useState(null), [rows, setRows] = useState([]), [auto, setAuto] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const load = () => Promise.all([loadContacts(cid), loadPrefs(cid).catch(() => false)]).then(([cs, a]) => { setBefore(cs || []); setRows((cs || []).map((c) => ({ ...c }))); setAuto(a); setErr(""); }, (e) => setErr(String((e && e.message) || e)));
  useEffect(() => { if (cid && cloudOn()) load(); }, [cid]);
  if (!cloudOn()) return <p className="note" data-client-contacts="" data-contacts-off="">Contacts are kept in the firm account. Sign in to add them.</p>;
  if (err) return <p className="note" data-client-contacts="">Could not load the contacts. <button type="button" className="linkbtn" onClick={load}>Try again</button></p>;
  if (before === null) return <p className="note" data-client-contacts="">Loading…</p>;
  const w = canWrite(), set = (id, k, v) => setRows(rows.map((r) => r.id === id ? { ...r, [k]: v } : r));
  const bad = rows.some((r) => r.name.trim() && ((r.email && !EMAIL.test(r.email.trim())) || !phoneOk(r.whatsapp.trim())));
  const changed = JSON.stringify(rows.filter((r) => r.name.trim())) !== JSON.stringify(before);
  const save = () => { setBusy(true); saveContacts(cid, before, rows).then(() => { say("Contacts saved."); return load(); }, (e) => say(String((e && e.message) || e))).finally(() => setBusy(false)); };
  return <div className="as-contacts" data-client-contacts="">
    {!rows.length && <p className="note as-none" data-contacts-empty="">No contacts yet.</p>}
    {rows.length > 0 && <div className="as-ct-wrap"><table className="as-ct">
      <thead><tr><th>Name</th><th>Role</th><th>Email</th><th>WhatsApp</th><th>Send by</th><th><span className="sr-only">Remove</span></th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} data-contact={r.id}>
        <td data-label="Name"><input value={r.name} aria-label="Name" placeholder="Name" disabled={!w} onChange={(e) => set(r.id, "name", e.target.value)} /></td>
        <td data-label="Role"><input value={r.role} aria-label="Role" placeholder="Accounts" disabled={!w} onChange={(e) => set(r.id, "role", e.target.value)} /></td>
        <td data-label="Email"><input type="email" value={r.email} aria-label="Email" placeholder="name@company" disabled={!w} aria-invalid={r.email && !EMAIL.test(r.email.trim()) ? "true" : undefined} onChange={(e) => set(r.id, "email", e.target.value)} /></td>
        <td data-label="WhatsApp"><input type="tel" value={r.whatsapp} aria-label="WhatsApp number" placeholder="+91 …" disabled={!w} aria-invalid={!phoneOk(r.whatsapp.trim()) ? "true" : undefined} onChange={(e) => set(r.id, "whatsapp", e.target.value)} /></td>
        <td data-label="Send by" className="as-ct-by">
          <label className="chk"><input type="checkbox" checked={r.by_email} disabled={!w || !r.email} onChange={() => set(r.id, "by_email", !r.by_email)} /> Email</label>
          <label className="chk"><input type="checkbox" checked={r.by_whatsapp} disabled={!w || !r.whatsapp} onChange={() => set(r.id, "by_whatsapp", !r.by_whatsapp)} /> WhatsApp</label></td>
        <td>{w && <button type="button" className="btn small" aria-label={"Remove " + (r.name || "contact")} onClick={() => setRows(rows.filter((x) => x.id !== r.id))}><Trash2 width={14} height={14} aria-hidden="true" /></button>}</td>
      </tr>)}</tbody></table></div>}
    {w && <div className="row" style={{ gap: 8, marginTop: 10 }}>
      <button type="button" className="btn small" data-contact-add="" onClick={() => setRows([...rows, blank()])}><Plus width={14} height={14} aria-hidden="true" />Add contact</button>
      {changed && <button type="button" className="btn small primary" data-contact-save="" disabled={busy || bad} onClick={save}>Save</button>}</div>}
    <label className="chk as-auto" style={{ marginTop: 14 }} title="Off: you approve every message. On: a document already asked for once is asked again, at most weekly.">
      <input type="checkbox" role="switch" checked={auto} disabled={!isOwner() || busy} onChange={() => { const v = !auto; setBusy(true); setPrefs(cid, v).then(() => setAuto(v), (e) => say(String((e && e.message) || e))).finally(() => setBusy(false)); }} /> Remind by itself</label>
  </div>;
}
