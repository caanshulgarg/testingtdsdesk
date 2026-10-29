# Bridge 2.4.9 (phase 1): one request for many old entries, for the owner's OK

Prepared 28-Oct-2026. **Measure only. Nothing is built.** No request the bridge sends has changed, and nothing has gone into
`allowlist.go` or `pinned.go`. Every number below comes from the real-Tally harness on GitHub's Windows test machines
(TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1, Educational mode, test data only). Nothing ran on the owner's computer or on any
client's.

## In plain words (for the owner)

- Today, when the bridge brings older entries from Tally, it asks Tally for **one entry at a time**. Tally answers each in
  a few thousandths of a second, but the bridge's own safety checks before every question take far longer. That is why
  the night pace is about **430 entries a minute** (2,00,000 entries in about 7.8 hours).
- The proposal: ask Tally for **up to 100 entries of the same day in one question**. The safety checks then happen once
  per 100 entries instead of once per entry.
- We tried it on all five TallyPrime versions, on a test company of about **30,000** entries and again at about
  **1,00,000** entries, with 50-item sales invoices and payrolls of 100 and 500 employees mixed in.
  - Every question came back with **exactly** the entries asked, every time (1,256 group questions a version, 6,280
    in all).
  - The slowest answer for 100 entries was **1.4 seconds** (on a test day holding 7,600 entries; on a normal day
    at most 0.95 s). The 2-second rule holds everywhere, with room to spare.
  - Tally's screen never stopped answering for 2 seconds or more during these questions.
  - Every field FinCom keeps came back **identical** to today's one-by-one answer, once the bridge applies one small
    rule for item invoices (section 4).
- Expected result: **at least 10 times faster**. 1 lakh entries in roughly **7 to 25 minutes**, 2 lakh in roughly
  **15 to 50 minutes**, instead of about 4 and 8 hours. The exact figure is measured in the 2.4.9 test before release.
- If Tally is ever slow with a group, the bridge halves the group, and then goes back to one entry at a time for that
  day. Nothing else about how the bridge treats Tally changes: one question at a time, postings first, only while idle,
  the freeze stop, and only the approved fields kept.

**What you are asked to approve:** the exact request in section 2 (and its fallback in section 3), with up to 100 entries
a question.

## 0. The measurements

| Run | What | Result files (branch `tally-batch249`) |
|---|---|---|
| 40741546645 (28-Oct, 7.1 only) | first try: B1, B2, B3 at N = 5..100 | `spike-results/versions/40741546645-7.1-batch-summary.txt` |
| **40750991113** (28-Oct, 7.1, 3.0, 4.1, 5.1, 6.2) | **B1, B3, B4, B5 at N = 5..200, the diff, the control** | `spike-results/versions/40750991113-<release>-batch-summary.txt`, every request in `.../captures/batch/rows.json`, raw answers in `raw.zip`, the diff in `diff.txt` |

Harness: tally-versions mode `batch` (`.github/tally-spike/batchv.ps1`, `batch/zz_fcbatch_req_test.go`,
`batch/zz_fcbatch_diff_test.go`, `batch/v8.py`, `dbm/redate.py` profile `big100`) on branch `tally-batch249`, cut
from `tally-versions`. The bridge source measured is `next-bridge-249-measure` = `next-bridge-248` at `dd4606030`
(bridge 2.4.8 source, unchanged).

How it worked:

- **The requests were built by the bridge's own code at that commit** (`formCollection` / `fcCollection`, and the field
  lists of FinComVoucherObject: `liveFetchFields`, `liveFetchWild`, `liveKeepGST242`, `liveKeepTDS243`, `liveKeepPay244`).
  A throwaway Go test wrote them on the test machine; nothing is in `bridge-go`.
- **Test company:** ZZ BIG TEST from its own generator, re-dated onto the days Educational-mode Tally accepts
  (01-Jun 100 entries, 02-Jul 300, 31-Aug 800, 01-Aug and the other background days about 2,216 each: 30,021 in all).
  On 31-Aug the harness added ten Sales invoices of 50 items and payroll entries of 100 and 500 employees. Then about
  70,000 more entries went onto the background days in turn (100,021 in all; 01-Aug and 02-Apr then hold **7,601
  entries each**, so a day's MasterIDs are no longer one block).
- **One request at a time, 2 s stop, late answer awaited** (as the bridge does), and a **window probe** beside every
  request: a thread asked Tally's window every 100 ms whether it answered within 250 ms; "held" is the longest time it
  did not (the smallest non-zero figure it can show is about 250 ms).
- **The sweep:** for each test day, FinComDayHeads first (as the bridge does), then each form with N = 5, 10, 25, 50,
  100 and 200 entries, six groups spread over the day; the last group of 31-Aug ends with the invoices and both payrolls.
- **The reference:** 150 entries (31-Aug: the first 100 and the last 25 with the invoices and payrolls; 01-Aug: the first
  25) asked one by one with today's FinComVoucherObject, raw answers kept.
- **The diff:** every one of those 150 entries, as each batch form answered it and as FinComVoucherObject answered it,
  put through the bridge's own strip (`cleanXML`, then `fastStripWhy` for the one-by-one answer as
  `fetchVouchersByMasterIn` does, `fastStripCollection` for the batch answer), then every kept field compared with its
  place (the n-th ledger line, the n-th bill, ...) and value. A field Tally leaves empty counts as absent.
- Tally was **responding after every request** on every release, and **no request hung** (1,569 requests a release).

## 1. Summary: what the measurements decide

| Candidate | What it asks | Exact entries every time | Kept fields identical to today | Worst time, 100 entries, any release |
|---|---|---|---|---|
| **B4 (recommended)** | one day; entries with MasterID a..b; today's kept fields, ledger lines also under LEDGERENTRIES | yes, 5/5 releases | **yes, 150/150 on 5/5 releases** (with the item-invoice rule, section 4) | 0.95 s on days up to 2,216 entries; 1.41 s on a 7,601-entry day |
| **B5 (fallback for scattered entries)** | the same, with the list "MasterID = m1 OR ... OR mN" instead of a..b | yes | yes, 5/5 | about the same as B4 |
| B1 | B4 without the LEDGERENTRIES fields | yes | **no on 7.1** (an item invoice's bill name and type are missing from its own ledger lines); yes on 3.0-6.2 | about the same |
| B3 | B1 with the list | yes | as B1 | about the same |
| B2 (7.1 only) | every kept list fetched whole | yes | as B1 | 1.0 s; answers 3 times the size |
| C0 (control) | B1 with **no day** | yes | - | **1.9-2.9 s for 5 entries at 30,000; 9-26 s at 1,00,000**: the whole company is looked at. This is why the day is in the request |

**Recommended:** B4 with **up to 100 entries a request**. The largest group measured, 200, also stays under 2 s on every
release (worst 1.56 s on 6.2's 7,601-entry day), but 100 keeps a wide margin and the gain from 200 is small (the bridge's
own per-request work is already spread over 100 entries).

## 2. The exact request (recommended, B4): "FinComVoucherBatch"

The same shape as FinComDayHeads (approved 21-Oct-2026): a Voucher collection of **one day** (SVFROMDATE = SVTODATE,
`yyyymmdd` with `TYPE="Date"`, the form that gives exactly that day on every release), one filter. The bridge picks `a`
and `b` from that day's heads (FinComDayHeads, sorted by MasterID): `a` = the first MasterID of the group, `b` = the
N-th. Because only that day's entries are looked at, the range holds exactly the N asked; the bridge also checks every
returned entry is one it asked for, dated that day (the round-18 rule), and drops anything else.

FETCH = **exactly FinComVoucherObject's approved fields** (the FETCHLIST it sends today, its "LIST.*" items, and the
fields its strip keeps: 2.4.2 GST type, 2.4.3 TDS challan, 2.4.4 salary paid per employee, and the payroll lists the
strip reads), **plus the same ledger-line fields once more under `LEDGERENTRIES`** (55 names; section 4 says why). No new
kind of field. Tally sends only what the FETCH names (unlike the object export, which sends the whole voucher), and the
bridge's strip still keeps only the approved fields, as today.

Placeholders: `<company>` (escaped as today), `<yyyymmdd>` (the day), `<a>` / `<b>` (MasterIDs, digits only).

```xml
<ENVELOPE>
<HEADER>
<VERSION>1</VERSION>
<TALLYREQUEST>Export</TALLYREQUEST>
<TYPE>Collection</TYPE>
<ID>FinComVoucherBatch</ID>
</HEADER>
<BODY>
<DESC>
<STATICVARIABLES>
<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
<SVCURRENTCOMPANY><company></SVCURRENTCOMPANY>
<SVFROMDATE TYPE="Date"><yyyymmdd></SVFROMDATE>
<SVTODATE TYPE="Date"><yyyymmdd></SVTODATE>
</STATICVARIABLES>
<TDL>
<TDLMESSAGE>
<COLLECTION NAME="FinComVoucherBatch" ISMODIFY="No">
<TYPE>Voucher</TYPE>
<FETCH>
  GUID,
  MASTERID,
  ALTERID,
  DATE,
  VOUCHERTYPENAME,
  VOUCHERNUMBER,
  PARTYLEDGERNAME,
  NARRATION,
  ISCANCELLED,
  ISOPTIONAL,
  ALLLEDGERENTRIES.LEDGERNAME,
  ALLLEDGERENTRIES.AMOUNT,
  ALLLEDGERENTRIES.ISDEEMEDPOSITIVE,
  ALLLEDGERENTRIES.BILLALLOCATIONS.NAME,
  ALLLEDGERENTRIES.BILLALLOCATIONS.BILLTYPE,
  ALLLEDGERENTRIES.BILLALLOCATIONS.AMOUNT,
  ALLLEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD,
  ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.LEDGERNAME,
  ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.AMOUNT,
  ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.ISDEEMEDPOSITIVE,
  REFERENCE,
  REFERENCEDATE,
  PARTYGSTIN,
  PLACEOFSUPPLY,
  CMPGSTIN,
  IRN,
  IRNACKNO,
  IRNACKDATE,
  EWAYBILLDETAILS.BILLNUMBER,
  ALLLEDGERENTRIES.GSTHSNNAME,
  ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD,
  ALLLEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE,
  ALLLEDGERENTRIES.RATEDETAILS.GSTRATE,
  ALLLEDGERENTRIES.CATEGORYALLOCATIONS.CATEGORY,
  ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME,
  ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT,
  ALLLEDGERENTRIES.BANKALLOCATIONS.DATE,
  ALLLEDGERENTRIES.BANKALLOCATIONS.NAME,
  ALLLEDGERENTRIES.BANKALLOCATIONS.TRANSACTIONTYPE,
  ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTNUMBER,
  ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTDATE,
  ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE,
  ALLLEDGERENTRIES.BANKALLOCATIONS.UNIQUEREFERENCENUMBER,
  ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE,
  ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.CATEGORY,
  ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER,
  ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAXRATE,
  ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT,
  ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAX,
  ALLINVENTORYENTRIES.STOCKITEMNAME,
  ALLINVENTORYENTRIES.BILLEDQTY,
  ALLINVENTORYENTRIES.RATE,
  ALLINVENTORYENTRIES.AMOUNT,
  ALLINVENTORYENTRIES.GSTHSNNAME,
  ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEDUTYHEAD,
  ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE,
  ALLINVENTORYENTRIES.RATEDETAILS.GSTRATE,
  ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.CATEGORY,
  ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME,
  ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT,
  ALLLEDGERENTRIES.BILLALLOCATIONS.TDSDEDUCTEESECTIONNUMBER,
  ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*,
  ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*,
  GSTREGISTRATIONTYPE,
  COUNTRYOFRESIDENCE,
  ISREVERSECHARGEAPPLICABLE,
  ALLLEDGERENTRIES.GSTOVRDNNATURE,
  ALLLEDGERENTRIES.GSTOVRDNTAXABILITY,
  ALLLEDGERENTRIES.GSTOVRDNTYPEOFSUPPLY,
  ALLLEDGERENTRIES.GSTOVRDNINELIGIBLEITC,
  ALLLEDGERENTRIES.GSTOVRDNISREVCHARGEAPPL,
  ALLINVENTORYENTRIES.GSTOVRDNNATURE,
  ALLINVENTORYENTRIES.GSTOVRDNTAXABILITY,
  ALLINVENTORYENTRIES.GSTOVRDNTYPEOFSUPPLY,
  ALLINVENTORYENTRIES.GSTOVRDNINELIGIBLEITC,
  ALLINVENTORYENTRIES.GSTOVRDNISREVCHARGEAPPL,
  ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNNATURE,
  ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNTAXABILITY,
  ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNTYPEOFSUPPLY,
  ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNINELIGIBLEITC,
  ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNISREVCHARGEAPPL,
  STATPAYMENTTYPE,
  TAXPAYPERIODFROMDATE,
  TAXPAYPERIODTODATE,
  TAXCHALLANBSRCODE,
  TAXBANKCHALLANNUMBER,
  TAXCHALLANDATE,
  TAXCHEQUENUMBER,
  TAXCHEQUEDATE,
  TAXBANKNAME,
  TAXBANKBRANCHNAME,
  TDSNATUREOFPAYMENT,
  TDSSECTIONNO,
  ALLLEDGERENTRIES.TYPEOFTAXPAYMENT,
  ALLLEDGERENTRIES.STATNATURENAME,
  ALLLEDGERENTRIES.SUMMARYALLOCS.NAME,
  ALLLEDGERENTRIES.SUMMARYALLOCS.FROMDATE,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TODATE,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TDSNATUREOFPAYMENT,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TDSSECTIONNO,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TDSDEDNSTATUS,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TDSRESIDENTIALSTATUS,
  ALLLEDGERENTRIES.SUMMARYALLOCS.FORMTYPE,
  ALLLEDGERENTRIES.SUMMARYALLOCS.PAIDAMOUNT,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANBSRCODE,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKCHALLANNUMBER,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANDATE,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUENUMBER,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUEDATE,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKNAME,
  ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKBRANCHNAME,
  ALLLEDGERENTRIES.BANKALLOCATIONS.BANKEMPLOYEENAME,
  ALLLEDGERENTRIES.BANKALLOCATIONS.AMOUNT,
  CATEGORYENTRY.CATEGORY,
  CATEGORYENTRY.EMPLOYEEENTRIES.EMPLOYEENAME,
  CATEGORYENTRY.EMPLOYEEENTRIES.AMOUNT,
  CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.PAYHEADNAME,
  CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.ISDEEMEDPOSITIVE,
  CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.AMOUNT,
  LEDGERENTRIES.LEDGERNAME,
  LEDGERENTRIES.AMOUNT,
  LEDGERENTRIES.ISDEEMEDPOSITIVE,
  LEDGERENTRIES.BILLALLOCATIONS.NAME,
  LEDGERENTRIES.BILLALLOCATIONS.BILLTYPE,
  LEDGERENTRIES.BILLALLOCATIONS.AMOUNT,
  LEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD,
  LEDGERENTRIES.GSTHSNNAME,
  LEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD,
  LEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE,
  LEDGERENTRIES.RATEDETAILS.GSTRATE,
  LEDGERENTRIES.CATEGORYALLOCATIONS.CATEGORY,
  LEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME,
  LEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT,
  LEDGERENTRIES.BANKALLOCATIONS.DATE,
  LEDGERENTRIES.BANKALLOCATIONS.NAME,
  LEDGERENTRIES.BANKALLOCATIONS.TRANSACTIONTYPE,
  LEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTNUMBER,
  LEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTDATE,
  LEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE,
  LEDGERENTRIES.BANKALLOCATIONS.UNIQUEREFERENCENUMBER,
  LEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE,
  LEDGERENTRIES.TAXOBJECTALLOCATIONS.CATEGORY,
  LEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER,
  LEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAXRATE,
  LEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT,
  LEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAX,
  LEDGERENTRIES.BILLALLOCATIONS.TDSDEDUCTEESECTIONNUMBER,
  LEDGERENTRIES.TAXOBJECTALLOCATIONS.*,
  LEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*,
  LEDGERENTRIES.GSTOVRDNNATURE,
  LEDGERENTRIES.GSTOVRDNTAXABILITY,
  LEDGERENTRIES.GSTOVRDNTYPEOFSUPPLY,
  LEDGERENTRIES.GSTOVRDNINELIGIBLEITC,
  LEDGERENTRIES.GSTOVRDNISREVCHARGEAPPL,
  LEDGERENTRIES.TYPEOFTAXPAYMENT,
  LEDGERENTRIES.STATNATURENAME,
  LEDGERENTRIES.SUMMARYALLOCS.NAME,
  LEDGERENTRIES.SUMMARYALLOCS.FROMDATE,
  LEDGERENTRIES.SUMMARYALLOCS.TODATE,
  LEDGERENTRIES.SUMMARYALLOCS.TDSNATUREOFPAYMENT,
  LEDGERENTRIES.SUMMARYALLOCS.TDSSECTIONNO,
  LEDGERENTRIES.SUMMARYALLOCS.TDSDEDNSTATUS,
  LEDGERENTRIES.SUMMARYALLOCS.TDSRESIDENTIALSTATUS,
  LEDGERENTRIES.SUMMARYALLOCS.FORMTYPE,
  LEDGERENTRIES.SUMMARYALLOCS.PAIDAMOUNT,
  LEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANBSRCODE,
  LEDGERENTRIES.SUMMARYALLOCS.TAXBANKCHALLANNUMBER,
  LEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANDATE,
  LEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUENUMBER,
  LEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUEDATE,
  LEDGERENTRIES.SUMMARYALLOCS.TAXBANKNAME,
  LEDGERENTRIES.SUMMARYALLOCS.TAXBANKBRANCHNAME,
  LEDGERENTRIES.BANKALLOCATIONS.BANKEMPLOYEENAME,
  LEDGERENTRIES.BANKALLOCATIONS.AMOUNT
</FETCH>
<FILTERS>FinComVoucherBatchOnly</FILTERS>
</COLLECTION>
<SYSTEM TYPE="Formulae" NAME="FinComVoucherBatchOnly">$MasterID &gt;= <a> AND $MasterID &lt;= <b></SYSTEM>
</TDLMESSAGE>
</TDL>
</DESC>
</BODY>
</ENVELOPE>```

The same on one line, as the bridge would send it, is `captures/batch/b4-range.xml` of run 40750991113 (any release; the
five are byte for byte the same). The filter is written by `fcCollection` exactly as FinComDayHeads' by-type filter is:
`$MasterID &gt;= <a> AND $MasterID &lt;= <b>`.

## 3. The fallback request (B5) and the last resort

- **B5**, for a group of entries that are not next to each other in the day's list (for example only the few FinCom does
  not hold yet): the request of section 2 with the filter replaced by
  `$MasterID = <m1> OR $MasterID = <m2> OR ... OR $MasterID = <mN>` (at most 100 MasterIDs,
  digits only). Measured with B4 in every run: exact every time, kept fields identical, times within a few ms of B4.
- **One by one** with today's FinComVoucherObject (unchanged), as now.

## 4. Why the LEDGERENTRIES fields, and the one rule the bridge applies

For an item invoice (Sales or Purchase with stock items), a Voucher collection's `ALLLEDGERENTRIES` holds the invoice's
own ledger lines **and also the items' sales or purchase ledger**, summed (for each of the ten 50-item invoices:
"BI Sales 10,000.00" in addition to the party and the two tax lines). FinComVoucherObject's answer holds only the
invoice's own ledger lines (in `LEDGERENTRIES`, which today's strip writes as `ALLLEDGERENTRIES`) and the items with their
own sales-ledger lines under them. Taking the collection's `ALLLEDGERENTRIES` as it is would count the sales twice.

The collection's `LEDGERENTRIES` are exactly the invoice's own lines. So the bridge's batch converter does one thing
before the strip it already has (`fastStripCollection`): **for an entry that has items, it keeps `LEDGERENTRIES` as the
ledger lines and drops `ALLLEDGERENTRIES`**; every other entry is left as Tally sent it. B4 fetches the kept fields under
`LEDGERENTRIES` too, because without them TallyPrime 7.1 gives those lines without their bill name and type (B1 + the
rule: 140/150 identical on 7.1, 150/150 on 3.0-6.2; **B4 + the rule: 150/150 on all five**).

One more difference, not a field change: each batch entry carries `REMOTEID="<its GUID>"` on its `<VOUCHER>` element,
which FinComVoucherObject's answer does not. It equals the GUID (an approved field). The converter may keep or drop it;
the diff sets it aside and counts it (150/150).

Payroll entries (100 and 500 employees) came back identical with no rule: the strip writes their pay heads as ledger
lines exactly as for the one-by-one answer.

## 5. Measured times, per release (B4)

Times are Tally's full time for one request (median / 95th percentile / worst), "held" is the longest time Tally's window
did not answer during it. "Normal days" are the test days of 100, 300, 812 and 2,216 entries, including the group with the
50-item invoices and both payrolls; "big day" is a day of 7,601 entries (01-Aug or 02-Apr, ~1,00,000 phase only).
Every request returned exactly the entries asked (B4: 556 requests at ~30,000 and 700 at ~1,00,000 per release, all
forms together).

**N = 100 (recommended)**

| Release | ~30,000 entries, normal days | ~1,00,000, normal days | ~1,00,000, big day (7,601) | worst held |
|---|---|---|---|---|
| 7.1 | 152 / 426 / **426 ms** | 119 / 439 / **439 ms** | 890 / 1,052 / **1,052 ms** | 954 ms |
| 3.0 | 268 / 781 / **781 ms** | 206 / 815 / **815 ms** | 1,128 / 1,171 / **1,171 ms** | 983 ms |
| 4.1 | 284 / 832 / **832 ms** | 222 / 945 / **945 ms** | 1,314 / 1,342 / **1,342 ms** | 984 ms |
| 5.1 | 217 / 630 / **630 ms** | 208 / 629 / **629 ms** | 942 / 1,069 / **1,069 ms** | 973 ms |
| 6.2 | 296 / 912 / **912 ms** | 242 / 918 / **918 ms** | 1,339 / 1,405 / **1,405 ms** | 1,348 ms |

**Worst time by group size, every release and both company sizes (B4)**

| N | normal days, worst (release) | big day, worst (release) |
|---|---|---|
| 5 | 510 ms (4.1) | 1,251 ms (6.2) |
| 10 | 708 ms (4.1) | 1,261 ms (6.2) |
| 25 | 852 ms (6.2) | 1,255 ms (6.2) |
| 50 | 876 ms (4.1) | 1,319 ms (6.2) |
| **100** | **945 ms (4.1)** | **1,405 ms (6.2)** |
| 200 | 1,061 ms (6.2) | 1,559 ms (6.2) |

- **The size of the company hardly matters; the size of the day does.** On a day Tally spends about 0.1 ms per entry of
  that day just to look at it (0.76-1.17 s for 5 entries on a 7,601-entry day), then about 1-3 ms per entry it sends.
  Real books rarely have thousands of entries on one day; the 7,601-entry days are a deliberately hard case.
- **The 500-employee payroll inside a group:** worst 0.49-1.06 s for the group (FinComVoucherObject alone takes
  0.72-1.71 s for that one entry today).
- **The first group of a day**, right after its FinComDayHeads: at most 0.26 s on normal days and 0.76-1.21 s on a
  7,601-entry day. (In the first run, 40741546645, a first group asked long after the day's heads, on a 7,601-entry day,
  took 3.1 s on 7.1: the reason the bridge asks a day's groups straight after its heads and has the rule in section 6.)
- **Size of an answer:** about 0.8-2 MB for 100 ordinary entries; up to 11.6 MB for a group that holds the 500-employee
  payroll (FinComVoucherObject's answer for that one entry alone is 7.4-11.8 MB today).
- **FinComDayHeads itself** (approved, unchanged) on a 7,601-entry day took 2.4-8.1 s and held the window as long. That
  is today's rule already: over 2 s, the day is asked one voucher type at a time (F2), and a type still over 2 s is
  marked "upload the Day Book". Batching changes nothing there.
- **FinComVoucherObject one by one** (today, for comparison): median 5.7-10.7 ms an entry, worst 0.93-1.71 s (the
  500-employee payroll).

## 6. What the bridge does if a group is slow (2.4.9, for the build)

1. A day's groups are asked straight after that day's FinComDayHeads, in MasterID order, **100 at a time** (B4; B5 when
   the entries wanted are scattered). Every rule of today stays: one request in flight, the six conditions before each,
   postings first, idle only, the 2 s stop, only approved fields kept.
2. A group **stopped at 2 s** (or its late answer over 2 s): the late answer is thrown away, as today, and that day is
   asked again in **half-size groups** (50, then 25...).
3. A half-size group also over 2 s, or **any** group that held Tally's window 2 s or more: that day goes **one by one**
   with FinComVoucherObject (today's way; it does not depend on the size of the day). The freeze safety of 2.4.5 still
   applies: a window hold of 2 s stops the period for that company, as today.
4. A group answer that is not exactly the entries asked (missing, extra, another date) is not used; that day goes one
   by one (one log line).
5. Payroll entries: they may stay inside a group (worst 1.06 s with the 500-employee payroll); the 3-second allowance
   for payroll is not needed for a group. If the owner prefers, the bridge can keep payroll types (it learns them,
   `payrollLearn`) one by one.

## 7. Expected speed

- **Tally's share** for 100 entries: 0.12-0.30 s (median) instead of 100 x 6-11 ms = 0.6-1.1 s. The bigger gain is the
  bridge's own work before every request (the six conditions, the gate, the per-step checks): in the 2.4.5 gate (run
  39716414044) the night pace was 140 ms an entry while Tally's own time was about 10 ms, so about 130 ms an entry is
  the bridge's. With 100 entries a request that work is done once per 100.
- **Estimate:** the part of those 130 ms that is per request disappears; the part that is per entry (stripping,
  sending to FinCom) stays. If it is all per request: about **15,000 entries a minute** (100 entries per ~0.4 s); if
  10-20 ms of it is per entry: **2,500-4,500 a minute**. FinComDayHeads adds about 0.1-0.4 s per day (about 1-2
  minutes for a year).

| | today (2.4.5-2.4.8, measured) | 2.4.9 batch (estimate) |
|---|---|---|
| entries a minute | ~430 | ~4,000-15,000 |
| 1 lakh entries | ~3.9 h | ~7-25 min |
| 2 lakh entries | ~7.8 h | ~15-50 min |

The 2.4.9 gate measures the real pace with the bridge (g10) before anything ships.

## 8. Risks and limits

- **Tally's look at a whole day:** one group's time grows with the number of entries on that day (about 1 s at 7,600).
  A day with tens of thousands of entries would exceed 2 s; section 6 then falls back to one by one, and FinComDayHeads
  already splits such a day by voucher type.
- **Only the shapes in the test company were compared field by field:** accounting entries with GST, TDS, bank details,
  bills and cost centres; 50-item invoices; payroll. Stock journals, TDS challan payments and salary payments with bank
  allocations per employee were not in these 150 entries. The 2.4.9 gate runs the same diff on the tdsgst and payg
  companies before release.
- **Educational mode only** (the test machines): real books spread over every day of the year, which only makes days
  smaller.
- **GitHub's artifact storage for this account is full** (28-Oct: every artifact upload fails, e.g. run 40728112415 and
  the tally-versions run 40742050496). The batch harness was changed to need no artifact; other tally-versions modes
  (including 2.4.8's gate: run 40742050496 on cc7def746 failed at that upload) cannot run until the storage frees (artifacts expire after 3 days) or old artifacts are
  deleted.

## 9. What the owner is asked to approve

1. The request **FinComVoucherBatch** of section 2 (B4), with at most **100** entries a request, for the older-entries
   fetch only (the period the person chose, idle only, the per-computer switch as today).
2. Its list form (section 3, B5) for scattered entries.
3. The converter's one rule of section 4 (an entry with items: its LEDGERENTRIES are its ledger lines).
4. The slow-group rule of section 6 (halve, then one by one).

Nothing is built or sent until he approves the exact text above.
