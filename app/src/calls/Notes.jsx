// A meeting's notes (next-calls-complete, 25-Oct-2026; the owner: "please notes of the meeting as well"): during the
// meeting (the call's Notes panel, while the host has "Take notes" or the recording on), after it (the call's last
// screen) and later (Meetings › Recent › Notes). What was said, in order (each person's words only after they chose to
// stay), and the AI's summary: key points, decisions, action items with who and by when. The host edits them; anyone
// who can see the meeting copies them or downloads them (Word, or printed to PDF). fincom-call's notes_get, notes_make,
// notes_save decide who may.
import { useEffect, useRef, useState } from "react";
import { notesText, notesClean, transcriptText, SUB_LANGS } from "./rules.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const when = (d) => { try { return d ? (typeof fmtDateTime === "function" ? fmtDateTime(d) : new Date(d).toLocaleString("en-IN")) : ""; } catch (e) { return ""; } };
const fileName = (t) => (String(t || "Meeting").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "Meeting") + " - notes";
// the notes as a page (Word opens it as a document; the browser prints it to PDF)
export function notesHtml(o) {
  const n = o.notes || {};
  const list = (h, xs) => xs && xs.length ? "<h2>" + h + "</h2><ul>" + xs.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "";
  const acts = n.actions && n.actions.length ? "<h2>Action items</h2><table><tr><th>What</th><th>Who</th><th>By</th></tr>" + n.actions.map((a) => "<tr><td>" + esc(a.title) + "</td><td>" + esc(a.who) + "</td><td>" + esc(a.due) + "</td></tr>").join("") + "</table>" : "";
  return "<!doctype html><html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>" + esc(o.title) + "</title>" +
    "<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#111;margin:24px}h1{font-size:18pt;margin:0 0 4px}h2{font-size:13pt;margin:18px 0 6px}" +
    "table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}.m{color:#555}pre{white-space:pre-wrap;font-family:inherit}</style></head><body>" +
    "<h1>" + esc(o.title || "Meeting notes") + "</h1><p class='m'>" + esc([o.when, o.people && o.people.length ? "People: " + o.people.join(", ") : ""].filter(Boolean).join(" · ")) + "</p>" +
    (n.summary ? "<h2>Summary</h2><p>" + esc(n.summary).replace(/\n/g, "<br>") + "</p>" : "") + list("Key points", n.points) + list("Decisions", n.decisions) + acts +
    (o.lines && o.lines.length ? "<h2>What was said</h2><pre>" + esc(transcriptText(o.lines)) + "</pre>" : "") +
    (n.edited_name ? "<p class='m'>Edited by " + esc(n.edited_name) + "</p>" : "") + "<p class='m'>FinCom meeting notes</p></body></html>";
}
function save(blob, name) {
  const u = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}
// printed from a frame of its own (the browser's "Save as PDF")
function printHtml(html) {
  const f = document.createElement("iframe"); f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  f.src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* */ } setTimeout(() => { URL.revokeObjectURL(f.src); f.remove(); }, 60000); };
  document.body.appendChild(f);
}
const lines2 = (xs) => (xs || []).join("\n");
const split = (t) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean);

export function NotesView({ api, roomId, live, lang }) {
  const [d, setD] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(""), [msg, setMsg] = useState(""), [edit, setEdit] = useState(null), [pick, setPick] = useState({});
  const [sumLang, setSumLang] = useState(lang && lang !== "hinglish" ? lang : "en");
  const alive = useRef(true);
  const load = () => api.call("notes_get", { room_id: roomId }).then((j) => { if (alive.current) { setD(j); setErr(""); } }, (e) => { if (alive.current) setErr(e.message); });
  useEffect(() => { alive.current = true; load(); const t = live ? setInterval(() => { if (!edit) load(); }, 15000) : null; return () => { alive.current = false; clearInterval(t); }; }, [roomId, live, !!edit]);
  async function make(replace) {
    setBusy("make"); setMsg("");
    try { const j = await api.call("notes_make", { room_id: roomId, lang: sumLang, replace: !!replace }); setD((x) => Object.assign({}, x, { notes: j.notes })); }
    catch (e) {
      if (e.kind === "edited" && confirm("The host has edited these notes. Make them again from what was said (the edit is replaced)?")) { setBusy(""); return make(true); }
      setMsg(e.message);
    }
    setBusy("");
  }
  async function saveEdit() {
    const n = notesClean({ summary: edit.summary, points: split(edit.points), decisions: split(edit.decisions), actions: edit.actions });
    if (!n) { setMsg("Write something in the notes first."); return; }
    setBusy("save"); setMsg("");
    try { const j = await api.call("notes_save", { room_id: roomId, notes: n }); setD((x) => Object.assign({}, x, { notes: j.notes })); setEdit(null); setMsg("Saved."); }
    catch (e) { setMsg(e.message); }
    setBusy("");
  }
  async function addTasks() {
    const items = ((d.notes && d.notes.actions) || []).filter((a, i) => pick[i] !== false);
    try { const j = await api.call("tasks", { room_id: roomId, items }); setMsg(j.added + " added to the client's due list."); } catch (e) { setMsg(e.message); }
  }
  if (err) return <div className="call-notes" data-notes=""><p className="call-note" data-notes-error="">{err}</p></div>;
  if (!d) return <div className="call-notes" data-notes=""><p className="call-note">Reading the notes…</p></div>;
  const n = d.notes, has = n && (n.summary || (n.points && n.points.length) || (n.decisions && n.decisions.length) || (n.actions && n.actions.length));
  const doc = { title: d.room.title, when: when(d.room.started_at), people: d.people, notes: n || {}, lines: d.lines };
  return <div className="call-notes" data-notes="">
    {live && <p className="call-note" data-notes-state="">{d.taking ? "Notes are being taken: the words of those who chose to stay are kept below." : d.recording ? "The call is being recorded; its words are kept." : "Notes are not being taken. The host turns them on in More (⋮) › Take notes; everyone is told."}</p>}
    {!edit && has && <div data-notes-summary="">
      {n.summary && <><h4>Summary</h4><p className="call-notes-p">{n.summary}</p></>}
      {n.points && n.points.length > 0 && <><h4>Key points</h4><ul>{n.points.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {n.decisions && n.decisions.length > 0 && <><h4>Decisions</h4><ul data-notes-decisions="">{n.decisions.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {n.actions && n.actions.length > 0 && <><h4>Action items</h4>{n.actions.map((a, i) => <label key={i} className="call-check" data-notes-action={a.title}>
        {d.room.client_id && d.can_make && <input type="checkbox" checked={pick[i] !== false} onChange={(e) => setPick(Object.assign({}, pick, { [i]: e.target.checked }))} />} {a.title}{a.who ? " · " + a.who : ""}{a.due ? " · by " + a.due : ""}</label>)}
        {d.room.client_id && d.can_make && <button type="button" className="call-btn small" onClick={addTasks} data-add-tasks="">Add to the client's due list</button>}</>}
      {n.edited_name && <p className="call-note" data-notes-edited="">Edited by {n.edited_name}</p>}
    </div>}
    {!edit && !has && <p className="call-note" data-notes-empty="">{d.lines.length ? "No summary yet." : "Nothing kept yet. Notes come from what is said while Take notes (or the recording) is on, from those who chose to stay."}</p>}
    {edit && <div className="call-notes-edit" data-notes-edit="">
      <label className="f"><span>Summary</span><textarea rows={5} value={edit.summary} onChange={(e) => setEdit(Object.assign({}, edit, { summary: e.target.value }))} data-notes-edit-summary="" /></label>
      <label className="f"><span>Key points (one a line)</span><textarea rows={4} value={edit.points} onChange={(e) => setEdit(Object.assign({}, edit, { points: e.target.value }))} data-notes-edit-points="" /></label>
      <label className="f"><span>Decisions (one a line)</span><textarea rows={3} value={edit.decisions} onChange={(e) => setEdit(Object.assign({}, edit, { decisions: e.target.value }))} data-notes-edit-decisions="" /></label>
      <span className="f"><span>Action items</span></span>
      {edit.actions.map((a, i) => <div key={i} className="call-row" data-notes-edit-action="">
        <input value={a.title} placeholder="What" aria-label="What" onChange={(e) => { const x = edit.actions.slice(); x[i] = Object.assign({}, a, { title: e.target.value }); setEdit(Object.assign({}, edit, { actions: x })); }} />
        <input value={a.who} placeholder="Who" aria-label="Who" style={{ maxWidth: 130 }} onChange={(e) => { const x = edit.actions.slice(); x[i] = Object.assign({}, a, { who: e.target.value }); setEdit(Object.assign({}, edit, { actions: x })); }} />
        <input type="date" value={a.due} aria-label="By" onChange={(e) => { const x = edit.actions.slice(); x[i] = Object.assign({}, a, { due: e.target.value }); setEdit(Object.assign({}, edit, { actions: x })); }} />
        <button type="button" className="call-btn small" aria-label="Remove" onClick={() => setEdit(Object.assign({}, edit, { actions: edit.actions.filter((_, k) => k !== i) }))}>✕</button></div>)}
      <button type="button" className="call-btn small" onClick={() => setEdit(Object.assign({}, edit, { actions: edit.actions.concat([{ title: "", who: "", due: "" }]) }))} data-notes-add-action="">Add an action item</button>
      <div className="call-row"><button type="button" className="call-primary" disabled={busy === "save"} onClick={saveEdit} data-notes-save="">{busy === "save" ? "Saving…" : "Save the notes"}</button>
        <button type="button" className="call-btn" onClick={() => setEdit(null)}>Cancel</button></div>
    </div>}
    {!edit && <div className="call-row wrap">
      {d.can_make && <button type="button" className="call-btn" disabled={!!busy || !d.lines.length} title={!d.lines.length ? "Nothing said has been kept yet" : undefined} onClick={() => make(false)} data-notes-make="">{busy === "make" ? "Making the notes…" : has ? "Make the summary again" : "Make the summary"}</button>}
      {d.can_make && <label className="call-check">in <select value={sumLang} onChange={(e) => setSumLang(e.target.value)} data-notes-lang="">{SUB_LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
      {d.can_edit && <button type="button" className="call-btn" onClick={() => setEdit({ summary: (n && n.summary) || "", points: lines2(n && n.points), decisions: lines2(n && n.decisions), actions: ((n && n.actions) || []).map((a) => Object.assign({}, a)) })} data-notes-edit-btn="">Edit</button>}
      <button type="button" className="call-btn" disabled={!has && !d.lines.length} onClick={() => { try { navigator.clipboard.writeText(notesText(doc)); setMsg("Copied."); } catch (e) { setMsg("Copy is not allowed here."); } }} data-notes-copy="">Copy</button>
      <button type="button" className="call-btn" disabled={!has && !d.lines.length} onClick={() => save(new Blob(["﻿" + notesHtml(doc)], { type: "application/msword" }), fileName(d.room.title) + ".doc")} data-notes-word="">Word</button>
      <button type="button" className="call-btn" disabled={!has && !d.lines.length} onClick={() => printHtml(notesHtml(doc))} data-notes-pdf="">PDF (print)</button>
    </div>}
    {msg && <p className="call-note" role="status" data-notes-msg="">{msg}</p>}
    {d.lines.length > 0 && <details open={live} data-notes-lines=""><summary>What was said ({d.lines.length})</summary><pre className="call-transcript" data-notes-transcript="">{transcriptText(d.lines)}</pre></details>}
  </div>;
}
