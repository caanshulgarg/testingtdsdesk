# FinCom Bridge 2.5.1 (branch bridge-251-openings, from staging-next 204d79d4f)

The openings fix for book 3d36a836 (found live on 30-Oct-2026 18:05 IST). The request shapes are 2.5.0's, approved by the
owner on 30-Oct-2026 (`<SVFROMDATE TYPE="Date">{books-from}</SVFROMDATE><SVTODATE TYPE="Date">{books-from + 1 year - 1 day}</SVTODATE>`
in FinComLedgers, FinComLedgerChanges and FinComLedgerByName); only the source of books-from changes. No request added,
no request shape changed, the allow-list table and its hash unchanged.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.5.1.exe |
| Fingerprint | filled in at the build |
| Replaces | 2.5.0 (kept on the computer, so the tray can roll back to it) |
| Published | not published |

## Why

2.5.0 dated the three ledger requests from the Tally company's own books-from (TDSDeskCompanies' BOOKSFROM). Impetus
(book 3d36a836): Tally's books begin on 1-Apr-2024, FinCom's copy on 1-Apr-2025 (tally_books.from_date 2025-04-01,
open_as_on 2025-03-31). 2.5.0 sent the openings as at 1-Apr-2024 (openingsAt 20240401), and migration 130's guards took
them because they add up to nil (tally_openings_held id 1, stage applied, 101 openings changed). The openings were put
back by hand, and a cloud guard (staging-next 204d79d4f) refuses openings read as at another day than the book's
from_date.

## What is in 2.5.1

1. Bridge (bridge-go/booksfrom.go): the books-from of the three ledger requests is FinCom's first day of its book of the
   company, named in each heartbeat answer as `booksFrom: {company: yyyymmdd}`; Tally's BOOKSFROM only when FinCom has
   none (`""`, or no answer naming the company yet). `openingsAt` is the date used. The day is checked as a real
   yyyymmdd date (1990 to a year after today); anything else is never used. FinCom's day is used only when it is the
   first day of a year of Tally's own books of the company (on or after Tally's BOOKSFROM, the same day and month); when
   it is not, or Tally has not said when its books begin, the ledgers are not read (one log line naming both days),
   never read as at either day. It is kept in the sync folder (`fincom-books-from.json`), so a restart
   uses it before the first heartbeat; `""` forgets it; an answer without `booksFrom` (a cloud before 2.5.1) changes
   nothing. When FinCom's day is not Tally's, one log line names both. A round begun with another date starts again
   with FinCom's (2.5.0's `openingsAt` check), and the first round with it sends every ledger.
2. The ReadDays exemption and TestNoComputedFigure (ledgerPeriodExact) allow exactly the first year of the date in use
   or of Tally's own BOOKSFROM (both a year of the company's own books; a request built a moment before FinCom's day
   arrived is not refused); any other period, or none, is refused as in 2.5.0.
3. Cloud (server/tally-cloud/index.ts): the beat's answer carries `booksFrom` for each company the beat says open in
   Tally whose book FinCom knows (`tally_books.from_date` as yyyymmdd, `""` when none; at most 200; the books' days and
   GUIDs read in one query each); `""` for a company of that name whose GUID is not the book's recorded one (a restored
   or test copy, as review 245 R3). The guard of 204d79d4f: its notes no longer also say "taken without the guards" for a refused read, and a
   ledger_changes call as at another day says "<n> opening(s) as at <day> not taken: FinCom's books of this company
   begin on <from_date>" (recorded with that day) instead of the undated read's words.

## Known limits

- A 2.5.1 that starts with no FinCom day kept (the first start after the upgrade) may read once as at Tally's day before
  the first heartbeat answer (about 3 s after the start); the cloud guard refuses those openings with a note, and the
  next round goes as at FinCom's day (the round starts again when the date changes).
- When FinCom's first day is before the Tally company's own books-from, or not on its day and month, the ledgers of that
  company are not read until the two agree (one log line); FinCom's Tally page shows the stored openings meanwhile.
- Two of the same Windows user's Tallys with a company of the same name and different books: as 2.5.0.

## Deploy order (the owner)

Deploy tally-ingest (the beat's `booksFrom`; no migration); publish the setup. A 2.5.1 against a cloud without the
field reads as 2.5.0 did (and the deployed guard refuses openings of another day).

## Numbering

Another branch (bridge-stock-2411, stock from Tally) was built as "2.5.1" and is renumbered 2.5.2.
