// Returns and payments due, across every client (TDS/GST round 2, item 1), on the firm's Compliance page since the TDS &
// GST makeover (round 46, 11-Oct-2026; the owner: "GST and TDS return status inside the client list is illogical"). The
// list is DueList (src/js/68-due-list.js): each client's GST and TDS returns and TDS deposits, due, overdue or filed, from
// the same code as the client's own TDS and GST pages, sorted by due date. A row opens that client's return.
//   DueAll   the list, in three views (Overdue · Due this month · Filed, and All), with GST/TDS and client filters
//   DueLine  the one line Today keeps: "3 returns overdue · Open Compliance →"
import { useEffect, useState } from "react";
import ListTable from "./ListTable.jsx";
import Loading from "./Loading.jsx";
import More from "./More.jsx";
import Filters, { Field } from "./Filters.jsx";
import { Answer } from "./Answer.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const VIEWS = [["overdue", "Overdue"], ["month", "Due this month"], ["filed", "Filed"], ["all", "All"]];
const tone = (x) => (x.status === "overdue" ? "bad" : x.status === "due" ? (x.left <= 7 ? "warn" : "no") : x.late ? "warn" : "ok");
// the month of today (yyyy-mm), the list's own today (window.__dueToday in the tests)
const thisMonth = () => String(DueList.today()).slice(0, 7);
const inView = (x, k) => k === "all" || (k === "month" ? x.status === "due" && String(x.due).slice(0, 7) <= thisMonth() : x.status === k);

function useDue() {
  const [res, setRes] = useState(null);
  const load = () => DueList.all().then(setRes, () => setRes({ items: [], missing: [], failed: true }));
  // drawn again when the open client's books change; the server's copy of each client's work is brought once a session
  const key = S.books ? DueList.keyOf(S.books) : "";
  useEffect(() => { load(); }, [key, Object.keys(S.companies || {}).length]);
  useEffect(() => { DueList.syncAll().then((did) => { if (did) load(); }, () => {}); }, []);
  return res;
}

export function DueLine() {
  const res = useDue();
  if (!res) return null;
  const over = res.items.filter((x) => x.status === "overdue").length, month = res.items.filter((x) => inView(x, "month")).length;
  return <div className="due-line" data-due-line="">
    {over ? <span className="bad">{over} return{over === 1 ? "" : "s"} or payment{over === 1 ? "" : "s"} overdue</span> : <span>Nothing overdue</span>}
    <span className="note" style={{ margin: 0 }}>{month} due this month</span>
    <button className="linkbtn" style={{ marginLeft: "auto" }} data-open-compliance="" onClick={() => navHome("compliance")}>Open Compliance →</button>
  </div>;
}

export default function DueAll() {
  const res = useDue();
  const [f, setF] = useState(""), [tax, setTax] = useState(""), [cid, setCid] = useState("");
  if (!res) return <section data-due-list=""><Loading what="each client’s returns" rows={4} cols={5} /></section>;
  const all = res.items.filter((x) => (!tax || x.tax === tax) && (!cid || x.cid === cid));
  const pick = (k) => all.filter((x) => inView(x, k)), count = (k) => pick(k).length;
  // opened on what needs doing first: the overdue, else what is due this month
  const view = f || (count("overdue") ? "overdue" : "month");
  const rows = pick(view), clients = Array.from(new Map(res.items.map((x) => [x.cid, x.client])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const over = res.items.filter((x) => x.status === "overdue").length, month = res.items.filter((x) => inView(x, "month")).length;
  return <section data-due-list="" data-phone-scroll="">
    {/* the answer first (ui-tidy: the one row of key figures) */}
    <Answer label="Compliance key figures" data-due-sum="" figs={[["Overdue", String(over), "returns and payments", over ? "bad" : ""], ["Due this month", String(month), "returns and payments"],
      ["Clients", String(clients.length), "with returns in the list"]]} />
    <nav className="sbar" aria-label="Show" style={{ marginBottom: 14 }}>
      {VIEWS.map(([k, l]) => <button key={k} data-due-chip={k} aria-selected={view === k} onClick={() => setF(k)}>{l} <span className="sbar-n">{count(k)}</span></button>)}
    </nav>
    <Filters className="cmp-filters" label="Filter the returns"
      type={<Field label="Tax"><select aria-label="Tax" data-due-tax-pick="" value={tax} onChange={(e) => setTax(e.target.value)}>
        <option value="">GST and TDS</option><option value="GST">GST</option><option value="TDS">TDS</option></select></Field>}
      client={<Field label="Client"><select aria-label="Client" data-due-client="" value={cid} onChange={(e) => setCid(e.target.value)}>
        <option value="">Every client</option>{clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>}
      onClear={() => { setTax(""); setCid(""); }} active={!!(tax || cid)}
      tools={<More label="How this list works">
        <p>Every client’s GST and TDS returns and TDS deposits due up to {fmtDate(DueList.addDays(DueList.today(), DueList.AHEAD))}: all not yet filed, and those filed since {fmtDate(DueList.addDays(DueList.today(), -DueList.BACK))}, by due date.</p>
        <p>GST is filed when the portal’s return status, a filed return’s PDF or a date typed on the GST page says so; TDS when marked filed on the return’s Files tab or under Settings › Closed periods; a deposit when every deduction of the month is against a challan.</p>
      </More>} />
    <ListTable name="dueList" rows={rows} rowKey={(x) => x.cid + "|" + x.kind + "|" + x.what + "|" + x.per + "|" + (x.gstin || "")} unit={["return or payment", "returns and payments"]}
      rowProps={(x) => ({ "data-due": x.cid + "|" + x.kind + "|" + (x.form || x.what) + "|" + x.per, "data-status": x.status, className: "rowlink", onClick: (e) => { if (!e.target.closest("button")) DueList.open(x); } })}
      empty={view === "overdue" ? "Nothing overdue. Every return and payment due so far is filed or paid." : view === "month" ? "Nothing more due this month." : "Nothing here."}
      cols={[
        { k: "due", role: "date", label: "Due date", v: (x) => x.due, cell: (x) => fmtDate(x.due) },
        { k: "client", role: "party", label: "Client", v: (x) => x.client, cell: (x) => <><b>{x.client}</b>{x.gstin ? <div className="nr">{x.gstin}</div> : x.tan ? <div className="nr">TAN {x.tan}</div> : null}</> },
        { k: "what", label: "Return or payment", v: (x) => x.what, cell: (x) => <button className="linkbtn" data-due-open="" onClick={() => DueList.open(x)}>{x.what}</button> },
        { k: "per", label: "Period", v: (x) => x.per, cell: (x) => x.per },
        { k: "st", role: "status", label: "Status", v: (x) => (x.status === "overdue" ? 0 : x.status === "due" ? 1 : 2), cell: (x) => <span className={"tag " + tone(x)}>{DueList.words(x)}</span> },
        { k: "amt", label: "TDS / late fee", cls: "n", v: (x) => x.unpaid || x.fee || x.tds || 0, cell: (x) => x.kind === "tdspay" ? <>{money(x.tds)}{x.unpaid ? <div className="nr bad">{money(x.unpaid)} not deposited</div> : null}</>
          : x.kind === "tds" ? <>{money(x.tds)}{x.fee ? <div className={"nr" + (x.status === "filed" ? "" : " bad")}>late fee {money(x.fee)}{x.status === "filed" ? "" : " if filed today"}</div> : null}</> : <span className="muted">—</span> },
      ]} />
    {res.missing.length > 0 && <p className="note" data-due-missing="" style={{ marginTop: 10 }}>Not in the list: {res.missing.map((c) => c.name).join(", ")} — no books on this computer yet. Open {res.missing.length === 1 ? "the client" : "each"} once to include {res.missing.length === 1 ? "it" : "them"}.</p>}
  </section>;
}
