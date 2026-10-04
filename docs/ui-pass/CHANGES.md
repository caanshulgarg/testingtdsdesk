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
