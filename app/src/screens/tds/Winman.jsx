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
import More from "../../parts/More.jsx";
import { unplacedOf, usedHere, chIds, placeIssues, earlyFor } from "./onChallan.js";
import { DedName } from "./DedName.jsx";
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

// next-tds-addlist (the owner, 19-Oct-2026: "no filter anywhere ... there should be tick box system to move bulk"): the
// filters of a list of deductions (S.tdsWinF the drawer's, S.tdsWinTF the challan's table): name or PAN, section, month,
// on challan (the drawer: any, none, one), problems only
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monW = (ym) => MON[+String(ym).slice(4, 6) - 1] + " " + String(ym).slice(0, 4);
const prevYm = (ym) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 1 ? (y - 1) + "12" : y + String(m - 1).padStart(2, "0"); };
const secOf = (r) => TDS.sec(r.section) || r.section || "";
// a problem of a row besides "not on a challan" (TDSEdit.problems: no name, no valid PAN, the rate, its challan's date or section)
const hasProb = (r, probs) => ((probs || {})[r.id] || []).some((p) => p !== "not against a challan");
function passF(F, r, probs, extra) {
  const q = String(F.q || "").trim().toLowerCase();
  if (q && ![r.party, r.employee, r.pan, r.voucher, r.ledger].join(" ").toLowerCase().includes(q)) return false;
  if (F.sec && secOf(r) !== F.sec) return false;
  if (F.mon && TDS.ymd(r.date).slice(0, 6) !== F.mon) return false;
  if (F.prob && !(hasProb(r, probs) || extra)) return false;
  return true;
}
const fOn = (F) => !!(F.q || F.sec || F.mon || F.on || F.prob);
function Filters({ F, set, rows, ons, kind }) {
  const secs = Array.from(new Set(rows.map(secOf).filter(Boolean))).sort(), mons = Array.from(new Set(rows.map((r) => TDS.ymd(r.date).slice(0, 6)).filter((x) => x.length === 6))).sort();
  return <div className="wd-filters" data-wd-filters={kind}>
    <input type="search" className="wd-fq" value={F.q || ""} placeholder="Name or PAN" aria-label="Find by name or PAN" data-wd-f="q" onChange={(ev) => set("q", ev.target.value)} />
    <select value={F.sec || ""} aria-label="Section" data-wd-f="sec" onChange={(ev) => set("sec", ev.target.value)}><option value="">Every section</option>{secs.map((x) => <option key={x} value={x}>{x}</option>)}</select>
    <select value={F.mon || ""} aria-label="Month" data-wd-f="mon" onChange={(ev) => set("mon", ev.target.value)}><option value="">Every month</option>{mons.map((x) => <option key={x} value={x}>{monW(x)}</option>)}</select>
    {ons && <select value={F.on || ""} aria-label="On challan" data-wd-f="on" onChange={(ev) => set("on", ev.target.value)}><option value="">On challan: any</option><option value="none">Not on any challan</option>
      {ons.map((o) => <option key={o.id} value={"ch:" + o.id}>{"On " + o.serial + " · " + day(o.date)}</option>)}</select>}
    <label className="wd-fprob"><input type="checkbox" checked={!!F.prob} data-wd-f="prob" onChange={(ev) => set("prob", ev.target.checked ? "1" : "")} /> Problems only</label>
    {fOn(F) && <button type="button" className="linkbtn" data-wd-fclear="" onClick={() => set("", "")}>Clear</button>}
  </div>;
}
const setter = (key) => (k, v) => { S[key] = k ? Object.assign({}, S[key] || {}, { [k]: v }) : {}; render(); };

// the deductions not on a challan, best fit for this challan first: never one deducted after the challan was deposited
// (last, and it cannot be ticked), then its suggestions, those it can hold, of its section, deducted in its month or the
// month before (on or before its date), then by date
function fitOf(c, r, left) {
  const cd = TDS.ymd(c.date), sec = chSec(c), rm = TDS.ymd(r.date).slice(0, 6), early = earlyFor(r, c) ? 1 : 0;
  return { early, fits: r.tds <= left + 0.005 ? 1 : 0, sec: !sec || TDSCH.secOk(sec, r.section) ? 1 : 0, near: !early && (rm === cd.slice(0, 6) || rm === prevYm(cd.slice(0, 6))) ? 1 : 0 };
}
const fitSort = (a, b) => a.early - b.early || (b.sg || 0) - (a.sg || 0) || b.fits - a.fits || b.sec - a.sec || b.near - a.near || TDS.ymd(a.r.date).localeCompare(TDS.ymd(b.r.date)) || String(a.r.id).localeCompare(String(b.r.id));
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
  const F = S.tdsWinF || {}, setF = setter("tdsWinF");
  const list = F.on && F.on !== "none" ? [] : all.filter((x) => passF(F, x.r, probs, x.early));
  const others = F.on === "none" ? [] : othersAll.filter((x) => (!F.on || F.on === "ch:" + x.o.id) && passF(F, x.r, probs, x.early));
  const ons = Array.from(new Set(othersAll.map((x) => x.o))).sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)));
  // the ticks (S.tdsWinSel): rows shown in either list; one deducted after this challan's date is never ticked
  const sel = S.tdsWinSel || {}, shown = list.concat(others), can = shown.filter((x) => !x.early && !locked);
  const picked = all.concat(othersAll).filter((x) => sel[x.r.id] && !x.early), tot = r2(picked.reduce((a, x) => a + x.r.tds, 0)), after = r2(left - tot);
  const tick = (id, on) => { S.tdsWinSel = Object.assign({}, sel, { [id]: on }); if (!on) delete S.tdsWinSel[id]; render(); };
  const allOn = can.length > 0 && can.every((x) => sel[x.r.id]);
  const tickAll = (on) => { const n = Object.assign({}, sel); can.forEach((x) => { if (on) n[x.r.id] = true; else delete n[x.r.id]; }); S.tdsWinSel = n; render(); };
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
    aria-label={"Tick " + (x.r.party || x.r.employee || "this deduction")} title={x.early ? "Deducted " + day(x.r.date) + ", after this challan's date " + day(c.date) + ": this challan cannot pay it" : undefined}
    onChange={(ev) => tick(x.r.id, ev.target.checked)} /></td>;
  const why = (x) => (x.early ? <span className="wd-chip bad" data-wd-early={x.r.id}>after this challan's date</span> : null);
  const nm = (r) => <td data-wd-name={r.id}><DedName r={r} locked={locked} /></td>;
  const cnt = (n, of) => (fOn(F) ? n + " of " + of : String(of));
  return <SideDrawer open onClose={close} kind="wd-add" wide title={"Add to challan " + c.serial + " · " + day(c.date)} description={money(left) + " left · " + all.length + " not on a challan"}>
    <div data-wd-addlist={c.id}>
      {!locked && (form === "26Q" || form === "27Q") && <p className="wd-addnew"><button type="button" className="btn small" data-wd-new="" onClick={() => { S.tdsWinAdd = ""; openAdd({ chId: c.id }); }}>Type a new deduction…</button></p>}
      <Filters F={F} set={setF} rows={all.concat(othersAll).map((x) => x.r)} ons={ons} kind="add" />
      {can.length > 0 && <label className="wd-tickall"><input type="checkbox" checked={allOn} data-wd-tickall="" onChange={(ev) => tickAll(ev.target.checked)} /> Select all shown ({can.length})</label>}
      <h4 className="wd-addh" data-wd-addh="none">Not on any challan ({cnt(list.length, all.length)})</h4>
      {list.length ? <div className="bk-tablewrap"><table className="bk-table wd-cands gf-off">
        <thead><tr><th className="ck"><span className="sr-only">Tick</span></th><th>Name</th><th>Section</th><th className="dt">Date</th><th className="n">TDS</th><th></th><th></th></tr></thead>
        <tbody>{list.map((x) => <tr key={x.r.id} data-wd-cand={x.r.id} className={x.fits && !x.early ? "" : "wd-over"}>{tk(x)}
          {nm(x.r)}<td>{secOf(x.r)}</td><td>{day(x.r.date)}</td><td className="n">{money(x.r.tds)}</td>
          <td>{why(x) || (x.sg ? <span className="tag info" title={x.s.reason}>suggested</span> : !x.sec ? <span className="wd-dim">other section</span> : null)}</td>
          <td>{x.early ? null : x.fits ? <button type="button" className="btn small" disabled={locked} data-wd-put={x.r.id} aria-label={"Put on this challan: " + (x.r.party || "")} onClick={() => put(x)}>Add</button>
            : <button type="button" className="linkbtn" data-wd-split={x.r.id} disabled={locked || left < 0.005} title={"More than the " + money(left) + " left"} onClick={() => { S.tdsWinAdd = ""; tdsSplitRow(x.r.id, c.id); }}>Split…</button>}</td></tr>)}</tbody></table></div>
        : all.length ? <p className="note" data-wd-nonefit="">None shown: change the filters.</p> : <p className="note" data-wd-allon="">All deductions are on a challan. To move one here, pick it below.</p>}
      <h4 className="wd-addh" data-wd-addh="other">On other challans ({cnt(others.length, othersAll.length)})</h4>
      {others.length > 0 && <div className="bk-tablewrap"><table className="bk-table wd-cands gf-off" data-wd-others="">
        <thead><tr><th className="ck"><span className="sr-only">Tick</span></th><th>Name</th><th>Section</th><th className="dt">Date</th><th className="n">TDS</th><th>On</th><th></th></tr></thead>
        <tbody>{others.map((x) => { const r = x.r, o = x.o, ok = x.fits && !x.early;
          return <tr key={r.id} data-wd-other={r.id} className={ok ? "" : "wd-over"}>{tk(x)}
            {nm(r)}<td>{secOf(r)}</td><td>{day(r.date)}</td><td className="n">{money(r.tds)}</td>
            <td data-wd-on={o.id}>on {o.serial} · {day(o.date)}{earlyFor(r, o) ? <> <span className="wd-chip bad" data-wd-chip="early">Challan dated before the deduction</span></> : null}</td>
            <td>{why(x) || <button type="button" className="btn small" data-wd-move={r.id} disabled={locked || !ok} title={ok ? "Take it off " + o.serial + " and put it on this challan" : "More than the " + money(left) + " left"} onClick={() => moveHere(r)}>Move here</button>}</td></tr>; })}</tbody></table></div>}
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
  const TF = S.tdsWinTF || {}, on = onAll.filter((r) => passF(TF, r, probs));
  const C = (r, k, el) => <Cell r={r} k={k} form={form} locked={locked}>{el}</Cell>;
  const bal = c ? TDSReg.balance(c, cx).tax : 0, used = c ? TDSReg.usedTax(c, cx) : 0, here = c ? usedHere(c, key, cx) : 0;
  // the return's deductions on a challan dated before them (none can stand: Validate & file refuses the file)
  const chBy = Object.fromEntries(TDS.challans().map((x) => [x.id, x])), early = rows.filter((r) => r.challan && earlyFor(r, chBy[r.challan]));
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
      <span className="rt-sp" />{tools}
    </div>
    {early.length > 0 && <p className="wd-un wd-bad" data-wd-early-n={early.length}>{early.length} {early.length === 1 ? unit[0] + " is" : unit[1] + " are"} on a challan dated before the deduction: a challan cannot pay tax deducted after it was deposited · <button type="button" className="linkbtn" data-wd-early-show="" onClick={() => pick("__none")}>Fix</button></p>}
    {!c ? todo
      : <>{onAll.length > 0 && <Filters F={TF} set={setter("tdsWinTF")} rows={onAll} kind="table" />}
        {fOn(TF) && <p className="wd-dim" data-wd-shown={on.length + "|" + onAll.length}>Showing {on.length} of {onAll.length}</p>}
        <div className="bk-tablewrap wd-wrap"><table className="bk-table wd-table gf-off" data-wd-table={c.id}>
        <thead><tr><th className="ck">{!locked && on.length > 0 ? <input type="checkbox" checked={rAll} data-wd-rtickall="" aria-label="Select all shown" onChange={(ev) => rtickAll(ev.target.checked)} /> : <span className="sr-only">Tick</span>}</th>
          <th>Name</th><th>PAN</th><th className="n">Amount paid</th><th className="dt">Paid date</th><th className="dt">Deduction date</th><th className="n">{form === "27EQ" ? "TCS" : "TDS"}</th><th className="n">Rate</th><th>Reason lower/higher</th><th>Section</th><th className="n">Shortfall/Excess</th><th className="ck"><span className="sr-only">Take off</span></th></tr></thead>
        <tbody>{on.map((r) => { const iss = issueOf[r.id], short = iss ? r2(num(iss.short)) : 0, pi = placeIssues(r, c);
          return <tr key={r.id} data-wd-row={r.id} className={probs[r.id] ? "rt-fix" : undefined}>
            <td className="ck">{!locked && <input type="checkbox" checked={!!rsel[r.id]} data-wd-rtick={r.id} aria-label={"Tick " + (r.party || r.employee || "this deduction")} onChange={(ev) => rtick(r.id, ev.target.checked)} />}</td>
            <td className="wd-name" data-wd-name={r.id}><DedName r={r} locked={locked} title={(r.voucher ? "Voucher " + r.voucher + " · " : "") + "Details"} onOpen={() => { S.tdsRowDet = r.id; render(); }} />
              {pi.map((x) => <span key={x.k} className="wd-chip bad" data-wd-chip={x.k}>{x.words}</span>)}</td>
            <td>{Certs.validPan(r.pan) ? r.pan : (r.party || r.employee) ? <PanBox party={r.party || r.employee} compact /> : null}</td>
            <td className="n">{C(r, "paid", money(r.paid))}</td><td className="dt">{C(r, "credit", day(r.credit || r.date))}</td><td className="dt">{C(r, "date", day(r.date))}</td>
            <td className="n">{C(r, "tds", money(r.tds))}</td><td className="n">{C(r, "rate", r.rate != null ? r.rate + "%" : "")}</td><td><Reason r={r} form={form} /></td>
            <td>{C(r, "section", <span data-sec={TDS.sec(r.section)}>{TDS.sec(r.section) || r.section}</span>)}</td>
            <td className={"n" + (short > 0.005 ? " bad" : "")} title={iss ? "should be " + iss.expected + "%" : undefined}>{short ? money(short) : "0"}</td>
            <td className="ck">{!locked && <button type="button" className="icon" data-wd-off={r.id} aria-label={"Take off this challan: " + (r.party || "")} title="Take off this challan" onClick={() => { const y = TDSMatch.takeOff([r.id]); if (!y.ok) toast(y.why); render(); }}>✕</button>}</td></tr>; })}
          {!locked ? <tr className="wd-addrow"><td colSpan={12}><button type="button" className="linkbtn" data-wd-add-open={c.id} onClick={() => { S.tdsWinAdd = c.id; render(); }}>+ Add {unit[0]} to this challan</button></td></tr>
            : <tr className="wd-addrow"><td colSpan={12} className="note">The return is marked filed: open a correction to change it.</td></tr>}</tbody></table></div>
        {rpicked.length > 0 && <div className="wd-bulk" data-wd-rbulk={rpicked.length}>
          <span><b>{rpicked.length} selected</b> · TDS <b>{money(rtot)}</b></span><span>Balance after: <b data-wd-rbulk-after={r2(bal + rtot)}>{money(r2(bal + rtot))}</b></span>
          <span className="rt-sp" /><button type="button" className="linkbtn" onClick={() => { S.tdsWinRSel = {}; render(); }}>Clear</button>
          <button type="button" className="btn small" data-wd-bulk-off="" disabled={locked} onClick={removeSel}>Remove from challan</button></div>}
        <div className="wd-foot" data-wd-foot={c.id} data-amt={r2(num(c.tax))} data-here={here} data-used={used} data-bal={bal} data-n={onAll.length}>
          <span>Used here <b>{money(here)}</b></span>{Math.abs(used - here) > 0.005 && <span title="This return's and the other returns' TDS on the challan">Amount utilised (all returns) <b>{money(used)}</b></span>}
          <span>Balance <b className={bal < -0.005 ? "bad" : ""} data-wd-bal={bal}>{money(bal)}</b></span><span>Number of {unit[1]} <b>{onAll.length}</b></span></div>
        {S.tdsWinAdd === c.id && <AddList c={c} rows={rows} m={m} form={form} locked={locked} probs={probs} />}</>}
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
  // round 94: "Used in all returns" only where some challan is used by another return too (else it repeats Used here)
  const allCol = rows.some((x) => Math.abs(x.used - x.here) > 0.005), cols = allCol ? 17 : 16;
  return <div className="chg" data-chg={TDSReg.key(form, fy, q)}>
    <div className="rt-tool" data-step-tool="">
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
        <th>Serial</th><th>BSR</th><th>Type</th><th>Verified</th><th className="n">Interest allocated</th><th className="n">Others allocated</th><th className="n" title="This return's TDS on the challan">Used here</th>{allCol && <th className="n" title="Every return's TDS on the challan">Used in all returns</th>}<th className="n">Balance</th></tr></thead>
      <tbody>{rows.map((x) => <tr key={x.c.id} data-chg-row={x.c.id} className="chg-click" tabIndex={0} title="Its deductions"
          onClick={() => openChallanDeductions(x.c.id)} onKeyDown={(ev) => { if (ev.key === "Enter") openChallanDeductions(x.c.id); }}>
        <td className="n">{x.no}</td><td className="dt">{day(x.c.date)}</td><td>{chSec(x.c) || "—"}</td><td className="n">{amt(x.c.tax)}</td><td className="n">{amt0(x.c.interest)}</td><td className="n">{amt0(x.c.fee)}</td><td className="n">{amt0(x.c.others)}</td><td className="n">{amt(totalOf(x.c))}</td>
        <td>{x.c.serial}</td><td>{x.c.bsr}</td><td title={TYPE[String(x.c.minorHead || "200")] || ""}>{String(x.c.minorHead || "200")}</td><td>{x.ok ? <span className="ac-chip ok" title="From the income-tax portal (its CIN)">Matched</span> : <span className="wd-dim" title="Typed or from Tally: not checked against the portal">Not checked</span>}</td>
        <td className="n">{amt0(x.int)}</td><td className="n">{amt0(x.oth)}</td><td className="n" data-chg-here={x.here}>{amt(x.here)}</td>{allCol && <td className="n">{amt(x.used)}</td>}<td className={"n" + (x.bal < -0.005 ? " bad" : "")} data-chg-bal={x.bal}>{amt(x.bal)}</td></tr>)}
        {!locked && <tr className="wd-addrow"><td colSpan={cols}><button type="button" className="linkbtn" data-chg-add="" onClick={() => setAdding(!adding)}>+ Add challan</button></td></tr>}</tbody>
      <tfoot><tr><td colSpan={3}>Total</td><td className="n" data-chg-tax={sum((x) => num(x.c.tax))}>{amt(sum((x) => num(x.c.tax)))}</td><td className="n">{amt(sum((x) => num(x.c.interest)))}</td><td className="n">{amt(sum((x) => num(x.c.fee)))}</td>
        <td className="n">{amt(sum((x) => num(x.c.others)))}</td><td className="n">{amt(sum((x) => totalOf(x.c)))}</td><td colSpan={4}></td><td className="n">{amt(sum((x) => x.int))}</td><td className="n">{amt(sum((x) => x.oth))}</td>
        <td className="n" data-chg-here-sum={sum((x) => x.here)}>{amt(sum((x) => x.here))}</td>{allCol && <td className="n">{amt(sum((x) => x.used))}</td>}<td className="n">{amt(sum((x) => x.bal))}</td></tr></tfoot></table></div>
    {adding && <AddChallan form={form} onDone={() => setAdding(false)} />}
  </div>;
}
