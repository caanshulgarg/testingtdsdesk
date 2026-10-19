// Deductions and Challans as simple as Winman TDS (round 88, 19-Oct-2026; the owner sent Winman's screens: "very simple
// ui"). Winman shows fields as rows and records as columns; here rows are records and columns fields (a web table), with
// the same plainness: one selector, one table, one footer strip.
//   DedByChallan  the Deductions step: "Select challan [1 · 07-Jul-2026 · ₹4,32,762 ▾]" (the quarter's challans, numbered as
//                 on Challans, and "Not on any challan (N)" last); below it the deductions on that challan only (Name · PAN ·
//                 Amount paid · Paid date · Deduction date · TDS · Rate · Reason lower/higher · Section · Shortfall/Excess),
//                 edited in place as the table's cells are (DedSmart Cell); the last row "+ Add deduction to this challan"
//                 opens the deductions not on a challan, the best fit first, one click puts one on; and the footer, always
//                 in view: Challan amount · Amount utilised · Balance · Number of deductions. "Not on any challan" is the
//                 to-do list (DedTodo).
//   ChallanGrid   the Challans step: one plain table of the quarter's challans (Winman's grid), totals in its footer,
//                 "+ Add challan" its last row; a row opens Deductions with that challan chosen.
//   winChallans   the challans both show, in one order (TDSMatch's challansOf: those this return uses or is offered, and
//                 the quarter's own with tax left), so "3" is the same challan on both steps.
// Nothing here works out a match or a figure: the register's (TDSReg) balance and use, TDSMatch's suggestions, and the
// existing tag / move / take-off functions.
import { useRef, useState } from "react";
import "../../lib/tdsGlobals.js";
import { SideDrawer } from "./Shell.jsx";
import { Cell } from "./DedSmart.jsx";
import { challansOf } from "./Match.jsx";
import { AddChallan, say } from "./Register.jsx";
import { PanBox } from "./PanBook.jsx";
import { openAdd } from "./AddDeduction.jsx";
import { openAllChallans } from "./AllChallans.jsx";
import More from "../../parts/More.jsx";
import { unplacedOf, usedHere, chIds } from "./onChallan.js";
import "./clear.css";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const chSec = (c) => TDSCH.secNorm(c.section) || "";
const totalOf = (c) => r2(num(c.tax) + num(c.interest) + num(c.fee) + num(c.others));
// the grid's amounts: a nil interest, fee or other left blank, as Winman's
const amt = money;
const amt0 = (v) => (Math.abs(num(v)) < 0.005 ? "" : amt(v));
const TYPE = { 200: "TDS payable by the deductor (minor head 200)", 400: "Regular assessment (minor head 400)" };

// the challans of a return, oldest first: [c]
export function winChallans(form, fy, q, cx) {
  let sugg = [];
  try { sugg = TDSMatch.suggest(form, fy, q); } catch (e) { /* the matcher not loaded */ }
  return challansOf(form, fy, q, cx || TDSReg.ctx(), sugg).slice().sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)) || String(a.id).localeCompare(String(b.id)));
}
// round 89: not on a challan here (none, or one missing: onChallan.js)
const unplaced = (rows) => unplacedOf(rows);
// the return's challans (the grid's rows, the header's count) and its TDS on them: one figure everywhere
export function retChallans(form, fy, q, cx) {
  const c = cx || TDSReg.ctx(), list = winChallans(form, fy, q, c), key = TDSReg.key(form, fy, q);
  return { list, n: list.length, here: r2(list.reduce((a, x) => a + usedHere(x, key, c), 0)) };
}

// the challan chosen: S.tdsWinCh when it is one of the list (or "__none"); else the first with a balance left, else the
// first; with no challan, "__none"
export function chosenOf(list, rows, cx) {
  const v = S.tdsWinCh || "";
  if (v === "__none") return "__none";
  if (v && list.some((c) => c.id === v)) return v;
  const left = list.find((c) => TDSReg.balance(c, cx).tax > 0.005);
  return left ? left.id : list.length ? list[0].id : "__none";
}
// open a challan's deductions (the Challans grid, a challan elsewhere)
export function openChallanDeductions(id) { S.tdsWinCh = id; S.tdsDedView = ""; S.tdsDedCh = id; S.tdsWinAdd = ""; tdsTabGo("deductions"); try { window.scrollTo(0, 0); } catch (e) { /* */ } }

// "Reason lower/higher" as the file writes it (TDS26Q.remark): A a lower-deduction certificate, C the higher rate (no PAN)
function Reason({ r, form }) {
  let m = { remark: "" };
  try { m = TDS26Q.remark(r, form); } catch (e) { /* */ }
  if (!m.remark) return null;
  return <span title={m.remark === "A" ? "Lower deduction: certificate " + (m.certFull || m.certNo || "") : "Higher rate: no PAN or PAN inoperative"}>{m.remark === "A" ? "A · lower" : m.remark === "C" ? "C · higher" : m.remark}</span>;
}

// the deductions not on a challan, best fit for this challan first: its suggestions, then those it can hold, of its
// section, of its month or before, nearest in date
function candidates(c, rows, m, cx) {
  const left = TDSReg.balance(c, cx).tax, sec = chSec(c), ym = TDS.ymd(c.date).slice(0, 6);
  return unplaced(rows).map((r) => {
    const s = m && m.byRow[r.id], sg = s && s.chId === c.id && s.rule !== "split" ? 1 : 0;
    return { r, s: sg ? s : null, sg, fits: r.tds <= left + 0.005 ? 1 : 0, sec: !sec || TDSCH.secOk(sec, r.section) ? 1 : 0, mon: TDS.ymd(r.date).slice(0, 6) <= ym ? 1 : 0,
      gap: Math.abs(+tallyDate(TDS.ymd(c.date)) - +tallyDate(TDS.ymd(r.date))) || 0 };
  }).sort((a, b) => b.sg - a.sg || b.fits - a.fits || b.sec - a.sec || b.mon - a.mon || a.gap - b.gap || String(a.r.id).localeCompare(String(b.r.id)));
}

function AddList({ c, rows, m, form, locked }) {
  const cx = TDSReg.ctx(), list = candidates(c, rows, m, cx), left = TDSReg.balance(c, cx).tax;
  const close = () => { S.tdsWinAdd = ""; render(); };
  const put = (x) => {
    const y = x.s ? TDSCH.tag([x.r.id], c.id, { via: "suggestion", note: "suggestion confirmed: " + x.s.words + (x.s.rule === "g" ? " (" + x.s.reason + ")" : "") }) : TDSMatch.move([x.r.id], c.id);
    if (!y.ok) toast(y.why); render();
  };
  // the owner (19-Oct-2026): with every deduction on some challan the list was empty; this return's deductions on OTHER
  // challans follow, each with Move here (the move refused beyond this challan's balance; a confirm when it would leave
  // the other challan, now fully used, with tax unaccounted)
  const ids = chIds(), byId = Object.fromEntries(TDS.challans().map((x) => [x.id, x]));
  const others = rows.filter((r) => r.tds > 0.005 && r.challan && r.challan !== c.id && ids.has(r.challan))
    .sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)) || String(a.id).localeCompare(String(b.id)));
  const moveHere = async (r) => {
    const o = byId[r.challan], ob = TDSReg.balance(o, cx).tax;
    if (r.tds > left + 0.005) { toast(money(left) + " left on this challan: " + money(r.tds) + " does not fit."); return; }
    if (Math.abs(ob) < 0.005 && !(await askConfirm({ title: "Move it off challan " + o.serial + "?", body: esc("Challan " + o.serial + " · " + day(o.date) + " is fully used now; it would then have " + money(r.tds) + " not on any deduction."), ok: "Move here" }))) return;
    const y = TDSMatch.move([r.id], c.id); if (!y.ok) toast(y.why); render();
  };
  return <SideDrawer open onClose={close} kind="wd-add" wide title={"Add to challan " + c.serial + " · " + day(c.date)} description={money(left) + " left · " + list.length + " not on a challan"}>
    <div data-wd-addlist={c.id}>
      <h4 className="wd-addh" data-wd-addh="none">Not on any challan ({list.length})</h4>
      {!locked && (form === "26Q" || form === "27Q") && <p className="wd-addnew"><button type="button" className="btn small" data-wd-new="" onClick={() => { S.tdsWinAdd = ""; openAdd({ chId: c.id }); }}>Type a new deduction…</button></p>}
      {list.length ? <div className="bk-tablewrap"><table className="bk-table wd-cands gf-off">
        <thead><tr><th className="ck"></th><th>Name</th><th>Section</th><th className="dt">Date</th><th className="n">TDS</th><th></th></tr></thead>
        <tbody>{list.map((x) => <tr key={x.r.id} data-wd-cand={x.r.id} className={x.fits ? "" : "wd-over"}>
          <td className="ck">{x.fits ? <input type="checkbox" checked={false} disabled={locked} data-wd-put={x.r.id} aria-label={"Put on this challan: " + (x.r.party || "")} onChange={() => put(x)} />
            : <button type="button" className="linkbtn" data-wd-split={x.r.id} disabled={locked || left < 0.005} title={"More than the " + money(left) + " left"} onClick={() => { S.tdsWinAdd = ""; tdsSplitRow(x.r.id, c.id); }}>Split…</button>}</td>
          <td>{x.r.party || x.r.employee}</td><td>{TDS.sec(x.r.section) || x.r.section}</td><td>{day(x.r.date)}</td><td className="n">{money(x.r.tds)}</td>
          <td>{x.sg ? <span className="tag info" title={x.s.reason}>suggested</span> : !x.sec ? <span className="wd-dim">other section</span> : null}</td></tr>)}</tbody></table></div>
        : <p className="note" data-wd-allon="">All deductions are on a challan. To move one here, pick it below.</p>}
      <h4 className="wd-addh" data-wd-addh="other">On other challans ({others.length})</h4>
      {others.length > 0 && <div className="bk-tablewrap"><table className="bk-table wd-cands gf-off" data-wd-others="">
        <thead><tr><th>Name</th><th>Section</th><th className="dt">Date</th><th className="n">TDS</th><th>On</th><th></th></tr></thead>
        <tbody>{others.map((r) => { const o = byId[r.challan], fits = r.tds <= left + 0.005;
          return <tr key={r.id} data-wd-other={r.id} className={fits ? "" : "wd-over"}>
            <td>{r.party || r.employee}</td><td>{TDS.sec(r.section) || r.section}</td><td>{day(r.date)}</td><td className="n">{money(r.tds)}</td>
            <td data-wd-on={o.id}>on {o.serial} · {day(o.date)}</td>
            <td><button type="button" className="btn small" data-wd-move={r.id} disabled={locked || !fits} title={fits ? "Take it off " + o.serial + " and put it on this challan" : "More than the " + money(left) + " left"} onClick={() => moveHere(r)}>Move here</button></td></tr>; })}</tbody></table></div>}
    </div></SideDrawer>;
}

export function DedByChallan({ form, fy, q, rows, m, issueOf, probs, locked, todo, tools }) {
  const cx = TDSReg.ctx(), list = winChallans(form, fy, q, cx), key = TDSReg.key(form, fy, q);
  // the challan chosen belongs to its return: another return opened starts on its own default
  if (S.tdsWinRet && S.tdsWinRet !== key) { S.tdsWinCh = ""; S.tdsWinAdd = ""; }
  S.tdsWinRet = key;
  if (S.tdsWinCh && S.tdsWinCh !== "__none" && !list.some((c) => c.id === S.tdsWinCh)) { const x = TDS.challans().find((c) => c.id === S.tdsWinCh); if (x) list.push(x); }
  const un = unplaced(rows), cur = chosenOf(list, rows, cx), c = cur === "__none" ? null : list.find((x) => x.id === cur);
  // the default kept as chosen, so the view stays on the challan once a deduction uses up its balance
  if (c && S.tdsWinCh !== cur) S.tdsWinCh = cur;
  const pick = (v) => { S.tdsWinCh = v; S.tdsWinAdd = ""; render(); };
  const unit = form === "27EQ" ? ["collection", "collections"] : ["deduction", "deductions"];
  const on = c ? rows.filter((r) => r.challan === c.id).sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)) || String(a.id).localeCompare(String(b.id))) : [];
  const C = (r, k, el) => <Cell r={r} k={k} form={form} locked={locked}>{el}</Cell>;
  const bal = c ? TDSReg.balance(c, cx).tax : 0, used = c ? TDSReg.usedTax(c, cx) : 0, here = c ? usedHere(c, key, cx) : 0;
  return <div className="wd" data-wd={key}>
    <div className="wd-top">
      <label className="wd-sel"><span>Select challan</span>
        <select data-wd-sel="" aria-label="Select challan" value={cur} onChange={(ev) => pick(ev.target.value)}>
          {list.map((x, i) => <option key={x.id} value={x.id}>{(i + 1) + " · " + day(x.date) + " · " + money(totalOf(x))}</option>)}
          {(un.length > 0 || cur === "__none") && <option value="__none">Not on any challan ({un.length})</option>}</select></label>
      {c && <span className="wd-chw" title={c.bsr + " · " + c.serial}>BSR {c.bsr} · serial {c.serial}{chSec(c) ? " · " + chSec(c) : ""}</span>}
      <span className="rt-sp" />{tools}
    </div>
    {c && un.length > 0 && <p className="wd-un" data-wd-unplaced={un.length}>{un.length} {un.length === 1 ? unit[0] : unit[1]} not on a challan · <button type="button" className="linkbtn" onClick={() => pick("__none")}>Show</button></p>}
    {!c ? todo
      : <><div className="bk-tablewrap wd-wrap"><table className="bk-table wd-table gf-off" data-wd-table={c.id}>
        <thead><tr><th>Name</th><th>PAN</th><th className="n">Amount paid</th><th className="dt">Paid date</th><th className="dt">Deduction date</th><th className="n">{form === "27EQ" ? "TCS" : "TDS"}</th><th className="n">Rate</th><th>Reason lower/higher</th><th>Section</th><th className="n">Shortfall/Excess</th><th className="ck"><span className="sr-only">Take off</span></th></tr></thead>
        <tbody>{on.map((r) => { const iss = issueOf[r.id], short = iss ? r2(num(iss.short)) : 0;
          return <tr key={r.id} data-wd-row={r.id} className={probs[r.id] ? "rt-fix" : undefined}>
            <td className="wd-name"><button type="button" className="linkbtn" data-row-detail={r.id} title={(r.voucher ? "Voucher " + r.voucher + " · " : "") + "Details"} onClick={() => { S.tdsRowDet = r.id; render(); }}>{r.party || r.employee}</button></td>
            <td>{Certs.validPan(r.pan) ? r.pan : <PanBox party={r.party || r.employee} compact />}</td>
            <td className="n">{C(r, "paid", money(r.paid))}</td><td className="dt">{C(r, "credit", day(r.credit || r.date))}</td><td className="dt">{C(r, "date", day(r.date))}</td>
            <td className="n">{C(r, "tds", money(r.tds))}</td><td className="n">{C(r, "rate", r.rate != null ? r.rate + "%" : "")}</td><td><Reason r={r} form={form} /></td>
            <td>{C(r, "section", <span data-sec={TDS.sec(r.section)}>{TDS.sec(r.section) || r.section}</span>)}</td>
            <td className={"n" + (short > 0.005 ? " bad" : "")} title={iss ? "should be " + iss.expected + "%" : undefined}>{short ? money(short) : "0"}</td>
            <td className="ck">{!locked && <button type="button" className="icon" data-wd-off={r.id} aria-label={"Take off this challan: " + (r.party || "")} title="Take off this challan" onClick={() => { const y = TDSMatch.takeOff([r.id]); if (!y.ok) toast(y.why); render(); }}>✕</button>}</td></tr>; })}
          {!locked ? <tr className="wd-addrow"><td colSpan={11}><button type="button" className="linkbtn" data-wd-add-open={c.id} onClick={() => { S.tdsWinAdd = c.id; render(); }}>+ Add {unit[0]} to this challan</button></td></tr>
            : <tr className="wd-addrow"><td colSpan={11} className="note">The return is marked filed: open a correction to change it.</td></tr>}</tbody></table></div>
        <div className="wd-foot" data-wd-foot={c.id} data-amt={r2(num(c.tax))} data-here={here} data-used={used} data-bal={bal} data-n={on.length}>
          <span>Challan amount <b>{money(c.tax)}</b></span><span>Used here <b>{money(here)}</b></span>{Math.abs(used - here) > 0.005 && <span title="This return's and the other returns' TDS on the challan">Amount utilised (all returns) <b>{money(used)}</b></span>}
          <span>Balance <b className={bal < -0.005 ? "bad" : ""} data-wd-bal={bal}>{money(bal)}</b></span><span>Number of {unit[1]} <b>{on.length}</b></span></div>
        {S.tdsWinAdd === c.id && <AddList c={c} rows={rows} m={m} form={form} locked={locked} />}</>}
  </div>;
}

export function ChallanGrid({ fy, q, form, tallyPays }) {
  const cx = TDSReg.ctx(), list = winChallans(form, fy, q, cx), locked = TDSReg.locked(fy, q, form), key = TDSReg.key(form, fy, q);
  const [adding, setAdding] = useState(false), [pays, setPays] = useState(false), up = useRef(null);
  const upload = async (fs) => { const r = await TDSCH.upload(fs); if (r && r.placed) say(r.placed + " new challan" + (r.placed === 1 ? "" : "s") + " added; what " + (r.placed === 1 ? "it pays is" : "they pay is") + " suggested on Deductions."); render(); };
  const nPays = tallyPays ? tallyPays.n : 0;
  const rows = list.map((c, i) => { const p = TDSReg.portionFor(c, form, fy, q, cx), b = TDSReg.balance(c, cx).tax;
    return { c, no: i + 1, int: num(p.interest), oth: num(p.fee), here: usedHere(c, key, cx), used: TDSReg.usedTax(c, cx), bal: b, ok: TDSReg.srcOf(c) === "upload" || !!c.cin }; });
  const sum = (f) => r2(rows.reduce((a, x) => a + f(x), 0));
  return <div className="chg" data-chg={TDSReg.key(form, fy, q)}>
    <div className="rt-tool" data-step-tool="">
      <span className="wd-help">Click a challan to see and add its deductions.</span>
      <button type="button" className="linkbtn cm-allch" data-cm-allch="" onClick={() => openAllChallans(fy, { fy, q, form })}>See all challans of {fy} →</button>
      <span className="rt-sp" />
      <More label="Add challan" ariaLabel="Add challan" data-ret-add-challan="" items={[
        ["By hand", () => setAdding(true), { "data-cm-add": "hand" }],
        ["From a Tally TDS payment" + (nPays ? " (" + nPays + ")" : ""), () => setPays(true), { "data-cm-add": "tally" }],
        ["Upload challans…", () => up.current && up.current.click(), { "data-cm-add": "upload" }],
        ["Open the challan register", () => tdsNav("register"), { "data-cm-add": "register" }],
        ["Match on two panels", () => { S.tdsChView = "match"; render(); }, { "data-chg-match": "" }],
      ]} />
      <input ref={up} type="file" multiple hidden data-challan-upload="" accept=".csv,.xls,.xlsx,.pdf,text/csv,application/pdf" onChange={(ev) => { const fs = Array.from(ev.target.files || []); ev.target.value = ""; upload(fs); }} />
    </div>
    {pays && tallyPays ? <div data-cm-tally-pays="">{tallyPays.el}<p className="note"><button className="linkbtn" onClick={() => setPays(false)}>Close</button></p></div> : null}
    <div className="bk-tablewrap chg-wrap"><table className="bk-table chg-table gf-off">
      <thead><tr><th className="n">No</th><th className="dt">Date</th><th>Section</th><th className="n">Tax</th><th className="n">Interest</th><th className="n">Fee</th><th className="n">Others</th><th className="n">Total</th>
        <th>Serial</th><th>BSR</th><th>Type</th><th>Verified</th><th className="n">Interest allocated</th><th className="n">Others allocated</th><th className="n" title="This return's TDS on the challan">Used here</th><th className="n" title="Every return's TDS on the challan">Used in all returns</th><th className="n">Balance</th></tr></thead>
      <tbody>{rows.map((x) => <tr key={x.c.id} data-chg-row={x.c.id} className="chg-click" tabIndex={0} title="Its deductions"
          onClick={() => openChallanDeductions(x.c.id)} onKeyDown={(ev) => { if (ev.key === "Enter") openChallanDeductions(x.c.id); }}>
        <td className="n">{x.no}</td><td className="dt">{day(x.c.date)}</td><td>{chSec(x.c) || "—"}</td><td className="n">{amt(x.c.tax)}</td><td className="n">{amt0(x.c.interest)}</td><td className="n">{amt0(x.c.fee)}</td><td className="n">{amt0(x.c.others)}</td><td className="n">{amt(totalOf(x.c))}</td>
        <td>{x.c.serial}</td><td>{x.c.bsr}</td><td title={TYPE[String(x.c.minorHead || "200")] || ""}>{String(x.c.minorHead || "200")}</td><td>{x.ok ? <span className="ac-chip ok" title="From the income-tax portal (its CIN)">Matched</span> : <span className="wd-dim" title="Typed or from Tally: not checked against the portal">Not checked</span>}</td>
        <td className="n">{amt0(x.int)}</td><td className="n">{amt0(x.oth)}</td><td className="n" data-chg-here={x.here}>{amt(x.here)}</td><td className="n">{amt(x.used)}</td><td className={"n" + (x.bal < -0.005 ? " bad" : "")} data-chg-bal={x.bal}>{amt(x.bal)}</td></tr>)}
        {!locked && <tr className="wd-addrow"><td colSpan={17}><button type="button" className="linkbtn" data-chg-add="" onClick={() => setAdding(!adding)}>+ Add challan</button></td></tr>}</tbody>
      <tfoot><tr><td colSpan={3}>Number of challans {rows.length}</td><td className="n" data-chg-tax={sum((x) => num(x.c.tax))}>{amt(sum((x) => num(x.c.tax)))}</td><td className="n">{amt(sum((x) => num(x.c.interest)))}</td><td className="n">{amt(sum((x) => num(x.c.fee)))}</td>
        <td className="n">{amt(sum((x) => num(x.c.others)))}</td><td className="n">{amt(sum((x) => totalOf(x.c)))}</td><td colSpan={4}></td><td className="n">{amt(sum((x) => x.int))}</td><td className="n">{amt(sum((x) => x.oth))}</td>
        <td className="n" data-chg-here-sum={sum((x) => x.here)}>{amt(sum((x) => x.here))}</td><td className="n">{amt(sum((x) => x.used))}</td><td className="n">{amt(sum((x) => x.bal))}</td></tr></tfoot></table></div>
    {adding && <AddChallan form={form} onDone={() => setAdding(false)} />}
  </div>;
}
