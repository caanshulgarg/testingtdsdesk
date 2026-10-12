# FinCom Bridge 2.4.4 ("payroll and salary TDS from Tally"): review, round 2

- Reviewer: Claude (Claude Code), an independent reviewer. I did not write this code.
- Date: 12-Oct-2026
- Range 1 (bridge + cloud): `ac37face07dca03f01dfeda3566e2b06e99022a5..8e3edeef0d2cc8e46cfea2a3fb27f3954bc4668c` (origin/next-payroll)
  - The head is as expected (`8e3edeef0`).
- Range 2 (app): `dbce3b97d887ee2c72cc089444680006e1efac3e...1e9451006e594047ac201ca7b088f2597e617d7a` (origin/arc-ui...origin/app-payroll), limited to `src/js app/src tests`
  - The merge base is arc-ui's tip, `dbce3b97d`. The head is as expected (`1e9451006`), and it merges next-payroll `8e3edeef0`.
  - The part of the diff that Range 1 covers is not reviewed again here.
- Round 1: origin/review-244-r1, `docs/reviews/review-244-round1.md`. The fixes reviewed are `8e3edeef0` (bridge and cloud) and `0b82df5fa` (app).

This was a read-only combined code and security review. No code branch was changed, and no database, Tally or artifact was touched. Line numbers below are on the heads above.

What I ran (in scratch worktrees of the two heads):
- On next-payroll (`8e3edeef0`), in `bridge-go`: `go vet . && go test -count=1 -run 'Payroll|Pay244|Employee|244|Allow|Pin|Shape|Release|Ledger|Fast|Day|Keep' .` printed **ok** (156.5 s), and vet was clean.
- On next-payroll: `node tests/run_parse_payroll.mjs` printed **ALL PASS**.
- On app-payroll (`1e9451006`):
  - `python3 build.py` exited 0.
  - `node tests/run_tds_tally.mjs` printed **all ok**.
  - `python3 tests/run_e2e_payroll.py` printed **ALL OK: 0** (Postgres 16 through `tests/pg_stand.py`). This includes the new H2 and M3 checks.
- I also ran a throwaway Go test (not committed). It confirmed that `payrollLearn` sees `ASPAYSLIP` Yes and `PERSISTEDVIEW` "PaySlip Voucher View" after `cleanXML`, on the real 7.1 payroll entry. That is the text `recorder_live.go:2038` passes it.
- Not run:
  - `tests/run_payroll_ingest.py`: Deno is not installed in this container.
  - `tests/run_payroll_ui.py`, `run_migration74.py` and the full Go suite.

## Findings

| Id | Severity | File:line | What | Why it matters | Fix |
|---|---|---|---|---|---|
| R2-M1 | Medium | `bridge-go/payroll.go:478`; `server/tally-cloud/parse.js:546` | `dropBankDetails` takes out only `ACCOUNTNUMBER`, `IFSCODE` and `PAYMENTFAVOURING`. Each employee's `BANKALLOCATIONS.LIST` in a salary payment also carries **`BANKNAME`**, the employee's own bank. In the real 7.1 capture `testdata/payroll244/7.1/full-SAL-PAY-NOV.xml.gz` it is "HDFC Bank Ltd", next to each employee's account and IFSC. It stays in the day files on the bridge's disk, in the `daybook-<ym>.xml` month files, and in the `tally-days` bucket. | Owner rule (5): no bank or other personal field is read or kept, and only `BANKEMPLOYEENAME` and its `AMOUNT` are kept. The 2.4.4 notes (line 85) and the test sheet say no bank field is kept. The FinComVoucherObject path drops it, because its strip keeps only `BANKEMPLOYEENAME` and `AMOUNT`. The Day Book path is the one that keeps it, so the two paths disagree. | In a `BANKALLOCATIONS.LIST` whose `BANKEMPLOYEENAME` is filled, also drop `BANKNAME` (and the rest of the employee's bank block that is not needed: `BANKBRANCHNAME`, `BENEFICIARYCODE`, `SWIFTCODE` if present). Do this in both copies of `dropBankDetails` (Go and parse.js). Add `HDFC Bank Ltd` to `bankWords244`, but only for the employee allocations: the company's own bank ledger and a TDS challan's `TAXBANKNAME` must stay. |
| R2-M2 | Medium | `server/tally-cloud/index.ts:2431` and `uploadPiece` (`:2489`); `migration-47-recorder-queue-alerts.sql:182-190` | A Day Book the CA uploads in FinCom goes whole to the `tally-uploads` bucket (`<firm>/<job>.xml`). It is cut into days there, and the days pass through `ingestDaysRaw`, which now cleans them. But the uploaded file itself is never cleaned or removed: migration 47 gives the bucket no delete policy, and `index.ts` never calls `.remove`. The day pieces queued from it (`{days: [{day, gz}]}`) also carry the raw text until they are applied. | If a company's Day Book export holds a salary payment made the way the test sheet says (Payroll Autofill), every employee's account number, IFSC and name in favour stays in the cloud for good. Every member of the firm can read it (the select policy at `:190`). The H1 fix says "never in the cloud, whatever bridge sent the day", but this way in is not covered. The mechanism is older than 2.4.4, but 2.4.4 is the release that tells staff to make these entries and claims they are excluded. | Remove the uploaded object (service role) once the job's last piece is queued, or when the job fails or is stopped. Or run `dropBankDetails` on each voucher as `uploadPiece` cuts it, before a piece is queued, and remove the original at the end. Ask the owner about objects already in `tally-uploads`. |
| R2-L1 | Low | `bridge-go/cloud.go:347`, `bridge-go/keep.go:563-573`, `:684-694`; the `tally-days` bucket | Round 1 asked for the owner's decision on day files and bucket objects that already hold the bank details. None is recorded, and nothing cleans them. A day file a 2.4.3 bridge wrote is cleaned only in the text being sent (`cloud.go:347`), not on disk. `writeKeepMonth` builds `daybook-<ym>.xml` (served to the app by `/syncfile`) from those files as they are. `renameKeepLedger` rewrites them with the details still in. `tally-days` objects stored before `8e3edeef0` keep them until that day is sent again. | Any company already on a payroll before 2.4.4 keeps employees' account numbers and IFSC on the bridge's disk and in the cloud indefinitely. The notes say "never on this computer's disk from 2.4.4 on", which is true only for files written from now on. | Get the owner's decision and record it in the notes. If the answer is to clean: rewrite each day file through `dropBankDetails` once on first start of 2.4.4 (only files that contain the tags), re-make the month files, and queue those days for the cloud. That puts cleaned objects into `tally-days` through the existing upsert. |

## Round-1 findings

- **H1 (bank details on the Day Book path): partly fixed.**
  - What is fixed:
    - The three named elements are removed from each voucher before a day file is written (`keep.go:273`).
    - They are removed again from each day as it is sent (`cloud.go:347`).
    - `tally-ingest` removes them from every day it keeps, whoever sent it (`index.ts:2230-2232`). It re-gzips the cleaned text, so the bucket gets the clean version, and parse.js reads the cleaned text.
    - The regexes handle `TYPE=` attributes and empty elements, and do not touch longer tag names. Both copies agree.
    - `TestPayrollDayFileNoBankDetails` and `TestPayrollDaySentNoBankDetails` check this on the real 7.1 capture.
    - The posting read-back path (`useKeepPosted`, `keep.go:774`) writes FinCom's own posted XML, not a Tally salary payment, so it was not touched and does not need to be.
  - What is still open: the employee's `BANKNAME` (R2-M1), the `tally-uploads` path (R2-M2) and the files kept before 2.4.4 (R2-L1).
- **H2 (no-PAN 206AA applied to the tax): fixed.** `taxPayable` is now the 288B tax.
  - `tdsDue` = max(tax, 20% of total income) only when the PAN is not valid and the tax is above nil. It feeds only `shortfall`, the "TDS for the year less than due" check and the screen's "still to deduct".
  - Form 16 Part B line 16 and the SD record's tax payable and balance use the real tax. Form 16 shows the 206AA figure separately.
  - `make_expected.py` is changed independently, and the e2e checks the no-PAN, no-tax employee.
- **H3 (employer NPS): fixed.**
  - The declared employer contribution (`d80CCD2`, now labelled "Employer's NPS contribution for the year") is added to 17(1) salary and to Form 16's salary breakdown.
  - 80CCD(2) is capped at 14% (new regime) or 10% (old) of basic + DA.
  - The independent `make_expected.py` follows the same rule.
  - This figure is declared in FinCom. A Tally pay head of type "Employer's …" is still left out of salary (`kind()` gives "employer"), which the field's hint says. A company that runs NPS through a Tally pay head must enter the year's figure here. That is the design, not a defect.
- **M1 (payroll type learned from Tally's base types): fixed.** `payrollLearn` now needs two things:
  - The entry is a pay slip (`ASPAYSLIP` Yes or the PaySlip view). On every 3.0, 5.1 and 7.1 capture, payroll entries carry Yes and the view, and the salary payments and TDS payments carry No and the Accounting view.
  - The type is not one of Tally's 24 predefined voucher types.

  I compared the list with TallyPrime's predefined types and it is complete. The test covers Payment, Journal, Receipt and Contra, and a type of the company's own that is not a pay slip.
- **M2 (Annexure I by payment, Annexure II by credit): fixed.** Annexure I rows are dated by the payroll entry's credit date (`73-payroll.js:143`), which is the date `yearOf` counts by. The deduction date in the DD record is that date, and the salary payment's date is shown beside it. The expected file was re-made on the same basis.
- **M3 (SD category always G): fixed.** `form16()` now returns `category` "S" for an old-regime senior (`:204`), and the SD record uses it. The e2e checks S for Dev Malhotra and G for the others. Per the owner's rule, senior status is asked only for the old regime, so a new-regime senior or a super senior is reported as G or S as the comment at `:233` says.
- **L1 (80D parents cap): fixed.** There is a yes / no "A parent is a senior citizen" question (old regime only, no date of birth), and the cap is ₹25,000 or ₹50,000.
- **L2 (PayTax ignores fy): fixed.**
  - `PayTax.YEARS` is 2025-26 and 2026-27, and `rulesKnown` is false for any other year.
  - Form 16 shows a warning, Q4's checks list the employees, and the Q4 text file is refused.
  - The 2025-26 rules are the same as those written (Finance Act, 2025), so 2025-26 is right to include.
- **L3 (a type of the user's own learned only after a full answer): accepted.** The notes (item 4) and the test sheet now say so.

## Checked, no finding

- **dropBankDetails on the bridge.**
  - It runs on each voucher block before the day text is put together, so `indexText`, `countVouchers` and the `n` sent to the cloud are unchanged.
  - On send, the count is taken on the cleaned text, which has the same vouchers.
  - `/seed` (a CA's file sent to the bridge) goes through `saveKeepDays`, so it is cleaned.
  - The bridge's `/daybook` answer goes only to the browser, where `Books.importDayBook` parses it and does not upload it.
- **ingestDaysRaw.** `z` and `gz` are `let`. The cleaned text is re-gzipped before the upload, and `p_bytes` is the cleaned size. The "kept === text" shadow compare (`index.ts:1004`) is test mode only. A legacy bridge's text with the tags will show there as "differ", which is a log line only.
- **payrollLearn base-type list and the pay-slip test** (above). `payrollEntry` still accepts "payroll" by name, and the learned set is per company.
- **App fix, the arithmetic.** I re-derived these against the 2026-27 rules:
  - The new cap uses the year's basic + DA, and the via-6 total is limited to gross total income.
  - `tdsDue` is rounded under 288B.
  - `shortfall` and `balance` are each to the paisa.
  - The DD record's PAN remark "C" for no PAN is unchanged.
  - The SD record's 17(1) field now includes the NPS contribution, consistent with gross and Form 16.
- **Payroll.jsx.** The parents-senior question appears only in the old regime, beside the other declarations. "Still to deduct" uses `shortfall`. The no-PAN note appears only when `tdsDue` is above the tax. The rules warning appears for an unknown year.
- **The e2e oracle.** `make_expected.py` still works from `setup.json` alone with Decimal and half-up rounding. It does not import or copy FinCom's code, and its rule changes match the round-1 fixes item by item.
- **The rest of both ranges, re-read for anything new beyond the fix commits:**
  - the FinComEmployees request and filter, the four ledger fields, the kept list and `fastNeverPay244`, and the 3-second exception (`entryTC`, `slowNote`);
  - the allow-list pin, migration 74 (add-only, RLS `firm_id = public.my_firm()` as 57 and 73, grants), and the `employees` / `salpay` ingest;
  - parse.js's per-employee pay-head rows and `salpay` (no account, IFSC or name in favour is read);
  - 72-tds-tally's salary challans.

  These are unchanged since round 1, and I found nothing new in them.
- **An assumption to keep in mind, not a finding.** `Payroll.take` and `yearOf` count every live cost allocation on a payroll pay head whatever the voucher type. On every capture, only payroll entries carry such allocations: the 7.1 salary payment's category blocks are empty, and the TDS and PF payments carry none. If a real Payroll Autofill statutory payment (Income Tax or Professional Tax) turns out to allocate the pay-head line to employees, those debits would net against the year's TDS or PT. The next tally-versions capture of an autofilled statutory payment would settle it.

Verdict: 0 High, 2 Medium, 1 Low.
