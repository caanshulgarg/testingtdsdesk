# Checking FinCom's TDS files with Protean's FVU (for the owner)

*14-Oct-2026, after the independent TDS review, finding H5.*

FinCom's text files for 26Q, 24Q, 27Q and 27EQ have never been run through Protean's own File Validation Utility (FVU). The FVU in FinCom's tests is a stand-in (`tests/make_fake_fvu.py`). It accepts any file that does not contain "BAD".

Until the files below pass the real FVU, no return should be filed from a FinCom file without that check. The Return file tab says so on every return.

## What FinCom's files are built to

Each line is one record, fields separated by `^`. The file starts with an FH (file header) line and a BH (batch header) line. One CD (challan) line follows per challan, with the deductee (DD) lines of that challan under it. For 24Q Q4, SD (salary detail) lines follow.

FinCom's CD line carries:

- this return's tax on the challan;
- surcharge and cess (0.00);
- the interest and fee given to this return;
- **the total of those** (the challan record adds up; since 14-Oct-2026);
- the BSR code, the date of deposit, the challan serial and the minor head;
- the total of the deductee lines.

The **field order** is FinCom's own and was never compared with Protean's format. That comparison is your check.

## Steps

1. **Get the FVU.** From Protean's TIN site, download the current e-TDS/TCS FVU (the version for the year you file) and its *File Format* PDF. Install Java if the FVU asks for it.
2. **Make one file of each kind from FinCom,** for a client and quarter you have already filed through your usual software. That gives you a known-good file to compare against. For each form below, open the return, then **Return file → Download the … text file**:
   - **26Q**, a quarter with 194C and 194J deductions (both technical and professional) and one deduction without a PAN;
   - **24Q Q4**, so the file has the SD (salary) records;
   - **27Q**, if the client has non-resident payments;
   - **27EQ**, with a scrap or other TCS sale.
3. **Run the FVU on each file.** Start the FVU and choose the form and the file:
   - **Input file:** FinCom's `.txt`.
   - **Challan input file:** the CSI file downloaded from the e-filing portal for the client's TAN and the quarter's dates.
   - **Output folder:** any folder.
4. **Read the result.**
   - **The FVU makes a `.fvu` file:** the file passed. Note it here, below.
   - **The FVU makes an error file instead:** open it. Each error names a line number and a field. Send the error file to the team with the FinCom file. Most likely the field order of the CD or DD record differs from Protean's format.
5. **Compare the section codes:**
   - Check the 26Q's DD lines for 194J (4JA / 4JB) and 194-I (4IA / 4IB) against the *File Format* PDF.
   - Then mark them confirmed in `docs/tds-codes.md`.
6. **Compare with your filed return.** Open the `.fvu` or the text file from your usual software for the same quarter. For each challan and deductee, the amounts, the dates and the section codes should be the same. Differences in the order of challans or deductees do not matter.

## Results (fill in)

| Form | Year / quarter | FVU version | Passed? | Errors (file) | Checked by, on |
|---|---|---|---|---|---|
| 26Q | | | | | |
| 24Q (Q4) | | | | | |
| 27Q | | | | | |
| 27EQ | | | | | |

For the forms of the Income-tax Act, 2025 (138, 140, 143 and 144, tax year 2026-27 onward), FinCom's files stay marked **draft** (`NEW_FORMS_VALIDATED`). They remain drafts until Protean publishes the new file format and the payment codes (`PAY_CODES`) are filled in.

## FVU 8.7's rules FinCom follows (next-fvu87, 24-Oct-2026)

**Which FVU is which.** FinCom writes two kinds of file:

- **Up to FY 2025-26** (24Q, 26Q, 27Q, 27EQ, Income-tax Act 1961): Protean's **TDS Standalone FVU 8.7** (jar of 27-Jun-2024).
- **Tax year 2026-27 on** (Forms 138, 140, 143, 144, Income-tax Act 2025): Protean's **FVU 1.2** (17-Aug-2026), see `docs/tds-forms-2025/GAPS.md`.

FVU 8.7 is therefore not newer than what FinCom targets: it is the FVU of the old forms, and FinCom's files were laid out for it on 17-Oct-2026 (`tests/run_fvu87.py`).

**Source of the rules below.** Protean's site (protean-tinpan.com, tin-nsdl.com) could not be reached from the build machine (the proxy refuses it). The rules were therefore read off FVU 8.7 itself: FinCom's own file was run with one field changed at a time, and each line gives the error code FVU 8.7 printed. They are what this FVU does, not the file-format PDF's words.

| What | FVU 8.7 | FinCom now |
|---|---|---|
| No tax deducted (remark B, T or Y, or none) | the date of deduction (DD field 24) must be empty (T-FV-4257; with B: T-FV-4252) | empty when the TDS is nil |
| Remark T (transporter, 194C(6)) | only with section 94C (T-FV-4265) and a valid PAN (T-FV-4266) | as before (Validate: "Remark T is only for 194C", "needs the PAN") |
| Remark B (Form 15G / 15H) | only with 193, 194, 94A, 94D, 4EE, 4DA, 4IA, 4IB, 94K (T_FV_4245; its message also names 194J, but 4JA and 4JB are refused) | Validate & file: an **error**; the download lists it |
| Remark Y (below the threshold) | only with 193, 194, 4BB, 4EE, 4IA, 4IB, 4JA, 4JB, 94A, 94B, 94C, 94D, 94G, 94H, 94K, 94L, 94O, 94R, 94S (T-FV-4282); 194Q only C, S, U (T_FV_6210) | a nil row below the limit under another section is written **with no remark** (the owner, 24-Oct-2026; FVU 8.7 takes it); Validate says so (info) |
| Remark B, T or Y on 27Q | refused (T-FV-4280; Y also needs a PAN, T-FV-4295) | not written on 27Q |
| Remark C | only for a PAN that is structurally invalid / PANNOTAVBL (T-FV-4323) | an **inoperative** PAN is written as it is, **without C**, at the higher rate (Validate: info). Forms 138/140/143/144 keep C (the owner, 17-Oct-2026; FVU 1.2 takes it) |
| 27Q nature of remittance (section 195) | 16, 21, 27, 28, 31, 49, 52, 66, 67, 68, 69, 70, 99 (T-FV-4312) | any other: Validate **error**, the download lists it |
| 27Q address, e-mail, phone, tax ID in the country of residence (DD 39-42) | only with remark C, no PAN and nature 16, 21, 27, 31, 49, 52, 66-70 (T-FV-4335 to 4338, 4340 to 4343) | left out otherwise (Validate: info) |
| 194T (partners, from 1-Apr-2025) | **no section code** (4T, 94T, 194T, 4TA, 9TA all T-FV-4301) | 94T written; Validate **warning** and the download say FVU 8.7 refuses it |
| Challan of the year before the statement's | taken (07-03-2025 in a 2025-26 return) | still an error in FinCom (a challan deposited in an earlier year is not used); the words now say FVU 8.7 itself takes it |
| Challan two or more years before | refused (T-FV-3166) | error, with that code |
| Challan dated after today | refused (T-FV-3040) | error, as before |

FVU 1.2 (Forms 138-144) differs on the challan year: any challan before the tax year is refused (T-FV-3076).

**What the tests run** (`tests/run_fvu87.py`, with `FINCOM_FVU87` naming the FVU 8.7 folder; the FVU is never committed):

- the 16 files of `tests/fvu_books.js`;
- its `cases()`: 26R2 (remarks T, B, Y, a 194Q below the limit, an inoperative PAN, 194T), 27D2 (a treaty-rate deductee with a PAN, a nature-99 one without), 26P3 (challan of the year before), 26O4 (two years before).

All pass but the known limits: T_FV_6138 (the 75,000 standard deduction) on 24Q Q4, T-FV-4301 on 26R2's 194T, and T-FV-3166 on 26O4. `tests/run_fvu_layout.js` checks the same records field by field without the FVU. `tests/run_fvu12_forms.py` runs FVU 1.2 on R140, a Form 140 with remarks T, B (with its Form 121 UIN) and Y: valid.
