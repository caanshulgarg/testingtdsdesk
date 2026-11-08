# Security review: FinCom Bridge 2.5.8

Reviewers: the session that built it, then an independent review session at d633d28d3 (its findings 1-5, none about
security, fixed in f4f1c1c99; round 2's, none about security either, fixed in ef6e15406; bridge-2.5.8-code-review.md).
The round-2 fixes are not re-reviewed yet.

Range: 67646b38d..ef6e15406 (staging-next with 2.5.7 merged, to the round-2 fixes)

## Requests to Tally

- None added and none changed; the table is 2.5.7's (allowed for 2.5.8 by the owner's standing decision of
  2026-10-06). Only TDSDeskCompanies is asked sooner, through the one gate (invokeTally), under the 2 s cap, postings
  first, never while someone is typing in Tally.
- Check again asks Tally only through /status?fresh=1, which needs this browser's bridge key and this Windows user's
  own browser (as before); /ping (no key) asks nothing of Tally. A browser not on the Tally computer has no key for a
  bridge here: nothing new is asked of anything.

## Data and the cloud

- The beat's ports carry two small fields: askedAt (a local time) and list (one of five words). No company data. The
  cloud keeps them only in that form (a time of the bridge's shape, a known word) and drops anything else.
- Nothing new is kept on the computer (the answers are noted in memory only).

## Updates, signatures, tally.ini, the installer

- Not touched in this range.

## Verdict

Ship, as far as security goes, once the independent review session has looked at ef6e15406.
