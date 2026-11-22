// "Tables everywhere" (the owner, 22-Nov-2026): ONE table part whose every column heading has its own filter, as the
// app's list table already does (app/src/parts/ListTable.jsx + ColFilterPop.jsx + colFilter.js), made complete per
// column type. A heading: its label (click = sort, ▲/▼), a funnel (filled while its filter is on). The funnel opens the
// column's filter under the heading; on a phone the same filter opens as a sheet from the bottom. Status chips above a
// table only set the Status column's filter. Saved views keep the column filters. Made-up values (design proposal).
import { Search, X, ArrowUpDown } from "lucide-react";

const FUNNEL = (on) => <svg width="12" height="12" viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={on ? 0 : 2.2} aria-hidden="true"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5z" /></svg>;

// a heading: label, sort arrow, funnel; pop: the open filter (drawn under the heading); right: an amount column
export function Th({ children, r, on, sort, pop, popRight, nof, cls }) {
  return <th className={["p-th", r && "p-r", on && "p-thon", cls].filter(Boolean).join(" ")}>
    <span className="p-thi">{children}{sort && <span className="p-sorta">{sort === "desc" ? "▼" : "▲"}</span>}
      {!nof && <button className="p-funnel" data-on={on ? "" : undefined} data-open={pop ? "" : undefined} aria-label={"Filter " + children}>{FUNNEL(on)}</button>}</span>
    {pop && <div className={"p-fpop" + (popRight ? " p-fpop-r" : "")}>{pop}</div>}</th>;
}

// what every filter box has: the column's name, sorting, the column-type body, blank / not blank, Clear and Apply
function Box({ title, sortW, children, n, blanks = true }) {
  return <div className="p-fbox" role="dialog" aria-label={"Filter " + title}>
    <div className="p-fbox-h"><b>{title}</b><button className="p-icon p-sm-ic" aria-label="Close"><X size={14} /></button></div>
    <div className="p-fsort"><ArrowUpDown size={13} /><button aria-pressed="false">{sortW[0]}</button><button aria-pressed="false">{sortW[1]}</button></div>
    {children}
    {blanks && <div className="p-fblank"><span>Show</span><span className="p-seg"><button aria-pressed="true">All</button><button>Blank</button><button>Not blank</button></span></div>}
    <div className="p-fbox-f"><span className="p-quiet">{n}</span><span className="p-grow" /><button className="p-btn p-sm p-ghost">Clear</button><button className="p-btn p-sm p-primary">Apply</button></div>
  </div>;
}

// ledger / party: a searchable tick list of every value in the column (the whole list, not only the rows shown), with counts
export function ListFilter({ title, items, n, ph }) {
  return <Box title={title} sortW={["A → Z", "Z → A"]} n={n} blanks={false}>
    <div className="p-fcond"><span className="p-input p-sm-in p-fsel">Is one of ▾</span></div>
    <span className="p-input p-sm-in p-fsearch"><Search size={13} />{ph}</span>
    <label className="p-fitem p-fall"><input type="checkbox" readOnly checked={false} />Select all shown<small /></label>
    <div className="p-flist">{items.map(([w, c, on, blank]) => <label key={w} className="p-fitem"><input type="checkbox" readOnly checked={!!on} /><span className={blank ? "p-dimw" : undefined}>{w}</span><small>{c}</small></label>)}</div>
  </Box>;
}
// text: contains / equals / starts with / does not contain, words (a comma = or), and the values when there are few
export function TextFilter({ title, items, n }) {
  return <Box title={title} sortW={["A → Z", "Z → A"]} n={n}>
    <div className="p-fcond"><span className="p-input p-sm-in p-fsel">Contains ▾</span><span className="p-input p-sm-in">GUPTA, SWIFT</span></div>
    <small className="p-fhint">Equals · Starts with · Does not contain. A comma means “or”.</small>
    {items && <div className="p-flist">{items.map(([w, c, on]) => <label key={w} className="p-fitem"><input type="checkbox" readOnly checked={!!on} /><span>{w}</span><small>{c}</small></label>)}</div>}
  </Box>;
}
// amount: between, equals, more than, less than; Dr / Cr read as written
export function AmountFilter({ title, n }) {
  return <Box title={title} sortW={["Small → large", "Large → small"]} n={n}>
    <span className="p-seg p-fops"><button aria-pressed="true">Between</button><button>=</button><button>More than</button><button>Less than</button></span>
    <div className="p-frange"><label>From<span className="p-input p-sm-in">₹ 10,000</span></label><label>To<span className="p-input p-sm-in">₹ 5,00,000</span></label></div>
    <div className="p-fquick"><button>Over ₹1 L</button><button>Under ₹5,000</button><button>Round thousands</button></div>
  </Box>;
}
// date: quick ranges (the year runs April to March), a month of the FY, a quarter, or from–to
export function DateFilter({ title, n }) {
  const M = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"];
  return <Box title={title} sortW={["Old → new", "New → old"]} n={n}>
    <div className="p-fquick"><button aria-pressed="true">This month</button><button>Last month</button><button>Q3 (Oct–Dec)</button><button>FY 2026-27</button></div>
    <div className="p-fmonths"><span className="p-quiet">FY 2026-27</span><div>{M.map((m, i) => <button key={m} aria-pressed={i === 7 ? "true" : "false"} disabled={i > 7}>{m}</button>)}</div>
      <div className="p-fqs">{["Q1", "Q2", "Q3", "Q4"].map((q, i) => <button key={q} disabled={i > 2}>{q}</button>)}</div></div>
    <div className="p-frange"><label>From<span className="p-input p-sm-in">01-Nov-2026</span></label><label>To<span className="p-input p-sm-in">21-Nov-2026</span></label></div>
  </Box>;
}
// status: the five words, ticked
export function StatusFilter({ items, n }) {
  return <Box title="Status" sortW={["A → Z", "Z → A"]} n={n} blanks={false}>
    <div className="p-flist">{items.map(([w, c, on]) => <label key={w} className="p-fitem"><input type="checkbox" readOnly checked={!!on} /><span>{w}</span><small>{c}</small></label>)}</div>
  </Box>;
}

// on a phone: each column's filter as a chip in one sideways row; one opens as a sheet from the bottom
export function PhoneFilterChips({ cols }) {
  return <div className="p-pfchips">{cols.map(([w, on]) => <button key={w} className="p-pfchip" data-on={on ? "" : undefined}>{w}{on && <i />} ▾</button>)}</div>;
}
export function Sheet({ children }) {
  return <div className="p-scrim p-scrim-b"><div className="p-sheet"><span className="p-grab" />{children}</div></div>;
}
