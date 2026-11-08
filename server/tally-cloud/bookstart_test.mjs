// node server/tally-cloud/bookstart_test.mjs (no Deno needed): the book's start from the bridge's reported start
import assert from "node:assert/strict";
import { bookStartPatch, realDay } from "./bookstart.js";

// a book with no start: set from the state's from, openings as on the day before
assert.deepEqual(bookStartPatch(null, null, "20250401"), { from_date: "2025-04-01", open_as_on: "2025-03-31" });
assert.deepEqual(bookStartPatch("", undefined, "20240301"), { from_date: "2024-03-01", open_as_on: "2024-02-29" });   // leap year
assert.deepEqual(bookStartPatch(null, null, "20260101"), { from_date: "2026-01-01", open_as_on: "2025-12-31" });       // year boundary
// an openings date already there is kept
assert.deepEqual(bookStartPatch(null, "2025-03-31", "20250401"), { from_date: "2025-04-01" });
// a start already there is never moved
assert.equal(bookStartPatch("2024-04-01", null, "20250401"), null);
assert.equal(bookStartPatch("2025-04-01", "2025-03-31", "20230401"), null);
// no start reported, or not a real day: nothing
for (const f of [undefined, null, "", "2025040", "202504011", "20250230", "20251301", "18990101", "2025-04-01", 20250401, "abcdefgh"])
  assert.equal(bookStartPatch(null, null, f), null, String(f));
assert.equal(realDay("20250229"), false);
assert.equal(realDay("20240229"), true);
console.log("bookstart_test: ok");
