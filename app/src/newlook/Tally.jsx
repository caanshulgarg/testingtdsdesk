// The one Tally page in the new look (the owner, 22-Nov-2026: "one very simple Tally page — I can't tell from where to
// connect; show the 6 steps; show port occupied and port free"; "Tally out of Settings"). Tabs: Tally · Sent to Tally ·
// Sync activity · Settings.
//   Tally      one status line in a sentence ("Connected. Your Tally is on port 9002. 3 ports in use by other users.
//              Port 9034 is free."); Connect Tally's six live steps, always shown (parts/TallySimple.jsx Guide: the same
//              steps, words and buttons as before, never folded away); the companies in Tally and their clients (the
//              same table); This computer: every port FinCom Bridge reports on this computer, "In use by you", "In use
//              by another user" (whose and their companies are never shown) or "Free"; the computers that send Tally's
//              books (each person sees only their own; the owner every one); For support, closed, as before;
//   Settings   Post automatically and Books in the cloud (they were in Settings).
// Nothing new is asked of the bridge or of Tally: the ports are what the bridge's beats, its /status (sessions) and the
// look on 127.0.0.1 already said (lib/ownBridge.js, the same reads every Tally word comes from).
import { useState } from "react";
import TallyHome, { CloudBooks } from "../screens/Tally.jsx";
import SyncActivity from "../screens/TallySync.jsx";
import { PostLog } from "../screens/Done.jsx";
import AutoPostSettings from "../parts/AutoPostSettings.jsx";
import ListTable from "../parts/ListTable.jsx";
import { ownState, localBridges, bridgesOf, sameUser, placeOf, ownRule } from "../lib/ownBridge.js";
import { freePort } from "../lib/tallyPort.js";
import { connectSteps, TITLES } from "../lib/connectSteps.js";
import { Pill } from "./parts.jsx";
import { TellPcWords } from "../parts/TallyTell.jsx";   // Tally tell (migration 221): each computer's one line
import "./newlook.css";

const lc = (s) => String(s || "").trim().toLowerCase();
const short = (u) => String(u || "").split("\\").pop().trim();
const WEEK = 7 * 864e5;
const recent = (at) => !!at && Date.now() - Date.parse(at) < WEEK;
const TABS = [["computers", "Tally"], ["sent", "Sent to Tally"], ["activity", "Sync activity"], ["settings", "Settings"]];
const RANK = { free: 0, other: 1, you: 2 };
export const WHO = { you: "In use by you", other: "In use by another user", free: "Free" };

// every port FinCom knows of on this computer: {port, what, who: you | other | free, say}
export function portRows() {
  let own; try { own = ownState(); } catch (e) { own = { state: "none" }; }
  const ob = own.own || null, pc = lc(ob && ob.pc), me = ob && ob.user, m = new Map();
  const put = (port, x) => { const p = Number(port) || 0; if (p < 1 || p > 65535) return; const h = m.get(p); if (!h || RANK[x.who] > RANK[h.who]) m.set(p, Object.assign({ port: p }, x)); };
  const other = (what) => ({ what, who: "other", say: what === "TallyPrime" ? "Another Windows user’s Tally (FinCom does not use it)" : "Another Windows user’s FinCom Bridge" });
  if (ob && ob.port) put(ob.port, { what: "FinCom Bridge", who: "you", say: "Your FinCom Bridge" + (ob.version ? " " + ob.version : "") });
  (localBridges() || []).forEach((x) => { const p = Number((x && (x.bridgePort || x.port)) || 0);
    if (x && x.sameSession === true) put(p, { what: "FinCom Bridge", who: "you", say: "Your FinCom Bridge" + (x.version ? " " + x.version : "") });
    else if (x && (x.sameSession === false || x.yours === false)) put(p, other("FinCom Bridge")); });
  const untold = { what: "TallyPrime", who: "other", say: "A Tally whose Windows user cannot be told (FinCom does not use it)" };
  const tally = (p, mine, ok, words, unknown) => put(p.port, mine ? { what: "TallyPrime", who: "you", say: words || (ok ? "Your Tally" : "Your Tally, not answering") } : unknown ? untold : other("TallyPrime"));
  const beat = (ob && ob.beat) || {};
  // whose Tally: the bridge's own rule (lib/ownBridge.js ownRule, as upBeat reads a beat): a Tally of an owner Windows
  // cannot tell is this user's only when the bridge tells no Tally's owner at all
  const bp = [].concat(beat.ports || []).filter((p) => p && Number(p.port) > 0).map((p) => Object.assign({}, p, { mine: p.owner === "unknown" ? null : !p.skipped })), br = ownRule(bp);
  bp.forEach((p) => tally(p, !p.skipped && br(p), !!p.ok, p.ok ? "Your Tally" + (p.busy ? " (busy)" : "") : "", p.owner === "unknown"));
  if (Number(beat.tallyPort) > 0) put(beat.tallyPort, { what: "TallyPrime", who: "you", say: "Your Tally" });
  // this browser's own bridge, answering now: its Tallys (another user's is "skipped" or not "mine")
  try {
    if (typeof Bridge === "object" && Bridge.on() && Bridge.st && Bridge.st.state === "ok" && own.from === "here")
      [].concat(Bridge.st.sessions || []).forEach((se, _i, ss) => { if (!se || !(Number(se.port) > 0)) return; const mine = !se.skipped && ownRule(ss)(se);
        const cos = mine ? [].concat(se.companies || []).map((c) => c && c.name).filter(Boolean) : [];
        tally(se, mine, !!se.ok, mine && se.ok ? "Your Tally" + (cos.length ? " · " + cos.length + (cos.length === 1 ? " company open" : " companies open") : " · no company open") : "", !se.skipped && typeof se.mine !== "boolean"); });
  } catch (e) { /* the beats said it */ }
  // the other bridges heard on this computer this week: another Windows login's (whose: never said)
  if (pc) bridgesOf().forEach((b) => {
    if (lc(b.pc) !== pc || (ob && b.id === ob.id) || !recent(b.at)) return;
    const mine = sameUser(b.user, me) === true, bt = b.beat || {};
    if (b.port) put(b.port, mine ? { what: "FinCom Bridge", who: "you", say: "Your FinCom Bridge (another copy)" } : other("FinCom Bridge"));
    if (Number(bt.tallyPort) > 0) put(bt.tallyPort, mine ? { what: "TallyPrime", who: "you", say: "Your Tally" } : other("TallyPrime"));
    [].concat(bt.ports || []).forEach((p) => { if (p && Number(p.port) > 0 && !p.skipped && !mine) put(p.port, other("TallyPrime")); });
  });
  const rows = [...m.values()];
  // the one free port FinCom proposes (the same rule as step 3's: 9000-9099, never one seen in use or commonly taken)
  const free = ob || rows.length ? freePort(new Set(rows.map((r) => r.port)), short(me)) : 0;
  if (free) rows.push({ port: free, what: "", who: "free", say: "Free: use it for a new Tally (TallyPrime: F1 › Settings › Connectivity)" });
  rows.sort((a, b) => RANK[b.who] - RANK[a.who] || a.port - b.port);
  return { own, rows, free };
}

// the status line, as a sentence
export function statusLine(own, rows, free) {
  const you = rows.filter((r) => r.who === "you" && r.what === "TallyPrime"), others = rows.filter((r) => r.who === "other").length;
  const tail = (others ? " " + others + (others === 1 ? " port is" : " ports are") + " in use by other users." : "") + (free ? " Port " + free + " is free." : "");
  if (own.state === "ok") return { w: "Done", text: "Connected." + (you.length ? " Your Tally is on port " + you.map((r) => r.port).join(", ") + "." : " Open TallyPrime in this Windows login.") + tail };
  if (own.state === "checking") return { w: "New", text: "Looking for FinCom Bridge on this computer…" };
  if (own.state === "away") return { w: "Problem", text: "Your FinCom Bridge is not connected now. Step 1 below says what to do." + tail };
  return placeOf() === "laptop" ? { w: "New", text: "Not connected on this computer. Connect Tally on the computer where TallyPrime runs: the 6 steps below, there." }
    : { w: "New", text: "Not connected yet. Follow the 6 steps below; each ticks by itself." };
}

function Ports({ rows }) {
  const cols = [
    { k: "port", role: "number", label: "Port", v: (r) => r.port, cell: (r) => <b>{r.port}</b> },
    { k: "what", role: "party", label: "Program", v: (r) => r.what || "—", cell: (r) => r.what || <span className="note">—</span> },
    { k: "who", role: "status", label: "In use", v: (r) => WHO[r.who], cell: (r) => <span className={"nl-port " + r.who} data-nl-port-who={r.who}>{WHO[r.who]}</span> },
    { k: "say", label: "What it is", v: (r) => r.say, cell: (r) => r.say },
    { k: "ac", role: "act", cls: "n", cell: (r) => (r.who === "free" ? <button type="button" className="linkbtn" data-nl-port-copy={r.port} onClick={() => (navigator.clipboard ? navigator.clipboard.writeText(String(r.port)) : Promise.reject()).then(() => toast("Port " + r.port + " copied."), () => toast("Could not copy; type " + r.port + "."))}>Copy port</button> : null) },
  ];
  return <ListTable name="nlPorts" className="bk-table nl-table" cols={cols} rows={rows} rowKey={(r) => String(r.port)} unit={["port", "ports"]}
    rowProps={(r) => ({ "data-nl-port": r.port })} empty="FinCom Bridge has not reported this computer’s ports yet: they show here after step 1." />;
}

const isOwner = () => !!(S.account && S.account.me && S.account.me.role === "owner");
function Computers({ own }) {
  if (typeof TCloud !== "object" || !TCloud.on()) return null;
  const all = TCloud.bridgesHeard ? TCloud.bridgesHeard() : [], ob = own.own || null;
  // each person sees only their own Tally (next-tally-own-status); the owner, each computer of the firm
  const rows0 = isOwner() ? all : all.filter((r) => ob && ob.id && r.id === ob.id), by = new Map();
  rows0.forEach((r) => { const k = r.device.id + "|" + lc(r.user), h = by.get(k); if (!h || String(r.at || "") > String(h.at || "")) by.set(k, r); });
  const rows = [...by.values()], mine = (r) => ob && r.id === ob.id;
  const cols = [
    { k: "at", role: "date", label: "Last heard", v: (r) => r.at || "", cell: (r) => (r.at ? fmtDateTime(Date.parse(r.at)) : "never") },
    { k: "pc", role: "party", label: "Computer", v: (r) => r.computer || "", cell: (r) => <>{r.computer}{mine(r) && <> <span className="tag ok">you</span></>}</> },
    { k: "user", label: "Windows user", v: (r) => short(r.user), cell: (r) => short(r.user) || "—" },
    { k: "ver", label: "FinCom Bridge", v: (r) => r.version || "", cell: (r) => r.version || "—" },
    { k: "tally", role: "status", label: "Tally", v: (r) => (r.tally === "open" ? "Open" : "Closed"), cell: (r) => (r.tally === "open" ? "Open" : "Closed") },
    { k: "open", label: "Companies open", cls: "n", v: (r) => (r.open || []).length, cell: (r) => (r.open || []).length },
    { k: "tell", label: "Now", v: () => "", cell: (r) => <TellPcWords id={r.device.id} /> },
  ];
  return <ListTable name="nlPcs" className="bk-table nl-table" cols={cols} rows={rows} rowKey={(r) => r.device.id + ":" + r.id} unit={["computer", "computers"]}
    loading={TCloud.pane.devices == null && !TCloud.pane.err ? "the computers" : false} empty="No computer sends Tally’s books yet: they show here after step 1." />;
}

// signed out of the firm account the Tally page has no guide of its own (connecting keeps the link in FinCom's cloud):
// the six steps are still shown, from the same source (lib/connectSteps.js), with what to do now
const STATE_WORD = { done: "Done", now: "Do this now", later: "Later" };
function Steps() {
  let cs; try { cs = connectSteps({ latest: "" }); } catch (e) { cs = null; }
  // (steps the source stops before, e.g. linking a company, which needs the firm account: Later)
  const got = (cs && cs.steps) || [], steps = TITLES.map((title, i) => got[i] || { n: i + 1, title, state: "later" });
  return <section className="nl-card" aria-label="Connect Tally" data-nl-steps="">
    <h3 className="nl-h">Connect Tally in 6 steps</h3>
    <ol className="tsm-steps">{steps.map((x) => <li key={x.n} className={"tsm-step " + (x.state || "later")} data-tsm-step={x.n} data-tsm-state={x.state || "later"}>
      <div className="tsm-step-top"><span className="tsm-mark" aria-hidden="true">{x.state === "done" ? "✓" : x.n}</span><span className="tsm-step-title">{x.title}</span></div>
      <div className="tsm-step-text">{STATE_WORD[x.state || "later"]}</div>
      {x.state === "now" && x.say && <div className="tsm-now-text">{"Step " + x.n + ": " + x.say}</div>}</li>)}</ol>
    {(!cs || cs.mode === "laptop") && <p className="note">Do these on the computer where TallyPrime runs. Sign in to the firm account there: the steps tick by themselves.</p>}
  </section>;
}

function ThisComputer() {
  const { own, rows } = portRows();
  return <>{typeof TCloud === "object" && !TCloud.on() && <Steps />}<section className="nl-card nl-this" data-nl-this="">
    <h3 className="nl-h">This computer</h3>
    <Ports rows={rows} />
    {typeof TCloud === "object" && TCloud.on() && <><h3 className="nl-h">Computers that send Tally’s books</h3>
    <Computers own={own} /></>}
  </section></>;
}

export default function NLTally() {
  // (the six steps stay shown, the owner: "show the 6 steps": the guide keeps the new look's own state, open unless hidden,
  // parts/TallySimple.jsx UI; the old look's S.tsm is never touched from here). Shown again each time the page opens
  // (the re-review: the owner found them "not visible anywhere"): Hide the steps lasts only until the page is left
  useState(() => { if (S.nlTsm) S.nlTsm.open = true; return 0; });
  const tab = TABS.some(([k]) => k === S.tallyTab) ? S.tallyTab : "computers";
  const go = (k) => () => { S.tallyTab = k; if (k === "activity" && typeof Rec === "object" && Rec.act) Rec.act.at = 0; render(); window.scrollTo(0, 0); };
  const { own, rows, free } = portRows(), line = statusLine(own, rows, free);
  return <div className="nl-tally" data-nl-tally={tab}>
    <nav className="nl-tabs" aria-label="Tally">{TABS.map(([k, w]) => <button key={k} type="button" className="nl-tab" data-nl-tallytab={k} aria-current={k === tab ? "page" : undefined} onClick={go(k)}>{w}</button>)}</nav>
    {tab === "computers" && <>
      <p className="nl-status" data-nl-tally-status={own.state} role="status"><Pill w={line.w === "Done" ? "Done · connected" : line.w === "Problem" ? "Problem" : "New · not connected"} /> <span>{line.text}</span></p>
      <TallyHome afterSimple={<ThisComputer />} />
    </>}
    {tab === "sent" && <PostLog />}
    {tab === "activity" && <SyncActivity />}
    {tab === "settings" && <div className="nl-tally-set" data-nl-tally-settings="">
      <section className="nl-card"><h3 className="nl-h">Post automatically</h3><AutoPostSettings /></section>
      <CloudBooks />
    </div>}
  </div>;
}
