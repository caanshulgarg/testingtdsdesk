// A small bar chart, drawn as SVG: series [{name, cls, values}], one bar group per label; nothing when every value is
// nil. Was FC.bars (src/js/44), used on Reports, Look up and Letters.
export default function Bars({ labels, series, h = 120, label }) {
  const H = h, W = Math.max(280, labels.length * (series.length * 12 + 10)), pad = 4;
  const all = series.flatMap((s) => s.values.map((v) => num(v)));
  if (!all.some((v) => Math.abs(v) >= 0.5)) return null;
  const max = Math.max(1, ...all.map((v) => Math.abs(v))), neg = all.some((v) => v < 0);
  const zero = neg ? H / 2 : H - 2, scale = (neg ? H / 2 - 6 : H - 8) / max, gw = (W - pad * 2) / Math.max(1, labels.length), bw = Math.max(3, Math.min(22, (gw - 6) / series.length));
  const every = Math.ceil(labels.length / 12);
  return <figure className="fc-chart" aria-label={label}>
    <svg viewBox={"0 0 " + W + " " + H} preserveAspectRatio="none" role="img">
      {labels.flatMap((l, i) => series.map((s, j) => { const v = num(s.values[i]), hgt = Math.max(v ? 1.5 : 0, Math.abs(v) * scale), x = pad + i * gw + (gw - bw * series.length) / 2 + j * bw;
        return <rect key={i + ":" + j} className={(s.cls || "c1") + (v < 0 ? " neg" : "")} x={x.toFixed(1)} y={(v >= 0 ? zero - hgt : zero).toFixed(1)} width={(bw - 1.5).toFixed(1)} height={hgt.toFixed(1)} rx="2"><title>{l + ": " + s.name + " " + INR.format(v)}</title></rect>; }))}
      <line x1="0" x2={W} y1={zero.toFixed(1)} y2={zero.toFixed(1)} className="axis" />
    </svg>
    <div className="fc-xl" aria-hidden="true">{labels.map((l, i) => <span key={i}>{i % every === 0 ? String(l).slice(0, 8) : ""}</span>)}</div>
    {series.length > 1 && <div className="chart-key">{series.map((s, i) => <span key={i}><i className={s.cls || "c1"}></i>{s.name}</span>)}</div>}
  </figure>;
}
