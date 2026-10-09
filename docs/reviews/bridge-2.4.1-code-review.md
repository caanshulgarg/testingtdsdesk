# Code review: FinCom Bridge 2.4.1 (the fallback by number, the log's words, the bank route across a restart, received_at)

Reviewed: 09-Oct-2026, an independent review of origin/release-241 (751c1795) against origin/tax-accuracy 7c13c777 (the
published 2.4.0). Read with `git diff 7c13c777 751c1795 -- bridge-go/ server/ src/ app/src/ docs/tally-allowlist.md`.

The "two data locations" feature (the add-on's data folder, the data id, 'other_source' lines, migration 71, the Tally
page's card) and the ledger page were reviewed on next-241 (the independent review of 0f436f6c and three re-reviews up to
557834df). By the owner's decision of 09-Oct-2026 the data locations moved to 2.4.2 (branch next-241) after the last
re-review found two Highs in them (the Tally read not tied to the proven folder; an empty narration proving a forked
copy); those reviews belong to 2.4.2's note. The ledger page and the app's Needs-you words ship from arc-ui.

## What 2.4.1 does

- The fallback by number (the owner's approval of 09-Oct-2026, item 5; reverses 2.3.4's L5 for this case only): a created
  or altered line whose MasterID answer is an older entry (below the starting point) or no voucher is asked
  FinComVoucherByNumber once, on its first fetch; taken only when exactly one voucher comes back and it passes
  liveVoucherWrong with the MasterID cleared. Another type, date or number keeps 2.4.0's hold (review M1 of next-241); the
  entry's narration is Tally's. Words: "the voucher with that MasterID in this Tally is an older entry, not this save".
- The log's words (item 6): a refused FinComVoucherByNumber says its own rule (voucherByNumberWhy), not "ReadDays".
- The bank route keeps the add-on's line count (addonN, addon, listed) in bankdate.json with its counter, so a restart
  no longer reads and sends again the entries those lines explained.
- tally-ingest keeps the bridge's received_at in the line's payload (an ISO time at most 5 minutes ahead). No migration.

## Checked

- **Nothing of the data locations.** The add-on is byte-identical to 2.4.0's; no migration file and no SQL changed; no
  app change; nothing reads or writes dp=, a data id, 'other_source', data_proven, dataSources or verifyLines (the tests
  of release241_test.go assert it for the add-on and the notes).
- **Requests.** No request added or changed: the allow-list table and its hash unchanged (TestAllowListUnchanged); the
  decision line names 2.4.1 and the dated "re-measured on 2026-10-09" line is there (release-check step 4 passes). The
  fallback sends FinComVoucherByNumber exactly as built, under voucherByNumberExact (one day, from the starting day to
  today, within 3 days or a line just asked).
- **2-second rule, one request in flight.** The fallback runs inside the fetch turn on recorderTC with the turn's
  deadline; once on the first fetch; the held list asks by MasterID alone.
- **Own Tally only.** Unchanged; a company open in two of this user's Tallys is refused ("many").
- **Figures.** The fallback takes only a current voucher of this Tally above the starting point, with its own GUID, type,
  date, number and narration; nothing else moves a figure. received_at goes only into the payload: the column keeps the
  database's now(), so the ordering checks of 53 / 63 / 67 are unchanged.
- **SQL.** None in this release.
- **No AI** in the bridge or the add-on.

## The independent review (09-Oct-2026), range 7c13c777..751c1795

0 High, 0 Medium, 4 Low. go vet (Linux, Windows) clean; go test ./... passes (928 s, -timeout 25m); release-check.sh
passes steps 1-4 (step 5: this note); run_recorder_server.py passes (202 checks). Probes: a renumbered entry (Sales 6 with
MasterID 26500 now Sales 5) is held, never taken as MasterID 26501; the 09-Oct case (Sales 2026-27/GST/297, MasterID
25743 an older entry here) takes this Tally's own Sales 297 with Tally's narration.
- L1: recorder_live.go:2389, the comment still names "another type, date or number" and "a line of another data
  location ... (datasource.go)", which is not in this release; correct the comment.
- L2: the app (2.4.0's 61-recorder.js) reads the new "older entry" words as Needs-you 'other' with Apply now, which cannot
  apply a line held without its entry; to be made "upload that day's Day Book" in arc-ui (the notes say so).
- L3: without the data locations, a second copy's line whose MasterID is an older entry here now resolves to this Tally's
  own voucher of that number (a real entry, sent again at worst) instead of being held with words: the owner loses that
  signal. Two copies of one company are as in 2.4.0 until 2.4.2.
- L4: the bank route writes bankdate.json (up to 20,000 MasterIDs a company) on every add-on line and taken entry.
- Not run here: real Tally (the fallback on NWS144), the app's tests (no app change), staging (no migration).

## Re-review (10-Oct-2026), the upgrade fix, range 751c1795..dc54ac4d

**The failure.** The real-Tally upgrade check (run 37981697177, upg u2, all five TallyPrime releases): on the first start
after 2.4.0, 2.4.1's bank route found no saved add-on line count (2.4.0's bankdate.json has no addonN, addon or listed),
counted the whole move since 2.4.0's last processed counter as "no add-on line", and read and sent again, once, the entry
2.4.0's add-on line had already sent.

**The fix** (0404e68c test, 7e84f5e0 bankdate.go +30/-1). bankFresh marks a saved company without the addonN key
(`older`, bankdate.go:148); bankFromOlder (bankdate.go:344) runs before bankExplained at the light check
(bankdate.go:395) and in bankNightTurn (bankdate.go:573): the counter becomes Tally's counter now (never below the
starting point), the line count is cleared, pending entries (Cands) are kept, one log line. A bank date set in the
upgrade stretch is left to the nightly self-check.

**Range.** `git diff 751c1795 dc54ac4d -- . ':!docs'` is exactly bridge-go/bankdate.go and
bridge-go/bankdate241older_test.go. The revert 435cd08a gives a tree identical to 0224b65a (nothing of 5eaafd2f is
left); assets-test/ and docs/RELEASE-CHECKLIST.md are the same as at 7c13c777 (2.4.0's state).

**Checked.**
- No false trigger from a file 2.4.1 wrote: bankSave always writes addonN, 0 included (bankdate.go:191). A file that
  cannot be read or parsed gives an empty state, so every company starts from Tally's counter through bankState, as in
  2.4.0. A company first seen after the upgrade goes through bankState, never `older`. A hand-damaged entry with no
  addonN is treated as older, which skips forward and never reads anything again.
- Nothing pending is lost: Cands are not touched, and the reader of Cands (bankdate.go:640 onward) does not filter by
  Seen. The starting point is respected (`if st.Seen < sp`). The counter can go back only when Tally's counter is below
  the saved one (a restore), which is what bankState does on a first check; it never goes below the starting point.
- Created or altered vouchers saved in the stretch have add-on lines, read by the recorder from the add-on's file
  without the bank route, so they are still caught. A bank date (or another change made without a voucher form) in the
  stretch is caught by the nightly self-check only: selfCheckStart (selfcheck.go:245) lists above its own mark, which
  the bank route never moves; the cloud's "older" answer is queued as 'altered' (selfcheck.go:436-458) and fetched with
  FinComVoucherObject. The claim holds, and the test TestBankDate241FromOlderStateBankDateFoundBySelfCheck shows it
  (it calls selfCheckStart directly, not the nightly scheduler).
- Concurrency: bankFromOlder runs under bank.mu and makes no Tally or cloud request. No new path sends anything, so the
  one-in-flight gate and recorderTC's deadline are unchanged. In bankNightTurn the `continue` keeps the lock held, like
  the other `continue` paths in that loop.
- No Tally request added or changed (TestAllowListUnchanged; release-check step 4).

**Run (worktree at dc54ac4d).** go vet clean on Linux and on Windows. `go test -count=1 -timeout 25m ./...` passes
(ok, 939 s). The two new tests pass, and all 28 TestBankDate* and TestSelfCheck* tests pass (verbose).
release-check.sh: steps 1-4 pass (step 4: allow-list sha256 3dd32c7ff3379136, as expected); it stops at step 5 only because the review notes name 751c1795 (the files after it: bankdate.go and bankdate241older_test.go).

**Findings at dc54ac4d: 0 High, 1 Medium, 3 Low.** (see below: M1 and L1 now closed)
- **M1 (bankdate.go:181-191 with :148).** The `older` mark is kept in memory only; bankSave does not keep it. Any
  bankSave between 2.4.1's start and an older company's first light check writes `"addonN":0` for that company, because
  bankSave writes every company. That save can come from another company's light check, an add-on line or a taken
  entry. If the bridge restarts before that company's first check, bankFresh sees the key, `older` is false, and the u2
  failure comes back: the move since 2.4.0's counter is listed, and the entries 2.4.0's add-on lines sent are read and
  sent again. Reproduced with an uncommitted probe, run and removed: older state, restart, one bankSave, restart, light
  check. The list was asked (`$AlterID > 54392`) and MasterIDs 26311 and 26312 were read and sent again. A likely case:
  a firm with several companies, one of them not opened in Tally on upgrade day, and a reboot before it is opened. The
  cost is a duplicate 'altered' line (same entry, same AlterID) and extra reads within the gates; no figure is wrong.
  The real-Tally check u2 (one company) cannot see it. Fix: while `older` is set, bankSave leaves out
  addonN/addon/listed (or writes `"older":true`, which bankFresh reads back). Add a test with a save and a restart
  before the first check.
- **L1 (bankdate.go:353).** With the self-check off ("SelfCheck": false), or not run (no cloud, never idle after hours,
  the company not open at night), a bank date set in the upgrade stretch is never sent, and nothing says so. For a
  company on the night route the stretch can be a day. The log line says the counter was taken but not that bank dates
  before it depend on the nightly check. Suggest words when selfCheckOn() is false.
- **L2 (bankdate.go:349).** Seen = v also when Tally's counter is below the saved one (a restore), so the counter moves
  back, never below the starting point. This matches bankState. Noted only.
- **L3 (as before, bankdate.go:363 and :349).** An add-on line counted between the light check's reading of the counter
  and bankFromOlder or bankExplained is cleared with the count, so that one save can be read again once. This was there
  before the fix.

**M1/L1 fixed in 897f393b** (tests 013fcd7c; tax-accuracy fb38cf5a; delta dc54ac4d..fb38cf5a: bankdate.go +16/-3,
bankdate241older_test.go +108; nothing else outside docs/).
- **What changed.** While a company is marked older, bankSave (bankdate.go:195-203) writes `"older": true` and leaves
  out addonN, addon and listed. bankFresh (bankdate.go:148) marks a company older when it has no addonN or has
  `"older": true`.
- **Every save path.** Every save goes through bankSave, so the mark survives whoever saves: another company's light
  check, an add-on line, a taken entry, the nightly turn or the read of pending entries.
- **Crash during a write.** saveFile (util.go:228) writes a temporary file and renames it into place, so a crash
  leaves the previous file whole.
- **When the mark clears.** Only bankFromOlder clears it (bankdate.go:357). That runs only from the company's own light
  check, after ownPortErr and bankNumbers, or from its own nightly turn, after which bankSave writes the full shape.
- **Who can be marked.** `"older": true` is written only for a company loaded already marked older. A company made in
  2.4.1 through bankState never is, and a file written by 2.4.1 always has addonN otherwise.
- **L1's line.** It is said once with the "counter taken" line, only when selfCheckOn() is false. A bank-route company
  always has the cloud on (bankOn).
- **Checks.**
  - The M1 probe, re-run and then removed (older state, then save and restart twice before the first check): the mark
    stays on disk, nothing is listed, read again or sent again, and `older` is gone after the first check.
  - go vet clean on Linux and on Windows.
  - `go test -count=1 -timeout 25m ./...` passes (ok, 952 s).
  - 30 of 30 TestBankDate* and TestSelfCheck* tests pass (verbose), the two new ones included.
  - release-check.sh steps 1-4 pass (allow-list sha256 3dd32c7ff3379136); it stops at step 5 only for the notes'
    range.
- **Status.** M1 closed. L1 closed. L2 and L3 unchanged (noted only).
- **New Low L4 (bankdate.go:357, informational).** bankFromOlder clears the mark in memory before bankSave. If that
  write fails (logged), the disk still says older, and the next start takes Tally's counter again. That moves forward
  only, so nothing is read or sent again; a bank date in that run's stretch is left to the self-check (or the L1 line).
- **New Low L5 (bankdate.go:365, wording).** "that day's Day Book": for a company on the night route the stretch can
  begin the night before. "the Day Book from the last check" would be exact.

Range: 7c13c777..fb38cf5a
