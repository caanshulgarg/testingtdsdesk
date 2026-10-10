// A TDS return's filing (the owner's list of 10-Oct-2026): "Mark filed" with the date and token number on the File tab
// (T-E1), and the interest and late fee for every form on Errors to fix (T-S3). The figures are worked out in src/js:
// TDSFiled (src/js/65), TDS.interest and TDS.lateFee (src/js/09). Used by TdsReturn.jsx.
import { useState } from "react";
import ListTable from "../../parts/ListTable.jsx";
import DateBox from "../../parts/DateBox.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
// a date kept as 2025-07-25 or 20250725, as 25-Jul-2025
const day = (d) => fmtDate(tallyDate(TDS.ymd(d)));

// T-E1: the return marked filed, or the boxes to mark it
export function MarkFiled({ fy, q, form }) {
  const f = TDSFiled.get(fy, q, form), [on, setOn] = useState(""), [token, setToken] = useState("");
  const name = TDS.formShort(form, fy);
  if (f) return <section className="dash-card" style={{ marginTop: 12 }} data-filed={form + "|" + q}>
    <h3>Filed</h3>
    <div className="dash-row"><span>{name}, {q} {fy}: filed on</span><b>{day(f.on)}</b></div>
    {f.token && <div className="dash-row"><span>Token (RRR) number</span><b>{f.token}</b></div>}
    <p className="note">{f.from === "closed" ? "The date typed under Settings › Closed periods for " + q + " " + fy + "." : f.from === "old" ? "The date kept with the books." : "Marked filed" + (f.by ? " by " + f.by : "") + (f.at ? " on " + fmtDateTime(f.at) : "") + "."}
      {" "}The late fee is worked out to this date.</p>
    {f.from === "return" && <button className="linkbtn" onClick={() => TDSFiled.unmark(fy, q, form)}>Take off the filed mark</button>}
    {f.from === "closed" && <p className="note">Mark it here with the token number to keep both.</p>}
    {f.from === "closed" && <Boxes {...{ fy, q, form, on, setOn, token, setToken }} />}
  </section>;
  return <section className="dash-card" style={{ marginTop: 12 }} data-filed={form + "|" + q}>
    <h3>Once it is filed</h3>
    <p className="note">Give the date and the token number from the acknowledgement. The year's grid then shows it filed, and the late fee is worked out to that date, not to today.</p>
    <Boxes {...{ fy, q, form, on, setOn, token, setToken }} />
  </section>;
}

function Boxes({ fy, q, form, on, setOn, token, setToken }) {
  return <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
    <label className="f"><span>Filed on</span><DateBox aria-label="Filed on" value={on} onChange={(ev) => setOn(ev.target.value)} /></label>
    <label className="f"><span>Token (RRR) number</span><input type="text" inputMode="numeric" value={token} placeholder="15 digits" aria-label="Token number" style={{ width: 180 }} onChange={(ev) => setToken(ev.target.value)} /></label>
    <button className="btn small" data-mark-filed="" onClick={async () => { if (await TDSFiled.mark(fy, q, form, on, token)) { setOn(""); setToken(""); } }}>Mark filed</button>
  </div>;
}

// T-S3: interest under 201(1A) (1% for deducting late, 1.5% for paying late; TCS 1%), the late fee under 234E, and 271H
export function InterestFee({ fy, q, form, list, fee, filed }) {
  const total = r2(list.reduce((a, x) => a + x.amount, 0)), ded = list.filter((x) => x.kind === "deduct"), pay = list.filter((x) => x.kind === "pay");
  const paidInt = r2(TDS.challans().filter((c) => TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q).reduce((a, c) => a + num(c.interest), 0));
  const feeNow = fee && fee.days > 0 ? fee.fee : 0, toPay = r2(Math.max(0, total - paidInt) + (filed ? 0 : feeNow));
  const tcs = form === "27EQ";
  return <section className="dash-card" style={{ marginBottom: 12 }} data-interest={form}><h3>Interest and late fee</h3>
    <div className="dash-row"><span>Interest, {tcs ? "206C(7): 1% a month, collected or paid late" : "201(1A): 1% a month for deducting late"}</span><b>{money(tcs ? total : ded.reduce((a, x) => a + x.amount, 0))}</b></div>
    {!tcs && <div className="dash-row"><span>Interest under 201(1A), paid after the due date</span><b>{money(pay.reduce((a, x) => a + x.amount, 0))}</b></div>}
    <div className="dash-row"><span>{filed ? "Late filing fee under 234E, filed on " + day(filed) : "Late filing fee under 234E, if filed today"}</span><b>{money(feeNow)}</b></div>
    {fee && fee.days > 0 && <p className="note">{fee.days} day{fee.days === 1 ? "" : "s"} past {day(fee.due)} at 200 a day, capped at the tax of the quarter ({money(fee.cap)}).</p>}
    {fee && (fee.p271h || (!filed && fee.days > 0)) && <p className={"note" + (fee.p271h ? " bad" : "")} data-271h="">{fee.p271h
      ? (filed ? "Filed more than a year after the due date" : "Not filed by " + day(fee.penaltyBy) + ", a year after the due date") + ": a penalty of ₹10,000 to ₹1,00,000 can be levied under 271H."
      : "File by " + day(fee.penaltyBy) + " with the tax, fee and interest paid, and no penalty under 271H can be levied."}</p>}
    {(total > 0 || feeNow > 0) && <div className="dash-row" data-next-challan=""><span>Pay with the next challan{paidInt > 0 ? " (interest already on this quarter's challans: " + money(paidInt) + ")" : ""}</span><b>{money(toPay)}</b></div>}
    {list.length ? <ListTable name="tdsLate" rows={list} rowKey={(x, i) => (x.row.id || "") + ":" + x.kind + ":" + i} unit={["late entry", "late entries"]} limit={100}
      cols={[
        { k: "date", role: "date", label: tcs ? "Collected" : "Deducted", cls: "dt", v: (x) => TDS.ymd(x.row.date), cell: (x) => day(x.row.date) },
        { k: "party", role: "party", label: tcs ? "Buyer" : "Deductee", v: (x) => x.row.party, cell: (x) => x.row.party },
        { k: "int", role: "amount", label: "Interest", cls: "n", v: (x) => num(x.amount), fmt: money, td: () => ({ className: "bad" }), cell: (x) => money(x.amount) },
        { k: "kind", role: "status", label: "Why", v: (x) => x.kind, cell: (x) => (x.kind === "deduct" ? "deducted late: bill of " + day(x.from) + (x.bill ? " (no. " + x.bill + ")" : "") : "paid late: due " + day(x.due) + ", paid " + day(x.challan.date)) },
        { k: "tds", label: tcs ? "TCS" : "TDS", cls: "n", v: (x) => num(x.row.tds), sum: true, fmt: money, cell: (x) => money(x.row.tds) },
        { k: "rate", label: "Rate", cls: "n", v: (x) => x.rate, cell: (x) => x.rate + "%" },
        { k: "m", label: "Months", cls: "n", v: (x) => x.months, cell: (x) => x.months },
      ]} /> : <p className="note">Nothing was {tcs ? "collected or paid" : "deducted or paid"} late.</p>}
  </section>;
}
