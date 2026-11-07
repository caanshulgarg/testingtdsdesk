// next-tally-progress (07-Nov-2026; the owner: "the Tally page needs more redesign… I don't want to do anything elsewhere";
// the approved design: tallyprog Main / Client). Everything Tally from the Tally page alone:
//   ComingNow     "Coming in from Tally now · <client>": Step 1 · Masters (ledgers N of M, groups, the bar, its state:
//                 Reading / Waiting: <the bridge's words> / Done · updated HH:MM / Not done: <why>) and Step 2 · Entries
//                 (Bring books' progress, with Pause and Stop); "Masters always go first"; a posting this computer's bridge
//                 holds (StuckJobs). Shown while something reads, waits or is paused.
//   MastersCell / EntriesCell   the table's two columns, each its small bar or its state in words.
//   ClientDetails one client inside the Tally page: Masters (ledgers and groups in FinCom, the whole list last read,
//                 changes checked, Bring ledgers & groups), Entries (the year's 12 months: in FinCom / coming / to bring,
//                 Bring books with Pause, Stop and another year) and the Update history (tally_ledger_rounds, Bring books,
//                 the Update now pressed here and why it waits).
// The numbers are the cloud's and the bridge's own (FinCom's counts of ledgers and groups, the read's progress, the
// rounds, the books' summary): none is made up; a read with no total known says "Reading…" and the count so far. Nothing
// new is asked of Tally; the rounds are read from FinCom's cloud only while one client's details are open.
import { useEffect, useState } from "react";
import { LED_N, ledBook, ledgersOf, ledgersHeld, cloudLedgerCount, groupCount, GRP, lightAt, runPress, runWords, runBusy, keepWaitOf, cloudBook, d8Of, fyStart, daybookHeld } from "./TallyCompanies.jsx";
import OlderEntries, { bookSum, bookFetch, pctOf, partWords, etaWords, nf, rpc, summary, fyLabel, fyNow } from "./TallyFetch.jsx";
import { PostingWait } from "./StuckJobs.jsx";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ist = (ms) => new Date(ms + 5.5 * 3600e3);
const hhmm = (at) => { const t = Date.parse(at || ""); if (!t) return ""; const d = ist(t); return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0"); };
// "today 17:28" / "yesterday 02:10" / "5-Nov 14:02"
export function whenWords(at) {
  const t = Date.parse(at || ""); if (!t) return "";
  const d = ist(t).toISOString().slice(0, 10), now = ist(Date.now()), today = now.toISOString().slice(0, 10), y = new Date(now.getTime() - 86400e3).toISOString().slice(0, 10);
  return (d === today ? "Today " : d === y ? "Yesterday " : Number(d.slice(8, 10)) + "-" + MON[Number(d.slice(5, 7)) - 1] + " ") + hhmm(at);
}
const day8w = (d8) => /^\d{8}$/.test(d8) ? Number(d8.slice(6, 8)) + "-" + MON[Number(d8.slice(4, 6)) - 1] : "";
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
    return Object.assign(base, { st: "reading", read: 0, of: 0, pct: 0, words: rw && rw.text ? rw.text : "Reading…" });
  }
  if (rw && rw.phase === "why") return Object.assign(base, { st: "why", words: "Not done: " + rw.text.replace(/^Not updated:\s*/, "") });
  if (x && (x.err || x.late) && !held) return Object.assign(base, { st: "why", words: "Not done: " + (x.err || x.why || "no answer from Tally in 3 minutes") });
  // (the cloud's count not read yet, or not read: "—", never a made-up 0)
  if (held) return Object.assign(base, { st: "done", words: "✓ " + (nKnown ? nf(n) + (n === 1 ? " ledger" : " ledgers") : "— ledgers") + " · " + (g != null ? nf(g) + (g === 1 ? " group" : " groups") : "— groups"),
    sub: (at ? "updated " + hhmm(at) + " · " : "") + "changes every 10 min", done: rw && rw.phase === "done" ? rw.text : "" });
  return Object.assign(base, { st: "none", words: "Not brought in yet" });
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
export function MastersCell({ row }) {
  const [, tick] = useState(0);
  // the counts of ledgers and groups in FinCom's cloud (each kept a minute; the ledgers' the table's own count)
  useEffect(() => { let on = true; if (ledgersHeld(row.cid)) Promise.all([cloudLedgerCount(row.cid).catch(() => null), groupCount(row.cid).catch(() => null)]).then(() => { if (on) tick((k) => k + 1); });
    return () => { on = false; }; }, [row.cid, (ledBook(row.cid) || {}).ledgersAt]);
  const m = mastersOf(row.cid, row.company), live = m.st === "reading" || m.st === "waiting";
  return <div className="tpg-cell" data-tpg-masters={m.st}>
    {live && m.pct > 0 && <Bar pct={m.pct} kind="read" label={"Ledgers of " + row.client} />}
    <span className={"tpg-words" + (m.st === "none" || m.st === "why" || m.st === "waiting" ? " warn" : "")} data-tpg-mw="">{m.words}</span>
    {m.st === "done" && m.sub && <span className="tpg-sub">{m.sub}</span>}
    {m.st === "none" && <span className="tpg-sub">{row.o && row.o.w === "Yes" ? "Bring ledgers & groups to start" : "needs the company open in Tally"}</span>}
  </div>;
}
export function EntriesCell({ row }) {
  const ms = mastersOf(row.cid, row.company), e = entriesOf(row.cid, ms, row.last);
  return <div className="tpg-cell" data-tpg-entries={e.st}>
    {(e.st === "going" || e.st === "after" || e.st === "paused") && <Bar pct={e.pct} kind={e.st === "going" ? "read" : "wait"} label={"Entries of " + row.client} />}
    <span className={"tpg-words" + (e.st === "behind" || e.st === "stopped" ? " warn" : "")} data-tpg-ew="">{e.words}</span>
    {e.sub && <span className="tpg-sub">{e.sub}</span>}
  </div>;
}
// Bring ledgers & groups (masters missing): the masters' read, as Update now (FinCom's Update now: never a second read)
export function BringMasters({ row, primary = true }) {
  const [busy, setBusy] = useState(false), x = sync(row.cid), running = busy || runBusy(row.cid) || !!(x && !x.end && !x.err && !x.late);
  if (!mayChange()) return null;
  return <button type="button" className={"btn tpt-btn" + (primary ? " primary" : "")} data-tpt-main="masters" data-tpg-bring={row.cid} disabled={running}
    onClick={() => { setBusy(true); runPress(row.cid, row.company).finally(() => setBusy(false)); }}>{running ? "Reading…" : "Bring ledgers & groups"}</button>;
}
// Pause / Resume / Stop of Bring books, the same RPCs as Books › From Tally's (tally_period_pause / cancel)
function PullButtons({ e, small }) {
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), p = e.p, book = e.b && e.b.book;
  if (!p || !book || !mayChange() || p.done) return null;
  const act = (fn, args, what) => { setBusy(what); setErr("");
    rpc(fn, args).then((r) => { if (r && r.ok === false) setErr(String(r.error || "FinCom did not take it")); summary(true); }, () => setErr("FinCom’s cloud did not answer; try again in a minute.")).finally(() => setBusy("")); };
  const cls = "btn" + (small ? " small" : "");
  return <span className="tpg-acts">
    {p.state === "going" && <button type="button" className={cls} data-tpg-pause="" disabled={!!busy} onClick={() => act("tally_period_pause", { p_book: book, p_pause: true }, "pause")}>{busy === "pause" ? "Pausing…" : "Pause"}</button>}
    {p.state === "paused" && <button type="button" className={cls + " primary"} data-tpg-resume="" disabled={!!busy} onClick={() => act("tally_period_pause", { p_book: book, p_pause: false }, "resume")}>{busy === "resume" ? "Resuming…" : "Resume"}</button>}
    {(p.state === "going" || p.state === "paused") && <button type="button" className={cls} data-tpg-stop="" disabled={!!busy} onClick={() => act("tally_period_cancel", { p_book: book }, "stop")}>{busy === "stop" ? "Stopping…" : "Stop"}</button>}
    {err && <span className="tsm-note bad" data-tpg-err="">{err}</span>}
  </span>;
}
const BADGE = { reading: "Reading", waiting: "Waiting", done: "Done", why: "Not done", none: "Not brought in yet", going: "Bringing", after: "After masters", paused: "Paused", stopped: "Stopped", uptodate: "Up to date", behind: "To bring" };
// ---------- Coming in from Tally now: one line each client being read (rows: the table's rows)
export function busyRows(rows) {
  const linked = rows.filter((r) => r.kind === "client" && r.cid && r.company && r.c && r.c.w === "Yes");
  const st = linked.map((r) => { const m = mastersOf(r.cid, r.company), e = entriesOf(r.cid, m, r.last); return { r, m, e }; });
  const rank = (s) => s.m.st === "reading" ? 0 : s.m.st === "waiting" ? 1 : ["going", "after", "paused", "stopped"].includes(s.e.st) ? 2 : 9;
  return st.filter((s) => rank(s) < 9).sort((a, b) => rank(a) - rank(b));
}
export const busyRow = (rows) => busyRows(rows)[0] || null;
function NowLine({ s }) {
  const { r, m, e } = s, ml = m.st === "reading" || m.st === "waiting", ep = e.p && !e.p.done;
  const mWords = m.st === "reading" && m.of > 0 ? nf(m.read) + " of " + nf(m.of) + " ledgers" : m.st === "done" ? m.words.replace(/^✓ /, "") : m.words;
  const eWords = ep && Number(e.p.y) ? nf(Math.min(Number(e.p.x || 0), Number(e.p.y))) + " of " + nf(e.p.y) + (e.p.state === "going" && Number(e.p.etaMin) > 0 ? " · ~" + etaWords(e.p.etaMin).replace(/^about /, "") : "") : e.words;
  return <div className="tpg-nl" data-tpg-nl={r.cid}>
    <b className="tpg-nl-name">{r.client}</b>
    <div className="tpg-nl-part" data-tpg-nl-masters={m.st}><span className="tpg-sub">{"Masters · " + (BADGE[m.st] || "").toLowerCase()}</span>
      {ml && <Bar pct={m.pct} kind="read" label={"Masters of " + r.client} />}<span className={"tpg-words" + (m.st === "waiting" || m.st === "why" ? " warn" : "")}>{mWords}</span></div>
    <div className="tpg-nl-part" data-tpg-nl-entries={e.st}><span className="tpg-sub">{"Entries · " + (BADGE[e.st] || "").toLowerCase()}</span>
      {ep && <Bar pct={e.pct} kind={e.st === "going" ? "read" : "wait"} label={"Entries of " + r.client} />}<span className="tpg-words">{eWords}</span></div>
    <PullButtons e={e} small />
  </div>;
}
export function ComingNow({ rows, beat }) {
  const [, tick] = useState(0), list = busyRows(rows);
  // (each 2 s while something moves: the read's own counts; the books' summary reads itself every 30 s)
  useEffect(() => { if (!list.length) return; const t = setInterval(() => tick((k) => k + 1), 2000); return () => clearInterval(t); }, [list.length > 0]);
  if (!list.length) return <PostingWait beat={beat} hook="panel" />;
  return <section className="tsm-card tpg-now" aria-label="Coming in from Tally now" data-tpg-now={list[0].r.cid}>
    <div className="tpg-now-head"><h3>Coming in from Tally now</h3><span className="tsm-note">Masters always go first; entries follow</span></div>
    {list.map((s) => <NowLine key={s.r.cid} s={s} />)}
    <PostingWait beat={beat} hook="panel" />
  </section>;
}

// ---------- one client's details, inside the Tally page
function months(fy, bk, p) {
  const out = [], from = d8Of(bk && bk.from), to = d8Of(bk && bk.to), t8 = today8();
  const pf = p && !p.done ? String(p.fy || "").replace(/-/g, "").slice(0, 8) : "", part = p ? p.part : "";
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1, y = fy + (i >= 9 ? 1 : 0), first = y + String(m).padStart(2, "0") + "01", last = y + String(m).padStart(2, "0") + "31";
    let k = "later";
    if (first > t8) k = "later";
    else if (/^\d{8}$/.test(to) && /^\d{8}$/.test(from) && first <= to && last >= from) k = last <= to ? "in" : "part";
    else k = "bring";
    if (k !== "in" && k !== "later" && pf && pf.slice(0, 4) === String(fy) && (part === "h1" ? i < 6 : part === "h2" ? i >= 6 : true)) k = "coming";
    out.push({ m: MON[m - 1], k });
  }
  return out;
}
const MK = { in: "In FinCom", part: "Partly in FinCom", coming: "Coming in now", bring: "To bring", later: "Not yet in the year" };
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
// Bring books (this year: the days FinCom lacks, as Books › From Tally's Start) and Bring another year (that card, here)
function BringBooks({ cid, e }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [other, setOther] = useState(false), book = e.b && e.b.book, going = e.p && !e.p.done && (e.p.state === "going" || e.p.state === "paused");
  const start = () => { const args = { p_book: book, p_fy_start: fyNow() + "-04-01", p_part: "year" }; setBusy(true); setErr("");
    rpc("tally_period_choose_lean", args).catch((er) => { if (/PGRST202|Could not find the function|schema cache|does not exist|\b404\b/i.test(String((er && er.message) || er))) return rpc("tally_period_choose", args); throw er; })
      .then((r) => { if (r && r.ok === false) setErr(String(r.error || "FinCom did not take it")); summary(true); }, () => setErr("FinCom’s cloud did not answer; try again in a minute.")).finally(() => setBusy(false)); };
  return <>
    {mayChange() && <div className="tpg-acts">
      {!going && <button type="button" className="btn small" data-tpg-bring-books={cid} disabled={busy || !book} onClick={start}>{busy ? "Starting…" : "Bring books"}</button>}
      <button type="button" className="btn small" data-tpg-another-year={cid} aria-expanded={other ? "true" : "false"} onClick={() => setOther(!other)}>{other ? "Hide other years" : "Bring another year"}</button>
      <PullButtons e={e} small /></div>}
    {err && <p className="tsm-note bad" data-tpg-err="">{err}</p>}
    {other && <OlderEntries cid={cid} />}
  </>;
}
export function ClientDetails({ row }) {
  const [, tick] = useState(0), cid = row.cid, company = row.company;
  useEffect(() => { let on = true; Promise.all([cloudLedgerCount(cid).catch(() => null), groupCount(cid).catch(() => null)]).then(() => { if (on) tick((k) => k + 1); }); return () => { on = false; }; }, [cid]);
  const m = mastersOf(cid, company), e = entriesOf(cid, m, row.last), h = useRounds(cid), kw = company ? keepWaitOf(company) : "";
  useEffect(() => { if (m.st !== "reading" && m.st !== "waiting") return; const t = setInterval(() => tick((k) => k + 1), 2000); return () => clearInterval(t); }, [m.st]);
  const lt = lightAt(company), whole = (h.rows || []).find((r) => r.complete && r.rows_read != null && !(Number(r.rows_received) < Number(r.rows_read)));
  const live = (h.rows || []).find((r) => !r.complete && Date.now() - Date.parse(r.last_seen_at || "") < 180000);
  const total = whole ? Number(whole.rows_read) || 0 : 0;
  const ledW = m.st === "reading" && m.of > 0 ? nf(m.read) + " of " + nf(m.of) : live ? nf(Number(live.rows_received) || 0) + (total ? " of " + nf(total) : " so far") : nf(m.n);
  const fy = e.p ? Number(String(e.p.fy || "").slice(0, 4)) || fyNow() : fyNow(), bk = cloudBook(cid) || {}, hist = h.rows ? historyRows(h.rows, m, e, kw) : null;
  return <div className="tpg-details tpg-three" data-tpg-details={cid}>
    <section className="tpg-d-card" data-tpg-d="masters">
      <div className="tpg-kicker">Masters</div>
      <div className="tpg-line">Ledgers <b data-tpg-d-ledgers="">{m.held || m.st === "reading" || live ? ledW : "none yet"}</b>{" · groups "}<b data-tpg-d-groups="">{m.g != null ? nf(m.g) : "—"}</b>{m.st === "done" && !live ? " ✓" : ""}</div>
      {(m.st === "reading" || m.st === "waiting") && <Bar pct={m.pct} kind="read" label="Masters progress" />}
      <div className="tsm-note">{"Whole list last read: "}<span data-tpg-d-whole="">{whole ? whenWords(whole.started_at) + " · " + nf(whole.rows_read) + " ledgers" : live || m.st === "reading" ? "reading now" : h.rows ? "not yet" : "…"}</span>
        <br /><span data-tpg-d-light="">{"Changes checked every 10 min while open" + (lt ? " · last " + hhmm(/[zZ]|[+-]\d\d:?\d\d$/.test(lt) ? lt : lt + "+05:30") : "")}</span></div>
      {m.st === "waiting" && <div className="tsm-note bad" data-tpg-d-wait="">{m.words}</div>}
      {m.st === "why" && <div className="tsm-note bad">{m.words}</div>}
      {row.c && row.c.w === "Yes" && <div className="tpg-acts"><BringMasters row={row} primary={false} /></div>}
    </section>
    <section className="tpg-d-card" data-tpg-d="entries">
      <div className="tpg-kicker">{"Entries · " + fyLabel(fy)}</div>
      <div className="tpg-months" aria-label="Months" data-tpg-months="">{months(fy, bk, e.p).map((x) => <span key={x.m} data-tpg-month={x.k} title={x.m + ": " + MK[x.k]}><i className={x.k} />{x.m.charAt(0)}</span>)}</div>
      <div className="tsm-note">Green: in FinCom · light green: coming now · grey: to bring</div>
      <div className="tpg-line" data-tpg-d-entries="">{e.words}{e.sub ? " · " + e.sub : ""}</div>
      {e.p && !e.p.done && <Bar pct={e.pct} kind={e.st === "going" ? "read" : "wait"} label="Entries progress" />}
      <BringBooks cid={cid} e={e} />
    </section>
    <section className="tpg-d-card" data-tpg-history="">
      <div className="tpg-kicker">Update history</div>
      {h.err && <p className="tsm-note bad">{h.err}</p>}
      {!hist ? <p className="tsm-note">Reading…</p> : !hist.length ? <p className="tsm-note">No update yet.</p>
        : <ul className="tpg-hlist">{hist.map((r, k) => <li key={k} className={"tpg-h " + r.k} data-tpg-h={r.k}><span data-tpg-h-what="">{[whenWords(r.at), r.what, r.how].filter(Boolean).join(" · ")}</span><span data-tpg-h-res="">{r.res}</span></li>)}</ul>}
    </section>
  </div>;
}
