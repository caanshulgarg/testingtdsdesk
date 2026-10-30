# FinCom Bridge 2.5.0 (branch bridge-dated-ledgers, from staging-next fc79ae4c9)

The owner's decision of 30-Oct-2026 ("Ok" to this exact proposal): inside the STATICVARIABLES of the three ledger
requests (FinComLedgers, FinComLedgerChanges, FinComLedgerByName)
`<SVFROMDATE TYPE="Date">{books-from yyyymmdd}</SVFROMDATE><SVTODATE TYPE="Date">{books-from + 1 year - 1 day}</SVTODATE>`,
and BOOKSFROM added to the company list (TDSDeskCompanies) so the bridge knows books-from. Nothing else in any request
changes. With it, migration 130 (cloud guards for opening balances) and tally-ingest. Includes the unreleased ledger-list
test b8edcd26f (zero-opening unused ledgers among others, read whole).

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.5.0.exe |
| Fingerprint | `f8ef14ba540676a05d2de594c094ebbffcde40aa078b210002c38bfa689dae54` (FinComBridge-Setup-2.5.0.exe, built 30-Oct-2026 13:41 IST at the commit after 071d946f3, bridge sources c27ae6558, POSTONLY=any; compare with the .sha256 file next to the setup); program FinComBridge-2.5.0.exe SHA-256 2766f048e33f2a91b47dd262b25f8ec806181104838b32872acbc838fdf131c5 |
| Replaces | 2.4.9 (kept on the computer, so the tray can roll back to it) |
| Published | not published |

## Why

Proven on real TallyPrime 3.0 and 7.1 (tally-versions mode openp, runs 41002898108 and 41004704755): a ledger request
with no period gives OPENINGBALANCE as at the start of the Gateway's CURRENT period. A 2.4.7 bridge added book
3d36a836's ledgers with their 1-Apr-2026 balances as 1-Apr-2025 openings (Rs 3.19 cr trial balance difference).

## What is in 2.5.0

1. The three ledger requests carry the books' first year (bridge-go/booksfrom.go): books-from from the company list's
   BOOKSFROM, this Windows user's own Tally only; one books-from per ledger round, per changes ask and per wanted-ledger
   pass, sent to FinCom with the rows as `openingsAt`.
2. Books-from not known: the ledger read is held, never sent undated; one log line ("Ledgers of <company> not read: Tally
   has not said when its books begin; the company list is read again and the ledgers wait until it does"); the company
   list read again at most once a minute.
3. The narrow ReadDays exemption (tally.go datedRefused): exactly these three, exactly as built with their company's own
   books' first year, whatever ReadDays says; any other period or none refused. Every other request keeps its rule.
4. The first dated round after an undated one (the upgrade from 2.4.9) sends every ledger; a round 2.4.9 began undated
   starts again. A round FinCom's cloud held (openings not adding up to nil) is sent whole once more; a whole list held
   again is not.
5. Cloud (migration 130, tally-ingest): (a) after a complete ledger round, or a trial balance / masters list, openings
   that do not add up to nil (beyond Rs 1) are held (tally_openings_held) with one alert "Opening balances from <source>
   do not add up to nil: <difference>"; the stored ones stay; (b) a trial balance used as opening balances must be as on
   the day before the books begin, else refused in plain words; (c) a book whose openings tie takes changed openings only
   from a dated read; an undated read (a bridge before 2.5.0) never changes them.

## Known limits

- Two of the same Windows user's Tallys with a company of the same name and different books: the last listed wins.
- A trial balance is judged by its own total; ledgers it leaves out keep their stored openings (the dated ledger read
  sets them).

## Deploy order (the owner)

Publish the setup; run migration-130-opening-guards.sql; deploy tally-ingest; then a ledger re-read of book
3d36a836-debd-4847-93a7-73b343333a41.
