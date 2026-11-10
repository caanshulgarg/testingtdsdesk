# Security review: FinCom Bridge 2.5.12

Reviewers: the session that built it (self-review), after the independent review of f1b3e700b.

Range: ff86083bf..f8a15d27b (origin/staging-next, which holds released 2.5.11, to this build; 53be56303 merges origin/staging-next 6a8249a34, which changes no bridge-go file: the bridge sources are e6a43e67b's; f8a15d27b adds only the held-entry checks to tests/run_older_entries_ui.py)

## Requests to Tally

- None added. FinComVoucherBatch, FinComVoucherWindow and FinComVoucherObject byte for byte 2.5.11's.
- FinComDayHeads may also go for a range of 2 to 31 consecutive days FinCom listed (the same fields: GUID, MasterID,
  AlterID, date; the owner's approval of 09-Nov-2026), pinned to its builder and let through by the dated guard only
  while it is the range being asked and every day of it is listed now; only for a book shown sparse, its predicted time
  under 0.8 s; the 2-second stop, one request in flight, postings first, idle only and the typing gate unchanged.

## Data kept and sent

- The strip keeps only approved paths (a ledger line's stock item, billed quantity, rate, amount added); godown, batch,
  actual quantity and every other field are dropped before anything is logged, stored or sent.
- A held entry: its GUID, MasterID, AlterID, voucher type and one line of words go to FinCom's own tally-ingest in the
  existing period_entries call (no party or amount). tally-ingest keeps only those, cleaned and cut (heldOf).

## Cloud (migration 154, not run)

- One column added (tally_period_days.held). tally_period_hold and tally_period_held_release: service_role only.
  tally_period_held_list: the firm's members (tally_period_member); tally_period_held_retry: owner or staff of the firm
  (tally_period_member(..., true)); another firm refused (run_migration154.py).

## Files

- New: sync\range-off.json in the bridge's own data folder (company names and a reason), written when a range check
  finds a difference. Written only through a temp file and a rename, its other entries kept; never written over when it
  cannot be read (then ranges stay off for every company).

## Verdict

Ship, as far as security goes.
