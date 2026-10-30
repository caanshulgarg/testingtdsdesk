# Code review: FinCom Bridge 2.5.0 (the ledger reads carry the books' first year; cloud guards for openings)

Reviewer: independent review sessions run with Claude Code (the code-review tool's forked reviewers, high effort for
rounds 1 to 3, medium for round 4). They had only the repository and the range; they did not write the change.

Range: fc79ae4c9..c27ae6558

Scope: bridge-go/booksfrom.go (new), ledgers.go, ledchanges.go, tally.go (requestClass, datedRefused), pinned.go,
ports.go (TDSDeskCompanies' BOOKSFROM), recorder_live.go, keep.go, allowlist.go and the tests (r250dated_test.go and the
existing tests moved to the new rule); server/tally-cloud/index.ts (applyLedgerList, applyLedgerChanges, ingestLedgers)
and migration-130-opening-guards.sql; tests/run_migration130.py, tests/run_openings_ingest.py. Checked against the
owner's decision of 30-Oct-2026 ("Ok" to the exact proposal: the period inside the three ledger requests' STATICVARIABLES,
BOOKSFROM in the company list, nothing else changed; the narrow ReadDays exemption for exactly these three).

## Checks run

- `go vet .` and `GOOS=windows go vet .`: clean at every round.
- `flock /tmp/fincom-app.lock go test -count=1 -timeout 40m .`: the whole suite (about 1,300 s) after rounds 1 and 4.
- `python3 tests/run_migration130.py` (pg_stand, PostgreSQL 16) and `python3 tests/run_openings_ingest.py` (tally-ingest
  under Deno against fake_supabase.py): PASSED after each round.

## Round 1 (fc79ae4c9..5498369b2): 10 findings, all fixed in 94cce5ab2 with tests

1. (High) the candidate kept stale stored openings of ledgers a trial balance leaves out, so a correct file could never
   replace wrong openings. Fixed: a trial balance is judged by its own total (a trial balance lists every ledger with a
   balance); a round by the book's total with the round's openings in place.
2. (High) a held round's openings were never sent again (the bridge had moved its basis). Fixed: the cloud answers
   `openings: held`; the bridge sends every ledger with the next round (ledger-resend.json).
3. (High, security) books-from noted from every Tally session, other Windows users' too. Fixed: only this user's own
   Tally notes it; the saved list's other-user sessions are never read for it.
4. (Medium) books-from looked up per chunk: one round could mix periods. Fixed: one books-from per round
   (ls.openingsAt), per FinComLedgerChanges ask and per wanted-ledger pass; the rows go with the books-from they were
   read with (ledSend's bf).
5. (Medium) the masters upload judged on FinCom's own openings. See round 2 and 3.
6. (Medium) a held read was marked read. Fixed: keepRun.booksHeld; markRead skipped.
7. (Medium) the company list re-read on every held attempt. Fixed: once a minute per company.
8. (Medium) openingsAt stamped at send time. Fixed with 4.
9. (Medium, security) the new table's sequence not revoked from anon/authenticated. Fixed (revoke all on sequence).
10. (Low) the book's sum asked on every undated ledger_changes call. Fixed: only when an opening would change.

## Round 2 (5498369b2..94cce5ab2): 10 findings; fixed in 8b154b0ad except where said

1. (High) masters upload held on a book whose openings do not tie: see round 3/4 (final: judged as any list, a held
   masters list still taken whole with the openings FinCom holds).
2. (Medium) a correct trial balance leaves ledgers it omits with stale openings: by design (the file's own total is the
   test, so the owner's correct file is taken); the book's openings are made whole by the dated ledger read (2.5.0's
   first dated round sends every ledger). Said in the notes as a known limit.
3. (High, security) the ledger exemption fell back to readsOffErr(), nil with ReadDays on. Fixed: errLedgerPeriodRefused,
   whatever ReadDays says; tested with ReadDays on.
4. (Medium) a held round marked a whole resend for ever when Tally's own openings do not tie. Fixed: a whole list held is
   not sent whole again (round 3/4 refine).
5. (Medium) books-from changed mid-round refused with the reads-off words. Fixed: the round starts again.
6. (Low) books-from per company name across this user's own Tallys: not fixed (known limit: two own Tallys with a company
   of the same name and different books).
7. (Low) the held read logged on every light check. Fixed.
8. (Medium) a list that changes no opening judged. Fixed (changed > 0 gate).
9, 10. (Low) wrappers kept for the tests (they build with the company's held books-from); duplicate `mine` check merged.

## Round 3 (94cce5ab2..8b154b0ad): 7 findings; fixed in dac0681bd except where said

1. (High, pre-existing, out of 2.5.0's scope) FinComVoucherObject, FinComVoucherByNumber, FinComSlice and the undated
   TDSDeskKeepList fall back to readsOffErr() too. Not changed in 2.5.0 (the owner's decision changes nothing else); the
   allow-list pin (checkAllowed) still holds them to their exact builders. Raised as a separate task.
2, 3. (Medium) the masters upload exempted by a flag the caller sets. Fixed: judged as any list.
4. (Medium) a temporary missing BOOKSFROM restarted a round. Fixed: the turn pauses, the round resumes.
5. (Medium) a first whole round held queued another whole one. Fixed: any whole list held is not sent whole again.
6. (Low) refusal log words. Fixed. 7. (Low) test restored ReadDays only on success. Fixed (defer).

## Round 4 (8b154b0ad..dac0681bd): 4 findings, fixed in 4fd46cbc2

1. (Medium) the whole-list mark lost when a plain round merged into an unsent outbox. Fixed: kept until the outbox goes.
2. (Medium) a held masters list skipped the list ingest (deletion marks, record). Fixed: taken whole with the openings
   FinCom holds in place of its own; held row and alert as before.
3. (Low) books-from gone mid-round paused silently. Fixed: said once, marked held.
4. (Low) log words for a held first whole round. Fixed.

## After round 4

c27ae6558 adds only the measured times (allowlist.go's maxSec and measuredOn strings for four rows), the doc table
and decision line, the beat fixture's table hash, and TestR250VersionAllowList: data and a test, no logic.

## Open

- Round 2.6 (two own Tallys, same company name, different books-from): known limit, in the notes.
- Round 3.1: separate task (pre-existing).

Range reviewed in all (rounds 1 to 4 and the data commit after them): fc79ae4c9..c27ae6558
