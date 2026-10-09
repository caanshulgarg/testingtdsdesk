// The bar above a table of the books' pages: find, choices, how many are shown, clear, print, Excel. The filter is
// kept in S[id] (S.r1F for GSTR-1, …) through setFilter / clearFilter (src/js/27). Was filterBar() (src/js/18).
import Button from "./Button.jsx";
export default function FilterBar({ id, placeholder = "Find", table, title, excel, count, selects = [] }) {
  const f = S[id] || {};
  return (
    <div className="revfilter">
      <input type="search" value={f.q || ""} placeholder={placeholder} aria-label={placeholder} data-fk={id + "q"} onChange={(ev) => setFilter(id, "q", ev.target.value, true)} />
      {selects.map((sel) => (
        <select key={sel.key} aria-label={sel.label || sel.key} value={f[sel.key] || ""} onChange={(ev) => setFilter(id, sel.key, ev.target.value)}>
          {sel.options.map(([v, l], i) => <option key={i} value={v}>{l}</option>)}
        </select>))}
      <span className="note">{count || ""}</span>
      {Object.keys(f).some((k) => f[k]) && <button className="linkbtn" onClick={() => clearFilter(id)}>Clear</button>}
      <Button className="btn small" onClick={() => printTable(table, title)}>Print or save as PDF</Button>
      {excel && <Button className="btn small" onClick={() => doAct(excel)}>Excel</Button>}
    </div>
  );
}
