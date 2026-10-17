// GSTR-2B as the portal shows it (round 72, 17-Oct-2026): the summary laid out as the 2B summary PDF (ITC available and
// not available, Part A and Part B, the GSTR-3B table each goes to), and the documents section by section (B2B, B2BA,
// CDNR, CDNRA, ECO, ISD, ISDA, IMPG, IMPGSEZ) with the portal's column headings. The documents are those brought in
// (GST2B.all2b, src/js/11); nothing is matched or worked out here.
import { useState } from "react";
import { TWOB_SECTIONS, twoBSummary, twoBRows, posName } from "./portal.js";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (/^\d{8}$/.test(String(d || "")) ? fmtDate(tallyDate(d)) : String(d || ""));
const H4 = [["igst", "Integrated Tax"], ["cgst", "Central Tax"], ["sgst", "State/UT Tax"], ["cess", "Cess"]];
const ITC = [["avl", "ITC available"], ["nav", "ITC not available"], ["rej", "Rejected in IMS"]];
const yes = (v) => (v ? "Yes" : "No");

// the portal's columns of a section: [heading, (row) => value, numeric]
const COLS = {
  inv: [["GSTIN of supplier", (r) => r.gstin], ["Trade/Legal name", (r) => r.party], ["Invoice number", (r) => r.no], ["Invoice type", (r) => ({ R: "Regular", SEZWP: "SEZ with payment", SEZWOP: "SEZ without payment", DE: "Deemed Exp", CBW: "Intra-State supplies attracting IGST" })[r.typ] || r.typ || "Regular"],
    ["Invoice date", (r) => day(r.date)], ["Invoice value", (r) => r.val, 1], ["Place of supply", (r) => posName(r.pos)], ["Supply attract reverse charge", (r) => yes(r.rcm)]],
  nt: [["GSTIN of supplier", (r) => r.gstin], ["Trade/Legal name", (r) => r.party], ["Note number", (r) => r.no], ["Note type", (r) => (r.dir < 0 ? "Credit Note" : "Debit Note")], ["Note date", (r) => day(r.date)],
    ["Note value", (r) => r.val, 1], ["Place of supply", (r) => posName(r.pos)], ["Supply attract reverse charge", (r) => yes(r.rcm)]],
  isd: [["GSTIN of ISD", (r) => r.gstin], ["Trade/Legal name", (r) => r.party], ["ISD document type", (r) => (r.dir < 0 ? "ISD Credit Note" : "ISD Invoice")], ["ISD document number", (r) => r.no], ["ISD document date", (r) => day(r.date)]],
  impg: [["Port / reference", (r) => r.party], ["Bill of entry number", (r) => r.no], ["Bill of entry date", (r) => day(r.date)]],
  impgsez: [["GSTIN of supplier", (r) => r.gstin], ["Trade/Legal name", (r) => r.party], ["Bill of entry number", (r) => r.no], ["Bill of entry date", (r) => day(r.date)]],
};
const colsOf = (sec) => (sec === "b2ba" ? [["Original invoice number", (r) => r.oNo], ["Original invoice date", (r) => day(r.oDate)]].concat(COLS.inv)
  : sec === "cdnra" ? [["Original note number", (r) => r.oNo], ["Original note date", (r) => day(r.oDate)]].concat(COLS.nt)
  : sec === "cdnr" ? COLS.nt : sec === "isd" ? COLS.isd : sec === "impg" ? COLS.impg : sec === "impgsez" ? COLS.impgsez : COLS.inv);
const tail = (sec) => [["GSTR-1/IFF/GSTR-5 Period", (r) => (r.supPrd ? GSTR.label(String(r.supPrd).slice(2) + String(r.supPrd).slice(0, 2)) : "")], ["GSTR-1/IFF/GSTR-5 Filing Date", (r) => r.filedOn || ""],
  ["ITC Availability", (r) => (r.itcavl === "N" ? "No" : "Yes")], ["Reason", (r) => (r.rsn ? GST2B.RSN[r.rsn] || r.rsn : "")]].concat(sec === "b2b" ? [["IRN", (r) => r.irn || ""]] : []);

function Summary({ s, onPick }) {
  const block = (title, parts, id) => <table className="bk-table tg-fit gf-off" data-statement="" data-2b-sum={id}>
    <thead><tr><th className="r3b-title" colSpan={7}>{title}</th></tr><tr><th className="n">S.no.</th><th>Heading</th><th>GSTR-3B table</th>{H4.map(([k, h]) => <th key={k} className="n">{h}</th>)}</tr></thead>
    <tbody>{parts.map((P) => [<tr key={P.head} className="tg-group"><td colSpan={7}><b>{P.head}</b>{P.part === "B" && <span className="note"> · credit notes, which reduce the credit</span>}</td></tr>,
      P.rows.map((g) => { const tot = g.lines.reduce((a, l) => { H4.forEach(([k]) => { a[k] = r2(a[k] + l[k]); }); return a; }, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
        return [<tr key={P.head + g.group} data-2b-group={P.part + g.group}><td className="n"><b>{g.group}</b></td><td><b>{g.label}</b></td><td>{g.t3b}</td>{H4.map(([k]) => <td key={k} className="n"><b>{money(Math.abs(tot[k]))}</b></td>)}</tr>,
          g.lines.map((l, i) => <tr key={P.head + g.group + i} className={l.n ? "tg-click" : undefined} onClick={l.n ? () => onPick(l.sec, id) : undefined} data-2b-line=""><td></td><td>{l.label}{l.n ? <span className="note"> · {l.n}</span> : null}</td><td></td>
            {H4.map(([k]) => <td key={k} className="n">{money(Math.abs(l[k]))}</td>)}</tr>)]; })])}</tbody></table>;
  return <div data-2b-summary="">
    <div className="bk-tablewrap">{block("ITC Available", s.available, "avl")}</div>
    <div className="bk-tablewrap" style={{ marginTop: 12 }}>{block("ITC not available", s.notAvailable, "nav")}</div>
    <p className="note">Amounts as the summary shows them (credit notes as positive figures, in Part B). {s.rejected.n ? s.rejected.n + " document" + (s.rejected.n === 1 ? "" : "s") + " rejected in IMS give no credit: see “Rejected in IMS”. " : ""}
      ECO and ISDA documents are not read from the 2B file by FinCom yet; check them on the portal if the supplier reports any.</p>
  </div>;
}

function Section({ sec, rows }) {
  const [more, setMore] = useState(100);
  const cols = colsOf(sec.id).concat([["Taxable value", (r) => r.taxable, 1]], H4.map(([k, h]) => [h, (r) => r[k], 1]), tail(sec.id));
  const list = rows.slice(0, more), net = (k) => r2(rows.reduce((a, r) => a + num(r[k]) * (r.dir || 1), 0));
  const firstN = cols.findIndex((c) => c[0] === "Taxable value");
  return <section className="r1p" data-2b-section={sec.id}><h3 className="r1p-h"><span className="r1p-no">{sec.name}</span> – {sec.title.replace(/^[A-Z]+ – /, "")}<span className="note"> · {rows.length} document{rows.length === 1 ? "" : "s"}</span></h3>
    <div className="bk-tablewrap"><table className="bk-table tg-fit gf-off" data-statement="">
      <thead><tr><th className="n">#</th>{cols.map(([h, , n]) => <th key={h} className={n ? "n" : undefined}>{h}</th>)}</tr></thead>
      <tbody>{list.map((r, i) => <tr key={r.key || i} data-2b-row=""><td className="n">{i + 1}</td>{cols.map(([h, f, n]) => <td key={h} className={n ? "n" : undefined}>{n ? money(f(r)) : f(r)}</td>)}</tr>)}
        {rows.length > list.length && <tr className="lt-more"><td colSpan={cols.length + 1} style={{ textAlign: "center" }}><span className="note">{list.length} of {rows.length} shown · </span>
          <button type="button" className="linkbtn" onClick={() => setMore(more + 100)}>Show 100 more</button> · <button type="button" className="linkbtn" onClick={() => setMore(rows.length)}>Show all {rows.length}</button></td></tr>}
        {!rows.length && <tr><td colSpan={cols.length + 1} className="note">{sec.unread ? "FinCom does not read this section of the 2B file yet." : "Nothing in this section."}</td></tr>}</tbody>
      {rows.length > 0 && <tfoot><tr className="tg-tot" data-2b-foot={sec.id}><td colSpan={firstN + 1}><b>Total</b>{rows.some((r) => r.dir < 0) && <span className="note"> · credit notes taken off</span>}</td>
        {cols.slice(firstN).map(([h, , n], i) => <td key={h} className={n ? "n" : undefined}>{n ? <b data-2b-sum={["taxable", "igst", "cgst", "sgst", "cess"][i]}>{money(net(["taxable", "igst", "cgst", "sgst", "cess"][i]))}</b> : ""}</td>)}</tr></tfoot>}
    </table></div></section>;
}

export default function TwoBPortal({ reg, months, label }) {
  const all = twoBRows(reg, months), itc = S.r2bItc || "avl", pick = S.r2bSec || "summary";
  const inItc = (r) => (itc === "rej" ? r.rej : itc === "nav" ? r.itcavl === "N" && !r.rej : r.itcavl !== "N" && !r.rej);
  const rows = all.filter(inItc), s = twoBSummary(all);
  const go = (k, v) => { S[k] = v; render(); };
  const count = (id) => rows.filter((r) => r.sec === id).length;
  return <div data-2b-portal="">
    <div className="tg-tabrow r2-tabrow">
      <nav className="sbar rp-tabs" aria-label="GSTR-2B section">
        <button aria-selected={pick === "summary"} data-2b-sec="summary" onClick={() => go("r2bSec", "summary")}>Summary</button>
        {TWOB_SECTIONS.map((x) => <button key={x.id} aria-selected={pick === x.id} data-2b-sec={x.id} onClick={() => go("r2bSec", x.id)} title={x.title}>{x.name}{count(x.id) ? <> <span className="sbar-n">{count(x.id)}</span></> : null}</button>)}
      </nav>
      {pick !== "summary" && <div className="tg-tabside"><nav className="sbar subnav" aria-label="ITC" data-2b-itc={itc}>{ITC.map(([k, l]) => <button key={k} aria-selected={itc === k} onClick={() => go("r2bItc", k)}>{l}</button>)}</nav></div>}
    </div>
    <p className="note" style={{ margin: "4px 2px 10px" }}>GSTR-2B for {label}{pick === "summary" ? "" : " · Part A, " + (itc === "avl" ? "ITC available" : itc === "nav" ? "ITC not available" : "rejected in IMS")}.</p>
    {pick === "summary" ? <Summary s={s} onPick={(sec, id) => { S.r2bSec = sec; S.r2bItc = id === "nav" ? "nav" : "avl"; render(); }} /> : <Section sec={TWOB_SECTIONS.find((x) => x.id === pick)} rows={rows.filter((r) => r.sec === pick)} />}
  </div>;
}
