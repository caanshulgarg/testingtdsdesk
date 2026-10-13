# The Zoho test organisation: the answer key, by hand

FinCom Zoho Test Pvt Ltd, GSTIN 27AAACZ1234Z1ZG (Maharashtra). Documents in `org/` (made by `make_org.py`). Every figure in
`expected.json` is worked out here from the documents, not by FinCom's code.

## GSTR-1, May 2026

| Table | Document | Working |
|---|---|---|
| B2B | INV-001 Alpha (27, intra) | 1,00,000 at 18%: CGST 9,000 + SGST 9,000; value 1,18,000 |
| B2B | INV-002 Beta (07, inter) | 2,00,000 at 18%: IGST 36,000; value 2,36,000 |
| B2B (SEWP) | INV-003 Gamma SEZ | 1,50,000 at 18%: IGST 27,000 (SEZ with payment); value 1,77,000 |
| B2CL | INV-005 Retail Customer (Gujarat, 24) | unregistered, inter-state, value 1,77,000 above 1 lakh: 1,50,000, IGST 27,000 |
| B2CS | INV-006 Walkin Pune | 40,000 at 18% (3,600 + 3,600) and 10,000 at 5% (250 + 250) |
| CDNR | CN-001 to Alpha | 10,000 at 18%: 900 + 900; value 11,800 |
| EXP (WOPAY) | INV-004 Euro Imports | export of services under LUT: 2,50,000 at 0% |
| Not in the return | INV-007 | a draft in Zoho: not in the books |
| Documents issued | INV-001 to INV-008 | 7 numbers (INV-007 is a draft, never issued), INV-008 void: cancelled 1, net 6; CN-001: 1 |

## GSTR-3B, May 2026

- 3.1(a): 1,00,000 + 2,00,000 + 1,50,000 (B2CL) + 50,000 (B2CS) - 10,000 (CN) = **4,90,000**; IGST 36,000 + 27,000 = **63,000**;
  CGST 9,000 + 3,600 + 250 - 900 = **11,950**; SGST the same.
- 3.1(b) zero-rated: SEZ 1,50,000 + export 2,50,000 = **4,00,000**; IGST **27,000** (the SEZ invoice).
- 3.1(d) reverse charge: Mu Advocates' legal fees 50,000 at 18%: CGST **4,500**, SGST **4,500**.
- 4(A)(3): the same 4,500 + 4,500, as credit.
- 4(A)(5): Kappa 4,500 + Omicron 9,000 + the cash expense 90 - the vendor credit 450 = **13,140** CGST; SGST the same.
- 3.2: unregistered persons, Gujarat (24): 1,50,000, IGST 27,000.

## 26Q, Q1 2026-27

- Pi Consultants (PAN AAAPP7777P, an individual): bill PC/9 of 20-Apr-2026, 60,000, TDS 194J at 10% = **6,000**.
- Omicron Contractors (PAN AAACO5555O, a company): bill OC/55 of 6-May-2026, 1,00,000 before GST, TDS 194C at 2% = **2,000**.

## Balances on 31-May-2026 (Tally's sign: a debit is negative)

- HDFC Bank: opening 5,00,000 Dr; + 1,04,200 received (RCPT-1); - 53,100 paid (PAY-1); - 50,000 to ICICI = 5,01,100 Dr: **-5,01,100**.
- ICICI Bank: 50,000 Dr. Petty Cash: 1,180 paid out, no opening: 1,180 Cr. TDS Receivable: 2,000 Dr (withheld by Alpha).
- Kappa Suppliers: 59,000 Cr - 5,900 (VC-001) - 53,100 (PAY-1) - 1,180 (cash expense, paid in cash: not to Kappa) = 0 on the bills; the cash
  expense is booked against Petty Cash, not Kappa. Alpha Traders: 1,18,000 - 11,800 - 1,06,200 = 0.

## Entries

17 live entries (6 invoices, 1 credit note, 4 bills, 1 vendor credit, 1 receipt, 1 payment, 1 expense, 1 journal, 1 transfer), 1 cancelled
(INV-008), 1 draft not taken (INV-007), 1 bank line booked by its own payment not taken twice.
