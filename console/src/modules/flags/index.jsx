// Feature flags: every flag with its default and rules; a flag's rules (a plan's or a firm's own value, with an end
// date); and for any firm, what each flag is and why. Owner changes them.
import { useState } from "react";
import { Flag } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, ErrorNote, Facts, Loading, Page, ReasonButton } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtDate, fmtTime } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";

const OnOff = ({ v }) => <Chip tone={v ? "good" : "neutral"} testid="flag-value">{v ? "On" : "Off"}</Chip>;
const COLUMNS = [
  { key: "key", label: "Flag", type: "text", render: (r) => <code>{r.key}</code> },
  { key: "description", label: "What it does", type: "text" },
  { key: "default_on", label: "Default", type: "bool", yes: "On", no: "Off", render: (r) => <OnOff v={r.default_on} /> },
  { key: "rules", label: "Rules", type: "number", align: "end" },
  { key: "firms_on", label: "Firms on", type: "number", align: "end", render: (r) => `${r.firms_on} of ${r.firms}` },
  { key: "updated_at", label: "Changed", type: "date", phone: false },
  { key: "updated_by_email", label: "Changed by", type: "text", phone: false },
];
const RULE_COLUMNS = (me, keyName, reload) => [
  { key: "scope", label: "For", type: "select", options: [{ value: "plan", label: "Plan" }, { value: "firm", label: "Firm" }] },
  { key: "target", label: "Plan or firm", type: "text" },
  { key: "value", label: "Value", type: "bool", yes: "On", no: "Off", render: (r) => <OnOff v={r.value} /> },
  { key: "until", label: "Until", type: "date", render: (r) => (r.until ? fmtDate(r.until) : "No end") },
  { key: "ended", label: "Ended", type: "bool", phone: false },
  { key: "note", label: "Note", type: "text", phone: false },
  { key: "updated_at", label: "Changed", type: "date", phone: false },
  { key: "updated_by_email", label: "By", type: "text", hidden: true },
  { key: "actions", label: "", type: "text", filter: false, sortable: false,
    render: (r) => <span onClick={(e) => e.stopPropagation()}><ReasonButton me={me} action="flags.rule_remove" params={{ rule_id: r.id, key: keyName }} label="Remove" tone="danger" title="Remove this rule" confirm="Remove" onDone={reload} /></span> },
];
const FIRM_COLUMNS = [
  { key: "key", label: "Flag", type: "text", render: (r) => <code>{r.key}</code> },
  { key: "value", label: "Value", type: "bool", yes: "On", no: "Off", render: (r) => <OnOff v={r.value} /> },
  { key: "why", label: "Why", type: "select", options: [{ value: "firm", label: "The firm's rule" }, { value: "plan", label: "Its plan's rule" }, { value: "default", label: "The default" }] },
  { key: "until", label: "Until", type: "date" },
];

const flagFields = (isNew) => (m, set) => (
  <>
    {isNew && <label className="field"><span>Key (lower case, e.g. zoho_books)</span><input className="input" value={m.key || ""} onChange={(e) => set({ ...m, key: e.target.value.trim() })} data-testid="flag-key" required /></label>}
    <label className="field"><span>What it does</span><input className="input" value={m.description ?? ""} onChange={(e) => set({ ...m, description: e.target.value })} data-testid="flag-desc" /></label>
    <label className="field"><span>Default</span>
      <select className="input" value={String(m.default_on ?? false)} onChange={(e) => set({ ...m, default_on: e.target.value === "true" })} data-testid="flag-default">
        <option value="false">Off</option><option value="true">On</option></select></label>
  </>
);

function Flags({ me }) {
  const [firm, setFirm] = useState("");
  const firms = useAction(me.actions.includes("announcements.choices") ? "announcements.choices" : "me");
  return (
    <Page title="Feature flags" sub="Switch a feature on or off for every firm, for a plan, or for one firm. The user app reads them once and keeps them."
          actions={<ReasonButton me={me} action="flags.save" params={{ default_on: false }} label="New flag" title="New feature flag" confirm="Make" extra={flagFields(true)} onDone={(d) => go("flags/" + d.key)} />}>
      <DataTable id="flags" action="flags.list" columns={COLUMNS} presets={[{ label: "All", filters: {} }, { label: "On by default", filters: { default_on: { op: "is", value: true } } }, { label: "With rules", filters: { rules: { op: "range", from: 1, to: null } } }]}
                 me={me} exportName="flags" rowKey="key" onRow={(r) => go("flags/" + r.key)} />
      <section className="card">
        <h2>For one firm</h2>
        {firms.data?.firms ? (
          <label className="field"><span>Firm</span>
            <select className="input" value={firm} onChange={(e) => setFirm(e.target.value)} data-testid="flag-firm"><option value="">Choose a firm…</option>
              {firms.data.firms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        ) : <p className="muted small">Open a firm and choose “Feature flags” there.</p>}
        {firm && <DataTable id="ff" action="flags.for_firm" params={{ firm_id: firm }} columns={FIRM_COLUMNS} me={me} rowKey="key" exportName="firm-flags" />}
      </section>
    </Page>
  );
}

function FlagPage({ me, k }) {
  const { loading, data: f, error, reload } = useAction("flag.get", { key: k });
  const choices = useAction(me.actions.includes("announcements.choices") ? "announcements.choices" : "me");
  const [n, setN] = useState(0);
  const again = () => { reload(); setN(n + 1); };
  if (loading && !f) return <Page title="Flag"><Loading /></Page>;
  if (!f) return <Page title="Flag"><ErrorNote error={error} onRetry={reload} /></Page>;
  const ruleFields = (m, set) => {
    const list = m.scope === "plan" ? choices.data?.plans || [] : choices.data?.firms || [];
    return (
      <>
        <label className="field"><span>For</span>
          <select className="input" value={m.scope || "firm"} onChange={(e) => set({ ...m, scope: e.target.value, target_id: "" })} data-testid="rule-scope"><option value="firm">One firm</option><option value="plan">A plan</option></select></label>
        <label className="field"><span>{(m.scope || "firm") === "plan" ? "Plan" : "Firm"}</span>
          <select className="input" value={m.target_id || ""} onChange={(e) => set({ ...m, target_id: e.target.value })} data-testid="rule-target" required>
            <option value="">Choose…</option>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="field"><span>Value</span>
          <select className="input" value={String(m.value ?? true)} onChange={(e) => set({ ...m, value: e.target.value === "true" })} data-testid="rule-value"><option value="true">On</option><option value="false">Off</option></select></label>
        <label className="field"><span>Until (empty: no end)</span><input className="input" type="date" value={m.until_day || ""} onChange={(e) => set({ ...m, until_day: e.target.value, until: e.target.value ? new Date(e.target.value + "T23:59:59+05:30").toISOString() : null })} /></label>
        <label className="field"><span>Note</span><input className="input" value={m.note || ""} onChange={(e) => set({ ...m, note: e.target.value })} /></label>
      </>
    );
  };
  return (
    <Page title={<code>{f.key}</code>} sub={<a href={href("flags")}>← All flags</a>}
          actions={<>
            <ReasonButton me={me} action="flags.save" params={{ key: f.key, description: f.description, default_on: f.default_on }} label="Change" title={"Change " + f.key} confirm="Save" extra={flagFields(false)} onDone={again} />
            <ReasonButton me={me} action="flags.rule_set" params={{ key: f.key, scope: "firm", value: true }} label="Add a rule" tone="primary" title="A plan's or a firm's own value" confirm="Save rule" extra={ruleFields} onDone={again} />
          </>}>
      <ErrorNote error={error} onRetry={reload} />
      <p>{f.description || <span className="muted">No description.</span>}</p>
      <Facts items={[["Default", f.default_on ? "On" : "Off"], ["Firms on now", `${f.firms_on} of ${f.firms}`], ["Active rules", f.rules], ["Changed", fmtTime(f.updated_at)], ["Changed by", f.updated_by_email || "–"]]} />
      <section className="card">
        <h2>Rules</h2>
        <p className="muted small">A firm's rule beats its plan's rule, which beats the default. A rule past its end date counts for nothing.</p>
        <DataTable key={n} id="rules" action="flags.rules" params={{ key: f.key }} columns={RULE_COLUMNS(me, f.key, again)} me={me} exportName={"flag-" + f.key} empty="No rules: every firm has the default." />
      </section>
    </Page>
  );
}

export const module = {
  id: "flags", label: "Feature flags", icon: Flag, action: "flags.list",
  routes: [
    { path: /^flags$/, render: (_, me) => <Flags me={me} /> },
    { path: /^flags\/([a-z][a-z0-9_.]{1,60})$/, render: (m, me) => <FlagPage me={me} k={m[1]} key={m[1]} /> },
  ],
};
