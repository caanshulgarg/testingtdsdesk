// Form 138 / 24Q's Deductions step as 26Q's (next-tds-tidy2, 20-Oct-2026; the owner: "24Q is not working properly ... I am
// not able to choose challan"; round 88 had left 24Q without the Winman challan picker): "Select challan" (the 192 / 392
// challans of the quarter, numbered as on Challans, and "Not on any challan (N)" last), the deductions on that challan
// (one row per employee per payroll month), "+ Add deduction to this challan" with the deductions not on a challan and
// those on other challans (tick boxes, Move to this challan), the footer Used here · Balance · Number, the column filters.
// The same parts as 26Q's (tds/Winman.jsx DedByChallan, the Deductions register tds/DedRegister.jsx); a salary row is not edited in place (it comes
// from Tally's payroll or the salary sheet). Annexure I, every row in one table, is under ⋯ (S.tdsDedView "table").
import "../../lib/tdsGlobals.js";
import More from "../../parts/More.jsx";
import { DedByChallan } from "./Winman.jsx";
import { dedMatch } from "./DedSide.jsx";

export default function Deductions24({ fy, q, table, notes }) {
  const form = "24Q", rows = TDS.formRows(form).filter((r) => r.fy === fy && r.q === q), locked = TDSReg.locked(fy, q, form);
  if (S.tdsDedView === "table" && table) return <>
    <div className="rt-tool" data-step-tool=""><button type="button" className="linkbtn wd-back" data-ded-back="" onClick={() => { S.tdsDedView = ""; render(); }}>← By challan</button></div>
    {notes}{table}</>;
  let probs = {};
  try { probs = TDSEdit.problems(rows, fy, q, form); } catch (e) { /* the editor's checks not loaded */ }
  const dm = dedMatch(form, fy, q);
  const tools = table ? <span className="wd-tools"><More label="⋯" ariaLabel="More" data-wd-more="" items={[["Annexure I: every row in one table", () => { S.tdsDedView = "table"; render(); }, { "data-wd-all": "" }]]} /></span> : null;
  return <>{notes}<DedByChallan form={form} fy={fy} q={q} rows={rows} m={dm} issueOf={{}} probs={probs} locked={locked} tools={tools} /></>;
}
