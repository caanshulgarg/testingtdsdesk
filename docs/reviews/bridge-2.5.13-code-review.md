# Code review: FinCom Bridge 2.5.13 (upload marks follow FinCom's; the masters read without a first day)

Reviewers: the session that built it (a self-review against the owner's rules), then the coordinator's independent
review of 6b523d682 ("2.5.13 safe on staging"; four points A1-A4, all addressed in 5806ce693). The coordinator signs.

Range: 459ea4d23..5806ce693 (origin/staging-next, which holds released and signed 2.5.12, to this build; origin/staging-next has not moved since: nothing to merge)

(bridge-go/: daypull.go (pullUploadReleaseLocked, pullLoad's older marks, pullLogFlush, pullTell's toldN),
booksfrom.go (booksFromPair: FinCom's day when Tally gives none; applyBooksFrom keeps it for a company this Tally lists;
ledgerStandInDay and its guard in ledgerPeriodExact, FinComLedgers only, only while no day is known), ledgers.go
(ledgerList's stand-in round, openingsUnknown in the outbox and the push, no openings sent), keep.go (ledgerRunEndWords;
no "Books as of" for a read without openings), cloud.go (the beat row's booksFromWhy), allowlist.go (the FinComLedgers
and stock rows' words), util.go (2.5.13); r2513_test.go and the books-from tests moved to the owner's rule.
server/tally-cloud/index.ts: ledger_list with openingsUnknown stages, settles and writes no opening; the beat keeps
booksFromWhy. app/src/parts/TallyCompanies.jsx: stallWhy says booksFromWhy (a lazy chunk).)

The owner's rules, as kept:
- Each request to Tally 2 s at most, one in flight, postings first, the typing gate: unchanged; no new request XML.
  FinComLedgers goes byte for byte as built; only the date it carries differs when Tally gives no BOOKSFROM (FinCom's
  first day, else the first day of the current financial year), allowed by the owner's decision of 10-Nov-2026, and
  the allow-list's dated line says so (A1).
- No wrong opening reaches FinCom: a round without a known first day sends no opening (openingsUnknown, the rows'
  openings empty) and tally-ingest takes none from it; the next round with a day sends them all.
- FinCom's marks decide: a day marked upload here is read again only once FinCom has taken the mark and lists the day
  again, not within 2 minutes of that, at most 3 times a day in one run (no loop); an earlier version's marks dropped.
- No secret, key or real client name in code, tests, logs or commits; made-up names only.

Independent review points and what was done:
- A1: the dated allow-list line, committed after the owner's OK (same request, dates only; g250 run 41016133667).
- A2: the held-read log line reworded for the stand-in round; no "Books as of" when the openings are missing.
- A3: the 3-re-reads-per-run limit in the test sheet, with its check.
- A4: pullLogFlush no longer between pullUploadReleaseLocked and its doc comment.

Not in 2.5.13 (separately): migration 155 (a link takes its Tally GUID from any bridge of the firm that has the
company open), branch next-link-guid; the app's "linked login's bridge" words (readFollow.js).
