# The fast entry request: its exact form and what the bridge keeps

Branch `next-fastfetch` (from tax-accuracy 2.3.3). **Not released**: no version bump, no build. This page is what the owner sees before it ships.

The owner's approval (07-Oct-2026): "Fast request 'voucher object by MasterID': approved to build and prove, on these conditions: one entry per request, read only, same fields as the approved entry request, nothing added; show me its exact form before it ships ...". The owner's decision (08-Oct-2026), after it was shown that Tally always sends the whole voucher for this request: **"Allow, strip in bridge."**

## 1. The request, exactly

One voucher, by its MasterID. The company and MasterID below are examples. This is byte for byte what `voucherObjectRequest` in `bridge-go/fastvch.go` builds; line breaks are added here only between the FETCH elements.

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE><ID TYPE="Name">ID:25730</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>GARG SHEKHAR &amp; COMPANY</SVCURRENTCOMPANY></STATICVARIABLES><FETCHLIST>
<FETCH>GUID</FETCH>
<FETCH>MASTERID</FETCH>
<FETCH>ALTERID</FETCH>
<FETCH>DATE</FETCH>
<FETCH>VOUCHERTYPENAME</FETCH>
<FETCH>VOUCHERNUMBER</FETCH>
<FETCH>PARTYLEDGERNAME</FETCH>
<FETCH>NARRATION</FETCH>
<FETCH>ISCANCELLED</FETCH>
<FETCH>ISOPTIONAL</FETCH>
<FETCH>ALLLEDGERENTRIES.LEDGERNAME</FETCH>
<FETCH>ALLLEDGERENTRIES.AMOUNT</FETCH>
<FETCH>ALLLEDGERENTRIES.ISDEEMEDPOSITIVE</FETCH>
<FETCH>ALLLEDGERENTRIES.BILLALLOCATIONS.NAME</FETCH>
<FETCH>ALLLEDGERENTRIES.BILLALLOCATIONS.BILLTYPE</FETCH>
<FETCH>ALLLEDGERENTRIES.BILLALLOCATIONS.AMOUNT</FETCH>
<FETCH>ALLLEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD</FETCH>
<FETCH>ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.LEDGERNAME</FETCH>
<FETCH>ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.AMOUNT</FETCH>
<FETCH>ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.ISDEEMEDPOSITIVE</FETCH>
<FETCH>REFERENCE</FETCH>
<FETCH>REFERENCEDATE</FETCH>
<FETCH>PARTYGSTIN</FETCH>
<FETCH>PLACEOFSUPPLY</FETCH>
<FETCH>CMPGSTIN</FETCH>
<FETCH>IRN</FETCH>
<FETCH>IRNACKNO</FETCH>
<FETCH>IRNACKDATE</FETCH>
<FETCH>EWAYBILLDETAILS.BILLNUMBER</FETCH>
<FETCH>ALLLEDGERENTRIES.GSTHSNNAME</FETCH>
<FETCH>ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD</FETCH>
<FETCH>ALLLEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE</FETCH>
<FETCH>ALLLEDGERENTRIES.RATEDETAILS.GSTRATE</FETCH>
<FETCH>ALLLEDGERENTRIES.CATEGORYALLOCATIONS.CATEGORY</FETCH>
<FETCH>ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME</FETCH>
<FETCH>ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT</FETCH>
<FETCH>ALLLEDGERENTRIES.BANKALLOCATIONS.DATE</FETCH>
<FETCH>ALLLEDGERENTRIES.BANKALLOCATIONS.NAME</FETCH>
<FETCH>ALLLEDGERENTRIES.BANKALLOCATIONS.TRANSACTIONTYPE</FETCH>
<FETCH>ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTNUMBER</FETCH>
<FETCH>ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTDATE</FETCH>
<FETCH>ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE</FETCH>
<FETCH>ALLLEDGERENTRIES.BANKALLOCATIONS.UNIQUEREFERENCENUMBER</FETCH>
<FETCH>ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE</FETCH>
<FETCH>ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.CATEGORY</FETCH>
<FETCH>ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER</FETCH>
<FETCH>ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAXRATE</FETCH>
<FETCH>ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT</FETCH>
<FETCH>ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAX</FETCH>
<FETCH>ALLINVENTORYENTRIES.STOCKITEMNAME</FETCH>
<FETCH>ALLINVENTORYENTRIES.BILLEDQTY</FETCH>
<FETCH>ALLINVENTORYENTRIES.RATE</FETCH>
<FETCH>ALLINVENTORYENTRIES.AMOUNT</FETCH>
<FETCH>ALLINVENTORYENTRIES.GSTHSNNAME</FETCH>
<FETCH>ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEDUTYHEAD</FETCH>
<FETCH>ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE</FETCH>
<FETCH>ALLINVENTORYENTRIES.RATEDETAILS.GSTRATE</FETCH>
<FETCH>ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.CATEGORY</FETCH>
<FETCH>ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME</FETCH>
<FETCH>ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT</FETCH>
<FETCH>ALLLEDGERENTRIES.BILLALLOCATIONS.TDSDEDUCTEESECTIONNUMBER</FETCH>
</FETCHLIST></DESC></BODY></ENVELOPE>
```

- **Allow-list id: `FinComVoucherObject`.** An object export has no collection ID, so the bridge names it by its TYPE (`Object`) and SUBTYPE (`Voucher`).
- **The rules it goes by:**
  - It goes only when it is byte for byte what the builder makes: one MasterID, digits only, the 61 fields above, nothing else.
  - It needs the company's recorded starting point (as FinComVoucherByMaster did).
  - It is read only, and carries no period.
  - 2.3.3's rules are unchanged: one request at Tally at a time, a held line sent at once, each held line asked again once, the 10-second rule, and the 2-second stop.
- **It replaces FinComVoucherByMaster everywhere, with no fallback.** That covers the entry fetch, the held lines, the cancel / delete check, the posting check and the trial tool's form C. `TestFast234NoOldRequest` fails if the old id or builder comes back.
- **Two forms are refused before a byte is sent** (`TestFast234RefusesFormsThatFreezeTally`):
  - the object export with **no FETCHLIST**;
  - a **TDL report whose part's object is the voucher**.
  On every release, 3.0 to 7.1 (run 37657679690), each got no answer, and Tally answered nothing more until it was restarted.

## 2. What Tally sends, and what the bridge keeps

**Tally ignores the FETCHLIST and sends the whole stored voucher.** On every release the answer was the same, byte for byte, whether the FETCHLIST named 61 fields, 6, or only MASTERID. The bridge therefore strips the answer itself (`fastStripVoucher`, `bridge-go/fastvch.go`). This happens inside the fetch, **before the answer is logged, stored or sent**:

- **Kept:** exactly the 61 fields below, as their fetch paths, and only those that have a value.
- **Kept on the VOUCHER element:** its `REMOTEID` and `VCHTYPE` attributes only. These are the entry's GUID and voucher type, both approved fields.
- **Ledger lines:**
  - When the voucher has no `ALLLEDGERENTRIES.LIST` (an item invoice keeps its party and tax lines in `LEDGERENTRIES.LIST`), those lines are kept as `ALLLEDGERENTRIES.LIST`.
  - When it has both, `LEDGERENTRIES.LIST` is dropped.
- **Dropped:** everything else. That means every other field, list and attribute, and user-defined (`UDF:`) fields.

The 13 fields the owner has not decided on are listed in one place, `liveFetchUndecided` (`bridge-go/fastvch.go`). Setting `liveFetchUndecidedKept = false` drops them from both the request and the strip; `TestFast234UndecidedFieldsInOnePlace` covers this.

| # | Field kept (fetch path) | Status |
|---|---|---|
| 1 | `GUID` | approved |
| 2 | `MASTERID` | approved |
| 3 | `ALTERID` | approved |
| 4 | `DATE` | approved |
| 5 | `VOUCHERTYPENAME` | approved |
| 6 | `VOUCHERNUMBER` | approved |
| 7 | `PARTYLEDGERNAME` | approved |
| 8 | `NARRATION` | approved |
| 9 | `ISCANCELLED` | approved |
| 10 | `ISOPTIONAL` | approved |
| 11 | `ALLLEDGERENTRIES.LEDGERNAME` | approved |
| 12 | `ALLLEDGERENTRIES.AMOUNT` | approved |
| 13 | `ALLLEDGERENTRIES.ISDEEMEDPOSITIVE` | approved |
| 14 | `ALLLEDGERENTRIES.BILLALLOCATIONS.NAME` | approved |
| 15 | `ALLLEDGERENTRIES.BILLALLOCATIONS.BILLTYPE` | approved |
| 16 | `ALLLEDGERENTRIES.BILLALLOCATIONS.AMOUNT` | approved |
| 17 | `ALLLEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD` | approved |
| 18 | `ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.LEDGERNAME` | approved |
| 19 | `ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.AMOUNT` | approved |
| 20 | `ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.ISDEEMEDPOSITIVE` | approved |
| 21 | `REFERENCE` | approved |
| 22 | `REFERENCEDATE` | approved |
| 23 | `PARTYGSTIN` | **not yet decided by the owner** |
| 24 | `PLACEOFSUPPLY` | **not yet decided by the owner** |
| 25 | `CMPGSTIN` | **not yet decided by the owner** |
| 26 | `IRN` | approved |
| 27 | `IRNACKNO` | approved |
| 28 | `IRNACKDATE` | **not yet decided by the owner** |
| 29 | `EWAYBILLDETAILS.BILLNUMBER` | approved |
| 30 | `ALLLEDGERENTRIES.GSTHSNNAME` | **not yet decided by the owner** |
| 31 | `ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD` | **not yet decided by the owner** |
| 32 | `ALLLEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE` | **not yet decided by the owner** |
| 33 | `ALLLEDGERENTRIES.RATEDETAILS.GSTRATE` | **not yet decided by the owner** |
| 34 | `ALLLEDGERENTRIES.CATEGORYALLOCATIONS.CATEGORY` | approved |
| 35 | `ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME` | approved |
| 36 | `ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT` | approved |
| 37 | `ALLLEDGERENTRIES.BANKALLOCATIONS.DATE` | **not yet decided by the owner** |
| 38 | `ALLLEDGERENTRIES.BANKALLOCATIONS.NAME` | approved |
| 39 | `ALLLEDGERENTRIES.BANKALLOCATIONS.TRANSACTIONTYPE` | approved |
| 40 | `ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTNUMBER` | approved |
| 41 | `ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTDATE` | approved |
| 42 | `ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE` | approved |
| 43 | `ALLLEDGERENTRIES.BANKALLOCATIONS.UNIQUEREFERENCENUMBER` | approved |
| 44 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE` | **not yet decided by the owner** |
| 45 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.CATEGORY` | approved |
| 46 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER` | **not yet decided by the owner** |
| 47 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAXRATE` | approved |
| 48 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT` | **not yet decided by the owner** |
| 49 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAX` | approved |
| 50 | `ALLINVENTORYENTRIES.STOCKITEMNAME` | approved |
| 51 | `ALLINVENTORYENTRIES.BILLEDQTY` | approved |
| 52 | `ALLINVENTORYENTRIES.RATE` | approved |
| 53 | `ALLINVENTORYENTRIES.AMOUNT` | approved |
| 54 | `ALLINVENTORYENTRIES.GSTHSNNAME` | approved |
| 55 | `ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEDUTYHEAD` | approved |
| 56 | `ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE` | **not yet decided by the owner** |
| 57 | `ALLINVENTORYENTRIES.RATEDETAILS.GSTRATE` | approved |
| 58 | `ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.CATEGORY` | approved |
| 59 | `ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME` | approved |
| 60 | `ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT` | approved |
| 61 | `ALLLEDGERENTRIES.BILLALLOCATIONS.TDSDEDUCTEESECTIONNUMBER` | approved |

## 3. The field comparison on real Tally (run 37657679690, five releases)

**Setup.** One company with 4,003 vouchers. Two entries were compared:
- a 3-item sales invoice with GST, IRN, an e-way bill, cost centres and bill-wise details;
- a receipt with bank details, a cost centre and bill-wise details.

The captures are in `bridge-go/testdata/fast234/<release>/`.

**Columns.** "Fields" counts distinct field paths that have at least one value.
- **Today's answer** is FinComVoucherByMaster.
- **Object export** is the new request's raw answer, as Tally sends it.
- **Stripped** is what the bridge keeps and sends.

| Release | Entry | Today's answer: bytes | fields | Object export (raw): bytes | fields | Stripped: bytes | fields |
|---|---|---|---|---|---|---|---|
| 3.0 | sales | 80,265 | 415 | 128,756 | 1355 | 5,706 | 42 |
| 3.0 | receipt | 19,433 | 146 | 60,653 | 1024 | 1,824 | 37 |
| 4.1 | sales | 80,265 | 415 | 134,416 | 1414 | 5,706 | 42 |
| 4.1 | receipt | 19,433 | 146 | 62,969 | 1053 | 1,824 | 37 |
| 5.1 | sales | 80,265 | 415 | 135,372 | 1441 | 5,706 | 42 |
| 5.1 | receipt | 19,433 | 146 | 63,925 | 1080 | 1,824 | 37 |
| 6.2 | sales | 80,265 | 415 | 135,883 | 1453 | 5,706 | 42 |
| 6.2 | receipt | 19,605 | 149 | 65,357 | 1106 | 1,792 | 37 |
| 7.1 | sales | 19,982 | 112 | 145,775 | 1544 | 5,706 | 42 |
| 7.1 | receipt | 5,068 | 61 | 69,806 | 1170 | 1,792 | 37 |

**Today's answer was never only the 61 fields.**
- Tally's Voucher collection adds its own defaults: batch allocations, `REQUESTORRULE`, `ISDELETED`, and on 3.0–6.2 many more.
- The stripped answer carries only the approved fields. It is 4–40 times smaller than either answer.

**FinCom's reader (parse.js) reads the stripped voucher exactly as it reads today's answer for the same voucher**, on all five releases and both entries (`tests/run_parse_fast234.mjs`, also run by `TestFast234StripCaptures`).
- **Compared:** every field of its output — the entry, its ledger lines and amounts, the items (quantity, rate, taxable value, HSN, GST and tax per line), bill-wise details, cost centres, bank details and the accuracy notes.
- **Result:** 134 fields for the invoice, 69 for the receipt, all the same.
- **One difference, line order.** On the item invoice the ledger lines come in another order: the party and tax lines first, then the lines under the items. This is the order Tally's own Day Book export gives. The comparison sorts the lines (and renumbers the cost-centre, bank, TDS and due-date references with them), and states when it did so.

**Where the raw fields differ before parse.js** (sales invoice, every release; the receipt does not differ at all):
1. **The aggregated sales line is not in the object.** Today's answer carries Tally's aggregated sales line (`ALLLEDGERENTRIES`: Sales 600.00); the object does not. The same amounts come from the items' `ACCOUNTINGALLOCATIONS` (3 × 200.00), which are approved fields. parse.js reads them either way and gives the same lines.
2. **An extra GST rate row under each item.** The object carries one `RATEDETAILS` row per item that today's answer does not: an empty duty head, "Based on Value", rate 9. This is the rate as stored from the harness's import. Today's answer shows only Tally's five heads, each at 0. parse.js ignores a row with no head, so its output is unchanged. On an invoice keyed on the screen, the stored rates may differ from today's answer in the same way. **This is not measured.**

**Not covered by these captures:**
- TDS entries (`TAXOBJECTALLOCATIONS`). The stand tests in `bridge-go/parta231_test.go` cover them; real Tally captures do not.
- Entries with godowns or batches.

## 4. Timings

Probe run 37657679690, 4,003 vouchers, median / worst of 3 in ms:

| Release | Today's request, sales | New request, sales | Today's request, receipt | New request, receipt |
|---|---|---|---|---|
| 3.0 | 503 / 557 | 19 / 35 | 482 / 541 | 10 / 20 |
| 4.1 | 344 / 372 | 12 / 27 | 326 / 349 | 7 / 14 |
| 5.1 | 492 / 566 | 20 / 35 | 500 / 539 | 10 / 21 |
| 6.2 | 489 / 545 | 20 / 38 | 510 / 566 | 16 / 21 |
| 7.1 | 603 / 610 | 21 / 57 | 570 / 672 | 12 / 27 |

At 4,000, 25,000, 40,000 and 100,000 vouchers: see section 7 (run push-design 37718386662, pending).

## 5. Lines with no MasterID

A new entry's line written at Form Accept, before the save, has MasterID 0. It is the only line still asked by type and number, with **FinComVoucherByNumber**: unchanged, one day, the same 61 fields, and a full scan as before.

- Such a line is rare. A save writes the post line with the MasterID, and the post line is asked by the new request.
- No fast by-number form exists. The by-number form tried (the voucher type's own list, `Vouchers : VoucherType`) took 224–360 ms at 4,000 vouchers and grows with the type's size.
- "Do not keep both" applies to the MasterID path. There, FinComVoucherByMaster is gone.

## 6. Held lines after the upgrade, and the cloud's 7-day window

**The one fresh ask** (built; `bridge-go/fast234reask_test.go`):
- **Which lines.** A held line that 2.3.3 ended with the Day Book words, or sent at once with the "marked slow" words. Its id is kept 7 days in `sync\recorder-sent\*.ended.txt`.
- **When.** When FinCom lists it again (the beat's `heldLines` or `refetch`), it is asked **once more** with the new request.
- **If Tally gives the entry,** `<line id>:resolved` goes again with Tally's GUID and the stripped body. This is the cloud's second `:resolved` row, which replaces the held line and the held `:resolved` row.
- **If not,** nothing more goes to FinCom.
- **Never a third ask.** The lines given that ask, and the lines this version ends, are kept 7 days in `*.fast.txt`.
- **The slow mark lifts** when the bridge's version changes (2.3.3's rule), so companies marked by 2.3.3 are asked again by the released build.

**Does the cloud still offer them?** Yes. `heldOwnLines` (`server/tally-cloud/index.ts`) lists a held line whose only `:resolved` row is itself held without a body, and stops listing it once a second `:resolved` arrives.

**The 7-day window.** The cloud lists only held lines received in the last 7 days. The bridge's own `.ended.txt` / `.sent` ids also last 7 days.
- GARG SHEKHAR's 29 Journal lines of 06-Oct drop out of the listing on **13-Oct**.
- After that, a Day Book upload is the only way they settle.

**Proposal (not applied; for the owner to decide):** the smallest add-only cloud change that widens the window for lines ended by the slow rule. It is one extra query in `heldOwnLines`; nothing is removed, no migration, no column.
- **What it adds:** rows that are both:
  - received in the last **30 days** and older than 7;
  - such that their only `:resolved` row is held with one of the bridge's Day Book end words: "FinCom does not ask Tally for this company's entries", "Tally did not answer in time for this entry when asked again", or "Tally did not give this entry when asked again". Or the line itself is held with the "does not ask Tally" words.
- **The same rules otherwise:** the same computer key and bridge, the company still linked to the same book, the month not locked, and at most 200 lines.
- **Bridge side:** for such a line, the bridge needs the ended id it no longer keeps after 7 days. It would treat a `heldLines` row carrying a new flag (`endedSlow: true`) the same as an ended id: asked once more, then noted in `*.fast.txt`.
- **Size:** about 25 lines in `index.ts` and 5 in the bridge.

## 7. Measurements at size

Pending: push-design run 37718386662 (tally-versions, mode fast234m): the request above against FinComVoucherByMaster at 4,000, 25,000, 40,000 and 100,000 vouchers on 3.0, 4.1, 5.1, 6.2 and 7.1, a sales invoice and a receipt each, median and worst of 5. This section is filled from its results.
