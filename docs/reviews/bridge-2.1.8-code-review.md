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

Range: 7162400..a11a37e (bridge-go/, server/tally-cloud/index.ts, server/tally-cloud/migration-43-posting-reply.sql)
