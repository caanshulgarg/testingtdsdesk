// node tests/run_read_follow_page.mjs - the page's words for "reads follow the company" (app/src/lib/readFollow.js;
// next-link-follow, migration 146). Made-up computers, logins and companies only; no browser.
//   1. linked and open in the link's own Tally: nothing said
//   2. the linked login's bridge offline, the company open in this login's own Tally: "Read from this computer's Tally
//      (your login) — the linked login's bridge is offline"; after the cloud's move (the link now names this login's key):
//      the same words (the move remembers the old key)
//   3. linked login online without the company, another login has it open: "... — the company is not open in the
//      linked login's Tally"
//   4. the linked computer offline, the company open nowhere: the row's words ("The computer this client is linked to is
//      offline (since ...). Open the company in Tally on this computer, or start FinCom Bridge there.") and the buttons'
//      result ("Nothing can answer now. ...")
//   5. the switch of the key the book moved from (fetch_on) counts for Bring missing days
//   6. held lines Tally did not answer for, from the offline key, are asked again where the company is open now
import assert from "node:assert/strict";

const now = Date.now(), iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const A = "dev-a", B = "dev-b", BA = "go-aaaa01", BB = "go-bbbb01", CO = "Made-up Heron Traders", BOOK = "book-1";
const dev = (id, bridge, user, open, minAgo) => ({ id, info: { computer: "SRV9", beat: { at: iso(minAgo) }, bridges: { [bridge]: { at: iso(minAgo), user, open } } } });
let devs = [], rec = { book_id: BOOK, device_id: A }, own = BB;
globalThis.TLight = { st: { get devs() { return devs; } } };
globalThis.LinkRec = { ofName: (n) => (n === CO ? rec : null) };
globalThis.tallyOwnBridge = () => ({ id: own });
// the serving bridge as src/js/98 tallyServe finds it (the link's key first; heard within 3 minutes, company open)
globalThis.tallyServe = (company, o) => {
  const hits = [];
  devs.forEach((d) => Object.entries(d.info.bridges).forEach(([id, b]) => { if (now - Date.parse(b.at) < 180000 && b.open.includes(company)) hits.push({ dev: d, id, how: d.id === o.rec.device_id ? "linked" : "other" }); }));
  return hits.sort((a, b) => (a.how === "linked" ? 0 : 1) - (b.how === "linked" ? 0 : 1))[0] || null;
};
globalThis.Cloud = { api: async () => [] };
const { readWhere, noAnswer, followFetch, reasked, MOVES } = await import("../app/src/lib/readFollow.js");
MOVES.at = now; MOVES.rows = [];

// 1.
devs = [dev(A, BA, "SRV9\\made-up-a", [CO], 0), dev(B, BB, "SRV9\\made-up-b", [CO], 0)];
assert.equal(readWhere(CO).kind, "linked"); assert.equal(readWhere(CO).text, ""); assert.equal(noAnswer(CO), "");

// 2.
devs = [dev(A, BA, "SRV9\\made-up-a", [CO], 60 * 20), dev(B, BB, "SRV9\\made-up-b", [CO], 0)];
let w = readWhere(CO);
assert.equal(w.kind, "here");
assert.equal(w.text, "Read from this computer’s Tally (your login) — the linked login’s bridge is offline");
assert.equal(noAnswer(CO), "");
rec = { book_id: BOOK, device_id: B };      // the cloud moved the link to B's key
MOVES.rows = [{ id: 1, book_id: BOOK, from_device: A, to_device: B, to_bridge: BB, why: "offline", fetch_on: true, at: iso(1), undone_at: null }];
w = readWhere(CO);
assert.equal(w.text, "Read from this computer’s Tally (your login) — the linked login’s bridge is offline");
own = "go-other";                            // seen from another login's browser
assert.equal(readWhere(CO).text, "Read from another Windows login’s Tally — the linked login’s bridge is offline");
own = BB;

// 5.
assert.equal(followFetch(CO), true);
MOVES.rows[0].fetch_on = false; assert.equal(followFetch(CO), false); MOVES.rows[0].fetch_on = true;

// 6.
const line = (why, dv = A, days = 1) => ({ held_why: why, device_id: dv, received_at: iso(days * 1440) });
assert.equal(reasked([line("Tally did not answer in time for this entry when asked again; upload that day's Day Book to settle it")], CO), true);
assert.equal(reasked([line("FinCom does not ask Tally for this company's entries")], CO), true);
assert.equal(reasked([line("could not tell which entry this is; upload the Day Book")], CO), false);       // not a re-ask
assert.equal(reasked([line("Tally did not answer in time", B)], CO), false);                              // the serving key's own
assert.equal(reasked([line("Tally did not answer in time", A, 40)], CO), false);                          // older than 30 days
assert.equal(reasked([], CO), false);

// 3.
MOVES.rows = []; rec = { book_id: BOOK, device_id: A };
devs = [dev(A, BA, "SRV9\\made-up-a", [], 0), dev(B, BB, "SRV9\\made-up-b", [CO], 0)];
assert.equal(readWhere(CO).text, "Read from this computer’s Tally (your login) — the company is not open in the linked login’s Tally");

// 4.
devs = [dev(A, BA, "SRV9\\made-up-a", [CO], 60 * 20), dev(B, BB, "SRV9\\made-up-b", [], 0)];
w = readWhere(CO);
assert.equal(w.kind, "offline");
assert.match(w.text, /^The computer this client is linked to is offline \(since (today|yesterday) \d\d:\d\d\)\. Open the company in Tally on this computer, or start FinCom Bridge there\.$/);
assert.ok(!/SRV9|made-up/.test(w.text), "no computer or login named");
assert.equal(noAnswer(CO), "Nothing can answer now. " + w.text);
assert.equal(reasked([line("Tally did not answer in time")], CO), false);      // nothing serves: the upload stays
devs = [dev(A, BA, "SRV9\\made-up-a", [], 0), dev(B, BB, "SRV9\\made-up-b", [], 0)];
assert.equal(readWhere(CO).kind, "closed");
assert.equal(noAnswer(CO), "Nothing can answer now: “" + CO + "” is not open in any Tally FinCom hears. Open it in Tally; FinCom then brings it by itself.");
assert.equal(readWhere("Made-up Not Linked"), null);
console.log("run_read_follow_page: all passed");
