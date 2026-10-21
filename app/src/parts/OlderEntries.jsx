// FinCom Bridge 2.4.5 (ROUND 102; the owner's change and decisions of 21-Oct-2026): "Bring older entries from Tally", for a
// period the PERSON chooses; never everything by itself. Books › From Tally, and Connect Tally after step 6, show the same
// card (a lazy chunk of its own: the first file and legacy.js stay within their budgets):
//   [FY 2025-26 ▾] [Whole year | Apr–Sep | Oct–Mar] Start
// The bridge first counts the year in Tally one day at a time ("Counting the year in Tally… 132 of 365 days"); the
// half-years are offered once the year is counted at more than 20,000 vouchers (the owner's decision). Then the entries
// FinCom lacks come in, one day at a time while Tally is idle: "8,412 of 12,960 vouchers (65%) · 4,548 left". Pause and
// Resume; it goes on from where it stopped. A day Tally could not give quickly enough shows ONE quiet line with its Upload
// (the words FinCom keeps); nothing else about Tally is shown here. The cloud keeps it all (migration 98:
// tally_period_status, tally_period_choose, tally_period_pause); a cloud without 98 shows nothing.
import { useEffect, useRef, useState } from "react";

const POLL_MS = 15000;
const nf = (n) => Number(n || 0).toLocaleString("en-IN");
const PARTS = [["year", "Whole year"], ["h1", "Apr–Sep"], ["h2", "Oct–Mar"]];
function fyNow() { const t = new Date(Date.now() + 5.5 * 3600e3); return t.getUTCFullYear() - (t.getUTCMonth() < 3 ? 1 : 0); }
const fyLabel = (y) => "FY " + y + "-" + String(y + 1).slice(2);
const fyIso = (y) => y + "-04-01";
const fyOf8 = (d8) => Number(String(d8 || "").slice(0, 4)) || 0;
function bookOf(cid) { return typeof TCloud === "object" && TCloud.book ? TCloud.book(cid) : null; }
const rpc = (fn, args) => (typeof TCloud === "object" && TCloud.rpc ? TCloud.rpc(fn, args) : Promise.reject(new Error("no cloud")));
const dayWords = (d8) => { try { return fmtDate(tallyDate(d8)); } catch (e) { return d8; } };

// "8,412 of 12,960 vouchers (65%) · 4,548 left" (the percentage never 100 until every one is in)
export function progressWords(p) {
  if (!p) return "";
  if (p.counting) return "Counting the year in Tally… " + nf(p.countedDays) + " of " + nf(p.yearDays) + " days";
  const y = Number(p.y || 0), x = Math.min(Number(p.x || 0), y), left = Math.max(y - x, 0);
  if (!y) return "Tally lists no vouchers for this period";
  let pct = Math.round((x * 100) / y);
  if (left > 0 && pct >= 100) pct = 99;
  return nf(x) + " of " + nf(y) + " vouchers (" + pct + "%) · " + (left ? nf(left) + " left" : "all in FinCom ✓");
}

export default function OlderEntries({ cid, where }) {
  const bk = bookOf(cid), book = bk && bk.book;
  const [st, setSt] = useState(null), [off, setOff] = useState(false), [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const [fy, setFy] = useState(0), [part, setPart] = useState("");
  // review 245 R2: an answer for the book shown before is never shown under this one
  const cur = useRef(book); cur.current = book;
  const load = () => { const b = book; return !b ? Promise.resolve() : rpc("tally_period_status", { p_book: b }).then((r) => { if (cur.current !== b) return; if (r && r.ok) { setSt(r); setOff(false); } }, (e) => {
    if (cur.current !== b) return;
    // a cloud without migration 98 (the function not there): nothing shown, quietly
    if (/PGRST202|tally_period_status|does not exist|schema cache|404/i.test(String((e && e.message) || e))) setOff(true);
  }); };
  // review 245 R1: another book starts from its own state (the year and part chosen there, not the previous client's)
  useEffect(() => { setSt(null); setFy(0); setPart(""); setErr(""); load(); }, [book]);
  const pull = st && st.pull;
  const going = !!(pull && pull.state === "going" && !pull.done);
  useEffect(() => { if (!going) return; const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, [going, book]);
  if (!book || off) return null;
  const now = fyNow(), years = [0, 1, 2, 3, 4, 5].map((i) => now - i);
  const chosenFy = fy || (pull ? fyOf8(pull.fy) : now - 1);
  const half = !!(pull && pull.half && fyOf8(pull.fy) === chosenFy);
  // the part shown: the person's pick, else the running pull's own part for its year (a reload never offers to switch it)
  const running = pull && fyOf8(pull.fy) === chosenFy ? pull.part : "";
  // review 245 R2: a half-year already chosen stays shown (and chosen) while a new day of the year is being counted
  const curPart = part && (half || part === "year") ? part : running || "year";
  const act = (fn, args, what) => { const b = book; setBusy(what); setErr("");
    // review 245 R3: a reply for the book shown before is never shown under this one
    return rpc(fn, args).then((r) => { if (cur.current !== b) return; if (r && r.ok === false) setErr(String(r.error || "FinCom did not take it")); if (r && r.pull !== undefined) setSt(r); else return load(); },
      (e) => { if (cur.current === b) setErr("FinCom’s cloud did not answer; try again in a minute."); }).finally(() => setBusy("")); };
  const start = () => act("tally_period_choose", { p_book: book, p_fy_start: fyIso(chosenFy), p_part: curPart }, "start");
  const pause = (on) => act("tally_period_pause", { p_book: book, p_pause: on }, on ? "pause" : "resume");
  const same = pull && fyOf8(pull.fy) === chosenFy && (pull.part === curPart);
  return <section className="dash-card older-entries" data-older-entries={where || ""} style={{ marginBottom: 12 }}>
    <h3>Bring older entries from Tally</h3>
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select data-older-fy="" aria-label="Financial year" value={chosenFy} onChange={(ev) => { setFy(Number(ev.target.value)); setPart(""); }}>
        {years.map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}</select>
      <span className="seg" role="group" aria-label="Which part of the year" data-older-parts="">
        {PARTS.map(([k, label]) => {
          const dis = k !== "year" && !half;
          return <button key={k} type="button" className={"btn small" + (curPart === k ? " primary" : "")} data-older-part={k} aria-pressed={curPart === k ? "true" : "false"}
            disabled={dis} title={dis ? "Offered once the year is counted at more than 20,000 vouchers" : undefined} onClick={() => setPart(k)}>{label}</button>;
        })}</span>
      {!(going && same) && <button className="btn small primary" data-older-start="" disabled={!!busy} onClick={start}>{busy === "start" ? "Starting…" : pull && same && pull.state === "paused" ? "Start again" : "Start"}</button>}
      {pull && pull.state === "going" && !pull.done && <button className="btn small" data-older-pause="" disabled={!!busy} onClick={() => pause(true)}>Pause</button>}
      {pull && pull.state === "paused" && <button className="btn small" data-older-resume="" disabled={!!busy} onClick={() => pause(false)}>Resume</button>}
    </div>
    {pull && <p className="tg-progress" data-older-progress={pull.counting ? "counting" : pull.done ? "done" : "fetching"} role="status" style={{ margin: "8px 0 0" }}>
      {(pull.state === "paused" ? "Paused · " : pull.state === "stopped" ? "Stopped · " : "") + fyLabel(fyOf8(pull.fy)) + (pull.part === "h1" ? " Apr–Sep" : pull.part === "h2" ? " Oct–Mar" : "") + ": " + progressWords(pull)}</p>}
    {pull && pull.counting && <p className="note" style={{ margin: "4px 0 0" }}>FinCom Bridge reads one day at a time, only while nobody is working in Tally. Nothing else is needed.</p>}
    {pull && !pull.counting && pull.half && pull.part === "year" && !pull.done && <p className="note" data-older-half="" style={{ margin: "4px 0 0" }}>{"This year holds " + nf(pull.yearVouchers) + " vouchers: you may bring in April–September or October–March first."}</p>}
    {err && <p className="note" data-older-err="" style={{ margin: "4px 0 0" }}>{err}</p>}
    {/* ROUND 103 (1b): the bridge stopped reading (Tally too slow or its window held): one quiet line, the days to upload */}
    {pull && pull.stopped && <p className="note" data-older-stopped="" style={{ margin: "4px 0 0" }}>{pull.stopped.words + " "}
      <button className="linkbtn" data-older-stopped-go="" onClick={() => typeof tallyPickFor === "function" && tallyPickFor(tallyDate(pull.stopped.from || pull.stopped.day), tallyDate(pull.stopped.to))}>{"Upload " + dayWords(pull.stopped.from || pull.stopped.day) + " to " + dayWords(pull.stopped.to)}</button></p>}
    {pull && (pull.upload || []).map((u) => <p key={u.day} className="note" data-older-upload={u.day} style={{ margin: "4px 0 0" }}>{u.words + " "}
      <button className="linkbtn" data-older-upload-go={u.day} onClick={() => typeof tallyPickFor === "function" && tallyPickFor(tallyDate(u.day), tallyDate(u.day))}>{"Upload " + dayWords(u.day)}</button></p>)}
  </section>;
}
