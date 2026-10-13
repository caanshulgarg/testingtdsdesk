// The one filter bar of every list page (ui-tidy, 13-Oct-2026; the owner: "filters and columns are also uneven"): the same
// height, spacing and look everywhere, its parts always in one order:
//   period (year, quarter, month, dates) · type and status · client (or GSTIN) · search · Clear
// then, apart at the end of the row, how many are shown and the page's tools (Print, Excel). Each part is a box of the one
// height (36 px) with its name inside it, so a bar is one row on a computer and wraps neatly, two to a line, on a phone.
//   <Filters period={<Field label="Year"><select …/></Field>} type={…} client={…} search={<Search …/>} onClear={…} active={…} />
// A page passes only the parts it has; their order cannot be changed (the slots are fixed).
export function Field({ label, children, grow = false, className = "", ...rest }) {
  return <label className={"fb-f" + (grow ? " fb-grow" : "") + (className ? " " + className : "")} {...rest}><span className="fb-l">{label}</span>{children}</label>;
}

export function Search({ value, onChange, placeholder = "Find", label, ...rest }) {
  return <span className="fb-search"><input type="search" value={value || ""} placeholder={placeholder} aria-label={label || placeholder} onChange={(ev) => onChange(ev.target.value, ev)} {...rest} /></span>;
}

const SLOTS = ["period", "type", "client", "search"];

export default function Filters({ period, type, client, search, onClear, active = false, count, tools, label = "Filters", className = "", ...rest }) {
  const parts = { period, type, client, search };
  return <div className={("fbar " + className).trim()} role="group" aria-label={label} data-filter-bar="" {...rest}>
    {SLOTS.map((s) => parts[s] ? <span key={s} className="fb-slot" data-fb-slot={s}>{parts[s]}</span> : null)}
    {onClear && <span className="fb-slot" data-fb-slot="clear"><button type="button" className="btn small fb-clear" data-fb-clear="" data-idle={active ? undefined : ""} title={active ? "Show everything again" : "No filter is set"} onClick={onClear}>Clear filters</button></span>}
    {(count || tools) && <span className="fb-end">{count ? <span className="note fb-count">{count}</span> : null}{tools}</span>}
  </div>;
}
