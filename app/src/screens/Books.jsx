// A client's books read from Tally (the day book, ledgers, balances), and the work done on them: TDS returns, GST
// returns, MIS, accounts, audit. Was viewBooks and, for TDS, viewBooksTds, tdsCrumbs, viewTdsYears and
// viewTdsYearPage (src/js/18). Every part is a page of its own in the side menu (clean-up batch 1, 11-Oct-2026):
// From Tally under Bring in (its Tally ledgers tab moved to the TDS and GST pages, 14-Oct-2026), TDS and GST under Returns, Reports, MIS, Accounts, Audit (with
// its Tie-out with Tally tab), Look up and Letters under Books.
//
// State: S.books (the open client's books: vouchers, ledgers, salary, the work saved with them), S.booksTab (the
// tab). The TDS tab is TdsPage.jsx (the bar of year, quarter and form, the year's grid; a return's pages TdsReturn.jsx);
// every other tab is in screens/books/ or Gst.jsx.
import { BusyCard } from "../parts/Reading.jsx";
import Tds from "./TdsPage.jsx";
import Gst from "./Gst.jsx";
import FromTally, { needDays } from "./books/FromTally.jsx";
import MisTab from "./books/Mis.jsx";
import { ServerMis, ServerTds, ServerGst } from "./books/ServerReports.jsx";
import FinStatements from "./books/FinStatements.jsx";
import Reports from "./books/Reports.jsx";
import Lookup from "./books/Lookup.jsx";
import Letters from "./books/Letters.jsx";
import AuditTab, { Tabs as AuditTabs } from "./books/Audit.jsx";
import Tieout from "./books/Tieout.jsx";
import Recon from "./books/Recon.jsx";
import { GstDriftNote, SyncNote, JobsNote } from "../parts/Notes.jsx";
import { BooksStale } from "../parts/TallyLine.jsx";
import { booksNeedTally } from "../parts/FreshBar.jsx";
import HeldBooks from "../parts/HeldBooks.jsx";
import UnknownLedgers from "../parts/UnknownLedgers.jsx";
import Loading from "../parts/Loading.jsx";
import { lazy, Suspense } from "react";
// My MIS (ROUND 105): the custom MIS builder, a lazy chunk of its own (the engine, the charts, the downloads)
const MyMis = lazy(() => import("./books/MyMis.jsx"));
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
// round 63 (Tally messages only where needed): with fresh books nothing about Tally; one quiet "Books up to <date>"
// line instead (the held lines and the unknown ledgers stay: the figures are not complete without them)
function FreshLine({ b, unknown = true }) {
  const quiet = !booksNeedTally(b, S.coId), f = quiet && typeof booksFresh === "function" ? booksFresh(b, S.coId) : null;
  return <>
    <HeldBooks cid={S.coId} where="books" />
    {unknown && <UnknownLedgers cid={S.coId} where="books" byBook />}
    {quiet ? (f && f.last ? <p className="note books-upto" data-books-upto="" style={{ margin: "4px 0 8px" }}>{"Books up to " + fmtDate(tallyDate(f.last))}</p> : null) : <BooksStale cid={S.coId} />}</>;
}

// fast-firstopen (25-Oct-2026): the first opening of these books on this browser shows the latest year as soon as it is in
// (FirstOpen, src/js/95) while the older years come in behind it: the books then say so on one quiet line, and a page that
// needs the older years (the trial balance, MIS, statements, audit, Look up, an older year's TDS or GST) waits for them
// with the server's figures where it has them. meta.fo: the book a first opening is bringing in (TCloud.load clears it)
function firstOpenOf(b) {
  const m = b.meta || {};
  if (!m.fo || (m.cloud && m.cloud.book === m.fo) || !(b.vouchers || []).length) return null;
  return b.firstOpen && b.firstOpen.book === m.fo ? b.firstOpen : { fy: "", older: "", text: "Books: still coming in from FinCom’s cloud…" };
}
const fyOfYm = (ym) => { const y = +String(ym).slice(0, 4), mo = +String(ym).slice(4, 6), s = mo < 4 ? y - 1 : y; return s + "-" + String(s + 1).slice(2); };
function FirstOpenWait({ fo, what }) {
  return <p className="note" data-first-open-wait="">{what + " needs every year of the books: " + (fo.older || "the older years") + " " + (fo.failed ? "could not be brought in." : "still coming in from FinCom’s cloud. It shows here when they are in.")}</p>;
}

// what a tab needs before it can show anything, and the button that brings it (review item 7). One name for bringing
// the Tally data in (clean-up batch 1): "Bring in from Tally", which opens From Tally
const BRING = "Bring in from Tally";
const EMPTY_TAB = {
  // clean-up batch 3: one sentence, one button
  mis: ["MIS is worked out from the day book, which is not in yet.", BRING, () => goClient("books:import")],
  mymis: ["My MIS is worked out from the day book, which is not in yet.", BRING, () => goClient("books:import")],
  fs: ["The financial statements are made from the day book, which is not in yet.", BRING, () => goClient("books:import")],
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
  // ledger-confirm (14-Oct-2026): the Tally ledgers tab is gone; its address and every way to it open the TDS page's
  // Ledgers (TaxLed.redirect, src/js/81)
  TaxLed.redirect();
  // 2.4.0: on From Tally, the book's alert (lines waiting, the cloud's gap) is not said twice: the page lists those days,
  // each with its Upload (needDays); the bell keeps it
  const days = co && booksTab() === "import" && S.books && S.books.cid === co.id ? needDays(S.books, co.id) : [];
  return <>{co && <AlertLine cid={co.id} skip={days.length ? (x) => String(x.key || "").startsWith("book:") : null} />}<BooksPage /></>;
}

function BooksPage() {
  const co = CO();
  // 18-Oct-2026: a Tally file chosen before the books were open (tallyFiles, src/js/23) says so while they open, and why
  // if they could not be opened; never a page that shows nothing about it
  const up = S.tallyUp && S.tallyUp.cid === co.id && booksTab() === "import" ? S.tallyUp : null;
  const upLine = up && <div data-up-result="" data-up-waiting="" role="status">{up.lines.map((l, i) => <p key={i} className={l.ok ? "note" : "bad"} data-up-line={l.kind || "none"} style={{ margin: "4px 0 10px" }}>{l.text}</p>)}</div>;
  if (!S.books || S.books.cid !== co.id) { openBooks(co.id); return <>{upLine}<Loading what="the books" page="books" /></>; }
  // live sync: the server's latest first; this computer's copy is not shown in place of a newer one
  if (S.books.loading && S.books.openFailed && !upLine) return <p className="bad" role="alert" data-books-failed="">{"These books could not be opened on this page: " + S.books.openFailed + ". Reload FinCom to try again."}</p>;
  if (S.books.loading) return <>{upLine}<Loading what="the books" page="books" note="The latest from FinCom’s server." /></>;
  const b = S.books, tab = booksTab(), n = (b.vouchers || []).length;
  // fast-sync: the books not in on this computer yet (or still coming in): MIS, TDS and GST from the server meanwhile
  const srv = (!n || !!b.busy) && typeof TCloud === "object" && TCloud.on() && TCloud.has(co.id);
  const busy = b.busy && <BusyCard title="Reading the books…" detail={b.busy} />;
  const fo = firstOpenOf(b), foLine = fo && <p className="note" data-first-open="" role="status" style={{ margin: "4px 0 8px" }}>{fo.text}</p>;
  if (fo && fo.fy && !S.tdsView && !S.tdsFy) { S.tdsView = "year"; S.tdsFy = fo.fy; }
  // tds-layout: Reconciliations (TDS receivable vs 26AS) works from the files brought in, with or without the books
  if (tab === "recon") return <>{busy}<Recon b={b} /></>;
  if (fo && (tab === "reports" || tab === "lookup" || tab === "letters"))
    return <>{foLine}<FirstOpenWait fo={fo} what={tab === "reports" ? "Reports" : tab === "lookup" ? "Look up" : "Letters"} /></>;
  if (tab === "reports" || tab === "lookup" || tab === "letters")
    return <>{busy}{tab === "reports" ? <Reports b={b} /> : tab === "lookup" ? <Lookup b={b} /> : <Letters b={b} />}</>;
  // MIS, Financial statements and Audit: pages of their own in the sidebar (review item 7); the tie-out is Audit's tab
  if (tab === "mis" || tab === "fs" || tab === "audit" || tab === "tieout" || tab === "mymis") {
    // the page's title is in the top bar
    return <>
      {n > 0 ? <FreshLine b={b} /> : <><HeldBooks cid={co.id} where="books" /><UnknownLedgers cid={co.id} where="books" byBook /><BooksStale cid={co.id} /></>}
      <JobsNote cid={co.id} active />
      {busy}{foLine}
      {fo && tab !== "mis" ? <FirstOpenWait fo={fo} what={{ fs: "The financial statements", audit: "The audit", tieout: "The tie-out", mymis: "My MIS" }[tab] || "This page"} />
        : fo ? <ServerMis b={b} />
        : tab === "tieout" ? <><AuditTabs /><SyncNote cid={co.id} tab={tab} /><GstDriftNote b={b} /><Tieout b={b} /></>
        : tab === "mis" && srv ? <ServerMis b={b} /> : !n ? (b.busy ? null : <EmptyTab tab={tab} />) : tab === "mis" ? <MisTab b={b} />
        : tab === "mymis" ? <Suspense fallback={<Loading what="My MIS" page="books" />}><MyMis b={b} /></Suspense> : tab === "audit" ? <AuditTab b={b} /> : <FinStatements b={b} />}
    </>;
  }
  // clean-up batch 1: TDS and GST are each a page of the sidebar (Returns), with no tab row here. ledger-confirm
  // (14-Oct-2026): From Tally is the books brought in; the TDS and GST ledgers are confirmed on the TDS and GST pages
  const tabs = [];
  let body;
  const foOld = fo && (!fo.fy || (tab === "tds" && (S.tdsView === "years" || (S.tdsFy && S.tdsFy !== fo.fy))) || (tab === "gst" && S.gstYm && fyOfYm(S.gstYm) !== fo.fy));
  if (tab === "import") body = <FromTally b={b} />;
  else if (foOld && (tab === "tds" || tab === "gst")) body = <>{tab === "tds" ? <ServerTds b={b} /> : <ServerGst b={b} />}<FirstOpenWait fo={fo} what={tab === "tds" ? "The TDS of " + (S.tdsView === "years" ? "every year" : S.tdsFy) : "GST for " + (S.gstYm ? GSTR.label(S.gstYm) : "this month")} /></>;
  else if (fo && tab !== "tds" && tab !== "gst") body = <FirstOpenWait fo={fo} what="This page" />;
  else if (srv && tab === "gst") body = <><ServerGst b={b} />{n ? <Gst /> : null}</>;
  else if (srv && tab === "tds") body = <><ServerTds b={b} />{n ? <Tds b={b} /> : null}</>;
  else if (!n && tab === "gst") body = <Gst />;
  else if (!n && tab === "tds") body = <Tds b={b} />;
  else if (!n) body = b.busy ? null : <EmptyTab tab={tab} />;
  else if (tab === "tds") body = <Tds b={b} />;
  else if (tab === "gst" || !["ledgers", "audit", "mis", "fs"].includes(tab)) body = <Gst />;
  else if (tab === "audit") body = <AuditTab b={b} />;
  else if (tab === "mis") body = <MisTab b={b} />;
  else body = <FinStatements b={b} />;
  return <>
    {tabs.length > 0 && <nav className="sbar" aria-label="From Tally">{tabs.map(([id, label, c]) =>
      <button key={id} data-books-tab={id} aria-selected={tab === id} onClick={() => booksTabGo(id)}>{label}{c != null && <> <span className="sbar-n">{c}</span></>}</button>)}</nav>}
    <SyncNote cid={co.id} tab={tab} />
    {/* From Tally (2.4.0) says the upload's progress and the reading of the books in its own upload part */}
    {tab !== "import" && <><JobsNote cid={co.id} active /><GstDriftNote b={b} /><FreshLine b={b} unknown={!(tab === "ledgers" || (tab === "tds" && S.tdsView === "ledgers") || (tab === "gst" && S.gstView === "ledgers")) || !n} /></>}
    {tab !== "import" && busy}
    {tab !== "import" && foLine}
    {body}
  </>;
}
