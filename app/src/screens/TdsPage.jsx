// The TDS tab of a client's books, laid out as TDS software is (Computax, Winman; the owner's request of 09-Oct-2026):
// a bar of year → quarter → form at the top; with no quarter or form chosen, the year's status grid of forms × quarters
// (grey not started, blue ready, red errors, green filed), each cell opening that return; a return's pages are
// TdsReturn.jsx. Was Crumbs, Years, Cell26, CellOther, Cell24, Year and Tds in Books.jsx (viewBooksTds, viewTdsYears and
// viewTdsYearPage of src/js/18 before that).
//
// From tax year 2026-27 the forms are those of the Income-tax Act, 2025, each shown with its old name as the Income Tax
// Department's own PDFs do ("Form 140 (earlier 26Q)"): TDS.formShort / formLabel (src/js/09); the year is a "Tax Year"
// (Protean's RPU 1.2). Earlier years keep the old names alone. Nothing here works out a figure: the amounts are
// TDSYear.quarters() and the rows of TDS, as before; the counts in a cell are of those rows.
//
// State: S.tdsView (years | year | return | certs | notices), S.tdsFy, S.tdsQ, S.tdsForm (the return open),
// S.tdsPickForm (the form chosen in the bar while no quarter is), all kept in the address (Route.booksMore, src/js/52).
import { Return26, Return24, CertsPage } from "./TdsReturn.jsx";
import HelpButton from "../parts/HelpButton.jsx";
import { Notices } from "../parts/Ai.jsx";
import { LedgerBanner } from "../parts/Notes.jsx";
import NotRead from "../parts/NotRead.jsx";
import "../parts/returns.css";

const money = (v) => "₹" + INR.format(r2(v || 0));
export const Q_MONTHS = { Q1: "Apr–Jun", Q2: "Jul–Sep", Q3: "Oct–Dec", Q4: "Jan–Mar" };
const Q_DUE = { Q1: "31 Jul", Q2: "31 Oct", Q3: "31 Jan", Q4: "31 May" };
const FORMS = ["24Q", "26Q", "27Q", "27EQ"];
const day = (d) => fmtDate(tallyDate(d));

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

function Bar({ fys }) {
  const fy = S.tdsFy, v = S.tdsView, q = v === "return" || v === "year" ? S.tdsQ || "" : "", form = v === "return" ? S.tdsForm || "26Q" : v === "year" ? S.tdsPickForm || "" : "";
  return (
    <div className="rp-bar" role="group" aria-label="Choose the return" data-tds-bar="">
      <label className="rp-f">{TDS.yearWord(fy)}
        <select aria-label="Year" value={fy} onChange={(ev) => tdsPick(ev.target.value, q, form)}>
          {fys.map((f) => <option key={f} value={f}>{f}{TDS.isNew(f) ? " (Act of 2025)" : ""}</option>)}</select></label>
      <label className="rp-f">Quarter
        <select aria-label="Quarter" value={q} onChange={(ev) => tdsPick(fy, ev.target.value, form)}>
          <option value="">Every quarter</option>
          {["Q1", "Q2", "Q3", "Q4"].map((x) => <option key={x} value={x}>{x} · {Q_MONTHS[x]}</option>)}</select></label>
      <label className="rp-f">Form
        <select aria-label="Form" value={form} onChange={(ev) => tdsPick(fy, q, ev.target.value)}>
          <option value="">Every form</option>
          {FORMS.map((k) => <option key={k} value={k}>{TDS.formLabel(k, fy)}</option>)}</select></label>
      <span className="rp-links">
        <button className="linkbtn" onClick={() => tdsNav("certs")} aria-current={v === "certs" || undefined}>Certificates and rate questions</button>
        {AIH.enabled("notices") && <button className="linkbtn" onClick={() => tdsNav("notices")}>Notices</button>}
        <button className="linkbtn" onClick={() => tdsNav("years")}>All years</button>
        <HelpButton />
      </span>
    </div>
  );
}

// where the page is, under the bar: year › quarter › form
function Crumbs() {
  const v = S.tdsView, fy = S.tdsFy;
  return (
    <div className="tds-crumbs" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "0 0 12px", fontSize: 15 }}>
      <button className="linkbtn" onClick={() => tdsNav("years")}>TDS</button>
      {fy && v !== "years" && v !== "notices" && <><span className="note">›</span><button className="linkbtn" onClick={() => tdsGo(fy)}>{TDS.yearWord(fy)} {fy}</button></>}
      {v === "certs" && <><span className="note">›</span><b>Certificates and rate questions</b></>}
      {v === "notices" && <><span className="note">›</span><b>Notices</b></>}
      {v === "return" && <><span className="note">›</span><b data-return-title="">{S.tdsQ} ({Q_MONTHS[S.tdsQ]}) · {TDS.formLabel(S.tdsForm || "26Q", fy)}</b></>}
    </div>
  );
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

// one cell of the grid: the status in words and colour, then the counts and amounts as the year's table had them
function Cell({ fy, q, form, st, n, lines, amount }) {
  const label = st === "none" ? "Not started" : st === "bad" ? "Errors " + n : st === "filed" ? "Filed" + (n ? " " + n : "") : "Ready";
  return <td><button className={"rp-cell st-" + st} data-cell={form + "|" + q} data-status={st}
    aria-label={TDS.formShort(form, fy) + " " + q + ": " + label} onClick={() => tdsGo(fy, q, form)}>
    <span className="rp-s">{label}</span>
    {amount != null && <span className="rp-a">{amount}</span>}
    {lines.map((w, i) => <span key={i} className={"nr" + (w.bad ? " bad" : "")}>{w.t}</span>)}
  </button></td>;
}

// the status of each form in a quarter, from what the year's table showed: the quarter's figures (TDSYear.quarters) and
// the counts of the rows with something to fix. Filed (T-E1, 10-Oct-2026): the return marked filed on its File tab, or the
// quarter's date under Settings › Closed periods (TDSFiled, src/js/65), for every form
function cells(b, fy, x) {
  const fd = (form) => { const f = TDSFiled.get(fy, x.q, form); return f ? TDS.ymd(f.on) : ""; }, filed = fd("26Q"), out = {};
  const q = x.q, rowsQ = TDS.rows().filter((r) => r.fy === fy && r.q === q);
  // 26Q (Form 140): deductions from residents other than salary
  if (!x.deductions && !x.challans) out["26Q"] = { st: "none", lines: [] };
  else {
    const un = rowsQ.filter((r) => !r.challan).length, n = un + x.noPan + x.issues;
    const lines = [{ t: x.deductions + " deductions · " + x.challans + " challan" + (x.challans === 1 ? "" : "s") }]
      .concat([x.unallocated ? { t: money(x.unallocated) + " not against a challan", bad: 1 } : null, x.noPan ? { t: x.noPan + " without PAN", bad: 1 } : null,
        x.issues ? { t: x.issues + " rate question" + (x.issues === 1 ? "" : "s"), bad: 1 } : null].filter(Boolean));
    out["26Q"] = { st: filed ? "filed" : n ? "bad" : "ready", n: filed ? day(filed) : n, amount: money(x.tds), lines };
  }
  // 27Q (Form 144) and 27EQ (Form 143)
  [["27Q", x.nr, TDS.nrRows()], ["27EQ", x.tcs, TDS.tcsRows()]].forEach(([form, o, all]) => {
    if (!o.n) { out[form] = { st: "none", lines: [] }; return; }
    const un = all.filter((r) => r.fy === fy && r.q === q && !r.challan).length, n = un + o.noPan, on = fd(form);
    out[form] = { st: on ? "filed" : n ? "bad" : "ready", n: on ? day(on) : n, amount: money(o.tds), lines: [{ t: o.n + (form === "27EQ" ? " collections" : " deductions") }]
      .concat([o.unallocated ? { t: money(o.unallocated) + " not against a challan", bad: 1 } : null, o.noPan ? { t: o.noPan + " without PAN", bad: 1 } : null].filter(Boolean)) };
  });
  // 24Q (Form 138): from the salary sheet, or what the books carry under 192
  if (x.salaryEmployees) {
    const n = TDS24Q.checks(fy, q).length, on = fd("24Q");
    out["24Q"] = { st: on ? "filed" : n ? "bad" : "ready", n: on ? day(on) : n, amount: money(x.salaryTds), lines: [{ t: x.salaryEmployees + " employee" + (x.salaryEmployees === 1 ? "" : "s") }] };
  } else {
    const booksTds = r2(TDS.salaryRows().filter((r) => r.fy === fy && r.q === q).reduce((a, r) => a + r.tds, 0));
    out["24Q"] = { st: "none", amount: booksTds > 0 ? money(booksTds) : null, lines: booksTds > 0 ? [{ t: "in the books under 192" }, { t: "bring in the salary sheet" }] : (b.salary || []).length ? [] : [{ t: "bring in the salary sheet" }] };
  }
  return out;
}

function Year({ b }) {
  const fy = S.tdsFy, qs = TDSYear.quarters(fy);
  // back from a return: the bar shows the quarter, and every form
  if (S.tdsQ && S.tdsPickForm) S.tdsPickForm = "";
  const all = qs.map((x) => cells(b, fy, x));
  const yearTotal = { "26Q": money(qs.reduce((a, x) => a + x.tds, 0)), "24Q": money(qs.reduce((a, x) => a + x.salaryTds, 0)),
    "27Q": money(qs.reduce((a, x) => a + x.nr.tds, 0)), "27EQ": money(qs.reduce((a, x) => a + x.tcs.tds, 0)) };
  const forms = S.tdsPickForm ? [S.tdsPickForm] : FORMS, quarters = S.tdsQ ? [S.tdsQ] : ["Q1", "Q2", "Q3", "Q4"];
  return <>
    <section className="dash-card" data-tds-grid={fy}>
      <div className="rp-title"><h3>{TDS.yearWord(fy)} {fy}: returns by quarter</h3>
        <span className="note">{TDS.isNew(fy) ? "Forms of the Income-tax Act, 2025, with the old form in brackets." : "Forms of the Income-tax Act, 1961."} Click a cell to open that return.</span></div>
      <div className="bk-tablewrap"><table className="rp-grid gf-off">
        {/* aria-label: the heading's name read out, and on a phone each card's label (src/js/53-phone.js), with the due date
            apart from the months ("Q1 · Apr–Jun, due 31 Jul"; it read "Apr–Jundue 31 Jul" at 390px) */}
        <thead><tr><th>Form</th>{quarters.map((q) => <th key={q} aria-label={q + " · " + Q_MONTHS[q] + ", due " + Q_DUE[q]}>{q} · {Q_MONTHS[q]}<small>due {Q_DUE[q]}</small></th>)}<th>Year</th></tr></thead>
        <tbody>{forms.map((k) => <tr key={k} data-form={k}>
          <th scope="row">{TDS.formShort(k, fy)}<small>{TDS.FORM_ABOUT[k]}</small></th>
          {quarters.map((q) => { const c = all[["Q1", "Q2", "Q3", "Q4"].indexOf(q)][k]; return <Cell key={q} fy={fy} q={q} form={k} {...c} />; })}
          <td><b>{yearTotal[k]}</b>{k === "26Q" && <div className="nr">{qs.reduce((a, x) => a + x.deductions, 0)} deductions</div>}</td>
        </tr>)}</tbody>
      </table></div>
      <div className="rp-key" aria-label="Colours"><span style={{ "--k": "var(--rule-strong)" }}>Not started</span><span style={{ "--k": "var(--info)" }}>Ready</span>
        <span style={{ "--k": "var(--bad)" }}>Errors to fix</span><span style={{ "--k": "var(--ok)" }}>Filed</span></div>
    </section>
    <div className="revfilter" style={{ marginTop: 12, flexWrap: "wrap", rowGap: 6 }}>
      <button className="btn small" onClick={() => doAct("yearExcel26")}>Download the year, {TDS.formName("26Q", fy)}</button>
      <button className="btn small" onClick={() => doAct("yearExcel24")}>Download the year, {TDS.formName("24Q", fy)}</button>
      <button className="btn small primary" onClick={() => doAct("yearExcelAll")}>Download the whole year</button>
    </div>
  </>;
}

// the first day of a quarter of a year ("2026-27", "Q2" → 20260701), and of the year when no quarter is chosen
function qStart(fy, q) { const y = num(String(fy).slice(0, 4)); return q === "Q2" ? y + "0701" : q === "Q3" ? y + "1001" : q === "Q4" ? (y + 1) + "0101" : y + "0401"; }

export default function Tds({ b }) {
  const rows = TDS.rows(), had = tdsYears(b, rows), fys = tdsBarYears(b, rows);
  // smart moves round 1 (the owner's choice of 09-Oct-2026, "due now"): opened afresh, the page shows the year and the
  // quarter whose return is due now (Q2 of 2026-27 on 09-Oct-2026, due 31-Oct), or the person's last choice for this
  // client. The quarter's own tax year names its forms (Form 140 from 2026-27, 26Q before: TDS.formLabel)
  if (!S.tdsView && !S.tdsFy) { const k = Smart.recall("tds"), p = k && k.fy && fys.includes(k.fy) ? k : Smart.tdsDue(); S.tdsView = "year"; S.tdsFy = p.fy; S.tdsQ = p.q || ""; S.tdsPickForm = ""; }
  if (!S.tdsView) S.tdsView = had.length > 1 ? "years" : "year";
  if (["year", "return", "certs"].includes(S.tdsView) && !fys.includes(S.tdsFy)) S.tdsFy = had[0] || fys[0] || "";
  if (!S.tdsFy && !["years", "notices"].includes(S.tdsView)) S.tdsView = "years";
  const v = S.tdsView;
  // a return's tab is settled before the way back is drawn: the guide beside it is for that tab
  if (v === "return") {
    const tabs = S.tdsForm === "24Q" ? ["summary", "employees", "challans", "checks", "file"].concat(S.tdsQ === "Q4" ? ["annex2"] : [])
      : ["summary", "challans", "deductees", "deductions", "checks", "file"];
    if (!tabs.includes(S.tdsTab)) S.tdsTab = tabs[0];
  }
  // the books in FinCom end before the quarter (or year) shown starts, and no TDS of it is here: one line, not an empty grid
  // (a year with any TDS here, from the books or a salary sheet, shows its grid as before)
  const end = v === "year" && S.tdsFy && !had.includes(S.tdsFy) && !rows.some((r) => r.fy === S.tdsFy && (!S.tdsQ || r.q === S.tdsQ)) ? Smart.booksEndBefore(qStart(S.tdsFy, S.tdsQ)) : "";
  const prevFy = end ? Smart.fyLabelOf(end) : "";
  const notRead = end ? <NotRead end={end} what={"TDS " + (S.tdsQ ? S.tdsQ + " (" + Q_MONTHS[S.tdsQ] + ") " : "") + S.tdsFy} read={S.tdsFy}
    show={prevFy !== S.tdsFy ? prevFy : ""} onShow={() => tdsPick(prevFy, "", "")} /> : null;
  return <>
    <LedgerBanner b={b} which="tds" />
    {!had.length && v !== "notices" ? <>
      {notRead}
      <div className="bk-none">TDS is worked out from the day book. Salary for 24Q can also be brought in on its own, from a salary sheet. The years appear here once either is in.</div>
      <div className="row" style={{ gap: 8, marginTop: 10 }}><button className="btn small primary" onClick={() => booksTabGo("import")}>Read the books from Tally</button><button className="btn small" onClick={() => doAct("salaryPick")}>Import salary for 24Q</button></div>
    </> : <>
      <Bar fys={fys} />
      <Crumbs />
      {v === "notices" ? <Notices b={b} kind="tds" />
        : v === "years" ? <Years rows={rows} fys={had} />
        : v === "certs" ? <CertsPage />
        : v === "return" ? (S.tdsForm === "24Q" ? <Return24 b={b} /> : <Return26 b={b} allRows={S.tdsForm === "27Q" ? TDS.nrRows() : S.tdsForm === "27EQ" ? TDS.tcsRows() : rows} form={S.tdsForm || "26Q"} />)
        : notRead ? notRead
        : <Year b={b} />}
    </>}
  </>;
}
