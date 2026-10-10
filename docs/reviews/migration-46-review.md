# Database and security review: migration 46 (trial tools per computer) and the round-19 beat

Reviewed: 04-Oct-2026, read-only. Scope: `server/tally-cloud/migration-46-trial-tools.sql` (47 lines, working tree) and the
uncommitted tally-ingest changes (`git diff -- server/tally-cloud/index.ts`: `beatChanges` reading both beat shapes,
`tally_start_point` once per cold start, the gap check, `atOf` (IST for zone-less times), `trialTools` in the beat answer).
Nothing was run against a real database and no Supabase tool was used. Every check below ran on the throwaway PostgreSQL of
`tests/pg_stand.py` (own instances, ports 55481 and 55482) and the stand-in for Supabase (`tests/fake_supabase.py`). No
repository code was changed. The only file written is this one.

## Tests run

| Test | Result |
|---|---|
| `python3 tests/run_migration46.py` (staging order 32 to 45, 46 twice, a third time over a used column) | all passed (40 ok) |
| `python3 tests/run_migration_order.py` (both orders, each twice, ending with 46) | all checks passed (119 ok) |
| `DENO=/opt/deno/deno python3 tests/run_recorder_server.py` | all passed (58 ok) |
| `DENO=/opt/deno/deno python3 tests/run_main_bridge_server.py` | all passed (124 ok) |
| `deno check server/tally-cloud/index.ts` | clean |
| Review checks A (port 55481, `r46/sqlchecks.py`): Supabase's default privileges simulated **before** the schema (`alter default privileges in schema public grant all on tables / functions / sequences to anon, authenticated, service_role`), migration.sql's column grant on `tally_devices`, 32 to 45, 46 twice; then P1-P8 (privileges) and S1-S8 (starting point, gap check) | quoted in the findings |
| Review checks B (port 55482, `r46/rs_review.py`: a copy of run_recorder_server with scenarios R1-R7 added before its `finally`): the real index.ts under Deno, two PCs | quoted in the findings; the copy's own 58 checks still pass |
| The fixes proposed below, applied to scratch copies (`r46/m46-fixed.sql`, `r46/fix/tally-cloud/index.ts`; diffs `r46/m46-fixes.diff`, `r46/index-fixes.diff`) | A and B turn to the right answers; run_recorder_server's 58 and run_main_bridge_server's 124 checks pass on the fixed index.ts; `M46_FILE=<copy> run_migration46.py` passes except its "one function in the file" check (expected, see H1) |

The `r46/` files are in the session scratchpad.

## Checklist

| # | Check | Result |
|---|---|---|
| 1a | Add-only: no DROP, no DELETE, no TRUNCATE; no "delete from" text anywhere | pass (run_migration46 checks the text, comments included). Three `add column if not exists`, one `create or replace function`, grants |
| 1b | Safe to run twice, and over a used column | pass: twice, then a third time after the owner turned one computer on: the choice kept |
| 1c | One transaction, `set local lock_timeout = '10s'` | pass. `add column ... not null default false` is a fast default (no table rewrite); it takes ACCESS EXCLUSIVE on `tally_devices` for an instant, and every beat writes `tally_devices`, so the timeout matters and is there |
| 1d | Runs after 45 in both orders | pass (run_migration_order: both orders end with the same function texts) |
| 2a | RLS on `tally_devices` | unchanged: RLS on, only the select policy `firm_id = my_firm()`. The three columns are granted for SELECT to authenticated (staff of the firm read 3/3 of their own computers; anon: no SELECT on the column) |
| 2b | Can staff, another firm or anon write `trial_tools` directly? | **no** (P2). Under Supabase's defaults anon and authenticated hold table-level INSERT, UPDATE, DELETE (and TRUNCATE, REFERENCES, TRIGGER) on `tally_devices`, so they hold column UPDATE on `trial_tools` too, but there is no write policy: a direct `update tally_devices set trial_tools = true` as staff, as the owner, as another firm's owner and as anon changes 0 rows. Tidy-up: L7 |
| 3a | Security definer, `search_path = public, pg_temp`, owner postgres | pass (P6, P7) |
| 3b | Grants under Supabase's defaults | pass: EXECUTE for authenticated and service_role only; anon refused ("permission denied", P3); no PUBLIC grant (P8). The function's own check refuses service_role too (P4: no `auth.uid()`: "only an owner ...") |
| 3c | Owner-only exactly as `tally_device_post_settings` (44's text) | pass, line for line: `my_firm()`, an active `owner` member of that firm, the device of that firm and not revoked, the same advisory-lock pattern, `update ... where id = p_device and firm_id = f`. Same message for an unknown, revoked or other firm's computer (no oracle for other firms' device ids) |
| 3d | Can staff or another firm switch trial tools on? | **no**: staff "only an owner ..."; another firm's owner on our computer and our owner on theirs "not a computer of your firm"; a former (inactive) owner refused; anon has no EXECUTE (run_migration46 and P3) |
| 3e | Can a device / bridge switch itself on? | **no**. The beat path only reads `(dev as any).trial_tools === true` (index.ts:1437) from the row loaded by the device key. The only writers of `tally_devices` from tally-ingest are `last_seen` / `version` / `info` (the beat's `info` is built field by field, never from `body`), `want_sent_at` and `main_bridge`; the only SQL that writes `trial_tools` is `tally_device_trial_tools` (P5). R5: a beat carrying `trialTools: true`, `trial_tools: true` and `info.trial_tools: true` answers `false` and leaves the row alone; a row holding the string `'true'` answers `false` (strict). bridge-go reads `trialTools` only from the answer (`trial.go`: true on, anything else off), so a cloud without 46 answers `false` and the tools stay off |
| 3f | The beat answer leaks nothing else | pass for 46: the answer gains one boolean; `trial_tools_by` / `trial_tools_at` are not sent (R5; keys: activityAt, ledgers, ok, opened, posts, readStop, settings, trialTools, updateNow, wake). The `recorder` part sends more than the bridge uses: L4 |
| 4 | `beatChanges`: another company's numbers, a forged GUID | **fail**: H1 |
| 5 | Huge, negative and odd numbers | pass (R2): -5, 0, 10^15, `true`, null, "12abc" make no call; 10^15 - 1, "1e3" (1000), 1.9 (1) and " 77 " (77) are taken as numbers, as `tally_start_point` / the gap check allow |
| 6 | A company not linked | pass for safety (no starting point, no gap check: `tally_book_for` answers null), but it costs a call per beat for ever: M1 |
| 7 | The once-per-cold-start memory | not stale for `needs_baseline`: nothing in SQL clears `start_at` (`tally_baseline_clear` only sets the state), and `tally_start_point` with the same GUID never moves it, so skipping it changes nothing. A new GUID is a new key and is called. It is stale only through H1 (another GUID moved the point and this isolate never re-sends its own). Note: it is once per isolate, and Supabase runs several isolates and recycles them often |
| 8 | IST for zone-less times | pass for the bridge's own format (`2006-01-02T15:04:05`, with or without seconds and fractions: +05:30; IST has no DST); `Z`, `z` and `+hh:mm` are kept as given. Gaps: M2 (a clock ahead), L3 (other zone-less forms) |
| 9 | Load per beat | M1 (calls and writes per company per 30 s), L1 (the 21st company never checked) |

## Scenarios run

Review checks A (SQL, the functions as 44 / 45 leave them; 46 does not touch them):

| # | Case | Today | Right |
|---|---|---|---|
| S1 | Book of company GUID A: start 1000, recorder lines to 1010, check 1010 | matched | as today |
| S2 | A same-named company (or a forged GUID) B on another PC: `tally_start_point(B, 50)` | `needs_baseline` ("GUID changed cg-A -> cg-B") **and** the starting point moved: 50, `start_guid` cg-B, `start_at` now (the match history dropped) | needs_baseline; the point kept at A's 1000 |
| S3 | then A's check 1012 / B's check 52 | A: "up to 2" here only because recorder lines reached 1010; without lines (R1) "up to 963"; B's 52 **matched** against A's book | A: up to 2; B: never compared with A's book |
| S4 | each PC after a cold start | the point flips to A (1012), then to B (52), at every cold start of every isolate | stays A's |
| S5 | a new GUID C with 999,999,999,999,999 | point 999,999,999,999,999; every later check of A "below the starting point": needs_baseline, no gap ever shown until A's next cold start | needs_baseline, A's gap still shown |
| S6 | a book whose start (1000) came from a gap check without a GUID, gap "up to 50"; then any GUID with start 1050 | the point moved to 1050 **silently** (state ok), the next check matched: the 50 forgiven | the GUID stamped, the point kept, "up to 50" |
| S7 | a fresh book: a wrong company's GUID first, then the right one | first GUID wins the book (32's rule); the right one is flagged needs_baseline and moves the point | first GUID still wins (L6), the right one flagged, the point kept |
| S8 | a check matched with the PC's clock a year ahead (`p_at` 2027), then a restore below the match read with a right clock | `last_match_at` 2027; the restore answers `behind` ("a reading older than the last match") at every beat, state ok | needs_baseline |

Review checks B (the real index.ts under Deno, PC-A and PC-B of one firm):

| # | Case | Today | With the fixes |
|---|---|---|---|
| R1 | PC-A: ZZ FORGE GUID cg-A 1000, then PC-B: same name, cg-B 40, then PC-A 1003, PC-B 41 | B moves the point to 40 (needs_baseline); A's 1003: **"up to 963 changes not received"**; B's 41: "up to 1"; the answers and the cursor's gap flap between the two PCs | B: `{needsBaseline: true, otherCompany: true}`, no gap check; A's 1003: "up to 3" against its own 1000 |
| R2 | odd numbers | see checklist 5 | same |
| R3 | 50 unlinked companies in companies[], or 80 in 2.1.9's changeNumbers | 20 `tally_book_for` calls every beat | 20 on the first beat, 0 for a minute after |
| R4 | 21 linked companies | beat 1: 20 + 20 + 20 calls; every beat after: 20 `tally_book_for` (each an UPDATE of `tally_books`) + 20 gap checks; the 21st never checked | beat 2: 20 gap checks only; the 21st still never checked (L1) |
| R5 | trialTools | see checklist 3e | same |
| R6 | companies[] with an altvchid but no changeNumbers entry | the company's last-update time (01-Sep) becomes the check's time: "since 01-Sep-2026 09:00" | unchanged (L2) |
| R6b | a 2.1.10 beat whose PC clock is a year ahead, a match, then a restore to 11 with a right clock | `last_match_at` 2027-10-04; the restore: no gap, no needs_baseline, state ok | the time taken as now; the restore: needs_baseline |
| R7 | 2.1.9: startPoint cg-old 5 (01-Oct), changeNumbers 70 | start 5, "up to 65 changes not received since 04-Oct 16:06" (the cloud's start time, not the bridge's 01-Oct) | unchanged (L5) |

## Findings

### High

**H1. Another company's GUID moves the starting point (and round 19 sends it from every PC's beat).**
`tally_start_point` (migration-44-recorder.sql:744) resets the point whenever `g is not null and c.start_guid is distinct from g`.
`tally_sync_guard` does mark the book `needs_baseline` when the GUID is not the book's `company_guid`, as intended, but the
point is moved anyway: `last_voucher_alterid`, `start_guid`, `start_at` all take the other company's values (S2). Until
round 19 only an explicit `start_point` request reached it, and bridge-go never sends one; now the beat calls it for every
company with a GUID and numbers, from every PC, at the first beat each isolate sees (index.ts:307). Effects, all on
staging's first day for any firm with two PCs that hold a same-named company (44's M4 "ZZ TEST" case) or a restored copy:
- the point flips between the two companies at every cold start (S4), the match history is dropped each time;
- the other PC's numbers are compared with this book (index.ts:320 has no GUID check): false "up to 963" on the real
  company (R1), a "matched" on the other (S3), and the windows of the real GUID stop counting (`cg` follows `start_guid`);
- a huge number under a new GUID silences the real company's gap until the next cold start (S5: only "below the starting
  point");
- a start the gap check recorded without a GUID is moved silently by the first GUID that comes, with no needs_baseline,
  and an open gap is forgiven (S6).
A device key is the firm's own, so this is a correctness hole of the gap check more than an attack, but the gap check is
the reason the round exists.
Fix (SQL, in 46: `create or replace function public.tally_start_point` with the same signature, grants and SET; tested on
`r46/m46-fixed.sql`):
```sql
  select * into c from tally_sync_cursor where book_id = p_book;      -- after tally_sync_guard, as today
  other := g is not null and c.company_guid is not null and c.company_guid <> g;
  if not other and c.start_at is null then
    update tally_sync_cursor set last_voucher_alterid = p_altvch, last_master_alterid = p_altmst, start_guid = coalesce(g, start_guid), start_at = now(), start_device = p_device, updated_at = now() where book_id = p_book;
    done := true;
  elsif not other and g is not null and c.start_guid is null then       -- a start without a GUID: stamp it, keep the numbers
    update tally_sync_cursor set start_guid = g, updated_at = now() where book_id = p_book;
  elsif not other and g is not null and c.start_guid <> g then          -- a point moved by another GUID before this fix: back to the book's
    update tally_sync_cursor set last_voucher_alterid = p_altvch, last_master_alterid = p_altmst, start_guid = g, start_at = now(), start_device = p_device, updated_at = now() where book_id = p_book;
    done := true;
  end if;
  ... return jsonb_build_object(..., 'otherCompany', other, 'bookGuid', c.company_guid);
```
and in index.ts keep the answer per key and skip the gap check for another company (4 lines):
```ts
const startDone = new Map<string, boolean>();                       // book|GUID -> another company than the book's
startDone.set(key, (data as any)?.otherCompany === true);           // in place of startDone.add(key)
if (startDone.get(key) === true) { out[c.name] = { gap: null, missing: 0, needsBaseline: true, otherCompany: true }; continue; }   // before the gap check
```
This changes 44's rule "a new company GUID: the point reset, needs_baseline" (run_migration44 S.) into "needs_baseline,
the point kept": the owner's baseline (or a later decision on re-created companies) is where a new GUID starts again.
Today a re-created company is flagged at every call anyway, since `company_guid` never changes. Owner to confirm.
Test (red now, green on the copies): S2 (set false, point 1000, cg-A, needs_baseline), S4 (no flip), S5 (A's 1013: up to
3), S6 (GUID stamped, still "up to 50"), R1 (B: `otherCompany`, no gap check; A: up to 3), in run_migration46 and
run_recorder_server; run_migration46's "one function in the file" becomes two.

### Medium

**M1. Every beat now calls `tally_book_for` per company, and each call is an UPDATE of `tally_books`, which is in the
Realtime publication.** index.ts:303. Round 19 reads 2.1.9's changeNumbers, so every bridge on staging (2.1.9) now drives
this path; before, 2.1.9 beats made no recorder calls. Per PC per 30 s, for up to 20 companies: 20 `tally_book_for` + 20
`tally_recorder_gap_check` (+ 20 `tally_start_point` once per isolate) (R4). `tally_book_for` (migration-2-hardening.sql:38)
ends in `insert ... on conflict (book_id) do update set client_id = excluded.client_id`, a row UPDATE even when nothing
changes, and `tally_books` is in `supabase_realtime` (migration-15) with every open FinCom page subscribed to its UPDATEs
(src/js/54-live-sync.js:266). So each beat sends up to 20 change events per PC to every open page of the firm, each checked
against RLS per subscriber: with 3 PCs, 120 events a minute per page, doing nothing (`bookChanged` ignores them). Unlinked
companies cost 20 calls every beat for ever (R3). The gap check also writes the cursor at every beat (its match or its gap),
which is 45's design.
Fix (index.ts, tested): cache the book per firm and company for 5 minutes (not linked: 1 minute):
```ts
const bookMemo = new Map<string, { book: string | null; t: number }>();
async function bookForBeat(firm: string, name: string) {
  const k = firm + "|" + name, m = bookMemo.get(k);
  if (m && Date.now() - m.t < (m.book ? 300000 : 60000)) return m.book;
  const book = await bookFor(firm, name);
  if (bookMemo.size > 5000) bookMemo.clear();
  bookMemo.set(k, { book, t: Date.now() });
  return book;
}
```
(a client unlinked or a GSTIN changed is seen within 5 minutes by the beat; every other kind still calls `bookFor` each
time). Optional, in SQL: `... do update set client_id = excluded.client_id where tally_books.client_id is distinct from
excluded.client_id` in `tally_book_for`, so that no other path sends empty Realtime events either. Test (red / green): R3
(second beat: 0 calls), R4 (second beat: gap checks only).

**M2. A PC clock ahead puts the last match in the future, and restores below it are then never flagged.** `atOf`
(index.ts:238) keeps any parsable time, and `tally_recorder_gap_check` stores it as `last_match_at`. 45's rule then reads any
lower number with an earlier time as "a reading older than the last match" (`behind`, nothing changed): R6b and S8, a restore
below the match answers `behind` at every beat, state ok, until the wrong date passes; the words also say "since <a future
date>". A Windows clock a day or a year off (battery, manual change) is enough. Before round 19 the same came from
companies[].at, but only 2.1.10 sent numbers.
Fix (index.ts, one condition, tested): `return isNaN(ms) || ms > Date.now() + 300000 ? new Date().toISOString() : ...`.
Optionally the same bound in SQL (`at_ := least(coalesce(p_at, now()), now() + interval '5 minutes')`) in a later replace of
the gap check. Test: R6b (the time taken as now; the restore: needs_baseline).

### Low

- **L1. A beat with more than 20 companies with numbers never checks the 21st onwards** (index.ts:301 `slice(0, 20)` after
  the filter, in the beat's order: open companies first). R4: "LK 20" never gets a starting point. Fix: with M1's cache the
  cost is mostly the gap check; raise to 50 (the cap of `beatChanges`) or rotate the starting index per beat. Test: 21
  companies, two beats: each gets a starting point.
- **L2. The check's time falls back to companies[].at, which is the company's last update, not the check's time**
  (`beatChanges`: `at: s(n.at, 40) || s(c.at, 40)`). When companies[] has numbers but changeNumbers lacks the company (R6):
  "since 01-Sep-2026 09:00" and an old `last_match_at`. bridge-go fills both from the same light check, so it is rare. Fix:
  fall back to now (`at: s(n.at, 40)`), and let 2.1.10 put the check's time in companies[] under its own name. Test: R6 ->
  `last_match_at` now.
- **L3. Zone-less forms other than `YYYY-MM-DDThh:mm[:ss[.f]]` are read in the cloud's zone (UTC) or worse**:
  `2026-10-04 15:40:00` (space) 5.5 hours off, `2026-10-04` UTC midnight, `04-10-2026 15:40` as 10-Apr (V8's US order),
  10 fraction digits as UTC. bridge-go sends only `2006-01-02T15:04:05` today, so nothing breaks. The +05:30 also assumes
  every PC runs on IST. Fix: accept `[T ]` in the regex, refuse other shapes (now); later have the bridge send the offset
  (Go `2006-01-02T15:04:05-07:00`). Test: an `atOf` unit check over these strings.
- **L4. The beat answer's `recorder` carries the whole gap object** (index.ts:323 `gap: d?.gap`): `by_device` (the other
  PCs' device ids with their last AlterID and time), `windows` (posting job ids), the counts. Same firm only, 44 / 45's
  shape, and bridge-go does not read `recorder` at all. Fix: `gap: d?.gap ? { missing: d.gap.missing, words: d.gap.words } :
  null`. Test: run_recorder_server's 19-2 / 19-3 still pass on `missing` and `words`; the answer has no `by_device`.
- **L5. The words date the gap from the cloud's start, not the bridge's starting point** (R7: the bridge's point is from
  01-Oct, the words say "since 04-Oct 16:06"). The count is right (an upper bound since the bridge's point). Fix: pass the
  startPoint's `at` (through `atOf`) to `tally_start_point` and keep it as the start time, or say "since the bridge's start
  on <date>". Test: R7's words carry 01-Oct.
- **L6. The first GUID a book sees is its company forever** (32's `company_guid = coalesce(company_guid, g)`; S7). With
  round 19 the first may come from any PC's beat. H1's fix keeps the right company from being moved but not from being
  flagged; the owner has to know which PC is right. Note it in the needs_baseline words ("the company's Tally GUID changed
  (A -> B) on <PC>") with the device's name.
- **L7. `tally_devices` keeps INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER for anon and authenticated under
  Supabase's defaults** (P1; only SELECT was revoked in migration.sql). RLS makes the writes reach 0 rows (P2), and
  PostgREST cannot TRUNCATE, so nothing is reachable. It is older than 46. Tidy-up for a later migration: `revoke insert,
  update, delete, truncate, references, trigger on public.tally_devices from anon, authenticated;`.
- **L8. A failed `tally_start_point` that is not a missing function is retried and logged at every beat** (it is not
  remembered), e.g. a busy database: one `console.error` per company per 30 s. Acceptable; or remember a failure for 5
  minutes.
- **L9. Only the last switch is kept** (`trial_tools_at`, `trial_tools_by`), as 43's posting settings. If the owner wants
  to see who turned the tools on and off over time, a row in an append-only table per call. Not needed for staging.

Not 46's, for the owner: after a restore below the starting point the book is needs_baseline at every beat, also after the
owner clears it, because nothing ever moves the point back (44's design; H1's fix does not change it).

## Fix before staging

46 itself is safe to run on staging: add-only, one transaction with `lock_timeout`, run twice and over a used column,
security definer with `search_path = public, pg_temp`, EXECUTE for authenticated only (anon refused also under Supabase's
defaults), owner-only exactly as `tally_device_post_settings`, no direct write path for staff, other firms, anon or a
device, and the beat only reads the switch. md5 of its function body on staging after it runs (prosrc):
`tally_device_trial_tools` = `86245cc136112d0a014503871ea7ab24` (this changes if H1's function is added to the file).

The index.ts of round 19 should not reach staging without:

1. **H1**: `tally_start_point` replaced in 46 (another company's GUID: needs_baseline, the point kept; a GUID-less start
   stamped, not moved) and the beat skipping the gap check for `otherCompany`. Owner to confirm the change to 44's "a new
   GUID starts again". Test S2, S4, S5, S6, R1.
2. **M1**: the cached `bookForBeat` (and, cheaply, the `where ... is distinct from` in `tally_book_for`). Test R3, R4.
3. **M2**: the 5-minute bound on the bridge's time. Test R6b.

Before 2.1.10 or a later round (not blocking): L1, L2, L3, L4, L5, L6 (words), L7, L8, L9.

All of 1-3 were applied together to scratch copies and checked: S2-S6 and R1, R3, R4, R6b give the right answers;
run_recorder_server (58 ok, with the fixed 46 added to its order) and run_main_bridge_server (124 ok) pass on the fixed
index.ts; `deno check` clean; `M46_FILE=<copy> run_migration46.py` passes except "one function in the file".

## Fixed (04-Oct-2026)

Test first: the new checks were run red against the files as reviewed
(`scratchpad/tdd/m46fix.migration46.red`: 10 failures; `m46fix.recorder_server.red`: 14 failures), then green. Nothing was
run against a real database; pg_stand and fake_supabase only. Only `migration-46-trial-tools.sql`, `index.ts`, the tests
named below and the docs were changed.

**H1, fixed (the owner's decision: the safer reading).** A different company GUID never moves the starting point.
`migration-46-trial-tools.sql` part 3 replaces `tally_start_point` (44's 7 arguments, `security definer`, `search_path =
public, pg_temp`, revoked from public, anon and authenticated, granted to service_role):
- another GUID than the book's `company_guid`: `tally_sync_guard` marks needs_baseline as today; the point, `start_guid`
  and `start_at` are kept; the answer says `set: false, otherCompany: true, bookGuid`;
- a point recorded without a GUID (the gap check's): the GUID stamped, the numbers and the open gap kept;
- different from the reviewer's diff: a point that another GUID moved before 46 is not moved back silently. It is kept
  and the book is marked needs_baseline with words that point to the owner's clear;
- the owner's `tally_baseline_clear` (37) sets state ok and `cleared_at` but does not reset `start_at` / `start_guid`. So
  a cursor cleared after its start (`cleared_at > start_at`) is recorded afresh by the next call, once. A GUID that call
  brings becomes the book's `company_guid` before the guard runs, so it is not flagged. `gap`, `gap_at` and
  `last_match_at` are cleared with it;
- 44's rule "a new company GUID resets it" is replaced. This is recorded in 46's header and in docs/MIGRATION-ORDER.md
  (44's and 46's rows, and the tally-ingest function table).

In index.ts, `startDone` keeps per book and GUID whether the answer said `otherCompany`, and `bookGuid` keeps the book's
GUID that was answered. When either says another company, the beat answers `{gap: null, missing: 0, needsBaseline: true,
otherCompany: true}`, makes no gap check and logs it once per key. Unlike the reviewer's diff, the start point is asked
again after 5 minutes rather than once per isolate, so the owner's clear is seen. That is one call per company per
5 minutes.

Tests:
- run_migration46: PC-A cg-A 1000, PC-B cg-B 40, then alternating beats and a third GUID with 999,999,999,999,999: the
  point stays at 1000 / cg-A / the same start_at, needs_baseline; A's 1003 gives "up to 3".
- run_migration46: a GUID-less start at 1000 with "up to 50", then cg-N: stamped, not moved, still 50.
- run_migration46: a point moved before 46 is flagged.
- run_migration46: after the owner's clear, cg-B records anew at 60 and becomes the book's company, state ok. Once only;
  cg-A is then the other company. A clear under the same GUID also records afresh, once.
- run_migration46: one `tally_start_point`, its grants, and refused to a member.
- run_recorder_server (the real index.ts): R1 as run in the review, with PC-B never gap-checked and logged once. A
  GUID-less start then a GUID: stamped, the gap of 20 kept.

**M1, fixed.** `bookForBeat` caches the book per firm and company: 5 minutes when linked, 1 minute when not. Test: over
10 beats, `tally_book_for` is called once per company (two linked and one unlinked), while the gap check runs every beat.
Not done: `where tally_books.client_id is distinct from excluded.client_id` in `tally_book_for`. It is SQL outside
index.ts's control, so other callers of `tally_book_for` still rewrite the row.

**M2, fixed.** `atOf` takes a time more than 5 minutes ahead of the server's now as now. Test: a check time a year ahead
gives `last_match_at` = now, and a restore below the match is then needs_baseline, not "behind". The bound is not in SQL
(the gap check is unchanged).

**L2, fixed.** The check's time comes from `changeNumbers.at` only. When it is missing, the time is now, never
companies[].at. Test R46-L2. Three older run_recorder_server beats that passed their time in companies[].at now pass it
in changeNumbers, which is where the bridge sends it.

**L3, fixed.** Only the bridge's exact zone-less form `2006-01-02T15:04:05` gets +05:30. An ISO time with `Z` / `+hh:mm`
is read as it says. Any other form is not read and becomes now: a space separator, a date alone, `DD-MM-YYYY`, no
seconds, or fractions without a zone. Test R46-L3 covers each.

**Left as documented:** L1 (the 21st company), L4 (the whole gap object in the answer), L5, L6, L7, L8, L9.

Residuals of the H1 fix, for the owner:
- After a clear, the first call wins, from whichever PC beats first. That can be the wrong company's PC (the L6 analogue).
- After the book changes company by a clear, the old company's `recorder_max_alter` stays in the baseline.
- A 2.1.9 bridge's own `startPoint` numbers, not the numbers now, are what the afresh record uses.
- The "Not 46's" note above (a restore below the start) improves: the owner's clear now lets the next start point record
  afresh within 5 minutes. A gap check in between can still flag the book again.

Runs (one at a time):

| Test | Result |
|---|---|
| run_migration46 | 54 ok |
| run_migration45 | 90 ok |
| run_migration44 | 150 ok |
| run_migration_order | 119 ok (46's `tally_start_point` now asserted in force in both orders) |
| run_recorder_server (`DENO=/opt/deno/deno`, 46 added to its order) | 74 ok |
| run_main_bridge_server | 124 ok |
| run_bridge_control_server | 60 ok |
| `deno check` | clean |

md5 of the function bodies in 46 (the file's text between the `$function$` marks, equal to prosrc after it runs):

| Function | md5 |
|---|---|
| `tally_device_trial_tools` | `86245cc136112d0a014503871ea7ab24` (unchanged) |
| `tally_start_point` | `0e712617bafa07c99f4629bfb7074a83` |
