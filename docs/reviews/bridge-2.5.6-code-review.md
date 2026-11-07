# Code review: FinCom Bridge 2.5.6 (Update now's run waits only for a posting going)

Reviewers: an independent review session (the coordinator's), on c0e9896ed (1512ca3ae cherry-picked onto staging-next
0cd4c392f), reading the code and the test. Verdict: ship.

Range: bcf70d9fb..a219bdee9 (2.5.5's release head to the code commit)

(bridge-go/: keep.go and its test firstread_test.go (c0e9896ed), and the version 2.5.6 everywhere it is named
(a219bdee9: util.go, the version tests, allowlist.go's stock row words, docs/tally-allowlist.md, the beat and recorder
fixtures). The rest of the range is staging-next merged in after 2.5.5 (tally-ingest v77, Corporate e-Forms), reviewed
on its own.)

## What 2.5.6 changes

1. keep.go keepWorker: the run's posting gate asks postingGoing() (a posting whose worker is alive and is starting or
   sending), as every other reader of Tally does (the older-entries day read, the recorder, stock, bank), instead of
   activeJobs() (every job folder queued, waiting, running or interrupted in the last 12 hours). Found on staging on
   07-Nov-2026 with 2.5.5: Update now never read a linked company open in Tally. Its run waited with keepWait "posting"
   behind a posting that was only waiting for Tally, for another company the cloud had failed days before.
2. BridgeVersion 2.5.6.

## What was checked and holds

- A posting being started or sent still holds the run (keepWait "posting", the cloud pushed meanwhile); the read
  still gives way to a posting at the lock (enterTallyLock), as before.
- A posting waiting for Tally, or stopped part-way, no longer holds the ledger read. It does not need Tally to itself
  while it waits: it writes nothing to Tally until its company is found open, and then goes first at the lock.
- No new request to Tally and no request shape changed (TestAllowListUnchanged; the table hash moves with the stock
  row's words only).

## Tests

- firstread_test.go: TestWaitingPostingDoesNotHoldFirstRead fails on bcf70d9fb ("a posting waiting for another company
  holds the first read of an open company", keepWait posting) and passes after; TestPostingGoingStillHoldsTheRead passes
  on both.
- go vet (Linux, Windows) and go test ./... at a219bdee9; tests/run_tally_basics.py; release-check.sh.

## Verdict

Ship.

## Known, to watch (the review's follow-up)

- A waiting job still asks Tally which companies are open every 15-60 s (jobs.go:519 waitTally, findCompanyNow, to
  ports.go:878 findCompanyIn with a fresh list), and each ask cuts off a ledger request in flight (a posting's request
  goes first at the lock). With 2.5.6 the ledger read runs beside such a job, so on a computer with a posting waiting
  for a company that is not open, the ledger round's requests can be cut off that often. The round goes on from where
  it was (errPreempted: the same chunk again), so nothing is lost, but the round is slower. Not changed in 2.5.6;
  watch the round's times and the "paused for FinCom's request" lines on staging.
