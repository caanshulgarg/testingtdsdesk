// A list of the Tally ledgers to choose one from (the old ledgerOptions() in src/js/22, which marks the chosen one);
// `prefer` puts the ledgers of matching groups first. Drawn afresh when the chosen ledger changes.
// next-fix-pagespeed: a list of more than 1,500 ledgers holds only the chosen one and the longest name, in their groups
// (as wide), until it is pressed, focused or touched, when every ledger is put in; 20,000 options in the page made each
// drawing of it take seconds. What was put in is kept with the box (s.f): another list (a ledger created here, a new
// read), or the short form drawn again by React, is put in afresh the next time it is used
import { useLayoutEffect, useRef } from "react";
export default function LedgerSelect({ selected, prefer, onPick, ...rest }) {
  const k = knownLedgers(), big = k.size > 1500, html = ledgerOptions(selected || "", prefer), ref = useRef(null), was = useRef("");
  const all = (ev) => { const s = ev.currentTarget; if (big && s.f !== html) { s.f = html; s.innerHTML = html; } };
  let short = html;
  if (big) {
    let w = ""; k.forEach((l) => { if (l.name.length > w.length) w = l.name; });
    const keep = ["", esc(selected || ""), esc(w)];
    short = html.replace(/<option value="([^"]*)"[^>]*>[^<]*<\/option>/g, (m, v) => (keep.includes(v) ? m : ""));
  }
  useLayoutEffect(() => { if (was.current !== short && ref.current) ref.current.f = ""; was.current = short; });
  return <select ref={ref} key={(selected || "") + (big ? "#" + Ledgers.ver : "")} {...rest} onMouseDown={all} onFocus={all} onTouchStart={all} onChange={(ev) => onPick(ev.target.value)}
    dangerouslySetInnerHTML={{ __html: short }} />;
}
