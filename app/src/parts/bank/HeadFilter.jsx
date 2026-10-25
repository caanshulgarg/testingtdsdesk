// The bank page's own header filters for Balance, Status and Type (25-Oct-2026, the owner: "I need filters within column
// as earlier"). The same funnel and the same pop-up look as the old ones (ColFunnel / colPopHtml, src/js/23), which Date,
// Particulars, Withdrawal, Deposit and Ledger keep. What is chosen is kept on b.f and read by ./smart.js (headPass).
import { useEffect, useRef, useState } from "react";
import { setF, headOn, STATE_WORDS, VTYPES, vtypeOf } from "./smart.js";

function Range({ f, lo, hi }) {
  const [a, setA] = useState(f[lo] || ""), [z, setZ] = useState(f[hi] || "");
  const go = () => { const b = B(); b.f = Object.assign({}, b.f || {}, { [lo]: a, [hi]: z }); setF(lo, a); };
  return <>
    <div className="cp-range"><label>From<input type="text" inputMode="decimal" data-hf-min="" value={a} placeholder="0" onChange={(ev) => setA(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && go()} /></label>
      <label>To<input type="text" inputMode="decimal" data-hf-max="" value={z} placeholder="any" onChange={(ev) => setZ(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && go()} /></label></div>
    <div className="cp-foot"><span></span><button className="btn small primary" data-hf-apply="" onClick={go}>Apply</button></div>
  </>;
}

function Pick({ f, k, values }) {
  const cur = f[k] || [];
  const flip = (v) => setF(k, cur.includes(v) ? cur.filter((x) => x !== v) : cur.concat([v]));
  return <div className="cp-list">{values.map(([v, w, n]) => <label key={v} className="cp-item"><input type="checkbox" data-hf-v={v} checked={cur.includes(v)} onChange={() => flip(v)} /><span>{w}</span><small>{n}</small></label>)}</div>;
}

export default function HeadFilter({ k, label }) {
  const b = B(), f = b.f || {}, [at, setAt] = useState(null), btn = useRef(null), pop = useRef(null);
  const on = headOn(f, k);
  useEffect(() => {
    if (!at) return undefined;
    const shut = (ev) => {
      // Esc closes this box only (the app's own Esc goes back a page): heard first, on the window
      if (ev.type === "keydown" && ev.key === "Escape") { ev.preventDefault(); ev.stopImmediatePropagation(); setAt(null); return; }
      if (ev.type === "keydown" ? ev.key === "Escape" : ev.type === "scroll" ? !(pop.current && pop.current.contains(ev.target)) : !(pop.current && pop.current.contains(ev.target)) && !(btn.current && btn.current.contains(ev.target))) setAt(null);
    };
    document.addEventListener("mousedown", shut, true); window.addEventListener("keydown", shut, true); window.addEventListener("scroll", shut, true);
    return () => { document.removeEventListener("mousedown", shut, true); window.removeEventListener("keydown", shut, true); window.removeEventListener("scroll", shut, true); };
  }, [at]);
  const toggle = () => {
    if (at) { setAt(null); return; }
    const th = btn.current.closest("th") || btn.current, r = th.getBoundingClientRect(), w = Math.min(252, innerWidth - 24);
    setAt({ left: Math.max(12, Math.min(r.left, innerWidth - w - 12)), top: Math.min(r.bottom + 4, innerHeight - 200) });
  };
  const count = (fn) => { const m = new Map(); b.rows.forEach((r) => { const v = fn(r); m.set(v, (m.get(v) || 0) + 1); }); return m; };
  let body = null;
  if (at && k === "bal") body = <Range f={f} lo="bmin" hi="bmax" />;
  if (at && k === "st") { const n = count((r) => r.state); body = <Pick f={f} k="sts" values={Object.keys(STATE_WORDS).filter((s) => n.get(s) || (f.sts || []).includes(s)).map((s) => [s, STATE_WORDS[s], n.get(s) || 0])} />; }
  if (at && k === "vt") { const n = count(vtypeOf); body = <Pick f={f} k="vts" values={VTYPES.map((t) => [t, t, n.get(t) || 0])} />; }
  return <>
    <button ref={btn} type="button" className={"colf bs-hf" + (on ? " on" : "") + (at ? " open" : "")} data-hf={k} aria-label={"Filter " + label} title={"Filter " + label} aria-expanded={!!at}
      onClick={toggle} dangerouslySetInnerHTML={{ __html: FUNNEL }} />
    {at && <div ref={pop} className="colpop bs-hfpop" role="dialog" aria-label={"Filter " + label} data-hf-pop={k} style={{ left: at.left, top: at.top }}>
      <div className="cp-head"><b>Filter: {label}</b><button className="icon" aria-label="Close" onClick={() => setAt(null)}>✕</button></div>
      <div className="cp-body">{body}</div>
      {on && <div className="cp-foot"><button className="linkbtn" data-hf-clear="" onClick={() => { ({ bal: ["bmin", "bmax"], st: ["sts"], vt: ["vts"] })[k].forEach((x) => setF(x, "")); setAt(null); }}>Clear</button><span></span></div>}
    </div>}
  </>;
}
