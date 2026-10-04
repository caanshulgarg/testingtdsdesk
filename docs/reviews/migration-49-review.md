# Migration 49 (post row flags): database and security review

Branch `tax-accuracy`, commit `5a07103`. This review is read-only: this note is the only file written. It covers:

- `server/tally-cloud/migration-49-post-row-flags.sql`: the table `tally_post_row_flags` and the functions
  `tally_post_row_keys`, `tally_post_row_hide`, `tally_post_row_remove` and `tally_post_row_restore`.
- The callers: `app/src/screens/Post.jsx` (`EntryRow`, `postRemoveAsk`, `EntryList`) and `PostFlags` /
  `postRowRemoveBlock` / `postTabRows` in `src/js/62-post-reasons.js`. That file is where the row keys are built
  (lines 468 and 478) and the RPCs are made (lines 527-529). `src/js/59-post-preview.js` does not call migration 49
  directly; it only reads `postTabRows` for its counts (lines 301 and 333).

## Test run (once)

`python3 tests/run_migration49.py`: **all passed** (43 checks).

The suite runs on pg_stand (PG16, with a stand-in `my_firm()` that has no MFA check and no Supabase default
privileges), so the Supabase-only grant points in L3 are not exercised.

md5 of each function body, computed from the file's own text between the `$function$` marks. Each one equals
`md5(pg_proc.prosrc)` after the run.

| Function | md5 |
|---|---|
| `tally_post_row_keys` | `3831b16f2f7c70d28d8f8bcf145cce8a` |
| `tally_post_row_hide` | `7186f4cde96126d3e5a6cae2f7c04017` |
| `tally_post_row_remove` | `3b1eeead338a93e34e784bfddabc6e9c` |
| `tally_post_row_restore` | `c9e8e6994ceba85b280fc034e29b463b` |

---

## Findings

No High findings.

### M1. A removed row can become a live posting again, and it stays hidden in "Removed"

- **Where:** `migration-49-post-row-flags.sql:101-106`. The live check runs only when the row is removed.
  `src/js/62-post-reasons.js:542` hides every row that has a remove flag in force, whatever its job's status is now.
- **Scenario:** Retry (`tally_post_enqueue` with the same id, `migration-36b-post-acceptance.sql:370-377`; also
  `migration-24-posting-guard.sql:34`) moves a `failed`/`cancelled` job back to `waiting` **under the same job id**.
  1. A member removes the Errors row `J2:B2` (job failed). This is allowed.
  2. Someone presses Post again on another row of the same job, `J2:B5`, or on `J2:B2` itself before the list
     refreshes. The job goes `waiting` -> `running` -> `done`.
  3. `J2:B2`'s row is now being posted, or has been posted, but it stays under "Removed" for every member. In that
     view its actions are suppressed (`Post.jsx:307`, `acts = []`) and its More menu is not shown (`Post.jsx:339`).
  4. The same gap exists as a race. There is no lock on `tally_post_jobs` between the check at line 104 and the
     insert at line 108, so a Retry committed in between leaves a live row removed.
- **Impact:** Visibility only. No posting is cancelled and no id is freed. But a posting that goes on, or a new failure
  that needs attention, is hidden from the whole firm. That is the case "removing never cancels a posting" was meant to
  rule out.
- **Fix (add-only friendly):**
  - Client: in `postTabRows`, do not treat a row as removed while `postRowRemoveBlock(x)` is true. Also ignore a remove
    flag whose `at` is older than the job's latest restart (`job.updated_at` when the status left failed/cancelled, or
    `attempts`).
  - Better, a later migration: store the job's `attempts` (or `updated_at`) on the flag when it is removed. Have the
    reader, or a view, ignore flags whose job has restarted since.

### M2. "Owner only for Remove all" holds per call only; any member can restore any removed row

- **Where:** `migration-49-post-row-flags.sql:99-100` and `:122-123`. The gate is `cardinality(ks) > 1`.
- **What it does:** Any active member may remove **one** row per call and restore **one** row per call. Only the
  number of keys in one call is limited to owners.
  - A staff member can therefore remove every row with N single calls. The per-row Remove button is shown to staff
    (`Post.jsx:343-344`).
  - A staff member can also restore, one at a time, rows that an **owner** removed with "Remove all". The per-row
    Restore button is shown to everyone (`Post.jsx:341`). Nothing checks who removed the row.
- **Matches the spec?** It matches the file header's stated rule ("any member for one row, an owner for more", lines
  12 and 15), and the UI follows it: "Remove all" and "Restore all" are owner-only (`Post.jsx:381-382`). But the rule
  is a UX limit, not an authorisation boundary, and an owner's bulk removal is not protected from staff. Rated Medium
  only because the flag is soft and audited (`user_id`, `restored_by`). If "owner only" is meant as a real control:
  - Let a non-owner restore only a remove they made themselves (`and (is_owner or user_id = auth.uid())` on line 125).
  - Optionally, rate-limit or count removes per member and day.

### L1. The entry part of a key, and `local:` keys, are never checked

- **Where:** `:63-67`.
- **Scenario:** `"<own job uuid>:anything"` and `"local:anything"` are accepted. This keeps the firm boundary: the
  job must be the caller's firm's, and `firm_id` always comes from `my_firm()`, never from the key. So **another
  firm's keys cannot be used** (tested: "not a posting of your firm"). But a member can:
  - create flags for rows that do not exist;
  - remove a `local:` row with no live check on the server. Only the client's `postRowRemoveBlock` (code 4/5)
    protects a bill being posted straight to a bridge.
- **Fix:** For job keys, check that the entry id is in the job (`payload->'vouchers'` / `results` / `items`). Accept
  that `local:` rows cannot be checked on the server, and say so in the header.

### L2. Postgres internal error text for a malformed job id

- **Where:** `:65`.
- **Scenario:** `'^[0-9a-fA-F-]{36}$'` accepts 36 hyphens, or 36 hex digits with no hyphens. Then `j::uuid` raises
  `invalid input syntax for type uuid: "..."` (22P02) instead of the function's own words. That is minor information
  about the internals, and the toast shows it to the user.
- **Fix:** Use the strict pattern `'^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$'`.

### L3. Grants left over under Supabase default privileges

- **Where:** `:46-48`, `:72`.
- **Table:** Only insert, update, delete and truncate are revoked from `authenticated`, so it keeps `REFERENCES`,
  `TRIGGER` and, on PG17, `MAINTAIN`. None is reachable through PostgREST, but this is not "select only".
- **`tally_post_row_keys`:** It is revoked from public, anon and authenticated, but `service_role` keeps EXECUTE
  through Supabase's default privileges. So it is "callable by nobody" except the service role and the owner. That is
  harmless: it only reads, and it has no firm without a user JWT.
- **Fix:** On the table, `revoke all ... from authenticated; grant select ... to authenticated` (as L8 of
  migration-47-48). On the function, add `service_role` to line 72's revoke if "nobody" is meant literally.

### L4. "Hide all" / "Remove all" over 500 rows fail as a whole

- **Where:** `:59`. The callers are `Post.jsx:380-382` and `62-post-reasons.js:527-529`.
- **Scenario:** The Posted tab easily lists more than 500 rows. "Hide all", "Remove all" and "Restore all" send them
  in one call, so the call is refused with "at most 500 rows at a time" and nothing happens.
- **Fix:** Batch in chunks of 500 on the client.

### L5. The table grows without bound

- **Where:** `:79-86`, `:107-111`, `:124-125`.
- **Scenario:** Every hide/show or remove/restore cycle adds a row, because restored rows are kept. Unchecked
  `local:` keys (L1) let a member add up to 500 rows per call without limit.
- **Fix:** Accept it (it is an audit trail), or add a retention job in a later migration. A `delete from` cannot go in
  this add-only file.

### L6. The client turns the feature off on unrelated errors

- **Where:** `src/js/62-post-reasons.js:491` and `:521`.
- **Scenario:** `missing()` matches any message that names `tally_post_row_hide|remove|restore` or contains "does not
  exist". An error such as "permission denied for function tally_post_row_remove" sets `PostFlags.ok = false` for
  the session, and the buttons disappear with a "migration 49" toast.
- **Fix:** Match only `42883`, `PGRST202` or "Could not find the function".

---

## Pass/fail table

| Check | Result | Note |
|---|---|---|
| Add-only (no drop, no alter of an existing object) | **Pass** | Test plus reading |
| No `delete from` text | **Pass** | |
| Runs twice | **Pass** | The policy is made once (`pg_policies` guard), and every create uses `if not exists` or `or replace` |
| `begin; set local lock_timeout = '10s'; ... commit;` | **Pass** | |
| security definer + `search_path = public, pg_temp` (all 4) | **Pass** | |
| Grants: revoked from public and anon; hide/remove/restore to authenticated only | **Pass** | L3 (service_role, leftover table privileges) |
| `tally_post_row_keys` callable by nobody | **Pass** (with note) | Revoked from public, anon and authenticated; service_role keeps it on Supabase (L3) |
| RLS: members read the firm's removes and only their own hides | **Pass** | `firm_id = my_firm() and (kind = 'remove' or user_id = auth.uid())`; my_firm needs `active` and MFA |
| RLS: no direct writes | **Pass** | insert, update and delete are denied (tested) |
| The firm check cannot be bypassed with another firm's keys | **Pass** | The job must be `firm_id = f`; `firm_id` comes from `my_firm()`; the entry part is unchecked (L1) |
| "Remove all" (more than one key) owner only | **Pass** per call; **design gap** | M2: single calls in a loop, and restore of an owner's removal by staff |
| A row whose posting is waiting, taken, running or checking cannot be removed | **Pass** at the time of removal; **Fail** over time | M1: Retry makes the same job live again under a remove flag; `local:` rows are unchecked on the server (L1) |
| Nothing touches `tally_post_jobs` / `tally_post_ids` / `tally_post_marks` / entries | **Pass** | Read only; md5 of the three tables is unchanged (tested); no reference to entries |
| A removed row's FinCom id is never freed; `tally_post_enqueue` still refuses the bill | **Pass** | Tested: B1 is still live and accepted; enqueue refused it and queued nothing |
| Restore only by members of the firm | **Pass** | Any member restores one row (whoever removed it); owner for more than one (M2) |
| Unique indexes with restore and re-remove | **Pass** | The partial indexes leave a row once `restored_at` is stamped; re-remove inserts a new row and the history is kept; ON CONFLICT names the index predicate exactly; a duplicate key in one call counts once |
| Error text leaks internals | **Pass** (minor) | Messages echo the key the caller sent (at most 80 characters); an existing and a missing other-firm job give the same answer (no oracle); malformed uuid gives a 22P02 (L2) |
| Callers (`Post.jsx`, `62-post-reasons.js`) | **Pass** (with notes) | Keys match the server format; the client's block mirrors the server's live check; L4 and L6 |
