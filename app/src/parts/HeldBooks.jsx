// The owner's finding of 05-Oct-2026: Look up said "From the books (GARG SHEKHAR & COMPANY), in step with Tally as of
// 05-Oct-2026 13:59 IST" while a line Tally sent for that company was held (tally_recorder_lines.state = 'held', not in
// the books). Every view of a client's books (Look up and its answers, Reports, MIS, Accounts, the books' tabs) shows
// instead, while any line of the client is held: "N entries received from Tally are not yet in these books: <reason>"
// (the reason when the lines share one, else "see Sync activity"), with a link to Sync activity on the held lines. A
// ledger's view (led) adds the lines for it: "1 entry of 05-Oct-2026 for this ledger is waiting: <reason>", and, for the
// lines whose ledgers are not known (no entry body), "N entries of <dates> waiting; the ledger is not yet known, so this
// balance may be incomplete." The words are AlertHub.booksHeld / ledgerHeld (src/js/63-alerts.js), the same as printed.
export default function HeldBooks({ cid, led, to, where }) {
  const h = typeof booksHeld === "function" ? booksHeld(cid) : null;
  if (!h) return null;
  const go = () => Rec.openActivity(cid, "held");
  const lines = led ? AlertHub.ledgerHeld(cid, led, to) : [];
  // FinCom 2.3.5, one flow with Sync activity (Rec.needKind, src/js/61): yellow and "Needs you" only when a person must
  // act (upload that day's Day Book, add a ledger, a locked month...); lines FinCom is still fetching are said quietly
  const needs = typeof Rec === "object" && Rec.needKind ? (h.lines || []).some((l) => Rec.needKind(l)) : true;
  return <div className={needs ? "bk-alert warn" : "note"} role="status" data-books-held={where || ""} data-books-held-needs={needs ? "" : undefined} style={{ margin: "6px 0" }}>
    {needs && <b>{"Needs you"}</b>}
    <div data-books-held-text="">{h.why
      ? <>{h.text}{" · "}<button className="linkbtn" data-books-held-link="" onClick={go}>See them in Sync activity</button></>
      : <>{h.text.replace(/Sync activity$/, "")}<button className="linkbtn" data-books-held-link="" onClick={go}>Sync activity</button></>}</div>
    {lines.map((x) => <div key={x.kind} data-books-held-led={x.kind}>{x.text}</div>)}
  </div>;
}
