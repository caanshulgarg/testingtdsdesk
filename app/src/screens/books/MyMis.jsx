// "My MIS" (ROUND 105, B3-B5): a person builds the client's own MIS. Reached from the MIS page ("My MIS") and the side
// menu (Books › My MIS: books:mymis). A lazy chunk of its own, with the engine (lib/misCustom.js), the books' adapter
// (lib/misData.js), the charts (parts/MisChart.jsx) and the store (lib/misStore.js); nothing here is in legacy.js.
//
// The page: the report (a saved one, or start from a template, a firm template or words) · its name · period · unit ·
// decimals · Save · Share · Excel · PDF; "Describe your MIS" (typed or spoken; Ask FinCom lays it out, build_mis); then
// the blocks on the left (reorder by dragging or with ↑ ↓; each opens a simple form) and the live preview on the right.
// Every figure is a button: its ledger rows open in the detail drawer. A look-only member sees the report read-only.
//
// State: S.myMis = {cid, def, sel (the block open in the form), saved (the id it was saved as), msg, unknown, desc}.
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, Wand2 } from "lucide-react";
import Button from "../../parts/Button.jsx";
import More from "../../parts/More.jsx";
import DetailDrawer from "../../parts/DetailDrawer.jsx";
import ListTable from "../../parts/ListTable.jsx";
import MisChart from "../../parts/MisChart.jsx";
import { VoiceInput } from "../../parts/AssistantVoice.jsx";
import "../../lib/finGlobals.js";
import { run, entries, fmt, unitWord, periodLabel, lookIn, namesOf, dateLabel } from "../../lib/misCustom.js";
import { buildMisData, needsOf } from "../../lib/misData.js";
import { TEMPLATES } from "../../lib/misTemplates.js";
import { Reports, FirmTpl, mayEdit, describeMis } from "../../lib/misStore.js";
import { normalizeDef, newId, checkNames, ROW_BY, MEASURES_FOR, MEASURE_LABEL, HEADS, PL_LINES, RATIOS, GST_LINES, CHARTS, UNITS, rowKey } from "../../../../server/_shared/misdef.js";
import "./mymis.css";

const ROW_LABEL = { head: "MIS heads and profit lines", group: "Tally groups", ledger: "Ledgers", code: "Financial-statement codes", customer: "Customers (sales)", supplier: "Suppliers (purchases)", gst: "GST working", ageing: "Owed, by age", ratio: "Ratios" };
const TYPE_LABEL = { table: "Table", chart: "Chart", kpi: "KPI tile" };
const CHART_LABEL = { bar: "Bar", line: "Line", pie: "Pie", donut: "Donut", stacked: "Stacked bar" };
const PERIODS = [["ytd", "This year so far"], ["fy", "A financial year"], ["lastMonth", "Last month"], ["mtd", "This month so far"], ["qtd", "This quarter so far"], ["lastQuarter", "Last quarter"], ["range", "Dates I choose"]];
const st = () => S.myMis || {};
const set = (patch) => { S.myMis = Object.assign({}, st(), patch); render(); };
const today = () => (typeof Audit === "object" ? Audit.today() : new Date().toISOString().slice(0, 10).replace(/-/g, ""));
const clone = (x) => JSON.parse(JSON.stringify(x));
const editDef = (fn) => { const d = clone(st().def); fn(d); set({ def: normalizeDef(d).def, dirty: true }); };
const blockOf = (d, id) => d.blocks.find((b) => b.id === id) || null;

// the books made into the engine's input: once per books, period and what the blocks need
const dataMemo = { key: "", data: null };
function dataFor(b, def) {
  const n = needsOf(def), k = [b.cid, (b.vouchers || []).length, (b.tb || {}).at || "", b.mapV || 0, JSON.stringify(def.period), n.gst, n.ageing, n.code, Object.keys(b.ledInfo || {}).length, JSON.stringify(b.budget || {}).length].join("|");
  // the program's names (S, MIS, FS, …) are its top-level declarations, not properties of globalThis: passed by name
  if (dataMemo.key !== k || !dataMemo.data) { dataMemo.data = buildMisData({ S, MIS, FS, Audit, Books, FinSt: globalThis.FinSt, CO }, def, { today: today() }); dataMemo.key = k; }
  return dataMemo.data;
}
// a figure as shown (a ratio in its own unit; a count as a count)
const cellText = (blk, row, col, u) => {
  const v = row.cells[col.key];
  if (v == null || v === "") return blk.by === "ratio" && (col.kind === "total" || col.kind === "period") ? "—" : "";
  if (typeof v === "string") return v;
  if (col.kind === "pct") return v + "%";
  if (blk.by === "ratio") return fmt(v, u, row.unit === "₹" ? "" : row.unit);
  return blk.measure === "count" ? String(v) : fmt(v, u);
};

// ---------------------------------------------------------------- a figure's ledger rows
let drill = null;
function openDrill(res, blk, row, col) {
  const src = row.src || {};
  const q = col.kind === "ly" ? { from: shiftYear(res.period.from), to: shiftYear(res.period.to) } : { from: col.from || res.period.from, to: col.to || res.period.to };
  drill = { title: row.label + (col.label ? " · " + col.label : ""), src, q, blk, row, units: res.units, data: res.data, filters: st().def.filters, measure: blk.measure, col };
  openDetail("myMisCell", blk.id + ":" + row.key + ":" + col.key);
}
const shiftYear = (d) => String(+d.slice(0, 4) - 1) + d.slice(4);
function Drill() {
  const id = detailOpen("myMisCell"), x = drill;
  let body = null;
  if (id && x) {
    const s = x.src || {};
    if (s.ratio) {
      const p = (x.row.parts || {})[x.col.key] || {};
      body = <div data-mm-drill="ratio"><p>{x.row.label + " is worked out as MIS works it out: " + (p.numL || "") + (p.den != null ? " ÷ " + (p.denL || "") : "") + "."}</p>
        {p.num != null && <table className="bk-table gf-off" data-statement=""><tbody><tr><td>{p.numL}</td><td className="n">{fmt(p.num, { unit: 1, dec: 2 })}</td></tr><tr><td>{p.denL}</td><td className="n">{fmt(p.den, { unit: 1, dec: 2 })}</td></tr>{p.d ? <tr><td>Days in the period</td><td className="n">{p.d}</td></tr> : null}</tbody></table>}
        <p className="note">Open the heads and ledgers behind each part from the profit and loss block, or MIS’s Ratios tab.</p></div>;
    } else if (s.gst) {
      body = <div data-mm-drill="gst"><p>{x.row.label + " is FinCom’s working of the GST returns from the books, as on MIS’s Compliance tab."}</p><button className="linkbtn" onClick={() => { closeDetail(); goClient("books:gst"); }}>Open GST →</button></div>;
    } else {
      const rows = entries(x.data, { ledgers: s.ledgers, parties: s.parties, party: s.party, side: s.side, from: x.q.from, to: x.q.to, filters: x.measure === "close" ? null : x.filters });
      const close = x.measure === "close";
      body = <div data-mm-drill="rows">
        <p className="note">{(close ? "The entries up to " + dateLabel(x.q.to) + " are in the balance; those of " + dateLabel(x.q.from) + " to " + dateLabel(x.q.to) + " are listed." : dateLabel(x.q.from) + " to " + dateLabel(x.q.to)) + (s.ledgers && s.ledgers.length ? " · " + s.ledgers.length + " ledger" + (s.ledgers.length === 1 ? "" : "s") + ": " + s.ledgers.slice(0, 6).join(", ") + (s.ledgers.length > 6 ? "…" : "") : "")}</p>
        <ListTable name="myMisRows" rows={rows.slice(0, 500)} rowKey={(r, i) => r.id + ":" + i} unit={["entry", "entries"]}
          cols={[{ k: "date", label: "Date", role: "date", cell: (r) => fmtDate(tallyDate(r.date)), v: (r) => r.date },
            { k: "no", label: "Voucher", role: "number", cell: (r) => <>{r.no}<div className="nr">{r.type}</div></>, v: (r) => r.no },
            { k: "party", label: "Party", role: "party", cell: (r) => r.party, v: (r) => r.party },
            { k: "dr", label: "Debit", role: "amount", cls: "n", cell: (r) => (s.party || s.parties ? "" : r.amt < 0 ? INR.format(-r.amt) : ""), v: (r) => (r.amt < 0 ? -r.amt : 0), sum: !(s.party || s.parties) },
            { k: "cr", label: s.party || s.parties ? (s.side === "p" ? "Purchases" : "Sales") : "Credit", role: "amount", cls: "n", cell: (r) => (s.party || s.parties ? INR.format(r.amt) : r.amt > 0 ? INR.format(r.amt) : ""), v: (r) => (s.party || s.parties ? r.amt : r.amt > 0 ? r.amt : 0) },
            { k: "narr", label: "Narration", cell: (r) => r.narr }]}
          empty="No entries in this period." />
        {rows.length > 500 && <p className="note">The first 500 of {rows.length}.</p>}
      </div>;
    }
  }
  return <DetailDrawer kind="myMisCell" wide title={x ? x.title : ""} description={x ? "The ledger rows behind the figure" : ""}>{body}</DetailDrawer>;
}

// ---------------------------------------------------------------- the preview
function Block({ res, blk, def, sel }) {
  const u = res.units, [figs, setFigs] = useState(false);
  if (blk.error) return <section className="mm-block bad" data-mm-block={blk.id}><h3>{blk.title}</h3><p className="bad">This block could not be worked out: {blk.error}</p></section>;
  const fv = (v) => (blk.by === "ratio" ? String(v) : fmt(v, u) + " " + unitWord(u));
  const table = <div className="bk-tablewrap mm-tw"><table className="bk-table mm-t gf-off" data-statement="" data-mm-table={blk.id}>
    <thead><tr><th>{ROW_LABEL[blk.by]}</th>{blk.cols.map((c) => <th key={c.key} className="n">{c.label}</th>)}</tr></thead>
    <tbody>{blk.rows.concat(blk.total ? [blk.total] : []).map((r) => <tr key={r.key} className={r.kind === "total" ? "tot" : r.bold ? "b" : ""} data-mm-row={r.key}>
      <td>{r.label}</td>{blk.cols.map((c) => { const t = cellText(blk, r, c, u); return <td key={c.key} className="n">{t === "" || t === "—" || c.kind === "pct" ? t : <button type="button" className="mm-fig" data-mm-cell={r.key + "|" + c.key} onClick={() => openDrill(res, blk, r, c)}>{t}</button>}</td>; })}</tr>)}</tbody>
  </table></div>;
  let body;
  if (blk.type === "kpi" && blk.kpi) {
    const k = blk.kpi, unit = k.unit && k.unit !== "₹" ? k.unit : "";
    const row = blk.rows[0] && !(blk.total && blk.rows.length > 1) ? blk.rows[0] : blk.total || blk.rows[0];
    body = <div className="mm-kpi"><button type="button" className="mm-kpi-v mm-fig" data-mm-kpi={blk.id} onClick={() => row && openDrill(res, blk, row, blk.cols.find((c) => c.key === "t") || { key: "t" })}>{k.value == null ? "—" : unit ? fmt(k.value, u, unit) : fmt(k.value, u)}</button>
      {!unit && <span className="mm-kpi-u">{unitWord(u)}</span>}
      {k.chg != null && <div className={"mm-kpi-d " + (k.chg >= 0 ? "up" : "down")}>{(k.chg >= 0 ? "▲ +" : "▼ ") + k.chg + "% on " + k.baseLabel}</div>}
      {k.base != null && k.chg == null && <div className="mm-kpi-d">{k.baseLabel}: {fmt(k.base, u)}</div>}</div>;
  } else if (blk.type === "chart") {
    body = <>{figs ? table : <MisChart spec={blk.chart} title={blk.title} fmtValue={fv} />}
      <button type="button" className="linkbtn mm-figs" data-mm-figs={blk.id} aria-pressed={figs} onClick={() => setFigs(!figs)}>{figs ? "Show the chart" : "Show the figures"}</button></>;
  } else body = table;
  return <section className={"mm-block mm-" + blk.type + (sel ? " sel" : "")} data-mm-block={blk.id} data-mm-type={blk.type}>
    <h3><button type="button" className="linkbtn" onClick={() => set({ sel: blk.id })}>{blk.title}</button></h3>
    {body}
    {(blk.type === "kpi" ? (blk.notes || []).filter((n) => /^Last year/.test(n)).map(() => "Last year: not in these books.") : blk.notes || []).map((n, i) => <p key={i} className="note mm-note">{n}</p>)}
  </section>;
}

// ---------------------------------------------------------------- the block's form
function Names({ blk, d, field, label, kind, names, ro }) {
  const list = blk.rows[field], [txt, setTxt] = useState(""), known = new Set(names[kind] || []), dl = "mm-dl-" + blk.id + "-" + field;
  const add = (v) => { v = String(v || "").trim(); if (!v) return; editDef((x) => { const b = blockOf(x, blk.id); if (!b.rows[field].includes(v)) b.rows[field].push(v); }); setTxt(""); };
  return <div className="mm-names" data-mm-names={field}><span className="mm-l">{label}</span>
    <div className="mm-chips">{list.map((n) => <span key={n} className={"chip" + (known.has(n) ? "" : " bad")} data-mm-name={n} title={known.has(n) ? "" : "Not in these books: pick one from the list"}>{n}
      {!ro && <button type="button" aria-label={"Remove " + n} onClick={() => editDef((x) => { const b = blockOf(x, blk.id); b.rows[field] = b.rows[field].filter((y) => y !== n); })}>×</button>}</span>)}</div>
    {!ro && <span className="mm-add"><input list={dl} value={txt} aria-label={"Add " + label.toLowerCase()} placeholder={kind === "group" ? "Type a group" : kind === "party" ? "Type a party" : "Type a ledger"} onChange={(ev) => setTxt(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") add(txt); }} />
      <datalist id={dl}>{(names[kind] || []).slice(0, 400).map((n) => <option key={n} value={n} />)}</datalist><Button className="btn small" onClick={() => add(txt)}>Add</Button></span>}
  </div>;
}
function Ticks({ blk, list, ro }) {
  const on = new Set(blk.rows.items);
  return <div className="mm-ticks">{list.map(([k, l]) => <label key={k}><input type="checkbox" disabled={ro} checked={on.has(k)} onChange={(ev) => editDef((x) => { const b = blockOf(x, blk.id); b.rows.items = ev.target.checked ? list.map((z) => z[0]).filter((z) => on.has(z) || z === k) : b.rows.items.filter((z) => z !== k); })} /> {l}</label>)}
    <span className="note">{on.size ? "" : "None ticked: all are shown."}</span></div>;
}
function BlockForm({ d, blk, names, ro, res }) {
  const up = (fn) => editDef((x) => fn(blockOf(x, blk.id)));
  const r = blk.rows, by = r.by, months = res ? res.period : null;
  const sel = (label, value, list, onChange, attr) => <label className="mm-f"><span className="mm-l">{label}</span><select disabled={ro} value={value} aria-label={label} data-mm-field={attr} onChange={(ev) => onChange(ev.target.value)}>{list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  return <div className="mm-form" data-mm-form={blk.id}>
    <label className="mm-f"><span className="mm-l">Title</span><input disabled={ro} value={blk.title} aria-label="Block title" data-mm-field="title" onChange={(ev) => up((b) => { b.title = ev.target.value; })} /></label>
    {sel("Show as", blk.type, Object.entries(TYPE_LABEL), (v) => up((b) => { b.type = v; }), "type")}
    {sel("What", by, ROW_BY.map((k) => [k, ROW_LABEL[k]]), (v) => up((b) => { b.rows = { by: v, items: [], under: [], top: v === "customer" || v === "supplier" || v === "ageing" ? 10 : 0, others: true }; delete b.measure; delete b.title; }), "by")}
    {by === "head" && <Ticks blk={blk} ro={ro} list={HEADS.map((h) => [h[0], h[1]]).concat(PL_LINES)} />}
    {by === "ratio" && <Ticks blk={blk} ro={ro} list={RATIOS.map((x) => [x[0], x[1]])} />}
    {by === "gst" && <Ticks blk={blk} ro={ro} list={GST_LINES} />}
    {by === "group" && <Names blk={blk} d={d} field="items" label="Groups" kind="group" names={names} ro={ro} />}
    {(by === "ledger" || by === "customer" || by === "supplier") && <Names blk={blk} d={d} field="items" label={by === "ledger" ? "Ledgers" : by === "customer" ? "Customers" : "Suppliers"} kind={by === "ledger" ? "ledger" : "party"} names={names} ro={ro} />}
    {(by === "ledger" || by === "customer" || by === "supplier") && <Names blk={blk} d={d} field="under" label="Or every one under the groups" kind="group" names={names} ro={ro} />}
    {by === "code" && <label className="mm-f"><span className="mm-l">Codes</span><input disabled={ro} aria-label="Financial-statement codes" value={r.items.join(", ")} placeholder="13A, 15A, 17A (empty: every code used)" onChange={(ev) => up((b) => { b.rows.items = ev.target.value.split(/[\s,]+/).filter(Boolean); })} /></label>}
    {by === "ageing" && sel("Of", r.side || "r", [["r", "Owed to you (receivables)"], ["p", "You owe (payables)"]], (v) => up((b) => { b.rows.side = v; }), "side")}
    {by !== "head" && by !== "ratio" && by !== "gst" && <div className="mm-row2">
      <label className="mm-f"><span className="mm-l">Top</span><input disabled={ro} type="number" min="0" max="50" aria-label="Top N rows" data-mm-field="top" value={r.top || ""} placeholder="all" onChange={(ev) => up((b) => { b.rows.top = Math.max(0, Math.min(50, +ev.target.value || 0)); })} /></label>
      <label className="mm-c"><input disabled={ro} type="checkbox" checked={!!r.others} onChange={(ev) => up((b) => { b.rows.others = ev.target.checked; })} /> the rest as Others</label></div>}
    {MEASURES_FOR[by].length > 1 && sel("Figure", blk.measure, MEASURES_FOR[by].map((m) => [m, MEASURE_LABEL[m]]), (v) => up((b) => { b.measure = v; }), "measure")}
    {by !== "ageing" && <div className="mm-row2">
      {sel("By", blk.cols.by, [["month", "Month"], ["quarter", "Quarter"], ["year", "The period"]], (v) => up((b) => { b.cols.by = v; }), "cols")}
      {sel("Compare with", blk.cols.compare, [["none", "Nothing"], ["ly", "Last year"], ["budget", "A budget"]], (v) => up((b) => { b.cols.compare = v; }), "compare")}</div>}
    {by !== "ageing" && <div className="mm-ticks">
      <label><input type="checkbox" disabled={ro || blk.cols.compare === "none"} checked={blk.cols.pct.includes("change")} onChange={(ev) => up((b) => { b.cols.pct = ev.target.checked ? b.cols.pct.concat(["change"]) : b.cols.pct.filter((z) => z !== "change"); })} /> % change</label>
      <label><input type="checkbox" disabled={ro} checked={blk.cols.pct.includes("share")} onChange={(ev) => up((b) => { b.cols.pct = ev.target.checked ? b.cols.pct.concat(["share"]) : b.cols.pct.filter((z) => z !== "share"); })} /> % of total</label></div>}
    {blk.type === "chart" && sel("Chart", blk.chart.type, CHARTS.map((c) => [c, CHART_LABEL[c]]), (v) => up((b) => { b.chart.type = v; }), "chart")}
    {blk.cols.compare === "budget" && res && <Budget blk={blk} res={res} ro={ro} />}
  </div>;
}
// the budget the person types: rupees for each month, against each row
function Budget({ blk, res, ro }) {
  const d = st().def, b = res.blocks.find((x) => x.id === blk.id), months = [];
  for (let m = res.period.from.slice(0, 6); m <= res.period.to.slice(0, 6); m = +m.slice(4) === 12 ? String(+m.slice(0, 4) + 1) + "01" : m.slice(0, 4) + String(+m.slice(4) + 1).padStart(2, "0")) months.push(m);
  if (!b) return null;
  return <details className="mm-budget" data-mm-budget=""><summary>Budget (rupees, each month)</summary><div className="bk-tablewrap"><table className="bk-table gf-off" data-statement=""><thead><tr><th />{months.map((m) => <th key={m} className="n">{m.slice(4) + "/" + m.slice(2, 4)}</th>)}</tr></thead>
    <tbody>{b.rows.filter((r) => r.kind === "line").map((r) => <tr key={r.key}><td>{r.label}</td>{months.map((m) => <td key={m}><input disabled={ro} type="number" className="mm-bud" aria-label={"Budget " + r.label + " " + m} value={((d.budget || {})[r.key] || {})[m] || ""}
      onChange={(ev) => editDef((x) => { const k = r.key; x.budget[k] = Object.assign({}, x.budget[k] || {}, { [m]: +ev.target.value || 0 }); })} /></td>)}</tr>)}</tbody></table></div></details>;
}

// ---------------------------------------------------------------- describe by voice or text
function Describe({ cid, names }) {
  const s = st(), desc = s.desc || { text: "" }, [a] = useState(() => ({ q: desc.text || "" }));
  a.q = desc.text || "";
  const go = async () => {
    const text = String(desc.text || "").trim(); if (!text) return;
    set({ desc: Object.assign({}, desc, { busy: true, err: "" }) });
    let r; try { r = await describeMis(text, cid, a.lang); } catch (e) { r = { error: (e && e.message) || String(e) }; }
    if (r.error) { set({ desc: Object.assign({}, st().desc, { busy: false, err: r.error }) }); return; }
    // the names checked again against the books in this browser (the cloud copy may differ)
    const c = await checkNames(r.def, lookIn(dataFor(S.books, r.def)));
    set({ def: c.def, saved: "", dirty: true, sel: c.def.blocks[0] ? c.def.blocks[0].id : "", unknown: c.unknown, desc: { text: "", busy: false, err: "", words: r.words, problems: r.problems }, msg: "Laid out from your words: check it, then Save." });
  };
  return <section className="mm-describe" data-mm-describe="">
    <label htmlFor="mmDesc"><Wand2 size={15} aria-hidden="true" /> Describe your MIS</label>
    <div className="mm-desc-row"><textarea id="mmDesc" rows={2} value={desc.text || ""} placeholder="e.g. Monthly P&L against last year, top 10 customers in lakhs, and cash and bank at each month's end"
      onChange={(ev) => set({ desc: Object.assign({}, desc, { text: ev.target.value }) })} />
      <span className="mm-desc-acts"><VoiceInput a={a} client={cid} onText={(t) => set({ desc: Object.assign({}, st().desc || {}, { text: t }) })} />
        <Button className="btn small primary" data-mm-describe-go="" disabled={desc.busy || !String(desc.text || "").trim()} onClick={go}>{desc.busy ? "Laying it out…" : "Lay it out"}</Button></span></div>
    {desc.err && <p className="bad" role="alert">{desc.err}</p>}
    <p className="note">Ask FinCom writes only the layout; FinCom works out every figure from the books.</p>
  </section>;
}
// names the layout uses that are not in these books: pick the right one
function Unknown({ list }) {
  if (!list || !list.length) return null;
  const pick = (u, name) => { editDef((x) => replaceName(x, u.name, name)); set({ unknown: st().unknown.filter((z) => z !== u) }); };
  return <div className="bk-alert mm-unknown" role="status" data-mm-unknown="">{list.map((u, i) => <p key={i}><b>{u.name}</b>{" (" + u.kind + ", " + u.where + ") is not in these books."}
    {u.choices && u.choices.length ? <> Pick: {u.choices.map((c) => <button key={c} type="button" className="btn small" data-mm-pick={c} onClick={() => pick(u, c)}>{c}</button>)}</> : " Remove it, or type the right name in the block."}</p>)}</div>;
}
function replaceName(d, from, to) {
  d.blocks.forEach((b) => { ["items", "under"].forEach((f) => { b.rows[f] = b.rows[f].map((n) => (n === from ? to : n)); }); });
  ["party", "ledger"].forEach((f) => { d.filters[f] = d.filters[f].map((n) => (n === from ? to : n)); });
}

// ---------------------------------------------------------------- start: a saved report, a template, a firm template
function Start({ cid, list, ro }) {
  const pick = (def) => { const d = normalizeDef(clone(def)).def; d.id = newId("m"); set({ cid, def: d, sel: d.blocks[0] ? d.blocks[0].id : "", saved: "", dirty: !ro, unknown: [], msg: "" }); };
  const ft = FirmTpl.list();
  return <div className="mm-start" data-mm-start="">
    {list.length > 0 && <><h3>Saved for this client</h3><div className="mm-cards">{list.map((r) => <button type="button" key={r.id} className="mm-card" data-mm-open={r.id} onClick={() => set({ cid, def: normalizeDef(r.def).def, saved: r.id, sel: "", dirty: false, unknown: [], msg: "" })}>
      <b>{r.name}</b><span>{(r.shared ? "Shared with the firm" : "Only you") + (r.byName ? " · " + r.byName : "")}</span></button>)}</div></>}
    {ft.length > 0 && <><h3>The firm’s templates</h3><div className="mm-cards">{ft.map((t) => <button type="button" key={t.id} className="mm-card" data-mm-firmtpl={t.id} onClick={() => pick(t.def)}><b>{t.name}</b><span>{"For every client" + (t.by ? " · " + t.by : "")}</span></button>)}</div></>}
    <h3>Start from a template</h3>
    <div className="mm-cards">{TEMPLATES.map((t) => <button type="button" key={t.key} className="mm-card" data-mm-tpl={t.key} disabled={ro} onClick={() => pick(t.def)}><b>{t.name}</b><span>{t.about}</span></button>)}
      <button type="button" className="mm-card" data-mm-tpl="blank" disabled={ro} onClick={() => pick({ name: "My MIS", period: { kind: "ytd" }, blocks: [{ type: "table", rows: { by: "head" } }] })}><b>Blank</b><span>One block to start; add the rest.</span></button></div>
  </div>;
}

// ---------------------------------------------------------------- the page
export default function MyMis({ b }) {
  const cid = b.cid || S.coId, s = st(), ro = !mayEdit();
  const [, tick] = useState(0);
  useEffect(() => { Reports.load(cid).then(() => tick((x) => x + 1)); }, [cid]);
  if (s.cid && s.cid !== cid) { S.myMis = null; }
  const d = st().def, list = Reports.visible(cid);
  const names = useMemo(() => (d ? namesOf(dataFor(b, d)) : {}), [b, d, (b.vouchers || []).length]);
  let res = null, err = "";
  if (d) { try { res = run(d, dataFor(b, d), { today: today() }); } catch (e) { err = (e && e.message) || String(e); } }
  const saved = s.saved ? Reports.get(cid, s.saved) : null;
  const save = async (opt = {}) => {
    const r = await Reports.save(cid, d, s.saved ? "changed the report" : "saved the report", opt);
    set({ saved: d.id, dirty: !r.ok, msg: r.ok ? (opt.shared === true ? "Shared with the firm: every member can open it." : opt.shared === false ? "Not shared: only you see it." : "Saved.") : r.why });
  };
  const dl = (kind) => {
    if (!res) return;
    const w = kind === "pdf" ? window.open("", "_blank") : null;
    import("../../lib/misExport.js").then((m) => (kind === "pdf" ? m.MisPdf.open(res, { company: (CO() || {}).name }, w) : m.MisXlsx.download(res, { company: (CO() || {}).name })))
      .catch((e) => { try { if (w) w.close(); } catch (x) { /* */ } toast("Could not make the file: " + ((e && e.message) || e)); });
  };
  if (!d) return <div className="mm" data-mymis="" data-phone-scroll="">
    <p className="mm-intro">Your own MIS for this client: choose the figures and the layout, add charts, then save, share and download it. {ro && <b>Look-only access: you can open and download saved reports.</b>}</p>
    {!ro && <Describe cid={cid} names={names} />}
    <Start cid={cid} list={list} ro={ro} />
    {Reports.err[cid] && <p className="note">Saved reports could not be read just now: {Reports.err[cid]}</p>}
  </div>;
  const sel = s.sel && blockOf(d, s.sel) ? blockOf(d, s.sel) : null;
  const move = (id, k) => editDef((x) => { const i = x.blocks.findIndex((z) => z.id === id), j = i + k; if (i < 0 || j < 0 || j >= x.blocks.length) return; const [z] = x.blocks.splice(i, 1); x.blocks.splice(j, 0, z); });
  const add = (type) => { const id = newId(); editDef((x) => { x.blocks.push({ id, type, rows: { by: "head", items: type === "kpi" ? ["pbt"] : [] }, cols: { by: type === "kpi" ? "year" : "month" } }); }); set({ sel: id }); };
  const fyNow = String(+String(today()).slice(0, 4) - (+String(today()).slice(4, 6) < 4 ? 1 : 0));
  return <div className="mm" data-mymis="" data-phone-scroll="" data-mm-ro={ro ? "1" : ""}>
    <div className="mm-head" data-mm-head="">
      <select aria-label="Report" value={s.saved || ""} onChange={(ev) => { const r = Reports.get(cid, ev.target.value); if (r) set({ def: normalizeDef(r.def).def, saved: r.id, sel: "", dirty: false, unknown: [], msg: "" }); else set({ def: null, saved: "", sel: "" }); }}>
        <option value="">{s.saved ? "Start another…" : "Not saved yet"}</option>{list.map((r) => <option key={r.id} value={r.id}>{r.name}{r.shared ? " (shared)" : ""}</option>)}</select>
      <input className="mm-name" aria-label="Report name" value={d.name} disabled={ro} onChange={(ev) => editDef((x) => { x.name = ev.target.value; })} />
      <select aria-label="Period" value={d.period.kind} onChange={(ev) => editDef((x) => { x.period = { kind: ev.target.value, fy: String(fyNow), from: (res && res.period.from) || "", to: (res && res.period.to) || "" }; })}>
        {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {d.period.kind === "fy" && <select aria-label="Financial year" value={d.period.fy || String(fyNow)} onChange={(ev) => editDef((x) => { x.period.fy = ev.target.value; })}>
        {[0, 1, 2, 3].map((k) => String(+fyNow - k)).map((y) => <option key={y} value={y}>{"FY " + y + "-" + String(+y + 1).slice(2)}</option>)}</select>}
      {d.period.kind === "range" && <><input type="date" aria-label="From" value={iso(d.period.from)} onChange={(ev) => editDef((x) => { x.period.from = ev.target.value.replace(/-/g, ""); })} /><input type="date" aria-label="To" value={iso(d.period.to)} onChange={(ev) => editDef((x) => { x.period.to = ev.target.value.replace(/-/g, ""); })} /></>}
      <div className="fin-seg" role="group" aria-label="Unit" data-mm-seg="unit"><span>Unit</span>{Object.keys(UNITS).map((k) => <button key={k} type="button" aria-pressed={d.units.unit === +k} data-v={k} onClick={() => editDef((x) => { x.units.unit = +k; })}>{{ 1: "₹", 1000: "'000", 100000: "Lakhs", 10000000: "Crores" }[k]}</button>)}</div>
      <div className="fin-seg" role="group" aria-label="Decimals" data-mm-seg="dec"><span>Decimals</span>{[0, 2].map((k) => <button key={k} type="button" aria-pressed={d.units.dec === k} data-v={k} onClick={() => editDef((x) => { x.units.dec = k; })}>{k}</button>)}</div>
      <span className="mm-sp" />
      {!ro && <Button className="btn small primary" data-mm-save="" onClick={() => save()}>{s.saved && !s.dirty ? "Saved" : "Save"}</Button>}
      {!ro && <Button className="btn small" data-mm-share="" aria-pressed={!!(saved && saved.shared)} onClick={() => save({ shared: !(saved && saved.shared) })}>{saved && saved.shared ? "Shared ✓" : "Share with the firm"}</Button>}
      <Button className="btn small" data-mm-dl="xlsx" onClick={() => dl("xlsx")}>Excel</Button>
      <Button className="btn small" data-mm-dl="pdf" onClick={() => dl("pdf")}>PDF</Button>
      <More label="More" align="end" items={[!ro && ["Use for all clients (firm template)", () => { set({ msg: FirmTpl.save(d) ? "Kept as a firm template: it is offered for every client." : "Could not keep it as a firm template." }); }, { "data-mm-firm": "" }],
        ["Start another report", () => set({ def: null, saved: "", sel: "", unknown: [] })],
        !ro && saved && ["Remove this report", () => Reports.remove(cid, saved.id).then((r) => set(r.ok ? { def: null, saved: "", sel: "", msg: "" } : { msg: r.why })), { "data-mm-remove": "" }]]} />
    </div>
    <p className="note mm-meta" data-mm-meta="">{(res ? res.periodLabel : "") + " · " + (UNITS[d.units.unit] || "Rupees") + ", " + d.units.dec + " decimals" + (saved ? " · " + (saved.shared ? "shared with the firm" : "only you") + (saved.byName ? " · made by " + saved.byName : "") : "")}{s.msg ? <b className="mm-msg" role="status"> · {s.msg}</b> : null}</p>
    {ro && <p className="note" data-mm-readonly="">Look-only access: you can view and download this report; changes are made by the firm’s owners and staff.</p>}
    {!ro && <Describe cid={cid} names={names} />}
    <Unknown list={s.unknown} />
    {err && <p className="bad">{err}</p>}
    <div className="mm-grid">
      <aside className="mm-side" aria-label="Blocks">
        <ol className="mm-list" data-mm-list="">{d.blocks.map((blk, i) => <li key={blk.id} className={sel && sel.id === blk.id ? "on" : ""} data-mm-item={blk.id} draggable={!ro}
          onDragStart={(ev) => { ev.dataTransfer.setData("text/plain", blk.id); }} onDragOver={(ev) => ev.preventDefault()}
          onDrop={(ev) => { ev.preventDefault(); const from = ev.dataTransfer.getData("text/plain"); if (from && from !== blk.id) editDef((x) => { const a = x.blocks.findIndex((z) => z.id === from), [z] = x.blocks.splice(a, 1); x.blocks.splice(x.blocks.findIndex((y) => y.id === blk.id) + (a <= i ? 1 : 0), 0, z); }); }}>
          {!ro && <GripVertical size={14} className="mm-grip" aria-hidden="true" />}
          <button type="button" className="mm-item" onClick={() => set({ sel: sel && sel.id === blk.id ? "" : blk.id })} aria-expanded={!!(sel && sel.id === blk.id)}><b>{blk.title}</b><span>{TYPE_LABEL[blk.type] + " · " + ROW_LABEL[blk.rows.by]}</span></button>
          {!ro && <span className="mm-acts"><button type="button" aria-label={"Move " + blk.title + " up"} disabled={i === 0} onClick={() => move(blk.id, -1)}><ArrowUp size={14} /></button>
            <button type="button" aria-label={"Move " + blk.title + " down"} disabled={i === d.blocks.length - 1} onClick={() => move(blk.id, 1)}><ArrowDown size={14} /></button>
            <button type="button" aria-label={"Remove " + blk.title} onClick={() => editDef((x) => { x.blocks = x.blocks.filter((z) => z.id !== blk.id); })}><Trash2 size={14} /></button></span>}
          {sel && sel.id === blk.id && <BlockForm d={d} blk={blk} names={names} ro={ro} res={res} />}
        </li>)}</ol>
        {!ro && <div className="mm-addrow"><span className="note">Add</span>{["table", "chart", "kpi"].map((t) => <Button key={t} className="btn small" data-mm-add={t} onClick={() => add(t)}><Plus size={13} aria-hidden="true" /> {TYPE_LABEL[t]}</Button>)}</div>}
        {!ro && <details className="mm-filters"><summary>Filters {d.filters.party.length + d.filters.ledger.length + d.filters.vtype.length ? "(" + (d.filters.party.length + d.filters.ledger.length + d.filters.vtype.length) + ")" : ""}</summary>
          <label className="mm-f"><span className="mm-l">Voucher types</span><select multiple aria-label="Voucher types" value={d.filters.vtype} onChange={(ev) => editDef((x) => { x.filters.vtype = Array.from(ev.target.selectedOptions).map((o) => o.value); })}>{["Sales", "Purchase", "Receipt", "Payment", "Journal", "Contra", "Credit Note", "Debit Note"].map((t) => <option key={t}>{t}</option>)}</select></label>
          <label className="mm-f"><span className="mm-l">Party</span><input list="mm-dl-party" aria-label="Filter by party" value={d.filters.party.join(", ")} onChange={(ev) => editDef((x) => { x.filters.party = ev.target.value.split(/\s*,\s*/).filter(Boolean); })} /></label>
          <label className="mm-f"><span className="mm-l">Entries with ledger</span><input list="mm-dl-ledger" aria-label="Filter by ledger" value={d.filters.ledger.join(", ")} onChange={(ev) => editDef((x) => { x.filters.ledger = ev.target.value.split(/\s*,\s*/).filter(Boolean); })} /></label>
          <datalist id="mm-dl-party">{(names.party || []).slice(0, 400).map((n) => <option key={n} value={n} />)}</datalist><datalist id="mm-dl-ledger">{(names.ledger || []).slice(0, 400).map((n) => <option key={n} value={n} />)}</datalist>
        </details>}
      </aside>
      <main className="mm-preview" aria-label="Preview" data-mm-preview="">
        <header className="mm-ph"><b>{(CO() || {}).name || ""}</b><span>{d.name + " · " + (res ? res.periodLabel : "")}</span><i>{"(All amounts in " + (UNITS[d.units.unit] || "Rupees") + ")"}</i></header>
        <div className="mm-blocks">{res && res.blocks.map((blk) => <Block key={blk.id} res={res} blk={blk} def={d} sel={sel && sel.id === blk.id} />)}</div>
        {res && !res.blocks.length && <p className="note">No blocks yet: add a table, a chart or a KPI tile.</p>}
      </main>
    </div>
    <Drill />
  </div>;
}
const iso = (d) => (d && d.length === 8 ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6) : "");
export { rowKey };
