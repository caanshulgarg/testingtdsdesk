# FinCom Books, phase 1: what is built (branch next-books-p1)

**Status:** built and tested on made-up books, **not applied or deployed anywhere**. The plan is
`docs/FULL-BOOKS-PLAN.md`. The owner's answers of 23-Nov-2026 are applied as listed below. The branch starts from
`staging-next` @ b64a6d398, with `next-full-books` merged in.

**What the owner gets:** each client has one set of books in FinCom, called FinCom Books, so anything about the client
can be fetched from FinCom alone. In phase 1 the books are a complete mirror of the client's Tally (or Zoho) company,
copied from FinCom's cloud copy and checked every night. The new page **Books › FinCom Books** shows the books. It is
read-only and has three tabs: trial balance, any ledger, and the day book. When the books do not match Tally, the page
shows a "Not in step" banner. The banner only warns: nothing is blocked.

## 1. The pieces

| Piece | Where | What it does |
|---|---|---|
| The store | `server/fincom-books/migration-220-fincom-books.sql` (draft) | The 29 `fb_*` tables of plan section 2. Groups are seeded with Tally's 28 reserved groups and Schedule III codes (Division I). Lines are kept per version: a change makes a new version, and the old lines stay. Nothing is ever deleted. RLS works by firm, and by book once a book names its people (`fb_grants`). Nobody may write a table directly, `service_role` included: every write goes through the functions. |
| The edit log | same file | `fb_audit_log` is written by AFTER triggers on every books table and chained by SHA-256 per book. UPDATE, DELETE and TRUNCATE are refused for every role, a superuser included, unless that superuser first switches the guard off. The nightly self-check (`fb_selfcheck`) checks that every trigger is on, verifies the whole chain, and checks that every voucher version has its log rows. If any check fails, the book turns read-only and the page says why. Each day's last hash is kept in `fb_audit_anchors`. |
| D3 | same file, `fb_vouchers_guard` | A posted own-books voucher can change only as a new version, with a reason. The version before is kept whole in `fb_voucher_versions`, and the reason goes into the edit log. Cancelling also needs a reason. |
| Commit rules | same file, constraint triggers deferred to COMMIT | These run even for a superuser's direct insert: Dr = Cr to the paisa; at least two lines unless the voucher is a memo; and, for own entries, cost-centre parts and bill references must add up to their line. |
| The mirror builder | same file: `fb_land_*` triggers, `fb_mirror_dirty`, `fb_mirror_catchup*`, `fb_mirror_state` | **FinCom Books follows the copy within 10 minutes** (owner decision 23-Nov-2026, after the measured cost of the same-transaction design). Six landing tables (`tally_vouchers`, `tally_lines`, `tally_bills`, `tally_cost_allocs`, `tally_ledgers`, `tally_groups`) get new **statement** triggers that only **note** what changed in `fb_mirror_dirty` (one row per book and entry or master, with the time first noted and a `seq`). They wait at most 200 ms for any lock and never fail the copy's write; an update that changes nothing notes nothing; the caller's `lock_timeout` is put back. **Nothing is mirrored at COMMIT**; no existing function of the Tally path is replaced; only books the firm set up are noted. The catch-up (`fb_mirror_catchup_run`, every 3 minutes, a short transaction per book and chunk of 500) mirrors the notes, and removes a note only if it was not noted again meanwhile (`seq`), so a change made while the catch-up works is never dropped. An entry it cannot mirror stays noted and is logged. If a landing trigger cannot even note (for example `fb_books` locked), it writes a `missed` row naming the copy's books; if even that fails, it ticks the sequence `fb_missed_seq`. Either way the catch-up then compares every entry of that book's window by its content (the sweep). A sweep covers exactly the misses open when it starts, so a change missed behind the sweep's position starts the next sweep and is not lost. |
| Building a book | `fb_enroll` (owner or staff), `fb_mirror_catchup` (timer: `fb_mirror_catchup_run`, one transaction per book) | The book is mirrored from the start of the previous financial year (D20). Older entries are carried into the openings exactly: Tally's opening plus every older entry. Set up only enrols the book ("being built"; migration 218, 23-Nov-2026: building inside the click passed the 8-second limit of the signed-in role on a book of 7,300 entries); the catch-up builds every book, masters and openings first, in chunks of up to 5,000 entries a run, and the page shows "Building: n of m entries" until it is done. Run 218 after 220, and again after any re-run of 220. |
| The tie-out | `fb_tieout`, `fb_tieout_all` (nightly), `fb_tieout_ask` (on request, D21) | Compares FinCom Books with the copy: ledger by day, entries by type and month, openings, any opening difference, held entries and mirror errors. It also compares with Tally's own group closings once they are read (see section 3). Every difference is named. The words name the group that differs ("Sundry Debtors differs by ₹4,200.00"), and "since" is kept from the first time a difference was seen. |
| D18 | `fb_filing_warning` | Gives `{warn, block: false, words}` for a client and period. It never blocks a filing. |
| D7 | `fb_opening_signoff` | A difference in opening balances keeps the book "Not in step" until the owner accepts that exact amount, with a reason, per book. The reason is kept on the book and in the edit log. |
| D19 | status `sent` | An entry FinCom sent to Tally that has not come back yet is left out of every total and the tie-out, and is listed with its count. It is written from P3 onwards. |
| The readers | `fb_status`, `fb_tb`, `fb_ledgers`, `fb_ledger`, `fb_daybook`, `fb_audit_verify` | Members of the firm, under RLS. Every figure is recomputed from the entries each time. |
| Timers | `server/fincom-books/migration-220-cron.sql` (draft) | Catch-up every 3 minutes (`call fb_mirror_catchup_run(5000)`); tie-out at 02:17 IST; self-check at 02:43 IST. These are database jobs only: no edge function, and nothing is asked of Tally. |
| The page | `app/src/screens/fbooks/FinComBooks.jsx` + `fbooks.css` (its own lazy chunk), with the sidebar entry and books tab `books:fb` | Status banner, trial balance (primary groups with their Schedule III line, which open into ledgers), ledger (running balance; for a party ledger, its pending bills and ageing from the ported rules) and day book (each entry with its status; the totals count posted entries only). On a client without FinCom Books, the owner gets a "Set up FinCom Books" button. |
| Ported rules | `app/src/lib/fbooks/rules.js`, `THIRD_PARTY_NOTICES.md` | Independent Books' amount parsing, GST half-split, blank state = IGST, and bill-wise rules (New / Against / Advance / On Account, stable ids, over-allocation, wrong party, opposite side, ambiguous names, the residual, ageing boundaries). They are rewritten for whole paise, a debit positive and the invoice's place of supply. |

**Sign.** In `fb_*` a debit is positive and a credit negative (plan section 2). The copy keeps Tally's own sign, where a
credit is positive, as `tally_calc_bal` states. The mirror therefore negates every amount and opening. The tests prove
every ledger equals the copy with the sign turned.

## 2. Tests (made-up books only)

| Test | What |
|---|---|
| `tests/run_migration220.py` | 116 checks on pg_stand. They cover the guard and a second run; grants (no direct writes for anyone); enroll; masters; D20 openings; the mirror equal to the copy; the same-transaction cases (commit, rollback, version 2, deletion, back in Tally, rename/merge, an older-year change moving the openings, a mirror failure that does not fail the copy's write); the commit rules; the edit log (every role refused, a tampered row named by its seq, a disabled trigger making the book read-only); D3; the tie-out with D18, D7, the TODO hook and D19; RLS; and the readers; and the review fixes of 23-Nov-2026 (section 7). `FB_BIG=20000`: 20,000 entries mirrored in 49 s, and the tie-out takes 0.4 s. |
| `tests/run_fbooks_rules.mjs` | 55 checks: the ported Independent Books cases, each naming the original test. |
| `tests/run_fbooks_ui.py` | 26 checks. The page in the built app, end to end against the real SQL. The test replaces `TCloud.rpc`, so each call the page makes runs in a throwaway Postgres as the owner, staff or a look-only member; the page has no test hook. Covers the banner, trial balance, ledger and bills, day book, Check now, set-up, phone width and the lazy chunk. `FB_SHOTS=dir` saves the screenshots. |
| `tests/fbooks_fixture.mjs` | The made-up books: GST sales and purchases, bill-wise, cost centres, an optional entry, a cancelled one, one off by a paisa, and one with no lines. |

## 3. The new Tally reads: TODO hooks only (D16)

The owner said yes to new Tally reads, but each exact request is shown to him first. Another worker drafts them for
bridge 2.5.19. **This branch adds no bridge request and changes no bridge file.** P1 runs on what the copy holds
today. Each future read has a marked place to land:

| Read (plan section 3.4) | Hook here | Until then |
|---|---|---|
| Primary-group closing balances, for the tie-out against Tally | `fb_source_figures` + `fb_source_figures_put(book, 'group_closing', as_on, {group: closing})` (service role). `fb_tieout` compares as soon as figures are there; this is tested with made-up figures | The tie-out compares against the copy only. The page says "Tally's own trial balance is not read yet". |
| Voucher-type masters | `fb_vtype_base` / `fb_vtypes.mirror_note` | A type the user made ("Sales – Delhi") has base `unknown`. Tally's own type names map exactly. |
| Cost-centre and category masters | `fb_cc_id` (`mirror_note`) | Centres are named from the entries' allocations, under "Primary Cost Category" when none is given. |
| Opening bill-wise | `fb_bill_refs` (new references at the window's start) | Parties' openings are not bill by bill. The page's pending bills say the difference is the opening. |
| Post-dated flag | a `memo`-style status, out of the totals | Not distinguished. If one exists, the tie-out shows it as a difference. |
| Registrations (multi-GSTIN) | `fb_registrations` | The voucher keeps its GSTIN and place of supply in `gst`. |
| Missing ledger fields (bill-wise, credit days, MSME, address) | `fb_ledgers` columns are there | Left empty. |

## 4. To apply on staging (the coordinator, after review)

1. **D12, before the first own-books client** (not needed for mirrors): confirm that the Supabase project's region and
   backups are in India (Companies (Accounts) Rules, rule 3(5) proviso).
2. `sbq.sh server/fincom-books/migration-220-fincom-books.sql`. It is add-only and safe to run twice; it stops, naming
   the clash, if a name is already used. It needs the copy's migrations (32, 57, 75).
3. `sbq.sh server/fincom-books/migration-220-cron.sql`. The catch-up job is `call public.fb_mirror_catchup_run(5000)`
   every 3 minutes (a procedure that commits after each book and chunk; pg_cron runs it as the database owner).
4. Publish the app build with the page. Nothing changes for anyone until the owner or staff press "Set up FinCom
   Books" for a client.
5. Run a 30-day trial per plan A10 on a few staging clients: the tie-out at ₹0.00 every night, and each "Not in step"
   explained.

No edge function changes. No change to the bridge, legacy.js or any existing report.

## 5. Risks and notes for the reviewer

- **Cost on the Tally path: now negligible (owner decision 23-Nov-2026, changed: within 10 minutes).** Measured with
  the reviewer's `bench.py` (a made-up book of 19,500 entries, 500 new entries a day, this container): a day's ingest
  takes **0.11 s with the book set up**, against 0.10 s for a book not set up and 0.08 s with no migration 220. (The
  same-transaction design cost 2.9 s here.) The work moved to the catch-up, off the copy's path: about **3.3 s per
  500-entry day** (a run after three days' backlog took 13.2 s); the same three days sent again unchanged cost the copy
  0.05 s each and the catch-up 5.6 s in all (each entry compared by content and found the same).
- **"Updating" and "Not in step".** `fb_status` gives each book `behind_since`, `behind_minutes`, `late` (behind by
  more than 10 minutes) and `mirrored_at` (the catch-up's last run). The page says "Updating…" (with the last update
  time) within 10 minutes and "Not in step" beyond; the filing warning (D18) also warns when a book is late. The
  nightly and asked tie-outs first mirror what is noted, so they compare like with like.
- **Transition tables.** The statement triggers keep the changed rows of a landing statement in memory while it runs
  (Postgres's own mechanism).
- **The whole chain is verified nightly.** This takes time linear in the book's log rows (3.5 s for 84,705 rows in
  the bench), plus a check of every current row against the log's last record of it. Anchors are kept, and copying them outside the
  database is a later step (plan 2.6 point 4).
- **A superuser can still switch a trigger off.** The self-check then finds it and the book turns read-only. Tampering
  is evident; it is not impossible (plan 2.6 point 4).
- **Mirror figures are the source's.** An entry whose Dr and Cr differ in the copy is kept as **held**: shown, never
  added, and named by the tie-out. Nothing is "fixed".
- **`fb_filing_warning` is ready but not yet shown on the GST and TDS filing pages.** Showing it there is part of the
  report switch (`docs/FINCOM-BOOKS-REPORT-SWITCH.md`, step 0), because the filing pages are legacy code with almost no
  size budget left.

## 6. Open questions for the owner

1. **Answered 23-Nov-2026 (changed after the measured 2.8 s): FinCom Books follows within 10 minutes**, not in the
   same transaction. The copy's write now costs about the same as for a book not set up (section 5).
2. **Bridge 2.5.19's reads (D16).** Once you approve each request, the group-closing read plugs into
   `fb_source_figures_put` with no further SQL.
3. **Answered 23-Nov-2026: staff may set up FinCom Books too** (`fb_enroll` checks `can_write()`; a look-only member
   cannot). Accepting an opening difference (D7, `fb_opening_signoff`) stays with the owner only.

## 7. The review of 23-Nov-2026: what changed

| Finding | Fix | Test |
|---|---|---|
| B1: a failed flush lost its keys; a change with no new AlterID (the copy's rename) was never repaired | (now) every change is a note that stays until the catch-up mirrors it; a `missed` change starts the sweep by content | `run_migration220.py` 5 (B1), 12 (B2); reviewer's `recover.py`: 69 entries repaired |
| B2: the landing probe waited on `fb_books`; a re-run of 220 took ACCESS EXCLUSIVE locks | the probe is inside the exception block with a 200 ms lock wait; a re-run skips existing indexes, triggers, RLS and policies | 12; reviewer's `rerun.py`: only AccessShare / ShareUpdateExclusive held, the copy write commits at once |
| Flush lock waits; catch-up in one transaction | (now) no flush at all: nothing on the copy's path takes the mirror's locks, sets a lock_timeout it does not put back, or needs `query_canceled` caught; `fb_mirror_catchup_run` commits per book and chunk; locks in one order (per book in book_id order, the mirror lock, then the edit-log lock) | 12; reviewer's `conc.py` S1–S7 all commit |
| Bulk statements | (now) every statement only notes; `fb_status` counts what is waiting | 12 |
| Self-check | every guard trigger (incl. the landing triggers, `fb_vouchers_guard`, `fb_check`, `fb_keep`, `fb_lines_guard`); per-book exception in `fb_selfcheck_all`; every current row against the log's last record | 7 |
| D3 | a posted voucher cannot go back to draft; no lines added to a posted current version without a new version | 6, 8 |
| Cost centres | each cost category adds up to the line; the copy's `line_no` puts a split on the right line | 5, 6 |
| Actor label | put back after the mirror, tie-out, self-check and set-up | 12 |
| Name guard | each landing trigger name, index names, policy names | 1 |
| `client_info` | members read the edit log without it; the owner reads it through `fb_audit_client_info` | 2, 12 |
| Attribution in the chunk | `rules.js` starts with a `/*! ... @license MIT */` comment, kept in the built chunk | `run_fbooks_ui.py` 7 |
| `window.__fbDemo` | removed; the UI test replaces `TCloud.rpc` | `run_fbooks_ui.py` 7 |
| Second review (1): a sweep resolved misses that arrived after it passed their entry | a sweep covers exactly the misses open when it starts (`fb_mirror_state.sweep_covers`); a later one starts the next sweep | 12 (review 1); `recover3.py` |
| Second review (2): the landing trigger's fallback swallowed its own failure | if even the `missed` row cannot be written, `fb_missed_seq` ticks; the next catch-up sees it moved and sweeps | 12 (review 2) |
| Second review (3): the flush's `lock_timeout` and `query_canceled` on the copy's path | the flush is removed; the landing trigger puts the caller's `lock_timeout` back (`recover3.py` (b): 0 stays 0) | `recover3.py` |
| Second review (6): a book-less miss swept every enrolled book | the miss names the copy's books (from the trigger's own rows); only their FinCom books are swept; every book only when it names none | 12 (review 6) |

**Removed rather than kept unused:** `fb_flush`, `fb_flush_trg`, `fb_land_cap`, `fb_sync_cap` and the table
`fb_mirror_txn`. The migration has never been applied anywhere, so removing them carries no risk, while keeping dead
commit-time code would invite someone to switch it back on. New: `fb_mirror_state` (the mirror's bookkeeping, kept out of
`fb_books` so it does not fill the edit log every 3 minutes), `fb_missed_seq`, `fb_behind_since`, `fb_mirror_failed`.

### Round 3 of the review (23-Nov-2026)

| Finding | Fix | Test |
|---|---|---|
| B1: a `missed` row named at most 5 copy books, so a statement over more lost the rest | more than 5 copy books: the row names none (`''`), and every enrolled book is swept | 12 (round 3 B1); `conc3.py` C |
| (1) a member's tie-out ran a catch-up of up to 20,000 entries | asked tie-outs (and the opening sign-off) catch up at most 500; still behind: "Updating", nothing stored; the page shows that answer | 12 (round 3 (1)) |
| (2) one subtransaction per entry (and per edit-log row) | a chunk is one subtransaction (`fb_mirror_list`); on a failure it is split in halves until the failing entry is alone; the edit log works out the request's client details once per transaction | 12 (round 3 (2)): 250 entries, 1 subtransaction, no overflow (before: 64, overflowed) |
| (3) the note's row lock held through the scans | the mirrored notes are deleted right after they are mirrored, before the AlterID scan and the sweep; the runner commits each chunk of 500 | (structural) |
| The same day sent again notes every entry | not changed: deciding "unchanged" needs the entry's content hash, which is the work the copy's path no longer does. The catch-up compares and finds them the same (5.6 s for three such days, off the copy's path) | `bench.py` |

**TODO before P4 (own-books entry), from round 3 (5):** the D3 guard's "voucher opened in this transaction" list
(`fincom.fb_open`) and the edit log's actor and reason (`fincom.fb_actor`, `fincom.fb_reason`) are session settings.
Nothing reaches them from outside today (no write path through PostgREST), but before own-books writes exist they must move
to a transaction-local table keyed by txid, written only by the posting functions, so that no caller can set them.

### Round 4 of the review (23-Nov-2026)

| Finding | Fix | Test |
|---|---|---|
| A poison entry (fails every time) counted as progress, so the runner looped on its book and later books got nothing | `done` counts only entries actually mirrored; the runner goes round-robin across the books, each pass giving every busy book an equal share (50 to 500 entries) and dropping a book when a chunk mirrors nothing; every call costs at least 1, so a run always ends | 12 (round 4); `poison.py`: one run 0.4 s, book 1 39 of 39, book 3 30 of 30 (before: 0 of 30) |
| The failed entry was tried again in every chunk | it waits for `fb_mirror_errors.retry_at` (3 minutes, then doubling, at most an hour; `tries` counted); it stays noted, so the book counts as behind and turns "Not in step" after 10 minutes | 12 (round 4) |
| The masters were re-mirrored every chunk while any error was open | the masters are compared once when a sweep starts (a change may have been missed), not for a failing entry | 12 (round 4) |

Re-review of round 4: the backoff's exponent is capped (`3 minutes × 2^min(tries, 5)`, at most an hour; before, tries
36 overflowed the interval and the book's catch-up failed for good; tested at tries 40); an entry noted again (put right
in Tally) has its retry time cleared, so the next run tries it; the runner's start book turns by one a minute, so no book is
always last; a book's failed run keeps one open 'run' error, counted; `tries` and `retry_at` are added to an older table
only when missing (no lock on a re-run).

Final check before applying: the runner's start book turns once per 3-minute run (not per minute); a book's 'run'
error is cleared by its next catch-up call that works, even while entries still wait; an entry's wait is cleared only when
it is noted with an AlterID other than the one it failed with (`fb_mirror_errors.src_alter`), or when its rows really
changed, so the same day sent again unchanged keeps the backoff; the trigger skips an error row the catch-up has locked
(`for update skip locked`), so a copy write never waits for it.

**Note:** `fb_audit_log.seq` can have gaps. A chunk that fails is rolled back and retried in halves; the sequence values
its edit-log rows took are not given back (`poison.py`: 669 values for 410 rows). This is expected: the chain links each
row to the one before it by hash, not by consecutive numbers, and it verifies.
