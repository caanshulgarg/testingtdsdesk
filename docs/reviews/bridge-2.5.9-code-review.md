# Code review: FinCom Bridge 2.5.9 (the fast read measured on ZZ TEST from the tray)

Reviewers: the session that built it (a self-review against the owner's rules), then two independent review rounds
(the coordinator's) on next-fast-measure: round 1 at bca62f92d, "nothing blocks in code", six fixes asked (one medium,
five low), all made with tests in ce342c9c1; round 2 at ce342c9c1, "nothing blocks". After round 2 only two commits
touched code: e3bcf95fe merges origin/staging-next 4e10e8d0c (bridge 2.5.8, released and signed) with two conflicts,
both outside bridge-go (docs/MIGRATION-ORDER.md: 146 and 148 both kept; server/tally-cloud/index.ts: both branches'
imports kept), and bf1da6fe5 raises the version to 2.5.9 (the version tests, the stock row's words, the allow-list's
decision and dated lines, the table hash, the fixtures). Those two are the building session's self-review only.

Range: 4e10e8d0c..bf1da6fe5 (released 2.5.8 to the version bump; the feature is 67646b38d..ce342c9c1, merged with 2.5.8 at
e3bcf95fe)

(bridge-go/: fastmeasure.go and fastmeasure_test.go (new); win_tallyver.go (new, Windows: tally.exe's file version);
win_tray.go (item 27, its words from fastmeasure.go); server.go (/tray/fastmeasure, a person's only; the dated guard's
exception fastMeasureExact); allowlist.go (allowedEntry: FastEntries' two window requests only while a measurement
runs); fastentries.go (fastExactWith: the same exactness rules with the switch given); platform_other.go;
rebuilt_test.go (the stand cloud takes kind fast_measure). server/tally-cloud: fastmeasure.js (new: the upload cleaned,
the pass decided again), index.ts (tally-ingest kind fast_measure), migration-148-fast-measure.sql (new, not applied).
app: lib/fastMeasure.js and parts/FastMeasure.jsx (new), screens/Tally.jsx (the panel under Advanced). tests:
run_migration148.py, fast_measure_page_test.mjs, fastmeasure_test.mjs (new), run_tally_simple.py. docs:
fast-entries-measure-steps.md (new), fast-entries-design.md section 9b. The version 2.5.9 everywhere it is named.)

## What 2.5.9 adds

A tray item, "Measure the fast read (ZZ TEST only)". Before FastEntries (2.5.7, off by default) may be switched on for a
computer, its two window requests (FinComWindowHeads, FinComVoucherWindow; 2.5.7's shapes, unchanged) are timed on that
computer's own TallyPrime, on a company named exactly ZZ TEST open alone. FastEntries itself stays off; nothing about
the normal read changes.

1. Refused unless: exactly one company is open in this bridge's own Tally and its name, as Tally gives it, is exactly
   "ZZ TEST" ("ZZ TEST" with "zz test" open is two companies, refused); FastEntries is off; ZZ TEST's starting point is
   recorded; the bridge holds its Tally GUID; Tally's window can be watched (else the 1 s stop could not see it).
2. The plan (section 9b scaled to one company), one request at a time: find the busiest day (W1 over 7-day windows back
   from today, at most 53); W1 windows of 2, 7, 14 and 31 days ending at it; W2 groups of 10, 50 and 100 entries over 1,
   3 and 7 days, each group's entries then asked one by one with FinComVoucherObject and compared as FinCom keeps them
   (50 at most in all).
3. Before every request: the period read's six conditions (pullMayAsk: postings first, nobody typing in Tally, ...),
   waited for 2 minutes at most, and ZZ TEST still open alone (the open list re-checked).
4. Stops: each request at 2 s; the run at the first request over 2 s, a window hold of 1 s or more (counted from the
   step's start, the pause between a step's two requests included), a request Tally's window could not be watched
   for, another company open, or Tally not free for 2 minutes.
5. The upload (tally-ingest kind fast_measure, company "ZZ TEST" and its GUID): per request its kind, days, rows,
   Tally's time and the longest window hold; for W2 the counts same / different / left and the NAMES of the fields
   that differed; TallyPrime's version and the bridge's; why a run stopped in fixed words. No entry data (no GUID,
   number, date of an entry, party, ledger, amount or narration) and none of Tally's or the period read's own text
   (those details are in this computer's log only).
6. The cloud keeps it only for ZZ TEST, linked, from the computer that named it in its own heartbeat, its GUID the
   book's; cleaned to the fields above; the pass decided again (worst under 1.5 s, every hold under 1 s, at least one
   entry compared and all the same, the plan run to its end and watched). The Tally page shows the runs under Advanced
   (for support), read only, only when one was sent.

## The owner's rules, checked

- No request added to the list and no request shape changed (TestAllowListUnchanged; the table's rows are 2.5.8's, the
  stock row's words aside). The measurement's own requests are 2.5.7's, sent only while a person's run lasts, only for
  ZZ TEST, through the one gate (invokeTally) and the dated guard's exact-request check.
- 2 s at most: each request stopped at 2 s (the recorder's TC, limitMs 2000); the run stops at the first one over.
- One in flight: one request at a time; one measurement at a time (running).
- Postings first and never while someone types: pullMayAsk before every request.
- Started by a person only: the tray; a web page (any Origin or Sec-Fetch header), FinCom's own included, is refused.
- Nothing written to Tally. No AI anywhere in this.

## Round 1 (at bca62f92d), fixed in ce342c9c1 (each with a test)

1. (medium) The step sheet offered restoring a backup of the biggest client as ZZ TEST (linked, it would upload a real
   client's entries and carry its real GUID): removed; a new, empty ZZ TEST filled only with the trial tool's TRIAL
   entries.
2. pullMayAsk's free-text reason (it can name another company's entry dates) was uploaded: fixed words now, the reason
   in the log only (TestFastMeasureStopFixedWords).
3. A run could go on with Tally's window unwatched (hold -1): refused at the start, and stopped at the first unwatched
   request (TestFastMeasureNeverUnwatched).
4. "Open alone" compared companyKey-folded names: raw names now, re-checked before every request
   (TestFastMeasureAloneByRawNames).
5. The hold of a two-request step left out the pause between them: counted from the step's start
   (TestFastMeasureHoldFromStepStart).
6. A doubled comment on an import line in index.ts: fixed.

## Round 2 (at ce342c9c1)

Nothing blocks.

## The merge with 2.5.8 and the version (self-review)

- e3bcf95fe: git merged every bridge-go file by itself; 2.5.8's checkAllowed (its measureOnly rule) and this branch's
  allowedEntry sit together (allowedEntry only widens the lookup while a measurement runs; measureOnly applies after
  it as before). The two conflicts were docs and imports only. go vet (Linux, Windows) clean after the merge.
- bf1da6fe5: the version 2.5.9; nothing else in code.
