// While data loads: "Loading <what>…" over grey bars in the shape of what is coming (the owner's spec K7, round 2):
// never a blank area. `rows` bars (a list) or `lines` (a card); `inline` for a short line inside a sentence.
export default function Loading({ what, rows = 3, cols = 4, lines, inline, note }) {
  const words = "Loading" + (what ? " " + what : "") + "…";
  if (inline) return <span className="lt-loading-inline" data-loading="" aria-busy="true"><span className="skel skel-dot" aria-hidden="true"></span>{words}</span>;
  const n = lines || rows, w = Math.max(2, Math.min(cols || 4, 6));
  return <div className="lt-loading" data-loading="" aria-busy="true" role="status">
    <div className="lt-loading-t">{words}</div>
    {note && <div className="note">{note}</div>}
    <div className="lt-skel" aria-hidden="true">{Array.from({ length: n }, (_, i) =>
      <div key={i} className="skel-row">{Array.from({ length: lines ? 1 : w }, (_, j) => <span key={j} className="skel" style={{ width: lines ? (90 - (i % 3) * 15) + "%" : undefined }}></span>)}</div>)}</div>
  </div>;
}
