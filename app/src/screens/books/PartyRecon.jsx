// Reconciliations → Vendors and Customers (phase 3, 14-Oct-2026; the owner: "Vendor reconciliation and customer
// reconciliation should come under the Reconciliation tab ... Prepare a proper reconciliation. If the opening has a
// difference, then also show it in the difference."). The party's statement in any format (the sheet engine: AI once
// for a new format, then its saved columns) against the party's ledger in FinCom's copy of the books. The logic is
// PartyRecon (app/src/lib/registers.js); the upload goes through the register panel (parts/SheetPanel.jsx).
import { useEffect, useState } from "react";
import Loading from "../../parts/Loading.jsx";
import ListTable from "../../parts/ListTable.jsx";
import DetailDrawer from "../../parts/DetailDrawer.jsx";
import Button from "../../parts/Button.jsx";
import More from "../../parts/More.jsx";
import { EmptyNext } from "../../parts/StateBar.jsx";
// the live check against Tally (the vendor reconciliation as it was), under Vendors' More
import VendorRecon from "../VendorRecon.jsx";

const m = (v) => (num(v) < 0 ? "−" : "") + money(Math.abs(num(v)));
const d = (x) => (x ? fmtDate(x) : "—");

// an entry's note ("explained"), written in place (the drawer keeps the page's focus; a box over it could not be clicked)
function Note({ run, x }) {
  const key = PartyRecon.itemKey(x), n = (run.notes || {})[key];
  const [edit, setEdit] = useState(false), [text, setText] = useState("");
  if (n) return <span className="note" data-recon-note="">{n.note} <button className="linkbtn" aria-label="Remove the note" onClick={() => PartyRecon.explain(run.id, key, "")}>✕</button></span>;
  if (!edit) return <button className="linkbtn" data-recon-explain="" onClick={() => setEdit(true)}>Explain</button>;
  return <span className="row" style={{ gap: 6, display: "inline-flex" }}><input type="text" autoFocus data-recon-note-box="" aria-label="What explains it" placeholder="What explains it" value={text}
      onChange={(ev) => setText(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter" && text.trim()) PartyRecon.explain(run.id, key, text.trim()); if (ev.key === "Escape") setEdit(false); }} />
    <button className="btn small" data-recon-note-save="" disabled={!text.trim()} onClick={() => PartyRecon.explain(run.id, key, text.trim())}>Save</button></span>;
}

function Items({ run, title, kind, rows, cols, extra }) {
  if (!rows.length) return null;
  const open = rows.filter((x) => !(run.notes || {})[PartyRecon.itemKey(x)]).length;
  return <section className="recon-sec" data-recon-sec={kind}>
    <h4>{title} <span className="cnt">{rows.length}</span>{open < rows.length && <span className="note">{" · " + (rows.length - open) + " explained"}</span>}</h4>
    <ListTable name={"recon-" + kind} className="data" rows={rows} rowKey={(x, i) => kind + i} unit={["entry", "entries"]}
      cols={cols.concat([{ k: "note", label: "", cell: (x) => <>{extra && extra(x)}<Note run={run} x={x} /></> }])} />
  </section>;
}

function RunView({ run }) {
  const res = PartyRecon.result(run);
  if (res.error) return <p className="bk-alert bad">{res.error}</p>;
  const st = res.statement, v = run.side !== "customer";
  const one = [{ k: "date", role: "date", label: "Date", v: (x) => x.date, cell: (x) => d(x.date) }, { k: "no", role: "number", label: "No.", v: (x) => x.no, cell: (x) => x.no || "—" },
    { k: "narr", label: "Particulars", cell: (x) => x.narr || "" }, { k: "amt", role: "amount", label: "Amount", cls: "n", v: (x) => x.amt, cell: (x) => m(x.amt) }];
  const two = [{ k: "od", role: "date", label: "Ours", v: (x) => x.o.date, cell: (x) => d(x.o.date) + " · " + (x.o.no || "") }, { k: "oa", label: "Our amount", cls: "n", v: (x) => x.o.amt, cell: (x) => m(x.o.amt) },
    { k: "td", label: "Theirs", cell: (x) => d(x.t.date) + " · " + (x.t.no || "") }, { k: "ta", label: "Their amount", cls: "n", v: (x) => x.t.amt, cell: (x) => m(x.t.amt) },
    { k: "df", role: "amount", label: "Difference", cls: "n", v: (x) => x.diff, cell: (x) => <>{m(x.diff)}{x.text && <div className="nr">{x.text}</div>}</> }];
  return <div data-recon-run={run.id}>
    <p className="note">{run.ledger + " · " + d(run.from) + " to " + d(run.to) + " · " + run.file + (run.fmtName ? " (" + run.fmtName + ")" : "")}</p>
    {/* the answer first: the statement, adding up to the party's closing */}
    <table className="data recon-stmt" data-recon-statement="">
      <tbody>
        <tr><td>Closing as per our books</td><td className="n" data-recon-ours="">{m(st.ours)}</td></tr>
        {st.lines.map((l) => <tr key={l[0]} data-recon-line={l[0]}><td>{(l[2] >= 0 ? "Add: " : "Less: ") + l[1]}</td><td className="n">{m(Math.abs(l[2]))}</td></tr>)}
        <tr className="total"><td><b>Closing as per {run.ledger}</b></td><td className="n" data-recon-theirs=""><b>{m(st.theirs)}</b></td></tr>
        <tr className={Math.abs(st.unexplained) < 0.005 ? "ok" : "bad"}><td>Unexplained difference</td><td className="n" data-recon-unexplained="">{m(st.unexplained)}</td></tr>
      </tbody>
    </table>
    <p className="note">{(v ? "Amounts are what we owe " : "Amounts are what is owed to us by ") + run.ledger + "; their debit is our credit. Opening: " + m(res.oOpen) + " in our books, " + m(res.tOpen) + " in theirs."}</p>
    <div className="row" style={{ gap: 8, margin: "8px 0 14px", flexWrap: "wrap" }}>
      <Button className="btn small" data-recon-xlsx="" onClick={() => PartyRecon.xlsx(run, res)}>Excel</Button>
      <Button className="btn small" onClick={() => window.print()}>Print or PDF</Button>
      <Button className="btn small" data-recon-letter="" onClick={() => PartyRecon.letterDoc(run, res)}>Balance confirmation letter (Word)</Button>
    </div>
    <Items run={run} kind="theirsOnly" title="In their books, not in ours" rows={res.theirsOnly} cols={one}
      extra={(x) => <><button className="linkbtn" data-recon-create="" onClick={() => PartyRecon.createEntry(run, x)}>{"Create entry → " + (v ? "Purchase" : "Sales")}</button>{" · "}</>} />
    <Items run={run} kind="oursOnly" title="In our books, not in theirs" rows={res.oursOnly} cols={one} />
    <Items run={run} kind="differs" title="The same entry with a different amount or date" rows={res.differs} cols={two} />
    <Items run={run} kind="tds" title="TDS" rows={res.tds} cols={[{ k: "no", role: "number", label: "No.", cell: (x) => (x.t || x.o).no || "—" }, { k: "amt", role: "amount", label: "Amount", cls: "n", v: (x) => x.amt, cell: (x) => m(x.amt) }, { k: "w", label: "What", cell: (x) => x.text }]} />
    <Items run={run} kind="gst" title="GST" rows={res.gst} cols={[{ k: "no", role: "number", label: "No.", cell: (x) => x.t.no }, { k: "amt", role: "amount", label: "Difference", cls: "n", v: (x) => x.amt, cell: (x) => m(x.amt) }, { k: "w", label: "What", cell: (x) => x.text }]} />
    <details className="recon-sec" data-recon-matched=""><summary>{"Matched (" + res.matched.length + ")"}</summary>
      <ListTable name="recon-matched" className="data" rows={res.matched} rowKey={(x, i) => "m" + i} unit={["entry", "entries"]} cols={two.concat([{ k: "how", label: "By", cell: (x) => x.how }])} /></details>
  </div>;
}

export default function PartyReconPage({ side }) {
  // the reconciliation's engine loads the first time the page is opened (registersLoad, src/js/81-registers.js)
  const [ready, setReady] = useState(typeof PartyRecon === "object");
  useEffect(() => { if (!ready) registersLoad().then(() => setReady(true), () => {}); }, [ready]);
  if (!ready) return <Loading what="the reconciliations" />;
  return <PartyReconBody side={side} />;
}
function PartyReconBody({ side }) {
  const runs = PartyRecon.runs(side), open = detailOpen("recon"), run = open ? PartyRecon.byId(open) : null;
  const who = side === "customer" ? "customer" : "vendor";
  return <div data-party-recon={side}>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center", margin: "0 0 12px", gap: 8 }}>
      <p className="note" style={{ margin: 0 }}>{"A " + who + "'s statement of the client's account, in any format (Excel, CSV or a PDF table), against its ledger in the books. A new format is read by FinCom's AI once; then its columns are remembered."}</p>
      <span className="row" style={{ gap: 8 }}>
        <Button className="btn primary small" data-recon-pick={side} onClick={() => reconPickFile(side)}>{"Reconcile a " + who}</Button>
        {side === "vendor" && <More items={[["Check against Tally directly (FinCom Bridge)", () => vrOpenLive()]]} />}
      </span>
    </div>
    {side === "vendor" && VR.st() && <section className="pane" data-vr-live=""><VendorRecon /></section>}
    {!runs.length ? <EmptyNext what={"No " + who + " reconciled yet"} note={"Upload a " + who + "'s statement: FinCom matches it with the books and says every difference."} act={() => reconPickFile(side)} label={"Reconcile a " + who} />
      : <ListTable name={"recon-runs-" + side} className="data" rows={runs} rowKey={(r) => r.id} unit={["reconciliation", "reconciliations"]}
        rowProps={(r) => ({ onClick: () => openDetail("recon", r.id), style: { cursor: "pointer" }, "data-recon-row": r.id })}
        cols={[
          { k: "party", role: "party", label: "Party", v: (r) => r.ledger, cell: (r) => <button className="linkbtn" onClick={(ev) => { ev.stopPropagation(); openDetail("recon", r.id); }}>{r.ledger}</button> },
          { k: "period", role: "date", label: "Period", v: (r) => r.to, cell: (r) => d(r.from) + " to " + d(r.to) },
          { k: "theirs", role: "amount", label: "Their closing", cls: "n", v: (r) => num(r.stmt.close), cell: (r) => m(r.side === "customer" ? -r.stmt.close : r.stmt.close) },
          { k: "at", label: "Done", v: (r) => r.at, cell: (r) => fmtDateTime(r.at) + " · " + (r.by || "") },
        ]} />}
    <DetailDrawer kind="recon" wide title={run ? "Reconciliation: " + run.ledger : ""} description={run ? d(run.from) + " to " + d(run.to) : ""}>
      {run && <RunView run={run} />}
    </DetailDrawer>
  </div>;
}
