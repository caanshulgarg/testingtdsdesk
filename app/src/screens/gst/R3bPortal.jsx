// GSTR-3B as the portal lays it out (round 72, 17-Oct-2026): its tables 3.1, 3.1.1, 3.2, 4, 5, 5.1 and 6.1 with the
// portal's row labels and column heads (portal.js r3bTables), every figure GSTR.threeB's. A figure opens the bills behind
// it (portal.js r3bBills: the same tests on the same rows as GSTR.threeBm) and what is added to them, with their total
// against the figure; 4(B)(2) and 4(D)(1) are typed here as on the portal (gst3bSet, as the Details tab).
// next-itc-simple (the owner, 24-Oct-2026: "in 3B if we want to see the hyperlink detail it should pop up a window rather
// than showing it below"): every figure opens a window (Pop: ✕ or Esc closes it) with the rows behind it; table 4 as the
// Final credit for 3B tab shows it (ItcFigure.jsx), with "Open in 2B reconciliation"; 6.1 how each head is paid.
import { useState } from "react";
import CommitBox from "../../parts/CommitBox.jsx";
import { r3bTables, r3bBills, R3B_CLICK } from "./portal.js";
import { Pop } from "./ItcParts.jsx";
import FigureDetail, { FIG_LABEL } from "./ItcFigure.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (/^\d{8}$/.test(String(d || "")) ? fmtDate(tallyDate(d)) : String(d || ""));
const HEADW = { taxable: "Taxable", igst: "Integrated Tax", cgst: "Central Tax", sgst: "State/UT Tax", cess: "Cess" };

// a figure typed for the GSTIN and month (4(B)(2), 4(D)(1))
export function Typed({ b, grp, heads = ["igst", "cgst", "sgst", "cess"] }) {
  const v = (((b.gst3b || {})[(S.gstReg || "") + "|" + S.gstYm] || {})[grp] || {});
  return heads.map((k) => <td key={k} className="n">
    <CommitBox type="number" step="0.01" value={v[k] || ""} placeholder="0" aria-label={grp + " " + k.toUpperCase()} style={{ width: 100, textAlign: "right" }} onCommit={(val) => gst3bSet(grp + "." + k, val)} /></td>);
}

function Bills({ id, per, reg, t, label }) {
  const [more, setMore] = useState(100);
  const x = r3bBills(id, per, reg, t);
  if (!x) return null;
  const H = ["taxable"].concat(x.heads.filter((k) => k !== "taxable")), list = x.bills.slice(0, more);
  const sg = (r, k) => r2(num(r[k]) * (r.sg || 1));
  return <div className="r3b-bills" data-r3b-bills={id}>
    <div className="r3b-bills-h"><b>{label}</b><span className="note"> · {x.bills.length} document{x.bills.length === 1 ? "" : "s"}{x.adj.length ? " and " + x.adj.length + " adjustment" + (x.adj.length === 1 ? "" : "s") : ""}</span></div>
    <div className="itc-pop-table"><table className="bk-table tg-fit gf-off" data-statement="">
      <thead><tr><th className="n">#</th><th className="dt">Date</th><th>Number</th><th className="pty">Party · GSTIN</th>{H.map((k) => <th key={k} className="n">{HEADW[k]}</th>)}</tr></thead>
      <tbody>{list.map((r, i) => <tr key={i} data-r3b-bill=""><td className="n">{i + 1}</td><td className="dt">{day(r.date)}</td><td className="code">{r.no}{r.sg < 0 && <div className="tg-sub">{r.from2b ? "credit note (2B)" : "less: credit note"}</div>}</td>
        <td className="pty"><div className="tg-pty">{r.party || "—"}<div className="tg-sub">{r.gstin || "no GSTIN"}</div></div></td>{H.map((k) => <td key={k} className="n">{money(sg(r, k))}</td>)}</tr>)}
        {x.bills.length > list.length && <tr className="lt-more"><td colSpan={H.length + 4} style={{ textAlign: "center" }}><span className="note">{list.length} of {x.bills.length} shown · </span>
          <button type="button" className="linkbtn" onClick={() => setMore(more + 100)}>Show 100 more</button> · <button type="button" className="linkbtn" onClick={() => setMore(x.bills.length)}>Show all {x.bills.length}</button></td></tr>}
        {!x.bills.length && <tr><td colSpan={H.length + 4} className="note">No bills behind this figure{x.adj.length ? ": only the adjustments below" : ""}.</td></tr>}
        {x.adj.map((a, i) => <tr key={"a" + i} className="r3b-adj" data-r3b-adj=""><td></td><td colSpan={3}>{a.label}</td>{H.map((k) => <td key={k} className="n">{money(a[k])}</td>)}</tr>)}
      </tbody>
      <tfoot><tr className="tg-tot" data-r3b-bills-foot=""><td colSpan={4}><b>Total</b>{x.off.length ? <span className="bad"> · does not add up to the figure in {x.off.map((k) => HEADW[k]).join(", ")}</span> : <span className="note"> · the figure in the return</span>}</td>
        {H.map((k) => <td key={k} className="n"><b>{money(x.sum[k])}</b>{x.off.includes(k) && <div className="tg-sub">figure {money(x.figure[k])}</div>}</td>)}</tr></tfoot>
    </table></div>
  </div>;
}

// 6.1, one head: the tax payable, the credit used head by head, the cash, the credit carried
function PayDetail({ t, head }) {
  const P = t.pay || { use: {}, cash: {}, rcmCash: {}, carry: {} }, HW = { igst: "Integrated Tax", cgst: "Central Tax", sgst: "State/UT Tax", cess: "Cess" };
  const rowsP = [["Tax payable, 3.1 other than reverse charge (A)", num((t.net || {})[head])], ["Tax payable on reverse charge (B), paid in cash", num((t.rcmOut || {})[head])],
    ["Credit brought forward", num((t.opening || {})[head])], ["Net ITC of the month, 4(C)", num((t.netItc || {})[head])]]
    .concat(["igst", "cgst", "sgst", "cess"].map((c) => ["Paid with " + HW[c] + " credit", num(((P.use || {})[c] || {})[head])]))
    .concat([["Paid in cash (A)", r2(num((P.cash || {})[head]) - num((P.rcmCash || {})[head]))], ["Paid in cash (B), reverse charge", num((P.rcmCash || {})[head])], [HW[head] + " credit carried to next month", num((P.carry || {})[head])]]);
  return <div className="itc-pop-table" data-pay-detail={head}><table className="bk-table gf-off"><tbody>{rowsP.map(([l, v], i) => <tr key={i}><td>{l}</td><td className="n">{money(v)}</td></tr>)}</tbody></table>
    <p className="note">Credit is used as sections 49 and 49A and rule 88A require: IGST credit first, then CGST and SGST against their own tax and then IGST; CGST never against SGST; cess only against cess.</p></div>;
}

// under 6.1: the tax payable (A) + (B) by head, and the electronic credit ledger brought forward and carried (FinCom's working)
function Ledger({ t }) {
  const H = ["igst", "cgst", "sgst", "cess"], P = t.pay, line = (f) => H.map((k) => HEADW[k] + " " + money(f(k))).join(" · ");
  return <p className="note r3b-note" data-r3b-ledger="">Total tax payable, (A) + (B): {line((k) => r2(num((t.net || {})[k]) + num((t.rcmOut || {})[k])))}.<br />
    Credit brought forward: {line((k) => num((t.opening || {})[k]))}.<br />Credit carried to next month: {line((k) => num((P.carry || {})[k]))}.</p>;
}

export default function R3bPortal({ b, t }) {
  const ym = S.gstYm || "", reg = S.gstReg || "";
  const qrmp = typeof GSTSet === "object" && reg && GSTSet.typeOf(ym, reg) === "qrmp" && GSTSet.isQEnd(ym);
  const per = qrmp ? GSTSet.qStart(ym) + "-" + ym : ym;
  let j = null; try { j = GSTR.threeBJson(ym, reg); } catch (e) { j = null; }
  const tables = r3bTables(t, j), open = S.r3bOpen || "";
  const go = (id) => { S.r3bOpen = open === id ? "" : id; render(); };
  const close = () => { S.r3bOpen = ""; render(); };
  const openTb = open && tables.find((tb) => tb.rows.some((r) => r.id === open)), openRow = openTb && openTb.rows.find((r) => r.id === open);
  const is4 = /^4/.test(open), is61 = /^6\.1[AB]\|/.test(open);
  return <div data-r3b-portal="">
    {tables.map((tb) => {
      return <section key={tb.id} className="r3b-t" data-r3b-table={tb.id}>
        <div className="bk-tablewrap"><table className="bk-table tg-fit gf-off" data-statement="">
          <thead><tr><th className="r3b-title" colSpan={tb.head.length}>{tb.title}</th></tr>
            {tb.groups && <tr className="r3b-groups">{tb.groups.map(([g, n], i) => <th key={i} colSpan={n} className={g ? "r3b-grp" : undefined}>{g}</th>)}</tr>}
            <tr className="r3b-heads">{tb.head.map((h, i) => <th key={i} className={i ? "n" : undefined}>{h}</th>)}</tr></thead>
          <tbody>{tb.rows.length ? tb.rows.map((r) => r.group ? <tr key={r.id} className="tg-group" data-r3b-row={r.id}><td colSpan={tb.head.length}><b>{r.label}</b></td></tr>
            : <tr key={r.id} data-r3b-row={r.id} className={(r.total ? "tg-tot" : "") + (open === r.id ? " r3b-on" : "")}>
              <td>{r.total ? <b>{r.label}</b> : r.label}
                {r.fileDiff && <div className="tg-sub bad" data-r3b-filediff="">The GSTR-3B JSON carries a different figure here: {["igst", "cgst", "sgst", "cess"].map((k) => HEADW[k] + " " + money(r.fileDiff[k])).join(" · ")} (it also counts imported services, which are in 4(A)(2)). Check before filing.</div>}
                {r.typed && <div className="tg-sub">typed here, as on the portal</div>}</td>
              {r.typed ? <Typed b={b} grp={r.typed} /> : tb.cols.map((k) => { const v = r[k], click = R3B_CLICK.has(r.id) || tb.id === "6.1";
                return <td key={k} className="n">{v == null ? "" : click ? <button type="button" className="linkbtn r3b-fig" data-r3b-fig={r.id + "|" + k} title="See the bills behind this figure" onClick={() => go(r.id)}>{money(v)}</button> : money(v)}</td>; })}
            </tr>) : <tr><td colSpan={tb.head.length} className="note">None this month.</td></tr>}</tbody>
        </table></div>
        {tb.note && <p className="note r3b-note">{tb.note}</p>}
        {tb.id === "6.1" && t.pay && <Ledger t={t} />}
      </section>; })}
    <Pop open={!!openRow} onClose={close} id={"r3b-" + open} title={openRow ? (is4 ? FIG_LABEL[open] || "4 " + openRow.label : is61 ? "6.1 Payment of tax · " + openRow.label : (openTb.id + " " + openRow.label)) : ""}
      description={"GSTR-3B " + GSTR.label(ym) + " · the rows behind the figure"}>
      {openRow && (is4 ? <FigureDetail id={open} reg={reg} M={ym} t={t} onGo={close} /> : is61 ? <PayDetail t={t} head={openRow.head} /> : <Bills id={openRow.id} per={per} reg={reg} t={t} label={openTb.id + " " + openRow.label} />)}
      {openRow && !is4 && <p className="note" style={{ margin: "10px 0 0" }}><button type="button" className="linkbtn" data-pop-go="r2b" onClick={() => { close(); gstPartGo("r2b"); }}>Open in 2B reconciliation</button></p>}
    </Pop>
    {t.basis === "2b" && t.held && t.released && (t.held.n > 0 || t.released.n > 0) && <p className="note">Credit in 4(A)(5) is as far as this month's 2B shows it: {t.held.n ? t.held.n + " bill" + (t.held.n === 1 ? "" : "s") + " held back. " : ""}{t.released.n ? t.released.n + " booked earlier taken now. " : ""}Click 4(A)(5) to see them.</p>}
  </div>;
}
