import { ListRows } from "./ListTable.jsx";
// Small notes shared by several screens: ledgers still to confirm (TDS, GST), filed GST returns the books no longer
// match, whether the TDS and GST work is saved for the firm, Tally having changed since a tab was worked out, a new
// client's first steps, and bringing in day books for several clients at once. Was ledgerBanner, gstDriftNote,
// TallyRead.catchUp's message (src/js/18), BookSync.note (src/js/41), ONB.card (src/js/48) and MultiUp.view (src/js/23).

// the ledgers still to be confirmed, above the TDS or GST work that uses them
export function LedgerBanner({ b, which }) {
  // one count everywhere (review of 01-Oct-2026): the same ledgers as the "N to confirm" on the Tally ledgers tab
  const p = LedMaster.pending(b);
  if (!p.length) return null;
  return <div className="bk-alert bad" style={{ marginBottom: 12 }}><b>{p.length + " ledger" + (p.length === 1 ? " is" : "s are") + " still to be confirmed."}</b> The figures below use the guesses; the return files wait until they are confirmed.{" "}
    <button className="linkbtn" onClick={() => booksTabGo("ledgers")}>Confirm them</button><div className="nr" style={{ whiteSpace: "normal" }}>{p.slice(0, 6).map((x) => x[0]).join(", ") + (p.length > 6 ? " and " + (p.length - 6) + " more" : "")}</div></div>;
}

// filed GST returns that the books no longer match
export function GstDriftNote({ b }) {
  if (b.gstDrift === undefined) { try { b.gstDrift = GSTAmend.drift(); } catch (e) { b.gstDrift = []; } }
  const d = b.gstDrift || [];
  if (!d.length) return null;
  return <div className="bk-warn" role="status">{d.slice(0, 3).map((x, i) => <p key={i}>{GSTAmend.driftLine(x)}</p>)}
    {d.length > 3 && <p>{(d.length - 3) + " more filed return" + (d.length > 4 ? "s" : "") + " changed."}</p>}
    <button className="btn small" onClick={() => booksTabGo("gst", "amend")}>See the amendments</button></div>;
}

// whether the TDS and GST work is kept for the firm, or only in this browser
export function SyncNote({ cid, tab }) {
  const info = !tab || tab === "import", note = (t, cls) => <p className={"note" + (cls ? " " + cls : "")} style={{ margin: "6px 0" }}>{t}</p>;
  if (!(typeof Cloud === "object" && Cloud.on())) return info ? note("TDS and GST work is kept in this browser only. Sign in to the firm account to share it with your colleagues.") : null;
  if (BookSync.off) return info ? note("The firm’s database is not set up for shared TDS and GST work yet: it is kept in this browser only.") : null;
  const s = BookSync.st[cid] || {};
  if (s.readonly) return note("Look-only access: changes here are not saved for the firm.");
  if (s.error) return note("TDS and GST work not saved to the firm yet: " + plainText(s.error) + ". It is safe in this browser and will be sent at the next sync.", "warn");
  // live sync: next to the work, whether the last change is saved
  if (typeof BookItems === "object" && BookItems.on()) { const n = BookItems.note(cid); if (n) return <p className={"note" + (n.cls ? " " + n.cls : "")} data-booksave style={{ margin: "6px 0" }}>{n.t}</p>; }
  return null;
}

// Tally changed since a tab was worked out: it is worked out again, and says so meanwhile (TallyRead.catchUp)
export function CatchUp({ text }) {
  return <p className="bk-warn" role="status">{text}</p>;
}

// a new client's first steps, until they are done or hidden
export function OnbCard({ co }) {
  if (!co || co.onbHide) return null;
  if (!S.books || S.books.cid !== co.id) { if (typeof openBooks === "function" && S.view === "company") setTimeout(() => { if (!S.books || S.books.cid !== co.id) openBooks(co.id); }, 0); }
  const st = ONB.steps(co), n = st.filter((s) => s.done).length;
  if (n === st.length) return null;
  return <section className="dash-card onb"><div className="onb-h"><div><h3>{"Getting " + co.name + " ready"}</h3><p className="note" style={{ margin: 0 }}>{n + " of " + st.length + " done"}</p></div><button className="linkbtn" onClick={() => onbHide()}>Hide this</button></div>
    <div className="onb-bar" role="progressbar" aria-valuemin="0" aria-valuemax={st.length} aria-valuenow={n}><i style={{ width: Math.round(n / st.length * 100) + "%" }}></i></div>
    <ol className="onb-list">{st.map((s) => <li key={s.id} className={s.done ? "done" : ""}><span className="onb-n" aria-hidden="true">{s.done ? "✓" : ""}</span><div><b>{s.t}</b><span>{s.d}</span></div>
      {!s.done && <button className="btn small" onClick={() => s.btn[1].act ? doAct(s.btn[1].act) : goClient(s.btn[1].go)}>{s.btn[0]}</button>}</li>)}</ol></section>;
}

// day books for several clients at once: each file's company matched to a client, checked, then brought in
export function MultiUpload() {
  const m = S.multiUp;
  const intro = <><h3 style={{ marginTop: 0 }}>Day books for several clients at once</h3><p className="note" style={{ margin: "0 0 8px" }}>Choose the day book XML files exported from Tally, one or more per client. Each file’s company is read from the file and matched to a client; check the matches, then start. A file whose company or GSTIN is not the client’s is not taken.</p></>;
  const pick = (label, cls) => <button className={cls} onClick={() => doAct("multiPick")}>{label}</button>;
  if (!m) return <div className="pane">{intro}{pick("Choose day book files", "btn")}</div>;
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((a, c) => a.name.localeCompare(c.name));
  return <div className="pane">{intro}{m.reading && <p className="note">Reading the files…</p>}
    <ListRows name="multiUpload" className="data" unit={["file", "files"]} head={[{ label: "File", role: "number" }, { label: "Company in the file", role: "party" }, { label: "Client" }, { label: "Status", role: "status" }]}>
      {m.rows.map((r, i) => <tr key={i}><td>{r.f.name}<div className="nr">{Math.round(r.f.size / 1048576) + " MB"}</div></td><td>{r.name || "—"}{r.gstin && <div className="nr">{r.gstin}</div>}</td>
        <td>{r.status === "waiting" && !m.busy ? <select aria-label={"Client for " + r.f.name} value={r.cid || ""} onChange={(ev) => MultiUp.setClient(i, ev.target.value)}><option value="">— choose —</option>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          : (((S.companies || {})[r.cid] || {}).name || "—")}</td><td className={r.ok ? "" : /not taken/.test(r.status) ? "bad" : ""}>{r.status}</td></tr>)}</ListRows>
    <div className="row" style={{ gap: 8, marginTop: 8 }}>{m.busy ? <span className="lt-progress" data-progress=""><span className="note">{"Bringing in " + Math.min((m.done || 0) + 1, m.total || 1) + " of " + (m.total || 1) + (m.at ? ": " + m.at : "") + "…"}</span><progress max={m.total || 1} value={m.done || 0} /></span> : <><button className="btn primary" onClick={() => MultiUp.start()}>Bring them in</button>{pick("Choose other files", "btn small")}<button className="btn small" onClick={() => doAct("multiClose")}>Close</button></>}</div></div>;
}

// fast-sync: what FinCom's server is doing for this client (a day book being read in, the kept day books read again),
// live; it carries on when this page is closed (TCloud.jobs, migration-13)
export function JobsNote({ cid }) {
  if (typeof TCloud !== "object" || !TCloud.on()) return null;
  if (TCloud.jobs[cid] === undefined && TCloud.jobsOk !== false) { TCloud.jobs[cid] = []; setTimeout(() => TCloud.jobsLoad(cid), 0); }
  const day = Date.now() - 86400000;
  const list = (TCloud.jobs[cid] || []).filter((j) => j.status === "queued" || j.status === "running" || Date.parse(j.updated_at) > day).slice(0, 3);
  // round 20 (d.2): a Day Book on its way to Storage from this page: its progress bar
  const up = typeof TCloudUp === "object" && TCloudUp.prog ? TCloudUp.prog[cid] : null;
  const pct = up && up.size ? Math.floor((up.sent * 100) / up.size) : 0;
  const bar = up ? <div data-upload-progress="" style={{ margin: "4px 0" }}><span className="note">{"Sending " + up.name + " to FinCom’s cloud: " + pct + "% (" + (up.sent / 1048576).toFixed(1) + " of " + (up.size / 1048576).toFixed(1) + " MB). If the page is closed, it goes on from here the next time this client is opened."}</span>
    <progress data-upload-bar="" max={100} value={pct} style={{ display: "block", width: "100%", maxWidth: 420 }} /></div> : null;
  if (!list.length) return bar;
  return <div data-jobs>{bar}{list.map((j) => <p key={j.id} className={"note" + (j.status === "failed" ? " bad" : "")} style={{ margin: "4px 0" }} data-job={j.status}>{TCloud.jobLine(j)}</p>)}</div>;
}
