# Review 249, round 4: the fixes of round 3 (FinComVoucherBatch)

Reviewer: an independent Claude session (did not write this code)
Date: 2026-10-29
Branch reviewed: next-bridge-249 at e16baaf86
Earlier round: review-249-round3 (docs/reviews/review-249-round3.md: M1, L1-L5)

High: 0, Medium: 0, Low: 2

What was run (at e16baaf86, linux/amd64):
- `cd bridge-go && flock /tmp/fincom-app.lock go test -count=1 -run 'R249' .`: ok (103.8 s).
- `flock /tmp/fincom-app.lock go test -race -count=2 -run 'R249' .`: ok (379.2 s).
- `flock /tmp/fincom-app.lock go test -race -count=10 -run 'TestR249R1WindowWatchedAfterAStop$|TestR249R1StoppedGroupNotFinishedStopsCompany|TestR249R3StopWithAbandonZero' .`: ok (223.4 s).
- `go vet .` and `GOOS=windows go vet .`: clean.

No code was changed.

## Code review

Range: e65d62471..e16baaf86

Files: bridge-go/batch249.go (pullBatchCoKey, pullAwaitBound, pullAwaitEarlier, pullBatchStep), r249round3_test.go (new),
r249round1_test.go, r249batch_test.go, docs/bridge-2.4.9-notes.md, docs/bridge-2.4.9-test-sheet.txt.

### Round 3 findings

- **M1 (Medium): Fixed.** batch249.go:511: `unfinished = abandonMax() <= 0 || !pullAwaitEarlier(...)`, so with
  TallyAbandonMaxSec 0 a stopped group stops the company ("over2s"), as 2.4.8 did. The window check still comes first in
  the switch, so a hold of 2 s still reads "window". TestR249R3StopWithAbandonZeroStopsCompany asserts one group and one
  "over2s" stop. The shipped default stays 600 (inflight.go:34); the test stands default to 0 (events_test.go:132), which
  is why the halving tests now pass `"TallyAbandonMaxSec":600` explicitly. That is correct, not a weakening.
- **L1 (Low): Fixed.** batch249.go:472-477: on a FETCH mismatch the day goes one by one (w.oneByOne), logged once.
  TestR249R3FetchMismatchOneByOne asserts 0 groups, 4 FinComVoucherObject reads, 4 sent. Notes point 7 now match.
- **L2 (Low): Fixed in effect.** r3Settle waits for the abandoned slot, then takes retryMu. `-race` is clean (above).
  The ordering still rests on a 300 ms sleep: see N1.
- **L3 (Low): Fixed.** pullAwaitBound caps the wait at 60 s, and the loop leaves when the bridge stops
  (pullStoppingFn). A wait longer than 60 s ends as "over2s", the safe side. Returning true while stopping lets the
  halving branch run and record a smaller size in memory; the bridge is stopping, so this is harmless. TestR249R3AwaitBounded
  covers both.
- **L4 (Low): Fixed.** The key now carries it.ChosenAt (batch249.go:416); a new choice starts at 100 again.
  TestR249R3SlowSizeEndsWithAnotherChoice covers it. Entries for old choices are never removed; bounded by the number of
  choices, so not rated.
- **L5 (Low): Note.** Unchanged in code, as allowed; notes point 8 records it as a known limit, and
  TestR249R3NoNatureLineAsGate pins the current rule. The note overstates the evidence: see N2.

Round 3 also noted R1-12 missing from the notes: now in point 4. Closed.

### New findings

#### N1 (Low): r3Settle orders the test's cleanup after retryLift by a sleep, not by a happens-before

bridge-go/r249round3_test.go:14-21, tally.go:972-981, retry.go:155-161.

Taking and releasing retryMu orders the cleanup after retryLift only if retryLift already took the lock. If its goroutine
has not been scheduled within the 300 ms (a loaded runner under `-race`), r3Settle locks first and the cleanup's write of
nowFn can still race retryLift's read. Clean here in every run, so this is a flake risk, not a failure.

Suggested fix: a test hook on the goroutine at tally.go:972 (a sync.WaitGroup the tests Wait on), or retryLift reading
the clock through a value captured before the goroutine starts.

Suggested test: `go test -race -count=50 -cpu 1 -run 'TestR249R1WindowWatchedAfterAStop$' .` under CPU load passes.

#### N2 (Low, docs): the L5 note and the test sheet claim more than the data and the code keep

docs/bridge-2.4.9-notes.md:78-80, docs/bridge-2.4.9-test-sheet.txt R3.

- Notes point 8 says the gate's data covers "every entry ... on all five releases". The field-by-field data in the repo
  is bdiff run 40815068422 on 7.1 and 3.0 only (notes line 53, testdata/batch249/SOURCE.txt). The L5 rule applies on
  3.0 .. 6.2, so 4.1, 5.1 and 6.2 have no such evidence.
- Test sheet R3 says entries with a GST sales or purchase line on 3.0 .. 6.2 are read one by one "exactly as 2.4.8".
  A GST line the group gives with no nature and no taxability is taken from the group (batch249.go:241; L5).

Suggested fix: point 8 to say "on 3.0 and 7.1 (bdiff run 40815068422)", or commit the 4.1/5.1/6.2 bdiff answers; R3 to
say "a GST line Tally names a nature or taxability for".

Suggested test: none in code; the bdiff gate on 4.1, 5.1 and 6.2 with its answers kept as testdata, run through
TestR249R1GateAnswersAsObject.

## Security review

Range: e65d62471..e16baaf86

- **Request shapes:** unchanged. No builder added; TestR249RequestAsApproved passes; a FETCH mismatch now builds no group
  and falls back to the existing FinComVoucherObject request (L1), never a wider one.
- **Freeze safety:** M1 fixed: under TallyAbandonMaxSec 0 a stop ends the company's period. At 600 the window is watched
  as in round 3. The 60 s cap (L3) can only end a period earlier, never send sooner.
- **Integrity:** no change to what is taken from a group. L5 stays a documented Low; N2 is its wording.
- **Availability:** L1 (stall) and L3 (stop of the bridge held) fixed.
- **Concurrency:** pullStoppingFn is a test seam read on the period loop only; production never writes it. N1 is
  test-only.
- **Logs and secrets:** the one new log line (fetchtext) carries no company data or secret.
- **Nothing new sent outside.**

Security findings: none new (N1 and N2 are test and docs only).

## Verdict

High: 0, Medium: 0, Low: 2

Every round 3 finding is fixed, or (L5) noted. Before the gate: correct the wording of notes point 8 and test sheet R3
(N2). N1 can follow.
