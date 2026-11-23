# One Tally company, several GSTINs: naming the registration on the entry (for the owner's OK)

Prepared 23-Nov-2026 (review of the owner decisions branch). **A draft only. Nothing is built.** No request the bridge
sends has changed, and nothing has gone into `allowlist.go` or `pinned.go`.

## In plain words (for the owner)

- Client setup now has the tick "This Tally company has more than one GSTIN". With it ticked, a purchase bill made out to
  another of the client's GSTINs is posted to **that GSTIN's own GST ledgers**, picked once in Client setup (CGST, SGST
  and IGST input for each other GSTIN). A bill to a GSTIN whose ledgers are not picked waits, with a plain line saying so;
  it is never posted to the client's main GST ledgers.
- That is all FinCom does today. The entry it sends to Tally is **the same shape as before**: Tally learns the
  registration only from the ledgers used.
- TallyPrime (3.0 and later) can also keep the registration on the entry itself (the "GST Registration" shown on a
  voucher when a company has several). If FinCom filled that in, Tally's own GSTR-1 / GSTR-3B reports for each
  registration would place the entry without relying on the ledgers.

## What would change (needs your OK)

- The purchase entry FinCom sends would carry one more field: the registration the bill is made out to (the company's
  registration name for that GSTIN, and the GSTIN), only when the tick is on and the bill is to another GSTIN.
- This is a change to a Tally request's shape, so under our rules it is not built without your OK. Before building, it
  would be checked on the test machines on every TallyPrime version we support (3.0, 4.1, 5.1, 6.2, 7.1, test data only):
  - that Tally takes the entry and shows the right registration on it;
  - that an older Tally, or a company with one GSTIN, is sent the entry exactly as today.

## Questions

1. Should FinCom name the registration on the entry when the tick is on, or keep relying on the ledgers alone?
2. Should sales invoices do the same? They already pick the output GST ledgers by "Our GSTIN".
