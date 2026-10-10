# Migration 50 (recorder held lines): database and security review

Branch `tax-accuracy`, commit `1fe2b0c`. This review was read-only; this note is the only file written.

- **Reviewed:** `server/tally-cloud/migration-50-recorder-held.sql` (md5 of the file `27a98877e5dc1d4cc23965b4182616c1`).
- **Compared against:** the staging base it replaces, which is 48's `tally_recorder_line`, 48's `tally_recorder_apply`,
  44's `tally_ingest_delete`, `tally_ingest_day`, `tally_recorder_release_held` and `tally_recorder_gap_check`.
- **Scenario runs:** the extra scenarios below ran on a separate pg_stand (port 30510), built in staging's order through
  50 with the same setup as `run_migration50.py`. The script was a scratch file and was not committed.

## Test runs (one pg_stand suite at a time)

| Suite | Result |
|---|---|
| `python3 tests/run_migration50.py` | **all passed** (exit 0) |
| `python3 tests/run_migration_order.py` | **all checks passed** (exit 0; both orders, twice each; 143 security definer functions search `public, pg_temp`; both orders end with the same 66 function texts) |

md5 of each function body. Each is the file's text between the `$function$` marks, and each equals `md5(pg_proc.prosrc)` after the run.

| Function | md5 |
|---|---|
| `tally_recorder_line(uuid, uuid, jsonb, bigint)` | `9ae3fd215eb25dbb12c95599ca3d7e8e` |
| `tally_ingest_delete(uuid, text, bigint, boolean, text)` | `a43aa5450e7ddedcc2f2ee4453eaa42b` |
| `tally_recorder_release_day(uuid, date)` | `efae5d0cb0d0a1475d65eaecb657c48d` |
| `tally_days_recorder_release()` | `a05c82ba0b4152aed289e00c77c59014` |

## Pass / fail

| Check | Result | Evidence |
|---|---|---|
| Add-only: no `delete from` (comments included), no drop or truncate | PASS | grep; suite |
| Runs twice | PASS | suite (runs 1 and 2) |
| State CHECK swapped only on 44's exact text (otherwise stops, nothing changed) | PASS | `:53-69`; suite (the "by hand" CHECK stops the file) |
| security definer, `search_path = public, pg_temp` on all four | PASS | suite |
| Grants: line, release_day and trigger function callable by nobody; `tally_ingest_delete` service role only | PASS | `:315, :356-357, :396, :410`; suite (`has_function_privilege`) |
| Trigger recursion: nothing it calls writes `tally_days` | PASS | read; `prosrc` scan of every callee is empty |
| Lock order and deadlock with `tally_ingest_day` and `tally_recorder_apply` | PASS | see note 1 |
| Nothing released for a locked month | PASS | suite; locked days never write `tally_days` (44 `:345-349`) |
| A placeholder GUID never creates an entry and is never the "same change" | PASS | `:130, :168`; suite |
| 'replaced' never marks a held line for a DIFFERENT entry | **FAIL** | M1 (E1a, E1c) |
| Placeholder 'duplicate' (`d_hit`) only for the same entry | **FAIL** | M1 (E1d, E1e) |
| "Nothing to delete" safe for a cut-short or old Day Book | **FAIL** | H1 (E2a, E2b, E3) |
| Day upload never fails or slows badly | **PARTIAL** | M2 (timings, 500 cap), L1 (statement timeout) |
| Held-why rewrite touches held rows only | PASS (with L3) | `:426` `where state = 'held'` |
| Gap check and `recorder_max_alter` | PASS (with L4) | see note 2 |

Note 1 (lock order): the only writer of `tally_days` is `tally_ingest_day` (44 `:392`), which takes
`pg_advisory_xact_lock(hashtext(book))` first. The trigger and `tally_recorder_release_day` (`:368`) take the same
lock again, which is re-entrant in the same transaction. `tally_ingest_entries` and `tally_ingest_delete` also take
the same lock. `tally_recorder_apply` and `tally_recorder_release_held` take it before touching rows. The
`'cursor'||book` lock (gap check) is never held together with the book lock, so 50 adds no cycle. The migration's own
locks are taken in this order: `tally_recorder_lines` (ALTER), then `tally_days` (CREATE TRIGGER), then the UPDATE.
All of them are under `lock_timeout = '10s'`.

Note 2 (gap check): `tally_recorder_release_day` raises `recorder_max_alter` only for 'applied' (`:382-387`), as
44's owner release does. A line made 'duplicate' by the Day Book is covered by `tally_days.alter_max`. 'Replaced'
lines have AlterIDs at or below the replacing line's, and that line raises the value through `tally_recorder_apply`.

## High

### H1. The "nothing to delete" rule: a cut-short or re-read Day Book applies the delete, and a late create then resurrects the entry

- **Where:** `:150-158`, especially `:152`.
- **The rule:** a Day Book row for the line's date with `d.at > r_at` and a note other than `'empty day with%'`
  counts as "a Day Book made after Tally deleted it that does not hold the entry".
- **Why that is wrong:** `tally_days.at` is set to `now()` on every write of the row (44 `:392-397`). That
  includes:
  - a short read (`n_in < p_n`, refused, nothing marked),
  - an empty file the bridge did not vouch for (`0 of n`),
  - the capped empty read,
  - a re-parse of an old kept file (`reparseMonthRaw`, `index.ts:1112`).
- **What the row cannot show:** `tally_days.n` keeps the bridge's count (`p_n`), not what the file held, so the row
  cannot tell a complete file from a cut-short one.
- **Measured** (lines received before the store):
  - **E2a:** a delete of an unknown GUID, then the day stored as a short read (1 of 5; `tally_days.n = 5`). The line
    ends 'applied' with "nothing to delete: the Day Book for 08-Oct-2026, stored after this change arrived, does not
    hold the entry".
  - **E2b:** an empty file the bridge counted 4 for ("short read: 0 of 4"). Same result: 'applied'.
  - **E3:** a day stored before the entry existed. The delete arrives, then the same old file is re-read. The delete
    is 'applied: nothing to delete'.
  - **E3, continued:** the create line from another PC then arrives late, with an AlterID **below** the delete's. It
    is applied: Receipt 611 is live in `tally_vouchers` (deleted = false), although Tally deleted it.
- **Why 44 did not lose this:** 44 kept the delete held. A delete applied to an entry in the copy leaves
  `tally_vouchers.alter_id` at the delete's AlterID, so a late create is 'stale' (`:189`). "Nothing to delete"
  leaves no such record, so the late create wins silently and the held signal is gone.
- **Fix:** apply "nothing to delete" only when all of these hold:
  1. The day's file was complete: no `refused`. Either have `tally_ingest_day` record it (a column), or at least
     require `d.n <=` the live count of `tally_vouchers` for that day, or a confirmed empty note
     (`'empty day, nothing to mark'` or `'% marked deleted on the second empty read'`).
  2. `d.alter_max >= the line's alter_id`, so the file itself proves it was made after the delete. A re-parsed old
     file fails this.
- **Fix, second part:** in the entry path, treat an applied delete or cancel line of the same GUID with a higher
  AlterID as making the entry 'stale'. Otherwise, keep such deletes held, as 44 did.

## Medium

### M1. Matching by type, number and date marks a different entry's line 'replaced' or 'duplicate'

- **Where:** `:285-293` (`d_hit`) and `:300-303` (replaced).
- **Measured:**
  - **E1a:** two Receipts numbered 500 on 06-Oct (Tally allows this under manual numbering or "allow duplicates").
    Entry A's placeholder line is held. Entry B (another GUID) is applied, and A's line becomes "replaced by line 2
    (the entry's details arrived)". A's details never arrived, and A is no longer shown as held.
  - **E1e:** a Day Book holding a different Receipt 503 makes the placeholder 503 'duplicate'.
  - **E1d:** a placeholder **altered** line for Receipt 150, which the copy holds at its older version. It is
    'duplicate' on arrival ("the copy holds Receipt 150 ... already"), although the alteration is not in the copy.
    `d_hit` checks no AlterID and no time.
  - **E1c:** a line with no GUID and no `company_guid` is replaced by an entry with any company prefix. Line `:303`:
    `coalesce(null, null, prefix(og)) is not distinct from prefix(og)` is always true. `d_hit` is the same (`:288`).
  - **Passes:** a placeholder from another company GUID is not replaced (E1b). Different companies are different
    books, and both rules are scoped to `book_id`.
- **Fix:**
  1. When the line has `master_id > 0`, derive the GUID as `prefix || '-' || lpad(to_hex(master_id), 8, '0')` and
     match by GUID only. Staging's L4 carries master_id 26312 = 0x66C8, exactly its entry's GUID suffix.
  2. Fall back to type, number and date only when exactly one live entry matches. Require a known company prefix
     (never null to null).
  3. For `event = 'altered'`, mark 'duplicate' only when the copy's version came from a Day Book stored after the
     line (`tally_days.at > received_at` and `alter_max > 0`) or from a later recorder line.

### M2. Upload cost, row churn, and the 500 cap that starves later lines

- **Where:** `:369-374` and `:308`.
- **Measured on pg_stand** (20 entries a day, one statement per day as `tally-ingest` sends them):

  | Run | Time per day |
  |---|---|
  | 365 days, 3,000 held lines in the book (about 8 a day), trigger on | **76 ms** |
  | Same, trigger off | 12 ms |
  | One day holding 3,000 held lines (500 re-run), trigger on | **2.9-3.1 s** on every store |
  | Same day, trigger off | 39 ms |

- **What that means:** a year's upload adds about 23 s of database time at this held count. pg_stand has no
  `tally_vouchers (book_id, day)` index, which staging has (migration.sql:92), so staging may be somewhat faster.
- **Row churn:** every re-run rewrites the held row, even when it stays held (`:308`). All 3,000 rows were
  rewritten in one pass, at two subtransactions per line, which is above the 64-subxid cache when more than 32 lines
  run. Every bridge read of today repeats this.
- **Starvation (E4):** `order by l.id limit 500` re-runs the same oldest 500 lines on every store. In E4, a delete
  line at position 521, whose entry the stored day holds, stayed held after three stores of that day.
- **Fix:**
  - Re-run only lines that can change: skip lines with no GUID; skip a placeholder with no type, number or date;
    skip a line whose `received_at` is later than the previous `tally_days.at`.
  - Order deletes and cancels and GUID matches first, or keep a `last_run_at` and pick the least recently run.
  - Skip the final UPDATE when `state` and `held_why` are unchanged.

## Low

- **L1. A statement timeout is not swallowed.**
  - **Where:** `:389-391, :406-408`.
  - **What happens:** `when others` does not catch `query_canceled`. With `statement_timeout = 30ms`, the day with
    500 held lines failed (E6, exit 3); the same day with the trigger off succeeded. Under any role timeout the
    "never fails the day" promise does not hold.
  - **Fix:** bound the loop by `clock_timestamp()` (for example 1 s), and leave the rest to the next store.
- **L2. A held line whose re-run errors becomes 'failed'.**
  - **Where:** `tally_recorder_line :305-306`.
  - **What happens:** the trigger only re-runs 'held' lines, so the line leaves the held list for good. Before 50,
    this happened only on the owner's own release.
  - **Fix:** in `release_day`, keep the state 'held' when the result is 'failed' (log it instead).
- **L3. The rewrite of old held words leaves some rows on the old text.**
  - **Where:** `:418-429`.
  - **What happens:** held delete and cancel rows with 48's `'no GUID on the line: held, never a new row'` keep the
    old words, while new lines get "no entry GUID on the line: it cannot be applied by itself ...". This is harmless
    (it does not say "day read") but inconsistent. The rewrite correctly touches held rows only.
- **L4. `recorder_max_alter` and placeholder 'duplicate' lines.**
  - **What happens:** in `tally_recorder_apply`, a placeholder line that ends 'duplicate' through `d_hit` raises
    `recorder_max_alter` by its own alter_id. It counts as having an `object_guid` (48 `:356-357`). The value is 0
    on staging's lines. Under the M1 collision, a non-zero AlterID would be credited for a different entry's change
    and could hide a gap.
  - **Fix:** exclude `-00000000` GUIDs from `mx`.
- **L5. The loop does not re-check state.**
  - **Where:** `:369-379`.
  - **What happens:** `release_day` iterates a cursor snapshot, so a row that an earlier iteration made 'replaced'
    is still re-run, and its state is overwritten at `:308`. This is unlikely today: lines with a body that are held
    are almost all 'month locked', which is excluded.
  - **Fix:** `select ... for update` the row and `continue` unless it is still 'held'.
- **L6. The trigger fires once per row.**
  - **What happens:** any future bulk UPDATE of `tally_days` (for example a backfill) would run a release per day
    and take book locks in row order.
  - **Fix:** make the trigger `when (pg_trigger_depth() = 0)` or a statement-level trigger, or document that
    `tally_days` must only be written through `tally_ingest_day`.

## What is right

- The CHECK swap is exact and idempotent.
- The placeholder GUID is never an entry, never stores a body (`:109`) and is never the "same change" (`:130`).
- The duplicate check and the `applied_once` unique index stop two unknown deletes of one GUID both applying.
- Locked months are never released by a day store.
- The trial balance and the ledger-day cache stayed equal to a fresh computation in every suite step.
- No recursion: nothing the trigger calls writes `tally_days`.
- Grants and definer settings are as 44 and 48 had them.

## Fixed (05-Oct-2026, before 50 ran anywhere)

The file was changed test-first. The reds are in the session scratchpad (`tdd/r51.1.red`: 23 checks failing on the
reviewed file). Each finding is now a check in `tests/run_migration50.py`, built from the scenarios above, and all of
them pass. File md5 after the fixes: `aba6aba619b5952e54a5c4d231a90a14`.

| Function | md5 after the fixes |
|---|---|
| `tally_recorder_line(uuid, uuid, jsonb, bigint)` | `9bc527da5e6ad1bbc0cd9566b1da549f` |
| `tally_ingest_delete(uuid, text, bigint, boolean, text)` | `a43aa5450e7ddedcc2f2ee4453eaa42b` (unchanged) |
| `tally_recorder_apply(uuid, uuid, uuid, jsonb)` | `97a585277a7f4da9b105575e4c7fb9bf` (new in 50: 48's text, one condition added, for L4) |
| `tally_recorder_release_day(uuid, date)` | `cc892ff720a5edfa1a1ba5b02b61a004` |
| `tally_days_recorder_release()` | `c54362f5ed2d515d9f73fda2b6022e03` |

- **H1: Fixed.**
  - "Nothing to delete" now needs the stored day to be complete: `tally_days.n` must equal the live entries the copy
    holds for that day. A short read, an empty file nobody vouched for and a capped read all fail this.
  - It also needs `tally_days.alter_max` to be at or above the delete's AlterID. A re-parsed old file fails this.
  - Otherwise the delete stays held with "not in FinCom's copy yet" words. Checks: E2a, E2b and E3 are held; a complete,
    newer Day Book still gives "nothing to delete".
  - A delete applied for a GUID makes any later entry line of that GUID with a lower AlterID 'stale'. The late create
    from another computer is 'stale', and the entry is not in the copy.
  - Beyond the review: when a create brings the entry into the copy, a delete or cancel held "not in the copy" at a
    higher AlterID is applied with it. Check E3: the late create (64205) is applied, the held delete (64210) is applied
    with it, and Receipt 611 is deleted, never live.
- **M1: Fixed.**
  - A placeholder or GUID-less line with `master_id > 0` matches only the GUID its MasterID makes: the company prefix,
    then `-`, then `lpad(to_hex(master_id), 8, '0')`.
  - With MasterID 0, it matches by type, number and date only when the company prefix is known (never null to null)
    and exactly one live entry of that company fits. This applies to both 'replaced' and 'duplicate'.
  - An 'altered' placeholder is 'duplicate' only when the copy shows the change. That means an AlterID above the
    line's, or a Day Book of that day stored after the line arrived, or a later line of that entry applied.
  - This goes beyond the literal "copy newer than the line's AlterID", because placeholders carry AlterID 0.
  - Checks E1a, MasterID 37000/37001, E1e, E1d and E1c all pass. Staging's line 4 (MasterID 26312, i.e. `...66c8`) is
    still released.
- **M2: Fixed.**
  - The day release runs only the held lines that the stored day can release:
    - lines whose GUID is one of the day's entries (a bodiless entry line only when the day's version is not older
      than it);
    - placeholder or GUID-less lines whose MasterID makes one of those GUIDs, or whose type and number match one,
      dated that day;
    - deletes and cancels dated that day.
  - They are found through `(book_id, object_guid)` and two new partial indexes on the held lines:
    `(book_id, vch_date)` and `(book_id, master_id)`.
  - All candidates run, oldest first. There is no 500 window. Check E4: the 601st line is applied on the first store.
  - A line whose state and words do not change is not rewritten. The check reads xmin before and after.
  - pg_stand now has `tally_vouchers (book_id, day)`, as staging does (checked with SELECT). Statistics are analyzed,
    as autovacuum would do on staging.
  - Timings on pg_stand, per store:

    | Run | With the triggers | Without |
    |---|---|---|
    | One day, 20 entries, 3,000 held lines | 23-24 ms | 16-18 ms |
    | 365 days, 3,000 held lines, the same days stored again | 33.7 ms a day | 22.9 ms a day |
    | 365 days, 3,000 held lines, first store | 46.0 ms a day | not measured |

    The year is measured with `M50_PERF=1`.
- **L1: Fixed.** The trigger catches `query_canceled` as well as other errors, logs it, undoes the release's work and
  keeps the day. Check: a statement timeout while the release waits on a locked line. The day is stored, the line is
  left held, and the next store releases it.
- **L2: Fixed.** A re-run that ends 'failed' is put back to 'held'. Its words are kept, and the error is added once as
  "(a try to apply it by itself met an error: ...)". It is not piled up on a second try.
- **L3: Fixed.** Held deletes and cancels with no GUID, both new and the rows 48 held, say "no entry GUID on the line:
  FinCom cannot tell which entry was deleted, so this line is never applied by itself; uploading the Day Book for
  <date> brings that day up to date".
- **L4: Fixed.** `tally_recorder_apply` (48's text plus one condition) never counts a `-00000000` GUID's AlterID.
  `release_day` has the same guard.
- **L5: Fixed.** Each candidate is locked (`for update`) and skipped unless it is still 'held'.
- **L6: Fixed.** There are two statement-level triggers, after insert and after update, with the transition table
  `new_days`. They run one release per (book, day) in the statement. Check: one UPDATE of two days releases both days'
  held deletes.

## Round 2 (05-Oct-2026, after the fixes)

Branch `tax-accuracy`, commit `e4874f8`. This round was read-only, and this section is the only change. The file
reviewed is `server/tally-cloud/migration-50-recorder-held.sql`, md5 `aba6aba619b5952e54a5c4d231a90a14` (the same as
in the fixes section).

### Test runs (one at a time)

| Suite | Result |
|---|---|
| `python3 tests/run_migration50.py` | **all passed** (exit 0, 85 checks) |
| `python3 tests/run_migration_order.py` | **all checks passed** (exit 0; 144 security definer functions search `public, pg_temp`; both orders end with the same 66 function texts) |

md5 of each function body. Each is the file's text between the `$function$` marks, and each equals the suite's
`md5(prosrc)`.

| Function | File line | md5 |
|---|---|---|
| `tally_recorder_line(uuid, uuid, jsonb, bigint)` | `:95` | `9bc527da5e6ad1bbc0cd9566b1da549f` |
| `tally_ingest_delete(uuid, text, bigint, boolean, text)` | `:383` | `a43aa5450e7ddedcc2f2ee4453eaa42b` |
| `tally_recorder_apply(uuid, uuid, uuid, jsonb)` | `:425` | `97a585277a7f4da9b105575e4c7fb9bf` |
| `tally_recorder_release_day(uuid, date)` | `:489` | `cc892ff720a5edfa1a1ba5b02b61a004` |
| `tally_days_recorder_release()` | `:551` | `c54362f5ed2d515d9f73fda2b6022e03` |

### Staging's base (read-only SELECTs, project `tds-desk-staging`)

| Function on staging | md5(prosrc) | Expected base | Result |
|---|---|---|---|
| `tally_recorder_line` | `360fb49a87d037356a863591456beaca` | 48's text (`360fb49a…`) | equal |
| `tally_ingest_delete` | `8db783fcde9064bf8e6188a1ce63e594` | 44's text (`8db783fc…`) | equal |
| `tally_recorder_apply` | `fef11f9e85d1f4e5cde79cd48a771543` | 48's text (`fef11f9e…`) | equal |

The same md5s come from the repository's 48 and 44 texts.

Other facts about staging:
- `tally_recorder_release_day` and `tally_days_recorder_release` do not exist yet, and `tally_days` has no trigger.
- The state CHECK is exactly 44's text, so the swap at `:76-92` takes it.
- `tally_recorder_lines` holds **4 rows** (all held, 88 kB). `tally_days` holds 553 rows and `tally_vouchers` 4,016.
- Staging has two `tally_ingest_day` overloads (7 and 8 arguments). Both upsert `tally_days`, so the triggers cover both.

### Confirmation of round 1

| Finding | Result | Evidence |
|---|---|---|
| H1 "nothing to delete" on a cut-short or old Day Book, late create revives | **Confirmed** (safe) | `:183-185` complete and AlterID tests; `:220, :229-230` an applied delete makes an older line stale; `:357-368` a held delete is applied when its entry arrives; E2a/E2b/E3 checks. **But** the AlterID half holds deletes it should release: see N1 |
| M1 type/number/date matching hits another entry | **Confirmed** | `:126-128` GUID from MasterID; `:330-334` exactly one fit under a known prefix (never null to null); `:336-338` an 'altered' line only when the copy shows the change; `:349-356` the same for 'replaced' |
| M2 cost, churn, 500 cap | **Confirmed** | `:497-516` only the lines the day can release, no window; `:376` no rewrite when nothing changes; indexes at `:480-481`; suite timings 23 ms (on) and 24 ms (off) a store with 3,000 held lines |
| L1 statement timeout not swallowed | **Confirmed** | `:565` `when query_canceled or others`; check passed (the day is stored, the line released on the next store) |
| L2 re-run error makes the line 'failed' | **Confirmed** | `:526-530` put back to 'held', the error said once |
| L3 old held words on GUID-less deletes | **Confirmed** | `:155`, `:589-590` |
| L4 placeholder AlterID counted | **Confirmed** | `:456` (apply), `:534` (release_day) |
| L5 loop does not re-check state | **Confirmed** | `:519-520` `for update`, then skipped unless still held |
| L6 row trigger | **Confirmed** | `:570-579` statement level |

### What the fixes introduced, checked

- **Statement triggers on an upsert.** `tally_ingest_day` writes the day with one `INSERT ... ON CONFLICT DO UPDATE`
  (44 `:392`). It never inserts and then updates the same row: one statement cannot touch a row twice.
  - Measured on a scratch pg_stand (PG 16; staging runs PG 17, and the rule is the same): each such statement fires
    **both** statement triggers.
  - Each row appears in exactly one transition table. A new day is in the insert trigger's `new_days`; an existing day
    is in the update trigger's. The other trigger gets an empty table and loops zero times.
  - So each stored day gets exactly one release. If a day were written twice in one transaction, the second release
    would find nothing still held, which is harmless.
- **Recursion.** None.
  - `tally_ingest_day` (44 `:392`) is the only function that writes `tally_days`. The functions 11 to 23 that also
    wrote it have been replaced.
  - Nothing the release calls writes `tally_days`: `tally_recorder_line`, `tally_ingest_entries`,
    `tally_ingest_delete`, `tally_ledger_day_rebuild` and `tally_voucher_version_lines`.
  - No other trigger writes it. The triggers on `tally_vouchers` are 32's origin trigger and its version keeper.
- **A failure never fails the day.**
  - Each day is a subtransaction (`:558-562`), and so is the whole trigger body (`:565-567`).
  - `others` covers every error except `query_canceled`, which the outer handler catches.
  - The suite proves the case of a statement timeout.
  - The cost of this: a cancel undoes every release in that statement. Since a statement stores one day, that is
    acceptable.
- **`tally_recorder_apply`.** A diff against 48's text (`migration-48-day-cache-once.sql`) shows exactly one change.
  The `if` at `:454-456` gains `and x->>'object_guid' !~ '-0{8}$'`. Grants are revoked from public, anon and
  authenticated, and granted to service_role only (`:475-476`, as 48 `:371-372`). Its callers: `tally-ingest`
  (`index.ts:934`) with the service key; the app never calls it.
- **The new partial indexes** (`:480-481`).
  - `IF NOT EXISTS` makes a re-run safe. It would also keep a same-named index with another definition, which is
    unlikely.
  - `CREATE INDEX CONCURRENTLY` cannot run inside the file's `begin ... commit`. A plain build takes a SHARE lock, which
    blocks writes to `tally_recorder_lines` while the build scans the whole table (a partial index still reads every row).
  - On staging's 4 rows (88 kB), the build takes milliseconds.
  - On a big table, expect about 1 s per 1 to 2 million rows. The earlier `ALTER TABLE ... ADD CONSTRAINT CHECK`
    (`:85`) is the bigger lock: ACCESS EXCLUSIVE while it validates every row. Both are bounded by `lock_timeout = '10s'`
    while waiting, but not while building.
  - No issue at today's size. If the table reaches millions of rows before 50 runs, build the two indexes
    `CONCURRENTLY` by hand first; the file's `IF NOT EXISTS` then skips them.
- **The create-then-held-delete rule** (`:357-368`).
  - **Permission.** `tally_ingest_delete` is reached either with the service role (apply, short retry, the day trigger
    under `tally_ingest_day`) or with `fincom.recorder_release` set (an owner's release, `release_day`). So its
    permission check never fires.
  - **Duplicates.** The guard against the `applied_once` unique index is right.
  - **Order.** It runs only after the entry is applied, so the entry is never left live.
- **The stale rule for a late create** (`:220, :229-230`).
  - It comes after the copy's own AlterID check, so it adds nothing when the entry is in the copy (`c_alter` already
    carries the delete's AlterID).
  - It turns a late lower create into 'stale' when the delete was "nothing to delete".
  - It counts only `event = 'deleted'`, which is right: a cancelled entry still exists.
- **The "complete day" test** (`:185`: `tally_days.n` = the live entries of the day).
  - A soft-deleted entry does not break it. A full read marks every entry missing from the file, and
    `tally_ingest_entries` clears `deleted_at` on every entry in it (48 `:82`). So after a full read, the live count
    equals the distinct GUIDs sent.
  - A cancelled entry does not break it either. It stays live (`deleted_at` null) and is kept by the parser when it has
    a number (`parse.js:126`), so both sides count it. Staging's Receipt 190 shows this: cancelled, live, counted
    (05-Oct `n = 2 = live`).
  - All 553 of staging's stored days pass the test today.
  - What can fail it is L7 below. A day that recorder lines changed after its store also fails, but only until the day
    is stored again.

### Medium

#### N1. The AlterID half of "nothing to delete" holds a delete for ever, and the held words promise a release that cannot come

- **Where:** `:184` (`d.alter_max >= alt`), the words at `:190` and `:396`.
- **The problem:** `tally_days.alter_max` is the highest AlterID **among that day's entries**, not the company's
  AlterID when the file was read. Deleting an entry takes a new AlterID, which is above every entry already on the day.
  So a Day Book of that day made after the delete still reaches the delete's AlterID only if another entry **of the
  same day** was created or altered after it. Usually none is, and for a past day almost never.
- **Measured on staging** (read-only):
  - Line 2 deletes Receipt 189 of 01-Oct, at AlterID 54386, received 02:26:59.
  - The 01-Oct Day Book was stored at 02:33:40, **after** the line. It is complete (`n = 2 = live`), and it does not
    hold the entry (`...-000066c1` is not in the copy). Its `alter_max` is **54384** (entries 54383 and 54384).
  - So 50 leaves line 2 held: "the entry is not in FinCom's copy yet; it is applied by itself once the Day Book for
    01-Oct-2026 is uploaded".
  - Uploading 01-Oct cannot release it: the same two entries give 54384 again. An owner's release runs the same rule.
  - Line 2 is one of the four blocker lines 50 exists to release, and the words 50 makes truthful are untrue for it.
    Nothing is corrupted: it is held, as in 44.
- **The other three lines on staging, for comparison:**
  - Line 3, the cancel of Receipt 190: 190 is in the copy, cancelled, so the cancel is applied as "already
    cancelled".
  - Line 1, placeholder Receipt 191 with MasterID 0: exactly one Receipt 191 of 05-Oct is under the company. The
    05-Oct Day Book was stored after the line with `alter_max > 0`, so the line ends 'duplicate'.
  - Line 4, Receipt 192 with MasterID 26312 (`...66c8`): not in the copy, so it waits for Bridge 2.2.1's `:resolved`
    line. Its words are truthful.
  - These three are released only by a store of their day or by an owner's release. The file itself re-runs no line.
- **Fix (keeps H1 safe):**
  1. Replace `d.alter_max >= alt` with "stored after the line came": `d.at > r_at`, together with the complete test.
  2. Close the re-parse hole that the AlterID test was guarding (E3), where an old kept file re-read after the delete
     brings the entry back live. In `tally_recorder_release_day`, for each entry of the stored day that has a
     `deleted` line already 'applied' at an AlterID above the day's version of it, call `tally_ingest_delete` again
     (it is idempotent; that line's AlterID passes the stale check).
     - This makes "nothing to delete" safe whatever file arrives later. It also closes the same hole for deletes of
       entries the copy did hold, which exists since 44, because a Day Book re-read clears `deleted_at` without an
       AlterID check (48 `:82`).
     - The `:220/:229` stale rule already covers recorder lines.
  3. The alternative is to record, per stored day, a read time or a company-wide AlterID that a re-parse does not
     refresh, and test that instead.
  4. At the least, change the words at `:190` and `:396` so they do not promise that an upload releases the line.
- **Test to add:** staging's line 2 exactly. A day of entries 54383 and 54384, stored complete after a delete at 54386
  of an entry not in the copy. The expectation is "nothing to delete", and then an old file re-read must not revive
  the entry.

### Low

- **L7. A day with an entry the parser drops is never "complete" through the bridge.**
  - **Where:** the bridge's count is `countVouchers` = every `<VOUCHER` tag (`bridge-go/keep.go:267`; `index.ts:1070`
    sends it as `p_n`).
  - **What happens:** `parseDay` drops entries with no GUID, and entries with no ledger lines unless they are
    cancelled with a number (`parse.js:124-126`). Examples are inventory-only Stock Journals and Delivery Notes.
  - On such a day, every bridge store is a "short read". This has been so since 38. `tally_days.n` is then above the
    live count, so a delete of an entry not in the copy dated that day stays held after every bridge store.
  - The re-parse path (`index.ts:1113`, `p_n = r.n`) passes the count test.
  - **Fix:** this predates 50. Count in the bridge what the parser keeps, or have `tally-ingest` pass the parsed count
    beside the bridge's. Until then the words "once the Day Book is uploaded" hold only for an upload that sends no
    bridge count.
- **L8. A held cancel can stay held beside an applied cancel of the same AlterID.**
  - **Where:** `:363`.
  - **What happens:** the create-then-held-delete rule leaves the held line held when an applied line of the same
    GUID, AlterID and event exists (this avoids `applied_once`). For deletes this cannot happen: the create would have
    been stale (`:229`). For a cancel arriving twice from two computers, the second can stay held "not in the copy yet"
    while the entry is cancelled.
  - **Fix:** mark it 'duplicate' instead.
- **L9. The apply guard does not trim the GUID.**
  - **Where:** `:456`.
  - **What happens:** the guard tests `x->>'object_guid'` untrimmed, while the line trims it (`:98`). A placeholder
    GUID with trailing white space would still raise `recorder_max_alter` by its AlterID. The add-on writes AlterID 0
    on those lines, so this is cosmetic.

### Verdict

**One Medium (N1).**
- It does not damage data, and running 50 is safe: no line is applied wrongly, the triggers never fail a day, and the
  base on staging is exactly what 50 replaces.
- But it leaves staging's line 2 (Receipt 189's delete) held for ever, with words promising an upload will release it.
- Fix N1 before running 50, or run it knowing line 2 needs the follow-up.

## Round 2: Fixed (05-Oct-2026, before 50 ran anywhere)

The file was changed test-first. The reds are in the session scratchpad: `tdd/r52.1.red` (14 checks failing on file
`aba6aba6…`) and `tdd/r52.2.red` (the L9 check failing on the untrimmed guard). All checks now pass:
`run_migration50.py`, `run_migration_order.py`, `run_recorder_server.py`, `run_recorder_held_words.py`,
`run_migration47.py` and `run_migration48.py`. File md5: `9cd910b3c74f7af3d57774211966bfc8`.

| Function | md5 |
|---|---|
| `tally_recorder_line(uuid, uuid, jsonb, bigint)` | `8ac8ea2dacc07f56714eab9bb7dc3cf2` |
| `tally_ingest_delete(uuid, text, bigint, boolean, text)` | `09ec611a970cfc03cafdd494f1e88c0b` (its held words only) |
| `tally_recorder_apply(uuid, uuid, uuid, jsonb)` | `25f02b91454654526be375af42019856` (L9) |
| `tally_recorder_release_day(uuid, date)` | `b44bd07e78059fd23efc599dd7c2ef8b` |
| `tally_days_recorder_release()` | `c54362f5…` → `4248dcfb246c492b90f20a940ef516be` |

- **N1: Fixed.**
  - **The test.** "Nothing to delete" now needs the day to be stored after the line arrived (`tally_days.at` later than
    the line's `received_at`) and complete (`n` = the live entries of that day). The AlterID test is gone.
  - **Cancels.** A cancel in the same position is applied as "nothing to cancel".
  - **The re-parse hole.** On every stored day, `tally_recorder_release_day` first deletes (or cancels) again, through
    `tally_ingest_delete`, each entry of that day whose applied delete (or cancel) line is above the entry's version.
    An older kept file read again therefore never revives the entry. This also closes the same hole for entries the copy
    held, which existed since 44. The triggers run this for books that have any recorder lines.
  - **Late creates.** The stale rule for a late, lower-AlterID create now counts an applied cancel as well as an applied
    delete.
  - **Words.** A day stored after the line but not complete says so: "the Day Book for <date> stored after this change
    was not complete (k of n entries); … applied by itself once a complete Day Book for that day is uploaded". Otherwise
    the line says "… once a complete Day Book for <date> is uploaded". Every promise names a complete Day Book (see L7).
  - **Checks.**
    - Staging's line 2, on a book of its own: the 01-Oct day is stored after the line, complete (`n = 2`), with
      `alter_max` 54384. Result: 'applied', "nothing to delete: the Day Book for 01-Oct-2026, complete and stored after
      this change arrived, does not hold the entry".
    - An old kept 01-Oct file that still holds Receipt 189 is read again: 189 is deleted again at once and is never live.
    - E3: a day stored before the line arrived keeps the line held. Stored again after it, the line is "nothing to
      delete". The late create from another computer (AlterID 64205) is 'stale'. An older file holding the entry, read
      again, deletes it again.
    - E2a and E2b: held, with the "not complete (1 of 5)" and "(0 of 4)" words.
  - **On staging after 50 runs:** line 2 is released by the next store of 01-Oct, or at once by an owner's Apply now
    (the same rule: the 01-Oct day was stored at 02:33:40, after the line's 02:26:59).
- **L7: not fixed here.** It predates 50: the bridge counts `<VOUCHER` tags while the parser keeps fewer. Until the
  bridge counts what the parser keeps, a bridge store of such a day says "not complete (k of n)", which is true. An
  upload without a bridge count, or a re-parse, completes it.
- **L8: Fixed.** When the entry arrives, a held cancel or delete whose same change (same GUID, AlterID and event) is
  already applied becomes 'duplicate', "the same change already came as line N (applied)". Check: two cancels from two
  computers, then the create. The first is applied and the second is 'duplicate'.
- **L9: Fixed.** The apply guard trims the GUID as the line does: `left(btrim(x->>'object_guid'), 100) !~ '-0{8}$'`.
  Check: a placeholder with trailing spaces leaves `recorder_max_alter` unchanged.
- **Timings, re-measured on pg_stand:**

  | Run | With the triggers | Without |
  |---|---|---|
  | One day, 3,000 held lines | 23-24 ms a store | 14-18 ms |
  | 365 days, 3,000 held lines, first store | 46.9 ms a day | not measured |
  | 365 days, 3,000 held lines, the same days stored again | 26.3 ms a day | 21.7 ms a day |

## Round 3 (05-Oct-2026, after the round-2 fixes)

Branch `tax-accuracy`, commit `9dff0da`. This round was read-only, and this section is the only change. The file
reviewed is `server/tally-cloud/migration-50-recorder-held.sql`, md5 `9cd910b3c74f7af3d57774211966bfc8`.

### Test runs (one at a time)

| Suite | Result |
|---|---|
| `python3 tests/run_migration50.py` | **all passed** (exit 0, 94 checks) |
| `python3 tests/run_migration_order.py` | **all checks passed** (exit 0; 144 security definer functions search `public, pg_temp`; both orders end with the same 66 function texts) |

md5 of each function body. Each is the file's text between the `$function$` marks, and each equals the suite's
`md5(prosrc)`.

| Function | File line | md5 |
|---|---|---|
| `tally_recorder_line(uuid, uuid, jsonb, bigint)` | `:102` | `8ac8ea2dacc07f56714eab9bb7dc3cf2` |
| `tally_ingest_delete(uuid, text, bigint, boolean, text)` | `:395` | `09ec611a970cfc03cafdd494f1e88c0b` |
| `tally_recorder_apply(uuid, uuid, uuid, jsonb)` | `:437` | `25f02b91454654526be375af42019856` |
| `tally_recorder_release_day(uuid, date)` | `:501` | `b44bd07e78059fd23efc599dd7c2ef8b` |
| `tally_days_recorder_release()` | `:580` | `4248dcfb246c492b90f20a940ef516be` |

**Staging's base** (read-only SELECT, `tds-desk-staging`):

| Function | md5(prosrc) | Matches |
|---|---|---|
| `tally_recorder_line` | `360fb49a87d037356a863591456beaca` | 48 |
| `tally_ingest_delete` | `8db783fcde9064bf8e6188a1ce63e594` | 44 |
| `tally_recorder_apply` | `fef11f9e85d1f4e5cde79cd48a771543` | 48 |

The two new functions do not exist on staging yet. These are exactly the texts 50 replaces.

Other checks on the file:
- `tally_recorder_apply` diffed against 48's text: still exactly one changed condition (`:466-467`, now trimmed).
- The grants are unchanged.
- The file still holds no `delete from`.

### Confirmation of round 2

| Finding | Result | Evidence |
|---|---|---|
| N1 the AlterID test holds a delete for ever | **Confirmed** | `:190-197` stored after the line (`d.at > r_at`) and complete; the AlterID test is gone. The check reproduces staging's line 2 (01-Oct, `alter_max` 54384 below the delete's 54386, stored 02:33:40 after the line's 02:26:59): 'applied', "nothing to delete" |
| L8 a cancel arriving twice stays held | **Confirmed** | `:373-378` the twin is found, and the held line becomes 'duplicate' |
| L9 the apply guard does not trim | **Confirmed** | `:467` `left(btrim(x->>'object_guid'), 100) !~ '-0{8}$'` |

### What the fixes introduced, checked

- **(a) The re-delete on every stored day** (`:512-525`).
  - **Which entries.** It acts only on an entry live in the copy on the stored day that has an **applied** delete or
    cancel line at an AlterID strictly above the copy's version (`coalesce(l.alter_id, 0) > coalesce(v.alter_id, 0)`).
    A cancel is skipped when the entry is already cancelled.
  - **It never deletes what Tally holds.** Tally gives each change a new, higher AlterID, so a file made after the
    delete or cancel carries the entry (if at all) at an AlterID at or above it, and it is left alone. Only a file
    older than the change revives an entry below that AlterID, and that entry is deleted again.
  - **Re-created entries.** An entry re-created with the same GUID would carry an AlterID above the delete's and would
    not be touched. (Tally never reuses a GUID.)
  - **How it deletes.** Only through `tally_ingest_delete`, which is soft:
    - `deleted_at` is set, or `cancelled` for a cancel.
    - The versions are kept: version lines are written before and after, and a version row is added for the AlterID.
    - The ledger-day cache is rebuilt.
    - Its own stale and lock checks still apply.
  - **Permission.** `fincom.recorder_release = '0'` allows the call. It is local to the transaction, and it is reset to
    the caller's value at `:572`. A subtransaction that fails reverts it with itself.
  - **Cost.** It is driven by the day's entries, through `(book_id, day)` and `(book_id, object_guid)`. It is one index
    probe per entry of the day, not per applied delete, so a book with many applied deletes pays nothing extra.
    `tally_ingest_delete`, with its cache rebuild, runs only for an entry actually revived.
  - **Failure.** Each entry runs in its own subtransaction, and an error is logged. An entry that fails stays live (only
    logged) until the next store of the day. It never fails the day.
- **(b) "Nothing to cancel" applied** (`:192-193`).
  - Tally lists a cancelled entry in its Day Book, and `parse.js:126` keeps it when it has a number. So a complete
    Day Book stored after the cancel line arrived that does not hold the entry means the entry is gone, or the file is
    an older one read again from before the entry existed.
  - In both cases the copy correctly holds nothing live. An older file that later holds it uncancelled is cancelled
    again by (a).
  - Accounting is unaffected either way, because cancelled entries are never in the ledger-day cache (44 `:236`).
  - There is one gap in what the copy lists: see R3-L2.
- **(c) The triggers now run for any book with recorder lines** (`:585`, an `exists` over 44's `(book_id, state)`
  index).
  - Every day store of such a book now runs the release.
  - Measured by the suite: 26.3 ms a day stored again with the triggers, against 21.7 ms without; the first store is
    46.9 ms. On a single day with 3,000 held lines: 23-24 ms, against 14-18 ms.
  - Failure handling is unchanged: each day runs in a subtransaction, the outer handler catches `query_canceled` and
    other errors, and the day is always stored.
  - Recursion is still impossible: nothing called writes `tally_days`.
- **(d) The held words.**
  - **"Not in FinCom's copy yet; ... once a complete Day Book for `<date>` is uploaded"** (`:197`, `:417`, `:625`) is
    true. Any complete store of that day after the line arrived picks it up: the release's third union finds held
    deletes and cancels by `vch_date`, and the rule then applies it.
  - **"Stored after this change was not complete (k of n entries)"** (`:195`) is true when written.
  - **Exceptions:** see R3-L3.

### Findings

No High and no Medium.

- **R3-L1. "Nothing to delete (cancel)" no longer needs an AlterID.**
  - **Where:** `:190-193`. Round 1 had `alt > 0`.
  - **What happens with no AlterID:** a delete or cancel line with no AlterID that is applied this way is invisible to
    the late-create stale rule (`:237`, where `del_alt > alt` is null) and to the re-delete (`:516`, where 0 > version
    is false). For such a line, H1's revival hole is open again.
  - **What happens with a placeholder GUID:** `:166` never treats it as the same change, so a placeholder delete with
    AlterID 0 that arrives twice would be applied twice. The second write violates `applied_once` in the final UPDATE
    at `:388`, which is outside the line's exception block, so the whole `tally_recorder_apply` call errors.
  - **Why this is Low:** the add-on writes delete and cancel lines only for saved entries, which have a real GUID and
    an AlterID (`bridge-go/recorder_live.go:806-812`; the placeholder exists only at Form Accept of a new entry).
  - **Fix:** require `alt > 0 and not ph` for "nothing to delete (cancel)". Hold a placeholder delete or cancel as a
    GUID-less one is held.
- **R3-L2. A late create after "nothing to cancel" is 'stale', so the cancelled entry is not listed until its Day Book.**
  - **Where:** `:228, :237`.
  - **What happens:** the stale rule now counts an applied cancel, so a create line from another computer with a lower
    AlterID is 'stale' and its body is dropped. Tally still holds the entry (cancelled). The copy lacks it until a Day
    Book of that day holding it is stored, which then brings it in, cancelled.
  - **Impact:** none on any figure. Round 2's order instead applied the create, then the held cancel.
  - **Fix:** when `del_ev = 'cancelled'`, apply the create and then cancel it (`tally_ingest_delete` with cancel)
    instead of 'stale'. Keep 'stale' for deletes.
- **R3-L3. Two edge cases in the held words.**
  - **(i) A line with no `vch_date`.** It says "once a complete Day Book for its date is uploaded", but no day store can
    reach it: the release finds it by `vch_date`, and the rule needs `vd`. It stays held until an owner's release,
    which gives the same answer. Better words: "no date on the line: ...".
  - **(ii) A day an older file revived.** After the re-delete, the day's live count is one below `n`, so another
    unknown delete of that day is told the Day Book "was not complete (k of n)" when the file was complete, only old.
    What it promises (a complete Day Book, that is a fresh one) still releases it.
  - L7 (the bridge count against the parser count) is unchanged and predates 50.

### Verdict

**Clear to run.**
- No High or Medium remains.
- N1, L8 and L9 are confirmed fixed.
- What the fixes added never deletes an entry Tally holds, and it never fails or measurably slows a day store.
- The three Lows can follow later.
