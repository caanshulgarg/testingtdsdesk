# FinCom Bridge 2.4.3 ("TDS challan details and TDS master settings from Tally"): review, round 4

- Reviewer: Claude (Claude Code), an independent reviewer. I did not write this code.
- Date: 12-Oct-2026
- Range 1 (bridge + cloud): `bd80c0cbe3f5c7e4ba6ec90040772f4d9ffa28d5..9f656e88f5b122e7ab28ccd14f0d3fc72c58bc6b` (origin/next-tdsfields)
  - The brief expected `32e9419690df05942435f6283809b06c3912a967`. The branch has one more commit since then: `9f656e8`, which changes only `docs/bridge-2.4.3-notes.md` (3 lines, the notes on the hand-made challan). I reviewed it as part of this range.
- Range 2 (app): `8c7da8f21bfbcdbb49340288f2fd8b52f03b3d4a...f87475a73b24e72d4c1b24f32009ff0cfead823f` (origin/arc-ui...origin/app-tdsfields), limited to `src/js app/src tests`
  - The merge base is now arc-ui's tip, `8c7da8f2`, because `f87475a7` merged it. Its parents are `98a356ee5baf3126487bdfd2489e0776aa34e92c` (the round-3 fix) and `8c7da8f2`.

This was a read-only combined code and security review. No code branch was changed, and no database, Tally or artifact was touched. Line numbers below are on the branch heads above. Rounds 1 to 3 are on origin/review-243-r1, -r2 and -r3.

What I ran (in scratch worktrees of the two heads):
- `bridge-go` (9f656e8): `go vet . && go test -count=1 -run 'TDS|Tds|243|Nature|Size|Allow|Pin|Shape|Release' .` gave **ok** (13.1 s). I did not run the full suite.
- `node tests/run_parse_tdsfields.mjs` (9f656e8): **all ok**.
- On app-tdsfields (f87475a): `python3 build.py` exited 0 and built `site/` and `site-test/`. Then `node tests/run_tds_tally.mjs`: **all ok** (53 ok lines), including the new R1, R2 and R3 cases.
- One throw-away probe on the `run_tds_tally.mjs` harness, on the real 7.1 entries. It was deleted afterwards and not committed. It is the evidence for S1 and S2:
  - P1: `challanFromBooks(SP1)`, then `TDSTally.sync`. K1 is tagged to it and `allocFrom` is "tally". `TDSCH.untag([K1])` leaves `alloc` empty, but `allocFrom[K1]` is still "tally". The next `TDSTally.sync` tags K1 to the same challan again: `tagged` 1, `disagree` [], `conflicts` [].
  - P2: after untagging, K1 is tagged by hand (`TDSCH.tag`) to another challan (00980). `allocFrom[K1]` stays "tally".
- I did not run `run_migration73.py`, `run_recorder_server.py` or `run_e2e_tdsgst.py`.

## Findings

| Id | Severity | File:line | What | Why it matters | Fix |
|----|----------|-----------|------|----------------|-----|
| S1 | Medium | `src/js/72-tds-tally.js:276-295` (`:283`, `:289`); `src/js/65-tds-challans.js:148-153`; `src/js/27-firm-account.js:1081-1082`, `:1089` | **The sync silently undoes a person's untag.** The tag step only looks at `b.alloc[row]` (`cur`). When a person takes a deduction off the challan Tally linked it to, using "untag" (`tdsAlloc(row, "")` or `tdsUntagMany`), the row's `alloc` is deleted. Nothing records that a person decided this. `allocFrom[row]` is left as "tally". On the next sync, `cur` is empty, so the row goes into `want` and is tagged back to Tally's challan. It is counted in `tagged`, and nothing goes into `disagree` or `conflicts` (probe P1). The sync runs on every cloud load that brings any change (`49-tally-cloud.js:326`), so in practice this happens the next time any entry of the company comes in. | A deduction-to-challan tag is what the 26Q/27Q file reports (the DD record under its CD record), so it is financial data. The owner's rule is "a tag never silently wrong; FinCom-entered data never overwritten silently". Here a person's correction ("this deduction is not paid by that challan", for example because Tally's Agst Ref is wrong) is reversed without notice. The person can only tell by noticing that the row is tagged again. If they had moved it to another challan, the sync leaves it alone and lists a disagreement (`:284-287`). Only "untag and leave untagged" is undone, for example while waiting for the right challan to be uploaded. | Record the person's untag of a row Tally linked: in `TDSCH.untag`, when `allocFrom[id] === "tally"`, set `allocFrom[id] = "off"` (or keep a `b.allocOff[id] = chId` set) instead of leaving "tally". In `sync`, skip a row marked "off" and push a `disagree` entry ("taken off Tally's challan by hand"). Clear the mark only when the person tags it again. Add a test: sync, untag K1, sync, and K1 must stay untagged and be listed. |
| S2 | Low | `src/js/65-tds-challans.js:134-147`, `:148-153`; `app/src/screens/TdsReturn.jsx:178`, `:183` | **The "From Tally" mark is shown on the person's data.** (a) `TDSCH.tag` and `TDSCH.untag` never clear `allocFrom`. A deduction Tally once tagged, and that a person then retagged by hand to another challan, keeps `allocFrom` "tally" (probe P2). So the deduction list (`:178`) shows the From Tally mark on the person's tag. (b) The challan list marks From Tally by `c.from === "tally"` (`:183`). A challan made with "Make it a challan" before 2.4.3 still carries `from: "tally"` (the R1 fix rightly treats it as the person's through `TDSTally.made`), so it is still labelled From Tally. 2.4.3 makes those with `from: "books"`, so new ones are not affected. | No figure is wrong, but the mark is what tells a person whose decision a tag or a challan is. For the person's own tag or challan, it says Tally made it. That hides what S1 and R1 are about, and someone checking the return may leave a wrong tag alone because they think it came from Tally. | Have `TDSCH.tag` and `untag` set or clear `allocFrom` for the rows they change, set by the person. In the challan list, mark From Tally by `TDSTally.made(c)` rather than `c.from === "tally"`. |

## Round-3 findings

- **R1 (hand-made challan treated as sync-made and removed or overwritten): fixed.**
  - `TDSTally.made(c)` (`72-tds-tally.js:128`) is true only for `madeBy === "tally-sync"` or an id starting `tally:`.
    - Every challan the sync makes gets both (`:265`).
    - Sync-made challans from earlier 2.4.3 builds, which have no `madeBy`, are still recognised by the id prefix.
    - `uid("ch")` never makes a `tally:` id, so a person's challan is never taken for a sync-made one.
  - Removal (`:220`), the update path (`:236`) and the "other" path (`:259`) all use `made()`. So:
    - A hand-made challan with no Tally challan details is kept, and Tally's link SP1→K1 tags to it (test R1, two syncs).
    - A hand-made challan with the same key as Tally's goes through the `have` path (`:252-256`): the person's figures are kept and the difference is listed (test R1, tax 9999 against 10000).
    - A hand-made challan under other details stops a second one being made, and a "details" conflict is listed.
  - `challanFromBooks` now saves `from: "books"` (`27-firm-account.js:1111`).
  - Pre-2.4.3 hand-made challans (`from: "tally"`, `ch…` id) are covered by `made()`. Their label is S2(b).
  - Complete for the data. The residues (S1, S2) are in the tagging step, not in R1's path.
- **R2 (making a challan from a marked payment dropped interest and fee): fixed.**
  - `paymentsFromBooks` now also carries `others` (`09-tds.js:175`).
  - `challanFromBooks` sets `interest: num(p.interest)`, and `fee` and `others` when they are non-zero (`27-firm-account.js:1110-1114`). For an unmarked payment they are undefined, so 0, as before.
  - The table has an "Interest and fee" column (interest + fee + others), and marks a tax-0 row "interest or fee only" (`TdsReturn.jsx:122`, `:166`).
  - Test R2 (PX1 without challan details → 10000 / 150 / 200) passes.
  - A tax-0 hand-made challan cannot take tags beyond its balance (`TDSCH.tag`), and the FVU writes only challans with tags. So, as with N1, a ₹0 CD record is never written.
- **R3 (a payment already a challan by `fromVoucher` proposed again): fixed.**
  - `TDSTally.notChallan` (`72-tds-tally.js:131-135`) drops any payment a challan names in `fromVoucher`. It keeps the date-and-tax match only for challans without `fromVoucher`. `TdsReturn.jsx:160` uses it.
  - Test R3 (PX1 voucher 02-Dec, challan 31-Dec) passes.
  - Side effect, checked: a payment with several Tally challans where one is `bad` (N4) is no longer proposed once the good one is made. Before, "Make it a challan" there would have saved the whole payment's tax a second time. The bad one stays listed in `TDSTally.bad()` for entry by hand. This is better than before, not a gap.

## The arc-ui merge (`f87475a`)

- It does not break TDS from Tally. `git diff 98a356e f87475a` touches no TDS file: `09-tds.js`, `65-tds-challans.js`, `66-tds-smart.js`, `67-book-sources.js`, `72-tds-tally.js`, `04-…`, `05-…` and `TdsReturn.jsx` are all unchanged by it.
- In the shared files, arc-ui's changes are elsewhere:
  - `27-firm-account.js`: sign-out cache clearing, sign-in opening state, sign-up info.
  - `49-tally-cloud.js`: `TLight` and `tallySign` status lights.
  - The cloud load path (`TCloud.load`: `naturesInto`, `HEADS_TDS`, `TDSTally.sync` after `LedMaster.refresh`) is as round 3 left it.
- `ORDER.json` still ends with `72-tds-tally.js`. `tests/ci/tests.txt` still lists `run_tds_tally.mjs`, `run_parse_tdsfields.mjs` and `run_migration73.py`.
- arc-ui's route-level code splitting (`app/src/screens/lazy.js`) loads `TdsPage`/`TdsReturn` lazily. They read `TDSTally` and `TDSCH` as globals from the main bundle, so this is unaffected. The build passes.

## Checked, no finding

- **Range 1 since round 3** (`32e9419..9f656e8`):
  - Only `docs/bridge-2.4.3-notes.md` changed.
  - Its new text matches the code: interest and fee are shown and carried, a hand-made challan is never changed or removed by the sync and Tally's link tags to it, and a named payment is not proposed again. (Its claim that the person's challan is kept holds for the challan. S1 is about its tags.)
  - No Go logic, cloud function, parse.js, SQL or allow-list changed. The decision line, the table hash and the request shapes are as in round 3.
- **The `have` path for a person's challan** compares tax, interest and fee, but not `others` or section (`72-tds-tally.js:255`). The person's figures are kept either way, so nothing is overwritten. A difference in others is just not listed. This is cosmetic and was there before round 3.
- **Certificates**: `certAdd` makes no `src`, so a person's certificate is never treated as Tally's. The round-2 N5 handling stands.
- **Migration 73, the cloud and parse.js**: unchanged since round 2. Add-only, `security definer` with a fixed `search_path`, RLS select by `firm_id = my_firm()`, size caps, no SQL built from input.
- **Owner rules**:
  - No AI in either range.
  - No new network destination.
  - The request path is unchanged, so each bridge reads only its own Windows user's Tally.
  - One request in flight per Tally (the natures are read inside the ledger round through the one gate).
  - The 2-second rule holds on the measured worst cases (round 2, N6).
  - Prospective only.
  - Add-only SQL (migration 73).
  - The allow-list is pinned: no Tally request changed in this round.

Verdict: 0 High, 1 Medium, 1 Low.
