// The Tally page's Sync activity (phase 2, H49/H50/H51; migration 44): every change saved in Tally as FinCom's cloud
// received it (tally_recorder_lines; Rec in src/js/61), newest first, 200 at most, for the firm or one client. A strip of
// the lines waiting over 2 minutes with why; filters Waiting, Mismatch (the ledger check, F37-40: none yet), Today; an
// Apply now on a held line (tally_recorder_release_held; the owner's rule of 05-Oct-2026: any member who may write). New lines come in live (Live.joinRecorder, src/js/54).
import Msg from "../parts/Msg.jsx";
import ListTable from "../parts/ListTable.jsx";

const FILTERS = [["all", "All"], ["waiting", "Waiting"], ["held", "Held"], ["mismatch", "Mismatch"], ["today", "Today"]];
// round 20 (d.4): "queued": the cloud queued the line (over 50 at once); its drain fills the state later
// 05-Oct-2026 (migration 50): "replaced": a later line of the same entry brought its details (greyed as a duplicate is)
const STATE_CLS = { applied: "ok", duplicate: "no", stale: "no", replaced: "no", held: "warn", received: "warn", queued: "warn", failed: "bad" };

export default function SyncActivity() {
  // the filter is S.syncFilter, so a link elsewhere can open the list on it (Rec.openActivity(cid, "held"))
  const f = S.syncFilter || "all", setF = (v) => { S.syncFilter = v; render(); };
  if (!TCloud.on()) return <div className="pane" data-sync-activity=""><h3 style={{ marginTop: 0 }}>Sync activity</h3><p className="note">Sign in to the firm account to see the changes Tally sent.</p></div>;
  const a = Rec.actOf(), canApply = Rec.canWrite();
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
    <p className="note" style={{ margin: "6px 0 8px" }}>Every change saved in Tally on a computer with FinCom’s recorder, as FinCom’s cloud received it: entered in the books, already in the books, or received and not yet entered, with the reason. Newest first.</p>
    {wait.length > 0 && <div className="bk-alert warn" data-sync-waiting="" style={{ margin: "0 0 8px" }}>
      <b>{wait.length + (wait.length === 1 ? " line" : " lines") + " waiting over 2 minutes"}</b>
      {wait.map(({ r, why }) => <div key={r.id} data-sync-waiting-line={String(r.id)}>{Rec.entry(r) + (r.pc ? " from " + r.pc : "") + ", received " + tallyHm(r.received_at) + (r.state === "held" && r.held_why ? ", not yet entered in the books: " + r.held_why : ": " + why)}</div>)}
    </div>}
    <nav className="sbar" aria-label="Sync activity filter">{FILTERS.map(([id, label]) =>
      <button key={id} data-sync-filter={id} aria-selected={f === id} onClick={() => setF(id)}>{label}</button>)}</nav>
    {a.err && <p className="bk-warn"><Msg text={a.err} /></p>}
    {msg && <p className={msg.err ? "bk-alert bad" : "note"} data-sync-msg="" style={{ margin: "6px 0" }}>{msg.busy ? "Applying…" : msg.err || msg.ok}</p>}
    {/* the one list table (spec K6): saved in Tally (date), the entry (number), the computer, the state (status), then the rest;
        "Loading…" while the lines are read (K7) */}
    <ListTable name="syncActivity" className="data" rows={rows} rowKey={(r) => r.id} unit={["line", "lines"]} loading={a.rows === null || a.rows === undefined ? "the lines from Tally" : false}
      rowProps={(r) => ({ "data-sync-line": String(r.id) })}
      empty={<span data-sync-empty="">{f === "mismatch" ? "No mismatch: the ledger check of each line comes later." : f === "waiting" ? "Nothing waiting." : f === "held" ? "No line held." : f === "today" ? "No line today yet. Lines appear here as they are saved in Tally." : "No line from Tally yet. Lines appear here once a computer with FinCom’s recorder saves an entry in Tally."}</span>}
      cols={[
        { k: "saved", role: "date", label: "Saved in Tally", v: (r) => r.saved_at || "", cell: (r) => (r.saved_at ? tallyHm(r.saved_at) : "—") },
        { k: "entry", role: "number", label: "Entry", v: (r) => Rec.entry(r), cell: (r) => <>{Rec.entry(r)}{!S.syncClient && coName(r.client_id) && <div className="nr">{coName(r.client_id)}</div>}</> },
        { k: "pc", role: "party", label: "PC", v: (r) => r.pc || "", cell: (r) => r.pc || "—" },
        { k: "state", role: "status", label: "State", v: (r) => Rec.stateWords(r), cell: (r) => <span className={"tag " + (STATE_CLS[r.state] || "warn")} data-sync-state={r.state}>{Rec.stateWords(r)}</span> },
        { k: "act", label: "Action", v: (r) => Rec.actWords(r), cell: (r) => <span data-sync-act="">{Rec.actWords(r)}</span> },
        { k: "recv", label: "Reached FinCom", v: (r) => r.received_at || "", cell: (r) => (r.received_at ? tallyHm(r.received_at) : "—") },
        { k: "chk", label: "Ledger check", td: () => ({ className: "note", "data-sync-check": "" }), cell: () => "not checked" },
        { k: "ac", role: "act", cell: (r) => canApply && r.state === "held" && <button className="btn small" data-sync-release="" disabled={!!(msg && msg.busy)} onClick={() => Rec.release(r)}>Apply now</button> },
      ]} />
  </div>;
}
