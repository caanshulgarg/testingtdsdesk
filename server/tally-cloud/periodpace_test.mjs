// node server/tally-cloud/periodpace_test.mjs (no Deno needed): the hand-out per beat and the speed kept from the beat
import assert from "node:assert/strict";
import { periodPace, fastOn, speedOf, DAY_MAX, WIDE_MAX } from "./periodpace.js";

const fast = { periodPull: { fast: { on: true }, companies: {} } };
const slow = { periodPull: { fast: { on: false }, companies: {} } };
// without FastEntries: 3 by day, 30 at night (as before)
assert.deepEqual(periodPace(false, slow), { max: DAY_MAX, night: false });
assert.deepEqual(periodPace(true, slow), { max: WIDE_MAX, night: true });
assert.deepEqual(periodPace(false, {}), { max: 3, night: false });          // an older bridge: no periodPull.fast
assert.deepEqual(periodPace(false, null), { max: 3, night: false });
// with FastEntries: 30 by day too; the pace said to the database stays "day"
assert.deepEqual(periodPace(false, fast), { max: 30, night: false });
assert.deepEqual(periodPace(true, fast), { max: 30, night: true });
// only exactly true counts
for (const on of ["true", 1, "yes", {}, null]) assert.equal(fastOn({ periodPull: { fast: { on } } }), false, String(on));
assert.equal(fastOn({ periodPull: { fast: true } }), false);
// the speed: whole numbers in range, at most 50
const sp = speedOf({ periodPull: { companies: { "zz test": { entriesPerMin: 212.7 }, "b": { entriesPerMin: 0 }, "c": {}, "d": { entriesPerMin: "x" }, "e": { entriesPerMin: 1e9 } } } });
assert.deepEqual(sp, [{ company: "zz test", perMin: 212 }]);
const many = {}; for (let i = 0; i < 80; i++) many["co " + i] = { entriesPerMin: 10 };
assert.equal(speedOf({ periodPull: { companies: many } }).length, 50);
assert.deepEqual(speedOf({ periodPull: { companies: [] } }), []);
assert.deepEqual(speedOf({}), []);
console.log("periodpace: all passed");
