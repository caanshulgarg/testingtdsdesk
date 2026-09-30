// A client's books read from Tally (the day book, ledgers, balances), and the work done on them: TDS returns, GST
// returns, MIS, accounts, audit. Was viewBooks and, for TDS, viewBooksTds, tdsCrumbs, viewTdsYears and
// viewTdsYearPage (src/js/18). Reports, Look up and Letters are pages of their own, opened from the side menu.
//
// State: S.books (the open client's books: vouchers, ledgers, salary, the work saved with them), S.booksTab (the
// tab); for TDS, S.tdsView (years → year → return or certs or notices), S.tdsFy, S.tdsQ, S.tdsForm (26Q or 24Q).
// A return's pages are TdsReturn.jsx. Still old pieces, shown through <Legacy>: every other tab's own pages.
import Legacy from "../parts/Legacy.jsx";
import { BusyCard } from "../parts/Reading.jsx";
import { Return26, Return24, CertsPage } from "./TdsReturn.jsx";
import Gst from "./Gst.jsx";
import FromTally from "./books/FromTally.jsx";
import Ledgers from "./books/Ledgers.jsx";
import MisTab from "./books/Mis.jsx";
import AuditTab from "./books/Audit.jsx";
import HelpButton from "../parts/HelpButton.jsx";

const money = (v) => INR.format(r2(v || 0));
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
      {v === "return" && <><span className="note">›</span><b>{S.tdsQ} · {S.tdsForm}</b></>}
      <HelpButton />
    </div>
  );
}

// every year with TDS in the books, a salary sheet or a challan
function Years({ b, rows, fys }) {
  if (!fys.length) return <>
    <div className="bk-none">Bring in the day book, or a salary sheet under 24Q, and the years appear here.</div>
    <div className="row" style={{ gap: 8, marginTop: 10 }}><button className="btn small primary" onClick={() => doAct("salaryPick")}>Bring in the salary sheet</button></div>
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
  return <>
    <div className="revfilter">
      <select aria-label="Financial year" value={fy} onChange={(ev) => tdsSetFy(ev.target.value)}>{tdsYears(b, rows).map((f) => <option key={f} value={f}>{f}</option>)}</select>
      <button className="btn small" onClick={() => tdsNav("certs")}>Certificates and rate questions</button>
      {AIH.enabled("notices") && <button className="btn small" onClick={() => tdsNav("notices")}>Notices</button>}
      <button className="btn small" onClick={() => doAct("yearExcel26")}>Download the year, 26Q</button>
      <button className="btn small" onClick={() => doAct("yearExcel24")}>Download the year, 24Q</button>
      <button className="btn small primary" onClick={() => doAct("yearExcelAll")}>Download the whole year</button>
    </div>
    <section className="dash-card"><h3>{fy}: returns by quarter</h3>
      <p className="note">Open a return to see its challans, deductees and deductions on separate tabs.</p>
      <div className="bk-tablewrap"><table className="bk-table">
        <thead><tr><th>Quarter</th><th>26Q, other than salary</th><th>24Q, salary</th><th>Due</th></tr></thead>
        <tbody>
          {qs.map((x) => <tr key={x.q}><td><b>{x.q}</b><div className="nr">{Q_MONTHS[x.q]}</div></td><Cell26 fy={fy} x={x} /><Cell24 b={b} fy={fy} x={x} /><td>{Q_DUE[x.q]}</td></tr>)}
          <tr><td><b>Year</b></td><td><b>{money(qs.reduce((a, x) => a + x.tds, 0))}</b><div className="nr">{qs.reduce((a, x) => a + x.deductions, 0)} deductions</div></td>
            <td><b>{money(qs.reduce((a, x) => a + x.salaryTds, 0))}</b></td><td></td></tr>
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
    <Legacy html={ledgerBanner(b, "tds")} />
    <Crumbs />
    {v === "notices" ? <Legacy html={AIH.viewNotices(b, "tds")} />
      : v === "years" ? <Years b={b} rows={rows} fys={fys} />
      : v === "certs" ? <CertsPage />
      : v === "return" ? (S.tdsForm === "24Q" ? <Return24 b={b} /> : <Return26 b={b} allRows={rows} />)
      : <Year b={b} rows={rows} />}
  </>;
}

// how up to date the books are, on every tab but From Tally, and Update now (a job for the bridge: nobody waits on Tally)
function FreshLine({ b }) {
  const m = b.meta || {};
  if (!(b.vouchers || []).length || !m.to) return null;
  const at = m.at ? new Date(m.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const can = typeof Bridge === "object" && Bridge.on() && Bridge.up();
  return <p className="note" style={{ margin: "0 0 10px" }}>Books up to <b>{fmtDate(tallyDate(m.to))}</b>{at ? ", brought in " + at : ""}.
    {can && <> <button className="linkbtn" onClick={() => doAct("keepNow")}>Update now</button></>}</p>;
}

export default function Books() {
  const co = CO();
  if (!S.books || S.books.cid !== co.id) { openBooks(co.id); return <p className="note">Opening the books…</p>; }
  const b = S.books, tab = booksTab(), n = (b.vouchers || []).length;
  const busy = b.busy && <BusyCard title="Reading the books…" detail={b.busy} />;
  if (tab === "reports" || tab === "lookup" || tab === "letters")
    return <>{busy}<Legacy html={tab === "reports" ? viewBooksReports(b) : tab === "lookup" ? viewBooksLookup(b) : viewBooksLetters(b)} /></>;
  const pending = n ? LedMaster.pending(b).length : 0;
  const highOpen = b.audit && b.audit.last ? b.audit.last.findings.filter((f) => f.sev === "high" && Audit.status(f.id).s === "open").length : 0;
  const tabs = [["import", "From Tally", n || null], ["ledgers", "Tally ledgers", n ? (pending ? pending + " to confirm" : "✓") : null], ["tds", "TDS", n ? TDS.rows().length : ((b.salary || []).length || null)],
    ["gst", "GST", null], ["mis", "MIS", null], ["fs", "Accounts", null], ["audit", "Audit", highOpen || null]];
  let body;
  if (tab === "import") body = <FromTally b={b} />;
  else if (!n && tab === "gst") body = <Gst />;
  else if (!n && !(tab === "tds" && (b.salary || []).length)) body = <div className="bk-none">Bring the day book in first, under “From Tally”. Salary for 24Q can be brought in on its own, under TDS.</div>;
  else if (tab === "tds") body = <Tds b={b} />;
  else if (tab === "gst" || !["ledgers", "audit", "mis", "fs"].includes(tab)) body = <Gst />;
  else if (tab === "ledgers") body = <Ledgers b={b} />;
  else if (tab === "audit") body = <AuditTab b={b} />;
  else if (tab === "mis") body = <MisTab b={b} />;
  else body = <Legacy html={viewBooksAccounts(b)} />;
  return <>
    <nav className="sbar" aria-label="Books">{tabs.map(([id, label, c]) =>
      <button key={id} aria-selected={tab === id} onClick={() => booksTabGo(id)}>{label}{c != null && <> <span className="sbar-n">{c}</span></>}</button>)}</nav>
    <Legacy html={BookSync.note(co.id, tab) + gstDriftNote(b)} />
    {tab !== "import" && <FreshLine b={b} />}
    {busy}
    {body}
  </>;
}
