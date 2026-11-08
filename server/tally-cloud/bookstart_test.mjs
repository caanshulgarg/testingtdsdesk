// node server/tally-cloud/bookstart_test.mjs (no Deno needed): the book's start when it has none
import assert from "node:assert/strict";
import { startDecision, bookStartPatch, bookStartEarlier, earliestDay, pullStart, movedWords, istDay, uuidOfHex, dayOf, realDay } from "./bookstart.js";

// a book with no start: the earliest known day, openings as on the day before
assert.deepEqual(bookStartPatch(null, null, "20250401"), { from_date: "2025-04-01", open_as_on: "2025-03-31" });
assert.deepEqual(bookStartPatch("", undefined, "20240301"), { from_date: "2024-03-01", open_as_on: "2024-02-29" });   // leap year
assert.deepEqual(bookStartPatch(null, null, "2026-01-01"), { from_date: "2026-01-01", open_as_on: "2025-12-31" });    // ISO, year boundary
// an openings date already there is kept
assert.deepEqual(bookStartPatch(null, "2025-03-31", "20250401"), { from_date: "2025-04-01" });
// a start already there is never moved
assert.equal(bookStartPatch("2024-04-01", null, "20250401"), null);
assert.equal(bookStartPatch("2025-04-01", "2025-03-31", "20230401", "20230401"), null);
// nothing known, or not a real day: nothing
for (const f of [undefined, null, "", "2025040", "202504011", "20250230", "20251301", "18990101", 20250401, "abcdefgh"])
  assert.equal(bookStartPatch(null, null, f), null, String(f));

// the review's case: the keep copy starts 1-Apr-2026 (state.from), older entries of 2025-26 held: the start is the
// earliest entry, never the state's later day
const known = earliestDay(["20260401", "2025-04-03", "2025-04-02", null, "", "bad"]);
assert.equal(known, "20250402");
assert.deepEqual(bookStartPatch(null, null, known), { from_date: "2025-04-02", open_as_on: "2025-04-01" });
// the day just sent counts (period_entries), as do the days held (tally_days) and the chosen older period
assert.equal(earliestDay(["20260401", "2026-05-10", "20250715"]), "20250715");
assert.equal(earliestDay(["20260401", pullStart({ fy_start: "2025-04-01", part: "year", state: "going" })]), "20250401");
assert.equal(earliestDay([]), "");
assert.equal(earliestDay(null), "");
// the chosen period's first day: the year and its first half from 1 April, the second half from 1 October; a stopped
// pull or none: no day
assert.equal(pullStart({ fy_start: "2025-04-01", part: "year", state: "going" }), "20250401");
assert.equal(pullStart({ fy_start: "2025-04-01", part: "h1", state: "paused" }), "20250401");
assert.equal(pullStart({ fy_start: "2025-04-01", part: "h2", state: "going" }), "20251001");
assert.equal(pullStart({ fy_start: "2025-04-01", part: "year", state: "stopped" }), "");
assert.equal(pullStart(null), "");
assert.equal(pullStart({ fy_start: "bad" }), "");

// a ledger-list round dated with openingsAt
// nothing earlier known: its day is the start (openings and entries agree)
assert.deepEqual(bookStartPatch(null, null, "", "20250401"), { from_date: "2025-04-01", open_as_on: "2025-03-31" });
assert.deepEqual(bookStartPatch(null, null, "20250610", "20250401"), { from_date: "2025-04-01", open_as_on: "2025-03-31" });
assert.deepEqual(bookStartPatch(null, null, "20250401", "20250401"), { from_date: "2025-04-01", open_as_on: "2025-03-31" });
// an entry or a reported start earlier than the openings' day: nothing from the round
assert.equal(bookStartPatch(null, null, "20240402", "20250401"), null);
// an undated round (a bridge before 2.5.0): the earliest known day, as the other calls
assert.deepEqual(bookStartPatch(null, null, "20240402", ""), { from_date: "2024-04-02", open_as_on: "2024-04-01" });
assert.deepEqual(bookStartPatch(null, null, "20240402", "bad"), { from_date: "2024-04-02", open_as_on: "2024-04-01" });
// a start already there: never moved by a round either
assert.equal(bookStartPatch("2026-04-01", null, "", "20250401"), null);

assert.equal(dayOf("2025-04-01T00:00:00+00:00"), "20250401");
assert.equal(dayOf("20250229"), "");
assert.equal(realDay("20240229"), true);

// a book WITH a start: moved EARLIER only, openings then as on the day before; never later
// "Bring another year" after the start was set: the keep copy began 1-Apr-2026, 2025-26 chosen and counted by Tally
const chosen = pullStart({ fy_start: "2025-04-01", part: "year", state: "going" }, true);
assert.deepEqual(bookStartEarlier("2026-04-01", earliestDay(["20260401", "2026-04-01", chosen])), { from_date: "2025-04-01", open_as_on: "2025-03-31", was: "2026-04-01" });
// the same year chosen but not yet counted by Tally (or a year Tally does not have): no move
assert.equal(pullStart({ fy_start: "2025-04-01", part: "year", state: "going" }, false), "");
assert.equal(bookStartEarlier("2026-04-01", earliestDay(["20260401", pullStart({ fy_start: "2025-04-01", part: "year" }, false)])), null);
// entries earlier than the start arrive (period_entries' day, the first day held)
assert.deepEqual(bookStartEarlier("2026-04-01", earliestDay(["20260401", "2025-11-30", "20260105"])), { from_date: "2025-11-30", open_as_on: "2025-11-29", was: "2026-04-01" });
assert.deepEqual(bookStartEarlier("20250401", "20240229"), { from_date: "2024-02-29", open_as_on: "2024-02-28", was: "2025-04-01" });
// never later, never the same, nothing known: no move
assert.equal(bookStartEarlier("2025-04-01", "20260401"), null);
assert.equal(bookStartEarlier("2025-04-01", "2025-04-01"), null);
assert.equal(bookStartEarlier("2025-04-01", ""), null);
assert.equal(bookStartEarlier("2025-04-01T00:00:00", "20250402"), null);
// no start: not a move (bookStartPatch's case)
assert.equal(bookStartEarlier(null, "20250401"), null);
assert.equal(bookStartEarlier("", "20250401"), null);
// the bell's words say the openings are still as at the old start
const w = movedWords("ZZ TEST", bookStartEarlier("2026-04-01", "20250401"));
assert.match(w, /^ZZ TEST: the books in FinCom now begin on 1-Apr-2025 \(older entries brought in; they began on 1-Apr-2026\)\./);
assert.match(w, /opening balances held are still as at 1-Apr-2026, not 1-Apr-2025/);
assert.match(movedWords("", bookStartEarlier("2026-04-01", "20251130")), /^the books in FinCom now begin on 30-Nov-2025/);
// India's day (5:30 ahead of UTC) and the one-a-day key
assert.equal(istDay(Date.UTC(2026, 10, 7, 18, 29)), "2026-11-07");
assert.equal(istDay(Date.UTC(2026, 10, 7, 18, 31)), "2026-11-08");
assert.equal(uuidOfHex("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"), "01234567-89ab-cdef-0123-456789abcdef");

// the whole decision (what index.ts acts on)
const y25 = { fy_start: "2025-04-01", part: "year", state: "going" };
// no start, entries held from 2-Apr-2025, the keep copy from 1-Apr-2026: set to the first entry
assert.deepEqual(startDecision({ fromDate: "", stateFrom: "20260401", firstVoucher: "2025-04-02", firstDay: "2025-04-03" }),
  { kind: "set", patch: { from_date: "2025-04-02", open_as_on: "2025-04-01" } });
// a start set, then "Bring another year" (2025-26) counted by Tally: moved to 1-Apr-2025
assert.deepEqual(startDecision({ fromDate: "2026-04-01", openAsOn: "2026-03-31", stateFrom: "20260401", firstVoucher: "2026-04-01", pull: y25, pullCounted: true }),
  { kind: "move", move: { from_date: "2025-04-01", open_as_on: "2025-03-31", was: "2026-04-01" } });
// chosen but not counted yet: no move
assert.equal(startDecision({ fromDate: "2026-04-01", stateFrom: "20260401", pull: y25, pullCounted: false }).kind, "none");
// entries earlier than the start arrive: moved to the earliest
assert.deepEqual(startDecision({ fromDate: "2026-04-01", stateFrom: "20260401", firstVoucher: "2025-12-01", firstDay: "2025-12-01", day: "20251115" }).move,
  { from_date: "2025-11-15", open_as_on: "2025-11-14", was: "2026-04-01" });
// a later day (the keep copy moving on, a new year) never moves it later
assert.equal(startDecision({ fromDate: "2025-04-01", stateFrom: "20260401", firstVoucher: "2025-04-01", day: "20260402" }).kind, "none");
// a dated ledger round on a book with a start: decided by the known days only (migration 130's check handles its openings)
assert.equal(startDecision({ fromDate: "2025-04-01", firstVoucher: "2025-04-01", openingsAt: "20240401" }).kind, "none");
// a stopped pull never counts
assert.equal(startDecision({ fromDate: "2026-04-01", pull: { ...y25, state: "stopped" }, pullCounted: true }).kind, "none");
// nothing known, no start: none (looked at again later)
assert.deepEqual(startDecision({ fromDate: null }), { kind: "none", known: "" });
console.log("bookstart_test: ok");
