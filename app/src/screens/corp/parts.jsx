// Corporate's small pieces: a text box that keeps its words while typed and saves when left (Enter or Tab), a choice, a
// date, a tick, and the card around a part of a page.
import { useEffect, useState } from "react";

export function Text({ label, value, onSave, type = "text", placeholder, wide, hint, from, attr, area, rows, upper, list, inputMode }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => { setV(value == null ? "" : String(value)); }, [value]);
  const keep = () => { const t = upper ? v.toUpperCase().trim() : v.trim(); if (t !== String(value == null ? "" : value)) onSave(t); };
  const p = { value: v, placeholder, onChange: (e) => setV(e.target.value), onBlur: keep, "aria-label": label, list, inputMode, ...(attr ? { [attr[0]]: attr[1] } : {}) };
  return <label className={"corp-f" + (wide ? " wide" : "")}>
    <span>{label}{from === "fincom" && <span className="corp-help" data-from-fincom=""> · from FinCom</span>}</span>
    {area ? <textarea rows={rows || 3} {...p} /> : <input type={type} {...p} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />}
    {hint && <span className="corp-help">{hint}</span>}
  </label>;
}

export function Pick({ label, value, onSave, options, wide, hint, attr }) {
  return <label className={"corp-f" + (wide ? " wide" : "")}>
    <span>{label}</span>
    <select value={value || ""} aria-label={label} onChange={(e) => onSave(e.target.value)} {...(attr ? { [attr[0]]: attr[1] } : {})}>
      {options.map((o) => { const [k, l] = Array.isArray(o) ? o : [o, o]; return <option key={k} value={k}>{l}</option>; })}
    </select>
    {hint && <span className="corp-help">{hint}</span>}
  </label>;
}

export function Tick({ label, on, onSave, attr }) {
  return <label className="chk" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
    <input type="checkbox" checked={!!on} onChange={(e) => onSave(e.target.checked)} {...(attr ? { [attr[0]]: attr[1] } : {})} /> {label}</label>;
}

export function Card({ title, aside, children, attr, pad = true }) {
  return <section className="corp-card" {...(attr ? { [attr[0]]: attr[1] } : {})}>
    {(title || aside) && <div className="corp-card-head"><h2>{title}</h2>{aside}</div>}
    {pad ? <div className="corp-card-body">{children}</div> : children}
  </section>;
}

export const Mark = ({ tone, children }) => <span data-mark={tone} aria-hidden="true">{children}</span>;
