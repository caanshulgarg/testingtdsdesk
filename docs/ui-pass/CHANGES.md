# UI pass of 04-Oct-2026 — what changed

Screenshots at 1366 × 768, the same states before and after (made-up client "Testing AAD", offline):
`docs/ui-pass/before/<page>.png` and `docs/ui-pass/after/<page>.png`, taken by `tests/shots_ui_pass.py`.
The Post to Tally page's own content belongs to the other change running alongside this one and was not touched (only its top bar).

## Colours of meaning (for every page, the Post page too)

Defined once in `src/css/app.css` (`:root`, with dark-mode values through the existing tokens):

| Meaning | Token | Soft background |
|---|---|---|
| done (green) | `--st-done` | `--st-done-soft` |
| needs attention (amber) | `--st-attention` | `--st-attention-soft` |
| failed (red) | `--st-failed` | `--st-failed-soft` |
| waiting (grey) | `--st-waiting` | `--st-waiting-soft` |

## Every page (the top bar and the frame)

- One Tally sign: a green dot "Tally connected" or a red dot "Tally disconnected", nothing else. Connected means FinCom Bridge on one of the firm's computers is online (its heartbeat is recent) and Tally is open there with this client's company. On the firm's own pages there is no client, so any open company counts.
- Hovering over the sign shows, in plain words, which computer, which company, the last contact (04-Oct-2026 14:05 IST) and, when disconnected, the reason and the fix. Clicking opens the Tally panel with the same details at the top. Esc now closes that panel instead of leaving the client.
- The five reasons for "disconnected": FinCom Bridge not running, Tally closed, no company open, a different company open, or no internet on that computer.
- "☁ Saved 21:58 · live" is gone. While saving the top bar shows "Saving…". On a failure it shows "Not saved: <reason in plain words>" in red; clicking it opens Settings. When everything is saved it shows nothing.
- "6 to check in Tally" now reads "6 entries need review". It links to Post to Tally → Errors and is hidden at zero. The count is the one the Errors tab itself uses (`postTabCounts(cid).errors`, src/js/59), so the Post page needs no change.
- "+ Upload" is gone. Pages that upload have one Upload button, always at the far right of the top bar.
- The page's one main action (Refresh books, New confirmation, Upload …) is at the far right of the top bar.
- The build stamp ("Build 04-Oct-2026 22:07 · 675d598") left the sidebar. It now appears only in a small About line at the foot of Settings. The firm line no longer carries the version text.
- Page titles now match the sidebar: Purchase (was "Purchase bills"), Sales (was "Sales invoices"), Letters (was "Confirmations and reminders").
- Every disabled button now gives its reason in two places: on hover (its title) and in small grey words beside it. `app/src/parts/WhyNotes.jsx` adds these words for any disabled button that has a title, unless the reason is already written next to it. Reasons were added to: Save (settings sections), Check the year in Tally, Approve all that are ready, Print or PDF the letters, Previous/Next (Accounts), Show (Look up) and Confirm (bank ledger).
- Messages now use plain words. `plainError()` / `plainMessage()` (src/js/01) map the common raw messages to what happened, why and what to do:
  - network failures
  - an expired sign-in
  - duplicate key
  - row-level security / permission
  - foreign key and not-null errors
  - PGRST / missing column
  - timeouts
  - server errors (5xx)
  - storage quota
  - FinCom Bridge errors
  - Tally's "Could not find Ledger X" (names the ledger)
  - Tally's "totals do not match"
  - company not open
  - LINEERROR
  - program errors (TypeError and similar)

  A message that is not mapped but looks raw gets a plain sentence, with the raw words behind "details". This applies to toasts, a part of a page that fails to draw (it used to print the raw error), the save state, and the error lines on Tally, Sign in, People, From Tally, Tie-out, Server reports, Accounts, the bill drawer, In Tally, Bank ("file was not read"), Sync activity and the Tally alerts.
- Amounts: `money0` and `moneyShort` under one lakh now give two decimals (₹1,25,000.00), so every amount on screen has two decimals. Report tiles and chart tooltips also have two decimals now (they were whole rupees).
- Tally narrations are shown without FinCom's matching mark (" | TDSDesk:<id>") in Look up, MIS, Audit. The mark stays in Tally.

## Per page

- **Purchase · To review:** Upload bills at the top right is a plain button, because Approve is this page's one primary. Columns are now Date, Bill no., Supplier, Value (number before party). A foot row gives the count and the totals. "Tally refused: …" is in plain words. Delete moved away from Approve. The disabled buttons say why.
- **Purchase · upload:** the "Upload purchase bills" heading and the "Upload for Testing AAD" heading are gone. The drop area reads "Drop Testing AAD's bills here … or use Upload bills at the top right".
- **Purchase · In Tally / Post to Tally:** only the top bar changed: one Upload bills, the review link, the Tally sign.
- **Bank:** one Upload statement (top right). The empty state's "Choose files" button is gone; it now reads "No bank statement yet" and points to the button. Import ledger list is no longer a second primary.
- **Sales:** one Upload invoices (top right). The "Upload invoices" button in the page header is gone, and so is the "Sales" heading that repeated the page title. The empty state's "Choose files" button is gone. Create invoice is a plain button, so there is one primary. A foot row gives the count and the totals.
- **Day Book (TDS & GST → From Tally):** "Upload Day Book" at the top right replaces "Choose the day book XML". The From/To dates next to it still limit the upload, and the page says so.
- **Dashboard, Inbox, Transactions, TDS & GST, MIS, Accounts, Audit:** "+ Upload" is gone and the top bar is new. On Accounts, Previous/Next say why when disabled.
- **Reports:** the "Reports" heading that repeated the title is gone. "Run the audit" is no longer a second primary. Figures have two decimals.
- **Look up:** the second "Look up" heading is renamed "Ask the books". Show is no longer a second primary.
- **Letters:** the title is "Letters". New confirmation is a plain button, so Print or PDF is the page's one primary; when disabled it says "Tick at least one party in the list first".
- **Tally (firm):** the "Tally" heading that repeated the title is gone. The second "Connect" (inside the step text) is a plain button. The Tally panel no longer crashes the whole top bar when the bridge on this computer answers but the client's company is not open (an existing bug, found by the new test).
- **Settings:** the section heading and the card heading both said "Firm details"; the card is now "Name, address and logo". Save is a primary only when there is something to save. There is a new About line at the foot.
- **Client setup:** Save says why it is disabled ("No changes" was already beside it and is now marked as the reason).
- **TDS return:** "E-mail" is now "Email", the spelling used everywhere else.

## Duplicate buttons and headings removed (spec I)

1. Top bar "+ Upload". It was on every client page, next to the page's own Upload.
2. Sales: "Upload invoices" in the page header (the second upload).
3. Sales: "Choose files" in the empty state (the third upload).
4. Bank: "Choose files" in the empty state.
5. Day Book: "Choose the day book XML" (it is the top bar's Upload Day Book now).
6. Purchase upload: the heading "Upload purchase bills" and the drop area's heading "Upload for <client>".
7. Bank upload (collect step): the heading "Upload a bank statement" is now "Bank statement", and the drop area no longer says "click to choose".
8. Sales: the "Sales" heading under the "Sales" title.
9. Reports: the "Reports" heading under the "Reports" title.
10. Tally: the "Tally" heading under the "Tally" title.
11. Look up: the "Look up" heading under the "Look up" title (now "Ask the books").
12. Settings → Firm details: the repeated "Firm details" card heading.
13. Extra primary buttons: the second "Connect" on Tally, "Run the audit" on Reports, "Show" on Look up, "Import ledger list" on Bank, "Create invoice" on Sales, "New confirmation" on Letters, and the disabled "Save".

## Left as it is, on purpose

- **Clients (firm home), "Upload invoices for any client" and "Choose day book files":** these are not a client's upload page. Each does something different (bills filed by GSTIN, day books for many clients at once), so each was kept once.
- **"Upload the Day Book for these days" in the red gap line:** this is the fix inside an alert. It opens the Day Book with the dates filled in, so it is not a second upload button on the page.
- **Why a computer went silent:** when a Tally computer's heartbeats stop, FinCom cannot tell from far away whether the bridge was closed or the internet went down. The sign says "not running or cannot reach FinCom", with both fixes. It names the exact cause when this computer is the Tally computer: "FinCom Bridge is not running on this computer", or "has no internet" (the bridge here answers, but its heartbeats to FinCom fail: `Bridge.st.beat.missedSince`).
- **Tables (K6), not finished:** done for the Purchase review list and the Sales list (column order, count and totals at the foot). Not done for the other lists:
  - Long tables already keep their header in view (the `gf-scroll` box of src/js/31), and the column filters already sort.
  - The remaining tables (In Tally's log, TDS return tabs, Parties, Settings tables) keep their column order. They have no single "status" column, and their tests read their columns by position.
  - Empty states that say what to do next were written for Purchase, Bank and Sales only.
- **Loading (K7) and confirmations (K9):** not reworked. "Loading…" / "Opening <client>…" were already shown for the page and the client, and the existing confirmations already name what will change. No page was found blank while loading in the screenshots.
- **Times in IST:** the Tally sign and the Post page's marks give IST explicitly. The general `fmtTime` / `fmtDateTime` still show this computer's clock, which is IST on the firm's computers. Changing them would change many existing tests, and the bridge side's guard does not cover them, but they are left for one careful change of their own.
- **One font:** the app already uses IBM Plex Sans throughout. The serif is used only for the brand name in the sidebar.
- **Post to Tally page content:** belongs to the other helper. Its top bar follows this pass.

## Tests

- `tests/run_tally_sign.py`: the two states, the green and red dots, the hover and click detail with the IST time, each of the five disconnected reasons with its fix, Esc on the panel, saving / not saved / nothing, and the review link (count, wording, opens Errors, hidden at zero).
- `tests/run_single_upload.py`: Purchase (three tabs), Bank, Sales and Day Book each have exactly one upload button, in the top bar, at the same spot. None on Dashboard, Transactions, Reports, Letters, TDS & GST, Inbox or Clients. Each button opens the right file box.
- `tests/run_ui_standards.py`: on all 27 pages it checks for:
  - no TDSDesk, React, ids or build stamps on screen;
  - no 1,250,000-style grouping;
  - no ISO, slash or "4 Oct 2026" dates;
  - no sideways scroll at 1366 × 768;
  - every disabled button says why, beside it and on hover;
  - one primary button per page;
  - table amounts like 1,25,000.00, right-aligned;
  - the four colour tokens;
  - plain words for the common raw errors, including a toast with "details";
  - the About line.
- `tests/shots_ui_pass.py OUTDIR`: the screenshots.
- Existing tests updated where the owner's spec changes what they checked:
  - `run_live_sync.py`: nothing shown once saved.
  - `run_phase2.py`: no "+ Upload"; the build date is in the About line.
  - `run_ui_review_0110b.py` and `run_review_0210.py`: the sidebar shows today only.
  - `run_react_frame.py`: the title is "Purchase".
  - `run_react_bank.py`, `run_react_collect.py`, `run_react_sales.py`: the new empty-state words.
  - `run_react_settings.py`: the page title is in the top bar.
  - `run_gst_api_ui.py`: its Connect click now looks only inside the page. The old loose match also hit the top bar's "Tally connected".

# Round 2 (04-Oct-2026): tables, loading, confirmations, times in IST

The owner's items K5, K6, K7 and K9, and the empty states, finished on every page except the Post to Tally page (the
other change running alongside owns it: `app/src/screens/Post.jsx`, `src/js/59-post-preview.js`, `src/js/62-post-reasons.js`
were not touched). After screenshots retaken in `docs/ui-pass/after/`.

## The shared parts

- **One list table**, `app/src/parts/ListTable.jsx`. A list hands over its columns and rows; each column says what it is
  (`role`: date, number, party, amount, status; a tick box first, buttons last, the rest after status). The part puts
  them in that one order, so a page cannot order them differently. On every list:
  - a click on a header sorts by it (up ▲, again down ▼; `aria-sort` on the header; blanks stay last);
  - the header stays in view while the rows scroll (the box scrolls, the header is sticky; the foot sticks to the bottom);
  - the foot gives the count ("3 bills", "3 of 10 bills" when filtered) and the totals of the amount columns;
  - an empty list says what to do next (the caller's words);
  - while the rows load: the header's place shows "Loading …" over grey bars.
  `ListRows` (same file) does the same for tables whose rows were already drawn as `<tr><td>` (the analysis pages):
  it reorders the cells by the heading's roles and sorts by what each cell says.
- **Loading**, `app/src/parts/Loading.jsx`: "Loading <what>…" over grey bars (`data-loading`), used wherever a page
  waited with a blank area or a bare "Opening…".
- **Times**, `fmtTime` / `fmtDateTime` (src/js/01) now give Indian time whatever the computer's clock:
  "04-Oct-2026 14:05 IST" and "14:05 IST" (IST = UTC + 5:30; India has no summer time). Text with a time and no zone
  (the e-invoice portal's "2026-10-04 14:05:00") is taken as Indian time; a date alone shows no time. New helpers
  `istParts` and `istDay` (src/js/01). The Tally sign's own formatter (`tallyIst`, src/js/49) now uses the shared one.
  `fmtDate`, `toDateObj` and the other functions hashed by `tests/fixtures/post-shapes/MANIFEST.json` are unchanged
  (`node tests/gen_post_shapes.js` leaves the fixtures as they were).
- Colours: the status tags and the skeleton use `--st-done`, `--st-attention`, `--st-failed`, `--st-waiting` (+ `-soft`).

## Per page (one line per change)

- **Clients:** the list is on the shared table: Client, Tally (the status), then GSTIN and the counts; the foot counts the clients and adds up the counts and the TDS. An empty search says to clear it or Add client.
- **Today:** on the shared table; the foot adds up To read, To review, To post, Need a look; no clients says "Use Add your first client".
- **Inbox (firm):** the unsorted uploads: Bill date, File, Supplier, Total, then Billed to, Why, Move to; Delete now asks first, naming the file (it cannot be undone). The inbox files (Docq): Received, File, From, Status.
- **Purchase · To review:** on the shared table; a Status column (Ready to approve / Needs a check) after Value; no bill matching the filter offers "Clear the filters".
- **Purchase · other tabs (Post to Tally excepted):** each empty tab says what to do next (Upload bills, Approve under To review, Restore, No entry needed).
- **Purchase · In Tally:** everything sent to Tally: When, Reference, Party, Amount, Status (Sent / Confirmed in Tally / Taken back), then What, Client, Voucher, By; "Loading the postings…" while the cloud is read; the times in IST.
- **Bank:** the statement: Date, Particulars, Withdrawal, Deposit, a new Status column (No ledger / Suggested / Ready to post / In Tally / Ignored), then Ledger; the foot totals withdrawals and deposits over every line, also those not drawn yet. Group by party: Party, Withdrawals, Deposits, Entries. "Loading bank statements…" while they open. "Set all" no longer asks (Undo in the bar).
- **Sales:** Date, Invoice, Customer, Total, a new Status column, then Taxable, GST, Customer ledger; the foot totals Total, Taxable and GST; the empty tabs say what to do next; "Loading sales invoices…"; Delete (one or the ticked ones) no longer asks (Undo in the bar).
- **Transactions:** S. no., Date, Invoice no., Party, Invoice value, In Tally, then Voucher, Taxable, GST, Document (Voucher moved after the five); the foot totals; "Loading bank lines…" / "Loading sales invoices…" while the other kinds open (it showed an empty list before); the empty register says where to upload.
- **TDS & GST → TDS return (26Q, 24Q, certificates):** Challans (Deposited, BSR code, Serial, Tax, Use, then the rest; the new-challan row follows the same order), Deductees, Deductions (Date, Voucher, Deductee, Paid, TDS, Challan, then PAN, Section, Rate), Employees, the 24Q challans, the salary TDS in the books, rate questions, late payments and the 197 certificates are on the shared table; the totals rows moved to the foot; the return keeps its own sort (S.tdsSort) with the same headers and arrows.
- **TDS & GST → GST:** 2B by supplier, pairs, in 2B only, in Tally only; the input register (Booked, Bill no., Supplier, Value, 2B, then HSN and the taxes; the count moved to the foot); in 2B not in the books; ITC follow-up (Bill date, Bill no., Supplier, Tax, What, then the rest) and the suppliers to write to; customers' IMS rejections; returns filed (to sort, removed, every PDF); Filed vs books (all seven lists); rule 37; GSTR-1A; the GSTR-1 workings' lists (filed copies, books against filed, to report, advances still open, left out); GST contacts; GST API for all clients ("Loading each client’s portal connection…").
- **From Tally (Day Book):** the parts brought in: On, Part, Entries, File, Bridge’s copy.
- **Look up:** a search's entries (Date, No., Party or ledger, Amount, Type; Optional entries left out of the total) and the outstanding bills are lists; a ledger, a group, a trial balance and months stay statements (their running order matters). "Loading the books…" while the books open.
- **Audit:** the entries behind a finding, the ones put right, the solved observations, the earlier runs (their time now in IST; it showed the raw UTC hour) and the related parties are lists; suggested journal entries stay a statement.
- **MIS:** a ledger's entries and the MSME suppliers are lists; the profit and loss, ages, months and the other schedules stay statements.
- **Accounts, Reports, the GST returns (GSTR-1, 3B, 9, 9C, CMP-08), the bank and vendor reconciliations, a bill's own lines:** statements, marked `data-statement` (their rows follow the form or the statement, not a sort).
- **Letters:** confirmations (Sent, Party, Balance, Reply, then Email, Phone) and reminders (Last reminder, Customer, Overdue, then Oldest, Email, Phone); the foot totals the balances (Dr/Cr) and the overdue; no party says which choice to change.
- **Client setup → Suppliers:** suppliers not yet saved (Supplier, Total, then PAN, Payment type, Bills waiting) and the saved ones (Supplier, Credited, then PAN, Usual payment type, TDS base); no supplier says "use Add supplier".
- **Ledgers (books):** the ledger master list (Tally ledger, Confirmed, then the rest), the ledgers changed after returns, the ledger check (Ledger, Confidence).
- **Tally (firm):** every bridge heard from (Last seen, Computer, Mode, then the rest), computers that send, Tally companies and clients, the connection history, the sync activity (Saved in Tally, Entry, PC, State, then the rest; "Loading the lines from Tally…"); their times in IST (they showed this computer's clock).
- **Settings:** people (Name, Role, then Email), the wallet (When, Amount, then the rest), drop keys, backups, and the platform's firms (administrator) are on the shared table.
- **Help:** tickets (Updated, ID, Status, then Subject, Module, Priority, SLA) and the desk's oldest open; "Loading tickets…" and "Loading the ticket…".
- **AI help:** TDS ledgers without a section, the ledgers AI looked at, and what AI did (When, Who, What).
- **Day books for several clients:** the files (File, Company, Status, Client) and "Bringing in 2 of 5: <file>…" with a progress bar while it runs.
- **Bank → Ask Claude:** "Asking Claude about rows 51 to 100 of 150…" while it runs (it said only the total).
- **Opening a client, the firm's settings, the bill's document, the bank details panel:** "Loading …" over grey bars instead of a bare line.

## Confirmations (K9)

Only what cannot be undone is asked first, and the question names what will change.

**Removed (they can be undone; what was done is said, with Undo or the way back):**
1. Bank: "Use <ledger> for N entries?" (Set all after a search): done at once, Undo in the bar.
2. Sales: "Delete invoice <no.>?": done at once, Undo in the bar.
3. Sales: "Delete N invoices?" (the ticked ones): done at once, Undo in the bar.
4. GST settings: "Remove <GSTIN>?" (an added GSTIN): done at once; adding it again brings its settings, 2B and returns back (said in the toast).
5. Settings: "Sign out of the firm account?": done at once; this computer keeps everything and shares it at the next sign-in (said in the toast).
6. Bank account's Tally ledger: "Change the Tally ledger of this bank account?": Change opens the chooser at once; nothing changes until the new ledger is confirmed, and Cancel keeps the old one.

**Added (it cannot be undone):**
7. Inbox, an unsorted upload: "Delete <file>?" — the file and what was read are removed for good.

**Kept, and now naming what changes:**
8. Purchase review, Delete for the ticked bills: "Delete N bills for good?" lists the bills and says they and their documents are removed and it cannot be undone (it said only "The files can be uploaded again").
9. TDS 24Q: "Remove the salary sheet?" says how many employees' sheet goes and that it cannot be undone.

**Kept (cannot be undone; each already names what changes):** replace or delete entries in Tally (bank reconciliation); remove wrong-date or extra copies from Tally; remove an entry from Tally; set automatic voucher numbering in Tally; create a ledger in Tally; post into a closed period; try a bridge version on a computer, approve it for all, make a bridge the main one, clear a book's baseline, remove a computer; posting to any company from a computer (its installer's list goes); sign out of all devices; reset a person's two-step sign-in; switch a drop key off; clear out old documents; delete all bank statements; forget the learnt history; forget all saved rules; delete a rule; forget the customer memory; delete all sales invoices; cancel an IRN; remove a GST notice; make the copy of the books now (Tally is busy for minutes).

**Kept, not a yes/no question (they ask for something that is kept):** a new or changed bank rule, copy rules to other clients, apply a GST setting to which GSTINs, which Tally company a client is, take an entry back out of Tally, add credit, make a drop key, connect to FinCom Bridge, clear a client's GSTIN or PAN (reason required), stop reading Tally (reason shown to the bridge), withdraw a bridge version (reason), lock or unlock a month (note), clear all decisions on a statement and sign out of FinCom (each has an option), delete one bill (reason required, review item 24). And the notices that only inform (Close): another Tally company's file, a day book or trial balance not this client's, GSTR-1 already filed, the bridge needs updating, keyboard shortcuts.

**Kept for the owner to decide (FinCom can undo them, but earlier owner rules ask for them):** the removals that need the client's name typed and keep a reason (review of 01-Oct-2026 and request of 02-Oct-2026: remove a client, delete a statement, remove the books read from Tally, remove Tally data and all GST work, delete a bill posted to Tally, clear sent invoices older than 90 days), remove a PDF from Returns filed (keeps who, when and why), and "Post <client>'s entries into <company>?" (review of 02-Oct-2026: "changed by an owner, asked first"). Each of these can be put back (Restore, Trash, or choosing again), so under K9 they would go; they were left because they are explicit earlier decisions.

## Left as it is, on purpose (round 2)

- The purchase bills' queue beside an open bill (To review one at a time, Approved, Duplicates, Deleted) is a picker, not a table; it keeps its order (newest or by date) and its empty states now say what to do next.
- The bank rules list keeps its order: rules are read from the top down and the first that fits wins, so sorting it would mislead.
- Ledger accounts, group summaries, trial balances, the monthly and MIS schedules, the profit and loss, the returns' tables and the reconciliations are statements (`data-statement`): their order is the statement's.
- Tables printed or exported (the letters, invoices, the audit report, Excel) are not screen lists.

## Tests (round 2)

- `tests/run_ui_standards.py` now also checks, on every page of `shots_ui_pass.py` and on lists filled for the test (sales, a bank statement, the post log, unsorted uploads, the sales register, deleted bills; with tests/data also the TDS return and GST lists):
  - every table is the shared list table or marked a statement;
  - column order (date, number, party, amount, status, then the rest), the header sticky, the sortable headers;
  - a header click sorts up then down, with the arrow and `aria-sort`, and the rows in order;
  - a count and the totals at the foot; an empty list says what to do next;
  - no time without IST on any page; `fmtDateTime` / `fmtTime` on a computer set to New York time give IST; In Tally shows the post times in IST;
  - with a request held open, "Loading…" and a skeleton (never a blank area) while: a client opens, sales, bank, the Transactions' bank and sales, the books (reports, look up, GST), the In Tally postings, the help tickets.
- Existing tests updated where the owner's spec changed what they checked (intent kept): `run_react_tds.py` (the totals in the foot, the TDS column found by its heading, ▼), `run_react_gst.py` (the register's count in the foot, the "What" column by its heading), `run_react_txn_dash.py` (the empty bank register's words), `run_phase2.py` (a time with IST), `run_react_bank.py` (Set all needs no question; Undo), `run_gstregs_ui.py` (removing a GSTIN needs no question), `run_confirm_choices.py` (Change opens the chooser), `run_react_collect.py` (deleting an unsorted upload asks first, naming it).

### One primary in every state of the books (CI on ad53eb7)

- With FinCom's copy of the books empty, Reports showed "Refresh books" (top bar) and Look up showed "Look up" as primaries beside the page's "Read the books from Tally". Now, while the copy needs reading, "Read the books from Tally" is the page's one primary and Refresh books / Look up are plain buttons; once the books are read they are the primary again.
- `tests/run_ui_standards.py` checks every books page (Reports, Look up, Letters, MIS, Accounts, Audit, TDS, TDS & GST, Day Book) twice, with the copy read (tests/data, else the made-up books) and with it empty: one primary at most, and when the prompt to read the books shows, it is that one. So it cannot pass by which books happen to be there.
