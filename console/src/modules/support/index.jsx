// Support desk: every firm's tickets (status, SLA, assignee, replies), a ticket's thread with internal notes, reply or
// note as FinCom support, and status / priority / assignee.
import { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { DataTable } from "../../ui/DataTable.jsx";
import { Chip, ErrorNote, Facts, Loading, Page } from "../../ui/bits.jsx";
import { useAction } from "../../ui/use.js";
import { call } from "../../lib/api.js";
import { fmtInr, fmtTime } from "../../lib/format.js";
import { go, href } from "../../lib/route.js";

const STATUS = [{ value: "new", label: "New" }, { value: "open", label: "Open" }, { value: "waiting", label: "Waiting on the firm" }, { value: "resolved", label: "Resolved" }, { value: "closed", label: "Closed" }];
const PRIORITY = [{ value: "urgent", label: "Urgent" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }];
const CATEGORY = [{ value: "question", label: "Question" }, { value: "problem", label: "Problem" }, { value: "request", label: "Request" }, { value: "data", label: "Data" }, { value: "billing", label: "Billing" }];
const SLA = [{ value: "breached", label: "Breached" }, { value: "due", label: "Due within the hour" }, { value: "ok", label: "On time" }, { value: "done", label: "Done" }];
const slaTone = (s) => ({ breached: "bad", due: "warn", ok: "good" }[s] || "neutral");
const stTone = (s) => ({ new: "warn", open: "warn", waiting: "neutral", resolved: "good", closed: "neutral" }[s] || "neutral");
const label = (list, v) => (list.find((x) => x.value === v) || {}).label || v;
export const TICKET_COLUMNS = [
  { key: "code", label: "Ticket", type: "text" },
  { key: "subject", label: "Subject", type: "text" },
  { key: "firm", label: "Firm", type: "text" },
  { key: "status", label: "Status", type: "select", options: STATUS, render: (r) => <Chip tone={stTone(r.status)} testid="t-status">{label(STATUS, r.status)}</Chip> },
  { key: "priority", label: "Priority", type: "select", options: PRIORITY, phone: false },
  { key: "sla", label: "SLA", type: "select", options: SLA, render: (r) => <Chip tone={slaTone(r.sla)}>{label(SLA, r.sla)}</Chip> },
  { key: "assignee", label: "Assignee", type: "text", phone: false, render: (r) => r.assignee || <span className="muted">Nobody</span> },
  { key: "replies", label: "Replies", type: "number", align: "end", phone: false },
  { key: "notes", label: "Notes", type: "number", align: "end", hidden: true },
  { key: "category", label: "Category", type: "select", options: CATEGORY, phone: false },
  { key: "module", label: "Module", type: "text", hidden: true },
  { key: "created_email", label: "Raised by", type: "text", hidden: true },
  { key: "last_by", label: "Last word", type: "select", options: [{ value: "firm", label: "The firm" }, { value: "support", label: "FinCom" }], hidden: true },
  { key: "created_at", label: "Raised", type: "date", phone: false },
  { key: "updated_at", label: "Changed", type: "date", phone: false },
];
const presets = (me) => [
  { label: "Needs us", filters: { status: { op: "in", values: ["new", "open"] } } },
  { label: "SLA breached", filters: { sla: { op: "in", values: ["breached"] } } },
  { label: "Mine", filters: { assignee: { op: "contains", value: me.email } } },
  { label: "Waiting on firm", filters: { status: { op: "in", values: ["waiting"] } } },
  { label: "Done", filters: { status: { op: "in", values: ["resolved", "closed"] } } },
  { label: "All", filters: {} },
];

function Tickets({ me }) {
  return (
    <Page title="Support" sub="Every firm's tickets. Internal notes are never shown to the firm.">
      <DataTable id="tk" action="support.list" columns={TICKET_COLUMNS} presets={presets(me)} defaultPreset={5} me={me} exportName="tickets" onRow={(r) => go("support/" + r.id)} />
    </Page>
  );
}

function Ticket({ me, id }) {
  const { loading, data: t, error, reload } = useAction("support.get", { ticket_id: id });
  const people = useAction(me.actions.includes("support.assignees") ? "support.assignees" : "me");
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [st, setSt] = useState(null);
  useEffect(() => { if (t) setSt({ status: t.status, priority: t.priority, assignee: t.assignee || "" }); }, [t?.updated_at]);
  if (loading && !t) return <Page title="Ticket"><Loading /></Page>;
  if (!t) return <Page title="Ticket"><ErrorNote error={error} onRetry={reload} /></Page>;
  const can = me.actions.includes("support.reply");
  const send = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const d = await call("support.reply", { ticket_id: id, body: body.trim(), internal });
      setBody(""); setMsg({ ok: true, text: internal ? "Note added (the firm does not see it)." : d.emailed === "sent" ? "Reply sent, and emailed to " + (t.created_email || "the firm") + "." : "Reply sent. Email: " + d.emailed + "." });
      reload();
    } catch (x) { setMsg({ ok: false, text: x.message }); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true); setMsg(null);
    const ch = {};
    if (st.status !== t.status) ch.status = st.status;
    if (st.priority !== t.priority) ch.priority = st.priority;
    if (st.assignee !== (t.assignee || "")) ch.assignee = st.assignee;
    try { await call("support.set", { ticket_id: id, ...ch }); setMsg({ ok: true, text: "Saved." }); reload(); } catch (x) { setMsg({ ok: false, text: x.message }); }
    setBusy(false);
  };
  const fs = t.firm_summary || {};
  return (
    <Page title={t.code + " · " + t.subject} sub={<a href={href("support")}>← All tickets</a>}
          actions={me.actions.includes("seeas.open") && t.firm_id && <a className="btn" href={href("seeas/" + t.firm_id)} data-testid="ticket-seeas">See as this firm</a>}>
      <ErrorNote error={error} onRetry={reload} />
      <div className="chips">
        <Chip tone={stTone(t.status)} testid="t-status">{label(STATUS, t.status)}</Chip><Chip tone={slaTone(t.sla)}>SLA: {label(SLA, t.sla)}</Chip>
        <Chip>{label(PRIORITY, t.priority)}</Chip><Chip>{label(CATEGORY, t.category)}</Chip><span className="muted">{t.module}</span>
      </div>
      <div className="split">
        <div>
          <ul className="thread" data-testid="thread">
            {(t.thread || []).map((m) => (
              <li key={m.id} className={"msg" + (m.from_support ? " support" : "") + (m.internal ? " internal" : "")} data-internal={m.internal ? "1" : "0"}>
                <div className="msg-head">{m.author_name || "–"} · {fmtTime(m.created_at)}{m.internal && " · internal note"}</div>
                <p className="msg-body">{m.body}</p>
                {(m.files || []).length > 0 && <div className="muted small">Files: {m.files.map((f) => f.name).join(", ")}</div>}
              </li>
            ))}
          </ul>
          {can && (
            <form className="card" onSubmit={send}>
              <label className="field"><span>{internal ? "Internal note (the firm never sees it)" : "Reply to the firm (also emailed to them)"}</span>
                <textarea rows={4} maxLength={10000} value={body} onChange={(e) => setBody(e.target.value)} data-testid="reply-body" /></label>
              <div className="row-between">
                <label className="check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} data-testid="reply-internal" /> Internal note</label>
                <button className="btn primary" disabled={busy || !body.trim()} data-testid="reply-send">{busy ? "Sending…" : internal ? "Add note" : "Send reply"}</button>
              </div>
            </form>
          )}
          {msg && <div className={"note " + (msg.ok ? "" : "note-bad")} role="status" data-testid="ticket-msg">{msg.text}</div>}
        </div>
        <aside>
          {can && st && (
            <section className="card">
              <h2>Ticket</h2>
              <label className="field"><span>Status</span><select className="input" value={st.status} onChange={(e) => setSt({ ...st, status: e.target.value })} data-testid="t-set-status">{STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
              <label className="field"><span>Priority</span><select className="input" value={st.priority} onChange={(e) => setSt({ ...st, priority: e.target.value })}>{PRIORITY.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
              <label className="field"><span>Assignee</span><select className="input" value={st.assignee} onChange={(e) => setSt({ ...st, assignee: e.target.value })} data-testid="t-set-assignee">
                <option value="">Nobody</option>{(Array.isArray(people.data) ? people.data : []).map((p) => <option key={p.email} value={p.email}>{p.email}</option>)}
                {st.assignee && !(Array.isArray(people.data) ? people.data : []).some((p) => p.email === st.assignee) && <option value={st.assignee}>{st.assignee}</option>}</select></label>
              <button className="btn" onClick={save} disabled={busy || (st.status === t.status && st.priority === t.priority && st.assignee === (t.assignee || ""))} data-testid="t-save">Save</button>
            </section>
          )}
          <section className="card">
            <h2>The firm</h2>
            <Facts items={[["Firm", fs.id ? <a key="f" href={href("firms/" + fs.id)}>{fs.name}</a> : "–"], ["Plan", fs.plan || "–"], ["Credit", fmtInr(fs.balance)], ["Status", fs.status || "–"], ["People", fs.members ?? "–"],
                           ["Raised by", (t.created_name || "") + " " + (t.created_email || "")], ["Raised", fmtTime(t.created_at)], ["Respond by", fmtTime(t.respond_by)], ["Resolve by", fmtTime(t.resolve_by)], ["First response", fmtTime(t.first_response_at)]]} />
          </section>
        </aside>
      </div>
    </Page>
  );
}

export const module = {
  id: "support", label: "Support", icon: LifeBuoy, action: "support.list",
  routes: [
    { path: /^support$/, render: (_, me) => <Tickets me={me} /> },
    { path: /^support\/([0-9a-f-]{36})$/, render: (m, me) => <Ticket me={me} id={m[1]} key={m[1]} /> },
  ],
};
