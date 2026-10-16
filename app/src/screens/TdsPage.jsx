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
import { Return26, Return24, CardCtx } from "./TdsReturn.jsx";
import Register from "./tds/Register.jsx";
import TaxLedgers from "./books/TaxLedgers.jsx";
import HelpButton from "../parts/HelpButton.jsx";
import More from "../parts/More.jsx";
import { Notices } from "../parts/Ai.jsx";
import NotRead from "../parts/NotRead.jsx";
import NoTds from "./tds/NoTds.jsx";
import "../parts/returns.css";
import Filters, { Field } from "../parts/Filters.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
export const Q_MONTHS = { Q1: "Apr–Jun", Q2: "Jul–Sep", Q3: "Oct–Dec", Q4: "Jan–Mar" };
// the due dates as the late fee works them out (TDS.dueWords; the TDS review's H2: Form 143 from 2026-27 is due with the TDS returns)
export const qDue = (fy, q, form) => TDS.dueWords(fy, q, form || "26Q");
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

// one line for the ledgers still to confirm (the owner: "19 ledgers to confirm → Confirm")
// (ledger-confirm, 14-Oct-2026: Confirm opens the ledgers here, the TDS page's own Ledgers, TaxLedgers.jsx)
function LedgerLine({ b }) {
  const p = TaxLed.pending(b, "tds");
  if (!p.length) return null;
  return <p className="tg-ledline" data-ledger-banner="" title={"Still to confirm: " + p.slice(0, 6).map((x) => x[0]).join(", ") + (p.length > 6 ? " and " + (p.length - 6) + " more" : "")}>
    <span className="dot" aria-hidden="true" />{p.length} ledger{p.length === 1 ? "" : "s"} to confirm → <button className="linkbtn" data-ledger-confirm="" onClick={() => TaxLed.go("tds")}>Confirm</button></p>;
}

// the bar under the tabs: the year, and on Returns the quarter and form (year → quarter → form opens a return), on
// Challans the quarter
function Bar({ fys, inCard }) {
  const fy = S.tdsFy, v = S.tdsView;
  const q = v === "return" || v === "year" ? S.tdsQ || "" : "", form = v === "return" ? S.tdsForm || "26Q" : v === "year" ? S.tdsPickForm || "" : "";
  const setFy = (x) => tdsPick(x, q, form);
  // ui-tidy (13-Oct-2026): the one filter bar (parts/Filters.jsx): the year and quarter, then the form; More at its end
  return <Filters className="tg-bar" label="Choose the return" data-tds-bar=""
    period={<>
      <Field label={TDS.yearWord(fy)}>
        <select aria-label="Year" value={fy} onChange={(ev) => setFy(ev.target.value)}>
          {/* t70: the chosen one shows short in the closed box (the year, the form number), the full words in the list */}
          {fys.map((f) => <option key={f} value={f} label={inCard && f === fy ? f : undefined}>{f}{TDS.isNew(f) ? " (Act of 2025)" : ""}</option>)}</select></Field>
      <Field label="Quarter">
        <select aria-label="Quarter" value={q} onChange={(ev) => tdsPick(fy, ev.target.value, form)}>
          <option value="">Every quarter</option>
          {["Q1", "Q2", "Q3", "Q4"].map((x) => <option key={x} value={x}>{x} · {Q_MONTHS[x]}</option>)}</select></Field>
    </>}
    type={<Field label="Form">
      <select aria-label="Form" value={form} onChange={(ev) => tdsPick(fy, q, ev.target.value)}>
        <option value="">Every form</option>
        {FORMS.map((k) => <option key={k} value={k} label={inCard && k === form ? (TDS.isNew(fy) ? "Form " + TDS.formNo(k, fy) + " (" + k + ")" : k) : undefined}>{TDS.formLabel(k, fy)}</option>)}</select></Field>}
    onClear={v !== "return" ? () => tdsPick(fy, "", "") : null} active={!!(q || form)}
    tools={v !== "return" ? <More items={[
          ["Every year", () => tdsNav("years"), { "data-tds-more": "years" }],
          ["The challan register", () => tdsNav("register"), { "data-tds-more": "register" }],
          ["TDS ledgers (confirm, unconfirm)", () => TaxLed.go("tds"), { "data-tds-more": "ledgers" }],
          ["TDS receivable vs 26AS (Reconciliations)", () => { S.recFy = fy; booksTabGo("recon"); }, { "data-tds-more": "recon" }],
          AIH.enabled("notices") && ["Notices", () => tdsNav("notices"), { "data-tds-more": "notices" }],
          ["Download the year, " + TDS.formName("26Q", fy), () => doAct("yearExcel26")],
          ["Download the year, " + TDS.formName("24Q", fy), () => doAct("yearExcel24")],
          ["Download the whole year", () => doAct("yearExcelAll")],
        ]} /> : inCard ? null : <HelpButton />} />;
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

// one cell of the grid: a return (the owner, 14-Oct-2026: "Where is the TDS return?"): a button with its name ("26Q · Q2"),
// its status in words and colour (To fix N red, Ready blue, Filed green), the amount and the counts, and "Open →" on hover
// or focus. A return with nothing in it says "No entries" and is no button (nothing useful would open)
function Cell({ fy, q, form, st, n, lines, amount, corr }) {
  const name = (TDS.isNew(fy) && TDS.NEW_FORM[form] ? "Form " + TDS.NEW_FORM[form] : form) + " · " + q;
  const label = st === "none" ? "No entries" : st === "bad" ? (corr ? "Correction " + corr : "To fix " + n) : st === "filed" ? "Filed" : "Ready";
  const body = <>
    <span className="rp-name" data-cell-name="">{name}</span>
    <span className="rp-s">{label}</span>
    {st === "filed" && n ? <span className="nr">on {n}</span> : null}
    {amount != null && <span className="rp-a">{amount}</span>}
    {lines.map((w, i) => <span key={i} className={"nr" + (w.bad ? " bad" : "")}>{w.t}</span>)}
  </>;
  // nothing to open: an empty return (a 24Q with salary TDS in the books still opens, to bring in the salary sheet)
  if (st === "none" && amount == null && !lines.length) return <td><div className="rp-cell st-none rp-empty" data-cell={form + "|" + q} data-status={st} aria-label={name + ": no entries"}>{body}</div></td>;
  return <td><button className={"rp-cell st-" + st} data-cell={form + "|" + q} data-status={st}
    aria-label={TDS.formShort(form, fy) + " " + q + ": " + label + ". Open the return"} onClick={() => tdsGo(fy, q, form)}>
    {body}<span className="rp-open" aria-hidden="true">Open →</span>
  </button></td>;
}

// the status of each form in a quarter, from what the year's table showed: the quarter's figures (TDSYear.quarters) and
// the counts of the rows with something to fix. Filed (T-E1, 10-Oct-2026): the return marked filed on its File tab, or the
// quarter's date under Settings › Closed periods (TDSFiled, src/js/66), for every form
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
  // T-S2: a filed return whose entries changed in Tally since it was filed: "Correction N", red, with its filed date
  ["26Q", "27Q", "27EQ"].forEach((form) => {
    const c = out[form]; if (!c || c.st !== "filed") return;
    const d = TDSDrift.check(fy, q, form);
    if (d && d.rows.length) Object.assign(c, { st: "bad", corr: d.rows.length, lines: [{ t: "filed " + c.n }, { t: "changed in Tally since", bad: 1 }] });
  });
  return out;
}

function Year() {
  const fy = S.tdsFy, qs = TDSYear.quarters(fy), b = S.books;
  // back from a return: the bar shows the quarter, and every form
  if (S.tdsQ && S.tdsPickForm) S.tdsPickForm = "";
  const all = qs.map((x) => cells(b, fy, x));
  const yearTotal = { "26Q": money(qs.reduce((a, x) => a + x.tds, 0)), "24Q": money(qs.reduce((a, x) => a + x.salaryTds, 0)),
    "27Q": money(qs.reduce((a, x) => a + x.nr.tds, 0)), "27EQ": money(qs.reduce((a, x) => a + x.tcs.tds, 0)) };
  const forms = S.tdsPickForm ? [S.tdsPickForm] : FORMS, quarters = S.tdsQ ? [S.tdsQ] : ["Q1", "Q2", "Q3", "Q4"];
  // each form's returns by status, under its name (tds-layout: the four summary cards above the grid are gone)
  const says = (k) => { const n = { filed: 0, bad: 0, ready: 0 }; quarters.forEach((q) => { const c = all[["Q1", "Q2", "Q3", "Q4"].indexOf(q)][k]; if (c && n[c.st] != null) n[c.st]++; });
    return [n.bad && n.bad + " to fix", n.ready && n.ready + " ready", n.filed && n.filed + " filed"].filter(Boolean).join(" · ") || "nothing yet"; };
  // the year's totals in the grid's header row: each quarter's TDS and TCS of every form, and the year's (tds-layout)
  const qTotal = (x) => r2(x.tds + x.salaryTds + x.nr.tds + x.tcs.tds), byQ = {};
  qs.forEach((x) => { byQ[x.q] = qTotal(x); });
  const yearAll = money(qs.reduce((a, x) => a + qTotal(x), 0));
  const nCh = TDS.challans().length;
  return <>
  <section className="dash-card" data-tds-grid={fy}>
    <div className="rp-title"><h3>TDS returns · FY {fy}</h3>
      <span className="note">{TDS.isNew(fy) ? "Forms of the Income-tax Act, 2025, the old form in brackets." : "Forms of the Income-tax Act, 1961."}</span>
      {/* the one way to the challan register (the review: no panel beside the grid) */}
      <span className="tg-reglink" data-ch-register="">{nCh ? <button className="linkbtn" onClick={() => tdsNav("register")}>Challan register →</button>
        : <>No challans · <button className="linkbtn" data-ch-add="" onClick={() => { S.regAdding = true; tdsNav("register"); }}>Add challan</button></>}</span></div>
    <p className="tg-hint" data-grid-hint="">Click a return to open it.</p>
    <div className="bk-tablewrap"><table className="rp-grid gf-off">
      {/* aria-label: the heading's name read out, and on a phone each card's label (src/js/53-phone.js), with the due date
          apart from the months ("Q1 · Apr–Jun, due 31 Jul"; it read "Apr–Jundue 31 Jul" at 390px) */}
      <thead><tr><th>Form</th>{quarters.map((q) => <th key={q} aria-label={q + " · " + Q_MONTHS[q] + ", due " + qDue(fy, q) + ", " + money(byQ[q] || 0)}>{q} · {Q_MONTHS[q]}<small>due {qDue(fy, q)}</small><small className="tg-qtot" data-q-total={q}>{money(byQ[q] || 0)}</small></th>)}
        <th className="n" aria-label={"Year, " + yearAll}>Year<small className="tg-qtot" data-year-total="">{yearAll}</small></th></tr></thead>
      <tbody>{forms.map((k) => <tr key={k} data-form={k}>
        <th scope="row">{TDS.formShort(k, fy)}<small>{TDS.FORM_ABOUT[k]}</small>{qDue(fy, "Q1", k) !== qDue(fy, "Q1") && <small data-form-due={k}>due the 15th: {["Q1", "Q2", "Q3", "Q4"].map((q) => qDue(fy, q, k)).join(", ")}</small>}<small className="tg-says" data-form-says={k}>{says(k)}</small></th>
        {quarters.map((q) => { const c = all[["Q1", "Q2", "Q3", "Q4"].indexOf(q)][k]; return <Cell key={q} fy={fy} q={q} form={k} {...c} />; })}
        <td className="n"><b>{yearTotal[k]}</b>{k === "26Q" && <div className="nr">{qs.reduce((a, x) => a + x.deductions, 0)} deductions</div>}</td>
      </tr>)}</tbody>
    </table></div>
    <div className="rp-key" aria-label="Colours"><span style={{ "--k": "var(--rule-strong)" }}>No entries</span><span style={{ "--k": "var(--info)" }}>Ready</span>
      <span style={{ "--k": "var(--bad)" }}>To fix</span><span style={{ "--k": "var(--ok)" }}>Filed</span></div>
  </section></>;
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
  // t70 (the owner: "too much information above.. it should look more professional"): a return open, the year, quarter
  // and form and the ledgers' line go into the return's card, its first row (ReturnCard draws CardCtx.node)
  const inCard = v === "return" && !none;
  CardCtx.node = inCard ? <>{fys.length > 0 && <Bar fys={fys} inCard />}<LedgerLine b={b} /></> : null;
  CardCtx.help = inCard ? <HelpButton /> : null;
  return <div data-phone-scroll="" data-tds-page="">
    {/* the ledgers still to confirm: one line (tds-layout), on the year's page and a return's */}
    {!inCard && v !== "register" && v !== "ledgers" && <LedgerLine b={b} />}
    {!inCard && !none && fys.length > 0 && v !== "years" && v !== "notices" && v !== "register" && v !== "ledgers" && <Bar fys={fys} />}
    {v === "ledgers" ? <TaxLedgers b={b} kind="tds" />
      // round 65: the books are in but hold no TDS: said plainly, with the TDS ledgers that have no entries and what should
      // have been deducted (tds/NoTds.jsx); "Bring in from Tally" only when there are no entries at all
      : none && booksIn ? <NoTds b={b} />
      : none && notRead ? notRead : none ? <Calm>TDS is worked out from the day book. Salary for {TDS.formShort("24Q", S.tdsFy || fys[0] || "")} can also come from a salary sheet. The returns appear here once either is in.
      <div className="row" style={{ gap: 8, justifyContent: "center" }}><button className="btn small primary" onClick={() => goClient("books:import")}>Bring in from Tally</button>
        <button className="btn small" onClick={() => doAct("salaryPick")}>Import salary for 24Q</button></div></Calm>
      : v === "notices" ? <><p className="note"><button className="linkbtn" onClick={() => tdsNav("year")}>← Returns</button></p><Notices b={b} kind="tds" /></>
      : v === "years" ? <><p className="note"><button className="linkbtn" onClick={() => tdsNav("year")}>← {TDS.yearWord(S.tdsFy)} {S.tdsFy}</button></p><Years rows={rows} fys={had} /></>
      : v === "register" ? <Register />
      : v === "return" ? (S.tdsForm === "24Q" ? <Return24 b={b} /> : <Return26 b={b} allRows={S.tdsForm === "27Q" ? TDS.nrRows() : S.tdsForm === "27EQ" ? TDS.tcsRows() : rows} form={S.tdsForm || "26Q"} />)
      : notRead ? notRead
      : <Year />}
  </div>;
}
