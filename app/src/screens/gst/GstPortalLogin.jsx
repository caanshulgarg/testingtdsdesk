// GST settings, per GSTIN: the client's GST portal login for the browser helper (the owner's request of 17-Oct-2026).
// The password goes straight to the firm's server, which keeps it in Vault (migration 93): it is never kept in this
// browser, never shown again once saved ("saved · change"), and given back only for the one fill when someone allowed
// presses "Log in to GST portal" (each read logged). Only the firm's owner saves, changes or deletes it and picks the
// staff who may use it. Talking to the server is GSTB (src/js/84-gst-browser.js).
import { useEffect, useState } from "react";

const H4 = ({ children }) => <h4 style={{ margin: "14px 0 4px" }}>{children}</h4>;

export default function GstPortalLogin({ gstin, portalUser }) {
  const [u, setU] = useState(null), [p, setP] = useState(""), [edit, setEdit] = useState(false), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false), [staff, setStaff] = useState(null);
  const signed = typeof Cloud === "object" && Cloud.on();
  useEffect(() => { if (signed) GSTB.loadLogins(); });
  if (!gstin) return null;
  if (!signed) return <div data-portal-login={gstin}><H4>GST portal login (for the browser helper)</H4>
    <p className="note">Sign in to the firm account to save the client’s GST portal login. Without it, log in on the portal yourself; the helper works the same.</p></div>;
  const a = GSTB.loginOf(gstin), owner = ((S.account || {}).me || {}).role === "owner";
  const members = ((Cloud.st || {}).members || []).filter((m) => m.role === "staff" && m.active !== false);
  const allowed = staff || (a && a.staff_allowed) || [];
  const run = async (f, done) => { setBusy(true); setMsg(""); try { await f(); setMsg(done); setP(""); setU(null); setEdit(false); setStaff(null); } catch (e) { setMsg((e && e.message) || String(e)); } setBusy(false); render(); };
  const user = u === null ? ((a && a.username) || portalUser || "") : u;
  const save = () => run(() => GSTB.saveLogin(gstin, user.trim(), p, owner ? allowed : null), a ? "Saved." : "Saved. The password is kept on the firm's server, in Vault.");
  const del = () => { if (window.confirm("Delete the GST portal login of " + gstin + "? The password is removed from the firm's server.")) run(() => GSTB.deleteLogin(gstin), "Deleted."); };
  const editing = edit || !a;
  return (
    <div data-portal-login={gstin}>
      <H4>GST portal login (for the browser helper)</H4>
      {a && !edit && <p className="note" data-login-saved="">User id <b>{a.username}</b> · password {a.has_password ? <b>saved</b> : "not saved"}
        {owner && <> · <button className="linkbtn" data-login-change="" onClick={() => { setEdit(true); setU(null); }}>change</button> · <button className="linkbtn" data-login-delete="" disabled={busy} onClick={del}>delete</button></>}</p>}
      {!owner && !a && <p className="note">Only the firm’s owner can save the GST portal login.</p>}
      {owner && editing && <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <input type="text" aria-label="GST portal user id" placeholder="GST portal user id" autoComplete="off" style={{ width: 200 }} value={user} onChange={(e) => setU(e.target.value)} />
        <input type="password" aria-label="GST portal password" placeholder={a ? "new password (blank keeps the saved one)" : "GST portal password"} autoComplete="new-password" style={{ width: 240 }} value={p} onChange={(e) => setP(e.target.value)} />
        <button className="btn small" data-login-save="" disabled={busy || !user.trim() || (!a && !p)} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        {a && <button className="btn small" onClick={() => { setEdit(false); setP(""); setU(null); }}>Cancel</button>}
      </div>}
      {owner && members.length > 0 && <div className="note" style={{ marginTop: 4 }} data-login-staff="">Staff who may use it (the owner always may):{" "}
        {members.map((m) => <label key={m.user_id} style={{ marginRight: 10 }}><input type="checkbox" aria-label={"Allow " + (m.name || m.email)} checked={allowed.includes(m.user_id)} disabled={!a && !editing}
          onChange={(e) => { const next = e.target.checked ? allowed.concat([m.user_id]) : allowed.filter((x) => x !== m.user_id); setStaff(next); if (a && !edit) run(() => GSTB.saveLogin(gstin, a.username, "", next), "Saved."); }} /> {m.name || m.email}</label>)}</div>}
      {msg && <p className="note" data-login-msg="">{msg}</p>}
      <p className="note">Used only when someone allowed presses “Log in to GST portal”: the helper types the user id and password on the portal’s login page and stops; the captcha and the OTP are typed by you. Every use is logged (who, when, GSTIN). The password is never shown again, kept in this browser or sent anywhere else.</p>
    </div>
  );
}
