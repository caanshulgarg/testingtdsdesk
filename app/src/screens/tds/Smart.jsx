// Smarter TDS (the owner's list of 10-Oct-2026, group 2), under the TDS year's grid and on a return's To fix:
//   - T-A4 the TDS payable ledgers in Tally against deducted less challans, quarter by quarter (TDSTie, src/js/65);
//   - T-S1 each party's running total against the TDS limit (TDSWatch); the parties over it whose payments TDS does not
//     cover are the Audit's finding only (the owner, 19-Oct-2026);
//   - T-S2 a filed return whose entries changed in Tally since: the correction needed (TDSDrift).
// Nothing here changes a figure; "Correction filed" asks first and only takes the copy again.
import ListTable from "../../parts/ListTable.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => fmtDate(tallyDate(TDS.ymd(d)));

// T-A4
export function TieOut({ fy }) {
  const qs = TDSTie.quarters(fy).filter((x) => x.deducted || x.challans || x.moved || x.paidBooks), bad = qs.filter((x) => !x.ok);
  if (!qs.length) return null;
  return <section className="dash-card" style={{ marginTop: 12 }} data-tieout={fy}>
    <h3>TDS payable in Tally, quarter by quarter</h3>
    <p className="note">The TDS ledgers in Tally should move by the TDS deducted less the challans deposited. {bad.length ? bad.length + " quarter" + (bad.length === 1 ? " differs" : "s differ") + "." : "Every quarter agrees."}</p>
    <div className="bk-tablewrap"><table className="bk-table" data-statement="">
      <thead><tr><th>Quarter</th><th className="n">TDS deducted</th><th className="n">Challans</th><th className="n">Should move by</th><th className="n">Moved in Tally</th><th className="n">Difference</th><th className="n">Paid in Tally</th></tr></thead>
      <tbody>{qs.map((x) => <tr key={x.q} data-tie={x.q}>
        <td>{x.q}{!x.ok && <div className="nr bad">{TDSTie.why(x).join(" ")}</div>}</td>
        <td className="n">{money(x.deducted)}</td><td className="n">{money(x.challans)}</td><td className="n">{money(x.should)}</td><td className="n">{money(x.moved)}</td>
        <td className={"n" + (Math.abs(x.gap) >= 1 ? " bad" : "")}>{Math.abs(x.gap) >= 1 ? money(x.gap) : "—"}</td>
        <td className={"n" + (Math.abs(x.chGap) >= 1 ? " bad" : "")}>{money(x.paidBooks)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}

// T-S1
export function Limits({ fy }) {
  // the owner, 19-Oct-2026: no "Should have deducted" list nor "TDS short" here (a bill's TDS is often booked in a journal of
  // its own): the TDS not deducted is the Audit's finding alone (Audit.checks.tdsMissed, src/js/06)
  const list = TDSWatch.tracker(fy);
  if (!list.length) return null;
  return <section className="dash-card" style={{ marginTop: 12 }} data-limits={fy}>
    <h3>Parties and the TDS limits, {fy}</h3>
    <p className="note">Each party's payments this year by kind, from the day book, against the limit above which TDS applies. Those at 80% of the limit or over it.</p>
    <ListTable name="tdsLimits" rows={list} rowKey={(x) => x.party + "|" + x.rule} unit={["party", "parties"]}
      cols={[
        { k: "party", role: "party", label: "Party", v: (x) => x.party, cell: (x) => <>{x.party}<div className="nr">{x.ledgers.slice(0, 2).join(", ")}</div></> },
        { k: "credited", role: "amount", label: "Paid this year", cls: "n", v: (x) => x.credited, fmt: money, cell: (x) => money(x.credited) },
        { k: "st", role: "status", label: "Limit", v: (x) => x.used, cell: (x) => <span className={"tag " + (x.over ? "info" : "warn")}>{x.over ? "Over the limit" : Math.floor(x.used) + "% of the limit"}</span> },
        { k: "sec", label: "Kind", v: (x) => x.section, cell: (x) => <>{x.section}<div className="nr">{x.label} · {x.limitWords}</div></> },
        { k: "tds", label: "TDS deducted", cls: "n", v: (x) => x.tds, sum: true, fmt: money, cell: (x) => money(x.tds) },
      ]} />
  </section>;
}

// T-S2: on a filed return's Errors to fix
export function Correction({ fy, q, form, drift }) {
  if (!drift || !drift.rows.length) return null;
  return <section className="dash-card bad" style={{ marginBottom: 12 }} data-correction={form + "|" + q}>
    <h3>Correction needed: {drift.rows.length} entr{drift.rows.length === 1 ? "y" : "ies"} changed in Tally since filing</h3>
    <p className="note">The return was filed as the books stood on {fmtDateTime(drift.at)}. File a correction statement with these changes (C3: a deductee row added, changed or set to nil; C5: a PAN).</p>
    <ListTable name="tdsDrift" rows={drift.rows} rowKey={(x) => x.id + ":" + x.what} unit={["change", "changes"]}
      cols={[
        { k: "party", role: "party", label: "Deductee", v: (x) => x.party, cell: (x) => x.party },
        { k: "tds", role: "amount", label: "TDS now", cls: "n", v: (x) => x.tds, fmt: money, cell: (x) => money(x.tds) },
        { k: "what", role: "status", label: "In Tally", v: (x) => x.what, cell: (x) => <span className={"tag " + (x.what === "deleted" ? "bad" : "warn")}>{x.what}</span> },
        { k: "type", label: "Correction", v: (x) => x.type, cell: (x) => x.type },
        { k: "words", label: "What changed", cell: (x) => x.words },
      ]} />
    <div className="row" style={{ marginTop: 8 }}><button className="btn small" data-corrected="" onClick={() => TDSDrift.corrected(fy, q, form)}>Correction filed</button></div>
  </section>;
}
