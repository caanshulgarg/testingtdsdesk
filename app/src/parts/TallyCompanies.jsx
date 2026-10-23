// Companies in Tally (23-Oct-2026, next-tally-suvit; the owner: "make sure it should connect like Suvit.. every step..
// thoroughly.. don't need extra steps in connection"). Suvit's connector lists the companies open in Tally ("Add
// Companies"); Subscribe makes one a company on the website, its first sync starts by itself and a message says the
// ledgers are synced; "My Companies" says Connected / Disconnected and has Sync master. FinCom does the same in ONE list:
// every company the firm's computers have seen (tally_companies, and what their heartbeats say is open), open now first,
// then the latest seen. Each row: the company, its computer, the status pill (lib/tallyState.js, the words every place
// uses), the last entry or last seen, and ONE action:
//   not linked   "Add as client": the client is made with the company's name (its period taken off, clientNameFromTally)
//                and GSTIN, linked (tallyLinkClient: tally_company_link, the person's own choice), and the first sync
//                starts by itself (Ledgers.askTally: the ledgers wake, one call); the row shows the progress, then
//                "Ledgers 1,240 ✓ · Entries Apr–Oct 2026 ✓". A client of the same name or GSTIN already there
//                (similarClients, server/_shared/tallyname.js): "Link to <client>" instead, never a second client.
//   linked       the client (opens it), "Sync now" (Update now: tallyUpdateNow) and ⋯: Not this client (link another
//                client, or unlink), Open client, and "Upload older entries (Day Book)" only while days are missing.
// The same rows are Add client's "Pick from Tally" and, for a client not linked, its Tally card's choice (with Link).
// Nothing new is asked of the bridge, the cloud or Tally: the same RPCs, wake and reads as before.
import { useState, useEffect } from "react";
import { seenWords, tallyCoState, tallyDevs, openOn, pcOf, pcLive, coKey } from "../lib/tallyState.js";
import { lastEntry } from "./TallyLink.jsx";
import "./tallyCompanies.css";

const SEARCH_AT = 10, POLL_MS = 10000, WAIT_MS = 10 * 60000;
const canWrite = () => (S.account && S.account.me ? ["owner", "staff"].includes(S.account.me.role) : true);
const live = () => Object.values(S.companies || {}).filter((c) => c && !c.deleted);
const nOf = (n, one, many) => Number(n).toLocaleString("en-IN") + " " + (n === 1 ? one : many);
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------- what FinCom holds of a client's books (the cloud's book, tally_status; its ledgers' count, tally_ledgers)
export const d8Of = (x) => String(x || "").replace(/-/g, "").slice(0, 8);
export function fyStart() { const t = new Date(Date.now() + 5.5 * 3600e3), y = t.getUTCFullYear() - (t.getUTCMonth() < 3 ? 1 : 0); return y + "0401"; }
export const cloudBook = (cid) => (typeof TCloud === "object" && TCloud.on() && TCloud.book ? TCloud.book(cid) : null);
// round 64: the cloud's own count of a client's ledgers, kept with its books (TCloud.st[cid].ledN) for a minute
export const LED_N = { get: (cid) => ((TCloud.st || {})[cid] || {}).ledN, set: (cid, v) => { (TCloud.st[cid] = TCloud.st[cid] || {}).ledN = v; } };
export async function cloudLedgerCount(cid, force, maxAge) {
  const bk = cloudBook(cid);
  if (!bk || !bk.book) return null;
  const k = LED_N.get(cid);
  if (!force && k && k.book === bk.book && Date.now() - k.at < (maxAge || 60000)) return k.n;
  const path = "tally_ledgers?select=name&merged_into=is.null&limit=1&book_id=eq." + encodeURIComponent(bk.book);
  const ask = (pp) => Cloud.api(pp, { headers: { Prefer: "count=exact" }, count: true });
  let n;
  try { n = await ask(path + (TCloud.hasDel === false ? "" : "&deleted_at=is.null")); }
  catch (e) { if (!/deleted_at|42703/i.test(String((e && e.message) || e))) throw e; n = await ask(path); }
  n = Array.isArray(n) ? n.length : Math.max(0, Math.floor(Number(n) || 0));
  LED_N.set(cid, { n, at: Date.now(), book: bk.book });
  return n;
}
export const ledgersOf = (cid) => Math.max(typeof Ledgers === "object" ? Ledgers.status(cid).n || 0 : 0, (LED_N.get(cid) || {}).n || 0);
export const ledgersHeld = (cid) => ledgersOf(cid) > 0 || !!(cloudBook(cid) || {}).ledgersAt;
export function daybookHeld(cid) {
  const bk = cloudBook(cid), fy = fyStart();
  if (bk && Number(bk.days) > 0 && d8Of(bk.to) >= fy) return true;
  const b = S.books && S.books.cid === cid ? S.books : null;
  return !!(b && (b.vouchers || []).some((v) => v && String(v.date) >= fy));
}
// "Apr–Oct 2026" / "Dec 2025–Jan 2026": the months of entries FinCom holds
export function entriesWords(bk) {
  const f = d8Of(bk && bk.from), t = d8Of(bk && bk.to);
  if (!/^\d{8}$/.test(t)) return "";
  const m = (x) => MON[Number(x.slice(4, 6)) - 1], from = /^\d{8}$/.test(f) && f <= t ? f : t;
  return from.slice(0, 4) === t.slice(0, 4) ? (m(from) === m(t) ? m(t) + " " + t.slice(0, 4) : m(from) + "–" + m(t) + " " + t.slice(0, 4)) : m(from) + " " + from.slice(0, 4) + "–" + m(t) + " " + t.slice(0, 4);
}
// days of this year not in FinCom: none at all, or days Tally did not give (Rec.gapFor)
export function oldDaysMissing(cid) {
  const s = (TCloud.st || {})[cid];
  if (!s || !s.at) return false;
  const gaps = typeof Rec === "object" && Rec.gapFor ? (Rec.gapFor(cid) || []).length : 0;
  return gaps > 0 || !daybookHeld(cid);
}
// Books › From Tally's Upload, for a client (JobsNote there says how far the server has read a Day Book)
export function openFromTally(cid) {
  const h = "#/c/" + encodeURIComponent(cid) + "/from-tally";
  if (typeof history !== "undefined") { try { history.pushState(null, "", location.pathname + location.search + h); } catch (e) { /* */ } }
  if (typeof Route === "object" && Route.apply) Route.apply(h); else openCompany(cid).then(() => { S.tab = "books"; S.booksTab = "import"; render(); });
}
// the linked clients' books, read a few at a time (each kept 5 minutes; TCloud.status keeps each 30 seconds)
let booksBusy = false;
export function booksLoad(cids) {
  if (booksBusy || typeof TCloud !== "object" || !TCloud.on()) return;
  const want = cids.filter((cid) => { const s = TCloud.st[cid]; return !s || !s.at || Date.now() - s.at > 300000; }).slice(0, 25);
  if (!want.length) return;
  booksBusy = true;
  Promise.all(want.map((cid) => Promise.resolve(TCloud.status(cid)).then(() => (ledgersOf(cid) > 0 ? null : cloudLedgerCount(cid))).catch(() => null)))
    .finally(() => { booksBusy = false; render(); });
}

// ---------- the companies
// [{company, gstin, client (id or ""), device (id), seen, st (tallyCoState), at (sort key)}]: every company a computer of
// the firm reported or has open now, once each (the name compared as ledNm does), open now first, then the latest seen
export function companyRows() {
  const by = new Map(), put = (name, x) => { const k = coKey(name); if (!k) return; const r = by.get(k) || { company: String(name).trim(), gstin: "", client: "", device: "", seen: "" };
    by.set(k, Object.assign(r, { gstin: r.gstin || x.gstin || "", client: r.client || x.client || "", device: r.device || x.device || "", seen: [r.seen, x.seen || ""].sort().pop() })); };
  [].concat((typeof TLight === "object" && TLight.st.cos) || [], (TCloud.pane || {}).companies || [])
    .forEach((r) => { if (r && r.company) put(r.company, { gstin: r.gstin, client: String(r.client_id || ""), device: r.device_id || "", seen: r.last_seen || "" }); });
  tallyDevs().forEach((d) => { if (pcLive(d)) openOn(d).forEach((n) => put(n, { device: d.id, seen: ((d.info || {}).beat || {}).at || "" })); });
  try { if (typeof Bridge === "object" && Bridge.up()) [].concat(Bridge.st.open || []).forEach((o) => { if (o && o.name) put(o.name, {}); }); } catch (e) { /* no bridge here */ }
  // a client deleted here: its company is not linked to anyone FinCom shows
  const rows = [...by.values()].map((r) => { const co = r.client && S.companies && S.companies[r.client]; return Object.assign(r, { client: co && co.deleted ? "" : r.client, st: tallyCoState(r.company) }); });
  return rows.sort((a, b) => ((b.st.state === "connected") - (a.st.state === "connected")) || String(b.seen).localeCompare(String(a.seen)) || a.company.localeCompare(b.company));
}
// a client of the same name (the period off) or the same GSTIN, already in FinCom: the row links to it, never a second one
export function twinOf(r) {
  if (typeof similarClients !== "function") return null;
  const name = typeof clientNameFromTally === "function" ? clientNameFromTally(r.company) : r.company;
  const t = similarClients(name, r.gstin || "", live()).find((d) => d.why === "same" || d.why === "gstin");
  return t ? t.client : null;
}

// ---------- the actions
// the link (tallyLinkClient: tally_company_link, then the client's Tally name). Drawn inside the client's setup (its
// Tally card), the Tally name it sets is the link's, not the person's edit of the section: it is not left as "Not saved
// yet: Tally" there, and it is saved at once (Drafts.direct, src/js/60)
export async function linkClient(company, cid) {
  const D = typeof Drafts === "object" && Drafts.secs ? Drafts : null;
  if (D) D.attributeAll();
  const ok = await tallyLinkClient(company, cid);
  if (ok && D && cid) {
    Object.values(D.secs).forEach((s) => { if (s.paths) s.paths.forEach((c, k) => { if (c && c.path && c.path[0] === "tallyName") s.paths.delete(k); }); if (s.armed && s.stores) s.pre = s.stores.map((st) => st.snap()); });
    const co = S.companies[cid]; if (co) D.direct(() => Store.saveCompany(co), { bypass: true });
  }
  return ok;
}
// Add as client: made with the company's name and GSTIN, linked, the first sync started. The client is made as Add
// client makes it (newCompany, Store.saveCompany: saveNewCompany's own steps), without leaving the page (Suvit's list
// stays where it is). Returns the client's id, or "" when nothing was added.
export async function addAsClient(r) {
  const tw = twinOf(r);
  if (tw) return (await linkTo(r, tw)) ? tw.id : "";
  const name = typeof clientNameFromTally === "function" ? clientNameFromTally(r.company) : r.company;
  const g = String(r.gstin || "").trim().toUpperCase(), gstin = g && typeof gstinValid === "function" && gstinValid(g) ? g : "";
  const co = newCompany({ name, gstin, tallyName: r.company, turnover10cr: false });
  S.companies[co.id] = co; S.data[co.id] = { parties: {}, entries: {}, loaded: true };
  co.stats = { drafts: 0, check: 0, waiting: 0, tdsFy: 0, invoicesFy: 0, records: 1, fy: fyOf(null) };
  Store.saveCompany(co);
  render();
  const ok = await linkClient(r.company, co.id);
  if (!ok) { toast(name + " was added; link it to " + r.company + " from its row."); return co.id; }
  firstSync(co.id, r.company);
  return co.id;
}
// Link (to a client already in FinCom): asked first when the client is linked to another company now (it moves)
export async function linkTo(r, co) {
  const was = typeof tallyLinkOf === "function" ? (tallyLinkOf(co) || {}).company || "" : "";
  if (was && coKey(was) !== coKey(r.company)) {
    const ok = await askConfirm({ title: "Link " + co.name + " to " + r.company + "?", ok: "Link this company",
      body: "<p>" + esc(co.name) + " is linked to <b>" + esc(was) + "</b> now. It will be linked to <b>" + esc(r.company) + "</b> instead, and " + esc(was) + " unlinked. Nothing in Tally changes.</p>" });
    if (!ok) return false;
  }
  const ok = await linkClient(r.company, co.id);
  if (ok) firstSync(co.id, r.company);
  return ok;
}
// the first sync of a client just added or linked (Suvit: "the first sync starts by itself"): the ledgers wake (one call,
// Ledgers.askTally: the bridge here when it has the company open, else FinCom's cloud, tally-ingest's wake "ledgers"),
// then FinCom's cloud is read every 10 seconds until the ledgers and this year's entries are in (10 minutes at most).
// S.tcoSync[cid] = {cid, company, at, via, err, end, late, led, prog}
const SYNC = () => (S.tcoSync = S.tcoSync || {});
export async function firstSync(cid, company) {
  const x = SYNC()[cid] = { cid, company: company || "", at: Date.now(), via: "", err: "", end: 0, late: false, led: null, prog: null };
  render();
  let r;
  try { r = await Ledgers.askTally(cid); } catch (e) { r = { err: (e && e.message) || String(e) }; }
  const a = (r && r.ans) || {};
  x.via = (r && r.via) || "";
  if (r.err) x.err = "Could not ask Tally: " + r.err;
  else if (!r.via) x.err = "FinCom’s cloud does not reach the Tally computer: sign in to the firm account.";
  else if (r.via === "bridge" && a.started === false && !a.debounced) x.err = "FinCom Bridge did not read " + (x.company || "the company") + "’s ledgers: " + (a.why || "it did not start") + ".";
  else if (r.via === "cloud" && a.notLinked) x.err = "The client is not linked to its company in Tally yet.";
  // nobody asked (and not because one was asked a moment ago): no computer holds the company now
  else if (r.via === "cloud" && a.woken !== undefined && !Number(a.woken) && (a.asked === undefined ? !Number(a.debounced) : !Number(a.asked)))
    x.err = "No computer with Tally was asked: FinCom has no computer that holds " + (x.company || "the company") + " now. Open it in TallyPrime on the Tally computer, with FinCom Bridge running; then Try again.";
  render();
  setTimeout(() => syncPoll(cid), 1500);
}
const polling = {};
export async function syncPoll(cid) {
  const x = SYNC()[cid];
  if (!x || x.end || x.err || x.late || polling[cid]) return;
  polling[cid] = true;
  try {
    try { await TCloud.status(cid, true); } catch (e) { /* the next read */ }
    let n = null; try { n = await cloudLedgerCount(cid, true); } catch (e) { /* */ }
    // 2.4.5: the exact count while the bridge reads ("312 of 1,240 ledgers"; tally_period_status's ledger)
    try { const bk = cloudBook(cid), p = bk && bk.book ? await TCloud.rpc("tally_period_status", { p_book: bk.book }) : null, lp = p && p.ledger;
      if (lp && Date.parse(lp.at) >= x.at - 60000) { x.prog = lp; if (lp.done && Number(lp.read) > 0 && n == null) n = Number(lp.read); } } catch (e) { /* */ }
    if (n != null) x.led = n;
    // the ledgers are in: a count, or the book's ledger time set since this sync began (the bridge's whole list sets it)
    const la = Date.parse((cloudBook(cid) || {}).ledgersAt || "") || 0;
    if (!(x.led > 0) && la >= x.at - 60000) x.led = ledgersOf(cid) || -1;
    if ((x.led > 0 || x.led === -1) && daybookHeld(cid)) x.end = Date.now();
    else if (Date.now() - x.at > WAIT_MS) x.late = true;
  } finally { polling[cid] = false; render(); }
}

// ---------- the progress and the confirmation (a row of the list, and the client's Tally card)
function Masters({ cid }) {
  const [busy, setBusy] = useState(false), [res, setRes] = useState(null);
  const up = async (ev) => { const f = (ev.target.files || [])[0]; ev.target.value = ""; if (!f) return;
    setBusy(true); const r = await Ledgers.fromMasters(cid, f); setBusy(false); setRes(r);
    if (r.ok) { LED_N.set(cid, { n: r.n, at: Date.now(), book: (cloudBook(cid) || {}).book || "" }); const x = SYNC()[cid]; if (x) { x.led = r.n; if (x.late) x.at = Date.now(); x.late = false; x.err = ""; } render(); } };
  return <><label className="btn small" data-tco-masters="" title="TallyPrime: Gateway → Display More Reports → List of Accounts → Alt+E → XML (Masters)">{busy ? "Reading the file…" : "Or upload the masters file"}
    <input type="file" accept=".xml" hidden onChange={up} /></label>
    {res && !res.ok && <span className="bk-warn" data-tco-masters-err="">{res.err}</span>}</>;
}
export function SyncLine({ cid, compact = false }) {
  const [, tick] = useState(0);
  const x = (S.tcoSync || {})[cid], running = !!(x && !x.end && !x.err && !x.late);
  useEffect(() => { if (!running) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [running]);
  useEffect(() => { if (!running) return; const t = setInterval(() => syncPoll(cid), POLL_MS); return () => clearInterval(t); }, [running, x && x.at]);
  const co = S.companies && S.companies[cid], bk = cloudBook(cid), n = Math.max(ledgersOf(cid), (x && x.led) || 0), days = daybookHeld(cid);
  // the ledgers: their count when FinCom has it, else ✓ alone when the book says they came (tally_books.ledgers_at)
  const ledIn = n > 0 || (x ? x.led === -1 : !!(bk && bk.ledgersAt));
  const led = ledIn ? "Ledgers " + (n > 0 ? Number(n).toLocaleString("en-IN") + " " : "") + "✓" : "", ent = days ? "Entries " + (entriesWords(bk) || "this year") + " ✓" : "";
  if (x && x.end) return <p className="tco-sync ok" data-tco-sync="done" role="status">{led + " · " + ent}<span className="note">{" · first sync took " + mmss(x.end - x.at)}</span></p>;
  if (running) return <div className="tco-sync" data-tco-sync="running" role="status">
    <div className="tco-bar" role="progressbar" aria-label={"Reading " + ((co && co.name) || "the company") + " from Tally"} aria-busy="true"><i /></div>
    <span>{led ? <>{led + " · "}<b>Reading entries…</b></> : <><b>Reading ledgers from Tally…</b>{x.prog && Number(x.prog.of) > 0 ? " " + Number(x.prog.read).toLocaleString("en-IN") + " of " + nOf(Number(x.prog.of), "ledger", "ledgers") : ""}</>}
      {" "}<b className="tco-clock">{mmss(Date.now() - x.at)}</b><span className="note">{x.via === "cloud" ? " · the Tally computer picks it up within a minute" : ""}</span></span></div>;
  if (x && (x.err || x.late)) return <div className="tco-sync bad" data-tco-sync={x.err ? "error" : "late"} role="status">
    <span>{x.err || (led ? led + " · Entries not received yet: keep " + (x.company || "the company") + " open in TallyPrime; they come by themselves."
      : "Ledgers not received in 10 minutes: keep " + (x.company || "the company") + " open in TallyPrime on its computer, with reading not paused.")}</span>
    <span className="tco-sync-acts"><button className="btn small" data-tco-sync-again={cid} onClick={() => firstSync(cid, x.company)}>Try again</button>{!led && <Masters cid={cid} />}</span></div>;
  // no first sync here now: what FinCom holds, when known
  if (compact || !(TCloud.st && TCloud.st[cid] && TCloud.st[cid].at)) return null;
  return <p className="note tco-sync" data-tco-sync="held">{[led ? (n > 0 ? "Ledgers " + Number(n).toLocaleString("en-IN") : "Ledgers in FinCom") : "Ledgers not in FinCom yet", ent ? ent.replace(" ✓", "") : "this year’s entries not in FinCom yet"].join(" · ")}</p>;
}

// ---------- one row
function Pill({ st }) {
  return <span className="tco-pill" data-tco-pill={st.state} data-tco-pill-text={st.text}>
    <span className={"tag " + st.level}>{st.word}</span>{st.state !== "connected" && <span className="tco-why">{st.text.replace(/^Disconnected/, "")}</span>}</span>;
}
// Not this client: another client of the firm, or unlinked (tallyLinkClient moves or unlinks; nothing in Tally changes)
function Relink({ r, co, onClose }) {
  const [pick, setPick] = useState(""), [busy, setBusy] = useState(false);
  const cs = live().filter((c) => c.id !== co.id).sort((a, b) => a.name.localeCompare(b.name));
  const go = async (cid) => { setBusy(true); const ok = await linkClient(r.company, cid || null); setBusy(false); if (ok) { if (cid) firstSync(cid, r.company); onClose(); } };
  const unlink = () => askConfirm({ title: "Unlink " + r.company + " from " + co.name + "?", ok: "Unlink", danger: true,
    body: "<p>Its books stop coming to " + esc(co.name) + ". FinCom will not link it again by itself. Nothing in Tally changes.</p>" }).then((ok) => { if (ok) go(null); });
  return <div className="tco-relink" data-tco-relink-box={r.company}>
    <span className="note">{r.company + " is not " + co.name + "’s? Link it to"}</span>
    <select data-tco-relink-pick="" aria-label={"The client " + r.company + " belongs to"} value={pick} onChange={(ev) => setPick(ev.target.value)}>
      <option value="">Choose a client…</option>{cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <button className="btn small primary" data-tco-relink="" disabled={!pick || busy} onClick={() => go(pick)}>Link</button>
    <button className="btn small" data-tco-unlink="" disabled={busy} onClick={unlink}>Unlink only</button>
    <button className="linkbtn" onClick={onClose}>Cancel</button></div>;
}
export function CompanyRow({ r, forCo = null, verb = "", onDone = null }) {
  const [busy, setBusy] = useState(""), [relink, setRelink] = useState(false);
  const co = r.client && S.companies ? S.companies[r.client] : null, may = canWrite(), st = r.st || tallyCoState(r.company);
  const k = co && typeof tallyLinkOf === "function" ? tallyLinkOf(co) : null;
  const last = co && k ? lastEntry(co, k) : "";
  const meta = [st.computer || "", last ? "last entry " + seenWords(last) : st.state === "connected" ? "open now" : r.seen ? "last seen " + seenWords(r.seen) : ""].filter(Boolean).join(" · ");
  const tw = !co && !forCo ? twinOf(r) : null, target = forCo || tw;
  const run = (kind, fn) => async () => { setBusy(kind); let id = ""; try { id = await fn(); } finally { setBusy(""); } if (id && onDone) onDone(id === true ? target.id : id); };
  const close = (fn) => (ev) => { const d = ev.currentTarget.closest("details"); if (d) d.open = false; fn(); };
  const syncing = co && k && k.line && k.line.reading;
  let act;
  if (r.client && !co) act = <span className="note" data-tco-elsewhere="">Linked to a client not on this computer</span>;
  else if (co) act = <>
    <button className="linkbtn tco-client" data-tco-client={co.id} onClick={() => openCompany(co.id)}>{co.name + " ›"}</button>
    {may && <button className="btn small" data-tco-sync-now={co.id} disabled={!!syncing} onClick={() => tallyUpdateNow(co.id)}>{syncing ? "Syncing…" : "Sync now"}</button>}
    <details className="bk-menu tco-more" data-tco-more={r.company}>
      <summary className="btn small" aria-label={"More for " + r.company}>⋯</summary>
      <div className="bk-menu-list">
        <button data-tco-open={co.id} onClick={close(() => openCompany(co.id))}>Open client<small>{co.name}</small></button>
        {may && <button data-tco-not-this={r.company} onClick={close(() => setRelink(true))}>Not this client<small>Link it to another client, or unlink it.</small></button>}
        {oldDaysMissing(co.id) && <button data-tco-daybook={co.id} onClick={close(() => openFromTally(co.id))}>Upload older entries (Day Book)<small>Days of this year not in FinCom yet: upload Tally’s Day Book once.</small></button>}
      </div></details></>;
  else if (!may) act = <span className="note">A member of the firm who may make changes adds it.</span>;
  else if (target) act = <button className={"btn small" + (forCo ? " primary" : "")} data-tco-act="link" data-tco-link={target.id} disabled={!!busy} onClick={run("link", () => linkTo(r, target))}>
    {busy ? "Linking…" : verb || "Link to " + target.name}</button>;
  else act = <button className="btn small primary" data-tco-act="add" disabled={!!busy} onClick={run("add", () => addAsClient(r))}>{busy ? "Adding…" : "Add as client"}</button>;
  return <li className="tco-row" data-tco-row={r.company} data-tco-state={st.state} data-tco-linked={co ? co.id : ""} data-why={r.why || undefined}>
    <div className="tco-main"><b className="tco-name">{r.company}</b>
      {r.why && <span className={"tag " + (r.why === "like" ? "warn" : "ok")} data-tco-why={r.why}>{r.why === "gstin" ? "same GSTIN" : r.why === "name" ? "same name" : "similar name"}</span>}
      {meta && <span className="note tco-meta">{meta}</span>}</div>
    <Pill st={st} />
    <div className="tco-act">{act}</div>
    {co && <div className="tco-under"><SyncLine cid={co.id} /></div>}
    {relink && co && <div className="tco-under"><Relink r={r} co={co} onClose={() => setRelink(false)} /></div>}
  </li>;
}

// ---------- the list. rows: the rows to show (default: every company); forCo: the client the list links to (its card,
// or a pointer from it); show: how many before "Show all" (0: all)
export default function CompaniesInTally({ rows = null, forCo = null, verb = "", show = 0, title = "Companies in Tally", note = null, empty = null, onDone = null, hook = "firm" }) {
  const [q, setQ] = useState(""), [all, setAll] = useState(false);
  const list = rows || companyRows();
  useEffect(() => { booksLoad(list.filter((r) => r.client).map((r) => r.client)); });
  const k = list.length > SEARCH_AT ? coKey(q) : "", hits = k ? list.filter((r) => coKey(r.company).includes(k) || (r.client && S.companies[r.client] && coKey(S.companies[r.client].name).includes(k))) : list;
  const shown = show && !all && !k ? hits.slice(0, show) : hits;
  const nOpen = list.filter((r) => r.st && r.st.state === "connected").length;
  return <section className="tco" data-tco-list={hook} data-tco-n={list.length}>
    <div className="tco-head">{title && <h3>{title}</h3>}
      {title && list.length > 0 && <span className="note" data-tco-count="">{nOf(list.length, "company", "companies") + " · " + nOpen + " open in Tally now"}</span>}
      {list.length > SEARCH_AT && <input type="search" className="tco-q" data-tco-q="" aria-label="Find a company" placeholder="Find a company or client" value={q} onChange={(ev) => setQ(ev.target.value)} />}</div>
    {note}
    {list.length === 0 ? (empty || <p className="note" data-tco-empty="">No company seen in Tally yet. Open your company in TallyPrime on the computer with FinCom Bridge: it shows here within a minute.</p>)
      : <ul className="tco-rows">{shown.map((r) => <CompanyRow key={r.company} r={r} forCo={forCo} verb={verb} onDone={onDone} />)}</ul>}
    {k && !hits.length && <p className="note" data-tco-none="">No company matches “{q}”.</p>}
    {shown.length < hits.length && <button className="linkbtn" data-tco-all="" onClick={() => setAll(true)}>{"Show all " + hits.length}</button>}
  </section>;
}

// a client not linked (its Tally card): the rows it may be (not linked to another client), the likeliest first, each with
// Link (the link, then the first sync by itself)
export function ClientPick({ co }) {
  const list = companyRows().filter((r) => !r.client || String(r.client) === String(co.id));
  const ranked = typeof suggestFor === "function" ? suggestFor(co, list) : list;
  return <div className="tlink-choose" data-tally-link-choose="link">
    <CompaniesInTally rows={ranked} forCo={co} verb="Link" show={4} hook="card" title="Choose its company in Tally"
      empty={<p className="note" data-tco-empty="">{"FinCom has not seen a company in Tally that is not linked. Open " + co.name + "’s company in TallyPrime on the computer with FinCom Bridge; it shows here within a minute."}</p>} />
  </div>;
}
// Add client's Pick from Tally: the companies not linked to a client, the best match for what is typed (name or GSTIN) on
// top; Add as client (or Link to the client already there), then onDone(the client's id)
export function AddPick({ v, onDone }) {
  const list = companyRows().filter((r) => !r.client);
  const ranked = typeof suggestFor === "function" && (v.name || v.gstin) ? suggestFor({ id: "", name: v.name, gstin: v.gstin }, list) : list;
  return <div className="addc-pick" data-add-pick={ranked.length}>
    <CompaniesInTally rows={ranked} show={6} hook="add" title="Pick from Tally" onDone={onDone}
      note={ranked.length ? <p className="note" style={{ margin: "0 0 4px" }}>The companies FinCom has seen in Tally and not linked to a client yet. One click adds the client, links it and brings its books.</p> : null}
      empty={<p className="note" data-tco-empty="">No Tally company is waiting to be added. Open the client’s company in TallyPrime on a computer with FinCom Bridge and it shows here within a minute, or type the client below.</p>} />
  </div>;
}
