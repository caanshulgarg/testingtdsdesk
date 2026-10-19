// The deductee's name on every TDS table (next-tds-addlist, 19-Oct-2026; the owner: "blank name in particulars"). The
// name comes from Tally (the entry's party, or the party ledger credited in a journal with none: TDS.billParty); where
// there is none, never a blank: "Name missing — add" in red with Fix, which keeps the name as FinCom's correction of the
// deduction (TDSEdit, field party; the PAN then from the PAN book).
import { useState } from "react";
import { saveField } from "./DedSmart.jsx";

export function DedName({ r, locked, onOpen, title }) {
  const [edit, setEdit] = useState(false), [v, setV] = useState("");
  const n = r.party || r.employee;
  if (n) return onOpen ? <button type="button" className="linkbtn" data-row-detail={r.id} title={title} onClick={onOpen}>{n}</button> : <span title={title}>{n}</span>;
  const save = () => { const t = v.trim(); if (!t) return; const y = saveField(r, "party", t); if (!y.ok) { toast(y.why); return; } setEdit(false); setV(""); render(); };
  if (edit) return <span className="wd-namefix"><input type="text" autoFocus value={v} data-wd-name-input={r.id} aria-label="Deductee's name" placeholder="Deductee's name, as in the PAN"
      onChange={(ev) => setV(ev.target.value)} onClick={(ev) => ev.stopPropagation()}
      onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); save(); } else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setEdit(false); } }} />
    <button type="button" className="btn small" data-wd-name-save={r.id} disabled={!v.trim()} onClick={save}>Save</button></span>;
  return <span className="wd-noname" data-wd-noname={r.id} title={(r.voucher ? "Voucher " + r.voucher + " · " : "") + (r.ledger ? r.ledger + ": " : "") + "Tally names no party in this entry"}>Name missing — add
    {!locked && <> <button type="button" className="linkbtn" data-wd-namefix={r.id} onClick={(ev) => { ev.stopPropagation(); setEdit(true); }}>Fix</button></>}</span>;
}
