// Settings > Billing: the starting credit a new firm gets at sign-up (the signup function reads it), the low-credit
// warning level new firms start with, the grace days and the paused-after days of the monthly run, and trial days.
// Amounts are kept in paise; the boxes are in rupees. Only an Owner saves (settings.billing.set, audited).
import { useEffect, useState } from "react";
import { ErrorNote, Loading, ReasonButton } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { inrPaise, toPaise } from "./common.jsx";

const rup = (p) => (p === null || p === undefined ? "" : String(p / 100));
export function BillingSettings({ me }) {
  const { loading, data, error, reload } = useAction("settings.billing.get");
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF({ start_credit: rup(data.start_credit), low_credit_warn: rup(data.low_credit_warn), grace_days: String(data.grace_days), paused_after_days: String(data.paused_after_days), trial_days: String(data.trial_days) }); }, [data]);
  if (!f) return <section className="card"><h2>Billing</h2><ErrorNote error={error} onRetry={reload} />{loading && <Loading />}</section>;
  const value = {}, bad = [];
  for (const k of ["start_credit", "low_credit_warn"]) { const p = toPaise(f[k]); if (p === null || Number.isNaN(p) || p < 0) bad.push(k); else if (p !== data[k]) value[k] = p; }
  for (const k of ["grace_days", "paused_after_days", "trial_days"]) { const n = Number(f[k]); if (f[k] === "" || !Number.isInteger(n) || n < 0) bad.push(k); else if (n !== data[k]) value[k] = n; }
  if (!bad.length && Number(f.paused_after_days) <= Number(f.grace_days)) bad.push("paused_after_days");
  const can = me.actions.includes("settings.billing.set");
  const Box = (k, label, hint, mode = "decimal") => (
    <label className="field"><span>{label}</span>
      <input className="input" value={f[k]} inputMode={mode} disabled={!can} aria-invalid={bad.includes(k) || undefined} data-setting={k} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      <span className="small muted">{hint}</span></label>);
  return (
    <section className="card" data-testid="billing-settings"><h2>Billing</h2>
      <div className="form-grid">
        {Box("start_credit", "Starting credit at sign-up (₹)", `Now ${inrPaise(data.start_credit)}. The sign-up function reads it for every new firm.`)}
        {Box("low_credit_warn", "Low-credit warning (₹)", `Now ${inrPaise(data.low_credit_warn)}. New firms start with it; each firm can have its own.`)}
        {Box("grace_days", "Grace days when the fee cannot be paid", "Past due: everything still works, with a warning.", "numeric")}
        {Box("paused_after_days", "Paused after (days from falling past due)", "Must be more than the grace days.", "numeric")}
        {Box("trial_days", "Trial days for a new firm (0: no trial)", "No monthly fee until the trial ends.", "numeric")}
      </div>
      <h3>What happens at each stage</h3>
      <ol className="stages">
        <li><b>Past due</b> (the 1st, credit short of the fee): everything works; the firm is warned. A top-up charges the fee and ends it.</li>
        <li><b>Read-only</b> (after {f.grace_days || "?"} grace days): the firm sees and exports everything but cannot change anything; nothing is charged; no AI or posting.</li>
        <li><b>Paused</b> ({f.paused_after_days || "?"} days after falling past due): as read-only, until credit is added.</li>
        <li><b>Active again</b> as soon as a top-up pays the fee (the nightly run also retries).</li>
      </ol>
      {can && <div className="row-end">
        {bad.length ? <span className="note note-warn small" role="note">Check the boxes marked; paused-after must be more than the grace days.</span>
          : Object.keys(value).length === 0 ? <span className="muted small">No change.</span>
          : <ReasonButton me={me} action="settings.billing.set" params={{ value }} label="Save billing settings" tone="primary" onDone={reload} />}
      </div>}
    </section>
  );
}
