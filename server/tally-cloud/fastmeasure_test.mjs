// node server/tally-cloud/fastmeasure_test.mjs (no Deno needed): the fast-read measurement as FinCom keeps it
import assert from "node:assert/strict";
import { cleanFastMeasure, fastMeasurePass, FAST_MEASURE_COMPANY } from "./fastmeasure.js";

assert.equal(FAST_MEASURE_COMPANY, "ZZ TEST");
const good = { ok: true, state: "done", at: "2026-11-08T10:00:00Z", bridge: "2.5.8", tallyVersion: "7.1.0.0", plan: "9b", watched: true, pass: true,
  busiestDay: 120, busiest31: 175, worstMs: 900, worstHoldMs: 200, compared: 50, differ: 0, line: "PASS: worst 0.90 s",
  results: [{ kind: "locate", days: 7, rows: 30, ms: 40, holdMs: 0 }, { kind: "W1", days: 31, rows: 175, ms: 900, holdMs: 200 },
    { kind: "W2", days: 3, asked: 50, rows: 50, ms: 700, holdMs: 100, objectMs: 30, objectHoldMs: 0, compare: { same: 50, differ: 0, left: 0, fields: [] } }] };
const c = cleanFastMeasure(good);
assert.equal(c.pass, true); assert.equal(c.results.length, 3); assert.equal(fastMeasurePass(c), true);
// only the known fields: anything else dropped (an entry's data cannot ride along)
const sneaky = JSON.parse(JSON.stringify(good));
sneaky.results[2].guid = "abc"; sneaky.results[2].narration = "Paid rent"; sneaky.entries = [{ party: "X" }];
sneaky.results[2].compare.fields = ["ALLLEDGERENTRIES.LIST/AMOUNT", "Paid rent to <Mr X> 500.00 ₹", "x".repeat(200)];
sneaky.results.push({ kind: "voucher", rows: 1 });
const cs = cleanFastMeasure(sneaky), txt = JSON.stringify(cs);
assert.ok(!txt.includes("abc") && !txt.includes("Paid rent") && !txt.includes("party") && !txt.includes("voucher"), txt);
assert.deepEqual(cs.results[2].compare.fields, ["ALLLEDGERENTRIES.LIST/AMOUNT"]);
assert.equal(cs.results.length, 3);
// not a measurement: refused
for (const bad of [null, "x", [], {}, { results: "x" }]) assert.equal(cleanFastMeasure(bad), null);
// the verdict: a stop, a slow request, a long hold, a difference, nothing compared, not watched: no pass
const mod = (f) => { const x = cleanFastMeasure(good); f(x); return fastMeasurePass(x); };
assert.equal(mod((x) => { x.stopped = "Tally took longer than 2 s"; }), false);
assert.equal(mod((x) => { x.results[1].ms = 1500; }), false);
assert.equal(mod((x) => { x.results[2].objectMs = 1600; }), false);
assert.equal(mod((x) => { x.results[1].holdMs = 1000; }), false);
assert.equal(mod((x) => { x.results[2].compare.differ = 1; }), false);
assert.equal(mod((x) => { x.results[2].compare.same = 0; }), false);
assert.equal(mod((x) => { x.watched = false; }), false);
assert.equal(mod((x) => { x.error = "no entries"; }), false);
console.log("fastmeasure: all passed");
