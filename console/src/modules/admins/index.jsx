import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, Page, ReasonButton } from "../../ui/bits.jsx";
import { fmtDate } from "../../lib/format.js";

const ROLES = [{ value: "owner", label: "Owner" }, { value: "billing", label: "Billing" }, { value: "support", label: "Support" }, { value: "viewer", label: "Viewer" }];
const roleField = (m, set) => (
  <label className="field"><span>Role</span>
    <select className="input" value={m.role || "viewer"} onChange={(e) => set({ ...m, role: e.target.value })} data-testid="role-select">
      {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
    </select>
  </label>
);
function Admins({ me }) {
  const [n, setN] = useState(0);
  const done = () => setN(n + 1);
  const cols = [
    { key: "email", label: "Email", type: "text" },
    { key: "role", label: "Role", type: "select", options: ROLES },
    { key: "active", label: "Active", type: "bool", render: (r) => <Chip tone={r.active ? "good" : "neutral"}>{r.active ? "Active" : "Removed"}</Chip> },
    { key: "mfa", label: "Two-step", type: "bool", yes: "On", no: "Off", phone: false },
    { key: "last_sign_in_at", label: "Last sign-in", type: "date", phone: false },
    { key: "added_at", label: "Added", type: "date", phone: false, render: (r) => `${fmtDate(r.added_at)}${r.added_by_email ? " by " + r.added_by_email : ""}` },
    { key: "do", label: "", type: "text", sortable: false, filter: false,
      render: (r) => r.active && r.user_id !== me.user_id ? (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <ReasonButton me={me} action="admins.set_role" params={{ user_id: r.user_id }} label="Change role" extra={roleField} onDone={done} />
          <ReasonButton me={me} action="admins.remove" params={{ user_id: r.user_id }} label="Remove" tone="danger" onDone={done} />
        </span>) : r.user_id === me.user_id ? <span className="muted small">You</span> : null },
  ];
  return (
    <Page title="Admins" sub="Who may use the console, and with which role. Only an owner sees this page. There must always be one active owner."
          actions={<ReasonButton me={me} action="admins.add" params={{}} label="Add an admin" tone="primary" onDone={done}
                                 extra={(m, set) => (<>
                                   <label className="field"><span>Email of an existing FinCom login</span>
                                     <input className="input" type="email" value={m.email || ""} onChange={(e) => set({ ...m, email: e.target.value })} data-testid="admin-email" /></label>
                                   {roleField(m, set)}
                                 </>)} />}>
      <DataTable key={n} id="admins" action="admins.list" columns={cols} me={me} rowKey="user_id"
                 presets={[{ label: "Active", filters: { active: { op: "is", value: true } } }, { label: "Removed", filters: { active: { op: "is", value: false } } }, { label: "All", filters: {} }]} />
    </Page>
  );
}
export const module = { id: "admins", label: "Admins", icon: ShieldCheck, action: "admins.list", routes: [{ path: /^admins$/, render: (_, me) => <Admins me={me} /> }] };
