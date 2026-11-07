// node server/tally-cloud/periodpace_test.mjs (no Deno needed): the hand-out per beat, the speed kept from the beat (a
// fast bridge's only, by book), and the older function's p_max
import assert from "node:assert/strict";
import { periodPace, fastOn, speedOf, speedBooks, olderNextMax, DAY_MAX, WIDE_MAX } from "./periodpace.js";

const fast = (speed) => ({ periodPull: { fast: { on: true, ...(speed ? { speed } : {}) }, companies: {} } });
const slow = { periodPull: { companies: {} } };
// without FastEntries: 3 by day, 30 at night (as before)
assert.deepEqual(periodPace(false, slow), { max: DAY_MAX, night: false });
assert.deepEqual(periodPace(true, slow), { max: WIDE_MAX, night: true });
assert.deepEqual(periodPace(false, {}), { max: 3, night: false });          // an older bridge: no periodPull.fast
assert.deepEqual(periodPace(false, null), { max: 3, night: false });
// with FastEntries: 30 by day too; the pace said to the database stays "day"
assert.deepEqual(periodPace(false, fast()), { max: 30, night: false });
assert.deepEqual(periodPace(true, fast()), { max: 30, night: true });
for (const on of ["true", 1, "yes", {}, null]) assert.equal(fastOn({ periodPull: { fast: { on } } }), false, String(on));
assert.equal(fastOn({ periodPull: { fast: true } }), false);

// the speed: only a fast bridge's; whole numbers in range, a name and a GUID each, at most 5
const sp = [{ company: "ZZ TEST", guid: "GUID-1", perMin: 212.7 }, { company: "B", guid: "g", perMin: 0 }, { company: "C", perMin: 5 }, { company: "", guid: "g", perMin: 5 }, { company: "E", guid: "g", perMin: 1e9 }];
assert.deepEqual(speedOf(fast(sp)), [{ company: "ZZ TEST", guid: "guid-1", perMin: 212 }]);
assert.deepEqual(speedOf({ periodPull: { fast: { on: false, speed: sp } } }), [], "switch off: none kept");
assert.deepEqual(speedOf({ periodPull: { companies: { "zz test": { entriesPerMin: 300 } } } }), [], "the old per-company field is never read");
assert.equal(speedOf(fast(Array.from({ length: 9 }, (_, i) => ({ company: "C" + i, guid: "g" + i, perMin: 10 })))).length, 5);
assert.deepEqual(speedOf(fast({})), []);

// by book: the book of that name whose recorded GUID is the bridge's; no GUID recorded, another GUID, a failed lookup: out
const books = { "ZZ TEST": "bk-zz", "OTHER": "bk-o", "NOGUID": "bk-n", "BOOM": "bk-x" };
const guids = { "bk-zz": "GUID-1", "bk-o": "guid-9", "bk-n": "" };
const got = await speedBooks([{ company: "ZZ TEST", guid: "guid-1", perMin: 200 }, { company: "OTHER", guid: "guid-1", perMin: 50 }, { company: "NOGUID", guid: "g", perMin: 50 },
  { company: "BOOM", guid: "g", perMin: 50 }, { company: "NONE", guid: "g", perMin: 50 }, { company: "ZZ TEST", guid: "guid-1", perMin: 999 }],
  async (n) => books[n] || null, async (b) => { if (b === "bk-x") throw new Error("down"); return guids[b]; });
assert.deepEqual(got, [{ book: "bk-zz", perMin: 200 }]);

// the older tally_period_next: by day at most 3 (never recorded as night), at night only what fits
assert.equal(olderNextMax(30, false), 3);
assert.equal(olderNextMax(2, false), 2);
assert.equal(olderNextMax(2, true), 2);
assert.equal(olderNextMax(27, true), 27);
assert.equal(olderNextMax(-1, true), 0);
console.log("periodpace: all passed");
