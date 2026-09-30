// Uploads for any client that matched no client: move each to a client, or delete it. Was viewInbox() in src/js/18.
import DocqPanel from "./Docq.jsx";

export default function Unsorted() {
  const items = Object.values(S.inbox).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!items.length && docqFor("").length) return <DocqPanel cid="" />;
  if (!items.length) return <div className="pane" style={{ marginTop: 0 }}><h2>Nothing unsorted</h2><p className="note" style={{ margin: 0 }}>Invoices uploaded from the client list land here only when their buyer does not match a client.</p></div>;
  const drop = (id) => { delete S.inbox[id]; delete S.files[id]; Store.deleteInbox(id); render(); };
  return (
    <div className="tblwrap">
      <table className="data">
        <thead><tr><th>File</th><th>Supplier</th><th>Billed to</th><th className="n">Total</th><th>Why it is here</th><th>Move to</th><th></th></tr></thead>
        <tbody>
          {items.map((i) => {
            const j = i.j || {};
            return (
              <tr key={i.id}>
                <td>{i.fileName}</td>
                <td>{i.reading ? <span className="tag no">Reading…</span> : j.vendorName || "—"}</td>
                <td>{j.buyerName || "—"}{j.buyerGstin && <div className="note">{j.buyerGstin}</div>}</td>
                <td className="n">{j.totalAmount ? money0(j.totalAmount) : "—"}</td>
                <td className="note">{i.note || ""}</td>
                <td>{!i.reading && <select value="" aria-label="Move to client" onChange={(e) => e.target.value && assignInbox(i.id, e.target.value)}>
                  <option value="">Choose client…</option>{sortedCompanies().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>}</td>
                <td className="n">{!i.reading && <button className="btn small danger" onClick={() => drop(i.id)}>Delete</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
