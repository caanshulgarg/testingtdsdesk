# FinCom Bridge 2.3.1: release notes

For the owner. Plain words; times are IST. The steps to try it on NWS144 are in `docs/bridge-2.3.1-test-sheet.txt`.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.3.1.exe |
| Fingerprint | SHA-256 `<SHA-256>` (filled in when the setup is built; compare with the .sha256 file next to the setup) |
| FinCom app update | none: the app of 2.3.0 works with 2.3.1 |
| Replaces | 2.3.0 (kept on the computer, so the tray can roll back to it) |
| Add-on | unchanged: keep `C:\ProgramData\FinCom\addon\FinComRecorder.tdl` loaded as it is |

## What 2.3.1 changes: item invoices enter the books complete

One change, by the owner's decisions of 06-Oct-2026. First: "change the entry request so the bridge also asks Tally for
the ledger lines kept under the items of a sales or purchase invoice (item invoice mode). Conditions: one entry per
request as today, read only, inside the 2-second rule, nothing else added to the request." Then (part A, the same day):
"Voucher request, one change: Item invoices enter complete: sales, purchase, credit notes and debit notes with stock
items, including the ledger lines Tally keeps under the items. Item lines: item name, quantity, unit, rate, taxable
value, HSN or SAC, GST rate, and CGST, SGST, IGST and cess per line. Take the HSN and rate Tally applied to that invoice
line, not from masters. Bill-wise details on party lines: bill name, type, due date or credit period, amount. TDS details
where present: section, nature of payment, rate, amount, deductee type. Cost centre and cost category allocations. Bank
details on bank lines: instrument number or UTR, instrument date, bank date, transaction type. Narration, reference
number and date, e-invoice IRN and acknowledgement number, e-way bill number." and "One entry per request: strictly one,
asked for by Tally's own id."

A Sales, Purchase, Credit Note or Debit Note entered **with stock items** (item invoice mode) keeps its sales or
purchase ledger **under the items**, not among the entry's own ledger lines. Only the party and the taxes (CGST, SGST or
IGST) are the entry's own lines. 2.3.0 asked Tally for the entry's own lines only, so such an entry arrived without its
sales or purchase ledger; its lines did not add up, and FinCom held it with the words "the entry's details from Tally
are incomplete (its lines do not add up: an item invoice's sales or purchase ledger may not have come): upload this
day's Day Book to settle it".

2.3.1 also asks Tally for the ledger lines kept under the items (each line's ledger, amount and debit/credit). So an
item invoice now arrives with every line, for example a sales invoice with two items and GST:

| Line | Amount (Rs) |
|---|---|
| The party (debit) | 4,130.00 |
| Sales GST 18% (credit, item 1: 2 x 1,000) | 2,000.00 |
| Sales GST 18% (credit, item 2: 3 x 500) | 1,500.00 |
| CGST 9% (credit) | 315.00 |
| SGST 9% (credit) | 315.00 |

The lines add up, and the entry enters the books by itself, as Tally shows it.

The same for a purchase invoice with items (the supplier, the purchase ledger under the items, CGST and SGST input) and
for a Credit Note or Debit Note with items.

**The whole entry comes with it (part A).** For every entry the bridge now asks Tally for, besides the lines:
- the items: name, quantity and unit, rate, taxable value, and the HSN or SAC and GST rate **Tally applied to that
  invoice line** (not from the item's master); CGST, SGST, IGST and cess per item line (see the limits below);
- bill-wise details on the party line: bill name, type, due date or credit period, amount;
- TDS details where present: nature of payment, rate, assessable value, tax, the deductee;
- cost centre and cost category allocations, on the entry's ledger lines and on the ledger lines under the items;
- bank details on bank lines: transaction type, instrument number or UTR, instrument date, bank date;
- the narration, reference number and date, the party GSTIN, place of supply and company GSTIN, the e-invoice IRN and
  acknowledgement number and date, and the e-way bill number.
These used to come only with a Day Book upload; a live entry no longer leaves them blank. FinCom reads them with the
same reader for the Day Book upload and the live entry, so both give the same result.

**FinCom's accuracy checks (the owner's rules).** An entry from the bridge enters only if its lines total zero, its
items' taxable value plus tax equal its ledger lines (within Rs 1 for Tally's rounding), and its bill-wise and cost
centre allocations add up to their line's amount. If any check fails, the line is held with plain words (for example
"the GST worked out on the items (Rs 410.00) does not match the GST ledger lines (Rs 420.00)") and **nothing of the
entry is applied**. A Day Book upload is never refused: such an entry comes in as Tally has it, marked for checking with
the same words.

**A delete or cancel of an entry FinCom never had** settles by itself: "nothing to remove: the entry is not in FinCom's
copy and no longer counts in Tally" (the line stays visible in Sync activity). A later Day Book cannot undo a delete; a
cancelled entry from a later Day Book comes in as cancelled.

**The company list asked in the background** (the bridge's own look at which companies are open, and the light check)
now stops at 2 seconds too, like the entry request. When you look yourself (Update now, the tray, the setup) it is not cut.

What did not change:
- **One entry per request.** Strictly one, by Tally's own id (FinComVoucherByMaster names exactly one MasterID) or by
  type and number (FinComVoucherByNumber, a new entry on its own date). Up to 2.3.0 FinComVoucherByMaster could ask up
  to 50 entries of one day in one request; from 2.3.1 every entry is its own request. When many entries are saved at
  once, those not asked within a turn's 20 seconds wait for the next turn, in order; none is sent without its details
  for want of time.
- **Read only.** The request reads from Tally; it never writes.
- **Inside the 2-second rule.** A Tally slow to answer is left at 2 seconds, as before.
- **After postings.** A posting goes first; the request gives way to it.
- **Each bridge on its own Windows user's Tally only.**
- **Nothing else added to the request** beyond the fields listed above, all stored fields (nothing Tally works out). The
  allow-list (`docs/tally-allowlist.md`) carries the owner's decision line for 2.3.1 and the two changed requests' new
  shapes, with the two trial forms that are byte for byte those requests (FinComFetchTestA and C); the other trial forms
  (B, D, E, F) are as in 2.3.0; no other request changed.

Limits, in plain words:
- **A very large invoice** (over about 1 MB of details from Tally, roughly 1,000 items or more) is not sent with its
  body: it is held with plain words, and uploading that day's Day Book settles it.
- **Tax per item line is worked out, not read.** TallyPrime 7.1 keeps no CGST, SGST, IGST or cess amount on an item
  line, only the line's GST rate. FinCom works each line's tax out from its taxable value and rate as Tally does (half
  each to CGST and SGST within the state, IGST otherwise) and checks the total against the entry's GST ledger lines.
- **TDS section and deductee type** are not kept on the entry in Tally; they belong to the ledger and party masters, so
  the entry's TDS details carry the nature of payment, rate, amounts and the deductee, and leave these two blank.
- **Tag names not yet seen from a real Tally.** The e-invoice (IRN, acknowledgement), e-way bill and TDS fields are asked
  by the names TallyPrime 7.1 uses as far as we know, but no real export in our test files carries them yet; the tests
  use typed copies. The NWS144 checks below confirm them.

## Which entries enter the books by themselves in 2.3.1 (for your staff)

**Enter by themselves**, within about a minute of saving in Tally:
- Receipts, Payments, Contras and Journals.
- Sales, Purchase, Credit Note and Debit Note, **with or without stock items** (new in 2.3.1: with stock items).
- Alterations of these, and Alt+2 copies (a new entry with its own GUID).
- Cancels and deletes, matched by Tally's own GUID, when this computer's Tally shows them.

**Item invoices held under 2.3.0 settle by themselves**: the bridge asks its own Tally again for its held lines (at most
every 10 minutes, up to 20 tries over 7 days), now with the items' lines, and the entry enters complete. That includes an
item invoice 2.3.0 had already asked Tally for again (its second answer, without the items' lines, held by FinCom's
balance check): FinCom lists it once more, 2.3.1 asks once more and sends it, and it enters once (both held lines show
as 'replaced'). This needs the FinCom cloud update (tally-ingest) that goes out with 2.3.1, and database migrations 56
and 57 (57 stores the items, cost centres, bank, TDS, e-invoice and e-way bill details). Uploading that day's Day Book
also settles them.

**Still held, as before:**
- Lines written by another Windows user's Tally (each bridge sends only its own user's lines).
- A new entry Tally gave no id for, when its date is more than 3 days back.
- A cancel or delete this computer's Tally cannot confirm (asked again by itself when Tally is free).
- An entry whose lines still do not add up for another reason (FinCom's balance check holds it with the same words).
- An entry that fails one of FinCom's accuracy checks (above), with the check's own words.

## Checks (the test sheet has the steps)

1. A sales invoice with two items and GST (CGST + SGST) enters the books complete and matches Tally's figures.
2. A purchase invoice with items enters complete and matches Tally.
3. A Credit Note with items enters complete and matches Tally.
4. An alteration of the sales invoice shows Tally's new figures.
5. Item invoices held under 2.3.0 settle by themselves.
6. A Receipt against a bill enters with its bill-wise details.
7. The sales invoice of check 1 shows its items with HSN, GST rate and tax per line, and its IRN and e-way bill number
   when Tally has them.
8. A bank payment with a UTR shows the UTR, instrument date and transaction type.
9. A payment with TDS shows its TDS details.
10. A journal with cost centres shows its cost centre allocations.

## Rollback

From the tray: right-click the FinCom icon > "Roll back to the previous version" > Yes. The bridge goes back to 2.3.0.
The app trusts 2.3.0 as before, so nothing else is needed. Under 2.3.0 item invoices are held again (uploading that
day's Day Book settles them).

## What we need from you if something fails

The check number, the time (IST), what FinCom shows (a picture is fine), a picture of the entry in Tally, and from the
tray: right-click the FinCom icon > Show log, the lines starting "Recorder:" that name the entry.
