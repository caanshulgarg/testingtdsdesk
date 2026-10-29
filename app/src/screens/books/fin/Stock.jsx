// Stock on the Trial balance & mapping tab (owner, 29-Oct-2026: "what about opening stock"): the opening stock at the start
// of the year, at the start of the period (a part of the year), and the closing stock at its end, each with where it comes
// from (FinSt's d.stock): Tally's Stock-in-hand ledgers when the copy keeps them, else last year's balance sheet as
// uploaded (its Inventories: this year's opening stock), else typed here (FinSt.stockSet: b.fs.stockAt, per client per
// date, with who typed it and when). A figure not known stays not known: the Checks tab asks for it. The P&L's changes in
// inventories are the opening stock at the start of the period less the closing stock; the balance sheet shows the closing.
import CommitBox from "../../../parts/CommitBox.jsx";
import { rs, dmy } from "./util.js";

export default function Stock({ d }) {
  const s = d.stock; if (!s) return null;
  const rows = [["A", "Opening stock at the start of the year"]].concat(s.dates.B !== s.dates.A ? [["B", "Opening stock at the start of the period"]] : [], [["C", "Closing stock"]]);
  const any = rows.some(([k]) => s[k].v != null);
  return <div className="fin-pybs fin-stock" data-fin-stockpanel="">
    <div className="fin-pybs-head"><div><b>Stock</b>
      <p className="note">{s.integrated ? "Tally keeps the stock in its Stock-in-hand ledgers: their balances are used. (The stock items’ own values are not read into FinCom’s copy.)"
        : any ? "Changes in inventories = opening stock at the start of the period less the closing stock; the balance sheet shows the closing stock."
          : "No stock is known for this client. If it holds stock, type it here or upload last year’s balance sheet; nothing is assumed."}</p></div></div>
    <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="stock"><colgroup><col /><col style={{ width: 170 }} /><col /></colgroup>
      <thead><tr><th>Stock</th><th className="n">Amount (₹)</th><th>Where it comes from</th></tr></thead>
      <tbody>{rows.map(([k, label]) => { const z = s[k], dt = s.dates[k], typeable = !s.integrated && z.src !== "upload";
        return <tr key={k} data-fin-stock={dt} data-src={z.src}><td>{label + " (as on " + dmy(dt) + ")"}</td>
          <td className="n">{typeable ? <CommitBox type="number" step="0.01" aria-label={"Stock as on " + dmy(dt)} value={z.v == null ? "" : z.v} placeholder="not known"
            onCommit={(v) => { FinSt.stockSet(dt, v === "" ? null : +v); toast(v === "" ? "Stock as on " + dmy(dt) + " forgotten." : "Stock as on " + dmy(dt) + ": " + rs(+v) + ", kept."); render(); }} />
            : z.v == null ? "not known" : rs(z.v)}</td>
          <td className={z.v == null ? "fin-bad" : "note"} data-fin-stocksrc="">{z.label}</td></tr>; })}</tbody></table></div>
  </div>;
}
