// A client's TDS (tds-layout; the owner's decisions of 13/14-Oct-2026: "too many tabs; salary, challans, 26AS and TRACES
// don't belong as top tabs"). One page, no tabs: the bar of year → quarter → form, one line for the ledgers to confirm, and
// the year's grid of forms × quarters (grey not started, blue ready, red to fix, green filed), its header row carrying
// each quarter's and the year's totals, each cell opening that return (TdsReturn.jsx: a card on top, the six tabs of
// tds/ReturnParts.jsx below). Beside the grid's title, the way to the client's one challan register (tds/Register.jsx).
// Every year, Notices and the year's downloads are under More.
// The old tabs' addresses and views lead to their new places (tdsRedirect here, Route.booksApply in src/js/52): Challans ->
// the register; Salary -> 24Q's Employees & declarations; TRACES files -> a return's After filing; Checks and Certificates ->
// a return's To fix (the year's checks under it); 26AS & AIS -> the client's Reconciliations (books/recon).
//
// From tax year 2026-27 the forms are those of the Income-tax Act, 2025, each shown with its old name as the Income Tax
// Department's own PDFs do ("Form 140 (earlier 26Q)"): TDS.formShort / formLabel (src/js/09); the year is a "Tax Year".
// Nothing here works out a figure: the amounts are TDSYear.quarters() and the rows of TDS; the counts in a cell are of
// those rows.
//
// State: S.tdsView (years | year | return | notices | register), S.tdsFy, S.tdsQ, S.tdsForm (the return open),
// S.tdsPickForm (the form chosen in the bar while no quarter is), all kept in the address (Route.booksMore, src/js/52).
import { Return26, Return24 } from "./TdsReturn.jsx";
import Home, { HomeHead as HomeHeadOnly } from "./tds/Home.jsx";
import { PanPaste, PanBookView } from "./tds/PanBook.jsx";
import Register from "./tds/Register.jsx";
import TaxLedgers from "./books/TaxLedgers.jsx";
import { Notices } from "../parts/Ai.jsx";
import NotRead from "../parts/NotRead.jsx";
import NoTds from "./tds/NoTds.jsx";
import "../parts/returns.css";
import "../lib/tdsGlobals.js";   // next-challan-match: TDSMatch, PANCheck and the matcher's rules come with the TDS screens

const money = (v) => "₹" + INR.format(r2(v || 0));
export const Q_MONTHS = { Q1: "Apr–Jun", Q2: "Jul–Sep", Q3: "Oct–Dec", Q4: "Jan–Mar" };
// the due dates as the late fee works them out (TDS.dueWords; the TDS review's H2: Form 143 from 2026-27 is due with the TDS returns)
export const qDue = (fy, q, form) => TDS.dueWords(fy, q, form || "26Q");

// the tax year today, in India
function yearNow() {
  const t = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10).replace(/-/g, "");
  return TDS.fyOf(t);
}
// the years in the bar: those with TDS in the books, a salary sheet or a challan, and this year and the last
export function tdsBarYears(b, rows) {
  const now = yearNow(), y = num(now.slice(0, 4)), last = (y - 1) + "-" + String(y).slice(2);
  return Array.from(new Set(tdsYears(b, rows).concat([now, last]))).sort().reverse();
}

// tds-layout: the old TDS tabs' views and where each is now
const OLD_VIEWS = ["challans", "salary", "recon", "traces", "checks", "certs"];
// the quarter a page opens on when none is chosen: the one due now in this year, else Q1
const dueQ = (fy) => { try { const d = Smart.tdsDue(); return d && d.fy === fy && d.q ? d.q : "Q1"; } catch (e) { return "Q1"; } };
// an old view (a link, a bookmark, Back) to its new place
export function tdsRedirect() {
  const v = S.tdsView;
  if (!OLD_VIEWS.includes(v)) return false;
  const q = S.tdsQ || dueQ(S.tdsFy);
  if (v === "challans") { S.tdsView = "register"; }
  else if (v === "salary") { S.tdsView = "return"; S.tdsQ = q; S.tdsForm = "24Q"; S.tdsPickForm = "24Q"; S.tdsTab = "people"; }
  else if (v === "traces") { S.tdsView = "return"; S.tdsQ = q; S.tdsForm = S.tdsForm || "26Q"; S.tdsPickForm = S.tdsForm; S.tdsTab = "after"; }
  else if (v === "checks" || v === "certs") {
    const k = v === "certs" ? "rates" : S.tdsCheck || "rates";
    S.tdsView = "return"; S.tdsQ = q; S.tdsForm = "26Q"; S.tdsPickForm = "26Q"; S.tdsTab = "checks";
    S.tdsFix = k === "corr" ? "" : k; S.tdsFixAt = S.tdsFy + "|" + S.tdsQ + "|26Q";
  } else if (v === "recon") S.tdsView = "year";     // the address …/26as opens Reconciliations itself (Route.booksApply)
  return true;
}

// every year with TDS in the books, a salary sheet or a challan
function Years({ rows, fys }) {
  return (
    <section className="dash-card"><h3>Every year</h3>
      <div className="bk-tablewrap"><table className="bk-table" data-statement="">
        <thead><tr><th>Year</th><th className="n">Deductions</th><th className="n">TDS</th><th className="n">Challans</th><th className="n">Not against a challan</th><th className="n">Without PAN</th><th className="n">Salary employees</th><th className="ac"></th></tr></thead>
        <tbody>{fys.map((fy) => {
          const r = rows.filter((x) => x.fy === fy), ch = TDS.challans().filter((c) => TDS.fyOf(c.date) === fy);
          const emp = new Set(TDS24Q.rows().filter((x) => TDS.fyOf(x.date) === fy).map((x) => x.pan || x.name)).size;
          const un = r2(r.filter((x) => !x.challan).reduce((a, x) => a + x.tds, 0)), noPan = r.filter((x) => !Certs.validPan(x.pan)).length;
          return <tr key={fy}>
            <td><button className="linkbtn" onClick={() => tdsGo(fy)}><b>{fy}</b></button><div className="nr">{TDS.yearWord(fy)}</div></td>
            <td className="n">{r.length}</td><td className="n">{money(r.reduce((a, x) => a + x.tds, 0))}</td><td className="n">{ch.length}</td>
            <td className={"n" + (un ? " bad" : "")}>{un ? money(un) : "—"}</td><td className={"n" + (noPan ? " bad" : "")}>{noPan}</td><td className="n">{emp || "—"}</td>
            <td className="ac"><button className="btn small" onClick={() => tdsGo(fy)}>Open</button></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>
  );
}

// the first day of a quarter of a year ("2026-27", "Q2" → 20260701), and of the year when no quarter is chosen
function qStart(fy, q) { const y = num(String(fy).slice(0, 4)); return q === "Q2" ? y + "0701" : q === "Q3" ? y + "1001" : q === "Q4" ? (y + 1) + "0101" : y + "0401"; }

const Calm = ({ children }) => <div className="tg-empty" data-list-empty="">{children}</div>;

export default function Tds({ b }) {
  const rows = TDS.rows(), had = tdsYears(b, rows), fys = tdsBarYears(b, rows);
  // tds-layout: the old tabs' views to their new places (Challans, Salary, 26AS & AIS, TRACES files, Checks, Certificates)
  tdsRedirect();
  // smart moves round 1 (the owner's choice of 09-Oct-2026, "due now"): opened afresh, the page shows the year and the
  // quarter whose return is due now (Q2 of 2026-27 on 09-Oct-2026, due 31-Oct), or the person's last choice for this
  // client. The quarter's own tax year names its forms (Form 140 from 2026-27, 26Q before: TDS.formLabel)
  if (!S.tdsView && !S.tdsFy) { const k = Smart.recall("tds"), p = k && k.fy && fys.includes(k.fy) ? k : Smart.tdsDue(); S.tdsView = "year"; S.tdsFy = p.fy; S.tdsQ = p.q || ""; S.tdsPickForm = "";
    S.tdsAutoFy = p === k ? "" : (S.coId || "") + "|" + p.fy; }
  // round 64 (the owner's GB TEXCOAT, 16-Oct-2026: its books' TDS is all in 2025-26; TDS opened on 2026-27, due now, with
  // nothing): a year picked by itself (not the person's choice) that holds no TDS, once the books are in, gives way to the
  // latest year that does, the whole year shown; the person's own choice is kept (tdsPick clears the mark)
  if (S.tdsAutoFy && S.tdsAutoFy === (S.coId || "") + "|" + S.tdsFy && had.length && !had.includes(S.tdsFy) && S.tdsView === "year") {
    S.tdsFy = had[0]; S.tdsQ = ""; S.tdsPickForm = ""; S.tdsAutoFy = (S.coId || "") + "|" + had[0];
  }
  if (!S.tdsView) S.tdsView = had.length > 1 ? "years" : "year";
  if (["year", "return", "register"].includes(S.tdsView) && !fys.includes(S.tdsFy)) S.tdsFy = had[0] || fys[0] || "";
  if (!S.tdsFy && !["years", "notices", "register", "ledgers"].includes(S.tdsView)) S.tdsView = "years";
  const v = S.tdsView;
  // a return's tab is settled before the way back is drawn: the guide beside it is for that tab. A return opens on its
  // entries (the summary is the card above the tabs since round 46; an old link to …/summary opens the entries)
  // (each return page settles its own tab: ReturnParts.jsx tabNow, the old ids to their new places)
  // the books in FinCom end before the quarter (or year) shown starts, and no TDS of it is here: one line, not an empty grid
  // (a year with any TDS here, from the books or a salary sheet, shows its grid as before)
  const end = v === "year" && S.tdsFy && !had.includes(S.tdsFy) && !rows.some((r) => r.fy === S.tdsFy && (!S.tdsQ || r.q === S.tdsQ)) ? Smart.booksEndBefore(qStart(S.tdsFy, S.tdsQ)) : "";
  const prevFy = end ? Smart.fyLabelOf(end) : "";
  const notRead = end ? <NotRead end={end} what={"TDS " + (S.tdsQ ? S.tdsQ + " (" + Q_MONTHS[S.tdsQ] + ") " : "") + S.tdsFy} read={S.tdsFy}
    show={prevFy !== S.tdsFy ? prevFy : ""} onShow={() => tdsPick(prevFy, "", "")} /> : null;
  // no TDS here at all: 26AS and AIS and the TRACES files work without the books; the rest says what brings them
  const booksIn = (b.vouchers || []).some((x) => !x.opt && !x.cancel);
  const none = !had.length && v !== "notices" && v !== "register" && v !== "ledgers" && !Payroll.has("") && !TDS.challans().length;
  return <div data-phone-scroll="" data-tds-page="">
    {v === "ledgers" ? <TaxLedgers b={b} kind="tds" />
      // round 65: the books are in but hold no TDS: said plainly, with the TDS ledgers that have no entries (tds/NoTds.jsx);
      // "Bring in from Tally" only when there are no entries at all
      : none && booksIn ? <NoTds b={b} />
      : none && notRead ? notRead : none ? <Calm>TDS is worked out from the day book. Salary for {TDS.formShort("24Q", S.tdsFy || fys[0] || "")} can also come from a salary sheet. The returns appear here once either is in.
      <div className="row" style={{ gap: 8, justifyContent: "center" }}><button className="btn small primary" onClick={() => goClient("books:import")}>Bring in from Tally</button>
        <button className="btn small" onClick={() => doAct("salaryPick")}>Import salary for 24Q</button></div></Calm>
      : v === "notices" ? <><p className="note"><button className="linkbtn" onClick={() => tdsNav("year")}>← Returns</button></p><Notices b={b} kind="tds" /></>
      : v === "years" ? <><p className="note"><button className="linkbtn" onClick={() => tdsNav("year")}>← {TDS.yearWord(S.tdsFy)} {S.tdsFy}</button></p><Years rows={rows} fys={had} /></>
      : v === "register" ? <Register />
      : v === "return" ? (S.tdsForm === "24Q" ? <Return24 b={b} /> : <Return26 b={b} allRows={S.tdsForm === "27Q" ? TDS.nrRows() : S.tdsForm === "27EQ" ? TDS.tcsRows() : rows} form={S.tdsForm || "26Q"} />)
      : notRead ? <>{fys.length > 0 && <HomeHeadOnly fys={fys} b={b} />}{notRead}</>
      : <Home fys={fys} b={b} />}
    <PanPaste /><PanBookView />
  </div>;
}
