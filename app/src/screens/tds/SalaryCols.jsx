// "Columns read as …" on 24Q's salary sheet when its columns were read by FinCom's AI (TDS24Q.fromFile through
// app/src/lib/aiColumns.js salaryCols: the owner, 24-Nov-2026, the one-time AI column reading by default), with Change:
// the columns put right are kept for this client and layout (co.aiColumns, how "person") and the sheet read again
// with them when it is still held on this page; otherwise it is read with them the next time it is brought in.
import { useState } from "react";
import { keep, saidCols, SALARY_FIELDS } from "../../lib/aiColumns.js";
import ColsPick, { salaryNeed } from "../../parts/ColsPick.jsx";
/* global S, CO, Store, TDS24Q, saveBooks, toast, render, whoAmI */

export default function SalaryCols() {
  const [open, setOpen] = useState(false);
  const b = S.books || {}, c = b.salaryCols;
  if (!c || !c.map || !(b.salary || []).length) return null;
  const save = async (m) => {
    const co = CO(b.cid);
    keep(co, "salary", c.head, m, "person", (() => { try { return whoAmI(); } catch (e) { return ""; } })()); Store.saveCompany(co);
    setOpen(false);
    const f = S.files["salary:" + b.cid];
    if (!f) { b.salaryCols = Object.assign({}, c, { map: m, how: "person" }); await saveBooks(); toast("Kept for this layout. Bring in the salary sheet again to read it with these columns."); render(); return; }
    const r = await TDS24Q.fromFile(f);
    if (r.error) { toast(r.error); return; }
    b.salary = r.rows; b.salaryCols = r.cols || null; await saveBooks();
    toast(r.rows.length + " salary rows read again with these columns."); render();
  };
  return <div className="note tds-salcols" data-salary-cols={c.how}>{c.how === "person" ? "Columns read as you set them: " : "Columns read as: "}<b>{saidCols(c, SALARY_FIELDS)}</b>.{" "}
    {!open && <button type="button" className="linkbtn" data-salary-cols-change="" onClick={() => setOpen(true)}>Change</button>}
    {open && <ColsPick head={c.head} map={c.map} fields={SALARY_FIELDS} need={salaryNeed} onSave={save} onCancel={() => setOpen(false)} saveWords="Save and read again" />}</div>;
}
