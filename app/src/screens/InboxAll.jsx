// Inbox: every waiting document, by client, and uploads that matched no client. Was viewInboxAll() in src/js/18.
// The document list of each client (docqPanel) and the unsorted uploads (viewInbox) are still old screens.
import Legacy from "../parts/Legacy.jsx";

export default function InboxAll() {
  const cos = sortedCompanies().filter((c) => docqFor(c.id).length), loose = docqFor("").length, un = Object.keys(S.inbox || {}).length;
  return <>
    <section className="today"><h2>Inbox</h2><p className="note" style={{ margin: "0 0 12px" }}>Documents from office automation, by client, and uploads that matched no client.</p></section>
    {cos.map((c) => (
      <div className="inbox-client" key={c.id}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{c.name}</h3>
          <button className="btn small" onClick={() => openCompany(c.id).then(() => goStep("collect", "bills"))}>Open this client</button>
        </div>
        <Legacy html={docqPanel(c.id)} />
      </div>
    ))}
    {loose > 0 && <div className="inbox-client"><h3 style={{ margin: "0 0 6px" }}>Not matched to a client</h3><Legacy html={docqPanel("")} /></div>}
    {un > 0 && <div className="inbox-client"><h3 style={{ margin: "0 0 6px" }}>Uploads that matched no client</h3><Legacy html={viewInbox()} /></div>}
    {!cos.length && !loose && !un && <p className="note">Nothing waiting. New documents appear here as soon as they arrive.</p>}
  </>;
}
