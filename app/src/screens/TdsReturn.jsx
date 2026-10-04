// A quarter's TDS return: 26Q (other than salary) with its challans, deductees, deductions and checks; 24Q (salary)
// with its employees, challans, Annexure II and checks; and the section 197 certificates with the rate questions.
// Was viewTdsReturn26, viewTdsReturn24, viewTdsCerts, tdsFilterBar, tdsTabs and tdsSortHead (src/js/18).
//
// The figures come from the business logic: TDS.rows() (deductions read from the books), TDS.challans(),
// TDS.challanUse(), Certs.issues(), TDS.interest(), TDS.lateFee(), TDS24Q.annexI()/annexII()/checks().
// Filters are kept per tab in S.tdsFl, sorting in S.tdsSort; the row opened under a table in S.chOpen, S.tdsOpen,
// S.q24Open. Changes go through tdsFilter, tdsSortBy, tdsToggle, tdsAlloc, challanAdd, … (src/js/27).
import { useState } from "react";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => fmtDate(tallyDate(d));
const NoPan = () => <span className="tag warn">no PAN</span>;
const Pan = ({ pan }) => (Certs.validPan(pan) ? pan : <NoPan />);
const Empty = ({ children }) => <div className="bk-none">{children}</div>;

// the bar above a return's table: find, choices, how many shown, print, Excel
function FilterBar({ tab, placeholder, table, title, excel, count, selects = [] }) {
  const f = (S.tdsFl || {})[tab] || {};
  return (
    <div className="revfilter" style={{ flexWrap: "wrap", rowGap: 6 }}>
      <input type="search" value={f.q || ""} placeholder={placeholder} aria-label={placeholder} style={{ width: 260, flex: "0 0 auto" }} data-fk={"tdsf-" + tab}
        onChange={(ev) => tdsFilter(tab, "q", ev.target.value, true)} />
      {selects.map((sel) => (
        <select key={sel.key} style={{ width: "auto", flex: "0 0 auto" }} aria-label={sel.label || sel.key} value={f[sel.key] || ""} onChange={(ev) => tdsFilter(tab, sel.key, ev.target.value)}>
          {sel.options.map(([v, l], i) => <option key={i} value={v}>{l}</option>)}
        </select>))}
      <span className="note">{count || ""}</span>
      {Object.keys(f).some((k) => f[k]) && <button className="linkbtn" onClick={() => tdsFilterClear(tab)}>Clear filters</button>}
      <button className="btn small" onClick={() => printTable(table, title)}>Print or save as PDF</button>
      {excel && <button className="btn small" onClick={() => doAct(excel)}>Excel</button>}
    </div>
  );
}

function Tabs({ tabs }) {
  return (
    <nav className="sbar" aria-label="Return" style={{ marginTop: 4 }}>
      {tabs.map(([id, l, n]) => <button key={id} aria-selected={S.tdsTab === id} onClick={() => tdsTabGo(id)}>{l}{n != null && <> <span className="sbar-n">{n}</span></>}</button>)}
    </nav>
  );
}

// a column heading that sorts the table; a second click turns the order round
function SortHead({ tab, k, label, cls }) {
  const s = (S.tdsSort || {})[tab] || {}, on = s.k === k;
  return <th className={cls}><button className="linkbtn" style={{ font: "inherit", color: "inherit", textTransform: "inherit", letterSpacing: "inherit" }} onClick={() => tdsSortBy(tab, k)}>
    {label}{on ? (s.d < 0 ? " ↓" : " ↑") : ""}</button></th>;
}
const Tile = ({ label, value, sub, warn }) => <div className={"dtile" + (warn ? " warn" : "")}><span>{label}</span><b>{value}</b><small>{sub}</small></div>;
const Toggle = ({ which, k, children }) => <button className="linkbtn" onClick={() => tdsToggle(which, k)}>{S[which] === k ? "▾ " : "▸ "}{children}</button>;

/* ---------------------------------------------------------------- 26Q */

// a TDS payment in Tally not yet a challan: give its BSR code and serial
function PayRow({ p }) {
  const [bsr, setBsr] = useState(""), [ser, setSer] = useState("");
  return <tr>
    <td>{day(p.date)}</td><td className="n">{money(p.tax)}</td><td>{p.sections.join(", ")}</td><td>{p.voucher}</td>
    <td><input type="text" value={bsr} placeholder="0240020" aria-label="BSR code" style={{ width: 100 }} onChange={(ev) => setBsr(ev.target.value)} /></td>
    <td><input type="text" value={ser} placeholder="00979" aria-label="Challan serial" style={{ width: 90 }} onChange={(ev) => setSer(ev.target.value)} /></td>
    <td className="ac"><button className="btn small" onClick={() => challanFromBooks(p.vid, bsr, ser)}>Make it a challan</button></td>
  </tr>;
}

// the last row of the challans table: a challan typed in
function NewChallan() {
  const blank = { bsr: "", serial: "", date: "", tax: "", interest: "" }, [c, setC] = useState(blank);
  const box = (k, props) => <input value={c[k]} onChange={(ev) => setC({ ...c, [k]: ev.target.value })} {...props} />;
  return <tr>
    <td></td><td>{box("bsr", { type: "text", placeholder: "0240020", "aria-label": "New challan: BSR code", style: { width: 100 } })}</td>
    <td>{box("serial", { type: "text", placeholder: "00979", "aria-label": "New challan: serial", style: { width: 90 } })}</td>
    <td>{box("date", { type: "date", "aria-label": "New challan: date" })}</td><td></td>
    <td className="n">{box("tax", { type: "text", inputMode: "decimal", placeholder: "tax", "aria-label": "New challan: tax", style: { width: 110, textAlign: "right" } })}</td>
    <td className="n">{box("interest", { type: "text", inputMode: "decimal", placeholder: "interest", "aria-label": "New challan: interest", style: { width: 100, textAlign: "right" } })}</td>
    <td colSpan={3}></td>
    <td className="ac"><button className="btn small" onClick={() => { if (challanAdd(c)) setC(blank); }}>Add</button></td>
  </tr>;
}

function Challans({ fy, q, ch, allRows, allCh, use, title }) {
  const f = (S.tdsFl || {}).challans || {}, qq = String(f.q || "").toLowerCase(), left = (c) => r2(num(c.tax) - (use[c.id] || 0));
  const shown = tdsSorted("challans", ch.filter((c) => {
    if (qq && ![c.bsr, c.serial, c.section || ""].join(" ").toLowerCase().includes(qq)) return false;
    if (f.state === "unused" && (use[c.id] || 0) > 0) return false;
    if (f.state === "part" && !((use[c.id] || 0) > 0 && left(c) > 0.5)) return false;
    if (f.state === "full" && Math.abs(left(c)) > 0.5) return false;
    if (f.state === "over" && left(c) >= -0.5) return false;
    if (f.month && TDS.ymd(c.date).slice(0, 6) !== f.month) return false;
    return true;
  }), (c, k) => k === "date" ? TDS.ymd(c.date) : k === "tax" ? num(c.tax) : k === "left" ? num(c.tax) - (use[c.id] || 0) : k === "used" ? (use[c.id] || 0) : String(c[k] || ""));
  const pays = TDS.paymentsFromBooks().filter((p) => TDS.fyOf(p.date) === fy && TDS.qOf(p.date) === q)
    .filter((p) => !allCh.some((c) => TDS.ymd(c.date) === TDS.ymd(p.date) && Math.abs(num(c.tax) - p.tax) < 1));
  const tot = (fn) => money(shown.reduce((a, c) => a + fn(c), 0));
  return <>
    {pays.length > 0 && <section className="dash-card" style={{ marginBottom: 12 }}><h3>Paid to the government, from the books</h3>
      <p className="note">TDS payment vouchers in Tally for this quarter. Add the BSR code and challan serial number and each becomes a challan.</p>
      <div className="bk-tablewrap"><table className="bk-table">
        <thead><tr><th>Date</th><th className="n">Tax</th><th>Sections</th><th>Voucher</th><th>BSR code</th><th>Serial</th><th className="ac"></th></tr></thead>
        <tbody>{pays.map((p) => <PayRow key={p.vid} p={p} />)}</tbody>
      </table></div></section>}
    <FilterBar tab="challans" placeholder="Find a BSR code or serial" table="tdsChTable" title={title + " challans"} excel="tdsExcel" count={shown.length + " of " + ch.length + " challans"}
      selects={[{ key: "month", label: "Month", options: [["", "Every month"]].concat(tdsMonths(fy, q).map((m) => [m, monthName(m)])) },
        { key: "state", label: "Use", options: [["", "Used: any"], ["unused", "Not used"], ["part", "Part used"], ["full", "Fully used"], ["over", "Used more than paid"]] }]} />
    <div className="bk-tablewrap"><table className="bk-table" id="tdsChTable">
      <thead><tr><th className="n">Sl.</th><SortHead tab="challans" k="bsr" label="BSR code" /><SortHead tab="challans" k="serial" label="Serial" /><SortHead tab="challans" k="date" label="Deposited" cls="dt" />
        <th>Sections</th><SortHead tab="challans" k="tax" label="Tax" cls="n" /><th className="n">Interest</th><SortHead tab="challans" k="used" label="Used" cls="n" /><SortHead tab="challans" k="left" label="Left" cls="n" />
        <th className="n">Deductions</th><th className="ac"></th></tr></thead>
      <tbody>
        {shown.map((c, i) => {
          const mine = allRows.filter((r) => r.challan === c.id), l = left(c), open = S.chOpen === c.id;
          const secs = Array.from(new Set(mine.map((r) => r.section))).join(", ") || c.section || "—";
          return [<tr key={c.id}>
            <td className="n">{i + 1}</td><td><Toggle which="chOpen" k={c.id}>{c.bsr}</Toggle></td><td>{c.serial}</td><td>{day(c.date)}</td><td>{secs}</td>
            <td className="n">{money(c.tax)}</td><td className="n">{money(c.interest)}</td><td className="n">{money(use[c.id] || 0)}</td>
            <td className={"n" + (l < -0.5 ? " bad" : "")}>{money(l)}</td>
            <td className="n"><button className="linkbtn" onClick={() => tdsToggle("chOpen", c.id)}>{mine.length}</button></td>
            <td className="ac"><button className="icon danger" title="Remove this challan" aria-label="Remove this challan" onClick={() => challanDelete(c.id)}>✕</button></td>
          </tr>, open && <tr key={c.id + ":open"}><td colSpan={11} style={{ background: "var(--paper)", padding: 0 }}>
            {mine.length ? <table className="bk-table" style={{ margin: 0 }}>
              <thead><tr><th className="dt">Date</th><th>Deductee</th><th>PAN</th><th>Section</th><th className="n">Paid or credited</th><th className="n">TDS</th></tr></thead>
              <tbody>{mine.map((r) => <tr key={r.id}><td>{day(r.date)}</td><td>{r.party}</td><td><Pan pan={r.pan} /></td><td>{r.section}</td><td className="n">{money(r.paid)}</td><td className="n">{money(r.tds)}</td></tr>)}</tbody>
            </table> : <p className="note" style={{ margin: 8 }}>No deduction is against this challan yet.</p>}
          </td></tr>];
        })}
        <tr><td></td><td colSpan={4}><b>Total</b></td><td className="n"><b>{tot((c) => num(c.tax))}</b></td><td className="n">{tot((c) => num(c.interest))}</td>
          <td className="n">{tot((c) => use[c.id] || 0)}</td><td className="n">{tot((c) => num(c.tax) - (use[c.id] || 0))}</td><td></td><td></td></tr>
        <NewChallan />
      </tbody>
    </table>{!shown.length && ch.length > 0 && <Empty>No challan matches these filters.</Empty>}</div>
  </>;
}

// the challan a deduction is paid by (or not yet)
function ChallanPick({ r, chOpts }) {
  return <select value={r.challan || ""} aria-label={"Challan for " + r.party} onChange={(ev) => tdsAlloc(r.id, ev.target.value)}>
    <option value="">— not yet —</option>{chOpts.map((x) => <option key={x.id} value={x.id}>{x.bsr + "/" + x.serial + " · " + day(x.date)}</option>)}
  </select>;
}
const Rate = ({ r, issue, why }) => <>{r.rate != null ? r.rate + "%" : ""}{issue && <div className="nr bad" title={why ? issue.why : undefined}>should be {issue.expected}%</div>}</>;

function Deductees({ rows, deductees, issueOf, pass, common, chOpts, title }) {
  const f = (S.tdsFl || {}).deductees || {}, by = {};
  rows.filter((r) => pass(r, f)).forEach((r) => {
    const k = Certs.validPan(r.pan) ? r.pan : "name:" + normName(r.party);
    const p = by[k] = by[k] || { key: k, party: r.party, pan: r.pan, secs: new Set(), n: 0, paid: 0, tds: 0, unallocated: 0, issues: 0, rows: [] };
    p.secs.add(r.section); p.n++; p.paid = r2(p.paid + r.paid); p.tds = r2(p.tds + r.tds);
    if (!r.challan) p.unallocated = r2(p.unallocated + r.tds);
    if (issueOf[r.id]) p.issues++;
    p.rows.push(r);
  });
  const list = tdsSorted("deductees", Object.values(by).sort((a, c) => c.tds - a.tds), (p, k) => k === "secs" ? Array.from(p.secs).join(",") : p[k]);
  const sum = (k) => list.reduce((a, p) => a + p[k], 0);
  return <>
    <FilterBar tab="deductees" placeholder="Find a deductee, PAN or voucher" table="tdsDeTable" title={title + " deductees"} excel="tdsExcel" count={list.length + " of " + deductees + " deductees"}
      selects={common.concat([{ key: "rate", label: "Rate", options: [["", "Rate: any"], ["q", "Rate questions"], ["ok", "Rate as expected"]] }])} />
    <div className="bk-tablewrap"><table className="bk-table" id="tdsDeTable">
      <thead><tr><SortHead tab="deductees" k="party" label="Deductee" /><SortHead tab="deductees" k="pan" label="PAN" /><th>Code</th><SortHead tab="deductees" k="secs" label="Sections" />
        <SortHead tab="deductees" k="n" label="Deductions" cls="n" /><SortHead tab="deductees" k="paid" label="Paid or credited" cls="n" /><SortHead tab="deductees" k="tds" label="TDS" cls="n" /><SortHead tab="deductees" k="unallocated" label="Not against a challan" cls="n" /></tr></thead>
      <tbody>
        {list.map((p) => [<tr key={p.key}>
          <td><Toggle which="tdsOpen" k={p.key}>{p.party}</Toggle>{p.issues > 0 && <> <span className="tag warn">{p.issues} rate</span></>}</td>
          <td><Pan pan={p.pan} /></td><td>{Certs.validPan(p.pan) ? (/^[A-Z]{3}C/.test(p.pan) ? "01 company" : "02 other") : "—"}</td><td>{Array.from(p.secs).join(", ")}</td>
          <td className="n"><button className="linkbtn" onClick={() => tdsToggle("tdsOpen", p.key)}>{p.n}</button></td><td className="n">{money(p.paid)}</td><td className="n"><b>{money(p.tds)}</b></td>
          <td className={"n" + (p.unallocated ? " bad" : "")}>{p.unallocated ? money(p.unallocated) : "—"}</td>
        </tr>, S.tdsOpen === p.key && <tr key={p.key + ":open"}><td colSpan={8} style={{ background: "var(--paper)", padding: 0 }}><table className="bk-table" style={{ margin: 0 }}>
          <thead><tr><th className="dt">Date</th><th>Voucher</th><th>Section</th><th className="n">Paid or credited</th><th className="n">Rate</th><th className="n">TDS</th><th>Challan</th></tr></thead>
          <tbody>{p.rows.map((r) => <tr key={r.id}><td>{day(r.date)}</td><td>{r.voucher || ""}</td><td>{r.section}</td><td className="n">{money(r.paid)}</td>
            <td className="n"><Rate r={r} issue={issueOf[r.id]} /></td><td className="n">{money(r.tds)}</td><td><ChallanPick r={r} chOpts={chOpts} /></td></tr>)}</tbody>
        </table></td></tr>])}
        <tr><td colSpan={4}><b>Total</b></td><td className="n">{sum("n")}</td><td className="n">{money(sum("paid"))}</td><td className="n"><b>{money(sum("tds"))}</b></td><td className="n">{money(sum("unallocated"))}</td></tr>
      </tbody>
    </table>{!list.length && <Empty>No deductee matches these filters.</Empty>}</div>
  </>;
}

function Deductions({ fy, q, rows, issueOf, pass, common, chOpts, title }) {
  const f = (S.tdsFl || {}).deductions || {};
  const shown = tdsSorted("deductions", rows.filter((r) => pass(r, f)), (r, k) => k === "date" ? TDS.ymd(r.date) : k === "challan" ? (r.challan ? 1 : 0) : r[k] == null ? "" : r[k]);
  const LIMIT = 500, page = shown.slice(0, LIMIT), sum = (k) => money(shown.reduce((a, r) => a + r[k], 0));
  return <>
    <FilterBar tab="deductions" placeholder="Find a deductee, PAN, voucher or ledger" table="tdsDnTable" title={title + " deductions"} excel="tdsExcel"
      count={shown.length + " of " + rows.length + " deductions · TDS " + sum("tds")}
      selects={[{ key: "month", label: "Month", options: [["", "Every month"]].concat(tdsMonths(fy, q).map((m) => [m, monthName(m)])) }].concat(common)
        .concat([{ key: "rate", label: "Rate", options: [["", "Rate: any"], ["q", "Rate questions"], ["ok", "Rate as expected"]] }])} />
    <div className="bk-tablewrap"><table className="bk-table" id="tdsDnTable">
      <thead><tr><th className="n">Sl.</th><SortHead tab="deductions" k="date" label="Date" cls="dt" /><SortHead tab="deductions" k="voucher" label="Voucher" /><SortHead tab="deductions" k="party" label="Deductee" />
        <SortHead tab="deductions" k="pan" label="PAN" /><SortHead tab="deductions" k="section" label="Section" /><SortHead tab="deductions" k="paid" label="Paid or credited" cls="n" />
        <SortHead tab="deductions" k="rate" label="Rate" cls="n" /><SortHead tab="deductions" k="tds" label="TDS" cls="n" /><SortHead tab="deductions" k="challan" label="Challan" /></tr></thead>
      <tbody>
        {page.map((r, i) => <tr key={r.id}><td className="n">{i + 1}</td><td>{day(r.date)}</td><td>{r.voucher || ""}</td><td>{r.party}</td><td><Pan pan={r.pan} /></td><td>{r.section}</td>
          <td className="n">{money(r.paid)}</td><td className="n"><Rate r={r} issue={issueOf[r.id]} why /></td><td className="n">{money(r.tds)}</td><td><ChallanPick r={r} chOpts={chOpts} /></td></tr>)}
        <tr><td></td><td colSpan={5}><b>Total</b></td><td className="n">{sum("paid")}</td><td></td><td className="n"><b>{sum("tds")}</b></td><td></td></tr>
      </tbody>
    </table>
    {shown.length > LIMIT && <p className="note">The first {LIMIT} are shown. Narrow them with the filters, or download the Excel for all {shown.length}.</p>}
    {!shown.length && <Empty>No deduction matches these filters.</Empty>}</div>
  </>;
}

// the rate questions table, shared by the return's checks and the certificates page
function RateQuestions({ list }) {
  return <div className="bk-tablewrap"><table className="bk-table">
    <thead><tr><th className="dt">Date</th><th>Deductee</th><th>PAN</th><th>Section</th><th className="n">Paid</th><th className="n">Rate used</th><th className="n">Rate that applies</th><th>Why</th><th className="n">Short or excess</th></tr></thead>
    <tbody>{list.map((x, i) => <tr key={i}><td>{day(x.row.date)}</td><td>{x.row.party}</td><td><Pan pan={x.row.pan} /></td><td>{x.row.section}</td><td className="n">{money(x.row.paid)}</td>
      <td className="n">{x.row.rate == null ? "" : x.row.rate + "%"}</td><td className="n">{x.expected}%</td><td>{x.why}</td><td className={"n" + (x.short > 0 ? " bad" : "")}>{money(x.short)}</td></tr>)}</tbody>
  </table></div>;
}

function Checks26({ fy, q, int1A, fee, issues }) {
  const total = r2(int1A.reduce((a, x) => a + x.amount, 0)), fr = S.fvuResult, sum = TDS.summary(fy, q);
  return <>
    {fr && <section className={"bk-alert " + (fr.ok ? "" : "bad")}><b>{fr.ok ? "The FVU accepted the " + fr.q + " file." : "The FVU found problems in the " + (fr.q || "") + " file."}</b>
      {fr.fvu && <p className="note">Upload file: {fr.fvu}</p>}
      {fr.errors && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 220, overflow: "auto", margin: "8px 0 0" }}>{String(fr.errors).slice(0, 4000)}</pre>}
      {!fr.errors && !fr.ok && fr.output && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 160, overflow: "auto" }}>{String(fr.output).slice(0, 2000)}</pre>}
      <div className="row" style={{ marginTop: 8 }}><button className="linkbtn" onClick={() => doAct("fvuClose")}>Hide this</button></div></section>}
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>Interest and late fee</h3>
      <div className="dash-row"><span>Interest under 201(1A), paid after the due date</span><b>{money(total)}</b></div>
      <div className="dash-row"><span>Late filing fee under 234E, if filed today</span><b>{money(fee && fee.days > 0 ? fee.fee : 0)}</b></div>
      {fee && fee.days > 0 && <p className="note">{fee.days} day{fee.days === 1 ? "" : "s"} past {day(fee.due)} at 200 a day, capped at the TDS of the quarter ({money(fee.cap)}).</p>}
      {int1A.length ? <div className="bk-tablewrap"><table className="bk-table">
        <thead><tr><th className="dt">Deducted</th><th>Deductee</th><th className="n">TDS</th><th>Due</th><th>Paid</th><th className="n">Months</th><th className="n">Interest</th></tr></thead>
        <tbody>{int1A.slice(0, 100).map((x, i) => <tr key={i}><td>{day(x.row.date)}</td><td>{x.row.party}</td><td className="n">{money(x.row.tds)}</td><td>{day(x.due)}</td><td>{day(x.challan.date)}</td>
          <td className="n">{x.months}</td><td className="n bad">{money(x.amount)}</td></tr>)}</tbody>
      </table></div> : <p className="note">No deduction was paid late.</p>}
    </section>
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>Rate questions</h3>{issues.length ? <RateQuestions list={issues} /> : <p className="note">Every deduction matches the rate that applies.</p>}</section>
    <section className="dash-card"><h3>By section</h3><div className="bk-tablewrap"><table className="bk-table">
      <thead><tr><th>Section</th><th className="n">Deductions</th><th className="n">Paid or credited</th><th className="n">TDS</th><th className="n">Not against a challan</th></tr></thead>
      <tbody>{sum.map((s) => <tr key={s.section}><td>{s.section}</td><td className="n">{s.count}</td><td className="n">{money(s.paid)}</td><td className="n">{money(s.tds)}</td><td className="n">{money(s.unallocated)}</td></tr>)}</tbody>
    </table></div></section>
  </>;
}

// 27Q and 27EQ: what is missing before the file can be made, the non-resident's details, and the FVU's answer
function NrInfo({ party }) {
  const i = TDS26Q.nrInfo(party);
  const f = (k, label, w = 140) => <label className="nr" style={{ display: "inline-flex", flexDirection: "column", marginRight: 8 }}>{label}
    <input type="text" defaultValue={i[k] || ""} aria-label={label + ": " + party} style={{ width: w }} onBlur={(ev) => tdsNrSet(party, k, ev.target.value)} /></label>;
  return <tr data-nr={party}><td>{party}</td><td colSpan={2}>
    {f("country", "Country code", 60)}{f("nature", "Nature code", 60)}{f("ack15ca", "15CA acknowledgement")}{f("tin", "Tax ID in the country")}
    {f("email", "Email", 180)}{f("phone", "Phone")}{f("address", "Address", 260)}
    <label className="nr"><input type="checkbox" defaultChecked={!!i.dtaa} onChange={(ev) => tdsNrSet(party, "dtaa", ev.target.checked)} /> Treaty (DTAA) rate</label>{" "}
    <label className="nr"><input type="checkbox" defaultChecked={!!i.trc} onChange={(ev) => tdsNrSet(party, "trc", ev.target.checked)} /> Tax residency certificate and Form 10F on file</label>
  </td></tr>;
}
function ChecksOther({ fy, q, form, other, rows }) {
  const fr = S.fvuResult, sum = TDS.summary(fy, q, form);
  const parties = Array.from(new Set(rows.map((r) => r.party)));
  return <>
    {fr && fr.form === form && <section className={"bk-alert " + (fr.ok ? "" : "bad")}><b>{fr.ok ? "The FVU accepted the " + form + " file." : "The FVU found problems in the " + form + " file."}</b>
      {fr.errors && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 220, overflow: "auto", margin: "8px 0 0" }}>{String(fr.errors).slice(0, 4000)}</pre>}
      <div className="row" style={{ marginTop: 8 }}><button className="linkbtn" onClick={() => doAct("fvuClose")}>Hide this</button></div></section>}
    <section className="dash-card" style={{ marginBottom: 12 }} data-checks={form}><h3>Before the file is made</h3>
      {other.length ? <ul>{other.map((x, i) => <li key={i}>{x.party ? <><b>{x.party}</b>: missing {x.missing.join(", ")}</> : x.why}</li>)}</ul>
        : <p className="note">Nothing is missing.</p>}
    </section>
    {form === "27Q" && <section className="dash-card" style={{ marginBottom: 12 }}><h3>Non-resident deductees</h3>
      <p className="note">The 27Q file needs these for each deductee. The country and nature codes are the ones in the return's own lists.</p>
      <div className="bk-tablewrap"><table className="bk-table"><thead><tr><th>Deductee</th><th colSpan={2}>Details</th></tr></thead>
        <tbody>{parties.map((p) => <NrInfo key={p} party={p} />)}</tbody></table></div></section>}
    {form === "27EQ" && <section className="dash-card" style={{ marginBottom: 12 }}><h3>Collection codes</h3>
      <p className="note">Each TCS ledger needs the 27EQ collection code of what was sold.</p>
      <div className="bk-tablewrap"><table className="bk-table"><thead><tr><th>TCS ledger</th><th>Collection code</th></tr></thead>
        <tbody>{Array.from(new Set(rows.map((r) => r.ledger))).map((l) => <tr key={l}><td>{l}</td><td>
          <select aria-label={"Collection code: " + l} value={TCS27EQ.codeOf(l)} onChange={(ev) => tdsTcsCode(l, ev.target.value)}>
            <option value="">Choose…</option>{TCS27EQ.CODES.map(([c, t]) => <option key={c} value={c}>{c} · {t}</option>)}</select></td></tr>)}</tbody></table></div></section>}
    <section className="dash-card"><h3>By section</h3><div className="bk-tablewrap"><table className="bk-table">
      <thead><tr><th>Section</th><th className="n">{form === "27EQ" ? "Collections" : "Deductions"}</th><th className="n">Paid or received</th><th className="n">{form === "27EQ" ? "TCS" : "TDS"}</th><th className="n">Not against a challan</th></tr></thead>
      <tbody>{sum.map((s) => <tr key={s.section}><td>{s.section}</td><td className="n">{s.count}</td><td className="n">{money(s.paid)}</td><td className="n">{money(s.tds)}</td><td className="n">{money(s.unallocated)}</td></tr>)}</tbody>
    </table></div></section>
  </>;
}

export function Return26({ b, allRows, form = "26Q" }) {
  const fy = S.tdsFy, q = S.tdsQ, rows = allRows.filter((r) => r.fy === fy && r.q === q);
  const ch = tdsQuarterChallans(fy, q, rows), use = TDS.challanUse(), allCh = TDS.challans();
  const issues = form === "26Q" ? Certs.issues(fy, q) : [], issueOf = {};
  issues.forEach((x) => { issueOf[x.row.id] = x; });
  const deductees = new Set(rows.map((r) => (r.pan && Certs.validPan(r.pan) ? r.pan : normName(r.party)))).size;
  if (!["challans", "deductees", "deductions", "checks"].includes(S.tdsTab)) S.tdsTab = "challans";
  const tds = r2(rows.reduce((a, r) => a + r.tds, 0)), un = rows.filter((r) => !r.challan), chTax = r2(ch.reduce((a, c) => a + num(c.tax), 0));
  const int1A = form === "26Q" ? TDS.interest(fy, q) : [], fee = form === "26Q" ? TDS.lateFee(fy, q, (b.filedOn || {})[fy + q]) : null, noPan = rows.filter((r) => !Certs.validPan(r.pan)).length;
  const fname = TDS.formName(form, fy), draft = TDS.isNew(fy) && !NEW_FORMS_VALIDATED;
  const title = CO().name + " " + fname + " " + q + " " + fy;
  const other = form === "27Q" ? TDS26Q.nrChecks(fy, q) : form === "27EQ" ? TCS27EQ.checks(fy, q) : [];
  const chOpts = ch.concat(allCh.filter((c) => !ch.includes(c) && TDS.fyOf(c.date) === fy));
  const secs = Array.from(new Set(rows.map((r) => r.section))).sort();
  const common = [{ key: "section", label: "Section", options: [["", "Every section"]].concat(secs.map((x) => [x, x])) },
    { key: "pan", label: "PAN", options: [["", "PAN: any"], ["no", "No valid PAN"], ["yes", "Has a PAN"]] },
    { key: "challan", label: "Challan", options: [["", "Challan: any"], ["no", "Not against a challan"], ["yes", "Against a challan"]] }];
  const pass = (r, f) => {
    const qq = String(f.q || "").toLowerCase();
    if (qq && ![r.party, r.pan, r.section, r.voucher, r.ledger].join(" ").toLowerCase().includes(qq)) return false;
    if (f.section && r.section !== f.section) return false;
    if (f.pan === "no" && Certs.validPan(r.pan)) return false;
    if (f.pan === "yes" && !Certs.validPan(r.pan)) return false;
    if (f.challan === "no" && r.challan) return false;
    if (f.challan === "yes" && !r.challan) return false;
    if (f.month && TDS.ymd(r.date).slice(0, 6) !== f.month) return false;
    if (f.rate === "q" && !issueOf[r.id]) return false;
    if (f.rate === "ok" && issueOf[r.id]) return false;
    return true;
  };
  const checksN = int1A.length || (fee && fee.days > 0) || issues.length || other.length ? int1A.length + issues.length + other.length + (fee && fee.days > 0 ? 1 : 0) : null;
  const common_ = { rows, issueOf, pass, common, chOpts, title };
  return <>
    <div className="revfilter">
      <button className="btn small" onClick={() => doAct("tdsAuto")}>Put them against challans</button>
      <button className="btn small" onClick={() => doAct("tdsExcel")}>Download the {fname} working</button>
      <button className="btn small" onClick={() => doAct("tdsTxt")}>Download the {fname} text file{draft ? " (draft)" : ""}</button>
      <button className="btn small primary" disabled={!Bridge.on() || draft} title={draft ? "A draft is not sent to the FVU" : Bridge.on() ? undefined : "Needs FinCom Bridge"} onClick={() => doAct("tdsFvu")}>Check it with the FVU</button>
    </div>
    {draft && <section className="bk-alert" data-draft={TDS.formNo(form, fy)}><b>{fname} (was {form}): draft – not yet validated.</b> From 1 April 2026 the return is {fname} under the Income-tax Act, 2025, with new payment codes and file layout. FinCom’s file is not yet matched to Protean’s file format or run through their FVU: do not file it.</section>}
    <div className="dash-tiles">
      <Tile label={form === "27EQ" ? "TCS collected" : "TDS deducted"} value={money(tds)} sub={rows.length + (form === "27EQ" ? " collections, " + deductees + " buyers" : " deductions, " + deductees + " deductees")} />
      <Tile label="Challans" value={money(chTax)} sub={ch.length + " challan" + (ch.length === 1 ? "" : "s")} />
      <Tile label="Not against a challan" value={money(un.reduce((a, r) => a + r.tds, 0))} sub={un.length + " deductions"} warn={un.length > 0} />
      <Tile label="To look at" value={issues.length + noPan + other.length} sub={noPan + " without PAN, " + (form === "26Q" ? issues.length + " rate questions" : other.length + " details missing")} warn={issues.length > 0 || noPan > 0 || other.length > 0} />
    </div>
    <Tabs tabs={[["challans", "Challans", ch.length], ["deductees", "Deductees", deductees], ["deductions", "Deductions", rows.length], ["checks", "Interest, late fee and checks", checksN]]} />
    {S.tdsTab === "challans" ? <Challans fy={fy} q={q} ch={ch} allRows={allRows} allCh={allCh} use={use} title={title} />
      : S.tdsTab === "deductees" ? <Deductees deductees={deductees} {...common_} />
      : S.tdsTab === "deductions" ? <Deductions fy={fy} q={q} {...common_} />
      : form === "26Q" ? <Checks26 fy={fy} q={q} int1A={int1A} fee={fee} issues={issues} /> : <ChecksOther fy={fy} q={q} form={form} other={other} rows={rows} />}
  </>;
}

/* ---------------------------------------------------------------- 24Q */

function Employees({ fy, q, a1 }) {
  const f = (S.tdsFl || {}).employees || {}, qq = String(f.q || "").toLowerCase();
  const shown = tdsSorted("employees", a1.filter((e) => (!qq || (e.name + " " + e.pan).toLowerCase().includes(qq)) &&
    (f.pan !== "no" || !Certs.validPan(e.pan)) && (f.pan !== "yes" || Certs.validPan(e.pan)) && (f.tds !== "yes" || e.tds > 0) && (f.tds !== "no" || !e.tds)), (e, k) => e[k]);
  const sum = (k) => shown.reduce((a, e) => a + e[k], 0);
  return <>
    <FilterBar tab="employees" placeholder="Find an employee or PAN" table="q24Table" title={CO().name + " 24Q " + q + " " + fy} excel="q24Excel" count={shown.length + " of " + a1.length + " employees"}
      selects={[{ key: "pan", label: "PAN", options: [["", "PAN: any"], ["no", "No valid PAN"], ["yes", "Has a PAN"]] }, { key: "tds", label: "TDS", options: [["", "TDS: any"], ["yes", "TDS deducted"], ["no", "No TDS"]] }]} />
    <div className="bk-tablewrap"><table className="bk-table" id="q24Table">
      <thead><tr><SortHead tab="employees" k="name" label="Employee" /><SortHead tab="employees" k="pan" label="PAN" /><SortHead tab="employees" k="months" label="Months" cls="n" />
        <SortHead tab="employees" k="paid" label="Paid" cls="n" /><SortHead tab="employees" k="tds" label="TDS" cls="n" /></tr></thead>
      <tbody>
        {shown.map((e) => { const key = e.pan || e.name; return [<tr key={key}>
          <td><Toggle which="q24Open" k={key}>{e.name}</Toggle></td><td><Pan pan={e.pan} /></td><td className="n">{e.months}</td><td className="n">{money(e.paid)}</td><td className="n"><b>{money(e.tds)}</b></td>
        </tr>, S.q24Open === key && <tr key={key + ":open"}><td colSpan={5} style={{ background: "var(--paper)", padding: 0 }}><table className="bk-table" style={{ margin: 0 }}>
          <thead><tr><th className="dt">Month</th><th className="n">Gross</th><th className="n">Exempt</th><th className="n">Chapter VI-A</th><th className="n">TDS</th></tr></thead>
          <tbody>{e.rows.map((r, i) => <tr key={i}><td>{fmtDate(r.date)}</td><td className="n">{money(r.gross)}</td><td className="n">{money(r.exempt)}</td><td className="n">{money(r.chapter6)}</td><td className="n">{money(r.tds)}</td></tr>)}</tbody>
        </table></td></tr>]; })}
        <tr><td><b>Total</b></td><td></td><td className="n">{sum("months")}</td><td className="n">{money(sum("paid"))}</td><td className="n"><b>{money(sum("tds"))}</b></td></tr>
      </tbody>
    </table>{!shown.length && <Empty>No employee matches these filters.</Empty>}</div>
  </>;
}

export function Return24({ b }) {
  const fy = S.tdsFy, q = S.tdsQ, has = (b.salary || []).length > 0;
  const tabs = [["employees", "Employees"], ["challans", "Challans"]].concat(q === "Q4" ? [["annex2", "Annexure II, the year"]] : []).concat([["checks", "Checks"]]);
  if (!tabs.some((t) => t[0] === S.tdsTab)) S.tdsTab = "employees";
  const top = <div className="revfilter">
    <button className="btn small primary" onClick={() => doAct("salaryPick")}>Bring in the salary sheet</button>
    {has && <><button className="btn small" onClick={() => doAct("q24Excel")}>Download the 24Q working</button><button className="btn small" onClick={() => doAct("salaryClear")}>Remove the sheet</button></>}
  </div>;
  if (!has) {
    const inB = TDS.salaryRows().filter((r) => r.fy === fy && r.q === q);
    return <>{top}
      {inB.length > 0 && <section className="dash-card" style={{ maxWidth: 760, marginBottom: 12 }}><h3>Salary TDS in the books</h3>
        <div className="bk-tablewrap"><table className="bk-table"><thead><tr><th className="dt">Date</th><th>Employee</th><th>PAN</th><th className="n">Paid</th><th className="n">TDS</th></tr></thead>
          <tbody>{inB.map((r, i) => <tr key={i}><td>{day(r.date)}</td><td>{r.party}</td><td>{r.pan || "—"}</td><td className="n">{money(r.paid)}</td><td className="n">{money(r.tds)}</td></tr>)}</tbody></table></div>
        <p className="note">These are kept out of 26Q. For Annexure I and II, bring in the salary sheet.</p></section>}
      <section className="dash-card" style={{ maxWidth: 760 }}><h3>24Q needs the salary sheet</h3>
        <p className="note">Tally credits each employee their net pay and the TDS as one figure, so the books cannot say how much was deducted from whom. Bring in the payroll sheet you already prepare — Excel or CSV — and the columns are found by their names: employee, PAN, month, gross salary, exempt allowances, standard deduction, professional tax, Chapter VI-A, taxable income and TDS.</p></section>
    </>;
  }
  const a1 = TDS24Q.annexI(fy, q), checks = TDS24Q.checks(fy, q), ch = TDS.challans().filter((c) => TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q);
  const inBooks = TDS.salaryRows().filter((r) => r.fy === fy && r.q === q), booksTds = r2(inBooks.reduce((a, r) => a + r.tds, 0)), sheetTds = r2(a1.reduce((s, e) => s + e.tds, 0));
  if (inBooks.length && Math.abs(booksTds - sheetTds) >= 1) checks.push({ what: "Salary TDS in the books differs from the salary sheet", n: inBooks.length,
    how: "Tally has " + money(booksTds) + " under section 192 this quarter; the sheet has " + money(sheetTds) + ".", who: Array.from(new Set(inBooks.map((r) => r.party))).slice(0, 3) });
  const use = S.tdsTab === "challans" ? TDS.challanUse() : null;
  return <>{top}
    <div className="dash-tiles" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))" }}>
      <Tile label="Employees this quarter" value={a1.length} sub={money(a1.reduce((s, e) => s + e.paid, 0)) + " paid"} />
      <Tile label="TDS deducted" value={money(sheetTds)} sub={q + " " + fy} />
      <Tile label="Before filing" value={checks.length} sub={checks.length ? checks[0].what : "nothing to fix"} warn={checks.length > 0} />
    </div>
    <Tabs tabs={tabs.map(([id, l]) => [id, l, id === "employees" ? a1.length : id === "challans" ? ch.length : id === "checks" ? (checks.length || null) : null])} />
    {S.tdsTab === "employees" ? <Employees fy={fy} q={q} a1={a1} />
      : S.tdsTab === "challans" ? <>
        <p className="note">Challans deposited in {q}. Salary TDS is paid under section 192; add a challan under 26Q’s Challans tab if it is not here.</p>
        <div className="bk-tablewrap"><table className="bk-table" id="q24ChTable">
          <thead><tr><th>BSR code</th><th>Serial</th><th className="dt">Deposited</th><th>Section</th><th className="n">Tax</th><th className="n">Interest</th><th className="n">Used in 26Q</th></tr></thead>
          <tbody>{ch.map((c) => <tr key={c.id}><td>{c.bsr}</td><td>{c.serial}</td><td>{day(c.date)}</td><td>{c.section || "—"}</td><td className="n">{money(c.tax)}</td><td className="n">{money(c.interest)}</td><td className="n">{money(use[c.id] || 0)}</td></tr>)}</tbody>
        </table>{!ch.length && <Empty>No challan deposited in this quarter.</Empty>}</div></>
      : S.tdsTab === "annex2" ? <div className="bk-tablewrap"><table className="bk-table">
          <thead><tr><th>Employee</th><th>PAN</th><th>Regime</th><th className="n">Gross</th><th className="n">Exempt</th><th className="n">Standard</th><th className="n">Chapter VI-A</th><th className="n">Taxable</th><th className="n">TDS</th></tr></thead>
          <tbody>{TDS24Q.annexII(fy).map((e) => <tr key={e.pan || e.name}><td>{e.name}</td><td>{e.pan || "—"}</td><td>{e.regime === "N" ? "New" : e.regime === "O" ? "Old" : "—"}</td>
            <td className="n">{money(e.gross)}</td><td className="n">{money(e.exempt)}</td><td className="n">{money(e.standard)}</td><td className="n">{money(e.chapter6)}</td><td className="n">{money(e.taxable)}</td><td className="n">{money(e.tds)}</td></tr>)}</tbody>
        </table></div>
      : checks.length ? <section className="dash-card"><h3>Before filing</h3>{checks.map((c, i) => <span key={i} style={{ display: "contents" }}>
          <div className="dash-row"><span>{c.what}</span><b>{c.n}</b></div><p className="note">{c.how}{c.who.length ? " e.g. " + c.who.join(", ") : ""}</p></span>)}</section>
        : <p className="note">Nothing to fix for this quarter.</p>}
  </>;
}

/* ---------------------------------------------------------------- certificates */

function NewCert() {
  const blank = { party: "", pan: "", section: "", certNo: "", rate: "", from: "", to: "" }, [c, setC] = useState(blank);
  const box = (k, props) => <input value={c[k]} onChange={(ev) => setC({ ...c, [k]: ev.target.value })} {...props} />;
  return <tr>
    <td>{box("party", { type: "text", placeholder: "deductee as named in Tally", "aria-label": "New certificate: deductee", style: { width: 190 } })}</td>
    <td>{box("pan", { type: "text", placeholder: "PAN", "aria-label": "New certificate: PAN", style: { width: 110 } })}</td>
    <td>{box("section", { type: "text", placeholder: "194C", "aria-label": "New certificate: section", style: { width: 80 } })}</td>
    <td>{box("certNo", { type: "text", placeholder: "certificate no.", "aria-label": "New certificate: number", style: { width: 140 } })}</td>
    <td className="n">{box("rate", { type: "text", inputMode: "decimal", placeholder: "0.5", "aria-label": "New certificate: rate", style: { width: 70, textAlign: "right" } })}</td>
    <td>{box("from", { type: "date", "aria-label": "New certificate: from" })}</td><td>{box("to", { type: "date", "aria-label": "New certificate: to" })}</td>
    <td className="ac"><button className="btn small" onClick={() => { if (certAdd(c)) setC(blank); }}>Add</button></td>
  </tr>;
}

export function CertsPage() {
  const list = Certs.all(), iss = Certs.issues(S.tdsFy || "", "");
  return <>
    <section className="dash-card" style={{ marginBottom: 12 }}><h3>Certificates under section 197</h3>
      <p className="note">A deductee with a certificate for a lower rate, or nil. Where a payment is covered by one, that rate is what the system expects instead of the usual rate.</p>
      <div className="bk-tablewrap"><table className="bk-table">
        <thead><tr><th>Deductee</th><th>PAN</th><th>Section</th><th>Certificate no.</th><th className="n">Rate</th><th>From</th><th>To</th><th className="ac"></th></tr></thead>
        <tbody>
          {list.map((c) => <tr key={c.id}><td>{c.party}</td><td>{c.pan || ""}</td><td>{c.section || "any"}</td><td>{c.certNo || ""}</td><td className="n">{num(c.rate)}%</td>
            <td>{c.from ? fmtDate(c.from) : ""}</td><td>{c.to ? fmtDate(c.to) : ""}</td>
            <td className="ac"><button className="icon danger" aria-label="Remove this certificate" onClick={() => certDelete(c.id)}>✕</button></td></tr>)}
          <NewCert />
        </tbody>
      </table></div></section>
    <section className="dash-card"><h3>Rate questions</h3>
      <p className="note">Where the books deducted at a rate different from the one that applies: a certificate, 20% under section 206AA when there is no valid PAN, or the usual rate for the section.</p>
      <RateQuestions list={iss.slice(0, 200)} />{!iss.length && <Empty>Every deduction matches the rate that applies.</Empty>}
      {iss.length > 200 && <p className="note">The first 200 of {iss.length} are shown.</p>}
    </section>
  </>;
}
