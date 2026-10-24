// The lines behind a figure of GSTR-3B table 4 (next-itc-simple): what the Final credit for 3B tab and the GSTR-3B screen
// open in a window (Pop) when a figure is clicked. 4(A)(5) is shown as it is made (ITCF, app/src/lib/itcFinal.js): the
// books' bills of the month, less what is not taken this month, plus what is taken now from another month or from 2B,
// suppliers' credit notes, reclaimed credit and the adjustments; the other lines are the bills behind them (portal.js
// r3bBills) and the adjustments. Each part's total, and their sum against the figure.
import { useState } from "react";
import { LinesTable } from "./ItcParts.jsx";
import { r3bBills } from "./portal.js";

const money = (v) => "₹" + INR.format(r2(v || 0));
const H = ["igst", "cgst", "sgst", "cess"];
const tot = (o) => r2(H.reduce((a, k) => a + num((o || {})[k]), 0));
const z = () => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
export const FIG_LABEL = { "4A1": "4(A)(1) Import of goods", "4A2": "4(A)(2) Import of services", "4A3": "4(A)(3) Inward supplies on reverse charge", "4A5": "4(A)(5) All other ITC", "4A": "4(A) Total ITC available",
  "4B1": "4(B)(1) Reversed: rules 38, 42, 43 and section 17(5)", "4B2": "4(B)(2) Reversed: others", "4C": "4(C) Net ITC available", "4D1": "4(D)(1) ITC reclaimed, reversed under 4(B)(2) earlier", "4D2": "4(D)(2) Ineligible ITC: section 16(4) and place of supply" };

const why = (r) => { const s = r.show || {}; return (s.code ? ITCF.DEC_LABEL[s.code] + (s.code === "later" && s.ym ? " · " + GSTR.label(s.ym) : "") : r.fixed || "") + (r.e && r.e.auto ? " (FinCom's rule)" : ""); };
const fromRows = (list) => (list || []).map((r) => ({ key: r.key, party: r.party, gstin: r.gstin, no: r.no || r.bookNo, date: r.date, amt: r.amt, why: why(r) }));
const fromBills = (bills) => bills.map((b) => ({ key: b.id || b.key, party: b.party, gstin: b.gstin, no: b.no, date: b.date, why: b.voucher ? "vch " + b.voucher : b.from2b ? "2B" : "", amt: H.reduce((o, k) => { o[k] = r2(num(b[k]) * (b.sg || 1)); return o; }, {}) }));
const adjLines = (reg, M, k) => (ITCAdj.list(reg, M).filter((a) => a.line === k)).map((a) => ({ key: a.id, party: "Adjustment", gstin: a.by || "", no: a.reason, date: "", why: "added in FinCom", amt: Object.assign(z(), { [a.head]: a.amt }) }));

function Part({ label, lines, sign = 1, open: open0 = false, id }) {
  const [open, setOpen] = useState(open0), sum = H.reduce((o, k) => { o[k] = r2(lines.reduce((a, x) => a + num((x.amt || {})[k]) * sign, 0)); return o; }, {});
  if (!lines.length) return null;
  return <div className="itc-part" data-fig-part={id}>
    <button type="button" className="itc-part-h" aria-expanded={open} onClick={() => setOpen(!open)}><span>{open ? "▾" : "▸"} {label} <span className="nr">({lines.length})</span></span>
      <span className="itc-part-sum">{H.map((k) => <span key={k}>{(k === "cess" ? "Cess" : k.toUpperCase()) + " " + money(sum[k])}</span>)}<b data-fig-part-total={id}>{money(tot(sum))}</b></span></button>
    {open && <LinesTable lines={lines} sign={sign} />}
  </div>;
}

// id: 4A1 4A2 4A3 4A5 4B1 4B2 4D1 4D2 4A 4C; t: GSTR.threeB of the month
export default function FigureDetail({ id, reg, M, t, onGo }) {
  const fig = { "4A1": t.impGoods, "4A2": t.impServ, "4A3": t.rcmIn, "4A5": t.other, "4B1": t.rev1, "4B2": t.rev2, "4C": t.netItc, "4D1": t.reclaim, "4D2": t.na, "4A": t.itc }[id] || z();
  const go = <p className="note" style={{ margin: "10px 0 0" }}><button type="button" className="linkbtn" data-pop-go="r2b" onClick={() => { onGo && onGo(); gstPartGo("r2b"); }}>Open in 2B reconciliation</button>
    {" · "}<button type="button" className="linkbtn" data-pop-go="itcfinal" onClick={() => { onGo && onGo(); gstPartGo("itcfinal"); }}>Final credit for 3B</button></p>;
  const head = <div className="itc-fig-head" data-fig={id}><b>{FIG_LABEL[id] || id}</b><span>{H.map((k) => <span key={k}>{(k === "cess" ? "Cess" : k.toUpperCase()) + " " + money(fig[k])}</span>)}<b data-fig-total="">{money(tot(fig))}</b></span></div>;
  if (id === "4A5") {
    const c = t.itcCats || { held: {}, excess: {}, released: {}, from2b: {}, cn2b: {}, rejBack: {} }, x = r3bBills("4A5", M, reg, t) || { bills: [] };
    const books = fromBills(x.bills.filter((b) => !b.from2b));
    const reclaim = H.some((k) => Math.abs(num((t.reclaim || {})[k])) > 0.004) ? [{ key: "reclaim", party: "ITC reclaimed", no: "4(D)(1)", amt: Object.assign(z(), t.reclaim) }] : [];
    const parts = [["books", "Bills in the books this month", books, 1], ["held", "Less: not taken this month (not in 2B, later month, follow-up, reversed)", fromRows(c.held.list), -1],
      ["excess", "Less: more tax in the books than in 2B (the lower is taken)", fromRows(c.excess.list), -1], ["released", "Add: taken now, booked in another month (carried forward or deferred)", fromRows(c.released.list), 1],
      ["from2b", "Add: taken now, only in 2B", fromRows(c.from2b.list), 1], ["cn2b", "Less: suppliers' credit notes in 2B, not in the books", fromRows(c.cn2b.list), -1],
      ["rejBack", "Add: our debit notes the supplier's credit note was rejected for in IMS", fromRows(c.rejBack.list), 1], ["reclaim", "Add: ITC reclaimed", reclaim, 1], ["adj", "Adjustments", adjLines(reg, M, "4A5"), 1]];
    const sum = z(); parts.forEach(([, , l, s]) => l.forEach((y) => H.forEach((k) => { sum[k] = r2(sum[k] + num((y.amt || {})[k]) * s); })));
    const off = H.some((k) => Math.abs(sum[k] - num(fig[k])) > 0.01);
    return <div data-fig-detail={id}>{head}
      {parts.map(([k, l, lines, s]) => <Part key={k} id={k} label={l} lines={lines} sign={s} open={k !== "books" && lines.length <= 30} />)}
      <p className={off ? "bad" : "note"} data-fig-check={off ? "off" : "ok"}>{off ? "These add up to " + money(tot(sum)) + ", not the figure: tell support." : "These add up to the figure: " + money(tot(sum)) + "."}</p>{go}</div>;
  }
  if (id === "4A" || id === "4C") {
    const rowsOf = id === "4A" ? [["4A1", t.impGoods, 1], ["4A2", t.impServ, 1], ["4A3", t.rcmIn, 1], ["4A5", t.other, 1]] : [["4A", t.itc, 1], ["4B1", t.rev1, -1], ["4B2", t.rev2, -1]];
    return <div data-fig-detail={id}>{head}<LinesTable lines={rowsOf.map(([k, o, s]) => ({ key: k, party: FIG_LABEL[k], no: s < 0 ? "less" : "", amt: H.reduce((a, h) => { a[h] = r2(num((o || {})[h]) * s); return a; }, {}) }))} />{go}</div>;
  }
  const x = r3bBills(id, M, reg, t) || { bills: [], adj: [] };
  const other = (x.adj || []).filter((a) => !/^Adjustments added in FinCom/.test(a.label)).map((a, i) => ({ key: "x" + i, party: a.label, amt: H.reduce((o, k) => { o[k] = num(a[k]); return o; }, {}) }));
  return <div data-fig-detail={id}>{head}
    <Part id="bills" label={id === "4D2" ? "Documents in 2B marked not available" : "Bills in the books"} lines={fromBills(x.bills)} open={x.bills.length <= 30} />
    <Part id="other" label="Worked out" lines={other} open />
    <Part id="adj" label="Adjustments" lines={adjLines(reg, M, id)} open />
    {!x.bills.length && !other.length && !adjLines(reg, M, id).length && <p className="note">Nothing this month.</p>}{go}</div>;
}
