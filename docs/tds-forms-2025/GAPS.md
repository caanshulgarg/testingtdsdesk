# Forms 138, 140, 143, 144: FinCom's draft against Protean's file format

Branch `next-tds-forms-2025`, 17-Oct-2026. The authority: Protean's file-format workbooks, version 1.1 of 22-07-2026
(`138.md`, `140.md`, `143.md`, `144.md` here, field by field), the Gazette forms (the PDFs), and as the final judge
Protean's own FVU 1.2 (17-Aug-2026), which the owner supplied. FVU 1.2 is not committed; `tests/run_fvu12_forms.py` runs
it when `TDSDESK_FVU12` names its folder.

## 1. What FinCom wrote before (the "draft until Protean docs" builders)

Up to this branch, Forms 140 / 144 / 143 were written by `TDS26Q.build` and Form 138 by `TDS24Q_FILE.build` with the
layout FinCom had made for 26Q / 24Q, only the form number and some codes changed. Against the workbook every record was
wrong:

| Record | FinCom wrote | The workbook has | Differences |
|---|---|---|---|
| FH | 17 fields | 18 | one field short; Form 143 had file type NS1 (must be **TC1**) |
| BH | 39 fields | 72 | TAN at 5 (must be 13), PAN at 6 (15), **tax year before assessment year** (16 must be AY 202728, 17 TY 202627), quarter last (18), name and address shifted; state written as text (must be the Annexure 1 code, e.g. Delhi 09); no country (20), no country codes (29, 44), no responsible person's country (43, mandatory), no **PAN of the responsible person (59, mandatory)**, no batch total (47), field 52 at the wrong place, no AIN / State / Ministry for Government; deductor category defaulted to "F" for every client |
| CD | 26 fields | 30 | the tax (8) was this return's deductions, not the **challan as deposited** (Gazette Note 6: "the exact amount deposited through challan"); BSR (15), serial (17), date (19), mode (13), minor head (23) all at other places; no interest / others allocation (24, 25) |
| DD | 27 (26Q) / 35 (27Q, 27EQ) fields | 45 | old 26Q order: PAN at 7 (must be 8), section code at 21 (15), dates, amounts, rate, remark and certificate all at other places; a "deductee code" 01/02 that the new forms do not have; "whether deposited" (18, mandatory) missing; certificate cut to 10 characters (the workbook allows 10 or 15) |
| DD 138 | section "92B" | 1001 / 1002 / 1003 / 1032 | old code; no date of deposit (29) |
| DD 144 | 27Q's tail (rate A/B, nature, 15CA, country, e-mail, phone, address, TIN) in 27Q's order | fields 12, 14, 16, 17, 21, 30, 31, 37, 38, 39, 41 | no status (12), no opting-out (14), no grossing up (21); country written as typed (must be **Annexure 10's own numbering**, e.g. USA 267, India 113) |
| DD 143 | 27EQ's tail (non-resident, "") | fields 11-14, 34-36 | no collectee code (12), no PE (13), no opting-out (14); code for every collection from the old 6Cx list |
| Q4 138 | SD records in 24Q's layout | not in the workbook (Q1 to Q3 only) | made a file no FVU would take |

Codes: `PAY_CODES` had only 194J (1026/1027), 194T (1067) and six TCS codes; rent (194-I) was "unconfirmed"; 194C had no code.

## 2. What this branch changes

- New builder `TDSF25` (`src/js/83-tds-forms-2025.js`): each record has the workbook's number of fields and each value
  is put at its field number. `TDS26Q.build` and `TDS24Q_FILE.build` call it for tax year 2026-27 on; **for earlier years
  the old 24Q / 26Q / 27Q / 27EQ files are made exactly as before** (tested).
- The period rule is unchanged: `TDS.isNew(fy)` (`src/js/09-tds.js`), new forms from tax year `2026-27` (`NEW_FROM`). The
  workbooks say "for Tax Year 2026-27 onwards" and AY "greater than or equal to 202728", which agrees.
- `PAY_CODES` (`src/js/16`) rebuilt from Annexure 2 of each workbook (table in section 4); `payCodeRows` (To fix) follows.
- `TDSF25` never guesses: a value FinCom does not hold is left empty and named in `problems` (shown in the download's
  message); what FinCom read rather than was told is in `notes` (e.g. the category from the PAN).
- `TRF.parseConso` (`src/js/70`) reads a TRACES consolidated file in the new layout by field number (it took the
  assessment year for the tax year and the minor head for the challan serial).
- The file stays a draft (`NEW_FORMS_VALIDATED` false, file name `_DRAFT`, not sent to the FVU from FinCom) until the
  owner decides; see question 1.

## 3. What FVU 1.2 says (run on FinCom's files)

- **Form 138, 140, 143, 144 as a Government's book-adjustment statement (V files) and the owner's samples rebuilt by
  FinCom with a DDO serial (B files): valid, no error.**
- As a challan ("C") statement: only T-FV-1041 "Challan Input File (CSI File) is Mandatory". Without the .csi file
  (which only TIN / the e-filing portal give, for a real TAN) FVU 1.2 stops before the deductee records, so the deductee
  records are proved through the V and B files. FinCom does not make a .csi.
- FVU 1.2 over the workbook (FinCom follows FVU 1.2):
  - Form 138 BH field 49 "Count of Salary Details Records" must be **0** for Q1-Q3 (T-FV-2127); the workbook says
    "Not applicable"; the RPU sample writes 0.
  - Deductee records are numbered **from 1 under each challan** (T-FV-4007); the workbook's Form 144 says "in a batch".
  - Form 144 fields 37, 38, 39, 41 (address, e-mail, phone, TIN in the country of residence) are taken **only with remark
    C and no PAN and a nature of remittance 05, 06, 07, 10-14, 16 or 17**, and are needed then when the rate is below
    20%; otherwise they must be empty (T-FV-4335 to 4343). The workbook's rule (rate below 20%, or remark C, or no PAN, or
    natures 16, 27, 49, 21, 52, 31) is not what FVU 1.2 does.
  - Form 144 nature of remittance: FVU 1.2 uses the workbook's Annexure 9 codes (16, 73 with 1046-1057; 21, 28, 49, 74,
    75, 99 with 1057 only; 27 …), not the Gazette's list 1-19; but its contact-field rule above uses 05-17. Mixed.
  - A transfer voucher's date must be the last day of its month (T_FV_3157); a Form 24G receipt number is checked
    (T-FV-3149: 2000091 refused, 2000090, 3000012, 4000013 taken).
  - BH field 43 (responsible person's country) is needed (the samples, which leave it empty, fail with T_FV_6468).
- The owner's RPU 1.0 samples (06-05-2026) fail FVU 1.2 as they are: BH 43 empty, DDO serial empty, and Form 144's remark A
  without a certificate number and nature 16 with section code 1042.

## 4. The codes FinCom now writes (old section → Annexure 2 code)

Form 140 (Annexure 2, xlsx rows 242-282; Gazette p.2314-2316): 192A→1004, 193→1019, 194→1029, 194BB→1062,
194C→1023 (individual / HUF: PAN's 4th letter P or H) or 1024 (others; no valid PAN: to confirm), 194D→1005, 194DA→1030,
194EE→1066, 194G→1063, 194H→1006, 194-I→1008 (plant, machinery) / 1009 (other), 194IC→1011, 194J→1026 (technical) /
1027 (professional) / 1028 (director), 194K→1013, 194LA→1012, 194LBB→1017, 194LBC→1018, 194O→1035, 194Q→1031,
194T→1067. **Left to confirm (no code, in To fix):** 194A (1020 / 1021 when a bank, co-operative bank or post office pays,
1022 otherwise), 194B (1058 / 1059 in kind), 194BA (1060 / 1061), 194R (1033 / 1034), 194S (1037 / 1038), 194N (1064 /
1065, and the cash amount), 194LBA (1014 / 1015 / 1016), and any section not listed. 1007, 1010, 1025, 1036 are not in
the annexure.

Form 144 (Annexure 2, rows 242-271): 195→1057 ("any other sum chargeable", 393(2) Sl. 17), 194E→1039. Others (194LB,
194LC, 194LD, 196A-196D → 1040-1056, split by kind and date) to confirm.

Form 143 (Annexure 2, rows 242-266; Gazette Note 9): 6CA→1068, 6CI→1069, 6CB→1070, 6CC→1071, 6CD→1072, 6CE→1073,
6CJ→1074, 6CL→1075, 6CF→1090, 6CG→1091, 6CH→1092. 6CO (overseas tour: 1088 up to the limit, 1089 above) to confirm;
luxury goods (1076-1085) and LRS (1086, 1087) are not codes FinCom's ledgers carry.

Form 138 (Annexure 2, rows 240-245): by the deductor's category: Central Government (A)→1003, State Government (S)→1001,
non-Government (K, M, P, T, J, B, Q, F)→1002; statutory, autonomous and local bodies (D, E, G, H, L, N): to confirm.

## 5. Still not done (and why)

- **Form 138 Q4**: refused (no record layout for Annexure II / III salary details in the workbook the owner has).
- **No screen for the deductor's details**: FinCom has never had one (`co.tds26q` is read, nothing writes it). The new
  forms need more of them (country, post office, phone country code, PAN and country of the person responsible, category,
  State / Ministry / AIN for Government). Until a screen exists the file lists them as things to fix.
- **No inputs for** opting out of 202(1) (143, 144), grossing up under 393(10) (144), PE in India (143 non-residents),
  status / collectee code where the PAN does not say it. FinCom reads them from `S.books.nrInfo[party]` (`optOut`,
  `grossedUp`, `pe`, `status`) when present; otherwise left empty and listed.
- Remarks other than A and C (B 15G/15H, Y threshold, T transporter, …), cash-withdrawal amounts (1064 / 1065), the
  in-kind columns of the Gazette annexures, nil challans, corrections: not made.
- A challan file (.csi) cannot be made by FinCom; FVU 1.2 needs the deductor's own for a "C" statement.

## 6. The owner's answers (17-Oct-2026), as built

- **Draft marking stays on** until a challan-paid statement with a real .csi passes FVU 1.2 (he will provide .csi files).
- **Form 138 Q4** refused: "Protean has not yet released the Q4 layout for Form 138".
- **The challan record carries the challan's full deposited amount**: kept.
- **194A interest**: 1022 for a client that is not a bank, co-operative bank or post office. FinCom did not know this, so
  Client setup → TDS has "This client is a bank, co-operative bank or post office" (default No, `co.tds26q.isBank`). When
  Yes, the codes that depend on it: 194A → 1020 (deductee a senior citizen) or 1021 (others), which FinCom asks for each
  deductee in To fix (it does not hold the deductee's age); 194N cash withdrawals → 1064 (to a co-operative society) / 1065
  (others), which stay to confirm with the amount above the limit.
- **An inoperative PAN** (right form, not linked): remark C, the PAN as it is, at the higher rate FinCom works out; in all
  four forms (Form 138 too). FVU 1.2 takes it (tests: I138, I140 valid).
- **Deductor details screen**: Client setup → TDS → "Deductor details for the TDS statements": category (default from the
  PAN's 4th letter, shown and changeable), TAN, GSTIN (the client's own unless given), the bank question, the deductor's
  address (flat*, post office, building, road, area, district, state*, PIN*, country, e-mail*, phone country code, phone*),
  the person responsible (name*, designation*, PAN*, the same address lines, state*, PIN*, country, e-mail, mobile country
  code, mobile*), and for Government categories only the State (S, E, H, N), the Ministry (A, D, G required; E, H, L, N
  optional) and the AIN (A, S). Each field checked by `TDSF25.deductorProblems`, the same function the files use, and the
  problem shown beside it. Kept as `co.tds26q`; the old 24Q / 26Q / 27Q / 27EQ files read the same keys (their category
  still "F" unless one is chosen, as before).

## 7. Questions for the owner (as asked on 17-Oct-2026; 1, 2, 3, 6, 7, 8, 15 are answered above)

1. **Switch the draft off?** FinCom's files pass FVU 1.2 (book adjustment fully; by challan up to the .csi). Shall
   `NEW_FORMS_VALIDATED` become true (file not named _DRAFT, sent to the FVU from FinCom), after you run one real
   statement with your .csi through FVU 1.2?
2. **A challan shared by two quarters (or two forms)**: the workbook says CD field 24 / 25 (interest / others allocation)
   = fields 9 / 11 (xlsx rows 142-143), so each statement shows the challan's whole interest; FinCom's register splits it.
   FinCom now follows the workbook. Right? (The RPU samples leave 24 / 25 empty; FVU 1.2 takes them filled.)
3. **CD field 8 is the challan's whole tax** (Gazette Note 6), no longer this return's share (as the TDS review H5 had
   it). Confirm.
4. **Form 138, date of deposit (DD field 29)**: FinCom writes the challan's date; the sample's (09-05-2025) is not its
   challan's (30-04-2025), and RPU 1.2 has it as a column the user types. Same date always? (xlsx row 181; it is typed
   DECIMAL 7 there.)
5. **Form 138 section code**: the sample has 1001 and 1003 in one State Government statement. How are Union Government
   employees of a State deductor to be told apart? And which code for statutory, autonomous and local bodies (D, E, G,
   H, L, N)? (xlsx Annexure 2 rows 240-245; Gazette p.2303)
6. **Form 138 Q4**: please get Protean's Q4 file format (Annexure II, III; FVU 1.2 expects SD records, T-FV-2133).
7. **An inoperative PAN** (right form, not linked): Form 138's Annexure 6 allows remark C only for a structurally invalid
   PAN (xlsx row 370). FinCom writes C for an inoperative PAN in 140 / 143 / 144 (and says so in the file's problems).
   What should the file say?
8. **194A interest** (1020 / 1021 / 1022): may FinCom write 1022 for a client that is not a bank, co-operative bank or
   post office? (Gazette 140 p.2314, payer column)
9. **The other splits left to confirm** (section 4): 194B, 194BA, 194R, 194S, 194N, 194LBA, 6CO, and Form 144's
   194LB / 194LC / 194LD / 196A-D. Which facts decide them in your clients' books?
10. **Form 144 nature of remittance**: workbook Annexure 9 (old 27Q numbers, rows 488-558) or the Gazette's 1-19 (p.2337)?
    FVU 1.2 checks the workbook's for the code but the Gazette-like 05-17 for the contact fields. FinCom follows FVU 1.2.
11. **Form 144 field 31**: Form 15CA, Form 145 (Gazette) or Form 121 (workbook remarks)? 26 characters (workbook) or
    12-15 (FVU 1.2's correction check)?
12. **Form 144 country codes** are Annexure 10's own (01-286). Codes typed into FinCom for old 27Q returns may mean
    another country: re-enter each non-resident's country for 2026-27?
13. **Form 143 collectee code**: the workbook makes it mandatory for every collectee (row 165), the Gazette only for
    non-residents (p.2326). FinCom fills it for all (from the PAN).
14. **Opting out of 202(1), grossing up, PE**: where shall these be recorded per party (a screen)? Until then the files
    list them as missing.
15. **Deductor details screen**: approve adding one (fields in section 5)? Meanwhile FinCom reads the category from the
    PAN's 4th letter (C→K, F→F, P/H→Q, A→P, T→T, B→B, J→J). OK? (The old files kept "F" for everyone.)
16. **BH field 52 / 9**: FinCom writes Y and the token only when the previous quarter is marked filed in FinCom with its
    15-digit token; the Gazette Part A rows 9-10 ask "filed earlier for this quarter / Return Receipt Number of the
    original". Which is meant? (xlsx rows 52, 95; Gazette p.2300)
17. **Book adjustment** (Government): FinCom writes "B" only for a challan marked so, with no minor head (as the sample).
    Any Government clients?
18. **Rate for 1059 / 1034 / 1038 / 1061** is "0.00" in the workbook (2 decimals; xlsx 140 row 181), not 0.0000. FinCom
    writes 0.00.
19. **Form 138 general note 10**: nil challans need remark "A or B" but Annexure 6 has A and C only (xlsx rows 14, 367-370).
