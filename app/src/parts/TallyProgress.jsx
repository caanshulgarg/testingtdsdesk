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
import { ledBook, ledgersOf, ledgersHeld, cloudLedgerCount, groupCount, GRP, lightAt, runPress, runWords, runBusy, keepWaitOf, cloudBook, d8Of, fyStart, daybookHeld } from "./TallyCompanies.jsx";
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
  const rw = runWords(cid, company), at = bk.ledgersAt || "";
  const running = !!(x && !x.end && !x.err && !x.late) || runBusy(cid);
  const of = x && x.prog ? Number(x.prog.of) || 0 : 0, read = x && x.prog ? Math.min(Number(x.prog.read) || 0, of || Infinity) : 0;
  const kw = company ? keepWaitOf(company) : "";
  const base = { n, g: g == null ? null : g, at, held };
  if (running) {
    if (kw && !(read > 0)) return Object.assign(base, { st: "waiting", words: /^waiting/i.test(kw) ? kw : "Waiting: " + kw, read, of, pct: 0 });
    if (of > 0) return Object.assign(base, { st: "reading", read, of, pct: Math.min(99, Math.round((read * 100) / of)), words: "Reading · " + nf(read) + " of " + nf(of) });
    if (read > 0) return Object.assign(base, { st: "reading", read, of: 0, pct: 0, words: "Reading… " + nf(read) + " so far" });
    return Object.assign(base, { st: "reading", read: 0, of: 0, pct: 0, words: rw && rw.text ? rw.text : "Reading…" });
  }
  if (rw && rw.phase === "why") return Object.assign(base, { st: "why", words: "Not done: " + rw.text.replace(/^Not updated:\s*/, "") });
  if (x && (x.err || x.late) && !held) return Object.assign(base, { st: "why", words: "Not done: " + (x.err || x.why || "no answer from Tally in 3 minutes") });
  if (held) return Object.assign(base, { st: "done", words: "✓ " + nf(n) + (n === 1 ? " ledger" : " ledgers") + (g != null ? " · " + nf(g) + (g === 1 ? " group" : " groups") : ""),
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
const BADGE = { reading: "Reading", waiting: "Waiting", done: "Done", why: "Not done", none: "Not brought in yet", going: "Bringing", after: "Paused for masters", paused: "Paused", stopped: "Stopped", uptodate: "Up to date", behind: "To bring" };
function MastersCard({ m, row }) {
  return <div className="tpg-step" data-tpg-step="masters" data-tpg-state={m.st}>
    <div className="tpg-step-top"><div><span className="tpg-kicker">Step 1 · Masters</span><b>Ledgers &amp; groups</b></div><span className={"tpg-badge " + m.st} data-tpg-badge="">{m.st === "done" ? "Done" + (m.at ? " · updated " + hhmm(m.at) : "") : BADGE[m.st]}</span></div>
    {(m.st === "reading" || m.st === "waiting") && <Bar pct={m.pct} kind="read" label="Masters progress" />}
    <div className="tpg-line" data-tpg-masters-words="">{m.st === "reading" && m.of > 0 ? <>Ledgers: <b>{nf(m.read) + " of " + nf(m.of)}</b>{" (" + m.pct + "%)"}</> : m.words}
      {m.g != null && m.st !== "none" ? " · groups: " + nf(m.g) : ""}</div>
    {m.st === "none" && row && <div className="tpg-acts"><BringMasters row={row} /></div>}
  </div>;
}
function EntriesCard({ e }) {
  const p = e.p;
  return <div className="tpg-step" data-tpg-step="entries" data-tpg-state={e.st}>
    <div className="tpg-step-top"><div><span className="tpg-kicker">Step 2 · Entries</span><b>{p ? "Day Books, " + partWords(p) : "Day Books"}</b></div><span className={"tpg-badge " + e.st} data-tpg-badge="">{BADGE[e.st]}</span></div>
    {p && !p.done && <Bar pct={e.pct} kind={e.st === "going" ? "read" : "wait"} label="Entries progress" />}
    <div className="tpg-line" data-tpg-entries-words="">{e.words}</div>
    {e.sub && <div className="tsm-note">{e.st === "after" ? "goes on by itself after masters · " + e.sub : e.sub}</div>}
    <PullButtons e={e} small />
  </div>;
}
// ---------- Coming in from Tally now (rows: the table's rows; the first client reading, waiting or paused)
export function busyRow(rows) {
  const linked = rows.filter((r) => r.kind === "client" && r.cid && r.company && r.c && r.c.w === "Yes");
  const st = linked.map((r) => { const m = mastersOf(r.cid, r.company), e = entriesOf(r.cid, m, r.last); return { r, m, e }; });
  return st.find((s) => s.m.st === "reading") || st.find((s) => s.m.st === "waiting") || st.find((s) => ["going", "after", "paused", "stopped"].includes(s.e.st)) || null;
}
export function ComingNow({ rows, beat }) {
  const [, tick] = useState(0), s = busyRow(rows);
  // (each 2 s while something moves: the read's own counts; the books' summary reads itself every 30 s)
  useEffect(() => { if (!s) return; const t = setInterval(() => tick((k) => k + 1), 2000); return () => clearInterval(t); }, [!!s]);
  if (!s) return <PostingWait beat={beat} hook="panel" />;
  return <section className="tsm-card tpg-now" aria-label="Coming in from Tally now" data-tpg-now={s.r.cid}>
    <div className="tpg-now-head"><h3>{"Coming in from Tally now · " + s.r.client}</h3><span className="tsm-note">Masters always go first; entries follow</span></div>
    <div className="tpg-steps"><MastersCard m={s.m} row={s.r} /><EntriesCard e={s.e} /></div>
    <PostingWait beat={beat} hook="panel" />
  </section>;
}

// ---------- one client's details, inside the Tally page
function months(fy, bk, p) {
  const out = [], from = d8Of(bk && bk.from), to = d8Of(bk && bk.to), t8 = today8();
  const pf = p && !p.done ? String(p.fy || "").replace(/-/g, "").slice(0, 8) : "";
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1, y = fy + (i >= 9 ? 1 : 0), first = y + String(m).padStart(2, "0") + "01", last = y + String(m).padStart(2, "0") + "31";
    let k = "later";
    if (first > t8) k = "later";
    else if (/^\d{8}$/.test(to) && /^\d{8}$/.test(from) && first <= to && last >= from) k = last <= to ? "in" : "part";
    else k = "bring";
    if (k !== "in" && k !== "later" && pf && pf.slice(0, 4) === String(fy)) k = "coming";
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
export function ClientDetails({ row }) {
  const [, tick] = useState(0), cid = row.cid, company = row.company;
  useEffect(() => { let on = true; Promise.all([cloudLedgerCount(cid).catch(() => null), groupCount(cid).catch(() => null)]).then(() => { if (on) tick((k) => k + 1); }); return () => { on = false; }; }, [cid]);
  const m = mastersOf(cid, company), e = entriesOf(cid, m, row.last), h = useRounds(cid), kw = company ? keepWaitOf(company) : "";
  useEffect(() => { if (m.st !== "reading" && m.st !== "waiting") return; const t = setInterval(() => tick((k) => k + 1), 2000); return () => clearInterval(t); }, [m.st]);
  const lt = lightAt(company), whole = (h.rows || []).find((r) => r.complete && r.rows_read != null && !(Number(r.rows_received) < Number(r.rows_read)));
  const live = (h.rows || []).find((r) => !r.complete && Date.now() - Date.parse(r.last_seen_at || "") < 180000);
  const total = whole ? Number(whole.rows_read) || 0 : 0;
  const ledW = m.st === "reading" && m.of > 0 ? nf(m.read) + " of " + nf(m.of) : live ? nf(Number(live.rows_received) || 0) + (total ? " of " + nf(total) : " so far") + " · reading now" : nf(m.n);
  const fy = e.p ? Number(String(e.p.fy || "").slice(0, 4)) || fyNow() : fyNow(), bk = cloudBook(cid) || {};
  return <div className="tpg-details" data-tpg-details={cid}>
    {/* (inline under the client's row: its name, connection and one button are the row's own) */}
    <div className="tpg-steps">
      <section className="tsm-card tpg-d-card" data-tpg-d="masters">
        <div className="tpg-step-top"><h3>Masters</h3><span className={"tpg-badge " + (live && m.st === "done" ? "reading" : m.st)} data-tpg-d-badge="">{m.st === "reading" || live ? "Reading now" : BADGE[m.st]}</span></div>
        {(m.st === "reading" || m.st === "waiting") && <Bar pct={m.pct} kind="read" label="Masters progress" />}
        <dl className="tpg-dl">
          <dt>Ledgers in FinCom</dt><dd data-tpg-d-ledgers="">{m.held || m.st === "reading" || live ? ledW : "none yet"}</dd>
          <dt>Groups in FinCom</dt><dd data-tpg-d-groups="">{m.g != null ? nf(m.g) : "—"}</dd>
          <dt>Whole list last read</dt><dd data-tpg-d-whole="">{whole ? whenWords(whole.started_at) + " · " + nf(whole.rows_read) + " ledgers" : live ? "not yet · reading now" : h.rows ? "not yet" : "…"}</dd>
          <dt>Changes checked</dt><dd data-tpg-d-light="">{"every 10 min while open" + (lt ? " · last " + hhmm(/[zZ]|[+-]\d\d:?\d\d$/.test(lt) ? lt : lt + "+05:30") : "")}</dd>
          {m.st === "waiting" && <><dt>Waiting</dt><dd data-tpg-d-wait="">{m.words}</dd></>}
          {m.st === "why" && <><dt>Last try</dt><dd className="bad">{m.words}</dd></>}
        </dl>
        {row.c && row.c.w === "Yes" && <div className="tpg-acts"><BringMasters row={row} primary={false} /></div>}
        <div className="tsm-note">Masters always come before entries. TDS, GST and bank screens use these ledgers.</div>
      </section>
      <section className="tsm-card tpg-d-card" data-tpg-d="entries">
        <div className="tpg-step-top"><h3>{"Entries · " + fyLabel(fy)}</h3><span className={"tpg-badge " + e.st}>{BADGE[e.st]}</span></div>
        {e.p && !e.p.done && <Bar pct={e.pct} kind={e.st === "going" ? "read" : "wait"} label="Entries progress" />}
        <div className="tpg-line" data-tpg-d-entries="">{e.words}{e.sub ? " · " + e.sub : ""}</div>
        <div className="tpg-months" aria-label="Months" data-tpg-months="">{months(fy, bk, e.p).map((x) => <span key={x.m} data-tpg-month={x.k} title={x.m + ": " + MK[x.k]}><i className={x.k} />{x.m}</span>)}</div>
        <div className="tsm-note">Dark green: in FinCom · light green: coming in now · grey: to bring · pale: not yet in the year</div>
        <PullButtons e={e} />
        {/* Bring books (another year, Start, Pause, Resume, Stop): Books › From Tally's own, here */}
        <OlderEntries cid={cid} />
      </section>
    </div>
    <section className="tsm-card tpg-hist" data-tpg-history="">
      <h3>Update history</h3>
      {h.err && <p className="tsm-note bad">{h.err}</p>}
      {!h.rows ? <p className="tsm-note">Reading…</p> : <div className="tsm-scroll"><table className="tpg-hist-t">
        <thead><tr><th>When</th><th>What</th><th>How</th><th>Result</th></tr></thead>
        <tbody>{historyRows(h.rows, m, e, kw).map((r, i) => <tr key={i} className={"tpg-h " + r.k} data-tpg-h={r.k}><td data-label="When">{whenWords(r.at)}</td><td data-label="What">{r.what}</td><td data-label="How">{r.how}</td><td data-label="Result">{r.res}</td></tr>)}
          {!historyRows(h.rows, m, e, kw).length && <tr><td colSpan={4} className="tsm-note">No update yet.</td></tr>}</tbody></table></div>}
    </section>
  </div>;
}
