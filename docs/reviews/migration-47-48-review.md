# Migration 47 + 48 and tally-ingest (79c9ba4..3fd11b9): database and security review

Branch `tax-accuracy`, commit `3fd11b9`. This review is read-only. It covers:

- `server/tally-cloud/migration-47-recorder-queue-alerts.sql`
- `server/tally-cloud/migration-48-day-cache-once.sql`
- `git diff 79c9ba4 3fd11b9 -- server/` (`server/tally-cloud/index.ts`)

Tests run once each, one pg_stand suite at a time. All three passed:

| Suite | Result |
|---|---|
| `python3 tests/run_migration47.py` | all passed (three runs of the file, RLS, grants, the 5-try retry, alert jobs write only tally_alerts, storage policies, the CHECK swap) |
| `python3 tests/run_migration48.py` | all passed (trial balance and md5 of tally_ledger_day identical old vs new for the 4 sends; 500 lines on one day: 19.62 s -> 3.67 s) |
| `python3 tests/run_upload_split.py` | all passed (UTF-16LE/UTF-8, BOM or not, files out of date order; the same file twice doubles nothing) |

The tests use a **stub** of pgmq (`tests/run_migration47.py:42-65`), so the real extension's grants and locking are not exercised. Findings 3 and 7 depend on that.

---

## Status after round 21 (04-Oct-2026, not committed)

Fixed test-first: each red is saved as `c21.<n>.red` in the session's `scratchpad/tdd` folder; 1 = run_migration47, 2 =
run_recorder_server, 3 = run_upload_split, 4 = run_migration48, 5 = run_migration_order (the old 47/48 cannot run the new
compared texts). **`run_migration47.py` now runs on the real pgmq 1.5.1.** Its plain-SQL `pgmq.sql` is fetched from GitHub
and installed as an extension of pg_stand. When that is not possible it falls back to the stand-in, and the first line of
the output says which was used. The stand-in run passes too (`PGMQ_STUB=1`). The other suites keep the stand-in, which now
has `pgmq.set_vt`.

| Finding | Status | Where | Test (name in the output) |
|---|---|---|---|
| H1 | **Fixed** | 47: `tally_recorder_pending` (written by enqueue, marked by the drain; partial index on `(book_id, msg_id) where state = 'pending'`); `tally_recorder_send` (queues while the book has a pending message, else applies; one lock per book); the drain takes a book's messages in order (a later one waits; waiting is not a try); on the final failure: lines into `tally_recorder_lines` as `failed` with words, a `gap` alert at once, the gap check counts them (`lost`); index.ts: one call, `tally_recorder_send` | run_migration47 "H1. ..." (8 checks); run_recorder_server "R21-H1. ..." (4 checks, through tally-ingest) |
| M1 | **Fixed** | 47: `tally_recorder_take` counts the try on `tally_recorder_pending`; pg_cron calls the procedure `tally_recorder_drain_run`, which COMMITs after each read and after each message. Each message runs in its own subtransaction with its own `lock_timeout`, inside the budget. A cancel (57014) is caught, counted and ends the run. On the 5th try the message is archived with words. The visibility time is 60 s, longer than the 25 s cap | run_migration47 "M1. ..." (a 2 s statement timeout on 5 runs: counted 1..5, archived "did not finish in time", the message before it kept; a lock wait fails by itself in 3.0 s, counted "busy") |
| M2 | **Fixed** | index.ts upload_done: one conditional `update ... eq(sealed, false) ... select`; only the winner queues | run_upload_split "M2. ..." |
| M3 | **Fixed** | 47 `tally_upload_advance`: a piece's day files and next piece are queued in one transaction, keyed by the job's cursor (`upload->>'at'`). The late days are added to the total in the same step. index.ts sends everything through it | run_migration47 "M3. ..."; run_upload_split "M3. ..." (archive failed twice: each day once; late pass failed once: total raised once) |
| M4 | **Fixed** | index.ts `storageRange`: on a 200, reads from the start only, at most the bytes asked, then cancels; from further on it stops the job (Fatal) with words | run_upload_split "M4. ..." (1.2 MB of 41.7 MB sent; the job stopped with words) |
| M5 | **Fixed** | index.ts: the carried tail is capped (`TALLY_UPLOAD_MAX_TAIL`, default 2 M characters) and `MAX_CARRY` lowered 24 M -> 6 M; either stops the job at once with words (Fatal) | run_upload_split "M5. ..." |
| M6 | **Fixed** | 47: `revoke all` on `pgmq.q_/a_tally_recorder` (and the msg_id sequence) from public, anon, authenticated, and RLS on (owner only). Retention is in **48**, because 47 holds no `delete from`: `tally_recorder_archive_trim` (pg_cron daily, 90 days) | run_migration47 "M6. ..." (under Supabase-like default grants in pgmq); run_migration48 "M6. ..." |
| M7 | **Fixed** | 47: swaps only the CHECK whose text is exactly migration 13's; otherwise stops the file with words; another CHECK naming kind is left untouched | run_migration47 "M7. ..." (2 checks; the red showed the old `limit 1` replacing the wrong constraint) |
| M8 | **Fixed** | 47 and 48 `tally_recorder_line`: a rename by `ledger_altered` needs an AlterID above `tally_ledgers.alter_id` (added), else `stale`; never a merge (held); no AlterID: held. Applied renames (`ledger_renamed` too) stamp it | run_migration47 "M8. ..."; run_migration48 "M8. ..." |
| L1 | Left | Not in this round's scope (storage hygiene only, not confidentiality). Cheap follow-up: `alter policy tally_uploads_add ... with check (name ~ ...)` plus `allowed_mime_types` | |
| L2 | **Fixed** | index.ts: only `<firm>/<job>.xml` is read; anything else stops the job with words | run_upload_split "L2. ..." |
| L3 | **Fixed** | index.ts upload_done: the job's `book_id` (logged when the link moved) | run_upload_split "L3. ..." |
| L4 | **Fixed** | index.ts upload_new: "unknown kind" only for `42703`, `PGRST204` or `tally_jobs_kind_check`; anything else is a 500 with plain words | run_upload_split "L4. ..." |
| L5 | **Fixed** (new code) | 47 `tally_recorder_why`: plain words for the failure row, the lines and the alert; the raw error goes to the server log (`raise log`). index.ts `dbFail`: the raw text goes to the function log; Storage's body is never in a message. The older top-level `error.message` pattern (1548/1971) is left as it was | run_migration47 "L5. ..." / "H1/L5. ..."; run_upload_split "L5. ..." |
| L6 | **Fixed** | 47 `tally_service_or_owner()`: the service role's JWT, or no JWT only for session_user `postgres` / `supabase_admin` (inside a definer function current_user is always the owner). Used by 47's service functions, 47's gap check, and 48's apply and 4-argument entry path | run_migration47 "L6. ..."; run_migration48 "L6. ..." |
| L7 | **Fixed** | 47: each alert job runs each firm in its own block (logged, counted as `firmsFailed`) | run_migration47 "L7. ..." (silent, gaps) |
| L8 | **Fixed** | 47: `revoke all` then `grant select`. On PG17 `all` includes MAINTAIN, so no version check is needed (pg_stand is PG16, which has no MAINTAIN, so no red is possible there) | run_migration47 "L8. ..." |
| L9 | **Fixed** | 48 apply: `left(btrim(...), 7)` | run_migration48 "L9. ..." |
| L10 | **Fixed** | 48: the 4-argument form is granted to nobody. Only the 3-argument form and `tally_recorder_line` (both run as the owner) reach it | run_migration48 "grants: ..." |

The owner's condition still holds (run_migration48, old 47 against new 47+48, md5 of the full `tally_ledger_day`):
send 1 `c222adcd1347c4443c51076936f68873` (208 rows), send 2 `cd3bc3f97bdf2ee176676dd5ff984b38` (128 rows, 19.32 s ->
3.55 s), send 3 queued `27582c4067cb94c89384b0093c90c159` (346 rows), held line released
`24ccc41b7dc5666c92daf075acdee6ea` (352 rows). Every trial balance totals 0.00, and old and new are identical.

New, not fixed (migration 13's text): `tally_job_step` sets a **failed** job back to `running` when day pieces queued
before the failure finish afterwards (the message keeps the words). This affects the 5-tries stop and the new immediate
stops alike. Fix: `status = case when status = 'failed' then 'failed' ...` in a later migration.

---

## High

### H1. A failed queued send is lost silently, because a later direct send has already raised the gap check's baseline

- **Where:** `index.ts:921-931` (queue when more than 50 full lines, else apply directly), `migration-48:335-338` (`recorder_max_alter` raised by every apply) and `migration-45:516` (gap baseline = `greatest(..., recorder_max_alter, ...)`). Also `migration-47:185-201`: on the 5th failure the message goes to `tally_recorder_failures` only.
- **Scenario:**
  1. The bridge sends 120 full lines (AlterIDs 1001-1120). They are queued, and the bridge is told `queued`.
  2. 10 s later it sends 3 lines (AlterIDs 1121-1123). These are applied **directly** and `recorder_max_alter` becomes 1123.
  3. The queued message fails 5 times (lock timeout, a raise in `tally_recorder_line` outside its inner block, a book re-linked to another firm). Its apply ran inside the drain's savepoint, so none of its 120 lines are left in `tally_recorder_lines`.
  4. The gap check now sees Tally's `altvchid` 1123 against a baseline of 1123: `missing = 0`, so no `gap` alert.
  5. The only trace is a count in the 19:00 summary ("1 send failed in the queue"). 120 changes are missing from the copy, and nothing tells anyone to re-send.
- **Same root cause, smaller effect:** the queued and direct paths for one book are applied out of order even when nothing fails. A direct `deleted` line can run before the queued `created` line of the same GUID. The delete is held as "unknown entry", then the create applies, and the copy keeps an entry that Tally deleted until the next day read.
- **Suggested fix:**
  - (a) In `recorderLines`, once a book has a message on the queue that is not yet archived, send every later request for that book to the queue too. One way is `tally_recorder_enqueue` answering "pending for this book", or a `pending` count per book. This keeps the order per book.
  - (b) On the final failure in `tally_recorder_drain`, record the lines as `failed` rows in `tally_recorder_lines` (outside the rolled-back savepoint) and/or write a `gap`-kind alert for the book. The loss then shows in Sync activity and in the alerts list the same day.
  - (c) Optionally, have the gap check ignore `recorder_max_alter` contributions made while an older message for the book is still queued.

---

## Medium

### M1. Retry counting is lost when the drain transaction aborts, so one poison message can wedge the queue

- **Where:** `migration-47:176-203`.
- **Why it happens:** `pgmq.read` (which increments `read_ct`) and every archive run in the **one** transaction of the cron statement. `exception when others` does not catch `query_canceled` (57014: statement_timeout, `pg_cancel_backend`, cron shutdown).
- **Scenario:**
  1. A 1000-line message whose apply is cancelled (for example a `statement_timeout` on the cron role or database, or an admin cancel) aborts the whole drain.
  2. Every message applied earlier in that run is rolled back, and so is the `read_ct` increment and the visibility time.
  3. On the next run the same message is read first (oldest first), is cancelled again, and never reaches `read_ct >= 5`.
  4. The queue makes no progress and there is no failure row.
- **Suggested fix:**
  - Read and archive in their own short transactions. For example, make the cron job a procedure that `COMMIT`s after each message (pg_cron can `call` a procedure), or commit the read before the apply.
  - At least `set local statement_timeout` inside the drain to more than budget plus one message, and cap the work done per message.
  - Add a test that cancels the drain mid-message and checks `read_ct` survives.

### M2. `upload_done` is not atomic: two concurrent calls queue the split twice

- **Where:** `index.ts:1406-1412`.
- **Why it happens:** `sealed` is read, then updated unconditionally (`.eq("id", j.id)`, error not checked), then the first piece is queued.
- **Scenario:** a double click or a client retry after a timeout sends two `upload_done` calls. Both see `sealed = false`, and both queue piece 0.
  - The day files are idempotent (suite C shows that), so no entries are doubled.
  - Each chain calls `tally_job_step` for every day, so `done` reaches `total` at about 50 % of the file and the job shows **done** while half is still being read.
  - The file is read and gzipped twice.
- **Suggested fix:** `update tally_jobs set sealed = true, status = 'running' where id = $1 and not sealed returning id`, and queue only when a row came back. Check the update's error.

### M3. A retried upload piece is not idempotent, so duplicate chains form and `total` grows twice

- **Where:** `index.ts:1319-1322` (read-modify-write of `total`), `1324-1343` (days pieces and the next piece are sent before the current message is archived at `index.ts:1354`).
- **Scenario A:** the worker is killed by the edge wall clock after the `tally_work_send` of the next piece, but before `tally_work_done`. After VT (240 s) the piece runs again and queues the next piece a second time. From then on two chains read the rest of the file, and every further crash doubles them.
- **Scenario B:** on the last piece of a file that is not in date order, `total += late days` runs, then a flush fails and the piece is retried. `total` is raised again, the job never reaches `done >= total`, and it stays "running" for ever.
- **Suggested fix:**
  - Key each piece by `(job, pass, from)`. Keep the progress cursor on `tally_jobs.upload` (`next_from`), and skip a piece whose `from` is behind the cursor.
  - Do "send next and archive current" in one SQL function, so both happen in one transaction.
  - Make the total bump `total = total + n where upload->>'late_done' is null` (set once).

### M4. Storage fallback reads the whole object into memory

- **Where:** `index.ts:1246-1247` (`storageRange`). It is used by `upload_done` at `index.ts:1407` with range 0-0, and by every piece.
- **Why it happens:** if the server answers 200 instead of 206 (Range ignored by a proxy, CDN or another storage backend), `r.arrayBuffer()` loads the whole object, which can be up to 2 GB.
- **Scenario:** a 1.5 GB Day Book plus a Range-ignoring path. The edge function is OOM-killed at `upload_done` or at every piece. After 5 tries the job fails with no useful words.
- **Suggested fix:** when `r.status !== 206` and the object may be larger than PIECE, cancel the body and throw ("storage did not honour the byte range"). Or stream with a reader that stops after `to + 1` bytes.

### M5. Memory per piece can reach far more than the 4 MB piece

- **Where:** `index.ts:1232` (`MAX_CARRY = 24 Mi` characters) and `index.ts:1341` (`next = { ...u, tail, pend, seen, ext, ... }`).
- **Why it happens:** the open day's vouchers (`pend`) and the cut voucher (`tail`) are carried in the **pgmq message**. Up to 24 M characters means:
  - about 48 MB as JS strings in UTF-16,
  - plus the JSON string built for the RPC,
  - plus the PostgREST body,
  - plus a jsonb message of tens of MB re-written for every piece.
- **Scenario:** a day with very many vouchers (a big retailer's sales day), or the late pass (where `pend` gathers every late day across the whole range). One piece can then use 100-150 MB, near or over the Supabase edge memory limit. The pgmq message also stays in `a_tally_work` for ever.
- **Suggested fix:**
  - Lower MAX_CARRY to about 4-6 M characters.
  - Better, write a complete-day-so-far into the bucket (or a staging table) instead of carrying it in the message, and carry only a pointer.
  - Put a size cap on the late pass's range (`end - from`).

### M6. The pgmq queue tables hold full voucher bodies, and nothing in 47 restricts them

- **Where:** `migration-47:122-125`.
- **What is missing:** `pgmq.create('tally_recorder')` makes `pgmq.q_tally_recorder` and `pgmq.a_tally_recorder`. These hold firm, book and every line's vouchers and ledgers, and the archive keeps them for ever. The file adds no RLS and no `revoke` on them.
- **Risk:** on Supabase, whether `authenticated` can read them depends on the pgmq/Queues setup and on default privileges in the `pgmq` schema. For example, enabling "Expose Queues via PostgREST" or a `grant usage on schema pgmq` grants access. The pg_stand stub cannot show this. The checklist item "RLS on every new table" is not met for these two tables.
- **Suggested fix:**
  - Add `revoke all on pgmq.q_tally_recorder, pgmq.a_tally_recorder from anon, authenticated;` and enable RLS on both, with no policy.
  - Add a retention job for `a_tally_recorder` (for example 90 days), since full entry bodies are kept there with no end.

### M7. The CHECK swap picks the constraint by a loose `like '%kind%'` and hard-codes the new list

- **Where:** `migration-47:142-152`.
- **What it does:** it drops **any** CHECK on `tally_jobs` whose text contains "kind" and lacks "upload", picking the first with `limit 1` (nondeterministic). It re-adds it as `kind in ('daybook','reparse','upload')`.
- **What it does well:** the lock is taken under the 10 s `lock_timeout`, existing rows are re-validated in the same statement, and the swap is one atomic `ALTER TABLE`.
- **Risk:** today only `tally_jobs_kind_check` (from migration 13) matches, so it is correct now. But the swap would be wrong in two cases:
  - Another check mentions kind, e.g. `check (kind <> 'reparse' or book_id is not null)`.
  - Staging has had a kind added by hand.

  In either case the swap would silently drop a different rule or **narrow** the allowed kinds. If existing rows then fail, the add fails and the file rolls back, which is safe. If they pass, the rule is silently replaced, which is not.
- **Suggested fix:** match the exact old definition:

  ```sql
  pg_get_constraintdef(oid) = 'CHECK ((kind = ANY (ARRAY[''daybook''::text, ''reparse''::text])))'
  ```

  Otherwise raise and stop. Optionally use `add constraint ... not valid; validate constraint` to keep the ACCESS EXCLUSIVE window short on a large table.

### M8. The `ledger_altered` rename has no order check and can merge ledgers

- **Where:** `migration-47:474-489` and `migration-48:251-266`.
- **What it does:** any `ledger_altered` line whose name differs from the copy's live row of that GUID calls `tally_ledger_rename`. It is book-scoped: every statement is keyed by `p_book`, and the drain checks the book belongs to the message's firm. So **no cross-book or cross-firm rename is possible**.
- **Risk:** there is no AlterID or time ordering for ledgers. Lines that arrive out of order would undo a rename: `altered name=B` (old) arriving after `renamed B->C` renames C back to B. H1's queue/direct inversion and the 120 s retries make that likely. And if the stale name now belongs to another ledger with no GUID, `tally_ledger_rename` **merges** the two ledgers (moves entries and the opening). The trial-balance check does not stop that, because a merge keeps the total.
- **Suggested fix:**
  - Compare the line's `alter_id` with a per-ledger `alter_id` kept on `tally_ledgers`, and skip as stale when it is older or equal.
  - At least refuse the merge branch from a `ledger_altered` line: hold it with words, and leave merges to the explicit `ledger_renamed` event or to the ledger list.

---

## Low

### L1. Storage policies: the firm folder is right, but the object name is free-form

- **Where:** `migration-47:128-137`.
- **What is right:** the folder is checked against the caller's `my_firm()`, which is MFA-gated and active-only, never against anything the client supplies. There are no update or delete policies, and the bucket is scoped. `'<other>/x'` is refused, and `'<mine>/../<other>/x'` is a literal key under your own folder on S3, so no other firm's object can be read or overwritten.
- **What is not enforced:** any member can store any number of 2 GB objects with any name under the firm folder. Names with `..`, or names other than the issued `<firm>/<job>.xml`, are accepted. The server only ever reads the issued path, so this is a storage-abuse and hygiene issue, not a confidentiality one.
- **Suggested fix:** use a `with check` of `name ~ ('^' || my_firm() || '/[0-9a-f-]{36}\.xml$')`, plus `exists (select 1 from tally_jobs where id = ... and firm_id = my_firm() and kind = 'upload' and not sealed)`. Add a clean-up of the objects of finished or abandoned jobs, and `allowed_mime_types` on the bucket.

### L2. `uploadPiece` trusts the path in the queue message

- **Where:** `index.ts:1254-1257`.
- **Risk:** the path is read with the service key and never checked against `firm` or `job`. Only the service role can call `tally_work_send` (`migration-13:117-119`), so this is not exploitable today.
- **Suggested fix:** as defence in depth, require `path === firm + "/" + job + ".xml"`.

### L3. `upload_done` queues under the client's current book, not the job's

- **Where:** `index.ts:1411` (`book` from `bookFor` now).
- **Risk:** if the client's Tally company is re-linked between `upload_new` and `upload_done`, the file is read into another book of the same firm.
- **Suggested fix:** use `j.book_id`, or refuse when it differs.

### L4. `upload_new` maps unrelated errors to "unknown kind"

- **Where:** `index.ts:1393`.
- **Risk:** the regex includes `column` and `upload`, so a not-null violation or any error naming a column is reported as "this cloud does not take uploads yet", and the app falls back silently.
- **Suggested fix:** match `tally_jobs_kind_check` / `42703` / `PGRST204` only.

### L5. Internal error text reaches users

- `index.ts:929` and `935`: an RPC error is thrown, and `index.ts:1548` / `1971` return `error.message` as is (an existing pattern). The new code adds:
  - `storage: <status> <200 chars of storage body>` (`index.ts:1244`) to the job's message. This is visible to the firm in `tally_jobs.message`.
  - `sqlerrm` in `tally_recorder_failures.why` (`migration-47:186`), readable by every firm member.
- **Suggested fix:** log the detail, and store or return fixed words.

### L6. The auth check passes on NULL

- **Where:** `migration-47:159`, `175` and `migration-48:38`, `301`.
- **Behaviour:** `if auth.role() <> 'service_role'` lets pg_cron through only because `auth.role()` is NULL there, and NULL `<>` is not true. Any role that has EXECUTE and no JWT also passes. The grants are correct today (only service_role or the owner), so this is fragile rather than open.
- **Suggested fix:** `if coalesce(auth.role(), '') not in ('service_role', '') or (auth.role() is null and current_user not in ('postgres', 'supabase_admin'))`, or a separate owner-only wrapper for cron.

### L7. One bad firm stops the alert jobs for every firm

- **Where:** `migration-47:246-258` and `267-291`.
- **Risk:** the scans run with no per-firm `begin ... exception`. One firm's bad data (for example a non-uuid `device` in `tally_recorder_silent`'s answer, cast at line 250) aborts the scan for all firms.
- **Suggested fix:** wrap each firm in its own block.

### L8. `authenticated` keeps privileges beyond SELECT on the new tables

- **Where:** `migration-47:106-108`.
- **Risk:** `revoke insert, update, delete, truncate, references, trigger` leaves `MAINTAIN` on PG17, granted by Supabase's default privileges. `authenticated` could then `LOCK`, `VACUUM` or `REINDEX` `tally_alerts`.
- **Suggested fix:** `revoke all ... from anon, authenticated; grant select ... to authenticated;`.

### L9. `tally_recorder_apply`'s ledger test is stricter than `tally_recorder_line`'s

- **Where:** `migration-48:315`.
- **Behaviour:** apply tests `left(event, 7) = 'ledger_'` on the raw event, while `tally_recorder_line` `btrim`s it. A `' ledger_renamed'` would skip the flush of the pending days before the rename's trial-balance check. tally-ingest trims events (`index.ts:875-876`), so only a direct service-role caller could hit this.
- **Suggested fix:** `left(btrim(...), 7)`.

### L10. The new 4-argument `tally_ingest_entries` can skip the cache rebuild

- **Where:** `migration-48:34`, `95`.
- **Behaviour:** `tally_ingest_entries(..., false)` lets any service-role caller store entries without rebuilding the day cache. That is acceptable only because the service role is trusted.
- **Suggested fix:** consider having the 4-argument form refuse `false` unless `fincom.day_rebuild_once = 'on'`.

---

## Items checked and found correct

- **Add-only and idempotent.**
  - 47 has no `delete from`; it uses archive only. Its one `drop constraint` is the atomic swap, and that runs only while `upload` is missing.
  - 48's `delete from` statements are inside function bodies (the 44 text). Nothing deletes at migration time.
  - Both run twice: the tests run 47 three times.
- **search_path.** Every function in 47 and 48 is `security definer set search_path = public, pg_temp`, including `tally_alert_working_now`. Calls to other schemas are qualified (`pgmq.`, `auth.`, `storage.`).
- **Grants.**
  - enqueue, drain, both `tally_ingest_entries` and `tally_recorder_apply` are revoked from public, anon and authenticated, and granted to service_role.
  - The alert jobs and `tally_recorder_line` are revoked from everyone, service_role included.
  - `tally_alert_read` and `tally_device_recorder_source` go to authenticated, with member and owner checks inside, both firm-scoped.
- **RLS on the new public tables.**
  - `tally_alerts` and `tally_recorder_failures` have RLS on, a select policy `firm_id = my_firm()`, and no write policy.
  - The sequences are revoked.
  - Realtime on `tally_alerts` follows RLS.
- **The alert jobs write only `tally_alerts`.** The test hashes every other table before and after each job.
- **pg_cron times.**
  - `*/30 3-13 * * 1-6` UTC = 08:30-19:00 IST, Monday to Saturday. IST is UTC+5:30, so the day of week does not shift. The 08:30 run is skipped by `tally_alert_working_now`, which leaves exactly 09:00-19:00 IST.
  - `30 13 * * *` = 19:00 IST.
  - `cron.schedule(name, ...)` upserts by name.
  - This assumes `cron.timezone` is GMT/UTC, the Supabase default.
- **Concurrent drains.**
  - pg_cron never runs two instances of one job at once.
  - A drain called by the service role at the same time skips the other's messages: pgmq.read's `FOR UPDATE SKIP LOCKED` row lock is held until that drain commits, even after the 120 s visibility time.
  - The two applies are also serialised per book by `pg_advisory_xact_lock(hashtext(book))`.
  - Neither path applies a message twice.
- **Retry counting in the normal case.** `read_ct` and the archive after the 5th failure work as designed; the gap is M1.
- **48: the cache rebuilt once.**
  - Days are collected only from `applied` entry lines (`touched` covers old and new days). A failed line's work and days are undone by its savepoint.
  - Deletes and cancels rebuild their own day immediately. Each rebuild is a full recompute of the day from `tally_lines`, so the order does not matter.
  - Ledger lines flush the pending days first.
  - The `fincom.day_rebuild_once` GUC is transaction-local and reverts with an aborted subtransaction.
  - An exception that escapes mid-batch rolls the whole call back, rebuilds included.
  - The md5 tests agree.
- **The queue path cannot bypass validation.**
  - The queued lines are the same `cleanRecorderLine` output as the direct path.
  - Enqueue re-checks book/firm and device/firm, and the drain's `tally_recorder_apply` checks them again at apply time.
  - The device and firm come from the authenticated device key, never from the body.
- **`upload_new` / `upload_done` scoping.**
  - The firm comes from `members` (active, MFA), and the client must belong to that firm.
  - The job must have the same firm and client and kind `upload`.
  - The server-issued path is the only one read, and a different `path` in the body is refused with 409.
  - The size is checked against Storage's `Content-Range` total.
- **Byte-range bounds.**
  - `from` is clamped to 0 or more, and `end` to the job's size of 2 GB or less.
  - Each Range is at most PIECE (64 KB-16 MB).
  - The path is not client-controlled.
  - The memory issues are M4 and M5.

## Pass / fail

| Checklist item | Result | Ref |
|---|---|---|
| Add-only (47: no `delete from`, no data dropped; 48 may) | PASS | |
| Idempotent (runs twice) | PASS | tests |
| Every `security definer` has `search_path = public, pg_temp` | PASS | |
| Grants: revoked from public/anon; service-role functions not callable by authenticated | PASS (Low: L6, L8) | L6, L8 |
| RLS on every new table, firm-scoped, no direct writes | PARTIAL: public tables PASS; pgmq queue/archive tables not restricted | M6 |
| Alert jobs write only `tally_alerts` | PASS (Low: L7) | L7 |
| pg_cron: 09:00-19:00 IST Mon-Sat; 19:00 IST summary | PASS | |
| Queue drain safe under overlapping runs (no double apply) | PASS | |
| Retry counting | FAIL when the drain transaction aborts (cancel/timeout) | M1 |
| Queued vs direct ordering; failed sends visible | FAIL | H1 |
| storage.objects: caller's firm, no traversal to another firm, no update/delete | PASS (Low: free-form names) | L1 |
| `tally_jobs` CHECK swap (lock, existing rows) | PASS today; fragile selection | M7 |
| `tally_recorder_line` rename cannot cross books/firms | PASS (no ordering, merge risk: M8) | M8 |
| 48 rebuild once: days from all line kinds, exceptions mid-batch | PASS (Low: L9) | L9 |
| index.ts: queued path does not bypass validation | PASS | |
| `upload_new`/`upload_done`: firm ownership and issued path | PASS (race: M2; book: L3) | M2, L3 |
| Byte-range worker bounds and memory per piece | PARTIAL | M3, M4, M5 |
| No internal error text leaks | PARTIAL | L5 |
| Tests (47, 48, upload split) | PASS (pgmq is a stub) | |
