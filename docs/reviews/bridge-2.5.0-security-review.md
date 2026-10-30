# Security review: FinCom Bridge 2.5.0 (the ledger reads carry the books' first year; cloud guards for openings)

Reviewer: the independent review sessions of bridge-2.5.0-code-review.md (four rounds; each round's security points
asked explicitly). They did not write the change. Checked against the owner's standing rules: every request to Tally
2 s or less; one request in flight; postings first; only the exact approved shapes reach Tally; nothing computed asked of
Tally except where the owner decided; reading is prospective only (ReadDays) except the owner's narrow exceptions; no
computer names in words a firm sees; add-only SQL with explicit grants; no AI.

Range: fc79ae4c9..c27ae6558

## Threats looked at

1. **A ledger request with another period, or none.** Three layers: checkAllowed's pin (pinned.go rebuilds the three
   ids from the request's own company, ranges or name and the books-from it carries, only when SVTODATE is a year on
   less a day); datedRefused (tally.go) lets the three through only when ledgerPeriodExact holds: exactly once
   SVFROMDATE = the company's own held books-from and SVTODATE a year on less a day, TYPE="Date", inside
   STATICVARIABLES, the request otherwise byte-identical to its builder; refused otherwise with errLedgerPeriodRefused
   whoever asks and whatever ReadDays says (round 2 finding 3 fixed: the fallback was readsOffErr, nil with ReadDays on).
   Tested: r250dated_test.go TestR250ReadDaysExemptionOnlyThree (ten variants per id, ReadDays off and on, a person's
   request), TestR250BooksFromUnknownHeld (an undated request refused even for a person with ReadDays on).
2. **The exemption widening to other requests.** requestClass names "ledgerPeriod" for exactly the three ids; every
   other id with the same period inserted is refused with ReadDays off (tested over every allow-list sample);
   TestNoComputedFigure's "opening balance with a period" allows only these three with exactly the books' first year and
   no closing balance or date filter (booksYearLedgerRead; TestR250ComputedFigureOnlyThree).
3. **Another user's Tally choosing the period.** Books-from is noted only from this Windows user's own Tally sessions
   (round 1 finding 3); the saved list's other-user sessions are skipped. Known limit: two of this user's own Tallys with
   a company of the same name and different books (the last listed wins).
4. **Sending undated when books-from is unknown.** Never: the builders return nothing without a date; the read is
   held, one log line, the company list read again at most once a minute (no flood of requests).
5. **Request load.** No new request; the company list asks one field more. Each request still under the 2 s stop, one in
   flight, postings first (gate e4/e5 on real TallyPrime 3.0-7.1).
6. **Cloud: openings that do not add up written over correct ones.** migration 130's guards; settle under the book's
   advisory lock; held sets kept (tally_openings_held), never deleted.
7. **Cloud grants.** tally_openings_held: RLS on, revoked from public/anon/authenticated, service_role select/insert/
   update; its sequence revoked from anon/authenticated (round 1 finding 9); every new function security definer with
   search_path pinned, `auth.role() = 'service_role'` checked, execute granted to service_role only (run_migration130.py
   checks each).
8. **Words a firm sees.** The alert: "Opening balances from <source> do not add up to nil: <difference>", the source one
   of "the bridge's ledger read", "the bridge's trial balance", "a trial balance uploaded", "a ledger masters file
   uploaded", "the file <name the person uploaded>"; no computer or Windows user name (tested). One alert a day for the
   same source and difference.
9. **A member skipping the guard.** The masters upload's `complete` flag no longer exempts it (round 3 findings 2-3).

## Open

- Pre-existing (not changed by 2.5.0): datedRefused's other exact-only exceptions fall back to readsOffErr() with
  ReadDays on (round 3 finding 1); the allow-list pin still holds them to their builders. A separate task.
