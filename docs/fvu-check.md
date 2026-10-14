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
