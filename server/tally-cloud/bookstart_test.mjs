// node server/tally-cloud/bookstart_test.mjs (no Deno needed): the book's start when it has none
import assert from "node:assert/strict";
import { bookStartPatch, earliestDay, pullStart, dayOf, realDay } from "./bookstart.js";

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
console.log("bookstart_test: ok");
