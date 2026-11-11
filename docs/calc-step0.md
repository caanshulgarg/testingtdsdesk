# Per-entry calc in the cloud: step 0 (finding and measurements)

Branch next-calc-measure, 11-Nov-2026. This step only reads code and measures. Nothing was applied to any database
and nothing was deployed. All the numbers come from one made-up book on a throwaway local PostgreSQL
(`tests/gen_big_book.py`).

The plan being checked: every minute a sweep looks at the days whose `tally_days` stamp moved. For each such day it
finds the entries whose `alter_id` or deleted state differs from a new `calc_seen` table, recomputes their shares
(`gst_share`, `mis_share`, `tds_share`, `ledger_month` from `tally_ledger_day`) and re-sums only the months it touched.

## 1. Finding: does every path that changes the entries move the `tally_days` stamp?

**No.** Only the Day Book path (`tally_ingest_day`) writes `tally_days`. Its row is upserted with `at = now()`
(migration-57-entry-details.sql:387-392), and `tally_books.days_at` is set as well (57:393). No other path that writes
`tally_vouchers` or `tally_lines` touches `tally_days`. That includes the live recorder, which is the most frequent
writer.

There is one marker that does move on every path: **`tally_book_changes`** (migration-64-pages-live.sql:57-97). It is
fed by statement-level AFTER INSERT / UPDATE / DELETE triggers on `tally_vouchers`, `tally_lines`, `tally_ledgers`,
`tally_ledger_day` and `tally_groups`, and it fires whatever function or statement made the write. But it has limits:

- It is per book, not per day.
- It covers neither `tally_bills` nor `tally_days`.
- It swallows its own errors: the trigger raises a warning and keeps no row.
- It records nothing for a book that has been deleted. It upserts by joining `tally_books`, and that row is gone by
  then.

How each path was found: `create or replace function` blocks were followed through every migration to each function's
latest definition, and every write to `tally_vouchers` / `tally_lines` was traced through its callers. Columns:

- **Final def**: the file and line of the function's latest definition.
- **Writes**: the lines that write the entry tables.
- **`tally_days` stamp**: whether that path moves `tally_days`.
- **64 marker**: whether that path moves `tally_book_changes`.

| # | Path (caller) | Final def | Writes | `tally_days` stamp | 64 marker |
|---|---|---|---|---|---|
| 1 | Day Book upload: `tally_ingest_day` (index.ts:3451, 3497) | migration-57-entry-details.sql:325 | marks on the day 370/377, entries through `tally_ingest_entries` (57:382) | **yes**, for `p_day` only (57:387). An entry moved here from another day: the old day is rebuilt (`touched`) but its `tally_days` row is not stamped | yes |
| 1a | Day Book "second empty read" marks the whole day deleted | 57:370 | `update tally_vouchers set deleted_at` | **yes** (same row, 57:387) | yes |
| 2 | Core entry write `tally_ingest_entries` (4 args), reached through the 3- and 5-argument forms | migration-48-day-cache-once.sql:45 (5 args: 57:273) | insert/upsert vouchers 48:70, delete+insert lines 48:90-91, bills | **no** | yes |
| 2a | Its field passes: `tally_ingest_details`, `tally_ingest_gsttype`, `tally_ingest_tdstally` (GST type, nature, RCM, TDS fields) | migration-74-payroll.sql:167 (189), migration-72-gst-type.sql:37 (41), migration-73-tds-fields.sql:59 (63) | `update tally_vouchers` (gst_* and tds_tally columns) | **no** | yes |
| 3 | Live recorder: `tally_recorder_apply` (index.ts:3134) to `tally_recorder_line` | migration-53-recorder-placeholder-settled.sql:514; migration-67-recorder-renumbered.sql:41 | `tally_ingest_entries` 67:286, `tally_ingest_delete` 67:217, 480, 502; ledger-day rebuilt once 53:533, 554 | **no**. It only reads `tally_days` (67:226, 391) | yes |
| 3a | Recorder retries and releases: `tally_recorder_short_retry` (index.ts:3301), `tally_recorder_release_held` (src/js/61-recorder.js:404), `tally_recorder_release_day` | 53:683; migration-54-post-target-bridge.sql:1014; 53:571 | through `tally_recorder_line` / `tally_ingest_delete` | **no** | yes |
| 3b | Held lines settled by triggers (136): after a `tally_days` write, and after a `tally_check_days` day is done | migration-136-held-settle.sql:278 (trigger 317-323), 245 (trigger 312) | through `tally_held_settle_day` to the recorder release | the first runs inside the Day Book's own transaction, so it is covered by #1's stamp. The `tally_check_days` one is **no** | yes |
| 4 | Soft delete or cancel: `tally_ingest_delete` | 57:401 | `update tally_vouchers set deleted_at / cancelled` 57:436; ledger-day rebuilt 57:444 | **no** | yes |
| 5 | Fast delete by heads (migration 158): `tally_held_delete_by_heads` (index.ts:2198) | migration-158-held-delete-fast.sql:51 | through `tally_ingest_delete` 158:87 | **no** | yes |
| 6 | Day check, deletion pass: `tally_check_heads` (index.ts:2203) | migration-133-fetch-check.sql:193 | through `tally_ingest_delete` 133:214 | **no** | yes |
| 7 | Day check, missing entries fetched: `tally_check_entries` (index.ts:2313) | 133:245 | through `tally_ingest_entries` 133:267 | **no** | yes |
| 8 | Re-sync and full re-read: Day Book days as #1, plus the period pull `tally_period_entries_logged` / `tally_period_entries` (index.ts:2252-2253) | 133:309 to migration-98-period-pull.sql:353 | through `tally_ingest_entries` 98:389 | Day Book days **yes**; the period pull **no** | yes |
| 9 | Ledger rename: `tally_ledger_rename` (index.ts:1630), `tally_ledger_rename_from_tally` (index.ts:2578), to `tally_ledger_carry` | migration-41-day-counts.sql:114 (147, 183); migration-89-ledger-fetch.sql:174; migration-36-ledger-rename.sql:229 | `update tally_lines set ledger` 36:232, `update tally_vouchers set party` 36:236. **The `alter_id` does not change** | **no** | yes |
| 10 | Ledger list: `tally_ingest_ledgers_list` (index.ts:3608) | migration-131-ledger-drop-guard.sql:248 | no entry is written: it refuses rather than remove entries (131:259). It does change ledger parents and groups, which feed the GST/MIS classification | n/a (no entry change) | yes (`tally_ledgers`) |
| 11 | Unlink / relink: `tally_company_link` to `tally_link_set` / `tally_link_write`, `tally_link_move_name` (index.ts:4316); a client removed (128) | migration-110-tally-link-record.sql:339, 235 (books.client_id 287), 205 (books.company 227); migration-128-client-removed-frees-tally.sql:97 (68) | none: `book_id` and its entries stay. Only `tally_books.client_id` / `company` change | n/a (no entry change) | no (`tally_books` has no trigger) |
| 12 | Split books (161): `tally_split_link` / `tally_split_unlink` (app/src/lib/splitLink.js:37) | migration-161-split-tally.sql:66 (insert `tally_books` 135), 148 | none: "nothing here reads or changes an entry" (161 header). What changes is the client's set of books and `ends_on` | n/a (no entry change) | no |
| 13 | Company purge | none in the repo: no statement deletes `tally_books` or a firm | a hand-run delete of `tally_books` cascades to `tally_days`, `tally_vouchers`, `tally_lines` (migration.sql:67-103) | the stamp rows go too, so nothing is left to see | the trigger fires, but its upsert joins the deleted `tally_books` row, so no mark |
| 14 | Zoho books on the same tables: `zoho_ingest`, `zoho_mark_gone` | migration-75-zoho-books.sql:492, 527 | through `tally_ingest_entries` 75:502/505; `update tally_vouchers` 513/532 | **no** (only `tally_books.days_at`, 514/534) | yes |
| 15 | Owner repair `tally_recorder_restore_fields` | migration-56-keep-fields.sql:770 (writes 795-817) | `update tally_vouchers` / `tally_lines` fields | **no** | yes |
| 16 | `tally_vouchers_origin` (trigger function and backfill) | migration-37-follow-ups.sql:151 | `origin` column only; no calc input | n/a | yes |

### What this means for the plan

1. **The `tally_days` stamp cannot drive the sweep.** Recorder edits (#3), deletes (#4-#6), period pulls and checks
   (#7-#8) and renames (#9) would be missed until that day's Day Book happens to be read again. That may be never.
2. **An `alter_id` / deleted comparison also misses changes on its own:**
   - Renames (#9) rewrite `tally_lines.ledger` and `tally_vouchers.party` but keep the same `alter_id`.
   - The field passes (#2a) change the GST and TDS columns. They have their own counters (`gst_alter_id`,
     `tds_tally_alter_id`), which `calc_seen` should also hold.
   - Changes to the ledger list or groups (#10), and to FinCom's ledger map (`client_book_items` key `map`), change
     the class of every entry on those ledgers. They need a book-level "recompute" signal, not a per-entry one.
     `tally_calc_version` (152:200) already folds these in.
   - `calc_seen` should also compare cancelled and optional, because a cancelled or optional entry's share is zero.
3. **Link changes (#11, #12) change no entry,** but they change which book a client's month reads (`gst_calc_book`,
   `tally_pick`, the split's `ends_on`). The per-entry shares are per book and stay valid. Only the client-level
   choice of book has to be re-read. The marker for that is `tally_links.version` / `updated_at` and
   `tally_split_links.version`.
4. **Purge (#13):** the new calc tables should reference `tally_books(book_id) on delete cascade`, as every copy table
   does. Then a purge needs no marker.

### Smallest add-only fix (proposed, NOT applied)

A new per-day dirty table, fed by triggers in the same style as migration 64:

```sql
-- migration-1xx-calc-dirty.sql (sketch)
create table if not exists public.tally_calc_dirty (
  book_id uuid not null references public.tally_books(book_id) on delete cascade,
  day date not null, changed_at timestamptz not null default now(), primary key (book_id, day));
create index if not exists tally_calc_dirty_at on public.tally_calc_dirty (changed_at);
-- RLS on, service_role only
create or replace function public.tally_calc_dirty_mark() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  begin
    insert into tally_calc_dirty (book_id, day, changed_at)
    select distinct book_id, day, clock_timestamp() from (
      select book_id, day from new_rows where tg_op <> 'DELETE'
      union all select book_id, day from old_rows where tg_op <> 'INSERT') x
     where exists (select 1 from tally_books b where b.book_id = x.book_id)
    on conflict (book_id, day) do update set changed_at = excluded.changed_at;
  exception when others then raise warning 'tally_calc_dirty_mark: %', sqlerrm;   -- never fails the write (as 64)
  end;
  return null;
end $f$;
-- statement triggers on tally_vouchers, tally_lines and tally_bills: AFTER INSERT (new table as new_rows),
-- AFTER UPDATE (old table as old_rows new table as new_rows: a moved entry dirties both days), AFTER DELETE (old table as old_rows)
```

Plpgsql cannot reference a transition table that the trigger does not declare. So the real migration needs one small
function per operation, or three trigger functions. Either way it is still add-only.

**Why not stamp `tally_days` from the other paths:**

- `tally_days` has 136's settle triggers on insert and update (136:317-323). Any write to it runs the held-line
  settle for those days.
- `tally_days.at` means "a Day Book read vouched for this day", and the recorder decides with it (`d.at > r_at`,
  67:226-227, 391). Moving it from other paths would change recorder and held-line behaviour.

A separate table changes nothing that exists.

**A zero-schema alternative:** sweep the books whose `tally_book_changes.changed_at` moved, then diff the whole book
against `calc_seen`. Measured below at about 50 ms for a 100k-entry book. It inherits 64's gaps: no mark for
`tally_bills`, none for a purged book, and a warning instead of a row if the trigger itself fails.

Either way, the sweep should also watch three things:

- `tally_ledgers` / `tally_groups` / the `map` items: recompute the affected ledgers' entries, or the whole book.
- `gst_alter_id` / `tds_tally_alter_id` in `calc_seen`.
- Renames: `tally_ledger_carry` changes no `alter_id`. Its lines are marked dirty by the trigger above. Without the
  trigger, treat a change to `tally_ledgers` as "recompute the book".

## 2. The made-up book (`tests/gen_big_book.py`)

```
python3 tests/gen_big_book.py --entries 100000      # BIGBOOK_PORT (default 31900); --keep leaves the database and files
```

**The data.** One book, company "Demo Traders". Every party is invented ("Demo Customer nnnn", "Demo Supplier nnnn",
"Demo Contractor nnn"). GSTINs and PANs are invented, and the GSTINs carry a valid mod-36 check character. The book
runs from 1-Apr-2024 to 31-Oct-2026.

| | Count |
|---|---|
| Entries | 100,000 |
| Lines | 298,436 |
| Bill rows | 74,970 |
| Ledgers | 2,928 |
| Days held | 944 |

Entries by type:

| Type | Entries |
|---|---|
| Sales (B2B intra- and inter-state, B2C, 1,478 exports under LUT) | 35,821 |
| Receipt | 16,700 |
| Purchase (1,584 of them reverse charge: legal fees, GTA freight) | 16,504 |
| Payment | 15,939 |
| Journal (TDS 194C/194J/194I expense journals and plain journals) | 9,995 |
| Credit Note | 2,037 |
| Contra | 1,987 |
| Debit Note | 1,017 |

As the copy keeps them: 522 deleted, 260 cancelled and 111 optional.

**How it is loaded:**

1. The book is written as COPY files in a temporary folder.
2. A throwaway PostgreSQL 16 is started with `tests/pg_stand.py`.
3. The copy's columns and indexes are made as the repo's migrations make them (each with its migration noted in the
   script).
4. Migrations 64, 151, 152, 153, 159, 162 and 163 are applied, in order.
5. The COPY files are loaded.
6. The script measures, then stops the database and removes the database folder and the COPY files.

Disk was checked before and after: 5,358 MB free on / both times. Peak use was about 0.6 GB.

**Scope.** The owner asked for one book of 100k entries only, so no 40k, 400k or 4M book was generated or measured.

## 3. Measurements (100k entries, local PostgreSQL 16)

Conditions: shared_buffers at the default, fsync off, warm cache, a shared machine. Each figure is the median of 3
runs, each run in its own session. Supabase will differ in absolute terms, so read these as relative sizes.

### Storage per entry today

| Table | Table bytes | Index bytes | Total | Bytes per entry |
|---|---:|---:|---:|---:|
| tally_lines (3 lines per entry) | 45.7 MB | 26.6 MB | 72.2 MB | 722 |
| tally_vouchers | 25.8 MB | 10.9 MB | 36.7 MB | 367 |
| tally_bills | 13.7 MB | 16.6 MB | 30.2 MB | 302 |
| tally_ledger_day | 12.6 MB | 6.9 MB | 19.6 MB | 196 |
| tally_ledgers | 0.6 MB | 0.2 MB | 0.8 MB | 8 |
| tally_days | 0.1 MB | 0.1 MB | 0.2 MB | 2 |
| **All** | **98.5 MB** | **61.2 MB** | **159.7 MB** | **about 1,600** |

Not counted: `tally_voucher_versions` (one row per `alter_id`, with the entry and its lines as JSON) is not in the
stand. Estimated from this book: about 850 B of entry JSON plus about 170 B of lines JSON per version, before TOAST
compression. Production therefore holds about 1 KB or more per entry per version on top of the table above.

### The cloud GST month path (gst-run)

| Call | Median | Range | Answer |
|---|---:|---|---|
| `gst_calc_rows(book)` | **4,824 ms** | 4,228-4,961 ms | 39.4 MB of JSON |
| `gst_calc_version(book, client)` | 108 ms | | |
| `tally_calc_version(book)` | 160 ms | | |

`gst_calc_rows` reads the whole book for every month gst-run works out. gst-run then parses those 39.4 MB and runs the
3B engine in Deno. That part was not measured here; migration 162's note puts it at about 2 s of CPU for 40k entries.

### MIS SQL: `tally_calc_mis` (152, with 163's cash), ms

| Part | FY 2025-26 | Oct 2026 | Whole span (31 months) |
|---|---:|---:|---:|
| sales | 1,281 | 1,371 | 1,582 |
| purchases | 665 | 256 | 1,248 |
| pl | 183 | 86 | 327 |
| prev | 455 | 216 | 4 (no earlier books) |
| ly | 643 | 224 | 3 (no earlier books) |
| tops | 300 | 321 | 306 |
| cash | 865 | 253 | 1,126 |
| comp | 685 | 197 | 1,538 |
| msme | 3 | 3 | 3 |
| control | 2 | 2 | 2 |

- msme and control return almost nothing here: the made-up book has no MSME marks, and the control is none on the
  cloud copy.
- `tally_calc_led(book)` alone takes 71 ms.
- `tally_calc_bal(book, 31-Mar-2026)`, the balance sheet's balances, takes 95 ms.

### Sketches of the planned sweep (temporary tables in the stand, dropped after)

| Sketch | Result |
|---|---|
| `calc_seen` (book, guid, alter_id, gone, ledger_month) | 20.3 MB, 203 B per entry |
| A per-entry share table (three small numeric arrays plus a month index) | 35.8 MB, 358 B per entry |
| Whole-book diff against `calc_seen` (50 entries changed) | 51 ms (all 50 found) |
| One-day diff, on the busiest day (137 entries) | 4.0 ms |
| Re-sum of one month from the share table | 1.2 ms |
| Re-sum of all 31 months from the share table | 9.9 ms |

### What the numbers say

- **Whole-book recomputes are expensive.** Today a 100k book costs about 4.8 s of SQL plus a 39 MB transfer for every
  cloud GST month, and 0.2-1.6 s for each MIS part.
- **The incremental path is cheap.** A day or book diff takes 4-51 ms and a month re-sum about 1 ms.
- **The storage cost is modest.** The per-entry share table, the dirty table and `calc_seen` add about 560 B per
  entry, roughly 35% on top of today's 1.6 KB per entry.
