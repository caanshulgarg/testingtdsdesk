# Security review: FinCom Bridge 2.3.4 (the fast entry request, FinComVoucherObject)

Reviewed: 08-Oct-2026, alongside the code review of the same range (bridge-2.3.4-code-review.md), an adversarial
self-review by the author from the diff.

Range: 27e5da8..5257fad

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
