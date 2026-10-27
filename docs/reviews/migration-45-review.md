# Database and security review: migration 45 (bulk posting with the recorder loaded)

Reviewed: 04-Oct-2026, read-only. Scope: `server/tally-cloud/migration-45-bulk-posting.sql` (424 lines) and the
tally-ingest changes of commit 566b512 (`git show 566b512 -- server/tally-cloud/index.ts`: `postWindow`, the short line in
`cleanRecorderLine`, `shortBodies` / `withIds`), against docs/recorder-bulk-posting.md sections 3 and 4.
Nothing was run against a real database and no Supabase tool was used; every check below ran on the throwaway PostgreSQL of
`tests/pg_stand.py` (own instances, ports 55471-55473). No repository code was changed.

## Tests run

| Test | Result |
|---|---|
| `python3 tests/run_migration45.py` (staging order 32 to 44, 45 twice, a third time over used tables; run_migration44's checks again with 45 applied) | all passed (56 ok) |
| `python3 tests/run_migration_order.py` (both orders, each twice, ending with 45) | all checks passed (111 ok) |
| `DENO=/opt/deno/deno python3 tests/run_recorder_server.py` | all passed (43 ok) |
| Throwaway review checks A (port 55471): a copy of run_migration45's setup, 45 applied twice, then the scenarios G1-G12 below | results quoted in the findings |
| Throwaway review checks B (port 55472): Supabase's default privileges simulated (`alter default privileges in schema public grant all on functions / tables / sequences to anon, authenticated, service_role` before 32), 44's tables filled (20,000 recorder lines, a month lock, two tie-outs, one with `book_id` null) before 45; the locks 45 holds; then 200,000 `tally_post_ids` / 8,000 jobs / 500 windows for timings | results quoted in the findings |
| The fixes proposed below, applied to a scratch copy of 45 (not to the repository) | the scenarios turn from under-count to the right gap; `M45_FILE=<copy> python3 tests/run_migration45.py` still all passed (56 ok) |

## Checklist

| # | Check | Result |
|---|---|---|
| 1a | Add-only: no DROP of a table, column, function, policy, trigger or index; no DELETE | pass. The only DDL drop is the foreign-key swap (line 89-100), see 1b |
| 1b | Only 38's RESTRICT swap may drop | **owner to confirm**: 45 makes a second swap of 38's kind (tally_recorder_lines, tally_month_locks: CASCADE -> RESTRICT; tally_tieouts: SET NULL -> RESTRICT). It only tightens (nothing can be deleted through it) and the header says the owner asked for it on 04-Oct, but the rule as written names 38's swap alone (L9) |
| 1c | The swap with rows, in one transaction | pass: 45 over 20,000 recorder lines, a month lock and two tie-outs (one `book_id` null): every row kept, the four constraints `ON DELETE RESTRICT` and validated, a second run changes nothing. The whole file is one `begin; ... commit;`, so a failed `add constraint` rolls the drop back. Lock levels: see L2 |
| 1d | Safe to run twice, and over a used database | pass (run_migration45: twice, a third time over used tables; review B: over filled 44 tables, then again) |
| 1e | Runs after 44 in both orders | pass (run_migration_order, both orders end with the same function texts) |
| 2a | RLS on every new table, read-only firm policy | pass: `tally_post_windows` RLS on, `tally_post_windows_read` select `to authenticated using (firm_id = my_firm())`, insert / update / delete / truncate revoked; another firm reads 0 rows, a direct write is refused (run_migration45 S.); anon reads 0 rows under the simulated defaults |
| 2b | Columns added to existing tables | `tally_post_ids.matched_guid / matched_mid / matched_alter`, `tally_sync_cursor.match_alter / match_start`: both tables already have RLS with read-only firm policies |
| 3a | Every security definer function has `search_path = public, pg_temp` | pass: `tally_post_window_save`, `tally_post_live_for`, `tally_post_xml_for`, `tally_recorder_line`, `tally_recorder_gap_check` |
| 3b | Service-role functions not executable by anon / authenticated, also under Supabase's default privileges | pass (review B): `tally_post_window_save`, `tally_post_xml_for`, `tally_recorder_gap_check`: anon f, authenticated f, service_role t; `tally_post_live_for`, `tally_recorder_line`: f for all three. CREATE OR REPLACE of 44's functions keeps 44's revokes |
| 3c | `tally_post_xml_for` exposure | pass: service role only; the book must be the firm's (line 169), every id goes through `tally_post_live_for` (the firm's live accepted posting of a job whose company is this book's), and `pv` reads only that firm's jobs. Another firm's ids, another book's postings of the same firm, an unaccepted posting: nothing returned (run_migration45 4., review G12). tally-ingest takes the firm from the device key and the book from `bookFor` |
| 3d | Short-line matching across firms / books | pass for firms and books: `tally_post_live_for` filters `p.firm_id = j.firm_id = p_firm` and the job's company = the book's; a fid of another firm or of another book of the same firm is held "matches no posting of this firm" (G12). A fid already matched to another GUID is held. But see H2, M5, M6 for what a matching fid can do inside the right book |
| 3e | Window ownership | pass for firm and device: the job must be this firm's and this computer's (line 123-125), the book is the firm's book of the job's company. Bounds and replays: M3 |
| 4 | Realtime publication | pass: `tally_recorder_lines` added once (twice run), skipped when the publication is absent or FOR ALL TABLES. The table has RLS with a firm read policy (44), so Supabase Realtime's Postgres Changes delivers INSERT / UPDATE rows only to subscribers whose policy passes (other firms receive nothing; anon nothing). Load: L5 |
| 5 | The gap check never under-counts | **fail**: H1, M1, M2, L1 (scenarios below) |
| 6 | Performance | gap check 0.27-0.33 s with 500 windows / 200,000 ids / 8,000 jobs (L3); **`tally_post_xml_for` with 500 unknown ids: 167 s** (M4) |

## Scenarios run (review checks A)

Each starts a fresh book with the starting point 1000 (`tally_recorder_gap_check(book, D1, 1000, now())`). "Person" is a full
recorder line applied for a voucher a person saved (no FinCom id). Right answer = the changes really not received.

| # | Case | 45 answers | Right | Fixed copy answers |
|---|---|---|---|---|
| G1 | 100 posted, no window (2.1.x bridge), accepted after the start; a person's line received at AlterID 1101; beat 1105 | matched, accounted 100; the next beat at 1105 matched again, `match_alter` 1105; at 1106 "up to 1" | up to 4 | up to 4, and up to 5 at 1106 |
| G2 | 100 posted, no window; beat 1100 whose time (the PC's clock) is 2 minutes behind; then beat 1103 | 1100 matched; 1103 matched again (the 100 subtracted a second time) | up to 3 | up to 3 |
| G2b | the same with correct clocks: the beat reads 1100 at T, the last batch's posts_update reaches the cloud at T+0.5 s, the check runs at T+1 s; then 1103 | 1103 matched (accounted 50: that batch counted twice) | up to 3 | up to 3 |
| G3 | window 1000..1103 with 100 created (3 changes by a person during the posting), one of them received as a line at 1050; beat 1103 | matched, accounted 53; the words "during the posting" are lost | up to 2-3 | up to 3, "up to 3 changes not received during the posting of ..." |
| G4 | window 5000..5100 (another company's numbers, or before a restore); 100 person changes, beat 1100 | matched, accounted 100 | up to 100 | up to 100 |
| G5 | a job creating 5 ledgers, window 1000..1005 created 0 + 5 masters (`full: true`); beat 1005 | matched | up to 5 (the ledgers do not raise ALTVCHID, or 5 voucher changes took those numbers) | up to 5, "of which up to 5 may be FinCom's own new ledgers" |
| G6 | one posted entry, read by a day read and later deleted in the copy (`deleted_at`); deletion received (1002); beat 1003 | matched (the posting counted again) | up to 1 | up to 1 |
| G7 | a 100-entry job saves a window 1000..5000 "created 1,000,000"; beat 5000 | saved; matched, accounted 4,000; re-saving the done job, and saving a cancelled job, both accepted | up to 3,900 | refused ("more created than the posting held"); up to 3,900; re-save of a finished job with other numbers refused |
| G10 | a FinCom entry matched (short line, AlterID 2001, amount 100); a person alters it in Tally to 150, the add-on writes a short `altered` line (2002) and tally-ingest builds its body from the posting | `applied` "FinCom posting A1 matched"; the copy: AlterID 2002, amount 100 | the copy must not claim AlterID 2002 with the posted amounts | held "matched; no entry body", the copy stays at 2001 |
| G11 | a person duplicates FinCom's voucher (Tally copies the narration, "TDSDesk:B1"); its short line arrives before FinCom's own | the duplicate (GUID g-dup) is matched to posting B1 and built from B1's XML; FinCom's own line later held "matched to another Tally entry" | B1 matched to FinCom's own entry | unchanged (M5: needs the add-on's event or more fields) |
| G12 | a fid of another book's posting (same firm); `tally_post_xml_for` for it | held "matches no posting of this firm"; no XML | as 45 | as 45 |

The scenario scripts are in the session scratchpad (`r45/checks.py`, `r45/checks2.py`, built into copies of
run_migration45's setup); the fixed copy of the migration is `r45/m45-fixed.sql` with `r45/m45-fixes.diff`.

## Findings

### High

**H1. The fallback subtracts postings whose changes are already under the baseline, and subtracts the same posting at
two checks; the match then makes it permanent.**
Line 391-395 (the fallback, every job without a window, so every bridge before 2.2.0, i.e. every bridge today):
- it counts every accepted, unmatched posting since `since_ = coalesce(last_match_at, start_at)` without asking whether
  its changes lie above the baseline. The baseline rises with every received recorder line (`recorder_max_alter`) and
  every day read (`alter_max`) while no check matches, so a posting made before a person's received line is inside the
  baseline already and is subtracted again (G1: 4 real misses hidden by 100 posted entries);
- `last_match_at` is `p_at`, the PC's clock (index.ts:237 passes the beat's `at`; 44's L14). A PC behind the server,
  or simply a posting batch whose posts_update reaches the cloud after the PC read ALTVCHID but before the check ran
  (G2b, correct clocks), is accepted after the recorded match time though its changes were in the matched number; the
  next check subtracts it a second time;
- line 418 then sets `match_alter = p_altvchid`, so the hidden changes are under the baseline for good (G1: at 1106 only
  "up to 1"). In 44 a wrong match was forgotten at the next beat; in 45 it is not.
Up to the size of a bulk posting (2,000) of a person's changes can be hidden, on staging, as soon as 45 runs.
Fix (SQL, gap check; tested on the scratch copy):
```sql
alter table public.tally_sync_cursor add column if not exists match_at timestamptz;   -- the server's time of the last match
-- before the fallback:
since_fb := greatest(coalesce(case when c.match_start is not distinct from c.start_at then coalesce(c.match_at, c.last_match_at) end, c.start_at),
  (select max(r.received_at) from tally_recorder_lines r where r.book_id = p_book and r.alter_id is not null and r.state in ('applied', 'duplicate', 'stale')),
  (select max(d.at) from tally_days d where d.book_id = p_book and d.alter_max >= base and base > 0));
-- the fallback and its masters count use p.accepted_at > since_fb; the match sets match_at = now() (last_match_at stays the beat's time for the app)
```
Every bound moves `since_fb` later, so an error can only leave a posting out (a false alarm the words explain), never
subtract one twice. Test (run_migration45, item 3): G1 (up to 4, `match_alter` not set), G2 (device time 2 minutes
behind: up to 3), G2b (the batch accepted between the read and the check: up to 3); 45's own "the same without a window:
no gap" still passes (it did on the copy).

**H2. A short `altered` line rebuilds the entry from FinCom's original posted XML.**
index.ts:805 builds a body from the posting for `created`, `altered` and `imported`; the SQL (line 248-262) accepts it.
The design (section 2) has the add-on write a short line for every entry whose narration carries "TDSDesk:", so a
person's change to a posted bill (amount, ledger, date) comes back as a short `altered` line with the new AlterID, and
the copy stores the posting's old content under that AlterID, with the line `applied` (G10: AlterID 2002, amount 100).
`recorder_max_alter` takes 2002, so no gap is shown, and the version row for 2002 keeps the wrong content. The copy and
its trial balance stay wrong until that day happens to be read again. No add-on writes short lines yet, but this is the
migration and tally-ingest that will apply them.
Fix: index.ts:805 builds from the posting only for `created` / `imported`. SQL defence in `tally_recorder_line`, before
the short-line match:
`if is_short and (ev = 'altered' or c_found) then vs := '[]'::jsonb; end if;` (a short line for a GUID the copy holds
stamps the match and is held "no entry body: the next day read applies it"). TDL: write the short line only for import
events, never on a screen save. Test (run_migration45 4. and run_recorder_server): G10 -> held, the copy at 2001; the 500
short `created` lines still 500 applied.

### Medium

**M1. A window's credit is not limited to Tally's current number, and counts the changes that are not FinCom's above the
baseline.** Line 375-382. `above = a1 - greatest(a0, base)` and `cr = least(above, made)`:
- a window above the beat's ALTVCHID (another company of the same name, a restored backup, a window saved after the beat
  was read) credits its whole size (G4: 100 real misses hidden). Clamp: `and pw.a0 < p_altvchid`, `hi :=
  least(w.a1, p_altvchid)`, `above := hi - lo`;
- a window that is not fully accounted and straddles the baseline (a person working during the posting, one of their
  changes received) credits the people's changes too, and the "during the posting" words disappear with the gap (G3).
  At least `above - kk` of the part above the baseline is FinCom's, `kk := greatest(a1 - a0 - created_vch, 0)`; so
  `cr := greatest(least(above, w.created_vch, above - kk) - dup, 0)`. For a window above the baseline this is
  `created_vch`, as today;
- the window carries no company GUID, so a same-named company's posting window (the ZZ TEST kind) credits this book
  (44's M4, still open). Store the company GUID the bridge read in the company check and skip a window whose GUID is
  not the cursor's.
Test: G3 -> up to 3 with the "during the posting" words; G4 -> up to 100; 45's checks (100 with a window: no gap; 1103:
up to 3; window plus 100 matched lines: 1100 no gap, 1105 up to 5) still pass (they did on the copy).

**M2. Masters are credited against ALTVCHID.** `made = created_vch + created_mst` (line 378) and "fully accounted" when
`a1 - a0 = created_vch + created_mst`. ALTVCHID is the highest voucher AlterID: if Tally keeps one counter for masters
and vouchers, ledgers created after the person's voucher changes do not raise ALTVCHID and still make the window "full"
(G5: a ledgers-only job, 5 voucher changes hidden); if it keeps two, a ledger never raises ALTVCHID and each one credited
hides one voucher change. Either way, credit vouchers only (`least(..., w.created_vch, ...)`, as in M1) and name the
masters in the words as the fallback does ("of which up to k may be FinCom's own new ledgers"); or have the bridge send
ALTMSTID before and after too. Test: G5 -> up to 5 with the ledgers named.

**M3. A device can save any window for its own job, any number of times.** `tally_post_window_save` takes created
counts with no relation to the job (G7: 1,000,000 created for a 100-entry job, accepted, 3,900 changes hidden), and a
later save replaces the row whatever the job's state (a done job re-saved, a cancelled job saved; index.ts:1396 calls it
before the cancelled / seq / finished checks). Not across firms or devices (refused, tested). A device can already hide
gaps through 44 (an applied line with a huge AlterID), so this is about a buggy or replaying bridge more than an attacker.
Fix (SQL): refuse `p_vch > jsonb_array_length(payload->'vouchers')` or `p_mst > jsonb_array_length(payload->'masters')`
(the payload, not the accepted count: the window comes before the last update is stored); refuse a different window for a
job already `done` / `failed` / `cancelled` that has one (the same numbers again stay `ok`). Test: G7 -> refused; 45's
"saved again, updated in place" still passes.

**M4. The spelling-rule match scans the firm's postings for every unknown id: 500 short lines can take minutes.**
`tally_post_live_for`'s second query (line 154-157) calls `tally_post_id_match` on every live accepted id of the firm (the
join drives through `tally_post_jobs`, no index can serve it). Review B, 200,000 ids: one unknown id 0.40 s;
`tally_post_xml_for` with 500 unknown ids **167 s**; `tally_recorder_apply` calls the same function once per short line,
so a batch of 500 short lines whose postings are unknown or not yet accepted (M6) runs past the statement timeout, the
whole batch fails and the bridge sends it again for ever. Reachable as soon as lines carry a FinCom id: tally-ingest marks a line short whenever it
has a FinCom id (fid, or "TDSDesk:" in a narration it carries) and no XML, as the trial add-on's heads-only lines would.
Fix (tested: 167 s -> 0.10 s, run_migration45 unchanged): three indexes and a materialized union in place of the scan:
```sql
create index if not exists tally_post_ids_entry on public.tally_post_ids (firm_id, entry_id) where live;
create index if not exists tally_post_ids_fid_an on public.tally_post_ids (firm_id, (regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g'))) where live;
create index if not exists tally_post_ids_entry_an on public.tally_post_ids (firm_id, (regexp_replace(coalesce(entry_id, ''), '[^A-Za-z0-9]', '', 'g'))) where live;
-- tally_post_live_for, second query:
with c as materialized (
  select p.* from tally_post_ids p where p.firm_id = p_firm and p.live and p.entry_id = p_fid
  union select p.* from tally_post_ids p where p.firm_id = p_firm and p.live and regexp_replace(p.fincom_id, '[^A-Za-z0-9]', '', 'g') = nullif(regexp_replace(p_fid, '[^A-Za-z0-9]', '', 'g'), '')
  union select p.* from tally_post_ids p where p.firm_id = p_firm and p.live and regexp_replace(coalesce(p.entry_id, ''), '[^A-Za-z0-9]', '', 'g') = nullif(regexp_replace(p_fid, '[^A-Za-z0-9]', '', 'g'), ''))
select p.job_id, p.fincom_id, p.entry_id, p.matched_guid from c p join tally_post_jobs j on j.id = p.job_id
  join tally_books bk on bk.book_id = p_book and bk.firm_id = j.firm_id and bk.company = j.company
 where j.firm_id = p_firm and p.accepted_at is not null and p.released_at is null order by p.accepted_at desc limit 1;
```
Test: 200,000 ids, `tally_post_xml_for` with 500 unknown ids under 2 s; `tally_recorder_apply` with 500 unmatched short
lines under 5 s.

**M5. Any entry carrying a FinCom tag can take the posting first.** A person's duplicate of a posted voucher (Tally copies
the narration), or a narration typed with "TDSDesk:<id>", produces a short `created` line; if it arrives before FinCom's
own (or FinCom's never comes because port imports fire no event, the very premise of section 3) it is matched, built from
the posting's XML under the duplicate's GUID, and the posting shows "Matched with Tally" on the wrong entry; FinCom's own
line is then held for ever (G11). The same holds for a full line (43's rule, line 282-287, now stamping the GUID too).
Fix: decide from the trial (section 1) which event Tally fires for port imports, and let the add-on write a short line,
and the cloud build from the posting, only for that event (`imported`); a screen `created` / `altered` line keeps its full
body. Better still, the short line carries the date and voucher type (the add-on reads both already, section 7) and
tally-ingest builds from the posting only when they agree with the posted XML. Test: G11 -> the duplicate's line held or
applied from its own body, posting B1 unmatched; FinCom's own line then matched.

**M6. A short line that arrives before its posting's acceptance is held for good.** `tally_post_live_for` needs
`accepted_at` (run_migration45 asserts it: "a posting not accepted by Tally: no match, held"). Section 5 has the
uploader send lines between two posting requests, so a batch's lines can reach the cloud before that batch's
posts_update. Nothing matches the held line again when the acceptance arrives (only an owner's release would), so the
entry is missing from the copy and the posting stays unmatched. Fix: either bridge 2.2.0 sends a batch's posts_update
before any line of that batch (a stated rule with a Go test), or after `posts_update` stamps `accepted_at` tally-ingest
re-runs the book's lines held "FinCom id <id> matches no posting of this firm" for those ids (`tally_recorder_line(...,
p_row)`). Test: short line first -> held; the acceptance -> applied once, posting matched.

### Low

- **L1. The fallback counts a posted entry the copy held and then marked deleted** (line 395 `and v.deleted_at is null`):
  its creation is inside the baseline already (G6: 1 hidden). Fix: drop `and v.deleted_at is null`. Test: G6 -> up to 1.
- **L2. Locks.** Until its commit, 45 holds ACCESS EXCLUSIVE on `tally_books` (dropping the foreign keys drops their
  triggers on it), `tally_recorder_lines`, `tally_month_locks`, `tally_tieouts`, `tally_post_ids` and `tally_sync_cursor`
  (add column), SHARE ROW EXCLUSIVE on `tally_post_jobs` (review B, `pg_locks`). Reads of `tally_books` (every app page and
  tally-ingest call) wait for that time; on staging it is a fraction of a second (empty tables), but if a long transaction
  already holds `tally_books` the migration queues and everything queues behind it. Fix: `set local lock_timeout = '10s';`
  after `begin;` (a timeout rolls the whole file back; run it again), and run it outside working hours. With rows it is
  safe: validated, rows kept, all or nothing (1c).
- **L3. The gap check costs about 0.3 s per company per beat at 200,000 ids / 8,000 jobs** (review B, when `missing > 0`
  and the fallback runs: it reads the jobs' results arrays). Fine now; watch it once a firm has years of postings.
- **L4. A full line stamps every row of the firm with its FinCom id** (line 284-287: no job, company or `live` filter;
  43's rule, 45 adds the GUID, MasterID and AlterID). An old failed posting or another company's posting with the same id
  gets the GUID. Fix: stamp only the row `tally_post_live_for(b.firm_id, p_book, c_fid)` returns.
- **L5. Realtime load.** RLS holds (firm only). Each recorder line makes an INSERT and an UPDATE (its state), so a bulk
  posting of 2,000 entries sends 4,000 changes, each checked against RLS per subscribed browser. Subscribe with a
  `book_id=eq.<book>` filter, or later move Sync activity to a Broadcast from a trigger. DELETE events bypass RLS (only the
  key is sent); nothing deletes these rows.
- **L6. `tally_post_windows` keeps REFERENCES and TRIGGER for anon and authenticated under Supabase's defaults** (and anon
  SELECT; RLS gives it nothing). Not reachable through PostgREST; 44's tables are the same. For tidiness, `revoke all ...
  from anon, authenticated; grant select ... to authenticated`.
- **L7. The "never subtract twice" term `dup` is always 0** (line 380-381: `matched_alter > lo >= base >= recorder_max`
  and `matched_alter <= recorder_max` cannot both hold). The rule holds because the baseline already includes
  `recorder_max_alter`; say so in the comment, or drop the term in a later replace.
- **L8. index.ts:1396 saves the window before the update's seq / cancelled / finished checks**, so a late or replayed
  update rewrites it (closed by M3's SQL refusal; or move the call after those checks).
- **L9. Owner's rule.** The rule names 38's swap as the only allowed drop; 45 adds a second swap of the same kind. Ask the
  owner to confirm the 04-Oct instruction covers it before staging (it only tightens: RESTRICT).
- **L10. A restore to a number between the starting point and `match_alter` reads as matched** (44's L12, now also through
  `match_alter`, line 369-370 and 418: `p_altvchid < base` gives `missing < 0`). Consider "behind the last match" in the
  answer.

## Fix before staging

The file is safe to run on staging in the database sense: add-only apart from the RESTRICT swap (L9), one transaction,
run twice and over filled tables, RLS and a read-only firm policy on the new table, every function definer with a fixed
search_path, the service functions closed to members also under Supabase's defaults, `tally_post_xml_for` confined to
the firm, the book and live accepted postings. But it changes what the missing-changes check says on staging at once,
for every bridge, so these must be fixed before it runs:

1. **H1** (gap check: `since_fb` from the server's match time and the newest baseline-raising arrival, `match_at`). Test G1, G2, G2b.
2. **H2** (index.ts:805 and the SQL guard: a short `altered` line, or one for an entry the copy holds, is never rebuilt
   from the posting). Test G10.
3. **M4** (the indexed spelling match). Test: 500 unknown ids under 2 s.
4. **M1 and M2** (clamp the window to Tally's number, credit vouchers only, `above - kk`). Not reachable until 2.2.0 sends
   windows, but the function text is replaced now and the fix is a few lines. Test G3, G4, G5.
5. **M3** (window bounds and no rewrite of a finished job's window). Test G7.
6. **L1** (one condition) and **L2** (`lock_timeout`), cheap.

Before the add-on writes short lines and 2.2.0 posts with windows (not blocking staging): M5 (which event gets a short
line; the date and type on it), M6 (the posts_update before the lines, or a re-match on acceptance), M1's company GUID
(with 44's M4), L4, L5. Owner: L9.

All of 1, 3, 4, 5 and 6 (and H2's SQL half) were applied together to a scratch copy and checked: G1, G2, G2b, G3, G4, G5,
G6, G7, G10 give the right answer, `tally_post_xml_for` with 500 unknown ids takes 0.10 s, and `run_migration45.py` passes
(56 ok) with the copy as `M45_FILE`.

## Fixed (04-Oct-2026)

Test first: every G scenario above became a named, permanent check (`tests/run_migration45.py` item G, ONLY=G runs it
alone; the tally-ingest parts in `tests/run_recorder_server.py`), run red against the reviewed file, then fixed and run
green (red / green outputs: session scratchpad `tdd/m45fix.<id>.red` / `.green`). The reviewer's diff (`r45/m45-fixes.diff`)
was adopted in substance, with these differences: the recorder term of the fallback's time is `recorder_last_at` (set when
`recorder_max_alter` is raised, also by a release) instead of a scan of the book's lines; the "during the posting" count and
`full` use vouchers only (`a1 - a0 - created_vch`); a window is counted only for the book's company GUID; a cancelled job's
window is refused outright; the spelling union selects the six columns it needs, not `p.*`.

| Item | Change | Test (red before, green after) |
|---|---|---|
| H1 | `tally_sync_cursor.match_at` (added): the server's time of a match (`last_match_at` stays the PC's, for the app). The fallback counts only postings accepted after `since_fb` = the latest of: the last match's `match_at` under this starting point (else the start), `recorder_last_at` when the recorder raised the baseline, the time of the day read that brought the highest AlterID. Every term can only move it later, so an error leaves a posting out (a false alarm with words), never subtracts one twice | G1 (up to 4, `match_alter` not set; 5 at 1106), G2 (PC 2 minutes behind: up to 3), G2b (batch accepted between the read and the check: up to 3); 45's "the same without a window: no gap" and the fallback's next beat still pass |
| H2 | SQL: `tally_recorder_line` builds from the posting only a short `created` / `imported` line of an entry the copy does not hold; a short `altered` line, or one for an entry the copy holds, is matched and held "FinCom posting <id> matched; changed in Tally after posting: the next full line or Day Book upload applies it", never applied, so its AlterID is not received and the gap check shows it. index.ts: `shortBodies` fetches the posted XML for `created` / `imported` only | G10 (held, the copy at 2001, no version 2002; a short `created` for the held entry at a newer AlterID held the same way; the gap check at 2003: up to 2); run_recorder_server H2 (no XML fetched, held, copy at 2001). The 500 short `created` lines still 500 applied |
| M4 | Three indexes on `tally_post_ids` (`(firm_id, entry_id)`, the letters-and-digits of `fincom_id`, of `entry_id`; all `where live`); `tally_post_live_for`'s second query is a materialized union of the three indexed spellings in place of `tally_post_id_match` over the firm | M4: 200,000 ids, `tally_post_xml_for` with 500 unknown ids 0.09 s (bound 2 s; 20 s timeout red), `tally_recorder_apply` with 500 unmatched short lines 0.32 s (bound 5 s); the spelling rule kept (exact, entry id, either id's letters and digits, another company's not) |
| M1 | Windows: `pw.a0 < ALTVCHID`, the part between `max(a0, baseline)` and `min(a1, ALTVCHID)`, credit `least(part, created_vch, part - K)` with `K = a1 - a0 - created_vch`. `tally_post_windows.company_guid` (added); `tally_post_window_save` takes `p_guid` (8 arguments; the 7-argument form never ran anywhere, so no second overload exists); the gap check counts a window only when its GUID equals the cursor's (`start_guid`, else `company_guid`), and names one that does not ("not counted (made in company GUID x; this book's is y)"). index.ts passes `window.guid` | G3 (up to 3, "during the posting" kept), G4 (window above Tally's number: up to 100), G4g (another GUID: up to 100, named); run_recorder_server M1 (`window.guid` stored). 45's window checks pass with the GUID set |
| M2 | Only vouchers are credited; a window's masters join the fallback's in "of which up to k may be FinCom's own new ledgers"; `full` is `a1 - a0 = created_vch` | G5 (up to 5, the ledgers named) |
| M3 | `tally_post_window_save` refuses more vouchers / masters created than the job's payload held, any window of a cancelled job, and a different window for a `done` / `failed` job that has one (the same numbers again stay ok) | G7 (1,000,000 created refused; up to 3,900; a finished job's window kept as first saved; a cancelled job's refused); "saved again, updated in place" still passes |
| L1 | The fallback's "not in the copy" no longer requires `deleted_at is null` | G6 (up to 1) |
| L2 | `set local lock_timeout = '10s';` right after `begin;` | L2: the text; and 45 run while another session holds `tally_sync_cursor`: stops after 10.0 s, rolled back (red: waited 28.6 s, until the holder ended) |
| L6 | `revoke insert, update, delete, truncate, references, trigger ... from anon, authenticated`; `revoke all ... from anon`; the id sequence closed to both; `grant select to authenticated` kept | L6: all granted to anon and authenticated (Supabase's defaults), 45 run again: authenticated SELECT only, anon nothing, sequence closed |
| L8 | index.ts saves the window after the seq / cancelled / settled checks and after the job's row is stored (never for a cancelled, late or settled update) | run_recorder_server L8 (a cancelled job's update and a late seq update carrying a window: no save, no call) |
| L10 | Below `match_alter` (same starting point), read after the last match: needs_baseline with words ("below the last matched check's"), as 44's below the start, never matched; a reading older than the last match (two beats crossing) answers `behind` and changes nothing (so a race is never a restore) | L10 |
| M6 | `tally_recorder_short_held(firm, job)` (service role: the job's short `created` / `imported` lines held "FinCom id <id> matches no posting of this firm" whose id now matches a live accepted posting of that job) and `tally_recorder_short_retry(firm, book, lines)` (service role: re-runs the SAME held rows; event, GUID, AlterID and FinCom id from the stored row, only the body from the caller; applied / duplicate / stale raise `recorder_max_alter`; anything else `skipped`). index.ts calls both after posts_update's acceptances, building the bodies from the posted XML as for any short line | M6 (SQL: held, found after acceptance, same row applied, one entry, posting matched, AlterID received; again: skipped); run_recorder_server M6 (a short line before the acceptance held; posts_update's acceptance applies it once, built from the posted XML) |
| L4 | A full line stamps only the firm's live row of its FinCom id whose posting is of this book's company | L4 (an old failed posting of another company with the same id: not stamped). 43's and 44's rules hold (run_migration44 149 ok with 45, run_recorder_server's "a FinCom posting coming back") |
| L7 | Comment only: the `dup` term is empty by construction (the baseline includes `recorder_max_alter`), kept as the guard | — |
| M5 | Not code: docs/recorder-bulk-posting.md section 2 now has the add-on write a short line only for the import event (never on a screen save) and carry the voucher's date and type; until the trial (section 1) shows which event Tally fires for port imports, no short lines at all. G11 is unchanged in the database (a short `created` line of a person's duplicate arriving first still takes the posting); H2 covers the `altered` half | — (G11 left as documented) |
| L5 | Not code (the app is outside this change): docs/recorder-bulk-posting.md section 4 records that the app subscribes per firm today (src/js/54-live-sync.js) and should filter by `book_id` or move to a Broadcast before bulk postings run with the add-on loaded | — |
| L3 | Left: 0.3 s per company per beat at 200,000 ids, as reviewed | — |
| L9 | The owner's instruction of 04-Oct explicitly named all three tables (tally_recorder_lines, tally_month_locks, tally_tieouts) for RESTRICT, so the swap is covered; it only tightens. The header and docs/MIGRATION-ORDER.md say so | the existing D. checks |

Residual, stated: the fallback's time is the time a posting's acceptance reached the cloud, not the time Tally made the
entries. Two seconds-wide windows remain, both bounded by one request (at most 50 entries):
- a batch made AFTER a person's change, whose acceptance reaches the cloud BEFORE that person's line (the uploader sends
  lines between posting requests): left out, a false alarm the words explain;
- a batch made BEFORE a person's change, whose acceptance reaches the cloud AFTER that person's line was received: still
  counted though its changes are under the baseline, so up to that batch's size of later changes can be hidden (and a
  match then makes it final). It closes when 2.2.0 sends windows (no fallback), or when the bridge sends each batch's posts_update before
  any line received after that batch (the rule M6's first option names; a Go test with 2.2.0).

Kept: add-only (the only drop is the RESTRICT swap of 38's kind; the file holds no "delete from" text at all), safe to run
twice and over used tables (three runs in run_migration45, over 200,000 ids and filled 44 tables), one transaction,
`search_path = public, pg_temp` and security definer on every function, RLS and the read-only firm policy, the realtime
publication once.

Functions 45 creates or replaces: `tally_post_window_save(uuid, uuid, uuid, bigint, bigint, bigint, bigint, text)`,
`tally_post_live_for(uuid, uuid, text)` (internal), `tally_post_xml_for(uuid, uuid, text[])`,
`tally_recorder_line(uuid, uuid, jsonb, bigint)` (internal), `tally_recorder_short_held(uuid, uuid)`,
`tally_recorder_short_retry(uuid, uuid, jsonb)`, `tally_recorder_gap_check(uuid, uuid, bigint, timestamptz)`.

Runs after the fix (one at a time, pg_stand only): run_migration45 89 ok (its run_migration44 re-run with 45: 149 ok),
run_migration44 150 ok, run_migration43 80 ok, run_migration_order 113 ok, run_recorder_server 48 ok,
run_main_bridge_server 117 ok, `deno check server/tally-cloud/index.ts` clean.
