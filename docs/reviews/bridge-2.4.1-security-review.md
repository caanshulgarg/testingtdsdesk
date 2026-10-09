# Security review: FinCom Bridge 2.4.1 (the fallback by number, the bank route's state, received_at)

Reviewed: 09-Oct-2026, release-241 against the published 2.4.0 (tax-accuracy). Read only.

## What 2.4.1 does

- The fallback by number: a created or altered line whose MasterID gave an older entry (below the starting point) or no
  voucher is asked ONCE by its type and number with the existing FinComVoucherByNumber, on its first fetch; the
  narration taken is Tally's, never the line's. The bridge's log says which rule refused a request by number.
- The bank route's state (the add-on line count, the MasterIDs it read and the ones the last list named) kept in
  bankdate.json with the counter, so a restart reads and sends nothing again.
- tally-ingest keeps the bridge's received_at in the line's payload, an ISO time not more than 5 minutes ahead.
- BridgeVersion 2.4.1; the allow-list decision line, the notes and the test sheet.

The data-locations feature (the add-on's data folder, other_source lines, dataSources, migration 71, the Tally page's
card) is NOT in 2.4.1: it moves to 2.4.2, with its reviews. SR-M1, SR-M2, SR2-M1 and SR2-M2 of next-241 are open there
and belong to 2.4.2.

## What holds

- **No request added or changed.** The fallback sends FinComVoucherByNumber exactly as built (shape 2167477221dc); the
  allow-list table and its hash are unchanged; the add-on is unchanged from 2.4.0.
- **The fallback's guards.** One day, from the company's starting day to today, within 3 days or just asked; only an
  answer of exactly one voucher is taken; Tally's AlterID must be above the starting point (liveVoucherWrong, with the
  MasterID cleared); once a line, within the 20 s limit, giving way to a posting; a MasterID answer of another type,
  date or number keeps 2.4.0's hold (review M1 of next-241).
- **The bank state file.** A fixed name under the bridge's own folder, never taken as a path; read back with MasterIDs
  as digits only and at most 20,000 a company.
- **received_at.** Checked for its form and that it is not in the future before it is kept; kept in the line's
  payload only; the row's own received_at stays the cloud's time.
- **No cloud or app change** beyond that field: no kind, table, function, grant, policy or Realtime change; the Sentry
  scrubber and the app are unchanged.
- **No secrets** in the code, tests, fixtures or docs.

## Findings

- **SR-L1.** received_at has no lower limit (any past time is kept); nothing reads it but the payload. For the next
  release: a lower limit if anything comes to rely on it.
- **SR-L2.** The fallback relies on a type and number being one voucher a day: a line carrying a copied voucher's ids
  can be matched to another entry with the same type and number on that day. Bounded by the guards above.
- **SR-L3.** bankdate.json is written once per add-on voucher line (disk writes in a burst; no security effect).

The Lows go to the next release. The open findings of next-241 (SR-M1, SR-M2, SR2-M1, SR2-M2) are 2.4.2's.

Range: 7c13c777..751c1795
