// The Tally page, made simpler (next-tally-simple2, 07-Nov-2026; the owner's approved "Tally simple page v4"), drawn by
// screens/Tally.jsx under its "Tally" title and Download FinCom Bridge, above Advanced (for support):
//   1. ONE connection card (Top): a dot, "Connected to Tally" or the real state, one muted line, How to connect (the six
//      steps under the card), Check again with its result; the bridge's wait and a stuck posting as one line in it
//   2. "Clients · N" and ONE table: Client · Tally company | Masters | Entries | Action. One main button a row, chosen by
//      its state; More ▾ opens one light row under it with the rest (see MoreRow). No filter chips
//   3. the foot: "One main button per client. More ▾ opens the rest." and Advanced (for support)
// Before (next-tally-simple, 02-Nov-2026, "Tally — Yes or No"):
//   1. the header: "Tally", "N clients are fine. M need you.", Check Tally now (the day check of every client:
//      tally_check_request, the same as each client's "Check for changes in Tally"; a cloud without it: Update now)
//   2. Connect a company to Tally: four steps that move on by themselves from real state (no bridge heard → 1, Download;
//      a bridge, nothing open that no client has → 2; a company open that no client has → 3, "Connect it to client X?";
//      just linked → 4). Small once every company is connected
//   3. the strip, once a company is connected: a company open in Tally that no client has, one click to connect it
//   4. the ONE table, its search and filters
//   5. the computers in one line (no names), Download FinCom Bridge when one is older
// The same links, reads and RPCs as before (linkTo, addNew in Pick, ChangePick, firstSync, tally_fill_request, the Day
// Book upload); nothing new is asked of the bridge or of Tally. No computer's name anywhere here.
import { Component, useEffect, useState } from "react";
import { linkTo, Pick, ChangePick, booksLoad, firstSync, syncPoll, openFromTally } from "./TallyCompanies.jsx";
import { checkAll, connSig, tallyOpenOn, offSay, bridgesOf, rowsLast, placeOf, LEDN, ASKED_N, rowsFor, quickRows, openingsAll, openingsDecide, rupees, matches, headWords, ownState, localBridges, rescanLocal, lookOnce, aimLocal, LOCALB, YES, NO, NOTYET, BLOCKED } from "../lib/tallySimple.js";
import { coKey, tallyDevs, pcRawOf } from "../lib/tallyState.js";
import { bridgeStopped, bridgeBack, stoppedWhere } from "../lib/bridgeStop.js";   // bridge 2.5.10: a bridge stopped, or back by itself
import { ledgersHeld, LED_N, ledBook, cloudLedgerCount, baseKey, stallWhy, companyRows, unlink, runPress, runWords, runSettle, runBusy, keepWaitWords } from "./TallyCompanies.jsx";
import { soonDraw } from "../lib/soonDraw.js";
import { MastersCell, EntriesCell, BringMasters, BringBooks, PullButtons, History, DayBookDrop, rangeWords, mastersOf, entriesOf } from "./TallyProgress.jsx";
import OlderEntries, { TurnOn, owner, TURN_FROM } from "./TallyFetch.jsx";
import { PostingWait } from "./StuckJobs.jsx";
import { press, say, busyOf, saidOf, Said, useSaid, errWords, VIEW_ONLY } from "./TallyBtn.jsx";   // next-buttons: every click says what came of it
import { ackSnap } from "../lib/pickAck.js";   // bridge 2.5.10: what the bridge said of it
// each connected client's ledger count from FinCom's cloud (tally_ledgers, counted; kept a minute), asked once a minute at most
function countLedgers(rows) {
  rows.forEach((r) => {
    const bk = ledBook(r.cid);
    if (r.kind !== "client" || r.c.w !== YES || ASKED_N.has(r.cid) || !bk || (LEDN[r.cid] && LEDN[r.cid].book === bk.book && Date.now() - LEDN[r.cid].at < 300000)) return;
    ASKED_N.add(r.cid);
    Promise.resolve(cloudLedgerCount(r.cid, true)).then((n) => { if (n != null) { LEDN[r.cid] = { n, book: bk.book, at: Date.now() }; soonDraw(); } }, () => {}).finally(() => setTimeout(() => ASKED_N.delete(r.cid), 60000));
  });
}
import { rpc, missing, bookSum, askStatus, summary, bookFetch } from "./TallyFetch.jsx";
import { periodOf, daysOf } from "./TallyCheck.jsx";
import "./tallySimple.css";
// "Open in Tally right now?" with no FinCom Bridge reachable from this browser: Connect is the page's own local connect
// (Connect this computer: doConnect, its answer in OC.c), nothing new
import { OC, doConnect, Line } from "./TallyOneClick.jsx";
import { HERE } from "../lib/tallyConnect.js";
import { noAnswer, readWhere, followOn } from "../lib/readFollow.js";
import { connectSteps, LAPTOP, LAPTOP_HERE } from "../lib/connectSteps.js";

const shown = (n) => String(n || "").replace(/\s+/g, " ").trim();
// next-tally-words: a client named as its Tally company (case and spaces aside): the button says only "Link"
const sameName = (a, b) => !!shown(a) && shown(a).toLowerCase() === shown(b).toLowerCase();
const canWrite = () => (S.account && S.account.me ? ["owner", "staff"].includes(S.account.me.role) : true);
const UI = () => (S.tsm = S.tsm || { filter: "all", q: "", open: false, again: 0, check: 0 });
// a Check again's words, on the top line too: for 3 minutes, and only while the connection is as they saw it
const keepSaid = (w) => { UI().said = { w, at: Date.now(), sig: connSig() }; };
const saidNow = () => { const x = UI().said; return x && x.w && Date.now() - x.at < 180000 && x.sig === connSig() ? x.w : ""; };
const set = (p) => { Object.assign(UI(), p); render(); };
const GUIDE_MS = 15 * 60000;

// ---------- Check Tally now: each connected client's day check (this financial year so far, never before its books
// start), as its own "Check for changes in Tally" asks it; the computers are woken and read again first
const CHK = { busy: false };
export async function checkTallyNow(rows, checkAgain) {
  if (CHK.busy) return;
  CHK.busy = true; set({ check: Date.now() });
  try {
    try { await checkAgain(); } catch (e) { /* the reads say why */ }
    const cs = rows.filter((r) => r.kind === "client" && r.c.w === YES), books = summary(true) || [];
    let n = 0, fallback = false, bad = 0, err = null;
    for (const r of cs) {
      const b = bookSum(r.cid) || books.find((x) => x.client === r.cid);
      if (!b && !fallback) continue;
      try {
        if (fallback) throw new Error("PGRST202");
        const [a, z] = periodOf("fy", "", "", b.from);
        const x = await rpc("tally_check_request", { p_client: r.cid, p_from: a, p_to: z });
        if (!(x && x.ok === false)) n++; else bad++;
      } catch (e) {
        // the day check is not in this cloud: Update now (tally_want_update), as each client's own button
        if (missing(e)) { fallback = true; try { await TCloud.rpc("tally_want_update", { p_client: r.cid }); n++; } catch (e2) { bad++; err = e2; } }
        else { bad++; err = e; }
      }
    }
    askStatus(true);
    // next-buttons: the result beside the button too (a toast goes), and the clients FinCom could not ask
    const w = (n ? (fallback ? "The Tally computer is asked to update " : "Checking ") + n + (n === 1 ? " client" : " clients") + (fallback ? " now." : " against Tally.") : bad ? "" : "Tally checked: nothing to compare yet: no linked client has books in FinCom yet.")
      + (bad ? (n ? " " : "") + nOfW(bad, "client was", "clients were") + " not asked: " + (err ? errWords(err) : "FinCom did not take it. Try again in a minute.") : "");
    say("checkall", w, !!bad && !n); toast(w);
  } catch (e) { say("checkall", errWords(e), true); }
  finally { CHK.busy = false; render(); }
}
function checking() {
  if (CHK.busy) return true;
  const at = UI().check;
  return !!at && (askStatus() || []).some((k) => k.state !== "done" && Date.parse(k.at) >= at - 60000);
}

// ---------- Connect Tally: the six live steps for THIS browser's own Windows login (next-tally-connect-steps; the
// owner: "all 6 steps are not visible anywhere"; lib/connectSteps.js holds the steps and their words). Each step ticks by
// itself from what the page already reads (the beats every 30 s, the look on 127.0.0.1, the rows); only the first step
// not done says what to do, with its one button; Check again asks now. All done: one small line. A laptop (no bridge
// here): where to do the steps, with the firm's state
const TICK = <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
// one click: the company to the client (the same link as everywhere: linkTo, its first sync started)
// next-buttons: the link's result beside the button (linked, or why not); a second click while it links does nothing
export const linkWords = (ok, co, company) => ok ? "Linked " + co.name + " to “" + shown(company) + "”. Its masters come from Tally now."
  : ok === false ? { text: "Not linked: " + String((typeof TCloud === "object" && TCloud.linkErr) || "FinCom did not take it. Try again in a minute.").replace(/[.\s]+$/, "") + ".", bad: true } : "";
function ConnectBtn({ r, co, label, hook, primary = true }) {
  useSaid();
  const k = "link:" + co.id + ":" + coKey(r.company), busy = busyOf(k);
  if (!canWrite()) return <span className="note">A member of the firm who may make changes links it.</span>;
  return <><button type="button" className={"btn" + (primary ? " primary" : "")} {...hook} disabled={busy}
    onClick={() => press(k, async () => { if (typeof TCloud === "object") TCloud.linkErr = ""; return linkWords(await linkTo(r, co), co, r.company); }, 60000)}>{busy ? "Linking…" : label}</button>
    <Said k={k} hook="link" /></>;
}
const STATE_WORD = { done: "Done", now: "Do this now", later: "Later" };
function Guide({ cs, collapsed, forced, asked, connectPanel, download, checkAgain, here = null }) {
  const ui = UI(), [ck, setCk] = useState(false), [pick, setPick] = useState(false), [said, setSaid] = useState("");
  // (the words also on the top line: connected, the steps fold away)
  const again = () => { setCk(true); setSaid(""); checkAll(checkAgain).then((w) => { setSaid(w); keepSaid(w); }).finally(() => { setCk(false); render(); }); };
  // the card's own look (TallyOneClick useHereProbe, every 2 minutes) found this login's bridge: the page's look follows
  // (once for each bridge it finds, and only a 2.5.3 one saying it is this session's: never a look that starts another look)
  useEffect(() => { const A = HERE.lastAny, m = A && A.h && A.h.mine, k = m ? String(m.bridgeId || m.port || "") : "";
    if (cs.now && cs.now.n === 1 && m && m.sameSession === true && k && k !== Guide.seen && !(localBridges() || []).some((x) => x && x.sameSession === true)) { Guide.seen = k; rescanLocal(); } });
  const recheck = <><button type="button" className="linkbtn" data-tsm-recheck="" disabled={ck} onClick={again}>{ck ? "Checking…" : "Check again"}</button>{said && !ck && <span className="tsm-note" data-checked="" role="status">{said}</span>}</>;
  const another = <div className="tsm-now" data-tsm-another=""><div className="tsm-now-text">On another computer or Windows login: download FinCom Bridge there and run it in the login that runs TallyPrime. Its own six steps show there.</div>
    <span className="tsm-now-act">{download}</span></div>;
  if (cs.mode === "laptop") return <section className="tsm-card tsm-guide tsm-guide-small" aria-label="Connect Tally" data-tsm-guide="laptop" data-tsm-forced={forced ? "" : undefined}>
    <div className="tsm-guide-top"><b className="tsm-guide-title">Connect Tally</b><span className="tsm-guide-links">{recheck}
      <button type="button" className="linkbtn" data-tsm-show="" aria-expanded={!!ui.open} onClick={() => set({ open: !ui.open })}>{ui.open ? "Hide the steps" : "Show the steps"}</button></span></div>
    <div className="tsm-now-text" data-tsm-laptop="">{LAPTOP}</div>
    <div className="tsm-note" data-tsm-laptop-here="">{LAPTOP_HERE}</div>
    {/* next-tally-page-redesign (the owner: "I can't see the bridge download button"): the Download right here, not only once the steps are opened */}
    {!forced && <div className="tsm-now-act" data-tsm-laptop-dl="">{download}</div>}
    <div className="tsm-note" data-tsm-firm="">{cs.firm}</div>
    {forced && another}
    {/* (asked to set up here: this may be the Tally computer, its bridge not installed in this login yet) */}
    {(forced || asked) && connectPanel && <div className="tsm-guide-panel" data-tsm-panel="">{connectPanel}</div>}
    {(ui.open || forced) && <ol className="tsm-steps" data-tsm-titles="">{cs.steps.map((s) => <li key={s.n} className="tsm-step" data-tsm-step={s.n}>
      <div className="tsm-step-top"><span className="tsm-mark" aria-hidden="true">{s.n}</span><span className="tsm-step-title">{s.title}</span></div></li>)}</ol>}
  </section>;
  // (the steps could not be worked out this time: a neutral line, never "all done"; the next drawing tries again)
  if (cs.mode === "error") return <section className="tsm-card tsm-guide tsm-guide-small" aria-label="Connect Tally" data-tsm-guide="error">
    <div className="tsm-guide-top"><b>Connect Tally</b><span className="tsm-note">The steps could not be worked out just now.</span><span className="tsm-guide-links">{recheck}</span></div></section>;
  const now = cs.now, who = cs.login ? "This Windows login: " + cs.login : "This Windows login";
  if (collapsed) return <section className="tsm-card tsm-guide tsm-guide-small" aria-label="Connect Tally" data-tsm-guide="done" data-tsm-collapsed="" data-tsm-login={cs.login || undefined}>
    <div className="tsm-guide-top"><b>{"Connect Tally · " + who + " · all 6 steps done ✓"}</b>
      <span className="tsm-guide-links">{recheck}<button type="button" className="linkbtn" data-tsm-show="" onClick={() => set({ open: true })}>Show the steps</button></span></div>{here}</section>;
  const a = now && now.act;
  let btn = null;
  if (a && a.kind === "download") btn = download;
  else if (a && a.kind === "link" && canWrite()) btn = a.co ? <ConnectBtn r={a.r} co={a.co} label="Link" hook={{ "data-tsm-go": "connect", "data-tsm-go-client": a.co.id }} />
    : <button type="button" className="btn primary" data-tsm-go="choose" onClick={() => setPick(!pick)} aria-expanded={pick}>Choose the client</button>;
  else if (a && a.kind === "check") btn = <>{now.n === 1 && download}<button type="button" className={"btn" + (now.n === 1 ? "" : " primary")} data-tsm-go="check" disabled={ck} onClick={again}>{ck ? "Checking…" : "Check again"}</button></>;
  const copy = a && a.free ? <button type="button" className="linkbtn" data-tsm-port-copy={a.free} onClick={() => (navigator.clipboard ? navigator.clipboard.writeText(String(a.free)) : Promise.reject()).then(() => toast("Port " + a.free + " copied."), () => toast("Could not copy; type " + a.free + "."))}>{"Copy " + a.free}</button> : null;
  // (the step to do now says what to do inside its own row, as the approved design)
  const nowBlock = now && <div className="tsm-now">
      <div className="tsm-now-text" data-tsm-now={now.n} data-tsm-now-hook={now.hook || undefined}>{"Step " + now.n + ": " + now.say}</div>
      {(btn || copy) && <span className="tsm-now-act">{btn}{copy}</span>}
      {a && a.kind === "link" && a.co && canWrite() && !pick && <button type="button" className="linkbtn" data-tsm-go-choose="" onClick={() => setPick(true)}>Choose another client</button>}
    </div>;
  return <section className="tsm-card tsm-guide" aria-label="Connect Tally" data-tsm-guide={now ? now.n : "done"} data-tsm-hook={now ? now.hook || undefined : undefined} data-tsm-login={cs.login || undefined} data-tsm-forced={forced ? "" : undefined}>
    <div className="tsm-guide-top"><b className="tsm-guide-title">Connect Tally</b><span className="tsm-note" data-tsm-who="">{who}</span>
      <span className="tsm-guide-links">{recheck}
        {forced ? <button type="button" className="linkbtn" data-tsm-back="" onClick={() => { S.tallyGuide = {}; set({ again: 0 }); }}>Back</button> : null}
        {ui.open && !now && <button type="button" className="linkbtn" data-tsm-hide="" onClick={() => set({ open: false })}>Hide the steps</button>}</span></div>
    <ol className="tsm-steps">{cs.steps.map((s) => <li key={s.n} className={"tsm-step " + s.state} data-tsm-step={s.n} data-tsm-step-key={s.key} data-tsm-state={s.state}
      data-now={s.state === "now" ? "" : undefined} data-done={s.state === "done" ? "" : undefined} aria-current={s.state === "now" ? "step" : undefined}>
      <div className="tsm-step-top"><span className="tsm-mark" aria-hidden="true">{s.state === "done" ? TICK : s.n}</span><span className="tsm-step-title">{s.title}</span></div>
      <div className="tsm-step-text">{s.state === "done" ? (s.doneSay || STATE_WORD.done) + " ✓" : STATE_WORD[s.state]}</div>
      {/* step 1 always has the Download (to install, to update, or for another login); the step to do now has it below */}
      {s.n === 1 && s.state !== "now" && <div className="tsm-step-dl" data-tsm-step-dl="">{download}</div>}
      {s.state === "now" && nowBlock}</li>)}</ol>
    {a && a.kind === "link" && canWrite() && pick && <div className="tsm-pick" data-tsm-guide-pick=""><Pick r={a.r} co={null} pre="" onClose={() => setPick(false)} /></div>}
    {/* Set up again / another computer (openConnectTally(1)): the one Download for that other login */}
    {forced && !(now && now.n === 1) && another}
    {now && now.n === 1 && connectPanel && now.hook !== "blocked" && <div className="tsm-guide-panel" data-tsm-panel="">{connectPanel}</div>}
    {here}
  </section>;
}

// ---------- the strip: a company open in Tally that no client has, one click (once a company is connected)
function Strip({ r, best, more }) {
  const [pick, setPick] = useState(false);
  return <section className="tsm-strip" aria-label="New company found in Tally" data-tsm-strip={r.company}>
    <div className="tsm-strip-words"><b>Open in your Tally now:</b>{" “" + shown(r.company) + "”, not linked yet"}
      {more > 0 && <span className="note">{" (and " + more + " more in the list below)"}</span>}</div>
    {canWrite() && <div className="tsm-strip-acts">
      {best && <ConnectBtn r={r} co={best} label={sameName(best.name, r.company) ? "Link" : "Link to client “" + best.name + "”"} hook={{ "data-tsm-strip-connect": best.id }} />}
      {!pick && <button type="button" className={best ? "linkbtn" : "btn primary"} data-tsm-strip-choose="" onClick={() => setPick(true)}>{best ? "Link to another client" : "Link to a client"}</button>}</div>}
    {pick && <div className="tsm-pick" data-tsm-strip-pick=""><Pick r={r} co={null} pre="" onClose={() => setPick(false)} /></div>}
  </section>;
}

// ---------- next-tally-basics (06-Nov-2026; the owner: "I can't even tell how many Tallys are open, which ones, and where
// and how to connect or link each one. If a company is already a client and Tally hasn't connected, there should be a
// button to tell it to connect again"). ONE panel under the steps, from THIS login's own Tally only (ownState: its own
// bridge's sessions, else its own beat; never another login's): each Tally running here with its port and state, the
// companies open in it (linked: the client, Reading / Up to date, Update now; a client matches: Connect; none: Link), and
// the clients linked but not connected now, each with Connect again (the shared look and the steps' Check again, then
// what is missing in plain words and the step that is stuck; the company open under a close name: link to it). The
// strip it replaces said only the first company not linked. Nothing new is polled or asked of the bridge or Tally.
// {tallys: [{port, ok, state, names}], unknown: [names]}: this login's own sessions (another login's, skipped, never), the
// ones that answer and the ones running that do not (connection off, not answering, …; a port nothing listens on is no
// Tally); each company under the Tally whose port its bridge names, else under the one Tally that answers, else under
// "port not known" (an older bridge that names no port: never said "connected")
const lc = (v) => String(v || "").trim().toLowerCase();
const SESS_STATE = { "connection off": "connection off", "not answering": "not answering", "owner unknown": "run as administrator", busy: "busy" };
export function ownTallys(own) {
  const here = own && own.from === "here" && typeof Bridge === "object" ? Bridge.st || {} : null, b = (own && own.own && own.own.beat) || {};
  // (another program on a port, another login's or bridge's, or a Tally whose owner is unknown: not this login's Tally;
  // the list of lib/tallySimple.js ownConnOff)
  const all = [].concat((here && here.sessions && here.sessions.length ? here.sessions : b.ports) || [])
    .filter((p) => p && !p.skipped && p.mine !== false && Number(p.port) > 0 && !["not tally", "another user", "another bridge", "owner unknown"].includes(lc(p.reason)));
  // the bridge says a Tally whose connection is off by the beat's tallyWhy, its own port's reason "closed": that port is
  // this login's Tally with its connection off
  const why = lc((here && here.tallyWhy) || b.tallyWhy), tp = Number((here && here.tallyPort) || b.tallyPort) || 0;
  // bridge 2.5.11: its details name the port this login's Tally should take (tallyOff.want): that one, however many are
  // closed. Review 10: the local status when it is there (an answer of this login's bridge now), else only a beat heard
  // in the last 3 minutes: never a row from a stale beat
  const live = !!here && here.tallyWhy != null, beatNow = !!b.at && Date.now() - Date.parse(b.at) < 3 * 60000;
  const tf = live ? here.tallyOff : beatNow ? b.tallyOff : null, fp = tf && typeof tf === "object" ? Number(tf.want) || 0 : 0;
  const offAt = (p) => !p.ok && (fp ? Number(p.port) === fp : why === "connection off" && (tp ? Number(p.port) === tp : all.filter((x) => !x.ok).length === 1));
  const ses = all.filter((p) => p.ok || offAt(p) || !(/^closed$|^$/.test(lc(p.reason || p.state || "")) || /nothing listens/i.test(String(p.error || ""))));
  const items = here ? [].concat(here.open || []).filter((o) => o && o.mine !== false) : [], oks = ses.filter((s) => s.ok);
  const by = new Map(), out = [], unknown = [];
  [...((own && own.names) || new Map()).values()].forEach((n) => { const it = items.find((o) => coKey(o.name) === coKey(n));
    const p0 = it && Number(it.port), p = p0 && ses.some((x) => Number(x.port) === p0) ? p0 : oks.length === 1 ? Number(oks[0].port) : 0;
    if (p) by.set(p, (by.get(p) || []).concat(n)); else unknown.push(n); });
  ses.forEach((x) => { const p = Number(x.port); if (out.some((t) => t.port === p)) return;
    out.push({ port: p, ok: !!x.ok, state: x.ok ? "connected" : offAt(x) ? "connection off" : SESS_STATE[lc(x.reason || x.state)] || "not answering", names: by.get(p) || [] }); });
  // (its port not among this login's own, e.g. another login's Tally holds it: this login's Tally is shown all the same)
  if (fp && !out.some((t) => t.port === fp)) out.push({ port: fp, ok: false, state: "connection off", names: [] });
  return { tallys: out, unknown };
}
if (typeof window === "object") window.FCOwnTallys = ownTallys;   // (the tests)
const STATE_OF = { clash: "port taken", reopen: "connection set, not on yet", notanswering: "not answering", admin: "run as administrator" };
const nOfW = (n, one, many) => n + " " + (n === 1 ? one : many);

// ---------- next-tally-table (04-Nov-2026): the table is never lost to another part. Each part of the page is drawn on its
// own: one that fails shows nothing (the header, the strip, the guided box, the computers) or, for the table, the clients
// with their Tally company from what is already here; the error goes to the console and Sentry, and the next drawing
// tries again
let DRAWN = 0;
const TOLD = new Set();
class Part extends Component {
  constructor(p) { super(p); this.state = { e: null }; }
  static getDerivedStateFromError(e) { return { e }; }
  componentDidCatch(e) {
    // (told once a part for the page: it is tried again at every drawing)
    try { console.error("[FinCom] the Tally page's " + this.props.name + " could not be drawn:", e); if (!TOLD.has(this.props.name) && typeof window.__fincomReport === "function") { TOLD.add(this.props.name); window.__fincomReport(e, "the Tally page's " + this.props.name); } } catch (x) { /* */ }
  }
  componentDidUpdate(p) { if (this.state.e && p.v !== this.props.v) this.setState({ e: null }); }
  render() { return this.state.e ? (this.props.fallback ? this.props.fallback() : null) : this.props.children; }
}
// the table when its own drawing failed: every client and its Tally company, nothing else
function PlainTable() {
  let rows = []; try { rows = quickRows({}); } catch (e) { rows = []; }
  return <section className="tsm-card tsm-table" aria-label="Clients" data-tsm-table="" data-tsm-plain="" data-tsm-n={rows.length}>
    <div className="tsm-scroll"><table className="tsm-grid nocards"><thead><tr><th>Client</th><th>Linked to Tally?</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key} className="tsm-tr" data-tsm-row={r.client} data-tsm-kind="client"><td className="tsm-td tsm-client" data-label="Client">{r.client}</td><Cell k="c" label="Linked to Tally?" x={r.c} /></tr>)}</tbody></table></div>
  </section>;
}
// the firm's clients not read from FinCom's cloud yet in this tab (its first sync, Cloud.st.lastSync): never "No client yet"
// while they are on their way
const reading = () => typeof Cloud === "object" && Cloud.on && Cloud.on() && !(Cloud.st && Cloud.st.lastSync);
const readingWords = () => (Cloud.st && Cloud.st.error ? "FinCom’s cloud did not answer (" + String(Cloud.st.error).slice(0, 120) + "). Your clients show here as soon as it does. "
  : "Reading your clients from FinCom’s cloud… ");

// ---------- the table
const CLS = { [YES]: "yes", [NO]: "no", [NOTYET]: "notyet" };
function Word({ w }) { return <span className={"tsm-word " + (CLS[w] || "dash")} data-tsm-word={w}>{w}</span>; }
function Cell({ k, label, x, children }) {
  return <td className="tsm-td" data-tsm-col={k} data-label={label}><Word w={x.w} />{x.note && <div className="tsm-note" data-tsm-note="">{x.note}</div>}{children}</td>;
}
// Bring missing days (tally_fill_request): asked, with what happens and when; at once when no Tally can answer (never a
// silent queue: next-link-follow); a day already brought in the last 6 hours is not asked again (queued 0: said so); no
// Tally computer starts on it in 2 minutes: "Not started: <why>" (Said's watch: the fill's days done, or none waiting)
const fillNow = (cid, r) => { const b = bookSum(cid); return (b ? (bookFetch(cid, b.book) || {}).fill : null) || (r && r.fill) || null; };
async function bringDays(row, a) {
  const f0 = fillNow(row.cid), acks = ackSnap((bookSum(row.cid) || {}).book, ["fill", "check"]);
  const r = await rpc("tally_fill_request", { p_client: row.cid, p_days: daysOf(a.need) });
  askStatus(true);
  if (r && r.ok === false) return { text: "Not asked: " + String(r.error || "FinCom did not take it").replace(/[.\s]+$/, "") + ".", bad: true };
  const q = r && r.queued != null ? Number(r.queued) : -1, na = noAnswer(row.company);
  if (q === 0) return "Nothing new to ask: these days were brought from Tally in the last 6 hours.";
  if (na) return { text: "Queued. " + na, bad: true };
  // (started: more of the fill's days done than when asked; the fill counts the last day's fills, earlier ones too, so the
  // count the cloud gave with this answer, else the one before the press, is the base)
  // (a day Tally could not send is marked for a Day Book upload: handled, said as such, never "Not started")
  const b0 = (r && r.fill) || f0 || {}, base = Number(b0.done) || 0, up0 = Number(b0.upload) || 0;
  const fill = () => { const f = fillNow(row.cid); return !!f && (Number(f.done) > base || Number(f.upload) > up0); };
  const words = () => { const f = fillNow(row.cid) || {}, up = (Number(f.upload) || 0) - up0;
    return up > 0 ? nOfW(up, "day needs", "days need") + " a Day Book upload: Tally did not send " + (up === 1 ? "it" : "them") + "." + (Number(f.done) > base ? " The rest are coming in from Tally now." : "")
      : "Bringing the missing days from Tally now."; };
  return { text: "Asked: FinCom brings " + (q > 0 ? nOfW(q, "missing day", "missing days") : "the missing days") + " from Tally within a few minutes.",
    watch: { started: fill, cid: row.cid, company: row.company, startedText: words, acks } };
}
function Act({ row, main = false }) {
  useSaid();
  const [pick, setPick] = useState(false), a = row.act, fk = "fill:" + row.cid;
  if (!a) return null;
  if (!canWrite()) return null;
  let btn;
  if (a.kind === "connect") btn = <ConnectBtn r={row.r} co={row.co} label="Link" hook={{ "data-tsm-act": "connect" }} />;
  else if (a.kind === "choose" && row.best) btn = <ConnectBtn r={row.r} co={row.best} label="Link" hook={{ "data-tsm-act": "connect", "data-tsm-act-client": row.best.id }} />;
  else if (a.kind === "choose" || a.kind === "pickco") btn = <button type="button" className="btn primary" data-tsm-act={a.kind} onClick={() => setPick(!pick)} aria-expanded={pick}>{a.label}</button>;
  else if (a.kind === "upload") btn = <button type="button" className={"btn primary" + (main ? " tpt-btn" : "")} data-tsm-act="upload" data-tpt-main={main ? "upload" : undefined} onClick={() => { try { if (a.run) a.run(); else if (a.day && typeof Rec === "object" && Rec.uploadFrom) Rec.uploadFrom(row.cid, a.day); else openFromTally(row.cid); } catch (e) { say("up:" + row.cid, errWords(e), true); } }}>{a.label}</button>;
  else if (a.kind === "bring") btn = <button type="button" className={"btn primary" + (main ? " tpt-btn" : "")} data-tsm-act="bring" data-tpt-main={main ? "bring" : undefined} disabled={busyOf(fk)}
    onClick={() => press(fk, () => bringDays(row, a))}>{busyOf(fk) ? "Asking Tally…" : a.label}</button>;
  return <>{btn}{a.kind === "upload" && <Said k={"up:" + row.cid} hook="upload" />}
    {a.kind === "choose" && row.best && !pick && <div><button type="button" className="linkbtn tsm-small" data-tsm-act-choose="" onClick={() => setPick(true)}>Choose another client</button></div>}
    {pick && a.kind === "choose" && <div className="tsm-pick" data-tsm-row-pick=""><Pick r={row.r} co={null} pre={row.best ? row.best.id : ""} onClose={() => setPick(false)} /></div>}
    {pick && a.kind === "pickco" && <div className="tsm-pick" data-tsm-row-pick=""><ChangePick co={row.co} cur="" onClose={() => setPick(false)} /></div>}</>;
}
// ---------- opening balances (migration 138): one line under "Ledgers received?"; when Tally's differ, the owner's two
// choices (Use Tally's: only when dated the books' first day and they balance; Keep FinCom's) and See differences
function OpenLine({ row, list, onList }) {
  const o = row.open, [busy, setBusy] = useState(""), [err, setErr] = useState("");
  if (!o) return null;
  const go = (action) => async () => {
    const use = action === "use";
    const ok = await askConfirm({ title: use ? "Use Tally’s opening balances?" : "Keep FinCom’s opening balances?", ok: use ? "Use Tally’s" : "Keep FinCom’s",
      body: use ? "<p>" + o.s.n + " ledger" + (o.s.n === 1 ? "’s" : "s’") + " opening balances in FinCom change to Tally’s. Each change is kept in history. Nothing in Tally changes.</p>"
        : "<p>FinCom keeps its own opening balances, and Tally’s are set aside (kept, not deleted). Nothing in Tally changes.</p>" });
    if (!ok) return;
    setBusy(action); setErr("");
    try {
      const r = await openingsDecide(o.book, action);
      if (r && r.ok === false) setErr(String(r.error || "FinCom did not take it"));
      else { toast(use ? "Tally’s opening balances are used." : "FinCom’s opening balances are kept."); if (use) { LED_N.set(row.cid, null); try { await TCloud.status(row.cid, true); } catch (e) { /* the next read */ } } }
    } catch (e) { setErr("FinCom’s cloud did not answer; try again in a minute."); }
    finally { setBusy(""); openingsAll(true); }
  };
  return <div className={"tsm-open " + (o.state === "same" ? "same" : "warn")} data-tsm-open={o.state}>
    <div data-tsm-open-words="">{o.words}</div>
    {o.state === "differ" && <>
      {canWrite() && <div className="tsm-open-acts">
        <button type="button" className="btn small primary" data-tsm-open-use="" disabled={!!busy || !o.canUse} title={o.canUse ? undefined : o.why} onClick={go("use")}>{busy === "use" ? "Using…" : "Use Tally’s"}</button>
        <button type="button" className="btn small" data-tsm-open-keep="" disabled={!!busy} onClick={go("keep")}>{busy === "keep" ? "Keeping…" : "Keep FinCom’s"}</button></div>}
      {!o.canUse && o.why && <div className="tsm-note" data-tsm-open-why="">{o.why}</div>}
      <button type="button" className="linkbtn tsm-small" data-tsm-open-see="" aria-expanded={list} onClick={onList}>{list ? "Hide differences" : "See differences"}</button></>}
    {err && <div className="tsm-note bad" data-tsm-open-err="">{err}</div>}
  </div>;
}
const amt = (n) => n == null ? "—" : Math.abs(Number(n)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (Number(n) < 0 ? " Dr" : Number(n) > 0 ? " Cr" : "");
function Differences({ row }) {
  const [r, setR] = useState(null);
  useEffect(() => { let live = true; openingsDecide(row.open.book, "list").then((x) => { if (live) setR(x && x.ok ? x.book : { err: true }); }, () => { if (live) setR({ err: true }); });
    return () => { live = false; }; }, [row.open.book, row.open.s.held]);
  return <div className="tsm-diffs" data-tsm-diffs={row.cid} role="region" aria-label={"Opening balance differences of " + row.client}>
    {!r ? <p className="note">Reading the differences…</p> : r.err ? <p className="note bad">FinCom’s cloud did not answer; try again in a minute.</p> : <>
      <table className="data nocards tsm-diff-grid"><thead><tr><th>Ledger</th><th className="n">FinCom amount</th><th className="n">Tally amount</th><th className="n">Difference</th></tr></thead>
        <tbody>{(r.rows || []).map((x) => <tr key={x.ledger} data-tsm-diff={x.ledger}><td>{x.ledger}</td><td className="n">{amt(x.fincom)}</td><td className="n">{amt(x.tally)}</td><td className="n">{amt(x.diff)}</td></tr>)}</tbody></table>
      {Number(r.n) > (r.rows || []).length && <p className="note">{"Showing the largest " + (r.rows || []).length + " of " + r.n + "."}</p>}</>}
  </div>;
}
// the column's Connect (this user's own FinCom Bridge not heard from now): the local connect flow, its answer under the one
// pressed; Set it up (this user has no FinCom Bridge of their own): the pairing steps (step 1 of the guided box)
function LocalConnect() {
  const [mine, setMine] = useState(false), busy = OC.busy === "c";
  return <div><button type="button" className="linkbtn tsm-small" data-tsm-local-connect="" disabled={!!OC.busy} title={OC.busy ? "A connection check is running; the answer shows here in a moment." : undefined} onClick={() => { setMine(true); const o = ownState(); aimLocal(o.own); rescanLocal(); doConnect(false); }}>{busy && mine ? "Connecting…" : "Connect"}</button>
    {mine && !busy && OC.c && <Line r={OC.c} hook="tsm-local" />}</div>;
}
function SetUp() {
  return <div><button type="button" className="linkbtn tsm-small" data-tsm-setup="" onClick={() => { if (typeof openConnectTally === "function") openConnectTally(1, ""); window.scrollTo(0, 0); }}>Set it up</button></div>;
}
// next-tally-ledgers-button (04-Nov-2026): "Bring ledgers from Tally" under "Ledgers received?" (not yet, or stuck): the
// first sync again on a person's click (firstSync, now: the ledgers wake, and Update now through the cloud); it cannot
// run while no computer has the company open in Tally: the button is off and one plain line says so
function Bring({ row }) {
  const [busy, setBusy] = useState(false), l = row.l;
  if (!canWrite()) return null;
  const go = async () => { if (busy) return; setBusy(true); try { await firstSync(row.cid, row.company, { now: true }); } catch (e) { say("led:" + row.cid, errWords(e), true); } finally { setBusy(false); } };
  return <div className="tsm-bring" data-tsm-bring={row.cid}>
    <button type="button" className="btn small primary" data-tsm-bring-btn="" disabled={busy || !l.can} title={!l.can ? l.why || "Needs the company open in Tally" : undefined} onClick={go}>{busy ? "Asking Tally…" : "Bring ledgers from Tally"}</button>
    {!l.can && l.why && <div className="tsm-note" data-tsm-bring-why="">{l.why}</div>}<Said k={"led:" + row.cid} hook="ledgers" /></div>;
}
// ---------- next-tally-page-redesign (07-Nov-2026; the owner: "please make sure the reconnect button is in that table...
// currently it's very cluttered... can you redesign"; the approved design, tallydesign/Main, NotConnected, Phone): ONE
// table, "Clients and Tally". A row a client (linked, or open in Tally and not linked) and a row a company open in this
// login's own Tally that no client has. Client | Tally company | State (a dot and plain words; the reason on a second
// line) | Last entry | ONE button and ⋯ (Details, Unlink). The button:
//   linked, its company open (here or on any computer FinCom hears now): Update now (runPress: "Asking Tally…", the
//     ledgers' count, the result or why; never silent), Reading… while one runs;
//   linked, not connected now (its company open nowhere), or its ledgers stuck: Connect again (the shared look and Check
//     again, then a new read where the company is open), what is missing in plain words, a close name to link to;
//   a client whose company is open in this login's Tally: Connect; a company open here with a client of its name: Connect;
//   otherwise: Link (the client picker, + New client).
// Details holds what the table had before (linked, open now, ledgers, entries, what to do, the opening balances, the
// Day Book upload, Bring missing days) with the same marks. Rows that need the person are shaded. On a phone the rows are
// cards. Nothing new is asked of the bridge or of Tally.
const ISTD = (ms) => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10);
const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function lastWords(at) {
  const ms = Date.parse(at || ""); if (!ms) return "";
  const t = new Date(ms + 5.5 * 3600e3), hhmm = String(t.getUTCHours()).padStart(2, "0") + ":" + String(t.getUTCMinutes()).padStart(2, "0");
  return ISTD(ms) === ISTD(Date.now()) ? hhmm + " IST" : String(t.getUTCDate()).padStart(2, "0") + "-" + MONS[t.getUTCMonth()] + " " + hhmm;
}
// a bridge of the firm heard in the last 3 minutes (the cloud's beats)
function bridgesUp() { try { return bridgesOf().some((b) => b.at && Date.now() - Date.parse(b.at) < 3 * 60000); } catch (e) { return false; } }
// the companies open now in any Tally FinCom hears (this login's, another login's, another computer's)
function openAnywhere() { try { return new Set(companyRows().filter((r) => r.open).map((r) => coKey(r.company))); } catch (e) { return new Set(); } }
// what a row is: {kind, dot (ok | read | warn | idle | ring), say, why, btn (update | again | connect | link | act), need}
export function pageOf(row, seen) {
  if (row.kind === "company") return { kind: "company", dot: "idle", say: "Open in Tally · not linked", why: row.best ? "Client “" + row.best.name + "” matches" : "No client of its name yet", btn: row.best ? "connect" : "link" };
  if (row.c.w !== YES) {
    if (row.c.connect) return { kind: "open", dot: "idle", say: "Open in Tally · not linked", why: "", btn: "connect" };
    return { kind: "free", dot: "ring", say: "Not linked", why: row.found ? "Found in Tally: “" + shown(row.found) + "”" : "", btn: "link" };
  }
  const open = row.o.w === YES || seen.has(coKey(row.company));
  const stuck = row.l.w === NO;
  // next-tally-simple2: a bridge of the firm heard now, the company open nowhere: "Not open in Tally", Check again (open it
  // first); no bridge heard: "Not connected", Connect again
  if (!open) { const up = bridgesUp();
    return { kind: "away", dot: "warn", say: up ? "Not open in Tally" + (placeOf() === "laptop" ? " on the server" : "") : "Not connected", why: row.o.note && row.o.note !== "Checking…" ? row.o.note : "Company not open in Tally",
      btn: "again", label: up ? "Check again" : "Connect again", note: up ? "Open it in Tally first" : "", need: true }; }
  if (stuck) return { kind: "stuck", dot: "warn", say: "Not reading", why: row.l.note || "Nothing came from Tally", btn: "again", label: "Connect again", need: true };
  const reading = row.l.w === NOTYET || row.e.w === NOTYET;
  if (row.need || row.e.w === NO || (row.open && row.open.state === "differ")) return { kind: "need", dot: "warn", say: row.e.w === NO ? "Entries missing" : row.open && row.open.state === "differ" ? "Opening balances differ" : "Needs you", why: row.todo && /Bring ledgers from Tally/.test(row.todo) ? "Ledgers not in FinCom yet: press Update now." : row.todo && !/^Nothing/.test(row.todo) ? row.todo : row.e.note || "", btn: "update", need: true };
  if (reading) return { kind: "reading", dot: "ok", say: "Connected", why: row.l.w === NOTYET ? row.l.note || "" : row.e.note || "", btn: "update" };
  return { kind: "ok", dot: "ok", say: "Connected", why: "", btn: "update" };
}
// a row's one button: {main, label} (update | upload | bring | again | connect | link)
export function mainOf(row, pg) {
  if (pg.btn === "update" && row.act && (row.act.kind === "upload" || row.act.kind === "bring")) return { main: row.act.kind, label: row.act.label };
  if (pg.btn === "update") return { main: "update", label: "Update now" };
  if (pg.btn === "again") return { main: "again", label: pg.label || "Connect again" };
  if (pg.kind === "open" || (pg.kind === "company" && row.best)) return { main: "connect", label: "Connect" };
  return { main: "link", label: "Link" };
}
if (typeof globalThis === "object") globalThis.FCTallyMain = (row) => mainOf(row, pageOf(row, new Set()));
const DOT = { ok: "#17803D", read: "#1D5FD1", warn: "#B45309", idle: "#8A9099" };
function Dot({ k }) { return <span aria-hidden="true" className={"tpt-dot " + k} data-tpt-dot={k} />; }
// Connect again (the "Open in your Tally now" panel's, moved here): the shared look and Check again, a new read where the
// company is open; then what is missing in plain words and the step that is stuck; the company open under a close name
function Again({ row, x, cs, checkAgain, primary = true, label = "Connect again" }) {
  const [st, setSt] = useState(0), [said, setSaid] = useState("");
  // (next-buttons: never left on "Checking…"; what came of it always said)
  const go = async () => { if (st === 1) return; setSt(1); setSaid("");
    try { const w = await checkAll(checkAgain); setSaid(w); keepSaid(w);
      if (openAnywhere().has(coKey(row.company)) && !runBusy(row.cid)) runPress(row.cid, row.company, { entries: true }).catch(() => {}); }
    catch (e) { setSaid(errWords(e)); }
    finally { setSt(2); render(); } };
  return <><button type="button" className={"btn tpt-btn" + (primary ? " primary" : "")} data-tpt-main="again" data-tsm-away-again={row.cid} disabled={st === 1} onClick={go}>{st === 1 ? "Checking…" : label}</button>{said && st !== 1 && <div className="tsm-note" data-checked="" role="status">{said}</div>}</>;
}
Again.why = (row, cs) => {
  const step = cs && cs.now && cs.now.n <= 4 ? cs.now : null;
  const sw = stallWhy(row.cid, row.company), shut = /^Open .+ in Tally|is not open in Tally|^No computer with FinCom Bridge holds /.test(sw);
  const open = typeof openAnywhere === "function" && openAnywhere().has(coKey(row.company));
  const where = placeOf() === "pc" ? "in this Windows login" : "on the Tally computer";
  const notOpen = "“" + shown(row.company) + "” is not open in Tally. Open it in TallyPrime " + where + ": it connects by itself within a minute.";
  // (a stuck read of a company that IS open: the read's own reason, never "not open")
  return { step, text: step ? "Step " + step.n + " of 6 is not done: " + step.title + "." : sw && !shut ? sw : open ? (row.l && row.l.note) || sw || "Nothing came from Tally: press Connect again." : notOpen };
};
// the old table's cells, in Details (the same marks: data-tsm-col, data-tsm-word, the buttons of each)
function DCell({ k, label, x, children }) {
  return <div className="tsm-dcell" data-tsm-col={k} data-label={label}><Word w={x.w} />{x.note && <div className="tsm-note" data-tsm-note="">{x.note}</div>}{children}</div>;
}
function Details({ row, download, oneDl, main }) {
  const [list, setList] = useState(false), a = row.act;
  return <div className="tsm-details" data-tsm-details={row.cid || row.company}>
    <DCell k="c" label="Linked to Tally?" x={row.c} />
    <DCell k="o" label="Open in Tally right now?" x={row.o}>{row.o.say && row.o.say !== "blocked" && (row.o.say === "old" || !oneDl) && <div className="tsm-say-dl" data-tsm-o-say={row.o.say}>{download}</div>}{row.o.connect && row.o.say !== "old" && <LocalConnect />}{row.o.setup && <SetUp />}</DCell>
    <DCell k="l" label="Ledgers received?" x={row.l}>
      {row.l.change && <div className="tsm-change" data-tsm-lchange="">{row.l.change}</div>}
      <OpenLine row={row} list={list} onList={() => setList(!list)} />
      {row.l.bring && <Bring row={row} />}
      {row.l.link && <div><button type="button" className="linkbtn tsm-small" data-tsm-ledgers={row.cid} onClick={() => set({ client: row.cid })}>See ledgers</button></div>}
    </DCell>
    <DCell k="e" label="All entries received?" x={row.e}>
      {row.e.pct > 0 && <div className="tsm-bar" role="progressbar" aria-label={"Entries of " + row.client + " received"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.e.pct} data-tsm-pct={row.e.pct}><i style={{ width: row.e.pct + "%" }} /></div>}
    </DCell>
    <div className="tsm-dcell" data-tsm-col="do" data-label="What to do">
      {a && (a.kind === "upload" || a.kind === "bring") && main !== a.kind && <Act row={row} />}
      {row.todo && <div className="tsm-todo" data-tsm-todo="">{row.todo}</div>}
      {row.upload && <div><button type="button" className="linkbtn tsm-small" data-tsm-upload={row.cid} onClick={() => openFromTally(row.cid)}>or upload the file yourself</button></div>}</div>
    {list && row.open && row.open.state === "differ" && <Differences row={row} />}
  </div>;
}
// next-tally-simple2 (the owner's approved "Tally simple page v4"): More ▾ opens ONE light row under the client's row (one
// open at a time): Entries in FinCom: <range> · Bring another year · Upload a Day Book file (the Day Book drop box,
// unchanged) · Update history · Pause / Resume / Stop while Bring books runs · Answers (the old table's answers) · Unlink.
// Each part opens inline in that row; nothing is read for it until it is opened
const SHOW_UPDATE = ["books", "upload", "bring", "masters", "turnon"];
const OFF_NOTE = "Reading older entries is off for the computer that has this company: an owner can turn it on";
function MoreRow({ row, linked, e, main, det, running, download, oneDl, onAnswers }) {
  useSaid();
  const [show, setShow] = useState(""), flip = (k) => setShow(show === k ? "" : k), p = e && e.p && !e.p.done ? e.p : null, range = linked ? rangeWords(row.cid) : "";
  const ex = (k) => (show === k ? "true" : "false");
  return <div className="tpt-light" data-tpt-light-in="">
    <div className="tpt-light-links">
      {linked && <span className="tpt-range" data-tpt-range="">{"Entries in FinCom: " + (range || "none yet")}</span>}
      {linked && main !== "masters" && <BringMasters row={row} link />}
      {linked && canWrite() && SHOW_UPDATE.includes(main) && !running && <button type="button" className="linkbtn" data-tpt-update-more={row.cid} onClick={() => runPress(row.cid, row.company, { entries: true }).catch(() => {}).then(() => render())}>Update now</button>}
      {linked && canWrite() && <button type="button" className="linkbtn" data-tpg-another-year={row.cid} aria-expanded={ex("year")} onClick={() => flip("year")}>Bring another year</button>}
      {linked && <button type="button" className="linkbtn" data-tpt-daybook={row.cid} aria-expanded={ex("daybook")} onClick={() => flip("daybook")}>Upload a Day Book file</button>}
      {linked && <button type="button" className="linkbtn" data-tpt-history={row.cid} aria-expanded={ex("history")} onClick={() => flip("history")}>Update history</button>}
      {linked && p && <PullButtons e={e} only={["pause", "resume", "stop"].filter((k) => k !== main)} link />}
      <button type="button" className="linkbtn" data-tpt-details="" aria-expanded={det ? "true" : "false"} onClick={onAnswers}>{det ? "Hide answers" : "Answers"}</button>
      {linked && canWrite() && <button type="button" className="linkbtn tpt-unlink" data-tpt-unlink="" title="The client stays; only its link to Tally goes" disabled={busyOf("unlink:" + row.cid)}
        onClick={() => press("unlink:" + row.cid, async () => { if (typeof TCloud === "object") TCloud.linkErr = ""; const ok = await unlink({ company: row.company, client: row.cid });
          return ok ? "Unlinked. The client stays in FinCom." : ok === false ? { text: "Not unlinked: " + String((typeof TCloud === "object" && TCloud.linkErr) || "FinCom did not take it. Try again in a minute").replace(/[.\s]+$/, "") + ".", bad: true } : ""; }, 60000)}>Unlink</button>}
    </div>
    {row.cid && <Said k={"unlink:" + row.cid} hook="unlink" />}
    {show === "year" && <div className="tpt-light-part" data-tpt-part="year"><OlderEntries cid={row.cid} say /></div>}
    {show === "daybook" && <div className="tpt-light-part" data-tpt-part="daybook"><DayBookDrop cid={row.cid} /></div>}
    {show === "history" && <div className="tpt-light-part" data-tpt-part="history"><History row={row} /></div>}
    {det && <Details row={row} download={download} oneDl={oneDl} main={main} />}
  </div>;
}
const READING_WHY = "FinCom is reading this company from Tally now; the button comes back when it is done.";
function Row({ row, download, oneDl, seen, cs, x, checkAgain }) {
  const ui = UI(), [, tick] = useState(0), key = row.cid || row.company;
  const det = ui.details === "all" || !!(ui.details || {})[key], more = ui.more === key || det;
  // a first sync going: read every 10 seconds (its count, done, or stuck after 3 minutes with the button)
  useEffect(() => { if (!row.l || !row.l.syncing) return; const t = setInterval(() => syncPoll(row.cid), 10000); return () => clearInterval(t); }, [row.cid, row.l && row.l.syncing]);
  const pg = pageOf(row, seen), linked = row.kind === "client" && row.c.w === YES;
  // this client's Update now: its words each second while it is on its way (Asking Tally… → the count → the result)
  const rw = linked ? runWords(row.cid, row.company) : null, live = !!(rw && rw.phase !== "done" && rw.phase !== "why");
  useEffect(() => { if (!live) return; const t = setInterval(() => tick((k) => k + 1), 1000); return () => clearInterval(t); }, [live]);
  useEffect(() => { if (linked) runSettle(row.cid, row.company, () => tick((k) => k + 1)); });
  const sx = (S.tcoSync || {})[row.cid], runningRead = !!(sx && !sx.end && !sx.err && !sx.late) || runBusy(row.cid);
  const label = row.client || shown(row.company), name = row.kind === "client" ? row.client : row.company;
  const m = linked ? mastersOf(row.cid, row.company) : null, e = linked ? entriesOf(row.cid, m, row.last) : null, p = e && e.p && !e.p.done && e.b && e.b.book ? e.p : null;
  // the row's ONE main button, chosen by its state; a short note under it when needed
  const mm = mainOf(row, pg).main;
  // (the owner's Fingate row, 08-Nov-2026: "Not brought yet" with Upload Day Book as its button) the upload stays the
  // button wherever it is the only way: held lines, a held day, days missing with no computer set to read older entries.
  // One exception: a computer has the company with that reading turned off; an owner can turn it on (Turn on for this
  // computer is the button); anyone else keeps the upload and is told an owner can
  const off = mm === "upload" && !!(row.act && row.act.off);
  let btn = null, main = "", note = "";
  if (!canWrite()) { btn = null; if (row.kind === "client" || row.kind === "company") note = VIEW_ONLY; }
  else if (off && owner() && bookSum(row.cid)) { btn = <TurnOn b={bookSum(row.cid)} main />; main = "turnon"; }
  // (a row whose own action is the Day Book upload or the missing days' fetch: that action, in its words)
  else if (mm === "upload" || mm === "bring") { btn = <Act row={row} main />; main = mm; if (off) note = OFF_NOTE; }
  else if (pg.btn === "again") { btn = <Again row={row} x={x} cs={cs} checkAgain={checkAgain} label={pg.label} />; main = "again"; note = pg.note || ""; }
  // masters read first, entries only waiting after them: Reading… (Pause and Stop under More)
  else if (pg.btn === "update" && p && e.st === "after") { btn = <button type="button" className="btn tpt-btn" data-tpt-main="reading" disabled title={READING_WHY}>Reading…</button>; main = "reading"; }
  // Bring books going or paused: Pause / Resume (Stop under More)
  else if (pg.btn === "update" && p && (p.state === "going" || p.state === "paused")) { btn = <PullButtons e={e} only={[p.state === "going" ? "pause" : "resume"]} main />; main = p.state === "going" ? "pause" : "resume"; }
  // masters not in FinCom yet: Bring masters (the masters' read; entries follow by themselves). Only for a book FinCom
  // knows with no ledgers: a client whose book is not known yet keeps Update now, which brings them too
  else if (pg.btn === "update" && linked && !runningRead && ledBook(row.cid) && !ledgersHeld(row.cid)) { btn = <BringMasters row={row} />; main = "masters"; if (!(row.o && row.o.w === YES) && !(readWhere(row.company) || {}).reader) note = "Needs the company open in Tally"; }
  else if (pg.btn === "update" && runningRead) { btn = <button type="button" className="btn tpt-btn" data-tpt-main="reading" disabled title={READING_WHY}>Reading…</button>; main = "reading"; }
  // this year's days missing in FinCom, or Bring books stopped: Bring books (again)
  else if (pg.btn === "update" && linked && e.b && e.b.book && (e.st === "behind" || e.st === "stopped" || (e.st === "none" && m.st === "done"))) { btn = <BringBooks row={row} e={e} />; main = "books"; }
  else if (pg.btn === "update") { btn = <button type="button" className="btn tpt-btn" data-tpt-main="update" data-tsm-update={row.cid} onClick={() => runPress(row.cid, row.company, { entries: true }).catch(() => {}).then(() => tick((k) => k + 1))}>Update now</button>; main = "update"; }
  else if (pg.kind === "open") { btn = <ConnectBtn r={row.r} co={row.co} label="Connect" hook={{ "data-tsm-connect": row.cid, "data-tpt-main": "connect" }} />; main = "connect"; }
  else if (pg.kind === "company" && row.best) { btn = <ConnectBtn r={row.r} co={row.best} label="Connect" hook={{ "data-tsm-act": "connect", "data-tsm-act-client": row.best.id, "data-tpt-main": "connect" }} />; main = "connect"; }
  else { btn = <ActLink row={row} />; main = "link"; }
  const aw = pg.btn === "again" ? Again.why(row, cs) : null;
  const near = pg.kind === "away" && x ? (x.unlinked || []).find((u) => coKey(u.company) !== coKey(row.company) && (baseKey(u.company) === baseKey(row.company) || !!(globalThis.LinkRec && LinkRec.same && LinkRec.same(u.company, row.company)))) : null;
  // (a client being read: its Masters and Entries cells say how far, the read's own words too; not a second time here.
  // The read's result, or why it was not done, stays here)
  const why = rw && (rw.phase === "done" || rw.phase === "why") ? rw.text : rw ? "" : aw ? aw.text : pg.kind === "reading" ? "" : pg.why;
  // (held lines or a held day: what to do about them stays in view while a read runs, and after it)
  const held = row.act && row.act.held && row.todo && row.todo !== why ? row.todo : "";
  const co = shown(row.company);
  const toggle = () => set(more ? { more: "", details: ui.details === "all" ? "all" : Object.assign({}, ui.details || {}, { [key]: false }) } : { more: key, details: ui.details === "all" ? "all" : {} });
  return <><tr className={"tsm-tr tpt-tr" + (pg.need ? " tpt-need" : "") + (more ? " tpt-open" : "") + (row.focus ? " tsm-focus" : "")} data-tsm-row={name} data-tsm-kind={row.kind} data-tsm-cid={row.cid || undefined}
    data-tpt-kind={pg.kind} data-tsm-need={row.need ? "" : undefined} data-tsm-fine={row.fine ? "" : undefined} data-focus={row.focus ? "" : undefined}>
    <td className="tpt-td tpt-client" data-tsm-col="client" data-label="Client">
      {row.kind === "client" ? <b className="tsm-client-name" data-tsm-client={row.cid}>{row.client}</b> : <span className="tsm-client-none">Not chosen yet</span>}
      <span className="tpt-co-line">{co ? <>{"Tally: "}<span className="tpt-co" data-tpt-co="">{co}</span></> : <span className="tpt-co" data-tpt-co="" data-tpt-nolink="">Not linked</span>}</span>
      <span className="tpt-state">
        <span className={"tpt-say " + pg.dot} data-tpt-state={pg.kind}><Dot k={pg.dot} />{rw && rw.phase !== "done" && rw.phase !== "why" ? (rw.phase === "waiting" ? "Waiting for Tally" : "Updating") : pg.say}</span>
        {why && <span className={"tpt-why" + (rw && (rw.phase === "why" || rw.phase === "waiting") ? " bad" : "")} data-tpt-why={rw ? "run-" + rw.phase : aw ? (aw.step ? "step" + aw.step.n : "why") : ""} role={rw ? "status" : undefined}>{why}
          {aw && aw.step && <>{" "}<button type="button" className="linkbtn" data-tsm-away-steps={aw.step.n} onClick={() => { set({ open: true }); window.scrollTo(0, 0); }}>See step {aw.step.n}</button></>}</span>}
        {held && <span className="tpt-why" data-tpt-held="">{held}</span>}
        {/* next-link-follow (migration 146): where the book is read from, or the linked computer offline with the company open nowhere */}
        {row.where && row.where.text !== why && <span className={"tpt-why" + (row.where.kind === "offline" ? " bad" : "")} data-tpt-where={row.where.kind}>{row.where.text}</span>}
        {near && canWrite() && <span className="tpt-why" data-tsm-away-near={near.company}>{"“" + shown(near.company) + "” is open in your Tally, a close name. "}
          <ConnectBtn r={near} co={row.co} label={"Link " + row.client + " to it"} primary={false} hook={{ "data-tsm-away-relink": row.cid }} /></span>}
      </span>
    </td>
    <td className="tpt-td tpt-masters" data-label="Masters">{linked ? <MastersCell row={row} /> : <span className="tpg-sub">—</span>}</td>
    <td className="tpt-td tpt-entries" data-label="Entries">{linked ? <EntriesCell row={row} /> : <span className="tpg-sub">—</span>}</td>
    <td className="tpt-td tpt-act" data-label="">
      <div className="tpt-act-in">{btn}{note && <span className="tpt-note" data-tpt-note="">{note}</span>}
        {/* next-buttons: what came of Bring books / Bring missing days, kept with the row whatever its button turns into */}
        {/* (drawn only once pressed: a long list keeps its drawing light; a press redraws the page) */}
        {linked && (saidOf("books:" + row.cid) || busyOf("books:" + row.cid)) && <Said k={"books:" + row.cid} hook="books" />}
        {linked && (saidOf("fill:" + row.cid) || busyOf("fill:" + row.cid)) && <Said k={"fill:" + row.cid} hook="bring" />}
        {linked && TURN_FROM["turnon:" + row.cid] === "row" && (saidOf("turnon:" + row.cid) || busyOf("turnon:" + row.cid)) && <Said k={"turnon:" + row.cid} hook="turnon" />}
        <button type="button" className="linkbtn tpt-more-btn" data-tpt-open={key} aria-expanded={more ? "true" : "false"} aria-label={(more ? "Less for " : "More for ") + label} onClick={toggle}>{more ? "Less ▴" : "More ▾"}</button></div>
    </td>
  </tr>
    {more && <tr className={"tpt-light-tr" + (pg.need ? " tpt-need" : "")} data-tpt-light={key} data-tpt-light-of={name}><td colSpan={4} className="tpt-light-td">
      <MoreRow row={row} linked={linked} e={e} main={main} det={det} running={runningRead} download={download} oneDl={oneDl}
        onAnswers={() => set({ details: ui.details === "all" ? "all" : Object.assign({}, ui.details || {}, { [key]: !det }) })} /></td></tr>}</>;
}
// Link (the old row's action: the client picker or the company picker), one button
function ActLink({ row }) {
  const [pick, setPick] = useState(false), a = row.act || {};
  if (!canWrite()) return null;
  if (a.kind === "connect") return <ConnectBtn r={row.r} co={row.co} label="Link" primary={false} hook={{ "data-tsm-act": "connect", "data-tpt-main": "link" }} />;
  const kind = a.kind === "pickco" ? "pickco" : "choose";
  return <span className="tpt-link"><button type="button" className="btn tpt-btn primary" data-tsm-act={kind} data-tpt-main="link" onClick={() => setPick(!pick)} aria-expanded={pick}>Link</button>
    {pick && <div className="tsm-pick" data-tsm-row-pick="">{kind === "pickco" ? <ChangePick co={row.co} cur="" onClose={() => setPick(false)} /> : <Pick r={row.r} co={null} pre={row.best ? row.best.id : ""} onClose={() => setPick(false)} />}</div>}</span>;
}
// next-tally-simple2: "Clients · N", the note that masters come first, then ONE table: Client · Tally company | Masters |
// Entries | Action (no filter chips; the search only for a long list)
// next-tally-filters (the owner, 09-Nov-2026: "there should be filters in the tally companies list.. in column also... and
// with regard to statuses also"): a filter at the head of each column: the row's state (Client · Tally company), Masters,
// Entries; each choice with its count (of the rows the search keeps), a choice with none greyed. They add up with the
// search; Clear filters (and No client matches' Show all) sets them back. Kept for the tab (S.tsm), never stored
const F_ST = [["all", "All states"], ["need", "Needs attention"], ["ok", "Connected"], ["reading", "Reading now"], ["away", "Not open in Tally"], ["free", "Not linked"]];
const F_MA = [["all", "All masters"], ["done", "Up to date"], ["reading", "Reading or waiting"], ["why", "Not done"], ["none", "Not brought yet"]];
const F_EN = [["all", "All entries"], ["up", "Up to date"], ["going", "Bringing"], ["held", "Paused or stopped"], ["behind", "Days to bring"], ["none", "Not brought yet"]];
const isLinked = (r) => r.kind === "client" && r.c.w === YES;
function tagsOf(r, seen) {
  const p = pageOf(r, seen), s = [];
  if (p.need) s.push("need");
  if (p.kind === "ok") s.push("ok");
  if (p.kind === "reading" || (isLinked(r) && runBusy(r.cid))) s.push("reading");
  if (p.kind === "away") s.push("away");
  if (p.kind === "free" || p.kind === "open" || p.kind === "company") s.push("free");
  if (!isLinked(r)) return { s, m: "", e: "" };
  const ms = mastersOf(r.cid, r.company), es = entriesOf(r.cid, ms, r.last).st;
  return { s, m: ms.st === "waiting" ? "reading" : ms.st,
    e: es === "uptodate" || es === "done" ? "up" : es === "after" || es === "going" ? "going" : es === "paused" || es === "stopped" ? "held" : es };
}
function FSel({ k, opts, n, label }) {
  const v = UI()[k] || "all";
  return <select className={"tpt-fsel" + (v !== "all" ? " on" : "")} data-tpt-filter={k} aria-label={"Filter by " + label} value={v} onChange={(ev) => set({ [k]: ev.target.value })}>
    {opts.map(([o, w]) => <option key={o} value={o} disabled={o !== "all" && o !== v && !n[o]}>{o === "all" ? w : w + " (" + (n[o] || 0) + ")"}</option>)}</select>;
}
const NO_F = { fst: "all", fma: "all", fen: "all" };
function Table({ rows, download, oneDl, cs, x, checkAgain }) {
  const ui = UI(), seen = openAnywhere(), fst = ui.fst || "all", fma = ui.fma || "all", fen = ui.fen || "all";
  const tg = rows.filter((r) => matches(r, ui.q)).map((r) => Object.assign({ r }, tagsOf(r, seen)));
  const cnt = (f) => tg.reduce((n, t) => { [].concat(f(t)).forEach((k) => { if (k) n[k] = (n[k] || 0) + 1; }); return n; }, {});
  const nS = cnt((t) => t.s), nM = cnt((t) => t.m), nE = cnt((t) => t.e), on = fst !== "all" || fma !== "all" || fen !== "all";
  const list = tg.filter((t) => (fst === "all" || t.s.includes(fst)) && (fma === "all" || t.m === fma) && (fen === "all" || t.e === fen)).map((t) => t.r);
  const w = headWords(rows), nc = rows.filter((r) => r.kind === "client").length;
  return <section className="tpt-sec" aria-label="Clients" data-tsm-table="" data-tsm-n={rows.length}>
    <div className="tpt-head"><h3 className="tpt-title" data-tpt-title="">{"Clients · " + nc}</h3><span className="tsm-note" data-tpt-say="">Masters (ledgers &amp; groups) always come first, then entries</span>
      <span className="sr-only" data-tsm-say=""><b className="tsm-fine">{w.fine}</b>{" "}<b className="tsm-need" data-tsm-need-n={rows.filter((r) => r.need).length}>{w.need}</b></span></div>
    {rows.length > 6 && <label className="tsm-search"><span className="sr-only">Search client</span>
      <input type="search" data-tsm-q="" placeholder="Search client or Tally company" aria-label="Search client or Tally company" value={ui.q} onChange={(ev) => set({ q: ev.target.value })} /></label>}
    {on && <div className="tsm-note tpt-fnote" data-tpt-filtered={list.length}>{"Showing " + list.length + " of " + rows.length + " "}
      <button type="button" className="linkbtn" data-tpt-fclear="" onClick={() => set(NO_F)}>Clear filters</button></div>}
    <div className="tsm-card tpt">
      {!list.length && <div className="tsm-none" data-tsm-none={rows.length ? "match" : reading() ? "reading" : "none"}>{rows.length ? "No client matches. " : reading() ? readingWords() : "No client yet. "}
        {rows.length > 0 && <button type="button" className="linkbtn" data-tsm-showall="" onClick={() => set(Object.assign({ q: "" }, NO_F))}>Show all</button>}</div>}
      {(list.length > 0 || (rows.length > 0 && on)) && <div className="tsm-scroll"><table className="tpt-grid nocards">
        <thead><tr><th>Client · Tally company<FSel k="fst" opts={F_ST} n={nS} label="state" /></th><th>Masters<FSel k="fma" opts={F_MA} n={nM} label="masters" /></th>
          <th>Entries<FSel k="fen" opts={F_EN} n={nE} label="entries" /></th><th className="tpt-th-act">Action</th></tr></thead>
        <tbody>{list.map((r) => <Row key={r.key} row={r} download={download} oneDl={oneDl} seen={seen} cs={cs} x={x} checkAgain={checkAgain} />)}</tbody></table></div>}
    </div>
  </section>;
}
// the foot: one line, and Advanced (for support) (the page's own fold, below: opened and brought into view)
function Foot() {
  // (next-buttons: the run_tally_clicks dead button: pressed while already open it did nothing visible; now it closes it)
  const open = !!(S.tallyMore || {}).support;
  return <div className="tpt-foot" data-tpt-foot=""><span className="tsm-note">One main button per client. More ▾ opens the rest.</span>
    <button type="button" className="linkbtn" data-tpt-advanced="" aria-expanded={open ? "true" : "false"} onClick={() => { S.tallyMore = Object.assign({}, S.tallyMore || {}, { support: !open }); render();
      if (!open) setTimeout(() => { const el = document.querySelector("#app [data-for-support]"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "start", behavior: "smooth" }); }, 60); }}>{open ? "Hide advanced (for support)" : "Advanced (for support)"}</button></div>;
}
// ---------- the top: this login's Tally in one line, with Check again (and See the 6 steps while a step is not done)
function Top({ cs, own, rows, checkAgain, ready, shown, beat }) {
  // the steps' toggle follows what is shown (also steps asked for elsewhere, Connect another computer): hiding them ends that ask
  const steps = () => shown ? (S.tallyGuide = {}, set({ open: false, again: 0 })) : set({ open: true });
  const [ck, setCk] = useState(false), said = saidNow();
  // Check again does what a refresh does for the connection (checkAll), then says what it found (the steps' too: UI().said)
  const again = () => { setCk(true); checkAll(checkAgain).then(keepSaid).finally(() => { setCk(false); render(); }); };
  const T = ownTallys(own), ok = T.tallys.filter((t) => t.ok), off = T.tallys.filter((t) => !t.ok), names = (own && own.names) || new Map();
  const login = cs.mode === "login", down = login && !!cs.now && cs.now.n <= 4;
  const last = rows.filter((r) => r.kind === "client" && r.c.w === YES && r.o.w === YES && r.last).map((r) => r.last).sort().pop() || "";
  const office = cs.mode === "laptop" ? bridgesOf().filter((b) => b.at && Date.now() - Date.parse(b.at) < 3 * 60000) : [];
  const officeK = office.filter(tallyOpenOn).length;
  const officeOpen = new Set([].concat(...office.map((b) => b.open)).map(coKey)).size;
  const lastAny = rows.filter((r) => r.kind === "client" && r.c.w === YES && r.last).map((r) => r.last).sort().pop() || "";
  const o = own || {}, far = o.state === "ok" && o.far, kw = login ? keepWaitWords((((o.own || {}).beat) || {}).keepWait) : "";
  let dot, title, sub;
  // bridge 2.5.10: every bridge of the firm silent over 10 minutes (lib/bridgeStop.js): said first; one back by itself
  let stop = null, back = null;
  try { const dv = tallyDevs(); stop = bridgeStopped(dv); back = stop ? null : bridgeBack(dv); } catch (e) { stop = back = null; }
  if (!ready) { dot = "idle"; title = "Looking for your Tally…"; sub = ""; }
  else if (stop && !(cs.mode === "laptop" && office.length)) { dot = "warn"; title = stop.title; sub = stop.todo; }
  // a computer with no bridge of its own (a laptop, a Mac): the office's Tally through the firm's bridges heard now
  // (counted by Tally open there: bridges heard with Tally closed are not "connected", amber)
  else if (cs.mode === "laptop" && office.length && !officeK) { const w = office.map((x) => offSay(x.beat)).find(Boolean); dot = "warn";
    // (bridge 2.5.11: a Tally open there that takes no connection is said so, with the bridge's words)
    title = w ? "The office Tally is open but takes no connection" : "The office Tally is not open";
    sub = w || "Open TallyPrime and the company on the computer or server where FinCom Bridge runs."; }
  else if (cs.mode === "laptop" && office.length) { dot = "ok"; title = "Connected through the office Tally";
    sub = [nOfW(rows.filter((r) => r.kind === "client" && r.c.w === YES).length, "client linked", "clients linked"), nOfW(officeOpen, "company open", "companies open"), lastAny ? "last entry " + lastWords(lastAny) : ""].filter(Boolean).join(" · "); }
  else if (cs.mode === "laptop") { dot = "warn"; title = "No FinCom Bridge is connected"; sub = "Open FinCom on the computer or server where TallyPrime runs, and install FinCom Bridge there."; }
  else if (cs.mode === "error" || !login) { dot = "idle"; title = "Tally"; sub = "The state could not be worked out just now."; }
  else if (down) { dot = "warn"; title = "Not connected yet: step " + cs.now.n + " of 6"; sub = "Do the step below, then press Check again. Nothing else is needed."; }
  else { dot = "ok"; title = "Connected to Tally";
    sub = [ok.length === 1 ? "TallyPrime on port " + ok[0].port : ok.length > 1 ? ok.length + " Tallys (ports " + ok.map((t) => t.port).join(", ") + ")" : "TallyPrime",
      nOfW(names.size, "company open", "companies open"), last ? "last entry " + lastWords(last) : ""].filter(Boolean).join(" · "); }
  const many = !down && login && (T.tallys.length > 1 || T.unknown.length > 0 && ok.length > 1);
  return <section className="tsm-card tpt-top" aria-label="Your Tally" data-tsm-top={down ? "down" : login ? "up" : cs.mode} data-tsm-head="" data-tsm-stopped={stop ? "" : undefined}>
    <div className="tpt-top-main"><Dot k={dot} /><div className="tpt-top-words"><div className="tpt-top-title" data-tsm-top-title="">{title}</div>
      {sub && <div className="tsm-note" data-tsm-top-sub="">{sub}</div>}
      {many && T.tallys.map((t) => <div key={t.port} className="tsm-note" data-tsm-top-tally={t.port}>{"port " + t.port + " · " + t.state + (t.ok ? " · " + nOfW(t.names.length, "company", "companies") : cs.steps[2] && cs.steps[2].state !== "done" ? " · what to do: step 3" : "")}</div>)}
      {!many && off.length > 0 && !down && off.map((t) => <div key={t.port} className="tsm-note" data-tsm-top-tally={t.port}>{"port " + t.port + " · " + t.state}</div>)}
      {ready && far && <div className="tsm-note" data-tsm-bridge-say="far">{"This browser does not reach FinCom Bridge in this Windows login now. Shown: what that bridge last sent to FinCom’s cloud." + (o.far === "blocked" ? " " + BLOCKED : "")}</div>}
      {ready && o.unsure && <div className="tsm-note" data-tsm-unsure="">Showing your bridge (not confirmed).</div>}
      {/* next-tally-progress (the owner's Mac): this computer's own check, never holding the page; the rest is the cloud's */}
      {cs.mode === "laptop" && <div className="tsm-note" data-tsm-nobridge="">{LOCALB.busy ? "Looking for a bridge on this computer…" : "No bridge on this computer"}</div>}
      {/* FinCom Bridge 2.5.5: why this login's bridge waits to read (its own words); an older bridge sends none */}
      {kw && <div className="tsm-note tpt-wait" data-tsm-top-wait="" role="status">{kw}</div>}
      {ready && stop && title !== stop.title && <div className="tsm-note bad" data-tsm-top-stopped="" role="status">{stop.title + ". " + stop.todo}</div>}
      {ready && back && <div className="tsm-note" data-tsm-top-back={back.why} role="status">{back.text}</div>}
      {said && !ck && <div className="tsm-note" data-tsm-top-checked="" data-checked="" role="status">{said + (down ? " Not connected yet: step " + cs.now.n + " of 6." : "")}</div>}
      {/* next-tally-simple2: a posting this computer's bridge holds (StuckJobs: Stop posting), one line in this card */}
      <PostingWait beat={beat} hook="panel" /></div></div>
    <span className="tpt-top-acts">
      {/* next-tally-simple2: How to connect opens the six steps under this card */}
      {cs.mode === "laptop" && office.length > 0 && <button type="button" className="linkbtn" data-tsm-steps-link="laptop" aria-expanded={shown ? "true" : "false"} onClick={steps}>{shown ? "Hide how to connect" : "How to connect"}</button>}
      {login && !down && <button type="button" className="linkbtn" data-tsm-steps-link="" aria-expanded={shown ? "true" : "false"} onClick={steps}>{shown ? "Hide how to connect" : "How to connect"}</button>}
      <button type="button" className="btn tpt-btn" data-tsm-top-check="" disabled={ck} onClick={again}>{ck ? "Checking…" : "Check again"}</button></span>
  </section>;
}
// not connected and no client in the table: the short card (the design's "Clients and Tally" under the steps)
function ShortCard({ rows, cs }) {
  const linked = rows.filter((r) => r.kind === "client" && r.c.w === YES).length;
  return <section className="tsm-card tpt-short" data-tsm-short=""><b>Clients</b>
    <div className="tsm-note">{"Your clients and their Tally companies show here once step " + (cs.now ? cs.now.n : 4) + " is done." + (linked ? " " + nOfW(linked, "client is", "clients are") + " already linked; they reconnect by themselves." : "")}</div></section>;
}
// for Advanced (for support): the day check of every client, and the computers in one line (were the page's header and foot)
export function SupportTools({ checkAgain, pcs, download, sha }) {
  // (the rows as the page last worked them out: rowsFor would replace the page's own options, its focused client)
  const rows = rowsLast(), on = checking();
  let st = null; try { st = bridgeStopped(tallyDevs()); } catch (e) { st = null; }
  return <div className="tsm-support" data-tsm-support="">
    {st && <div className="tsm-note bad" data-tsm-support-stopped="">{stoppedWhere(st, pcRawOf(st.dev))}</div>}
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}><button type="button" className="btn small" data-tsm-check="" disabled={on} onClick={() => checkTallyNow(rows, checkAgain)}>{on ? "Checking Tally…" : "Check every client for changes in Tally"}</button>
      <span className="note">Each linked client’s entries of this year checked against Tally, one day at a time.</span></div>
    <Said k="checkall" hook="check-all" />
    {pcs && <Computers pcs={pcs} download={download} sha={sha} />}
  </div>;
}

// ---------- the computers, one line, no names
function Computers({ pcs, download, sha }) {
  const { connected, away, older } = pcs;
  return <section className="tsm-card tsm-pcs" aria-label="Computers" data-tsm-pcs={connected} data-tsm-older={older || undefined}>
    <div className="tsm-pcs-words">{"Computers with Tally: "}<b>{connected ? connected + " connected" : "none connected"}</b>{"."}
      {away > 0 && <span data-tsm-away={away}>{" " + (away === 1 ? "One is" : away + " are") + " not connected now."}</span>}
      {older > 0 && <span data-tsm-older-say="">{" " + (older === 1 ? "One has" : older + " have") + " an older FinCom Bridge."}</span>}</div>
    {older > 0 && <div className="tsm-pcs-acts">{download}{sha && <div className="note tsm-sha">Fingerprint (SHA-256): <code data-tsm-sha="">{sha}</code></div>}</div>}
  </section>;
}

// the page above For support. installed: a bridge of the firm heard this week (the guided box counts it only when this user
// has a bridge of their own: ownState); pcs: {connected, away, older};
// download: the one Download FinCom Bridge (this site's latest.json); connectPanel: step 1's Download, Open it, Type its code
export default function SimpleTally({ installed, ready = true, pcs, download, sha, checkAgain, connectPanel, latest = "" }) {
  const ui = UI(), g = S.tallyGuide || {}, now = Date.now();
  const focus = g.cid && g.at && now - g.at < GUIDE_MS ? g.cid : (S.tallyFocus || "");
  // next-tally-own-login: everything above For support is this user's own FinCom Bridge and Tally (ownState), never another
  // Windows login's on the same server
  let own; try { own = ownState(); } catch (e) { own = { state: "none" }; }
  // next-tally-table: the rows as last worked out (lib/tallySimple.js rowsFor: off the drawing, a few clients at a time),
  // at the very first drawing each client with its Tally company at once; the rest fills in as it is worked out
  const R = rowsFor({ focus }), rows = R.rows, x = R.extra || { unlinked: [], open: null, best: null, just: "", linkedN: rows.filter((r) => r.c.w === YES).length };
  const unlinked = x.unlinked, v = ++DRAWN;
  useEffect(() => { booksLoad(rows.filter((r) => r.kind === "client" && r.c.w === YES).map((r) => r.cid)); countLedgers(rows); });
  // bridge 2.5.3: this Windows login's own bridge, looked for once for the tab, once the firm's computers are read (their
  // ports are asked too); never from a drawing (next-fix-probe-loop)
  useEffect(() => { if (ready) lookOnce(); }, [ready]);
  // from a client's "Open Tally page" (openTallyFor: S.tallyFocus): its row is marked here, and For support opens with that
  // client's company and its ⋯ (Post entries here, Change Tally company…, Unlink)
  useEffect(() => { if (S.tallyFocus && !(S.tallyMore || {}).support) { S.tallyMore = Object.assign({}, S.tallyMore, { support: true }); render(); } }, [S.tallyFocus]);
  // "Open Companies in Tally" (openConnectTally(4) with no client, e.g. Settings › Books in the cloud): that list is under For support
  useEffect(() => { if (g.at && (g.step || 0) >= 4 && !g.cid && !(S.tallyMore || {}).support) { S.tallyMore = Object.assign({}, S.tallyMore, { support: true }); render(); } }, [g.at]);
  useEffect(() => { if (!focus) return; const t = setTimeout(() => { const e = document.querySelector("#app [data-tsm-row][data-focus]"); if (e && e.scrollIntoView) e.scrollIntoView({ block: "center" }); }, 120); return () => clearTimeout(t); }, [focus]);
  // openConnectTally(1..3): the steps shown (and forced open) for a while
  const forced = (!!ui.again && now - ui.again < GUIDE_MS) || (g.step === 1 && !!g.at && now - g.at < GUIDE_MS);
  const asked = !!g.at && g.step >= 1 && g.step <= 3 && now - g.at < GUIDE_MS;
  // next-tally-connect-steps: the six steps of this login (lib/connectSteps.js), from the same rows and the same own state
  let cs; try { cs = connectSteps({ latest, rows: R.extra ? rows : null, rowsWait: !R.extra, extra: R.extra }); } catch (e) { cs = { mode: "error", login: "", steps: [], now: null }; }
  const expanded = cs.mode === "laptop" || cs.mode === "error" || !!cs.now || forced || ui.open || asked;
  const open = x.open, best = x.best;
  const strip = unlinked.length > 0 && !(expanded && cs.now && cs.now.key === "link");
  // one Download on the page while step 1 asks for it (the rows and the header say the words only)
  const oneDl = !!ready && !!cs.now && cs.now.n === 1;
  useEffect(() => { if (ready && cs.now && cs.now.hook === "checking") lookOnce(); });
  // next-tally-page-redesign: the top line, Connect Tally's six steps (while steps 1-4 are not done, or asked for), the one
  // table (the short card instead while not connected and no client is in it); Advanced (for support) is the page's (Tally.jsx)
  const down = cs.mode === "login" && !!cs.now && cs.now.n <= 4;
  // (a laptop with the office's bridges online: the steps only when asked for, "Connect Tally on this computer")
  const officeUp = cs.mode === "laptop" && bridgesOf().some((b) => b.at && Date.now() - Date.parse(b.at) < 3 * 60000);
  const showGuide = cs.mode === "laptop" ? !officeUp || forced || ui.open || asked : cs.mode !== "login" || down || forced || ui.open || asked;
  const beat = ((own.own || {}).beat) || null;
  return <div className="tsm" data-tally-simple="" data-tsm-own={own.state} data-tsm-own-from={own.from || undefined} data-tsm-own-how={(own.own && own.own.how) || undefined} data-tsm-rows={R.extra ? "done" : "quick"}>
    <Part name="top" v={v}><Top cs={cs} own={own} rows={rows} checkAgain={checkAgain} ready={ready} shown={!!ready && showGuide} beat={beat} /></Part>
    {strip && !(ready && R.extra && cs.mode === "login") && <Part name="strip" v={v}><Strip key={coKey(open.company)} r={open} best={best} more={unlinked.length - 1} /></Part>}
    {ready && showGuide && <Part name="guided box" v={v}><Guide cs={cs} collapsed={!expanded} forced={forced} asked={!!g.at && (g.step || 0) <= 3 && now - g.at < GUIDE_MS} connectPanel={connectPanel} download={download} checkAgain={checkAgain} /></Part>}
    {down && ready && R.extra && !rows.length ? <Part name="short" v={v}><ShortCard rows={rows} cs={cs} /></Part>
      : <Part name="table" v={v} fallback={() => <PlainTable />}><Table rows={rows} download={download} oneDl={oneDl} cs={cs} x={R.extra} checkAgain={checkAgain} /></Part>}
    <Foot />
  </div>;
}
