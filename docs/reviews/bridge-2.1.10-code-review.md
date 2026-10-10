# Code review: FinCom Bridge 2.1.10

Reviewed: 04-Oct-2026, by the reviewer in the Claude Code session. I read the diff 9e390bf..f780856 hunk by hunk
(bridge-go/, docs/recorder-trial-sheet.txt, docs/bridge-2.1.10-test-sheet.txt, docs/tally-allowlist.md,
tests/fixtures/beat-2.1.10.json). These paths are unchanged from f780856 to HEAD (dfa8169 touches only server/, tests/
and docs/).
Checks:
- `go vet ./...` and `GOOS=windows go vet ./...`: clean.
- `go test -count=1 ./...`: green (193 s; TestNoComputedFigure, TestAllowListUnchanged, TestEveryDatedRequestUsesDateVars
  and TestSizeBigCompany among them).
- The round 21 tests and the light-check tests of rounds 18 and 19 are also green under `-race`.
- `bash bridge-go/release_check_test.sh`: green ("all cases as expected").

I confirmed five suspected faults with throwaway tests in a scratchpad copy of bridge-go/ (zz_scratch_r21_test.go).
Nothing was added to the repo.

What 2.1.10 adds over 2.1.9 (round 21):
- The light FinComCompany check now runs while background reading is Paused. It is still stopped by a stop of reading
  (FinCom's or the bridge's own) and still yields to a posting that is going (postingGoing).
- The open-company list is asked again when it is 10 minutes old (lightCompanyList).
- One log line per check.
- The beat's companies[] lists every open company with guid, altvchid, altmstid and recorderSeen.
- The trial tools now work on any company (no "ZZ TEST" check). They are gated by FinCom's per-computer switch, which
  arrives as `trialTools` in the beat answer. The tray shows the five items only while the switch is on, and the five
  /tray/ routes answer 403 while it is off.
- The time saving asks a yes/no that names the company (benchConfirmText). Its narrations and ledgers are marked TRIAL.
- The add-on's gate is now `NOT $$IsEmpty:##SVCurrentCompany`.

Focus:
- Whether anything can turn trialTools on other than a boolean true in the beat answer.
- The five routes and the five menu items.
- The lock and the bench on an arbitrary company, including company names from Tally's list reaching file paths.
- The add-on's new gate and what the sheets say about it.
- Whether any heavy or dated read runs while Paused.
- postingGoing and its races with a posting starting.
- The cost of the list refresh, and whether it yields.
- Log volume.
- The beat's new fields.
- The allow-list.

## Findings (open; none fixed yet)

1. MEDIUM. The owner's switch stays on after the switch-off can no longer reach the bridge.
   - Where: bridge-go/cloud.go:682-683 with bridge-go/trial.go:295-304. applyTrialTools runs only on a 200 answer that
     carries JSON. Nothing turns the tools off in these cases:
     - a beat that fails (network, TLS, 5xx, 401 after the key was revoked);
     - the cloud link turned off (POST /cloudlink {off:true}; cloudOn() is then false, so beatOnce stops being called);
     - a link changed to another cloud that does not answer.
   - Effect: the tools stay on until the bridge restarts. While FinCom cannot reach the bridge, the owner's "off" never
     arrives. This contradicts "only boolean true turns it on": the state lives on without a current true.
   - Confirmed: TestScratchTrialToolsSticky. The tools were turned on by an answer, then the stand cloud was closed and
     beatOnce ran 3 times: trialTools=true. Then /cloudlink off: trialTools=true, cloudOn=false.
   - Minimal fix:
     - in beatOnce, on every answer that is not (200 with JSON), call `applyTrialTools(nil)`;
     - make applyTrialTools(nil) mean off (the switch is logged once, as it is today);
     - in setCloudLink, on "off" and before the hello of a new link, call `setTrialTools(false)`.
     The owner loses the items for at most one failed beat; they come back with the next true.
   - Test: TestTrialToolsOffWithoutAnswer.
     - Switched on, then the cloud closed and one beatOnce: off, and the log says "switched off".
     - On again, then /cloudlink {off:true}: off.
     - On again, then a 500 answer: off.

2. MEDIUM. The add-on is replaced in place, so a Tally that still loads the 2.1.9 add-on starts writing for every
   company.
   - Where: bridge-go/folders.go:123-133 (all embedded addon/*.tdl written with writeFresh). This runs on every install:
     win_service.go:414 and win_user.go:424. For a service it also runs on the first start after an auto-update
     (foldersAfterUpdate, folders.go:76-89). The path stays C:\ProgramData\FinCom\addon\FinComRecorderTrial.tdl.
   - Effect:
     - Any Tally that has that file in its Local TDL list (load on startup) gets the any-company version at its next
       start. It then writes a line for every save, alter, cancel, delete and import of whichever company is current.
     - Those lines include narration, voucher number, party and ledger names, and the Tally user name. They go into
       recorder\, which every member of Users can read (security review S3).
     - Nobody reads the new sheet first. The 2.1.10 test sheet says "2.1.9 is installed on NWS144. Install 2.1.10 over
       it", but has no step that checks whether the 2.1.9 add-on is still loaded.
   - The sheets themselves are right about the new behaviour:
     - recorder-trial-sheet "IMPORTANT: since bridge 2.1.10 the add-on does not check the company's name: while it is
       loaded it writes for WHICHEVER company is open";
     - test sheet "What is new", third bullet of the trial tools;
     - the header comment of the .tdl.
   - Minimal fix, both parts:
     - (a) Ship the any-company add-on under a new file name, e.g. addon\FinComRecorderTrialAny.tdl, and stop embedding
       the old name. An old load line then keeps the ZZ TEST-only file it already has, because nothing rewrites it.
       Update both sheets and TestInstallerRecorderAndAddonFolders to the new path.
     - (b) Add a test-sheet step 0: "Before installing: TallyPrime > F1 > TDLs & Add-Ons > F4 Manage Local TDLs: if
       FinComRecorderTrial.tdl is listed, unload it (trial sheet PART 4)."
   - Test: TestAddonUpgradeLeavesOldFileAlone.
     - The install step runs on a folder that already holds FinComRecorderTrial.tdl with the 2.1.9 content: that file
       is byte-for-byte unchanged, and the new file is written.
     - Both sheets name the new path and the unload check.

3. MEDIUM (privacy; security review S3). "Send results" now ships real books without naming them.
   - Where: bridge-go/recorder.go:254-325 and win_tray.go:668-683. Every *.txt in recorder\ is zipped (up to 50 files,
     32 MB) and sent to FinCom support. There is no yes/no, and nothing names whose books are in the files.
   - Effect: with ZZ TEST these were test lines. Since 2.1.10 they hold any company's narrations, voucher numbers,
     party and ledger names and Tally user names. That includes companies not linked to FinCom, if the add-on was
     loaded while they were open, and files planted by any Windows user.
   - Minimal fix:
     - POST /tray/recorder-send {preview:true} returns, per file, the company named in its lines (the last `cname=` of
       the tail already read) and the line count. It sends nothing.
     - The tray asks "Send the recorder lines of <A> (n lines), <B> (m lines) to FinCom support?" before the real call.
     - Both sheets say what a line holds, and that every Windows user of the computer can read the folder.
   - Test: TestRecorderSendPreviewNamesCompanies. Two holding files for two companies: the preview lists both names
     and the counts, and the stand cloud receives nothing until the second call.

4. MEDIUM (availability). A data race on the company-info map can end the bridge, and round 21 adds a caller.
   - Where: bridge-go/ports.go:305-331. getCoInfo reads and writes the package map `coInfo` with no lock. It is reached
     from openCompaniesWith, which is called from:
     - /status (server.go:234, :247);
     - Test connection (server.go:774);
     - the keeper (keep.go:1224);
     - note change numbers (recorder.go:342);
     - since 2.1.10, the light check's list refresh on its own goroutine (startpoint.go:410), now also while Paused.
   - Effect: a concurrent map read and write is a fatal runtime error. The recover in startLightCheck cannot catch it,
     so the bridge exits, possibly mid-posting. The write happens on the first sight of a company, and every 6 h for a
     company with neither GSTIN nor PAN (ports.go:314). The read happens on every call.
   - Confirmed: TestScratchCoInfoConcurrent, eight goroutines calling getCoInfo under `-race`. Two DATA RACE reports:
     the `coInfo == nil` check (:306/:307) and the map assignment (:329) against json encoding in saveFile.
   - The race is older than 2.1.10. Round 21 makes it more likely.
   - Minimal fix:
     - add a `coInfoMu sync.Mutex`;
     - take it for the load, the lookup, and the assignment plus saveFile;
     - never hold it during invokeTally (look up, unlock, ask, lock, store).
   - Test: TestCoInfoConcurrent, under -race in CI. Eight goroutines with different names, and a /status running at
     the same time.

5. LOW. The time saving does not count as "a posting going", so the light check goes between its imports.
   - Where: bridge-go/jobs.go:712-738 and startpoint.go:343-345. The bench sends imports through invokeTally(benchTC)
     directly. It is not a job, not postTaking and not importsInFlight.
   - Effect: the light check, and the 10-minute list refresh, run in the middle of the trial that measures save times.
   - Confirmed: TestScratchLightCheckDuringBench (imports answering in 30 ms):
     - during the run, postingGoing=false, yield=false and lightCheckBlocked="";
     - one FinComCompany went among the bench's 93 requests.
   - Minimal fix: a `benchRunning atomic.Bool`, set and cleared in startBench's goroutine, and counted in postingGoing.
   - Test: TestLightCheckYieldsToBench. A slow-import bench is started: lightCheckBlocked() names a posting, and no
     FinComCompany goes between its imports.

6. LOW. Log volume.
   - Where: startpoint.go:354-372 (lightSkip) and :479. The once-per-10-minutes de-duplication is keyed on
     company|why, and `why` includes the error's own words. The probe hold's text carries "(next at hh:mm:ss)"
     (tally.go:961), and a timeout carries its seconds, so the key changes every minute.
   - Confirmed: TestScratchLightSkipFlood. Probe hold on, 20 beats over 10 minutes: 10 "skipped: Tally did not answer"
     lines for one company. 2.1.9 logged every 30 s, so this is better, but not what the comment says.
   - Further effects:
     - lcSkipped gains one key per distinct text and is never trimmed;
     - during a long FinCom stop, each open company gets a skip line every 10 minutes (:421-438);
     - each checked company gets an "unchanged" line every 10 minutes (:530). That is 144 lines a day per company. With
       30 companies loaded, the 500-line tail in a support pack covers under 2 hours. The log rotates at 5 MB.
   - Minimal fix:
     - key the de-duplication on a reason class (isBusyErr gives "Tally is busy or did not answer"; otherwise the text
       with digits removed), keeping the full words in the line;
     - drop lcSkipped entries older than 1 hour;
     - say a stop of reading once per stop (company ""), not per company;
     - write "unchanged" only when the numbers moved since the last line, or once an hour. Adjust test sheet step 2,
       which promises "every 10 minutes or so".
   - Test: TestLightSkipOncePerClass. Probe hold over 10 minutes gives 1 line. A 1-hour FinCom stop with 3 companies
     gives 1 line.
   - Also: the "gave way" wording (:476) says "to a posting", but errBackoff and errPreempted also come from any FinCom
     read (bgBackoff). Better words: "it gave way to FinCom".

7. LOW. The list refresh marks itself fresh even when it learned nothing.
   - Where: startpoint.go:396-413. After openCompaniesWith, Chtimes is applied whatever happened. When the list request
     gave way (errPreempted or errBackoff, so the previous list stands, ports.go:394-396) or failed, the next try is 10
     minutes later.
   - Also: openCompaniesWith sends TDSDeskCompanyInfo for each company not yet in company-info.json (ports.go:409).
     That request is light, undated and on the allow-list, but the comment and the test sheet ("the small company-list
     request") name only the company list.
   - Minimal fix:
     - Chtimes only when every port that was not skipped answered afresh;
     - name TDSDeskCompanyInfo in the comment and in the sheet.
   - Test: TestCompanyListRefreshRetriedAfterGivingWay. The yield is true for the first try: the next beat asks again.

8. LOW. The owner's guard (b) is enforced by the tray, not by the bridge.
   - Where: server.go:633-641. POST /tray/recorder-bench without `preview` starts the 100 entries at once.
     TestRecorderBenchAnyCompany does exactly this.
   - Who can do it: a program on the computer that holds the bridge key. That program can already post through /import,
     so it gains no new power. But the "confirm naming the company" is only as strong as the tray.
   - Minimal fix:
     - the preview returns a random one-time token, bound to the company and valid for 2 minutes;
     - the start requires the token;
     - the tray passes it on.
   - Test: TestBenchNeedsPreviewToken. A start with no token, a wrong token, or another company's token is refused, and
     nothing reaches the stand.

9. LOW. Which company is "the company open in Tally" when several are loaded.
   - Where: measure.go:645-654. trayMeasureCompany returns the first company of the first Tally that answered. With
     two companies loaded, the bench and the lock act on whichever is listed first. The yes/no names it, so nothing
     happens silently, but the sheets' "only the company you test on is open" is not checked.
   - Also: /tray/recorder-lock takes any company named in the body, open or not (trial.go:43-62). The tray sends {}.
   - Minimal fix:
     - benchCheck and recorderLockHolding refuse when more than one company is open ("Close every company except the
       one you test on");
     - the lock takes only the open company.
   - Test: TestTrialToolsOneCompanyOpen.

10. INFORMATIONAL. The release check with this range.
    - The release-check step 5 at HEAD (dfa8169) fails with "Range: 9e390bf..f780856": server/ and tests/ changed after
      f780856.
    - Build from a tree where only docs/ changed since the range's end, or extend the range. After the fixes above, a
      new range is needed anyway.

11. INFORMATIONAL. What the bench writes into a real company.
    - It posts 100 journals dated today: Rs 2,500 in all (50 x Rs 1 plus 50 x Rs 49).
    - Dr "TRIAL Bench Dr" (Indirect Expenses), Cr "TRIAL Bench Cr" (Sundry Creditors).
    - That is a P&L expense and a creditor balance in real books until cancelled.
    - The yes/no names the company and the count but not the amount or the groups. Adding "Rs 2,500 to Indirect
      Expenses / Sundry Creditors" costs one string.
    - It stops at the first failure and does not re-check the switch while it runs. This is acceptable for a trial.

## Found safe

- Only one path turns trialTools on: a boolean true in the beat answer.
  - setTrialTools has no caller outside tests.
  - applyTrialTools is called only at cloud.go:683 and accepts only `== true` ("yes", 1, "true" stay off;
    TestTrialToolsFromBeatAnswer).
  - No config key, no route, no file. The state is in memory only, so it is off after a restart until FinCom answers.
- The five routes and items.
  - All five check trialToolsErr after the web-page refusal: /tray/readtest (POST and GET), /tray/recorder-lock,
    /tray/recorder-bench (POST, preview, GET), /tray/recorder-send, /tray/recorder-note (server.go:593-671).
  - The global /tray/ gate (server.go:126) still comes first.
  - The menu builds the five items only from trayTrialItems(st), and only when st["trialTools"] == true.
  - No console command reaches these functions; main.go has only "measure".
  - TestTrialToolsSwitch: all seven calls get 403 with the words, and Tally is asked nothing.
- The lock on any company.
  - It goes through recorderDirChecked (FinCom\ and recorder\: no link, no reparse point, owner, final path).
  - The file name is heldGUID(company), which must pass plainFileName, followed by Lstat (regular, no reparse) and
    lockExclusive's handle checks.
  - A company name never reaches the lock's path.
  - recorderHolding (beat, recorderSeen) uses "name-"+company only when plainFileName passes: no "/", "\", ":" or "..".
    With the "name-" prefix, Windows device names cannot match.
  - The bench uses the name only inside esc()'d XML (importEnvelope), checks the GUID with guardCompanyGUID, and obeys
    PostOnly (postingAllowedFor).
- Nothing heavy or dated runs while Paused.
  - The paused path sends only TDSDeskCompanies, TDSDeskCompanyInfo (first sight) and FinComCompany, all undated.
    TestLightCheckRunsWhilePaused asserts exactly this set.
  - invokeTally's datedRefused still refuses any period with ReadDays off.
  - The keeper and the events path still honour paused() (keep.go:1169, events.go:86, :217, :284). Nothing reacts to
    the list file being rewritten.
- postingGoing covers a posting in every phase:
  - a job whose worker is alive and whose progress is queued or running, or not yet written: startJob sets jobsRunning
    before writeProgress;
  - postTaking, set before cloudPostTake's goroutine;
  - importsInFlight.
- Races with a posting starting are covered three times over:
  1. lightCheckBlocked before each company;
  2. the TC.yield after the copier gets the Tally lock (tally.go:704-707);
  3. preemption by the posting's own fin request once sent.
  A "waiting" job no longer blocks the check. If Tally then times out, the probe hold applies to both equally, and a
  light check that answers clears it for the posting.
- One light check at a time (lightBusy CAS). Marks are taken under spMu and undone on failure, keeping the 2.1.9
  semantics. A FinCom stop and the self-stop still stop it (readStop, the same as readStopped). Tests green under
  -race.
- The beat's companies[] adds only guid, altvchid, altmstid and recorderSeen for open companies that are not kept.
  - The names were already in open[].
  - GSTIN and PAN are not sent.
  - startPoint and changeNumbers already carried the same numbers since 2.1.9.
  - The fixture matches beatCompanies' shape (TestBeatCompaniesFixture).
- The allow-list is unchanged: TestAllowListUnchanged and TestNoComputedFigure are green. docs/tally-allowlist.md
  changes only its decision line, which now names 2.1.10. No request builder changed. The bench's narration and ledger
  names are in Import bodies, which are not fingerprinted.
- The TDL change is the one line, valid TDL. Every other rule stays (silent, Form Accept unconditional, `RETURN : Yes`;
  TestAddonAnyCompany). Both sheets and the .tdl header say it writes for whichever company is current. Finding 2
  covers the upgrade.
- Changed tests follow the decision; none is weakened:
  - ZZ TEST became "the company open";
  - the trial routes need trialOn;
  - TestOpenCompanyLightCheckOnce expects the list refresh first;
  - TestBenchNotPerson checks the new sheet wording.

## Fix before build (must)

1. Finding 1: the switch turns off when no answer comes and when the cloud link changes.
   TestTrialToolsOffWithoutAnswer.
2. Finding 2: the any-company add-on ships under a new file name, and the test sheet gets a step to unload a 2.1.9
   add-on before installing. TestAddonUpgradeLeavesOldFileAlone.
3. Finding 3: "send results" asks first, naming the companies in the files, and the sheets say what a line holds.
   TestRecorderSendPreviewNamesCompanies.
4. Finding 4: a lock on coInfo. TestCoInfoConcurrent (-race).

## Later (may)

- Findings 5 to 9. Take 5 and 6 first; both are cheap, and 5 affects the numbers the trial is run to get.
- Findings 10 and 11: the range for the build, and the amount in the bench's yes/no.

## Fixed (04-Oct-2026, test first; not committed)

Each fix has a test that failed before it and passes after (bridge-go/round22_test.go). Checks after the fixes: go vet
(Linux, Windows) clean; go test -count=1 ./... green; go test -race -run 'Light|CoInfo|Round21|Trial' ./... green;
bash bridge-go/release_check_test.sh green.

1. Finding 1 (trialTools sticky). trial.go: trialToolsOff(why) turns the tools off and logs "Trial tools switched off
   (<why>)" once; applyTrialTools(nil) is off. cloud.go: beatOnce calls it on every answer that is not a 200 with JSON
   (network error, 5xx, 401 after the key was revoked); beatLoop calls it while cloudOn() is false; setCloudLink calls
   it on "off" and before any new link is tried. Only a 200 answer with the boolean true turns them on.
   Test: TestTrialToolsOffWithoutAnswer (closed cloud, 500, 401, 200 without JSON, /cloudlink off, a link change).
2. Finding 2 (add-on widened in place). The any-company add-on ships as addon\FinComRecorderAnyCompany.tdl
   (addon/*.tdl holds only it). The 2.1.9 text is kept apart (addon/legacy/FinComRecorderTrial-2.1.9.tdl, embedded as
   legacyAddon219). The folder step (folders.go keepLegacyAddon) never writes the any-company gate under the old name:
   a FinComRecorderTrial.tdl that holds the 2.1.9 text is left byte for byte (time too); anything else there (a
   pre-release 2.1.10 copy, a link) is replaced by the 2.1.9 ZZ TEST-only text, written without following a link; where
   none exists, none is made. Chosen over "stop writing it" because a computer that took a pre-release 2.1.10 would
   otherwise keep a widened file under the old name; restoring the 2.1.9 text narrows it, and leaving an existing 2.1.9
   file untouched keeps the upgrade a no-op for it. Both sheets: step "before installing 2.1.10, unload any
   FinComRecorderTrial.tdl (PART 4) - then load the new file by its new path", and the new path in PART 1, PART 4 and
   the test sheet's step 4. Tests: TestAddonUpgradeLeavesOldFileAlone; TestAddonAnyCompany and
   TestRecorderFolderLinkRefused moved to the new name (a link at either name is not followed).
3. Finding 3 ("send results" unnamed). POST /tray/recorder-send {preview:true} (recorderSendPreview) reads the same
   bounded files the send would and returns the companies named in their lines (cname=) with their line counts, and a
   yes/no text that names them and says what a line holds (narration, number and date, party and ledger names, master
   names and groups, Tally user name) and what else goes; it sends nothing. The send goes only with {confirm:true};
   without it the bridge refuses ("asks first"). The tray (item 20) shows the preview's text in a yes/no and sends on
   Yes. Both sheets say what is recorded, that the recorder folder is readable by every Windows user on this PC, and
   that the yes/no names the companies. Test: TestRecorderSendPreviewNamesCompanies; the older send tests now pass
   the confirm.
4. Finding 4 (coInfo race). ports.go: coInfoMu guards the load, the lookup, and the store plus saveFile; it is let go
   before the TDSDeskCompanyInfo request and taken again to store. Tests reset it with resetCoInfo. Test:
   TestCoInfoConcurrent (-race: eight readers, company-list refreshes and /status at once; a slow company-info answer
   for one company does not hold back a known one).
5. Finding 5 (bench not a posting). trial.go benchRunning (set before startBench's goroutine, cleared when it ends)
   is counted in postingGoing. Test: TestLightCheckYieldsToBench.
6. Finding 6 (log volume), in part. lightSkip keys on the reason's class (its words without digits; the line keeps
   the full words) and drops keys older than an hour; "unchanged" is written at most once an hour per company
   (lcUnchanged); test sheet step 2 says so. Not done: a stop of reading said once per stop (still once per company
   every 10 minutes), and the "gave way" wording. Test: TestLightSkipOncePerClass.
7. Finding 7 (list marked fresh). openCompaniesAsk also says whether every open Tally gave its list afresh;
   lightCompanyList marks the file fresh only then, else puts its old time back, so it is asked at the next turn. The
   comment and the test sheet name TDSDeskCompanyInfo (company-info request) too. Test:
   TestLightCompanyListRetriedAfterGivingWay.
8. Finding 8 (bench yes/no in the tray only). The start requires {confirm:true} (sent by the tray after its yes/no);
   without it nothing starts and Tally is asked nothing. A flag, not a one-time token. Test: TestTrialBenchNeedsConfirm;
   the older bench tests pass the confirm.
9. Finding 9 (one company open): not changed; the test sheet says the bridge does not check that only one company is
   open. Findings 10 and 11: not changed (a new range is needed for the build).

## Review of the fixes (f780856..d42c3dc)

Reviewed 04-Oct-2026: `git diff f780856 d42c3dc -- bridge-go docs/recorder-trial-sheet.txt
docs/bridge-2.1.10-test-sheet.txt`, hunk by hunk, plus every remaining reference to the old add-on name in the repo.
Checks at d42c3dc: `go vet ./...` and `GOOS=windows go vet ./...` clean; `go test -count=1 ./...` green (210 s);
`go test -race -run 'Light|CoInfo|Round21|Round22|Trial' ./...` green, no DATA RACE; `bash release_check_test.sh`
green ("all cases as expected"). Two suspected faults were confirmed with throwaway tests in a scratchpad copy
(zz_scratch_r22_test.go); nothing was added to the repo.

Each fix against its finding:
- Finding 1 (trialTools sticky): closed, with the one narrow window in R2 below. beatOnce turns the tools off on
  every answer that is not 200 with JSON, beatLoop turns them off while cloudOn() is false, and setCloudLink turns them
  off first on "off" and on any link attempt, including a refused one (fail-safe). applyTrialTools still accepts only
  `== true`. /tray/status (mode.go:180) and the beat (cloud.go:890) read trialToolsOn live. The tray's menu is built from
  a polled /tray/status, so it can show the items for one poll after "off", but each of the five routes checks
  trialToolsErr itself; the bench and send-results check it again on the start or confirm call after the yes/no.
- Finding 2 (add-on widened in place): closed. addon/*.tdl now holds only FinComRecorderAnyCompany.tdl, so no path in
  the binary writes the any-company gate under the old name.
  - The embedded legacy text is byte-identical to the 2.1.9 file as built: the sha256 at 9e390bf and at 2aa42bd, the
    "2.1.9 built" commit, equals addon/legacy/FinComRecorderTrial-2.1.9.tdl. It is LF-only, as both builds were.
  - keepLegacyAddon: no file means nothing is made. A regular file with the 2.1.9 bytes is not opened for writing
    (time kept). Anything else is replaced with writeFresh (Remove of the name, then O_EXCL create): a symlink or
    hardlink name is removed, never followed, and the new file is created in the admin-only addon\ folder.
  - Can Tally hold a loaded .tdl? As far as is known, TallyPrime reads a TDL when it loads it and does not hold it open:
    TDL authors edit loaded files in place. If a Tally did hold it without delete sharing, Remove fails and the step
    logs "could not be put back" and returns. prepareFinComFolders returns nil whatever the add-on writes did, so the
    install never fails on it. The residue is in R4.
- Finding 3 (send results unnamed): closed. Without `preview` and without a JSON `confirm: true`, /tray/recorder-send
  refuses, still after the web-page refusal and trialToolsErr. The preview and the send share recorderReadAll:
  recorderFiles (recorderDirChecked), then readShared with the same per-file and total bounds and the same order.
  The tray sends only on Yes. The residue is in R3.
- Finding 4 (coInfo race): closed. Every read and write of the package's `coInfo` is in getCoInfo or resetCoInfo, under
  coInfoMu, and the lock is released before invokeTally. No other lock is taken while it is held: saveFile is a plain
  file write, and getCoInfo is called outside coMu. So there is no lock-order cycle with coMu, spMu, lcMu or the Tally
  lock. Entries are never mutated after they are stored, so callers read the returned map safely. TestCoInfoConcurrent
  is green under -race.
- Lows 5, 6, 7 and 8, as fixed:
  - 5: benchRunning is set before the goroutine and cleared by a defer, and postingGoing counts it.
  - 6: skipClass, the hourly trim and lcUnchanged (which has one key per company, so it stays bounded).
  - 7: the list is marked fresh only on allFresh, otherwise its old time is put back.
  - 8: the bench needs `confirm: true`.
  - No regression found in these. One consequence of 6: "unchanged" is now hourly, so the log evidence for test-sheet
    step 2 can come up to an hour late. The sheet says so, and the step's real check is FinCom's "changes not received".

Findings:

- R1. MEDIUM (regression, CI). The Windows workflow still expects the old add-on file.
  - Where: .github/workflows/bridge-windows.yml:349 checks
    `Test-Path "$env:ProgramData\FinCom\addon\FinComRecorderTrial.tdl"` after the all-users install.
  - On GitHub's fresh runner no such file exists. keepLegacyAddon, by design, makes none, so `Check` calls `Fail` and
    the real-Windows install job goes red on the next push to tax-accuracy. That hides every later step: the ACL checks,
    the fctest user steps and the uninstall.
  - Minimal fix, two lines in that file:
    - check FinComRecorderAnyCompany.tdl there;
    - add `Check (-not (Test-Path "$env:ProgramData\FinCom\addon\FinComRecorderTrial.tdl")) 'no 2.1.9 add-on is made'`.
  - No Go change.

- R2. LOW. A beat already in flight when the link is turned off or changed can switch the tools back on.
  - Where: cloud.go. setCloudLink runs on an HTTP goroutine and calls trialToolsOff first. A beatOnce that sent its
    request to the old cloud before that moment applies the old cloud's `trialTools: true` when the answer arrives
    (up to 10 s later).
  - Effect:
    - After an unlink, the tools stay on until the next beatLoop turn sees cloudOn() false (at most CloudBeatSec, 30 s).
    - After a link change, they stay on by the old cloud's word until the first beat to the new cloud.
    - A beatOnce that panics before invokeCloud (the recover in beatLoop) also leaves the last state as it was.
  - Confirmed: TestScratchBeatInFlightUnlink. The beat answered after 400 ms, and /cloudlink {off:true} was sent at
    100 ms: cloudOn=false, trialTools=true, and the log shows "switched on" after "disconnected".
  - Bounded to one beat interval, and a person must still click a tray item in that window, so this is LOW.
  - Minimal fix:
    - a `cloudGen atomic.Int64`, incremented in setCloudLink before trialToolsOff;
    - beatOnce reads it before invokeCloud and applies the answer only if it is unchanged and cloudOn() is still true;
    - beatLoop's recover also calls trialToolsOff.
  - Test: the scratch case above, asserting off.

- R3. LOW (privacy). The yes/no of "send results" can name less than what is then sent.
  - Where: recorder.go recorderSendPreview and recorderSendResults.
    - The preview counts only FCR1 lines (parseRecorderText). The zip carries each file's raw bytes, so non-FCR1
      lines are sent unnamed and uncounted. These include a partial first line from a bounded tail, a damaged line and
      text planted by a Windows user.
    - The confirm call reads the files again. A company that writes recorder lines while the yes/no is open (the
      add-on is still loaded and another company is opened, or a new file appears) is sent without being named.
  - Minimal fix:
    - the preview also counts "n other lines (not recorder lines)";
    - the preview returns its list of names, and the tray passes it back with the confirm;
    - recorderSendResults recomputes the names from its own read and refuses ("the recorder files changed since the
      question; choose Send results again") when its set differs from the list or has new other lines.
  - Test: add a file naming a third company between the preview and the confirm: refused, and nothing reaches the stand.

- R4. LOW. A failed restore of the old file after an auto-update is not tried again.
  - Where: folders.go keepLegacyAddon with foldersAfterUpdate.
  - The restore only matters on a computer that ran a pre-release 2.1.10, which wrote the any-company text under the
    old name. On such a computer, if the restore fails (the file held or denied), the step only logs it.
    installFinComFolders still returns nil, so the service writes the version marker. The widened file stays under the
    old name until a manual reinstall.
  - Minimal fix: keepLegacyAddon returns whether it failed. prepareFinComFolders passes that to foldersAfterUpdate as a
    "do not write the marker" flag (the install itself still does not fail), so the next start tries again.

- R5. LOW (round 21's list refresh, made more frequent by fix 7). A company-info request that gives way is
  remembered as "no GSTIN, no PAN" for 6 hours.
  - Where: ports.go getCoInfo. On any invokeTally error, including errPreempted or errBackoff from the light check's
    yielding TC and a busy timeout, it stores {gstin:"", pan:"", at:now} and saves it to company-info.json. The 6-hour
    rule then serves that entry.
  - Effect: a company first seen by the background list refresh while a posting goes shows no GSTIN or PAN in /status
    and the company list for up to 6 h. Fix 7 now retries the list on every beat until it is given afresh, which gives
    more chances for this to happen.
  - Confirmed: TestScratchCoInfoPoisonedOnGiveWay. A getCoInfo through a TC whose yield is true stored an empty entry
    with a current time. After the map was reset it was read back from the file, and Tally was not asked again.
  - Minimal fix: on err, return the empty entry without storing it (keep the lock-free ask).
  - Test: a yielding ask, then a plain ask: the second one asks Tally.

Verdict:
- No High.
- R1 must be fixed before building: it is a CI file, not the binary. The installer itself is fine, but the
  real-Windows install test, which gates confidence in the setup, will fail.
- R2 to R5 may wait, but R2 and R5 are a few lines each and worth taking with R1.
- The release-check range for the build is the one below. A change to .github/ alone does not move it, but any Go
  change does.


R1 / S8 applied in 32ef196 exactly as proposed above (.github/workflows/bridge-windows.yml only: the install check names
FinComRecorderAnyCompany.tdl and that no FinComRecorderTrial.tdl is made on a fresh install); no bridge code changed after d42c3dc.
R2-R5 (Low) are left for 2.2.0.

Range: 9e390bf..32ef196
