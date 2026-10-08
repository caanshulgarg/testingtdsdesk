# Nightly self-check: the design, and the Tally requests that need the owner's approval

Item e of the next release (07-Oct-2026). Branch `next-selfcheck`. Nothing here is released, built or run on staging.

**What is built now** uses only requests already on the allow-list, byte for byte as their builders make them (no
shape changes, no new id; `docs/tally-allowlist.md` and `bridge-go/allowlist.go` are unchanged). **What needs a new
Tally request** (Tally's own trial balance, a ledger's closing balance) is written out below for the owner and is
**not built**.

## 1. The check, in short

Once a night, for each company open in this bridge's own Tally, while nobody is using Tally, FinCom Bridge asks: *did
every change Tally made since the last good check reach FinCom's copy?* It compares Tally's change counter and Tally's
own list of changed entries with what FinCom's cloud holds, fetches what is missing (one entry a request, as the live
recorder does), and records the result in plain words for the Tally page. FinCom's cloud adds a check of its own copy
(the copy's trial balance against the ledger openings and the entries received), with no Tally request at all.

## 2. When it runs

- **After hours only:** between 22:00 and 06:00 by the computer's clock (settings `SelfCheckFrom` / `SelfCheckTo`).
  A run after midnight belongs to the night that began the evening before.
- **Once a night per company:** the night is kept per company (`sync\selfcheck.json`); a check that completed, or was
  stopped by the 2-second rule, is not run again that night. A check that could not start (a posting going, someone
  in Tally, FinCom's cloud not reachable) is tried again at the next light check (every 10 minutes) in the same night.
- **Tally idle:** nothing goes while any of these holds: a posting going or an import in flight; this bridge holds the
  company's lease for a posting; reading stopped (FinCom's stop or the bridge's own); someone used this computer in the
  last 5 minutes (`SelfCheckIdleSec`, 300) or is working in Tally; Tally opened in the last 3 minutes; FinCom reading
  from Tally; the shared retry schedule waiting after a slow answer (2.3.1's `retry.go`).
- **One request at a time, postings first:** every request goes through the bridge's one Tally lock as a background
  request (`TC.bg`, the hard stop `TC.limitMs` = 2 s, gives way to a posting); the self-check runs one company at a time
  and sends one request of its own (the list); the fetches go one entry a request through the live recorder, which paces
  them and stops for a posting.
- **Each bridge on its own Windows user's Tally only** (`ledOwnPort`, as the masters' changes of 2.3.1).
- **Off in test mode** unless the settings say `"SelfCheck": true`; on by default otherwise (`SelfCheck: false` turns
  it off on a computer).

## 3. What it compares, and the requests it sends

| Step | What | Tally request | On the allow-list? |
|---|---|---|---|
| a | Tally's change counters ALTVCHID (entries) and ALTMSTID (masters) | **FinComCompany** (the light check's own request, already sent every 10 minutes; the self-check reads its answer and sends nothing itself) | Yes, unchanged (shape f3e3710802ed) |
| b | Tally's list of entries changed since the last good check (GUID, MasterID, AlterID, date), above the company's starting point | **TDSDeskKeepList**, the undated form above an AlterID (`keepListAboveRequest`, recorder source B's request; `keepAboveExact` holds it to the starting point or above) | Yes, unchanged (shape 4a2f4d8e19da; the undated form is the second builder pinned to the same id) |
| c | Each entry missing from FinCom's copy, fetched | **FinComVoucherByMaster** (exactly one MasterID, the entry's own date; `voucherByMasterRequest`), through the live recorder's body fetch; its own fallback by type and number (**FinComVoucherByNumber**) when Tally's answer is not the entry | Yes, unchanged (9708f011f6ce, 111afcb61eb9) |
| — | Which Tally holds the company (this bridge's own Windows user's) | **TDSDeskCompanies** / **TDSDeskCompanyInfo**, only when the bridge's list of open companies is older than 10 minutes (the light check keeps it fresh, so normally nothing) | Yes, unchanged |
| d | The masters counter against the number processed by 2.3.1's ledger changes | none (the light check has just sent **FinComLedgerChanges** when the counter moved; the self-check only reports how far behind it is) | — |

The comparisons:

1. **Counters.** Tally's ALTVCHID against (i) the AlterID up to which the last check proved FinCom complete (the
   company's *checked mark*, starting at the company's starting point) and (ii) the highest AlterID FinCom's copy holds
   for the book (the cloud works it out from `tally_vouchers`). Unmoved since the mark: nothing is asked of Tally at all.
   ALTMSTID against the ledger changes' last processed number: "N master changes not yet taken" when behind.
2. **The list.** The entries Tally lists above the mark are sent to the cloud (`kind:"selfcheck", step:"compare"`), which
   answers which of them its copy lacks: no entry with that GUID (*absent*), or one at a lower AlterID (*older*).
   An entry FinCom holds as deleted is reported, not fetched (FinCom never brings a deleted entry back).
3. **The copy's own trial balance** (cloud only, section 7).

Each change is proved once: an entry FinCom later loses below the mark is not listed again (only the copy check of
section 7 can show it, if it unbalances the copy). The mark moves to the ALTVCHID read at the start only when nothing is missing; when entries are still missing (or were
just fetched) it moves to just below the lowest of them, so the next night proves them again.

## 4. How it fetches what is missing

- The missing entries become recorder changes (`source: "selfcheck"`, their own line ids) in the live recorder's queue:
  the same body fetch, uploader, retry schedule, 2-second stop, "a posting goes first", ALTERID guard (above the
  starting point), the "full" entry of 2.3.1 and FinCom's duplicate / stale rules apply. Nothing new is sent to Tally.
- At most 200 a night per company (`SelfCheckFetchMax`); the rest are listed as still missing (fetched the next night,
  or by a Day Book upload).
- The self-check waits for its lines to leave the queue (`SelfCheckWaitSec`, 15 minutes at most), then counts: sent
  with Tally's entry = fetched; sent without it, or still waiting = still missing.
- An entry without a MasterID in Tally's list cannot be asked: still missing.

## 5. Large companies

- **The list's own limit:** TDSDeskKeepList above an AlterID goes with the 2-second hard stop. A list stopped at 2 s is
  not asked again that night; the check is recorded *not checked*, with words for a Day Book upload from the date of the
  last good check, and the mark stays.
- **Too many changes for one list:** more than 2,000 AlterIDs since the mark (`SelfCheckMaxSpan`) is not listed at all
  (same words). This mirrors source B's own cap.
- **2.3.2 stops entry fetches for a company over 2 s.** The self-check asks one hook, `entryFetchOffFor(company, guid)`,
  before fetching (2.3.2 wires its per-company stop to it; today it says nothing). While the entry fetch is off for a
  company, nothing is fetched: the missing entries are listed by their dates for a Day Book upload ("upload the Day Book
  for 03-Oct-2026 and 05-Oct-2026"). The list request (b) is one request a night and stays within the 2-second rule.
- On ZZ BIG TEST (30,004 entries) the list's time is Tally's filter over every entry, whatever the number listed: it is
  measured there before release with the existing request (it is source B's request; not a new measurement of shape).

## 6. Where the result is recorded, and what the Tally page says

Migration 65 (`server/tally-cloud/migration-65-selfchecks.sql`, add-only, not run): table `tally_selfchecks`, one row per
check, never updated or removed: firm, book, company, the computer key and bridge, ran_at, the night, Tally's ALTVCHID and
ALTMSTID, the highest AlterID FinCom holds, the mark checked from, listed, missing found, fetched, still missing, masters
behind, why it stopped, the days for a Day Book upload, the copy check, the result (`ok`, `fetched`, `missing`,
`not_checked`) and the words. Members of the firm read their own firm's rows; only tally-ingest writes
(`tally_selfcheck_record`, service role).

The Tally page, under each computer, one line per company: the last check's words, e.g.

- "Checked last night at 23:10: every change Tally made since 06-Oct-2026 is in FinCom (42 checked). FinCom's copy adds up."
- "Checked last night at 23:10: 3 entries were missing from FinCom; all 3 fetched from Tally."
- "Checked last night at 23:10: 5 entries are missing from FinCom; upload the Day Book for 03-Oct-2026 and 05-Oct-2026."
- "Not checked last night (23:10): Tally took longer than 2 s to list its changes. Upload the Day Book from 06-Oct-2026 to today to be sure nothing is missing."
- "Not checked since 05-Oct-2026" when the last row is older than two nights (Tally closed at night, or the bridge off).

## 7. The alternative to Tally's trial balance: the cloud's own, from its copy (built)

`tally_selfcheck_copy(book)`, run by the record, needs no Tally request. From FinCom's copy (`tally_tb`'s figures):

| Check | Catches |
|---|---|
| every live entry's lines add up to zero | an entry stored half (lines lost or doubled; 2.3.1's "read twice" fault would have shown here) |
| the ready totals (`tally_ledger_day`) equal the entries' lines, ledger by ledger | a ledger-day total out of step with its entries (a rebuild missed) |
| the movement over all ledgers is zero | the same, over the book |
| the openings' total (Tally's "difference in opening balances"), shown when not zero | an opening changed in Tally that FinCom kept wrong, *if* it unbalances the openings |
| ledgers named by entries but not in the ledger list | a ledger FinCom never received |

**What it cannot catch:** an entry missing altogether (a whole entry adds up to zero, so the copy still balances); an
entry with the right total but the wrong ledger or amount on both sides; a deletion in Tally that never reached FinCom;
an opening changed by the same amount on two ledgers; any difference between FinCom's figures and Tally's own. Steps a-c
cover the missing and older entries above the starting point; only Tally's own figures (section 8) would prove the
balances equal.

## 8. Needing the owner's approval (NOT built)

Both requests ask Tally for a figure it **computes** (a closing balance over a period). `TestNoComputedFigure` forbids
exactly this today; each would need the owner's written exception for that one id, a measurement on ZZ BIG TEST, a row on
the allow-list and its pin. Neither is in this branch.

### 8.1 Proposed: FinComLedgerClosings (recommended form of "Tally's trial balance")

Each ledger's closing balance as Tally works it out for the books' period, **200 ledgers a request by MasterID** (the
ledger list's chunking), compared ledger by ledger with the cloud's `tally_tb` on the same date.

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComLedgerClosings</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20261006</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComLedgerClosings" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>GUID, MASTERID, NAME, CLOSINGBALANCE</FETCH><FILTERS>FinComLedgerClosingsOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComLedgerClosingsOnly">$MasterID &gt; 0 AND $MasterID &lt;= 200</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

(made with the bridge's own `fcCollection`, `periodVars` and `masterRange`, so it is exactly what would be built.)

- **Why:** only Tally's own balances prove FinCom's figures equal Tally's (section 7's gaps: a whole entry missing below
  the starting point, a wrong ledger on both sides, a deletion not received). Ledger by ledger, a difference names the
  ledger to look at.
- **Size:** about 180 bytes a ledger: 36 KB a request of 200; a company of 1,500 ledgers is 8 requests, about 270 KB.
- **Time:** measured on 07-Oct-2026 (8.5): no answer within 300 s on any of TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1, with
  Tally's screen frozen. Not fit to propose as written.
- **The 2-second rule:** each request is a background request with the 2 s hard stop, after hours only, one at a time,
  postings first, 2 s rest between requests. A request stopped at 2 s ends that night's balance check for the company
  (no retry, no smaller split without a new decision); the page says "Tally's balances not compared tonight (Tally took
  longer than 2 s)". At most 25 requests a night per company (5,000 ledgers).
- **Read only, stored fields plus this one computed field, nothing else; each bridge on its own Windows user's Tally.**

### 8.2 Proposed: FinComLedgerClosingByName (one ledger's closing)

Asked only after 8.1 found a difference, for that ledger, to confirm it before saying so (or when the owner asks about one
ledger).

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComLedgerClosingByName</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20261006</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComLedgerClosingByName" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>GUID, MASTERID, NAME, CLOSINGBALANCE</FETCH><FILTERS>FinComLedgerClosingByNameOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComLedgerClosingByNameOnly">$Name = &#34;SAMPLE LEDGER&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

- **Size:** one row, under 1 KB. **Time:** one ledger's closing; to be measured on ZZ BIG TEST with its busiest ledger
  (the sales ledger of 30,004 entries). **2-second rule:** as 8.1; at most 10 a night.

### 8.3 Not recommended: Tally's "Trial Balance" report in one request

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Trial Balance</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20261006</SVTODATE><EXPLODEFLAG>Yes</EXPLODEFLAG><ISLEDGERWISE>Yes</ISLEDGERWISE></STATICVARIABLES></DESC></BODY></ENVELOPE>
```

One request for every ledger and group at once: its time grows with the whole company and cannot be cut into pieces;
on a 30,004-entry company it is the one request most likely to break the 2-second rule, and a stop throws all of it away.
8.1 gives the same figures in bounded pieces.

### 8.5 For the owner's decision: the trial-balance request in facts (the owner's ask of 07-Oct-2026)

**(1) The request and what it asks Tally, in plain words.** The XML is 8.1's, exactly as the bridge would build it (one
request per 200 ledgers by Tally's MasterID; 8.2 for one ledger by name). In plain words: *"For the company SAMPLE CO,
for the books' period 1 April 2026 to today, give me, for each ledger whose Tally id is from 1 to 200, its GUID, its Tally
id, its name and its closing balance."* It reads only; it never changes anything in Tally. The closing balance is the one
figure Tally works out (the rest are stored fields); that is why it needs the owner's exception to the "nothing Tally
computes" rule. Nothing else is asked: no entries, no groups, no report.

**(2) How long it took on the 30,004-voucher company.** Measured on the push-design harness (TallyPrime installed from
Tally's own download centre on a GitHub Windows runner, Educational mode; the heavy company the harness generates: the
light company's 4 vouchers plus 30,000 vouchers, 3,000 ledgers, 3,000 stock items), with no add-on and no bridge,
5 repetitions of each request, Tally's screen probed during each (the freeze probe of the v3 run: a key sent to Tally
120 ms after the request left and the time until the screen changed; an idle Tally answers it in tens of ms). A separate
workflow and branch (`selfcheck-tb.yml` on `selfcheck-tb`, `.github/tally-spike/push/tb.ps1`), so the push-design runs
on tally-versions were not cancelled or pre-empted (push-design run 37556025582 was in progress at the time).

**Result (run 37565051789, 07-Oct-2026, results committed on branch selfcheck-tb under
`spike-results/selfcheck-tb/37565051789-<release>/push/`: tb.csv, tb-summary lines in summary.txt):**

| TallyPrime | vouchers in the company | ledgers | FinComLedgerClosings, 200 ledgers a request | screen probe during it (idle: 16-45 ms) |
|---|---|---|---|---|
| 3.0 | 12 (the harness's heavy import failed on 3.0: "Godown '' does not exist") | 3,016 | no answer in 300 s, every request (25 of 25) | 4-11 s for the first requests, then no screen change within 30 s |
| 4.1 | 18,012 | 3,016 | no answer in 300 s (24 of 24) | no screen change within 30 s |
| 5.1 | 18,012 | 3,016 | no answer in 300 s (23 of 23) | no screen change within 30 s |
| 6.2 | 18,012 | 3,016 | no answer in 300 s (23 of 23) | no change within 30 s; one key answered after 29.5 s |
| 7.1 | 18,012 | 3,016 | no answer in 300 s (23 of 23); median and worst both 300 s (the harness's limit) | 4.4-15.8 s for the first requests, then no change within 30 s |

- **Median and worst:** not measurable: not one request answered within the harness's 300-second limit, on any release.
  The first request on each release (a fresh Tally, nothing queued before it) already ran past 300 s, so this is not
  the queue of the earlier requests: the request itself does not finish.
- **Tally's screen froze** while it ran: a key that an idle Tally answers in 16-45 ms took 4-16 s, and later got no
  response within 30 s.
- **Size:** the company held 18,012 vouchers, not 30,004 (the harness's sales invoices with items were refused, "600 of
  1000 created" a batch, on this harness revision) and only 12 on 3.0, and the request still did not answer. Its time is
  therefore not driven by the number of entries: the request as written (a Ledger collection with the closing balance
  over a period, filtered by MasterID) makes Tally work for minutes on 3,016 ledgers.
- **Not reached:** FinComLedgerClosingByName (8.2) and the Trial Balance report (8.3): the measurement step used its
  130-minute limit on the closings requests. They are not measured.
- **What this means for the 2-second rule:** the bridge's 2-second stop ends the bridge's wait, not Tally's work. Tally
  would go on with the request for minutes with its screen frozen. So the 2-second stop alone does not make this request
  safe. **Recommendation: do not approve 8.1 as written.** Before any balance request is proposed again, each form (8.1
  with a smaller chunk or no period, 8.2, 8.3) needs to be measured on its own, each in a fresh Tally, and must answer
  well within 2 s with no screen freeze on the 30,004-voucher company; until then the cloud's own check (section 7) is
  the trial-balance check.

**(3) When it would run, and what happens when it is slow.**
- Once a night per company, inside the self-check (section 2: 22:00-06:00, Tally idle, no posting, nobody at the computer
  for 5 minutes, one request at a time, postings first), after the change list and the fetches, only on the bridge's own
  Windows user's Tally.
- Every request stops at 2 seconds (the background hard stop, `TC.limitMs`).
- When a request does not finish in 2 s: no further balance request is sent for that company that night, none is
  retried that night and none is split smaller; the result is recorded "not checked" for the balances, in words, e.g.
  *"Tally's balances were not compared on the night of 06-Oct-2026: Tally took longer than 2 s for the closing balances of
  ledgers 1-200. FinCom's own check of its copy stands; nothing else was asked of Tally."* The 2-second stop puts the
  bridge's shared retry schedule (2.3.1) in place for its other background requests (15 s, 30 s, 1 min, 2 min, then 5 min
  at most, one try at a time); the balance request itself is never one of those tries. So there is no retry storm: at most
  one stopped request per company per night.
- At most 25 requests a night per company (5,000 ledgers); with 2 s rest between them.

**IX DESIGNS cannot be measured here.** It is a client's real books on NWS144; no tool of ours reads it for a test, and
these requests are not on the allow-list, so the bridge would refuse them. To measure there safely after the owner
approves: the person-started measuring tool (Measure Tally, for FinCom support; measure-only ids go only while it runs and
only when the owner starts it from the tray), with the two requests added to it as measure-only rows; run once by the
owner outside office hours with nobody in Tally; the same 2-second stop and the freeze probe's numbers written to its
report; read only, nothing sent to FinCom but the times.

### 8.4 Possible without a new request, to be confirmed first

Every collection answer of a real TallyPrime 7.1 begins with CMPINFO counters, among them `<VOUCHER>n</VOUCHER>`
(`testdata/real-tally-7.1`: 4, 8, 55, rising with the company's entries). If the owner confirms on NWS144 that it is the
company's number of entries, the self-check could compare it with the copy's count from the list answer it already gets
(no new request). Since 2.2.4 the bridge never reads CMPINFO as data, so this is not built until confirmed.

## 9. Files

- Bridge: `bridge-go/selfcheck.go`, tests `bridge-go/selfcheck_test.go` (the hook from the light check: `startpoint.go`).
- Cloud: `server/tally-cloud/index.ts` (kind `selfcheck`, steps `compare` and `record`), migration 65, tests
  `tests/run_migration65.py` (pg_stand) and `tests/run_selfcheck_server.py` (Deno).
- App: `src/js/49-tally-cloud.js` (reads `tally_selfchecks`), `app/src/screens/Tally.jsx` (the line), test
  `tests/run_tally_selfcheck_ui.py` (Playwright).
