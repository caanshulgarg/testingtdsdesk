# TDS and GST end-to-end fixture: the answer key, worked out by hand

Test data only: a throwaway company "FinCom Spike Co" (Delhi, GSTIN 07AAACF1234A1ZH, TAN DELF01234E) made in the
real-Tally harness's own TallyPrime 7.1. Every party, PAN and GSTIN is made up (the GSTINs carry a correct check
character). The entries are in `make.mjs`; `node make.mjs tally` writes the XML the harness imports (`tally/`).
`expected.json` holds the figures below; it is NOT made by FinCom's code. All amounts in rupees.

## The entries (FY 2026-27; Educational mode allows the 1st, 2nd and 31st of a month)


| Id | Date | Entry | Value | Tax |
|---|---|---|---|---|
| S01 | 01-05 | FC/26-27/001 Alpha (07, regular), intra | 1,00,000 | CGST 9,000 SGST 9,000 |
| S02 | 01-05 | FC/26-27/002 Beta (27, regular), inter | 2,00,000 | IGST 36,000 |
| S03 | 01-05 | FC/26-27/003 Gamma (29, SEZ), with payment | 1,50,000 | IGST 27,000 |
| S04 | 01-05 | FC/26-27/004 Delta (33, SEZ), LUT | 80,000 | nil (18% goods) |
| S05 | 02-05 | FC/26-27/005 Euro Imports (Germany), with payment | 3,00,000 | IGST 54,000 |
| S06 | 02-05 | FC/26-27/006 Euro Imports, LUT | 2,50,000 | nil (18% goods) |
| S07 | 02-05 | FC/26-27/007 Retail Customer UP (09, unregistered) | 1,50,000 | IGST 27,000 (B2C large: inter-state, invoice over 1 lakh) |
| S08 | 02-05 | FC/26-27/008 Cash Sales Delhi (unregistered) | 40,000 | CGST 3,600 SGST 3,600 |
| S09 | 02-05 | FC/26-27/009 Walkin Haryana (06, unregistered) | 50,000 | IGST 9,000 (B2C small: 59,000 is under 1 lakh) |
| S10 | 02-05 | FC/26-27/010 Alpha, nil-rated (HSN 0701) | 30,000 | - |
| S11 | 02-05 | FC/26-27/011 Walkin Haryana, exempt (HSN 0401) | 20,000 | - |
| S12 | 31-05 | FC/26-27/012 Cash Sales Delhi, cancelled before filing | (10,000) | - |
| S13 | 31-05 | FC/26-27/013 Cash Sales Delhi, deleted after filing | 5,000 | CGST 450 SGST 450 |
| S14 | 02-05 | OPT/001 Alpha, optional (a memorandum) | (7,000) | - |
| S15 | 02-05 | FC/26-27/014 Iota Services Pune (27), services SAC 998314 | 1,00,000 | IGST 18,000 |
| RV1 | 02-05 | RV/001 advance from Iota for services, not invoiced | 59,000 received | inside: 50,000 + IGST 9,000 |
| CN1 | 02-05 | CN/001 Alpha, goods back | 10,000 | CGST 900 SGST 900 |
| CN2 | 02-05 | CN/002 Retail Customer UP (against the B2C large S07) | 20,000 | IGST 3,600 |
| DN1 | 02-05 | DN/001 to Beta, price revision on S02 | 5,000 | IGST 900 |
| P01 | 01-05 | PUR/001 Kappa (07), eligible | 50,000 | CGST 4,500 SGST 4,500 |
| P02 | 01-05 | PUR/002 Lambda (08), eligible | 1,00,000 | IGST 18,000 |
| P03 | 02-05 | PUR/003 Mu Advocates (unregistered), legal services, reverse charge | 50,000 | CGST 4,500 SGST 4,500 (payable and credited) |
| P04 | 02-05 | PUR/004 Nu Motors (07), motor car, credit blocked (17(5)) | 5,00,000 | CGST 70,000 SGST 70,000 |
| P05 | 02-05 | PUR/005 Xi Farm Produce (unregistered), exempt | 25,000 | - |
| DN2 | 02-05 | DN-P/001 goods back to Kappa | 5,000 | CGST 450 SGST 450 (credit reduced) |
| T01-T11 | Apr-Jun | the TDS journals (below) | | |
| TC1 | 01-06 | FC/26-27/015 Scrap Buyer, TCS 2% on 1,18,000 | | TCS 2,360 |
| TC2 | 02-06 | FC/26-27/016 Zeta, a "TCS 206C(1H)" ledger, 0.1% | | TCS 118 |
| S20 | 01-07 | FC/26-27/017 Alpha | 10,000 | CGST 900 SGST 900 |

After May's GSTR-1 and Q1's TDS return are "filed" (phase 2): S02 revised to 2,20,000 + IGST 39,600; CN1 revised to
12,000 + CGST 1,080 + SGST 1,080; S13 deleted on Tally's screen; T02 moved from 194C (1,200) to 194J (6,000); Sigma
Landlord's PAN corrected to ABCPS9999F.

## GSTR-1, May 2026 (as filed)
- 4A B2B: S01 (07, 1,00,000 / 9,000 / 9,000, value 1,18,000), S02 (27, 2,00,000 / IGST 36,000, value 2,36,000), S15
  (27, 1,00,000 / IGST 18,000, value 1,18,000).
- 6B SEZ (in the portal's b2b list): S03 SEWP (1,50,000 / IGST 27,000, value 1,77,000); S04 SEWOP (80,000, rate 18, no tax).
- 5 B2C large: place 09, S07 (1,50,000 / IGST 27,000, value 1,77,000).
- 6A exports: S05 WPAY (3,00,000 / 54,000, value 3,54,000); S06 WOPAY (2,50,000, rate 18, no tax).
- 7 B2C small: intra, place 07, 18%: S08 40,000 + S13 5,000 = 45,000; CGST 3,600 + 450 = 4,050; SGST 4,050.
  Inter, place 06, 18%: S09 50,000 / IGST 9,000.
- 8 nil: intra-state to registered (INTRAB2B) nil-rated 30,000 (S10); inter-state to unregistered (INTRB2C) exempt 20,000 (S11).
- 9B registered: CN/001 (Alpha) C 10,000 / 900 / 900, value 11,800; DN/001 (Beta) D 5,000 / IGST 900, value 5,900.
- 9B unregistered: CN/002 type B2CL (the invoice it reduces, S07, is B2C large), place 09, 20,000 / IGST 3,600, value 23,600.
- 11A advances: place 27, inter-state, 18%: 59,000 x 100 / 118 = 50,000; IGST 9,000.
- 13 documents: invoices FC/26-27/001 to /014: 14, 1 cancelled (012), net 13; credit notes CN/001-CN/002: 2;
  debit notes DN/001: 1. OPT/001 (optional) and the cancelled 012 are in no other table.

## GSTR-3B, May 2026 (books basis; no 2B brought in)
- 3.1(a): 1,00,000 + 2,00,000 + 1,00,000 (B2B) + 1,50,000 (B2CL) + 40,000 + 5,000 + 50,000 (B2CS) - 10,000 - 20,000
  (credit notes) + 5,000 (debit note) + 50,000 (advance) = **6,70,000**; IGST 36,000 + 18,000 + 27,000 + 9,000 - 3,600 + 900
  + 9,000 = **96,300**; CGST 9,000 + 3,600 + 450 - 900 = **12,150**; SGST **12,150**.
- 3.1(b) zero-rated: 1,50,000 + 80,000 + 3,00,000 + 2,50,000 = **7,80,000**; IGST 27,000 + 54,000 = **81,000**.
- 3.1(c) nil and exempt: 30,000 + 20,000 = **50,000**. 3.1(d) reverse charge: **50,000**, CGST 4,500, SGST 4,500. 3.1(e) 0.
- 4(A)(3) reverse charge: CGST 4,500, SGST 4,500.
- 4(A)(5) all other: IGST 18,000; CGST 4,500 + 70,000 - 450 = **74,050**; SGST **74,050** (blocked credit is shown here
  and reversed in 4(B)(1), CBIC circular 170/02/2022).
- 4(B)(1): CGST 70,000, SGST 70,000. 4(C) net: IGST 18,000; CGST 4,500 + 74,050 - 70,000 = **8,550**; SGST **8,550**.
- 5: intra-state exempt / nil inward **25,000** (P05).

## July 2026 (after the amendments)
- 4A B2B: S20 (07, 10,000 / 900 / 900, value 11,800).
- 9A: FC/26-27/002 of 01-05-2026 revised: 2,20,000 / IGST 39,600, value 2,59,600.
- 9C: CN/001 of 02-05-2026 revised: 12,000 / CGST 1,080 / SGST 1,080, value 14,160.
- 10 B2C small amended for May (05-2026), place 07, intra, 18%: 45,000 - 5,000 = 40,000; CGST 3,600; SGST 3,600.
- GSTR-3B 3.1(a): 10,000 + 20,000 (9A) - 5,000 (10) - 2,000 (9C) = **23,000**; IGST 3,600; CGST 900 - 450 - 180 = **270**;
  SGST **270** (the differences of the amendments are paid in the month they are reported).

## TDS and TCS, Q1 of tax year 2026-27 (Forms 140, 144, 143; was 26Q, 27Q, 27EQ)
| Deductee | PAN | Section | Paid | TDS | Rate | Remark |
|---|---|---|---|---|---|---|
| Omicron Contractors | AAACO1234C | 194C | 1,00,000 | 2,000 | 2 | |
| Pi Consultants | ABCPP1234D | 194C (phase 2: 194J) | 60,000 | 1,200 (phase 2: 6,000) | 2 (10) | |
| Rho Brokers | AABFR1234E | 194H | 40,000 | 800 | 2 | |
| Sigma Landlord | ABCPS1234F (phase 2: ABCPS9999F) | 194I | 75,000 | 7,500 | 10 | |
| Tau Goods Supplier | AAACT1234G | 194Q | 5,00,000 (the part above 50 lakh of 55,00,000) | 500 | 0.1 | |
| Upsilon Finance | AAACU1234H | 194A | 50,000 | 5,000 | 10 | |
| Phi Freelancer | none | 194J | 40,000 | 8,000 | 20 | C (no PAN, old 206AA) |
| Chi Tech Services | AAACC1234J | 194J | 2,00,000 | 2,000 | 1 | A, certificate LDC1234567 |

Totals, Form 140: 8 rows, paid 10,65,000, tax 27,000 (phase 2: 31,800 = 27,000 - 1,200 + 6,000). Psi Small Contractor
(20,000 for a contract, below the threshold, no TDS) is not reported. Form 144: Omega Software Inc, 195, 1,00,000, 20,800
(20.8%). Salary (192, Employee A, 10,000) goes to Form 138 only. Form 143: Scrap Buyer Delhi, code 6CF, received
1,18,000, TCS 2,360 (2%). The "TCS 206C(1H)" collection on TC2 (118) has no collection code in 2026-27 (206C(1H) was
omitted from 1 April 2025): FinCom must not give it one and must say so before filing.
