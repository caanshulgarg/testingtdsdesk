// Calls' smaller windows, in their own file (loaded when one is opened): Schedule meeting (date, time, people, the .ics
// and the email or a text to copy), a client's recording setting (the owner), past calls (recording, transcript, summary,
// chat, kept with the client, batch or meeting) and the Academy batches (a name and its members' emails; Start class).
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { makeApi, base, publicKey } from "./api.js";
import { Calls } from "./launch.js";
import { transcriptText, chatParts } from "./rules.js";
import "./calls.css";

const api = makeApi(null);
function modal(render) {
  const el = document.createElement("div"); el.className = "call-dialog-host"; document.body.appendChild(el);
  const root = createRoot(el);
  const close = () => { root.unmount(); el.remove(); };
  root.render(<div className="call-dialog-back" onClick={(e) => { if (e.target === e.currentTarget) close(); }}><div className="call-dialog" role="dialog" aria-modal="true">{render(close)}</div></div>);
  return close;
}
const download = (name, text, type) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
const istInput = (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 16);

// ---------------------------------------------------------------- Schedule meeting
export function openSchedule(o) { return modal((close) => <Schedule o={o || {}} close={close} />); }
function Schedule({ o, close }) {
  const start = new Date(Math.ceil((Date.now() + 3600000) / 1800000) * 1800000);
  const [title, setTitle] = useState(o.title || "Meeting"), [at, setAt] = useState(istInput(start)), [mins, setMins] = useState(30), [emails, setEmails] = useState(""), [busy, setBusy] = useState(false), [res, setRes] = useState(null), [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr("");
    try {
      const when = new Date(Date.parse(at + ":00Z") - 330 * 60000).toISOString();          // typed in IST
      setRes(await api.call("schedule", { title, at: when, minutes: mins, emails: emails.split(/[\s,;]+/).filter(Boolean), client_id: o.client_id || null, base: location.href }));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  if (res) return <div data-schedule-done="">
    <h3>Meeting scheduled</h3>
    <p>{res.emailed ? "The invite was emailed to " + res.emailed + " people, with the calendar file." : res.mail ? "No one to email; send the invite yourself." : "Email is not set up for FinCom yet: copy the invite below and send it (WhatsApp, your own email)."}</p>
    <textarea readOnly rows={5} value={res.text} data-schedule-text="" onFocus={(e) => e.target.select()} />
    <div className="call-row">
      <button type="button" className="call-btn" onClick={() => { try { navigator.clipboard.writeText(res.text); } catch (e) { /* */ } }}>Copy the invite</button>
      <button type="button" className="call-btn" onClick={() => download("invite.ics", res.ics, "text/calendar")} data-schedule-ics="">Calendar file (.ics)</button>
      <a className="call-btn" href={"https://wa.me/?text=" + encodeURIComponent(res.text)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <button type="button" className="call-primary" onClick={close}>Done</button>
    </div>
  </div>;
  return <form onSubmit={(e) => { e.preventDefault(); go(); }} data-schedule="">
    <h3>Schedule meeting</h3>
    <label className="f"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required /></label>
    <label className="f"><span>Date and time (IST)</span><input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required data-schedule-at="" /></label>
    <label className="f"><span>Minutes</span><input type="number" min={5} max={600} value={mins} onChange={(e) => setMins(Number(e.target.value))} /></label>
    <label className="f"><span>People to invite (emails)</span><textarea rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="client@example.com, partner@example.com" data-schedule-emails="" /></label>
    {err && <p className="call-err" role="alert">{err}</p>}
    <div className="call-row"><button type="submit" className="call-primary" disabled={busy}>{busy ? "Scheduling…" : "Schedule"}</button><button type="button" className="call-btn" onClick={close}>Cancel</button></div>
  </form>;
}

// ---------------------------------------------------------------- the client's recording setting (the owner)
export function openSettings(o) { return modal((close) => <Settings o={o} close={close} />); }
function Settings({ o, close }) {
  const [s, setS] = useState(null), [err, setErr] = useState("");
  useEffect(() => { api.call("settings", { client_id: o.client_id }).then((j) => setS(j.setting)).catch((e) => setErr(e.message)); }, []);
  async function save() { try { const j = await api.call("settings", { client_id: o.client_id, set: true, allow: !!s.allow_recording, days: s.retention_days }); setS(j.setting); close(); } catch (e) { setErr(e.message); } }
  return <div data-call-setting="">
    <h3>Recording calls with {o.name}</h3>
    {s ? <>
      <label className="call-check"><input type="checkbox" checked={!!s.allow_recording} onChange={(e) => setS(Object.assign({}, s, { allow_recording: e.target.checked }))} data-allow-recording="" /> Allow the host to record calls with this client (everyone in the call is told: “This call is being recorded”)</label>
      <label className="f"><span>Keep recordings for (days)</span><input type="number" min={7} max={3650} value={s.retention_days} onChange={(e) => setS(Object.assign({}, s, { retention_days: Number(e.target.value) }))} /></label>
      <p className="call-note">After that a recording is marked deleted (hidden); it is removed from storage only when you ask.</p>
    </> : <p>Reading…</p>}
    {err && <p className="call-err">{err}</p>}
    <div className="call-row"><button type="button" className="call-primary" onClick={save} disabled={!s}>Save</button><button type="button" className="call-btn" onClick={close}>Cancel</button></div>
  </div>;
}

// ---------------------------------------------------------------- past calls (what stays with the client, batch or meeting)
export function openHistory(o) { return modal((close) => <History o={o} close={close} />); }
function History({ o, close }) {
  const [rooms, setRooms] = useState(null), [open, setOpen] = useState(null), [err, setErr] = useState("");
  useEffect(() => { api.call("history", o.client_id ? { client_id: o.client_id } : { batch_id: o.batch_id }).then((j) => setRooms(j.rooms)).catch((e) => setErr(e.message)); }, []);
  return <div data-call-history-list="">
    <h3>Calls{o.name ? " with " + o.name : ""}</h3>
    {err && <p className="call-err">{err}</p>}
    {rooms && !rooms.length && <p className="call-note">No calls yet.</p>}
    {rooms && rooms.map((r) => <div key={r.id} className="call-person"><span><b>{r.title}</b> <small>{r.status === "scheduled" ? "scheduled for " + new Date(r.scheduled_at).toLocaleString("en-IN") : r.started_at ? new Date(r.started_at).toLocaleString("en-IN") : ""} · {r.status}</small></span>
      {r.status !== "ended" && <button type="button" className="call-btn small" onClick={() => { close(); Calls.join(r.id); }}>Join</button>}
      {r.status === "ended" && <button type="button" className="call-btn small" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Hide" : "Open"}</button>}
      {open === r.id && <Kept room={r} />}</div>)}
    <div className="call-row"><button type="button" className="call-primary" onClick={close}>Close</button></div>
  </div>;
}
// read as the person (row-level security: a class's work only for its batch and the owner)
async function rest(path) {
  await Cloud.fresh().catch(() => {});
  const s = Cloud.sess();
  const r = await fetch(base() + path, { headers: { apikey: publicKey(), Authorization: "Bearer " + s.access_token } });
  if (!r.ok) throw new Error("Could not read (" + r.status + ")");
  return r;
}
function Kept({ room }) {
  const [t, setT] = useState(null), [recs, setRecs] = useState([]), [msgs, setMsgs] = useState([]), [url, setUrl] = useState(""), [note, setNote] = useState("");
  useEffect(() => {
    rest("/rest/v1/call_transcripts?select=lines,summary&room_id=eq." + room.id).then((r) => r.json()).then((x) => setT(x[0] || null)).catch(() => {});
    rest("/rest/v1/call_recordings?select=id,prefix,mime,chunks,started_at,retain_until&room_id=eq." + room.id).then((r) => r.json()).then(setRecs).catch(() => {});
    rest("/rest/v1/call_messages?select=id,author,body,file,at&room_id=eq." + room.id + "&order=id").then((r) => r.json()).then(setMsgs).catch(() => {});
  }, []);
  async function play(rec) {
    setNote("Fetching the recording…");
    try {
      const parts = [];
      for (let i = 0; i < rec.chunks; i++) parts.push(await (await rest("/storage/v1/object/authenticated/call-recordings/" + rec.prefix + rec.id + "/" + String(i).padStart(5, "0") + ".part")).blob());
      setUrl(URL.createObjectURL(new Blob(parts, { type: rec.mime }))); setNote("");
    } catch (e) { setNote(e.message); }
  }
  return <div className="call-kept">
    {recs.map((r) => <div key={r.id}>Recording ({r.chunks} parts, kept until {r.retain_until}) <button type="button" className="call-btn small" onClick={() => play(r)}>Play</button></div>)}
    {url && <video src={url} controls style={{ width: "100%" }} />}
    {note && <p className="call-note">{note}</p>}
    {t && t.summary && <><h4>Summary</h4><p>{t.summary.summary}</p>{t.summary.actions && t.summary.actions.length > 0 && <ul>{t.summary.actions.map((a, i) => <li key={i}>{a.title}</li>)}</ul>}</>}
    {t && t.lines && t.lines.length > 0 && <details><summary>Transcript</summary><pre className="call-transcript">{transcriptText(t.lines)}</pre></details>}
    {msgs.length > 0 && <details><summary>Chat ({msgs.length})</summary>{msgs.map((m) => <div key={m.id}><b>{m.author}:</b> {m.file ? "📎 " + m.file.name : chatParts(m.body).map((p, i) => p.link ? <a key={i} href={p.link} target="_blank" rel="noopener noreferrer nofollow">{p.link}</a> : <span key={i}>{p.text}</span>)}</div>)}</details>}
  </div>;
}

// ---------------------------------------------------------------- Academy batches (minimal: a name and members' emails)
export function Batches() {
  const [list, setList] = useState(null), [name, setName] = useState(""), [emails, setEmails] = useState(""), [err, setErr] = useState(""), [edit, setEdit] = useState(null);
  const role = String((Cloud.st && Cloud.st.role) || ""), staff = role === "owner" || role === "staff";
  const load = () => api.call("batch_list", {}).then((j) => setList(j.batches)).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  async function save() {
    setErr("");
    try { await api.call("batch_save", { id: edit || undefined, name, emails: emails.split(/[\s,;]+/).filter(Boolean) }); setName(""); setEmails(""); setEdit(null); load(); }
    catch (e) { setErr(e.message); }
  }
  return <div className="card" data-batches="">
    <h3>Academy batches</h3>
    <p className="note">A batch's members join its classes straight away (signed in with that email, or by the class link after the code sent to that email). Its recordings and transcripts are seen only by the batch and the firm's owner, and kept a year.</p>
    {list && !list.length && <p className="note">No batch yet.</p>}
    {list && list.map((b) => <div key={b.id} className="call-person" data-batch={b.name}><span><b>{b.name}</b> <small>{b.members.length} members</small></span>
      {staff && <button type="button" className="btn small" onClick={() => Calls.start({ kind: "class", batch_id: b.id })} data-start-class="">Start class</button>}
      {staff && <button type="button" className="btn small" onClick={() => { setEdit(b.id); setName(b.name); setEmails(""); }}>Add members</button>}
      <button type="button" className="btn small" onClick={() => Calls.history({ batch_id: b.id, name: b.name })}>Past classes</button></div>)}
    {staff && <div className="call-batch-form">
      <label className="f"><span>{edit ? "Batch name" : "New batch"}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="GST practitioner, batch 1" data-batch-name="" /></label>
      <label className="f"><span>Members' emails</span><textarea rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="student1@example.com, student2@example.com" data-batch-emails="" /></label>
      <button type="button" className="btn" onClick={save} data-batch-save="">{edit ? "Save" : "Add batch"}</button>{edit && <button type="button" className="linkbtn" onClick={() => { setEdit(null); setName(""); }}>Cancel</button>}
    </div>}
    {err && <p className="call-err">{err}</p>}
  </div>;
}
