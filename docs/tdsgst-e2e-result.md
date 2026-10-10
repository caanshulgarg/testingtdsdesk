# TDS and GST from real Tally books: the result

Test data only: a made-up company ("FinCom Spike Co") created in a throwaway TallyPrime 7.1 on GitHub's test computer. No client's books and no live FinCom were used.

## What was done

1. 39 entries were made in TallyPrime 7.1 (sales of every GST kind, credit and debit notes, purchases with reverse charge, exempt and blocked credit, an advance, TDS journals for 194C/H/I/Q/A/J, 195 and 192, TCS sales). Then, as after filing, one invoice, one credit note and one TDS entry were altered, one invoice deleted and a PAN corrected.
2. The published FinCom Bridge 2.4.1 (the same setup file the CAs install) read them from Tally; every request it sent was kept (test run 38072484999).
3. Those requests went through FinCom's cloud code into a test database built as staging is, and the Day Book was uploaded as a CA uploads it. FinCom's own TDS and GST code then worked out the returns.
4. Every figure was compared to the paisa with an answer key worked out by hand from the law (tests/fixtures/tdsgst-e2e/EXPECTED.md).

## The result in short

| Area | Today's FinCom (tax-accuracy) PASS / FAIL | With the fixes (arc-ui) PASS / FAIL |
|---|---|---|
| TDS | 101 / 4 | 105 / 0 |
| TCS | 10 / 0 | 10 / 0 |
| GSTR-1 | 60 / 10 | 87 / 0 |
| GSTR-3B | 29 / 11 | 36 / 4 |
| Amendments | 62 / 6 | 67 / 1 |
| Cloud copy (bridge) | 133 / 6 | 133 / 6 |
| Ledger setup | 19 / 0 | 19 / 0 |

**In plain words.** With the fixes on arc-ui, every TDS, TCS and GSTR-1 figure, and every amendment figure, came out right to
the paisa from the uploaded Day Book. Two things need your decision: (1) the TDS and GST pages use only the Day Book the CA
uploads; the entries the bridge sends by itself reach FinCom's cloud copy but no return; (2) that cloud copy lacks the GST
kind of an entry (SEZ, export, reverse charge, nil-rated), because the bridge does not send those fields. Changing either
means changing the bridge or how entries reach the books, which this round was not allowed to do. The blocked-credit (17(5))
figures could not be proved: TallyPrime 7.1 dropped the mark when the test entry was imported.

## What is still wrong after the fixes, and why

- **NOT FIXED: needs a change to the bridge's entry fields (the owner's decision; no bridge change in this round)** (4 figures): the published bridge 2.4.1 sends each entry as Tally's FinComVoucherObject stripped to the approved fields; the party's registration type, the buyer's country, the nature of the transaction, the reverse-charge and ineligible-credit marks and the taxability are not among them, so FinCom's cloud copy of the entry cannot tell this supply
  - p1 S03: the SEZ supply (registration type or nature of the transaction) in the entry the bridge sends; p1 S05: the export (the buyer's country) in the entry the bridge sends; p1 P03: the reverse charge in the entry the bridge sends; p1 S10: the nil-rated supply (taxability) in the entry the bridge sends
- **NOT FIXED: needs a change to the bridge's entry fields (the owner's decision; no bridge change in this round)** (1 figure): TallyPrime 7.1 did not keep the blocked-credit mark on the imported entry (see 4(B)(1)), and the bridge's entry fields carry no such mark either
  - p1 P04: the blocked credit in the entry the bridge sends
- **NOT FIXED: design (the owner's decision); today the CA must upload the Day Book for the returns** (1 figure): the TDS and GST pages read only the day files the Day Book upload makes (TCloud.load: tally_days_list and Storage tally-days); the entries the bridge records go to tally_vouchers / tally_lines, which no TDS or GST figure reads
  - the entries the bridge sent reach the books the TDS and GST pages read (day files), before any Day Book upload
- **NOT FIXED: feature not in FinCom (the corrected regular statement's figures are right)** (1 figure): FinCom builds a fresh regular statement only; a correction statement (C1-C9 against the filed token) is not built
  - Form 140 Q1 correction: a correction statement for the filed quarter
- **NOT A FINCOM FAULT: the harness cannot mark the credit blocked by XML in TallyPrime 7.1 (on the screen is not automated)** (4 figures): TallyPrime 7.1's XML import did not keep the blocked-credit mark (GSTOVRDNINELIGIBLEITC came back 'Not Applicable' on the entry and GSTINELIGIBLEITC 'No' on the ledger, runs 38066717288 and 38069479531), so the entry reached FinCom as eligible; FinCom's 17(5) reversal itself is covered by tests/run_block17.js
  - May 2026 4(B)(1) reversed, rules 38/42/43 and 17(5): CGST; May 2026 4(B)(1) reversed, rules 38/42/43 and 17(5): SGST; May 2026 4(C) net ITC: CGST; May 2026 4(C) net ITC: SGST

## What FinCom got wrong and is fixed on arc-ui

- 194Q: FinCom reported the whole bill (55,00,000) as paid or credited and the rate as 0.01%; the law taxes only the part above 50 lakh (5,00,000) at 0.1% (5 figures)
- a supply to an SEZ unit was reported as a regular B2B invoice (inv_typ R) or dropped, and missed in 3.1(b) (4 figures)
- an export under LUT (no IGST) was reported as WPAY (1 figure)
- a credit note to an unregistered buyer against a B2C large invoice was netted into B2C small instead of cdnur (typ B2CL) (2 figures)
- table 8 put every nil or exempt supply in one row (INTRB2B); it must be one row per supply type (intra/inter-state, to registered/unregistered) (3 figures)
- a debit note raised on a customer (it credits sales and output tax) was read as a purchase debit note, so it left 9B, table 13 and 3.1(a) and took input credit away (4 figures)
- the SEZ supply with IGST (S03) was counted in 3.1(a) instead of 3.1(b), the SEZ supply under LUT (S04) was left out, and the debit note raised on a customer (DN1) was read as a purchase note (2 figures)
- the SEZ supply under LUT (S04, 80,000) was counted as nil-rated or exempt instead of zero-rated (1 figure)
- July's 3B did not carry the differences of the amendments reported in July's GSTR-1 (9A, 9C, 10) (4 figures)

## Every figure (the arc-ui build; the tax-accuracy result is shown where it differs)

| Area | Figure | Expected | FinCom | Result | Note |
|---|---|---|---|---|---|
| Cloud copy (bridge) | p1 FC/26-27/001 Sales (S01): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/001 Sales (S01): party GSTIN | 07AABCA1111A1ZT | 07AABCA1111A1ZT | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/002 Sales (S02): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/002 Sales (S02): party GSTIN | 27AABCB2222B1ZI | 27AABCB2222B1ZI | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/003 Sales (S03): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/003 Sales (S03): party GSTIN | 29AABCG3333C1Z1 | 29AABCG3333C1Z1 | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/004 Sales (S04): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/004 Sales (S04): party GSTIN | 33AABCD4444D1Z7 | 33AABCD4444D1Z7 | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/005 Sales (S05): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/006 Sales (S06): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/007 Sales (S07): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/008 Sales (S08): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/009 Sales (S09): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/010 Sales (S10): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/010 Sales (S10): party GSTIN | 07AABCA1111A1ZT | 07AABCA1111A1ZT | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/011 Sales (S11): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/012 Sales (S12): cancelled in Tally -> cancelled in FinCom's copy | true | true | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/013 Sales (S13): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p1 OPT/001 Sales (S14): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p1 OPT/001 Sales (S14): party GSTIN | 07AABCA1111A1ZT | 07AABCA1111A1ZT | PASS |  |
| Cloud copy (bridge) | p1 OPT/001 Sales (S14): optional | true | true | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/014 Sales (S15): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/014 Sales (S15): party GSTIN | 27AABCI5151I1ZM | 27AABCI5151I1ZM | PASS |  |
| Cloud copy (bridge) | p1 CN/001 Credit Note (CN1): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p1 CN/001 Credit Note (CN1): party GSTIN | 07AABCA1111A1ZT | 07AABCA1111A1ZT | PASS |  |
| Cloud copy (bridge) | p1 CN/002 Credit Note (CN2): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 DN/001 Debit Note (DN1): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 DN/001 Debit Note (DN1): party GSTIN | 27AABCB2222B1ZI | 27AABCB2222B1ZI | PASS |  |
| Cloud copy (bridge) | p1 RV/001 Receipt (RV1): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p1 PUR/001 Purchase (P01): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p1 PUR/001 Purchase (P01): party GSTIN | 07AABCK7777G1Z7 | 07AABCK7777G1Z7 | PASS |  |
| Cloud copy (bridge) | p1 PUR/002 Purchase (P02): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 PUR/002 Purchase (P02): party GSTIN | 08AABCL8888H1ZW | 08AABCL8888H1ZW | PASS |  |
| Cloud copy (bridge) | p1 PUR/003 Purchase (P03): every ledger line's amount | as entered (6 lines) | as entered (6 lines) | PASS |  |
| Cloud copy (bridge) | p1 PUR/004 Purchase (P04): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p1 PUR/004 Purchase (P04): party GSTIN | 07AABCN9999K1ZJ | 07AABCN9999K1ZJ | PASS |  |
| Cloud copy (bridge) | p1 PUR/005 Purchase (P05): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p1 DN-P/001 Debit Note (DN2): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p1 DN-P/001 Debit Note (DN2): party GSTIN | 07AABCK7777G1Z7 | 07AABCK7777G1Z7 | PASS |  |
| Cloud copy (bridge) | p1 JV/T01 Journal (T01): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 JV/T01 Journal (T01): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p1 JV/T02 Journal (T02): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 JV/T02 Journal (T02): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p1 JV/T03 Journal (T03): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 JV/T03 Journal (T03): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p1 JV/T04 Journal (T04): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 JV/T04 Journal (T04): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p1 JV/T05 Journal (T05): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 JV/T05 Journal (T05): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p1 JV/T06 Journal (T06): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 JV/T06 Journal (T06): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p1 JV/T07 Journal (T07): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 JV/T07 Journal (T07): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p1 JV/T08 Journal (T08): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 JV/T08 Journal (T08): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p1 JV/T09 Journal (T09): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p1 JV/T10 Journal (T10): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 JV/T10 Journal (T10): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p1 JV/T11 Journal (T11): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p1 JV/T11 Journal (T11): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p1 FC/26-27/015 Sales (TC1): every ledger line's amount | as entered (5 lines) | as entered (5 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/015 Sales (TC1): party GSTIN | 07AABCS5555E1ZF | 07AABCS5555E1ZF | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/016 Sales (TC2): every ledger line's amount | as entered (5 lines) | as entered (5 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/016 Sales (TC2): party GSTIN | 07AABCZ6666F1Z0 | 07AABCZ6666F1Z0 | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/017 Sales (S20): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p1 FC/26-27/017 Sales (S20): party GSTIN | 07AABCA1111A1ZT | 07AABCA1111A1ZT | PASS |  |
| Cloud copy (bridge) | p1 S03: the SEZ supply (registration type or nature of the transaction) in the entry the bridge sends | true | false | FAIL | the published bridge 2.4.1 sends each entry as Tally's FinComVoucherObject stripped to the approved fields; the party's ; NOT FIXED: needs a change to the bridg |
| Cloud copy (bridge) | p1 S05: the export (the buyer's country) in the entry the bridge sends | true | false | FAIL | the published bridge 2.4.1 sends each entry as Tally's FinComVoucherObject stripped to the approved fields; the party's ; NOT FIXED: needs a change to the bridg |
| Cloud copy (bridge) | p1 P03: the reverse charge in the entry the bridge sends | true | false | FAIL | the published bridge 2.4.1 sends each entry as Tally's FinComVoucherObject stripped to the approved fields; the party's ; NOT FIXED: needs a change to the bridg |
| Cloud copy (bridge) | p1 P04: the blocked credit in the entry the bridge sends | true | false | FAIL | TallyPrime 7.1 did not keep the blocked-credit mark on the imported entry (see 4(B)(1)), and the bridge's entry fields c; NOT FIXED: needs a change to the bridg |
| Cloud copy (bridge) | p1 S10: the nil-rated supply (taxability) in the entry the bridge sends | true | false | FAIL | the published bridge 2.4.1 sends each entry as Tally's FinComVoucherObject stripped to the approved fields; the party's ; NOT FIXED: needs a change to the bridg |
| Cloud copy (bridge) | p2 FC/26-27/001 Sales (S01): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/001 Sales (S01): party GSTIN | 07AABCA1111A1ZT | 07AABCA1111A1ZT | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/002 Sales (S02): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/002 Sales (S02): party GSTIN | 27AABCB2222B1ZI | 27AABCB2222B1ZI | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/003 Sales (S03): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/003 Sales (S03): party GSTIN | 29AABCG3333C1Z1 | 29AABCG3333C1Z1 | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/004 Sales (S04): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/004 Sales (S04): party GSTIN | 33AABCD4444D1Z7 | 33AABCD4444D1Z7 | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/005 Sales (S05): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/006 Sales (S06): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/007 Sales (S07): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/008 Sales (S08): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/009 Sales (S09): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/010 Sales (S10): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/010 Sales (S10): party GSTIN | 07AABCA1111A1ZT | 07AABCA1111A1ZT | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/011 Sales (S11): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/012 Sales (S12): cancelled in Tally -> cancelled in FinCom's copy | true | true | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/013: deleted in Tally after filing -> marked deleted in FinCom's copy | true | true | PASS | the bridge's add-on line for the delete (Alt+D on Tally's screen) |
| Cloud copy (bridge) | p2 OPT/001 Sales (S14): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p2 OPT/001 Sales (S14): party GSTIN | 07AABCA1111A1ZT | 07AABCA1111A1ZT | PASS |  |
| Cloud copy (bridge) | p2 OPT/001 Sales (S14): optional | true | true | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/014 Sales (S15): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/014 Sales (S15): party GSTIN | 27AABCI5151I1ZM | 27AABCI5151I1ZM | PASS |  |
| Cloud copy (bridge) | p2 CN/001 Credit Note (CN1): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p2 CN/001 Credit Note (CN1): party GSTIN | 07AABCA1111A1ZT | 07AABCA1111A1ZT | PASS |  |
| Cloud copy (bridge) | p2 CN/002 Credit Note (CN2): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 DN/001 Debit Note (DN1): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 DN/001 Debit Note (DN1): party GSTIN | 27AABCB2222B1ZI | 27AABCB2222B1ZI | PASS |  |
| Cloud copy (bridge) | p2 RV/001 Receipt (RV1): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p2 PUR/001 Purchase (P01): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p2 PUR/001 Purchase (P01): party GSTIN | 07AABCK7777G1Z7 | 07AABCK7777G1Z7 | PASS |  |
| Cloud copy (bridge) | p2 PUR/002 Purchase (P02): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 PUR/002 Purchase (P02): party GSTIN | 08AABCL8888H1ZW | 08AABCL8888H1ZW | PASS |  |
| Cloud copy (bridge) | p2 PUR/003 Purchase (P03): every ledger line's amount | as entered (6 lines) | as entered (6 lines) | PASS |  |
| Cloud copy (bridge) | p2 PUR/004 Purchase (P04): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p2 PUR/004 Purchase (P04): party GSTIN | 07AABCN9999K1ZJ | 07AABCN9999K1ZJ | PASS |  |
| Cloud copy (bridge) | p2 PUR/005 Purchase (P05): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p2 DN-P/001 Debit Note (DN2): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p2 DN-P/001 Debit Note (DN2): party GSTIN | 07AABCK7777G1Z7 | 07AABCK7777G1Z7 | PASS |  |
| Cloud copy (bridge) | p2 JV/T01 Journal (T01): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 JV/T01 Journal (T01): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p2 JV/T02 Journal (T02): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 JV/T02 Journal (T02): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p2 JV/T03 Journal (T03): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 JV/T03 Journal (T03): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p2 JV/T04 Journal (T04): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 JV/T04 Journal (T04): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p2 JV/T05 Journal (T05): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 JV/T05 Journal (T05): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p2 JV/T06 Journal (T06): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 JV/T06 Journal (T06): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p2 JV/T07 Journal (T07): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 JV/T07 Journal (T07): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p2 JV/T08 Journal (T08): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 JV/T08 Journal (T08): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p2 JV/T09 Journal (T09): every ledger line's amount | as entered (2 lines) | as entered (2 lines) | PASS |  |
| Cloud copy (bridge) | p2 JV/T10 Journal (T10): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 JV/T10 Journal (T10): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p2 JV/T11 Journal (T11): every ledger line's amount | as entered (3 lines) | as entered (3 lines) | PASS |  |
| Cloud copy (bridge) | p2 JV/T11 Journal (T11): TDS details as Tally stored them (party, assessable, tax) | none stored by Tally | none stored by Tally | PASS | TallyPrime 7.1 kept no TDS details on the imported entry (its nature of payment is not a Tally TDS master), so none can reach FinCom; FinCom's TDS returns read  |
| Cloud copy (bridge) | p2 FC/26-27/015 Sales (TC1): every ledger line's amount | as entered (5 lines) | as entered (5 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/015 Sales (TC1): party GSTIN | 07AABCS5555E1ZF | 07AABCS5555E1ZF | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/016 Sales (TC2): every ledger line's amount | as entered (5 lines) | as entered (5 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/016 Sales (TC2): party GSTIN | 07AABCZ6666F1Z0 | 07AABCZ6666F1Z0 | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/017 Sales (S20): every ledger line's amount | as entered (4 lines) | as entered (4 lines) | PASS |  |
| Cloud copy (bridge) | p2 FC/26-27/017 Sales (S20): party GSTIN | 07AABCA1111A1ZT | 07AABCA1111A1ZT | PASS |  |
| Cloud copy (bridge) | p2 Sigma Landlord's PAN corrected in Tally -> FinCom's ledger list | ABCPS9999F | ABCPS9999F | PASS | the ledger list the bridge sends at Update now |
| Cloud copy (bridge) | the entries the bridge sent reach the books the TDS and GST pages read (day files), before any Day Book upload | yes | no (0 day rows, 0 day files) | FAIL | the TDS and GST pages read only the day files the Day Book upload makes (TCloud.load: tally_days_list and Storage tally-; NOT FIXED: design (the owner's decisio |
| Ledger setup | FinCom's proposal for the ledger Output CGST | ["gst", "CGST", "output"] | ["gst", "CGST", "output"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type GST; name says CGST; name says output; used on 8 vouchers of 07; used 8 times) |
| Ledger setup | FinCom's proposal for the ledger Output SGST | ["gst", "SGST", "output"] | ["gst", "SGST", "output"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type GST; Tally: duty head State Tax; name says output; used on 8 vouchers of 07; used 8 t |
| Ledger setup | FinCom's proposal for the ledger Output IGST | ["gst", "IGST", "output"] | ["gst", "IGST", "output"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type GST; name says IGST; name says output; used on 8 vouchers of 07; used 8 times) |
| Ledger setup | FinCom's proposal for the ledger Input CGST | ["gst", "CGST", "input"] | ["gst", "CGST", "input"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type GST; name says CGST; name says input; used on 4 vouchers of 07; used 4 times) |
| Ledger setup | FinCom's proposal for the ledger Input SGST | ["gst", "SGST", "input"] | ["gst", "SGST", "input"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type GST; Tally: duty head State Tax; name says input; used on 4 vouchers of 07; used 4 ti |
| Ledger setup | FinCom's proposal for the ledger Input IGST | ["gst", "IGST", "input"] | ["gst", "IGST", "input"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type GST; name says IGST; name says input; used on 1 vouchers of 07; used 1 times) |
| Ledger setup | FinCom's proposal for the ledger CGST RCM Payable | ["gst_rcm", "CGST", "output"] | ["gst_rcm", "CGST", "output"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type GST; name says CGST; name says output; used on 1 vouchers of 07; used 1 times) |
| Ledger setup | FinCom's proposal for the ledger SGST RCM Payable | ["gst_rcm", "SGST", "output"] | ["gst_rcm", "SGST", "output"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type GST; Tally: duty head State Tax; name says output; used on 1 vouchers of 07; used 1 t |
| Ledger setup | FinCom's proposal for the ledger TDS Payable 194C | ["tds_payable", "194C"] | ["tds_payable", "194C"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type TDS; section 194C in the name; used 2 times) |
| Ledger setup | FinCom's proposal for the ledger TDS Payable 194J | ["tds_payable", "194J"] | ["tds_payable", "194J"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type TDS; section 194J in the name; used 2 times) |
| Ledger setup | FinCom's proposal for the ledger TDS on Commission 393(1) | ["tds_payable", "194H"] | ["tds_payable", "194H"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type TDS; named under the new Act; 194H from the words in the name; used 1 times) |
| Ledger setup | FinCom's proposal for the ledger TDS on Rent 393(1) | ["tds_payable", "194I"] | ["tds_payable", "194I"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type TDS; named under the new Act; 194I from the words in the name; used 1 times) |
| Ledger setup | FinCom's proposal for the ledger TDS Payable 194Q | ["tds_payable", "194Q"] | ["tds_payable", "194Q"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type TDS; section 194Q in the name; used 1 times) |
| Ledger setup | FinCom's proposal for the ledger TDS Payable 194A | ["tds_payable", "194A"] | ["tds_payable", "194A"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type TDS; section 194A in the name; used 1 times) |
| Ledger setup | FinCom's proposal for the ledger TDS Payable 195 | ["tds_payable", "195"] | ["tds_payable", "195"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type TDS; section 195 in the name; used 1 times) |
| Ledger setup | FinCom's proposal for the ledger TDS on Salary 192 | ["tds_payable", "192"] | ["tds_payable", "192"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type TDS; section 192 in the name; used 1 times) |
| Ledger setup | FinCom's proposal for the ledger TCS 206C(1) Scrap | ["tcs_payable", "206C"] | ["tcs_payable", "206C"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type TCS; section 206C in the name; used 1 times) |
| Ledger setup | FinCom's proposal for the ledger TCS 206C(1H) Sale of Goods | ["tcs_payable", "206C"] | ["tcs_payable", "206C"] | PASS | from Tally's masters and the day book; the CA confirms it (Tally: tax type TCS; section 206C in the name; used 1 times) |
| Ledger setup | FinCom's proposal for the ledger HDFC Bank | ["bank"] | ["bank"] | PASS | from Tally's masters and the day book; the CA confirms it (group Bank Accounts; used 1 times) |
| TDS | Form 140 Q1 (as filed): Omicron Contractors, a deductee row | 1 | 1 | PASS |  |
| TDS | Form 140 Q1 (as filed): Omicron Contractors, PAN | AAACO1234C | AAACO1234C | PASS |  |
| TDS | Form 140 Q1 (as filed): Omicron Contractors, section | 194C | 194C | PASS |  |
| TDS | Form 140 Q1 (as filed): Omicron Contractors, amount paid or credited | 100000 | 100000 | PASS |  |
| TDS | Form 140 Q1 (as filed): Omicron Contractors, tax deducted | 2000 | 2000 | PASS |  |
| TDS | Form 140 Q1 (as filed): Omicron Contractors, rate % | 2 | 2 | PASS |  |
| TDS | Form 140 Q1 (as filed): Omicron Contractors, date of payment or credit | 20260401 | 20260401 | PASS |  |
| TDS | Form 140 Q1 (as filed): Omicron Contractors, remark (A certificate / C higher rate) |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Omicron Contractors, deductee code in the file (01 company, 02 other) | 01 | 01 | PASS |  |
| TDS | Form 140 Q1 (as filed): Omicron Contractors, the file's amount paid and tax | 100000.00 / 2000.00 | 100000.00 / 2000.00 | PASS |  |
| TDS | Form 140 Q1 (as filed): Omicron Contractors, the file's remark |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Pi Consultants, a deductee row | 1 | 1 | PASS |  |
| TDS | Form 140 Q1 (as filed): Pi Consultants, PAN | ABCPP1234D | ABCPP1234D | PASS |  |
| TDS | Form 140 Q1 (as filed): Pi Consultants, section | 194C | 194C | PASS |  |
| TDS | Form 140 Q1 (as filed): Pi Consultants, amount paid or credited | 60000 | 60000 | PASS |  |
| TDS | Form 140 Q1 (as filed): Pi Consultants, tax deducted | 1200 | 1200 | PASS |  |
| TDS | Form 140 Q1 (as filed): Pi Consultants, rate % | 2 | 2 | PASS |  |
| TDS | Form 140 Q1 (as filed): Pi Consultants, date of payment or credit | 20260401 | 20260401 | PASS |  |
| TDS | Form 140 Q1 (as filed): Pi Consultants, remark (A certificate / C higher rate) |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Pi Consultants, deductee code in the file (01 company, 02 other) | 02 | 02 | PASS |  |
| TDS | Form 140 Q1 (as filed): Pi Consultants, the file's amount paid and tax | 60000.00 / 1200.00 | 60000.00 / 1200.00 | PASS |  |
| TDS | Form 140 Q1 (as filed): Pi Consultants, the file's remark |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Rho Brokers, a deductee row | 1 | 1 | PASS |  |
| TDS | Form 140 Q1 (as filed): Rho Brokers, PAN | AABFR1234E | AABFR1234E | PASS |  |
| TDS | Form 140 Q1 (as filed): Rho Brokers, section | 194H | 194H | PASS |  |
| TDS | Form 140 Q1 (as filed): Rho Brokers, amount paid or credited | 40000 | 40000 | PASS |  |
| TDS | Form 140 Q1 (as filed): Rho Brokers, tax deducted | 800 | 800 | PASS |  |
| TDS | Form 140 Q1 (as filed): Rho Brokers, rate % | 2 | 2 | PASS |  |
| TDS | Form 140 Q1 (as filed): Rho Brokers, date of payment or credit | 20260401 | 20260401 | PASS |  |
| TDS | Form 140 Q1 (as filed): Rho Brokers, remark (A certificate / C higher rate) |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Rho Brokers, deductee code in the file (01 company, 02 other) | 02 | 02 | PASS |  |
| TDS | Form 140 Q1 (as filed): Rho Brokers, the file's amount paid and tax | 40000.00 / 800.00 | 40000.00 / 800.00 | PASS |  |
| TDS | Form 140 Q1 (as filed): Rho Brokers, the file's remark |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Sigma Landlord, a deductee row | 1 | 1 | PASS |  |
| TDS | Form 140 Q1 (as filed): Sigma Landlord, PAN | ABCPS1234F | ABCPS1234F | PASS |  |
| TDS | Form 140 Q1 (as filed): Sigma Landlord, section | 194I | 194I | PASS |  |
| TDS | Form 140 Q1 (as filed): Sigma Landlord, amount paid or credited | 75000 | 75000 | PASS |  |
| TDS | Form 140 Q1 (as filed): Sigma Landlord, tax deducted | 7500 | 7500 | PASS |  |
| TDS | Form 140 Q1 (as filed): Sigma Landlord, rate % | 10 | 10 | PASS |  |
| TDS | Form 140 Q1 (as filed): Sigma Landlord, date of payment or credit | 20260401 | 20260401 | PASS |  |
| TDS | Form 140 Q1 (as filed): Sigma Landlord, remark (A certificate / C higher rate) |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Sigma Landlord, deductee code in the file (01 company, 02 other) | 02 | 02 | PASS |  |
| TDS | Form 140 Q1 (as filed): Sigma Landlord, the file's amount paid and tax | 75000.00 / 7500.00 | 75000.00 / 7500.00 | PASS |  |
| TDS | Form 140 Q1 (as filed): Sigma Landlord, the file's remark |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Tau Goods Supplier, a deductee row | 1 | 1 | PASS |  |
| TDS | Form 140 Q1 (as filed): Tau Goods Supplier, PAN | AAACT1234G | AAACT1234G | PASS |  |
| TDS | Form 140 Q1 (as filed): Tau Goods Supplier, section | 194Q | 194Q | PASS |  |
| TDS | Form 140 Q1 (as filed): Tau Goods Supplier, amount paid or credited | 500000 | 500000 | PASS (tax-accuracy: FAIL, 5500000) |  |
| TDS | Form 140 Q1 (as filed): Tau Goods Supplier, tax deducted | 500 | 500 | PASS |  |
| TDS | Form 140 Q1 (as filed): Tau Goods Supplier, rate % | 0.1 | 0.1 | PASS (tax-accuracy: FAIL, 0.01) |  |
| TDS | Form 140 Q1 (as filed): Tau Goods Supplier, date of payment or credit | 20260402 | 20260402 | PASS |  |
| TDS | Form 140 Q1 (as filed): Tau Goods Supplier, remark (A certificate / C higher rate) |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Tau Goods Supplier, deductee code in the file (01 company, 02 other) | 01 | 01 | PASS |  |
| TDS | Form 140 Q1 (as filed): Tau Goods Supplier, the file's amount paid and tax | 500000.00 / 500.00 | 500000.00 / 500.00 | PASS (tax-accuracy: FAIL, 5500000.00 / 500.00) |  |
| TDS | Form 140 Q1 (as filed): Tau Goods Supplier, the file's remark |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Upsilon Finance, a deductee row | 1 | 1 | PASS |  |
| TDS | Form 140 Q1 (as filed): Upsilon Finance, PAN | AAACU1234H | AAACU1234H | PASS |  |
| TDS | Form 140 Q1 (as filed): Upsilon Finance, section | 194A | 194A | PASS |  |
| TDS | Form 140 Q1 (as filed): Upsilon Finance, amount paid or credited | 50000 | 50000 | PASS |  |
| TDS | Form 140 Q1 (as filed): Upsilon Finance, tax deducted | 5000 | 5000 | PASS |  |
| TDS | Form 140 Q1 (as filed): Upsilon Finance, rate % | 10 | 10 | PASS |  |
| TDS | Form 140 Q1 (as filed): Upsilon Finance, date of payment or credit | 20260402 | 20260402 | PASS |  |
| TDS | Form 140 Q1 (as filed): Upsilon Finance, remark (A certificate / C higher rate) |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Upsilon Finance, deductee code in the file (01 company, 02 other) | 01 | 01 | PASS |  |
| TDS | Form 140 Q1 (as filed): Upsilon Finance, the file's amount paid and tax | 50000.00 / 5000.00 | 50000.00 / 5000.00 | PASS |  |
| TDS | Form 140 Q1 (as filed): Upsilon Finance, the file's remark |  |  | PASS |  |
| TDS | Form 140 Q1 (as filed): Phi Freelancer, a deductee row | 1 | 1 | PASS |  |
| TDS | Form 140 Q1 (as filed): Phi Freelancer, PAN | PANNOTAVBL | PANNOTAVBL | PASS |  |
| TDS | Form 140 Q1 (as filed): Phi Freelancer, section | 194J | 194J | PASS |  |
| TDS | Form 140 Q1 (as filed): Phi Freelancer, amount paid or credited | 40000 | 40000 | PASS |  |
| TDS | Form 140 Q1 (as filed): Phi Freelancer, tax deducted | 8000 | 8000 | PASS |  |
| TDS | Form 140 Q1 (as filed): Phi Freelancer, rate % | 20 | 20 | PASS |  |
| TDS | Form 140 Q1 (as filed): Phi Freelancer, date of payment or credit | 20260402 | 20260402 | PASS |  |
| TDS | Form 140 Q1 (as filed): Phi Freelancer, remark (A certificate / C higher rate) | C | C | PASS |  |
| TDS | Form 140 Q1 (as filed): Phi Freelancer, deductee code in the file (01 company, 02 other) | 02 | 02 | PASS |  |
| TDS | Form 140 Q1 (as filed): Phi Freelancer, the file's amount paid and tax | 40000.00 / 8000.00 | 40000.00 / 8000.00 | PASS |  |
| TDS | Form 140 Q1 (as filed): Phi Freelancer, the file's remark | C | C | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, a deductee row | 1 | 1 | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, PAN | AAACC1234J | AAACC1234J | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, section | 194J | 194J | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, amount paid or credited | 200000 | 200000 | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, tax deducted | 2000 | 2000 | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, rate % | 1 | 1 | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, date of payment or credit | 20260402 | 20260402 | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, remark (A certificate / C higher rate) | A | A | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, certificate number | LDC1234567 | LDC1234567 | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, deductee code in the file (01 company, 02 other) | 01 | 01 | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, the file's amount paid and tax | 200000.00 / 2000.00 | 200000.00 / 2000.00 | PASS |  |
| TDS | Form 140 Q1 (as filed): Chi Tech Services, the file's remark | A | A | PASS |  |
| TDS | Form 140 Q1 (as filed): rows / amount paid / tax | 8 / 1065000.00 / 27000.00 | 8 / 1065000.00 / 27000.00 | PASS (tax-accuracy: FAIL, 8 / 6065000.00 / 27000.00) |  |
| TDS | Form 140 Q1: Psi Small Contractor (below the threshold, no TDS) not reported | 0 | 0 | PASS |  |
| TDS | Form 140 Q1: the form's name for 2026-27 | Form 140 | Form 140 | PASS |  |
| TDS | Form 140 Q1: salary (192) kept out | 0 | 0 | PASS |  |
| TDS | Form 138 (salary, 192): Employee A's tax deducted | 10000 | 10000 | PASS |  |
| TDS | Form 144 Q1 (non-resident): Omega Software Inc, a deductee row | 1 | 1 | PASS |  |
| TDS | Form 144 Q1 (non-resident): Omega Software Inc, PAN | AAJCO1234L | AAJCO1234L | PASS |  |
| TDS | Form 144 Q1 (non-resident): Omega Software Inc, section | 195 | 195 | PASS |  |
| TDS | Form 144 Q1 (non-resident): Omega Software Inc, amount paid or credited | 100000 | 100000 | PASS |  |
| TDS | Form 144 Q1 (non-resident): Omega Software Inc, tax deducted | 20800 | 20800 | PASS |  |
| TDS | Form 144 Q1 (non-resident): Omega Software Inc, rate % | 20.8 | 20.8 | PASS |  |
| TDS | Form 144 Q1 (non-resident): Omega Software Inc, date of payment or credit | 20260501 | 20260501 | PASS |  |
| TDS | Form 144 Q1 (non-resident): Omega Software Inc, remark (A certificate / C higher rate) |  |  | PASS |  |
| TDS | Form 144 Q1 (non-resident): Omega Software Inc, the file's amount paid and tax | 100000.00 / 20800.00 | 100000.00 / 20800.00 | PASS |  |
| TDS | Form 144 Q1 (non-resident): Omega Software Inc, the file's remark |  |  | PASS |  |
| TDS | Form 144 Q1: the form's name | Form 144 | Form 144 | PASS |  |
| TCS | Form 143 Q1: Scrap Buyer Delhi, a collectee row | 1 | 1 | PASS |  |
| TCS | Form 143 Q1: Scrap Buyer Delhi, PAN | AABCS5555E | AABCS5555E | PASS |  |
| TCS | Form 143 Q1: Scrap Buyer Delhi, collection code | 6CF | 6CF | PASS |  |
| TCS | Form 143 Q1: Scrap Buyer Delhi, amount received | 118000 | 118000 | PASS |  |
| TCS | Form 143 Q1: Scrap Buyer Delhi, tax collected | 2360 | 2360 | PASS |  |
| TCS | Form 143 Q1: Scrap Buyer Delhi, rate % | 2 | 2 | PASS |  |
| TCS | Form 143 Q1: Scrap Buyer Delhi, date | 20260601 | 20260601 | PASS |  |
| TCS | Form 143 Q1: Zeta Retail Buyer (206C(1H), omitted from 1-Apr-2025): no collection code given |  |  | PASS |  |
| TCS | Form 143 Q1: Zeta Retail Buyer: said before filing | true | true | PASS |  |
| TCS | Form 143 Q1: the form's name | Form 143 | Form 143 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Pi Consultants, a deductee row | 1 | 1 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Pi Consultants, PAN | ABCPP1234D | ABCPP1234D | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Pi Consultants, section | 194J | 194J | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Pi Consultants, amount paid or credited | 60000 | 60000 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Pi Consultants, tax deducted | 6000 | 6000 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Pi Consultants, rate % | 10 | 10 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Pi Consultants, date of payment or credit | 20260401 | 20260401 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Pi Consultants, remark (A certificate / C higher rate) |  |  | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Pi Consultants, deductee code in the file (01 company, 02 other) | 02 | 02 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Pi Consultants, the file's amount paid and tax | 60000.00 / 6000.00 | 60000.00 / 6000.00 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Pi Consultants, the file's remark |  |  | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Sigma Landlord, a deductee row | 1 | 1 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Sigma Landlord, PAN | ABCPS9999F | ABCPS9999F | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Sigma Landlord, section | 194I | 194I | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Sigma Landlord, amount paid or credited | 75000 | 75000 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Sigma Landlord, tax deducted | 7500 | 7500 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Sigma Landlord, rate % | 10 | 10 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Sigma Landlord, date of payment or credit | 20260401 | 20260401 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Sigma Landlord, remark (A certificate / C higher rate) |  |  | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Sigma Landlord, deductee code in the file (01 company, 02 other) | 02 | 02 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Sigma Landlord, the file's amount paid and tax | 75000.00 / 7500.00 | 75000.00 / 7500.00 | PASS |  |
| Amendments | Form 140 Q1 correction (after filing): Sigma Landlord, the file's remark |  |  | PASS |  |
| Amendments | Form 140 Q1 correction: rows / amount paid / tax | 8 / 1065000.00 / 31800.00 | 8 / 1065000.00 / 31800.00 | PASS (tax-accuracy: FAIL, 8 / 6065000.00 / 31800.00) |  |
| Amendments | Form 140 Q1 correction: a correction statement for the filed quarter | made | not made (FinCom builds a fresh regular statement only) | FAIL | FinCom builds a fresh regular statement only; a correction statement (C1-C9 against the filed token) is not built; NOT FIXED: feature not in FinCom (the correct |
| GSTR-1 | May 2026 table 4A/6B (b2b): 1 07AABCA1111A1ZT in the table | 1 | 1 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 1 idt | 01-05-2026 | 01-05-2026 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 1 val | 118000 | 118000 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 1 pos | 07 | 07 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 1 rchrg | N | N | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 1 inv_typ | R | R | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 1 rate, taxable value and tax | [{"rt": 18.0, "txval": 100000.0, "iamt": 0.0, "camt": 9000.0, "samt": 9000.0}] | [{"rt": 18.0, "txval": 100000.0, "iamt": 0.0, "camt": 9000.0, "samt": 9000.0}] | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 2 27AABCB2222B1ZI in the table | 1 | 1 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 2 idt | 01-05-2026 | 01-05-2026 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 2 val | 236000 | 236000 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 2 pos | 27 | 27 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 2 rchrg | N | N | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 2 inv_typ | R | R | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 2 rate, taxable value and tax | [{"rt": 18.0, "txval": 200000.0, "iamt": 36000.0, "camt": 0.0, "samt": 0.0}] | [{"rt": 18.0, "txval": 200000.0, "iamt": 36000.0, "camt": 0.0, "samt": 0.0}] | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 14 27AABCI5151I1ZM in the table | 1 | 1 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 14 idt | 02-05-2026 | 02-05-2026 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 14 val | 118000 | 118000 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 14 pos | 27 | 27 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 14 rchrg | N | N | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 14 inv_typ | R | R | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 14 rate, taxable value and tax | [{"rt": 18.0, "txval": 100000.0, "iamt": 18000.0, "camt": 0.0, "samt": 0.0}] | [{"rt": 18.0, "txval": 100000.0, "iamt": 18000.0, "camt": 0.0, "samt": 0.0}] | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 3 29AABCG3333C1Z1 in the table | 1 | 1 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 3 idt | 01-05-2026 | 01-05-2026 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 3 val | 177000 | 177000 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 3 pos | 29 | 29 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 3 rchrg | N | N | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 3 inv_typ | SEWP | SEWP | PASS (tax-accuracy: FAIL, R) |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 3 rate, taxable value and tax | [{"rt": 18.0, "txval": 150000.0, "iamt": 27000.0, "camt": 0.0, "samt": 0.0}] | [{"rt": 18.0, "txval": 150000.0, "iamt": 27000.0, "camt": 0.0, "samt": 0.0}] | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 4 33AABCD4444D1Z7 in the table | 1 | 1 | PASS (tax-accuracy: FAIL, 0) |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 4 idt | 01-05-2026 | 01-05-2026 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 4 val | 80000 | 80000 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 4 pos | 33 | 33 | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 4 rchrg | N | N | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 4 inv_typ | SEWOP | SEWOP | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): 4 rate, taxable value and tax | [{"rt": 18.0, "txval": 80000.0, "iamt": 0.0, "camt": 0.0, "samt": 0.0}] | [{"rt": 18.0, "txval": 80000.0, "iamt": 0.0, "camt": 0.0, "samt": 0.0}] | PASS |  |
| GSTR-1 | May 2026 table 4A/6B (b2b): nothing else in the table | [] | [] | PASS |  |
| GSTR-1 | May 2026 table 5 (b2cl): 7 09 in the table | 1 | 1 | PASS |  |
| GSTR-1 | May 2026 table 5 (b2cl): 7 idt | 02-05-2026 | 02-05-2026 | PASS |  |
| GSTR-1 | May 2026 table 5 (b2cl): 7 val | 177000 | 177000 | PASS |  |
| GSTR-1 | May 2026 table 5 (b2cl): 7 pos | 09 | 09 | PASS |  |
| GSTR-1 | May 2026 table 5 (b2cl): 7 rate, taxable value and tax | [{"rt": 18.0, "txval": 150000.0, "iamt": 27000.0, "camt": 0.0, "samt": 0.0}] | [{"rt": 18.0, "txval": 150000.0, "iamt": 27000.0, "camt": 0.0, "samt": 0.0}] | PASS |  |
| GSTR-1 | May 2026 table 5 (b2cl): nothing else in the table | [] | [] | PASS |  |
| GSTR-1 | May 2026 table 6A (exp): 5  in the table | 1 | 1 | PASS |  |
| GSTR-1 | May 2026 table 6A (exp): 5 exp_typ | WPAY | WPAY | PASS |  |
| GSTR-1 | May 2026 table 6A (exp): 5 idt | 02-05-2026 | 02-05-2026 | PASS |  |
| GSTR-1 | May 2026 table 6A (exp): 5 val | 354000 | 354000 | PASS |  |
| GSTR-1 | May 2026 table 6A (exp): 5 rate, taxable value and tax | [{"rt": 18.0, "txval": 300000.0, "iamt": 54000.0, "camt": 0.0, "samt": 0.0}] | [{"rt": 18.0, "txval": 300000.0, "iamt": 54000.0, "camt": 0.0, "samt": 0.0}] | PASS |  |
| GSTR-1 | May 2026 table 6A (exp): 6  in the table | 1 | 1 | PASS |  |
| GSTR-1 | May 2026 table 6A (exp): 6 exp_typ | WOPAY | WOPAY | PASS (tax-accuracy: FAIL, WPAY) |  |
| GSTR-1 | May 2026 table 6A (exp): 6 idt | 02-05-2026 | 02-05-2026 | PASS |  |
| GSTR-1 | May 2026 table 6A (exp): 6 val | 250000 | 250000 | PASS |  |
| GSTR-1 | May 2026 table 6A (exp): 6 rate, taxable value and tax | [{"rt": 18.0, "txval": 250000.0, "iamt": 0.0, "camt": 0.0, "samt": 0.0}] | [{"rt": 18.0, "txval": 250000.0, "iamt": 0.0, "camt": 0.0, "samt": 0.0}] | PASS |  |
| GSTR-1 | May 2026 table 6A (exp): nothing else in the table | [] | [] | PASS |  |
| GSTR-1 | May 2026 table 7 (b2cs) INTRA place 07 18%: taxable / IGST / CGST / SGST | 45000.00 / 0.00 / 4050.00 / 4050.00 | 45000.00 / 0.00 / 4050.00 / 4050.00 | PASS |  |
| GSTR-1 | May 2026 table 7 (b2cs) INTER place 06 18%: taxable / IGST / CGST / SGST | 50000.00 / 9000.00 / 0.00 / 0.00 | 50000.00 / 9000.00 / 0.00 / 0.00 | PASS |  |
| GSTR-1 | May 2026 table 7 (b2cs): nothing else | [] | [] | PASS (tax-accuracy: FAIL, ["INTER/09/18.0"]) |  |
| GSTR-1 | May 2026 table 8 (nil) INTRAB2B: nil / exempt / non-GST | 30000.00 / 0.00 / 0.00 | 30000.00 / 0.00 / 0.00 | PASS (tax-accuracy: FAIL, 0.00 / 0.00 / 0.00) |  |
| GSTR-1 | May 2026 table 8 (nil) INTRB2C: nil / exempt / non-GST | 0.00 / 20000.00 / 0.00 | 0.00 / 20000.00 / 0.00 | PASS (tax-accuracy: FAIL, 0.00 / 0.00 / 0.00) |  |
| GSTR-1 | May 2026 table 8 (nil) INTRB2B: nil / exempt / non-GST | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | PASS (tax-accuracy: FAIL, 30000.00 / 100000.00 / 0.00) |  |
| GSTR-1 | May 2026 table 8 (nil) INTRAB2C: nil / exempt / non-GST | 0.00 / 0.00 / 0.00 | 0.00 / 0.00 / 0.00 | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 07AABCA1111A1ZT in the table | 1 | 1 | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 ntty | C | C | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 nt_dt | 02-05-2026 | 02-05-2026 | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 val | 11800 | 11800 | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 pos | 07 | 07 | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 rate, taxable value and tax | [{"rt": 18.0, "txval": 10000.0, "iamt": 0.0, "camt": 900.0, "samt": 900.0}] | [{"rt": 18.0, "txval": 10000.0, "iamt": 0.0, "camt": 900.0, "samt": 900.0}] | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 27AABCB2222B1ZI in the table | 1 | 1 | PASS (tax-accuracy: FAIL, 0) |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 ntty | D | D | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 nt_dt | 02-05-2026 | 02-05-2026 | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 val | 5900 | 5900 | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 pos | 27 | 27 | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): 1 rate, taxable value and tax | [{"rt": 18.0, "txval": 5000.0, "iamt": 900.0, "camt": 0.0, "samt": 0.0}] | [{"rt": 18.0, "txval": 5000.0, "iamt": 900.0, "camt": 0.0, "samt": 0.0}] | PASS |  |
| GSTR-1 | May 2026 table 9B registered (cdnr): nothing else in the table | [] | [] | PASS |  |
| GSTR-1 | May 2026 table 9B unregistered (cdnur): 2 09 in the table | 1 | 1 | PASS (tax-accuracy: FAIL, 0) |  |
| GSTR-1 | May 2026 table 9B unregistered (cdnur): 2 typ | B2CL | B2CL | PASS |  |
| GSTR-1 | May 2026 table 9B unregistered (cdnur): 2 ntty | C | C | PASS |  |
| GSTR-1 | May 2026 table 9B unregistered (cdnur): 2 nt_dt | 02-05-2026 | 02-05-2026 | PASS |  |
| GSTR-1 | May 2026 table 9B unregistered (cdnur): 2 val | 23600 | 23600 | PASS |  |
| GSTR-1 | May 2026 table 9B unregistered (cdnur): 2 pos | 09 | 09 | PASS |  |
| GSTR-1 | May 2026 table 9B unregistered (cdnur): 2 rate, taxable value and tax | [{"rt": 18.0, "txval": 20000.0, "iamt": 3600.0, "camt": 0.0, "samt": 0.0}] | [{"rt": 18.0, "txval": 20000.0, "iamt": 3600.0, "camt": 0.0, "samt": 0.0}] | PASS |  |
| GSTR-1 | May 2026 table 9B unregistered (cdnur): nothing else in the table | [] | [] | PASS |  |
| GSTR-1 | May 2026 table 11A (advances) place 27: rate, advance and tax | [{"rt": 18.0, "ad_amt": 50000.0, "iamt": 9000.0}] | [{"rt": 18.0, "ad_amt": 50000.0, "iamt": 9000.0}] | PASS |  |
| GSTR-1 | May 2026 table 13 documents, nature 1: from / to / total / cancelled | 1 / 14 / 14 / 1 | 1 / 14 / 14 / 1 | PASS |  |
| GSTR-1 | May 2026 table 13 documents, nature 4: from / to / total / cancelled | 1 / 1 / 1 / 0 | 1 / 1 / 1 / 0 | PASS (tax-accuracy: FAIL, (none)) |  |
| GSTR-1 | May 2026 table 13 documents, nature 5: from / to / total / cancelled | 1 / 2 / 2 / 0 | 1 / 2 / 2 / 0 | PASS |  |
| GSTR-1 | May 2026: the optional entry OPT/001 in no table | [] | [] | PASS |  |
| GSTR-1 | May 2026: the cancelled FC/26-27/012 in no table but table 13 | [] | [] | PASS |  |
| GSTR-3B | May 2026 3.1(a) outward taxable: taxable value | 670000 | 670000.0 | PASS (tax-accuracy: FAIL, 815000.0) |  |
| GSTR-3B | May 2026 3.1(a) outward taxable: IGST | 96300 | 96300.0 | PASS (tax-accuracy: FAIL, 122400.0) |  |
| GSTR-3B | May 2026 3.1(a) outward taxable: CGST | 12150 | 12150.0 | PASS |  |
| GSTR-3B | May 2026 3.1(a) outward taxable: SGST | 12150 | 12150.0 | PASS |  |
| GSTR-3B | May 2026 3.1(a) outward taxable: cess | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 3.1(b) zero-rated: taxable value | 780000 | 780000.0 | PASS (tax-accuracy: FAIL, 550000.0) |  |
| GSTR-3B | May 2026 3.1(b) zero-rated: IGST | 81000 | 81000.0 | PASS (tax-accuracy: FAIL, 54000.0) |  |
| GSTR-3B | May 2026 3.1(b) zero-rated: CGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 3.1(b) zero-rated: SGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 3.1(b) zero-rated: cess | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 3.1(c) nil and exempt: taxable value | 50000 | 50000.0 | PASS (tax-accuracy: FAIL, 130000.0) |  |
| GSTR-3B | May 2026 3.1(d) inward reverse charge: taxable value | 50000 | 50000.0 | PASS |  |
| GSTR-3B | May 2026 3.1(d) inward reverse charge: IGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 3.1(d) inward reverse charge: CGST | 4500 | 4500.0 | PASS |  |
| GSTR-3B | May 2026 3.1(d) inward reverse charge: SGST | 4500 | 4500.0 | PASS |  |
| GSTR-3B | May 2026 3.1(d) inward reverse charge: cess | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 3.1(e) non-GST: taxable value | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(A)(1) import of goods: IGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(A)(1) import of goods: CGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(A)(1) import of goods: SGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(A)(2) import of services: IGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(A)(2) import of services: CGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(A)(2) import of services: SGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(A)(3) reverse charge: IGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(A)(3) reverse charge: CGST | 4500 | 4500.0 | PASS |  |
| GSTR-3B | May 2026 4(A)(3) reverse charge: SGST | 4500 | 4500.0 | PASS |  |
| GSTR-3B | May 2026 4(A)(5) all other ITC: IGST | 18000 | 18000.0 | PASS (tax-accuracy: FAIL, 17100.0) |  |
| GSTR-3B | May 2026 4(A)(5) all other ITC: CGST | 74050 | 74050.0 | PASS |  |
| GSTR-3B | May 2026 4(A)(5) all other ITC: SGST | 74050 | 74050.0 | PASS |  |
| GSTR-3B | May 2026 4(B)(1) reversed, rules 38/42/43 and 17(5): IGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(B)(1) reversed, rules 38/42/43 and 17(5): CGST | 70000 | 0.0 | FAIL | TallyPrime 7.1's XML import did not keep the blocked-credit mark (GSTOVRDNINELIGIBLEITC came back 'Not Applicable' on th; NOT A FINCOM FAULT: the harness cannot |
| GSTR-3B | May 2026 4(B)(1) reversed, rules 38/42/43 and 17(5): SGST | 70000 | 0.0 | FAIL | TallyPrime 7.1's XML import did not keep the blocked-credit mark (GSTOVRDNINELIGIBLEITC came back 'Not Applicable' on th; NOT A FINCOM FAULT: the harness cannot |
| GSTR-3B | May 2026 4(B)(2) reversed, others: IGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(B)(2) reversed, others: CGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(B)(2) reversed, others: SGST | 0 | 0.0 | PASS |  |
| GSTR-3B | May 2026 4(C) net ITC: IGST | 18000 | 18000.0 | PASS (tax-accuracy: FAIL, 17100.0) |  |
| GSTR-3B | May 2026 4(C) net ITC: CGST | 8550 | 78550.0 | FAIL | TallyPrime 7.1's XML import did not keep the blocked-credit mark (GSTOVRDNINELIGIBLEITC came back 'Not Applicable' on th; NOT A FINCOM FAULT: the harness cannot |
| GSTR-3B | May 2026 4(C) net ITC: SGST | 8550 | 78550.0 | FAIL | TallyPrime 7.1's XML import did not keep the blocked-credit mark (GSTOVRDNINELIGIBLEITC came back 'Not Applicable' on th; NOT A FINCOM FAULT: the harness cannot |
| GSTR-3B | May 2026 table 5 exempt, nil and composition inward: inter / intra | 0.00 / 25000.00 | 0.00 / 25000.00 | PASS |  |
| GSTR-3B | May 2026 table 5 non-GST inward: inter / intra | 0.00 / 0.00 | 0.00 / 0.00 | PASS |  |
| Amendments | Jul 2026 table 4A (b2b): 17 07AABCA1111A1ZT in the table | 1 | 1 | PASS |  |
| Amendments | Jul 2026 table 4A (b2b): 17 idt | 01-07-2026 | 01-07-2026 | PASS |  |
| Amendments | Jul 2026 table 4A (b2b): 17 val | 11800 | 11800 | PASS |  |
| Amendments | Jul 2026 table 4A (b2b): 17 pos | 07 | 07 | PASS |  |
| Amendments | Jul 2026 table 4A (b2b): 17 inv_typ | R | R | PASS |  |
| Amendments | Jul 2026 table 4A (b2b): 17 rate, taxable value and tax | [{"rt": 18.0, "txval": 10000.0, "iamt": 0.0, "camt": 900.0, "samt": 900.0}] | [{"rt": 18.0, "txval": 10000.0, "iamt": 0.0, "camt": 900.0, "samt": 900.0}] | PASS |  |
| Amendments | Jul 2026 table 4A (b2b): nothing else in the table | [] | [] | PASS |  |
| Amendments | Jul 2026 table 9A (b2ba): 2 27AABCB2222B1ZI in the table | 1 | 1 | PASS |  |
| Amendments | Jul 2026 table 9A (b2ba): 2 oidt | 01-05-2026 | 01-05-2026 | PASS |  |
| Amendments | Jul 2026 table 9A (b2ba): 2 idt | 01-05-2026 | 01-05-2026 | PASS |  |
| Amendments | Jul 2026 table 9A (b2ba): 2 val | 259600 | 259600 | PASS |  |
| Amendments | Jul 2026 table 9A (b2ba): 2 pos | 27 | 27 | PASS |  |
| Amendments | Jul 2026 table 9A (b2ba): 2 inv_typ | R | R | PASS |  |
| Amendments | Jul 2026 table 9A (b2ba): 2 rate, taxable value and tax | [{"rt": 18.0, "txval": 220000.0, "iamt": 39600.0, "camt": 0.0, "samt": 0.0}] | [{"rt": 18.0, "txval": 220000.0, "iamt": 39600.0, "camt": 0.0, "samt": 0.0}] | PASS |  |
| Amendments | Jul 2026 table 9A (b2ba): nothing else in the table | [] | [] | PASS |  |
| Amendments | Jul 2026 table 9C (cdnra): 1 07AABCA1111A1ZT in the table | 1 | 1 | PASS |  |
| Amendments | Jul 2026 table 9C (cdnra): 1 ont_dt | 02-05-2026 | 02-05-2026 | PASS |  |
| Amendments | Jul 2026 table 9C (cdnra): 1 ntty | C | C | PASS |  |
| Amendments | Jul 2026 table 9C (cdnra): 1 nt_num | 1 | 1 | PASS |  |
| Amendments | Jul 2026 table 9C (cdnra): 1 nt_dt | 02-05-2026 | 02-05-2026 | PASS |  |
| Amendments | Jul 2026 table 9C (cdnra): 1 val | 14160 | 14160 | PASS |  |
| Amendments | Jul 2026 table 9C (cdnra): 1 pos | 07 | 07 | PASS |  |
| Amendments | Jul 2026 table 9C (cdnra): 1 rate, taxable value and tax | [{"rt": 18.0, "txval": 12000.0, "iamt": 0.0, "camt": 1080.0, "samt": 1080.0}] | [{"rt": 18.0, "txval": 12000.0, "iamt": 0.0, "camt": 1080.0, "samt": 1080.0}] | PASS |  |
| Amendments | Jul 2026 table 9C (cdnra): nothing else in the table | [] | [] | PASS |  |
| Amendments | Jul 2026 table 10 (b2csa) for 052026 place 07 INTRA: rate, revised taxable and tax | [{"rt": 18.0, "txval": 40000.0, "iamt": 0.0, "camt": 3600.0, "samt": 3600.0}] | [{"rt": 18.0, "txval": 40000.0, "iamt": 0.0, "camt": 3600.0, "samt": 3600.0}] | PASS |  |
| Amendments | Jul 2026 table 10 (b2csa): nothing else | 0 | 0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 3.1(a) outward taxable: taxable value | 23000 | 23000.0 | PASS (tax-accuracy: FAIL, 10000.0) |  |
| Amendments | Jul 2026 GSTR-3B 3.1(a) outward taxable: IGST | 3600 | 3600.0 | PASS (tax-accuracy: FAIL, 0.0) |  |
| Amendments | Jul 2026 GSTR-3B 3.1(a) outward taxable: CGST | 270 | 270.0 | PASS (tax-accuracy: FAIL, 900.0) |  |
| Amendments | Jul 2026 GSTR-3B 3.1(a) outward taxable: SGST | 270 | 270.0 | PASS (tax-accuracy: FAIL, 900.0) |  |
| Amendments | Jul 2026 GSTR-3B 3.1(a) outward taxable: cess | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 3.1(b) zero-rated: taxable value | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 3.1(b) zero-rated: IGST | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 3.1(c) nil and exempt: taxable value | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 3.1(d) inward reverse charge: taxable value | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 3.1(d) inward reverse charge: IGST | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 3.1(d) inward reverse charge: CGST | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 3.1(d) inward reverse charge: SGST | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 4(A)(5) all other ITC: IGST | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 4(A)(5) all other ITC: CGST | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 4(A)(5) all other ITC: SGST | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 4(C) net ITC: IGST | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 4(C) net ITC: CGST | 0 | 0.0 | PASS |  |
| Amendments | Jul 2026 GSTR-3B 4(C) net ITC: SGST | 0 | 0.0 | PASS |  |

Made by tests/run_e2e_tdsgst.py (branch e2e-tdsgst); the Tally run's captures are in tests/fixtures/tdsgst-e2e/real71.
