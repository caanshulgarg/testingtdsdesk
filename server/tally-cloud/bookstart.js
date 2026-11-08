// next-book-start (08-Nov-2026): a book filled by a bridge's period entries and ledger-list rounds had no start
// (tally_books.from_date) nor openings date (open_as_on): only an openings file ("ledgers") or a Day Book upload set
// them, and the browser (TCloud.book/load) and tally_pick then ignore the book (its entries in tally_vouchers shown
// nowhere). The bridge's reported start (its state's from, yyyymmdd) sets them when the book has none, as
// bookStartFromUpload does: openings as on the day before. A start already there is never moved; an openings date already
// there is kept. Pure; the database call is in index.ts (bookStartFromState).

// a real calendar day as yyyymmdd (19xx/20xx)
export function realDay(d) {
  if (typeof d !== "string" || !/^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(d)) return false;
  return new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8))).toISOString().slice(0, 10).replace(/-/g, "") === d;
}

// the update for a book whose start is {fromDate, openAsOn} (as read: null/"" when none) given the bridge's reported
// start: {from_date, open_as_on?} when the start is to be set, null when there is nothing to do
export function bookStartPatch(fromDate, openAsOn, stateFrom) {
  if (fromDate || !realDay(stateFrom)) return null;
  const f = stateFrom.slice(0, 4) + "-" + stateFrom.slice(4, 6) + "-" + stateFrom.slice(6, 8);
  const before = new Date(Date.UTC(+stateFrom.slice(0, 4), +stateFrom.slice(4, 6) - 1, +stateFrom.slice(6, 8) - 1)).toISOString().slice(0, 10);
  return openAsOn ? { from_date: f } : { from_date: f, open_as_on: before };
}
