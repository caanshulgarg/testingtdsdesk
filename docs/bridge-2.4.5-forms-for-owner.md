# Bridge 2.4.5: the exact Tally requests and tally.ini lines, for the owner's OK

Prepared 21-Oct-2026 (ROUND 102, stage A: measure, then ask). **Nothing here is built.** No request sent to Tally has
changed, and nothing has gone into `allowlist.go` or `pinned.go`. Every number below comes from the real-Tally harness on
GitHub's test machines (TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1, Educational mode, test data only). Nothing ran on the
owner's computer.

Branch `next-245` is cut from `origin/staging-next` at `26c21c60a`, with `next-245-prep` (the 15-Oct plan) merged in.
Bridge 2.4.4's source (`bridge-go/util.go` `BridgeVersion = "2.4.4"`) is the same on `tax-accuracy` (`9fbaa74d3`) and
`staging-next`. `staging-next` already contains every commit of `tax-accuracy`, and `bridge-go/` has no difference
between the two. So 2.4.5 is built on `staging-next`, which also carries ROUND 101's explicit-grants rule. No other merge
is needed.

## 0. The measurements

| Run | Mode | What | Company |
|---|---|---|---|
| 38790555479 (15-Oct) | `dbm` | the date forms D1-D5 and C1-C7, the splits S1-S3, the ledger counts L1-L5 | about 1,264 entries, 1,240 / 5,000 ledgers |
| 38790558578 (15-Oct) | `dbres` | the missing-day loop through Tally closed, a modal screen and Tally not answering | the same |
| **39542962661 (21-Oct, new)** | **`dbbig`** | the same forms on a **big company**, the voucher count of a period, **tally.ini** with the add-on, and **how long Tally's window was blocked** during each request | **30,009 entries, 20,000 / 50,000 ledgers** |
| 39538163208 (21-Oct) | `dbbig` | the first try: its tally.ini part is valid, but its counts are not (a harness bug, fixed in `9a71a11bb`) | - |

The results are on `tally-versions`: `spike-results/versions/<run>-summary.txt`, with every request's time in
`<run>-<release>-<mode>/versions/*-times.csv`. The harness is `.github/tally-spike/dbbigv.ps1` (commits `f641efa1d`
and `9a71a11bb`). The big company is ZZ BIG TEST re-dated onto the days that Educational-mode Tally accepts. Tally
refuses the previous year's dates as "Out of Range", so every entry is in FY 2026-27: 01-Jun has 100 entries, 02-Jul
300, 31-Aug 800, and the heavy day 01-Aug 2,216. 31-May is empty, and the other 12 days hold about 2,216 each.

How the harness worked:

- It sent **one request at a time**, stopped waiting at **2 s**, then waited for Tally's late answer before sending
  anything else, as the bridge does. "Worst" below is Tally's full time, including any time after the 2 s stop.
- **Window blocked** is new in `dbbig`. A thread asked Tally's window every 100 ms whether it answered within 250 ms. The
  figure is the longest time it did not. That is how long the person at Tally would see a frozen screen.
- Tally was **responding after every request** on every release, and **no request hung**.

**Two harness corrections.**

1. Every collection answer starts with Tally's own `<CMPINFO>` block, which holds `<VOUCHER>n</VOUCHER>` and
   `<LEDGER>n</LEDGER>`. The 15-Oct harness counted that block as one extra entry or ledger, so it reported C3-C7, S3 and
   L3/L4 as "+1, not exact". With the block left out, they are exact on every release. (`dbbig` leaves it out. The bridge
   already reads only `<VOUCHER ...>` rows inside `<COLLECTION>`.)
2. The 15-Oct `k5` HARNESS line was a PowerShell variable-name clash (`$K5` / `$k5`). The MEASURE lines for that check
   are valid.

## 1. Summary: what the measurements decide

| Need | Proposed form | Big company, worst on any release | Over 2 s? | Froze Tally? |
|---|---|---|---|---|
| (a) one day | **F1 "FinComDayHeads"**: that day's entry heads (collection form 3), then each entry by the existing **FinComVoucherObject** | heads 0.38 s for a 2,216-entry day; each entry 20 ms | no | no (window blocked at most 0.25 s) |
| (b) split by voucher type | **F2**: F1 plus `$VoucherTypeName = "<type>"` (measured form S3-5) | 1.08 s for 503 Purchase entries on the heavy day (4.1); 0.34 s on 7.1 | no | no (0.79 s at most) |
| (c) ledger count | **F3 "FinComLedgerIds"**: MasterIDs only, rows counted (L3). No computed figure. | 0.41 s at 50,000 ledgers | no | no (0.25 s) |
| (d) voucher count of a period (21-Oct) | **no new request**: the period's count is the **sum of F1's day counts** (a counting pass, one day at a time) | 0.38 s a day | no | no |

Rejected on the numbers:

- The **Day Book for one day** (all five date forms). D1-D4 ignore the date, and D5 moves Tally's own current date.
- **Voucher Register by type** (S2): 4.5 s.
- **`$$NumItems`** for ledgers (L1, L2): 5.3 s at 50,000 ledgers, and it breaks the no-computed-figure rule.
- **Every whole-period voucher count** (V1, V2): wrong for part of a year, and 3-5.3 s.

## 2. (a) One day of entries

### 2.1 The Day Book cannot do it

| Form | Date applied? | Times (dbm, 1,264 entries, 800-entry day) | Big company (2,216-entry day) |
|---|---|---|---|
| D1 yyyymmdd (today's `dayBookRequest`) | **no, on all 5 releases.** It answers for Tally's *current date*, not the date asked. This is the owner's 04-Oct finding, now reproduced on 3.0 to 7.1. | - | the current date's 2,216 entries: 28.8 s (3.0) / 35.4 s (7.1), window blocked up to 35 s |
| D2 d-MMM-yyyy, D3 yyyymmdd TYPE=Date, D4 d-MMM-yyyy TYPE=Date | **no** (the same as D1) | - | - |
| D5 = D1 + `<SVCURRENTDATE>` | **yes, on all 5** | 800 entries: 3.6 s (3.0), 5.3 s (4.1), 8.1 s (5.1), 5.8 s (6.2), 9.2 s (7.1) | 800: 2.5-3.6 s; 2,216: **6.9-10.2 s**, window blocked **6.7-9.9 s** |

Why D5 is not proposed:

1. **It moves Tally's own current date.** On every release, a plain D1 sent after D5 for 31-Aug came back with 31-Aug's
   800 entries. This was measured in `dbbig` (row "sticky"), and the `dbm` run order shows the same. On the owner's
   computer, that is the date the person sees in Tally and the date a new entry would default to.
2. Its answer is the full Day Book with every ledger line. Any day of 800 entries or more goes over 2 s and freezes
   Tally's screen for as long.

### 2.2 The proposed form: the day's heads, then each entry

**F1 - id `FinComDayHeads` (new id; the shape is FinComDatesProbe form 3, `formPlainT`, which is measure-only today):**

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComDayHeads</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>@@CO@@</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20260831</SVFROMDATE><SVTODATE TYPE="Date">20260831</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComDayHeads" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

- **What it is.** The builder is `formCollection("FinComDayHeads", co, formPlainT, d, d, "GUID, MASTERID, ALTERID, DATE", "")`.
  `@@CO@@` is the escaped company name. SVFROMDATE always equals SVTODATE.
- **What comes back.** One `<VOUCHER VCHTYPE="...">` row per entry of that day: GUID, MasterID, AlterID and date. The
  type is in the `VCHTYPE` attribute. There are no amounts and no ledger lines.
- **Then each entry**, by MasterID, with **FinComVoucherObject**. That request is already allowed and is unchanged. Its
  exact XML is `bridge-go/fastvch.go` `voucherObjectRequest`.
- **Every answer is checked.** Every row must carry the day asked (the round 18 rule). The date check of plan section
  3.3 stays as written.

The other collection forms (C4, C5 and C7) are also exact. C3 is the shortest of them, has no `$$` and no filter, and is
among the fastest. C7, with the filter and no static variables, takes 2.7-3.4 s on the big company.

Measured times for F1 (median / worst, ms):

| Release | dbm, 1,264 entries (any day up to 800) | big: 100-entry day | 800-entry day | 2,216-entry day | empty day | window blocked |
|---|---|---|---|---|---|---|
| 3.0 | 16 / 98 | 32 / 32 | 147 / 158 | 373 / 375 | 2 | at most 253 |
| 4.1 | 23 / 134 | 38 / 53 | 136 / 185 | 348 / 365 | 4 | at most 254 |
| 5.1 | 34 / 163 | 27 / 31 | 109 / 111 | 272 / 306 | 2 | 0 |
| 6.2 | 25 / 156 | 27 / 28 | 115 / 128 | 291 / 302 | 2 | at most 250 |
| 7.1 | 30 / 139 | 40 / 40 | 151 / 151 | 367 / 376 | 3 | at most 253 |

FinComVoucherObject, 100 entries of 31-Aug at 30,009 entries (median / worst, ms): 3.0 7.8 / 11, 4.1 8.7 / 15.9,
5.1 7.3 / 8.6, 6.2 7.0 / 10.9, 7.1 8.9 / 20. There were no overruns, and the window was never blocked.

So a 2,216-entry day costs one 0.4 s request plus 2,216 short ones of about 9 ms each, sent only while Tally is idle. At
no point is Tally held for more than 0.4 s. A day with roughly 10,000 entries or more would take F1 over 2 s
(extrapolated, not measured); that is what F2 is for.

- **Allow-list.** A new row `FinComDayHeads`, purpose "the entry heads (GUID, MasterID, AlterID, date) of ONE day the
  cloud listed as missing, then each by FinComVoucherObject", with maxSec 0.38 and measured 2026-10-21, run
  39542962661. It gets a new pinned shape.
- **Design rules it touches:**
  - **R2:** a new id, so it needs the owner's OK.
  - **ReadDays / round 18b:** it reads an old day. The narrow exception in plan 3.3 changes from "id Day Book" to "id
    FinComDayHeads", one day, and only days in the cloud's `fetchDays`.
  - **TestNoComputedFigure:** passes, because there is no `$$` beyond `$$SysName`.
  - **R1:** under 2 s with the 2 s stop.

## 3. (b) A day split by voucher type (used only when F1 is stopped at 2 s)

**F2 - the same id `FinComDayHeads`, one type per request (measured as S3-5: FinComDatesProbe form 5 plus the type):**

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComDayHeads</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>@@CO@@</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">31-Aug-2026</SVFROMDATE><SVTODATE TYPE="Date">31-Aug-2026</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComDayHeads" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE</FETCH><FILTERS>FinComDayHeadsOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComDayHeadsOnly">($Date &gt;= $$Date:&#34;31-Aug-2026&#34; AND $Date &lt;= $$Date:&#34;31-Aug-2026&#34;) AND $VoucherTypeName = &#34;Sales&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

The builder is `formCollection("FinComDayHeads", co, collFilterGE, d, d, "GUID, MASTERID, ALTERID, DATE", "$VoucherTypeName = \"<type>\"")`.
Each entry is then fetched by FinComVoucherObject, as in F1.

Measured times, every type exact on every release (median / worst, ms):

| Release | dbm: 31-Aug and 02-Jul, 6 types | big: 31-Aug (800), 6 types | big: 01-Aug (2,216), 6 types; largest type Sales 835 | window blocked |
|---|---|---|---|---|
| 3.0 | 52 / 89 | 108 / 126 | 270 / 303 | at most 252 |
| 4.1 | 72 / 110 | 106 / 141 | 613 / **1,080** | at most 786 |
| 5.1 | 80 / 114 | 88 / 101 | 211 / 257 | 0 |
| 6.2 | 71 / 112 | 90 / 101 | 210 / 277 | 0 |
| 7.1 | 80 / 122 | 123 / 153 | 293 / 343 | at most 252 |

- **Rejected: S2, the Voucher Register with `<VOUCHERTYPENAME>`.** It is exact, but it returns full entries. For 835
  Sales entries it takes 3.3-4.5 s, and the window is blocked for up to 4.2 s.
- **Rejected: S1, the Day Book with a type.** It returns nothing on any release.
- **Allow-list.** The same row as F1, plus the pinned filter shape `$VoucherTypeName = "<name>"`. The type names come
  from the cloud's list for that company.
- **Design rules it touches:**
  - **R2:** a new filter field `$VoucherTypeName`.
  - **TestNoComputedFigure:** `$$Date` appears only in the exact shape already exempt for `collFilterGE`.

If a single type of one day is still over 2 s, the owner's line P2 applies: "please upload that day's Day Book".

## 4. (c) The exact ledger count (Connect Tally, step 5)

**F3 - id `FinComLedgerIds` (new id; measured as L3; from source: `fcCollection("FinComLedgerIds", co, "", "Ledger", "MASTERID", masterRange(0, 0))`):**

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComLedgerIds</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>@@CO@@</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComLedgerIds" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>MASTERID</FETCH><FILTERS>FinComLedgerIdsOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComLedgerIdsOnly">$MasterID &gt; 0</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

- **The count** is the number of `<LEDGER NAME=...>` rows inside `<COLLECTION>`. Tally's own `<CMPINFO><LEDGER>`
  number is never used: it is not the ledger count (8,025 against 1,240).
- **No computed figure.**
- **If this one request is ever stopped at 2 s,** the same id is asked in chunks of 2,000 MasterIDs (`$MasterID > a AND
  $MasterID <= a+2000`), the shape the ledger read already uses. The bar then shows "of N" once the count pass is done.

Measured times, exact on every release at every size (median / worst, ms):

| Release | 1,240 | 5,000 | 20,000 | 50,000 | 50,000 chunked: each / all 27 | window blocked |
|---|---|---|---|---|---|---|
| 3.0 | 11 | 28 | 173 / 177 | 404 / **405** | 91-107 / 2,209 | at most 251 |
| 4.1 | 14 | 41 | 149 / 160 | 343 / 353 | 93-96 / - | at most 252 |
| 5.1 | 14 | 39 | 137 / 137 | 291 / 295 | 69-71 / - | 0 |
| 6.2 | 12 | 49 | 134 / 135 | 295 / 302 | 70 / - | 0 |
| 7.1 | 14 | 40 | 150 / 169 | 370 / 372 | 92-95 / 2,237 | at most 253 |

Rejected:

- **L1 `$$NumItems:Ledger` (TYPE Function) and L2 (COMPUTE `$$NumItems`).** They are exact, but at 50,000 ledgers they
  take 2.6-5.3 s (overruns 3/3 on every release) and block the window for up to 5.2 s. They would also need an
  exemption from TestNoComputedFigure.
- **L4 TDSDeskNames, chunked.** It needs no new id and is exact, at 114-123 ms a chunk, but it costs a full pass of
  names.
- **L5 AltMstId.** It is not a ledger count (1,456 against 1,240).

- **Allow-list.** A new row `FinComLedgerIds`, purpose "the ledger count for the step-5 bar: MasterIDs only, rows
  counted", with maxSec 0.41 and measured 2026-10-21, run 39542962661. It gets a new pinned shape.
- **Design rules it touches:**
  - **R2:** a new id.
  - **TestNoComputedFigure:** passes.
  - **R1:** under 2 s at 50,000 ledgers.

The ledger read itself (FinComLedgers, unchanged) took 171-234 ms a chunk at 20,000 and 50,000 ledgers, so progress
can be sent after every chunk.

## 5. (d) The voucher count of a chosen period (the owner's change of 21-Oct)

The owner's change: there is no automatic reading of all old data. The person chooses the period: a financial year, or
a half-year (Apr-Sep or Oct-Mar) when the company is big. Only that period is read, one day at a time, idle-only, with
the 2 s stop, the split by type and postings first. Progress reads "8,412 of 12,960 vouchers (65%) · 4,548 left".

### 5.1 One request for the whole period does not work

The harness measured three whole-period forms on 30,009 entries:

- **V1:** the F1 shape with a period instead of one day, FETCH MASTERID, rows counted.
- **V1 chunked:** V1 plus `$MasterID` ranges of 2,000.
- **V2:** a Company collection with `COMPUTE FCVCOUNT:$$NumItems:FinComVchPeriod`.

Results:

| Period | Tally holds | V1 / V1 chunked / V2 answered | Worst time, any release |
|---|---|---|---|
| Apr-2026 | 4,433 | **30,009** (all) | V1 5.1 s, V1 chunked 8.9 s (16 requests, 58-70 s in all), V2 3.9 s |
| Apr-Jun | 11,181 | **30,009** | 5.8 s / 6.4 s / 3.6 s |
| Apr-Sep (half-year) | 25,577 | **30,009** | 5.4 s / 9.5 s / 3.6 s |
| FY 2026-27 | 30,009 | 30,009 (right only because the year is everything) | 5.3 s / 5.1 s / 3.6 s |

So **Tally applies these static dates only when the period is one day** (F1 is exact on every day). For a longer
period it gives the whole company. Every whole-period form is also over 2 s at 30,000 entries, and the window is
blocked for 3-5 s. None is proposed.

### 5.2 The proposal: count the period one day at a time with F1 (no new request)

1. When the person chooses a period, the bridge first makes a **counting pass**: F1 for each day of the period, idle-only,
   one request at a time, about 0.03-0.4 s each. Those are the times measured above for days of 100 to 2,216 entries.
   - A year is about 365 such requests.
   - For each day it keeps Tally's count and the rows' MasterIDs and AlterIDs.
   - Per voucher type comes free, from each row's `VCHTYPE` attribute. For FY 2026-27 the harness got Sales 11,587,
     Purchase 6,604, Receipt 4,450, Payment 3,823, Journal 2,644, Contra 901, matching Tally's own list exactly.
2. **The total.** `y` = the sum of the days' counts. During the counting pass the bar reads "counting ... 132 of 365
   days".
3. **When a day is done.** A day is done when FinCom holds **every MasterID of Tally's heads for that day** at the same
   or a higher AlterID. Equal counts are not enough: an entry may have moved between days. `x` = the entries FinCom holds
   from the done days, plus the matching ones of a day in progress. "Left" = `y - x`. The percentage is `x / y`.
4. **A day that changes during the read** (a save in Tally) is counted again on its next turn. `y` may then change by
   that day's difference. The bar never shows `x` above `y`.
5. **Fetching** is then, for each day not yet done, the missing MasterIDs by FinComVoucherObject. The day's heads are
   already known, so there is no Day Book.

### 5.3 What "big" means: when FinCom offers half-years

| Company in the year | Counting pass (F1 x 365) | Fetch (about 9 ms per entry plus idle waits) | Proposal |
|---|---|---|---|
| up to 20,000 vouchers | about 30-60 s of Tally time in all | about 3 min of Tally time; at 3 days per 30 s, about 1 h of idle time at least | **whole year** |
| over 20,000 vouchers, or any day over 2,000 | the same | 30,000 vouchers: about 5 min of Tally time, over several idle hours | **offer Apr-Sep / Oct-Mar** |

- **Proposed threshold: more than 20,000 vouchers in the chosen year,** taken from the counting pass. Then the person is
  offered half-years.
- The measured reason a size limit matters at all: at 30,009 entries, every whole-period request took 3-9.5 s and froze
  the window. Day-by-day requests stayed under 0.4 s even on a 2,216-entry day. So the half-year is about **how long the
  read takes**, never about Tally freezing.
- The 20,000 figure is a proposal for the owner to set.
- The count itself needs no new request: it uses F1.

## 6. tally.ini: the add-on loaded by Tally itself (round 81 B)

### 6.1 The key names, as TallyPrime 3.0-7.1 read them (measured)

**TallyPrime's own tally.ini, as installed, is the same on 3.0, 4.1, 5.1 and 6.2** (39 lines). 7.1 adds 12 lines at the
end for incremental backup and migration ports. The TDL part of the file is:

```
;; Specify list of TDL files for user defined reports and changes.
;; TO STOP LOADING TDL FILES, set the following line to NO
User TDL = Yes
;;tdl = <tdlfile.1>
```

So the installed default already has **`User TDL = Yes`**, and the key for each file is **`TDL = <path>`**. Tally's own
comment writes it in lower case; Tally reads it case-insensitively. Both forms were proven on all five releases.

### 6.2 The exact lines the 2.4.5 installer would add

The normal case, where `User TDL = Yes` is already there, adds **one line**:

```
TDL = C:\ProgramData\FinCom\addon\FinComRecorder.tdl
```

`User TDL = Yes` is added only when the file has **no** `User TDL` line at all.

The rule, which the harness function `FcIniAdd` ran on every release:

1. **Add only.** No line is ever removed, changed or reordered. The file's line ending and encoding are kept.
2. **Where it goes.** Right after the last `TDL =` line. If there is none, at the end of the `[TALLY]` section.
3. **Idempotent.** If a `TDL =` line already names this path (case-insensitive, quotes and slashes ignored), nothing
   changes.
4. **Backup.** `tally.ini.fincom-bak` is written before the first change and never overwritten, so it keeps the
   client's original.
5. **When it takes effect.** At Tally's next start. Each tally.ini the bridge finds is done this way (ports.go already
   reads them).

Example: the 7.1 file with a client's own add-on (case A of the run). **Before:**

```
Default Companies = Yes
Load = 100000
User TDL = Yes
TDL = C:\fcother\FinComOtherTest.tdl
```

**After** (one line added, nothing else touched):

```
Default Companies = Yes
Load = 100000
User TDL = Yes
TDL = C:\fcother\FinComOtherTest.tdl
TDL = C:\ProgramData\FinCom\addon\FinComRecorder.tdl
```

On TallyPrime's own installed file, which has no live `TDL =` line, the new line goes at the end of the `[TALLY]`
section (case B, measured).

### 6.3 What the run proved on 3.0, 4.1, 5.1, 6.2 and 7.1

All checks i1-i4 passed on every release.

- **i2.** After a restart, Tally loaded the FinCom add-on: the add-on's own formula `FCRFolder` answered
  `C:\ProgramData\FinCom\recorder\`. The client's other TDL stayed loaded (its formula answered). The other lines stayed
  in their order, and the backup equalled the original.
- **i4.**
  - A second run of the rule changed nothing, byte for byte.
  - With the line already there, nothing was added.
  - **Tally did not rewrite or reorder tally.ini** after starting and closing.
- **i3, a decision for the owner.** When the client's file says `User TDL = No` and `User TDL = Yes` is added after
  it, Tally follows the **last** line. That turns on **all** the client's TDLs, not only FinCom's. **Proposal:** when a
  `User TDL = No` line exists, the installer does **not** touch tally.ini. It only logs this (Help & support), and the
  add-on is not auto-loaded on that computer.
- **Not proven: a recorder line written for an XML import.** No recorder line appeared after the harness's master
  import on any release. The load is proven by the formula instead. A save on the screen writing a line is the gate test
  of 2.4.5 (plan 8.2), as before.

## 7. Rules check

- **2 s rule.** Every proposed request (F1, F2, F3, and FinComVoucherObject) stayed under 2 s on every release at
  30,009 entries and 50,000 ledgers. The longest was **1.08 s** (F2, 503 Purchase entries, 4.1).
- **Froze Tally.** None of the proposed requests did. The longest window block was 0.79 s (F2 on 4.1). Everything else
  was at most 0.25 s, which is the probe's own step.
- **What did go over 2 s and block the window** (all rejected above):
  - D5: up to 10.2 s;
  - D1 on a large current day: up to 35 s;
  - S2: 4.5 s;
  - C7: 3.4 s;
  - L1 / L2 at 50,000 ledgers: 5.3 s;
  - every whole-period voucher count: up to 9.5 s.
- **Not hung, still responding.** No request hung, and Tally was responding after every one of the 1,041 requests per
  release.

## 8. What the owner is asked to approve

1. **F1 `FinComDayHeads`** (one day's heads), then each entry by FinComVoucherObject, with the ReadDays exception moved
   from "Day Book" to F1. This replaces the plan's D-form: the Day Book is not used for old days, because D5 moves
   Tally's current date.
2. **F2**, F1 split by `$VoucherTypeName`.
3. **F3 `FinComLedgerIds`** for the ledger count. No `$$NumItems`, so no exemption is needed.
4. **The period count as the sum of F1's day counts**: no new request. The **20,000-voucher** threshold for offering
   half-years.
5. **tally.ini.** The one line `TDL = C:\ProgramData\FinCom\addon\FinComRecorder.tdl`, plus `User TDL = Yes` only when
   no User TDL line exists. Nothing is done when the file says `User TDL = No`.

Not measured, and to be confirmed:

- **Licensed Tally.** These runs use Educational mode. The tray's "Test reading from Tally" on NWS144 already runs
  collection form 3, so it can confirm F1 on his own Tally.
- **A single day over about 10,000 entries.** That size was not made.
