// The Tally page's Sync activity (phase 2, H49/H50/H51; migration 44): every change saved in Tally as FinCom's cloud
// received it (tally_recorder_lines; Rec in src/js/61), newest first, 200 at most, for the firm or one client. A strip of
// the lines waiting over 2 minutes in one flow (Needs you / Being fetched, below); filters Waiting, Mismatch (the ledger check, F37-40: none yet), Today; an
// Apply now on a held line (tally_recorder_release_held; the owner's rule of 05-Oct-2026: any member who may write). New lines come in live (Live.joinRecorder, src/js/54).
import Msg from "../parts/Msg.jsx";
import ListTable from "../parts/ListTable.jsx";
import UnknownLedgers from "../parts/UnknownLedgers.jsx";
import { ClearBtn } from "../parts/Bell.jsx";

const FILTERS = [["all", "All"], ["waiting", "Waiting"], ["held", "Held"], ["mismatch", "Mismatch"], ["today", "Today"]];
// round 20 (d.4): "queued": the cloud queued the line (over 50 at once); its drain fills the state later
// 05-Oct-2026 (migration 50): "replaced": a later line of the same entry brought its details (greyed as a duplicate is)
const STATE_CLS = { applied: "ok", duplicate: "no", stale: "no", replaced: "no", held: "warn", received: "warn", queued: "warn", failed: "bad" };

// FinCom 2.3.5 (the owner: "in tally sync there is a yellow field coming all the time.. there should be clear flow"):
// the lines waiting over 2 minutes (Rec.flow, src/js/61) said in one flow instead of one permanent yellow box.
//   Needs you (yellow, the only yellow): lines nothing will settle until a person acts, one plain sentence per company
//     and day, with ONE action: Upload the Day Book for that day, or Apply now; the lines themselves under "Which entries";
//   Being fetched (quiet, grey): FinCom or the bridge is still at it; they enter the books by themselves;
//   nothing at all when nothing waits.
const n = (k) => k + (k === 1 ? " entry" : " entries");
// Clear (08-Oct-2026): each "Needs you" group and the "being fetched" note has a Clear; cleared (by this person: their
// lines, AlertClear in src/js/63-alerts.js) they are not shown again, until another line comes. The table below keeps
// every line, with its Apply now: clearing hides the notification only, it never applies or releases a line.
// the ONE action of a "Needs you" group (Rec.needKind, src/js/61): who may do it, else the words say who does
function NeedAction({ g, canApply, busy }) {
  const owner = Rec.owner(), day = g.day ? fmtDate(g.day) : "that day";
  const b = (act, label, go, extra) => <button className="btn small" data-needs-act={act} {...extra} onClick={go}>{label}</button>;
  switch (g.kind) {
    case "daybook": case "dupid":
      return canApply && g.cid ? b("daybook", "Upload the Day Book for " + day, () => Rec.uploadDay(g.cid, g.day), { "data-needs-daybook": "" }) : <span className="note">{" (a member of the firm who may write does this)"}</span>;
    case "readstop":
      return owner ? b("resume", "Resume reading", () => Rec.resumeOn(g), { "data-needs-resume": "" }) : null;
    case "baseline":
      return b("tally", "Open the Tally page", () => Rec.openTallyPage());
    case "masters":
      return g.cid ? b("masters", "Open From Tally", () => Rec.openClientTab(g.cid, "books:import")) : null;
    case "locked":
      return g.cid ? b("tieout", "Open Tie-out", () => Rec.openClientTab(g.cid, "books:tieout")) : null;
    default:
      return canApply ? b("apply", "Apply now", () => Rec.releaseAll(g.lines), { "data-needs-apply": "", disabled: busy, title: busy ? "Applying the lines already asked for" : undefined })
        : <span className="note">{" (a member of the firm who may write does this)"}</span>;
  }
}
function SyncFlow({ flow, canApply, busy }) {
  const AC = typeof AlertClear === "object" ? AlertClear : null;
  const needs = flow.needs.map((g) => ({ g, clr: AC ? AC.item("needs:" + g.key, g.lines.map((r) => AlertHub.lineAtom(r)), g.text) : null })).filter(({ clr }) => !clr || !AC.cleared(clr));
  const fclr = AC && flow.fetching.length ? AC.item("fetching:" + (S.syncClient || "all"), flow.fetching.map(({ r }) => AlertHub.lineAtom(r)), n(flow.fetching.length) + " being fetched from Tally") : null;
  const fetching = fclr && AC.cleared(fclr) ? [] : flow.fetching;
  if (!needs.length && !fetching.length) return null;
  const reasons = [...new Set(fetching.map((w) => w.why).filter((w) => / is offline$|^Tally not open on /.test(w)))];
  return <>
    {needs.length > 0 && <div className="bk-alert warn" data-sync-needs="" style={{ margin: "0 0 8px" }}>
      <b>Needs you</b>
      {needs.map(({ g, clr }) => <div key={g.key} data-needs-group={g.key} style={{ margin: "6px 0 0" }}>
        <span data-needs-text="">{g.text}</span>{" "}
        <NeedAction g={g} canApply={canApply} busy={busy} />
        {" "}<ClearBtn x={clr} />
        <details style={{ margin: "2px 0 0" }}><summary className="note" style={{ cursor: "pointer" }}>Which entries</summary>
          {g.lines.map((r) => <div key={r.id} className="note" data-sync-needs-line={String(r.id)}>{Rec.entry(r) + (r.pc ? " from " + r.pc : "") + ", received " + tallyHm(r.received_at) + (r.held_why ? ": " + r.held_why : "")}</div>)}</details>
      </div>)}
    </div>}
    {fetching.length > 0 && <div className="note" data-sync-fetching="" style={{ margin: "0 0 8px" }}>
      {n(fetching.length) + " being fetched from Tally; " + (fetching.length === 1 ? "it enters" : "they enter") + " the books by themselves" + (reasons.length ? " (now: " + reasons.join("; ") + ")" : "") + ". "}
      <details style={{ display: "inline" }}><summary style={{ cursor: "pointer", display: "inline" }}>Which entries</summary>
        {fetching.map(({ r, why }) => <div key={r.id} data-sync-fetching-line={String(r.id)}>{Rec.entry(r) + (r.pc ? " from " + r.pc : "") + ", received " + tallyHm(r.received_at) + (r.state === "held" && r.held_why ? ", not yet entered in the books: " + r.held_why : ": " + why)}</div>)}</details>
      {" "}<ClearBtn x={fclr} />
    </div>}
  </>;
}

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
  const rows = Rec.filtered(f), flow = Rec.flow(), msg = a.msg;
  const coName = (cid) => (S.companies && S.companies[cid] && S.companies[cid].name) || "";
  return <div className="pane" data-sync-activity="">
    {head}
    <p className="note" style={{ margin: "6px 0 8px" }}>Every change saved in Tally on a computer with FinCom’s recorder, as FinCom’s cloud received it: entered in the books, already in the books, or received and not yet entered, with the reason. Newest first.</p>
    <details className="note" data-sync-meaning="" style={{ margin: "0 0 8px" }}><summary style={{ cursor: "pointer" }}>What does this mean?</summary>
      <div style={{ marginTop: 4 }}><b>Needs you</b>: FinCom cannot settle these by itself; each line says the one thing to do (most often: upload that day’s Day Book). <b>Being fetched</b>: FinCom Bridge is still asking Tally for these entries; they enter the books by themselves. When nothing is said, nothing is waiting.</div></details>
    <SyncFlow flow={flow} canApply={canApply} busy={!!(msg && msg.busy)} />
    {/* the owner (06-Oct-2026): entries naming a ledger FinCom does not have yet, in plain words (migration 56) */}
    <UnknownLedgers cid={S.syncClient || ""} where="activity" names />
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
        { k: "state", role: "status", label: "State", v: (r) => Rec.stateWords(r), cell: (r) => <span className={"tag " + (STATE_CLS[r.state] || "warn")} data-sync-state={r.state} style={{ whiteSpace: "normal" }}>{Rec.stateWords(r)}</span> },
        { k: "act", label: "Action", v: (r) => Rec.actWords(r), cell: (r) => <span data-sync-act="">{Rec.actWords(r)}</span> },
        { k: "recv", label: "Reached FinCom", v: (r) => r.received_at || "", cell: (r) => (r.received_at ? tallyHm(r.received_at) : "—") },
        { k: "chk", label: "Ledger check", td: () => ({ className: "note", "data-sync-check": "" }), cell: () => "not checked" },
        { k: "ac", role: "act", cell: (r) => canApply && r.state === "held" && <button className="btn small" data-sync-release="" disabled={!!(msg && msg.busy)} onClick={() => Rec.release(r)}>Apply now</button> },
      ]} />
  </div>;
}
