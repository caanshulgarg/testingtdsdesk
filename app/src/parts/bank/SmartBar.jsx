// The bank page's filter bar (24-Oct-2026): the search over Particulars, quick chips read from the narration (UPI,
// IMPS, NEFT, ...) with their counts, In / Out, unassigned only, suggestions only, more (dates, amounts, ledger set or
// not); what is shown counted and added up; tick all of it; make a rule from it. The logic is ./smart.js.
import { useEffect } from "react";
import LedgerBox from "../LedgerBox.jsx";
import { CHIPS, chipCounts, chipsOn, toggleChip, setF, setRange, setSugOnly, clearAll, smartOn, selectAll, ruleStart, rulePreviewNow, ruleSave, KEYS_HELP, headChips, headClear } from "./smart.js";

const DIRS = [["", "All"], ["out", "Out"], ["in", "In"]];

function RuleForm({ form }) {
  const b = B();
  const p = rulePreviewNow(form);
  const set = (k) => (ev) => { b.ruleForm = Object.assign({}, form, { [k]: ev.target.value }); FinComReact.redraw(); };
  return <div className="bs-rule" data-rule-form="">
    <b>Rule:</b> lines containing
    <input type="text" className="bs-in" data-rule-text="" aria-label="Words in the narration" value={form.text} onChange={set("text")} />
    <select className="bs-in" aria-label="Withdrawals or deposits" value={form.dir} onChange={set("dir")}>
      <option value="any">in or out</option><option value="out">withdrawals</option><option value="in">deposits</option></select>
    go to
    <LedgerBox className="lgbox bs-in" fk="rulefilter" placeholder="Tally ledger" aria-label="Ledger for the rule" value={form.ledger} />
    <button className="btn small primary" data-rule-save="" onClick={() => { const el = document.querySelector('[data-fk="rulefilter"]'); ruleSave(form, el ? el.value.trim() : ""); }}>Save rule</button>
    <button className="linkbtn" onClick={() => { b.ruleForm = null; render(); }}>Cancel</button>
    <span className="bs-note" data-rule-preview="">{p.hit} line{p.hit === 1 ? "" : "s"} of this statement match: {p.now} line{p.now === 1 ? "" : "s"} now take it{p.hand ? "; " + p.hand + " set by hand stay as they are" : "; lines set by hand would stay as they are"}. Future statements follow it.</span>
  </div>;
}

// rows: what the table lists now (all of it, not only the lines drawn); base: the same before the chips (their counts)
export default function SmartBar({ rows, base, grouped }) {
  const b = B(), f = b.f || {}, on = chipsOn(b), n = chipCounts(b, base);
  const out = r2(rows.reduce((a, r) => a + num(r.debit), 0)), inn = r2(rows.reduce((a, r) => a + num(r.credit), 0));
  const pickable = rows.filter((r) => r.state !== "sent"), allPicked = pickable.length > 0 && pickable.every((r) => b.sel.has(r.id));
  const commit = (fn) => ({ onKeyDown: (ev) => { if (ev.key === "Enter") fn(ev.target.value); }, onBlur: (ev) => fn(ev.target.value) });
  const filtered = smartOn(b);
  // More filters closes on a click outside it or Esc, as the page's other menus (round 3 C, 14-Oct-2026)
  useEffect(() => {
    const shut = (ev) => { const d = document.querySelector("#app details[data-f-more][open]"); if (d && (ev.type === "keydown" ? ev.key === "Escape" : !d.contains(ev.target))) d.open = false; };
    document.addEventListener("mousedown", shut, true); document.addEventListener("keydown", shut, true);
    return () => { document.removeEventListener("mousedown", shut, true); document.removeEventListener("keydown", shut, true); };
  }, []);
  return <div className="bs-bar" data-bank-filters="">
    <div className="bs-line">
      <input type="search" className="bk-search bs-search" autoComplete="off" placeholder="Search Particulars, amount, ledger" aria-label="Search the statement" value={b.q} onChange={(ev) => bankSearch(ev.target.value)} />
      <span className="bs-seg" role="group" aria-label="Withdrawals or deposits">{DIRS.map(([k, w]) => <button key={k} type="button" data-dir={k} aria-pressed={(f.dir || "") === k} onClick={() => setF("dir", k)}>{w}</button>)}</span>
      <label className="bs-tog"><input type="checkbox" data-f-unassigned="" checked={f.led === "none"} onChange={(ev) => setF("led", ev.target.checked ? "none" : "")} /> Unassigned only</label>
      <label className="bs-tog"><input type="checkbox" data-f-sugg="" checked={!!b.sugOnly} onChange={(ev) => setSugOnly(ev.target.checked)} /> Suggestions to accept</label>
      <details className="bs-more" data-f-more=""><summary className="btn small">More filters{(b.from || b.to || f.min || f.max || f.led === "set") ? " •" : ""}</summary>
        <div className="bs-pop">
          <label>Date from <input type="date" data-f-from="" defaultValue={b.from || ""} key={"fr" + (b.from || "")} {...commit((v) => v !== (b.from || "") && setRange("from", v))} /></label>
          <label>to <input type="date" data-f-to="" defaultValue={b.to || ""} key={"to" + (b.to || "")} {...commit((v) => v !== (b.to || "") && setRange("to", v))} /></label>
          <label>Amount from <input type="number" min="0" data-f-min="" defaultValue={f.min || ""} key={"mn" + (f.min || "")} {...commit((v) => v !== String(f.min || "") && setF("min", v))} /></label>
          <label>to <input type="number" min="0" data-f-max="" defaultValue={f.max || ""} key={"mx" + (f.max || "")} {...commit((v) => v !== String(f.max || "") && setF("max", v))} /></label>
          <label>Ledger <select data-f-led="" value={f.led || ""} onChange={(ev) => setF("led", ev.target.value)}><option value="">any</option><option value="none">not chosen yet</option><option value="set">chosen</option></select></label>
        </div></details>
      {tabOk() && <label className="bs-tog"><input type="checkbox" checked={!!grouped} onChange={(ev) => bankSetGrouped(ev.target.checked)} /> Group by party</label>}
      <span className="bs-gap" />
      {pickable.length > 0 && <button className="linkbtn" data-f-selall="" onClick={() => selectAll(pickable, !allPicked)}>{allPicked ? "Untick all" : "Select all " + pickable.length}</button>}
      {filtered && <button className="linkbtn" data-f-clear="" onClick={clearAll}>Clear filters</button>}
      {filtered && !b.ruleForm && <button className="linkbtn" data-f-rule="" title="Make a rule from this filter: lines containing these words go to one ledger, now and in future statements" onClick={ruleStart}>Rule from filter</button>}
    </div>
    <div className="bs-chips" role="group" aria-label="Quick filters on Particulars">
      {CHIPS.filter((c) => n[c[0]] > 0 || on.includes(c[0])).map((c) => <button key={c[0]} type="button" className="bs-chip" data-chip={c[0]} aria-pressed={on.includes(c[0])} onClick={() => toggleChip(c[0])}>
        <span title={c[0] === "ATM" ? "ATM and cash" : c[0] === "Card" ? "POS and card" : c[0] === "NACH" ? "NACH, ACH, ECS: EMIs and mandates" : undefined}>{c[1]}</span> <span className="bs-chip-n" data-chip-n="">{n[c[0]]}</span></button>)}
      {/* what the column headers' filters hold (25-Oct-2026: the filters are in the headers again), each removable */}
      {headChips(b).map((c, i) => <span key={c.k + i} className="bs-chip bs-fchip" data-fchip={c.k} aria-pressed="true">{c.w}
        <button type="button" className="bs-fx" aria-label={"Remove the filter " + c.w} onClick={() => headClear(c.k, c.old)}>✕</button></span>)}
      <span className="bs-keys" data-kb-help="" title={KEYS_HELP} tabIndex={0} aria-label={KEYS_HELP}>⌨</span>
      <span className="bs-count" data-f-count=""><b>{rows.length}</b> of {b.rows.length} · out {money(out)} · in {money(inn)}</span>
    </div>
    {b.ruleForm && <RuleForm form={b.ruleForm} />}
  </div>;
}
// "Group by party" lives on To review only, as before
function tabOk() { return bankTab() === "review"; }
