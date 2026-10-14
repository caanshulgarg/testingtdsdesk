// A client's books read from Tally (the day book, ledgers, balances), and the work done on them: TDS returns, GST
// returns, MIS, accounts, audit. Was viewBooks and, for TDS, viewBooksTds, tdsCrumbs, viewTdsYears and
// viewTdsYearPage (src/js/18). Every part is a page of its own in the side menu (clean-up batch 1, 11-Oct-2026):
// From Tally (with its Tally ledgers tab) under Bring in, TDS and GST under Returns, Reports, MIS, Accounts, Audit (with
// its Tie-out with Tally tab), Look up and Letters under Books.
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
import AuditTab, { Tabs as AuditTabs } from "./books/Audit.jsx";
import Tieout from "./books/Tieout.jsx";
import Recon from "./books/Recon.jsx";
import { GstDriftNote, SyncNote, JobsNote } from "../parts/Notes.jsx";
import { BooksStale } from "../parts/TallyLine.jsx";
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

// how up to date the books are, on every tab but From Tally (round 3 A, the owner 14-Oct-2026): no status line on the page.
// "Books up to … · read …", Update now and the timing are in the top bar's Tally panel (parts/TallyLine.jsx PanelBooks);
// here only the books' own warnings, and one amber line when the books are stale or reading has stopped (BooksStale)
// unknown: false on the ledgers page, whose Needs you lists those ledgers one line each (Ledgers.jsx)
function FreshLine({ b, unknown = true }) {
  return <>
    <HeldBooks cid={S.coId} where="books" />
    {unknown && <UnknownLedgers cid={S.coId} where="books" byBook />}
    <BooksStale cid={S.coId} /></>;
}

// what a tab needs before it can show anything, and the button that brings it (review item 7). One name for bringing
// the Tally data in (clean-up batch 1): "Bring in from Tally", which opens From Tally
const BRING = "Bring in from Tally";
const EMPTY_TAB = {
  // clean-up batch 3: one sentence, one button
  ledgers: ["The Tally ledgers come from the client's books, which are not in yet.", BRING, () => booksTabGo("import")],
  mis: ["MIS is worked out from the day book, which is not in yet.", BRING, () => goClient("books:import")],
  fs: ["The accounts (balance sheet and profit and loss) are made from the day book, which is not in yet.", BRING, () => goClient("books:import")],
  audit: ["The audit checks run over the day book, which is not in yet.", BRING, () => goClient("books:import")],
};
function EmptyTab({ tab }) {
  const [say, label, go] = EMPTY_TAB[tab] || ["Bring in the books from Tally first.", BRING, () => goClient("books:import")];
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
  if (!S.books || S.books.cid !== co.id) { openBooks(co.id); return <Loading what="the books" page="books" />; }
  // live sync: the server's latest first; this computer's copy is not shown in place of a newer one
  if (S.books.loading) return <Loading what="the books" page="books" note="The latest from FinCom’s server." />;
  const b = S.books, tab = booksTab(), n = (b.vouchers || []).length;
  // fast-sync: the books not in on this computer yet (or still coming in): MIS, TDS and GST from the server meanwhile
  const srv = (!n || !!b.busy) && typeof TCloud === "object" && TCloud.on() && TCloud.has(co.id);
  const busy = b.busy && <BusyCard title="Reading the books…" detail={b.busy} />;
  // tds-layout: Reconciliations (TDS receivable vs 26AS) works from the files brought in, with or without the books
  if (tab === "recon") return <>{busy}<Recon b={b} /></>;
  if (tab === "reports" || tab === "lookup" || tab === "letters")
    return <>{busy}{tab === "reports" ? <Reports b={b} /> : tab === "lookup" ? <Lookup b={b} /> : <Letters b={b} />}</>;
  // MIS, Accounts and Audit: pages of their own in the sidebar (review item 7); the tie-out is Audit's tab
  if (tab === "mis" || tab === "fs" || tab === "audit" || tab === "tieout") {
    // the page's title is in the top bar
    return <>
      {n > 0 ? <FreshLine b={b} /> : <><HeldBooks cid={co.id} where="books" /><UnknownLedgers cid={co.id} where="books" byBook /><BooksStale cid={co.id} /></>}
      <JobsNote cid={co.id} />
      {busy}
      {tab === "tieout" ? <><AuditTabs /><SyncNote cid={co.id} tab={tab} /><GstDriftNote b={b} /><Tieout b={b} /></>
        : tab === "mis" && srv ? <ServerMis b={b} /> : !n ? (b.busy ? null : <EmptyTab tab={tab} />) : tab === "mis" ? <MisTab b={b} /> : tab === "audit" ? <AuditTab b={b} /> : <Accounts b={b} />}
    </>;
  }
  const pending = n ? LedMaster.pending(b).length : 0;
  // clean-up batch 1: TDS and GST are each a page of the sidebar (Returns), with no tab row here; From Tally keeps its
  // two tabs, the books brought in and the Tally ledgers
  const fromTally = tab === "import" || tab === "ledgers";
  const tabs = fromTally ? [["import", "Books", n || null], ["ledgers", "Tally ledgers", n ? (pending ? pending + " to confirm" : "✓") : null]] : [];
  let body;
  if (tab === "import") body = <FromTally b={b} />;
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
    {tabs.length > 0 && <nav className="sbar" aria-label="From Tally">{tabs.map(([id, label, c]) =>
      <button key={id} data-books-tab={id} aria-selected={tab === id} onClick={() => booksTabGo(id)}>{label}{c != null && <> <span className="sbar-n">{c}</span></>}</button>)}</nav>}
    <SyncNote cid={co.id} tab={tab} />
    {/* From Tally (2.4.0) says the upload's progress and the reading of the books in its own upload part */}
    {tab !== "import" && <><JobsNote cid={co.id} /><GstDriftNote b={b} /><FreshLine b={b} unknown={tab !== "ledgers" || !n} /></>}
    {tab !== "import" && busy}
    {body}
  </>;
}
