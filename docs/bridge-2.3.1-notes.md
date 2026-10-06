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

One change, by the owner's decision of 06-Oct-2026: "change the entry request so the bridge also asks Tally for the
ledger lines kept under the items of a sales or purchase invoice (item invoice mode). Conditions: one entry per request
as today, read only, inside the 2-second rule, nothing else added to the request."

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

What did not change:
- **One entry per request, as before.** The request asks for the entry the add-on named (by its MasterID, or a new
  entry by its type and number on its own date), nothing more.
- **Read only.** The request reads from Tally; it never writes.
- **Inside the 2-second rule.** A Tally slow to answer is left at 2 seconds, as before.
- **Nothing else added to the request.** Only the ledger lines under the items (ledger, amount, debit/credit). Not the
  items' quantities, rates, HSN or GST rates. The allow-list (`docs/tally-allowlist.md`) carries the owner's decision
  line for 2.3.1 and the two changed requests' new shapes; no other request changed.

## Which entries enter the books by themselves in 2.3.1 (for your staff)

**Enter by themselves**, within about a minute of saving in Tally:
- Receipts, Payments, Contras and Journals.
- Sales, Purchase, Credit Note and Debit Note, **with or without stock items** (new in 2.3.1: with stock items).
- Alterations of these, and Alt+2 copies (a new entry with its own GUID).
- Cancels and deletes, matched by Tally's own GUID, when this computer's Tally shows them.

**Item invoices held under 2.3.0 settle by themselves**: the bridge asks its own Tally again for its held lines (at most
every 10 minutes, up to 20 tries over 7 days), now with the items' lines, and the entry enters complete. Uploading that
day's Day Book also settles them.

**Still held, as before:**
- Lines written by another Windows user's Tally (each bridge sends only its own user's lines).
- A new entry Tally gave no id for, when its date is more than 3 days back.
- A cancel or delete this computer's Tally cannot confirm (asked again by itself when Tally is free).
- An entry whose lines still do not add up for another reason (FinCom's balance check holds it with the same words).

## Checks (the test sheet has the steps)

1. A sales invoice with two items and GST (CGST + SGST) enters the books complete and matches Tally's figures.
2. A purchase invoice with items enters complete and matches Tally.
3. A Credit Note with items enters complete and matches Tally.
4. An alteration of the sales invoice shows Tally's new figures.
5. Item invoices held under 2.3.0 settle by themselves.
6. A Receipt enters as with 2.3.0.

## Rollback

From the tray: right-click the FinCom icon > "Roll back to the previous version" > Yes. The bridge goes back to 2.3.0.
The app trusts 2.3.0 as before, so nothing else is needed. Under 2.3.0 item invoices are held again (uploading that
day's Day Book settles them).

## What we need from you if something fails

The check number, the time (IST), what FinCom shows (a picture is fine), a picture of the entry in Tally, and from the
tray: right-click the FinCom icon > Show log, the lines starting "Recorder:" that name the entry.
