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
import { LEDN, ASKED_N, rowsFor, quickRows, FILTERS, PICK, ledChangeKnown, openKnown, openingsAll, openingsDecide, rupees, matches, headWords, ownState, localBridges, rescanLocal, lookOnce, aimLocal, YES, NO, NOTYET, BLOCKED } from "../lib/tallySimple.js";
import { coKey } from "../lib/tallyState.js";
import { LED_N, ledBook, cloudLedgerCount, baseKey, stallWhy, companyRows } from "./TallyCompanies.jsx";
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

// ---------- the header
function Head({ rows, checkAgain, ready, own }) {
  const w = headWords(rows), on = checking(), o = own || {}, quick = rows.some((r) => r.quick);
  // next-tally-connect-steps: why this login's bridge or Tally is not ready is said once, in Connect Tally's step (never here
  // too); only that the page shows the bridge's last beat (it does not answer here now), or a bridge not confirmed yours
  const far = o.state === "ok" && o.far;
  return <header className="tsm-head" data-tsm-head="">
    <div className="tsm-head-words"><h3 className="tsm-title">Tally</h3>
      {ready && !quick && <div className="tsm-say" data-tsm-say=""><b className="tsm-fine">{w.fine}</b>{" "}<b className="tsm-need" data-tsm-need-n={rows.filter((r) => r.need).length}>{w.need}</b></div>}</div>
    <button type="button" className="btn primary tsm-check" data-tsm-check="" disabled={on} onClick={() => checkTallyNow(rows, checkAgain)}>{on ? "Checking Tally…" : "Check Tally now"}</button>
    {ready && far && <div className="tsm-head-notes tsm-head-bridge" data-tsm-bridge-say="far">
      <div className="tsm-note">{"This browser does not reach FinCom Bridge in this Windows login now. Shown: what that bridge last sent to FinCom’s cloud." + (o.far === "blocked" ? " " + BLOCKED : "")}</div></div>}
    {ready && o.unsure && <div className="tsm-head-notes"><div className="tsm-note" data-tsm-unsure="">Showing your bridge (not confirmed).</div></div>}
  </header>;
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
  const again = () => { setCk(true); rescanLocal(); Promise.resolve(checkAgain()).finally(() => { setCk(false); render(); }); };
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
  else if (a && a.kind === "check") btn = <button type="button" className="btn primary" data-tsm-go="check" disabled={ck} onClick={again}>{ck ? "Checking…" : "Check again"}</button>;
  const copy = a && a.free ? <button type="button" className="linkbtn" data-tsm-port-copy={a.free} onClick={() => (navigator.clipboard ? navigator.clipboard.writeText(String(a.free)) : Promise.reject()).then(() => toast("Port " + a.free + " copied."), () => toast("Could not copy; type " + a.free + "."))}>{"Copy " + a.free}</button> : null;
  return <section className="tsm-card tsm-guide" aria-label="Connect Tally" data-tsm-guide={now ? now.n : "done"} data-tsm-hook={now ? now.hook || undefined : undefined} data-tsm-login={cs.login || undefined} data-tsm-forced={forced ? "" : undefined}>
    <div className="tsm-guide-top"><b className="tsm-guide-title">Connect Tally</b><span className="tsm-note" data-tsm-who="">{who}</span>
      <span className="tsm-guide-links">{recheck}
        {forced ? <button type="button" className="linkbtn" data-tsm-back="" onClick={() => { S.tallyGuide = {}; set({ again: 0 }); }}>Back</button> : null}
        {ui.open && !now && <button type="button" className="linkbtn" data-tsm-hide="" onClick={() => set({ open: false })}>Hide the steps</button>}</span></div>
    <ol className="tsm-steps">{cs.steps.map((s) => <li key={s.n} className={"tsm-step " + s.state} data-tsm-step={s.n} data-tsm-step-key={s.key} data-tsm-state={s.state}
      data-now={s.state === "now" ? "" : undefined} data-done={s.state === "done" ? "" : undefined} aria-current={s.state === "now" ? "step" : undefined}>
      <div className="tsm-step-top"><span className="tsm-mark" aria-hidden="true">{s.state === "done" ? TICK : s.n}</span><span className="tsm-step-title">{s.title}</span></div>
      <div className="tsm-step-text">{s.state === "done" ? (s.doneSay || STATE_WORD.done) + " ✓" : STATE_WORD[s.state]}</div></li>)}</ol>
    {now && <div className="tsm-now">
      <div className="tsm-now-text" data-tsm-now={now.n} data-tsm-now-hook={now.hook || undefined}>{"Step " + now.n + ": " + now.say}</div>
      {(btn || copy) && <span className="tsm-now-act">{btn}{copy}</span>}
      {a && a.kind === "link" && a.co && canWrite() && !pick && <button type="button" className="linkbtn" data-tsm-go-choose="" onClick={() => setPick(true)}>Choose another client</button>}
    </div>}
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
export function ownTallys(own) {
  const here = own && own.from === "here" && typeof Bridge === "object" ? Bridge.st || {} : null, b = (own && own.own && own.own.beat) || {};
  const ses = [].concat((here && here.sessions && here.sessions.length ? here.sessions : b.ports) || []).filter((p) => p && !p.skipped && p.mine !== false && Number(p.port) > 0);
  const items = here ? [].concat(here.open || []).filter((o) => o && o.mine !== false) : [], oks = ses.filter((s) => s.ok);
  const by = new Map(), out = [];
  [...((own && own.names) || new Map()).values()].forEach((n) => { const it = items.find((o) => coKey(o.name) === coKey(n));
    const p = (it && Number(it.port)) || (oks.length === 1 ? Number(oks[0].port) : 0); by.set(p, (by.get(p) || []).concat(n)); });
  ses.forEach((s) => { const p = Number(s.port); if (!out.some((t) => t.port === p)) out.push({ port: p, ok: !!s.ok, names: by.get(p) || [] }); });
  by.forEach((ns, p) => { if (!out.some((t) => t.port === p)) out.push({ port: p, ok: true, names: ns }); });
  return out.filter((t) => t.ok);
}
const STATE_OF = { clash: "port taken", reopen: "connection set, not on yet", notanswering: "not answering", admin: "run as administrator" };
function HereCompany({ name, rows, x }) {
  const [pick, setPick] = useState(false), k = coKey(name), same = (a) => coKey(a) === k || !!(globalThis.LinkRec && LinkRec.same && LinkRec.same(a, name));
  const linked = rows.find((r) => r.kind === "client" && r.c.w === YES && same(r.company));
  const conn = rows.find((r) => r.kind === "client" && r.c.w !== YES && r.r && r.c.connect && coKey(r.r.company) === k);
  const comp = rows.find((r) => r.kind === "company" && coKey(r.company) === k), ur = (x.unlinked || []).find((r) => coKey(r.company) === k);
  const r = (conn && conn.r) || (comp && comp.r) || ur, best = (conn && conn.co) || (comp && comp.best) || null;
  let body;
  if (linked) {
    const done = linked.l.w === YES && linked.e.w === YES, reading = !done && (linked.l.w === NOTYET || linked.e.w === NOTYET);
    const say = done ? "Up to date" + (linked.e.note ? " · " + linked.e.note : "") : reading ? "Reading…" + ((linked.l.w === NOTYET ? linked.l.note : linked.e.note) ? " " + (linked.l.w === NOTYET ? linked.l.note : linked.e.note) : "")
      : [linked.l.w !== YES ? "Ledgers: " + (linked.l.note || linked.l.w) : "", linked.e.w !== YES ? "Entries: " + (linked.e.note || linked.e.w) : ""].filter(Boolean).join(" · ");
    body = <><span className="tsm-here-client">{"Client: "}<button type="button" className="linkbtn" data-tsm-here-client={linked.cid} onClick={() => openCompany(linked.cid)}>{linked.client}</button></span>
      <span className="tsm-note" data-tsm-here-state={done ? "done" : reading ? "reading" : "need"}>{say}</span>
      {canWrite() && <button type="button" className="btn small" data-tsm-here-update={linked.cid} onClick={() => tallyUpdateNow(linked.cid)}>Update now</button>}</>;
  } else if (r && best && canWrite()) body = <><span className="tsm-note">{"Not linked · client “" + best.name + "” matches"}</span>
    <ConnectBtn r={r} co={best} label="Connect" hook={{ "data-tsm-here-connect": best.id }} />
    {!pick && <button type="button" className="linkbtn" data-tsm-here-choose="" onClick={() => setPick(true)}>Another client</button>}</>;
  else if (r && canWrite()) body = <><span className="tsm-note">Not linked to a client</span>
    <button type="button" className="btn primary small" data-tsm-here-link="" onClick={() => setPick(!pick)} aria-expanded={pick}>Link</button></>;
  else body = <span className="tsm-note">{r ? "Not linked: a member of the firm who may make changes links it." : "Not seen by FinCom’s cloud yet: it shows here within a minute."}</span>;
  return <li className="tsm-here-co" data-tsm-here-co={name} data-tsm-here-kind={linked ? "linked" : best ? "match" : "none"}>
    <b className="tsm-here-name">{shown(name)}</b>{body}
    {pick && r && <div className="tsm-pick" data-tsm-here-pick=""><Pick r={r} co={null} pre={best ? best.id : ""} onClose={() => setPick(false)} /></div>}</li>;
}
function Away({ row, x, cs, checkAgain }) {
  const [st, setSt] = useState(0);
  const near = (x.unlinked || []).find((u) => coKey(u.company) !== coKey(row.company) && (baseKey(u.company) === baseKey(row.company) || !!(globalThis.LinkRec && LinkRec.same && LinkRec.same(u.company, row.company))));
  const go = async () => { setSt(1); rescanLocal(); try { await Promise.all([checkAgain(), typeof tallyCheckNow === "function" ? tallyCheckNow() : null]); } catch (e) { /* the words say why */ } setSt(2); render(); };
  const step = cs.now && cs.now.n <= 4 ? cs.now : null;
  // (the computer offline, reading paused or stopped: its own words; the company not open: said for connecting, not for the ledgers)
  const sw = stallWhy(row.cid, row.company), shut = !sw || /^Open .+ in Tally|is not open in Tally|^No computer with FinCom Bridge holds /.test(sw);
  const why = step ? "Step " + step.n + " of 6 above is not done: " + step.title + "." : shut ? "“" + shown(row.company) + "” is not open in your Tally. Open it in TallyPrime in this Windows login: it connects by itself within a minute." : sw;
  return <li className="tsm-here-co" data-tsm-away={row.cid}>
    <b className="tsm-here-name">{row.client}</b><span className="tsm-note">{"Tally company: " + shown(row.company)}</span>
    <button type="button" className="btn small primary" data-tsm-away-again={row.cid} disabled={st === 1} onClick={go}>{st === 1 ? "Checking…" : "Connect again"}</button>
    {st === 2 && <div className="tsm-note tsm-here-why" data-tsm-away-why={step ? "step" + step.n : "why"} role="status">{why}
      {step && <>{" "}<button type="button" className="linkbtn" data-tsm-away-steps={step.n} onClick={() => { set({ open: true }); window.scrollTo(0, 0); }}>See step {step.n}</button></>}</div>}
    {near && canWrite() && <div className="tsm-note" data-tsm-away-near={near.company}>{"“" + shown(near.company) + "” is open in your Tally, a close name. "}
      <ConnectBtn r={near} co={row.co} label={"Link " + row.client + " to it"} primary={false} hook={{ "data-tsm-away-relink": row.cid }} /></div>}</li>;
}
function OpenHere({ cs, own, rows, x, checkAgain }) {
  if (cs.mode !== "login" || !x) return null;
  const tallys = ownTallys(own), conn = cs.steps[2] || {}, run = (cs.steps[1] || {}).done;
  // (a company open in another Tally FinCom hears now, another login's or computer's, is connected there: not listed)
  let seen = []; try { seen = companyRows().filter((r) => r.open).map((r) => coKey(r.company)); } catch (e) { seen = []; }
  const away = rows.filter((r) => r.kind === "client" && r.c.w === YES && r.o.w !== YES && r.company && !seen.includes(coKey(r.company)));
  const sayN = tallys.length ? nOfW(tallys.length, "Tally", "Tallys") + " running in this login" : run ? "TallyPrime is running in this login but FinCom can’t use it yet" : "No TallyPrime running in this login";
  return <section className="tsm-here" aria-label="Open in your Tally now" data-tsm-here={tallys.length} data-tsm-login={cs.login || undefined}>
    <div className="tsm-guide-top"><b>{"Open in your Tally now" + (cs.login ? " (" + cs.login + ")" : "")}</b><span className="tsm-note" data-tsm-here-n="">{sayN}</span></div>
    {tallys.map((t) => <div key={t.port} className="tsm-here-tally" data-tsm-here-tally={t.port}>
      <div className="tsm-here-head"><b>{"TallyPrime · port " + (t.port || "?")}</b><span className="tsm-word yes" data-tsm-here-tstate="connected">connected</span></div>
      {t.names.length ? <ul className="tsm-here-list">{t.names.map((n) => <HereCompany key={n} name={n} rows={rows} x={x} />)}</ul>
        : <div className="tsm-note" data-tsm-here-noco="">No company open in it. Open your company in TallyPrime: it shows here within a minute.</div>}</div>)}
    {!tallys.length && run && conn.state !== "done" && <div className="tsm-here-tally" data-tsm-here-tally="off">
      <div className="tsm-here-head"><b>TallyPrime</b><span className="tsm-word no" data-tsm-here-tstate={conn.hook || "off"}>{STATE_OF[conn.hook] || "connection off"}</span></div>
      <div className="tsm-note" data-tsm-here-see="3">What to do is step 3, above.</div></div>}
    {away.length > 0 && <div className="tsm-here-away" data-tsm-here-away={away.length}><b>Linked clients not connected now</b>
      <ul className="tsm-here-list">{away.map((r) => <Away key={r.cid} row={r} x={x} cs={cs} checkAgain={checkAgain} />)}</ul></div>}
  </section>;
}
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
function Act({ row }) {
  const [busy, setBusy] = useState(false), [pick, setPick] = useState(false), a = row.act;
  if (!a) return null;
  if (!canWrite()) return null;
  const run = (fn) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  let btn;
  if (a.kind === "connect") btn = <ConnectBtn r={row.r} co={row.co} label="Link" hook={{ "data-tsm-act": "connect" }} />;
  else if (a.kind === "choose" && row.best) btn = <ConnectBtn r={row.r} co={row.best} label="Link" hook={{ "data-tsm-act": "connect", "data-tsm-act-client": row.best.id }} />;
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
function Row({ row, download, oneDl }) {
  const [list, setList] = useState(false);
  // a first sync going: read every 10 seconds (its count, done, or stuck after 3 minutes with the button), as the bar does
  // elsewhere; this page had read it only once, so "Coming in now" stayed until the page was opened again
  useEffect(() => { if (!row.l || !row.l.syncing) return; const t = setInterval(() => syncPoll(row.cid), 10000); return () => clearInterval(t); }, [row.cid, row.l && row.l.syncing]);
  const linkedRow = row.kind === "client";
  return <><tr className={"tsm-tr" + (row.focus ? " tsm-focus" : "")} data-tsm-row={linkedRow ? row.client : row.company} data-tsm-kind={row.kind} data-tsm-cid={row.cid || undefined}
    data-tsm-need={row.need ? "" : undefined} data-tsm-fine={row.fine ? "" : undefined} data-focus={row.focus ? "" : undefined}>
    <td className="tsm-td tsm-client" data-tsm-col="client" data-label="Client">{linkedRow ? <button type="button" className="linkbtn tsm-client-name" data-tsm-client={row.cid} onClick={() => openCompany(row.cid)}>{row.client}</button>
      : <span className="tsm-client-none">Not chosen yet</span>}</td>
    <Cell k="c" label="Linked to Tally?" x={row.c}>{row.c.connect && <div><ConnectBtn r={row.r} co={row.co} label="Connect" hook={{ "data-tsm-connect": row.cid }} /></div>}</Cell>
    <Cell k="o" label="Open in Tally right now?" x={row.o}>{row.o.say && row.o.say !== "blocked" && (row.o.say === "old" || !oneDl) && <div className="tsm-say-dl" data-tsm-o-say={row.o.say}>{download}</div>}{row.o.connect && row.o.say !== "old" && <LocalConnect />}{row.o.setup && <SetUp />}</Cell>
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
function Table({ rows, download, oneDl }) {
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
      <thead><tr><th>Client</th><th>Linked to Tally?</th><th>Open in Tally right now?</th><th>Ledgers received?</th><th>All entries received?</th><th>What to do</th></tr></thead>
      <tbody>{list.map((r) => <Row key={r.key} row={r} download={download} oneDl={oneDl} />)}</tbody></table></div>}
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
  return <div className="tsm" data-tally-simple="" data-tsm-own={own.state} data-tsm-own-from={own.from || undefined} data-tsm-own-how={(own.own && own.own.how) || undefined} data-tsm-rows={R.extra ? "done" : "quick"}>
    <Part name="header" v={v}><Head rows={rows} checkAgain={checkAgain} ready={ready} own={own} /></Part>
    {strip && cs.mode !== "login" && <Part name="strip" v={v}><Strip key={coKey(open.company)} r={open} best={best} more={unlinked.length - 1} /></Part>}
    {/* next-tally-basics: Open in your Tally now, inside Connect Tally (this login's own: its name and ports are said only there) */}
    {ready && <Part name="guided box" v={v}><Guide cs={cs} collapsed={!expanded} forced={forced} asked={!!g.at && (g.step || 0) <= 3 && now - g.at < GUIDE_MS} connectPanel={connectPanel} download={download} checkAgain={checkAgain}
      here={<Part name="open here" v={v}><OpenHere cs={cs} own={own} rows={rows} x={R.extra} checkAgain={checkAgain} /></Part>} /></Part>}
    <Part name="table" v={v} fallback={() => <PlainTable />}><Table rows={rows} download={download} oneDl={oneDl} /></Part>
    {ready && <Part name="computers line" v={v}><Computers pcs={pcs} download={download} sha={sha} /></Part>}
  </div>;
}
