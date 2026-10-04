// The Tally page's Sync activity (phase 2, H49/H50/H51; migration 44): every change saved in Tally as FinCom's cloud
// received it (tally_recorder_lines; Rec in src/js/61), newest first, 200 at most, for the firm or one client. A strip of
// the lines waiting over 2 minutes with why; filters Waiting, Mismatch (the ledger check, F37-40: none yet), Today; an
// owner's Apply now on a held line (tally_recorder_release_held). New lines come in live (Live.joinRecorder, src/js/54).
import { useState } from "react";

const FILTERS = [["all", "All"], ["waiting", "Waiting"], ["mismatch", "Mismatch"], ["today", "Today"]];
// round 20 (d.4): "queued": the cloud queued the line (over 50 at once); its drain fills the state later
const STATE_CLS = { applied: "ok", duplicate: "no", stale: "no", held: "warn", received: "warn", queued: "warn", failed: "bad" };

export default function SyncActivity() {
  const [f, setF] = useState("all");
  if (!TCloud.on()) return <div className="pane" data-sync-activity=""><h3 style={{ marginTop: 0 }}>Sync activity</h3><p className="note">Sign in to the firm account to see the changes Tally sent.</p></div>;
  const a = Rec.actOf(), owner = Rec.owner();
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((x, y) => x.name.localeCompare(y.name));
  const pick = <select data-sync-client="" aria-label="Client" value={S.syncClient || ""} onChange={(ev) => { S.syncClient = ev.target.value; Rec.act.at = 0; render(); }}>
    <option value="">All clients</option>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>;
  const head = <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
    <h3 style={{ margin: 0 }}>Sync activity</h3>
    <span className="row" style={{ gap: 8, alignItems: "center" }}>{pick}<button className="btn small" data-sync-refresh="" onClick={() => Rec.actLoad()}>Refresh</button></span></div>;
  if (a.no44) return <div className="pane" data-sync-activity="">{head}<p className="bk-warn" data-not-ready="">{"Sync activity: " + REC_NOT44 + "."}</p></div>;
  const rows = Rec.filtered(f), wait = Rec.waiting(), msg = a.msg;
  const coName = (cid) => (S.companies && S.companies[cid] && S.companies[cid].name) || "";
  return <div className="pane" data-sync-activity="">
    {head}
    <p className="note" style={{ margin: "6px 0 8px" }}>Every change saved in Tally on a computer with FinCom’s recorder, as FinCom’s cloud received it: applied to FinCom’s copy, a duplicate of a change already applied, or held with the reason. Newest first.</p>
    {wait.length > 0 && <div className="bk-alert warn" data-sync-waiting="" style={{ margin: "0 0 8px" }}>
      <b>{wait.length + (wait.length === 1 ? " line" : " lines") + " waiting over 2 minutes"}</b>
      {wait.map(({ r, why }) => <div key={r.id} data-sync-waiting-line={String(r.id)}>{Rec.entry(r) + (r.pc ? " from " + r.pc : "") + ", received " + tallyHm(r.received_at) + ": " + why}</div>)}
    </div>}
    <nav className="sbar" aria-label="Sync activity filter">{FILTERS.map(([id, label]) =>
      <button key={id} data-sync-filter={id} aria-selected={f === id} onClick={() => setF(id)}>{label}</button>)}</nav>
    {a.err && <p className="bk-warn">{a.err}</p>}
    {msg && <p className={msg.err ? "bk-alert bad" : "note"} data-sync-msg="" style={{ margin: "6px 0" }}>{msg.busy ? "Applying…" : msg.err || msg.ok}</p>}
    {a.rows === null || a.rows === undefined ? <p className="note">Reading…</p>
      : !rows.length ? <p className="note" data-sync-empty="">{f === "mismatch" ? "No mismatch: the ledger check of each line comes later." : f === "waiting" ? "Nothing waiting." : f === "today" ? "No line today yet." : "No line from Tally yet."}</p>
      : <div className="tblwrap"><table className="data" data-sync-table="">
        <thead><tr><th>Saved in Tally</th><th>Entry</th><th>Action</th><th>PC</th><th>Reached FinCom</th><th>State</th><th>Ledger check</th><th></th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id} data-sync-line={String(r.id)}>
          <td>{r.saved_at ? tallyHm(r.saved_at) : "—"}</td>
          <td>{Rec.entry(r)}{!S.syncClient && coName(r.client_id) && <div className="nr">{coName(r.client_id)}</div>}</td>
          <td>{Rec.ACTS[r.event] || String(r.event || "")}</td>
          <td>{r.pc || "—"}</td>
          <td>{r.received_at ? tallyHm(r.received_at) : "—"}</td>
          <td><span className={"tag " + (STATE_CLS[r.state] || "warn")} data-sync-state={r.state}>{Rec.stateWords(r)}</span></td>
          <td className="note" data-sync-check="">not checked</td>
          <td>{owner && r.state === "held" && <button className="btn small" data-sync-release="" disabled={!!(msg && msg.busy)} onClick={() => Rec.release(r)}>Apply now</button>}</td>
        </tr>)}</tbody></table></div>}
  </div>;
}
