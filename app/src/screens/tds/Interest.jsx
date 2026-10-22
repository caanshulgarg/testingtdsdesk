// next-tds-interest (the owner, 20-Oct-2026): Validate & file's "Interest & fee" section, for every form (26Q, 27Q, 27EQ,
// 24Q). next-tds-interest2 (his follow-up: "figures are showing two times"): one compact section, each figure once:
//   1. the interest table: one row a deduction with interest: who, the section, the tax, the date paid or credited (when
//      the tax was due to be deducted), the date deducted, the challan, the months at 1% (deducted late) and at 1.5% (paid
//      late; TCS 1% under 206C(7)), the interest; a total only when there are two rows or more;
//   2. one summary: each challan's interest due, allocated to this return and its status, and the late fee under 234E (due,
//      allocated on the Challans grid's "Fee 234E allocated", status) with one line under it (the days, ₹200 a day, the
//      cap; 271H in its hover). Status: "Covered ✓" (more than due: a small note), "Within ₹10" (TDS.MIN_WARN: no warning),
//      else "₹x short" ("Not allocated" while none is: the figure due is beside it).
// Nothing is worked out here: the figures are TDSMatch.interestTable's (src/js/86: TDS.interest, TDS.lateFee, TDSReg).
const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const chW = (c) => (c ? c.serial + " · " + day(c.date) : "");

// the status of a figure due against what is allocated
function Status({ due, alloc }) {
  const short = r2(due - alloc);
  if (short <= 0.005) return <span className="ok" data-status="covered">Covered ✓{short < -0.005 && <small className="note vf-snote">{money(-short)} more than due</small>}</span>;
  if (!TDSMatch.warnShort(short)) return <span className="note" data-status="within">Within ₹10</span>;
  return <span className="bad" data-status="short">{alloc > 0.005 ? money(short) + " short" : "Not allocated"}</span>;
}

export function InterestFee({ fy, q, form }) {
  let t = null;
  try { t = TDSMatch.interestTable(form, fy, q); } catch (e) { return null; }
  const tcs = form === "27EQ", fee = t.fee, T = t.totals, cols = tcs ? 7 : 8;
  const who = tcs ? "Buyer" : form === "24Q" ? "Employee" : "Deductee";
  const chs = t.perChallan.filter((x) => x.due > 0 || x.allocated > 0);
  const p271 = fee && (fee.p271h ? (t.filed ? "Filed more than " + (fee.penaltyIn || "a year") + " after the due date" : "Not filed by " + day(fee.penaltyBy) + ", " + (fee.penaltyIn || "a year") + " after the due date") + ": a penalty of ₹10,000 to ₹1,00,000 can be levied under 271H."
    : fee && fee.days > 0 && !t.filed ? "File by " + day(fee.penaltyBy) + " with the tax, fee and interest paid, and no penalty under 271H can be levied." : "");
  return <div className="vf-int" data-int-sec={form}>
    <h4 className="vf-h">Interest &amp; fee</h4>
    {t.rows.length ? <div className="bk-tablewrap"><table className="bk-table vf-itable" data-int-table="">
      <thead><tr><th>{who}</th><th>Section</th><th className="n">Amount ({tcs ? "TCS" : "TDS"})</th>{!tcs && <th className="dt">Paid/credited on</th>}<th className="dt">{tcs ? "Collected on" : "Deducted on"}</th>
        <th>Challan</th>{!tcs && <th className="n">Months at 1%</th>}<th className="n">{tcs ? "Months at 1%" : "Months at 1.5%"}</th><th className="n">Interest</th></tr></thead>
      <tbody>{t.rows.map((r) => <tr key={r.id} data-int-row={r.id} data-amt={r.interest}>
        <td>{r.row.party || r.row.employee}</td><td>{TDS.sec(r.row.section || "") || (form === "24Q" ? "192" : "")}</td><td className="n">{money(r.row.tds)}</td>
        {!tcs && <td className="dt" data-int-credit="">{day(r.from || r.row.credit || r.row.date)}</td>}<td className="dt">{day(r.row.date)}</td>
        <td>{r.unpaid ? <span className="bad">not paid · due {day(r.due)}</span> : chW(r.challan)}</td>
        {!tcs && <td className="n">{r.months1 || ""}</td>}<td className="n">{r.months2 || ""}</td><td className="n">{money(r.interest)}</td></tr>)}</tbody>
      {t.rows.length > 1 && <tfoot><tr><td colSpan={cols}>Total interest {tcs ? "206C(7)" : "201(1A)"}</td><td className="n" data-int-total={T.interest}>{money(T.interest)}</td></tr></tfoot>}
    </table></div> : <p className="note" data-int-none="">Nothing was {tcs ? "collected or paid" : "deducted or paid"} late: no interest.</p>}
    {(chs.length > 0 || T.feeDue > 0 || T.feeAllocated > 0) && <div className="bk-tablewrap"><table className="bk-table vf-itable" data-int-chs="">
      <thead><tr><th>Challan</th><th className="n">Interest due</th><th className="n">Fee due</th><th className="n">Allocated to this return</th><th>Status</th></tr></thead>
      <tbody>{chs.map((x) => <tr key={x.c.id} data-int-ch={x.c.id} data-due={x.due} data-alloc={x.allocated} data-diff={x.diff}>
        <td>{chW(x.c)}</td><td className="n">{money(x.due)}</td><td className="n"></td><td className="n">{money(x.allocated)}</td><td><Status due={x.due} alloc={x.allocated} /></td></tr>)}
        {(T.feeDue > 0 || T.feeAllocated > 0) && <tr data-int-fee={T.feeDue} data-fee-alloc={T.feeAllocated} title={p271 || undefined}>
          <td>Late fee 234E{fee && fee.days > 0 && <small className="note vf-snote" data-int-feenote="">{fee.days} day{fee.days === 1 ? "" : "s"} past {day(fee.due)} at ₹200/day, capped at the quarter's tax{t.filed ? " (filed " + day(t.filed.on) + ")" : ""}</small>}</td>
          <td className="n"></td><td className="n">{money(T.feeDue)}</td><td className="n">{money(T.feeAllocated)}</td><td><Status due={T.feeDue} alloc={T.feeAllocated} /></td></tr>}</tbody>
    </table></div>}
  </div>;
}
