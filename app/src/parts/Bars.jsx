// A small chart of a few series over the same labels: series [{name, cls, values}], label (what it shows); nothing when
// every value is nil. Was FC.bars (src/js/44), used on Reports, Look up and Letters. Drawn by Arc's charts
// (src/arc/registry/components): months as a line chart (Arc's LineChart, one straight line a series: a smooth curve would dip below nil between months), anything else (the
// ageing buckets) as one bar chart a series (Arc's BarChart, which draws one measure). The colours are FinCom's, by
// the series' class (c1 the brand, c2 blue, c3 amber, c4 grey, c5 green), as before.
import { LineChart } from "@/registry/components/line-chart/line-chart";
import { BarChart } from "@/registry/components/bar-chart/bar-chart";

const COLOUR = { c1: "var(--brand)", c2: "var(--info)", c3: "var(--warn)", c4: "var(--muted)", c5: "var(--ok)" };
const MONTH = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/;
const rupees = (v) => "₹" + INR.format(v);
// the value axis in Indian units: 80K, 4L, 1.2Cr
const one = (v) => String(Math.round(v * 10) / 10);
const tick = (v) => { const a = Math.abs(v); return a >= 1e7 ? one(v / 1e7) + "Cr" : a >= 1e5 ? one(v / 1e5) + "L" : a >= 1e3 ? one(v / 1e3) + "K" : String(Math.round(v)); };

export default function Bars({ labels, series, h = 120, label }) {
  const all = series.flatMap((s) => s.values.map((v) => num(v)));
  if (!all.some((v) => Math.abs(v) >= 0.5)) return null;
  const months = labels.length > 1 && labels.every((l) => MONTH.test(String(l)));
  if (months) {
    const lines = series.map((s, j) => ({ key: "s" + j, label: s.name, color: COLOUR[s.cls || "c1"], area: j === 0 }));
    const data = labels.map((l, i) => ({ key: i + ":" + l, label: String(l), axisLabel: String(l).slice(0, 3),
      values: Object.fromEntries(series.map((s, j) => ["s" + j, num(s.values[i])])) }));
    return <figure className="fc-chart arc-chart" aria-label={label}>
      <LineChart data={data} series={lines} label={label || "Chart"} height={Math.max(150, h + 40)} categoryLabel="Month"
        formatValue={(v) => rupees(v)} formatTick={tick} legend={series.length > 1} curve="linear" />
    </figure>;
  }
  // categories (the ageing buckets): one small bar chart a series, side by side
  return <figure className="fc-chart arc-chart arc-chart-multi" aria-label={label}>
    {series.map((s, j) => <div key={j} className="arc-chart-one" style={{ "--series-1": COLOUR[s.cls || "c1"], "--accent": COLOUR[s.cls || "c1"] }}>
      <BarChart data={labels.map((l, i) => ({ key: i + ":" + l, label: String(l), axisLabel: String(l).slice(0, 8), value: Math.max(0, num(s.values[i])) }))}
        label={s.name} period={s.name} averageLabel="Average" valueLabel={s.name} categoryLabel="Days" showAverage={false}
        height={Math.max(120, h)} formatValue={(v) => rupees(v)} />
    </div>)}
  </figure>;
}
