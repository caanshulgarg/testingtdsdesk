# Code review: FinCom Bridge 2.2.0 core

Reviewed: 04-Oct-2026, by the reviewer in the Claude Code session. I read the diff bdfe261..3fbc965 -- bridge-go/ hunk by
hunk (28 files: recorder_live.go and its tests, addon/FinComRecorder.tdl, shared.go, tally.go, jobs.go, post.go,
cloud.go, keep.go, startpoint.go, update.go, win_service.go, win_tray.go, server.go, config.go, uninstall.go and the
rest). I read every file from the commit (git show 3fbc965:path, and a clean worktree of 3fbc965), not the working tree,
which another agent is still editing (date probes, Edit Log probe, month slices). Where a finding depends on the cloud, I
read server/tally-cloud/index.ts at 3fbc965 (recorderLines, the beat's recorderSource).

Checks (clean worktree of 3fbc965):
- `go vet ./...` and `GOOS=windows go vet ./...`: clean.
- `go test -count=1 -run 'Recorder|Uploader|Window|Live|SourceB|Allow|NoWrite' ./...`: green (92 s).
- The same recorder tests under `-race` (`-run 'Live|Uploader|SourceB|Window|Recorder'`): green, no race reported.
- Side effect: TestRecorderLinesFixture rewrites tests/fixtures/recorder-lines-2.2.0.json on every run (Low 5).

I confirmed five suspected faults with throwaway tests in the worktree (zz_scratch_r220_test.go). The file was deleted
and the worktree removed afterwards. Nothing was added to the repo.

What 2.2.0 adds over 2.1.10:
- The live add-on (addon/FinComRecorder.tdl). It appends one heads-only line per Tally event to
  recorder\<company GUID>-<yyyymmdd>.txt, for whichever company is current.
- Source A, the reader (recorder_live.go). It runs on the 1 s folder watch, reads only through readSharedFrom, from
  offsets kept in sync\recorder-offsets.json, and maps the events (pairs, multi-line narration, partial lines).
- Source B, Tally's change list. The undated TDSDeskKeepList with MASTERID added runs after the light check, at most
  once in 60 s. It turns itself off after a list that took more than 2 s, and stays off until the owner switches the
  source.
- The body fetch, FinComVoucherByMaster: 1 to 50 MasterIDs with the line's own date as the period. It is the one
  exception to the ReadDays guard (tally.go datedRefused, voucherByMasterExact). Ledgers come through the ledger list's
  request with a one-ID range.
- The uploader (recorder_lines). It sends groups of up to 500 lines or 1 MB for one company. A group counts as sent only
  on a 200 answer with results or queued. Sent ids are kept 7 days, failures back off, and postings go first.
- The posting window (a0 and a1 around a job) is added to the job's last posts_update.
- recorderState, recorderSource and recorderSourceB are added to the beat. recorderSource is also read from the beat
  answer.
- "Roll back to the previous version": a tray item and /tray/rollback. The previous program is kept after an update
  that ran well, and NoAutoUpdate is set on a rollback.
- Logs are kept 30 days, with date-named copies; only the bridge's own copies are pruned.

Focus (the owner's rules):
1. Tally never hangs. This covers every new Tally request (the body fetch, Source B's list, the a1 read): its size,
   bound, time limit, giving way to postings, and the 2 s switch-off. The dated exception must stay narrow.
2. Reading stays prospective.
3. The add-on's holding files are never written, locked, renamed or deleted.
4. The uploader: nothing lost, postings first, memory bounds, backoff.
5. The TDL add-on: no company-name check, one line per event, never blocks Tally, a valid daily file name.
6. The rollback is verified, owner-confirmed, refused from a web page, and sets NoAutoUpdate. Log pruning is safe.
7. The beat cannot widen anything beyond the three source values.
8. No AI and no new outbound host.

What holds (checked, no finding):
- Rule 1, the dated exception. voucherByMasterExact (recorder_live.go:868-885) passes a dated request only when it is
  byte-for-byte what voucherByMasterRequest builds for one day and 1 to 50 MasterIDs. The IDs go through onlyDigits, so
  nothing can be injected into the filter. A day's list cannot be sent through it.
- Rule 1, giving way to postings:
  - The body fetch runs only while no posting is going (:1160).
  - The body fetch and Source B use a copier TC whose yield covers postingGoing and importsInFlight, so a posting
    preempts them.
  - The uploader never starts a call while importsInFlight > 0 (:1111, :1181), and sends at most one group per gap
    between imports while a posting is going.
- Rule 1, the a1 read. It goes after the last import of the job and never during one (TestWindowValues). It is one
  FinComCompany read with a 15 s limit.
- Rule 3. The reader uses readSharedFrom only (shared.go:36): Lstat, no reparse point, the same file, one name, read
  only. The bridge's only writes go to its own files: sync\recorder-offsets.json, sync\recorder-sent\, the exe folder,
  and the log.
- Rule 4, the basics work:
  - The offset never passes an unsent line, the first half of a pair, or a queued change (:236-278).
  - A restart resumes from those offsets, and the 7-day sent ids stop duplicates.
  - A partial last line waits; a multi-line narration is joined.
  - Backoff is per company, 30 s doubling to 30 min.
  - Per-line "failed" results in a 200 answer are final in the cloud (cleanRecorderLine), so marking them sent is
    right.
- Rule 5. There is no company-name check. The add-on does one append (two writes, one line) and has no Message, Query,
  loop or wait. When the daily file cannot be opened it tries failed.txt once and then gives up.
- Rule 6:
  - /tray/rollback is refused with Origin or Sec-Fetch-* (server.go:126 and :687-692), needs the bridge key, needs
    POST, and needs confirm:true after a preview.
  - NoAutoUpdate is set, and 2.1.10's updateLoop already honours it.
  - pruneLogs (config.go:302) deletes only `<log>.<yyyy-mm-dd>[-n]` and `<log>.[1-9]` in the log's own folder, as
    regular files under Lstat, so no links, junctions or traversal.
- Rule 7. Only addon, alterid or both is ever taken from the beat (validSource, :281). Anything else means "the
  setting's value".
- Rule 8. The diff adds no outbound host and no AI: uploads use invokeCloud, the existing host.

## Findings (open; none fixed yet)

1. HIGH. Lines of a company that is not linked to FinCom are fetched with their bodies and sent. The cloud refuses them,
   they are retried forever, and once 20,000 of them are queued no company's file is read any more.
   - Where:
     - recorder_live.go:1107-1211 (liveUploadOnce). It fetches bodies at :1160, before the send.
     - :381-384 (liveQueueMax, one cap for all companies).
     - :1195-1211: any refusal is backed off and kept.
     - The cloud: index.ts recorder_lines answers `409 {notLinked:true}` when bookFor finds no book.
   - Scenario:
     - The add-on writes for every company (the owner's decision), so the owner's own books, or a client not on
       FinCom, produce lines.
     - The uploader asks Tally for those vouchers' bodies (party, amounts, bill allocations, narration).
     - It sends them in a recorder_lines call. The cloud answers 409, and the group is retried after 60 s, 120 s and
       so on, with the bodies held in memory. After a restart the bodies are asked of Tally again.
     - When the unlinked company has 20,000 lines waiting, liveReadFile returns at :381 for every file. The linked
       companies' lines are then no longer read. They are not lost while their files are under 7 days old, but
       nothing flows.
   - Confirmed: TestScratchUnlinkedCompanyStaysQueued. With the stand cloud answering 409: one FinComVoucherByMaster
     went to Tally, the request sent to the cloud carried `<VOUCHER`, and the line stayed queued.
   - Minimal fix:
     - (a) Treat 409 with notLinked as final for that company key. Note the company as not linked (in memory and in
       recorder-offsets.json, with the time), drop its queued lines, and let its offsets move on. Ask again at most
       once an hour with one heads-only line.
     - (b) Fetch no body for a company until the cloud has taken a line of it in this run (a heads-only first group).
     - (c) Make the queue cap per company (for example 5,000), so one company cannot stop another.
   - Test: TestUnlinkedCompanyNoBodyNoStall.
     - A 409 notLinked for company X: no FinComVoucherByMaster for X, X's lines dropped, and one log line.
     - Lines of linked company Y written afterwards are read and sent.
     - X is asked again only after an hour.

2. HIGH (owner's rule 6). The rollback puts back whatever FinComBridge.previous.exe holds, unverified, and nothing
   recovers if that program does not start.
   - Where: update.go:255-269 (keepPreviousVersion records only a version string) and :285-308 (rollBackBridge
     renames, with no hash and no signature check).
   - Scenario:
     - previous.exe is damaged (a partial copy, or quarantined and replaced by antivirus), or it was swapped. For the
       per-user install the exe folder can be written by that user.
     - The rollback puts it in place and stops the bridge.
     - The program does not start, and undoFailedUpdate cannot help: the rollback deleted update-pending.json, and
       there is no FinComBridge.old.exe.
     - The bridge stays down until someone reinstalls. NoAutoUpdate is already set, so no update repairs it.
   - Confirmed: TestScratchRollbackNoVerify. "anything at all" written as previous.exe was put in place with
     confirm:true.
   - Minimal fix:
     - When the update is applied, write the SHA-256 of the running program, and whether checkCodeSignature passed, to
       update-pending.json. keepPreviousVersion copies both into previous-version.json.
     - rollbackPreview and rollBackBridge hash previous.exe again and refuse on a mismatch ("the kept version has
       changed; nothing was changed"). When the kept version was signed, or RequireSignedUpdates is on,
       checkCodeSignature must pass.
     - Put the running program aside as FinComBridge.old.exe and write update-pending.json {from: 2.2.0}. If the
       previous program fails to start, undoFailedUpdate then puts 2.2.0 back. Do this instead of naming it
       rolledback.exe with no way back.
   - Test: TestRollbackVerifiesKeptVersion.
     - A changed previous.exe is refused, and both files are unchanged.
     - A good one is put back, and update-pending.json names 2.2.0.

3. MEDIUM. A narration line that starts with "FCR1|" is read as an event of its own, for any company and any date.
   Nothing checks a line's company against its file.
   - Where:
     - recorder_live.go:462-513 (liveLogical: any physical line that starts with "FCR1|" starts a new logical line).
     - :663-703 (liveEmit takes cname and cguid from the line).
     - :1099-1105 (the group goes under the line's company).
   - Scenario. A person in company A types this narration: "...", a line break, then
     "FCR1|ev=after_delete|...|cguid=<B's GUID>|cname=B|guid=<a voucher of B>|...|t1=x".
     - The bridge queues a "deleted" for B's voucher and sends it to B's book.
     - An "altered" line instead makes the bridge ask Tally for B's voucher by MasterID on any date while ReadDays is
       off. Rule 2's exception is meant for a just-changed entry; here it serves any MasterID a line names.
     - Any Windows user can do the same by adding a file to recorder\, where Users may add files (security review S2).
   - Confirmed: TestScratchForgedLineInNarration. One "after_cancel" line of ZZ TEST, whose narration held such a line,
     queued `deleted company="Other Co" cguid="OTHER-GUID" guid="victim-guid" date=20200401` from the file
     co-guid-1-20261004.txt.
   - Minimal fix, in the bridge:
     - (a) A line counts only when its cguid equals the GUID in its file name ("name-" files: its cname equals the name
       in the file name). When the company already has a held GUID (heldGUID), that must match too. Otherwise the line
       is dropped, with one log line per file.
     - (b) A fetched body is used only when its GUID equals the line's guid (when the line has one) and its ALTERID is
       above the company's start point. Otherwise the line goes without a body.
     - (c) Ask nothing for a line whose aid is not above the start point.
   - Test: TestForgedLineDropped.
     - The confirmed case: the forged line is not queued.
     - A line naming an old MasterID with aid below the start point: no FinComVoucherByMaster.

4. MEDIUM. Source B sees FinCom's own postings as foreign changes.
   - Where: recorder_live.go:746-848 (liveSourceB) and jobs.go:756-777 (jobWindow). Nothing tells source B about the
     window.
   - Scenario. After a 3,000-entry posting, the next light check sees ALTVCHID above `seen`. Then:
     - TDSDeskKeepList returns all 3,000 entries. Often that takes more than 2 s, and source B turns itself off after
       every large posting.
     - Otherwise all 3,000 are queued as "created" with no fid, because source B has no narration.
     - The uploader then asks Tally for 3,000 bodies, 50 a request and per date, which means many requests right
       after the posting. It sends FinCom's own entries back as foreign ones.
   - Found by reading the code (not run).
   - Minimal fix:
     - At the end of jobWindow, call liveBAfterWindow(company, a0, a1, vouchersCreated).
     - If the company's B state has seen >= a0, and a1 - a0 == vouchersCreated (nobody else changed anything in the
       window), set seen = a1 and save. Otherwise leave it.
   - Test: TestSourceBSkipsOwnPosting. A 50-entry job, then the light check: no TDSDeskKeepList, or one that returns
     nothing. With one manual entry made during the job, the list is asked.

5. MEDIUM (rule 1). Source B's one request has no size bound and a 60 s limit, and its first request starts from the
   start point.
   - Where: recorder_live.go:759-766 (a new B state starts at startPointOf) and :785 (invokeTally(..., 60)).
   - Scenario:
     - The owner switches a company linked months ago to "alterid". The first request asks for every entry altered
       since the start point, which can be tens of thousands.
     - The 2 s rule turns source B off only after Tally has worked on that list for up to 60 s, or longer, because
       Tally finishes the request after the bridge gives up. Postings waiting meanwhile queue behind it.
   - Found by reading the code.
   - Minimal fix:
     - A new B state starts at the company's current ALTVCHID, which is prospective from the switch. Changes before the
       switch are the gap check's.
     - When v - above > RecorderBMaxSpan (500), ask nothing: set seen = v and log "too many changes for Tally's list
       (n); the gap check closes them".
     - Use a limit of 5 s (RecorderBTimeoutSec) instead of 60 s.
   - Test: TestSourceBBounded. A first switch with 2,000 changes since the start point: no TDSDeskKeepList, and seen is
     the current number. A span of 600: nothing asked. A span of 10: asked.

6. MEDIUM (owner's 2 s rule). Source B comes back on without the owner's switch.
   - Where: recorder_live.go:300-318 (applyRecorderSource treats an answer without recorderSource as "") with
     :1346-1364 (liveBOnAgain: any value other than offBeat turns it on and clears the 60 s spacing). Also :1338
     (offBeat is the raw beat value, "" before the first beat after a restart).
   - Scenario:
     - The owner chose "alterid", and source B turned off with offBeat "alterid".
     - One beat answer without recorderSource arrives (a cloud without migration 47's column, an older deploy, or a dev
       row read without it). source B is on again, with lastAsk cleared, and asks at once at the next light check.
       When the owner's value comes back it is "alterid" again, so nothing turns it off until it is slow again.
     - The same happens when source B turns off before the first beat of a run (offBeat "") and the first beat brings
       the owner's unchanged value.
   - Confirmed: TestScratchSourceBOnByAbsentField. After the turn-off, `applyRecorderSource(M{"ok":true})` logged
     "Source B on again for ZZ TEST: the owner switched ... (the setting)". The next liveSourceB asked TDSDeskKeepList
     again (2 requests).
   - Minimal fix:
     - Call liveBOnAgain only when the answer carries a valid recorderSource.
     - Store offBeat as the effective source in force (recorderSource()).
     - Compare valid values only.
   - Test: extend TestSourceBBackOnOwnerSwitch. An answer without the field, then the same value: still off. A
     turn-off before the first beat, then the owner's same value: still off.

7. MEDIUM (rule 4, nothing lost). Lines in a daily file older than 6 days, and lines the add-on wrote to failed.txt, are
   never read, and nothing says so.
   - Where:
     - recorder_live.go:325-356 (liveFiles: only now-6 .. now+1).
     - FinComRecorder.tdl:121-133 (a line that cannot go to its daily file goes to failed.txt as
       `FCR1|ev=write_failed|file=...|was=<line>`). The bridge never reads failed.txt, and liveSingle would drop
       write_failed anyway.
     - reLiveFile does not match failed.txt.
   - Scenario:
     - The bridge is stopped, the PC is off for a week, or the cloud link is off for more than 7 days. Unsent lines in
       the older files are skipped silently.
     - 2.2.0 is also the first build that opens the file Tally appends to, every second, for each of 7 days per
       company. The trial's watch read file times only. If Tally's OPEN FILE does not share with readers, a save at
       that moment goes to failed.txt and is lost to the bridge.
   - Confirmed: TestScratchOldFileSkipped. A line in a file dated 7 days back was not sent, and the log says nothing.
   - Minimal fix:
     - (a) Read any daily file of the last 31 days whose saved offset is below its size. Put
       `unreadOlder: {files, bytes}` in the beat when one is older still.
     - (b) Read failed.txt like a daily file (offset kept, read-only). Take each write_failed line's `was=` part as the
       line, with the id from failed.txt's own name and offset.
     - (c) In liveReadFile, Lstat first and skip the open when the size equals the offset. The bridge then opens a
       file only after Tally has written to it, which shrinks the collision window to almost nothing.
   - Test: TestLiveOldAndFailedLines. A file 9 days old with an unsent line: sent. failed.txt with a write_failed line:
     its inner line sent once. A file whose size is unchanged: not opened (readSharedHold not called).

8. MEDIUM (rule 5). The daily file name rests on an unverified construct. If Tally gives another form, every line is
   written where the bridge never looks.
   - Where: FinComRecorder.tdl:46 (`FCRDay : $$String:$$MachineDate:"UniversalDate"`, marked "candidate"; the header
     says "NOT RUN ON A REAL TALLY") with recorder_live.go:321 (only yyyymmdd or yyyy-mm-dd).
   - Scenario: the format name in quotes is not taken, or it gives "4-Oct-2026" or an empty text. The add-on then
     writes `<GUID>-4-Oct-2026.txt` or `<GUID>-.txt`. Source A sees nothing and says nothing, while the owner believes
     recording is on.
   - Minimal fix:
     - (a) Before 2.2.0 ships, add a step to recorder-live-sheet.txt: save one voucher, open
       C:\ProgramData\FinCom\recorder\, and check the new file's name ends in today's yyyymmdd.
     - (b) In the bridge: when the recorder folder has a .txt changed in the last day whose name starts with a held
       company GUID but does not match reLiveFile, log it once a day and put `liveNameMismatch` in the beat.
   - Test: a file `co-guid-1-4-Oct-2026.txt`: one log line and the beat flag.

9. LOW. A body fetch that fails once is never tried again, so lines go permanently without a body.
   - Where: recorder_live.go:952-967 and :1000-1003. failed() sets bodyTried for a closed Tally, a probe hold, a read
     stop or a timeout. needsBody (:84-95) also skips a voucher whose vchDate normDate cannot read (for example
     "4-10-2026"), with no log line.
   - Effect: the cloud holds the line "until a body comes", but nothing asks again. The entry waits for a Day Book
     upload.
   - Minimal fix:
     - For errReadStopped, errBackoff and a probe hold, leave bodyTried false (treated like gaveWay).
     - Allow 3 tries in all.
     - Log once per company when vchDate is empty for a voucher event.

10. LOW. A voucher created across midnight is sent as "altered".
    - Where: recorder_live.go:527-538. live.pending is keyed by file, and the pre and post halves land in two daily
      files.
    - Effect: the post is mapped alone as "altered", and the pre (with no GUID) is dropped after 10 s.
    - Minimal fix: key pending by company GUID (the file name's GUID part), not by file.

11. LOW (rule 4, memory). The queue is bounded by count, not bytes.
    - Where: recorder_live.go:55 and :381.
    - Effect: 20,000 changes, each with a narration of up to about 1 MB (a logical line just under liveReadMax). A
      single change larger than 1 MB is sent alone (:1176), above liveMaxBytes.
    - Minimal fix: cut narr to 4,000 runes at liveEmit (the cloud reads 1,000), and keep a byte budget, for example
      32 MB of narr + xml, beside liveQueueMax.

12. LOW. "20 s at most" for the body fetch is checked only before each request.
    - Where: recorder_live.go:949 and :988. Each request has its own 20 s limit (:891), so a fetch can take almost
      40 s.
    - Minimal fix: give each request the time left until the deadline (at least 2 s).

13. LOW. The bridge's own state grows for the whole run, or forever.
    - Where: live.sent (all ids sent in this run, never pruned) and live.files. live.files gains a key per company per
      day, is saved to recorder-offsets.json, and is never dropped.
    - Minimal fix: at save, drop files entries older than 8 days that have nothing queued, and rebuild live.sent from
      disk once a day.

14. LOW. The busy log is written every second.
    - Where: shared.go:36-41. readSharedFrom passes busyLog=true.
    - Effect: a daily file held by another program logs "Recorder trial: recorder file busy, read later" once per file
      per second. It also says "trial".
    - Minimal fix: busyLog false, plus one "busy" line per file per 10 minutes from liveReadFile.

15. LOW (rule 5, Tally's own time). The add-on writes lines the bridge throws away.
    - Where: FinComRecorder.tdl:51-58. Each of these is an open, write and close inside Tally's save or import path:
      before_delete, before_cancel, start_import and end_import. They are dropped at liveSingle (:565).
    - Minimal fix: drop those four events from the add-on, and keep import_object and after_import_object (the pair is
      needed for created or altered masters). This saves a quarter to a half of the add-on's work on deletes, cancels
      and imports.

16. LOW. The posting window can be wrong around a slow or waiting job.
    - Where: jobs.go:510-512 and :756-777.
    - a0 is read before the job waits for tallyWriter, so another job's entries fall inside this window.
    - When the last import ended in "no answer", Tally may still be importing. Either the a1 check waits behind it
      (probe hold, so no window) or a1 is read too low.
    - Minimal fix: read a0 after taking tallyWriter (one more FinComCompany, outside any import). Send no window when
      the last outcome is unknown.

17. LOW. A company name in the file path in the add-on.
    - Where: FinComRecorder.tdl:89-94. Without a company GUID, the file is "name-" + ##SVCurrentCompany.
    - Effect: a name with \ / : * ? makes the open fail, and the line goes to failed.txt (finding 7). A name with "..\"
      writes outside recorder\.
    - Minimal fix: when there is no GUID, write to failed.txt directly, or use $$String:$Guid:Company only.

18. LOW. A test rewrites a repo file on every run.
    - Where: recorder_live_test.go:793-799. TestRecorderLinesFixture writes tests/fixtures/recorder-lines-2.2.0.json
      whenever it differs, and the request carries the machine-dependent bridge id (go-<hash>).
    - Effect: every run on another machine dirties the tree, and a real change to the request shape is written over,
      never caught.
    - Minimal fix: mask bridge.id before comparing, fail on a difference, and write only under FINCOM_WRITE_FIXTURES=1.

Verdict:
- Two High.
  - Finding 1 must be fixed before building. It sends unlinked companies' entries off the computer, and it can stop
    the recorder for every company.
  - Finding 2 must be fixed before building. It is the owner's rule 6, and a bad kept program leaves the bridge down
    with no way back.
- Findings 3 to 8 are Medium. Fix 3, 6 and 7 with the Highs: each is a few lines, and each is an owner's rule (2, the
  2 s switch-off, nothing lost). Finding 8 needs only the sheet step before the add-on reaches a real Tally.
- Findings 4 and 5 may follow, but before source B is offered to any owner.
- Findings 9 to 18 are Low and may wait.

Range: bdfe261..3fbc965
