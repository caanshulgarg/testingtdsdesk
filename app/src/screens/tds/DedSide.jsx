// The Deductions step as the one place to match (next-tds-clear; the owner, 19-Oct-2026: "nobody opens challans one by
// one"): the deductions table with every filter, and beside it a challans panel (sticky; on a phone a section on top that
// folds): each challan of the return with its tax, what is used and its BALANCE, live, and "Not matched (N · ₹X)". The
// matcher (rules a to f, and the AI's step g: TDSMatch.suggest / view, src/js/86) has run when the step opens: each
// deduction not on a challan shows its SUGGESTED challan with the reason and a tick; ticking puts it on that challan at
// once (the panel's balance drops), unticking takes it off; "Accept all N suggestions" ticks them all. A deduction no
// challan can take shows its reason and next step (pay, split, add a challan). A challan clicked in the panel filters the
// table to it (its deductions and its suggestions); clicked again, all. Nothing here works out a match.
import "../../lib/tdsGlobals.js";

const money = (v) => "₹" + INR.format(r2(v || 0));
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
const chSec = (c) => TDSCH.secNorm(c.section) || "";
const short = (c) => c.serial + " · " + day(c.date).slice(0, 6) + (chSec(c) ? " · " + chSec(c) : "");

// the suggestions by deduction: {byRow: {rowId: s}, sugg, why: {rowId: reason}, ai}
export function dedMatch(form, fy, q) {
  let sugg = [], reasons = [], ai = null;
  try { sugg = TDSMatch.suggest(form, fy, q); reasons = TDSMatch.reasons(form, fy, q); ai = TDSMatch.view(form, fy, q); } catch (e) { /* the matcher not loaded */ }
  const byRow = {}, why = {};
  sugg.filter((s) => s.rule !== "int").forEach((s) => s.ids.forEach((id) => { if (!byRow[id]) byRow[id] = s; }));
  reasons.forEach((x) => { why[x.rowId] = x; });
  return { byRow, sugg, why, ai, accept: sugg.filter((s) => s.rule !== "split" && s.rule !== "int") };
}

// one row's challan: on a challan (ticked; untick takes it off), a suggestion (a tick puts it on), or the reason
export function ChallanOrSugg({ r, m, locked }) {
  const chs = TDS.challans();
  if (r.challan) {
    const c = chs.find((x) => x.id === r.challan);
    return <span className="dd-ch on" data-dd-on={r.id}>{!locked && <input type="checkbox" checked aria-label={"Take " + (r.party || "") + " off its challan"} data-dd-off={r.id} onChange={() => { const x = TDSMatch.takeOff([r.id]); if (!x.ok) toast(x.why); render(); }} />}
      <button type="button" className="linkbtn cm-cell" data-ch-cell={r.id} title={c ? c.bsr + " · " + day(c.date) + " · " + c.serial + " · " + (chSec(c) || "no section") + " · " + TDSMatch.matchedBy(r.id).words : ""} onClick={() => tdsMoveOpen([r.id])}>{c ? c.serial + " · " + day(c.date).slice(0, 6) : r.challan}</button></span>;
  }
  const s = m.byRow[r.id];
  if (s && s.rule === "split") return <span className="dd-ch" data-dd-split={r.id}><button type="button" className="linkbtn" onClick={() => tdsSplitOpen(s.key)}>Split across challans…</button><small className="dd-why">{s.reason}</small></span>;
  if (s) {
    const c = chs.find((x) => x.id === s.chId);
    return <span className="dd-ch sugg" data-dd-sugg-cell={r.id}>{!locked && <input type="checkbox" checked={false} aria-label={"Put " + (r.party || "") + " on challan " + (c ? TDSCH.label(c) : "")} data-dd-sugg={r.id}
      onChange={() => { const x = TDSCH.tag([r.id], s.chId, { via: "suggestion", note: "suggestion confirmed: " + s.words + (s.rule === "g" ? " (" + s.reason + ")" : "") }); if (!x.ok) toast(x.why); render(); }} />}
      <span className="dd-sl" title={(c ? TDSCH.label(c) + " · " : "") + s.reason}>{c ? c.serial + " · " + day(c.date).slice(0, 6) : s.chId}</span><small className="dd-why" title={s.reason}>{s.rule === "g" || s.ai ? "AI: " : ""}{s.words}</small></span>;
  }
  const w = m.why[r.id];
  return <span className="dd-ch none" data-dd-none={r.id}><span className="bad">Not matched</span><small className="dd-why" data-cm-why={w ? w.step : "none"}>{w ? w.words : "No challan fits."}
    {!locked && w && w.step === "move" ? <> <button type="button" className="linkbtn" onClick={() => tdsMoveOpen([r.id])}>Move to challan…</button></> : null}</small></span>;
}

// the challans panel
export function ChallanSide({ form, fy, q, rows, m }) {
  const cx = TDSReg.ctx(), k = TDSReg.key(form, fy, q), want = new Set(Object.values(m.byRow).map((s) => s.chId));
  const mine = TDS.challans().filter((c) => (cx.uses[c.id] || {})[k] || want.has(c.id)).sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)));
  const cur = S.tdsDedChF || "", pick = (id) => { S.tdsDedChF = cur === id ? "" : id; render(); };
  const un = rows.filter((r) => !r.challan && r.tds > 0.005), unS = un.filter((r) => m.byRow[r.id]);
  return <aside className="dd-side" data-dd-side="">
    <details className="dd-sidedet" open>
      <summary><b>Challans</b> <span className="note">{mine.length} · tap one to see its deductions</span></summary>
      <ul className="dd-chs">{mine.map((c) => { const bal = TDSReg.balance(c, cx).tax, used = TDSReg.usedTax(c, cx);
        const ns = un.filter((r) => m.byRow[r.id] && m.byRow[r.id].chId === c.id).length;
        return <li key={c.id}><button type="button" className={"dd-chb" + (cur === c.id ? " on" : "")} aria-pressed={cur === c.id} data-dd-ch={c.id} title={TDSCH.label(c)} onClick={() => pick(c.id)}>
          <span className="dd-chn">{short(c)}</span>
          <span className="dd-chf"><span>Tax {money(c.tax)}</span><span>used {money(used)}</span></span>
          <span className={"dd-bal" + (bal < -0.005 ? " bad" : "")} data-dd-bal={r2(bal)}>{bal < -0.005 ? "over by " + money(-bal) : money(bal) + " left"}</span>
          {ns ? <span className="dd-ns" data-dd-nsugg={ns}>{ns} suggested</span> : null}</button>
          {(() => { let d = null, cur = null; try { if ((cx.uses[c.id] || {})[k]) { d = TDSMatch.defaultPortion(c, form, fy, q); cur = TDSReg.portionFor(c, form, fy, q, cx); } } catch (e) { /* */ }
            return d && d.due >= 1 && num(cur.interest) + 0.5 < d.due && !TDSReg.locked(fy, q, form) ? <button type="button" className="dd-fix" data-dd-interest={c.id} title={"Interest due on this return's late deductions or deposits on this challan; its interest paid " + money(c.interest)}
              onClick={() => { const r = tdsPortionSet(c.id, String(Math.min(d.due, num(c.interest) || d.due)), String(cur.fee || "")); if (r && r.ok === false) toast(r.why); render(); }}>Allocate interest {money(Math.min(d.due, num(c.interest) || d.due))} here</button> : null; })()}</li>; })}
        {!mine.length && <li className="note">No challan for this quarter yet: Challans › Add challan.</li>}
        <li className="dd-noneli"><button type="button" className={"dd-chb" + (cur === "__none" ? " on" : "")} aria-pressed={cur === "__none"} data-dd-ch="__none" onClick={() => pick("__none")}>
          <span className={"dd-chn" + (un.length ? " bad" : "")}>Not matched ({un.length} · {money(un.reduce((a, r) => a + r.tds, 0))})</span>
          {un.length ? <span className="dd-ns">{unS.length} with a suggestion</span> : null}</button></li></ul>
    </details>
  </aside>;
}
// the table's rows for the challan chosen in the panel
export const sideFilter = (rows, m) => {
  const cur = S.tdsDedChF || "";
  if (!cur) return rows;
  if (cur === "__none") return rows.filter((r) => !r.challan);
  return rows.filter((r) => r.challan === cur || (!r.challan && m.byRow[r.id] && m.byRow[r.id].chId === cur));
};
