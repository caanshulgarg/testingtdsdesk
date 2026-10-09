// Tally: FinCom Bridge (02-Oct-2026, the owner's decision: the only bridge; FinCom 2.3.5: three steps until the first
// company is linked, then one card a computer with one status line, the rest under More: connect, the Tallys found,
// which client each company is, the check of this server's Tally, the reading test, the install help) and the books in FinCom's cloud. Was viewTallyHome (src/js/18),
// viewBridgeSettings, bridgeSetupSteps, bridgeDownHelp, viewBridgeDiagnosis and viewReadTest (src/js/24), and TCloud.view
// (src/js/49). The work is Bridge and TCloud; boxes and choices go through bridgeSet, bridgeLink, bridgePin, tcLink
// (src/js/24, 49), buttons through doAct (bridgeTest, bridgeConnect, bridgeOff, bridgeSetupFile, bridgeDiag, bridgeReadTest).
import Msg from "../parts/Msg.jsx";
import ListTable from "../parts/ListTable.jsx";
import TallyPill from "../parts/TallyPill.jsx";
import TallyLine from "../parts/TallyLine.jsx";
import { AlertLine } from "../parts/Bell.jsx";
import SyncActivity from "./TallySync.jsx";
import { TallyStates, TallyHistory } from "../parts/TallyStates.jsx";
import { PostLog } from "./Done.jsx";
import CommitBox from "../parts/CommitBox.jsx";
import { useState, useEffect } from "react";

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
function useSetup() {
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
// phase 2 (F36, N102): is Tally's change recorder working on this computer, per company open there (the bridge's
// heartbeat: info.bridges[id].recorder, FinCom Bridge 2.1.9 on). Nothing for a computer whose bridges report no recorder
function RecorderLine({ r }) {
  const rc = Rec.recOf(r.device);
  if (!rc) return null;
  const off = Rec.notRecording(r.device), open = Rec.openOf(r.device).filter((co) => rc[co]);
  if (!off.length && !open.length) return null;
  return <div className="row" data-recorder="" style={{ alignItems: "center", gap: 8, flexWrap: "wrap", marginLeft: 16 }}>
    {open.map((co) => { const x = rc[co]; return <span key={co} className="note" data-recorder-co={co}>{co + ": " + (x.seen ? "recording" + (x.lastAt ? " \u00b7 last line " + tallyHm(x.lastAt) : "") : "not recording")}</span>; })}
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
const DownloadBtn = ({ m, primary }) => { const s = setupOf(m);
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
  if (rd.state === "paused") return { kind: "paused", text: "Reading is paused on " + pc + ". Resume it from the FinCom icon near the clock there", act: "check" };
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
// the clients' lines that only that day's Day Book settles (Rec.needKind: daybook, dupid), one line a client
function dayBookNeeds() {
  if (typeof AlertHub !== "object" || !AlertHub.heldFor || typeof Rec !== "object" || !Rec.needKind) return [];
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted);
  let lines = []; try { lines = AlertHub.heldFor(cos.map((c) => c.id)) || []; } catch (e) { lines = []; }
  const by = new Map();
  lines.forEach((l) => { const k = Rec.needKind(l); if (k !== "daybook" && k !== "dupid") return; by.set(l.client_id, (by.get(l.client_id) || 0) + 1); });
  return cos.filter((c) => by.get(c.id)).map((c) => ({ co: c, n: by.get(c.id) }));
}
// 1. Needs you. sources: the slot for 2.4.1's card of a book open in two data locations (SourceCards on next-241; it
// arrives with FinCom Bridge 2.4.1): drawn first in this list when given
function NeedsYou({ cards, latest, m, sources = null }) {
  const owner = isOwner(), p = TCloud.pane, allStopped = TCloud.stoppedAll && TCloud.stoppedAll();
  const stopAll = (p.stops || []).find((x) => !x.device_id && !x.cleared_at);
  const items = [];
  if (allStopped) items.push(<li key="all" data-need="stopped-all" data-stopped-all="">
    <span>{"Reading stopped on all computers" + (stopAll && stopAll.stopped_by ? " by " + who(stopAll.stopped_by) : "") + ": " + ((stopAll && stopAll.reason) || "no reason given")}</span>
    {owner ? <button className="btn small primary" data-read-resume-all="" onClick={() => TCloud.readResume(null)}>Resume</button> : <span className="note">An owner of the firm can resume it.</span>}</li>);
  cards.forEach((r) => { const n = needOf(r, latest, owner, allStopped); if (n) items.push(<li key={cardKey(r)} data-need={n.kind} data-need-computer={r.device.id}><span>{n.text}</span><NeedAct r={r} n={n} m={m} top /></li>); });
  dayBookNeeds().forEach(({ co, n }) => items.push(<li key={"db:" + co.id} data-need="daybook" data-need-client={co.id}>
    <span>{n + (n === 1 ? " entry of " : " entries of ") + co.name + " need" + (n === 1 ? "s" : "") + " that day's Day Book"}</span>
    <button className="btn small primary" data-need-upload={co.id} onClick={() => Rec.openClientTab(co.id, "books:import")}>Upload</button></li>));
  (p.devices || []).filter((d) => !d.revoked && d.info && d.info.idRefused).forEach((d) => items.push(<li key={"refused-" + d.id} data-need="refused" data-id-refused={d.id}><span><b>{d.name}</b>{": " + d.info.idRefused.words}</span></li>));
  if (!items.length && !sources) return null;
  return <section className="pane tneeds" data-needs-you="">
    <h3 style={{ margin: "0 0 6px" }}>Needs you</h3>
    {/* SLOT (FinCom 2.4.1): the card of a book open in two data locations goes here (SourceCards, next-241) */}
    {sources && <div data-needs-slot="sources">{sources}</div>}
    <ul className="tneeds-list">{items}</ul>
  </section>;
}
// "GARG SHEKHAR (Alpha Traders ›)": the client a company read on a computer is linked to, a link to that client
function ClientOf({ company, dev }) {
  const l = (TCloud.pane.companies || []).find((c) => c.company === company && c.client_id && (!c.device_id || c.device_id === dev)), co = l && S.companies && S.companies[l.client_id];
  if (!co || co.deleted) return null;
  return <>{" ("}<button className="linkbtn" data-client-open={co.id} onClick={() => openCompany(co.id)}>{co.name + " \u203a"}</button>{")"}</>;
}
// the card's state in words
function cardState(r, n) {
  if (r.go && !r.old && !r.online) return ["bad", "Not connected"];
  if (n) return ["warn", "Needs you"];
  return ["ok", "Connected"];
}
// 2. one card a computer and Windows user
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
      {live && <span style={{ marginLeft: "auto" }}><MoreToggle k={k} label="Details" less="Hide details" aria-label={"Details of " + pcName(r)} /></span>}
    </div>
    <div className="tcard-facts">
      <div data-card-companies="">{cos.length ? <>{r.online ? "Reads " : "Read when last connected: "}{cos.map((c, i) => <span key={c}>{i > 0 && ", "}<b>{c}</b><ClientOf company={c} dev={r.device.id} /></span>)}</> : <span className="note">{live && r.online ? "No company open in Tally" : "No company being read"}</span>}</div>
      <div data-card-last="">{last ? "Last entry received " + whenWords(last) : <span className="note">No entry received yet</span>}</div>
    </div>
    <div data-status-line="" data-bridge-line={r.id || "old"} data-level={n ? (lv === "ok" ? "warn" : lv) : lv} className="tcard-line">
      {n ? <><span data-bridge-act="">{n.text}</span>{" "}<NeedAct r={r} n={n} m={m} /></> : quiet ? <span className="note">{quiet}</span> : null}
    </div>
    {open && <div data-card-more="" className="tcard-more">
      <div className="tcard-sub">Details</div>
      <div className="row" style={ROW}><span className="note" data-card-version="">{"FinCom Bridge " + (r.version || "") + (r.runMode ? " · " + (RUN[r.runMode] || r.runMode) : "") + (r.main ? " · main bridge: reads and posts" : " · reads only")}</span></div>
      {rd.state !== "reading" && <div className="row" style={ROW}><span className="note" data-read-text="">{rd.state === "paused" ? "Reading paused" : rd.text}</span></div>}
      <div className="row" style={ROW}><BridgeWhere r={r} /></div>
      <div className="row" style={ROW}><ReadWho r={r} /><Reqs r={r} /></div>
      {postOnlyOf(r).length > 0 && <div className="row" style={ROW}><span className="note" data-post-only="" title="FinCom Bridge posts only to these Tally companies (its PostOnly setting); it reads every company open">{"Posts only to: " + postOnlyOf(r).join(", ")}</span></div>}
      <RecorderLine r={r} />
      <SlowCompanies r={r} />
      <Baselines r={r} owner={owner} />
      <SelfChecks r={r} />
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
  useEffect(() => { if (!f || !f.dev) return; const t = setTimeout(() => { const e = document.querySelector('#app [data-computer="' + f.dev + '"]'); if (e && e.scrollIntoView) e.scrollIntoView({ block: "center" }); }, 80); return () => clearTimeout(t); }, [f && f.dev]);
  if (!f) return null;
  const r = f.dev && cards.find((x) => x.device.id === f.dev);
  return <p className="note" data-tally-focus={f.co.id} style={{ margin: "0 0 10px" }}>
    {f.co.name + ": " + (r ? "linked to " + (f.company || "its Tally company") + " on " + pcName(r) + " (marked below)." : f.company ? "no computer reads " + f.company + " yet." : "not linked to a Tally company yet.")}
    {" "}<button className="linkbtn" data-focus-clear="" onClick={() => { S.tallyFocus = ""; render(); }}>Show all computers</button></p>;
}
// "← Back to <client>" on every Tally view while a client is open (backToClient, src/js/52)
function BackToClient() {
  const co = S.coId && S.companies && S.companies[S.coId];
  if (!co || co.deleted || typeof backToClient !== "function") return null;
  return <p className="tback" style={{ margin: "0 0 8px" }}><button className="linkbtn" data-back-client={co.id} onClick={() => backToClient()}>{"← Back to " + co.name}</button></p>;
}
// the page's Details: the versions (hold, let go, roll back, withdraw), Stop reading on all computers, every bridge heard
// from, this browser's own connection (its Connect steps, the Tallys found with their ports and Windows sessions, Check
// my Tally, the bridge's log), the connection history, the clients' lines, and FinCom Bridge's install help
function PageMore({ rows, latest, m }) {
  const owner = isOwner(), open = moreOpen("page");
  const allStopped = TCloud.stoppedAll && TCloud.stoppedAll();
  return <div className="pane" data-page-more="" style={{ padding: "8px 16px" }}>
    <MoreToggle k="page" data-bridge-details="" label="Details: versions, every bridge, ports and Windows sessions, install help" less="Hide details" />
    {open && <div data-bridge-more="" style={{ marginTop: 10 }}>
      <Release rows={rows} latest={latest} owner={owner} />
      {owner && TCloud.on() && !allStopped && <div className="row" style={{ gap: 8, margin: "6px 0 10px" }}>
        <button className="btn small" data-read-stop-all="" onClick={() => TCloud.readStop(null)}>Stop reading on all computers</button></div>}
      <BridgesHeard />
      <ClientLines />
      {TCloud.on() && <BridgeSettings />}
      <BridgeDownload m={m} again={rows.length > 0} />
    </div>}
  </div>;
}
// the three steps until the first Tally company is linked to a client: Install bridge -> Connect -> Link company, each
// ticked when done (a computer key exists; a bridge's heartbeat was seen; a company linked).
// MOUNT POINT for the new connect flow (branch next-connect: app/src/screens/Connect.jsx, app/src/parts/ConnectAttempts.jsx):
// pass it as TallyHome's `connectStep` prop (or TallyGuide's), e.g. <TallyHome connectStep={<Connect compact />} />; it is
// drawn inside step 2 ([data-guide-connect-slot]). Until then step 2 opens today's connect section (the page's More ->
// "FinCom Bridge on this computer", [data-connect-section]).
function TallyGuide({ rows, m, connectStep }) {
  const p = TCloud.pane;
  if (!TCloud.on() || p.devices == null) return null;
  // review of f0f1531f: once a company is linked the guide folds to one link, "Connect another computer", that opens it again
  const linked = (p.companies || []).some((c) => c.client_id), again = linked && moreOpen("guide");
  if (linked && !again) return <p className="note" style={{ margin: "0 0 10px" }}><button className="linkbtn" data-guide-again="" onClick={() => moreFlip("guide")}>Connect another computer</button></p>;
  const devs = (p.devices || []).filter((d) => !d.revoked), heard = rows.filter((r) => r.go && !r.old && r.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const seen = p.companies || [];
  const done = { install: devs.length > 0, connect: heard.length > 0, link: false };
  const next = ["install", "connect", "link"].find((k) => !done[k]);
  const openConnect = () => { S.tallyMore = Object.assign({}, S.tallyMore || {}, { page: true }); render();
    setTimeout(() => { const e = document.querySelector("#app [data-connect-section]"); if (e && e.scrollIntoView) e.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50); };
  const Step = ({ k, n, title, children }) => <li data-guide-step={k} data-done={done[k] ? "" : undefined} className={done[k] ? "done" : next === k ? "now" : ""}>
    <span className="tguide-mark" aria-hidden="true">{done[k] ? "✔" : n}</span>
    <div><b>{title}</b>{done[k] && <span className="tag ok" style={{ marginLeft: 8 }}>Done</span>}<div className="note">{children}</div></div></li>;
  return <div className="pane tguide" data-tally-guide="">
    <h3 style={{ margin: "0 0 4px" }}>{again ? "Connect another computer" : "Connect Tally in three steps"}{again && <>{" "}<button className="linkbtn note" data-guide-hide="" onClick={() => moreFlip("guide")}>Hide</button></>}</h3>
    <ul className="tguide-steps">
      <Step k="install" n={1} title="Install FinCom Bridge">{done.install && !again ? "Installed: " + devs.map((d) => (d.info && d.info.computer) || d.name).join(", ") + "."
        : <>On the computer where TallyPrime runs. <DownloadBtn m={m} primary={next === "install"} /> If Windows says “Windows protected your PC”, press More info, then Run anyway (more help under More, below).</>}</Step>
      <Step k="connect" n={2} title="Connect it to FinCom">{done.connect && !again ? "FinCom Bridge on " + heard[0].computer + " is talking to FinCom (last heard " + agoWords(heard[0].at) + ")."
        : <span data-guide-connect-slot="">{connectStep || <>Right-click the FinCom icon near the clock → <b>Connect FinCom on this computer…</b> and type the 6-digit code here. <button className={"btn small" + (next === "connect" ? " primary" : "")} data-guide-connect="" onClick={openConnect}>Open the connect steps</button></>}</span>}</Step>
      <Step k="link" n={3} title="Link a Tally company to its client">{seen.length ? "Tally companies seen: " + seen.map((c) => c.company).join(", ") + ". Choose the client for each. "
        : "Open the company in TallyPrime; it shows up within a minute. "}
        <button className={"btn small" + (next === "link" ? " primary" : "")} data-guide-link="" onClick={() => goSettings("tcloud")}>Link companies to clients</button></Step>
    </ul>
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
    <Step n={2} done={connected && st.tallyUp} title="Open TallyPrime and your company">In TallyPrime: F1 Help → Settings → Connectivity → <b>TallyPrime acts as: Both</b>. Each user's Tally needs its own port (9000, 9001, …).</Step>
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
  const cos = sortedCompanies(), skipped = st.sessions.some((se) => se.skipped);
  return <>{skipped && <p className="note" data-session0="" style={{ margin: "0 0 6px" }}><b>Another user — not used:</b>{" " + SESSION0}</p>}<table className="data" data-statement=""><thead><tr><th>Tally</th><th>Owner</th><th>Companies open</th><th>FinCom client</th><th></th></tr></thead><tbody>
    {st.sessions.filter((se) => se.ok || se.skipped || num(c.port) === se.port || st.mode !== "fallback").map((se) => {
      const pinned = num(c.port) === se.port;
      return <tr key={se.port}><td>{"Port " + se.port}</td>
        <td>{se.skipped ? <span className="tag no">Another user — not used</span> : se.mine === true ? <span className="tag ok">Your session</span> : <span className="tag warn">Not checked</span>}</td>
        <td>{se.skipped ? <span className="note">hidden</span> : !se.ok ? <span className="note">{se.error ? "not answering" : "—"}</span> : se.companies.length ? se.companies.map((o, i) => <span key={i}>{i > 0 && <br />}<b>{o.name}</b></span>) : <span className="note">no company open</span>}</td>
        <td>{se.skipped || !se.ok ? null : se.companies.map((o, i) => { const cl = Bridge.clientFor(o.name);
          return <span key={i}>{i > 0 && <br />}{cl ? cl.name : <select aria-label={"Client for " + o.name} value="" onChange={(ev) => bridgeLink(o.name, ev.target.value)}><option value="">Link to a client…</option>{cos.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}</span>; })}</td>
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

export function BridgeSettings() {
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
        {(st.clash || []).length > 0 && <p className="bk-warn">{st.clash.join(", ") + " is open in more than one Tally. Choose yours with "}<b>Use this Tally</b>; until then nothing is read or posted for it.</p>}
        <Sessions c={c} st={st} />
        {num(c.port) && !st.sessions.some((se) => se.port === num(c.port)) ? <p className="bk-warn">{"The chosen Tally (port " + num(c.port) + ") is not running. "}<button className="linkbtn" onClick={() => bridgePin(0)}>Go back to automatic</button></p> : null}
        <Diagnosis />
        <BridgeLog />
        {st.tallyUp || (Bridge.diag && (Bridge.diag.findings || []).length) ? null : <p className="bk-warn">TallyPrime is not answering. In TallyPrime: F1 Help → Settings → Connectivity → set “TallyPrime acts as” to Both, port 9000.</p>}
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
    <div className="pane"><h3 style={{ marginTop: 0 }}>Tally companies and clients</h3><p className="note" style={{ margin: "0 0 8px" }}>A company named in Tally as a client’s “Tally name”, or with exactly one client’s GSTIN, is linked by itself. Link the others here. A company whose GSTIN is not the client’s cannot be linked, so no one’s books land in the wrong client.</p>
      {cl.length ? <ListTable name="cloudCompanies" className="data" rows={cl} rowKey={(c) => c.company} unit={["company", "companies"]}
        cols={[
          { k: "at", role: "date", label: "Last seen", v: (c) => c.last_seen || "", cell: (c) => when(c.last_seen) },
          { k: "co", role: "party", label: "Company in Tally", v: (c) => c.company, cell: (c) => c.company },
          { k: "cl", role: "status", label: "Client in FinCom", v: (c) => (c.client_id ? "linked" : "not linked"), cell: (c) => {
          const cid = String(c.client_id || ""), linked = cid && cos.find((k) => String(k.id) === cid), m = !cid && gstinMatch(c);
                      return <>
            <select aria-label={"Client for " + c.company} value={cid} onChange={(ev) => TCloud.link(c.company, ev.target.value)}><option value="">— not linked —</option>
              {cid && !linked && <option value={cid}>a client not on this computer</option>}
              {cos.map((k) => <option key={k.id} value={String(k.id)}>{k.name}</option>)}</select>
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
              : m ? <div className="nr">Same GSTIN as <b>{m.name}</b> <button className="btn small" onClick={() => TCloud.link(c.company, m.id)}>Link to {m.name}</button></div> : null}</>; } },
          { k: "gstin", label: "GSTIN", v: (c) => c.gstin || "", cell: (c) => c.gstin || "—" },
        ]} />
        : <p className="note">No Tally companies have been seen yet. They appear here once a connected computer has a company open in Tally.</p>}</div>
  </>;
}

// the Tally page in the sidebar (02-Oct-2026; FinCom 2.3.5, the simpler page): the three steps until the first company
// is linked, one card a computer, the clients' Tally lines, then everything else under the page's More (the install
// help with the download among it); then everything sent to Tally. #/tally/bridge-1.15: the hidden fallback.
// connectStep: the mount point for the new connect flow (see TallyGuide)
const TALLY_TABS = [["computers", "Connection"], ["activity", "Sync activity"], ["sent", "Everything sent"]];
// sourcesSlot: the mount point for 2.4.1's two-data-locations card (SourceCards on next-241), drawn inside Needs you
export default function TallyHome({ connectStep = null, sourcesSlot = null }) {
  const m = useSetup();
  // the page is named in the top bar (one heading, spec I)
  if (S.tallyOld) return <OldBridge />;
  paneFresh();
  const rows = TCloud.on() ? TCloud.bridgesHeard() : [], latest = m && m.setup ? m.setup.version : "";
  // phase 2 (H49-H51): Computers (as before), Sync activity (the recorder's lines), Everything sent (the post log)
  const tab = TALLY_TABS.some(([id]) => id === S.tallyTab) ? S.tallyTab : "computers";
  // the Tally redesign (09-Oct-2026): "← Back to <client>" on every view; Needs you first, then one card a computer
  const cards = cardsOf(rows), f = focusOf(S.tallyFocus);
  return <>
    <BackToClient />
    <nav className="sbar" aria-label="Tally">{TALLY_TABS.map(([id, label]) =>
      <button key={id} data-tally-tab={id} aria-selected={tab === id} onClick={() => { S.tallyTab = id; if (id === "activity") Rec.act.at = 0; render(); }}>{label}</button>)}</nav>
    {tab === "activity" ? <SyncActivity />
      : tab === "sent" ? <PostLog />
      : <><AlertLine />
        <NeedsYou cards={cards} latest={latest} m={m} sources={sourcesSlot} />
        <TallyGuide rows={rows} m={m} connectStep={connectStep} />
        <FocusLine f={f} cards={cards} />
        {cards.length > 0 && <BridgeLines cards={cards} latest={latest} m={m} focusDev={f && f.dev} />}
        {TCloud.on() ? <PageMore rows={rows} latest={latest} m={m} /> : <><BridgeDownload m={m} /><BridgeSettings /></>}</>}</>;
}
// FinCom Bridge 2.1.3 reads Tally only after an event: one line a client whose Tally company a computer keeps, from
// that computer's heartbeat ("Tally open on NWS144 · last read 15:34", closed, offline, not answering, paused), each with
// Update now; the open client first
function ClientLines() {
  if (typeof tallyLine !== "function") return null;
  const cos = Object.values(S.companies || {}).filter((c) => !c.deleted).sort((a, c) => (c.id === S.coId) - (a.id === S.coId) || a.name.localeCompare(c.name));
  const rows = cos.map((co) => [co, tallyLine(co)]).filter(([co, l]) => l);
  if (!rows.length) return null;
  return <div className="pane" data-client-lines="">
    <h3 style={{ marginTop: 0 }}>Clients’ Tally</h3>
    <p className="note" style={{ margin: "0 0 8px" }}>The bridge reads Tally only when needed: when a client is opened here, on Update now, for a posting, and in its nightly catch-up. Entries made in Tally show here after the next of these.</p>
    {rows.map(([co]) => <div key={co.id} data-client-line={co.id} style={{ margin: "2px 0" }}>
      <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}><button className="linkbtn" data-client-open={co.id} onClick={() => openCompany(co.id)}><b>{co.name}</b></button><span className="note">·</span><TallyLine co={co} /></div>
</div>)}
  </div>;
}
