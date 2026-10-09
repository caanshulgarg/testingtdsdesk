// A client's document inbox: files sent in by office automation, waiting to be read. cid "" = matched to no client.
// Was docqPanel() in src/js/19; reading them (readDocq, readDocqNow, setAsideDocq, assignDocq) stays there.
import ListTable from "./ListTable.jsx";
const KIND = { bill: "bill", purchase: "bill", bank: "bank statement", sales: "sales invoice" };
const ago = (t) => {
  if (!t) return "";
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago";
};

function FileCell({ d, cid }) {
  const st = docqState(d), loc = S.docqLocal[d.id] || {}, exp = docqExpired(d);
  const e0 = st === "dup" && loc.entryId && S.data[loc.cid] && S.data[loc.cid].entries[loc.entryId];
  const openBill = () => {
    if (S.coId !== loc.cid) openCompany(loc.cid);
    S.tab = "invoices"; S.reviewTable = false; S.filter = e0.status; S.selected = e0.id; render(); window.scrollTo(0, 0);
  };
  return <>
    <b>{d.fileName || "document"}</b>
    {KIND[d.docKind] && <> <span className="tag" title="A guess from the file name">{KIND[d.docKind]}?</span></>}
    {d.period && <> <span className="nr">{d.period}</span></>}
    {exp ? <div className="nr">Link expired, refreshing shortly.</div> : st === "failed" ? <div className="nr bad">{loc.msg || "could not be read"}</div> : null}
    {st === "dup" && <>
      <div className="nr bad">Already entered{e0 ? ": " + (e0.x.vendorName || e0.fileName || "") + (e0.x.invoiceNo ? " bill " + e0.x.invoiceNo : "") + " (" + statusLabel(e0.status) + ")" : loc.msg ? ": " + loc.msg : ""}.</div>
      <div style={{ marginTop: 4 }}>
        {e0 && <><button className="linkbtn" onClick={openBill}>Open that bill</button> · </>}
        <button className="linkbtn" onClick={() => readDocqNow(d.id, cid, true)}>Read it anyway</button>
      </div>
    </>}
  </>;
}

function Acts({ d, cid }) {
  const st = docqState(d), exp = docqExpired(d);
  return <>
    {!(st === "reading" || st === "dup" || exp) && <><button className="btn small" onClick={() => readDocqNow(d.id, cid)}>{st === "failed" ? "Try again" : "Read"}</button>{" "}</>}
    {cid === "" && <><select value="" onChange={(e) => e.target.value && assignDocq(d.id, e.target.value)} aria-label="Assign to a client">
      <option value="">Assign to…</option>{sortedCompanies().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>{" "}</>}
    <button className="linkbtn" onClick={() => setAsideDocq(d.id)} title="Covering letter, duplicate or not for entry">Not for entry</button>
  </>;
}

export default function DocqPanel({ cid = "" }) {
  if (!Cloud.on()) return null;
  const list = docqFor(cid);
  if (!list.length) return null;
  return (
    <section className="docq">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>{"\u{1F4E5} Inbox · " + list.length + " waiting"}</h3>
        <button className="btn small primary" onClick={() => readDocq(list.map((d) => d.id), cid)}>Read all {list.length}</button>
      </div>
      <p className="note" style={{ margin: "4px 0 8px" }}>Files your office sent in automatically (through a drop key). They are read the same way as an upload, and charged the same.</p>
      {/* the one list table (spec K6): received (date), the file, who sent it, then the rest */}
      <ListTable name={"docq" + (cid ? "" : "-unsorted")} className="data" rows={list} rowKey={(d) => d.id} unit={["file", "files"]}
        cols={[
          { k: "at", role: "date", label: "Received", v: (d) => d.receivedAt || d.createdAt || "", cell: (d) => <span title={fmtDateTime(d.receivedAt || d.createdAt)}>{ago(d.receivedAt || d.createdAt)}</span> },
          { k: "file", role: "number", label: "File", v: (d) => d.fileName || "", cell: (d) => <FileCell d={d} cid={cid} /> },
          { k: "from", role: "party", label: "From", v: (d) => d.sender || "", cell: (d) => <>{d.sender || ""}{d.source && <div className="nr">{d.source + (d.sourceTicketRef ? " · #" + d.sourceTicketRef : "")}</div>}</> },
          { k: "st", role: "status", label: "Status", v: (d) => docqState(d) || "", cell: (d) => { const st = docqState(d); const w = st === "reading" ? ["no", "Reading…"] : st === "failed" ? ["bad", "Not read"] : st === "dup" ? ["warn", "Already entered"] : ["no", "Waiting"]; return <span className={"tag " + w[0]}>{w[1]}</span>; } },
          { k: "ac", role: "act", cell: (d) => <Acts d={d} cid={cid} />, td: () => ({ style: { whiteSpace: "nowrap" } }) },
        ]} />
    </section>
  );
}
