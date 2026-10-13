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

## Round 3 (0b43d34..41edc65)

Reviewed: 04-Oct-2026, by the reviewer in the Claude Code session. I read git diff 0b43d34 41edc65 -- bridge-go/ (11
files: recorder_live.go, recorder_probes.go, update.go, win_service.go, win_user.go, installer/FinComBridge.nsi,
allowlist_test.go, the tests, and a new tracked bridge-go/tds-bridge.log) from a clean worktree of 41edc65.

Checks (clean worktree of 41edc65):
- `go vet ./...` and `GOOS=windows go vet ./...`: clean.
- `go test -count=1 ./...`: ok (423 s). The tree did not stay clean: the run appended 4 lines to the tracked
  bridge-go/tds-bridge.log (R3-2).
- One throwaway test (zz_scratch_r3_test.go, in a second worktree) confirmed R3-1. It was deleted with the worktree;
  nothing was added to the repo.

### Round 2 findings: is each "Fixed" claim true?

| # | Claim | Verdict | Notes |
|---|---|---|---|
| R2-1 M | Fixed | Confirmed | A new C state starts at max(starting point, live.high[key], ALTVCHID now) (recorder_probes.go:426-436), so nothing before the switch is asked. A rise above RecorderBMaxSpan (500) asks nothing, sets seen = v, logs "too many changes for Source C (N)…" and saves (:453-460). The slice has keepNum("RecorderBTimeoutSec", 5) (:471). The walk back stops at the starting point's month (liveEarliestMonth, R2-10). |
| R2-2 M | Fixed | Not fixed for the filter-only form | sliceExact now needs a starting point, N >= it, and the month between the starting point's month and now (:116-122). For the static-variable forms (and collFilterGE/collFilterBtw, which also carry SVFROMDATE) all six named bypasses are refused. But datedRefused (tally.go:294) returns nil before sliceExact for any request without `<SVFROMDATE`/`<SVTODATE`, and collFilterOnly carries none: the new `$$Date` fallback in sliceExact is never reached. See R3-1 (confirmed). |
| R2-3 M | Fixed | Confirmed | In failed.txt only `FCR1|ev=write_failed|` starts a line, and only when nothing is open (liveStarts :556-562); a plain FCR1 line there is passed over (liveLogical :664-673); a line over several physical lines is never complete before the file's end (`single`, :650). The unwrapped line is taken only when its cguid starts the outer file= and equals heldGUID(its cname) (liveTake :708-713). The add-on writes `file=` before `|was=` (FinComRecorder.tdl:126), so the outer file= is the first match. The accepted residual (a whole write_failed line planted by someone who can write the folder, for a held company) is as stated. |
| R2-4 M | Fixed | Confirmed (code); the `version` call wants a Windows check | The setup copies to FinComBridge.previous.new before the rename, deletes no kept pair, and keeps setup-old.exe (FinComBridge.nsi:374-390). notePreviousFromSetup (update.go:383-408) takes the copy only when its SHA-256 equals setup-old.exe's, it is not the program now installed, and `setup-old.exe version` answers a version that is not BridgeVersion; the registry is no longer read (win_service.go:412, win_user.go:419). Both temporary files go (defer). 2.1.10 answers `version` with fmt.Println(BridgeVersion) after attachConsole, which keeps an inherited stdout handle; Windows CI should show "Install: FinCom Bridge 2.1.10 is kept …" in the install log of a 2.1.10 -> 2.2.0 setup. |
| R2-5 L | Fixed in the bridge | Confirmed | validSource is addon/alterid/both; sourceHas: "both" = addon + alterid (source B), "slices" only from the setting RecorderSlices (default off, local config only). |
| R2-6 L | Fixed | Confirmed | svStop after an answer over 4 x the month's entries or over liveLimitSec(); the filter forms are still tried. |
| R2-7 L | Fixed | Confirmed | keepPreviousVersion: update-pending.json rollback:true removes old.exe and logs; nothing is kept as previous. |
| R2-8 L | Fixed | Confirmed | previous.exe is renamed to FinComBridge.rollback-check.exe, hashed there, and renamed back on a mismatch or on either later failure. The name is in the same folder (not private from the per-user install's own user, who can run anything anyway). The RequireSignedUpdates check is still on previous.exe at the preview; the same SHA-256 means the same bytes. |
| R2-9 L | Fixed | Confirmed | liveSaveOffsets right after lastAsk, in B (:1063) and C (:468). |
| R2-10 L | Fixed with R2-1 | Confirmed | liveEarliestMonth is the starting point's month (or this month), never before booksFrom. An entry dated before that month and altered later is not found by C; the gap check covers it (prospective by design). |
| R2-11 L | Fixed | Confirmed | Kept per company; the program is recorded as data; sliceExact no longer lists processes. |
| R2-12 L | Fixed | Confirmed | Only `$$Date:"d-MMM-yyyy"` and `$$IsBetween:$Date:<lit>:<lit>`, inside `<SYSTEM TYPE="Formulae">`, are taken out before the $$ check. |

What holds in the new code (checked, no finding):
- Lock order: startPointMonth takes guidMu then spMu, as startPointOf does; it runs under live.mu only where
  startPointOf already did (liveSourceC), and from sliceExact after live.mu is released. No spMu holder takes live.mu.
- liveStarts for daily files: `open == ""` returns true, which is what the old `cur == nil || done` short-cut did.
- The rollback's error paths put previous.exe back; the success path is unchanged (old.exe, update-pending.json
  rollback:true, NoAutoUpdate).
- The uninstaller removes previous.new, setup-old.exe and rollback-check.exe.

### Findings, round 3 (by severity)

R3-1. MEDIUM (owner's rule: the dated exceptions cannot be widened; R2-2 not fixed for one kept form). When the read
test keeps collFilterOnly, the FinComSlice guard does not run at all.
- Where: tally.go:294-296 (datedRefused returns nil when the request has no `<SVFROMDATE` and no `<SVTODATE`) with
  recorder_probes.go:61-62 and :68-70 (formCollection: collFilterOnly puts the period only in the filter, with no static
  variables) and :108-112 (sliceExact's new `$$Date` fallback, unreachable for that form).
- Scenario:
  - On a Tally where the six earlier forms do not answer the month exactly, the read test keeps collFilterOnly (it is
    in collForms and dateFormFor returns it).
  - Any FinComSlice in that form then passes datedRefused with ReadDays off, whatever its month and AlterID:
    sliceRequest(zz, collFilterOnly, "201904", 0), "209912", and "AlterID 0" for this month (a full month's list of
    GUID, MasterID, AlterID and date).
  - More widely, any request whose period is only in a `$Date` / `$$IsBetween` filter is not seen as dated by the
    guard.
  - Today only liveSourceC builds the slice, with safe values, so this is the same exposure R2-2 was rated for: the
    guard is the rule's enforcement and would not stop a wrong caller.
- Confirmed: TestScratchR3SliceFilterOnly. With collFilterOnly kept and a starting point of 5: "2019-04 above 0",
  "2099-12" and "AlterID 0 now" each gave sliceExact=false but datedRefused=nil. A FinComAnything collection with only
  `$Date >= $$Date:"1-Apr-2019" AND $Date <= $$Date:"31-Mar-2026"` also gave datedRefused=nil.
- Fix:
  - In datedRefused, before the SVFROMDATE test: when tallyRequestID(x) == sliceID, pass only if sliceExact(x)
    (otherwise readsOffErr()).
  - Treat a request as dated also when its Formulae hold `$Date` or `$$IsBetween` (not only SVFROMDATE/SVTODATE), so
    the exceptions stay the only way through.
  - Or: drop collFilterOnly from collForms (the two other filter forms carry SVFROMDATE).
- Test: extend TestSourceCDatedGuardException to run its "bad" table for each of collForms (collFilterOnly included),
  and add a non-slice request with the period only in a `$Date` filter: each refused with ReadDays off.

R3-2. LOW (test hygiene; round 1's L18 again). The test run writes into the source tree, and the result was committed.
- Where: update.go:411 (installLogFn defaults to writeLog) with config.go:267 (logFile is Home/tds-bridge.log; Home
  is "" in TestRollbackVerifiesKeptVersion and TestSetupKeepsGoodPrevious, so the package folder).
- Effect: 41edc65 adds bridge-go/tds-bridge.log (12 lines of test output). Each `go test ./...` appends 4 more lines,
  so the tree is not clean after a test run, and a release commit carries a stray log.
- Fix: in those tests set installLogFn to a capture (or Home to t.TempDir()); git rm bridge-go/tds-bridge.log; add it
  to .gitignore.

R3-3. LOW (wording). notePreviousFromSetup says "the version of the program replaced could not be read (2.2.0)" when
the replaced program answers the same version as the new one but with other bytes (a rebuilt 2.2.0).
- Where: update.go:398-399.
- Fix: say "the program replaced is this same version (2.2.0); the version kept for a rollback is left as it was".

Verdict, round 3:
- No High.
- One Medium: R3-1 (R2-2 is fixed for every form but collFilterOnly). It blocks the build; the fix is a few lines in
  datedRefused.
- R2-1, R2-3 and R2-4 are confirmed fixed, and all eight Lows of round 2 are confirmed.
- R3-2 should go with the R3-1 fix (the stray log is in bridge-go/, so it is not a docs-only change).
- R3-3 may wait.


### Status after the round 3 fixes (by the builder; tests first, red run tdd/b223.1.red)

- R3-1 MEDIUM, Fixed (TestSliceGuardEveryForm): datedRefused checks FinComVoucherByMaster and FinComSlice by their id,
  always (whatever ReadDays says and whatever date form): only the exact request with its values in bounds goes. Every
  bad case of the slice guard is refused in each of the seven forms, the filter-only one included. A request whose
  dates are only in a TDL filter ($Date compared, $$IsBetween, a $$Date literal) counts as dated and is refused with
  ReadDays off unless it is one of the two exceptions; a FinComVoucherByMaster without its period is refused.
- R3-2 LOW, Fixed (TestNoLogInPackageFolder): the tests that run the setup's copy step capture its log lines;
  bridge-go/tds-bridge.log is removed from the index and the folder and named in .gitignore; the test fails if the file
  is there.
- R3-3 LOW, Fixed (TestSetupSameVersionOtherBytes): another build of the same version is said so in the install log.

## Round 4 (41edc65..2a62c54)

Reviewed: 04-Oct-2026, by the reviewer in the Claude Code session. I read git diff 41edc65 2a62c54 -- bridge-go/
.gitignore (tally.go, update.go, .gitignore, the tests, the new review220c_test.go, and bridge-go/tds-bridge.log
removed) from a clean worktree of 2a62c54.

Checks (clean worktree of 2a62c54):
- `go vet ./...` and `GOOS=windows go vet ./...`: clean.
- `go test -count=1 ./...`: ok (423 s). The tree stayed clean (no tds-bridge.log).
- One throwaway test (zz_scratch_r4_test.go, in a second worktree) confirmed R4-1. It was deleted with the worktree;
  nothing was added to the repo.

### Round 3 findings: is each "Fixed" claim true?

| # | Claim | Verdict | Notes |
|---|---|---|---|
| R3-1 M | Fixed | Confirmed for the two exceptions; the "dated" test can still be dodged (R4-1) | datedRefused (tally.go:296-306) now sends every FinComVoucherByMaster and FinComSlice through voucherByMasterExact / sliceExact by id, whatever ReadDays, the person flag or the date form. All the round 2 and round 3 slice bypasses are refused in every form (TestSliceGuardEveryForm), collFilterOnly included. A request whose period is only in a filter is now dated (requestDated, :317), but only in the exact spelling `$Date`, `$$IsBetween`, `$$Date:`, `<SVFROMDATE`, `<SVTODATE`. |
| R3-2 L | Fixed | Confirmed | The two tests capture installLogFn; bridge-go/tds-bridge.log is removed and in .gitignore; a full run leaves the tree clean. TestNoLogInPackageFolder catches a log only if it is there when that test runs (a later test could still write one; .gitignore keeps it out of a commit). |
| R3-3 L | Fixed | Confirmed | v == BridgeVersion now logs "the same version … another build of it: it is not kept"; an unreadable answer keeps the old wording. |

What holds in the new code (checked, no finding):
- Checking the two exceptions always is stricter, never looser. With ReadDays on, only the exact body fetch and slice
  go. Their builders are the only callers (fetchVouchersByMasterIn, liveSourceC), so nothing the bridge sends today is
  newly refused. driveEveryRequest now sends the slice as liveSourceC would.
- The read test's probe has its own id (datesProbeID, measure-only), so the slice's stricter check does not touch it.
- Every request still passes checkAllowed (the id and its collection names) before datedRefused.

### Findings, round 4 (by severity)

R4-1. MEDIUM (owner's rule: with ReadDays off no dated read goes except the two exceptions; the same class as R2-2 and
R3-1). requestDated looks for one exact spelling of each date marker, but Tally reads TDL with any letter case and XML
with character references decoded. An allow-listed request with its period spelled any other way is not seen as dated.
- Where: tally.go:314-318 (reFilterDate is case-sensitive; strings.Contains for `<SVFROMDATE` / `<SVTODATE`; no
  html.UnescapeString first), with allowlist.go:95-123 (checkAllowed checks the id and the collection names, not the
  filter or the static variables).
- Constructed (ReadDays off, a non-person TC; each passed checkAllowed and datedRefused, while the request as built was
  refused):
  - keepListRequest(ZZ TEST, 1-Apr-2019 .. 30-Apr-2019) with the tags spelled `<svFromDate>` / `<svToDate>`. Mixed
    case is the usual spelling in Tally's own XML samples.
  - A TDSDeskKeepList collection filtered `$date >= $$date:"1-Apr-2019" AND $date <= $$date:"30-Apr-2019"`.
  - The same with `$DATE` / `$$DATE`.
  - The same with `$$isbetween:...`.
  - The same filter written `&#36;Date &gt;= &#36;&#36;Date:&#34;1-Apr-2019&#34;` (character references Tally decodes).
- None of the bridge's builders spells a date this way today, so, as with R2-2 and R3-1, this is the guard failing a
  wrong caller rather than a path in use. A deny-list of spellings will always be one spelling short: a named formula,
  `##SVFromDate`, `$$YearOfDate:$Date` and so on.
- Fix (either):
  - Minimal: run requestDated on `strings.ToLower(html.UnescapeString(x))` with lower-case markers (`<svfromdate`,
    `<svtodate`, `$date`, `$$date`, `$$isbetween`, `svfromdate`, `svtodate` anywhere, including `##` variables), so case
    and character references cannot hide them.
  - Better, matching what the two exceptions already do: with ReadDays off and no person, a request whose id is one of
    the dated ids (Day Book, TDSDeskVchHeads, TDSDeskKeepList, dupCheckID, tagCheckID, masterCheckID, the measure ids)
    is refused by id, without looking for markers. Then the content cannot talk its way out.
- Test: TestDatedGuardSpellings. Each of the five constructed requests above is refused with ReadDays off. Also, for
  every id in allowListSamples whose sample is dated, a lower-cased copy and a character-reference copy are refused.

Verdict, round 4:
- No High.
- One Medium: R4-1. R3-1's fix closed the two exceptions (they are now exact by id in every form), but the "is it
  dated" test that guards every other id can be dodged by spelling. It blocks the build by the rule used in rounds 2
  and 3. The owner may instead accept it as Low, since no code path spells a date this way. If so, say it here and
  release from 2a62c54 plus docs.
- R3-2 and R3-3 are confirmed fixed.


### Status after the round 4 fix (by the builder; tests first, red runs tdd/b224.1.red (compile) and b224.2.red (56
spellings passing the round 3 guard))

- R4-1 MEDIUM, Fixed (TestGuardByRequestID): with ReadDays off the guard decides by the request's id (requestClass in
  tally.go; every allow-list id is classified, the test fails on one that is not). Ids that read by date (Day Book,
  TDSDeskVchHeads, TDSDeskDupCheck, FinComTag, FinComByMaster, the dated measure items, FinComSnapshot, FinComDatesProbe)
  are refused by id; TDSDeskKeepList goes only byte-identical to keepListAboveRequest rebuilt from its company and
  AlterID; the two exceptions stay as they were (checked by id, always); an undated id goes unless it carries dates in
  any spelling, looked for in a normalised copy too (lower-cased, character references decoded, the company's name left
  out); an unclassified id is refused; Import (a posting) is not a read. The proved spellings (<svFromDate>, $date,
  $DATE, $$isbetween, &#36;Date, &#x24;Date) are refused on every id; every undated request as built still passes, and
  TestEveryRequestOnList drives every builder.


### The owner's finding on NWS144 (empty change numbers), built with round 4 (tests first: tdd/b225.1.red, b225.2.red)

- Cause, as understood: FinComCompany asked ALTVCHID and ALTMSTID in a collection's FETCH. They are Company methods
  (AltVchId, AltMstId), not stored fields, so the export gave the company (name and GUID, stored fields) with empty
  tags; 2.1.10 skipped ("Tally gave no change numbers") and no starting point was recorded.
- Built (cnforms_test.go: TestChangeNumbersEmptyAnswer, TestChangeNumbersZeroNotRecorded, TestChangeNumbersNativeMethod,
  TestChangeNumbersReportForm, TestChangeNumbersBounded): form a, FinComCompany with NAME and GUID fetched and AltVchId /
  AltMstId as NATIVEMETHODs; form b, FinComCompanyNumbers, a report over the one company ($Name filter) whose fields SET
  $Name, $Guid, $AltVchId, $AltMstId. Form a answering the company without numbers: form b once; the form that gives
  numbers is kept per company (sync\change-number-forms.json) and used from then on. One log line: "Company X: change
  numbers read with form a|b: ALTVCHID=…, ALTMSTID=…", or "Company X: Tally gave no change numbers with form a or b
  (answer head: …)" (tags only, at most every 10 minutes). Never 0 or empty as a starting point (the latest numbers are
  still noted). Each request 15 s at most (CompanyCheckSec), one at a time, yields to postings, never during an import.
  The read test asks form b too. Both forms are on the allow-list (FinComCompany's shape changed; the 2.2.0 decision line
  names both); neither asks a computed figure. Not run on a real Tally: whether NATIVEMETHOD or the report gives the
  numbers is what the owner's read test will show.

## Round 5 (2a62c54..184cb61)

Reviewed: 04-Oct-2026, by the reviewer in the Claude Code session. I read git diff 2a62c54 184cb61 -- bridge-go/
docs/tally-allowlist.md from a clean worktree of 184cb61. It covers the R4-1 fix (datedRefused by request id) and the
owner's finding: FinComCompany's FETCH of ALTVCHID/ALTMSTID came back empty on NWS144. The fix adds form a
(NATIVEMETHOD) and form b (the FinComCompanyNumbers report), keeps the form per company, and never records a 0
starting point.

Checks (clean worktree of 184cb61):
- `go vet ./...` and `GOOS=windows go vet ./...`: clean.
- `go test -count=1 ./...`: ok (451 s). The tree stayed clean, and tests/fixtures/beat-2.1.10.json was not rewritten.
- One throwaway test (zz_scratch_r5_test.go, in a second worktree) confirmed R5-1 and R5-2. It was deleted with the
  worktree; nothing was added to the repo.

### Round 4 finding: is the "Fixed" claim true?

| # | Claim | Verdict | Notes |
|---|---|---|---|
| R4-1 M | Fixed | Confirmed for the dated ids; the guard's other two classes do not hold (R5-1, R5-2) | Every allowed id is classified in requestClass (tally.go:298). With ReadDays off, the dated ids are refused by id, so spelling no longer matters: a mixed-case `<svFromDate>` TDSDeskKeepList for April 2019 and a lower-cased Day Book are refused. An unclassified id is refused (fail closed). Import is passed: tallyRequestID gives "Import" only for the fixed importHead prefix, whose TALLYREQUEST is Import Data, so it cannot read. requestDated now lower-cases and decodes. But two classes still decide by content: "keepAbove" by an exact rebuild with any AlterID (R5-1), and "undated" by looking for date markers (R5-2). |

### The change-number forms against the owner's rules

- Small, one company: form a is the existing FinComCompany collection (NAME, GUID plus two NATIVEMETHODs, filtered
  `$Name = "<company>"`). Form b repeats one line over FinComCNCos, a Company collection filtered by the same `$Name`.
  Holds as built; R5-2 covers what the guard admits under that id.
- 15 s: both forms use keepNum("CompanyCheckSec", 15). This is a local setting; a larger value is the owner's own.
- Never during an import; yields to postings: both forms go with the caller's TC. The light check yields
  (lightCheckYield: posting, lease, importsInFlight), and the other callers (posting, jobs, keep, trial, measure,
  recorder note) are the ones that sent FinComCompany before. Form b goes only when form a listed the company without
  numbers, never after an error. After form b answers, only form b is sent for that company. When neither form gives
  numbers, each check sends two small requests.
- No computed figure: $Name, $Guid, $AltVchId and $AltMstId are reads of the company object's stored values and
  counters. The only `$$` is $$SysName:XML. TestNoComputedFigure is unchanged in this range (no new exemption). It looks
  only at `$$` functions and balance names with a period, so a single-`$` FIELD SET such as `$ClosingBalance` would not
  be caught (test limit, already there; see R5-2).
- 0 / empty never becomes a starting point: setCompanyAlts returns false when both numbers are 0 or empty, and nothing
  is noted. noteStartPoint returns before the file and before spPending when altV <= 0; only spLatest (the beat's
  latest numbers) keeps the 0. TestChangeNumbersZeroNotRecorded and TestChangeNumbersEmptyAnswer cover both.

### Findings, round 5 (by severity)

R5-1. MEDIUM (owner's rule: never a full read with ReadDays off; the same class as R2-2, and here with a code path that
sends it). The keepAbove class admits TDSDeskKeepList above any AlterID, 0 included, and the measuring tool can send
"above 0".
- Where:
  - tally.go:331-334 and :344-351: keepAboveExact rebuilds keepListAboveRequest(company, N) for any N and any
    company, with no check against the starting point.
  - measure.go:237-259: step a reads ALTVCHID with companyCheckRequest only (form a, no form b), and step a2 sends
    keepListAboveRequest(company, spAfter) with spAfter = that ALTVCHID when no starting point is recorded. measureOne
    uses fin (not a person TC).
- Scenario:
  - This is the owner's NWS144 case: form a's numbers come back empty, and no starting point is recorded yet (the
    owner's finding is that none ever was). FinCom support runs Measure Tally.
  - Step a gives altV = 0, so step a2 sends TDSDeskKeepList "$AlterID > 0" with no dates.
  - With ReadDays off it passes datedRefused. Tally answers GUID, MasterID, AlterID and date for every entry of its
    current period.
- Confirmed: TestScratchR5Guard. With no starting point, keepListAboveRequest(ZZ TEST, 0) and
  keepListAboveRequest("Any Other Co", 0) each passed checkAllowed and datedRefused.
- Fix:
  - In keepAboveExact, also require a starting point for the company and N >= it (no starting point: refuse), as
    sliceExact does. Source B always asks at or above the starting point; the read test's measurement is a person TC.
  - In measure.go, read the numbers through companyCheck (forms a and b), and skip a2 ("no starting point and no
    change numbers: not asked") when there is no starting point and altV <= 0.
- Test: extend TestGuardByRequestID: above 0, above the starting point - 1, and a company with no starting point are
  each refused with ReadDays off; above the starting point passes. Add a measure test with cnMode "none" and no
  starting point: no TDSDeskKeepList is sent.

R5-2. MEDIUM (owner's rules: never a full read with ReadDays off, no computed figure; form b must not be able to become
anything wider; the same class as R2-2, R3-1 and R4-1). The "undated" ids are judged by the absence of date markers,
not by their shape. So form b's report and the other undated ids can carry a Voucher read or a computed field.
- Where:
  - tally.go:335-338: undated passes when !requestDated(x).
  - allowlist.go:95-123: checkAllowed checks the id, `<COLLECTION NAME>` and `<REPORTNAME>` only, not `<REPORT
    NAME>`, `<FIELD>` SETs or a collection's TYPE.
- Confirmed (ReadDays off, fin; each passed checkAllowed and datedRefused):
  - companyNumbersRequest with FinComCNCos made `<TYPE>Voucher</TYPE>`, its filter dropped, and its fields SET to
    `$Amount` and `$Narration`: every entry's amount and narration for Tally's current period;
  - companyNumbersRequest with a FIELD SET to `$ClosingBalance` (a computed figure);
  - a FinComCompany collection of TYPE Voucher with GUID, DATE, AMOUNT, NARRATION and no filter;
  - a TDSDeskCompanies Voucher collection filtered `$EffectiveDate >= "1-Apr-2019"` (a period with no marker
    requestDated knows).
- No builder sends these today. As before, the guard is the rule's enforcement and does not stop a wrong caller. The
  coordinator asked whether form b's report can be turned into anything wider: as far as the bridge's guard is
  concerned, it can.
- Fix (either):
  - Pin by exact rebuild, as for the exceptions: cnReportID == companyNumbersRequest(co); FinComCompany ==
    companyCheckRequest(co); FinComFree == companyCheckRequest(""); the other undated ids by their builders (each takes
    a company and at most a MasterID range or a name).
  - Or at least: for undated ids that are not measure-only, refuse any `<TYPE>Voucher` (lower-cased, decoded) and any
    `<REPORT`/`<FIELD` other than cnReportID's exact request.
- Test: TestUndatedPinned. The four constructed requests above are refused with ReadDays off; every allowListSamples
  undated request still passes.

R5-3. LOW. "Recorder trial: note change numbers" writes a number the check did not give.
- Where: recorder.go:427. After companyCheck returns without error but with no numbers (neither form gave any), the
  line says `ALTVCHID=<companyAlter(name)>`. That is 0, or a value cached from an earlier check, stamped with the time
  now.
- Fix: write "ALTVCHID not given" when this check gave no numbers (have setCompanyAlts' result returned by
  companyCheck).

R5-4. LOW (by design, noted). A company with no entries yet (ALTVCHID 0) gets no starting point until a check sees its
first entry. That entry, and any others before that check, are then at or below the starting point and are not
followed; the Day Book upload covers them.

Verdict, round 5:
- No High.
- Two Medium: R5-1 (a full heads read the measuring tool can actually send on the owner's NWS144 case) and R5-2 (the
  undated class, form b included, is not pinned to its shape). They block the build.
- R4-1's spelling bypass is confirmed closed for the dated ids. The change-number forms meet the owner's rules as
  built, and 0 or empty never becomes a starting point.
- R5-3 and R5-4 are Low.


### Status after the round 5 fixes (by the builder; tests first: tdd/b226.1.red (compile), b226.2.red (every id
without a rebuild, the examples passing))

- R5-2 MEDIUM, and the class behind rounds 2 to 5, Fixed (TestEveryIdPinned): every allow-list id is pinned to its
  builder (bridge-go/pinned.go, requestRebuild). checkAllowed refuses any request that is not byte-identical to what
  the bridge's own builder makes for that id from the request's own parameters (company, period in any of the bridge's
  date forms, AlterID, MasterID range or list, party or ledger name); the test fails for an id without a rebuild.
  Import (free content) is held to its fixed envelope: the Import Data header, one of the bridge's two reports
  (Vouchers, All Masters), the company, and one TALLYMESSAGE holding VOUCHER and LEDGER objects only, none carrying a
  request's own markup (TDL, COLLECTION, REPORT, SYSTEM, ENVELOPE...). Refused: FinComCompanyNumbers as a Voucher report
  with $Amount/$Narration or with $ClosingBalance, FinComCompany as an unfiltered Voucher collection, TDSDeskCompanies
  with an $EffectiveDate filter, the ledger list over vouchers, an Import with TDL or a stock item or under another
  report, and one character more in a request's markup; the earlier proved bypasses stay refused. Every request the
  bridge builds still goes (TestEveryRequestOnList drives every builder; the whole suite runs through the same check).
  Two older tests that hand-built requests the bridge never builds (a bare <TALLYMESSAGE>, a TDSDeskNames and a
  TDSDeskGroups with other fields) now use the builders. The id-based ReadDays-off guard and the value checks stay on top. No request shape changed: the allow-list table
  and its hash are unchanged.
- R5-1 MEDIUM, Fixed (TestKeepAboveNeedsStartPoint): TDSDeskKeepList above an AlterID goes only with the company's
  starting point and an AlterID at or above it, whoever asks (source B, the measuring tool, the read test). The
  measuring tool reads the change numbers with both forms and does not ask the list without a starting point ("the
  entries above the starting point are not asked: no starting point is recorded"); the read test says the same. The
  NWS144 case (form a empty, no starting point) sends no keep list.
- R5-3 LOW, Fixed (TestNoteChangeNumbersNotGiven): "note change numbers" writes "not given" when neither form gave
  numbers in this check, never 0 or a number kept from before.
- R5-4 LOW, Left by design: a company with no entries yet gets its starting point at the first check that sees one;
  the entries up to then are the Day Book upload's (prospective only).

## Round 6 (184cb61..e5e54c0)

Reviewed: 04-Oct-2026, by the reviewer in the Claude Code session. I read git diff 184cb61 e5e54c0 -- bridge-go/ (the
new pinned.go and pinned_test.go; checkAllowed now requires pinnedToBuilder; keepAboveExact needs the starting point;
measure.go and readtest.go skip the list without one; companyCheckNumbers and "not given") from a clean worktree of
e5e54c0. Where FinCom's posting XML matters I read src/js at e5e54c0.

Checks (clean worktree of e5e54c0):
- `go vet ./...` and `GOOS=windows go vet ./...`: clean.
- `go test -count=1 ./...`: ok (454 s). The tree stayed clean; the beat fixture was not rewritten.
- Three throwaway tests (zz_scratch_r6*_test.go, in a second worktree) confirmed R6-1 and checked the round 5 fixes and
  the pin attacks below. They were deleted with the worktree; nothing was added to the repo.

### Round 5 findings: is each "Fixed" claim true?

| # | Claim | Verdict | Notes |
|---|---|---|---|
| R5-1 M | Fixed | Confirmed | keepAboveExact needs a starting point and N >= it, and datedRefused applies it to every undated TDSDeskKeepList whoever asks, a person TC included. "Above 0" with no starting point is refused for fin and for the read test. measure.go asks form a, then form b, and skips a2 without a starting point; the read test does the same. |
| R5-2 M | Fixed | Confirmed | checkAllowed refuses any request that is not byte-identical to its id's builder rebuilt from its own parameters. The round 5 constructions are all refused: form b as a Voucher report with $Amount, FinComCompany as a Voucher collection, TDSDeskCompanies with an $EffectiveDate period. |
| R5-3 L | Fixed | Confirmed | companyCheckNumbers returns `given`; the note says "not given" otherwise. |

### The pin under attack (pinned.go)

A parse-and-rebuild pin can only admit what some builder makes from some parameters. So the questions are what the
parameters can carry and whether the builders bound them.
- Markup through a name: esc escapes & < > " ', and pinCo / pinQuoted unescape what they take, so a name round-trips
  as text. A company named `A</SVCURRENTCOMPANY><SVFROMDATE>…` stays text inside SVCURRENTCOMPANY and the filter;
  requestDated, which decodes first, even refuses it with ReadDays off. Holds.
- TDL inside a name (R6-3): dupCheckRequest puts esc(party) inside `"…"` in a Formulae, and Tally decodes `&#34;`, so
  a party `X" OR … OR $Name = "Y` changes the filter. The pin admits it, because the builder makes it. It stays within
  that one date, which dupCheckRequest(company, date, "") reads whole anyway. The other names in formulas strip `"`
  (companyCheckRequest, coInfoRequest, measureLedFilter).
- Values outside their bounds: the pin does not bound values; the value checks do.
  - A body fetch with 51 MasterIDs passes the pin but voucherByMasterExact refuses it, always (by id).
  - The keep list above an AlterID needs the starting point.
  - The slice is bounded by sliceExact.
  - A Day Book of 2015-2026 passes the pin and is refused with ReadDays off by id. With a person TC or ReadDays on, the
    month limit is the caller's (reads.go:498), not the guard's.
  - A body fetch for a day in 2019 passes (one day, by MasterID; accepted in round 2).
  - A ledger list with no upper end passes (masters, stored fields).
  - None of these is new, and none needs a wrong caller to stay safe beyond what the builders already do.
- An id with several builders: Day Book (dateForms), TDSDeskKeepList (dated and above), FinComSlice and
  FinComDatesProbe (collForms). Each admits only its own builders' outputs, and each is then held by its value check.
- Import:
  - The fixed head, one of the two reports, one TALLYMESSAGE, and only VOUCHER/LEDGER objects with no request markup.
  - Markup in CDATA is refused (the `<TDL` text is seen).
  - Escaped markup in an attribute is plain text and harmless.
  - A second TALLYMESSAGE is refused, and Import Data changed to Export Data is "not on the list".
  - A Delete action goes, as postings may delete.
  - The pin itself holds, but it refuses what FinCom actually posts (R6-1).

### Findings, round 6 (by severity)

R6-1. HIGH (regression: FinCom's postings refused). The Import pin rejects the objects FinCom sends, so posting from
FinCom stops working with 2.2.0.
- Where: pinned.go:146 and :169-186 (importRebuild). Each object must start exactly with `<VOUCHER` or `<LEDGER` and
  be followed straight away by the next one, or by the end of the TALLYMESSAGE.
- What FinCom sends:
  - Every voucher it builds ends `</VOUCHER>\n`, and every ledger `</LEDGER>\n`: src/js/22-written-rules.js:886
    and :895, 25-sales.js:265 and :274, 01-documents-in-the-firm-account.js:4124, app/legacy/live.js:4443 and :12353.
    The bridge does not trim the item's xml (post.go:519, jobs.go:189). After the first object `in` is "\n", and
    reImportObj fails.
  - "Set automatic voucher numbering" posts `<VOUCHERTYPE … ACTION="Alter">…</VOUCHERTYPE>\n` as a master
    (src/js/24-tally-bridge.js:1329). cannotSend allows that, and GROUP masters too (post.go:142); importRebuild allows
    neither.
- Confirmed: TestScratchR6Import, through invokeImport on the stand.
  - A plain ledger and a plain voucher went (the shapes the tests use).
  - A voucher with a trailing newline (FinCom's shape), a ledger with a trailing newline, a GROUP and the VOUCHERTYPE
    numbering alter were each "not sent": "Tally did not answer: The request Import is not on the bridge's allow-list
    … (it is not exactly as the bridge builds it)".
  - Nothing reaches Tally, and the result is notSent, so no entry is posted twice. But every posting from FinCom
    fails, under a message that blames Tally.
- Why the tests missed it: finVoucher and the master fixtures have no whitespace, and no test posts a GROUP or a
  VOUCHERTYPE.
- Fix:
  - In importRebuild, skip whitespace (spaces, tabs, CR, LF) before each object and at the end.
  - Allow the objects cannotSend allows: VOUCHER, LEDGER, GROUP, and VOUCHERTYPE. Or better, call cannotSend's rule
    for each object, so the two cannot drift apart.
  - The rebuild stays byte-identical, since the body is taken as it is.
  - Say "refused by the bridge" rather than "Tally did not answer" for a notAllowedError (post.go:532).
- Test: TestImportPinTakesFinComShapes. Post through invokeImport, on the stand, FinCom's own shapes: a voucher and a
  ledger with `\n` after each and between two vouchers in one request, a GROUP, and the VOUCHERTYPE alter from
  24-tally-bridge.js. Each is sent. A body with `<TDL>` between two vouchers, or a COMPANY object, is still refused.

R6-2. LOW. The refusal of an Import is reported as "Tally did not answer: …".
- Where: post.go:532.
- Effect: the owner looks at Tally instead of the bridge. Fixed with R6-1's wording.

R6-3. LOW (needs a deliberately wrong party name, and is bounded by the builder). dupCheckRequest escapes the party
name, but Tally decodes `&#34;` inside the Formulae, so a `"` in the name can add TDL to the filter. The pin admits it
because the builder makes it. The read stays inside the one date that dupCheckRequest(company, date, "") reads anyway,
and FETCH is fixed, so nothing wider or computed comes back.
- Fix: strip `"` from the party as the other builders do (dupcheck.go:188).

Verdict, round 6:
- One High: R6-1. Every FinCom posting is refused by the new Import pin: a trailing newline after each object, and
  GROUP / VOUCHERTYPE masters not admitted. It blocks the build.
- R5-1, R5-2 and R5-3 are confirmed fixed. The pin itself could not be fooled: no different request rebuilt
  identical, and every value out of bounds is held by the value checks or refused by id with ReadDays off.
- R6-2 and R6-3 are Low.


### Status after the round 6 fixes (by the builder; tests first: tdd/b227.1.red, where the real purchase bill was refused)

- R6-1 HIGH, Fixed (TestRealPostingShapesPass, TestPostingRuleAndPinAgree, TestPostShapesCurrent): the Import check
  calls the posting rule (post.go cannotSend, one source of truth: VOUCHER with a date, LEDGER, GROUP, a VOUCHERTYPE's
  numbering) for each object, with white space before, after and between objects, beside the deletions
  removeTallyVoucher builds (deletionShape: ACTION="Delete", its identity, date, type and number only); it still
  refuses another report, a second TALLYMESSAGE, TDL / COLLECTION / REPORT / SYSTEM / ENVELOPE markup, CDATA, a DOCTYPE
  and processing instructions. tests/gen_post_shapes.js loads the app's own builders from src/js (voucherXml for a
  purchase bill, a journal and a debit note; salesVoucherXml with its lines given; bankVoucherXml for a payment, a
  receipt and a payment with TDS; ledgerMasterXml; customerMasterXml; the VOUCHERTYPE numbering builder inside
  setAutoNumbering) and writes tests/fixtures/post-shapes/*.xml with MANIFEST.json (the SHA-256 of the builders' source
  text); TestRealPostingShapesPass sends each through the posting rule, planImports and sendImport to the stand Tally;
  TestPostShapesCurrent fails with "regenerate post-shapes" when the builders' source changed. Left: the app builds no
  GROUP master and no Alter of an existing ledger, so those two have no real shape; TestPostingRuleAndPinAgree covers
  them. A request the bridge refuses in a posting job now fails its entries with the words (before, the job would wait
  as if Tally were not reachable).
- R6-2 LOW, Fixed (TestPinRefusalWords): "FinCom Bridge refused to send this (it is not a request FinCom builds):
  <why>; nothing was sent to Tally".
- R6-3 LOW, Fixed (TestDupCheckPartyNoQuote): the duplicate check's party name has no quote, as the other builders.

## Round 7 (e5e54c0..328b187)

Reviewed: 04-Oct-2026, by the reviewer in the Claude Code session. I read git diff e5e54c0 328b187 -- bridge-go/
tests/gen_post_shapes.js tests/fixtures/post-shapes/ from a clean worktree of 328b187. The diff covers:
- the Import pin now uses the posting rule (cannotSend) per object, with white space allowed;
- deletionShape, for removeTallyVoucher's date-less deletions;
- pinRefusedError and its words;
- the job's new "refused" branch;
- no quote in the duplicate check's party;
- the real posting shapes, generated from the app's own builders in src/js.

Checks (clean worktree of 328b187):
- `go vet ./...` and `GOOS=windows go vet ./...`: clean.
- `go test -count=1 ./...`: ok (452 s), TestRealPostingShapesPass, TestPostShapesCurrent and
  TestPostingRuleAndPinAgree included. The tree stayed clean; the beat fixture was not rewritten.
- One throwaway test (zz_scratch_r7_test.go, in a second worktree) checked 26 Import requests against checkAllowed. It
  was deleted with the worktree; nothing was added to the repo.

### Round 6 findings: is each "Fixed" claim true?

| # | Claim | Verdict | Notes |
|---|---|---|---|
| R6-1 H | Fixed | Confirmed | importRebuild trims white space before each object and at the end, takes VOUCHER, LEDGER, GROUP and VOUCHERTYPE, and admits an object only if cannotSend accepts it (or it is one of removeTallyVoucher's deletions). The eight shapes written by FinCom's own builders (purchase bill, journal, debit note, sales invoice, a three-line bank batch, a new ledger, a new customer, the voucher-type numbering) go through the real posting path to the stand (TestRealPostingShapesPass). TestPostShapesCurrent fails when the builders' source changes. In my run, vouchers ending `\n`, a GROUP and a date-less delete by MasterID all passed. |
| R6-2 L | Fixed | Confirmed | pinRefusedError: "FinCom Bridge refused to send this (it is not a request FinCom builds) …; nothing was sent to Tally", used for every id. |
| R6-3 L | Fixed | Confirmed | dupCheckRequest strips `"` from the party, as the other builders do. |

### The Import pin under attack (each refused by checkAllowed unless said)

- Export Data in place of Import Data: not "Import" any more and not on the list.
- A second TALLYMESSAGE.
- `<TDL>` between objects or inside one; `< TDL >` with spaces.
- CDATA; a DOCTYPE before or inside an object; a processing instruction.
- A comment hiding a `</VOUCHER>`: the remainder does not start an object.
- COMPANY and STOCKITEM objects; a lower-case `<voucher>`.
- A voucher with no date that is not a deletion shape; a VOUCHERTYPE Create.
- Deletion shapes widened: a NARRATION inside, another attribute (OBJVIEW), or ACTION="Alter".
- Passed, harmless: `&lt;TDL&gt;` as text in a narration.
- Passed, see R7-1 and R7-2: a VOUCHERTYPE Alter carrying another field in an attributed or lower-case tag, and a
  date-less deletion keyed by any TAGNAME.

### The job's new "refused" branch and the FinCom id

A pin refusal cannot free a FinCom id that Tally may hold:
- Before any send, both posting routes refuse an entry already on the record (post.go:503 and jobs.go:549,
  sentBeforeRefusal).
- sendImport notes the entry as sent before the send. On any error that is not a no-answer, it removes only those
  notes (acceptedForgetMany, as since 2.1.8 F2), and a pin refusal is such an error.
- So the notes forgotten are the ones this refused request made, for entries that were not on the record before it.
  Nothing reached Tally, because checkAllowed runs before anything is sent.
- The change only turns "wait and send the same refused bytes again" into "failed, with the words". Since the bytes
  are the same, waiting could never succeed.

### Findings, round 7 (by severity)

R7-1. LOW (needs a deliberately wrong poster; it is the posting rule, not a read; FinCom's builder never sends it).
cannotSend's voucher-type check counts only plain upper-case tags, so a VOUCHERTYPE Alter can change other fields.
- Where: post.go:128-135. `<([A-Z.]+)>` misses `<PARENT TYPE="String">` and `<parent>`, so a VOUCHERTYPE Alter with
  NAME plus another field in either spelling counts as "numbering only". The pin now uses this rule, so it admits it.
- Why Low: it alters a voucher type's settings, which a LEDGER or GROUP Alter can already do to those masters; it
  reads nothing. FinCom's builder (24-tally-bridge.js:1329) sends NAME, NUMBERINGMETHOD and PREVENTDUPLICATES only.
- Fix: take every opening tag inside (`<([^/!?\s>]+)`) and require exactly NAME, NUMBERINGMETHOD and
  PREVENTDUPLICATES, with no attributes.

R7-2. LOW (bounded by the posting rule). deletionShape admits any TAGNAME and TAGVALUE, but removeTallyVoucher uses
only REMOTEID, TAGNAME="MASTERID" and TAGNAME="Voucher Number".
- Where: post.go:567.
- Why Low: a dated VOUCHER with ACTION="Delete" and any TAGNAME already passes the posting rule (as in 2.1.10), so the
  date-less shape reaches nothing more.
- Fix: TAGNAME only "MASTERID" or "Voucher Number".

R7-3. LOW (process). TestPostShapesCurrent hashes the builders in src/js. The main working tree now holds other
helpers' uncommitted changes to src/js (24-tally-bridge.js, ORDER.json, and others). When those are committed, run
`node tests/gen_post_shapes.js` and commit the shapes with them, or the bridge's test fails. The build was made from a
clean worktree of the release commit, which these changes do not touch.

Verdict, round 7:
- No High and no Medium.
- R6-1, R6-2 and R6-3 are confirmed fixed. FinCom's real postings go; the Import pin still refuses Export heads, a
  second TALLYMESSAGE, request markup, CDATA, DOCTYPE, processing instructions and the object types the posting rule
  refuses.
- The refused-job branch cannot free a FinCom id Tally may hold.
- R7-1, R7-2 and R7-3 are Low and may wait. Release from 328b187.


## Round 8 (328b187..0bec498)

One test-only change, reviewed by Claude: TestRecorderVersion220Sheets (bridge-go/recorder_live_test.go) accepts either the fingerprint placeholder or `Fingerprint: SHA-256 <64 hex> (FinComBridge-Setup-2.2.0.exe`, exactly as TestVersionAndSheets2110 does for 2.1.10. No program code changed. Checked: passes with the placeholder and with the built fingerprint written in. Findings: none.

Range: bdfe261..0bec498
