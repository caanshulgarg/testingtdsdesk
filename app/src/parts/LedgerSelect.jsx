// A list of the Tally ledgers to choose one from (the old ledgerOptions() in src/js/22, which marks the chosen one);
// `prefer` puts the ledgers of matching groups first. Drawn afresh when the chosen ledger changes.
// next-fix-pagespeed: a list of more than 1,500 ledgers holds only the chosen one (and the longest name) until it is
// pressed, focused or touched, when every ledger is put in; 20,000 options in the page made each drawing take seconds.
export default function LedgerSelect({ selected, prefer, onPick, ...rest }) {
  const big = knownLedgers().size > 1500, all = (ev) => { const s = ev.currentTarget; if (big && !s.f) { s.f = 1; s.innerHTML = ledgerOptions(selected || "", prefer); } };
  return <select key={(selected || "") + (big ? "#" + Ledgers.ver : "")} {...rest} onMouseDown={all} onFocus={all} onTouchStart={all} onChange={(ev) => onPick(ev.target.value)}
    dangerouslySetInnerHTML={{ __html: ledgerOptions(selected || "", prefer, big) }} />;
}
