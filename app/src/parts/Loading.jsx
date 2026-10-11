// While data loads: "Loading <what>…" over grey bars in the shape of what is coming (the owner's spec K7, round 2):
// never a blank area. `rows` bars (a list) or `lines` (a card); `inline` for a short line inside a sentence.
// Stability batch 3: a whole page waiting (`page`) is drawn in that page's own shape, once: "table" (a head card over a
// list: Bank, Sales, Transactions) or "books" (the tabs' line, the period's boxes, then the list: TDS, GST, Reports…),
// shown only after 300 ms (a quick load shows nothing in between), with the thin bar under the top bar (nav.js).
import { useEffect } from "react";
import { FinComNav } from "../nav.js";

function Bars({ n, w, lines }) {
  return <div className="lt-skel" aria-hidden="true">{Array.from({ length: n }, (_, i) =>
    <div key={i} className="skel-row">{Array.from({ length: lines ? 1 : w }, (_, j) => <span key={j} className="skel" style={{ width: lines ? (90 - (i % 3) * 15) + "%" : undefined }}></span>)}</div>)}</div>;
}

function PageWait({ words, note, shape, cols }) {
  useEffect(() => { FinComNav.start(); return () => FinComNav.done(); }, []);
  return <div className={"lt-page lt-page-" + shape} data-loading="" aria-busy="true" role="status">
    {shape === "books" && <div className="lt-page-tabs" aria-hidden="true"><span className="skel" /><span className="skel" /><span className="skel" /><span className="skel" /></div>}
    {shape === "books" && <div className="lt-page-boxes" aria-hidden="true"><span className="skel" /><span className="skel" /><span className="skel" /></div>}
    {shape === "table" && <div className="lt-page-head" aria-hidden="true"><span className="skel" /><span className="skel" /></div>}
    <div className="lt-loading">
      <div className="lt-loading-t">{words}</div>
      {note && <div className="note">{note}</div>}
      <Bars n={6} w={Math.max(2, Math.min(cols || 5, 6))} />
    </div>
  </div>;
}

export default function Loading({ what, rows = 3, cols = 4, lines, inline, note, page }) {
  const words = "Loading" + (what ? " " + what : "") + "…";
  if (inline) return <span className="lt-loading-inline" data-loading="" aria-busy="true"><span className="skel skel-dot" aria-hidden="true"></span>{words}</span>;
  if (page) return <PageWait words={words} note={note} shape={page} cols={cols} />;
  const n = lines || rows, w = Math.max(2, Math.min(cols || 4, 6));
  return <div className="lt-loading" data-loading="" aria-busy="true" role="status">
    <div className="lt-loading-t">{words}</div>
    {note && <div className="note">{note}</div>}
    <Bars n={n} w={w} lines={lines} />
  </div>;
}
