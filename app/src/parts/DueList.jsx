// Returns and payments due, across every client (TDS/GST round 2, item 1): on the firm's Today page. The list is
// DueList (src/js/68-due-list.js): each client's GST and TDS returns and TDS deposits, due, overdue or filed, from the
// same code as the client's own TDS and GST pages, sorted by due date. A row opens that client's return.
import { useEffect, useState } from "react";
import ListTable from "./ListTable.jsx";
import Loading from "./Loading.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const CHIPS = [["todo", "To do"], ["overdue", "Overdue"], ["due", "Due soon"], ["filed", "Filed or paid"], ["all", "All"]];
const tone = (x) => (x.status === "overdue" ? "bad" : x.status === "due" ? (x.left <= 7 ? "warn" : "no") : x.late ? "warn" : "ok");

export default function DueAll() {
  const [res, setRes] = useState(null), [f, setF] = useState("todo"), [tax, setTax] = useState("");
  const load = () => DueList.all().then(setRes, () => setRes({ items: [], missing: [], failed: true }));
  // drawn again when the open client's books change; the server's copy of each client's work is brought once a session
  const key = S.books ? DueList.keyOf(S.books) : "";
  useEffect(() => { load(); }, [key, Object.keys(S.companies || {}).length]);
  useEffect(() => { DueList.syncAll().then((did) => { if (did) load(); }, () => {}); }, []);
  if (!res) return <section className="dash-card" data-due-list=""><h3>Returns and payments due</h3><Loading what="each client’s returns" rows={3} cols={5} /></section>;
  const all = res.items.filter((x) => !tax || x.tax === tax);
  const pick = (k) => all.filter((x) => k === "all" || (k === "todo" ? x.status !== "filed" : x.status === k));
  const rows = pick(f), count = (k) => pick(k).length;
  return <section className="dash-card" data-due-list="" style={{ marginTop: 16 }}>
    <div className="rp-title"><h3>Returns and payments due</h3>
      <span className="note">Every client’s GST and TDS returns and TDS deposits, from {fmtDate(DueList.addDays(DueList.today(), -DueList.BACK))} to {fmtDate(DueList.addDays(DueList.today(), DueList.AHEAD))}, by due date. Click one to open that return.</span></div>
    <div className="gf-chips" style={{ margin: "8px 0" }} role="group" aria-label="Show">
      {CHIPS.map(([k, l]) => <button key={k} data-due-chip={k} className={"gf-chip" + (f === k ? " on" : "") + (k === "overdue" && count(k) ? " warn" : "")} aria-pressed={f === k} onClick={() => setF(k)}>{l} <b>{count(k)}</b></button>)}
      <span style={{ width: 12 }} />
      {[["", "GST and TDS"], ["GST", "GST"], ["TDS", "TDS"]].map(([k, l]) => <button key={k || "both"} data-due-tax={k || "both"} className={"gf-chip" + (tax === k ? " on" : "")} aria-pressed={tax === k} onClick={() => setTax(k)}>{l}</button>)}
    </div>
    <ListTable name="dueList" rows={rows} rowKey={(x) => x.cid + "|" + x.kind + "|" + x.what + "|" + x.per + "|" + (x.gstin || "")} unit={["return or payment", "returns and payments"]}
      rowProps={(x) => ({ "data-due": x.cid + "|" + x.kind + "|" + (x.form || x.what) + "|" + x.per, "data-status": x.status })}
      empty={f === "todo" ? "Nothing due or overdue for any client." : "Nothing here."}
      cols={[
        { k: "due", role: "date", label: "Due on", v: (x) => x.due, cell: (x) => fmtDate(x.due) },
        { k: "client", role: "party", label: "Client", v: (x) => x.client, cell: (x) => <><b>{x.client}</b>{x.gstin ? <div className="nr">{x.gstin}</div> : x.tan ? <div className="nr">TAN {x.tan}</div> : null}</> },
        { k: "what", label: "Return or payment", v: (x) => x.what, cell: (x) => <button className="linkbtn" data-due-open="" onClick={() => DueList.open(x)}>{x.what}</button> },
        { k: "per", label: "Period", v: (x) => x.per, cell: (x) => x.per },
        { k: "st", role: "status", label: "Status", v: (x) => (x.status === "overdue" ? 0 : x.status === "due" ? 1 : 2), cell: (x) => <span className={"tag " + tone(x)}>{DueList.words(x)}</span> },
        { k: "amt", label: "TDS / late fee", cls: "n", v: (x) => x.unpaid || x.fee || x.tds || 0, cell: (x) => x.kind === "tdspay" ? <>{money(x.tds)}{x.unpaid ? <div className="nr bad">{money(x.unpaid)} not deposited</div> : null}</>
          : x.kind === "tds" ? <>{money(x.tds)}{x.fee ? <div className={"nr" + (x.status === "filed" ? "" : " bad")}>late fee {money(x.fee)}{x.status === "filed" ? "" : " if filed today"}</div> : null}</> : <span className="muted">—</span> },
      ]} />
    {res.missing.length > 0 && <p className="note" data-due-missing="" style={{ marginTop: 8 }}>Not in the list: {res.missing.map((c) => c.name).join(", ")} — no books on this computer yet. Open {res.missing.length === 1 ? "the client" : "each"} once to include {res.missing.length === 1 ? "it" : "them"}.</p>}
    <p className="note" style={{ marginTop: 6 }}>GST is filed when the portal’s return status, a filed return’s PDF or a date typed on the GST page says so; TDS when marked filed on the return’s File tab or under Settings › Closed periods; a deposit when every deduction of the month is against a challan.</p>
  </section>;
}
