import { Users } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, ErrorNote, Facts, Loading, Page, ReasonButton } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtTime } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";

const PRESETS = [
  { label: "Active", filters: { active: { op: "is", value: true } } },
  { label: "Deactivated", filters: { active: { op: "is", value: false } } },
  { label: "All", filters: {} },
];
const COLUMNS = [
  { key: "name", label: "Name", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "firm", label: "Firm", type: "text", phone: false },
  { key: "role", label: "Role", type: "select", options: [{ value: "owner", label: "Owner" }, { value: "staff", label: "Staff" }, { value: "readonly", label: "Look only" }] },
  { key: "active", label: "Active", type: "bool", render: (r) => <Chip tone={r.active ? "good" : "bad"}>{r.active ? "Active" : r.switched_off ? "Switched off by FinCom" : "Off"}</Chip> },
  { key: "mfa", label: "Two-step", type: "bool", yes: "On", no: "Off", phone: false },
  { key: "last_sign_in_at", label: "Last sign-in", type: "date", phone: false },
  { key: "switched_off", label: "Switched off by FinCom", type: "bool", phone: false },
  { key: "firm_status", label: "Firm status", type: "select", options: [{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "closed", label: "Closed" }], phone: false },
];

function UsersPage({ me }) {
  return (
    <Page title="Users" sub="Everyone with a FinCom login in a firm.">
      <DataTable id="users" action="users.list" columns={COLUMNS} presets={PRESETS} defaultPreset={2} me={me} exportName="users"
                 rowKey={(r) => r.user_id + "/" + r.firm_id} onRow={(r) => go("users/" + r.user_id)} />
    </Page>
  );
}
function User({ me, id }) {
  const { loading, data: u, error, reload } = useAction("user.get", { user_id: id });
  if (loading && !u) return <Page title="Person"><Loading /></Page>;
  if (!u) return <Page title="Person"><ErrorNote error={error} onRetry={reload} /></Page>;
  const off = u.switched_off || (u.banned_until && Date.parse(u.banned_until) > Date.now());
  const p = { user_id: id };
  const verified = (u.factors || []).filter((f) => f.status === "verified");
  return (
    <Page title={u.name || u.email} sub={u.firm_id ? <a href={href("firms/" + u.firm_id)}>← {u.firm}</a> : <a href={href("users")}>← All users</a>}
          actions={<>
            <ReasonButton me={me} action="user.reset_mfa" params={p} label="Reset two-step" title="Reset two-step sign-in" confirm="Reset" onDone={reload} />
            <ReasonButton me={me} action="user.signout_all" params={p} label="Sign out everywhere" confirm="Sign out" onDone={reload} />
            {off ? <ReasonButton me={me} action="user.reactivate" params={p} label="Switch on" tone="primary" onDone={reload} />
                 : <ReasonButton me={me} action="user.deactivate" params={p} label="Switch off" tone="danger" title="Switch this person off" confirm="Switch off" onDone={reload} />}
          </>}>
      <ErrorNote error={error} onRetry={reload} />
      <div className="chips">
        <Chip tone={off ? "bad" : u.active === false ? "warn" : "good"} testid="status-chip">{off ? "Switched off" : u.active === false ? "Off in the firm" : "Active"}</Chip>
        <Chip tone={verified.length ? "good" : "warn"}>Two-step {verified.length ? "on" : "off"}</Chip>
        {u.console_role && <Chip>Console {u.console_role}</Chip>}
      </div>
      {off && <div className="note note-warn" role="note">Switched off: signed out, cannot sign in, and switched off in every firm. Nothing of theirs is deleted.</div>}
      <Facts items={[["Email", u.email], ["Firm", u.firm || "–"], ["Role", u.role || "–"], ["Signs in with", u.provider], ["Email confirmed", u.email_confirmed ? "Yes" : "No"],
                     ["Created", fmtTime(u.created_at)], ["Last sign-in", fmtTime(u.last_sign_in_at)], ["Open sessions", u.sessions]]} />
      <section className="card">
        <h2>Two-step methods</h2>
        <ul className="list">{(u.factors || []).map((f) => <li key={f.id}><span>{f.type === "totp" ? "Authenticator app" : f.type} {f.name ? `(${f.name})` : ""}</span><span className="muted">{f.status} · added {fmtTime(f.created_at)}</span></li>)}</ul>
        {(u.factors || []).length === 0 && <p className="muted">None.</p>}
      </section>
      <section className="card">
        <h2>Recent activity</h2>
        <ul className="list">{(u.recent || []).map((a, i) => <li key={i}><span>{a.what}</span><span className="muted">{fmtTime(a.at)}</span></li>)}</ul>
        {(u.recent || []).length === 0 && <p className="muted">None.</p>}
      </section>
    </Page>
  );
}
export const module = {
  id: "users", label: "Users", icon: Users, action: "users.list",
  routes: [
    { path: /^users$/, render: (_, me) => <UsersPage me={me} /> },
    { path: /^users\/([0-9a-f-]{36})$/, render: (m, me) => <User me={me} id={m[1]} key={m[1]} /> },
  ],
};
