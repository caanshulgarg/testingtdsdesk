// The return's Deductions register (next-tds-register, 20-Oct-2026; the owner). "Deductions N" on the Deductions step opens
// it; it is the one place for the deductions on no challan (the "Not on any challan" list is gone):
//   Pending  on no challan: its problem as a short chip, the challan the matcher suggests (Confirm) or the best that fit
//            (one click), else "Needs a challan"; tick rows to map them to a challan in one go
//   Mapped   on a challan: serial · date, how it was placed (a rule's short name, AI with its reason on a hover, By hand
//            with who and when: onChallan.js howPlaced), Verified (a tick per row and in bulk; a rule's or the AI's row
//            not verified says "to check"); tick rows to move them, take them off or mark them verified
// Every column's filter is in its header (tds/ColF.jsx; How placed, and Verified with "AI, not verified"). Everything is
// drawn from the books on each render, so a row mapped, moved or taken off anywhere moves between the tabs at once.
import "../../lib/tdsGlobals.js";
import { SideDrawer } from "./Shell.jsx";
import { useCF, Th } from "./ColF.jsx";
import { DedName } from "./DedName.jsx";
import { rowProblem, bestChallans } from "./DedTodo.jsx";
import { chIds, isPlaced, chMissing, missingName, chipW, howPlaced, verifiedOf, setVerified, winChallans } from "./onChallan.js";
import "./clear.css";

const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const dm6 = (d) => day(d).slice(0, 6);
const chSec = (c) => TDSCH.secNorm(c.section) || "";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monW = (ym) => (String(ym).length === 6 ? MON[+String(ym).slice(4, 6) - 1] + " " + String(ym).slice(0, 4) : ym);
const secOf = (r) => TDS.sec(r.section) || r.section || "";
const VER = (x) => (x.how.k === "hand" ? "By hand" : x.ver ? "Verified" : x.how.k === "ai" ? "AI, not verified" : "Rule, not verified");

export const openDedRegister = (tab) => { S.tdsDedReg = tab || "pending"; S.tdsDregSel = {}; render(); };

// the button on the return: "Deductions N"
export function DedRegButton({ rows }) {
  return <button type="button" className="btn small" data-dreg-open={rows.length} title="Every deduction of the return: on no challan (Pending) and on a challan (Mapped)" onClick={() => openDedRegister("pending")}>Deductions {rows.length}</button>;
}

export function DedRegister({ form, fy, q, rows, m, issueOf, probs, locked }) {
  const tab = S.tdsDedReg;
  if (!tab) return null;
  const cx = TDSReg.ctx(), ids = chIds(), chBy = Object.fromEntries(TDS.challans().map((c) => [c.id, c]));
  const pend = rows.filter((r) => !isPlaced(r, ids)), mapped = rows.filter((r) => isPlaced(r, ids));
  const close = () => { S.tdsDedReg = ""; S.tdsDregSel = {}; render(); };
  const go = (t) => { S.tdsDedReg = t; S.tdsDregSel = {}; render(); };
  const unit = form === "27EQ" ? ["collection", "collections"] : ["deduction", "deductions"];
  return <SideDrawer open onClose={close} kind="dreg" wide title={(form === "27EQ" ? "Collections" : "Deductions") + " · " + TDS.formShort(form, fy) + " · " + q + " " + fy}
    description={rows.length + " " + unit[rows.length === 1 ? 0 : 1] + " · " + pend.length + " pending · " + mapped.length + " mapped"}>
    <div className="dreg" data-dreg={TDSReg.key(form, fy, q)}>
      <div className="dreg-tabs" role="tablist">
        {[["pending", "Pending", pend.length], ["mapped", "Mapped", mapped.length]].map(([k, w, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k}
          className={"dreg-tab" + (tab === k ? " on" : "")} data-dreg-tab={k} data-dreg-n={n} onClick={() => go(k)}>{w} <span className="rt-tc">{n}</span></button>)}
      </div>
      {tab === "mapped" ? <Mapped rows={mapped} chBy={chBy} probs={probs} issueOf={issueOf} form={form} fy={fy} q={q} locked={locked} cx={cx} />
        : <Pending rows={pend} m={m} probs={probs} issueOf={issueOf} form={form} fy={fy} q={q} locked={locked} cx={cx} />}
    </div>
  </SideDrawer>;
}

// the ticks of the tab shown (S.tdsDregSel), the "tick all" box and the bar of what to do with them
function useTicks(shown) {
  const sel = S.tdsDregSel || {}, picked = shown.filter((x) => sel[x.r.id]);
  const tick = (id, v) => { const n = Object.assign({}, sel); if (v) n[id] = true; else delete n[id]; S.tdsDregSel = n; render(); };
  const all = shown.length > 0 && shown.every((x) => sel[x.r.id]);
  const tickAll = (v) => { const n = Object.assign({}, sel); shown.forEach((x) => { if (v) n[x.r.id] = true; else delete n[x.r.id]; }); S.tdsDregSel = n; render(); };
  return { sel, picked, tick, all, tickAll, clear: () => { S.tdsDregSel = {}; } };
}
const TickTh = ({ t, locked }) => <th className="ck">{!locked ? <input type="checkbox" checked={t.all} aria-label="Tick all shown" data-dreg-tickall="" onChange={(ev) => t.tickAll(ev.target.checked)} /> : <span className="sr-only">Tick</span>}</th>;
const TickTd = ({ t, r, locked }) => <td className="ck">{!locked && <input type="checkbox" checked={!!t.sel[r.id]} data-dreg-tick={r.id} aria-label={"Tick " + (r.party || r.employee || "this deduction")} onChange={(ev) => t.tick(r.id, ev.target.checked)} />}</td>;
const NameTd = ({ r, locked }) => <td className="dreg-name" data-dreg-name={r.id}><DedName r={r} locked={locked} title="Details" onOpen={() => { S.tdsRowDet = r.id; render(); }} /></td>;
// the return's challans to map or move to
function ToChallan({ form, fy, q, cx, verb, n, onGo, data }) {
  const list = winChallans(form, fy, q, cx), cur = S.tdsDregTo && list.some((c) => c.id === S.tdsDregTo) ? S.tdsDregTo : "";
  return <span className="dreg-to"><select aria-label="Challan" data-dreg-to="" value={cur} onChange={(ev) => { S.tdsDregTo = ev.target.value; render(); }}>
      <option value="">Challan…</option>
      {list.map((c) => <option key={c.id} value={c.id}>{c.serial + " · " + dm6(c.date) + (chSec(c) ? " · " + chSec(c) : "") + " · " + money(TDSReg.balance(c, cx).tax) + " left"}</option>)}</select>
    <button type="button" className="btn small" disabled={!cur || !n} {...data} onClick={() => onGo(cur)}>{verb} {n}</button></span>;
}

function Pending({ rows, m, probs, issueOf, form, fy, q, locked, cx }) {
  const items = rows.map((r) => {
    const prob = rowProblem(r, issueOf[r.id], probs[r.id], form), s = m && m.byRow ? m.byRow[r.id] : null;
    const sg = s && s.rule !== "split" && s.rule !== "int" ? s : null;
    // the best that hold it (its section's first), as the to-do list offered them: never one that cannot pay it
    const best = sg || !(r.tds > 0.005) ? [] : bestChallans(r, cx), secFit = best.filter((b) => b.fits && b.sec);
    return { r, prob, s: sg, miss: chMissing(r) ? r.challan : "", best: (secFit.length ? secFit : best.filter((b) => b.fits)).slice(0, 3) };
  });
  const cf = useCF("dreg-p", [
    { k: "name", title: "Name", kind: "q", placeholder: "Name, PAN or voucher", get: (x) => [x.r.party, x.r.employee, x.r.pan, x.r.voucher].join(" ") },
    { k: "chk", title: "Check", kind: "pick", get: (x) => (x.prob ? chipW(x.prob) : "—") },
    { k: "sec", title: "Section", kind: "pick", get: (x) => secOf(x.r) },
    { k: "date", title: "Date", kind: "pick", get: (x) => TDS.ymd(x.r.date).slice(0, 6), label: monW },
    { k: "paid", title: "Amount paid", kind: "num", get: (x) => x.r.paid },
    { k: "tds", title: "TDS", kind: "num", get: (x) => x.r.tds },
    { k: "next", title: "Next", kind: "pick", get: (x) => (!(x.r.tds > 0.005) ? "No TDS to pay" : x.s ? "Suggested" : x.best.length ? "Fits a challan" : "Needs a challan") },
  ], items), shown = cf.shown, t = useTicks(shown);
  const tot = r2(t.picked.reduce((a, x) => a + x.r.tds, 0));
  const map = (ch) => { const idl = t.picked.map((x) => x.r.id), y = TDSMatch.move(idl, ch); if (!y.ok) toast(y.why); else { t.clear(); toast(idl.length + " mapped to challan " + ((TDS.challans().find((c) => c.id === ch) || {}).serial || "") + "."); } render(); };
  const confirm = (x) => { const y = TDSCH.tag([x.r.id], x.s.chId, { via: "suggestion", note: "suggestion confirmed: " + x.s.words + (x.s.rule === "g" ? " (" + x.s.reason + ")" : "") }); if (!y.ok) toast(y.why); render(); };
  const put = (x, id) => { const y = TDSMatch.move([x.r.id], id); if (!y.ok) toast(y.why); render(); };
  if (!items.length) return <p className="note" data-dreg-body="pending" data-dreg-none="">Every deduction is on a challan ✓</p>;
  const nSugg = items.filter((x) => x.s).length;
  return <div data-dreg-body="pending">
    {!locked && nSugg > 0 && <div className="rt-tool"><span className="note">{nSugg} with a suggested challan</span><span className="rt-sp" />
      <button type="button" className="btn small primary" data-dreg-confirm-all={nSugg} onClick={() => tdsMatchConfirmAll()}>Confirm all {nSugg}</button></div>}
    {t.picked.length > 0 && !locked && <div className="wd-bulk" data-dreg-bulk={t.picked.length}><span><b>{t.picked.length} ticked</b> · TDS <b>{money(tot)}</b></span><span className="rt-sp" />
      <ToChallan form={form} fy={fy} q={q} cx={cx} verb="Map" n={t.picked.length} onGo={map} data={{ "data-dreg-bulk-map": "" }} />
      <button type="button" className="linkbtn" onClick={() => { t.clear(); render(); }}>Clear</button></div>}
    <div className="bk-tablewrap"><table className="bk-table gf-off dreg-table">
      <thead><tr><TickTh t={t} locked={locked} /><Th cf={cf} k="name">Name</Th><Th cf={cf} k="chk">Check</Th><Th cf={cf} k="sec">Section</Th><Th cf={cf} k="date" cls="dt">Date</Th><Th cf={cf} k="paid" cls="n">Amount paid</Th><Th cf={cf} k="tds" cls="n">TDS</Th><Th cf={cf} k="next">Next</Th></tr></thead>
      <tbody>{shown.map((x) => { const c = x.s ? TDS.challans().find((z) => z.id === x.s.chId) : null;
        return <tr key={x.r.id} data-dreg-row={x.r.id}><TickTd t={t} r={x.r} locked={locked} /><NameTd r={x.r} locked={locked} />
          <td className="dreg-f">{x.miss ? <span className="dt-flag" data-dreg-miss={x.miss} title={"Its challan " + missingName(x.miss) + " is missing — choose again"}>Challan {missingName(x.miss)} missing</span>
            : x.prob && x.prob.k !== "name" ? <span className="dt-flag" data-dreg-flag={x.prob.k} title={x.prob.words}>{chipW(x.prob)}</span> : null}</td>
          <td>{secOf(x.r)}</td><td className="dt">{day(x.r.date)}</td><td className="n">{money(x.r.paid)}</td><td className="n">{money(x.r.tds)}</td>
          <td className="dreg-next">{x.s ? <><span className="tag info" title={(x.s.rule === "g" ? "AI: " : "") + (x.s.words || "") + (x.s.reason ? " · " + x.s.reason : "")}>{c ? c.serial + " · " + dm6(c.date) : "Suggested"}</span>
              {!locked && <button type="button" className="btn small" data-dreg-confirm={x.r.id} onClick={() => confirm(x)}>Confirm</button>}</>
            : x.best.length ? (!locked ? x.best.map((b) => <button key={b.c.id} type="button" className="btn small" data-dreg-put={b.c.id} title={money(b.left) + " left"} onClick={() => put(x, b.c.id)}>{b.c.serial} · {dm6(b.c.date)}</button>) : null)
              : !(x.r.tds > 0.005) ? <span className="wd-dim">No TDS to pay</span>
              : <span className="wd-dim" title="No challan of this return has enough left: add one on the Challans step">Needs a challan</span>}</td></tr>; })}</tbody>
      {cf.on && <tfoot><tr className="wd-cffoot"><td colSpan={8}>{cf.foot()}</td></tr></tfoot>}</table></div>
  </div>;
}

function Mapped({ rows, chBy, probs, issueOf, form, fy, q, locked, cx }) {
  const items = rows.map((r) => ({ r, c: chBy[r.challan], how: howPlaced(r) || { k: "hand", w: "By hand", why: "" }, ver: verifiedOf(r), prob: rowProblem(r, issueOf[r.id], probs[r.id], form) }));
  const cf = useCF("dreg-m", [
    { k: "name", title: "Name", kind: "q", placeholder: "Name, PAN or voucher", get: (x) => [x.r.party, x.r.employee, x.r.pan, x.r.voucher].join(" ") },
    { k: "chk", title: "Check", kind: "pick", get: (x) => (x.prob ? chipW(x.prob) : "—") },
    { k: "ch", title: "Challan", kind: "pick", get: (x) => (x.c ? x.c.serial + " · " + dm6(x.c.date) : "") },
    { k: "how", title: "How placed", kind: "pick", get: (x) => x.how.w },
    { k: "ver", title: "Verified", kind: "pick", get: VER },
    { k: "sec", title: "Section", kind: "pick", get: (x) => secOf(x.r) },
    { k: "date", title: "Date", kind: "pick", get: (x) => TDS.ymd(x.r.date).slice(0, 6), label: monW },
    { k: "paid", title: "Amount paid", kind: "num", get: (x) => x.r.paid },
    { k: "tds", title: "TDS", kind: "num", get: (x) => x.r.tds },
  ], items), shown = cf.shown, t = useTicks(shown);
  const idl = () => t.picked.map((x) => x.r.id);
  const move = (ch) => { const a = idl(), y = TDSMatch.move(a, ch); if (!y.ok) toast(y.why); else { t.clear(); toast(a.length + " moved to challan " + ((TDS.challans().find((c) => c.id === ch) || {}).serial || "") + "."); } render(); };
  const remove = () => { const a = idl(), y = TDSMatch.takeOff(a); if (!y.ok) toast(y.why); else { t.clear(); toast(y.n + " taken off their challans: now Pending."); } render(); };
  const verify = () => { const a = t.picked.map((x) => x.r); t.clear(); setVerified(a, true); toast(a.length + " verified."); };
  return <div data-dreg-body="mapped">
    {t.picked.length > 0 && !locked && <div className="wd-bulk" data-dreg-mbulk={t.picked.length}><span><b>{t.picked.length} ticked</b></span><span className="rt-sp" />
      <button type="button" className="btn small" data-dreg-bulk-verify="" onClick={verify}>Verified</button>
      <ToChallan form={form} fy={fy} q={q} cx={cx} verb="Move" n={t.picked.length} onGo={move} data={{ "data-dreg-bulk-move": "" }} />
      <button type="button" className="btn small" data-dreg-bulk-remove="" onClick={remove}>Take off challan</button>
      <button type="button" className="linkbtn" onClick={() => { t.clear(); render(); }}>Clear</button></div>}
    {!items.length ? <p className="note">No deduction is on a challan yet.</p>
      : <div className="bk-tablewrap"><table className="bk-table gf-off dreg-table">
        <thead><tr><TickTh t={t} locked={locked} /><Th cf={cf} k="name">Name</Th><Th cf={cf} k="chk">Check</Th><Th cf={cf} k="ch">Challan</Th><Th cf={cf} k="how">How placed</Th><Th cf={cf} k="ver">Verified</Th><Th cf={cf} k="sec">Section</Th><Th cf={cf} k="date" cls="dt">Date</Th><Th cf={cf} k="paid" cls="n">Amount paid</Th><Th cf={cf} k="tds" cls="n">TDS</Th></tr></thead>
        <tbody>{shown.map((x) => <tr key={x.r.id} data-dreg-row={x.r.id}><TickTd t={t} r={x.r} locked={locked} /><NameTd r={x.r} locked={locked} />
          <td className="dreg-f">{x.prob && x.prob.k !== "name" ? <span className={"dt-flag" + (x.prob.info ? " info" : "")} data-dreg-flag={x.prob.k} title={x.prob.words}>{chipW(x.prob)}</span> : null}</td>
          <td data-dreg-ch={x.r.challan} className="dreg-chc">{x.c ? x.c.serial + " · " + dm6(x.c.date) : ""}</td>
          <td><span className={"dreg-how " + x.how.k} data-dreg-how={x.how.k} title={x.how.why}>{x.how.w}</span></td>
          <td className="dreg-ver">{x.how.k === "hand" ? <span className="wd-dim" title="Placed by a person">—</span>
            : <label className="dreg-vl"><input type="checkbox" checked={x.ver} disabled={locked} data-dreg-verify={x.r.id} aria-label={"Verified: " + (x.r.party || x.r.employee || "")} onChange={(ev) => setVerified([x.r], ev.target.checked)} />
              {x.ver ? <span>Verified</span> : <span className="dreg-chk" data-dreg-tocheck="">to check</span>}</label>}</td>
          <td>{secOf(x.r)}</td><td className="dt">{day(x.r.date)}</td><td className="n">{money(x.r.paid)}</td><td className="n">{money(x.r.tds)}</td></tr>)}</tbody>
        {cf.on && <tfoot><tr className="wd-cffoot"><td colSpan={10}>{cf.foot()}</td></tr></tfoot>}</table></div>}
  </div>;
}
