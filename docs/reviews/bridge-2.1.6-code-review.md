# Code review: FinCom Bridge 2.1.5

Range: f21b29f..be5542f (bridge-go/, server/tally-cloud/index.ts, migration-35)
Reviewed: 02-Oct-2026, by the code-review skill in the Claude Code session, then re-read after the fixes.

Focus: a request reaching Tally outside the allow-list; postings breaking while reading is stopped; an update installing without approval; a posting lost or sent twice.

## Findings (all fixed, each test-first; evidence in the commit messages)
1. ledgers.go: a refused or held request (read stop, probe hold, backoff) could mark a ledger as one that hangs Tally. Fixed: only a real timeout or cut-off answer counts; keepHold respects the read stop. TestPoisonNotMarkedWhenRefused.
2. reads.go ledgerChunks: FinCom's /ledgers and /ledgernames still asked for a known poison ledger. Fixed: skipped, reported as skipped. TestLedgerChunksSkipPoison.
3. held.go heldLedgerVouchers: ledgers only inside item-invoice allocations were missed. Fixed: one voucherLines() shared with the balance code. TestHeldLedgerVouchersItemInvoice.
4. selfwatch.go: the 2-minute silence rule measured time since the last error. Fixed: real silence while requests are attempted. TestNoSelfStopWhenIdleAfterOneError, TestNoSelfStopFromOldStuckFile, TestSelfStopOnSilence.
5. (added) the measure tool's requests no longer trip the self-stop. TestMeasureDoesNotSelfStop.

## Found safe
Allow-list checked in invokeTally and tallyRaw before anything is sent; read stop exempts only what a posting needs; update gating compares to the signed latest.json version and never downgrades; FinComTag read-back keeps the earlier "unknown outcome" behaviour on a failed read.

## Round 2 (a6bd835 to 0215ea4: allow-list exception, beat allowlist flag, ledger-list round/count, migration 34, index.ts)
Reviewed 02-Oct-2026 by the code-review skill. 7 findings, all fixed test-first (commits 0aaaf23, be5542f):
1-4. The exact-equality count check (bridge rowsRead vs the cloud's live GUID count) would fail for good after a poison ledger, a twin, or any held deletion, and held deletions were never resent. Replaced: each batch carries the GUIDs seen in the complete round; the cloud works out the unseen live ledgers itself; completeness = every batch arrived (seen count = rowsRead); bulk hold confirmed by the previous complete round; the bridge sends no deleted list.
5. The entries guard missed a ledger renamed then reported gone: guard now also holds a ledger renamed within 30 days or with entries under an old name (renamed_at).
6. A merge in tally_ledger_rename nulled/moved the GUID even when the guard kept the old row: the merge is refused when the old row would be held.
7. release-check.sh check 4 could pass an empty table: it now fails with "no rows parsed".
Round 3 (0aaaf23, be5542f) re-read: no further findings.

## Rounds 4 to 8 (be5542f to the range below): fault of 03-Oct, migrations 36/36b/37, Tally page controls, Post page
Reviewed 03-Oct-2026 by the code-review skill (read-only, the branch diff), then the fix commits re-read (second pass).
Context: on NWS144 a Journal Tally had created (CREATED 1, LASTVCHID 26298) was reported failed by 2.1.5 (Tally's
answer carried a Windows-1252 em dash; the XML read-back stopped at it), the job was parked 'running' by hand SQL, the
requeue cron handed it back after 30 minutes, and the bridge's local Retry sent it again (26299).
First pass, 12 findings, all fixed test-first (e95c84e, bridge round 7, 0e039fe):
1. (bug) bank-line ids ("sid-3" with a hash tag) never stamped accepted: tally_post_id_match on tag text, entry id, or either reduced to letters and digits.
2. (bug) an owner's release wiped by a later acceptance from the bridge's memory: posts_take carries the releases; the bridge honours one; tally_post_id_accept keeps an owner release not older than the acceptance.
3. (risk) one RPC per entry per update: stamps only ids not yet stamped, one read of the job's ids.
4. (risk) no monotonic guard on posts_update: per-job seq, lower ignored; done/failed never back to running/taken; a finished posting takes no bridge update; owner stamps merge per entry and win.
5. (risk) a partial fast batch re-imported unmatched entries one by one: held instead (unknown, never sent again, looked for by tag).
6. (risk) confirmation by voucher id without the tag wrote the entry into the copy under that voucher: only on a type/date/party match. Found on the way: FinComTag confirmations had not reached the copy since 2.1.5 (no ALTERID on the heads); fixed.
7. (risk) Retry blocked for a posting with one confirmed and one refused entry: confirmed entries no longer count.
8. (risk) a running/taken posting with an accepted entry whose bridge died stayed so: the requeue holds it as done + checking; mark/release settle it.
9. (nit) two note keys per entry and an empty job name: one key (the tag's id), job named.
10. (nit, withdrawn) SQL-side tests: they exist (tests/run_migration36b.py, run_migration37.py, run_migration_order.py on pg_stand).
11. (nit) owner buttons shown to superadmin, voucher number optional: owners only, number required.
12. (nit) no backfill of accepted_at for finished postings: added at the end of 36b.
Second pass (re-read of the fix commits), 9 findings, fixed test-first in round 8:
R1. (bug) a re-acceptance after an owner release was never stamped (skip on accepted_at alone), so the release never cleared and the owner's stamp hid the bridge's new state.
R2. (bug) a requeue-held posting lost the bridge's final update (the clamp to 'done' took the bridge's checking=false, so the row read "finished").
R3. (bug) tally_post_job_settle counted a 'sent' entry (read-back pending) as nothing: an owner release of another entry could end the posting failed and free the sent entry's id.
R4. (risk) held entries of a partial batch protected only inside the job: noted on disk and stamped on the cloud.
R5. (risk) bridge and server clocks compared: the cloud is the single judge (server time of the first acceptance); the bridge resends once per release the cloud still hands out.
R6. (risk) a bridge with no folder for a handed-back job started seq at 1 and lost every update: posts_take clears seq.
R7. (risk) the backfill left live as it was: restored where accepted and not released.
R8, R9. (nits) accept-text clause accepting CREATED 0; wording for a non-Go listener on the port.
