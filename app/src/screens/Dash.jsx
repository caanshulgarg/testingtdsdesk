// A client's dashboard: what is waiting (inbox, bills, posting, bank), and a card each for TDS, the bank statement,
// sales and what was posted lately. Was viewClientDash (src/js/18). The first-steps card (ONB.card, src/js/48)
// is still an old piece.
import { useState } from "react";
import { OnbCard } from "../parts/Notes.jsx";

const money = (x) => INR.format(r2(x || 0));
const sumTotal = (list) => money(list.reduce((a, e) => a + num(e.x.total), 0));

function Tile({ label, n, sub, go }) {
  return <button className="dtile" onClick={() => goClient(go)}><span>{label}</span><b>{n}</b><small>{sub}</small></button>;
}

export default function Dash() {
  const co = CO(), v = Object.values(D().entries), [q, setQ] = useState("");
  const drafts = v.filter((e) => e.status === "draft"), approved = v.filter((e) => e.status === "approved" && !e.exportedAt);
  const bank = S.bank && S.bank.cid === co.id ? S.bank : null, bc = bank ? tabCounts(bank.rows) : null, stmt = bank ? curStmt() : null;
  const sales = S.sales && S.sales.cid === co.id ? S.sales.list : null;
  const tds = v.filter((e) => e.status !== "rejected" && e.snapshot).reduce((a, e) => a + num(e.snapshot.tds), 0);
  const recent = v.filter((e) => e.exportedAt).sort((a, b) => String(b.exportedAt).localeCompare(String(a.exportedAt))).slice(0, 5);
  const off = bank ? bank.rows.filter((r) => r.balOk === false).length : 0;
  return (
    <section className="dash">
      <OnbCard co={co} />
      <form className="dash-ask" onSubmit={(ev) => { ev.preventDefault(); dashAsk(q); }}>
        <input type="search" id="dashAsk" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Ask the books: a ledger for any dates, open bills, trial balance… (press /)" aria-label="Ask the books" />
        <button className="btn primary" type="submit">Look up</button>
        <button className="btn" type="button" onClick={() => goClient("books:reports")}>Reports</button>
        <button className="btn" type="button" onClick={() => goClient("books:letters")}>Letters</button>
      </form>
      <div className="dash-tiles">
        <Tile label="To read" n={docqCount(co.id)} sub="in the inbox" go="inbox" />
        <Tile label="Bills to review" n={drafts.length} sub={drafts.length ? sumTotal(drafts) : "nothing waiting"} go="bills" />
        <Tile label="Ready to post" n={approved.length} sub={approved.length ? sumTotal(approved) : "nothing approved"} go="post" />
        <Tile label="Bank lines to review" n={bc ? bc.review : "…"} sub={bc ? bc.ready + " ready to post" : "opening the bank"} go="bank" />
      </div>
      {CloudDocs.on() && <p className="note" style={{ margin: "-6px 0 14px" }}>Documents are kept in the firm account, so anyone in the firm can open a bill from Transactions on any computer.
        {CloudDocs.queue.length > 0 && <> <b>{CloudDocs.queue.length} waiting to go up.</b></>}</p>}
      <div className="dash-cols">
        <section className="dash-card"><h3>TDS this year</h3><div className="dash-big">{money(tds)}</div>
          <p className="note">On bills approved here for {fyOf(null)}. Deductees over their limit show in red on the bills list.</p>
          <button className="btn small" onClick={() => goClient("post")}>Open Post to Tally</button></section>
        <section className="dash-card"><h3>Bank</h3>
          {stmt ? <><p><b>{stmt.bank || ""}</b> · {fmtDate(stmt.from)} to {fmtDate(stmt.to)}</p>
            <div className="dash-row"><span>Opening</span><b>{money(stmt.opening)}</b></div><div className="dash-row"><span>Closing</span><b>{money(stmt.closing)}</b></div>
            <p className="note">{off ? off + " lines do not fit the running balance." : "Every line fits the running balance."}</p></>
            : <p className="note">No statement uploaded yet.</p>}
          <button className="btn small" onClick={() => goClient("bank")}>Open bank</button></section>
        <section className="dash-card"><h3>Sales</h3>
          {sales ? <><div className="dash-row"><span>Invoices</span><b>{sales.length}</b></div><div className="dash-row"><span>Posted</span><b>{sales.filter((x) => x.status === "posted").length}</b></div></>
            : <p className="note">Open Sales to see this client’s invoices.</p>}
          <button className="btn small" onClick={() => goClient("sales")}>Open sales</button></section>
        <section className="dash-card"><h3>Posted lately</h3>
          {recent.length ? <ul className="dash-list">{recent.map((e) => <li key={e.id}><b>{e.x.vendorName || e.fileName || ""}</b> · {money(e.x.total)}<span className="note">{fmtDate(String(e.exportedAt).slice(0, 10))}</span></li>)}</ul>
            : <p className="note">Nothing posted yet.</p>}</section>
      </div>
    </section>
  );
}
