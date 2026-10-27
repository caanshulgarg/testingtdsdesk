// Prices: the standard price of every metered item (bill reading per model, AI assistant, voice minutes, OTP,
// e-invoice, e-way bill and today's items). Versioned: a new price starts on a date (today or later, never backwards);
// the history stays. Owner and Billing change prices (price.set, audited); everyone else reads.
import { Tag } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { ErrorNote, Facts, Loading, Page, ReasonButton } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtDate, fmtTime } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";
import { inr, inrPaise, RupeeField } from "../billing/common.jsx";

const KIND = [{ value: "usage", label: "Per use" }, { value: "ai", label: "AI" }, { value: "monthly", label: "Monthly" }];
const COLUMNS = [
  { key: "title", label: "Item", type: "text" },
  { key: "code", label: "Code", type: "text", phone: false },
  { key: "unit", label: "Unit", type: "text", phone: false },
  { key: "kind", label: "Kind", type: "select", options: KIND },
  { key: "price", label: "Price now", type: "number", align: "end", render: (r) => (r.price === null ? <span className="muted">Not set</span> : inr(r.price)) },
  { key: "since", label: "Since", type: "date", phone: false },
  { key: "next_price", label: "Next price", type: "number", align: "end", phone: false, render: (r) => (r.next_price === null ? "–" : inr(r.next_price)) },
  { key: "next_from", label: "From", type: "date", phone: false },
  { key: "versions", label: "Versions", type: "number", align: "end", phone: false },
  { key: "firm_prices", label: "Firm prices", type: "number", align: "end", phone: false },
  { key: "active", label: "Active", type: "bool", phone: false },
];
const PRESETS = [{ label: "All", filters: {} }, { label: "AI", filters: { kind: { op: "in", values: ["ai"] } } }, { label: "Per use", filters: { kind: { op: "in", values: ["usage"] } } }];
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export function SetPrice({ me, item, onDone, label = "Set a new price" }) {
  return (
    <ReasonButton me={me} action="price.set" params={{ item, effective_from: today() }} label={label} tone="primary" onDone={onDone}
                  extra={(m, set) => (<>
                    <RupeeField label="Price (₹, before GST)" m={m} set={set} k="price_paise" testid="price-input" />
                    <label className="field"><span>Starts on (today or later)</span>
                      <input className="input" type="date" min={today()} value={m.effective_from || today()} onChange={(e) => set({ ...m, effective_from: e.target.value })} data-testid="price-from" /></label>
                  </>)} />
  );
}
function Prices({ me }) {
  return (
    <Page title="Prices" sub="The standard price list for metered items. A new price starts on a date and never changes charges already made. A firm's own price (Firms › Prices) wins over these.">
      <DataTable id="prices" action="prices.list" columns={COLUMNS} presets={PRESETS} me={me} exportName="prices" rowKey="code" onRow={(r) => go("prices/" + r.code)} />
    </Page>
  );
}
function Price({ me, code }) {
  const list = useAction("prices.list", { q: code, size: 100 });
  const hist = useAction("price.history", { item: code });
  const p = (list.data?.rows || []).find((r) => r.code === code);
  const reload = () => { list.reload(); hist.reload(); };
  return (
    <Page title={p?.title || code} sub={<a href={href("prices")}>← All prices</a>} actions={<SetPrice me={me} item={code} onDone={reload} />}>
      <ErrorNote error={list.error || hist.error} onRetry={reload} />
      {(list.loading && !p) && <Loading />}
      {p && <Facts items={[["Price now", p.price === null ? "Not set" : inr(p.price)], ["Unit", p.unit], ["Since", fmtDate(p.since)],
                           ["Next", p.next_price === null ? "–" : `${inr(p.next_price)} from ${fmtDate(p.next_from)}`], ["Code", p.code]]} />}
      <section className="card"><h2>History</h2>
        <ul className="list" data-testid="price-history">
          {(hist.data || []).map((h) => <li key={h.id}><span>{inrPaise(h.price_paise)} from {fmtDate(h.effective_from)}</span><span className="muted">{h.reason || ""} · {h.set_by || "before the console"} · {fmtTime(h.set_at)}</span></li>)}
          {hist.data && hist.data.length === 0 && <li className="muted">No price yet.</li>}
        </ul>
      </section>
    </Page>
  );
}
export const module = {
  id: "prices", label: "Prices", icon: Tag, action: "prices.list",
  routes: [
    { path: /^prices$/, render: (_, me) => <Prices me={me} /> },
    { path: /^prices\/([a-z][a-z0-9_]{1,39})$/, render: (m, me) => <Price me={me} code={m[1]} key={m[1]} /> },
  ],
};
