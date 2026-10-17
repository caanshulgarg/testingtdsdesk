// GSTR-1 as the portal lays it out (t70, 16-Oct-2026; the owner: "not able to identify the total bills.. with 100+ bills
// it will be a problem", "check the schema of GSTN, make it user friendly to see"). Nothing here works out a figure: the
// documents are GSTR.one()'s rows, the portal's tables are the GSTR-1 JSON FinCom makes (GSTR.toJson, src/js/12), summed.
//   - R1Summary: one table, a row per GSTR-1 table present (4A, 4B, 5, 6A, 6B/6C, 7, 8, 9B registered and unregistered,
//     11A, 11B, 12, 13): records, taxable value, IGST, CGST, SGST, cess, total tax; the grand total without 12 and 13 (as
//     the portal); a row opens Details filtered to its table;
//   - Bills: one row a document (invoice, credit or debit note), its part named as the portal names it; table 7 (B2C
//     others) is the portal's summary by place of supply and rate, in a group of its own at the end, so the count of bills
//     is of real documents; the filters in the headers; the first 100 shown, the totals always of every row filtered;
//     Excel with SUM formulas in its totals row.
import { useState } from "react";
import SrcTag from "../../parts/SrcTag.jsx";
import { R1_BY, r1Title } from "./portal.js";
import { r1PortalData } from "./R1Portal.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => fmtDate(tallyDate(d));
export const R1_PARTS = { "4A": "4A B2B", "4B": "4B B2B reverse charge", "5": "5 B2C large", "6A": "6A Exports", "6B": "6B/6C SEZ / deemed exports", "7": "7 B2C others",
  "8": "8 Nil/exempt", "9BR": "9B Credit/debit notes (registered)", "9BU": "9B Credit/debit notes (unregistered)", "11A": "11A Advances received", "11B": "11B Advances adjusted",
  "12": "12 HSN summary", "13": "13 Documents issued", "14": "14 Supplies through e-commerce operators" };
// (in the portal's order: an object's keys like "5" and "12" would sort as numbers)
// the same, short, for a cell (the full name in its title and in the Part filter)
const R1_SHORT = { "4A": "4A B2B", "4B": "4B B2B RCM", "5": "5 B2CL", "6A": "6A Export", "6B": "6B SEZ", "7": "7 B2CS", "8": "8 Nil/exempt", "9BR": "9B CDN reg.", "9BU": "9B CDN unreg." };
export const R1_ORDER = ["4A", "4B", "5", "6A", "6B", "7", "8", "9BR", "9BU", "11A", "11B", "12", "13", "14"];
// the GSTR-1 table a document goes in (as GSTR.toJson puts it); "7" for a B2C small invoice and a note that adjusts it
export function partOf(r) {
  if (r.kind === "B2B") return r.cls === "sez" ? "6B" : r.rcm ? "4B" : "4A";
  if (r.kind === "B2CL") return "5";
  if (r.kind === "EXP") return "6A";
  if (r.kind === "NIL") return "8";
  if (r.kind === "CDNR" || r.kind === "DBNR") return r.gstin ? "9BR" : GSTR.cdnurTyp(r) ? "9BU" : "7";
  return "7";
}
const itm = (x) => x.itm_det || x;
const add = (o, x, sg = 1) => { o.taxable = r2(o.taxable + sg * num(x.txval != null ? x.txval : x.ad_amt)); o.igst = r2(o.igst + sg * num(x.iamt)); o.cgst = r2(o.cgst + sg * num(x.camt)); o.sgst = r2(o.sgst + sg * num(x.samt)); o.cess = r2(o.cess + sg * num(x.csamt)); };
const blank = (k) => ({ k, n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
// the portal's tables from the GSTR-1 JSON: [{k, n, taxable, igst, cgst, sgst, cess}]
export function r1Tables(j) {
  const t = {}, T = (k) => (t[k] = t[k] || blank(k));
  (j.b2b || []).forEach((p) => (p.inv || []).forEach((v) => { const o = T(/^SEW|^DE/.test(v.inv_typ || "") ? "6B" : v.rchrg === "Y" ? "4B" : "4A"); o.n++; (v.itms || []).forEach((x) => add(o, itm(x))); }));
  (j.b2cl || []).forEach((p) => (p.inv || []).forEach((v) => { const o = T("5"); o.n++; (v.itms || []).forEach((x) => add(o, itm(x))); }));
  (j.exp || []).forEach((p) => (p.inv || []).forEach((v) => { const o = T("6A"); o.n++; (v.itms || []).forEach((x) => add(o, itm(x))); }));
  (j.b2cs || []).forEach((x) => { const o = T("7"); o.n++; add(o, x); });
  ((j.nil || {}).inv || []).forEach((x) => { const o = T("8"); o.n++; o.taxable = r2(o.taxable + num(x.expt_amt) + num(x.nil_amt) + num(x.ngsup_amt)); });
  (j.cdnr || []).forEach((p) => (p.nt || []).forEach((v) => { const o = T("9BR"); o.n++; (v.itms || []).forEach((x) => add(o, itm(x), v.ntty === "C" ? -1 : 1)); }));
  (j.cdnur || []).forEach((v) => { const o = T("9BU"); o.n++; (v.itms || []).forEach((x) => add(o, itm(x), v.ntty === "C" ? -1 : 1)); });
  (j.at || []).forEach((p) => (p.itms || []).forEach((x) => { const o = T("11A"); o.n++; add(o, x); }));
  (j.txpd || []).forEach((p) => (p.itms || []).forEach((x) => { const o = T("11B"); o.n++; add(o, x); }));
  const hsn = j.hsn ? (j.hsn.data || []).concat(j.hsn.hsn_b2b || [], j.hsn.hsn_b2c || []) : [];
  hsn.forEach((x) => { const o = T("12"); o.n++; add(o, x); });
  ((j.doc_issue || {}).doc_det || []).forEach((d) => (d.docs || []).forEach((x) => { const o = T("13"); o.n += num(x.net_issue); }));
  // table 14: a record an operator, 14(a) and 14(b) together (as the portal's tile)
  ["clttx", "paytx"].forEach((k) => ((j.supeco || {})[k] || []).forEach((x) => { const o = T("14"); o.n++; add(o, { txval: x.suppval, iamt: x.igst, camt: x.cgst, samt: x.sgst, csamt: x.cess }); }));
  return R1_ORDER.filter((k) => t[k]).map((k) => t[k]);
}
const taxOf = (o) => r2(num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess));

// the portal's GSTR-1 summary names and grouping (B2B, reverse charge and SEZ / deemed exports are ONE table there);
// round 72: the portal's own words, and a row opens that table in the portal's layout (Details → Portal tables)
const R1_PORTAL = { B2B: "4A, 4B, 6B, 6C – B2B, SEZ, DE Invoices", "5": "5A, 5B – B2C (Large) Invoices", "6A": "6A – Exports Invoices", "7": "7 – B2C (Others)",
  "8": "8A, 8B, 8C, 8D – Nil Rated Supplies", "9BR": "9B – Credit / Debit Notes (Registered)", "9BU": "9B – Credit / Debit Notes (Unregistered)",
  "11A": "11A(1), 11A(2) – Tax Liability (Advances Received)", "11B": "11B(1), 11B(2) – Adjustment of Advances", "12": "12 – HSN-wise summary of outward supplies", "13": "13 – Documents Issued",
  "14": "14 – Supplies made through E-Commerce Operators" };
// the portal table a summary row opens
const R1_OPEN = { B2B: "b2b", "5": "b2cl", "6A": "exp", "7": "b2cs", "8": "nil", "9BR": "cdnr", "9BU": "cdnur", "11A": "at", "11B": "txpd", "13": "docs", "14": "eco14a" };
function portalRows(list) {
  const out = [], b2b = list.filter((o) => o.k === "4A" || o.k === "4B" || o.k === "6B");
  if (b2b.length) { const g = blank("B2B"); g.parts = b2b.map((o) => o.k); b2b.forEach((o) => { g.n += o.n; ["taxable", "igst", "cgst", "sgst", "cess"].forEach((f) => { g[f] = r2(g[f] + o[f]); }); }); out.push(g); }
  list.filter((o) => !["4A", "4B", "6B"].includes(o.k)).forEach((o) => out.push(o));
  return out;
}
const AMEND_IDS = ["b2ba", "b2cla", "expa", "cdnra", "cdnura", "b2csa", "ata", "txpda"];
export function R1Summary({ amendN }) {
  const ym = S.gstYm || "", reg = S.gstReg || "";
  const j = GSTR.toJson(ym, reg, { plain: true }), list = portalRows(r1Tables(j));
  const T = r1PortalData(ym, reg), amd = AMEND_IDS.filter((k) => T[k].rows.length), late = ["b2b", "b2cl", "exp", "cdnr", "cdnur"].reduce((a, k) => a + T[k].late, 0);
  const tot = blank("all"); list.filter((o) => o.k !== "12" && o.k !== "13" && o.k !== "14").forEach((o) => { tot.n += o.n; ["taxable", "igst", "cgst", "sgst", "cess"].forEach((f) => { tot[f] = r2(tot[f] + o[f]); }); });
  const openT = (id) => { S.r1T = id; S.r1View = ""; S.r1F = {}; gstSubGo("details"); };
  const open = (k) => { if (k === "12") { openT(T.hsnb2b.rows.length ? "hsnb2b" : T.hsnb2c.rows.length ? "hsnb2c" : "hsn"); return; } openT(R1_OPEN[k] || ""); };
  const Name = ({ label, go }) => <button type="button" className="linkbtn tg-pty" style={{ textAlign: "left", paddingLeft: 0, marginLeft: 0 }} onClick={(ev) => { ev.stopPropagation(); go(); }}>{label}</button>;
  return <div className="bk-tablewrap" data-r1-summary=""><table className="bk-table tg-fit" data-statement="">
    <thead><tr><th>Table</th><th className="n">No. of records</th><th className="n">Taxable Value</th><th className="n">Integrated Tax</th><th className="n">Central Tax</th><th className="n">State/UT Tax</th><th className="n">Cess</th><th className="n">Total tax</th></tr></thead>
    <tbody>{list.length ? list.map((o) => <tr key={o.k} data-r1-table={o.k} className="tg-click" onClick={() => open(o.k)} title="Open this table as the portal shows it">
      <td><Name label={R1_PORTAL[o.k] || R1_PARTS[o.k]} go={() => open(o.k)} />{o.k === "7" && <div className="tg-sub">summary by place of supply and rate</div>}{o.k === "13" && <div className="tg-sub">documents, net of cancelled</div>}{o.k === "14" && <div className="tg-sub">by operator; these supplies are also in tables 4 to 10</div>}</td>
      <td className="n">{o.n}</td>{o.k === "13" ? <td colSpan={6}></td> : <><td className="n">{money(o.taxable)}</td><td className="n">{money(o.igst)}</td><td className="n">{money(o.cgst)}</td><td className="n">{money(o.sgst)}</td>
      <td className="n">{money(o.cess)}</td><td className="n">{money(taxOf(o))}</td></>}</tr>)
      : <tr><td colSpan={8} className="note">No documents for this month.</td></tr>}
      <tr className="tg-tot" data-r1-grand=""><td><b>Total</b><span className="note"> · tables 4 to 11 ({list.some((o) => o.k === "14") ? "12, 13 and 14" : "12 and 13"} apart, as the portal)</span></td><td className="n">{tot.n}</td><td className="n">{money(tot.taxable)}</td><td className="n">{money(tot.igst)}</td>
        <td className="n">{money(tot.cgst)}</td><td className="n">{money(tot.sgst)}</td><td className="n">{money(tot.cess)}</td><td className="n"><b>{money(taxOf(tot))}</b></td></tr>
      {late > 0 && <tr data-r1-late=""><td colSpan={8} className="note">Also in this month's file: {late} document{late === 1 ? "" : "s"} missed in an earlier month's return, reported now in {["b2b", "b2cl", "exp", "cdnr", "cdnur"].filter((k) => T[k].late).map((k) => R1_BY[k].no).join(", ")} (not in the total above).</td></tr>}
      {amd.length > 0 && <><tr className="tg-group" data-r1-amend-head=""><td colSpan={8}><b>Amendments in this month's file</b><span className="note"> · revised values; the original beside them in each table</span></td></tr>
        {amd.map((k) => { const x = T[k]; return <tr key={k} data-r1-amend={k} className="tg-click" onClick={() => openT(k)}><td><Name label={r1Title(R1_BY[k])} go={() => openT(k)} /></td><td className="n">{x.n}</td>
          <td className="n">{money(x.tot.taxable)}</td><td className="n">{money(x.tot.igst)}</td><td className="n">{money(x.tot.cgst)}</td><td className="n">{money(x.tot.sgst)}</td><td className="n">{money(x.tot.cess)}</td><td className="n">{money(taxOf(x.tot))}</td></tr>; })}</>}</tbody>
  </table>{amendN > 0 && <p className="note" style={{ margin: "8px 12px" }}>{amendN} earlier month{amendN === 1 ? "" : "s"}’ entr{amendN === 1 ? "y" : "ies"} to amend go into this month’s JSON (9A and the other amendment tables): <button className="linkbtn" onClick={() => gstPartGo("amend")}>see them</button>.</p>}</div>;
}

// the documents of the month, filtered as S.r1F says ({part, party, pos, rate, month, q}), and table 7's summary lines
export function r1Lists(rows) {
  const f = S.r1F || {}, qq = String(f.q || "").toLowerCase();
  const bills = rows.filter((r) => partOf(r) !== "7");
  const pass = (r) => (!f.part || partOf(r) === f.part) && (!f.parts || f.parts.includes(partOf(r))) && (!f.party || (r.gstin || normName(r.party || "")) === f.party) && (!f.pos || String(r.pos || "") === f.pos)
    && (!f.rate || String(r.rate) === f.rate) && (!f.month || String(r.date).slice(0, 6) === f.month)
    && (!qq || (r.no + " " + r.party + " " + (r.gstin || "")).toLowerCase().includes(qq));
  const j = GSTR.toJson(S.gstYm || "", S.gstReg || "", { plain: true });
  const stName = (c) => (Object.keys(STATE_CODES).find((k) => STATE_CODES[k] === c) || c);
  const b2cs = (j.b2cs || []).map((x, i) => ({ id: "b2cs" + i, pos: stName(x.pos), rate: x.rt, taxable: num(x.txval), igst: num(x.iamt), cgst: num(x.camt), sgst: num(x.samt), cess: num(x.csamt), sply: x.sply_ty }));
  const sumPass = (x) => (!f.part || f.part === "7") && !f.parts && !f.party && !f.month && !qq && (!f.pos || x.pos === f.pos) && (!f.rate || String(x.rate) === f.rate);
  return { all: bills, shown: bills.filter(pass), b2cs: b2cs.filter(sumPass), b2csAll: b2cs };
}
const total = (x) => r2(num(x.taxable) + num(x.igst) + num(x.cgst) + num(x.sgst) + num(x.cess));
function HF({ k, label, options }) {
  const f = S.r1F || {}, v = f[k] || "";
  return <select className={"hf-sel" + (v ? " on" : "")} aria-label={label} title={"Filter: " + label + (v ? " · " + ((options.find((o) => o[0] === v) || [])[1] || v) : "")} value={v}
    onClick={(ev) => ev.stopPropagation()} onChange={(ev) => setFilter("r1F", k, ev.target.value)}>{options.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</select>;
}
const thF = (k) => ((S.r1F || {})[k] ? "th-filtered" : undefined);

// the bills' Excel: one row a document, then table 7's lines, a totals row of SUMs
export async function r1BillsExcel(list, b2cs, title) {
  await ensureXlsx();
  const X = XLSX, ws = {}, head = ["#", "Date", "Invoice no", "Customer", "GSTIN", "Part", "Place of supply", "Rate %", "Taxable", "IGST", "CGST", "SGST", "Total"];
  const A = (c, r) => X.utils.encode_cell({ c, r }), s = (v) => ({ t: "s", v: String(v == null ? "" : v) }), m = (v, f) => (f ? { t: "n", v: r2(v), f, z: "#,##0.00" } : { t: "n", v: r2(num(v)), z: "#,##0.00" });
  head.forEach((h, c) => { ws[A(c, 0)] = s(h); });
  const lines = list.map((r, i) => [i + 1, day(r.date), r.no, r.party, r.gstin || "", R1_PARTS[partOf(r)], r.pos || "", r.rate, r.taxable, r.igst, r.cgst, r.sgst])
    .concat(b2cs.map((x) => ["", "", "", "B2C others: summary by state and rate", "", R1_PARTS["7"], x.pos, x.rate, x.taxable, x.igst, x.cgst, x.sgst]));
  lines.forEach((l, i) => { const y = i + 1, R = y + 1; l.forEach((v, c) => { ws[A(c, y)] = c >= 8 ? m(v) : c === 0 || c === 7 ? { t: "n", v: num(v) } : s(v); }); ws[A(12, y)] = m(total({ taxable: l[8], igst: l[9], cgst: l[10], sgst: l[11] }), "SUM(I" + R + ":L" + R + ")"); });
  const T = lines.length + 1, last = lines.length + 1;
  ws[A(3, T)] = s("Total: " + list.length + " bills" + (b2cs.length ? " + " + b2cs.length + " B2C summary lines" : ""));
  ["I", "J", "K", "L", "M"].forEach((col, i) => { const c = 8 + i; ws[A(c, T)] = m(lines.reduce((a, l) => a + (c === 12 ? total({ taxable: l[8], igst: l[9], cgst: l[10], sgst: l[11] }) : num(l[c])), 0), "SUM(" + col + "2:" + col + last + ")"); });
  ws["!ref"] = X.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 12, r: T } });
  ws["!cols"] = [5, 12, 16, 32, 17, 30, 16, 7, 14, 12, 12, 12, 14].map((w) => ({ wch: w }));
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, "Bills");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return saveFile(title.replace(/[^A-Za-z0-9]+/g, "-") + "-bills.xlsx", new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

export function Bills({ rows }) {
  const [more, setMore] = useState(100);
  const L = r1Lists(rows), { shown, b2cs } = L, f = S.r1F || {};
  const sum = (k) => r2(shown.reduce((a, r) => a + num(r[k]), 0) + b2cs.reduce((a, x) => a + num(x[k]), 0));
  const parties = {}; L.all.forEach((r) => { const k = r.gstin || normName(r.party || ""); parties[k] = parties[k] || r.party; });
  const cnt = {}; L.all.forEach((r) => { const k = partOf(r); cnt[k] = (cnt[k] || 0) + 1; }); if (L.b2csAll.length) cnt["7"] = L.b2csAll.length;
  const uniq = (xs) => Array.from(new Set(xs.filter((x) => x !== "" && x != null).map(String))).sort((a, c) => a.localeCompare(c, "en", { numeric: true }));
  const fo = {
    party: [["", "Customer: any"]].concat(Object.entries(parties).sort((a, c) => String(a[1]).localeCompare(String(c[1]))).map(([k, p]) => [k, p])),
    part: [["", "Every part"]].concat(R1_ORDER.filter((k) => cnt[k]).map((k) => [k, R1_PARTS[k] + " (" + cnt[k] + ")"])),
    pos: [["", "Place: any"]].concat(uniq(L.all.map((r) => r.pos).concat(L.b2csAll.map((x) => x.pos))).map((p) => [p, p])),
    rate: [["", "Rate: any"]].concat(uniq(L.all.map((r) => r.rate).concat(L.b2csAll.map((x) => x.rate))).map((x) => [x, x + "%"])),
    month: [["", "Every month"]].concat(uniq(L.all.map((r) => String(r.date).slice(0, 6))).map((m) => [m, GSTR.label(m)])),
  };
  const many = new Set(L.all.map((r) => String(r.date).slice(0, 6))).size > 1, any = Object.values(f).some(Boolean);
  const list = shown.slice(0, more);
  return <div className="bk-tablewrap"><table className="bk-table tg-fit gf-off" data-statement="" id="r1Bills">
    <thead><tr><th className="n">#</th><th className={"dt " + (thF("month") || "")}><span className="colh"><span>Date · Invoice no</span>{many && <HF k="month" label="Month" options={fo.month} />}</span></th><th className={"pty " + (thF("party") || "")}><span className="colh"><span>Customer · GSTIN</span><HF k="party" label="Customer" options={fo.party} /></span></th>
      <th className={thF("part")}><span className="colh"><span>Part</span><HF k="part" label="Part" options={fo.part} /></span></th>
      <th className={thF("pos")}><span className="colh"><span>Place of supply</span><HF k="pos" label="Place of supply" options={fo.pos} /></span></th>
      <th className={"n " + (thF("rate") || "")}><span className="colh"><span>Rate</span><HF k="rate" label="Rate" options={fo.rate} /></span></th>
      <th className="n">Taxable</th><th className="n">IGST</th><th className="n">CGST</th><th className="n">SGST</th><th className="n">Total</th></tr></thead>
    <tbody>
      {list.map((r, i) => <tr key={r.no + ":" + i} data-r1-bill="">
        <td className="n">{i + 1}</td><td className="dt">{day(r.date)}<div className="tg-sub code">{r.no}</div><div className="tg-sub"><SrcTag r={r} /></div></td>
        <td className="pty"><div className="tg-pty">{r.party}<div className="tg-sub">{r.gstin || "no GSTIN"}</div></div></td>
        <td><span className="tg-part" data-part-of={partOf(r)} title={R1_PARTS[partOf(r)]}>{R1_SHORT[partOf(r)]}</span></td><td>{r.pos || ""}</td><td className="n">{r.rate}%</td>
        <td className="n">{money(r.taxable)}</td><td className="n">{money(r.igst)}</td><td className="n">{money(r.cgst)}</td><td className="n">{money(r.sgst)}</td><td className="n">{money(total(r))}<div className="tg-sub">tax {money(r2(num(r.igst) + num(r.cgst) + num(r.sgst) + num(r.cess)))}</div></td></tr>)}
      {shown.length > list.length && <tr className="lt-more"><td colSpan={11} style={{ textAlign: "center" }}>
        <span className="note">{list.length} of {shown.length} bills shown · </span>
        <button type="button" className="linkbtn" data-r1-more="" onClick={() => setMore(more + 100)}>Show 100 more</button> · <button type="button" className="linkbtn" data-r1-all="" onClick={() => setMore(shown.length)}>Show all {shown.length}</button></td></tr>}
      {b2cs.length > 0 && <><tr className="tg-group"><td colSpan={11}><b>{R1_PARTS["7"]}</b><span className="note"> (summary by state and rate, as the portal takes it: not bills)</span></td></tr>
        {b2cs.map((x) => <tr key={x.id} data-r1-b2cs=""><td></td><td></td><td className="note">B2C others</td><td title={R1_PARTS["7"]}>{R1_SHORT["7"]}</td><td>{x.pos}</td><td className="n">{x.rate}%</td>
          <td className="n">{money(x.taxable)}</td><td className="n">{money(x.igst)}</td><td className="n">{money(x.cgst)}</td><td className="n">{money(x.sgst)}</td><td className="n">{money(total(x))}</td></tr>)}</>}
      {!shown.length && !b2cs.length && <tr><td colSpan={11}><p className="note" data-list-empty="" style={{ textAlign: "center" }}>No bill matches these filters.{any && <> <button type="button" className="linkbtn" data-r1-clear="" onClick={() => clearFilter("r1F")}>Clear filters</button></>}</p></td></tr>}
    </tbody>
    <tfoot><tr className="tg-tot" data-r1-foot=""><td colSpan={6}><b data-r1-count="">{shown.length} bill{shown.length === 1 ? "" : "s"}</b>{b2cs.length ? <span className="note"> + {b2cs.length} B2C summary line{b2cs.length === 1 ? "" : "s"}</span> : null}
      {shown.length !== L.all.length && <span className="note"> · of {L.all.length}</span>}{any && <> · <button type="button" className="linkbtn" data-r1-clear="" onClick={() => clearFilter("r1F")}>Clear filters</button></>}</td>
      <td className="n"><b data-r1-sum="taxable">{money(sum("taxable"))}</b></td><td className="n"><b data-r1-sum="igst">{money(sum("igst"))}</b></td><td className="n"><b data-r1-sum="cgst">{money(sum("cgst"))}</b></td><td className="n"><b data-r1-sum="sgst">{money(sum("sgst"))}</b></td>
      <td className="n"><b data-r1-sum="total">{money(r2(sum("taxable") + sum("igst") + sum("cgst") + sum("sgst") + sum("cess")))}</b></td></tr></tfoot>
  </table></div>;
}
