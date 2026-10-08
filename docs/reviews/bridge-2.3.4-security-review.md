# Security review: FinCom Bridge 2.3.4 (the fast entry request, FinComVoucherObject)

Reviewed: 08-Oct-2026, alongside the code review of the same range (bridge-2.3.4-code-review.md), an adversarial
self-review by the author from the diff.

Range: 27e5da8..1036026

## What holds

- **One request changed, approved by the owner.** FinComVoucherObject (the owner's words of 08-Oct-2026 in
  docs/tally-allowlist.md) replaces FinComVoucherByMaster; FinComFetchTestA and FinComFetchTestC are gone. Every other row
  is unchanged. It is read only (an Export of one object, no import, no TDL), one voucher, by Tally's own id; nothing asks
  Tally to compute a figure (`TestNoComputedFigure`). The two forms that froze Tally on every release are refused before
  a byte is sent.
- **Data minimisation.** Tally's whole voucher (1,000-1,500 fields, user-defined fields among them) is cut to the 61
  approved fields before it is logged, stored or sent; the VOUCHER element keeps only REMOTEID and VCHTYPE. Nothing
  else of Tally's answer reaches the log, the sync folder or FinCom.
- **The cloud change** lists only this bridge's own rows, on the same computer key, bridge id, book link and month-lock
  rules as before; it only adds rows of 7-30 days ago ended by the slow rule, in the same shape (no field added). No
  migration, no new table, function or grant.
- **No new host, port, file or permission.** Two small id files in the sync folder (`*.fast.txt`), kept 31 days as the
  ended ids are.

## Findings

- **S-L1.** The answer is read without a size cap (as before; larger now): a hostile local Tally could send a large answer.
  Tally is the user's own, on 127.0.0.1 or the configured host; unchanged risk. Kept.
- **S-L2.** The strip trusts the answer's element names; a forged answer could only fill approved fields, as it could
  before with the collection answer. Unchanged.

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

## The second independent review (08-Oct-2026), range 27e5da8..a107af85

The second independent review (08-Oct-2026) of the range below found 0 High, 4 Medium, 7 Low. Fixed test first (red,
then green) in the commits after it (36620612, e314000d, 488c500e, c4758aa4, c1ceb251); L3, L4 and L7 are left as they
were (put to the owner). Those commits are NOT yet independently reviewed: the coordinator's re-review writes the range
that covers them (until then release-check check 5 names the files changed after it, as it should).
- M1: an older bridge's held line whose one fast ask comes to nothing (an unreadable answer, another error, a posting, no
  entry) ends with the Day Book words instead of vanishing (TestFast234RROlderLineUnreadableAnswerEnds).
- M2: an item invoice whose sales ledger is also a line of its own: parse.js reads the object as the collection's answer
  was read (run_parse_fast234_kinds.mjs, run_fast234_store.py on real captures of 3.0 and 7.1, push-design 37770938549).
- M3: tally-ingest reads the 7-30-day slow-ended lines by their slow words, never the 400 oldest held rows of any kind
  (run_recorder_held30.py: 900 older decoys, the database stopping at its limit).
- M4: option (a) in the held list: a FinComVoucherObject stop ends the line at its first stop (TestFast234RRHeldListStopEndsAtOnce).
- L1: payroll typed on the Payroll screen: pay heads under each employee written as ledger lines of their totals, the
  employees as cost centres, approved fields only; stored as today (run_parse_fast234_kinds.mjs, run_fast234_store.py).
- L2: a cancel / delete check meeting a voucher the strip cannot keep whole is held for good with words
  (TestFast234RRGuidCheckShapeIsFinal); the posting check says a person must look (TestFast234RRPostCheckShapeWords).
- L5: an answer carrying a voucher the bridge cannot read is held, never "no such voucher" (TestFast234RRUnreadableBlockNotGone).
- L6: the allow-list row carries its measured worst case (1.7 s, a 500-item invoice).
- Not found (the renumbering helper's finding): Tally answers a MasterID it does not have with a bare
  `<ERRORMSG>Could not find Voucher:ID:<n>!</ERRORMSG>` (captures of 3.0-7.1). Only exactly that line for the MasterID
  asked is "no such voucher"; another id, extra text or an envelope with an error stays unreadable
  (TestFast234RRNotFoundAnswer). Real Tally: tally-real fast234 (6), tally-versions c4d. Needs the owner's sign-off.
- TestCancelGUIDTallySilentFallsBack (flaky): a cancel / delete check stopped at 2 s now keeps the could-not-be-asked
  words and its ask again whichever came first, the stop or no answer: one outcome, not the timing's.
