// Which challan pays which deduction, on each return's Challans tab (next-challan-match, the owner's request of
// 17-Oct-2026: "create something any fresher can understand and match the deduction"). One screen for 26Q / 27Q / 27EQ /
// 24Q and Forms 140 / 144 / 143 / 138:
//   ① Challans of this quarter  ② Match deductions  ③ Check and make the file
//   each challan as a card (BSR · date · serial, its section, the months it pays, tax / interest / fee / others, a bar of
//   used and left, Fully used · ₹X left · Over by ₹X) with the deductions on it beside it and the suggestions for it in
//   yellow (the rule in words, the reason, Confirm / Not this, Split the row); "Not matched yet" in red, each row with its
//   reason and next step; tick rows to Move to challan… or Take off challan; interest and fee allocated per return;
//   what blocks the file; tips.
// The figures and the decisions are TDSMatch's (src/js/86) and the register's (TDSReg, src/js/79); nothing here works
// out a match.
import { useState } from "react";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { AddChallan, SrcBadge } from "./Register.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const paise = (p) => money(p / 100);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthOf = (ym) => MON[+String(ym).slice(4, 6) - 1] + " " + String(ym).slice(0, 4);
const secOf = (r) => TDS.sec(r.section || "") || "";
const chSec = (c) => TDSCH.secNorm(c.section) || "";
const fl = () => S.tdsMF || {};
const setFl = (k, v) => { S.tdsMF = { ...fl(), [k]: v }; render(); };
const sel = () => S.tdsSel || {};
const tick = (ids, on) => { const s = { ...sel() }; ids.forEach((id) => { if (on) s[id] = true; else delete s[id]; }); S.tdsSel = s; render(); };

// the challans the screen shows: those this return uses, those suggested for it, and the quarter's own with tax left
function challansOf(form, fy, q, cx, sugg) {
  const k = TDSReg.key(form, fy, q), want = new Set();
  sugg.forEach((s) => { want.add(s.chId); (s.parts || []).forEach((p) => want.add(p.chId)); });
  const mon = tdsMonths(fy, q), last = mon[mon.length - 1], next = String(+last.slice(4, 6) === 12 ? +last.slice(0, 4) + 1 + "01" : last.slice(0, 4) + String(+last.slice(4, 6) + 1).padStart(2, "0"));
  return TDS.challans().filter((c) => (cx.uses[c.id] || {})[k] || want.has(c.id) || (TDSReg.balance(c, cx).tax > 0.005 && TDS.fyOf(c.date) === fy && [...mon, next].includes(TDS.ymd(c.date).slice(0, 6))));
}

function Steps({ n1, n2, n3 }) {
  const st = (done, now) => (done ? "done" : now ? "now" : "next");
  return <ol className="cm-steps" data-cm-steps="">
    <li data-st={st(n1, !n1)}><b>①</b> Challans of this quarter</li>
    <li data-st={st(n2, n1 && !n2)}><b>②</b> Match deductions</li>
    <li data-st={st(n3, n1 && n2)}><b>③</b> Check and make the file</li>
  </ol>;
}

// the card: the challan, its heads, the bar of used and left, the status
function Card({ c, cx, rowsHere, sugHere, form, fy, q, locked }) {
  const bal = TDSReg.balance(c, cx), used = TDSReg.usedTax(c, cx), tax = num(c.tax), over = bal.tax < -0.005;
  const pct = tax > 0 ? Math.min(100, Math.round(used / tax * 100)) : 0;
  const months = Array.from(new Set(rowsHere.map((r) => TDS.ymd(r.date).slice(0, 6)).concat(...sugHere.map((s) => s.months || [])))).sort();
  const chip = over ? <span className="tag bad" data-cm-status="over">Over by {money(-bal.tax)}</span> : bal.tax < 0.005 && used > 0 ? <span className="tag ok" data-cm-status="full">Fully used</span>
    : <span className="tag" data-cm-status="left">{money(bal.tax)} left</span>;
  return <div className="cm-card">
    <div className="cm-card-h"><b>{c.bsr} · {day(c.date)} · {c.serial}</b> <SrcBadge c={c} short /></div>
    <div className="cm-card-sub"><span className="tag" data-cm-sec="">{chSec(c) || "no section"}</span>{months.length ? <span className="note"> pays {months.map(monthOf).join(", ")}</span> : null}{String(c.minorHead || "200") === "400" ? <span className="tag warn">minor head 400</span> : null}</div>
    <dl className="cm-heads"><dt>Tax</dt><dd>{money(c.tax)}</dd><dt>Interest</dt><dd>{money(c.interest)}</dd><dt>Fee</dt><dd>{money(c.fee)}</dd><dt>Others</dt><dd>{money(c.others)}</dd></dl>
    <div className={"cm-bar" + (over ? " over" : "")} role="img" aria-label={"Used " + money(used) + " of " + money(tax)}><span style={{ width: pct + "%" }} /></div>
    <div className="cm-bar-l"><span>Used {money(used)}</span><span>Balance {money(bal.tax)}</span></div>
    <div className="cm-chip">{chip}</div>
    {(cx.uses[c.id] || {})[TDSReg.key(form, fy, q)] && (num(c.interest) || TDSReg.feeOf(c)) ? <Portion c={c} cx={cx} form={form} fy={fy} q={q} locked={locked} /> : null}
  </div>;
}

// interest and fee allocated to this return (the register's portion); the default offered (TDSMatch.defaultPortion)
function Portion({ c, cx, form, fy, q, locked }) {
  const cur = TDSReg.portionFor(c, form, fy, q, cx), d = TDSMatch.defaultPortion(c, form, fy, q), [open, setOpen] = useState(false);
  const [i, setI] = useState(""), [f, setF] = useState("");
  return <div className="cm-portion" data-cm-portion={c.id}>
    <span>Here: interest <b>{money(cur.interest)}</b>{TDSReg.feeOf(c) ? <>, fee <b>{money(cur.fee)}</b></> : null}</span>
    {!locked && !open && <button className="linkbtn" data-cm-portion-edit="" onClick={() => { setI(String(cur.interest || d.interest || "")); setF(String(cur.fee || d.fee || "")); setOpen(true); }}>Allocate interest {money(d.interest || cur.interest)} here…</button>}
    {open && <div className="reg-use">
      <label className="ach-f">Interest<input type="text" inputMode="decimal" value={i} onChange={(ev) => setI(ev.target.value)} aria-label="Interest allocated here" /></label>
      {TDSReg.feeOf(c) ? <label className="ach-f">Fee and others<input type="text" inputMode="decimal" value={f} onChange={(ev) => setF(ev.target.value)} aria-label="Fee allocated here" /></label> : null}
      <button className="btn small primary" data-cm-portion-save="" onClick={() => { const r = tdsPortionSet(c.id, i, f); if (r.ok) setOpen(false); }}>Save</button>
      <button className="linkbtn" onClick={() => setOpen(false)}>Cancel</button>
      {d.due > 0 && <span className="note">Interest due on this return's late deductions on this challan: {money(d.due)}</span>}</div>}
  </div>;
}

function RowLine({ r, locked, by, children }) {
  const s = sel();
  return <li className="cm-row" data-cm-row={r.id}>
    {!locked && <input type="checkbox" className="cm-ck" aria-label={"Tick " + (r.party || "")} checked={!!s[r.id]} onChange={(ev) => tick([r.id], ev.target.checked)} />}
    <span className="cm-row-d">{day(r.date)}</span>
    <span className="cm-row-p">{r.party || r.employee}{r.splitOf ? <span className="tag" data-cm-part="">part {r.part} of {r.parts}</span> : null}{by ? <small className="cm-by" data-cm-by="">{by}</small> : null}</span>
    <span className="cm-row-s">{secOf(r)}</span>
    <span className="cm-row-a">{money(r.tds)}</span>
    {children}
  </li>;
}

// a suggestion, in yellow: the rule in words, the reason, Confirm / Not this (a split: Split the row)
function Sugg({ s, byId, chs, locked }) {
  const rows = s.ids.map((id) => byId[id]).filter(Boolean);
  return <div className={"cm-sugg" + (s.confidence === "low" ? " low" : "")} data-cm-sugg={s.key} data-rule={s.rule}>
    <div className="cm-sugg-h"><span className="tag warn">{s.rule === "g" || s.ai ? "AI" : "Suggested"}</span> {s.rule === "g" ? null : <b>{s.words}</b>}{s.rule === "split" ? null : rows.length ? <span className="note"> · {rows.length} deduction{rows.length === 1 ? "" : "s"} · {paise(s.total)}</span> : null}</div>
    <div className="cm-sugg-why">{s.reason}</div>
    {s.warn ? <div className="cm-sugg-warn">{s.warn}</div> : null}
    {s.info ? <div className="note">{s.info}</div> : null}
    {s.parts ? <ul className="cm-parts">{s.parts.map((p) => { const c = chs.find((x) => x.id === p.chId); return <li key={p.chId}>{paise(p.paise)} on {c ? TDSCH.label(c) : p.chId}</li>; })}</ul> : null}
    {rows.length > 0 && s.rule !== "split" && <ul className="cm-rows">{rows.map((r) => <RowLine key={r.id} r={r} locked />)}</ul>}
    {!locked && <div className="cm-sugg-act">
      {s.rule === "split" ? <button className="btn small primary" data-cm-split={s.key} onClick={() => tdsSplitOpen(s.key)}>Split the row…</button>
        : <button className="btn small primary" data-cm-confirm={s.key} onClick={() => tdsMatchConfirm(s.key)}>Confirm</button>}
      <button className="btn small" data-cm-no={s.key} onClick={() => tdsMatchNo(s.key)}>Not this</button></div>}
  </div>;
}

export function ChallanMatch({ fy, q, form, children }) {
  const cx = TDSReg.ctx(), k = TDSReg.key(form, fy, q), locked = TDSReg.locked(fy, q, form), [adding, setAdding] = useState(false);
  const all = TDS.formRows(form).filter((r) => r.fy === fy && r.q === q), byId = {};
  all.forEach((r) => { byId[r.id] = r; });
  const sugg = TDSMatch.suggest(form, fy, q), reasons = TDSMatch.reasons(form, fy, q), why = {}, m = TDSMatch.metric(form, fy, q);
  reasons.forEach((x) => { why[x.rowId] = x; });
  sugg.forEach((s) => { s.months = Array.from(new Set(s.ids.map((id) => byId[id] && TDS.ymd(byId[id].date).slice(0, 6)).filter(Boolean))); });
  const ai = TDSMatch.view(form, fy, q);
  const f = fl(), pass = (r) => (!f.sec || secOf(r) === f.sec) && (!f.month || TDS.ymd(r.date).slice(0, 6) === f.month) && (!f.st || (f.st === "matched" ? !!r.challan : !r.challan));
  const chs = challansOf(form, fy, q, cx, sugg).sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)) || String(a.id).localeCompare(String(b.id)));
  const inSugg = new Set([].concat(...sugg.map((s) => s.ids))), notYet = all.filter((r) => !r.challan && r.tds > 0.005 && !inSugg.has(r.id) && pass(r));
  const un = all.filter((r) => !r.challan && r.tds > 0.005), confirmable = sugg.filter((s) => s.rule !== "split");
  const checks = TDSMatch.checks(form, fy, q), low = sugg.filter((s) => s.confidence === "low");
  const secs = Array.from(new Set(all.map(secOf))).sort(), ticked = all.filter((r) => sel()[r.id]), tickedSum = r2(ticked.reduce((a, r) => a + r.tds, 0));
  const unit = form === "27EQ" ? "collections" : "deductions";
  return <div className="cm" data-challan-match={k}>
    <Steps n1={chs.length > 0} n2={!un.length} n3={false} />
    <section className="dash-card cm-top">
      <div className="cm-metric" data-cm-metric={m.n + "/" + m.m}><b>{m.n} of {m.m}</b> {unit} matched automatically · <b className={m.k ? "bad" : ""}>{m.k} need you</b>
        {m.on ? <span className="note"> ({m.on} on a challan already, {m.sugg} waiting for your Confirm)</span> : null}</div>
      {ai && ai.say ? <p className="note cm-ai" data-cm-ai={ai.state || ""}>{ai.busy ? "AI is looking at what the rules left…" : ai.say}</p> : ai && ai.busy ? <p className="note cm-ai" data-cm-ai="busy">AI is looking at what the rules left…</p> : null}
      <div className="row cm-acts">
        {!locked && confirmable.length > 0 && <button className="btn small primary" data-cm-confirm-all="" onClick={() => tdsMatchConfirmAll()}>Confirm all {confirmable.length} suggestion{confirmable.length === 1 ? "" : "s"}</button>}
        <button className="btn small" data-ret-add-challan="" onClick={() => setAdding(!adding)}>Add challan</button>
        {!locked && ai && !ai.busy && <button className="btn small" data-cm-ai-again="" onClick={() => TDSMatch.askAi(form, fy, q, true)}>Ask AI again</button>}
        <button className="linkbtn" onClick={() => tdsNav("register")}>Challan register →</button>
      </div>
      <div className="row cm-filters">
        <select aria-label="Section" value={f.sec || ""} onChange={(ev) => setFl("sec", ev.target.value)}><option value="">All sections</option>{secs.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select aria-label="Month" value={f.month || ""} onChange={(ev) => setFl("month", ev.target.value)}><option value="">All months</option>{tdsMonths(fy, q).map((x) => <option key={x} value={x}>{monthOf(x)}</option>)}</select>
        <select aria-label="Matched or not" value={f.st || ""} onChange={(ev) => setFl("st", ev.target.value)}><option value="">Matched and not</option><option value="matched">Matched</option><option value="not">Not matched</option></select>
      </div>
    </section>
    {adding && <AddChallan form={form} onDone={() => setAdding(false)} />}
    {low.length > 0 && <section className="dash-card cm-low" data-cm-low=""><h3>Check these first: AI is not sure</h3>
      {low.map((s) => <Sugg key={s.key} s={s} byId={byId} chs={TDS.challans()} locked={locked} />)}</section>}
    <div className="cm-list">
      {chs.map((c) => {
        const here = all.filter((r) => r.challan === c.id && pass(r)), sg = sugg.filter((s) => s.confidence !== "low" && (s.chId === c.id) && (!s.ids.length || s.ids.some((id) => byId[id] && pass(byId[id]))));
        if (!here.length && !sg.length && (f.sec || f.month || f.st)) return null;
        return <article key={c.id} className="cm-ch" data-cm-ch={c.id}>
          <Card c={c} cx={cx} rowsHere={here} sugHere={sg} form={form} fy={fy} q={q} locked={locked} />
          <div className="cm-side">
            {here.length > 0 && <ul className="cm-rows" data-cm-on={c.id}>{here.map((r) => <RowLine key={r.id} r={r} locked={locked} by={TDSMatch.matchedBy(r.id).words}>
              {r.splitOf && !locked ? <button className="linkbtn" data-cm-unsplit={r.splitOf} onClick={() => tdsUnsplit(r.splitOf)}>Undo split</button> : null}</RowLine>)}</ul>}
            {sg.map((s) => <Sugg key={s.key} s={s} byId={byId} chs={TDS.challans()} locked={locked} />)}
            {!here.length && !sg.length && <p className="note">Nothing of this return on it{TDSReg.balance(c, cx).tax > 0.005 ? ": its balance can pay later quarters of " + TDS.fyOf(c.date) + "." : "."}</p>}
          </div>
        </article>;
      })}
      {!chs.length && <p className="note cm-empty">No challan for this quarter yet. Add one (Add challan), upload the portal’s Payment History in the challan register, or make one from a Tally TDS payment below.</p>}
      <article className="cm-ch cm-none" data-cm-none={notYet.length}>
        <div className="cm-card"><div className="cm-card-h bad"><b>Not matched yet ({notYet.length} · {money(notYet.reduce((a, r) => a + r.tds, 0))})</b></div>
          <p className="note">Each has its reason and the next step.</p></div>
        <div className="cm-side">{notYet.length ? <ul className="cm-rows">{notYet.map((r) => { const w = why[r.id];
          return <RowLine key={r.id} r={r} locked={locked}>
            <div className="cm-why" data-cm-why={w ? w.step : "none"}>{w ? w.words : "Not matched."}
              {!locked && w && (w.step === "pay" ? <button className="linkbtn" onClick={() => setAdding(true)}>Add challan</button> : w.step === "move" ? <button className="linkbtn" onClick={() => tdsMoveOpen([r.id])}>Move to challan…</button> : null)}</div></RowLine>; })}</ul>
          : <p className="note">Every {unit.replace(/s$/, "")} is on a challan or in a suggestion above.</p>}</div>
      </article>
    </div>
    {!locked && ticked.length > 0 && <div className="cm-bar-sel" data-cm-selbar="">
      <span><b>{ticked.length} ticked</b> · {money(tickedSum)}</span>
      <button className="btn small primary" data-cm-move="" onClick={() => tdsMoveOpen(ticked.map((r) => r.id))}>Move to challan…</button>
      {ticked.some((r) => r.challan) && <button className="btn small" data-cm-takeoff="" onClick={() => tdsTakeOff(ticked.filter((r) => r.challan).map((r) => r.id))}>Take off challan</button>}
      <button className="linkbtn" onClick={() => { S.tdsSel = {}; render(); }}>Clear</button></div>}
    <section className="dash-card cm-checks" data-cm-checks={checks.block.length ? "block" : "ok"}>
      <h3>③ Check and make the file</h3>
      {checks.block.length ? <ul className="cm-block">{checks.block.map((x) => <li key={x.k} data-cm-block={x.k}>{x.words}</li>)}</ul> : <p className="ok-line" data-cm-ready="">Every {unit.replace(/s$/, "")} is on a challan and no challan is used beyond its tax.</p>}
      {checks.warn.length > 0 && <ul className="cm-warn">{checks.warn.map((x, i) => <li key={i} data-cm-warn={x.k}>{x.words}</li>)}</ul>}
      {checks.info.length > 0 && <ul className="note">{checks.info.map((x, i) => <li key={i} data-cm-info={x.k}>{x.words}</li>)}</ul>}
      <button className="btn small primary" data-cm-make="" disabled={checks.block.length > 0} onClick={() => tdsTabGo("file")}>Make the file →</button>
    </section>
    <details className="cm-tips" data-cm-tips=""><summary>Tips</summary><ul>
      <li>Pay one challan per section per month: each challan then matches its month’s deductions exactly, and nothing needs choosing.</li>
      <li>Before making the file, download the challan file (CSI) from the income-tax portal for this TAN: the FVU checks each challan against it.</li>
      <li>Use a balance left on an earlier challan of the same tax year before paying a fresh one.</li>
      <li>One deduction is paid by one challan. If no challan has enough left, split the row: two rows, the same dates, each on its challan.</li>
    </ul></details>
    {children}
  </div>;
}

// the deduction's challan on the Deductions tab: "BSR · date · section", opening the Move dialog (never a silent re-tag)
export function ChallanCell({ r }) {
  const c = r.challan ? TDS.challans().find((x) => x.id === r.challan) : null;
  return <button type="button" className={"linkbtn cm-cell" + (c ? "" : " bad")} data-ch-cell={r.id} aria-label={"Challan for " + (r.party || "")} title={c ? TDSMatch.matchedBy(r.id).words : "On no challan: choose one"} onClick={() => tdsMoveOpen([r.id])}>
    {c ? c.bsr + " · " + day(c.date) + " · " + (chSec(c) || "no section") : "— not matched —"}{r.splitOf ? " (part " + r.part + ")" : ""}</button>;
}

// the Move dialog and the Split dialog, once per return page
export function MatchDialogs({ form, fy, q }) { return <><MoveDialog /><SplitDialog form={form} fy={fy} q={q} /></>; }

function MoveDialog() {
  const mv = S.tdsMove, [sec, setSec] = useState(""), [mon, setMon] = useState("");
  if (!mv) return <Dialog open={false} onOpenChange={() => {}} />;
  const cx = TDSReg.ctx(), rows = mv.ids.map((id) => cx.byRow[id] && cx.byRow[id].r).filter(Boolean), need = r2(rows.filter((r) => !r.challan || true).reduce((a, r) => a + r.tds, 0));
  const list = TDS.challans().filter((c) => (!sec || chSec(c) === sec || !chSec(c)) && (!mon || TDS.ymd(c.date).slice(0, 6) === mon)).map((c) => {
    const add = r2(rows.filter((r) => r.challan !== c.id).reduce((a, r) => a + r.tds, 0)), left = TDSReg.balance(c, cx).tax;
    return { c, left, after: r2(left - add) };
  }).sort((a, b) => (b.after >= -0.005) - (a.after >= -0.005) || TDS.ymd(a.c.date).localeCompare(TDS.ymd(b.c.date)));
  const secs = Array.from(new Set(TDS.challans().map(chSec).filter(Boolean))).sort(), months = Array.from(new Set(TDS.challans().map((c) => TDS.ymd(c.date).slice(0, 6)))).sort();
  const close = () => { S.tdsMove = null; render(); };
  return <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
    <DialogContent title={"Move " + rows.length + " deduction" + (rows.length === 1 ? "" : "s") + " to a challan"} description={money(need) + " · " + Array.from(new Set(rows.map(secOf))).join(", ")} data-cm-move-dialog="">
      <div className="row cm-filters">
        <select aria-label="Challan section" value={sec} onChange={(ev) => setSec(ev.target.value)}><option value="">Every section</option>{secs.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select aria-label="Challan month" value={mon} onChange={(ev) => setMon(ev.target.value)}><option value="">Every month</option>{months.map((x) => <option key={x} value={x}>{monthOf(x)}</option>)}</select></div>
      <ul className="cm-pick">{list.map(({ c, left, after }) => <li key={c.id} data-cm-pick={c.id}>
        <span><b>{c.bsr} · {day(c.date)} · {c.serial}</b> <span className="tag">{chSec(c) || "no section"}</span><span className="note"> {monthOf(TDS.ymd(c.date).slice(0, 6))} · {money(left)} left</span>
          {after < -0.005 ? <small className="bad"> needs {money(-after)} more than it has</small> : <small className="note"> → {money(after)} left after</small>}</span>
        <button className="btn small" disabled={after < -0.005} data-cm-pick-go={c.id} onClick={() => tdsMoveTo(mv.ids, c.id)}>Move here</button></li>)}
        {!list.length && <li className="note">No challan of that section or month.</li>}</ul>
      {rows.some((r) => r.challan) && <div className="row"><button className="btn small" data-cm-takeoff-dlg="" onClick={() => { tdsTakeOff(rows.filter((r) => r.challan).map((r) => r.id)); close(); }}>Take off challan</button></div>}
    </DialogContent></Dialog>;
}

function SplitDialog({ form, fy, q }) {
  const sp = S.tdsSplit, s = sp ? TDSMatch.find(sp.key, form, fy, q) : null, [parts, setParts] = useState(null);
  if (!sp) return <Dialog open={false} onOpenChange={() => {}} />;
  const close = () => { S.tdsSplit = null; setParts(null); render(); };
  if (!s) return <Dialog open onOpenChange={(o) => { if (!o) close(); }}><DialogContent title="Split the row"><p className="note">That suggestion is no longer there.</p></DialogContent></Dialog>;
  const cx = TDSReg.ctx(), r = cx.byRow[s.ids[0]] && cx.byRow[s.ids[0]].r, ps = parts || s.parts.map((p) => ({ chId: p.chId, tds: String(p.paise / 100) }));
  const tot = r2(ps.reduce((a, p) => a + num(p.tds), 0)), okSum = r && Math.round(tot * 100) === Math.round(r.tds * 100);
  return <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
    <DialogContent title="Split the row across challans" description={r ? (r.party || "") + " · " + day(r.date) + " · " + secOf(r) + " · " + money(r.tds) : ""} data-cm-split-dialog="">
      <p className="note">No one challan has enough left for this deduction. It becomes {ps.length} rows in the file, the same payment and deduction dates, each paid by its own challan; the amount paid is divided in the same proportion.</p>
      <table className="bk-table cm-split"><thead><tr><th>Part</th><th>Challan</th><th className="n">Left on it</th><th className="n">Tax in this part</th></tr></thead>
        <tbody>{ps.map((p, i) => { const c = TDS.challans().find((x) => x.id === p.chId);
          return <tr key={p.chId} data-cm-split-part={i + 1}><td>{i + 1}</td><td>{c ? TDSCH.label(c) : p.chId}</td><td className="n">{c ? money(TDSReg.balance(c, cx).tax) : ""}</td>
            <td className="n"><input type="text" inputMode="decimal" value={p.tds} aria-label={"Tax in part " + (i + 1)} onChange={(ev) => setParts(ps.map((x, j) => (j === i ? { ...x, tds: ev.target.value } : x)))} style={{ width: 110, textAlign: "right" }} /></td></tr>; })}</tbody>
        <tfoot><tr><td colSpan={3}>Together</td><td className={"n" + (okSum ? "" : " bad")}>{money(tot)}{okSum ? "" : " (must be " + money(r ? r.tds : 0) + ")"}</td></tr></tfoot></table>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn small primary" data-cm-split-go="" disabled={!okSum} onClick={() => { const x = tdsSplitDo(s.ids[0], ps.map((p) => ({ chId: p.chId, tds: num(p.tds) }))); if (x.ok) setParts(null); }}>Split the row</button>
        <button className="btn small" onClick={close}>Cancel</button></div>
    </DialogContent></Dialog>;
}
