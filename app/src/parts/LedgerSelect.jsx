// A list of the Tally ledgers to choose one from (the old ledgerOptions() in src/js/22, which marks the chosen one);
// `prefer` puts the ledgers of matching groups first. Drawn afresh when the chosen ledger changes.
export default function LedgerSelect({ selected, prefer, onPick, ...rest }) {
  return <select key={selected || ""} {...rest} onChange={(ev) => onPick(ev.target.value)} dangerouslySetInnerHTML={{ __html: ledgerOptions(selected || "", prefer) }} />;
}
