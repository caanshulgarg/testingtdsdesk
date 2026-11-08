// node tests/run_read_follow_page.mjs - the page's words for "every bridge with the company open serves it"
// (app/src/lib/readFollow.js; next-link-follow, migration 146), from the cloud's own list (tally_read_view). Made-up
// computers, logins and companies only; no browser.
//   0. without 146 (no view): nothing new is said (no where-line, no fetch, no re-ask); the buttons' "Nothing can answer
//      now" only when no bridge FinCom hears has the company open for reading (tallyServe with reads)
//   1. served by the link's own bridge alone: nothing said
//   2. served by two logins: "Being read from 2 logins' Tally" (", yours included" when this login's bridge is one)
//   3. served by this login's bridge alone, the linked login offline: "Read from this computer's Tally (your login) — the
//      linked login's bridge is offline"; from another login's browser: "another Windows login's Tally"; the linked login
//      online without the company: "... — the company is not open in the linked login's Tally"
//   4. served by nobody and the linked computer offline: the row's words and the buttons' result; open nowhere: its words
//   5. fetchOn is the cloud's (a key's switch on the same computer, as it is now)
//   6. "asking Tally again" only for lines the cloud lists to re-ask (every one of them)
//   7. the cloud's list empty but a bridge FinCom hears has the company open (tallyServe): nothing said, never "offline"
import assert from "node:assert/strict";

const now = Date.now(), iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const A = "dev-a", B = "dev-b", BA = "go-aaaa01", BB = "go-bbbb01", CO = "Made-up Heron Traders", BOOK = "book-1";
const dev = (id) => ({ id, info: { computer: "SRV9", beat: { at: iso(0) }, bridges: {} } });
let rec = { book_id: BOOK, device_id: A }, own = BB, serve = null;
globalThis.TLight = { st: { devs: [dev(A), dev(B)] } };
globalThis.LinkRec = { ofName: (n) => (n === CO ? rec : null) };
globalThis.tallyOwnBridge = () => ({ id: own });
globalThis.tallyServe = (company, o) => { assert.equal(o.reads, true); return serve; };
globalThis.TCloud = { rpc: async () => { throw new Error("Could not find the function public.tally_read_view"); } };
const { readWhere, noAnswer, followFetch, reasked, VIEW, followOn } = await import("../app/src/lib/readFollow.js");

// 0. no 146
VIEW.off = true;
assert.equal(followOn(), false);
assert.equal(readWhere(CO), null); assert.equal(followFetch(CO), false); assert.equal(reasked([{ id: 1 }], CO), false);
serve = { dev: dev(B), id: BB }; assert.equal(noAnswer(CO), "");
serve = null; assert.match(noAnswer(CO), /^Nothing can answer now: “Made-up Heron Traders” is not open in any Tally FinCom hears\./);
globalThis.tallyServe = undefined; assert.equal(noAnswer(CO), "");

// with 146
VIEW.off = false; VIEW.at = now;
const sA = { device: A, bridge: BA, linked: true }, sB = { device: B, bridge: BB, linked: false };
const book = (o) => { VIEW.books = [Object.assign({ book: BOOK, linkDevice: A, linkHeardAt: iso(0), serving: [sA], fetchOn: false, reask: [] }, o)]; };
// 1.
book({}); assert.equal(readWhere(CO).kind, "linked"); assert.equal(readWhere(CO).text, ""); assert.equal(noAnswer(CO), "");
// 2.
book({ serving: [sA, sB] });
assert.equal(readWhere(CO).text, "Being read from 2 logins’ Tally, yours included");
own = "go-other"; assert.equal(readWhere(CO).text, "Being read from 2 logins’ Tally"); own = BB;
assert.equal(noAnswer(CO), "");
// 3.
book({ serving: [sB], linkHeardAt: iso(60 * 20) });
assert.equal(readWhere(CO).text, "Read from this computer’s Tally (your login) — the linked login’s bridge is offline");
own = "go-other"; assert.equal(readWhere(CO).text, "Read from another Windows login’s Tally — the linked login’s bridge is offline"); own = BB;
book({ serving: [sB], linkHeardAt: iso(1) });
assert.equal(readWhere(CO).text, "Read from this computer’s Tally (your login) — the company is not open in the linked login’s Tally");
// 5.
book({ serving: [sB], fetchOn: true }); assert.equal(followFetch(CO), true);
book({ serving: [sB], fetchOn: false }); assert.equal(followFetch(CO), false);
book({ serving: [], fetchOn: true }); assert.equal(followFetch(CO), false);           // nobody serves: nothing to fetch with
// 6.
book({ serving: [sB], reask: [11, 12] });
assert.equal(reasked([{ id: 11 }, { id: 12 }], CO), true);
assert.equal(reasked([{ id: 11 }, { id: 13 }], CO), false);        // one the cloud does not ask again: the upload stays
assert.equal(reasked([], CO), false);
// 4.
book({ serving: [], linkHeardAt: iso(60 * 20), reask: [11] });
const w = readWhere(CO);
assert.equal(w.kind, "offline");
assert.match(w.text, /^The computer this client is linked to is offline \(since (today|yesterday) \d\d:\d\d\)\. Open the company in Tally on this computer, or start FinCom Bridge there\.$/);
assert.ok(!/SRV9|made-up/i.test(w.text), "no computer or login named");
assert.equal(noAnswer(CO), "Nothing can answer now. " + w.text);
assert.equal(reasked([{ id: 11 }], CO), false);                    // nobody serves: the upload stays
book({ serving: [], linkHeardAt: iso(0) });
assert.equal(readWhere(CO).kind, "closed"); assert.match(noAnswer(CO), /is not open in any Tally FinCom hears/);
assert.equal(readWhere("Made-up Not Linked"), null);
// 7. review of 314a178f1: the cloud's list empty (a link with no GUID, a bridge older than 2.4.5, a beat of over 50
//    companies) while a bridge FinCom hears has the company open for reading: not "offline", not "Nothing can answer now"
globalThis.tallyServe = (company, o) => { assert.equal(o.reads, true); assert.equal(o.own, ""); return serve; };
serve = { dev: dev(B), id: BB };
book({ serving: [], linkHeardAt: iso(60 * 20) });
assert.equal(readWhere(CO), null); assert.equal(noAnswer(CO), "");
book({ serving: [], linkHeardAt: iso(0) });
assert.equal(readWhere(CO), null); assert.equal(noAnswer(CO), "");
globalThis.tallyServe = () => { throw new Error("made-up"); };                // unsure: never "offline"
assert.equal(readWhere(CO), null); assert.equal(noAnswer(CO), "");
globalThis.tallyServe = (company, o) => null;                               // open nowhere FinCom hears: as in 4.
book({ serving: [], linkHeardAt: iso(60 * 20) });
assert.equal(readWhere(CO).kind, "offline"); assert.match(noAnswer(CO), /^Nothing can answer now\. The computer this client is linked to is offline/);
console.log("run_read_follow_page: all passed");
