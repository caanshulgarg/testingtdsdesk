// All challans of a tax year in one place (next-tds-allchallans, 19-Oct-2026; the owner: "if I want to see all the challans
// .. don't know how to see that.. no option to see all challans"). S.tdsView "allch" (#/c/<client>/books/tds/<year>/
// all-challans), opened from the TDS home (the button beside the year, and the challans line under the grid), from a
// return's header ("All challans of <year>") and from its Challans step.
// One row a challan of the year, every form and quarter: Date · BSR · Serial / CIN · Section · Form / quarter · Tax ·
// Interest · Others · Total · Used on deductions · Left · Status (Matched fully · Part used · Not used · Used beyond its
// tax), and the year's TDS payments in Tally with no BSR code yet as rows of their own ("From Tally: needs BSR") with
// Add BSR code (challanFromBooks, as Challans › From a Tally TDS payment). Filters: quarter, form, section, status; find;
// the foot's totals; Excel. A challan's click opens it in its return's Challans step (the "On this challan" / "Deductions
// to add" panel; the return it was opened from first), or its drawer in the register when no return has it.
// Every figure is TDSReg's (src/js/79); nothing is worked out here.
import { useState } from "react";
import "../../lib/tdsGlobals.js";
import "./clear.css";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const chSec = (c) => TDSCH.secNorm(c.section) || "";
const QS = ["Q1", "Q2", "Q3", "Q4"];
export const STATUS_WORDS = { full: ["Matched fully", "ok"], part: ["Part used", "info"], none: ["Not used", "warn"], over: ["Used beyond its tax", "bad"], bsr: ["From Tally: needs BSR", "bad"] };

// open the page (from: the return it is opened from, {fy, q, form}, or null)
export function openAllChallans(fy, from) { S.tdsFy = fy || S.tdsFy; S.allchFrom = from || null; S.allchFl = {}; S.tdsView = "allch"; render(); try { window.scrollTo(0, 0); } catch (e) { /* */ } }

const formOfSecs = (secs) => (secs.some((s) => /^192/.test(TDS.sec(s) || s)) ? "24Q" : secs.some((s) => /^206C/.test(TDS.sec(s) || s)) ? "27EQ" : "26Q");

// the rows of a year: [{kind: "ch" | "pay", id, date, bsr, serial, cin, secs, forms: [form], qs: [q], fq, tax, interest, others, total, used, left, st, c, p}]
export function allChallanRows(fy) {
  const cx = TDSReg.ctx(), chs = TDS.challans(), out = [];
  chs.forEach((c) => {
    const uses = Object.values(cx.uses[c.id] || {}).sort((a, b) => (a.fy + a.q + a.form).localeCompare(b.fy + b.q + b.form));
    if (TDS.fyOf(c.date) !== fy && !uses.some((u) => u.fy === fy)) return;
    const sp = TDSReg.split(c), used = r2(TDSReg.usedTax(c, cx)), left = r2(TDSReg.balance(c, cx).tax);
    const home = TDSReg.homeForm(c), cq = TDS.qOf(c.date);
    const forms = uses.length ? Array.from(new Set(uses.map((u) => u.form))) : home ? [home] : [];
    const qs = Array.from(new Set([TDS.fyOf(c.date) === fy ? cq : ""].concat(uses.filter((u) => u.fy === fy).map((u) => u.q)).filter(Boolean)));
    const fq = uses.length ? uses.map((u) => u.form + " " + u.q + (u.fy !== fy ? " " + u.fy : "")).join(", ") : (home ? home + " " : "") + cq;
    const st = left < -0.005 ? "over" : used < 0.005 ? "none" : left < 0.005 ? "full" : "part";
    out.push({ kind: "ch", id: c.id, date: TDS.ymd(c.date), bsr: c.bsr || "", serial: String(c.serial || ""), cin: c.cin || "", secs: chSec(c) ? [chSec(c)] : [], forms, qs, fq, uses,
      tax: sp.tax, interest: sp.interest, others: r2(sp.fee + sp.others), total: sp.total, used, left, st, c });
  });
  TDS.paymentsFromBooks().filter((p) => TDS.fyOf(p.date) === fy && TDSTally.notChallan(p, chs)).forEach((p) => {
    const secs = (p.sections || []).filter(Boolean).map((s) => TDS.sec(s) || s), form = formOfSecs(secs), q = TDS.qOf(p.date);
    const others = r2(num(p.fee) + num(p.others));
    out.push({ kind: "pay", id: "pay:" + p.vid, date: TDS.ymd(p.date), bsr: "", serial: "", cin: "", secs, forms: [form], qs: [q], fq: form + " " + q,
      tax: num(p.tax), interest: num(p.interest), others, total: r2(num(p.tax) + num(p.interest) + others), used: 0, left: 0, st: "bsr", p });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.serial).localeCompare(String(b.serial)));
}

// where a challan opens: the return it was opened from when that return has it (used or suggested), else its first use,
// else its own return (its form and the quarter of its date); null: none (the register's drawer)
function target(x, from) {
  const has = (f) => x.uses.some((u) => u.form === f.form && u.fy === f.fy && u.q === f.q);
  const sugg = (f) => { try { return TDSMatch.suggest(f.form, f.fy, f.q).some((s) => s.chId === x.id || (s.parts || []).some((p) => p.chId === x.id)); } catch (e) { return false; } };
  if (from && (has(from) || sugg(from) || (x.forms.includes(from.form) && TDS.fyOf(x.date) === from.fy && TDS.qOf(x.date) === from.q))) return from;
  if (x.uses.length) return { form: x.uses[0].form, fy: x.uses[0].fy, q: x.uses[0].q };
  const home = TDSReg.homeForm(x.c);
  return home ? { form: home, fy: TDS.fyOf(x.date), q: TDS.qOf(x.date) } : null;
}
export function openChallan(x, from) {
  const t = target(x, from);
  if (!t) { S.tdsView = "register"; render(); openDetail("challan", x.id); return; }
  tdsGoTab(t.fy, t.q, t.form, "challans", { tdsChSel: x.id });
}

function PayCells({ x }) {
  const [open, setOpen] = useState(false), [bsr, setBsr] = useState(""), [ser, setSer] = useState("");
  const cin = !!TDSCH.cin(bsr);
  if (!open) return <button type="button" className="btn small primary" data-allch-addbsr={x.p.vid} onClick={() => setOpen(true)}>Add BSR code</button>;
  return <span className="ac-bsr" data-allch-bsrbox={x.p.vid}>
    <input type="text" value={bsr} placeholder="BSR code or the CIN" aria-label="BSR code or CIN" onChange={(ev) => setBsr(ev.target.value)} autoFocus />
    <input type="text" value={cin ? TDSCH.cin(bsr).serial : ser} disabled={cin} placeholder="Serial" aria-label="Challan serial" onChange={(ev) => setSer(ev.target.value)} />
    <button type="button" className="btn small primary" data-allch-make={x.p.vid} onClick={() => { if (challanFromBooks(x.p.vid, bsr, ser) !== false) setOpen(false); }}>Make it a challan</button>
    <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Cancel</button></span>;
}

async function toExcel(rows, fy) {
  await ensureXlsx();
  const head = ["Date", "BSR code", "Serial / CIN", "Section", "Form / quarter", "Tax", "Interest", "Others", "Total", "Used on deductions", "Left", "Status"];
  const aoa = [head].concat(rows.map((x) => [day(x.date), x.bsr, x.cin || x.serial, x.secs.join(", "), x.fq, x.tax, x.interest, x.others, x.total, x.used, x.left, STATUS_WORDS[x.st][0]]));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Challans " + fy);
  XLSX.writeFile(wb, ((CO() || {}).name || "Client") + " challans " + fy + ".xlsx");
}

export default function AllChallans({ fys }) {
  const fy = S.tdsFy, from = S.allchFrom && S.allchFrom.fy === fy ? S.allchFrom : null, f = S.allchFl || {};
  const all = allChallanRows(fy);
  const setF = (k, v) => { S.allchFl = { ...f, [k]: v }; render(); };
  const qq = String(f.q || "").trim().toLowerCase();
  const rows = all.filter((x) => (!f.qtr || x.qs.includes(f.qtr)) && (!f.form || x.forms.includes(f.form)) && (!f.sec || x.secs.includes(f.sec)) && (!f.st || x.st === f.st)
    && (!qq || [x.bsr, x.serial, x.cin, x.secs.join(" "), x.fq, String(x.tax), String(x.total), day(x.date)].join(" ").toLowerCase().includes(qq)));
  const sum = (k) => r2(rows.reduce((a, x) => a + num(x[k]), 0));
  const secs = Array.from(new Set(all.flatMap((x) => x.secs))).sort(), forms = Array.from(new Set(all.flatMap((x) => x.forms))).sort();
  const nBsr = all.filter((x) => x.kind === "pay").length, active = Object.values(f).some(Boolean);
  const back = from ? <button className="linkbtn" data-allch-back="" onClick={() => tdsGoTab(from.fy, from.q, from.form, "challans")}>← {TDS.formShort(from.form, from.fy)} {from.q}</button>
    : <button className="linkbtn" data-allch-back="" onClick={() => tdsGo(fy)}>← TDS {fy}</button>;
  const sel = (k, label, opts) => <label className="ac-f"><span>{label}</span><select aria-label={label} data-allch-filter={k} value={f[k] || ""} onChange={(ev) => setF(k, ev.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  return <div className="ac" data-all-challans={fy}>
    <p className="note ac-back">{back}</p>
    <div className="ac-head">
      <h2 className="tg-h2" data-allch-title="">All challans of {fy}</h2>
      <label className="ac-f"><span>{TDS.yearWord(fy)}</span><select aria-label="Year" data-allch-year="" value={fy} onChange={(ev) => { S.tdsFy = ev.target.value; S.allchFl = {}; render(); }}>
        {(fys || [fy]).map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
      <span className="rt-sp" />
      <button type="button" className="btn small" data-allch-excel="" onClick={() => toExcel(rows, fy).then(() => toast("Downloaded."))}>Excel</button>
      <button type="button" className="btn small" data-allch-register="" onClick={() => tdsNav("register")}>Add or upload challans</button>
    </div>
    <p className="ac-sum" data-allch-sum="">{all.length - nBsr} challan{all.length - nBsr === 1 ? "" : "s"} · every form and quarter of {fy}{nBsr ? <> · <b className="ac-red">{nBsr} TDS payment{nBsr === 1 ? "" : "s"} in Tally without a BSR code</b></> : null}</p>
    <div className="ac-bar" data-allch-bar="">
      {sel("qtr", "Quarter", [["", "Every quarter"]].concat(QS.map((q) => [q, q])))}
      {sel("form", "Form", [["", "Every form"]].concat(forms.map((x) => [x, TDS.formShort(x, fy)])))}
      {sel("sec", "Section", [["", "Every section"]].concat(secs.map((x) => [x, x])))}
      {sel("st", "Status", [["", "Every status"]].concat(Object.keys(STATUS_WORDS).map((k) => [k, STATUS_WORDS[k][0]])))}
      <label className="ac-f ac-find"><span>Find</span><input type="search" aria-label="Find a challan" data-allch-find="" placeholder="BSR, serial, amount" value={f.q || ""} onChange={(ev) => setF("q", ev.target.value)} /></label>
      {active && <button type="button" className="linkbtn" data-allch-clear="" onClick={() => { S.allchFl = {}; render(); }}>Clear filters</button>}
    </div>
    <div className="bk-tablewrap"><table className="bk-table ac-table gf-off" id="tdsAllChTable" data-statement="">
      <thead><tr><th className="dt">Date</th><th>BSR</th><th>Serial / CIN</th><th>Section</th><th>Form / quarter</th><th className="n">Tax</th><th className="n">Interest</th><th className="n">Others</th>
        <th className="n">Total</th><th className="n">Used on deductions</th><th className="n">Left</th><th>Status</th></tr></thead>
      <tbody>{rows.map((x) => { const [w, tone] = STATUS_WORDS[x.st];
        return <tr key={x.id} data-allch-row={x.id} data-allch-kind={x.kind} data-allch-st={x.st} className={x.kind === "ch" ? "ac-click" : "ac-pay"} tabIndex={x.kind === "ch" ? 0 : undefined}
          onClick={x.kind === "ch" ? (ev) => { if (ev.target.closest && ev.target.closest("button, input, a")) return; openChallan(x, from); } : undefined}
          onKeyDown={x.kind === "ch" ? (ev) => { if (ev.key === "Enter" && ev.target === ev.currentTarget) openChallan(x, from); } : undefined}>
          <td className="dt">{day(x.date)}</td>
          <td>{x.kind === "ch" ? <button type="button" className="linkbtn" data-allch-open={x.id} onClick={() => openChallan(x, from)}>{x.bsr}</button> : <span className="ac-red">none yet</span>}</td>
          <td>{x.kind === "ch" ? (x.cin || x.serial) : <span>Tally voucher {x.p.voucher || ""}</span>}</td>
          <td>{x.secs.join(", ") || "—"}</td><td>{x.fq}</td>
          <td className="n">{money(x.tax)}</td><td className="n">{money(x.interest)}</td><td className="n">{money(x.others)}</td><td className="n"><b>{money(x.total)}</b></td>
          <td className="n" data-allch-used={x.used}>{x.kind === "ch" ? money(x.used) : "—"}</td>
          <td className={"n" + (x.left < -0.005 ? " ac-red" : "")} data-allch-left={x.left}>{x.kind === "ch" ? money(x.left) : "—"}</td>
          <td className="ac-stc"><span className={"ac-chip " + tone} data-allch-status={x.st}>{w}</span>{x.kind === "pay" ? <> <PayCells x={x} /></> : null}</td>
        </tr>; })}
        {!rows.length && <tr><td colSpan={12} className="ac-empty">{all.length ? "No challan matches these filters." : "No challan in " + fy + " yet."}</td></tr>}</tbody>
      <tfoot><tr data-allch-foot=""><td colSpan={5}><b>{rows.length} row{rows.length === 1 ? "" : "s"}</b></td><td className="n"><b data-allch-total="tax">{money(sum("tax"))}</b></td><td className="n"><b>{money(sum("interest"))}</b></td>
        <td className="n"><b>{money(sum("others"))}</b></td><td className="n"><b data-allch-total="total">{money(sum("total"))}</b></td><td className="n"><b data-allch-total="used">{money(sum("used"))}</b></td>
        <td className="n"><b data-allch-total="left">{money(sum("left"))}</b></td><td></td></tr></tfoot>
    </table></div>
    <p className="note ac-hint">Click a challan to open it in its return: the deductions on it and the ones to add.</p>
  </div>;
}
