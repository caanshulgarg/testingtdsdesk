// node server/tally-cloud/bookstart_test.mjs (no Deno needed): a book's start (next-book-start)
import assert from "node:assert/strict";
import { startDecision, earliestKnown, memoAnswers, bookStartPatch, bookStartEarlier, booksFromDay, earliestDay, movedWords, istDay, uuidOfHex, dayOf, realDay } from "./bookstart.js";

// ---- a book with no start: the earliest known day, openings as on the day before
assert.deepEqual(bookStartPatch(null, null, "20250401"), { from_date: "2025-04-01", open_as_on: "2025-03-31" });
assert.deepEqual(bookStartPatch("", undefined, "20240301"), { from_date: "2024-03-01", open_as_on: "2024-02-29" });   // leap year
assert.deepEqual(bookStartPatch(null, null, "2026-01-01"), { from_date: "2026-01-01", open_as_on: "2025-12-31" });    // ISO, year boundary
assert.deepEqual(bookStartPatch(null, "2025-03-31", "20250401"), { from_date: "2025-04-01" });                        // openings date kept
assert.equal(bookStartPatch("2024-04-01", null, "20250401"), null);                                                    // has a start
for (const f of [undefined, null, "", "2025040", "202504011", "20250230", "20251301", "18990101", 20250401, "abcdefgh"])
  assert.equal(bookStartPatch(null, null, f), null, String(f));
// round 1: the keep copy from 1-Apr-2026 (state.from), older entries from 2-Apr-2025: the first entry, never the later day
assert.deepEqual(startDecision({ fromDate: "", stateFrom: "20260401", firstVoucher: "2025-04-02", firstDay: "2025-04-03" }),
  { kind: "set", patch: { from_date: "2025-04-02", open_as_on: "2025-04-01" } });
assert.deepEqual(startDecision({ fromDate: null }), { kind: "none", known: "" });
// B2: never a ledger round's openingsAt (Tally's BOOKSFROM years before the entries), whether or not it is earlier
assert.deepEqual(startDecision({ fromDate: null, stateFrom: "20260401", openingsAt: "20190401" }),
  { kind: "set", patch: { from_date: "2026-04-01", open_as_on: "2026-03-31" } });
assert.deepEqual(startDecision({ fromDate: null, openingsAt: "20190401" }), { kind: "none", known: "" });
assert.deepEqual(startDecision({ fromDate: null, firstVoucher: "2025-06-01", openingsAt: "20250701" }).patch, { from_date: "2025-06-01", open_as_on: "2025-05-31" });

// ---- B1: a chosen older period counts by the first day Tally COUNTED entries on, never its 1 April / 1 October
// (a mid-year Tally company, books from 15-Jul-2025: its first counted day is on or after it)
assert.equal(earliestKnown({ stateFrom: "20260401", firstCounted: "2025-07-15" }), "20250715");
assert.deepEqual(startDecision({ fromDate: "2026-04-01", stateFrom: "20260401", firstCounted: "2025-07-15", gapPending: false }).move,
  { from_date: "2025-07-15", open_as_on: "2025-07-14", was: "2026-04-01" });
assert.equal(earliestKnown({ stateFrom: "20260401" }), "20260401");   // a period chosen, nothing counted yet: nothing earlier

// ---- a book WITH a start: moved earlier only, never later
assert.equal(bookStartEarlier("2025-04-01", "20260401"), null);
assert.equal(bookStartEarlier("2025-04-01", "2025-04-01"), null);
assert.equal(bookStartEarlier("2025-04-01", ""), null);
assert.equal(bookStartEarlier(null, "20250401"), null);
assert.deepEqual(bookStartEarlier("20250401", "20240229"), { from_date: "2024-02-29", open_as_on: "2024-02-28", was: "2025-04-01" });
// a later day (the keep copy moving on) never moves it
assert.deepEqual(startDecision({ fromDate: "2025-04-01", stateFrom: "20260401", firstVoucher: "2025-04-01", day: "20260402", gapPending: false }), { kind: "none", known: "20250401" });
// "Bring another year" after the start was set, Tally counting it (newest first), days still to fetch: the day is WANTED
// (booksFromFor answers it), the start not moved yet
const counting = { fromDate: "2026-04-01", stateFrom: "20260401", firstVoucher: "2026-04-01", firstCounted: "2025-04-02", gapPending: true, gapUncounted: false };
assert.deepEqual(startDecision(counting), { kind: "wait", want: "20250402" });
assert.deepEqual(startDecision({ ...counting, gapPending: undefined }), { kind: "wait", want: "20250402" });   // not known: wait
// round 3 should-fix: Tally still counting days between (tally_n null; newest first, an earlier day may turn up): nothing
// wanted yet (no ledger round restarted for each new earliest day); not known: nothing wanted either
assert.deepEqual(startDecision({ ...counting, gapUncounted: true }), { kind: "wait", want: "" });
assert.deepEqual(startDecision({ ...counting, gapUncounted: undefined }), { kind: "wait", want: "" });
// the bridge's ledger round dated that day: moved at once, with the round's openings (before the round is taken)
assert.deepEqual(startDecision({ ...counting, openingsAt: "20250402" }), { kind: "move", move: { from_date: "2025-04-02", open_as_on: "2025-04-01", was: "2026-04-01" }, withRound: true });
// a round dated another day (Tally's BOOKSFROM, the old start): never moves it with the round
assert.equal(startDecision({ ...counting, openingsAt: "20240401" }).kind, "wait");
assert.equal(startDecision({ ...counting, openingsAt: "20260401" }).kind, "wait");
// the days between all fetched: moved (its openings still as at the old start: the bell)
assert.deepEqual(startDecision({ ...counting, gapPending: false }), { kind: "move", move: { from_date: "2025-04-02", open_as_on: "2025-04-01", was: "2026-04-01" }, withRound: false });
// entries earlier than the start arrive (the day just stored), no period days between: moved
assert.deepEqual(startDecision({ fromDate: "2026-04-01", stateFrom: "20260401", firstVoucher: "2025-12-01", day: "20251115", gapPending: false }).move,
  { from_date: "2025-11-15", open_as_on: "2025-11-14", was: "2026-04-01" });

// ---- round 3 blocker: the memo never swallows a ledger round dated the wanted day
const t0 = Date.UTC(2026, 10, 8, 6, 0);
const warm = { from: "20260401", want: "20250402", t: t0 - 60000 };
assert.equal(memoAnswers(warm, { openingsAt: "20250402" }, t0), false);           // looks: the round dated the wanted day
assert.deepEqual(startDecision({ ...counting, openingsAt: "20250402" }).withRound, true);   // ... and moves with the round
assert.equal(memoAnswers(warm, { openingsAt: "20240401" }, t0), false);           // a round dated another day: looks too
assert.equal(memoAnswers(warm, { openingsAt: "20260401" }, t0), true);            // dated the start: nothing new
assert.equal(memoAnswers(warm, {}, t0), true);
assert.equal(memoAnswers(warm, { stateFrom: "20260401" }, t0), true);
assert.equal(memoAnswers(warm, { day: "20250601" }, t0), true);                    // a day already within the wanted span
assert.equal(memoAnswers(warm, { day: "20250301" }, t0), false);                   // a day before the wanted one: looks
assert.equal(memoAnswers({ from: "20260401", want: "", t: t0 - 60000 }, { day: "20251201" }, t0), false);   // before the start
assert.equal(memoAnswers({ from: "20260401", want: "", t: t0 - 60000 }, { day: "20260501" }, t0), true);
assert.equal(memoAnswers({ ...warm, t: t0 - 301000 }, {}, t0), false);           // stale: looks
assert.equal(memoAnswers(null, {}, t0), false);
// a book with no start: a day or a reported start looks; a round's openingsAt alone never does (B2)
const bare = { from: "", want: "", t: t0 - 60000 };
assert.equal(memoAnswers(bare, { openingsAt: "20190401" }, t0), true);
assert.equal(memoAnswers(bare, { day: "20250402" }, t0), false);
assert.equal(memoAnswers(bare, { stateFrom: "20260401" }, t0), false);

// ---- booksFromFor's day: the wanted earlier day, else the start; never a later "want"
assert.equal(booksFromDay("2026-04-01", "20250402"), "20250402");
assert.equal(booksFromDay("2026-04-01", ""), "20260401");
assert.equal(booksFromDay("2026-04-01", "20270401"), "20260401");
assert.equal(booksFromDay("2026-04-01", "bad"), "20260401");
assert.equal(booksFromDay("", "20250402"), "");

// ---- the bell, India's day, the one-a-day key
const w = movedWords("ZZ TEST", bookStartEarlier("2026-04-01", "20250401"));
assert.match(w, /^ZZ TEST: the books in FinCom now begin on 1-Apr-2025 \(older entries brought in; they began on 1-Apr-2026\)\./);
assert.match(w, /opening balances held are still as at 1-Apr-2026, not 1-Apr-2025/);
assert.match(movedWords("", bookStartEarlier("2026-04-01", "20251130")), /^the books in FinCom now begin on 30-Nov-2025/);
assert.equal(istDay(Date.UTC(2026, 10, 7, 18, 29)), "2026-11-07");
assert.equal(istDay(Date.UTC(2026, 10, 7, 18, 31)), "2026-11-08");
assert.equal(uuidOfHex("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"), "01234567-89ab-cdef-0123-456789abcdef");
assert.equal(earliestDay(["20260401", "2025-04-03", null, "", "bad"]), "20250403");
assert.equal(earliestDay(null), "");
assert.equal(dayOf("2025-04-01T00:00:00+00:00"), "20250401");
assert.equal(realDay("20250229"), false);
assert.equal(realDay("20240229"), true);
console.log("bookstart_test: ok");
