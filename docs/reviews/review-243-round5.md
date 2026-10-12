# FinCom Bridge 2.4.3 ("TDS challan details and TDS master settings from Tally"): review, round 5

- Reviewer: Claude (Claude Code), an independent reviewer. I did not write this code.
- Date: 12-Oct-2026
- Range 1 (bridge + cloud): `bd80c0cbe3f5c7e4ba6ec90040772f4d9ffa28d5..9f656e88f5b122e7ab28ccd14f0d3fc72c58bc6b` (origin/next-tdsfields)
  - The head is as expected (`9f656e8`). Nothing has changed since round 4. Since round 3's `32e9419690df05942435f6283809b06c3912a967`, only `docs/bridge-2.4.3-notes.md` changed (3 lines).
- Range 2 (app): `8c7da8f21bfbcdbb49340288f2fd8b52f03b3d4a...cb1d0dc2c9f0332cc3116297a00938fd17b19412` (origin/arc-ui...origin/app-tdsfields), limited to `src/js app/src tests`
  - The merge base is arc-ui's tip, `8c7da8f2`.
  - Since round 4's head (`f87475a73b24e72d4c1b24f32009ff0cfead823f`), there is one commit: `cb1d0dc2c` (the S1/S2 fix). It changes `src/js/65-tds-challans.js`, `src/js/72-tds-tally.js`, `app/src/screens/TdsReturn.jsx` and `tests/run_tds_tally.mjs`.

This was a read-only combined code and security review. No code branch was changed, and no database, Tally or artifact was touched. Line numbers below are on the heads above. Rounds 1 to 4 are on origin/review-243-r1 to -r4.

What I ran (in scratch worktrees of the two heads):
- `bridge-go` (9f656e8): `go vet . && go test -count=1 -run 'TDS|Tds|243|Nature|Size|Allow|Pin|Shape|Release' .` gave **ok** (11.0 s).
- On app-tdsfields (cb1d0dc): `python3 build.py` exited 0. `node tests/run_tds_tally.mjs` gave **all ok** (57 ok lines), including the new S1 and S2 cases.
- One throw-away probe on the `run_tds_tally.mjs` harness, on the real 7.1 entries. It was deleted afterwards and not committed. It is the evidence for T1 and T2:
  - P1 (T1):
    - `BOOKS_KEYS.includes("allocFrom")` is **false**.
    - Steps: upload SP1's challan, `TDSTally.sync`, then `TDSCH.untag([K1])`. This gives `allocFrom[K1] = "off"`.
    - Then I kept only `BOOKS_KEYS`, as `saveBooks` does, loaded that copy as `S.books`, and ran `TDSTally.sync`.
    - Result: K1 is **tagged back** to the same challan, `allocFrom` is "tally", `tagged` is 1, and `disagree` is [].
  - P2 (T2):
    - Steps: sync, then `untag([K1])` ("off"), then `TDS.autoAllocate()`. That tags K1 to a challan, and `allocFrom` stays "off".
    - Then `untag([K1])`. `allocFrom` is deleted.
    - Then `TDSTally.sync`. K1 is tagged back, `allocFrom` is "tally" and `tagged` is 1, with nothing listed.
  - P3 (no finding): deleting the challan Tally's link tagged K1 to (as `challanDelete` does) and syncing does not re-tag K1. SP1 has no challan details in Tally, so the sync makes no challan for it.
- I did not run `run_migration73.py`, `run_recorder_server.py`, `run_e2e_tdsgst.py` or the full Go suite.

## Findings

| Id | Severity | File:line | What | Why it matters | Fix |
|----|----------|-----------|------|----------------|-----|
| T1 | Medium | `src/js/18-certificates-under-197-and-206aa-where-t.js:164`, `:168`; `src/js/41-books-sync.js:24`; `src/js/65-tds-challans.js:152`; `src/js/72-tds-tally.js:210`, `:283` | **The S1 fix does not survive a reload.** The "off" mark that keeps a person's untag is kept in `S.books.allocFrom`. But `allocFrom` is not in `BOOKS_KEYS`, so: <ul><li>`saveBooks` never writes it to this browser's store (`:168`);</li><li>`BookSync` never sends it to `client_books` (`keys()` is `BOOKS_KEYS` less the Tally parts).</li></ul> `alloc` is saved and shared; `allocFrom` is not. After the app is reopened, or on a colleague's computer, the untagged row has no `alloc` and no "off". The next `TDSTally.sync` (`49-tally-cloud.js:326`, which runs on any cloud load that brings a change) tags it back to Tally's challan. It counts it in `tagged` and lists nothing (probe P1). There is a second path to the same result: "tally" is lost on reload too. If a person untags a Tally-tagged row after a reload, but before a sync has marked it "tally" again, `untag` deletes rather than writes "off", and the next sync re-tags it. The From Tally mark (`TdsReturn.jsx:178`) also disappears after a reload until a sync runs. | This is round 4's S1, the silent reversal of a person's decision on a tag that the 26Q/27Q DD record reports, in the ordinary case. A person untags today; the next session or the next Tally change tags it back. The new test passes only because it never saves and reloads the books. The owner's rule is "a tag never silently wrong; FinCom-entered data never overwritten silently". | Add `"allocFrom"` to `BOOKS_KEYS`. It is work, like `alloc`. `client_books` keeps the work as `jsonb`, so no SQL is needed, and the three-way merge handles a new object key. Add a test that does the P1 steps (sync, untag, keep only `BOOKS_KEYS`, load that, sync) and checks that K1 stays untagged and is listed. |
| T2 | Low | `src/js/09-tds.js:256-262` (`TDS.autoAllocate`, the "tdsAuto" action at `27-firm-account.js:1767`); `src/js/65-tds-challans.js:152` | **The auto-tag leaves the "off" mark on a row it tags, and the next untag then clears it.** `autoAllocate` writes `b.alloc[r.id]` directly and never touches `allocFrom`. A row the person took off Tally's challan ("off") is a candidate (it has no challan). After the auto-tag, the row is tagged with `allocFrom` still "off". If the person then untags it, `untag` sees "off", which is not "tally", so it deletes the mark. The next sync then tags it back to Tally's challan without notice (probe P2). The same direct write leaves a stale "tally" on a row whose challan was deleted and that the auto-tag then puts on another challan, so the person's auto-tag shows From Tally. | This is the same harm as S1 on a less common path: untag, then auto-tag, then untag. It also puts a wrong From Tally mark on a person's tag (the S2 point). | In `autoAllocate`, put rows through `TDSCH.tag`, or delete `allocFrom[r.id]` where it writes `alloc`. Also, in `untag`, keep an existing "off" rather than deleting it: write "off" when the mark is "tally" or "off". |

## Round-4 findings

- **S1 (the sync re-tagged a deduction a person had untagged from Tally's challan): fixed within a session; not complete. See T1 and T2.**
  - `TDSCH.untag` (`65-tds-challans.js:152`) turns `allocFrom` "tally" into "off".
  - The sync (`72-tds-tally.js:283`) skips a row with no `alloc` and "off", and lists it ("taken off Tally's challan … by hand: left off"). It is checked before `cur === ch.id` and before `want`, so it is never tagged back.
  - A hand tag (`TDSCH.tag`, `:145`) clears the mark. If the person tags it to Tally's challan again, the sync marks it "tally" (`:284`). If they tag it elsewhere, it is listed as a disagreement.
  - The sync's own tagging goes through `TDSCH.tag` (which clears the mark) and then sets "tally" (`:294`), so that order is right.
  - Tests S1 (three steps) pass.
  - The mark is not saved or shared (T1), and the auto-tag can clear it (T2).
- **S2 (the From Tally mark on a person's tag, and on pre-2.4.3 hand-made challans): fixed, with the T1/T2 residues.**
  - (a) `TDSCH.tag` deletes `allocFrom` for the rows it tags. This covers the person's tag, `confirm` and `confirmAllExact` (all through `tag`).
  - (b) The challan list marks From Tally by `TDSTally.made(c)` (`TdsReturn.jsx:183`), so a `ch…` challan with `from: "tally"` from before 2.4.3 is not marked.
  - The certificate list still marks by `c.src === "tally"` (`:648`). This is correct, because `certAdd` makes no `src`.
  - Residues: `autoAllocate` does not clear the mark (T2), and the mark is lost on reload (T1).

## Checked, no finding

- **Range 1**:
  - The head is unchanged since round 4. Only the 2.4.3 notes changed since round 3, and they match the code.
  - No Go logic, cloud function, parse.js, SQL or allow-list changed. The decision line, the table hash and the request shapes are as in round 3.
  - The Go tests pass.
- **The "off" check's placement** (`72-tds-tally.js:283`):
  - It comes after the `l.why`, `l.many` and `chs.length !== 1` branches. Those either list the row or skip it, and never tag it, so "off" cannot be bypassed there.
  - A row marked "off" whose Tally link later points to another payment is still listed, not tagged. That is acceptable, because it is listed.
- **Deleting a challan** (`challanDelete`, `27-firm-account.js:1098-1102`) leaves `allocFrom` as it was (probe P3).
  - When Tally keeps that payment's challan details, the sync makes its own challan again and tags to it. That is Tally's link, not a person's untag, and it has been the behaviour since round 1.
  - When Tally does not keep the details, nothing is re-tagged.
- **`TDSTally` in the lazily loaded `TdsReturn`**: it is used as a main-bundle global, as `disagreements`, `conflicts`, `bad` and `notChallan` already are. The build passes.
- **The rest of the app range** (72-tds-tally.js and its hooks in 04, 05, 09, 27, 49, 65, 66, 67; TdsReturn.jsx): unchanged since round 4 apart from `cb1d0dc`. The round 1 to 4 conclusions stand. Challans, sections, certificates and thresholds are not affected by this commit.
- **Migration 73, the cloud and parse.js**: unchanged. They are add-only, `security definer` with a fixed `search_path`, with RLS select by `firm_id = my_firm()`, size caps, and no SQL built from input.
- **Owner rules**:
  - No AI.
  - No new network destination.
  - No Tally request changed: each bridge reads only its own Windows user's Tally, with one request in flight per Tally, and the 2-second rule holds on the measured worst cases.
  - Prospective only.
  - Add-only SQL (migration 73).
  - The allow-list is pinned.
  - T1's fix needs no SQL.

Verdict: 0 High, 1 Medium, 1 Low.
