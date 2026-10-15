# FinCom Bridge 2.4.5: plan (prepared 15-Oct-2026, to be built Monday 19-Oct-2026)

**Status: prepared only.** Nothing is built, released or published. No staging write. No bridge-go production code was
changed. This branch (`next-245-prep`) is cut from `origin/tax-accuracy` at `9fbaa74d3`, the branch that carries bridge
2.4.4's source (`bridge-go/util.go`: `BridgeVersion = "2.4.4"`).

The measurement for this plan is running now on the real-Tally harness (test machines only, never the owner's
computer). See section 7: runs **38790555479** (mode `dbm`) and **38790558578** (mode `dbres`), dispatched 15-Oct-2026
19:02 UTC from harness commit `7d8b00af6` on branch `tally-versions`.

---

## 1. What 2.4.5 does (the owner, 15-Oct-2026)

1. **Missing Day Book days are fetched automatically.** FinCom's cloud knows the gaps: the gap check, and the days it
   does not hold. The bridge asks Tally for **one day at a time**, using the existing Day Book request id. It does this
   only while Tally is idle, a few days per round, and stops each request at 2 s. If a day takes more than 2 s, the
   bridge splits it by voucher type. If a type is still over 2 s, the owner sees one quiet line asking him to upload
   that day. Otherwise the owner sees nothing. The bridge stops when Tally is busy, paused or self-stopped.
2. **The exact ledger count for the Connect Tally step-5 bar**, for example "312 of 1,240 ledgers". The bridge reports
   progress to FinCom during the read. Today it sends nothing until the round is complete (`ledgers.go` `ledgerList`
   / `pushLedgerList`, and `cloud.go` `beatOnce` carries no progress).

## 2. Design rules

| # | Rule (the owner) | How 2.4.5 keeps it |
|---|---|---|
| R1 | **Tally must never hang.** Every background request has a 2-second hard stop. Only one request is in flight per Tally. Postings go first. | Every request in this plan carries `limitMs = 2000`, through the existing hard stop (`tally.go`, TC.limitMs, then the next-inflight abandon wait). The existing per-Tally lock gives one request in flight. A day or ledger chunk is never asked while a posting is queued or running. |
| R2 | **No field or request may be added to anything sent to Tally without his OK.** He sees the exact forms on Monday. | Section 5 lists every candidate form as exact XML and says which rule each one touches. Nothing goes into `allowlist.go` or `pinned.go` until he has said yes to that exact form. |
| R3 | **No AI in the bridge.** | Nothing in this plan uses AI. The bridge's rules are fixed: counts, dates and times only. |
| R4 | **Staging only.** | The publish goes to staging only, after his word. The live site is never touched. |
| R5 | **"I don't want any error because of Tally, it should work flawlessly."** (15-Oct-2026) | Section 6. Every Tally condition is handled silently: wait, retry later, split, or resume from where it stopped. A person is needed in only three cases. Each of those shows one plain line with the tray bell, and never an error pop-up. |

Supporting facts, all from today's code and earlier rounds:

- **Old days are not read today.** Reading is behind `ReadDays=false`, which the cloud cannot change (`keep.go:186`
  `readDaysOn`). The dated-request guard is in `tally.go`, around line 305, "a request that carries a period". This is
  round 18b of 04-Oct-2026: "reading is prospective only". 2.4.5 changes that policy for one narrow case (section 3.3),
  so it needs his OK as a policy change, not only as a request form.
- **The four Day Book date forms are already allowed.** The Day Book request is pinned in all four forms
  (`pinned.go:64`, `dateForms`): yyyymmdd, d-MMM-yyyy, and each of those with `TYPE="Date"`. All four go under the
  allow-list id "Day Book", whose purpose is "one company for one month at most", so one day fits inside it.
- **The owner's Tally ignored the plain date form (04-Oct finding, round 18).** On NWS144, a request with plain
  yyyymmdd `SVFROMDATE`/`SVTODATE` was answered for Tally's current period, not for the dates asked. The 1,258 entries of
  FY 2026-27 came back for any date. No request uses `TYPE="Date"`. The seven collection date forms
  (`recorder_probes.go`, `FinComDatesProbe`) have never been run on a real Tally.
- **A one-day Voucher collection is slow and freezes Tally on a big company (push-design run 37591395905 [B]).** On
  30,012 vouchers, the collection with a one-day period and a `$MasterID` filter took 3.8 to 11.9 s and froze Tally's
  screen. The object export (`FinComVoucherObject`) took 0.12 to 0.17 s and did not freeze it. The Day Book report
  path has not been measured at that size. This is why the split and the 2 s stop matter.
- **The ledger read today.** It runs in chunks of 2,000 MasterIDs (`LedgerChunk`), and a timeout halves the chunk (down
  to `LedgerChunkMin` 125). Rows go to a local file. Nothing is pushed until the last, open-ended chunk has answered.
  Tally gives no count in advance, so 2.4.5 needs one request that asks for it (section 5.3).

## 3. Design A: missing days

### 3.1 Who decides which days

The cloud decides. The beat answer gains `fetchDays: {<company>: [yyyymmdd, ...]}`. This is a field between FinCom and
the bridge; nothing extra goes to Tally. The cloud builds the list from:

- `tally_recorder_gap_check` (the missing AlterIDs);
- the `gapDays` it already receives;
- the days in the books' period that it holds no entries for.

At most **3 days per beat answer**. The newest are sent first, and never a day already marked "upload".

### 3.2 When the bridge asks

All of these must be true. Each one is checked **without sending anything to Tally**:

1. Tally's process is running, its window responds, and its port is open.
2. `tallyBusy(port)` is false. Nothing is at Tally, and Tally has had no recent stop or no-answer spell (TallyBusySec
   8 s, cool-down, probe).
3. `paused()` is false. There is no self-stop (`selfwatch.go`) and no read stop from FinCom (`readStopRefuses`).
4. No posting is queued or running for this Tally, because postings go first.
5. **Idle (proposed):** no recorder line, meaning no save in Tally, in the last 60 s. The person at Tally comes first.
6. The retry schedule (`retry.go`) allows a request now.

The bridge asks for a few days per round: at most 3 days, then it waits for the next beat answer (30 s or more). If any
condition fails, the bridge simply waits for the next round. Nothing is shown.

### 3.3 The request, and the ReadDays exception

- **One day.** The request is `dayBookRequestForm(company, F, d, d)`, where F is the date form the measurement proves
  (section 5.1). If one form works on all five releases, that form is used. If the releases differ, the form is chosen
  per Tally release, read from Tally's answer header (PRODMAJORREL). That choice needs his OK, because round 18b removed
  "automatic date calibration".
- **The ReadDays exception is exact.** The dated-request guard (`tally.go`) allows id "Day Book" while `ReadDays` is
  off only when all of these hold:
  - SVFROMDATE equals SVTODATE;
  - the day is one the cloud named in `fetchDays`;
  - the form is the proven form;
  - `limitMs` is 2000.

  Everything else stays refused, exactly as today. Tests check each of these refusals.
- **Every answer is checked before it is used.** Every entry returned must be dated the day asked. If one entry
  carries another date, the date was not applied. In that case the whole answer is dropped, the day is marked "upload",
  day fetching stops on this Tally until the bridge restarts, and one log line names the form. A read with the wrong
  dates is never stored or sent (the round 18 rule).

### 3.4 Over 2 s, then split by voucher type

- **The day.** The hard stop fires at 2 s. As today (next-inflight), the bridge keeps the connection and waits up to
  TallyAbandonWaitSec (20 s), sending nothing else. The late answer is **thrown away**, not used. Rule R1 is about how
  long Tally is held. Using a late answer would reward a long hold.
- **The split.** The day is asked again once per voucher type, using the split form the measurement proves (S1, S2 or
  S3 in section 5.2), one type per request with a 2 s stop each. The cloud sends the type list with the day
  (`fetchDays` items become `{d, types:[...]}`). It takes the list from the types the company uses in its copy, and
  falls back to Tally's six standard accounting types.
- **Still over 2 s.** The day is marked "upload". The person then sees the one line in section 6.3, case P2, once per
  day. A day is never asked again after it is marked "upload".

### 3.5 Stopping and resuming

The queue is held in the cloud (`fetchDays`), so a bridge restart loses nothing. A day that was not answered (Tally
closed, refused, reset) stays pending and is asked again first, after the shared retry schedule: 5, 10, 20, 40, then 60
s. A day is "done" only after an answer that passes the check in section 3.3. The cloud is told `{day, entries, via:
"day" | "split"}` with the entries, through the existing upload path. Nothing is fetched twice once it is done.

## 4. Design B: the exact ledger count and progress

1. **The count first.** One request, the count form he approves (section 5.3), with a 2 s stop. If it is over 2 s or
   not answered, the bar runs without "of N", as Round 63 does today, and the count is asked again next round. This
   never shows as an error.
2. **The read.** As today: `readLedgerChunk` in chunks of 2,000 MasterIDs, halving on a stop, with each chunk under
   the 2 s hard stop. **New:** after each chunk the bridge sends `ledger_progress {company, round, read, of, at}` to
   the cloud. This is a small call, at most one every 2 s, and it never goes to Tally. The beat also carries the last
   progress, in case that call is lost.
3. **The bar.** The step-5 bar shows "312 of 1,240 ledgers". If a ledger is created during the read, `of` is raised to
   `read` and never shown lower than it. The final figure comes from the completed list.
4. **Resume.** The last MasterID read is kept with the round id (`newLedRound`). After Tally closes or the bridge
   restarts, the read continues from the next MasterID, and the progress never goes back.

## 5. The exact request forms to measure, and the rule each one touches

`@@CO@@` is the company (escaped). In the Day Book forms, `20991231` or `31-Dec-2099` stands for the one day. The
forms marked "from source" were written by a go test at `9fbaa74d3` (bridge 2.4.4), and the harness writes them again
from `bridge_ref`. Copies are in `tally-versions:.github/tally-spike/dbm/req/`. "New" forms are built in the harness by
the stated change (`dblib.ps1`).

### 5.1 One day of the Day Book

| Form | Exact request | Rule it touches |
|---|---|---|
| **D1** yyyymmdd (from source; today's `dayBookRequest`) | `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>@@CO@@</SVCURRENTCOMPANY><SVFROMDATE>20991231</SVFROMDATE><SVTODATE>20991231</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><EXPLODEFLAG>Yes</EXPLODEFLAG></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>` | On the allow-list ("Day Book", pinned). Touches **ReadDays / round 18b** (old days read). His Tally ignored this form on 04-Oct. |
| **D2** d-MMM-yyyy (from source; `dayBookRequestDMY`) | the same as D1, with `<SVFROMDATE>31-Dec-2099</SVFROMDATE><SVTODATE>31-Dec-2099</SVTODATE>` | The same as D1 (pinned in all four forms) |
| **D3** yyyymmdd TYPE=Date (from source) | the same as D1, with `<SVFROMDATE TYPE="Date">20991231</SVFROMDATE><SVTODATE TYPE="Date">20991231</SVTODATE>` | The same as D1 |
| **D4** d-MMM-yyyy TYPE=Date (from source) | the same as D1, with `<SVFROMDATE TYPE="Date">31-Dec-2099</SVFROMDATE><SVTODATE TYPE="Date">31-Dec-2099</SVTODATE>` | The same as D1 |
| **D5** D1 + current date (new) | D1 with `<SVCURRENTDATE>20991231</SVCURRENTDATE>` inserted after `</SVTODATE>` | **A new static variable**: needs **his OK**. It is a new pinned shape and a new allow-list shape, plus ReadDays. |
| C1-C7 collection forms (from source; `FinComDatesProbe`, measure-only) | `formCollection`: GUID, MASTERID, ALTERID, DATE of the day's Vouchers. C1-C4 use the four static-variable forms. C5 is `$Date >= $$Date:"…" AND $Date <= $$Date:"…"` with d-MMM-yyyy TYPE=Date. C6 is `$$IsBetween:$Date:…:…` with the same. C7 is the C5 filter alone. | Measure-only today. Using them in normal running moves an id out of measure-only, so it needs **his OK**. `$$Date` and `$$IsBetween` are allowed only in the exact shapes TestNoComputedFigure already exempts. |

### 5.2 One day split by voucher type

| Form | Exact request | Rule it touches |
|---|---|---|
| **S1** Day Book + type | the proven D-form with `<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>` inserted after `</SVTODATE>` | **A new static variable** on "Day Book": needs **his OK**. It is a new pinned shape. |
| **S2** Voucher Register + type | the D-form with `<REPORTNAME>Voucher Register</REPORTNAME>` and `<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>` | **A new report, so a new request id**, plus a new static variable: needs **his OK**, and a new allow-list row. |
| **S3** heads by type, then each entry | C5 or C7 with its filter becoming `($Date >= $$Date:&#34;31-Aug-2026&#34; AND $Date <= $$Date:&#34;31-Aug-2026&#34;) AND $VoucherTypeName = &#34;Sales&#34;` (the bridge's `formCollection` filter shape). Each MasterID returned is then fetched with `FinComVoucherObject` (already allowed, 0.12-0.17 s at 30,012 vouchers [B]). | A collection id moves out of measure-only (**his OK**), and a new filter field `$VoucherTypeName`. The object export is unchanged. |

### 5.3 The ledger count

| Form | Exact request | Rule it touches |
|---|---|---|
| **L1** `$$NumItems` (shortest) | `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Function</TYPE><ID>$$NumItems</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>@@CO@@</SVCURRENTCOMPANY></STATICVARIABLES><FUNCPARAMLIST><PARAM>Ledger</PARAM></FUNCPARAMLIST></DESC></BODY></ENVELOPE>` | **TestNoComputedFigure** (`$$` other than `$$SysName`), the allow-list text "no `$$` function other than `$$SysName`", and a **new request TYPE (Function)** and id. It needs **his explicit approval** and an exemption for exactly this form. It counts records, not money, but the rule is written without exceptions. The harness already uses this form for Tally's own release header (flowv.ps1), but never in the bridge. |
| **L2** Company collection + COMPUTE | `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComLedgerCount</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>@@CO@@</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComLedgerCount" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>NAME</FETCH><COMPUTE>FCLEDGERCOUNT:$$NumItems:Ledger</COMPUTE><FILTERS>FinComLedgerCountOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComLedgerCountOnly">$Name = &#34;@@CO@@&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>` | **TestNoComputedFigure** (`$$NumItems`), a new id and a new COMPUTE: needs **his explicit approval**. It keeps the bridge's usual Collection request shape. |
| **L3** MasterIDs only (no `$$`) | `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComLedgerIds</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>@@CO@@</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComLedgerIds" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>MASTERID</FETCH><FILTERS>FinComLedgerIdsOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComLedgerIdsOnly">$MasterID &gt; 0</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>` (from source: `fcCollection("FinComLedgerIds", co, "", "Ledger", "MASTERID", masterRange(0, 0))`). The count is the number of rows. It is also measured in chunks of 2,000 MasterIDs. | **A new request id** only: needs **his OK**. It asks for no computed figure, so TestNoComputedFigure passes. It returns a row per ledger (the name attribute and the MasterID), so the answer grows with the company. |
| **L4** `TDSDeskNames`, chunked (no new request) | `fcCollection("TDSDeskNames", co, "", "Ledger", "NAME,PARENT", masterRange(a, a+2000))`, as it is today | **No new request or field.** It uses an allowed id for a new purpose (counting), which is worth naming to him. It costs a full pass of names (N/2,000 requests) before the read. |
| **L5** `FinComCompany` AltMstId | today's company check | **Not a ledger count.** It is the highest master number for every master type, deletions included. It is measured only to show that it cannot be used. |

**Recommendation, to confirm on Monday from the numbers:** the shortest accurate form is L1. Choose it if it is exact
on all five releases at about 1,240 and about 5,000 ledgers, under 2 s, and he approves the `$$NumItems` exemption.
Otherwise choose L3 as one request, if it is under 2 s at 5,000 ledgers. Otherwise choose L3 chunked, accepting that
the count is then known only part-way through a big read. L4 is the fallback with no approval needed.

## 6. "No error because of Tally": every condition the bridge meets

### 6.1 Principle

A Tally condition is never shown as an error. The bridge waits, retries later, splits, or resumes from where it
stopped. The tray icon and its tooltip show the state ("Tally not open", "Tally busy"), as they do today. A
notification is used only when the person must act. It is one plain line with the bell, through `noticeGate` (once
per problem, never repeated after it is cleared), and never a pop-up error box.

### 6.2 The conditions

| Condition | What the bridge sees | 2.4.5 handles it silently by | A person is needed when |
|---|---|---|---|
| Tally closed | No process, port closed | Waiting, sending nothing. The day or chunk stays pending and resumes when Tally is back. | Never for fetching. (Postings already have the 2.3.5 "Tally not open" notice, once a day; that is unchanged.) |
| Company not open | The company is not in Tally's list, or Tally answers "Could not find…" | Waiting. The company's days stay pending, and nothing is marked. | Never. |
| Busy, or a modal screen open (a date box, an unsaved entry, Tally's own message) | The window may still respond. The answer is slow or held. | The 2 s stop, then the abandon wait (nothing else sent), then the retry schedule. With the idle rule (no save in 60 s), the bridge does not ask while someone is working. | Never. |
| Answer over 2 s | A stop | A day is split by type. A ledger chunk is halved (down to 125). The count is asked again next round. | Only when a type of one day is still over 2 s: line P2. |
| Port changed | The old port is closed | `findCompanyPortBg` finds the new port (as today). Nothing is shown. | Never. |
| Two copies or data locations (2.4.1 `dsrc`) | Another data folder or GUID | A day is fetched only from the folder FinCom chose for that company (the `dp=` and data-id rule of 2.4.1). Others are held, with no request. | When FinCom has no folder chosen and two are seen: line P3 (2.4.1's existing message, unchanged). |
| Company renamed | The same GUID with a new name | Days and ledgers are keyed by the company GUID. The new name is used. | Never. |
| Tally restarted mid-read | A refusal or reset, then a fresh process | The same day, or the same chunk from its MasterID, resumes after the retry schedule. The ledger round id is kept. | Never. |
| Network data folder slow | Every answer slow | Treated as "over 2 s". The fetch rate drops on its own because of the retry schedule. | When days keep ending as "upload": line P2 for each day, once. |
| Educational or licence mode | Tally may hold entries only on the 1st, 2nd and 31st, or show a licence screen at start | A licence screen means "company not open", so the bridge waits. An empty day in Educational mode is a valid answer of 0. | Never. |
| Version differences (3.0 to 7.1) | Forms may behave differently | Only forms the weekend run proved on all five releases. Otherwise the form is chosen per release header, with his OK. Every answer is checked for date (section 3.3). | When an answer fails the date check: day fetching stops on that Tally, and line P1. |
| Date filter not applied (his 04-Oct finding) | Entries of other dates come back | The answer is dropped and nothing is stored. Day fetching stops on that Tally. | Line P1. |

### 6.3 The only lines a person sees (bell only, once per problem)

- **P1:** "FinCom could not read single days from this Tally. Please upload the missing days' Day Book from Tally."
- **P2:** "Tally took too long to give 31-Aug-2026. Please upload that day's Day Book." (one line per day, once)
- **P3:** (unchanged, 2.4.1) the data-folder choice that 2.4.1 already shows.

He must approve the wording on Monday, along with the request forms.

## 7. The measurement (real-Tally harness, branch `tally-versions`)

Harness commit **`7d8b00af6`** adds modes `dbm` and `dbres` (`.github/workflows/tally-versions.yml`, `flowv.ps1`, and
new files `dblib.ps1`, `dbmv.ps1`, `dbresv.ps1`, `dbm/redate.py`, `dbm/req/`).

- **The test data.** ZZ BIG TEST's masters and vouchers come from its own generator at the ref. They are re-dated
  onto days that Educational-mode Tally accepts (the 1st, 2nd and 31st), keeping their order:
  - 01-Jun-2026: **50** entries
  - 02-Jul-2026: **300**
  - 31-Aug-2026: **800**
  - 31-Jan-2026: **300** (the year before the current one)
  - 01-Dec-2025: **0** (an empty day)
  - 8 on each other allowed day

  There are about **1,240**, then about **5,000**, ledgers. The truth is Tally's own undated list, not the plan of
  what was sent.
- **The harness rule.** Every measured request goes one at a time. The harness stops waiting at 2 s, then awaits
  Tally's late answer before sending anything else, as the bridge does. Every overrun is recorded (`dbm-times.csv`).
  The only exceptions are the harness's own setup imports and its truth lists, which run before the measurement.
- **`dbm` (k1-k6).** It measures, per release:
  - D1-D5 and C1-C7 on the five days: whether the date is applied (entries returned against Tally's own count), the
    time, and any overrun;
  - S1, S2 and S3 per type on the 800-, 300- and 300-entry days, and S3's per-entry object fetches;
  - L1-L5 at both ledger sizes: whether each count is exact, and its time;
  - the FinComLedgers chunks (the progress cadence of the bar);
  - Tally responding after every request.
- **`dbres` (r1-r5).** It runs the 2.4.5 missing-day loop and ledger read exactly as designed above (a reference
  model, because the bridge is built Monday) through four disturbances:
  - Tally closed after the first day and started again 25 s later (port first, company 25 s after that);
  - the Day Book's F2 date box left open for 40 s;
  - an unsaved Receipt with its date box open;
  - Tally not answering for 20 s (process suspended).

  Pass requires that every day ends fetched or marked "upload", nothing is fetched twice, every ledger is read once,
  the progress never goes back, the count is right, the harness never has to restart Tally, and Tally responds after
  every scenario. The "upload" lines appear as INFO with their exact wording.
- **Runs:** **38790555479** (`dbm`) and **38790558578** (`dbres`). Both use bridge_ref `tax-accuracy` (the 2.4.4
  request builders, which 2.4.5 does not change) on releases 3.0, 4.1, 5.1, 6.2 and 7.1. Each job is limited to 170
  min. Results are committed to `tally-versions` under `spike-results/versions/<run>-<release>-<mode>/` and
  `<run>-summary.txt`. **Due by Friday 16-Oct-2026: `dbres` by about 22:30 UTC on 15-Oct; `dbm`, which waits in the queue for Windows runners behind `dbres`, by about 02:00 UTC on 16-Oct (07:30 IST)**, which leaves the weekend for one
  re-run if a job ends as HARNESS.
- **Known limits:**
  - The company has about 1,800 vouchers, close to the owner's size (2,754 in FY 2025-26). At 30,000 vouchers the
    Voucher collection took 4 to 12 s [B], so a big client's day will more often go to the split or "upload".
  - The harness Tally runs in Educational mode. His licensed Tally may treat dates differently (04-Oct). That is why
    every answer is checked for date (section 3.3), and why the tray's "Test reading from Tally" on NWS144 (a person's
    action; it already tries the four Day Book and seven collection forms) is the quickest proof on his own Tally.

## 8. Shortened gate plan

### 8.1 What runs in parallel

| Track | What | When |
|---|---|---|
| Measurement | `dbm` and `dbres` on 5 releases (10 jobs at once) | Weekend: already running |
| Test-first code (form-independent) | The cloud's `fetchDays` and `ledger_progress`; the app's step-5 bar text; the bridge's day queue (idle rule, one day, split, upload, resume) and progress sender, against `faketally_test.go`, with the form behind one builder function | Monday morning, while results are read and he decides |
| The forms he approves | Builders, `pinned.go`, `allowlist.go` rows and `docs/tally-allowlist.md` table, the narrow ReadDays exception, and the TestNoComputedFigure exemption if L1 or L2 is chosen | Monday, after his OK |
| One combined review | Code and security in one pass on the frozen commit, instead of rounds | Monday afternoon, beside CI and the real-Tally run |
| CI, Windows CI, one real-Tally run on the committed setup | In parallel on the same commit | Monday afternoon |

### 8.2 Monday 19-Oct and Tuesday 20-Oct (IST)

| Time | Step |
|---|---|
| Mon 09:00-09:45 | Read `<run>-summary.txt` for both runs. Write `docs/bridge-2.4.5-results.md` in the push-design-results style. Pick D, S and L. |
| Mon 09:00-12:30 | **In parallel:** test-first code for everything that does not depend on the form (8.1, row 2). |
| Mon 09:45-10:15 | **The owner:** the exact forms (section 5) and the lines P1 and P2. He says yes or no per form. Optionally he runs "Test reading from Tally" on NWS144. |
| Mon 10:15-13:00 | The approved forms are wired in, test-first: builders, pinning, allow-list rows and times from the weekend run, the ReadDays exception, and the exemption if any. |
| Mon 13:00-14:00 | `go vet` (linux and windows), the full `go test`, `release-check.sh`, cloud and app tests. The code is frozen. |
| Mon 14:00-14:45 | Setup 2.4.5 built (`build.sh`) and committed with its `.sha256`. This is the exact file that will ship. |
| Mon 14:45-18:00 | **In parallel:** CI and Windows CI (about 15 min); **one real-Tally run** on the committed setup on all five releases (mode `g245`, written Monday morning from `dbresv.ps1`: the bridge itself, with a stub cloud, through close, modal and not-answering, plus `upg` from 2.4.4; about 2.5-3 h with the queue); **one combined code and security review** (about 2 h). |
| Mon 18:00-19:30 | Fixes, if any. A fix that does not touch a Tally request: re-run the affected tests and CI. A fix that does touch one: a new setup and the real-Tally run again, which moves to Tuesday 09:00-12:00. |
| Tue 09:00-10:00 | The results go to him. On his word, publish to **staging only**. |
| Tue 10:00 onward | He installs on his own computer (his action, never ours). The beats are watched: `fetchDays` progressing, no P-lines unless expected. |

### 8.3 What cannot be shortened, and why

1. **His OK on each exact form, before it enters the allow-list.** It is his rule. Code can be written beside it, but
   the shapes cannot be merged before he says yes. This costs about 30 min of his time on Monday.
2. **The real-Tally run on the committed setup.** It must run on the exact setup bytes (SHA-256) that ship. Any code
   change after it voids it. Install, Tally start, data import and the scenarios take about 2.5-3 h on five releases.
   The fake Tally cannot show Tally's own behaviour (the 04-Oct date finding came only from a real Tally).
3. **Measured times in the allow-list.** `release-check.sh` check 4 needs a worst case for every new or changed row.
   The weekend run gives them only for the forms it measured. A form changed on Monday needs re-measuring (about
   3 h).
4. **Windows CI on the final commit.** The bridge ships on Windows. The Linux tests do not cover the tray, the
   notifications or the instance lock.
5. **The combined review sees the final diff.** A fix after the review is re-checked (tests, and the real-Tally run
   if it touches a request).
6. **The staging publish waits for his word.**

### 8.4 What was removed from the usual gates

- Review rounds (r1-r5 for 2.4.4) become **one** combined pass.
- Measurement no longer comes before code. It ran over the weekend while the code is written test-first in parallel.
- There is no separate security round, because security is part of the one review.
- There is no second real-Tally gate before the setup, because the weekend's `dbm` and `dbres` cover Tally's side. The
  one run on the committed setup covers the bridge's side.
