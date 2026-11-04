# Code review: FinCom Bridge 2.5.4 (no hang and no false message on a shared Windows server)

Reviewers: two rounds of an independent review session (the coordinator's), on f9f807b88 and on 9c8546b75, besides the
build session's own pass. Every finding was fixed on branch next-bridge-254, each with a test that fails on the commit
reviewed and passes after (bridge-go/r254review_test.go, bridge-go/r254review2_test.go); the B2 kept-list test needs the
late answer itself, so it cannot run on f9f807b88.

Range: e7f2f1990..f1f856b5e

(bridge-go/, its installer, tests/fixtures for the beat and the recorder lines, docs/tally-allowlist.md's 2.5.4 lines,
and server/tally-cloud/index.ts's beat fields; the rest of the range is staging-next merged in, reviewed on its own.)

## What 2.5.4 changes (docs/bridge-2.5.4-notes.md has the detail)

1. The beat's `update`: the last look, its words, the version offered, applying, checking, noAutoUpdate, next.
2. Windows' process list and listener / TCP tables read at most once in 1.5 s, shared; /ping's peer checks use a table
   taken after the connection was accepted.
3. tally.ini's connection never written in a file every user of the computer shares; "cannot write" in plain words.
4. tallyWhy "connection off" above "owner unknown" and "another user".
5. A Tally's owner settled by the Windows user it runs as before any tie-break.
6. The company list and one company's GSTIN / PAN: 2 s at most.
7. The setup / uninstall for all users end only the service's own process.
8. Updates: download timeouts, one look at a time, the tray never waits, the restart only when nothing goes to Tally,
   the new program kept only when it works.

## Round 1 (f9f807b88) and the fixes

- B1 (blocker): with the 2 s cap a Tally that always answers in 2-8 s never had a list (the late answer was read and
  thrown away), so the open company was never found and postings said "Tally is busy". Fix: late254.go keeps Tally's
  late answer to TDSDeskCompanies / TDSDeskCompanyInfo finished within TallyAbandonWaitSec after the stop, with the
  program then on the port; the next ask of the very same request within a minute takes it (invokeTally;
  openCompaniesAsk marks it `late`); busy / not-responding marks cleared. One request in flight unchanged.
  Test: TestR254ReviewB1LateListKept.
- B2 (blocker): the wait after a slow list held fresh asks (a posting used a stale list: a false "not open" for up to 10
  minutes) and was keyed by port only. Fix: never for a fresh ask; dropped when another program is on the port; a kept
  list that does not name the posting's company asks Tally once more (findCompanyIn, TC.noLate).
  Tests: TestR254ReviewB2FreshNotHeld, TestR254ReviewB2KeptListWithoutCompany.
- S1: "Check for updates" while an update waited re-applied it and replaced FinComBridge.old.exe (the real previous
  version). Fix: no look while an update is in place or update-pending.json exists; the quiet wait has a 30-minute
  maximum, after which the first quiet look restarts. Tests: TestR254ReviewS1NoSecondApply, TestR254ReviewS1QuietMax.
- S2: 2.5.3 and 2.5.4 bridges broke the last tie differently. Fix: /ping carries claimRule "user"; with an older peer
  the bridge port decides, as that peer does. Test: TestR254ReviewS2MixedVersions.
- S3: a GSTIN / PAN that did not come in 2 s was kept empty for 6 hours. Fix: not kept; asked again after 5 minutes,
  or the late answer taken. Test: TestR254ReviewS3CoInfoNotCachedOnFailure.
- S4: a setup-old.exe held by another user's tray blocked the next setup's rename; the uninstall left such files. Fix:
  moved to a unique name and removed at the next restart; the uninstall marks files in use for the next restart.
  Test: TestR254ReviewS4SetupOldInUse.
- M1: package testing imported into the production code (iniconnect254.go). Fix: a hook the tests set.
  Test: TestR254ReviewM1NoTestingImport.
- M2: Entra ID user SIDs (S-1-12-1-) were not counted as people. Fix: isUserSid accepts them.
  Test: TestR254ReviewM2EntraSid.

## Round 2 (9c8546b75) and the fixes

- N1 (must): a look that only found update-pending.json left the one-look flag set for good (no more updates until a
  restart; the beat said checking). Fix: kept only while an update this bridge put in place waits to start again.
  Test: TestR254ReviewN1FlagClearedWhenOnlyPending.
- N2: a fresh ask that timed out reused the previous list marked busy; a company missing from it was reported "not open".
  Fix: busy wins over "not open" in findCompanyWith. Test: TestR254ReviewN2BusyNotNotOpen.
- N3: a caller queued behind the slow list sent the list again after the lock. Fix: the late answer looked for again
  right after the lock. Test: TestR254ReviewN3QueuedCallerTakesLate.
- N4: forgetLateFor was never called: an older late list could follow a newer answer in time. Fix: an answer in time
  drops the late one. Test: TestR254ReviewN4InTimeDropsLate.

## Found while releasing (the build session)

- The random 0-60 minute wait before an update check (first round, fix 8) would keep a 2.5.4 bridge outside FinCom's
  update gate window for good: the gate (migration 139, server/tally-cloud/updategate.js) expects each look 2 minutes
  after the start and then every 6 hours (4 minutes before to 6 after), and already lets one bridge of a computer
  through at a time. The wait is off by default (UpdateJitterMin 0). Test: TestR254UpdateJitter (the default waits are
  the gate's).
- tests/run_gobridge_beat.py's check "is busy (no answer in time)" looks for log words the bridge has not written for
  several releases ("is busy (no answer in Ns)"); not changed here.

## Known limits (notes)

- A shared tally.ini 2.5.3 already switched on is not undone (it could take the working user's port).
- The last tie between two bridges that both cannot tell whose a Tally is remains a tie-break.
- A company list that never comes within the wait after the stop (over about 22 s) is still never had.

## Tests

go vet (Linux, Windows), GOOS=windows go build, go test -timeout 40m ./... (bridge-go), release-check.sh;
tests/run_beat254_ingest.py, run_update_gate_ingest.py, run_period_ingest.py, run_beat_history.py (Deno).
