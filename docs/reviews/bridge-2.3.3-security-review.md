# Security review: FinCom Bridge 2.3.3 (a High in 2.3.2: a new save unsent behind the held backlog)

Reviewed: 07-Oct-2026, alongside the code review of the same range (bridge-2.3.3-code-review.md), an adversarial
self-review by the author from the diff.

Range: b1e5858..cd5afb7

Read with `git diff b1e5858 cd5afb7 -- bridge-go/ tests/ server/ docs/tally-allowlist.md`.

## What 2.3.3 does

Every save reaches FinCom within seconds, at least held with a plain reason. A held line is asked of Tally again once,
then ends with the Day Book words. Nothing is sent to a Tally still working on a request the bridge stopped waiting for.
A company slow on every entry is marked even when only its entries are being asked. The heartbeat says what waits.

## What holds

- **No Tally request added or changed.** The allow-list table and its hash are unchanged (`TestAllowListUnchanged`,
  1c17806d...); only the decision line names 2.3.3 under the owner's standing decision. 2.3.3 sends fewer requests (one
  per held line instead of up to 20, none into a busy Tally) and changes only their order (the small check may take a try
  after an entry stop). Nothing asks Tally to compute a figure. No new host, port or file outside the sync folder.
- **The books stay right.** A line held at once goes with no body and no GUID (it never had Tally's GUID: the line's own
  is never trusted, 2.2.2); the cloud holds it and never applies it by itself. Its entry is applied only from Tally's own
  answer, sent as `:resolved`, checked as before (`liveVoucherWrong`: the GUID is Tally's own, above the starting point,
  the line's type, date and number). The cloud applies it once (applied_once) and replaces the held row; verified on
  the stand cloud with the real migrations (`tests/run_recorder_server.py` 2.3.3).
- **A delete or cancel is never sent unproven.** One whose GUID ask is not answered goes held as one this Tally could not
  be asked about (`liveGuidUnproven`, guidHeld), as in 2.3.0's review H1.
- **One request in flight per Tally.** The abandoned exchange runs on its own goroutine bounded by TallyAbandonMaxSec
  (600 s); its answer is read and discarded, never parsed or used; the lock is released when it ends. A posting waits
  (bounded by the same 600 s), says so in plain words, and is not lost (next-inflight's tests).
- **Each bridge on its own Windows user's Tally only.** Unchanged. The held file and the words are this bridge's own.
- **What leaves the computer.** The new words (heldWhy, up to 300 characters as before) name the reason and a time; the
  beat's recorderWaitWords (300 characters, cut by the bridge and the cloud) and recorderState.heldAsking (a count) name
  the company, as the beat already did. No secret, path or Tally data in them.
- **No cloud change, no migration.**

## Lows

- S-L1. A Tally that never answers an abandoned request holds the lock for up to 10 minutes; postings wait that long at
  most (said in plain words on the posting and the Tally page). Bounded; the owner's rule prefers it to piling up.
- S-L2. The held file now carries `allow`, `asked` and `fresh` per line; a hand-edited file could give a line one more ask
  (`allow` is read as 2 at most), still one request, still checked as above. The file is in the bridge's own user's folder.
