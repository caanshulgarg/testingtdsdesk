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

- staging: 32 → 33 → 35 → 34 (first) → 36b → 37 → **36 → 38**
- a fresh database: 32 → 33 → 35 → 34 (reviewed) → 36 → 36b → 37 → 38

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

## tally-ingest (server/tally-cloud/index.ts): which kind calls which function, with which arguments

| Function | Arguments | Called by (kind) |
|---|---|---|
| `tally_ledger_round_batch` | `p_book uuid, p_round text, p_rows int, p_rows_read int, p_complete bool, p_device uuid, p_bridge text, p_seen jsonb` (8; the 7-argument one is a wrapper) | `ledger_list`, every batch |
| `tally_ledger_rename` | `p_book uuid, p_guid text, p_from text, p_to text` | `ledger_list` (renames, and a GUID met under another name) |
| `tally_ledger_round_seen` | `p_book uuid, p_round text, p_seen jsonb` | `ledger_list`, after the upsert of the batch's rows |
| `tally_ledgers_mark_gone` | `p_book uuid, p_round text` (2; the 3-argument one is the first 34's, untouched) | `ledger_list`, the last batch of a round |
| `tally_ingest_ledgers_g` | `p_book, p_from, p_open_as_on, p_ledgers, p_groups, p_list, p_complete, p_count` (8; 6 and 5 as fallbacks) | `ledgers` (a full list) |
| `tally_year_openings` | `p_book uuid` | `ledger_list` (rows added or openings changed), `ledgers` |
| `tally_ingest_day` | `p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n int, p_alter bigint, p_bytes int` | `days` (and the re-read of kept files) |
| `tally_post_take` | `p_device uuid` | `posts_take` (the answer carries the owner's releases in force) |
| `tally_post_id_accept` | `p_job uuid, p_id text, p_vch text` (`p_at` unused, kept in the signature) | `posts_update`, once per accepted id not yet stamped or released |
| `tally_post_id_release` | `p_job uuid, p_id text, p_why text` | `posts_update`, once per refused / not-found id not yet released |
| `tally_lease_take` / `tally_lease_release` | as migration 32 / 37 | `lease_take` / `lease_release` |
| `tally_read_stop` / `tally_read_resume`, `tally_release_*`, `tally_baseline_clear`, the owner's `tally_post_job_mark_posted` / `tally_post_id_release_owner`, the readers | members (the app), not tally-ingest | — |

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

`python3 tests/run_migration_order.py` (pg_stand: a throwaway PostgreSQL, never staging) applies BOTH orders above, each
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
the words, marks never cascade, short reads mark nothing),
`run_migration36b.py` (acceptance, the owner's mark and release, the four routes a posting Tally accepted can never be sent
again by: Retry, Post again, the requeue, a new posting for the same id), `run_migration37.py` (36b applied before 37).
