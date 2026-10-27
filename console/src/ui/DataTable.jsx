// DataTable: the one list component every console list uses. Search, a filter per column by its type, sorting,
// paging, filter chips with "Clear all", quick presets (e.g. Active / Deactivated / All), saved views per admin
// (localStorage), the state in the URL hash (bookmarkable), and Export CSV (the server makes the CSV of the filtered
// rows and records the export in the change history). Filtering, sorting and paging happen on the SERVER: the
// action receives {q, filters, sort, page, size} (server/console/core/listquery.ts) and answers {total, rows}.
//
// <DataTable
//   id="firms"                      unique on the page; prefixes its keys in the hash (firms.q, firms.f, firms.s, firms.p, firms.n)
//   action="firms.list"             the list action
//   params={{ firm_id }}            extra fixed params sent with every call
//   columns={[{ key, label, type: "text"|"select"|"date"|"number"|"bool", options?: [{value,label}] | ["a","b"],
//               render?: (row) => node, sortable?: true, filter?: true, phone?: true (shown on phones), align?: "end",
//               list?: true (false: a filter only, not a column of the table)
//               or hidden?: true (not a table column: a filter and a CSV column only) }]}
//   presets={[{ label: "Active", filters: { status: { op: "in", values: ["active"] } } }, { label: "All", filters: {} }]}
//   defaultPreset={0}               the preset applied when the hash has no filters for this table
//   me={me}                         the signed-in admin (saved views are kept per admin)
//   onRow={(row) => go(...)}        a row's click
//   exportName="firms"              file name for Export CSV (omit to hide the button)
//   rowKey="id" | (row) => string />
import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "../lib/api.js";
import { download } from "../lib/format.js";
import { parse, setQuery, useRoute } from "../lib/route.js";

const OPS = { text: "contains", select: "in", date: "range", number: "range", bool: "is" };
const opts = (c) => (c.options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
const loadViews = (key) => { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } };
const saveViews = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage off: views last this page only */ } };

export function describe(c, f) {
  if (!f) return "";
  if (f.op === "contains") return `contains “${f.value}”`;
  if (f.op === "in") return f.values.map((v) => (opts(c).find((o) => o.value === v) || { label: v }).label).join(", ");
  if (f.op === "is") return f.value ? (c.yes || "Yes") : (c.no || "No");
  const a = f.from ?? "", b = f.to ?? "";
  return a !== "" && b !== "" ? `${a} to ${b}` : a !== "" ? `from ${a}` : `up to ${b}`;
}

export function DataTable({ id, action, columns, params = {}, presets, defaultPreset = 0, me, onRow, exportName, rowKey = "id", empty = "Nothing matches." }) {
  const route = useRoute();
  const q = route.query;
  const k = (s) => `${id}.${s}`;
  const filters = useMemo(() => {
    if (q.has(k("f"))) { try { return JSON.parse(q.get(k("f"))) || {}; } catch { return {}; } }
    return presets?.[defaultPreset]?.filters || {};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.get(k("f"))]);
  const search = q.get(k("q")) || "";
  const [sc, sd] = (q.get(k("s")) || "").split(":");
  const sort = sc ? { col: sc, dir: sd === "asc" ? "asc" : "desc" } : undefined;
  const page = Math.max(0, parseInt(q.get(k("p")) || "0", 10) || 0);
  const size = [25, 50, 100].includes(+q.get(k("n"))) ? +q.get(k("n")) : 25;

  const update = (ch) => {
    const n = new URLSearchParams(parse().query);
    for (const [key, v] of Object.entries(ch)) {
      if (v === null || v === undefined || v === "") n.delete(k(key)); else n.set(k(key), typeof v === "string" ? v : JSON.stringify(v));
    }
    if (!("p" in ch)) n.delete(k("p"));
    setQuery(n);
  };
  const setFilters = (f) => update({ f: f });
  const setFilter = (col, f) => { const n = { ...filters }; if (f) n[col] = f; else delete n[col]; setFilters(n); };

  const [text, setText] = useState(search);
  useEffect(() => setText(search), [search]);
  const tmr = useRef(0);
  const onSearch = (v) => { setText(v); clearTimeout(tmr.current); tmr.current = setTimeout(() => update({ q: v.trim() }), 300); };

  const [st, set] = useState({ loading: true, rows: [], total: 0, error: "" });
  const req = JSON.stringify({ params, search, filters, sort, page, size });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    set((s) => ({ ...s, loading: true, error: "" }));
    call(action, { ...params, q: search, filters, sort, page, size }).then(
      (d) => live && set({ loading: false, rows: d.rows || [], total: d.total || 0, error: "" }),
      (e) => live && set({ loading: false, rows: [], total: 0, error: e.message }));
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, req, nonce]);

  const [panel, setPanel] = useState(false);
  const [busyExport, setBusyExport] = useState(false);
  const [exportErr, setExportErr] = useState("");
  const doExport = async () => {
    setBusyExport(true); setExportErr("");
    try {
      const d = await call(action, { ...params, q: search, filters, sort, export: "csv" });
      download(`${exportName}-${new Date().toISOString().slice(0, 10)}.csv`, d.csv);
    } catch (e) { setExportErr(e.message); }
    setBusyExport(false);
  };

  const viewsKey = `fincom-console:views:${me?.user_id || "me"}:${id}`;
  const [views, setViews] = useState(() => loadViews(viewsKey));
  const [naming, setNaming] = useState(false);
  const viewsRef = useRef(null);
  const closeViews = () => { if (viewsRef.current) viewsRef.current.open = false; };
  const [vname, setVname] = useState("");
  const saveView = (e) => {
    e.preventDefault();
    const name = vname.trim().slice(0, 40);
    if (!name) return;
    const v = [...views.filter((x) => x.name !== name), { name, q: search, filters, sort: sort ? `${sort.col}:${sort.dir}` : "" }];
    setViews(v); saveViews(viewsKey, v); setNaming(false); setVname(""); closeViews();
  };
  const applyView = (v) => { update({ q: v.q || "", f: v.filters || {}, s: v.sort || "" }); closeViews(); };
  const dropView = (name) => { const v = views.filter((x) => x.name !== name); setViews(v); saveViews(viewsKey, v); };

  const active = Object.entries(filters).filter(([c]) => columns.some((x) => x.key === c));
  const presetOn = (p) => JSON.stringify(p.filters) === JSON.stringify(filters);
  const toggleSort = (c) => {
    if (c.sortable === false) return;
    const dir = sort?.col === c.key && sort.dir === "asc" ? "desc" : "asc";
    update({ s: `${c.key}:${dir}` });
  };
  const shown = columns.filter((c) => c.list !== false && !c.hidden);
  const keyOf = (r) => (typeof rowKey === "function" ? rowKey(r) : r[rowKey]);
  const from = st.total ? page * size + 1 : 0, to = Math.min(st.total, page * size + size);

  return (
    <div className="dt" data-table={id}>
      <div className="dt-bar">
        <input className="input dt-search" type="search" placeholder="Search" aria-label="Search" value={text} onChange={(e) => onSearch(e.target.value)} />
        {presets && (
          <div className="seg" role="group" aria-label="Quick filter">
            {presets.map((p) => <button key={p.label} className={"seg-b" + (presetOn(p) ? " on" : "")} aria-pressed={presetOn(p)} onClick={() => setFilters(p.filters)}>{p.label}</button>)}
          </div>
        )}
        <button className={"btn ghost" + (panel ? " on" : "")} aria-expanded={panel} onClick={() => setPanel(!panel)} data-testid="filters-toggle">
          Filters{active.length ? ` (${active.length})` : ""}
        </button>
        <details className="views" ref={viewsRef}>
          <summary className="btn ghost">Views</summary>
          <div className="menu">
            {views.length === 0 && <p className="muted small">No saved views yet.</p>}
            {views.map((v) => (
              <div className="menu-row" key={v.name}>
                <button className="link" onClick={() => applyView(v)}>{v.name}</button>
                <button className="link muted" aria-label={"Delete view " + v.name} onClick={() => dropView(v.name)}>×</button>
              </div>
            ))}
            {naming ? (
              <form onSubmit={saveView} className="menu-row">
                <input className="input" autoFocus placeholder="Name this view" value={vname} onChange={(e) => setVname(e.target.value)} aria-label="View name" />
                <button className="btn primary" type="submit">Save</button>
              </form>
            ) : <button className="link" onClick={() => setNaming(true)}>Save the current view…</button>}
          </div>
        </details>
        {exportName && <button className="btn ghost" onClick={doExport} disabled={busyExport} data-testid="export">{busyExport ? "Exporting…" : "Export CSV"}</button>}
      </div>

      {panel && (
        <div className="dt-filters" data-testid="filter-panel">
          {columns.filter((c) => c.filter !== false).map((c) => <FilterControl key={c.key} c={c} f={filters[c.key]} set={(f) => setFilter(c.key, f)} />)}
        </div>
      )}

      {(active.length > 0 || search) && (
        <div className="chips" aria-label="Active filters">
          {search && <span className="chip chip-filter">Search: “{search}” <button aria-label="Remove search" onClick={() => update({ q: "" })}>×</button></span>}
          {active.map(([col, f]) => {
            const c = columns.find((x) => x.key === col);
            return <span key={col} className="chip chip-filter">{c.label}: {describe(c, f)} <button aria-label={"Remove filter " + c.label} onClick={() => setFilter(col, null)}>×</button></span>;
          })}
          <button className="link" onClick={() => update({ q: "", f: {} })} data-testid="clear-all">Clear all</button>
        </div>
      )}
      {exportErr && <div className="note note-bad" role="alert">{exportErr}</div>}
      {st.error && <div className="note note-bad" role="alert">{st.error} <button className="link" onClick={() => setNonce(nonce + 1)}>Try again</button></div>}

      <div className="dt-wrap">
        <table className="table">
          <thead>
            <tr>
              {shown.map((c) => (
                <th key={c.key} className={(c.phone === false ? "no-phone " : "") + (c.align === "end" ? "end" : "")} aria-sort={sort?.col === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  {c.sortable === false ? c.label : <button className="th-b" onClick={() => toggleSort(c)}>{c.label}{sort?.col === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}</button>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {st.rows.map((r) => (
              <tr key={keyOf(r)} className={onRow ? "click" : ""} onClick={onRow ? () => onRow(r) : undefined} tabIndex={onRow ? 0 : undefined}
                  onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined}>
                {shown.map((c) => <td key={c.key} data-label={c.label} className={(c.phone === false ? "no-phone " : "") + (c.align === "end" ? "end" : "")}>{c.render ? c.render(r) : fmtCell(c, r[c.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!st.loading && !st.error && st.rows.length === 0 && <p className="muted empty">{empty}</p>}
        {st.loading && <p className="muted empty" role="status">Reading…</p>}
      </div>
      <div className="dt-foot">
        <span className="muted small" data-testid="count">{st.total ? `${from}–${to} of ${st.total}` : "0"}</span>
        <select className="input small" aria-label="Rows per page" value={size} onChange={(e) => update({ n: e.target.value })}>
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n} a page</option>)}
        </select>
        <button className="btn ghost" disabled={page === 0} onClick={() => update({ p: String(page - 1) })}>Previous</button>
        <button className="btn ghost" disabled={to >= st.total} onClick={() => update({ p: String(page + 1) })}>Next</button>
      </div>
    </div>
  );
}

function fmtCell(c, v) {
  if (v === null || v === undefined || v === "") return "–";
  if (c.type === "bool") return v ? (c.yes || "Yes") : (c.no || "No");
  if (c.type === "date") return new Date(v).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
  if (c.type === "number") return Number(v).toLocaleString("en-IN");
  if (c.type === "select") return (opts(c).find((o) => o.value === v) || { label: v }).label;
  return String(v);
}

function FilterControl({ c, f, set }) {
  const label = <span className="f-label">{c.label}</span>;
  if (c.type === "text") {
    return (
      <label className="field">{label}
        <input className="input" placeholder="contains…" defaultValue={f?.value || ""} data-filter={c.key}
               onBlur={(e) => set(e.target.value.trim() ? { op: OPS.text, value: e.target.value.trim() } : null)}
               onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
      </label>
    );
  }
  if (c.type === "select") {
    const vals = f?.values || [];
    const tog = (v) => { const n = vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v]; set(n.length ? { op: "in", values: n } : null); };
    return (
      <fieldset className="field">{<legend className="f-label">{c.label}</legend>}
        <div className="checks">
          {opts(c).map((o) => <label key={o.value} className="check"><input type="checkbox" checked={vals.includes(o.value)} onChange={() => tog(o.value)} data-filter={c.key + ":" + o.value} /> {o.label}</label>)}
        </div>
      </fieldset>
    );
  }
  if (c.type === "bool") {
    return (
      <label className="field">{label}
        <select className="input" value={f ? String(f.value) : ""} data-filter={c.key} onChange={(e) => set(e.target.value === "" ? null : { op: "is", value: e.target.value === "true" })}>
          <option value="">Any</option><option value="true">{c.yes || "Yes"}</option><option value="false">{c.no || "No"}</option>
        </select>
      </label>
    );
  }
  const num = c.type === "number";
  const val = (v) => (v === "" ? null : num ? Number(v) : v);
  const upd = (from, to) => set(from === null && to === null ? null : { op: "range", from, to });
  return (
    <fieldset className="field">{<legend className="f-label">{c.label}</legend>}
      <div className="range">
        <input className="input" type={num ? "number" : "date"} aria-label={c.label + " from"} value={f?.from ?? ""} data-filter={c.key + ":from"} onChange={(e) => upd(val(e.target.value), f?.to ?? null)} />
        <span className="muted">to</span>
        <input className="input" type={num ? "number" : "date"} aria-label={c.label + " to"} value={f?.to ?? ""} data-filter={c.key + ":to"} onChange={(e) => upd(f?.from ?? null, val(e.target.value))} />
      </div>
    </fieldset>
  );
}
