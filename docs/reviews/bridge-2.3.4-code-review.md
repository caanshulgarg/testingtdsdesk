# Code review: FinCom Bridge 2.3.4 (the fast entry request, FinComVoucherObject)

Reviewed: 08-Oct-2026, an adversarial self-review by the author from the diff (the coordinator runs an independent
review). Read with `git diff 27e5da8 5257fad -- bridge-go/ server/ tests/ docs/tally-allowlist.md`.

Range: 27e5da8..1036026

## What 2.3.4 does

- The entry request is Tally's object export of ONE voucher by its MasterID (`fastvch.go` voucherObjectRequest), keyed:
  9-23 ms median at 4,000 to 100,000 vouchers on 3.0 .. 7.1 (push-design 37718386662), where FinComVoucherByMaster scanned
  the company (0.36-17.7 s). FinComVoucherByMaster is gone (no builder, no id, no row; `TestFast234NoOldRequest`).
- Tally sends the whole voucher; `fastStripVoucher` keeps exactly the 61 approved fields (`liveFetchField`, the one place;
  the 13 approved on 08-Oct listed in `liveFetchApproved0810`) with LEDGERENTRIES.LIST read as ALLLEDGERENTRIES.LIST, in
  `fetchVouchersByMasterIn`, the one place every caller (entry fetch, held lines, cancel / delete check, posting check)
  gets the voucher from. parse.js reads it as today's answer and FinCom stores the same rows (real captures of five
  releases: `tests/run_parse_fast234.mjs`, `tests/run_fast234_store.py`).
- Only FinComVoucherObject's stops count toward the slow mark (`slowco.go`); by-number lines are neutral.
- Held lines 2.3.3 ended get one fresh ask (`FastAgain`, `*.fast.txt`); ended and fresh-ask ids kept 31 days; the
  cloud lists slow-ended lines for 30 days (`heldOwnLines`, no migration).
- The trial forms A and C removed (the tray item keeps B, D, E, F); a person's request gets no exception for the entry
  request any more.

## Checked

- **One entry, read only, as built.** The request is built only for a MasterID of 1-18 digits, not all zeros, and the
  company escaped; `checkAllowed` refuses anything not byte for byte the builder's (the pin), so another field, id,
  object type or a missing FETCHLIST never goes (`TestFast234RefusesFormsThatFreezeTally`). The guard (ReadDays off)
  passes it only for a company with a starting point (`voucherObjectExact`), as before.
- **Nothing unapproved leaves the fetch.** `fetchVouchersByMasterIn` strips each voucher before building the map; the
  raw answer is never logged (only its first 120 characters when it is not an ENVELOPE at all, as before) or kept.
  `TestFast234StripCaptures` asserts every kept leaf is an approved path on all ten real captures.
- **Taking the voucher.** `liveVoucherWrong` reads GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER: all
  approved, all kept. The object export carries no period: the line's date is checked on the answer as before.
- **Ask once.** A FastAgain line: done once its one fresh ask reached Tally (`liveFastAskedNote` when `reached`), or its
  ":resolved" waits; ended by this version: never again (`liveEndedNote` notes it too). Restarts: the files.
- **One request in flight, held at once, 10-second rule:** unchanged code paths (2.3.3's tests pass unchanged except
  where they named the old request's bytes).

## Findings (no High or Medium)

- **L1. Larger answers.** The object answer is 3-7 times the old one (60-150 kB for these vouchers; 1.3 MB for a 50-item
  invoice in run 37591395905). Tally's answer is read whole (as before, no cap); memory is transient and the strip is
  linear. Kept.
- **L2. The strip's reader is a tag scanner, not a full XML parser.** CDATA and comments are not handled (none seen in
  ten captures of five releases). A voucher it cannot read gives "" (no body: the line is held, never sent with other
  data). Kept.
- **L3. Both ledger lists present.** When an answer has ALLLEDGERENTRIES with lines, LEDGERENTRIES is dropped. Not seen
  for sales invoices or receipts; untested on real Tally for TDS journals, credit notes, godown / batch invoices,
  payroll. A body whose lines do not total zero is held by the cloud's balance guard (never applied in part). For the
  next build: real captures of those types.
- **L4. Lines with no MasterID** (2 of 82 on staging in 30 days) still scan by number: up to two scans each on a large
  company (one try, one ask again), each stopped at 2 s while Tally finishes it (the one-in-flight rule waits). Kept by
  the coordinator's decision.
- **L5. The 30-day list matches the bridge's words.** `SLOW_END_WORDS` in index.ts must follow `slowWords` and
  `liveHeldSlowGiveUp` if they ever change (both pinned by tests on each side).

## After the independent review (08-Oct-2026), range 73079b4..1036026

The independent review of 27e5da8..73079b4 found M1-M3 and L1-L6; each was fixed test first (red, then green) and the
range above now ends at 1036026 (the merge of tax-accuracy's 08-Oct docs commit):
- M1: tally-ingest lists the 7-30-day slow-ended lines only to a bridge of 2.3.4 or later (run_recorder_held30.py).
- M2: the by-number answers are stripped to the approved fields (fastStripCollection); no body leaves with another field
  (TestFast234NoBodyLeavesUnapproved, plain and typed); parse and store equal on the five releases' by-number captures.
- M3: measured (push-design run 37747408916): a 500-item invoice 1.4-1.7 s at Tally; the owner chose option (a): a 2 s
  stop of FinComVoucherObject ends that entry's line with the Day Book words and never counts toward the slow mark
  (TestFast234ObjectStopEndsLineOnly); the bridge's strip of a 13.7 MB answer 2 s -> 0.09 s (a plain tag scan,
  TestFast234TagScanMatchesRegexp: the same tags as the expression on every capture).
- L1/L2: an object whose ledger, item or pay-head lines sit where the strip does not keep them is held (only the
  voucher-mode invoice on real answers); every kind of entry compared on 3.0-7.1 (testdata/fast234kinds,
  run_parse_fast234_kinds.mjs, run_fast234_store.py): equal but for "On Account" bills (only the Voucher collection adds
  them; the Day Book export does not) and TDS details (only the object, as the Day Book).
- L3: an entry 2.3.3 stored and 2.3.4 sends again keeps exactly the new rows live (run_fast234_store.py).
- L4: a failed re-ask sends its :resolved with the Day Book words again; every listed line's :resolved rows are read.
- L5: a line whose MasterID is its entry's is never asked by number (only a MasterID proven another entry's, review H2).
- L6: stale docs and comments; the allow-list purposes of forms B, D and E name the 2.2.2 requests (table hash updated).
- The live finding (NWS144, 08-Oct): held lines an older bridge kept (20 tries, final, refetch) get exactly one ask with
  the fast request on the upgrade, then end (TestFast234OlderHeldLinesAskedOnce).
The independent re-review of this range is the coordinator's.
