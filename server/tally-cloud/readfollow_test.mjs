// node server/tally-cloud/readfollow_test.mjs (no Deno needed): the beat's gate from migration 146's serving bridges
import assert from "node:assert/strict";
import { servingGate, beatOnly, lineFollows } from "./readfollow.js";

const A = "dev-a", B = "dev-b", BA = "go-aaaa01", BB = "go-bbbb01";
const sA = { device: A, bridge: BA }, sB = { device: B, bridge: BB };
const map = new Map([
  ["Made-up One", { book: "b1", serving: [sA, sB] }],          // both serve: shared
  ["Made-up Two", { book: "b2", serving: [sA] }],              // only A
  ["Made-up Three", { book: "b3", serving: [] }],              // nobody by 146's rules: as before
  ["Made-up Four", { book: "", serving: [sB] }],               // no book: ignored
]);
let g = servingGate(map, B, BB);
assert.deepEqual([...g.follow.keys()], ["b1"]);
assert.deepEqual([...g.shared], ["Made-up One"]);
assert.deepEqual([...g.others], ["Made-up Two"]);
assert.ok(g.follow.get("b1").has(A + "|" + BA) && g.follow.get("b1").has(B + "|" + BB));
g = servingGate(map, A, BA);
assert.deepEqual([...g.follow.keys()].sort(), ["b1", "b2"]);
assert.deepEqual([...g.others], []);
g = servingGate(map, A, "go-other1");                           // another bridge of A's key does not serve
assert.deepEqual([...g.follow.keys()], []); assert.deepEqual([...g.others].sort(), ["Made-up One", "Made-up Two"]);
assert.deepEqual([...servingGate(null, A, BA).follow.keys()], []);
assert.deepEqual([...servingGate({ "Made-up One": { book: "b1", serving: [sA] } }, A, BA).shared], ["Made-up One"]);

// the beat cut to some companies (both shapes of the open list); the beat itself untouched
const beat = { tally: true, open: ["Made-up One", "Made-up Two"], companies: [{ name: "Made-up One", open: true }, { name: "Made-up Two", open: true }] };
const cut = beatOnly(beat, (n) => n !== "Made-up Two");
assert.deepEqual(cut.open, ["Made-up One"]); assert.deepEqual(cut.companies.map((c) => c.name), ["Made-up One"]); assert.equal(beat.open.length, 2);

// another bridge's held line: asked here only for a book this bridge serves, never its own, never one whose bridge serves
const follow = new Map([["b1", new Set([B + "|" + BB, "dev-c|go-cccc01"])]]);
assert.equal(lineFollows({ book_id: "b1", device_id: A, bridge: BA }, follow, B, BB), true);
assert.equal(lineFollows({ book_id: "b1", device_id: "dev-c", bridge: "go-cccc01" }, follow, B, BB), false);
assert.equal(lineFollows({ book_id: "b1", device_id: B, bridge: BB }, follow, B, BB), false);
assert.equal(lineFollows({ book_id: "b2", device_id: A, bridge: BA }, follow, B, BB), false);
assert.equal(lineFollows(null, follow, B, BB), false);
console.log("readfollow_test: all passed");
