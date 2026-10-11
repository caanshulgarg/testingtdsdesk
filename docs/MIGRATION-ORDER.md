# Cloud migrations: the order they run in

The cloud copy's SQL lives in `server/tally-cloud/migration-*.sql`. Each file is add-only (nothing dropped, deleted or
revoked; `begin; ... commit;`; safe to run twice) and is shown to the owner before it runs on staging
(project `qbocskaiewaxqcvaunzc`). From migration 32 on, the files depend on one another, and one pair is order-sensitive.

## What staging really has (read on 03-Oct-2026, evening; project `qbocskaiewaxqcvaunzc`, read-only)

- 32, 33, 35 as in the tree; **34 as FIRST written (commit `2105b2d`)**, not the reviewed one (`0aaaf23`): a 7-argument
  `tally_ledger_round_batch`, `tally_ledgers_mark_gone(book, round, gone)` from the bridge's list, the guard's rule inline,
  no `tally_ledger_hold_reason`, no `tally_ledger_round_seen`, `tally_ledger_rename` without the cascade; `tally_ledgers`
  without `renamed_at` / `seen_round` / `seen_at` / `before_clean`, `tally_ledger_rounds` without `seen_n`,
  `tally_ledger_day` without `raw_ledger` / `merged_into` / `before_clean`. The text as run is kept in
  `tests/fixtures/migration-34-as-run-on-staging.sql` (not a file to run).
- **36b and 37 run on 03-Oct** (in that order). **36 was held** because it did not fit the first 34; it is rewritten
  (round 9) against that state and runs next, then **38**.

## The two valid orders (both end with the same function texts: `tests/run_migration_order.py` asserts it)

- staging: 32 → 33 → 35 → 34 (first) → 36b → 37 → 36 → 38 → 39 (applied 03-Oct, **except 39's tally_ingest_day part**: both forms are still 38's) → 40 → 41 (run 03-Oct, evening; its 8-argument `tally_ingest_day` superseded 39's) → 42 → 43 (run 04-Oct) → 44 (run 04-Oct) → 45 (run 04-Oct) → **46** → **47** → **48** (run by the owner) → **49** → **50** (run by the owner) → 51 → 52 → 53 → 54 → 55 → 56 (live on staging) → 57 → 58 → 59 → 60 → 68 → 70 → 62 → 63 → 64 → 65 → 66 → 67 (2.4.0, not run)
- a fresh database: 32 → 33 → 35 → 34 (reviewed) → 36 → 36b → 37 → 38 → 39 → 40 → 41 → 42 → 43 → 44 → 45 → 46 → 47 → 48 → 49 → 50 → 51 → 52 → 53 → 54 → 55 → 56 → 57 → 58 → 59 → 60 → 68 → 70 → 62 → 67 → 63 → 64 → 65 → 66

| # | File | What it adds |
|---|---|---|
| 32 | `migration-32-sync-safety.sql` | the posting ids (`tally_post_ids`), the company lease, the sync cursor and rewind guard, `deleted_at` / `origin` / `tally_guid` / `alter_id` on entries and ledgers, voucher versions, the `tally_balances` view |
| 33 | `migration-33-ledger-lists.sql` | ledger lists and marks (`tally_ledger_lists`, `tally_ledger_marks`, the mark log trigger), `tally_balances` without deleted ledgers, the year's openings in any capitals, `tally_ingest_ledgers_list` / `_g` with the list's source |
| 35 | `migration-35-bridge-control.sql` | Stop reading / Resume (`tally_read_stops`, `tally_read_stop`, `tally_read_resume`) and the staged-release table `tally_bridge_releases`. It no longer defines the release functions (see the rule below) |
| 34 | `migration-34-ledger-safety.sql` (reviewed; staging has the first text) | the guard, rounds (`tally_ledger_rounds`), renames by GUID, full lists marking only when declared complete, and in **part E** the release functions `tally_release_pilot` / `tally_release_approve` with the allow-list check (`pilot_allowlist_measured`) |
| 36 | `migration-36-ledger-rename.sql` (rewritten round 9) | brings the first 34 to the reviewed design and adds the rename cascade: the columns above if missing; `tally_ledger_hold_reason` (nil twin day rows are not entries) and `tally_ledgers_a_guard` calling it; the 8-argument `tally_ledger_round_batch` (counts only, `seen_n`) with the 7-argument one as a wrapper; `tally_ledger_round_seen`; the 2-argument seen-based `tally_ledgers_mark_gone` beside the live 3-argument one; `tally_ledger_rename` + `tally_ledger_carry` (lines, bills, party, twins, day totals follow the name; TB before/after must tie; a merge succeeds, the old row empty); the six readers that list names from `tally_ledger_day` (`tally_tb`, `tally_period`, `tally_mis`, `tally_gst_summary`, `tally_ledger`, `tally_balances_on`) copied from 37 with `d.merged_into is null`, so the twins are hidden there. Its header says what staging had on 03-Oct |
| 36b | `migration-36b-post-acceptance.sql` (run on staging 03-Oct) | an id Tally accepted is never freed by `tally_post_ids_sync` (`accepted_at`, stamped through `tally_post_id_accept` by tally-ingest); the owner's `tally_post_job_mark_posted` and `tally_post_id_release_owner` (append-only `tally_post_marks`); `released_at` / `released_by` / `released_why`; never sent again: `tally_post_job_accepted`, the trigger `tally_post_jobs_resend_guard`, `tally_post_requeue` holding a stale accepted posting; `tally_post_id_match`; `tally_post_take` clearing `seq`; `tally_post_jobs.seq`; `tally_post_enqueue`'s Retry refusing a live id elsewhere; the backfill of `accepted_at` / live |
| 37 | `migration-37-follow-ups.sql` (run on staging 03-Oct) | the migration-32 follow-ups (id release, versions with lines, baseline clear, soft delete in `tally_ingest_day`, lease release, balances as on a date, the FinCom tag column, withdrawn releases); its readers carry the same `d.merged_into is null` filter as 36's copies, so either order ends identical |
| 38 | `migration-38-post-followups.sql` | `tally_post_ids_sync` keeps an id live when the posting's results / items carry an acceptance for it (`tally_post_job_accepted`), stamped or not; `tally_post_marks`' two foreign keys re-made ON DELETE RESTRICT (a job with a mark cannot be deleted); `tally_ingest_day` marks nothing on a short read (no entries, or fewer than `p_n`), answering `refused: 'short read: n of p_n'` (tally-ingest logs it) |
| 39 | `migration-39-rename-map-empty-day.sql` | (1) `tally_ledger_rename` also carries the saved choices keyed by the ledger's name in the same transaction (`tally_ledger_carry_choices`: client_book_items `map` / `ledInfo` / `gstins` / `pans` items `'.' || name` — new-name item added, old kept and marked `carriedTo`, a clash noted; `clients.data->'choices'`: `flow:<new>` added, choice values that were the old name take the new one with `prev`), flags `tally_ledgers.needs_confirm` and `before_clean.renamed[].confirm: true`; the owner clears it with `tally_ledger_rename_confirm(book, name)`; (2) `tally_ingest_day(…, p_empty boolean)` (8 args; the 7-arg one passes null): `p_n = 0` with `p_empty = true` marks the day's entries deleted (`empty: true`), without the flag a short read as 38; (3) `tally_post_ids_sync` keeps an id live when its result or item is confirmed or ok, stamped or not. Ledger names FinCom keeps elsewhere and NOT carried (the browser's BankDB rules, a bill's snapshot lines, posting payloads, snapshots): listed in the file's header |
| 40 | `migration-40-states-carried.sql` | `client_book_items.carried jsonb`: `tally_ledger_carry_choices` carries `states` too and marks every old item in `carried` = {to, at} instead of writing into `data` (the app's value stays byte-identical); `tally_ledgers.state` (Tally's LEDSTATENAME, the bridge's 10th column, upserted by tally-ingest's ledger_list when sent); `tally_post_result_taken` with `tally_post_result_confirmed` kept as its wrapper, `tally_post_job_accepted` and `tally_post_ids_sync` re-created calling it (behaviour unchanged). Does not touch `tally_ingest_day` |
| 41 | `migration-41-day-counts.sql` | the security review of rounds 9-11: `tally_post_result_accepted` / `tally_post_job_accepted` never read a `postOnly: true` refusal as an acceptance (a company may be named "Created 1 Pvt Ltd"); `tally_days.empty_at` / `note`: the 8-argument `tally_ingest_day` (39's text, superseded here; the 7-argument wrapper kept) records an empty read when it marks, and a day that held more than 25 entries is emptied only on the second consecutive empty read (the first is refused `'empty day with N entries before: confirm by a second empty read'`, `emptyPending: true`); `tally_ledger_carry_choices` treats a soft-deleted new-name item as a clash (never revived). tally-ingest sends the bridge's own day count as `p_n` (M3), so the short-read guard can fire |
| 42 | `migration-42-empty-day-second-read.sql` | the owner's decision after 41 ran on staging: the 8-argument `tally_ingest_day` (41's text, superseded here; the 7-argument wrapper untouched) empties a day on an empty read the bridge vouches for only on the SECOND consecutive empty read, for ANY day that still has live entries (41: only more than 25); the first is refused `'empty day with N live entries: confirm by a second empty read'` (`emptyPending: true`) and recorded in `tally_days.empty_at` / `note`; decided by `empty_at` and the live count in `tally_vouchers`, never by `tally_days.n`, which an empty file that marked nothing (a refused first read, a short read) no longer zeroes; a short read in between neither sets nor clears `empty_at`; only a file with entries clears it. The 24-hour cap: an empty read is refused (`emptyCapped`, nothing recorded) while the book has 10 or more days with an empty read recorded in the last 24 hours that had something to mark, so a round that lists no entries for a book with entries records at most 10 days as pending and never marks; a genuine emptying of up to 9 days still marks on the second read. Never run 38's, 39's or 41's `tally_ingest_day` texts after 42 |
| 43 | `migration-43-posting-reply.sql` | build 2.1.8 (round 15, posting by Tally's reply). (1) The cap gap: the 8-argument `tally_ingest_day` (42's text, superseded here, byte for byte but the count; the 7-argument wrapper untouched): pend counts every PENDING day of the book however old (`empty_at` set, the note starting `empty day with`) plus the days an empty read MARKED in the last 24 hours; a read fault repeating every 25 hours records at most 10 days once and then refuses every day of the book, the live count unchanged; a genuine emptying of up to 9 days still marks on the second read. (2) Per-computer posting settings (owner item F3): `tally_devices.post_only` jsonb (null = no restriction, `[]` = any company, else the names) / `post_batch_bills` / `post_batch_bank` (1..500) / `post_settings_at` / `post_settings_by`, set by the owner's `tally_device_post_settings(device, post_only, bills, bank)` (null leaves a value; `'null'::jsonb` clears post_only; refusals in words; the four values answered; granted to authenticated, the columns readable by the firm); tally-ingest's beat answers them as `settings`. (3) Tally's reply ids: `tally_post_ids.reply_vch` (NOT `vch`: 36b's `tally_post_id_accept` and `tally_post_job_mark_posted` declare a local `vch`, and a column of that name would make them ambiguous in PL/pgSQL) / `batch_end` / `batch_n` / `matched_at` / `matched_vch` (the last two for the later comparison; nothing writes them yet); `tally_post_id_accept_reply(job, id, vch, batch_end, batch_n)` (service role; calls 36b's `tally_post_id_accept`, unchanged) stamps `accepted_at` if null, `accepted_vch` / `reply_vch` when batch_n = 1, `batch_end` / `batch_n` always. (4) The reply states: `tally_post_result_taken` also true for `byReply` + `ok` and for `needsReview` + `accepted`; `tally_post_job_settle` (same arguments) counts a `byReply` ok result as posted and `needsReview` results as needing review (done without checking; everything failed stays failed; the answer carries `review` and `message` 'Posted N of M; K need review'); `tally_post_job_accepted` (41's text) reads `needsReview` + `accepted` as accepted-not-confirmed (the resend guard holds); `tally_post_ids_sync` unchanged (40's text), a `needsReview` + `accepted` id and a `byReply` ok id stay live. (5) `tally_post_jobs.timing` jsonb (the bridge's request timings, written by posts_update). Never run 42's `tally_ingest_day` text after 43 |
| 44 | `migration-44-recorder.sql` | phase 2, the Tally change recorder. The key of an entry stays Tally's voucher GUID per book (a FinCom posting matched by its FinCom id on top). (1) One entry path (owner item 95): `tally_ingest_entries(book, vouchers, lines)` (service role; each voucher with its own `day`; versions with lines first, upsert, a version per AlterID, lines and bills replaced, the cache of every day touched rebuilt through `tally_ledger_day_rebuild`); the 8-argument `tally_ingest_day` (43's text, superseded here; the 7-argument wrapper untouched) keeps every day rule of 43 and calls it (it marks before handing the entries over); `tally_voucher_version_lines` re-created with the owner's-release setting beside the service role. (2) `tally_ingest_delete(book, guid, alter, cancel, source)`: deleted (soft) or cancelled (not deleted), versions kept, the day's cache rebuilt; older AlterID stale; unknown GUID held. (3) `tally_recorder_lines` (RLS; one row per arrival; a partial unique index on the applied rows keeps the same change applied once; a second arrival, or the copy already at that AlterID, is `duplicate`). (4) `tally_recorder_apply(firm, book, device, lines)` (service role): created/altered/imported through the entry path, deleted/cancelled through the delete, `ledger_renamed` through `tally_ledger_rename`, `ledger_created`/`ledger_altered` held for the next ledger list, `ledger_deleted` soft through the guard; no GUID held, never a new row; a FinCom posting stamps `tally_post_ids.matched_at`; answers per line {line_id, state, why}; keeps `tally_sync_cursor.recorder_max_alter`. (5) `tally_month_locks` + the owner's `tally_month_lock` / `tally_month_unlock` / `tally_recorder_release_held`; the rule `tally_month_locked` is read by the entry path, the delete and `tally_ingest_day` (a day of a locked month stores nothing: refused `month locked: YYYY-MM`). (6) `tally_tieouts` + `tally_tieout_save` (members save, the owner ticks). (7) The starting point: `tally_start_point` on `tally_sync_cursor` (once per book and company GUID; a new GUID resets it, needs_baseline as today; **this rule is replaced by 46**: another GUID never moves the point, only the owner's baseline clear starts it again). (8) ALTER FUNCTION ... SET search_path on the ten functions of the audit; `tally_device_post_settings` says `(% given)`. (9) A PC without the add-on: `tally_recorder_gap_check(book, device, altvchid, at)` (the beat) stores `tally_sync_cursor.gap` (`missing` / `missingMax`: UP TO N changes not received since the last match, an upper bound since each change raises ALTVCHID by at least one) / `gap_at` / `last_match_at`; `tally_recorder_silent(firm)` (the app) lists computers with Tally open today and no line for a working day. Never run 43's `tally_ingest_day` text after 44; a later CREATE OR REPLACE of the ten functions must carry the SET |
| 45 | `migration-45-bulk-posting.sql` | bulk posting with the recorder loaded (docs/recorder-bulk-posting.md 3 and 4); runs after 44. (3) `tally_post_windows` (RLS, the firm reads; one row per job: firm, book, job, device, `a0` / `a1` = ALTVCHID before / after the job, `created_vch` / `created_mst`), filled by `tally_post_window_save(firm, job, device, a0, a1, vch, mst, guid)` (service role; 0..10^15, a1 not below a0, the job of this firm and computer, no more created than its payload held, none for a cancelled job, a finished job's window kept as first saved; the company GUID kept; refusals answered `{ok: false, error}`); `tally_recorder_gap_check` (44's, same arguments) subtracts FinCom's own postings: windows of the book's own company GUID above the baseline count their part between the baseline and Tally's number now, at most the vouchers created and only what must be FinCom's (K = a1 - a0 - vouchers created left out, named 'up to K changes not received during the posting of <time IST>'); another GUID's window is named, not counted; without a window, the fallback subtracts the vouchers accepted after the server's time of the newest thing that set the baseline (`match_at`, the last recorder line that raised it, the day read with the highest AlterID; else the start) not matched and not in the copy (even marked deleted), naming 'of which up to k may be FinCom's own new ledgers' when the postings created masters; a recorder-matched entry is counted once (it is in `recorder_max_alter`); the number of the last matching check under the same starting point (`tally_sync_cursor.match_alter` / `match_start`) joins the baseline, so the next beat after a match is quiet; a number below it read after that match is needs_baseline (a restore); everything else of 44 kept. (4) `tally_post_ids.matched_guid` / `matched_mid` / `matched_alter`; `tally_recorder_line` (44's text plus the SHORT line: FinCom id as `fid` or in the narration, no body of its own) matches the live, accepted posting of the firm for this book (`tally_post_live_for`, internal), stamps `matched_*`, builds the entry once by GUID from the body tally-ingest made from the posted XML (`tally_post_xml_for(firm, book, fids)`, service role), holds 'FinCom id <id> matches no posting of this firm' (never a new entry), holds a matched line without a body (stamped) and a FinCom id already matched to another GUID; builds from the posting only a short `created` / `imported` line of an entry the copy does not hold (a short `altered` one, or one for an entry held, is held 'changed in Tally after posting'); the spelling match through three indexes on `tally_post_ids`; a short line held before its posting's acceptance is re-run by `tally_recorder_short_held` / `tally_recorder_short_retry` (service role) from `posts_update`; a full line also stamps the GUID / MasterID / AlterID, on the live row of this book's company only. (R) `tally_recorder_lines` added to the `supabase_realtime` publication once. (D) nothing is deleted: the foreign keys of `tally_recorder_lines`, `tally_month_locks` (CASCADE) and `tally_tieouts` (SET NULL) to `tally_books` become ON DELETE RESTRICT (38's pattern: found in pg_constraint, dropped and added again; a second run changes nothing); `tally_post_windows` references `tally_books` and `tally_post_jobs` ON DELETE RESTRICT. Run on staging 04-Oct (see below) |
| 46 | `migration-46-trial-tools.sql` | round 19, the trial tools for any company (the owner's decision of 04-Oct): `tally_devices.trial_tools` boolean not null default false (every computer off) / `trial_tools_at` / `trial_tools_by` (readable by the firm, as 43's settings); the owner's `tally_device_trial_tools(device, on)` (the owner check of `tally_device_post_settings`: an active owner of the firm, the firm's computer not revoked; null refused; stamps at / by; answers `{ok, device, trialTools, at, by}`; revoked from public and anon, granted to authenticated). tally-ingest's beat answers `trialTools` from the column (false on a cloud without 46, no error); the bridge shows its five trial items only while it is on. (3) Review 46 H1: `tally_start_point` replaced (44's 7 arguments, SET and grants: the service role's alone). **44's rule "a new company GUID resets the starting point" is replaced**: a GUID other than the book's company GUID marks the book needs_baseline (`tally_sync_guard`, as today) and never moves the point (answers `otherCompany: true`, `set: false`, `bookGuid`); a point recorded without a GUID (the gap check's) gets the GUID stamped, its numbers and open gap kept; a point another GUID moved before 46 is kept and the book marked needs_baseline with words. The only way to a new starting point is the owner's `tally_baseline_clear` (37; it does not reset `start_at` / `start_guid`): a cursor cleared after its start (`cleared_at > start_at`) is recorded afresh by the next call, once, and the GUID it brings becomes the book's company GUID (gap, gap_at, last_match_at cleared). tally-ingest's beat skips the gap check for an `otherCompany` answer. Add-only, `set local lock_timeout = '10s'`, no `delete from` in the text. md5 of the function bodies (prosrc): `tally_device_trial_tools` 86245cc136112d0a014503871ea7ab24, `tally_start_point` 0e712617bafa07c99f4629bfb7074a83 |
| 47 | `migration-47-recorder-queue-alerts.sql` | round 20 part c, the cloud side of the live recorder (docs/cloud-recorder-plan.md); no "delete from" anywhere; `begin; set local lock_timeout = '10s'; ... commit;`. (1) The recorder queue: pgmq `tally_recorder` (made if missing); `tally_recorder_enqueue(firm, book, device, lines)` (service role; one message of 1..1000 lines); `tally_recorder_drain(budget_ms)` (service role and pg_cron; one message at a time through `tally_recorder_apply`, archived; a failing message read again after 120 s, its 5th failure archived and kept in `tally_recorder_failures` (RLS, the firm reads) with words); cron `tally-recorder-drain` every 30 seconds, plain SQL. (2) Alerts: `tally_alerts` (RLS, the firm reads, nobody writes; one per firm, kind gap / silent / summary, book, computer and India's day: the unique index `tally_alerts_once` on expressions); `tally_alert_scan_gaps()` (each book's `tally_sync_cursor.gap`), `tally_alert_scan_silent()` (`tally_recorder_silent` per firm; inside Mon-Sat 09:00-19:00 IST only, `tally_alert_working_now`), `tally_alert_daily_summary()` (per firm: lines applied / held / failed today, queue failures, open gaps, postings done / failed, entries needing review) - they read and write alert rows only (granted to nobody; pg_cron runs them); `tally_alert_read(id)` (members of the firm); cron `tally-alert-gaps` `*/10 * * * *`, `tally-alert-silent` `*/30 3-13 * * 1-6` (UTC: 08:30-19:00 IST; the 08:30 run is skipped by the working-hours check), `tally-alert-summary` `30 13 * * *` (19:00 IST). (3) `tally_devices.recorder_source` text not null default 'addon' check in ('addon', 'alterid', 'both') (+ `_at`, `_by`), the owner's `tally_device_recorder_source(device, source)`; the beat answers `recorderSource`. (4) `tally_recorder_line` = 45's text + a `ledger_altered` line whose GUID the copy holds under another name -> `tally_ledger_rename`. (5) Storage bucket `tally-uploads` (private, 2 GB), policies `tally_uploads_add` / `tally_uploads_read` (members, under `<firm id>/` only; no update / delete); `tally_jobs.upload` jsonb (added) and kind 'upload' (the one CHECK on `tally_jobs.kind` swapped in ONE `alter table` for the same name with 'upload' added - a CHECK cannot be widened by adding another; widening only, nothing can be refused; only while it lacks 'upload') |
| 48 | `migration-48-day-cache-once.sql` | round 20 part c, "the database fix" (docs/cloud-recorder-plan.md 1); **contains "delete from"** (44's `tally_ingest_entries` text, which replaces a re-sent entry's lines and bills): posted whole for the owner to run in the SQL Editor. `tally_ingest_entries(book, vouchers, lines, p_rebuild boolean)` (44's text; false: the days touched are answered, not rebuilt); the 3-argument form stays and calls it with true; `tally_recorder_line` = 47's text, inside `tally_recorder_apply` (the transaction-local `fincom.day_rebuild_once`) it calls the 4-argument form with false and returns the days; `tally_recorder_apply` rebuilds the collected days ONCE after the loop (before a ledger line, which reads the balances, the days so far first). The owner's condition (identical trial balance and md5 of the whole `tally_ledger_day`, old against new, for a single entry, 500 lines on one day and a send over 30 days) is `tests/run_migration48.py` |
| 68 | `migration-68-alert-dismissals.sql` (08-Oct-2026, "clear notifications"; branch `next-alerts-clear`; **run on staging by the owner**, md5 184e7959…; never edited) | the notifications a person cleared: `app_alert_dismissals` (firm_id, user_id, alert_key, fingerprint, words, batch, cleared_at, undone_at; row security: a person reads and adds only their own rows in their own firm; no update or delete for authenticated); `alert_dismiss(p_items jsonb)` (one batch a Clear; the same key + fingerprint not added twice; at most 500), `alert_dismiss_undo(p_batch uuid)` (stamps undone_at on that Clear's own rows: kept, never removed), `alert_dismissals_list()` (own, not undone, newest first). Needs only members and my_firm(): independent of 61-67 and 69 (other branches), runs after 60 in either order. Add-only, one transaction, `lock_timeout` 10 s, no "delete from", safe twice. Tested by `run_migration68.py` and `run_migration_order.py`. Until it runs, the app keeps the cleared notifications in each browser (no error shown). |
| 70 | `migration-70-alert-dismissals-tighten.sql` (08-Oct-2026, the review of next-alerts-clear: M2, L(a); NOT yet run on staging) | after 68: INSERT on `app_alert_dismissals` revoked from authenticated (the only way in is `alert_dismiss`, security definer, with its caps; SELECT and the policies kept); CHECK constraints `app_alert_dismissals_key_len` / `_fp_len` (<= 2000) and `_words_len` (<= 500), added NOT VALID then VALIDATEd; `alert_dismissals_list()` lists up to 20000 rows (68: 5000). Add-only (a revoke, three constraints, one function's text), one transaction, `lock_timeout` 10 s, no "delete from", safe twice. Tested by `run_migration70.py` and `run_migration_order.py`. |
| 62 | `migration-62-tds-rate-worked-out.sql` (FinCom 2.4.0, branch `next-tds`; NOT run) | `tally_tds_lines.rate_worked_out` and `tally_ingest_details` (57's text, lines marked "62"): the TDS rate worked out where Tally stores 0, marked so (the owner's decision of 07-Oct-2026, option A) |
| 63 | `migration-63-recorder-repeat.sql` (FinCom 2.4.0, branch `next-outbox`; NOT run) | `tally_recorder_line`: the ONE combined text with 67 (lines marked "63": a repeat of a line FinCom has answered 'duplicate', already: true; lines marked "67"); index `tally_recorder_lines_line` (book_id, line_id), not unique |
| 64 | `migration-64-pages-live.sql` (FinCom 2.4.0, branch `next-realtime`; NOT run) | `tally_book_changes` (RLS) written by statement triggers (`tally_book_changed`) on the copy's five tables; the Realtime publication gets it and three small tables |
| 65 | `migration-65-selfchecks.sql` (FinCom 2.4.0, branch `next-selfcheck`; NOT run) | `tally_selfchecks` (RLS) and `tally_selfcheck_compare` / `_copy` / `_record` / `_words`: the nightly self-check's records |
| 66 | `migration-66-recorder-masters.sql` (FinCom 2.4.0, branch `next-masterhook`; NOT run) | `tally_recorder_masters` and `tally_recorder_masters_save`: the add-on's Pay Head, Stock Item and Godown lines (heads only) |
| 67 | `migration-67-recorder-renumbered.sql` (FinCom 2.4.0, branch `next-renumber`; NOT run) | `tally_recorder_line`: the SAME combined text as 63 (lines marked "67": a renumbered entry applied with Tally's number); 63's index if missing |
| 72 | `migration-72-gst-type.sql` (11-Oct-2026, FinCom Bridge 2.4.2, branch `next-gsttype`; file md5 885fc1ee46b8facb17173dfa560d9c4f; NOT yet run on staging) | after 62 (staging has 62's tally_ingest_details, prosrc md5 641618d1a6af1baf42a2ed5b1470df7e): nine columns on `tally_vouchers` (gst_reg_type, gst_country, gst_rcm, gst_nature, gst_taxability, gst_supply, gst_ineligible, gst_mixed, gst_alter_id; null: not read yet), `tally_ingest_gsttype(book, vouchers)` (new; security definer, search_path public, pg_temp, granted to nobody: writes a voucher's "gst" object onto the entry stored at exactly that AlterID, with gst_alter_id; a voucher without "gst" leaves it as it is, gst_alter_id then below the entry's alter_id) and `tally_ingest_details` (62's text with ONE line added, marked "72", calling it). Add-only, one transaction, lock_timeout 10 s, no "delete from", safe twice. Tested by `run_migration72.py` (the real TallyPrime 7.1 entries through the Day Book path and the bridge 2.4.2 bodies through the recorder path) and `run_migration_order.py`. Deploy order: run 72 BEFORE the tally-ingest of 2.4.2 (that tally-ingest sends "gst"; without 72 it is ignored). |

Run on staging (corrected 04-Oct-2026, evening):
- 43 by the owner on 04-Oct-2026 (the seven function bodies checked against this file by md5 of prosrc: identical).
- 44 by the owner on 04-Oct-2026, verified by md5 of prosrc against this file: identical.
- 45 by Claude on 04-Oct-2026, verified by md5 of prosrc against this file: identical. The owner's instruction of 04-Oct named the three tables of its RESTRICT swap
  (tally_recorder_lines, tally_month_locks, tally_tieouts).
- tally-ingest **v33** deployed on 04-Oct-2026 from commit `2aa42bd` (v31 was the deploy after 43).
- 46: written 04-Oct-2026 (round 19), not yet run on staging. It runs after 45; tally-ingest does not depend on it (without
- **50: run on staging by the owner on 05-Oct-2026 (~10:00 IST; Claude's tool timed out on the whole file, so the owner ran it in the SQL Editor; Claude had applied part 50b and the state CHECK, both identical text). All five function md5s checked by Claude: tally_recorder_line 8ac8ea2d, tally_ingest_delete 09ec611a, tally_recorder_apply 25f02b91, tally_recorder_release_day b44bd07e, tally_days_recorder_release 4248dcfb; two statement triggers on tally_days, two held indexes, state CHECK with 'replaced'; the four held lines carry the new words; 4,016 live entries, ledger-day total 0.00.** migration-50-parts/ holds the same text in four pasteable parts.
- **49: run on staging by Claude on 05-Oct-2026 (~00:55 IST) from 80ec84c (no "delete from"); its five function md5s matched the file
  (tally_post_row_keys 2f42d410, _hide f0a7ea24, _remove a194932e, _restore 92460317, _flags_now ef30d9c5).** Runs after 48.
- **47: run on staging by Claude on 04-Oct-2026 (~19:45 IST) from d41237f; all 19 function md5s matched the file; cron jobs listed;
  the drain and the gap scan ran under pg_cron and succeeded. 48: run by the owner on 04-Oct-2026; its five md5s matched; figures
  unchanged (2,754 live entries, 7,040 lines, ledger-day total 0.00). tally-ingest v35 deployed from d41237f, four files
  byte-identical (index.ts 16bb6760...).** History below.
- 47: written 04-Oct-2026 (round 20 part c). It runs after 46; Claude runs it after its review and checks
  md5(prosrc) of its nine functions against the file (the numbers are printed by `tests/run_migration47.py`, and listed in the
  round's report), then lists `cron.job` (four jobs: tally-recorder-drain `30 seconds`, tally-alert-gaps `*/10 * * * *`,
  tally-alert-silent `*/30 3-13 * * 1-6`, tally-alert-summary `30 13 * * *`) and runs one gap scan. tally-ingest (round 20) works
  without it: more than 50 full lines are applied directly (no queue), upload_new answers 'unknown kind' (the app hands the file
  over the old way), the beat leaves out recorderSource.
- 48: written 04-Oct-2026 (round 20 part c); it holds "delete from", so it is posted whole for the owner to run in the SQL
  Editor, after 47. tally-ingest does not depend on it (the same calls; 48 only makes tally_recorder_apply faster: 500 lines on
  one day 19.0 s -> 3.7 s on the stand).
  the column the beat answers `trialTools: false`; without 46's `tally_start_point` the answer carries no `otherCompany` and
  44's rule applies: another GUID moves the point). Run 46 before deploying the round-19 tally-ingest. After it runs, check
  md5(prosrc) of `tally_device_trial_tools` and `tally_start_point` against the numbers in the table above.

## tally-ingest (server/tally-cloud/index.ts): which kind calls which function, with which arguments

| Function | Arguments | Called by (kind) |
|---|---|---|
| `tally_ledger_round_batch` | `p_book uuid, p_round text, p_rows int, p_rows_read int, p_complete bool, p_device uuid, p_bridge text, p_seen jsonb` (8; the 7-argument one is a wrapper) | `ledger_list`, every batch |
| `tally_ledger_rename` | `p_book uuid, p_guid text, p_from text, p_to text` | `ledger_list` (renames, and a GUID met under another name) |
| `tally_ledger_round_seen` | `p_book uuid, p_round text, p_seen jsonb` | `ledger_list`, after the upsert of the batch's rows |
| `tally_ledgers_mark_gone` | `p_book uuid, p_round text` (2; the 3-argument one is the first 34's, untouched) | `ledger_list`, the last batch of a round |
| `tally_ingest_ledgers_g` | `p_book, p_from, p_open_as_on, p_ledgers, p_groups, p_list, p_complete, p_count` (8; 6 and 5 as fallbacks) | `ledgers` (a full list) |
| `tally_year_openings` | `p_book uuid` | `ledger_list` (rows added or openings changed), `ledgers` |
| `tally_ingest_day` | `p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n int, p_alter bigint, p_bytes int` (+ `p_empty bool` when the bridge sends `empty: true`; 39) | `days` (and the re-read of kept files) |
| `tally_recorder_apply` | `p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb` (44) | `recorder_lines` (each line cleaned; the add-on's `xml` read with parse.js into `vouchers` / `lines`) |
| `tally_start_point` | `p_firm uuid, p_book uuid, p_guid text, p_altvch bigint, p_altmst bigint, p_device uuid, p_bridge text` (44; replaced by 46, same arguments) | `start_point`; and (round 19) `beat`, once per company with a GUID and an ALTVCHID per 5 minutes, before the gap check (the bridge's `startPoint` numbers when of that GUID, else the numbers now); an `otherCompany` answer (46): no gap check for that company, logged once |
| `tally_recorder_gap_check` | `p_book uuid, p_device uuid, p_altvchid bigint, p_at timestamptz` (44; 45 replaces it, same arguments) | `beat`, once per company carrying `altvchid` (at most 20), read from `companies[]` first, else the top-level `changeNumbers` of bridge 2.1.9 (round 19); a zoneless time from the bridge is IST; a failure logged with the company (a missing function once per cold start) |
| `tally_post_window_save` | `p_firm uuid, p_job uuid, p_device uuid, p_a0 bigint, p_a1 bigint, p_vch bigint, p_mst bigint, p_guid text` (45; 8 arguments since the review, the 7-argument form never ran) | `posts_update` carrying `window` {a0, a1, vouchersCreated, mastersCreated, guid}, after the update's own checks and its row stored (bounds checked first; a bad one logged and ignored) |
| `tally_recorder_short_held` / `tally_recorder_short_retry` | `p_firm uuid, p_job uuid` / `p_firm uuid, p_book uuid, p_lines jsonb` (45) | `posts_update` with an acceptance: the job's short lines held "matches no posting" are read, built from the posted XML, re-run on the same rows |
| `tally_recorder_enqueue` | `p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb` (47) | `recorder_lines` carrying more than 50 full lines (an entry body read from the xml): the cleaned lines as ONE message, answered `{queued: n}`; a cloud without 47: `tally_recorder_apply` as before |
| `tally_work_send` (kind upload) | `p_msg jsonb`: `{job, firm, book, upload: {path, size, from, range, ...}}` (13; 47's `tally_jobs.upload` and kind 'upload') | `upload_done` (the split's first piece) and each split piece (the next piece; the day files as the existing `{days: [{day, gz}]}` pieces) |
| `tally_post_xml_for` | `p_firm uuid, p_book uuid, p_fids text[]` (45) | `recorder_lines`, once per call carrying short lines (their FinCom ids); the XML read with parse.js into the lines' bodies |
| `tally_post_take` | `p_device uuid` | `posts_take` (the answer carries the owner's releases in force) |
| `tally_post_id_accept` | `p_job uuid, p_id text, p_vch text` (`p_at` unused, kept in the signature) | `posts_update`, once per accepted id not yet stamped or released (a `needsReview` + `accepted` result among them; and the fallback for a `byReply` ok result when 43 is missing) |
| `tally_post_id_accept_reply` | `p_job uuid, p_id text, p_vch text, p_batch_end text, p_batch_n integer` (43) | `posts_update`, once per `byReply` + `ok` result not yet stamped |
| `tally_post_id_release` | `p_job uuid, p_id text, p_why text` | `posts_update`, once per refused / not-found id not yet released |
| `tally_lease_take` / `tally_lease_release` | as migration 32 / 37; with 55 the 7-argument `tally_lease_take(..., p_purpose)` when the bridge says `purpose` (else the 6-argument one) | `lease_take` / `lease_release` |
| `tally_post_checks_for` / `tally_post_check_report` | `p_device uuid, p_bridge text, p_main boolean` / `p_check bigint, p_device uuid, p_bridge text, p_main boolean, p_company text, p_result text, p_vch text, p_master text, p_words text` (55) | `beat` (counted with the postings), `posts_take` (`checks`), `post_check` |
| `tally_read_stop` / `tally_read_resume`, `tally_release_*`, `tally_baseline_clear`, the owner's `tally_post_job_mark_posted` / `tally_post_id_release_owner` / `tally_ledger_rename_confirm` / `tally_device_post_settings` (43), `tally_month_lock` / `tally_month_unlock` / `tally_recorder_release_held` / `tally_tieout_save` / `tally_recorder_silent` (44), `tally_device_trial_tools` (46), `tally_device_recorder_source` / `tally_alert_read` (47, the app), the readers | members (the app), not tally-ingest | — |

## The rule: never re-run 35 after 34

Migration 34 was written after 35 and replaces the two release functions with the allow-list check. Running the old
migration 35 after 34 put back the older functions without that check (staging, 02-Oct: 32, 33, 35, 34, a revised 35,
then 34 part E again by hand). So:

- the two functions were **taken out of migration 35** (round 4); they live in migration 34 part E only, and the top of
  the 35 file says so;
- on a fresh database 35 still runs **before** 34 (34 needs `tally_bridge_releases` and `tally_devices`);
- **never run 35 after 34.** If it happens anyway, run 34 again at once;
- `tests/fixtures/migration-35-as-run-on-staging.sql` is the text as it ran on staging, kept as history (run_migration34
  loads it to start from staging's state); it is not a file to run.

## How to test the order

`python3 tests/run_migration_order.py` (pg_stand: a throwaway PostgreSQL, never staging; the pgmq, pg_cron and Storage pieces 47 needs
made plain by run_migration47.py's SCHEMA47) applies BOTH orders above, each
twice on its own database, over made-up rows and asserts (round 9: the function texts the two orders end with are identical;
38's sync and `tally_ingest_day` in force; the marks' keys restrict; round 5: an id Tally accepted stays live through a failed
or cancelled posting under the sync in force): every file runs twice and deletes nothing; `tally_release_approve` is
migration-34's (`pg_get_functiondef` contains `pilot_allowlist_measured`) and `tally_release_pilot` clears it; the 35
file no longer contains `create or replace function public.tally_release_`; migration-36's functions are there; every
function of 35, 34 and 36 is security definer with `search_path = public, pg_temp`. It runs in CI (`tests/ci/tests.txt`).

Each file also has its own test: `run_migration32.py`, `run_migration33.py`, `run_migration34.py` (starts from staging's
state: the 35 as run there, then 34), `run_migration35.py` (35, then 34 after it for the release checks),
`run_migration36.py` (staging's order with the first 34, then the made-up books through the real ingest path, the renames, the
readers without a zero line for an old name, the first round), `run_migration38.py` (staging's order then 38: ids live by
the words, marks never cascade, short reads mark nothing), `run_migration39.py` (the made-up books: a GST ledger's rename keeps
the GST summary, the owner's confirm, the empty-day flag, ids live by a confirmation), `run_migration40.py` (string- and object-valued
items carried with `carried` set and data untouched, the clash, the taken/confirmed names, a version row without lines filled on the next read),
`run_migration41.py` (PostOnly never accepted, the empty-read record and its cap, a deleted item never revived),
`run_migration42.py` (the second empty read for any day with live entries, n never zeroed by a read that marked nothing, a short read in between, the record cleared by a file with entries),
`run_migration44.py` (run_migration43.py's own checks again with 44 applied after 43; the entry path, the delete, the recorder lines and duplicates, owner item 8 (an uploaded day then a recorder line, and the reverse: one row, versions kept, the trial balance unchanged), the same day book uploaded twice (nothing new) and again with one entry changed (updated in place, the old version kept), month locks on both paths, tie-outs, the starting point, the gap and the silent PC, the ten search_paths, RLS on every table of 32-44 and a search_path on every function), `run_migration45.py` (run_migration44.py's own checks again with 45 applied after 44; the posting window and the gap check: 100 posted with no recorder line gives no gap, with or without a window, the next beat too, a window not fully accounted named, never subtracted twice; 500 short lines matched and built once, again duplicate, the day book after them changing nothing; held when no posting matches; the realtime publication; the RESTRICT foreign keys; the review's scenarios G1-G7, G10, G12 and L4, L10, M6 by name, 500 unknown ids over 200,000 under 2 s, the lock timeout, the privileges under Supabase's defaults), `run_migration46.py` (46 twice and a third time: the column off for every computer, the owner on / off, staff, another firm, a revoked computer refused, the grants under Supabase's default privileges, no `delete from`, the md5 of each body; review 46 H1: two PCs' GUIDs alternating never move the starting point, a GUID-less start stamped with its gap kept, a point moved before 46 flagged, afresh once after the owner's baseline clear), `run_recorder_server.py` (tally-ingest's recorder_lines, start_point and the beat's change numbers under Deno, the database answering; round 19: both beat shapes, 2.1.9's top-level and 2.1.10's companies[], the start recorded once and 'up to 2 changes not received since', FinCom's postings still subtracted; review 46: two PCs of a same-named company never move the starting point and the other company gets no gap check, a GUID-less start stamped, tally_book_for once per company per 5 minutes, a check time ahead of now taken as now, the check's time from changeNumbers only and only the bridge's exact zone-less form read as IST; 45: posts_update's window with the company GUID, saved only after the update's checks, 500 short lines through parse.js, the day book after, a short 'altered' line never built from the posting, a held short line applied by the acceptance), `run_migration43.py` (a read fault every 25 hours for five nights marks nothing, a genuine 3-day emptying marks on the second read, the owner's posting settings, the reply stamp, the reply states in taken / settle / job_accepted / the sync, no new column named like a function's local),
`run_migration36b.py` (acceptance, the owner's mark and release, the four routes a posting Tally accepted can never be sent
again by: Retry, Post again, the requeue, a new posting for the same id), `run_migration37.py` (36b applied before 37).
Round 20: `run_migration47.py` (the queue in order, retries and failures with words, the drain as pg_cron runs it; the alert
jobs on a populated database leave every other table's md5 unchanged, one alert per kind, book or computer and day, read
marking by members only; recorder_source the owner's only; the bucket's policies; the rename by GUID; the upload job kind; run
twice and a third time; no "delete from"), `run_migration48.py` (the owner's condition, two databases old / new; the numbers
printed), `run_upload_split.py` (tally-ingest's upload kinds and byte-range split against the browser's split), and
`run_migration_order.py` with 47 and 48 in both orders.
Round 21 (docs/reviews/migration-47-48-review.md, all of H1 and M1-M8 fixed): `run_migration47.py` runs on the REAL pgmq
1.5.1 when it can be installed (its plain-SQL text from GitHub, made an extension of pg_stand; else the stand-in, said in
the first line; `PGMQ_STUB=1` forces it) and checks the book's order through `tally_recorder_send`, a failed send's lines,
alert and gap, the pg_cron procedure `tally_recorder_drain_run` under a statement timeout and a lock wait, the queue's
tables closed, the exact kind CHECK swap (and its refusal), the ledger rename's AlterID, `tally_upload_advance`, and L5-L8;
`run_migration48.py` also the 90-day archive retention (48 holds it: 47 removes no row), L6, L9, L10 and the rename rule
on both databases; `run_recorder_server.py` H1 through tally-ingest; `run_upload_split.py` M2-M5 and L2-L5. pg_cron's
'tally-recorder-drain' now runs `call public.tally_recorder_drain_run(15000)`; 48 adds 'tally-recorder-archive-trim'
(`17 21 * * *` UTC, 02:47 IST). Order unchanged: 47 after 46, 48 after 47.
FinCom Bridge 2.3.0 (05-Oct-2026): `migration-54-post-target-bridge.sql` runs after 53 in both orders (add-only, one
transaction, safe twice): `tally_post_jobs.target_bridge`, `tally_bridge_prefs` (changes only, per bridge),
`tally_member_bridges` (the member's bridge), `tally_post_enqueue_to` and `tally_post_take_for`. Tested by
`run_migration54.py` and `run_migration_order.py` (54 in both orders). tally-ingest works without it (the old hand-out).
Decisions B and D (05-Oct-2026): `migration-55-settle-and-lease.sql` runs after 54 in both orders (add-only, one
transaction, `lock_timeout` 10 s, no "delete from", safe twice). B: any member who may write (owner or staff) settles an
uncertain posting, a reason required, the name and time kept: `tally_post_job_mark_posted` (any member; `tally_post_mark_core`),
`tally_post_settle_ask` ("Not in Tally - post again": a row in `tally_post_checks` for the posting's own bridge; nothing
released, nothing sent), `tally_post_checks_for` / `tally_post_check_report` (the service role: tally-ingest's `posts_take`
carries the checks, `post_check` the answer): found -> marked posted with the voucher found; not found in that exact company
by the posting's bridge -> released (`tally_post_release_core`) and sent again once; Tally not asked -> keeps waiting.
`tally_post_id_release_owner` is refused without that "not found". D: `tally_company_lease.purpose` ('post' / 'read') and
`want_post_*`; the 7-argument `tally_lease_take(..., p_purpose)`: a posting finding a read records its want, the reader's
renewal hands the lease over, a posting never yields, a lease given up is kept for the waiting posting; the 6-argument
call (an older bridge) has no purpose and is never asked to yield. Tested by `run_migration55.py` and
`run_migration_order.py` (55 in both orders). tally-ingest works without it (the 6-argument lease; no checks).
FinCom Bridge 2.3.0 fix (06-Oct-2026): `migration-56-keep-fields.sql` runs after 55 in both orders (add-only, one
transaction, `lock_timeout` 10 s, no "delete from", safe twice; live on staging). A recorder line applied to an entry
loaded from a Day Book blanked what the live request does not fetch (GSTIN, place of supply, ref no. / date, company GSTIN,
a line's HSN / rate). `tally_ingest_entries(book, vouchers, lines, p_rebuild, p_keep)` (5 arguments, granted to nobody):
with `p_keep` true a blank sent value is filled from the stored entry (`tally_recorder_keep_vouchers`: GSTIN, pos, ref and
ref date only when the party is the same; the company GSTIN always; a malformed ref date passed as sent) and a line's blank
HSN / rate from the entry's current lines, ledger by ledger (`tally_recorder_pair_lines`, the same in the repair): one HSN
and rate on all the stored lines of the ledger -> carried to every line; else the same amounts as stored -> each line the
values of its amount; else blank), then 48's 4-argument form runs unchanged; a sent non-blank value always wins; an entry
marked `"full": true` (2.3.1 part A) is passed as sent: blanks included, as Tally has them (the owner, 06-Oct-2026: "let
blanks through for every field the 2.3.1 request fetches in full; keep the guard only for lines from a bridge older than
2.3.1 that did not ask for the field"). tally-ingest marks an entry so only when bridge 2.3.1 marks its line `"full": true`,
which it does only for a body that answers its own entry request (FinComVoucherByMaster / ByNumber, which asks for the party
GSTIN, place of supply, ref, ref date, company GSTIN and the lines' HSN and rate); never guessed from the body. A 2.3.0
bridge's line (no mark) is kept as before, and the repair skips a marked entry. A Day Book is never marked and stays
authoritative as before. 56 itself is unchanged (live on staging). No line order is used (`tally_lines` has no order column). `tally_recorder_line` = 53's text with that one
call passing `true`. 48's 4-argument and 44's 3-argument forms and `tally_ingest_day` are untouched: a Day Book stays
authoritative. The repair, not run by the migration: `tally_recorder_restore_fields(book, p_dry_run)` (service role /
owner; the 1-argument form restores): the dry run answers the count and the list (type, number, date, fields); the run
writes only blank fields from the latest earlier version (same party for GSTIN / pos / ref / ref date) when every later
version is a recorder one and the day was not read from a Day Book since, one row a restored field in
`tally_recorder_restore_log` (add-only, RLS, kept; run, entry, field, value, old blank, version AlterID, time), and answers
the live entry count and ledger-day total before and after. `tally_recorder_blanked(book)` lists the same read-only;
`tests/check_recorder_blanked.sql` is the plain read-only query (`psql -v book=<uuid>`, runs before 56 too).
`tally_unknown_ledger_entries(book)` (members; null: the firm's books): live entries naming a ledger FinCom does not have,
listed in plain words on Sync activity and the client's Books page. Tested by `run_migration56.py`,
`run_migration_order.py` (56 in both orders) and `run_unknown_ledgers_ui.py`.
FinCom Bridge 2.3.1 part A (06-Oct-2026): `migration-57-entry-details.sql` runs after 56 in both orders (add-only, one
transaction, `lock_timeout` 10 s, no "delete from", safe twice; NOT yet run on staging). It stores the whole entry the
2.3.1 request fetches and parse.js reads (one reader for the Day Book and the entry body): `tally_vouchers` + `irn`,
`irn_ack_no`, `irn_ack_date`, `eway_no`, `check_notes` (the accuracy checks' plain words, `[]` when none); the tables
`tally_ledgers.tds_deductee_type` (the party ledger master's TDSDEDUCTEETYPE, written by the ledger list once part B
fetches it); `tally_tds_lines.section_from` (the section is Tally's own from the entry's bill-wise detail
TDSDEDUCTEESECTIONNUMBER, else written in the nature of payment's name, else blank); `tally_tds_details(book)` (members of
the firm, as 56's unknown-ledger list: the TDS details with the deductee type the ledger has now); `tally_item_lines` (item, qty, unit, rate, taxable, HSN / SAC and GST rate Tally applied to the line, CGST / SGST / IGST /
cess worked out from the line's rate and taxable value: Tally 7.1 writes no tax amount per item line, `tax_basis` says
so), `tally_cost_allocs`, `tally_bank_allocs`, `tally_tds_lines` (RLS: the firm's members read; rows of an earlier version
marked `gone_at`, never removed); `tally_bills.due` (a due date given as a date). `tally_ingest_details(book, vouchers,
p_keep)` (granted to nobody) writes them, called by 56's 5-argument `tally_ingest_entries` after 48's 4-argument form; a
Day Book (`tally_ingest_day`, now through the 5-argument form with `p_keep` false) is authoritative, a recorder line
(`p_keep` true) never blanks a stored value. tally-ingest does not mark entries `"full": true`, so 56's keep stays in force
for the recorder path: a value removed in Tally reaches the copy by a Day Book upload. `tally_ingest_delete` = 50's text
but a delete or cancel of an entry never in the copy settles at once ("nothing to remove: the entry is not in FinCom's
copy and no longer counts in Tally", kept visible); a later body bringing that GUID is deleted (cancelled) again. The
owner's review and re-review M-B (06-Oct-2026) for one settled so WITHOUT an AlterID (recorded in `tally_nothing_removed`,
57, add-only, RLS on, the service role's only): a DELETE is applied again to any later body of its GUID (Tally never brings
a deleted voucher's GUID back); a CANCEL only to a body at or below Tally's voucher counter (ALTVCHID) at the time of the
cancel, which bridge 2.3.1 reads with FinComCompany and sends on the line (payload `vchCounter`): a body above it is a
later change in Tally, applied normally; with no counter, at most once. A delete or cancel with an AlterID is bounded by
it as before. 50's day
release re-applies only a delete (cancel) applied above the day's AlterID (never one without an AlterID), so it needs no
change; 60's R3-L2 (a create late below a cancel, then cancelled again) acts only when the cancel has an AlterID and the
create's is below it, so it is bounded the same way.
The accuracy checks themselves run in tally-ingest. The owner's rule after review (06-Oct-2026): a recorder body is held
(nothing of it applied) only when its ledger lines do not total zero; any other check failing (item taxable plus tax
against the ledger lines, bill-wise, cost centres) applies the entry with the words in `check_notes` (and the line's
payload `checkNotes`, shown in Sync activity); a Day Book entry likewise comes in with its words in `check_notes`. No
migration holds on the checks: 57 only stores the words. tally-ingest works without 57 (the details
are then not stored). Tested by `run_migration57.py`, `run_migration_order.py` (57 in both orders), `run_parta_server.py`
(through tally-ingest) and `run_parse_parta.mjs`.

Bridge 2.3.1 (06-Oct-2026, the 2.3.0 review's deferred cloud Low): `migration-58-lows.sql` runs after 57 in both orders
(it needs only 54 and 55; ... -> 56 -> 57 -> 58 -> 59 -> 60) (add-only, one transaction, `lock_timeout` 10 s, safe twice): on the seven tables 54 and 55 made
(`tally_bridge_prefs`, `tally_member_bridges`, `tally_bridge_ids`, `tally_bridge_alerts`, `tally_bridge_rollbacks`,
`tally_bridge_release_log`, `tally_post_checks`) all privileges revoked from anon and authenticated (54/55 revoked only
insert and update; Supabase's defaults left delete and the rest) and select granted back to authenticated; their id
sequences closed to both. Functions unchanged. Tested by `run_migration58.py`. Nothing in tally-ingest or the app needs it.

Bridge 2.3.1 (06-Oct-2026, the owner's decision on a ledger renamed in Tally): `migration-59-ledger-aliases.sql` runs
after 58 and before 60 in both orders (add-only, one transaction, `lock_timeout` 10 s, no "delete from", safe twice; no
function; NOT yet run on staging). One table, `tally_ledger_aliases` (book_id, tally_name -> fincom_name, tally_guid,
seen_at; key (book_id, tally_name); RLS: the firm's members read; written by tally-ingest only). When the ledger the bridge
fetched by name for an entry (FinComLedgerByName) has the Tally GUID of a ledger FinCom holds under another name, the new
name is recorded here (the note for 2.3.2's rename; 2.3.1 does not rename), and an entry using the new name is applied
under FinCom's ledger (its lines' ledger names mapped, the amounts untouched; the balance guard still first). Re-review
M-A (06-Oct-2026): an alias never maps by itself: every entry naming it is held and the ledger fetched by its name; only
a fetch made after that hold (`confirmed_at` above the hold) that gives the alias's GUID maps the entry when it comes
again (its ":resolved"); another GUID ends the alias and the new ledger is added and used. Review H2 (06-Oct-2026): `confirmed_at` and `ended_at` (add-only); an alias is used only once a
fetch by its name confirmed the GUID and while it is not ended; it ends (kept) when its GUID is seen under another name
or its name with another GUID (ledger_changes, ledger_list), so a new ledger reusing an old name is held and fetched,
never put on the old ledger. A cloud without 59 records nothing and such an entry keeps waiting, as before. Tested by
`run_migration59.py`, `run_migration_order.py` (59 in both orders) and `run_recorder_server.py` (through tally-ingest).

Bridge 2.3.1 (06-Oct-2026, the migration-50 review's round-3 Lows): `migration-60-recorder-lows.sql` runs after 56 and 57
in both orders (fresh and staging: ... -> 55 -> 56 -> 57 -> 58 -> 59 -> 60; independent of 58 and 59; add-only, one transaction,
`lock_timeout` 10 s, no "delete from", safe twice; NOT yet run on staging). One function replaced, `tally_recorder_line`
(56's text, which 57 does not replace; the lines marked "60" changed; granted to nobody): a delete or cancel under the
add-on's placeholder GUID is held as a GUID-less one (R3-L1: twice it broke the line's call); a create late below a cancel
applied for its GUID is applied and cancelled again, below a delete 'stale' as before (R3-L2); a GUID-less delete with no
date promises no Day Book (R3-L3). The owner's "nothing to remove" (08:05) is 57's (`tally_ingest_delete`), not repeated.
Tested by `run_migration60.py` (on 56 -> 57 -> 58) and `run_migration_order.py` (56 -> 57 -> 58 -> 59 -> 60 in both orders).

Next bridge release after 2.3.1 (07-Oct-2026, the owner's decision, option A: "Work out the rate as tax divided by
assessable amount where Tally stores 0, and mark it as worked out"): `migration-62-tds-rate-worked-out.sql` runs after 57
(staging, where 58, 59, 60 and 61 have run: ... -> 57 -> 58 -> 59 -> 60 -> 61 -> 62; a fresh database the same; it needs
only 57 and touches nothing of 58 .. 61; add-only, one transaction, `lock_timeout` 10 s, no "delete from", safe twice; NOT
yet run on staging). One column, `tally_tds_lines.rate_worked_out` (boolean, default false: the rate is Tally's own), and
one function replaced, `tally_ingest_details` (57's text with the lines marked "62" changed; granted to nobody): a TDS row
keeps parse.js's `rateWorkedOut` (Tally 7.1 stores TAXRATE 0 on an entry keyed on its screen; the reader works the rate
out from the Income Tax sub-category's tax and assessable amount). `tally_tds_details(book)` is not replaced (its columns
would change); the mark is read from `tally_tds_lines`, which the firm's members read. tally-ingest needs no change (it
passes each TDS detail's fields on as they are); a cloud without 62 stores the worked-out rate without the mark. Tested by
`run_migration62.py` (on the real S5 capture of run 37492981527) and `run_migration_order.py` (62 in both orders, after 61,
privileges, when that file is in the tree). Numbers taken on other branches: 61 privileges (perms-61), 63 outbox, 64
realtime, 65 selfcheck, 66 masterhook.

Next release (07-Oct-2026, branch next-outbox; NOT run anywhere): `migration-63-recorder-repeat.sql` runs after 60 (and 61, 62 of other branches; independent of them) in both
orders (... -> 59 -> 60 -> 63; add-only, one transaction, `lock_timeout` 10 s, no "delete from", safe twice). FinCom ignores
a repeat of a recorder line: `tally_recorder_line` (60's text, the lines marked "63" added; granted to nobody) answers a NEW
arrival whose book, computer and line id (and "again" marker, when the bridge sends one) match a row already there
'duplicate' with already: true and the first row's state, never storing or applying it again; a 'failed' row and an
unmarked ":resolved" line whose last row is held (2.3.1's deliberate resend) are not repeats. One index (book_id, line_id),
not unique (the rows since 44 hold repeats, and a ":resolved" line is resent on purpose). Tested on pg_stand only:
tests/run_migration63.py, tests/run_recorder_repeat_server.py, tests/run_migration_order.py.

Next release (07-Oct-2026, branch next-realtime; NOT run anywhere): `migration-64-pages-live.sql` runs after 60 in both
orders (... -> 59 -> 60 -> 64; independent of 61, 62 and 63 of other branches; add-only, one transaction, `lock_timeout`
10 s, no "delete from", safe twice). Look up, the ledgers and Sync activity refresh by themselves: tally_book_changes (one
row per book; RLS, the firm reads; never deleted), written once per transaction by statement triggers on the copy's five
tables (tally_book_changed, never failing the write), and the supabase_realtime publication gets tally_book_changes,
tally_sync_cursor, tally_month_locks and tally_tieouts. The copy's own tables are NOT published: tally_lines has no replica
identity (its deletes would fail), Realtime sends DELETE events' keys to every firm, and a day read is thousands of rows.
Tested on pg_stand only: tests/run_migration64.py, tests/run_migration_order.py; the pages: tests/run_pages_live.py.

Next release (07-Oct-2026, item e: the nightly self-check; `docs/selfcheck-requests-for-approval.md`):
`migration-65-selfchecks.sql` runs after 60 in both orders (fresh and staging: ... -> 58 -> 59 -> 60 -> 65), and after 61
(privileges, run on staging), 62 (TDS), 63 (outbox) and 64 (realtime) where they ran: it touches none of their objects. It
needs 32's `tally_vouchers.deleted_at`, 33's `tally_ledgers.merged_into`, 44's `tally_ledger_day_rebuild` counting and 47's
`tally_service_or_owner()`; add-only, one transaction, `lock_timeout` 10 s, no "delete from", nothing dropped, safe twice;
NOT yet run on staging; md5 eabe7dda1e8a12a11e0d9fa71ab46b7f. One new table, `tally_selfchecks` (one row per nightly check,
never updated; RLS: the firm's members read; written by tally-ingest only; anon nothing, authenticated select only, its
sequence closed to both), and four new functions, none replacing another: `tally_selfcheck_compare` (which of Tally's
listed entries the copy lacks), `tally_selfcheck_copy` (the copy's own trial balance against openings and entries),
`tally_selfcheck_words` and `tally_selfcheck_record`; security definer, search_path public, pg_temp, the service role only.
Without it tally-ingest's kind `selfcheck` answers 503 notReady and the bridge does not ask again that night; the Tally
page shows no line. Tested by `run_migration65.py` (on 32 -> ... -> 60) and `run_migration_order.py` (65 in both orders).

Branch next-masterhook (07-Oct-2026, the add-on's master forms): `migration-66-recorder-masters.sql` (number assigned by the
coordinator; 61-65 belong to other branches) runs after 44 in any order relative to 61-65 (add-only, one transaction,
`lock_timeout` 10 s, no "delete from", safe twice; NOT run anywhere: written only). One new table `tally_recorder_masters`
(heads only: master_type, name, parent, object_guid, master_id, alter_id, saved_at, pc, tally_user, bridge; unique
(book_id, line_id); RLS: the firm reads its own rows; nobody writes directly) and one new function
`tally_recorder_masters_save(p_firm, p_book, p_device, p_lines)` (service role only) that keeps master_created /
master_altered lines ('kept' / 'duplicate'). tally-ingest's recorder_lines sends those lines there; a cloud without 66
answers them 'failed' with words and handles the rest of the call as before. Tested by `run_migration66.py` and
`run_recorder_masters_server.py` (through tally-ingest under Deno).

next-renumber (08-Oct-2026, the owner's "renumbering yes"; a later release than 2.3.4): `migration-67-recorder-renumbered.sql`
runs after 60 in both orders (... -> 58 -> 59 -> 60 -> 67; add-only, one transaction, `lock_timeout` 10 s, no "delete from",
safe twice; NOT run on staging or production). One function replaced, `tally_recorder_line` (60's text, the lines marked "67"
changed; granted to nobody): an altered line WITH Tally's entry at exactly the AlterID the copy holds, numbered otherwise than
the copy, is applied (Tally renumbered the entry after an insert or delete: its AlterID does not move, tally-versions P9r),
instead of 'duplicate'; its words "renumbered in Tally: <type> <old> is <type> <new> now (the same AlterID n)". The numbers 61
to 66 and 69 are taken on other branches (61 perms-61, 62 next-tds, 63 next-outbox, 64 next-realtime, 65 next-selfcheck, 66
next-masterhook, 69 next-push); 63 and 69 replace `tally_recorder_line` too, so whichever of 63, 67, 69 lands later carries the
others' marked lines. Tested by `run_migration67.py` (on ... -> 58 -> 60) and `run_migration_order.py` (60 -> 67 in both orders).

FinCom Bridge 2.4.0 (release-240, 08-Oct-2026; NOT run anywhere): the next release's migrations run after 2.3.5's 68 and 70 (independent
of them): staging ... -> 60 -> 68 -> 70 -> 62 -> 63 -> 64 -> 65 -> 66 -> 67, a fresh database ... -> 60 -> 68 -> 70 -> 62 -> 67 -> 63 -> 64 ->
65 -> 66 (61, privileges, before 62 wherever its file is in the tree). **63 and 67 each replace `tally_recorder_line`: both files
carry ONE combined, add-only text** (60's text with the lines marked "63", a repeat of a line FinCom has answered 'duplicate'
with already: true, AND the lines marked "67", a renumbered entry applied), and each makes 63's index
`tally_recorder_lines_line` if it is not there; so whichever of the two runs last leaves the same function, in either order,
and neither one's behaviour is lost. `run_migration_order.py` runs them 63 -> 67 (staging) and 67 -> 63 (fresh) and requires
identical function texts; `run_migration63.py` and `run_migration67.py` check their own marked lines and that the other file
carries the same text. 69 (next-push, not in 2.4.0 yet) is to carry the same combined text with its lines marked "69" when it
is merged.

2.4.0 part 2 review (08-Oct-2026), next-outbox (63 still NOT run anywhere, so changed in place; add-only, safe twice):
- **M2, order with 67 and 69.** 63 (this branch), 67 (next-renumber) and 69 (next-push) each replace `tally_recorder_line`
  on 60's text. 63 now STOPS where the installed line carries "-- 67" or "-- 69" (raises "migration 63 is written on 60's
  tally_recorder_line, and migration 67 / 69 has run here ... (nothing changed)", the transaction rolled back, the index not
  made); 69 stops likewise where 63 has run. The release runs ONE combined definition (made by release-240's integrator),
  never two of these files over each other. Tested: run_migration63.py section 8.
- **M1 (the bridge).** A group FinCom answers 200 is no longer marked sent whole: a line answered 'failed' (a lock
  timeout, a deadlock, a line tally-ingest could not read) or left without a result stays on the PC (its offsets held) and
  goes again after RecorderRetrySec x 2^n (30 minutes at most). It is NEVER given up (the coordinator, 08-Oct-2026, the
  owner's "nothing lost"): after RecorderFailedTries failed answers (default 12, about 3.5 hours) it stays on the PC (its
  offset held, failed.txt kept), is sent every 30 minutes and no more often, and the beat carries it per company
  (recorderState: stuck, stuckSince, stuckDay); tally-ingest keeps that as tally_devices.info.beat.recorderStuck
  [{company, n, since, day}] and FinCom shows it under Needs you ("N saves from <PC> could not be stored in FinCom since
  HH:MM; FinCom keeps trying - if it continues, upload the Day Book for <day>"; the app part sits on the shared classifier
  of next-tallypage, branch next-outbox-app). Its tries, first failure, next try and words are kept with the held offset
  (sync\recorder-offsets.json "fails", written whole and atomically), so after a restart it keeps its count, its
  30-minute cap and its Needs you entry; the record goes when the line is taken. The other lines of the group are marked sent. A resend is stored once (63's repeat check: a failed
  row is no repeat, so the resend is applied; an applied one is answered "already have"). A cloud answer {queued: n}
  with no results at all (before round 20) is taken as before. Tests: outbox_failed_test.go.
- **L2.** failed.txt (no day in its name) read past a line not yet confirmed no longer keeps every sent id for ever
  (keepFrom "00000000"): the day that first happened is kept with the file's offset (`keep` in recorder-offsets.json)
  and the sent ids are kept from that day on. Test: TestOutboxFailedTxtKeepsFromItsDay.
- **L5.** run_migration63.py and run_recorder_repeat_server.py are in tests/ci/tests.txt (the latter on its own
  PostgreSQL port, 55463; run_enqueue_held_id.py has 55461).
- **Notes (L1, L3, L4).** Deploy order: run 63 BEFORE the tally-ingest of this branch (it reads `already` / `was` from 63's
  answers; on a cloud without 63 a repeat is stored again, as before) and before the 2.4.0 bridge goes out (the bridge
  resends every line not confirmed; without 63 such a resend is a second row). A line resent after a 'failed' answer
  reaches FinCom AFTER the lines that followed it in its group (the order of one book's lines is kept only among the
  lines that went together); FinCom's per-entry AlterID rules decide a late alter as for any line. The repeat check's
  index is not unique, and the look-up runs under the book's lock (tally_recorder_apply and the drain); its cost on
  staging's tally_recorder_lines is to be measured in the 2.4.0 gate (not measured here).

2.4.0 part 2 review (08-Oct-2026), next-masterhook (66 still NOT run anywhere, so changed in place; add-only, safe twice):
- **M1.** A Pay Head is a ledger in FinCom: its delete goes as `ledger_deleted` again (the ledger path: tally_recorder_line
  applies it to the ledger holding the line's GUID, as before the hook), never `master_deleted`; a Stock Item's or a
  Godown's delete goes as `master_deleted` with its type. Test: TestMasterHookDeleteKnownType (a Pay Head's delete).
- **L1.** `revoke all on public.tally_recorder_masters from anon` and on its id sequence from anon and authenticated
  (Supabase's default privileges grant every new table in public to anon). Test: run_migration66.py section 5.
- **L2 (the bridge, the rule of next-outbox's M1).** A line FinCom answers 'failed' (a master line on a cloud without 66,
  a lock timeout, a deadlock) or leaves without a result is not marked sent: it goes again after RecorderRetrySec x 2^n
  (30 minutes at most), never given up: from RecorderFailedTries (12) on it is sent every 30 minutes and the beat carries
  it per company (recorderState stuck / stuckSince / stuckDay; tally-ingest's part and FinCom's Needs you are on
  next-outbox and next-outbox-app); the other lines of the group are marked sent. Its tries, first failure and next try are kept with the offsets
  (sync\recorder-offsets.json "fails"), so a restart keeps its count, its 30-minute cap and its Needs you entry. The code
  is next-outbox's, the same text (without next-outbox's keepFrom). Test: TestMasterHookFailedNotMarkedSent.
- **L3.** tally-ingest keeps only the types the add-on hooks (Pay Head, Stock Item, Godown); a Unit or Employee line is
  'failed', "unknown master type", not kept. Stale comments put right. Test: run_recorder_masters_server.py.
- **L4.** 66 is in run_migration_order.py (after 60, both orders, twice) and in tests/ci/tests.txt with
  run_recorder_masters_server.py and run_ledger_delete_guid.py; run_migration66.py has its own port (30666; 62's test
  has 30620).
- Deploy order: run 66 before the tally-ingest of this branch and before the 2.4.0 bridge goes out (without 66 every
  master line is answered 'failed' and, with L2, kept on the PC and sent again every 30 minutes, shown under Needs you).

2.4.0 part 2 review (08-Oct-2026), on 62 (still NOT run on staging, so changed in place; add-only and safe twice as
before): **M1** the TDS details as the firm's members read them now carry the mark: `tally_tds_details_marked(book)`, a new
function (57's `tally_tds_details` with two columns more, `rate_worked_out` and `exempt`; security definer, `search_path =
public, pg_temp`; members and the service role, not anon); 57's `tally_tds_details` is left as it is. The TDS tab lists
the lines under "TDS on Tally's entries" with the rate in words: "2% · rate worked out: Tally stored 0 (TDS ÷ assessable
amount)", "0% · exempt in Tally: no rate worked out", or Tally's own rate alone (`TDS.tallyRateWords`;
`tests/run_tds_rate_words.py`). **L2** Tally's EXEMPTED Yes on a TDS line is kept: a second column,
`tally_tds_lines.exempt` (default false), and parse.js never works a rate out on such a line (it keeps Tally's stored rate
and marks `exempt: true`). The real S5 capture of run 37492981527 is such a line (EXEMPTED Yes, TAXRATE 0, tax 2,000 on
1,00,000): it now reads rate 0, exempt, not worked out; the working out is tested on the same capture with EXEMPTED set to
No. **L1, deploy order:** run 62 on staging BEFORE deploying the tally-ingest that carries this parse.js (a tally-ingest
deployed first would store each line through 57's text, without either mark, until 62 runs; the lines it stored keep
rate_worked_out and exempt false until their entry is read again). **L3, timing:** the cost of the wildcard TDS fetch
(ALLLEDGERENTRIES.TAXOBJECTALLOCATIONS.*, .SUBCATEGORYALLOCATION.*) on FinComVoucherByNumber and the time 62's
`tally_ingest_details` adds per entry are NOT measured here; both are to be measured in the 2.4.0 gate (real Tally, and
staging after 62), the allow-list rows staying "not yet measured" until then.
