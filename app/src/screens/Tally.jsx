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
import { lastEntry } from "../lib/tallyState.js";
import { freePort, portHowWords, portWarnWords } from "../lib/tallyPort.js";
import CompaniesInTally, { companyRows, LinkedClients } from "../parts/TallyCompanies.jsx";
import ConnectThisComputer, { LocalTally, CodeBox } from "../parts/TallyFirstLink.jsx";
import { OC, doConnect, doFind, doRefresh, useRefusedCheck, useHereProbe, useLocalRead, Line, Found } from "../parts/TallyOneClick.jsx";
import { coKey, openOn } from "../lib/tallyState.js";
import { beatFresh } from "../lib/tallyConnect.js";
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

// the TallyPrime 7.2 proof (26-Oct-2026): bridge 2.4.7's diagnosis skips Tallys on ports outside 9000-9999 and says "not
// accepting connections on port N" of a Tally the bridge itself connects to (4125). While the bridge here reaches its
// Tally, that finding is left out and the table says the port it connects on
const FALSE_NOT_ACCEPTING = /is running but is not accepting connections on port \d+ yet/i;
function bridgeReach() {
  const b = (typeof Bridge === "object" && Bridge.st) || {};
  const s = [].concat(b.sessions || []).find((x) => x && x.mine === true && x.ok);
  return s ? Number(s.port) || true : b.tallyUp || b.tallyState === "open" || b.tallyState === "busy" ? true : false;
}
function Diagnosis() {
  const d0 = Bridge.diag, reach = d0 && !d0.error ? bridgeReach() : false;
  const d = reach && d0 ? Object.assign({}, d0, { findings: (d0.findings || []).filter((f) => !(f && f.level !== "ok" && FALSE_NOT_ACCEPTING.test(String(f.text || "")))),
    tallies: (d0.tallies || []).map((t) => (t && t.mine && !(t.ports || []).length && typeof reach === "number" ? Object.assign({}, t, { ports: [reach] }) : t)) }) : d0;
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
// speed round (27-Oct-2026): the computers' beats every 30 s (TLight, laid over this page's list: TCloud.paneDevs); the
// page's own lines every 5 minutes while it is seen (TCloud.paneTick); a person's Refresh reads all of it at once
function paneFresh() { if (TCloud.on() && !TCloud.pane.err) TCloud.paneTick(); }
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
// ONE page (24-Oct-2026, next-tally-one-page; the owner: "please clear all the excess things which are not required.. make
// it completely like Suvit.. I need a clear page only"): the three steps until the first company is linked, then one line
// of the computers ("Connected computers: NWS144 ● online"); Companies in Tally (parts/TallyCompanies.jsx), the only place
// a company is added, linked, moved, unlinked or synced; Needs you only when something stands; Help & support, closed.
// The clients' table, the computers' status block, "Seen, not linked" and the focus line are gone (a client's "Open in
// Tally page" marks its row instead).
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
  // next-tally-suvit: a computer is Connected as its companies are (lib/tallyState.js): heard from, with a company open in
  // Tally; linked or not is the company's row's business, not the computer's
  const word = !live ? ["bad", "Older bridge"] : !r.online ? ["bad", "Offline"] : stopped ? ["bad", "Stopped"] : paused ? ["warn", "Paused"]
    : tallyOk && open.length ? ["ok", "Connected"] : tallyOk ? ["warn", "No company open"] : ["warn", "Tally not open"];
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
// Connect Tally in Suvit's three steps (23-Oct-2026, next-tally-suvit; the owner: "make sure it should connect like
// Suvit.. every step.. don't need extra steps in connection"). Suvit: open the company in Tally; the connector lists it;
// Subscribe; the first sync runs by itself. FinCom, each step ticked by itself from what the computers' beats and the
// links already say (nothing new is asked of the bridge or Tally):
//   1. Install FinCom Bridge on the Tally computer   the one Download             done: a bridge heard this week
//   2. Set Tally's port (26-Oct-2026)                 one free port, the menu      done: his Tally answers on a port no other user's has
//   3. Open your company in TallyPrime               what stops it, if anything   done: a company open on a computer heard now
//   4. Add as client (or Link) in the list           Companies in Tally           done: a company linked to a client
// The older six steps are gone: linking a client (step 4) is the row's Add as client / Link; the ledgers and this year's
// entries (steps 5, 6) are the row's first sync with its progress and confirmation; the Day Book is the row's ⋯ "Upload
// older entries (Day Book)" while days are missing. All three done: one green line under the list.
// openConnectTally(step, cid) (src/js/52) still lands here: steps 1 to 3 the guide's step, 4 and over the list (with the
// client the pointer named: its rows say "Link to <client>").
// ---------------------------------------------------------------------------------------------------------------------
// 26-Oct-2026 (next-tally-port; the owner: "we still need to set the port.. FinCom needs a step: this port is free, and do
// this step in Tally. Everything should be clearly spoken"): step 2, Set Tally's port, between Install and Open. GUIDE_KEYS
// are the steps in order; openConnectTally(1..3) still names Install, Open and the list (STEP_OF)
const GUIDE_KEYS = ["install", "port", "open", "add"], STEP_OF = ["install", "open", "add"], GUIDE_REFRESH_MS = 30000;
const nOf = (n, one, many) => Number(n).toLocaleString("en-IN") + " " + (n === 1 ? one : many);
const lc = (x) => String(x || "").trim().replace(/\s+/g, " ").toLowerCase();
// Tally's port for this Windows user (me: this browser's own bridge, else the member's bridge, else the guide's computer),
// from what the bridges already say: each bridge's tallyPort (info.bridges), the computer's beat ports (ok: answering;
// skipped: another Windows user's Tally) and, when this browser's bridge answers, its /status sessions ("Your session",
// "Another user — not used") and its /diagnose (each Tally's owner, ports and tally.ini port; every program on 9000-9999).
//   {state: wait | offline | done | clash | set, port (his Tally's), who (the other user), set (his tally.ini port, not
//    answering), free (the one port proposed), used (every port seen on that computer), pc, user}
// free: lib/tallyPort.js freePort (9000-9099, not seen in use, not in PORT_AVOID, from a start by the Windows user's name).
// A Tally on any port the bridge reaches is done (the TallyPrime 7.2 proof: 2.4.7 connects on 4125)
function portState(rows, me) {
  const mine = me ? lc(me.user) : "";
  const L = typeof Bridge === "object" && Bridge.on && Bridge.on() && Bridge.st && Bridge.st.state === "ok" && (!me || !Bridge.st.user || lc(Bridge.st.user) === mine) ? Bridge.st : null;
  const pc = me ? me.computer : (L && L.computer) || "this computer", user = me ? me.user || "" : (L && L.user) || "";
  if (!me && !L) return { state: "wait", pc, user };
  if (me && !me.online && !L) return { state: "offline", pc, user };
  const seen = new Set(), other = new Map(), add = (p, who) => { p = Number(p) || 0; if (p <= 0) return; seen.add(p); if (who != null && !other.has(p)) other.set(p, who); };
  let my = 0, set = 0, held = null;
  // this browser's own bridge first: it says now which Tally is whose
  if (L) {
    (L.sessions || []).forEach((se) => { if (se.skipped) add(se.port, ""); else if (se.mine === true && se.ok) { my = my || Number(se.port) || 0; seen.add(Number(se.port)); } else add(se.port); });
    const d = typeof Bridge === "object" && Bridge.diag && !Bridge.diag.error ? Bridge.diag : null;
    if (d) {
      (d.tallies || []).forEach((t) => { if (t.mine) { if (t.ports.length) my = my || Number(t.ports[0]); else if (t.ini && t.ini.found) set = Number(t.ini.port) || 9000; }
        else t.ports.forEach((p) => add(p, t.user || "")); });
      (d.listeners || []).forEach((l) => { add(l.port); if (Number(l.port) === set && !/tally/i.test(String(l.program || ""))) held = l; });
    }
  }
  if (me) {
    const dev = me.device || {}, info = dev.info || {}, beat = info.beat || {}, br = Object.values(info.bridges || {});
    const answering = me.tally === "open" || me.tally === "busy";
    const beatUser = beat.windowsUser || (br.length === 1 ? br[0].user || "" : ""), beatMine = beatUser ? lc(beatUser) === mine : !!me.main;
    if (!my && answering && me.tallyPort) my = Number(me.tallyPort) || 0;
    [].concat(beat.ports || []).forEach((x) => { if (!x || !x.port) return;
      if (beatMine) { if (x.skipped) add(x.port, ""); else if (x.ok) { my = my || (answering ? Number(x.port) : 0); seen.add(Number(x.port)); } else add(x.port); }
      else if (x.ok && !x.skipped) add(x.port, beatUser); else if (Number(x.port) !== my) add(x.port, x.skipped ? "" : null); });
    // every other Windows user's bridge heard this week on that computer: its Tally's port
    rows.filter((x) => x !== me && x.device && x.device.id === dev.id && x.go && !x.old && heardThisWeek(x) && lc(x.user) !== mine).forEach((x) => add(x.tallyPort, x.user || ""));
  }
  if (my) seen.add(my);
  const used = [...seen].filter((p) => p > 0).sort((a, b) => a - b);
  const free = freePort(seen, mine);
  const base = { pc, user, free, used, port: my, set };
  if (my && other.has(my)) return Object.assign(base, { state: "clash", who: other.get(my) });
  if (!my && set && (other.has(set) || held)) return Object.assign(base, { state: "clash", port: set, who: other.has(set) ? other.get(set) : null, program: held ? String(held.program || "") : "" });
  if (my) return Object.assign(base, { state: "done" });
  // an older bridge that does not say the port: his Tally answers it, so it has one of its own
  if (me && (me.tally === "open" || me.tally === "busy")) return Object.assign(base, { state: "done" });
  return Object.assign(base, { state: "set" });
}
function guideState(rows, latest) {
  const p = TCloud.pane, live = cardsOf(rows).filter(heardThisWeek).filter((r) => r.go && !r.old);
  const st = live.map((r) => [r, pcState(r, latest)]);
  const on = st.filter(([r]) => r.online), tally = on.filter(([, s]) => s.tallyOk), open = tally.filter(([, s]) => s.open.length);
  // step 2 is done when a company is open AND FinCom reads it (reading paused or stopped from FinCom: not yet, and it says how)
  const reading = open.filter(([, s]) => !s.paused && !s.stopped);
  const openNow = [];
  tally.forEach(([rr, ss]) => ss.open.forEach((name) => { if (!openNow.some((o) => lc(o.company) === lc(name))) openNow.push({ company: name, computer: pcName(rr) }); }));
  const pcs = Array.from(new Set(openNow.map((o) => o.computer)));
  const linkedN = new Set([].concat(p.companies || [], (typeof TLight === "object" && TLight.st.cos) || []).filter((c) => c && c.client_id && !(S.companies && S.companies[c.client_id] && S.companies[c.client_id].deleted)).map((c) => lc(c.company))).size;
  const [r, s] = open[0] || tally[0] || on[0] || st[0] || [null, null];
  // step 2 is this Windows user's: this browser's own bridge, else the member's bridge, else the guide's computer
  const loc = TCloud.localRow ? TCloud.localRow() : null, mb = TCloud.myBridge ? TCloud.myBridge() : "";
  const me = (loc && live.find((x) => x.id === loc.id)) || (mb && live.find((x) => x.id === mb)) || r;
  const port = portState(rows, me);
  const done = { install: live.length > 0, port: port.state === "done", open: reading.length > 0, add: linkedN > 0 };
  return { done, r, s, live, on, tally, openNow, pcs, linkedN, port, fine: (st.find(([, x]) => x.fine) || open[0] || null) };
}
// "3 companies open in Tally on NWS144" / "12 companies open in Tally on 2 computers": a count, never the names
function openWords(x) {
  const n = x.openNow.length;
  if (!n) return "No company is open in Tally right now.";
  return nOf(n, "company", "companies") + " open in Tally on " + (x.pcs.length === 1 ? x.pcs[0].split(" · ")[0] : x.pcs.length + " computers") + ".";
}
const TICK = <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
function Step({ k, n, title, done, now, children }) {
  return <li data-connect-step={k} data-done={done ? "" : undefined} className={"tc3-step " + (done ? "done" : now ? "now" : "")}>
    <span className="tc3-mark" aria-hidden="true">{done ? TICK : n}</span>
    <div className="tc3-body"><b>{title}</b><div className="tc3-say">{children}</div></div></li>;
}
// step 2's words: the one free port, large, with Copy; TallyPrime's own menu in one line (TallyPrime 3.0 to 7.1:
// F1 Help → Settings → Connectivity → Client/Server configuration; tally.ini's "Client Server = Both", "Enable ODBC Server
// = Yes", "ServerPort", as .github/tally-spike writes them); Check (the wake and a fresh read; this browser's own bridge
// asked again), and the guide's 20-second read ticks it by itself when the bridge sees his Tally on a port of its own
function PortStep({ ps, installed }) {
  const [ck, setCk] = useState({ busy: false, at: 0 }), [all, setAll] = useState(false);
  if (!installed || ps.state === "wait") return <span className="note" data-port-state="wait">Finish step 1 first.</span>;
  if (ps.state === "offline") return <span className="note" data-port-state="offline">{"Finish step 1 first: FinCom Bridge on " + ps.pc + " is offline."}</span>;
  if (ps.state === "done") return <span className="note" data-port-state="done" data-port={ps.port || undefined}>{ps.port ? "Your Tally uses port " + ps.port + " ✓" : "Your Tally answers FinCom Bridge ✓"}</span>;
  const free = ps.free;
  const copy = () => (navigator.clipboard ? navigator.clipboard.writeText(String(free)) : Promise.reject()).then(() => toast("Port " + free + " copied."), () => toast("Could not copy; type " + free + "."));
  const check = () => { setCk({ busy: true, at: 0 });
    const local = typeof Bridge === "object" && Bridge.on && Bridge.on() ? Promise.resolve(Bridge.refresh(true)).then(() => Bridge.diagnose()) : null;
    Promise.all([checkAgain(), local]).then(() => setCk({ busy: false, at: Date.now() }), () => setCk({ busy: false, at: Date.now() })).then(() => render()); };
  // 26-Oct-2026, the owner on the first draft: "too lengthy, make it small and clear": the port, the menu in one line, Check
  return <div data-port-state={ps.state} data-port-free={free}>
    <div className="tc3-port"><span>Use port</span><b data-port-free-big="">{free}</b><span className="note">(free for you)</span><button className="btn small" data-port-copy="" onClick={copy}>Copy</button></div>
    {ps.state === "clash" && <p className="tc3-p bk-warn" data-port-warn={ps.state}>{portWarnWords(free) + "."}</p>}
    <p className="tc3-p" data-port-how="">{portHowWords(free)}</p>
    {ps.state === "clash" && <p className="tc3-p bk-warn" data-port-clash={ps.port}>{"Your Tally is on " + ps.port + ", same as " + (ps.program ? "another program (" + ps.program + ")" : "another user") + ". Change it to " + free + " as above."}
      {!ps.program && " If their port changes too, you share one TallyPrime folder: ask whoever set up " + ps.pc + " to give each user their own."}</p>}
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}><button className="btn small primary" data-port-check="" disabled={ck.busy} onClick={check}>{ck.busy ? "Checking…" : "Check"}</button>
      {ps.used.length > 0 && <button className="linkbtn" data-port-used-toggle="" aria-expanded={all} onClick={() => setAll(!all)}>{"Ports in use (" + ps.used.length + ")"}</button>}
      {ck.at > 0 && <span className="note" data-port-not-yet="">{"Not yet: restart TallyPrime, then Check."}</span>}</div>
    {all && <p className="tc3-p note" data-port-used="">{"In use on " + ps.pc + ": " + ps.used.join(", ") + "."}</p>}
  </div>;
}
// the client a pointer named (openConnectTally(4, cid) from a client, Settings, the Clients list), while it is not linked
function guideFor(g) {
  const co = g && g.cid && S.companies ? S.companies[g.cid] : null;
  return co && !co.deleted && typeof tallyLinkOf === "function" && tallyLinkOf(co).state === "unlinked" ? co : null;
}
function useGuideRefresh() {
  // while the page is open, the computers and companies are read again every 20 seconds, so a step ticks and a company
  // opened in Tally shows in the list without a click (24-Oct-2026: always, not only while a step is not done: "if there
  // is a company open in Tally, it should show always")
  // speed round (27-Oct-2026): the computers' beats (what a step and the open companies come from) every 30 s, and nothing
  // while the tab is hidden; the rest of the page every 5 minutes, and once each time the page is opened (paneOpen)
  useEffect(() => { TCloud.paneOpen(); const t = setInterval(() => {
    if (!document.querySelector("#app [data-tco-list]") || !TCloud.on() || TCloud.pane.busy) return;
    const typing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (typing) return;
    TCloud.paneTick();
  }, GUIDE_REFRESH_MS); return () => clearInterval(t); }, []);
}
function GuideRefresh() { useGuideRefresh(); return null; }
function ConnectGuide({ x, m, connectStep }) {
  const p = TCloud.pane, g = S.tallyGuide || {}, d = x.done, all = GUIDE_KEYS.every((k) => d[k]);
  useEffect(() => { if (!g.at) return; const t = setTimeout(() => { const k = STEP_OF[(g.step || 0) - 1];
    const e = (k && !d[k] && document.querySelector('#app [data-connect-step="' + k + '"]')) || ((g.step || 0) >= 3 ? document.querySelector("#app [data-tco-list=firm]") : null) || document.querySelector("#app [data-connect-guide]");
    if (e && e.scrollIntoView) e.scrollIntoView({ block: "center" }); }, 80); return () => clearTimeout(t); }, [g.at]);
  if (p.devices == null && !p.err) return null;
  // next-tally-smart (the owner: "no step wizard once connected"): the steps only while no computer of the firm is heard
  // (a computer never connected); Connect another computer (step 1 asked again) shows them once more
  if (d.install && !((g.step || 0) > 0 && (g.step || 0) < 3 && g.at)) return null;
  const now = GUIDE_KEYS.find((k) => !d[k]), owner = isOwner(), r = x.r, s = x.s, pc = r ? r.computer : "the Tally computer", user = (r && r.user) || "the Tally user";
  const allStopped = TCloud.stoppedAll && TCloud.stoppedAll(), stop = s && s.stopped ? ((TCloud.stopFor && TCloud.stopFor(r.device.id)) || {}) : null;
  const doneN = GUIDE_KEYS.filter((k) => d[k]).length;
  return <section className="pane tguide tconnect tc3" data-connect-guide={now || "open"}>
    <div className="tc3-top"><h3>Connect Tally</h3><span className="note tg-count" data-guide-count={doneN}>{doneN + " of " + GUIDE_KEYS.length + " done"}</span>
      {d.install && <button className="linkbtn" data-guide-hide="" onClick={() => { S.tallyGuide = {}; render(); }}>Hide the steps</button>}</div>
    <ol className="tc3-steps">
      <Step k="install" n={1} title="Install FinCom Bridge on the Tally computer" done={d.install} now={now === "install"}>
        {d.install ? <span className="note">{"Installed on " + (x.live.length === 1 ? pcWords(x.live[0]) : x.live.length + " computers") + ". "}
            {g.step === 1 && g.at ? <><span>On another computer: </span><DownloadBtn m={m} primary /></> : null}</span>
          : <><span className="note">Download it, open it, then type the code it shows: below, step by step. FinCom finds it on this computer by itself.</span>
            {connectStep && <div data-guide-connect-slot="">{connectStep}</div>}</>}
      </Step>
      <Step k="port" n={2} title="Set Tally’s port" done={d.port} now={now === "port"}>
        <PortStep ps={x.port} installed={d.install} />
      </Step>
      <Step k="open" n={3} title="Open your company in TallyPrime" done={d.open} now={now === "open"}>
        {d.open ? <span className="note" data-guide-open-count={x.openNow.length}>{openWords(x)}</span>
          : !d.install ? <span className="note">After step 1.</span>
          : r && !r.online && !(Bridge.on() && Bridge.up()) ? <span className="note">{"FinCom Bridge on " + pc + " is offline. Turn the computer on and sign in to Windows as " + user + ": it starts by itself."}</span>
          : <><LocalTally />{s && s.stopped && <p className="tc3-p" data-guide-paused="stopped"><b>{"Reading stopped" + (stop.stopped_by ? " by " + who(stop.stopped_by) : "") + " on " + pc + ": " + (s.rd.reason || stop.reason || "no reason given") + "."}</b>{" "}
              {owner && !allStopped ? <button className="btn small primary" data-read-resume={r.device.id} onClick={() => TCloud.readResume(r)}>Resume reading</button> : !owner ? <span className="note">An owner of the firm can resume it.</span> : null}</p>}
            {s && s.paused && <p className="tc3-p" data-guide-paused="paused"><b>{"Reading is paused on " + pc + "."}</b>{" To resume: " + RESUME_TRAY + ". " + PAUSE_SAYS}</p>}
            {s && !s.tallyOk ? <p className="tc3-p note">{"Open TallyPrime on " + pc + " and open your company."}</p>
              : !(s && (s.paused || s.stopped)) ? <p className="tc3-p note">{"Open your company in TallyPrime on " + pc + ": it shows in the list below within a minute."}</p>
              : x.openNow.length ? <p className="tc3-p note" data-guide-open-count={x.openNow.length}>{openWords(x)}</p> : null}</>}
      </Step>
      <Step k="add" n={4} title="Link each company to its client (“Link to client…” in the list below)" done={d.add} now={now === "add"}>
        {d.add ? <span className="note" data-guide-added={x.linkedN}>{nOf(x.linkedN, "company is", "companies are") + " clients in FinCom. Their first sync runs by itself."}</span>
          : <span className="note">Choose the client the company belongs to: FinCom links it and brings its ledgers and entries by itself.</span>}
      </Step>
    </ol>
    {/* next-tally-firstlink: until a bridge of the firm is heard (or Connect another computer, this browser not connected
        yet): Download, Open it, Type its code, watched live on this computer (parts/TallyFirstLink.jsx) */}
    {(!d.install || (g.step === 1 && g.at && !Bridge.on())) && <ConnectThisComputer download={<DownloadBtn m={m} primary />} linked={d.install && Bridge.on()} />}
    {!all && d.install && <button className="btn small" data-check-again="" style={{ marginTop: 8 }} onClick={checkAgain}>Check again</button>}
  </section>;
}
// the computers heard this week, one short span each ("NWS144 ● online · LAPTOP ○ offline since 14:02"), their Update or
// Resume where one is needed: the status card's "All computers" view (next-tally-smart; was the line under the guide)
function PcLines({ rows, latest, m }) {
  const owner = isOwner(), allStopped = TCloud.stoppedAll && TCloud.stoppedAll(), week = cardsOf(rows).filter(heardThisWeek);
  return <span data-pc-lines="">
    {week.length ? week.map((r, i) => { const s = pcState(r, latest), on = s.live && r.online, w = !s.live ? "older bridge" : !r.online ? "offline" + (r.at ? " since " + tallyHm(r.at) : "") : s.stopped ? "reading stopped" : s.paused ? "reading paused" : !s.tallyOk ? "online, Tally not open" : "online";
      return <span key={cardKey(r)} className="tpc-one" data-pc-line={r.device.id} data-pc-state={w}>{i > 0 && " · "}{pcName(r).split(" · ")[0] + " "}
        <span className={on && !s.stopped && !s.paused && s.tallyOk ? "tpc-ok" : "bad"} data-connected-line="">{(on && !s.stopped && !s.paused ? (s.tallyOk ? "● " : "◐ ") : "○ ") + w}</span>
        {s.update && !s.stopped && <>{" "}<UpdateBtn m={m} /></>}
        {s.stopped && owner && !allStopped && <>{" "}<button className="btn small primary" data-pc-resume={r.device.id} onClick={() => TCloud.readResume(r)}>Resume reading</button></>}</span>; })
      : <span className="note">none heard this week</span>}
  </span>;
}
// ---------------------------------------------------------------------------------------------------------------------
// ONE status card for this computer (next-tally-smart, 28-Oct-2026; the owner: "show only currently opened Tally; make the
// complete page smart; simple click to connect and get the company; no false alarms at all"):
//   "NWS144 · FinCom Bridge 2.4.7 · Connected" / "Tally open: 2 companies" / a problem in ONE plain line with ONE action.
//   Connect this computer only while it is needed (never connected here, a key FinCom refuses, not linked to the firm);
//   Find Tally only while Tally is not found; a port box only when asked; Refresh always (quiet).
// This computer: this browser's own FinCom Bridge (Bridge.st) with the cloud's row of it (TCloud.localRow); a browser
// elsewhere (a phone): the firm's one computer. More than one computer: a small switch, This computer / All computers
// (S.tallyScope), and nothing about the others until it is turned. Never a step wizard once a computer is connected.
// ---------------------------------------------------------------------------------------------------------------------
const shortUser = (u) => String(u || "").split("\\").pop();
// what this browser knows of this computer: {local (Bridge.st when this browser's bridge answers), me (its cloud row, else
// the firm's one computer), week (the computers heard this week), many}
function thisComputer(rows) {
  // localOn: this browser holds a key for a bridge on this computer (its state may not be read yet): this computer is
  // that bridge's, never the firm's one computer elsewhere
  const localOn = typeof Bridge === "object" && Bridge.on(), local = localOn && Bridge.st && Bridge.st.state === "ok" ? Bridge.st : null;
  const week = cardsOf(rows).filter(heardThisWeek).filter((r) => r.go && !r.old);
  const loc = TCloud.localRow ? TCloud.localRow() : null;
  // one computer may carry a bridge per Windows user (a shared server): the computers are the distinct devices
  const pcs = new Set(week.map((r) => r.device.id)), one = pcs.size === 1 ? (week.find((r) => r.online && r.main) || week.find((r) => r.online) || week[0]) : null;
  const me = (loc && week.find((r) => r.id === loc.id)) || (!localOn ? one : null);
  return { local, localOn, me, week, many: pcs.size > 1 };
}
// the scope of the page: "this" (this computer's Tally) or "all" (every computer): the switch only when the firm has more
// than one computer and this browser is on one of them
function scopeOf(tc) {
  const can = tc.many && !!(tc.local || tc.me);
  if (!can) return { scope: tc.many ? "all" : "this", can };
  // this browser's bridge not among the firm's computers yet: every computer, until it is turned
  return { scope: S.tallyScope ? (S.tallyScope === "all" ? "all" : "this") : tc.me ? "this" : "all", can };
}
function ThisComputer({ rows, latest, m, codeBelow, allStopped }) {
  useRefusedCheck();
  const tc = thisComputer(rows), { local, me, week } = tc, { scope, can } = scopeOf(tc);
  useHereProbe(!tc.local && !tc.localOn && week.length > 0);
  useLocalRead(tc.localOn && !tc.local);
  const c = OC.c, f = OC.f, b = OC.busy, owner = isOwner(), localOn = typeof Bridge === "object" && Bridge.on();
  // the code typed (here or below) connected this browser to the bridge: the firm's key at once
  useEffect(() => { if (c && c.st === "code" && localOn && !b) doConnect(false); }, [c && c.st, localOn]);
  const firm = (S.firm && S.firm.firmName) || "your firm", connectedNow = !!(c && c.st === "ok");
  const pc = local ? { computer: local.computer || (me && me.computer) || "This computer", user: shortUser(local.user) } : me;
  const name = pc ? pcName(pc) : "This computer", ver = (local && local.version) || (me && me.version) || "";
  const s = me ? pcState(me, latest) : null;
  const openHere = local ? [].concat(local.open || []).map((o) => (o && o.name) || "").filter(Boolean) : (s ? s.open : []);
  const tallyUp = local ? !!local.tallyUp : !!(s && s.tallyOk);
  // the one word, the one problem line and its one action (in this order: nothing known here, a refused key, not linked
  // to the firm, offline, stopped, paused, Tally not open, no company open, a slow company or a version by hand: needOf)
  let word = "Connected", lv = "ok", need = "", act = null, kind = "";
  const connectBtn = (label) => <button className="btn small primary" data-oc-connect="" disabled={!!b} onClick={() => doConnect(false)}>{b === "c" ? "Connecting…" : label || "Connect this computer"}</button>;
  const findBtn = <button className="btn small primary" data-oc-find="" disabled={!!b} onClick={doFind}>{b === "f" ? "Looking for Tally…" : "Find Tally"}</button>;
  const n0 = me ? needOf(me, latest, owner, allStopped) : null;
  const reading = tc.localOn && !local && (!Bridge.st || Bridge.st.state !== "down") && Date.now() - (OC.localAt || 0) < 30000 && !(Bridge.st && Bridge.st.error);
  if (!local && !me && reading) { word = "Checking…"; lv = "warn"; kind = "checking"; need = ""; }
  else if (!local && !me) { word = "Not connected"; lv = "bad"; kind = "none";
    need = tc.localOn ? "This browser is not connected to FinCom Bridge on this computer: " + ((Bridge.st && Bridge.st.error) || "it did not answer") + "." : week.length ? "FinCom is not open on a Tally computer here." : "FinCom Bridge is not connected on this computer yet: the steps below take a minute.";
    act = tc.localOn || !week.length ? connectBtn() : null; }
  else if (local && OC.refused && !connectedNow) { word = "Not accepted"; lv = "bad"; kind = "refused";
    need = "FinCom Bridge here has a key FinCom does not accept any more (it was connected to a firm that is gone, or its key was removed), so Tally is not reaching FinCom. Connect this computer gets a new key for " + firm + " at once."; act = connectBtn(); }
  else if (local && !me && !connectedNow && !beatFresh(local.beat)) { word = "Not linked to " + firm; lv = "warn"; kind = "unlinked"; need = "FinCom Bridge on this computer is not sending Tally to " + firm + " yet."; act = connectBtn(); }
  else if (n0 && (n0.kind === "offline" || n0.kind === "install") && !local) { word = n0.kind === "offline" ? "Offline" : "Older bridge"; lv = "bad"; kind = n0.kind; need = n0.text; act = <NeedAct r={me} n={n0} m={m} />; }
  else if (s && s.stopped) { word = "Stopped"; lv = "bad"; kind = "stopped"; const st = (TCloud.stopFor && TCloud.stopFor(me.device.id)) || {};
    need = "Reading stopped" + (st.stopped_by ? " by " + who(st.stopped_by) : "") + ": " + (s.rd.reason || st.reason || "no reason given");
    act = owner && !allStopped ? <button className="btn small primary" data-read-resume={me.device.id} onClick={() => TCloud.readResume(me)}>Resume reading</button> : !owner ? <span className="note">An owner of the firm can resume it.</span> : null; }
  else if (s && s.paused) { word = "Paused"; lv = "warn"; kind = "paused"; need = "Reading is paused here. To resume: " + RESUME_TRAY + "."; }
  else if (!tallyUp) { word = "Tally not open"; lv = "warn"; kind = "tally"; need = "Tally is not open on " + name.split(" · ")[0] + ". Open TallyPrime and your company" + (local ? ", then Find Tally." : "."); act = local ? findBtn : me ? <button className="btn small" data-check-again="" onClick={checkAgain}>Check again</button> : null; }
  else if (!openHere.length) { word = "No company open"; lv = "warn"; kind = "noco"; need = "Tally is open, but no company is. Open your company in TallyPrime: it shows here within a minute."; }
  else if (n0 && n0.kind !== "tally" && n0.kind !== "main") { word = n0.kind === "version" ? "Update ready" : "Needs you"; lv = "warn"; kind = n0.kind; need = n0.text; act = <NeedAct r={me} n={n0} m={m} />; }
  else if (s && s.update) { word = "Connected"; lv = "ok"; kind = "update"; need = ""; }
  // his Tally's port (the owner's step of 26-Oct-2026): not answering on one yet (set), or the same port as another Windows
  // user's Tally on this computer (clash: FinCom may be reading the wrong Tally), said here once a computer is connected
  const ps = (local || me) && ["", "tally", "noco", "update"].includes(kind) ? portState(rows, me) : { state: "" };
  if (kind === "tally" && ps.state === "set" && !local) act = null;   // the port step's own Check, below
  if (ps.state === "clash") { word = "Port clash"; lv = "warn"; kind = "port"; need = "Your Tally is on port " + ps.port + ", the same as another user’s on this computer: FinCom may be reading the wrong Tally. Give yours a port of its own:"; act = null; }
  const tallyLine = kind === "none" || kind === "refused" ? "" : tallyUp ? "Tally open: " + (openHere.length ? nOf(openHere.length, "company", "companies") : "no company open") : "Tally not open";
  const refresh = () => doRefresh(checkAgain);
  const calm = !kind && scope !== "all" && !needsItems().length;
  const g0 = S.tallyGuide || {}, gOpen = !!(g0.at && (g0.step || 0) > 0 && (g0.step || 0) < 3), setupOk = !!(local || me || week.length) && !["none", "refused", "unlinked", "checking"].includes(kind);
  return <section className="pane tsc" data-status-card={kind || "ok"} data-scope={scope} data-all-good={calm ? "" : undefined} aria-label="This computer">
    <div className="tsc-top">
      <div className="tsc-name" data-tsc-name="" data-pc-lines={scope !== "all" && me ? "" : undefined} data-pc-line={scope !== "all" && me ? me.device.id : undefined} data-pc-state={scope !== "all" && me ? word.toLowerCase() : undefined}>{scope === "all" ? <b>All computers</b>
        : <><b>{name}</b>{ver && <span className="note">{" · FinCom Bridge " + ver}</span>}</>}
        {scope !== "all" && <span className={"tag " + lv} data-tsc-word="" data-connected-line="">{word}</span>}</div>
      <span className="tsc-right">
        {can && <span className="tsc-switch" role="group" aria-label="Which computers">
          <button className={"linkbtn" + (scope === "this" ? " on" : "")} data-scope-pick="this" aria-pressed={scope === "this"} onClick={() => { S.tallyScope = "this"; render(); }}>This computer</button>
          <button className={"linkbtn" + (scope === "all" ? " on" : "")} data-scope-pick="all" aria-pressed={scope === "all"} onClick={() => { S.tallyScope = "all"; render(); }}>All computers</button></span>}
        {/* this browser not connected to a FinCom Bridge: the one click, quiet (the owner: "a simple click to connect") */}
        {!local && kind !== "none" && !!OC.here && <button className="linkbtn" data-oc-connect="" data-oc-here={OC.here} disabled={!!b} onClick={() => doConnect(false)}>{b === "c" ? "Connecting…" : "Connect this computer"}</button>}
        {/* next-fix-tally-links (the owner: "the steps was hidden after connecting"): connected, the steps stay folded
            behind this small link (Connect another computer: step 1 asked again; Hide the steps folds them back) */}
        {setupOk && <button className="linkbtn" data-tsc-setup="" aria-expanded={gOpen} onClick={() => { if (gOpen) { S.tallyGuide = {}; render(); } else openConnectTally(1, ""); }}>Set up again / another computer</button>}
        <button className="linkbtn" data-oc-get="" data-tsc-refresh="" disabled={!!b} onClick={refresh}>{b === "g" ? "Refreshing…" : "Refresh"}</button></span>
    </div>
    {scope === "all" ? <p className="tsc-line" data-tsc-all=""><PcLines rows={rows} latest={latest} m={m} /></p> : <>
      {tallyLine && <p className="tsc-line" data-tsc-tally={openHere.length}>{tallyLine}</p>}
      {need && <p className={"tsc-need " + lv} data-tsc-need={kind} data-oc-refused={kind === "refused" ? "" : undefined}><span>{need}</span>{act && <span className="tsc-act">{act}</span>}</p>}
      {/* the owner's port step (26-Oct-2026), here once a computer is connected: only while his Tally is not answering on a
          port of its own (not found, or the same port as another Windows user's) */}
      {((kind === "tally" && ps.state === "set") || kind === "port") && <div className="tsc-port" data-connect-step="port" data-port-step=""><b>Set Tally’s port</b><PortStep ps={ps} installed /></div>}
      {s && s.update && !s.stopped && kind !== "version" && <p className="tsc-line note" data-tsc-update="">{"A newer FinCom Bridge is ready for this computer. "}<UpdateBtn m={m} /></p>}
    </>}
    {/* the clicks' answers, in plain words (each once; a line goes when the next click answers) */}
    <Line r={c} hook="connect" />
    {c && c.st === "code" && (codeBelow ? <p className="note" data-oc-code-below="">Or type the 6 digits in Connect this computer below.</p> : <div className="oc-code"><CodeBox /></div>)}
    {c && (c.st === "none" || c.st === "old") && <div className="oc-dl"><DownloadBtn m={m} primary /></div>}
    {(kind === "tally" || (f && f.st !== "found")) && <Found f={f} />}
  </section>;
}
// the page's list: the companies OPEN in Tally right now (live: the beats every 30 s, this browser's bridge, and Refresh),
// on this computer (the scope) or on every computer. A company seen earlier and not open now is not here: linked, it is
// under Clients linked to Tally below the list; not linked, under Help & support › Every company seen. From a client not linked ("Choose on
// Tally page"): the open companies ranked for it, each with "Link to <client>"
function hereKeys(tc) {
  const ks = new Set();
  if (tc.local) [].concat(tc.local.open || []).forEach((o) => { const k = coKey(o && o.name); if (k) ks.add(k); });
  if (tc.me) openOn(tc.me.device).forEach((n) => { const k = coKey(n); if (k) ks.add(k); });
  return ks;
}
function OpenCompanies({ rows }) {
  const g = S.tallyGuide || {}, forCo = guideFor(g), tc = thisComputer(rows), { scope } = scopeOf(tc);
  const all = companyRows(), here = scope === "this" && tc.many ? hereKeys(tc) : null;
  const openHere = (r) => r.open && (!here || here.has(coKey(r.company)));
  // next-fix-tally-links: the linked clients (open or not) are their own quiet section under this list, Clients linked to
  // Tally (parts/TallyCompanies.jsx LinkedClients), always there; this list is the companies open now only
  let list = forCo ? all.slice() : all.filter(openHere);
  const note = forCo ? <p className="note tco-for" data-tco-for={forCo.id}>{"Linking " + forCo.name + ": press “Link to " + forCo.name + "” on its company. "}
    <button className="linkbtn" data-tco-for-clear="" onClick={() => { S.tallyGuide = {}; render(); }}>Show the list for every client</button></p> : null;
  if (forCo) {
    const sc = new Map((typeof suggestFor === "function" ? suggestFor(forCo, list.map((r) => Object.assign({}, r, { client: "" }))) : []).map((x) => [x.company, x]));
    list = list.map((r) => { const x = sc.get(r.company); return Object.assign(r, x && !r.client ? { why: x.why || undefined, score: x.score } : { score: -1 }); })
      .sort((a, b) => (b.open - a.open) || (b.score - a.score) || String(b.seen).localeCompare(String(a.seen)));
  }
  const focus = !forCo && S.tallyFocus && S.companies && S.companies[S.tallyFocus] ? S.tallyFocus : "";
  const pcWord = scope === "all" && tc.many ? " across " + tc.week.length + " computers" : "";
  const none = <p className="note" data-tco-empty="" data-tco-none-open="">{"No company is open in Tally right now" + pcWord + ". Open your company in TallyPrime: it shows here within a minute."}</p>;
  const nOpen = list.length, inList = new Set(list.map((r) => coKey(r.company)));
  return <section className="pane tcompanies" data-tally-focus={focus || undefined}>
    <CompaniesInTally rows={list} forCo={forCo} note={note} focus={focus} title="Open in Tally now" empty={forCo ? null : none} pcs={tc.many}
      count={(l) => nOf(nOpen, "company", "companies") + " open" + pcWord} after={<LinkedClients inList={inList} here={here} />} /></section>;
}
// 2. Needs you: only what neither the guide nor a computer's line says (reading stopped on all computers, a computer key
// refused). sources: the slot for 2.4.1's card of a book open in two data locations (SourceCards on next-241), drawn
// first in this list when given
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
const INI_WORDS = { notadded: "does not have FinCom's add-on line yet; FinCom adds it when Tally is closed.", "usertdl-no": "says User TDL = No, so FinCom left it untouched: Tally does not load FinCom's add-on when it starts.",
  failed: "could not be changed; FinCom's add-on is not loaded when Tally starts.", refused: "is not an ordinary file; FinCom left it untouched.",
  unreadable: "could not be read; FinCom left it untouched." };
function TallyIniLines({ r }) {
  const l = [].concat((((r.device || {}).info || {}).beat || {}).tallyIni || []).filter((x) => x && INI_WORDS[x.state]);
  return l.map((x, i) => <div key={i} className="row" style={ROW}><span className="note" data-tally-ini={x.state}>{"tally.ini " + (x.path || "") + " " + INI_WORDS[x.state]}</span></div>);
}
// 26-Oct-2026 (the owner: older entries come ONLY by uploading Tally's Day Book file, never fetched automatically): the
// per-computer "Reading older entries" switch, its office hours and the old-days test line are gone from the page (no
// call to tally_device_period_fetch / tally_device_period_night is left in the app)
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
      <div data-card-companies="">{cos.length ? <>{r.online ? "Reads " : "Read when last connected: "}{cos.map((c, i) => <span key={c}>{i > 0 && ", "}<b>{c}</b></span>)}</> : <span className="note">{live && r.online ? "No company open in Tally" : "No company being read"}</span>}</div>
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
      <H id="companies">Every company seen in Tally</H>
      <p className="note" style={{ margin: "0 0 6px" }}>Companies the firm’s computers have seen earlier, not open in Tally now and linked to no client: to link one, or take one off the list.</p>
      <CompaniesInTally hook="all" title="" pcs={cardsOf(rows).filter(heardThisWeek).length > 1} only={(r) => !r.open && !(r.client && S.companies && S.companies[r.client] && !S.companies[r.client].deleted)}
        empty={<p className="note" data-tco-empty="">None: every company seen is open in Tally now or linked to a client.</p>} />
      <H id="install">Install on another computer</H>
      <p className="note" style={{ margin: "0 0 6px" }}><button className="linkbtn" data-guide-again="" onClick={() => openConnectTally(1, "")}>Connect another computer</button>{" (the steps, on that computer)"}</p>
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
      <div className="row" style={{ marginTop: 10 }}><Act act={c.key ? "bridgeTest" : "bridgeConnect"} className="btn small primary">{c.key ? "Check connection" : "Connect"}</Act>{c.key && <Act act="bridgeOff">Disconnect</Act>}</div>
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
  if (!p.err) TCloud.paneTick();
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
    <div className="pane"><p className="note" data-cloud-companies-go="" style={{ margin: 0 }}>Which client each Tally company is, and adding or linking one: the Tally page’s Companies in Tally (the one place). <button className="linkbtn" data-open-connect="4" onClick={() => openConnectTally(4, "")}>Open Companies in Tally</button></p></div>
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
  const cards = cardsOf(rows), week = cards.filter(heardThisWeek), ctl = TCloud.pane.ctl || {};
  const gx = guideState(rows, latest), allStopped = TCloud.stoppedAll && TCloud.stoppedAll();
  // next-tally-smart: ONE status card for this computer; the four steps only for a computer never connected; the companies
  // OPEN in Tally now; Clients linked to Tally (every linked client, open or not); Needs you only when something stands; Help & support (closed)
  return <>
    <GuideRefresh />
    {!Bridge.blocked() && <ThisComputer rows={rows} latest={latest} m={m} allStopped={allStopped} codeBelow={!gx.done.install || !!((S.tallyGuide || {}).step === 1 && (S.tallyGuide || {}).at && !Bridge.on())} />}
    <ConnectGuide x={gx} m={m} connectStep={connectStep} />
    <OpenCompanies rows={rows} />
    {ctl.err && <p className="bk-alert bad" data-control-err="" style={{ margin: "6px 0 0" }}><Msg text={ctl.err} /></p>}
    {ctl.ok && <p className="note" data-control-ok="" style={{ margin: "6px 0 0" }}>{ctl.ok}</p>}
    <NeedsYou sources={sourcesSlot} />
    <PageMore rows={rows} latest={latest} m={m} cards={week} old={cards.length - week.length} connectStep={connectStep} />
  </>;
}
