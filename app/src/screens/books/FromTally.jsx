// The "From Tally" tab of a client's books: uploading the Tally data. FinCom 2.4.0 (the owner, 08-Oct-2026: "change the
// data xml upload page.. it is too much crowded.. simplify it.. whatever is necessary should remain.. extra fields should
// be removed"): one short flow, docs/ui-pass/uploadpage/README.md says what went and why.
//   1. one status line: "Books from Tally: FY 2026-27 · entries up to 07-Oct-2026 · 2 days need a Day Book";
//   2. Upload Tally data: one drop area (the same file box, #tallyIn, as the top bar's Upload Tally data) for a Day Book,
//      the ledger masters or a trial balance XML. Which file it is, and its dates, come from the file (tallyFiles,
//      src/js/23); only a trial balance's date is asked, as Tally does not write it in the file. The progress line (the
//      file on its way to FinCom's cloud, the server's job) and the result in plain words;
//   3. Days that need a Day Book: the days the shared classifier says only that day's Day Book settles (Rec.needKind,
//      src/js/61: daybook, dupid), the cloud's gap (Rec.gapFor), the dates between the files brought in. Each Upload takes
//      only those dates from the file (tallyPickFor; the period guard in bringDayBookFile);
//   4. How to export from Tally, folded, three steps.
// Kept, minimally: the tie-out result (one line), the warning when the books are another PAN's, and More (Restore, the
// removals, and the bridge's own update settings when this computer has one).
import { useEffect, useState } from "react";
import { JobsNote } from "../../parts/Notes.jsx";
const d = (x) => fmtDate(tallyDate(x));
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

// the books' last entry (yyyymmdd)
function lastEntry(b) { let l = ""; (b.vouchers || []).forEach((v) => { if (v && !v.cancel && String(v.date) > l) l = String(v.date); }); return l; }
function fyOf(d8) { const y = +String(d8).slice(0, 4), m = +String(d8).slice(4, 6), s = m < 4 ? y - 1 : y; return s + "-" + String(s + 1).slice(2); }

// the days that need a Day Book: [{from, to (yyyymmdd), days, say}], newest first
export function needDays(b, cid) {
  const out = [];
  if (!b) return out;
  // lines Tally sent that only that day's Day Book settles (the one classifier the bell and Sync activity use)
  if (typeof AlertHub === "object" && typeof Rec === "object" && Rec.needKind) {
    const by = new Map();
    AlertHub.heldFor([cid]).forEach((l) => {
      const k = Rec.needKind(l); if (k !== "daybook" && k !== "dupid") return;
      const day = AlertHub.heldDay(l); if (!day) return;
      const x = by.get(day) || { n: 0, dup: 0 }; x.n++; if (k === "dupid") x.dup++; by.set(day, x);
    });
    by.forEach((x, day) => out.push({ from: day, to: day, days: 1, say: plural(x.n, "entry", "entries") + " Tally sent could not be read" + (x.dup ? "; check Tally for a double posting first" : "") }));
  }
  // the cloud's gap: entries made in Tally that never reached FinCom, from that day to today
  if (typeof Rec === "object" && Rec.gapFor && typeof TCloud === "object" && TCloud.on()) {
    Rec.gapFor(cid).forEach((g) => {
      const since = String(Rec.ymdLocal((g.gap && (g.gap.since || g.gap.last_match_at)) || g.gapAt || Date.now()) || "").replace(/-/g, ""), today = String(Rec.ymdLocal(Date.now())).replace(/-/g, "");
      if (!since) return;
      let n = 0; for (let x = since; x <= today; x = BridgeSeed.add(x, 1)) n++;
      const k = Number((g.gap && (g.gap.missingMax || g.gap.missing)) || 0);
      out.push({ from: since, to: today, days: n, say: (k ? plural(k, "entry", "entries") : "Entries") + " made in Tally since then " + (k === 1 ? "is" : "are") + " not in FinCom" });
    });
  }
  // the dates between the files brought in
  const parts = ((b.meta || {}).parts || []).slice().sort((x, y) => String(x.from).localeCompare(String(y.from)));
  if (parts.length) {
    let end = parts[0].to;
    parts.slice(1).forEach((p) => {
      if (p.from > BridgeSeed.add(end, 1)) {
        const f = BridgeSeed.add(end, 1), t = BridgeSeed.add(p.from, -1);
        let n = 0; for (let x = f; x <= t; x = BridgeSeed.add(x, 1)) n++;
        out.push({ from: f, to: t, days: n, say: "no Day Book uploaded for these dates" });
      }
      if (p.to > end) end = p.to;
    });
  }
  return out.sort((x, y) => String(y.from).localeCompare(String(x.from)));
}

// 1. the one status line
function Status({ b, days }) {
  const n = (b.vouchers || []).length, last = lastEntry(b), m = b.meta || {};
  const bits = ["Books from Tally: " + (n && last ? "FY " + fyOf(last) : "nothing yet")];
  if (n && last) bits.push("entries up to " + d(last));
  else bits.push("upload the Day Book XML exported from Tally");
  if (n && !b.ledInfoAt && !Object.keys(b.pans || {}).length) bits.push("ledger masters not uploaded");
  if (n && (m.parts || []).length && !(b.tb && Object.keys(b.tb.led || {}).length)) bits.push("opening balances not uploaded");
  const k = days.reduce((a, x) => a + x.days, 0);
  if (k) bits.push(k + (k === 1 ? " day needs" : " days need") + " a Day Book");
  // Update now where it already was (the bridge here, or the firm's Tally computer through the cloud): nothing new is asked
  const can = n > 0 && ((typeof Bridge === "object" && Bridge.on() && Bridge.up()) || (typeof TCloud === "object" && S.coId && TCloud.has(S.coId)));
  return <p className="up-status" style={{ margin: "0 0 12px" }}><b data-up-status="">{bits.join(" · ")}</b>
    {can && <>{" "}<button className="linkbtn" data-update-now="" onClick={() => doAct("keepNow")}>Update now</button></>}</p>;
}

// 2. the one drop area (the same file box as the top bar's Upload Tally data)
function Drop() {
  const [over, setOver] = useState(false);
  return <div className={"drop up-drop" + (over ? " over" : "")} role="button" tabIndex={0} aria-label="Upload Tally data" data-up-drop=""
    onClick={() => doAct("tallyPick")}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); doAct("tallyPick"); } }}
    onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); tallyFiles(Array.from(e.dataTransfer.files || [])); }}>
    <strong>Drop the Day Book or ledger masters XML here</strong>
    <div className="note">or click to choose it. FinCom reads which file it is, and its dates, from the file.</div>
  </div>;
}

function TbAsk() {
  const a = S.tbAsk;
  if (!a || a.cid !== S.coId) return null;
  return <div className="up-ask" data-tb-ask="" style={{ margin: "10px 0 0" }}>
    <p className="note" style={{ margin: "0 0 6px" }}><b>{a.name}</b> is a trial balance. Tally does not write its date in the file: as on{" "}
      <input type="date" aria-label="Trial balance as on" value={a.on || ""} onChange={(ev) => { a.on = ev.target.value; render(); }} /></p>
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <button className="btn small" onClick={() => tbAskUse("open")}>Use as opening balances</button>
      <button className="btn small" onClick={() => tbAskUse("check")}>Check the books against it</button>
      <button className="linkbtn" onClick={() => { S.tbAsk = null; render(); }}>Cancel</button></div>
  </div>;
}

function Upload({ b }) {
  const lim = S.dbFrom || S.dbTo ? [S.dbFrom || S.dbTo, S.dbTo || S.dbFrom] : null;
  const u = S.tallyUp && S.tallyUp.cid === S.coId ? S.tallyUp : null;
  // a Day Book that could not go to FinCom's cloud yet goes on its own; said once, quietly
  const waiting = ((b.meta || {}).parts || []).filter((p) => /^(not sent|waiting)/.test(String(p.cloud || "")));
  return <section className="dash-card" data-up-card="" style={{ marginBottom: 12 }}><h3>Upload Tally data</h3>
    <Drop />
    {lim && <p className="note" data-up-limit="" style={{ margin: "8px 0 0" }}>{"Only " + fmtDate(lim[0]) + (lim[1] !== lim[0] ? " to " + fmtDate(lim[1]) : "") + " is taken from the next Day Book. "}
      <button className="linkbtn" onClick={() => { S.dbFrom = ""; S.dbTo = ""; render(); }}>Take the file’s own dates</button></p>}
    <TbAsk />
    <div data-up-progress="" style={{ marginTop: 8 }}>
      {b.busy && <p className="note" style={{ margin: "4px 0" }}>{b.busy}</p>}
      <JobsNote cid={S.coId} compact />
      {waiting.length > 0 && <p className="note" style={{ margin: "4px 0" }}>{plural(waiting.length, "Day Book is", "Day Books are") + " still to go to FinCom’s cloud; " + (waiting.length === 1 ? "it goes" : "they go") + " on their own when this client is opened while signed in."}</p>}
    </div>
    {u && <div data-up-result="" role="status" style={{ marginTop: 6 }}>
      {u.busy && !u.lines.length && <p className="note" style={{ margin: "4px 0" }}>Reading the file…</p>}
      {u.lines.map((l, i) => <p key={i} className={l.ok ? "" : "bad"} data-up-line={l.kind || "none"} style={{ margin: "4px 0" }}>{l.text}</p>)}
    </div>}
  </section>;
}

// 3. the days that need a Day Book, each with its Upload
function Days({ days }) {
  if (!days.length) return null;
  return <section className="dash-card" data-need-days="" style={{ marginBottom: 12 }}><h3>Days that need a Day Book</h3>
    <ul className="up-days" style={{ listStyle: "none", margin: 0, padding: 0 }}>{days.map((x) =>
      <li key={x.from + x.to} data-need-day={tallyDate(x.from)} className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid var(--rule)" }}>
        <span style={{ minWidth: 0, flex: "1 1 220px" }}><b>{d(x.from) + (x.to !== x.from ? " to " + d(x.to) : "")}</b>{" · " + x.say}</span>
        <button className="btn small" onClick={() => tallyPickFor(tallyDate(x.from), tallyDate(x.to))}>Upload</button></li>)}</ul>
  </section>;
}

// 4. how to export, folded
function HowTo() {
  return <details className="up-howto" data-howto="" style={{ margin: "0 0 12px" }}><summary>How to export from Tally</summary>
    <ol className="note" style={{ margin: "6px 0 0 18px", padding: 0 }}>
      <li>In Tally, open <b>Display More Reports → Day Book</b> and press <b>F2</b> for the dates; for the ledger masters, <b>Display More Reports → List of Accounts</b>.</li>
      <li>Press <b>Ctrl+E</b> (Export), choose <b>XML</b> as the format, and export.</li>
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
  return <div className="up-page" data-upload-page="" style={{ maxWidth: 760 }}>
    <Status b={b} days={days} />
    {other.length > 0 && <p className="bk-warn">The books here are for {other.join(", ")}, not this client’s PAN ({clientPan()}). Remove them with More → “Remove Tally data and all GST work”.</p>}
    <Upload b={b} />
    <Days days={days} />
    <HowTo />
    <Tieout b={b} />
    <MoreMenu b={b} n={n} />
  </div>;
}
