// The simple Tally page (02-Nov-2026, next-tally-simple; the owner's approved design "Tally — Yes or No"). Drawn by
// screens/Tally.jsx above its For support fold:
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
import { checkAll, bridgesOf, rowsLast, placeOf, LEDN, ASKED_N, rowsFor, quickRows, FILTERS, PICK, ledChangeKnown, openKnown, openingsAll, openingsDecide, rupees, matches, headWords, ownState, localBridges, rescanLocal, lookOnce, aimLocal, YES, NO, NOTYET, BLOCKED } from "../lib/tallySimple.js";
import { coKey } from "../lib/tallyState.js";
import { LED_N, ledBook, cloudLedgerCount, baseKey, stallWhy, companyRows, unlink, runPress, runWords, runSettle, runBusy, keepWaitWords } from "./TallyCompanies.jsx";
import { soonDraw } from "../lib/soonDraw.js";
// each connected client's ledger count from FinCom's cloud (tally_ledgers, counted; kept a minute), asked once a minute at most
function countLedgers(rows) {
  rows.forEach((r) => {
    const bk = ledBook(r.cid);
    if (r.kind !== "client" || r.c.w !== YES || ASKED_N.has(r.cid) || !bk || (LEDN[r.cid] && LEDN[r.cid].book === bk.book && Date.now() - LEDN[r.cid].at < 300000)) return;
    ASKED_N.add(r.cid);
    Promise.resolve(cloudLedgerCount(r.cid, true)).then((n) => { if (n != null) { LEDN[r.cid] = { n, book: bk.book, at: Date.now() }; soonDraw(); } }, () => {}).finally(() => setTimeout(() => ASKED_N.delete(r.cid), 60000));
  });
}
import { rpc, missing, bookSum, askStatus, summary } from "./TallyFetch.jsx";
import { periodOf, daysOf } from "./TallyCheck.jsx";
import "./tallySimple.css";
// "Open in Tally right now?" with no FinCom Bridge reachable from this browser: Connect is the page's own local connect
// (Connect this computer: doConnect, its answer in OC.c), nothing new
import { OC, doConnect, Line } from "./TallyOneClick.jsx";
import { HERE } from "../lib/tallyConnect.js";
import { connectSteps, LAPTOP, LAPTOP_HERE } from "../lib/connectSteps.js";

const shown = (n) => String(n || "").replace(/\s+/g, " ").trim();
// next-tally-words: a client named as its Tally company (case and spaces aside): the button says only "Link"
const sameName = (a, b) => !!shown(a) && shown(a).toLowerCase() === shown(b).toLowerCase();
const canWrite = () => (S.account && S.account.me ? ["owner", "staff"].includes(S.account.me.role) : true);
const UI = () => (S.tsm = S.tsm || { filter: "all", q: "", open: false, again: 0, check: 0 });
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
    let n = 0, fallback = false;
    for (const r of cs) {
      const b = bookSum(r.cid) || books.find((x) => x.client === r.cid);
      if (!b && !fallback) continue;
      try {
        if (fallback) throw new Error("PGRST202");
        const [a, z] = periodOf("fy", "", "", b.from);
        const x = await rpc("tally_check_request", { p_client: r.cid, p_from: a, p_to: z });
        if (!(x && x.ok === false)) n++;
      } catch (e) {
        // the day check is not in this cloud: Update now (tally_want_update), as each client's own button
        if (missing(e)) { fallback = true; try { await TCloud.rpc("tally_want_update", { p_client: r.cid }); n++; } catch (e2) { /* next */ } }
      }
    }
    askStatus(true);
    toast(n ? (fallback ? "The Tally computer is asked to update " : "Checking ") + n + (n === 1 ? " client" : " clients") + (fallback ? " now." : " against Tally.") : "Tally checked: nothing to compare yet.");
  } finally { CHK.busy = false; render(); }
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
function ConnectBtn({ r, co, label, hook, primary = true }) {
  const [busy, setBusy] = useState(false);
  if (!canWrite()) return <span className="note">A member of the firm who may make changes links it.</span>;
  return <button type="button" className={"btn" + (primary ? " primary" : "")} {...hook} disabled={busy}
    onClick={async () => { setBusy(true); try { await linkTo(r, co); } finally { setBusy(false); } }}>{busy ? "Linking…" : label}</button>;
}
const STATE_WORD = { done: "Done", now: "Do this now", later: "Later" };
function Guide({ cs, collapsed, forced, asked, connectPanel, download, checkAgain, here = null }) {
  const ui = UI(), [ck, setCk] = useState(false), [pick, setPick] = useState(false);
  const again = () => { setCk(true); checkAll(checkAgain).finally(() => { setCk(false); render(); }); };
  // the card's own look (TallyOneClick useHereProbe, every 2 minutes) found this login's bridge: the page's look follows
  // (once for each bridge it finds, and only a 2.5.3 one saying it is this session's: never a look that starts another look)
  useEffect(() => { const A = HERE.lastAny, m = A && A.h && A.h.mine, k = m ? String(m.bridgeId || m.port || "") : "";
    if (cs.now && cs.now.n === 1 && m && m.sameSession === true && k && k !== Guide.seen && !(localBridges() || []).some((x) => x && x.sameSession === true)) { Guide.seen = k; rescanLocal(); } });
  const recheck = <button type="button" className="linkbtn" data-tsm-recheck="" disabled={ck} onClick={again}>{ck ? "Checking…" : "Check again"}</button>;
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
  const offAt = (p) => why === "connection off" && !p.ok && (tp ? Number(p.port) === tp : all.filter((x) => !x.ok).length === 1);
  const ses = all.filter((p) => p.ok || offAt(p) || !(/^closed$|^$/.test(lc(p.reason || p.state || "")) || /nothing listens/i.test(String(p.error || ""))));
  const items = here ? [].concat(here.open || []).filter((o) => o && o.mine !== false) : [], oks = ses.filter((s) => s.ok);
  const by = new Map(), out = [], unknown = [];
  [...((own && own.names) || new Map()).values()].forEach((n) => { const it = items.find((o) => coKey(o.name) === coKey(n));
    const p0 = it && Number(it.port), p = p0 && ses.some((x) => Number(x.port) === p0) ? p0 : oks.length === 1 ? Number(oks[0].port) : 0;
    if (p) by.set(p, (by.get(p) || []).concat(n)); else unknown.push(n); });
  ses.forEach((x) => { const p = Number(x.port); if (out.some((t) => t.port === p)) return;
    out.push({ port: p, ok: !!x.ok, state: x.ok ? "connected" : offAt(x) ? "connection off" : SESS_STATE[lc(x.reason || x.state)] || "not answering", names: by.get(p) || [] }); });
  return { tallys: out, unknown };
}
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
function Act({ row, main = false }) {
  const [busy, setBusy] = useState(false), [pick, setPick] = useState(false), a = row.act;
  if (!a) return null;
  if (!canWrite()) return null;
  const run = (fn) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  let btn;
  if (a.kind === "connect") btn = <ConnectBtn r={row.r} co={row.co} label="Link" hook={{ "data-tsm-act": "connect" }} />;
  else if (a.kind === "choose" && row.best) btn = <ConnectBtn r={row.r} co={row.best} label="Link" hook={{ "data-tsm-act": "connect", "data-tsm-act-client": row.best.id }} />;
  else if (a.kind === "choose" || a.kind === "pickco") btn = <button type="button" className="btn primary" data-tsm-act={a.kind} onClick={() => setPick(!pick)} aria-expanded={pick}>{a.label}</button>;
  else if (a.kind === "upload") btn = <button type="button" className={"btn primary" + (main ? " tpt-btn" : "")} data-tsm-act="upload" data-tpt-main={main ? "upload" : undefined} onClick={() => a.run ? a.run() : (a.day && typeof Rec === "object" && Rec.uploadFrom ? Rec.uploadFrom(row.cid, a.day) : openFromTally(row.cid))}>{a.label}</button>;
  else if (a.kind === "bring") btn = <button type="button" className={"btn primary" + (main ? " tpt-btn" : "")} data-tsm-act="bring" data-tpt-main={main ? "bring" : undefined} disabled={busy}
    onClick={run(() => rpc("tally_fill_request", { p_client: row.cid, p_days: daysOf(a.need) }).then((r) => { if (r && r.ok === false) toast(String(r.error || "FinCom did not take it")); askStatus(true); },
      () => toast("FinCom’s cloud did not answer; try again in a minute.")))}>{busy ? "Asking Tally…" : a.label}</button>;
  return <>{btn}
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
  return <div><button type="button" className="linkbtn tsm-small" data-tsm-local-connect="" disabled={!!OC.busy} onClick={() => { setMine(true); const o = ownState(); aimLocal(o.own); rescanLocal(); doConnect(false); }}>{busy && mine ? "Connecting…" : "Connect"}</button>
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
  const go = async () => { setBusy(true); try { await firstSync(row.cid, row.company, { now: true }); } finally { setBusy(false); } };
  return <div className="tsm-bring" data-tsm-bring={row.cid}>
    <button type="button" className="btn small primary" data-tsm-bring-btn="" disabled={busy || !l.can} onClick={go}>{busy ? "Asking Tally…" : "Bring ledgers from Tally"}</button>
    {!l.can && l.why && <div className="tsm-note" data-tsm-bring-why="">{l.why}</div>}</div>;
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
  if (!open) return { kind: "away", dot: "warn", say: "Not connected", why: row.o.note && row.o.note !== "Checking…" ? row.o.note : "Company not open in Tally", btn: "again", need: true };
  if (stuck) return { kind: "stuck", dot: "warn", say: "Not reading", why: row.l.note || "Nothing came from Tally", btn: "again", need: true };
  const reading = row.l.w === NOTYET || row.e.w === NOTYET;
  if (row.need || row.e.w === NO || (row.open && row.open.state === "differ")) return { kind: "need", dot: "warn", say: row.e.w === NO ? "Entries missing" : row.open && row.open.state === "differ" ? "Opening balances differ" : "Needs you", why: row.todo && /Bring ledgers from Tally/.test(row.todo) ? "Ledgers not in FinCom yet: press Update now." : row.todo && !/^Nothing/.test(row.todo) ? row.todo : row.e.note || "", btn: "update", need: true };
  if (reading) return { kind: "reading", dot: "read", say: "Reading from Tally…", why: row.l.w === NOTYET ? row.l.note || "" : row.e.note || "", btn: "update" };
  return { kind: "ok", dot: "ok", say: "Up to date" + (row.last ? " · " + lastWords(row.last).replace(/ IST$/, "") : ""), why: "", btn: "update" };
}
// a row's one button: {main, label} (update | upload | bring | again | connect | link)
export function mainOf(row, pg) {
  if (pg.btn === "update" && row.act && (row.act.kind === "upload" || row.act.kind === "bring")) return { main: row.act.kind, label: row.act.label };
  if (pg.btn === "update") return { main: "update", label: "Update now" };
  if (pg.btn === "again") return { main: "again", label: "Connect again" };
  if (pg.kind === "open" || (pg.kind === "company" && row.best)) return { main: "connect", label: "Connect" };
  return { main: "link", label: "Link" };
}
if (typeof globalThis === "object") globalThis.FCTallyMain = (row) => mainOf(row, pageOf(row, new Set()));
const DOT = { ok: "#17803D", read: "#1D5FD1", warn: "#B45309", idle: "#8A9099" };
function Dot({ k }) { return <span aria-hidden="true" className={"tpt-dot " + k} data-tpt-dot={k} />; }
// Connect again (the "Open in your Tally now" panel's, moved here): the shared look and Check again, a new read where the
// company is open; then what is missing in plain words and the step that is stuck; the company open under a close name
function Again({ row, x, cs, checkAgain, primary = true }) {
  const [st, setSt] = useState(0);
  const go = async () => { setSt(1);
    try { await checkAll(checkAgain); } catch (e) { /* the words say why */ }
    if (openAnywhere().has(coKey(row.company)) && !runBusy(row.cid)) runPress(row.cid, row.company, { entries: true });
    setSt(2); render(); };
  return <button type="button" className={"btn tpt-btn" + (primary ? " primary" : "")} data-tpt-main="again" data-tsm-away-again={row.cid} disabled={st === 1} onClick={go}>{st === 1 ? "Checking…" : "Connect again"}</button>;
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
      {row.l.link && <div><button type="button" className="linkbtn tsm-small" data-tsm-ledgers={row.cid} onClick={() => (typeof Rec === "object" && Rec.openClientTab ? Rec.openClientTab(row.cid, "books:ledgers") : openCompany(row.cid))}>See ledgers</button></div>}
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
function More({ row, label, onDetails, open }) {
  const linked = row.kind === "client" && row.c.w === YES;
  return <details className="bk-menu tpt-more" data-tpt-more={row.cid || row.company}><summary className="tpt-more-btn" aria-label={"More for " + label}>⋯</summary>
    <div className="bk-menu-list">
      <button type="button" data-tpt-details="" onClick={(ev) => { const d = ev.currentTarget.closest("details"); if (d) d.open = false; onDetails(); }}>{open ? "Hide details" : "Details"}</button>
      {linked && canWrite() && <button type="button" className="danger" data-tpt-unlink="" onClick={(ev) => { const d = ev.currentTarget.closest("details"); if (d) d.open = false; unlink({ company: row.company, client: row.cid }); }}>Unlink<small>The client stays; only its link to Tally goes</small></button>}
    </div></details>;
}
function Row({ row, download, oneDl, seen, cs, x, checkAgain }) {
  const ui = UI(), [, tick] = useState(0), key = row.cid || row.company, open = ui.details === "all" || (ui.details || {})[key];
  // a first sync going: read every 10 seconds (its count, done, or stuck after 3 minutes with the button)
  useEffect(() => { if (!row.l || !row.l.syncing) return; const t = setInterval(() => syncPoll(row.cid), 10000); return () => clearInterval(t); }, [row.cid, row.l && row.l.syncing]);
  const pg = pageOf(row, seen), linked = row.kind === "client" && row.c.w === YES;
  // this client's Update now: its words each second while it is on its way (Asking Tally… → the count → the result)
  const rw = linked ? runWords(row.cid, row.company) : null, live = !!(rw && rw.phase !== "done" && rw.phase !== "why");
  useEffect(() => { if (!live) return; const t = setInterval(() => tick((k) => k + 1), 1000); return () => clearInterval(t); }, [live]);
  useEffect(() => { if (linked) runSettle(row.cid, row.company, () => tick((k) => k + 1)); });
  const sx = (S.tcoSync || {})[row.cid], runningRead = !!(sx && !sx.end && !sx.err && !sx.late) || runBusy(row.cid);
  const label = row.client || shown(row.company);
  let btn = null;
  if (!canWrite()) btn = null;
  // (a row whose own action is the Day Book upload or the missing days' fetch: that action, in its words)
  else if (mainOf(row, pg).main === "upload" || mainOf(row, pg).main === "bring") btn = <Act row={row} main />;
  else if (pg.btn === "update") btn = runningRead ? <button type="button" className="btn tpt-btn" data-tpt-main="reading" disabled>Reading…</button>
    : <button type="button" className="btn tpt-btn" data-tpt-main="update" data-tsm-update={row.cid} onClick={() => runPress(row.cid, row.company, { entries: true }).then(() => tick((k) => k + 1))}>Update now</button>;
  else if (pg.btn === "again") btn = <Again row={row} x={x} cs={cs} checkAgain={checkAgain} />;
  else if (pg.kind === "open") btn = <ConnectBtn r={row.r} co={row.co} label="Connect" hook={{ "data-tsm-connect": row.cid, "data-tpt-main": "connect" }} />;
  else if (pg.kind === "company" && row.best) btn = <ConnectBtn r={row.r} co={row.best} label="Connect" hook={{ "data-tsm-act": "connect", "data-tsm-act-client": row.best.id, "data-tpt-main": "connect" }} />;
  else btn = <ActLink row={row} />;
  const aw = pg.btn === "again" ? Again.why(row, cs) : null;
  const near = pg.kind === "away" && x ? (x.unlinked || []).find((u) => coKey(u.company) !== coKey(row.company) && (baseKey(u.company) === baseKey(row.company) || !!(globalThis.LinkRec && LinkRec.same && LinkRec.same(u.company, row.company)))) : null;
  const why = rw && rw.phase !== "done" ? rw.text : rw ? rw.text : aw ? aw.text : pg.why;
  return <tr className={"tsm-tr tpt-tr" + (pg.need ? " tpt-need" : "") + (row.focus ? " tsm-focus" : "")} data-tsm-row={row.kind === "client" ? row.client : row.company} data-tsm-kind={row.kind} data-tsm-cid={row.cid || undefined}
    data-tpt-kind={pg.kind} data-tsm-need={row.need ? "" : undefined} data-tsm-fine={row.fine ? "" : undefined} data-focus={row.focus ? "" : undefined}>
    <td className="tpt-td tpt-client" data-tsm-col="client" data-label="Client">{row.kind === "client" ? <button type="button" className="linkbtn tsm-client-name" data-tsm-client={row.cid} onClick={() => openCompany(row.cid)}>{row.client}</button>
      : <span className="tsm-client-none">Not chosen yet</span>}</td>
    <td className="tpt-td tpt-co" data-label="Tally company">{shown(row.company || row.found) || "—"}</td>
    <td className="tpt-td tpt-state" data-label="State">
      <span className="tpt-say" data-tpt-state={pg.kind}><Dot k={pg.dot} />{rw && rw.phase !== "done" && rw.phase !== "why" ? (rw.phase === "waiting" ? "Waiting for Tally" : "Updating") : pg.say}</span>
      {why && <span className={"tpt-why" + (rw && (rw.phase === "why" || rw.phase === "waiting") ? " bad" : "")} data-tpt-why={rw ? "run-" + rw.phase : aw ? (aw.step ? "step" + aw.step.n : "why") : ""} role={rw ? "status" : undefined}>{why}
        {aw && aw.step && <>{" "}<button type="button" className="linkbtn" data-tsm-away-steps={aw.step.n} onClick={() => { set({ open: true }); window.scrollTo(0, 0); }}>See step {aw.step.n}</button></>}</span>}
      {near && canWrite() && <span className="tpt-why" data-tsm-away-near={near.company}>{"“" + shown(near.company) + "” is open in your Tally, a close name. "}
        <ConnectBtn r={near} co={row.co} label={"Link " + row.client + " to it"} primary={false} hook={{ "data-tsm-away-relink": row.cid }} /></span>}
      {open && <Details row={row} download={download} oneDl={oneDl} main={mainOf(row, pg).main} />}
    </td>
    <td className="tpt-td tpt-last" data-label="Last entry">{row.last ? lastWords(row.last) : "—"}</td>
    <td className="tpt-td tpt-act" data-label="">{btn}<More row={row} label={label} open={!!open} onDetails={() => set({ details: Object.assign({}, typeof ui.details === "object" ? ui.details : {}, { [key]: !open }) })} /></td>
  </tr>;
}
// Link (the old row's action: the client picker or the company picker), one button
function ActLink({ row }) {
  const [pick, setPick] = useState(false), a = row.act || {};
  if (!canWrite()) return null;
  if (a.kind === "connect") return <ConnectBtn r={row.r} co={row.co} label="Link" primary={false} hook={{ "data-tsm-act": "connect", "data-tpt-main": "link" }} />;
  const kind = a.kind === "pickco" ? "pickco" : "choose";
  return <span className="tpt-link"><button type="button" className="btn tpt-btn" data-tsm-act={kind} data-tpt-main="link" onClick={() => setPick(!pick)} aria-expanded={pick}>Link</button>
    {pick && <div className="tsm-pick" data-tsm-row-pick="">{kind === "pickco" ? <ChangePick co={row.co} cur="" onClose={() => setPick(false)} /> : <Pick r={row.r} co={null} pre={row.best ? row.best.id : ""} onClose={() => setPick(false)} />}</div>}</span>;
}
function Table({ rows, download, oneDl, cs, x, checkAgain }) {
  const ui = UI(), known = ledChangeKnown(rows), seen = openAnywhere();
  const fs = FILTERS.filter(([k]) => (k !== "ledchg" || known) && (k !== "opendiff" || openKnown()));
  const cur = fs.some(([k]) => k === ui.filter) ? ui.filter : "all";
  const list = rows.filter(PICK[cur]).filter((r) => matches(r, ui.q));
  const kinds = rows.map((r) => pageOf(r, seen)), w = headWords(rows);
  const say = [nOfW(rows.filter((r) => r.kind === "client").length, "client", "clients"), kinds.filter((k) => k.kind === "reading").length ? kinds.filter((k) => k.kind === "reading").length + " reading" : "",
    kinds.filter((k) => k.need).length ? nOfW(kinds.filter((k) => k.need).length, "needs you", "need you") : "", kinds.filter((k) => k.btn === "link" || k.btn === "connect").length ? kinds.filter((k) => k.btn === "link" || k.btn === "connect").length + " not linked" : ""].filter(Boolean).join(" · ");
  return <section className="tsm-card tsm-table tpt" aria-label="Clients and Tally" data-tsm-table="" data-tsm-n={rows.length}>
    <div className="tpt-head"><h3 className="tpt-title">Clients and Tally</h3><span className="tsm-note" data-tpt-say="">{say}</span>
      <span className="sr-only" data-tsm-say=""><b className="tsm-fine">{w.fine}</b>{" "}<b className="tsm-need" data-tsm-need-n={rows.filter((r) => r.need).length}>{w.need}</b></span></div>
    {rows.length > 0 && <div className="tsm-tools">
      {rows.length > 6 && <label className="tsm-search"><span className="sr-only">Search client</span>
        <input type="search" data-tsm-q="" placeholder="Search client" aria-label="Search client or Tally company" value={ui.q} onChange={(ev) => set({ q: ev.target.value })} /></label>}
      <div className="tsm-filters" role="group" aria-label="Show">
        {fs.map(([k, label]) => { const n = rows.filter(PICK[k]).length, on = cur === k;
          return <button key={k} type="button" className={"tsm-filter" + (on ? " on" : "")} aria-pressed={on} data-tsm-filter={k} data-tsm-count={n} onClick={() => set({ filter: k })}>{label + " " + n}</button>; })}
      </div>
    </div>}
    {!list.length && <div className="tsm-none" data-tsm-none={rows.length ? "match" : reading() ? "reading" : "none"}>{rows.length ? "No client matches. " : reading() ? readingWords() : "No client yet. "}
      {rows.length > 0 && <button type="button" className="linkbtn" data-tsm-showall="" onClick={() => set({ filter: "all", q: "" })}>Show all</button>}</div>}
    {list.length > 0 && <div className="tsm-scroll"><table className="tpt-grid nocards">
      <thead><tr><th>Client</th><th>Tally company</th><th>State</th><th>Last entry</th><th className="tpt-th-act">Action</th></tr></thead>
      <tbody>{list.map((r) => <Row key={r.key} row={r} download={download} oneDl={oneDl} seen={seen} cs={cs} x={x} checkAgain={checkAgain} />)}</tbody></table></div>}
    <div className="tpt-foot tsm-note">One button per client. ⋯ holds Details and Unlink.</div>
  </section>;
}
// ---------- the top: this login's Tally in one line, with Check again (and See the 6 steps while a step is not done)
function Top({ cs, own, rows, checkAgain, ready }) {
  const [ck, setCk] = useState(false), [said, setSaid] = useState("");
  // Check again does what a refresh does for the connection (checkAll), then says what it found
  const again = () => { setCk(true); setSaid(""); checkAll(checkAgain).finally(() => { setCk(false); setSaid("checked"); render(); }); };
  const T = ownTallys(own), ok = T.tallys.filter((t) => t.ok), off = T.tallys.filter((t) => !t.ok), names = (own && own.names) || new Map();
  const login = cs.mode === "login", down = login && !!cs.now && cs.now.n <= 4;
  const last = rows.filter((r) => r.kind === "client" && r.c.w === YES && r.o.w === YES && r.last).map((r) => r.last).sort().pop() || "";
  const office = cs.mode === "laptop" ? bridgesOf().filter((b) => b.at && Date.now() - Date.parse(b.at) < 3 * 60000) : [];
  const officeOpen = new Set([].concat(...office.map((b) => b.open)).map(coKey)).size;
  const lastAny = rows.filter((r) => r.kind === "client" && r.c.w === YES && r.last).map((r) => r.last).sort().pop() || "";
  const o = own || {}, far = o.state === "ok" && o.far, kw = login ? keepWaitWords((((o.own || {}).beat) || {}).keepWait) : "";
  let dot, title, sub;
  if (!ready) { dot = "idle"; title = "Looking for your Tally…"; sub = ""; }
  // a computer with no bridge of its own (a laptop, a Mac): the office's Tally through the firm's bridges heard now
  else if (cs.mode === "laptop" && office.length) { dot = "ok"; title = "Connected through the office Tally (" + nOfW(office.length, "bridge", "bridges") + " online)";
    sub = [nOfW(rows.filter((r) => r.kind === "client" && r.c.w === YES).length, "client linked", "clients linked"), nOfW(officeOpen, "company open", "companies open"), lastAny ? "last entry " + lastWords(lastAny) : ""].filter(Boolean).join(" · "); }
  else if (cs.mode === "laptop") { dot = "warn"; title = "No FinCom Bridge is connected"; sub = "Open FinCom on the computer or server where TallyPrime runs, and install FinCom Bridge there."; }
  else if (cs.mode === "error" || !login) { dot = "idle"; title = "Tally"; sub = "The state could not be worked out just now."; }
  else if (down) { dot = "warn"; title = "Not connected yet: step " + cs.now.n + " of 6"; sub = "Do the step below, then press Check again. Nothing else is needed."; }
  else { dot = "ok"; title = "Connected to your Tally";
    sub = [ok.length === 1 ? "TallyPrime on port " + ok[0].port : ok.length > 1 ? ok.length + " Tallys (ports " + ok.map((t) => t.port).join(", ") + ")" : "TallyPrime",
      nOfW(names.size, "company open", "companies open"), last ? "last entry " + lastWords(last) : ""].filter(Boolean).join(" · "); }
  const many = !down && login && (T.tallys.length > 1 || T.unknown.length > 0 && ok.length > 1);
  return <section className="tsm-card tpt-top" aria-label="Your Tally" data-tsm-top={down ? "down" : login ? "up" : cs.mode} data-tsm-head="">
    <div className="tpt-top-main"><Dot k={dot} /><div className="tpt-top-words"><div className="tpt-top-title" data-tsm-top-title="">{title}</div>
      {sub && <div className="tsm-note" data-tsm-top-sub="">{sub}</div>}
      {many && T.tallys.map((t) => <div key={t.port} className="tsm-note" data-tsm-top-tally={t.port}>{"port " + t.port + " · " + t.state + (t.ok ? " · " + nOfW(t.names.length, "company", "companies") : cs.steps[2] && cs.steps[2].state !== "done" ? " · what to do: step 3" : "")}</div>)}
      {!many && off.length > 0 && !down && off.map((t) => <div key={t.port} className="tsm-note" data-tsm-top-tally={t.port}>{"port " + t.port + " · " + t.state}</div>)}
      {ready && far && <div className="tsm-note" data-tsm-bridge-say="far">{"This browser does not reach FinCom Bridge in this Windows login now. Shown: what that bridge last sent to FinCom’s cloud." + (o.far === "blocked" ? " " + BLOCKED : "")}</div>}
      {ready && o.unsure && <div className="tsm-note" data-tsm-unsure="">Showing your bridge (not confirmed).</div>}
      {/* FinCom Bridge 2.5.5: why this login's bridge waits to read (its own words); an older bridge sends none */}
      {kw && <div className="tsm-note tpt-wait" data-tsm-top-wait="" role="status">{kw}</div>}
      {said && !ck && <div className="tsm-note" data-tsm-top-checked="" role="status">{"Checked at " + lastWords(new Date().toISOString()).replace(/ IST$/, "") + ": " + (down ? "not connected yet (step " + cs.now.n + " of 6)" : login ? "connected" : title.toLowerCase())}</div>}</div></div>
    <span className="tpt-top-acts">
      {cs.mode === "laptop" && office.length > 0 && <button type="button" className="linkbtn" data-tsm-steps-link="laptop" onClick={() => set({ open: !UI().open })}>{UI().open ? "Hide: Connect Tally on this computer" : "Connect Tally on this computer"}</button>}
      {login && !down && <button type="button" className="linkbtn" data-tsm-steps-link="" onClick={() => set({ open: !UI().open })}>{UI().open ? "Hide the 6 steps" : "See the 6 steps"}</button>}
      <button type="button" className="btn tpt-btn" data-tsm-top-check="" disabled={ck} onClick={again}>{ck ? "Checking…" : "Check again"}</button></span>
  </section>;
}
// not connected and no client in the table: the short card (the design's "Clients and Tally" under the steps)
function ShortCard({ rows, cs }) {
  const linked = rows.filter((r) => r.kind === "client" && r.c.w === YES).length;
  return <section className="tsm-card tpt-short" data-tsm-short=""><b>Clients and Tally</b>
    <div className="tsm-note">{"Your clients and their Tally companies show here once step " + (cs.now ? cs.now.n : 4) + " is done." + (linked ? " " + nOfW(linked, "client is", "clients are") + " already linked; they reconnect by themselves." : "")}</div></section>;
}
// for Advanced (for support): the day check of every client, and the computers in one line (were the page's header and foot)
export function SupportTools({ checkAgain, pcs, download, sha }) {
  // (the rows as the page last worked them out: rowsFor would replace the page's own options, its focused client)
  const rows = rowsLast(), on = checking();
  return <div className="tsm-support" data-tsm-support="">
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}><button type="button" className="btn small" data-tsm-check="" disabled={on} onClick={() => checkTallyNow(rows, checkAgain)}>{on ? "Checking Tally…" : "Check every client for changes in Tally"}</button>
      <span className="note">Each linked client’s entries of this year checked against Tally, one day at a time.</span></div>
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
  return <div className="tsm" data-tally-simple="" data-tsm-own={own.state} data-tsm-own-from={own.from || undefined} data-tsm-own-how={(own.own && own.own.how) || undefined} data-tsm-rows={R.extra ? "done" : "quick"}>
    <Part name="top" v={v}><Top cs={cs} own={own} rows={rows} checkAgain={checkAgain} ready={ready} /></Part>
    {strip && !(ready && R.extra && cs.mode === "login") && <Part name="strip" v={v}><Strip key={coKey(open.company)} r={open} best={best} more={unlinked.length - 1} /></Part>}
    {ready && showGuide && <Part name="guided box" v={v}><Guide cs={cs} collapsed={!expanded} forced={forced} asked={!!g.at && (g.step || 0) <= 3 && now - g.at < GUIDE_MS} connectPanel={connectPanel} download={download} checkAgain={checkAgain} /></Part>}
    {down && ready && R.extra && !rows.length ? <Part name="short" v={v}><ShortCard rows={rows} cs={cs} /></Part>
      : <Part name="table" v={v} fallback={() => <PlainTable />}><Table rows={rows} download={download} oneDl={oneDl} cs={cs} x={R.extra} checkAgain={checkAgain} /></Part>}
  </div>;
}
