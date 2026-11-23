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

### 4.3 The app side: Approve posts it (built 23-Nov-2026, not published)

- **Builder** (`app/src/lib/tallyPayroll.js`): exactly the shape `payrollimport.go` accepts. Never a REMOTEID. Free
  text (narration, category) is cleaned: no-break and other odd spaces become spaces, control and format characters are
  dropped, trimmed, capped (narration with FinCom's id at most 2,000 characters). A Tally master's name (employee, pay
  head, salary payable ledger, voucher type, the company) is never changed: one the bridge would refuse (a no-break
  space, a control character, over 200 characters) is listed, "Rename it in Tally". Also refused in plain words: a net of
  zero or less, a negative earning, one pay head for an earning and a deduction, more than 50 pay heads, an amount past
  10 digits of rupees, an employee twice. A month is split into vouchers of at most 100 employees and under the 1 MiB
  request cap, each its own posting (`dc-tp-<yyyymm>-<n>`).
- **Approve** (`app/src/lib/payrollPost.js`), from the Payroll page or Daily Check › Entries (data.js
  `tallyPayrollFor`; the journal is still posted for a month marked "Post as a journal this month"):
  1. the post gate, and the posting bridge (this computer's, or the one the cloud's queue goes to) 2.5.18 or later, else
     "Install FinCom Bridge 2.5.18 to post Tally Payroll" with the download (latest.json);
  2. the second check: `again.js recheck` on the night's payroll entry, the vouchers made again from `b.salary`, every
     employee and pay head in the payroll FinCom read from Tally (`Payroll.data()`, no new Tally request), the bridge's
     rules, the night entry's gross and net, and on the Payroll page the very XML shown;
  3. `entry_claim` on the night's entry (migration 208);
  4. one voucher a `Bridge.post`, each kept as a draft with the night's dedupe; a part already in Tally is not sent
     again, one queued is waited for;
  5. the proof: "Tally created 1 payroll voucher (voucher id …)", or Tally's refusal in plain words; `entry_approved`, or
     `entry_release` to try again.
- **Tests**: `node tests/run_payroll_post.mjs` (the builder's output and tampered copies through the bridge's own Go
  checks, by a `go test -overlay` that adds nothing to the tree; the approve flow with fakes) and section 8 of
  `tests/run_payroll_flex_ui.py`.
- **The night prepares every month** (the owner, 23-Nov-2026): for a Tally Payroll company (`co.payrollMethod` tally,
  not "as a journal this month") `server/_shared/dailyjournals.js` makes a Tally Payroll entry for every month kept with
  the books (`voucher.kind = "tallyPayroll"`: the voucher type, the salary payable ledger, the employees' count, gross,
  each deduction and other deductions, net; no journal lines and no journal ledger needed), worked out two ways. Other
  deductions (an advance, canteen, LWF) go to their own pay heads on Approve. A journal company's month with other
  deductions is said plainly ("no ledger in the payroll journal").

### 4.4 The independent review's fixes (23-Nov-2026, not published)

- **B1, never twice**: salary booked counts a payroll voucher entered in Tally by hand: any pay head of Tally's payroll
  that is an expense (`tally_ledgers.for_payroll`; the night reads them, the page has `S.books.payroll.heads`) and any
  ledger a Payroll-type voucher debits. Approve also refuses when Tally's payroll read (`Payroll.data().allocs`) or the
  books hold a payroll entry of the month without `TDSDesk:dc-tp-<yyyymm>-` in its narration, naming it.
- **B2, a fixed split**: employees go into parts in the order of Tally's employee list (by name, as FinCom reads it), so
  a re-sorted sheet moves nobody; a part counts as done only when its saved XML is the part built now, else "Part N in
  Tally differs from the sheet now".
- **B3, a split month finishes**: the month's own vouchers (`TDSDesk:dc-tp-<yyyymm>-*`) are left out of salary booked,
  so after part 1 reaches the books the night's entry and the second check stay the same and Approve posts the rest.
  Each part's draft carries `parts`; the night counts the month done only when every part is in Tally.
- **The bridge asked** is the cloud queue's (`TCloud.postThrough`) whenever the client's books are in the cloud, as
  `Bridge.post` routes it. **Salary payable ledger and voucher type** are picked on Payroll (`co.payrollPayable`,
  `co.payrollVchType`); the night's entry names them and Approve refuses a payable changed since. **Cost categories**:
  each employee under their own (Tally's employee master); the pin takes one CATEGORYENTRY a voucher, so a category is a
  part of its own. **Daily Check › Entries** shows the entry as a payroll voucher (employees, deductions, net to the
  payable) and says "queued for the Tally computer" when only queued. **alreadySent / already in Tally** answers are on
  their way / in Tally, as on the bank path.
- **The sheet kept**: a month kept before (for 24Q too) is replaced only after a warning, and each employee's exempt,
  standard, Chapter VI-A, taxable, regime and PAN are carried over. **AI learning**: the tab's month is left out of the
  layout's key (old keys still found); full dates (not a pay month), numbers of 9 digits or more are masked and figures
  rounded to two significant digits, in the page and again in `server/assistant/sheetmap.ts`. **The month** of a sheet
  read by a saved rule without a month column is picked on the start card (last month at first).
- **Lows**: a part posted saves the next part again ("waiting") so the cloud's settle, which reads the latest draft,
  never approves a half-posted month; a net of zero is said tonight; the page says the employer's PF and ESI are booked
  separately; two Tally employees whose names fold to one are refused unless one is exactly the sheet's name.
- **Re-review (23-Nov-2026)**: only earnings count as salary booked (Tally's pay head type, read with the pay heads;
  with none, the name): the employer's contributions, gratuity, reimbursements and deductions never do, and an entry
  touching only them is skipped (night and Approve). The resend guard's answer with no job is saved as posted without
  Tally's voucher id, so "Not confirmed in Tally" follows after 24 hours. Approve reads last night's findings itself
  (the owner's ledger picks), from the Payroll page too. A part in Tally that differs says exactly what changed (payable,
  voucher type, an employee's pay heads, category, net, no longer on the sheet); when the rest can be built without
  anyone in that part and the parts add up to the night's entry, the owner may accept it as it is in Tally and post the
  rest (kept on the part's draft). The saves are ordered so the latest draft is never a posted part while another is to
  go (the parts' answers saved after the last part is tried). Payroll.into reads each payroll entry's narration and
  leaves out merged and deleted ledgers; an entry FinCom has no narration for asks to read the books again. Dates are
  masked in full except in the pay month column; the server masks text cells itself. 24Q's figures carry over by code,
  then PAN, then name, and the warning names who did not carry over.
- **Third review (23-Nov-2026)**: the XML actually sent is kept on the part's draft (`sent`), never overwritten until
  its answer is saved. A part whose earlier send was never answered goes again only as that very XML (else refused,
  naming what changed); "already in Tally" counts as done only when FinCom's record of the earlier send is the XML
  being sent. Each part's answer is saved straight after its posting, then the last part still to go is saved
  "waiting" again (one save's window). A pay head with a Tally type goes by its type alone (night and page); names only
  without one ("Company PF Share", "Mediclaim (Company)" not salary; arrears always salary). Accepting a part saves the
  month's new count of parts on every part and a fingerprint of the accepted differences (each employee's amounts by
  pay head among them): anything else differing is asked again. The night checks the books for a part's FinCom id
  before saying "Not confirmed in Tally".
- **Tests**: `node tests/run_payroll_review.mjs` (the real night builder and `again.js recheck` on made-up books).
- **Redeploy when published**: the `assistant-night` function (dailyjournals.js, nightinput.js, handler.ts) and
  `fincom-assistant` (sheetmap.ts). No SQL.
