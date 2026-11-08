# Security review: FinCom Bridge 2.5.7

Reviewers: the independent review session (the coordinator's), two rounds on next-fast-entries (0de692f49, c9b3673fa);
the code findings are in bridge-2.5.7-code-review.md. Verdict: ship with FastEntries OFF.

Range: 9bad8676c..7357e3e36 (2.5.6's release head to the version commit)

## Requests to Tally

- With FastEntries off (the default): none added and none changed; the table is 2.5.6's (allowed for 2.5.7 by the
  owner's standing decision of 2026-10-06). FinComWindowHeads and FinComVoucherWindow are refused as not on the list,
  and the dated guard refuses them too unless the switch is on and exactly that request is being asked, under the 2 s
  stop, for a company with a starting point. Every request still goes through the one gate (invokeTally), postings first.
- With the switch on (not to be done before section 9b's measurement): both are pinned to their builders, FETCH frozen
  by SHA-256 (FinComVoucherBatch's), no computed figure, no Day Book.

## Data and the cloud

- Off: nothing new is sent to the cloud and nothing new is kept on the computer.
- On: the beat carries periodPull.fast (sizes, a count, the speed per company with its GUID); the cloud keeps a speed
  only for the book whose recorded company GUID is the bridge's; fast-entries.json (sizes) is kept in the sync folder.
  No entry data in either.

## Updates, signatures, tally.ini, the installer

- Not touched in this range.

## Verdict

Ship, as far as security goes.
