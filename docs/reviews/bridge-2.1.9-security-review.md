# Security review: FinCom Bridge 2.1.9

Reviewed: 04-Oct-2026, the diff 416c335..457dc64 read hunk by hunk (bridge-go/, docs/tally-allowlist.md,
docs/bridge-2.1.9-test-sheet.txt), beside the code review of the same range (bridge-2.1.9-code-review.md: its findings
1 to 4 have a security edge and are listed first here). go vet (Linux, Windows) and go test ./... green; the round 18
tests green under -race; release_check_test.sh green. Confirmations were throwaway tests in a scratchpad copy of
bridge-go/, nothing in the repo.

Threat focus: a request to Tally that the owner's rule forbids (a dated voucher read with ReadDays off) reachable from a
web page or the cloud; ReadDays or TallyRequestUTF16 changed from outside the settings file; the new tray routes reachable
from a page; the recorder folder (Users may write there, and the bridge installed for all users is a LocalSystem service,
win_service.go:660-670) used to make the service write or read a file it should not, or to exhaust it; the installer's
new folders and their permissions; the support pack's content and size; the beat's new fields; the TDL add-on.

## Findings
- S0 (HIGH, the owner's rule; code review finding 1). GET /readtest (server.go:250-251, the X-Bridge-Key is enough, no
  ReadDays check) sends the Day Book and TDSDeskVchHeads for the last 30 days. FinCom's own firm-account page calls it
  (src/js/27-firm-account.js:1847), so a page makes the bridge read earlier entries with ReadDays off. Confirmed with a
  throwaway test. Fix before build: readsOffErr on /readtest, and a central refusal in invokeTally of any request with a
  period unless ReadDays is on or the request is a person's test (the read test, measure).
- S1 (HIGH on an all-users install; code review finding 2). recorder.go:246-248: the LocalSystem service appends to
  changenumbers.txt inside the Users-writable recorder folder, and the open follows links. A user without administrator
  rights can therefore steer a write by the service to a file outside that folder, and part of the line (the company
  name) is text that user can choose in Tally. The tray routes stop browsers, not programs on the computer: the signed-in
  user can read the bridge key that the tray uses, so they can trigger the route themselves. Confirmed with a planted
  link (the line was appended to the link's target). On a per-user install the bridge runs as that user, so there is no
  elevation, but another user of the same computer could still have it write as that user. Fix before build: the service
  never writes in recorder\. Keep the lines in the sync folder and add that file to the support pack.
- S2 (HIGH, the installer; code review finding 3). FinComBridge.nsi:411-418: CreateDirectory does nothing when the path
  already exists, and icacls without /L applies the grant to whatever an existing reparse point at that path resolves to.
  Since ordinary users may create folders under C:\ProgramData, an elevated all-users setup can be made to give Users
  Modify on a location the setup never meant to open. The same applies to File /nonfatal into addon\. The (OI)(CI)M grant
  also gives Users DELETE on recorder\ itself. Fix before build: the exe's install step makes the folders and refuses any
  reparse point or any FinCom\ folder not owned by SYSTEM or Administrators (it moves that folder aside and makes a new
  one). It sets protected DACLs: FinCom\ and addon\ read-only for Users; recorder\ lets Users create files and modify their
  own files, with no DELETE on the folder. A Windows-only test with a pre-made reparse point is needed.
- S3 (MEDIUM; code review finding 4). The support pack (recorder.go:164-191, :112; sendlog.go:51-60) follows links, reads
  each file whole before cutting it to 4 MB, has no limit on the number of files, and reads Tally's tdlerror.log, tally.imp
  and tally.ini from the folder of any running process named like tally.exe, a folder a user may own. A non-administrator
  can make the service read files outside the folder and send them to FinCom support (confirmed with a planted link), or
  make it allocate very large amounts of memory. The data goes to FinCom, not to the user, but it may be another user's
  data. Fix before build: regular files only (checked with Lstat, then SameFile on the opened handle, and on Windows no
  file with more than one hard link); read only the tail; at most 50 files and 32 MB in all; Tally's files only from the
  Program Files folders.
- L1 (LOW; code review finding 9). recorderHolding (startpoint.go:125-131) builds a file name from the company name Tally
  reports. A name holding a path separator or ".." makes it look outside the folder, and that file's time goes to the
  cloud in the beat. Fix: no separators and no "..".
- L2 (LOW, privacy). The recorder lines carry the narration and Tally's user name. The add-on writes only for ZZ TEST
  (FCRIsTrial), but the bridge sends every .txt in the folder, including anything a user put there. The pack goes to
  FinCom support only. Optional fix: send only the FCR1 lines whose cname is ZZ TEST, plus changenumbers.
- L3 (LOW, allow-list; code review finding 12). keepListAboveRequest (keep.go:159-166) is a new shape under the existing
  id TDSDeskKeepList, which is not measure-only, and the allow-list's hash does not cover it. Today only the read test and
  measure item a2 build it. Later: give it its own measure-only id.
- Owner's decision (code review finding 7): the measuring tool (person-only) still sends year-wide dated collections with
  ReadDays off. Either the owner exempts it like the read test, or with ReadDays off it runs only its undated items.

## Found safe
- ReadDays is not settable from outside the settings file: there is no default entry, so it is off; applyCloudSettings
  reads only postOnly, the two batch sizes and at (TestReadDaysOffNoOldEntriesRead sends readDays / ReadDays and the
  setting stays off); no local route writes it; the installer does not write it. TallyRequestUTF16 is the same.
- The new tray routes (/tray/recorder-note, /tray/recorder-send) need the X-Bridge-Key, are refused by handle()'s /tray/
  gate on Origin, Sec-Fetch-Site and Sec-Fetch-Mode, and the route also refuses Sec-Fetch-Dest. This is the same rule as
  /tray/measure and /tray/readtest, and both are POST only (TestTrialSendResultsPersonOnly, TestChangeNumbersNoted).
- With ReadDays off, every route except /readtest is safe: /daybook, /vouchers, /tags and /keepcheck answer 409 before
  sending anything; /ledgerlines, /ledgervouchers, /ledgerbalance, /balances and /tb answer from the copy; the keeper,
  /syncnow and /wake stop after the company check and the ledger list.
- No new host: the support pack uses invokeCloud's "support" kind, as Send install log does, and refuses a zip above 9 MB.
  The bridge's log lines in it are masked as they were written (protectLogText).
- The beat's new fields are startPoint, changeNumbers (numbers, times and the recorder flags) and readDays. No key, no
  path, no amount.
- The allow-list: TestAllowListUnchanged and TestNoComputedFigure are green; every dated request still renders yyyymmdd
  through periodVars; the other date forms are built only by the person-started read test.
- The TDL add-on: it acts only when the current company is "ZZ TEST", always runs Tally's own Form Accept, never shows a
  message, makes no network call and only appends to the recorder folder. Loading it stays a manual step.

## Fix before build (must)
1. S0: /readtest refused with ReadDays off, plus the central refusal of any dated request in invokeTally.
2. S1: the service writes nothing in recorder\.
3. S2: the exe makes the folders and sets their permissions, refusing reparse points; Users get no DELETE on recorder\.
4. S3: the support pack reads only bounded regular files and takes Tally's files only from Program Files.
5. The owner decides on the measuring tool (code review finding 7).

## Later (may)
- L1, L2, L3.

## Fixed (04-Oct-2026; the code review's "Fixed" section has the detail and the tests)
- S0: fixed (code review 1): /readtest refused with ReadDays off; invokeTally refuses every request with a period unless
  ReadDays is on or a person started it (the read test; the measuring tool with --old-days at the console only).
  TestReadTestRouteRefusedWhenReadDaysOff, TestNoDatedRequestWhenReadDaysOff.
- S1: fixed (code review 2): the change numbers in sync\recorder-changenumbers.txt; the service writes nothing in
  recorder\. TestChangeNumbersNotWrittenInRecorderFolder, TestNoWriteToRecorderFiles.
- S2: fixed (code review 3): folders.go in the exe's install step: links, junctions and folders not owned by SYSTEM or
  Administrators moved aside, folders made anew, icacls /L with /inheritance:r; Users get (RX,WD) on recorder\ and
  (OI)(IO)M on its files, no DELETE on the folder; FinCom\ and addon\ read-only for Users; the .tdl embedded and
  written without following a link; the NSI no longer touches these folders. TestRecorderFolderLinkRefused,
  TestInstallerRecorderAndAddonFolders, and on Windows TestRecorderFolderJunctionRefusedWindows (CI job
  go-tests-windows) plus an ACL check in the all-users install step.
- S3: fixed (code review 4): readShared (regular file by Lstat, SameFile, one link, tail only, share read/write/delete,
  no follow); at most 50 files, 4 MB each, 32 MB in all; Tally's files only from Program Files.
  TestRecorderSendSkipsLinksAndBoundsSize, TestReadSharedBounds.
- L1: fixed (code review 9): plainFileName. TestRecorderHoldingNoTraversal.
- L2 (privacy, optional): left as is: the pack still sends every .txt of the folder (now at most 50, bounded); sending
  only ZZ TEST's FCR1 lines would hide what an add-on wrote for another company by mistake, which the trial wants to
  see. The pack goes to FinCom support only.
- L3: left open (code review 12), documented: its own measure-only id with the next measured build.
- Owner's decision on the measuring tool: the safer default is taken (code review 7): dated items only with ReadDays on
  or --old-days typed at the console with the bridge stopped. TestMeasureUndatedOnlyWhenReadDaysOff.
- New on the owner's question (can the add-on hang Tally): the bridge never writes, renames, deletes or (outside the
  owner's 30-second lock item) locks a holding file; a busy file is skipped at once. The two new trial tray items are
  person-only (Origin / Sec-Fetch refused), ZZ TEST only. TestRecorderLockHoldingFile, TestRecorderBenchZZTest, and on
  Windows TestSharedReadWindowsWriterGetsIn, TestSharedReadWindowsLockedFails, TestSharedLockWindowsHoldsAndReleases.

## Re-review of the fixes (457dc64..cec0b8a)
Re-reviewed: 04-Oct-2026, the same diff as the code review's re-review (bridge-go/, the workflow), beside it; go vet
(Linux, Windows) and go test ./... green; the round 19 tests green under -race; one fault confirmed with a throwaway
test in a scratchpad copy.

### High
none. S0 holds: every request reaches Tally through invokeTally, which refuses any request with a period unless
ReadDays is on or TC.person is set, and TC.person cannot be set by a web page (the /tray/ gate), the cloud
(applyCloudSettings) or /measure (no --old-days from a route).

### Medium
- RS1 (code review re-review, Medium 1): S3's and S2's fixes check the recorder folder itself, never its parent
  C:\ProgramData\FinCom. The bridge's own update never runs the install step, so on an updated PC any user may create
  FinCom; and a user-owned FinCom stays when an open handle blocks moving it aside. A junction at FinCom (to \RPC
  Control plus an object-manager link "recorder", no privilege needed) makes the LocalSystem service's "send results"
  read the .txt files of another user's folder and send them to FinCom support, and the 30 s lock hold a file there.
  Confirmed with a throwaway test (FinCom a link: a file outside the folder in the pack). Fix before build: before any
  read, FinCom and recorder are plain folders owned by SYSTEM or Administrators (service) and the recorder folder's
  final path is the expected one; the service runs the folder step at its first start after an update.

### Low
- RL1 (code review re-review, Low 3): the change numbers' file is in the installing user's profile (the service's
  Home), which that user can redirect (appendText follows links). From any user down to the installing user, who
  already controls the service's settings (2.1.6). Correct the Fixed text; optionally a no-follow append.
- RL2 (Low 4): benchTC needlessly sets person (drop it); the Windows lock does not check SameFile / one link on its
  handle.
- RL3 (Low 5): explicit ACEs of other SIDs survive /grant:r on a kept admin-owned folder; set the whole DACL.
- RL4 (Low 6): the CI checks the recorder ACL's text, not that a non-administrator can create and append there and
  cannot delete or rename the folder, make a subfolder, or write in addon\ or FinCom\.
- RL5 (Low 2): start-point.json: first-seen numbers not kept while the file is unreadable; saveFile's remove-then-rename
  can leave it missing. The rule "recorded once", not a security edge.

### Found safe
- S0: no dated request with ReadDays off by any route (32 callers of invokeTally traced; every period from dateVars;
  person only from the tray's read test, the console's --old-days and the bench's imports).
- S1: the service writes nothing in recorder\ (TestNoWriteToRecorderFiles; the recorder MkdirAll gone).
- S2: over the old NSIS layout: FinCom kept and protected first, recorder's Users (OI)(CI)M replaced by (RX,WD) +
  (OI)(IO)M, no DELETE or subfolder for Users, addon read-only, links moved aside, icacls always /L on a checked plain
  folder, the .tdl written by remove + CREATE_NEW.
- S3: readShared refuses links, reparse points and hard links, opens without following, reads only the tail, never
  blocks Tally's add-on (share read, write, delete) and never waits for a held file; Tally's files only from Program
  Files.
- L1: plainFileName. L3 remains open as documented.
- The two new tray routes are person-only (the /tray/ gate and their own Origin / Sec-Fetch check), ZZ TEST only; the
  lock is released by its timer or at stop on every path; the bench is not a posting (no read-back, nothing queued for
  the cloud).
- The workflow job is valid and runs the Windows tests; it adds no secret and no publish step.

### Before building the installer
Must: RS1. The rest may wait.

## Fixed after the re-review (04-Oct-2026; the code review's "Fixed after the re-review" has the detail and tests)
- RS1: fixed. Before anything in the recorder folder is listed, watched, read or locked, C:\ProgramData\FinCom and
  recorder\ must be plain folders (Lstat, no reparse point), owned by SYSTEM or Administrators when running as the
  service, and the recorder folder's final path (GetFinalPathNameByHandle; EvalSymlinks elsewhere) the expected one;
  else nothing is done and the log says why. The service runs the folder step once at its first start of each version
  (fincom-folders-version.txt beside the exe), so a PC that updated itself from 2.1.8 gets the protected folders.
  TestRecorderReadRefusedWhenParentIsLink, TestRecorderReadRefusedWhenParentIsJunctionWindows,
  TestFoldersFixedOnFirstStartAfterUpdate.
- RL1: fixed. Correction of S1's "Fixed" text: the change numbers' file is in the bridge's own folder, the installing
  user's (the service's Home), not a folder no member of Users can write; that user already controls the service's
  settings (2.1.6). The append no longer follows a link or a hard link (appendNoFollow). TestChangeNumbersAppendNoFollow.
- RL2: fixed. benchTC has bench only (no person): a dated request through it is refused with ReadDays off. The trial's
  lock checks its handle (regular, SameFile, one name). The sheets say ZZ TEST must not be linked to any FinCom client
  while the bench runs. TestBenchNotPerson, TestRecorderLockRefusesHardLink, TestSharedLockWindowsRefusesHardLink.
- RL3: fixed. icacls /reset /L on each folder before the grants (stray explicit entries dropped); a failed reset stops
  the step. TestFolderACLResetFirst.
- RL4: fixed. The workflow checks as fctest: a file made and appended in recorder\; the folder not deleted, renamed or
  given a subfolder; nothing written in addon\ or FinCom\. TestWorkflowChecksRecorderAsUser.
- RL5: fixed. The first-seen numbers kept while start-point.json cannot be read and written once it can; saveFile never
  removes the file before the rename (a refused rename keeps the old file). TestStartPointPendingKeepsFirstNumbers,
  TestStartPointSaveNeverLosesFile.


Decision after the re-review (04-Oct-2026): the sheets no longer ask for ZZ TEST to be unlinked for "time saving" (the
posting tests of the same sheets need the link). The bench journals are test entries in ZZ TEST ("FinCom bench <n>", no
FinCom tag); with reading prospective FinCom reads no old entries, so they reach the cloud only through a ZZ TEST Day
Book upload, and the ZZ TEST client may show "up to 100 changes not received", which the sheets name as expected.
TestBenchNotPerson checks this wording.

## Review of the last fixes (cec0b8a..9e390bf)
Reviewed: 04-Oct-2026, beside the code review's section of the same name (same diff, go vet Linux and Windows clean,
go test ./... green, the workflow's YAML parses).

### High
none.

### Medium
none. RS1 is closed for the service on a normal install: every listing, look, read and lock in the recorder folder
goes through recorderDirChecked (FinCom and recorder plain folders, no reparse point, owned by SYSTEM or Administrators
as the service, the final path the expected one); the service runs the folder step at the first start of each version,
before the bridge serves anything, and writes the marker only on success. After the step neither folder can be renamed
or replaced by a non-administrator (FinCom Users RX; recorder no DELETE; ProgramData no DELETE_CHILD for Users), which
is what closes the window between the check and the opens. No false refusal found on a fresh install, a short-name
path, a different case, or a just-for-me install (no service: no owner check, no step).

### Low
- RL6 (code review, Low 1): the opens themselves do not check the final path on the handle, and the check trusts the
  owner, not the ACL. A step that stops between FinCom's /reset and its grants (an icacls failure) leaves FinCom open to
  adds and an old 2.1.8 recorder deletable, so it can be swapped for a junction between the check and the read or lock;
  on a just-for-me install on a shared PC another user may own FinCom and do the same (the desk user's own .txt files
  then go to FinCom support). Minimal fix: GetFinalPathNameByHandle on the opened file in readTail and lockExclusive,
  its folder equal to the checked final path; or, as the service, require the marker to be this version, and per user
  the owner to be the user, SYSTEM or Administrators.
- RL7 (code review, Low 2): CI does not run the Windows append (TestChangeNumbersAppendNoFollow) or the owner check as
  the real service. Add `|AppendNoFollow` to go-tests-windows' -run, and in the all-users install step check the
  service's log has no "is not read" line and the marker holds the version.
- (Code review Lows 3 and 4, start point with a blank GUID, saveFile and a read-only file: correctness, not security.)

### Found safe
- RL1: appendNoFollow refuses a link, junction or hard link at the change numbers' file, also one swapped in between
  the Lstat and the open.
- RL2: benchTC has no person (a dated request through it is refused with ReadDays off); the lock checks its handle
  (regular, SameFile, one name) on both platforms.
- RL3: /reset before the grants on each folder; the brief inherited state of FinCom gives Users no delete, and anything
  a user adds then is moved aside by owner.
- RL4: the fctest step is valid PowerShell in the right job and checks the behaviour (create and append allowed; delete,
  rename, subfolder, addon\ and FinCom\ refused).
- RL5: the first-seen start-point numbers kept and never replaced; saveFile never removes the file.
- The marker lives in Program Files (administrators only); the uninstaller deletes it; no new route, secret or publish
  step.

### Before building the installer
Must: nothing. RL6 next (defence in depth); RL7 cheap.

Range: 416c335..9e390bf
