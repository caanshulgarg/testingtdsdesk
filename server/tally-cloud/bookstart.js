// next-book-start (08-Nov-2026): a book filled by a bridge's period entries and ledger-list rounds had no start
// (tally_books.from_date) nor openings date (open_as_on): only an openings file ("ledgers") or a Day Book upload set
// them, and the browser (TCloud.book/load) and tally_pick then ignore the book (its entries in tally_vouchers shown
// nowhere). Pure functions here; the database calls are in index.ts (bookStartFromState).
//
// The start is the EARLIEST day known of the book (migration 91's rule: never a start later than an entry held, since
// the reports clamp to greatest(p_from, from_date), tally_pick picks by it, booksFromFor dates the bridge's ledger reads
// from it and the migration-130 openings check compares the openings' day with it), of:
//   - the bridge's reported start (its state's from: the keep copy's start, often the current year's 1 April);
//   - the book's first entry and first day held (min tally_vouchers.day, min tally_days.day; the day just stored);
//   - the first day Tally counted entries on for an older period the person chose (min tally_period_days.day with
//     tally_n > 0): a day Tally has, so the bridge can read openings as at it (bridge-go booksfrom.go finComDayFits: FinCom's
//     day is used only on or after Tally's own books-from; never the period's 1 April or 1 October, which a company whose
//     Tally books begin mid-year does not have).
// Never a ledger round's openingsAt (Tally's BOOKSFROM can be years before the entries).
//
// A book with no start gets the earliest known day, openings as on the day before (an openings date already there kept).
// A book with a start has it moved EARLIER only, never later ("Bring another year", older entries stored):
//   - with a ledger round dated that very day (openingsAt = the earliest known day): at once, just before the round is
//     taken, so the openings and the start change together (the round passes migration 130's check);
//   - else only once the days between are all fetched (no tally_period_days in [new, old) still to count or to bring),
//     openings then still as at the old start: one bell line on the day of the move says so, and the existing rules
//     bring the right ones (booksFromFor answers the new start, the bridge starts its ledger round again with another
//     books-from, ledgers.go, and that round's openings are dated the new start);
//   - meanwhile the day is WANTED once Tally has counted every day between (none left with tally_n null: counting goes
//     newest first, so an earlier day would still turn up and each new wanted day restarts the bridge's ledger round):
//     booksFromFor answers it in place of the start, so the bridge's next ledger round is dated it and moves the start with
//     its openings (the first case). Until then nothing is wanted.

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
const isoOf = (d) => d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8);
const before = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) - 1)).toISOString().slice(0, 10);
// the earliest real day of those given (yyyymmdd or ISO); "" when none
export function earliestDay(days) {
  let out = "";
  for (const v of Array.isArray(days) ? days : []) { const d = dayOf(v); if (d && (!out || d < out)) out = d; }
  return out;
}
// the earliest day known of a book: b = {stateFrom, firstVoucher, firstDay, firstCounted, day}
export const earliestKnown = (b) => earliestDay([b.stateFrom, b.firstVoucher, b.firstDay, b.firstCounted, b.day]);
// the update for a book with no start (fromDate null/""): {from_date, open_as_on?}, or null: nothing to set
export function bookStartPatch(fromDate, openAsOn, known) {
  const s = dayOf(known);
  if (fromDate || !s) return null;
  return openAsOn ? { from_date: isoOf(s) } : { from_date: isoOf(s), open_as_on: before(s) };
}
// a book WITH a start: the move EARLIER to the known day, {from_date, open_as_on, was}; null when not earlier (never later)
export function bookStartEarlier(fromDate, known) {
  const was = dayOf(fromDate), s = dayOf(known);
  if (!was || !s || s >= was) return null;
  return { from_date: isoOf(s), open_as_on: before(s), was: isoOf(was) };
}
// the whole decision for one book: b = {fromDate, openAsOn, stateFrom, firstVoucher, firstDay, firstCounted, day,
// openingsAt, gapPending (a tally_period_days day in [known, fromDate) still to count or bring), gapUncounted (one still
// to count: tally_n null)} ->
//   {kind: "set", patch} | {kind: "move", move, withRound} | {kind: "wait", want} | {kind: "none", known}
export function startDecision(b) {
  const known = earliestKnown(b);
  if (!dayOf(b.fromDate || "")) { const patch = bookStartPatch(null, b.openAsOn, known); return patch ? { kind: "set", patch } : { kind: "none", known }; }
  const move = bookStartEarlier(b.fromDate, known);
  if (!move) return { kind: "none", known };
  if (dayOf(b.openingsAt || "") === known) return { kind: "move", move, withRound: true };
  if (b.gapPending === false) return { kind: "move", move, withRound: false };
  return { kind: "wait", want: b.gapUncounted === false ? known : "" };
}
// whether a book's memo (index.ts startMemo {from, want, t}, the start and the wanted day as yyyymmdd) answers a call
// without reading the database: fresh (5 minutes) and the call brings nothing new (for a book with a start: no day nor
// reported start before it or the day wanted, no ledger round dated another day than the start; for one without: no day
// and no reported start; a round's openingsAt never sets a start)
export function memoAnswers(m, o, now) {
  if (!m || !(now - m.t < 300000)) return false;
  const day = dayOf(o.day || ""), sf = dayOf(o.stateFrom || ""), at = dayOf(o.openingsAt || "");
  if (!m.from) return !day && !sf;
  const sooner = (d) => !!d && d < (m.want || m.from);
  return !(sooner(day) || sooner(sf) || (at && at !== m.from));
}
// booksFromFor's day for a book (yyyymmdd): the wanted earlier day when there is one, else the start; "" when none
export function booksFromDay(fromDate, want) {
  const f = dayOf(fromDate || ""), w = dayOf(want || "");
  return f && w && w < f ? w : f;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (d) => +d.slice(8, 10) + "-" + MON[+d.slice(5, 7) - 1] + "-" + d.slice(0, 4);
// the bell's words for a start moved earlier without its openings (ISO days)
export function movedWords(company, move) {
  const c = typeof company === "string" && company.trim() ? company.trim().slice(0, 120) + ": " : "";
  return c + "the books in FinCom now begin on " + dmy(move.from_date) + " (older entries brought in; they began on " + dmy(move.was) + "). " +
    "The opening balances held are still as at " + dmy(move.was) + ", not " + dmy(move.from_date) + ": balances and reports are not right until FinCom Bridge reads the opening balances again as at " + dmy(move.from_date) + " (its next ledger read).";
}
// India's date (the bell's day) of a moment
export const istDay = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);
// a UUID from a SHA-256 hex (the bell's one-a-day key stands in for the device, as migration 130's notices do)
export const uuidOfHex = (h) => h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32);
