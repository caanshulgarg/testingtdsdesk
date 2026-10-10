// The purchase bills of the open client: the filters (to review, approved, no entry, duplicates), the list, and the
// chosen bill beside it. Was viewInvoices() in src/js/19; the bill itself is Bill.jsx.
import DocqPanel from "../parts/Docq.jsx";
import DropZone from "../parts/DropZone.jsx";
import ReadBadge from "../parts/ReadBadge.jsx";
import BillDetail from "./Bill.jsx";
import UploadResult from "../parts/UploadResult.jsx";

function Tag({ e }) {
  if (S.reading[e.id]) return <span className="tag no">Reading…</span>;
  if (e.status === "approved") return e.exportedAt ? <span className="tag stamp">Sent</span> : <span className="tag ok">TDS {money0(e.snapshot ? e.snapshot.tds : 0)}</span>;
  if (e.status === "rejected") return <span className="tag no">No entry</span>;
  if (e.status === "duplicate") return <span className="tag warn">Duplicate</span>;
  if (notReadYet(e)) return <span className="tag bad" title={"Not read yet: " + e.notRead.reason} data-notread="">Not read yet</span>;
  const c = compute(e);
  if (c.flags.some((x) => x.lvl !== "info") || c.missing.length) return <span className="tag warn">Check</span>;
  return c.tds ? <span className="tag ok">TDS {money0(c.tds)}</span> : <span className="tag no">No TDS</span>;
}

// an empty list says what to do next (spec K6, round 2)
const EMPTY = { draft: (co) => "No bills to review for " + co.name + ". Use Upload bills at the top right to add them.",
  approved: () => "Nothing approved yet. Approve bills under To review; they wait here until they are posted to Tally.",
  duplicate: () => "No duplicates held. A bill uploaded twice waits here, so you can keep both or delete one.",
  deleted: () => "No deleted bills. A bill you delete waits here; open it to restore it.",
  rejected: () => "Nothing marked as no entry. Use No entry needed on a bill that should not go to Tally." };

export default function Invoices() {
  const d = D(), co = CO(), all = Object.values(d.entries);
  const shown = all.filter((e) => e.status === S.filter).sort((a, b) => (S.filter === "draft" ? byDate(a, b) : byDate(b, a)));
  // the first bill in the list is chosen when none is (as before)
  if (!S.selected || !d.entries[S.selected]) S.selected = shown[0] ? shown[0].id : null;
  const cnt = (st) => all.filter((e) => e.status === st).length, drafts = cnt("draft");
  const pick = (id) => {
    S.selected = id; render();
    if (window.innerWidth < 860) { const el = document.querySelector(".detail"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }
  };
  return <>
    <DocqPanel cid={S.coId} />
    <UploadResult />
    <div className="desk">
      <div>
        {drafts > 1 && <div className="row" style={{ margin: "8px 0 0" }}><button className="btn small" onClick={() => doAct("revTable")}>Review all {drafts} in a table</button></div>}
        <div className="row" style={{ margin: "8px 0 0", justifyContent: "flex-end" }}>
          <button className="btn small" onClick={() => vrOpen()} title="Match a vendor’s ledger with the party’s ledger in Tally">Reconcile a vendor ledger</button>
        </div>
        {/* which bills: the one row of tabs at the top (To review · Post to Tally · In Tally · Duplicates · Deleted) */}
        {shown.length ? (
          <ul className="queue">
            {shown.map((e) => (
              <li key={e.id}>
                <button aria-current={S.selected === e.id} onClick={() => pick(e.id)}>
                  <span className="v">{e.x.vendorName || e.fileName}</span>
                  <span className="a">{num(e.x.total) ? money0(e.x.total) : ""}</span>
                  <span className="m"><ReadBadge mode={e.readMode} /> {[e.x.invoiceNo, e.x.invoiceDate ? fmtDate(e.x.invoiceDate) : ""].filter(Boolean).join(", ") || e.fileName}</span>
                  <span className="t"><Tag e={e} /></span>
                </button>
              </li>
            ))}
          </ul>
        ) : S.filter === "draft" && !all.length ? (
          <DropZone mode="company" className="drop-empty" label={"Upload invoices for " + co.name}>
            <strong>No bills yet for {co.name}</strong><div className="note">Drop PDFs or photos here, or click to choose. Several at once is fine.</div>
          </DropZone>
        ) : <p className="empty lt-empty" data-list-empty="">{(EMPTY[S.filter] || EMPTY.rejected)(co)}</p>}
      </div>
      <div>
        {S.selected ? <BillDetail id={S.selected} /> : <div className="detail"><section><p className="empty">Select an invoice to see its TDS draft.</p></section></div>}
      </div>
    </div>
  </>;
}
