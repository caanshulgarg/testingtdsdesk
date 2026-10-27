import { useEffect, useRef, useState } from "react";
import { call } from "../lib/api.js";

export function Chip({ tone = "neutral", children, testid }) {
  return <span className={"chip chip-" + tone} data-testid={testid}>{children}</span>;
}
// the status chips used on every detail page
export const statusTone = (s) => ({ active: "good", suspended: "warn", closed: "bad", deactivated: "bad" }[s] || "neutral");
export function StatusChip({ status }) {
  const words = { active: "Active", suspended: "Suspended", closed: "Closed", deactivated: "Deactivated" };
  return <Chip tone={statusTone(status)} testid="status-chip">{words[status] || status || "–"}</Chip>;
}
export function Loading({ what = "" }) { return <p className="muted" role="status">Reading{what ? " " + what : ""}…</p>; }
export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return <div className="note note-bad" role="alert">{error}{onRetry && <> <button className="link" onClick={onRetry}>Try again</button></>}</div>;
}
export function Page({ title, sub, actions, children }) {
  return (
    <section className="page">
      <header className="page-head">
        <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
export function Facts({ items }) {
  return <dl className="facts">{items.filter(Boolean).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

// A write that needs a reason: a button that opens a small dialog with a required reason box. The button is shown only
// when the admin's role allows the action (`me.actions`); the server checks again whatever the screen shows.
export function ReasonButton({ me, action, params, label, tone = "", title, confirm, onDone, extra }) {
  const [open, setOpen] = useState(false);
  if (!me?.actions?.includes(action)) return null;
  return (
    <>
      <button className={"btn " + tone} data-action={action} onClick={() => setOpen(true)}>{label}</button>
      {open && <ReasonDialog title={title || label} confirm={confirm || label} action={action} params={params} extra={extra}
                             onClose={() => setOpen(false)} onDone={(d) => { setOpen(false); onDone && onDone(d); }} tone={tone} />}
    </>
  );
}
export function ReasonDialog({ title, confirm, action, params, onClose, onDone, tone, extra }) {
  const [reason, setReason] = useState("");
  const [more, setMore] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef(null);
  useEffect(() => { ref.current?.showModal?.(); }, []);
  const ok = reason.trim().length >= 5;
  const submit = async (e) => {
    e.preventDefault();
    if (!ok) { setErr("Give a reason (at least 5 characters)."); return; }
    setBusy(true); setErr("");
    try { onDone(await call(action, { ...params, ...more, reason: reason.trim() })); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose} aria-labelledby="dlg-title">
      <form onSubmit={submit} method="dialog">
        <h2 id="dlg-title">{title}</h2>
        {extra && extra(more, setMore)}
        <label className="field">
          <span>Reason (kept in the change history)</span>
          <textarea name="reason" rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} placeholder="For example: ticket #123, the owner asked by phone" required minLength={5} />
        </label>
        {err && <div className="note note-bad" role="alert">{err}</div>}
        <div className="row-end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className={"btn " + (tone || "primary")} disabled={busy || !ok} data-testid="reason-confirm">{busy ? "Working…" : confirm}</button>
        </div>
      </form>
    </dialog>
  );
}
