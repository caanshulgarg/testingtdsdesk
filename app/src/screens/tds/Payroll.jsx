// Bridge 2.4.4 (the owner's decisions of 12-Oct-2026): salary under the client's TDS, from Tally's payroll (Payroll, src/js/73).
//   Salary (a TDS tab, S.tdsView "salary", S.paySub):
//     Employees      Tally's employees (name, PAN, group, designation, joined, left) and, opened under each, what Tally does
//                    not keep and Form 16 needs: the tax regime, the declarations, rent and the landlord's PAN, housing-loan
//                    interest and the lender's PAN, the previous employer's salary and TDS, the address, and (old regime only)
//                    whether the employee is a senior citizen. Kept with the books as items (payDetails).
//     Pay register   a month: each employee's amount per pay head as Tally keeps it, gross, deductions, net, TDS.
//     Form 16        Part B for one employee: the year's salary, exemptions, deductions and tax (PayTax, FinCom's rule).
//   Return24Tally: the 24Q (Form 138) return of a quarter from Tally's payroll: Annexure I (per employee per month, with the
//     challan), Annexure II in the fourth quarter, Errors to fix, Files (the text file, built to the current layout and
//     marked "check before filing").
// Nothing here is worked out by AI; every figure is Tally's or FinCom's own rule, to the paisa.
import { useState } from "react";
import ListTable from "../../parts/ListTable.jsx";
import { MarkFiled } from "./Filed.jsx";

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
    <div className="dtiles" style={{ marginBottom: 12 }} data-salary-tiles="">
      <Tile label="Employees" value={emp.filter((e) => !e.gone).length} sub={Payroll.groups().length + " group" + (Payroll.groups().length === 1 ? "" : "s")} />
      <Tile label={"Months paid in " + fy} value={months.length} sub={months.length ? monthWord(months[0]) + " to " + monthWord(months[months.length - 1]) : "none yet"} />
      <Tile label="Regime not chosen" value={emp.filter((e) => !Payroll.detail(e).regime).length} sub="new regime taken until chosen" warn={emp.some((e) => !Payroll.detail(e).regime)} />
    </div>
    <nav className="sbar rp-tabs" aria-label="Salary">{SUBS.map(([k, l]) => <button key={k} data-pay-sub={k} aria-selected={S.paySub === k} onClick={() => { S.paySub = k; render(); }}>{l}</button>)}</nav>
    {S.paySub === "register" ? <Register fy={fy} months={months} /> : S.paySub === "form16" ? <Form16 fy={fy} /> : <Employees fy={fy} />}
  </>;
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
        <Field e={e} k="hlInterest" label="Housing-loan interest" kind="money" /><Field e={e} k="lenderPan" label="Lender's PAN" width={120} /></>}
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
export function Return24Tally({ fy, q, ReturnCard, Tabs, Upload, Suggest }) {
  const a1 = Payroll.annexI(fy, q), checks = Payroll.checks(fy, q), filed = TDSFiled.get(fy, q, "24Q");
  const tabs = [["employees", "Annexure I"], ["challans", "Challans"]].concat(q === "Q4" ? [["annex2", "Annexure II, the year"]] : []).concat([["checks", "Errors to fix"], ["file", "Files"]]);
  if (!tabs.some((t) => t[0] === S.tdsTab)) S.tdsTab = "employees";
  const ch = TDS.challans().filter((c) => TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q && /^192/.test(String(c.section || "")));
  const tds = r2(a1.reduce((a, r) => a + r.tds, 0)), paid = r2(a1.reduce((a, r) => a + r.paid, 0));
  return <>
    <ReturnCard fy={fy} q={q} form="24Q" filed={filed} errN={checks.length} driftN={0} draft={TDS.isNew(fy)}
      primary={filed || S.tdsTab === "file" ? null : ["The text file", () => tdsTabGo("file")]}
      figs={[
        { label: "Employees this quarter", value: new Set(a1.map((r) => r.employee)).size, sub: money(paid) + " paid or credited" },
        { label: "TDS deducted", value: money(tds), sub: q + " " + fy + " · from Tally's payroll" },
        { label: "Before filing", value: checks.length, sub: checks.length ? checks[0].what : "nothing to fix", warn: checks.length > 0 },
      ]} />
    <Tabs tabs={tabs.map(([id, l]) => [id, l, id === "employees" ? a1.length : id === "challans" ? ch.length : id === "checks" ? (checks.length || null) : null])} />
    {S.tdsTab === "employees" ? <ListTable name="q24Annex1" id="q24A1Table" rows={a1} rowKey={(r) => r.id} unit={["payment", "payments"]} data-annex1=""
        empty="No salary paid or credited in this quarter."
        cols={[
          { k: "emp", role: "party", label: "Employee", v: (r) => r.employee, cell: (r) => r.employee },
          { k: "pan", label: "PAN", v: (r) => r.pan, cell: (r) => <Pan pan={r.pan} /> },
          { k: "date", role: "date", label: "Paid or credited", cls: "dt", v: (r) => TDS.ymd(r.date), cell: (r) => day(r.date) },
          { k: "paid", role: "amount", label: "Amount", cls: "n", v: (r) => r.paid, fmt: money, sum: true, cell: (r) => money(r.paid) },
          { k: "tds", role: "amount", label: "TDS", cls: "n", v: (r) => r.tds, fmt: money, sum: true, cell: (r) => money(r.tds) },
          { k: "ded", role: "date", label: "Deducted on", v: (r) => TDS.ymd(r.deducted), cell: (r) => day(r.deducted) || "—" },
          { k: "ch", label: "Challan", v: (r) => r.challanNo, cell: (r) => (r.challan ? <span data-challan-of={r.id}>{r.challanBsr} / {r.challanNo} · {day(r.challanDate)}</span> : r.tds > 0 ? <span className="tag warn">not tagged</span> : "—") },
        ]} />
      : S.tdsTab === "challans" ? <><p className="note">Salary TDS challans of {q} (section 192): those made from Tally's Stat Payment of Income Tax are marked From Tally; each month's TDS is tagged to the challan of its period.</p>
        {Upload && <Upload />}{Suggest && <Suggest fy={fy} q={q} form="24Q" />}
        <ListTable name="q24TChallans" rows={ch} rowKey={(c) => c.id} unit={["challan", "challans"]} empty="No salary TDS challan deposited in this quarter."
          cols={[
            { k: "date", role: "date", label: "Deposited", cls: "dt", v: (c) => TDS.ymd(c.date), cell: (c) => day(c.date) },
            { k: "bsr", role: "number", label: "BSR code", v: (c) => String(c.bsr || ""), cell: (c) => c.bsr },
            { k: "serial", role: "number", label: "Serial", v: (c) => String(c.serial || ""), cell: (c) => c.serial },
            { k: "tax", role: "amount", label: "Tax", cls: "n", v: (c) => num(c.tax), fmt: money, cell: (c) => money(c.tax) },
            { k: "used", label: "Tagged", cls: "n", v: (c) => TDS.challanUse()[c.id] || 0, fmt: money, cell: (c) => money(TDS.challanUse()[c.id] || 0) },
            { k: "from", label: "", cell: (c) => (c.from === "tally" ? <span className="tag">From Tally</span> : null) },
          ]} /></>
      : S.tdsTab === "annex2" ? <ListTable name="q24Annex2" id="q24A2Table" rows={Payroll.annexII(fy)} rowKey={(x) => x.guid} unit={["employee", "employees"]}
          cols={[
            { k: "name", role: "party", label: "Employee", v: (x) => x.name, cell: (x) => <button className="linkbtn" onClick={() => { tdsNav("salary"); S.paySub = "form16"; S.payF16 = x.guid; render(); }}>{x.name}</button> },
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
          ]} />
      : S.tdsTab === "checks" ? (checks.length ? <section className="dash-card" data-pay-checks=""><h3>Before filing</h3>{checks.map((c, i) => <span key={i} style={{ display: "contents" }}>
          <div className="dash-row"><span>{c.what}</span><b>{c.n}</b></div><p className="note">{c.how}{c.who.length ? " e.g. " + c.who.join(", ") : ""}</p></span>)}</section>
        : <p className="note">Nothing to fix for this quarter.</p>)
      : <><section className="dash-card" data-file="24Q-tally"><h3>{TDS.formName("24Q", fy)}{TDS.isNew(fy) ? " (earlier 24Q)" : ""}, {q} {fy}</h3>
          <p className="note"><b>Check before filing.</b> The text file is built to the current 24Q layout (Annexure I{q === "Q4" ? " and II" : ""}); the new form's own layout could not be checked where FinCom was built, so the file is named _DRAFT. Run it through Protean's FVU first.</p>
          <div className="revfilter"><button className="btn small primary" data-pay-fvu="" onClick={() => payFvuDownload(fy, q)}>Download the text file</button>
            <button className="btn small" onClick={() => printTable("q24A1Table", "24Q Annexure I, " + q + " " + fy)}>Print Annexure I</button></div></section>
        <MarkFiled fy={fy} q={q} form="24Q" /></>}
  </>;
}
