# The fixture books: what the reports should say, worked out by hand

Larkspur Fixture Events Private Limited is made up, and so is everything in it. Its books for 2025-26 are in
`Master.xml` and `DayBook.xml` here, written by `make_books.py` in TallyPrime's export format. The company has two
registrations: 07AAGCL4827M1Z3 (Delhi, the main one) and 09AAGCL4827M1ZZ (Uttar Pradesh, one sale and one bill in June).

The figures below come from the vouchers and accounting rules, not from FinCom. `tests/run_fixture_books.js` checks the
app against them. If a voucher changes in `make_books.py`, these figures have to be worked out again. Never change a
figure here only because the app now gives a different one.

All amounts are in rupees. Dates are in 2025-26, and the books run from 01-Apr-2025 to 31-Mar-2026.

## What the books cover

| Case | Where |
|---|---|
| A customer whose Tally name has a line break (`&#13;&#10;`), read as "Orchid Lane Hospitality Pvt Ltd (Noida)" | Master and every voucher of that customer |
| Money received on account, and an advance, from a customer with bill-wise bills (the ageing nets them against the oldest bills) | Quillfeather Weddings LLP |
| An opening bill only partly paid this year (the rest has no bill in the day book, so it is "not bill-wise") | Orchid Lane, OL/24-25/31 |
| A customer with bill-wise off | Brindle Corporate Travels |
| An expense ledger with a credit balance for the year (an old creditor written back) | Sundry Balances Written Off |
| GST output and input with CGST/SGST and IGST, on two registrations | all sales and purchases |
| Reverse charge on freight from an unregistered transporter (GTA) | Ashvattha Transport Co, ATC/56 |
| GST paid from the bank, including reverse-charge GST and the UP registration's GST | 20-May, 20-Jul, 20-Mar |
| Input IGST paid straight from the bank (this is credit taken, not tax paid) | 18-Sep |
| An expense refund received into the bank | Travelling Expenses, 14-Jun |
| Fixed assets: one tangible and one intangible, an addition to each, and depreciation | Laptops and Computers; Event Software Licence |
| TDS deducted under 194C, 194J and 194A, a month-end clearing account, and a late payment with interest | the TDS ledgers |
| An advance for services (11A) adjusted by an invoice in a later month (11B) | Vellichor: received in Jun, invoiced in Jul |
| An advance received and invoiced in the same month (no 11A or 11B) | Orchid Lane, Sep |
| An advance with no invoice (11A, still open at year end) | Zinnia Retreats, Aug |
| An advance for goods (no GST on it) | Quillfeather, Feb |
| The same supplier bill entered twice (NSL/112) | Nightjar Sound & Light Co, a micro enterprise (MSME) |
| Expenses where TDS was due but not deducted (freight 40,000 > 30,000) | Ashvattha |
| A cancelled invoice (no entries) | LFE/25-26/004 |
| Cost centres (Weddings, Corporate) on sales and on one expense | sales; Sound and Light Hire |
| A company's own primary group of expenses, and a group two levels below a primary group | Employee Benefit Expenses; Office Costs |
| Profit & Loss A/c with a debit opening (losses of earlier years), under `&#4; Primary` | Master |
| Loans from people (for the related-party checks) | Hemant Zaverchand (Loan), Nirmala Quereshi (Loan) |
| A second bank account with no entries and a nil balance (the bank-posting tests post to it) | Kaveri Bank - CA 0815 |

## Opening balances (01-Apr-2025)

| Debit | | Credit | |
|---|---:|---|---:|
| Profit & Loss A/c | 8,00,000 | Share Capital | 10,00,000 |
| Laptops and Computers | 1,50,000 | Hemant Zaverchand (Loan) | 2,00,000 |
| Tamarind Urban Bank | 1,78,700 | Nirmala Quereshi (Loan) | 1,00,000 |
| Cash | 15,000 | Nightjar (bill NSL/98) | 30,000 |
| Security Deposit - Office Rent | 60,000 | Peregrine (bill PTW/OLD/17) | 7,500 |
| Quillfeather (bill QW/24-25/88) | 40,000 | TDS ON CONTRACT 194C | 1,200 |
| Orchid Lane (bill OL/24-25/31) | 70,000 | | |
| Brindle | 25,000 | | |
| **Total** | **13,38,700** | **Total** | **13,38,700** |

## Profit and loss, 2025-26

| | |
|---|---:|
| Sale of Decor Goods (4,00,000 + 3,00,000 + 2,00,000) | 9,00,000 |
| Event Management Services (50,000 + 2,00,000 + 1,20,000 + 80,000 + 50,000) | 5,00,000 |
| **Revenue from operations** | **14,00,000** |
| Interest on Bank Deposit | 4,200 |
| Sundry Balances Written Off (credit balance for the year, 7,500, moved to income) | 7,500 |
| **Other income** | **11,700** |
| **Total income** | **14,11,700** |
| Direct expenses: Sound and Light Hire 3,50,000 (1,00,000 x 2, the duplicate included as booked, + 1,50,000); Tent and Venue Hire 2,20,000; Freight Inward 40,000 | 6,10,000 |
| Employee costs: Staff Salaries (45,000 x 4) | 1,80,000 |
| Other expenses: Office Rent 1,20,000; Legal and Professional Fees 90,000; Travelling 9,000 (12,000 less the 3,000 refund); Printing 2,500; Interest on TDS 450; GST Late Fee 200 | 2,22,150 |
| Finance costs: Interest on Unsecured Loans | 20,000 |
| Depreciation (40,000 on laptops, 20,000 on the licence) | 60,000 |
| **Total expenses** | **10,92,150** |
| **Profit before tax** (no tax is booked) | **3,19,550** |
| Gross profit (revenue less purchases and direct expenses) | 7,90,000 |

**Other income and other expenses.** Other income is 11,700. Other expenses are 2,22,150. The written-back 7,500 is income;
it is not a negative expense, on every screen: the profit and loss, the Accounts tab, and profit by cost centre (income
14,11,700, expenses 10,92,150, allocated or not).

In the Schedule III statement (the Accounts tab), direct expenses have no line of their own. They go in other expenses
there: 6,10,000 + 2,22,150 = 8,32,150. The totals and the profit are the same as above.

## Balance sheet at 31-Mar-2026 (Schedule III)

| Equity and liabilities | | Assets | |
|---|---:|---|---:|
| Share capital | 10,00,000 | Property, plant and equipment (laptops: 1,50,000 + 80,000 - 40,000) | 1,90,000 |
| Reserves and surplus (-8,00,000 + 3,19,550) | -4,80,450 | Intangible assets (licence: 1,20,000 - 20,000) | 1,00,000 |
| Long-term borrowings (Hemant 2,18,000 incl. 18,000 net interest; Nirmala 1,00,000) | 3,18,000 | Trade receivables | 7,18,200 |
| Trade payables (Nightjar 2,90,000; Juniper 32,400) | 3,22,400 | Cash and cash equivalents (bank 1,37,450; cash 12,500) | 1,49,950 |
| Other current liabilities (Zinnia's advance 59,000; output GST 1,74,600; TDS 10,000) | 2,43,600 | Short-term loans and advances (deposit 60,000; advance to Saltmarsh 25,000; input GST 1,60,400) | 2,45,400 |
| **Total** | **14,03,550** | **Total** | **14,03,550** |

Output GST is 07 CGST 70,200 + 07 SGST 70,200 + 07 IGST 30,600 + 09 CGST 1,800 + 09 SGST 1,800 = 1,74,600. Input GST is
07 CGST 51,400 + 07 SGST 51,400 + 07 IGST 54,000 + 09 CGST 1,800 + 09 SGST 1,800 = 1,60,400. TDS is 194C 5,000 + 194J 3,000 +
194A 2,000 = 10,000. Reserves are negative because the losses brought forward are larger than this year's profit, so
"Negative on the balance sheet" is expected.

The last-year column (the opening balances) totals 5,38,700 on each side. Equity and liabilities: 10,00,000 - 8,00,000 +
3,00,000 + 37,500 + 1,200. Assets: 1,50,000 + 1,35,000 + 1,93,700 + 60,000.

The bank works out like this. Opening 1,78,700, plus receipts 11,35,000, less payments 11,76,250, is 1,37,450.

## Trade receivables and their ages at 31-Mar-2026

Each customer's balance:

| Customer | Balance |
|---|---:|
| Quillfeather: 40,000 + 4,72,000 + 3,54,000 + 2,36,000 - 4,72,000 - 40,000 - 1,00,000 (on account) - 60,000 (advance) | 4,30,000 |
| Orchid Lane: 70,000 + 1,41,600 + 59,000 - 70,800 (advance) - 40,000 | 1,59,800 |
| Brindle: 25,000 + 94,400 - 50,000 | 69,400 |
| Marigold | 59,000 |
| Vellichor (advance 1,18,000, used by invoice LFE/25-26/006; then paid in full) | 0 |
| **Trade receivables (customers in debit)** | **7,18,200** |
| Zinnia (an advance received; a liability, not a receivable) | 59,000 Cr |

Ages are counted from the due date (the bill date plus Tally's credit days). A bill with no credit days is aged from
the bill date. Amounts received on account, and advances, are set against the oldest open bills first. What is owed
that no bill dates is "not bill-wise".

- **Quillfeather.** The open bills are LFE/25-26/010 (3,54,000, 20-Oct, 30 days) and LFE/25-26/013 (2,36,000, 10-Jan, 30 days). Set 1,60,000 against them, oldest first. LFE/010 has 1,94,000 left. It was due on 19-Nov, so it is 132 days overdue (91-180). LFE/013 has 2,36,000 left. It was due on 09-Feb, so it is 50 days overdue (31-60).
- **Orchid Lane.** LFE/25-26/008: 70,800 (the rest of 1,41,600 after the advance), due on 06-Nov (45 days), 145 days overdue (91-180). LFE/25-26/015: 59,000, due on 04-May-2026, not yet due (0-30). The other 30,000 is what is left of the opening bill OL/24-25/31, which has no bill in this day book (not bill-wise).
- **Marigold.** LFU/25-26/001: 59,000 of 18-Jun, no credit days, 286 days old (over 180).
- **Brindle.** Bill-wise is off, so all 69,400 is not bill-wise.

| 0-30 | 31-60 | 61-90 | 91-180 | over 180 | not bill-wise | total |
|---:|---:|---:|---:|---:|---:|---:|
| 59,000 | 2,36,000 | 0 | 2,64,800 | 59,000 | 99,400 | **7,18,200** |

The 91-180 bucket is 1,94,000 + 70,800. Not bill-wise is 30,000 + 69,400. The buckets add up to the ledger balances.

## Trade payables and their ages at 31-Mar-2026

| Supplier | Open | Age | Bucket |
|---|---:|---|---|
| Nightjar NSL/112: 1,16,000 x 2, less 1,16,000 paid | 1,16,000 | due 04-Jun-2025, 300 days | over 180 |
| Nightjar NSL/140 | 1,74,000 | due 14-Feb, 45 days | 31-60 |
| Juniper JLA/388 | 32,400 | 25-Feb, 34 days | 31-60 |

| 0-30 | 31-60 | 61-90 | 91-180 | over 180 | not bill-wise | total |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 2,06,400 | 0 | 0 | 1,16,000 | 0 | **3,22,400** |

Saltmarsh's 25,000 is an advance paid. Nightjar is a micro enterprise. Both of its bills are more than 45 days old from
the bill date, so 2,90,000 is owed to an MSME supplier beyond 45 days (section 43B(h)).

## The 13-week forecast, week 1 (01-Apr-2026 to 07-Apr-2026)

The rules are the ones the forecast states:

- A customer's bill is expected after that customer's usual days to pay. These come from the bills it has settled in these books. A bill whose expected date has passed counts in week 1.
- A supplier's bill follows the same rule. For a micro or small supplier, the time is never more than 45 days.
- A payment made in each of the last months, at about the same amount, is expected again on the same day of the month.
- GST is due on the 20th. TDS is due on the 7th of the next month, but TDS deducted in March is due on 30 April (rule 30(2)).

**Usual days.** Customers: Quillfeather settled LFE/001 in 40 days. Suppliers: no supplier's own days apply to week 1
except Juniper's (JLA/311 was settled in 40 days). Every other supplier bill uses the median of all settled supplier
bills, 25 days (15, 18, 21, 28, 30 and 40). Nightjar is micro, so its days are min(25, 45) = 25.

| In | | Out | |
|---|---:|---|---:|
| Quillfeather LFE/010 (left after amounts on account), overdue | 1,94,000 | Nightjar NSL/112, overdue | 1,16,000 |
| Quillfeather LFE/013 (10-Jan + 40 days), overdue | 2,36,000 | Nightjar NSL/140 (15-Jan + 25 days), overdue | 1,74,000 |
| Orchid Lane LFE/008, overdue | 70,800 | Juniper JLA/388 (25-Feb + 40 days = 06-Apr) | 32,400 |
| Marigold LFU/001, overdue | 59,000 | Office Rent, paid 30,000 on the 5th of Dec, Jan, Feb and Mar | 30,000 |
| **Total in** | **5,59,800** | **Total out** | **3,52,400** |

Week 1 net: **2,07,400**.

Orchid Lane's LFE/015 is expected after 08-Apr, so it is not in week 1. March's TDS of 2,000 falls due on 30 April,
which is week 5, not week 1. The app puts it on 7 April: see finding 2 below.

## Cash flow, 2025-26 (direct method)

| | |
|---|---:|
| Received from customers | 11,27,800 |
| Expenses refunded or recovered (the travel refund) | 3,000 |
| Other income received | 4,200 |
| Paid to suppliers | -7,69,400 |
| **GST** (paid from the bank to the GST ledgers: 72,000 on 20-May + 5,400 on 20-Jul (UP) + 2,000 reverse charge on 20-Mar) | **-79,400** |
| **Input GST paid with bills** (the bank payment of input IGST on 18-Sep; credit taken, not tax paid) | **-3,600** |
| GST interest and late fees | -200 |
| TDS and TCS (1,200 + 10,000, and 450 interest on TDS, which goes on this line by its name) | -11,650 |
| Salaries and staff | -1,80,000 |
| Expenses paid (travel 12,000, rent 1,20,000, printing 2,500 in cash) | -1,34,500 |
| **Net change in cash and bank** | **-43,750** |

Cash and bank go from 1,93,700 to 1,49,950, a change of -43,750, which agrees. The payments for the laptops (94,400) and
the licence (1,41,600) went through the suppliers' ledgers, so they are in "Paid to suppliers", not under investing.
That is how a direct-method flow built from the ledger opposite the bank line works. It is a limit of the method, not
an arithmetic error.

## GST by month (output, credit, reverse charge, worked out to pay)

Each registration is set off on its own, because credit cannot move between GSTINs. The columns are:

- Output: 3.1(a), including advances (11A less 11B).
- Credit: 4(C), including the reverse-charge credit.
- RCM: 3.1(d), always paid in cash.
- To pay: the cash left after set-off, with credit carried forward.

The table adds the two registrations together.

| Month | Output | Credit | RCM | To pay | Paid from bank | How |
|---|---:|---:|---:|---:|---:|---|
| Apr-2025 | 72,000 | 0 | 0 | 72,000 | 0 | LFE/001: CGST 36,000 + SGST 36,000 |
| May-2025 | 0 | 36,000 | 0 | 0 | 72,000 | NSL/112 twice: 18,000 + 18,000; carried 18,000 / 18,000 |
| Jun-2025 | 27,000 | 3,600 | 0 | **5,400** | 0 | 07: 11A on Vellichor's 1,18,000 (taxable 1,00,000, CGST 9,000 + SGST 9,000), covered by credit carried. 09: 9,000 - 3,600 = 5,400 |
| Jul-2025 | 18,000 | 14,400 | 0 | 0 | 5,400 | 07: LFE/006 36,000 less 11B 18,000; IGST credit 14,400 + carried 18,000 |
| Aug-2025 | 9,000 | 21,600 | 0 | 0 | 0 | 07: 11A on Zinnia's 59,000 (taxable 50,000); credit 21,600 |
| Sep-2025 | 21,600 | 39,600 | 0 | 0 | 0 | 07: IGST 21,600 out; IGST 36,000 + 3,600 in (Orchid's advance and invoice in the same month: no 11A or 11B) |
| Oct-2025 | 54,000 | 0 | 0 | **9,000** | 0 | 07: 54,000 less carried 45,000 (IGST 18,000, CGST 13,500, SGST 13,500) |
| Nov-2025 | 14,400 | 10,800 | 0 | 3,600 | 0 | |
| Dec-2025 | 0 | 0 | 0 | 0 | 0 | |
| Jan-2026 | 36,000 | 27,000 | 0 | 9,000 | 0 | |
| Feb-2026 | 0 | 7,400 | 2,000 | 2,000 | 0 | credit 5,400 + reverse-charge credit 2,000; carried 3,700 / 3,700. Quillfeather's advance is for goods: no 11A |
| Mar-2026 | 9,000 | 0 | 0 | 1,600 | 2,000 | IGST 9,000 less carried CGST 3,700 and SGST 3,700 |
| **Year** | **2,61,000** | **1,60,400** | **2,000** | **1,02,600** | **79,400** | |

To pay for the year is 2,61,000 - 1,60,400 + 2,000 = 1,02,600, since no credit is left at the end. By registration,
07 is 97,200 and 09 is 5,400.

## TDS

| | |
|---|---:|
| Opening | 1,200 |
| Deducted (194C 2,000 + 2,000 + 2,000 + 3,000; 194J 6,000 + 3,000; 194A 2,000) | 20,000 |
| Paid (1,200 on 07-Apr; 10,000 on 07-Feb through the month-end account) | 11,200 |
| **Closing, the same as the TDS ledgers** | **10,000** |

## Findings: where the app disagrees, and why the hand figure is right

These are not fixed in the app; they are left for review. Until they are, `run_fixture_books.js` fails on the checks
marked "FINDING".

1. **GST by month pools the two registrations** (`src/js/07-mis.js`, `MIS.compliance`, and the GST line of
   `MIS.forecast`). One 3B working, `GSTR.threeB(m, "")`, is used for all registrations together, so Delhi's credit is
   set against Uttar Pradesh's tax. Credit cannot be set off across GSTINs.
   - Jun-2025: the app says 0 to pay; by hand it is 5,400 (UP).
   - Oct-2025: the app says 14,400; by hand it is 9,000.

   The year's total is the same, 1,02,600, but the months are wrong. The proposed fix is to work out each registration
   on its own and add the figures. A client with one registration would be unchanged.
2. **March's TDS is expected on 7 April in the 13-week forecast** (`src/js/07-mis.js`, `MIS.forecast`). Every month's
   TDS is put on the 7th of the next month, but TDS deducted in March is due on 30 April (rule 30(2)), as `MIS.dues`
   already says. Week 1 shows 3,54,400 out, where the right figure is 3,52,400. The proposed fix is for April's date
   to be the 30th.
3. **Profit by cost centre counts the written-back expense as an expense** (`src/js/07-mis.js`, `MIS.costCentres`). The
   profit and loss (`MIS.pl`) moves an expense ledger that is in credit for the period to other income. The cost-centre
   working uses the ledger's head without that rule. Its income plus what is not allocated comes to 14,04,200, against
   14,11,700 in the profit and loss, and its expenses to 10,84,650, against 10,92,150. The 7,500 written back to Sundry
   Balances Written Off sits on the wrong side. Profit is the same. The proposed fix is for the cost centres to use the
   same rule.
4. *A note, not a finding.* The customers' "usual days to pay" (`MIS.payDays`) also count an advance that a later
   invoice used up. Vellichor's advance to its invoice gave 35 days, and Orchid Lane's gave 19 days, as if they were times
   to pay. Week 1 does not change. It only moves when Orchid Lane's March bill is expected (08-Apr rather than later).
