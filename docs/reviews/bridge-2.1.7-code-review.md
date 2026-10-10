# Code review: FinCom Bridge 2.1.7

Reviewed: 03-Oct-2026 (night), by the code-review skill in the Claude Code session (range 27aa360..HEAD at the time), then
re-read after the fixes. What 2.1.7 adds over 2.1.6: the round-12 guard (a Day Book answer listing no entry for days the
copy holds is not trusted), the installer's POSTONLY="any" clearing, the tray item "Test reading from Tally" (readtest.go,
/tray/readtest, win_tray.go), dayBookRequestDMY, the release rule of round 13 (release-check.sh check 4: the owner's
per-build exception line), and migration 42 with its 24-hour cap (cloud side, read as part of the same change).

Focus: a read fault reaching the cloud as an emptied day; a request reaching Tally outside the allow-list or started from
a web page; anything the read test could write or send; the installer touching a hand-set PostOnly; the release check
accepting a wrong version.

## Findings (both fixed test-first before the build; evidence in the commit messages and scratchpad/tdd/round13b.*)
1. keep.go slice guard: a day whose EVERY entry was genuinely removed in Tally (a posted test voucher deleted later; the
   read-back had written it into the day file) could never be read again: the empty answer was distrusted for ever, the
   day failed three times each Update now and was skipped, the stale entry stayed in the copy and the cloud. Fixed: on
   the third try of a one-day slice the bridge asks with a different request kind (FinComTag, the posting read-back's
   collection, for that day); when that lists no voucher either, the empty day is trusted and sent as empty:true (the
   cloud's second-read rule and the 24-hour cap of migration 42 still apply there); when it lists any, or does not answer
   properly, the distrust stands. TestEmptiedDayConfirmedByCollection, TestEmptiedDayNotConfirmedWhenCollectionListsEntries.
2. win_tray.go / server.go read test: the tray waited 4 minutes synchronously; three 60 s requests plus waiting for the
   Tally lock behind a copier or posting request could exceed it, the tray then said "not answering" while the test still
   ran and a retry was refused. Fixed: POST starts the test and answers at once, GET says running / done / failed, the
   tray polls every 2 s up to 15 minutes as Measure Tally does. TestReadTestThreeRequestsLogged (start, then poll).

## Found safe
- keep.go round guard: roundN == 0 with a non-empty copy sets the trouble and skips sendReadGuard only; next/roundAt are
  set as before, so the next Update now reads again; a copy with no entries anywhere keeps today's behaviour.
- answerHead: attributes and values dropped by two regular expressions before any text reaches the log; a plain-text
  answer gives ""; tested for digits, names and quotes.
- readtest.go: reads only (no saveFile, no writeDayFile, no addCloudDays, no keep state); TryLock against overlap;
  measuring counter as the measure tool (a slow answer here does not trip the self-watch); the three requests are the
  copy's own, the same with d-MMM-yyyy dates (same allow-list id) and FinComTag; invokeTally applies the allow-list, the
  read stop and the probe hold as for every request.
- config.go setPostOnly("any"): clears only an installer-marked list (or writes [] on a fresh file) and marks it the
  owner's; a hand-set or owner-marked list is never touched; an empty POSTONLY still leaves the settings alone.
- release-check.sh check 4: the exception needs the owner's decision words and this BridgeVersion; two versions, another
  version, or no words fail (release_check_test.sh: green 2/3, red 7/8/10/11).
- migration 42: one function, same arguments and grants; the cap counts per book over 24 hours and never records a
  refused day; the 7-argument wrapper untouched; run_migration42.py and run_migration_order.py green.

Range: 27aa360..81ce8da (bridge-go/, release-check.sh and its self-test, docs/tally-allowlist.md, server/tally-cloud/migration-42)
