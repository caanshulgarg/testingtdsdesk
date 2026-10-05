// Under GSTR-1: invoices and credit notes the client's customers rejected in IMS, found by number and marked here,
// with the months that decide when a rejected credit note's tax is added back in 3.1(a). Was viewCustRejections
// (src/js/33). The records are CustIMS (33); changes go through custImsAdd, custImsSet, custImsRemove, custImsLetter.
//
// State: S.custImsQ (the number being looked for).
import CommitBox from "../../parts/CommitBox.jsx";
import ListTable from "../../parts/ListTable.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => fmtDate(tallyDate(d));
const all4 = (x) => x.igst + x.cgst + x.sgst + (x.cess || 0);

// a month chosen for one record: every month in the books and the one after the last
function MonthSel({ x, k, v }) {
  const ms = GSTR.months().concat([CustIMS.nextYm(GSTR.months().slice(-1)[0] || x.rejYm)]).filter((z, i, a) => a.indexOf(z) === i);
  return <select aria-label={k} value={v || ""} onChange={(ev) => custImsSet(x.id, k, ev.target.value)}>{ms.map((z) => <option key={z} value={z}>{GSTR.label(z)}</option>)}</select>;
}

function Found({ hits, reg }) {
  if (!hits.length) return <p className="note">No invoice or note to a registered customer has that number.</p>;
  // the one list table (spec K6): date, number, customer, tax (amount), then the rest
  return <ListTable name="custImsFound" className="bk-table compact" rows={hits} rowKey={(r, i) => r.id + ":" + i} unit={["document", "documents"]}
    cols={[
      { k: "date", role: "date", label: "Date", cls: "dt", v: (r) => String(r.date || ""), cell: (r) => day(r.date) },
      { k: "no", role: "number", label: "Number", v: (r) => r.no || "", cell: (r) => r.no },
      { k: "party", role: "party", label: "Customer", v: (r) => r.party || "", cell: (r) => <>{r.party}<div className="nr">{r.gstin}</div></> },
      { k: "tax", role: "amount", label: "Tax", cls: "n", v: (r) => all4(r), fmt: money, cell: (r) => money(all4(r)) },
      { k: "doc", label: "Document", cell: (r) => (r.kind === "CDNR" ? "Credit note" : r.kind === "DBNR" ? "Debit note" : "Invoice") },
      { k: "ac", role: "act", cell: (r) => (CustIMS.store(reg)[r.id] ? <span className="nr">already marked</span> : <button className="btn small" onClick={() => custImsAdd(r.id)}>Mark as rejected</button>) },
    ]} />;
}

function Marked({ list }) {
  // the one list table (spec K6): date, number, customer, tax (amount), what to do (status), then the rest
  return <ListTable name="custImsMarked" className="bk-table compact" rows={list} rowKey={(x, i) => x.id + ":" + i} unit={["document", "documents"]}
    cols={[
      { k: "date", role: "date", label: "Date", cls: "dt", v: (x) => String(x.date || ""), cell: (x) => day(x.date) },
      { k: "no", role: "number", label: "Number", v: (x) => x.no || "", cell: (x) => x.no },
      { k: "party", role: "party", label: "Customer", v: (x) => x.party || "", cell: (x) => <>{x.party}<div className="nr">{x.gstin}</div></> },
      { k: "tax", role: "amount", label: "Tax", cls: "n", v: (x) => num(x.tax), fmt: money, cell: (x) => money(x.tax) },
      { k: "act", role: "status", label: "What to do", v: (x) => x.act || "", cell: (x) => <><select aria-label="What to do" value={x.act} onChange={(ev) => custImsSet(x.id, "act", ev.target.value)}>{CustIMS.ACTS[x.kind].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {x.kind === "cn" && x.act === "accepted" && <div className="nr">accepted in <MonthSel x={x} k="doneYm" v={x.doneYm || x.addYm} /></div>}
        <div><button className="linkbtn" onClick={() => custImsRemove(x.id)}>not rejected after all</button></div></> },
      { k: "doc", label: "Document", cell: (x) => <>{x.kind === "cn" ? "Credit note" : "Invoice"}{x.gone && <div className="bad">no longer in Tally</div>}</> },
      { k: "rej", label: "Rejected in", cell: (x) => <MonthSel x={x} k="rejYm" v={x.rejYm} /> },
      { k: "add", label: "Added back in", cell: (x) => (x.kind === "cn" ? <MonthSel x={x} k="addYm" v={x.addYm} /> : <span className="nr">tax stays</span>) },
      { k: "rem", label: "Customer’s remark", cell: (x) => <CommitBox aria-label="Customer’s remark" data-fk={"custimsr-" + x.id} value={x.remark || ""} placeholder="remark" style={{ width: "100%" }} onCommit={(v) => custImsSet(x.id, "remark", v)} /> },
    ]} />;
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
