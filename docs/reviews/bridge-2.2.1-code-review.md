# Code review: FinCom Bridge 2.2.1 (new entries from the real NWS144 Tally)

Reviewed: 05-Oct-2026, by the reviewer in the Claude Code session. I read git diff 6fb6cc9 8185245 -- bridge-go/
docs/tally-allowlist.md from a clean worktree of 8185245:
- recorder_resolve.go (new): FinComVoucherByNumber, its guard, the held list, the first-run re-scan and the resolver;
- recorder_live.go: the placeholder GUID and created/altered rules, the GUID rebuilt from the MasterID, liveSameSave,
  received_at;
- tally.go: the third dated exception;
- pinned.go: the new id's rebuild;
- allowlist.go, config.go (keepNumZero), util.go (2.2.1);
- the add-on's header notes and nws144_test.go;
- docs/tally-allowlist.md: the new row and the decision line for 2.2.1 of 2026-10-05.

The app, server and migration files in the same range are not part of this review.

Checks (clean worktree of 8185245):
- `go vet ./...` and `GOOS=windows go vet ./...`: clean.
- `go test -count=1 ./...`: ok (472 s). The tree stayed clean.
- One throwaway test (zz_scratch_221_test.go, in a second worktree) confirmed finding 1 and checked the guard's bounds.
  It was deleted with the worktree; nothing was added to the repo.

## What holds (checked, no finding)

- **The new dated exception cannot be widened.**
  - Every FinComVoucherByNumber goes through voucherByNumberExact by id, whatever ReadDays or the person flag say
    (tally.go). It is also pinned byte-exact (pinned.go), and the rebuild comes from its own company, date, type and
    number.
  - The guard requires all of these:
    - SVFROMDATE == SVTODATE (one day);
    - a starting point for the company, and the day between the starting point's day and today;
    - the day within the last 3 days, or a day the bridge itself announced for this company, type and number in the
      last 2 minutes (liveNumberAsk, called only by fetchVoucherByNumber).
  - Checked: today passes. 10 days ago, the day before the starting point and tomorrow are refused. Changing `AND` to
    `OR` in the filter is refused by both the pin and the guard.
- **It can never list a day's vouchers.** The filter is `$VoucherNumber = "<no>" AND $VoucherTypeName = "<type>"`,
  both exact. liveNumberText refuses an empty value, a quote, CR, LF, tab, any control character, surrounding spaces,
  and more than 100 characters (all checked), so neither value can end the TDL string. The FETCH is the body fetch's
  fields.
- **Prospective only.** liveFoundWrong refuses an answer whose AlterID is not above the starting point, an entry of
  another company, or one with no GUID or a placeholder GUID. More than one entry found is held, not guessed.
- **Never during an import; the 2 s rule; bounded retries.**
  - The uploader asks only when no posting is going (and yields through the TC). The resolver returns at once while a
    posting or import is going, and its TC yields too.
  - A reply over 2 s turns "bodies" off for the company, which stops both asking by number and the resolver.
  - On a line: 3 asks, 10 s apart, within the 20 s body budget.
  - In the resolver: at most 10 held lines per turn, each at most once in RecorderResolveSec (10 min), for 7 days
    (see 3).
- **The re-scan.** It reads the add-on's files of the last 7 days with readSharedFrom (read only, shared). It runs once
  per sync folder (`scanned` is kept in recorder-held.json), and failed.txt is skipped.
- **Each resolved line goes once.**
  - The resolved line's id is the held id + ":resolved". It is queued only when it is neither sent nor queued, and sent
    ids are kept for 7 days (recorder-sent).
  - A held item goes when its resolved id is sent, or after 7 days, so the list cannot grow without bound.
  - After a restart, a held item whose resolution was queued but not sent is asked again after the wait, and queued
    once.
- **A placeholder GUID is never sent.** liveEmit clears a "-00000000" GUID on every line. The body and resolver paths
  refuse a placeholder from Tally.
- **Created vs altered.** liveIsNew is true for an empty GUID, a placeholder GUID, MasterID 0 or AlterID 0. A real
  alteration carries its own GUID, MasterID and AlterID and stays "altered". Checked: a voucher_accept_post for
  Receipt 190 with GUID -000066c5, MasterID 26309, AlterID 54395 went as altered, with its body.
- **wire().** alter_id is sent only when above 0. received_at is the bridge's clock when it read the line; save_ms only
  when both times carry seconds.

## Findings (by severity)

1. MEDIUM (the coordinator's rule for this release: a ledger's GUID is not rebuilt until the form is proven; today's
   code sends it). A new ledger's line goes with a GUID rebuilt from its MasterID, and only vouchers have been proven to
   follow that form.
   - Where: recorder_live.go:959-963 (liveEmit). The rebuild `<company GUID>-%08x(MasterID)` runs for every line with a
     placeholder GUID, ledgers included.
   - The ledger body fetch (recorder_live.go, the `ledgers` loop) replaces it with Tally's GUID only when the fetch
     succeeds. When it fails (the 2 s rule, the 20 s budget, not found), the rebuilt GUID is sent.
   - Evidence for the form: Receipt 189 on NWS144 (MasterID 26305 = 66c1) proves it for vouchers. Nothing in the repo
     proves it for ledgers.
   - Confirmed: TestScratch221LedgerGUID. A `ledger_accept_post` with GUID `<co>-00000000`, MasterID 500, AlterID 0
     and no ledger 500 in the stand went as `ledger_created` with `object_guid <co>-000001f4` and no body.
   - Fix: rebuild only when `!c.isLedger()`. For a ledger with a placeholder, keep the GUID empty until the body fetch
     gives Tally's own. Rebuild ledgers only once a real Tally shows a new ledger's GUID equal to the rebuilt form.
   - Test: TestLedgerPlaceholderNoRebuiltGUID. A new ledger whose body fetch fails goes with object_guid ""; one whose
     fetch succeeds goes with Tally's GUID.

2. LOW. An empty GUID now means "created".
   - Where: liveIsNew (recorder_live.go).
   - A `voucher_accept_post` with no GUID went "altered" in 2.2.0. It now goes "created", and with no MasterID it is
     asked by number.
   - The live add-on always writes a GUID (the company's placeholder for a new entry), so this matters only for an
     add-on that writes none.
   - Fix (optional): take "new" from the placeholder or the zero numbers only, and keep an empty GUID as before.

3. LOW. The resolver may ask Tally about one held line up to about 1,000 times.
   - It asks every 10 minutes for 7 days. Each request is one exact day, type and number, yields to postings, and the
     2 s rule stops it, so it is small; but it never gives up earlier.
   - RecorderResolveSec, RecorderNumberWaitMs and RecorderNumberRetryMs may also be set to 0 in the local settings
     (keepNumZero), which makes the resolver ask on every uploader turn.
   - Fix: stop after about 20 tries (say so in the log), and keep the waits' floors at 60 s and 1 s.

4. LOW (needs a wrong caller). The guard's "a day the bridge announced" window (liveNumberAsked, 2 minutes) admits any
   day from the starting point's day for that company, type and number. Only fetchVoucherByNumber announces, right
   before its own request, so no code path widens it today.

Verdict:
- No High.
- One Medium: 1, the ledger GUID rebuilt from an unproven form, which today's code sends when the ledger body fetch
  fails. It blocks the build; the fix is one condition.
- 2 to 4 are Low.
- The new dated exception holds: one exact day, type and number, pinned, within its bounds. Placeholders are never
  sent, an alteration stays altered, and each resolution goes once.


## Round 2 (8185245..2d9cc08)

The Medium is fixed in 2d9cc08: in liveEmit a placeholder GUID is rebuilt from the MasterID only when the line is not a ledger (`!c.isLedger()`); a new ledger's GUID stays empty until its body fetch gives Tally's own. Test TestPlaceholderGUIDRebuiltForVouchersOnly (bridge-go/review221_test.go): red on 8185245 (the ledger went as `<co>-000001f4`), green after; the voucher case still rebuilds `-000066c8`. Reviewed by Claude: the change is one condition; no other code changed. The Lows stay as written (the resolver's retries are bounded to 7 days; to be capped at about 20 tries in a later version).

## Round 3 (2d9cc08..7046501)

Checked 05-Oct-2026. `git diff --stat 2d9cc08 7046501 -- bridge-go/` is empty: no bridge-go/ file changed after the
reviewed fix, so the bridge code that ships is the code reviewed in rounds 1 and 2. The files changed in the range are:
- server/tally-cloud/migration-50-recorder-held.sql, tests/run_migration50.py and tests/run_migration_order.py: the
  cloud's migration 50 and its tests;
- docs/reviews/migration-50-review.md and these two notes.

None of them is a bridge source or goes into the installer. Migration 50 is reviewed in its own note.

Range: 6fb6cc9..7046501
