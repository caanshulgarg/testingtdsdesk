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
import { useState, useRef } from "react";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { AddChallan, SrcBadge, say } from "./Register.jsx";
import More from "../../parts/More.jsx";
import { SideDrawer } from "./Shell.jsx";
import { openAllChallans } from "./AllChallans.jsx";
import { PanBox } from "./PanBook.jsx";
import "../../lib/tdsGlobals.js";   // next-challan-match: TDSMatch, PANCheck and the matcher's rules come with the TDS screens

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
export function challansOf(form, fy, q, cx, sugg) {
  const k = TDSReg.key(form, fy, q), want = new Set();
  sugg.forEach((s) => { want.add(s.chId); (s.parts || []).forEach((p) => want.add(p.chId)); });
  const mon = tdsMonths(fy, q), last = mon[mon.length - 1], next = String(+last.slice(4, 6) === 12 ? +last.slice(0, 4) + 1 + "01" : last.slice(0, 4) + String(+last.slice(4, 6) + 1).padStart(2, "0"));
  return TDS.challans().filter((c) => (cx.uses[c.id] || {})[k] || want.has(c.id) || (TDSReg.balance(c, cx).tax > 0.005 && TDS.fyOf(c.date) === fy && [...mon, next].includes(TDS.ymd(c.date).slice(0, 6))));
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
      <button className="btn small" data-cm-portion-save="" onClick={() => { const r = tdsPortionSet(c.id, i, f); if (r.ok) setOpen(false); }}>Save</button>
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

// the challan's balance as this return sees it: its tax less what OTHER returns use of it (the opening), then each of this
// return's deductions on it, oldest first, with the balance after it (Winman's view); the last is the balance available
export function runOf(c, form, fy, q, cx) {
  const k = TDSReg.key(form, fy, q), m = cx.uses[c.id] || {}, other = r2(Object.keys(m).filter((x) => x !== k).reduce((a, x) => a + m[x].tax, 0));
  const mine = (m[k] ? m[k].ids : []).map((id) => cx.byRow[id] && cx.byRow[id].r).filter(Boolean).sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)) || String(a.id).localeCompare(String(b.id)));
  let bal = r2(num(c.tax) - other);
  const rows = mine.map((r) => { bal = r2(bal - r.tds); return { r, after: bal }; });
  return { opening: r2(num(c.tax) - other), other, rows, avail: TDSReg.balance(c, cx).tax };
}

// the columns both panels show (the owner, 18-Oct-2026): deductee · PAN (its status) · amount paid · TDS · section ·
// lower-deduction certificate · date of deduction · rate basis (IT Act, or DTAA where a 27Q treaty rate is used);
// everything else in the row's details (a click on the name)
const certOf = (r, form) => { const c = form === "27EQ" ? TCS27EQ.certFor(r) : form === "24Q" ? null : Certs.forRow(r); return c ? String(c.certNo || "").toUpperCase() : "—"; };
const basisOf = (r, form) => (form === "27Q" && TDS26Q.nrInfo(r.party).dtaa ? "DTAA" : "IT Act");
const panChip = (pan) => { const st = PANCheck.status(pan); return <span className={"tag " + (st.state === "valid" ? "ok" : st.state === "unknown" ? "" : "bad")} data-pan-state={st.state} title={st.words}>{st.state === "unknown" ? "not checked" : st.state === "valid" ? "operative" : st.state}</span>; };
const HEAD = (form, first, last) => <tr>{first}<th>{form === "24Q" ? "Employee" : form === "27EQ" ? "Buyer" : "Deductee"}</th><th>PAN</th><th className="n">Amount paid</th><th className="n">TDS</th><th>Section</th><th>Certificate</th><th className="dt">Date of deduction</th><th>Rate basis</th>{last}</tr>;
const CELLS = (r, form) => <>
  <td className="pty"><button type="button" className="linkbtn" data-row-detail={r.id} onClick={() => { S.tdsRowDet = r.id; render(); }}>{r.party || r.employee}</button>{r.splitOf ? <span className="tag">part {r.part} of {r.parts}</span> : null}</td>
  <td>{r.pan && Certs.validPan(r.pan) ? <>{r.pan} {panChip(r.pan)}</> : <PanBox party={r.party || r.employee} compact />}</td>
  <td className="n">{money(r.paid)}</td><td className="n">{money(r.tds)}</td><td>{TDS.sec(r.section)}</td><td>{certOf(r, form)}</td><td>{day(r.date)}</td><td>{basisOf(r, form)}</td></>;

// the challan chosen, its AVAILABLE BALANCE big, and two panels (the owner's design of 18-Oct-2026, as Winman):
//   left  "On this challan": its deductions, each with the balance after it; ✕ takes one off (back to the right);
//         totals: TDS on this challan, balance left
//   right "Deductions to add": the return's deductions on no challan, THIS challan's suggestions first (the reason,
//         Confirm / Not this, "Add all suggested"), then the rest; a tick puts one on at once (the balance drops); one
//         more than the balance is offered as Split, never put on silently
//   "N deductions are on other challans": read-only, each with Move here
// The Challans tab's panel and the Deductions tab's challan-first view are this one component.
export function ChallanTicker({ c, form, fy, q, locked, sugg, mode }) {
  const cx = TDSReg.ctx(), run = runOf(c, form, fy, q, cx), all = TDS.formRows(form).filter((r) => r.fy === fy && r.q === q && r.tds > 0.005);
  const sec = chSec(c), [only, setOnly] = useState(false), [mon, setMon] = useState(""), [other, setOther] = useState(false);
  const chs = TDS.challans(), byCh = {}; chs.forEach((x) => { byCh[x.id] = x; });
  const byId = {}; all.forEach((r) => { byId[r.id] = r; });
  const sg = (sugg || []).filter((s) => s.rule !== "int" && (s.chId === c.id || (s.parts || []).some((p) => p.chId === c.id))).sort((a, b) => (b.confidence === "low") - (a.confidence === "low"));
  const inSg = new Set([].concat(...sg.map((s) => s.ids)));
  const fits = (r) => (!only || !sec || TDSCH.secOk(sec, r.section) || form === "24Q") && (!mon || TDS.ymd(r.date).slice(0, 6) === mon);
  const free = all.filter((r) => !r.challan && !inSg.has(r.id) && fits(r)).sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)) || String(a.id).localeCompare(String(b.id)));
  const elsewhere = all.filter((r) => r.challan && r.challan !== c.id);
  const put = (r) => { const x = TDSMatch.move([r.id], c.id); if (!x.ok) toast(x.why); render(); };
  const off = (r) => { const x = TDSMatch.takeOff([r.id]); if (!x.ok) toast(x.why); render(); };
  const addAll = () => { let n = 0; const why = []; sg.filter((s) => s.rule !== "split").forEach((s) => { const x = TDSMatch.confirm(s.key, form, fy, q); if (x.ok) n += x.n || 0; else why.push(x.why); });
    toast(n + " deduction" + (n === 1 ? "" : "s") + " added to this challan." + (why.length ? " Not done: " + why[0] : "")); render(); };
  const onTds = r2(run.rows.reduce((a, x) => a + x.r.tds, 0)), canPut = (r) => TDSCH.p(r.tds) <= TDSCH.p(run.avail);
  const tickRow = (r) => <tr key={r.id} data-cm-free-row={r.id} className={canPut(r) ? "" : "cm-over"}>
    <td className="ck">{canPut(r) ? <input type="checkbox" checked={false} disabled={locked} aria-label={"Put on this challan: " + (r.party || "")} onChange={() => put(r)} />
      : <button type="button" className="linkbtn" data-cm-split-row={r.id} disabled={locked || run.avail < 0.005} title={"More than the " + money(run.avail) + " left"} onClick={() => tdsSplitRow(r.id, c.id)}>Split…</button>}</td>{CELLS(r, form)}</tr>;
  return <section className="dash-card cm-panel" data-cm-panel={c.id} data-cm-mode={mode || "challans"}>
    <div className="cm-panel-h">
      <div><b>{c.bsr} · {day(c.date)} · {c.serial}</b> <SrcBadge c={c} short /> <span className="tag">{sec || "no section"}</span>
        <div className="note">Tax {money(c.tax)} · Interest {money(c.interest)} · Fee {money(c.fee)} · Others {money(c.others)}{run.other ? " · " + money(run.other) + " used by other returns" : ""}</div></div>
      <div className={"cm-avail" + (run.avail < -0.005 ? " bad" : "")} data-cm-avail={r2(run.avail)}><span>Available balance</span><b>{money(run.avail)}</b></div>
    </div>
    {(cx.uses[c.id] || {})[TDSReg.key(form, fy, q)] && (num(c.interest) || TDSReg.feeOf(c)) ? <Portion c={c} cx={cx} form={form} fy={fy} q={q} locked={locked} /> : null}
    <div className="cm-pan2">
      <div className="cm-left" data-cm-left={c.id}><h4>On this challan</h4>
        <div className="bk-tablewrap"><table className="bk-table cm-run gf-off" data-statement="" data-cm-run-table={c.id}>
          <thead>{HEAD(form, <th className="ck"></th>, <th className="n">Balance after</th>)}</thead>
          <tbody>
            <tr className="cm-open"><td></td><td colSpan={8}>{run.other ? "The challan's tax less what other returns use" : "The challan's tax"}</td><td className="n"><b>{money(run.opening)}</b></td></tr>
            {run.rows.map(({ r, after }) => <tr key={r.id} data-cm-on-row={r.id} title={TDSMatch.matchedBy(r.id).words}>
              <td className="ck">{!locked && <button type="button" className="icon" data-cm-off={r.id} aria-label={"Take off this challan: " + (r.party || "")} onClick={() => off(r)}>✕</button>}</td>{CELLS(r, form)}
              <td className={"n" + (after < -0.005 ? " bad" : "")} data-cm-run={after}>{money(after)}</td></tr>)}
            {!run.rows.length && <tr><td></td><td colSpan={9} className="note">Nothing of this return on it yet: tick deductions on the right.</td></tr>}
          </tbody>
          <tfoot><tr><td></td><td colSpan={3}>TDS on this challan</td><td className="n" data-cm-on-total={onTds}><b>{money(onTds)}</b></td><td colSpan={4}>Balance left</td><td className="n"><b>{money(run.avail)}</b></td></tr></tfoot>
        </table></div></div>
      <div className="cm-right" data-cm-right={c.id}><h4>Deductions to add</h4>
        {sg.length > 0 && <div className="cm-sg-group" data-cm-sg-group={c.id}>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}><b>Suggested for this challan</b>
            {!locked && sg.some((s) => s.rule !== "split") && <button className="btn small" data-cm-add-all={c.id} onClick={addAll}>Add all suggested</button>}</div>
          {sg.map((s) => <div key={s.key} className={"cm-sugg" + (s.confidence === "low" ? " low" : "")} data-cm-sugg={s.key} data-rule={s.rule}>
            <div className="cm-sugg-h"><span className="tag warn">{s.confidence === "low" ? "AI not sure" : s.rule === "g" || s.ai ? "AI" : "Suggested"}</span> {s.rule === "g" ? null : <b>{s.words}</b>}</div>
            <div className="cm-sugg-why">{s.reason}</div>
            {s.warn ? <div className="cm-sugg-warn">{s.warn}</div> : null}{s.info ? <div className="note">{s.info}</div> : null}
            {s.parts ? <ul className="cm-parts">{s.parts.map((p) => { const x = byCh[p.chId]; return <li key={p.chId}>{paise(p.paise)} on {x ? TDSCH.label(x) : p.chId}</li>; })}</ul> : null}
            <div className="bk-tablewrap"><table className="bk-table gf-off" data-statement=""><thead>{HEAD(form, null, null)}</thead><tbody>{s.ids.map((id) => byId[id]).filter(Boolean).map((r) => <tr key={r.id} data-cm-sugg-row={r.id}>{CELLS(r, form)}</tr>)}</tbody></table></div>
            {!locked && <div className="cm-sugg-act">
              {s.rule === "split" ? <button className="btn small" data-cm-split={s.key} onClick={() => tdsSplitOpen(s.key)}>Split the row…</button>
                : <button className="btn small" data-cm-confirm={s.key} onClick={() => tdsMatchConfirm(s.key)}>Confirm</button>}
              <button className="btn small" data-cm-no={s.key} onClick={() => tdsMatchNo(s.key)}>Not this</button></div>}
          </div>)}</div>}
        {!locked && <div className="cm-pick-h">
          {(form === "26Q" || form === "27Q") && <button type="button" className="linkbtn" data-cm-add-ded={c.id} onClick={() => { S.tdsAdd = { chId: c.id }; render(); }}>Add a deduction on this challan…</button>}
          <label className="chk"><input type="checkbox" checked={only} onChange={(ev) => setOnly(ev.target.checked)} /> Only {sec || "its section"}</label>
          <select aria-label="Month of the deductions" value={mon} onChange={(ev) => setMon(ev.target.value)}><option value="">Every month</option>{tdsMonths(fy, q).map((x) => <option key={x} value={x}>{monthOf(x)}</option>)}</select>
          <span className="note">Tick to put it on this challan; the balance drops at once.</span></div>}
        <div className="bk-tablewrap"><table className="bk-table gf-off" data-statement="" data-cm-free={c.id}>
          <thead>{HEAD(form, <th className="ck"></th>, null)}</thead>
          <tbody>{free.map(tickRow)}{!free.length && <tr><td colSpan={9} className="note">No other deduction is waiting for a challan.</td></tr>}</tbody></table></div>
        {elsewhere.length > 0 && <p className="note"><button className="linkbtn" data-cm-else-link="" aria-expanded={other} onClick={() => setOther(!other)}>{elsewhere.length} deduction{elsewhere.length === 1 ? " is" : "s are"} on other challans</button></p>}
        {other && <div className="bk-tablewrap"><table className="bk-table cm-grey-t gf-off" data-statement=""><thead>{HEAD(form, null, <><th>On challan</th><th></th></>)}</thead>
          <tbody>{elsewhere.map((r) => { const o = byCh[r.challan]; return <tr key={r.id} data-cm-else-row={r.id} className="cm-grey">{CELLS(r, form)}<td>{o ? o.bsr + " · " + day(o.date) + " · " + o.serial : r.challan}</td>
            <td>{!locked && <button className="linkbtn" data-cm-move-here={r.id} disabled={!canPut(r)} onClick={() => put(r)}>Move here</button>}</td></tr>; })}</tbody></table></div>}
      </div>
    </div>
  </section>;
}

// the challan chosen on the Deductions tab ("Challan: [BSR · date · serial · section · balance ₹X ▾]")
export function ChallanSelect({ form, fy, q, value, onChange }) {
  const cx = TDSReg.ctx(), list = challansOf(form, fy, q, cx, TDSMatch.suggest(form, fy, q)).concat(TDS.challans().filter((c) => TDSReg.balance(c, cx).tax > 0.005))
    .filter((c, i, a) => a.indexOf(c) === i).sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)));
  return <label className="cm-chsel">Challan: <select aria-label="Challan to work on" data-cm-chsel="" value={value || ""} onChange={(ev) => onChange(ev.target.value)}>
    <option value="">All deductions (none chosen)</option>
    {list.map((c) => <option key={c.id} value={c.id}>{[c.bsr, day(c.date), c.serial, chSec(c) || "no section", "balance " + money(TDSReg.balance(c, cx).tax)].join(" · ")}</option>)}</select></label>;
}

// the Challans step (next-tds-clear, design §3.5): one toolbar line (how many are matched, the AI's badge, ONE primary
// "Confirm N suggestions" while there are any, "Add challan ▾"); the challans as a list on the left (one line each:
// serial · date · section · ₹ left · a badge), "Not matched (N)" its last item; the one chosen on the right in the
// two-panel view (ChallanTicker), or what is not matched with its reason and next step
export function ChallanMatch({ fy, q, form, tallyPays, back }) {
  const cx = TDSReg.ctx(), k = TDSReg.key(form, fy, q), locked = TDSReg.locked(fy, q, form), [adding, setAdding] = useState(false), [reg, setReg] = useState(false), [pays, setPays] = useState(false);
  const up = useRef(null);
  const all = TDS.formRows(form).filter((r) => r.fy === fy && r.q === q), byId = {};
  all.forEach((r) => { byId[r.id] = r; });
  const sugg = TDSMatch.suggest(form, fy, q), reasons = TDSMatch.reasons(form, fy, q), why = {}, m = TDSMatch.metric(form, fy, q);
  reasons.forEach((x) => { why[x.rowId] = x; });
  sugg.forEach((s) => { s.months = Array.from(new Set(s.ids.map((id) => byId[id] && TDS.ymd(byId[id].date).slice(0, 6)).filter(Boolean))); });
  const ai = TDSMatch.view(form, fy, q);
  let chs = challansOf(form, fy, q, cx, sugg);
  if (reg) chs = chs.concat(TDS.challans().filter((c) => !chs.includes(c) && TDSReg.balance(c, cx).tax > 0.005));
  // a challan opened from All challans that this quarter's list does not hold is shown too
  if (S.tdsChSel && S.tdsChSel !== "__none" && !chs.some((c) => c.id === S.tdsChSel)) chs = chs.concat(TDS.challans().filter((c) => c.id === S.tdsChSel));
  chs = chs.sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)) || String(a.id).localeCompare(String(b.id)));
  const inSugg = new Set([].concat(...sugg.map((s) => s.ids))), notYet = all.filter((r) => !r.challan && r.tds > 0.005 && !inSugg.has(r.id));
  const confirmable = sugg.filter((s) => s.rule !== "split");
  const none = S.tdsChSel === "__none";
  const sel = none ? null : chs.find((c) => c.id === S.tdsChSel) || chs.find((c) => sugg.some((s) => s.chId === c.id)) || chs.find((c) => (cx.uses[c.id] || {})[k]) || chs[0] || null;
  const unit = form === "27EQ" ? "collections" : "deductions";
  const nPays = tallyPays ? tallyPays.n : 0;
  const upload = async (fs) => { const r = await TDSCH.upload(fs); if (r && r.placed) say(r.placed + " new challan" + (r.placed === 1 ? "" : "s") + " added; what " + (r.placed === 1 ? "it pays is" : "they pay is") + " suggested here, to confirm."); render(); };
  return <div className="cm" data-challan-match={k}>
    <div className="cm-tool" data-cm-tool="">{back}
      <span className="cm-metric" data-cm-metric={m.n + "/" + m.m}><b>{m.n} of {m.m}</b> {unit} matched · <span className={m.k ? "bad" : ""}>{m.k} need{m.k === 1 ? "s" : ""} you</span>
        {m.on ? <span className="note"> ({m.on} on a challan, {m.sugg} waiting for your Confirm)</span> : null}</span>
      {ai && (ai.say || ai.busy) ? <details className="cm-aib" data-cm-ai={ai.busy ? "busy" : ai.state || ""}><summary title="What the AI did">{ai.busy ? "AI is looking…" : "AI ⓘ"}</summary>
        <div className="cm-aipop"><p className="note">{ai.busy ? "AI is looking at what the rules left…" : ai.say}</p>
          {!locked && !ai.busy && <button className="btn small" data-cm-ai-again="" onClick={() => TDSMatch.askAi(form, fy, q, true)}>Ask AI again</button>}</div></details> : null}
      <button type="button" className="linkbtn cm-allch" data-cm-allch="" onClick={() => openAllChallans(fy, { fy, q, form })}>See all challans of {fy} →</button>
      <span className="rt-sp" />
      {!locked && confirmable.length > 0 && <button className="btn small primary" data-cm-confirm-all="" onClick={() => tdsMatchConfirmAll()}>Confirm {confirmable.length} suggestion{confirmable.length === 1 ? "" : "s"}</button>}
      <More label="Add challan" ariaLabel="Add challan" data-ret-add-challan="" items={[
        ["By hand", () => setAdding(true), { "data-cm-add": "hand" }],
        [reg ? "Only this quarter’s challans" : "From the register (unused balances)", () => setReg(!reg), { "data-cm-from-register": "", "aria-pressed": reg }],
        ["From a Tally TDS payment" + (nPays ? " (" + nPays + ")" : ""), () => setPays(true), { "data-cm-add": "tally" }],
        ["Upload challans…", () => up.current && up.current.click(), { "data-cm-add": "upload" }],
        ["Open the challan register", () => tdsNav("register"), { "data-cm-add": "register" }],
      ]} />
      <input ref={up} type="file" multiple hidden data-challan-upload="" accept=".csv,.xls,.xlsx,.pdf,text/csv,application/pdf" onChange={(ev) => { const fs = Array.from(ev.target.files || []); ev.target.value = ""; upload(fs); }} />
    </div>
    {adding && <AddChallan form={form} onDone={() => setAdding(false)} />}
    {pays && tallyPays ? <div data-cm-tally-pays="">{tallyPays.el}<p className="note"><button className="linkbtn" onClick={() => setPays(false)}>Close</button></p></div> : null}
    <div className="cm-two">
      <ul className="cm-chlist" data-cm-chlist="">{chs.map((c) => { const bal = TDSReg.balance(c, cx).tax, n = sugg.filter((s) => s.chId === c.id).length;
        const stt = bal < -0.005 ? "over" : bal < 0.005 && TDSReg.usedTax(c, cx) > 0 ? "full" : "left";
        return <li key={c.id}><button type="button" className={"cm-chbtn" + (sel && sel.id === c.id ? " on" : "")} data-cm-ch={c.id} aria-pressed={!!sel && sel.id === c.id} title={c.bsr + " · " + day(c.date) + " · " + c.serial + " · " + (chSec(c) || "no section")} onClick={() => { S.tdsChSel = c.id; render(); }}>
          <span className="cm-chl">{c.serial} · {day(c.date).slice(0, 6)} · {chSec(c) || "—"}</span>
          <span className={"cm-chbal" + (stt === "over" ? " bad" : "")} data-cm-status={stt}>{stt === "over" ? "Over by " + money(-bal) : stt === "full" ? "Fully used" : money(bal) + " left"}</span>
          {n ? <span className="tag warn" data-cm-nsugg={n}>{n}</span> : null}</button></li>; })}
        {!chs.length && <li className="note cm-empty">No challan for this quarter yet: Add challan ▾.</li>}
        <li className="cm-noneli"><button type="button" className={"cm-chbtn cm-nonebtn" + (none ? " on" : "")} data-cm-ch="__none" aria-pressed={none} onClick={() => { S.tdsChSel = "__none"; render(); }}>
          <span className={"cm-chl" + (notYet.length ? " bad" : "")}>Not matched ({notYet.length})</span><span className="cm-chbal">{money(notYet.reduce((a, r) => a + r.tds, 0))}</span></button></li></ul>
      <div className="cm-side">{none ? <section className="dash-card cm-none" data-cm-none={notYet.length}>
          <div className={"cm-card-h" + (notYet.length ? " bad" : "")}><b>Not matched yet ({notYet.length} · {money(notYet.reduce((a, r) => a + r.tds, 0))})</b><span className="note"> · each with its reason and the next step</span></div>
          {notYet.length ? <ul className="cm-rows">{(() => {
            // round 86: the deductions of one section and month with no challan, under one line saying why (once)
            const seen = new Set(), out = [];
            notYet.forEach((r) => { const w = why[r.id], g = w && w.group;
              if (g) {
                if (seen.has(g.key)) return; seen.add(g.key);
                out.push(<li key={"g:" + g.key} className="cm-grp" data-cm-group={g.key}><div className="cm-why" data-cm-why={g.step}><b>{g.head}</b> — {g.words}
                  {!locked && (g.step === "bsr" ? <> <button className="linkbtn" onClick={() => setPays(true)}>Make it a challan…</button></> : <> <button className="linkbtn" onClick={() => setAdding(true)}>Add challan</button></>)}</div></li>);
                notYet.filter((x) => why[x.id] && why[x.id].group && why[x.id].group.key === g.key).forEach((x) => out.push(<RowLine key={x.id} r={x} locked={locked} />));
                return;
              }
              out.push(<RowLine key={r.id} r={r} locked={locked}>
              <div className="cm-why" data-cm-why={w ? w.step : "none"}>{w ? w.words : "Not matched."}
                {!locked && w && (w.step === "pay" ? <button className="linkbtn" onClick={() => setAdding(true)}>Add challan</button> : w.step === "move" ? <button className="linkbtn" onClick={() => tdsMoveOpen([r.id])}>Move to challan…</button> : null)}</div></RowLine>); });
            return out; })()}</ul>
            : <p className="note">Every {unit.replace(/s$/, "")} is on a challan or in a suggestion.</p>}</section>
        : sel ? <ChallanTicker c={sel} form={form} fy={fy} q={q} locked={locked} sugg={sugg} byId={byId} /> : null}</div>
    </div>
    <SelBar all={all} locked={locked} />
  </div>;
}

function SelBar({ all, locked }) {
  const ticked = all.filter((r) => sel()[r.id]), sum = r2(ticked.reduce((a, r) => a + r.tds, 0));
  if (locked || !ticked.length) return null;
  return <div className="cm-bar-sel" data-cm-selbar="">
    <span><b>{ticked.length} ticked</b> · {money(sum)}</span>
    <button className="btn small" data-cm-move="" onClick={() => tdsMoveOpen(ticked.map((r) => r.id))}>Move to challan…</button>
    {ticked.some((r) => r.challan) && <button className="btn small" data-cm-takeoff="" onClick={() => tdsTakeOff(ticked.filter((r) => r.challan).map((r) => r.id))}>Take off challan</button>}
    <button className="linkbtn" onClick={() => { S.tdsSel = {}; render(); }}>Clear</button></div>;
}

// what blocks the file and what to look at, said before the file (the Challans tab's step ③ and Make the file)
export function FileChecks({ form, fy, q }) {
  const checks = TDSMatch.checks(form, fy, q), unit = form === "27EQ" ? "collection" : "deduction";
  return <div className="cm-checks-l" data-cm-checks={checks.block.length ? "block" : "ok"}>
    {checks.block.length ? <ul className="cm-block">{checks.block.map((x) => <li key={x.k} data-cm-block={x.k}>{x.words} {x.k === "untagged" ? <button className="linkbtn" onClick={() => tdsTabGo("challans")}>Match them on Challans</button> : null}</li>)}</ul>
      : <p className="ok-line" data-cm-ready="">Every {unit} is on a challan and no challan is used beyond its tax.</p>}
    {checks.warn.length > 0 && <ul className="cm-warn">{checks.warn.map((x, i) => <li key={i} data-cm-warn={x.k}>{x.words}</li>)}</ul>}
    {checks.info.length > 0 && <ul className="note">{checks.info.map((x, i) => <li key={i} data-cm-info={x.k}>{x.words}</li>)}</ul>}
  </div>;
}

// a plain list of the return's deductions with their challan (Form 138 from the salary sheet or the books), filtered by
// section, month, challan, matched or not; the challan-first view when a challan is chosen
export function PlainDeductions({ form, fy, q, extra }) {
  const rows = TDS.formRows(form).filter((r) => r.fy === fy && r.q === q && r.tds > 0.005), [f, setF] = useState({}), locked = TDSReg.locked(fy, q, form);
  const c = S.tdsDedCh ? TDS.challans().find((x) => x.id === S.tdsDedCh) : null;
  const chOf = (id) => TDS.challans().find((x) => x.id === id);
  const shown = rows.filter((r) => (!f.sec || TDS.sec(r.section) === f.sec) && (!f.month || TDS.ymd(r.date).slice(0, 6) === f.month) && (!f.st || (f.st === "matched" ? !!r.challan : !r.challan)) && (!f.ch || r.challan === f.ch));
  return <div data-plain-deductions="">
    <div className="rt-tool" data-step-tool=""><ChallanSelect form={form} fy={fy} q={q} value={S.tdsDedCh} onChange={(v) => { S.tdsDedCh = v; render(); }} />
      {!c && <>
        <select aria-label="Section" value={f.sec || ""} onChange={(ev) => setF({ ...f, sec: ev.target.value })}><option value="">All sections</option>{Array.from(new Set(rows.map((r) => TDS.sec(r.section)))).sort().map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select aria-label="Month" value={f.month || ""} onChange={(ev) => setF({ ...f, month: ev.target.value })}><option value="">All months</option>{tdsMonths(fy, q).map((x) => <option key={x} value={x}>{monthOf(x)}</option>)}</select>
        <select aria-label="Matched or not" value={f.st || ""} onChange={(ev) => setF({ ...f, st: ev.target.value })}><option value="">Matched and not</option><option value="matched">Matched</option><option value="not">Not matched</option></select></>}
      {extra}</div>
    {c ? <ChallanTicker c={c} form={form} fy={fy} q={q} locked={locked} sugg={TDSMatch.suggest(form, fy, q)} mode="deductions" /> : <>
      <div className="bk-tablewrap"><table className="bk-table" data-statement="" data-plain-table="">
        <thead><tr><th className="dt">Date</th><th>{form === "24Q" ? "Employee" : "Deductee"}</th><th>PAN</th><th>Section</th><th className="n">Paid</th><th className="n">TDS</th><th>Challan</th></tr></thead>
        <tbody>{shown.map((r) => <tr key={r.id}><td>{day(r.date)}</td><td>{r.party || r.employee}</td><td>{r.pan || <span className="tag bad">no PAN</span>}</td><td>{TDS.sec(r.section)}</td>
          <td className="n">{money(r.paid)}</td><td className="n">{money(r.tds)}</td><td><ChallanCell r={r} /></td></tr>)}</tbody></table></div>
      {!shown.length && <p className="note">No deduction matches these filters.</p>}</>}
  </div>;
}

// the deduction's challan on the Deductions tab: "BSR · date · serial" (its section under it), or "Not matched" in red;
// a click opens the Move dialog (never a silent re-tag)
export function ChallanCell({ r }) {
  const c = r.challan ? TDS.challans().find((x) => x.id === r.challan) : null;
  return <button type="button" className={"linkbtn cm-cell" + (c ? "" : " bad")} data-ch-cell={r.id} aria-label={"Challan for " + (r.party || "")} title={c ? c.bsr + " · " + day(c.date) + " · " + c.serial + " · " + (chSec(c) || "no section") + " · " + TDSMatch.matchedBy(r.id).words : "On no challan: choose one"} onClick={() => tdsMoveOpen([r.id])}>
    {c ? <>{c.serial + " · " + day(c.date).slice(0, 6) + " · " + (chSec(c) || "—")}{r.splitOf ? " (part " + r.part + ")" : ""}</> : "Not matched ▸"}</button>;
}

// the Move dialog and the Split dialog, once per return page
export function MatchDialogs({ form, fy, q }) { return <><MoveDialog /><SplitDialog form={form} fy={fy} q={q} /><RowDetails form={form} /></>; }

// a deduction's details (the panels show eight columns; the rest is here)
function RowDetails({ form }) {
  const id = S.tdsRowDet, cx = TDSReg.ctx(), x = id ? cx.byRow[id] : null;
  const close = () => { S.tdsRowDet = ""; render(); };
  if (!x) return <SideDrawer open={false} onClose={close} kind="deduction" />;
  const r = x.r, c = r.challan ? TDS.challans().find((z) => z.id === r.challan) : null;
  const sn = TDS.secNew(r.section, r.fy || S.tdsFy), iss = form === "26Q" ? Certs.issues(r.fy || S.tdsFy, r.q || S.tdsQ).find((z) => z.row.id === r.id) : null;
  const rows = [["Deductee", r.party || r.employee], ["PAN", (r.pan || "none") + " · " + PANCheck.status(r.pan).words], ["Section", sn.ref ? sn.ref + " [old " + sn.old + "] · " + sn.label : TDS.sec(r.section) + (TDS.secName(r.section) ? " · " + TDS.secName(r.section) : "")], ["Amount paid or credited", money(r.paid) + (r.books && Math.abs(num(r.books.paid) - num(r.paid)) >= 0.005 ? " (edited in FinCom: books " + money(r.books.paid) + ")" : "")],
    ["Date paid or credited", day(r.credit || r.date)], ["TDS", money(r.tds) + (r.books && Math.abs(num(r.books.tds) - num(r.tds)) >= 0.005 ? " (edited in FinCom: books " + money(r.books.tds) + ")" : "")], ["Date of deduction", day(r.date)], ["Rate", (r.rate != null ? r.rate + "%" : "") + (iss ? " · should be " + iss.expected + "% (" + iss.why + ")" : "")], ["Voucher", r.voucher || ""],
    ["Ledger", r.ledger || ""], ["Certificate", certOf(r, form)], ["Rate basis", basisOf(r, form)], ["Challan", c ? TDSCH.label(c) : "Not matched"], ["Matched by", TDSMatch.matchedBy(r.id).words.replace(/^Matched by: /, "") || "—"],
    ["From", r.added ? "Added in FinCom" + (r.addedBy ? " by " + r.addedBy : "") + (r.addedAt ? " on " + fmtDateTime(r.addedAt) : "") : r.src === "bridge" ? "Tally (bridge)" : r.src === "daybook" ? "Day Book uploaded" : r.src === "payroll" ? "Tally's payroll" : r.src === "sheet" ? "the salary sheet" : r.src || ""]];
  return <SideDrawer open onClose={close} kind="deduction" title="Deduction details" description={(r.party || r.employee || "") + " · " + money(r.tds)}>
    <div data-row-dialog="">
      {!Certs.validPan(r.pan) && <p className="note" data-row-pan="">No PAN: <PanBox party={r.party || r.employee} /> saved for every deduction of {r.party || r.employee}, in every return.</p>}
      <dl className="ch-dl">{rows.flatMap(([k, v]) => [<dt key={k + "t"}>{k}</dt>, <dd key={k + "d"}>{v}</dd>])}</dl>
      <div className="row" style={{ gap: 8 }}><button className="btn small" onClick={() => { close(); tdsMoveOpen([r.id]); }}>Move to challan…</button>
        {form !== "24Q" && form !== "27EQ" && <button className="btn small" data-row-edit={r.id} onClick={() => { close(); S.tdsAdd = { rowId: r.id }; render(); }}>{r.added ? "Edit or delete…" : "Correct in FinCom…"}</button>}</div>
    </div></SideDrawer>;
}

function MoveDialog() {
  const mv = S.tdsMove, [sec, setSec] = useState(""), [mon, setMon] = useState("");
  if (!mv) return <Dialog open={false} onOpenChange={() => {}} />;
  const cx = TDSReg.ctx(), rows = mv.ids.map((id) => cx.byRow[id] && cx.byRow[id].r).filter(Boolean), need = r2(rows.filter((r) => !r.challan || true).reduce((a, r) => a + r.tds, 0));
  const list = TDS.challans().filter((c) => (!sec || chSec(c) === sec || !chSec(c)) && (!mon || TDS.ymd(c.date).slice(0, 6) === mon)).map((c) => {
    const add = r2(rows.filter((r) => r.challan !== c.id).reduce((a, r) => a + r.tds, 0)), left = TDSReg.balance(c, cx).tax;
    // next-tds-addlist: a challan deposited before any of these deductions cannot pay it: shown, never offered
    return { c, left, after: r2(left - add), early: rows.filter((r) => TDSEdit.early(r, c)).length };
  }).sort((a, b) => (a.early ? 1 : 0) - (b.early ? 1 : 0) || (b.after >= -0.005) - (a.after >= -0.005) || TDS.ymd(a.c.date).localeCompare(TDS.ymd(b.c.date)));
  const secs = Array.from(new Set(TDS.challans().map(chSec).filter(Boolean))).sort(), months = Array.from(new Set(TDS.challans().map((c) => TDS.ymd(c.date).slice(0, 6)))).sort();
  const close = () => { S.tdsMove = null; render(); };
  return <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
    <DialogContent title={"Move " + rows.length + " deduction" + (rows.length === 1 ? "" : "s") + " to a challan"} description={money(need) + " · " + Array.from(new Set(rows.map(secOf))).join(", ")} data-cm-move-dialog="">
      <div className="row cm-filters">
        <select aria-label="Challan section" value={sec} onChange={(ev) => setSec(ev.target.value)}><option value="">Every section</option>{secs.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select aria-label="Challan month" value={mon} onChange={(ev) => setMon(ev.target.value)}><option value="">Every month</option>{months.map((x) => <option key={x} value={x}>{monthOf(x)}</option>)}</select></div>
      <ul className="cm-pick">{list.map(({ c, left, after, early }) => <li key={c.id} data-cm-pick={c.id}>
        <span><b>{c.bsr} · {day(c.date)} · {c.serial}</b> <span className="tag">{chSec(c) || "no section"}</span><span className="note"> {monthOf(TDS.ymd(c.date).slice(0, 6))} · {money(left)} left</span>
          {early ? <small className="bad" data-cm-early={c.id}> dated before {rows.length === 1 ? "the deduction" : early + " of these deductions"}: it cannot pay {rows.length === 1 ? "it" : "them"}</small> : null}
          {after < -0.005 ? <small className="bad"> needs {money(-after)} more than it has</small> : early ? null : <small className="note"> → {money(after)} left after</small>}</span>
        <button className="btn small" disabled={after < -0.005 || early > 0} data-cm-pick-go={c.id} onClick={() => tdsMoveTo(mv.ids, c.id)}>Move here</button></li>)}
        {!list.length && <li className="note">No challan of that section or month.</li>}</ul>
      {rows.some((r) => r.challan) && <div className="row"><button className="btn small" data-cm-takeoff-dlg="" onClick={() => { tdsTakeOff(rows.filter((r) => r.challan).map((r) => r.id)); close(); }}>Take off challan</button></div>}
    </DialogContent></Dialog>;
}

function SplitDialog({ form, fy, q }) {
  const sp = S.tdsSplit, s = sp && sp.key ? TDSMatch.find(sp.key, form, fy, q) : null, [parts, setParts] = useState(null);
  if (!sp) return <Dialog open={false} onOpenChange={() => {}} />;
  const close = () => { S.tdsSplit = null; setParts(null); render(); };
  const cx = TDSReg.ctx(), rowId = s ? s.ids[0] : sp.rowId, r = rowId && cx.byRow[rowId] ? cx.byRow[rowId].r : null;
  if (!r || (sp.key && !s)) return <Dialog open onOpenChange={(o) => { if (!o) close(); }}><DialogContent title="Split the row"><p className="note">That suggestion is no longer there.</p></DialogContent></Dialog>;
  // a split asked from a challan (Split… on a deduction more than its balance): that challan's balance first, the rest on
  // the challan of the same section with the most left (changeable)
  const start = () => {
    if (s) return s.parts.map((p) => ({ chId: p.chId, tds: String(p.paise / 100) }));
    const here = TDS.challans().find((c) => c.id === sp.chId), left = here ? Math.max(0, TDSReg.balance(here, cx).tax) : 0, rest = r2(r.tds - left);
    const other = TDS.challans().filter((c) => c.id !== sp.chId && TDSReg.balance(c, cx).tax > 0.005).sort((a, b) => (TDSCH.secOk(b.section, r.section) - TDSCH.secOk(a.section, r.section)) || TDSReg.balance(b, cx).tax - TDSReg.balance(a, cx).tax)[0];
    return [{ chId: sp.chId, tds: String(left) }, { chId: other ? other.id : "", tds: String(rest) }];
  };
  const ps = parts || start();
  const tot = r2(ps.reduce((a, p) => a + num(p.tds), 0)), okSum = Math.round(tot * 100) === Math.round(r.tds * 100) && ps.every((p) => p.chId);
  const opts = TDS.challans().filter((c) => TDSReg.balance(c, cx).tax > 0.005 || ps.some((p) => p.chId === c.id));
  return <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
    <DialogContent title="Split the row across challans" description={(r.party || r.employee || "") + " · " + day(r.date) + " · " + secOf(r) + " · " + money(r.tds)} data-cm-split-dialog="">
      <p className="note">No one challan has enough left for this deduction. It becomes {ps.length} rows in the file, the same payment and deduction dates, each paid by its own challan; the amount paid is divided in the same proportion.</p>
      <table className="bk-table cm-split"><thead><tr><th>Part</th><th>Challan</th><th className="n">Left on it</th><th className="n">Tax in this part</th></tr></thead>
        <tbody>{ps.map((p, i) => { const c = TDS.challans().find((x) => x.id === p.chId);
          return <tr key={i} data-cm-split-part={i + 1}><td>{i + 1}</td><td>{s || i === 0 ? (c ? TDSCH.label(c) : p.chId)
            : <select aria-label={"Challan of part " + (i + 1)} value={p.chId} onChange={(ev) => setParts(ps.map((x, j) => (j === i ? { ...x, chId: ev.target.value } : x)))}><option value="">Choose a challan</option>{opts.filter((x) => x.id !== ps[0].chId).map((x) => <option key={x.id} value={x.id}>{TDSCH.label(x)} · {money(TDSReg.balance(x, cx).tax)} left</option>)}</select>}</td>
            <td className="n">{c ? money(TDSReg.balance(c, cx).tax) : ""}</td>
            <td className="n"><input type="text" inputMode="decimal" value={p.tds} aria-label={"Tax in part " + (i + 1)} onChange={(ev) => setParts(ps.map((x, j) => (j === i ? { ...x, tds: ev.target.value } : x)))} style={{ width: 110, textAlign: "right" }} /></td></tr>; })}</tbody>
        <tfoot><tr><td colSpan={3}>Together</td><td className={"n" + (okSum ? "" : " bad")}>{money(tot)}{Math.round(tot * 100) === Math.round(r.tds * 100) ? "" : " (must be " + money(r.tds) + ")"}</td></tr></tfoot></table>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn small primary" data-cm-split-go="" disabled={!okSum} onClick={() => { const x = tdsSplitDo(rowId, ps.map((p) => ({ chId: p.chId, tds: num(p.tds) }))); if (x.ok) setParts(null); }}>Split the row</button>
        <button className="btn small" onClick={close}>Cancel</button></div>
    </DialogContent></Dialog>;
}
