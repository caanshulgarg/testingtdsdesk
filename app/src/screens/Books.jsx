// A client's books read from Tally (the day book, ledgers, balances), and the work done on them: TDS returns, GST
// returns, MIS, accounts, audit. Was viewBooks and, for TDS, viewBooksTds, tdsCrumbs, viewTdsYears and
// viewTdsYearPage (src/js/18). Reports, Look up and Letters are pages of their own, opened from the side menu.
//
// State: S.books (the open client's books: vouchers, ledgers, salary, the work saved with them), S.booksTab (the
// tab). The TDS tab is TdsPage.jsx (the bar of year, quarter and form, the year's grid; a return's pages TdsReturn.jsx);
// every other tab is in screens/books/ or Gst.jsx.
import { BusyCard } from "../parts/Reading.jsx";
import Tds from "./TdsPage.jsx";
import Gst from "./Gst.jsx";
import FromTally, { needDays } from "./books/FromTally.jsx";
import Ledgers from "./books/Ledgers.jsx";
import MisTab from "./books/Mis.jsx";
import { ServerMis, ServerTds, ServerGst, TallyTdsLines } from "./books/ServerReports.jsx";
import Accounts from "./books/Accounts.jsx";
import Reports from "./books/Reports.jsx";
import Lookup from "./books/Lookup.jsx";
import Letters from "./books/Letters.jsx";
import AuditTab from "./books/Audit.jsx";
import Tieout from "./books/Tieout.jsx";
import { GstDriftNote, SyncNote, JobsNote } from "../parts/Notes.jsx";
import { BooksAsOf } from "../parts/TallyLine.jsx";
import HeldBooks from "../parts/HeldBooks.jsx";
import UnknownLedgers from "../parts/UnknownLedgers.jsx";
import Loading from "../parts/Loading.jsx";
import { AlertLine } from "../parts/Bell.jsx";

// the date of the books' last entry (yyyymmdd), worked out once for each set of entries
const lastMemo = new WeakMap();
function lastEntryDate(b) {
  const vs = b.vouchers || [];
  if (lastMemo.has(vs)) return lastMemo.get(vs);
  let d = ""; for (const v of vs) if (v.date > d && !v.cancel) d = v.date;
  lastMemo.set(vs, d); return d;
}

// how up to date the books are, on every tab but From Tally, and Update now (a job for the bridge: nobody waits on Tally)
// unknown: false on the ledgers page, whose Needs you lists those ledgers one line each (Ledgers.jsx)
function FreshLine({ b, unknown = true }) {
  const m = b.meta || {};
  if (!(b.vouchers || []).length || !m.to) return <><HeldBooks cid={S.coId} where="books" />{unknown && <UnknownLedgers cid={S.coId} where="books" byBook />}</>;
  // build 197: from any computer: on the Tally computer through its bridge, elsewhere through the cloud
  const can = (typeof Bridge === "object" && Bridge.on() && Bridge.up()) || (typeof TCloud === "object" && S.coId && TCloud.has(S.coId));
  // one sentence on every page (booksFresh, src/js/49): the last entry, how far it was checked with Tally, days not read
  const f = booksFresh(b, S.coId), asOf = (typeof booksAsOf === "function" && booksAsOf(S.coId)) || (typeof booksYearNote === "function" && booksYearNote(S.coId));
  // 2.1.3: "Books as of 15:34 · Update now" first: Tally cannot send its changes, so old figures are never shown as now
  return <>
    <HeldBooks cid={S.coId} where="books" />
    {unknown && <UnknownLedgers cid={S.coId} where="books" byBook />}
    {asOf && <p className="note" style={{ margin: "0 0 4px" }} data-books-asof-line=""><BooksAsOf cid={S.coId} /></p>}
    <p className="note" style={{ margin: "0 0 10px" }} data-fresh="">{f.text}
    {b.openMs != null && <span className="nr" data-opentime>{" Opened in " + (b.openMs / 1000).toFixed(1) + " s" + (b.readyMs != null ? ", every entry in " + (b.readyMs / 1000).toFixed(1) + " s" : "") + "."}</span>}
    {can && !asOf && <> <button className="linkbtn" onClick={() => doAct("keepNow")}>Update now</button></>}</p></>;
}

// what a tab needs before it can show anything, and the button that brings it (review item 7)
const EMPTY_TAB = {
  ledgers: ["The Tally ledgers come from the client's books. Read the books from Tally first.", "Read the books from Tally", () => booksTabGo("import")],
  mis: ["MIS is worked out from the day book. Read the books from Tally first.", "Read the books from Tally", () => goClient("books:import")],
  fs: ["The accounts (balance sheet and profit and loss) are made from the day book. Read the books from Tally first.", "Read the books from Tally", () => goClient("books:import")],
  audit: ["The audit checks run over the day book. Read the books from Tally first.", "Read the books from Tally", () => goClient("books:import")],
};
function EmptyTab({ tab }) {
  const [say, label, go] = EMPTY_TAB[tab] || ["Read the books from Tally first.", "Read the books from Tally", () => goClient("books:import")];
  return <>
    <div className="bk-none">{say}</div>
    <div className="row" style={{ gap: 8, marginTop: 10 }}><button className="btn small primary" onClick={go}>{label}</button></div>
  </>;
}

// round 3 of the UI pass (05-Oct-2026): the client's Books page is one of the two places with an alert on the page: ONE
// slim line, the client's first alert and its button (the rest in the bell)
export default function Books() {
  const co = CO();
  // 2.4.0: on From Tally, the book's alert (lines waiting, the cloud's gap) is not said twice: the page lists those days,
  // each with its Upload (needDays); the bell keeps it
  const days = co && booksTab() === "import" && S.books && S.books.cid === co.id ? needDays(S.books, co.id) : [];
  return <>{co && <AlertLine cid={co.id} skip={days.length ? (x) => String(x.key || "").startsWith("book:") : null} />}<BooksPage /></>;
}

function BooksPage() {
  const co = CO();
  if (!S.books || S.books.cid !== co.id) { openBooks(co.id); return <Loading what="the books" />; }
  // live sync: the server's latest first; this computer's copy is not shown in place of a newer one
  if (S.books.loading) return <Loading what="the books" note="The latest from FinCom’s server." />;
  const b = S.books, tab = booksTab(), n = (b.vouchers || []).length;
  // fast-sync: the books not in on this computer yet (or still coming in): MIS, TDS and GST from the server meanwhile
  const srv = (!n || !!b.busy) && typeof TCloud === "object" && TCloud.on() && TCloud.has(co.id);
  const busy = b.busy && <BusyCard title="Reading the books…" detail={b.busy} />;
  if (tab === "reports" || tab === "lookup" || tab === "letters")
    return <>{busy}{tab === "reports" ? <Reports b={b} /> : tab === "lookup" ? <Lookup b={b} /> : <Letters b={b} />}</>;
  // MIS, Accounts and Audit: pages of their own in the sidebar (review item 7)
  if (tab === "mis" || tab === "fs" || tab === "audit") {
    // the page's title is in the top bar
    return <>
      {n > 0 ? <FreshLine b={b} /> : <><HeldBooks cid={co.id} where="books" /><UnknownLedgers cid={co.id} where="books" byBook /><p className="note" style={{ margin: "0 0 10px" }} data-books-asof-line=""><BooksAsOf cid={co.id} /></p></>}
      <JobsNote cid={co.id} />
      {busy}
      {tab === "mis" && srv ? <ServerMis b={b} /> : !n ? (b.busy ? null : <EmptyTab tab={tab} />) : tab === "mis" ? <MisTab b={b} /> : tab === "audit" ? <AuditTab b={b} /> : <Accounts b={b} />}
    </>;
  }
  const pending = n ? LedMaster.pending(b).length : 0;
  const tabs = [["import", "From Tally", n || null], ["ledgers", "Tally ledgers", n ? (pending ? pending + " to confirm" : "✓") : null], ["tds", "TDS", n ? TDS.rows().length : ((b.salary || []).length || null)],
    ["gst", "GST", null], ["tieout", "Tie-out", null]];
  let body;
  if (tab === "import") body = <FromTally b={b} />;
  else if (tab === "tieout") body = <Tieout b={b} />;
  else if (srv && tab === "gst") body = <><ServerGst b={b} />{n ? <Gst /> : null}</>;
  else if (srv && tab === "tds") body = <><ServerTds b={b} /><TallyTdsLines b={b} />{n ? <Tds b={b} /> : null}</>;
  else if (!n && tab === "gst") body = <Gst />;
  else if (!n && tab === "tds") body = <><TallyTdsLines b={b} /><Tds b={b} /></>;
  else if (!n) body = b.busy ? null : <EmptyTab tab={tab} />;
  else if (tab === "tds") body = <><TallyTdsLines b={b} /><Tds b={b} /></>;
  else if (tab === "gst" || !["ledgers", "audit", "mis", "fs"].includes(tab)) body = <Gst />;
  else if (tab === "ledgers") body = <Ledgers b={b} />;
  else if (tab === "audit") body = <AuditTab b={b} />;
  else if (tab === "mis") body = <MisTab b={b} />;
  else body = <Accounts b={b} />;
  return <>
    <nav className="sbar" aria-label="Books">{tabs.map(([id, label, c]) =>
      <button key={id} aria-selected={tab === id} onClick={() => booksTabGo(id)}>{label}{c != null && <> <span className="sbar-n">{c}</span></>}</button>)}</nav>
    <SyncNote cid={co.id} tab={tab} />
    {/* From Tally (2.4.0) says the upload's progress and the reading of the books in its own upload part */}
    {tab !== "import" && <><JobsNote cid={co.id} /><GstDriftNote b={b} /><FreshLine b={b} unknown={tab !== "ledgers" || !n} /></>}
    {tab !== "import" && busy}
    {body}
  </>;
}
