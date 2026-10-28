// DataTable: the one list component every console list uses. Search, a filter in each column's header by its type (as
// the user app's lists: a filter button on the header opens a pop-up with a search box and a checklist, a box, From /
// To, or Any / Yes / No; the header is marked while its filter is on; one "Clear filters" link above the table; the
// columns that are a filter only sit under "More filters" on the header row), sorting, paging, quick presets
// (e.g. Active / Deactivated / All), saved views per admin
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
//               list?: true (false: a filter only, not a column of the table),
//               hidden?: true (not a table column: a filter and a CSV column only) }]}
//   presets={[{ label: "Active", filters: { status: { op: "in", values: ["active"] } } }, { label: "All", filters: {} }]}
//   defaultPreset={0}               the preset applied when the hash has no filters for this table
//   me={me}                         the signed-in admin (saved views are kept per admin)
//   onRow={(row) => go(...)}        a row's click
//   exportName="firms"              file name for Export CSV (omit to hide the button)
//   rowKey="id" | (row) => string />
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Filter } from "lucide-react";
import { call } from "../lib/api.js";
import { download } from "../lib/format.js";
import { parse, setQuery, useRoute } from "../lib/route.js";

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

  const active = Object.entries(filters).filter(([c]) => columns.some((x) => x.key === c && canFilter(x)));
  const presetOn = (p) => JSON.stringify(p.filters) === JSON.stringify(filters);
  const toggleSort = (c) => {
    if (c.sortable === false) return;
    const dir = sort?.col === c.key && sort.dir === "asc" ? "desc" : "asc";
    update({ s: `${c.key}:${dir}` });
  };
  const shown = columns.filter((c) => c.list !== false && !c.hidden);
  // the columns that are a filter only (not a column of the table): under "More filters" on the header row, in the
  // last header when that one has no label (a column of buttons), else in a header of its own
  const extra = columns.filter((c) => (c.list === false || c.hidden) && canFilter(c));
  const extraOn = extra.some((c) => filters[c.key]);
  const extraCol = extra.length > 0 && !(shown.length && !shown[shown.length - 1].label);

  // the header pop-up: one open at a time; Esc, Cancel, Apply or a click outside closes it, the focus back on its button
  const [pop, setPop] = useState(null);
  const btns = useRef({});
  const reg = (k, el) => { if (el) btns.current[k] = el; };
  const toggle = (k) => setPop((p) => (p === k ? null : k));
  const closePop = (focus = true) => { const b = btns.current[pop]; setPop(null); if (focus && b) b.focus(); };
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

      {active.length > 0 && (
        <div className="dt-on" data-testid="filters-on">
          <span className="muted small">Filtered by {active.map(([col]) => columns.find((x) => x.key === col).label).join(", ")}</span>
          <button className="link small" onClick={() => setFilters({})} data-testid="clear-filters">Clear filters</button>
        </div>
      )}
      {exportErr && <div className="note note-bad" role="alert">{exportErr}</div>}
      {st.error && <div className="note note-bad" role="alert">{st.error} <button className="link" onClick={() => setNonce(nonce + 1)}>Try again</button></div>}

      <div className="dt-wrap">
        <table className="table">
          <thead>
            <tr>
              {shown.map((c, i) => {
                const fc = canFilter(c), on = !!filters[c.key], more = i === shown.length - 1 && extra.length > 0 && !c.label;
                return (
                  <th key={c.key} data-col={c.key} data-filtered={fc && on ? "" : undefined} className={[c.align === "end" && "end", !c.label && !more && "th-blank", more && "th-more"].filter(Boolean).join(" ") || undefined}
                      aria-sort={sort?.col === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <span className="colh">
                      {c.sortable === false ? (c.label ? <span>{c.label}</span> : null) : <button className="th-b" onClick={() => toggleSort(c)}>{c.label}{sort?.col === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}</button>}
                      {fc && <FilterButton k={c.key} label={c.label} on={on} open={pop === c.key} reg={reg} toggle={toggle} />}
                      {more && <MoreButton on={extraOn} open={pop === MORE} reg={reg} toggle={toggle} />}
                    </span>
                  </th>
                );
              })}
              {extraCol && <th className="th-more" data-col={MORE}><span className="colh"><MoreButton on={extraOn} open={pop === MORE} reg={reg} toggle={toggle} /></span></th>}
            </tr>
          </thead>
          <tbody>
            {st.rows.map((r) => (
              <tr key={keyOf(r)} className={onRow ? "click" : ""} onClick={onRow ? () => onRow(r) : undefined} tabIndex={onRow ? 0 : undefined}
                  onKeyDown={onRow ? (e) => { if (e.key === "Enter") onRow(r); } : undefined}>
                {shown.map((c) => <td key={c.key} data-label={c.label} className={(c.phone === false ? "no-phone " : "") + (c.align === "end" ? "end" : "")}>{c.render ? c.render(r) : fmtCell(c, r[c.key])}</td>)}
                {extraCol && <td className="td-more" />}
              </tr>
            ))}
          </tbody>
        </table>
        {!st.loading && !st.error && st.rows.length === 0 && <p className="muted empty">{empty}</p>}
        {st.loading && <p className="muted empty" role="status">Reading…</p>}
      </div>
      {pop && (
        <ColPop key={pop} cols={pop === MORE ? extra : columns.filter((c) => c.key === pop)} title={pop === MORE ? "More filters" : columns.find((c) => c.key === pop)?.label}
                id={pop} filters={filters} anchor={btns.current[pop]} onClose={closePop}
                onApply={(ch) => { const n = { ...filters }; for (const [col, f] of Object.entries(ch)) { if (f) n[col] = f; else delete n[col]; } setFilters(n); closePop(true); }} />
      )}
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

// ---- the filters in the column headers (as the user app's lists, src/js/23-column-filters.js and ListTable's
// ColFunnel): a small filter button on a header, filled while its filter is on; it opens a pop-up under the header.

const MORE = "_more";
const TYPES = ["text", "select", "date", "number", "bool"];
function canFilter(c) { return c.filter !== false && !!c.label && TYPES.includes(c.type); }

function FilterButton({ k, label, on, open, reg, toggle }) {
  return (
    <button type="button" ref={(el) => reg(k, el)} className={"colf" + (on ? " on" : "") + (open ? " open" : "")} data-colf={k}
            aria-label={"Filter " + label} aria-haspopup="dialog" aria-expanded={open} title={on ? `Filter ${label} (on)` : `Filter ${label}`}
            onClick={(e) => { e.stopPropagation(); toggle(k); }}>
      <Filter size={12} strokeWidth={2.25} fill={on ? "currentColor" : "none"} aria-hidden="true" />
    </button>
  );
}
function MoreButton({ on, open, reg, toggle }) {
  return (
    <button type="button" ref={(el) => reg(MORE, el)} className={"colf colf-more" + (on ? " on" : "") + (open ? " open" : "")} data-colf={MORE}
            aria-label="More filters" aria-haspopup="dialog" aria-expanded={open} title={on ? "More filters (on)" : "More filters"}
            onClick={(e) => { e.stopPropagation(); toggle(MORE); }}>
      <Filter size={12} strokeWidth={2.25} fill={on ? "currentColor" : "none"} aria-hidden="true" /><span>More</span>
    </button>
  );
}

// a filter as typed (draft) made into what the server takes, or null when it filters nothing
function tidy(c, f) {
  if (!f) return null;
  if (f.op === "contains") { const v = String(f.value || "").trim(); return v ? { op: "contains", value: v } : null; }
  if (f.op === "in") return f.values && f.values.length ? f : null;
  if (f.op === "is") return typeof f.value === "boolean" ? f : null;
  const from = f.from === "" || f.from === undefined ? null : f.from, to = f.to === "" || f.to === undefined ? null : f.to;
  return from === null && to === null ? null : { op: "range", from, to };
}

// India's dates for the quick picks
const day = (d) => d.toISOString().slice(0, 10);
function quick(which) {
  const now = new Date(Date.now() + 330 * 60000), y = now.getUTCFullYear(), m = now.getUTCMonth(), today = day(now);
  if (which === "7d") return { from: day(new Date(Date.UTC(y, m, now.getUTCDate() - 6))), to: today };
  if (which === "month") return { from: day(new Date(Date.UTC(y, m, 1))), to: today };
  if (which === "last") return { from: day(new Date(Date.UTC(y, m - 1, 1))), to: day(new Date(Date.UTC(y, m, 0))) };
  return { from: day(new Date(Date.UTC(m >= 3 ? y : y - 1, 3, 1))), to: today };   // the financial year, from 1 April
}
const QUICK = [["7d", "Last 7 days"], ["month", "This month"], ["last", "Last month"], ["fy", "This FY"]];

function ColPop({ cols, title, id, filters, anchor, onClose, onApply }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(cols.map((c) => [c.key, filters[c.key] || null])));
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el || !anchor) return;
      const r = anchor.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight, m = 12, gap = 6;
      const w = Math.min(el.offsetWidth, vw - 2 * m);
      const left = Math.max(m, Math.min(r.right - w > m && r.left + w > vw - m ? r.right - w : r.left, vw - w - m));
      const below = vh - r.bottom - gap - m, above = r.top - gap - m, h = el.scrollHeight;
      const up = h > below && above > below;
      setPos({ left, top: up ? undefined : r.bottom + gap, bottom: up ? vh - r.top + gap : undefined, maxHeight: Math.max(120, up ? above : below) });
    };
    place();
    addEventListener("resize", place); addEventListener("scroll", place, true);
    return () => { removeEventListener("resize", place); removeEventListener("scroll", place, true); };
  }, [anchor]);
  useEffect(() => {
    const el = ref.current;
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(true); } };
    const down = (e) => { if (!el.contains(e.target) && !(anchor && anchor.contains(e.target))) onClose(false); };
    document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", down, true);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", down, true); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // the cursor in its first box once it is placed (a hidden pop-up cannot take the focus)
  const placed = !!pos;
  useEffect(() => { if (placed) (ref.current.querySelector(".cp-body input") || ref.current.querySelector("button"))?.focus(); }, [placed]);
  const apply = (e) => { e?.preventDefault(); onApply(Object.fromEntries(cols.map((c) => [c.key, tidy(c, draft[c.key])]))); };
  const clear = () => onApply(Object.fromEntries(cols.map((c) => [c.key, null])));
  const one = cols.length === 1;
  return (
    <div className="colpop" role="dialog" aria-label={one ? "Filter " + title : title} data-colpop={id} ref={ref}
         style={pos ? { left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight } : { left: 0, top: 0, visibility: "hidden" }}>
      <form onSubmit={apply} className="cp-form">
        <div className="cp-head"><b>{one ? "Filter: " + title : title}</b>
          <button type="button" className="cp-x" data-cp="close" aria-label="Close" onClick={() => onClose(true)}>×</button></div>
        <div className="cp-body">
          {cols.map((c) => (
            <div className="cp-field" key={c.key}>
              {!one && <span className="f-label">{c.label}</span>}
              <Field c={c} f={draft[c.key]} id={id} search={one || opts(c).length > 6} set={(f) => setDraft((d) => ({ ...d, [c.key]: f }))} />
            </div>
          ))}
        </div>
        <div className="cp-foot">
          <button type="button" className="link small" data-cp="clear" onClick={clear}>Clear</button>
          <span />
          <button type="button" className="btn ghost sm" data-cp="cancel" onClick={() => onClose(true)}>Cancel</button>
          <button type="submit" className="btn primary sm" data-cp="apply">Apply</button>
        </div>
      </form>
    </div>
  );
}

function Field({ c, f, id, search, set }) {
  const [q, setQ] = useState("");
  if (c.type === "text") {
    return <input className="input cp-full" type="text" placeholder="Contains…" aria-label={c.label + " contains"} data-filter={c.key}
                  value={f?.value || ""} onChange={(e) => set({ op: "contains", value: e.target.value })} />;
  }
  if (c.type === "select") {
    const vals = f?.values || [];
    const tog = (v) => set({ op: "in", values: vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v] });
    const s = q.trim().toLowerCase();
    return (
      <>
        {search && <input className="input cp-search" type="search" placeholder="Search…" aria-label={"Search " + c.label} value={q} onChange={(e) => setQ(e.target.value)} />}
        <div className="cp-list">
          {opts(c).map((o) => (
            <label key={o.value} className="cp-item" hidden={!!s && !String(o.label).toLowerCase().includes(s) && !vals.includes(o.value)}>
              <input type="checkbox" checked={vals.includes(o.value)} onChange={() => tog(o.value)} data-filter={c.key + ":" + o.value} /><span>{o.label}</span>
            </label>
          ))}
          {s && !opts(c).some((o) => String(o.label).toLowerCase().includes(s)) && <p className="muted small cp-none">Nothing matches that.</p>}
        </div>
      </>
    );
  }
  if (c.type === "bool") {
    const cur = f ? String(f.value) : "any";
    return (
      <div className="cp-list cp-radios" role="radiogroup" aria-label={c.label}>
        {[["any", "Any"], ["true", c.yes || "Yes"], ["false", c.no || "No"]].map(([v, l]) => (
          <label key={v} className="cp-item">
            <input type="radio" name={`cp-${id}-${c.key}`} checked={cur === v} data-filter={c.key + ":" + v}
                   onChange={() => set(v === "any" ? null : { op: "is", value: v === "true" })} /><span>{l}</span>
          </label>
        ))}
      </div>
    );
  }
  const num = c.type === "number";
  const val = (v) => (v === "" ? null : num ? Number(v) : v);
  const from = f?.from ?? null, to = f?.to ?? null;
  const upd = (a, b) => set({ op: "range", from: a, to: b });
  return (
    <>
      {!num && (
        <div className="cp-quick">
          {QUICK.map(([k, l]) => {
            const r = quick(k), on = from === r.from && to === r.to;
            return <button type="button" key={k} className={"cp-chip" + (on ? " on" : "")} aria-pressed={on} data-cpquick={k} onClick={() => upd(r.from, r.to)}>{l}</button>;
          })}
        </div>
      )}
      <div className="cp-range">
        <label>From<input className="input" type={num ? "number" : "date"} step={num ? "any" : undefined} inputMode={num ? "decimal" : undefined}
                          value={from ?? ""} data-filter={c.key + ":from"} onChange={(e) => upd(val(e.target.value), to)} /></label>
        <label>To<input className="input" type={num ? "number" : "date"} step={num ? "any" : undefined} inputMode={num ? "decimal" : undefined}
                        value={to ?? ""} data-filter={c.key + ":to"} onChange={(e) => upd(from, val(e.target.value))} /></label>
      </div>
    </>
  );
}
