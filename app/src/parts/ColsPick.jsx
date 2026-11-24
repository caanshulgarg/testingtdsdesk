// The choice of a sheet's columns, one list of its headings for each field FinCom reads (the "Change" of "Columns read
// as …": parts/bank/ColsRead.jsx for a bank statement, screens/tds/SalaryCols.jsx for the 24Q salary sheet). A heading is
// in one field at most; Save waits until the fields FinCom needs are chosen (need: the words of what is missing, or "").
import { useState } from "react";
import { BANK_FIELDS } from "../lib/aiColumns.js";
import "./ColsPick.css";

export const bankNeed = (m) => !m.date ? "the Date" : !m.narr ? "the Narration" : !((m.debit && m.credit) || m.amount) ? "Withdrawal and Deposit (or one Amount)" : "";
export const salaryNeed = (m) => !m.name ? "the Employee name" : !m.tds ? "the TDS" : "";

export default function ColsPick({ head, map, onSave, onCancel, saveWords, fields = BANK_FIELDS, need = bankNeed }) {
  const [m, setM] = useState(Object.assign({}, map));
  const opts = (head || []).filter(Boolean);
  const set = (f, h) => setM((x) => { const y = Object.assign({}, x); Object.keys(y).forEach((k) => { if (y[k] === h && h) delete y[k]; }); if (h) y[f] = h; else delete y[f]; return y; });
  const miss = need(m);
  return <div className="bk-colspick" data-cols-pick="">
    {fields.map(([f, w]) => <label key={f} className="bk-colsf"><span>{w}</span>
      <select value={m[f] || ""} data-cols-field={f} onChange={(ev) => set(f, ev.target.value)}><option value="">(none)</option>{opts.map((h) => <option key={h} value={h}>{h}</option>)}</select></label>)}
    <div className="bk-colsacts">{miss ? <span className="note">Choose {miss}.</span> : null}
      <button type="button" className="btn small primary" disabled={!!miss} data-cols-save="" onClick={() => onSave(m)}>{saveWords || "Save"}</button>
      {onCancel && <button type="button" className="linkbtn" onClick={onCancel}>Cancel</button>}</div>
  </div>;
}

