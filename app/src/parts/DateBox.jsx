// A date box in FinCom's date format (the earlier finding: a browser's own date box shows the computer's format, such
// as 10/01/2026). It shows 01-Oct-2026, takes a date typed as 01-Oct-2026, 01-10-2026, 01/10/2026, 01102026 or
// 2026-10-01, and has Arc's calendar (src/arc/registry/components/calendar, the calendar of Arc's date picker) behind
// its button, with today in India's time (IST).
//
// It takes what <input type="date"> takes, so a screen swaps one for the other and nothing else changes: the value is
// yyyy-mm-dd (value, or defaultValue), onChange gets {target: {value}} with the new yyyy-mm-dd date ("" when emptied),
// and aria-label, min, max, disabled, readOnly, data-* stay on the box (inputClassName is the box's own class). onCommit(value) is CommitBox's way (a false answer puts
// the old date back). A screen is told only of a whole date, never of one half-typed.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/registry/components/calendar/calendar";
import arc from "@/registry/components/date-picker/date-picker.module.css";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => {
  const dt = new Date(y, m - 1, d);
  return y >= 1900 && y <= 2200 && dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? y + "-" + pad(m) + "-" + pad(d) : null;
};
// yyyy-mm-dd -> 01-Oct-2026 (FinCom's one date format, as fmtDate in src/js/01)
export function showDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? m[3] + "-" + MON[+m[2] - 1] + "-" + m[1] : "";
}
// what was typed -> yyyy-mm-dd, or null when it is not (yet) a whole date. Day first, as in India; a year in 4 digits.
export function readDate(text) {
  const t = String(text || "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/. ]([A-Za-z]{3})[a-z]*[-/. ,]+(\d{4})$/.exec(t);
  if (m) { const k = MON.findIndex((x) => x.toLowerCase() === m[2].toLowerCase()); return k < 0 ? null : isoOf(+m[3], k + 1, +m[1]); }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return isoOf(+m[3], +m[2], +m[1]);
  m = /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (m) return isoOf(+m[3], +m[2], +m[1]);
  return null;
}
const toDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : undefined; };
const fromDate = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

export default function DateBox({ value, defaultValue, onChange, onCommit, min, max, disabled, className = "", inputClassName, style, onKeyDown, onBlur, ...rest }) {
  const [own, setOwn] = useState(defaultValue || "");
  const iso = value !== undefined ? value || "" : own;
  const [text, setText] = useState(null);            // what is being typed; null = show the date
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => toDate(iso) || new Date());
  const [at, setAt] = useState(null);
  const box = useRef(null), pop = useRef(null);
  const label = rest["aria-label"] || "Date";

  // a new date, from typing or the calendar: told to the screen once
  const fire = (next) => {
    if (next === iso) return true;
    if (onCommit && onCommit(next) === false) { setText(null); return false; }
    if (value === undefined) setOwn(next);
    if (onChange) onChange({ target: { value: next }, currentTarget: { value: next } });
    return true;
  };
  const typed = (t) => { setText(t); const d = readDate(t); if (d) fire(d); };
  const leave = (ev) => {
    if (text !== null && !String(text).trim() && iso) fire("");
    setText(null);
    if (onBlur) onBlur(ev);
  };

  // the calendar under the box (over it when there is no room below), in the page's top layer so a table's scrolling
  // box never cuts it off
  const place = () => {
    const r = box.current && box.current.getBoundingClientRect(); if (!r) return;
    const h = 380, below = window.innerHeight - r.bottom > h || r.top < h;
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 336)), top: below ? r.bottom + 6 : Math.max(8, r.top - h - 6) });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const out = (ev) => { if (!pop.current || pop.current.contains(ev.target) || (box.current && box.current.parentElement.contains(ev.target))) return; setOpen(false); };
    const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); setOpen(false); box.current && box.current.focus(); } };
    const move = () => place();
    document.addEventListener("pointerdown", out, true); document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", move, true); window.addEventListener("resize", move);
    return () => { document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", key, true); window.removeEventListener("scroll", move, true); window.removeEventListener("resize", move); };
  }, [open]);

  const show = () => { setMonth(toDate(iso) || new Date()); setOpen(!open); };
  return <span className={("datebox " + className).trim()} style={style} data-datebox="">
    <input ref={box} type="text" inputMode="numeric" autoComplete="off" placeholder="DD-Mon-YYYY" spellCheck={false} {...rest}
      disabled={disabled} className={inputClassName} data-iso={iso || undefined} value={text !== null ? text : showDate(iso)}
      onChange={(ev) => typed(ev.target.value)} onBlur={leave}
      onKeyDown={(ev) => { if (ev.key === "Enter" && text !== null) { const d = readDate(text); if (d) fire(d); setText(null); } if (ev.key === "ArrowDown" && ev.altKey) { ev.preventDefault(); show(); } if (onKeyDown) onKeyDown(ev); }} />
    <button type="button" className="datebox-cal" aria-label={"Choose " + label + " on a calendar"} aria-haspopup="dialog" aria-expanded={open} disabled={disabled || rest.readOnly} onClick={show}>
      <CalendarDays size={15} strokeWidth={1.75} aria-hidden="true" />
    </button>
    {open && at && createPortal(<div ref={pop} className={arc.popover + " datebox-pop"} role="dialog" aria-label={label + ": calendar"} style={{ position: "fixed", top: at.top, left: at.left }}>
      <Calendar value={toDate(iso)} month={month} onMonthChange={setMonth} minDate={toDate(min)} maxDate={toDate(max)} locale="en-GB" showToday
        onChange={(d) => { fire(fromDate(d)); setText(null); setOpen(false); box.current && box.current.focus(); }} />
      <div className={arc.footer}><button type="button" onClick={() => { fire(""); setOpen(false); }} disabled={!iso}>Clear</button><span>{iso ? showDate(iso) : "Choose a day"}</span></div>
    </div>, document.body)}
  </span>;
}
