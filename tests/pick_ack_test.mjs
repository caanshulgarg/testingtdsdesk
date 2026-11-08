// node tests/pick_ack_test.mjs - bridge 2.5.10: the page's reading of the bridge's own pick-up acknowledgement
// (app/src/lib/pickAck.js, used by Bring books, Bring another year, Bring missing days and Check for changes): only what
// was said since the press's snapshot counts; started wins; the words; nothing when none (the page then infers as before)
import assert from "node:assert/strict";
import { ackSnap, ackNew, ackWords } from "../app/src/lib/pickAck.js";

const devs = [{ id: "d-1", info: { beat: { pickups: [] } } }];
globalThis.TLight = { st: { devs } };
const set = (l) => { devs[0].info = { beat: { pickups: l } }; };
const A = (state, more = {}) => Object.assign({ company: "ZZ TEST", book: "bk-zz", guid: "g-1", kind: "period", takenAt: "2026-11-08T05:00:00Z", state, day: "20261001", login: "made-up-a", bridge: "go-1" },
  state === "started" ? { pickedUtc: "2026-11-08T05:12:00Z" } : { code: "typing", words: "someone is working in Tally; reading starts once Tally has been left alone for a minute", at: "2026-11-08T05:12:10Z" }, more);

// none said: null (the inference stays)
set([]);
let s = ackSnap("bk-zz", ["period"]);
assert.equal(ackNew(s), null);
// one already there before the press is never the press's; the same one unchanged neither
set([A("refused", { takenAt: "2026-11-08T04:00:00Z", code: "posting", words: "a posting into Tally goes first" })]);
s = ackSnap("bk-zz", ["period"]);
assert.equal(ackNew(s), null);
// said after: refused, then started (the same hand-out changed): each is the press's
set([A("refused")]);
assert.equal(ackWords(ackNew(s)), "Not started: someone is working in Tally; reading starts once Tally has been left alone for a minute.");
set([A("started")]);
assert.equal(ackWords(ackNew(s)), "Started at 10:42 IST on made-up-a’s Tally.");
// started wins over another bridge's refusal
set([A("refused", { bridge: "go-2", at: "2026-11-08T05:30:00Z" }), A("started")]);
assert.equal(ackNew(s).state, "started");
// another kind, another book (the same name included: another client's copy), no book: not this press's (review 6)
set([A("started", { kind: "check" }), A("started", { book: "bk-other" }), A("started", { book: "" }), A("started", { book: undefined, takenAt: "2026-11-08T05:40:00Z" })]);
assert.equal(ackNew(s), null);
assert.equal(ackNew(ackSnap("bk-zz", ["check"]))?.kind, undefined, "a snapshot taken now holds them");
const sf = ackSnap("bk-zz", ["fill", "check"]);
set([A("started", { kind: "fill", takenAt: "2026-11-08T06:00:00Z", pickedUtc: "2026-11-08T06:01:00Z" })]);
assert.equal(ackWords(ackNew(sf)), "Started at 11:31 IST on made-up-a’s Tally.");
// a started one without its time, an unknown state: never said
set([A("started", { pickedUtc: "", takenAt: "2026-11-08T07:00:00Z" }), A("taken", { takenAt: "2026-11-08T07:00:00Z" })]);
assert.equal(ackNew(s), null);
// the words: a login with its computer or markup cut away, no login: the Tally computer; no words: said plainly
assert.equal(ackWords(A("started", { login: "SRV01\\made-up-b" })), "Started at 10:42 IST on made-up-b’s Tally.");
assert.equal(ackWords(A("started", { login: "" })), "Started at 10:42 IST on the Tally computer.");
assert.equal(ackWords(A("refused", { words: "<b>Tally is busy</b>." })), "Not started: Tally is busy.");
assert.equal(ackWords(A("refused", { words: "" })), "Not started: the Tally computer did not say why.");
// no snapshot, no company, no devices: nothing, never an error
assert.equal(ackNew(null), null);
assert.equal(ackNew(ackSnap("", ["period"])), null);
delete globalThis.TLight;
assert.equal(ackNew(s), null);
console.log("pick_ack_test: all passed");
