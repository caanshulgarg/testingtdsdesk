// next-tds-interest (the owner, 20-Oct-2026): a return's interest and late fee, for every form (26Q, 27Q, 27EQ, 24Q).
// next-tds-interest2 (his follow-up: "figures are showing two times"): each figure once. next-tds-validate-short (25-Oct-
// 2026: "all calculations of interest should be there if we click late payment interest in warning.. check it"): no longer
// on the page; Validate & file's "Interest ₹x due · Details" (and More checks › Interest & late fee) opens this, the whole
// working, every figure traceable:
//   1. one row a deduction with interest: who, the section, the tax, the date paid or credited (when the tax was to be
//      deducted), the date deducted, the challan it was deposited on ("not paid" to today) and the date it was due, the
//      months at 1% (deducted late: credit to deduction) and that interest, the months at 1.5% (paid late:
//      deduction to deposit; TCS 1% under 206C(7)) and that interest, the interest; the totals of each column (two rows or more);
//   2. each challan's interest due, allocated to this return and its status, and the late fee under 234E (due, allocated on
//      the Challans grid's "Fee 234E allocated", status);
//   3. the sum: the whole interest (the warning's figure) = on this return's challans + on deductions not yet paid (to
//      today); allocated, not allocated (the warning's second figure); the 234E fee: its days, ₹200 a day, the cap; and the
//      rule as FinCom works it out.
// Status: "Covered ✓" (more than due: a small note), "Within ₹10" (TDS.MIN_WARN: no warning), else "₹x short" ("Not
// allocated" while none is). Nothing is worked out here: the figures are TDSMatch.interestTable's (src/js/86: TDS.interest,
// TDS.lateFee, TDSReg).
const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const chW = (c) => (c ? c.serial + " · " + day(c.date) : "");
const pct = (v) => r2(v) + "%";

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
  const tcs = form === "27EQ", fee = t.fee, T = t.totals, r1 = tcs ? 1 : 1.5, sec = tcs ? "206C(7)" : "201(1A)";
  const who = tcs ? "Buyer" : form === "24Q" ? "Employee" : "Deductee";
  const chs = t.perChallan.filter((x) => x.due > 0 || x.allocated > 0);
  const p271 = fee && (fee.p271h ? (t.filed ? "Filed more than " + (fee.penaltyIn || "a year") + " after the due date" : "Not filed by " + day(fee.penaltyBy) + ", " + (fee.penaltyIn || "a year") + " after the due date") + ": a penalty of ₹10,000 to ₹1,00,000 can be levied under 271H."
    : fee && fee.days > 0 && !t.filed ? "File by " + day(fee.penaltyBy) + " with the tax, fee and interest paid, and no penalty under 271H can be levied." : "");
  const sum = (f) => r2(t.rows.reduce((a, r) => a + num(r[f]), 0));
  // the 234E working: from the day after the due date to the date filed (today while not filed)
  const d1 = fee && fee.due ? (() => { const d = new Date(Date.UTC(+fee.due.slice(0, 4), +fee.due.slice(4, 6) - 1, +fee.due.slice(6, 8) + 1)); return d.toISOString().slice(0, 10).replace(/-/g, ""); })() : "";
  return <div className="vf-int" data-int-sec={form}>
    <h4 className="vf-h">Interest &amp; fee</h4>
    {t.rows.length ? <div className="bk-tablewrap"><table className="bk-table vf-itable" data-int-table="">
      <thead><tr><th>{who}</th><th>Section</th><th className="n">Amount ({tcs ? "TCS" : "TDS"})</th>{!tcs && <th className="dt">Paid/credited on</th>}<th className="dt">{tcs ? "Collected on" : "Deducted on"}</th>
        <th className="dt">Challan · deposited on</th>{!tcs && <th className="n">Months at 1%</th>}{!tcs && <th className="n">At 1%</th>}<th className="n">{tcs ? "Months at 1%" : "Months at 1.5%"}</th><th className="n">At {pct(r1)}</th><th className="n">Interest</th></tr></thead>
      <tbody>{t.rows.map((r) => <tr key={r.id} data-int-row={r.id} data-amt={r.interest} data-int1={r.int1} data-int2={r.int2} title={(r.int1 ? money(r.row.tds) + " × 1% × " + r.months1 + " = " + money(r.int1) : "") + (r.int1 && r.int2 ? "; " : "") + (r.int2 ? money(r.row.tds) + " × " + pct(r.rate2 || r1) + " × " + r.months2 + " = " + money(r.int2) : "")}>
        <td>{r.row.party || r.row.employee}</td><td>{TDS.sec(r.row.section || "") || (form === "24Q" ? "192" : "")}</td><td className="n">{money(r.row.tds)}</td>
        {!tcs && <td className="dt" data-int-credit="">{day(r.from || r.row.credit || r.row.date)}</td>}<td className="dt">{day(r.row.date)}</td>
        <td className="dt" data-int-dep=""><span>{r.unpaid ? <span className="bad">not paid · to {day(r.to)}</span> : r.challan ? chW(r.challan) : ""}{r.due ? <small className="note"> · due {day(r.due)}</small> : null}</span></td>
        {!tcs && <td className="n">{r.months1 || ""}</td>}{!tcs && <td className="n">{r.int1 ? money(r.int1) : ""}</td>}<td className="n">{r.months2 || ""}</td><td className="n">{r.int2 ? money(r.int2) : ""}</td><td className="n">{money(r.interest)}</td></tr>)}</tbody>
      {t.rows.length > 1 && <tfoot><tr><td colSpan={tcs ? 5 : 7}>Total interest {sec}</td>{!tcs && <td className="n">{money(sum("int1"))}</td>}<td></td><td className="n">{money(sum("int2"))}</td><td className="n" data-int-rows-total={T.interest}>{money(T.interest)}</td></tr></tfoot>}
    </table></div> : <p className="note" data-int-none="">Nothing was {tcs ? "collected or paid" : "deducted or paid"} late: no interest.</p>}
    {(chs.length > 0 || T.feeDue > 0 || T.feeAllocated > 0) && <div className="bk-tablewrap"><table className="bk-table vf-itable" data-int-chs="">
      <thead><tr><th>Challan</th><th className="n">Interest due</th><th className="n">Fee due</th><th className="n">Allocated to this return</th><th>Status</th></tr></thead>
      <tbody>{chs.map((x) => <tr key={x.c.id} data-int-ch={x.c.id} data-due={x.due} data-alloc={x.allocated} data-diff={x.diff}>
        <td>{chW(x.c)}</td><td className="n">{money(x.due)}</td><td className="n"></td><td className="n">{money(x.allocated)}</td><td><Status due={x.due} alloc={x.allocated} /></td></tr>)}
        {(T.feeDue > 0 || T.feeAllocated > 0) && <tr data-int-fee={T.feeDue} data-fee-alloc={T.feeAllocated} title={p271 || undefined}>
          <td>Late fee 234E{fee && fee.days > 0 && <small className="note vf-snote" data-int-feenote="">{fee.days} day{fee.days === 1 ? "" : "s"} past {day(fee.due)} at ₹200/day, capped at the quarter's tax{t.filed ? " (filed " + day(t.filed.on) + ")" : ""}</small>}</td>
          <td className="n"></td><td className="n">{money(T.feeDue)}</td><td className="n">{money(T.feeAllocated)}</td><td><Status due={T.feeDue} alloc={T.feeAllocated} /></td></tr>}</tbody>
    </table></div>}
    <dl className="vf-isum" data-int-sum="">
      <dt>Interest {sec}</dt><dd data-int-total={T.interest}><b>{money(T.interest)}</b></dd>
      <dt>on this return’s challans</dt><dd data-int-due={T.due}>{money(T.due)} · allocated {money(T.allocated)} · <span className={TDSMatch.warnShort(T.short) ? "bad" : ""} data-int-short={T.short}>not allocated {money(T.short)}</span></dd>
      {T.unpaid > 0.005 && <><dt>on {tcs ? "collections" : "deductions"} not yet paid</dt><dd data-int-unpaid={T.unpaid}>{money(T.unpaid)} to {day(TDS.ymd(t.rows.filter((r) => r.unpaid).map((r) => r.to).sort().pop() || ""))}, more each month till paid</dd></>}
      {fee && (T.feeDue > 0 || T.feeAllocated > 0) && <><dt>Late fee 234E</dt><dd data-int-feework={T.feeDue}>{fee.days > 0 ? <>{fee.days} day{fee.days === 1 ? "" : "s"} ({day(d1)} to {day(fee.filed)}) × ₹200 = {money(200 * fee.days)}{200 * fee.days > fee.cap ? <>, capped at the quarter’s {tcs ? "TCS" : "TDS"} {money(fee.cap)}</> : null}: <b>{money(T.feeDue)}</b> · allocated {money(T.feeAllocated)}</> : <>none: {t.filed ? "filed" : "due"} by {day(fee.due)}</>}</dd></>}
    </dl>
    <p className="note vf-law" data-int-law="">{tcs
      ? "206C(7): 1% a month or part of a month, from the date the tax was collectible to the date it was paid."
      : "201(1A): (i) 1% a month or part of a month from the date the tax was deductible (paid or credited) to the date it was deducted; (ii) 1.5% a month or part of a month from the date deducted to the date paid, when paid after its due date (the 7th of the next month; 30 April for March)."}
      {" "}Months are calendar months, a part counted whole (deducted 10-Apr, paid 12-May: 2), as TRACES works it out. 234E: ₹200 a day from the day after the statement's due date till it is filed, never more than the {tcs ? "TCS" : "TDS"} of the statement.</p>
  </div>;
}
