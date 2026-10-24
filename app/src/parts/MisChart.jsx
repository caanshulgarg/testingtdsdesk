// "My MIS" (ROUND 105, B2): a block's chart on the screen. The SVG is lib/misChartSvg.js's (the same drawing goes into
// the Excel as a picture and, later, the cloud's PDF); around it: the legend (two or more series, or a pie's slices: the
// colour is never the only way to tell them apart), a tooltip on hover or tap (each bar, slice or month column), and the
// chart's words for a screen reader (its title and description). The figures are always also in the block's table view.
// In the My MIS screen's lazy chunk; no chart library.
import { useEffect, useRef, useState } from "react";
import { chartSvg, legendOf, THEME_CSS } from "../lib/misChartSvg.js";

export default function MisChart({ spec, title, fmtValue, h = 240 }) {
  const box = useRef(null), [w, setW] = useState(640), [tip, setTip] = useState(null);
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver((es) => { const x = Math.round(es[0].contentRect.width); if (x > 0) setW((o) => (Math.abs(o - x) > 4 ? x : o)); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  if (!spec) return null;
  const { svg, marks, empty } = chartSvg(spec, { w, h: Math.min(h, Math.max(180, Math.round(w * 0.55))), theme: THEME_CSS, title });
  const legend = legendOf(spec);
  const show = (ev) => {
    const t = ev.target, i = t && t.getAttribute ? t.getAttribute("data-i") : null;
    if (i == null) { setTip(null); return; }
    const s = t.getAttribute("data-s"), col = t.hasAttribute("data-col"), at = marks.filter((m) => String(m.i) === i && (col || String(m.s) === s));
    if (!at.length) { setTip(null); return; }
    const r = box.current.getBoundingClientRect(), x = Math.min(Math.max(8, (ev.clientX || 0) - r.left), r.width - 8);
    setTip({ x, y: Math.max(0, at[0].y - 8), head: at[0].label || at[0].name, lines: at.map((m) => [m.label ? m.name : "", m.value, m.share]) });
  };
  return <figure className="mm-chart" data-mm-chart={spec.type}>
    <div ref={box} className="mm-chart-box" onMouseMove={show} onMouseLeave={() => setTip(null)} onClick={show} dangerouslySetInnerHTML={{ __html: svg }} />
    {tip && <div className="mm-tip" role="status" style={{ left: tip.x, top: tip.y }}>
      <b>{tip.head}</b>{tip.lines.map(([n, v, sh], k) => <div key={k}>{n ? <span>{n}: </span> : null}{fmtValue(v)}{sh != null ? " (" + sh + "%)" : ""}</div>)}</div>}
    {!empty && legend.length > 0 && <figcaption className="mm-legend">{legend.map((it, k) => <span key={k} className={it.ghost ? "ghost" : ""}><i style={{ background: it.others ? "var(--mis-other)" : "var(--mis-s" + ((it.ci % 8) + 1) + ")" }} aria-hidden="true" />{it.name}</span>)}</figcaption>}
  </figure>;
}
