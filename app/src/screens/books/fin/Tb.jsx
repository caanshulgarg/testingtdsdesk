// Trial balance & mapping: every ledger with its Tally group, PY, CY, adjustments, final and its code (the line of the
// notes it goes to). A code comes suggested by rule (FinSt.suggest) or is chosen by hand (FinSt.mapSet: b.fs.map, synced,
// remembered and carried to the next year). Several can be ticked and given one code. Below, folded, the adjustments:
// audit entries kept in FinCom only (FinSt.adjAdd), never posted to Tally.
//
// The "Loan given" tick (round 4, 03-Oct-2026, item 26; was on the Accounts page's Mapping): a ledger under Loans &
// Advances (Asset) can be marked so the MIS cash flow puts it under investing: co.choices["flow:<ledger>"] = loan_given,
// confirmed by the person who ticks it; unticked, it is forgotten. The column shows only when such a ledger is there.
import { useEffect, useRef, useState } from "react";
import Button from "../../../parts/Button.jsx";
import Tag from "../../../parts/Tag.jsx";
import { rs, inr, st, setFin, codeGroups } from "./util.js";

const isLent = (l) => FS.nature(l).path.some((g) => /^loans & advances \(asset\)$/i.test(String(g).trim()));
function loanGiven(l, on) {
  const co = CO(); if (!co) return;
  if (on) choiceConfirm(co, "flow:" + l, "loan_given"); else choiceForget(co, "flow:" + l);
  toast(on ? l + ": marked Loan given; the cash flow shows it under investing." : l + ": the Loan given mark removed.");
  render();
}

// the code list: a search box over the codes, by note; "none" leaves a ledger out, "" gives it back to the rule
function CodeList({ kind, at, value, onPick, onClose, allowRule }) {
  const [q, setQ] = useState(""), box = useRef(null), inp = useRef(null);
  useEffect(() => {
    if (inp.current) inp.current.focus();
    const out = (ev) => { if (box.current && !box.current.contains(ev.target) && !(ev.target.closest && ev.target.closest("[data-fin-codebtn]"))) onClose(); };
    const esc = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", out); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc, true); };
  }, []);
  const t = q.trim().toLowerCase();
  const groups = codeGroups(kind).map(([g, list]) => [g, list.filter(([c, l]) => !t || c.toLowerCase().startsWith(t) || l.toLowerCase().includes(t) || g.toLowerCase().includes(t))]).filter(([, l]) => l.length);
  const W = Math.min(380, window.innerWidth - 32), left = Math.max(16, Math.min(at.left, window.innerWidth - W - 16));
  const below = at.bottom + 4, room = window.innerHeight - below;
  // below the button when the list fits there (its full height, or more room than above), else above it; never past the window
  const need = Math.min(380, window.innerHeight * 0.7) + 8, above = at.top - 12;
  const pos = room >= need || room >= above ? { top: below, left, maxHeight: Math.max(160, Math.min(380, room - 8)) } : { bottom: Math.max(8, window.innerHeight - at.top + 4), left, maxHeight: Math.max(160, Math.min(380, above)) };
  return <div className="fin-pick" ref={box} style={pos} role="dialog" aria-label="Choose a code" data-fin-pick="">
    <input ref={inp} type="search" aria-label="Find a code" placeholder="Find a code or a line" value={q} onChange={(ev) => setQ(ev.target.value)}
      onKeyDown={(ev) => { if (ev.key === "Enter") { const f = groups[0] && groups[0][1][0]; if (f) onPick(f[0]); } }} />
    <ul>{groups.map(([g, list]) => [<li key={"g" + g} className="g">{g}</li>,
      ...list.map(([c, l]) => <li key={c}><button type="button" className={c === value ? "on" : ""} data-fin-code={c} onClick={() => onPick(c)}><b>{c}</b><span>{l}</span></button></li>)])}
      {!groups.length && <li className="g">No code by that name</li>}</ul>
    <div className="fin-pick-x">
      {allowRule && <Button className="btn small" onClick={() => onPick("")}>Back to suggested</Button>}
      <Button className="btn small" onClick={() => onPick("none")}>No code</Button></div>
  </div>;
}

function CodeBtn({ r, kind, open, onOpen }) {
  const C = r.code ? FinSt.CODES[r.code] : null;
  return <button type="button" className={"fin-code" + (C ? "" : " none")} data-fin-codebtn={r.ledger} aria-label={"Code: " + r.ledger} aria-expanded={open}
    onClick={(ev) => onOpen(ev.currentTarget.getBoundingClientRect())}>{C ? <><b>{r.code}</b><span>{C.label}</span></> : <span>No code</span>}</button>;
}

export function Tb({ d, kind, fy }) {
  const s = st(), T = d.tb, rows = T.rows, f = s.tbF;
  const [pick, setPick] = useState(null);            // {ledger | "*bulk", at}
  const q = String(s.q || "").toLowerCase().trim();
  const shown = rows.filter((r) => (!f || f.codes.includes(r.code)) && (!s.src || (s.src === "none" ? !r.code : r.code && r.codeSrc === s.src)) && (!q || r.ledger.toLowerCase().includes(q) || String(r.group).toLowerCase().includes(q)));
  const n = { none: rows.filter((r) => !r.code).length, suggested: rows.filter((r) => r.code && r.codeSrc === "suggested").length, hand: rows.filter((r) => r.code && r.codeSrc === "hand").length };
  const unm = rows.filter((r) => !r.code).reduce((a, r) => a + Math.abs(r.final), 0);
  const lent = rows.some((r) => !r.synthetic && isLent(r.ledger));
  const sel = Object.keys(s.sel || {}).filter((l) => s.sel[l] && rows.some((r) => r.ledger === l));
  const tick = (l, on) => { const x = Object.assign({}, s.sel); if (on) x[l] = 1; else delete x[l]; setFin({ sel: x }); };
  const allOn = shown.length > 0 && shown.filter((r) => !r.synthetic).every((r) => s.sel[r.ledger]);
  const setCode = (ls, code) => {
    ls.forEach((l) => FinSt.mapSet(l, code));
    toast(ls.length === 1 ? ls[0] + (code === "" ? ": back to the suggested code." : code === "none" ? ": left without a code." : ": " + code + " " + FinSt.CODES[code].label + ", by hand.")
      : ls.length + " ledgers: " + (code === "" ? "back to the suggested code." : code === "none" ? "left without a code." : code + " " + FinSt.CODES[code].label + ", by hand."));
    setPick(null); if (ls.length > 1) s.sel = {}; render();
  };
  const tot = (k) => shown.reduce((a, r) => a + (+r[k] || 0), 0);
  const SRC = [["", "All codes"], ["none", "Unmapped (" + n.none + ")"], ["suggested", "Suggested (" + n.suggested + ")"], ["hand", "By hand (" + n.hand + ")"]];
  return <section className="fin-sheet" data-fin-tb="">
    <header><h3>{"Trial balance and mapping, " + (T.period && !T.period.full ? T.period.range : FC.fyLabel(fy))}</h3><p data-fin-pysrc={T.pySrc}>{"In rupees, a debit positive" + (T.period && !T.period.full ? ": balance sheet ledgers as on " + T.period.asAt + ", income and expenses for the period" : "") + ". " + ({
      copy: T.period && !T.period.full && T.period.cmp !== "fy" ? "PY: the same period last year, from FinCom’s copy." : "PY from last year in FinCom’s copy.", typed: "PY as typed.", upload: "PY from last year’s balance sheet, as uploaded.",
      none: "No PY: the same period of last year is not in FinCom’s copy." }[T.pySrc] || "PY from the opening balances.")}</p></header>
    {T.carried && <p className="note" data-fin-carried="">{T.carried.note + ": " + T.carried.list.map((a) => "Dr " + a.dr + " / Cr " + a.cr + " " + rs(a.amt)).join("; ") + ". Pass them in Tally, then tick it on last year’s Checks tab."}</p>}
    {unm >= 0.005 && <p className="fin-unmapped" data-fin-unmapped="">{"Unmapped balance " + inr(unm)}{s.src !== "none" && <button type="button" className="linkbtn" onClick={() => setFin({ src: "none", tbF: null })}>Show them</button>}</p>}
    <div className="fin-tools">
      <input type="search" id="finq" aria-label="Find a ledger" data-fk="finq" placeholder="Find a ledger or group" value={s.q || ""} onChange={(ev) => { st().q = ev.target.value; setAndShow("fin", st(), true); }} />
      {f && <span className="fin-chipf" data-fin-tbfilter="">{f.label}<button type="button" aria-label="Show every ledger" onClick={() => setFin({ tbF: null })}>×</button></span>}
      <span className="note">{shown.length === rows.length ? rows.length + " ledgers" : shown.length + " of " + rows.length + " ledgers"}</span>
    </div>
    <div className="fin-box"><table className="fin-t fin-tb" data-statement="" data-fin-table="tb">
      <thead><tr>
        <th style={{ width: 28 }}><input type="checkbox" aria-label="Tick every ledger shown" checked={allOn} onChange={(ev) => { const x = Object.assign({}, s.sel); shown.forEach((r) => { if (r.synthetic) return; if (ev.target.checked) x[r.ledger] = 1; else delete x[r.ledger]; }); setFin({ sel: x }); }} /></th>
        <th>Ledger</th><th>Tally group</th><th className="n">PY</th><th className="n">CY</th><th className="n">Adj</th><th className="n">Final</th>
        <th><select aria-label="Show codes" data-fin-src="" value={s.src || ""} onChange={(ev) => setFin({ src: ev.target.value })}>{SRC.map(([v, l]) => <option key={v} value={v}>{v === "" ? "Code" : l}</option>)}</select></th>
        {lent && <th>Loan given</th>}
      </tr></thead>
      <tbody>{shown.map((r) => <tr key={r.ledger} data-key={r.ledger} data-src={r.code ? r.codeSrc : "none"}>
        <td>{!r.synthetic && <input type="checkbox" aria-label={"Tick " + r.ledger} checked={!!s.sel[r.ledger]} onChange={(ev) => tick(r.ledger, ev.target.checked)} />}</td>
        <td className="led">{r.ledger}</td><td className="grp" title={r.group}>{r.group}</td>
        <td className="n">{rs(r.py)}</td><td className="n">{rs(r.cy)}</td><td className="n">{r.adj ? rs(r.adj) : ""}</td><td className="n">{rs(r.final)}</td>
        <td className="code">{r.synthetic ? <span className="note">{r.code + " " + FinSt.CODES[r.code].label}</span> : <>
          <CodeBtn r={r} kind={kind} open={pick && pick.l === r.ledger} onOpen={(at) => setPick(pick && pick.l === r.ledger ? null : { l: r.ledger, at })} />
          {r.code && <Tag kind={r.codeSrc === "hand" ? "info" : "no"} className="fin-src" data-fin-srctag={r.codeSrc} title={r.why || undefined}>{r.codeSrc === "hand" ? "By hand" : "Suggested"}</Tag>}
          {r.code && r.codeSrc === "suggested" && r.why && <span className="fin-why" data-fin-why={r.ledger}>{r.why}</span>}</>}</td>
        {lent && <td>{!r.synthetic && isLent(r.ledger) && <input type="checkbox" aria-label={"Loan given (investing): " + r.ledger} checked={MIS.flowMark(r.ledger) === "loan_given"} onChange={(ev) => loanGiven(r.ledger, ev.target.checked)} />}</td>}
      </tr>)}
        {!shown.length && <tr><td colSpan={lent ? 9 : 8} className="note">No ledger here. <button type="button" className="linkbtn" onClick={() => setFin({ tbF: null, src: "", q: "" })}>Show every ledger</button></td></tr>}
      </tbody>
      {shown.length > 0 && <tfoot><tr><td /><td>Total</td><td /><td className="n">{rs(tot("py"))}</td><td className="n">{rs(tot("cy"))}</td><td className="n">{rs(tot("adj"))}</td><td className="n">{rs(tot("final"))}</td><td colSpan={lent ? 2 : 1} /></tr></tfoot>}
    </table></div>
    {sel.length > 0 && <div className="fin-bulk" data-fin-bulk="">
      <b>{sel.length + " ticked"}</b>
      <Button className="btn small" data-fin-codebtn="*bulk" onClick={(ev) => setPick(pick && pick.l === "*bulk" ? null : { l: "*bulk", at: ev.currentTarget.getBoundingClientRect() })}>Set a code</Button>
      <Button className="btn small" onClick={() => setFin({ sel: {} })}>Clear the ticks</Button></div>}
    {pick && <CodeList kind={kind} at={pick.at} allowRule value={pick.l === "*bulk" ? "" : (rows.find((r) => r.ledger === pick.l) || {}).code}
      onClose={() => setPick(null)} onPick={(c) => setCode(pick.l === "*bulk" ? sel : [pick.l], c)} />}
    <Adjustments d={d} fy={fy} />
  </section>;
}

function Adjustments({ d, fy }) {
  // kept for the period the statements are for (FinSt.periodKey: the year, or "<fy>:<from>-<to>")
  const list = d.tb.adj || [], s = st(), led = d.tb.rows.filter((r) => !r.synthetic).map((r) => r.ledger), pk = FinSt.periodKey(fy, d.period), pl = d.period && !d.period.full ? d.period.range : FC.fyLabel(fy);
  const [f, setF] = useState({ dr: "", cr: "", amt: "", narr: "" });
  const add = () => {
    const amt = +String(f.amt).replace(/,/g, "");
    if (!f.dr.trim() || !f.cr.trim() || !(amt > 0)) { toast("Give the ledger to debit, the ledger to credit and the amount."); return; }
    if (f.dr.trim() === f.cr.trim()) { toast("The ledger to debit and the ledger to credit must differ."); return; }
    FinSt.adjAdd(pk, { dr: f.dr.trim(), cr: f.cr.trim(), amt, narr: f.narr.trim() });
    setF({ dr: "", cr: "", amt: "", narr: "" }); toast("Adjustment added to " + pl + "."); render();
  };
  return <details className="fin-adj" data-fin-adj="" open={!!s.adjOpen} onToggle={(ev) => { st().adjOpen = ev.currentTarget.open; }}>
    <summary>{"Adjustments" + (list.length ? " (" + list.length + ")" : "")}</summary>
    <p className="note">{"Audit entries for these statements only (" + pl + "); FinCom never posts them to Tally."}</p>
    {list.length > 0 && <div className="fin-box"><table className="fin-t" data-statement="" data-fin-table="adj"><thead><tr><th>Debit</th><th>Credit</th><th className="n">Amount</th><th>Narration</th><th /></tr></thead>
      <tbody>{list.map((a, i) => <tr key={i} data-fin-adjrow={i}><td>{a.dr}</td><td>{a.cr}</td><td className="n">{rs(a.amt)}</td><td>{a.narr}{a.recon ? <span className="fin-why">{"matches the audited balance sheet · " + (a.by || "") + " · undo it from the Checks tab’s history"}</span> : null}</td>
        <td><button type="button" className="linkbtn" onClick={() => { FinSt.adjDel(pk, i); toast("Adjustment removed."); render(); }}>Remove</button></td></tr>)}</tbody></table></div>}
    <datalist id="finLedgers">{led.map((l) => <option key={l} value={l} />)}</datalist>
    <div className="fin-adj-add">
      <input list="finLedgers" aria-label="Ledger to debit" placeholder="Debit ledger" value={f.dr} onChange={(ev) => setF(Object.assign({}, f, { dr: ev.target.value }))} />
      <input list="finLedgers" aria-label="Ledger to credit" placeholder="Credit ledger" value={f.cr} onChange={(ev) => setF(Object.assign({}, f, { cr: ev.target.value }))} />
      <input type="number" step="0.01" min="0" aria-label="Amount" placeholder="Amount" value={f.amt} onChange={(ev) => setF(Object.assign({}, f, { amt: ev.target.value }))} />
      <input aria-label="Narration" placeholder="Narration" value={f.narr} onChange={(ev) => setF(Object.assign({}, f, { narr: ev.target.value }))} />
      <Button className="btn small" data-fin-adjadd="" onClick={add}>Add</Button></div>
  </details>;
}
