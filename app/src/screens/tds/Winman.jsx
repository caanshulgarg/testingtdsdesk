// Deductions and Challans as simple as Winman TDS (round 88, 19-Oct-2026; the owner sent Winman's screens: "very simple
// ui"). Winman shows fields as rows and records as columns; here rows are records and columns fields (a web table), with
// the same plainness: one selector, one table, one footer strip.
//   DedByChallan  the Deductions step: "Select challan [1 · 07-Jul-2026 · ₹4,32,762 ▾]" (the quarter's challans, numbered as
//                 on Challans, and "Not on any challan (N)" last); below it the deductions on that challan only (Name · PAN ·
//                 Amount paid · Paid date · Deduction date · TDS · Rate · Reason lower/higher · Section · Shortfall/Excess),
//                 edited in place as the table's cells are (DedSmart Cell); the last row "+ Add deduction to this challan"
//                 opens the deductions not on a challan, the best fit first, one click puts one on; and the footer, always
//                 in view: Used here · Balance · Number of deductions (the amount is the dropdown's; round 94). "Not on any challan" is the
//                 to-do list (DedTodo).
//   ChallanGrid   the Challans step: one plain table of the quarter's challans (Winman's grid), totals in its footer,
//                 "+ Add challan" its last row; a row opens Deductions with that challan chosen.
//   winChallans   the challans both show, in one order (onChallan.js retChallanList: those this return uses, is offered or
//                 was given by hand, and the quarter's own of its kind), so "3" is the same challan on both steps.
// Nothing here works out a match or a figure: the register's (TDSReg) balance and use, TDSMatch's suggestions, and the
// existing tag / move / take-off functions.
import { useRef, useState } from "react";
import "../../lib/tdsGlobals.js";
import { SideDrawer } from "./Shell.jsx";
import { Cell } from "./DedSmart.jsx";
import { AddChallan, say } from "./Register.jsx";
import { PanBox } from "./PanBook.jsx";
import { openAdd } from "./AddDeduction.jsx";
import More from "../../parts/More.jsx";
import { unplacedOf, usedHere, chIds, placeIssues, earlyFor, placeNote, chipW, winChallans, retChallans, pinnedIds, pinChallans } from "./onChallan.js";
import { PickChallans } from "./PickChallans.jsx";
import { DedName } from "./DedName.jsx";
import { useCF, Th } from "./ColF.jsx";
import "./clear.css";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const chSec = (c) => TDSCH.secNorm(c.section) || "";
const totalOf = (c) => r2(num(c.tax) + num(c.interest) + num(c.fee) + num(c.others));
// the grid's amounts: a nil interest, fee or other left blank, as Winman's
const amt = money;
const amt0 = (v) => (Math.abs(num(v)) < 0.005 ? "" : amt(v));
const TYPE = { 200: "TDS payable by the deductor (minor head 200)", 400: "Regular assessment (minor head 400)" };

// the challans of a return, oldest first: [c] (next-tds-retchallans: onChallan.js, the one list)
export { winChallans, retChallans };
// round 89: not on a challan here (none, or one missing: onChallan.js)
const unplaced = (rows) => unplacedOf(rows);

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

// next-tds-addlist (the owner, 19-Oct-2026: "there should be tick box system to move bulk"); next-tds-tidy2 (20-Oct-2026:
// "Filters should be there in columns only"): the filters of a list of deductions are in its column headers (tds/ColF.jsx):
// Name (name, PAN, voucher; "Problems only"), PAN, Section, the dates by month, the amounts from / to; kept per table
// (S.tdsCF["wd-table"] the challan's table, "wd-add" / "wd-other" the Add drawer's two lists)
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monW = (ym) => (String(ym).length === 6 ? MON[+String(ym).slice(4, 6) - 1] + " " + String(ym).slice(0, 4) : ym);
const prevYm = (ym) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 1 ? (y - 1) + "12" : y + String(m - 1).padStart(2, "0"); };
const secOf = (r) => TDS.sec(r.section) || r.section || "";
// a problem of a row besides "not on a challan" (TDSEdit.problems: no name, no valid PAN, the rate, its challan's date or section)
const hasProb = (r, probs) => ((probs || {})[r.id] || []).some((p) => p !== "not against a challan");
const ymOf = (d) => TDS.ymd(d).slice(0, 6);
// the column filters of a list of deductions; at(x) the deduction of a list item ({r} in the Add drawer)
export function dedDefs(probs, at = (x) => x, extra) {
  return [
    { k: "name", title: "Name", kind: "q", placeholder: "Name, PAN or voucher", get: (x) => { const r = at(x); return [r.party, r.employee, r.pan, r.voucher, r.ledger].join(" "); },
      flag: { k: "prob", label: "Problems only", test: (x) => hasProb(at(x), probs) || !!(extra && extra(x)) } },
    { k: "pan", title: "PAN", kind: "pick", get: (x) => (Certs.validPan(at(x).pan) ? "Has a PAN" : "No valid PAN") },
    { k: "sec", title: "Section", kind: "pick", get: (x) => secOf(at(x)) },
    { k: "date", title: "Deduction date", kind: "pick", get: (x) => ymOf(at(x).date), label: monW },
    { k: "credit", title: "Paid date", kind: "pick", get: (x) => ymOf(at(x).credit || at(x).date), label: monW },
    { k: "paid", title: "Amount paid", kind: "num", get: (x) => at(x).paid },
    { k: "tds", title: "TDS", kind: "num", get: (x) => at(x).tds },
    { k: "rate", title: "Rate", kind: "pick", get: (x) => (at(x).rate != null ? at(x).rate + "%" : "") },
  ];
}

// the deductions not on a challan, best fit for this challan first: never one it cannot pay (next-tds-early: of a later
// year than the challan, the challan dated after today or not minor head 200: last, and it cannot be ticked); one it pays
// in advance (deducted after its date, the same year) or as the next year's challan after the rest; then its suggestions, those it can hold, of its section, deducted in its month or the
// month before (on or before its date), then by date
function fitOf(c, r, left) {
  const cd = TDS.ymd(c.date), sec = chSec(c), rm = TDS.ymd(r.date).slice(0, 6), early = earlyFor(r, c) ? 1 : 0, note = early ? null : placeNote(r, c);
  return { early, note, adv: note ? 1 : 0, fits: r.tds <= left + 0.005 ? 1 : 0, sec: !sec || TDSCH.secOk(sec, r.section) ? 1 : 0, near: !early && (rm === cd.slice(0, 6) || rm === prevYm(cd.slice(0, 6))) ? 1 : 0 };
}
const fitSort = (a, b) => a.early - b.early || a.adv - b.adv || (b.sg || 0) - (a.sg || 0) || b.fits - a.fits || b.sec - a.sec || b.near - a.near || TDS.ymd(a.r.date).localeCompare(TDS.ymd(b.r.date)) || String(a.r.id).localeCompare(String(b.r.id));
function candidates(c, rows, m, cx) {
  const left = TDSReg.balance(c, cx).tax;
  return unplaced(rows).map((r) => {
    const s = m && m.byRow[r.id], f = fitOf(c, r, left), sg = !f.early && s && s.chId === c.id && s.rule !== "split" ? 1 : 0;
    return { r, s: sg ? s : null, sg, ...f };
  }).sort(fitSort);
}

function AddList({ c, rows, m, form, locked, probs }) {
  const cx = TDSReg.ctx(), all = candidates(c, rows, m, cx), left = TDSReg.balance(c, cx).tax;
  const close = () => { S.tdsWinAdd = ""; S.tdsWinSel = {}; render(); };
  const put = (x) => {
    const y = x.s ? TDSCH.tag([x.r.id], c.id, { via: "suggestion", note: "suggestion confirmed: " + x.s.words + (x.s.rule === "g" ? " (" + x.s.reason + ")" : "") }) : TDSMatch.move([x.r.id], c.id);
    if (!y.ok) toast(y.why); render();
  };
  // the owner (19-Oct-2026): with every deduction on some challan the list was empty; this return's deductions on OTHER
  // challans follow, each with Move here (the move refused beyond this challan's balance; a confirm when it would leave
  // the other challan, now fully used, with tax unaccounted)
  const ids = chIds(), byId = Object.fromEntries(TDS.challans().map((x) => [x.id, x]));
  const othersAll = rows.filter((r) => r.tds > 0.005 && r.challan && r.challan !== c.id && ids.has(r.challan)).map((r) => ({ r, o: byId[r.challan], ...fitOf(c, r, left) })).sort(fitSort);
  const at = (x) => x.r, early = (x) => x.early;
  const cfA = useCF("wd-add", dedDefs(probs, at, early), all), list = cfA.shown;
  const cfO = useCF("wd-other", dedDefs(probs, at, early).concat([{ k: "on", title: "On", kind: "pick", get: (x) => x.o.serial + " · " + day(x.o.date) }]), othersAll), others = cfO.shown;
  // the ticks (S.tdsWinSel): rows shown in either list; one deducted after this challan's date is never ticked
  const sel = S.tdsWinSel || {}, shown = list.concat(others), can = shown.filter((x) => !x.early && !locked);
  const picked = all.concat(othersAll).filter((x) => sel[x.r.id] && !x.early), tot = r2(picked.reduce((a, x) => a + x.r.tds, 0)), after = r2(left - tot);
  const tick = (id, on) => { S.tdsWinSel = Object.assign({}, sel, { [id]: on }); if (!on) delete S.tdsWinSel[id]; render(); };
  // "Select all shown" in each list's heading: that list's rows shown and tickable
  const canOf = (l) => l.filter((x) => !x.early && !locked), allOf = (l) => canOf(l).length > 0 && canOf(l).every((x) => sel[x.r.id]);
  const tickAll = (l, on) => { const n = Object.assign({}, sel); canOf(l).forEach((x) => { if (on) n[x.r.id] = true; else delete n[x.r.id]; }); S.tdsWinSel = n; render(); };
  const tkAll = (l, k) => <th className="ck">{canOf(l).length > 0 ? <input type="checkbox" checked={allOf(l)} data-wd-tickall={k} aria-label="Select all shown" title={"Select all shown (" + canOf(l).length + ")"} onChange={(ev) => tickAll(l, ev.target.checked)} /> : <span className="sr-only">Tick</span>}</th>;
  const moveHere = async (r) => {
    const o = byId[r.challan], ob = TDSReg.balance(o, cx).tax;
    if (r.tds > left + 0.005) { toast(money(left) + " left on this challan: " + money(r.tds) + " does not fit."); return; }
    if (Math.abs(ob) < 0.005 && !(await askConfirm({ title: "Move it off challan " + o.serial + "?", body: esc("Challan " + o.serial + " · " + day(o.date) + " is fully used now; it would then have " + money(r.tds) + " not on any deduction."), ok: "Move here" }))) return;
    const y = TDSMatch.move([r.id], c.id); if (!y.ok) toast(y.why); render();
  };
  // the ticked rows moved here in one go (TDSMatch.move: refused beyond the balance), one Undo for all of them
  const bulk = async () => {
    if (!picked.length || tot > left + 0.005) return;
    const full = Array.from(new Set(picked.filter((x) => x.o).map((x) => x.o))).filter((o) => Math.abs(TDSReg.balance(o, cx).tax) < 0.005);
    if (full.length && !(await askConfirm({ title: "Move " + picked.length + " deduction" + (picked.length === 1 ? "" : "s") + " here?", body: esc("Challan " + full.map((o) => o.serial + " · " + day(o.date)).join(", ") + (full.length === 1 ? " is" : " are") + " fully used now; it would then have tax not on any deduction."), ok: "Move here" }))) return;
    const was = picked.map((x) => [x.r.id, x.o ? x.o.id : ""]);
    const y = TDSMatch.move(picked.map((x) => x.r.id), c.id);
    if (!y.ok) { toast(y.why); render(); return; }
    S.tdsWinSel = {};
    toast(y.n + " deduction" + (y.n === 1 ? "" : "s") + " moved to challan " + c.serial + ".", { actions: [{ label: "Undo", run: () => { undoMove(was); render(); } }] });
    render();
  };
  const tk = (x) => <td className="ck"><input type="checkbox" checked={!!sel[x.r.id] && !x.early} disabled={locked || !!x.early} data-wd-tick={x.r.id}
    aria-label={"Tick " + (x.r.party || x.r.employee || "this deduction")} title={x.early ? TDSEdit.badOf(x.r, c).words : undefined}
    onChange={(ev) => tick(x.r.id, ev.target.checked)} /></td>;
  const why = (x) => { const b = x.early ? TDSEdit.badOf(x.r, c) : null;
    return b ? <span className="wd-chip bad" data-wd-early={x.r.id} title={b.words}>{chipW(b)}</span> : null; };
  const note = (x) => (x.note ? <span className="wd-chip info" data-wd-note={x.note.k} title={x.note.words}>{chipW(x.note)}</span> : null);
  const nm = (r) => <td data-wd-name={r.id}><DedName r={r} locked={locked} /></td>;
  return <SideDrawer open onClose={close} kind="wd-add" wide title={"Add to challan " + c.serial + " · " + day(c.date)} description={money(left) + " left · " + all.length + " not on a challan"}>
    <div data-wd-addlist={c.id}>
      {!locked && (form === "26Q" || form === "27Q") && <p className="wd-addnew"><button type="button" className="btn small" data-wd-new="" onClick={() => { S.tdsWinAdd = ""; openAdd({ chId: c.id }); }}>Type a new deduction…</button></p>}
      <h4 className="wd-addh" data-wd-addh="none">Not on any challan ({all.length})</h4>
      {all.length ? <div className="bk-tablewrap"><table className="bk-table wd-cands gf-off" data-wd-none="">
        <thead><tr>{tkAll(list, "none")}<Th cf={cfA} k="name">Name</Th><Th cf={cfA} k="sec">Section</Th><Th cf={cfA} k="date" cls="dt">Date</Th><Th cf={cfA} k="tds" cls="n">TDS</Th><th></th><th className="ac"></th></tr></thead>
        <tbody>{list.map((x) => <tr key={x.r.id} data-wd-cand={x.r.id} className={x.fits && !x.early ? "" : "wd-over"}>{tk(x)}
          {nm(x.r)}<td>{secOf(x.r)}</td><td className="dt">{day(x.r.date)}</td><td className="n">{money(x.r.tds)}</td>
          <td>{why(x) || note(x) || (x.sg ? <span className="tag info" title={x.s.reason}>suggested</span> : !x.sec ? <span className="wd-dim">other section</span> : null)}</td>
          <td>{x.early ? null : x.fits ? <button type="button" className="btn small" disabled={locked} data-wd-put={x.r.id} aria-label={"Put on this challan: " + (x.r.party || "")} onClick={() => put(x)}>Add</button>
            : <button type="button" className="linkbtn" data-wd-split={x.r.id} disabled={locked || left < 0.005} title={"More than the " + money(left) + " left"} onClick={() => { S.tdsWinAdd = ""; tdsSplitRow(x.r.id, c.id); }}>Split…</button>}</td></tr>)}</tbody>
          {cfA.on && <tfoot><tr className="wd-cffoot"><td colSpan={7}>{cfA.foot()}</td></tr></tfoot>}</table></div>
        : <p className="note" data-wd-allon="">All deductions are on a challan. To move one here, pick it below.</p>}
      <h4 className="wd-addh" data-wd-addh="other">On other challans ({othersAll.length})</h4>
      {othersAll.length > 0 && <div className="bk-tablewrap"><table className="bk-table wd-cands gf-off" data-wd-others="">
        <thead><tr>{tkAll(others, "other")}<Th cf={cfO} k="name">Name</Th><Th cf={cfO} k="sec">Section</Th><Th cf={cfO} k="date" cls="dt">Date</Th><Th cf={cfO} k="tds" cls="n">TDS</Th><Th cf={cfO} k="on">On</Th><th className="ac"></th></tr></thead>
        <tbody>{others.map((x) => { const r = x.r, o = x.o, ok = x.fits && !x.early;
          return <tr key={r.id} data-wd-other={r.id} className={ok ? "" : "wd-over"}>{tk(x)}
            {nm(r)}<td>{secOf(r)}</td><td className="dt">{day(r.date)}</td><td className="n">{money(r.tds)}</td>
            <td data-wd-on={o.id}>on {o.serial} · {day(o.date)}{earlyFor(r, o) ? <> <span className="wd-chip bad" data-wd-chip={TDSEdit.badOf(r, o).k} title={TDSEdit.badOf(r, o).words}>{chipW(TDSEdit.badOf(r, o))}</span></> : placeNote(r, o) ? <> {note({ note: placeNote(r, o) })}</> : null}</td>
            <td>{why(x) || <button type="button" className="btn small" data-wd-move={r.id} disabled={locked || !ok} title={ok ? "Take it off " + o.serial + " and put it on this challan" : "More than the " + money(left) + " left"} onClick={() => moveHere(r)}>Move here</button>}</td></tr>; })}</tbody>
          {cfO.on && <tfoot><tr className="wd-cffoot"><td colSpan={7}>{cfO.foot()}</td></tr></tfoot>}</table></div>}
      {picked.length > 0 && <div className="wd-bulk" data-wd-bulk={picked.length} data-tot={tot} data-after={after}>
        <span><b>{picked.length} selected</b> · TDS <b>{money(tot)}</b></span>
        <span data-wd-bulk-after={after} className={after < -0.005 ? "bad" : ""}>Balance after: <b>{money(after)}</b></span>
        {after < -0.005 && <span className="bad" data-wd-bulk-why="">{money(-after)} more than the {money(left)} left on this challan</span>}
        <span className="rt-sp" />
        <button type="button" className="linkbtn" data-wd-bulk-clear="" onClick={() => { S.tdsWinSel = {}; render(); }}>Clear</button>
        <button type="button" className="btn small primary" data-wd-bulk-move="" disabled={locked || after < -0.005} title={after < -0.005 ? "More than this challan's balance" : undefined} onClick={bulk}>Move to this challan</button></div>}
    </div></SideDrawer>;
}
// put deductions back where they were ([[row id, challan id or ""]]): the bulk move's Undo
function undoMove(was) {
  TDSMatch.takeOff(was.map((w) => w[0]));
  const by = {}; was.forEach(([id, ch]) => { if (ch) (by[ch] = by[ch] || []).push(id); });
  Object.keys(by).forEach((ch) => { const y = TDSMatch.move(by[ch], ch); if (!y.ok) toast(y.why); });
}

// next-tds-tidy2 (the owner: "Challan dated before the deduction · Move to another challan…" on 6 rows): each deduction on
// a challan that cannot pay it (next-tds-early: an earlier year's, a future one, not minor head 200; an advance challan of
// the same year is allowed and left), to the earliest challan of its section it can be on, dated on or after it, with enough left (the plan
// keeps count of what each challan has left); none such: taken off, so it is in "Pay a challan". [{r, from, to}]
export function earlyPlan(rows) {
  const cx = TDSReg.ctx(), chs = TDS.challans(), byId = Object.fromEntries(chs.map((x) => [x.id, x])), left = {};
  const bal = (c) => (left[c.id] != null ? left[c.id] : (left[c.id] = TDSReg.balance(c, cx).tax));
  return rows.filter((r) => r.challan && byId[r.challan] && earlyFor(r, byId[r.challan])).sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)))
    .map((r) => {
      const to = chs.filter((c) => c.id !== r.challan && !earlyFor(r, c) && TDS.ymd(c.date) >= TDS.ymd(r.date) && (!chSec(c) || TDSCH.secOk(chSec(c), r.section)) && bal(c) + 0.005 >= r.tds)
        .sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)) || String(a.id).localeCompare(String(b.id)))[0] || null;
      if (to) left[to.id] = r2(bal(to) - r.tds);
      return { r, from: byId[r.challan], to };
    });
}
async function fixEarly(rows) {
  const plan = earlyPlan(rows);
  if (!plan.length) return;
  const line = (x) => esc((x.r.party || x.r.employee || "?") + " · " + day(x.r.date) + " · " + money(x.r.tds) + ": " + x.from.serial + " (" + day(x.from.date) + ") → " + (x.to ? x.to.serial + " (" + day(x.to.date) + ")" : "no challan fits: Pay a challan"));
  const ok = await askConfirm({ title: "Put " + plan.length + " on the right challans?", ok: "Move", body: "<ul style=\"margin:0;padding-left:18px\">" + plan.map((x) => "<li>" + line(x) + "</li>").join("") + "</ul>" });
  if (!ok || !ok.ok) return;
  const was = plan.map((x) => [x.r.id, x.from.id]); let n = 0;
  plan.forEach((x) => { const y = x.to ? TDSMatch.move([x.r.id], x.to.id) : TDSMatch.takeOff([x.r.id]); if (y && y.ok) n++; else if (y) toast(y.why); });
  toast(n + " moved.", { actions: [{ label: "Undo", run: () => { undoMove(was); render(); } }] });
  render();
}

export function DedByChallan({ form, fy, q, rows, m, issueOf, probs, locked, todo, tools }) {
  const cx = TDSReg.ctx(), list = winChallans(form, fy, q, cx), key = TDSReg.key(form, fy, q);
  // the challan chosen belongs to its return: another return opened starts on its own default
  if (S.tdsWinRet && S.tdsWinRet !== key) { S.tdsWinCh = ""; S.tdsWinAdd = ""; S.tdsWinSel = {}; S.tdsWinRSel = {}; }
  S.tdsWinRet = key;
  if (S.tdsWinCh && S.tdsWinCh !== "__none" && !list.some((c) => c.id === S.tdsWinCh)) { const x = TDS.challans().find((c) => c.id === S.tdsWinCh); if (x) list.push(x); }
  const un = unplaced(rows), cur = chosenOf(list, rows, cx), c = cur === "__none" ? null : list.find((x) => x.id === cur);
  // the default kept as chosen, so the view stays on the challan once a deduction uses up its balance
  if (c && S.tdsWinCh !== cur) S.tdsWinCh = cur;
  const pick = (v) => { S.tdsWinCh = v; S.tdsWinAdd = ""; S.tdsWinRSel = {}; S.tdsWinSel = {}; render(); };
  const unit = form === "27EQ" ? ["collection", "collections"] : ["deduction", "deductions"];
  const onAll = c ? rows.filter((r) => r.challan === c.id).sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)) || String(a.id).localeCompare(String(b.id))) : [];
  const cf = useCF("wd-table", dedDefs(probs), onAll), on = cf.shown;
  const chBy = Object.fromEntries(TDS.challans().map((x) => [x.id, x])), earlyN = rows.filter((r) => r.challan && chBy[r.challan] && earlyFor(r, chBy[r.challan])).length;
  const C = (r, k, el) => <Cell r={r} k={k} form={form} locked={locked}>{el}</Cell>;
  const bal = c ? TDSReg.balance(c, cx).tax : 0, used = c ? TDSReg.usedTax(c, cx) : 0, here = c ? usedHere(c, key, cx) : 0;
  // the ticks of the challan's table (S.tdsWinRSel): Remove from challan in one go
  const rsel = S.tdsWinRSel || {}, rpicked = onAll.filter((r) => rsel[r.id]), rtot = r2(rpicked.reduce((a, r) => a + r.tds, 0));
  const rtick = (id, v) => { S.tdsWinRSel = Object.assign({}, rsel, { [id]: v }); if (!v) delete S.tdsWinRSel[id]; render(); };
  const rAll = on.length > 0 && on.every((r) => rsel[r.id]);
  const rtickAll = (v) => { const n = Object.assign({}, rsel); on.forEach((r) => { if (v) n[r.id] = true; else delete n[r.id]; }); S.tdsWinRSel = n; render(); };
  const removeSel = () => {
    const idl = rpicked.map((r) => r.id), y = TDSMatch.takeOff(idl);
    if (!y.ok) { toast(y.why); render(); return; }
    S.tdsWinRSel = {};
    toast(y.n + " deduction" + (y.n === 1 ? "" : "s") + " taken off challan " + c.serial + ".", { actions: [{ label: "Undo", run: () => { const z = TDSMatch.move(idl, c.id); if (!z.ok) toast(z.why); render(); } }] });
    render();
  };
  return <div className="wd" data-wd={key}>
    <div className="wd-top">
      <label className="wd-sel"><span>Select challan</span>
        <select data-wd-sel="" aria-label="Select challan" value={cur} onChange={(ev) => pick(ev.target.value)}>
          {list.map((x, i) => <option key={x.id} value={x.id}>{(i + 1) + " · " + day(x.date) + " · " + money(totalOf(x))}</option>)}
          {(un.length > 0 || cur === "__none") && <option value="__none">Not on any challan ({un.length})</option>}</select></label>
      {c && <span className="wd-chw" title={c.bsr + " · " + c.serial}>BSR {c.bsr} · serial {c.serial}{chSec(c) ? " · " + chSec(c) : ""}</span>}
      <span className="rt-sp" />
      {!locked && earlyN > 0 && <button type="button" className="btn small" data-wd-fix-early={earlyN} title="Each on a challan that cannot pay it (an earlier year's, a future one, not minor head 200) to the earliest challan of its section dated on or after it, with enough left" onClick={() => fixEarly(rows)}>Put {earlyN} on the right challans</button>}
      {tools}
    </div>
    {/* next-tds-tidy2 (the owner: "this should not be here"): no banner of deductions on a challan dated before them; the
        row's chip and Validate & file's error say it */}
    {!c ? todo
      : <><div className="bk-tablewrap wd-wrap"><table className="bk-table wd-table gf-off" data-wd-table={c.id}>
        <thead><tr><th className="ck">{!locked && on.length > 0 ? <input type="checkbox" checked={rAll} data-wd-rtickall="" aria-label="Select all shown" onChange={(ev) => rtickAll(ev.target.checked)} /> : <span className="sr-only">Tick</span>}</th>
          <Th cf={cf} k="name">Name</Th><th className="wd-flags"><span className="sr-only">Check</span></th><Th cf={cf} k="pan" cls="pan">PAN</Th><Th cf={cf} k="paid" cls="n">Amount paid</Th><Th cf={cf} k="credit" cls="dt">Paid date</Th><Th cf={cf} k="date" cls="dt">Deduction date</Th>
          <Th cf={cf} k="tds" cls="n">{form === "27EQ" ? "TCS" : "TDS"}</Th><Th cf={cf} k="rate" cls="n">Rate</Th><th>Reason lower/higher</th><Th cf={cf} k="sec">Section</Th><th className="n">Shortfall/Excess</th><th className="ck"><span className="sr-only">Take off</span></th></tr></thead>
        <tbody>{on.map((r) => { const iss = issueOf[r.id], short = iss ? r2(num(iss.short)) : 0, pi = placeIssues(r, c), pn = placeNote(r, c);
          return <tr key={r.id} data-wd-row={r.id} className={probs[r.id] ? "rt-fix" : undefined}>
            <td className="ck">{!locked && <input type="checkbox" checked={!!rsel[r.id]} data-wd-rtick={r.id} aria-label={"Tick " + (r.party || r.employee || "this deduction")} onChange={(ev) => rtick(r.id, ev.target.checked)} />}</td>
            <td className="wd-name" data-wd-name={r.id}><DedName r={r} locked={locked} title={(r.voucher ? "Voucher " + r.voucher + " · " : "") + "Details"} onOpen={() => { S.tdsRowDet = r.id; render(); }} /></td>
            <td className="wd-flags">{pi.length > 0 ? <span className="wd-chip bad" data-wd-chip={pi[0].k} title={pi.map((x) => x.words).join("; ")}>{chipW(pi[0])}</span>
              : pn ? <span className="wd-chip info" data-wd-chip={pn.k} title={pn.words}>{chipW(pn)}</span> : null}</td>
            <td className="pan">{Certs.validPan(r.pan) ? r.pan : (r.party || r.employee) ? <PanBox party={r.party || r.employee} compact /> : null}</td>
            <td className="n">{C(r, "paid", money(r.paid))}</td><td className="dt">{C(r, "credit", day(r.credit || r.date))}</td><td className="dt">{C(r, "date", day(r.date))}</td>
            <td className="n">{C(r, "tds", money(r.tds))}</td><td className="n">{C(r, "rate", r.rate != null ? r.rate + "%" : "")}</td><td><Reason r={r} form={form} /></td>
            <td>{C(r, "section", <span data-sec={TDS.sec(r.section)}>{TDS.sec(r.section) || r.section}</span>)}</td>
            <td className={"n" + (short > 0.005 ? " bad" : "")} title={iss ? "should be " + iss.expected + "%" : undefined}>{short ? money(short) : "0"}</td>
            <td className="ck">{!locked && <button type="button" className="icon" data-wd-off={r.id} aria-label={"Take off this challan: " + (r.party || "")} title="Take off this challan" onClick={() => { const y = TDSMatch.takeOff([r.id]); if (!y.ok) toast(y.why); render(); }}>✕</button>}</td></tr>; })}
          {!locked ? <tr className="wd-addrow"><td colSpan={13}><button type="button" className="linkbtn" data-wd-add-open={c.id} onClick={() => { S.tdsWinAdd = c.id; render(); }}>+ Add {unit[0]} to this challan</button></td></tr>
            : <tr className="wd-addrow"><td colSpan={13} className="note">The return is marked filed: open a correction to change it.</td></tr>}</tbody></table></div>
        {rpicked.length > 0 && <div className="wd-bulk" data-wd-rbulk={rpicked.length}>
          <span><b>{rpicked.length} selected</b> · TDS <b>{money(rtot)}</b></span><span>Balance after: <b data-wd-rbulk-after={r2(bal + rtot)}>{money(r2(bal + rtot))}</b></span>
          <span className="rt-sp" /><button type="button" className="linkbtn" onClick={() => { S.tdsWinRSel = {}; render(); }}>Clear</button>
          <button type="button" className="btn small" data-wd-bulk-off="" disabled={locked} onClick={removeSel}>Remove from challan</button></div>}
        <div className="wd-foot" data-wd-foot={c.id} data-amt={r2(num(c.tax))} data-here={here} data-used={used} data-bal={bal} data-n={onAll.length}>
          <span>Used here <b>{money(here)}</b></span>{Math.abs(used - here) > 0.005 && <span title="This return's and the other returns' TDS on the challan">Amount utilised (all returns) <b>{money(used)}</b></span>}
          <span>Balance <b className={bal < -0.005 ? "bad" : ""} data-wd-bal={bal}>{money(bal)}</b></span><span>Number of {unit[1]} <b>{onAll.length}</b></span>{cf.foot()}</div>
        {S.tdsWinAdd === c.id && <AddList c={c} rows={rows} m={m} form={form} locked={locked} probs={probs} />}</>}
  </div>;
}

// next-tds-interest (the owner, 20-Oct-2026): a challan's interest or others (fee) allocated to this return, typed in its row;
// saved on Enter or leaving the box (tdsPortionSet: past the challan's own, from its tax not used; refused past what it
// holds, the box back to what it was). The row's click (its deductions) is not set off from the box
function AllocCell({ x, which, locked }) {
  const [v, setV] = useState(null), cur = which === "int" ? x.int : x.oth;
  if (locked) return <td className="n">{amt0(cur)}</td>;
  const save = () => { if (v == null) return; const n = r2(num(v)); setV(null); if (Math.abs(n - cur) >= 0.005) tdsPortionSet(x.c.id, which === "int" ? n : x.int, which === "int" ? x.oth : n); };
  const stop = (ev) => ev.stopPropagation();
  return <td className="n chg-alloc" onClick={stop}><input type="text" inputMode="decimal" className="chg-in" {...{ ["data-chg-" + which]: x.c.id }} value={v == null ? (cur ? String(cur) : "") : v} placeholder="0"
    aria-label={(which === "int" ? "Interest" : "Others (fee)") + " allocated to this return from challan " + x.c.serial}
    onChange={(ev) => setV(ev.target.value)} onBlur={save} onKeyDown={(ev) => { stop(ev); if (ev.key === "Enter") ev.currentTarget.blur(); else if (ev.key === "Escape") setV(null); }} /></td>;
}

export function ChallanGrid({ fy, q, form, tallyPays }) {
  const cx = TDSReg.ctx(), list = winChallans(form, fy, q, cx), locked = TDSReg.locked(fy, q, form), key = TDSReg.key(form, fy, q);
  const [adding, setAdding] = useState(false), [pays, setPays] = useState(false), [pick, setPick] = useState(false), up = useRef(null);
  // next-tds-retchallans: a challan brought in by hand (Pick from other challans) can be taken out again while nothing of
  // this return is on it
  const pins = new Set(pinnedIds(key));
  const upload = async (fs) => { const r = await TDSCH.upload(fs); if (r && r.placed) say(r.placed + " new challan" + (r.placed === 1 ? "" : "s") + " added; what " + (r.placed === 1 ? "it pays is" : "they pay is") + " suggested on Deductions."); render(); };
  const nPays = tallyPays ? tallyPays.n : 0;
  const rows = list.map((c, i) => { const p = TDSReg.portionFor(c, form, fy, q, cx), b = TDSReg.balance(c, cx).tax;
    return { c, no: i + 1, int: num(p.interest), oth: num(p.fee), here: usedHere(c, key, cx), used: TDSReg.usedTax(c, cx), bal: b, ok: TDSReg.srcOf(c) === "upload" || !!c.cin }; });
  // next-tds-tidy2: the grid's filters in its headers (Date by month, Section, Type, Verified, the amounts); the totals are of
  // the challans shown, "n of N shown" in the foot while a filter is on
  const cf = useCF("chg", [
    { k: "date", title: "Date", kind: "pick", get: (x) => ymOf(x.c.date), label: monW },
    { k: "sec", title: "Section", kind: "pick", get: (x) => chSec(x.c) || "—" },
    { k: "tax", title: "Tax", kind: "num", get: (x) => x.c.tax },
    { k: "type", title: "Type", kind: "pick", get: (x) => String(x.c.minorHead || "200") },
    { k: "ok", title: "Verified", kind: "pick", get: (x) => (x.ok ? "Matched" : "Not checked") },
    { k: "bal", title: "Balance", kind: "num", get: (x) => x.bal },
  ], rows), shown = cf.shown;
  const sum = (f) => r2(shown.reduce((a, x) => a + f(x), 0));
  // round 94: "Used in all returns" only where some challan is used by another return too (else it repeats Used here)
  const allCol = rows.some((x) => Math.abs(x.used - x.here) > 0.005), rmCol = !locked && rows.some((x) => pins.has(x.c.id) && x.here < 0.005), cols = (allCol ? 17 : 16) + (rmCol ? 1 : 0);
  let dueAny = false; try { dueAny = TDSMatch.interestTable(form, fy, q).totals.due > 0; } catch (e) { /* the matcher not loaded */ }
  return <div className="chg" data-chg={TDSReg.key(form, fy, q)}>
    <div className="rt-tool" data-step-tool="">
      <span className="rt-sp" />
      {!locked && dueAny && <button type="button" className="btn small" data-chg-alloc-due="" title="Each challan's interest due on this return's late deductions, allocated to it" onClick={() => tdsAllocateDue()}>Allocate interest due</button>}
      <More label="Add challan" ariaLabel="Add challan" data-ret-add-challan="" items={[
        ["Pick from other challans of this year", () => setPick(true), { "data-cm-add": "pick" }],
        ["From a Tally TDS payment" + (nPays ? " (" + nPays + ")" : ""), () => setPays(true), { "data-cm-add": "tally" }],
        ["Type a new challan", () => setAdding(true), { "data-cm-add": "hand" }],
        ["Upload challans…", () => up.current && up.current.click(), { "data-cm-add": "upload" }],
        ["Open the challan register", () => tdsNav("register"), { "data-cm-add": "register" }],
        ["Match on two panels", () => { S.tdsChView = "match"; render(); }, { "data-chg-match": "" }],
      ]} />
      <input ref={up} type="file" multiple hidden data-challan-upload="" accept=".csv,.xls,.xlsx,.pdf,text/csv,application/pdf" onChange={(ev) => { const fs = Array.from(ev.target.files || []); ev.target.value = ""; upload(fs); }} />
    </div>
    {pays && tallyPays ? <div data-cm-tally-pays="">{tallyPays.el}<p className="note"><button className="linkbtn" onClick={() => setPays(false)}>Close</button></p></div> : null}
    <div className="bk-tablewrap chg-wrap"><table className="bk-table chg-table gf-off">
      <thead><tr><th className="n">No</th><Th cf={cf} k="date" cls="dt">Date</Th><Th cf={cf} k="sec">Section</Th><Th cf={cf} k="tax" cls="n">Tax</Th><th className="n">Interest</th><th className="n">Fee</th><th className="n">Others</th><th className="n">Total</th>
        <th>Serial</th><th>BSR</th><Th cf={cf} k="type">Type</Th><Th cf={cf} k="ok">Verified</Th><th className="n">Interest allocated</th><th className="n" title="The fee and others allocated to this return">Others allocated</th><th className="n" title="This return's TDS on the challan">Used here</th>{allCol && <th className="n" title="Every return's TDS on the challan">Used in all returns</th>}<Th cf={cf} k="bal" cls="n">Balance</Th>{rmCol && <th className="ac"><span className="sr-only">Remove</span></th>}</tr></thead>
      <tbody>{shown.map((x) => <tr key={x.c.id} data-chg-row={x.c.id} className="chg-click" tabIndex={0} title="Its deductions"
          onClick={() => openChallanDeductions(x.c.id)} onKeyDown={(ev) => { if (ev.key === "Enter") openChallanDeductions(x.c.id); }}>
        <td className="n">{x.no}</td><td className="dt">{day(x.c.date)}</td><td>{chSec(x.c) || "—"}</td><td className="n">{amt(x.c.tax)}</td><td className="n">{amt0(x.c.interest)}</td><td className="n">{amt0(x.c.fee)}</td><td className="n">{amt0(x.c.others)}</td><td className="n">{amt(totalOf(x.c))}</td>
        <td>{x.c.serial}</td><td>{x.c.bsr}</td><td title={TYPE[String(x.c.minorHead || "200")] || ""}>{String(x.c.minorHead || "200")}</td><td>{x.ok ? <span className="ac-chip ok" title="From the income-tax portal (its CIN)">Matched</span> : <span className="wd-dim" title="Typed or from Tally: not checked against the portal">Not checked</span>}</td>
        <AllocCell x={x} which="int" locked={locked} /><AllocCell x={x} which="oth" locked={locked} /><td className="n" data-chg-here={x.here}>{amt(x.here)}</td>{allCol && <td className="n">{amt(x.used)}</td>}<td className={"n" + (x.bal < -0.005 ? " bad" : "")} data-chg-bal={x.bal}>{amt(x.bal)}</td>
        {rmCol && <td className="ac">{pins.has(x.c.id) && x.here < 0.005 ? <button type="button" className="icon" data-chg-unpin={x.c.id} aria-label={"Remove from this return: challan " + x.c.serial} title="Remove from this return (brought in by hand; nothing of this return is on it)" onClick={(ev) => { ev.stopPropagation(); pinChallans(key, [x.c.id], false); }}>✕</button> : null}</td>}</tr>)}
        {!locked && <tr className="wd-addrow"><td colSpan={cols}><button type="button" className="linkbtn" data-chg-add="" onClick={() => setAdding(!adding)}>+ Add challan</button></td></tr>}</tbody>
      <tfoot><tr><td colSpan={3}>Total</td><td className="n" data-chg-tax={sum((x) => num(x.c.tax))}>{amt(sum((x) => num(x.c.tax)))}</td><td className="n">{amt(sum((x) => num(x.c.interest)))}</td><td className="n">{amt(sum((x) => num(x.c.fee)))}</td>
        <td className="n">{amt(sum((x) => num(x.c.others)))}</td><td className="n">{amt(sum((x) => totalOf(x.c)))}</td><td colSpan={4}></td><td className="n">{amt(sum((x) => x.int))}</td><td className="n">{amt(sum((x) => x.oth))}</td>
        <td className="n" data-chg-here-sum={sum((x) => x.here)}>{amt(sum((x) => x.here))}</td>{allCol && <td className="n">{amt(sum((x) => x.used))}</td>}<td className="n">{amt(sum((x) => x.bal))}</td>{rmCol && <td></td>}</tr>
        {cf.on && <tr className="wd-cffoot"><td colSpan={cols}>{cf.foot("challans")}</td></tr>}</tfoot></table></div>
    {adding && <AddChallan form={form} onDone={() => setAdding(false)} />}
    {pick && <PickChallans form={form} fy={fy} q={q} onClose={() => setPick(false)} />}
  </div>;
}
