# Tally data upload page (Books → From Tally), FinCom 2.4.0

The owner (08-Oct-2026): "change the data xml upload page.. it is too much crowded.. simplify it.. whatever is necessary
should remain.. extra fields should be removed".

The screenshots use the made-up client from `tests/uploadpage_setup.py`. It has the fixture books and masters, two Day Book
files with a month missing between them, opening balances, a tie-out with 3 ledgers that differ, a Day Book on its way to
FinCom's cloud, the server's job ("Day Book 2026-27: 143 of 365 days read"), and lines held on two days that only that
day's Day Book settles. FinCom's cloud is made up in the page, and the screenshots work offline. They are taken by
`tests/shots_uploadpage.py`: `before/` and `after/`, each with owner and staff at 1366 wide, owner at phone width (390),
and a new client with nothing yet.

## The page now

1. **One status line.** For example: "Books from Tally: FY 2025-26 · entries up to 31-Mar-2026 · 33 days need a Day Book".
   It adds "ledger masters not uploaded" or "opening balances not uploaded" only when they are missing. Update now
   appears only where it already worked (the bridge here, or the firm's Tally computer through the cloud).
2. **Upload Tally data.** There is one drop area, and it opens the same file box (`#tallyIn`) as the top bar's
   **Upload Tally data**. That button is the page's one Upload, in the same place as on every other upload page.
   - FinCom tells what the file is from its content: a Day Book (vouchers), ledger masters (groups and ledgers), or a
     trial balance.
   - A Day Book's dates come from the file itself.
   - A trial balance is the only file that is asked anything: its date, because Tally does not write the date in the
     file. The likely date is filled in, and the person chooses "Use as opening balances" or "Check the books against it".
   - The progress line shows the file on its way to FinCom's cloud ("Sending DayBook.xml to FinCom's cloud: 42%", with the
     MB on hover) and the server's job ("Day Book 2026-27: 143 of 365 days read").
   - The result is in plain words, for example: "Read 6 entries for 01-Jul-2025 to 31-Jul-2025; 31 days updated." or
     "Read the ledger masters: 67 ledgers (18 with PAN, 12 with GSTIN)".
3. **Days that need a Day Book.** This lists:
   - the days whose held lines only that day's Day Book settles. These come from the shared classifier `Rec.needKind`:
     `daybook`, and `dupid` with "check Tally for a double posting first";
   - the cloud's gap (`Rec.gapFor`), from that day to today;
   - the dates between the files brought in.

   Each row has its own **Upload**. It takes only those dates from the file. The upload part says so ("Only 07-Oct-2026 is
   taken from the next Day Book · Take the file's own dates"), and the limit is cleared once it has been used.
4. **How to export from Tally.** This is folded, with three steps.

The page also keeps, kept small:

- the tie-out result, in one line ("Tie-out: 3 ledgers differ from Tally's trial balance as on 31-Mar-2026"), which opens
  to list the ledgers;
- the warning when the books carry another PAN;
- **More**, which holds Restore, the two removals, and the bridge's own update settings when this computer has a bridge.

## Every field on the page before, and what happened to it

| # | Field or control (before) | What it did | Needed for the upload? | Decision |
|---|---|---|---|---|
| 1 | Top bar "Upload Day Book" (`booksPick`) | Opened the Day Book file box | Yes | **Kept** in the same place, renamed **Upload Tally data**. It now takes the masters and a trial balance too (`tallyPick`, `#tallyIn`) |
| 2 | Slim alert line above the tabs ("3 received, not yet entered … · Sync activity") | Showed the client's first alert | No: on this page, the days list says the same thing with its own Upload | **Hidden on this tab** while the days list shows those days (`book:` alerts only). The bell still has it, and every other page still shows it |
| 3 | "TDS and GST work is kept in this browser only…" (and the "firm's database is not set up" note) | Information note shown only on this tab | No | **Removed** from this tab. The read-only and "not saved" warnings stay |
| 4 | Upload progress bar ("Sending … 42% (41.0 of 96.0 MB). If the page is closed…") | Showed the TUS upload to Storage | Yes | **Kept** as the progress line in the upload part. The MB and the resume sentence are on hover |
| 5 | Server job line ("Day Book 2026-27: 143 of 365 days read") | Showed the server splitting the file into days | Yes | **Kept**, in the progress line |
| 6 | GST drift note (filed returns the books no longer match) | A GST note shown on every Books tab | No | **Removed** from this tab (the GST tabs still show it) |
| 7 | "Reading the books…" busy card | Showed a file being read | Yes | **Kept** as one line in the progress line |
| 8 | "Setting up <client>" card, with heading | Listed five setup steps | No | **Removed**. The status line says what is missing |
| 9 | Step 1 Day book: "from files, A to B; missing X to Y. The days after it come in with the update…" | Coverage and gaps | The gaps are needed | Coverage is in the status line. **Gaps are rows in Days that need a Day Book**. The sentence is removed |
| 10 | Step 2 Opening balances: "12 ledgers, as on …", "from FinCom's copy" plus the copy line, or the instruction | Opening balances status | Only whether they are missing | **Status line clause** "opening balances not uploaded" when missing. The rest is removed (no balance is shown on this page) |
| 11 | Step 3 Ledger masters: "67 ledgers (groups, PAN, GSTIN), date" | Masters status | Only whether they are missing | **Status line clause** "ledger masters not uploaded" when missing. The count is said in the result after an upload |
| 12 | Step 4 FinCom Bridge, without a bridge here: Tally pill and "Needed only on the computer with Tally…" | Repeated the Tally sign | No (the top bar's Tally sign and the Tally page say this) | **Removed** |
| 13 | Step 4 with a bridge here: status, "Daily update at" / "Nightly catch-up at" time, Update now, Switch them on, "let the bridge copy the year" | The local bridge's own update settings | Rare, but nowhere else in the app sets them | **Moved under More** ("FinCom Bridge on this computer"), only when this computer has a bridge. Update now is also in the status line where available |
| 14 | Step 5 Check: instruction, Ready, or Mismatch with the ledgers; "as on" date; "Choose Tally's trial balance XML"; "check again" | The tie-out against Tally's trial balance | Yes (the result) | **Kept as one tie-out line**. A trial balance goes through the one Upload, and its date is asked only then |
| 15 | "Or bring in files exported from Tally" heading and paragraph (Day Book menu path, part by part, the bridge's copy) | Explanation | No | **Removed**. The menu path is in How to export (3 steps) |
| 16 | "From" and "to" date boxes | Limited a Day Book to typed dates | No: the file says its own dates | **Removed**. The dates come from the file. The period guard is kept: a day's or a gap's Upload limits the file to those dates |
| 17 | "No dates: Upload Day Book (top right) brings in the whole file." | Explained the date boxes | No | **Removed** |
| 18 | Parts table (Part brought in, Entries, File, On, Bridge's copy, total) | Listed every file brought in | No (technical) | **Removed**. Gaps between parts are in the days list. A part still waiting for the cloud is said once in the progress line. `meta.parts` is still kept |
| 19 | Opening balances paragraph (Trial Balance, Alt+F5, the day before) | Explanation | No | **Removed** |
| 20 | "Balances as on" date box | The trial balance's date | Only for a trial balance | **Removed** from the page. It is asked only when a trial balance file is uploaded, with the same default (the day before the books start) |
| 21 | "Choose the trial balance XML" button | Opened the trial balance file box | No (duplicate picker) | **Removed**. The one Upload recognises a trial balance |
| 22 | "12 opening balances from the trial balance file … (as on …)" | Echo after the upload | No | **Removed**. The result line says it after an upload |
| 23 | "For the deductees' PAN … also export Display → List of Accounts as XML." | Explanation | No | **Moved** into How to export, step 1 |
| 24 | "Choose the ledger masters XML" button | Opened the masters file box | No (duplicate picker) | **Removed**. The one Upload recognises the masters |
| 25 | More (Restore, Remove what is here, Remove Tally data and all GST work) | Removals and undo | Yes (data safety) | **Kept** as is (`data-more="books"`) |
| 26 | "The books here are for <GSTIN>, not this client's PAN" | PAN safeguard | Yes | **Kept** |
| 27 | Entries (76) and "76 entries (1 cancelled not counted)" | Counter | No (technical) | **Removed** |
| 28 | Period (A to B) | Coverage | Partly | **Status line**: FY and "entries up to" |
| 29 | Registrations in the file | List of GSTINs | No (the PAN warning is the safeguard) | **Removed** |
| 30 | Read on | Date of the last read | No | **Removed** |
| 31 | Ledger masters "18 with PAN, 12 with GSTIN" | Counter | No | **Removed**. The result after a masters upload says it |
| 32 | "Nothing here yet." | Empty state | Yes | Status line: "Books from Tally: nothing yet · upload the Day Book XML exported from Tally" |

Every removal above is shown-only text or a duplicate picker. The data each one showed (`meta.parts`, `b.tb`, `ledInfo`,
`tbCheck`) is still kept with the books and used as before.

## Safeguards: all kept, three added

- **Kept:**
  - the Tally company check: a file from another company is refused, or asked about once (`companyGate`);
  - the PAN check: a day book of another PAN is refused (`notThisClient`);
  - "no entries in the file";
  - the trial balance's checks: another company's ledgers, or groups only;
  - re-uploaded dates replace their own days, so nothing is doubled;
  - the removals ask for the client's name and keep a copy for Restore;
  - the Storage upload's resume and retry.
- **Added** to the one Upload (`tallyFileKind`, src/js/23). Each refusal changes nothing:
  - an **empty file**;
  - a file **cut short**, which does not end with `</ENVELOPE>` as every Tally export does;
  - a file of **no known kind**.
- **Period guard made stronger** (`bringDayBookFile`). Dates asked for (a day's or a gap's Upload) are met with the file's
  own first and last entry, so a day the file does not cover is never emptied. Before, a file for the wrong period wiped
  every day asked for. A file with no entry inside those dates is refused: "there are no entries for 07-Oct-2026 in … (it
  has 01-Jul-2025 to 31-Jul-2025)".

## Permissions

These are the same as before. Owners and staff see the same page and controls; the page had no owner-only control.
Nothing new is asked of Tally: the page sends no request, and Update now is the existing `keepNow`.

## Tests

- `tests/run_uploadpage_simple.py` (new) covers:
  - the status line, and the extra fields being gone;
  - the one control from the top bar and the drop area;
  - the progress line;
  - a Day Book month and the Master XML detected and read, with the result in words;
  - a month uploaded again with nothing doubled;
  - the empty, cut-short and unknown files refused;
  - a trial balance asked only its date;
  - the days that need a Day Book, each with its Upload, the period guard, and a range;
  - phone width with no sideways scroll;
  - staff seeing the same controls as an owner;
  - a new client.
- Updated with the same intent:
  - `run_single_upload.py`: Upload Tally data and `#tallyIn`; a day's own Upload is not a second Upload of the page;
  - `run_parts_ui.py`: parts as files with their own dates; the trial balance date asked; the bridge's settings under More;
  - `run_recorder_gap.py`: the gap's dates are the limit line and a day row, instead of date boxes;
  - `run_multi_ui.py`: the trial balances and the wrong-company file go through the one Upload; the tie-out line;
  - `run_balances_copy.py`: From Tally shows no balance; the openings from the copy count as present.
