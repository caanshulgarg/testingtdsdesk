# Code review: FinCom Bridge 2.5.1 (the ledger requests dated from FinCom's first day of the book)

Reviewer: independent review sessions run with Claude Code (the code-review tool's forked reviewers; the range ends at the release check's self-test commit 4d7cc006d, a test script only; high effort for
rounds 1 and 2, medium for round 3). They had only the repository and the range; they did not write the change.

Range: 204d79d4f..4d7cc006d

Scope: bridge-go/booksfrom.go (FinCom's day: applyBooksFrom, finComDay, booksFromPair, booksFromAllowed,
ledgerPeriodExact), cloud.go (applyBooksFrom in the beat), ledgers.go (the round-restart words), the tests
(r251openings_test.go; r250dated_test.go kept as history; the version-pinned tests; the fixtures);
server/tally-cloud/index.ts (booksFromFor and the beat's answer; the words of the guard of 204d79d4f);
tests/run_openings_ingest.py (G and H). Checked against the request: the date of the three ledger requests is FinCom's
first day of the book (tally_books.from_date, named per company in the beat's answer), Tally's BOOKSFROM only when FinCom
has none; the request XML unchanged (the owner's decision of 30-Oct-2026); openingsAt the date used.

## Checks run

- `go vet .` and `GOOS=windows go vet .`: clean at every round.
- `flock /tmp/fincom-app.lock go test -count=1 -timeout 40m ./...`: the whole suite after rounds 1, 2 and 3 (green at 3968a9269 (1363.865s); again by release-check.sh at c20efc3da).
- `python3 tests/run_openings_ingest.py` (tally-ingest under Deno against fake_supabase.py): ALL PASSED after each round;
  `deno check server/tally-cloud/index.ts` clean.
- Real TallyPrime 3.0, 4.1, 5.1, 6.2, 7.1 (tally-versions mode o251, run 41059404728, built from source at 7299e0e5e):
  o1-o6 PASS on all five (the release log has the run with the committed setup).

## Round 1 (204d79d4f to e2f7f883a): 10 findings

1. (High, security) the cloud (or the sync folder's file) chose any date the three requests may carry, with ReadDays
   off too. Fixed in a8cae6f66 and 3968a9269: FinCom's day is a real date (1990 to a year after today) and is used only
   on or after Tally's own books-from; before it, Tally's day as 2.5.0; ledgerPeriodExact allows exactly the first year
   of the day in use or of Tally's BOOKSFROM, nothing else (TestR251FinComFirstDayDatesTheLedgerRequests: another year
   refused with ReadDays off).
2. (High) a FinCom day before Tally's books-from would date the reads before Tally's books and the cloud would take
   those openings as at from_date. Fixed: Tally's day then (the cloud guard keeps FinCom's openings; one log line)
   (TestR251FinComDayOnOrAfterTallysBooks).
3. (Medium) booksFromFor matched by name only, without review 245 R3's GUID check. Fixed: "" for a company of that name
   with another GUID than the book's recorded one (run_openings_ingest.py H).
4. (Medium) applyBooksFrom ran before the test-mode return. Fixed: after it, beside applyReadControl.
5. (Medium) a request built a moment before FinCom's day arrived was refused by the gate. Fixed: Tally's own first year
   stays allowed (booksFromAllowed).
6. (Medium) only 50 open companies named. Fixed: 200, as the beat's own list.
7. (Medium) up to 100 sequential queries a beat. Fixed: one query each for the days and GUIDs, both at once, each book
   kept five minutes; the books looked up 20 at a time (round 3).
8. (Low) the said-mark not set when Tally's day was not known: re-read each beat. Fixed (the mark keyed on both days).
9. (Low) the round-restart line said "Tally now says the books begin on". Fixed: "the ledgers are now read as at ...
   (FinCom's first day of the book, else Tally's books-from)".
10. (Low) the first start after the upgrade may read once as at Tally's day before the first heartbeat: kept as a known
   limit (notes): the cloud guard refuses those openings and the round starts again with FinCom's day.

## Round 2 (a8cae6f66): 10 findings

1. (High) a later year of Tally's books makes Tally give carried-forward openings, not measured: the owner's decision
   for 2.5.1 (the date is FinCom's first day); timed by the o251 gate (30-44 ms worst); a company with many earlier
   years not measured (notes, known limits).
2. (High) round 1's "same day and month" rule would hold a company whose books began mid-year for good. Fixed in
   3968a9269: on or after Tally's books-from, any day.
3. (High) holding every ledger read on a mismatch stopped names, GSTIN, PAN and TDS fields. Fixed: Tally's day instead
   (2.5.0's read), the cloud guard keeps only the openings.
4. (Medium) Tally's day always allowed beside the day in use: kept by design (round 1 finding 5); documented.
5. (Medium) a beat without a GUID got the book's day, then "" once the GUID differed (flip). Fixed: left out while the
   beat carries no GUID for a book with a recorded one.
6. (Medium) the held list filled by names that are not companies here. Fixed: a day is kept only for a company of this
   Tally whose books-from Tally has said (TestR251FinComDayOnOrAfterTallysBooks: 200 other names, none kept).
7. (Medium) the cloud's lookups on every beat. Fixed: kept five minutes, both queries at once.
8. (Low) Tally's day read twice per gate check. Fixed: booksFromPair.
9. (Low) the "|fc|" said-keys never cleared: gone with the held path (finding 3).
10. (Low) disk read under the lock: once per sync folder; kept.

## Round 3 (3968a9269): 9 findings

1. (Medium) a book with no recorded GUID gives its day to any company of that name: as periodDaysFor; nothing better to
   compare; kept (known limit, notes).
2. (Medium) a new FinCom day skipped while Tally's books-from was not known kept the stale one. Fixed in c20efc3da: a
   company already held takes the new day whenever it comes (TestR251FinComDayOnOrAfterTallysBooks).
3. (Medium) a day for a company no longer linked was never forgotten. Fixed: an open company with no book is answered ""
   (run_openings_ingest.py H, NOT LINKED CO).
4. (Low) a GUID flipping between beats restarts rounds: no such flip in the bridge's beat (heldGUID once known); kept.
5. (Low) a FinCom day before Tally's leaves new ledgers at nil openings until the two agree: the guard of 204d79d4f by
   design; notes.
6. (Low) the changes path records a kept set on each call as at another day: as the undated case before; kept.
7. (Low) two saves of fincom-books-from.json at once: applyBooksFrom runs only in the heartbeat loop (one at a time); not
   applicable.
8. (Low) two companies whose names differ only in case or spacing: the bridge keys every books-from that way since
   2.5.0 (known limit).
9. (Low) up to 200 sequential book lookups: fixed with round 1 finding 7 (20 at a time).

All High and Medium fixed with tests or recorded as decided or known limits; Lows recorded.
