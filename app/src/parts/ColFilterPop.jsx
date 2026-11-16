// next-ui-table-filters: the box a column heading's funnel opens (ListTable.jsx), loaded only when first needed.
// Words to look for; a tick list of the values with their counts when the column has few (LIST_FEW); a date column's
// from / to with the quick ranges; a number column's from / to. Each change filters the list at once (colFilter.js);
// Clear empties this column, Done (or Esc, or a click outside) closes. Placed under its funnel; on a phone a sheet at
// the bottom of the screen (styles/dense.css).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listF, setListF, kindOf, pickVal, LIST_FEW } from "./colFilter.js";

const iso = (x) => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
// the quick ranges (the year runs April to March), as on the old tables' filter (src/js/31 GridF.quick)
function quick(q) {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth(), qs = m - (m + 9) % 3, fy = m >= 3 ? y : y - 1;
  const r = { month: [new Date(y, m, 1), new Date(y, m + 1, 0)], last: [new Date(y, m - 1, 1), new Date(y, m, 0)], quarter: [new Date(y, qs, 1), new Date(y, qs + 3, 0)], fy: [new Date(fy, 3, 1), new Date(fy + 1, 2, 31)] }[q];
  return r ? { from: iso(r[0]), to: iso(r[1]) } : null;
}
const QUICK = [["month", "This month"], ["last", "Last month"], ["quarter", "This quarter"], ["fy", "This year"]];

export default function ColFilterPop({ name, c, rows, prep, close }) {
  const ref = useRef(null), [look, setLook] = useState(""), timer = useRef(0);
  const f = listF(name)[c.k] || {}, set = (patch) => setListF(name, c.k, patch);
  // worked out once, when the box opens (not on every key pressed): the column's kind, and the values found in the
  // WHOLE list (not only the rows shown) with their counts, most first
  const [kind] = useState(() => kindOf(c, rows));
  const [vals] = useState(() => {
    if (kind !== "text") return [];
    const counts = new Map();
    rows.forEach((r, i) => { const v = pickVal(c, r, prep ? prep(r) : undefined, i); counts.set(v, (counts.get(v) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "en", { numeric: true }));
  });
  // the words: shown at once in the box, the list filtered 200 ms after the last key (a long list stays quick)
  const [q, setQ] = useState(f.q || "");
  const pend = useRef(null);
  const typeQ = (v) => { setQ(v); pend.current = v; clearTimeout(timer.current); timer.current = setTimeout(() => { pend.current = null; set({ q: v }); }, 200); };
  // closed before the 200 ms: the words typed still apply
  useEffect(() => () => { clearTimeout(timer.current); if (pend.current !== null) { const v = pend.current; pend.current = null; setTimeout(() => setListF(name, c.k, { q: v }), 0); } }, []);
  const few = kind === "text" && vals.length > 1 && vals.length <= LIST_FEW, sel = f.sel || [];
  const shown = look ? vals.filter(([v]) => v.toLowerCase().includes(look.toLowerCase()) || sel.includes(v)) : vals;
  const tick = (v, on) => set({ sel: on ? [...sel, v] : sel.filter((x) => x !== v) });
  // under the funnel, kept on the screen; above it when there is no room below
  useLayoutEffect(() => {
    const el = ref.current, b = document.querySelector('[data-list="' + CSS.escape(name) + '"] [data-ltf="' + CSS.escape(c.k) + '"]');
    if (!el || !b || window.innerWidth <= 600) return;
    const r = b.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, below = r.bottom + 6;
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left - 8)) + "px";
    el.style.top = (below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 6)) + "px";
  });
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    const down = (e) => { if (ref.current && !ref.current.contains(e.target) && !(e.target.closest && e.target.closest("[data-ltf]"))) close(); };
    document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", down, true);
    const first = ref.current && ref.current.querySelector("input"); if (first && window.innerWidth > 600) first.focus();
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", down, true); };
  }, []);
  const box = (k, type, ph, label) => <label>{label}<input type={type} inputMode={type === "text" ? "decimal" : undefined} data-ltf-in={k} value={f[k] || ""} placeholder={ph} onChange={(ev) => set({ [k]: ev.target.value })} /></label>;
  return <div ref={ref} className="colpop ltf-pop" role="dialog" aria-label={"Filter " + c.label} data-ltf-pop={c.k}>
    <div className="cp-head"><b>{c.label}</b><button type="button" className="linkbtn" aria-label="Close" onClick={close}>×</button></div>
    <div className="cp-body">
      {kind === "date" && <><div className="cp-quick">{QUICK.map(([q, l]) => <button type="button" key={q} className="cp-chip" data-ltf-quick={q} onClick={() => set(quick(q))}>{l}</button>)}</div>
        <div className="cp-range">{box("from", "date", "", "From")}{box("to", "date", "", "To")}</div></>}
      {kind === "num" && <div className="cp-range">{box("min", "text", "any", "From")}{box("max", "text", "any", "To")}</div>}
      <input type="search" className="cp-full" data-ltf-in="q" value={q} placeholder={kind === "text" ? "Has these words…" : "Or has these words…"} aria-label={"Words in " + c.label} onChange={(ev) => typeQ(ev.target.value)} />
      {few && <>
        <p className="cp-sub">Only these:</p>
        {vals.length > 8 && <input type="search" className="cp-search" value={look} placeholder="Search the list…" aria-label="Search the list" onChange={(ev) => setLook(ev.target.value)} />}
        <div className="cp-list">{shown.map(([v, n]) => <label key={v} className="cp-item"><input type="checkbox" data-ltf-v={v} checked={sel.includes(v)} onChange={(ev) => tick(v, ev.target.checked)} /><span>{v === "" ? "(blank)" : v}</span><small>{n}</small></label>)}</div>
      </>}
    </div>
    <div className="cp-foot"><span /><button type="button" className="btn small" data-ltf-clear="" onClick={() => { clearTimeout(timer.current); pend.current = null; setQ(""); setListF(name, c.k, { q: "", sel: [], min: "", max: "", from: "", to: "" }); }}>Clear</button><button type="button" className="btn small primary" data-ltf-done="" onClick={close}>Done</button></div>
  </div>;
}
