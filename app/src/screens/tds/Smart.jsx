// Smarter TDS (the owner's list of 10-Oct-2026, group 2), under the TDS year's grid and on a return's Errors to fix:
//   - T-A4 the TDS payable ledgers in Tally against deducted less challans, quarter by quarter (TDSTie, src/js/65);
//   - T-S1 each party's running total against the TDS limit, and the parties over it whose payments TDS does not cover:
//     the TDS due, interest and the 40(a)(ia) amount at risk (TDSWatch);
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
  const list = TDSWatch.tracker(fy), missed = TDSWatch.missed(fy);
  if (!list.length) return null;
  const sum = (k) => r2(missed.reduce((a, x) => a + x[k], 0));
  return <section className="dash-card" style={{ marginTop: 12 }} data-limits={fy}>
    <h3>Parties and the TDS limits, {fy}</h3>
    <p className="note">Each party's payments this year by kind, from the day book, against the limit above which TDS applies. Those at 80% of the limit or over it.</p>
    <ListTable name="tdsLimits" rows={list} rowKey={(x) => x.party + "|" + x.rule} unit={["party", "parties"]}
      cols={[
        { k: "party", role: "party", label: "Party", v: (x) => x.party, cell: (x) => <>{x.party}<div className="nr">{x.ledgers.slice(0, 2).join(", ")}</div></> },
        { k: "credited", role: "amount", label: "Paid this year", cls: "n", v: (x) => x.credited, fmt: money, cell: (x) => money(x.credited) },
        { k: "st", role: "status", label: "Limit", v: (x) => x.used, cell: (x) => <span className={"tag " + (x.over ? (x.due >= 1 ? "bad" : "ok") : "warn")}>{x.over ? (x.due >= 1 ? "Over: TDS short" : "Over: TDS deducted") : Math.floor(x.used) + "% of the limit"}</span> },
        { k: "sec", label: "Kind", v: (x) => x.section, cell: (x) => <>{x.section}<div className="nr">{x.label} · {x.limitWords}</div></> },
        { k: "tds", label: "TDS deducted", cls: "n", v: (x) => x.tds, sum: true, fmt: money, cell: (x) => money(x.tds) },
      ]} />
    {missed.length > 0 && <>
      <h3 style={{ marginTop: 14 }} data-missed="">Should have deducted: {missed.length} part{missed.length === 1 ? "y" : "ies"}, TDS {money(sum("due"))}</h3>
      <p className="note">Over the limit, with payments no TDS entry covers. Deduct it from the next payment and deposit it with the interest; paid before the return's due date, the expense is allowed this year.</p>
      <ListTable name="tdsMissed" rows={missed} rowKey={(x) => x.party + "|" + x.rule} unit={["party", "parties"]}
        cols={[
          { k: "party", role: "party", label: "Party", v: (x) => x.party, cell: (x) => <>{x.party}<div className="nr">{x.pan ? "PAN " + x.pan : "no PAN in Tally: 20% (206AA)"}</div></> },
          { k: "uncovered", role: "amount", label: "Not covered by TDS", cls: "n", v: (x) => x.uncovered, sum: true, fmt: money, cell: (x) => money(x.uncovered) },
          { k: "due", role: "amount", label: "TDS due", cls: "n", v: (x) => x.due, sum: true, fmt: money, td: () => ({ className: "bad" }), cell: (x) => <>{money(x.due)}<div className="nr">{x.section} at {x.rate}%</div></> },
          { k: "interest", label: "Interest to today (1% a month)", cls: "n", v: (x) => x.interest, sum: true, fmt: money, cell: (x) => money(x.interest) },
          { k: "disallow", label: "At risk, 40(a)(ia) (30%)", cls: "n", v: (x) => x.disallow, sum: true, fmt: money, cell: (x) => money(x.disallow) },
        ]} /></>}
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
