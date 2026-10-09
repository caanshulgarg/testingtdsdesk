// The MIS tab of a client's books: the period and its run, then Summary, Profit and loss, Receivables, Payables, Sales,
// Purchases and expenses, Cash flow (with 13 weeks ahead), Ratios, Registrations, Cost centres, Budget and Compliance.
// Was viewBooksMis and misP2Html (src/js/18). The figures are MIS (src/js/07); changes go through misRangeSet,
// misQuickGo, misTabGo, misFreqSet, misMsmeSet, misBudSet (src/js/23) and doAct (misRun, misPack, misExcel, misBudFill).
// The printed pack is still misPackHtml.
//
// State: S.misRange, S.misTab, S.misQ / S.misF / S.misCat (filters), S.misOpen (a party opened), S.misOpenHead,
// S.misLed (a ledger's entries), S.misCf, S.misWeek, S.misCc (rows opened), S.misBudPct.
import NotRead from "../../parts/NotRead.jsx";
import { Fragment } from "react";
import CommitBox from "../../parts/CommitBox.jsx";
import { CatchUp } from "../../parts/Notes.jsx";
import Confirm from "../../parts/Confirm.jsx";
import { ListRows } from "../../parts/ListTable.jsx";
import DateBox from "../../parts/DateBox.jsx";

const m = (v) => INR.format(r2(v || 0));
const d = (x) => fmtDate(tallyDate(x));
const Act = ({ act, className = "btn small", children }) => <button className={className} onClick={() => doAct(act)}>{children}</button>;
const Tile = ({ l, v, sub }) => <div className="dtile"><span>{l}</span><b>{v}</b><small>{sub || ""}</small></div>;
// MIS statements and schedules (profit and loss, ages, months): their rows in the report's order
const Table = ({ id, head, children, style }) => <div className="bk-tablewrap"><table className="bk-table" id={id} style={style} data-statement="">{head && <thead><tr>{head}</tr></thead>}<tbody>{children}</tbody></table></div>;
const Card = ({ title, top, children }) => <section className="dash-card" style={top ? { marginTop: 12 } : undefined}>{title && <h3>{title}</h3>}{children}</section>;
const Opener = ({ open, onClick, children }) => <button className="linkbtn" onClick={onClick}>{(open ? "▾ " : "▸ ")}{children}</button>;
const toggle = (key, v, none = "") => () => setAndShow(key, S[key] === v ? none : v);
const MonthHeads = ({ months, cols, short }) => cols ? months.map((mm) => <th key={mm} className="n">{short ? GSTR.label(mm).replace(/[-\s]\d{4}$/, "") : GSTR.label(mm)}</th>) : null;
const TABS = [["summary", "Summary"], ["pl", "Profit and loss"], ["recv", "Receivables"], ["pay", "Payables"], ["sales", "Sales"], ["purch", "Purchases and expenses"], ["cash", "Cash flow"], ["ratios", "Ratios"], ["regs", "Registrations"], ["cc", "Cost centres"], ["budget", "Budget"], ["comp", "Compliance"]];

// the period and Run now, under the tabs; how often it runs on its own and the downloads fold away (review of 01-Oct-2026)
function Head({ b, r, rg }) {
  const c = MIS.cfg(b);
  return <section className="dash-card" data-mis-head="">
    <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label className="f" style={{ minWidth: 150 }}><span>From</span><DateBox aria-label="MIS from" value={rg.from || ""} onChange={(ev) => misRangeSet("from", ev.target.value)} /></label>
      <label className="f" style={{ minWidth: 150 }}><span>To</span><DateBox aria-label="MIS to" value={rg.to || ""} onChange={(ev) => misRangeSet("to", ev.target.value)} /></label>
      <span className="note" style={{ alignSelf: "center" }} data-mis-period="">{rg.from && rg.to ? fmtDate(rg.from) + " to " + fmtDate(rg.to) : ""}</span>
      {[["month", "This month"], ["lastmonth", "Last month"], ["quarter", "This quarter"], ["ytd", "Year to date"], ["lastyear", "Last year"]].map(([k, l]) => <button key={k} className="btn small" onClick={() => misQuickGo(k)}>{l}</button>)}
      <Act act="misRun" className="btn small primary">Run now</Act>
      {r && <><Act act="misPack" className="btn small">Download the MIS pack (PDF)</Act><Act act="misExcel">Excel</Act></>}</div>
    <details style={{ marginTop: 8 }}><summary className="note" style={{ cursor: "pointer" }}>Settings: run on its own</summary>
      <Confirm id="books:mis-settings" label="MIS settings" stores={["books:misCfg"]}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}><span className="note">Run on its own</span>
        <select aria-label="MIS runs on its own" style={{ width: "auto" }} value={c.freq} onChange={(ev) => misFreqSet(ev.target.value)}>
          {[["monthly", "on the 1st, for the month just ended"], ["weekly", "every week, the year so far"], ["daily", "every day, the year so far"], ["off", "only when I run it"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </Confirm>
    </details>
  </section>;
}

// the line under the head: the period run, how, when, its result code, and whether it agrees with Tally
function RunLine({ r }) {
  return <p className="note" style={{ margin: "10px 0" }}>{d(r.from) + " to " + d(r.to) + " · " + r.how + " on " + fmtDateTime(r.at) + " · result code "}<b>{r.code}</b>
    {r.control ? (r.control.ok ? <>{" · "}<span style={{ color: "var(--ok)" }}>agrees with Tally’s balances, ledger by ledger</span></> : <>{" · "}<span className="bad">{r.control.n + " ledgers differ from Tally by ₹" + m(r.control.amt)}</span></>)
      : " · read the period from Tally through the bridge to check it against Tally’s balances"}</p>;
}

// a search box, and on Receivables and Payables the overdue / MSME filter
function Search({ tab, ph }) {
  return <div className="revfilter"><input type="search" id="misq" aria-label={ph} data-fk="misq" value={S.misQ || ""} placeholder={ph} style={{ width: 260 }} onChange={(ev) => setAndShow("misQ", ev.target.value, true)} />
    {(tab === "recv" || tab === "pay") && <select aria-label="Which parties" style={{ width: "auto" }} value={S.misF || ""} onChange={(ev) => setAndShow("misF", ev.target.value)}>
      <option value="">Every party</option><option value="90">Over 90 days due</option>{tab === "pay" && <option value="msme">MSME suppliers</option>}</select>}</div>;
}

const pct = (a, c2) => c2 ? (Math.round((a - c2) / Math.abs(c2) * 1000) / 10) + "%" : "—";

function Summary({ b, r }) {
  // what is owed on balance, aged so that the ages add up to it; a balance the other way is an advance (review of 01-Oct-2026)
  // review of 02-Oct-2026: the headline is the ledger balances (Parties.position, as Reports and Letters show it); the ages split it
  const owed = (A) => r.owed ? (A === r.recv ? r.owed.r : r.owed.p) : A.sum.owe != null ? A.sum.owe : (A.sum.tally != null ? A.sum.tally : A.sum.open);
  const over90 = (A) => A.sum.nb ? A.sum.nb[3] + A.sum.nb[4] : A.sum.b[3] + A.sum.b[4];
  const adv = (A, who) => A.sum.advance >= 1 ? " · advance " + who + " " + m(A.sum.advance) : "";
  const owedNote = (A) => A.sum.tally != null ? "ledger balances" + (A.sum.und >= 1 ? ", " + m(A.sum.und) + " not bill-wise" : "") : "bills raised in these books still open" + (Math.abs(A.sum.pre) >= 1 ? "; " + m(Math.abs(A.sum.pre)) + " settled against older bills not in these books" : "");
  const cb = (r.balances.cash || []).concat(r.balances.bank || []);
  // review of 01-Oct-2026: without Tally's ledger groups the profit and loss cannot tell an expense from anything else
  const noGroups = !Audit.mastersIn();
  return <>
    {noGroups && <p className="bk-alert" role="status" style={{ margin: "0 0 10px" }}>The ledgers’ groups are not in these books yet, so the profit and loss counts only ledgers named as sales or purchases: expenses are left out and the profit shown is too high. They come with the ledgers from Tally (FinCom Bridge 2.1).</p>}
    <div className="dash-tiles">
      <Tile l="Sales, the period" v={m(r.sales.total)} sub={(r.sales.other ? "other income " + m(r.sales.other) + " · " : "") + (r.prev ? "previous period " + m(r.prev.sales) + " (" + pct(r.sales.total, r.prev.sales) + ")" : "") + (r.ly ? " · last year " + m(r.ly.sales) + " (" + pct(r.sales.total, r.ly.sales) + ")" : "")} />
      <Tile l="Profit before tax" v={noGroups ? "—" : m(r.pl.pbt.t)} sub={"gross profit " + m(r.pl.gross.t) + (r.pl.heads.rev ? " (" + (Math.round(r.pl.gross.t / r.pl.heads.rev.t * 1000) / 10) + "% of revenue)" : "")} />
      {/* review of 02-Oct-2026: the tile is sales, of the period's last month up to its last day, and of the year so far */}
      <Tile l={"Sales, " + GSTR.label(String(r.to).slice(0, 6)) + (MIS.shift(r.to, 0, 1).slice(6) === "01" ? "" : " to " + d(r.to))} v={r.mtd != null ? m(r.mtd) : "—"} sub={r.ytd != null ? "year to date (from " + d(Audit.fyStart(r.to)) + ") " + m(r.ytd) : ""} />
      <Tile l="Received · paid" v={m(r.cash.rec)} sub={"paid out " + m(r.cash.pay) + ", net " + m(r.cash.rec - r.cash.pay)} />
    </div>
    <div className="dash-tiles">
      <Tile l="Owed to you" v={m(owed(r.recv))} sub={owedNote(r.recv) + " · over 90 days " + m(over90(r.recv)) + adv(r.recv, "from customers") + (r.dso != null ? " · " + r.dso + " days of sales" : "")} />
      <Tile l="You owe" v={m(owed(r.pay))} sub={owedNote(r.pay) + " · over 90 days " + m(over90(r.pay)) + adv(r.pay, "to suppliers") + (r.dpo != null ? " · " + r.dpo + " days of purchases" : "")} />
      <Tile l={"MSME suppliers past " + MIS.cfg(b).msmeDays + " days"} v={m(r.msme.reduce((s, x) => s + x.amt, 0))} sub={r.msme.length + " suppliers · section 43B(h)"} />
      <Tile l="GST worked out, last month" v={m((r.comp.gst[r.comp.gst.length - 1] || {}).due)} sub={"after credit, FinCom's working from the books · paid from the bank " + m((r.comp.gst[r.comp.gst.length - 1] || {}).pay)} />
    </div>
    {r.balances.cash || r.balances.bank ? <Card top title={"Cash and bank on " + d(r.to)}>
      <Table>{cb.filter((x) => Math.abs(x[1]) >= 1).map(([l, v], i) => <tr key={l + ":" + i}><td>{l}</td><td className={"n" + (v < 0 ? " bad" : "")}>{m(v)}</td></tr>)}
        <tr><td><b>Total</b></td><td className="n"><b>{m(cb.reduce((s, x) => s + x[1], 0))}</b></td></tr></Table>
      <p className="note">From {r.balances.src}.</p></Card>
      : <p className="note">Cash and bank balances: {r.balances.why || ""}.</p>}
    <Card top title="Due in the coming weeks">{r.dues.map(([dt, l], i) => <div key={i} className="dash-row"><span>{l}</span><b>{d(dt)}</b></div>)}</Card>
  </>;
}

// the entries of one ledger in the period, opened from the profit and loss
function LedgerEntries({ b, r }) {
  const vs = (b.vouchers || []).filter((v) => v.date >= r.from && v.date <= r.to && v.ent.some((e) => e.l === S.misLed)).sort((a, c) => a.date.localeCompare(c.date));
  return <Card top title={<>{S.misLed + " "}<button className="linkbtn" onClick={() => setAndShow("misLed", "")}>close</button></>}>
    {/* the one list table (spec K6) */}
    <ListRows name="misLedger" of={vs.length} head={[{ label: "Date", role: "date", cls: "dt" }, { label: "Voucher", role: "number" }, { label: "Party", role: "party" }, { label: "Debit", role: "amount", cls: "n" }, { label: "Credit", role: "amount", cls: "n" }, { label: "Narration" }]}>
      {vs.slice(0, gfN(300)).map((v, i) => { const a = v.ent.filter((e) => e.l === S.misLed).reduce((s, e) => s + e.a, 0);
        return <tr key={v.date + ":" + v.no + ":" + i}><td>{d(v.date)}</td><td>{v.no}<div className="nr">{v.type}</div></td><td>{v.party || ""}</td><td className="n">{a < 0 ? m(-a) : ""}</td><td className="n">{a > 0 ? m(a) : ""}</td><td>{shownNarr(v.narr)}</td></tr>; })}
    </ListRows>
    {vs.length > 300 && <p className="note">The first 300 of {vs.length}.</p>}
  </Card>;
}

function ProfitLoss({ b, r }) {
  const months = r.pl.months, cols = months.length <= 12, span = 2 + (cols ? months.length : 0) + (r.prev ? 1 : 0) + (r.ly ? 1 : 0);
  const rows = [];
  const row = (label, x, bold, key) => rows.push(<tr key={rows.length}><td>{bold ? <b>{label}</b> : key ? <button className="linkbtn" onClick={() => setAndShow("misLed", key)}>{label}</button> : label}{x.flag && <>{" "}<span className="tag warn" data-pl-flag="">{x.flag}</span></>}</td>
    {cols && months.map((mm) => <td key={mm} className="n">{m((x.m || {})[mm])}</td>)}<td className="n">{bold ? <b>{m(x.t)}</b> : m(x.t)}</td>
    {r.prev && <td className="n">{x.p != null ? m(x.p) : ""}</td>}{r.ly && <td className="n">{x.y != null ? m(x.y) : ""}</td>}</tr>);
  const pv = (k) => r.prev && r.prev.pl.heads[k] ? r.prev.pl.heads[k].t : (r.prev ? 0 : null), lv = (k) => r.ly && r.ly.pl.heads[k] ? r.ly.pl.heads[k].t : (r.ly ? 0 : null);
  const block = (keys) => keys.forEach((k) => { const H = r.pl.heads[k]; if (!H) return; const lab = MIS.HEADS.find((z) => z[0] === k)[1];
    row(lab, Object.assign({}, H, { p: pv(k), y: lv(k) }), true);
    // the set-off of an expense head in credit (MIS.plRule) is a line of its own, not a ledger to open
    if (S.misOpenHead === k) H.led.forEach((x) => row(" " + x.l, x, false, x.so ? null : x.l));
    else rows.push(<tr key={rows.length}><td colSpan={span}><button className="linkbtn" onClick={toggle("misOpenHead", k)}>{"▸ " + H.led.filter((x) => !x.so).length + " ledgers" + (H.led.some((x) => x.so) ? " and the set-off" : "")}</button></td></tr>); });
  const tot = (label, k) => row(label, Object.assign({}, r.pl[k], { p: r.prev ? r.prev.pl[k].t : null, y: r.ly ? r.ly.pl[k].t : null }), true);
  block(["rev", "oth"]); tot("Total income", "income");
  block(["pur", "dir"]); tot("Gross profit", "gross");
  block(["emp", "exp"]); tot("Profit before interest and depreciation", "ebitda");
  block(["fin", "dep"]); tot("Profit before tax", "pbt");
  block(["tax"]); tot("Profit after tax", "pat");
  return <>
    <Table id="misPl" head={<><th></th><MonthHeads months={months} cols={cols} /><th className="n">Period</th>{r.prev && <th className="n">Previous period</th>}{r.ly && <th className="n">Last year</th>}</>}>{rows}</Table>
    <p className="note">Opening and closing stock are not in the day book, so gross profit is before the change in stock. Ledgers are placed by their group in Tally, as the Accounts tab places them. An expense ledger with a credit balance is set off in its own head; a head that ends in credit shows nil, and what is left is in Other income.{r.ly ? "" : " Last year is shown once last year’s books are read."}</p>
    {S.misLed && <LedgerEntries b={b} r={r} />}
  </>;
}

function Ageing({ b, r, tab }) {
  const A = tab === "recv" ? r.recv : r.pay, q = String(S.misQ || "").toLowerCase(), hasTally = A.rows.some((p) => p.tally != null);
  const list = A.rows.filter((p) => (!q || p.party.toLowerCase().includes(q)) && (S.misF !== "90" || (p.nb || p.b)[3] + (p.nb || p.b)[4] > 0) && (S.misF !== "msme" || /micro|small/i.test(p.msme)));
  // review of 02-Oct-2026: what is owed is the ledger balances; the ages split it, and what no bill explains is not
  // bill-wise. A party whose ledger balance and bills differ is listed at the top, and in the Difference column
  const owedL = r.owed ? (tab === "recv" ? r.owed.r : r.owed.p) : A.sum.owe, dif = A.sum.differ || [];
  return <>
    <p className="note" data-mis-owed="" style={{ margin: "0 0 8px" }}><b>{(tab === "recv" ? "Owed to you" : "You owe") + " on " + d(r.to) + ": ₹" + m(owedL)}</b>{" (ledger balances) · by age: " + MIS.BUCKETS.map((z, i) => z[1] + " days " + m((A.sum.nb || [])[i])).join(", ") + " · not bill-wise " + m(A.sum.und) + (A.sum.advance >= 1 ? " · advances " + (tab === "recv" ? "from customers " : "to suppliers ") + m(A.sum.advance) + ", not in the figure" : "")}</p>
    {dif.length > 0 && <p className="bk-alert" data-mis-differ="" style={{ margin: "0 0 8px" }}>{dif.length + (dif.length === 1 ? " party's ledger balance does not agree" : " parties' ledger balances do not agree") + " with the bills: " + dif.slice(0, 5).map((x) => x.party + " " + m(x.bills) + " in bills against " + m(x.ledger) + " in the ledger").join("; ") + (dif.length > 5 ? "; and " + (dif.length - 5) + " more (the Difference column)" : "") + ". What the bills do not explain is not bill-wise: set the bills against it in Tally (bill-wise details) to age it."}</p>}
    <Search tab={tab} ph={"Find a " + (tab === "recv" ? "customer" : "supplier")} />
    {/* review of 02-Oct-2026: the ages are of what is owed on balance (MIS.netOpen): receipts on account, advances and
        settlements of older bills are set against the oldest bills first, so a row's ages and its not bill-wise amount
        add up to its ledger balance; the bills as raised are listed when the row is opened */}
    <Table id="misAge" head={<><th>{tab === "recv" ? "Customer" : "Supplier"}</th>{MIS.BUCKETS.map((z) => <th key={z[1]} className="n">{z[1] + " days"}</th>)}
      <th className="n">Not bill-wise</th><th className="n" title="what is owed on balance: the ages plus not bill-wise">Owed</th><th className="n" title={tab === "recv" ? "a customer in credit: an advance received" : "a supplier in debit: an advance paid"}>Advance</th>{hasTally && <><th className="n">Ledger balance</th><th className="n">Difference</th></>}{tab === "pay" && <th>MSME</th>}</>}>
      {list.slice(0, gfN(400)).map((p, pi) => { const open = S.misOpen === p.party, nb = p.nb || p.b;
        return <Fragment key={p.party + ":" + pi}><tr data-key={p.party}><td><Opener open={open} onClick={toggle("misOpen", p.party)}>{p.party}</Opener></td>
          {nb.map((v, i) => <td key={i} className={"n" + (i >= 3 && v > 0 ? " bad" : "")}>{v ? m(v) : ""}</td>)}
          <td className="n" data-und="">{p.und ? m(p.und) : ""}</td><td className="n"><b>{m(Math.max(0, p.net != null ? p.net : p.total))}</b></td><td className="n">{p.advance ? m(p.advance) : ""}</td>
          {hasTally && <><td className="n">{p.tally != null ? m(p.tally) : ""}</td><td className={"n" + (p.diff && Math.abs(p.diff) >= 1 ? " bad" : "")} data-diff="" title="the ledger balance less the bills' total">{p.diff && Math.abs(p.diff) >= 0.005 ? m(p.diff) : ""}</td></>}
          {tab === "pay" && <td><select aria-label={"MSME: " + p.party} style={{ width: "auto" }} value={p.msme || ""} onChange={(ev) => misMsmeSet(p.party, ev.target.value)}><option value="">{"—"}</option>{["Micro", "Small", "Medium"].map((t) => <option key={t}>{t}</option>)}</select></td>}</tr>
          {open && <tr><td colSpan={14} style={{ background: "var(--paper)", padding: 0 }}><table className="bk-table" style={{ margin: 0 }}><thead><tr><th>Bill</th><th className="dt">Date</th><th className="n">Days</th><th className="n">As in the books</th><th className="n">Left after amounts on account</th></tr></thead><tbody>
            {p.bills.map((z, i) => { const o = (p.open || []).find((y) => y.ref === z.ref && y.date === z.date && y.ref);
              return <tr key={i}><td>{z.ref ? z.ref : "on account"}{z.ref && !z.hasNew ? <div className="nr">a bill from before these books</div> : null}{z.no && <div className="nr">{"vch " + z.no}</div>}</td><td>{d(z.date)}</td><td className="n">{z.age}</td><td className="n">{m(z.amt)}</td><td className="n">{o ? m(o.left) : ""}</td></tr>; })}</tbody></table></td></tr>}</Fragment>; })}
      <tr><td><b>Total</b></td>{(A.sum.nb || A.sum.b).map((v, i) => <td key={i} className="n"><b>{m(v)}</b></td>)}<td className="n"><b>{m(A.sum.und)}</b></td><td className="n"><b>{m(A.sum.owe != null ? A.sum.owe : A.sum.total)}</b></td><td className="n"><b>{m(A.sum.advance)}</b></td>{hasTally && <><td className="n"><b>{m(A.sum.tally)}</b></td><td className="n"><b>{m(A.sum.diff)}</b></td></>}</tr>
    </Table>
    <p className="note" style={{ margin: "6px 0 0" }}>Ages run from each bill’s due date where Tally has a credit period on it (the days it is overdue), else from the bill’s date. Receipts on account, advances and settlements of bills older than these books are set against the oldest bills first, so the ages and “not bill-wise” add up to what is owed on balance.</p>
    {Math.abs(A.sum.pre) >= 1 && A.sum.tally == null && <p className="bk-alert" style={{ marginTop: 8 }}>{m(Math.abs(A.sum.pre)) + " was " + (tab === "recv" ? "received" : "paid") + " against bills raised before the day book read here, so the total is not the balance. Read the books through the bridge (its balances fix the total), or a day book from when those bills were raised."}</p>}
    <p className="note">{"Age is counted from the bill date to " + d(r.to) + ". A bill “from before these books” was raised before the day book read here; what was received or paid against it is set against the oldest bills." + (tab === "pay" ? " MSME comes from the Udyam details in Tally; mark others here." : "")}</p>
    {tab === "pay" && r.msme.length > 0 && <Card top title={"MSME suppliers unpaid past " + MIS.cfg(b).msmeDays + " days"}><p className="note">Under section 43B(h), what is owed to a micro or small enterprise and unpaid beyond the agreed period (at most 45 days) is allowed only when paid.</p>
      <ListRows name="misMsme" unit={["supplier", "suppliers"]} head={[{ label: "Supplier", role: "party" }, { label: "Type" }, { label: "Bills", cls: "n", sum: true, fmt: String }, { label: "Amount", role: "amount", cls: "n" }, { label: "Oldest, days", cls: "n", sum: false }]}>
        {r.msme.map((x, i) => <tr key={x.party + ":" + i}><td>{x.party}</td><td>{x.type}</td><td className="n">{x.bills.length}</td><td className="n">{m(x.amt)}</td><td className="n">{Math.max.apply(null, x.bills.map((z) => z.age))}</td></tr>)}</ListRows></Card>}
  </>;
}

function Parties({ r, tab }) {
  const S2 = tab === "sales" ? r.sales : r.purchases, months = S2.months, cols = months.length <= 12, q = String(S.misQ || "").toLowerCase();
  const list = S2.rows.filter((x) => !q || x.party.toLowerCase().includes(q));
  return <>
    <Search tab={tab} ph={"Find a " + (tab === "sales" ? "customer" : "supplier")} />
    {tab === "sales" && <div className="dash-tiles">
      <Tile l="Customers" v={S2.rows.length} sub={S2.fresh != null ? S2.fresh + " new in the period" : ""} />
      <Tile l="Top five customers" v={(S2.total ? Math.round(S2.top5 / S2.total * 1000) / 10 : 0) + "%"} sub="of sales" />
      <Tile l="By registration" v={S2.byReg.length} sub={S2.byReg.map(([k, v]) => k + " " + m(v)).join(" · ")} />
      <Tile l="By state of the customer" v={S2.byState.length} sub={S2.byState.slice(0, 4).map(([k, v]) => k + " " + m(v)).join(" · ")} /></div>}
    <Table id="misParty" head={<><th>{tab === "sales" ? "Customer" : "Supplier"}</th><MonthHeads months={months} cols={cols} /><th className="n">Total</th><th className="n">Share</th></>}>
      {list.slice(0, gfN(400)).map((x, i) => <tr key={x.party + ":" + i}><td>{x.party || "—"}</td>{cols && months.map((mm) => <td key={mm} className="n">{x.m[mm] ? m(x.m[mm]) : ""}</td>)}<td className="n"><b>{m(x.t)}</b></td><td className="n">{S2.total ? Math.round(x.t / S2.total * 1000) / 10 + "%" : ""}</td></tr>)}
      <tr><td><b>Total</b></td>{cols && months.map((mm) => <td key={mm} className="n">{m(S2.rows.reduce((s, x) => s + (x.m[mm] || 0), 0))}</td>)}<td className="n"><b>{m(S2.total)}</b></td><td></td></tr>
    </Table>
    <p className="note">{tab === "sales" ? "Sales are shown without GST, less credit notes." : "Purchases and expenses booked against suppliers, without GST."}</p>
    {tab === "purch" && <Card top title="Expense heads by month">
      <Table head={<><th>Ledger</th><MonthHeads months={months} cols={cols} /><th className="n">Total</th></>}>
        {S2.heads.filter((x) => !q || x.l.toLowerCase().includes(q)).slice(0, gfN(200)).map((x, i) => <tr key={x.l + ":" + i}><td>{x.l}{x.jumps.length > 0 && <>{" "}<span className="tag warn">jumped</span></>}</td>
          {cols && months.map((mm) => <td key={mm} className={"n" + (x.jumps.includes(mm) ? " bad" : "")}>{x.m[mm] ? m(x.m[mm]) : ""}</td>)}<td className="n"><b>{m(x.t)}</b></td></tr>)}</Table>
      <p className="note">“Jumped”: a month at least ₹50,000 and more than one and a half times the average of the other months.</p></Card>}
  </>;
}

function CashFlow({ b, r, p2 }) {
  const C = p2.cash, F = p2.fc, months = C.months, cols = months.length <= 12;
  const secName = { op: "From operations", inv: "From investing", fin: "From financing" };
  const rows = [];
  ["op", "inv", "fin"].forEach((sc) => {
    const S3 = C[sc]; if (!C.rows.some((x) => x.sec === sc)) return;
    C.rows.filter((x) => x.sec === sc).forEach((x) => { const k = sc + "|" + x.lab, open = S.misCf === k;
      rows.push(<tr key={rows.length}><td>{" "}<Opener open={open} onClick={toggle("misCf", k)}>{x.lab}</Opener></td>{cols && months.map((mm) => <td key={mm} className="n">{x.m[mm] ? m(x.m[mm]) : ""}</td>)}<td className="n">{m(x.t)}</td></tr>);
      if (open) Object.entries(x.led).sort((a, c) => Math.abs(c[1]) - Math.abs(a[1])).slice(0, 40).forEach(([l, v]) => rows.push(<tr key={rows.length}><td className="note">{"  " + l}</td>{cols && months.map((mm) => <td key={mm}></td>)}<td className="n note">{m(v)}</td></tr>)); });
    rows.push(<tr key={rows.length}><td><b>{secName[sc]}</b></td>{cols && months.map((mm) => <td key={mm} className="n"><b>{m(S3.m[mm])}</b></td>)}<td className="n"><b>{m(S3.t)}</b></td></tr>);
  });
  return <>
    <Card title="Cash and bank: what came in and went out">
      <Table head={<><th></th><MonthHeads months={months} cols={cols} /><th className="n">Period</th></>}>{rows}
        <tr><td><b>Net change in cash and bank</b></td>{cols && months.map((mm) => <td key={mm} className="n"><b>{m(C.op.m[mm] + C.inv.m[mm] + C.fin.m[mm])}</b></td>)}<td className="n"><b>{m(C.net)}</b></td></tr>
        {C.open != null && <><tr data-cf="open"><td>{"Cash and bank at the start, " + d(r.from)}</td>{cols && months.map((mm) => <td key={mm}></td>)}<td className="n">{m(C.open)}</td></tr>
          <tr data-cf="close"><td><b>{"Cash and bank at the end, " + d(r.to)}</b></td>{cols && months.map((mm) => <td key={mm}></td>)}<td className="n"><b>{m(C.close)}</b></td></tr></>}</Table>
      {/* review of 02-Oct-2026: opening + net change = closing, checked against the cash and bank ledgers */}
      {C.open != null && (C.ties ? <p className="note" data-cf-ties="yes">{"Opening " + m(C.open) + " + net change " + m(C.net) + " = closing " + m(C.close) + ": agrees with the cash and bank ledgers."}</p>
        : <p className="bk-alert" data-cf-ties="no">{"Opening " + m(C.open) + " + net change " + m(C.net) + " = " + m(C.open + C.net) + ", but the cash and bank ledgers close at " + m(C.close) + " (" + m(C.diff) + " not explained): an entry moved cash or bank with no line on the other side."}</p>)}
      <p className="note">Each receipt or payment is placed by the ledger on the other side of it: customers, suppliers, taxes, staff, fixed assets, loans or capital. Moves between cash and bank are left out.</p>
      {/* round 4 (03-Oct-2026), item 29: the ledgers whose line was not decided by Tally's group alone; a note, never a block */}
      {C.notes && C.notes.length > 0 && <div className="note" data-cf-notes="" style={{ marginTop: 8, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 6 }}>
        <b>Grouping notes</b> — the lines follow Tally's groups; these were decided by a name word, a partner match or a Loan-given mark:
        <ul style={{ margin: "4px 0 0 18px" }}>{C.notes.map((n) => <li key={n.ledger}>{n.ledger} <span className="note">({n.group})</span> → {n.line}: {n.why}</li>)}</ul></div>}</Card>
    <Card top title={"The next 13 weeks, from " + d(F.start)}>
      {F.opening != null ? <p className="note">{"Starting with cash and bank of ₹" + m(F.opening) + (F.low ? "; the lowest point is ₹" + m(F.low.close) + " in the week of " + d(F.low.from) + "." : ".")}</p>
        : <p className="note">The cash in hand at the start is not known here (see the Summary); the table shows what comes in and goes out.</p>}
      <Table id="misFc" head={<><th>Week of</th><th className="n">Coming in</th><th className="n">Going out</th><th className="n">Net</th>{F.opening != null && <th className="n">Cash at the end</th>}</>}>
        {F.weeks.map((w) => { const open = S.misWeek === w.i;
          return <Fragment key={w.i}><tr><td><Opener open={open} onClick={toggle("misWeek", w.i, -1)}>{d(w.from)}</Opener></td><td className="n">{m(w.inn)}</td><td className="n">{m(w.out)}</td><td className={"n" + (w.net < 0 ? " bad" : "")}>{m(w.net)}</td>
            {F.opening != null && <td className={"n" + (w.close < 0 ? " bad" : "")}><b>{m(w.close)}</b></td>}</tr>
            {open && <tr><td colSpan={5} style={{ background: "var(--paper)", padding: 0 }}><table className="bk-table" style={{ margin: 0 }}><thead><tr><th className="dt">Date</th><th>What</th><th>Who</th><th className="n">Amount</th><th>Why this date</th></tr></thead><tbody>
              {w.items.map((z, i) => <tr key={i}><td>{d(z.d)}</td><td>{z.what}</td><td>{z.who}</td><td className={"n" + (z.amt < 0 ? " bad" : "")}>{m(z.amt)}</td><td>{z.why}</td></tr>)}</tbody></table></td></tr>}</Fragment>; })}
      </Table>
      <p className="note">{"The rules: each open bill is expected when that party usually settles (from its past bills; " + F.rd + " days for customers and " + F.pd + " for suppliers when a party has no history), and an overdue bill in the first week; MSME suppliers within " + MIS.cfg(b).msmeDays + " days; a payment made in at least three of the last four months, within 20% of the same amount, repeats on its usual day; GST on the 20th and TDS on the 7th, at last month’s figure and then the usual month."}</p></Card>
  </>;
}

function Ratios({ p2 }) {
  const R = p2.ratios, fmt = (v, u) => v == null ? "—" : typeof v === "string" ? v : u === "₹" ? "₹" + m(v) : v + (u === "%" ? "%" : " " + u);
  return <>
    <Card title="Ratios for the period">
      <Table>{R.list.map(([l, v, u, how], i) => <tr key={l + ":" + i}><td>{l}{how && <div className="nr">{how}</div>}</td><td className="n"><b>{fmt(v, u)}</b></td></tr>)}</Table>
      {!R.bs && <p className="note">Current ratio, debt to equity and working capital need the balances; read the period from Tally through the bridge.</p>}</Card>
    <Card top title="Margins month by month">
      <Table head={<><th>Month</th><th className="n">Revenue</th><th className="n">Gross margin</th><th className="n">Before-tax margin</th></>}>
        {R.trend.map((t2) => <tr key={t2.ym}><td>{GSTR.label(t2.ym)}</td><td className="n">{m(t2.rev)}</td><td className="n">{t2.gross == null ? "—" : t2.gross + "%"}</td><td className={"n" + (t2.pbt != null && t2.pbt < 0 ? " bad" : "")}>{t2.pbt == null ? "—" : t2.pbt + "%"}</td></tr>)}</Table></Card>
  </>;
}

function Regs({ r, p2 }) {
  const G = p2.regs;
  if (G.length < 2) return <p className="note">{"This client has one GST registration" + (G[0] ? " (" + G[0].gstin + ")" : "") + ". With more than one, sales, purchases and GST are shown for each here."}</p>;
  const months = G[0].months, cols = months.length <= 12;
  return <>
    <Card title="By GST registration">
      <Table head={<><th>Registration</th><th className="n">Sales</th><th className="n">Purchases</th><th className="n">GST paid in cash</th><th className="n">Share of sales</th></>}>
        {G.map((x, i) => <tr key={x.gstin + ":" + i}><td>{x.gstin}</td><td className="n">{m(x.sales)}</td><td className="n">{m(x.purch)}</td><td className="n">{m(x.gstPay)}</td><td className="n">{r.sales.total ? Math.round(x.sales / r.sales.total * 1000) / 10 + "%" : ""}</td></tr>)}</Table></Card>
    <Card top title="Sales by month">
      <Table head={<><th>Registration</th><MonthHeads months={months} cols={cols} /></>}>
        {G.map((x, i) => <tr key={x.reg + ":" + i}><td>{x.reg}</td>{cols && months.map((mm) => <td key={mm} className="n">{m((x.m[mm] || {}).s)}</td>)}</tr>)}</Table>
      <p className="note">A voucher belongs to the registration of its GST ledgers. Expenses without GST are not split by registration; use cost centres for that.</p></Card>
  </>;
}

function CostCentres({ p2 }) {
  const X = p2.cc, q = String(S.misQ || "").toLowerCase();
  if (!X.read) return <div className="bk-alert">Cost centres are read from the day book from this build on. Read the day book again (or read it from Tally), then run the MIS.</div>;
  if (!X.rows.length) return <p className="note">No income or expense in the period is allocated to cost centres in Tally.</p>;
  const list = X.rows.filter((x) => (!q || x.name.toLowerCase().includes(q)) && (!S.misCat || x.cat === S.misCat));
  return <>
    <div className="dash-tiles">
      <Tile l="Cost centres" v={X.rows.length} sub={X.cats.length + " categor" + (X.cats.length === 1 ? "y" : "ies")} />
      <Tile l="Income allocated" v={X.cover.inc == null ? "—" : X.cover.inc + "%"} sub={"not allocated ₹" + m(X.un.inc)} />
      <Tile l="Expenses allocated" v={X.cover.exp == null ? "—" : X.cover.exp + "%"} sub={"not allocated ₹" + m(X.un.exp)} />
      <Tile l="Made a loss" v={X.rows.filter((x) => x.inc && x.profit < 0).length} sub="of those with income" /></div>
    <div className="revfilter"><input type="search" id="misq" aria-label="Find a cost centre" data-fk="misq" value={S.misQ || ""} placeholder="Find a cost centre" style={{ width: 260 }} onChange={(ev) => setAndShow("misQ", ev.target.value, true)} />
      {X.cats.length > 1 && <select aria-label="Category" style={{ width: "auto" }} value={S.misCat || ""} onChange={(ev) => setAndShow("misCat", ev.target.value)}><option value="">Every category</option>{X.cats.map((c2) => <option key={c2}>{c2}</option>)}</select>}</div>
    <Table id="misCc" head={<><th>Cost centre</th><th className="dt">From</th><th className="dt">To</th><th className="n">Income</th><th className="n">Costs</th><th className="n">Profit</th><th className="n">Margin</th></>}>
      {list.slice(0, gfN(300)).map((x, i) => { const k = x.cat + "|" + x.name, open = S.misCc === k;
        return <Fragment key={k + ":" + i}><tr><td><Opener open={open} onClick={toggle("misCc", k)}>{x.name}</Opener>{X.cats.length > 1 && <div className="nr">{x.cat}</div>}</td><td>{d(x.first)}</td><td>{d(x.last)}</td>
          <td className="n">{m(x.inc)}</td><td className="n">{m(x.exp)}</td><td className={"n" + (x.profit < 0 ? " bad" : "")}><b>{m(x.profit)}</b></td><td className="n">{x.margin == null ? "—" : x.margin + "%"}</td></tr>
          {open && <tr><td colSpan={7} style={{ background: "var(--paper)", padding: 0 }}><table className="bk-table" style={{ margin: 0 }}><thead><tr><th>Ledger</th><th className="n">Amount</th></tr></thead><tbody>
            {Object.entries(x.led).sort((a, c) => Math.abs(c[1]) - Math.abs(a[1])).map(([l, v], j) => <tr key={l + ":" + j}><td>{l}</td><td className="n">{m(v)}</td></tr>)}</tbody></table></td></tr>}</Fragment>; })}
    </Table>
    <p className="note">{"From the cost centre allocations in Tally, on income and expense ledgers, by the heads of the profit and loss. Anything not allocated is shown above, not spread over the cost centres" + (X.un.moved ? "; it includes the excess credit of an expense head moved to Other income (₹" + m(X.un.moved) + ") and the set-off that leaves that head nil" : "") + "."}</p>
  </>;
}

function Budget({ r }) {
  const V = MIS.budgetVs(r), fy = V.fy, bud = MIS.budgetFor(fy), fyMonths = GSTRev.fyMonths(fy + "04");
  return <>
    <Card title={"Budget against actual, " + fy + "-" + String(num(fy) + 1).slice(2)}>
      {V.has ? <Table head={<><th>Head</th><th className="n">Budget for the period</th><th className="n">Actual</th><th className="n">Difference</th><th className="n">%</th></>}>
        {V.rows.map((x, i) => { const worse = x.sign > 0 ? x.diff < 0 : x.diff > 0;
          return <tr key={x.l + ":" + i}><td>{x.l}</td><td className="n">{m(x.budget)}</td><td className="n">{m(x.actual)}</td><td className={"n" + (worse && Math.abs(x.diff) >= 1 ? " bad" : "")}>{m(x.diff)}</td><td className="n">{x.pct == null ? "—" : x.pct + "%"}</td></tr>; })}
        <tr><td><b>Profit before tax</b></td><td className="n"><b>{m(V.pbt.budget)}</b></td><td className="n"><b>{m(V.pbt.actual)}</b></td><td className={"n" + (V.pbt.diff < 0 ? " bad" : "")}><b>{m(V.pbt.diff)}</b></td><td></td></tr></Table>
        : <p className="note">No budget for this year yet. Fill it in below, or start from last year.</p>}</Card>
    <Card top title="The budget">
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <Act act="misBudFill">Fill from this year’s actual so far</Act><label className="note">plus <CommitBox type="number" aria-label="Budget plus %" value={S.misBudPct || "10"} style={{ width: 70 }} onCommit={(v) => { S.misBudPct = v; }} />%</label>
        <span className="note">Figures in rupees for each month; income and costs as positive amounts.</span></div>
      <Table head={<><th>Head</th><MonthHeads months={fyMonths} cols short /><th className="n">Year</th></>}>
        {MIS.HEADS.map(([k, l]) => <tr key={k}><td>{l}</td>{fyMonths.map((mm) => <td key={mm}><CommitBox type="number" step="1" aria-label={"Budget " + l + " " + GSTR.label(mm)} data-fk={"bud-" + k + "-" + mm} value={(bud[k] || {})[mm] || ""} style={{ width: 92, textAlign: "right" }} onCommit={(v) => misBudSet(k, mm, v)} /></td>)}
          <td className="n"><b>{m(fyMonths.reduce((s2, mm) => s2 + num((bud[k] || {})[mm]), 0))}</b></td></tr>)}</Table></Card>
  </>;
}

function Compliance({ r }) {
  const C = r.comp;
  return <>
    <Card title="GST by month"><Table head={<><th>Month</th><th className="n">Output tax</th><th className="n">Less: credit</th><th className="n" title="reverse charge, paid in cash">Add: reverse charge</th><th className="n" title="credit brought in from the month before and not needed now (−), or credit this month left for the next (+)">Credit carried</th><th className="n">Worked out to pay</th><th className="n">Paid from the bank</th></>}>
      {C.gst.map((x) => <tr key={x.ym} data-gst-row={x.ym}><td>{GSTR.label(x.ym)}</td><td className="n">{m(x.out)}</td><td className="n">{m(x.itc)}</td><td className="n" data-rcm="">{x.rcm ? m(x.rcm) : ""}</td><td className="n" data-carry="">{x.carry ? m(x.carry) : ""}</td><td className="n">{m(x.due)}</td><td className="n">{m(x.pay)}</td></tr>)}</Table>
      <p className="note">Output tax, credit and the amount to pay are FinCom's working from the books, not the 3B filed: output tax less credit, plus reverse charge (always paid in cash), plus or minus credit carried between months, is what is worked out to pay. Paid is what the books show paid from the bank to GST payable, the cash ledger or an output or reverse-charge tax ledger, in the month it was paid; the cash flow’s GST line uses the same rule.</p></Card>
    <Card top title="TDS by month"><Table head={<><th>Month</th><th className="n">Deducted (TDS ledgers)</th><th className="n">Paid from the bank</th><th className="n">Challans here</th></>}>
      {C.tds.map((x) => <tr key={x.ym}><td>{GSTR.label(x.ym)}</td><td className="n">{m(x.ded)}</td><td className="n">{m(x.dep)}</td><td className="n">{m(x.challans)}</td></tr>)}</Table>
      <p className="note">From the books: deducted is what the TDS ledgers were credited with, paid what they were debited with from the bank. A month's TDS is paid the next month, and last year's TDS is paid in April, so the two do not match month by month.</p></Card>
    <Card top title="Audit">{C.audit ? <><div className="dash-row"><span>Findings open</span><b>{C.audit.open}</b></div><div className="dash-row"><span>Serious</span><b>{C.audit.high}</b></div><div className="dash-row"><span>Put right</span><b>{C.audit.solved}</b></div></>
      : <p className="note">{(S.books.audit || {}).last ? "The last run no longer fits the books: run it again in Audit." : "Not run yet."}</p>}</Card>
  </>;
}

export default function Mis({ b }) {
  // Tally changed since the last run: the tab says so while it is worked out again (TallyRead.catchUp, src/js/18)
  const catchUp = TallyRead.catchUp(b, "mis");
  if (catchUp) return <CatchUp text={catchUp} />;
  const r0 = (b.mis || {}).last, stale = MIS.stale(b);
  // a saved run from other books or older working: worked out again now, its figures not shown meanwhile
  if (stale && !MIS._again) { MIS._again = true; setTimeout(() => { try { MIS.run(r0.from, r0.to, "worked out again (the books or FinCom changed since " + fmtDate(r0.at.slice(0, 10)) + ")"); saveBooks(); } finally { MIS._again = false; render(); } }, 0); }
  if (stale) return <div className="bk-none" data-mis-again="" style={{ marginTop: 12 }}>{"Working out again: the books or FinCom’s working changed since the run of " + fmtDate(r0.at.slice(0, 10)) + " (result code " + r0.code + ")."}</div>;
  const r = r0;
  // the period: the one chosen (kept for the client), else this financial year to date (smart moves round 1)
  if (!S.misRange) { const k = Smart.recall("mis"); S.misRange = k && k.from && k.to ? k : ((x) => ({ from: Audit.iso(x.from), to: Audit.iso(x.to) }))(misRangeQuick("ytd", b)); }
  const rg = S.misRange;
  // the books in FinCom end before the period starts: one line, not an empty page (nor an older run's figures)
  const end = Smart.booksEndBefore(String(rg.from || "").replace(/-/g, ""));
  const notRead = end && !(r && Audit.iso(r.from) === rg.from && Audit.iso(r.to) === rg.to) ? <NotRead end={end} what={"MIS " + Smart.fyLabelOf(rg.from.replace(/-/g, "")) + " to date"} read={Smart.fyLabelOf(rg.from.replace(/-/g, ""))} show={Smart.fyLabelOf(end)}
    onShow={() => { S.misRange = { from: Audit.iso(Smart.fyStartOf(end)), to: Audit.iso(end) }; Smart.keep("mis", S.misRange); render(); }} /> : null;
  const tab = S.misTab || "summary";
  // the tabs first, at the top of the page (review of 01-Oct-2026), then the period
  const tabs = <nav className="sbar" aria-label="MIS">{TABS.map(([id, l]) => <button key={id} aria-selected={tab === id} onClick={() => misTabGo(id)}>{l}</button>)}</nav>;
  if (notRead) return <>{tabs}<Head b={b} r={r} rg={rg} /><div style={{ marginTop: 12 }}>{notRead}</div></>;
  if (!r) return <>{tabs}<Head b={b} r={r} rg={rg} /><div className="bk-none" style={{ marginTop: 12 }}>Choose a period and press Run now.</div></>;
  const p2 = r.p2;
  let body;
  if (tab === "summary") body = <Summary b={b} r={r} />;
  else if (tab === "pl") body = <ProfitLoss b={b} r={r} />;
  else if (tab === "recv" || tab === "pay") body = <Ageing b={b} r={r} tab={tab} />;
  else if (tab === "sales" || tab === "purch") body = <Parties r={r} tab={tab} />;
  else if (tab === "comp") body = <Compliance r={r} />;
  else if (!p2) body = <p className="note">Run again to see this.</p>;
  else body = tab === "cash" ? <CashFlow b={b} r={r} p2={p2} /> : tab === "ratios" ? <Ratios p2={p2} /> : tab === "regs" ? <Regs r={r} p2={p2} /> : tab === "cc" ? <CostCentres p2={p2} /> : <Budget r={r} />;
  return <>
    {tabs}
    <Head b={b} r={r} rg={rg} /><RunLine r={r} />
    {body}
  </>;
}
