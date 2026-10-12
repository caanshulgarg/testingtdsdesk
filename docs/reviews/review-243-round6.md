# FinCom Bridge 2.4.3 ("TDS challan details and TDS master settings from Tally"): review, round 6

- Reviewer: Claude (Claude Code), an independent reviewer. I did not write this code.
- Date: 12-Oct-2026
- Range 1 (bridge + cloud): `bd80c0cbe3f5c7e4ba6ec90040772f4d9ffa28d5..9f656e88f5b122e7ab28ccd14f0d3fc72c58bc6b` (origin/next-tdsfields)
  - The head is as expected (`9f656e88f`). It is the same head as in round 5, so nothing in this range has changed.
- Range 2 (app): `8c7da8f21bfbcdbb49340288f2fd8b52f03b3d4a...e0f3a4be0d0161053528d91de87b005e8d96fb79` (origin/arc-ui...origin/app-tdsfields), limited to `src/js app/src tests`
  - The merge base is arc-ui's tip, `8c7da8f2`.
  - Since round 5's head (`cb1d0dc2c9f0332cc3116297a00938fd17b19412`), there is one commit: `e0f3a4be0d0161053528d91de87b005e8d96fb79` (the T1/T2 fix). It changes `src/js/09-tds.js`, `src/js/18-certificates-under-197-and-206aa-where-t.js`, `src/js/65-tds-challans.js` and `tests/run_tds_tally.mjs`.

This was a read-only combined code and security review. No code branch was changed, and no database, Tally or artifact was touched. Line numbers below are on the heads above. Rounds 1 to 5 are on origin/review-243-r1 to -r5.

What I ran (in scratch worktrees of the two heads):
- On app-tdsfields (`e0f3a4be0`):
  - `python3 build.py` exited 0.
  - `node tests/run_tds_tally.mjs` gave **all ok** (61 ok lines), including the new T1 (two cases) and T2 cases.
  - `node tests/run_booksync.js` gave **all passed**.
- `bridge-go` (`9f656e88f`): `go test -count=1 -run 'TDS|243|Release|Allow' .` gave **ok** (3.5 s).
- One throw-away probe on the `run_tds_tally.mjs` harness, on the real 7.1 entries. It was deleted afterwards and not committed. It is the evidence for U1:
  - Steps:
    1. Upload SP1's challan and run `TDSTally.sync`. K1 is tagged to Tally's challan (`ch19`) and marked "tally".
    2. `TDSCH.untag([K1])`. `allocFrom` becomes "off", and the sync lists K1 as "taken off Tally's challan … by hand: left off". This is correct.
    3. The person tags K1 by hand to another challan (`TDSCH.tag([K1], "ch20")`). `allocFrom[K1]` is **deleted**. The sync lists the disagreement. This is correct.
    4. The person untags K1 again. `allocFrom[K1]` is absent, so it stays absent.
    5. `TDSTally.sync`. Result: K1 is **tagged back to `ch19`**, `allocFrom` is "tally", `tagged` is 1 and nothing is listed for K1.
- I did not run `run_migration73.py`, `run_recorder_server.py`, `run_e2e_tdsgst.py` or the full Go suite.

## Findings

| Id | Severity | File:line | What | Why it matters | Fix |
|----|----------|-----------|------|----------------|-----|
| U1 | Low | `src/js/65-tds-challans.js:145` (`TDSCH.tag`; also reached by `confirm` and `confirmAllExact`); `src/js/72-tds-tally.js:283`, `:294` | **A hand tag still drops a person's "off".** T2's fix made the auto-tag (`09-tds.js:264`) and `untag` (`65:152`) keep "off". But `TDSCH.tag` still deletes `allocFrom[r.id]` whatever its value. So a deduction the person took off Tally's challan, then tagged by hand (or confirmed) to another challan, and then untagged again, has no mark. The next sync tags it back to Tally's challan, counts it in `tagged`, and lists nothing (probe steps 1 to 5). | This is the same silent reversal as round 4's S1 and round 5's T2, on the path untag, then tag elsewhere, then untag. That path is at least as common as T2's, because moving a deduction between challans is ordinary work. The tag is what the 26Q/27Q DD record reports. The owner's rule is "a tag never silently wrong". | In `TDSCH.tag`, delete the mark only when it is "tally", as `autoAllocate` now does: `if (b.allocFrom && b.allocFrom[r.id] === "tally") delete b.allocFrom[r.id];`. A row the person tags back to Tally's own challan then keeps "off". `:284` already leaves an existing mark alone, and `:283` needs `!cur`, so that row is neither re-marked "tally" nor listed. A later untag still keeps it off. The S1 "tagged again by the person" test and the S2 test still hold. Add the probe's five steps as a test. |

## Round-5 findings

- **T1 (allocFrom not in BOOKS_KEYS, so the untag was lost on reload and the sync re-tagged): fixed and complete.**
  - `"allocFrom"` is in `BOOKS_KEYS` (`18-…:164`), next to `alloc`.
    - So `saveBooks` (`:168`) keeps it in this browser.
    - `BookSync.keys()` (`41-books-sync.js:24`) sends it, because it is not in `FROM_TALLY`.
    - `BookSync.apply` (`:80-91`) brings it back. It is not in `MASTERS`, so a work part without it deletes it. That is right for work.
  - The blob merge (`41:45-58`) merges plain objects key by key. So `alloc[K1]` and `allocFrom[K1]` are merged independently, and a concurrent change to the same row's mark is a clash. The database copy is kept, and this browser's copy goes to `client_books_history` with the toast. Nothing is silently lost.
  - The item sync (`54-live-sync.js:31-46`, `put` at `:57`) takes keys from `BookSync.keys()`. So `allocFrom` is split into one item per row (`allocFrom` + `.rowId`). Row ids (`guid|ledger`) are well under `MAXI` (290). Latest-wins per item applies, as it does for `alloc`.
  - Neither `client_books` nor `client_book_items` restricts keys on the server (`jsonb`), so no SQL is needed.
  - Tests: both T1 cases round-trip through only `BOOKS_KEYS`. The first checks the untag stays off and is listed. The second checks that the "tally" mark survives, so an untag after a reload writes "off".
  - What is left (no finding): marks kept before this version are not saved, so an untag made before upgrading is not recovered. That is prospective-only and acceptable.
- **T2 (the auto-tag left marks, and an untag of an "off" row cleared it): fixed for the auto-tag and for untag. Not complete for the hand tag (see U1).**
  - `autoAllocate` (`09-tds.js:264`) deletes a "tally" mark on the rows it tags, so a person's auto-tag no longer shows From Tally. It keeps "off".
  - `untag` (`65:152`) writes "off" when the mark is "tally" or "off", and deletes any other mark.
  - The T2 test (sync, untag, auto-tag, untag, sync) passes, and K1 stays off.
  - If the auto-tag puts an "off" row back on Tally's own challan, `:284` keeps "off" and lists nothing. The person pressed Auto-tag and is told the count. This is the auto-tag's existing behaviour for any untagged row, so it is not a finding.
  - `TDSCH.tag` was not changed and still deletes "off" (U1).

## Checked, no finding

- **Range 1**: the head is unchanged since round 5. No Go logic, cloud function, parse.js, SQL or allow-list changed. The Go tests pass.
- **Every reader and writer of `alloc` / `allocFrom`** in the app range:
  - `TDS` rows read `alloc` for `challan` (`09:131`, `:153`).
  - The writers are `autoAllocate` (`09:256-264`), `TDSCH.tag` / `untag` (`65:143-152`), `challanDelete` (`27-firm-account.js:1100`), the sync (`72:210-294`), and the mark in the challan detail (`TdsReturn.jsx:178`, "tally" only).
  - The due-list cache key (`68-due-list.js:114`) reads `alloc` only. `allocFrom` does not change any due figure, so it does not need to be in the key.
  - `challanDelete` removes `alloc` and leaves `allocFrom`, as in round 5 (P3). A stale "tally" with no `alloc` is either re-tagged by Tally's own link (the round 1 behaviour, when Tally still keeps the payment's challan details) or ignored. A later hand tag clears it.
  - Stale `allocFrom` entries for rows that no longer exist are never read for a figure. They only add a few bytes per row.
- **`openBooks` without saved books** (`18:142`) starts without `allocFrom`. The sync (`72:210`) and `untag` / `tag` / `autoAllocate` all guard for that.
- **The rest of the app range** (72-tds-tally.js and its hooks in 04, 05, 09, 18, 27, 49, 65, 66, 67; TdsReturn.jsx) is unchanged since round 5 apart from `e0f3a4be0`. The round 1 to 5 conclusions stand. Challans, sections, certificates and thresholds are not affected by this commit.
- **Migration 73, the cloud and parse.js**: unchanged. They are add-only, `security definer` with a fixed `search_path`, with RLS select by `firm_id = my_firm()`, size caps, and no SQL built from input.
- **Owner rules**:
  - No AI.
  - No new network destination.
  - No Tally request changed.
  - Prospective only.
  - Add-only SQL (migration 73). T1's fix and U1's fix need none.
  - The allow-list is pinned.

Verdict: 0 High, 0 Medium, 1 Low.
