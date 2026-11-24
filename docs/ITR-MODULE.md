# Income Tax Return (AY 2026-27)

FinCom prepares a client's income tax return for AY 2026-27 (FY 2025-26) as the official ITR JSON for ITR-3, ITR-4,
ITR-5 and ITR-6. The owner imports that JSON into his income tax software (Winman) and files from there. Before the JSON
is offered, FinCom checks the return the way an experienced CA reviewer would and shows the checks report.

Branch `next-itr` (off `staging-next`). Staging only: nothing here is published, merged or deployed, and no SQL is needed.

## 1. The design

One page per client, under Books in the sidebar: **Income tax return**. Five steps, each a books tab with its own address
(`#/c/<client>/books/itr`, `itr-sch`, `itr-comp`, `itr-checks`, `itr-json`):

| Step | What it shows | Details on expand |
|---|---|---|
| 1 Data | The portal files (AIS, TIS, 26AS, pre-filled data, PF ECR and challans, ESI challans), one line each; "Bring in files"; the form, regime, filing date, tax audit; the books' revenue, profit and whether the balance sheet tallies | What each file held (counts and totals by section, PAN, AY, stored or not); the return's details (date of birth, verifier, place, software ID, partners, presumptive receipts) with where each came from |
| 2 Schedules | Salary (S, from Form 16), house property (HP), capital gains (CG, the AIS's sales offered as rows), other sources outside the books, AL (ITR-3), FA, SH and AL-1 (ITR-6, unlisted), other comprehensive income (ITR-6, Ind AS); each head's figure as worked | Click an item: its fields, the lines behind its figure (annual value, 30%, interest; full value, cost, indexation, the excess ignored) |
| 3 Computation | The CA's Computation of Income: business income with every addition and deduction, other heads, set-off, total income, tax, rebate, surcharge, cess, interest, taxes paid, refund or payable. "Checked twice" when the second computation agrees. PDF and Excel | Click a line: its source (section, schedule) and the ledgers behind it |
| 4 Checks | Counts of Matched / Difference / Missing data / Needs you; the open checks by group | Click a check: both sides with their amounts and sources, the lines behind them, what to do, and "Accept" with a note (or "Confirm" with an answer) |
| 5 JSON | Not yet / Ready for Winman, with three ticks: the official schema passes, the two computations agree, every check settled | The schema's own questions (Yes/No and choices FinCom cannot know), what the schema says if it fails, the versions made |

The calm style of the client pages: few words, one chip in the heading ("7 to look at" / "JSON ready"), details on expand.
The page is one lazy chunk (`ITR-*.js`, about 100 KB gzip with the schedules, with `ITR-*.css` 2 KB); nothing of it is in `legacy.js` or the
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
| `heads.js` | The heads with schedules of their own, from their rows: salary (sections 15-17, 10, 16), house property (22-27), capital gains (45-55A, 111A, 112 and its proviso, 112A, 70, 74); the 234C accrual of the gains |
| `sched.js` | Schedules S, TDS1, HP, CG / 112A / SI (Tables E and F), AL, FA, SH, AL-1 and the Ind AS parts of ITR-6, form by form (fit(): only what the form's schema has) |
| `screens/itr/Schedules.jsx` | Step 2: the schedules' lists; FA, SH and AL-1 drawn from the official schema's own fields |

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
| Form 16 | TRACES Form 16 (Part A and B), PDF or text; one per employer (TAN) | Employer, TAN, the employee's PAN, AY, 17(1) / 17(2) / 17(3), section 10 exemptions, section 16 deductions, chargeable salary, TDS; taken into Schedule S on Schedules ("Take it") |
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

**Which form** (`pick.js`, the owner's review of 23-Nov-2026): recommended from the kind of person (the PAN's fourth
letter; Client setup's choice only without a PAN, and a Client setup kind that differs from the PAN is said and the PAN
followed: a company PAN never gets ITR-4 or ITR-5) and the income known, with the reason in plain words, and defaulted. P: ITR-3
with business income (the books), ITR-4 when presumptive within Rs 50 lakh, else ITR-1 / ITR-2 by the heads; H: the
same without ITR-1; F: ITR-5 (ITR-4 for a partnership firm with presumptive income); C: ITR-6 (ITR-7 when it claims
exemption under section 11); A, B, J, L, G: ITR-5 (ITR-7 when exempt); T: ITR-7 (ITR-5 when not exempt). The page's
"ITR form" chooser (every step) keeps the person's choice per client per year (b.itr "<ay>|state": form, formSet). A
form that does not fit the person, or one FinCom's JSON does not cover (ITR-1, ITR-2, ITR-7, ITR-5 for anyone but a
firm or LLP), is said on the page and no JSON is made. The review of 24-Nov-2026: with no PAN and no kind of taxpayer,
no form is recommended or counts as fitting and no JSON is made ("FinCom needs the PAN or the kind of taxpayer to pick
the form"), the chooser still shown; ITR-1 follows rule 12 (law.js ITR1): never for a director in a company, one who
held unlisted equity shares in the year, or agricultural income above Rs 5,000. The form box asks these three for an
individual; any not answered, ITR-2 is recommended and the reason names what is not known. ITR-4 follows rule 12(1)(b)
and its proviso the same way (law.js ITR4): never for an individual or HUF who is a director in a company, nor for an
individual, HUF or firm that held unlisted equity shares in the year (the portal's ITR-4 FAQ), nor for agricultural income
above Rs 5,000. The form box asks the three of an individual, and of a HUF with presumptive income, and the unlisted
shares and agricultural income of a firm (not an LLP) with it (and whenever ITR-4 is the form in use); any not answered,
ITR-3 is recommended for the business or profession income (ITR-5 for a firm), and the reason says "ITR-4 is not for
someone who is a director in a company, held unlisted shares or has agricultural income above Rs 5,000. Answer the
questions below to see if it fits." (naming only what is not answered). A Yes known rules the form out: chosen by hand,
it is said not to fit and no JSON is made. The review of 24-Nov-2026 (2): an answer not given blocks the ITR-4 JSON (and
ITR-1's) in formStatus until it is given; chosen by hand, the page names the questions to answer, in the info tone
(as is "FinCom cannot make the JSON for ITR-2 yet"); red is kept for a form that does not fit. The proviso's other bars
FinCom has the data for rule ITR-1 and ITR-4 out too, without a question: assets outside India (Schedule FA's rows or the Yes on Schedules: neither form has Schedule FA; ITR-3 / ITR-2 /
ITR-5), TDS under section 194N (26AS or the AIS), a loss of earlier years brought forward, and more houses than the form
takes (ITR-4: two for AY 2026-27, the schema's PropertyDetails maxItems; law.js itr4Houses, one for an earlier year).
The review of 24-Nov-2026 (3): the form box asks an individual or HUF the residential status (Resident / Not ordinarily
resident / Non-resident, kept as the return's own, b.itr state.resident, the schemas' codes RES / NOR / NRI; the ITR-3
JSON takes it and no longer asks it; an ITR-3 answer given before is read back). ITR-1 and ITR-4 need Resident; NOR or
NRI rules both out; not set, it is not known (not a bar), and their JSON waits for it as for the other rule 12 answers.
A firm PAN: ITR-4 is not recommended until firm or LLP is answered (asked on the form box too, kept where Data keeps
it), ITR-5 until then. A loss of earlier years marked "No: the loss is lost" (section 80; not a house property loss or
unabsorbed depreciation) is not brought forward. Rows left in Schedule FA after its answer is changed to No bar ITR-1 and
ITR-4 only while they are there, and the form box offers "Remove these rows". The Losses card stays on Schedules for
ITR-4 while there is an entry, so a wrong one can be removed. ITR-1's houses follow the year as ITR-4's do (law.js
itr1Houses: two for AY 2026-27, one for an earlier year). A HUF itself cannot be a director: it is asked whether its
karta is one ("ITR-4 is not for a HUF whose karta is a director in a company"). The no-PAN note is in the info tone.
Not modelled, FinCom has no data for them: income
from outside India without an asset abroad, signing authority in an account outside India, tax deferred on ESOPs of an
eligible start-up, relief claimed under 90 / 90A / 91, and (ITR-1) income of the kinds in 115BBDA / 115BBE, winnings
from lottery or race horses, and a loss of the year to be carried forward. With no PAN, the heading shows no kind of
taxpayer until it is known.

| Form | Who | Rules |
|---|---|---|
| ITR-3 | Individual / HUF with books | Slabs: new regime 0-4L nil, 5/10/15/20/25/30% to 24L+ (115BAC(1A)); old 2.5L (3L at 60, 5L at 80) 5/20/30%. 87A (the reading the owner confirms, below): new regime, eligibility on TOTAL income (special-rate income included) up to Rs 12 lakh, up to Rs 60,000, the rebate and its marginal relief above 12 lakh only ever against the tax on normal income; old regime, total income up to Rs 5 lakh, up to Rs 12,500 against the tax on normal income, 111A and 112 (never 112A). Any rebate with special-rate income is shown on Checks. Surcharge 10/15/25/37% above 50L/1Cr/2Cr/5Cr, 25% cap in the new regime, 15% cap on 111A/112/112A, marginal relief at each band. Special rates 111A 20%, 112A 12.5% above 1.25L, 112 12.5%; the unused basic exemption set first against 111A (20%), then 112, then 112A. Chapter VI-A, each section's limit: 80C + 80CCC + 80CCD(1) 1.5L (80CCE); 80CCD(1B) 50k; 80CCD(2) 14% of salary in the new regime, 10% in the old (14% for a government employer); 80D 25k / 50k (senior) for self and family plus 25k / 50k (senior parents); 80DD 75k / 1.25L severe; 80DDB 40k / 1L senior patient; 80U 75k / 1.25L severe; 80TTA 10k (not seniors), 80TTB 50k (seniors only); 80GG 60k; 80EE 50k; 80EEA / 80EEB 1.5L; 80G 100% / 50% with qualifying donations within 10% of the adjusted gross total income and no cash above Rs 2,000. New regime: 80CCD(2), 80CCH and 80JJAA only. Regime: both worked out and shown; the owner chooses; old needs Form 10-IEA (asked) |
| ITR-4 | Resident individual / HUF / firm (not LLP), presumptive, TI up to 50L; not an individual who is a director in a company (a HUF: its karta), not an individual / HUF / firm that held unlisted equity shares, not agricultural income above Rs 5,000, no assets outside India, no TDS under 194N, no loss brought forward, up to two houses for AY 2026-27 (rule 12) | 44AD 6% of digital receipts + 8% of others (limit 2 Cr, 3 Cr if cash up to 5%); 44ADA 50% (50L, 75L if cash up to 5%; not HUF); 44AE Rs 1,000 a ton a month (heavy) / Rs 7,500 a month, at most 10 vehicles. Declared below the minimum, above the limit, wrong entity, TI above 50L, a tax audit or capital gains beyond 112A 1.25L: Needs you (ITR-3 / ITR-5) |
| ITR-5 | Firm / LLP | 30%, surcharge 12% above 1 Cr with marginal relief, no 87A. 40(b): interest to partners at most 12% simple; working partners' remuneration up to Rs 3 lakh or 90% of book profit on the first Rs 6 lakh (or a loss), 60% on the rest; book profit = business income before the remuneration (Explanation 3); a sleeping partner's remuneration not allowed |
| ITR-6 | Company | 25% if FY 2023-24 turnover up to Rs 400 crore, else 30%: asked, and the JSON is blocked until answered; surcharge 7% / 12% above 1 / 10 Cr with marginal relief. 115BAA: 22% + 10% + 4% (25.168%), no MAT, no MAT credit, Chapter VI-A only 80JJAA and 80M (115BAA(2)(ii); 80IAC and 80G not allowed). MAT 15% of book profit (+ surcharge, marginal relief, cess) when higher; else MAT credit set off down to the MAT (115JAA). The book profit must be entered with the 115JB Explanation 1 adjustments and confirmed (Needs you until then) |

### The schedules built in `next-itr-schedules` (heads.js, sched.js)

| Schedule | Rows from | Rules (and the checks) |
|---|---|---|
| S (ITR-3; ITR-4's salary lines) | Form 16 ("Take it"), else entered: employer, TAN, kind, 17(1), 17(2), 17(3), basic + DA, section 10 exemptions, HRA (metro, received, rent), professional tax, entertainment allowance, address | Gross = 17(1)+(2)+(3); exemptions within their limits (10(10) Rs 20 lakh, 25 lakh for government; 10(10AA) Rs 25 lakh; 10(10B), 10(10C) Rs 5 lakh; 10(13A) the least of the HRA received, rent less 10% of salary and 50% / 40% of salary, rule 2A); new regime: no 10(5), 10(13A), 10(14) (115BAC(2), rule 198), no 16(ii) / 16(iii); 16(ia) Rs 75,000 new / Rs 50,000 old, once, at most the salary. TDS on salary (192) from 26AS goes to Schedule TDS1 with each employer's chargeable salary. Checks: Form 16 against S (gross, by TAN), Form 16 TDS against 26AS, AIS salary against S |
| HP (ITR-3, 5, 6; ITR-4's houses, up to two for AY 2026-27) | Entered: let out / self-occupied / deemed let out, own share and co-owners, tenants, rent, unrealised rent, municipal tax paid, arrears (25A), loans (lender, account, date, amount, outstanding, interest) | Annual value = rent - unrealised - municipal tax (23); own share (26, rule 212); 30% (24(a)); interest (24(b)): self-occupied together at most Rs 2 lakh (Rs 30,000 for an old loan), none in the new regime; at most two self-occupied (23(4)); arrears at 70% (25A); a firm or company has no self-occupied house (ITR-5/6 let-out codes Y / D). Loss: set off up to Rs 2 lakh in the old regime (71(3A)), none in the new, carried forward (71B). Rent credited in the books' P&L is taken out of business (BP A3b), its expenses added back (A7b). Checks: AIS rent (194I / 194IB) against the owner's share of the rent |
| CG, 112A, SI (ITR-3 ScheduleCGFor23, ITR-5 / 6 ScheduleCG; ITR-4 LTCG112A) | The AIS's sales (SFT-17 securities and units, SFT-12 / 194IA property) offered as rows ("Add as a sale"), else entered: what was sold, dates, sale value, stamp duty value / FMV, cost, FMV on 31-01-2018 / 1-04-2001, improvements by year, expenses, 54-series exemptions, buyers | FY 2025-26 is wholly after 23-07-2024: long-term after 12 months for listed securities and equity fund units, 24 for the rest (2(42A)); 50AA assets always short-term; 50C (stamp duty value above 110%) and 50CA; 55(2)(ac) grandfathering of equity bought before 1-02-2018; 55(2)(b) FMV of 1-04-2001; improvements from 2001-02; 111A 20%, 112A 12.5% above Rs 1.25 lakh, 112 12.5% without indexation; proviso to 112(1)(a): land or building bought before 23-07-2024 by a resident individual or HUF, the tax above 20% with indexation (CII 376 for FY 2025-26) is ignored (per property, Schedule CG's TaxSec1121a / TaxSec1121aiiB / ExcessAmtSec1121a, taken off the 112 tax); buy-back from 1-10-2024: the cost a capital loss, the money dividend (46A, 2(22)(f)); 54EC at most Rs 50 lakh, 54 / 54F Rs 10 crore. Set-off within the head (70(2), 70(3)): the long-term loss first, then the short-term loss against normal-rate, 111A, 112, 112A gains (Table E); what is left carried forward (74; Schedule CFL), none from a belated return (80). 234C, proviso (a): an instalment is on the income as it stood on its date when the tax on the later gains was paid in the remaining instalments; Table F gives each rate's income by period. Checks: AIS sale of securities and of property against the rows; a buy-back's dividend asked |
| AL (ITR-3) | Entered | Total income above Rs 1 crore (validation rule 905): required, else the JSON is blocked. Assets other than those in Part A-BS, at cost. Checks: an AL figure equal to the books' cash or bank to the rupee is asked (likely the business's own); an interest in a firm is asked to be confirmed against the firm's balance sheet |
| FA (ITR-3, 5, 6) | Entered, the schema's own lists | Required when assets outside India are said; calendar year 2025. Checks: TCS 206C(1G) remittances with no FA asked; FA for a non-resident refused |
| SH, AL-1 (ITR-6, unlisted) | Entered, the schema's own lists (and the start-up lists) | SH-1 required for every unlisted company (blocked until given). Checks: shares x face value against the paid-up capital (3A, 3B); AL-1 loans given, shares and securities, loans taken against the balance sheet (38D / 12G / 12H, 36A / 37A, 30B / 33B); no AL-1 asked |
| Ind AS (ITR-6) | The books' codes; OCI entered | Part A-BS / P&L Ind AS from the same codes as Division I, the Division I parts left at 0 (and the reverse for a non-Ind AS company). Checks: the placing confirmed against the audited Ind AS statements (with the 115JB(2A) book profit) |
| OS (other sources outside the books) | Entered on Schedules | Interest not in the books, dividends (the AIS's shown), a buy-back's money |

Both computations work every head from the same rows (tax.js through heads.js; check.js with its own code), and must agree
on 25 figures (the 17 before, the salary, house property and capital gains heads, the short- and long-term capital
losses carried forward, and the house property and capital losses of earlier years set off). Agreement is not proof: the
review of 1dc8f9d8e found four rules both shared; tests/run_itr_law.mjs holds hand-worked figures for each.

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
whole balance: a leave provision of 30 lakh of which 3 lakh was charged this year adds back at most 3 lakh. A part of
the opening balance never paid down in the year (the ledger's lowest balance in the year, at most the opening) is an old
balance: never added back by FinCom, asked on Checks ("already disallowed in an earlier year, or paid?", `43b_stale`,
answered with a note). PF / ESI payments are matched by wage month: a challan for a month of the year (or a bank entry
naming none) settles this year's dues, a challan for an earlier month the old balance. Bonus, leave, interest and taxes
have no such link, so for them alone payments settle the oldest dues first (the old balance, then the rest of the
opening, then the year's charge): a fallback. The review's PF case: 2 lakh of stale arrears, 12 lakh charged, 3 lakh at
the year end, March's 1 lakh paid on 10 April: nothing added back, the 2 lakh asked. If the year's charge cannot be read,
the balance is taken and Checks asks (`43b_charge`).
PF / ESI: a ledger named for the employer's share, PF admin charges and EDLI are 43B in full (never split by the ECR); one
named for the employees' share ("Employee PF payable", "Employees PF payable", "Employee's contribution", "PF deducted",
"PF (employee)" and the ESI equivalents) is never 43B (it is 36(1)(va)); the schemes' own names (Employees' Provident
Fund, Employees' State Insurance) say nothing of the share; only a single ledger for both is split by March's ECR / ESI
challan (none: `43b_share`, Needs you, blocks). A
March challan and the April bank entry for it are one payment (same ledger, amount to the rupee, its TRRN / challan number
in the narration or dates within five days), at the challan's date. GST and TDS payable are listed (GST is under 43B only
when charged to the P&L; unpaid TDS is 40(a)(ia)).

**Earlier years' 43B paid this year** (AmtDisallUs43BNowAllow): from last year's return made in FinCom (each download
keeps what 43B added back by ledger, and what 43B(h) added back bill by bill: party, bill reference and date): allowed =
the part of last year's add-back paid in FY 2025-26, the year's payments settling first the part allowed last year; a
43B(h) bill is allowed when that bill (its reference and date in the payables' ageing) was paid in the year, never by the
party's name alone. Without last year's return in FinCom and with dues payable
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
| 43B and 43B(h) | Consistency: the return's 43B = this year's charge unpaid by the due date (each ledger: charge, payments, dates, employer's part); the return's 43B(h) = the MSME bills paid after their limit. Independent: the PF / ESI payments after the year end in the bank entries = the March challans; the bills settled by their references (the ageing) = the bills settled by the payment vouchers oldest first. Asked (blocking until answered): payment dates not shown, the employer's part of a joint PF / ESI ledger, the year's charge not read, earlier years' 43B paid; asked with a note: an old balance not reduced in the year (never added back); GST / TDS payable unpaid: asked |
| PF and ESI | An ECR for every month; a challan for every ECR; employer's PF in the books = the ECRs (+ admin charges); employees' share credited by the 15th of the next month (36(1)(va)); the dates feed 43B |
| Salary, house property, capital gains, AL, FA, SH | Form 16 against Schedule S (by TAN); Form 16 TDS against 26AS (192); AIS salary, rent, sale of securities and of property against S, HP, CG; the heads' own cuts (an exemption above its limit, a 54EC above Rs 50 lakh, an FMV of 31-01-2018 not given) as differences; three self-occupied houses; a buy-back's dividend; AL against Part A-BS; an interest in a firm; AL-1 and SH against the balance sheet; LRS remittances (206C(1G)) and FA; the Ind AS placing |
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
   (allowed amounts) and 112A (with the sale and cost entered), ITR-5's partners, ITR-6's MAT and MATC; from
   `next-itr-schedules`: Schedules S and TDS1, HP, CG / 112A / SI, AL, FA, SH, AL-1 and the Ind AS parts (a head's figure
   without its rows, AL above Rs 1 crore not given, foreign assets said with FA empty, an unlisted company without SH,
   still block). Not yet filled, so blocking when they have figures: the VI-A detail schedules
   (80C, 80D, 80DD, 80DDB, 80U, 80E, 80EE/A/B, 80G, 80GGA, 80GGC), UD and CFL rows of earlier years (and any loss or
   depreciation carried forward that the JSON does not hold; ITR-4 carries none),
   ITR-5 / ITR-6 Schedule VIA; capital losses and house property losses of earlier years (CFL rows of earlier years),
   virtual digital assets (115BBH) and the NRI parts of Schedule CG are not covered; also the authorised capital, the
   Ind AS question and the loans' purpose when not answered.
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
6a. **43B: oldest dues first is a fallback only.** PF / ESI payments are matched to their challan's wage month; an old
   balance not reduced in the year (any 43B ledger) is asked, never added back. Only for bonus, leave, interest and taxes,
   where nothing links a payment to the due it settles, are payments taken against the oldest dues first (after the old
   balance). Confirm, or say where those payments are linked.
6b. **This year's unabsorbed depreciation in Schedule UD, the rest of the loss in CFL** (section 32(2)); the utility's
   rule 618 reads CFL against CYLA's whole balance. Each such return asks to confirm on Checks (`ud_split`, open). Run one
   split return through Winman and the offline utility. If rule 618 forces the whole balance into CFL, set UD's
   current-year row to 0 and keep the 32(2) depreciation as a working note.
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

### Owner decisions from `next-itr-schedules` (to confirm)

13. **Schedule AL threshold: Rs 1 crore, not Rs 50 lakh.** The brief said "AL when income > 50 L"; the AY 2026-27 ITR-3
    validation rule 905 (CBDT, V1.0) reads "Total Income is greater than Rs. 1 crore then Schedule AL is required". FinCom
    requires AL above Rs 1 crore and fills it whenever it is entered (so the firm can give it from 50 lakh as its own
    practice). Confirm.
14. **The proviso to 112(1)(a)** (settled by the CA review of 1dc8f9d8e): the two taxes are compared on the gain actually
    chargeable, after the set-offs and the basic exemption: per property, the lower of 12.5% of its chargeable gain and
    20% of its chargeable indexed gain (tax.js tax112). What came off the 112 income is put on the covered property first,
    up to its indexed gain, then on the other 112 gains. Schedule CG's TaxSec1121a / TaxSec1121aiiB / ExcessAmtSec1121a
    carry these chargeable figures. **To confirm:** the utility's own per-row figures for a return with a set-off may
    differ; run one through it.
15. **The order of set-off** (settled by the review): across heads, the normal-rate heads first (a house property loss
    against salary first; a business loss and unabsorbed depreciation never against salary), then 111A (20%), 112, 112A.
    Within capital gains (settled by the re-review of 23ee460d1): gains and losses net within Table E's categories (20%,
    applicable rates, 12.5%); a long-term loss goes on 112 while it still saves tax there (a covered property up to its
    indexed gain), then on 112A above its Rs 1.25 lakh exemption, then the rest; a short-term loss is set off both ways
    (the other short-term category first, or the 12.5% gains first) and the order with the lower tax liability kept, in
    both computations. The losses of other heads, losses brought forward and the unused basic exemption take the
    special-rate income in the same cheapest-first order (final review of b8126ecbc): 111A, the 112 income still taxed
    (a covered property up to its indexed gain, other 112 gains), 112A above Rs 1.25 lakh, then the rest (tax.js
    takeSpecial, check.js absorbSpecial); a seeded brute force over the long-term loss's split checks FinCom is never
    dearer. In the new regime (115BAA for a company) the part of an earlier business or house property loss that came
    from barred deductions is asked and not set off (115BAC(2)(ii)); Schedule CFL shows it in AdjustAccTax115BACAmt
    (ITR-6: AmtAdjAccOptTaxUs115BAA_115BA). A business loss, a house property loss and unabsorbed
    depreciation (final check of fb123bc6a) each take the normal-rate income down to a slab limit (0 to 24 lakh, or
    none), then the special-rate income in one of three orders (111A first; 112A above its exemption first; or 111A
    kept at the Rs 62,500 whose tax the old regime's 87A rebate covers), then the rest; the basic exemption likewise in
    one of those orders. Both computations try every order with each loss's limits and keep the lowest liability (ties:
    the first tried); with two or more losses they also start from the same limit for every loss (final check of
    f10f5a715). `node tests/run_itr_law_joint.mjs` (slow, about a minute; JOINT_N returns per half) tries every
    combination of the three losses' limits and orders jointly on seeded made-up returns and checks FinCom is never
    dearer. A seeded brute force splits each loss every way between normal and special-rate income (old-regime
    rebate cases included) and checks FinCom is never dearer. Schedule UD's earlier-year rows are filled (AY, brought
    forward, the 115BAC / 115BAA adjustment, set off this year oldest first, balance), so UD no longer blocks when the
    years are given on the losses card.
16. **234C proviso (a).** Applied only when the advance tax paid after an instalment date (up to 31 March) covers the extra
    tax from the capital gains that accrued after it; the proviso for dividends is not applied yet.
17. **ITR-3's Schedule AL is "other than those included in Part A-BS"**: FinCom asks when an AL figure equals the
    business's cash or bank to the rupee, and never treats the capital account as an AL item. Confirm the reading.
18. **Ind AS parts placed from Division I codes** (preference shares kept in equity, tax assets with current assets);
    asked per return (`indas_map`). An Ind AS company's Division I parts are left at 0, a non-Ind AS company's Ind AS
    parts at 0: confirm Winman takes the JSON so.
19. **Cost inflation index 376 for FY 2025-26** (363 for 2024-25): confirm against the notification.
20. **Form 16 and the AIS's salary / sale codes** (TDS-192; SFT-17 sales; SFT-12 sales and TDS-194IA) are read from the
    published layouts: confirm on the first real files.
21. **Gratuity of a government employee** (settled by the review): wholly exempt under 10(10)(i); above Rs 25 lakh a note
    says the utility may cap it, so the CA compares the utility's figure. Professional tax above Rs 2,500 (Article 276) is
    said, not cut.
23. **From the review of 1dc8f9d8e, built:** 54EC Rs 50 lakh in all in the year and for land or building only; 54 for a
    residential house sold (marked on the sale); 54 / 54B / 54F for individuals and HUFs only; 54F = gain x cost of the
    new house (up to Rs 10 crore) / net consideration; 54 = the lower of the gain and the cost (up to Rs 10 crore).
    Basic + DA asked (never the whole 17(1)) for HRA, 16(ii) and 80CCD(2); the kind of employer asked (never "Others" by
    default); Form 16's 115BAC opt-out compared with the return's regime; the sale date within the year and the purchase
    before it (a sale without a date blocks); a buy-back's money in other sources (2(22)(f)) with the 194 TDS shown; the
    self-occupied interest cap by each house's own loan date; pre-construction interest a fifth; the proviso to 55(2)(b);
    194IA TDS (1% of the higher of the consideration and the stamp duty value) against 26AS; earlier years' house property
    (71B) and capital (74) losses entered and set off within eight years (their Schedule CFL rows still block the JSON);
    Ind AS: preference share capital a financial liability unless said to be irredeemable (Ind AS 32), asked.
24. **To confirm:** a listed share bought back through the exchange is treated as STT-paid (its loss in the 20% / 112A
    columns); 54F needs the new house's cost (asked when only an amount is given).
25. **From the re-review of 23ee460d1, built:** each 54EC claim sits on the sale it relates to, and the Rs 50 lakh is
    shared where it saves the most (a covered property up to its indexed gain first), never by entry order; the dates
    checked: 54EC bonds within six months after the sale, 54 / 54F a house bought a year before to two years after or
    built within three years, 54B land within two years, or the Capital Gains Account Scheme deposit by the due date of
    139(1) (a claim without its date is asked); 54B only for land ticked as farmed for two years, and agricultural land
    asked whether it is urban (rural land is not a capital asset); 194IA's Rs 50 lakh on the whole property's price;
    the second computation's 80CCD(2) from its own salary rows; Schedule CFL's earlier-year rows filled (date of filing,
    and a loss of a year filed late is not carried, section 80), so CFL no longer blocks once each year's date is given.
    `ITR_LIB=<dir> node tests/run_itr_law.mjs` runs the hand-worked cases against an older copy of the library.
22. **An unlisted company with no AL-1 asset**: asked with a note (`al6_none`), the JSON then carries no AL-1. Confirm.

## 8. Tests

All on made-up data (`tests/fixtures/itr/`, `tests/itr_demo.mjs`):

| Test | What |
|---|---|
| `node tests/run_itr_imports.mjs` | Each kind detected with PAN / AY / month, counts and totals, the PDF route, refusals (another PAN, another year, unknown, locked, an ITR JSON, no month), re-import, firm storage only, nothing logged |
| `node tests/run_itr_tax.mjs` | Every rule with hand-worked figures and edge cases (87A and its relief, surcharge bands with marginal relief, both regimes, seniors, MAT and credit, 115BAA, 40(b), 44AD / 44ADA / 44AE thresholds, losses, VI-A limits, special rates, rounding, 234A/B/C/F, 43B and 36(1)(va) dates); 600 random returns through both computations; a planted one-rupee difference caught |
| `node tests/run_itr_schema.mjs` | Pinned schema files; every form and scenario passes ajv and the page's validator alike; planted faults rejected by both; non-amount fields asked, never filled; the JSON's figures are the computation's; the review's loss cases (PBT -1 lakh / -5 lakh with depreciation of 4 lakh) carried in Schedules UD and CFL for ITR-3, 5 and 6; a carry-forward the map does not hold blocks |
| `node tests/run_itr_verify.mjs` | Every check Matched on agreeing sides, and each planted fault found with its exact amount; Missing / Needs you; consistency checks labelled; 43B on this year's charge (the 30 lakh leave provision), employer / employees' PF ledgers by their usual names, admin charges and EDLI, PF by wage month and the old balance asked (the review's 2 lakh arrears), one payment per challan, earlier years' 43B (43B(h) bill by bill); payment dates answered item by item changing the computation; the gate |
| `python3 tests/run_itr_ui.py` | The page, desktop and phone: Data, a file brought in, a wrong PAN refused, re-import, the sheet with its ledgers, PDF, Excel, the checks, a difference opened, accepting only with a note, the JSON offered only when settled, the download passing ajv; fits the width. `ITR_SHOTS=<dir>` saves the design screenshots |
| `node tests/run_itr_law.mjs` | The CA review's points, each figure worked by hand from the Act and checked in both computations on its own: set-off order across heads (3,73,750; special tax 25,000), the proviso to 112(1)(a) on the chargeable gain (53,425; 84,625; 1,83,425), 54EC / 54 / 54F who and how much (50 lakh in all; 7.5 crore), basic + DA, the employer's kind, government gratuity, sale dates, buy-back dividend, 55(2)(b), the self-occupied cap by loan date, pre-construction interest, 71B / 74 losses of earlier years, the Form 16 regime and 194IA checks |
| `node tests/run_itr_law_joint.mjs` | Slow: a joint brute force over the placing of three losses of other heads and the basic exemption (every limit and order together), both regimes and old-regime returns near Rs 5 lakh, seeded xorshift32; FinCom never dearer than the best (ITR_LIB runs it against an older library) |
| `node tests/run_itr_schedules.mjs` | The schedules by hand: salary in both regimes (HRA by rule 2A, one standard deduction, gratuity cap), house property (annual value, 30%, the self-occupied cap, co-owners, arrears, three self-occupied), capital gains (CII, holding periods, 55(2)(ac), 50C at 110%, indexation and the proviso's 2,93,630, no proviso for a non-resident or a company, set-off within the head and carry forward, buy-back, 54EC cap, the 234C accrual); whole ITR-3 / ITR-4 / ITR-5 / ITR-6 returns through both computations and ajv (Schedules S, HP, CG, 112A, SI, CFL, AL, FA, SH, AL-1, Ind AS); the checks (Form 16, AIS salary / rent / sales, AL, SH, Ind AS); 300 random returns with salary, houses and sales: both computations agree |
| `node tests/run_itr_formpick.mjs` | Which form: the recommendation and its reason for each fourth letter of the PAN, the person's choice kept (an old ITR-5 of a company not kept silently), what the JSON covers; on the page, S and FS read as the script's own names (the answers kept in the client's books) |
| `python3 tests/run_side_itr_ui.py` | The sidebar scrolled (classic and New look, 1000 / 1440 px, folded): the FinCom row and the client card stay, painted, above the menu; a company's return on the real page: ITR-6 recommended, the chooser, ITR-5 / ITR-7 said, the choice kept per client. `TDSDESK_SHOTS=<dir>` |
| `python3 tests/run_itr_schedules_ui.py` | The Schedules step, desktop and phone: the Form 16 on Data, each head's figure, a sale opened, an AIS sale taken, an employer taken from Form 16, a house added, FA's lists from the schema, the Computation and the Checks group; ITR-6's SH, AL-1 and OCI. `ITR_SHOTS=<dir>` saves the screenshots |
| `run_every_screen.py`, `run_legacy_room.py` | The five steps open on real (fixture) books with no error; legacy.js and the first file within their budgets |

Run `sh tools/itr-schemas.sh` before building and before the schema test.
