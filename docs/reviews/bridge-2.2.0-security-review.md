# Security review: FinCom Bridge 2.2.0 core

Reviewed: 04-Oct-2026. I read the diff bdfe261..3fbc965 -- bridge-go/ hunk by hunk from the commit (git show
3fbc965:path, and a clean worktree of 3fbc965), not the working tree, which another agent is still editing. I read it
alongside the code review of the same range (bridge-2.2.0-code-review.md). Its findings 1, 2, 3, 6 and 7 have a security,
privacy or owner's-rule edge and are listed first here. Where it matters I also read server/tally-cloud/index.ts at
3fbc965: recorder_lines, the 409 for an unlinked company, and the beat's recorderSource.

Checks:
- go vet (Linux, Windows): clean.
- go test -run 'Recorder|Uploader|Window|Live|SourceB|Allow|NoWrite': green.
- The recorder tests under -race: green.

Confirmations were throwaway tests in the scratch worktree, which was removed afterwards. Nothing was added to the repo.

Threat focus:
- What leaves the computer now that the add-on writes for every company and the bridge reads every company's files.
- Who can put lines into recorder\: Tally users through narrations, and any Windows user through the folder ACL
  ("Users may add files"). What such a line can make the bridge ask of Tally or send to the cloud.
- Whether the ReadDays exception (FinComVoucherByMaster) can be widened into a dated read of old entries or a day's
  list.
- The rollback:
  - who can trigger it;
  - what it runs;
  - what it leaves behind (NoAutoUpdate).
- Log pruning:
  - deletes only the bridge's own files;
  - follows no links;
  - allows no traversal.
- Whether the beat's recorderSource can widen anything, or undo the owner's 2 s rule.
- New outbound hosts, and AI.

## Findings

- S1 (HIGH, privacy; code review finding 1). The entries of companies that are not linked to FinCom leave the computer.
  - The add-on writes for whichever company is current, which the owner chose.
  - The uploader asks Tally for each such entry's body (party, ledger lines and amounts, bill allocations, narration).
    It sends the body to FinCom's cloud before it learns that the company is not linked: the cloud answers 409
    notLinked.
  - It then sends the same bodies again at every backoff, and asks Tally for them again after every restart.
  - Typical cases: an owner's personal books, or another client's books kept on the same Tally.
  - Confirmed: with the stand cloud answering 409, FinComVoucherByMaster was asked, and the request carried `<VOUCHER`.
  - Availability edge: those lines fill the one 20,000-line queue, after which no company's lines are read.
  - Fix before build:
    - send no body for a company the cloud has not yet taken a line of (a heads-only first group);
    - treat 409 notLinked as final for that company (drop its lines, ask again hourly);
    - a cap per company.

- S2 (MEDIUM, integrity and owner's rule 2; code review finding 3). Forged recorder lines.
  - Who can write lines:
    - a Tally user, through a narration with a line break followed by "FCR1|...";
    - any Windows user, by adding a <GUID>-<date>.txt to recorder\ (Users may add files, by design, because Tally runs
      as the user).
  - What such a line can do:
    - name any company and GUID;
    - send "deleted", "cancelled", "altered" or "ledger_deleted" for another company's entries into that company's
      FinCom book;
    - make the bridge ask Tally for up to 50 MasterIDs per request on any date while ReadDays is off. Rule 2 allows a
      dated request only by the MasterID of a just-changed entry; the bridge takes "just changed" on the line's word.
  - Confirmed: one ZZ TEST line whose narration held a forged line queued a "deleted" for "Other Co", dated 20200401.
  - Limits:
    - the request is still one day and at most 50 IDs, exactly as built (voucherByMasterExact), so it is not a day's
      list;
    - a planted line cannot read the answer back; it goes to FinCom's cloud.
  - Fix before build:
    - a line counts only when its cguid matches its file name and the company's held GUID;
    - a fetched body is used only when its GUID matches the line and its ALTERID is above the start point;
    - nothing is asked for a line whose aid is not above the start point.

- S3 (HIGH, owner's rule 6; code review finding 2). The rollback runs an unverified program.
  - rollBackBridge (update.go:285-308) renames FinComBridge.previous.exe into place with no SHA-256 and no signature
    check. Updates themselves are checked (signed list, SHA-256, optional Authenticode); the kept copy is never checked
    again.
  - Confirmed: arbitrary bytes kept as previous.exe were put in place on confirm:true.
  - Exposure:
    - Service install: the exe folder is in Program Files, so replacing previous.exe needs an administrator. The risk
      there is a damaged copy, which leaves the bridge down with no way back: update-pending.json is deleted, and
      there is no old.exe for undoFailedUpdate.
    - Per-user install: the folder is the user's own, so the user could run any program anyway. The check matters for
      integrity, not elevation.
  - Fix before build:
    - record the SHA-256, and whether the code signature passed, when the update replaces the program;
    - check both before the rollback;
    - set the rollback up as an update (old.exe and update-pending.json) so a program that does not start is undone.

- S4 (MEDIUM, owner's rule 6). A single click by anyone at the computer turns automatic updates off for good, and
  FinCom is not told.
  - The tray item is always shown, and its yes/no goes to whoever is at the computer, not necessarily the owner.
  - It sets NoAutoUpdate permanently. The text says "until FinCom support turns them on again", but no beat field
    clears it and the beat does not report it (nothing in beatBody names NoAutoUpdate or update-undone.json).
  - Effect: a computer can quietly stay on an older bridge and miss later fixes, including security fixes, and the
    owner sees only an older version number.
  - /tray/rollback with {confirm:true} also skips the question for any local program that holds the bridge key. Other
    /tray/ routes are the same, so this is Low on its own.
  - Fix (should):
    - put `autoUpdate: false` and `rolledBack: {from, to, at, by}` in the beat;
    - let the beat answer's release carry `autoUpdateOn: true` (the owner's action in FinCom) to clear NoAutoUpdate,
      logged.
  - Fix (may): show the item only while FinCom's per-computer switch allows it, as trialTools does, with a local
    override for when the cloud cannot be reached.

- S5 (MEDIUM, owner's 2 s rule; code review finding 6). The beat can turn source B back on without the owner.
  - An answer without recorderSource counts as the value "", which differs from the stored offBeat. Source B is then
    on, the 60 s spacing is cleared, and it asks at once.
  - recorderSource stays inside the three values (validSource; rule 7 holds). The flaw is that absence counts as a
    switch.
  - Confirmed with a throwaway test.
  - Beyond the bug, a cloud that alternates the value turns source B back on at every flip. That bounds it to one slow
    list per light check, every 10 minutes per company.
  - Fix before build: only a present, valid and different value turns it on; offBeat is the effective source.

- S6 (MEDIUM, owner's rule 4; code review finding 7). Recorded lines can be lost silently.
  - Daily files older than 6 days are never read.
  - failed.txt, where the add-on puts lines it could not write, is never read.
  - The bridge now opens Tally's live file every second, which can cause such failures if Tally's open does not share.
  - Fix before build: read unsent older files (up to 31 days) and failed.txt's inner lines; open a file only when its
    size has grown.

- S7 (LOW, privacy). The holding files are kept forever and every Windows user can read them.
  - The bridge must never delete them (rule 3), and the add-on cannot.
  - recorder\ therefore grows by one file per company per day, holding narrations, party names, voucher numbers and
    Tally user names, readable by Users (as in 2.1.10, S3).
  - recorder-live-sheet.txt says the folder is readable by every Windows user, but not that nothing ever removes the
    files.
  - Fix (may): one sentence and a manual step in the sheet (delete daily files older than N days when the bridge's
    beat shows them sent). Or a cleanup in the installer run by an administrator, never by the running bridge.

- S8 (LOW; code review finding 17). Without a company GUID, the add-on builds its file path from the company name.
  - A name holding "..\" writes outside recorder\, wherever the Tally user can write. Characters such as \ / : * ? make
    the open fail.
  - This only affects the user's own rights; there is no elevation.
  - Fix (may): no file per name; use failed.txt.

- S9 (LOW). Log volume from a held file.
  - readSharedFrom logs every busy open (shared.go:36-41), once per file per second.
  - Anyone who can hold a daily file open can grow the bridge's log by about 86,000 lines a day per file. The rotation
    and 30-day pruning keep this bounded on disk.
  - Fix (may): log once per file per 10 minutes.

What holds (checked, no finding):
- Rule 1, the dated exception is narrow:
  - voucherByMasterExact passes only the exact text voucherByMasterRequest builds: one day (SVFROMDATE = SVTODATE), 1
    to 50 `$MasterID = <digits>` joined by OR.
  - Nothing else can carry a period past datedRefused while ReadDays is off, and a day's list cannot pass.
  - The body fetch is still refused while reading is stopped: FinComVoucherByMaster is not in readStopExempt.
- Rule 3: the holding files are read only through readSharedFrom:
  - Lstat, no reparse point, a regular file;
  - the same file after the open;
  - one name;
  - read-only with every sharing, and never waited for.
  The bridge writes, renames and deletes only in its own places: sync\recorder-offsets.json (saveFile), the files in
  sync\recorder-sent\ (whose day names are checked by isTallyDate before removal), the exe folder (update and
  rollback), and its log.
- Log pruning (config.go:292-317) and the uninstall (uninstall.go:53-60):
  - only `go-bridge.log.<yyyy-mm-dd>[-n]` and `.[1-9]`;
  - matched by an anchored, quoted regexp, in the log's own folder (Glob of the base name);
  - regular files under Lstat, so no link or junction is followed;
  - rotation's rename does not follow a link;
  - the next append uses the no-follow append of round 20.
- /tray/rollback is refused with Origin, Sec-Fetch-Site, Sec-Fetch-Mode or Sec-Fetch-Dest (server.go:126 and
  :687-692, as for /tray/measure). It needs the bridge key and POST, and a body that is neither a preview nor
  confirm:true changes nothing.
- Rule 7: recorderSource from the beat is lower-cased, trimmed and taken only as addon, alterid or both; anything else
  means "the setting". It widens nothing beyond choosing among the three (but see S5).
- Rule 8:
  - The diff adds no outbound host and no network call other than invokeCloud to the existing cloud.
  - Nothing calls an AI service.
  - The add-on has no network action.
- recorderState and recorderSourceB in the beat carry counts, times and the 2 s reason only: no narration, no entry
  text.

Verdict:
- Two High: S1 and S3 must be fixed before building.
- S2, S5 and S6 are owner's rules (2, the 2 s switch-off, nothing lost) and are small. Fix them with the Highs.
- S4 should be fixed before 2.2.0 reaches computers other than the pilot.
- S7 to S9 may wait.


## Status after the fixes (04-Oct-2026, by the builder; details in the code review's status section)

- S1 (HIGH): Fixed with code review 1 (TestUnlinkedCompanyNoBodyNoStall, TestLiveQueueCapPerCompany): nothing of a
  company leaves the computer before the cloud has said it is linked (an empty recorder_lines call); not linked: its
  lines are skipped for an hour, counted in the beat; the cap is per company.
- S2 (MEDIUM): Fixed with code review 3 (TestForgedLineDropped). The folder ACL ("Users may add files") stays by design:
  Tally runs as the user and must append; a planted file's lines are taken only for the company whose GUID starts its
  name and is held, and only entries above the starting point are asked of Tally.
- S3 (HIGH): Fixed with code review 2 (TestRollbackVerifiesKeptVersion, TestRecorderRollbackAfterSetup).
- S4 (MEDIUM): Fixed in the bridge (TestRecorderAutoUpdateInBeat): the beat carries `autoUpdate` (false while
  NoAutoUpdate is set) and `rolledBack` (update-undone.json); an answer with `autoUpdateOn: true` (top-level or in
  release) clears NoAutoUpdate, logged. The cloud side (the owner's action, the field in the answer) is the
  coordinator's. Left: hiding the tray item behind a cloud switch.
- S5 (MEDIUM): Fixed with code review 6.
- S6 (MEDIUM): Fixed with code review 7.
- S7 (LOW): Fixed in words: docs/recorder-live-sheet.txt says nothing removes the files and how an administrator may
  delete daily files older than 31 days by hand once nothing waits.
- S8 (LOW): Fixed with code review 17 ("noguid", never a name in a path).
- S9 (LOW): Fixed with code review 14.


## Round 2 (3fbc965..0b43d34)

Reviewed: 04-Oct-2026. I read git diff 3fbc965 0b43d34 -- bridge-go/ docs/tally-allowlist.md from a clean worktree of
0b43d34, alongside round 2 of the code review (bridge-2.2.0-code-review.md, "Round 2"), which has the details and the
tests.
- go vet (Linux, Windows): clean.
- go test -count=1 ./...: ok.
- Two throwaway tests confirmed R2-S2 and R2-S3. They were deleted and the worktree removed.

### Round 1 findings: is each "Fixed" claim true?

| Finding | Claim | Verdict | Notes |
|---|---|---|---|
| S1 H | Fixed | Confirmed | An empty recorder_lines call (`lines: []`, company name and GUID only) goes before any body is asked or any line sent. The cloud answers 409 notLinked from bookFor before it reads lines. Not linked: skipped for an hour, nothing fetched or sent. The cap is per company. |
| S2 M | Fixed | Not fixed for failed.txt | Fixed for daily files. failed.txt skips the file-name check, and "the file the add-on meant" comes from the line's own `file=`, so the cross-company narration forgery works again whenever a line lands in failed.txt (R2-S3, confirmed). |
| S3 H | Fixed | Confirmed for the update path; the setup path is weaker (R2-S4) | SHA-256 recorded at applyUpdate while the program ran; checked at the preview, with the signature when RequireSignedUpdates is on; the rollback is set up as an update (old.exe, update-pending.json), so it can be recovered. |
| S4 M | Fixed in the bridge | Confirmed | The beat carries autoUpdate and rolledBack; autoUpdateOn clears NoAutoUpdate, logged. The cloud side and hiding the tray item are still open. |
| S5 M | Fixed | Confirmed | Only a present, valid value counts; the source in force is persisted; the off state is persisted per method. |
| S6 M | Fixed | Confirmed | Files up to 31 days old and failed.txt are read; a file is opened only when it grew. |
| S7 L | Fixed in words | Confirmed (the sheet) | |
| S8 L | Fixed | Confirmed | "noguid"; never a name in a path. |
| S9 L | Fixed | Confirmed | |

What holds in the new code:
- Nothing new leaves the computer:
  - The probes log only counts, times and tag names. The Edit Log probe logs the first 300 characters of tag names,
    never values.
  - tallyProgram reads the size and date of tally.exe.
  - The beat adds file names (recorderFiles, at most 50 company-GUID-based names), autoUpdate and rolledBack.
  - There is no new outbound host and no AI.
- The rollback still cannot be started from a web page (server.go unchanged), still needs the key, POST and confirm,
  and is now verified and recoverable.
- The add-on: no name check, append only, never a name in a path.
- Every new Tally request has a timer and a time limit, and the 2 s switch-off covers B, C and the body fetch. It is
  persisted and lifted only by an owner's different, valid value. A timeout counts as slow.

### Findings, round 2

- R2-S1 (MEDIUM, owner's rule 1 and prospective-only; code review R2-1). Source C starts at the starting point, has no
  span bound and a 60 s limit. It can turn the first switch into a read of everything changed since linking, with bodies
  after. Fix as for B: start at max(start point, highest add-on AlterID, ALTVCHID at the switch), skip a span above 500,
  and use a 5 s limit.

- R2-S2 (MEDIUM, owner's rule: the dated exceptions cannot be widened; code review R2-2). FinComSlice's guard accepts a
  full month of any year.
  - sliceExact rebuilds the request from the request's own month and AlterID, so `$AlterID > 0` for April 2019 (or
    for 2099-12) passes datedRefused with ReadDays off. That is every entry of that month, as GUID, MasterID, AlterID
    and date.
  - Confirmed with a throwaway test.
  - Today only liveSourceC builds the request, with safe values. But the guard is the rule's enforcement, and it would
    not stop a wrong caller.
  - Fix: N >= the company's starting point (no starting point means refuse), and the month between liveEarliestMonth and
    the current month.

- R2-S3 (MEDIUM, integrity; round 1's S2 reopened; code review R2-3). Forged lines through failed.txt.
  - A Tally user's narration in company A, once that line goes to failed.txt (the daily file could not be opened),
    yields a separate "deleted" or "altered" line for company B, sent into B's book. The held check passes because the
    forged cname B maps to B's GUID.
  - A plain line written into failed.txt is taken for any company without even the file-name check.
  - Confirmed: both forged lines were queued for "Other Co". The real line carrying the narration was lost.
  - Fix:
    - in failed.txt, take and split only `FCR1|ev=write_failed|` lines;
    - require the unwrapped line's cguid to equal the held GUID of its cname (refuse when there is none).

- R2-S4 (MEDIUM, owner's rule 6 integrity; code review R2-4). The setup's previous copy.
  - The setup deletes the kept, verified previous program before an unchecked copy.
  - It labels the copy with the registry Version, which automatic updates never update.
  - It hashes whatever the copy produced, so a truncated copy is recorded as good.
  - Effects:
    - a mislabelled rollback (the same program, "back to 2.2.0") that also turns updates off;
    - a good kept copy lost to a reinstall;
    - or a non-starting program put in place with no undo, because undoFailedUpdate runs in the started program.
  - Not an elevation: the service install's folder is Program Files.
  - Fix:
    - copy to a temporary name and check it;
    - compare the SHA-256 with setup-old.exe (kept until the install step), and with the new exe to detect "the same
      version";
    - replace the kept pair only when all of that holds.

- R2-S5 (LOW, rule 7 / contract; code review R2-5). The bridge now reads "both" as the add-on plus slices, while the
  cloud (migration 47, index.ts) still means add-on plus alterid and cannot send "slices". The owner's choice in FinCom
  does not do what its words say. Fix: change the cloud and the bridge together.

- R2-S6 (LOW; code review R2-8). There is a gap between the rollback's hash check and its rename. It matters only for
  the per-user install, where the user can run anything anyway. Fix: move the file first, then hash it.

- R2-S7 (LOW; code review R2-12). TestNoComputedFigure exempts $$Date and $$IsBetween by name only. Nothing computed
  passes today. Fix: exempt only the literal and comparison shapes inside the request's Formulae.

- Code review R2-6, R2-7, R2-9, R2-10 and R2-11 are Low with no security edge (the probe's 7 forms; a rollback leaving
  a newer build as "previous"; spacing not saved after a failure; source C's long walk back; the form keyed by Tally's
  path).

Verdict, round 2:
- No High.
- R2-S1 to R2-S4 are Medium owner's-rule findings and block the build; each is a few lines.
- R2-S5 should go with the cloud's next deploy.
- The rest may wait.


### Status after the round 2 fixes (by the builder; details in the code review's round 2 status)

- R2-S1 MEDIUM: Fixed with R2-1 (TestSourceCBounded, TestSourceCStartsAtSwitch).
- R2-S2 MEDIUM: Fixed with R2-2 (TestSourceCDatedGuardException: both proved bypasses refused).
- R2-S3 MEDIUM: Fixed with R2-3 (TestFailedTxtForgedDropped). Left: a whole write_failed line planted in failed.txt by
  someone who can write the folder, for a held company (the round 1 S2 residual, the folder ACL by design).
- R2-S4 MEDIUM: Fixed with R2-4 (TestSetupKeepsGoodPrevious).
- R2-S5 LOW: Fixed in the bridge with R2-5.
- R2-S6 LOW: Fixed with R2-8.
- R2-S7 LOW: Fixed with R2-12.

## Round 3 (0b43d34..41edc65)

Reviewed: 04-Oct-2026. I read git diff 0b43d34 41edc65 -- bridge-go/ from a clean worktree of 41edc65, alongside round
3 of the code review (bridge-2.2.0-code-review.md, "Round 3"), which has the details.
- go vet (Linux, Windows): clean.
- go test -count=1 ./...: ok (the run appends to a tracked bridge-go/tds-bridge.log; code review R3-2).
- One throwaway test confirmed R3-S1. It was deleted and the worktree removed.

### Round 2 findings: is each "Fixed" claim true?

| # | Claim | Verdict | Notes |
|---|---|---|---|
| R2-S1 M | Fixed with R2-1 | Confirmed | Source C starts at max(starting point, the add-on's highest AlterID, ALTVCHID at the switch); a span above 500 is not asked; the slice's limit is 5 s; the walk back stops at the starting point's month. |
| R2-S2 M | Fixed with R2-2 | Not fixed for the filter-only form | sliceExact now checks the values, but datedRefused never calls it for a request without SVFROMDATE/SVTODATE. When the kept form is collFilterOnly, "2019-04 above 0", "2099-12" and "AlterID 0" all pass the dated guard with ReadDays off (R3-S1, confirmed). |
| R2-S3 M | Fixed with R2-3 | Confirmed | failed.txt: only write_failed lines start, never inside an open one, a multi-line one waits for the file's end, a plain FCR1 line is passed over, and the inner cguid must equal the held GUID of its cname. The planted-line residual (folder ACL by design) stands. |
| R2-S4 M | Fixed with R2-4 | Confirmed | Copy to previous.new, verified against setup-old.exe's SHA-256, "same program" by the installed exe's SHA-256, the version from the replaced program itself (10 s), the kept pair replaced only then. Not an elevation: the program asked for its version is the one Program Files held (the service install), or the user's own (per user). |
| R2-S5 L | Fixed in the bridge | Confirmed | "both" = add-on + source B, as the cloud means; month slices only by the local setting RecorderSlices. |
| R2-S6 L | Fixed with R2-8 | Confirmed | Renamed to rollback-check.exe, hashed there, put back on any mismatch or failure. The name is in the same folder, which only matters for the per-user install's own user. |
| R2-S7 L | Fixed with R2-12 | Confirmed | Only the exact literal and comparison shapes inside Formulae are exempt. |

What holds in the new code:
- Nothing new leaves the computer; no new outbound host. The install step's log lines name versions and say whether
  the copy was whole, nothing else.
- The rollback still cannot be started from a web page and still needs the key, POST and confirm.
- The setup never deletes a kept, verified pair, and a truncated or mislabelled copy is not recorded.

### Findings, round 3

- R3-S1 (MEDIUM, owner's rule: the dated exceptions cannot be widened; code review R3-1). The FinComSlice guard does
  not run for the collFilterOnly form.
  - datedRefused (tally.go:294) passes any request without `<SVFROMDATE`/`<SVTODATE` before it reaches sliceExact, and
    formCollection's collFilterOnly carries the period only in a `$Date` filter.
  - With collFilterOnly kept, a slice for April 2019 above AlterID 0, for 2099-12, or for this month above 0 passes
    with ReadDays off: every entry of that month, as GUID, MasterID, AlterID and date. Any request with its period only
    in a filter passes the same way.
  - Confirmed with a throwaway test.
  - Today only liveSourceC builds the slice, with safe values; as with R2-S2, the guard is the rule's enforcement and
    would not stop a wrong caller.
  - Fix: route every FinComSlice through sliceExact whatever its static variables, and treat a `$Date`/`$$IsBetween`
    filter as dated (or drop collFilterOnly).

- Code review R3-2 (a test-written log committed in bridge-go/) and R3-3 (a misleading install log line) are Low with
  no security edge.

Verdict, round 3:
- No High.
- R3-S1 is Medium (R2-S2 left open for one kept form) and blocks the build.
- R2-S1, R2-S3 and R2-S4 are confirmed fixed; the round 2 Lows are confirmed.


### Status after the round 3 fixes (by the builder; details in the code review's round 3 status)

- R3-1 MEDIUM: Fixed (TestSliceGuardEveryForm).
- R3-2 LOW: Fixed (TestNoLogInPackageFolder).
- R3-3 LOW: Fixed (TestSetupSameVersionOtherBytes).

Range: bdfe261..41edc65
