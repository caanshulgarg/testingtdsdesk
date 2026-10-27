// Announcements to firms: a list, a form (draft or publish), a preview of the bar the firms see, and End.
import { useEffect, useMemo, useState } from "react";
import { Megaphone } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, ErrorNote, Facts, Loading, Page, ReasonButton } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { fmtTime } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";

export const SEVERITY = [{ value: "info", label: "Info" }, { value: "warning", label: "Warning" }, { value: "urgent", label: "Urgent" }];
const AUDIENCE = [{ value: "all", label: "All firms" }, { value: "plans", label: "Firms on chosen plans" }, { value: "firms", label: "Chosen firms" }];
const STATE = [{ value: "draft", label: "Draft" }, { value: "scheduled", label: "Scheduled" }, { value: "live", label: "Live" }, { value: "ended", label: "Ended" }];
const tone = (s) => ({ live: "good", scheduled: "warn", draft: "neutral", ended: "neutral" }[s] || "neutral");
const sevTone = (s) => ({ urgent: "bad", warning: "warn" }[s] || "neutral");
const COLUMNS = [
  { key: "title", label: "Title", type: "text" },
  { key: "severity", label: "Severity", type: "select", options: SEVERITY, render: (r) => <Chip tone={sevTone(r.severity)}>{r.severity}</Chip> },
  { key: "state", label: "State", type: "select", options: STATE, render: (r) => <Chip tone={tone(r.state)} testid="ann-state">{(STATE.find((s) => s.value === r.state) || {}).label || r.state}</Chip> },
  { key: "audience", label: "Audience", type: "select", options: AUDIENCE, phone: false },
  { key: "starts_at", label: "Starts", type: "date" },
  { key: "ends_at", label: "Ends", type: "date", phone: false },
  { key: "firms_reached", label: "Firms", type: "number", align: "end", phone: false },
  { key: "dismissed", label: "Dismissed", type: "number", align: "end", phone: false },
  { key: "dismissible", label: "Dismissible", type: "bool", phone: false },
  { key: "created_by_email", label: "Made by", type: "text", phone: false },
  { key: "updated_at", label: "Changed", type: "date", hidden: true },
];
const PRESETS = [
  { label: "Live", filters: { state: { op: "in", values: ["live", "scheduled"] } } },
  { label: "Drafts", filters: { state: { op: "in", values: ["draft"] } } },
  { label: "Ended", filters: { state: { op: "in", values: ["ended"] } } },
  { label: "All", filters: {} },
];

function List({ me }) {
  return (
    <Page title="Announcements" sub="Messages to firms. The user app shows the live ones for a person's firm as one bar they can dismiss."
          actions={me.actions.includes("announcements.save") && <a className="btn primary" href={href("announcements/new")} data-testid="ann-new">New announcement</a>}>
      <DataTable id="ann" action="announcements.list" columns={COLUMNS} presets={PRESETS} defaultPreset={3} me={me} exportName="announcements" onRow={(r) => go("announcements/" + r.id)} />
    </Page>
  );
}

// the bar as a firm sees it (the same words and colours as the user app's)
export function Preview({ a }) {
  if (!a.title) return null;
  return (
    <div className={"ann-bar ann-" + (a.severity || "info")} role="note" data-testid="ann-preview">
      <span className="ann-dot" aria-hidden="true" />
      <span className="ann-text"><b>{a.title}</b>{a.body ? " " + a.body : ""}</span>
      {a.dismissible !== false && <span className="ann-x" aria-hidden="true">✕</span>}
    </div>
  );
}

const local = (iso) => { if (!iso) return ""; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const iso = (v) => (v ? new Date(v).toISOString() : null);

function Form({ me, id }) {
  const existing = useAction(id ? "announcement.get" : "me", id ? { id } : {});
  const choices = useAction(me.actions.includes("announcements.choices") ? "announcements.choices" : "me");
  const [f, setF] = useState(null);
  const [firmQ, setFirmQ] = useState("");
  useEffect(() => {
    if (id && existing.data && !f) {
      const a = existing.data;
      setF({ title: a.title, body: a.body, severity: a.severity, audience: a.audience, plan_ids: a.plan_ids || [], firm_ids: a.firm_ids || [], starts_at: local(a.starts_at), ends_at: local(a.ends_at), dismissible: a.dismissible, state: a.state, status: a.status });
    }
    if (!id && !f) setF({ title: "", body: "", severity: "info", audience: "all", plan_ids: [], firm_ids: [], starts_at: "", ends_at: "", dismissible: true });
  }, [existing.data]);
  const firms = useMemo(() => (choices.data?.firms || []).filter((x) => !firmQ || x.name.toLowerCase().includes(firmQ.toLowerCase()) || f?.firm_ids.includes(x.id)).slice(0, 200), [choices.data, firmQ, f?.firm_ids]);
  if (!f) return <Page title="Announcement"><ErrorNote error={existing.error} /><Loading /></Page>;
  const a = existing.data;
  const set = (k, v) => setF({ ...f, [k]: v });
  const tog = (k, v) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);
  const params = { id: id || undefined, title: f.title, body: f.body, severity: f.severity, audience: f.audience, plan_ids: f.plan_ids, firm_ids: f.firm_ids,
                   starts_at: iso(f.starts_at), ends_at: iso(f.ends_at), dismissible: f.dismissible };
  const ended = a && a.status === "ended";
  const done = (d) => go("announcements/" + d.id);
  return (
    <Page title={id ? a?.title || "Announcement" : "New announcement"} sub={<a href={href("announcements")}>← All announcements</a>}
          actions={!ended && <>
            <ReasonButton me={me} action="announcements.save" params={{ ...params, status: "draft" }} label="Save as draft" title="Save as a draft (not shown to firms)" confirm="Save draft" onDone={done} />
            <ReasonButton me={me} action="announcements.save" params={{ ...params, status: "live" }} label={a?.status === "live" ? "Save changes" : "Publish"} tone="primary"
                          title={f.audience === "all" ? "Publish to ALL firms" : "Publish"} confirm="Publish" onDone={done} />
            {a && <ReasonButton me={me} action="announcements.end" params={{ id }} label="End now" tone="danger" title="End this announcement" confirm="End" onDone={() => existing.reload()} />}
          </>}>
      <ErrorNote error={existing.error || choices.error} />
      {a && <div className="chips"><Chip tone={tone(a.state)} testid="ann-state">{a.state}</Chip><span className="muted">{a.firms_reached} firms · dismissed by {a.dismissed} people · made by {a.created_by_email || "–"}</span></div>}
      {ended && <div className="note" role="note">This announcement has ended. It is kept as a record and cannot be changed.</div>}
      <fieldset className="card" disabled={ended || !me.actions.includes("announcements.save")}>
        <label className="field"><span>Title</span><input className="input" maxLength={120} value={f.title} onChange={(e) => set("title", e.target.value)} data-testid="ann-title" /></label>
        <label className="field"><span>Text</span><textarea rows={3} maxLength={1000} value={f.body} onChange={(e) => set("body", e.target.value)} data-testid="ann-body" /></label>
        <div className="cols">
          <label className="field"><span>Severity</span>
            <select className="input" value={f.severity} onChange={(e) => set("severity", e.target.value)} data-testid="ann-severity">{SEVERITY.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
          <label className="field"><span>Audience</span>
            <select className="input" value={f.audience} onChange={(e) => set("audience", e.target.value)} data-testid="ann-audience">{AUDIENCE.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
          <label className="field"><span>Starts (empty: now)</span><input className="input" type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} /></label>
          <label className="field"><span>Ends (empty: until ended)</span><input className="input" type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={f.dismissible} onChange={(e) => set("dismissible", e.target.checked)} /> People can dismiss it</label>
        {f.audience === "plans" && (
          <fieldset className="field"><legend className="f-label">Plans</legend>
            <div className="checks">{(choices.data?.plans || []).map((p) => <label key={p.id} className="check"><input type="checkbox" checked={f.plan_ids.includes(p.id)} onChange={() => tog("plan_ids", p.id)} data-plan={p.name} /> {p.name}</label>)}</div>
          </fieldset>
        )}
        {f.audience === "firms" && (
          <fieldset className="field"><legend className="f-label">Firms ({f.firm_ids.length} chosen)</legend>
            <input className="input" placeholder="Find a firm…" value={firmQ} onChange={(e) => setFirmQ(e.target.value)} aria-label="Find a firm" />
            <div className="checks pick">{firms.map((x) => <label key={x.id} className="check"><input type="checkbox" checked={f.firm_ids.includes(x.id)} onChange={() => tog("firm_ids", x.id)} data-firm={x.name} /> {x.name}</label>)}</div>
          </fieldset>
        )}
      </fieldset>
      <section className="card">
        <h2>How firms see it</h2>
        <Preview a={f} />
        <p className="muted small">One bar at the bottom of the user app. When several are live for a firm, the most severe shows first.</p>
      </section>
      {a && <Facts items={[["Starts", fmtTime(a.starts_at)], ["Ends", a.ends_at ? fmtTime(a.ends_at) : "Until ended"], ["Changed", fmtTime(a.updated_at)], ["Changed by", a.updated_by_email || "–"]]} />}
    </Page>
  );
}

export const module = {
  id: "announcements", label: "Announcements", icon: Megaphone, action: "announcements.list",
  routes: [
    { path: /^announcements$/, render: (_, me) => <List me={me} /> },
    { path: /^announcements\/new$/, render: (_, me) => <Form me={me} key="new" /> },
    { path: /^announcements\/([0-9a-f-]{36})$/, render: (m, me) => <Form me={me} id={m[1]} key={m[1]} /> },
  ],
};
