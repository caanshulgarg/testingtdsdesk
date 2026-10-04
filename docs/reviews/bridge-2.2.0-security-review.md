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

Range: bdfe261..3fbc965
