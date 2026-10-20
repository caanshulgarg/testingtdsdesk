// next-tds-interest (the owner, 20-Oct-2026): Validate & file's "Interest & fee" section, for every form (26Q, 27Q, 27EQ,
// 24Q). One row a deduction with interest: who, the section, the tax, the date deducted and the date it was due to be
// deducted (the bill), the challan, the months at 1% (deducted late) and at 1.5% (paid late; TCS 1% under 206C(7)), the
// interest; the late fee under 234E (and 271H past a year), what to pay with the next challan; then by challan, the interest due, allocated to this return and the difference.
// Nothing is worked out here: the figures are TDSMatch.interestTable's (src/js/86: TDS.interest, TDS.lateFee, TDSReg).
const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const chW = (c) => (c ? c.serial + " · " + day(c.date) : "");

export function InterestFee({ fy, q, form }) {
  let t = null;
  try { t = TDSMatch.interestTable(form, fy, q); } catch (e) { return null; }
  const tcs = form === "27EQ", fee = t.fee, feeNow = fee && fee.days > 0 ? fee.fee : 0, cols = tcs ? 7 : 8;
  const toPay = r2(Math.max(0, t.totals.interest - t.totals.allocated) + (t.filed ? 0 : feeNow));
  const who = tcs ? "Buyer" : form === "24Q" ? "Employee" : "Deductee";
  return <div className="vf-int" data-int-sec={form}>
    <h4 className="vf-h">Interest &amp; fee</h4>
    {t.rows.length ? <div className="bk-tablewrap"><table className="bk-table vf-itable" data-int-table="">
      <thead><tr><th>{who}</th><th>Section</th><th className="n">Amount ({tcs ? "TCS" : "TDS"})</th><th className="dt">{tcs ? "Collected on" : "Deducted on"}</th>
        {!tcs && <th className="dt">Due to deduct</th>}<th>Challan</th>{!tcs && <th className="n">Months at 1%</th>}<th className="n">{tcs ? "Months at 1%" : "Months at 1.5%"}</th><th className="n">Interest</th></tr></thead>
      <tbody>{t.rows.map((r) => <tr key={r.id} data-int-row={r.id} data-amt={r.interest}>
        <td>{r.row.party || r.row.employee}</td><td>{TDS.sec(r.row.section || "") || (form === "24Q" ? "192" : "")}</td><td className="n">{money(r.row.tds)}</td><td className="dt">{day(r.row.date)}</td>
        {!tcs && <td className="dt">{day(r.from)}</td>}
        <td>{r.unpaid ? <span className="bad">not paid · due {day(r.due)}</span> : chW(r.challan)}</td>
        {!tcs && <td className="n">{r.months1 || ""}</td>}<td className="n">{r.months2 || ""}</td><td className="n">{money(r.interest)}</td></tr>)}</tbody>
      <tfoot><tr><td colSpan={cols}>Total interest {tcs ? "206C(7)" : "201(1A)"}</td><td className="n" data-int-total={t.totals.interest}>{money(t.totals.interest)}</td></tr></tfoot>
    </table></div> : <p className="note" data-int-none="">Nothing was {tcs ? "collected or paid" : "deducted or paid"} late: no interest.</p>}
    <p className="vf-fee" data-int-fee={feeNow}>
      <span>Late fee 234E</span>
      <span className="note">{fee && fee.days > 0
        ? (t.filed ? "filed on " + day(t.filed.on) : "if filed today") + ": " + fee.days + " day" + (fee.days === 1 ? "" : "s") + " past " + day(fee.due) + " at ₹200 a day, capped at the quarter's tax " + money(fee.cap)
        : fee ? (t.filed ? "filed by the due date " : "not due before ") + day(fee.due) : "no tax this quarter"}</span>
      <b>{money(feeNow)}</b></p>
    {fee && (fee.p271h || (!t.filed && fee.days > 0)) && <p className={"note" + (fee.p271h ? " bad" : "")} data-271h="">{fee.p271h
      ? (t.filed ? "Filed more than a year after the due date" : "Not filed by " + day(fee.penaltyBy) + ", a year after the due date") + ": a penalty of ₹10,000 to ₹1,00,000 can be levied under 271H."
      : "File by " + day(fee.penaltyBy) + " with the tax, fee and interest paid, and no penalty under 271H can be levied."}</p>}
    {toPay > 0 && <p className="vf-fee" data-next-challan=""><span>Pay with the next challan</span><span className="note">interest not yet on this return's challans{t.filed ? "" : " and the late fee"}</span><b>{money(toPay)}</b></p>}
    {t.perChallan.some((x) => x.due > 0 || x.allocated > 0) && <div className="bk-tablewrap"><table className="bk-table vf-itable" data-int-chs="">
      <thead><tr><th>Challan</th><th className="n">Interest due</th><th className="n">Allocated to this return</th><th className="n">Difference</th></tr></thead>
      <tbody>{t.perChallan.filter((x) => x.due > 0 || x.allocated > 0).map((x) => <tr key={x.c.id} data-int-ch={x.c.id} data-due={x.due} data-alloc={x.allocated} data-diff={x.diff}>
        <td>{chW(x.c)}</td><td className="n">{money(x.due)}</td><td className="n">{money(x.allocated)}</td><td className={"n" + (x.diff >= 1 ? " bad" : "")}>{money(x.diff)}</td></tr>)}</tbody>
      <tfoot><tr><td>Total</td><td className="n">{money(t.totals.due)}</td><td className="n">{money(t.totals.allocated)}</td><td className={"n" + (t.totals.short >= 1 ? " bad" : "")}>{money(r2(t.totals.due - t.totals.allocated))}</td></tr></tfoot>
    </table></div>}
  </div>;
}
