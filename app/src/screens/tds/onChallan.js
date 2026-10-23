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
//      26Q; one naming no section is of the forms its Tally payment paid (next-24q-split), else could be any) and minor head 200, deposited from the quarter's first day to its last
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
// next-24q-split: one naming no section, made from a Tally payment, of the forms that payment paid (TDSMatch.kindOk)
export const kindOk = (c, form) => { if (typeof TDSMatch === "object" && TDSMatch.kindOk) return TDSMatch.kindOk(c, form); if (String(c.minorHead || "200") !== "200") return false; const h = TDSReg.homeForm(c); return !h || h === form; };
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

// next-tds-register (20-Oct-2026, the owner): how a deduction came onto its challan, from the allocation trail
// (S.books.allocLog, TDSReg.log): {k: "rule" | "ai" | "hand", w: the short words, why: the hover}. A rule by its short
// name, the AI with its reason, by hand with who and when. null when it is on no challan.
const RULE_SHORT = { "From Tally": "Tally link", "Same section, same month, exact amount": "Same amount", "Same section, whole quarter, exact amount": "Quarter amount",
  "Same section, same month": "Month total", "Several sections in one challan": "No-section", "Advance challan (same year) or next year's challan": "Advance challan",
  "Earlier challan with balance left (same tax year)": "Earlier challan", "Split across challans": "Split", "Salary: the month's TDS on the next month's 192 challan": "Month's salary",
  "One party's month total": "Party's month", "The only set that adds up": "Only set" };
// next-tds-autoplace: a placing's rule code (R1-R9) where the trail has it: "rule: <words> · <reason> · R2 · run <id>" (a
// "Place automatically"), "suggestion confirmed: R6 <words>" (a suggestion a person confirmed); the short words with it
const codeOf = (note) => { const m = String(note || "").match(/ · (R\d) · run /) || String(note || "").match(/^suggestion confirmed: (R\d) /); return m ? m[1] : ""; };
const withCode = (code, w) => (code ? code + " · " + w : w);
const PLACING = ["tag", "suggestion", "auto", "tally", "balance", "split"];
export function howPlaced(r) {
  if (!r || !r.challan) return null;
  const b = S.books || {}, from = (b.allocFrom || {})[r.id];
  const log = (b.allocLog || []).slice().reverse().find((l) => l.row === r.id && PLACING.includes(l.act));
  if (from === "tally" || (log && log.act === "tally")) return { k: "rule", w: "Tally link", why: "From Tally: its TDS payment is linked to this deduction" };
  if (!log) {
    // a run's placing whose trail line is no longer kept (the trail keeps its last 5,000): the run's record says it
    const a = typeof TDSAuto === "object" ? TDSAuto.howOf(r.id) : null;
    if (a && a.ch === r.challan) return { k: "rule", w: withCode(a.code, "Rule"), why: a.code + " · placed by FinCom's Place automatically, " + fmtDate(String(a.at || "").slice(0, 10)) };
    return { k: "hand", w: "By hand", why: "Placed before this record was kept" };
  }
  const when = (log.by || "you") + ", " + fmtDate(String(log.at || "").slice(0, 10));
  if (log.act === "suggestion") {
    const code = codeOf(log.note), n = String(log.note || "").replace(/^suggestion confirmed: /, "").replace(/^R\d /, "");
    const ai = n.match(/^AI(?: \(([\s\S]*?)\))?(?:;|$)/);
    if (ai) return { k: "ai", w: "R9 · AI", why: (ai[1] || "Suggested by the AI") + " · confirmed by " + when };
    const words = n.split(";")[0].trim();
    return { k: "rule", w: withCode(code, RULE_SHORT[words] || "Rule"), why: (code ? code + " " : "") + (words || "A rule") + " · confirmed by " + when };
  }
  // next-24q-auto: placed by a rule on opening a 24Q return (note "rule: <words> · <reason>"), or carried from a payroll
  // month's total (Payroll.carry): FinCom's, never "By hand"
  if (log.act === "auto" && /^rule: /.test(log.note || "")) {
    const code = codeOf(log.note), p = String(log.note).slice(6).replace(/ · R\d · run \S+[\s\S]*$/, "").split(" · "), words = p[0].trim();
    return { k: "rule", w: withCode(code, RULE_SHORT[words] || "Rule"), why: (code ? code + " " : "") + words + " · " + p.slice(1).join(" · ") + (code ? " · placed by FinCom's Place automatically, " : " · placed by FinCom on opening the return, ") + fmtDate(String(log.at || "").slice(0, 10)) };
  }
  if (/^carried from the month's total/.test(log.note || "")) return { k: "rule", w: "Month total", why: "Carried from the payroll month's total on this challan by FinCom, " + fmtDate(String(log.at || "").slice(0, 10)) };
  if (log.act === "auto" || log.act === "balance") return { k: "rule", w: "Earlier auto", why: "FinCom's earlier automatic allocation, " + when };
  return { k: "hand", w: "By hand", why: (log.act === "split" ? "Split by " : "By ") + when };
}
// a person's "Verified" of a deduction's challan, kept with the books in S.books.matchNo as "ok|<row id>" = {at, by, ch}
// (no new BOOKS_KEYS entry: legacy.js does not grow); it holds only while the deduction stays on that challan
export const verifiedOf = (r) => { const v = ((S.books || {}).matchNo || {})["ok|" + r.id]; return !!(v && r.challan && v.ch === r.challan); };
export function setVerified(rows, on) {
  const b = S.books; if (!b) return;
  const m = Object.assign({}, b.matchNo || {}), chBy = Object.fromEntries(TDS.challans().map((c) => [c.id, c]));
  rows.filter((r) => r.challan).forEach((r) => {
    if (on) m["ok|" + r.id] = { at: new Date().toISOString(), by: TDSReg.who(), ch: r.challan }; else delete m["ok|" + r.id];
    TDSReg.log({ act: on ? "verify" : "unverify", ch: chBy[r.challan], fy: r.fy, q: r.q, row: r.id, tax: r.tds, note: on ? "verified by a person" : "verified taken off" });
  });
  b.matchNo = m; TDSReg.done(); saveBooks(); render();
}
