// next-book-start (08-Nov-2026): a book filled by a bridge's period entries and ledger-list rounds had no start
// (tally_books.from_date) nor openings date (open_as_on): only an openings file ("ledgers") or a Day Book upload set
// them, and the browser (TCloud.book/load) and tally_pick then ignore the book (its entries in tally_vouchers shown
// nowhere). Pure functions here; the database calls are in index.ts (bookStartFromState).
//
// The start is the EARLIEST of what is known of the book (migration 91's rule: never a start later than an entry held,
// since the reports clamp to greatest(p_from, from_date), tally_pick picks by it, booksFromFor dates the bridge's ledger
// reads from it and the migration-130 openings check compares the openings' day with it):
//   - the bridge's reported start (its state's from: the keep copy's start, often the current year's 1 April);
//   - the book's first day held (min tally_vouchers.day, min tally_days.day; the day just sent by period_entries);
//   - the start of the older period the person chose to bring in (tally_period_pulls: its days are handed out newest
//     first, so the earliest arrive last).
// Openings as on the day before; a book with no start keeps an openings date already there.
// A start already there only ever moves EARLIER (bookStartEarlier: "Bring another year", older entries or days stored),
// never later, to the earliest known day, openings then as on the day before it. The openings held were as at the old
// start: they stay (nothing is deleted or zeroed) and are said to be so (movedWords, one bell line a day), the existing
// rules then bring the right ones: booksFromFor answers the new start, the bridge starts its ledger round again with it
// (bridge-go ledgers.go: a round begun with another books-from starts again) and the round's openings, dated the new start,
// pass migration 130's check (openingsAt = from_date); a round dated the old start is not taken ("openings as at ... not
// taken: FinCom's books of this company begin on ...") and an openings file starting later than the book is kept out
// (ingestLedgers). A chosen period counts only once Tally has counted entries in it (a year Tally does not have never
// moves the start).
// A ledger-list round dated with openingsAt (the day its openings are as at): that day is the start when nothing known
// is earlier (openings and entries then agree); when an entry or a reported start is earlier, nothing is set from the
// round (openings as at a later day would count the entries between twice): the state or the entries set the earlier
// start, booksFromFor then tells the bridge that day and its next round's openings are as at it.

// a real calendar day as yyyymmdd (19xx/20xx)
export function realDay(d) {
  if (typeof d !== "string" || !/^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(d)) return false;
  return new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))).toISOString().slice(0, 10).replace(/-/g, "") === d;
}
// yyyymmdd from yyyymmdd or an ISO day / timestamp ("2025-04-01", "2025-04-01T00:00:00"); "" when not a real day
export function dayOf(v) {
  const s = typeof v === "string" ? v.trim() : "";
  const d = /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).replace(/-/g, "") : s;
  return realDay(d) ? d : "";
}
// the first day of a chosen older period (tally_period_pulls: fy_start 1 April, part year | h1 | h2); "" when none,
// stopped, or (counted false) Tally has counted no entry in it yet
export function pullStart(pull, counted = true) {
  if (!pull || typeof pull !== "object" || pull.state === "stopped" || !counted) return "";
  const f = dayOf(pull.fy_start);
  if (!f) return "";
  return pull.part === "h2" ? f.slice(0, 4) + "1001" : f;
}
// the earliest real day of those given (yyyymmdd or ISO); "" when none
export function earliestDay(days) {
  let out = "";
  for (const v of Array.isArray(days) ? days : []) { const d = dayOf(v); if (d && (!out || d < out)) out = d; }
  return out;
}
// the update for a book whose start is {fromDate, openAsOn} (as read: null/"" when none), given the earliest day known
// (earliestDay) and, for a dated ledger-list round, its openingsAt: {from_date, open_as_on?}, or null: nothing to set
export function bookStartPatch(fromDate, openAsOn, known, openingsAt) {
  if (fromDate) return null;
  let s = dayOf(known);
  const at = dayOf(openingsAt);
  if (at) { if (s && s < at) return null; s = at; }
  if (!s) return null;
  const f = s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
  const before = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) - 1)).toISOString().slice(0, 10);
  return openAsOn ? { from_date: f } : { from_date: f, open_as_on: before };
}

// a book WITH a start: the move EARLIER to the earliest known day, {from_date, open_as_on, was}; null when the known day
// is not earlier (never later)
export function bookStartEarlier(fromDate, known) {
  const was = dayOf(fromDate), s = dayOf(known);
  if (!was || !s || s >= was) return null;
  const before = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) - 1)).toISOString().slice(0, 10);
  return { from_date: s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8), open_as_on: before, was: was.slice(0, 4) + "-" + was.slice(4, 6) + "-" + was.slice(6, 8) };
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (d) => +d.slice(8, 10) + "-" + MON[+d.slice(5, 7) - 1] + "-" + d.slice(0, 4);
// the bell's words for a start moved earlier (ISO days)
export function movedWords(company, move) {
  const c = typeof company === "string" && company.trim() ? company.trim().slice(0, 120) + ": " : "";
  return c + "the books in FinCom now begin on " + dmy(move.from_date) + " (older entries brought in; they began on " + dmy(move.was) + "). " +
    "The opening balances held are still as at " + dmy(move.was) + ", not " + dmy(move.from_date) + ": balances and reports are not right until FinCom Bridge reads the opening balances again as at " + dmy(move.from_date) + " (its next ledger read).";
}
// India's date (the bell's day) of a moment
export const istDay = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
// a UUID from a SHA-256 hex (the bell's one-a-day key stands in for the device, as migration 130's notices do)
export const uuidOfHex = (h) => h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32);
// the whole decision for one book, from what index.ts read: {kind: "move", move} | {kind: "set", patch} |
// {kind: "none", known}. b = {fromDate, openAsOn, stateFrom, firstVoucher, firstDay, pull, pullCounted, day, openingsAt}
export function startDecision(b) {
  const known = earliestDay([b.stateFrom, b.firstVoucher, b.firstDay, pullStart(b.pull, b.pullCounted === true), b.day]);
  if (dayOf(b.fromDate || "")) { const move = bookStartEarlier(b.fromDate, known); return move ? { kind: "move", move } : { kind: "none", known }; }
  const patch = bookStartPatch(null, b.openAsOn, known, b.openingsAt);
  return patch ? { kind: "set", patch } : { kind: "none", known };
}
