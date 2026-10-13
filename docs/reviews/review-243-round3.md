# FinCom Bridge 2.4.3 ("TDS challan details and TDS master settings from Tally"): review, round 3

- Reviewer: Claude (Claude Code), an independent reviewer. I did not write this code.
- Date: 12-Oct-2026
- Range 1 (bridge + cloud): `bd80c0cbe3f5c7e4ba6ec90040772f4d9ffa28d5..32e9419690df05942435f6283809b06c3912a967` (origin/next-tdsfields)
- Range 2 (app): `f4b15d9c58758bd10b76ace9645e870a6c9f4a0d...3986b3216a3246bec798a60c884bddbe9b285953` (origin/arc-ui...origin/app-tdsfields), limited to `src/js app/src tests`
  - The three-dot range's merge base is `f4b15d9c`, the same as in round 2. It is not arc-ui's current tip (`8c7da8f21bfbcdbb49340288f2fd8b52f03b3d4a`): arc-ui has moved on since app-tdsfields last merged it.
  - Merge `3986b32` changes nothing under `src/js app/src tests` beyond `fba04bf768e020cd03c161dd0e56e61d0aee9122`.

This was a read-only combined code and security review. No code branch was changed, and no database, Tally or artifact was touched. Line numbers below are on the branch heads above. Rounds 1 and 2 are on origin/review-243-r1 and origin/review-243-r2.

What I ran (in scratch worktrees of the two heads):
- `bridge-go`: `go vet . && go test -count=1 -run 'TDS|Tds|243|Nature|Size|Allow|Pin|Shape|Release' .` gave **ok** (12.8 s). I did not run the full suite.
- `node tests/run_parse_tdsfields.mjs` (next-tdsfields): **all ok**.
- On app-tdsfields: `python3 build.py` built `site/` and `site-test/` (exit 0). Then `node tests/run_tds_tally.mjs`: **all ok** (47 ok lines), including the new N1 to N5 cases.
- One throw-away probe on the `run_tds_tally.mjs` harness, on the real 7.1 entries. It was deleted afterwards and not committed. It is the evidence for R1, R2 and R3:
  - P1: a challan as `challanFromBooks` makes it for SP1, then `TDSTally.sync` → the challan is gone, `removed` = 1, no conflict, no disagreement, and K1 is not tagged.
  - P2: PX1 without its challan details → listed in the books' payments as `{tax: 10000, interest: 150, fee: 200}`, and no challan made.
  - P3: after sync, PX1's From Tally challan is dated 20261231 and PX1's voucher 20261202 → PX1 is still in the "Paid to the government, from the books" list.
- I did not run `run_migration73.py`, `run_recorder_server.py` or `run_e2e_tdsgst.py`.

## Findings

| Id | Severity | File:line | What | Why it matters | Fix |
|----|----------|-----------|------|----------------|-----|
| R1 | High | `src/js/72-tds-tally.js:209-213`; `src/js/27-firm-account.js:1103-1111` | `challanFromBooks` ("Make it a challan" on the Challans tab) has existed since before 2.4.3. It saves the challan a person types in (BSR code, serial, from a Tally payment) with `from: "tally"` and `fromVoucher`. The 2.4.3 sync treats every `from === "tally"` challan as one it made itself. The challan's key is not in Tally's answer when Tally has no challan details for that payment, and that is exactly when the button is offered. So an untagged one is **removed** on the next sync. Its `tallyWas` is missing, so the N5 "touched" check is false. Probe P1: the challan is gone, `removed` 1, nothing listed. The removal also runs before tagging, so Tally's link SP1→K1 is never used. A tagged one is kept, but with a false conflict: "no challan (the payment changed or is gone in Tally)". Where Tally does give the same key, `was` is `{}`, so every field counts as "untouched" and Tally's figures overwrite the person's. | A challan a person entered disappears without notice, and it happens on every books load (`TCloud.load` runs sync). On upgrade it also hits every untagged challan made this way before 2.4.3. That breaks the owner rule "FinCom-entered data never overwritten silently". The payment then shows up again as "not yet a challan", so the person goes round in a loop. | Mark only the challans the sync makes, for example by the `tally:` id prefix it already gives, or a separate `madeBy: "tally-sync"` flag. Remove, update or snapshot only those. Give `challanFromBooks` its own source (`from: "books"`) and treat it like a person's challan (the `have` / `other` paths). Add a test: a challan from `challanFromBooks`, then sync twice. It must still be there, and Tally's link must tag to it. |
| R2 | Medium | `src/js/27-firm-account.js:1109`; `app/src/screens/TdsReturn.jsx:119-127`, `:159-160`; `src/js/09-tds.js:174-175` | N1 residue. Since 2.4.3, `paymentsFromBooks` splits a marked payment into `{tax, interest, fee}`, and after N1 it also lists a payment of interest or fee alone with `tax: 0`. But the "Paid to the government, from the books" table shows only **Tax**. `challanFromBooks` then saves `tax: p.tax, interest: 0` and no fee. Probe P2 (PX1 before Challan Reconciliation fills its details) lists tax 10,000, interest 150 and fee 200. Making it a challan keeps 10,000 / 0 / 0. An interest-only payment becomes a challan of ₹0 tax and ₹0 interest. | A payment that Tally marks but has not reconciled yet is the common case: the type is set when the entry is made, and the challan details come later. The FVU's challan record then shows no interest and no fee for a challan that paid them. The deposit differs from OLTAS, and the 201(1A) interest and 234E fee look unpaid. A ₹0 challan is offered, and can be made, for an interest-only payment. | In `challanFromBooks`, carry `p.interest`, `p.fee` and `p.others` onto the challan. Show interest and fee as columns in the table. For a payment with tax 0, say it is interest or fee only. Add a test. |
| R3 | Low | `app/src/screens/TdsReturn.jsx:159-160` | The "not yet a challan" filter matches a payment to a challan by the **same date** and tax only. 2.4.3 dates a From Tally challan by Tally's challan date (`it.ch.date`), not the voucher date. It also never checks `c.fromVoucher === p.vid`. Probe P3: PX1 (voucher 02-Dec, challan 31-Dec, already a From Tally challan with `fromVoucher` PX1) is still proposed as a challan to make. | The person is invited to make a second challan for a payment FinCom already has. If they do, R1 removes it, or once tagged both stay: `byVid` then gives "the payment is 2 challans here", and the quarter's challan total counts the payment twice. | Drop a payment that any challan names in `fromVoucher`, and keep the date-and-amount match only for challans with no `fromVoucher`. Add a test with PX1. |

## Round-2 findings

- **N1 (interest-only payment read as tax): fixed in the sync. The manual path remains (R2).**
  - `split()` now returns tax 0 when every TDS line is marked interest, fee or others. It returns null only when more is marked than the TDS paid (beyond 0.5 paise).
  - `fromVouchers` makes a challan with tax 0 and the interest or fee. It refuses one only when there is no amount at all. `TDSCH.make` keeps tax 0.
  - `paymentsFromBooks` lists the payment with tax 0, so `TDSTie`'s `paidBooks` no longer counts the interest as tax.
  - A tax-0 challan cannot take tags (`TDSCH.tag` refuses beyond its balance), so its interest is never read as balance.
  - Test N1 passes.
  - Residue: the "Make it a challan" path drops the interest and fee (R2).
- **N2 (deduction reached by two payments / no date or FY guard): fixed.**
  - `links()` lists, and does not tag, a payment dated before its deduction, or one whose FY starts more than one year after the deduction's (`TDS.fyOf`).
  - A row reached by more than one distinct payment keeps one entry, with the reason "Tally pays it with N payments". The filter keeps that entry and drops the rest, so `want` never gets the row twice from different payments.
  - `many` and `why` entries go to `disagree` before tagging.
  - Tests N2 (two payments; payment two years on) pass.
  - Round 2 also suggested counting `tagged` by distinct rows. That is not done, but a row now reaches `want` from at most one payment, so the count is right in every case I could build.
- **N3 (194C's lone EXEMPTIONLIMIT as a year's limit): fixed.** For `single_or_annual`, Tally's figures are used only when both `EXEMPTIONLIMIT` and `SINGLEBILLVALUE` are filled (`72-tds-tally.js:181`). The real 7.1 captures fill only `EXEMPTIONLIMIT`, so FinCom's own limits are kept. Test 5 and e2e E8 now expect that.
- **N4 (bad challans not shown): fixed.** `TDSTally.bad()` reads `b.tallyTds.bad`. `TallyDiffs kind="challan"` lists each entry with its reason (`TdsReturn.jsx:39`), and the section now also shows when only bad entries exist. Test N4 passes. (The advice "Enter it by hand" leads to the R1 and R2 path.)
- **N5 (corrected challan or certificate removed when Tally changes): fixed for the challans and certificates the sync makes.**
  - A From Tally challan whose fields differ from `tallyWas` is kept and held, so no second challan is made, and a "details" conflict is listed.
  - A certificate a person corrected that Tally drops stays, with a "no longer in Tally" conflict.
  - Tests N5 pass.
  - Not covered: challans that carry `from: "tally"` but were never made by the sync (R1).
- **N6 (FinComLedgerChanges not measured): fixed.**
  - `f9e5a4f` gives FinComLedgers, FinComLedgerChanges, FinComLedgerByName and FinComTdsNatures `maxSec` and a `measuredOn` (runs 38164963591 and 38187902681, real TallyPrime 3.0–7.1, ZZ BIG TEST's masters and 20,000 ledgers).
  - FinComLedgerChanges: 268 ms worst over every 200-AlterID window. FinComLedgers: 316 ms per 2,000 chunk. All are well under the 2-second rule.
  - The dated line and the notes table carry the same figures, and the table hash is updated.
  - The request shapes are unchanged (489b40123c38, ff39bd6c3a79, bc7d2cc8353b, bf9f791176ee), so no Tally request changed. `maxSec` only feeds the doc table and the measured gate (`allowlist.go:235`, `:257`). It is not a runtime limit.
  - The allow-list tests pass.
  - Cosmetic: the table's measured column prints `%.1f` seconds, so 45 ms and 5.6 ms show as "0.0". The text beside it gives the real figures.

## Checked, no finding

- **Range 1 since round 2** (`a1a82b0..32e9419`):
  - Only `bridge-go/allowlist.go` (`maxSec` and `measuredOn` on four rows), `docs/tally-allowlist.md` (the dated line, four rows, the hash) and `docs/bridge-2.4.3-notes.md` changed.
  - No Go logic, cloud function, parse.js or SQL changed.
  - The decision line still names exactly the owner-approved fields.
  - The notes describe the app's behaviour correctly, except where R1 contradicts "a challan a person entered for the same payment is kept".
- **Migration 73, the cloud and parse.js**: unchanged since round 2. Add-only, `security definer` with a fixed `search_path`, RLS select by `firm_id = my_firm()`, size caps, no SQL built from input.
- **The N2 guard's edges**:
  - A payment on the same day as its deduction is tagged.
  - A payment in the next FY is tagged.
  - Several deductions plus one clean link from another payment stays listed, never tagged.
  - A stale other-year payment of the same ref also stops the real one being tagged. That is cautious, and it is listed, not silent.
- **N5 on key fields**: no screen edits a challan's BSR code, serial or date. `TDSCH.add` only fills missing fields, and the sync records a fee or others added that way as a conflict, not overwritten. So `FIELDS` without bsr/serial/date loses nothing today.
- **The FVU file** writes only challans with tagged deductions (`16-…js:29`), so a tax-0 From Tally challan never puts a ₹0 CD record in the file.
- **Owner rules**:
  - No AI in either range.
  - No new network destination.
  - The request path is unchanged, so each bridge reads only its own Windows user's Tally.
  - One request in flight per Tally: the natures are read inside the ledger round through the one gate (unchanged).
  - The 2-second rule holds on the measured worst cases.
  - Prospective only.
  - Add-only SQL.
  - The allow-list is pinned (decision line, hash, shapes unchanged).

Verdict: 1 High, 1 Medium, 1 Low.
