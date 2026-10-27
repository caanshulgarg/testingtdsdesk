// Plain SVG charts for the AI control centre (no chart library). Colours are roles from ai.css (validated pair:
// blue for FinCom's cost, orange for what firms were charged; light and dark steps). Every value a tooltip shows is
// also in the table below the charts. Labels go in as text nodes (React), never as HTML.
import { useMemo, useRef, useState } from "react";

const W = 720, H = 220, PAD = { l: 56, r: 72, t: 12, b: 28 };
export const inr = (paise) => {
  const p = Math.round(Number(paise) || 0), r = Math.abs(p) / 100;
  return (p < 0 ? "-₹" : "₹") + r.toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });
};
const short = (paise) => {
  const r = (Number(paise) || 0) / 100;
  if (Math.abs(r) >= 1e7) return "₹" + (r / 1e7).toFixed(1).replace(/\.0$/, "") + " Cr";
  if (Math.abs(r) >= 1e5) return "₹" + (r / 1e5).toFixed(1).replace(/\.0$/, "") + " L";
  if (Math.abs(r) >= 1e3) return "₹" + (r / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return "₹" + Math.round(r);
};
const dayLabel = (d) => new Date(d + "T00:00:00+05:30").toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
// a "nice" top for the y axis and its 4 ticks
function niceMax(v) {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// FinCom's cost against what firms were charged, by day: two lines on one axis, a crosshair that snaps to the day
export function CostChargedChart({ days }) {
  const [at, setAt] = useState(null);
  const ref = useRef(null);
  const geo = useMemo(() => {
    const n = days.length, max = niceMax(Math.max(1, ...days.map((d) => Math.max(d.cost_paise, d.charged_paise))));
    const x = (i) => PAD.l + (n <= 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (n - 1));
    const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
    const path = (k) => days.map((d, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(d[k]).toFixed(1)).join(" ");
    return { n, max, x, y, cost: path("cost_paise"), charged: path("charged_paise") };
  }, [days]);
  if (!days.length) return <p className="muted ai-empty">No AI use in this range.</p>;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * geo.max);
  const every = Math.max(1, Math.ceil(days.length / 8));
  const last = days[days.length - 1];
  const move = (e) => {
    const r = ref.current.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    days.forEach((_, i) => { const d = Math.abs(geo.x(i) - px); if (d < bd) { bd = d; best = i; } });
    setAt(best);
  };
  const tipLeft = at === null ? 0 : (geo.x(at) / W) * 100;
  return (
    <figure className="ai-chart" data-testid="chart-cost">
      <div className="ai-legend" aria-hidden="true"><span><i className="k-line s1" />FinCom's cost</span><span><i className="k-line s2" />Charged to firms</span></div>
      <div className="ai-plot">
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`FinCom's cost and the amount charged to firms, by day, ${days.length} days`}
             onPointerMove={move} onPointerLeave={() => setAt(null)} tabIndex={0}
             onKeyDown={(e) => { if (e.key === "ArrowRight") setAt((a) => Math.min(days.length - 1, (a ?? -1) + 1)); if (e.key === "ArrowLeft") setAt((a) => Math.max(0, (a ?? days.length) - 1)); }}
             onBlur={() => setAt(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="ai-grid" x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} />
              <text className="ai-tick" x={PAD.l - 8} y={geo.y(t) + 4} textAnchor="end">{short(t)}</text>
            </g>
          ))}
          {days.map((d, i) => ((i % every === 0 && days.length - 1 - i >= every / 2) || i === days.length - 1) && (
            <text key={d.day} className="ai-tick" x={geo.x(i)} y={H - 8} textAnchor="middle">{dayLabel(d.day)}</text>
          ))}
          <path className="ai-line s1" d={geo.cost} />
          <path className="ai-line s2" d={geo.charged} />
          {days.length === 1 && <><circle className="ai-dot s1" cx={geo.x(0)} cy={geo.y(last.cost_paise)} r={4} /><circle className="ai-dot s2" cx={geo.x(0)} cy={geo.y(last.charged_paise)} r={4} /></>}
          {/* direct labels at the line ends */}
          <text className="ai-end" x={geo.x(days.length - 1) + 8} y={geo.y(last.cost_paise) + 4}>Cost</text>
          <text className="ai-end" x={geo.x(days.length - 1) + 8} y={geo.y(last.charged_paise) + (Math.abs(geo.y(last.charged_paise) - geo.y(last.cost_paise)) < 14 ? 16 : 4)}>Charged</text>
          {at !== null && (
            <g>
              <line className="ai-cross" x1={geo.x(at)} x2={geo.x(at)} y1={PAD.t} y2={H - PAD.b} />
              <circle className="ai-dot s1" cx={geo.x(at)} cy={geo.y(days[at].cost_paise)} r={4} />
              <circle className="ai-dot s2" cx={geo.x(at)} cy={geo.y(days[at].charged_paise)} r={4} />
            </g>
          )}
        </svg>
        {at !== null && (
          <div className="ai-tip" role="status" style={{ left: `clamp(0px, calc(${tipLeft}% - 6rem), calc(100% - 12rem))` }}>
            <div className="ai-tip-h">{dayLabel(days[at].day)} · {days[at].calls.toLocaleString("en-IN")} calls</div>
            <div><i className="k-line s1" /><b>{inr(days[at].cost_paise)}</b> FinCom's cost</div>
            <div><i className="k-line s2" /><b>{inr(days[at].charged_paise)}</b> charged</div>
          </div>
        )}
      </div>
    </figure>
  );
}

// one measure across categories: horizontal bars, the value at the end of each, the full row a hover target
export function BarList({ rows, label, value, sub, onRow, testid, empty = "Nothing in this range." }) {
  const [hover, setHover] = useState(null);
  if (!rows.length) return <p className="muted ai-empty">{empty}</p>;
  const max = Math.max(1, ...rows.map(value));
  return (
    <ul className="ai-bars" data-testid={testid}>
      {rows.map((r, i) => {
        const v = value(r), pct = Math.max(v > 0 ? 1 : 0, (v / max) * 100);
        const inner = (
          <>
            <span className="ai-bar-name">{label(r)}</span>
            <span className="ai-bar-track"><span className="ai-bar s1" style={{ width: pct + "%" }} /></span>
            <span className="ai-bar-val">{inr(v)}</span>
            {hover === i && sub && <span className="ai-bar-sub" role="status">{sub(r)}</span>}
          </>
        );
        return (
          <li key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            {onRow ? <button type="button" className="ai-bar-row" onClick={() => onRow(r)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>{inner}</button>
                   : <div className="ai-bar-row" tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}
