# FinCom Bridge 2.4.4 ("payroll and salary TDS from Tally"): review, round 5

- Reviewer: Claude (Claude Code), an independent reviewer. I did not write this code.
- Date: 12-Oct-2026
- Range: `ac37face07dca03f01dfeda3566e2b06e99022a5..718d4343dd6fd3d0f199c0a499dbb32cb8083168` (Range 1, bridge + cloud, origin/next-payroll)
  - The head is as expected (`718d4343d`). New since round 4 (`9baf43d1112f0fdedb129cfee957968f2792b0e3`): `718d4343dd6fd3d0f199c0a499dbb32cb8083168` only.
  - `git diff 9baf43d1112f0fdedb129cfee957968f2792b0e3 718d4343dd6fd3d0f199c0a499dbb32cb8083168` touches one file, `bridge-go/release_check_test.sh` (3 lines changed). `server/` and every other `bridge-go` file are byte for byte as in round 4.
- Range: `dbce3b97d887ee2c72cc089444680006e1efac3e...dc5ffde86ed5bce2fee40ff3f76a37da432f76e6` (Range 2, app: origin/arc-ui...origin/app-payroll, limited to `src/js app/src tests`)
  - The merge base is arc-ui's tip, `dbce3b97d`. The head is as expected (`dc5ffde86`), a merge of `3a1a872a4df8dd3ac8b2067f012ff1c638a66326` and next-payroll `718d4343d`.
  - Since round 4 (`df49f7b45b36e032959e33a530bfdad7fdad199e`), the only change in these paths is `tests/run_e2e_payroll_real.py` (`3a1a872a4`, 3 lines added and 2 removed). The merge itself adds nothing else, and outside these paths it brings in only Range 1's `release_check_test.sh`.
- Rounds 1 to 4: origin/review-244-r1 to -r4 (`docs/reviews/review-244-round{1..4}.md`).

This was a read-only combined code and security review. No code branch was changed, and no database, Tally or artifact was touched. Line numbers refer to the heads above.

What I ran (in scratch worktrees of the two heads):
- On next-payroll (`718d4343d`), in `bridge-go`:
  - `go vet . && go test -count=1 -run 'Payroll|Pay244|Employee|244|Allow|Pin|Shape|Release|Ledger|Fast|Day|Keep|Cloud|Round10' .` Vet was clean, and the tests printed **ok** (123.7 s).
  - `bash release_check_test.sh` exited 0 and printed **release_check_test: all cases as expected**. That includes `PASS green 5: 2.4.4 with the real decision line ... passes check 4 (exit 0)` and `PASS red 14: the line re-measured before the last release row's date (exit 1)`.
- On app-payroll (`dc5ffde86`):
  - `python3 build.py` exited 0.
  - `node tests/run_tds_tally.mjs` printed **all ok**.
  - `python3 tests/run_e2e_payroll.py` (Postgres 16 through `tests/pg_stand.py`, port 30745) printed **ALL OK: 0**.
  - `python3 tests/run_e2e_payroll_real.py` printed **ALL OK: 0**. Its server ran on port 30746: `/tmp/fincom-pg-30746` was created next to `/tmp/fincom-pg-30745`.
- Not run: the full Go suite, `run_parse_payroll.mjs`, `run_payroll_ingest.py`, `run_upload_split.py`, `run_payroll_ui.py` and `run_migration74.py`. Their code is unchanged since round 4, which ran the first three green.

## Findings

| Id | Severity | File:line | What | Why it matters | Fix |
|---|---|---|---|---|---|
| — | — | — | No new finding. | — | — |

## Round-4 findings

Both are still open in 2.4.4, and the code they cite is unchanged (`server/` has no diff since `9baf43d11`). As the brief says, they are recorded for the owner and the next release. I agree that neither is High or Medium.

- **R4-L1 (an open bank allocation at a piece's end carried in the archived tail): open, Low.**
  - The code is still at `server/tally-cloud/index.ts:2542` and `parse.js:545-557`.
  - At most one employee's bank details per 4 MB boundary that falls inside a salary payment can reach `pgmq.a_tally_work`.
  - The fix in round 4's table still applies: end the piece before an unclosed `<BANKALLOCATIONS.LIST`.
- **R4-L2 (an upload whose `upload_done` never succeeds is never removed): open, Low.**
  - The code is still at `index.ts:2652-2697` and `src/js/49-tally-cloud.js:1122-1143`.
  - The fix in round 4's table still applies: sweep unsealed upload jobs older than about 24 h, and retry a failed `remove`.
  - `docs/bridge-2.4.4-notes.md` item 3 should not claim more than the code does. The file is removed when a job ends, and an abandoned upload never ends.

## The new commits

- **`718d4343d` (`bridge-go/release_check_test.sh:148-155`): correct.**
  - "green 5" and "red 14" now use `withver 2.4.4`.
  - "green 5" expects `allowed for 2.4.4 by the owner's decision of 2026-10-12`. That is the text of `docs/tally-allowlist.md:31`, the first `^First table:` line, which `L231` greps. The self-test therefore runs check 4 against the decision line this release really ships.
  - "red 14" is still the same case: the re-measured line dated 2026-10-08, against a release row moved to 2026-10-09. It still fails for the expected reason ("before the last release").
  - No other case changed, and nothing in the checker itself changed.
- **`3a1a872a4` (`tests/run_e2e_payroll_real.py`): correct.**
  - `PGE2EPAY_PORT` defaults to 30746 unless the caller set it. `run_e2e_payroll.py:73` reads it, and `pg_stand.start` (`tests/pg_stand.py:56-60`) names the data folder by port (`$TMPDIR/fincom-pg-<port>`). The real run therefore no longer meets the folder of `run_e2e_payroll.py`'s own run (30745), which was the CI failure named in the commit.
  - No other test uses 30745 or 30746 (`git grep`).
  - The docstring now contains `pg_stand`. `tests/ci/run_ci.sh:92` (`grep -q "pg_stand" "$t"`) then runs this script under `sudo`, as it runs the other pg_stand tests. The `postgres` user must own the folder, so that is required.
  - Both changes are to tests only. Nothing in what the app or the bridge does changed.

## Checked, no finding

- **Nothing changed since round 4 outside the two commits.**
  - Range 1: `git diff 9baf43d11 718d4343d` is `release_check_test.sh` only.
  - Range 2: `git diff df49f7b45 dc5ffde86 -- src/js app/src tests` is `run_e2e_payroll_real.py` only.
- **Owner rules, given a final look on the heads:**
  - **Bank fields.** `fastvch.go`'s `liveKeepPay244` keeps exactly `BANKEMPLOYEENAME` and `AMOUNT`, and only in a bank allocation that names an employee (`fastNamesEmployee`, `fastOKNoPay`). `fastNeverPay244` refuses `ACCOUNTNUMBER`, `IFSCODE` and `PAYMENTFAVOURING` before any approval is looked up. `keep.go:273` puts every day-file entry through `dropBankDetails`.
  - **Time limits.**
    - `payrollLimitMs()` (`payroll.go:373-375`) is capped at 3,000 ms whatever `PayrollLimitMs` says.
    - `entryTC` (`payroll.go:464-471`) raises the limit only for a background entry request at the ordinary limit whose voucher type is `Payroll` or a learned payroll type.
    - `payrollLearn` never learns one of Tally's own types (`tallyBaseTypes`, Payment and Journal included), and it caps the learned types at 50 per company.
    - `slowNote` (`slowco.go:234-236`) uses the longer limit only for an entry request whose own limit lies between the 2-second rule and 3 s.
    - Every other request keeps 2 s, and one request is in flight as before.
  - **FinComEmployees.** The request is in `requestClass` as undated (`tally.go:330`). `tally_employees` (`migration-74-payroll.sql:35-52`) holds only the twelve fields' data (with GUID, MasterID and AlterID). It has no date of birth, Aadhaar or bank column, and no second id.
  - **Migration 74 is add-only and follows the RLS patterns.**
    - It only adds columns with `add column if not exists` and tables with `create table if not exists`.
    - RLS is on for both new tables. Each has a select-only policy on `firm_id = public.my_firm()`. `public`, `anon` and `authenticated` lose every grant and get back select only, and `service_role` gets all.
    - `tally_ingest_salpay` and `tally_ingest_details` are security definer with `search_path = public, pg_temp` and are granted to nobody. That matches 57, 62, 72 and 73.
    - `tally_ingest_employees` is granted to `service_role` alone.
    - Nothing in it is dropped or deleted.
  - **The allow-list is pinned and matches the decision line.** The `Allow`, `Pin` and `Shape` tests are green, and the table rows for FinComEmployees, FinComLedgers, FinComLedgerChanges, FinComLedgerByName and FinComVoucherObject match the decision line.
  - **Tax to the paisa.** `run_e2e_payroll.py` and the real-7.1 run both check every figure to the paisa and pass.
- I found no High or Medium that rounds 1 to 4 missed.

Verdict: 0 High, 0 Medium, 2 Low.
