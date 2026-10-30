// The "From Tally" tab of a client's books: uploading the Tally data. FinCom 2.4.0 (the owner, 08-Oct-2026: "change the
// data xml upload page.. it is too much crowded.. simplify it.. whatever is necessary should remain.. extra fields should
// be removed"): one short flow, docs/ui-pass/uploadpage/README.md says what went and why.
//   1. one status line: "Books from Tally: FY 2026-27 · entries up to 07-Oct-2026 · 2 days need a Day Book";
//   2. Upload Tally data: one drop area (the same file box, #tallyIn, as the top bar's Upload Tally data) for a Day Book,
//      the ledger masters or a trial balance, as XML or JSON or a zip of them (28-Oct-2026). Which file it is, and its dates, come from the file (tallyFiles,
//      src/js/23); only a trial balance's date is asked, as Tally does not write it in the file. The progress line (the
//      file on its way to FinCom's cloud, the server's job) and the result in plain words;
//   3. Days that need a Day Book: the days the shared classifier says only that day's Day Book settles (Rec.needKind,
//      src/js/61: daybook, dupid), the cloud's gap (Rec.gapFor), the dates between the files brought in. Each Upload takes
//      only those dates from the file (tallyPickFor; the period guard in bringDayBookFile);
//   4. How to export from Tally, folded, three steps.
// Kept, minimally: the tie-out result (one line), the warning when the books are another PAN's, and More (Restore, the
// removals, and the bridge's own update settings when this computer has one).
import { lazy, Suspense, useEffect, useState } from "react";
import { JobsNote } from "../../parts/Notes.jsx";
import DateBox from "../../parts/DateBox.jsx";
import { needDays } from "../../lib/needDays.js";
// 26-Oct-2026: the ledgers' one bar (reading / done / stuck / today's changes), as on the Tally page's row; loaded with
// the Tally screen's own code, so the app's first file stays within its budget
const LedgerBar = lazy(() => import("../../parts/TallyCompanies.jsx").then((m) => ({ default: m.LedgerBar })));
// 30-Oct-2026 (the owner: books brought from Tally with a progress bar and its timing; an upload checked against Tally and
// corrected to it): the two cards, in their own file (parts/TallyFetch.jsx), loaded only here and on the Tally page
const OlderEntries = lazy(() => import("../../parts/TallyFetch.jsx"));
const UploadCheck = lazy(() => import("../../parts/TallyFetch.jsx").then((m) => ({ default: m.UploadCheck })));
const hasLedBook = (cid) => { const s = typeof TCloud === "object" && TCloud.st ? TCloud.st[cid] : null; return !!(s && Array.isArray(s.books) && s.books.some((x) => x && x.book)); };
const d = (x) => fmtDate(tallyDate(x));
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

// the books' last entry (yyyymmdd)
function lastEntry(b) { let l = ""; (b.vouchers || []).forEach((v) => { if (v && !v.cancel && String(v.date) > l) l = String(v.date); }); return l; }
// round 66 (the owner, 16-Oct-2026: "FY 2026-27" was said of books that start on 01-Apr-2025): the books' first entry
function firstEntry(b) { let f = ""; (b.vouchers || []).forEach((v) => { if (v && !v.cancel && v.date && (!f || String(v.date) < f)) f = String(v.date); }); return f; }
function fyOf(d8) { const y = +String(d8).slice(0, 4), m = +String(d8).slice(4, 6), s = m < 4 ? y - 1 : y; return s + "-" + String(s + 1).slice(2); }

// the days that need a Day Book (lib/needDays.js: the top bar's Upload button reads it too, without this tab's code)
export { needDays };

// 1. the one status line
function Status({ b, days }) {
  const n = (b.vouchers || []).length, last = lastEntry(b), m = b.meta || {};
  const first = firstEntry(b), span = fyOf(first) === fyOf(last) ? "FY " + fyOf(last) : "FY " + fyOf(first) + " to " + fyOf(last);
  const bits = ["Books from Tally: " + (n && last ? span : "nothing yet")];
  if (n && last) bits.push("entries " + d(first) + " to " + d(last));
  else bits.push("upload the Day Book (XML or JSON) exported from Tally");
  if (n && !b.ledInfoAt && !Object.keys(b.pans || {}).length) bits.push("ledger masters not uploaded");
  if (n && (m.parts || []).length && !(b.tb && Object.keys(b.tb.led || {}).length)) bits.push("opening balances not uploaded");
  const k = days.reduce((a, x) => a + x.days, 0);
  if (k) bits.push(k + (k === 1 ? " day needs" : " days need") + " a Day Book");
  // Update now (24-Oct-2026: the link line that carried it is gone; the Tally page's row has Sync now too)
  const linked = typeof tallyLinkOf === "function" && tallyLinkOf(CO()).state !== "unlinked";
  const can = n > 0 && (linked || (typeof Bridge === "object" && Bridge.on() && Bridge.up()) || (typeof TCloud === "object" && S.coId && TCloud.has(S.coId)));
  return <p className="up-status" style={{ margin: "10px 0 12px" }}><b data-up-status="">{bits.join(" · ")}</b>
    {can && <>{" "}<button className="linkbtn" data-update-now="" onClick={() => doAct("keepNow")}>Update now</button></>}</p>;
}

// 2. the one drop area (the same file box as the top bar's Upload Tally data)
function Drop() {
  const [over, setOver] = useState(false);
  return <div className={"drop up-drop" + (over ? " over" : "")} role="button" tabIndex={0} aria-label="Bring in from Tally" data-up-drop=""
    onClick={() => doAct("tallyPick")}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doAct("tallyPick"); } }}
    onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); tallyFiles(Array.from(e.dataTransfer.files || [])); }}>
    <strong>Drop the Day Book or ledger masters here (XML, JSON or a zip of them)</strong>
    <div className="note">or click to choose it; several months at once are fine. FinCom reads which file it is, and its dates, from the file.</div>
  </div>;
}

function TbAsk() {
  const a = S.tbAsk;
  if (!a || a.cid !== S.coId) return null;
  return <div className="up-ask" data-tb-ask="" style={{ margin: "10px 0 0" }}>
    <p className="note" style={{ margin: "0 0 6px" }}><b>{a.name}</b> is a trial balance. Tally does not write its date in the file: as on{" "}
      <DateBox aria-label="Trial balance as on" value={a.on || ""} onChange={(ev) => { a.on = ev.target.value; render(); }} /></p>
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <button className="btn small" onClick={() => tbAskUse("open")}>Use as opening balances</button>
      <button className="btn small" onClick={() => tbAskUse("check")}>Check the books against it</button>
      <button className="linkbtn" onClick={() => { S.tbAsk = null; render(); }}>Cancel</button></div>
  </div>;
}

function Upload({ b }) {
  const lim = S.dbFrom || S.dbTo ? [S.dbFrom || S.dbTo, S.dbTo || S.dbFrom] : null;
  const u = S.tallyUp && S.tallyUp.cid === S.coId ? S.tallyUp : null;
  // a Day Book waiting for the sign-in goes on its own; said once, quietly. 17-Oct-2026 (staging: a 170 MB Day Book refused
  // by Storage, said nowhere): one that could not go says why, plainly, with Send again (tallySendAgain, src/js/23)
  const parts = (b.meta || {}).parts || [];
  const waiting = parts.filter((p) => /^waiting/.test(String(p.cloud || "")));
  const notSent = parts.map((p, i) => ({ p, i })).filter((x) => /^not sent/.test(String(x.p.cloud || "")));
  // from Getting ready's "Read the balances" (smart moves round 1): where the opening balances come from, said here
  const opening = S.upFocus === "opening" && !(b.tb && Object.keys(b.tb.led || {}).length);
  return <section className="dash-card" data-up-card="" style={{ marginBottom: 12 }}><h3>Bring in from Tally</h3>
    {opening && <p className="bk-alert" data-up-opening="" style={{ margin: "0 0 10px" }}><b>Opening balances:</b> in Tally, open <b>Trial Balance</b> as on the day before the books here start, press <b>Ctrl+E</b>, choose <b>XML</b>, and drop the file below; FinCom asks whether to use it as the opening balances. With FinCom Bridge linked, Update now reads them by itself.</p>}
    {/* 26-Oct-2026: the Day Book upload, said in one line. 30-Oct-2026 (the owner): books also come from Tally by
        themselves (Bring books from Tally, above), and an upload is checked against Tally (Upload checked against Tally) */}
    <p className="note" data-up-older="" style={{ margin: "0 0 8px" }}>Older entries: in Tally open Day Book, choose the period (Alt+F2), E: Export → File Format (F8): XML or JSON, then drop the file here.</p>
    <Drop />
    {lim && <p className="note" data-up-limit="" style={{ margin: "8px 0 0" }}>{"Only " + fmtDate(lim[0]) + (lim[1] !== lim[0] ? " to " + fmtDate(lim[1]) : "") + " is taken from the next Day Book. "}
      <button className="linkbtn" onClick={() => { S.dbFrom = ""; S.dbTo = ""; render(); }}>Take the file’s own dates</button></p>}
    <TbAsk />
    <div data-up-progress="" style={{ marginTop: 8 }}>
      {b.busy && <p className="note" style={{ margin: "4px 0" }}>{b.busy}</p>}
      <JobsNote cid={S.coId} compact />
      {waiting.length > 0 && <p className="note" style={{ margin: "4px 0" }}>{plural(waiting.length, "Day Book is", "Day Books are") + " still to go to FinCom’s cloud; " + (waiting.length === 1 ? "it goes" : "they go") + " on their own when this client is opened while signed in."}</p>}
      {notSent.map(({ p, i }) => <p key={"ns" + i} className="bad" data-cloud-notsent={p.file || ""} role="alert" style={{ margin: "4px 0" }}>
        {(p.file ? p.file + ": " : "") + "Saved on this computer, but not sent to FinCom’s cloud: " + String(p.cloud).replace(/^not sent:\s*/, "") + ". Other logins will not see it until it is sent."}
        {p.again !== false && <>{" "}<button className="linkbtn" data-send-again="" onClick={() => tallySendAgain(i)}>Send again</button></>}</p>)}
    </div>
    {u && <div data-up-result="" role="status" style={{ marginTop: 6 }}>
      {u.busy && !u.lines.length && <p className="note" style={{ margin: "4px 0" }}>Reading the file…</p>}
      {u.lines.map((l, i) => <p key={i} className={l.ok ? "" : "bad"} data-up-line={l.kind || "none"} style={{ margin: "4px 0" }}>{l.text}</p>)}
    </div>}
  </section>;
}

// 3. the days that need a Day Book, each with its Upload
// round 66 (the owner: 29 lines one under another): more than 3 rows say it in ONE line with ONE Upload for the whole span
// (the period guard takes only those dates from the file); "Show days" opens the list
const DAYS_FOLD = 3;
function Days({ days }) {
  const [open, setOpen] = useState(false);
  if (!days.length) return null;
  const from = days.reduce((a, x) => (!a || x.from < a ? x.from : a), ""), to = days.reduce((a, x) => (x.to > a ? x.to : a), "");
  const k = days.reduce((a, x) => a + x.days, 0), fold = days.length > DAYS_FOLD;
  return <section className="dash-card" data-need-days="" data-folded={fold && !open ? "" : undefined} style={{ marginBottom: 12 }}><h3>Days that need a Day Book</h3>
    {fold && <p className="row" data-need-days-one="" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "0 0 6px" }}>
      <span style={{ minWidth: 0, flex: "1 1 220px" }}>{plural(k, "day", "days") + " between " + d(from) + " and " + d(to) + " need that day’s Day Book. Upload one Day Book for " + d(from) + " to " + d(to) + "; FinCom takes only those days from it."}</span>
      <span className="row" style={{ gap: 8 }}><button className="btn small primary" data-need-days-upload="" onClick={() => tallyPickFor(tallyDate(from), tallyDate(to))}>Upload</button>
        <button className="linkbtn" data-need-days-show="" aria-expanded={open ? "true" : "false"} onClick={() => setOpen(!open)}>{open ? "Hide days" : "Show days"}</button></span></p>}
    {(!fold || open) && <ul className="up-days" style={{ listStyle: "none", margin: 0, padding: 0 }}>{days.map((x) =>
      <li key={x.from + x.to} data-need-day={tallyDate(x.from)} className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid var(--rule)" }}>
        <span style={{ minWidth: 0, flex: "1 1 220px" }}><b>{d(x.from) + (x.to !== x.from ? " to " + d(x.to) : "")}</b>{" · " + x.say}</span>
        <button className="btn small" onClick={() => tallyPickFor(tallyDate(x.from), tallyDate(x.to))}>Upload</button></li>)}</ul>}
  </section>;
}

// 4. how to export, folded
function HowTo() {
  return <details className="up-howto" data-howto="" style={{ margin: "0 0 12px" }}><summary>How to export from Tally</summary>
    <ol className="note" style={{ margin: "6px 0 0 18px", padding: 0 }}>
      <li>In Tally, open <b>Display More Reports → Day Book</b> and press <b>Alt+F2</b> for the period; for the ledger masters, <b>Display More Reports → List of Accounts</b>.</li>
      <li>Press <b>Alt+E</b> (Export) → <b>Current</b>, then <b>F8</b> (File Format) for <b>XML</b> or <b>JSON</b>, and <b>E</b> to export. Several months, or a zip of them, can be dropped at once.</li>
      <li>Drop the file above. Uploading the same dates again replaces them; nothing is counted twice.</li>
    </ol></details>;
}

// the check against Tally's own trial balance (TBCheck, src/js/24), one line
function Tieout({ b }) {
  const ck = b.tbCheck;
  if (!ck) return null;
  if (ck.ok) return <p className="note" data-tieout="" style={{ margin: "0 0 12px" }}>{"Tie-out: every ledger (" + (ck.ledgers || 0) + ") agrees with Tally’s trial balance as on " + d(ck.on) + "."}</p>;
  if (ck.why) return <p className="note bad" data-tieout="" style={{ margin: "0 0 12px" }}>{"Tie-out: " + ck.why}</p>;
  return <details data-tieout="" style={{ margin: "0 0 12px" }}><summary className="bad">{"Tie-out: " + ck.n + " ledger" + (ck.n === 1 ? " differs" : "s differ") + " from Tally’s trial balance as on " + d(ck.on)}</summary>
    <ul className="note" style={{ margin: "4px 0 0 18px", padding: 0 }}>{ck.list.slice(0, 10).map((x, i) => <li key={x[0] + ":" + i}>{x[0] + ": Tally " + INR.format(-x[1]) + ", books " + INR.format(-x[2])}</li>)}
      {ck.n > 10 && <li>{"and " + (ck.n - 10) + " more"}</li>}</ul></details>;
}

// the bridge on this computer: its own update settings (only where this computer has one). Asks the bridge, never Tally
function BridgeKeep() {
  if (!(typeof Bridge === "object" && Bridge.on())) return null;
  const ks = setupKeepFor(CO()), k = ks && ks.st;
  let body;
  if (ks && ks.error) body = "The bridge did not answer: " + ks.error;
  else if (!k) body = "Asking the bridge…";
  else if (!k.on) body = <>Updates from Tally are off. <button className="btn small primary" onClick={() => doAct("setupKeepOn")}>Switch them on</button></>;
  else if (!k.phase && k.mode !== "bridge") body = <>The bridge waits for the Day Book files. <button className="linkbtn" onClick={() => doAct("setupModeBridge")}>Let it copy the year from Tally at the daily update</button></>;
  else {
    const at = k.dailyAt || (k.events ? "02:00" : "20:00"), last = k.lastRun ? d(k.lastRun) : "not yet", busy = k.running || k.now;
    body = <>{busy && <><b>Updating from Tally now…</b>{" "}</>}{k.events
      ? <>Catches up each night at <input type="time" aria-label="Nightly catch-up at" defaultValue={at} key={at} style={{ width: 104 }} onChange={(ev) => keepAtSet(ev.target.value)} /> (last: {last}).</>
      : k.schedule === "continuous" ? "Reads Tally’s changes every minute."
      : <>Updates from Tally once a day at <input type="time" aria-label="Daily update at" defaultValue={at} key={at} style={{ width: 104 }} onChange={(ev) => keepAtSet(ev.target.value)} /> (last: {last}). Nothing is asked of Tally during the day.</>}
      {!busy && <>{" "}<button className="btn small" onClick={() => doAct("keepNow")}>Update now</button></>}</>;
  }
  return <div className="bk-menu-sub note" data-bridge-keep="" style={{ padding: "8px 10px", whiteSpace: "normal" }}><b>FinCom Bridge on this computer</b><br />{body}</div>;
}

// More: Restore, the removals (each asks for the client's name and keeps a copy Restore puts back), the bridge's settings
function MoreMenu({ b, n }) {
  const [trash, setTrash] = useState(null);
  useEffect(() => { let on = true; Trash.list(S.coId).then((l) => { if (on) setTrash(l.filter((x) => x.kind === "books" || x.kind === "wipe")); }, () => {}); return () => { on = false; }; }, [S.coId, (b.trashLog || []).length]);
  const bridge = typeof Bridge === "object" && Bridge.on();
  if (!n && !booksHasAny(b) && !(trash && trash.length) && !bridge) return null;
  return <details className="bk-menu" data-more="books"><summary className="btn small">More</summary><div className="bk-menu-list">
    {trash && trash.slice(0, 5).map((x, i) => <button key={x.id} data-i={i} data-restore="" onClick={(ev) => doAct("trashRestore", ev.currentTarget)}>Restore<small>{Trash.say(x)}</small></button>)}
    {n > 0 && <button className="danger" onClick={() => doAct("booksClear")}>Remove what is here<small>The day book read from Tally, on this page only</small></button>}
    {booksHasAny(b) && <button className="danger" onClick={() => doAct("booksWipe")}>Remove Tally data and all GST work<small>The day book, masters, balances and every piece of GST work here</small></button>}
    <BridgeKeep />
  </div></details>;
}

export default function FromTally({ b }) {
  const n = (b.vouchers || []).length, m = b.meta || {}, other = m.gstins ? notThisClient(m.gstins) : [];
  const days = needDays(b, S.coId);
  return <div className="up-page" data-upload-page="">
    {/* 24-Oct-2026 (next-tally-one-page): only the upload of Tally's files here; the link and its status are the Tally
        page's (the client's title chip opens its row) */}
    <Status b={b} days={days} />
    {typeof TCloud === "object" && TCloud.on() && (hasLedBook(S.coId) || (S.tcoSync || {})[S.coId]) && <div data-up-ledgers="" style={{ margin: "-4px 0 12px" }}><Suspense fallback={null}><LedgerBar cid={S.coId} where="books" /></Suspense></div>}
    {other.length > 0 && <p className="bk-warn">The books here are for {other.join(", ")}, not this client’s PAN ({clientPan()}). Remove them with More → “Remove Tally data and all GST work”.</p>}
    {typeof TCloud === "object" && TCloud.on() && hasLedBook(S.coId) && <Suspense fallback={null}><OlderEntries cid={S.coId} /></Suspense>}
    <Upload b={b} />
    {typeof TCloud === "object" && TCloud.on() && hasLedBook(S.coId) && <Suspense fallback={null}><UploadCheck cid={S.coId} /></Suspense>}
    <Days days={days} />
    <HowTo />
    <Tieout b={b} />
    <MoreMenu b={b} n={n} />
  </div>;
}
