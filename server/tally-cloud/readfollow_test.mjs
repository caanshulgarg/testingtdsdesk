// node server/tally-cloud/readfollow_test.mjs (no Deno needed): the beat's gate from migration 146's decisions
import assert from "node:assert/strict";
import { followMine, followGate, beatOnly, lineFollows } from "./readfollow.js";

const A = "dev-a", B = "dev-b", BA = "go-aaaa01", BB = "go-bbbb01";
const dec = (state, reader, extra = {}) => ({ ok: true, state, reader, serving: reader ? [reader] : [], ...extra });
const rA = { device: A, bridge: BA }, rB = { device: B, bridge: BB };

// mine / other / free
assert.equal(followMine(dec("linked", rA), A, BA), "mine");
assert.equal(followMine(dec("moved", rB), A, BA), "other");
assert.equal(followMine(dec("settling", rB), B, BB), "mine");
for (const s of ["none", "nolink", "held", "changed"]) assert.equal(followMine(dec(s, rB), A, BA), "free", s);
assert.equal(followMine(null, A, BA), "free");                         // no migration 146, or an error
assert.equal(followMine({ ok: false, error: "x" }, A, BA), "free");
assert.equal(followMine(dec("linked", { device: A, bridge: "go-other1" }), A, BA), "other");   // another bridge of the same key

// the gate: a book read elsewhere is skipped here; a book read here with fetchOn is inherited; follow keeps the serving
const decs = new Map([
  ["Made-up One", { book: "b1", dec: dec("moved", rB, { fetchOn: true }) }],
  ["Made-up Two", { book: "b2", dec: dec("linked", rA) }],
  ["Made-up Three", { book: "b3", dec: dec("none", null) }],
]);
let g = followGate(decs, B, BB);
assert.deepEqual([...g.skip], ["Made-up Two"]);
assert.deepEqual([...g.inherit], ["Made-up One"]);
assert.deepEqual([...g.follow.keys()], ["b1"]);
g = followGate(decs, A, BA);
assert.deepEqual([...g.skip], ["Made-up One"]);
assert.deepEqual([...g.inherit], []);                                   // fetchOn not said: its own switch decides
assert.deepEqual([...g.follow.keys()], ["b2"]);
assert.deepEqual([...followGate({}, A, BA).skip], []);

// the beat cut to some companies (both shapes of the open list)
const beat = { tally: true, open: ["Made-up One", "Made-up Two"], companies: [{ name: "Made-up One", open: true }, { name: "Made-up Two", open: true }] };
const cut = beatOnly(beat, (n) => n !== "Made-up Two");
assert.deepEqual(cut.open, ["Made-up One"]);
assert.deepEqual(cut.companies.map((c) => c.name), ["Made-up One"]);
assert.equal(cut.tally, true);
assert.equal(beat.open.length, 2);                                       // the beat itself untouched

// another bridge's held line: asked here only for a book this bridge reads, never its own, never one whose bridge serves
const follow = new Map([["b1", new Set([B + "|" + BB, "dev-c|go-cccc01"])]]);
assert.equal(lineFollows({ book_id: "b1", device_id: A, bridge: BA }, follow, B, BB), true);          // A offline: asked here
assert.equal(lineFollows({ book_id: "b1", device_id: "dev-c", bridge: "go-cccc01" }, follow, B, BB), false);   // C serves: its own
assert.equal(lineFollows({ book_id: "b1", device_id: B, bridge: BB }, follow, B, BB), false);         // this bridge's own
assert.equal(lineFollows({ book_id: "b2", device_id: A, bridge: BA }, follow, B, BB), false);         // a book read elsewhere
assert.equal(lineFollows(null, follow, B, BB), false);
console.log("readfollow_test: all passed");
