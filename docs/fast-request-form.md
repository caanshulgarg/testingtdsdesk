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
- **Held, never sent short** (2.3.4 review, L1 and L2; `fastStripWhy`): when a ledger, stock item or pay head name sits at a place the strip does not keep, the entry is not sent with those lines missing (migration 57 would mark its stored rows gone). The line goes held with the place named and the Day Book words ("Tally keeps this entry with its lines in ALLLEDGERENTRIES.INVENTORYALLOCATIONS, which FinCom's entry request does not read; upload that day's Day Book to settle it"), and is not asked again (the same answer would come). The shapes: a stock item under a ledger line (an invoice made in voucher mode), items in `INVENTORYENTRIES`, pay heads by employee with no ledger line for them, ledger lines in both lists. A stock journal's lines in and out (`INVENTORYENTRIESIN` / `OUT`) are dropped as any other field, not held: FinCom stores nothing of them from either request (section 9). It is never taken as "not found" or "deleted". `TestFast234StripHoldsUnreadShapes`, `TestFast234UnreadShapeHeld`. Real answers of each kind on 3.0-7.1: section 9.
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

## 9. Every kind of entry on real Tally (the independent review, L2 / L3; 08-Oct-2026)

**Captures** (push-design run 37741662830, `fast234l.ps1`; TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1; `bridge-go/testdata/fast234kinds/`, gzipped): each entry asked three ways on the same voucher: today's FinComVoucherByMaster, FinComVoucherObject and FinComVoucherByNumber. The kinds: a payment with TDS typed on Tally's own screens (S5), a credit note (accounting) and one with items, a debit note, a journal with a party, a journal with cost centres, a bank payment by e-fund transfer with its UTR and one by cheque, a receipt with bank details and a cost centre, sales invoices (5 items with GST; 50 items; 50 items with godowns and batches; 200 and 500 items), a sales invoice in voucher mode with an item, payroll (50 and 200 employees), a delivery note, a receipt note, a stock journal, a manufacturing journal and a physical stock voucher.

**What FinCom reads and stores** (`TestFast234KindsStrip`, `tests/run_parse_fast234_kinds.mjs`, `tests/run_fast234_store.py`: parse.js field by field, then every stored row through index.ts and migrations 32-60 on pg_stand): 103 entries on five releases.
- **The same** for every kind, with two differences, both towards Tally's own Day Book export:
  - **"On Account" bills** (30, on journals, notes and invoices whose bill-wise party line has no bill): Tally's Voucher collection (today's request, and the by-number one) adds an "On Account" bill of the whole amount; the object export has none, and neither has the Day Book export (push-design run 37747714876, `fast234d.ps1`: four entries asked four ways on 7.1 and 3.0). FinCom reads a party line with no bill as on account (`src/js/07-mis.js`), so receivables and ageing are the same; a Day Book upload already stores such entries without the row.
  - **TDS details** (the S5 payment on 7.1): the object carries the TDS allocation (nature, assessable amount 1,00,000, tax 2,000) that today's answer left empty; the Day Book export carries it too (run 37591395905). More, never less.
- **Two kinds the first comparison missed** (the second review, M2 and L1; push-design run 37770938549, 3.0 and 7.1, captures in `testdata/fast234kinds/`), now stored as today:
  - **An item invoice whose sales ledger is also a line of its own:** the object lists the entry's ledger lines whole and the ledgers under the items separately; parse.js reads them as the collection's answer did (the ledgers under the items as one total line each after the party, their cost centres kept). On 7.1 the collection's answer had left those item cost centres out: more, never less.
  - **Payroll typed on the Payroll screen:** the pay heads sit under each employee, not as ledger lines. The bridge writes each pay head's total as a ledger line, with the employees as its cost centres (approved fields only), as the collection's answer gave them. No longer held.
- **Held by the bridge:** the invoice in voucher mode (its item sits under the sales line, `ALLLEDGERENTRIES.INVENTORYALLOCATIONS`; today's answer gave it as an item): the line goes held with the Day Book words (5 of 5 releases).
- **Stock, manufacturing and physical stock journals:** parse.js reads no entry from either answer; both go held alike, nothing stored either way.
- **200 / 500-item invoices:** today's answer (2.2-2.7 million characters) is larger than FinCom takes in one line and was never stored; the stripped object (0.3-0.7 million) is stored whole.
- **MasterIDs that are no voucher** (corrected 08-Oct-2026, the renumbering helper's finding; captures of 3.0-7.1 in `bridge-go/testdata/fast234/notfound/`): a deleted voucher's MasterID, a ledger's MasterID and one never used are NOT answered empty. Tally answers each with one bare line, no envelope: `<ERRORMSG>Could not find Voucher:ID:<n>!</ERRORMSG>`, in 1.6-3.1 ms. The bridge takes this as "no such voucher" (what the cancel / delete check needs to prove a delete) **only when it is exactly that line, for the MasterID it asked**. Another MasterID in it, any other text, or an error inside an envelope is an answer the bridge cannot read: the line is held with words and never taken as "gone" (`TestFast234RRNotFoundAnswer`, `TestFast234RRUnreadableBlockNotGone`). On real Tally: tally-real check fast234 (6) on 7.1 and tally-versions check c4d on 3.0 and 7.1 delete an entry on the screen and need its line proven deleted, not held.

**A sales invoice in a GST-ON and a GST-OFF company** (the push helper's hang of run 37729166801; runs 37735320482, 37740175973, 37743008576, `fast234g.ps1`): an item invoice and an accounting sales voucher made by XML, the same with its IRN and e-way bill written back by an XML alteration, and an item invoice typed on the screen; ISGSTON set by an XML alteration and read back (Yes / No). FinComVoucherObject and FinComVoucherByNumber each asked in a fresh Tally with 30 s at most, with no TDL and with the FinCom add-on loaded, and the helper's own year-long collection last: **200 probes, every one answered (17-121 ms), Tally answered after every one.** The helper later traced its hang to its harness (a malformed `$MasterID = 1 2 3 ... 24` formula).

**Timing of large invoices** (M3; the bridge's own request, a warm-up and 5 timed asks, median / worst; push-design run 37747408916; the 100,000-voucher company is the same company grown, with two more such invoices made at the end):

| Invoice | 3.0 small | 3.0 at 100,000 | 7.1 small | 7.1 at 100,000 | Today's request, 100,000 |
|---|---|---|---|---|---|
| 3-5 items, receipt | 9-23 ms | 11-52 ms | 9-22 ms | 9-22 ms | 16.5-18.2 s |
| 200 items | 500 / 510 ms | 566 / 589 ms; made last 562 / 578 ms | 538 / 566 ms | 576 / 592 ms; made last 586 / 606 ms | 17.5-18.1 s |
| 500 items | 1,385 / 1,418 ms | 1,539 / 1,615 ms; made last 1,600 / 1,620 ms | 1,560 / 1,619 ms | 1,641 / 1,669 ms; made last 1,657 / 1,676 ms | 17.4-18.5 s |

The object's time grows with the voucher's own size (about 3 ms an item), not with the company's. A 500-item invoice's answer is about 13.7 MB and takes 1.4-1.7 s at Tally; the bridge's strip adds 0.1 s (2 s with the first scanner; `TestFast234TagScanMatchesRegexp`). **This approaches the owner's 2-second rule**: an invoice of about 600 items or more is stopped at 2 s. The owner's decision of 08-Oct-2026 (option (a)): "When FinCom's fast request for one entry takes more than 2 seconds, the bridge stops waiting as today, sends that entry's line to FinCom as held, and ends it with 'upload that day's Day Book to settle it'. The slow answer does not count towards marking the company slow; the company's other entries keep being fetched normally. The 2-second stop itself is unchanged." Built in 2.3.4 (`TestFast234ObjectStopEndsLineOnly`): such a line goes up held, ended with "Tally took longer than 2 s for this entry; upload that day's Day Book to settle it", never asked again; no stop marks a company; stops of other requests are treated as before.
