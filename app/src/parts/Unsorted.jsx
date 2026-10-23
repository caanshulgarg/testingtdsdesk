// Uploads for any client that matched no client: move each to a client, or delete it. Was viewInbox() in src/js/18.
import DocqPanel from "./Docq.jsx";
import ListTable from "./ListTable.jsx";

export default function Unsorted() {
  const items = Object.values(S.inbox).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!items.length && docqFor("").length) return <DocqPanel cid="" />;
  if (!items.length) return <div className="pane" style={{ marginTop: 0 }}><h2>Nothing unsorted</h2><p className="note lt-empty" data-list-empty="" style={{ margin: 0, border: 0 }}>Invoices uploaded from the client list land here only when their buyer does not match a client. To add bills, use <b>Upload invoices for any client</b> on Clients.</p></div>;
  const drop = (id) => { delete S.inbox[id]; delete S.files[id]; Store.deleteInbox(id); render(); };
  // deleting removes the file for good, so it is asked first, naming the file (spec K9)
  const ask = (i) => askConfirm({ title: "Delete " + i.fileName + "?", ok: "Delete", danger: true,
    body: '<p class="note">The file and what was read from it are removed from FinCom. This cannot be undone.</p>' }).then((a) => { if (a && a.ok !== false) drop(i.id); });
  // the one list table (spec K6): date, number (the file), party, amount, then the rest
  return <ListTable name="unsorted" className="data" rows={items} rowKey={(i) => i.id} unit={["file", "files"]}
    cols={[
      { k: "date", role: "date", label: "Bill date", v: (i) => (i.j || {}).invoiceDate || "", cell: (i) => ((i.j || {}).invoiceDate ? fmtDate((i.j || {}).invoiceDate) : "—") },
      { k: "file", role: "number", label: "File", v: (i) => i.fileName || "", cell: (i) => <>{i.fileName}{(i.j || {}).invoiceNo && <div className="note">{"Bill " + i.j.invoiceNo}</div>}</> },
      { k: "sup", role: "party", label: "Supplier", v: (i) => (i.j || {}).vendorName || "", cell: (i) => (i.reading ? <span className="tag no">Reading…</span> : (i.j || {}).vendorName || "—") },
      { k: "tot", role: "amount", label: "Total", cls: "n", v: (i) => num((i.j || {}).totalAmount) || null, cell: (i) => ((i.j || {}).totalAmount ? money((i.j || {}).totalAmount) : "—") },
      { k: "to", label: "Billed to", v: (i) => (i.j || {}).buyerName || "", cell: (i) => <>{(i.j || {}).buyerName || "—"}{(i.j || {}).buyerGstin && <div className="note">{i.j.buyerGstin}</div>}</> },
      { k: "why", label: "Why it is here", td: () => ({ className: "note" }), cell: (i) => i.note || "" },
      { k: "move", label: "Move to", cell: (i) => !i.reading && <select value="" aria-label="Move to client" onChange={(e) => e.target.value && assignInbox(i.id, e.target.value)}>
          <option value="">Choose client…</option>{sortedCompanies().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select> },
      { k: "ac", role: "act", cls: "n", cell: (i) => !i.reading && <button className="btn small danger" onClick={() => ask(i)}>Delete</button> },
    ]} />;
}
