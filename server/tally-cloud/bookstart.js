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
// Openings as on the day before. A start already there is never moved; an openings date already there is kept.
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
// the first day of a chosen older period (tally_period_pulls: fy_start 1 April, part year | h1 | h2); "" when none or stopped
export function pullStart(pull) {
  if (!pull || typeof pull !== "object" || pull.state === "stopped") return "";
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
