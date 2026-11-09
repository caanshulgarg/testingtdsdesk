# Security review: FinCom Bridge 2.5.12

Reviewers: the session that built it (self-review).

Range: ff86083bf..f1b3e700b (origin/staging-next, which holds released 2.5.11, to the version bump)

## Requests to Tally

- None added. One changed, by the owner's approval of 09-Nov-2026: FinComVoucherBatch's FETCH (and FinComVoucherWindow's,
  the same frozen text, sent only with FastEntries on) names four more stored fields, a ledger line's stock items
  (ALLLEDGERENTRIES.INVENTORYALLOCATIONS.STOCKITEMNAME, BILLEDQTY, RATE, AMOUNT, and their LEDGERENTRIES copies). Read
  only; no computed field; the request is still built only as frozen (batchFetchSHA) and refused otherwise.
- FinComDayHeads may also go for a range of 2 to 31 consecutive days FinCom listed (the same fields: GUID, MasterID,
  AlterID, date; the owner's approval of 09-Nov-2026), pinned to its builder and let through by the dated guard only
  while it is the range being asked and every day of it is listed now; over 2 s it stops the company's period as one
  day's list does.
- FinComVoucherObject is byte for byte 2.5.11's. The 2-second stop, one request in flight, postings first, idle only and
  the typing gate are unchanged (no code path around them was touched).

## Data kept and sent

- The strip keeps only approved paths (the four fields added to the approved set; TestR2512VoucherModeRealReleases checks
  every kept path of the real answers); godown, batch, actual quantity and every other field are dropped before anything
  is logged, stored or sent. The items written as ALLINVENTORYENTRIES are built only from those kept fields and the
  line's already-kept LEDGERNAME / ISDEEMEDPOSITIVE.
- A held entry: its head (GUID, MasterID, AlterID, date, voucher type: what FinComDayHeads already sends) and one line of
  words go to FinCom's own tally-ingest in the existing period_entries call; the words name the voucher type, MasterID,
  day and the strip's reason, no party or amount. The log line carries the same and the company name, as every
  older-entries log line already does.

## Files read and written

- None new.

## Verdict

Ship, as far as security goes.
