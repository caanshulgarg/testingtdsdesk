// Coupons (console-plan.md 3.6; server: server/console/modules/coupons.ts; migration 120). The list (a filter on every
// column, status and usage included), a coupon with its redemptions, create and edit, pause / resume / end, and the
// report of what was given per coupon and per month. Everyone sees them; Owner and Billing change them (the buttons
// show only for a role that may; the server checks again).
import { useState } from "react";
import { TicketPercent } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, ErrorNote, Facts, Loading, Page, ReasonButton, ReasonDialog } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtDate, fmtInr, fmtTime } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";
import "./coupons.css";

export const KINDS = [
  { value: "percent", label: "% off", about: "A percentage off the plan fee, for some months" },
  { value: "flat", label: "₹ off", about: "A fixed amount off the plan fee, for some months" },
  { value: "credit", label: "Free credit", about: "Added to the firm's credit at once" },
  { value: "free_months", label: "Free months", about: "No plan fee for some months" },
  { value: "trial_days", label: "Longer trial", about: "Days added to the firm's trial" },
];
export const STATUSES = [
  { value: "active", label: "Active" }, { value: "scheduled", label: "Not started" }, { value: "paused", label: "Paused" },
  { value: "used_up", label: "Used up" }, { value: "expired", label: "Expired" }, { value: "ended", label: "Ended" },
];
const USAGE = [{ value: "unused", label: "Not used yet" }, { value: "in_use", label: "In use" }, { value: "full", label: "All uses taken" }];
const TONE = { active: "good", scheduled: "neutral", paused: "warn", used_up: "neutral", expired: "neutral", ended: "bad" };
const label = (list, v) => (list.find((x) => x.value === v) || { label: v || "–" }).label;
export const CouponStatus = ({ s }) => <Chip tone={TONE[s] || "neutral"} testid="coupon-status">{label(STATUSES, s)}</Chip>;

// the terms in words, as the server says them (migration 120 coupon_terms), for the form's preview
const inr = (p) => "₹" + (p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const mo = (n) => n + (Number(n) === 1 ? " month" : " months");
export function terms(kind, value, months, maxOff) {
  if (!value) return "";
  if (kind === "percent") return `${value}% off the plan fee for ${mo(months || "?")}` + (maxOff ? ` (up to ${inr(maxOff)} a month)` : "");
  if (kind === "flat") return `${inr(value)} off the plan fee for ${mo(months || "?")}`;
  if (kind === "credit") return `${inr(value)} of free credit`;
  if (kind === "free_months") return `${value} free ${Number(value) === 1 ? "month" : "months"} of the plan fee`;
  return `${value} more ${Number(value) === 1 ? "day" : "days"} of trial`;
}

const LIST_PRESETS = [
  { label: "Active", filters: { status: { op: "in", values: ["active", "scheduled"] } } },
  { label: "Paused", filters: { status: { op: "in", values: ["paused"] } } },
  { label: "Finished", filters: { status: { op: "in", values: ["ended", "expired", "used_up"] } } },
  { label: "All", filters: {} },
];
const sp = (e) => e.stopPropagation();
function StatusButtons({ me, c, onDone }) {
  const p = { coupon_id: c.id };
  return (
    <span className="row-actions" onClick={sp}>
      {c.set_status === "active" && <ReasonButton me={me} action="coupon.pause" params={p} label="Pause" title={"Pause " + c.code} onDone={onDone} />}
      {c.set_status === "paused" && <ReasonButton me={me} action="coupon.resume" params={p} label="Resume" title={"Resume " + c.code} tone="primary" onDone={onDone} />}
      {c.set_status !== "ended" && <ReasonButton me={me} action="coupon.end" params={p} label="End" tone="danger" title={"End " + c.code + " for good"} confirm="End it" onDone={onDone} />}
    </span>
  );
}

function Coupons({ me }) {
  const [n, setN] = useState(0);
  const cols = [
    { key: "code", label: "Code", type: "text", render: (r) => <span className="code-cell">{r.code}</span> },
    { key: "kind", label: "Kind", type: "select", options: KINDS, phone: false },
    { key: "terms", label: "Terms", type: "text" },
    { key: "status", label: "Status", type: "select", options: STATUSES, render: (r) => <CouponStatus s={r.status} /> },
    { key: "usage", label: "Usage", type: "select", options: USAGE, list: false },
    { key: "uses", label: "Uses", type: "number", align: "end", render: (r) => `${r.uses}${r.max_uses ? " / " + r.max_uses : ""}` },
    { key: "max_uses", label: "Total uses", type: "number", list: false },
    { key: "firms", label: "Firms", type: "number", list: false },
    { key: "given_inr", label: "Given", type: "number", align: "end", render: (r) => fmtInr(r.given_inr) },
    { key: "valid_from", label: "Valid from", type: "date", list: false },
    { key: "valid_to", label: "Valid to", type: "date", phone: false },
    { key: "plans", label: "Plans", type: "text", list: false },
    { key: "once_per_firm", label: "Once per firm", type: "bool", list: false },
    { key: "new_firms_only", label: "New firms only", type: "bool", list: false },
    { key: "stackable", label: "Stacks", type: "bool", list: false },
    { key: "campaign", label: "Campaign", type: "text", list: false },
    { key: "created_at", label: "Created", type: "date", phone: false },
    { key: "do", label: "", type: "text", sortable: false, filter: false, render: (r) => <StatusButtons me={me} c={r} onDone={() => setN(n + 1)} /> },
  ];
  return (
    <Page title="Coupons" sub="Codes firms enter at sign-up or in Settings › Plan. Pausing or ending a code stops new uses; uses already made keep running."
          actions={<>
            <a className="btn ghost" href={href("coupons/report")} data-testid="coupon-report-link">Report</a>
            {me.actions.includes("coupon.create") && <a className="btn primary" href={href("coupons/new")} data-testid="coupon-new">New coupon</a>}
          </>}>
      <DataTable key={n} id="coupons" action="coupons.list" columns={cols} presets={LIST_PRESETS} defaultPreset={3} me={me} exportName="coupons"
                 onRow={(r) => go("coupons/" + r.id)} />
    </Page>
  );
}

const REDEMPTION_COLUMNS = [
  { key: "at", label: "When", type: "date", render: (r) => fmtTime(r.at) },
  { key: "firm", label: "Firm", type: "text" },
  { key: "code", label: "Code", type: "text", list: false },
  { key: "by_email", label: "By", type: "text", phone: false },
  { key: "source", label: "Where", type: "select", options: [{ value: "signup", label: "Sign-up" }, { value: "settings", label: "Settings" }, { value: "console", label: "Console" }] },
  { key: "kind", label: "Kind", type: "select", options: KINDS, list: false },
  { key: "terms", label: "Terms", type: "text", list: false },
  { key: "value_inr", label: "Given so far", type: "number", align: "end", render: (r) => r.kind === "trial_days" ? `${r.days || 0} days` : fmtInr(r.value_inr) },
  { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Running" }, { value: "finished", label: "Finished" }, { value: "reversed", label: "Reversed" }],
    render: (r) => <Chip tone={r.status === "active" ? "good" : "neutral"}>{r.status === "active" ? "Running" : r.status === "finished" ? "Finished" : "Reversed"}</Chip> },
  { key: "months_left", label: "Months left", type: "number", align: "end", phone: false },
];
const REDEMPTION_PRESETS = [
  { label: "Running", filters: { status: { op: "in", values: ["active"] } } },
  { label: "Finished", filters: { status: { op: "in", values: ["finished", "reversed"] } } },
  { label: "All", filters: {} },
];

function Coupon({ me, id }) {
  const { loading, data: c, error, reload } = useAction("coupon.get", { coupon_id: id });
  if (loading && !c) return <Page title="Coupon"><Loading /></Page>;
  if (!c) return <Page title="Coupon"><ErrorNote error={error} onRetry={reload} /></Page>;
  const range = c.valid_from || c.valid_to ? `${c.valid_from ? fmtDate(c.valid_from) : "any time"} to ${c.valid_to ? fmtDate(c.valid_to) : "no end"}` : "Any time";
  return (
    <Page title={<span className="code-cell">{c.code}</span>} sub={<a href={href("coupons")}>← All coupons</a>}
          actions={<>
            {c.set_status !== "ended" && me.actions.includes("coupon.update") && <a className="btn" href={href("coupons/" + id + "/edit")} data-testid="coupon-edit">Edit</a>}
            <StatusButtons me={me} c={c} onDone={reload} />
          </>}>
      <ErrorNote error={error} onRetry={reload} />
      <div className="chips"><CouponStatus s={c.status} /><span className="coupon-terms" data-testid="coupon-terms">{c.terms}</span></div>
      {c.set_status !== "active" && <div className="note" role="note">{c.set_status === "ended" ? `Ended ${fmtTime(c.ended_at)}: no new uses, for good.` : "Paused: no new uses until it is resumed."} Uses already made keep running.</div>}
      <Facts items={[
        ["Kind", label(KINDS, c.kind)], ["Valid", range], ["Plans", c.plans],
        ["Uses", `${c.uses}${c.max_uses ? " of " + c.max_uses : " (no limit)"}`], ["Firms", c.firms], ["Given so far", fmtInr(c.given_inr)],
        ["Once per firm", c.once_per_firm ? "Yes" : "No"], ["New firms only", c.new_firms_only ? `Yes, within ${c.new_firm_days} days of joining` : "No"],
        ["Stacks with others", c.stackable ? "Yes" : "No"], ["Campaign", c.campaign || "–"],
        ["Created", `${fmtDate(c.created_at)}${c.created_by_email ? " by " + c.created_by_email : ""}`],
        ["Changed", `${fmtTime(c.updated_at)}${c.updated_by_email ? " by " + c.updated_by_email : ""}`],
      ]} />
      {c.note && <p className="muted">{c.note}</p>}
      <section className="card">
        <h2>Redemptions</h2>
        <DataTable id="red" action="coupon.redemptions" params={{ coupon_id: id }} columns={REDEMPTION_COLUMNS} presets={REDEMPTION_PRESETS} defaultPreset={2} me={me}
                   exportName={"coupon-" + c.code} onRow={(r) => go("firms/" + r.firm_id)} empty="No firm has used this code yet." />
      </section>
    </Page>
  );
}

// ---- create and edit
function toForm(c) {
  if (!c) return { code: "", kind: "percent", percent: "", amount_inr: "", months: "", days: "", max_off_inr: "", valid_from: "", valid_to: "", plan_ids: [],
                   max_uses: "", once_per_firm: true, new_firms_only: false, new_firm_days: "30", stackable: false, campaign: "", note: "" };
  return {
    code: c.code, kind: c.kind, percent: c.kind === "percent" ? String(c.value) : "", amount_inr: ["flat", "credit"].includes(c.kind) ? String(c.value / 100) : "",
    months: c.kind === "free_months" ? String(c.value) : c.months ? String(c.months) : "", days: c.kind === "trial_days" ? String(c.value) : "",
    max_off_inr: c.max_off_paise ? String(c.max_off_paise / 100) : "", valid_from: c.valid_from || "", valid_to: c.valid_to || "", plan_ids: c.plan_ids || [],
    max_uses: c.max_uses ? String(c.max_uses) : "", once_per_firm: c.once_per_firm, new_firms_only: c.new_firms_only, new_firm_days: String(c.new_firm_days || 30),
    stackable: c.stackable, campaign: c.campaign || "", note: c.note || "",
  };
}
function preview(f) {
  const n = (v) => Number(v) || 0;
  if (f.kind === "percent") return terms("percent", n(f.percent), n(f.months), Math.round(n(f.max_off_inr) * 100) || null);
  if (f.kind === "flat") return terms("flat", Math.round(n(f.amount_inr) * 100), n(f.months));
  if (f.kind === "credit") return terms("credit", Math.round(n(f.amount_inr) * 100));
  if (f.kind === "free_months") return terms("free_months", n(f.months));
  return terms("trial_days", n(f.days));
}
const Field = ({ label: l, hint, children }) => <label className="field"><span>{l}</span>{children}{hint && <small className="muted">{hint}</small>}</label>;

function CouponForm({ me, coupon }) {
  const edit = !!coupon;
  const used = edit && coupon.uses > 0;
  const [f, setF] = useState(() => toForm(coupon));
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState("");
  const plans = useAction("coupon.plans");
  const action = edit ? "coupon.update" : "coupon.create";
  if (!me.actions.includes(action)) return <Page title="Coupons"><p className="muted">Your role ({me.role}) cannot create or change coupons.</p></Page>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const togglePlan = (pid) => setF({ ...f, plan_ids: f.plan_ids.includes(pid) ? f.plan_ids.filter((x) => x !== pid) : [...f.plan_ids, pid] });
  const submit = (e) => {
    e.preventDefault();
    const code = f.code.replace(/\s/g, "").toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(code)) { setErr("The code must be 4 to 20 letters and digits, with no spaces or signs."); return; }
    if (!preview(f)) { setErr("Give the coupon's value."); return; }
    setErr(""); setAsk(true);
  };
  const params = { ...f, code: f.code.replace(/\s/g, "").toUpperCase(), ...(edit ? { coupon_id: coupon.id } : {}) };
  const k = f.kind;
  return (
    <Page title={edit ? "Edit " + coupon.code : "New coupon"} sub={<a href={href(edit ? "coupons/" + coupon.id : "coupons")}>← {edit ? coupon.code : "All coupons"}</a>}>
      <form className="card coupon-form" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="Code" hint={used ? "Used already: the code stays as it is." : "4 to 20 letters and digits. Not case-sensitive."}>
            <input className="input code-input" value={f.code} onChange={set("code")} maxLength={24} disabled={used} autoCapitalize="characters" spellCheck={false} data-testid="f-code" required />
          </Field>
          <Field label="Campaign (for reports)"><input className="input" value={f.campaign} onChange={set("campaign")} maxLength={60} data-testid="f-campaign" /></Field>
        </div>
        <fieldset className="field" disabled={used}>
          <legend className="f-label">What the firm gets</legend>
          <div className="kinds" role="radiogroup">
            {KINDS.map((x) => (
              <label key={x.value} className={"kind" + (k === x.value ? " on" : "")} data-testid={"f-kind-" + x.value}>
                <input type="radio" name="kind" value={x.value} checked={k === x.value} onChange={set("kind")} />
                <b>{x.label}</b><small className="muted">{x.about}</small>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-grid">
          {k === "percent" && <Field label="Percent off"><input className="input" type="number" min="1" max="100" step="1" value={f.percent} onChange={set("percent")} data-testid="f-percent" /></Field>}
          {(k === "flat" || k === "credit") && <Field label={k === "flat" ? "Amount off each month (₹)" : "Credit (₹)"}><input className="input" type="number" min="1" max="100000" step="0.01" value={f.amount_inr} onChange={set("amount_inr")} data-testid="f-amount" /></Field>}
          {(k === "percent" || k === "flat" || k === "free_months") && <Field label={k === "free_months" ? "Free months" : "For how many months"}><input className="input" type="number" min="1" max={k === "free_months" ? 36 : 120} step="1" value={f.months} onChange={set("months")} data-testid="f-months" /></Field>}
          {k === "percent" && <Field label="Most off in a month (₹, optional)"><input className="input" type="number" min="1" step="0.01" value={f.max_off_inr} onChange={set("max_off_inr")} data-testid="f-maxoff" /></Field>}
          {k === "trial_days" && <Field label="Days added to the trial"><input className="input" type="number" min="1" max="365" step="1" value={f.days} onChange={set("days")} data-testid="f-days" /></Field>}
        </div>
        <p className="coupon-preview" data-testid="f-preview">{preview(f) ? <>Firms get: <b>{preview(f)}</b></> : "Fill in the value to see what firms get."}</p>
        <div className="form-grid">
          <Field label="Valid from (India date)"><input className="input" type="date" value={f.valid_from} onChange={set("valid_from")} data-testid="f-from" /></Field>
          <Field label="Valid to (India date, included)"><input className="input" type="date" value={f.valid_to} onChange={set("valid_to")} data-testid="f-to" /></Field>
          <Field label="Total uses (blank: no limit)"><input className="input" type="number" min="1" step="1" value={f.max_uses} onChange={set("max_uses")} data-testid="f-maxuses" /></Field>
        </div>
        <fieldset className="field">
          <legend className="f-label">Plans (none ticked: every plan)</legend>
          <div className="checks">
            {(plans.data || []).map((p) => <label key={p.id} className="check"><input type="checkbox" checked={f.plan_ids.includes(p.id)} onChange={() => togglePlan(p.id)} data-testid={"f-plan-" + p.name} /> {p.name}</label>)}
            {plans.loading && <span className="muted small">Reading the plans…</span>}
          </div>
        </fieldset>
        <div className="rules">
          <label className="check"><input type="checkbox" checked={f.once_per_firm} onChange={set("once_per_firm")} data-testid="f-once" /> Once per firm</label>
          <label className="check"><input type="checkbox" checked={f.stackable} onChange={set("stackable")} data-testid="f-stack" /> Stacks with other coupons</label>
          <label className="check"><input type="checkbox" checked={f.new_firms_only} onChange={set("new_firms_only")} data-testid="f-new" /> New firms only</label>
          {f.new_firms_only && <label className="check">within <input className="input days" type="number" min="1" max="3650" value={f.new_firm_days} onChange={set("new_firm_days")} aria-label="Days since joining" data-testid="f-newdays" /> days of joining</label>}
        </div>
        <Field label="Note (internal)"><textarea rows={2} value={f.note} onChange={set("note")} maxLength={500} data-testid="f-note" /></Field>
        {err && <div className="note note-bad" role="alert">{err}</div>}
        <div className="row-end">
          <a className="btn ghost" href={href(edit ? "coupons/" + coupon.id : "coupons")}>Cancel</a>
          <button className="btn primary" type="submit" data-testid="f-save">{edit ? "Save changes" : "Create coupon"}</button>
        </div>
      </form>
      {ask && <ReasonDialog title={edit ? "Save " + params.code : "Create " + params.code} confirm={edit ? "Save" : "Create"} action={action} params={params}
                            onClose={() => setAsk(false)} onDone={(d) => { setAsk(false); go("coupons/" + d.id); }} />}
    </Page>
  );
}
function EditCoupon({ me, id }) {
  const { loading, data, error, reload } = useAction("coupon.get", { coupon_id: id });
  if (loading && !data) return <Page title="Edit coupon"><Loading /></Page>;
  if (!data) return <Page title="Edit coupon"><ErrorNote error={error} onRetry={reload} /></Page>;
  if (data.set_status === "ended") return <Page title={"Edit " + data.code}><p className="muted">This coupon has ended. It cannot be changed.</p></Page>;
  return <CouponForm me={me} coupon={data} />;
}

// ---- the report: given per coupon and per month
const monthName = (v) => (v ? new Date(v + "T00:00:00+05:30").toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", month: "short", year: "numeric" }) : "–");
const firstOf = (back) => { const d = new Date(Date.now() + 5.5 * 3600000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back); return d.toISOString().slice(0, 10); };
function Report({ me }) {
  const cols = [
    { key: "month", label: "Month", type: "date", render: (r) => monthName(r.month) },
    { key: "code", label: "Code", type: "text", render: (r) => <a className="code-cell" href={href("coupons/" + r.coupon_id)} onClick={sp}>{r.code}</a> },
    { key: "kind", label: "Kind", type: "select", options: KINDS, phone: false },
    { key: "campaign", label: "Campaign", type: "text", phone: false },
    { key: "redemptions", label: "New uses", type: "number", align: "end" },
    { key: "credit_inr", label: "Credit given", type: "number", align: "end", render: (r) => fmtInr(r.credit_inr) },
    { key: "discount_inr", label: "Discounts given", type: "number", align: "end", render: (r) => fmtInr(r.discount_inr) },
    { key: "total_inr", label: "Total given", type: "number", align: "end", render: (r) => <b>{fmtInr(r.total_inr)}</b> },
  ];
  const presets = [
    { label: "This month", filters: { month: { op: "range", from: firstOf(0), to: null } } },
    { label: "Last 12 months", filters: { month: { op: "range", from: firstOf(11), to: null } } },
    { label: "All", filters: {} },
  ];
  return (
    <Page title="Coupon report" sub={<><a href={href("coupons")}>← All coupons</a> · Rupees given per coupon and per month: free credit in the month it was used, discounts in the billing month they were taken off.</>}>
      <DataTable id="crep" action="coupons.report" columns={cols} presets={presets} defaultPreset={2} me={me} exportName="coupon-report" rowKey="id"
                 empty="Nothing given yet." />
    </Page>
  );
}

export const module = {
  id: "coupons", label: "Coupons", icon: TicketPercent, action: "coupons.list",
  routes: [
    { path: /^coupons$/, render: (_, me) => <Coupons me={me} /> },
    { path: /^coupons\/new$/, render: (_, me) => <CouponForm me={me} key="new" /> },
    { path: /^coupons\/report$/, render: (_, me) => <Report me={me} /> },
    { path: /^coupons\/([0-9a-f-]{36})$/, render: (m, me) => <Coupon me={me} id={m[1]} key={m[1]} /> },
    { path: /^coupons\/([0-9a-f-]{36})\/edit$/, render: (m, me) => <EditCoupon me={me} id={m[1]} key={"e" + m[1]} /> },
  ],
};
