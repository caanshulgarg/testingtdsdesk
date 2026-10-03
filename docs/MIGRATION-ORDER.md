# Cloud migrations: the order they run in

The cloud copy's SQL lives in `server/tally-cloud/migration-*.sql`. Each file is add-only (nothing dropped, deleted or
revoked; `begin; ... commit;`; safe to run twice) and is shown to the owner before it runs on staging
(project `qbocskaiewaxqcvaunzc`). From migration 32 on, the files depend on one another, and one pair is order-sensitive.

## A fresh database: 32 → 33 → 35 → 34 → 36 → 36b → 37

| # | File | What it adds |
|---|---|---|
| 32 | `migration-32-sync-safety.sql` | the posting ids (`tally_post_ids`), the company lease, the sync cursor and rewind guard, `deleted_at` / `origin` / `tally_guid` / `alter_id` on entries and ledgers, voucher versions, the `tally_balances` view |
| 33 | `migration-33-ledger-lists.sql` | ledger lists and marks (`tally_ledger_lists`, `tally_ledger_marks`, the mark log trigger), `tally_balances` without deleted ledgers, the year's openings in any capitals, `tally_ingest_ledgers_list` / `_g` with the list's source |
| 35 | `migration-35-bridge-control.sql` | Stop reading / Resume (`tally_read_stops`, `tally_read_stop`, `tally_read_resume`) and the staged-release table `tally_bridge_releases`. It no longer defines the release functions (see the rule below) |
| 34 | `migration-34-ledger-safety.sql` | the guard (a ledger with entries, an opening or a recent rename is never marked), rounds (`tally_ledger_rounds`, `tally_ledger_round_batch`, `tally_ledgers_mark_gone`), renames by GUID, full lists marking only when declared complete, and in **part E** the release functions `tally_release_pilot` / `tally_release_approve` with the allow-list check (`pilot_allowlist_measured`) |
| 36 | `migration-36-ledger-rename.sql` | a rename carries the entries (lines, bills, parties, day totals as nil twins) and checks the trial balance before and after; the guard ignores nil twin day rows; `tally_ledger_round_batch` counts only and the new `tally_ledger_round_seen` stamps the GUIDs after tally-ingest's upsert, so a first round marks nothing |
| 36b | `migration-36b-post-acceptance.sql` | an id Tally accepted is never freed by `tally_post_ids_sync` (`accepted_at`, stamped through `tally_post_id_accept` by tally-ingest); the owner's `tally_post_job_mark_posted` marks an entry seen in Tally as posted and `tally_post_id_release_owner` frees a pinned id with a reason (append-only `tally_post_marks`, actions `posted` / `released`); it also adds `released_at` / `released_by` / `released_why` (the same columns 37 adds), so its sync rule — live = accepted and not released, or the posting not failed/cancelled and not released — holds on its own. **Never sent again** (round 5, the real-books fault of 03-Oct): `tally_post_job_accepted`, the BEFORE UPDATE trigger `tally_post_jobs_resend_guard` (a posting Tally accepted is never set `waiting` again: Retry, requeue, a hand update) and `tally_post_requeue` replaced so the minute's cron holds such a posting (done + checking, a message) instead of re-queuing it. Round 7: `tally_post_id_match` (a bank line's id with a hash tag), `tally_post_id_accept(job, id, vch, at)` keeps an owner's later release, confirmed entries never block Retry, the 2.1.5 bridge's words count as an acceptance, the owner's mark (voucher number required) and release settle a running posting (`tally_post_job_settle`) and stamp `byOwner`, `tally_post_jobs.seq`, `tally_post_enqueue` refuses a Retry while an id is live elsewhere, and a backfill stamps `accepted_at` on the ids already here (an update where null only; the count is logged) and makes an accepted, unreleased id live again row by row (a clash with another live posting is skipped and logged). Round 8: the cloud is the one judge of time (`accepted_at` = server time of the first report; an owner's release stands until the posting is handed out again, `taken_at`), `tally_post_take` clears `seq`, `sent` counts as still with the bridge in `tally_post_job_settle`, `held: true` is an acceptance. Independent of 36; run it after 36 and before 37 |
| 37 | `migration-37-follow-ups.sql` | the migration-32 follow-ups (id release, versions with lines, baseline clear, soft delete in `tally_ingest_day`, lease release, balances as on a date, the FinCom tag column, withdrawn releases). Its `tally_post_ids_sync` is the same text as 36b's (both guards); `tally_post_id_release` never frees an accepted id (`released: false`, `why: accepted by Tally`). It adds 36b's `accepted_at` / `accepted_vch` if missing, so it holds on a cloud where 36b was skipped, but the order stays 36 → 36b → 37 |

Before 32 the files are independent of this order and were run long ago (`migration.sql` … `migration-31-clean-names.sql`).

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

`python3 tests/run_migration_order.py` (pg_stand: a throwaway PostgreSQL, never staging) applies 32, 33, 35, 34, 36, 36b, 37
in that order twice over made-up rows and asserts (round 5: also that an id Tally accepted stays live through a failed or
cancelled posting under the sync in force): every file runs twice and deletes nothing; `tally_release_approve` is
migration-34's (`pg_get_functiondef` contains `pilot_allowlist_measured`) and `tally_release_pilot` clears it; the 35
file no longer contains `create or replace function public.tally_release_`; migration-36's functions are there; every
function of 35, 34 and 36 is security definer with `search_path = public, pg_temp`. It runs in CI (`tests/ci/tests.txt`).

Each file also has its own test: `run_migration32.py`, `run_migration33.py`, `run_migration34.py` (starts from staging's
state: the 35 as run there, then 34), `run_migration35.py` (35, then 34 after it for the release checks),
`run_migration36.py` (the made-up books through the real ingest path, then the renames and the first round),
`run_migration36b.py` (acceptance, the owner's mark and release, the four routes a posting Tally accepted can never be sent
again by: Retry, Post again, the requeue, a new posting for the same id), `run_migration37.py` (36b applied before 37).
