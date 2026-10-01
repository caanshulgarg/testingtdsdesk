// fast-sync (review of 01-Oct-2026): MIS, and the TDS and GST summaries, as the database works them out from the cloud
// copy (TCloud.report; migration-14: tally_mis, tally_tds_summary, tally_gst_summary). Shown while this computer does
// not have the books in yet (a new computer, or one still bringing them in): the figures come in a moment, not after
// every entry is downloaded. With the books in, the full MIS, TDS and GST screens take over as before.
const m = (v) => INR.format(r2(v || 0));
const d8 = (iso) => String(iso || "").replace(/-/g, "");
const Tile = ({ l, v, sub }) => <div className="dtile"><span>{l}</span><b>{v}</b><small>{sub || ""}</small></div>;
const HEADS = [["rev", "Revenue from operations"], ["oth", "Other income"], ["pur", "Purchases"], ["dir", "Direct expenses"], ["emp", "Employee costs"], ["exp", "Other expenses"], ["fin", "Finance costs"], ["dep", "Depreciation"], ["tax", "Tax"]];

function period(cid) {
  const fy = TCloud.fyOf(cid), r = S.misRange;
  return r && r.from && r.to ? { from: d8(r.from), to: d8(r.to) } : fy;
}
function Wait({ x, what }) {
  if (x.missing) return <p className="note">The server cannot work out {what} yet (its database is being updated). It shows here once the books are in on this computer.</p>;
  if (x.err) return <p className="note bad">Could not ask the server for {what}: {x.err}</p>;
  return <p className="note" data-srv-wait>Asking the server for {what}…</p>;
}
const Src = ({ x }) => <p className="note" style={{ margin: "6px 0 0" }} data-srv-src>Worked out by the server from the copy of the books in FinCom’s cloud{x.ms != null ? " in " + (x.ms / 1000).toFixed(1) + " s" : ""}; the full MIS with every detail follows when the books are in on this computer.</p>;

export function ServerMis({ b }) {
  const cid = b.cid, p = period(cid), x = TCloud.report("mis", cid, p.from, p.to), r = x.res;
  const head = <section className="dash-card"><h3>MIS</h3>
    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <label className="note">From <input type="date" aria-label="MIS from" value={Audit.iso(p.from)} onChange={(ev) => { S.misRange = { from: ev.target.value, to: Audit.iso(p.to) }; render(); }} /></label>
      <label className="note">to <input type="date" aria-label="MIS to" value={Audit.iso(p.to)} onChange={(ev) => { S.misRange = { from: Audit.iso(p.from), to: ev.target.value }; render(); }} /></label></div></section>;
  if (!r) return <>{head}<Wait x={x} what="the MIS" /></>;
  if (r.none) return <>{head}<p className="note">The cloud has no copy of this client’s books for this period.</p></>;
  const H = r.heads || {}, months = r.months || [], cols = months.length <= 12;
  return <div data-srv-mis>
    {head}
    {!r.grouped && <p className="bk-alert" role="status" style={{ margin: "10px 0" }}>The ledgers’ groups are not in the cloud copy yet, so the profit and loss cannot be worked out. They come with the ledgers from Tally (FinCom Tally Bridge 1.14.7 or later).</p>}
    <div className="dash-tiles" style={{ marginTop: 12 }}>
      <Tile l="Sales, the period" v={m(r.sales.total)} sub={r.sales.other ? "other income " + m(r.sales.other) : ""} />
      <Tile l="Profit before tax" v={r.grouped ? m(r.pbt.t) : "—"} sub={"gross profit " + m(r.gross.t) + (H.rev && H.rev.t ? " (" + (Math.round(r.gross.t / H.rev.t * 1000) / 10) + "% of revenue)" : "")} />
      <Tile l="Owed to you" v={m(r.recv.owed)} sub={"on " + fmtDate(tallyDate(r.to)) + (r.recv.advance >= 1 ? " · advance from customers " + m(r.recv.advance) : "")} />
      <Tile l="You owe" v={m(r.pay.owe)} sub={"on " + fmtDate(tallyDate(r.to)) + (r.pay.advance >= 1 ? " · advance to suppliers " + m(r.pay.advance) : "")} />
    </div>
    <section className="dash-card" style={{ marginTop: 12 }}><h3>Profit and loss</h3>
      <div className="bk-tablewrap"><table className="bk-table" id="srvPl"><thead><tr><th></th>{cols && months.map((mm) => <th key={mm} className="n">{GSTR.label(mm).replace(/[-\s]\d{4}$/, "")}</th>)}<th className="n">Total</th></tr></thead><tbody>
        {HEADS.filter(([k]) => H[k]).map(([k, l]) => <tr key={k}><td>{l}</td>{cols && months.map((mm) => <td key={mm} className="n">{m((H[k].m || {})[mm])}</td>)}<td className="n">{m(H[k].t)}</td></tr>)}
        {[["gross", "Gross profit"], ["pbt", "Profit before tax"]].map(([k, l]) => <tr key={k}><td><b>{l}</b></td>{cols && months.map((mm) => <td key={mm} className="n"><b>{m((r[k].m || {})[mm])}</b></td>)}<td className="n"><b>{m(r[k].t)}</b></td></tr>)}
      </tbody></table></div></section>
    <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginTop: 12 }}>
      <section className="dash-card" style={{ flex: "1 1 320px" }}><h3>Sales by customer</h3>
        {(r.sales.rows || []).slice(0, 10).map((x, i) => <div key={i} className="dash-row"><span>{x.party || "—"}</span><b>{m(x.t)}</b></div>)}</section>
      <section className="dash-card" style={{ flex: "1 1 320px" }}><h3>{"Cash and bank on " + fmtDate(tallyDate(r.to))}</h3>
        {(r.cash.rows || []).filter((x) => Math.abs(x.bal) >= 1).map((x, i) => <div key={i} className="dash-row"><span>{x.l}</span><b className={x.bal < 0 ? "bad" : ""}>{m(x.bal)}</b></div>)}
        <div className="dash-row"><span><b>Total</b></span><b>{m(r.cash.total)}</b></div></section>
    </div>
    <Src x={x} />
  </div>;
}

export function ServerTds({ b }) {
  const cid = b.cid, p = TCloud.fyOf(cid), x = TCloud.report("tds", cid, p.from, p.to), r = x.res;
  if (!r) return <section className="dash-card"><h3>TDS, from the server</h3><Wait x={x} what="the TDS summary" /></section>;
  if (r.none) return null;
  return <section className="dash-card" data-srv-tds><h3>{"TDS, " + fmtDate(tallyDate(r.from)) + " to " + fmtDate(tallyDate(r.to))}</h3>
    {!r.mapped ? <p className="note">No ledger is marked as TDS or TCS yet in the client’s ledger list.</p> : <>
      <div className="dash-tiles"><Tile l="Deducted" v={m(r.deducted)} sub="TDS and TCS payable ledgers" /><Tile l="Paid" v={m(r.paid)} sub="to the government" /><Tile l="Receivable" v={m(r.receivable)} sub="deducted by customers" /></div>
      <div className="bk-tablewrap"><table className="bk-table" id="srvTds"><thead><tr><th>Ledger</th><th className="n">Opening</th><th className="n">Deducted</th><th className="n">Paid</th><th className="n">Closing</th></tr></thead><tbody>
        {r.ledgers.map((l) => <tr key={l.l}><td>{l.l}</td><td className="n">{m(l.open)}</td><td className="n">{m(l.deducted)}</td><td className="n">{m(l.paid)}</td><td className="n">{m(l.close)}</td></tr>)}</tbody></table></div></>}
    <Src x={x} /></section>;
}

export function ServerGst({ b }) {
  const cid = b.cid, p = TCloud.fyOf(cid), x = TCloud.report("gst", cid, p.from, p.to), r = x.res;
  if (!r) return <section className="dash-card"><h3>GST, from the server</h3><Wait x={x} what="the GST summary" /></section>;
  if (r.none) return null;
  const sum = (o) => r2((o.CGST || 0) + (o.SGST || 0) + (o.IGST || 0) + (o.CESS || 0));
  return <section className="dash-card" data-srv-gst><h3>{"GST by month, " + fmtDate(tallyDate(r.from)) + " to " + fmtDate(tallyDate(r.to))}</h3>
    {!r.mapped ? <p className="note">No ledger is marked as GST yet in the client’s ledger list.</p> :
      <div className="bk-tablewrap"><table className="bk-table" id="srvGst"><thead><tr><th>Month</th><th className="n">Taxable sales</th><th className="n">Output tax</th><th className="n">Input tax</th><th className="n">Reverse charge</th><th className="n">Net</th></tr></thead><tbody>
        {r.months.map((x2) => <tr key={x2.ym}><td>{GSTR.label(x2.ym)}</td><td className="n">{m(x2.taxableSales)}</td><td className="n">{m(sum(x2.out))}</td><td className="n">{m(sum(x2.in))}</td><td className="n">{m(x2.rcmOut)}</td><td className="n">{m(sum(x2.out) + x2.rcmOut - sum(x2.in))}</td></tr>)}</tbody></table></div>}
    <p className="note" style={{ margin: "6px 0 0" }}>From the GST ledgers as confirmed in the client’s ledger list; the returns themselves (GSTR-1, 3B) are worked out when the books are in on this computer.</p>
    <Src x={x} /></section>;
}
