// A TDS table's filters in its column headers (next-tds-tidy2, 20-Oct-2026; the owner: "Filters should be there in columns
// only"): no filter bar, pill row or box above a TDS table. A column's funnel (the app's .colf button, the same pop-up look
// as the purchase and bank tables' column filters, .colpop) opens that column's filter:
//   q     words (the Name column: name, PAN, voucher), with an optional tick ("Problems only")
//   pick  some of the column's values (with how many rows carry each): section, month, challan, PAN status
//   num   an amount from / to
// Kept per table in S.tdsCF[name] for as long as the page is open. How many are shown ("n of N") is said in the table's
// foot only while a filter is on (cfFoot). Rows are filtered in React, so "Select all shown" ticks only what is shown.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const FUN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/></svg>';
const blank = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && (v.min == null || v.min === "") && (v.max == null || v.max === ""));

export const cfState = (name) => ((S.tdsCF || {})[name]) || {};
export function cfSet(name, k, v) {
  const all = Object.assign({}, S.tdsCF || {}), F = Object.assign({}, all[name] || {});
  if (blank(v)) delete F[k]; else F[k] = v;
  all[name] = F; S.tdsCF = all; render();
}
export function cfClear(name, keys) {
  const all = Object.assign({}, S.tdsCF || {}), F = Object.assign({}, all[name] || {});
  (keys || Object.keys(F)).forEach((k) => delete F[k]);
  all[name] = F; S.tdsCF = all; render();
}
// a row passes every filter on (defs: [{k, kind, get(r), flag: {k, test(r)}}])
export function cfPass(F, defs, r) {
  return defs.every((d) => {
    if (d.flag && F[d.flag.k] && !d.flag.test(r)) return false;
    const v = F[d.k];
    if (blank(v)) return true;
    const x = d.get(r);
    if (d.kind === "q") { const w = String(v).toLowerCase().trim(); return !w || String(x || "").toLowerCase().includes(w); }
    if (d.kind === "pick") return v.includes(String(x == null ? "" : x));
    if (d.kind === "num") { const n = num(x); return (v.min == null || v.min === "" || n >= num(v.min) - 0.005) && (v.max == null || v.max === "" || n <= num(v.max) + 0.005); }
    return true;
  });
}

// the funnel and its pop-up; children: the filter's own boxes
export function ColF({ id, label, on, onClear, children }) {
  const [open, setOpen] = useState(false), btn = useRef(null), pop = useRef(null), [at, setAt] = useState(null);
  // in a drawer (a modal: nothing outside it takes focus or a click) the pop-up is put inside the drawer; a drawer moved by
  // a transform is the box a fixed pop-up is placed in, so its corner is taken off
  const place = () => { const b = btn.current; if (!b) return; const r = b.getBoundingClientRect(), w = 252, host = b.closest('[role="dialog"]') || document.body;
    const t = host !== document.body && getComputedStyle(host).transform !== "none" ? host.getBoundingClientRect() : { left: 0, top: 0 };
    setAt({ host, left: Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w + 8)) - t.left, top: (r.bottom + 386 <= window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - 386)) - t.top }); };   // below the funnel, else above it
  useEffect(() => {
    if (!open) return undefined;
    place();
    const out = (ev) => { if (pop.current && !pop.current.contains(ev.target) && btn.current && !btn.current.contains(ev.target)) setOpen(false); };
    const esc = (ev) => { if (ev.key === "Escape") { ev.preventDefault(); ev.stopImmediatePropagation(); setOpen(false); } };
    const re = () => place();
    document.addEventListener("mousedown", out, true); window.addEventListener("keydown", esc, true);   // before a drawer's own Esc
    window.addEventListener("scroll", re, true); window.addEventListener("resize", re);
    return () => { document.removeEventListener("mousedown", out, true); window.removeEventListener("keydown", esc, true); window.removeEventListener("scroll", re, true); window.removeEventListener("resize", re); };
  }, [open]);
  return <>
    <button type="button" ref={btn} className={"colf tcf" + (on ? " on" : "") + (open ? " open" : "")} data-cf={id} aria-label={"Filter " + label} title={"Filter " + label} aria-expanded={open}
      onClick={(ev) => { ev.stopPropagation(); setOpen(!open); }} dangerouslySetInnerHTML={{ __html: FUN }} />
    {open && at && createPortal(<div ref={pop} className="colpop tcf-pop" data-cf-pop={id} role="dialog" aria-label={"Filter " + label} style={{ left: at.left, top: at.top }} onClick={(ev) => ev.stopPropagation()}>
      <div className="cp-head"><b>{label}</b><button type="button" className="linkbtn" aria-label="Close" onClick={() => setOpen(false)}>×</button></div>
      <div className="cp-body">{children}</div>
      <div className="cp-foot"><span />{on && <button type="button" className="btn small" data-cf-clear={id} onClick={onClear}>Clear</button>}<button type="button" className="btn small primary" onClick={() => setOpen(false)}>Done</button></div>
    </div>, at.host || document.body)}
  </>;
}

// the filters of a table: {shown, on, head(k), foot(unit)}; extra rows (an "On" lookup) through the defs' get
export function useCF(name, defs, rows) {
  const F = cfState(name), shown = rows.filter((r) => cfPass(F, defs, r));
  const on = Object.keys(F).some((k) => !blank(F[k]));
  const head = (k) => {
    const d = defs.find((x) => x.k === k);
    if (!d) return null;
    const v = F[d.k], keys = [d.k].concat(d.flag ? [d.flag.k] : []), dOn = keys.some((x) => !blank(F[x]));
    let body = null;
    if (d.kind === "q") body = <><input type="search" autoFocus value={v || ""} placeholder={d.placeholder || "Words"} aria-label={d.placeholder || label(d)} data-cf-q={name + ":" + d.k}
        onChange={(ev) => cfSet(name, d.k, ev.target.value)} />
      {d.flag && <label className="cp-item" style={{ marginTop: 6 }}><input type="checkbox" checked={!!F[d.flag.k]} data-cf-flag={name + ":" + d.flag.k} onChange={(ev) => cfSet(name, d.flag.k, ev.target.checked ? "1" : "")} /><span>{d.flag.label}</span></label>}</>;
    else if (d.kind === "num") body = <div className="cp-range"><label>From<input type="text" inputMode="decimal" value={(v && v.min) || ""} placeholder="any" data-cf-min={name + ":" + d.k} onChange={(ev) => cfSet(name, d.k, { min: ev.target.value, max: (v && v.max) || "" })} /></label>
      <label>To<input type="text" inputMode="decimal" value={(v && v.max) || ""} placeholder="any" data-cf-max={name + ":" + d.k} onChange={(ev) => cfSet(name, d.k, { min: (v && v.min) || "", max: ev.target.value })} /></label></div>;
    else {
      const m = new Map(); rows.forEach((r) => { const x = String(d.get(r) == null ? "" : d.get(r)); m.set(x, (m.get(x) || 0) + 1); });
      const vals = Array.from(m.entries()).sort((a, b) => (d.order ? d.order(a[0], b[0]) : String(a[0]).localeCompare(String(b[0]), "en", { numeric: true })));
      const sel = v || [];
      body = <div className="cp-list" data-cf-list={name + ":" + d.k}>{vals.map(([x, n]) => <label key={x} className="cp-item"><input type="checkbox" checked={sel.includes(x)} data-cf-v={x}
        onChange={(ev) => cfSet(name, d.k, ev.target.checked ? sel.concat([x]) : sel.filter((y) => y !== x))} /><span>{x === "" ? "(blank)" : d.label ? d.label(x) : x}</span><small>{n}</small></label>)}</div>;
    }
    return <ColF id={name + ":" + d.k} label={label(d)} on={dOn} onClear={() => cfClear(name, keys)}>{body}</ColF>;
  };
  // the foot's "n of N", only while a filter is on
  const foot = (unit) => (on ? <span className="tcf-shown" data-cf-shown={shown.length + "|" + rows.length}>{shown.length} of {rows.length}{unit ? " " + unit : ""} shown · <button type="button" className="linkbtn" data-cf-clearall={name} onClick={() => cfClear(name)}>Clear filters</button></span> : null);
  return { F, shown, on, head, foot };
}
const label = (d) => d.title || d.k;
// a heading with its funnel: <Th cf={cf} k="name" cls="">Name</Th>
export const Th = ({ cf, k, cls, children, title }) => <th className={cls} title={title}><span className="colh"><span className="gfl">{children}</span>{cf.head(k)}</span></th>;
