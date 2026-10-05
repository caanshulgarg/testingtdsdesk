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
