# The fast entry request: its exact form and what the bridge keeps

FinCom Bridge 2.3.4 (branch `next-fastfetch`, from tax-accuracy 2.3.3). The owner approved the form on 08-Oct-2026: "1. Fast request form (FinComVoucherObject): YES."

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

- **Kept:** exactly the 61 fields below, as their fetch paths, as Tally wrote them (an approved field Tally gives empty is kept empty, as today's answer gave it).
- **Kept on the VOUCHER element:** its `REMOTEID` and `VCHTYPE` attributes only. These are the entry's GUID and voucher type, both approved fields.
- **Ledger lines:**
  - When the voucher has no `ALLLEDGERENTRIES.LIST` (an item invoice keeps its party and tax lines in `LEDGERENTRIES.LIST`), those lines are kept as `ALLLEDGERENTRIES.LIST`.
  - When it has both, each with ledger lines, the entry is **held** (below), never sent with one list dropped.
- **Dropped:** everything else. That means every other field, list and attribute, and user-defined (`UDF:`) fields.
- **Held, never sent short** (2.3.4 review, L1 and L2; `fastStripWhy`): when a ledger, stock item or pay head name sits at a place the strip does not keep, the entry is not sent with those lines missing (migration 57 would mark its stored rows gone). The line goes held with the place named and the Day Book words ("Tally keeps this entry with its lines in ALLLEDGERENTRIES.INVENTORYALLOCATIONS, which FinCom's entry request does not read; upload that day's Day Book to settle it"), and is not asked again (the same answer would come). The shapes: a stock item under a ledger line (an invoice made in voucher mode), a stock journal's lines in and out (`INVENTORYENTRIESIN` / `OUT`), items in `INVENTORYENTRIES`, pay heads by employee (payroll), ledger lines in both lists. It is never taken as "not found" or "deleted". `TestFast234StripHoldsUnreadShapes`, `TestFast234UnreadShapeHeld`. Real answers of each kind on 3.0-7.1: section 9.
- **The by-number answer too** (2.3.4 review, M2): FinComVoucherByNumber's answer (a Voucher collection, the same 61 fields) is stripped to the same fields (`fastStripCollection`): Tally's collection adds fields of its own (`PERSISTEDVIEW`, `VOUCHERKEY`, `ISDELETED`, `BANKALLOCATIONS.PAYMENTFAVOURING`, `BATCHALLOCATIONS.GODOWNNAME`, `BILLALLOCATIONS.BILLID` among them). Not held there: the collection's `ALLLEDGERENTRIES` is the entry's whole ledger list. No body leaves the bridge with a field outside the list, whatever brought it (`TestFast234NoBodyLeavesUnapproved`, Tally answering plain and typed). On the five releases' captures parse.js reads the stripped by-number answer exactly as today's (every field, the lines in the same order: `tests/run_parse_fast234.mjs`) and FinCom stores the same rows, `line_no` included (`tests/run_fast234_store.py`).

All 61 fields are approved by the owner. The last 13 were approved on 08-Oct-2026: "13 fields: all approved. They are read only, inside requests already made, and needed for GST, TDS and bank accuracy." (`liveFetchApproved0810` in `bridge-go/fastvch.go` records them; `TestFast234ApprovedFields0810`.) `ALLLEDGERENTRIES.BANKALLOCATIONS.NAME` was approved on 07-Oct-2026. The one place the fields change is `liveFetchField` (`bridge-go/recorder_live.go`): the request's FETCHLIST and the strip both follow it. The request's bytes did not change with these approvals.

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
| 23 | `PARTYGSTIN` | approved 08-Oct-2026 |
| 24 | `PLACEOFSUPPLY` | approved 08-Oct-2026 |
| 25 | `CMPGSTIN` | approved 08-Oct-2026 |
| 26 | `IRN` | approved |
| 27 | `IRNACKNO` | approved |
| 28 | `IRNACKDATE` | approved 08-Oct-2026 |
| 29 | `EWAYBILLDETAILS.BILLNUMBER` | approved |
| 30 | `ALLLEDGERENTRIES.GSTHSNNAME` | approved 08-Oct-2026 |
| 31 | `ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD` | approved 08-Oct-2026 |
| 32 | `ALLLEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE` | approved 08-Oct-2026 |
| 33 | `ALLLEDGERENTRIES.RATEDETAILS.GSTRATE` | approved 08-Oct-2026 |
| 34 | `ALLLEDGERENTRIES.CATEGORYALLOCATIONS.CATEGORY` | approved |
| 35 | `ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME` | approved |
| 36 | `ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT` | approved |
| 37 | `ALLLEDGERENTRIES.BANKALLOCATIONS.DATE` | approved 08-Oct-2026 |
| 38 | `ALLLEDGERENTRIES.BANKALLOCATIONS.NAME` | approved 07-Oct-2026 |
| 39 | `ALLLEDGERENTRIES.BANKALLOCATIONS.TRANSACTIONTYPE` | approved |
| 40 | `ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTNUMBER` | approved |
| 41 | `ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTDATE` | approved |
| 42 | `ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE` | approved |
| 43 | `ALLLEDGERENTRIES.BANKALLOCATIONS.UNIQUEREFERENCENUMBER` | approved |
| 44 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE` | approved 08-Oct-2026 |
| 45 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.CATEGORY` | approved |
| 46 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER` | approved 08-Oct-2026 |
| 47 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAXRATE` | approved |
| 48 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT` | approved 08-Oct-2026 |
| 49 | `ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAX` | approved |
| 50 | `ALLINVENTORYENTRIES.STOCKITEMNAME` | approved |
| 51 | `ALLINVENTORYENTRIES.BILLEDQTY` | approved |
| 52 | `ALLINVENTORYENTRIES.RATE` | approved |
| 53 | `ALLINVENTORYENTRIES.AMOUNT` | approved |
| 54 | `ALLINVENTORYENTRIES.GSTHSNNAME` | approved |
| 55 | `ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEDUTYHEAD` | approved |
| 56 | `ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE` | approved 08-Oct-2026 |
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
- **One difference, line order.** On the item invoice the ledger lines come in another order: the party and tax lines first, then the lines under the items. This is the order Tally's own Day Book export gives. The comparison sorts the lines (and renumbers the cost-centre, bank, TDS and due-date references with them), and states when it did so. In the stored rows only `tally_cost_allocs.line_no` differs (the line a cost centre belongs to, numbered in that order). It does no harm (2.3.4 review, L3; `tests/run_fast234_store.py`, "stored by 2.3.3, sent again by 2.3.4"): an entry 2.3.3 stored and 2.3.4 sends again (a later AlterID) ends with exactly the 2.3.4 rows live, equal to 2.3.3's but for `line_no`, the earlier rows kept as history (`gone_at`), none live twice. Each cost-centre row carries its ledger's name; nothing in FinCom reads `tally_cost_allocs` by `line_no` (no reader of the table outside migration 57 today).

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

At 4,000, 25,000, 40,000 and 100,000 vouchers: see section 7 (push-design run 37718386662).

## 5. Lines with no MasterID

A new entry's line written at Form Accept, before the save, has MasterID 0. It is the only line still asked by type and number, with **FinComVoucherByNumber**: unchanged, one day, the same 61 fields (its answer stripped to them, section 2), and a full scan as before.

A line **with** a MasterID is never asked by its number (2.3.4 review, L5): when Tally's voucher with it is another entry, or not given yet, the line is held as the answer said (not given yet: asked again by its MasterID, once; another entry: held for good with the Day Book words). The one exception is a line whose MasterID is proven **not** its entry's (review H2 of 2.2.2: Tally's voucher with that MasterID was not saved after the line; the add-on wrote the copied source's ids): it is asked by its number as a line with no MasterID is. `TestFast234MasterIDLineNeverByNumber`, `TestR222FallbackByNumber`, `TestR222bH2LonePreSourceIds`.

- Such a line is rare. A save writes the post line with the MasterID, and the post line is asked by the new request.
- No fast by-number form exists. The by-number form tried (the voucher type's own list, `Vouchers : VoucherType`) took 224–360 ms at 4,000 vouchers and grows with the type's size.
- "Do not keep both" applies to the MasterID path. There, FinComVoucherByMaster is gone.

## 6. Held lines after the upgrade, and the 30-day window

**The one fresh ask** (built; `bridge-go/fast234reask_test.go`):
- **Which lines.** A held line that 2.3.3 ended with the Day Book words, or sent at once with the "marked slow" words. Its id is kept **31 days** in `sync\recorder-sent\*.ended.txt`.
- **When.** When FinCom lists it again (the beat's `heldLines` or `refetch`), it is asked **once more** with the new request.
- **If Tally gives the entry,** `<line id>:resolved` goes again with Tally's GUID and the stripped body. This is the cloud's second `:resolved` row, which replaces the held line and the held `:resolved` row.
- **If not** (2.3.4 review, L4), its `:resolved` goes again held with the Day Book words and no body: FinCom then holds two `:resolved` rows and stops listing the line.
- **Never a third ask.** The lines given that ask, and the lines this version ends, are kept 31 days in `*.fast.txt`.
- **The slow mark lifts** when the bridge's version changes (2.3.3's rule), so companies marked by 2.3.3 are asked again by the released build.

**Lines an older bridge kept in its held list** (a live finding on NWS144, 08-Oct-2026: lines at 20 tries or marked final were never asked and never ended). On the upgrade every such line gets exactly one ask with the new request, whatever its old tries, final mark or refetch flag: answered, it goes with Tally's body; not, it ends with the Day Book words. A line of this version at 20 tries ends with the Day Book words; none is left unasked. `TestFast234OlderHeldLinesAskedOnce` (a 2.3.2-format held file).

**The 30-day window** (the owner, 08-Oct-2026: "30-day window for lines ended by the slow-company rule: YES"; `server/tally-cloud/index.ts` `heldOwnLines`, no migration). The cloud lists, after the last 7 days' held lines, a held line received 7 to 30 days ago when the slow-company rule ended it: its own held words, or those of its only `:resolved` row (held, no body), are "FinCom does not ask Tally for this company's entries" or "Tally did not answer in time for this entry when asked again". Any other held line keeps the 7 days. The same rules otherwise: the same computer key and bridge, the company still linked to the same book, the month not locked.
- **Only to a bridge of 2.3.4 or later** (2.3.4 review, M1): the beat's version decides. A 2.3.3 bridge (rolled back) gets its last 7 days' lines only: it would end such a line again at once, or ask it the slow way. `tests/run_recorder_held30.py` (2.3.3, 2.2.2 and no version against 2.3.4, 2.3.10, 2.4.0 and 3.0.0).
- **Every listed line's `:resolved` rows are read** (2.3.4 review, L4: the 400-id cap removed), 60 ids a call.

## 7. Measurements at size

Push-design run 37718386662 (tally-versions, mode fast234m, 08-Oct-2026). The request is the one above, byte for byte (`fast234-object.xml`, dumped from `voucherObjectRequest`), against today's FinComVoucherByMaster.

**Setup**
- One company grown in place to 4,003 / 25,005 / 40,007 / 100,009 vouchers, no godowns. Masters: 300 ledgers and 300 items, plus the light company's ~60.
- The targets: a new sales invoice and a new receipt at each size.
- Timing: a warm-up and 5 timed reps each, in ms. Each request is the HTTP round trip to Tally on 127.0.0.1:9000 (no bridge).
- Every answer held the target. No errors.

| Vouchers | Release | Sales: today median / worst | Sales: new median / worst | Receipt: today median / worst | Receipt: new median / worst |
|---|---|---|---|---|---|
| 4,003 | 3.0 | 525 / 565 | **23 / 26** | 580 / 710 | **12 / 16** |
| 4,003 | 4.1 | 362 / 384 | **15 / 17** | 410 / 424 | **9 / 12** |
| 4,003 | 5.1 | 501 / 535 | **19 / 19** | 548 / 556 | **11 / 17** |
| 4,003 | 6.2 | 498 / 521 | **19 / 19** | 543 / 550 | **12 / 13** |
| 4,003 | 7.1 | 488 / 509 | **20 / 20** | 529 / 539 | **12 / 16** |
| 25,005 | 3.0 | 3,686 / 3,929 | **20 / 27** | 4,069 / 4,082 | **12 / 13** |
| 25,005 | 4.1 | 2,772 / 3,015 | **15 / 16** | 3,234 / 3,371 | **9 / 10** |
| 25,005 | 5.1 | 3,474 / 3,788 | **19 / 20** | 3,874 / 3,994 | **11 / 12** |
| 25,005 | 6.2 | 3,551 / 3,762 | **19 / 21** | 3,839 / 4,107 | **11 / 12** |
| 25,005 | 7.1 | 3,442 / 3,607 | **20 / 21** | 3,764 / 3,785 | **12 / 12** |
| 40,007 | 3.0 | 6,433 / 6,495 | **19 / 19** | 6,567 / 6,639 | **11 / 11** |
| 40,007 | 4.1 | 4,803 / 5,186 | **16 / 17** | 5,297 / 5,318 | **10 / 10** |
| 40,007 | 5.1 | 6,182 / 6,404 | **19 / 20** | 6,379 / 6,424 | **11 / 12** |
| 40,007 | 6.2 | 6,174 / 6,711 | **18 / 21** | 6,322 / 6,379 | **11 / 24** |
| 40,007 | 7.1 | 5,930 / 6,186 | **20 / 22** | 6,363 / 6,403 | **13 / 61** |
| 100,009 | 3.0 | 16,220 / 17,043 | **19 / 20** | 17,462 / 17,734 | **12 / 13** |
| 100,009 | 4.1 | 11,867 / 13,173 | **16 / 17** | 13,945 / 14,743 | **10 / 12** |
| 100,009 | 5.1 | 15,525 / 16,176 | **19 / 20** | 16,226 / 16,317 | **11 / 11** |
| 100,009 | 6.2 | 15,401 / 15,961 | **19 / 19** | 16,330 / 16,773 | **11 / 12** |
| 100,009 | 7.1 | 15,327 / 16,085 | **20 / 49** | 16,236 / 16,353 | **12 / 13** |

**Results**
- **The new request's time does not grow with the company.** It is 9–23 ms median on every release at every size; the worst single rep is 61 ms.
- **Today's request grows in a straight line.** It takes 0.12–0.17 ms per voucher: 16–17.5 s at 100,000 vouchers.
- These are GitHub runners. NWS144's CPU sets its own scale for today's request; the new request is keyed, so its time does not depend on the company's size.

## 8. Real Tally: two companies, an SMB share, a held backlog

Run 37723589664 of `tally-real.yml` (branch tally-real-spike, input `only=fast234`, the bridge built from next-fastfetch 37ebe88). TallyPrime 7.1 on a GitHub windows-latest runner.

**Setup**
- **One Tally, two companies open:** the small company and "FinCom Big Co" with 40,000 entries.
- **The data folder:** `\\localhost\fast234share`, an SMB share. Both client and server were on one machine, so SMB was exercised but no real network.
- **Bridge 1's requests:** all went through a timing proxy that logs each one.
- **A seeded held backlog of 20 lines:**
  - 10 held lines FinCom lists;
  - 10 lines 2.3.3 had ended with the Day Book words (their ids in `*.ended.txt`, their `:resolved` already sent).

| Check | Result |
|---|---|
| (1) New saves in both companies arrive in the stub with Tally's body; each entry request answered in under 2 s | PASS: 26 FinComVoucherObject requests, 20–46 ms at Tally (median 32) |
| (2) Every seeded held line resolved with its body, asked once by the new request; the 10 ended ones asked once more | PASS: 20 of 20 |
| (3) No FinComVoucherByMaster seen at the proxy | PASS: 0 (and 0 FinComVoucherByNumber) |
| (4) No request sent while a previous one was unanswered at Tally | PASS: 45 requests, no overlap |
| (5) No company marked slow | PASS: no stopped entry fetch, no mark |

**The direct request on the 40,000-entry company, over the share:** 17–31 ms, with a 53 kB answer before the bridge's strip.

**The run before it (37720646660)** failed check (1) because of a harness fault, not the bridge. The harness wrote the large company's save lines with its own voucher numbers, but Tally had renumbered the Journals (F234-BIG-1 became 8001). The bridge rightly held those lines as "not this line's entry". The harness now reads Tally's number.
