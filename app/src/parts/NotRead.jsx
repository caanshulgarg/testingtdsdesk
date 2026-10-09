// One line when a page opens on a period the books in FinCom do not reach yet (smart moves round 1, 09-Oct-2026):
// "Books in FinCom end 31-Mar-2026 · Read 2026-27 from Tally → · Show 2025-26". Read only opens From Tally (where the
// books are read, as its own buttons do); nothing is asked of Tally from here.
// also: the one place for "Connect FinCom Bridge to keep this up to date" when Tally is not connected (bridge = false),
// as the freshness box that said it gives way to this line
export default function NotRead({ end, what, read, show, onShow, bridge = true }) {
  // one row (the app's rule for notices): the words, then two links
  return <p className="bk-alert not-read" data-not-read="" role="status">
    <span>{what ? <><b>{what}</b>{" not read yet · "}</> : null}{"Books in FinCom end " + fmtDate(tallyDate(end))}</span>
    <button className="linkbtn strong" data-not-read-go="" onClick={() => FC.go("import")}>{"Read " + (read ? read + " " : "") + "from Tally →"}</button>
    {show && onShow && <button className="linkbtn" data-not-read-show="" onClick={onShow}>{"Show " + show}</button>}
    {!bridge && <span className="note" data-not-read-bridge="">Connect FinCom Bridge to keep this up to date.</span>}
  </p>;
}
