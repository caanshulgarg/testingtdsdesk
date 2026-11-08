// next-bank-overlap (08-Nov-2026, the owner's approved design): what an upload that overlapped the statements already here
// left out, held or marked, and how this statement joins the one before it. The rules are BankOverlap (src/js/96, loaded
// with this screen: lib/bankOverlap.js).
//   - the header: "April 2026 already uploaded (31 entries kept as they are)", with See them (the lines, from the
//     statements that hold them);
//   - held aside: "Repeat of <date> entry", Keep it / It's a repeat (not in the books, never posted until chosen);
//     held lines and repeats are the statement's own lines, marked (BankOverlap.isHeld / isRepeat: the line's state);
//   - kept aside as repeats: Bring back (nothing is ever deleted);
//   - a line marked "Possible repeat — check" (RepMark, in the line's particulars): Keep it / It's a repeat;
//   - the join: "₹X difference between <date> and <date>", and the days no statement holds.
import { useEffect, useState } from "react";
import { BankOverlap } from "../../lib/bankOverlap.js";
import NoticeLine from "../NoticeLine.jsx";
import "./overlap.css";

const amt = (r) => (num(r.debit) ? "−" + money(r.debit) : "+" + money(r.credit));

// the header's few words, beside the running-balance check (one line, cut short when narrow: See them is in OverlapPanel)
export function DupWords({ st }) {
  if (!st || !(st.dupRows > 0)) return null;
  return <> <span className="muted" data-dup-words="">· {(st.dupSay ? st.dupSay + " already uploaded" : "Already uploaded") + " (" + entries(st.dupRows) + (st.dupRows === 1 ? " kept as it is)" : " kept as they are)")}</span></>;
}

// a line marked "Possible repeat — check", in its particulars
export function RepMark({ r }) {
  if (!r.rep) return null;
  if (r.rep.ok) return <div className="bo-mark ok" data-rep-ok={r.id}>Checked: not a repeat of the entry of {fmtDate(r.rep.of)}</div>;
  if (!BankOverlap.isOpen(r)) return null;
  return <div className="bo-mark" data-weak={r.id} title={r.rep.why}>⚠ Possible repeat — check: {r.rep.kind === "weak" ? "same amount as" : "looks like"} the entry of {fmtDate(r.rep.of)}{r.rep.kind === "weak" ? "" : " (" + r.rep.why + ")"}. Not posted until you choose.
    {BankOverlap.isOpen(r) && <> <button type="button" className="linkbtn" data-rep-keep={r.id} onClick={(ev) => { ev.stopPropagation(); BankOverlap.keep(r.id); }}>Keep it</button>
      {" · "}<button type="button" className="linkbtn" data-rep-repeat={r.id} onClick={(ev) => { ev.stopPropagation(); BankOverlap.repeat(r.id); }}>It’s a repeat</button></>}</div>;
}

function Lines({ list, act, dataName }) {
  return <div className="tblwrap bo-tbl"><table className="data" data-bo-list={dataName}><thead><tr><th>Date</th><th>Particulars</th><th className="n">Amount</th><th className="n">Balance</th><th>{act ? "Why" : "Where"}</th>{act && <th />}</tr></thead><tbody>
    {list.map((r) => <tr key={r.id} data-bo-line={r.id}><td>{fmtDate(r.date)}</td><td className="bo-narr" title={r.narr}>{r.narr}</td><td className="n">{amt(r)}</td>
      <td className="n">{r.balance === null || r.balance === undefined || r.balance === "" ? "" : INR.format(r2(num(r.balance)))}</td>
      <td>{act ? <><b>Repeat of {fmtDate(r.rep.of)} entry</b><div className="muted bo-why">{r.rep.why}</div></> : <>{stmtLabel(r.stmt)}<div className="muted bo-why">{(BST_WORDS[r.state] || r.state) + (r.ledger ? " · " + r.ledger : "")}</div></>}</td>
      {act && <td className="bo-acts">{act(r)}</td>}</tr>)}</tbody></table></div>;
}
const BST_WORDS = { attention: "To do", suggested: "Suggested", ready: "Ready to post", sent: "Posted to Tally", intally: "Already in Tally", ignored: "Ignored" };

// the lines skipped as already uploaded, read from the statements that hold them
function Skipped({ st }) {
  const [list, setList] = useState(null);
  useEffect(() => { let on = true; BankOverlap.skipped(st).then((l) => on && setList(l), () => on && setList([])); return () => { on = false; }; }, [st.id, (st.dupIds || []).length]);
  if (!list) return <div className="bk-found" data-dup-list="">Reading the lines already uploaded…</div>;
  const gone = (st.dupIds || []).length - list.length;
  return <div className="bk-alert bo-box" data-dup-list=""><b>{entries(list.length)} already uploaded, kept as they are</b> (not added again from {st.fileName}){gone > 0 ? "; " + entries(gone) + " from a statement no longer in the list" : ""}.
    <Lines list={list} dataName="dup" /></div>;
}

export function OverlapPanel({ st }) {
  const b = B();
  if (!st) return null;
  const held = b.rows.filter(BankOverlap.isHeld), reps = b.rows.filter(BankOverlap.isRepeat), j = BankOverlap.join(b.stmts, st);
  return <>
    {j && j.diff && <NoticeLine sev="warn" data-join-gap="" text={j.diff.words + ": this statement’s opening " + money(st.opening) + " does not follow on from the closing " + money(j.prev.closing) + " of " + stmtLabel(j.prev) + "."} how="Some entries between the two statements may be missing, or one statement was read wrongly. Upload the statement for the days in between, or check the balances against the bank." />}
    {j && j.gap && <NoticeLine sev={j.diff ? "warn" : "info"} data-join-days="" text={j.gap.words + " (between " + stmtLabel(j.prev) + " and this one)."} />}
    {st.dupRows > 0 && (st.dupIds || []).length > 0 && <NoticeLine sev="info" data-dup-note="" text={(st.dupSay ? st.dupSay + " already uploaded: " : "Already uploaded: ") + entries(st.dupRows) + (st.dupRows === 1 ? " kept as it is" : " kept as they are") + ", not added again."}>
      <button type="button" className="linkbtn" data-dup-see="" aria-expanded={b.dupOpen === st.id ? "true" : "false"} onClick={() => { b.dupOpen = b.dupOpen === st.id ? null : st.id; render(); }}>{b.dupOpen === st.id ? "Hide them" : "See them"}</button></NoticeLine>}
    {b.dupOpen === st.id && <Skipped st={st} />}
    {held.length > 0 && <div className="bk-alert bo-box" data-held-repeats="">
      <b>{held.length === 1 ? "1 entry is held aside" : held.length + " entries are held aside"}: {held.length === 1 ? "it looks like an entry" : "they look like entries"} already uploaded.</b> Not in the books and not posted until you choose.
      <Lines list={held} dataName="held" act={(r) => <><button className="btn small" data-held-keep={r.id} onClick={() => BankOverlap.keep(r.id)}>Keep it</button>{" "}
        <button className="btn small" data-held-repeat={r.id} onClick={() => BankOverlap.repeat(r.id)}>It’s a repeat</button></>} />
    </div>}
    {reps.length > 0 && <details className="bk-found bo-reps" data-repeats="">
      <summary>{reps.length === 1 ? "1 entry kept aside as a repeat" : reps.length + " entries kept aside as repeats"} (not in the books; nothing is deleted)</summary>
      <Lines list={reps} dataName="repeats" act={(r) => <button className="linkbtn" data-rep-back={r.id} onClick={() => BankOverlap.back(r.id)}>Bring back</button>} />
    </details>}
  </>;
}
