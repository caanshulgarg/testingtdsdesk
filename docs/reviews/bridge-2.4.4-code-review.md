# Code review: FinCom Bridge 2.4.4 (payroll and salary TDS from Tally)

One combined code and security review, as for 2.4.3 (the owner's decisions of 12-Oct-2026): an independent reviewer (a
fresh agent session for each round, read only, no access used beyond the repository) reviewed the bridge, the cloud and
the app together, then re-reviewed each round of fixes. The rounds' own notes, word for word:
docs/reviews/review-244-round1.md to review-244-round5.md.

Range: ac37face07dca03f01dfeda3566e2b06e99022a5..718d4343dd6fd3d0f199c0a499dbb32cb8083168

(next-payroll: bridge-go/, server/tally-cloud/parse.js, index.ts, migration-74-payroll.sql, tests, docs. The app part,
branch app-payroll from arc-ui dbce3b97d, is reviewed in the same rounds as the diff against arc-ui (src/js, app/src,
tests): from 125f94129 to dc5ffde86.)

## What 2.4.4 changes

- FinComEmployees (new): Tally's Cost Centre masters in chunks of 2,000 MasterIDs, exactly the twelve approved fields;
  only payroll rows kept, every other cost centre dropped before anything is logged, stored or sent; read again when
  Tally's master counter moves (no second request id). Measured on real TallyPrime 3.0-7.1 (run 38263695475): 163 ms worst.
- The ledger requests ask PAYTYPE, PAYSTATTYPE, ITCOMPONENT, FORPAYROLL (the 15th-18th columns).
- The strip keeps a salary payment's BANKEMPLOYEENAME and AMOUNT; never ACCOUNTNUMBER, IFSCODE or PAYMENTFAVOURING. The
  Day Book path, the uploaded Day Book and the cloud take every bank detail out of a salary payment's entry.
- FinComVoucherObject may take 3 s for a payroll voucher only (Tally's Payroll or a learned pay-slip type of the company's
  own); every other request 2 s; one request in flight.
- Migration 74 (add-only): tally_employees, the pay-head columns, tally_salary_pays, their ingest functions, 73's
  tally_ingest_details with one line. parse.js reads the salary paid per employee and each employee's amount per pay head.
- The app: TDS > Salary (Employees with the details Tally lacks kept as items, Pay register, Form 16 Part B), 24Q from
  Tally's payroll (Annexure I with the challans, Annexure II, the text file marked check before filing).

## Findings and what was done

| Round | Id | Severity | What | Done |
|---|---|---|---|---|
| 1 | H1 | High | the Day Book path kept and sent a salary payment's account, IFSC, name in favour | dropBankDetails before a day file is written, before a day is sent, and in tally-ingest (8e3edeef0) |
| 1 | H2 | High | no-PAN 20% applied to the tax payable | the tax stays the tax; the TDS due is at least 20% only where there is tax (0b82df5fa) |
| 1 | H3 | High | employer NPS deducted but never salary; cap on all salary | salary under 17(1), 80CCD(2) within 14% / 10% of basic and DA (0b82df5fa) |
| 1 | M1 | Medium | Tally's own types (Payment) could be learned as payroll | only a pay slip of a type of the company's own (8e3edeef0) |
| 1 | M2 | Medium | Annexure I by payment date, Annexure II / Form 16 by credit | the payroll entry's date everywhere (0b82df5fa) |
| 1 | M3 | Medium | the salary record's category always G | S for an old-regime senior (0b82df5fa) |
| 1 | L1-L3 | Low | 80D parents cap; the year's rules; a learned type after a full answer | fixed; fixed; noted (0b82df5fa, notes) |
| 2 | R2-M1 | Medium | the employee's own BANKNAME left | taken out in an allocation that names an employee (4e8ce205d) |
| 2 | R2-M2 | Medium | an uploaded Day Book kept whole | cleaned as cut; the file removed when its job ends (4e8ce205d, f041d5398) |
| 2 | R2-L1 | Low | day files kept by earlier bridges | cleaned once, months made again, days sent again (4e8ce205d) |
| 3 | R3-M1 | Medium | the upload file left when a job did not end well | removed on give-up, re-run at end, size refusal (f041d5398, 9baf43d11) |
| 3 | R3-L1, R3-L2 | Low | raw tail in the archived queue; the re-send lost on a failed write or a cloud off | fixed (9baf43d11) |
| 4 | R4-L1, R4-L2 | Low | an open allocation at a piece's end; an abandoned upload | open, for the owner and the next release |
| 5 | - | - | no new finding | 0 High, 0 Medium, 2 Low (R4-L1, R4-L2) |

No High or Medium is open.
