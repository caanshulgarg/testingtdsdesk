# Code review: FinCom Bridge 2.1.9

Reviewed: 04-Oct-2026, by the reviewer in the Claude Code session, the diff 416c335..457dc64 read hunk by hunk
(bridge-go/, docs/tally-allowlist.md, docs/bridge-2.1.9-test-sheet.txt); bridge-go/ is unchanged from 457dc64 to HEAD
(41d47be). `go vet ./...` and `GOOS=windows go vet ./...` clean; `go test -count=1 ./...` green (164 s; TestNoComputedFigure,
TestAllowListUnchanged, TestEveryDatedRequestUsesDateVars and TestSizeBigCompany among them); the round 18 tests also green
under `-race`; `bash bridge-go/release_check_test.sh` green (14 cases, "all cases as expected"). Five suspected faults were
confirmed with throwaway tests in the scratchpad (a copy of bridge-go/ with zz_scratch_r19_test.go), nothing in the repo.
What 2.1.9 adds over 2.1.8 (round 18, the owner's rule of 04-Oct-2026, "reading is prospective only"): ReadDays (off;
the keeper's round stops after the company check and the ledger list; /daybook, /vouchers, /tags, /keepcheck refused with
409; /ledgerlines from the copy only), dateVars / periodVars for every dated request (the same yyyymmdd bytes), the
starting point (sync\start-point.json, startpoint.go) and the latest change numbers in the beat, the light FinComCompany
check of each open company (first sight, then at most every 10 minutes), the read test matrix (four date forms, an empty
day, FinComTag, FinComCompany, the entries above the starting point with no dates, UTF-16 against UTF-8), the
TallyRequestUTF16 option (off), the recorder trial (recorder.go, recorderline.go, two tray items, the folder watch, the
add-on FinComRecorderTrial.tdl) and the installer's recorder\ and addon\ folders.

Focus: any path that still sends a dated voucher request with ReadDays off (every caller of invokeTally and of the request
builders traced); whether ReadDays can be changed by the beat's answer, settings from the cloud or a local route; the
starting point recorded once; the light check against a posting and the lease; the person-only tray routes; the recorder
folder (written by Users, read by the bridge); the support pack's content and size; concurrency and error handling.

## Findings (open; none fixed yet)
1. HIGH, the owner's rule (dated reads with ReadDays off). bridge-go/server.go:250-251 and bridge-go/reads.go:243-284:
   GET /readtest (the older "what reading works" route, X-Bridge-Key only, no ReadDays check) calls readTest, which sends
   dayBookHeads (the Day Book, the last 30 days) and voucherHeads (TDSDeskVchHeads, the last 30 days). FinCom's own page
   calls it (src/js/27-firm-account.js:1847, the firm account's reading test). Only /daybook, /vouchers, /tags and
   /keepcheck got readsOffErr. Confirmed: TestScratchOldReadTestRouteReadsDays (ReadDays false, GET /readtest: 200, Tally
   asked FinComCompany, TDSDeskLedgers, TDSDeskGroups, Day Book, TDSDeskVchHeads). Minimal fix: in the /readtest case,
   `if err := readsOffErr(); err != nil { return nil, err }` (the app already handles the 409 since 3ebb165). Belt and
   braces (recommended, the rule says "by any route"): a central refusal in invokeTally, after checkAllowed: a request
   with a period (requestFrom(x) gives a from date) is refused unless readDaysOn() or tc.person (a new TC field set only
   by runReadTest and runMeasure / measureSnapshot); the Import envelope is not dated and is unaffected. That also covers
   the dead builders still in the code (findPostedTags, findAccepted, dupCheck / dupCheckWith, copyKeepDays: no callers
   today). Test: TestReadTestRouteRefusedWhenReadDaysOff (GET /readtest: 409 with readsOffWords, zero requests at the
   stand) and TestNoDatedRequestWhenReadDaysOff (with ReadDays off, every route of server.go with a company and a period,
   Update now, the nightly run, /wake, /syncnow, a posting: no request carrying SVFROMDATE reaches the stand; the read
   test still sends its Day Book forms).
2. HIGH, security (service installs). bridge-go/recorder.go:246-248 with bridge-go/util.go:248-257: "note change numbers"
   appends to C:\ProgramData\FinCom\recorder\changenumbers.txt with os.OpenFile(O_APPEND|O_CREATE), which follows links,
   in a folder every member of Users may change. The bridge installed for all users is a LocalSystem service
   (win_service.go:660-670, no account given). Confirmed: TestScratchRecorderNoteFollowsLink (changenumbers.txt planted
   as a link to another file: the line was appended to that file). Detail and exploitability in the security review (S1).
   Minimal fix: the service never writes into recorder\: keep the lines in its own folder, sp("recorder-changenumbers.txt")
   (the sync folder, not writable by Users), show that path in the box, and add the file to the support pack as
   "recorder/changenumbers.txt". Test: TestChangeNumbersNotWrittenInRecorderFolder (a link planted at
   recorder\changenumbers.txt: its target unchanged; the line in the sync folder; the support pack carries it).
3. HIGH, security (installer). bridge-go/installer/FinComBridge.nsi:411-418: CreateDirectory on a path that already
   exists does nothing, and `icacls "$R1\FinCom\recorder" /grant *S-1-5-32-545:(OI)(CI)M` (no /L) changes the target of a
   junction; File /nonfatal writes through a junction at addon\ too. A Windows user without administrator rights may
   create C:\ProgramData\FinCom and a junction inside it before the setup runs (ProgramData lets Users create folders), so
   an all-users setup (elevated) would give Users Modify on whatever the junction points at. (OI)(CI)M also gives Users
   DELETE on recorder\ itself, which is what lets it be swapped later (finding 2, finding 4). Detail in the security
   review (S2). Minimal fix: move the folder step into `FinComBridge.exe install` (Go, run by the setup): os.Lstat
   C:\ProgramData\FinCom, recorder and addon; if any is a reparse point (ModeSymlink or ModeIrregular) or FinCom is not
   owned by SYSTEM / Administrators, rename it aside and create it anew; set explicit, protected DACLs (FinCom\ and
   addon\: SYSTEM and Administrators full, Users read; recorder\: SYSTEM and Administrators full, Users read + create
   files on the folder itself and (OI)(IO) Modify on the files only, no DELETE on the folder); the NSIS copies the .tdl
   only after that step says the folder is safe. In a per-user setup, keep the folders as they are made today but owned
   by the installing user. Test: TestInstallerRecorderAndAddonFolders updated (no icacls on the recorder path in the
   NSI; the exe step named), and a Windows-only TestRecorderFolderJunctionRefused (a junction pre-made at recorder\: the
   step logs it, renames it aside and the target's DACL is unchanged).
4. MEDIUM, security and robustness (the support pack). bridge-go/recorder.go:164-191 and :112, bridge-go/sendlog.go:51-60:
   "send results" reads every *.txt of the Users-writable folder whole with os.ReadFile and cuts to 4 MB only afterwards,
   reads each again whole in recorderSummary, has no limit on the number of files, follows links, and reads tdlerror.log,
   tally.imp and tally.ini from the folder of ANY running process named like tally.exe (recorder.go:41-45: a folder a user
   may own). The zip is checked against 9 MB only after it is built. A planted multi-GB file (or a few hundred 4 MB ones)
   makes the service allocate it all; a link makes it read a file outside the folder and send it to FinCom support.
   Confirmed: TestScratchRecorderSendFollowsLink (a link x.txt to a file outside the folder: read and sent, files 1).
   Minimal fix: a readBounded(path, max) helper: os.Lstat must be a regular file (no ModeSymlink, no ModeIrregular), open,
   f.Stat and os.SameFile with the Lstat result, on Windows refuse NumberOfLinks > 1, then Seek to size-max and read with
   io.LimitReader; at most 50 recorder files, 32 MB raw in all; recorderSummary takes the same capped bytes (not a second
   read) and stops at 2,000 lines a file; Tally's files only from the Program Files folders (not from a process's own
   folder), through readBounded; the recorder folder itself skipped when it is a reparse point. Test:
   TestRecorderSendSkipsLinksAndBoundsSize (a link skipped; a 64 MB sparse file sent as its last 4 MB with the heap growth
   under 16 MB; 200 small files: 50 sent; the folder replaced by a link: nothing read).
5. MEDIUM, the owner's rule ("recorded once"). bridge-go/startpoint.go:38-41 and :57: when start-point.json exists but
   cannot be read or parsed (cut short, locked by a backup or an antivirus for a moment), readObjFile gives nil, `all` is
   started empty and the file is rewritten with this company alone: every other company's starting point is lost and
   recorded anew, later, at a higher number. saveFile's error is ignored and the log says "recorded" either way.
   Confirmed: TestScratchStartPointUnreadableOverwritten (a cut-short file holding OTHER CO: after one company check the
   file holds ZZ TEST only). Minimal fix: tell "missing" from "unreadable": if the file exists and does not parse, log
   once, keep the numbers in memory only and do not write (or move it to start-point.bad-<time>.json first and say so);
   write the log line only after saveFile succeeded, and log its error. Test: TestStartPointFileUnreadableNotOverwritten
   (a cut-short file: unchanged after a company check, the log names it; made readable again: the new company added, the
   old one kept).
6. MEDIUM, the owner's rule ("recorded once"). bridge-go/startpoint.go:48-51: any FinComCompany answer with another GUID
   (the light check runs on every open company, so a restored copy or a second company of the same name open in another
   Tally is enough) records the starting point anew, keeping only one "was"; alternating between the two moves the first
   company's starting point forward, and the entries in between are then "before the starting point" for FinCom. This
   happens without the person's confirmation that guardCompanyGUID and /companyguid ask for everything else.
   Confirmed: TestScratchStartPointFlipFlop (GUIDs a at 10, b at 50, a at 12: a's starting point is now 12). Minimal fix:
   key the file by company and GUID (companyKey(company) + "|" + guid), record each GUID's entry once and never overwrite
   it; the beat sends the entry of heldGUID(company) (the GUID the bridge holds or the person confirmed), plus
   "otherGuids" when there are more. Test: TestStartPointKeptPerGUID (a 10, b 50, a 12: a stays 10, b 50; the beat shows
   10 for the held GUID).
7. MEDIUM, owner's decision needed (dated reads by the measuring tool). bridge-go/measure.go (items b, c0, the year, d, e
   and the snapshot, measureReq* at :773-800): POST /measure, /tray/measure and `FinComBridge.exe measure` send collections
   of vouchers over the whole year with ReadDays off. They are person-only (no Origin, no Sec-Fetch, measure-only on the
   allow-list), but the owner's rule names only the read test as the exception, and the year-wide collection is the
   shape that risks hanging Tally. Minimal fix (if not exempt): with ReadDays off, runMeasure runs only the items with no
   period (a, a2, the ledger items) unless the console was given --old-days; the test sheet says so. Test:
   TestMeasureDatedItemsNeedReadDays. If the owner exempts it, a line in docs/tally-allowlist.md and the test sheet.
8. LOW, the owner's rule ("never during a posting"). bridge-go/startpoint.go:144-192: lightCheckOpen looks at
   activeJobs() and leaseHeldHere() BEFORE companyCheck waits for the Tally lock; enterTallyLock's copier branch
   (tally.go:463-484) can then hand it the lock between two requests of a posting job (the job holds the lease, but it is
   not looked at again), or during a browser /import (invokeImport takes no lease and is not a job). The job's next
   request preempts it at once, so no posting waits; Tally still gets a cancelled FinComCompany in the middle of a
   posting. Minimal fix: a `yield func() bool` on TC, consulted in the copier branch right after the lock is taken
   (release and return errBackoff when it says so); the light check passes `func() bool { return len(activeJobs()) > 0 ||
   leaseHeldHere(name) || importsInFlight.Load() > 0 }`, with importsInFlight counted around invokeImport. Test:
   TestLightCheckYieldsToJobStartedWhileWaiting (the light check waiting behind a slow read; a job started meanwhile: no
   FinComCompany from the light check between the job's requests).
9. LOW. bridge-go/startpoint.go:125-131: recorderHolding builds "name-" + company + ".txt" from a company name Tally gives
   (any text the desk user types); with "\" or ".." in it the Stat goes outside the recorder folder and that file's time
   goes to the cloud in the beat (recorderLastAt). Fix: only a name with no path separator and no "..", else not looked
   at. Test: TestRecorderHoldingNoTraversal.
10. LOW. bridge-go/recorder.go:219-229: "note change numbers" sends FinComCompany as a FinCom request (fin, which
    isPostingRequest counts as a posting's), so it goes ahead of FinCom's reads, and one company that does not answer
    ends the whole item with nothing noted for the others. Person-only. Fix: note each company that answered and list the
    ones that did not. Test: TestChangeNumbersOneCompanyMissing.
11. LOW. bridge-go/recorder.go:59-104: the folder watch keeps a map entry per file name with no limit on the number of
    files (5,000 times each) and globs the folder every second for the bridge's whole life. Fix: at most 50 files watched
    (the same bound as the pack). No test needed beyond finding 4's.
12. LOW (allow-list). bridge-go/keep.go:159-166: keepListAboveRequest is a new shape (an AlterID filter over the whole
    books, no period) under the existing id TDSDeskKeepList, which is not measure-only; the allow-list fingerprints only
    keepListRequest(c, a, z, 0), so TestAllowListUnchanged cannot see it. Today only the read test and measure item a2
    build it. Fix (with the next measured build): its own id TDSDeskKeepAbove, measureOnly, in allowListSamples and the
    table. Test: TestKeepAboveIsMeasureOnly (refused outside the read test and the measuring tool).
13. INFORMATIONAL. The read test (person-only, the owner's exception) takes the first open company, which may be real
    books; its anchor request is FinComTag for today, which per readtest.go:82-84 Tally NWS144 answers for its whole
    current period, and a Day Book form that ignores the period returns the period with every line. Each is capped at the
    20 s read limit, and a timeout puts the probe hold on. Worth a yes/no in the tray naming the company before it runs.
14. INFORMATIONAL (release). With "Range: 416c335..457dc64", release-check step 5 at the current HEAD fails: app/,
    server/, src/ and tests/ changed after 457dc64 (3ebb165, 41d47be) and the working tree has uncommitted changes outside
    docs/. Build from a tree where only docs/ changed since 457dc64, or extend the reviewed range.

## Found safe
- ReadDays: no entry in defaultSettings (truthy(nil) is false); applyCloudSettings reads only postOnly, postBatchBills,
  postBatchBank and at (TestReadDaysOffNoOldEntriesRead sends readDays / ReadDays and it stays off); no local route sets
  it (/keep sets KeepInStep, KeepDailyAt, KeepSchedule; /cloudlink the cloud link; /keepmode a company's mode); the
  installer does not write it. Only the settings file sets it. TallyRequestUTF16 is the same (file only, off).
- Every other dated path with ReadDays off: the keeper stops after the company check and the ledger list (keep.go:853-864),
  before the day slices and the FinComTag at keep.go:903; /syncnow and /wake go through the keeper; /daybook, /vouchers,
  /tags, /keepcheck answer 409 before anything is sent; /ledgerlines answers from the copy (an empty list and the note
  when it does not cover the period); /ledgervouchers, /ledgerbalance, /balances and /tb are copy-only; the posting path
  sends only imports and FinComCompany (no read-back since 2.1.8); afterPosting and afterPostingLedger read no entries.
  The one route left is /readtest (finding 1).
- dateVars(formPlain, ...) gives the same bytes as before for every builder; TestEveryDatedRequestUsesDateVars and the
  allow-list hash are green; the other forms are built only by the read test.
- The starting point in the normal case: under spMu, recorded on the first FinComCompany answer from any path (the
  company check, the probe's noteCompanyAlts, the recorder note), never moved on a later answer with the same GUID;
  the read test does not record it (it calls invokeTally directly); the beat carries startPoint, changeNumbers and
  readDays (TestStartPointRecordedOnce, TestBeatCarriesRecorderState).
- The light check: sent as a background read (TC copier), so it waits while FinCom waits and is cancelled at once by a
  FinCom request; a cancelled or backed-off check is not marked and goes again at the next beat; not run while reading
  is stopped or paused; per company the mark is taken under spMu before the request, so overlapping beats do not send two.
  TestOpenCompanyLightCheckOnce, TestLightCheckNothingDuringPosting, TestPostingGoesFirstOverLightCheck; no race reported
  by `go test -race` on the round 18 tests.
- The read test changes nothing: no form switched (periodVars is always formPlain), no file, no cloud call; its results
  go to the log and the tray box only.
- Tests changed in the range only follow the new matrix (round13: 8 results, 4 Day Book forms) or turn old days on where a
  test is about the day logic (oldDaysOn in rebuilt_test.go); none was weakened.
- recorderline.go: the parser is bounded by its input, takes narr to the last "|t1=", joins continuation lines, and
  rejects a line with a missing key (TestRecorderLineParse).

## Fix before build (must)
1. Finding 1: /readtest refused with ReadDays off, and the central refusal of any dated request in invokeTally (person
   tests excepted). TestReadTestRouteRefusedWhenReadDaysOff, TestNoDatedRequestWhenReadDaysOff.
2. Finding 2: the change numbers written in the bridge's own folder, never in recorder\.
3. Finding 3: the folders made and their permissions set by the exe, junctions refused, no DELETE for Users on recorder\.
4. Finding 4: the support pack reads regular files only, bounded before reading, at most 50 files; Tally's files only from
   Program Files.
5. Findings 5 and 6: start-point.json never rewritten from an unreadable file; one starting point per company and GUID,
   never overwritten.
6. Finding 7: the owner says whether the measuring tool is exempt; if not, its dated items need ReadDays or --old-days.

## Later (may)
- Findings 8 to 12. Finding 13: a yes/no naming the company before the read test. Finding 14: the range for the build.

## Fixed (04-Oct-2026, test-first; red outputs in the session scratchpad tdd/b219fix.<n>.red)
Checks after the fixes: `go vet ./...` and `GOOS=windows go vet ./...` clean; `go test -count=1 ./...` green (193 tests,
177 s); the recorder, start-point, light-check, measure and ReadDays tests green under `-race`;
`bash release_check_test.sh`: all cases as expected. The Windows-only tests (round19_windows_test.go) compile under
`GOOS=windows go vet`; they run on real Windows in the new workflow job "go-tests-windows" (`-run 'Windows|Shared'`).
1. Finding 1 (HIGH). server.go: GET /readtest answers readsOffErr (409, readsOffWords) with ReadDays off. tally.go:
   `datedRefused` in invokeTally, right after the allow-list: any request carrying SVFROMDATE or SVTODATE (any date
   form) is refused before anything is sent unless ReadDays is on or `TC.person` is set; the log says "<id> refused
   before sending: it carries a period and reading old entries is off (ReadDays)". `TC.person` is set only by the read
   test (readtest.go, readTestTC) and the measuring tool with --old-days (measure.go). Tests:
   TestReadTestRouteRefusedWhenReadDaysOff; TestNoDatedRequestWhenReadDaysOff (findPostedTags, findAccepted, dupCheck,
   copyKeepDays, getDayBookXML as FinCom and as the copier, dayBookHeads, voucherHeads, tagsOnDate, voucherByMaster,
   keepList, the four Day Book forms, FinComTag; every route with a company and a period; Update now, the nightly run,
   a posting: no dated request reaches the stand; the read test still sends its Day Book forms). Twelve older tests
   that exercise the dated logic itself now turn ReadDays on first (oldDaysOn(), as 2.1.9 already did for the day
   rounds): TestEveryRequestOnList / TestNoComputedFigure (driveEveryRequest), TestUnknownRequestRefused,
   TestDupReadForCheckTally, TestFakeTallyBehaviours, Test02OctStackedRetries, TestMeasureTool,
   TestPostedTagFoundByDate, TestUTF16Option, TestTagFoundAnywhere, TestMeasureStopsAtFirstHang,
   TestMeasureWaitsForCheckAfterHang. No assertion was weakened. httpErr.Error() now reads as its words.
2. Finding 2 (HIGH, S1). recorder.go: "note change numbers" appends to sync\recorder-changenumbers.txt (the bridge's
   own folder, changeNumbersFile()), never in recorder\ (the MkdirAll of recorder\ is gone too); the box names that
   file; the support pack carries it as bridge/changenumbers.txt. Test: TestChangeNumbersNotWrittenInRecorderFolder
   (a link planted at recorder\changenumbers.txt: its target unchanged; the line in the sync folder; in the pack).
   TestChangeNumbersNoted follows the new place.
3. Finding 3 (HIGH, S2). folders.go: `FinComBridge.exe install` (installCmd, for all users) and `install --per-user`
   (installUserCmd) call installFinComFolders: C:\ProgramData\FinCom, then recorder\ and addon\, each looked at
   with os.Lstat (and, on Windows, FILE_ATTRIBUTE_REPARSE_POINT): a link, junction or other reparse point, a file, or
   (all users) a folder not owned by SYSTEM or Administrators is renamed aside (<name>.moved-<time>, logged) and the
   folder made anew; looked at again after it is made; if it cannot be moved aside the step stops (the install goes on,
   the trial lacks its folders). For all users, icacls with /L on each folder itself: FinCom\ and addon\
   /inheritance:r, SYSTEM and Administrators (OI)(CI)F, Users (OI)(CI)RX; recorder\ /inheritance:r, SYSTEM and
   Administrators (OI)(CI)F, Users (RX,WD) on the folder only (add files, no DELETE, no subfolders) plus (OI)(IO)M on
   the files; owner set to Administrators (a failure there is logged only). FinCom\ is protected first so nothing can
   be swapped inside it afterwards. The .tdl is built into the exe (go:embed addon/*.tdl) and written with
   remove-then-O_EXCL (a planted link or hard link is not written through). The NSI no longer makes the folders, runs
   icacls or copies the .tdl. Tests: TestInstallerRecorderAndAddonFolders (updated: none of that in PutFiles, the exe
   step named in both install paths, the .tdl embedded); TestRecorderFolderLinkRefused (a symlink at recorder\ moved
   aside, its target untouched, every icacls has /L and never names the target, the recorder grants as above and no
   (OI)(CI)M; a FinCom\ owned by a user moved aside; a link at addon\FinComRecorderTrial.tdl not written through);
   TestRecorderFolderJunctionRefusedWindows (Windows only: a junction made with mklink /J: moved aside, the target's
   icacls output unchanged, recorder's ACL has (OI)(IO)(M) and no (OI)(CI)(M)). The workflow's all-users install step
   also checks the add-on file and the recorder ACL on real Windows.
4. Finding 4 (MEDIUM, S3). shared.go: readShared / readTail: Lstat must be a regular file (no link, no reparse point),
   opened read-only (Windows: CreateFile GENERIC_READ, FILE_SHARE_READ|WRITE|DELETE, FILE_FLAG_OPEN_REPARSE_POINT;
   elsewhere O_NOFOLLOW|O_NONBLOCK), os.SameFile with the Lstat, one name only (NumberOfLinks / Nlink), Seek to the
   last maxBytes and io.LimitReader. recorder.go: at most 50 recorder files (recorderFiles, also bounding the folder
   watch), 4 MB each, 32 MB in all; the summary uses the bytes already read (no second read) and at most 2,000 lines a
   file; a recorder folder that is itself a link: nothing read; Tally's tdlerror.log, tally.imp, tally.ini only from
   folders under Program Files / Program Files (x86) (a running tally.exe elsewhere is not looked at; C:\TallyPrime
   dropped), through readShared. sendlog.go fileTail uses readTail (the logs: regular files, tail only). Test:
   TestRecorderSendSkipsLinksAndBoundsSize (a link skipped; a link as tally.ini skipped; a 64 MB sparse file sent as
   its last 4 MB; 200 files: at most 50 sent; the folder replaced by a link: 0 files; underDir); TestReadSharedBounds.
   The heap-growth measurement in the suggested test was not added (the bound is shown by the bytes sent).
5. Finding 5 (MEDIUM). startpoint.go: readStartPoints tells missing (empty, may be written) from unreadable (exists,
   does not parse): an unreadable file is never rewritten, the numbers stay in memory, the log says once "<file> could
   not be read ... it is not rewritten"; the "recorded" line is written only after saveFile succeeded, and a save error
   is logged. Test: TestStartPointFileUnreadableNotOverwritten.
6. Finding 6 (MEDIUM). startpoint.go: one entry per company AND GUID (key companyKey|guid), recorded once, never
   overwritten; another GUID gets its own entry ("Tally gave another GUID (...); its own starting point is recorded
   ...; the starting point of every other GUID is kept"). startPointOf and the beat use the held GUID's entry (else the
   GUID of the latest answer, else the oldest); the beat adds "guid" and "otherGuids" when there are more. Tests:
   TestStartPointKeptPerGUID (a 10, b 50, a 52: a stays 10, b 50; the beat shows 10 for the held GUID and one
   otherGuids entry); TestStartPointRecordedOnce updated to the per-GUID file.
7. Finding 7 (MEDIUM, owner's decision; the safer default taken). measure.go: with ReadDays off the tool runs only its
   undated items (a, a2, the ledger items f); b, c1, c0, c2, d, e are listed as not run with how to run them, and the
   snapshot is refused. They run with ReadDays on, or with --old-days typed at the console (measureArgs; TC.person):
   /measure and the tray never set it (a body field is ignored), and the console refuses --old-days while a bridge is
   running ("measured only from this console with the bridge stopped"). Test: TestMeasureUndatedOnlyWhenReadDaysOff.
8. Finding 8 (LOW). tally.go: TC.yield, asked right after a background read took the Tally lock (it gives the lock back
   and returns errBackoff); startpoint.go: the light check passes lightCheckYield (a posting job, this bridge's lease on
   the company, or an import in flight: post.go importsInFlight counted around invokeImport). Test:
   TestLightCheckYieldsAfterLock (a background read told to give way after the lock: errBackoff, nothing sent; no job,
   lease or import: it goes).
9. Finding 9 (LOW). startpoint.go: recorderHolding uses a GUID or company name in a file name only when it has no
   "/", "\", ":" or ".." (plainFileName), and Lstat (a regular file only). Test: TestRecorderHoldingNoTraversal.
10. Finding 10 (LOW). recorder.go: a company that does not answer is listed ("missed", and a log line) and the others
    are noted; the item fails only when none answered. No new test (the stand-in Tally serves one company);
    TestChangeNumbersNoted and TestChangeNumbersNotWrittenInRecorderFolder cover the answering path.
11. Finding 11 (LOW). recorder.go: recorderFiles returns at most 50 files, so the folder watch keeps at most 50 entries;
    the watch uses Lstat only (never opens a file). Covered by TestRecorderSendSkipsLinksAndBoundsSize and
    TestNoWriteToRecorderFiles.
12. Finding 12 (LOW, allow-list): LEFT OPEN, as documented: keepListAboveRequest still uses the id TDSDeskKeepList;
    giving it its own measure-only id changes the allow-list table and its hash (TestAllowListUnchanged,
    docs/tally-allowlist.md), which belongs with the next measured build. Today only the read test and measure item a2
    build it, and with ReadDays off it carries no period.
13. Finding 13 (INFORMATIONAL): fixed. The tray asks "Test reading from Tally on the company <name>?" (yes/no) before
    it runs: POST /tray/readtest {preview:true} names the company and sends nothing. Test:
    TestReadTestPreviewNamesCompany.
14. Finding 14 (INFORMATIONAL): the range below covers these fixes.
Added on the owner's question of 04-Oct-2026 ("can the add-on hang or slow Tally"):
A. The bridge never opens a holding file for writing nor locks it in normal running: every read goes through
   readShared (FILE_SHARE_READ|WRITE|DELETE on Windows via CreateFile, tail only, closed at once); a file another
   program holds is not waited for (an error at once, "recorder file busy, read later" in the log); the watch is stat
   only. Tests: TestNoWriteToRecorderFiles (parses the bridge's own code: no os.OpenFile/Create/WriteFile/Rename/
   Remove/Open/ReadFile, appendText, saveFile, readText or fileTail in any function that names the recorder folder);
   Windows only: TestSharedReadWindowsWriterGetsIn (an append handle with FILE_SHARE_READ opens while readShared holds
   the file; a rename meanwhile works), TestSharedReadWindowsLockedFails (share mode 0 elsewhere: an error within
   100 ms and the log line).
B. Tray "Recorder trial: lock the holding file for 30 s" (trial.go, /tray/recorder-lock, person-only): ZZ TEST's
   <held GUID>.txt only (a regular file), share mode 0 for 30 s on a timer, released when the bridge stops; start and
   end logged. Tests: TestRecorderLockHoldingFile (an flock stands in off Windows: held, then released after a short
   time; another company, no GUID held, a link, a web page: refused); TestSharedLockWindowsHoldsAndReleases.
C. Tray "Recorder trial: time saving (ZZ TEST)" (trial.go, /tray/recorder-bench, person-only, yes/no naming ZZ TEST):
   only when ZZ TEST is the open company; the ledger list (FinComLedgers) shows whether "ZZ Bench Dr" / "ZZ Bench Cr"
   exist, missing ones made with one masters import; then 50 journals of 2 lines and 50 of 50 lines, one per Import
   request through invokeTally (TC.bench: not noted as a posting, so no read-back and nothing for the cloud),
   narration "FinCom bench <n>", no FinCom tag, dated today; median, 90th percentile and total ms per kind in the log
   and the box. Allowed with ReadDays off (no entry is read). Test: TestRecorderBenchZZTest (100 voucher imports of the
   right shapes, one masters import, the summary, nothing made twice, not noted as a posting, another company and a
   web page refused). No allow-list change (the Import id).
D. docs/recorder-trial-sheet.txt PART 3C and docs/bridge-2.1.9-test-sheet.txt (step 2's yes/no, step 5's file and
   pack, 5b, the install folders, the measuring tool).

## Re-review of the fixes (457dc64..cec0b8a)
Re-reviewed: 04-Oct-2026, `git diff 457dc64 cec0b8a -- bridge-go .github/workflows/bridge-windows.yml` read hunk by hunk.
`go vet ./...` and `GOOS=windows go vet ./...` clean; `GOOS=windows go test -c` builds; `go test -count=1 ./...` green
(175 s); the round 19 tests green under `-race`. The Windows-only tests could not be run here (Linux); they run in the
new CI job. One suspected fault was confirmed with a throwaway test in a scratchpad copy of bridge-go/ (nothing in the
repo).

### High
none.

### Medium
1. The recorder folder's PARENT is never checked when the bridge reads (bypass of finding 4 / S3, and of finding 3 /
   S2 where the install step did not run). recorder.go recorderFiles Lstat-checks only `...\FinCom\recorder` itself;
   readShared's O_NOFOLLOW / FILE_FLAG_OPEN_REPARSE_POINT apply to the last element only. C:\ProgramData\FinCom is made
   safe only by `FinComBridge.exe install`, and two normal paths leave it as any user made it: (a) the bridge's own
   update (win_platform.go applyUpdate swaps the exe; nothing calls installFinComFolders), so every 2.1.8 PC updated to
   2.1.9 has no FinCom folder and any user may create it; (b) safeFolder cannot move aside a user-owned FinCom while
   that user holds a handle open inside it, so the step stops and the folder stays theirs. A user then makes FinCom a
   junction (to \RPC Control with an object-manager link named "recorder", no privilege needed; Lstat of recorder then
   sees a plain folder), and the LocalSystem service's "send results" reads the *.txt of any folder (another user's
   Documents) and sends them to FinCom support; "lock the holding file" holds a file there for 30 s; recorderHolding
   reports a time from there. Confirmed: TestScratchParentLinkRead (FinCom a link to another folder holding
   recorder\secret.txt: "recorder/secret.txt" in the pack). Minimal fix: one check used by recorderFiles,
   recorderLockHolding and recorderHolding: FinCom and recorder both plain folders by Lstat and isReparse, both owned
   by SYSTEM or Administrators when running as the service (ownerIsAdmin; as the user or Administrators per user), and
   on Windows the recorder folder opened with FILE_FLAG_BACKUP_SEMANTICS gives GetFinalPathNameByHandle equal to the
   expected path; else nothing is read and the log says why. And the service runs installFinComFolders(true, writeLog)
   once at its first start of a new version (update-pending.json), so an updated PC gets the safe folders too (the test
   sheet then need not say "run the setup"). Test: TestRecorderSendParentLinkRefused (FinCom a link: 0 files, the log
   line), and on Windows a junction at FinCom: nothing read.

### Low
2. startpoint.go (finding 5's fix): with the file unreadable, the first-seen numbers are NOT kept in memory, despite the
   "Fixed" text: noteStartPoint returns, so once the file can be read again the company is recorded at the numbers of
   that later answer (higher); the beat carries no startPoint at all meanwhile. Also util.go saveFile, when the rename
   is refused (an antivirus holding the file), removes start-point.json and renames again; if that second rename fails
   the file is gone and the next answer treats it as missing and writes this company alone (finding 5 again, narrower).
   Minimal fix: a spPending map (companyKey|guid -> the first-seen entry) written, never replaced, when the file is next
   readable; and in readStartPoints treat a leftover start-point.json.*.tmp as unreadable (or give start-point.json its
   own save that never removes the old file). Test: TestStartPointPendingKeepsFirstNumbers.
3. recorder.go (finding 2's fix): sync\recorder-changenumbers.txt is not in a folder "not writable by Users": the
   service's Home is the installing user's %LOCALAPPDATA%\TDS Desk Bridge (win_service.go:238), and appendText follows
   links. That user can still steer the service's append, as for every other file the service writes there (known
   since 2.1.6: that user controls the service's settings). The fix is right in effect (any member of Users is down to
   the installing user); only the text is wrong. Fix: say "the bridge's own folder (the installing user's)" in the
   Fixed text; optionally a no-follow append (Lstat regular, open, SameFile, one link) for this file.
4. trial.go: benchTC sets person:true though the bench sends only imports and the ledger list (no period); a dated
   request added later through benchTC would pass the ReadDays refusal. Fix: `&TC{bench: true}`. lockExclusive (Windows)
   opens by path after the Lstat with no SameFile / NumberOfLinks check, so a hard link swapped in between is held for
   30 s instead: check both on the handle as readShared does. Note for the sheet: the bench journals are ordinary
   entries of ZZ TEST (no FinCom tag); with ReadDays on, or when ZZ TEST is linked to a FinCom client, the keeper and
   the cloud see them like any desk entry; ZZ TEST must not be linked.
5. folders.go: `/inheritance:r` plus `/grant:r` for SYSTEM, Administrators and Users leave any other explicit ACE
   (Everyone, Authenticated Users, a named user) on a kept, administrator-owned FinCom, recorder or addon. Only an
   administrator could have added one, so Low. Fix: set the whole DACL (SetNamedSecurityInfo with a protected SDDL, or
   `icacls <d> /reset /L` before the grants).
6. CI: the all-users install step checks the recorder ACL's text only. Add the behaviour the trial needs, as fctest (a
   user who is not an administrator): create a file in recorder\ and append to it (succeeds), delete or rename
   recorder\ and make a subfolder in it (refused), write in addon\ and FinCom\ (refused).

### Checked and found right
- Finding 1: invokeTally is the only way to Tally (tallyRaw is called only by invokeTally and freeProbe; freeProbe sends
  FinComCompany, undated); all 32 callers traced. datedRefused sits after the allow-list and before anything is sent;
  every period comes from dateVars ("<SVFROMDATE" + attributes), so the prefix match catches every form; no builder
  sets a period another way (no $Date filter); the only undated voucher collection is keepListAboveRequest (AlterID,
  read test and measure a2). TC.person is set only by readTestTC (POST /tray/readtest: handle()'s /tray/ gate),
  measureDatedTC with o.oldDays (measureArgs, console only; /measure builds its opts without it; the console refuses
  --old-days while a bridge answers) and benchTC (Low 4). No cloud setting, beat answer or local route reaches it.
  GET /readtest answers 409 with ReadDays off. The posting path's dated builders (findPostedTags, findAccepted,
  voucherByMaster) still have no callers.
- Finding 3: on an install over the old NSIS layout the FinCom folder (made by the elevated setup: owned by
  Administrators) is kept and protected first; recorder's old explicit Users (OI)(CI)M is replaced by /grant:r
  Users:(RX,WD) (the :r drops every explicit Users ACE), then (OI)(IO)M added; re-running is idempotent; a user-made
  folder or link at any of the three is moved aside. Once FinCom is Users RX nothing can be swapped in it (renaming a
  child needs DELETE_CHILD on FinCom or a place to add it); a pre-planted junction inside FinCom when its ACL is set is
  the case TestRecorderFolderJunctionRefusedWindows runs on real Windows (target ACL unchanged). icacls takes the path
  first and /L /Q last; /inheritance:r with /grant:r in one call and /setowner with /L are valid. With RX,WD on the
  folder Tally can create a file (FILE_ADD_FILE) and the file inherits Users M (append, rename, failed.txt); no AD, no
  DELETE on the folder, no subfolders. FinCom\ and addon\: SYSTEM, Administrators F, Users RX, inheritance removed.
  writeFresh removes then creates with O_EXCL (CREATE_NEW), so no link is written through.
- Finding 4: readShared: Lstat regular and no reparse attribute (Go 1.24 reports junctions as ModeIrregular, and the
  attribute is checked too); CreateFile GENERIC_READ, share read|write|delete, OPEN_REPARSE_POINT; the handle's Stat
  must be regular and SameFile with the Lstat (Go loads the Lstat's file id by an attributes-only open, which no share
  mode blocks); NumberOfLinks 1; Seek to the tail and LimitReader. 50 files, 4 MB each, 32 MB in all; the summary uses
  the bytes read; Tally's files only under Program Files (underDir is lexical, but on a cleaned image path of an
  administrator-only folder). The parent folder is Medium 1.
- Findings 6, 8, 9, 10, 11, 13: right as described (per-GUID entries never overwritten, pick by held GUID; yield after
  the lock; plainFileName and Lstat; missed companies listed; at most 50 watched; the yes/no names the company).
- Finding 7: with ReadDays off measure runs a, a2 and the ledger items only; the snapshot is refused; --old-days only
  from the console with no bridge answering.
- Trial lock: ZZ TEST only (exact name), the held GUID only, a regular file; the lock ends on the 30 s timer or stopCh
  (the handle closed by defer on every path; a process exit closes it too); recLockBusy cleared on every path.
- Bench: ZZ TEST only (benchCheck: the name, the open company, postingAllowedFor; the envelope names ZZ TEST), GUID
  guarded, under the post gate; TC.bench skips afterPosting and afterPostingLedger, so nothing is read back or queued
  for the cloud; only the self-watch counts its times.
- CI: valid YAML (jobs changes, build, go-tests-windows, test); go-tests-windows runs on windows-2022 in bridge-go with
  `-run 'Windows|Shared'`, which selects the four Windows-only tests and TestReadSharedBounds. It does not gate the
  test job or a release; whether those tests pass on Windows is known only after the first run.
- No regression found: every test touched only turns ReadDays on (oldDaysOn) or follows the new file places and keys;
  no assertion weakened.

### Before building the installer
Must: Medium 1 (the parent folder checked before any read, and the folder step at the first start after an update).
May wait: Lows 2 to 6. Then a green run of the go-tests-windows job.

## Fixed after the re-review (04-Oct-2026; bridge-go/, the Windows workflow, the two sheets)
Test first: each test below was run red before the change (the outputs kept in the session's scratchpad, tdd/b219rr.*),
then green. `go vet ./...` and `GOOS=windows go vet ./...` clean; `GOOS=windows go test -c` builds;
`go test -count=1 ./...` green (176 s); release_check_test.sh green; the workflow's YAML parses. The Windows-only tests
run in the go-tests-windows job (their names hold Windows or Shared).
1. Medium 1 (fixed). recorder.go recorderDirChecked, used before anything in the recorder folder is listed, looked at,
   read or locked: recorderFiles (send results, the summary, the folder watch, whose loop no longer uses os.Stat),
   recorderHolding (startpoint.go, the beat) and recorderLockHolding (trial.go, the 30 s lock). C:\ProgramData\FinCom
   and recorder\ must each be a plain folder by os.Lstat and isReparse (FILE_ATTRIBUTE_REPARSE_POINT on Windows), each
   owned by SYSTEM or Administrators when running as the service (ownerIsAdmin; runningAsService), and the recorder
   folder's final path (Windows: opened with FILE_FLAG_BACKUP_SEMANTICS, GetFinalPathNameByHandle, the \\?\ prefix
   dropped, compared without case; elsewhere EvalSymlinks) must equal the final path of the folder holding FinCom
   followed by FinCom\recorder (so a short-name temp path does not refuse a good folder). Else nothing is done there and
   the log says "Recorder trial: the recorder folder <path> is not read: <why>" once per reason; a folder that is not
   there is silent. folders.go foldersAfterUpdate: the service (win_service.go Execute, before runBridge) runs
   installFinComFolders(true) once at its first start of each version; the version is kept in
   fincom-folders-version.txt beside the exe (Program Files, administrators only), written only when the step succeeded
   (else tried at the next start); the uninstaller deletes it. installFinComFolders now returns its error. Tests:
   TestRecorderReadRefusedWhenParentIsLink (FinCom a symlink to another folder holding recorder\co-guid-1.txt: no file
   listed or watched, recorderHolding false, the lock refused, the pack without the file, the log line; a plain FinCom
   read; recorder a link refused; as the service a FinCom, then a recorder, owned by a user refused; a final path
   elsewhere refused and logged), TestRecorderReadRefusedWhenParentIsJunctionWindows (mklink /J at FinCom: nothing
   read; the plain folder in a temp path read; a junction at recorder refused), TestFoldersFixedOnFirstStartAfterUpdate
   (a link at FinCom moved aside at the first start, the folders made, icacls run, the marker written; the next start
   does nothing; a 2.1.8 marker runs it again; a failed step leaves no marker; the service calls it).
2. Low 2 (fixed: the first-seen numbers are kept). startpoint.go: while start-point.json cannot be read, the first
   numbers seen for a company and GUID are kept in spPending for the run (later, higher numbers never replace them);
   the beat and startPointOf carry them meanwhile; once the file can be read again (repaired, or removed by the owner)
   they are written (an entry already in the file for that company and GUID wins) before the answer at hand is
   handled, and the log says "the numbers first seen at <time>". util.go saveFile: the temp file is put in place by one
   rename (os.Rename: MoveFileEx with MOVEFILE_REPLACE_EXISTING on Windows), tried 4 times; the old file is never
   removed first; if the rename still fails the old file stays as it was and the temp file goes. Tests:
   TestStartPointSaveNeverLosesFile (a refused rename: the old content kept, no .tmp left, the error returned; red
   before: the file was gone), TestStartPointPendingKeepsFirstNumbers (10 then 20 while unreadable, 30 once fixed or
   removed: recorded at 10; the beat shows 10 meanwhile; OTHER CO kept).
3. Low 3 (fixed). Correction of the "Fixed" text of finding 2 above: sync\recorder-changenumbers.txt is in the bridge's
   own folder, which is the installing user's (the service's Home is that user's %LOCALAPPDATA%\TDS Desk Bridge): it is
   not writable by every member of Users, but that one user can change it; the comment in recorder.go says so. The
   append is now appendNoFollow (shared.go): Lstat must be a regular file with no reparse point (or nothing), opened
   with O_NOFOLLOW (Windows: CreateFile FILE_APPEND_DATA, OPEN_ALWAYS, FILE_FLAG_OPEN_REPARSE_POINT), the handle's file
   SameFile with the Lstat and one name only. Test: TestChangeNumbersAppendNoFollow (a symlink and a hard link to
   another file refused, the target unchanged; a plain file appended twice; note change numbers uses it).
4. Low 4 (fixed). trial.go: benchTC is &TC{bench: true} (no person), so a dated request sent through it is refused with
   ReadDays off. lockExclusive (both platforms) Lstats the file, opens it, and checks on the handle (lockCheck): a
   regular file, SameFile with the Lstat, NumberOfLinks / Nlink exactly 1; else nothing is held. The test sheet (5b)
   and the trial sheet (PART 3C, before you start) say ZZ TEST must not be linked to any FinCom client while "time
   saving" runs, why, and to stop and tell FinCom when the Tally page shows it linked. Tests: TestBenchNotPerson (also
   checks both sheets), TestRecorderLockRefusesHardLink (Unix: a holding file that is a hard link to another file not
   locked, the other file not held), TestSharedLockWindowsRefusesHardLink (Windows).
   Note for the owner: PART 3B, test 3c and the test sheet's step 6 post from FinCom to "the ZZ TEST client", which
   needs the link; the sheets now say the link is put back only after test 1. Whether to unlink for the bench at all,
   or to run the bench on a company never linked, is the owner's call.
5. Low 5 (fixed). folders.go: each of FinCom\, recorder\ and addon\ gets `icacls <d> /reset /L /Q` first (every
   explicit entry dropped, the folder back to what it inherits), then the grants as before (/inheritance:r /grant:r
   ..., recorder's (OI)(IO)M, /setowner); a /reset that fails stops the step. Between FinCom's /reset and its grants
   (one icacls call apart) FinCom has ProgramData's inherited entries, under which Users may add files and folders; a
   folder a user adds there in that moment is owned by that user, so safeFolder moves it aside (all users) and the read
   check refuses it. Test: TestFolderACLResetFirst (the ten exact argument lists in order; a failed /reset stops the
   step). TestRecorderFolderJunctionRefusedWindows runs the real icacls on Windows.
6. Low 6 (fixed). .github/workflows/bridge-windows.yml, step "As fctest, the recorder folder (...)" after the all-users
   install: with recorder\ checked empty first, a script run as fctest (not an administrator) tries: delete recorder\
   (must be refused), create recorder\fctest-check.txt and append a line (must succeed; both lines checked), rename
   recorder\ and make recorder\sub (refused), write in addon\ and in FinCom\ (refused); the folder still in place; the
   test file removed. Test: TestWorkflowChecksRecorderAsUser (the step and its checks are there).


Decision after the re-review (04-Oct-2026): the sheets no longer ask for ZZ TEST to be unlinked for "time saving" (the
posting tests of the same sheets need the link). The bench journals are test entries in ZZ TEST ("FinCom bench <n>", no
FinCom tag); with reading prospective FinCom reads no old entries, so they reach the cloud only through a ZZ TEST Day
Book upload, and the ZZ TEST client may show "up to 100 changes not received", which the sheets name as expected.
TestBenchNotPerson checks this wording.

## Review of the last fixes (cec0b8a..9e390bf)
Reviewed: 04-Oct-2026, `git diff cec0b8a 9e390bf -- bridge-go .github/workflows/bridge-windows.yml
docs/bridge-2.1.9-test-sheet.txt docs/recorder-trial-sheet.txt`, read hunk by hunk. `go vet ./...` and
`GOOS=windows go vet ./...` clean; `GOOS=windows go test -c` builds; `go test -count=1 ./...` green (177 s); the
workflow's YAML parses. The Windows-only tests could not be run here (Linux).

### High
none.

### Medium
none. Medium 1 is closed for the service on a normal install:
- Every path into the recorder folder goes through recorderDirChecked: recorderFiles (send results, the summary, the
  watch loop, which no longer Stats the folder itself), recorderHolding (the beat) and recorderLockHolding (the 30 s
  lock). The remaining uses of recorderDirFn are message text only (the summary's "Folder:", two error texts). Nothing
  else lists or opens the folder (Glob and ReadDir traced).
- The update path reaches the step as the service: applyUpdate swaps the exe and the bridge exits (code 3); Windows or
  the restart helper starts the service; runService, Execute, foldersAfterUpdate, before runBridge (so before the watch
  loop and any tray route). The marker is beside the exe (Program Files, administrators only), written only when
  installFinComFolders returned nil; a failed step is retried at every start and the read check fails closed meanwhile
  (a user-owned FinCom or recorder is refused by owner). The 2-minute update health check is time-based, so a slow step
  cannot roll the update back; a step that panics is recovered (code 9) and would be retried.
- No false refusal found in a normal install: on a fresh all-users install the elevated install step and then the
  service's own step set both owners to Administrators (/setowner; SYSTEM also accepted); the final path is compared
  with GetFinalPathNameByHandle of the folder holding FinCom, so a short name (RUNNER~1), a different case ("Fincom")
  or a relocated ProgramData compare equal; a just-for-me install runs no service, so no owner check (Lstat, reparse
  and final path only) and no step at start. TestRecorderReadRefusedWhenParentIsJunctionWindows runs under t.TempDir()
  (a short-name path on the runners) and expects a plain folder to be read.
- TOCTOU between the check and the opens: the opens do NOT check the final path on the handle (readTail and
  lockExclusive use FILE_FLAG_OPEN_REPARSE_POINT on the last element only, and SameFile compares with an Lstat made
  through the same, possibly swapped, parent). The window is closed by the ACLs instead: once the step has run, FinCom
  is Users RX (no add, no DELETE_CHILD), recorder has no DELETE for Users, and ProgramData gives Users no DELETE_CHILD,
  so neither folder can be renamed or replaced by a non-administrator. Where that does not hold, see Low 1.

### Low
1. The read check trusts the owner, not the ACL, and per user checks no owner. As the service, recorderDirChecked
   accepts any administrator-owned FinCom and recorder; it does not know whether the step completed this version. If
   the step stops after FinCom's `/reset` and before its grants (two icacls calls apart; only if icacls fails), FinCom
   is left inheriting ProgramData (Users may add folders), and an old 2.1.8 recorder (Users (OI)(CI)M, DELETE on the
   folder) can be renamed and replaced by a junction between the check and Glob / readShared / the lock. On a
   just-for-me install on a shared PC another user may own FinCom and swap recorder the same way (the files read are the
   desk user's own, sent to FinCom support). Needs a failed step or a per-user install plus a race, hence Low. Minimal
   fix (either): (a) in readTail and lockExclusive, when the file is in the recorder folder, GetFinalPathNameByHandle on
   the opened file and refuse unless its folder equals the final path recorderDirChecked computed; or (b) as the
   service, recorderDirChecked also requires fincom-folders-version.txt to equal BridgeVersion (the step completed), and
   per user requires the owner to be the current user, SYSTEM or Administrators. (a) also covers (b)'s cases.
2. The Windows sides of this round are only partly run on Windows. go-tests-windows selects `-run 'Windows|Shared'`:
   TestChangeNumbersAppendNoFollow (openAppendNoFollow's CreateFile with FILE_APPEND_DATA through an os.File),
   TestRecorderReadRefusedWhenParentIsLink and TestFoldersFixedOnFirstStartAfterUpdate do not match, and no test runs
   ownerIsAdmin or the step as the real service. Minimal fix: add `|AppendNoFollow` to the -run pattern; in the
   all-users install step check that the service's log has "its first start: the recorder trial's folders" and no
   "Recorder trial: the recorder folder ... is not read" line (the watch loop runs the check, owner included, every
   second as SYSTEM, so this proves no false refusal on a fresh install), and that fincom-folders-version.txt holds
   $env:BRIDGE_VERSION.
3. startpoint.go spRecordPending: an answer without a GUID followed by one with GUID X, both while the file is
   unreadable, leaves two pending entries (co| and co|X) and both are written, the X entry with the later, higher
   numbers; the normal path would attach X to the single first entry (len(mine) == 1). startPointPick then follows the
   held GUID X, i.e. the later numbers. Narrow (FinComCompany answers without a GUID only). Minimal fix: keep pending per
   company with the same rule as noteStartPoint (a later GUID fills a blank pending entry's guid; no second entry).
   Also noted, as documented: the pending numbers last for the run only (a restart while the file is still unreadable
   loses them).
4. util.go saveFile: the old remove-then-rename also replaced a read-only target (Go's os.Remove clears the read-only
   attribute); MoveFileEx with MOVEFILE_REPLACE_EXISTING refuses one, so any saved file someone marked read-only now
   fails to save on every try (logged). Minimal fix: on ERROR_ACCESS_DENIED, clear FILE_ATTRIBUTE_READONLY on the target
   and rename once more (still never removing it first).

### Checked and found right
- Low 2 (start point): the first-seen numbers are kept and never replaced (spPending[k] == nil), written before the
  answer at hand once the file is readable (an existing entry for that company and GUID wins), the added keys taken back
  out of `all` when the save fails; the beat and startPointOf carry them meanwhile (spWithPending, under spMu); spFresh
  clears them with the sync folder. saveFile: one rename, tried 4 times (0.5 s at most), the old file never removed, the
  temp file removed on every failure.
- Low 3: appendNoFollow: Lstat regular and no reparse point (or missing), open with O_NOFOLLOW / OPEN_ALWAYS +
  FILE_FLAG_OPEN_REPARSE_POINT, the handle regular, SameFile when it existed, one name; a link or hard link created
  between the Lstat and the open is still refused (handle not regular, or two names). A handle with FILE_APPEND_DATA and
  no FILE_WRITE_DATA writes at the end whatever offset Go passes.
- Low 4: benchTC is &TC{bench: true}; TC.person now only from the read test and measure's --old-days (tally.go:284).
  lockExclusive (both platforms): Lstat, open (share 0 on Windows), lockCheck on the handle (regular, SameFile, exactly
  one name) before `started`; Go's file-id load for SameFile opens with no data access, so the share-0 handle does not
  block it (TestSharedLockWindowsRefusesHardLink also locks a plain file, so CI would show it).
- Low 5: `icacls <d> /reset /L /Q` is valid syntax and only the folder (no /T). Order FinCom, recorder, addon: while
  FinCom is between /reset and its grants Users may add to it but not delete (no DELETE_CHILD), and recorder and addon
  are protected, so nothing in them changes; a folder a user adds then is owned by that user and safeFolder moves it
  aside. recorder's /reset makes it inherit FinCom's already protected entries. The step runs before runBridge, so the
  bridge never reads during the window.
- Low 6: the new step is in the `test` job (both matrix images), after the all-users install (whose Wait-Bridge returns
  only after the service's own step, since runBridge follows it) and before the uninstall. The script is valid
  PowerShell: a single-quoted here-string ('@ at column 0 after YAML's dedent), Try-It updates the outer ordered
  dictionary by index, .NET exceptions are caught; fctest can read rec.ps1 and write rec.json (C:\fcsetup Users M). The
  expectations follow the ACL: create and append allowed (WD on the folder, files inherit (OI)(IO)M), delete and rename
  refused (no DELETE, no DELETE_CHILD on FinCom), subfolder refused (no AD), addon\ and FinCom\ RX only. The folder is
  checked empty first and the test file removed after.
- Sheets: both say ZZ TEST stays linked and name the "up to 100 changes not received" as expected (as the Decision
  above); TestBenchNotPerson checks it. (Item 4 of "Fixed after the re-review" still says "must not be linked"; the
  Decision supersedes it.)
- The uninstaller deletes the marker; installFinComFolders' new error return is ignored by its other callers as before.

### Before building the installer
Must: nothing. May wait: Lows 1 to 4 (Low 1 is the one to take next; Low 2's CI checks are cheap and would prove the
service's check on a real install). Then a green run of the go-tests-windows job and the test job.

Range: 416c335..9e390bf
