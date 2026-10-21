// Tally: FinCom Bridge (02-Oct-2026, the owner's decision: the only bridge; FinCom 2.3.5: three steps until the first
// company is linked, then one card a computer with one status line, the rest under More: connect, the Tallys found,
// which client each company is, the check of this server's Tally, the reading test, the install help) and the books in FinCom's cloud. Was viewTallyHome (src/js/18),
// viewBridgeSettings, bridgeSetupSteps, bridgeDownHelp, viewBridgeDiagnosis and viewReadTest (src/js/24), and TCloud.view
// (src/js/49). The work is Bridge and TCloud; boxes and choices go through bridgeSet, bridgeLink, bridgePin, tcLink
// (src/js/24, 49), buttons through doAct (bridgeTest, bridgeConnect, bridgeOff, bridgeSetupFile, bridgeDiag, bridgeReadTest).
import Msg from "../parts/Msg.jsx";
import "../lib/tallyActs.js";
import ListTable from "../parts/ListTable.jsx";
import TallyPill from "../parts/TallyPill.jsx";
import SyncActivity from "./TallySync.jsx";
import { TallyStates, TallyHistory } from "../parts/TallyStates.jsx";
import { PostLog } from "./Done.jsx";
import CommitBox from "../parts/CommitBox.jsx";
import { lastEntry, companiesSeen } from "../parts/TallyLink.jsx";
import { useState, useEffect, lazy, Suspense } from "react";
// 2.4.5 (ROUND 102): after step 6, the same "Bring older entries from Tally" as Books › From Tally (its own lazy chunk)
const OlderEntries = lazy(() => import("../parts/OlderEntries.jsx"));

const Act = ({ act, className = "btn small", children, disabled }) => <button className={className} disabled={disabled} onClick={() => doAct(act)}>{children}</button>;

// round 19, guard (a): a trial tool, the owner's only (postOwner, src/js/59); staff do not see it
function ReadTest() {
  if (!Bridge.up() || !(typeof postOwner === "function" && postOwner())) return null;
  const r = S.readTest || {};
  return <div data-read-test="" style={{ marginTop: 10, borderTop: "1px solid var(--rule-soft)", paddingTop: 10 }}>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><b>Test reading entries</b><Act act="bridgeReadTest" disabled={!!r.busy}>{r.busy ? "Testing…" : "Run test"}</Act></div>
    <p className="note" style={{ margin: "4px 0" }}>Checks how FinCom can read entries from the company open in Tally (nothing is written). If posts are “not confirmed”, run this and send the result.</p>
    {r.error && <p className="bk-warn"><Msg text={r.error} /></p>}
    {r.tests && <><table className="data" data-statement=""><tbody>{r.tests.map((t, i) => <tr key={i}><td>{t.name}</td><td>{t.ok ? <><span className="tag ok">works</span>{" " + num(t.count) + " found" + (t.optional ? " (" + num(t.optional) + " Optional)" : "")}</> : <><span className="tag bad">failed</span>{" " + (t.error || "")}</>}</td><td className="n">{num(t.ms) + " ms"}</td></tr>)}</tbody></table>
      <p className="note" style={{ margin: "4px 0 0" }}>{(r.company || "") + " · port " + r.port + " · " + fmtDate(tallyDate(r.from)) + " to " + fmtDate(tallyDate(r.to))}</p></>}
  </div>;
}

function Diagnosis() {
  const d = Bridge.diag;
  const head = <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h3 style={{ margin: 0 }}>Check my Tally</h3><Act act="bridgeDiag">{d ? "Check again" : "Check now"}</Act></div>;
  if (!d) return <div className="bdiag">{head}<p className="note" style={{ margin: "6px 0 0" }}>Finds your TallyPrime on this server and explains anything that stops the connection.</p><ReadTest /></div>;
  if (d.error) return <div className="bdiag">{head}<p className="bk-warn"><Msg text={d.error} /></p></div>;
  return <div className="bdiag">{head}
    <p className="note" style={{ margin: "6px 0" }}>Bridge running as <b>{d.user || ""}</b>{" (Windows session " + d.mySession + ")."}</p>
    {(d.findings || []).map((f, i) => <div key={i} className={"bd-f " + f.level}><b>{(f.level === "ok" ? "✔ " : "⚠ ") + f.text}</b>{f.fix && <div className="bd-fix">{"What to do: " + f.fix}</div>}</div>)}
    {(d.tallies || []).length > 0 && <table className="data" style={{ marginTop: 8 }} data-statement=""><thead><tr><th>TallyPrime of</th><th>Accepting connections on</th><th>Its setting</th></tr></thead><tbody>
      {d.tallies.map((t, i) => <tr key={i}><td>{t.user || ("session " + t.session)}{t.mine && <> <span className="tag ok">you</span></>}</td><td>{t.ports.length ? "port " + t.ports.join(", ") : <span className="tag bad">not accepting</span>}</td>
        <td>{t.ini && t.ini.found ? (t.ini.mode || "?") + ", port " + (t.ini.port || "9000") : <span className="note">{"—"}</span>}</td></tr>)}</tbody></table>}
    {(d.tallies || []).some((t) => !t.mine) && <p className="note" data-session0="" style={{ margin: "6px 0 0" }}>{"Rows not marked “you”: " + SESSION0}</p>}
    {d.freePort && <p className="note" style={{ margin: "6px 0 0" }}>A free port on this server: <b>{d.freePort}</b>. Each user’s TallyPrime needs its own port.</p>}
    <ReadTest />
  </div>;
}

// FinCom Bridge's setup, from the test site's latest.json (assets/bridge-go): the one download, its fingerprint, its direct
// address and a PowerShell command for a server without a modern browser (review of 02-Oct-2026)
export function useSetup() {
  const [m, setM] = useState(undefined);
  useEffect(() => { fetch("assets/bridge-go/latest.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then(setM).catch(() => setM(null)); }, []);
  return m;
}
function BridgeDownload({ m, again }) {
  const set = setupOf(m);
  if (!set) return <div className="pane cn-card" data-bridge-card=""><h2>FinCom Bridge</h2>
    <p className="note" style={{ margin: 0 }}>{m === undefined ? "Reading…" : "The FinCom Bridge setup is not on this site yet."}</p></div>;
  const file = set.file, dl = set.dl;
  const ps = "[Net.ServicePointManager]::SecurityProtocol = 'Tls12'; Invoke-WebRequest -Uri \"" + dl + "\" -OutFile \"$env:USERPROFILE\\Downloads\\" + file + "\"";
  return <div className="pane cn-card" data-bridge-card="">
    <h2>{again ? "Install FinCom Bridge again or on another computer" : "FinCom Bridge"}</h2>
    <p className="note" style={{ margin: "0 0 10px" }}>Install it on the computer where TallyPrime runs. It installs <b>just for you, without an administrator</b>, takes off any older bridge on that computer (keeping its pairing, settings and copy of the books), becomes the main bridge and runs in the background: only its icon shows, near the clock.</p>
    <a className="btn" data-bridge-download="" href={set.href} download={file}>Download FinCom Bridge {set.version}</a>
    <p className="note" style={{ fontSize: 12, margin: "10px 0 0" }}>Fingerprint (SHA-256): <code data-bridge-sha="" style={{ userSelect: "all", wordBreak: "break-all" }}>{set.sha}</code></p>
    <p className="note" style={{ margin: "6px 0 0" }}>Direct link: <a href={dl} data-bridge-link="">{dl}</a></p>
    <p className="note" style={{ margin: "6px 0 4px" }}>Or paste this into Windows PowerShell; the setup lands in your Downloads folder:</p>
    <pre className="cmd" data-bridge-ps="" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", userSelect: "all", fontSize: 12, background: "var(--sheet-2, #F4F6F5)", padding: 10, borderRadius: 6, margin: 0 }}>{ps}</pre>
    <p className="note" style={{ margin: "8px 0 0" }}>Not signed yet: if Windows says “Windows protected your PC”, press <b>More info</b>, then <b>Run anyway</b>.</p>
    <details style={{ marginTop: 8 }}><summary className="note" style={{ cursor: "pointer" }}>Windows blocked it, or the setup failed?</summary><BlockedHelp /></details>
  </div>;
}

// the bridges heard from are read again after a minute (another computer may have started)
function paneFresh() {
  const p = TCloud.pane;
  if (TCloud.on() && !p.busy && !p.err && (p.devices === null || Date.now() - (p.at || 0) > 60000)) { p.at = Date.now(); setTimeout(() => TCloud.refreshPane(), 0); }
}
// one line a computer (02-Oct-2026): the computer, the Windows user, the version, and the state with what to do
const vnum = (v) => String(v || "0").split(".").map((x) => Number(x) || 0).reduce((a, x) => a * 1000 + x, 0);
function lineState(r, latest, owner) {
  if (!r.go || r.old) return { text: "Needs FinCom Bridge", cls: "bad", act: "Install FinCom Bridge below on " + r.computer + ": it replaces this one by itself." };
  if (!r.online) return { text: "Offline" + (r.at ? " since " + fmtDateTime(r.at) : ""), cls: "bad", act: "On " + r.computer + ", sign in to Windows as " + (r.user || "the Tally user") + ": FinCom Bridge starts by itself. Its icon near the clock: right-click → Test connection." };
  if (!r.main) return { text: "Online · reads only", cls: "warn", act: owner ? "Another bridge posts on this computer." : "Another bridge posts on this computer; an owner of the firm can make this the main bridge.", makeMain: owner };
  // the owner's rule of 05-Oct-2026 (migration 54): a new version goes to every computer by itself, unless an owner held it
  // (or withdrew it) or rolled the bridges back
  if (latest && vnum(latest) > vnum(r.version)) {
    const p = TCloud.pane, rel = (p.releases || []).find((x) => x.version === latest), stopped = !!(p.rollback || (rel && (rel.held_at || rel.withdrawn_at)));
    return { text: "Online · update ready", cls: "warn", act: p.releases && !p.noControl
      ? (stopped ? "Version " + latest + " is held back on the owner's word (under More)." : "It updates itself to version " + latest + " (each bridge checks every few hours).")
      : "Download FinCom Bridge " + latest + " under More and run it on " + r.computer + "." };
  }
  if (r.tally === "busy") return { text: "Online · Tally busy", cls: "warn", act: "It carries on when Tally is free." };
  if (r.tally !== "open") return { text: "Online · Tally not open", cls: "warn", act: "Open TallyPrime and the company on " + r.computer + "." };
  return { text: "Online · Tally open", cls: "ok", act: r.open.length ? r.open.join(", ") : "" };
}
// plan item 14 (All clients → Tally): with each computer, its reading state (Reading / Paused / 2.3.1: "Tally did not
// answer in time at 12:14; trying again by itself at 12:15" / Stopped from FinCom: why / Offline since …), its last request to Tally and its longest today (the heartbeat's reqs),
// and for an owner: Stop reading on this computer / on all computers, Resume reading, and the release (the owner's rule of
// 05-Oct-2026: Hold version X, Let it go, Roll back, Withdraw; X: this site's setup). The cloud checks every one again
// (migrations 35, 37, 54); its refusal is shown as it says it.
const RS_CLS = { reading: "ok", paused: "warn", retrying: "warn", fincomstop: "bad", offline: "bad" };
function Reqs({ r }) {
  const q = r.reqs || {}, today = !q.day || q.day === new Date().toISOString().slice(0, 10);
  const last = TCloud.reqSay(q.last), long = today ? TCloud.reqSay(q.longest) : "";
  if (!last && !long) return null;
  return <span className="note" data-reqs="">{[last && "Last request: " + last, long && "Longest today: " + long, today && q.over20 ? q.over20 + " over 20 s" : ""].filter(Boolean).join(" · ")}</span>;
}
// who did it (round 4, item 24): the firm member's name, else e-mail (memberName, src/js/51)
const who = (uid) => typeof memberName === "function" ? memberName(uid) : "a member of the firm";
const NOT_READY = "FinCom’s cloud is not ready for this yet";
function Release({ rows, latest, owner }) {
  if (!latest || !TCloud.on()) return null;
  const p = TCloud.pane, rel = (p.releases || []).find((x) => x.version === latest), rb = p.rollback || null;
  const wd = !!(rel && rel.withdrawn_at), held = !!(rel && rel.held_at);
  if (!p.releases && !rb) return null;
  // the owner's rule of 05-Oct-2026 (migration 54): no pilot, no approval; an owner holds a version, lets it go, rolls
  // the bridges back, clears that; withdraws a version (migration 37). Who, when and why are said
  const lines = [held && "Held by " + who(rel.held_by) + " at " + tallyHm(rel.held_at) + ": " + (rel.held_why || "no reason given"),
    wd && "Withdrawn by " + who(rel.withdrawn_by) + " at " + tallyHm(rel.withdrawn_at) + ": " + (rel.withdrawn_why || "no reason given")].filter(Boolean);
  return <div className="row" data-release="" style={{ alignItems: "center", gap: 8, flexWrap: "wrap", margin: "6px 0 2px" }}>
    {rb ? <span className="note" data-release-rolled-back="">{"Rolled back to version " + rb.version + " by " + who(rb.set_by) + " at " + tallyHm(rb.set_at) + ": " + (rb.why || "no reason given") + ". No bridge takes a newer version until the rollback is cleared."}</span>
      : wd ? <span className="note" data-release-withdrawn="">{"Version " + latest + " is withdrawn: no computer gets it from FinCom’s cloud."}</span>
      : held ? <span className="note" data-release-held="">{"Version " + latest + " is held: no bridge takes it until an owner lets it go."}</span>
      : <span className="note">{"Version " + latest + " goes to every computer by itself (each bridge checks every few hours)."}</span>}
    {lines.length > 0 && <span className="note" data-release-who="">{lines.join(" ")}</span>}
    {owner && !p.noHold && !wd && !held && !rb && <button className="btn small" data-release-hold="" onClick={() => TCloud.releaseHold(latest)}>{"Hold version " + latest}</button>}
    {owner && !p.noHold && held && <button className="btn small" data-release-unhold="" onClick={() => TCloud.releaseUnhold(latest)}>{"Let version " + latest + " go"}</button>}
    {owner && !p.noRollback && (rb ? <button className="btn small" data-release-rollback-clear="" onClick={() => TCloud.releaseRollbackClear()}>Clear the rollback</button>
      : <button className="btn small" data-release-rollback="" onClick={() => TCloud.releaseRollback()}>Roll back to an earlier version</button>)}
    {owner && rel && !wd && (p.noWithdraw
      ? <span className="note" data-not-ready="">{NOT_READY + " (withdrawing a version needs migration 37)."}</span>
      : <button className="btn small" data-release-withdraw="" onClick={() => TCloud.releaseWithdraw(latest)}>{"Withdraw version " + latest}</button>)}
  </div>;
}
// item 24: on a computer's line, who stopped reading from FinCom (or resumed it) and when
function ReadWho({ r }) {
  const st = TCloud.stopFor ? TCloud.stopFor(r.device.id) : null;
  if (st && (st.stopped_by || st.stopped_at)) return <span className="note" data-read-who="">{"Stopped by " + who(st.stopped_by) + (st.stopped_at ? " at " + tallyHm(st.stopped_at) : "") + ": " + (st.reason || "no reason given") + (st.device_id ? "" : " (all computers)")}</span>;
  if (st) return null;
  const rs = TCloud.resumeFor ? TCloud.resumeFor(r.device.id) : null;
  return rs && rs.at ? <span className="note" data-read-who="">{"Resumed by " + who(rs.by) + " at " + tallyHm(rs.at)}</span> : null;
}
// item 10: under a computer, its companies whose reading needs a fresh baseline (why, since when) with the owner's
// Clear (note), and the ones cleared this week (by whom, when, the note)
function Baselines({ r, owner }) {
  const list = TCloud.baselines ? TCloud.baselines(r.device.id) : [];
  if (!list.length) return null;
  return <div style={{ marginLeft: 16 }}>{list.map(({ book, company, cur }) => <div key={book} className="row" data-baseline={book} style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
    {cur.state === "needs_baseline" ? <><span className="tag bad">{company}</span><span className="note">{"Needs a fresh baseline since " + tallyHm(cur.state_at) + ": " + (cur.state_why || "no reason given")}</span>
        {owner && (TCloud.pane.noBaselineClear ? <span className="note" data-not-ready="">{NOT_READY + " (clearing a baseline needs migration 37)."}</span>
          : <button className="btn small" data-baseline-clear={book} onClick={() => TCloud.baselineClear(book, company)}>Clear (note)</button>)}</>
      : <><span className="tag ok">{company}</span><span className="note" data-baseline-cleared="">{"Cleared by " + who(cur.cleared_by) + " at " + tallyHm(cur.cleared_at) + ": " + (cur.cleared_note || "no note")}</span></>}
  </div>)}</div>;
}
// next release (item e, migration 65): under a computer, each company's last nightly self-check in the cloud's own plain
// words (green: every change in FinCom, or the missing ones fetched; red: entries still missing, not checked, or FinCom's
// copy not adding up; amber: no check for more than two nights). Nothing to press
function SelfChecks({ r }) {
  const list = TCloud.selfChecks ? TCloud.selfChecks(r.device.id, r.id) : [];
  if (!list.length) return null;
  return <div data-selfchecks="">{list.map(({ book, company, row, old }) => {
    const bad = row.result === "missing" || row.result === "not_checked" || row.copy_ok === false;
    const words = old ? "Not checked since the night of " + fmtDate(row.night || row.ran_at) + ". The last check: " + (row.words || "") : (row.words || "");
    return <div key={book || company} className="row" data-selfcheck={book || company} data-selfcheck-result={row.result || ""} style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span className={"tag " + (old ? "warn" : bad ? "bad" : "ok")}>{company}</span><span className="note" data-selfcheck-words="">{words}</span>
    </div>;
  })}</div>;
}
// FinCom Bridge 2.1.6 posts only to the companies in its PostOnly setting (the owner's own setting per computer); its
// heartbeat carries postOnly ([] when unrestricted) and tally-ingest keeps it on the bridge entry (info.bridges[id].postOnly)
// and on the device record (info.beat.postOnly). The bridge entry first, then the beat; empty or absent: nothing to say.
function postOnlyOf(r) {
  const info = (r.device && r.device.info) || {}, b = (info.bridges || {})[r.id] || {};
  const list = Array.isArray(b.postOnly) ? b.postOnly : Array.isArray((info.beat || {}).postOnly) ? info.beat.postOnly : [];
  return list.map((x) => String(x || "").trim()).filter(Boolean);
}
// round 15 (F3): the posting settings of a computer. The line shows the values the bridge APPLIED (its heartbeat:
// postOnly, postBatchBills, postBatchBank, settingsAt on info.bridges[id], else info.beat); an owner edits them (Posts
// only to: names, empty = any company; bills per request, default 10; bank lines per request, default 50) -> TCloud
// .postSettings -> tally_device_post_settings; while the saved values (tally_devices.post_*) differ from the applied
// ones the line says "waiting for the bridge to apply (within a minute)". A member sees the values. Without migration
// 43 (the columns or the RPC missing) the line says so
const PS_NAMES = (v) => Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : null;
function postApplied(r) {
  const info = (r.device && r.device.info) || {}, b = (info.bridges || {})[r.id] || {}, bt = info.beat || {};
  const pick = (k) => b[k] !== undefined ? b[k] : bt[k];
  return { only: PS_NAMES(pick("postOnly")), bills: pick("postBatchBills"), bank: pick("postBatchBank"), at: pick("settingsAt") || "" };
}
function PostSettings({ r, owner }) {
  const [edit, setEdit] = useState(false), [v, setV] = useState({ only: "", bills: "", bank: "" }), [why, setWhy] = useState("");
  const d = r.device || {}, p = TCloud.pane;
  if (p.noPostSettings) return <span className="note" data-post-settings="" data-not-ready="">Posting settings: not available until migration 43 runs</span>;
  const ap = postApplied(r), saved = { only: PS_NAMES(d.post_only), bills: d.post_batch_bills, bank: d.post_batch_bank };
  const shown = { only: ap.only || saved.only || [], bills: num(ap.bills) || num(saved.bills) || 10, bank: num(ap.bank) || num(saved.bank) || 50 };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const waiting = !!d.post_settings_at && !(same(saved.only || [], ap.only || []) && (num(saved.bills) || 10) === (num(ap.bills) || 10) && (num(saved.bank) || 50) === (num(ap.bank) || 50));
  // only0: the names as the box opened, so Save knows whether the owner touched them (p_post_only null when not)
  const open = () => { const only = (saved.only || ap.only || []).join(", "); setV({ only, only0: only, bills: String(num(saved.bills) || shown.bills), bank: String(num(saved.bank) || shown.bank) }); setWhy(""); setEdit(true); };
  const save = async () => { const w = await TCloud.postSettings(d, v); setWhy(w); if (!w) setEdit(false); };
  return <span className="note" data-post-settings="" data-ps-waiting={waiting ? "" : undefined}>
    {"Posting settings: posts only to " + (shown.only.length ? shown.only.join(", ") : "any company") + " · " + shown.bills + " bills per request · " + shown.bank + " bank lines per request"}
    {waiting && <> <span className="bk-warn" data-ps-waiting="">{"— waiting for the bridge to apply (within a minute): saved " + (saved.only ? (saved.only.length ? saved.only.join(", ") : "any company") : "") + (saved.bills != null ? " · " + saved.bills + " bills" : "") + (saved.bank != null ? " · " + saved.bank + " bank lines" : "")}</span></>}
    {owner && !edit && <> <button className="linkbtn" data-ps-edit="" onClick={open}>Edit</button></>}
    {owner && edit && <span className="row" style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginLeft: 6 }}>
      <input type="text" data-ps-only="" aria-label="Posts only to (company names, comma-separated; empty = any company)" placeholder="Posts only to (names, comma-separated; empty = any)" value={v.only} style={{ width: 260 }} onChange={(ev) => setV({ ...v, only: ev.target.value })} />
      <input type="number" data-ps-bills="" aria-label="Bills per request" min="1" max="500" value={v.bills} style={{ width: 64 }} onChange={(ev) => setV({ ...v, bills: ev.target.value })} /><span>bills</span>
      <input type="number" data-ps-bank="" aria-label="Bank lines per request" min="1" max="500" value={v.bank} style={{ width: 64 }} onChange={(ev) => setV({ ...v, bank: ev.target.value })} /><span>bank lines per request</span>
      <button className="btn small primary" data-ps-save="" onClick={save}>Save</button>
      <button className="btn small" data-ps-cancel="" onClick={() => setEdit(false)}>Cancel</button>
      {why && <span className="bk-warn" data-ps-why="">{why}</span>}
    </span>}
  </span>;
}
// round 19 (the owner's decision, 04-Oct): "Trial tools on this computer", per computer, default off. The state is
// tally_devices.trial_tools (migration 46; TCloud.refreshPane reads it apart, p.noTrialTools when the column is missing);
// an owner's switch -> TCloud.trialTools -> tally_device_trial_tools(p_device, p_on); the bridge shows its tray's trial
// items only while it is on. Staff see the state only
function TrialTools({ r, owner }) {
  const d = r.device || {}, p = TCloud.pane;
  if (p.noTrialTools) return <span className="note" data-trial-tools="" data-not-ready="">Trial tools on this computer: not available until migration 46 runs</span>;
  const on = d.trial_tools === true;
  return <span className="note" data-trial-tools="" data-trial-on={on ? "" : undefined}>
    {"Trial tools on this computer: " + (on ? "on" : "off")}
    {owner && <> <button className="btn small" data-trial-tools-switch="" disabled={!!(p.ctl && p.ctl.busy)} onClick={() => TCloud.trialTools(d, !on)}>{on ? "Switch off" : "Switch on"}</button></>}
  </span>;
}
// round 20 (d.3): where this computer's changes come from (tally_devices.recorder_source, migration 47; addon |
// alterid | both, the add-on when not set). An owner picks it -> TCloud.recorderSource -> tally_device_recorder_source;
// staff see the value only; without the column (p.noRecorderSource) nothing is shown
function RecorderSource({ r, owner }) {
  const d = r.device || {}, p = TCloud.pane;
  if (p.noRecorderSource || !p.devices) return null;
  const v = TCloud.RECORDER_SOURCES.some(([k]) => k === d.recorder_source) ? d.recorder_source : "addon";
  const words = (TCloud.RECORDER_SOURCES.find(([k]) => k === v) || [])[1];
  if (!owner) return <span className="note" data-recorder-source="">{"Changes come from: " + words}</span>;
  return <span className="note" data-recorder-source="">{"Changes come from: "}
    <select data-recorder-source-pick="" aria-label={"Where the changes on " + r.computer + " come from"} value={v} disabled={!!(p.ctl && p.ctl.busy)}
      onChange={(ev) => TCloud.recorderSource(d, ev.target.value)}>
      {TCloud.RECORDER_SOURCES.map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select></span>;
}
// phase 2 (F36, N102): Tally's change recorder on this computer (the bridge's heartbeat: info.bridges[id].recorder,
// FinCom Bridge 2.1.9 on). 17-Oct-2026: one neutral fact for support (no "not recording", nothing to load or turn on;
// FinCom Bridge 2.4.5 puts the add-on into Tally itself): when its lines last reached FinCom, else none in 7 days
const REC_WEEK = 7 * 864e5;
function RecorderLine({ r }) {
  const rc = Rec.recOf(r.device);
  if (!rc) return null;
  const at = Object.values(rc).map((x) => String((x && x.lastAt) || "")).filter((x) => Date.parse(x)).sort().pop() || "";
  const fresh = at && Date.now() - Date.parse(at) <= REC_WEEK;
  return <div className="row" data-recorder="" style={ROW}>
    <span className="note" data-recorder-last={fresh ? at : ""}>{"Add-on lines last received: " + (fresh ? fmtDateTime(at) : "none in 7 days")}</span>
  </div>;
}
// FinCom Bridge 2.3.2 (issue 232): the companies whose entries this bridge no longer asks Tally for, because finding one
// entry took Tally longer than 2 seconds (the beat's recorderBodyFetch, kept by tally-ingest as recorderOff.bodies on the
// bridge's own entry: {company: {off, seconds, at, why}}), one line per company. A 2.2.x bridge's recorderOff (its 2-second
// switch-off, which 2.3.1 lifted) is never shown: only a bridge of version 2.3.2 or later says it this way
const verAtLeast = (v, w) => { const a = String(v || "").split(".").map((x) => parseInt(x, 10) || 0), b = w.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i];
  return true; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "07-Oct 10:05": the time as the bridge wrote it (its computer's own clock), never moved to another zone
const sinceWords = (at) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(at || "")); return m && MONTHS[+m[2] - 1] ? m[3] + "-" + MONTHS[+m[2] - 1] + " " + m[4] + ":" + m[5] : ""; };
function SlowCompanies({ r }) {
  const bodies = r.recorderOff && typeof r.recorderOff.bodies === "object" ? r.recorderOff.bodies : null;
  if (!bodies || !verAtLeast(r.version, "2.3.2")) return null;
  const names = Object.keys(bodies).filter((co) => co && bodies[co] && bodies[co].off === true).sort();
  if (!names.length) return null;
  return <div data-slow-companies="" style={{ marginLeft: 16 }}>{names.map((co) => { const s = sinceWords(bodies[co].at);
    return <div key={co} className="note" data-slow-company={co}>{co + ": FinCom has stopped asking Tally for this company's entries, because finding one entry took Tally longer than 2 seconds" +
      (s ? " (since " + s + ")" : "") + ". New entries wait as held lines; upload that day's Day Book to settle them. This lifts when a faster FinCom Bridge is installed."}</div>; })}</div>;
}
// FinCom Bridge 2.3.0 (one bridge for each Windows user on a shared server): where this bridge reads and posts: its
// Tally's port, the companies open there and the data folder, as its heartbeat says them (nothing when it says none)
function BridgeWhere({ r }) {
  const parts = [r.tallyPort ? "Tally port " + r.tallyPort : "", (r.open || []).join(", "), r.dataFolder ? "data folder " + r.dataFolder : ""].filter(Boolean);
  if (!parts.length) return null;
  return <span className="note" data-bridge-where="">{parts.join(" · ")}</span>;
}
// migration 54: "Changes only", an owner's switch per bridge: it reads Tally's changes and never takes a posting; the Post
// screen never offers it. Staff see the state only; an older cloud (no table) shows nothing
function ChangesOnly({ r, owner }) {
  const p = TCloud.pane;
  if (p.noTarget || !r.id) return null;
  const on = !!r.changesOnly;
  return <span className="note" data-changes-only="" data-changes-on={on ? "" : undefined}>
    {on ? <span className="tag warn">Changes only: never posts</span> : "Reads and posts"}
    {owner && <> <button className="btn small" data-changes-only-switch="" disabled={!!(p.ctl && p.ctl.busy)} onClick={() => TCloud.changesOnly(r, !on)}>{on ? "Allow posting" : "Changes only"}</button></>}
  </span>;
}
// migration 54: the members who post through this bridge (an owner links anyone; a member's postings go through their own
// bridge by default). The owner's rule of 05-Oct-2026: a member who may write links THEMSELVES to their own bridge (on a
// computer key they made, or this browser's own), when it posts for nobody else
function MemberLink({ r, owner }) {
  const p = TCloud.pane;
  if (p.noTarget || !r.id) return null;
  const members = (Cloud.st && Cloud.st.members) || [], name = (uid) => { const m = members.find((x) => x.user_id === uid); return m ? (m.name || m.email || uid) : uid; };
  const linked = TCloud.linkedTo(r), others = members.filter((m) => m.active !== false && !linked.includes(m.user_id));
  const me = TCloud.me(), role = S.account && S.account.me ? S.account.me.role : "";
  // final review M3: a member links himself only to a bridge on a computer key he made (his own bridge's key)
  const self = !owner && !!me && ["owner", "staff"].includes(role) && !linked.length && !r.changesOnly && r.device.created_by === me;
  if (!owner && !linked.length && !self) return null;
  return <span className="note" data-member-link="">
    {"Posts for: " + (linked.length ? linked.map(name).join(", ") : "nobody linked yet")}
    {self && <> <button className="btn small" data-member-link-self="" disabled={!!(p.ctl && p.ctl.busy)} onClick={() => TCloud.linkMember(me, r)}>Post through this bridge (mine)</button></>}
    {owner && linked.map((uid) => <button key={uid} className="linkbtn" data-member-unlink={uid} onClick={() => TCloud.linkMember(uid, null)}>{" (unlink " + name(uid) + ")"}</button>)}
    {owner && <> <button className="linkbtn" data-release-identity={r.id} onClick={() => TCloud.releaseIdentity(r)}>Release this bridge's identity</button></>}
    {owner && !r.changesOnly && others.length > 0 && <> <select data-member-link-pick="" aria-label={"Link a member to " + TCloud.bridgeWords(r)} value="" disabled={!!(p.ctl && p.ctl.busy)}
      onChange={(ev) => ev.target.value && TCloud.linkMember(ev.target.value, r)}>
      <option value="">Link a member…</option>{others.map((m) => <option key={m.user_id} value={m.user_id}>{m.name || m.email || m.user_id}</option>)}</select></>}
  </span>;
}
// FinCom 2.3.5, the simpler Tally page (the owner: "tally option is so confusing that i am also not able to connect
// properly"): one card a computer and Windows user with ONE plain status line, "Connected · Tally open: GARG SHEKHAR
// (port 9005) · last entry 2 min ago"; when something is wrong the line names the problem and the ONE thing that fixes
// it (an owner's button when there is one). Everything else is under the card's More (and the page's More, below),
// nothing removed: the same parts, the same owner-only rules. The More toggles are remembered in S.tallyMore while
// FinCom is open, so a refresh of the page does not fold them away.
const moreOpen = (k) => !!(S.tallyMore && S.tallyMore[k]);
const moreFlip = (k) => { S.tallyMore = Object.assign({}, S.tallyMore || {}, { [k]: !moreOpen(k) }); render(); };
function MoreToggle({ k, label = "More", less = "Less", ...rest }) {
  const on = moreOpen(k);
  return <button className="linkbtn" data-more-toggle={k} aria-expanded={on ? "true" : "false"} onClick={() => moreFlip(k)} {...rest}>{on ? less : label}</button>;
}
// "2 min ago" / "3 h ago" / "on 07-Oct-2026 10:05 IST": how long ago something happened, in plain words
function agoWords(at) {
  const t = Date.parse(String(at || "")); if (!t) return "";
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  return min < 1 ? "just now" : min < 60 ? min + " min ago" : min < 24 * 60 ? Math.floor(min / 60) + " h ago" : "on " + fmtDateTime(t);
}
// the last entry Tally's change recorder saw on this computer (its companies open), else the last read in its heartbeat
function lastEntryAt(r) {
  const rc = typeof Rec === "object" && Rec.recOf ? Rec.recOf(r.device) : null, open = r.open || [];
  let best = "";
  if (rc) Object.keys(rc).forEach((co) => { const x = rc[co] || {}; if ((!open.length || open.includes(co)) && x.lastAt && String(x.lastAt) > best) best = String(x.lastAt); });
  if (!best && r.main) [].concat(((r.device.info || {}).beat || {}).companies || []).forEach((c) => { const a = c && (c.lastRead || c.at); if (a && String(a) > best) best = String(a); });
  return best;
}
// FinCom Bridge's setup on this site: {file, href (with its fingerprint), dl (the plain address), version, sha}
function setupOf(m) {
  const set = m && m.setup;
  if (!set) return null;
  const file = set.url.split("/").pop();
  return { file, version: set.version, sha: set.sha256, href: "assets/bridge-go/" + file + "?v=" + set.sha256.slice(0, 12), dl: new URL("assets/bridge-go/" + file, location.href).href.replace(/[?#].*$/, "") };
}
export const DownloadBtn = ({ m, primary }) => { const s = setupOf(m);
  return s ? <a className={"btn small" + (primary ? " primary" : "")} data-bridge-download="" href={s.href} download={s.file}>{"Download FinCom Bridge " + s.version}</a>
    : <span className="note">{m === undefined ? "Reading…" : "The FinCom Bridge setup is not on this site yet."}</span>; };
const ROW = { alignItems: "center", gap: 8, flexWrap: "wrap", margin: "4px 0" };
// ---------------------------------------------------------------------------------------------------------------------
// The Tally redesign (the owner, 09-Oct-2026: "Tally link page is also very confusing.. multiple ports.. what should i do
// with that.. whatever actionable is or what relevant information is.. this should be there"): "Your Tally connection".
//   1. Needs you: only what a person must do, one plain line each with ONE button ("Tally is not open on NWS144
//      (anshul)", "Reading stopped by Anshul: Resume", "Install FinCom Bridge 2.4.0 on LAPTOP (ravi): Download",
//      "3 entries of ABC need that day's Day Book: Upload");
//   2. one card a computer and Windows user ("NWS144 · anshul"): its state in words (Connected / Not connected / Needs
//      you), the companies it reads, the last entry received (IST), at most one main action;
//   3. Details (folded, per card): the bridge's version, ports and data folder, requests to Tally, the slow companies,
//      the recorder, the starting points, the nightly checks; and the owner's Settings: Stop/Resume reading, Changes
//      only, the members it posts for, Posting settings, Trial tools, where the changes come from, Make main. Staff see
//      the words without the owner's buttons, as before. Nothing was removed: the same parts, the same RPCs.
// ---------------------------------------------------------------------------------------------------------------------
const isOwner = () => !!(S.account && S.account.me && S.account.me.role === "owner");
// "NWS144 · anshul" (the card's name) and "NWS144 (anshul)" (in a sentence)
const pcName = (r) => r.computer + (r.user ? " · " + r.user : "");
const pcWords = (r) => r.computer + (r.user ? " (" + r.user + ")" : "");
// "2 min ago (14:03 IST)"; older than a day: the date and time
const whenWords = (at) => { const a = agoWords(at); if (!a) return ""; return /^on /.test(a) ? a.slice(3) : a + " (" + tallyHm(at) + ")"; };
// one card a computer and Windows user: the main bridge of that user, else the newest (as before)
function cardsOf(rows) {
  const byDev = new Map();
  rows.forEach((r) => { const k = r.device.id + "|" + String(r.user || "").toLowerCase(), h = byDev.get(k); if (!h || (r.main && r.go && !(h.main && h.go)) || (r.go && !h.go)) byDev.set(k, r); });
  return [...byDev.values()];
}
const cardKey = (r) => "pc:" + r.device.id + "|" + String(r.user || "").toLowerCase();
// what this computer needs from a person, in one line, and its one action (null: nothing):
//   {kind, text, act: download | resume | makeMain | baseline | check | details | "", say (staff: who can), book, company}
// The order is statusOf's (an older bridge, offline, stopped from FinCom, paused, Tally not open, reads only, a company
// needing a fresh starting point, a slow company, a version to install by hand)
function needOf(r, latest, owner, allStopped) {
  const pc = pcWords(r), rd = r.read || { state: r.online ? "reading" : "offline", text: "" }, p = TCloud.pane;
  if (!r.go || r.old) return { kind: "install", text: "Install FinCom Bridge" + (latest ? " " + latest : "") + " on " + pc + ": it replaces the older bridge by itself", act: "download" };
  if (!r.online) return { kind: "offline", text: pc + " is not connected" + (r.at ? " since " + tallyHm(r.at) : "") + ". Sign in to Windows there as " + (r.user || "the Tally user") + ": FinCom Bridge starts by itself", act: "check" };
  if (rd.state === "fincomstop") {
    if (allStopped) return null;
    const st = (TCloud.stopFor && TCloud.stopFor(r.device.id)) || {};
    return { kind: "stopped", text: "Reading stopped" + (st.stopped_by ? " by " + who(st.stopped_by) : "") + " on " + pc + ": " + (rd.reason || st.reason || "no reason given"), act: owner ? "resume" : "", say: owner ? "" : "An owner of the firm can resume it." };
  }
  if (rd.state === "paused") return { kind: "paused", text: "Reading is paused on " + pc + ". To resume: " + RESUME_TRAY, act: "check" };
  if (r.tally !== "open" && r.tally !== "busy") return { kind: "tally", text: "Tally is not open on " + pc + ". Open TallyPrime and the company there", act: "check" };
  if (!r.main) return { kind: "main", text: pc + " only reads: another bridge on this computer posts", act: owner ? "makeMain" : "", say: owner ? "" : "An owner of the firm can make it the main bridge." };
  const base = (TCloud.baselines ? TCloud.baselines(r.device.id) : []).filter((x) => x.cur && x.cur.state === "needs_baseline");
  if (base.length) return { kind: "baseline", text: base[0].company + " needs a fresh starting point on " + pc + ": " + (base[0].cur.state_why || "no reason given"), act: owner && !p.noBaselineClear ? "baseline" : "", say: owner ? "" : "An owner of the firm clears it.", book: base[0].book, company: base[0].company };
  const bodies = r.recorderOff && typeof r.recorderOff.bodies === "object" && verAtLeast(r.version, "2.3.2") ? r.recorderOff.bodies : {};
  const slow = Object.keys(bodies).filter((co) => co && bodies[co] && bodies[co].off === true).sort();
  if (slow.length) return { kind: "slow", text: "Tally on " + pc + " is too slow to send " + slow.join(", ") + "'s entries one by one: new entries wait until that day's Day Book is uploaded", act: "details" };
  if (latest && vnum(latest) > vnum(r.version) && !(p.releases && !p.noControl)) return { kind: "version", text: "Install FinCom Bridge " + latest + " on " + pc, act: "download" };
  return null;
}
// the one button of a Needs you line or a card. In Needs you (top) the buttons carry data-need-act (the card keeps the
// controls' own hooks: data-read-resume, data-make-main, data-baseline-clear, data-bridge-download), so each control
// is found once; both call the same function
function NeedAct({ r, n, m, top }) {
  if (!n) return null;
  const h = (k, v) => top ? { "data-need-act": n.act } : { [k]: v };
  if (n.act === "download") { const s = setupOf(m);
    return s ? <a className="btn small primary" {...h("data-bridge-download", "")} href={s.href} download={s.file}>{"Download FinCom Bridge " + s.version}</a> : <DownloadBtn m={m} primary />; }
  if (n.act === "resume") return <button className="btn small primary" {...h("data-read-resume", r.device.id)} onClick={() => TCloud.readResume(r)}>{top ? "Resume" : "Resume reading"}</button>;
  if (n.act === "makeMain") return <button className="btn small primary" {...h("data-make-main", r.id)} onClick={() => TCloud.makeMain(r)}>Make this the main bridge</button>;
  if (n.act === "baseline") return <button className="btn small primary" data-need-act="baseline" onClick={() => TCloud.baselineClear(n.book, n.company)}>Clear it</button>;
  if (n.act === "check") return <button className="btn small" {...h("data-check-again", "")} onClick={() => TCloud.refreshPane()}>Check again</button>;
  if (n.act === "details") return <button className="btn small" {...h("data-open-details", "")} onClick={() => { S.tallyMore = Object.assign({}, S.tallyMore || {}, { [cardKey(r)]: true }); render(); }}>Details</button>;
  return n.say ? <span className="note">{n.say}</span> : null;
}
// ---------------------------------------------------------------------------------------------------------------------
// The calm Tally page (15-Oct-2026; the owner: "all these fields are coming in tally linking.. many of them are not
// useful.. clean it and make this user friendly"; "why we need gb texcoat info.. check how Biz Analyst and other
// providers are providing these things"; "I have opened Tally but it is not connected. I don't know how to connect even").
// Like the other Tally connectors, the page answers a few questions and keeps the rest in ONE closed fold:
//   0. How do I connect? Connect Tally (ConnectGuide), the ONE place to connect and link Tally: four steps that tick
//      themselves from the beats; all done, one green line ("Connected · <company> open in Tally · last entry <time>").
//   1. Is Tally working? One line a computer heard in the last 7 days (PcLine): online and last heard, Tally open or not,
//      reading on or paused, the bridge's version ("Update to 2.4.4" only when older).
//   2. Needs you (NeedsYou): only what the guide and the lines do not say (reading stopped on all computers, a computer
//      key refused). The Day Book needs stay on each client's own pages.
//   3. One table (ClientsTable): Client · Tally company · Linked · Last entry received, with Link (the guide's step 4)
//      or nothing.
//   The rest is under "Advanced (for support)" (PageMore): the same parts, the same functions, the same owner-only rules.
// ---------------------------------------------------------------------------------------------------------------------
const WEEK = 7 * 86400e3;
const heardThisWeek = (r) => !!r.at && Date.now() - Date.parse(r.at) < WEEK;
// a bridge's own beat value, else the computer's beat when it is the main bridge (as bridgesHeard reads the others)
function beatOf(r, k) {
  const info = (r.device && r.device.info) || {}, b = (info.bridges || {})[r.id] || {}, bt = info.beat || {};
  return b[k] !== undefined ? b[k] : (r.main || !r.go) ? bt[k] : undefined;
}
// the port his Tally should answer on: the first port the bridge checked in his own Windows session (session 0's are
// skipped), else the bridge's Tally port, else Tally's own default
function tallyPortOf(r) {
  const ports = [].concat(beatOf(r, "ports") || []).filter((x) => x && !x.skipped && x.port);
  return (ports[0] && ports[0].port) || r.tallyPort || 9002;
}
// "10-Oct 10:28" (IST)
const shortWhen = (at) => { const s = at ? fmtDateTime(Date.parse(String(at))) : ""; const m = /^(\d\d-[A-Za-z]{3})-\d{4}(?: (\d\d:\d\d))?/.exec(s); return m ? m[1] + (m[2] ? " " + m[2] : "") : ""; };
// the state of one computer, from its beat only (beat.tally, tallyState, ports, open, paused, readStopped, companies)
function pcState(r, latest) {
  const live = r.go && !r.old, rd = r.read || { state: r.online ? "reading" : "offline" }, p = TCloud.pane;
  const ports = [].concat(beatOf(r, "ports") || []);
  const tallyOk = live && r.online && (r.tally === "open" || r.tally === "busy" || ports.some((x) => x && x.ok && !x.skipped));
  const open = live && r.online ? (r.open || []) : [];
  const cos = p.companies || [], linkOf = (co) => cos.find((c) => c.company === co && c.client_id && (!c.device_id || c.device_id === r.device.id));
  const linked = open.filter((co) => linkOf(co));
  const paused = rd.state === "paused", stopped = rd.state === "fincomstop";
  const rel = (p.releases || []).find((x) => x.version === latest), held = !!(p.rollback || (rel && (rel.held_at || rel.withdrawn_at)));
  const update = live && !!latest && vnum(latest) > vnum(r.version) && !held;
  const fine = live && r.online && tallyOk && open.length > 0 && linked.length > 0 && !paused && !stopped;
  const word = !live ? ["bad", "Older bridge"] : !r.online ? ["bad", "Offline"] : stopped ? ["bad", "Stopped"] : paused ? ["warn", "Paused"] : fine ? ["ok", "Connected"] : ["warn", "Not connected"];
  return { live, rd, tallyOk, open, linked, paused, stopped, update, fine, word, linkOf };
}
// the one download, said "Update to 2.4.4" on a computer's line
function UpdateBtn({ m, label }) {
  const s = setupOf(m);
  return s ? <a className="btn small primary" data-pc-update="" data-bridge-download="" href={s.href} download={s.file}>{label || "Update to " + s.version}</a> : null;
}
// Check again: the bridge is woken through FinCom's cloud (the wake the client pages already send, TWake) and the
// computers are read again (TCloud.refreshPane); nothing new is asked of Tally
function checkAgain() {
  try { if (typeof TWake === "object" && TWake.send) TWake.send({ kind: "wake", what: "active" }); } catch (e) { /* the cloud may not know the wake yet */ }
  return TCloud.refreshPane();
}
// 1. one line a computer: the facts in a few words (how to connect is the guide's, above)
// guided: the guide's step 3 speaks of this computer (its Resume is there, not here)
function PcLine({ r, latest, m, focus, guided = false }) {
  const s = pcState(r, latest), [lv, word] = s.word, owner = isOwner(), allStopped = TCloud.stoppedAll && TCloud.stoppedAll();
  const heard = r.at ? (r.online ? "Online, last heard " + tallyHm(r.at) : "Offline since " + tallyHm(r.at)) : "Never heard";
  const ver = r.go && !r.old ? "FinCom Bridge " + (r.version || "?") : "Older bridge";
  const tally = !s.live || !r.online ? "" : r.tally === "busy" ? "Tally busy" : s.tallyOk ? "Tally open" + (s.open.length > 3 ? ": " + nOf(s.open.length, "company", "companies") : s.open.length ? ": " + s.open.join(", ") : "") : "Tally not open";   // round 63: never every company
  const reading = !s.live || !r.online ? "" : s.stopped ? "Reading stopped" : s.paused ? "Reading paused (tray: Resume background reading)" : "Reading on";
  return <div className={"tpc" + (focus ? " tcard-focus" : "")} data-pc-line={r.device.id} data-bridge-user={r.user || ""} data-level={lv} data-pc-state={word} data-focus={focus ? "" : undefined}>
    <div className="tpc-line">
      <span className={"tag " + lv} data-pc-word="">{word}</span>
      <b data-pc-name="">{pcWords(r)}</b>
      <span className="tpc-facts note" data-pc-facts="">{[heard, tally, reading, ver].filter(Boolean).join(" · ")}</span>
      {s.update && !s.stopped && <UpdateBtn m={m} />}
      {!s.live && <UpdateBtn m={m} label={latest ? "Install FinCom Bridge " + latest : ""} />}
      {s.stopped && !guided && (owner && !allStopped ? <button className="btn small primary" data-pc-resume={r.device.id} onClick={() => TCloud.readResume(r)}>Resume reading</button>
        : !owner ? <span className="note">An owner of the firm can resume it.</span> : null)}
    </div>
  </div>;
}
// ---------------------------------------------------------------------------------------------------------------------
// Reading (15-Oct-2026; the owner: "I need a proper view of reading works.. like what is done in reading.. and still
// reading"): one row a company each computer heard this week reports in its beat (beat.companies: name, open, phase,
// waiting, lastRead; the bridge's recorder lastAt), its state in plain words, the last entry received, and (only when this
// page already holds Sync activity's lines, Rec.act.rows from tally_recorder_lines) the entries received today. Nothing
// new is asked of the bridge, the cloud or Tally.
// ---------------------------------------------------------------------------------------------------------------------
// FinCom Bridge 2.4.4 (bridge-go/mode.go paused() and its callers: wakeOpen, the ledger events, the nightly catch-up and
// the bank-date night work): a pause stops the background reads only; the live recorder (the add-on's lines) still sends
// what is saved in Tally, and postings and Update now still work
const PAUSE_SAYS = "While paused, FinCom does not read Tally in the background; entries saved in Tally still come in, and postings still work.";
const RESUME_TRAY = "right-click the FinCom icon near the clock → Resume background reading";
function readingRows(cards) {
  const p = TCloud.pane, out = [];
  cards.filter((r) => r.go && !r.old).forEach((r) => {
    const cos = [].concat(beatOf(r, "companies") || []).filter((c) => c && c.name), rd = r.read || {}, rs = r.readStopped || {};
    const rc = typeof Rec === "object" && Rec.recOf ? (Rec.recOf(r.device) || {}) : {};
    cos.forEach((c) => {
      const stopWhy = rd.state === "fincomstop" ? (rd.reason || "no reason given") : rs.by === "self" ? (rs.reason || "Tally did not answer in time") : "";
      const waiting = Number(c.waiting) || 0;
      const [lv, state, kind] = !r.online ? ["bad", "Waiting: " + r.computer + " is offline", "waiting"]
        : stopWhy ? ["bad", "Stopped: " + stopWhy, "stopped"]
        : r.paused || rd.state === "paused" ? ["warn", "Paused", "paused"]
        : !c.open ? ["warn", "Waiting: Tally company not open", "waiting"]
        : waiting > 0 ? ["warn", "Catching up: " + waiting + " to fetch", "catching"]
        : c.phase === "live" ? ["ok", "Reading live", "live"]
        : ["warn", "Catching up: first copy", "catching"];
      const rec = (rc[c.name] || {}).lastAt || "", last = [rec, c.lastRead || ""].filter(Boolean).sort().pop() || "";
      out.push({ key: r.device.id + "|" + (r.user || "") + "|" + c.name, r, c, lv, state, kind, last });
    });
  });
  // entries received today: only from the lines this page already holds (Sync activity's, Rec.act.rows)
  const rows = typeof Rec === "object" && Rec.act && Array.isArray(Rec.act.rows) ? Rec.act.rows : null, today = typeof istDay === "function" ? istDay(Date.now()) : "";
  if (rows) out.forEach((x) => { x.today = rows.filter((l) => l.company === x.c.name && (!l.device_id || l.device_id === x.r.device.id) && l.received_at && istDay(Date.parse(l.received_at)) === today).length; });
  return { list: out, today: !!rows };
}
// round 63 (the owner: "don't show every company"): a long list folds to its one summary line; the rows that need the
// person (a client not linked; reading stopped, waiting or paused) show above the fold, at most 5 ("and N more"), and
// "Show all" opens the whole table. The fold is remembered while the page is open (S.tallyFold)
const FOLD_NEEDS = 5;
const foldOpen = (k) => !!(S.tallyFold && S.tallyFold[k]);
function setFold(k, v) { S.tallyFold = Object.assign({}, S.tallyFold, { [k]: v }); render(); }
function FoldToggle({ k, total, shown }) {
  const open = foldOpen(k);
  if (!open && shown >= total) return null;   // every row already shown: nothing to open
  return <button type="button" className="linkbtn" data-show-all={k} aria-expanded={open ? "true" : "false"} onClick={() => setFold(k, !open)}>{open ? "Show less" : "Show all " + total}</button>;
}
function foldRows(k, rows, needs) {
  if (foldOpen(k)) return { shown: rows, more: 0 };
  const need = rows.filter(needs);
  return { shown: need.slice(0, FOLD_NEEDS), more: Math.max(0, need.length - FOLD_NEEDS) };
}
function FoldMore({ k, more }) {
  return more ? <p className="note" data-fold-more={k} style={{ margin: "6px 0 0" }}>{"and " + more + " more · "}
    <button type="button" className="linkbtn" onClick={() => setFold(k, true)}>Show all</button></p> : null;
}
function ReadingView({ cards }) {
  const { list, today } = readingRows(cards);
  if (!list.length) return null;
  const n = (k) => list.filter((x) => x.kind === k).length, word = (k) => (k === 1 ? " company" : " companies");
  const head = "Reading: " + n("live") + word(n("live")) + " live, " + n("waiting") + " waiting for Tally, " + n("stopped") + " stopped"
    + (n("paused") ? ", " + n("paused") + " paused" : "") + (n("catching") ? ", " + n("catching") + " catching up" : "");
  const { shown, more } = foldRows("reading", list, (x) => x.kind === "stopped" || x.kind === "waiting" || x.kind === "paused");
  return <section className="pane treading" data-reading="" data-folded={foldOpen("reading") ? undefined : ""}>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <h3 style={{ margin: 0 }} data-reading-head="">{head}</h3>
      <span className="row" style={{ gap: 14, flexWrap: "wrap" }}><FoldToggle k="reading" total={list.length} shown={shown.length} />
        <button className="linkbtn" data-reading-activity="" onClick={() => goTab("activity")}>See every entry received</button></span></div>
    {n("paused") > 0 && <p className="note" data-reading-paused="" style={{ margin: "4px 0 0" }}>{PAUSE_SAYS}</p>}
    {shown.length > 0 && <ListTable name="tallyReading" className="data" rows={shown} rowKey={(x) => x.key} unit={["company", "companies"]} rowProps={(x) => ({ "data-reading-row": x.c.name, "data-reading-kind": x.kind })}
      cols={[
        { k: "co", role: "party", label: "Company", v: (x) => x.c.name, cell: (x) => x.c.name },
        { k: "pc", role: "party", label: "Computer", v: (x) => pcWords(x.r), cell: (x) => pcWords(x.r) },
        { k: "st", role: "status", label: "State", v: (x) => x.state, cell: (x) => <span className={"tag " + x.lv} data-reading-state="">{x.state}</span> },
        { k: "last", label: "Last entry received", v: (x) => x.last, cell: (x) => x.last ? shortWhen(x.last) : <span className="note">{"—"}</span> },
        today && { k: "today", label: "Received today", v: (x) => x.today || 0, cell: (x) => String(x.today || 0) },
      ].filter(Boolean)} />}
    <FoldMore k="reading" more={more} />
  </section>;
}
// ---------------------------------------------------------------------------------------------------------------------
// Connect Tally, the ONE place to connect and link Tally (15-Oct-2026; the owner: "multiple pages of Tally connection..
// multiple places to connect.. need a very simple connection guide"). Round 63 (16-Oct-2026): six steps, each ticked by
// itself (from the computers' beats, the link, and what FinCom holds; nothing new is asked of the bridge or Tally):
//   1. Install FinCom Bridge        the one Download                         done: a bridge heard this week
//   2. Open TallyPrime              F1 → … Both, port; Check again           done: Tally answering
//   3. Keep a company open          resume when paused                       done: a company open, reading on
//   4. Link the client              the client worked on (the pointer's, else the open client), its state in one line,
//                                   one type-to-search list of the companies open in Tally now (one linked to another
//                                   client is offered too, "will move", asked first); tallyLinkClient (tally_company_link)
//                                                                            done: the client worked on is linked (round 64:
//                                                                            the others not linked are named in a note)
//   5. Import ledgers               the ledgers-only wake (Ledgers.askTally: the bridge's /ledgers/refresh, or the cloud's
//                                   wake "ledgers"), a moving bar with the time while reading (the bridge sends no count
//                                   up front), then "1,240 ledgers imported ✓"; nothing in 10 minutes: Tally must be
//                                   open, Try again, or upload the masters file (Ledgers.fromMasters)
//                                                                            done: the client worked on has ledgers in
//                                                                            FinCom (round 64: the cloud's count of its
//                                                                            ledgers, tally_ledgers; the others named)
//   6. Bring in this year's entries the Day Book: three lines on exporting it, and Open Upload (Books › From Tally)
//                                                                            done: the client worked on has days of this
//                                                                            financial year in FinCom's cloud
// A strip across the top (Install → … → Day Book); one card a step: a done step folds to its green line (open on click),
// the current one is marked, the later ones muted. All six done: one green line (owner, 15-Oct: "the company we are
// working on, and the number of companies open in Tally": counts, never a list of names). Every other place that spoke of
// connecting or linking points here (openConnectTally(n), src/js/52; unchanged). 17-Oct-2026 (the owner: "why it is asking
// to update add on.. pls remove that option.. include this automatically in 2.4.5.. it should not ask the clients"): the
// add-on step added that morning is gone again, with every ask to load, update or turn on the add-on or recorder (the
// Status card's "Add-on not loaded", the computers' "not recording", the bell's "turn on FinCom's recorder")
// ---------------------------------------------------------------------------------------------------------------------
const GUIDE_KEYS = ["install", "tally", "company", "link", "ledgers", "daybook"], GUIDE_REFRESH_MS = 20000;
const GUIDE_STRIP = { install: "Install", tally: "Open Tally", company: "Company", link: "Link", ledgers: "Ledgers", daybook: "Day Book" };
const LED_POLL_MS = 10000, LED_WAIT_MS = 10 * 60000, PICK_SEARCH_AT = 8, PICK_SHOW = 60;
const nOf = (n, one, many) => Number(n).toLocaleString("en-IN") + " " + (n === 1 ? one : many);
const lc = (x) => String(x || "").trim().replace(/\s+/g, " ").toLowerCase();
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const d8Of = (x) => String(x || "").replace(/-/g, "").slice(0, 8);
function fyStart() { const t = new Date(Date.now() + 5.5 * 3600e3), y = t.getUTCFullYear() - (t.getUTCMonth() < 3 ? 1 : 0); return y + "0401"; }
function linkedClients() {
  return Object.values(S.companies || {}).filter((c) => !c.deleted && typeof tallyLinkOf === "function" && tallyLinkOf(c).state !== "unlinked").sort((a, c) => a.name.localeCompare(c.name));
}
const cloudBook = (cid) => (typeof TCloud === "object" && TCloud.on() && TCloud.book ? TCloud.book(cid) : null);
// round 64 (the owner's test of 16-Oct-2026: GB TEXCOAT's 224 ledgers in the cloud, step 5 never ticked): the cloud's own
// count of a client's ledgers (tally_ledgers of its book, the firm's read: one count, no rows), kept a minute
// kept with the client's cloud books (TCloud.st[cid].ledN), so it goes when they are read afresh
const LED_N = { get: (cid) => (TCloud.st[cid] || {}).ledN, set: (cid, v) => { (TCloud.st[cid] = TCloud.st[cid] || {}).ledN = v; } };
async function cloudLedgerCount(cid, force, maxAge) {
  const bk = cloudBook(cid);
  if (!bk || !bk.book) return null;
  const k = LED_N.get(cid);
  if (!force && k && k.book === bk.book && Date.now() - k.at < (maxAge || 60000)) return k.n;
  const path = "tally_ledgers?select=name&merged_into=is.null&limit=1&book_id=eq." + encodeURIComponent(bk.book);
  const ask = (pp) => Cloud.api(pp, { headers: { Prefer: "count=exact" }, count: true });
  let n;
  try { n = await ask(path + (TCloud.hasDel === false ? "" : "&deleted_at=is.null")); }
  catch (e) { if (!/deleted_at|42703/i.test(String((e && e.message) || e))) throw e; n = await ask(path); }
  n = Array.isArray(n) ? n.length : Math.max(0, Math.floor(Number(n) || 0));    // a stand-in without the count: its rows
  LED_N.set(cid, { n, at: Date.now(), book: bk.book });
  return n;
}
const ledgersOf = (cid) => Math.max(typeof Ledgers === "object" ? Ledgers.status(cid).n : 0, (LED_N.get(cid) || {}).n || 0);
const ledgersHeld = (cid) => ledgersOf(cid) > 0 || !!(cloudBook(cid) || {}).ledgersAt;
// "Mastercad and Posterity" / "A, B, C and 2 more": the other clients a note names
const namesOf = (cs) => { const n = cs.map((c) => c.name); return n.length <= 3 ? n.join(", ").replace(/, ([^,]*)$/, " and $1") : n.slice(0, 3).join(", ") + " and " + (n.length - 3) + " more"; };
function daybookHeld(cid) {
  const bk = cloudBook(cid), fy = fyStart();
  if (bk && Number(bk.days) > 0 && d8Of(bk.to) >= fy) return true;
  const b = S.books && S.books.cid === cid ? S.books : null;
  return !!(b && (b.vouchers || []).some((v) => v && String(v.date) >= fy));
}
// the cloud's book of each linked client (tally_status), read for the guide a few at a time (TCloud.status keeps each
// for 30 seconds; here, read again after five minutes)
let guideBooksBusy = false;
function guideBooksLoad() {
  if (guideBooksBusy || typeof TCloud !== "object" || !TCloud.on()) return Promise.resolve();
  const cur = guideClient(S.tallyGuide || {}, unlinkedClients());
  // the client worked on first, read again after 15 seconds (the guide asks every 20 while a step is open); the others after 5 minutes
  const want = linkedClients().filter((c) => { const s = TCloud.st[c.id]; return !s || !s.at || Date.now() - s.at > (c.id === cur ? 15000 : 300000); })
    .sort((a, c) => (c.id === cur) - (a.id === cur)).slice(0, 25);
  if (!want.length) return Promise.resolve();
  guideBooksBusy = true;
  return Promise.all(want.map((c) => Promise.resolve(TCloud.status(c.id, c.id === cur)).then(() => (ledgersOf(c.id) > 0 && c.id !== cur ? null : cloudLedgerCount(c.id, false, c.id === cur ? 15000 : 60000))).catch(() => null)))
    .finally(() => { guideBooksBusy = false; render(); });
}
function guideState(rows, latest) {
  const p = TCloud.pane, live = cardsOf(rows).filter(heardThisWeek).filter((r) => r.go && !r.old);
  const st = live.map((r) => [r, pcState(r, latest)]);
  const on = st.filter(([r]) => r.online), tally = on.filter(([, s]) => s.tallyOk), open = tally.filter(([, s]) => s.open.length);
  const reading = open.filter(([, s]) => !s.paused && !s.stopped);
  const unlinked = unlinkedClients();
  // round 64 (the owner, 16-Oct-2026): steps 4 to 6 judge the client worked on (guideClient), not every client of the firm;
  // the other clients' gaps are named in a note (only those whose book FinCom has read)
  const cid = guideClient(S.tallyGuide || {}, unlinked), cur = cid && S.companies && S.companies[cid] ? S.companies[cid] : null;
  const curLinked = !!(cur && typeof tallyLinkOf === "function" && tallyLinkOf(cur).state !== "unlinked");
  const linked = linkedClients(), read = (c) => !!(TCloud.st[c.id] && TCloud.st[c.id].at);
  const ledMiss = linked.filter((c) => c.id !== cid && read(c) && !ledgersHeld(c.id)), dayMiss = linked.filter((c) => c.id !== cid && read(c) && !daybookHeld(c.id));
  const imp = S.ledImp, importing = !!(imp && imp.cid === cid && !imp.end && !imp.err && !imp.late && Date.now() - imp.at <= LED_WAIT_MS);
  // no client in the firm at all: as before, a company linked and none left unlinked
  const anyLink = (p.companies || []).some((c) => c.client_id);
  const done = { install: live.length > 0, tally: tally.length > 0, company: reading.length > 0, link: curLinked || (!cur && anyLink && !unlinked.length),
    ledgers: curLinked && ledgersHeld(cid) && !importing, daybook: curLinked && daybookHeld(cid) };
  // the computer the steps speak of: the one furthest along
  const [r, s] = open[0] || tally[0] || on[0] || st[0] || [null, null];
  const fine = st.find(([, x]) => x.fine) || reading[0] || null;
  // the companies open in Tally right now (an online computer whose Tally answers): the only ones step 4 offers (the owner,
  // 15-Oct-2026: "there should be companies open in Tally at that time")
  const openNow = [];
  tally.forEach(([rr, ss]) => ss.open.forEach((name) => { if (!openNow.some((o) => lc(o.company) === lc(name))) openNow.push({ company: name, computer: pcName(rr) }); }));
  const pcs = Array.from(new Set(openNow.map((o) => o.computer)));
  return { done, r, s, live, on, tally, unlinked, fine, openNow, pcs, linked, ledMiss, dayMiss, cid, cur, curLinked };
}
// "3 companies open in Tally on NWS144" / "12 companies open in Tally on 2 computers": a count, never the names
function openWords(x) {
  const n = x.openNow.length;
  if (!n) return "No company is open in Tally right now.";
  return nOf(n, "company", "companies") + " open in Tally on " + (x.pcs.length === 1 ? x.pcs[0].split(" · ")[0] : x.pcs.length + " computers") + ".";
}
const TICK = <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const UNFOLD = { install: "Install on another computer", link: "Change", ledgers: "Import again", daybook: "Upload again" };
function GuideStep({ k, n, title, done, open, later, line, more, children }) {
  // a done step folds to its green line; a click opens what it holds (more: e.g. to change the link, import again)
  const [unf, setUnf] = useState(false), fold = done && !open;
  const ln = line || (fold ? children : null), body = fold ? null : children;
  return <li data-connect-step={k} data-done={done ? "" : undefined} data-open={open ? "" : undefined} className={"tg-card " + (done ? "done" : open ? "now" : later ? "later" : "")}>
    <span className="tguide-mark" aria-hidden="true">{done ? TICK : n}</span>
    <div className="tguide-body">
      <div className="tg-hd"><b className="tg-title">{title}</b>{ln ? <span className="tg-line">{ln}</span> : null}
        {fold && more && <button className="linkbtn tg-unfold" data-guide-unfold={k} aria-expanded={unf ? "true" : "false"} onClick={() => setUnf(!unf)}>{unf ? "Close" : UNFOLD[k] || "Open"}</button>}</div>
      {body ? <div className="tguide-say">{body}</div> : null}
      {fold && unf && more ? <div className="tguide-say" data-guide-more={k}>{more}</div> : null}</div></li>;
}
// a list with type-to-search once it is long (the owner, 16-Oct-2026: 100 companies or clients, never a wall): a search
// box above the one choice box; the choice box holds what matches (the first 60), the chosen one always
function SearchPick({ hook, label, value, items, onPick, placeholder }) {
  const [q, setQ] = useState("");
  const long = items.length > PICK_SEARCH_AT, k = lc(q);
  const hits = long && k ? items.filter((x) => lc(x.label).includes(k)) : items;
  let shown = hits.length > PICK_SHOW ? hits.slice(0, PICK_SHOW) : hits;
  if (value && !shown.some((x) => x.value === value)) { const cur = items.find((x) => x.value === value); if (cur) shown = [cur].concat(shown); }
  const sel = { ["data-guide-" + hook]: "" }, qh = { ["data-guide-" + hook + "-q"]: "" };
  return <span className="tg-pick">
    {long && <input type="search" className="tg-q" {...qh} aria-label={"Find " + label.toLowerCase()} placeholder={placeholder} value={q}
      onChange={(ev) => { setQ(ev.target.value); const kk = lc(ev.target.value), first = kk && items.find((x) => lc(x.label).includes(kk)); if (first && first.value !== value) onPick(first.value); }} />}
    <select {...sel} aria-label={label} value={value} onChange={(ev) => onPick(ev.target.value)}>
      {shown.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
    {long && k && <span className="note tg-found" data-guide-found={hits.length}>{hits.length ? nOf(hits.length, "match", "matches") : "none matches"}</span>}
  </span>;
}
// step 4: the client worked on now (the one a pointer named, else the client open, else the first not linked) in one
// line; to link it or change its company, one list of the companies open in Tally now. A company linked to another client
// is offered too, "(linked to X — will move)", and asked first: tally_company_link moves the company, and its book, to
// this client (migration-2: it sets the company's client; the other client is then not linked)
function guideClient(g, unlinked) {
  const ok = (id) => id && S.companies && S.companies[id] && !S.companies[id].deleted;
  if (ok(g.cid)) return g.cid;
  if (ok(S.coId)) return S.coId;
  if (unlinked.length) return unlinked[0].id;
  // round 64: all linked: the first whose ledgers or this year's entries are not in FinCom yet, else the first
  const linked = linkedClients(), gap = linked.find((c) => TCloud.st[c.id] && TCloud.st[c.id].at && (!ledgersHeld(c.id) || !daybookHeld(c.id)));
  return (gap || linked[0] || Object.values(S.companies || {}).filter((c) => !c.deleted).sort((a, c) => a.name.localeCompare(c.name))[0] || {}).id || "";
}
function LinkPicker({ x, g }) {
  const unlinked = x.unlinked, openNow = x.openNow;
  const all = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((a, c) => a.name.localeCompare(c.name));
  const [pick, setPick] = useState({ cid: "", company: "" }), [busy, setBusy] = useState(false), [gen, setGen] = useState(0);
  if (!all.length) return <div className="tlink-guide" data-guide-picker=""><span className="note">Add a client first; then link it here.</span> <button className="btn small primary" data-guide-add="" onClick={() => doAct("addCo")}>Add a client</button></div>;
  const cid = pick.cid && S.companies[pick.cid] ? pick.cid : guideClient(g, unlinked), co = S.companies[cid];
  const lk = typeof tallyLinkOf === "function" ? tallyLinkOf(co) : null, linkedTo = lk && lk.state !== "unlinked" ? lk.company : "";
  const isOpen = (name) => openNow.some((o) => lc(o.company) === lc(name));
  // who has each company now (tally_companies, as the Tally page and TLight read them)
  const owner = new Map();
  [].concat((typeof TLight === "object" && TLight.st.cos) || [], (TCloud.pane || {}).companies || []).forEach((r) => { if (r && r.company && !owner.has(lc(r.company))) owner.set(lc(r.company), String(r.client_id || "")); });
  const seen = companiesSeen(co);
  const list = openNow.map((o) => { const who = owner.get(lc(o.company)) || "", sx = seen.find((c) => lc(c.company) === lc(o.company));
    const other = who && who !== String(cid) && S.companies[who] && !S.companies[who].deleted ? S.companies[who] : null;
    return { company: o.company, computer: o.computer, same: !!(sx && sx.same), other, mine: who === String(cid) }; })
    .sort((a, b) => (b.same - a.same) || (!!a.other - !!b.other) || a.company.localeCompare(b.company));
  const want = pick.cid === cid && pick.company ? pick.company : (g.cid === cid && g.company) || "";
  const company = list.some((c) => c.company === want) ? want : (list.find((c) => !c.mine && !c.other) || list.find((c) => !c.mine) || list[0] || {}).company || "";
  const chosen = list.find((c) => c.company === company) || null;
  const may = S.account && S.account.me ? ["owner", "staff"].includes(S.account.me.role) : true;
  const link = async () => {
    if (!company) return;
    if (chosen && chosen.other) {
      const ans = await askConfirm({ title: "Move " + company + " to " + co.name + "?", ok: "Move it here",
        body: esc(company + " is linked to " + chosen.other.name + ". Link it to " + co.name + " instead? " + chosen.other.name + " will be unlinked.") });
      if (!ans) return;
    }
    setBusy(true); const ok = await tallyLinkClient(company, cid); setBusy(false);
    // round 64: the client just linked is the one steps 5 and 6 speak of
    if (ok) { setPick({ cid: "", company: "" }); setGen(gen + 1); S.tallyGuide = { cid }; render(); }
  };
  const others = unlinked.filter((c) => c.id !== cid).length;
  // nothing to offer: say why (no company open / the open ones all linked elsewhere is said below the list / the computer)
  const pc = x.r ? x.r.computer : "the Tally computer";
  const none = !x.on.length ? (x.live.length ? "The computer with Tally (" + pc + ") is offline. Turn it on and sign in to Windows; its open companies show here." : "Install FinCom Bridge first (step 1).")
    : !x.tally.length ? "TallyPrime is not answering on " + pc + ". Open TallyPrime there (step 2); its open companies show here."
    : "No company is open in Tally right now: open " + (co.tallyName || linkedTo || co.name) + " in TallyPrime; it shows here within a minute." + (x.s && x.s.paused ? " Reading is paused on " + pc + "." : "");
  const allTaken = list.length > 0 && list.every((c) => c.other);
  return <div className="tlink-guide" data-guide-picker="">
    <p className="tg-state" data-guide-client-state={linkedTo ? (isOpen(linkedTo) ? "open" : "linked") : "unlinked"}>
      {linkedTo ? <>{co.name + " is linked to "}<b>{linkedTo}</b>{isOpen(linkedTo) ? <>{" · "}<span className="tag ok" data-guide-linked-to={linkedTo}>open in Tally now ✓</span></> : <span className="note" data-guide-linked-to={linkedTo}>{" · not open in Tally now"}</span>}</>
        : <>{co.name + " is not linked."}</>}
      {others > 0 && <span className="note" data-guide-unlinked={unlinked.length}>{" " + (others === 1 ? "1 other client is" : others + " other clients are") + " not linked."}</span>}</p>
    <label className="f"><span>Client</span>
      <SearchPick key={"c" + gen} hook="client" label="Client to link" placeholder="Type a client's name" value={cid}
        items={all.map((c) => ({ value: c.id, label: c.name + (unlinked.some((u) => u.id === c.id) ? "" : " (linked)") }))}
          onPick={(v) => { setPick({ cid: v, company: "" }); S.tallyGuide = Object.assign({}, S.tallyGuide || {}, { cid: v, company: "", step: 4, at: Date.now() }); render(); }} /></label>
    <label className="f"><span>Company open in Tally</span>{list.length
      ? <SearchPick key={"o" + gen} hook="company" label="Company in Tally" placeholder="Type a company's name" value={company}
          items={list.map((c) => ({ value: c.company, label: c.company + (c.same ? " (same GSTIN)" : "") + (c.mine ? " (linked here)" : c.other ? " (linked to " + c.other.name + " — will move)" : "") + (c.computer && x.pcs.length > 1 ? " · " + c.computer : c.computer ? " · " + c.computer : "") }))}
          onPick={(v) => setPick({ cid, company: v })} />
      : <span className="note" data-guide-none="">{none}</span>}</label>
    {may ? <button className="btn small primary" data-guide-link={cid} disabled={!company || busy || (!!linkedTo && lc(company) === lc(linkedTo))} onClick={link}>
      {busy ? "Linking…" : chosen && chosen.other ? "Move it here" : linkedTo ? "Change to this company" : "Link"}</button>
      : <span className="note">A member of the firm who may make changes links it.</span>}
    {allTaken && <p className="note tg-taken" data-guide-all-taken={list.length}>{(list.length === 1 ? "The company open in Tally is linked to another client." : "The " + list.length + " companies open in Tally are all linked to other clients.")
      + " Open " + co.name + "’s own company in TallyPrime, or move one here."}</p>}
  </div>;
}
// step 5: the ledgers import, for the client worked on. S.ledImp = {cid, name, at, base: {at: ledgersAt, n: count}, via, ans,
// got: {cid: n}, end, err, late}. Round 64 (the owner's test of 16-Oct-2026: the bar ran on for ever): the answer to the ask
// is read (the bridge here: started false and why; the cloud: none asked, debounced, not linked) and the bar stops at once
// with the reason; the arrival is seen in the cloud's count of the client's ledgers (or their time, tally_books.ledgers_at,
// which the bridge's whole list now sets too); at 10 minutes the bar stops: Try again, or the masters file
async function ledImportStart(cid, hint) {
  const co = S.companies[cid] || {}, name = co.name || "this client";
  const company = (typeof tallyLinkOf === "function" && (tallyLinkOf(co) || {}).company) || co.tallyName || name;
  const x = S.ledImp = { cid, cids: [cid], name, at: Date.now(), base: { at: (cloudBook(cid) || {}).ledgersAt || "", n: ledgersOf(cid) }, via: "", ans: null, got: {}, end: 0, err: "", late: false };
  render();
  try { const n0 = await cloudLedgerCount(cid, true); if (n0 != null) x.base.n = n0; } catch (e) {}
  // reading paused on the Tally computer: the bridge reads no list while paused (FinCom Bridge: "background reading is
  // paused in the tray"); said at once, nothing asked
  if (hint && hint.paused) { x.err = "Reading is paused on " + hint.pc + ", so FinCom Bridge does not read the ledgers. To resume: " + RESUME_TRAY + ". Then Try again."; x.why = "paused"; render(); return; }
  const r = await Ledgers.askTally(cid), a = (r && r.ans) || {};
  x.via = r.via || ""; x.ans = a;
  const soon = "Tally was asked for " + name + "’s ledgers a moment ago; they show here as soon as they arrive. If they do not, Try again in a few minutes.";
  if (r.err) { x.err = "Could not ask Tally: " + r.err; x.why = "error"; }
  else if (!r.via) { x.err = "Neither FinCom Bridge here nor FinCom’s cloud reaches the Tally computer. Sign in to the firm account."; x.why = "none"; }
  else if (r.via === "bridge" && a.started === false) { x.err = a.debounced ? soon : "FinCom Bridge did not read " + company + "’s ledgers: " + (a.why || "it did not start") + "."; x.why = a.debounced ? "debounced" : "not started"; }
  else if (r.via === "cloud" && a.notLinked) { x.err = name + " is not linked to a company in Tally yet: link it in step 4 first."; x.why = "not linked"; }
  else if (r.via === "cloud" && !Number(a.woken) && Number(a.debounced) > 0 && !Number(a.asked)) { x.err = soon; x.why = "debounced"; }
  else if (r.via === "cloud" && a.woken !== undefined && !Number(a.woken) && (a.asked === undefined ? !Number(a.debounced) : !Number(a.asked))) {
    x.err = "No computer with Tally was asked: FinCom has no computer that holds " + company + " now. Open " + company + " in TallyPrime on the Tally computer, with FinCom Bridge running; then Try again.";
    x.why = "woken 0";
  }
  render();
}
let ledPolling = false;
async function ledImportPoll() {
  const x = S.ledImp;
  if (!x || x.end || x.err || x.late || ledPolling) return;
  ledPolling = true;
  try {
    const cid = x.cid;
    try { if (typeof TCloud === "object" && TCloud.on()) await TCloud.status(cid, true); } catch (e) {}
    const at = (cloudBook(cid) || {}).ledgersAt || "";
    let n = null; try { n = await cloudLedgerCount(cid, true); } catch (e) {}
    // 2.4.5: the exact count while the bridge reads ("312 of 1,240 ledgers"; tally_period_status's ledger, sent by the bridge
    // after each chunk); a progress older than this import is not this read's
    try {
      const bk = cloudBook(cid), r = bk && bk.book ? await TCloud.rpc("tally_period_status", { p_book: bk.book }) : null, lp = r && r.ledger;
      if (lp && Date.parse(lp.at) >= x.at - 60000) { x.prog = lp; if (lp.done && Number(lp.read) > 0 && n == null) n = Number(lp.read); }
    } catch (e) {}
    if ((n != null && n > (x.base.n || 0)) || (at && at !== x.base.at && n)) { x.got[cid] = n; try { if (cid === S.coId) await Ledgers.load(cid, { fresh: true }); } catch (e) {} }
    else if (x.via === "bridge") { const r = await Ledgers.load(cid, { force: true }); if (r && r.ok && r.n) x.got[cid] = r.n; }
    if (x.got[cid] != null) x.end = Date.now();
  } finally { ledPolling = false; render(); }
}
function pickFile(onFile) {
  return (ev) => { const f = (ev.target.files || [])[0]; ev.target.value = ""; if (f) onFile(f); };
}
function MastersHow({ open }) {
  return <details className="tg-how" data-guide-masters-how="" open={open || undefined}><summary>How to export the masters file</summary>
    <ol className="tg-lines">
      <li>In TallyPrime: <b>Gateway of Tally → Display More Reports → List of Accounts</b>.</li>
      <li>Press <b>Alt+E</b> (Export), choose <b>XML (Data Interchange)</b>, type <b>Masters</b>, and export.</li>
      <li>Choose that file with <b>Or upload the masters file</b> above.</li></ol></details>;
}
function LedgersStep({ x, owner }) {
  const [, tick] = useState(0), [busy, setBusy] = useState(false);
  const cid = x.cid, co = x.cur, raw = S.ledImp && S.ledImp.cid === cid ? S.ledImp : null;
  const late = !!(raw && !raw.end && !raw.err && (raw.late || Date.now() - raw.at > LED_WAIT_MS));
  if (late && raw && !raw.late) raw.late = true;              // at 10 minutes the bar stops (round 64)
  const imp = raw, reading = !!(imp && !imp.end && !imp.err && !late);
  // the clock while reading (once a second) and the read again (every 10 seconds)
  useEffect(() => { if (!reading) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [reading]);
  useEffect(() => { if (!reading) return; const t = setInterval(() => { ledImportPoll(); }, LED_POLL_MS); return () => clearInterval(t); }, [reading, imp && imp.at]);
  if (!co || !x.curLinked) return <span className="note">{co ? "After step 4: link " + co.name + " first." : "After step 4: link a client first."}</span>;
  const pc = x.r ? x.r.computer : "the Tally computer", company = (typeof tallyLinkOf === "function" && (tallyLinkOf(co) || {}).company) || co.name;
  const start = () => ledImportStart(cid, { paused: !!(x.s && x.s.paused), pc });
  const upload = async (f) => {
    setBusy(true); const r = await Ledgers.fromMasters(cid, f); setBusy(false);
    S.ledFile = Object.assign({ cid, name: f.name, at: Date.now() }, r);
    if (r.ok && S.ledImp && S.ledImp.cid === cid) { S.ledImp.got[cid] = r.n; S.ledImp.end = Date.now(); S.ledImp.late = false; S.ledImp.err = ""; }
    if (r.ok) LED_N.set(cid, { n: r.n, at: Date.now(), book: ((cloudBook(cid) || {}).book) || "" });
    render();
  };
  const masters = <span className="tg-alt">
    <label className="btn small tg-linkbtn" data-guide-masters="">{busy ? "Reading the file…" : "Or upload the masters file"}
      <input type="file" accept=".xml" hidden data-guide-masters-in="" onChange={pickFile(upload)} /></label></span>;
  const f = S.ledFile && S.ledFile.cid === cid && Date.now() - S.ledFile.at < 3600e3 ? S.ledFile : null;
  const fileLine = f ? <p className={"tg-result" + (f.ok ? " ok" : " bad")} data-guide-masters-result={f.ok ? "ok" : "bad"} role="status">
    {f.ok ? nOf(f.n, "ledger", "ledgers") + " imported from " + f.name + " ✓" + (f.cloud === "sent" ? "" : f.cloud === "later" ? " (kept here; FinCom’s cloud takes them with the books)" : f.cloud ? " (kept here; FinCom’s cloud: " + f.cloud.replace(/^not sent: /, "") + ")" : "") : f.err}</p> : null;
  const others = x.ledMiss.length ? <p className="note tg-others" data-guide-others="ledgers">{"Also without ledgers in FinCom: " + namesOf(x.ledMiss) + ". Open each of them here once " + co.name + " is done."}</p> : null;
  let body;
  if (reading) body = <>
    <div className="tg-bar" data-guide-ledgers-bar="" role="progressbar" aria-label={"Reading " + co.name + "’s ledgers from Tally"} aria-busy="true"><i /></div>
    <p className="tg-progress" data-guide-ledgers-reading="">{"Reading " + co.name + "’s ledgers from Tally… "}
      {imp.prog && Number(imp.prog.of) > 0 && <><b data-guide-ledgers-count="">{Number(imp.prog.read).toLocaleString("en-IN") + " of " + nOf(Number(imp.prog.of), "ledger", "ledgers")}</b>{" · "}</>}
      <b className="tg-clock">{mmss(Date.now() - imp.at)}</b>
      <span className="note">{imp.via === "cloud" ? " · asked through FinCom’s cloud; the Tally computer picks it up within a minute or two" : imp.via === "bridge" ? " · FinCom Bridge on this computer is reading" : ""}</span></p></>;
  else if (late) body = <>
    <p className="tg-result bad" data-guide-ledgers-stop="late" role="status">{"Not received in 10 minutes. TallyPrime must be open on " + pc + " with " + company + " open, and reading not paused."}</p>
    <div className="tg-acts"><button className="btn small primary" data-guide-ledgers-again="" onClick={start}>Try again</button>{masters}</div>
    <MastersHow open /></>;
  else if (imp && imp.end) {
    const n = imp.got[cid] || 0;
    body = <p className="tg-result ok" data-guide-ledgers-done={n} role="status">{nOf(n, "ledger", "ledgers") + " of " + co.name + " imported ✓"}<span className="note">{" · took " + mmss(imp.end - imp.at)}</span></p>;
  } else body = <>
    {imp && imp.err && <p className="tg-result bad" data-guide-ledgers-err="" data-guide-ledgers-stop={imp.why || "error"} role="status">{imp.err}</p>}
    <p className="tg-text">{ledgersHeld(cid) ? nOf(ledgersOf(cid), "ledger", "ledgers") + " of " + co.name + " are in FinCom. Import again to bring the list up to date with Tally."
      : "Bring " + co.name + "’s list of ledgers from Tally into FinCom, once. It takes a minute or two while " + company + " is open in Tally."}</p>
    <div className="tg-acts"><button className="btn small primary" data-guide-ledgers-import={cid} onClick={start}>{imp && imp.err ? "Try again" : ledgersHeld(cid) ? "Import again" : "Import ledgers"}</button>{masters}</div>
    <MastersHow /></>;
  return <>{body}{fileLine}{others}</>;
}
// step 5 done, folded: what was just imported (the read, with its time; or the masters file), else what FinCom holds
function LedgersDone({ x }) {
  const imp = S.ledImp && S.ledImp.cid === x.cid ? S.ledImp : null, f = S.ledFile && S.ledFile.ok && S.ledFile.cid === x.cid && Date.now() - S.ledFile.at < 3600e3 ? S.ledFile : null;
  const others = x.ledMiss.length ? <span className="note" data-guide-others="ledgers">{" Also without ledgers: " + namesOf(x.ledMiss) + "."}</span> : null;
  if (imp && imp.end) { const n = imp.got[x.cid] || 0;
    return <span className="tg-result ok" data-guide-ledgers-held="" data-guide-ledgers-done={n}>{nOf(n, "ledger", "ledgers") + " of " + x.cur.name + " imported ✓"}<span className="note">{" · took " + mmss(imp.end - imp.at)}</span>{others}</span>; }
  if (f) return <span className="tg-result ok" data-guide-ledgers-held="" data-guide-masters-result="ok">{nOf(f.n, "ledger", "ledgers") + " imported from " + f.name + " ✓"}{others}</span>;
  return <span className="note" data-guide-ledgers-held="" data-guide-ledgers-n={ledgersOf(x.cid)}>{ledgersLine(x)}{others}</span>;
}
function ledgersLine(x) {
  const n = ledgersOf(x.cid);
  return (n ? nOf(n, "ledger", "ledgers") + " of " + x.cur.name : "The ledgers of " + x.cur.name) + " are in FinCom.";
}
// step 6: the Day Book of this financial year, through Books › From Tally's Upload (its JobsNote says how far the server
// has read it: "143 of 365 days read")
function openFromTally(cid) {
  const h = "#/c/" + encodeURIComponent(cid) + "/from-tally";
  if (typeof history !== "undefined") { try { history.pushState(null, "", location.pathname + location.search + h); } catch (e) {} }
  if (typeof Route === "object" && Route.apply) Route.apply(h); else openCompany(cid).then(() => { S.tab = "books"; S.booksTab = "import"; render(); });
}
const DAYBOOK_ART = <svg className="tg-art" viewBox="0 0 220 64" role="img" aria-label="Gateway, then Display More Reports, then Day Book, then export as XML">
  <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="14" width="52" height="34" rx="6" /><rect x="66" y="14" width="52" height="34" rx="6" /><rect x="130" y="14" width="44" height="34" rx="6" />
    <path d="M56 31h8M120 31h8M176 31h8" /><path d="M61 27l3 4-3 4M125 27l3 4-3 4M181 27l3 4-3 4" />
    <path d="M190 12h16l8 8v32a3 3 0 0 1-3 3h-21a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3z" /><path d="M206 12v8h8" /></g>
  <g fill="currentColor" fontFamily="inherit" fontSize="8.5" textAnchor="middle">
    <text x="28" y="34">Gateway</text><text x="92" y="29">Display More</text><text x="92" y="39">Reports</text><text x="152" y="34">Day Book</text>
    <text x="201" y="41" fontWeight="700">XML</text></g></svg>;
function DaybookStep({ x }) {
  if (!x.cur || !x.curLinked) return <span className="note">{x.cur ? "After step 4: link " + x.cur.name + " first." : "After step 4: link a client first."}</span>;
  const c = x.cur;
  if (typeof TCloud === "object" && TCloud.on() && TCloud.jobs && TCloud.jobs[c.id] === undefined && TCloud.jobsOk !== false) { TCloud.jobs[c.id] = []; setTimeout(() => TCloud.jobsLoad(c.id), 0); }
  const job = ((typeof TCloud === "object" && TCloud.jobs && TCloud.jobs[c.id]) || []).find((j) => j && j.kind === "upload" && j.status !== "failed");
  return <>
    <p className="tg-text">{"Upload " + c.name + "’s Day Book of this financial year from Tally once; after that FinCom reads new entries by itself."}</p>
    {job && <p className="tg-progress" data-guide-daybook-job={job.status}>{TCloud.jobLine(job)}</p>}
    <div className="tg-daybook">
      <ol className="tg-lines" data-guide-daybook-how="">
        <li>In TallyPrime: <b>Gateway of Tally → Display More Reports → Day Book</b>.</li>
        <li>Press <b>F2</b> and set the period: 1 April to today.</li>
        <li>Press <b>Alt+E</b> (Export), choose <b>XML (Data Interchange)</b>, and export. Then upload the file here.</li></ol>
      {DAYBOOK_ART}</div>
    <div className="tg-acts"><button className="btn small primary" data-guide-daybook-open={c.id} onClick={() => openFromTally(c.id)}>{"Open Upload for " + c.name}</button></div>
    {x.dayMiss.length > 0 && <p className="note tg-others" data-guide-others="daybook">{"Also without this year’s entries in FinCom: " + namesOf(x.dayMiss) + "."}</p>}
  </>;
}
function daybookLine(x) {
  const bk = cloudBook(x.cid);
  return "This year’s entries of " + x.cur.name + " are in FinCom" + (bk && bk.to ? " (up to " + fmtDate(tallyDate(d8Of(bk.to))) + ")." : ".")
    + (x.dayMiss.length ? " Also without them: " + namesOf(x.dayMiss) + "." : "");
}
function ConnectGuide({ rows, m, latest, connectStep }) {
  const p = TCloud.pane, g = S.tallyGuide || {};
  // a pointer elsewhere opened a step: that step is brought into view
  useEffect(() => { if (!g.at) return; const t = setTimeout(() => { const e = document.querySelector('#app [data-connect-guide] [data-connect-step="' + (GUIDE_KEYS[(g.step || 0) - 1] || "") + '"]') || document.querySelector("#app [data-connect-guide]");
    if (e && e.scrollIntoView) e.scrollIntoView({ block: "center" }); }, 80); return () => clearTimeout(t); }, [g.at]);
  // the linked clients' books in the cloud (steps 5 and 6): read when the guide is drawn and one is not known yet (or is
  // five minutes old); guideBooksLoad reads only those, a few at a time
  useEffect(() => { guideBooksLoad(); });
  // while a step is not done, the computers and companies are read again by themselves every 20 seconds, so a step ticks
  // (and a company opened in Tally shows in step 4) without a click
  useEffect(() => { const t = setInterval(() => {
    if (!document.querySelector("#app [data-connect-step]:not([data-done])") || !TCloud.on() || TCloud.pane.busy) return;
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (typing) return;
    if (typeof TLight === "object") TLight.st.at = 0;
    Promise.resolve(TCloud.refreshPane()).then(() => (typeof TLight === "object" ? TLight.refresh() : null)).then(() => guideBooksLoad()).then(() => render(), () => render());
  }, GUIDE_REFRESH_MS); return () => clearInterval(t); }, []);
  if (p.devices == null && !p.err) return null;
  const x = guideState(rows, latest), d = x.done, all = GUIDE_KEYS.every((k) => d[k]);
  const now = GUIDE_KEYS.find((k) => !d[k]), want = GUIDE_KEYS[(g.step || 0) - 1] || now, nowAt = GUIDE_KEYS.indexOf(now);
  const go = (i) => { S.tallyGuide = Object.assign({}, g, { step: i + 1, at: Date.now() }); render(); };
  // round 66 (the owner, 16-Oct-2026: "all 6 steps are not visible anywhere"): the six steps stay on the page, always; all
  // done, they show as six green ticks with one line under them (never folded away to a single line)
  const strip = <ol className="tg-strip" data-guide-strip="" aria-label="The six steps">
    {GUIDE_KEYS.map((k, i) => <li key={k} data-strip-step={k} className={d[k] ? "done" : k === now ? "now" : "later"} aria-current={k === now ? "step" : undefined}>
      <button type="button" data-guide-strip-go={k} onClick={() => go(i)} aria-label={"Step " + (i + 1) + ": " + GUIDE_STRIP[k] + (d[k] ? ", done" : "")}>
        <span className="tg-dot" aria-hidden="true">{d[k] ? TICK : i + 1}</span><span className="tg-lab">{GUIDE_STRIP[k]}</span></button></li>)}</ol>;
  const doneN = GUIDE_KEYS.filter((k) => d[k]).length;
  const head = <div className="tg-top"><h3>Connect Tally</h3>
    <span className="tg-count" data-guide-count={doneN}>{all ? <>{"All 6 done" + (x.cur ? " for " + x.cur.name : "") + " "}{TICK}</> : doneN + " of " + GUIDE_KEYS.length + " done"}</span>
    <GuideClientPick x={x} g={g} />
    {all && !!g.at && <button className="linkbtn" data-guide-hide="" onClick={() => { S.tallyGuide = { cid: g.cid }; render(); }}>Hide the steps</button>}</div>;
  if (all && !g.at) {
    const f = x.fine && x.fine[0], last = f ? lastEntryAt(f) : "", calm = !needsItems().length;
    return <section className="pane tguide tconnect tg2" data-connect-guide="done" data-all-good={calm ? "" : undefined}>
      {head}{strip}
      <p className="tconnected" style={{ margin: "10px 0 0" }}>
        <span className="tpc-ok" data-connected-line="">{"● Connected" + (x.openNow.length ? " · " + nOf(x.openNow.length, "company", "companies") + " open in Tally" : "") + " · last entry " + (last ? tallyHm(last) : "none yet")}</span>
        {calm && <span className="note">{" All good" + (x.cur ? " for " + x.cur.name : "") + "."}</span>}
        {" "}<button className="linkbtn" data-guide-again="" onClick={() => openConnectTally(1, "")}>Connect another computer</button></p>
      {x.curLinked && <Suspense fallback={null}><OlderEntries cid={x.cid} where="connect" /></Suspense>}
      <GuideOthers x={x} /></section>;
  }
  const owner = isOwner(), r = x.r, s = x.s, pc = r ? r.computer : "the Tally computer", user = (r && r.user) || "the Tally user", allStopped = TCloud.stoppedAll && TCloud.stoppedAll();
  const stop = s && s.stopped ? ((TCloud.stopFor && TCloud.stopFor(r.device.id)) || {}) : null;
  const forced = (k) => want === k && !!g.at;
  const later = (k) => !d[k] && nowAt >= 0 && GUIDE_KEYS.indexOf(k) > nowAt && want !== k;
  return <section className="pane tguide tconnect tg2" data-connect-guide={all ? "open" : now}>
    {head}{strip}
    <ol className="tguide-steps">
      <GuideStep k="install" n={1} title="Install FinCom Bridge" done={d.install && !forced("install")} open={want === "install"} later={later("install")}
        line={d.install && !forced("install") ? <span className="note">{"Installed on " + (x.live.length === 1 ? pcWords(x.live[0]) : x.live.length + " computers") + "."}</span> : null}
        more={<><span className="note">To install it on another computer:</span>{" "}<DownloadBtn m={m} primary={false} /></>}>
        {!(d.install && !forced("install")) && <><span className="note">On the computer where TallyPrime runs. If Windows says “Windows protected your PC”, press More info, then Run anyway.</span>{" "}<DownloadBtn m={m} primary={!d.install} />
          {connectStep && <div data-guide-connect-slot="">{connectStep}</div>}</>}
      </GuideStep>
      <GuideStep k="tally" n={2} title="Open TallyPrime" done={d.tally} open={want === "tally"} later={later("tally")}>
        {d.tally ? <span className="note">{"TallyPrime answers on " + pc + "."}</span>
          : !d.install ? <span className="note">After step 1.</span>
          : r && !r.online ? <span className="note">{"FinCom Bridge on " + pc + " is offline. Turn the computer on and sign in to Windows as " + user + ": it starts by itself."}</span>
          : <span className="note">{"Open TallyPrime on " + pc + ", signed in as " + user + ". In TallyPrime press F1 (Help) → Settings → Connectivity, set “TallyPrime acts as” to Both and choose any free port from 9000 to 9999 (" + (r ? tallyPortOf(r) : 9002) + " is usual). Each Windows user on the same computer who runs Tally at the same time needs a different number. FinCom finds the port by itself."}</span>}
      </GuideStep>
      <GuideStep k="company" n={3} title="Keep a company open" done={d.company} open={want === "company"} later={later("company")}>
        {d.company ? <span className="note" data-guide-open-count={x.openNow.length}>{openWords(x)}</span>
          : s && s.stopped ? <span data-guide-paused="stopped"><b>{"Reading stopped" + (stop.stopped_by ? " by " + who(stop.stopped_by) : "") + " on " + pc + ": " + (s.rd.reason || stop.reason || "no reason given") + "."}</b>{" "}
              {owner && !allStopped ? <button className="btn small primary" data-read-resume={r.device.id} onClick={() => TCloud.readResume(r)}>Resume reading</button> : !owner ? <span className="note">An owner of the firm can resume it.</span> : null}</span>
          : s && s.paused ? <span data-guide-paused="paused"><b>{"Reading is paused on " + pc + "."}</b>{" To resume: " + RESUME_TRAY + ". " + PAUSE_SAYS}{x.openNow.length ? <span className="note" data-guide-open-count={x.openNow.length}>{" " + openWords(x)}</span> : null}</span>
          : <span className="note">{"Leave TallyPrime open on a company" + (r ? " on " + pc : "") + "."}</span>}
      </GuideStep>
      <GuideStep k="link" n={4} title="Link the client" done={d.link && !forced("link")} open={want === "link"} later={later("link")}
        line={d.link && !forced("link") ? !x.cur ? <span className="note">Every client is linked.</span> : <span className="note" data-guide-link-held={x.cid}>{x.cur.name + " is linked to " + ((typeof tallyLinkOf === "function" && tallyLinkOf(x.cur).company) || x.cur.name) + "."}
          {x.unlinked.length > 0 && <span data-guide-others="link">{" Not linked yet: " + namesOf(x.unlinked) + "."}</span>}</span> : null} more={<LinkPicker x={x} g={g} />}>
        {!(d.link && !forced("link")) && <LinkPicker x={x} g={g} />}
      </GuideStep>
      <GuideStep k="ledgers" n={5} title="Import ledgers" done={d.ledgers && !forced("ledgers")} open={want === "ledgers"} later={later("ledgers")}
        line={d.ledgers && !forced("ledgers") ? <LedgersDone x={x} /> : null}
        more={<LedgersStep x={x} owner={owner} />}>
        {!(d.ledgers && !forced("ledgers")) ? <LedgersStep x={x} owner={owner} /> : null}
      </GuideStep>
      <GuideStep k="daybook" n={6} title="Bring in this year’s entries" done={d.daybook && !forced("daybook")} open={want === "daybook"} later={later("daybook")}
        line={d.daybook && !forced("daybook") ? <span className="note" data-guide-daybook-held="">{daybookLine(x)}</span> : null} more={<DaybookStep x={x} />}>
        {!(d.daybook && !forced("daybook")) && <DaybookStep x={x} />}
      </GuideStep>
    </ol>
    {d.daybook && x.curLinked && <Suspense fallback={null}><OlderEntries cid={x.cid} where="connect" /></Suspense>}
    {!all && d.install && <button className="btn small" data-check-again="" onClick={checkAgain}>Check again</button>}
  </section>;
}
// round 66: which client the steps are about (the client worked on: the pointer's, else the open client), changed here;
// only when the firm has more than one client
function GuideClientPick({ x, g }) {
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((a, c) => a.name.localeCompare(c.name));
  if (cos.length < 2) return null;
  return <label className="note tg-client" data-guide-client-wrap="" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>{"Client"}
    <select data-guide-client-pick="" aria-label="The client these steps are about" value={x.cid || ""} onChange={(ev) => { S.tallyGuide = { cid: ev.target.value }; render(); }}>
      {cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>;
}
// the other clients' gaps, one line, each name a button that opens the steps for that client
function GuideOthers({ x }) {
  const parts = [["Not linked yet", x.unlinked, 4], ["Without ledgers", x.ledMiss, 5], ["Without this year’s entries", x.dayMiss, 6]].filter(([, l]) => l.length);
  if (!parts.length) return null;
  return <p className="note" data-guide-others="all" style={{ margin: "6px 0 0" }}>{"Other clients: "}
    {parts.map(([w, l, step], i) => <span key={w}>{i > 0 && " · "}{w + ": "}{l.map((c, j) => <span key={c.id}>{j > 0 && ", "}
      <button type="button" className="linkbtn" data-guide-other={c.id} onClick={() => openConnectTally(step, c.id)}>{c.name}</button></span>)}</span>)}</p>;
}
// 2. Needs you: only what neither the guide nor a computer's line says (reading stopped on all computers, a computer key
// refused). sources: the slot for 2.4.1's card of a book open in two data locations (SourceCards on next-241), drawn
// first in this list when given
function unlinkedClients() {
  return Object.values(S.companies || {}).filter((c) => !c.deleted && typeof tallyLinkOf === "function" && tallyLinkOf(c).state === "unlinked").sort((a, c) => a.name.localeCompare(c.name));
}
function needsItems() {
  const owner = isOwner(), p = TCloud.pane, allStopped = TCloud.stoppedAll && TCloud.stoppedAll();
  const stopAll = (p.stops || []).find((x) => !x.device_id && !x.cleared_at);
  const items = [];
  if (allStopped) items.push(<li key="all" data-need="stopped-all" data-stopped-all="">
    <span>{"Reading stopped on all computers" + (stopAll && stopAll.stopped_by ? " by " + who(stopAll.stopped_by) : "") + ": " + ((stopAll && stopAll.reason) || "no reason given")}</span>
    {owner ? <button className="btn small primary" data-read-resume-all="" onClick={() => TCloud.readResume(null)}>Resume</button> : <span className="note">An owner of the firm can resume it.</span>}</li>);
  (p.devices || []).filter((d) => !d.revoked && d.info && d.info.idRefused).forEach((d) => items.push(<li key={"refused-" + d.id} data-need="refused" data-id-refused={d.id}><span><b>{d.name}</b>{": " + d.info.idRefused.words}</span></li>));
  return items;
}
function NeedsYou({ sources = null }) {
  const items = needsItems();
  if (!items.length && !sources) return null;
  return <section className="pane tneeds" data-needs-you="">
    <h3 style={{ margin: "0 0 6px" }}>Needs you</h3>
    {/* SLOT (FinCom 2.4.1): the card of a book open in two data locations goes here (SourceCards, next-241) */}
    {sources && <div data-needs-slot="sources">{sources}</div>}
    <ul className="tneeds-list">{items}</ul>
  </section>;
}
// 3. which client reads which Tally company: one row a client; the one action, Link, opens the guide's step 4 with that
// client, or nothing
function ClientsTable() {
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted);
  if (!cos.length || typeof tallyLinkOf !== "function") return null;
  const rows = cos.map((co) => { const k = tallyLinkOf(co) || {}, linked = k.state !== "unlinked"; return { co, k, linked, last: linked ? lastEntry(co, k) : "" }; });
  const nl = rows.filter((x) => !x.linked).length, { shown, more } = foldRows("clients", rows, (x) => !x.linked);
  const sum = nOf(rows.length, "client", "clients") + " · " + (rows.length - nl) + " linked · " + nl + " not linked";
  return <section className="pane tclients" data-tally-clients="" data-folded={foldOpen("clients") ? undefined : ""}>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 6px" }}>
      <h3 style={{ margin: 0 }}>{"Clients and their Tally company"}<span className="note" data-clients-head="" style={{ fontWeight: 400, marginLeft: 10 }}>{sum}</span></h3>
      <FoldToggle k="clients" total={rows.length} shown={shown.length} /></div>
    {shown.length > 0 && <ListTable name="tallyClients" className="data" rows={shown} rowKey={(x) => x.co.id} unit={["client", "clients"]} rowProps={(x) => ({ "data-client-row": x.co.id, "data-client-linked": x.linked ? "yes" : "no" })}
      cols={[
        { k: "client", role: "party", label: "Client", v: (x) => x.co.name, cell: (x) => <button className="linkbtn" data-client-open={x.co.id} onClick={() => openCompany(x.co.id)}>{x.co.name}</button> },
        { k: "company", role: "party", label: "Tally company", v: (x) => x.k.company || "", cell: (x) => x.k.company || <span className="note">{"—"}</span> },
        { k: "linked", role: "status", label: "Linked", v: (x) => (x.linked ? "Linked" : "Not linked"), cell: (x) => <span className={"tag " + (x.linked ? "ok" : "warn")} data-client-link-state="">{x.linked ? "Linked" : "Not linked"}</span> },
        { k: "last", label: "Last entry received", v: (x) => x.last || "", cell: (x) => x.last ? shortWhen(x.last) : <span className="note">{"—"}</span> },
        { k: "ac", role: "act", sort: false, cell: (x) => x.linked ? null : <button type="button" className="btn small" data-client-link={x.co.id} onClick={() => openConnectTally(4, x.co.id)}>Link</button> },
      ]} />}
    <FoldMore k="clients" more={more} />
  </section>;
}
// "GARG SHEKHAR (Alpha Traders ›)": the client a company read on a computer is linked to, a link to that client
function ClientOf({ company, dev }) {
  const l = (TCloud.pane.companies || []).find((c) => c.company === company && c.client_id && (!c.device_id || c.device_id === dev)), co = l && S.companies && S.companies[l.client_id];
  if (!co || co.deleted) return null;
  return <>{" ("}<button className="linkbtn" data-client-open={co.id} onClick={() => openCompany(co.id)}>{co.name + " \u203a"}</button>{")"}</>;
}
// round 39: the companies a computer reported that no client has yet; 15-Oct-2026: linked only in Connect Tally (step 4)
function SeenNotLinked({ r }) {
  const rows = (TCloud.pane.companies || []).filter((c) => c.company && !c.client_id && c.device_id === r.device.id);
  if (!rows.length) return null;
  return <div data-card-seen="">{"Seen, not linked: "}<b>{rows.map((c) => c.company).join(", ")}</b>{" "}
    <button className="linkbtn" data-open-connect="4" onClick={() => openConnectTally(4, "")}>Open Connect Tally</button></div>;
}
// the card's state in words
function cardState(r, n) {
  if (r.go && !r.old && !r.online) return ["bad", "Not connected"];
  if (n) return ["warn", "Needs you"];
  return ["ok", "Connected"];
}
// 2. one card a computer and Windows user
// FinCom Bridge 2.4.5: what the installer did with FinCom's add-on line in each tally.ini (the beat's tallyIni). A tally.ini
// that says "User TDL = No" is left untouched (the owner's default, decision pending) and said here for support; a line
// added or already there says nothing.
const INI_WORDS = { "usertdl-no": "says User TDL = No, so FinCom left it untouched: Tally does not load FinCom's add-on when it starts.",
  failed: "could not be changed; FinCom's add-on is not loaded when Tally starts.", refused: "is not an ordinary file; FinCom left it untouched.",
  unreadable: "could not be read; FinCom left it untouched." };
function TallyIniLines({ r }) {
  const l = [].concat((((r.device || {}).info || {}).beat || {}).tallyIni || []).filter((x) => x && INI_WORDS[x.state]);
  return l.map((x, i) => <div key={i} className="row" style={ROW}><span className="note" data-tally-ini={x.state}>{"tally.ini " + (x.path || "") + " " + INI_WORDS[x.state]}</span></div>);
}
// ROUND 103 (1c, 1d): reading older entries per computer, off by default (tally_devices.period_fetch, migration 98): an
// owner switches it on or off (tally_device_period_fetch); staff see the state only. The tray's old-days test (read only)
// as the bridge's heartbeat last said it: "Old-days test on <PC>: 0.21 s / 0.34 s / 0.18 s · no freeze". A cloud without
// the column shows nothing of the switch
function OldDaysLines({ r, owner }) {
  const d = r.device || {}, t = ((d.info || {}).beat || {}).oldDaysTest;
  const [pf, setPf] = useState(null), [n, setN] = useState(0);
  useEffect(() => {
    if (typeof Cloud !== "object" || !Cloud.api) return;
    let live = true;
    Cloud.api("tally_devices?select=id,period_fetch&id=eq." + encodeURIComponent(d.id || "")).then((rows) => { const x = [].concat(rows || []).find((y) => y && y.id === d.id); if (live) setPf(x ? x.period_fetch === true : null); },
      () => { if (live) setPf(null); });    // a cloud without the column (42703): nothing of the switch
    return () => { live = false; };
  }, [d.id, n]);
  const known = pf !== null, on = pf === true;
  const flip = () => { if (typeof TCloud !== "object" || !TCloud.control) return;
    Promise.resolve(TCloud.control("tally_device_period_fetch", { p_device: d.id, p_on: !on }, "Reading older entries " + (on ? "off" : "on") + " for " + (d.name || "the computer") + "; the bridge takes it at its next heartbeat."))
      .then(() => setN((x) => x + 1)); };
  return <>
    {known && <div className="row" style={ROW}><span className="note" data-period-fetch={on ? "on" : "off"}>{"Reading older entries on this computer: " + (on ? "on" : "off")}
      {owner && <> <button className="btn small" data-period-fetch-switch="" onClick={flip}>{on ? "Switch off" : "Switch on"}</button></>}</span></div>}
    {t && t.line && <div className="row" style={ROW}><span className="note" data-old-days-test={t.stopped ? "stopped" : "ok"}>{"Old-days test on " + pcName(r) + ": " + t.line + (t.company ? " (" + t.company + ")" : "")}</span></div>}
  </>;
}
function ComputerCard({ r, latest, m, focus }) {
  const owner = isOwner(), p = TCloud.pane, allStopped = TCloud.stoppedAll && TCloud.stoppedAll();
  const rd = r.read || { state: r.online ? "reading" : "offline", text: "" }, live = r.go && !r.old, k = cardKey(r), open = moreOpen(k);
  const n = needOf(r, latest, owner, allStopped), [lv, word] = cardState(r, n);
  // the companies it reads (open in its Tally), and the last entry it sent (Tally's change recorder, else its last read)
  const cos = live ? (r.open || []) : [], last = live ? lastEntryAt(r) : "";
  // a plain note when all is well but something is going on by itself (Tally busy, asked again, a new version on its way)
  const st = lineState(r, latest, owner);
  const quiet = n ? "" : rd.state === "retrying" ? "Tally did not answer in time; FinCom asks again by itself."
    : r.tally === "busy" ? "Tally is busy; FinCom carries on when it is free."
    : allStopped ? "Reading stopped on all computers (see Needs you)."
    : /update ready/.test(st.text) ? st.act : "";
  const stopped = !!(TCloud.stopFor && TCloud.stopFor(r.device.id)) || !!(r.readStopped && r.readStopped.by === "fincom");
  return <div className={"tcard" + (focus ? " tcard-focus" : "")} data-computer={r.device.id} data-bridge-user={r.user || ""} data-read-state={live ? rd.state : "old"} data-card-state={word} data-focus={focus ? "" : undefined}>
    <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <b data-card-name="">{pcName(r)}</b><span className={"tag " + lv} data-bridge-state="">{word}</span>
      {live && <span style={{ marginLeft: "auto" }}><MoreToggle k={k} label="Details (for support)" less="Hide details" aria-label={"Details of " + pcName(r)} /></span>}
    </div>
    <div className="tcard-facts">
      <div data-card-companies="">{cos.length ? <>{r.online ? "Reads " : "Read when last connected: "}{cos.map((c, i) => <span key={c}>{i > 0 && ", "}<b>{c}</b><ClientOf company={c} dev={r.device.id} /></span>)}</> : <span className="note">{live && r.online ? "No company open in Tally" : "No company being read"}</span>}</div>
      {live && <SeenNotLinked r={r} />}
      <div data-card-last="">{last ? "Last entry received " + whenWords(last) : <span className="note">No entry received yet</span>}</div>
    </div>
    <div data-status-line="" data-bridge-line={r.id || "old"} data-level={n ? (lv === "ok" ? "warn" : lv) : lv} className="tcard-line">
      {n ? <><span data-bridge-act="">{n.text}</span>{" "}<NeedAct r={r} n={n} m={m} /></> : quiet ? <span className="note">{quiet}</span> : null}
    </div>
    {open && <div data-card-more="" className="tcard-more">
      <div className="tcard-sub">Details (for support)</div>
      <div className="row" style={ROW}><span className="note" data-card-version="">{"FinCom Bridge " + (r.version || "") + (r.runMode ? " · " + (RUN[r.runMode] || r.runMode) : "") + (r.main ? " · main bridge: reads and posts" : " · reads only")}</span></div>
      {rd.state !== "reading" && <div className="row" style={ROW}><span className="note" data-read-text="">{rd.state === "paused" ? "Reading paused" : rd.text}</span></div>}
      <div className="row" style={ROW}><BridgeWhere r={r} /></div>
      <div className="row" style={ROW}><ReadWho r={r} /><Reqs r={r} /></div>
      {postOnlyOf(r).length > 0 && <div className="row" style={ROW}><span className="note" data-post-only="" title="FinCom Bridge posts only to these Tally companies (its PostOnly setting); it reads every company open">{"Posts only to: " + postOnlyOf(r).join(", ")}</span></div>}
      <RecorderLine r={r} />
      <SlowCompanies r={r} />
      <Baselines r={r} owner={owner} />
      <SelfChecks r={r} />
      <TallyIniLines r={r} />
      <OldDaysLines r={r} owner={owner} />
      <div className="tcard-sub" data-card-settings="">{owner ? "Settings" : "Settings (an owner of the firm changes these)"}</div>
      {owner && !allStopped && <div className="row" style={ROW}>{stopped ? n && n.act === "resume" ? null : <button className="btn small" data-read-resume={r.device.id} onClick={() => TCloud.readResume(r)}>Resume reading</button>
        : <button className="btn small" data-read-stop={r.device.id} onClick={() => TCloud.readStop(r)}>Stop reading on this computer</button>}</div>}
      <div className="row" data-bridge-per-user="" style={ROW}><ChangesOnly r={r} owner={owner} /><MemberLink r={r} owner={owner} /></div>
      <div className="row" style={ROW}><PostSettings r={r} owner={owner} /></div>
      <div className="row" style={ROW}><TrialTools r={r} owner={owner} /></div>
      <div className="row" style={ROW}><RecorderSource r={r} owner={owner} /></div>
      {!r.main && !(n && n.act === "makeMain") && (owner ? <div className="row" style={ROW}><button className="btn small" data-make-main={r.id} onClick={() => TCloud.makeMain(r)}>Make this the main bridge</button></div>
        : <div className="row" style={ROW}><span className="note">An owner of the firm can make it the main bridge.</span></div>)}
    </div>}
  </div>;
}
function BridgeLines({ cards, latest, m, focusDev }) {
  const p = TCloud.pane, ctl = p.ctl || {};
  return <div data-bridge-lines="" data-computers="">
    {cards.map((r) => <ComputerCard key={r.device.id + "|" + (r.user || "")} r={r} latest={latest} m={m} focus={!!focusDev && r.device.id === focusDev} />)}
    {ctl.err && <p className="bk-alert bad" data-control-err="" style={{ margin: "6px 0" }}><Msg text={ctl.err} /></p>}
    {ctl.ok && <p className="note" data-control-ok="" style={{ margin: "6px 0" }}>{ctl.ok}</p>}
  </div>;
}
// From a client ("Tally" on its From Tally tab or Client setup → Tally): the line that says which computer and company
// the page is showing for it; its computer's card is marked and scrolled to
function focusOf(cid) {
  if (!cid || !S.companies || !S.companies[cid]) return null;
  const co = S.companies[cid], tl = (typeof TLight === "object" && TLight.st) || {};
  const link = (tl.cos || []).find((c) => c.client_id === cid && c.device_id) || (TCloud.pane.companies || []).find((c) => String(c.client_id || "") === String(cid));
  return { co, company: (link && link.company) || co.tallyName || "", dev: (link && link.device_id) || "" };
}
function FocusLine({ f, cards }) {
  useEffect(() => { if (!f || !f.dev) return; const t = setTimeout(() => { const e = document.querySelector('#app [data-pc-line="' + f.dev + '"]'); if (e && e.scrollIntoView) e.scrollIntoView({ block: "center" }); }, 80); return () => clearTimeout(t); }, [f && f.dev]);
  if (!f) return null;
  const r = f.dev && cards.find((x) => x.device.id === f.dev);
  return <p className="note" data-tally-focus={f.co.id} style={{ margin: "0 0 10px" }}>
    {f.co.name + ": " + (r ? "linked to " + (f.company || "its Tally company") + " on " + pcName(r) + " (marked below)." : f.company ? "no computer reads " + f.company + " yet." : "not linked to a Tally company yet.")}
    {" "}<button className="linkbtn" data-focus-clear="" onClick={() => { S.tallyFocus = ""; render(); }}>Show all computers</button></p>;
}
// the page's one fold, "Advanced (for support)" (the calm page, 15-Oct-2026), closed by default: Sync activity and
// Everything sent, each computer's details and the owner's settings (as before, with their own Details), the versions
// (hold, let go, roll back, withdraw), Stop reading on all computers, every bridge heard from (the old ones too), the
// clients' lines, connect another computer, this browser's own connection (its Connect steps, the Tallys found with their
// ports and Windows sessions, Check my Tally, the reading test, the bridge's log), the connection history, and FinCom
// Bridge's install again (fingerprint, direct link, PowerShell, Windows blocked it?)
// round 66 (the owner, 16-Oct-2026: "3 or 4 pages of Tally things.. need a very simple Tally page"): the fold is "Help &
// support", closed by default, its parts under small headings: the reading table and the clients' table (folded as
// before), activity, each computer heard this week (a bridge not heard for 7 days is only counted here, and listed in
// Every bridge), versions, this browser's own bridge, install on another computer. The outdated "Clients' Tally" lines
// ("reads only when needed… nightly catch-up", wrong since 2.2) are gone: Update now is on each client's pages.
function PageMore({ rows, latest, m, cards, old = 0, connectStep }) {
  const owner = isOwner(), open = moreOpen("page");
  const allStopped = TCloud.stoppedAll && TCloud.stoppedAll();
  const H = ({ children, id }) => <h4 className="tadv-h" data-help-part={id} style={{ margin: "16px 0 6px" }}>{children}</h4>;
  return <div className="pane tadvanced" data-page-more="" data-advanced="" style={{ padding: "8px 16px" }}>
    <MoreToggle k="page" data-bridge-details="" label="Help & support" less="Hide help & support" />
    {open && <div data-bridge-more="" style={{ marginTop: 6 }}>
      {cards.length > 0 && <ReadingView cards={cards} />}
      <ClientsTable />
      {/* round 89: deductions on challans the server does not have, after fetching the challans again (54-live-sync.js heal) */}
      {typeof BookItems === "object" && Object.entries(BookItems.st || {}).filter(([, x]) => x && x.chMiss > 0).map(([cid, x]) => <p key={cid} className="note bad" data-sync-chmiss={cid}>
        {((S.companies[cid] || {}).name || cid) + ": deductions point at " + x.chMiss + " challan" + (x.chMiss === 1 ? "" : "s") + " not on the server; they are listed under Not on any challan (TDS › Deductions) to choose again."}</p>)}
      <H id="activity">Activity</H>
      <nav className="row tadv-links" aria-label="Tally, for support" style={{ gap: 8, flexWrap: "wrap", margin: "0 0 4px" }}>
        {TALLY_TABS.filter(([id]) => id !== "computers").map(([id, label]) => <button key={id} className="btn small" data-tally-tab={id} onClick={() => goTab(id)}>{label}</button>)}</nav>
      {(cards.length > 0 || old > 0) && <H id="computers">Each computer</H>}
      {cards.length > 0 && <BridgeLines cards={cards} latest={latest} m={m} />}
      {old > 0 && <p className="note" data-old-computers={old} style={{ margin: "4px 0" }}>{nOf(old, "older bridge", "older bridges") + " not heard from for over 7 days: hidden here (listed under Every bridge below)."}</p>}
      <H id="versions">Versions</H>
      <Release rows={rows} latest={latest} owner={owner} />
      {owner && TCloud.on() && !allStopped && <div className="row" style={{ gap: 8, margin: "6px 0 10px" }}>
        <button className="btn small" data-read-stop-all="" onClick={() => TCloud.readStop(null)}>Stop reading on all computers</button></div>}
      <BridgesHeard />
      <H id="this-computer">This computer</H>
      <BridgeSettings inDetails />
      <H id="install">Install on another computer</H>
      <BridgeDownload m={m} again={rows.length > 0} />
    </div>}
  </div>;
}
// review of 02-Oct-2026: every bridge FinCom has heard from (TCloud.bridgesHeard), which one is the main one, and a
// button to make a bridge in test mode the main one (owners)
const RUN = { user: "just for this user", service: "Windows service", window: "started by hand" };
const TSTATE = { open: "Tally open", busy: "Tally busy", closed: "Tally not seen" };
export function BridgesHeard() {
  const p = TCloud.pane;
  if (!TCloud.on()) return null;
  paneFresh();
  const rows = TCloud.bridgesHeard(), owner = S.account && S.account.me && S.account.me.role === "owner";
  return <div className="pane" data-bridges="">
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}><h3 style={{ margin: 0 }}>Every bridge FinCom has heard from</h3>
      <button className="btn small" onClick={() => TCloud.refreshPane()}>Refresh</button></div>
    <p className="note" style={{ margin: "6px 0 10px" }}>Every bridge on the firm’s computers, from its last heartbeat. Only the <b>main</b> bridge posts to Tally; a bridge in <b>test mode</b> reads only.</p>
    {p.err && <p className="note bad"><Msg text={p.err} /></p>}
    {/* the one list table (spec K6): last seen (date), computer, mode (status), then the rest */}
    <ListTable name="bridges" className="data" rows={rows} loading={TCloud.pane.devices == null && !p.err ? "the bridges" : false} rowKey={(r, i) => r.device.id + ":" + (r.id || "old") + ":" + i} unit={["bridge", "bridges"]} rowProps={(r) => ({ "data-bridge-row": r.id || "old" })}
      empty="No bridge has been heard from yet. Install FinCom Bridge on the computer with TallyPrime: Connect, above, shows how."
      cols={[
        { k: "at", role: "date", label: "Last seen", v: (r) => r.at || "", cell: (r) => <>{r.at ? fmtDateTime(r.at) : "—"}<div className="nr">{r.online ? <span className="ok">online</span> : <span className="bad">offline</span>}</div></> },
        { k: "pc", role: "party", label: "Computer", v: (r) => r.computer || "", cell: (r) => <>{r.computer}<div className="nr">{r.device.name}</div></> },
        { k: "mode", role: "status", label: "Mode", v: (r) => (r.main ? "Main" : "Test"), cell: (r) => (r.main ? <span className="tag ok">Main: reads and posts</span> : <span className="tag warn">Test: reads only</span>) },
        { k: "user", label: "Windows user", v: (r) => r.user || "", cell: (r) => r.user || "—" },
        { k: "ver", label: "Bridge", v: (r) => r.version || "", cell: (r) => <>{r.go && !r.old ? "FinCom Bridge " + (r.version || "?") : "Older bridge"}{r.runMode && <div className="nr">{RUN[r.runMode] || r.runMode}</div>}</> },
        { k: "tally", label: "Tally", v: (r) => TSTATE[r.tally] || r.tally || "", cell: (r) => TSTATE[r.tally] || r.tally },
        { k: "open", label: "Companies open", cell: (r) => (r.open.length ? r.open.join(", ") : <span className="note">none</span>) },
        { k: "ac", role: "act", cell: (r) => !r.main && r.go && (r.old ? <span className="note">Install FinCom Bridge on this computer to replace it</span>
          : p.noMain ? <span className="note">Not available until FinCom’s cloud is updated (migration-22)</span>
          : owner ? <button className="btn small primary" data-make-main={r.id} onClick={() => TCloud.makeMain(r)}>Make this the main bridge</button>
          : <span className="note">An owner of the firm can make it the main bridge</span>) },
      ]} />
  </div>;
}

// review of 02-Oct-2026: when Windows blocks the download or the install, the exact steps, with pictures of what Windows
// shows (drawn here, simplified), and a place to drop the install log when the bridge could not send it itself
const Shot = ({ title, children, label }) => <figure style={{ margin: 0 }} aria-label={label}>
  <svg viewBox="0 0 320 170" width="320" height="170" role="img" aria-label={label} style={{ maxWidth: "100%", height: "auto", border: "1px solid var(--rule-soft)", borderRadius: 6 }}>
    <rect x="0" y="0" width="320" height="170" fill="#1C5FA8" />
    <text x="16" y="34" fill="#fff" fontSize="17" fontFamily="Segoe UI, sans-serif">{title}</text>
    {children}
  </svg></figure>;
function BlockedHelp() {
  const p = TCloud.pane, ls = p.logSent;
  return <div className="bdiag" data-install-help="" style={{ marginTop: 12 }}>
    <h3 style={{ margin: "0 0 6px" }}>If Windows blocks the download or the setup</h3>
    <ol style={{ margin: "0 0 0 18px", padding: 0, lineHeight: 1.55 }}>
      <li><b>“Windows protected your PC”</b> (SmartScreen; the test build is not signed yet): press <b>More info</b>, then <b>Run anyway</b>.
        <div className="row" style={{ gap: 12, margin: "8px 0", flexWrap: "wrap" }}>
          <Shot label="Step 1: Windows protected your PC, press More info" title="Windows protected your PC">
            <text x="16" y="62" fill="#fff" fontSize="11" fontFamily="Segoe UI, sans-serif">Microsoft Defender SmartScreen prevented an</text>
            <text x="16" y="77" fill="#fff" fontSize="11" fontFamily="Segoe UI, sans-serif">unrecognised app from starting…</text>
            <rect x="12" y="88" width="72" height="22" fill="none" stroke="#FFD24A" strokeWidth="3" rx="3" />
            <text x="18" y="104" fill="#fff" fontSize="12" textDecoration="underline" fontFamily="Segoe UI, sans-serif">More info</text>
            <rect x="222" y="130" width="84" height="26" fill="#fff" opacity=".85" /><text x="246" y="148" fill="#1C5FA8" fontSize="12" fontFamily="Segoe UI, sans-serif">Don’t run</text>
            <text x="100" y="104" fill="#FFD24A" fontSize="12" fontFamily="Segoe UI, sans-serif">1. press this</text>
          </Shot>
          <Shot label="Step 2: press Run anyway" title="Windows protected your PC">
            <text x="16" y="62" fill="#fff" fontSize="11" fontFamily="Segoe UI, sans-serif">App: FinComBridge-Setup-2.x.exe</text>
            <text x="16" y="77" fill="#fff" fontSize="11" fontFamily="Segoe UI, sans-serif">Publisher: Unknown publisher</text>
            <rect x="122" y="130" width="90" height="26" fill="#fff" opacity=".85" /><text x="138" y="148" fill="#1C5FA8" fontSize="12" fontFamily="Segoe UI, sans-serif">Run anyway</text>
            <rect x="119" y="127" width="96" height="32" fill="none" stroke="#FFD24A" strokeWidth="3" rx="3" />
            <rect x="222" y="130" width="84" height="26" fill="#fff" opacity=".85" /><text x="246" y="148" fill="#1C5FA8" fontSize="12" fontFamily="Segoe UI, sans-serif">Don’t run</text>
            <text x="16" y="148" fill="#FFD24A" fontSize="12" fontFamily="Segoe UI, sans-serif">2. then this</text>
          </Shot>
        </div></li>
      <li><b>The browser stops the download</b> (“isn’t commonly downloaded”, or Edge’s <b>Keep</b>): open the downloads list, press <b>…</b> next to the file, then <b>Keep</b> and <b>Keep anyway</b>. Or download it with the PowerShell command above instead: a file saved that way is not stopped by SmartScreen.</li>
      <li><b>Windows asks for an administrator’s password</b> (User Account Control) and you have none: press <b>No</b>. Run the setup again and keep <b>Just for me</b> (the default): it needs no administrator. Only <b>For all users</b> (a Windows service) needs one, and the setup says so before Windows asks.
        <div style={{ margin: "8px 0" }}><Shot label="User Account Control: press No when you have no administrator" title="User Account Control">
          <text x="16" y="62" fill="#fff" fontSize="11" fontFamily="Segoe UI, sans-serif">Do you want to allow this app to make changes</text>
          <text x="16" y="77" fill="#fff" fontSize="11" fontFamily="Segoe UI, sans-serif">to your device? (an administrator’s password)</text>
          <rect x="40" y="130" width="110" height="26" fill="#fff" opacity=".6" /><text x="84" y="148" fill="#1C5FA8" fontSize="12" fontFamily="Segoe UI, sans-serif">Yes</text>
          <rect x="170" y="130" width="110" height="26" fill="#fff" opacity=".85" /><text x="218" y="148" fill="#1C5FA8" fontSize="12" fontFamily="Segoe UI, sans-serif">No</text>
          <rect x="167" y="127" width="116" height="32" fill="none" stroke="#FFD24A" strokeWidth="3" rx="3" />
          <text x="16" y="112" fill="#FFD24A" fontSize="12" fontFamily="Segoe UI, sans-serif">No administrator? Press No, then choose Just for me</text>
        </Shot></div></li>
      <li><b>“This app has been blocked by your system administrator”</b> (a company policy): the setup cannot run on this computer as you. Ask the person who looks after the server to install it <b>For all users</b>, or to allow FinCom Bridge.</li>
    </ol>
    <h3 style={{ margin: "14px 0 6px" }}>The setup failed?</h3>
    <p className="note" style={{ margin: "0 0 6px" }}>The setup keeps a log of every step at <code>%LOCALAPPDATA%\FinCom Bridge\install.log</code> (paste that into the Explorer address bar). Its last page has <b>Send install log to FinCom</b>; if this computer is not connected to FinCom yet, drop the file here instead and FinCom support sees exactly what went wrong.</p>
    {TCloud.on() ? <label className="btn small" data-install-log="" style={{ cursor: "pointer" }}>Send an install log…
      <input type="file" accept=".log,.txt,text/plain" style={{ display: "none" }} onChange={(ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; TCloud.sendInstallLog(f); }} /></label>
      : <p className="note">Sign in to the firm account to send an install log.</p>}
    {ls && (ls.busy ? <p className="note">Sending…</p> : ls.err ? <p className="bk-warn"><Msg text={ls.err} /></p> : <p className="note ok" data-install-log-sent="">{"Sent " + ls.name + " to FinCom support (reference " + ls.ref + ")."}</p>)}
  </div>;
}

function DownHelp({ c }) {
  const url = c.url.replace(/\/+$/, "");
  return <div className="bdiag"><b>FinCom cannot reach FinCom Bridge on this computer. Check, in this order:</b><ol style={{ margin: "8px 0 0 18px", padding: 0, lineHeight: 1.55 }}>
    <li>Is the FinCom icon near the clock (or under the <b>^</b> arrow)? If not, open <b>FinCom Bridge</b> from the Start menu.</li>
    <li>Right-click the icon → <b>Test connection</b>: it says what is wrong and what to do. <b>Show log</b> has the details for support.</li>
    <li>In this same browser, open <a href={url + "/ping"} target="_blank" rel="noopener">{url + "/ping"}</a>. If it shows <code>"ok":true</code>, press <b>Retry</b> below (and choose <b>Allow</b> if the browser asks about apps on this device).</li>
    <li>If that page cannot be reached, FinCom and the bridge are on different computers: open FinCom inside the server session where TallyPrime runs.</li>
  </ol><div className="row" style={{ marginTop: 8 }}><Act act="bridgeTest" className="btn small primary">Retry</Act></div></div>;
}

function SetupSteps() {
  const st = Bridge.st, connected = Bridge.on() && Bridge.up();
  const Step = ({ n, done, title, children }) => <li className={done ? "done" : ""}><b>{(done ? "✔ " : "") + title}</b>{children && <div>{children}</div>}</li>;
  return <div className="setupcard" data-connect-steps=""><h3 style={{ margin: "0 0 6px" }}>Connect this browser to FinCom Bridge</h3><ol className="setup">
    <Step n={1} done={connected} title="FinCom Bridge on the Tally computer">Download it from the card on this page and run it there. No admin rights needed.</Step>
    <Step n={2} done={connected && st.tallyUp} title="Open TallyPrime and your company">In TallyPrime: F1 Help → Settings → Connectivity → <b>TallyPrime acts as: Both</b>.</Step>
    <Step n={3} done={connected} title="Press Connect here">Press <Act act="bridgeConnect" className="btn small">Connect</Act> and type the 6-digit code: right-click the FinCom icon near the clock → <b>Connect FinCom on this computer…</b>. No other web page can connect.</Step>
  </ol></div>;
}

// the hidden way back to bridge 1.15.0 (#/tally/bridge-1.15, linked from nowhere; 02-Oct-2026, should FinCom Bridge fail
// on a computer): its setup file and the steps it needs, as before
function OldBridge() {
  return <div className="pane" data-old-bridge=""><h2>Bridge 1.15.0 (fallback)</h2>
    <p className="note">Only if FinCom Bridge does not work on a computer. Uninstall FinCom Bridge there first (Settings → Apps → FinCom Bridge), then:</p>
    <ol style={{ margin: "8px 0 0 18px", padding: 0, lineHeight: 1.6 }}>
      <li>Press <Act act="bridgeSetupFile">Download the bridge 1.15.0 setup</Act> and run <b>Setup-FinCom-Bridge.bat</b> on the computer with TallyPrime (double-click, press <b>I</b>).</li>
      {S.bridgeSha && <li style={{ listStyle: "none", fontSize: 12 }}>Fingerprint (SHA-256) of the file just saved: <code style={{ userSelect: "all", wordBreak: "break-all" }}>{S.bridgeSha}</code></li>}
      <li>Open FinCom on that computer, Tally page → Details → Connect, and type the 6-digit code shown in the bridge window.</li>
    </ol>
    <p className="note" style={{ marginTop: 10 }}><a href="#/tally">Back to the Tally page</a></p></div>;
}

// session 0 and other Windows logins, said once in plain words (the Tally redesign, 09-Oct-2026)
const SESSION0 = "Other Tally windows on this computer that belong to other Windows logins; the bridge ignores them.";
// the Tallys the bridge found: whose, the companies open, the client each is, and which one to use
function Sessions({ c, st }) {
  if (!st.sessions.length) return <p className="note">No TallyPrime found. Start TallyPrime in this Windows session.</p>;
  const skipped = st.sessions.some((se) => se.skipped);
  return <>{skipped && <p className="note" data-session0="" style={{ margin: "0 0 6px" }}><b>Another user — not used:</b>{" " + SESSION0}</p>}<table className="data" data-statement=""><thead><tr><th>Tally</th><th>Owner</th><th>Companies open</th><th>FinCom client</th><th></th></tr></thead><tbody>
    {st.sessions.filter((se) => se.ok || se.skipped || num(c.port) === se.port || st.mode !== "fallback").map((se) => {
      const pinned = num(c.port) === se.port;
      return <tr key={se.port}><td>{"Port " + se.port}</td>
        <td>{se.skipped ? <span className="tag no">Another user — not used</span> : se.mine === true ? <span className="tag ok">Your session</span> : <span className="tag warn">Not checked</span>}</td>
        <td>{se.skipped ? <span className="note">hidden</span> : !se.ok ? <span className="note">{se.error ? "not answering" : "—"}</span> : se.companies.length ? se.companies.map((o, i) => <span key={i}>{i > 0 && <br />}<b>{o.name}</b></span>) : <span className="note">no company open</span>}</td>
        {/* round 39: no linking here (it only set a Tally name): a client is linked on its Link to Tally card */}
        <td>{se.skipped || !se.ok ? null : se.companies.map((o, i) => { const cl = Bridge.clientFor(o.name);
          return <span key={i}>{i > 0 && <br />}{cl ? cl.name : <span className="note">not linked</span>}</span>; })}</td>
        <td>{se.skipped ? null : pinned ? <><span className="tag ok">In use</span> <button className="linkbtn" onClick={() => bridgePin(0)}>Automatic</button></> : se.ok ? <button className="btn small" onClick={() => bridgePin(se.port)}>Use this Tally</button> : null}</td></tr>;
    })}</tbody></table></>;
}

// review of 01-Oct-2026: the last lines of the bridge's own log (tds-bridge.log), to read here or copy for support,
// without looking for the file on the Tally computer (its /logtail)
function BridgeLog() {
  const [lg, setLg] = useState(null);
  const load = () => { setLg({ busy: true }); Bridge.call("/logtail?n=200", null, 20000).then((j) => setLg({ file: j.file || "", lines: j.lines || [] }),
    (e) => setLg({ error: /unknown|not found|404/i.test(String((e && e.message) || "")) ? "This bridge cannot show its log here: install FinCom Bridge from the Tally page (or right-click its icon → Show log)." : ((e && e.message) || String(e)) })); };
  const text = lg && lg.lines ? lg.lines.join("\n") : "";
  const copy = () => (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast("Log copied."), () => toast("Could not copy; select the text and copy it."));
  return <div className="bridge-log" style={{ marginTop: 10 }}>
    <div className="row" style={{ gap: 8, alignItems: "center" }}><button className="linkbtn" data-act="bridgeLog" onClick={load} disabled={!!(lg && lg.busy)}>{lg && lg.lines ? "Show bridge log again" : "Show bridge log"}</button>
      {lg && lg.lines && <><button className="btn small" onClick={copy}>Copy</button><button className="linkbtn" onClick={() => setLg(null)}>Hide</button></>}</div>
    {lg && lg.busy && <p className="note">Reading the log…</p>}
    {lg && lg.error && <p className="bk-warn"><Msg text={lg.error} /></p>}
    {lg && lg.lines && <><p className="note" style={{ margin: "6px 0 4px" }}>{"The last " + lg.lines.length + " lines of " + (lg.file || "tds-bridge.log") + ", newest at the bottom."}</p>
      <pre className="bridge-log-text" style={{ maxHeight: 320, overflow: "auto", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--bg-soft, rgba(127,127,127,.08))", padding: 8, borderRadius: 6, margin: 0 }}>{text || "(the log is empty)"}</pre></>}
  </div>;
}

// inDetails: drawn inside the page's Details (for support); elsewhere the Tallys found, with their ports and Windows
// sessions, the checks and the log fold under their own "Details (for support)" (round 39: no port in the main steps)
export function BridgeSettings({ inDetails = false }) {
  const c = Bridge.cfg(), st = Bridge.st;
  if (Bridge.blocked()) return <div className="pane"><h2>FinCom Bridge on this computer</h2><p className="note" style={{ margin: 0 }}>Pages opened on claude.ai cannot reach programs on your computer. To connect to Tally, use the downloaded app (<b>Download standalone app</b>) on the computer where TallyPrime runs.</p></div>;
  const MODE = { auto: "The bridge finds the TallyPrime running in your Windows session" + (st.user ? " (" + st.user + ")" : "") + " and ignores other users’ Tally.", config: "The bridge uses the Tally ports listed in its settings file.", fallback: "Windows did not tell the bridge which Tally is yours: choose it below." };
  return <>
    <div className="pane" data-connect-section=""><h3 style={{ marginTop: 0 }}>FinCom Bridge on this computer</h3><p className="note" style={{ margin: "0 0 12px" }}>This browser and FinCom Bridge on the same computer: the company open in Tally is followed, ledgers load straight from Tally, and entries are posted without files. Other computers post through FinCom’s cloud.</p>
      <div className="grid"><label className="f"><span>Bridge address</span><CommitBox data-bridge="url" aria-label="Bridge address" value={c.url} onCommit={(v) => bridgeSet("url", v)} /></label>
        <label className="f"><span>Bridge key (filled in by Connect)</span><CommitBox data-bridge="key" data-fk="bridgekey" aria-label="Bridge key" value={c.key} autoComplete="off" placeholder="press Connect below" onCommit={(v) => bridgeSet("key", v)} /></label></div>
      <label className="chk" style={{ marginTop: 8 }}><input type="checkbox" checked={!!c.follow} onChange={(ev) => bridgeSet("follow", ev.target.checked)} /> Follow the company open in Tally (switch FinCom to it automatically)</label>
      <div className="row" style={{ marginTop: 10 }}><Act act="bridgeTest" className="btn small primary">{c.key ? "Check connection" : "Connect"}</Act>{c.key && <Act act="bridgeOff">Disconnect</Act>}</div>
      <div style={{ margin: "12px 0 0" }}><TallyStates co={S.coId ? CO() : null} /></div>
      {!(Bridge.on() && Bridge.up()) && <SetupSteps />}
      {c.key && <div style={{ marginTop: 12 }}>{st.state === "ok" ? <>
        <p className="note" style={{ margin: "0 0 6px" }}>{"FinCom Bridge " + (st.version || "") + " connected" + (st.allowImport === false ? " (posting switched off in the bridge)" : "") + ". Checked " + fmtTime(st.at) + "."}</p>
        <p className="note" style={{ margin: "0 0 6px" }}>{MODE[st.mode] || ""}</p>
        {(st.clash || []).length > 0 && <p className="bk-warn">{st.clash.join(", ") + " is open in more than one Tally. Choose yours under Details (for support) with "}<b>Use this Tally</b>; until then nothing is read or posted for it.</p>}
        {st.tallyUp || (Bridge.diag && (Bridge.diag.findings || []).length) ? null : <p className="bk-warn">TallyPrime is not answering. In TallyPrime: F1 Help → Settings → Connectivity → set “TallyPrime acts as” to Both.</p>}
        {!inDetails && <MoreToggle k="bridgeSupport" data-bridge-support="" label="Details (for support)" less="Hide details" />}
        {(inDetails || moreOpen("bridgeSupport")) && <div data-bridge-support-more="">
          <Sessions c={c} st={st} />
          {num(c.port) && !st.sessions.some((se) => se.port === num(c.port)) ? <p className="bk-warn">{"The chosen Tally (port " + num(c.port) + ") is not running. "}<button className="linkbtn" onClick={() => bridgePin(0)}>Go back to automatic</button></p> : null}
          {!st.tallyUp && <p className="note">Each Windows user’s TallyPrime needs its own port (9000, 9001, …).</p>}
          <Diagnosis />
          <BridgeLog />
        </div>}
      </> : <><p className="bk-warn">{st.error || "Not checked yet."}</p>{st.state === "down" && <DownHelp c={c} />}</>}</div>}
    </div>
    <TallyHistory />
  </>;
}

const when = (s) => s ? fmtDateTime(s) : "never";

// the books in FinCom's cloud: the computers that send, and which client each Tally company is
export function CloudBooks() {
  const p = TCloud.pane;
  if (!TCloud.on()) return <div className="pane"><p className="note">Sign in to the firm account to keep the books in FinCom’s cloud.</p></div>;
  // read again when opened after a minute, so a link made elsewhere (another computer, the auto-link) shows
  if (!p.busy && !p.err && (p.devices === null || Date.now() - (p.at || 0) > 60000)) { p.at = Date.now(); setTimeout(() => TCloud.refreshPane(), 0); }
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((a, c) => a.name.localeCompare(c.name));
  const dv = (p.devices || []).filter((d) => !d.revoked), cl = p.companies || [];
  return <>
    <div className="pane"><h2>Books in FinCom’s cloud <TallyPill /></h2><p className="note" style={{ margin: "0 0 12px" }}>The bridge on each connected computer sends the books of the Tally companies it keeps in step. Then Look up, Reports and the books open on any computer or phone, even with Tally closed, and a trial balance or ledger for any date comes back in a moment. Kept in India, for your firm only.</p>
      {p.err && <p className="note bad"><Msg text={p.err} /></p>}{p.busy && <p className="note">{p.busy}</p>}
      <p className="note">The computer with Tally and the bridge sends by itself once someone signs in to FinCom there. Nothing to press.</p>
      {TCloud.autoErr && <p className="note bad">{"Last try: " + TCloud.autoErr}</p>}<div className="row"><button className="btn small" onClick={() => TCloud.refreshPane()}>Refresh</button></div></div>
    <div className="pane"><h3 style={{ marginTop: 0 }}>Computers that send</h3><ListTable name="cloudDevices" className="data" rows={dv} loading={p.devices == null && !p.err ? "the computers" : false} rowKey={(d) => d.id} unit={["computer", "computers"]}
        empty="None yet. Open FinCom on the computer with Tally, signed in to the firm, and it connects by itself within a minute."
        cols={[
          { k: "at", role: "date", label: "Last heard from", v: (d) => d.last_seen || "", cell: (d) => when(d.last_seen) },
          { k: "pc", role: "party", label: "Computer", v: (d) => d.name || "", cell: (d) => <>{d.name}{(d.info || {}).computer && <div className="nr">{d.info.computer + (d.info.user ? " · " + d.info.user : "")}</div>}</> },
          { k: "ver", label: "Bridge", v: (d) => d.version || "", cell: (d) => d.version || "—" },
          { k: "ac", role: "act", cls: "n", cell: (d) => <button className="btn small" onClick={() => TCloud.revoke(d.id, d.name)}>Remove</button> },
        ]} /></div>
    <div className="pane"><h3 style={{ marginTop: 0 }}>Tally companies and clients</h3><p className="note" style={{ margin: "0 0 8px" }}>Which client each Tally company is. A client is linked in one place: the Tally page’s Connect Tally, step 4. <button className="linkbtn" data-open-connect="4" onClick={() => openConnectTally(4, "")}>Open Connect Tally</button></p>
      {cl.length ? <ListTable name="cloudCompanies" className="data" rows={cl} rowKey={(c) => c.company} unit={["company", "companies"]}
        cols={[
          { k: "at", role: "date", label: "Last seen", v: (c) => c.last_seen || "", cell: (c) => when(c.last_seen) },
          { k: "co", role: "party", label: "Company in Tally", v: (c) => c.company, cell: (c) => c.company },
          { k: "cl", role: "status", label: "Client in FinCom", v: (c) => (c.client_id ? "linked" : "not linked"), cell: (c) => {
          const cid = String(c.client_id || ""), linked = cid && cos.find((k) => String(k.id) === cid), m = !cid && gstinMatch(c);
                      return <>
            {!cid && <span className="note" data-cloud-unlinked={c.company}>not linked </span>}
            {cid ? <div className="nr">{linked ? <>✓ Linked to <b>{linked.name}</b>{gstinMatch(c) && String(gstinMatch(c).id) === cid ? " (same GSTIN)" : ""}
                {S.account && S.account.me && S.account.me.role === "owner" && <> · <button className="linkbtn" data-act="reparse" title="FinCom's cloud reads the day books it keeps again: the party's GSTIN, place of supply, HSN, rate and bill-wise details"
                  onClick={() => TCloud.reparse(cid)}>Read the kept day books again</button>
                  {(() => { const r = (p.rp || {})[cid], jb = r && r.job ? (TCloud.jobs[cid] || []).find((x) => x.id === r.job) : null;
                    // fast-sync: read again by the server's queue; the line follows the job
                    if (r && r.job) return <span className={"note" + (jb && jb.status === "failed" ? " bad" : "")} data-rp={cid}>{" · " + (jb ? TCloud.jobLine(jb) : "handed to FinCom’s server (" + r.months + " months)…")}</span>;
                    return r ? <span className={"note" + (r.err ? " bad" : "")} data-rp={cid}>{" · " + (r.err ? "Could not read again: " + r.err + (r.n ? " (" + r.n + " days done)" : "") : r.busy ? "reading again… " + r.n + " days so far" : "read again: " + Number(r.n || 0).toLocaleString("en-IN") + " day" + (Number(r.n) === 1 ? "" : "s") + " of " + Number(r.months || 0) + " month" + (Number(r.months) === 1 ? "" : "s") + ", " + fmtTime(r.at) + (r.bad ? ", " + r.bad + " could not be read" : "") + (r.host ? " (cloud " + r.host + ")" : ""))}</span> : null; })()}</>}
                <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn small" onClick={() => TCloud.sendLedgers(cid)} title="The Tally computer reads every ledger and group now and sends them (FinCom Bridge on that computer; Tally open there)">Send ledgers and groups now</button>
                  {(() => { const g = (p.gs || {})[cid]; return g ? (g.err ? <span className="note bad"><Msg text={g.err} /></span> : g.none ? <span className="note">No books in the cloud yet.</span>
                    : <span className="note">{"In the cloud: " + g.groups + " groups · " + g.grouped + " of " + g.ledgers + " ledgers with a group" + (g.pl ? " (and Profit & Loss A/c, which has no group in Tally)" : "")} <button className="linkbtn" onClick={() => TCloud.groupStatus(cid)}>check again</button></span>)
                    : <button className="linkbtn" onClick={() => TCloud.groupStatus(cid)}>What is in the cloud?</button>; })()}
                </div></> : "Linked to a client that is not on this computer."}</div>
              : <div className="nr">{m ? <>Same GSTIN as <b>{m.name}</b>. </> : null}<button className="btn small" data-open-connect="4" onClick={() => openConnectTally(4, m ? m.id : "", c.company)}>Open Connect Tally</button></div>}</>; } },
          { k: "gstin", label: "GSTIN", v: (c) => c.gstin || "", cell: (c) => c.gstin || "—" },
        ]} />
        : <p className="note">No Tally companies have been seen yet. They appear here once a connected computer has a company open in Tally.</p>}</div>
  </>;
}

// the Tally page in the sidebar (02-Oct-2026; the calm page of 15-Oct-2026): the three steps only until a bridge is
// installed and talking, the computers heard this week, Needs you (or All good), the clients' table, then the one fold,
// "Advanced (for support)". Sync activity and Everything sent open from that fold (and from the bell and the client
// pages, as before), with the way back. #/tally/bridge-1.15: the hidden fallback.
// connectStep: the mount point for the new connect flow, drawn in the guide's step 1 (ConnectGuide)
const TALLY_TABS = [["computers", "Tally"], ["activity", "Sync activity"], ["sent", "Everything sent"]];
const goTab = (id) => { S.tallyTab = id; if (id === "activity") Rec.act.at = 0; render(); window.scrollTo(0, 0); };
// sourcesSlot: the mount point for 2.4.1's two-data-locations card (SourceCards on next-241), drawn inside Needs you
export default function TallyHome({ connectStep = null, sourcesSlot = null }) {
  const m = useSetup();
  // the page is named in the top bar (one heading, spec I)
  if (S.tallyOld) return <OldBridge />;
  paneFresh();
  const rows = TCloud.on() ? TCloud.bridgesHeard() : [], latest = m && m.setup ? m.setup.version : "";
  const tab = TALLY_TABS.some(([id]) => id === S.tallyTab) ? S.tallyTab : "computers";
  if (tab !== "computers") return <>
    <nav className="sbar" aria-label="Tally">{TALLY_TABS.map(([id, label]) =>
      <button key={id} data-tally-tab={id} aria-selected={tab === id} onClick={() => goTab(id)}>{id === "computers" ? "← Tally" : label}</button>)}</nav>
    {tab === "activity" ? <SyncActivity /> : <PostLog />}</>;
  // signed out: Connect Tally needs the firm account (the link is kept in FinCom’s cloud); this browser's own bridge
  // connect is only under Advanced (for support)
  if (!TCloud.on()) return <><div className="pane tguide" data-connect-guide="signin"><h3 style={{ margin: "0 0 4px" }}>Connect Tally</h3>
    <p className="note" style={{ margin: 0 }}>Sign in to the firm account first: Tally is connected through FinCom’s cloud, for every computer.</p></div>
    <PageMore rows={rows} latest={latest} m={m} cards={[]} connectStep={connectStep} /></>;
  // the computers heard in the last 7 days; the older ones are under Advanced (every bridge heard from)
  const cards = cardsOf(rows), week = cards.filter(heardThisWeek), f = focusOf(S.tallyFocus), ctl = TCloud.pane.ctl || {};
  const gx = guideState(rows, latest), guided = gx.r && !gx.done.company ? gx.r.device.id : "";
  return <>
    <ConnectGuide rows={rows} m={m} latest={latest} connectStep={connectStep} />
    <FocusLine f={f} cards={week} />
    {week.length > 0 && <section className="pane tpcs" data-pc-lines="">
      <h3 style={{ margin: "0 0 6px" }}>Status</h3>
      {week.map((r) => <PcLine key={cardKey(r)} r={r} latest={latest} m={m} focus={!!f && !!f.dev && r.device.id === f.dev} guided={r.device.id === guided} />)}
      {ctl.err && <p className="bk-alert bad" data-control-err="" style={{ margin: "6px 0 0" }}><Msg text={ctl.err} /></p>}
      {ctl.ok && <p className="note" data-control-ok="" style={{ margin: "6px 0 0" }}>{ctl.ok}</p>}
    </section>}
    <NeedsYou sources={sourcesSlot} />
    <PageMore rows={rows} latest={latest} m={m} cards={week} old={cards.length - week.length} connectStep={connectStep} />
  </>;
}
