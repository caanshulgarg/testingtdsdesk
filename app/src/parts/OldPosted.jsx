// The line under the lists of Purchase, Bank and Sales (the owner, 23-Nov-2026: "Posted entries in tally should be removed
// after 24 hours from the purchase, bank and sales page..it should remain in transaction only"): an entry Tally confirmed
// more than 24 hours ago is listed only in Transactions (postedOld, src/js/03); this opens the matching register. `foot`:
// a line of the table's foot (Bank: its table fills its box, so a line after it would be out of sight)
export default function OldPosted({ kind, foot }) {
  const T = foot ? "span" : "p";
  return <T className="note" data-old-posted={kind} style={{ display: "block", margin: foot ? "4px 0 0" : "8px 0 4px", fontWeight: 400 }}>Posted entries older than 24 hours are in{" "}
    <button type="button" className="linkbtn" data-old-posted-go={kind} onClick={() => { goClient("txn"); S.txnTab = kind; render(); }}>Transactions →</button></T>;
}
