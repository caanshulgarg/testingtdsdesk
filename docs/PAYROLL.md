# Flexible payroll

Branch `next-payroll`, from `next-daily-p2`. Designed and built 22-Nov-2026. **Nothing here is applied, deployed,
published or merged.** There is no SQL and no bridge change. All data in the tests and the screenshots is made up.

**Section 4 waits for the owner's sign-off.** It holds the new Tally request XML and the allow-list change. Until the
owner signs it off, FinCom never posts a payroll voucher. A Tally Payroll company can still post the month as a journal
if the owner chooses "Post as a journal this month".

## 1. What it does

On the client's new **Payroll** page (sidebar › Work › Payroll, `books:payroll`):

1. **How does this company book salary?** The owner picks one, per client:
   - **Journal**: Daily Check's existing payroll journal.
   - **Tally Payroll**: Tally payroll vouchers.

   It is kept as `co.payrollMethod = {value, by, at, from}`. When it is unset, FinCom reads the books
   (`detectMethod`) and shows its reading with "That's right". It never decides alone. Staff see the setting but cannot
   change it.
   - Payroll entries with pay heads, a voucher of Tally's Payroll type, or employee masters: **Tally Payroll**.
   - Salary journals and no payroll: **Journal**.
   - Nothing in the books: not set, and the owner is asked.
2. **Any salary sheet layout.**
   - **First upload of a layout.** FinCom's AI is shown the header and **at most 3 rows**. Names, PANs, employee codes,
     e-mails, phone and account numbers are masked. Figures and dates are kept, so the AI can tell days from amounts.
     The AI maps the columns to these fields:
     - employee, code, PAN, days, month (or pay date) and gross;
     - every earning head, and every other deduction head;
     - TDS and PT;
     - PF and ESI, employee and employer apart;
     - net.
   - **The owner confirms the mapping.** They see each column, its first value and a field picker.
   - **It is saved as a rule** (`co.payrollFormats`, per client), keyed by the header's fingerprint.
   - **From then on that layout is read by the rule alone, with no AI.** A changed layout gets a new fingerprint: an
     added, removed, renamed or moved column, or a different sheet name. The AI studies it again. There is no "drift"
     tolerance.
   - **The AI never decides a figure.** FinCom's rules read every figure.
3. **Manual entry.** The month's employees are typed one by one: name, days, earning heads (heads can be added), TDS,
   PT, PF, ESI, other deductions, and net.
   - FinCom works out the net when it is left blank.
   - The totals run as rows are typed.
   - Each row is checked: gross = net + deductions, to the paisa.
4. **The checks**, the same for a sheet and for typed rows (`check`). Each of these is refused and named:
   - gross that is not the sum of the earning heads;
   - gross that is not net + TDS + PT + PF + ESI + other deductions;
   - a negative net;
   - an employee twice;
   - more than one month.

   The employer's PF and ESI are shown apart and are never in the employee's pay. **Keep with the books** merges the
   month into `b.salary`, which Daily Check and 24Q already read. The rows have TDS24Q's shape, plus the heads.
5. **Posting**
   - **Journal.** The preview is Daily Check's own builder (`payrollOne`, unchanged): Dr Salary; Cr TDS, PT, PF, ESI and
     Salary payable. The night prepares it from `b.salary`, and it is approved on Daily Check › Entries through the
     existing path. There is one limit: a sheet with **other deductions** (an advance recovered, canteen) has no ledger
     role in that journal. The month is not made into a journal; the person books it by hand or uses Tally Payroll.
   - **Tally Payroll.** FinCom prepares the vouchers (section 4) and previews them, marked **Needs your OK**.
     - Each sheet head is matched to a Tally pay head: by the same name, or for TDS, PT, PF and ESI by the statutory
       kind. The employer's heads are never used.
     - A head that does not match is picked by the owner, and the pick is kept (`co.payHeadPlan`).
     - An employee missing from Tally: "Create the employee in Tally". **FinCom creates no masters.**
     - Until section 4 is signed off, Daily Check's Approve refuses the payroll journal of a Tally Payroll company
       (`payrollHold`, data.js). The one exception is a month the owner marked "Post as a journal this month"
       (`co.payrollJournal[ym]`).

## 2. Where it is (reuse)

| Need | Where |
|---|---|
| Reading the sheet: quoted CSV, TSV, semicolons, Excel, Indian amounts, title rows, total rows, months | `app/src/lib/payrollSheet.js`, a new module. `src/js/17-24q.js` is not touched: the imports fix track owns TDS24Q. |
| Fingerprint, saved rule, "known or new", masked samples | the SheetFmt pattern of `app/src/lib/registers.js` (`fingerprint`, `find`, `masked`, `propose`), written for payroll |
| The AI | **the existing path only**: `SheetAI.map` → `fincom-assistant` action `sheet_map` with `side: "payroll"`. The firm's switch, consent and rupee cap apply, on the cheap model. `server/assistant/sheetmap.ts` adds `PAYROLL_SYSTEM`, `payrollPrompt` and `parsePayrollMap`. The server passes on **at most 3 rows** for payroll (`PAYROLL_ROWS`). Nothing runs in the bridge. |
| The journal | `server/_shared/dailyjournals.js` `payrollOne`, unchanged; Approve is Daily Check's `approveJournal` |
| Tally's employees and pay heads | `Payroll.data()` (bridge 2.4.4's reads, `src/js/73-payroll.js`) |
| The Tally payroll voucher | `app/src/lib/tallyPayroll.js`: builder, spec check, pay-head plan, splitting |
| The page | `app/src/screens/payroll/Payroll.jsx` and `payroll.css`, a lazy chunk. Books.jsx routes `books:payroll` to it. |

## 3. Tests and screenshots

- `node tests/run_payroll_flex.mjs`: 56 checks on four made-up layouts (`tests/payroll_sheets.mjs`):
  - **A**: a title row, quoted Indian amounts, earning heads and gross, PF and ESI employee and employer, and a Grand
    Total row.
  - **B**: Date of Birth and Joining columns before the Salary Month column.
  - **C**: tab-separated, the month given by the owner, an advance recovered.
  - **D**: semicolons, "Rs." amounts, a pay date.

  They cover:
  - the mapping saved and reused;
  - the AI mock never called when a rule matches;
  - a changed layout (a Bonus column) asking again, and another client's rules being its own;
  - the totals checks and manual entry;
  - method detection;
  - layout A's journal **identical** to the existing builder's on the same figures;
  - the Tally XML validated against section 4.1, with tampered copies refused (a wrong sum, an extra ledger line, a
    wrong sign, an extra tag, an Alter, two vouchers, a false date) and 230 employees split into 3 valid vouchers;
  - `tests/fixtures/payroll_voucher.xml` being exactly the builder's output;
  - the server's 3-row cap and answer check.
- `python3 tests/run_payroll_flex_ui.py` (the built app, the AI mocked): 38 checks, desktop and phone, including that
  `Bridge.post` is never called. Screenshots are taken with `SHOTS=…` (deviceScaleFactor 2, 1440 and 390):
  - `1-method`;
  - `2-new-layout-ai-mapping`;
  - `3-rule-recognised`;
  - `4-manual-entry`;
  - `5-journal-preview`;
  - `6-tally-payroll-needs-ok`.
- Sizes (gzip 6): legacy.js 599,738 (unchanged); the first file 260,708; the new Payroll chunk 15,176 (lazy).

## 4. The Tally payroll voucher request (signed off by the owner on 22-Nov-2026)

**Status: built into the bridge for 2.5.18** (bridge-go/payrollimport.go). The owner approved this request directly on
22-Nov-2026 ("Yes for tally payroll request"). Review fixes of 9b30a5702: payroll markers recognised in any letter case,
quote or spacing and never accepted by the plain Import pin; at most 50 pay heads per employee and 10 digits of rupees
per amount (no sum can overflow); no REMOTEID (Create only); an employee's name compared case-insensitively; a pay head
once per employee; each employee's net above zero; a payroll voucher always posted in a request of its own. The
2-second rule is still to be measured on ZZ BIG TEST at 100 employees before release; the app must not send REMOTEID.

### 4.1 The XML: one voucher, Create only, import only

It goes in the bridge's existing Import Data envelope (`importEnvelope`, report **Vouchers**, the linked company). There
is exactly **one** `VOUCHER` per request. The elements come in this order, one per line, with no others:

```xml
<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="{type}" ACTION="Create" OBJVIEW="PaySlip Voucher View">
<DATE>{yyyymmdd}</DATE>
<EFFECTIVEDATE>{yyyymmdd}</EFFECTIVEDATE>
<VOUCHERTYPENAME>{type}</VOUCHERTYPENAME>
<NARRATION>Salary for {Mon yyyy} as per the salary sheet ({n} employees) | TDSDesk:{FinCom id}</NARRATION>
<PERSISTEDVIEW>PaySlip Voucher View</PERSISTEDVIEW>
<CATEGORYENTRY.LIST>
<CATEGORY>Primary Cost Category</CATEGORY>
<EMPLOYEEENTRIES.LIST>                      (1 to 100 of these, each employee once)
<EMPLOYEENAME>{employee, as in Tally}</EMPLOYEENAME>
<AMOUNT>{minus the employee's net}</AMOUNT>
<PAYHEADALLOCATIONS.LIST>                   (1 or more)
<PAYHEADNAME>{pay head, as in Tally}</PAYHEADNAME>
<ISDEEMEDPOSITIVE>{Yes: an earning | No: a deduction}</ISDEEMEDPOSITIVE>
<AMOUNT>{an earning negative | a deduction positive}</AMOUNT>
</PAYHEADALLOCATIONS.LIST>
</EMPLOYEEENTRIES.LIST>
</CATEGORYENTRY.LIST>
<ALLLEDGERENTRIES.LIST>
<LEDGERNAME>{salary payable ledger}</LEDGERNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<AMOUNT>{the voucher's total net, positive}</AMOUNT>
</ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>
```

**Rules.** Both the app's `validatePayrollXml` and the proposed bridge pin enforce these:
- Every amount has two decimals.
- An employee's `AMOUNT` is the sum of their pay heads, to the paisa.
- The ledger line equals minus the employees' sum, and is above zero.
- The date is a real date.
- `VOUCHERTYPENAME` equals `VCHTYPE`.
- Text carries no markup: only `&amp; &lt; &gt; &quot; &apos;`.
- An optional `REMOTEID` is allowed.
- The bridge's usual stamping may move `TDSDesk:{id}` to the front of the narration.

**Why this shape.** It is the shape Tally exports and FinCom already reads: `server/tally-cloud/parse.js`, bridge
2.4.4's `batchPayrollFields`, and the `r249round1` and `fast234review` fixtures. A PaySlip voucher has no pay-head ledger
lines; its pay heads sit in each employee's allocations, and the payable ledger takes the net.

**Worked example.** `tests/fixtures/payroll_voucher.xml`: three made-up employees for Oct 2026, net ₹78,255.71.

**Left out on purpose.**
- No employee or pay-head masters are created. A missing one is the owner's to create in Tally, and FinCom says which.
- No employer contributions: PF and ESI employer are a separate Tally voucher, as now, by hand.
- No attendance, no Alter, no Delete.

**To verify before release.** Import one made-up voucher into ZZ TEST on TallyPrime 3.0, 5.1 and 7.1, and measure it
for the 2-second rule at 100 employees. The view name `PaySlip Voucher View` should be checked against a hand-made
payroll voucher exported from the same Tally.

### 4.2 The allow-list change (bridge-go, for 2.5.18 once signed off)

1. **The request's id.** In `allowlist.go` `tallyRequestID`, an Import Data request carrying
   `EMPLOYEEENTRIES.LIST`, `PAYHEADALLOCATIONS.LIST`, `CATEGORYENTRY.LIST` or `OBJVIEW="PaySlip Voucher View"` gets the
   new id **`FinComPayrollImport`**, never the plain `Import`. A new table row:

   `FinComPayrollImport: {purpose: "a payroll voucher posted (Import Data, 2.5.18): ONE VOUCHER a request, ACTION Create,
   the PaySlip view, at most 100 employees with their pay-head allocations and the one salary payable line, exactly the
   shape of docs/PAYROLL.md (payrollimport.go); no master is created"}`

   It is measured on ZZ BIG TEST, its row and the table hash go in `docs/tally-allowlist.md`, and its sample is added to
   `allowListSamples`.
2. **The pin.** In `pinned.go` `requestRebuild`, the new entry `FinComPayrollImport: payrollImportRebuild`. The request
   must be the Vouchers report's envelope with ONE TALLYMESSAGE holding exactly ONE voucher that passes
   `payrollVoucherShape`. Anything else is refused before Tally is asked.
3. **Treated as a posting** wherever `"Import"` is:
   - `checkAllowed` and `pinRefusedError`'s words;
   - `selfwatch.go` `noteRequest` (import time) and `readStopExempt`.

   Unchanged:
   - the typing gate and "postings go first" (both key on `isImportRequest`);
   - one request in flight;
   - the linked company and this computer's own Tally;
   - the record before the send;
   - no AI.
4. **Part sizing.** One payroll voucher goes in each posting: FinCom posts each voucher as its own `Bridge.post`. A part
   that bundled two would be refused whole by the pin, never half-sent. `postpace.go` is not touched; it is being changed
   on `next-fix-audit-bridge`.
5. **Go tests to add with it.**
   - The fixture passes `payrollVoucherShape` and `checkAllowed`.
   - These are refused: each tamper of section 3, 101 employees, two vouchers, an `Import` with a payroll body under the
     wrong id.
   - `driveEveryRequest` posts one payroll voucher.
   - `TestAllowListUnchanged` is updated with the new row.

**A finding for the owner.** Today the plain `Import` pin accepts **any** `VOUCHER` with a date (`cannotSend` checks only
that). A payroll-shaped voucher would therefore already pass the bridge if FinCom sent one. Until 4.2 is in, FinCom's app
is the only stop: this branch never sends one (no `Bridge.post` from the Payroll page; Approve is held by
`payrollHold`). Step 1 of 4.2 closes that, by routing such bodies to their own, narrower id.

### 4.3 What happens after sign-off (app side, small)

- `tallyPayroll.js` vouchers become Daily Check drafts (`dc-tp-<ym>[-n]`).
- Approve posts each through `postDraft` → `Bridge.post`, one voucher per call, with the same claim, release and
  approved steps as the journal.
- `payrollHold` then lets a Tally Payroll company's Approve post the voucher instead of the journal.

The bridge side is built (section 4). The app wiring above is the next step.
