// Today: what needs doing, across every client. Was viewToday() in src/js/18.
const openAt = (cid, step) => openCompany(cid).then(() => goStep(step, "bills"));

function Metric({ label, n, warn, onClick }) {
  return <button className={"metric" + (warn && n ? " warn" : "")} onClick={onClick}><span>{label}</span><b>{n}</b></button>;
}

export default function Today() {
  const cos = sortedCompanies();
  const rows = cos.map((c) => {
    const s = c.stats || {};
    return { c, read: docqCount(c.id), review: s.drafts || 0, post: s.waiting || 0, look: (s.dups || 0) + (s.check || 0) };
  }).sort((a, b) => (b.read + b.review + b.post + b.look) - (a.read + a.review + a.post + a.look));
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const cell = (r, key, step) => r[key]
    ? <button className="linkbtn tcell" onClick={() => openAt(r.c.id, step)}>{r[key]}</button>
    : <span className="muted">—</span>;
  return (
    <section className="today">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: "0 0 12px" }}>What needs doing</h2>
        <button className="btn small" onClick={() => doAct("addCo")}>Add client</button>
      </div>
      <div className="metrics">
        <Metric label="To read" n={inboxTotal()} onClick={() => navHome("inbox")} />
        <Metric label="To review" n={sum("review")} />
        <Metric label="To post" n={sum("post")} />
        <Metric label="Need a look" n={sum("look")} warn />
      </div>
      {!rows.length ? <p className="note">No clients yet. <button className="linkbtn" onClick={() => navHome("clients")}>Add your first client</button>.</p> : <>
        <div className="tblwrap">
          <table className="data">
            <thead><tr><th>Client</th><th className="n">To read</th><th className="n">To review</th><th className="n">To post</th><th className="n">Need a look</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.c.id}>
                  <td><button className="linkbtn" onClick={() => openAt(r.c.id, "review")}><b>{r.c.name}</b></button>{r.c.gstin && <> <span className="note">{r.c.gstin}</span></>}</td>
                  <td className="n">{cell(r, "read", "collect")}</td>
                  <td className="n">{cell(r, "review", "review")}</td>
                  <td className="n">{cell(r, "post", "post")}</td>
                  <td className="n">{cell(r, "look", "review")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 8 }}>Counts cover clients opened on this computer; open a client to bring its figures up to date.</p>
      </>}
    </section>
  );
}
