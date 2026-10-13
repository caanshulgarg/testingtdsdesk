// The bar above a table of the books' pages: find, choices, how many are shown, clear, print, Excel. The filter is
// kept in S[id] (S.r1F for GSTR-1, …) through setFilter / clearFilter (src/js/27). Was filterBar() (src/js/18).
// ui-tidy (13-Oct-2026): drawn by the one filter bar (Filters.jsx): period choices first (a select with slot "period"; a
// month is one), then the other choices, then find, then Clear, with the count, Print and Excel at the end.
import Button from "./Button.jsx";
import Filters, { Search } from "./Filters.jsx";
import More from "./More.jsx";

// the choices of a bar in its slots; each option already says what it is ("PAN: any"), so the box has no name of its own
export function barSelects(selects, value, set) {
  const one = (sel) => <span key={sel.key} className="fb-f fb-bare"><select aria-label={sel.label || sel.key} value={value[sel.key] || ""} onChange={(ev) => set(sel.key, ev.target.value)}>
    {sel.options.map(([v, l], i) => <option key={i} value={v}>{l}</option>)}</select></span>;
  const isPeriod = (sel) => sel.slot === "period" || (!sel.slot && /^(month|quarter|year|fy|period)$/.test(sel.key));
  const period = selects.filter(isPeriod), rest = selects.filter((s) => !isPeriod(s));
  return { period: period.length ? period.map(one) : null, type: rest.length ? rest.map(one) : null };
}

export default function FilterBar({ id, placeholder = "Find", table, title, excel, count, selects = [] }) {
  const f = S[id] || {};
  const { period, type } = barSelects(selects, f, (k, v) => setFilter(id, k, v));
  return <Filters className="revfilter" label={title ? "Filter " + title : "Filters"} period={period} type={type}
    search={<Search value={f.q} placeholder={placeholder} data-fk={id + "q"} onChange={(v) => setFilter(id, "q", v, true)} />}
    onClear={() => clearFilter(id)} active={Object.keys(f).some((k) => f[k])} count={count || ""}
    tools={<More label="Export" data-fb-out="" items={[["Print or save as PDF", () => printTable(table, title)], excel && ["Excel", () => doAct(excel)]]} />} />;
}
