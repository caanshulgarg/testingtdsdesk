// The Deductions step as a to-do list (next-tds-allchallans, 19-Oct-2026; the owner: the deductions table is "still very
// confusing … still grey area"; his layout):
//   Deductions · Form 140 · Q2 2026-27
//   38 deductions · 20 done · 18 need you
//   ▼ CONFIRM (6)            [Confirm all 6]   each row: → Challan <BSR · date · serial> (why)  [Confirm] [Other]
//   ▼ CHOOSE A CHALLAN (n)   several fit, or none has enough left: the best 2–3 challans with their balance, one click
//   ▼ PAY A CHALLAN (8)      one block per section-month: "194C July · ₹14,142 due" [Add challan] [Paid in Tally? Add BSR]
//   ▼ FIX THE ROW (4)        on a challan, but the row itself is wrong: no PAN [Add PAN], a rate [Fix rate], …
//   ► DONE (20)              folded: on challans, nothing to do; each with its challan and a small Change
// Each row is in ONE group (the challan first: a row with no challan and no PAN is under its challan's group, its "no PAN"
// said beside the name, and goes to Fix the row once it is on a challan). Each row: Deductee · Section · Date · Amount
// paid · TDS, then its one action. Empty groups are not shown; with nothing to do, "All N deductions are on challans ✓".
// The decisions are TDSMatch's (src/js/86: suggest, reasons and their section-month groups); nothing is worked out here
// but the order of the challans offered (the section's, then the month's, then the smallest balance that holds it).
import { useState } from "react";
import "../../lib/tdsGlobals.js";
import { AddChallan } from "./Register.jsx";
import { PanBox } from "./PanBook.jsx";
import { fixesOf } from "./DedSmart.jsx";
import { openAllChallans } from "./AllChallans.jsx";
import { chIds, chMissing, missingName } from "./onChallan.js";
import "./clear.css";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const dm6 = (d) => day(d).slice(0, 6);
const chSec = (c) => TDSCH.secNorm(c.section) || "";
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthWords = (ym) => MON[+String(ym).slice(4, 6) - 1] + " " + String(ym).slice(0, 4);
const chWords = (c) => c.bsr + " · " + day(c.date) + " · " + c.serial;

// a row's own problem (not its challan): {k, words} or null
export function rowProblem(r, issue, probs, form) {
  if (!Certs.validPan(r.pan)) return { k: "pan", words: "no PAN" };
  if (Certs.inoperative && Certs.inoperative(r.pan)) return { k: "pan", words: "PAN inoperative" };
  if (issue && issue.expected != null) return { k: "rate", words: "rate " + r.rate + "%, should be " + issue.expected + "%" };
  const p = (probs || []).filter((x) => x !== "not against a challan" && x !== "no valid PAN" && x !== "PAN inoperative" && !/^rate /.test(x));
  return p.length ? { k: "other", words: p[0] } : null;
}

// the challans that can take a row, best first: [{c, left}] (left: tax left now)
export function bestChallans(r, cx) {
  const ym = TDS.ymd(r.date).slice(0, 6);
  return TDS.challans().map((c) => ({ c, left: r2(TDSReg.balance(c, cx).tax) })).filter((x) => x.left > 0.005)
    .map((x) => ({ ...x, fits: x.left + 0.005 >= r.tds, sec: chSec(x.c) && TDSCH.secOk(chSec(x.c), r.section) ? 1 : 0, mon: TDS.ymd(x.c.date).slice(0, 6) >= ym ? 1 : 0 }))
    .sort((a, b) => b.fits - a.fits || b.sec - a.sec || b.mon - a.mon || a.left - b.left || TDS.ymd(a.c.date).localeCompare(TDS.ymd(b.c.date)));
}

// which group a row is in: {g: "confirm" | "choose" | "pay" | "fix" | "done", s, w, grp, prob}
// round 89: a row pointing at a challan that is not here is to choose again (ids: the challans here, onChallan.js)
export function groupOf(r, m, issue, probs, form, ids) {
  const prob = rowProblem(r, issue, probs, form);
  if (r.tds > 0.005 && chMissing(r, ids)) return { g: "choose", miss: r.challan, prob };
  if (r.challan || !(r.tds > 0.005)) return { g: prob ? "fix" : "done", prob };
  const s = m.byRow[r.id], w = m.why[r.id];
  if (s && s.rule !== "split" && s.rule !== "int") return { g: "confirm", s, prob };
  if (s && s.rule === "split") return { g: "choose", s, w, prob };
  if (w && w.group) return { g: "pay", w, grp: w.group, prob };
  if (w && w.step === "check") return { g: "fix", w, prob: prob || { k: "other", words: "no tax deducted" } };
  if (w && (w.step === "move" || w.step === "pay" || w.step === "split")) return { g: "choose", w, prob };
  return { g: "pay", w, prob };
}

const Cells = ({ r, prob }) => <>
  <td className="dt-p"><button type="button" className="linkbtn dt-name" data-row-detail={r.id} onClick={() => { S.tdsRowDet = r.id; render(); }}>{r.party || r.employee}</button>
    {prob ? <span className="dt-flag" data-dt-flag={prob.k}>{prob.words}</span> : null}</td>
  <td className="dt-s">{TDS.sec(r.section) || r.section}</td><td className="dt-d">{dm6(r.date)}</td>
  <td className="n dt-a">{money(r.paid)}</td><td className="n dt-t">TDS {money(r.tds)}</td></>;

function Group({ k, title, n, tone, extra, open = true, children }) {
  return <details className={"dt-g dt-" + tone} data-dt-group={k} data-dt-n={n} open={open || undefined}>
    <summary className="dt-gh"><span className="dt-gt">{title} ({n})</span>{extra ? <span className="dt-gx" onClick={(ev) => ev.stopPropagation()}>{extra}</span> : null}</summary>
    {children}
  </details>;
}
const Table = ({ children }) => <div className="dt-wrap"><table className="dt-table"><tbody>{children}</tbody></table></div>;

function ConfirmRow({ r, x, locked }) {
  const c = TDS.challans().find((z) => z.id === x.s.chId);
  const yes = () => { const y = TDSCH.tag([r.id], x.s.chId, { via: "suggestion", note: "suggestion confirmed: " + x.s.words + (x.s.rule === "g" ? " (" + x.s.reason + ")" : "") }); if (!y.ok) toast(y.why); render(); };
  return <tr data-dt-row={r.id} data-dt-in="confirm"><Cells r={r} prob={x.prob} />
    <td className="dt-act"><span className="dt-to" data-dd-sugg-cell={r.id}>→ Challan <b>{c ? chWords(c) : x.s.chId}</b> <span className="dt-why">({x.s.rule === "g" || x.s.ai ? "AI: " : ""}{x.s.words || x.s.reason})</span></span>
      {!locked && <span className="dt-btns"><button type="button" className="btn small dt-do" data-dd-sugg={r.id} data-dt-confirm={r.id} onClick={yes}>Confirm</button>
        <button type="button" className="btn small" data-dt-other={r.id} onClick={() => tdsMoveOpen([r.id])}>Other</button></span>}</td></tr>;
}

function ChooseRow({ r, x, locked, cx }) {
  const best = bestChallans(r, cx), secFit = best.filter((b) => b.fits && b.sec), fit = (secFit.length ? secFit : best.filter((b) => b.fits)).slice(0, 3);
  const pick = (id) => { const y = TDSMatch.move([r.id], id); if (!y.ok) toast(y.why); render(); };
  const split = () => (x.s ? tdsSplitOpen(x.s.key) : tdsSplitRow(r.id, best[0] ? best[0].c.id : ""));
  return <tr data-dt-row={r.id} data-dt-in="choose"><Cells r={r} prob={x.prob} />
    <td className="dt-act">{x.miss ? <span className="dt-why bad" data-dt-miss={x.miss}>Its challan {missingName(x.miss)} is missing — choose again</span>
      : fit.length ? <span className="dt-why">Pick the challan that paid it:</span>
        : <span className="dt-why">{x.s ? x.s.reason : x.w ? x.w.words : "No one challan has enough left."}</span>}
      {!locked && <span className="dt-btns">{fit.map((b) => <button key={b.c.id} type="button" className="btn small dt-pick dt-do" data-dt-pick={b.c.id} onClick={() => pick(b.c.id)}>
          {b.c.serial} · {dm6(b.c.date)}{chSec(b.c) ? " · " + chSec(b.c) : ""} · {money(b.left)} left</button>)}
        {!fit.length && best.length > 0 && <button type="button" className="btn small dt-do" data-dt-split={r.id} onClick={split}>Split across challans…</button>}
        <button type="button" className="btn small" data-dt-other={r.id} onClick={() => tdsMoveOpen([r.id])}>Other</button></span>}</td></tr>;
}

// what a section-month block needs paid: the group's (in paise: TDS and interest to today; a payment in Tally named, its
// TDS) or the rows' TDS
const blockDue = (b) => (b.grp ? r2((b.grp.pay || b.grp.tds) / 100) : r2(b.rows.reduce((a, it) => a + (it.r ? it.r.tds : it.tds), 0)));

function PayBlock({ b, form, fy, locked, rows }) {
  const [add, setAdd] = useState(false), [bsr, setBsr] = useState(""), [ser, setSer] = useState(""), [pay, setPay] = useState(false);
  const g = b.grp, cin = !!TDSCH.cin(bsr), due = blockDue(b);
  return <div className="dt-pay" data-dt-pay={b.key}>
    <div className="dt-payh"><b data-dt-pay-head="">{b.sec} · {monthWords(b.ym)} · {money(due)} due</b>
      <span className="dt-payw">{rows.length} deduction{rows.length === 1 ? "" : "s"}{g && g.paid ? " · paid in Tally on " + day(g.paid.date) + ", no BSR code yet" : " · no challan paid yet"}</span>
      {!locked && <span className="dt-btns"><button type="button" className="btn small dt-do" data-dt-add={b.key} data-dd-group-add={b.key} onClick={() => setAdd(!add)}>{add ? "Close" : "Add challan"}</button>
        <button type="button" className="btn small" data-dt-bsr={b.key} onClick={() => { if (g && g.paid) { setPay(!pay); return; } openAllChallans(fy, { fy, q: S.tdsQ, form }); S.allchFl = { st: "bsr" }; render(); }}>Paid in Tally? Add BSR</button></span>}</div>
    {pay && g && g.paid && <div className="dt-paybox" data-dd-group-pay={g.paid.vid}>
      <input type="text" value={bsr} placeholder="BSR code or the CIN" aria-label="BSR code or CIN" onChange={(ev) => setBsr(ev.target.value)} autoFocus />
      <input type="text" value={cin ? TDSCH.cin(bsr).serial : ser} disabled={cin} placeholder="Serial" aria-label="Challan serial" onChange={(ev) => setSer(ev.target.value)} />
      <button type="button" className="btn small dt-do" data-dd-group-make={g.paid.vid} onClick={() => { if (challanFromBooks(g.paid.vid, bsr, ser) !== false) { setPay(false); render(); } }}>Make it a challan</button></div>}
    {add && <AddChallan form={form} onDone={() => setAdd(false)} />}
    <Table>{rows.map(({ r, x }) => <tr key={r.id} data-dt-row={r.id} data-dt-in="pay"><Cells r={r} prob={x.prob} /><td className="dt-act"></td></tr>)}</Table>
  </div>;
}

function FixRow({ r, x, issue, m, locked }) {
  const [pan, setPan] = useState(false), p = x.prob;
  const rate = p.k === "rate" ? fixesOf(r, issue, m).find((f) => f.k === "rate") : null;
  const c = r.challan ? TDS.challans().find((z) => z.id === r.challan) : null;
  return <tr data-dt-row={r.id} data-dt-in="fix"><Cells r={r} prob={null} />
    <td className="dt-act"><span className="dt-fixw" data-dt-problem={p.k}>{p.words}</span>{c ? <span className="dt-why"> · on {c.serial} · {dm6(c.date)}</span> : null}
      {!locked && <span className="dt-btns">{p.k === "pan" ? (pan ? <PanBox party={r.party || r.employee} compact onSaved={() => setPan(false)} />
          : <button type="button" className="btn small dt-do" data-dt-fix={r.id} data-dt-addpan={r.id} onClick={() => setPan(true)}>Add PAN</button>)
        : rate ? <button type="button" className="btn small dt-do" data-dt-fix={r.id} title={rate.why} onClick={() => { const y = rate.apply(); if (y && !y.ok) toast(y.why); else { TDSReg.forget(); TDSReg.done(); saveBooks(); toast("Fixed: " + rate.label + "."); } render(); }}>Fix rate: {rate.label}</button>
        : <button type="button" className="btn small dt-do" data-dt-fix={r.id} onClick={() => { S.tdsAdd = { rowId: r.id }; render(); }}>Fix</button>}</span>}</td></tr>;
}

export default function DedTodo({ form, fy, q, rows, m, issueOf, probs, locked }) {
  const cx = TDSReg.ctx(), G = { confirm: [], choose: [], pay: [], fix: [], done: [] }, ids = chIds();
  rows.forEach((r) => { const x = groupOf(r, m, issueOf[r.id], probs[r.id], form, ids); G[x.g].push({ r, x }); });
  // the pay blocks: one per section and month (tmReasons' group, or the row's own)
  const blocks = [], byKey = {};
  G.pay.forEach((it) => { const g = it.x.grp, key = g ? g.key : TDS.sec(it.r.section) + "|" + TDS.ymd(it.r.date).slice(0, 6);
    if (!byKey[key]) { byKey[key] = { key, grp: g, sec: g ? g.sec : TDS.sec(it.r.section), ym: g ? g.ym : TDS.ymd(it.r.date).slice(0, 6), rows: [] }; blocks.push(byKey[key]); }
    byKey[key].rows.push(it); });
  blocks.sort((a, b) => a.ym.localeCompare(b.ym) || String(a.sec).localeCompare(String(b.sec)));
  const need = G.confirm.length + G.choose.length + G.pay.length + G.fix.length, n = rows.length;
  const payDue = r2(blocks.reduce((a, b) => a + blockDue(b), 0));
  const go = (k) => { const el = document.querySelector('[data-dt-group="' + k + '"]'); if (el) { el.open = true; el.scrollIntoView({ block: "start", behavior: "smooth" }); } };
  const part = (k, words, cnt) => (cnt ? <> · <button type="button" className="linkbtn dt-jump" data-dt-jump={k} onClick={() => go(k)}>{words}</button></> : null);
  const unit = form === "27EQ" ? "collections" : "deductions";
  return <div className="dt" data-ded-todo={TDSReg.key(form, fy, q)}>
    <h3 className="dt-title">{form === "27EQ" ? "Collections" : "Deductions"} · {TDS.formShort(form, fy)} · {q} {fy}</h3>
    {need ? <p className="dt-line" data-dt-line={n + "|" + G.done.length + "|" + need}><b>{n} {unit}</b> · <span className="dt-okw">{G.done.length} done</span> · <b className="dt-needw">{need} need you</b>
        {part("confirm", G.confirm.length + " to confirm", G.confirm.length)}{part("choose", G.choose.length + " to choose", G.choose.length)}
        {part("pay", G.pay.length + " need a challan (" + money(payDue) + " to pay)", G.pay.length)}{part("fix", G.fix.length + " to fix", G.fix.length)}</p>
      : <p className="dt-line dt-alldone" data-dt-line={n + "|" + G.done.length + "|0"} data-dt-alldone="">{n ? "All " + n + " " + unit + " are on challans ✓" : "No " + unit + " in this quarter yet."}</p>}
    {G.confirm.length > 0 && <Group k="confirm" title="Confirm" n={G.confirm.length} tone="blue"
      extra={!locked ? <button type="button" className="btn small primary" data-dt-confirm-all="" data-dd-accept-all="" onClick={() => tdsMatchConfirmAll()}>Confirm all {G.confirm.length}</button> : null}>
      <p className="dt-gn">FinCom found the challan that paid each of these. Check it and confirm.</p>
      <Table>{G.confirm.map(({ r, x }) => <ConfirmRow key={r.id} r={r} x={x} locked={locked} />)}</Table></Group>}
    {G.choose.length > 0 && <Group k="choose" title="Choose a challan" n={G.choose.length} tone="amber">
      <p className="dt-gn">More than one challan could pay these, or none has enough left. One click puts the row on a challan.</p>
      <Table>{G.choose.map(({ r, x }) => <ChooseRow key={r.id} r={r} x={x} locked={locked} cx={cx} />)}</Table></Group>}
    {G.pay.length > 0 && <Group k="pay" title="Pay a challan" n={G.pay.length} tone="red">
      <p className="dt-gn">No challan paid for these yet. Pay one challan for each section and month, or give the BSR code of a payment already made in Tally.</p>
      {blocks.map((b) => <PayBlock key={b.key} b={b} form={form} fy={fy} locked={locked} rows={b.rows.map((it) => it)} />)}</Group>}
    {G.fix.length > 0 && <Group k="fix" title="Fix the row" n={G.fix.length} tone="amber">
      <p className="dt-gn">On a challan, but the row itself needs a correction before the return is filed.</p>
      <Table>{G.fix.map(({ r, x }) => <FixRow key={r.id} r={r} x={x} issue={issueOf[r.id]} m={m} locked={locked} />)}</Table></Group>}
    {G.done.length > 0 && <Group k="done" title="Done" n={G.done.length} tone="green" open={!!S.dtDoneOpen} extra={<span className="dt-donew">on challans, nothing to do</span>}>
      <Table>{G.done.map(({ r }) => { const c = r.challan ? TDS.challans().find((z) => z.id === r.challan) : null;
        return <tr key={r.id} data-dt-row={r.id} data-dt-in="done"><Cells r={r} prob={null} />
          <td className="dt-act"><span className="dt-on" data-dd-on={r.id}>{c ? "On " + chWords(c) : r.tds > 0.005 ? "On a challan" : "No TDS to pay"}</span>
            {!locked && r.challan ? <> <button type="button" className="linkbtn" data-dt-change={r.id} data-ch-cell={r.id} onClick={() => tdsMoveOpen([r.id])}>Change</button></> : null}</td></tr>; })}</Table></Group>}
  </div>;
}
