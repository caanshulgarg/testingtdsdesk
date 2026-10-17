// GSTR-1 in the portal's own tables (round 72, 17-Oct-2026; the owner: "should match the GSTN schema so that anyone can
// understand what is there in that field"). Each table as the portal and its offline tool show it — its number, name and
// column headings (portal.js R1_TABLES) — read off the GSTR-1 JSON FinCom makes, so what is here is what is uploaded:
//   - one row per invoice and rate (as the offline tool), the invoice counted once; a credit note's figures with a minus;
//   - a document missed in an earlier month's return and reported now (GST → Amendments) is marked in its table;
//   - 9A, 9C and 10: the copy filed (original) beside what goes in the file now (revised);
//   - the filters in the column headings, the first 100 rows of a table, its totals always of every row filtered;
//   - table 14 (14(a), 14(b)) from the JSON's supeco; sales through an operator whose GSTIN is not known named under 14(a);
//   - "All tables" one under another, or one table chosen (S.r1T); the search box of the Details tab finds in them too.
import { useState } from "react";
import { r1Portal, r1Present, R1_TABLES, R1_BY, r1Title, colsOf } from "./portal.js";

const money = (v) => "₹" + INR.format(r2(v || 0));
const NOWRAP = new Set(["ctin", "inum", "idt", "ntnum", "ntdt", "onum", "odt", "from", "to", "hsn"]);
const MONEY_COLS = new Set(["val", "taxable", "igst", "cgst", "sgst", "cess", "otaxable", "otax", "nil", "expt", "ngsup"]);
const FILTERS = { b2b: ["ctin", "pos", "rate", "typ"], b2cl: ["pos", "rate"], exp: ["exptyp", "rate"], b2cs: ["pos", "rate"], cdnr: ["ctin", "ntty", "rate"], cdnur: ["urtyp", "ntty"], at: ["pos", "rate"], txpd: ["pos", "rate"],
  hsnb2b: ["rate"], hsnb2c: ["rate"], hsn: ["rate"], b2ba: ["ctin"], cdnra: ["ctin"] };

// the month's tables: the file (with the amendments) and the month's own documents; names from the books
export function r1PortalData(ym, reg) {
  const full = GSTR.toJson(ym, reg), plain = GSTR.toJson(ym, reg, { plain: true }), g = GSTR.one(ym, reg), names = {};
  g.rows.forEach((r) => { if (r.gstin && !names[r.gstin]) names[r.gstin] = r.party; });
  // table 14: an operator's GSTIN → its name (Amazon, Flipkart)
  GSTR.eco14(ym, reg, g).a.forEach((x) => { if (!names[x.etin]) names[x.etin] = GSTR.ECO_NAME[x.eco] || x.eco; });
  let amend = [];
  try { amend = reg && GSTAmend.filed(reg).length ? GSTAmend.pending(ym, reg).rows : []; } catch (e) { amend = []; }
  return r1Portal(full, plain, names, amend);
}

const cell = (k, v) => (MONEY_COLS.has(k) ? money(v) : k === "rate" ? (v === "" || v == null ? "" : String(v).includes(",") ? String(v).split(", ").map((x) => x + "%").join(", ") : v + "%") : k === "qty" || k === "totnum" || k === "cancel" || k === "net" ? INR.format(num(v)).replace(/\.00$/, "") : v == null ? "" : String(v));
const fv = (k, r) => (k === "ctin" ? r.ctin || "" : String(r[k] == null ? "" : r[k]));
const fl = (k, r) => (k === "ctin" ? (r.name ? r.name + " · " : "") + (r.ctin || "") : k === "rate" ? r.rate + "%" : String(r[k] == null ? "" : r[k]));

// 14(a): sales through an operator whose GSTIN is not known are not in the file; named here with their figures, and the
// GSTIN can be typed (ecoGstinSet, src/js/36)
function EcoMissing({ list, reg }) {
  if (!list.length) return null;
  const save = (ev, eco) => { const i = ev.currentTarget.closest("[data-eco-gstin]").querySelector("input"); ecoGstinSet(reg, eco, i ? i.value : ""); };
  return <div className="note" data-eco-missing="" style={{ margin: "6px 2px 0" }}>
    <p style={{ margin: "0 0 4px" }}>Not in the file: the operator’s GSTIN{reg ? " in " + GSTRegs.state(reg) : ""} is not known for these sales. Type it (from its TCS certificate, or GSTR-2A/2B’s TCS credit) to put them in 14(a).</p>
    {list.map((x) => <div key={x.eco} data-eco-gstin={x.eco} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", margin: "2px 0" }}>
      <span><b>{GSTR.ECO_NAME[x.eco] || x.eco}</b>: {x.n} document{x.n === 1 ? "" : "s"}, net value {money(x.suppval)}, tax {money(r2(x.igst + x.cgst + x.sgst + x.cess))}{x.tcs ? "" : " (no TCS on its documents: perhaps not an operator collecting tax u/s 52)"}</span>
      {reg && <><input type="text" aria-label={"GSTIN of " + (GSTR.ECO_NAME[x.eco] || x.eco)} placeholder="15-character GSTIN" maxLength={15} style={{ width: "17ch", maxWidth: "100%" }} />
        <button type="button" className="linkbtn" onClick={(ev) => save(ev, x.eco)}>Save</button></>}</div>)}
  </div>;
}

export function PortalTable({ t, data, q, extra }) {
  const [more, setMore] = useState(100);
  const all = S.r1PF || {}, f = all[t.id] || {}, cols = colsOf(t), qq = String(q || "").toLowerCase();
  const rows = data.rows.filter((r) => Object.keys(f).every((k) => !f[k] || fv(k, r) === f[k]) && (!qq || Object.values(r).some((v) => typeof v === "string" && v.toLowerCase().includes(qq))));
  const list = rows.slice(0, more), any = Object.values(f).some(Boolean);
  const sum = (k) => r2(rows.reduce((a, r) => a + num(r[k]), 0));
  const docs = rows.filter((r) => !r.cont).length, late = rows.filter((r) => r.late && !r.cont).length;
  const set = (k, v) => { S.r1PF = Object.assign({}, all, { [t.id]: Object.assign({}, f, { [k]: v }) }); render(); };
  const clear = () => { S.r1PF = Object.assign({}, all, { [t.id]: {} }); render(); };
  const opts = (k) => { const m = new Map(); data.rows.forEach((r) => { const v = fv(k, r); if (v !== "" && !m.has(v)) m.set(v, fl(k, r)); }); return Array.from(m).sort((a, c) => String(a[1]).localeCompare(String(c[1]), "en", { numeric: true })); };
  const firstMoney = cols.findIndex(([k, , n]) => n && MONEY_COLS.has(k));
  return <section className="r1p" data-r1p={t.id} aria-label={r1Title(t)}>
    <h3 className="r1p-h"><span className="r1p-no">{t.no}</span> – {t.name}<span className="note"> · {t.id === "docs" ? data.n + " documents, net of cancelled" : docs + " " + t.unit + (docs === 1 ? "" : "s")}{late ? " · " + late + " missed earlier, reported now" : ""}</span></h3>
    <div className="bk-tablewrap"><table className="bk-table tg-fit gf-off" data-statement="" id={"r1p-" + t.id}>
      <thead><tr><th className="n">#</th>{cols.map(([k, h, n]) => { const fk = (FILTERS[t.id] || []).includes(k), on = !!f[k];
        return <th key={k} className={(n ? "n" : "") + (on ? " th-filtered" : "")} data-col={k}>{fk ? <span className="colh"><span>{h}</span>
          <select className={"hf-sel" + (on ? " on" : "")} aria-label={h} title={"Filter: " + h} value={f[k] || ""} onClick={(ev) => ev.stopPropagation()} onChange={(ev) => set(k, ev.target.value)}>
            <option value="">{"Every " + h.toLowerCase()}</option>{opts(k).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></span> : h}</th>; })}</tr></thead>
      <tbody>{list.map((r, i) => <tr key={i} data-r1p-row="" className={r.cont ? "r1p-cont" : undefined}>
        <td className="n">{r.cont ? "" : rows.slice(0, i + 1).filter((x) => !x.cont).length}</td>
        {cols.map(([k, , n]) => <td key={k} className={n ? "n" : NOWRAP.has(k) ? "r1p-nw" : undefined}>{r.cont && (k === "val" || !n) ? "" : cell(k, r[k])}
          {(k === "val") && r.docRates > 1 && <div className="tg-sub" data-r1p-doc="">{r.docRates} rates: taxable {money(r.docTaxable)} · tax {money(r.docTax)}</div>}
          {k === cols[0][0] && r.late && !r.cont && <div className="tg-sub"><span className="tag info" title="Not in the return filed for its month: it goes in this month's file with its own number and date">missed earlier, reported now</span></div>}</td>)}</tr>)}
        {rows.length > list.length && <tr className="lt-more"><td colSpan={cols.length + 1} style={{ textAlign: "center" }}><span className="note">{list.length} of {rows.length} rows shown · </span>
          <button type="button" className="linkbtn" onClick={() => setMore(more + 100)}>Show 100 more</button> · <button type="button" className="linkbtn" onClick={() => setMore(rows.length)}>Show all {rows.length}</button></td></tr>}
        {!rows.length && <tr><td colSpan={cols.length + 1}><p className="note" style={{ textAlign: "center" }}>{data.rows.length ? "No row matches these filters." : t.note || "Nothing in this table this month."}{any && <> <button type="button" className="linkbtn" onClick={clear}>Clear filters</button></>}</p></td></tr>}
      </tbody>
      {data.rows.length > 0 && <tfoot><tr className="tg-tot" data-r1p-foot={t.id}>
        <td colSpan={Math.max(1, firstMoney + 1)}><b>Total</b>{rows.length !== data.rows.length && <span className="note"> · filtered</span>}{any && <> · <button type="button" className="linkbtn" onClick={clear}>Clear filters</button></>}</td>
        {cols.slice(Math.max(0, firstMoney)).map(([k, , n]) => <td key={k} className={n ? "n" : undefined}>{n && (MONEY_COLS.has(k) && k !== "val" || k === "qty" || k === "totnum" || k === "cancel" || k === "net") ? <b data-r1p-sum={k}>{cell(k, sum(k))}</b> : ""}</td>)}</tr></tfoot>}
    </table></div>
    {extra}
  </section>;
}

// the Details tab's "Portal tables": a table chosen, or every table with something in it
export default function R1Portal({ ym, reg }) {
  const miss = GSTR.eco14(ym, reg).missing, T = r1PortalData(ym, reg), present = r1Present(T, miss.length > 0), pick = S.r1T && R1_BY[S.r1T] ? S.r1T : "";
  // table 14 is one table on the portal: 14(a) and 14(b) together
  const shown = pick ? (R1_BY[pick].eco ? R1_TABLES.filter((t) => t.eco) : [R1_BY[pick]]) : present, q = (S.r1F || {}).q || "";
  return <div data-r1-portal="">
    <div className="r1p-pick"><label className="note">Table <select aria-label="GSTR-1 table" data-r1p-pick="" value={pick} onChange={(ev) => { S.r1T = ev.target.value; render(); }}>
      <option value="">All tables with entries ({present.length})</option>
      {R1_TABLES.map((t) => <option key={t.id} value={t.id}>{r1Title(t) + " (" + (T[t.id].rows.length ? T[t.id].n : 0) + ")"}</option>)}</select></label>
      {pick && <button type="button" className="linkbtn" onClick={() => { S.r1T = ""; render(); }}>Show all tables</button>}</div>
    {shown.length ? shown.map((t) => <PortalTable key={t.id} t={t} data={T[t.id]} q={q} extra={t.id === "eco14a" ? <EcoMissing list={miss} reg={reg} /> : null} />) : <p className="note" data-list-empty="">No documents for this month.</p>}
  </div>;
}

// the portal's tables in Excel: a sheet a table, the portal's headings, a totals row of SUM formulas
export async function r1PortalExcel(ym, reg, title) {
  await ensureXlsx();
  const T = r1PortalData(ym, reg), X = XLSX, wb = X.utils.book_new();
  r1Present(T).forEach((t) => {
    const cols = colsOf(t), ws = {}, A = (c, r) => X.utils.encode_cell({ c, r }), rows = T[t.id].rows;
    cols.forEach(([, h], c) => { ws[A(c, 0)] = { t: "s", v: h }; });
    rows.forEach((r, i) => cols.forEach(([k, , n], c) => { const v = r[k]; ws[A(c, i + 1)] = n && v !== "" && v != null && !String(v).includes(",") ? { t: "n", v: num(v), z: k === "rate" || k === "qty" ? "0.##" : "#,##0.00" } : { t: "s", v: v == null ? "" : String(v) }; }));
    const L = rows.length + 1;
    ws[A(0, L)] = { t: "s", v: "Total" };
    cols.forEach(([k, , n], c) => { if (n && k !== "rate" && k !== "val") { const col = X.utils.encode_col(c); ws[A(c, L)] = { t: "n", v: r2(rows.reduce((a, r) => a + num(r[k]), 0)), f: "SUM(" + col + "2:" + col + L + ")", z: "#,##0.00" }; } });
    ws["!ref"] = X.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: cols.length - 1, r: L } });
    ws["!cols"] = cols.map(([, h]) => ({ wch: Math.min(32, Math.max(10, h.length + 2)) }));
    X.utils.book_append_sheet(wb, ws, (t.short + " " + t.no).replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  });
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return saveFile(String(title).replace(/[^A-Za-z0-9]+/g, "-") + "-portal-tables.xlsx", new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}
