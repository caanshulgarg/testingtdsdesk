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
- **The same entries per request, as before.** FinComVoucherByMaster asks up to 50 entries of one day per request (the
  entries the add-on named, by their MasterIDs), as before; FinComVoucherByNumber asks one entry (a new entry by its type
  and number on its own date). Nothing more.
- **Read only.** The request reads from Tally; it never writes.
- **Inside the 2-second rule.** A Tally slow to answer is left at 2 seconds, as before.
- **Nothing else added to the request.** Only the ledger lines under the items (ledger, amount, debit/credit). Not the
  items' quantities, rates, HSN or GST rates. The allow-list (`docs/tally-allowlist.md`) carries the owner's decision
  line for 2.3.1 and the two changed requests' new shapes, with the two trial forms that are byte for byte those
  requests (FinComFetchTestA and C); the other trial forms (B, D, E, F) are as in 2.3.0; no other request changed.

Two limits, in plain words:
- **A very large invoice** (over about 1 MB of details from Tally, roughly 1,000 items or more) is not sent with its
  body: it is held with plain words, and uploading that day's Day Book settles it.
- **No HSN or GST rate on the item lines from this path.** The ledger lines under the items carry the ledger, amount and
  debit/credit only. FinCom's reports read the Day Book upload for HSN and rates, so they are unaffected.

## Masters: ledgers kept current, and a new ledger fetched before its entry

The second change, by the owner's decision of 06-Oct-2026: "Masters, one change: When Tally's master counter moves, ask
only for ledgers created or altered since the last number. Keep name, group, GSTIN, PAN, state and opening balance
current. If an entry uses a ledger FinCom does not have, fetch the ledger first, then apply the entry." Approved: read
only, inside the 2-second rule, after postings, nothing else added, each bridge on its own Windows user's Tally only.

- **A ledger created or altered in Tally reaches FinCom within about 10 minutes.** Every 10 minutes the bridge reads
  Tally's master counter for each open company (as it already did). When the counter has moved since the last number it
  processed, it asks Tally only for the ledgers whose AlterID is above that number (FinComLedgerChanges: 200 AlterIDs a
  request, the ledger list's own fields and nothing else) and sends them to FinCom. FinCom adds a new ledger and keeps
  GSTIN, PAN, state and opening balance current. The number moves on only when FinCom has taken them; until then the
  next check asks again. A very large change of masters (more than 5,000 at once) is left to Update now or the nightly
  ledger list, and the log says so.
- **A new party used at once.** An entry naming a ledger FinCom does not have yet (for example a party created inside
  the invoice screen with Alt+C) is held a moment with the words "waiting for the ledger '<name>' from Tally". The
  bridge asks its own Tally for that ledger by its name (FinComLedgerByName, one request a ledger), sends it, and then
  asks Tally for the entry again: the ledger is in first, then the entry, within about two beats. FinCom's balance check
  still applies to the entry.
- **Read only, inside the 2-second rule, never during a posting, each bridge on its own Windows user's Tally only.** A
  Tally slow to answer is left at 2 seconds and the ledger changes stop for that company until you switch where the
  changes come from, as for the entries.
- **Not in 2.3.1 (planned for 2.3.2):** ledger renames, ledgers moved to another group, new and altered groups, deleted
  ledgers and groups, PAN worked out from the GSTIN. A ledger renamed or moved in Tally keeps FinCom's name and group;
  the bridge's log names it ("left for 2.3.2"). Update now and the nightly ledger list handle them as before.

This needs the FinCom cloud update (tally-ingest) that goes out with 2.3.1; no database change.

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
as 'replaced'). This needs the FinCom cloud update (tally-ingest) that goes out with 2.3.1; no database change. Uploading
that day's Day Book also settles them.

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
7. A ledger's GSTIN changed in Tally shows in FinCom within about 10 minutes.
8. A sales invoice to a party created at once (Alt+C in the invoice) enters the books, with the party, within a few minutes.

## Rollback

From the tray: right-click the FinCom icon > "Roll back to the previous version" > Yes. The bridge goes back to 2.3.0.
The app trusts 2.3.0 as before, so nothing else is needed. Under 2.3.0 item invoices are held again (uploading that
day's Day Book settles them).

## What we need from you if something fails

The check number, the time (IST), what FinCom shows (a picture is fine), a picture of the entry in Tally, and from the
tray: right-click the FinCom icon > Show log, the lines starting "Recorder:" that name the entry.
