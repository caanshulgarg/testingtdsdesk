// The one table for every list (the owner's spec K6, round 2 of 04-Oct-2026). Each list hands over its columns and its
// rows; this part does the rest the same way everywhere:
//  - the columns in one order: date, number, party, amount, status (those a list has data for), then the rest; a tick
//    box column first and the buttons last. A column says what it is with `role`; the order follows from it, so a page
//    cannot put them in another order by mistake;
//  - a click on a header sorts by it (up, then down), with an arrow on the column sorted by; kept per list in
//    S.listSort[name] for as long as the page is open;
//  - the header stays in view while the rows scroll (the box around the table scrolls, the header is sticky);
//  - the foot: how many rows ("3 bills", "3 of 10 bills" when filtered) and the totals of the amount columns;
//  - an empty list: what to do next, in the caller's words (`empty`);
//  - while the rows load: the header and grey bars with "Loading…" (`loading`), never a blank area.
//
// A column: {k, label, role: "pick" (a tick box) | "row" (S. no.) | "date" | "number" | "party" | "amount" | "status" | "act" | undefined (the rest),
//   cls (the cell's class: "n" right-aligns), cell(row, prep, i) → what the cell shows, v(row) → the value it sorts by
//   (and adds up), sort: false (no sorting), sum: true | fn(row) → the foot total (amount columns add up by default),
//   fmt(total) → how a total is shown (money by default), head: what the header shows instead of a sort button
//   (the tick box), filter: the column's filter button (ColFunnel), td(row) → more attributes for the cell, title,
//   w: its width in % for a table laid out fixed}.
import { Children, Fragment, cloneElement, isValidElement } from "react";
import Loading from "./Loading.jsx";

const RANK = { pick: 0, row: 0, date: 1, number: 2, party: 3, amount: 4, status: 5, act: 7 };
const rank = (c) => (c.role in RANK ? RANK[c.role] : 6);
export const LIST_ORDER = ["date", "number", "party", "amount", "status"];

// the columns in the one order; within a role (two amounts) as given
export function orderCols(cols) {
  return cols.filter(Boolean).map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

const blank = (v) => v === null || v === undefined || v === "" || (typeof v === "number" && isNaN(v));
// numbers as numbers, words and numbers in words naturally (INV-9 before INV-12), dates as yyyy-mm-dd; blanks last
export function cmp(a, b) {
  if (blank(a) || blank(b)) return blank(a) ? (blank(b) ? 0 : 1) : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

export const sortOf = (name) => (S.listSort && S.listSort[name]) || null;
// the rows in the order the viewer chose (as given when none); blanks stay last also when sorting down
export function sortRows(name, cols, rows) {
  const s = sortOf(name), c = s && cols.find((x) => x && x.k === s.k);
  if (!c || !c.v) return rows;
  const d = s.dir === "desc" ? -1 : 1;
  return rows.map((r, i) => [r, c.v(r), i]).sort((a, b) => {
    if (blank(a[1]) || blank(b[1])) return cmp(a[1], b[1]) || a[2] - b[2];
    return d * cmp(a[1], b[1]) || a[2] - b[2];
  }).map((x) => x[0]);
}
export function setSort(name, k) {
  S.listSort = S.listSort || {};
  const s = S.listSort[name];
  S.listSort[name] = { k, dir: s && s.k === k && s.dir === "asc" ? "desc" : "asc" };
  render();
}

const sortable = (c) => !!c.v && c.sort !== false && !["pick", "row", "act"].includes(c.role);
const sumOf = (c) => (c.sum === false ? null : typeof c.sum === "function" ? c.sum : c.sum || c.role === "amount" ? c.v : null);
const sortVal = (v) => (blank(v) ? undefined : typeof v === "number" ? String(v) : String(v));

function Head({ name, c, s, via }) {
  const on = s && s.k === c.k, arrow = on ? (s.dir === "desc" ? "▼" : "▲") : "";
  const label = <span className="gfl">{c.label}</span>;
  const inner = c.head !== undefined ? c.head
    : sortable(c) ? <button type="button" className="lt-sort" title={"Sort by " + String(c.label || "").toLowerCase()} onClick={() => (via ? via(c.k) : setSort(name, c.k))}>{label}<span className="lt-ar" aria-hidden="true">{arrow}</span></button>
    : label;
  return <th className={[c.cls, c.thCls].filter(Boolean).join(" ") || undefined} data-role={c.role || ""} title={c.title}
    aria-sort={on ? (s.dir === "desc" ? "descending" : "ascending") : sortable(c) ? "none" : undefined}>
    {c.filter ? <span className="colh">{inner}{c.filter}</span> : inner}
  </th>;
}

// the foot: the count over the first columns, then each total under its column
function Foot({ cols, rows, unit, of }) {
  const [one, many] = unit, n = rows.length;
  const count = <><b>{n + " " + (n === 1 ? one : many)}</b>{of != null && of !== n ? " of " + of : ""}</>;
  const cells = [];
  let placed = false;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i], f = sumOf(c);
    if (f) {
      const t = r2(rows.reduce((a, r) => a + num(f(r)), 0));
      cells.push(<td key={c.k} className={c.cls}><b>{c.fmt ? c.fmt(t) : money(t)}</b></td>);
      continue;
    }
    if (!placed && c.role !== "pick") {
      let j = i + 1; while (j < cols.length && !sumOf(cols[j])) j++;
      cells.push(<td key={c.k} colSpan={j - i} className="lt-count">{count}</td>);
      placed = true; i = j - 1; continue;
    }
    cells.push(<td key={c.k}></td>);
  }
  return <tfoot data-list-foot=""><tr>{cells}</tr></tfoot>;
}

export function ListWrap({ children, className }) {
  return <div className={"bk-tablewrap lt-wrap" + (className ? " " + className : "")}>{children}</div>;
}

export default function ListTable({ name, cols, rows, rowKey, rowProps, prep, unit = ["entry", "entries"], of, empty, loading, limit, more,
  className = "bk-table", wrap, style, foot = true, id, after, tail, sortVia }) {
  // sortVia: {state: {k, dir}, by(k)}: a list whose order is kept elsewhere (the rows come in sorted); the headers and
  // arrows are the same
  const cs = orderCols(cols), s = sortOf(name);
  const Wrap = wrap || ListWrap;
  if (loading) return <Loading what={typeof loading === "string" ? loading : unit[1]} rows={4} cols={cs.length} />;
  if (!rows.length) return empty === null ? null : <div className="bk-none lt-empty" data-list-empty="">{empty || "Nothing here yet."}</div>;
  const all = sortVia ? rows : sortRows(name, cs, rows), shown = limit ? all.slice(0, limit) : all;
  return <>
    <Wrap>
      <table className={className + " lt"} data-list={name} style={style} id={id}>
        {cs.some((c) => c.w) && <colgroup>{cs.map((c) => <col key={c.k} style={c.w ? { width: c.w + "%" } : undefined} />)}</colgroup>}
        <thead><tr>{cs.map((c) => <Head key={c.k} name={name} c={c} s={sortVia ? sortVia.state : s} via={sortVia && sortVia.by} />)}</tr></thead>
        <tbody>{shown.map((r, i) => {
          const p = prep ? prep(r) : undefined, rp = rowProps ? rowProps(r, p) : {}, k = rowKey ? rowKey(r, i) : i;
          const tr = <tr key={k} {...rp}>{cs.map((c) => {
            const { className: ec, ...extra } = (c.td && c.td(r, p)) || {};
            return <td key={c.k} {...extra} className={[c.cls, ec].filter(Boolean).join(" ") || undefined} data-sort={sortable(c) ? sortVal(c.v(r)) : undefined}>{c.cell(r, p, i)}</td>;
          })}</tr>;
          // a row opened under its row (a challan's deductions): one cell across the table
          const open = after && after(r, p);
          return open ? [tr, <tr key={k + ":open"} className="lt-open"><td colSpan={cs.length} style={{ background: "var(--paper)", padding: 0 }}>{open}</td></tr>] : tr;
        })}{tail}</tbody>
        {foot && <Foot cols={cs} rows={all} unit={unit} of={of} />}
      </table>
    </Wrap>
    {limit && all.length > shown.length ? more : null}
  </>;
}

// ---- the same list table for rows already drawn as <tr><td>…</td></tr> (the analysis pages' tables: Filed vs books,
// Look up, Audit, MIS). `head` names each column ({label, role, cls, sum}); the cells are put in the one order, the
// rows sort by what a cell says (a date as 04-Oct-2026, an amount as 1,25,000.00 or "1,250.00 Dr", else the words),
// and the foot counts them and adds up the amount columns. A row with a different number of cells (an opened detail
// under a row) stays under the row before it.

export function textOf(n) {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (!isValidElement(n) || !n.props) return "";
  // a box says what is chosen or typed in it, not every choice it offers
  if (n.type === "select" || n.type === "input" || n.type === "textarea") return String(n.props.value != null ? n.props.value : n.props.defaultValue != null ? n.props.defaultValue : "");
  return textOf(n.props.children);
}
const flatKids = (ch) => { const out = []; Children.forEach(ch, (c) => { if (c == null || c === false || c === true || c === "") return; if (isValidElement(c) && c.type === Fragment) out.push(...flatKids(c.props.children)); else out.push(c); }); return out; };
// what a cell says, as something to sort by and add up
export function cellValue(t) {
  const s = String(t || "").split("\n")[0].trim();
  if (!s || s === "—") return "";
  let m = s.match(/^(\d{2})-([A-Z][a-z]{2})-(\d{4})/);
  if (m && typeof MONTHS3 !== "undefined" && MONTHS3.indexOf(m[2]) >= 0) return m[3] + "-" + String(MONTHS3.indexOf(m[2]) + 1).padStart(2, "0") + "-" + m[1];
  m = s.replace(/[₹,\s]/g, "").match(/^([-−–]?)(\d+(?:\.\d+)?)(Dr|Cr)?$/);
  if (m) return (m[1] || m[3] === "Cr" ? -1 : 1) * Number(m[2]);
  return s.toLowerCase();
}
export function ListRows({ name, head, children, unit = ["entry", "entries"], of, empty, className = "bk-table", id, limit, more, skipSum }) {
  const hs = head.filter(Boolean).map((h, i) => ({ k: "c" + i, i, ...h, v: true }));
  const order = orderCols(hs), s = sortOf(name);
  // the rows, each with the detail rows drawn under it
  const rows = [];
  const tail = [];
  flatKids(children).forEach((tr) => {
    if (!isValidElement(tr)) return;
    // a totals row drawn by the page goes last (the foot has the count and the totals too)
    if (/\b(lk-tot|tot|gf-sum)\b/.test(String(tr.props.className || ""))) { tail.push(tr); return; }
    const cells = flatKids(tr.props.children).filter(isValidElement);
    if (cells.length === hs.length && !cells.some((c) => c.props && c.props.colSpan > 1)) rows.push({ tr, cells, vals: cells.map((c) => cellValue(textOf(c.props.children))), under: [] });
    else if (rows.length) rows[rows.length - 1].under.push(tr);
    else rows.push({ tr, cells: null, under: [] });
  });
  const data = rows.filter((r) => r.cells), loose = rows.filter((r) => !r.cells);
  if (!data.length && !loose.length) return empty === null ? null : <div className="bk-none lt-empty" data-list-empty="">{empty || "Nothing here yet."}</div>;
  const sorted = s ? sortRows(name, order.map((c) => ({ ...c, v: (r) => r.vals[c.i] })), data) : data;
  const shown = limit ? sorted.slice(0, limit) : sorted;
  const sumCols = order.filter((c) => c.sum !== false && (c.sum || c.role === "amount"));
  return <>
    <ListWrap>
      <table className={className + " lt"} data-list={name} id={id}>
        <thead><tr>{order.map((c) => <Head key={c.k} name={name} c={{ ...c, v: c.sort === false || ["pick", "row", "act"].includes(c.role) ? null : () => 0 }} s={s} />)}</tr></thead>
        <tbody>
          {loose.map((r, i) => cloneElement(r.tr, { key: "loose" + i }))}
          {shown.map((r, n) => {
            // the row itself (a <tr>, or a part that draws one, such as an entry that opens) with its cells in the one order
            const k = r.tr.key != null ? r.tr.key : n;
            return [cloneElement(r.tr, { key: k }, ...order.map((c) => cloneElement(r.cells[c.i], { key: c.k, "data-sort": typeof r.vals[c.i] === "number" ? String(r.vals[c.i]) : r.vals[c.i] || undefined }))),
              ...r.under.map((u, j) => cloneElement(u, { key: k + ":u" + j }))];
          })}
          {tail.map((t, i) => cloneElement(t, { key: "tail" + i }))}
        </tbody>
        <tfoot data-list-foot=""><tr>{(() => {
          const out = []; let placed = false;
          for (let j = 0; j < order.length; j++) {
            const c = order[j];
            if (sumCols.includes(c)) { const t = r2(sorted.reduce((a, r) => a + (typeof r.vals[c.i] === "number" && !(skipSum && skipSum(r.tr)) ? r.vals[c.i] : 0), 0)); out.push(<td key={c.k} className={c.cls}><b>{c.fmt ? c.fmt(t) : money(t)}</b></td>); continue; }
            if (!placed && c.role !== "pick") { let k = j + 1; while (k < order.length && !sumCols.includes(order[k])) k++;
              out.push(<td key={c.k} colSpan={k - j} className="lt-count"><b>{sorted.length + " " + (sorted.length === 1 ? unit[0] : unit[1])}</b>{of != null && of !== sorted.length ? " of " + of : ""}</td>); placed = true; j = k - 1; continue; }
            out.push(<td key={c.k}></td>);
          }
          return out; })()}</tr></tfoot>
      </table>
    </ListWrap>
    {limit && sorted.length > shown.length ? more : null}
  </>;
}
