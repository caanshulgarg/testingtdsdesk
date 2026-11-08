// node tests/fast_measure_page_test.mjs - next-fast-measure: the Tally page's verdict on a fast-read measurement
// (app/src/lib/fastMeasure.js), the same rule as the cloud's and the bridge's
import assert from "node:assert/strict";
import { fastVerdict, fastWords } from "../app/src/lib/fastMeasure.js";
import { fastMeasurePass, cleanFastMeasure } from "../server/tally-cloud/fastmeasure.js";

const row = (f) => { const r = { ok: true, watched: true, tallyVersion: "7.1.0.0", results: [{ kind: "W1", days: 31, rows: 175, ms: 900, holdMs: 200 },
  { kind: "W2", days: 3, asked: 50, rows: 50, ms: 700, holdMs: 100, objectMs: 30, objectHoldMs: 0, compare: { same: 50, differ: 0, left: 0, fields: [] } }] };
  if (f) f(r); return { received_at: "2026-11-08T05:00:00Z", tally_version: "7.1.0.0", result: r }; };
let w = fastWords(row());
assert.equal(w.pass, true); assert.match(w.head, /^PASS · TallyPrime 7\.1\.0\.0 · worst 0\.90 s · window held 0\.20 s · 50 of 50 entries the same$/); assert.equal(w.detail, "");
const cases = [
  [(r) => { r.results[0].ms = 1500; }, /1\.50 s/],
  [(r) => { r.results[1].objectHoldMs = 1000; }, /window held 1\.00 s/],
  [(r) => { r.results[1].compare.differ = 2; r.results[1].compare.fields = ["ALLLEDGERENTRIES.LIST/AMOUNT"]; }, /2 of 52 entries not the same; fields that differed: ALLLEDGERENTRIES\.LIST\/AMOUNT/],
  [(r) => { r.stopped = "Tally took longer than 2 s; the measurement stopped there"; }, /longer than 2 s/],
  [(r) => { r.watched = false; }, /could not be watched/],
  [(r) => { r.ok = false; r.error = "ZZ TEST has no entries in the last year"; r.results = []; }, /no entries/],
  [(r) => { r.results[1].compare.same = 0; }, /no entry compared/],
];
for (const [f, re] of cases) {
  const x = row(f), v = fastWords(x);
  assert.equal(v.pass, false, String(f)); assert.match(v.detail, re);
  // the page and the cloud agree
  assert.equal(fastMeasurePass(cleanFastMeasure(x.result)), false, String(f));
}
assert.equal(fastMeasurePass(cleanFastMeasure(row().result)), true);
assert.equal(fastVerdict(null).pass, false);
console.log("fast measure page: all passed");
