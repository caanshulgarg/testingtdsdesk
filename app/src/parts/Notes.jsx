import { ListRows } from "./ListTable.jsx";
import Button from "./Button.jsx";
// Small notes of the Overview and the client list: a new client's first steps, and bringing in day books for several
// clients at once (ONB.card, src/js/48, and MultiUp.view, src/js/23). The Books and GST pages' own notes (ledgerBanner,
// gstDriftNote, catchSoon's message, BookSync.note, the server's jobs) are parts/BookNotes.jsx, with those pages' files.

// a new client's first steps, until they are done or hidden
// clean-up batch 2: once every step is done, or the card is hidden, it folds to one line that opens the steps again
export function OnbCard({ co }) {
  if (!co) return null;
  if (!S.books || S.books.cid !== co.id) { if (typeof openBooks === "function" && S.view === "company") setTimeout(() => { if (!S.books || S.books.cid !== co.id) openBooks(co.id); }, 0); }
  const st = ONB.steps(co), n = st.filter((s) => s.done).length;
  if (n === st.length || co.onbHide) return <details className="onb-fold" data-onb-folded={n === st.length ? "done" : "hidden"}>
    <summary>{n === st.length ? "✓ " + co.name + " is ready: all " + st.length + " steps done" : "Getting " + co.name + " ready: " + n + " of " + st.length + " done"}</summary>
    <ol className="onb-list">{st.map((s) => <li key={s.id} className={s.done ? "done" : ""} data-onb-step={s.id}><span className="onb-n" aria-hidden="true">{s.done ? "✓" : ""}</span><div><b>{s.t}</b><span>{s.d}</span></div>
      {!s.done && <Button className="btn small" onClick={() => onbStepGo(s)}>{s.btn[0]}</Button>}</li>)}</ol>
    {co.onbHide && n < st.length && <button className="linkbtn" data-onb-show="" onClick={() => { co.onbHide = false; Store.saveCompany(co); render(); }}>Show the card again</button>}
  </details>;
  return <section className="dash-card onb"><div className="onb-h"><div><h3>{"Getting " + co.name + " ready"}</h3><p className="note" style={{ margin: 0 }}>{n + " of " + st.length + " done"}</p></div><button className="linkbtn" onClick={() => onbHide()}>Hide this</button></div>
    <div className="onb-bar" role="progressbar" aria-valuemin="0" aria-valuemax={st.length} aria-valuenow={n}><i style={{ width: Math.round(n / st.length * 100) + "%" }}></i></div>
    {/* smart moves round 1 (10): the first step not done is the one primary button, "Next: …" */}
    <ol className="onb-list">{st.map((s) => { const next = !s.done && s === st.find((x) => !x.done);
      return <li key={s.id} className={s.done ? "done" : next ? "next" : ""} data-onb-step={s.id}><span className="onb-n" aria-hidden="true">{s.done ? "✓" : ""}</span><div><b>{s.t}</b><span>{s.d}</span></div>
      {!s.done && <Button className={"btn small" + (next ? " primary" : "")} data-onb-next={next ? "" : undefined} onClick={() => onbStepGo(s)}>{(next ? "Next: " : "") + s.btn[0]}</Button>}</li>; })}</ol></section>;
}

// day books for several clients at once: each file's company matched to a client, checked, then brought in
export function MultiUpload() {
  const m = S.multiUp;
  const intro = <><h3 style={{ marginTop: 0 }}>Day books for several clients at once</h3><p className="note" style={{ margin: "0 0 8px" }}>Choose the day book XML files exported from Tally, one or more per client. Each file’s company is read from the file and matched to a client; check the matches, then start. A file whose company or GSTIN is not the client’s is not taken.</p></>;
  const pick = (label, cls) => <button className={cls} onClick={() => doAct("multiPick")}>{label}</button>;
  if (!m) return <div className="pane">{intro}{pick("Bring in from Tally", "btn")}</div>;
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((a, c) => a.name.localeCompare(c.name));
  return <div className="pane">{intro}{m.reading && <p className="note">Reading the files…</p>}
    <ListRows name="multiUpload" className="data" unit={["file", "files"]} head={[{ label: "File", role: "number" }, { label: "Company in the file", role: "party" }, { label: "Client" }, { label: "Status", role: "status" }]}>
      {m.rows.map((r, i) => <tr key={i}><td>{r.f.name}<div className="nr">{Math.round(r.f.size / 1048576) + " MB"}</div></td><td>{r.name || "—"}{r.gstin && <div className="nr">{r.gstin}</div>}</td>
        <td>{r.status === "waiting" && !m.busy ? <select aria-label={"Client for " + r.f.name} value={r.cid || ""} onChange={(ev) => MultiUp.setClient(i, ev.target.value)}><option value="">— choose —</option>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          : (((S.companies || {})[r.cid] || {}).name || "—")}</td><td className={r.ok ? "" : /not taken/.test(r.status) ? "bad" : ""}>{r.status}</td></tr>)}</ListRows>
    <div className="row" style={{ gap: 8, marginTop: 8 }}>{m.busy ? <span className="lt-progress" data-progress=""><span className="note">{"Bringing in " + Math.min((m.done || 0) + 1, m.total || 1) + " of " + (m.total || 1) + (m.at ? ": " + m.at : "") + "…"}</span><progress max={m.total || 1} value={m.done || 0} /></span> : <><Button className="btn primary" onClick={() => MultiUp.start()}>Bring them in</Button>{pick("Choose other files", "btn small")}<Button className="btn small" onClick={() => doAct("multiClose")}>Close</Button></>}</div></div>;
}
