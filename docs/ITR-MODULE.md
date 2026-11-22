# Income Tax Return (AY 2026-27)

FinCom prepares a client's income tax return for AY 2026-27 (FY 2025-26) as the official ITR JSON for ITR-3, ITR-4,
ITR-5 and ITR-6. The owner imports that JSON into his income tax software (Winman) and files from there. Before the JSON
is offered, FinCom checks the return the way an experienced CA reviewer would and shows the checks report.

Branch `next-itr` (off `staging-next`). Staging only: nothing here is published, merged or deployed, and no SQL is needed.

## 1. The design

One page per client, under Books in the sidebar: **Income tax return**. Four steps, each a books tab with its own address
(`#/c/<client>/books/itr`, `itr-comp`, `itr-checks`, `itr-json`):

| Step | What it shows | Details on expand |
|---|---|---|
| 1 Data | The portal files (AIS, TIS, 26AS, pre-filled data, PF ECR and challans, ESI challans), one line each; "Bring in files"; the form, regime, filing date, tax audit; the books' revenue, profit and whether the balance sheet tallies | What each file held (counts and totals by section, PAN, AY, stored or not); the return's details (date of birth, verifier, place, software ID, partners, presumptive receipts) with where each came from |
| 2 Computation | The CA's Computation of Income: business income with every addition and deduction, other heads, set-off, total income, tax, rebate, surcharge, cess, interest, taxes paid, refund or payable. "Checked twice" when the second computation agrees. PDF and Excel | Click a line: its source (section, schedule) and the ledgers behind it |
| 3 Checks | Counts of Matched / Difference / Missing data / Needs you; the open checks by group | Click a check: both sides with their amounts and sources, the lines behind them, what to do, and "Accept" with a note (or "Confirm" with an answer) |
| 4 JSON | Not yet / Ready for Winman, with three ticks: the official schema passes, the two computations agree, every check settled | The schema's own questions (Yes/No and choices FinCom cannot know), what the schema says if it fails, the versions made |

The calm style of the client pages: few words, one chip in the heading ("7 to look at" / "JSON ready"), details on expand.
The page is one lazy chunk (`ITR-*.js`, about 50 KB gzip, with `ITR-*.css` 2 KB); nothing of it is in `legacy.js` or the
app's first file. Code: `app/src/screens/itr/ITR.jsx`, `itr.css`; the working, all pure and tested in Node, in
`app/src/lib/itr/`:

| File | Does |
|---|---|
| `law.js` | Every rate, limit and date for AY 2026-27, each with its section and source |
| `tax.js` | The computation (first): heads, presumptive, 40(b), set-off, Chapter VI-A, tax, 87A, surcharge with marginal relief, MAT, 234A/B/C, 234F, rounding |
| `check.js` | The second computation, written apart (no shared code or figures), and the comparison of 17 figures |
| `imports.js` | Reading the portal files: detection, PAN, AY, client, counts and totals |
| `store.js` | Where the work is kept (`b.itr`), the files (the firm's private storage), accepting with a note, versions |
| `books.js` | The books in the ITR's shape (Part A-BS, Part A-P&L, trading account) and the Schedule BP adjustments, each with its ledgers |
| `model.js` | The return model: books + imports + the owner's answers -> the computation's input; the person's details |
| `verify.js` | The checks and the gate |
| `forms.js` | The mapping layer: FinCom's figures -> the official schema's fields, form by form |
| `fill.js`, `validate.js`, `json.js` | Completing the JSON (zeros for unmapped amounts, questions for the rest), the draft-04 validator, one JSON with its report |
| `appData.js`, `sheet.js` | The page's reads of GST / TDS / 3CD; the sheet's PDF and Excel |

## 2. Data sources

| Source | Where it comes from in FinCom | Used for |
|---|---|---|
| Tally books | The synced day book (`S.books`, from `tally_vouchers` / `tally_lines` / `tally_ledgers` in the cloud) through the financial statements model (`FinSt`, `src/js/88-fin-statements.js`): every ledger has a code | Part A-BS, Part A-P&L, trading account, profit before tax, every schedule line's ledgers |
| Income-tax depreciation | `FinSt.taxDep` / `FinDepr` (`src/js/88-fin-depr.js`): blocks and rates of Appendix I, 180-day rule, opening WDV from last year's ITR | Schedule DEP, depreciation allowed under section 32; book depreciation added back |
| Audit findings | `Audit.calcIn` (`src/js/06-audit.js`), worked out without writing anything | 40(a)(ia) (TDSWatch "should have deducted"), 40A(3) cash payments, 43B(h) MSME dues, penalties |
| 3CD draft | `Audit.form3cd` (`src/js/07-mis.js`) | The 3CD tie (clauses 21(b), 21(d)) |
| TDS returns | `TDS.allRows`, the challans and the TDS payable ledgers (`src/js/09-tds.js`, 26Q / 24Q) | Deducted vs payable vs deposited |
| GST | `GSTR.outward` (`server/_shared/gst3b.js`, GSTR-1 worked out from the books) | Turnover against GSTR-1 / 3B, with the reasons |
| Portal files | Brought in by the owner (below) | TDS / TCS credit, challans, AIS income, PF / ESI dates |
| The owner's answers | `b.itr["2026|state"]` | Form, regime, filing date, audit, details, accepted differences, the schema's questions |

### The imports (owner, 22-Nov-2026: "the data comes in by file import first")

| Kind | Formats | Read |
|---|---|---|
| AIS | JSON, PDF | TDS / TCS by deductor (TAN) and section, interest, dividend, rent, high-value purchases and sales (SFT), GST turnover, taxes paid |
| TIS | JSON, PDF | Category, processed and derived value |
| Form 26AS | TRACES text export ("^"), PDF | TDS (Part I), TCS (Part VI), advance and self-assessment tax challans (BSR, date, serial, minor head 100 / 300); a self-check against each deductor's own totals |
| Pre-filled data | e-filing JSON | Date of birth, address, email, mobile, bank accounts, TDS lines, challans |
| PF ECR | EPFO upload text (`#~#`), the statement CSV | Members, wages, employee share, employer share; the wage month (from the file, or its name) |
| PF challan | EPFO payment receipt (text, PDF) | TRRN, establishment, wage month, A/c 01-22, date of credit |
| ESI challan | ESIC challan (text, PDF) | Employer code, period, challan number, employee and employer share, paid date |

- **Detection:** each file's kind is told from its content (never its name alone), with its PAN, AY (or wage month, so the
  AY) and the client. A PDF is read with pdf.js (scripts off); a locked PDF is tried with the client's date of birth
  (26AS) and PAN + date of birth (AIS).
- **Wrong files are refused, saying which:** "This AIS is for PAN ZZZPY8888Y (Other Demo Client), not Demo Traders
  (ZZZPX9999Z)." Another year: "This Form 26AS is for AY 2025-26, not AY 2026-27." A PF or ESI code not yet known for the
  client is asked once ("Is DLCPM0000001000 this client's PF establishment code?"), never assumed.
- **What was read:** counts and totals per section, on the file's line.
- **Storage:** the file goes only to the firm's private storage (bucket `client-docs`, `<firm>/<client>/itr2026-<kind>-<name>`,
  the Inbox documents' bucket and its row security). Never to this computer's store, the repository or a log; nothing of
  a file is written to the console (tested). Signed out, what the file holds is kept and the file is not stored (said).
  What was read is kept in `b.itr`, a part of the client's books (`BOOKS_KEYS` gains `"itr"`), synced item by item through
  `client_book_items` like the TDS uploads: no new table, so **no SQL**.
- **Re-import replaces:** one item per AY and kind (per month for ECR, per challan for challans). The same file again
  (same SHA-256) changes nothing; another file of the same kind replaces the first and its stored copy is removed.

**Layouts to confirm (owner).** Only the ITR schemas are official files FinCom could read: the AIS / TIS compliance
portal, TRACES, EPFO and ESIC could not be reached from where FinCom is built. Their readers go by field names, from the
portals' published descriptions; the test files in `tests/fixtures/itr/` are made up in those layouts. Each file's line
says "layout to confirm on the first real file" until checked. The AIS JSON as downloaded may be locked for the portal's
offline utility: FinCom says so and asks for the unlocked JSON or the PDF.

## 3. The official schemas

Source: incometax.gov.in, Downloads > Income Tax Returns > "Schema" of each form (fetched 22-Nov-2026):

| Form | File | SHA-256 |
|---|---|---|
| ITR-3 | `ITR-3_2026_Main_V1.1.json` (2026-07) | `66f4bd70…25e8b` |
| ITR-4 | `ITR-4_2026_Main_V1.1.json` (2026-07) | `5e9af500…c2ac` |
| ITR-5 | `ITR-5_2026_Main_V1.1.json` (2026-08) | `3bb5f158…6a9` |
| ITR-6 | `ITR-6_2026_Main_V1.0.json` (2026-08) | `15fb2426…6e83e6a` |

JSON Schema draft-04, 0.25-1.3 MB each. The site says "All Rights Reserved", so the schemas are **not kept in the
repository**: `tools/itr-schemas.sh` fetches them into `app/public/itr-schema/` (git-ignored), refusing any file whose
SHA-256 differs from the pins (a new version is a deliberate change to `forms.js` and the pins). Vite copies the folder into
the build, so the page validates against the same files; without them the JSON step says "The official schema could not be
loaded" and offers nothing. The CBDT validation-rule PDFs (ITR-3 V1.0, ITR-4) were read for the rules quoted below.

Validation: the page has its own draft-04 validator (`validate.js`; it reports any keyword it does not understand rather
than skipping it); the tests check every JSON with **ajv** as well and require both to agree, and plant faults both must
reject. The schemas' root does not require `ITR`, so the tests also require `ITR.ITRn`.

**Never invented.** `fill.js` sets 0 only in required *amount* fields FinCom does not map (as the CBDT utilities do for an
empty line). Every other required field (Yes/No, a choice, a name, a date) comes from FinCom's data, the pre-filled
data, the owner's details, or is asked on the JSON step with the schema's own description and choices. The software ID
(`SWCreatedBy`, pattern `SW` + 8 digits) is the owner's to give (owner decision below).

## 4. Computation rules per form

Common: total income rounded to the nearest 10 (288A); each tax figure to the rupee (each special-rate part on its own); the payable or refund to the nearest
10 (288B). Due dates (schemas' `ItrFilingDueDate`): 31-Aug-2026 non-audit, 31-Oct-2026 audit and companies, 30-Nov-2026
transfer pricing. Interest: 1% a month or part, on the amount rounded down to Rs 100 (rule 119A); 234A from the day after
the due date, 234B from 1 April 2026, both to the filing date, a self-assessment payment stopping it from the month after
it is paid; 234C on the instalments 15/45/75/100% (12% and 36% safe), one instalment by 15 March for 44AD / 44ADA; none
below Rs 10,000 of tax (208). 234F: Rs 5,000, Rs 1,000 up to Rs 5 lakh.

Business income from books: profit before tax (Part A-P&L) + book depreciation + 40(a)(ia) (30%) + 40A(3) + 43B unpaid by
the due date (statutory dues, leave / bonus provisions, 43B(h) MSME) + 36(1)(va) late employees' PF / ESI + penalties /
CSR (37) + tax provisions + loss on sale - interest income (to other sources) - profit on sale - 43B of earlier years paid
- depreciation under section 32. Each line keeps its ledgers and its Schedule BP field. Set-off: a business loss against
any head but salary (71(2A)); house property loss up to Rs 2 lakh (old regime only); brought-forward business loss
within 8 years against business only (72); unabsorbed depreciation without limit (32(2)); a late return carries no
business loss forward (80).

| Form | Who | Rules |
|---|---|---|
| ITR-3 | Individual / HUF with books | Slabs: new regime 0-4L nil, 5/10/15/20/25/30% to 24L+ (115BAC(1A)); old 2.5L (3L at 60, 5L at 80) 5/20/30%. 87A (the reading the owner confirms, below): new regime, eligibility on TOTAL income (special-rate income included) up to Rs 12 lakh, up to Rs 60,000, the rebate and its marginal relief above 12 lakh only ever against the tax on normal income; old regime, total income up to Rs 5 lakh, up to Rs 12,500 against the tax on normal income, 111A and 112 (never 112A). Any rebate with special-rate income is shown on Checks. Surcharge 10/15/25/37% above 50L/1Cr/2Cr/5Cr, 25% cap in the new regime, 15% cap on 111A/112/112A, marginal relief at each band. Special rates 111A 20%, 112A 12.5% above 1.25L, 112 12.5%; the unused basic exemption set first against 111A (20%), then 112, then 112A. Chapter VI-A, each section's limit: 80C + 80CCC + 80CCD(1) 1.5L (80CCE); 80CCD(1B) 50k; 80CCD(2) 14% of salary in the new regime, 10% in the old (14% for a government employer); 80D 25k / 50k (senior) for self and family plus 25k / 50k (senior parents); 80DD 75k / 1.25L severe; 80DDB 40k / 1L senior patient; 80U 75k / 1.25L severe; 80TTA 10k (not seniors), 80TTB 50k (seniors only); 80GG 60k; 80EE 50k; 80EEA / 80EEB 1.5L; 80G 100% / 50% with qualifying donations within 10% of the adjusted gross total income and no cash above Rs 2,000. New regime: 80CCD(2), 80CCH and 80JJAA only. Regime: both worked out and shown; the owner chooses; old needs Form 10-IEA (asked) |
| ITR-4 | Resident individual / HUF / firm (not LLP), presumptive, TI up to 50L | 44AD 6% of digital receipts + 8% of others (limit 2 Cr, 3 Cr if cash up to 5%); 44ADA 50% (50L, 75L if cash up to 5%; not HUF); 44AE Rs 1,000 a ton a month (heavy) / Rs 7,500 a month, at most 10 vehicles. Declared below the minimum, above the limit, wrong entity, TI above 50L, a tax audit or capital gains beyond 112A 1.25L: Needs you (ITR-3 / ITR-5) |
| ITR-5 | Firm / LLP | 30%, surcharge 12% above 1 Cr with marginal relief, no 87A. 40(b): interest to partners at most 12% simple; working partners' remuneration up to Rs 3 lakh or 90% of book profit on the first Rs 6 lakh (or a loss), 60% on the rest; book profit = business income before the remuneration (Explanation 3); a sleeping partner's remuneration not allowed |
| ITR-6 | Company | 25% if FY 2023-24 turnover up to Rs 400 crore, else 30%: asked, and the JSON is blocked until answered; surcharge 7% / 12% above 1 / 10 Cr with marginal relief. 115BAA: 22% + 10% + 4% (25.168%), no MAT, no MAT credit, Chapter VI-A only 80JJAA and 80M (115BAA(2)(ii); 80IAC and 80G not allowed). MAT 15% of book profit (+ surcharge, marginal relief, cess) when higher; else MAT credit set off down to the MAT (115JAA). The book profit must be entered with the 115JB Explanation 1 adjustments and confirmed (Needs you until then) |

**AOP / BOI and other ITR-5 persons:** not covered yet (Needs you). Firm or LLP is asked in the return (Client setup has
"Firm or LLP" as one choice); never read from the name. 234C: one instalment by 15 March only for 44AD / 44ADA (44AE alone
has the four instalments). A belated return carries no business loss of the year forward (section 80): the JSON does not
claim it, and Checks says so.

**Losses carried forward (sections 32(2), 72, 80).** What is left of the year's business loss after set-off is, up to the
year's depreciation under section 32, unabsorbed depreciation (carried without limit, even in a belated return) and only
the rest business loss (eight years; none in a belated return). Both computations work this out and must agree on it
(cfBus, cfUd, cfHp). The JSON carries it: Schedule UD's row of this year (CurrAssYr 2026-27, CurBalCFNY) and its totals;
Schedule CFL's row of this year (CurrentAYloss, and CurrentYearLossCF in ITR-5 / ITR-6; note that LossCFCurrentAssmntYear
is the schema's row of AY 2019-20, never this year's), its totals, and Part B-TI's LossesOfCurrentYearCarriedFwd. The
review's case: PBT -1 lakh with depreciation of 4 lakh is 1 lakh of unabsorbed depreciation and no business loss;
-5 lakh is 4 lakh of depreciation and 1 lakh of loss. Anything carried forward that the JSON does not hold (earlier
years' rows of CFL and UD, ITR-4) blocks the JSON (coverage: `cf_unmapped`, `cfl_prior`, `ud`, `cf_itr4`). The e-filing
utility's rule 618 compares CFL's business loss with CYLA's whole balance; FinCom's split is asked to be confirmed on
Checks (`ud_split`).

**40(a).** 40(a)(ia): 30% of the sums paid to residents on which TDS was not deducted, of the part of a sum the TDS
deducted does not cover when it was deducted short (the owner's decision, below), and of the sums whose TDS was deducted
but not deposited by the due date of the return. 40(a)(i): 100% of a non-resident's sum on which TDS was not deducted OR
was deducted and not deposited by the due date (non-residents are the parties with 27Q details, or section 195; a
foreign-looking party without them is asked).

**43B on this year's charge.** For each payable ledger at 31-03-2026 under 43B (employer PF / ESI, bonus, leave
encashment, interest to banks / NBFCs, taxes and duties) FinCom reads from the vouchers its opening balance, this year's
charge (its credits in vouchers that debit an income or expense ledger), the year's payments, and the payments after the
year end up to the due date. Only the part of THIS YEAR'S charge still unpaid on the due date is added back, never the
whole balance: a leave provision of 30 lakh of which 3 lakh was charged this year adds back at most 3 lakh. Payments
settle the oldest dues first (in the year the opening balance before the year's charge; after the year end what is left
of the opening balance first). If the year's charge cannot be read, the balance is taken and Checks asks (`43b_charge`).
PF / ESI: a ledger named for the employer's share is 43B in full; one named for the employees' share is never 43B (it is
36(1)(va)); only a single ledger for both is split by March's ECR / ESI challan (none: `43b_share`, Needs you, blocks). A
March challan and the April bank entry for it are one payment (same ledger, amount to the rupee, its TRRN / challan number
in the narration or dates within five days), at the challan's date. GST and TDS payable are listed (GST is under 43B only
when charged to the P&L; unpaid TDS is 40(a)(ia)).

**Earlier years' 43B paid this year** (AmtDisallUs43BNowAllow): from last year's return made in FinCom (each download
keeps what 43B and 43B(h) added back, by ledger / party): allowed = the part of last year's add-back paid in FY 2025-26,
the year's payments settling first the part allowed last year. Without last year's return in FinCom and with dues payable
at 1-04-2025 that were paid, the owner gives the amount (0 if none) on Checks; until then the JSON is blocked.

**43B(h).** Each micro / small supplier's bill of the year open at the year end is allowed only if paid within the days of
the MSMED Act (15, or the agreed days up to 45, from the MSME setting) of its date: paid later, even after 31 March and
before the return, or unpaid, it is added back. A bill of an earlier year is not this year's add-back (paid this year, it
is earlier years' 43B, above).

**Payment dates the books do not show** (the books end before the due date or the limit; a PF / ESI month without its
challan): asked item by item on Checks, a date or Not paid. The answer changes the computation at once (paid in time:
allowed; later or not paid: added back) and until every item is answered the check cannot be accepted with a note.
36(1)(va): a month without its challan is neither disallowed nor taken as in time until answered; ESI is checked like PF,
also for ESI-only employers.

## 5. The checks

Each check compares two independent sources, or is labelled a **consistency check** where both sides come from the same
records (the return's 43B, 43B(h), 40(a)(ia) / 40(a)(i) add-backs and 3CD clause 21(b) against the lists they were made
from): it shows the list reached the return, not that the list is right, and the independent checks beside it test the
list (the bank entries against the challans, the bill references against the payment vouchers, the TDS records against
the returns as filed and against TRACES). It is Matched only when both sides are there and agree to the rupee;
Difference (the exact amount, both sides with their sources and the lines behind them); Missing data when a side is not
there (never Matched); or Needs you.

| Group | Checks |
|---|---|
| 26AS, AIS, TIS | TDS receivable in the books against 26AS lines of booking status F (U, P, O and a status that could not be read are not claimed: Needs you); TCS ledger against 26AS; the books' advance-tax ledger against the 26AS challans (no ledger: Missing data); the self-assessment tax ledger against 26AS; AIS interest, dividend, rent against the return; high-value purchases / sales (Needs you, each listed); AIS GST turnover against the return; AIS TDS against 26AS; TIS business receipts within the turnover; 26AS read completely (its own totals) |
| Tally books | Sources = application; Part A-P&L profit (FinCom's codes) = Tally's own profit and loss (the ledgers under Tally's revenue groups, by its group chain, with the stock-in-hand ledgers); every ledger in a schedule line; opening balances in Tally = last year's audited balance sheet as uploaded (FinPyBs), else Missing data; capital account: last year's closing capital (uploaded balance sheet) + profit + the year's capital credits - debits = the closing capital, else Missing data |
| GST | Turnover = the FILED GSTR-1 (the portal's copies or downloads marked filed, totalled from the GSTN JSON) + the listed reasons; filed GSTR-1 = filed GSTR-3B (the portal's 3B JSON); months without a filed return listed |
| TDS returns | Deducted (26Q / 24Q) = credited to TDS payable; deducted = deposited by the due date; consistency: the return's 40(a)(ia) / 40(a)(i) = the same worked out from the TDS records; independent: FinCom's records = the 26Q / 27Q returns as filed (the copy kept when each was marked filed), FinCom's challans = TRACES (consolidated file / challan status file), else Missing data; non-resident or not asked |
| 43B and 43B(h) | Consistency: the return's 43B = this year's charge unpaid by the due date (each ledger: charge, payments, dates, employer's part); the return's 43B(h) = the MSME bills paid after their limit. Independent: the PF / ESI payments after the year end in the bank entries = the March challans; the bills settled by their references (the ageing) = the bills settled by the payment vouchers oldest first. Asked (blocking until answered): payment dates not shown, the employer's part of a joint PF / ESI ledger, the year's charge not read, earlier years' 43B paid; GST / TDS payable unpaid: asked |
| PF and ESI | An ECR for every month; a challan for every ECR; employer's PF in the books = the ECRs (+ admin charges); employees' share credited by the 15th of the next month (36(1)(va)); the dates feed 43B |
| Tax audit (3CD) | Where a tax audit applies: the 3CD drafted from the SAVED Audit run of the whole year (clauses 21(b)(ii)(A), 21(d)(A)) against the ITR's schedules as worked out now; no saved run for the year: Missing data |
| The computation | The right form; firm or LLP; regime and rates (and the company's FY 2023-24 turnover) answered; every deduction within its limit; loss set-off and carry-forward (a belated return's loss lost; this year's unabsorbed depreciation split confirmed); ITR-4 limits; Form 10-IEA; MAT book profit confirmed; the two computations agree on all 17 figures |
| The JSON | Every schedule that has figures is filled by FinCom; one that is not blocks the JSON, said by name (below) |

## 6. Acceptance rules

1. **Exact or nothing.** Matched only when the two sides agree to the rupee.
2. **Two independent computations.** `check.js` imports nothing, carries its own figures and works in plain steps; the
   JSON is offered only when it and `tax.js` agree on all 17 figures (total income, the tax heads, the liability, each
   interest and fee, payable, refund, and what is carried forward: business loss, unabsorbed depreciation, house property
   loss). That check can never be accepted away.
3. **Schema-valid.** The JSON must pass the official schema (and, in the tests, ajv).
4. **Every figure traced.** Every computation line shows its source; every schedule line its ledgers; every check both
   sides' sources. Unmapped required amounts are 0; nothing else is filled in by FinCom.
5. **Nothing open.** Every Difference or Missing data is accepted with the owner's note, every Needs you answered with a
   note; what only the data settles (the form, firm or LLP, the regime, the company's turnover, the MAT book profit, a
   schedule FinCom does not fill, the two computations) cannot be accepted. An acceptance is bound to the check's figures:
   a fingerprint of the difference and of both sides (amounts and sources); if either side changes, the acceptance lapses
   ("the figures have changed since") and the check is open again.
7. **No schedule zero-filled.** A schedule of the official form that has figures in this return but that FinCom does not
   fill blocks the JSON with its name (Checks › The JSON). Filled from FinCom's data: Part A-BS / P&L / trading account
   (ITR-3, ITR-5; ITR-6 Schedule III balance sheet and P&L in full), Schedule BP, DPM / DOA / DEP by block, OS, VIA (ITR-3,
   the allowed amounts), CYLA, BFLA, this year's rows of CFL and UD (and their totals), Part A-OI (audit cases), the audit report details, Schedule
   GST (from the filed GSTR-1), TDS2 (head of income from the section), IT, TCS, Part B-TI / TTI, ITR-4's 16(ia), VI-A
   (allowed amounts) and 112A (with the sale and cost entered), ITR-5's partners, ITR-6's MAT and MATC. Not yet filled, so
   blocking when they have figures: Schedule S (salary, ITR-3), HP, CG / SI (capital gains), the VI-A detail schedules
   (80C, 80D, 80DD, 80DDB, 80U, 80E, 80EE/A/B, 80G, 80GGA, 80GGC), UD and CFL rows of earlier years (and any loss or
   depreciation carried forward that the JSON does not hold; ITR-4 carries none),
   AL (income above Rs 1 crore), FA, ITR-5 / ITR-6 Schedule VIA, ITR-6 SH (every unlisted company: ITR-6 is blocked until
   it is built), Ind AS parts (an Ind AS company); also the authorised capital, the Ind AS question and the loans' purpose
   when not answered.
6. Each JSON downloaded carries its version: the return JSON exactly as the schema has it (a key outside the schema would
   make it invalid), and beside it `<form>_<PAN>_AY2026-27_checks.json`: FinCom's version (`fincom-itr-2026.1`), the
   schema file, the computation's totals, every check with its status, amounts, sources and accepted note, and the JSON's
   SHA-256. Each download is kept as a version in `b.itr`.

## 7. Owner decisions

Decided (the owner answered Yes to each, 22-11-2026):

1. **87A in the new regime and special-rate income: decided, yes (22-11-2026).** Eligibility on TOTAL income including
   special-rate income (Rs 12 lakh); the rebate, and its marginal relief above Rs 12 lakh, apply even when special-rate
   income is part of the total income, and only ever against the tax on normal income (Finance Act 2025 amendment to
   section 87A). Checks no longer asks about it. Note: ITR-4 validation rule 227 reads "total income excluding LTCG": the
   e-filing utility may treat a case with 112A gains differently.
1a. **40(a)(ia) on short deduction: decided, yes (22-11-2026).** Where TDS was deducted at less than the rate, 30% of the
   part of the sum the deducted TDS does not cover is disallowed (TDSWatch's uncovered amount). Not flagged for
   confirmation.

To confirm:

2. **Old-regime 87A:** against the tax on normal income, 111A and 112; never 112A (112A(6)).
2a. **80JJAA in the new regime:** kept as allowed, because section 115BAC(2)(ii) excludes "Chapter VI-A other than 80CCD(2),
   80CCH(2) or 80JJAA". The review asked for 80CCD(2) and 80CCH only; confirm.
3. **Due date of 31 August 2026** for non-audit returns (the schemas allow only this for ITR-4; ITR-4 rule 234). Confirm no
   further extension applies to the client.
4. **Company rate:** 25% when FY 2023-24 turnover was up to Rs 400 crore (Finance Act 2025, Part I para E). FinCom asks;
   it does not assume.
5. **40(b) limits** from AY 2025-26 (Finance (No. 2) Act 2024): Rs 3 lakh or 90% on the first Rs 6 lakh, 60% on the rest.
6. **36(1)(va)**: no grace days (Checkmate Services, SC 2022); a late month's employees' share is disallowed for good.
6a. **43B: payments taken against the oldest dues first.** Without a voucher-level link between a payment and the due it
   settles, FinCom applies payments to the opening balance before this year's charge. A stale old balance can make this
   year's add-back larger (and next year's allowance follows). Confirm, or say where payments are linked.
6b. **This year's unabsorbed depreciation in Schedule UD, the rest of the loss in CFL** (section 32(2)); the utility's
   rule 618 reads CFL against CYLA's whole balance. Each such return asks to confirm on Checks.
7. **Software ID** (`SWCreatedBy`): FinCom has no CBDT software ID. Give Winman's or the firm's, or leave the placeholder
   for Winman to replace on import. FinCom asks for it; it never makes one up.
8. **Schemas in the build:** the CBDT schemas are fetched at test and publish time and served from FinCom's own site to
   the page (not committed). Confirm serving them from the site is acceptable, or the page can fetch them another way.
9. **Portal file layouts** (AIS, TIS, 26AS, pre-filled data, ECR, challans): built from published descriptions; the first
   real file of each kind should be checked (the page marks them).
10. **Not covered yet:** AOP / BOI / trusts in ITR-5, and the schedules listed under acceptance rule 7: each blocks the JSON
    by name when it has figures; nothing is zero-filled. A non-Ind AS company's Ind AS parts (required by the ITR-6 schema)
    are 0 only after the owner answers that it does not follow Ind AS.
11. **What b.itr keeps:** only what the checks and the JSON need: per file, its kind, name, SHA-256, PAN, AY and what was
    read (lines with amounts, deductor / source names and TANs); from the pre-filled data the date of birth, address,
    email, mobile and the refund bank account (the schema needs them), never the Aadhaar; the owner's answers. The files
    themselves only in the firm's private storage (client-docs, confirmed private on staging).
12. **Imports:** a file naming neither a PAN nor an establishment code (an ECR upload file) is taken only after the person
    says it is the client's; the AIS PAN is read from its taxpayer header (Part A) only.

## 8. Tests

All on made-up data (`tests/fixtures/itr/`, `tests/itr_demo.mjs`):

| Test | What |
|---|---|
| `node tests/run_itr_imports.mjs` | Each kind detected with PAN / AY / month, counts and totals, the PDF route, refusals (another PAN, another year, unknown, locked, an ITR JSON, no month), re-import, firm storage only, nothing logged |
| `node tests/run_itr_tax.mjs` | Every rule with hand-worked figures and edge cases (87A and its relief, surcharge bands with marginal relief, both regimes, seniors, MAT and credit, 115BAA, 40(b), 44AD / 44ADA / 44AE thresholds, losses, VI-A limits, special rates, rounding, 234A/B/C/F, 43B and 36(1)(va) dates); 600 random returns through both computations; a planted one-rupee difference caught |
| `node tests/run_itr_schema.mjs` | Pinned schema files; every form and scenario passes ajv and the page's validator alike; planted faults rejected by both; non-amount fields asked, never filled; the JSON's figures are the computation's; the review's loss cases (PBT -1 lakh / -5 lakh with depreciation of 4 lakh) carried in Schedules UD and CFL for ITR-3, 5 and 6; a carry-forward the map does not hold blocks |
| `node tests/run_itr_verify.mjs` | Every check Matched on agreeing sides, and each planted fault found with its exact amount; Missing / Needs you; consistency checks labelled; 43B on this year's charge (the 30 lakh leave provision), employer / employees' PF ledgers, one payment per challan, earlier years' 43B; payment dates answered item by item changing the computation; the gate |
| `python3 tests/run_itr_ui.py` | The page, desktop and phone: Data, a file brought in, a wrong PAN refused, re-import, the sheet with its ledgers, PDF, Excel, the checks, a difference opened, accepting only with a note, the JSON offered only when settled, the download passing ajv; fits the width. `ITR_SHOTS=<dir>` saves the design screenshots |
| `run_every_screen.py`, `run_legacy_room.py` | The four steps open on real (fixture) books with no error; legacy.js and the first file within their budgets |

Run `sh tools/itr-schemas.sh` before building and before the schema test.
