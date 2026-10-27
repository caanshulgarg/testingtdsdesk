import { Building2 } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { ErrorNote, Facts, Loading, Page, ReasonButton, StatusChip } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtDate, fmtInr, fmtTime } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";
import { COMPANY_COLUMNS, COMPANY_PRESETS } from "../companies/index.jsx";

export const STATUS = [{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "closed", label: "Closed" }];
export const FIRM_PRESETS = [
  { label: "Active", filters: { status: { op: "in", values: ["active"] } } },
  { label: "Suspended", filters: { status: { op: "in", values: ["suspended", "closed"] } } },
  { label: "All", filters: {} },
];
const COLUMNS = [
  { key: "name", label: "Firm", type: "text" },
  { key: "owner_email", label: "Owner", type: "text", phone: false },
  { key: "plan", label: "Plan", type: "select", options: ["Pay as you go", "Per client", "Monthly with Claude and Vision extra", "Monthly, all included"] },
  { key: "status", label: "Status", type: "select", options: STATUS, render: (r) => <StatusChip status={r.status} /> },
  { key: "balance", label: "Credit", type: "number", align: "end", render: (r) => fmtInr(r.balance) },
  { key: "members", label: "People", type: "number", align: "end", phone: false },
  { key: "clients", label: "Clients", type: "number", align: "end", phone: false },
  { key: "created_at", label: "Created", type: "date", phone: false },
  { key: "last_activity", label: "Last activity", type: "date", phone: false },
  { key: "active", label: "Charging on", type: "bool", phone: false },
];

function Firms({ me }) {
  return (
    <Page title="Firms" sub="Every firm's account: plan, credit, people and clients. No client books are shown here.">
      <DataTable id="firms" action="firms.list" columns={COLUMNS} presets={FIRM_PRESETS} defaultPreset={2} me={me} exportName="firms" onRow={(r) => go("firms/" + r.id)} />
    </Page>
  );
}

function Firm({ me, id }) {
  const { loading, data: f, error, reload } = useAction("firm.get", { firm_id: id });
  if (loading && !f) return <Page title="Firm"><Loading /></Page>;
  if (!f) return <Page title="Firm"><ErrorNote error={error} onRetry={reload} /></Page>;
  const off = f.status !== "active";
  return (
    <Page title={f.name} sub={<a href={href("firms")}>← All firms</a>}
          actions={<>
            {!off && <ReasonButton me={me} action="firm.deactivate" params={{ firm_id: id }} label="Suspend firm" tone="danger" onDone={reload}
                                   title={"Suspend " + f.name} confirm="Suspend"
                                   extra={(m, set) => (
                                     <label className="field"><span>How</span>
                                       <select className="input" value={m.status || "suspended"} onChange={(e) => set({ ...m, status: e.target.value })}>
                                         <option value="suspended">Suspended: read-only, can be reactivated</option>
                                         <option value="closed">Closed: read-only, the firm has left</option>
                                       </select>
                                     </label>)} />}
            {off && <ReasonButton me={me} action="firm.reactivate" params={{ firm_id: id }} label="Reactivate firm" tone="primary" onDone={reload} />}
          </>}>
      <ErrorNote error={error} onRetry={reload} />
      <div className="chips"><StatusChip status={f.status} />{off && f.status_reason && <span className="muted">“{f.status_reason}” · {f.status_by || ""} {fmtTime(f.status_at)}</span>}</div>
      {off && <div className="note note-warn" role="note">This firm is read-only: its people can see their data but cannot change anything, and nothing is posted to Tally.</div>}
      <Facts items={[["Plan", f.plan || "No plan"], ["Credit", fmtInr(f.balance)], ["Warning level", fmtInr(f.low_balance_warn)], ["Period from", fmtDate(f.period_start)],
                     ["Clients", `${f.clients}${f.clients_off ? ` (${f.clients_off} switched off)` : ""}`], ["Bridges", f.bridges], ["Created", fmtDate(f.created_at)], ["Charging", f.active ? "On" : "Off"]]} />
      <section className="card">
        <h2>People</h2>
        <ul className="list">
          {(f.members || []).map((m) => (
            <li key={m.user_id}>
              <a href={href("users/" + m.user_id)}>{m.name || m.email}</a>
              <span className="muted">{m.email} · {m.role} · {m.active ? "active" : "off"} · two-step {m.mfa ? "on" : "off"} · last sign-in {fmtDate(m.last_sign_in_at)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Companies (clients)</h2>
        <DataTable id="fco" action="companies.list" params={{ firm_id: id }} columns={COMPANY_COLUMNS.filter((c) => c.key !== "firm")} presets={COMPANY_PRESETS} me={me}
                   onRow={(r) => go(`companies/${id}/${encodeURIComponent(r.id)}`)} />
      </section>
      <section className="card">
        <h2>Recent activity</h2>
        <ul className="list">{(f.recent || []).map((a, i) => <li key={i}><span>{a.what}</span><span className="muted">{fmtTime(a.at)}</span></li>)}</ul>
        {(f.recent || []).length === 0 && <p className="muted">None.</p>}
      </section>
    </Page>
  );
}

export const module = {
  id: "firms", label: "Firms", icon: Building2, action: "firms.list",
  routes: [
    { path: /^firms$/, render: (_, me) => <Firms me={me} /> },
    { path: /^firms\/([0-9a-f-]{36})$/, render: (m, me) => <Firm me={me} id={m[1]} key={m[1]} /> },
  ],
};
