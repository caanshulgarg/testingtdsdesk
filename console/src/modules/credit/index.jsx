// Credit: one ledger. All firms (Owner, Billing, Viewer; filters on every column, totals by export), the
// balance = ledger check with its adjusting entry (Owner), and the data clean-up actions (Owner; listed here, done
// only when pressed). A firm's own ledger, top-up and adjust are on its subscription page; refund is on any charge line.
import { useState } from "react";
import { Wallet } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, Page, ReasonButton } from "../../ui/bits.jsx";
import { go, href } from "../../lib/route.js";
import { fmtDate } from "../../lib/format.js";
import { CATEGORIES, inr, ITEMS, KINDS, MoneyButton, PAY_MODES, RupeeField } from "../billing/common.jsx";

const left = (r) => Math.round((-Number(r.amount) - Number(r.refunded || 0)) * 100) / 100;
export function RefundButton({ me, row, onDone }) {
  if (!["charge", "fee"].includes(row.kind) || left(row) <= 0) return null;
  return (
    <span onClick={(e) => e.stopPropagation()}>
      <MoneyButton me={me} action="credit.refund" params={{ entry_id: row.id }} label="Refund" title={`Refund line #${row.id} (${inr(left(row))} left)`} confirm="Refund" onDone={onDone}
                   extra={(m, set) => <RupeeField label={`Amount (blank: all ${inr(left(row))})`} m={m} set={set} k="amount_paise" testid="refund-amount" />} />
    </span>
  );
}
export function ledgerColumns(me, onDone, { firm = true } = {}) {
  const nw = (v) => <span className="nowrap">{v}</span>;
  return [
    { key: "id", label: "#", type: "number", phone: false },
    { key: "at", label: "When", type: "date", render: (r) => nw(fmtDate(r.at)) },
    ...(firm ? [{ key: "firm", label: "Firm", type: "text", render: (r) => <a href={href("subscriptions/" + r.firm_id)} onClick={(e) => e.stopPropagation()}>{r.firm}</a> }] : []),
    { key: "kind", label: "Kind", type: "select", options: KINDS, render: (r) => nw((KINDS.find((k) => k.value === r.kind) || { label: r.kind }).label) },
    { key: "code", label: "Item", type: "select", options: ITEMS, phone: false },
    { key: "amount", label: "Amount", type: "number", align: "end", render: (r) => <span className={"nowrap " + (Number(r.amount) < 0 ? "money-neg" : "money-pos")}>{inr(r.amount)}</span> },
    { key: "balance_after", label: "Balance after", type: "number", align: "end", phone: false, render: (r) => nw(inr(r.balance_after)) },
    { key: "note", label: "Note", type: "text", phone: false },
    { key: "ref", label: "Reference", type: "text", phone: false },
    { key: "reason", label: "Reason", type: "text", phone: false },
    { key: "category", label: "Category", type: "select", options: [...CATEGORIES, { value: "refund", label: "Refund" }, { value: "reconcile", label: "Reconcile" }, { value: "provider_failed", label: "Provider failed" }], phone: false },
    ...(firm ? [{ key: "pay_mode", label: "Paid by", type: "select", options: PAY_MODES, phone: false }] : []),
    { key: "by_email", label: "By", type: "text", phone: false },
    { key: "do", label: "", type: "text", sortable: false, filter: false, render: (r) => <RefundButton me={me} row={r} onDone={onDone} /> },
  ];
}
export const LEDGER_PRESETS = [
  { label: "All", filters: {} },
  { label: "Money in", filters: { kind: { op: "in", values: ["topup", "refund", "signup_credit", "coupon_credit", "credit", "opening"] } } },
  { label: "Charges", filters: { kind: { op: "in", values: ["charge", "fee"] } } },
  { label: "Adjustments", filters: { kind: { op: "in", values: ["adjust", "opening"] } } },
];
export function Tabs({ on, me }) {
  const t = [["credit", "Ledger", "ledger.list"], ["credit/check", "Balance = ledger", "ledger.check"], ["credit/cleanup", "Clean-up", "cleanup.list"]].filter((x) => me.actions.includes(x[2]));
  return <nav className="tabs" aria-label="Credit">{t.map(([p, l]) => <a key={p} href={href(p)} className={on === p ? "on" : ""} aria-current={on === p ? "page" : undefined}>{l}</a>)}</nav>;
}

function Ledger({ me }) {
  const [n, setN] = useState(0);
  return (
    <Page title="Credit" sub="Every rupee in or out of every firm's balance: who, why, and the reference. Open a firm to top up or adjust.">
      <Tabs on="credit" me={me} />
      <DataTable key={n} id="ledger" action="ledger.list" columns={ledgerColumns(me, () => setN(n + 1))} presets={LEDGER_PRESETS} me={me} exportName="credit-ledger"
                 onRow={(r) => go("subscriptions/" + r.firm_id)} />
    </Page>
  );
}

const CHECK_COLUMNS = (me, done) => [
  { key: "firm", label: "Firm", type: "text" },
  { key: "ok", label: "Agrees", type: "bool", render: (r) => <Chip tone={r.ok ? "good" : "bad"} testid="check-chip">{r.ok ? "Balance = ledger" : "Differs"}</Chip> },
  { key: "balance", label: "Balance", type: "number", align: "end", render: (r) => inr(r.balance) },
  { key: "ledger_sum", label: "Ledger total", type: "number", align: "end", render: (r) => inr(r.ledger_sum) },
  { key: "diff", label: "Difference", type: "number", align: "end", render: (r) => (Number(r.diff) ? <b>{inr(r.diff)}</b> : "–") },
  { key: "entries", label: "Lines", type: "number", align: "end", phone: false },
  { key: "chain_breaks", label: "Chain breaks", type: "number", align: "end", phone: false },
  { key: "is_test", label: "Test firm", type: "bool", phone: false },
  { key: "last_entry_at", label: "Last line", type: "date", phone: false },
  { key: "do", label: "", type: "text", sortable: false, filter: false, render: (r) => (!r.ok &&
    <span onClick={(e) => e.stopPropagation()}><ReasonButton me={me} action="ledger.fix" params={{ firm_id: r.firm_id }} label="Fix with an adjusting entry" onDone={done}
      title={`${r.firm}: write one ${r.entries ? "adjusting" : "opening"} line of ${inr(r.diff)}`} confirm="Write the line" /></span>) },
];
function Check({ me }) {
  const [n, setN] = useState(0);
  return (
    <Page title="Balance = ledger" sub="Each firm's balance against the sum of its ledger lines. The fix writes one adjusting line (an opening line when the firm has none); the balance itself never moves.">
      <Tabs on="credit/check" me={me} />
      <DataTable key={n} id="check" action="ledger.check" columns={CHECK_COLUMNS(me, () => setN(n + 1))} me={me} exportName="ledger-check" rowKey="firm_id"
                 presets={[{ label: "Differs", filters: { ok: { op: "is", value: false } } }, { label: "All", filters: {} }]} defaultPreset={1} />
    </Page>
  );
}

const ISSUES = [{ value: "large_credit", label: "Credit of ₹10 lakh or more" }, { value: "no_ledger", label: "Balance with no ledger line" }, { value: "mismatch", label: "Balance differs from ledger" }];
const CLEAN_COLUMNS = (me, done) => [
  { key: "firm", label: "Firm", type: "text" },
  { key: "issue", label: "What looks wrong", type: "select", options: ISSUES },
  { key: "balance", label: "Balance", type: "number", align: "end", render: (r) => inr(r.balance) },
  { key: "ledger_sum", label: "Ledger total", type: "number", align: "end", render: (r) => inr(r.ledger_sum) },
  { key: "entries", label: "Lines", type: "number", align: "end", phone: false },
  { key: "is_test", label: "Test firm", type: "bool", phone: false },
  { key: "action", label: "Action", type: "select", options: [{ value: "cleanup.test_credit", label: "Mark test firm, set credit" }, { value: "ledger.fix", label: "Adjusting / opening line" }],
    render: (r) => <span onClick={(e) => e.stopPropagation()}>{r.action === "cleanup.test_credit"
      ? <ReasonButton me={me} action="cleanup.test_credit" params={{ firm_id: r.firm_id, target_paise: 1000000 }} label="Mark as test firm, set to ₹10,000" tone="danger" onDone={done}
          title={`${r.firm}: mark as a test firm and bring ${inr(r.balance)} to ₹10,000`} confirm="Do it" />
      : <ReasonButton me={me} action="ledger.fix" params={{ firm_id: r.firm_id }} label={r.issue === "no_ledger" ? "Add the opening line" : "Add the adjusting line"} onDone={done}
          title={`${r.firm}: one line of ${inr(Number(r.balance) - Number(r.ledger_sum))} so the ledger explains the balance`} confirm="Write the line" />}</span> },
];
function Cleanup({ me }) {
  const [n, setN] = useState(0);
  return (
    <Page title="Data clean-up" sub="Old data that does not look right. Nothing here happens by itself: each line is fixed only when an owner presses its button, with a reason, and it is in the change history.">
      <Tabs on="credit/cleanup" me={me} />
      <DataTable key={n} id="cleanup" action="cleanup.list" columns={CLEAN_COLUMNS(me, () => setN(n + 1))} me={me} exportName="cleanup" rowKey={(r) => r.firm_id + r.issue}
                 empty="Nothing to clean up." />
    </Page>
  );
}

// top-up and adjust, for a firm's page
export function TopUpButton({ me, firmId, onDone }) {
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  return (
    <ReasonButton me={me} action="credit.topup" params={{ firm_id: firmId, pay_mode: "bank", received_on: today }} label="Top up" tone="primary" onDone={onDone} confirm="Add the credit"
                  extra={(m, set) => (<>
                    <RupeeField label="Amount received (₹, at most 10,00,000)" m={m} set={set} k="amount_paise" testid="topup-amount" />
                    <label className="field"><span>Paid by</span>
                      <select className="input" value={m.pay_mode || "bank"} onChange={(e) => set({ ...m, pay_mode: e.target.value })} data-testid="topup-mode">
                        {PAY_MODES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                    <label className="field"><span>Payment reference (UTR, cheque no.…)</span>
                      <input className="input" value={m.pay_ref || ""} onChange={(e) => set({ ...m, pay_ref: e.target.value })} data-testid="topup-ref" /></label>
                    <label className="field"><span>Received on</span>
                      <input className="input" type="date" max={today} value={m.received_on || today} onChange={(e) => set({ ...m, received_on: e.target.value })} /></label>
                  </>)} />
  );
}
export function AdjustButton({ me, firmId, onDone }) {
  return (
    <MoneyButton me={me} action="credit.adjust" params={{ firm_id: firmId, category: "correction" }} label="Adjust" onDone={onDone} confirm="Adjust"
                 extra={(m, set) => (<>
                   <RupeeField label="Amount (₹; minus to take credit away)" m={m} set={set} k="amount_paise" allowNegative testid="adjust-amount" />
                   <label className="field"><span>Category</span>
                     <select className="input" value={m.category || "correction"} onChange={(e) => set({ ...m, category: e.target.value })}>
                       {CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                 </>)} />
  );
}

export const module = {
  id: "credit", label: "Credit", icon: Wallet, action: "ledger.list",
  routes: [
    { path: /^credit$/, render: (_, me) => <Ledger me={me} /> },
    { path: /^credit\/check$/, render: (_, me) => <Check me={me} /> },
    { path: /^credit\/cleanup$/, render: (_, me) => <Cleanup me={me} /> },
  ],
};
