// 30-Oct-2026 (the owner: "there should be two ways.. one is automatically updating books from tally and giving progress
// bar and timing with that bar.. also if anyone uploads any books and there is any difference.. it should find out the
// difference in tally and correct it"; "tally should not hang"). Supersedes the 26-Oct "upload only" decision. Its own
// file, loaded only with the Tally page and Books › From Tally (the app's first file and legacy.js stay within budget):
//   OlderEntries   Books › From Tally: "Bring books from Tally: [FY 2026-27 ▾] Start", Pause / Resume / Stop (owner or
//                  staff), the bar "8,412 of 12,960 entries (65%) · about 40 min left · started 10:42 · 210 entries a
//                  minute" ("working out the time…" until the pace is known); paused or stopped says why in plain words
//                  ("Stopped: Tally was busy; press Resume."); a computer whose reading of older entries is off: the
//                  owner's one click "Turn on for this computer" (tally_device_period_fetch)
//   OlderLine      the same progress in one line on the Tally page (a client's row)
//   TodayLine      "Today from Tally: 3 entries added · 2 changed · 1 deleted (last 15:42)", opening the list (date, voucher
//                  type and number, party, amount, what happened); the counts are the list's own; never a computer's name
//   TodayStatus    the same per company on the Tally page's status card
//   UploadCheck    Books › From Tally: an uploaded Day Book checked against Tally's own day lists and corrected to Tally
//                  ("12-Aug: 2 entries in Tally not in the upload (added) · 15-Sep: 1 changed (updated) · 3-Oct: 1 deleted
//                  in Tally (removed, kept in history)", the days the same ticked, a total line)
// The cloud keeps it all (migrations 98 and 133: tally_fetch_summary, tally_period_choose / pause / cancel,
// tally_check_status / resume, tally_today_from_tally); a cloud without 133 shows nothing of it. Nothing new is asked of
// Tally: the bridge reads one day at a time, only while Tally is idle, each request stopped at 2 s, postings first.
import { useEffect, useRef, useState } from "react";
import "./tallyCompanies.css";

export const nf = (n) => Number(n || 0).toLocaleString("en-IN");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const day8 = (d) => { const s = String(d || "").replace(/-/g, ""); return s.length === 8 ? Number(s.slice(6, 8)) + "-" + MON[Number(s.slice(4, 6)) - 1] : ""; };
export const dayLong = (d) => { const s = String(d || "").replace(/-/g, ""); return s.length === 8 ? s.slice(6, 8) + "-" + MON[Number(s.slice(4, 6)) - 1] + "-" + s.slice(0, 4) : ""; };
// a time of day as every page says it: India's time, "10:42 IST", whatever this computer's clock
export const hm = (at) => { const t = Date.parse(at || ""); return t ? new Date(t + 5.5 * 3600e3).toISOString().slice(11, 16) + " IST" : ""; };
export function fyNow() { const t = new Date(Date.now() + 5.5 * 3600e3); return t.getUTCFullYear() - (t.getUTCMonth() < 3 ? 1 : 0); }
const fyOfDate = (d) => { const s = String(d || "").replace(/-/g, ""); if (s.length < 6) return 0; const y = Number(s.slice(0, 4)), m = Number(s.slice(4, 6)); return m < 4 ? y - 1 : y; };
export const fyLabel = (y) => "FY " + y + "-" + String(y + 1).slice(2);
export const plural = (n, one, many) => nf(n) + " " + (Number(n) === 1 ? one : many);
export const rpc = (fn, args) => (typeof TCloud === "object" && TCloud.rpc ? TCloud.rpc(fn, args) : Promise.reject(new Error("no cloud")));
export const missing = (e) => /PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(String((e && e.message) || e));
// owner or staff change it; a member who may only look sees it (as the Tally page's rows)
export const may = () => (typeof S === "object" && S.account && S.account.me ? ["owner", "staff"].includes(S.account.me.role) : true);
const owner = () => !!(typeof S === "object" && S.account && S.account.me && S.account.me.role === "owner");
const redraw = () => { if (typeof render === "function") render(); };

// ---------- the firm's summary (one call for the Tally page and From Tally; read again every 30 s, at once after a click)
const SUM = { at: 0, busy: false, books: null, off: false };
export function summary(force = false) {
  if (typeof TCloud !== "object" || !TCloud.on || !TCloud.on() || SUM.off) return null;
  if (!SUM.busy && (force || Date.now() - SUM.at > 30000)) {
    SUM.busy = true;
    rpc("tally_fetch_summary", { p_book: null }).then((r) => { if (r && r.ok && Array.isArray(r.books)) SUM.books = r.books; },
      (e) => { if (missing(e)) SUM.off = true; }).finally(() => { SUM.at = Date.now(); SUM.busy = false; redraw(); });
  }
  return SUM.books;
}
function bookOf(cid) {
  const s = typeof TCloud === "object" && TCloud.st ? TCloud.st[cid] : null, bs = s && Array.isArray(s.books) ? s.books : [];
  return bs.find((b) => b && b.book && b.from) || bs.find((b) => b && b.book) || null;
}
export function bookSum(cid) {
  const books = summary(), bk = bookOf(cid);
  if (!books) return null;
  return (bk && books.find((x) => x.book === bk.book)) || books.filter((x) => x.client === cid).sort((a, b) => String(b.from || "").localeCompare(String(a.from || "")))[0] || null;
}
// (read again at once from outside, e.g. after the person's own change elsewhere on the page)
if (typeof window === "object") window.tfxRefresh = () => { askStatus(true); return summary(true); };
// 30-Oct-2026 (migration 135): the firm's presses of "Check for changes in Tally" and each book's other lines (the missing
// days being brought, the year chosen in days, the Tally computer's office hours): one call, read again every 30 s (every
// 10 s while something goes), at once with the summary (tfxRefresh); a cloud without 135: nothing of them
const ASK = { at: 0, busy: false, asks: null, books: null, off: false };
export function askStatus(force = false) {
  if (typeof TCloud !== "object" || !TCloud.on || !TCloud.on() || ASK.off) return null;
  const going = (ASK.asks || []).some((k) => k.state !== "done") || (ASK.books || []).some((x) => x.fill && x.fill.waiting > 0);
  if (!ASK.busy && (force || Date.now() - ASK.at > (going ? 10000 : 30000))) {
    ASK.busy = true;
    rpc("tally_check_ask_status", { p_client: null }).then((r) => { if (r && r.ok && Array.isArray(r.asks)) { ASK.asks = r.asks; ASK.books = Array.isArray(r.books) ? r.books : []; } },
      (e) => { if (missing(e)) ASK.off = true; }).finally(() => { ASK.at = Date.now(); ASK.busy = false; redraw(); });
  }
  return ASK.asks;
}
export const askOff = () => ASK.off;
// a book's other lines (fill, lean, hours) by its id, or the client's
export function bookFetch(cid, book) { askStatus(); const l = ASK.books || []; return l.find((x) => x.book === book) || l.find((x) => x.client === cid) || null; }
// the honest pace (the owner, 30-Oct-2026, 16:30): office hours, a few days at a time while Tally is free; outside them up
// to 30 days at a time ("" when the hours are not known)
const hh = (h) => String(h).padStart(2, "0") + ":00";
export function nightNow(h, now = Date.now()) {
  if (!h) return false;
  const t = new Date(now + 5.5 * 3600e3), hr = t.getUTCHours(), from = Number(h.from), to = Number(h.to);
  if (h.sunday !== false && t.getUTCDay() === 0) return true;
  if (from === to) return false;
  return from < to ? hr >= from && hr < to : hr >= from || hr < to;
}
export function paceWords(h) {
  if (!h || h.from == null || h.to == null) return "";
  return nightNow(h) ? "Night pace (" + hh(h.from) + "–" + hh(h.to) + "): up to 30 days at a time."
    : "Office hours pace: a few days at a time, only while Tally is free; faster from " + hh(h.from) + " (up to 30 days at a time).";
}
// keep the summary fresh while something is going on (a period being read, an upload being checked)
function useLive(on) {
  const [, tick] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => { summary(true); tick((n) => n + 1); }, 15000); return () => clearInterval(t); }, [on]);
}

// ---------- the period's words
export function etaWords(min) {
  const m = Math.round(Number(min));
  if (!(m > 0)) return "";
  if (m < 60) return "about " + m + " min";
  const r = Math.round(m / 10) * 10, h = Math.floor(r / 60), mm = r % 60;
  return "about " + h + " h" + (mm ? " " + mm + " min" : "");
}
const fyOf8 = (d8) => Number(String(d8 || "").slice(0, 4)) || 0;
export const partWords = (p) => fyLabel(fyOf8(p.fy)) + (p.part === "h1" ? " Apr–Sep" : p.part === "h2" ? " Oct–Mar" : "");
export function pctOf(p) {
  if (!p) return 0;
  if (p.counting) return Number(p.yearDays) > 0 ? Math.min(99, Math.round((Number(p.countedDays) * 100) / Number(p.yearDays))) : 0;
  const y = Number(p.y || 0), x = Math.min(Number(p.x || 0), y);
  if (!y) return p.done ? 100 : 0;
  const pc = Math.round((x * 100) / y);
  return x < y && pc >= 100 ? 99 : pc;
}
// "8,412 of 12,960 entries (65%) · about 40 min left · started 10:42 · 210 entries a minute"
export function pullWords(p) {
  if (!p) return "";
  const going = p.state === "going" && !p.done;
  const eta = going ? (Number(p.etaMin) > 0 ? " · " + etaWords(p.etaMin) + " left" : " · working out the time…") : "";
  const started = p.chosenAt && hm(p.chosenAt) ? " · started " + hm(p.chosenAt) : "";
  if (p.counting) return "Counting the year in Tally: " + nf(p.countedDays) + " of " + nf(p.yearDays) + " days (" + pctOf(p) + "%)" + eta + started;
  const y = Number(p.y || 0), x = Math.min(Number(p.x || 0), y);
  if (p.done) return "All " + plural(y, "entry", "entries") + " of " + partWords(p) + " are in FinCom ✓";
  if (!y) return "Tally lists no entries for this period yet" + eta + started;
  return nf(x) + " of " + plural(y, "entry", "entries") + " (" + pctOf(p) + "%)" + eta + started + (going && Number(p.rate) > 0 ? " · " + nf(p.rate) + " entries a minute" : "");
}
// why it is not moving, in plain words (paused, stopped, the computer, Tally busy); "" when it is moving
export function whyWords(p, b) {
  if (!p || p.done) return "";
  if (p.state === "paused") return "Paused. Press Resume to go on.";
  if (p.state === "stopped") return (p.stopped && p.stopped.why === "person") ? "Stopped. Press Start to begin again." : "Stopped: Tally was busy; press Resume.";
  const devs = (b && b.devices) || [];
  if (!devs.length) return "Waiting: open " + ((b && b.company) || "the company") + " in TallyPrime on the Tally computer, with FinCom Bridge running.";
  if (!devs.some((d) => d.fetchOn)) return "Waiting: reading older entries is off for the Tally computer that has this company.";
  if (!p.pace) return "Waiting for Tally to be free: FinCom reads only while nobody is working in Tally and nothing is being posted.";
  return "";
}
function Bar({ p, label }) {
  const pc = pctOf(p);
  return <div className="tco-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pc} data-tfx-pct={pc}>
    <i className="det" style={{ width: Math.max(2, pc) + "%" }} /></div>;
}
export function TurnOn({ b, onDone }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const off = ((b && b.devices) || []).filter((d) => !d.fetchOn);
  if (!off.length || ((b && b.devices) || []).some((d) => d.fetchOn)) return null;
  if (!owner()) return <span className="note" data-tfx-turnon-who="">{" An owner of the firm can turn it on."}</span>;
  const go = () => { setBusy(true); setErr("");
    rpc("tally_device_period_fetch", { p_device: off[0].id, p_on: true }).then((r) => { if (r && r.ok === false) throw new Error(r.error || "not done"); summary(true); if (onDone) onDone(); },
      (e) => setErr(String((e && e.message) || e).replace(/^ERROR:\s*/i, ""))).finally(() => setBusy(false)); };
  return <>{" "}<button className="btn small primary" data-tfx-turnon={off[0].id} disabled={busy} onClick={go}>{busy ? "Turning on…" : "Turn on for this computer"}</button>
    {err && <span className="bad" data-tfx-turnon-err="">{" " + err}</span>}</>;
}

// ---------- Books › From Tally: Bring books from Tally
export default function OlderEntries({ cid }) {
  const b = bookSum(cid), [fy, setFy] = useState(0), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const book = (b && b.book) || "", cur = useRef(book); cur.current = book;
  useEffect(() => { setFy(0); setErr(""); }, [book]);
  const p = b && b.pull;
  useLive(!!(p && p.state === "going" && !p.done));
  if (!b) return null;
  const now = fyNow(), first = Math.max(fyOfDate(b.from) || now - 5, now - 5), years = [];
  for (let y = now; y >= first; y--) years.push(y);
  const chosenFy = fy || (p ? fyOf8(p.fy) : now), same = !!(p && fyOf8(p.fy) === chosenFy);
  const act = (fn, args, what) => { const bk = book; setBusy(what); setErr("");
    return rpc(fn, args).then((r) => { if (cur.current !== bk) return; if (r && r.ok === false) setErr(String(r.error || "FinCom did not take it")); summary(true); },
      () => { if (cur.current === bk) setErr("FinCom’s cloud did not answer; try again in a minute."); }).finally(() => setBusy("")); };
  // 30-Oct-2026, 16:30 (the owner): Start walks only the days FinCom lacks (tally_period_choose_lean, migration 135: the days
  // FinCom already holds set aside); a cloud without 135: 98's tally_period_choose as before
  const start = () => { const args = { p_book: book, p_fy_start: chosenFy + "-04-01", p_part: same && p.part ? p.part : "year" }, bk = book; setBusy("start"); setErr("");
    rpc("tally_period_choose_lean", args).catch((e) => { if (missing(e)) return rpc("tally_period_choose", args); throw e; })
      .then((r) => { if (cur.current !== bk) return; if (r && r.ok === false) setErr(String(r.error || "FinCom did not take it")); summary(true); askStatus(true); },
        () => { if (cur.current === bk) setErr("FinCom’s cloud did not answer; try again in a minute."); }).finally(() => setBusy("")); };
  const pause = (on) => act("tally_period_pause", { p_book: book, p_pause: on }, on ? "pause" : "resume");
  const stop = () => act("tally_period_cancel", { p_book: book }, "stop");
  // the bridge stopped it (Tally busy): Resume is a fresh choice of the same period (the bridge reads the company again)
  const resumeStopped = () => act("tally_period_choose", { p_book: book, p_fy_start: fyOf8(p.fy) + "-04-01", p_part: p.part || "year" }, "resume");
  const going = !!(p && same && p.state === "going" && !p.done), paused = !!(p && same && p.state === "paused"), stoppedT = !!(p && same && p.state === "stopped" && !(p.stopped && p.stopped.why === "person"));
  const why = p ? whyWords(p, b) : "";
  const bf = bookFetch(cid, book), lean = p && bf && bf.lean && fyOf8(bf.lean.fy) === fyOf8(p.fy) ? bf.lean : null, pace = paceWords(bf && bf.hours);
  return <section className="dash-card tfx-older" data-older-entries="books" style={{ marginBottom: 12 }}>
    <h3>Bring books from Tally</h3>
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select data-older-fy="" aria-label="Financial year to bring from Tally" value={chosenFy} disabled={!may()} style={{ width: "auto", minWidth: 0 }} onChange={(ev) => setFy(Number(ev.target.value))}>
        {years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>
      {may() && !going && !paused && !stoppedT && <button className="btn small primary" data-older-start="" disabled={!!busy} onClick={start}>{busy === "start" ? "Starting…" : "Start"}</button>}
      {may() && going && <button className="btn small" data-older-pause="" disabled={!!busy} onClick={() => pause(true)}>Pause</button>}
      {may() && paused && <button className="btn small primary" data-older-resume="" disabled={!!busy} onClick={() => pause(false)}>Resume</button>}
      {may() && stoppedT && <button className="btn small primary" data-older-resume="" disabled={!!busy} onClick={resumeStopped}>Resume</button>}
      {may() && (going || paused) && <button className="btn small" data-older-stop="" disabled={!!busy} onClick={stop}>Stop</button>}
    </div>
    {p && <div className="tco-sync" data-older-progress={p.done ? "done" : p.counting ? "counting" : "fetching"} data-older-state={p.state} role="status" style={{ marginTop: 8 }}>
      {!p.done && <Bar p={p} label={"Bringing " + partWords(p) + " from Tally"} />}
      <span data-older-words="" className={p.done ? "ok" : ""}>{partWords(p) + ": " + pullWords(p)}</span></div>}
    {lean && <p className="note" data-older-lean="" style={{ margin: "4px 0 0" }}>{nf(lean.days) + " days: " + nf(lean.already) + " already in FinCom, " + nf(lean.toBring) + " to bring" +
      (Number(lean.upload) ? ", " + nf(lean.upload) + " to upload by hand" : "") + "."}</p>}
    {p && p.state === "going" && !p.done && pace && <p className="note" data-older-pace={nightNow(bf && bf.hours) ? "night" : "day"} style={{ margin: "4px 0 0" }}>{pace}</p>}
    {why && <p className={"note" + (p.state === "stopped" ? " bad" : "")} data-older-why={p.state} style={{ margin: "6px 0 0" }}>{why}
      {p.state === "going" && <TurnOn b={b} />}</p>}
    {err && <p className="note bad" data-older-err="" style={{ margin: "4px 0 0" }}>{err}</p>}
    {p && (p.upload || []).map((u) => <p key={u.day} className="note" data-older-upload={u.day} style={{ margin: "4px 0 0" }}>{u.words + " "}
      <button className="linkbtn" data-older-upload-go={u.day} onClick={() => typeof tallyPickFor === "function" && tallyPickFor(tallyDate(u.day), tallyDate(u.day))}>{"Upload " + dayLong(u.day)}</button></p>)}
    <p className="note" data-older-safe="" style={{ margin: "8px 0 0" }}>FinCom Bridge reads one day at a time, only while nobody is working in Tally; each request stops at 2 seconds and postings go first, so Tally never hangs.</p>
  </section>;
}

// ---------- one line on the Tally page (a client's row)
export function OlderLine({ cid, onOpen }) {
  const b = bookSum(cid), p = b && b.pull;
  useLive(!!(p && p.state === "going" && !p.done));
  if (!p || p.done) return null;
  const why = whyWords(p, b);
  return <div className="tco-sync tfx-line" data-older-line={p.state} role="status">
    <Bar p={p} label={"Bringing " + partWords(p) + " from Tally"} />
    <span data-older-line-words="">{"Books from Tally, " + partWords(p) + ": " + pullWords(p)}{why ? " · " + why : ""}</span>
    {onOpen && <>{" "}<button className="linkbtn" data-older-line-open={cid} onClick={onOpen}>Open</button></>}
  </div>;
}

// ---------- Today from Tally
const WHAT = { tally: { added: "added in Tally", changed: "changed in Tally", deleted: "deleted in Tally" },
  older: { added: "older entry brought in", changed: "older entry brought up to date", deleted: "older entry removed" },
  check: { added: "added (upload check)", changed: "updated (upload check)", deleted: "removed (upload check, kept in history)" } };
export function todayWords(c, last) {
  if (!c) return "";
  const n = (k) => Number(c[k] || 0), any = n("added") + n("changed") + n("deleted") + n("older") + n("corrected");
  if (!any) return "";
  const bits = [plural(n("added"), "entry", "entries") + " added", nf(n("changed")) + " changed", nf(n("deleted")) + " deleted"];
  if (n("older")) bits.push(plural(n("older"), "older entry", "older entries") + " brought in");
  if (n("corrected")) bits.push(nf(n("corrected")) + " corrected by the upload check");
  return "Today from Tally: " + bits.join(" · ") + (last && hm(last) ? " (last " + hm(last) + ")" : "");
}
const countOf = (rows) => { const c = { added: 0, changed: 0, deleted: 0, older: 0, corrected: 0 };
  for (const r of rows) { if (r.via === "older") c.older++; else if (r.via === "check") c.corrected++; else if (c[r.what] !== undefined) c[r.what]++; } return c; };
export function TodayLine({ cid, book = "", where = "row" }) {
  const b = book ? (summary() || []).find((x) => x.book === book) : bookSum(cid), [open, setOpen] = useState(false), [list, setList] = useState(null);
  const bk = (b && b.book) || "";
  useEffect(() => { setOpen(false); setList(null); }, [bk]);
  useEffect(() => { if (!open || !bk) return; let live = true;
    rpc("tally_today_from_tally", { p_book: bk }).then((r) => { if (live && r && r.ok) setList(r); }, () => { if (live) setList({ rows: [], err: true }); });
    return () => { live = false; }; }, [open, bk]);
  if (!b) return null;
  // the list open: its own counts (they always equal its rows)
  const rows = list && Array.isArray(list.rows) ? list.rows : null, words = todayWords(rows ? countOf(rows) : b.today, rows ? list.last : (b.today || {}).last);
  if (!words) return where === "status" ? <p className="note tfx-today" data-today-line="none">{(where === "status" && b.company ? b.company + ": " : "") + "Nothing from Tally yet today."}</p> : null;
  return <div className="tfx-today" data-today-line={where}>
    <button className="linkbtn" data-today-open={bk} aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)}>{(where === "status" && b.company ? b.company + ": " : "") + words}</button>
    {open && <div className="tfx-today-list" data-today-list="">
      {!rows ? <p className="note">Reading the list…</p> : list.err ? <p className="note bad">FinCom’s cloud did not answer; try again in a minute.</p> :
        <div style={{ overflowX: "auto" }}><table className="data" data-today-table=""><thead><tr><th>Date</th><th>Voucher</th><th>Party</th><th className="n">Amount</th><th>What happened</th><th>At</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} data-today-row={r.via + ":" + r.what}><td>{dayLong(r.day)}</td><td>{[r.vtype, r.vno].filter(Boolean).join(" ") || "—"}</td><td>{r.party || "—"}</td>
            <td className="n">{r.amount == null ? "—" : Number(r.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>{(WHAT[r.via] || WHAT.tally)[r.what] || r.what}</td><td>{hm(r.at)}</td></tr>)}</tbody></table>
          {list.total > rows.length && <p className="note">{"Showing the latest " + nf(rows.length) + " of " + nf(list.total) + "."}</p>}</div>}
    </div>}
  </div>;
}
// the status card: each linked company with something from Tally today (or one line: nothing yet)
export function TodayStatus() {
  const books = summary();
  if (!books) return null;
  const cos = (typeof S === "object" && S.companies) || {};
  const mine = books.filter((x) => x.client && cos[x.client] && !cos[x.client].deleted);
  const busy = mine.filter((x) => todayWords(x.today, x.today && x.today.last));
  const going = mine.filter((x) => x.pull && !x.pull.done);
  // Books › From Tally of the client (as the row's Upload older entries opens it)
  const open = (cid) => () => { const h = "#/c/" + encodeURIComponent(cid) + "/from-tally";
    try { history.pushState(null, "", location.pathname + location.search + h); } catch (e) { /* */ }
    if (typeof Route === "object" && Route.apply) Route.apply(h); else if (typeof openCompany === "function") openCompany(cid).then(() => { S.tab = "books"; S.booksTab = "import"; redraw(); }); };
  return <div className="tfx-today-status" data-today-status="">
    {going.map((x) => <div key={"o" + x.book} data-older-status={x.book}><span className="note">{x.company + ":"}</span><OlderLine cid={x.client} onOpen={open(x.client)} /></div>)}
    {busy.length ? busy.map((x) => <TodayLine key={x.book} book={x.book} cid={x.client} where="status" />)
      : <p className="note" data-today-line="none" style={{ margin: 0 }}>Today from Tally: nothing yet.</p>}
  </div>;
}

// ---------- Books › From Tally: the upload checked against Tally
export function UploadCheck({ cid }) {
  const b = bookSum(cid), bk = (b && b.book) || "", [st, setSt] = useState(null), [busy, setBusy] = useState(false), [days, setDays] = useState(false);
  const has = !!(b && b.check && b.check.total > 0), waiting = !!(st ? st.waiting > 0 : b && b.check && b.check.waiting > 0);
  const load = () => rpc("tally_check_status", { p_book: bk }).then((r) => { if (r && r.ok) setSt(r); }, () => {});
  const ck = (b && b.check) || {}, sig = [ck.total, ck.same, ck.fixed, ck.waiting, ck.upload, (ck.run || {}).state, (b && b.pull && b.pull.state) || ""].join("|");
  useEffect(() => { if (bk && has) load(); else setSt(null); }, [bk, has, sig]);
  useEffect(() => { if (!bk || !waiting) return; const t = setInterval(load, 15000); return () => clearInterval(t); }, [bk, waiting]);
  useLive(waiting);
  if (!has) return null;
  const s = st || Object.assign({ lines: [] }, b.check), run = s.run || {}, stopped = run.state === "stopped" || (s.period === "stopped");
  const fixed = (s.lines || []).filter((x) => x.state === "fixed"), same = (s.lines || []).filter((x) => x.state === "same"), up = (s.lines || []).filter((x) => x.state === "upload");
  const resume = () => { setBusy(true);
    const p = b.pull, again = p && p.state === "stopped" ? rpc("tally_period_choose", { p_book: bk, p_fy_start: fyOf8(p.fy) + "-04-01", p_part: p.part || "year" }) : Promise.resolve();
    again.then(() => rpc("tally_check_resume", { p_book: bk })).then(() => { summary(true); return load(); }, () => {}).finally(() => setBusy(false)); };
  const why = stopped ? "Stopped: Tally was busy; press Resume." : waiting ? whyWords({ state: "going", pace: true }, b) : "";
  return <section className="dash-card tfx-check" data-upload-check="" style={{ marginBottom: 12 }}>
    <h3>Upload checked against Tally</h3>
    <p className="tfx-check-head" data-check-head="" style={{ margin: "0 0 6px" }}>{"Checked " + nf(s.checked) + " of " + plural(s.total, "day", "days") + " against Tally" +
      (s.same ? " · " + plural(s.same, "day", "days") + " the same ✓" : "") + (s.fixed ? " · " + plural(s.fixed, "day", "days") + " corrected to Tally" : "") + (s.upload ? " · " + plural(s.upload, "day", "days") + " to upload again" : "")}</p>
    {waiting && !stopped && <p className="note" data-check-waiting="" style={{ margin: "0 0 6px" }}>{plural(s.waiting, "day is", "days are") + " waiting: FinCom Bridge checks them one at a time, only while Tally is free (the computer with this company must have reading older entries on)."}
      {why && " " + why}<TurnOn b={b} /></p>}
    {stopped && <p className="note bad" data-check-stopped="" style={{ margin: "0 0 6px" }}>{"Stopped: Tally was busy; press Resume. "}
      {may() && <button className="btn small primary" data-check-resume="" disabled={busy} onClick={resume}>{busy ? "Resuming…" : "Resume"}</button>}</p>}
    {fixed.length > 0 && <ul className="tfx-check-list" data-check-list="" style={{ margin: "0 0 6px", paddingLeft: 18 }}>
      {fixed.map((x) => <li key={x.day} data-check-day={x.day}>{day8(x.day) + ": " + x.words}</li>)}</ul>}
    {up.map((x) => <p key={x.day} className="note" data-check-upload={x.day} style={{ margin: "0 0 4px" }}>{dayLong(x.day) + ": " + x.words + " "}
      <button className="linkbtn" onClick={() => typeof tallyPickFor === "function" && tallyPickFor(tallyDate(x.day), tallyDate(x.day))}>{"Upload " + dayLong(x.day)}</button></p>)}
    {s.checked > 0 && <p data-check-total="" style={{ margin: "0 0 4px" }}><b>{s.totalWords || ""}</b>{s.fixed ? "; FinCom’s copy now matches Tally for the days checked." : s.same && !waiting ? "; the upload matches Tally ✓" : ""}</p>}
    {same.length > 0 && <><button className="linkbtn" data-check-same-show="" aria-expanded={days ? "true" : "false"} onClick={() => setDays(!days)}>{days ? "Hide the days the same" : "Show the days the same (" + same.length + ")"}</button>
      {days && <p className="note" data-check-same="" style={{ margin: "4px 0 0" }}>{same.map((x) => "✓ " + day8(x.day)).join(" · ")}</p>}</>}
    <p className="note" style={{ margin: "6px 0 0" }}>FinCom corrects only its own copy to Tally (adds, updates, and removes with history kept); nothing is ever changed in Tally.</p>
  </section>;
}
