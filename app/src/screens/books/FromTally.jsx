// The "From Tally" tab of a client's books: setting the client up (day book, opening balances, ledger masters, the
// bridge and its daily update) and the files exported from Tally. Was viewBooksImport, viewSetupList and viewBookParts
// (src/js/18). Tally is not read from the browser (build 188): the bridge updates the books once a day, or on Update
// now. The files are read by booksChange (src/js/23); the buttons are doAct cases (booksPick, tbPick, mastersPick,
// keepNow, setup…); the daily time goes through keepAtSet.
//
// State: S.dbFrom / S.dbTo (a part's dates), S.tbOn (the trial balance date).
import { useEffect, useState } from "react";
import TallyPill from "../../parts/TallyPill.jsx";
const d = (x) => fmtDate(tallyDate(x));
const Act = ({ act, className = "btn small", children }) => <button className={className} onClick={() => doAct(act)}>{children}</button>;

// one step of setting up: done ✔, under way ⏳ or not yet ✖
function Step({ ok, title, children }) {
  return <div className="dash-row" style={{ alignItems: "flex-start" }}><span>{ok === true ? "✔" : ok === "wait" ? "⏳" : "✖"} <b>{title}</b></span><span style={{ textAlign: "right", maxWidth: "70%" }}>{children}</span></div>;
}

function Setup({ b }) {
  const co = CO(), m = b.meta || {}, parts = (m.parts || []).slice().sort((x, y) => String(x.from).localeCompare(String(y.from)));
  const ks = setupKeepFor(co), k = ks && ks.st;
  // 1. the day book: which dates, and any gap between the parts
  const gaps = []; let cov = "";
  if (parts.length) {
    let end = parts[0].to;
    parts.slice(1).forEach((p) => { if (p.from > BridgeSeed.add(end, 1)) gaps.push(d(BridgeSeed.add(end, 1)) + " to " + d(BridgeSeed.add(p.from, -1))); if (p.to > end) end = p.to; });
    cov = d(parts[0].from) + " to " + d(end);
  }
  const tbOk = b.tb && b.tb.source, firstFrom = parts.length ? parts[0].from : m.from;
  // 4. the bridge
  let bs, bok = false, bact = null;
  // the one Tally status (review item 5): the firm's Tally computer may be connected through the cloud even when this
  // computer has no bridge of its own
  const ts = tallyStatus(CO());
  if (!Bridge.on()) {
    const cloud = !["none", "offline"].includes(ts.state);
    bok = ts.state === "ok";
    bs = <><TallyPill co={CO()} />{" "}{cloud
      ? "Through the firm’s Tally computer (FinCom’s cloud). There is no bridge on this computer; it is needed only on the computer with Tally, to post entries and bring in each day’s changes."
      : "Needed only on the computer with Tally: it posts entries and brings in each day’s changes."}</>;
  }
  else if (ks && ks.error) bs = "Did not answer: " + ks.error;
  else if (!k) bs = "asking…";
  else if (!k.on) { bs = "Updates from Tally are off."; bact = <Act act="setupKeepOn" className="btn small primary">Switch them on</Act>; }
  else if (!k.phase && k.mode !== "bridge") { bs = "Waiting for the day book files (step 1). Tally is not read for the year."; bact = <Act act="setupModeBridge" className="linkbtn">or let the bridge copy the year from Tally, at the daily update</Act>; }
  else {
    // FinCom Bridge 2.1.3: only after an event (a client opened here, Update now, a posting) and the nightly catch-up at
    // the hour set (02:00), when Tally is open and nobody has used FinCom for 15 minutes; an older bridge: once a day
    bok = k.phase === "live";
    const at = k.dailyAt || (k.events ? "02:00" : "20:00"), last = k.lastRun ? d(k.lastRun) : "not yet", busy = k.running || k.now;
    bs = <>{busy && <><b>Updating from Tally now…</b>{" "}</>}{k.events
      ? <>Reads Tally when this client is opened, on Update now and after a posting, and catches up each night at <input type="time" aria-label="Nightly catch-up at" defaultValue={at} key={at} style={{ width: 104 }} onChange={(ev) => keepAtSet(ev.target.value)} /> when nobody is using FinCom (last: {last}){k.paused ? "; background reading is paused in the bridge’s tray icon" : ""}. Otherwise Tally is not asked anything. </>
      : k.schedule === "continuous" ? "Reads Tally’s changes every minute. "
      : <>Updates from Tally once a day at <input type="time" aria-label="Daily update at" defaultValue={at} key={at} style={{ width: 104 }} onChange={(ev) => keepAtSet(ev.target.value)} /> (last: {last}). Nothing is asked of Tally during the day. </>}
      {!k.phase ? "The year is copied from Tally at the update." : k.phase === "live" ? "" : "It checks the files against Tally at the update" + (k.openPending ? ", with the opening balances" : "") + "."}</>;
    bact = busy ? null : <Act act="keepNow">Update now</Act>;
  }
  return (
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>Setting up {co.name}</h3>
      <Step ok={parts.length ? (gaps.length ? "wait" : true) : false} title="1. Day book">
        {parts.length ? <>{"from files, " + cov}{gaps.length > 0 && <>; <span className="bad">missing {gaps.join(", ")}</span></>}. The days after it come in with the update from Tally.</>
          : m.from ? "read from Tally (" + d(m.from) + " to " + d(m.to) + ")" : "Choose the dates and the day book XML below, part by part."}</Step>
      <Step ok={tbOk ? true : b.tb ? "wait" : false} title="2. Opening balances">
        {tbOk ? Object.keys(b.tb.led || {}).length + " ledgers, as on " + d(b.tb.openAsOn) : b.tb ? "read from Tally" : "Choose the trial balance XML as on " + (firstFrom ? d(BridgeSeed.add(firstFrom, -1)) : "the day before the first date") + " below."}</Step>
      <Step ok={!!b.ledInfoAt} title="3. Ledger masters">
        {b.ledInfoAt ? Object.keys(b.ledInfo || {}).length + " ledgers (groups, PAN, GSTIN), " + d(String(b.ledInfoAt).slice(0, 10).replace(/-/g, "")) : "Choose the ledger masters XML below (List of Accounts)."}</Step>
      <Step ok={bok ? true : Bridge.on() && k && k.on ? "wait" : false} title="4. FinCom Bridge">{bs}{bact && <> {bact}</>}</Step>
      <Check b={b} />
    </section>
  );
}

// 5. the check against Tally's own trial balance (build 195): Ready, or the ledgers that differ. The file goes through
// booksChange (tbCheckIn), TBCheck.run (24)
function Check({ b }) {
  const ck = b.tbCheck, endOn = tallyDate((b.meta || {}).to || "");
  const pick = <><label className="note">as on <input type="date" aria-label="Trial balance to check as on" value={S.tbCheckOn || endOn} onChange={(ev) => setAndShow("tbCheckOn", ev.target.value)} /></label> <Act act="tbCheckPick">Choose Tally’s trial balance XML</Act></>;
  if (!(b.vouchers || []).length) return <Step ok={false} title="5. Check">After the day book and opening balances: Tally’s trial balance on the last date, to check every ledger.</Step>;
  if (!ck) return <Step ok={false} title="5. Check">Export Tally’s trial balance (Alt+F5, detailed) as on the last date of the books and choose it: every ledger is checked. {pick}</Step>;
  if (ck.ok) return <Step ok title="5. Ready">{"Every ledger (" + (ck.ledgers || 0) + ") agrees with Tally’s trial balance as on " + d(ck.on) + "."} <Act act="tbCheckPick" className="linkbtn">check again</Act></Step>;
  return <Step ok={false} title="5. Mismatch">{ck.why ? ck.why : <>{ck.n + " ledger" + (ck.n === 1 ? " differs" : "s differ") + " from Tally’s trial balance as on " + d(ck.on) + ":"}
    <span style={{ display: "block", textAlign: "left", marginTop: 4 }}>{ck.list.slice(0, 10).map((x, i) => <span key={x[0] + ":" + i}>{i > 0 && <br />}{x[0] + ": Tally " + INR.format(-x[1]) + ", books " + INR.format(-x[2])}</span>)}{ck.n > 10 && <><br />{"and " + (ck.n - 10) + " more"}</>}</span></>} {pick}</Step>;
}

function Parts({ b }) {
  const parts = ((b.meta || {}).parts || []).slice().sort((x, y) => String(x.from).localeCompare(String(y.from)));
  if (!parts.length) return null;
  return <div className="bk-tablewrap"><table className="bk-table compact">
    <thead><tr><th>Part brought in</th><th className="n">Entries</th><th>File</th><th className="dt">On</th><th>Bridge’s copy</th></tr></thead>
    <tbody>{parts.map((p, i) => <tr key={p.from + ":" + i}><td>{d(p.from) + " to " + d(p.to)}</td><td className="n">{p.n}</td><td>{p.file || ""}</td><td className="dt">{fmtDate(String(p.at || "").slice(0, 10))}</td><td>{p.bridge || "—"}</td></tr>)}</tbody>
  </table></div>;
}

function Files({ b }) {
  const m = b.meta || {}, n = (b.vouchers || []).length, other = m.gstins ? notThisClient(m.gstins) : [];
  return (
    <section className="dash-card" style={{ maxWidth: 760 }}><h3>Or bring in files exported from Tally</h3>
      <p className="note">In Tally: <b>Display More Reports → Day Book</b>, <b>F2</b> for the period, then <b>Ctrl+E</b> (Export) as XML. A big company can be brought in <b>part by part</b>: choose the dates, then that part’s file, as many times as needed; each part fills only its dates. The bridge’s copy is filled from the same files, so Tally is not read for them.</p>
      <div className="row" style={{ gap: 8, margin: "10px 0", flexWrap: "wrap", alignItems: "center" }}>
        <label className="note">From <input type="date" aria-label="Day book from" value={S.dbFrom || ""} onChange={(ev) => setAndShow("dbFrom", ev.target.value)} /></label>
        <label className="note">to <input type="date" aria-label="Day book to" value={S.dbTo || ""} onChange={(ev) => setAndShow("dbTo", ev.target.value)} /></label>
        <Act act="booksPick" className="btn primary">Choose the day book XML{S.dbFrom || S.dbTo ? " for these dates" : ""}</Act><span className="note">(no dates: the whole file)</span>
      </div>
      <Parts b={b} />
      <p className="note" style={{ marginTop: 10 }}><b>Opening balances:</b> in Tally, <b>Display More Reports → Trial Balance</b>, show the ledgers (<b>Alt+F5</b>, detailed), set the date to the day <b>before</b> the first date above, then <b>Ctrl+E</b> as XML. The closing balances there are the opening balances here, so Tally is not asked for them.</p>
      <div className="row" style={{ gap: 8, margin: "6px 0", flexWrap: "wrap", alignItems: "center" }}>
        <label className="note">Balances as on <input type="date" aria-label="Balances as on" value={S.tbOn || tbDefaultOn(b)} onChange={(ev) => setAndShow("tbOn", ev.target.value)} /></label>
        <Act act="tbPick" className="btn">Choose the trial balance XML</Act>
        {b.tb && b.tb.source && <span className="note">{Object.keys(b.tb.led || {}).length + " opening balances from " + b.tb.source + " (as on " + d(b.tb.openAsOn || "") + ")"}</span>}
      </div>
      <p className="note" style={{ marginTop: 10 }}>For the deductees’ PAN and the ledger groups, also export <b>Display → List of Accounts</b> as XML.</p>
      <div className="row" style={{ gap: 8, margin: "10px 0" }}>
        <Act act="mastersPick" className="btn">Choose the ledger masters XML</Act>
        <MoreMenu b={b} n={n} />
      </div>
      {other.length > 0 && <p className="bk-warn">The books here are for {other.join(", ")}, not this client’s PAN ({clientPan()}). Remove them with More → “Remove Tally data and all GST work”.</p>}
      {n ? <>
        <div className="dash-row"><span>Entries</span><b title={entryCount(m.from, m.to).text}>{entryCount(m.from, m.to).n.toLocaleString("en-IN")}</b></div>
        {(entryCount(m.from, m.to).opt + entryCount(m.from, m.to).cancel) > 0 && <div className="note">{entryCount(m.from, m.to).text}</div>}
        <div className="dash-row"><span>Period</span><b>{d(m.from) + " to " + d(m.to)}</b></div>
        <div className="dash-row"><span>Registrations in the file</span><b>{(m.gstins || []).join(", ") || "—"}</b></div>
        <div className="dash-row"><span>Read on</span><b>{m.at ? fmtDate(String(m.at).slice(0, 10)) : "—"}</b></div>
        <div className="dash-row"><span>Ledger masters</span><b>{Object.keys(b.pans || {}).length ? Object.keys(b.pans).length + " with PAN, " + Object.keys(b.gstins || {}).length + " with GSTIN" : "not brought in yet"}</b></div>
      </> : <p className="note">Nothing here yet.</p>}
    </section>
  );
}

// the removals, out of the way in a More menu (review of 01-Oct-2026); each asks for the client's name and keeps a copy
// that Restore puts back
function MoreMenu({ b, n }) {
  const [trash, setTrash] = useState(null);
  useEffect(() => { let on = true; Trash.list(S.coId).then((l) => { if (on) setTrash(l.filter((x) => x.kind === "books" || x.kind === "wipe")); }, () => {}); return () => { on = false; }; }, [S.coId, (b.trashLog || []).length]);
  if (!n && !booksHasAny(b) && !(trash && trash.length)) return null;
  return <details className="bk-menu" data-more="books"><summary className="btn small">More</summary><div className="bk-menu-list">
    {trash && trash.slice(0, 5).map((x, i) => <button key={x.id} data-i={i} data-restore="" onClick={(ev) => doAct("trashRestore", ev.currentTarget)}>Restore<small>{Trash.say(x)}</small></button>)}
    {n > 0 && <button className="danger" onClick={() => doAct("booksClear")}>Remove what is here<small>The day book read from Tally, on this page only</small></button>}
    {booksHasAny(b) && <button className="danger" onClick={() => doAct("booksWipe")}>Remove Tally data and all GST work<small>The day book, masters, balances and every piece of GST work here</small></button>}
  </div></details>;
}

export default function FromTally({ b }) {
  return <><Setup b={b} /><Files b={b} /></>;
}
