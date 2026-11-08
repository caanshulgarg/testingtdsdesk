# Security review: FinCom Bridge 2.5.9

Reviewers: the session that built it, then two independent review rounds on next-fast-measure: round 1 at bca62f92d
("nothing blocks in code"; its six fixes, two of them about what is uploaded, made in ce342c9c1), round 2 at ce342c9c1
("nothing blocks"). The merge of 2.5.8 (e3bcf95fe) and the version bump (bf1da6fe5) are the building session's self-review
only (bridge-2.5.9-code-review.md).

Range: 4e10e8d0c..bf1da6fe5 (released 2.5.8 to the version bump)

## Requests to Tally

- None added to the list and none changed; the table's rows are 2.5.8's (allowed for 2.5.9 by the owner's standing
  decision of 2026-10-06). FastEntries' two window requests (2.5.7's shapes) and FinComVoucherObject are sent only
  during a person's run of the tray's "Measure the fast read (ZZ TEST only)", only for the company named exactly ZZ
  TEST open alone, through the one gate and the dated guard's exact-request check; outside a run they are refused as
  before (TestFastMeasurePlanPasses checks the list after a run).
- /tray/fastmeasure is refused to any web page (Origin or Sec-Fetch headers), FinCom's own included
  (TestFastMeasureTrayOnly). Nothing is written to Tally.

## Data and the cloud

- Uploaded: times, counts, field NAMES, TallyPrime's and the bridge's versions, and fixed words for why a run stopped.
  No entry data and none of Tally's own text (TestFastMeasureNoEntryData, TestFastMeasureInexactNoEntryData,
  TestFastMeasureStopFixedWords); another company's name never (TestFastMeasureAloneByRawNames).
- The step sheet no longer suggests a restored client backup as ZZ TEST (round 1, item 1): only TRIAL entries in a new
  company.
- tally-ingest keeps a run only for ZZ TEST, linked, from the computer that named it in its own heartbeat, with the
  book's GUID, rate-limited per computer; cleaned to the known fields (fastmeasure.js). Migration 148: one new table,
  members read their own firm's rows only, no member writes, anon nothing (run_migration148.py). Not applied yet.

## Updates, signatures, tally.ini, the installer

- Not touched in this range.

## Verdict

Ship, as far as security goes.
