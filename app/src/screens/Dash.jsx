// A client's Overview (was Dashboard; clean-up batch 1 names it as the sidebar does, and its counts in Today's words:
// To read · To review · Ready to post). Clean-up batch 2 (11-Oct-2026): the page is the getting-ready checklist (folded
// to one line when done) and the four counts, each opening its page, with the client's Tally link in one line once the
// checklist no longer shows it. The ask box is Look up's own (and "/" opens it); TDS, the bank statement and sales are
// under "More about this client", folded; what was posted lately is on Purchase → In Tally.
import HowPage from "../parts/HowPage.jsx";
import { useEffect, useState } from "react";
import { OnbCard } from "../parts/Notes.jsx";
import { TallyLinkLine } from "../parts/TallyLink.jsx";
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
  const co = CO(), v = Object.values(D().entries);
  const drafts = v.filter((e) => e.status === "draft"), approved = postBillsOpen(co.id) || [];   // ready to post: the one count for Tally (postCounts, src/js/59)
  const bank = S.bank && S.bank.cid === co.id ? S.bank : null, bc = bank ? tabCounts(bank.rows) : null, stmt = bank ? curStmt() : null;
  const sales = S.sales && S.sales.cid === co.id ? S.sales.list : null;
  // TDS of this year (audit of 11-Oct-2026: "TDS this year 0.00" beside the TDS page's 20,000): two sources, each named.
  // On bills approved here: of this year only, as the client's figure for the year (refreshStats tdsFy; it counted every
  // year's bills). In the books: the TDS ledgers in Tally's Day Book, the TDS page's Form 140 total for the year
  // (TDSYear.quarters: TDS.rows of the year), when this client's books are open
  const fy = fyOf(null);
  const tds = v.filter((e) => e.status === "approved" && e.snapshot && e.snapshot.fy === fy).reduce((a, e) => a + num(e.snapshot.tds), 0);
  const bk = S.books && S.books.cid === co.id && (S.books.vouchers || []).length ? S.books : null;
  let tdsBooks = null;
  if (bk) { try { tdsBooks = TDS.rows().filter((r) => r.fy === fy).reduce((a, r) => a + num(r.tds), 0); } catch (e) { tdsBooks = null; } }
  const off = bank ? bank.rows.filter((r) => r.balOk === false).length : 0;
  return (<>
    <section className="dash" data-intro={intro ? "" : undefined}>
      <OnbCard co={co} />
      {/* the client's Tally link in one line, its home being Client setup → Tally (the checklist's first step says it while open) */}
      {!(ONB.steps(co).some((x) => !x.done) && !co.onbHide) && <TallyLinkLine co={co} />}
      <div className="dash-tiles">
        <Tile label="To read" n={docqCount(co.id)} sub="in the inbox" go="inbox" tone="violet" Icon={Inbox} />
        <Tile tone="amber" Icon={ReceiptText} label="To review" n={drafts.length} sub={drafts.length ? sumTotal(drafts) : "nothing waiting"} go="bills" />
        <Tile tone="indigo" Icon={Send} label="Ready to post" n={postCountFor(co.id)} sub={(approved.length ? sumTotal(approved) : "nothing ready") + (postAttentionFor(co.id) ? " · " + postAttentionFor(co.id) + " need you" : "")} go="post" />
        <Tile tone="sky" Icon={Landmark} label="Bank lines to review" n={bc ? bc.review : "—"} sub={bc ? bc.ready + " ready to post" : "opening the bank"} go="bank" />
      </div>
      <details className="dash-more" data-dash-more="">
        <summary>More about this client</summary>
        {CloudDocs.on() && <p className="note" style={{ margin: "8px 0 0" }}>Documents are kept in the firm account, so anyone in the firm can open a bill from Transactions on any computer.
          {CloudDocs.queue.length > 0 && <> <b>{CloudDocs.queue.length} waiting to go up.</b></>}</p>}
        <div className="dash-cols">
          <section className="dash-card" data-tone="violet"><h3>TDS {fy}</h3>
            <div className="dash-row"><span>On bills approved here</span><b>{money(tds)}</b></div>
            {tdsBooks != null && <div className="dash-row"><span>In the books (Tally), {TDS.formShort("26Q", fy)}</span><b>{money(tdsBooks)}</b></div>}
            <p className="note">{tdsBooks != null ? "The books’ figure is the TDS page’s for the year. " : "The books’ TDS for the year is on the TDS page. "}Deductees over their limit show in red on the bills list.</p>
            <button className="btn small" onClick={() => goClient("books:tds")}>Open TDS</button></section>
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
        </div>
      </details>
    </section>
    {/* clean-up batch 3: what the page is for, folded, under it */}
    <HowPage page="dash" />
  </>);
}
