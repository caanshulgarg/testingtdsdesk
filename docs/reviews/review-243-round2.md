# FinCom Bridge 2.4.3 ("TDS challan details and TDS master settings from Tally"): review, round 2

- Reviewer: Claude (Claude Code), an independent reviewer. I did not write this code.
- Date: 12-Oct-2026
- Range 1 (bridge + cloud): `bd80c0cbe3f5c7e4ba6ec90040772f4d9ffa28d5..a1a82b0f7c8cec86aa55cacce18b2b8e3bad1ca8` (origin/next-tdsfields)
- Range 2 (app): `f4b15d9c58758bd10b76ace9645e870a6c9f4a0d...a8aed05a2486f2717f36e49dc2a073f226780c35` (origin/arc-ui...origin/app-tdsfields, merge base = arc-ui), limited to `src/js app/src tests`

This was a read-only combined code and security review. No code branch was changed, and no database, Tally or artifact was touched. Line numbers below are on the branch heads above. Round 1 is `docs/reviews/review-243-round1.md` on origin/review-243-r1.

What I ran (in scratch worktrees of the two heads):
- `bridge-go`: `go vet . && go test -count=1 -run 'TDS|Tds|243|Nature|Size|Allow|Pin|Shape|Release' .` gave **ok** (15.2 s). That includes `TestAllowListUnchanged`, `TestRelease243VersionAndDecisionLine` and `TestRelease242VersionAndDecisionLine`, which failed in round 1. I did not run the full suite (about 17 min).
- `node tests/run_parse_tdsfields.mjs` (next-tdsfields): **all ok**, including the new L1 and L2 cases.
- On app-tdsfields: `python3 build.py` built `site/` and `site-test/`. Then `node tests/run_tds_tally.mjs`: **all ok** (the round-1 regression cases H2, H3, H4, M1, M2, M3, L4 and L6 all pass).
- Two throw-away probes on the same harness (deleted afterwards, not committed). They are the evidence for N1 and N2 below.
- I did not run `run_migration73.py`, `run_recorder_server.py` or `run_e2e_tdsgst.py`.

## Findings

| Id | Severity | File:line | What | Why it matters | Fix |
|----|----------|-----------|------|----------------|-----|
| N1 | Medium | `src/js/72-tds-tally.js:76-77`, `:110`; `src/js/09-tds.js:172-174` | When the only TDS line on a payment is marked by Tally as **Interest** (or Late Fee), `split()` works out tax = 0 and returns `null`. `fromVouchers` then falls back to `tdsPaid`, so the challan is made "From Tally" as **tax 150, interest 0**. `paymentsFromBooks` also lists the payment as tax 150. Probe: PX1 with one line, Interest −150 → challan `[150, 0, null]`, payment `{tax: 150}`, nothing in `bad`. | A separate challan for interest only (minor head 200, interest under 201(1A)) is a common payment. Tally marks it as interest, and FinCom ignores that mark. The FVU challan record then shows TDS deposited of ₹150 that is really interest. The challan also gets ₹150 of "balance" that can be tagged to deductions. This is the opposite of what M1 was meant to fix. | When `kinds` are present and every TDS-paid amount is marked non-tax, return `{tax: 0, interest, fee, others}` and make the challan with tax 0 and the interest and fee; `TDSCH.make` accepts tax 0. Fall back to `tdsPaid` only when no line carries a mark. In `paymentsFromBooks`, show such a payment as interest or fee, not as tax. Add the case to `run_tds_tally.mjs`. |
| N2 | Medium | `src/js/72-tds-tally.js:139-144`, `:249-266`; `src/js/65-tds-challans.js:139-145` | `links()` decides "exactly one deduction" per payment, but never checks how many payments reach the same deduction. It also never checks that the payment is dated on or after the deduction, or that both fall in the same or next FY. When two payments' Agst Ref reach one deduction, both land in `want`. `TDSCH.tag` re-tags a row that is already on another challan (it filters only `r.challan !== chId`). Probe B (K1 reached by SP1 and SP2, each challan large enough): in one sync K1 is tagged to SP1's challan, then **moved** to SP2's. `res.tagged` = 2 for one row and `disagree` is empty. The disagreement only appears on the next sync. | The final tag depends on iteration order and is marked "From Tally", with nothing shown on that sync. Round 1 (H2) also asked for an FY guard. Without one, an April payment whose Agst Ref is last March's "1" (that deduction not in the books) links to this year's deduction "1" of the same party and duty ledger. It is tagged to the wrong year's challan and never flagged. (Partial payments that each fit only part of the deduction are refused and listed correctly. I checked that.) | Group links by row. If a row is reached by more than one payment, tag none of them and list it ("Tally pays it with N payments"). Skip a link whose payment date is before the deduction's date, or more than one FY after it, and list it. Count `tagged` by distinct rows. Add both cases to the tests. |
| N3 | Medium | `src/js/72-tds-tally.js:161-171`; `src/js/66-tds-smart.js:285-287`; `tests/run_tds_tally.mjs:109` | For a `single_or_annual` rule (194C), Tally's `EXEMPTIONLIMIT` replaces FinCom's **year's** limit whenever it is lower. In both real 7.1 captures (`7.1/natures.xml.gz` "FC Contract 194C" and `tdsm-7.1/natures-all.xml.gz` "FM Contract 194C"), the 194C nature has `EXEMPTIONLIMIT` 30000.00 and `SINGLEBILLVALUE` blank. So the 30,000 is the single-bill figure, sitting in Tally's one filled field. The app reads it as a ₹30,000 yearly limit. Test 5 asserts the result: a contractor paid ₹50,000 in the year, no bill over ₹30,000, is "over". | Under 194C(5), no TDS is due there (the aggregate limit is ₹1,00,000). The limits tracker shows TDS due, 201(1A) interest and a 30% disallowance figure that are not owed. The "only where stricter" rule means that whenever a Tally master holds the bill figure in its one field, it always wins. The "(Tally: …)" label gives the source, but the figures are still wrong. | For `single_or_annual`, use Tally's figures only when **both** `EXEMPTIONLIMIT` and `SINGLEBILLVALUE` are filled. Otherwise show Tally's figure beside FinCom's and do not use it. Correct test 5's expectation, and add the real-capture case (EXEMPTIONLIMIT 30,000, SINGLEBILLVALUE blank, ₹50,000 in the year) as "not over". |
| N4 | Low | `app/src/screens/TdsReturn.jsx:31-40`; `src/js/72-tds-tally.js:297` | The challans Tally keeps that FinCom could not make (`res.bad`, the M3 fix: "listed for a person") are stored in `b.tallyTds.bad`, but nothing reads them. `TallyDiffs` shows only `disagreements()` and `conflicts()`. | A multi-challan payment whose share is unknown still appears under "Paid to the government, from the books". But the person is never told that Tally has its challan details, or why FinCom did not make them. The M3 fix is incomplete on screen. | Add a `bad()` reader and list the entries in `TallyDiffs kind="challan"` ("Tally's challan … not made: …"). |
| N5 | Low | `src/js/72-tds-tally.js:194-196`, `:296` | An untagged challan "From Tally" is removed as soon as its key is not in Tally's current answer, even when a person corrected it (`tallyWas` differs from the challan). It is then re-made from Tally's figures, and the correction is lost. The same happens to a certificate from Tally that a person corrected, once Tally drops or renumbers it. Besides a real change in Tally, this also happens while the entry's newer version has no `tdsx` (`BookSrc.tdsxOf` needs `tds_tally_alter_id` = `alter_id`). | A person's entry is lost without notice, which goes against the M2 and L4 rule. The tags are safe, because only untagged challans are removed. | Remove only when no field differs from `tallyWas` (the person never touched it). Otherwise keep it and push a `conflicts` entry "Tally no longer gives this challan / certificate". |
| N6 | Low | `docs/tally-allowlist.md:31`, `:35`, `:75`; `docs/bridge-2.4.3-notes.md:59-72` | H1 residue: `FinComLedgerChanges` (shape ff39bd6c3a79) is a changed row, but no measurement is recorded for it. The dated line and the notes table cover FinComTdsNatures, FinComLedgerByName, FinComLedgers and FinComVoucherObject only. The decision line still says the three ledger requests "ask … every field given back as made … (checks m1 to m3)". | The pinned allow-list should give a measured worst case for each changed request. The risk is small: the same fields as FinComLedgers, at most 200 rows. But the record is incomplete until the running tdsm measurement lands. | When the running `tally-versions tdsm` run finishes, add FinComLedgerChanges' worst ms per release to the dated line and the notes table. If the doc carries a measured figure, fill the row's measured column too. |

## Round-1 findings

- **H1 (allow-list doc and measurement): fixed, one measurement outstanding.**
  - The doc now has the 2.4.3 decision line. It names exactly the owner-approved fields: the 30 challan fields kept by the strip only (FinComVoucherObject's request is unchanged, ce0e72f74e72); TDSRATENAME, TDSDEDUCTEEISSPECIALRATE/SPECIALRATE and the LOWERDEDUCTION details on the three ledger requests; and FinComTdsNatures with the section, rates, EXEMPTIONLIMIT and SINGLEBILLVALUE.
  - The four rows have new shapes and there is a new table hash. The dated re-measured line cites run 38164963591 on 3.0–7.1 and ZZ BIG TEST's masters. The worst case is 280 ms for a 2,000-ledger chunk, against 247 ms with 2.4.2's fields.
  - The release and allow-list gates pass.
  - Outstanding: the FinComLedgerChanges measurement (N6).
- **H2 (links by ref name alone): partly fixed.** Both sides are now keyed by ref, party and duty ledger. The nature must agree. Several deductions under one key are listed and none is tagged. The other party's same ref is not tagged; the test passes. Not fixed: the FY/date guard round 1 asked for, and a deduction reached by two payments, which is silently re-tagged (N2).
- **H3 (challans never follow corrections / duplicates): fixed.** Existing "From Tally" challans are checked against `fromVoucher` and Tally's current keys. An untagged challan follows the correction, and only one is kept. A tagged one is kept with a "details" conflict, and no second challan is made (the `held` set). A cancelled payment's untagged challan leaves. `keyOf` and `kOf` agree, because `TDSCH.make` keeps the serial as digits padded to 5. Residual: N5.
- **H4 (thresholds across sections and monthly limits): partly fixed.**
  - Fixed: the nature's section must equal the rule's (`TDS.sec`). `monthly` (and `always` / `never`) bases are never touched. Tally's figure is used only where it is lower.
  - Not fixed: what Tally's single `EXEMPTIONLIMIT` means for 194C. The real captures put the bill figure there, so the "stricter" rule makes a wrong "TDS due" (N3).
- **M1 (tax 0 when only interest is marked): partly fixed.** The tax is now TDS paid minus the marked interest, fee and others on duty ledgers, so an unmarked tax line counts (test M1). A payment that is only interest is now booked as tax instead (N1).
- **M2 (a person's edits overwritten): fixed.** The `tallyWas` snapshot is kept per field. A field is updated only if it is untouched, and a conflict is listed otherwise. The tax is never lowered below `challanUse`. Removal (N5) is the one path that still loses an edit.
- **M3 (multi-challan interest and fee lost, zero-tax challans): fixed in code.** Interest, fee and others go by nature to the one challan of that nature. Otherwise the whole payment goes to `bad`. A challan with no tax is not made, and nor is one with `paid: null` beside others. The tests pass. `bad` is not shown anywhere (N4).
- **L1 (BSR cut before digits): fixed** (`parse.js:184`, with a test).
- **L2 (another duty's stat payment): fixed.**
  - parse.js gives no `tdsx` for a non-TDS/TCS `STATPAYMENTTYPE` without TDS refs (with a test, and TCS is kept).
  - The app's `isTds()` guards `split`, `fromVouchers` and `links`.
- **L3 (certificate and nature dates): fixed.** `index.ts` puts the certificate from/to and the nature's APPLICABLEFROM through `d8`, with a recorder-server test for "1-Apr-2026" and "31-Mar-27".
- **L4 (certificate overwritten): fixed** through the same `tallyWas` rule. Removal: N5.
- **L5 (error regex): fixed.** Only PGRST202, 42883 or "could not find the function public.tally_ingest_natures" counts as "migration 73 is not applied". Anything else throws.
- **L6 (sync on another company's books): fixed.** `sync(b)` returns `skipped` when `b !== S.books`, and the rest runs synchronously.

## Checked, no finding

- **Bridge code since round 1.** Only `release242_test.go` changed: its regex follows the reworded 2.4.2 line. The rest of round 1's "checked" list still holds:
  - natures are read inside the ledger round through the one gate, so one request is in flight and the list is never held;
  - the upgrade from 2.4.2 and 11-column rows behave as before;
  - the blank-drop in the strip is unchanged;
  - the XML filters use the existing helpers.
- **Migration 73** is unchanged since round 1. It is add-only, with `security definer` and a fixed `search_path`, RLS select by `firm_id = my_firm()`, and size caps. I found no SQL injection path.
- **Cloud.** `ledTds` and the natures' `d8` only rewrite the date columns, so a value that does not read as a date becomes "" (tested). The narrowed L5 check now throws on real ingest faults, so they are no longer hidden.
- **App, other items checked.**
  - `split` counts only marked lines on the duty ledgers it subtracts, so an "Interest on TDS" ledger outside `tdsPaid` does not reduce the tax.
  - Partial payments (two payments of ₹1,000 against one ₹2,000 deduction) are refused by `TDSCH.tag` and listed. I checked this by probe.
  - A FinCom tag is never moved by sync (`cur` set → `disagree`).
  - A person's section (`byHand` / `ok`) stays.
  - `LedMaster` prefers the nature's section and gives its source.
  - `TCloud.load` falls back cleanly on a cloud without the 73 columns (`HEADS_TDS` → `HEADS_GST`, `tds_*` select → the old select, `naturesInto` → leaves what is held).
  - `tdsxOf` uses `tds_tally` only at the entry's own AlterID.
- **Owner rules.**
  - No AI anywhere in either range.
  - No new network destination.
  - Each bridge reads only its own Tally, because the request path is unchanged.
  - Prospective only: kept voucher files are untouched, and `tds_tally` is written only onto the version just stored.
  - Migration 73 is add-only.
  - The allow-list is pinned: hash, decision line, and only the approved fields, with no other Tally request changed. The one gap is the FinComLedgerChanges measurement (N6).

Verdict: 0 High, 3 Medium, 3 Low.
