import { History } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Page } from "../../ui/bits.jsx";
import { fmtTime } from "../../lib/format.js";

const COLUMNS = [
  { key: "at", label: "When", type: "date", render: (r) => fmtTime(r.at) },
  { key: "who_email", label: "Who", type: "text" },
  { key: "role", label: "Role", type: "select", options: ["owner", "billing", "support", "viewer"], phone: false },
  { key: "action", label: "Action", type: "text" },
  { key: "target_type", label: "On", type: "select", options: ["firm", "user", "company", "admin"], phone: false },
  { key: "target_id", label: "Target", type: "text", phone: false, render: (r) => <code className="small">{r.target_id || "–"}</code> },
  { key: "reason", label: "Reason", type: "text", sortable: false },
  { key: "change", label: "Before → after", type: "text", sortable: false, filter: false, phone: false,
    render: (r) => (r.before || r.after) ? <details><summary className="link">Show</summary><pre className="diff">{JSON.stringify({ before: r.before, after: r.after }, null, 1)}</pre></details> : "–" },
];
function Audit({ me }) {
  return (
    <Page title="Change history" sub={me.role === "owner" ? "Every console action, views of people's data included. It can only be added to." : "Your own actions and your role's."}>
      <DataTable id="audit" action="audit.list" columns={COLUMNS} me={me} exportName="change-history" />
    </Page>
  );
}
export const module = { id: "audit", label: "Change history", icon: History, action: "audit.list", routes: [{ path: /^audit$/, render: (_, me) => <Audit me={me} /> }] };
