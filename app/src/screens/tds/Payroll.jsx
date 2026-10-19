// Bridge 2.4.4 (the owner's decisions of 12-Oct-2026): salary under the client's TDS, from Tally's payroll (Payroll, src/js/73).
//   Salary (a TDS tab, S.tdsView "salary", S.paySub):
//     Employees      Tally's employees (name, PAN, group, designation, joined, left) and, opened under each, what Tally does
//                    not keep and Form 16 needs: the tax regime, the declarations, rent and the landlord's PAN, housing-loan
//                    interest and the lender's PAN, the previous employer's salary and TDS, the address, and (old regime only)
//                    whether the employee is a senior citizen. Kept with the books as items (payDetails).
//     Pay register   a month: each employee's amount per pay head as Tally keeps it, gross, deductions, net, TDS.
//     Form 16        Part B for one employee: the year's salary, exemptions, deductions and tax (PayTax, FinCom's rule).
//   Return24Tally: the 24Q (Form 138) return of a quarter from Tally's payroll: Annexure I (per employee per month, with the
//     challan), Annexure II in the fourth quarter (Employees & declarations), To fix, Return file (the text file, built to the current layout and
//     marked "check before filing").
// Nothing here is worked out by AI; every figure is Tally's or FinCom's own rule, to the paisa.
import { useState } from "react";
import ListTable from "../../parts/ListTable.jsx";
import { MarkFiled } from "./Filed.jsx";
import { ChallanCell, MatchDialogs } from "./Match.jsx";
import DeducteesPan from "./Deductees.jsx";
import { DeductorDetails } from "../Settings.jsx";
import { tabNow, ReturnChallans, AfterFiling, UnknownChallans, SalaryChecks, FixRows } from "./ReturnParts.jsx";
import { retChallans } from "./Winman.jsx";
import { unplacedOf } from "./onChallan.js";
import { ReturnShell, statusOf, stepName, FvuMade } from "./Shell.jsx";
import { checkReturn, ValidatePanel, PrnBox } from "./Validate.jsx";
import { TracesDefaults } from "./Files.jsx";
import { PanBox } from "./PanBook.jsx";
// TDSF25 (src/js/83-tds-forms-2025.js: Form 138's text file, TDS24Q_FILE.build) comes with this screen's file, not in legacy.js (build.py lazy_files)
import "../../../../src/js/83-tds-forms-2025.js";
import "../../lib/tdsGlobals.js";   // next-challan-match: TDSMatch, PANCheck and the matcher's rules come with the TDS screens

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const monthWord = (ym) => (ym ? MONTHS3[num(ym.slice(4, 6)) - 1] + " " + ym.slice(0, 4) : "");
const Pan = ({ pan }) => (Certs.validPan(pan) ? <>{pan}</> : <span className="tag warn">no PAN</span>);
const Tile = ({ label, value, sub, warn }) => <div className={"dtile" + (warn ? " warn" : "")}><span>{label}</span><b>{value}</b><small>{sub}</small></div>;

const SUBS = [["employees", "Employees"], ["register", "Pay register"], ["form16", "Form 16"]];

export default function Salary() {
  const fy = S.tdsFy, emp = Payroll.employees(), months = Payroll.months(fy);
  if (!SUBS.some((s) => s[0] === S.paySub)) S.paySub = "employees";
  if (!emp.length) {
    return <section className="dash-card" style={{ maxWidth: 760 }} data-salary-empty="">
      <h3>No payroll from Tally yet</h3>
      <p className="note">FinCom Bridge 2.4.4 brings Tally's employees and each month's payroll by itself, once payroll is on in Tally (F11, Payroll) and the employees are made there. The salary sheet under 24Q still works for a client whose payroll is kept outside Tally.</p>
    </section>;
  }
  return <>
    <TdsHeads />
    <div className="dtiles" style={{ marginBottom: 12 }} data-salary-tiles="">
      <Tile label="Employees" value={emp.filter((e) => !e.gone).length} sub={Payroll.groups().length + " group" + (Payroll.groups().length === 1 ? "" : "s")} />
      <Tile label={"Months paid in " + fy} value={months.length} sub={months.length ? monthWord(months[0]) + " to " + monthWord(months[months.length - 1]) : "none yet"} />
      <Tile label="Regime not chosen" value={emp.filter((e) => !Payroll.detail(e).regime).length} sub="new regime taken until chosen" warn={emp.some((e) => !Payroll.detail(e).regime)} />
    </div>
    <nav className="sbar rp-tabs" aria-label="Salary">{SUBS.map(([k, l]) => <button key={k} data-pay-sub={k} aria-selected={S.paySub === k} onClick={() => { S.paySub = k; render(); }}>{l}</button>)}</nav>
    {S.paySub === "register" ? <Register fy={fy} months={months} /> : S.paySub === "form16" ? <Form16 fy={fy} /> : <Employees fy={fy} />}
  </>;
}

/* ---------------------------------------------------------------- round 92 (A, F): which pay head is TDS */
const HOW = { tally: "Tally's statutory type Income Tax", map: "read as TDS under 192 from its ledger", name: "found by its name; Tally's statutory type is blank", chosen: "you chose it" };
function TdsHeads() {
  const heads = Payroll.tdsHeads(), ded = Payroll.dedHeads().filter((h) => !heads.includes(h)), old = Payroll.headsOld();
  return <section className="dash-card" style={{ marginBottom: 12 }} data-pay-tds-heads="">
    {heads.length ? <p className="note" style={{ margin: 0 }}>TDS pay head{heads.length > 1 ? "s" : ""}: {heads.map((h, i) => <span key={h}>{i ? " · " : ""}<b>{h}</b> ({HOW[Payroll.tdsHow(h)] || ""}) <button className="linkbtn" data-pay-tds-no={h} onClick={() => payTdsHead(h, false)}>Not TDS</button></span>)}</p>
      : <p className="note warn" style={{ margin: 0 }} data-pay-tds-none="">No pay head is read as TDS, so no employee's TDS is shown. Which one deducts the income tax?</p>}
    {!heads.length && ded.length > 0 && <p style={{ margin: "6px 0 0" }}>{ded.map((h) => <button key={h} className="btn small" style={{ marginRight: 6, marginBottom: 4 }} data-pay-tds-yes={h} onClick={() => payTdsHead(h, true)}>{h}: this pay head is TDS</button>)}</p>}
    {old && <p className="note warn" style={{ margin: "6px 0 0" }} data-pay-heads-old="">Tally's pay heads came without their types (the ledgers were last read before FinCom Bridge 2.4.4), so earnings, deductions and TDS cannot be told apart. <button className="linkbtn" data-pay-ask-ledgers="" onClick={() => payAskLedgers()}>Update ledgers from Tally</button></p>}
  </section>;
}

/* ---------------------------------------------------------------- employees, and what FinCom keeps for each */
function Employees({ fy }) {
  const list = Payroll.employees();
  return <section className="dash-card" data-pay-employees="">
    <h3>Employees in Tally</h3>
    <p className="note">From Tally's payroll. Open an employee for the details Form 16 needs that Tally does not keep; they are kept here, for this client.</p>
    <ListTable name="payEmployees" id="payEmpTable" rows={list} rowKey={(e) => e.guid} unit={["employee", "employees"]}
      after={(e) => (S.payOpen === e.guid ? <Details e={e} fy={fy} /> : null)}
      cols={[
        { k: "name", role: "party", label: "Employee", v: (e) => e.name, cell: (e) => <button className="linkbtn" data-pay-open={e.guid} onClick={() => { S.payOpen = S.payOpen === e.guid ? "" : e.guid; render(); }}>{S.payOpen === e.guid ? "▾ " : "▸ "}{e.name}</button> },
        { k: "pan", label: "PAN", v: (e) => e.pan, cell: (e) => <Pan pan={e.pan} /> },
        { k: "grp", label: "Group", v: (e) => e.parent, cell: (e) => e.parent || "—" },
        { k: "des", label: "Designation", v: (e) => e.designation, cell: (e) => e.designation || "—" },
        { k: "join", role: "date", label: "Joined", v: (e) => e.joined, cell: (e) => day(e.joined) || "—" },
        { k: "left", role: "date", label: "Left", v: (e) => e.left, cell: (e) => day(e.left) || "—" },
        { k: "reg", label: "Regime", v: (e) => Payroll.detail(e).regime || "", cell: (e) => { const r = Payroll.detail(e).regime; return r ? (r === "old" ? "Old" : "New") : <span className="tag warn">not chosen</span>; } },
        { k: "tds", label: "TDS " + fy, cls: "n", v: (e) => Payroll.yearOf(e, fy).tds, fmt: money, sum: true, cell: (e) => money(Payroll.yearOf(e, fy).tds) },
      ]} />
  </section>;
}

function Field({ e, k, label, kind, hint, width }) {
  const d = Payroll.detail(e), v = d[k] == null ? "" : d[k];
  const [t, setT] = useState(String(v));
  const save = () => { if (String(t) !== String(v)) payDetailSet(e.guid, k, t); };
  return <label className="rp-f" style={{ display: "inline-flex", flexDirection: "column", marginRight: 12, marginBottom: 8 }}>
    <span className="note">{label}</span>
    <input type="text" value={t} inputMode={kind === "money" ? "decimal" : undefined} aria-label={label} data-pay-field={k} title={hint}
      style={{ width: width || (kind === "money" ? 130 : 160), textAlign: kind === "money" ? "right" : "left" }}
      onChange={(ev) => setT(ev.target.value)} onBlur={save} onKeyDown={(ev) => { if (ev.key === "Enter") save(); }} />
  </label>;
}
function YesNo({ e, k, label }) {
  const v = Payroll.detail(e)[k] === "yes";
  return <label className="rp-f" style={{ marginRight: 16 }}><input type="checkbox" checked={v} data-pay-field={k} onChange={(ev) => payDetailSet(e.guid, k, ev.target.checked ? "yes" : "no")} /> {label}</label>;
}

function Details({ e, fy }) {
  const d = Payroll.detail(e), old = d.regime === "old", f = Payroll.form16(e, fy);
  return <div style={{ padding: "12px 16px" }} data-pay-details={e.guid}>
    <div className="row" style={{ gap: 16, alignItems: "center", marginBottom: 8 }}>
      <label className="rp-f">Tax regime
        <select aria-label="Tax regime" value={d.regime || ""} data-pay-field="regime" onChange={(ev) => payDetailSet(e.guid, "regime", ev.target.value)}>
          <option value="">not chosen (new taken)</option><option value="new">New</option><option value="old">Old</option></select></label>
      {old && <YesNo e={e} k="senior" label="Senior citizen (60 or over)" />}
      {old && <YesNo e={e} k="hraMetro" label="HRA at 50% (metro)" />}
    </div>
    <div>
      {old && <><Field e={e} k="rent" label="Rent paid in the year" kind="money" /><Field e={e} k="landlordPan" label="Landlord's PAN" width={120} />
        <Field e={e} k="landlordName" label="Landlord's name" width={160} />
        <Field e={e} k="hlInterest" label="Housing-loan interest" kind="money" /><Field e={e} k="lenderPan" label="Lender's PAN" width={120} />
        <Field e={e} k="lenderName" label="Lender's name" width={160} /></>}
      <Field e={e} k="prevSalary" label="Previous employer's salary" kind="money" hint="Salary from an earlier employer this year (after its exemptions)" />
      <Field e={e} k="prevTds" label="Previous employer's TDS" kind="money" />
    </div>
    <div>
      {old && <><Field e={e} k="d80C" label="80C (PF, LIC, PPF…)" kind="money" /><Field e={e} k="d80CCD1B" label="80CCD(1B) NPS" kind="money" />
        <Field e={e} k="d80D" label="80D self and family" kind="money" /><Field e={e} k="d80DParents" label="80D parents" kind="money" />
        <YesNo e={e} k="parentsSenior" label="A parent is a senior citizen (80D up to ₹50,000)" />
        <Field e={e} k="d80E" label="80E education loan" kind="money" /><Field e={e} k="d80G" label="80G donations (qualifying)" kind="money" />
        <Field e={e} k="d80TTA" label={d.senior === "yes" ? "80TTB interest" : "80TTA savings interest"} kind="money" /><Field e={e} k="dOther" label="Other Chapter VI-A" kind="money" /></>}
      <Field e={e} k="d80CCD2" label="Employer's NPS contribution for the year (salary, then 80CCD(2))" kind="money" hint="Not a pay head in Tally: the employer's contribution to the employee's NPS. It is added to salary under 17(1) and deducted under 80CCD(2), up to 14% (new regime) or 10% (old) of basic and DA" />
    </div>
    <Field e={e} k="address" label="Address (for Form 16)" width={520} />
    <p className="note" data-pay-tax={e.guid}>{fy}: taxable income {money(f.totalIncome)}, tax {money(f.taxPayable)}, TDS {money(f.tdsTotal)}{f.shortfall > 1 ? <> · <b>{money(f.shortfall)} still to deduct</b></> : f.balance < -1 ? <> · {money(-f.balance)} deducted more than the tax</> : null}.
      {" "}<button className="linkbtn" onClick={() => { S.paySub = "form16"; S.payF16 = e.guid; render(); }}>Form 16 Part B →</button></p>
  </div>;
}

/* ---------------------------------------------------------------- the pay register */
function Register({ fy, months }) {
  const ym = months.includes(S.payYm) ? S.payYm : months[months.length - 1] || "";
  if (!ym) return <p className="note">No payroll in Tally for {fy} yet.</p>;
  const R = Payroll.register(ym), heads = R.heads;
  const tot = (k) => R.rows.reduce((a, r) => a + num(r[k]), 0);
  return <section className="dash-card" data-pay-register={ym}>
    <div className="revfilter">
      <label className="rp-f">Month <select aria-label="Month" value={ym} onChange={(ev) => { S.payYm = ev.target.value; render(); }}>{months.map((m) => <option key={m} value={m}>{monthWord(m)}</option>)}</select></label>
      <span className="note">{R.rows.length} employees · gross {money(tot("gross"))} · TDS {money(tot("tds"))}</span>
      <button className="btn small" onClick={() => printTable("payRegTable", "Pay register, " + monthWord(ym))}>Print or save as PDF</button>
    </div>
    <ListTable name="payRegister" id="payRegTable" rows={R.rows} rowKey={(r) => r.employee} unit={["employee", "employees"]}
      cols={[
        { k: "emp", role: "party", label: "Employee", v: (r) => r.employee, cell: (r) => r.employee },
        { k: "pan", label: "PAN", v: (r) => r.pan, cell: (r) => <Pan pan={r.pan} /> },
        ...heads.map((h) => ({ k: "h:" + h, label: h, cls: "n", v: (r) => num(r.heads[h]), fmt: money, sum: true, cell: (r) => (r.heads[h] ? money(r.heads[h]) : "") })),
        { k: "gross", label: "Gross", cls: "n", v: (r) => r.gross, fmt: money, sum: true, cell: (r) => <b>{money(r.gross)}</b> },
        { k: "ded", label: "Deductions", cls: "n", v: (r) => r.ded, fmt: money, sum: true, cell: (r) => money(r.ded) },
        { k: "net", label: "Net pay", cls: "n", v: (r) => r.net, fmt: money, sum: true, cell: (r) => <b>{money(r.net)}</b> },
        { k: "tds", label: "TDS", cls: "n", v: (r) => r.tds, fmt: money, sum: true, cell: (r) => money(r.tds) },
      ]} />
  </section>;
}

/* ---------------------------------------------------------------- Form 16 Part B */
export function Form16PartB({ e, fy }) {
  const f = Payroll.form16(e, fy), via = f.via || {};
  const row = (label, v, b) => <tr><td>{label}</td><td className="n">{b ? <b>{money(v)}</b> : money(v)}</td></tr>;
  const V = [["c80C", "80C"], ["c80CCD1B", "80CCD(1B)"], ["c80D", "80D"], ["c80DParents", "80D (parents)"], ["c80E", "80E"], ["c80G", "80G"], ["c80TTA", "80TTA / 80TTB"], ["c80CCD2", "80CCD(2)"], ["other", "Others"]];
  return <div className="bk-tablewrap" data-form16={e.guid}>
    <table className="bk-table" id="f16Table" data-statement="">
      <thead><tr><th colSpan={2}>Form 16, Part B · {e.name} · PAN {e.pan || "PANNOTAVBL"} · {TDS.yearWord(fy)} {fy} · {f.regime === "old" ? "old regime (opted out of section 115BAC)" : "new regime (section 115BAC)"}</th></tr></thead>
      <tbody>
        <tr><td colSpan={2}><b>1. Gross salary</b></td></tr>
        {row("(a) Salary as per section 17(1): basic", f.basic)}
        {f.da ? row("    dearness allowance", f.da) : null}
        {row("    house rent allowance", f.hra)}
        {row("    other allowances", f.other)}
        {f.nps ? row("    employer's contribution to NPS (section 17(1)(viii))", f.nps) : null}
        {row("(b) Perquisites, section 17(2)", f.perquisites)}
        {row("(c) Profits in lieu of salary, section 17(3)", f.profitsInLieu)}
        {f.prevSalary ? row("(d) Salary from the previous employer", f.prevSalary) : null}
        {row("(e) Total", f.gross, true)}
        {row("2. Less: allowances exempt under section 10 (house rent allowance, 10(13A))", f.hraExempt)}
        {row("3. Total salary received from current employer and previous", r2(f.gross - f.hraExempt))}
        {row("4. Less: standard deduction, section 16(ia)", f.standard)}
        {row("    tax on employment, section 16(iii)", f.profTax)}
        {row("5. Income chargeable under the head Salaries", f.incomeSalary, true)}
        {row("6. Income (or loss) from house property reported by the employee", f.houseProperty)}
        {row("7. Gross total income", f.grossTotal, true)}
        <tr><td colSpan={2}><b>8. Deductions under Chapter VI-A</b></td></tr>
        {V.filter(([k]) => via[k] != null).map(([k, l]) => <tr key={k}><td>    {l}</td><td className="n">{money(via[k])}</td></tr>)}
        {row("9. Aggregate of deductions under Chapter VI-A", f.chapter6)}
        {row("10. Total taxable income (rounded, section 288A)", f.totalIncome, true)}
        {row("11. Tax on total income", f.slabTax)}
        {row("12. Rebate under section 87A", f.rebate)}
        {row("13. Surcharge", f.surcharge)}
        {row("14. Health and education cess", f.cess)}
        {row("15. Relief under section 89", f.relief89)}
        {row("16. Net tax payable (rounded, section 288B)", f.taxPayable, true)}
        {row("17. Tax deducted by this employer", f.tdsHere)}
        {f.prevTds ? row("    by the previous employer", f.prevTds) : null}
        {row(f.balance >= 0 ? "18. Tax still to deduct" : "18. Deducted more than the tax", Math.abs(f.balance), true)}
      </tbody>
    </table>
    {f.noPan && f.tdsDue > f.taxPayable ? <p className="note" data-f16-nopan=""><b>No PAN:</b> the TDS due is {money(f.tdsDue)} (at least 20% of the income, section 206AA){f.shortfall > 1 ? <>; {money(f.shortfall)} of it not yet deducted</> : null}. The tax above stays the tax on the income.</p> : null}
    {!f.rulesKnown ? <p className="note warn" data-f16-rules="">FinCom works out salary tax for {PayTax.YEARS.join(" and ")} only: the figures above are not {fy}'s. Work this year's out by hand.</p> : null}
    <p className="note">Check before filing: the slabs, rebate, surcharge and cess are those of the tax year 2026-27; under the Income-tax Act, 2025 this is Form 130, its sections renumbered. Perquisites and profits in lieu of salary are not told apart in Tally: anything paid through a pay head is salary here.</p>
  </div>;
}
function Form16({ fy }) {
  const list = Payroll.employees().filter((e) => Payroll.yearOf(e, fy).months > 0);
  const e = list.find((x) => x.guid === S.payF16) || list[0];
  if (!e) return <p className="note">No employee was paid in {fy} yet.</p>;
  return <section className="dash-card" data-pay-form16="">
    <div className="revfilter">
      <label className="rp-f">Employee <select aria-label="Employee" value={e.guid} onChange={(ev) => { S.payF16 = ev.target.value; render(); }}>{list.map((x) => <option key={x.guid} value={x.guid}>{x.name}</option>)}</select></label>
      <button className="btn small" onClick={() => printTable("f16Table", "Form 16 Part B, " + e.name + ", " + fy)}>Print or save as PDF</button>
    </div>
    <Form16PartB e={e} fy={fy} />
  </section>;
}

/* ---------------------------------------------------------------- the 24Q return from Tally's payroll */
export function Return24Tally({ fy, q }) {
  const a1 = Payroll.annexI(fy, q), filed = TDSFiled.get(fy, q, "24Q");
  // next-tds-clear (19-Oct-2026): the steps of the ClearTax-like layout (tds/Shell.jsx): Deductor · Employees (PAN) ·
  // Employees & declarations (with Annexure II in Q4) · Challans · Deductions (Annexure I) · Validate & file · After filing
  S.tdsTab = tabNow(S.tdsTab, "24Q");
  const tds = r2(a1.reduce((a, r) => a + r.tds, 0)), key = TDSReg.key("24Q", fy, q);
  const rc = retChallans("24Q", fy, q), usedN = rc.n, val = checkReturn(fy, q, "24Q");
  const status = statusOf({ fy, q, form: "24Q", has: a1.length > 0, errors: val.errors.length, problems: val.n });
  const sal = val.warnings.find((x) => x.k === "salary");
  const emps = new Set(a1.filter((r) => !r.unsplit && !r.unsplitBooks).map((r) => r.employee)).size;
  // round 92 (B, D): TDS not split by employee, and employees with TDS without a PAN (after Tally, the PAN book and the
  // "Salary <name>" ledger), each with Add PAN
  const unTds = r2(a1.filter((r) => r.unsplit || r.unsplitBooks).reduce((a, r) => a + r.tds, 0));
  const noPan = Array.from(new Set(a1.filter((r) => r.tds > 0.005 && !r.unsplit && !r.unsplitBooks && !Certs.validPan(r.pan)).map((r) => r.employee)));
  const splitNote = unTds > 0.005 ? <p className="note warn" data-pay-split="">TDS deducted {money(tds)} · split by employee {money(r2(tds - unTds))} · <b>{money(unTds)} not split by employee</b>: the books carry it under 192 but no employee's TDS does. Mark the TDS pay head under Employees &amp; declarations, or check the payroll in Tally; the file is made once it is split.</p> : null;
  const panNote = noPan.length > 0 ? <div className="note warn" data-pay-nopan="" style={{ marginBottom: 8 }}>PAN missing for {noPan.length} employee{noPan.length === 1 ? "" : "s"} with TDS (not in Tally, the PAN book or the “Salary &lt;name&gt;” ledger). Add PAN:
    {noPan.map((n) => <span key={n} style={{ display: "inline-block", marginLeft: 12 }}>{n} <PanBox party={n} compact /></span>)}</div> : null;
  const steps = [
    { id: "deductor", label: "Deductor" },
    { id: "deductees", label: stepName("deductees", "24Q"), count: emps },
    { id: "people", label: "Employees & declarations" },
    { id: "challans", label: "Challans", count: usedN },
    { id: "deductions", label: "Deductions", count: a1.length },
    { id: "file", label: "Validate & file" },
    { id: "after", label: "After filing", off: !TDSReg.filed(fy, q, "24Q"), why: "Once the return is marked filed (Validate & file › Mark filed)" },
  ];
  const confirmable = (() => { try { return TDSMatch.suggest("24Q", fy, q).filter((s) => s.rule !== "split").length; } catch (e) { return 0; } })();
  // round 94: the strip's amounts only (the counts are on the tabs); Left: the TDS on no challan
  const unRows = unplacedOf(TDS.formRows("24Q").filter((r) => r.fy === fy && r.q === q)), left = r2(unRows.reduce((a, r) => a + num(r.tds), 0));
  const reviews = {
    unmatched: <FixRows title={unRows.length + " salary payments without a challan"} rows={unRows} unit="salary payments" />,
    salary: <div data-pay-checks=""><SalaryChecks list={sal ? sal.list : []} /></div>,
    chtype: <UnknownChallans fy={fy} q={q} form="24Q" />,
    traces: <TracesDefaults jr={TRF.jrFor(fy, q, "24Q")} />,
  };
  const fileBox = <div className="vf-file" data-file="24Q-tally">
    <p className="vf-amber" data-fvu-check="">{TDS.isNew(fy) ? <>The text file is built to Protean's file format 1.1 for Form 138 (Annexure I, Q1 to Q3) and checked with its FVU 1.2; it stays a draft (named _DRAFT) until a statement with the challan file (CSI) from the portal passes FVU 1.2.{q === "Q4" ? " Protean has not yet released the Q4 layout for Form 138: the fourth quarter's file is made once it has." : ""}</> : <>The text file is built to Protean's 24Q file format as its FVU 8.7 checks it (Annexure I{q === "Q4" ? " and II" : ""}). Run it through the FVU before filing.</>}</p>
    <div className="vf-frow" data-prefile-slot="">
      <PrnBox fy={fy} q={q} form="24Q" />
      <button className="btn small primary" data-pay-fvu="" disabled={(TDS.isNew(fy) && q === "Q4") || val.errors.length > 0} onClick={() => { payFvuDownload(fy, q); try { if (!TDS24Q_FILE.build(fy, q, TDS26Q.firmDetails()).error) FvuMade.mark(fy, q, "24Q"); } catch (e) { /* */ } render(); }}>Make FVU file</button>
      <button className="btn small" onClick={() => printTable("q24A1Table", "24Q Annexure I, " + q + " " + fy)}>Print Annexure I</button>
    </div>
    <MarkFiled fy={fy} q={q} form="24Q" />
  </div>;
  return <>
    <MatchDialogs form="24Q" fy={fy} q={q} />
    <ReturnShell fy={fy} q={q} form="24Q" status={status} draft={TDS.isNew(fy) && !filed} val={val} primary={S.tdsTab === "challans" && confirmable && !TDSReg.locked(fy, q, "24Q") ? null : undefined}
      more={[["The challan register", () => tdsNav("register")]]}
      strip={[{ label: "TDS", value: money(tds) }, { label: "On challans", value: money(rc.here) }, { label: "Left", value: money(left), bad: left > 0.005 }]} steps={steps}>
    {S.tdsTab === "deductor" ? <DeductorDetails />
      : S.tdsTab === "deductees" ? <DeducteesPan form="24Q" fy={fy} q={q} />
      : S.tdsTab === "deductions" ? <>{splitNote}{panNote}<ListTable name="q24Annex1" id="q24A1Table" className="bk-table rt-rows" rows={a1} rowKey={(r) => r.id} unit={["payment", "payments"]} data-annex1=""
        empty="No salary paid or credited in this quarter."
        cols={[
          { k: "emp", role: "party", label: "Employee", v: (r) => r.employee || r.party, cell: (r) => (r.unsplit || r.unsplitBooks ? <span data-pay-unsplit={r.id} title={r.note || ""}><span className="tag warn">{Payroll.UNSPLIT}</span>{r.unsplitBooks && r.party ? " " + r.party : ""}</span>
            : <>{r.employee}{r.note ? <small className="note" title={r.note}> · arrears</small> : null}</>) },
          { k: "pan", label: "PAN", v: (r) => r.pan, cell: (r) => (r.unsplit || r.unsplitBooks ? "—" : <Pan pan={r.pan} />) },
          { k: "date", role: "date", label: "Paid or credited", cls: "dt", v: (r) => TDS.ymd(r.date), cell: (r) => day(r.date) },
          { k: "paid", role: "amount", label: "Amount", cls: "n", v: (r) => r.paid, fmt: money, sum: true, cell: (r) => money(r.paid) },
          { k: "tds", role: "amount", label: "TDS", cls: "n", v: (r) => r.tds, fmt: money, sum: true, cell: (r) => money(r.tds) },
          { k: "ded", role: "date", label: "Deducted on", v: (r) => TDS.ymd(r.deducted), cell: (r) => day(r.deducted) || "—" },
          // next-challan-match: the challan, "BSR · date · section", opening the Move dialog (it was read only)
          { k: "ch", label: "Challan", v: (r) => r.challanNo, cell: (r) => (r.tds > 0 ? <span data-challan-of={r.id}><ChallanCell r={r} /></span> : "—") },
        ]} /></>
      : S.tdsTab === "after" ? <AfterFiling fy={fy} q={q} form="24Q" />
      : S.tdsTab === "challans" ? <ReturnChallans fy={fy} q={q} form="24Q" />
      : S.tdsTab === "people" ? <><Salary />{q === "Q4" && <section className="dash-card" style={{ marginTop: 12 }} data-annex2=""><h3>Annexure II, the year</h3><ListTable name="q24Annex2" id="q24A2Table" rows={Payroll.annexII(fy)} rowKey={(x) => x.guid} unit={["employee", "employees"]}
          cols={[
            { k: "name", role: "party", label: "Employee", v: (x) => x.name, cell: (x) => <button className="linkbtn" onClick={() => { S.paySub = "form16"; S.payF16 = x.guid; tdsTabGo("people"); }}>{x.name}</button> },
            { k: "pan", label: "PAN", v: (x) => x.pan, cell: (x) => <Pan pan={x.pan} /> },
            { k: "reg", label: "Regime", v: (x) => x.regime, cell: (x) => (x.regime === "old" ? "Old" : "New") },
            { k: "gross", label: "Gross salary", cls: "n", v: (x) => x.gross, fmt: money, sum: true, cell: (x) => money(x.gross) },
            { k: "ex", label: "Exempt (10)", cls: "n", v: (x) => x.hraExempt, fmt: money, sum: true, cell: (x) => money(x.hraExempt) },
            { k: "std", label: "Standard", cls: "n", v: (x) => x.standard, fmt: money, sum: true, cell: (x) => money(x.standard) },
            { k: "pt", label: "Prof. tax", cls: "n", v: (x) => x.profTax, fmt: money, sum: true, cell: (x) => money(x.profTax) },
            { k: "via", label: "Chapter VI-A", cls: "n", v: (x) => x.chapter6, fmt: money, sum: true, cell: (x) => money(x.chapter6) },
            { k: "ti", label: "Taxable", cls: "n", v: (x) => x.totalIncome, fmt: money, sum: true, cell: (x) => money(x.totalIncome) },
            { k: "tax", label: "Tax", cls: "n", v: (x) => x.taxPayable, fmt: money, sum: true, cell: (x) => money(x.taxPayable) },
            { k: "tds", label: "TDS", cls: "n", v: (x) => x.tdsTotal, fmt: money, sum: true, cell: (x) => money(x.tdsTotal) },
            { k: "bal", label: "Short (+) / excess (−)", cls: "n", v: (x) => x.balance, fmt: money, sum: true, cell: (x) => money(x.balance) },
          ]} /></section>}</>
      : <ValidatePanel fy={fy} q={q} form="24Q" val={val} reviews={reviews} file={fileBox} chIds={Object.keys(TDSReg.uses()).filter((id) => TDSReg.uses()[id][key])} />}
    </ReturnShell>
  </>;
}
