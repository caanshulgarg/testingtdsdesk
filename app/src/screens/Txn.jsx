// Transactions: everything filed for this client in one register — purchase bills, sales invoices or bank lines —
// with where each stands in Tally and its document. Was viewTransactions (src/js/03). The rows are made by
// txnRowsBills / txnRowsSales / txnRowsBank and filtered by txnFiltered (src/js/03), shared with the CSV download.
import ColHead from "../parts/ColHead.jsx";
import { ChipBar, NoMatch } from "../parts/ChipBar.jsx";

const amt = (v) => (v ? money(r2(v)) : "—");
const STATUS = [["", "Any status"], ["ok", "In Tally"], ["warn", "Ready or held"], ["no", "Not posted"], ["bad", "Refused by Tally"]];

function Doc({ r }) {
  if (!r.file) return "—";
  if (!r.hasFile) return <span className="note" title="The file was uploaded before documents were kept, or on another computer">{r.file.slice(0, 18)}</span>;
  const key = r.kind === "bank" ? "st:" + r.stId : r.kind === "sale" ? "sv:" + r.id : r.id;
  return <>
    <button className="linkbtn" title={"Open " + r.file} onClick={() => txnOpenDoc(key, r.docPath, r.file)}>📎 {r.file.slice(0, 18)}</button>
    <div className="nr">{r.docPath ? <span className="tag ok" title="Anyone in the firm can open it, from any computer">in the firm account</span>
      : <span className="tag" title="It is on this computer only">this computer only</span>}</div>
  </>;
}

export default function Txn() {
  const co = CO(), tab = txnTab();
  const all = tab === "bills" ? txnRowsBills() : tab === "sales" ? txnRowsSales() : txnRowsBank();
  if (all === null) {
    if (tab === "sales" && (!S.sales || S.sales.cid !== co.id)) loadSales(co.id).then(() => render());
    if (tab === "bank" && (!S.bank || S.bank.cid !== co.id)) loadBank(co.id).then(() => render());
    return <p className="note">Opening…</p>;
  }
  if (!S.fileIndex || S.fileIndexCid !== co.id) { S.fileIndexCid = co.id; FileStore.index(co.id).then(() => render()); }
  const rows = txnFiltered(all), bank = tab === "bank", c = txnColShown;
  const kinds = [["bills", "Purchase", txnRowsBills().length], ["sales", "Sales", S.sales && S.sales.cid === co.id ? S.sales.list.length : null], ["bank", "Bank", S.bank && S.bank.cid === co.id ? S.bank.rows.length : null]];
  return <>
    <nav className="sbar" aria-label="Kind">{kinds.map(([id, label, n]) =>
      <button key={id} aria-selected={tab === id} onClick={() => txnTabGo(id)}>{label}{n != null && <> <span className="sbar-n">{n}</span></>}</button>)}</nav>
    <div className="revfilter">
      <input type="search" value={S.txnQ || ""} placeholder="Find by invoice no., party, file or amount" aria-label="Find a transaction"
        onChange={(ev) => { S.txnQ = ev.target.value; FinComReact.redraw(); later("txnq", render, 250); }} />
      <select aria-label="Status" value={S.txnStatus || ""} onChange={(ev) => { S.txnStatus = ev.target.value; render(); }}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <span className="note">{rows.length} of {all.length}</span>
      <button className="btn small primary" onClick={() => txnExcel()}>Excel</button>
      <button className="btn small" onClick={() => txnCsv()}>CSV</button>
      <details className="colpick"><summary className="btn small">Columns</summary>
        <div className="colpick-box">{TXN_COLS.map(([k, label]) => <label key={k} className="chk"><input type="checkbox" checked={txnColShown(k)} onChange={() => txnColToggle(k)} /> {label}</label>)}</div></details>
    </div>
    <ChipBar t="txn" shown={rows.length} total={all.length + (bank ? " lines" : tab === "sales" ? " invoices" : " bills")} />
    {/* the first columns stay while the rest scrolls sideways; the scroll bar is always shown (review item 30) */}
    <div className="bk-tablewrap txnwrap">
      <table className="bk-table txntbl">
        <thead><tr>
          <th className="n stick1">S. no.</th>{c("date") && <ColHead t="txn" k="date" label="Date" cls="dt stick2" />}{c("vch") && <ColHead t="txn" k="vch" label="Voucher" />}
          {c("no") && <ColHead t="txn" k="no" label={bank ? "Reference" : "Invoice no."} />}{c("party") && <ColHead t="txn" k="party" label={tab === "sales" ? "Customer" : "Party"} />}
          {c("amts") && (bank ? <><th className="n">Withdrawal ₹</th><th className="n">Deposit ₹</th></> : <><th className="n">Taxable ₹</th><th className="n">GST ₹</th></>)}
          {c("val") && <ColHead t="txn" k="val" label={bank ? "Amount ₹" : "Invoice value ₹"} cls="n" />}{c("status") && <ColHead t="txn" k="status" label="In Tally" />}{c("doc") && <ColHead t="txn" k="doc" label="Document" />}<th className="ac"></th>
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.kind + r.id}>
            <td className="n stick1">{i + 1}</td>
            {c("date") && <td className="stick2">{r.date ? fmtDate(r.date) : "—"}{r.up && <div className="nr">up {fmtDate(r.up)}</div>}</td>}
            {c("vch") && <td>{r.vch}</td>}{c("no") && <td>{r.no || "—"}</td>}{c("party") && <td>{r.party}</td>}
            {c("amts") && (bank ? <><td className="n">{amt(r.dr)}</td><td className="n">{amt(r.cr)}</td></> : <><td className="n">{amt(r.taxable)}</td><td className="n">{amt(r.gst)}</td></>)}
            {c("val") && <td className="n">{amt(r.total)}</td>}{c("status") && <td><span className={"tag " + r.cls}>{r.label}</span></td>}
            {c("doc") && <td><Doc r={r} /></td>}
            <td className="ac"><button className="btn small" onClick={() => txnGo(r.kind, r.id)}>Open</button></td>
          </tr>))}</tbody>
      </table>
      {!rows.length && (S.txnQ || S.txnStatus || txnColOn() ? <NoMatch t="txn" /> : <div className="bk-none">Nothing here yet.</div>)}
    </div>
  </>;
}
