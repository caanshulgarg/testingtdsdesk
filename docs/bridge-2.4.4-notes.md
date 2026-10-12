# FinCom Bridge 2.4.4 (branch next-payroll, from 2.4.3: tax-accuracy ac37face0)

The owner's decisions of 12-Oct-2026: payroll and salary TDS come from Tally into FinCom, exactly these five and nothing
more. (1) one new request, FinComEmployees; (2) four fields on the ledger requests; (3) the salary payment's employee and
amount kept (no request change); (4) a payroll voucher's entry request may take 3 s; (5) no date of birth, Aadhaar, bank or
other personal field read or kept. The two data locations (next-241) are not in 2.4.4.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.4.exe |
| Fingerprint | (filled at build) |
| Replaces | 2.4.3 (kept on the computer, so the tray can roll back to it) |
| Published | (filled at publishing) |

## What is in 2.4.4

1. **One new request, FinComEmployees (request change, (1)).** A Collection of Tally's CostCentre masters (a TYPE every
   release has), in the fcCollection form, by MasterID in chunks of 2,000 like FinComLedgers, then the open end. It
   fetches exactly GUID, MASTERID, ALTERID, NAME, PARENT, CATEGORY, FORPAYROLL, ISEMPLOYEEGROUP, PANNUMBER, DATEOFJOIN,
   DEACTIVATIONDATE, DESIGNATION: no period, no computed field, no other field (the request is pinned byte for byte to the
   one measured, shape 422e91ed8ae6). The bridge keeps only payroll rows (FORPAYROLL Yes, or an employee group) and drops
   every other cost centre before it logs, stores or sends anything. It is read again only when Tally's master counter
   moves (no second request id), at most once in 30 minutes, never while a posting runs or the retry schedule is busy, one
   request in flight. The list goes to FinCom only when it changed; a company with no payroll sends nothing.
   Code: bridge-go/payroll.go; tests: payroll244_test.go (real TallyPrime 3.0, 5.1 and 7.1 captures).

2. **The ledger requests ask four more fields (request change, (2)).** FinComLedgers, FinComLedgerChanges and
   FinComLedgerByName (one field list, ledFetch) ask, after 2.4.3's fields: PAYTYPE (Earnings for Employees, Employees'
   Statutory Deductions...), PAYSTATTYPE (Income Tax, PF...), ITCOMPONENT (Basic Salary, House Rent Allowance...) and
   FORPAYROLL. They go to FinCom as the 15th to 18th columns of the ledger row ("Not Applicable" sent blank). A row a 2.4.3
   round left in the outbox goes without them: FinCom keeps its own.

3. **The salary payment's employee and amount (no request change, (3)).** FinComVoucherObject's answer is unchanged; the
   strip keeps two more fields: ALLLEDGERENTRIES.BANKALLOCATIONS.BANKEMPLOYEENAME and its AMOUNT, from a salary payment.
   ACCOUNTNUMBER, IFSCODE and PAYMENTFAVOURING are never kept (a test refuses them on the kept list), and a bank allocation
   that names no employee keeps exactly what 2.4.3 kept. The Day Book path keeps Tally's entry whole (the day files, sent to
   the cloud's tally-days bucket): from 2.4.4 these three elements, and the employee's own bank (BANKNAME, BANKBRANCHNAME,
   BENEFICIARYCODE, SWIFTCODE, BANKPARTYNAME, only in a bank allocation that names an employee), are taken out of every
   entry before a day file is written and again before a day is sent, and tally-ingest takes them out of a day before it
   keeps it, whatever bridge sent it (reviews 244 H1, R2-M1). Day files an earlier bridge kept with them are cleaned once
   on 2.4.4's first cloud round (bank-clean-244.txt marks the folder), their month files put together again, and those days
   sent again so the cloud's copy is replaced (R2-L1). A Day Book uploaded in FinCom is cleaned the same way as it is cut
   into days (the cut entry a piece carries to the next, and the days the browser hands over the old way, too), and the
   uploaded file is removed from the tally-uploads bucket when its job ends: done, stopped for good, or refused for its
   size (R2-M2, R3-M1, R3-L1). Two narrow cases left for the next release (review 244 round 4, Low): an upload abandoned
   before FinCom is told it finished is not removed (R4-L2), and a 4 MB piece's end that falls inside one employee's bank
   allocation carries that allocation's text in the queue's archived message (R4-L1). Not cleaned by 2.4.4 (for the owner): uploaded files and tally-days objects stored before
   2.4.4 for days no bridge sends again, and the tally_work queue's archive of earlier hand-overs.

4. **A payroll voucher's entry request may take 3 s ((4)).** Only FinComVoucherObject, only for an entry whose voucher
   type is a payroll type (Tally's "Payroll", or a type of the company's own the bridge saw as a pay slip with employees'
   pay heads; never one of Tally's own types such as Payment or Journal). A payroll type of the company's own gets the 3 s
   only after the bridge has read one entry of it in full (an entry too big for 2 s before that is held as today). Every other request
   keeps the 2-second rule; one request in flight stays the rule. A payroll entry answered within 3 s does not mark the
   company slow.

5. **Measured on real TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1** (tally-versions mode paym, run 38263695475, the requests
   exactly as next-payroll builds them; GitHub runners, not NWS144; checks p1 to p5 PASS on every release; worst, in ms):

   | TallyPrime | FinComEmployees (2,000+ employees) | FinComLedgers chunk, 20,000 ledgers (2.4.4 / 2.4.3 fields) | FinComLedgerChanges | FinComLedgerByName | a payroll of 500 employees (FinComVoucherObject) |
   |---|---|---|---|---|---|
   | 3.0 | 163.2 | 277.8 / 218.3 | 236.8 | 37.6 | 1201.7 |
   | 4.1 | 98.4 | 162.9 / 137.0 | 159.9 | 22.4 | 1277.2 |
   | 5.1 | 89.8 | 172.7 / 137.2 | 185.6 | 21.4 | 1255.2 |
   | 6.2 | 142.7 | 252.9 / 203.3 | 210.7 | 33.2 | 2188.8 |
   | 7.1 | 127.9 | 235.4 / 213.2 | 202.2 | 33.9 | 2152.9 |

   The payroll entry of 500 employees passes 2 s on 6.2 and 7.1 and stays under 3 s on all five: the reason for (4).

6. **The cloud stores them (migration 74, add-only).** `tally_employees` per book by GUID (RLS: a member of the firm
   reads), pay-head columns on `tally_ledgers` (pay_type, pay_stat_type, it_component, for_payroll), `tally_salary_pays`
   (each employee's salary paid: employee, amount, date; never the account), `tally_ingest_employees` (service_role only),
   `tally_ingest_salpay` (granted to nobody), and 73's `tally_ingest_details` with one line added. parse.js reads the
   salary paid per employee and, on the Day Book path, each employee's amount per pay head (not only totals); the Stat
   Payment of Income Tax is a TDS payment. Tests: run_migration74.py, run_parse_payroll.mjs, run_payroll_ingest.py.

7. **The app (under the client's TDS, a Salary tab).** Employees from Tally (PAN, group, designation, joined, left); the
   details Tally does not keep are typed in FinCom per employee and kept with the client's books: regime, Chapter VI-A
   declarations (80C, 80CCD(1B), 80D, 80E, 80G, 80TTA/TTB, 80CCD(2)), rent and landlord's PAN, housing-loan interest and
   lender's PAN, previous employer's salary and TDS, address, and senior citizen as yes / no (old regime only). The monthly
   pay register (employee by pay head); 24Q Annexure I (per employee per month: paid or credited, TDS, date, the challan of
   that month, made from Tally's Stat Payment of Income Tax as in 2.4.3); 24Q Annexure II (the year: salary by component,
   regime, deductions, tax); Form 16 Part B; the 24Q text file from the existing return file builder. The new Act's form
   layout could not be checked here: the file is built to the current 24Q layout, named _DRAFT and marked "check before
   filing"; run it through the FVU first. Figures to the paisa. Each month's salary and TDS count by the payroll entry's
   date (the credit, when the TDS is deducted) in Annexure I, Annexure II and Form 16 alike. Without a PAN the tax stays the
   tax on the income; the TDS due is at least 20% of the income where there is tax (section 206AA). The employer's NPS
   contribution typed in FinCom is salary under 17(1) and deducted under 80CCD(2) within 14% (new) or 10% (old) of basic
   and DA. The salary tax is worked out for 2025-26 and 2026-27 only; another year is said, not worked out. Tests: tests/fixtures/payroll-e2e (a test company with
   answers worked out apart), run_e2e_payroll.py, run_payroll_ui.py.

What the owner's staff do in Tally: the test sheet's "What your staff do in Tally".

No date of birth, Aadhaar, bank account, IFSC or other personal field is read or kept; senior citizen is asked in FinCom
as yes / no (so a super senior citizen is not told apart). The add-on unchanged from 2.4.3. No AI in the bridge or the
add-on. Prospective only; each bridge reads only its own Windows user's Tally; one request in flight.

## Not in 2.4.4

- The two data locations (next-241).
- Perquisites (17(2)) and profits in lieu of salary (17(3)) are not told apart: whatever a pay head pays is salary.
- The HRA metro choice is the user's (Tally does not keep the city).

## Checks

go vet (Linux and Windows), go test, release-check steps 1-6, CI and Windows CI, the real-Tally gate on the committed setup
(tally-versions upg (from 2.4.3), s235, bankb, selfck and payroll on all five releases; tally-real fast234; tdsgst on 7.1).
