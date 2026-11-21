// A list of the Tally ledgers to choose one from (the old ledgerOptions() in src/js/22, which marks the chosen one);
// `prefer` puts the ledgers of matching groups first. Drawn afresh when the chosen ledger changes.
// next-fix-pagespeed: a list of more than 1,500 ledgers holds only the chosen one and the longest name, in their groups
// (as wide), until it is pressed, focused or touched, when every ledger is put in; 20,000 options in the page made each
// drawing of it take seconds
export default function LedgerSelect({ selected, prefer, onPick, ...rest }) {
  const k = knownLedgers(), big = k.size > 1500, html = ledgerOptions(selected || "", prefer);
  const all = (ev) => { const s = ev.currentTarget; if (big && !s.f) { s.f = 1; s.innerHTML = html; } };
  let short = html;
  if (big) {
    let w = ""; k.forEach((l) => { if (l.name.length > w.length) w = l.name; });
    const keep = ["", esc(selected || ""), esc(w)];
    short = html.replace(/<option value="([^"]*)"[^>]*>[^<]*<\/option>/g, (m, v) => (keep.includes(v) ? m : ""));
  }
  return <select key={(selected || "") + (big ? "#" + Ledgers.ver : "")} {...rest} onMouseDown={all} onFocus={all} onTouchStart={all} onChange={(ev) => onPick(ev.target.value)}
    dangerouslySetInnerHTML={{ __html: short }} />;
}
