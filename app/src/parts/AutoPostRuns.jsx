// Post to Tally → Posted: a card for each automatic run (Post automatically, src/js/90-autopost.js), with Undo of one entry
// and of the whole run. What Undo does depends on where the entry is: in the hold, nothing was sent (it is taken out);
// queued for the Tally computer, the posting is cancelled (tally_post_cancel) and the rest queued again; in Tally, "Take it
// back" through the bridge on this computer (the existing /unpost, by Tally's id), the bill back to To review and the
// line back to "Waiting for me". On a computer without the bridge it says where it can be done, and marks it for there.
import { useState } from "react";
import { loadAP } from "../lib/autopostBoot.js";
import "./autopost.css";

function Row({ cid, x, ap, onMsg }) {
  const [busy, setBusy] = useState(false);
  const a = x.auto || x.autoUndone && x.autoUndone.was || {}, bank = !!x.state, w = ap.where(x);
  const name = bank ? (a.label || (x.dec && x.dec.name) || "").toUpperCase() + " → " + (x.ledger || "") : (x.x.vendorName || "") + " " + (x.x.invoiceNo || "");
  const t = x.tally || {};
  const where = x.autoUndone ? "Undone " + fmtDateTime(x.autoUndone.at) + " by " + x.autoUndone.by
    : w === "tally" ? "In Tally" + (t.vchType ? " · " + t.vchType + " " + (x.tallyVchNo || t.number || t.masterId || "") : "") : w === "failed" ? "Not posted: " + (x.auto.failed || "") : w === "hold" ? "In the hold" : "Queued";
  const undo = () => { setBusy(true); ap.undo(cid, x).then((r) => { onMsg(r.ok ? "" : r.why); toast(r.ok ? r.words : r.why); render(); }).finally(() => setBusy(false)); };
  return <tr className={x.autoUndone ? "undone" : ""} data-ap-run-entry={x.id}>
    <td>{name}</td><td className="n">{money(a.amt || 0).replace("₹", "")}</td>
    <td>{w === "tally" && !x.autoUndone ? <span className="tag ok">{where}</span> : where}</td>
    <td>{x.autoUndone ? "Back as waiting for you" : ap.undoWords(x)}</td>
    <td>{!x.autoUndone && <button className="btn small" disabled={busy} data-ap-undo={x.id} onClick={undo}>{busy ? "Undoing…" : "Undo"}</button>}</td>
  </tr>;
}

export default function AutoRuns({ co }) {
  const [, redraw] = useState(0), [msg, setMsg] = useState("");
  const ap = window.AutoPost;
  if (!ap) { loadAP().then(() => redraw((n) => n + 1)).catch(() => {}); return null; }
  const runs = ap.runs(co.id);
  // the entries undone since, shown struck through in their run
  const b = typeof B === "function" ? B() : null;
  const undone = (b && b.cid === co.id ? b.rows : []).concat(Object.values(D(co.id).entries || {})).filter((x) => x.autoUndone && x.autoUndone.was && x.autoUndone.was.run);
  if (!runs.length && !undone.length) return null;
  const byRun = new Map(runs.map((r) => [r.run, r]));
  undone.forEach((x) => { const run = x.autoUndone.was.run; if (!byRun.has(run)) byRun.set(run, { run, at: x.autoUndone.was.at, entries: [], bank: 0, bills: 0, inTally: 0, queued: 0, failed: 0 }); byRun.get(run).entries.push(x); });
  return <div data-ap-runs="">
    {msg && <div className="ap-run"><div className="ap-msg" data-ap-msg="">{msg}</div>
      <p className="note" style={{ margin: "8px 0 0" }}>The bridge deletes an entry only when asked on its own computer (“Take it back”, /unpost). A deletion sent through FinCom’s cloud queue is the plan’s next step.</p></div>}
    {[...byRun.values()].sort((a, c) => String(c.at).localeCompare(String(a.at))).slice(0, 10).map((r) => {
      const live = r.entries.filter((x) => !x.autoUndone);
      return <section className="ap-run" key={r.run} data-ap-run={r.run}>
        <h3>Automatic run · {fmtDateTime(r.at)} · {live.length} {live.length === 1 ? "entry" : "entries"} <span className="tag stamp">Auto</span></h3>
        <p className="note" style={{ margin: "0 0 8px" }}>{[r.bank && r.bank + " bank line" + (r.bank === 1 ? "" : "s"), r.bills && r.bills + " bill" + (r.bills === 1 ? "" : "s")].filter(Boolean).join(" and ")} of {co.name}. {r.inTally} in Tally{r.queued ? ", " + r.queued + " queued (they go when Tally is open on the Tally computer)" : ""}{r.failed ? ", " + r.failed + " not posted" : ""}.</p>
        {live.length > 0 && <button className="btn small" data-ap-undo-run={r.run} onClick={() => askConfirm({ title: "Undo the whole run?", ok: "Undo " + live.length,
          body: "<p class='note'>Queued entries are taken off the queue. Entries in Tally are deleted from Tally through the bridge on this computer, and come back as “Waiting for me”. Each party's rule is paused until you approve one again.</p>" })
          .then((ok) => ok && ap.undoRun(co.id, r.run).then((x) => { setMsg(x.refused && x.refused.length ? x.refused[0] : ""); toast(x.words || x.why); render(); }))}>Undo the whole run ({live.length})</button>}
        <table><thead><tr><th>Entry</th><th className="n">Amount</th><th>Where</th><th>Undo does</th><th></th></tr></thead>
          <tbody>{r.entries.map((x) => <Row key={x.id} cid={co.id} x={x} ap={ap} onMsg={setMsg} />)}</tbody></table>
      </section>;
    })}
  </div>;
}
