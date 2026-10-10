# GST and TDS ledgers page (Books → Tally ledgers), FinCom 2.4.0

The owner (08-Oct-2026): "there should be simple page of tds & gst tally ledger import page.. it is currently in very bad
shape.. take it with 2.4".

Screenshots of the made-up client from `tests/ledpage_setup.py`. It uses the fixture books and masters, FinCom's cloud made up in the page, and works offline. Taken by `tests/shots_ledpage.py`:
`before/` and `after/`, each with owner and staff at 1366 wide, owner at phone width (390), and no bridge or cloud copy.

## What made the page confusing (before)

1. **Two lists of the same ledgers, one under the other.** The "GST and TDS ledger check" list has tick boxes, and the
   "confirm once" list has Confirm buttons. They can disagree. For example, *07 CGST INPUT* is "GST, reverse charge" in
   the check but "GST · CGST input" in the list below it.
2. **Four ways to confirm.** You can tick and use "Confirm the 19 ticked", use Confirm on a row, use "Confirm the 20
   shown", or use the shared Save. Save floats in the middle of the page between the two lists ("No changes · Save"), so it
   is not clear what it saves.
3. **Every row is an open form.** A row has four or five drop-downs (what, head, side, registration, rate). Changing is
   the default instead of checking.
4. **The evidence is technical text.** For example: "10 entries: 10 on purchases/expenses; usually debit (10 Dr / 0 Cr);
   tax about 9% of the value; party in another state 0, same state 6". The suggestion itself is cut off
   ("GST, reverse char…").
5. **One number shown five times.** "20 to confirm" appears on the tab, the check line, the tile, the sub-tab and the
   foot of the list.
6. **Six sub-tabs plus four tiles that repeat them.** The sub-tabs are To confirm, GST, TDS and TCS, Confirmed, Other
   ledgers and What FinCom posts to.
7. **Where the ledgers come from is unclear.** The page says "70 ledgers read from Tally on 05-Oct-2026" while the bridge's
   list in FinCom's cloud is 2 minutes old. "Read ledgers from Tally" is shown when Tally is not connected. The masters
   file is mentioned only as text that points to another tab.
8. **Unknown ledgers are a wall of sentences.** There is one long sentence for each entry, the same ledger name is
   repeated, and there is nothing to do.
9. **Problems are scattered or missing.** Renamed ledgers sit in a separate box or inside a row. "Used differently" sits
   in a third box. Ledgers changed after returns sit in a fourth. Nothing checks two parties with the same GSTIN, or a
   PAN that is not the one in the GSTIN.
10. **At phone width the lists show empty boxes.** No ledger name or answer can be read, and the sub-tabs wrap onto four
    lines.

Found along the way (not about layout): the ledger check's own state (`b.ledCheck`: the suggestions, the
"only confirmed ledgers count" switch and each ledger's confirmed use) was not in `BOOKS_KEYS`. It was lost when the
books were opened again. This is fixed (see below).

## The page now (after)

1. **One status line for each book.** For example: "Ledgers from Tally: 70 · last updated 2 min ago · 5 need you".
   - **Read again now** is shown only where it already existed: the bridge here (`ledRead`) or FinCom's cloud copy
     (`Ledgers.refresh`). Nothing new is asked of Tally.
   - When no bridge or cloud copy serves the client, the page shows one **Upload the ledger masters (XML)** button
     (`mastersPick`) and says how to export the file from Tally.
2. **Needs you** is the only yellow box. Each line has one sentence and one action:

   | What happened | The action |
   |---|---|
   | A ledger FinCom could not tell (or a TDS ledger without its section, or a GST ledger without its head or side) | Choose what it is |
   | A ledger renamed in Tally | Confirm (owners only; staff see the line) |
   | Entries name a ledger FinCom does not have yet (one line for each ledger) | Read the ledgers again, or Upload |
   | A ledger line with no GUID (`Rec.needKind` "masters", the shared classifier) | Open From Tally |
   | A confirmed ledger is now used differently | Keep as confirmed |
   | Ledgers were changed after returns were made from them | Open GST returns |
   | Two ledgers have the same GSTIN (new check) | Fine as it is |
   | A ledger's PAN is not the PAN in its GSTIN (new check) | Fine as it is |

3. **GST ledgers.** Each row shows the Tally ledger, what FinCom treats it as (for example "CGST input · 9%"), and
   Confirm or Change.
4. **TDS ledgers.** Each row shows the Tally ledger, the section, the nature of payment (Tally's own, else FinCom's rules),
   and Confirm or Change.
5. **One answer for each ledger.** The answer is the ledger master's, which is what the returns use. The check's
   suggestion is the answer only for a ledger the master has none for. Where the check reads a ledger differently, the
   row is tagged "check differs" and **Why** says what the check reads. The evidence and its source are under Why.
6. **Confirmed ledgers fold to a count.** The line "N ledgers confirmed — show" opens them, each with ✓ Confirmed (undo)
   and Change. There is a find box and a client picker.
7. **The rest is under More, not removed.** More holds Other ledgers (add one FinCom missed), What FinCom posts to, AI:
   TDS and credit, Check again, and "Confirm the check's N sure answers". That last one was "Confirm the ticked", which
   also switches on the check's "only confirmed ledgers count" rule.
8. **Phone.** The tables become plain stacked rows. They opt out of the generic cards, which showed empty boxes here.

Permissions are the same as before. Only an owner can confirm a rename. Staff can confirm and change ledgers.

## The owner's decisions of 08-Oct-2026

1. **Reverse charge.** The check called a ledger reverse charge when *any* of its entries had an RCM ledger on it. A
   regular input ledger also takes the credit of the reverse-charge purchases, so 07 CGST, SGST and IGST INPUT were
   flagged. Now a ledger is reverse charge in two cases:
   - its name says so (RCM, reverse charge);
   - by use, when 80% or more of its entries are reverse-charge entries, and its name does not say input or ITC.

   `tests/run_ledcheck_rcm.py` prints the before and after table for every fixture ledger.
2. **The check is kept with the books.** `ledCheck` is now in `BOOKS_KEYS` and syncs through the existing generic
   `client_book_items`, so there is no database change. Each suggestion is kept as `pending` and counts in no figure
   until the ledger is confirmed into the ledger master. Who confirmed and when are kept on the ledger (`okBy`, `okAt`)
   and shown on the row in IST. `tests/run_ledcheck_saved.py` checks these points:
   - every return figure is the same after a reload;
   - the comparison catches pending suggestions that start counting;
   - a second computer sees the same confirmations.
