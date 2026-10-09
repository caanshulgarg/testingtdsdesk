// A period: From and To date boxes (DateBox, in 01-Oct-2026) and Arc's date range picker
// (src/arc/registry/components/date-range-picker) to choose both on a calendar, with the periods an accountant uses
// (this month, last month, this quarter, this and last financial year, April to March). Each box keeps its own name
// (fromLabel / toLabel, as the screen's boxes had), and onFrom / onTo get yyyy-mm-dd as a box's onChange did, so the
// screen's own way of setting its period is unchanged. A range picked on the calendar sets From, then To.
import DateBox, { showDate } from "./DateBox.jsx";
import { DateRangePicker } from "@/registry/components/date-range-picker/date-range-picker";

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const dateOf = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const fyStart = (t) => new Date(t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1, 3, 1);
const qStart = (t) => new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1);
export const FY_PRESETS = [
  { label: "This month", range: (t) => ({ start: new Date(t.getFullYear(), t.getMonth(), 1), end: t }) },
  { label: "Last month", range: (t) => ({ start: new Date(t.getFullYear(), t.getMonth() - 1, 1), end: new Date(t.getFullYear(), t.getMonth(), 0) }) },
  { label: "This quarter", range: (t) => ({ start: qStart(t), end: t }) },
  { label: "Last quarter", range: (t) => { const s = qStart(t); return { start: new Date(s.getFullYear(), s.getMonth() - 3, 1), end: new Date(s.getFullYear(), s.getMonth(), 0) }; } },
  { label: "This financial year", range: (t) => ({ start: fyStart(t), end: t }) },
  { label: "Last financial year", range: (t) => { const s = fyStart(t); return { start: new Date(s.getFullYear() - 1, 3, 1), end: new Date(s.getFullYear(), 2, 31) }; } },
];

export default function DateRange({ from, to, onFrom, onTo, fromLabel = "From", toLabel = "To", fromText = "From", toText = "To", calendarLabel = "Period", keyed, className = "" }) {
  const a = dateOf(from), b = dateOf(to);
  const pick = (r) => { if (!r) return; onFrom(isoOf(r.start)); onTo(isoOf(r.end)); };
  return <div className={("daterange " + className).trim()} data-daterange="">
    <label className="f"><span>{fromText}</span><DateBox aria-label={fromLabel} key={keyed ? "f" + from : undefined} value={from || ""} onChange={(ev) => onFrom(ev.target.value)} /></label>
    <label className="f"><span>{toText}</span><DateBox aria-label={toLabel} key={keyed ? "t" + to : undefined} value={to || ""} onChange={(ev) => onTo(ev.target.value)} /></label>
    <div className="daterange-pick"><DateRangePicker label={calendarLabel} value={a && b ? { start: a, end: b } : null} onChange={pick}
      presets={FY_PRESETS} weekStartsOn={1} locale="en-GB" formatDate={(d) => showDate(isoOf(d))} /></div>
  </div>;
}
