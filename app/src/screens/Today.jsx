// Today: what needs doing, across every client. Was viewToday() in src/js/18.
import ListTable from "../parts/ListTable.jsx";
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
      {!rows.length ? <p className="note lt-empty" data-list-empty="">No clients yet. Use <button className="linkbtn" onClick={() => navHome("clients")}>Add your first client</button> to start.</p> : <>
        {/* the one list table (spec K6) */}
        <ListTable name="today" className="data" rows={rows} rowKey={(r) => r.c.id} unit={["client", "clients"]}
          cols={[
            { k: "name", role: "party", label: "Client", v: (r) => r.c.name, cell: (r) => <><button className="linkbtn" onClick={() => openAt(r.c.id, "review")}><b>{r.c.name}</b></button>{r.c.gstin && <> <span className="note">{r.c.gstin}</span></>}</> },
            { k: "read", label: "To read", cls: "n", v: (r) => r.read, sum: true, fmt: String, cell: (r) => cell(r, "read", "collect") },
            { k: "review", label: "To review", cls: "n", v: (r) => r.review, sum: true, fmt: String, cell: (r) => cell(r, "review", "review") },
            { k: "post", label: "To post", cls: "n", v: (r) => r.post, sum: true, fmt: String, cell: (r) => cell(r, "post", "post") },
            { k: "look", label: "Need a look", cls: "n", v: (r) => r.look, sum: true, fmt: String, cell: (r) => cell(r, "look", "review") },
          ]} />
        <p className="note" style={{ marginTop: 8 }}>Counts cover clients opened on this computer; open a client to bring its figures up to date.</p>
      </>}
    </section>
  );
}
