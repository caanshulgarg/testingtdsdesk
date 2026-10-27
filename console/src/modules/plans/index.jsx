// Plans: the catalogue (create and edit: monthly and yearly price, per-client price, included clients and users,
// features, AI allowance in rupees, item allowances, on the website or not, retired). Saving goes through plan.save
// (migration 119's console_plan_save: a reason, audited before and after). The per-client price is its own field, so
// an edit can no longer drop it (review A8).
import { useEffect, useState } from "react";
import { Package } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, ErrorNote, Loading, Page, ReasonButton } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtDate } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";
import { inr, toPaise } from "../billing/common.jsx";

const ALLOWANCE_ITEMS = [
  { code: "bills", label: "Purchase bills" }, { code: "bank", label: "Bank statement lines" }, { code: "sales", label: "Sales invoices" },
  { code: "claude", label: "Reading by Claude" }, { code: "vision", label: "Google Vision pages" },
];
const COLUMNS = [
  { key: "name", label: "Plan", type: "text" },
  { key: "code", label: "Code", type: "text", phone: false },
  { key: "monthly", label: "Monthly", type: "number", align: "end", render: (r) => inr(r.monthly) },
  { key: "yearly", label: "Yearly", type: "number", align: "end", phone: false, render: (r) => inr(r.yearly) },
  { key: "per_client", label: "Per client", type: "number", align: "end", phone: false, render: (r) => inr(r.per_client) },
  { key: "included_clients", label: "Clients incl.", type: "number", align: "end", phone: false, render: (r) => r.included_clients ?? "No limit" },
  { key: "included_users", label: "Users incl.", type: "number", align: "end", phone: false, render: (r) => r.included_users ?? "No limit" },
  { key: "ai_allowance", label: "AI a month", type: "number", align: "end", phone: false, render: (r) => (r.ai_allowance_paise === -1 ? "Fair use" : inr(r.ai_allowance)) },
  { key: "firms", label: "Firms", type: "number", align: "end" },
  { key: "active", label: "Status", type: "bool", yes: "Active", no: "Retired", render: (r) => <Chip tone={r.active ? "good" : "neutral"}>{r.active ? "Active" : "Retired"}</Chip> },
  { key: "on_website", label: "On website", type: "bool", phone: false },
  { key: "updated_at", label: "Changed", type: "date", phone: false },
];
const PRESETS = [{ label: "Active", filters: { active: { op: "is", value: true } } }, { label: "Retired", filters: { active: { op: "is", value: false } } }, { label: "All", filters: {} }];

function Plans({ me }) {
  return (
    <Page title="Plans" sub="The plans firms can be on. A change applies from the next monthly run; firms on a retired plan keep it."
          actions={me.actions.includes("plan.save") && <a className="btn primary" href={href("plans/new")} data-testid="new-plan">New plan</a>}>
      <DataTable id="plans" action="plans.list" columns={COLUMNS} presets={PRESETS} defaultPreset={2} me={me} exportName="plans" onRow={(r) => go("plans/" + r.id)} />
    </Page>
  );
}

const rup = (p) => (p === null || p === undefined ? "" : String(p / 100));
function toForm(p) {
  const f = { name: p?.name || "", code: p?.code || "", note: p?.note || "", active: p ? p.active : true, on_website: !!p?.on_website, sort: String(p?.sort ?? 0),
    monthly: rup(p?.monthly_fee_paise ?? 0), yearly: rup(p?.yearly_fee_paise), per_client: rup(p?.per_client_fee_paise),
    included_clients: p?.included_clients ?? "", included_users: p?.included_users ?? "", fair_use: p?.ai_allowance_paise === -1,
    ai: p?.ai_allowance_paise === -1 ? "" : rup(p?.ai_allowance_paise), features: (p?.features || []).join("\n"), cloud: !!p?.includes?.cloud, items: {} };
  for (const it of ALLOWANCE_ITEMS) {
    const x = p?.includes?.[it.code];
    f.items[it.code] = !x ? { mode: "none", cap: "", after: "" } : x.cap === null || x.cap === undefined ? { mode: "unlimited", cap: "", after: "" } : { mode: "cap", cap: String(x.cap), after: x.price_after ?? "" };
  }
  return f;
}
// the form -> plan.save's p_plan, with the problems found (shown before anything is sent)
function toPlan(f, id) {
  const bad = [];
  const money = (t, what, nullable) => { const p = toPaise(t); if (p === null) { if (!nullable) bad.push(what); return nullable ? null : 0; } if (Number.isNaN(p) || p < 0) { bad.push(what); return 0; } return p; };
  const whole = (t, what) => { if (t === "" || t === null) return null; const n = Number(t); if (!Number.isInteger(n) || n < 0) { bad.push(what); return null; } return n; };
  const includes = {};
  for (const it of ALLOWANCE_ITEMS) {
    const x = f.items[it.code];
    if (x.mode === "unlimited") includes[it.code] = { cap: null };
    if (x.mode === "cap") {
      const cap = whole(x.cap, it.label + " allowance"), after = x.after === "" ? null : Number(x.after);
      if (cap === null) bad.push(it.label + " allowance");
      if (after !== null && (!isFinite(after) || after < 0)) bad.push(it.label + " price after");
      includes[it.code] = { cap, price_after: after };
    }
  }
  if (f.cloud) includes.cloud = { cap: null };
  const plan = {
    name: f.name.trim(), code: f.code.trim() || null, note: f.note, active: !!f.active, on_website: !!f.on_website, sort: whole(f.sort, "Order") ?? 0,
    monthly_fee_paise: money(f.monthly, "Monthly price", false), yearly_fee_paise: money(f.yearly, "Yearly price", true),
    per_client_fee_paise: money(f.per_client, "Per-client price", true), included_clients: whole(f.included_clients, "Included clients"),
    included_users: whole(f.included_users, "Included users"), ai_allowance_paise: f.fair_use ? -1 : money(f.ai, "AI allowance", true),
    features: f.features.split("\n").map((s) => s.trim()).filter(Boolean), includes,
  };
  if (plan.name.length < 2) bad.push("Name");
  if (id) plan.id = id;
  return { plan, bad };
}

function PlanEdit({ me, id }) {
  const isNew = id === "new";
  const { loading, data, error, reload } = useAction(isNew ? "plans.list" : "plan.get", isNew ? { size: 1 } : { plan_id: id });
  const [f, setF] = useState(null);
  useEffect(() => { if (isNew) setF(toForm(null)); else if (data) setF(toForm(data)); }, [data, isNew]);
  if (!f) return <Page title="Plan"><ErrorNote error={error} onRetry={reload} />{loading && <Loading />}</Page>;
  const can = me.actions.includes("plan.save");
  const set = (k, v) => setF({ ...f, [k]: v });
  const setItem = (code, k, v) => setF({ ...f, items: { ...f.items, [code]: { ...f.items[code], [k]: v } } });
  const { plan, bad } = toPlan(f, isNew ? null : id);
  const T = (k, label, extra = {}) => (
    <label className="field"><span>{label}</span><input className="input" value={f[k]} disabled={!can} data-field={k} onChange={(e) => set(k, e.target.value)} {...extra} /></label>);
  return (
    <Page title={isNew ? "New plan" : f.name || "Plan"} sub={<a href={href("plans")}>← All plans</a>}
          actions={can && (bad.length ? <span className="note note-warn small" role="note">Check: {bad.join(", ")}</span>
            : <ReasonButton me={me} action="plan.save" params={{ plan }} label={isNew ? "Create plan" : "Save plan"} tone="primary"
                            onDone={(d) => { if (isNew) go("plans/" + d.id); else reload(); }} />)}>
      <ErrorNote error={error} onRetry={reload} />
      {!isNew && data && <p className="muted">{data.firms} firm{data.firms === 1 ? "" : "s"} on this plan · changed {fmtDate(data.updated_at || data.created_at)}</p>}
      <section className="card"><h2>The plan</h2>
        <div className="form-grid">
          {T("name", "Name")}
          {T("code", "Code (for the website)", { placeholder: "small-firm" })}
          {T("sort", "Order in lists", { inputMode: "numeric" })}
          <label className="check"><input type="checkbox" checked={!!f.active} disabled={!can} onChange={(e) => set("active", e.target.checked)} data-field="active" /> Active (offered to firms)</label>
          <label className="check"><input type="checkbox" checked={!!f.on_website} disabled={!can} onChange={(e) => set("on_website", e.target.checked)} /> Shown on the website</label>
          <label className="field wide"><span>Note</span><input className="input" value={f.note} disabled={!can} onChange={(e) => set("note", e.target.value)} /></label>
        </div>
      </section>
      <section className="card"><h2>Price</h2>
        <div className="form-grid">
          {T("monthly", "Monthly price (₹, before GST)", { inputMode: "decimal" })}
          {T("yearly", "Yearly price (₹; blank: none)", { inputMode: "decimal" })}
          {T("per_client", "Per client a month (₹; blank: none)", { inputMode: "decimal" })}
          {T("included_clients", "Clients included (blank: no limit)", { inputMode: "numeric" })}
          {T("included_users", "Users included (blank: no limit)", { inputMode: "numeric" })}
          <div className="field"><span>AI allowance a month (₹)</span>
            <input className="input" value={f.ai} disabled={!can || f.fair_use} inputMode="decimal" data-field="ai" onChange={(e) => set("ai", e.target.value)} placeholder="blank: none" />
            <label className="check small"><input type="checkbox" checked={f.fair_use} disabled={!can} onChange={(e) => set("fair_use", e.target.checked)} /> Unlimited (fair use)</label></div>
        </div>
        <p className="small muted">Clients above the included number pay the per-client price; people above the included number pay the shared-data price unless the plan includes shared data. AI above the allowance is charged per use.</p>
      </section>
      <section className="card"><h2>What is included</h2>
        {ALLOWANCE_ITEMS.map((it) => { const x = f.items[it.code]; return (
          <div className="allow" key={it.code} data-item={it.code}>
            <span>{it.label}</span>
            <select className="input" value={x.mode} disabled={!can} onChange={(e) => setItem(it.code, "mode", e.target.value)} aria-label={it.label + " in the plan"}>
              <option value="none">Paid per use</option><option value="unlimited">Unlimited</option><option value="cap">Up to a number</option>
            </select>
            <input className="input" value={x.cap} disabled={!can || x.mode !== "cap"} inputMode="numeric" placeholder="a month" aria-label={it.label + " allowance"} onChange={(e) => setItem(it.code, "cap", e.target.value)} />
            <input className="input" value={x.after} disabled={!can || x.mode !== "cap"} inputMode="decimal" placeholder="₹ after" aria-label={it.label + " price after"} onChange={(e) => setItem(it.code, "after", e.target.value)} />
          </div>); })}
        <label className="check"><input type="checkbox" checked={f.cloud} disabled={!can} onChange={(e) => set("cloud", e.target.checked)} /> Shared data (per person) included</label>
      </section>
      <section className="card"><h2>Features (one a line, as on the website)</h2>
        <textarea className="input" rows={5} value={f.features} disabled={!can} onChange={(e) => set("features", e.target.value)} aria-label="Features" />
      </section>
    </Page>
  );
}

export const module = {
  id: "plans", label: "Plans", icon: Package, action: "plans.list",
  routes: [
    { path: /^plans$/, render: (_, me) => <Plans me={me} /> },
    { path: /^plans\/(new|[0-9a-f-]{36})$/, render: (m, me) => <PlanEdit me={me} id={m[1]} key={m[1]} /> },
  ],
};
