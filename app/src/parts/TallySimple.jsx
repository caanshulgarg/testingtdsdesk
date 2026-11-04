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
import { LEDN, ASKED_N, rowsFor, quickRows, FILTERS, PICK, ledChangeKnown, openKnown, openingsAll, openingsDecide, rupees, matches, headWords, guideStep, ownState, rescanLocal, lookOnce, aimLocal, YES, NO, NOTYET, BLOCKED } from "../lib/tallySimple.js";
import { coKey } from "../lib/tallyState.js";
import { LED_N, ledBook, cloudLedgerCount } from "./TallyCompanies.jsx";
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

const shown = (n) => String(n || "").replace(/\s+/g, " ").trim();
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

// ---------- the header
function Head({ rows, checkAgain, ready, own, download }) {
  const w = headWords(rows), on = checking(), o = own || {}, quick = rows.some((r) => r.quick);
  // next-hang-watch: no bridge of this Windows login answers here: why, plainly, with what to do (never a blank)
  const say = (o.state === "none" || o.state === "away") && o.say ? o.say : null, far = o.state === "ok" && o.far;
  return <header className="tsm-head" data-tsm-head="">
    <div className="tsm-head-words"><h3 className="tsm-title">Tally</h3>
      {ready && !quick && <div className="tsm-say" data-tsm-say=""><b className="tsm-fine">{w.fine}</b>{" "}<b className="tsm-need" data-tsm-need-n={rows.filter((r) => r.need).length}>{w.need}</b></div>}</div>
    <button type="button" className="btn primary tsm-check" data-tsm-check="" disabled={on} onClick={() => checkTallyNow(rows, checkAgain)}>{on ? "Checking Tally…" : "Check Tally now"}</button>
    {ready && (say || far) && <div className="tsm-head-notes tsm-head-bridge" data-tsm-bridge-say={say ? say.kind : "far"}>
      <div className="tsm-note">{say ? say.words : "This browser does not reach FinCom Bridge in this Windows login now. Shown: what that bridge last sent to FinCom’s cloud." + (o.far === "blocked" ? " " + BLOCKED : "")}</div>
      {say && say.kind !== "blocked" && download}</div>}
    {ready && (o.unsure || (o.state === "ok" && !o.names.size && o.why) || (typeof o.say === "string" && o.say)) && <div className="tsm-head-notes">
      {o.unsure && <div className="tsm-note" data-tsm-unsure="">Showing your bridge (not confirmed).</div>}
      {o.state === "ok" && !o.names.size && o.why && <div className="tsm-note" data-tsm-why="">{o.why}</div>}
      {typeof o.say === "string" && o.say && <div className="tsm-note" data-tsm-connect-say="">{o.say}</div>}</div>}
  </header>;
}

// ---------- the guided box
const STEPS = [["Install FinCom Bridge", "On the computer that has Tally. Takes 1 minute."],
  ["Open the company in Tally", "Just open it. FinCom finds it by itself."],
  ["Choose the client", "FinCom suggests the client with the same name."],
  ["Done", "Ledgers, opening balances and entries come in by themselves."]];
const TICK = <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3.5 8.4l3 3 6-6.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
// one click: the company to the client (the same link as everywhere: linkTo, its first sync started)
function ConnectBtn({ r, co, label, hook, primary = true }) {
  const [busy, setBusy] = useState(false);
  if (!canWrite()) return <span className="note">A member of the firm who may make changes connects it.</span>;
  return <button type="button" className={"btn" + (primary ? " primary" : "")} {...hook} disabled={busy}
    onClick={async () => { setBusy(true); try { await linkTo(r, co); } finally { setBusy(false); } }}>{busy ? "Connecting…" : label}</button>;
}
function Guide({ step, collapsed, forced, open, best, connectPanel, download, checkAgain }) {
  const ui = UI(), [ck, setCk] = useState(false), [pick, setPick] = useState(false);
  if (collapsed) return <section className="tsm-card tsm-guide tsm-guide-small" aria-label="Connect a company" data-tsm-guide="done" data-tsm-collapsed="">
    <div className="tsm-guide-top"><b>Connect a company to Tally</b>
      <button type="button" className="linkbtn" data-tsm-show="" onClick={() => set({ open: true })}>Show the steps</button></div></section>;
  const now = [
    ["Step 1: download FinCom Bridge and install it on the computer that has Tally.", download],
    ["Step 2: FinCom Bridge is installed. Now open your company in Tally. This box moves on by itself when it sees the company.",
      <button type="button" className="btn primary" data-tsm-go="opened" disabled={ck} onClick={() => { setCk(true); rescanLocal(); Promise.resolve(checkAgain()).finally(() => setCk(false)); }}>{ck ? "Checking…" : "I have opened it"}</button>],
    open ? [best ? "Step 3: Tally has “" + shown(open.company) + "” open. Connect it to client “" + best.name + "”?" : "Step 3: Tally has “" + shown(open.company) + "” open. Which client is it?",
      best ? <ConnectBtn r={open} co={best} label="Yes, connect" hook={{ "data-tsm-go": "connect", "data-tsm-go-client": best.id }} /> : null] : ["", null],
    ["Connected. Ledgers, opening balances and entries are coming in by themselves. You can follow it in the list below.", null],
  ][step - 1];
  return <section className="tsm-card tsm-guide" aria-label="Connect a company" data-tsm-guide={step} data-tsm-forced={forced ? "" : undefined}>
    <div className="tsm-guide-top"><b className="tsm-guide-title">Connect a company to Tally</b>
      <span className="tsm-guide-links">
        {forced ? <button type="button" className="linkbtn" data-tsm-back="" onClick={() => { S.tallyGuide = {}; set({ again: 0 }); }}>Back</button>
          : <button type="button" className="linkbtn" data-tsm-again="" onClick={() => set({ again: Date.now() })}>Start again</button>}
        {ui.open && !forced && <button type="button" className="linkbtn" data-tsm-hide="" onClick={() => set({ open: false })}>Hide the steps</button>}</span></div>
    <ol className="tsm-steps">{STEPS.map(([title, text], i) => { const n = i + 1, done = n < step, cur = n === step;
      return <li key={n} className={"tsm-step" + (cur ? " now" : done ? " done" : "")} data-tsm-step={n} data-now={cur ? "" : undefined} data-done={done ? "" : undefined} aria-current={cur ? "step" : undefined}>
        <div className="tsm-step-top"><span className="tsm-mark" aria-hidden="true">{done ? TICK : n}</span><span className="tsm-step-title">{title}</span></div>
        <div className="tsm-step-text">{text}</div></li>; })}</ol>
    <div className="tsm-now">
      <div className="tsm-now-text" data-tsm-now={step}>{now[0]}</div>
      {now[1] && <span className="tsm-now-act">{now[1]}</span>}
      {step === 3 && open && canWrite() && (best ? !pick && <button type="button" className="linkbtn" data-tsm-go-choose="" onClick={() => setPick(true)}>Choose another client</button> : null)}
    </div>
    {step === 3 && open && canWrite() && (pick || !best) && <div className="tsm-pick" data-tsm-guide-pick=""><Pick r={open} co={null} pre={best ? "" : ""} onClose={() => setPick(false)} /></div>}
    {step === 1 && connectPanel && <div className="tsm-guide-panel" data-tsm-panel="">{connectPanel}</div>}
  </section>;
}

// ---------- the strip: a company open in Tally that no client has, one click (once a company is connected)
function Strip({ r, best, more }) {
  const [pick, setPick] = useState(false);
  return <section className="tsm-strip" aria-label="New company found in Tally" data-tsm-strip={r.company}>
    <div className="tsm-strip-words"><b>Open in your Tally now:</b>{" “" + shown(r.company) + "”, not linked yet"}
      {more > 0 && <span className="note">{" (and " + more + " more in the list below)"}</span>}</div>
    {canWrite() && <div className="tsm-strip-acts">
      {best && <ConnectBtn r={r} co={best} label={"Link to client “" + best.name + "”"} hook={{ "data-tsm-strip-connect": best.id }} />}
      {!pick && <button type="button" className={best ? "linkbtn" : "btn primary"} data-tsm-strip-choose="" onClick={() => setPick(true)}>{best ? "Link to another client" : "Link to a client"}</button>}</div>}
    {pick && <div className="tsm-pick" data-tsm-strip-pick=""><Pick r={r} co={null} pre="" onClose={() => setPick(false)} /></div>}
  </section>;
}

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
    <div className="tsm-scroll"><table className="tsm-grid nocards"><thead><tr><th>Client</th><th>Connected to Tally?</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.key} className="tsm-tr" data-tsm-row={r.client} data-tsm-kind="client"><td className="tsm-td tsm-client" data-label="Client">{r.client}</td><Cell k="c" label="Connected to Tally?" x={r.c} /></tr>)}</tbody></table></div>
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
function Act({ row }) {
  const [busy, setBusy] = useState(false), [pick, setPick] = useState(false), a = row.act;
  if (!a) return null;
  if (!canWrite()) return null;
  const run = (fn) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  let btn;
  if (a.kind === "connect") btn = <ConnectBtn r={row.r} co={row.co} label="Connect" hook={{ "data-tsm-act": "connect" }} />;
  else if (a.kind === "choose" && row.best) btn = <ConnectBtn r={row.r} co={row.best} label="Connect" hook={{ "data-tsm-act": "connect", "data-tsm-act-client": row.best.id }} />;
  else if (a.kind === "choose" || a.kind === "pickco") btn = <button type="button" className="btn primary" data-tsm-act={a.kind} onClick={() => setPick(!pick)} aria-expanded={pick}>{a.label}</button>;
  else if (a.kind === "upload") btn = <button type="button" className="btn primary" data-tsm-act="upload" onClick={() => a.run ? a.run() : (a.day && typeof Rec === "object" && Rec.uploadFrom ? Rec.uploadFrom(row.cid, a.day) : openFromTally(row.cid))}>{a.label}</button>;
  else if (a.kind === "bring") btn = <button type="button" className="btn primary" data-tsm-act="bring" disabled={busy}
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
function Row({ row, download }) {
  const [list, setList] = useState(false);
  // a first sync going: read every 10 seconds (its count, done, or stuck after 3 minutes with the button), as the bar does
  // elsewhere; this page had read it only once, so "Coming in now" stayed until the page was opened again
  useEffect(() => { if (!row.l || !row.l.syncing) return; const t = setInterval(() => syncPoll(row.cid), 10000); return () => clearInterval(t); }, [row.cid, row.l && row.l.syncing]);
  const linkedRow = row.kind === "client";
  return <><tr className={"tsm-tr" + (row.focus ? " tsm-focus" : "")} data-tsm-row={linkedRow ? row.client : row.company} data-tsm-kind={row.kind} data-tsm-cid={row.cid || undefined}
    data-tsm-need={row.need ? "" : undefined} data-tsm-fine={row.fine ? "" : undefined} data-focus={row.focus ? "" : undefined}>
    <td className="tsm-td tsm-client" data-tsm-col="client" data-label="Client">{linkedRow ? <button type="button" className="linkbtn tsm-client-name" data-tsm-client={row.cid} onClick={() => openCompany(row.cid)}>{row.client}</button>
      : <span className="tsm-client-none">Not chosen yet</span>}</td>
    <Cell k="c" label="Connected to Tally?" x={row.c} />
    <Cell k="o" label="Open in Tally right now?" x={row.o}>{row.o.say && row.o.say !== "blocked" && <div className="tsm-say-dl" data-tsm-o-say={row.o.say}>{download}</div>}{row.o.connect && <LocalConnect />}{row.o.setup && <SetUp />}</Cell>
    <Cell k="l" label="Ledgers received?" x={row.l}>
      {row.l.change && <div className="tsm-change" data-tsm-lchange="">{row.l.change}</div>}
      <OpenLine row={row} list={list} onList={() => setList(!list)} />
      {row.l.bring && <Bring row={row} />}
      {row.l.link && <div><button type="button" className="linkbtn tsm-small" data-tsm-ledgers={row.cid} onClick={() => (typeof Rec === "object" && Rec.openClientTab ? Rec.openClientTab(row.cid, "books:ledgers") : openCompany(row.cid))}>See ledgers</button></div>}
    </Cell>
    <Cell k="e" label="All entries received?" x={row.e}>
      {row.e.pct > 0 && <div className="tsm-bar" role="progressbar" aria-label={"Entries of " + row.client + " received"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.e.pct} data-tsm-pct={row.e.pct}><i style={{ width: row.e.pct + "%" }} /></div>}
    </Cell>
    <td className="tsm-td tsm-do" data-tsm-col="do" data-label="What to do">
      <Act row={row} />
      {row.todo && <div className="tsm-todo" data-tsm-todo="">{row.todo}</div>}
      {row.upload && <div><button type="button" className="linkbtn tsm-small" data-tsm-upload={row.cid} onClick={() => openFromTally(row.cid)}>or upload the file yourself</button></div>}
    </td>
  </tr>
  {list && row.open && row.open.state === "differ" && <tr className="tsm-tr-diffs"><td colSpan={6} className="tsm-td">
    <Differences row={row} /></td></tr>}</>;
}
function Table({ rows, download }) {
  const ui = UI(), known = ledChangeKnown(rows);
  const fs = FILTERS.filter(([k]) => (k !== "ledchg" || known) && (k !== "opendiff" || openKnown()));
  const cur = fs.some(([k]) => k === ui.filter) ? ui.filter : "all";
  const list = rows.filter(PICK[cur]).filter((r) => matches(r, ui.q));
  return <section className="tsm-card tsm-table" aria-label="Clients" data-tsm-table="" data-tsm-n={rows.length}>
    <div className="tsm-tools">
      <label className="tsm-search"><span className="sr-only">Search client</span>
        <input type="search" data-tsm-q="" placeholder="Search client" aria-label="Search client or Tally company" value={ui.q} onChange={(ev) => set({ q: ev.target.value })} /></label>
      <div className="tsm-filters" role="group" aria-label="Show">
        {fs.map(([k, label]) => { const n = rows.filter(PICK[k]).length, on = cur === k;
          return <button key={k} type="button" className={"tsm-filter" + (on ? " on" : "")} aria-pressed={on} data-tsm-filter={k} data-tsm-count={n} onClick={() => set({ filter: k })}>{label + " " + n}</button>; })}
      </div>
    </div>
    {!list.length && <div className="tsm-none" data-tsm-none={rows.length ? "match" : reading() ? "reading" : "none"}>{rows.length ? "No client matches. " : reading() ? readingWords() : "No client yet. "}
      {rows.length > 0 && <button type="button" className="linkbtn" data-tsm-showall="" onClick={() => set({ filter: "all", q: "" })}>Show all</button>}</div>}
    {list.length > 0 && <div className="tsm-scroll"><table className="tsm-grid nocards">
      <thead><tr><th>Client</th><th>Connected to Tally?</th><th>Open in Tally right now?</th><th>Ledgers received?</th><th>All entries received?</th><th>What to do</th></tr></thead>
      <tbody>{list.map((r) => <Row key={r.key} row={r} download={download} />)}</tbody></table></div>}
  </section>;
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
export default function SimpleTally({ installed, ready = true, pcs, download, sha, checkAgain, connectPanel }) {
  const ui = UI(), g = S.tallyGuide || {}, now = Date.now();
  const focus = g.cid && g.at && now - g.at < GUIDE_MS ? g.cid : (S.tallyFocus || "");
  // next-tally-own-login: everything above For support is this user's own FinCom Bridge and Tally (ownState), never another
  // Windows login's on the same server
  let own; try { own = ownState(); } catch (e) { own = { state: "none" }; }
  const mineIn = installed && own.state !== "none";
  // next-tally-table: the rows as last worked out (lib/tallySimple.js rowsFor: off the drawing, a few clients at a time),
  // at the very first drawing each client with its Tally company at once; the rest fills in as it is worked out
  const R = rowsFor({ focus }), rows = R.rows, x = R.extra || { unlinked: [], open: null, best: null, just: "", linkedN: rows.filter((r) => r.c.w === YES).length };
  const unlinked = x.unlinked, just = x.just, linkedN = x.linkedN, v = ++DRAWN;
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
  // openConnectTally(1): install on another computer (step 1 shown again); 2 and 3: the steps open
  const forced = (!!ui.again && now - ui.again < GUIDE_MS) || (g.step === 1 && !!g.at && now - g.at < GUIDE_MS);
  const asked = !!g.at && g.step >= 1 && g.step <= 3 && now - g.at < GUIDE_MS;
  const step = forced ? 1 : guideStep({ installed: mineIn, unlinked, just });
  const expanded = forced || !mineIn || linkedN === 0 || step === 4 || ui.open || asked;
  const open = x.open, best = x.best;
  const strip = unlinked.length > 0 && !(expanded && step === 3);
  return <div className="tsm" data-tally-simple="" data-tsm-own={own.state} data-tsm-own-from={own.from || undefined} data-tsm-own-how={(own.own && own.own.how) || undefined} data-tsm-rows={R.extra ? "done" : "quick"}>
    <Part name="header" v={v}><Head rows={rows} checkAgain={checkAgain} ready={ready} own={own} download={download} /></Part>
    {strip && <Part name="strip" v={v}><Strip key={coKey(open.company)} r={open} best={best} more={unlinked.length - 1} /></Part>}
    {ready && <Part name="guided box" v={v}><Guide step={step} collapsed={!expanded} forced={forced} open={open} best={best} connectPanel={connectPanel} download={download} checkAgain={checkAgain} /></Part>}
    <Part name="table" v={v} fallback={() => <PlainTable />}><Table rows={rows} download={download} /></Part>
    {ready && <Part name="computers line" v={v}><Computers pcs={pcs} download={download} sha={sha} /></Part>}
  </div>;
}
