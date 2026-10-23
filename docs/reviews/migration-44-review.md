# Database and security review: migration 44 (the Tally change recorder)

Reviewed: 04-Oct-2026, read-only. Scope: `server/tally-cloud/migration-44-recorder.sql` (847 lines) and the tally-ingest
kinds `recorder_lines`, `start_point` and the beat's gap answer (`git diff HEAD~1 -- server/tally-cloud/index.ts`).
Nothing was run against a real database; every check below ran on the throwaway PostgreSQL of `tests/pg_stand.py`.
No code was changed.

## Tests run

| Test | Result |
|---|---|
| `python3 tests/run_migration44.py` (staging order 32 to 43, then 44 twice, then a third time over used tables; run_migration43's checks again with 44 applied) | all passed (135 ok) |
| `python3 tests/run_migration_order.py` | all passed (both orders end with the same 38 function texts) |
| `python3 tests/run_migration43.py` | all passed |
| `DENO=/opt/deno/deno python3 tests/run_recorder_server.py` | all passed |
| Throwaway review checks (a copy of run_migration44's setup in the scratchpad, port 55461, with and without Supabase's default privileges simulated: `alter default privileges in schema public grant all on functions/tables to anon, authenticated, service_role` before the migrations) | results quoted in the findings |

## Checklist

| # | Check | Result |
|---|---|---|
| 1a | No DROP of a table, column, function, policy, trigger or index | pass (grep: none) |
| 1b | No DELETE of data | pass: the only `delete from` are 43's own (an entry's lines and bills replaced on a re-send, line 304-305, the old ones kept on the version row; the ledger-day cache rebuild, line 229). Soft deletes only (`deleted_at`, `unlocked_at`) |
| 1c | No hard delete anywhere in the index.ts diff | pass (no `.delete(`, no `delete from`) |
| 1d | CREATE OR REPLACE with the same arguments as staging (43) | pass: `tally_ingest_day` (8 arguments), `tally_voucher_version_lines(uuid, text[])`, `tally_device_post_settings(uuid, jsonb, integer, integer)` keep their signatures and return types; every other function is new; the ten `ALTER FUNCTION ... SET search_path` name signatures present after 43 (run_migration_order and run_migration44 in staging order) |
| 1e | Safe to run twice | pass: run twice, then a third time over used tables; row counts of nine tables unchanged by the runs |
| 2a | RLS on every new table | pass: `tally_recorder_lines`, `tally_month_locks`, `tally_tieouts` (line 196-198) |
| 2b | Policies read-only for the firm (`firm_id = my_firm()`) | pass (line 199-209); another firm reads 0 rows (tested) |
| 2c | No insert / update / delete policy or grant for authenticated | pass: none created; `revoke insert, update, delete, truncate ... from anon, authenticated` (line 211); a direct write is "permission denied" (tested) |
| 3a | Every security definer function has `set search_path = public, pg_temp` | pass: all 14 definer functions; `tally_working_hours` (not definer) too; run_migration44 checks all 73 functions of 32-44 |
| 3b | Owner check for month lock / unlock, release_held, the tie-out tick | pass: same text as migration 35's `tally_read_stop` (members.role = 'owner', active, the caller's firm). Staff lock, staff tick and another firm's release are refused (tested) |
| 3c | The firm of every row touched | pass: lock/unlock filter `firm_id = my_firm()`; release reads `id = p_line and firm_id = f`; tie-out checks `clients.firm_id = f`, `tally_pick` uses `my_firm()`; `tally_recorder_silent` requires `p_firm = my_firm()`; `tally_recorder_apply` checks book and device belong to `p_firm` |
| 3d | Service-role functions revoked from public, anon, authenticated | pass, also under Supabase's default privileges (tested): `tally_ingest_entries`, `tally_ingest_delete`, `tally_ingest_day`, `tally_voucher_version_lines`, `tally_recorder_apply`, `tally_start_point`, `tally_recorder_gap_check`, and the internal `tally_recorder_line`, `tally_ledger_day_rebuild`, `tally_month_locked` are not executable by authenticated or anon. Only `tally_working_hours` (a pure, non-definer helper) stays executable by authenticated under the defaults (L6) |
| 4 | `fincom.recorder_release` cannot open the service functions to a member | pass, see below |
| 5 | `tally_ingest_day` vs 43 on real day files (parse.js output) | pass: no behaviour change for parse.js output, see below |
| 6 | The gap check never reads or writes entries, never lowers `recorder_max_alter` | pass: it reads `tally_sync_cursor`, `tally_days.alter_max`, `tally_recorder_lines`; writes only `tally_sync_cursor` (start point, gap, `needs_baseline`); never names `recorder_max_alter` in a write. But see M2 |
| 7a | index.ts input bounds for `recorder_lines` | mostly pass: 500 lines a call (SQL: 1000), XML 2 MB a line inside the 25 MB request cap, strings cut (80 / 60 / 100 / 300), ledgers 50, known events only, numbers range-checked. Gaps: L1 (the body keeps every voucher of the XML), L8 (no rate limit), L9 (start_point numbers unbounded) |
| 7b | A device writes lines only for its own firm's linked companies | pass: firm from the device key; `bookFor(firm, company)` (409 when not linked); `tally_recorder_apply` re-checks `tally_books.firm_id = p_firm` and `tally_devices.firm_id = p_firm`. The company GUID is not compared (M4) |
| 8a | A later Tally change to a locked month is held, never dropped | recorder path: pass (held with "month locked: YYYY-MM", body kept). Day path: refused and stored nothing, but reported to the bridge as done and only kept as the stored file (M3). A held line can lose its body to a duplicate (M1) |
| 8b | Release applies it once | pass: released after unlock -> applied; a second release is refused ("line N is applied, not held"); a release while still locked stays held (but is stamped released, L3) |

### Item 4 in detail: the `fincom.recorder_release` setting

`tally_ingest_entries` (line 264), `tally_ingest_delete` (line 407) and `tally_voucher_version_lines` (line 245) let a
caller through when `auth.role() = 'service_role'` OR the transaction-local setting `fincom.recorder_release` is a
number. The setting is set only by `tally_recorder_release_held` (line 644) and cleared after the one line (line 647).

- A signed-in member cannot reach these functions at all: EXECUTE is revoked from public, anon and authenticated (line
  323, 439, 654), also when Supabase's default privileges are simulated. Throwaway check, as the owner:
  `select set_config('fincom.recorder_release', '1', true); select tally_ingest_entries(...)` gives "permission denied
  for function tally_ingest_entries"; the same for `tally_voucher_version_lines`, `tally_ingest_delete`,
  `tally_recorder_line`, `tally_ledger_day_rebuild`, `tally_recorder_apply`, `tally_start_point`,
  `tally_recorder_gap_check`, `tally_month_locked`. No entry row was written.
- PostgREST gives a client no way to set an arbitrary GUC (it sets only `request.*` / `role`), and `pg_catalog.set_config`
  is not in an exposed schema. Every other `set_config` in the repository's SQL is the fixed name `fincom.ledger_list` or
  the security check script; no function granted to authenticated runs dynamic SQL with caller input (grep).
- So the only member path that writes entries is `tally_recorder_release_held`: an owner, a line of the owner's firm in
  state `held`, re-applied from the body the device sent. Staff and other firms are refused (tested).
- Pre-existing, noted only: `auth.role() <> 'service_role'` is NULL when there are no JWT claims (a direct database
  connection), and `NULL and ...` does not raise. That is the same pattern as 32-43 and only reachable by roles that are
  already privileged.

### Item 5 in detail: tally_ingest_day 44 vs 43

Compared line by line with migration-43-posting-reply.sql:56-140.

- Marking before the upsert: the marked set is `v.day = p_day and not (v.guid = any(sent))`, the upsert's set is
  `guid = any(sent)`: disjoint. `live_n` is read only when the file has no entries, and then the upsert writes nothing,
  so counting it before (44) or after (43) gives the same number. The cache is rebuilt after both (inside
  `tally_ingest_entries`, or line 385 when it touched nothing). Same result.
- A line whose GUID is not among the vouchers: 43 stored it under the day (and never deleted it on a re-send, so it
  doubled); 44 drops it (line 306-309). parse.js cannot produce one: `takeVoucher` puts the voucher's own id on each of
  its lines, `parseDay` skips a voucher without a GUID together with its lines and, for a GUID met twice, keeps one
  voucher and only its lines (parse.js:126-138). No real day file is affected.
- A voucher with an empty GUID: 43 inserted `guid = null` and failed the whole day on the primary key; 44 skips it. parse.js
  never sends one.
- Bills: 43 dated them `p_day`, 44 `v.day`, which is `p_day` on this path (line 384 sets every voucher's day).
- The date check of `tally_ingest_entries` cannot fire on the day path (every voucher gets `p_day`).
- New in 44, intended: a day in a locked month (or an entry moving out of one) stores nothing (line 341-345).

## Findings

### Medium

**M1. A held line without a body swallows the same change sent with a body.**
`tally_recorder_line`, line 480-484: the duplicate check counts an earlier arrival in state `held`, whatever it was held
for. Line 553-555 then nulls the body of the `duplicate`. Throwaway check: line b1 (`altered`, j1, AlterID 7, no XML) is
held "no entry body on the line"; line b2 (the same change from the second PC, with the XML) is `duplicate` "the same
change already came as line 1 (held, from NWS144)", its body dropped; the owner's release of b1 stays held; j1 stays at
AlterID 5. The change is then applied only by a later day read, and reading is prospective.
Fix (SQL, line 482): count a held arrival only when it can be applied, e.g.
`and (r.state = 'applied' or (r.state = 'held' and r.body ? 'vouchers'))` (deleted / cancelled lines carry no body; for
them keep `r.state = 'applied'` plus the `held_why like 'month locked%'` case if two held deletes should not stack).
Test (run_migration44): a held no-body line, then the same change with a body from D2 -> `applied`, j1 at AlterID 7, one
applied row for the key; and the reverse order -> the second `duplicate`.

**M2. A beat that says ALTVCHID 0 sets a starting point of 0, or marks the book needs_baseline.**
index.ts:214 (`altOf`) accepts 0; `tally_recorder_gap_check` line 745-748 takes the first number it sees as the starting
point, and line 750-755 marks `needs_baseline` ("stays so until a person clears it") for any number below it. The bridge
sends `toI64` of the digits of ALTVCHID (bridge-go/safety.go:153), so an empty or unread value becomes 0. Round 4 of the
bridge made the same rule for `read_guard` ("an AlterID not known, 0 or less, goes as null, never as 0: 0 would read as a
rewind on the cloud", safety.go:501). Throwaway check: with no starting point, `tally_recorder_gap_check(book, D1, 0,
now())` recorded `startVoucher 0`; the first real beat then reports "up to N changes not received" for the whole book's
history. With a starting point, 0 marks the book needs_baseline (line 750).
Fix: in `altOf` treat 0 as unknown (`Number(v) <= 0 ? null`), and in SQL at line 740 return `{ok, gap: null, unknown:
true}` for `p_altvchid <= 0` without touching the cursor. Test: run_recorder_server sends a beat with `altvchid: 0` ->
no RPC, no gap, state unchanged; run_migration44 calls the check with 0 after a starting point -> state `ok`.

**M3. The day path's month-lock refusal is reported to the bridge as done and leaves no held record.**
SQL line 341-345 refuses with `ok: true, locked: true`; index.ts:805-811 (and the re-read at 849) logs it as
"refused ...: nothing marked deleted" and pushes the day into `done`. The change is not lost (the file was uploaded to
`tally-days` first, line 795, and a re-read of kept files after the unlock applies it through the same function), but
nothing tells the owner that a later Tally change waits for that month, `tally_recorder_release_held` cannot see it, and
the log wording is wrong. The recorder path does this right (a `held` row with the words).
Fix (index.ts only): when `dayAns.locked`, push `{day, locked: true, why: dayAns.refused}` into a `locked` list returned
with the answer and logged as "day of a locked month kept, not applied"; optionally write a `tally_recorder_lines` row
(event `day_read`, state `held`) so the app's held list shows it, and after `tally_month_unlock` offer the month's re-read.
Test: run_recorder_server: lock 2026-05 on the stand, send `days` for 20260502 -> the answer lists it under `locked`, not
`done`; after unlock the re-read applies it once.

**M4. The company GUID on a recorder line, and on the beat, is never compared with the book's.**
`tally_recorder_line` stores `company_guid` (line 467) but neither it nor `tally_recorder_apply` compares it with
`tally_sync_cursor.company_guid`; the beat's companies carry no GUID into `recorderGaps` (index.ts:218-231). A Tally
company with the same name but another GUID on any of the firm's PCs (a restored copy, a trial company, the ZZ TEST kind)
writes its entries into the linked client's book, and its ALTVCHID drives the gap and needs_baseline of that book. The days
path has the same posture at the cloud (the bridge runs `read_guard` first); the recorder runs on every PC with the
add-on, so it is likelier here. A book already in `needs_baseline` is also still written by recorder lines.
Fix (SQL, `tally_recorder_apply` after line 567): read the cursor once; when its `company_guid` is set and a line's
`company_guid` is non-empty and different, store the line `held` "another company GUID (x, the book's is y)" without
applying it. Carry the company GUID in the beat and skip the gap check when it differs. Test: a line with
`company_guid: 'other'` on a book whose cursor holds 'cg-1' -> held, no entry written.

### Low

- **L1. The stored body keeps every voucher of the add-on's XML** (index.ts:727-728, SQL line 462-464; only `payload` is
  cut to 8000). Throwaway check: one line with 3000 other vouchers stored a 1.35 MB body (none of them applied: the apply
  filters to `object_guid`). Every arrival is a row, so a noisy add-on grows the table fast. Fix: in `cleanRecorderLine`
  keep only the voucher whose guid is `object_guid` and its lines; in SQL build `bd` from that voucher too; optionally null
  `body` once a line is `applied`. Test: the 3000-voucher line stores one voucher.
- **L2. `recorder_max_alter` takes any number a line carries** (line 580-585), including a held, failed or stale line, and is
  never lowered. Throwaway check: one held line with AlterID 999999999999 set it for good, so no gap is reported again. Fix:
  take the maximum over lines that ended `applied`, `duplicate` or `stale`, or never above the latest ALTVCHID the beat
  said plus a margin. Test: a held line with a huge AlterID leaves `recorder_max_alter` unchanged.
- **L3. A release refused because the month is still locked is stamped released** (line 648 runs whatever the state).
  Throwaway check: state `held`, `released_at` set. Fix: stamp only when `one->>'state' <> 'held'`, or refuse before
  applying when `tally_month_locked` holds. Test: release while locked -> `released_at` null.
- **L4. `ledger_deleted` lines can be released**, though the header says "a ledger line is the ledger list's" (line 640 lists
  only created / altered / renamed). The release goes through the guard of 34/36 and is harmless; make the header and code
  agree (either add `ledger_deleted` to line 640 or reword line 69-70).
- **L5. Staff can overwrite FinCom's figures on a ticked month** (`tally_tieout_save`, line 677 and 681: `changed` looks at
  the typed figures only, so `p_fincom` with empty figures passes and keeps the tick). Fix: `changed := fig <> '{}' or
  p_fincom is not null`. Test: staff with only `p_fincom` on a ticked month -> refused.
- **L6. `tally_working_hours` stays executable by authenticated on Supabase** (line 805 revokes from public and anon only;
  Supabase's default privileges grant authenticated directly). It is a pure function over its arguments, not a definer, so
  harmless; add `authenticated` to the revoke for consistency with the header ("internal ones granted to nobody").
- **L7. The final state update sits outside the line's savepoint** (line 553). Today no path makes it violate the partial
  unique index (the duplicate check runs first under the book's lock), but if one ever did, the whole batch of up to 500
  lines would fail and the bridge would resend it for ever. Fix: on a unique violation there, store `duplicate`.
- **L8. No rate limit on `recorder_lines` or `start_point`** (index.ts:1516-1520), unlike `ledger_list`'s 60 a minute. Each
  call can add 500 rows. Fix: the same per-device limiter.
- **L9. `start_point` numbers have no upper bound** (index.ts:756): `altvchid: 1e30` reaches the bigint argument and becomes a
  500. Use `altOf` (below 1e15) there too.
- **L10. `notReady44` matches any "does not exist"** (index.ts:708), so a missing column or a renamed function inside the
  apply is answered 503 notReady instead of an error. Narrow it to the function names.
- **L11. Lines past 500 are dropped without a result** (index.ts:735). The bridge marks a line sent only on its result, so it
  will resend them, which is fine; say it in the answer (`more: true`).
- **L12. A restore to a point between the starting point and `recorder_max_alter` reads as "matched"** (line 750 and 757-770):
  only a number below the starting point is called a rewind. Consider reporting `p_altvchid < recorder_max_alter` as
  "behind the lines" in the gap answer (not needs_baseline).
- **L13. A month lock covers the client's books that exist when it is made** (line 605); a book added later for the same client
  is not locked for that month. Note it in the app, or check by client in `tally_month_locked`.
- **L14. The gap answer's time comes from the device** (`p_at`, index.ts:225), so `last_match_at` can be set to the future by
  a bad clock. Clamp to now().

## Fix before staging

The migration is safe to run on staging as it stands in the database sense: add-only, run twice cleanly, RLS on the three
new tables with read-only firm policies, every function's search_path fixed, the service functions closed to members (the
release setting cannot open them), 43's day rules unchanged for real day files. These are worth fixing before it runs, as
they are cheap and change stored state that is awkward to repair later:

1. **M1** (SQL, line 482): a held line with no body must not make a later arrival with a body `duplicate`. Test as above.
2. **M2** (SQL line 740 and index.ts:214): ALTVCHID 0 / unknown is never a starting point and never a rewind. Test as above.
3. **M3** (index.ts:805-811, 849): a locked day is answered `locked`, not `done`, and logged as such. Test as above.
4. **L1** (index.ts:727-728): store only the line's own voucher and lines in `body`. Test as above.
5. **L3** (line 648): no `released_at` on a release that stayed held. Test as above.

Before the recorder is turned on for real books (not blocking staging): M4 (the company GUID on lines and the beat), L2,
L5, L8, L9.

## Fixed

04-Oct-2026, test-first (each new check run red before the change, then green; red and green output kept in the session
scratchpad as `tdd/m44fix.<item>.red` / `.green`). The migration stays add-only and safe to run twice (run_migration44
runs it twice, a third time over used tables, and once more in R-L6); every security definer function keeps `set
search_path = public, pg_temp`; RLS and policies untouched; the '%' RAISE fix kept. New checks are named `R-<item>.` in
`tests/run_migration44.py` (section "R. the database review's fixes") and `tests/run_recorder_server.py` (the end).

| Item | Change | Tests |
|---|---|---|
| M1 | `tally_recorder_line`, the duplicate check: an earlier arrival counts only when `applied`, or `held` and a release could apply it: an entry line (created / altered / imported) only when `r.body ? 'vouchers'`; a delete / cancel only when held for a locked month; ledger lines as before | run_migration44 `R-M1.` (held without a body, then the same change with its body from D2 -> applied, AlterID 7, body kept, one applied row; the reverse order -> duplicate) |
| M2 | index.ts `altOf`: 0 or less is unknown (null), so the beat carries no altvchid and no gap check runs; `startPoint` uses `altOf` (0 -> 400). SQL: `tally_recorder_gap_check` answers `{ok, gap: null, unknown: true}` for 0 or less without touching the cursor; `tally_start_point` refuses 0 or less | run_migration44 `R-M2.` (0 after a starting point: unknown, state ok, cursor unchanged; 0 with no starting point: none recorded; start point 0 refused); run_recorder_server `R-M2.` (a beat with altvchid 0: no RPC, cursor unchanged; start_point 0: 400, no RPC) |
| M3 | index.ts `ingestDaysRaw` and `reparseMonthRaw`: a day answered `locked: true` by `tally_ingest_day` is not pushed to `done`; it is listed under `locked` [{day, why}] and logged "day of a locked month kept, not applied (held until the owner unlocks it and the day is read again)". It is also put in `bad` with `locked: true` and the words: today's bridge (cloud.go) knows only `done` / `bad` and returns "only N of M days were taken" for a day in neither, so without this it would send the day again on every run. The job step counts it with `bad` as before. No `tally_recorder_lines` row is written for it (the optional part of the review's fix) | run_recorder_server `R-M3.` (lock 2026-07, send 20260702: `done` empty, under `locked` and in `bad` with locked true, nothing stored, the log line; after the unlock the day sent again applies once) |
| L1 | index.ts `cleanRecorderLine`: `vouchers` / `lines` keep only the voucher whose GUID is the line's `object_guid`, and its lines (none when the line has no GUID). SQL `tally_recorder_line` builds `body` the same way (defence for any other caller) | run_migration44 `R-L1.` (a line with two vouchers stores one, with its 2 lines); run_recorder_server `R-L1.` (a 2-voucher XML stores 1 voucher, its own) |
| L3 | `tally_recorder_release_held`: `released_at` / `released_by` stamped only when the release ended `applied` | run_migration44 `R-L3.` (release while locked: still held, released_at not set; after the unlock: applied, released_at set) |
| L2 | `tally_recorder_apply`: `recorder_max_alter` raised per line, only from a line that ended `applied`, `duplicate` or `stale` (never `held` / `failed`); a held line an owner's release applies raises it then | run_migration44 `R-L2.` (a held line with AlterID 999999999999 and a failed one: unchanged), `R-L3.` (held in a locked month: not raised; released and applied: raised to its AlterID) |
| L9 | SQL: a line's AlterID is read only below 10^15 (`^[0-9]{1,15}$`, as `altOf`), otherwise stored as unknown and never the cursor's; `tally_start_point` refuses 10^15 or more; `tally_recorder_gap_check` refuses 10^15 or more. index.ts `startPoint` uses `altOf` (1e30 -> 400, not a 500) | run_migration44 `R-L9.` (AlterID 10^16 stored as unknown; start point 10^15 refused); run_recorder_server `R-L9.` (start_point 1e30 -> 400, no RPC) |
| L4 | `tally_recorder_release_held`: `ledger_deleted` added to the ledger events a release refuses (`ok: false`, stays held), matching the header ("a ledger line is the ledger list's") | run_migration44 `R-L4.` (the held ledger_deleted line L18: not released) |
| L6 | `revoke all on function tally_working_hours(...) from public, anon, authenticated` | run_migration44 `R-L6.` (Supabase's default grant to authenticated simulated, 44 run again: not executable by authenticated; `tally_recorder_silent` still answers) |

Left, not fixed here: M4 (the company GUID on lines and the beat: a change in `tally_recorder_apply`'s flow and the beat's
shape, larger than a local fix; before real books), L5 (tie-out `changed`; not in this round's list), L7, L8 (a rate
limiter), L10 to L14 (low, design notes).

Suites after the fixes: `python3 tests/run_migration44.py` all passed (150 ok, including 0.: run_migration43 with 44
applied, 80 ok); `python3 tests/run_migration_order.py` all checks passed; `python3 tests/run_migration43.py` all passed
(80 ok); `DENO=/opt/deno/deno python3 tests/run_recorder_server.py` all passed (30 ok);
`DENO=/opt/deno/deno python3 tests/run_main_bridge_server.py` all passed (117 ok); `/opt/deno/deno check
server/tally-cloud/index.ts` clean.
