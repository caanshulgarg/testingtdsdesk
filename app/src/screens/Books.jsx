// A client's books read from Tally (the day book, ledgers, balances), and the work done on them: TDS returns, GST
// returns, MIS, accounts, audit. Was viewBooks and, for TDS, viewBooksTds, tdsCrumbs, viewTdsYears and
// viewTdsYearPage (src/js/18). Reports, Look up and Letters are pages of their own, opened from the side menu.
//
// State: S.books (the open client's books: vouchers, ledgers, salary, the work saved with them), S.booksTab (the
// tab); for TDS, S.tdsView (years → year → return or certs or notices), S.tdsFy, S.tdsQ, S.tdsForm (26Q, 24Q, 27Q or 27EQ).
// A return's pages are TdsReturn.jsx; every other tab is in screens/books/ or Gst.jsx.
import { BusyCard } from "../parts/Reading.jsx";
import { Return26, Return24, CertsPage } from "./TdsReturn.jsx";
import Gst from "./Gst.jsx";
import FromTally from "./books/FromTally.jsx";
import Ledgers from "./books/Ledgers.jsx";
import MisTab from "./books/Mis.jsx";
import { ServerMis, ServerTds, ServerGst } from "./books/ServerReports.jsx";
import Accounts from "./books/Accounts.jsx";
import Reports from "./books/Reports.jsx";
import Lookup from "./books/Lookup.jsx";
import Letters from "./books/Letters.jsx";
import AuditTab from "./books/Audit.jsx";
import HelpButton from "../parts/HelpButton.jsx";
import { Notices } from "../parts/Ai.jsx";
import { LedgerBanner, GstDriftNote, SyncNote, JobsNote } from "../parts/Notes.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const Q_MONTHS = { Q1: "Apr to Jun", Q2: "Jul to Sep", Q3: "Oct to Dec", Q4: "Jan to Mar" };
const Q_DUE = { Q1: "31 Jul", Q2: "31 Oct", Q3: "31 Jan", Q4: "31 May" };

function Crumbs() {
  const v = S.tdsView;
  return (
    <div className="tds-crumbs" style={{ display: "flex", gap: 8, alignItems: "center", margin: "0 0 12px", fontSize: 15 }}>
      <button className="linkbtn" onClick={() => tdsNav("years")}>TDS</button>
      {S.tdsFy && v !== "years" && <><span className="note">›</span><button className="linkbtn" onClick={() => tdsNav("year")}>{S.tdsFy}</button></>}
      {v === "certs" && <><span className="note">›</span><b>Certificates and rate questions</b></>}
      {v === "notices" && <><span className="note">›</span><b>Notices</b></>}
      {v === "return" && <><span className="note">›</span><b>{S.tdsQ} · {TDS.formName(S.tdsForm || "26Q", S.tdsFy)}</b></>}
      <HelpButton />
    </div>
  );
}

// every year with TDS in the books, a salary sheet or a challan
function Years({ b, rows, fys }) {
  if (!fys.length) return <>
    <div className="bk-none">TDS is worked out from the day book. Salary for 24Q can also be brought in on its own, from a salary sheet. The years appear here once either is in.</div>
    <div className="row" style={{ gap: 8, marginTop: 10 }}><button className="btn small primary" onClick={() => booksTabGo("import")}>Read the books from Tally</button><button className="btn small" onClick={() => doAct("salaryPick")}>Import salary for 24Q</button></div>
  </>;
  return (
    <section className="dash-card"><h3>Choose the financial year</h3>
      <div className="bk-tablewrap"><table className="bk-table">
        <thead><tr><th>Year</th><th className="n">Deductions</th><th className="n">TDS</th><th className="n">Challans</th><th className="n">Not against a challan</th><th className="n">Without PAN</th><th className="n">Salary employees</th><th className="ac"></th></tr></thead>
        <tbody>{fys.map((fy) => {
          const r = rows.filter((x) => x.fy === fy), ch = TDS.challans().filter((c) => TDS.fyOf(c.date) === fy);
          const emp = new Set(TDS24Q.rows().filter((x) => TDS.fyOf(x.date) === fy).map((x) => x.pan || x.name)).size;
          const un = r2(r.filter((x) => !x.challan).reduce((a, x) => a + x.tds, 0)), noPan = r.filter((x) => !Certs.validPan(x.pan)).length;
          return <tr key={fy}>
            <td><button className="linkbtn" onClick={() => tdsGo(fy)}><b>{fy}</b></button></td>
            <td className="n">{r.length}</td><td className="n">{money(r.reduce((a, x) => a + x.tds, 0))}</td><td className="n">{ch.length}</td>
            <td className={"n" + (un ? " bad" : "")}>{un ? money(un) : "—"}</td><td className={"n" + (noPan ? " bad" : "")}>{noPan}</td><td className="n">{emp || "—"}</td>
            <td className="ac"><button className="btn small" onClick={() => tdsGo(fy)}>Open</button></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>
  );
}

// a quarter's 26Q (other than salary) in the year's table
function Cell26({ fy, x }) {
  if (!x.deductions && !x.challans) return <td className="note">nothing</td>;
  const warn = [x.unallocated ? money(x.unallocated) + " not against a challan" : "", x.noPan ? x.noPan + " without PAN" : "", x.issues ? x.issues + " rate question" + (x.issues === 1 ? "" : "s") : ""].filter(Boolean);
  return <td>
    <button className="linkbtn" onClick={() => tdsGo(fy, x.q, "26Q")}><b>{money(x.tds)}</b></button>
    <div className="nr">{x.deductions} deductions · {x.challans} challan{x.challans === 1 ? "" : "s"}</div>
    {warn.length ? warn.map((w) => <div key={w} className="nr bad" style={{ whiteSpace: "normal" }}>{w}</div>) : <div className="nr">ready</div>}
  </td>;
}
// a quarter's 27Q (non-residents) or 27EQ (TCS) in the year's table
function CellOther({ fy, x, form }) {
  const o = form === "27EQ" ? x.tcs : x.nr;
  if (!o.n) return <td className="note">nothing</td>;
  const warn = [o.unallocated ? money(o.unallocated) + " not against a challan" : "", o.noPan ? o.noPan + " without PAN" : ""].filter(Boolean);
  return <td data-form={form}>
    <button className="linkbtn" onClick={() => tdsGo(fy, x.q, form)}><b>{money(o.tds)}</b></button>
    <div className="nr">{o.n} {form === "27EQ" ? "collections" : "deductions"}</div>
    {warn.length ? warn.map((w) => <div key={w} className="nr bad" style={{ whiteSpace: "normal" }}>{w}</div>) : <div className="nr">ready</div>}
  </td>;
}
// a quarter's 24Q (salary): from the salary sheet, or what the books carry under 192
function Cell24({ b, fy, x }) {
  const go = () => tdsGo(fy, x.q, "24Q");
  if (x.salaryEmployees) return <td><button className="linkbtn" onClick={go}><b>{money(x.salaryTds)}</b></button><div className="nr">{x.salaryEmployees} employee{x.salaryEmployees === 1 ? "" : "s"}</div></td>;
  const booksTds = r2(TDS.salaryRows().filter((r) => r.fy === fy && r.q === x.q).reduce((a, r) => a + r.tds, 0));
  return <td>
    {booksTds > 0 && <><button className="linkbtn" onClick={go}><b>{money(booksTds)}</b></button><div className="nr">in the books under 192</div></>}
    <div className="nr">{(b.salary || []).length ? (booksTds ? "" : "nothing") : <button className="linkbtn" onClick={go}>bring in the salary sheet</button>}</div>
  </td>;
}

function Year({ b, rows }) {
  const fy = S.tdsFy, qs = TDSYear.quarters(fy);
  const hasNr = qs.some((x) => x.nr.n), hasTcs = qs.some((x) => x.tcs.n);
  return <>
    <div className="revfilter">
      <select aria-label="Financial year" value={fy} onChange={(ev) => tdsSetFy(ev.target.value)}>{tdsYears(b, rows).map((f) => <option key={f} value={f}>{f}</option>)}</select>
      <button className="btn small" onClick={() => tdsNav("certs")}>Certificates and rate questions</button>
      {AIH.enabled("notices") && <button className="btn small" onClick={() => tdsNav("notices")}>Notices</button>}
      <button className="btn small" onClick={() => doAct("yearExcel26")}>Download the year, {TDS.formName("26Q", fy)}</button>
      <button className="btn small" onClick={() => doAct("yearExcel24")}>Download the year, {TDS.formName("24Q", fy)}</button>
      <button className="btn small primary" onClick={() => doAct("yearExcelAll")}>Download the whole year</button>
    </div>
    <section className="dash-card"><h3>{fy}: returns by quarter</h3>
      <p className="note">Open a return to see its challans, deductees and deductions on separate tabs.</p>
      <div className="bk-tablewrap"><table className="bk-table">
        <thead><tr><th>Quarter</th><th>{TDS.formNameLong("26Q", fy)}, other than salary</th><th>{TDS.formNameLong("24Q", fy)}, salary</th>{hasNr && <th>{TDS.formNameLong("27Q", fy)}, non-residents</th>}{hasTcs && <th>{TDS.formNameLong("27EQ", fy)}, TCS</th>}<th>Due</th></tr></thead>
        <tbody>
          {qs.map((x) => <tr key={x.q}><td><b>{x.q}</b><div className="nr">{Q_MONTHS[x.q]}</div></td><Cell26 fy={fy} x={x} /><Cell24 b={b} fy={fy} x={x} />
            {hasNr && <CellOther fy={fy} x={x} form="27Q" />}{hasTcs && <CellOther fy={fy} x={x} form="27EQ" />}<td>{Q_DUE[x.q]}</td></tr>)}
          <tr><td><b>Year</b></td><td><b>{money(qs.reduce((a, x) => a + x.tds, 0))}</b><div className="nr">{qs.reduce((a, x) => a + x.deductions, 0)} deductions</div></td>
            <td><b>{money(qs.reduce((a, x) => a + x.salaryTds, 0))}</b></td>
            {hasNr && <td><b>{money(qs.reduce((a, x) => a + x.nr.tds, 0))}</b></td>}{hasTcs && <td><b>{money(qs.reduce((a, x) => a + x.tcs.tds, 0))}</b></td>}<td></td></tr>
        </tbody>
      </table></div>
    </section>
  </>;
}

function Tds({ b }) {
  const rows = TDS.rows(), fys = tdsYears(b, rows);
  if (!S.tdsView) S.tdsView = fys.length === 1 ? "year" : "years";
  if (["year", "return", "certs"].includes(S.tdsView) && !fys.includes(S.tdsFy)) S.tdsFy = fys[0] || "";
  if (!S.tdsFy && !["years", "notices"].includes(S.tdsView)) S.tdsView = "years";
  const v = S.tdsView;
  // a return's tab is settled before the way back is drawn: the guide beside it is for that tab
  if (v === "return") {
    const tabs = S.tdsForm === "24Q" ? ["employees", "challans", "checks"].concat(S.tdsQ === "Q4" ? ["annex2"] : []) : ["challans", "deductees", "deductions", "checks"];
    if (!tabs.includes(S.tdsTab)) S.tdsTab = tabs[0];
  }
  return <>
    <LedgerBanner b={b} which="tds" />
    <Crumbs />
    {v === "notices" ? <Notices b={b} kind="tds" />
      : v === "years" ? <Years b={b} rows={rows} fys={fys} />
      : v === "certs" ? <CertsPage />
      : v === "return" ? (S.tdsForm === "24Q" ? <Return24 b={b} /> : <Return26 b={b} allRows={S.tdsForm === "27Q" ? TDS.nrRows() : S.tdsForm === "27EQ" ? TDS.tcsRows() : rows} form={S.tdsForm || "26Q"} />)
      : <Year b={b} rows={rows} />}
  </>;
}

// the date of the books' last entry (yyyymmdd), worked out once for each set of entries
const lastMemo = new WeakMap();
function lastEntryDate(b) {
  const vs = b.vouchers || [];
  if (lastMemo.has(vs)) return lastMemo.get(vs);
  let d = ""; for (const v of vs) if (v.date > d && !v.cancel) d = v.date;
  lastMemo.set(vs, d); return d;
}

// how up to date the books are, on every tab but From Tally, and Update now (a job for the bridge: nobody waits on Tally)
function FreshLine({ b }) {
  const m = b.meta || {};
  if (!(b.vouchers || []).length || !m.to) return null;
  const at = m.at ? fmtDateTime(m.at) : "";
  // build 197: from any computer: on the Tally computer through its bridge, elsewhere through the cloud
  const can = (typeof Bridge === "object" && Bridge.on() && Bridge.up()) || (typeof TCloud === "object" && S.coId && TCloud.has(S.coId));
  // review of 01-Oct-2026: the books' last entry, not how far the copy was checked (a copy kept to 30-Sep-2026 of a
  // year whose last entry is 31-Mar-2026 said "Books up to 30-Sep-2026")
  const last = lastEntryDate(b), checked = String(m.to || "");
  return <p className="note" style={{ margin: "0 0 10px" }}>Books up to <b>{fmtDate(tallyDate(last || checked))}</b>{last ? " (the last entry)" : ""}
    {last && checked > last ? " · checked with Tally to " + fmtDate(tallyDate(checked)) : ""}{at ? " · brought in " + at : ""}.
    {b.openMs != null && <span className="nr" data-opentime>{" Opened in " + (b.openMs / 1000).toFixed(1) + " s" + (b.readyMs != null ? ", every entry in " + (b.readyMs / 1000).toFixed(1) + " s" : "") + "."}</span>}
    {can && <> <button className="linkbtn" onClick={() => doAct("keepNow")}>Update now</button></>}</p>;
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

export default function Books() {
  const co = CO();
  if (!S.books || S.books.cid !== co.id) { openBooks(co.id); return <p className="note">Opening the books…</p>; }
  // live sync: the server's latest first; this computer's copy is not shown in place of a newer one
  if (S.books.loading) return <p className="note" data-opening>Getting the latest from the server…</p>;
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
      {n > 0 && <FreshLine b={b} />}
      <JobsNote cid={co.id} />
      {busy}
      {tab === "mis" && srv ? <ServerMis b={b} /> : !n ? (b.busy ? null : <EmptyTab tab={tab} />) : tab === "mis" ? <MisTab b={b} /> : tab === "audit" ? <AuditTab b={b} /> : <Accounts b={b} />}
    </>;
  }
  const pending = n ? LedMaster.pending(b).length : 0;
  const tabs = [["import", "From Tally", n || null], ["ledgers", "Tally ledgers", n ? (pending ? pending + " to confirm" : "✓") : null], ["tds", "TDS", n ? TDS.rows().length : ((b.salary || []).length || null)],
    ["gst", "GST", null]];
  let body;
  if (tab === "import") body = <FromTally b={b} />;
  else if (srv && tab === "gst") body = <><ServerGst b={b} />{n ? <Gst /> : null}</>;
  else if (srv && tab === "tds") body = <><ServerTds b={b} />{n ? <Tds b={b} /> : null}</>;
  else if (!n && tab === "gst") body = <Gst />;
  else if (!n && tab === "tds") body = <Tds b={b} />;
  else if (!n) body = b.busy ? null : <EmptyTab tab={tab} />;
  else if (tab === "tds") body = <Tds b={b} />;
  else if (tab === "gst" || !["ledgers", "audit", "mis", "fs"].includes(tab)) body = <Gst />;
  else if (tab === "ledgers") body = <Ledgers b={b} />;
  else if (tab === "audit") body = <AuditTab b={b} />;
  else if (tab === "mis") body = <MisTab b={b} />;
  else body = <Accounts b={b} />;
  return <>
    <nav className="sbar" aria-label="Books">{tabs.map(([id, label, c]) =>
      <button key={id} aria-selected={tab === id} onClick={() => booksTabGo(id)}>{label}{c != null && <> <span className="sbar-n">{c}</span></>}</button>)}</nav>
    <SyncNote cid={co.id} tab={tab} /><JobsNote cid={co.id} /><GstDriftNote b={b} />
    {tab !== "import" && <FreshLine b={b} />}
    {busy}
    {body}
  </>;
}
