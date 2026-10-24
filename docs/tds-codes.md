# TDS section codes and TCS collection codes in FinCom's return files

*14-Oct-2026, branch `tds-layout`, after the independent TDS review (`tds-review.md`, findings H3 and H4).*

FinCom keeps the codes it writes into the 26Q, 27Q and 27EQ text files in **one place each**:

- **Section codes** of the deductee (DD) records: `TDS_SEC_CODES` in `src/js/16-the-26q-text-file-as-the-fvu-expects-it-.js`.
  - A section that is not listed there keeps the code FinCom has always written: 194C → 94C, 194A → 94A, 194H → 94H, 194Q → 94Q, and so on. 195 stays 195.
  - `TDS26Q.codeFor(row)` reads the table.
- **TCS collection codes**: `TCS27EQ.CODES` in the same file, with the rates by date in `TDS.TCS_RATES` (`src/js/09-tds.js`).

## Unverified – owner to confirm against Protean's list

> **Not checked against Protean's file format.** Protean's site could not be reached from where FinCom is built.
> - The values below are the reviewer's memory of the format.
> - FinCom writes them, and the file tab says **"Check with Protean's FVU before filing."**
> - Confirm each one against the *File Format – TDS/TCS statements* PDF on Protean's site (the version that matches the current FVU), then mark it confirmed here and in `TDS_SEC_CODES` (`unverified: true` → removed).

| Section | What was paid for (FinCom's `r.pay`) | Code FinCom writes | Status |
|---|---|---|---|
| 194J(a): fees for technical services | `technical` | 4JA | in FVU 8.7's list of 26Q codes (17-Oct-2026); that 4JA is the technical one is **unverified** |
| 194J(b): professional fees | `professional` | 4JB | in FVU 8.7's list; that 4JB is the professional one is **unverified** (Protean's 2018 annexure lists only 94J for 194J) |
| 194J: director's fees, or kind not known | none | **no code**. The file names the deduction and asks for the kind | |
| 194-I(a): rent of plant and machinery | `rent_machinery` | 4IA | confirmed: Protean's 2018 annexure (as quoted by the coordinator's sources) |
| 194-I(b): rent of land, building or furniture | `rent_building` | 4IB | confirmed: Protean's 2018 annexure |
| 194-I, kind not known | none | **no code**, as above | |
| 194DA | | 4DA | in FVU 8.7's list of 26Q codes |
| 194BB | | 4BB | in FVU 8.7's list of 26Q codes |
| 194LA | | 94L | changed 17-Oct-2026: FVU 8.7's list has 94L and no 4LA (it rejects 4LA) |

FVU 8.7's own list (read from the FVU, 17-Oct-2026) of the codes a 26Q deductee record may carry: 193, 94A, 94B, 4BB, 94C,
94D, 4EE, 94F, 94G, 94H, 4IA, 4IB, 94J, 94L, 194, 4BA, 4DA, LBB, 9IA, 2AA, LBC, 4IC, 94N, 94K, 4JA, 4JB, BA1, BA2, 4NF, 94O,
94Q, 94S, 94R, 4BP, 4RP, 4SP, 9BA, 4NC, 9FT, 4AP; 27Q's: 94E, 195, 96A, 96B, 96C, 96D, 4LB, 4LC, 4LD, 4BA, LBB, 2AA, LBC, 94N,
BA1, BA2, BA3, 4NF, 6DA, LC1, LC2, LC3, 94B, 4BP, 9BA, 4AP, 4BB, 4NC, 9FT. 194T (from April 2025) is not in FVU 8.7's list: a
later FVU is needed for it. (24-Oct-2026: confirmed on the FVU itself: 4T, 94T, 194T, 4TA and 9TA are all refused, T-FV-4301; FinCom
writes 94T and Validate & file warns. Which remarks FVU 8.7 takes with which code: `docs/fvu-check.md`, "FVU 8.7's rules".) 27EQ's collection code is written as its letter (6CE is E).

What FinCom used to write before 14-Oct-2026:

- 94J for both kinds of 194J;
- 94I for both kinds of 194-I;
- 94DA, 94BB and 94LA.

The test `tests/run_tds_review.js` (H4) checks that 194J technical and professional get different codes, as do 194-I machinery and building, and that 194C stays 94C. It does not check the values themselves.

**Also to confirm (review M3):** 194-IA, 194-IB and 194M are now left out of 26Q. To fix lists them as *"file in 26QB / 26QC / 26QD on the portal"*.

These codes are for **FY 2025-26 and earlier** (26Q / 27Q / 27EQ: late returns and corrections only). From FY 2026-27 the new forms carry payment codes instead: below.

## Payment codes of the new forms, FY 2026-27 onward (14-Oct-2026, H4)

From tax year 2026-27 the forms of the Income-tax Act, 2025 (138, 140, 143, 144) carry a **4-digit payment code** for each deduction in place of the old section code. FinCom chooses by the return's year: up to 2025-26 the section codes above; from 2026-27 this table (`PAY_CODES` in `src/js/16-the-26q-text-file-as-the-fvu-expects-it-.js`, read by `TDS26Q.payCodeOf`).

> **Confirmed by several sources; official text not reachable.** The official sites (incometaxindia.gov.in, Protean) could not be reached. These codes come from secondary sources that agree with each other: taxguru, caclubindia, tdsman, taxupdate, figmentglobal, and the GimBooks and TaxGST rate charts. Check each against Protean's file format for the new forms before filing; the new-form files stay marked **draft** (`NEW_FORMS_VALIDATED`) until then.

| Form | Payment | Old section / code | Payment code | Status |
|---|---|---|---|---|
| 140 (s.393(1)) | Fees for technical services, 2% | 194J(a) | **1026** | several sources agree |
| 140 | Fees for professional services, 10% | 194J(b) | **1027** | several sources agree |
| 140 | Remuneration etc. to a partner | 194T | **1067** | several sources agree |
| 140 | Rent | 194-I(a) / 194-I(b) | **none written** | **UNCONFIRMED**: the sources disagree (1008/1009, or 1016/1017/1019) |
| 143 (s.394(1)) | Alcoholic liquor for human consumption | 6CA | **1068** | several sources agree |
| 143 | Tendu leaves | 6CI | **1069** | several sources agree |
| 143 | Timber obtained under a forest lease | 6CB | **1070** | several sources agree |
| 143 | Timber obtained by any other mode | 6CC | **1071** | several sources agree |
| 143 | Any other forest produce | 6CD | **1072** | several sources agree |
| 143 | Scrap | 6CE | **1073** | several sources agree |
| 143 | Minerals and the others (1074 onward in some sources) | 6CF … 6CO | **none written** | **UNCONFIRMED** |
| 144 | every payment | 195 etc. | **none written** | **UNCONFIRMED** (no source list yet) |

Rules FinCom follows:

- **Never an inferred code.** Several sources say 1007, 1010, 1025 and 1036 are inferred, not notified. FinCom never writes them (the test checks).
- **Never a silent pick.** A deduction whose payment code is unconfirmed (rent, any section or collection code not in the table, a 194J whose kind is not known) gets no code in the file. The return's **To fix** lists it as **"payment code to confirm"**, with why (`TDS26Q.payCodeRows`), and the file's message names it.
- Tests (`tests/run_tds_review.js`, H4): a 2026-27 Form 140 writes 194J(b) as 1027 and 194J(a) as 1026; a 2025-26 26Q keeps 4JA / 4JB / 4IA / 4IB; a 2026-27 rent deduction is in To fix; a 2026-27 Form 143 writes scrap as 1073 and lists a parking-lot collection.

## TCS collection codes (fixed 14-Oct-2026, H3)

Official list:

- Source: the note "Collection Code" to Form No. 27EQ (Income-tax Rules, 1962).
- TRACES copy: https://traces61contents.tdscpc.gov.in/forms/Form-27EQ.pdf.

| Code | Nature | Rate to 31-Mar-2026 | Rate from 1-Apr-2026 |
|---|---|---|---|
| 6CA | Alcoholic liquor for human consumption | 1% | **2%** (several sources agree) |
| 6CB | Timber obtained under a forest lease | 2.5% | 2.5% |
| 6CC | Timber obtained other than under a forest lease | 2.5% | 2.5% |
| 6CD | Any other forest produce | 2.5% | 2.5% |
| 6CE | Scrap | 1% | 2% |
| 6CF | Parking lot | 2% | 2% |
| 6CG | Toll plaza | 2% | 2% |
| 6CH | Mining and quarrying | 2% | 2% |
| 6CI | Tendu leaves | 5% | **2%** (several sources agree) |
| 6CJ | Coal, lignite or iron ore | 1% | 2% |
| 6CL | Motor vehicle above ₹10 lakh | 1% | 1% |
| 6CO | Overseas tour programme package | 5% (20% above ₹7/10 lakh) | 2% |

How the list was wrong, and what was changed:

- **Before 14-Oct-2026:** FinCom's list was shifted by one from 6CB to 6CI. Scrap was written as 6CF (parking lot), tendu leaves as 6CB, and so on.
- **Codes a person had already chosen:** these were chosen against the old words, so they are moved once to the same nature's official code. `TCS27EQ.fixCodes`, marked `tcsCodesFixed` in the books.
- **From 1-Apr-2026 (s.394(1) of the Income-tax Act, 2025; review M5):** alcoholic liquor 2% and tendu leaves 2% (1% and 5% up to FY 2025-26). **Confirmed by several secondary sources; official text not reachable** (taxguru, caclubindia, tdsman, taxupdate, studycafe, figmentglobal, GimBooks and TaxGST rate charts; re-checked 14-Oct-2026).
- **Not yet in the list (review L3):** the luxury-goods codes from 22-Apr-2025, and 6CK, 6CM, 6CN, 6CP and 6CQ. They are left out until confirmed.

## TCS return due dates (H2)

- **Up to tax year 2025-26:** Form 27EQ is due on the 15th of July, October, January and May.
- **From tax year 2026-27:** Form 143 follows the TDS calendar: 31 July, 31 October, 31 January and 31 May (Rule 219 of the Income-tax Rules 2026, s.397(3)(b)).
- `TDS.returnDue` and `TDS.dueWords` give both the late fee and the date shown on screen.
- **Confirmed by several secondary sources; official text not reachable** (taxguru, caclubindia, tdsman, taxupdate and studycafe agree on 31 Jul / 31 Oct / 31 Jan / 31 May for Form 143 from tax year 2026-27; re-checked 14-Oct-2026).
