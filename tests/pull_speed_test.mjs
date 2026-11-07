// node tests/pull_speed_test.mjs - next-fast-entries: the time left of "Bring books from Tally" from the bridge's own
// speed (its beat) when fresh, else the cloud's estimate (app/src/lib/pullSpeed.js)
import assert from "node:assert/strict";
import { bridgeSpeed, pullPaced, SPEED_FRESH_MS } from "../app/src/lib/pullSpeed.js";

const now = Date.parse("2026-11-07T10:00:00Z");
const dev = (at, speed) => ({ id: "d-1", info: { beat: { at: new Date(at).toISOString(), periodPull: { uploadDays: [], ...(speed ? { speed } : {}) } } } });
const going = { state: "going", done: false, counting: false, y: 12960, x: 8412, etaMin: 40, rate: 113 };
const book = (pull) => ({ book: "bk-zz", company: "ZZ  Test", pull });

// with the bridge's speed (fresh): 4,548 left at 300 a minute -> 16 min; the rate is the bridge's
let b = pullPaced(book(going), [dev(now - 30000, [{ company: "zz test", perMin: 300 }])], now);
assert.equal(b.pull.etaMin, 16); assert.equal(b.pull.rate, 300); assert.equal(b.pull.paceFrom, "bridge");
assert.equal(going.etaMin, 40, "the summary's own book is not changed");
// without it: the cloud's estimate as it is (the same object)
const plain = book(going);
assert.equal(pullPaced(plain, [dev(now - 30000, null)], now), plain);
assert.equal(pullPaced(plain, [], now), plain);
// a stale beat (over 3 minutes): the cloud's estimate
assert.equal(pullPaced(plain, [dev(now - SPEED_FRESH_MS - 1000, [{ company: "ZZ Test", perMin: 300 }])], now).pull.etaMin, 40);
// another company's speed, a zero speed, a beat from the future: not used
assert.equal(pullPaced(plain, [dev(now, [{ company: "Other", perMin: 300 }])], now).pull.etaMin, 40);
assert.equal(pullPaced(plain, [dev(now, [{ company: "ZZ Test", perMin: 0 }])], now).pull.etaMin, 40);
assert.equal(pullPaced(plain, [dev(now + 5 * 60000, [{ company: "ZZ Test", perMin: 300 }])], now).pull.etaMin, 40);
// counting the year's days, paused, done: the cloud's words as they are
for (const p of [{ ...going, counting: true }, { ...going, state: "paused" }, { ...going, done: true }]) assert.equal(pullPaced(book(p), [dev(now, [{ company: "ZZ Test", perMin: 300 }])], now).pull.etaMin, p.etaMin);
// two computers: the faster fresh one; nothing left: at least the cloud's figure kept
assert.equal(bridgeSpeed("zz test", [dev(now, [{ company: "zz test", perMin: 120 }]), dev(now - 1000, [{ company: "ZZ TEST", perMin: 450 }])], now), 450);
assert.equal(pullPaced(book({ ...going, x: 12960 }), [dev(now, [{ company: "zz test", perMin: 300 }])], now).pull.etaMin, 40);
// no book, no pull
assert.equal(pullPaced(null, [], now), null);
assert.deepEqual(pullPaced({ book: "x" }, [], now), { book: "x" });
console.log("pull speed: all passed");
