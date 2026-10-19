// One truth for every TDS table (round 89, 19-Oct-2026, "only one challan showing": the header said 7 challans, the grid
// showed 1 and Deductions said every deduction was on a challan). A deduction is ON a challan only when that challan is
// here (TDS.challans()); one pointing at a challan that is not here is NOT on a challan: it is listed under "Not on any
// challan" with "Its challan <serial> is missing — choose again". The header's count, the Challans grid, the Deductions
// selector, its footer and "+ Add deduction" all read these.
import "../../lib/tdsGlobals.js";

// the ids of the challans here
export const chIds = () => new Set(TDS.challans().map((c) => c.id));
// on a challan that is here
export const isPlaced = (r, ids) => !!r.challan && (ids || chIds()).has(r.challan);
// pointing at a challan that is not here
export const chMissing = (r, ids) => !!r.challan && !(ids || chIds()).has(r.challan);
// the deductions with tax not on a challan here (none, or one missing)
export const unplacedOf = (rows, ids) => { const s = ids || chIds(); return rows.filter((r) => r.tds > 0.005 && !isPlaced(r, s)); };
// what to call a challan that is not here: its serial when the books (a removed one) or the allocation trail know it, else its id
export function missingName(id) {
  const b = S.books || {}, c = (b.challans || []).find((x) => x.id === id);
  if (c && c.serial) return c.serial;
  const l = (b.allocLog || []).find((x) => x.ch === id && x.chKey);
  return (l && l.chKey.split("|")[2]) || id;
}
// this return's TDS on a challan ("Used here"); all returns' is TDSReg.usedTax
export const usedHere = (c, key, cx) => r2(num(((cx.uses[c.id] || {})[key] || {}).tax));
