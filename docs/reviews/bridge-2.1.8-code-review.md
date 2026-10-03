# Code review: FinCom Bridge 2.1.8

Reviewed: 03-Oct-2026 (night), by the reviewer in the Claude Code session, the diff 7162400..a11a37e read hunk by hunk
(bridge-go/, server/tally-cloud/index.ts, server/tally-cloud/migration-43-posting-reply.sql); go vet and go test ./... green
(the allow-list hash test among them). Two suspected faults were confirmed with throwaway tests in the scratchpad (a copy of
bridge-go/ with zz_scratch_crash_test.go and zz_scratch_failed_test.go; scratch_m43.py against tests/pg_stand), nothing in
the repo. What 2.1.8 adds over 2.1.7 (round 15, the owner's decision): posting by Tally's import reply (no duplicate check
against Tally, no tag read-back, no voucher-id lookup, no checking cycle), batched import requests (bills by PostBatchBills,
bank lines by PostBatchBank, 1..500), the exact voucher id only when a request held one voucher, this computer's record
(sync\posted-ids.json, noteSent / sentBeforeRefusal) as the only duplicate check, settings from FinCom in the beat's answer
(applyCloudSettings), the request timings, and on the cloud side migration 43 (tally_device_post_settings,
tally_post_id_accept_reply, the reply states in taken / accepted / settle) and index.ts's posts_update and beat changes.

Focus: a code path where an entry is sent twice (a retry after no answer, a re-queued request after "Tally not reached",
Retry from FinCom on a needs-review job, a restart mid-job and what progress.json holds between requests); a batch whose
reply has created < sent; the batch end used as an exact id; the settings racing syncConfig and the installer; an unbounded
loop or wait in jobWorker; error texts leaking a key or a path; input from the cloud used without bounds; the beat body;
log lines; the needs-review message length; and in index.ts the field cleaning, the release reason cap, a byReply ok result
releasing an id, timing stored only from the owning device.

## Findings (open; none fixed yet)
1. HIGH, correctness (a second copy in Tally). bridge-go/post.go:227-277 and bridge-go/jobs.go:544-613: the record is
   written AFTER Tally answers. noteSent runs at post.go:272 (a reply) and post.go:293 (no answer), both after invokeTally
   returned; progress.json gets the request's results only at jobs.go:611. While the request is in flight (up to
   TallyMaxSec, 20 s) nothing on disk says the vouchers were sent: the items are "sending" in memory and have no result.
   If the bridge dies in that window (a crash, Windows shutting down, the self-update's restart: win_service.go waits 15 s
   for the loop, not for the job's request; jobWorker sees stopping() only between requests, jobs.go:545), the job comes
   back "interrupted", syncCloudPosts resumes it (cloud.go:888), itemsToSend lists the same vouchers (no result, no note)
   and sendImport sends them again; Tally holds them twice. Confirmed: TestScratchRestartMidRequestResends (a 2-voucher
   job, the reply delayed 2 s, progress.json and posted-ids.json snapshotted during the request and put back, the worker
   gone, resume): imports 1 -> 2, posted-ids.json during the request was empty, the resumed job ended "Posted 2 of 2".
   2.1.7 looked such entries up by their tag before resending (resendLost / findPostedTags, removed here), so this is a
   regression of the owner's first rule. Minimal fix: note BEFORE sending. In sendImport, before invokeTally, call
   noteSent(key, company, job, "", s, "", "") for every voucher of the request (the no-answer note: sent, lastVchId
   unknown) and write the request's ids into progress.json as p["inflight"] (save()); after the reply, noteSent again with
   lv / vchID as now and clear inflight. On resume (jobWorker start), every item in p["inflight"] without a result gets
   unknownResults' result (sent, no answer, never sent again); the A5 block already refuses an id noted in posted-ids.json.
   Test: TestRestartMidRequestNeverResends (the scratch test above, asserting imports stay 1 and the entry's state is
   unknown with "Check Tally").
2. HIGH, correctness (the cloud's lock dropped). bridge-go/jobs.go:641-647 with migration-40's tally_post_ids_sync
   (unchanged by 43): a job whose only answered request was refused by Tally with nothing made, and whose other request got
   no answer, ends "failed" (okN 0, acceptedN 0, failN+reviewN > 0; unknownN is not looked at). Confirmed:
   TestScratchUnknownPlusRefusedEnds (PostBatchBills 1, uf1 answered after the timeout, uf2 refused): status failed,
   uf1 outcomeUnknown + sent, uf2 needsReview not accepted. On the cloud a no-answer result is neither accepted
   (tally_post_result_accepted: no accepted / held / counts / lastVchId / words) nor taken (state "unknown" is not
   in_tally / sent), so when the row goes to 'failed' the trigger sets live = false for that id. Confirmed on the pg stand
   (scratch_m43.py, migrations 33..43 applied): U1 live t -> f on status 'failed'; the same result with status 'done'
   keeps live = t. A freed id is offered "Post again"; this computer refuses it on its record (sentBeforeRefusal), but a
   job queued to another computer of the firm sends it, and see finding 5 for what this computer's refusal then does.
   Minimal fix (bridge): a no-answer entry makes the job done, as a needs-review one does: jobs.go:641
   `if okN > 0 || acceptedN > 0 || unknownN > 0 { finish("done", postedLine(...)) }`. Belt and braces (cloud, later):
   index.ts posts_update stores "done" (checking false) when st is "failed" and any result carries outcomeUnknown, as
   heldOpen does for accepted entries. Test: TestNoAnswerPlusRefusedEndsDone (the scratch test, asserting done and the
   message "Posted 0 of 2; 1 need review; 1 sent with no answer from Tally — Check Tally in FinCom").
3. MEDIUM, correctness (FinCom's view and the owner's settle). server/tally-cloud/index.ts:1169-1171: STATES has no
   "posted" and no "needs_review", the two states the 2.1.8 bridge sends for every entry (posting_status.go:152-165), so
   every such item is stored "waiting". FinCom's live list shows posted entries as waiting; and migration 43's
   tally_post_job_settle counts an item in waiting / sending / sent as pending, so after an owner's Mark posted or
   release on such a job the settle leaves it 'running' (confirmed on the stand: with items 'waiting' the settle answers
   status running; with the bridge's states, done). Minimal fix: add "posted" and "needs_review" to STATES (the settle,
   taken and accepted functions of 43 already read the results, not the item state). Test (tests/run_tally_ingest or the
   deno test): posts_update keeps the item states posted and needs_review.
4. MEDIUM, correctness (an inferred voucher id stored). server/tally-cloud/index.ts:1210 vchOf and :1288: the bridge puts
   the request's LASTVCHID on EVERY entry of a batch as lastVchId (post.go:246) and vchId only when the request held one
   voucher. The cloud stamps a needsReview + accepted entry with tally_post_id_accept(job, id, vchOf(r0)), and vchOf falls
   back from vchId to lastVchId, so the batch end becomes accepted_vch of each entry of a partly created batch; the same
   for a byReply entry on a cloud without 43, and for an already-sent refusal (finding 5). The migration's own header says
   the exact id is kept only when p_batch_n = 1; the plain path does not know that. Minimal fix: vchOf ignores lastVchId
   when the result carries batchN > 1 (or batchEnd and no vchId): `r.vchId || (Number(r.batchN) > 1 ? "" : r.lastVchId)
   || ...`. Test: posts_update never stamps a batch end as an entry's voucher id (accepted_vch null for a 3-voucher batch
   with LASTVCHID 120).
5. MEDIUM, correctness (an id this computer sent is freed, or shown as being checked). bridge-go/post.go:302-338 with
   index.ts:1205-1212 and :1309-1316: the refusal on this computer's record (alreadySent, refused, ok false) reaches the
   cloud as a result with lastVchId = the note's lastVchId or batchEnd. With one, acceptedRes is true (lastVchId), the
   entry is stamped accepted with that id (finding 4), rewritten state "unknown" with "Tally accepted it; being checked"
   (nothing checks in 2.1.8). Without one (the first send got no answer, or the batch reply had no LASTVCHID) acceptedRes
   is false, the item is "failed", and the cloud releases the id (tally_post_id_release, reason "already sent from this
   computer on ...") although this computer sent it: "Post again" is offered. Minimal fix (cloud): clean alreadySent
   (REPLY_KEYS) and treat it as kept: add to `accepted` (locked, never released) with p_vch = r.vchId only, and do not
   rewrite it as being checked; (bridge, optional) sentBeforeRefusal's result carries "sent": true and no lastVchId when
   batchN > 1. Test: posts_update keeps an already-sent id locked and does not stamp a batch end.
6. MEDIUM, correctness (the needs-review text and progress.json grow with the square of the batch). bridge-go/post.go:
   191-202 and :266-269: replyLine joins EVERY LINEERROR of the request into each entry's message, and each entry also
   carries the whole lineError array; a request of 500 vouchers with 500 line errors (a missing ledger) gives 500 messages
   of ~50 KB each and 500 arrays of 500 strings, written to progress.json at every save and sent in every posts_update
   (every 3 s while the job runs) and in the job's own message (first). The cloud cuts message to 1000 and lineError to
   "" (finding 8), the bridge and the browser do not. Minimal fix: replyLine carries at most the first 3 LINEERROR texts,
   each cut to 200, with "and N more"; lineError per entry at most 5 texts; the request's note keeps the count. Test:
   TestNeedsReviewMessageCapped (a 50-voucher batch, 50 line errors: message under 1000 bytes, lineError at most 5).
7. MEDIUM, correctness (a legitimate batch reported as no answer). bridge-go/tally.go:311-313: tallyRaw caps every
   request's timeout at TallyMaxSec (20 s), the import requests included (sendImport passes 0). A batch of 500 bank lines
   that Tally takes 30 s to import is a timeout: every entry unknown and locked, Tally marked busy, the probe hold refuses
   the next request until the small check answers, and the posting ends "N sent with no answer — Check Tally" though
   Tally created them. Nothing is sent twice (the no-answer note holds), but the bounds 1..500 the owner set cannot be
   used. Minimal fix: an import request's timeout is its own setting (PostTimeoutSec, default 120, or 20 s + 0.5 s per
   voucher), applied in sendImport's invokeTally call and exempted from the TallyMaxSec cap when isImportRequest(x).
   Test: TestImportTimeoutScalesWithBatch (a 50-voucher reply delayed 3 s with TallyMaxSec 1 is trusted, not unknown).
8. LOW, correctness. server/tally-cloud/index.ts:1163: lineError is cleaned with s(), which gives "" for anything but a
   string; the bridge sends an array (post.go:268, cloud.go:921), so the column is always empty. Fix: join an array with
   " | " before the cut to 300. Test: posts_update keeps the line error text.
9. LOW, robustness. bridge-go/config.go:363-403: applyCloudSettings takes the cloud's postOnly list as it comes (any
   number of names, any length); the cloud's function bounds it (20 names, 200 characters) but the bridge should not
   depend on that for a value it writes into its settings file and its beat. Fix: the same bounds in Go (first 20, each cut
   to 200). Test: TestBeatSettingsBounded.
10. LOW, robustness. bridge-go/config.go:209-245: cfgStamp is written by saveConfig (the beat goroutine, from
    applyCloudSettings) and read and written by syncConfig (the turn and the keep goroutines) with no lock: a data race
    (benign today: the worst case is one extra re-read of the file the bridge just wrote). The installer's setPostOnly runs
    in the setup's own process on its own Ordered and never touches a list marked "fincom" or "owner"; a hand edit while a
    beat lands within the same mtime tick is the only lost write and is the owner's own race. Fix: guard cfgStamp with
    cfgMu. No test needed.
11. INFORMATIONAL. Retry from FinCom on a job that ended "done" with needs-review entries Tally made nothing of: newPostJob
    (jobs.go:143) retries only failed / cancelled jobs, so the Retry returns the done view and nothing is sent; those ids
    are released by the cloud ('needs review: ...') and go again as a new job by Post again. Consistent with the rules
    (nothing Tally may hold is sent, nothing is held), but the Retry button does nothing visible for such a job: the app
    should offer Post again there. On a job that ended "failed" the Retry keeps every confirmedResult (ok, accepted,
    held, sent), so a no-answer entry is never sent again by Retry either.
12. INFORMATIONAL. PostOnly is checked once at the start of a job (jobs.go:443) and on every /import; a narrowing from
    FinCom while a job runs applies to the next job. The rule "refusal before anything is sent" holds.

## Found safe
- One request to Tally at a time (enterTallyLock), the postGate around each job request and the whole /import, the
  tallyWriter lock per port; the lease per company; the company check once per job (and once more after a restart, which
  is a new worker). No unbounded loop without a pause: waitTally / waitLease / the not-sent retry all pause with
  waitPause (15..60 s) and see a cancel or a stop within a second; "no deadline" is the owner's design.
- The reply rule (post.go:241): created + altered == sent and no error, exception or LINEERROR; anything else is needs
  review for every entry of the request, accepted only when Tally made something; all ids of such a request are noted
  (noteSent with the batch end) and locked, none is released by the bridge; a request Tally made nothing of notes nothing,
  so Retry / Post again sends it again (TestNothingMadeEndsFailed). A reply with created > sent is needs review too.
- The exact id: vchId only when s == 1 (post.go:249); sentBeforeRefusal's words say "Tally ids up to X, sent in a batch
  of N"; the bridge itself never treats batchEnd as an entry's id (the cloud does: finding 4).
- "Tally not reached" (refused, probe hold, read stop, allow-list) sends the same request again after a wait and records
  nothing: nothing reached Tally. A timeout or a closed connection (plainNetErr: timeout, EOF, reset, closed, broken
  pipe) is tallyNoAnswer: recorded as sent. A net error outside those words (rare: "aborted by the software in your
  host") is treated as not reached; noted, no change.
- progress.json between requests holds every result so far, the request notes and the seq; the resume keeps them;
  itemsToSend and confirmedResult include "sent"; the A5 block refuses an id noted in posted-ids.json without a result
  (a crash between noteSent and save). The gap is only the in-flight window (finding 1).
- Masters: one request each, never noted (Tally alters or ignores a duplicate master); a master sent without an answer is
  kept in the job's results (sent) and not sent again within the job.
- Settings from FinCom: null leaves the file's value; a value is clamped 1..500; PostOnly [] from FinCom means any
  company, written as the owner's FinCom-side choice (PostOnlyBy "fincom"), which a later installer never overrides
  (setPostOnly keeps any list not marked "installer"); the beat says what is applied. TestBeatSettingsApplied.
- The beat body grows by three scalars (postBatchBills, postBatchBank, settingsAt). posts_update grows by reqs (one
  small note per request, at most the number of requests) and secondsTotal; the cloud cuts reqs to 1000 and results and
  items to 5000.
- Error texts to the cloud: "could not start this posting: " + err carries the setting's name (AllowImport), "Not a job
  number." or "No company given."; the request's detail (tallyTrouble) stays in progress.json. No path, no key.
- Log lines: counts, ids, seconds, the last Tally id, company names; the "Tally replied" line (first 400 characters of
  the IMPORTRESULT, as 2.1.7) and the failed line carry Tally's LINEERROR words (a ledger name at most), no FinCom amount.
- index.ts: the release reason is cut to 500; a byReply + ok result is never released (its item state is not failed or
  notfound, and the needs-review release needs needsReview without accepted); timing is written by the same update that
  carries .eq("device_id", dev.id); batchN 0..500, counts 0..1e6, seconds 0..30 days, strings cut; an older cloud without
  43 keeps working (timing dropped, accept_reply falls back).
- migration 43: the 8-argument tally_ingest_day is 42's text with the pending count however old; add-only; the owner-only
  settings function with the device of the firm and bounds; accept_reply calls 36b's accept (its release rules hold) and
  stamps reply_vch only when p_batch_n = 1; run_migration43.py green on the stand.

## Fix before build (must)
1. Finding 1: note every voucher as sent BEFORE the request goes (and inflight in progress.json); a resumed job treats
   an in-flight entry as sent with no answer. TestRestartMidRequestNeverResends.
2. Finding 2: a job with any no-answer entry ends "done", never "failed" (jobs.go:641). TestNoAnswerPlusRefusedEndsDone.
3. Finding 3: index.ts STATES gains "posted" and "needs_review".
4. Findings 4 and 5: index.ts vchOf never uses lastVchId for a batch entry; an alreadySent result is kept locked, not
   released and not stamped with a batch end.
5. Finding 6: the needs-review message and lineError capped in the bridge.
6. Finding 7: an import request's own timeout (not the 20 s read cap) so the owner's batch bounds can be used.

## Later (may)
- Finding 8 (lineError array joined in index.ts), finding 9 (PostOnly bounds in Go), finding 10 (cfgStamp under cfgMu).
- Finding 2's cloud half: posts_update stores "done" for a "failed" update that carries a no-answer result.
- Finding 11: the app offers Post again (not Retry) on a done job with needs-review entries.
- A note in docs: Check Tally in FinCom is the only settlement of a no-answer entry in 2.1.8.

## Fixes reviewed (a11a37e..f15332f)
Read: the diff a11a37e..f15332f (bridge-go: post.go, jobs.go, tally.go, selfwatch.go, config.go, round15_test.go,
rebuilt_test.go; 633c47f: index.ts, tests/run_main_bridge_server.py). go vet and go test -count=1 ./... green on f15332f
(145 s); run_main_bridge_server.py's new CR checks read. Verdict per finding:
1. CLOSED. post.go sendImport notes every voucher as sent BEFORE invokeTally (the no-answer note, batchN, no id), and
   jobs.go writes the request's ids as p["inflight"] and saves before the gate (jobs.go, "the request's ids on disk before
   it goes"); the resume block at the top of jobWorker turns every inflight id without a result into an unknown result
   (sent, no answer, "Check Tally") and notes it, never sends it. TestRestartMidRequestNeverResends (the files snapshotted
   during the request: inflight named, both notes sent; the resumed job: imports stay 1, done, "2 sent with no answer").
   What it opened, see F1, F2 and the notes below.
2. CLOSED. jobs.go: `okN > 0 || acceptedN > 0 || unknownN > 0` -> done; TestNoAnswerPlusRefusedEndsDone. The cloud half is
   done too: index.ts stores "done" for a "failed" update carrying a not-ok result with outcomeUnknown / sent / state sent
   that is not accepted (noAnswer); CR2 (stored done, checking false, the no-answer id neither stamped nor released, the
   refused one released; a failed update without one still failed).
3. CLOSED. index.ts STATES gains "posted" and "needs_review"; CR3 (both kept, an unknown state still waiting).
4. CLOSED. index.ts vchOf: an entry with batchN > 1 gives vchId alone (never lastVchId, never the words); an alreadySent
   gives vchId only when batchN == 1; CR4 (batch of 3 with LASTVCHID 120: stamped with no id; batchN 1 with vchId 121:
   stamped 121; a byReply batch entry on a cloud without 43: no id). post.go sentBeforeRefusal hands on lastVchId only when
   it is the entry's own (vchId or masterId), never a batch end.
5. CLOSED. index.ts: alreadySent is cleaned (REPLY_KEYS), is an acceptance (acceptedRes), is confirmed (never held open,
   never rewritten "being checked"), stamped with vchId only when batchN == 1, never released; CR5 (three checks, the
   no-id case included). The bridge's refusal now carries sent: true (confirmedResult and itemsToSend keep it on Retry).
   A forged alreadySent from a bridge: posts_update reads the job with .eq("device_id", dev.id) and tally_post_id_accept
   stamps `where job_id = p_job`, so it can lock only an id of that bridge's own job, which the job already holds live (an
   id cannot be live in two postings: the unique rule in tally_post_ids_sync); the worst case is an entry of its own
   posting the owner must release by hand. Not exploitable against another computer's posting.
6. CLOSED. post.go replyLine: the first 3 LINEERROR texts, each cut to 200, "and N more"; lineErrorKept: at most 5 per
   entry; TestNeedsReviewMessageCapped (a 50-voucher batch with 50 line errors: message under the cap, lineError 5,
   progress.json not quadratic, a long text cut). index.ts lineErrs (finding 8) takes the array: CR8.
7. CLOSED. post.go importTimeoutSec (PostTimeoutSec default 120, or PostTimeoutBaseSec 20 + n/2 s, cap 300) passed to
   invokeTally; tally.go exempts isImportRequest(x) from the TallyMaxSec cap; selfwatch.go does not count an import's time
   as an over-the-limit read; TestImportTimeoutScalesWithBatch (defaults, the setting, the cap; a 3 s import under a 1 s
   read cap is trusted; the self-watch and over20 untouched; a read is still cut at the cap). Can a non-import pass as an
   import? isImportRequest is strings.HasPrefix(x, importHead), the same fixed start the allow-list's Import fast path
   matches; only importEnvelope produces it (sendImport and removeTallyVoucher, both person-started postings; the allow-list
   test is unchanged and green). A read request cannot carry it. Noted: a delete by removeTallyVoucher is exempt too
   (timeout 0 -> TallyTimeoutSec / 120 s), harmless.
9. CLOSED (later item done early): config.go bounds the cloud's list to 20 names of 200; TestBeatSettingsBounded.

What the fixes opened (new):
- F1, MEDIUM, must fix: the pre-send record is written with its error ignored. post.go sendImport: `_ = noteSent(...)`
  before invokeTally, and jobs.go's save() before the gate is `_ = saveFile(...)` (writeProgress). When posted-ids.json
  or progress.json cannot be written (the disk full, the folder locked by a backup or an antivirus: acceptedWriteOrLog
  logs "POSTED IDS NOT SAVED" and goes on) the request still goes to Tally with nothing on disk, and a restart in that
  window is finding 1 again. Minimal fix: when any pre-send note or the inflight save fails, sendImport returns an error
  that is not tallyNoAnswer ("the record could not be written; nothing sent") so the job waits and tries again (the
  not-reached path), and /import says so. Test: TestNoSendWhenRecordNotWritable (acceptedFile() made a directory, or the
  sync folder read-only: zero imports, the job waiting, the log line).
- F2, MEDIUM, must fix: the /import route keeps the pre-send notes after "Tally not reached". post.go invokeImport, the
  branch `o.err != nil && !tallyNoAnswer(o.err)` (notSent results) does not call acceptedForget as jobs.go now does
  (jobs.go: "nothing reached Tally: the notes made before the send go again"). After a probe hold, a connection refused or
  a read stop refusal the browser's retry is refused by sentBeforeRefusal with "already sent from this computer on ...
  (Tally id not given)" for an entry that never reached Tally, until an owner releases it. Minimal fix: move the forget
  into sendImport's error branch (`if err != nil { if !tallyNoAnswer(err) { forget the request's notes }; return }`) so
  both callers get it, and drop the copy in jobs.go. Test: TestImportNotReachedForgetsNotes (a /import while the probe
  holds: notSent, acceptedInfo nil, a second /import after the probe sends it once).
- Informational: a false "unknown". The inflight ids are on disk from before the Tally lock (enterTallyLock may wait for a
  preempted read, GentleMs, the probe) until the reply; a bridge that dies in the part of that window before the body was
  sent marks the entries unknown and locked though Tally never saw them. Safe direction (a Check Tally, never a second
  copy); it could be narrowed by writing inflight just before cl.Do in tallyRaw. Later.
- Informational: acceptedForget deletes the whole note, the "honoured" releases list included. Reachable only for an id
  that had a note before this request, which the A5 block lets through only after a release was honoured; forgetting it
  after a not-reached or a nothing-made reply lets the same release be honoured once more on a later Retry, which is still
  one effective send per release (nothing reached Tally, or Tally made nothing). Noted, no change.
- Performance, later: noteSent rewrites posted-ids.json once per voucher, now twice per voucher (before and after the
  request): on the stand 100 bills in one request went from 105 ms (a11a37e) to 308 ms; with a real file of thousands of
  notes each rewrite is larger. Fix: a noteSentMany(keys, ...) that writes once per request, and the same for the reply.
  Test: TestPostNotesWrittenOncePerRequest (count the renames).

## Fix before build, after the fixes (must)
1. F1: no request goes when the pre-send record (posted-ids.json, progress.json) could not be written.
2. F2: /import forgets the pre-send notes on "Tally not reached" (the forget moved into sendImport).

## Fixes reviewed (f15332f..e383608)
Read: the diff f15332f..e383608 -- bridge-go (accepted.go noteSentMany / acceptedForgetMany, post.go errRecordNotWritten
and the forget inside sendImport, jobs.go writeProgress / save returning errors, round15_test.go, round7_test.go). go vet
green; the posting tests re-run with -count=1 on e383608 (green, 19 s).
- F1 CLOSED. post.go sendImport: noteSentMany for the request's keys before invokeTally; an error returns
  errRecordNotWritten (not tallyNoAnswer), so nothing is sent and the job takes the "not reached" path: it logs "not
  sent: ... record not written; nothing sent; waiting for Tally", sets "waiting" and tries again after waitPause (15..60
  s, no deadline, as a Tally wait), /import answers notSent with the words. jobs.go: the inflight save before the gate
  returns its error and is treated the same (nothing sent). TestNoSendWhenRecordNotWritable (posted-ids.json replaced by
  a directory: /import notSent with the words, the job waiting with 0 imports and the log line; the file writable again:
  posted once, the record holds sent); TestPostedIdsWriteFailureHolds updated (waiting, 0 imports, cancelled while
  waiting, still 0 imports).
- F2 CLOSED. post.go sendImport's error branch forgets the request's notes when the error is not tallyNoAnswer, for both
  callers; the copy in jobs.go removed. TestImportNotReachedForgetsNotes (a probe hold: /import notSent, acceptedInfo nil,
  the retry after the probe posts and is not alreadySent).
- noteSentMany keeps round 7's rules: the same note fields and first-send / resendOpen logic as noteSent, the held mark
  cleared, verified never set true here; the write is acceptedWriteOrLog (temporary file renamed over the old one, loud log
  on failure, the error returned); loading and the 180-day pruning of verified notes stay in acceptedAll, untouched; one
  write per request instead of one per voucher (the performance note of the previous section is answered).

What it opened (none must-fix):
- A job waiting on an unwritable disk, visibility and cancel (LOW, later). When only posted-ids.json fails (the tests' case:
  a directory in its place, a locked file) progress.json still carries "waiting" with the words, the cloud shows it as
  taken with that message, the tray's line says it, the log says it, and Cancel in FinCom works (the cancel file is
  written). When the whole folder is unwritable (disk full, permissions) progress.json cannot change either: the Tally
  page keeps the last written line ("Sending 1 of N"), the cancel mark cannot be written (cancelJob ignores saveFile's
  error, jobCancelled looks for the file), so the job cannot be cancelled from FinCom until the bridge is stopped or
  restarted (after which it resumes and waits again); the log line (and the console echo) is the only sign, and after 30
  minutes without an update the cloud's requeue re-hands the job (the running job's view is returned, nothing sent) and
  after 5 tries marks it "did not finish after 5 tries" in the cloud. Nothing is sent in any of this, which is F1's point.
  Fix later: an in-memory cancel set beside the file (jobsMu), and an in-memory mirror of the job's status for jobView
  when the disk write failed. Test: TestUnwritableFolderJobCancellable.
- A local path in a message (LOW, later). jobs.go wraps the progress.json error as fmt.Errorf("%w (progress.json: %v)",
  errRecordNotWritten, err): the OS error carries the full path; waitingLine's default branch puts err.Error() into the
  job's message, which reaches the cloud by posts_update once a later save succeeds (a transient lock). The
  posted-ids.json variant (errRecordNotWritten alone) carries no path. Fix: keep the OS error in the log only and the
  plain sentinel in the message. Test: TestRecordErrorMessageHasNoPath.
- Wording (informational): the status reads "Waiting for Tally: the record ... could not be written" though Tally is not
  the cause; a "Waiting: ..." line for this case would be truer. No safety effect.

## App reviewed (e383608..4cb9789)
Read: the diff e383608..4cb9789 -- app/src src/js (Post.jsx, Bill.jsx, Bank.jsx, Tally.jsx; 59-post-preview.js,
24-tally-bridge.js, 51-tally-queue.js, 49-tally-cloud.js), for posting safety and the owner's rules only.
1. Retry / Post again for an entry Tally may hold: HOLDS, with one gap. needsReview + accepted: the review row offers
   Post again only when r.accepted !== true (Post.jsx, the review map) and postRetryRefusal refuses a Retry naming such an
   entry (59: "Retry not possible: Tally accepted N entries that need review first"); byReply ok: st "posted" -> the
   bill is "intally", no button; unknown: owner acts only, as before. alreadySent: the row says "Not sent again" but
   keeps the Post again button unless held(e.id) (the cloud's id live and not released); with the cloud fix of 633c47f the
   id is stamped accepted, so held() shows Wait; on an older cloud, or while PostIds is unreadable (postIdReleased
   returns null -> held false), Post again is offered for an entry this computer sent. Pressing it is harmless (the bridge
   refuses on its record; the cloud's unique rule keeps a live id out of a second posting), so LOW: hide Post again when
   why[e.id].alreadySent (owner acts instead). Later. Test (run_post_tabs): an alreadySent refusal shows no Post again.
2. No inferred id shown: HOLDS. postTallyMark takes vchId when the bridge gave one (only for a request of one) else
   batchEnd + batchN; postMarkWords says "voucher id N" for vch and "batch ending Tally id N" for a batch; PostIds reads
   reply_vch (set by the SQL only when batch_n = 1) else batch_end / batch_n; the review row shows r.lastVchId as "last
   Tally id N" (the request's last id, so labelled; for a batch it would read better as "batch ending"), informational.
   The history search matches the batch end, which is a search aid, not a claim.
3. Test copies and REMOTEID: HOLDS. postTestCopies / TestCopies: postOwner() and postTestCopiesOk(co) (choiceState
   postTo "confirmed" and postTo beginning "ZZ TEST"), 1..100, an approved bill without exportedAt / postUnconfirmed; the
   copies get uid("e"), new createdAt / approvedAt, invoiceNo "<no>-T<i>", x.testCopy true, and every posting field
   deleted (exportedAt, postUnconfirmed, postCheckFailed, postError, postNote, postAlreadyMsg, tally, tallyVchNo,
   tallyCheck, postVerified, postAltered, postedVia, postedInto, postedOptional, goneFromTally, postFailedAt, paidBy,
   vchNo, docPath, dupOf). postOwner is the client-side role (S.account.me.role); a spoofed role makes test bills on a
   ZZ TEST client only (local entries; the postTo confirmation is the client's), nothing the cloud trusts. The REMOTEID box
   is round 14c's code, not in this diff; remoteIdFor keeps "" for a client not posting to ZZ TEST.
4. tally_device_post_settings: one MEDIUM gap. TCloud.postSettings checks 1..500 for both sizes before anything is sent,
   p_post_only is postSettingsNames (trimmed, de-duplicated, at most 20) and [] when the box is empty, never null. The
   gap: Tally.jsx's Edit prefills "Posts only to" from the SAVED row else the APPLIED beat value; when neither names a
   list (a computer whose PostOnly came from the installer or the owner's file and whose bridge has not beaten yet, or
   is offline, or the cloud row is fresh) the box opens empty, and a Save meant only for a batch size sends
   p_post_only [] = any company: the bridge then clears its installer-set list (applyCloudSettings takes a non-null
   value) and the pilot posts to any company. That widens PostOnly as a side effect, not as the owner's choice. Fix
   (small): send p_post_only only when the owner changed the box (null leaves the row's value, as the function allows),
   and when a Save would change a named list to [] ask once ("Allow posting to any company from this computer?"). Test
   (run_tally_computers): a Save of batch sizes alone sends p_post_only null; clearing the names asks. MUST before build.
5. bank: true: HOLDS. Only postBankToTally (24) marks its vouchers; the bill paths carry nothing; the bridge falls back
   to the voucher type for unmarked lines.
6. No new path to Tally or the cloud: HOLDS. Bridge.post (the existing /jobs route) with one more field; the settings
   go through TCloud.control (the existing RPC path); the rest are selects on tally_devices, tally_post_jobs and
   tally_post_ids and local rendering. The REMOTEID and company checks are untouched.
7. Select fallbacks: HOLD. 49: a missing-column message (post_only / post_batch / post_settings, main_bridge) narrows the
   select once per column set and every other error is rethrown; 51: the four variants fall back only on
   items / entry_ids / dismiss / timing / column messages and the last variant throws; PostIds: the three tries throw on
   anything but the named columns or 42703 and on the last try. A real error whose text happens to contain "column" (a
   permission message) would narrow 51's select once and then surface on the last variant; acceptable.

## Fix before build, app (must)
1. Item 4: the posting-settings Save never sends p_post_only [] unless the owner cleared or changed the names box; a
   change from a named list to "any company" is confirmed.

## App fix reviewed (4cb9789..6d1ba04)
Read: src/js/49-tally-cloud.js postSettings, app/src/screens/Tally.jsx PostSettings.open, app/src/screens/Post.jsx
refusedRow, and the test changes in tests/run_tally_computers.py and tests/run_post_tabs.py.
- App item 4 CLOSED. Tally.jsx records the names box as it opened (v.only0, from the saved row else the applied beat);
  postSettings compares postSettingsNames(v.only) with postSettingsNames(v.only0) and sends p_post_only only when they
  differ (null otherwise: the SQL leaves the row's value, so an installer-set or hand-set PostOnly on the computer is not
  touched by a batch-size Save); a change from a named list to an empty box asks "Posting to any company from this
  computer?" (askConfirm, the same {ok} shape readStop reads) and sends [] only on Yes, else "Nothing sent: the list
  stays as it was." and the editor stays open. Typing names and erasing them again counts as untouched (the comparison is
  on the cleaned lists, not the text). run_tally_computers.py: a batch-size-only Save -> p_post_only null and no
  question; clearing a named list -> the question, nothing sent; No -> nothing sent; Yes -> [] sent. Bounds 1..500 and the
  20-name cut unchanged.
- LOW item CLOSED. Post.jsx hides Post again (and Wait) on a refusal whose result says alreadySent, whatever the cloud's
  id state; Back to review stays. run_post_tabs.py: a record refusal shows "Not sent again" with the bridge's words, no
  Post again or Retry, Back to review present.
- Nothing opened: no new path to Tally or the cloud; the RPC call keeps the same arguments and bounds; the question text
  carries the computer's name and the list only.

Range: 7162400..6d1ba04 (bridge-go/, server/tally-cloud/index.ts, server/tally-cloud/migration-43-posting-reply.sql, tests/run_main_bridge_server.py, app/src, src/js)
