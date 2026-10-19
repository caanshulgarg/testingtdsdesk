// A client's TDS home (next-tds-clear, design §3.1; the owner: TDS "like ClearTax, not cluttered"). Above the grid only:
// the header (TDS · client · TAN, the year, ⋯), the ledgers to confirm when there are any, and ONE "Due now" line with
// the page's one primary button, Continue. Then the returns: form × quarter, each cell its status (one vocabulary:
// Not started · In progress · Ready · FVU made · Filed · Processed, tds/Shell.jsx STATUS) and its TDS; and one line for the
// challans with what is unconsumed and the way to the challan register.
// The amounts are TDSYear.quarters (src/js/18) as before; a cell's status comes from that return's checks
// (tds/Validate.jsx checkReturn), the same count the return's Validate & file shows.
import More from "../../parts/More.jsx";
import HelpButton from "../../parts/HelpButton.jsx";
import { STATUS, StatusChip, statusOf, Q_MON } from "./Shell.jsx";
import { checkReturn } from "./Validate.jsx";
import { openAllChallans } from "./AllChallans.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const QS = ["Q1", "Q2", "Q3", "Q4"], FORMS = ["26Q", "24Q", "27Q", "27EQ"];
const qEnd = (fy, q) => { const y = num(String(fy).slice(0, 4)); return { Q1: y + "0630", Q2: y + "0930", Q3: y + "1231", Q4: (y + 1) + "0331" }[q]; };
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10).replace(/-/g, "");

// each form's cell in a quarter: {has, amount, st, n}
export function homeCells(fy, x) {
  const q = x.q, out = {};
  const cell = (form, has, amount) => {
    if (!has) return { has: false, amount, st: "none", n: 0 };
    const v = checkReturn(fy, q, form);
    return { has: true, amount, st: statusOf({ fy, q, form, has: true, errors: v.errors.length, drift: v.drift, problems: v.n }), n: v.n, errors: v.errors.length };
  };
  out["26Q"] = cell("26Q", !!(x.deductions || x.challans), money(x.tds));
  out["27Q"] = cell("27Q", !!x.nr.n, money(x.nr.tds));
  out["27EQ"] = cell("27EQ", !!x.tcs.n, money(x.tcs.tds));
  const booksTds = r2(TDS.salaryRows().filter((r) => r.fy === fy && r.q === q).reduce((a, r) => a + r.tds, 0));
  const pay = (() => { try { return Payroll.has(fy) && Payroll.annexI(fy, q).length > 0; } catch (e) { return false; } })();
  out["24Q"] = cell("24Q", !!(x.salaryEmployees || booksTds > 0 || pay), x.salaryEmployees ? money(x.salaryTds) : booksTds > 0 ? money(booksTds) : null);
  return out;
}

// the return due now: the oldest quarter of the year that has ended and is not filed, with entries; else the quarter due
// now (Smart.tdsDue) if it is this year's
function dueNow(fy, all) {
  const t = todayIst(), cand = [];
  QS.forEach((q, i) => FORMS.forEach((f) => { const c = all[i][f]; if (c.has && !["filed", "processed"].includes(c.st) && qEnd(fy, q) < t) cand.push({ q, form: f, c }); }));
  // the oldest quarter first; in a quarter, one with something to fix before one ready
  cand.sort((a, b) => QS.indexOf(a.q) - QS.indexOf(b.q) || (b.c.n > 0) - (a.c.n > 0) || FORMS.indexOf(a.form) - FORMS.indexOf(b.form));
  return cand[0] || null;
}

function LedgerLine({ b }) {
  const p = TaxLed.pending(b, "tds");
  if (!p.length) return null;
  return <p className="tg-ledline hc-led" data-ledger-banner="" title={"Still to confirm: " + p.slice(0, 6).map((x) => x[0]).join(", ") + (p.length > 6 ? " and " + (p.length - 6) + " more" : "")}>
    <span className="dot" aria-hidden="true" />{p.length} ledger{p.length === 1 ? "" : "s"} to confirm → <button className="linkbtn" data-ledger-confirm="" onClick={() => TaxLed.go("tds")}>Confirm</button></p>;
}

// the header line: TDS · client · TAN, the year, ⋯ (the TDS home and the Every year page)
export function HomeHead({ fys, b, onYear }) {
  const fy = S.tdsFy, co = CO() || {};
  return <div className="hc-head" data-tds-bar="">
    <h2 className="hc-title">TDS <span className="note">· {co.name || ""}{co.tan ? " · TAN " + co.tan : ""}</span></h2>
    <span className="rt-sp" />
    <label className="hc-fy"><span>{TDS.yearWord(fy)}</span>
      <select aria-label="Year" value={fy} onChange={(ev) => (onYear ? onYear(ev.target.value) : tdsPick(ev.target.value, "", ""))}>
        {fys.map((f) => <option key={f} value={f}>{f}{TDS.isNew(f) ? " (Act of 2025)" : ""}</option>)}</select></label>
    <button type="button" className="btn small" data-tds-allch="" onClick={() => openAllChallans(fy, null)}>All challans</button>
    <More label="⋯" ariaLabel="More" items={[
      ["Every year", () => tdsNav("years"), { "data-tds-more": "years" }],
      ["The challan register", () => tdsNav("register"), { "data-tds-more": "register" }],
      ["PAN book (every deductee's PAN)", () => { S.tdsPanBook = true; render(); }, { "data-tds-more": "panbook" }],
      ["TDS ledgers (confirm, unconfirm)", () => TaxLed.go("tds"), { "data-tds-more": "ledgers" }],
      ["TDS receivable vs 26AS (Reconciliations)", () => { S.recFy = fy; booksTabGo("recon"); }, { "data-tds-more": "recon" }],
      AIH.enabled("notices") && ["Notices", () => tdsNav("notices"), { "data-tds-more": "notices" }],
      ["Download the year, " + TDS.formName("26Q", fy), () => doAct("yearExcel26")],
      ["Download the year, " + TDS.formName("24Q", fy), () => doAct("yearExcel24")],
      ["Download the whole year", () => doAct("yearExcelAll")],
    ]} />
    <HelpButton />
  </div>;
}

export default function Home({ fys, b }) {
  const fy = S.tdsFy, qs = TDSYear.quarters(fy);
  // back from a return: every form, every quarter (the grid is the filter)
  if (S.tdsPickForm) S.tdsPickForm = "";
  const all = qs.map((x) => homeCells(fy, x));
  const yearTotal = { "26Q": qs.reduce((a, x) => a + x.tds, 0), "24Q": qs.reduce((a, x) => a + x.salaryTds, 0), "27Q": qs.reduce((a, x) => a + x.nr.tds, 0), "27EQ": qs.reduce((a, x) => a + x.tcs.tds, 0) };
  const qTotal = (x) => r2(x.tds + x.salaryTds + x.nr.tds + x.tcs.tds), byQ = {};
  qs.forEach((x) => { byQ[x.q] = qTotal(x); });
  const yearAll = money(qs.reduce((a, x) => a + qTotal(x), 0));
  const due = dueNow(fy, all);
  const chs = TDS.challans(), cx = TDSReg.ctx(), left = chs.filter((c) => TDSReg.balance(c, cx).tax > 0.005), unc = r2(left.reduce((a, c) => a + TDSReg.balance(c, cx).tax, 0));
  return <div className="hc" data-tds-home={fy}>
    <HomeHead fys={fys} b={b} />
    <LedgerLine b={b} />
    <div className="hc-due" data-due-now={due ? due.form + "|" + due.q : ""}>
      {due ? <><span><b>Due now:</b> {TDS.formShort(due.form, fy)} {due.q} · due {TDS.dueWords(fy, due.q, due.form)} · <StatusChip st={due.c.st} />{due.c.n ? <span className={due.c.errors ? " bad" : " warn"} data-due-problems={due.c.n}> {due.c.n} to fix</span> : null}</span>
        <span className="rt-sp" /><button className="btn small primary" data-due-continue="" onClick={() => tdsGo(fy, due.q, due.form)}>Continue →</button></>
        : <span className="note">Nothing due now for {fy}: every quarter that has ended is filed or has no entries.</span>}
    </div>
    <section className="hc-gridcard" data-tds-grid={fy}>
      <div className="bk-tablewrap"><table className="rp-grid hc-grid gf-off">
        <thead><tr><th>Return</th>{QS.map((q) => <th key={q} title={"due " + TDS.dueWords(fy, q)} aria-label={q + " · " + Q_MON[q] + ", due " + TDS.dueWords(fy, q, "26Q") + ", " + money(byQ[q] || 0)}>{q} <span className="hc-mon">{Q_MON[q]}</span></th>)}
          <th className="n" aria-label={"Year, " + yearAll}>Year</th></tr></thead>
        <tbody>{FORMS.map((k) => <tr key={k} data-form={k}>
          <th scope="row" title={(TDS.isNew(fy) ? "Forms of the Income-tax Act, 2025, the old form in brackets. " : "") + (TDS.FORM_ABOUT[k] || "")}>{TDS.formShort(k, fy)}<small>{String(TDS.FORM_ABOUT[k] || "").split(",")[0].toLowerCase()}</small></th>
          {QS.map((q, i) => { const c = all[i][k], name = TDS.formShort(k, fy) + " " + q;
            const body = <><StatusChip st={c.st} />{c.has || c.amount ? <span className="rp-a">{c.amount || "—"}</span> : null}</>;
            return <td key={q}>{c.has ? <button className={"rp-cell hc-cell st-" + c.st} data-cell={k + "|" + q} data-status={c.st} data-problems={c.n} aria-label={name + ": " + STATUS[c.st][0] + ". Open the return"} onClick={() => tdsGo(fy, q, k)}>{body}<span className="rp-open" aria-hidden="true">Open →</span></button>
              : <div className={"rp-cell hc-cell rp-empty st-none"} data-cell={k + "|" + q} data-status="none" aria-label={name + ": not started"}>{body}</div>}</td>; })}
          <td className="n"><b>{money(yearTotal[k])}</b></td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">All forms</th>{QS.map((q) => <td key={q} className="n" data-q-total={q}>{money(byQ[q] || 0)}</td>)}<td className="n" data-year-total=""><b>{yearAll}</b></td></tr></tfoot>
      </table></div>
    </section>
    <p className="hc-foot" data-ch-register="">{chs.length ? <>Challans: {chs.length} · {left.length ? money(unc) + " unconsumed across " + left.length + " challan" + (left.length === 1 ? "" : "s") : "every challan used"} · <button className="linkbtn" onClick={() => tdsNav("register")}>Challan register</button></>
      : <>No challans · <button className="linkbtn" data-ch-add="" onClick={() => { S.regAdding = true; tdsNav("register"); }}>Add challan</button></>}</p>
  </div>;
}
