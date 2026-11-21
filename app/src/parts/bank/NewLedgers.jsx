// next-bank-newled (20-Nov-2026, the owner: "system should suggest the ledger name to be created in tally.. we can create
// it single and multi select the rows"): a line with no ledger matched shows the NEW ledger it could have ("New ledger:
// Ramesh Kumar · Sundry Creditors", Create), or "Similar: <ledger>" when Tally has one close to it; ticked lines give
// "Create ledgers for N rows" in the bar. Both open the review: one line per party (the ticked lines of one party
// merged), name and group editable, each with its own tick; one Create makes them all in Tally (one posting of
// masters, the client's linked company) and the lines then use them. The rules and the posting are NewLed (src/js/96).
import { useRef, useState } from "react";
import { useDismiss } from "../dismiss.js";
import "../../../../src/js/96-bank-newled.js";
import "./newled.css";

const rowsN = (n) => (n === 1 ? "1 row" : n + " rows"), uses = (n) => rowsN(n) + (n === 1 ? " uses it" : " use it");

export function newLedOpen(ids) { const b = B(); b.nlOpen = { ids, seq: ((b.nlOpen && b.nlOpen.seq) || 0) + 1, res: null, busy: false }; render(); }
const close = () => { const b = B(); if (b.nlOpen && b.nlOpen.busy) return; b.nlOpen = null; render(); };

// under a line's ledger box (To do: no ledger)
export function NewLedHint({ r }) {
  const g = NewLed.guess(r);
  if (!g) return null;
  if (g.similar) return <span className="nl-hint" data-nl-similar={r.id} title={"Tally has a ledger close to “" + g.name + "”: use it, or create a new one from the review (tick the line)"}>
    Similar: <b>{g.similar}</b> <button type="button" className="linkbtn" data-nl-use={r.id} onClick={() => bankSetLedger(r.id, g.similar)}>Use it</button></span>;
  return <span className="nl-hint" data-nl-new={r.id} title="Suggested from the narration; you check the name and group before anything is made in Tally">
    New ledger: <b>{g.name}</b> · {g.group} <button type="button" className="linkbtn" data-nl-create={r.id} onClick={() => newLedOpen([r.id])}>Create</button></span>;
}

// in the bar, with lines ticked
export function NewLedBulk({ rows }) {
  if (!NewLed.count(rows)) return null;
  return <button className="btn" data-nl-bulk="" title="Make a new Tally ledger for each party of the ticked lines that has none" onClick={() => newLedOpen(rows.map((r) => r.id))}>Create ledgers for {rowsN(rows.length)}</button>;
}

function Results({ res }) {
  return <>
    {res.why && <div className="bk-alert nl-why" data-nl-why="">Not sent to Tally: {res.why} The ledgers wait here and go to Tally with the next posting.</div>}
    <ul className="nl-res" data-nl-results="">{res.results.map((x, i) => <li key={i} data-nl-res="" className={"nl-" + x.kind}>
      <span className={"tag " + (x.kind === "failed" ? "bad" : x.kind === "waiting" ? "warn" : "ok")}>{x.kind === "created" ? "Created" : x.kind === "already" ? "Already in Tally" : x.kind === "waiting" ? "Waiting" : "Failed"}</span>{" "}
      <b>{x.name}</b> · {x.group} — {x.kind === "failed" ? x.word : x.kind === "waiting" ? x.word + "; " + uses(x.n) : x.kind === "already" ? "Already in Tally; " + uses(x.n) : "Created; " + uses(x.n)}</li>)}</ul>
  </>;
}

export function NewLedReview() {
  const b = B(), o = b.nlOpen, co = CO(b.cid), ref = useRef(null);
  const [plan] = useState(() => NewLed.plan(o.ids.map((id) => bankRow(id)).filter(Boolean)));
  const [lines, setLines] = useState(() => plan.lines.map((l) => ({ ...l })));
  useDismiss(true, ref, close, { back: "always", confirm: !!o.busy });
  const groups = NewLed.groups();
  const set = (l, k, v) => setLines(lines.map((x) => (x === l ? { ...x, [k]: v } : x)));
  const on = lines.filter((l) => l.on && String(l.name).trim());
  const dupes = new Set(), seen = new Set();
  on.forEach((l) => { const k = String(l.name).trim().toLowerCase(); if (seen.has(k)) dupes.add(k); seen.add(k); });
  const pickSim = (l) => { const rows = l.rows.map((id) => bankRow(id)).filter(Boolean); if (rows.length) setLedgerFor(rows, exactLedger(l.similar) || l.similar, "set"); saveBank({ rows: true }); setLines(lines.filter((x) => x !== l)); render(); };
  const go = async () => {
    if (o.busy || !on.length) return;
    o.busy = true; render();
    let res = null;
    try { res = await NewLed.create(on.map((l) => ({ name: l.name, group: l.group, rows: l.rows, bank: l.bank }))); }
    finally { o.busy = false; }
    if (res) o.res = res;
    render();
  };
  const skip = [plan.had ? rowsN(plan.had) + (plan.had === 1 ? " already has a ledger" : " already have a ledger") : "", plan.none ? rowsN(plan.none) + (plan.none === 1 ? " has no name to use" : " have no name to use") : ""].filter(Boolean);
  return <div className="bk-overlay"><div ref={ref} style={{ display: "contents" }}>
    <div className="bk-panel nl-panel" role="dialog" aria-modal="true" aria-labelledby="nlT" data-nl-review="">
      <div className="bk-panel-head"><h2 id="nlT">{o.res ? "New ledgers in Tally" : "Create ledgers in Tally"}</h2><button className="icon" aria-label="Close" disabled={o.busy} onClick={close}>✕</button></div>
      <p className="note nl-sub">{co.name}{tallyCoName(co) && tallyCoName(co) !== co.name ? " · Tally company " + tallyCoName(co) : ""}</p>
      {o.res ? <><Results res={o.res} /><div className="nl-foot"><button className="btn primary" data-nl-close="" onClick={close}>Done</button></div></> : <>
        <p className="note">Check each name and its group. Only the name and the group are made in Tally; nothing is sent until you press Create.</p>
        {skip.length > 0 && <p className="note" data-nl-skip="">{skip.join(" · ")}: skipped.</p>}
        {!lines.length && <p className="note" data-nl-none="">No new ledger to make for these rows.</p>}
        <ul className="nl-lines">{lines.map((l) => {
          const k = String(l.name).trim().toLowerCase(), has = k && exactLedger(l.name), pend = has && (ledgerInfo(has) || {}).pending;
          const gs = groups.some((g) => g === l.group) ? groups : [l.group].concat(groups);
          return <li key={l.key} className={"nl-line" + (l.on ? "" : " off")} data-nl-line="">
            <label className="nl-onwrap"><input type="checkbox" className="nl-on" data-nl-on="" checked={l.on} aria-label={"Create " + l.name} onChange={(ev) => set(l, "on", ev.target.checked)} /></label>
            <div className="nl-body">
              <div className="nl-fields">
                <label><span>Ledger name</span><input type="text" data-nl-name="" value={l.name} disabled={!l.on} onChange={(ev) => set(l, "name", ev.target.value)} /></label>
                <label><span>Under (group)</span><select data-nl-group="" value={l.group} disabled={!l.on} onChange={(ev) => set(l, "group", ev.target.value)}>{gs.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
              </div>
              <div className="nl-meta muted"><span data-nl-n="">{rowsN(l.rows.length)}</span> · {money(l.amt)} {l.in && l.out ? "in and out" : l.in ? "received" : "paid"}
                {l.bank && l.bank.acNo ? " · A/c " + l.bank.acNo + " · IFSC " + l.bank.ifsc : ""}</div>
              {l.similar && <div className="nl-sim" data-nl-line-similar=""><span className="tag warn">Similar: {l.similar}</span> Tally has a ledger close to this name; make sure it is a different party. <button type="button" className="linkbtn" onClick={() => pickSim(l)}>Use {l.similar}</button></div>}
              {has && !pend && <div className="nl-sim"><span className="tag ok">In Tally</span> Tally has “{has}”: it is used, nothing new is made.</div>}
              {l.on && dupes.has(k) && <div className="nl-sim bad">The same name is on another line: one ledger is made for both.</div>}
            </div>
          </li>; })}</ul>
        <div className="nl-foot">
          <button className="btn primary" data-nl-go="" disabled={!on.length || o.busy} onClick={go}>{o.busy ? "Creating…" : "Create " + (on.length === 1 ? "1 ledger" : on.length + " ledgers") + " in Tally"}</button>
          <button className="btn" disabled={o.busy} onClick={close}>Cancel</button>
        </div></>}
    </div></div></div>;
}
