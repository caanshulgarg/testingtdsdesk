# Code review: FinCom Bridge 2.5.12 (a voucher-mode sale read; one entry never sinks a day; day lists by range)

Reviewers: the session that built it (a self-review against the owner's rules), after the independent review of
f1b3e700b (seven points; all addressed below). The coordinator reviews again.

Range: ff86083bf..53be56303 (origin/staging-next, which holds released 2.5.11, to this build; 53be56303 merges origin/staging-next 6a8249a34, which changes no bridge-go file: the bridge sources are e6a43e67b's)

(bridge-go/: fastvch.go (liveKeepInv2512 kept by the strip only, fastEmit's order, fastVoucherModeItems, fastHasItems /
fastOKNoInv), batch249.go (FinComVoucherBatch's FETCH 2.5.11's again; pullKeep), daypull.go (pullHoldEntry,
pullKeep, the day's last period_entries says "held"), range2512.go (new), pinned.go and daypull.go dayHeadsExact (the
range form pinned and guarded), allowlist.go (FinComDayHeads' words; the stock row's version word), util.go (2.5.12);
tests r2512_test.go, r2512range_test.go, the version tests, the voucher-mode goldens. server/tally-cloud/index.ts
(heldOf, periodHold, the held words, a bridge update releases held days), migration-154-period-held.sql (new, not run).
app/src/parts/TallyFetch.jsx (the held line and Try again now). tests/run_migration154.py (new), run_period_ingest.py
(section 5), run_parse_fast234_kinds.mjs. docs.)

## 1. The voucher-mode sale is read (fastvch.go)

- The strip keeps ALLLEDGERENTRIES.INVENTORYALLOCATIONS.STOCKITEMNAME, BILLEDQTY, RATE, AMOUNT only in an entry with no
  item of its own, inside the line after its own fields, and writes each as one of the entry's items (ALLINVENTORYENTRIES
  with ACCOUNTINGALLOCATIONS: the line's ledger), as Tally's own collection gave them: parse.js reads the five releases'
  voucher-mode invoice field for field as the 2.3.3 request's answer (run_parse_fast234_kinds.mjs: 112 entries, 0 held).
  Every other capture strips byte for byte as 2.5.11 (TestR2512OrdinaryVouchersUnchanged).
- Review point 5: no request changes for it. FinComVoucherBatch's FETCH is 2.5.11's again (SHA cd914d4c22ca...,
  TestR2512GroupRequestAs2511: b4-range.xml and b4-list.xml byte for byte, the window form the same text); a group's
  voucher-mode entry (its items listed by Tally, the stock item still under the line) is held by the strip and left for
  FinComVoucherObject, whose FETCHLIST is unchanged (Tally ignores it and sends the whole voucher).
- Review point 6 (accepted): the strip is the live recorder's and the posting checks' too, so a voucher-mode sale saved
  in Tally now goes with its body there as well (said in the test sheet).

## 2. One entry never sinks a day; the day stays open; the entry comes in by itself (review point 3)

- Bridge: an errFastShape entry, or one over 2 MB, is held alone (pullHoldEntry): out of the wanted list, NOTHING of it
  sent as an entry (2.5.12's first build sent its head, which tally-ingest kept as seen: the day looked done with the
  voucher missing or stale; removed). The day's last period_entries says "held": [...] ([] when none, so an earlier mark
  clears). Asked counted once (review 7: the double count of an oversize entry removed); the log line counts the held
  entries apart (review 7).
- Cloud (index.ts): heldOf cleans the list (a GUID that is no GUID dropped, words cut); periodHold calls
  tally_period_hold; the answer never says done while one is held and gives the plain words. A cloud without 154: the
  day marked to upload with "1 entry on 30-Aug could not be read: upload the Day Book for this day." (never done). A beat
  whose bridge version differs from the device's last calls tally_period_held_release (the firm's held days of an older
  version listed again).
- Migration 154 (written, not run; add-only: one column): tally_period_hold keeps the list on the day, done_at null while
  it is not empty; tries per entry, AlterID and bridge version; under 3 the day stays listed by 98's own rule (counted,
  not done, not marked), so every pull and the night ask for it again with FinComVoucherObject; at 3 upload_why 'held'
  with the manual step's words; an empty list clears it and ends the day by 98's count. tally_period_held_list (the app)
  settles first: an entry FinCom now holds at the AlterID held or higher (a Day Book uploaded) leaves the list, and an
  empty list ends the day. tally_period_held_retry ("Try again now", owner or staff). An older copy of the voucher is
  kept as it is; the day shows the line until the entry is in at Tally's AlterID.
- Words (TallyPrime's own keys, as FinCom's From Tally page already says them): "1 entry on 12-Oct could not be read yet.
  FinCom tries again by itself."; after 3 tries "In Tally, open Day Book, press F2 and set the date to 12-Oct-2025, then
  Alt+E (Export) → Current, F8 (File Format): XML, and E to export; drop the file on Books › From Tally."

## 3. Day lists by range (range2512.go; review points 1, 2, 4)

- FinComDayHeads exactly, SVFROMDATE < SVTODATE, 2 to 31 days; pinned; let through only while it is the range being asked
  and every day of it is listed now.
- Only a book shown sparse: 3 single-day lists of the company and choice in a row, each ≤ 50 rows and < 300 ms (any other
  single day, or a single day's error, starts again). 3 days first; capped so the predicted time (the slower of the single
  days' average and the last range's time a day) stays under 0.8 s; +50% (at least a day) only under 0.5 s, 31 at most;
  halved over 0.8 s; a day of more than 200 rows ends ranges for the period.
- Over the 2 s stop, Tally's window held 2 s, a cut or unreadable answer, rows not adding up: not used and NOT a stop of
  the company; Tally's end of a request given up on is awaited (bounded), the shared retry schedule gives the usual wait,
  the company's days go one by one for the rest of the run, logged. A single day's list over 2 s stops the company as
  before (unchanged).
- A row dated outside the range: the single-day rule's "date not applied" (the answer dropped, the day marked "dates", no
  day asked of that Tally until restart).
- Each run's first range of a company is a check only: its days are then read one by one and their GUIDs compared; a
  difference turns ranges off for that company for good (sync\range-off.json, logged); only after the run's check passed
  are later ranges used (their days' lists taken while fresh).

## 4. Tests

Go: r2512_test.go (the strip, the real releases, ordinary entries, the group request as 2.5.11's, a held entry: nothing
sent of it, held named on the day's last call, asked again when listed again, held [] once it reads; oversize; the
version; the allow-list); r2512range_test.go (every day told after evidence and the check; consecutive days only; no range
for a day of 51 entries or a single list of 320 ms; the check's mismatch off for good, after a restart too; cut / error /
over 2 s: no stop, single days, all told; date not applied; the sizes, the halving and the cap, a 0.9 s answer; the guard).
Cloud: tests/run_migration154.py (pg_stand: held keeps the day open with the plain line; 3 failures give the manual step;
an update tries again from 1; a retry that reads clears it; an upload at the AlterID settles it, an older copy does not;
Try again now; another firm refused; twice safe); tests/run_period_ingest.py section 5 (held cleaned and kept; [] clears;
a cloud without 154; the release on a version change).

## 5. The second independent review (five points, fixed)

- M1 (TallyFetch.jsx): an upload line marked "held" is hidden only when the held list loaded and names that day; a list
  that cannot be read (a cloud without migration 154) leaves every upload line on the page.
- M2 (range2512.go): a range stopped at 2 s that Tally has not finished within TallyAbandonWaitSec, or whose end cannot be
  watched, stops the company as the group read does (never a second request at Tally); with TallyAbandonMaxSec 0 no
  range is asked at all (TestR2512RangeStoppedNotFinishedStopsCompany, TestR2512NoRangeWhenTallyEndNotWatched).
- L3: Tally's window held 2 s during a range stops the company, as for one day (TestR2512RangeWindowHeldStopsCompany).
- L4: a range-off.json that is there but cannot be read keeps ranges off for every company, is logged and never written
  over; a readable one keeps its other entries, written through a temp file and a rename (TestR2512RangeOffFileUnreadable).
- L5 (migration 154, still add-only): tally_period_held_settle also drops a held entry the day's latest list from Tally no
  longer names (deleted or moved in Tally); run_migration154.py check 7.

## 6. The final review (one point, fixed)

- range2512.go, as batch249.go: Tally's end of a range stopped at 2 s is awaited first, Tally's window is measured from
  the send over that wait, then window held 2 s -> stop "window"; Tally not finished (or not watchable) -> stop
  "over2s"; only then the stop as Tally being busy (TestR2512RangeStoppedAndWindowHeldStopsCompany). TallyFetch.jsx: the
  held list's "loaded" mark cleared at the start of each load (a book change never hides a line with the old book's list).

## Verdict

Ship after the coordinator's review, migration 154 and the new tally-ingest deployed first, and a measurement of
FinComDayHeads' range form on real TallyPrime.
