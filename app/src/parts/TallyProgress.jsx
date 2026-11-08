// next-tally-progress (07-Nov-2026), made simpler in next-tally-simple2 (the owner's approved "Tally simple page v4":
// one connection card, one table, one main button a row, More ▾ for the rest). The parts of each client's row:
//   MastersCell / EntriesCell   the table's two columns: Masters (ledgers & groups) always shown: ✓ Up to date with the
//                 counts and when, Reading now with its bar, Not brought yet; Entries: Up to <day> · N days to bring, Next
//                 after masters / Bringing with its bar, ✓ Up to date with the last entry, Not brought yet.
//   BringMasters, BringBooks, PullButtons   the row's actions (the masters' read, this year's missing days, Pause /
//                 Resume / Stop of Bring books), the same RPCs as before.
//   History       the Update history (tally_ledger_rounds, Bring books, the Update now pressed here, the bridge's wait),
//                 read from FinCom's cloud only while it is open under More.
//   DayBookDrop   "Or drop a Day Book file here" (next-tally-daybook), unchanged.
// The numbers are the cloud's and the bridge's own (FinCom's counts of ledgers and groups, the read's progress, the
// rounds, the books' summary): none is made up; a count not known says "—"; a read with no total known says the count so
// far. Nothing new is asked of Tally.
import { useEffect, useState } from "react";
import { LED_N, ledBook, ledgersOf, ledgersHeld, cloudLedgerCount, groupCount, GRP, runPress, runWords, runBusy, keepWaitOf, cloudBook, d8Of, daybookHeld } from "./TallyCompanies.jsx";
import { bookSum, pctOf, partWords, etaWords, nf, rpc, summary, fyNow, whyWords } from "./TallyFetch.jsx";
import { noAnswer } from "../lib/readFollow.js";   // next-link-follow: a result line when no Tally can answer

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ist = (ms) => new Date(ms + 5.5 * 3600e3);
const hhmm = (at) => { const t = Date.parse(at || ""); if (!t) return ""; const d = ist(t); return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
// "today 17:28" / "yesterday 02:10" / "5-Nov 14:02"
export function whenWords(at) {
  const t = Date.parse(at || ""); if (!t) return "";
  const d = ist(t).toISOString().slice(0, 10), now = ist(Date.now()), today = now.toISOString().slice(0, 10), y = new Date(now.getTime() - 86400e3).toISOString().slice(0, 10);
  return (d === today ? "Today " : d === y ? "Yesterday " : Number(d.slice(8, 10)) + "-" + MON[Number(d.slice(5, 7)) - 1] + " ") + hhmm(at);
}
const day8w = (d8) => /^\d{8}$/.test(d8) ? Number(d8.slice(6, 8)) + "-" + MON[Number(d8.slice(4, 6)) - 1] + "-" + d8.slice(0, 4) : "";
// "today 12:09" / "yesterday 02:10" / "5-Nov 14:02", inside a line ("Updated today 12:09")
const whenIn = (at) => whenWords(at).replace(/^Today/, "today").replace(/^Yesterday/, "yesterday");
const today8 = () => ist(Date.now()).toISOString().slice(0, 10).replace(/-/g, "");
const daysBetween = (a8, b8) => Math.max(0, Math.round((Date.parse(b8.slice(0, 4) + "-" + b8.slice(4, 6) + "-" + b8.slice(6, 8)) - Date.parse(a8.slice(0, 4) + "-" + a8.slice(4, 6) + "-" + a8.slice(6, 8))) / 86400e3));
const sync = (cid) => ((typeof S === "object" && S.tcoSync) || {})[cid] || null;
const mayChange = () => !(typeof S === "object" && S.account && S.account.me) || ["owner", "staff"].includes(S.account.me.role);

// ---------- Step 1 · Masters: {st: reading | waiting | done | none | why, n, g, read, of, pct, words, sub, at}
export function mastersOf(cid, company) {
  const x = sync(cid), n = ledgersOf(cid), g = (GRP[cid] || {}).n, held = ledgersHeld(cid), bk = ledBook(cid) || {};
  const rw = runWords(cid, company), at = bk.ledgersAt || "", ln = LED_N.get(cid), nKnown = n > 0 || !!(ln && ln.book === bk.book);
  const running = !!(x && !x.end && !x.err && !x.late) || runBusy(cid);
  const of = x && x.prog ? Number(x.prog.of) || 0 : 0, read = x && x.prog ? Math.min(Number(x.prog.read) || 0, of || Infinity) : 0;
  const kw = company ? keepWaitOf(company) : "";
  const base = { n: nKnown ? n : null, g: g == null ? null : g, at, held };
  if (running) {
    if (kw && !(read > 0)) return Object.assign(base, { st: "waiting", words: /^waiting/i.test(kw) ? kw : "Waiting: " + kw, read, of, pct: 0 });
    if (of > 0) return Object.assign(base, { st: "reading", read, of, pct: Math.min(99, Math.round((read * 100) / of)), words: "Reading · " + nf(read) + " of " + nf(of) });
    if (read > 0) return Object.assign(base, { st: "reading", read, of: 0, pct: 0, words: "Reading… " + nf(read) + " so far" });
    // (the read asked, nothing from Tally yet and a reason known: "Not started yet: …", amber)
    if (rw && rw.phase === "waiting") return Object.assign(base, { st: "waiting", read: 0, of: 0, pct: 0, words: rw.text });
    return Object.assign(base, { st: "reading", read: 0, of: 0, pct: 0, words: rw && rw.text ? rw.text : "Reading…" });
  }
  if (rw && rw.phase === "why") return Object.assign(base, { st: "why", words: "Not done: " + rw.text.replace(/^Not updated:\s*/, "") });
  if (x && (x.err || x.late) && !held) return Object.assign(base, { st: "why", words: "Not done: " + (x.err || x.why || "no answer from Tally in 3 minutes") });
  // (the cloud's count not read yet, or not read: "—", never a made-up 0)
  if (held) return Object.assign(base, { st: "done", words: "✓ " + (nKnown ? nf(n) + (n === 1 ? " ledger" : " ledgers") : "— ledgers") + " · " + (g != null ? nf(g) + (g === 1 ? " group" : " groups") : "— groups"),
    sub: (at ? "updated " + hhmm(at) + " · " : "") + "changes every 10 min", done: rw && rw.phase === "done" ? rw.text : "" });
  return Object.assign(base, { st: "none", words: "Not brought yet" });
}
// ---------- Step 2 · Entries: {st: going | after | paused | stopped | done | uptodate | behind | none, words, sub, pct, p}
export function entriesOf(cid, ms, last) {
  const b = bookSum(cid), p = b && b.pull, bk = cloudBook(cid) || {}, to = d8Of(bk.to), t8 = today8();
  if (p && !p.done && (p.state === "going" || p.state === "paused" || p.state === "stopped")) {
    const y = Number(p.y || 0), x = Math.min(Number(p.x || 0), y), xy = y ? nf(x) + " of " + nf(y) : "";
    const st = p.state === "going" ? (ms && (ms.st === "reading" || ms.st === "waiting") ? "after" : "going") : p.state;
    const word = st === "after" ? "After masters" : st === "going" ? "Bringing" : st === "paused" ? "Paused" : "Stopped";
    return { st, p, b, pct: pctOf(p), words: word + (xy ? " · " + xy : p.counting ? " · counting the year in Tally" : ""),
      sub: [partWords(p), p.state === "going" && Number(p.etaMin) > 0 ? etaWords(p.etaMin) + " left" : "", p.state === "going" && Number(p.rate) > 0 ? nf(p.rate) + " entries a minute" : ""].filter(Boolean).join(" · ") };
  }
  if (p && p.done) return { st: "done", p, b, pct: 100, words: "✓ " + partWords(p) + " in FinCom", sub: last ? "last " + hhmm(last) : "" };
  if (/^\d{8}$/.test(to) && daybookHeld(cid)) {
    const behind = daysBetween(to, t8);
    if (behind <= 1) return { st: "uptodate", p: null, b, pct: 100, words: "✓ Up to date" + (last ? " · last " + hhmm(last) : "") };
    return { st: "behind", p: null, b, pct: 0, words: "Up to " + day8w(to), sub: behind + (behind === 1 ? " day" : " days") + " to bring" };
  }
  return { st: "none", p: null, b, pct: 0, words: ms && ms.st !== "done" ? "After masters" : "Not brought in yet" };
}
function Bar({ pct, kind, label }) {
  return <div className="tpg-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct || 0} data-tpg-pct={pct || 0}>
    <i className={kind} style={{ width: Math.max(2, pct || 0) + "%" }} /></div>;
}
// ---------- the table's two columns
// "N ledgers · M groups" ("—" for a count not known yet, never a made-up 0)
const countWords = (n, g) => (n == null ? "—" : nf(n)) + (n === 1 ? " ledger" : " ledgers") + " · " + (g == null ? "—" : nf(g)) + (g === 1 ? " group" : " groups");
export function MastersCell({ row }) {
  const [, tick] = useState(0);
  // the counts of ledgers and groups in FinCom's cloud (each kept a minute; the ledgers' the table's own count)
  useEffect(() => { let on = true; if (ledgersHeld(row.cid)) Promise.all([cloudLedgerCount(row.cid).catch(() => null), groupCount(row.cid).catch(() => null)]).then(() => { if (on) tick((k) => k + 1); });
    return () => { on = false; }; }, [row.cid, (ledBook(row.cid) || {}).ledgersAt]);
  const m = mastersOf(row.cid, row.company), live = m.st === "reading" || m.st === "waiting";
  // (each 2 s while the masters are read: the read's own counts)
  useEffect(() => { if (!live) return; const t = setInterval(() => tick((k) => k + 1), 2000); return () => clearInterval(t); }, [live]);
  let head, sub = "", sub2 = "", cls = "";
  if (m.st === "done") { head = "✓ Up to date"; cls = " ok"; sub = countWords(m.n, m.g); sub2 = m.at ? "Updated " + whenIn(m.at) : ""; }
  // (the groups only once FinCom holds this client's masters: a first read has no count yet, never "0 groups")
  else if (m.st === "reading") { head = "Reading now"; cls = " read"; sub = (m.of > 0 ? nf(m.read) + " of " + nf(m.of) + " ledgers" : m.read > 0 ? nf(m.read) + " ledgers so far" : m.words) + (m.held && m.g != null ? " · " + nf(m.g) + (m.g === 1 ? " group" : " groups") : ""); }
  else if (m.st === "waiting") { head = "Waiting"; cls = " warn"; sub = m.words; }
  else if (m.st === "why") { head = "Not done"; cls = " bad"; sub = m.words.replace(/^Not done:\s*/, ""); }
  // (0 only when FinCom's book for it is known and says no ledger ever came; else "—")
  else { const bk = ledBook(row.cid); head = "Not brought yet"; cls = " bad"; sub = (m.n != null ? nf(m.n) : bk && !bk.ledgersAt ? "0" : "—") + " ledgers in FinCom"; sub2 = "TDS and GST need these"; }
  return <div className="tpg-cell" data-tpg-masters={m.st}>
    <span className={"tpg-words" + cls} data-tpg-mw="">{head}</span>
    {live && <Bar pct={m.pct} kind="read" label={"Ledgers of " + row.client} />}
    {sub && <span className="tpg-sub" data-tpg-ms="">{sub}</span>}
    {sub2 && <span className="tpg-sub2">{sub2}</span>}
  </div>;
}
export function EntriesCell({ row }) {
  const ms = mastersOf(row.cid, row.company), e = entriesOf(row.cid, ms, row.last), p = e.p;
  const xy = p && Number(p.y) ? nf(Math.min(Number(p.x || 0), Number(p.y))) + " of " + nf(p.y) : p && p.counting ? "counting the year in Tally" : "";
  let head, sub = "", cls = "";
  if (e.st === "behind") { head = e.words; cls = " warn"; sub = e.sub; }
  else if (e.st === "after" || e.st === "going") { head = e.st === "after" ? "Next, after masters" : "Bringing now"; cls = e.st === "going" ? " read" : " muted";
    sub = [xy, p.state === "going" && Number(p.etaMin) > 0 ? etaWords(p.etaMin) : ""].filter(Boolean).join(" · "); }
  else if (e.st === "paused" || e.st === "stopped") { head = e.st === "paused" ? "Paused" : "Stopped"; cls = " warn"; sub = [partWords(p), xy].filter(Boolean).join(" · "); }
  else if (e.st === "uptodate") { head = "✓ Up to date"; cls = " ok"; sub = row.last ? "Last entry " + whenIn(row.last) : ""; }
  else if (e.st === "done") { head = e.words; cls = " ok"; sub = row.last ? "Last entry " + whenIn(row.last) : ""; }
  else { head = "Not brought yet"; cls = " muted"; sub = ms.st !== "done" ? "Comes after masters" : ""; }
  // (Bring books asked, not moving: why, in the words of Books › From Tally: the computer, reading of older entries off,
  // Tally busy, stopped. Not while it waits for the masters, which the head says)
  const wait = p && !p.done && e.st !== "after" ? whyWords(p, e.b) : "";
  return <div className="tpg-cell" data-tpg-entries={e.st}>
    <span className={"tpg-words" + cls} data-tpg-ew="">{head}</span>
    {p && !p.done && (e.st === "going" || e.st === "after" || e.st === "paused") && <Bar pct={e.pct} kind={e.st === "going" ? "read" : "wait"} label={"Entries of " + row.client} />}
    {sub && <span className="tpg-sub" data-tpg-es="">{sub}</span>}
    {wait && <span className="tpg-sub2 warn" data-tpg-ewait="" role="status">{wait}</span>}
  </div>;
}
// "Apr 2025 – today" / "Apr 2026 – 12-Oct-2026" / "" (the client's books in FinCom: their first and last day)
export function rangeWords(cid) {
  const bk = cloudBook(cid) || {}, from = d8Of(bk.from), to = d8Of(bk.to);
  if (!/^\d{8}$/.test(from) || !/^\d{8}$/.test(to)) return "";
  return MON[Number(from.slice(4, 6)) - 1] + " " + from.slice(0, 4) + " – " + (daysBetween(to, today8()) <= 1 ? "today" : day8w(to));
}
// Bring masters (= Bring ledgers & groups, masters missing): the masters' read, as Update now (FinCom's Update now: never
// a second read)
export function BringMasters({ row, primary = true, link = false }) {
  const [busy, setBusy] = useState(false), x = sync(row.cid), running = busy || runBusy(row.cid) || !!(x && !x.end && !x.err && !x.late);
  if (!mayChange()) return null;
  // (link: under More, the masters alone read again; never the row's main button)
  if (link) return <button type="button" className="linkbtn" data-tpt-masters-more={row.cid} disabled={running}
    onClick={() => { setBusy(true); runPress(row.cid, row.company).finally(() => setBusy(false)); }}>{running ? "Reading masters…" : "Bring masters"}</button>;
  return <button type="button" className={"btn tpt-btn" + (primary ? " primary" : "")} data-tpt-main="masters" data-tpg-bring={row.cid} disabled={running}
    onClick={() => { setBusy(true); runPress(row.cid, row.company).finally(() => setBusy(false)); }}>{running ? "Reading…" : "Bring masters"}</button>;
}
// Pause / Resume / Stop of Bring books, the same RPCs as Books › From Tally's (tally_period_pause / cancel). only: the
// buttons to draw ("pause", "resume", "stop"); main: the row's one main button (its look and data-tpt-main)
export function PullButtons({ e, only = ["pause", "resume", "stop"], main = false, link = false }) {
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), p = e.p, book = e.b && e.b.book;
  if (!p || !book || !mayChange() || p.done) return null;
  const act = (fn, args, what) => { setBusy(what); setErr("");
    rpc(fn, args).then((r) => { if (r && r.ok === false) setErr(String(r.error || "FinCom did not take it")); summary(true); }, () => setErr("FinCom’s cloud did not answer; try again in a minute.")).finally(() => setBusy("")); };
  const cls = link ? "linkbtn" : "btn tpt-btn", has = (k) => only.includes(k);
  return <>
    {has("pause") && p.state === "going" && <button type="button" className={cls} data-tpg-pause="" data-tpt-main={main ? "pause" : undefined} disabled={!!busy} onClick={() => act("tally_period_pause", { p_book: book, p_pause: true }, "pause")}>{busy === "pause" ? "Pausing…" : "Pause"}</button>}
    {has("resume") && p.state === "paused" && <button type="button" className={cls + (main ? " primary" : "")} data-tpg-resume="" data-tpt-main={main ? "resume" : undefined} disabled={!!busy} onClick={() => act("tally_period_pause", { p_book: book, p_pause: false }, "resume")}>{busy === "resume" ? "Resuming…" : "Resume"}</button>}
    {has("stop") && (p.state === "going" || p.state === "paused") && <button type="button" className={cls} data-tpg-stop="" disabled={!!busy} onClick={() => act("tally_period_cancel", { p_book: book }, "stop")}>{busy === "stop" ? "Stopping…" : "Stop"}</button>}
    {err && <span className="tsm-note bad" data-tpg-err="">{err}</span>}
  </>;
}
// Bring books: this year's days FinCom lacks (as Books › From Tally's Start), the row's main button or a link under More
export function BringBooks({ row, e, main = true }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), book = e.b && e.b.book;
  if (!mayChange()) return null;
  const start = () => { const args = { p_book: book, p_fy_start: fyNow() + "-04-01", p_part: "year" }; setBusy(true); setErr("");
    rpc("tally_period_choose_lean", args).catch((er) => { if (/PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(String((er && er.message) || er))) return rpc("tally_period_choose", args); throw er; })
      // next-link-follow: no Tally can answer now (the linked computer offline, the company open nowhere): said at once
      .then((r) => { if (r && r.ok === false) setErr(String(r.error || "FinCom did not take it")); else { const na = noAnswer(row.company); if (na) setErr("Queued. " + na); } summary(true); }, () => setErr("FinCom’s cloud did not answer; try again in a minute.")).finally(() => setBusy(false)); };
  return <>
    <button type="button" className={main ? "btn tpt-btn primary" : "linkbtn"} data-tpt-main={main ? "books" : undefined} data-tpg-bring-books={row.cid} disabled={busy || !book} onClick={start}>{busy ? "Starting…" : "Bring books"}</button>
    {err && <div className="tsm-note bad" data-tpg-err="" role="status">{err}</div>}
  </>;
}
// the update history: the rounds of the ledgers' reads (tally_ledger_rounds), Bring books, the Update now pressed here
function useRounds(cid) {
  const [st, setSt] = useState({ rows: null, err: "" }), bk = ledBook(cid) || {};
  useEffect(() => { let on = true, t = 0;
    const read = () => { if (!bk.book || typeof Cloud !== "object") { setSt({ rows: [], err: "" }); return; }
      Cloud.api("tally_ledger_rounds?select=round_id,started_at,last_seen_at,rows_received,rows_read,complete,batches&order=started_at.desc&limit=20&book_id=eq." + encodeURIComponent(bk.book))
        .then((r) => { if (!on) return; const rows = Array.isArray(r) ? r : []; setSt({ rows, err: "" });
          // (a round still going: read again in 15 s while these details are open)
          if (rows.some((x) => x && !x.complete && Date.now() - Date.parse(x.last_seen_at || "") < 180000)) t = setTimeout(read, 15000); },
          () => { if (on) setSt({ rows: [], err: "FinCom’s cloud did not answer; the history shows again in a minute." }); }); };
    read(); return () => { on = false; clearTimeout(t); }; }, [cid, bk.book]);
  return st;
}
export function historyRows(rounds, m, e, kw) {
  const out = [], rs = [].concat(rounds || []).filter(Boolean);
  const whole = rs.filter((r) => r.complete && r.rows_read != null && !(Number(r.rows_received) < Number(r.rows_read)));
  const total = whole.length ? Number(whole[0].rows_read) || 0 : 0;
  if (kw && (m.st === "waiting")) out.push({ at: new Date().toISOString(), what: "Masters", how: "FinCom Bridge", res: kw, k: "wait" });
  for (const r of rs) {
    const rec = Number(r.rows_received) || 0, rd = r.rows_read == null ? null : Number(r.rows_read);
    const live = !r.complete && Date.now() - Date.parse(r.last_seen_at || "") < 180000;
    const how = rd != null && !(rec < rd) ? "Whole list" : rd != null ? "Changes check" : "Read";
    const res = r.complete ? (how === "Whole list" ? "Whole list read · " + nf(rd) + (rd === 1 ? " ledger" : " ledgers") : rec ? nf(rec) + " new or changed" : "No changes in Tally")
      : live ? "Reading · " + nf(rec) + (total ? " of " + nf(total) : " so far") : "Not finished (" + nf(rec) + " received)";
    out.push({ at: r.started_at, what: "Masters", how, res, k: r.complete ? "ok" : live ? "live" : "wait" });
  }
  if (m.done) out.unshift({ at: new Date().toISOString(), what: "Masters", how: "Update now (here)", res: m.done, k: "ok" });
  const p = e && e.p;
  if (p && p.chosenAt) out.push({ at: p.chosenAt, what: "Entries " + partWords(p), how: "Bring books", k: p.done ? "ok" : p.state === "stopped" ? "wait" : "live",
    res: p.done ? "All in FinCom" : (p.state === "going" ? "Bringing" : p.state === "paused" ? "Paused" : "Stopped") + (Number(p.y) ? " at " + nf(Math.min(Number(p.x || 0), Number(p.y))) + " of " + nf(p.y) : "") });
  return out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}
// "Or drop a Day Book file here" (next-tally-daybook): the file read into THIS client's books by ../lib/dayBookDrop.js
// (loaded on the first drop), which takes the client, its record and its books explicitly and never swaps the open
// client (review of 0b3c34839). One drop at a time on the page (DROP.on: every other box says so); a viewer only reads
// why; its progress and result lines stay under the box (DROP.lines) while the page is left and come back
const DROP = { on: "", lines: {}, step: {}, subs: new Set() };
const dropTell = () => DROP.subs.forEach((f) => f());
export function DayBookDrop({ cid }) {
  const [over, setOver] = useState(false), [, tick] = useState(0);
  useEffect(() => { const f = () => tick((k) => k + 1); DROP.subs.add(f); return () => { DROP.subs.delete(f); }; }, []);
  const may = mayChange(), busy = DROP.on, lines = DROP.lines[cid] || [], step = busy === cid ? DROP.step[cid] : "";
  const go = async (files) => {
    files = Array.from(files || []);
    if (!files.length || DROP.on || !mayChange()) return;
    DROP.on = cid; DROP.lines[cid] = []; DROP.step[cid] = "Opening the file…"; dropTell();
    const say = (l) => { DROP.lines[cid] = (DROP.lines[cid] || []).concat([l]); dropTell(); }, at = (t) => { DROP.step[cid] = t; dropTell(); };
    try { await (await import("../lib/dayBookDrop.js")).dropDayBook(cid, files, { say, step: at }); }
    catch (e) { say({ ok: false, text: "Not read: " + String((e && e.message) || e).replace(/[.\s]+$/, "") + "." }); }
    finally { DROP.on = ""; DROP.step[cid] = ""; dropTell(); }
  };
  const off = !!busy || !may, stop = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  return <div className="tpg-drop-wrap">
    <label className={"tpg-drop" + (over && !off ? " over" : "") + (off ? " off" : "")} data-tpg-drop={cid} aria-disabled={off ? "true" : undefined}
      onDragOver={(ev) => { stop(ev); if (!off) setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(ev) => { stop(ev); setOver(false); if (!off) go(ev.dataTransfer && ev.dataTransfer.files); }}>
      {may && <input type="file" className="sr-only" data-tpg-drop-file={cid} accept=".xml,.json,.zip" multiple disabled={off} onChange={(ev) => { const f = Array.from(ev.target.files || []); ev.target.value = ""; go(f); }} />}
      {!may ? "A member of the firm who may make changes uploads a Day Book." : busy === cid ? "Reading the file…" : busy ? "Another file is being read…" : "Or drop a Day Book file here"}</label>
    {(step || lines.length > 0) && <div className="tsm-note" data-tpg-drop-say="" role="status">
      {step && <div data-tpg-drop-step="">{step}</div>}
      {lines.map((l, k) => <div key={k} className={l.ok === false ? "bad" : ""} data-tpg-drop-line={l.ok === false ? "bad" : "ok"}>{l.text}</div>)}</div>}
  </div>;
}
// the Update history, under More (the rounds read from FinCom's cloud only while it is open)
export function History({ row }) {
  const cid = row.cid, m = mastersOf(cid, row.company), e = entriesOf(cid, m, row.last), h = useRounds(cid), kw = row.company ? keepWaitOf(row.company) : "";
  const hist = h.rows ? historyRows(h.rows, m, e, kw) : null;
  return <div className="tpg-hist-in" data-tpg-history="">
    {h.err && <p className="tsm-note bad">{h.err}</p>}
    {!hist ? <p className="tsm-note">Reading…</p> : !hist.length ? <p className="tsm-note">No update yet.</p>
      : <ul className="tpg-hlist">{hist.map((r, k) => <li key={k} className={"tpg-h " + r.k} data-tpg-h={r.k}><span data-tpg-h-what="">{[whenWords(r.at), r.what, r.how].filter(Boolean).join(" · ")}</span><span data-tpg-h-res="">{r.res}</span></li>)}</ul>}
  </div>;
}
