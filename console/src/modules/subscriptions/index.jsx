// Subscriptions: each firm's plan, status (trial, active, past due, read-only, paused, cancelled), period and renewal,
// usage against the plan's limits, the next fee, its ledger (top-up, refund, adjust) and its monthly runs. Owner and
// Billing change the plan or the status and run the month for one firm; everyone reads.
import { useState } from "react";
import { Repeat } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, ErrorNote, Facts, Loading, Page, ReasonButton } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtDate, fmtNum } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";
import { inr, inrPaise, Select, SUB_STATUS, SubChip } from "../billing/common.jsx";
import { AdjustButton, LEDGER_PRESETS, ledgerColumns, TopUpButton } from "../credit/index.jsx";

const OUTCOME = [{ value: "charged", label: "Charged" }, { value: "free", label: "Nothing to charge" }, { value: "trial", label: "Trial" }, { value: "short", label: "Short of credit" }, { value: "skipped", label: "Skipped" }];
const COLUMNS = (plans) => [
  { key: "firm", label: "Firm", type: "text" },
  { key: "plan", label: "Plan", type: "select", options: plans },
  { key: "status", label: "Status", type: "select", options: SUB_STATUS, render: (r) => <SubChip status={r.status} /> },
  { key: "billing_cycle", label: "Cycle", type: "select", options: ["monthly", "yearly"], phone: false },
  { key: "period_start", label: "Period from", type: "date", phone: false },
  { key: "renews_on", label: "Renews", type: "date" },
  { key: "grace_until", label: "Grace until", type: "date", phone: false },
  { key: "balance", label: "Credit", type: "number", align: "end", render: (r) => <span className={r.low ? "money-neg" : ""}>{inr(r.balance)}</span> },
  { key: "used", label: "Used this period", type: "number", align: "end", phone: false, render: (r) => inr(r.used) },
  { key: "clients", label: "Clients", type: "number", align: "end", phone: false },
  { key: "users", label: "Users", type: "number", align: "end", phone: false },
  { key: "ai_used", label: "AI this month", type: "number", align: "end", phone: false, render: (r) => inr(r.ai_used) },
  { key: "low", label: "Low credit", type: "bool", phone: false },
  { key: "is_test", label: "Test firm", type: "bool", phone: false },
  { key: "this_month", label: "This month's run", type: "select", options: OUTCOME, phone: false },
];
const PRESETS = [
  { label: "All", filters: {} },
  { label: "Needs attention", filters: { status: { op: "in", values: ["past_due", "read_only", "paused"] } } },
  { label: "Trial", filters: { status: { op: "in", values: ["trial"] } } },
  { label: "Low credit", filters: { low: { op: "is", value: true } } },
];
function Subs({ me }) {
  const plans = useAction("plans.list", { size: 100 });
  return (
    <Page title="Subscriptions" sub="Each firm's plan and billing status. Past due changes nothing for the firm; read-only stops changes and charges, never reading.">
      <DataTable id="subs" action="subs.list" columns={COLUMNS((plans.data?.rows || []).map((p) => p.name).concat("No plan"))} presets={PRESETS} me={me} exportName="subscriptions"
                 rowKey="firm_id" onRow={(r) => go("subscriptions/" + r.firm_id)} />
    </Page>
  );
}

function Bar({ label, used, cap, money = false, testid }) {
  const show = (v) => (money ? inr(v) : fmtNum(v));
  return (
    <div className="meter-row" data-testid={testid}>
      <span>{label}</span>
      {cap === null || cap === undefined ? <span className="muted small">no limit</span> : <meter min={0} max={Math.max(Number(cap), 1)} high={Number(cap) * 0.8} value={Math.min(Number(used), Number(cap))} aria-label={label} />}
      <b>{show(used)}{cap === null || cap === undefined ? "" : " of " + show(cap)}</b>
    </div>
  );
}
function Sub({ me, id }) {
  const { loading, data: d, error, reload } = useAction("sub.get", { firm_id: id });
  const plans = useAction("plans.list", { size: 100, filters: { active: { op: "is", value: true } } });
  const [n, setN] = useState(0);
  const done = () => { reload(); setN(n + 1); };
  if (loading && !d) return <Page title="Subscription"><Loading /></Page>;
  if (!d) return <Page title="Subscription"><ErrorNote error={error} onRetry={reload} /></Page>;
  const s = d.subscription || {}, p = d.plan;
  const planOpts = (plans.data?.rows || []).map((x) => ({ value: x.id, label: x.name }));
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  return (
    <Page title={d.firm} sub={<><a href={href("subscriptions")}>← All subscriptions</a> · <a href={href("firms/" + id)}>Firm page</a></>}
          actions={<>
            <TopUpButton me={me} firmId={id} onDone={done} />
            <AdjustButton me={me} firmId={id} onDone={done} />
            <ReasonButton me={me} action="sub.change_plan" params={{ firm_id: id, plan_id: s.plan_id || planOpts[0]?.value, cycle: s.billing_cycle }} label="Change plan" onDone={done}
                          extra={(m, set) => (<>
                            <Select label="Plan (from now; the next run charges it)" value={m.plan_id ?? s.plan_id ?? planOpts[0]?.value} options={planOpts} onChange={(v) => set({ ...m, plan_id: v })} testid="plan-select" />
                            <Select label="Billed" value={m.cycle ?? s.billing_cycle} options={[{ value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" }]} onChange={(v) => set({ ...m, cycle: v })} />
                          </>)} />
            <ReasonButton me={me} action="sub.set_status" params={{ firm_id: id, status: s.status === "active" ? "paused" : "active" }} label="Set status" onDone={done}
                          extra={(m, set) => { const st = m.status ?? (s.status === "active" ? "paused" : "active"); return (<>
                            <Select label="Status" value={st} options={SUB_STATUS} onChange={(v) => set({ ...m, status: v })} testid="status-select" />
                            {st === "trial" && <label className="field"><span>Trial ends on</span><input className="input" type="date" min={today} value={m.trial_ends_on || ""} onChange={(e) => set({ ...m, trial_ends_on: e.target.value })} data-testid="trial-date" /></label>}
                          </>); }} />
            <ReasonButton me={me} action="billing.run" params={{ firm_id: id, mode: "month" }} label="Run this month for this firm" onDone={done} />
          </>}>
      <ErrorNote error={error} onRetry={reload} />
      <div className="chips"><SubChip status={s.status} />{d.is_test && <Chip tone="warn">Test firm</Chip>}{d.firm_status !== "active" && <Chip tone="bad">Firm {d.firm_status}</Chip>}</div>
      {["past_due", "read_only", "paused"].includes(s.status) && <div className="note note-warn" role="note">
        {s.status === "past_due" ? `Past due since ${fmtDate(s.past_due_since)}: everything still works until ${fmtDate(s.grace_until)}, then read-only.`
          : s.status === "read_only" ? "Read-only: the firm sees and exports everything but cannot change anything or be charged. A top-up charges the fee and makes it active again."
          : "Paused: read-only and not charged. A top-up charges the fee and makes it active again."}</div>}
      <Facts items={[["Plan", p ? <a href={href("plans/" + p.id)}>{p.name}</a> : "No plan"], ["Billed", s.billing_cycle], ["Period from", fmtDate(s.period_start)], ["Renews", fmtDate(s.renews_on)],
                     ["Trial ends", fmtDate(s.trial_ends_on)], ["Credit", inr(d.balance)], ["Warning at", inr(d.low_balance_warn)], ["Next fee", inrPaise(d.fee?.total_paise)]]} />
      <div className="cols">
        <section className="card"><h2>Use this period</h2>
          {(d.items || []).map((it) => <Bar key={it.code} label={`${it.title}${it.in_plan ? " (in the plan)" : ` (${inr(it.price)} ${it.unit})`}`} used={it.qty} cap={it.in_plan ? it.cap : null} testid={"use-" + it.code} />)}
          <Bar label="Clients" used={d.clients?.count} cap={d.clients?.included} testid="use-clients" />
          <Bar label="Users" used={d.users?.count} cap={d.users?.included} testid="use-users" />
          <Bar label="AI this month (₹)" used={(d.ai?.used_paise || 0) / 100} cap={d.ai?.allowance_paise === -1 || d.ai?.allowance_paise === null || d.ai?.allowance_paise === undefined ? null : d.ai.allowance_paise / 100} money testid="use-ai" />
        </section>
        <section className="card"><h2>The next fee</h2>
          <ul className="list">
            {(d.fee?.parts || []).map((x) => <li key={x.what}><span>{x.title}{x.qty > 1 ? ` × ${x.qty} at ${inrPaise(x.price_paise)}` : ""}</span><b>{inrPaise(x.amount_paise)}</b></li>)}
            {(d.fee?.parts || []).length === 0 && <li className="muted">Nothing to charge on this plan.</li>}
            <li><span>Total ({d.fee?.cycle})</span><b data-testid="fee-total">{inrPaise(d.fee?.total_paise)}</b></li>
          </ul>
          <h2>Monthly runs</h2>
          <ul className="list" data-testid="runs">
            {(d.runs || []).map((r) => <li key={r.month}><span>{fmtDate(r.month).slice(3)} · {(OUTCOME.find((o) => o.value === r.outcome) || {}).label}</span><span className="muted">{inrPaise(r.fee_paise)} · {r.tries} tr{r.tries === 1 ? "y" : "ies"}</span></li>)}
            {(d.runs || []).length === 0 && <li className="muted">No run yet.</li>}
          </ul>
        </section>
      </div>
      <section className="card"><h2>Credit ledger</h2>
        <DataTable key={n} id="fled" action="firm.ledger" params={{ firm_id: id }} columns={ledgerColumns(me, done, { firm: false })} presets={LEDGER_PRESETS} me={me} exportName="firm-ledger" />
      </section>
    </Page>
  );
}

export const module = {
  id: "subscriptions", label: "Subscriptions", icon: Repeat, action: "subs.list",
  routes: [
    { path: /^subscriptions$/, render: (_, me) => <Subs me={me} /> },
    { path: /^subscriptions\/([0-9a-f-]{36})$/, render: (m, me) => <Sub me={me} id={m[1]} key={m[1]} /> },
  ],
};
