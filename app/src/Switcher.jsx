// Select company (F3 or Ctrl+K): type to find a client, ↑↓ to move, Enter to open, Esc to close.
// Was renderSwitcher and its keys in src/js/27-firm-account.js; the list order is switcherList() there.
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export default function Switcher() {
  const modal = document.getElementById("modal"), sw = S.switcher;
  const input = useRef(null), selected = useRef(null);
  useLayoutEffect(() => { modal.classList.toggle("hidden", !sw); });
  const open = !!sw;
  useEffect(() => { if (open && input.current) input.current.focus(); }, [open]);
  // a click on the dark area around the box closes it
  useEffect(() => {
    const out = (e) => { if (e.target === modal) closeSwitcher(); };
    modal.addEventListener("click", out);
    return () => modal.removeEventListener("click", out);
  }, [modal]);
  useEffect(() => { if (selected.current && selected.current.scrollIntoView) selected.current.scrollIntoView({ block: "nearest" }); });
  // the keys belong to the switcher while it is open (before the rest of the page sees them)
  useEffect(() => {
    if (!open) return;
    const keys = (ev) => {
      const list = switcherList(), k = ev.key;
      if (k === "Escape") { ev.preventDefault(); closeSwitcher(); }
      else if (k === "ArrowDown") { ev.preventDefault(); S.switcher.idx = Math.min(list.length - 1, S.switcher.idx + 1); renderSwitcher(); }
      else if (k === "ArrowUp") { ev.preventDefault(); S.switcher.idx = Math.max(0, S.switcher.idx - 1); renderSwitcher(); }
      else if (k === "Enter") { ev.preventDefault(); if (list[S.switcher.idx]) openCompany(list[S.switcher.idx].id); }
      else if (k === "F3") ev.preventDefault();
    };
    document.addEventListener("keydown", keys, true);
    return () => document.removeEventListener("keydown", keys, true);
  }, [open]);
  if (!sw) return null;

  const list = switcherList(), rec = recentIds();
  sw.idx = Math.max(0, Math.min(sw.idx, list.length - 1));
  return createPortal(
      <div className="sw" role="dialog" aria-modal="true" aria-label="Select company">
        <div className="swhead"><b>Select company</b><span className="note">↑↓ to move, Enter to open, Esc to close</span></div>
        <input ref={input} type="text" placeholder="Type a client name or GSTIN" autoComplete="off" value={sw.q || ""}
          onChange={(e) => { S.switcher.q = e.target.value; S.switcher.idx = 0; renderSwitcher(); }} />
        <ul className="swlist" role="listbox">
          {list.length ? list.map((c, i) => {
            const st = c.stats || {}, on = i === sw.idx, recent = !sw.q && rec.indexOf(c.id) >= 0 && rec.indexOf(c.id) < 5;
            return (
              <li key={c.id} role="option" aria-selected={on} ref={on ? selected : null} onClick={() => openCompany(c.id)}>
                <span>
                  <b>{c.name}</b>{c.id === S.coId && <> <span className="tag stamp">Open</span></>}{recent && <> <span className="note">recent</span></>}
                  <br /><span className="note">{c.gstin || "No GSTIN"}</span>
                </span>
                <span>{st.drafts ? <span className="tag warn">{st.drafts} to review</span> : null}</span>
              </li>
            );
          }) : <li className="note">No client matches.</li>}
        </ul>
        <div className="swfoot">
          <button className="btn small" onClick={() => doAct("swHome")}>All clients</button>
          <button className="btn small" onClick={() => doAct("swAdd")}>Add client</button>
        </div>
      </div>, modal);
}
