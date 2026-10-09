// Transactions: everything filed for this client in one register — purchase bills, sales invoices or bank lines —
// with where each stands in Tally and its document. Was viewTransactions (src/js/03). The rows are made by
// txnRowsBills / txnRowsSales / txnRowsBank and filtered by txnFiltered (src/js/03), shared with the CSV download.
import { useLayoutEffect, useRef, useState } from "react";
import { ColFunnel } from "../parts/ColHead.jsx";
import ListTable from "../parts/ListTable.jsx";
import Loading from "../parts/Loading.jsx";
import { ChipBar, NoMatch } from "../parts/ChipBar.jsx";

const amt = (v) => (v ? money(r2(v)) : "—");
const STATUS = [["", "Any status"], ["ok", "In Tally"], ["warn", "Ready or held"], ["no", "Not posted"], ["bad", "Refused by Tally"], ["dup", "Duplicates"], ["del", "Deleted"]];

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
  // still loading (spec K7): "Loading…" over a skeleton, never an empty list that is not empty
  if (all === null || (tab === "bank" && S.bank && S.bank.loading) || (tab === "sales" && S.sales && S.sales.loading)) {
    if (all === null && tab === "sales" && (!S.sales || S.sales.cid !== co.id)) loadSales(co.id).then(() => render());
    if (all === null && tab === "bank" && (!S.bank || S.bank.cid !== co.id)) loadBank(co.id).then(() => render());
    return <Loading what={tab === "sales" ? "sales invoices" : "bank lines"} />;
  }
  if (!S.fileIndex || S.fileIndexCid !== co.id) { S.fileIndexCid = co.id; FileStore.index(co.id).then(() => render()); }
  const rows = txnFiltered(all), bank = tab === "bank", c = txnColShown;
  const kinds = [["bills", "Purchase", txnRowsBills().filter((r) => r.e.status !== "deleted").length], ["sales", "Sales", S.sales && S.sales.cid === co.id ? S.sales.list.length : null], ["bank", "Bank", S.bank && S.bank.cid === co.id ? S.bank.rows.length : null]];
  return <>
    <nav className="sbar" aria-label="Kind">{kinds.map(([id, label, n]) =>
      <button key={id} aria-selected={tab === id} onClick={() => txnTabGo(id)}>{label}{n != null && <> <span className="sbar-n">{n}</span></>}</button>)}</nav>
    <div className="revfilter">
      <input type="search" value={S.txnQ || ""} placeholder="Find by invoice no., party, file or amount" aria-label="Find a transaction"
        onChange={(ev) => { S.txnQ = ev.target.value; FinComReact.redraw(); later("txnq", render, 250); }} />
      <select aria-label="Status" value={S.txnStatus || ""} onChange={(ev) => { S.txnStatus = ev.target.value; render(); }}>{STATUS.filter(([v]) => tab === "bills" || (v !== "dup" && v !== "del")).map(([v, l]) => <option key={v} value={v}>{l + (v === "dup" || v === "del" ? " (" + all.filter((r) => r.e && r.e.status === (v === "dup" ? "duplicate" : "deleted")).length + ")" : "")}</option>)}</select>
      <span className="note">{rows.length} of {all.filter((r) => !(r.e && r.e.status === "deleted")).length}</span>
      <button className="btn small primary" onClick={() => txnExcel()}>Excel</button>
      <button className="btn small" onClick={() => txnCsv()}>CSV</button>
      <details className="colpick"><summary className="btn small">Columns</summary>
        <div className="colpick-box">{TXN_COLS.map(([k, label]) => <label key={k} className="chk"><input type="checkbox" checked={txnColShown(k)} onChange={() => txnColToggle(k)} /> {label}</label>)}</div></details>
    </div>
    <ChipBar t="txn" shown={rows.length} total={all.length + (bank ? " lines" : tab === "sales" ? " invoices" : " bills")} />
    {/* the first columns stay while the rest scrolls sideways; the scroll bar is always shown (review item 30). The one list
        table (spec K6): date, number, party, amount, status, then the rest; sorting, the header in view, the foot */}
    <ListTable name={"txn-" + tab} className="bk-table txntbl" wrap={SideScroll} rows={rows} rowKey={(r) => r.kind + r.id} unit={bank ? ["line", "lines"] : tab === "sales" ? ["invoice", "invoices"] : ["bill", "bills"]}
      of={all.filter((r) => !(r.e && r.e.status === "deleted")).length}
      empty={S.txnQ || S.txnStatus || txnColOn() ? <>Nothing matches. <button className="linkbtn" onClick={() => { S.txnQ = ""; S.txnStatus = ""; colChipAll("txn"); }}>Clear the search and filters</button> to see everything.</>
        : bank ? "No bank lines yet. Use Upload statement on the Bank page to add a statement." : tab === "sales" ? "No sales invoices yet. Use Upload invoices on the Sales page, or Create invoice there." : "No purchase bills yet. Use Upload bills on the Purchase page to add them."}
      cols={[
        { k: "sno", role: "row", label: "S. no.", cls: "n stick1", cell: (r, p, i) => i + 1 },
        c("date") && { k: "date", role: "date", label: "Date", cls: "dt stick2", filter: <ColFunnel t="txn" k="date" label="Date" />, v: (r) => r.date || "", cell: (r) => <>{r.date ? fmtDate(r.date) : "—"}{r.up && <div className="nr">uploaded {fmtDate(r.up)}</div>}</> },
        c("no") && { k: "no", role: "number", label: bank ? "Reference" : "Invoice no.", filter: <ColFunnel t="txn" k="no" label={bank ? "Reference" : "Invoice no."} />, v: (r) => r.no || "", cell: (r) => r.no || "—" },
        c("party") && { k: "party", role: "party", label: tab === "sales" ? "Customer" : "Party", filter: <ColFunnel t="txn" k="party" label={tab === "sales" ? "Customer" : "Party"} />, v: (r) => r.party || "", cell: (r) => r.party },
        c("val") && { k: "val", role: "amount", label: bank ? "Amount ₹" : "Invoice value ₹", cls: "n", filter: <ColFunnel t="txn" k="val" label={bank ? "Amount ₹" : "Invoice value ₹"} />, v: (r) => num(r.total) || null, sum: (r) => num(r.total), cell: (r) => amt(r.total) },
        c("status") && { k: "status", role: "status", label: "In Tally", filter: <ColFunnel t="txn" k="status" label="In Tally" />, v: (r) => r.label || "", cell: (r) => <span className={"tag " + r.cls}>{r.label}</span> },
        c("vch") && { k: "vch", label: "Voucher", filter: <ColFunnel t="txn" k="vch" label="Voucher" />, v: (r) => r.vch || "", td: (r) => ({ title: r.vchNote ? r.vch + ": " + r.vchNote : undefined, "data-vch-note": r.vchNote ? "" : undefined }),
          cell: (r) => <>{r.vch}{r.vchNote && <div className="nr">(client setting)</div>}</> },
        c("amts") && { k: "a1", label: bank ? "Withdrawal ₹" : "Taxable ₹", cls: "n", v: (r) => num(bank ? r.dr : r.taxable) || null, sum: (r) => num(bank ? r.dr : r.taxable), cell: (r) => amt(bank ? r.dr : r.taxable) },
        c("amts") && { k: "a2", label: bank ? "Deposit ₹" : "GST ₹", cls: "n", v: (r) => num(bank ? r.cr : r.gst) || null, sum: (r) => num(bank ? r.cr : r.gst), cell: (r) => amt(bank ? r.cr : r.gst) },
        c("doc") && { k: "doc", label: "Document", filter: <ColFunnel t="txn" k="doc" label="Document" />, cell: (r) => <Doc r={r} /> },
        { k: "ac", role: "act", cls: "ac", cell: (r) => <button className="btn small" onClick={() => txnGo(r.kind, r.id)}>Open</button> },
      ]} />
  </>;
}

// review of 01-Oct-2026 (item 30 again): a Mac hides scroll bars until one scrolls, so the sign that more columns wait
// to the right is a fade at the right edge with an arrow, shown while there is more; the arrow scrolls along
function SideScroll({ children }) {
  const ref = useRef(null), [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
    if (ro) { ro.observe(el); if (el.firstElementChild) ro.observe(el.firstElementChild); }
    window.addEventListener("resize", check);
    return () => { el.removeEventListener("scroll", check); if (ro) ro.disconnect(); window.removeEventListener("resize", check); };
  });
  return <div className={"txnscroll" + (more ? " more" : "")}>
    <div className="bk-tablewrap txnwrap lt-wrap" ref={ref}>{children}</div>
    {more && <button className="txn-more" aria-label="More columns to the right" title="More columns to the right"
      onClick={() => ref.current && ref.current.scrollBy({ left: Math.max(240, ref.current.clientWidth * 0.6), behavior: "smooth" })}>›</button>}
  </div>;
}
