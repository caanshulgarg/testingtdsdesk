// node tests/run_itr_law_joint.mjs - slow: a joint brute force over how three losses of other heads (business loss,
// house property loss, unabsorbed depreciation brought forward) and the unused basic exemption are placed. For each
// made-up return every combination of the three losses' normal-rate limits (LOSS_LIMITS, each loss on its own), their
// special-rate orders and the exemption's order is computed; the computation's own choice (tax.js compute, check.js
// check) must cost no more than the best found (2 rupees for rounding). Both regimes; half the returns old-regime with
// total income near Rs 5 lakh (the rebate of 87A). Seeded xorshift32 streams, one seed per half, not overlapping.
// ITR_LIB=<dir>: another copy of app/src/lib/itr (an older commit's, for the fail-before log)
const LIB = process.env.ITR_LIB ? new URL("file://" + process.env.ITR_LIB.replace(/\/?$/, "/")) : new URL("../app/src/lib/itr/", import.meta.url);
const { headsInto } = await import(new URL("model.js", LIB)), { compute, LOSS_LIMITS } = await import(new URL("tax.js", LIB)), { check } = await import(new URL("check.js", LIB));

let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const stream = (seed) => { let x = seed >>> 0; return (a, b) => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return a + Math.floor((x / 4294967296) * (b - a + 1)); }; };
const paid0 = () => ({ tds: [], tdsSal: [], tcs: [], advance: [], selfAssessment: [] });
function make(r, small) {
  const k = small ? 10000 : 100000, regime = small ? "old" : r(0, 1) ? "old" : "new";
  const M = { entity: "P", form: "ITR-3", resident: true, age: 40, deductions: {}, losses: { unabsorbedDep: r(1, 6) * k }, paid: paid0(), filingDate: "20260720", form10iea: "X", noInterest: true, regime,
    os: { other: r(0, small ? 30 : 12) * k }, business: { pbt: -r(1, 5) * k, adds: [], less: [] } };
  headsInto(M, { houses: [{ kind: "S", loans: [{ interest: r(1, small ? 20 : 3) * k }] }], cgRows: [
    { id: "L", kind: "land", acq: ["20080601", "20150601"][r(0, 1)], sale: "20250701", value: r(10, 60) * k, cost: r(5, 30) * k },
    { id: "U", kind: "unlisted", acq: "20200101", sale: "20250801", value: r(0, 30) * k, cost: r(0, 10) * k },
    { id: "A", kind: "eq", acq: "20250101", sale: "20250901", value: 100000 + r(0, 8) * k, cost: 100000 },
    { id: "Q", kind: "eq", acq: "20200101", sale: "20250801", value: 100000 + r(0, 8) * k, cost: 100000 },
    { id: "G", kind: "other", acq: "20150101", sale: "20250901", value: 100000, cost: 100000 + r(0, 10) * k },
    { id: "D", kind: "mf50AA", acq: "20230601", sale: "20251201", value: 100000 + r(0, 5) * k, cost: 100000 }] });
  return M;
}
const ORDERS = [["A", "A", "A"], ["A", "A", "B"], ["A", "B", "A"], ["A", "B", "B"], ["B", "A", "A"], ["B", "A", "B"], ["B", "B", "A"], ["B", "B", "B"], ["C", "C", "C"]];
function best(M) {
  let b = Infinity, at = null;
  for (const [bo, ho, uo] of ORDERS) for (const ex of ["A", "B", "C"]) for (const tb of LOSS_LIMITS) for (const th of LOSS_LIMITS) for (const tu of LOSS_LIMITS) {
    const lo = { bus: tb, hp: th, ud: tu, busO: bo, hpO: ho, udO: uo, exO: ex, keepA: 62500 }, v = compute(Object.assign({}, M, { _lo: lo })).liability;
    if (v < b) { b = v; at = lo; }
  }
  return { b, at };
}
const N = +(process.env.JOINT_N || 30);
for (const [name, seed, small] of [["both regimes", 0x2545f491, false], ["old regime near Rs 5 lakh", 0x6a09e667, true]]) {
  const r = stream(seed);
  let worse = 0, first = null, checkWorse = 0;
  for (let i = 0; i < N; i++) {
    const M = make(r, small), f = compute(M).liability, c = check(M).liability, x = best(M);
    if (f > x.b + 2) { worse++; if (!first) first = { i, fincom: f, best: x.b, lo: x.at, M: { regime: M.regime, os: M.os, losses: M.losses, business: M.business, cgRows: M.cgRows, houseRows: M.houseRows } }; }
    if (c !== f) checkWorse++;
  }
  ok(worse === 0, name + ": " + N + " returns, three losses placed jointly: FinCom never dearer than the best" + (first ? "; first worse: " + JSON.stringify(first) : ""));
  ok(checkWorse === 0, name + ": the second computation's search lands on the same liability");
}
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
