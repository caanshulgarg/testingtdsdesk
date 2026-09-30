// Under GSTR-1: invoices and credit notes the client's customers rejected in IMS, found by number and marked here,
// with the months that decide when a rejected credit note's tax is added back in 3.1(a). Was viewCustRejections
// (src/js/33). The records are CustIMS (33); changes go through custImsAdd, custImsSet, custImsRemove, custImsLetter.
//
// State: S.custImsQ (the number being looked for).
import CommitBox from "../../parts/CommitBox.jsx";

const money = (v) => INR.format(r2(v || 0));
const day = (d) => fmtDate(tallyDate(d));
const all4 = (x) => x.igst + x.cgst + x.sgst + (x.cess || 0);

// a month chosen for one record: every month in the books and the one after the last
function MonthSel({ x, k, v }) {
  const ms = GSTR.months().concat([CustIMS.nextYm(GSTR.months().slice(-1)[0] || x.rejYm)]).filter((z, i, a) => a.indexOf(z) === i);
  return <select aria-label={k} value={v || ""} onChange={(ev) => custImsSet(x.id, k, ev.target.value)}>{ms.map((z) => <option key={z} value={z}>{GSTR.label(z)}</option>)}</select>;
}

function Found({ hits, reg }) {
  if (!hits.length) return <p className="note">No invoice or note to a registered customer has that number.</p>;
  return <div className="bk-tablewrap"><table className="bk-table compact"><thead><tr><th>Document</th><th>Number</th><th className="dt">Date</th><th>Customer</th><th className="n">Tax</th><th></th></tr></thead>
    <tbody>{hits.map((r, i) => <tr key={r.id + ":" + i}>
      <td>{r.kind === "CDNR" ? "Credit note" : r.kind === "DBNR" ? "Debit note" : "Invoice"}</td><td>{r.no}</td><td>{day(r.date)}</td><td>{r.party}<div className="nr">{r.gstin}</div></td><td className="n">{money(all4(r))}</td>
      <td>{CustIMS.store(reg)[r.id] ? <span className="nr">already marked</span> : <button className="btn small" onClick={() => custImsAdd(r.id)}>Mark as rejected</button>}</td></tr>)}</tbody>
  </table></div>;
}

function Marked({ list }) {
  return <div className="bk-tablewrap"><table className="bk-table compact">
    <thead><tr><th>Document</th><th>Number</th><th className="dt">Date</th><th>Customer</th><th className="n">Tax</th><th>Rejected in</th><th>Added back in</th><th>What to do</th><th>Customer’s remark</th></tr></thead>
    <tbody>{list.map((x, i) => <tr key={x.id + ":" + i}>
      <td>{x.kind === "cn" ? "Credit note" : "Invoice"}{x.gone && <div className="bad">no longer in Tally</div>}</td><td>{x.no}</td><td>{day(x.date)}</td><td>{x.party}<div className="nr">{x.gstin}</div></td><td className="n">{money(x.tax)}</td>
      <td><MonthSel x={x} k="rejYm" v={x.rejYm} /></td>
      <td>{x.kind === "cn" ? <MonthSel x={x} k="addYm" v={x.addYm} /> : <span className="nr">tax stays</span>}</td>
      <td><select aria-label="What to do" value={x.act} onChange={(ev) => custImsSet(x.id, "act", ev.target.value)}>{CustIMS.ACTS[x.kind].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {x.kind === "cn" && x.act === "accepted" && <div className="nr">accepted in <MonthSel x={x} k="doneYm" v={x.doneYm || x.addYm} /></div>}
        <div><button className="linkbtn" onClick={() => custImsRemove(x.id)}>not rejected after all</button></div></td>
      <td><CommitBox aria-label="Customer’s remark" data-fk={"custimsr-" + x.id} value={x.remark || ""} placeholder="remark" style={{ width: "100%" }} onCommit={(v) => custImsSet(x.id, "remark", v)} /></td>
    </tr>)}</tbody>
  </table></div>;
}

export default function CustIms() {
  const reg = S.gstReg || "", list = CustIMS.items(reg), ym = S.gstYm || "", mo = CustIMS.month(ym, reg), q = S.custImsQ || "";
  const cs = CustIMS.customers(reg);
  return (
    <section className="dash-card" style={{ marginTop: 12 }}><h3>Rejected by customers in IMS</h3>
      <p className="note">Your customer’s IMS actions do not come to you in a file. When a customer tells you, or the portal shows, that they rejected one of your invoices or credit notes, find it here. A rejected credit note has its tax added back to your liability by the portal in the month after the rejection; that is put into 3.1(a) here too.</p>
      <div className="row" style={{ gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
        <input type="search" aria-label="Invoice or credit note number" data-fk="custimsq" value={q} placeholder="Invoice or credit note number" style={{ width: 260 }} onChange={(ev) => setAndShow("custImsQ", ev.target.value, true)} /></div>
      {q && <Found hits={CustIMS.find(reg, q)} reg={reg} />}
      {(mo.add.n || mo.back.n) ? <p className="note"><b>{GSTR.label(ym) + ", 3.1(a):"}</b>{" " + (mo.add.n ? "credit notes rejected by customers added back ₹" + money(all4(mo.add)) + " (" + mo.add.n + ")" : "") + (mo.add.n && mo.back.n ? "; " : "")
        + (mo.back.n ? "accepted later, taken out again ₹" + money(all4(mo.back)) + " (" + mo.back.n + ")" : "") + "."}</p> : null}
      {list.length > 0 && <Marked list={list} />}
      {cs.length > 0 && <p className="note" style={{ marginTop: 8 }}>Customers to write to, asking them to accept: {cs.map((c, i) => <span key={c.gstin}>{i > 0 && "; "}{c.party + " (" + c.items.length + ") "}
        <button className="linkbtn" onClick={() => custImsLetter(c.gstin)}>copy letter</button>
        {c.email && <>{" · "}<a href={"mailto:" + c.email + "?subject=" + encodeURIComponent("Documents rejected in IMS") + "&body=" + encodeURIComponent(CustIMS.letter(reg, c.gstin, c.party, c.items))}>email</a></>}</span>)}</p>}
    </section>
  );
}
