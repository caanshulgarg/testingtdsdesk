// The monthly run: on the 1st at 00:05 India time (pg_cron) and on demand ("Run now"; Owner and Billing). Once per firm
// per month however often it runs: the period starts again, the fee is charged, or the firm becomes past due with the
// grace days from Settings; then read-only after the grace, paused later. The report: one line per firm per month.
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Page, ReasonButton } from "../../ui/bits.jsx";
import { go } from "../../lib/route.js";
import { inr, SUB_STATUS, SubChip } from "../billing/common.jsx";

const OUTCOME = [{ value: "charged", label: "Charged" }, { value: "free", label: "Nothing to charge" }, { value: "trial", label: "Trial" }, { value: "short", label: "Short of credit" }, { value: "skipped", label: "Skipped" }];
const COLUMNS = [
  { key: "firm", label: "Firm", type: "text" },
  { key: "month", label: "Month", type: "date" },
  { key: "outcome", label: "Outcome", type: "select", options: OUTCOME },
  { key: "fee", label: "Fee", type: "number", align: "end", render: (r) => inr(r.fee) },
  { key: "status", label: "Status now", type: "select", options: SUB_STATUS, render: (r) => <SubChip status={r.status} /> },
  { key: "balance", label: "Credit now", type: "number", align: "end", phone: false, render: (r) => inr(r.balance) },
  { key: "tries", label: "Tries", type: "number", align: "end", phone: false },
  { key: "run_at", label: "Last run", type: "date", phone: false },
  { key: "run_by", label: "By", type: "text", phone: false },
  { key: "is_test", label: "Test firm", type: "bool", phone: false },
];
const PRESETS = [{ label: "All", filters: {} }, { label: "Short of credit", filters: { outcome: { op: "in", values: ["short"] } } }, { label: "Charged", filters: { outcome: { op: "in", values: ["charged"] } } }];
const WORDS = { charged: "charged", free: "nothing to charge", trial: "on trial", short: "short of credit", skipped: "skipped", already: "already done", to_read_only: "now read-only", to_paused: "now paused" };

function Runs({ me }) {
  const [n, setN] = useState(0);
  const [last, setLast] = useState(null);
  return (
    <Page title="Monthly run" sub="Runs by itself at 00:05 India time on the 1st, and retries short firms every night. Running it again never charges twice."
          actions={<ReasonButton me={me} action="billing.run" params={{ mode: "month" }} label="Run now" tone="primary" title="Run this month's charges for every firm"
                                 confirm="Run" onDone={(d) => { setLast(d); setN(n + 1); }} />}>
      {last && <div className="note note-soft" role="status" data-testid="run-result">
        {new Date(last.month).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}: {Object.entries(last.counts || {}).filter(([, v]) => v).map(([k, v]) => `${v} ${WORDS[k] || k}`).join(", ") || "nothing to do"}.</div>}
      <DataTable key={n} id="runs" action="billing.runs" columns={COLUMNS} presets={PRESETS} me={me} exportName="monthly-run" rowKey={(r) => r.firm_id + r.month}
                 onRow={(r) => go("subscriptions/" + r.firm_id)} empty="No run yet." />
    </Page>
  );
}
export const module = { id: "billing-runs", label: "Monthly run", icon: CalendarClock, action: "billing.runs", routes: [{ path: /^billing-runs$/, render: (_, me) => <Runs me={me} /> }] };
