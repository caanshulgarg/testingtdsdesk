# Security review: FinCom Bridge 2.5.8

Reviewer: the session that built it (a self-review); the code findings are in bridge-2.5.8-code-review.md. No
independent review session has looked at this range yet: one is to be done before the publish.

Range: 67646b38d..04938e593 (staging-next with 2.5.7 merged, to the version commit)

## Requests to Tally

- None added and none changed; the table is 2.5.7's (allowed for 2.5.8 by the owner's standing decision of
  2026-10-06). Only TDSDeskCompanies is asked sooner, through the one gate (invokeTally), under the 2 s cap, postings
  first, never while someone is typing in Tally.
- Check again asks Tally only through /status?fresh=1, which needs this browser's bridge key and this Windows user's
  own browser (as before); /ping (no key) asks nothing of Tally. A browser not on the Tally computer has no key for a
  bridge here: nothing new is asked of anything.

## Data and the cloud

- The beat's ports carry two small fields: askedAt (a local time) and list (one of four words). No company data. The
  cloud keeps them only in that form (a time of the bridge's shape, a known word) and drops anything else.
- Nothing new is kept on the computer (the answers are noted in memory only).

## Updates, signatures, tally.ini, the installer

- Not touched in this range.

## Verdict

Ship, as far as security goes, after an independent review session agrees.
