// deno test server/tally-cloud/tellday_test.ts - the owner's decision of 24-Nov-2026: "There should be proper way to tell and
// auto import of tally days into fincom" (tellday.js; the plan's A.4, A.5 and B.3). Made-up companies only.
//   1. cleanTell: bridge 2.5.22's skip, numbersWhy and addonSilent kept on info.bridges[id].tell: known codes only, at
//      most 50 each, names cut to 200; an older bridge (none of the keys) adds nothing; the bridge's words are never kept
//   2. unstartedOf: the companies the beat hands no day of for want of a starting point, recorded (with since) for tell
//   3. autoDaysFor / autoKept: a bridge older than 2.5.16 is never handed a day FinCom queued by itself; a day queued by
//      itself goes only through a claim (tally_days_claim: a bridge that serves the book)
//   4. due: tally_autoday_queue at most once per book per 10 minutes
//   5. noUploadAsk: FinCom's words never ask for a Day Book upload
import { cleanTell, unstartedOf, autoDaysFor, autoKept, AUTO_SOURCES, due, noUploadAsk, AUTO_EVERY_MS, BRING_WORDS } from "./tellday.js";

function assert(c: unknown, w: string) { if (!c) throw new Error(w); }
const T0 = Date.parse("2026-11-24T06:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

Deno.test("cleanTell: an older bridge sends none of the keys: nothing added", () => {
  assert(JSON.stringify(cleanTell({ version: "2.5.16", companies: [] }, null, T0)) === "{}", "no tell from an older bridge");
  assert(JSON.stringify(cleanTell({ skip: "x", numbersWhy: [1], addonSilent: {} }, null, T0)) === "{}", "the wrong shapes: nothing");
  assert(JSON.stringify(cleanTell({ skip: {}, numbersWhy: {}, addonSilent: [] }, null, T0)) === JSON.stringify({ tell: { skip: {}, numbersWhy: {}, addonSilent: [], at: iso(T0) } }), "empty but sent: kept empty, with its time");
});

Deno.test("cleanTell: known codes only, names trimmed and cut to 200, at most 50", () => {
  const long = "L".repeat(300);
  const t = cleanTell({
    skip: { " MADE UP CO\r\n": "ownerUnknown", "ACME": "twoTallys", "B": "otherLogin", "C": "notOpen", "D": "otherCopy", "E": "slow", "F": "madeUp", "G": 7, [long]: "slow", "": "slow" },
    numbersWhy: { "MADE UP CO": "lightFailed", "ACME": "over2s", "B": "notAsked", "C": "ownerUnknown", "D": "twoTallys", "E": "Please upload the Day Book" },
  }, null, T0).tell as any;
  assert(t.skip["MADE UP CO"] === "ownerUnknown" && t.skip.ACME === "twoTallys" && t.skip.E === "slow", "known kept: " + JSON.stringify(t.skip));
  assert(!("F" in t.skip) && !("G" in t.skip) && !("" in t.skip), "unknown codes and blank names dropped");
  assert(t.skip["L".repeat(200)] === "slow" && !(long in t.skip), "a name cut to 200");
  assert(Object.keys(t.numbersWhy).sort().join() === "ACME,B,C,D,MADE UP CO" && !("E" in t.numbersWhy), "numbersWhy: known only: " + JSON.stringify(t.numbersWhy));
  assert(Object.keys(t.addonSilent || []).length === 0, "addonSilent absent: empty");
  const many: Record<string, string> = {};
  for (let i = 0; i < 80; i++) many["CO " + i] = "notOpen";
  const t2 = cleanTell({ skip: many, numbersWhy: many }, null, T0).tell as any;
  assert(Object.keys(t2.skip).length === 50 && Object.keys(t2.numbersWhy).length === 0, "50 at most; notOpen is no numbers reason");
});

Deno.test("cleanTell: addonSilent cleaned, the bridge's words never kept", () => {
  const ok1 = { company: "MADE UP CO", guid: "A2F776BD-4A48-4F7D-9C73-48A8F0872522", reason: "addonShared", since: "2026-11-24T10:00:00+05:30", tallyAlter: 95937, lastLineAlter: 95888, words: "upload the Day Book", secret: 1 };
  const t = cleanTell({ addonSilent: [ok1,
    { company: "NO REASON", reason: "madeUp", since: "yesterday", tallyAlter: -1, lastLineAlter: "x" },
    { company: "", reason: "addonAdded" }, "text", null, [1],
    { company: "ADDED", reason: "addonAdded", since: "2026-11-24T04:00:00Z", tallyAlter: 1e16 },
    { company: "MADE UP CO", reason: "noFile" }] }, null, T0).tell as any;
  const a = t.addonSilent;
  assert(a.length === 3, "blank company, non-objects and a second entry of one company dropped: " + JSON.stringify(a));
  assert(JSON.stringify(a[0]) === JSON.stringify({ company: "MADE UP CO", guid: "a2f776bd-4a48-4f7d-9c73-48a8f0872522", reason: "addonShared", since: "2026-11-24T10:00:00+05:30", tallyAlter: 95937, lastLineAlter: 95888 }), "kept as said, nothing else: " + JSON.stringify(a[0]));
  assert(a[1].company === "NO REASON" && a[1].reason === "" && a[1].since === "" && a[1].tallyAlter === null && a[1].lastLineAlter === null, "an unknown reason: none (the general sentence): " + JSON.stringify(a[1]));
  assert(a[2].reason === "addonAdded" && a[2].tallyAlter === null, "a number past Tally's range: none");
  const many = Array.from({ length: 70 }, (_, i) => ({ company: "CO " + i, reason: "noFile" }));
  assert((cleanTell({ addonSilent: many }, null, T0).tell as any).addonSilent.length === 50, "50 at most");
  assert(!JSON.stringify(t).toLowerCase().includes("upload"), "no bridge words kept");
});

Deno.test("unstartedOf: open, the bridge sends numbers for others, none for it, no startPoint; or noStart a moment ago", () => {
  const cos = [{ name: "MADE UP CO", open: true, guid: "g1" }, { name: "ACME", open: true, guid: "g2", altvchid: 10, altmstid: 4 }, { name: "SHUT", open: false }];
  const u = unstartedOf({ companies: cos }, T0);
  assert([...u.keys()].join() === "made up co" && u.get("made up co")!.name === "MADE UP CO" && u.get("made up co")!.why === "noNumbers", "no numbers: " + JSON.stringify([...u]));
  assert(unstartedOf({ companies: [{ name: "MADE UP CO", open: true }, { name: "ACME", open: true }] }, T0).size === 0, "an older bridge sending no numbers for any: none");
  assert(unstartedOf({ companies: cos, startPoint: { "MADE UP CO": { altvchid: 3 } } }, T0).size === 0, "its startPoint: started");
  const pk = [{ state: "refused", code: "noStart", company: "ACME", at: iso(T0 - 60000) }, { state: "refused", code: "noStart", company: "OLD", at: iso(T0 - 700000) }];
  const u2 = unstartedOf({ companies: [{ name: "ACME", open: true, altvchid: 9 }, { name: "OLD", open: true, altvchid: 9 }], pickups: pk }, T0);
  assert([...u2.keys()].join() === "acme" && u2.get("acme")!.why === "noStart", "noStart within 10 minutes only: " + JSON.stringify([...u2]));
});

Deno.test("cleanTell: the unstarted companies recorded, each with since kept from before", () => {
  const body = { companies: [{ name: "MADE UP CO", open: true }, { name: "ACME", open: true, altvchid: 1 }] };
  const t1 = cleanTell(body, null, T0).tell as any;
  assert(JSON.stringify(t1.unstarted) === JSON.stringify({ "MADE UP CO": { why: "noNumbers", since: iso(T0) } }) && t1.at === iso(T0), "first seen now: " + JSON.stringify(t1));
  assert(!("skip" in t1), "an older bridge: only what the cloud saw itself");
  const t2 = cleanTell(body, t1, T0 + 600000).tell as any;
  assert(t2.unstarted["MADE UP CO"].since === iso(T0), "since kept: " + JSON.stringify(t2));
  const t3 = cleanTell({ companies: [{ name: "MADE UP CO", open: true, altvchid: 5 }] }, t2, T0 + 700000);
  assert(JSON.stringify(t3) === "{}", "started: gone");
});

Deno.test("autoDaysFor: 2.5.16 or later only", () => {
  for (const v of ["2.5.16", "2.5.22", "2.6.0", "3.0.0", "2.10.1"]) assert(autoDaysFor(v), v);
  for (const v of ["2.5.15", "2.5.1", "2.4.9", "1.15.0", "", null, "2.5", "v2.5.16", "2.5.16-beta"]) assert(!autoDaysFor(v), String(v));
});

Deno.test("autoKept: a day FinCom queued by itself only by claim to a 2.5.16 bridge; a person's day as before", () => {
  for (const s of ["held", "delete", "gap", "future"]) {
    assert(AUTO_SOURCES.has(s), s + " is FinCom's own");
    assert(autoKept(s, { autoOn: true, newBridge: true, claimed: true }), s + ": claimed, new bridge");
    assert(!autoKept(s, { autoOn: true, newBridge: false, claimed: true }), s + ": an older bridge");
    assert(!autoKept(s, { autoOn: true, newBridge: true, claimed: false }), s + ": not claimed (no serving check)");
    assert(autoKept(s, { autoOn: false, newBridge: false, claimed: false }), s + ": a cloud without 222: as before");
  }
  for (const s of ["upload", "check", "fill"]) assert(autoKept(s, { autoOn: true, newBridge: false, claimed: false }), s + ": a person's day as before");
  assert(!autoKept(undefined, { autoOn: true, newBridge: false, claimed: true }) && autoKept(undefined, { autoOn: true, newBridge: true, claimed: true }), "source unknown: as FinCom's own");
});

Deno.test("due: once a book per 10 minutes", () => {
  const m = new Map<string, number>();
  assert(AUTO_EVERY_MS === 600000, "10 minutes");
  assert(due(m, "b1", T0) && !due(m, "b1", T0 + 60000) && due(m, "b2", T0 + 60000), "once each");
  assert(!due(m, "b1", T0 + AUTO_EVERY_MS - 1) && due(m, "b1", T0 + AUTO_EVERY_MS), "again after 10 minutes");
  for (let i = 0; i < 6000; i++) due(m, "x" + i, T0);
  assert(m.size <= 5000, "bounded");
});

Deno.test("noUploadAsk: the ask for an upload taken out, FinCom's own words in its place", () => {
  const W = [
    ["FinCom could not read 30-Aug-2025 from Tally. Please upload that day's Day Book.", "FinCom could not read 30-Aug-2025 from Tally. " + BRING_WORDS],
    ["Tally could not send 31-Aug-2025 in time on 3 days. Upload that day's Day Book to finish it.", "Tally could not send 31-Aug-2025 in time on 3 days. " + BRING_WORDS],
    ["deleted in Tally; FinCom could not tell which entry: upload that day's Day Book to settle it", "deleted in Tally; FinCom could not tell which entry. " + BRING_WORDS],
    ["1 entry on 30-Aug could not be read: upload the Day Book for this day.", "1 entry on 30-Aug could not be read. " + BRING_WORDS],
    ["Upload the Day Book from 05-Oct-2026", BRING_WORDS],
    ["FinCom did not bring in 30-Aug-2025: its month is locked in FinCom. Unlock the month, then upload that day's Day Book.", "FinCom did not bring in 30-Aug-2025: its month is locked in FinCom. " + BRING_WORDS],
  ];
  for (const [a, b] of W) { const got = noUploadAsk(a); assert(got === b, JSON.stringify(a) + " -> " + JSON.stringify(got)); assert(!/upload/i.test(got), "no upload: " + got); }
  assert(noUploadAsk("Tally is not open on this computer") === "Tally is not open on this computer", "other words as they are");
  assert(noUploadAsk("") === "" && noUploadAsk(null) === "" && noUploadAsk(undefined, "X") === "", "none: none");
  assert(noUploadAsk("Please upload that day's Day Book.", "FinCom tries again by itself.") === "FinCom tries again by itself.", "the words given in its place");
});
