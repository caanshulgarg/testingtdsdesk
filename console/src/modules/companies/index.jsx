import { Briefcase } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { ErrorNote, Facts, Loading, Page, ReasonButton, StatusChip } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtTime } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";

export const COMPANY_PRESETS = [
  { label: "Active", filters: { status: { op: "in", values: ["active"] } } },
  { label: "Deactivated", filters: { status: { op: "in", values: ["deactivated"] } } },
  { label: "All", filters: {} },
];
export const COMPANY_COLUMNS = [
  { key: "name", label: "Company", type: "text" },
  { key: "gstin", label: "GSTIN", type: "text", phone: false },
  { key: "firm", label: "Firm", type: "text" },
  { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "deactivated", label: "Deactivated" }], render: (r) => <StatusChip status={r.status} /> },
  { key: "status_at", label: "Status changed", type: "date", phone: false },
  { key: "deleted", label: "Deleted by the firm", type: "bool", phone: false },
];

function Companies({ me }) {
  return (
    <Page title="Companies" sub="The firms' clients: name, GSTIN and status only. Their books stay in the firm's own app.">
      <DataTable id="co" action="companies.list" columns={COMPANY_COLUMNS} presets={COMPANY_PRESETS} me={me} exportName="companies"
                 rowKey={(r) => r.firm_id + "/" + r.id} onRow={(r) => go(`companies/${r.firm_id}/${encodeURIComponent(r.id)}`)} />
    </Page>
  );
}
function Company({ me, firm, id }) {
  const { loading, data: c, error, reload } = useAction("company.get", { firm_id: firm, client_id: id });
  if (loading && !c) return <Page title="Company"><Loading /></Page>;
  if (!c) return <Page title="Company"><ErrorNote error={error} onRetry={reload} /></Page>;
  const off = c.status !== "active";
  return (
    <Page title={c.name || id} sub={<a href={href("firms/" + firm)}>← {c.firm}</a>}
          actions={off ? <ReasonButton me={me} action="company.reactivate" params={{ firm_id: firm, client_id: id }} label="Reactivate company" tone="primary" onDone={reload} />
                       : <ReasonButton me={me} action="company.deactivate" params={{ firm_id: firm, client_id: id }} label="Deactivate company" tone="danger" onDone={reload} />}>
      <ErrorNote error={error} onRetry={reload} />
      <div className="chips"><StatusChip status={c.status} />{c.firm_status !== "active" && <StatusChip status={c.firm_status} />}</div>
      {off && <div className="note note-warn" role="note">Switched off: hidden from the firm's client lists, nothing is posted to Tally for it, and it is not billed per client. All its data is kept.</div>}
      <Facts items={[["Firm", <a href={href("firms/" + firm)} key="f">{c.firm}</a>], ["GSTIN", c.gstin || "–"], ["Postings waiting", c.postings_waiting],
                     off && ["Reason", c.status_reason || "–"], off && ["Changed", `${fmtTime(c.status_at)} by ${c.status_by || "–"}`], ["Deleted by the firm", c.deleted ? "Yes" : "No"]]} />
    </Page>
  );
}
export const module = {
  id: "companies", label: "Companies", icon: Briefcase, action: "companies.list",
  routes: [
    { path: /^companies$/, render: (_, me) => <Companies me={me} /> },
    { path: /^companies\/([0-9a-f-]{36})\/(.+)$/, render: (m, me) => <Company me={me} firm={m[1]} id={decodeURIComponent(m[2])} key={m[0]} /> },
  ],
};
