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
| An expense ledger in credit, smaller than its head's debits: set off inside the head (case a) | Sundry Balances Written Off, in Other expenses |
| An expense ledger in credit, larger than its head's debits: the head nil, the rest in Other income (case b) | Loan Processing Fees (a refund of last year's fee, 16-Mar), in Finance costs |
| Reverse charge on godown rent from an unregistered landlord, journals at each month's end (CGST + SGST) | Rukmini Sethuraman, 31-Jan, 28-Feb, 31-Mar; paid 31-Mar |
| Reverse charge with IGST in March on the Delhi registration: legal services from an advocate in Rajasthan | Keshav Rathore, Advocate, 12-Mar; paid 25-Mar |
| An invoice at two rates (5% and 18%) to a customer with bill-wise off, paid in the month | Wisteria Banquets Pvt Ltd, LFE/25-26/016, 24-Mar |
| A bill unpaid 180 days after its date (rule 37) | Nightjar's NSL/112 of 08-May-2025: November 2025 |

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
| Sale of Decor Goods (4,00,000 + 3,00,000 + 2,00,000 + 1,00,000) | 10,00,000 |
| Event Management Services (50,000 + 2,00,000 + 1,20,000 + 80,000 + 50,000 + 50,000) | 5,50,000 |
| **Revenue from operations** | **15,50,000** |
| Interest on Bank Deposit | 4,200 |
| Excess credit in Finance costs (see below) | 5,000 |
| **Other income** | **9,200** |
| **Total income** | **15,59,200** |
| Direct expenses: Sound and Light Hire 3,50,000 (1,00,000 x 2, the duplicate included as booked, + 1,50,000); Tent and Venue Hire 2,20,000; Freight Inward 40,000 | 6,10,000 |
| Employee costs: Staff Salaries (45,000 x 4) | 1,80,000 |
| Other expenses: Office Rent 1,20,000; Godown Rent 60,000 (20,000 x 3); Legal and Professional Fees 1,30,000 (60,000 + 30,000 + the advocate's 40,000); Travelling 9,000 (12,000 less the 3,000 refund); Printing 2,500; Interest on TDS 450; GST Late Fee 200; Sundry Balances Written Off -7,500 | 3,14,650 |
| Finance costs: Interest on Unsecured Loans 20,000; Loan Processing Fees -25,000; head in credit by 5,000, so nil | 0 |
| Depreciation (40,000 on laptops, 20,000 on the licence) | 60,000 |
| **Total expenses** | **11,64,650** |
| **Profit before tax** (no tax is booked) | **3,94,550** |
| Gross profit (revenue less purchases and direct expenses) | 9,40,000 |

The profit is last year's working of 3,19,550, plus the new sale 1,50,000 and the refunded fee 25,000, less the godown
rent 60,000 and the advocate's fee 40,000: 3,94,550.

**An expense ledger with a credit balance: the owner's rule.** The ledger stays in its own head and its credit is set off
there. Only if the head as a whole ends in credit does what is left go to Other income, and the head then shows nil.
There is no threshold, and no ledger is moved on its own. Each such ledger is flagged "expense ledger with a credit
balance". The same rule holds on every screen: the profit and loss, MIS, profit by cost centre, and the Accounts tab.

- **Case (a), Other expenses.** Sundry Balances Written Off is 7,500 in credit (Peregrine's old bill written back). The
  head's debits are 3,22,150, so the head is 3,14,650 and nothing moves. Other expenses' note: the ledgers, the written
  back -7,500 among them, then debits 3,22,150, less credits 7,500, total 3,14,650. On the Accounts tab the direct
  expenses are in this head too (debits 9,32,150, less 7,500, total 9,24,650).
- **Case (b), Finance costs.** Loan Processing Fees is 25,000 in credit and the head's only debit is the interest of
  20,000. The head ends 5,000 in credit, so it shows nil, and 5,000 goes to Other income as "Excess credit in Finance
  costs". Finance costs' note: Interest on Unsecured Loans 20,000; Loan Processing Fees -25,000 (flagged); debits
  20,000; less credits 25,000; excess credit moved to Other income 5,000; total nil. Other income's note: Interest on
  Bank Deposit 4,200; Excess credit in Finance costs 5,000; total 9,200.

In the Schedule III statement (the Accounts tab), direct expenses have no line of their own. They go in other expenses
there: 6,10,000 + 3,14,650 = 9,24,650. The totals and the profit are the same as above.

**Profit by cost centre.** It uses the same heads and the same rule, so income and expenses, allocated or not, come to the
profit and loss's 15,59,200 and 11,64,650.

| Cost centre | Income | Costs | Profit |
|---|---:|---:|---:|
| Weddings: decor sales 10,00,000; Sound and Light Hire 1,00,000 + 1,00,000 + 1,00,000 | 10,00,000 | 3,00,000 | 7,00,000 |
| Corporate: event sales 5,50,000; Sound and Light Hire 50,000 | 5,50,000 | 50,000 | 5,00,000 |
| Not allocated: interest 4,200 and the excess credit 5,000; every other expense, with the set-off of 5,000 that leaves finance costs nil | 9,200 | 8,14,650 | |

**Ratios.** All of them are on revenue from operations, 15,50,000, never total income. Gross margin is 9,40,000 / 15,50,000,
or 60.6%. Before interest and depreciation it is 4,54,550 / 15,50,000, or 29.3%. Before tax it is 3,94,550 / 15,50,000, or
25.5%. Employee costs are 11.6% and other expenses 20.3%. Days of sales owed are 7,18,200 / (15,50,000 / 365), or 169.
There is no interest cover, since finance costs are nil.

## Balance sheet at 31-Mar-2026 (Schedule III)

| Equity and liabilities | | Assets | |
|---|---:|---|---:|
| Share capital | 10,00,000 | Property, plant and equipment (laptops: 1,50,000 + 80,000 - 40,000) | 1,90,000 |
| Reserves and surplus (-8,00,000 + 3,94,550) | -4,05,450 | Intangible assets (licence: 1,20,000 - 20,000) | 1,00,000 |
| Long-term borrowings (Hemant 2,18,000 incl. 18,000 net interest; Nirmala 1,00,000) | 3,18,000 | Trade receivables | 7,18,200 |
| Trade payables (Nightjar 2,90,000; Juniper 32,400) | 3,22,400 | Cash and cash equivalents (bank 2,19,250; cash 12,500) | 2,31,750 |
| Other current liabilities (Zinnia's advance 59,000; output GST 1,88,600; reverse charge payable 10,800; TDS 10,000) | 2,68,400 | Short-term loans and advances (deposit 60,000; advance to Saltmarsh 25,000; input GST 1,78,400) | 2,63,400 |
| **Total** | **15,03,350** | **Total** | **15,03,350** |

Output GST is 07 CGST 77,200 + 07 SGST 77,200 + 07 IGST 30,600 + 09 CGST 1,800 + 09 SGST 1,800 = 1,88,600. Reverse
charge payable is March's tax, paid in April: 07 RCM CGST 1,800 (credited 1,000 + 1,800 x 3, paid 1,800 + 2,800), 07 RCM
SGST 1,800 and 07 RCM IGST 7,200. Input GST is 07 CGST 56,800 + 07 SGST 56,800 + 07 IGST 61,200 + 09 CGST 1,800 + 09 SGST
1,800 = 1,78,400. TDS is 194C 5,000 + 194J 3,000 + 194A 2,000 = 10,000. The landlord and the advocate were paid in full,
and Wisteria paid its invoice, so none of them has a balance. Reserves are negative because the losses brought forward
are larger than this year's profit, so "Negative on the balance sheet" is expected.

The last-year column (the opening balances) totals 5,38,700 on each side. Equity and liabilities: 10,00,000 - 8,00,000 +
3,00,000 + 37,500 + 1,200. Assets: 1,50,000 + 1,35,000 + 1,93,700 + 60,000.

The bank works out like this. Opening 1,78,700, plus receipts 13,24,000, less payments 12,83,450, is 2,19,250. Receipts are
the earlier 11,35,000, Wisteria's 1,64,000 and the refunded fee 25,000. Payments are the earlier 11,76,250 plus:

- the reverse charge on January's rent, 3,600, paid on 20-Feb;
- the godown rent's share of the 20-Mar payment, 3,600 (5,600 in all);
- the landlord, 60,000;
- the advocate, 40,000.

## Trade receivables and their ages at 31-Mar-2026

Each customer's balance:

| Customer | Balance |
|---|---:|
| Quillfeather: 40,000 + 4,72,000 + 3,54,000 + 2,36,000 - 4,72,000 - 40,000 - 1,00,000 (on account) - 60,000 (advance) | 4,30,000 |
| Orchid Lane: 70,000 + 1,41,600 + 59,000 - 70,800 (advance) - 40,000 | 1,59,800 |
| Brindle: 25,000 + 94,400 - 50,000 | 69,400 |
| Marigold | 59,000 |
| Vellichor (advance 1,18,000, used by invoice LFE/25-26/006; then paid in full) | 0 |
| Wisteria (bill-wise off: LFE/25-26/016, 1,64,000, paid on 30-Mar) | 0 |
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

Rukmini Sethuraman (the landlord) and Keshav Rathore (the advocate) have bill-wise off and were paid in full in March, so
they owe nothing and are owed nothing. Saltmarsh's 25,000 is an advance paid. Nightjar is a micro enterprise. Both of its bills are more than 45 days old from
the bill date, so 2,90,000 is owed to an MSME supplier beyond 45 days (section 43B(h)).

## The 13-week forecast, week 1 (01-Apr-2026 to 07-Apr-2026)

The rules are the ones the forecast states:

- A customer's bill is expected after that customer's usual days to pay. These come from the bills it has settled in these books. A bill whose expected date has passed counts in week 1.
- A supplier's bill follows the same rule. For a micro or small supplier, the time is never more than 45 days.
- A payment made in each of the last months, at about the same amount, is expected again on the same day of the month.
- GST is due on the 20th. TDS is due on the 7th of the next month, but TDS deducted in March is due on 30 April (rule 30(2)).

The entries added on 02-Oct-2026 do not change week 1. Wisteria, the landlord and the advocate have bill-wise off, so
they add no settled bills to the usual days. They were paid, or paid in, within March, so none of them has a bill open.
Their payments are to parties, and a party's payment is never a "monthly payment". The reverse-charge tax goes to GST
ledgers, which are never one either.

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
which is week 5, not week 1 (finding 2, fixed on 02-Oct-2026).

## Cash flow, 2025-26 (direct method)

| | |
|---|---:|
| Received from customers (11,27,800 + Wisteria's 1,64,000) | 12,91,800 |
| Expenses refunded or recovered (the travel refund 3,000; the processing fee refunded 25,000) | 28,000 |
| Other income received | 4,200 |
| Paid to suppliers (7,69,400 + the landlord 60,000 + the advocate 40,000) | -8,69,400 |
| **GST** (paid from the bank to the GST ledgers: 72,000 on 20-May + 5,400 on 20-Jul (UP) + 3,600 reverse charge on 20-Feb + 5,600 reverse charge on 20-Mar) | **-86,600** |
| **Input GST paid with bills** (the bank payment of input IGST on 18-Sep; credit taken, not tax paid) | **-3,600** |
| GST interest and late fees | -200 |
| TDS and TCS (1,200 + 10,000, and 450 interest on TDS, which goes on this line by its name) | -11,650 |
| Salaries and staff | -1,80,000 |
| Expenses paid (travel 12,000, rent 1,20,000, printing 2,500 in cash) | -1,34,500 |
| **Net change in cash and bank** | **38,050** |

Cash and bank go from 1,93,700 to 2,31,750, a change of 38,050, which agrees. The payments for the laptops (94,400) and
the licence (1,41,600) went through the suppliers' ledgers, so they are in "Paid to suppliers", not under investing.
That is how a direct-method flow built from the ledger opposite the bank line works. It is a limit of the method, not
an arithmetic error. The refunded processing fee is a receipt against an expense ledger, the same as the travel refund.
The app puts it on a line "Loans" (finding 5).

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
| Jan-2026 | 36,000 | 30,600 | 3,600 | 9,000 | 0 | credit 27,000 (NSL/140) + the rent's reverse-charge credit 3,600. Each of CGST and SGST: 18,000 - 15,300 = 2,700, plus 1,800 reverse charge = 4,500 |
| Feb-2026 | 0 | 11,000 | 5,600 | 5,600 | 3,600 | credit 5,400 + reverse-charge credit 2,000 (freight) + 3,600 (rent); the 5,600 of reverse charge in cash; carried 5,500 / 5,500. Quillfeather's advance is for goods: no 11A |
| Mar-2026 | 23,000 | 10,800 | 10,800 | 12,000 | 5,600 | see "GST: the Delhi registration's returns" |
| **Year** | **2,75,000** | **1,78,400** | **20,000** | **1,16,600** | **86,600** | |

To pay for the year is 2,75,000 - 1,78,400 + 20,000 = 1,16,600, since no credit is left at the end. By registration,
07 is 1,11,200 and 09 is 5,400.

## GST: the Delhi registration's returns

These are the figures `run_gst134_ui.py`, `run_gstfiling_ui.py` and `run_gstregs_ui.py` check when they run on these books.

**Registrations.** The day book's entries carry two company GSTINs (CMPGSTIN): 07AAGCL4827M1Z3, Delhi, and
09AAGCL4827M1ZZ, Uttar Pradesh. The PAN is AAGCL4827M, and the Delhi GSTIN worked out from it (with its check character)
is the books' own.

**GSTR-3B, March 2026, 07.**

- 3.1(a), outward: taxable 2,00,000. IGST 9,000 (Orchid Lane, LFE/015). CGST 7,000 and SGST 7,000 (Wisteria, LFE/016:
  2,500 + 4,500 each).
- 3.1(d), inward on reverse charge: taxable 60,000. IGST 7,200 on the advocate's 40,000 at 18%, inter-state from Rajasthan.
  CGST 1,800 and SGST 1,800 on the rent of 20,000.
- 4(A)(3), the credit of that tax: the same 10,800. Nothing else is bought in March.

The set-off works one head at a time, with credit carried from February of CGST 5,500 and SGST 5,500:

- IGST credit 7,200 against IGST 9,000 leaves 1,800.
- CGST credit 7,300 pays CGST 7,000, and its other 300 goes to IGST.
- SGST credit works the same way: 7,000 to SGST, 300 to IGST.
- IGST left: 1,200 in cash.

Cash is 1,200 plus the reverse charge 10,800, which is 12,000 (IGST 8,400, CGST 1,800, SGST 1,800). No credit is left.

**Reverse charge for the year, 07.** It is on 1,40,000: the freight 40,000, the rent 60,000 and the advocate 40,000. The
tax is IGST 7,200, CGST 6,400 and SGST 6,400.

**Input register, March 2026, 07.** The register has two entries, and its 10,800 agrees with 3B table 4:

- Keshav Rathore, Advocate: 40,000, IGST 7,200;
- Rukmini Sethuraman: 20,000, CGST 1,800 + SGST 1,800.

Filtered to reverse charge for the year, the register lists the landlord, the advocate and Ashvattha Transport Co (the
freight), and no one else.

**GSTR-1, March 2026, 07.** B2B: LFE/25-26/015 to Orchid Lane (09AACCO6624H1ZC), 50,000 at 18%, IGST 9,000. LFE/25-26/016
to Wisteria goes out as two items: 1,00,000 at 5% (CGST 2,500 + SGST 2,500) and 50,000 at 18% (CGST 4,500 + SGST
4,500). HSN summary, B2B only:

| HSN | Rate | Taxable | IGST | CGST | SGST |
|---|---:|---:|---:|---:|---:|
| 998596 | 18 | 1,00,000 | 9,000 | 4,500 | 4,500 |
| 6304 | 5 | 1,00,000 | 0 | 2,500 | 2,500 |

**Rule 37, November 2025, 07.** Nightjar's NSL/112 was entered twice, 1,16,000 each (2,32,000 billed, tax CGST 18,000 + SGST
18,000). 1,16,000 was paid on 15-Jun, and the ledger still owes 1,16,000 at November's end, so half is unpaid. 180 days
from the bill of 08-May-2025 is 04-Nov-2025. So November reverses, in 4(B)(2), half the credit: CGST 9,000 and SGST
9,000. With rule 37 off (the default) nothing is reversed.

**An opening credit typed for Uttar Pradesh.** The 09 registration first has tax in June: CGST 4,500, less credit 1,800,
is 2,700 in cash. With an opening CGST credit of 5,00,000 typed in GST settings, carried from April, June's CGST in cash
is nil.

## TDS

| | |
|---|---:|
| Opening | 1,200 |
| Deducted (194C 2,000 + 2,000 + 2,000 + 3,000; 194J 6,000 + 3,000; 194A 2,000) | 20,000 |
| Paid (1,200 on 07-Apr; 10,000 on 07-Feb through the month-end account) | 11,200 |
| **Closing, the same as the TDS ledgers** | **10,000** |

## Findings: where the app disagrees, and why the hand figure is right

`run_fixture_books.js` and `run_gst134_ui.py` fail on the checks marked "FINDING" until the finding is fixed.

1. *Fixed on 02-Oct-2026.* **GST by month pooled the two registrations** (`src/js/07-mis.js`, `MIS.compliance`, and the GST
   line of `MIS.forecast`). Each registration is now worked out on its own (`MIS.gst3b`), so Delhi's credit is never set
   against Uttar Pradesh's tax. Jun-2025 now shows 5,400 to pay and Oct-2025 9,000.
2. *Fixed on 02-Oct-2026.* **March's TDS was expected on 7 April in the 13-week forecast** (`MIS.forecast`). It is now
   expected on 30 April. Week 1 out is 3,52,400.
3. *Fixed on 02-Oct-2026, by the owner's rule.* **Profit by cost centre counted a written-back expense differently from
   the profit and loss** (`MIS.costCentres`). The profit and loss, MIS, the cost centres and the accounts now all use one
   rule, `MIS.plRule`. A credit is set off in its head, and only a head that ends in credit sends the rest to Other income.
4. *A note, not a finding.* The customers' "usual days to pay" (`MIS.payDays`) also count an advance that a later
   invoice used up. Vellichor's advance to its invoice gave 35 days, and Orchid Lane's gave 19 days, as if they were times
   to pay. Week 1 does not change. It only moves when Orchid Lane's March bill is expected (08-Apr rather than later).
5. **The refunded processing fee is on the cash flow's "Loans" line** (`src/js/07-mis.js`, `MIS.flowHead`). The ledger
   opposite the bank is Loan Processing Fees, an expense ledger. The rule for loans is tested by the ledger's name
   (`/\bLOAN\b/`) before the rule for expenses. So the 25,000 is on "Loans", under financing, and "Expenses refunded or
   recovered" is 3,000 where by hand it is 28,000. The net change, 38,050, is the same. The proposed fix tests the name
   only for a ledger that is not income or expense:

   ```diff
   -    if (A.isLoan(l) || /\bLOAN\b/i.test(l) && !/INTEREST/i.test(l)) return ["fin", "Loans"];
   +    if (A.isLoan(l) || /\bLOAN\b/i.test(l) && !/INTEREST/i.test(l) && !A.isExpense(l) && !A.isIncome(l)) return ["fin", "Loans"];
   ```
6. *Fixed on 02-Oct-2026.* The ledger finder now asks once with no head and then lists the ledger as missing; `propose`
   tests reverse charge before "GST PAYABLE" (not for an electronic, interest or control ledger). The 3B figures did not move.
   **The GSTR-3B screen cannot be drawn for a month with reverse charge paid in cash** (`src/js/35-gst-filing.js`,
   `GSTF.journal`, and `src/js/05-tally-ledger-master.js`, `LedMaster.propose`). This affects Jan, Feb and Mar 2026 here.
   The screen shows "Maximum call stack size exceeded", which has two causes:
   - The set-off journal's ledger finder, `led(kind, head, side, rcm)`, calls itself as `led(kind, "", side, true)` when it
     finds no reverse-charge payable ledger. That call finds none either and calls itself again, without end.
   - None is found because "07 RCM CGST PAYABLE", "07 RCM SGST PAYABLE" and "07 RCM IGST PAYABLE" are read as GST set-off
     ledgers. `propose` tests `GST\s*PAYABLE` ("CGST PAYABLE") before `\bRCM\b`.

   No figure in the 3B working is wrong. `GSTR.threeB` gives the figures above, and only the screen fails. The proposed
   fix stops the recursion and reads an RCM payable as reverse charge:

   ```diff
   -      if (!e.length && rcm) return led(kind, "", side, true) || Object.entries(S.books.map || {})...
   +      if (!e.length && rcm) return (head ? led(kind, "", side, true) : null) || Object.entries(S.books.map || {})...
   ```
   ```diff
   -      if (/ELECTRONIC|CASH\s*LEDGER|CREDIT\s*LEDGER|CURRENT\s*GST\s*PAYABLE|GST\s*PAYABLE|SET\s*OFF/.test(up)) p.what = "gst_setoff";
   +      if (/\bRCM\b|REVERSE/.test(up) && !/ELECTRONIC|CASH\s*LEDGER|CREDIT\s*LEDGER|SET\s*OFF/.test(up)) p.what = "gst_rcm";
   +      else if (/ELECTRONIC|CASH\s*LEDGER|CREDIT\s*LEDGER|CURRENT\s*GST\s*PAYABLE|GST\s*PAYABLE|SET\s*OFF/.test(up)) p.what = "gst_setoff";
   ```

   The second change also moves these ledgers out of "GST set-off" in the ledger map. The tax paid to them is still "GST"
   on the cash flow (`MIS.gstPaidTo` counts an RCM output ledger).
