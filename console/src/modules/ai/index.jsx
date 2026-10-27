// The AI control centre (console phase 4; docs/CONSOLE-AI.md). Four tabs, one kill switch above them:
//   Usage     calls and cost by day, firm, feature and model; FinCom's cost against what firms were charged; top firms
//   Features  the registry: each AI feature's switch, model and price (Owner)
//   Plans     each plan's AI allowance a month and what happens after it (Owner, Billing)
//   Firms     each firm's AI this month, and FinCom's override for it: AI off, its own allowance, features off
// Every list is a DataTable (filters, presets, CSV); every change is a ReasonButton (a reason, audited, role-gated).
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, ErrorNote, Facts, Loading, Page, ReasonButton } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtNum, fmtTime } from "../../lib/format.js";
import { go, href, setQuery, useRoute } from "../../lib/route.js";
import { BarList, CostChargedChart, inr } from "./charts.jsx";
import "./ai.css";

const IST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const minus = (d, n) => new Date(Date.parse(d + "T00:00:00Z") - n * 86400000).toISOString().slice(0, 10);
const toPaise = (rupees) => (rupees === "" || rupees === null || rupees === undefined ? null : Math.round(Number(rupees) * 100));
const toRupees = (paise) => (paise === null || paise === undefined ? "" : String(Number(paise) / 100));
const AFTER = [{ value: "charge", label: "Charge per use" }, { value: "stop", label: "Stop AI" }];
const money = (r, k) => <span className={"ai-num" + (Number(r[k]) < 0 ? " ai-neg" : "")}>{inr(r[k])}</span>;

function Tabs({ at }) {
  const tabs = [["ai", "Usage"], ["ai/features", "Features"], ["ai/plans", "Plans"], ["ai/firms", "Firms"]];
  return <nav className="ai-tabs" aria-label="AI control centre">{tabs.map(([p, l]) => <a key={p} href={href(p)} aria-current={at === p ? "page" : undefined}>{l}</a>)}</nav>;
}

// "Stop all AI now": every AI function asks before each call (within about 15 seconds)
function KillSwitch({ me, ov, reload }) {
  const on = !!ov?.settings?.kill;
  return (
    <div className={"card ai-kill" + (on ? " on" : "")} data-testid="kill">
      <div>
        <strong>{on ? "All AI is stopped" : "AI is running"}</strong>
        <p className="muted">{on ? `Stopped${ov.settings.kill_reason ? ": “" + ov.settings.kill_reason + "”" : ""} · ${ov.settings.updated_by_email || ""} ${fmtTime(ov.settings.updated_at)}. Every feature answers “AI for <feature> is switched off by FinCom”.`
                                 : "Each feature follows its own switch below. Stopping takes effect within about 15 seconds, for every firm."}</p>
      </div>
      {on ? <ReasonButton me={me} action="ai.kill" params={{ on: false }} label="Switch AI back on" tone="primary" onDone={reload} />
          : <ReasonButton me={me} action="ai.kill" params={{ on: true }} label="Stop all AI now" tone="danger" onDone={reload} title="Stop all AI now" confirm="Stop all AI" />}
    </div>
  );
}

function Shell({ me, at, children }) {
  const { data: ov, error, reload } = useAction("ai.overview");
  return (
    <Page title="AI control centre" sub="Every AI feature in FinCom: switches, models, prices, allowances and what it costs.">
      <div className="ai-root">
        <ErrorNote error={error} onRetry={reload} />
        {ov && <KillSwitch me={me} ov={ov} reload={reload} />}
        <Tabs at={at} />
        {typeof children === "function" ? children(ov, reload) : children}
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- Usage
const USAGE_COLUMNS = (features) => [
  { key: "day", label: "Day", type: "date" },
  { key: "firm", label: "Firm", type: "text" },
  { key: "feature", label: "Feature", type: "select", options: features, render: (r) => r.feature_name || r.feature },
  { key: "model", label: "Model", type: "select", options: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5", "claude-opus-5", "whisper-large-v3", "whisper-large-v3-turbo", ""].map((m) => ({ value: m, label: m || "(not logged)" })), phone: false },
  { key: "calls", label: "Calls", type: "number", align: "end" },
  { key: "tokens_in", label: "Tokens in", type: "number", align: "end", phone: false },
  { key: "tokens_out", label: "Tokens out", type: "number", align: "end", phone: false },
  { key: "seconds", label: "Seconds", type: "number", align: "end", phone: false },
  { key: "cost_paise", label: "FinCom's cost", type: "number", align: "end", render: (r) => inr(r.cost_paise) },
  { key: "charged_paise", label: "Charged", type: "number", align: "end", render: (r) => inr(r.charged_paise), phone: false },
  { key: "margin_paise", label: "Margin", type: "number", align: "end", render: (r) => money(r, "margin_paise"), phone: false },
];
const USAGE_PRESETS = [
  { label: "All", filters: {} },
  { label: "Charged to firms", filters: { charged_paise: { op: "range", from: 1, to: null } } },
  { label: "Paid by FinCom", filters: { charged_paise: { op: "range", from: 0, to: 0 }, cost_paise: { op: "range", from: 1, to: null } } },
  { label: "Losing money", filters: { margin_paise: { op: "range", from: null, to: -1 } } },
];
const RANGES = [["7 days", 6], ["30 days", 29], ["90 days", 89], ["This year", 365]];

function Usage({ me }) {
  const route = useRoute();
  const today = IST();
  const to = route.query.get("ai.to") || today, from = route.query.get("ai.from") || minus(to, 29);
  const setRange = (f, t) => { const q = new URLSearchParams(route.query); q.set("ai.from", f); q.set("ai.to", t); q.delete("aiu.p"); setQuery(q); };
  let filters = {};
  try { filters = JSON.parse(route.query.get("aiu.f") || "{}") || {}; } catch { filters = {}; }
  const q = route.query.get("aiu.q") || "";
  const { data: s, loading, error, reload } = useAction("ai.usage.summary", { from, to, q, filters });
  const { data: ov } = useAction("ai.overview");
  const features = useMemo(() => (ov?.features || []).map((f) => ({ value: f.code, label: f.name })).concat([{ value: "other", label: "Other (not registered)" }]), [ov]);
  const t = s?.totals;
  return (
    <>
      <div className="ai-filters" role="group" aria-label="Date range">
        {RANGES.map(([l, n]) => <button key={l} className={"btn ghost" + (from === minus(today, n) && to === today ? " on" : "")} onClick={() => setRange(minus(today, n), today)}>{l}</button>)}
        <label className="field"><span>From</span><input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setRange(e.target.value, to)} data-testid="from" /></label>
        <label className="field"><span>To</span><input className="input" type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setRange(from, e.target.value)} data-testid="to" /></label>
      </div>
      <ErrorNote error={error} onRetry={reload} />
      {loading && !s && <Loading what="AI use" />}
      {s && (
        <div style={{ opacity: loading ? 0.6 : 1 }}>
          {s.truncated && <div className="note note-warn" role="note">More than 5,000 rows in this range: the newest 5,000 are shown and counted. Choose fewer days for every row.</div>}
          <div className="tiles" data-testid="ai-tiles">
            <div className="tile"><span className="tile-label">AI calls</span><span className="tile-value">{fmtNum(t.calls)}</span><span className="tile-sub">{fmtNum(t.firms)} firms{t.seconds ? ` · ${fmtNum(Math.round(t.seconds / 60))} min of audio` : ""}</span></div>
            <div className="tile"><span className="tile-label">FinCom's cost</span><span className="tile-value">{inr(t.cost_paise)}</span><span className="tile-sub">at provider prices (bill reading estimated)</span></div>
            <div className="tile"><span className="tile-label">Charged to firms</span><span className="tile-value">{inr(t.charged_paise)}</span><span className="tile-sub">bill reading and OCR today; the rest is included</span></div>
            <div className="tile"><span className="tile-label">Margin</span><span className={"tile-value" + (t.charged_paise - t.cost_paise < 0 ? " ai-neg" : "")}>{inr(t.charged_paise - t.cost_paise)}</span><span className="tile-sub">charged less cost</span></div>
          </div>
          <section className="card"><h2>FinCom's cost against what firms were charged</h2><CostChargedChart days={s.by_day} /></section>
          <div className="ai-grid2">
            <section className="card"><h2>Cost by feature</h2>
              <BarList testid="by-feature" rows={s.by_feature} label={(r) => r.name} value={(r) => r.cost_paise} sub={(r) => `${fmtNum(r.calls)} calls · charged ${inr(r.charged_paise)}`} />
            </section>
            <section className="card"><h2>Top firms by cost</h2>
              <BarList testid="top-firms" rows={s.top_firms} label={(r) => r.firm} value={(r) => r.cost_paise} sub={(r) => `${fmtNum(r.calls)} calls · charged ${inr(r.charged_paise)}`}
                       onRow={(r) => go("ai/firms", new URLSearchParams({ "aifm.q": r.firm }))} />
            </section>
            <section className="card"><h2>Cost by model</h2>
              <BarList testid="by-model" rows={s.by_model} label={(r) => r.model} value={(r) => r.cost_paise} sub={(r) => `${fmtNum(r.calls)} calls`} />
            </section>
          </div>
        </div>
      )}
      <section className="card">
        <h2>By day, firm, feature and model</h2>
        <p className="muted">The charts above follow this table's search and filters.</p>
        <DataTable id="aiu" action="ai.usage.list" params={{ from, to }} columns={USAGE_COLUMNS(features)} presets={USAGE_PRESETS} me={me} exportName="ai-usage" />
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Features
const ONOFF_PRESETS = [
  { label: "On", filters: { enabled: { op: "is", value: true } } },
  { label: "Off", filters: { enabled: { op: "is", value: false } } },
  { label: "All", filters: {} },
];
const FEATURE_COLUMNS = [
  { key: "name", label: "Feature", type: "text" },
  { key: "code", label: "Code", type: "text", phone: false },
  { key: "provider", label: "Provider", type: "select", options: ["anthropic", "google", "groq"], phone: false },
  { key: "model", label: "Model", type: "text", render: (r) => r.model || <span className="muted">{r.model_default || "its own choice"}</span>, phone: false },
  { key: "enabled", label: "Switch", type: "bool", yes: "On", no: "Off", render: (r) => <Chip tone={r.enabled ? "good" : "bad"}>{r.enabled ? "On" : "Off"}</Chip> },
  { key: "price_mode", label: "Priced", type: "select", options: [{ value: "included", label: "Included" }, { value: "per_use", label: "Per use" }, { value: "per_token", label: "Per token" }], phone: false },
  { key: "price_per_use_paise", label: "Price a use", type: "number", align: "end", render: (r) => (r.price_mode === "per_use" ? inr(r.price_per_use_paise) : "–"), phone: false },
  { key: "billing_item", label: "Billing item", type: "text", phone: false },
  { key: "counts_against_allowance", label: "From allowance", type: "bool", phone: false },
  { key: "updated_at", label: "Changed", type: "date", phone: false },
];
function Features({ me }) {
  return <DataTable id="aif" action="ai.features.list" columns={FEATURE_COLUMNS} presets={ONOFF_PRESETS} defaultPreset={2} me={me} exportName="ai-features" rowKey="code" onRow={(r) => go("ai/features/" + r.code)} />;
}

function Feature({ me, code }) {
  const { data: ov, loading, error, reload } = useAction("ai.overview");
  const f = (ov?.features || []).find((x) => x.code === code);
  if (loading && !ov) return <Loading />;
  if (!f) return <ErrorNote error={error || "That AI feature is not in the registry."} onRetry={reload} />;
  const fields = (m, set) => {
    const v = (k) => (k in m ? m[k] : f[k]);
    return (
      <div className="ai-form">
        <label className="ai-check"><input type="checkbox" checked={!!v("enabled")} onChange={(e) => set({ ...m, enabled: e.target.checked })} /> On</label>
        <label className="ai-check"><input type="checkbox" checked={!!v("counts_against_allowance")} onChange={(e) => set({ ...m, counts_against_allowance: e.target.checked })} /> Counts against the plan's AI allowance</label>
        {f.model_settable && (
          <label className="field"><span>Model</span>
            <select className="input" value={v("model") || ""} onChange={(e) => set({ ...m, model: e.target.value || null })}>
              <option value="">The function's own choice ({f.model_default})</option>
              {(f.models_allowed || []).map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        )}
        {!f.billing_item && (
          <>
            <label className="field"><span>Priced to the firm</span>
              <select className="input" value={v("price_mode")} onChange={(e) => set({ ...m, price_mode: e.target.value })}>
                <option value="included">Included (not charged)</option><option value="per_use">Per use</option><option value="per_token">Per million tokens</option>
              </select>
            </label>
            {v("price_mode") === "per_use" && <label className="field"><span>Price a use (₹)</span><input className="input" type="number" min="0" step="0.01" value={toRupees(v("price_per_use_paise"))} onChange={(e) => set({ ...m, price_per_use_paise: toPaise(e.target.value) ?? 0 })} /></label>}
            {v("price_mode") === "per_token" && <>
              <label className="field"><span>₹ a million input tokens</span><input className="input" type="number" min="0" step="0.01" value={toRupees(v("price_in_mtok_paise"))} onChange={(e) => set({ ...m, price_in_mtok_paise: toPaise(e.target.value) ?? 0 })} /></label>
              <label className="field"><span>₹ a million output tokens</span><input className="input" type="number" min="0" step="0.01" value={toRupees(v("price_out_mtok_paise"))} onChange={(e) => set({ ...m, price_out_mtok_paise: toPaise(e.target.value) ?? 0 })} /></label>
            </>}
          </>
        )}
        <label className="field"><span>FinCom's cost a use (₹, for the dashboard where usage is not logged)</span><input className="input" type="number" min="0" step="0.01" value={toRupees(v("cost_per_use_paise"))} onChange={(e) => set({ ...m, cost_per_use_paise: toPaise(e.target.value) ?? 0 })} /></label>
      </div>
    );
  };
  return (
    <>
      <p><a href={href("ai/features")}>← All features</a></p>
      <section className="card">
        <h2>{f.name} <Chip tone={f.enabled ? "good" : "bad"}>{f.enabled ? "On" : "Off"}</Chip></h2>
        <p className="muted">{f.description}</p>
        <Facts items={[["Code", f.code], ["Provider", f.provider], ["Model", f.model || "its own choice: " + f.model_default], ["Where in the code", f.where_in_code],
          ["Priced", f.billing_item ? `by the billing item “${f.billing_item}”: ${inr(f.price_per_use_paise)} a use (change it in Prices)` : f.price_mode === "included" ? "included" : f.price_mode === "per_use" ? inr(f.price_per_use_paise) + " a use" : `${inr(f.price_in_mtok_paise)} / ${inr(f.price_out_mtok_paise)} a million tokens in / out`],
          ["FinCom's cost a use", f.cost_per_use_paise ? inr(f.cost_per_use_paise) : "from the logged usage"], ["Counts against the allowance", f.counts_against_allowance ? "Yes" : "No"],
          ["Changed", f.updated_by_email ? `${fmtTime(f.updated_at)} by ${f.updated_by_email}` : fmtTime(f.updated_at)]]} />
        <div className="row-end">
          <ReasonButton me={me} action="ai.feature.set" params={{ code: f.code, enabled: f.enabled }} label="Change" tone="primary" title={"Change " + f.name} confirm="Save" extra={fields} onDone={reload} />
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- Plans
const PLAN_COLUMNS = [
  { key: "plan", label: "Plan", type: "text" },
  { key: "allowance_paise", label: "AI allowance a month", type: "number", align: "end", render: (r) => (r.allowance_paise === null || r.allowance_paise === undefined ? <span className="muted">No limit</span> : inr(r.allowance_paise)) },
  { key: "after_allowance", label: "After it", type: "select", options: AFTER },
  { key: "set", label: "Set here", type: "bool" },
  { key: "firms", label: "Firms", type: "number", align: "end" },
  { key: "updated_at", label: "Changed", type: "date", phone: false },
];
function Plans({ me }) {
  const [pick, setPick] = useState(null);
  const [ver, setVer] = useState(0);         // a change: the list is read again
  return (
    <>
      <p className="muted">How much AI each plan includes a month, at FinCom's cost, and what happens once it is used up. No limit is today's behaviour. A firm's own setting (Firms) wins over its plan's.</p>
      <DataTable key={ver} id="aip" action="ai.plans.list" columns={PLAN_COLUMNS} presets={[{ label: "All", filters: {} }, { label: "With a limit", filters: { set: { op: "is", value: true } } }]} me={me} exportName="ai-plans" rowKey="plan_id" onRow={setPick} />
      {pick && <PlanEdit me={me} p={pick} onDone={() => setPick(null)} onSaved={() => { setPick(null); setVer((v) => v + 1); }} />}
    </>
  );
}
function PlanEdit({ me, p, onDone, onSaved }) {
  const extra = (m, set) => (
    <div className="ai-form">
      <label className="field"><span>AI allowance a month (₹; empty: no limit)</span><input className="input" type="number" min="0" step="1" value={"allowance" in m ? m.allowance : toRupees(p.allowance_paise)} onChange={(e) => set({ ...m, allowance: e.target.value, allowance_paise: toPaise(e.target.value) })} /></label>
      <label className="field"><span>After it is used up</span><select className="input" value={m.after_allowance || p.after_allowance || "charge"} onChange={(e) => set({ ...m, after_allowance: e.target.value })}>{AFTER.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
    </div>
  );
  return (
    <section className="card" data-testid="plan-edit">
      <h2>{p.plan}</h2>
      <p className="muted">{p.allowance_paise === null || p.allowance_paise === undefined ? "No AI limit." : `${inr(p.allowance_paise)} of AI a month, then ${p.after_allowance === "stop" ? "AI stops" : "charged per use"}.`} {fmtNum(p.firms)} firms on this plan.</p>
      <div className="row-end">
        <button className="btn ghost" onClick={onDone}>Close</button>
        <ReasonButton me={me} action="ai.plan.set" params={{ plan_id: p.plan_id, allowance_paise: p.allowance_paise ?? null, after_allowance: p.after_allowance || "charge" }} label="Change allowance" tone="primary" extra={extra} onDone={onSaved} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Firms
const FIRM_COLUMNS = [
  { key: "firm", label: "Firm", type: "text" },
  { key: "plan", label: "Plan", type: "select", options: ["Pay as you go", "Per client", "Monthly with Claude and Vision extra", "Monthly, all included"] },
  { key: "ai_off", label: "AI", type: "bool", yes: "Off", no: "On", render: (r) => <Chip tone={r.ai_off ? "bad" : "good"}>{r.ai_off ? "Off" : "On"}</Chip> },
  { key: "features_off", label: "Features off", type: "text", phone: false },
  { key: "spent_paise", label: "Spent this month", type: "number", align: "end", render: (r) => inr(r.spent_paise) },
  { key: "allowance_paise", label: "Allowance", type: "number", align: "end", render: (r) => (r.allowance_paise === null || r.allowance_paise === undefined ? <span className="muted">No limit</span> : inr(r.allowance_paise)) },
  { key: "allowance_from", label: "From", type: "select", options: [{ value: "firm", label: "The firm's own" }, { value: "plan", label: "The plan" }, { value: "none", label: "None" }], phone: false },
  { key: "after_allowance", label: "After it", type: "select", options: AFTER, phone: false },
  { key: "over", label: "Used up", type: "bool", phone: false },
  { key: "calls", label: "Calls", type: "number", align: "end", phone: false },
  { key: "owner_switch", label: "Owner's switch", type: "bool", phone: false, render: (r) => (r.owner_switch === false ? "Off" : "On") },
  { key: "owner_cap_paise", label: "Owner's cap", type: "number", align: "end", phone: false, render: (r) => (r.owner_cap_paise ? inr(r.owner_cap_paise) : "₹3,000 (default)") },
];
const FIRM_PRESETS = [
  { label: "All", filters: {} },
  { label: "AI off", filters: { ai_off: { op: "is", value: true } } },
  { label: "Used up", filters: { over: { op: "is", value: true } } },
  { label: "Own allowance", filters: { allowance_from: { op: "in", values: ["firm"] } } },
];
function Firms({ me, ov }) {
  const [pick, setPick] = useState(null);
  const [ver, setVer] = useState(0);
  return (
    <>
      <p className="muted">Each firm's AI this month. FinCom's switches here come first; the firm owner's own switch and cap (in the app) still apply below them.</p>
      <DataTable key={ver} id="aifm" action="ai.firms.list" columns={FIRM_COLUMNS} presets={FIRM_PRESETS} me={me} exportName="ai-firms" rowKey="firm_id" onRow={setPick} />
      {pick && <FirmEdit me={me} f={pick} features={ov?.features || []} onDone={() => setPick(null)} onSaved={() => { setPick(null); setVer((v) => v + 1); }} />}
    </>
  );
}
function FirmEdit({ me, f, features, onDone, onSaved }) {
  const offNow = (f.features_off || "").split(", ").filter(Boolean);
  const own = f.allowance_from === "firm";
  const extra = (m, set) => {
    const offs = m.features_off || offNow;
    return (
      <>
        <label className="ai-check"><input type="checkbox" checked={"ai_off" in m ? m.ai_off : !!f.ai_off} onChange={(e) => set({ ...m, ai_off: e.target.checked })} data-testid="firm-ai-off" /> AI off for this firm</label>
        <div className="ai-form">
          <label className="field"><span>The firm's own allowance a month (₹; empty: the plan's)</span><input className="input" type="number" min="0" step="1" value={"allowance" in m ? m.allowance : own ? toRupees(f.allowance_paise) : ""} onChange={(e) => set({ ...m, allowance: e.target.value, allowance_paise: toPaise(e.target.value) })} /></label>
          <label className="field"><span>After it is used up</span><select className="input" value={"after_allowance" in m ? m.after_allowance || "" : own ? f.after_allowance || "" : ""} onChange={(e) => set({ ...m, after_allowance: e.target.value || null })}><option value="">As the plan says</option>{AFTER.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
        </div>
        <fieldset className="field"><span className="f-label">Features off for this firm only</span>
          <div className="ai-checks">{features.map((x) => (
            <label key={x.code} className="ai-check"><input type="checkbox" checked={offs.includes(x.code)} onChange={(e) => set({ ...m, features_off: e.target.checked ? [...offs, x.code] : offs.filter((c) => c !== x.code) })} /> {x.name}</label>
          ))}</div>
        </fieldset>
      </>
    );
  };
  return (
    <section className="card" data-testid="firm-edit">
      <h2>{f.firm}</h2>
      <Facts items={[["Plan", f.plan || "No plan"], ["Spent this month", inr(f.spent_paise)], ["Allowance", f.allowance_paise === null || f.allowance_paise === undefined ? "No limit" : `${inr(f.allowance_paise)} (${f.allowance_from === "firm" ? "the firm's own" : "the plan's"})`],
        ["AI", f.ai_off ? "Off (FinCom)" : "On"], ["Features off", f.features_off || "None"], ["Owner's own switch", f.owner_switch === false ? "Off" : "On"]]} />
      <div className="row-end">
        <button className="btn ghost" onClick={onDone}>Close</button>
        <ReasonButton me={me} action="ai.firm.set" label="Change AI for this firm" tone="primary" extra={extra} onDone={onSaved} title={"AI for " + f.firm}
                      params={{ firm_id: f.firm_id, ai_off: !!f.ai_off, allowance_paise: own ? f.allowance_paise : null, after_allowance: own ? f.after_allowance : null, features_off: offNow }} />
      </div>
    </section>
  );
}

export const module = {
  id: "ai", label: "AI", icon: Sparkles, action: "ai.overview",
  routes: [
    { path: /^ai$/, render: (_, me) => <Shell me={me} at="ai"><Usage me={me} /></Shell> },
    { path: /^ai\/features$/, render: (_, me) => <Shell me={me} at="ai/features"><Features me={me} /></Shell> },
    { path: /^ai\/features\/([a-z0-9_]{2,40})$/, render: (m, me) => <Shell me={me} at="ai/features"><Feature me={me} code={m[1]} key={m[1]} /></Shell> },
    { path: /^ai\/plans$/, render: (_, me) => <Shell me={me} at="ai/plans"><Plans me={me} /></Shell> },
    { path: /^ai\/firms$/, render: (_, me) => <Shell me={me} at="ai/firms">{(ov) => <Firms me={me} ov={ov} />}</Shell> },
  ],
};
