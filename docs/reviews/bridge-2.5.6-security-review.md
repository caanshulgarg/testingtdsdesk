# Security review: FinCom Bridge 2.5.6

Reviewers: the independent review session (the coordinator's), on c0e9896ed; the code findings are in
bridge-2.5.6-code-review.md. Verdict: ship.

Range: bcf70d9fb..a219bdee9 (2.5.5's release head to the code commit; the bridge's part is c0e9896ed and a219bdee9, the
rest is staging-next merged in after 2.5.5, reviewed on its own)

## Requests to Tally

- None added and none changed (TestAllowListUnchanged; docs/tally-allowlist.md's words only, allowed for 2.5.6 by the
  owner's standing decision of 2026-10-06). Every request still goes through the one gate (invokeTally), with postings
  first at the lock.
- The change only lets the ledger read run while a posting waits for Tally. A posting being started or sent still holds
  it, so a posting never shares Tally with a background read while it writes.

## Data and the cloud

- Nothing new is sent to the cloud and nothing new is kept on the computer. keepWait "posting" is now said only while a
  posting is going; the words are 2.5.5's fixed sentences.

## Updates, signatures, tally.ini, the installer

- Not touched in this range.

## Verdict

Ship, as far as security goes. The known item to watch (a waiting job's company asks cutting off ledger requests in
flight) is availability only; it is in the code review.
