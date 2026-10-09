// A client's dashboard: what is waiting (inbox, bills, posting, bank), and a card each for TDS, the bank statement,
// sales and what was posted lately. Was viewClientDash (src/js/18). The first-steps card (ONB.card, src/js/48)
// is still an old piece.
import { useEffect, useState } from "react";
import { OnbCard } from "../parts/Notes.jsx";
import { Inbox, ReceiptText, Send, Landmark } from "lucide-react";

const money = (x) => "₹" + INR.format(r2(x || 0));
const sumTotal = (list) => money(list.reduce((a, e) => a + num(e.x.total), 0));

// a figure in Arc's metric-card look, with its own accent and icon (styles/arc-shell.css). A number counts up from 0 on
// the page's first showing (styles/arc-motion.css draws the count over it; the figure's own text is the value throughout)
function Tile({ label, n, sub, go, tone, Icon }) {
  const count = typeof n === "number" && n > 0 && n < 100000;
  return <button className="dtile" data-tone={tone} onClick={() => goClient(go)}><span>{label}</span>
    <b data-count={count ? "" : undefined} style={count ? { "--to": n } : undefined}>{n}</b><small>{sub}</small>
    {Icon && <i className="dtile-chip" aria-hidden="true"><Icon width={16} height={16} strokeWidth={2} /></i>}</button>;
}

// the dashboard's opening motion (the owner, 09-Oct-2026: the release board's motion, calm but visible) plays once a page
// load: the first showing carries data-intro, and a redraw or a later visit does not replay it (styles/arc-motion.css,
// only when the computer does not ask for reduced motion)
let introShown = false;

export default function Dash() {
  const [intro] = useState(() => !introShown);
  useEffect(() => { introShown = true; }, []);
  const co = CO(), v = Object.values(D().entries), [q, setQ] = useState("");
  const drafts = v.filter((e) => e.status === "draft"), approved = postBillsOpen(co.id) || [];   // ready to post: the one count for Tally (postCounts, src/js/59)
  const bank = S.bank && S.bank.cid === co.id ? S.bank : null, bc = bank ? tabCounts(bank.rows) : null, stmt = bank ? curStmt() : null;
  const sales = S.sales && S.sales.cid === co.id ? S.sales.list : null;
  const tds = v.filter((e) => e.status !== "rejected" && e.snapshot).reduce((a, e) => a + num(e.snapshot.tds), 0);
  const recent = v.filter(billInTally).sort((a, b) => String(b.exportedAt).localeCompare(String(a.exportedAt))).slice(0, 5);
  const off = bank ? bank.rows.filter((r) => r.balOk === false).length : 0;
  return (
    <section className="dash" data-intro={intro ? "" : undefined}>
      <OnbCard co={co} />
      <form className="dash-ask" onSubmit={(ev) => { ev.preventDefault(); dashAsk(q); }}>
        <input type="search" id="dashAsk" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Ask the books: a ledger for any dates, open bills, trial balance… (press /)" aria-label="Ask the books" />
        <button className="btn primary" type="submit">Look up</button>
        <button className="btn" type="button" onClick={() => goClient("books:reports")}>Reports</button>
        <button className="btn" type="button" onClick={() => goClient("books:letters")}>Letters</button>
      </form>
      <div className="dash-tiles">
        <Tile label="To read" n={docqCount(co.id)} sub="in the inbox" go="inbox" tone="violet" Icon={Inbox} />
        <Tile tone="amber" Icon={ReceiptText} label="Bills to review" n={drafts.length} sub={drafts.length ? sumTotal(drafts) : "nothing waiting"} go="bills" />
        <Tile tone="indigo" Icon={Send} label="Post to Tally" n={postCountFor(co.id)} sub={(approved.length ? sumTotal(approved) : "nothing ready") + (postAttentionFor(co.id) ? " · " + postAttentionFor(co.id) + " need attention" : "")} go="post" />
        <Tile tone="sky" Icon={Landmark} label="Bank lines to review" n={bc ? bc.review : "…"} sub={bc ? bc.ready + " ready to post" : "opening the bank"} go="bank" />
      </div>
      {CloudDocs.on() && <p className="note" style={{ margin: "-6px 0 14px" }}>Documents are kept in the firm account, so anyone in the firm can open a bill from Transactions on any computer.
        {CloudDocs.queue.length > 0 && <> <b>{CloudDocs.queue.length} waiting to go up.</b></>}</p>}
      <div className="dash-cols">
        <section className="dash-card" data-tone="violet"><h3>TDS this year</h3><div className="dash-big">{money(tds)}</div>
          <p className="note">On bills approved here for {fyOf(null)}. Deductees over their limit show in red on the bills list.</p>
          <button className="btn small" onClick={() => goClient("post")}>Open Post to Tally</button></section>
        <section className="dash-card" data-tone="sky"><h3>Bank</h3>
          {stmt ? <><p><b>{stmt.bank || ""}</b> · {fmtDate(stmt.from)} to {fmtDate(stmt.to)}</p>
            <div className="dash-row"><span>Opening</span><b>{money(stmt.opening)}</b></div><div className="dash-row"><span>Closing</span><b>{money(stmt.closing)}</b></div>
            <p className="note">{off ? off + " lines do not fit the running balance." : "Every line fits the running balance."}</p></>
            : <p className="note">No statement uploaded yet.</p>}
          <button className="btn small" onClick={() => goClient("bank")}>Open bank</button></section>
        <section className="dash-card" data-tone="emerald"><h3>Sales</h3>
          {sales ? <><div className="dash-row"><span>Invoices</span><b>{sales.length}</b></div><div className="dash-row"><span>Posted</span><b>{sales.filter((x) => x.status === "posted").length}</b></div></>
            : <p className="note">Open Sales to see this client’s invoices.</p>}
          <button className="btn small" onClick={() => goClient("sales")}>Open sales</button></section>
        <section className="dash-card" data-tone="teal"><h3>Posted lately</h3>
          {recent.length ? <ul className="dash-list">{recent.map((e) => <li key={e.id}><b>{e.x.vendorName || e.fileName || ""}</b> · {money(e.x.total)}<span className="note">{fmtDate(String(e.exportedAt).slice(0, 10))}</span></li>)}</ul>
            : <p className="note">Nothing posted yet.</p>}</section>
      </div>
    </section>
  );
}
