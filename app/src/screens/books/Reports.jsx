// The Reports tab of a client's books: every report in one place, by area, as a plain list (clean-up batch 3,
// 11-Oct-2026): each area its reports, one line each with what it shows, and at most two headline figures; the area's
// other figures and its chart are under "Figures and charts", folded. Was RPT.view and RPT.areaDash (src/js/45); the figures are RPT.data, a report opens with
// RPT.open. The line saying how fresh the books are is parts/FreshBar.jsx.
//
// State: S.rptQ (the search), S.rptFy (the year).
import { useEffect } from "react";
import Bars from "../../parts/Bars.jsx";
import NotRead from "../../parts/NotRead.jsx";
import NoBooks from "../../parts/NoBooks.jsx";
import FreshBar from "../../parts/FreshBar.jsx";
import { BusyCard } from "../../parts/Reading.jsx";
import Statements, { RX_VIEWS } from "./Statements.jsx";

// two decimals everywhere (spec K5), with ₹ on every amount (clean-up batch 3)
const m = (v) => money(r2(v || 0));
const pct = (a, c) => c ? (Math.round(a / c * 1000) / 10) + "%" : "—";

// a figure that opens its report
const T = ({ l, v, sub, rid, cls }) => <button className={"dtile" + (cls ? " " + cls : "")} onClick={rid ? () => RPT.open(rid) : undefined}><span>{l}</span><b>{v}</b>{sub ? <small>{sub}</small> : null}</button>;
const Tiles = ({ children }) => <div className="dash-tiles">{children}</div>;
const Link = ({ r }) => <button className="rpt-link rpt-row" onClick={() => RPT.open(r[0])}><b>{r[2]}</b><span>{r[3]}</span></button>;

function AreaDash({ id, d }) {
  const mon = d.months.map((x) => FC.shortMonth(x));
  // a year that has ended is "for the year", not "the year so far" (review of 02-Oct-2026)
  const yearSub = d.R.fyEnd && Audit.today() > d.R.fyEnd ? "for the year " + FC.fyLabel(d.R.fy) : "the year so far";
  if (id === "overview") {
    const rev = (d.pl.heads.rev || { t: 0 }).t;
    const yc = RPT.yearCount(d.R.fy);
    const salesSub = yc.sales ? yearSub : "no sales entries in " + FC.fyLabel(d.R.fy) + " yet (" + yc.text + " in the books this year)";
    // sales: MIS's figure for the same dates (RPT.data, MIS.sales). Without the ledgers' groups the profit is not known
    // (expenses cannot be told apart): a dash, as MIS shows it, not 0.00 (audit of 11-Oct-2026)
    const noGroups = !d.groups, ng = "the ledgers' groups are not read yet";
    return <><Tiles><T l="Sales" v={m(d.salesTotal)} sub={salesSub} rid="mis-sales" /><T l="Gross profit" v={noGroups ? "—" : m(d.pl.gross.t)} sub={noGroups ? ng : pct(d.pl.gross.t, rev) + " of sales"} rid="mis-pl" />
      <T l="Profit before tax" v={noGroups ? "—" : m(d.pl.pbt.t)} sub={noGroups ? ng : pct(d.pl.pbt.t, rev) + " of sales"} rid="mis-pl" cls={!noGroups && d.pl.pbt.t < 0 ? "warn" : ""} />
      <T l="Cash and bank" v={d.cashBank == null ? "—" : m(d.cashBank)} sub={d.cashBank == null ? "balances not read yet" : "on " + FC.when(d.R.to)} rid="lk-group-bank" /></Tiles>
      <Bars labels={mon} series={[{ name: "Sales", cls: "c1", values: d.months.map((x) => d.sales[x]) }, { name: "Purchases and direct costs", cls: "c2", values: d.months.map((x) => d.purch[x]) }]} label="Sales and purchases by month" /></>;
  }
  if (id === "parties") {
    // one basis for every figure (review of 01-Oct-2026): what each party owes on balance, aged so that the ages add up to
    // it (MIS.ageing: sum.owe and sum.nb); a balance the other way is an advance, shown on its own as a positive figure
    const owed = (A) => A.sum.owe != null ? A.sum.owe : Math.max(0, A.sum.tally != null ? A.sum.tally : A.sum.open);
    const ages = (A) => A.sum.nb || A.sum.b, over = ages(d.recv)[3] + ages(d.recv)[4];
    const nOwe = (A) => A.rows.filter((p) => (p.net != null ? p.net : p.total) > 0).length;
    const advR = d.recv.sum.advance || 0, advP = d.pay.sum.advance || 0;
    return <><Tiles><T l="Owed to you" v={m(owed(d.recv))} sub={nOwe(d.recv) + " customers" + (advR >= 1 ? " · advances received " + m(advR) : "")} rid="mis-recv" />
      <T l="Over 90 days" v={m(over)} sub={owed(d.recv) ? pct(over, owed(d.recv)) + " of what is owed to you" : "customers"} rid="let-remind" cls={over > 0 ? "warn" : ""} />
      <T l="You owe" v={m(owed(d.pay))} sub={nOwe(d.pay) + " suppliers"} rid="mis-pay" />
      <T l="Advances to suppliers" v={m(advP)} sub="suppliers with a debit balance" rid="mis-pay" />
      <T l={"MSME past " + MIS.cfg(S.books).msmeDays + " days"} v={m(d.msmeDue)} sub="section 43B(h)" rid="mis-pay" cls={d.msmeDue > 0 ? "warn" : ""} /></Tiles>
      <Bars labels={MIS.BUCKETS.map((z) => z[1])} series={[{ name: "Owed to you", cls: "c1", values: ages(d.recv) }, { name: "You owe", cls: "c3", values: ages(d.pay) }]} label="Ageing, in days" /></>;
  }
  if (id === "cash") {
    const ti = Object.values(d.inM).reduce((s, x) => s + x, 0), to = Object.values(d.outM).reduce((s, x) => s + x, 0);
    return <><Tiles><T l="Received" v={m(ti)} sub="into bank and cash" rid="lk-group-bank" /><T l="Paid out" v={m(to)} sub="from bank and cash" rid="lk-group-bank" />
      <T l="Net" v={m(ti - to)} sub={ti - to < 0 ? "more went out" : "more came in"} rid="mis-cash" cls={ti - to < 0 ? "warn" : ""} />
      <T l="Balance now" v={d.cashBank == null ? "—" : m(d.cashBank)} sub={d.cashBank == null ? "balances not read yet" : "on " + FC.when(d.R.to)} rid="lk-group-bank" /></Tiles>
      <Bars labels={mon} series={[{ name: "Received", cls: "c1", values: d.months.map((x) => d.inM[x]) }, { name: "Paid", cls: "c3", values: d.months.map((x) => d.outM[x]) }]} label="Money in and out by month" /></>;
  }
  if (id === "gst") {
    const g = d.comp.gst || [], s = (k) => g.reduce((a, x) => a + num(x[k]), 0), last = g[g.length - 1] || {};
    return <><Tiles><T l="Tax on sales" v={m(s("out"))} sub={yearSub + ", FinCom's working"} rid="gst-r3b" /><T l="Input credit" v={m(s("itc"))} sub={yearSub + ", FinCom's working"} rid="gst-inreg" /><T l="Paid in cash" v={m(s("pay"))} sub="paid from the bank, per the books" rid="gst-r3b" />
      <T l="Worked out to pay" v={m(s("due"))} sub={"after credit, from the books (not the 3B filed)"} rid="gst-r3b" /></Tiles>
      {g.length > 0 && <Bars labels={g.map((x) => FC.shortMonth(x.ym))} series={[{ name: "Tax on sales", cls: "c4", values: g.map((x) => x.out) }, { name: "Input credit", cls: "c2", values: g.map((x) => x.itc) }]} label="GST by month" />}</>;
  }
  if (id === "tds") {
    const t = d.comp.tds || [], ded = t.reduce((a, x) => a + x.ded, 0), dep = t.reduce((a, x) => a + x.dep, 0);
    const ch = t.reduce((a, x) => a + num(x.challans), 0);
    // opening payable + deducted - paid = closing payable (review of 02-Oct-2026), checked against the books' balance
    const rl = d.comp.tdsRoll;
    return <><Tiles>{rl && <T l="TDS payable at the start" v={m(rl.open)} sub={"owed on " + FC.when(d.R.from) + ", TDS ledgers"} rid="tds-q" />}
      <T l="Deducted" v={m(ded)} sub={yearSub + ", TDS ledgers credited"} rid="tds-q" /><T l="Paid" v={m(dep)} sub="TDS ledgers paid from the bank" rid="tds-q" />
      {rl ? <T l="TDS payable at the end" v={m(rl.close)} sub={m(rl.open) + " + " + m(ded) + " − " + m(dep) + (rl.ties ? " · agrees with the books" : " · the books show " + m(rl.books))} rid="tds-checks" cls={rl.ties ? "" : "warn"} />
        : <T l="Deducted less paid" v={m(ded - dep)} sub={"in the year only · challans here " + m(ch)} rid="tds-checks" />}
      <T l="Deductees" v={String(d.tdsDeductees)} sub="with TDS this year" rid="tds-q" /></Tiles>
      {t.length > 0 && <Bars labels={t.map((x) => FC.shortMonth(x.ym))} series={[{ name: "Deducted", cls: "c5", values: t.map((x) => x.ded) }, { name: "Deposited", cls: "c2", values: t.map((x) => x.dep) }]} label="TDS by month" />}</>;
  }
  if (id === "audit") {
    if (!d.au) return <div className="fc-empty small"><p className="note">The audit has not been run for this client yet.</p><button className="btn small" onClick={() => RPT.open("au-find")}>Run the audit</button></div>;
    // a kept run that no longer fits the books: none of its figures, only Run again (review of 02-Oct-2026)
    if (Audit.stale(d.au)) return <div className="fc-empty small" data-rpt-audit-stale=""><p className="note">{"The last audit run (" + FC.span(d.au.from, d.au.to) + ") no longer fits the books, so its findings are not shown."}</p><button className="btn small primary" onClick={() => RPT.open("au-find")}>Run again</button></div>;
    const high = d.open.filter((f) => f.sev === "high");
    return <><Tiles><T l="Serious, still open" v={String(high.length)} sub={m(high.reduce((s, f) => s + num(f.amount), 0)) + " involved"} rid="au-find" cls={high.length ? "warn" : ""} /><T l="All open" v={String(d.open.length)} sub="findings" rid="au-find" />
      <T l="Put right" v={String((d.au.solved || []).reduce((s, x) => s + x.n, 0))} sub="since earlier runs" rid="au-find" /><T l="Last run" v={FC.when(String(d.au.at).slice(0, 10).replace(/-/g, ""))} sub={FC.span(d.au.from, d.au.to)} rid="au-find" /></Tiles>
      {high.length > 0 && <ul className="rpt-top">{high.slice(0, 3).map((f, i) => <li key={f.id + ":" + i}><span className="tag bad">serious</span> {f.title}</li>)}</ul>}</>;
  }
  return null;
}

// at most two headline figures an area, the same figures its tiles show (AreaDash); none before the books are in
function heads(id, d) {
  if (!d) return [];
  if (id === "overview") return [["Sales", m(d.salesTotal)], ["Profit before tax", d.groups ? m(d.pl.pbt.t) : "—"]];
  if (id === "parties") {
    const owed = (A) => A.sum.owe != null ? A.sum.owe : Math.max(0, A.sum.tally != null ? A.sum.tally : A.sum.open);
    return [["Owed to you", m(owed(d.recv))], ["You owe", m(owed(d.pay))]];
  }
  if (id === "cash") {
    const ti = Object.values(d.inM).reduce((s, x) => s + x, 0), to = Object.values(d.outM).reduce((s, x) => s + x, 0);
    return [["Received", m(ti)], ["Paid out", m(to)]];
  }
  if (id === "gst") { const g = d.comp.gst || [], s = (k) => g.reduce((a, x) => a + num(x[k]), 0); return [["Tax on sales", m(s("out"))], ["Worked out to pay", m(s("due"))]]; }
  if (id === "tds") { const t = d.comp.tds || []; return [["Deducted", m(t.reduce((a, x) => a + x.ded, 0))], ["Paid", m(t.reduce((a, x) => a + x.dep, 0))]]; }
  if (id === "audit") {
    if (!d.au || Audit.stale(d.au)) return [];
    return [["Serious, still open", String(d.open.filter((f) => f.sev === "high").length)], ["All open", String(d.open.length)]];
  }
  return [];
}

export default function Reports({ b }) {
  const have = (b.vouchers || []).length > 0, q = String(S.rptQ || "").toLowerCase().trim();
  // when the bridge is live, the books are brought up to date on opening (as before, after each drawing)
  useEffect(() => { if (LK.live()) setTimeout(() => LK.autoFresh(), 0); });
  const d = have ? RPT.data() : null, R = have ? RPT.range() : null;
  const head = <>
    {(have || LK.live()) && <FreshBar b={b} />}
    <div className="rpt-top-row rpt-find"><p className="note" style={{ margin: 0 }}>{"Every report for " + CO().name + ", by area. Click one to open it."}</p>
      <input type="search" id="rptQ" data-fk="rptQ" value={S.rptQ || ""} placeholder="Find a report: ageing, 3B, cash, ratios…" aria-label="Find a report" onChange={(ev) => setAndShow("rptQ", ev.target.value, true)} />
      {have && <select aria-label="Year" value={RPT.range().fy} onChange={(ev) => RPT.pickFy(ev.target.value)}>{RPT.years().map((y) => <option key={y} value={y}>{FC.fyLabel(y)}</option>)}</select>}</div>
    {have && R && R.notRead && <NotRead end={R.end} what={"Reports " + FC.fyLabel(R.fy)} read={FC.fyLabel(R.fy)} show={RPT.fys()[0] ? FC.fyLabel(RPT.fys()[0]) : ""} onShow={() => RPT.pickFy(RPT.fys()[0])} />}
    {LK.fr().busy && <BusyCard title="Bringing the books up to date…" detail={LK.fr().busy} done={0} total={0} />}
    {!have && <NoBooks what="Reports" />}
  </>;
  // Step 3: the financial statements and reports (Statements.jsx, FSX in src/js/78-reports.js)
  if (have && S.rxView) return <>{head}<Statements b={b} /></>;
  const rx = have ? <section className="rpt-group rpt-g-rx" data-rpt-group="rx" style={{ marginBottom: 12 }}><header><h3>Financial statements and reports</h3><span className="note">Schedule III, cash MIS, 3CD, DCF</span></header>
    <ul className="rpt-list">{RX_VIEWS.map(([k, l, w]) => <li key={k}><button className="rpt-link rpt-row" data-rx-entry={k} onClick={() => setAndShow("rxView", k)}><b>{l}</b><span>{w}</span></button></li>)}</ul></section> : null;
  if (q) {
    const hits = RPT.LIST.filter((r) => (r[2] + " " + r[3] + " " + RPT.AREAS.find((a) => a.id === r[1]).title).toLowerCase().includes(q));
    return <>{head}<section className="rpt-group" style={{ marginTop: 12 }}><header><h3>{hits.length + " report" + (hits.length === 1 ? "" : "s") + " found"}</h3></header>
      {hits.length ? <ul className="rpt-list">{hits.map((r) => <li key={r[0]}><Link r={r} /></li>)}</ul> : <p className="note">Nothing by that name. Try Look up for a ledger or an entry.</p>}</section></>;
  }
  const yr = d ? FC.fyLabel(d.R.fy) + (d.R.to < d.R.fyEnd ? ", to " + FC.when(d.R.to) : "") : "";
  return <>{head}{rx}
    <div className="rpt-index" data-rpt-index="">{RPT.AREAS.map((a) => { const h = heads(a.id, d);
      return <section key={a.id} className={"rpt-group rpt-g-" + a.id} data-rpt-group={a.id}><header><h3>{a.title}</h3>{yr && <span className="note">{yr}</span>}</header>
        {h.length > 0 && <ul className="rpt-heads" data-rpt-heads="">{h.map(([l, v]) => <li key={l}>{l + " "}<b>{v}</b></li>)}</ul>}
        <ul className="rpt-list">{RPT.LIST.filter((r) => r[1] === a.id).map((r) => <li key={r[0]}><Link r={r} /></li>)}</ul></section>; })}</div>
    {/* the areas' figures and charts, as they were, folded */}
    {d && <details className="rpt-charts" data-rpt-charts="" style={{ marginTop: 14 }}><summary>Figures and charts</summary>
      <div className="rpt-grid">{RPT.AREAS.map((a) => <section key={a.id} className={"dash-card rpt-area rpt-" + a.id}><div className="rpt-ah"><i className={"rpt-dot " + a.ic} aria-hidden="true"></i><h3>{a.title}</h3><span className="note">{yr}</span></div>
        <AreaDash id={a.id} d={d} /></section>)}</div></details>}
  </>;
}
