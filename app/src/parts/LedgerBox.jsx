// A box for a Tally ledger name, with the ledger list that drops down while typing (the old AC module in
// src/js/23 opens it for any input with data-ac). The choice counts when the box is left or a ledger is picked
// (see CommitBox); onCommit returns false to refuse a name that is not in Tally.
import CommitBox from "./CommitBox.jsx";

export default function LedgerBox({ fk, className = "lgbox", ...rest }) {
  return <CommitBox className={className} data-ac="1" data-fk={fk} autoComplete="off" {...rest} />;
}
