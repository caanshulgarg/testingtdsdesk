// The period of the statements (owner, 29-Oct-2026): the whole year, or a part of it. A preset (Full year, H1, a quarter,
// 9 months, Year to date) or Custom with its From and To: To within the year chosen beside it, From as early as the start
// of the year before (a period across 31 March, said so on the statements). For a part of the year, Compare with: the same
// period last year, or the last full year. Kept per client (FinSt.periodSet: b.fs.period, synced with the books). The P&L is
// for the period; the balance sheet is as on To.
import { useState, useEffect } from "react";

const iso = (ymd) => (ymd ? ymd.slice(0, 4) + "-" + ymd.slice(4, 6) + "-" + ymd.slice(6, 8) : "");
const ymd = (v) => String(v || "").replace(/-/g, "");

function DateIn({ label, value, min, max, onSet, attr }) {
  // a date is taken when it is whole (typing a year digit by digit does not redraw the statements each time)
  const [v, setV] = useState(iso(value));
  useEffect(() => { setV(iso(value)); }, [value]);
  return <label className="fin-pdate">{label}<input type="date" aria-label={label} value={v} min={iso(min)} max={iso(max)} {...{ [attr]: "" }}
    onChange={(ev) => { setV(ev.target.value); const y = ymd(ev.target.value); if (/^\d{8}$/.test(y) && y >= min && y <= max) onSet(y); }} /></label>;
}

export default function Period({ fy, per }) {
  const list = FinSt.periods(fy), cur = per.key;
  const pick = (k) => {
    if (k === "custom") FinSt.periodSet({ preset: "custom", from: per.from, to: per.to });
    else FinSt.periodSet({ preset: k });
    render();
  };
  const set = (which, y) => {
    const from = which === "from" ? y : per.from, to = which === "to" ? y : per.to;
    if (from > to) { toast("From must be on or before To."); return; }
    FinSt.periodSet({ preset: "custom", from, to }); render();
  };
  return <div className="fin-period" role="group" aria-label="Period" data-fin-period={cur} data-from={per.from} data-to={per.to}>
    <span>Period</span>
    <select aria-label="Period" data-fin-preset="" value={cur} onChange={(ev) => pick(ev.target.value)}>
      {list.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
    {cur === "custom" ? <>
      <DateIn label="From" value={per.from} min={String(+per.fy - 1) + "0401"} max={per.fyTo} attr="data-fin-from" onSet={(y) => set("from", y)} />
      <DateIn label="To" value={per.to} min={per.fyFrom} max={per.fyTo} attr="data-fin-to" onSet={(y) => set("to", y)} />
    </> : !per.full && <span className="fin-prange" data-fin-range="">{per.range}</span>}
    {!per.full && <label className="fin-pdate">Compare with<select aria-label="Compare with" data-fin-cmp="" value={per.cmp} onChange={(ev) => { FinSt.periodSet({ cmp: ev.target.value }); render(); }}>
      <option value="same">Same period last year</option><option value="fy">Last full year</option></select></label>}
  </div>;
}
