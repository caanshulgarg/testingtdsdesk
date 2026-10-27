// Data exports: the all-firms credit ledger (with its own Export CSV, as every list), and the Owner's "Export
// everything" (firms, users, ledger, change history) as one .zip. Every export is in the change history.
import { useState } from "react";
import { Download } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Page, ReasonButton } from "../../ui/bits.jsx";
import { fmtInr, fmtNum } from "../../lib/format.js";
import { href } from "../../lib/route.js";
import { saveBlob, zip } from "../../lib/zip.js";

const KINDS = [{ value: "topup", label: "Top-up" }, { value: "charge", label: "Charge" }, { value: "refund", label: "Refund" }, { value: "adjust", label: "Adjustment" }, { value: "fee", label: "Fee" },
  { value: "opening", label: "Opening" }, { value: "signup_credit", label: "Sign-up credit" }, { value: "coupon_credit", label: "Coupon credit" },
  { value: "discount", label: "Discount" }, { value: "ai_usage", label: "AI past the allowance" }, { value: "credit", label: "Credit (old)" }];
const LEDGER = [
  { key: "at", label: "When", type: "date" },
  { key: "firm", label: "Firm", type: "text" },
  { key: "kind", label: "Kind", type: "select", options: KINDS },
  { key: "code", label: "Item", type: "text" },
  { key: "qty", label: "Qty", type: "number", align: "end", phone: false },
  { key: "amount", label: "Amount", type: "number", align: "end", render: (r) => fmtInr(r.amount) },
  { key: "balance_after", label: "Balance after", type: "number", align: "end", phone: false, render: (r) => fmtInr(r.balance_after) },
  { key: "note", label: "Note", type: "text", phone: false },
  { key: "ref", label: "Reference", type: "text", hidden: true },
  { key: "amount_paise", label: "Amount (paise)", type: "number", hidden: true },
];

function Exports({ me }) {
  const [done, setDone] = useState(null);
  const owner = me.actions.includes("exports.all");
  return (
    <Page title="Exports" sub="CSV files of the console's data. Every export is recorded in the change history."
          actions={owner && <ReasonButton me={me} action="exports.all" params={{}} label="Export everything" tone="primary" title="Export firms, users, the ledger and the change history" confirm="Export"
                                          onDone={(d) => { saveBlob("fincom-export-" + d.at.slice(0, 10) + ".zip", zip(d.files.map((f) => ({ name: f.name, text: f.csv })))); setDone(d); }} />}>
      {done && (
        <div className="note" role="status" data-testid="export-done">
          Downloaded {done.files.map((f) => `${f.name} (${fmtNum(f.rows)} rows${f.truncated ? ` of ${fmtNum(f.total)}: the first ${fmtNum(f.rows)} only` : ""})`).join(", ")}.
        </div>
      )}
      <ul className="list card">
        <li><a href={href("firms")}>Firms</a><span className="muted">Firms page → Export CSV (with its filters)</span></li>
        <li><a href={href("users")}>Users</a><span className="muted">Users page → Export CSV</span></li>
        <li><a href={href("audit")}>Change history</a><span className="muted">Change history → Export CSV</span></li>
        {owner && <li><span>Everything at once</span><span className="muted">Export everything (Owner): one .zip, at most 5 a day</span></li>}
      </ul>
      {me.actions.includes("exports.ledger") && (
        <section className="card">
          <h2>Credit ledger, all firms</h2>
          <DataTable id="led" action="exports.ledger" columns={LEDGER} me={me} exportName="ledger" defaultPreset={0}
                     presets={[{ label: "All", filters: {} }, { label: "Top-ups", filters: { kind: { op: "in", values: ["topup"] } } }, { label: "Charges", filters: { kind: { op: "in", values: ["charge", "fee"] } } }]} />
        </section>
      )}
    </Page>
  );
}

export const module = { id: "exports", label: "Exports", icon: Download, action: "exports.ledger", routes: [{ path: /^exports$/, render: (_, me) => <Exports me={me} /> }] };
