# One Tally company, several GSTINs: naming the registration on the entry

Drafted 23-Nov-2026. **Approved by the owner on 23-Nov-2026** (purchase and sales entries). Built on the
next-owner-decisions branch. **Not released until the manual check below has passed.**

## In plain words (for the owner)

- Client setup has the tick "This Tally company has more than one GSTIN". With it ticked:
  - a purchase bill made out to another of the client's GSTINs is posted to **that GSTIN's own GST ledgers** (CGST, SGST,
    IGST and cess input, set once in Client setup; reverse charge ledgers are picked on the first such bill and kept for
    that GSTIN). A bill to a GSTIN whose ledgers are not set waits, with a plain line saying so;
  - **every purchase and sales entry FinCom sends to Tally names its GST registration**: the GSTIN, and the registration's
    name as Tally has it (Client setup › "name in Tally" for each GSTIN; empty, FinCom uses TallyPrime's own default
    "<State> Registration").
- A company with one GSTIN (the tick off) gets **exactly the entry it got before, byte for byte** (checked by the app's
  posting shapes, `tests/fixtures/post-shapes`: the eight files of one GSTIN did not change).
- FinCom cannot read from Tally which GSTIN a ledger belongs to, so Client setup asks the CA to check each ledger is that
  GSTIN's.

## What the entry carries (tick on only)

Inside the `<VOUCHER>`, before the narration:

```xml
<CMPGSTIN>29AAACZ1234Z1Z1</CMPGSTIN>                       (purchase; sales already carried it)
<GSTREGISTRATION TAXTYPE="GST" TAXREGISTRATION="29AAACZ1234Z1Z1">Karnataka Registration</GSTREGISTRATION>
```

Made-up GSTIN. The shapes are `tests/fixtures/post-shapes/purchase-bill-multi-gstin.xml` and
`sales-invoice-multi-gstin.xml` (`node tests/gen_post_shapes.js`).

## FinCom Bridge

No change needed. The bridge's Import pin (`bridge-go/pinned.go`, `importRebuild`) accepts any VOUCHER object without a
request's own markup, and these two elements are not on its never-list. The bridge's own tests pass on the new shapes:
`TestPostShapesCurrent`, `TestRealPostingShapesPass` (the real posting path, pin included), `TestPostingRuleAndPinAgree`.

## Manual check before release (not done yet)

On the test machines, test data only, on each of **TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1**, a company with two GSTINs
(two GST registrations in Tally) and a company with one:

1. Post the purchase shape and the sales shape for the second GSTIN: Tally accepts each, and the voucher shows that
   registration (and Tally's GSTR-3B for that registration counts it).
2. The same with the registration's name in Tally different from "<State> Registration" (set in Client setup).
3. A registration name that Tally does not have: note what Tally answers (refused, or created without a registration).
4. The company with one GSTIN: entries posted as today, nothing new in them.
5. TallyPrime versions that do not know several registrations (if any of the five): note what Tally answers.

## Still the owner's

- Point 3 above decides whether FinCom should check the registration name against Tally before posting (that would be a
  new read request, so it needs your OK too).
