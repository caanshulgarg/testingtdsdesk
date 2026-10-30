// 30-Oct-2026 (the owner: "there should be a button 'check any change'.. if there is any change then it should do it").
// One button, "Check for changes in Tally", on Books › From Tally and on the client's row of the Tally page. The person picks
// the period (this financial year so far, this month, the last 7 days, or a range of their own; never before the books
// start, never after today); the press queues those days for the day check of migration 133 (tally_check_request,
// migration 135): FinCom Bridge lists each day in Tally through the existing older-entries path, and FinCom corrects its own
// copy to Tally (adds, updates, and deletes with history kept after two whole-day lists a minute apart). Then the progress
// ("Checked 120 of 213 days · about 6 min left") and the result in plain words with the changes already made ("Done: 5
// changes made from Tally — 3 added, 1 changed, 1 deleted (kept in history). 208 days already matched.", or "No changes:
// FinCom matches Tally for 1-Apr to 30-Oct"), with the list. Nothing is ever changed in Tally and nothing new is asked of it:
// one day at a time, only while Tally is free, each request stopped at 2 seconds, postings first; "Bring books from Tally"
// goes first. Its own file, loaded only with the Tally page and Books › From Tally (the app's first file and legacy.js stay
// within budget).
import { useEffect, useState } from "react";
import { nf, day8, dayLong, hm, fyNow, plural, rpc, missing, may, TurnOn, bookSum, summary, etaWords, partWords, askStatus, askOff, bookFetch, paceWords } from "./TallyFetch.jsx";

const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const istDay = (at) => { const t = Date.parse(at || ""); return t ? new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10) : ""; };
const minus = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") - n * 864e5).toISOString().slice(0, 10);
const iso8 = (d) => { const s = String(d || "").replace(/-/g, ""); return s.length === 8 ? s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8) : ""; };
export const PERIODS = [["fy", "This financial year so far"], ["month", "This month"], ["week", "Last 7 days"], ["own", "Dates of my own…"]];
// the period's first and last day (India's today), never before the books start
export function periodOf(kind, from, to, booksFrom) {
  const t = istToday();
  let a = kind === "month" ? t.slice(0, 8) + "01" : kind === "week" ? minus(t, 6) : kind === "own" ? (from || "") : fyNow() + "-04-01";
  let z = kind === "own" ? (to || "") : t;
  const bf = iso8(booksFrom);
  if (a && bf && a < bf) a = bf;
  if (z && z > t) z = t;
  return [a, z];
}
// "1-Apr to 30-Oct" (the years said when they differ or are not this year's)
export function rangeWords(a, z) {
  const y = (d) => String(d || "").replace(/-/g, "").slice(0, 4), now = istToday().slice(0, 4);
  return y(a) === y(z) && y(a) === now ? day8(a) + " to " + day8(z) : dayLong(a) + " to " + dayLong(z);
}
// the result in plain words
export function resultWords(k) {
  if (!k) return "";
  const a = Number(k.added || 0), c = Number(k.changed || 0), d = Number(k.deleted || 0), n = a + c + d;
  if (!n && !Number(k.upload || 0)) return "No changes: FinCom matches Tally for " + rangeWords(k.from, k.to);
  const bits = [a ? nf(a) + " added" : "", c ? nf(c) + " changed" : "", d ? nf(d) + " deleted (kept in history)" : ""].filter(Boolean);
  return "Done: " + (n ? plural(n, "change", "changes") + " made from Tally — " + bits.join(", ") + "." : "no changes made from Tally.") +
    (Number(k.same) ? " " + plural(k.same, "day", "days") + " already matched." : "") + (Number(k.upload) ? " " + plural(k.upload, "day", "days") + " could not be checked (below)." : "");
}
export function progressWords(k) {
  if (!k) return "";
  return "Checked " + nf(k.checked + (k.upload || 0)) + " of " + plural(k.total, "day", "days") + (Number(k.etaMin) > 0 ? " · " + etaWords(k.etaMin) + " left" : k.checked ? " · working out the time…" : "");
}
// why it waits, in plain words ("" when it is moving)
function waitWords(k, b) {
  if (!k || k.state === "done") return "";
  if (k.run && k.run.state === "stopped") return "Stopped: Tally was busy. Press Check for changes in Tally to go on.";
  if (k.paused) return "Waiting: Bring books from Tally is paused; the check goes on when you press Resume there.";
  if (k.after) return "Waiting for Bring books from Tally" + (b && b.pull ? " (" + partWords(b.pull) + ")" : "") + " to finish: the check goes next.";
  const devs = (b && b.devices) || [];
  if (!devs.length) return "Waiting: open " + ((b && b.company) || "the company") + " in TallyPrime on the Tally computer, with FinCom Bridge running.";
  if (!devs.some((x) => x.fetchOn)) return "Waiting: reading older entries is off for the Tally computer that has this company.";
  return "";
}

const askOf = (cid, book) => (askStatus() || []).find((k) => k.book === book) || (askStatus() || []).find((k) => k.client === cid) || null;

function List({ cid }) {
  const [r, setR] = useState(null);
  useEffect(() => { let live = true;
    rpc("tally_check_ask_status", { p_client: cid }).then((x) => { if (live) setR((x && x.ok && (x.asks || [])[0]) || { rows: [] }); }, () => { if (live) setR({ rows: [], err: true }); });
    return () => { live = false; }; }, [cid]);
  if (!r) return <p className="note">Reading the list…</p>;
  if (r.err) return <p className="note bad">FinCom’s cloud did not answer; try again in a minute.</p>;
  const rows = r.rows || [];
  if (!rows.length) return null;
  const WHAT = { added: "added", changed: "changed", deleted: "deleted (kept in history)" };
  return <div style={{ overflowX: "auto" }}><table className="data" data-cc-table=""><thead><tr><th>Date</th><th>Voucher</th><th>Party</th><th className="n">Amount</th><th>What FinCom did</th></tr></thead>
    <tbody>{rows.map((x, i) => <tr key={i} data-cc-row={x.what}><td>{dayLong(x.day)}</td><td>{[x.vtype, x.vno].filter(Boolean).join(" ") || "—"}</td><td>{x.party || "—"}</td>
      <td className="n">{x.amount == null ? "—" : Number(x.amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td>{WHAT[x.what] || x.what}</td></tr>)}</tbody></table></div>;
}

export default function CheckChanges({ cid, where = "books" }) {
  const b = bookSum(cid), k0 = b ? askOf(cid, b.book) : null;
  const [kind, setKind] = useState("fy"), [own, setOwn] = useState(["", ""]), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [mine, setMine] = useState(null), [open, setOpen] = useState(where === "books");
  const book = (b && b.book) || "";
  useEffect(() => { setErr(""); setMine(null); }, [book]);
  // the press's own answer until the firm's list carries it (then the list, read again while it goes)
  const k = k0 && (!mine || Date.parse(k0.at) >= Date.parse(mine.at)) ? k0 : mine;
  const going = !!(k && k.state !== "done");
  const [, tick] = useState(0);
  useEffect(() => { if (!going) return; const t = setInterval(() => { askStatus(true); summary(true); tick((n) => n + 1); }, 10000); return () => clearInterval(t); }, [going]);
  if (!b || askOff()) return null;
  const [a, z] = periodOf(kind, own[0], own[1], b.from), today = istToday(), bf = iso8(b.from);
  const press = () => { if (!a || !z) { setErr("Choose the first and the last day."); return; }
    setBusy(true); setErr("");
    rpc("tally_check_request", { p_client: cid, p_from: a, p_to: z }).then((r) => {
      if (r && r.ok === false) setErr(String(r.error || "FinCom did not take it")); else if (r && r.ok) setMine(r);
      askStatus(true); summary(true); },
      (e) => setErr(missing(e) ? "FinCom’s cloud cannot check for changes yet." : "FinCom’s cloud did not answer; try again in a minute.")).finally(() => setBusy(false)); };
  const off = !((b.devices || []).some((x) => x.fetchOn)) && (b.devices || []).length > 0;
  const wait = waitWords(k, b), pct = k && k.total ? Math.min(100, Math.round(((k.checked + (k.upload || 0)) * 100) / k.total)) : 0;
  const picker = may() && <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
    <select data-cc-period="" aria-label="Period to check against Tally" value={kind} style={{ width: "auto", minWidth: 0 }} onChange={(ev) => setKind(ev.target.value)}>
      {PERIODS.map(([v, w]) => <option key={v} value={v}>{w}</option>)}</select>
    {kind === "own" && <>
      <input type="date" data-cc-from="" aria-label="First day" min={bf || undefined} max={today} value={own[0]} style={{ width: "auto" }} onChange={(ev) => setOwn([ev.target.value, own[1]])} />
      <span className="note">to</span>
      <input type="date" data-cc-to="" aria-label="Last day" min={bf || undefined} max={today} value={own[1]} style={{ width: "auto" }} onChange={(ev) => setOwn([own[0], ev.target.value])} /></>}
    <button className={"btn small" + (going ? "" : " primary")} data-cc-go="" disabled={busy} onClick={press}>{busy ? "Asking Tally…" : "Check for changes in Tally"}</button>
    {a && z && a <= z && <span className="note" data-cc-range="">{rangeWords(a, z)}</span>}
  </div>;
  const body = <>
    {k && going && <div className="tco-sync" data-cc-progress={k.state} role="status" style={{ marginTop: 8 }}>
      <div className="tco-bar" role="progressbar" aria-label="Checking FinCom against Tally" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i className="det" style={{ width: Math.max(2, pct) + "%" }} /></div>
      <span data-cc-words="">{progressWords(k) + " (" + rangeWords(k.from, k.to) + ")"}</span></div>}
    {k && going && !wait && paceWords((bookFetch(cid, book) || {}).hours) && <p className="note" data-cc-pace="" style={{ margin: "4px 0 0" }}>{paceWords((bookFetch(cid, book) || {}).hours)}</p>}
    {wait && <p className={"note" + (k && k.run && k.run.state === "stopped" ? " bad" : "")} data-cc-wait={k && k.run && k.run.state === "stopped" ? "stopped" : k && k.paused ? "paused" : k && k.after ? "after" : "computer"} style={{ margin: "6px 0 0" }}>{wait}<TurnOn b={b} /></p>}
    {!k && off && <p className="note" data-cc-off="" style={{ margin: "6px 0 0" }}>Checking needs reading older entries on for the Tally computer that has this company.<TurnOn b={b} /></p>}
    {k && !going && <div data-cc-result={Number(k.added || 0) + Number(k.changed || 0) + Number(k.deleted || 0) ? "changes" : "none"} style={{ marginTop: 8 }}>
      <p className={Number(k.added || 0) + Number(k.changed || 0) + Number(k.deleted || 0) || Number(k.upload || 0) ? "" : "ok"} data-cc-done="" style={{ margin: 0 }}>{resultWords(k)}
        <span className="note">{" (checked " + (istDay(k.at) === istToday() ? hm(k.at) : dayLong(istDay(k.at))) + ")"}</span></p>
      {(k.uploadDays || []).map((u) => <p key={u.day} className="note" data-cc-upload={u.day} style={{ margin: "4px 0 0" }}>{dayLong(u.day) + ": " + (u.words || "") + " "}
        <button className="linkbtn" onClick={() => typeof tallyPickFor === "function" && tallyPickFor(tallyDate(u.day), tallyDate(u.day))}>{"Upload " + dayLong(u.day)}</button></p>)}
      {Number(k.added || 0) + Number(k.changed || 0) + Number(k.deleted || 0) > 0 && <>
        {where !== "books" && <button className="linkbtn" data-cc-list-open="" aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)}>{open ? "Hide the list" : "Show the list"}</button>}
        {open && <div data-cc-list="" style={{ marginTop: 6 }}><List cid={cid} key={k.at} /></div>}</>}
    </div>}
    {err && <p className="note bad" data-cc-err="" style={{ margin: "4px 0 0" }}>{err}</p>}
  </>;
  if (where !== "books") return <div className="tfx-line tfx-cc" data-check-changes="row">{picker}{body}</div>;
  return <section className="dash-card tfx-cc" data-check-changes="books" style={{ marginBottom: 12 }}>
    <h3>Check for changes in Tally</h3>
    <p className="note" style={{ margin: "0 0 8px" }}>FinCom compares each day of the period with Tally and corrects its own copy: entries added, changed or deleted in Tally are brought in (a deleted one is kept in history). Nothing is ever changed in Tally.</p>
    {picker}{body}
    <p className="note" data-cc-safe="" style={{ margin: "8px 0 0" }}>FinCom Bridge reads one day at a time, only while nobody is working in Tally; each request stops at 2 seconds and postings go first, so Tally never hangs.</p>
  </section>;
}

// ---------- Books › From Tally: the missing days brought by themselves (the owner, 30-Oct-2026, 16:30: "I have already
// uploaded the books.. it shows very few days need books.. why don't we automatically bring only those days instead of
// all"). The days of the "N days need a Day Book" list (lib/needDays.js) are queued once a visit (tally_fill_request,
// migration 135) when the list is not empty, the person may change the books and the Tally computer's switch is on; no
// button. One quiet line: "Bringing 7 missing days from Tally · about 1 min left", then "Brought 7 missing days from Tally ✓".
const ASKED = new Set();
export const daysOf = (need) => { const out = [];
  for (const r of need || []) { const a = iso8(r.from), z = iso8(r.to || r.from); if (!a || !z) continue;
    for (let d = z; d >= a && out.length < 400; d = minus(d, 1)) if (!out.includes(d)) out.push(d); }
  return out.sort().reverse().slice(0, 400); };
export function MissingDays({ cid, need }) {
  const b = bookSum(cid), days = daysOf(need), on = !!(b && (b.devices || []).some((x) => x.fetchOn)), sig = cid + "|" + days.join(",");
  const f = b ? (bookFetch(cid, b.book) || {}).fill : null;
  const [, tick] = useState(0);
  useEffect(() => { if (!b || !days.length || !on || !may() || askOff() || ASKED.has(sig)) return; ASKED.add(sig);
    rpc("tally_fill_request", { p_client: cid, p_days: days }).then(() => { askStatus(true); }, () => { ASKED.delete(sig); }); }, [sig, on, !!b]);
  const going = !!(f && f.waiting > 0);
  useEffect(() => { if (!going) return; const t = setInterval(() => { askStatus(true); tick((n) => n + 1); }, 10000); return () => clearInterval(t); }, [going]);
  if (!b || !f || askOff()) return null;
  const ch = Number(f.added || 0) + Number(f.changed || 0) + Number(f.deleted || 0);
  if (going) return <p className="note tfx-fill" data-fill-line="going" role="status" style={{ margin: "0 0 10px" }}>{"Bringing " + plural(f.total, "missing day", "missing days") + " from Tally" +
    (Number(f.etaMin) > 0 ? " · " + etaWords(f.etaMin) + " left" : f.done ? " · working out the time…" : "") + (f.done ? " (" + nf(f.done) + " done)" : "")}</p>;
  return <p className="note ok tfx-fill" data-fill-line="done" style={{ margin: "0 0 10px" }}>{"Brought " + plural(f.done, "missing day", "missing days") + " from Tally ✓" +
    (ch ? " (" + plural(f.added, "entry", "entries") + " added" + (f.changed ? ", " + nf(f.changed) + " changed" : "") + (f.deleted ? ", " + nf(f.deleted) + " deleted, kept in history" : "") + ")" : " (nothing was missing)") +
    (Number(f.upload) ? " · " + plural(f.upload, "day", "days") + " to upload by hand" : "")}</p>;
}
