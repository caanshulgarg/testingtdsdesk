# Faster older entries from Tally (next-fast-entries) — design

Status: **prototype on branch `next-fast-entries`, not released.** The owner approved designing new request XML
("Yes, design it"). Nothing here reaches a client: the new code runs only when the setting `FastEntries` is switched on
by hand on one computer (it is off by default). With it off, the bridge's request table (its rows, its hash, "measured")
and its beat are exactly staging-next's: the two new requests are not on the list at all and are refused before
anything is sent. With it on, the two requests join the list as **not yet measured**, so that computer's bridge reports
its table as unmeasured until the measurement in section 9 gives them their times.

## 1. What happens today, and why it is slow

The older-entries read (Books › From Tally › "Bring books from Tally", `bridge-go/daypull.go`) works one **day** at a
time:

1. FinCom's cloud hands the bridge days to read in the beat answer: **3 days an answer by day** (the beat runs every
   30 s), up to 30 an answer outside office hours (`tally_period_next_paced`, migration 98; `periodDaysFor` in
   `server/tally-cloud/index.ts`).
2. For each day: `FinComDayHeads` (that day's entry heads), `period_heads` to the cloud (the cloud answers which
   MasterIDs it lacks), then the entries, then `period_entries` to the cloud.
3. The entries come in groups of up to 100 of that one day (`FinComVoucherBatch`, 2.4.9) — but many entries are still
   asked **one by one** with `FinComVoucherObject`: payroll entries; any entry with an "On Account" bill allocation
   with no name (every TallyPrime release adds one in a collection that the object export does not have); on
   TallyPrime 3.0 to 6.2 any GST line with no type of supply; and the whole day after any group answer that is not
   exact or is stopped at 2 s.

Why it was built this way: the owner's freeze rule. The Day Book and big exports held Tally's window for seconds
(the earlier by-MasterID collection took 0.36–17.7 s; an object export without a FETCHLIST froze Tally on every
release). Everything since asks small, keyed things, each stopped at 2 s, one at a time, only while nobody is working
in Tally, postings first.

Where the time goes (reasoned from the code; to be confirmed by the ZZ TEST run): with 3 days handed out per 30 s
beat, a company of 2,651 entries a year (about 7 a day) can move at most about 6 days a minute — about 45 entries a
minute — whatever Tally's speed, plus the counting pass over the whole year first. That matches the 35–113 entries a
minute seen (the higher figures at night, when 30 days are handed out). The requests to Tally themselves are fast
(`FinComVoucherObject` 9–23 ms median; `FinComDayHeads` of a 2,216-entry day 376 ms worst); per-day round trips and the
hand-out are the bottleneck, and entries forced one by one cap a day's own speed at about 165 a minute (ROUND 104,
g10).

## 2. The proposal in one paragraph

Read a **window** of consecutive listed days at once: one request for the heads of all the window's days (W1), then
the entries the cloud lacks in groups that may span several days of the window (W2). The window and the group sizes
adapt: start small, grow while Tally answers well under 2 s, shrink at once on a slow answer, and fall back to
today's read on anything unexpected. What the bridge sends the cloud does not change: the same `period_heads` per day
and the same `period_entries` per day, with each entry exactly as `FinComVoucherObject`'s answer keeps it.

## 3. The two new requests (exact XML)

`@@CO@@` is the company name (XML-escaped as every request escapes it). Dates are yyyymmdd with `TYPE="Date"`, the
same date form `FinComDayHeads` and `FinComVoucherBatch` use (measured as the form that applies on TallyPrime 3.0–7.1).

### W1 — FinComWindowHeads (the heads of 2 to 31 consecutive days)

Example: 1-Sep-2025 to 7-Sep-2025.

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComWindowHeads</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>@@CO@@</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20250901</SVFROMDATE><SVTODATE TYPE="Date">20250907</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComWindowHeads" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

Why each part is safe:

- **It is `FinComDayHeads` with a longer period.** Same collection type (Voucher), same four fields (GUID, MASTERID,
  ALTERID, DATE), same date form; only SVTODATE differs. No ledger lines, no computed figure, no report, no Day Book.
- **Its cost is bounded by rows, and the rows are watched.** Measured for one day: 2,216 heads in 376 ms worst. The
  window is never more than 31 days, starts at 7 days, and is halved for the next window when an answer takes over 1 s
  or holds more than 3,000 rows (`FastEntriesWindowRows`); it grows (x2) only when an answer of a full-size window took
  under 0.5 s and held under 1,500 rows.
- **Every row must be dated inside the window.** One row outside (the period not applied) and the whole answer is
  dropped, nothing is stored or sent, and no window is asked of that Tally again until the bridge restarts; the days go
  back to today's per-day read (which keeps its own check).
- **Pinned and guarded.** Built only by `fastHeadsRequest`; `checkAllowed` refuses any other byte; the dated guard lets
  it through only with FastEntries on, for the window being read at that moment, under the 2 s stop, for a company whose
  starting point is recorded (`fastExact`).

### W2 — FinComVoucherWindow (a group of entries inside the window)

Example: MasterIDs 1201..1260 dated 3-Sep-2025 to 5-Sep-2025.

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComVoucherWindow</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>@@CO@@</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20250903</SVFROMDATE><SVTODATE TYPE="Date">20250905</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComVoucherWindow" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, PARTYLEDGERNAME, NARRATION, ISCANCELLED, ISOPTIONAL, ALLLEDGERENTRIES.LEDGERNAME, ALLLEDGERENTRIES.AMOUNT, ALLLEDGERENTRIES.ISDEEMEDPOSITIVE, ALLLEDGERENTRIES.BILLALLOCATIONS.NAME, ALLLEDGERENTRIES.BILLALLOCATIONS.BILLTYPE, ALLLEDGERENTRIES.BILLALLOCATIONS.AMOUNT, ALLLEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.LEDGERNAME, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.AMOUNT, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.ISDEEMEDPOSITIVE, REFERENCE, REFERENCEDATE, PARTYGSTIN, PLACEOFSUPPLY, CMPGSTIN, IRN, IRNACKNO, IRNACKDATE, EWAYBILLDETAILS.BILLNUMBER, ALLLEDGERENTRIES.GSTHSNNAME, ALLLEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD, ALLLEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE, ALLLEDGERENTRIES.RATEDETAILS.GSTRATE, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.CATEGORY, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME, ALLLEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT, ALLLEDGERENTRIES.BANKALLOCATIONS.DATE, ALLLEDGERENTRIES.BANKALLOCATIONS.NAME, ALLLEDGERENTRIES.BANKALLOCATIONS.TRANSACTIONTYPE, ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTNUMBER, ALLLEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTDATE, ALLLEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE, ALLLEDGERENTRIES.BANKALLOCATIONS.UNIQUEREFERENCENUMBER, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.CATEGORY, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAXRATE, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAX, ALLINVENTORYENTRIES.STOCKITEMNAME, ALLINVENTORYENTRIES.BILLEDQTY, ALLINVENTORYENTRIES.RATE, ALLINVENTORYENTRIES.AMOUNT, ALLINVENTORYENTRIES.GSTHSNNAME, ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEDUTYHEAD, ALLINVENTORYENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE, ALLINVENTORYENTRIES.RATEDETAILS.GSTRATE, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.CATEGORY, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT, ALLLEDGERENTRIES.BILLALLOCATIONS.TDSDEDUCTEESECTIONNUMBER, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*, GSTREGISTRATIONTYPE, COUNTRYOFRESIDENCE, ISREVERSECHARGEAPPLICABLE, ALLLEDGERENTRIES.GSTOVRDNNATURE, ALLLEDGERENTRIES.GSTOVRDNTAXABILITY, ALLLEDGERENTRIES.GSTOVRDNTYPEOFSUPPLY, ALLLEDGERENTRIES.GSTOVRDNINELIGIBLEITC, ALLLEDGERENTRIES.GSTOVRDNISREVCHARGEAPPL, ALLINVENTORYENTRIES.GSTOVRDNNATURE, ALLINVENTORYENTRIES.GSTOVRDNTAXABILITY, ALLINVENTORYENTRIES.GSTOVRDNTYPEOFSUPPLY, ALLINVENTORYENTRIES.GSTOVRDNINELIGIBLEITC, ALLINVENTORYENTRIES.GSTOVRDNISREVCHARGEAPPL, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNNATURE, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNTAXABILITY, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNTYPEOFSUPPLY, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNINELIGIBLEITC, ALLINVENTORYENTRIES.ACCOUNTINGALLOCATIONS.GSTOVRDNISREVCHARGEAPPL, STATPAYMENTTYPE, TAXPAYPERIODFROMDATE, TAXPAYPERIODTODATE, TAXCHALLANBSRCODE, TAXBANKCHALLANNUMBER, TAXCHALLANDATE, TAXCHEQUENUMBER, TAXCHEQUEDATE, TAXBANKNAME, TAXBANKBRANCHNAME, TDSNATUREOFPAYMENT, TDSSECTIONNO, ALLLEDGERENTRIES.TYPEOFTAXPAYMENT, ALLLEDGERENTRIES.STATNATURENAME, ALLLEDGERENTRIES.SUMMARYALLOCS.NAME, ALLLEDGERENTRIES.SUMMARYALLOCS.FROMDATE, ALLLEDGERENTRIES.SUMMARYALLOCS.TODATE, ALLLEDGERENTRIES.SUMMARYALLOCS.TDSNATUREOFPAYMENT, ALLLEDGERENTRIES.SUMMARYALLOCS.TDSSECTIONNO, ALLLEDGERENTRIES.SUMMARYALLOCS.TDSDEDNSTATUS, ALLLEDGERENTRIES.SUMMARYALLOCS.TDSRESIDENTIALSTATUS, ALLLEDGERENTRIES.SUMMARYALLOCS.FORMTYPE, ALLLEDGERENTRIES.SUMMARYALLOCS.PAIDAMOUNT, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANBSRCODE, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKCHALLANNUMBER, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANDATE, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUENUMBER, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUEDATE, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKNAME, ALLLEDGERENTRIES.SUMMARYALLOCS.TAXBANKBRANCHNAME, ALLLEDGERENTRIES.BANKALLOCATIONS.BANKEMPLOYEENAME, ALLLEDGERENTRIES.BANKALLOCATIONS.AMOUNT, CATEGORYENTRY.CATEGORY, CATEGORYENTRY.EMPLOYEEENTRIES.EMPLOYEENAME, CATEGORYENTRY.EMPLOYEEENTRIES.AMOUNT, CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.PAYHEADNAME, CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.ISDEEMEDPOSITIVE, CATEGORYENTRY.EMPLOYEEENTRIES.PAYHEADALLOCATIONS.AMOUNT, LEDGERENTRIES.LEDGERNAME, LEDGERENTRIES.AMOUNT, LEDGERENTRIES.ISDEEMEDPOSITIVE, LEDGERENTRIES.BILLALLOCATIONS.NAME, LEDGERENTRIES.BILLALLOCATIONS.BILLTYPE, LEDGERENTRIES.BILLALLOCATIONS.AMOUNT, LEDGERENTRIES.BILLALLOCATIONS.BILLCREDITPERIOD, LEDGERENTRIES.GSTHSNNAME, LEDGERENTRIES.RATEDETAILS.GSTRATEDUTYHEAD, LEDGERENTRIES.RATEDETAILS.GSTRATEVALUATIONTYPE, LEDGERENTRIES.RATEDETAILS.GSTRATE, LEDGERENTRIES.CATEGORYALLOCATIONS.CATEGORY, LEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.NAME, LEDGERENTRIES.CATEGORYALLOCATIONS.COSTCENTREALLOCATIONS.AMOUNT, LEDGERENTRIES.BANKALLOCATIONS.DATE, LEDGERENTRIES.BANKALLOCATIONS.NAME, LEDGERENTRIES.BANKALLOCATIONS.TRANSACTIONTYPE, LEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTNUMBER, LEDGERENTRIES.BANKALLOCATIONS.INSTRUMENTDATE, LEDGERENTRIES.BANKALLOCATIONS.BANKERSDATE, LEDGERENTRIES.BANKALLOCATIONS.UNIQUEREFERENCENUMBER, LEDGERENTRIES.TAXOBJECTALLOCATIONS.TAXTYPE, LEDGERENTRIES.TAXOBJECTALLOCATIONS.CATEGORY, LEDGERENTRIES.TAXOBJECTALLOCATIONS.PARTYLEDGER, LEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAXRATE, LEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.ASSESSABLEAMOUNT, LEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.TAX, LEDGERENTRIES.BILLALLOCATIONS.TDSDEDUCTEESECTIONNUMBER, LEDGERENTRIES.TAXOBJECTALLOCATIONS.*, LEDGERENTRIES.TAXOBJECTALLOCATIONS.SUBCATEGORYALLOCATION.*, LEDGERENTRIES.GSTOVRDNNATURE, LEDGERENTRIES.GSTOVRDNTAXABILITY, LEDGERENTRIES.GSTOVRDNTYPEOFSUPPLY, LEDGERENTRIES.GSTOVRDNINELIGIBLEITC, LEDGERENTRIES.GSTOVRDNISREVCHARGEAPPL, LEDGERENTRIES.TYPEOFTAXPAYMENT, LEDGERENTRIES.STATNATURENAME, LEDGERENTRIES.SUMMARYALLOCS.NAME, LEDGERENTRIES.SUMMARYALLOCS.FROMDATE, LEDGERENTRIES.SUMMARYALLOCS.TODATE, LEDGERENTRIES.SUMMARYALLOCS.TDSNATUREOFPAYMENT, LEDGERENTRIES.SUMMARYALLOCS.TDSSECTIONNO, LEDGERENTRIES.SUMMARYALLOCS.TDSDEDNSTATUS, LEDGERENTRIES.SUMMARYALLOCS.TDSRESIDENTIALSTATUS, LEDGERENTRIES.SUMMARYALLOCS.FORMTYPE, LEDGERENTRIES.SUMMARYALLOCS.PAIDAMOUNT, LEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANBSRCODE, LEDGERENTRIES.SUMMARYALLOCS.TAXBANKCHALLANNUMBER, LEDGERENTRIES.SUMMARYALLOCS.TAXCHALLANDATE, LEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUENUMBER, LEDGERENTRIES.SUMMARYALLOCS.TAXCHEQUEDATE, LEDGERENTRIES.SUMMARYALLOCS.TAXBANKNAME, LEDGERENTRIES.SUMMARYALLOCS.TAXBANKBRANCHNAME, LEDGERENTRIES.BANKALLOCATIONS.BANKEMPLOYEENAME, LEDGERENTRIES.BANKALLOCATIONS.AMOUNT</FETCH><FILTERS>FinComVoucherWindowOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComVoucherWindowOnly">$MasterID &gt;= 1201 AND $MasterID &lt;= 1260</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

Why each part is safe:

- **It is `FinComVoucherBatch`'s approved range form (B4) with the group's dates as the period.** The FETCH is
  byte-for-byte the approved one (frozen by its SHA-256, `batchFetchOK`; a build with any other FETCH sends no group).
  The filter is the approved `$MasterID >= a AND $MasterID <= b`.
- **The answer can only be the group.** A group is built from the window's heads (W1) so that *every* head of the
  window whose MasterID is in a..b and whose date is in the group's dates is a wanted entry of the group. The answer
  must then be exactly those entries, each once, each with its head's date and GUID — or it is not used.
- **The dates are as narrow as the group.** SVFROMDATE/SVTODATE are the first and last date of the group's own entries,
  never the whole window, so Tally walks only those days.
- **The same converter and strip as 2.4.9.** Each entry goes through `batchEntry` (the ledger-line rule, the payroll and
  pay-head checks, the GST and On Account checks, then `FinComVoucherObject`'s strip). An entry it would not take from
  a group stays wanted and is read one by one with `FinComVoucherObject`, as today. Payroll entries never go in a group.
- **At most 100 entries** (the owner's cap of 29-Oct-2026). Measured for one day: 100 entries 0.95 s worst on a day of
  up to 2,216 entries, 1.41 s on a day of 7,601.

## 4. The adaptive sizes and the fallback rules

| Event | What happens |
|---|---|
| Group answered in under 0.6 s, full size | next group x2 (10, 20, 40, 80, 100 at most) |
| Group answered in over 1.2 s | next group halved at once |
| Group stopped at 2 s | the owner's freeze rule, as the per-day path: the bridge waits until Tally has finished it, then the company's read **stops** (FinCom told; one quiet line to upload the Day Book of the days still missing); nothing is asked again by itself; the size is kept as the choice's cap (never asked at it or above again) |
| Window heads answered in over 1 s, or over 3,000 rows | next window halved |
| Window heads stopped at 2 s | the same: the company's read stops, nothing asked again by itself, the window size kept as the cap |
| Tally's window held 2 s or more during any request, or Tally not finished with a stopped request | the company's period stops, exactly as today (`pullStopCompany`, the owner's freeze safety) |
| Window heads not answered, or answered with a Tally error (LINEERROR) or with no list | never taken as "no entries": nothing is told to FinCom from it; the window waits for the next round; after 2 such failures its days are read as today (FinComDayHeads) |
| A window holding a day of more entries than a day may hold | its days are read as today at once (the per-day path marks the day) |
| A row of another date in a window | the answer is dropped; no window is asked of that Tally until the bridge restarts |
| A group answer not exactly the group, or not readable | not used; those days are read one by one as today |
| FinCom not answering a day's heads | the day waits 60 s, as the per-day path |
| A request refused before sending (allow-list, guard) | the fast read is off for this choice; today's read at once |
| Heads older than 60 s when a group is due | the window ends; what is left is read day by day (its heads asked again) |
| A posting queued or going, someone typing in Tally, a save waiting, the retry schedule waiting | nothing is sent; the window waits where it was (the six conditions, `pullMayAsk`, before **every** request) |

The sizes reached are kept per company and choice in `sync/fast-entries.json`, so a restart goes on at the same size
(and a choice the fast read was stopped for stays stopped).

## 5. Correctness: nothing missed, nothing doubled

- **Tally's own count per day** is the window's heads split by date, the same list today's `FinComDayHeads` gives;
  each day is told to the cloud with its count (`period_heads`, also for a day with no entries). The cloud marks a day
  done only when it holds every entry Tally lists for it (unchanged).
- **Each group is checked against those heads**: exactly the entries asked, each once, each dated as listed, each with
  its listed GUID. Anything else: not used.
- **Sends are confirmed**: entries go in `period_entries` per day (today's `pullFlush`); only after the cloud's `ok`
  are they counted as sent. A restart loses only what was read and not yet confirmed; the cloud lists those days again
  and answers only what it still lacks, so nothing is sent twice. (Tested: a restart in the middle of a window.)
- **Cancelled and optional entries** go as today: the Voucher collection lists them, ISCANCELLED and ISOPTIONAL are
  fields of the approved FETCH, nothing is filtered on them, and the strip keeps them exactly as `FinComVoucherObject`.

## 6. Speed: what to expect (estimates — real figures need the ZZ TEST run)

Honest summary: **the new requests alone help most at night.** By day the cloud still hands out 3 days per 30 s beat,
so a window is 3 days and the speed stays close to today's (one heads request instead of three; groups across days).
The big gain by day needs one small cloud change (decision 1 below): hand out up to 30 days per answer by day too, for
a computer whose beat says the fast read is on.

| Case | Today (from the code and the figures seen) | With windows and 30 days an answer |
|---|---|---|
| Small company (about 7 entries a day, 2,651 a year) | 35–113 entries a minute, 25–75 min | about 200–450 entries a minute, about 6–15 min (cloud round trips per day are then the limit: 2 per day with entries, 1 per empty day) |
| Busy company (100+ entries a day) | bounded by groups of one day and per-day round trips | about 600–1,500 entries a minute (groups of 100 at about 1 s each, plus the sends) |
| Entries that must go one by one (payroll; bill-wise On Account; GST lines on TallyPrime 3.0–6.2) | about 165 a minute | unchanged, about 165 a minute — no gain for those entries |

Reasoning for the small company: 30 days are about 220 entries; one W1 (well under 0.5 s), 3–4 W2 groups (0.2–1 s
each), about 30 `period_heads` and up to 30 `period_entries` calls to the cloud (0.2–0.5 s each): 15–35 s per 30 days.
The counting pass over a whole year becomes 12–13 W1 requests instead of 365 `FinComDayHeads`.

These are estimates from the code and earlier measurements on other requests. Tally's real cost of W1 over many days
and of W2 over several days is **not measured yet**; it must be measured before any client.

## 7. Speed told in the beat

Only with FastEntries on: `periodPull.fast` in the beat — the switch, the sizes, the window requests sent, and
`speed: [{company, guid, perMin}]`, the entries the cloud confirmed in the last 10 minutes of the period's own days
(never counting days or "Check for changes" days), a minute; no figure until two sends at least a minute apart. With
the switch off the beat carries none of this (it is staging-next's). The cloud keeps a fast bridge's speeds by book
(the book of that company whose recorded company GUID is the bridge's: `speedBooksFor`), and the page uses the book's
speed for "about N min left" while the beat is under 3 minutes old and the entries are being brought; otherwise the
cloud's own estimate (`tally_period_status_of`), as before.

## 8. Settings (all in the bridge's settings file; nothing changes unless set)

| Setting | Default | Meaning |
|---|---|---|
| `FastEntries` | off | the switch |
| `FastEntriesWindowDays` | 7 | the first window (2 to 31) |
| `FastEntriesWindowMaxDays` | 31 | the largest window |
| `FastEntriesWindowRows` | 3,000 | rows above which the next window is halved |
| `FastEntriesBatchStart` | 10 | the first group |
| `FastEntriesBatchMax` | 100 | the largest group (never above 100) |

Switching `FastEntries` off returns to today's read at once (rollback).

## 9. Test plan on ZZ TEST (office server), before any client

**Step 0 — on the real-Tally test runners, before the office server** (as 2.4.5 and 2.4.9's forms were measured,
tally-versions): W1 for windows of 2, 7, 14 and 31 days on companies of 30,000 and 100,000 entries, and W2 for groups
of 10, 50 and 100 spread over 1, 3 and 7 days, on TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1. Record the worst time, the
longest time Tally's window did not answer, and compare every kept field of W2's entries with `FinComVoucherObject`'s
answer (as the 2.4.9 gate did, 150 of 150). Pass: every W1 and W2 under 1.5 s worst, window held under 1 s, every field
identical. Only then are the two rows of the allow-list given their measured times.

**What the owner does on the office server (ZZ TEST only, no client company open):**

1. Open TallyPrime with only the ZZ TEST company loaded.
2. We install the staging build from this branch on that computer and switch `FastEntries` on for that computer only.
3. In FinCom: Books › From Tally › Bring books from Tally, choose one year of ZZ TEST, Start. Note the time.
4. While it reads, work in Tally for 5 minutes as usual: open a ledger, enter one voucher, open the Day Book. Say if
   Tally ever feels stuck, even for a moment.
5. Post one entry from FinCom to ZZ TEST while it reads; check that it reaches Tally at once.
6. Close Tally for one minute in the middle, open it again; then restart the FinCom Bridge once (from the tray).
7. Leave it running in the evening (outside office hours) and note when it finishes.

**What we watch:**

- In the bridge log: each window's line ("the heads of ... Tally lists N entries (ms)") and each group's line ("N
  entries of ... read in one request (ms)"); the worst time must stay under 1.5 s; no "took Tally over 2 s", no "Tally's
  window did not answer", no period stopped.
- The posting in step 5 goes before the next read request (the log order).
- Reading pauses while the owner works in Tally (step 4) and goes on after 60 s idle.
- After step 6 the read goes on; no entry is sent twice (the cloud's count of entries per day equals Tally's; no
  duplicate GUIDs).
- At the end: FinCom's count for every day equals Tally's (the period shows "All N entries ... are in FinCom"), and a
  sample of 50 entries is compared field by field with Tally.
- The speed: `entriesPerMin` in the beat and the page's "about N min left" against the real finishing time, by day and
  at night.

Pass on all of these, twice (two different days), before any client computer has the switch on.

## 9b. What the release check needs

With FastEntries off a build of this branch reports staging-next's table (the same rows, hash and "measured"), so the
switch-off case does not hold the release check back. To allow the switch on a computer, the two rows need their
measured worst times and the date: Step 0 above (real TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1, at 30,000 and 100,000
entries): W1 for windows of 2, 7, 14 and 31 days; W2 for groups of 10, 50 and 100 spread over 1, 3 and 7 days; the
worst time, the longest time Tally's window did not answer, and every kept field of W2's entries compared with
FinComVoucherObject's answer. Pass: every request under 1.5 s worst, window held under 1 s, every field identical. The
times then go into `fastAllowList` (maxSec, measuredOn), and the ZZ TEST run on the office server (section 9) follows
before any client.

On the owner's own TallyPrime (one computer) this measurement is the bridge's tray item "Measure the fast read on the
company open in Tally" (next-fast-measure, bridge 2.5.9: bridge-go/fastmeasure.go; the steps for the owner:
docs/fast-entries-measure-steps.md). The owner's decision of 08-Nov-2026 replaced "ZZ TEST only": it is run on a REAL
client company, to see the real speed (ZZ TEST is allowed too). It runs the plan above scaled to one company, on the one
company open in Tally, which must be linked to a FinCom client with its GUID (FinCom checks before anything is asked of
Tally), with FastEntries off, pinned to that company's exact name and GUID (re-checked before every request), and stops
at the first request over 2 s or a window hold of 1 s. Its result (times, counts, field names; no entry data) is kept in
tally_fast_measures (migration 148) with the book, and shown under Advanced on the Tally page. A pass there allows
switching FastEntries on for that one computer only (the same TallyPrime release, books about as big as the one
measured); release-wide times still need every release, 3.0 to 7.1.

## 10. Decisions

Taken (the owner, 07-Nov-2026, "Yes to both"):

1. **The cloud's hand-out by day.** `server/tally-cloud/periodpace.js` (`periodPace`): a bridge whose beat says
   `periodPull.fast.on === true` is handed up to 30 days per beat answer by day too; every other bridge as before (3 by
   day, 30 outside office hours). The pace said to the database (`p_night` of `tally_period_next_paced`) stays the
   computer's own hours, so the status line does not call a fast bridge's day "night". No database function changed.
   The bridge keeps up to 30 listed days by day when FastEntries is on (`applyPeriodDays`); its night pace (more
   requests a turn, no rest) still follows `periodNight` only.
2. **The page's time left.** The cloud keeps the bridge's speed from its beat (`info.beat.periodPull.speed`,
   `[{book, perMin}]`, a fast bridge's only, matched by the book's company GUID); the page (`app/src/lib/pullSpeed.js`, used by `bookSum`) uses it for the rate and "about N
   min left" while the beat is under 3 minutes old and the entries are being brought (not while the year's days are
   counted); otherwise the cloud's own estimate (`tally_period_status_of`), as before.

Still open: the first sizes (7 days, 10 entries; cap 100), and the entries that still go one by one (a separate
decision).
