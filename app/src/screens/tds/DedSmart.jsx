// The Deductions step made to prepare a return by clicks alone (next-tds-clear; the owner, 19-Oct-2026: "deductions should
// be very smart — nobody goes to Tally, everything within this window"):
//   Cell        a click on a deduction's section, dates, amount, rate or TDS edits it in place; Enter saves (a FinCom
//               correction of a deduction from Tally, TDSEdit; or the deduction added in FinCom, TDSAdd), Tab saves and
//               goes to the next cell, Esc leaves it. Tally is not changed
//   fixesOf     each row's one-click fixes, with the exact change and its reason, from the checks FinCom already makes:
//               the rate that applies (Certs.expected: the section, the PAN, a certificate), the date of deduction
//               before the date of credit, a split where no challan holds it. "Safe" ones (the TDS already right and
//               only the rate written wrong; a deduction dated before its credit) are applied together
//   BulkBar     what to do with the ticked rows: section, date of deduction, the rate that applies, move to a challan,
//               take off, delete (those added in FinCom, with the reason)
//   readyCount  "Done: N of M ready" (on a challan, a valid PAN, no rate question)
//   KeysHelp    the keyboard: ↑ ↓ move between rows, Space ticks, Enter edits the row, ? shows the keys
import { useState } from "react";
import { SideDrawer } from "./Shell.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
const iso = (d) => { const t = TDS.ymd(d); return t.length === 8 ? t.slice(0, 4) + "-" + t.slice(4, 6) + "-" + t.slice(6, 8) : ""; };
export const FIELDS = ["date", "section", "paid", "rate", "tds"];

// a field of a deduction saved: the deduction added in FinCom changed, or a FinCom correction of the books' deduction
export function saveField(r, k, v) {
  const val = k === "paid" || k === "tds" ? r2(num(v)) : k === "rate" ? num(v) : k === "date" || k === "credit" ? TDS.ymd(v) : String(v || "");
  if (k === "section" && !TDS.sec(val)) return { ok: false, why: "Choose a section FinCom knows." };
  if ((k === "date" || k === "credit") && val.length !== 8) return { ok: false, why: "Not a date." };
  if (TDSReg.rowLocked && TDSReg.rowLocked(r.id)) return { ok: false, why: "The return is marked filed: open a correction first." };
  if (r.added) {
    const key = r.id.slice(3), x = Object.assign({}, TDSAdd.all()[key] || {});
    x[k === "credit" ? "credit" : k] = val;
    if (k === "rate") x.tds = r2(num(x.paid) * val / 100);
    if (k === "paid" && x.rate !== "" && x.rate != null) x.tds = r2(val * num(x.rate) / 100);
    const res = TDSAdd.save(Object.assign({}, x, { challan: "" }), key);
    return res;
  }
  TDSEdit.set(r, k, val);
  if (k === "rate" && r.paid) TDSEdit.set(r, "tds", r2(num(r.paid) * val / 100));
  TDSReg.log({ act: "correct deduction", form: S.tdsForm, fy: r.fy, q: r.q, note: (r.party || "") + ": " + (TDSEdit.WORDS[k] || k) + " " + v });
  TDSReg.forget(); TDSReg.done(); saveBooks();
  return { ok: true };
}

// a cell that edits in place
export function Cell({ r, k, children, form, locked, next }) {
  const on = S.tdsCell && S.tdsCell.id === r.id && S.tdsCell.k === k;
  const [v, setV] = useState(null);
  if (locked || form === "27EQ") return children;
  const start = () => { S.tdsCell = { id: r.id, k }; setV(null); render(); };
  if (!on) return <span className="dd-cell" role="button" tabIndex={-1} data-cell-edit={k} title="Click to change" onClick={start}>{children}</span>;
  const cur = v != null ? v : k === "date" ? iso(r.date) : k === "credit" ? iso(r.credit || r.date) : k === "section" ? r.section : String(r[k] == null ? "" : r[k]);
  const done = (go) => {
    const res = saveField(r, k, cur);
    if (!res.ok) { toast(res.why); return; }
    S.tdsCell = go ? { id: r.id, k: go } : null; setV(null); render();
  };
  const keys = (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); done(""); }
    else if (ev.key === "Tab") { ev.preventDefault(); const i = FIELDS.indexOf(k); done(ev.shiftKey ? FIELDS[i - 1] || "" : FIELDS[i + 1] || ""); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); S.tdsCell = null; render(); }
  };
  const common = { autoFocus: true, "data-cell-input": k, "aria-label": (TDSEdit.WORDS[k] || k) + ": " + (r.party || ""), onKeyDown: keys, onClick: (ev) => ev.stopPropagation() };
  if (k === "section") return <select {...common} value={cur} onChange={(ev) => setV(ev.target.value)} className="dd-in">
    {Object.keys(TDS.STD).filter((s) => !/^192/.test(s)).map((s) => <option key={s} value={s}>{TDS.secNew(s, r.fy).ref ? TDS.secNew(s, r.fy).ref.replace(/ Sl\. /, "-") + " · " + s : s}</option>)}
    {!TDS.STD[TDS.sec(cur)] && <option value={cur}>{cur}</option>}</select>;
  return <input {...common} className="dd-in" type={k === "date" || k === "credit" ? "date" : "text"} inputMode={k === "date" || k === "credit" ? undefined : "decimal"} value={cur} onChange={(ev) => setV(ev.target.value)} />;
}

// one row's fixes: [{k, label, why, safe, apply}]
export function fixesOf(r, issue, m) {
  const out = [];
  if (issue && issue.expected != null && Math.abs(num(issue.expected) - num(r.rate)) >= 0.0001) {
    const tdsAt = r2(num(r.paid) * issue.expected / 100), right = Math.abs(tdsAt - num(r.tds)) < 1;
    out.push({ k: "rate", label: (issue.cert ? "Apply certificate " + (issue.cert.certNo || "") + " at " : "Rate ") + issue.expected + "%" + (right ? "" : " (TDS " + money(tdsAt) + ")"), why: issue.why || "", safe: right,
      apply: () => right ? (TDSEdit.set(r, "rate", issue.expected), { ok: true }) : saveField(r, "rate", issue.expected) });
  }
  if (r.credit && TDS.ymd(r.date) < TDS.ymd(r.credit)) out.push({ k: "date", label: "Date of deduction = date of credit", why: "deducted before the amount was paid or credited", safe: true, apply: () => saveField(r, "date", r.credit) });
  const s = m && m.byRow[r.id];
  if (s && s.rule === "split") out.push({ k: "split", label: "Split " + money(r.tds) + " across challans", why: s.reason, safe: false, apply: () => { tdsSplitOpen(s.key); return { ok: true, dialog: true }; } });
  return out;
}
export function Fixes({ r, issue, m, locked }) {
  const fx = locked ? [] : fixesOf(r, issue, m);
  if (!fx.length) return null;
  return <span className="dd-fixes" data-row-fixes={r.id}>{fx.map((f) => <button key={f.k} type="button" className="dd-fix" data-fix-row={f.k} title={f.why}
    onClick={(ev) => { ev.stopPropagation(); const x = f.apply(); if (x && !x.ok) toast(x.why); else if (!x || !x.dialog) { TDSReg.forget(); TDSReg.done(); saveBooks(); toast("Fixed: " + f.label + "."); } render(); }}>{f.label}</button>)}</span>;
}
export function safeFixes(rows, issueOf, m) { return [].concat(...rows.map((r) => fixesOf(r, issueOf[r.id], m).filter((f) => f.safe))); }

// rows ready to file: on a challan, a valid PAN, no rate question
export const readyCount = (rows, issueOf) => rows.filter((r) => r.challan && Certs.validPan(r.pan) && !issueOf[r.id]).length;

// the ticked rows' actions
export function BulkBar({ rows, issueOf, form }) {
  const sel = rows.filter((r) => (S.tdsSel || {})[r.id]), [sec, setSec] = useState(""), [dt, setDt] = useState(""), [del, setDel] = useState(null);
  if (!sel.length) return null;
  const total = r2(sel.reduce((a, r) => a + r.tds, 0)), tagged = sel.filter((r) => r.challan).map((r) => r.id), added = sel.filter((r) => r.added);
  const each = (fn, what) => { let n = 0; const why = []; sel.forEach((r) => { const x = fn(r); if (x && x.ok) n++; else if (x && x.why) why.push(x.why); }); toast(n + " " + what + (why.length ? "; not done: " + why[0] : "") + "."); render(); };
  const rateN = sel.filter((r) => issueOf[r.id]).length;
  return <div className="cm-bar-sel" data-tag-bar="">
    <span><b>{sel.length} ticked</b> · TDS <b>{money(total)}</b></span>
    <button className="btn small" data-tag-move="" onClick={() => tdsMoveOpen(sel.map((r) => r.id))}>Move to challan…</button>
    {tagged.length > 0 && <button className="btn small" onClick={() => tdsTakeOff(tagged)}>Take off challan{tagged.length < sel.length ? " (" + tagged.length + ")" : ""}</button>}
    {form !== "27EQ" && <><select aria-label="Set the section of the ticked" value={sec} onChange={(ev) => setSec(ev.target.value)} data-bulk-sec=""><option value="">Section…</option>
      {Object.keys(TDS.STD).filter((s) => !/^192/.test(s)).map((s) => <option key={s} value={s}>{s}</option>)}</select>
      {sec && <button className="btn small" data-bulk-sec-go="" onClick={() => { each((r) => saveField(r, "section", sec), "deductions given section " + sec); setSec(""); }}>Set {sec}</button>}
      <input type="date" aria-label="Set the date of deduction of the ticked" value={dt} onChange={(ev) => setDt(ev.target.value)} data-bulk-date="" />
      {dt && <button className="btn small" data-bulk-date-go="" onClick={() => { each((r) => saveField(r, "date", dt), "dates of deduction set"); setDt(""); }}>Set date</button>}
      {rateN > 0 && <button className="btn small" data-bulk-rate="" onClick={() => each((r) => issueOf[r.id] ? saveField(r, "rate", issueOf[r.id].expected) : null, "rates set to the one that applies")}>Rate that applies ({rateN})</button>}</>}
    {added.length > 0 && del == null && <button className="linkbtn" data-bulk-del="" onClick={() => setDel("")}>Delete the {added.length} added in FinCom…</button>}
    {del != null && <><input type="text" aria-label="Why they are taken out" placeholder="why" value={del} onChange={(ev) => setDel(ev.target.value)} /><button className="btn small" disabled={!del.trim()} data-bulk-del-go="" onClick={() => { each((r) => r.added ? TDSAdd.remove(r.id.slice(3), del) : null, "taken out"); setDel(null); S.tdsSel = {}; }}>Delete</button></>}
    <button className="linkbtn" onClick={() => { S.tdsSel = {}; render(); }}>Clear</button>
  </div>;
}

// the keys of the Deductions table
export function onTableKey(ev, shownIds) {
  const tr = ev.target.closest && ev.target.closest("tr[data-ded-row]");
  if (ev.target.tagName === "INPUT" && ev.target.type !== "checkbox" || ev.target.tagName === "SELECT") return;
  if (ev.key === "?") { S.tdsKeys = true; render(); ev.preventDefault(); ev.stopPropagation(); return; }
  if (!tr) return;
  const id = tr.dataset.dedRow, i = shownIds.indexOf(id);
  const focus = (j) => { const t = document.querySelector('#tdsDnTable tr[data-ded-row="' + CSS.escape(shownIds[j]) + '"]'); if (t) t.focus(); };
  if (ev.key === "ArrowDown") { ev.preventDefault(); focus(Math.min(shownIds.length - 1, i + 1)); }
  else if (ev.key === "ArrowUp") { ev.preventDefault(); focus(Math.max(0, i - 1)); }
  else if (ev.key === " ") { ev.preventDefault(); const s = { ...(S.tdsSel || {}) }; if (s[id]) delete s[id]; else s[id] = true; S.tdsSel = s; render(); setTimeout(() => focus(i), 0); }
  else if (ev.key === "Enter" && ev.target === tr) { ev.preventDefault(); S.tdsCell = { id, k: "paid" }; render(); }
}
export function KeysHelp() {
  const close = () => { S.tdsKeys = false; render(); };
  return <SideDrawer open={!!S.tdsKeys} onClose={close} kind="keys" title="Keys on the Deductions table" description="Click a row first">
    <dl className="ch-dl" data-keys-help=""><dt>↑ ↓</dt><dd>the row above or below</dd><dt>Space</dt><dd>tick or untick the row</dd><dt>Enter</dt><dd>edit the row (its amount; Tab to the next cell, Enter saves)</dd>
      <dt>Click a cell</dt><dd>edit the section, dates, amount, rate or TDS in place</dd><dt>?</dt><dd>these keys</dd></dl></SideDrawer>;
}
