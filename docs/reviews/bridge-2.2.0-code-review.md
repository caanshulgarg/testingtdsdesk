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


## Status after the fixes (04-Oct-2026, by the builder; each test written first, red runs in the session's tdd/b221.*.red)

1. HIGH, Fixed (TestUnlinkedCompanyNoBodyNoStall, TestLiveQueueCapPerCompany). Before any body is asked of Tally or any
   line of a company is sent, the uploader asks the cloud whether the company is linked with an empty recorder_lines call
   (`lines: []`: nothing of the company leaves the computer). A 409 notLinked (then, or on any later call) marks the
   company not linked for an hour: its waiting lines leave the queue, new lines are counted and skipped (the offset
   moves on), nothing is fetched or sent; the beat's recorderState says `notLinked: true, skipped: N, words: "not
   linked: N lines skipped"`; after an hour it is asked again. The queue cap is per company GUID (RecorderQueueMax,
   5,000): a company at its cap stops only its own file. Left: re-checking when the beat's company list changes (that
   list names only open or kept companies; the hourly re-check covers every company).
2. HIGH, Fixed (TestRollbackVerifiesKeptVersion, TestRecorderRollbackAfterSetup). The SHA-256 of the replaced program is
   recorded while it is the running one (update-pending.json at the update; at a setup install the setup copies the
   program it replaces to FinComBridge.previous.exe and the install step records its SHA-256 and the version the
   registry held). The rollback refuses with words when the kept program's SHA-256 differs or was never recorded, and
   checks the code signature when RequireSignedUpdates is on. It is set up as an update: the running program goes to
   FinComBridge.old.exe with update-pending.json {from: 2.2.0}, so undoFailedUpdate puts it back if the previous one
   does not start (a copy also stays as FinComBridge.rolledback.exe).
3. MEDIUM, Fixed (TestForgedLineDropped). A line counts only when its cguid starts its file's name (failed.txt: the
   file the add-on meant) and, when the company has a held GUID, equals it; otherwise it is dropped with one log line
   per file and GUID. An "FCR1|" physical line after a line still open (its t1 not yet written: a narration over
   several lines) starts a new line only when it is of the file's own company with a t0 not before the open line's;
   else it is narration text. Nothing is asked for an entry whose AlterID is at or below the starting point, and a
   fetched body is used only when its GUID is the line's and its ALTERID is above the starting point. Limit kept: a
   Tally user of the same company can still write a same-company line with a later t0 into a narration (no more than
   that user can do in Tally itself); the recorder folder's ACL (Users may add files) stays by design (Tally runs as
   the user).
4. MEDIUM, Fixed (TestSourceBSkipsOwnPosting). A posting window in which ALTVCHID rose by exactly the entries the job
   created is FinCom's own: sources B and C move past it and skip its AlterIDs, and no request is made for it. Left:
   skipping by "TDSDesk:" in the narration (source B's list carries no narration; adding it would enlarge the request).
5. MEDIUM, Fixed (TestSourceBBounded). Source B starts at max(starting point, highest AlterID received from the
   add-on); a rise above 500 is not asked ("too many changes for Source B (N); the gap check and Day Book cover them");
   the request's limit is 5 s (RecorderBTimeoutSec).
6. MEDIUM, Fixed (TestSourceBNeverBackWithoutOwner, TestSourceBBackOnOwnerSwitch). Only a present, valid recorderSource
   counts; an answer without it keeps the owner's last choice, which is kept on disk (sync\recorder-source.json) and
   survives a restart; the off state stores the source in force (not the raw answer) and is persisted; the spacing is
   persisted.
7. MEDIUM, Fixed (TestLiveOldAndFailedLines). Daily files up to 31 days old are read when they hold bytes not read;
   failed.txt is read (each write_failed line's inner line, checked against the file it was meant for); a file is
   opened only when its size grew. Left: an `unreadOlder` beat flag (the beat lists the files read, recorderFiles).
8. MEDIUM, Fixed (TestLiveOtherNameForms). The reader takes every <GUID>-<anything>.txt (a line counts only in its own
   GUID's file), the beat lists the file names read (recorderFiles), the TDL comment names the fallback, and
   docs/recorder-live-sheet.txt PART 1 has the step "check the new file's name ends in today's yyyymmdd".
9. LOW, Fixed in part: a body fetch refused for a passing reason (reading stopped, Tally left alone) is tried again, 3
   times at most. Left: a log line for an empty vchDate.
10. LOW, Fixed (TestLiveLowsPairAndNarration): the pairs are kept per company GUID, so a save across midnight pairs.
11. LOW, Fixed (TestLiveLowsPairAndNarration): the narration is cut at 4,000 characters; with the per-company cap this
    bounds memory. Left: a separate byte budget.
12. LOW, Fixed: each body request gets the time left of the 20 s (at least 2 s).
13. LOW, Left: the run's own maps (sent ids, files) are rebuilt at each restart; the files map is bounded by 31 days of
    files read.
14. LOW, Fixed: readSharedFrom no longer logs a held file; the reader says "held by another program" once per file in
    10 minutes, without the word "trial".
15. LOW, Left: the brief requires the trial's events in the live add-on (the trial measures their cost); dropping
    before_* and start/end_import is for after the trial's numbers.
16. LOW, Fixed in part: no posting window when the job's last request had no answer from Tally. Left: reading a0 after
    the writer lock (one more FinComCompany read per job).
17. LOW, Fixed: without a company GUID the add-on writes to "noguid-<date>.txt", never a name in a path; the line keeps
    cname.
18. LOW, Fixed (TestRecorderLinesFixture): the bridge identity in the fixture is fixed; the test compares and fails on
    a difference; it writes only with FINCOM_WRITE_FIXTURES=1.


## Round 2 (3fbc965..0b43d34)

Reviewed: 04-Oct-2026, by the reviewer in the Claude Code session. I read git diff 3fbc965 0b43d34 -- bridge-go/
docs/tally-allowlist.md (22 files: the review fixes, and the new recorder_probes.go with the date-form and Edit Log
probes and source C's month slices, the rollback set up as an update, the setup keeping the previous program, the second
ReadDays-off exception FinComSlice, and TestNoComputedFigure allowing $$Date and $$IsBetween). I read the code from a
clean worktree of 0b43d34, not the working tree. Where the cloud matters I read server/tally-cloud/index.ts and
migration-47 at 0b43d34.

Checks (clean worktree of 0b43d34):
- `go vet ./...` and `GOOS=windows go vet ./...`: clean.
- `go test -count=1 ./...`: ok (393 s). The tree stayed clean (the fixture is no longer rewritten).
- Two throwaway tests (zz_scratch_r2_test.go) confirmed R2-2 and R2-3. The file was deleted and the worktree removed;
  nothing was added to the repo.

### Round 1 findings: is each "Fixed" claim true?

| # | Claim | Verdict | Notes |
|---|---|---|---|
| 1 H | Fixed | Confirmed | liveUploadStep (recorder_live.go:1482) sends an empty recorder_lines call before any body is asked or any line sent; the cloud runs bookFor before it looks at lines, so `lines: []` gets 409 notLinked or 200. A 409 drops the queue and skips for an hour (liveNotLinked :1471, liveEmit). The cap is per GUID (RecorderQueueMax 5,000). |
| 2 H | Fixed | Confirmed for the update path; see R2-4 for the setup path | rollbackPreview checks the SHA-256 recorded at the update (update-pending.json, written by applyUpdate while the program was running) and the signature under RequireSignedUpdates. rollBackBridge sets old.exe and update-pending.json {from, rollback}, so undoFailedUpdate can undo it. Lows R2-7 and R2-8 remain. |
| 3 M | Fixed | Not fixed for failed.txt | Fixed for daily files: own-file check, held GUID, no fetch at or below the start point, body checked by GUID and ALTERID. In failed.txt the file-name check is skipped (recorder_live.go:683), and the `file=` it compares against is taken from the line itself (:563-570, :665-676). See R2-3 (confirmed). |
| 4 M | Fixed | Confirmed | jobWindow calls liveAfterWindow (jobs.go:781). A clean window moves B and C past it, and liveInWindow skips its AlterIDs. |
| 5 M | Fixed | Confirmed for source B; source C repeats the problem | B starts at max(start point, highest add-on AlterID), skips a rise above 500, and has a 5 s limit (:1028). Source C has none of these (R2-1). |
| 6 M | Fixed | Confirmed | Only a present, valid value counts. The owner's value is kept in sync\recorder-source.json. Off states store recorderSource() and are persisted in recorder-offsets.json "off". |
| 7 M | Fixed | Confirmed | Files up to 31 days old with unread bytes are read, failed.txt is read, and a file is opened only when it grew. (failed.txt opens the hole in R2-3.) |
| 8 M | Fixed | Confirmed | Any `<x>-<anything>.txt` is read, recorderFiles is in the beat, and the sheet step exists. |
| 9 L | Fixed in part | Confirmed (in part) | The 3 retries for a passing reason are there. There is still no log line for an empty vchDate. |
| 10 L | Fixed | Confirmed | pending is keyed by CGUID. |
| 11 L | Fixed | Confirmed | liveNarrMax 4,000. |
| 12 L | Fixed | Confirmed | left() gives the time remaining, at least 2 s. |
| 13 L | Left | Left | |
| 14 L | Fixed | Confirmed | busyLog false; "held" logged once in 10 min. |
| 15 L | Left | Left | |
| 16 L | Fixed in part | Confirmed (in part) | No window after a noAnswer note (jobs.go:761). a0 is still read before the writer lock. |
| 17 L | Fixed | Confirmed | "noguid" (FinComRecorder.tdl:94). |
| 18 L | Fixed | Confirmed | The fixed identity; writes only with FINCOM_WRITE_FIXTURES=1. A full run left the tree clean. |

What holds in the new code (checked, no finding):
- Every new request has a timer and a time limit: FinComSlice 60 s (see R2-1), the probes 60 s, and the body fetch at
  most the time left of its 20 s. invokeTally calls `timed` on every outcome except a preemption (tally.go:741), and a
  timeout counts as "took 60 s". So the 2 s switch-off fires for B, C and the body fetch, is saved in
  recorder-offsets.json "off", and comes back only on an owner's different, valid value (liveOnAgain).
- Source C asks only when ALTVCHID rose above `seen` and no round is open. It asks one month at a time, at least 60 s
  apart, never while postingGoing or importsInFlight, and it yields to both. Each request is filtered by
  `$AlterID > seen` (seen starts at the starting point). An answer dated outside the month is not used.
- FinComSlice passes the dated guard only as an exact rebuild of sliceRequest, in the form kept for that company (see
  R2-2 for which values it admits). FinComVoucherByMaster's guard is unchanged.
- The probes are measure-only and run from the person-started read test (readTestTC, person:true). The Edit Log probe
  logs tag names only (first 300 characters), never content. tallyProgram reads file metadata only.
- The add-on: still no company-name check, one append per event, no Message, Query or loop, and failed.txt tried once.
  "noguid" replaces the name in the path.
- /tray/rollback is unchanged: refused from a web page, needs the key and POST, and confirm:true after a preview.

### Findings, round 2 (by severity)

R2-1. MEDIUM (rule 1, bounded and timed; the same as round 1's M5, for source C). Source C's first round runs from the
starting point with no limit on the span, and its request has a 60 s limit.
- Where: recorder_probes.go:381-389 (a new C state starts at `seen = startPointOf`, not at max(start point, highest
  add-on AlterID, ALTVCHID at the switch)), :406-407 (round target v from that seen, no RecorderBMaxSpan check), and :415
  (invokeTally(..., 60)).
- Scenario:
  - The owner switches a company linked months ago to "both" (which is now add-on plus slices, see R2-5).
  - The first FinComSlice asks for this month's entries altered since the starting point, then the month before, and so
    on. Each answer can hold thousands of entries.
  - Tally can work up to 60 s on one request, longer than the bridge waits, before the 2 s rule turns C off.
  - Everything found is queued as "altered"/"created" with no fid, and the uploader then asks Tally for every body,
    50 per request, per date. That comes close to reading back everything changed since the starting point.
- Fix (as for B):
  - Start a new C state at max(starting point, live.high[key], the current ALTVCHID when the owner switched).
  - When target - from > RecorderBMaxSpan (500), ask nothing. Set seen = target and log "too many changes for Source C
    (N); the gap check and Day Book cover them".
  - Use keepNum("RecorderBTimeoutSec", 5) for the slice.
- Test: TestSourceCBounded. A first switch with 2,000 changes since the starting point asks no FinComSlice and sets seen
  to the current number. A span of 600 asks nothing; a span of 10 asks. The request carries a 5 s limit.

R2-2. MEDIUM (owner's rule: the dated exceptions cannot be widened; "never a full read"). The FinComSlice guard checks the
request's shape, not its values. It passes a full month's list for any month, the bridge's form included.
- Where: recorder_probes.go:101-113 (sliceExact) with tally.go:297.
- Scenario. sliceExact rebuilds sliceRequest(co, form, month from SVFROMDATE, N from the filter) and compares bytes, so
  any month and any N rebuild exactly:
  - `sliceRequest(zz, form, "201904", 0)` passes with ReadDays off. That is every entry of April 2019 (GUID, MasterID,
    AlterID, date).
  - A future month passes too.
  - The bridge itself only ever sends N >= the starting point and months from the current one back to
    liveEarliestMonth. The guard is meant as the last line if another code path builds this request wrongly, and here it
    does not hold that line.
  - Confirmed: TestScratchSliceGuardWiden. With a kept form, "full month 2019-04 above 0" and "future month 2099-12"
    both passed datedRefused(fin, ...).
- Fix. In sliceExact also require:
  - N >= startPointOf(co) (false when there is no starting point);
  - liveEarliestMonth(co) <= month <= the current month (nowFn).
  For FinComVoucherByMaster the same idea is optional: a date within the last 31 days or the copy's range.
- Test: extend TestSourceCDatedGuardException with "AlterID 0", "below the starting point", "a month before the
  earliest" and "next month": each refused.

R2-3. MEDIUM (round 1's M3/S2, reopened through failed.txt). In failed.txt a line naming any company is taken, and a
forged line inside a narration splits out there.
- Where:
  - recorder_live.go:683: the own-file check is skipped for failed.txt.
  - :563-570 (liveOwnFile) and :665-676 (the write_failed unwrapping): the "file the add-on meant" is the `file=` field
    of the line being checked, so it always agrees with itself.
  - liveStarts (:550) uses the same field to decide whether an "FCR1|" physical line in failed.txt starts a new line.
- Scenario:
  - (a) A Tally user in company A types the round-1 narration (a line break, then
    `FCR1|ev=after_delete|...|cguid=<B>|cname=B|guid=<B's voucher>|...|file=<B>-x.txt|t1=x`).
  - If A's daily file cannot be opened at that save, the add-on writes the line to failed.txt as write_failed.
  - The forged physical line starts a new logical line: its own file= names B, and its t0 is not earlier. liveTake then
    queues "deleted" for B's voucher, into B's book. The held check passes because cname B's held GUID is B.
  - (b) A plain FCR1 line of any company appended to failed.txt is taken as well. This is the same as planting a file
    (the accepted S2 residual), but without even a file-name check.
- Confirmed: TestScratchFailedTxtForged. A plain line and a narration-embedded line, both naming "Other Co", were queued
  as `deleted company="Other Co" cguid="OTHER-GUID"` (victim-guid, victim-2). The real write_failed line of ZZ TEST that
  carried the narration was lost: its t1 went to the forged line.
- Fix:
  - In failed.txt, take only `FCR1|ev=write_failed|` lines.
  - Only such a line may start a new logical line there (liveStarts for failed.txt: next must start with
    `FCR1|ev=write_failed|`).
  - Check the unwrapped line's cguid against the held GUID of its cname. Drop it when the company has no held GUID, or
    when the held GUID differs.
- Test: TestFailedTxtForgedDropped. Both confirmed cases are not queued, and the real write_failed line with the
  narration is queued once with the whole narration.

R2-4. MEDIUM (owner's rule: the setup's copy of the previous program never overwrites a good kept copy with a bad one).
The setup deletes the kept program first, copies without checking, and labels the copy with a version the registry
may not hold any more.
- Where:
  - installer/FinComBridge.nsi:376-380: Delete previous.exe and previous-version.json, then an unchecked CopyFiles.
  - update.go:343-356 (notePreviousFromSetup): it hashes whatever the copy produced; when the version is the same it
    deletes the copy.
  - win_service.go:412-413 and win_user.go:419-420: `was` is the registry Version, which only an install writes. An
    automatic update (applyUpdate) never updates it.
- Scenarios:
  - (a) A stale label. Setup 2.2.0, then automatic update to 2.2.1 (the registry still says 2.2.0, and previous.exe is
    a verified 2.2.0). Then the owner runs the 2.2.1 setup to repair.
    - The setup deletes the good 2.2.0 copy and copies 2.2.1.
    - notePreviousFromSetup sees "2.2.0" != "2.2.1" and records the 2.2.1 copy as "2.2.0".
    - The tray offers "Roll back from 2.2.1 to 2.2.0". It puts 2.2.1 back and sets NoAutoUpdate.
  - (b) A same-version reinstall whose registry is current deletes the kept 2.1.10 (or whatever the update kept). Its
    rollback is gone.
  - (c) A partial copy (disk full, antivirus) is hashed and recorded as good. A program that cannot start never runs
    undoFailedUpdate, so the rollback leaves the bridge down: round 1's H2 again, by the setup path.
- Fix:
  - In NSIS, copy to FinComBridge.previous.new, and check the error flag and the size against FinComBridge.exe.
  - Keep FinComBridge.setup-old.exe until the install step instead of deleting it at :388.
  - In notePreviousFromSetup:
    - accept previous.new only when its SHA-256 equals setup-old.exe's;
    - treat it as "the same version" when that SHA-256 equals the new FinComBridge.exe's (do not trust the registry);
    - only then replace previous.exe and previous-version.json;
    - otherwise keep the existing pair untouched.
  - Better still, read the version from the replaced program itself (its file version resource, or
    `setup-old.exe version`).
  - Also write the registry Version after an update has run well (updateHealth).
- Test: TestSetupKeepsGoodPrevious.
  - A kept, verified previous plus a setup of the same bytes: the pair is unchanged.
  - A truncated copy: refused, and the old pair kept.
  - A stale registry version with identical bytes: no copy recorded.

R2-5. LOW (contract). "both" changed meaning, and the cloud was not changed with it.
- Where: recorder_live.go:353-356 (sourceHas: "both" is now the add-on plus slices, and no longer includes alterid) and
  :167 (validSource adds "slices").
- At 0b43d34 the cloud's migration 47 check and index.ts:1727 still allow only addon, alterid and both, and they
  describe both as "addon + alterid".
- Effect:
  - An owner who picks "both" in FinCom, meaning add-on and Tally's change list, gets source C instead of B.
  - "slices" alone can never arrive from the cloud.
  - Source C is still off unless the read test kept a form.
- Fix: add 'slices' to the migration-47 check, to tally_device_recorder_source and to index.ts. Write in both places
  what "both" means.

R2-6. LOW. The read test's collection forms send 7 requests, each up to 60 s, with no early stop.
- Where: recorder_probes.go:190-212.
- A form that Tally answers while ignoring SVFROMDATE/SVTODATE returns the current period's GUID, MasterID, AlterID
  and date for every entry: a year's heads. It is measure-only and person-started, but the 2 s spirit applies.
- Fix: after an answer over 2 s, or one with more than 4 x the month's entries, log it and skip the remaining
  SV-variable forms. The filter forms carry their own bound.

R2-7. LOW. After rolling back to a 2.2.0-or-later build, that build's updateHealth keeps the newer build it was rolled
back from as "the previous version".
- Where: win_service.go:129-132 with update.go:266.
- rollBackBridge's update-pending.json carries rollback:true, but keepPreviousVersion ignores it.
- Effect: the tray then offers "Roll back ... to 2.2.1", which is the version just left, while NoAutoUpdate is on.
- Fix: when pending.rollback is true, do not keep old.exe as previous; remove it and say so in the log.

R2-8. LOW. The rollback checks the hash of the file at one moment and moves the file at another.
- Where: update.go:284-324. rollbackPreview hashes previous.exe, and rollBackBridge renames it later by path.
- This matters only for the per-user install, whose folder the user can write.
- Fix: rename previous.exe to a private name first, hash that file, and move it into place only if it matches.

R2-9. LOW. The 60 s spacing is not saved when a request fails.
- Where: recorder_probes.go:411 and recorder_live.go:1024. lastAsk is set in memory before the request, and
  liveSaveOffsets runs only after a success or a switch-off.
- Effect: a restart within 60 s of a timeout asks again at once.
- Fix: call liveSaveOffsets right after setting lastAsk.

R2-10. LOW. Source C's round rarely ends early.
- Where: recorder_probes.go:437-458.
- ALTVCHID rises on every alteration and deletion, but `found` counts only distinct latest AlterIDs. Most rounds
  therefore walk back to liveEarliestMonth, which is the copy's earliest month (often years back), not the starting
  point's earliest month. That means one request a minute for many minutes after each change.
- Fix: bound the walk to the month of the starting point's date (or 12 months), and log when the rise is not
  accounted for.

R2-11. LOW. The kept date form is keyed by tallyProgram().
- Where: recorder_probes.go:118-139.
- The key is "not known" when tally.exe is outside Program Files (C:\TallyPrime is common), or when the service cannot
  see its path. When the key changes, the form is silently "none" and source C stops (it logs once). sliceExact also
  lists processes on every FinComSlice.
- Fix: key by company only, and record the program as data. Re-run the probe when the program changes.

R2-12. LOW (no computed figures). TestNoComputedFigure exempts $$Date and $$IsBetween by name, in any position and with
any argument.
- Where: allowlist_test.go:197-201.
- Nothing computed slips through today: $$Date:$$X is still caught on $$X, and closing/opening balances are caught by
  name. But `$$Date:@@F`, or $$IsBetween over any field, would pass unseen.
- Fix: exempt only the exact shapes `$$Date:&#34;d-MMM-yyyy&#34;` and
  `$$IsBetween:$Date:$$Date:&#34;…&#34;:$$Date:&#34;…&#34;` (strip those, then run the $$ check), and only inside a
  `<SYSTEM TYPE="Formulae">`.

Verdict, round 2:
- No High.
- Four Medium: R2-1, R2-2, R2-3 and R2-4. Each is an owner's rule (bounded requests; exceptions not widened; forged
  lines; no bad kept copy), and each fix is small. They block the build.
- R2-5 to R2-12 are Low. R2-5 should go with the cloud's next deploy, before anyone is offered "both".


### Status after the round 2 fixes (by the builder; tests first, red runs tdd/b222.1.red (compile) and b222.2.red)

- R2-1 MEDIUM, Fixed (TestSourceCBounded, TestSourceCStartsAtSwitch): a new source C state starts at max(starting
  point, the add-on's highest AlterID, ALTVCHID at the switch); a rise above 500 is not asked ("too many changes for
  Source C (N); the gap check and Day Book cover them"); the request's limit is 5 s; the walk back stops at the starting
  point's month (also R2-10).
- R2-2 MEDIUM, Fixed (TestSourceCDatedGuardException: "2019-04 above 0", "2099-12", "AlterID 0", "below the starting
  point", "before the starting point", "next month" refused): sliceExact also requires a starting point, the AlterID at
  or above it, and the month between the starting point's month and the current month.
- R2-3 MEDIUM, Fixed (TestFailedTxtForgedDropped, TestLiveOldAndFailedLines): in failed.txt only a write_failed line
  starts a line, never inside one still open, and never after a line that ran over several physical lines (a narration
  can hold a whole forged line with its t1; a genuine failed line after such a one is then read as its narration: a lost
  line there rather than a forged one); a plain FCR1 line there is passed over; the unwrapped line is taken only when its
  GUID is the GUID held for its company name (none held: not taken). Left (as round 1's S2 residual): a whole
  write_failed line written into failed.txt by someone with write access to the folder, naming a held company, is
  indistinguishable from the add-on's.
- R2-4 MEDIUM, Fixed (TestSetupKeepsGoodPrevious, source inspection of the NSIS order): the setup copies the program
  to FinComBridge.previous.new before replacing it, deletes no kept pair, and keeps FinComBridge.setup-old.exe for the
  install step; notePreviousFromSetup takes the copy only when its SHA-256 equals setup-old.exe's, it is not the program
  now installed (a reinstall keeps the kept pair), and the replaced program's own version answers ("FinComBridge.exe
  version", 10 s; the registry Version is no longer used); only then the pair is replaced; both temporary files go.
- R2-5 LOW, Fixed in the bridge (TestSourceCNeedsCalibratedForm): "both" is the add-on and Tally's change list, as the
  cloud means; month slices are the setting RecorderSlices only (default off); a "slices" value from the cloud is
  ignored. The cloud's text is unchanged (it already says add-on + alterid).
- R2-6 LOW, Fixed (TestReadTestFormsStopEarly): after an answer over 4 times the month's entries or over 2 s, the
  remaining static-variable forms are not tried; the filter forms still are.
- R2-7 LOW, Fixed (TestRollbackNotKeptAsPrevious): after a rollback the version rolled back from is not kept.
- R2-8 LOW, Fixed (TestRollbackVerifiesKeptVersion): the kept program is moved to a private name, hashed there, and put
  in place only if it matches (moved back otherwise).
- R2-9 LOW, Fixed (TestSourceBSpacingSavedOnFailure): the spacing is saved right after it is set, for B and C.
- R2-10 LOW, Fixed with R2-1.
- R2-11 LOW, Fixed: the kept form is keyed by company; the Tally program is recorded with it as data; the guard no
  longer lists processes. Left: re-running the probe when the program changes (the owner runs the read test).
- R2-12 LOW, Fixed (TestNoComputedFigureShapes): only the exact literal and comparison shapes inside a Formulae block
  are taken out before the $$ check.

Range: bdfe261..0b43d34
