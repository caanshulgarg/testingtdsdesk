// The column filters set on a list, as chips over it: how many rows show, each filter (click to change it in its
// column's filter box, ✕ to remove it) and Clear all; and the note when nothing matches. Was colChipBar and noMatchNote
// (src/js/23); the chips are colChips(t), the filter box is still colPopHtml, drawn by render(). Through colChipOpen,
// colChipX, colChipAll (src/js/23).
export function ChipBar({ t, shown, total, extra }) {
  const chips = colChips(t);
  if (!chips.length) return null;
  return <div className="chipbar"><span className="note">{shown + " of " + total + (extra ? " · " + extra : "")}</span>
    {chips.map(([k, l], i) => <span key={k + ":" + i} className="fchip"><button className="fchip-l" onClick={() => colChipOpen(t, k)}>{l}</button><button className="fchip-x" aria-label="Remove this filter" onClick={() => colChipX(t, k)}>✕</button></span>)}
    <button className="linkbtn" onClick={() => colChipAll(t)}>Clear all</button></div>;
}

export function NoMatch({ t }) {
  return <div className="bk-none">Nothing matches these filters. <button className="linkbtn" onClick={() => colChipAll(t)}>Clear all filters</button></div>;
}
