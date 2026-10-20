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
// next-tds-addlist / next-tds-early: what is wrong with a deduction on a challan (TDSEdit.placeIssues: a challan of an
// earlier year, dated after today, not minor head 200, another section), whether a challan cannot pay a deduction (never
// offered, never ticked), and the note of one allowed (TDSEdit.placeNote: an advance challan, the next year's)
export const placeIssues = (r, c) => TDSEdit.placeIssues(r, c);
export const earlyFor = (r, c) => TDSEdit.early(r, c);
export const placeNote = (r, c) => TDSEdit.placeNote(r, c);
// the errors of a challan's date or type (not "sec", a warning)
export const BAD_K = ["fy", "future", "minor"];
// next-tds-tidy2 (the owner: "no long sentences in rows"): a row's problem as one short chip; the full words on a hover
const CHIP = { name: "Name missing", fy: "Earlier year's challan", future: "Future challan", minor: "Not minor head 200", adv: "Advance challan", nextfy: "Next year's challan",
  sec: "Other section", pan: "No PAN", rate: "Rate?", paycode: "Code?", other: "Check" };
export const chipW = (p) => (p ? CHIP[p.k] || (String(p.words || "").length <= 14 ? p.words : "Check") : "");

// next-tds-retchallans (20-Oct-2026; the owner: "currently every challan is showing in every return which I don't think is
// right; the user will be distracted"). The challans that belong to a return, one list for its Challans step, the challan
// pickers, the header's count and the grid's foot:
//   a. those this return already uses;
//   b. those the matcher pairs with its deductions (rules a to f and the AI's g: TDSMatch.suggest);
//   c. those brought in by hand ("Add challan › Pick from other challans of this year"), kept with the books;
//   d. those of its kind (TDSReg.homeForm: 192 for 24Q, 206C for 27EQ, a non-resident's section for 27Q, the others for
//      26Q; one naming no section could be any) and minor head 200, deposited from the quarter's first day to its last
//      month's due date (the 7th of the next month; 30 April for March), or earlier in the year with tax left (an advance
//      challan). Every other challan is not shown on the return (it is on the challan register).
// A challan brought in by hand is kept in S.books.matchNo (a person's matching decisions, one of BOOKS_KEYS, so it is
// saved and shared with the books) as "pin|<return key>|<challan id>" (never a suggestion's key, which has no "|").
const PIN = (key) => "pin|" + key + "|";
export const pinnedIds = (key) => { const p = PIN(key); return Object.keys((S.books || {}).matchNo || {}).filter((k) => k.indexOf(p) === 0).map((k) => k.slice(p.length)); };
export function pinChallans(key, ids, on) {
  const b = S.books; if (!b) return;
  const m = Object.assign({}, b.matchNo || {});
  ids.forEach((id) => { if (on) m[PIN(key) + id] = { at: new Date().toISOString(), by: TDSReg.who(), pin: true }; else delete m[PIN(key) + id]; });
  b.matchNo = m; TDSReg.forget(); saveBooks(); render();
}
// the last day a quarter's challan may be deposited for it: its last month's due date
export function dueOfMonth(ym) {
  const y = +String(ym).slice(0, 4), m = +String(ym).slice(4, 6);
  return m === 3 ? y + "0430" : m === 12 ? (y + 1) + "0107" : y + String(m + 1).padStart(2, "0") + "07";
}
export const kindOk = (c, form) => { if (String(c.minorHead || "200") !== "200") return false; const h = TDSReg.homeForm(c); return !h || h === form; };
export function retChallanList(form, fy, q, cx, sugg) {
  const k = TDSReg.key(form, fy, q), want = new Set(pinnedIds(k));
  (sugg || []).forEach((s) => { want.add(s.chId); (s.parts || []).forEach((p) => want.add(p.chId)); });
  const mon = tdsMonths(fy, q), from = mon[0] + "01", to = dueOfMonth(mon[mon.length - 1]);
  return TDS.challans().filter((c) => {
    if ((cx.uses[c.id] || {})[k] || want.has(c.id)) return true;
    if (!kindOk(c, form)) return false;
    const d = TDS.ymd(c.date);
    return (d >= from && d <= to) || (d < from && TDS.fyOf(d) === fy && TDSReg.balance(c, cx).tax > 0.005);
  });
}
// the return's challans in one order (the grid's rows, the header's count, Select challan)
export function winChallans(form, fy, q, cx) {
  let sugg = [];
  try { sugg = TDSMatch.suggest(form, fy, q); } catch (e) { /* the matcher not loaded */ }
  return retChallanList(form, fy, q, cx || TDSReg.ctx(), sugg).slice().sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)) || String(a.id).localeCompare(String(b.id)));
}
export function retChallans(form, fy, q, cx) {
  const c = cx || TDSReg.ctx(), list = winChallans(form, fy, q, c), key = TDSReg.key(form, fy, q);
  return { list, n: list.length, here: r2(list.reduce((a, x) => a + usedHere(x, key, c), 0)) };
}
// the year's other challans with tax left, not on this return's list (Add challan › Pick from other challans of this year)
export function otherChallans(form, fy, q, cx) {
  const c = cx || TDSReg.ctx(), on = new Set(winChallans(form, fy, q, c).map((x) => x.id));
  return TDS.challans().filter((x) => !on.has(x.id) && TDS.fyOf(x.date) === fy && String(x.minorHead || "200") === "200" && TDSReg.balance(x, c).tax > 0.005)
    .sort((a, b) => TDS.ymd(a.date).localeCompare(TDS.ymd(b.date)) || String(a.id).localeCompare(String(b.id)));
}
