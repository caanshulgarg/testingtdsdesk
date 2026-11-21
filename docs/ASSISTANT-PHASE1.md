# Daily Check (the Assistant), phase 1: plan (DESIGN ROUND)

Branch `next-assistant`, 21-Nov-2026. **Design only.** Nothing here is applied, deployed, published or merged. The
screens are built with made-up data (`app/src/screens/assistant/demo.js`, marked "Sample data" on the page). The
migration is a draft (`server/assistant-night/migration-206-assistant-night.DRAFT.sql`), not run anywhere.

## 1. What it does, in one paragraph

Every night, with no one's Tally or FinCom open, FinCom checks each client's books in the cloud copy and what it holds
(bank statements, the Inbox, GSTR-2B, the salary sheet). For each thing it finds, it **first tries to answer it itself**
from what it already has. If the answer is certain, it marks it "Resolved by FinCom", with the evidence. If it is not
certain, the owner decides ("Needs you"). Only what FinCom truly cannot answer becomes a plain question to the client.
The questions go into one weekly list per client. The owner ticks them, edits them and sends them with one press:
email from the server, or a WhatsApp link with the message ready. Where an answer is a ready entry (an Inbox bill
for a 2B gap, a bank line it worked out), FinCom prepares it and shows it on the same page. The owner approves it there,
and it goes to Tally through the **existing** posting path.

## 2. The screens (made-up data): "Daily Check"

The page is called **Daily Check** (the owner, 21-Nov-2026; "FinCom Assistant" stays the Ask FinCom chat). Second
design, after the owner's "too many words, too cluttered": about 70% less text, tabs instead of one long page, one line
a row, details only when a row is opened.

- Top: one line "Last night · 5 clients", then four tabs with counts: **From clients** (questions, the only thing ever
  sent) · **Needs you** · **Entries** · **Done by FinCom**. The page opens on the tab with the most to do (Done by FinCom
  is never the default). The page title is the top bar's only ("Daily Check"); no second title, no "Sample data" label.
- From clients: grouped by client, a "Send N" button per client. A row is amount · party · date · short ask, with a
  small status dot (grey Draft, blue Asked, amber Answered, green Closed; the word is the dot's tooltip). Opening a row
  shows the full question and its history ("Emailed to …").
- Needs you: a short title and the choice as buttons (two invoices side by side, Same / Not the same, Add contact).
- Entries: type · date · party · reason chip · amount, a small ✓ "Checks" chip (the checks in its tooltip), Approve and
  Reject as icon buttons, tick boxes with "Approve N" for the ticked only. Opening shows Dr/Cr, narration, evidence, Edit.
- Done by FinCom: rows with a green tick; opening shows the evidence and Undo.
- Send: the client's questions to tick and edit, the message exactly as it goes, Send email, WhatsApp; one short line
  "Test mode: emails go to your firm only".
- Phone: the same tabs on one line ("Done" short), rows stacked, no sideways scroll.

Screenshots: `scratchpad/shots-assistant2/` (deviceScaleFactor 2, desktop 1440 and phone 390; the test site's strip
hidden by CSS injected only for the screenshots): `1-from-clients`, `2-question-open`, `3-needs-you`, `4-entries`,
`5-entry-open`, `6-done-by-fincom`, `7-done-open`, `8-send`, `9-contacts` (each `-desktop` and `-phone`), and
`10-from-clients-dark-desktop`. The first design's shots are in `scratchpad/shots-assistant/`.

Where the code is: `app/src/screens/daily/` (DailyCheck, Review, ClientContacts, daily.css, demo.js), a lazy chunk
(Main.jsx, homeTab "daily"). The sidebar has "Daily Check" under Firm; its title is in TopBar.jsx. The contacts card is in
Client setup › Company (Settings.jsx, already a lazy chunk). The client's message is `server/_shared/asks.js`, one file
for the page's preview and the send function, so the words cannot differ.

Sizes (gzip): legacy.js **599,732** (unchanged), main index **260,613** (+243: the sidebar item, the title, the lazy
import); the Daily Check chunk about 6 kB. The address `#/daily` (52-routes.js, legacy) is left for the build round
(about 15 bytes of legacy.js, which has 268 left).

## 3. Where the nightly run happens: decision

**An edge function `assistant-night`, timed by pg_cron + pg_net, on the cloud copy.** This follows the pattern
`gst-run` and `mis-run` already use: the browser's own engine files in `server/_shared/*.js`, run in Deno on books
made from the cloud copy. The cron key is `x-cron-key` from Vault (`gst_cron_key`), as in migration 168.

Why not the others:
- **Browser run**: needs FinCom open. The owner wants it to run at night with nothing open. This is ruled out.
- **SQL RPCs alone**: the checks are already JavaScript (06-audit.js, the bank matching, 2B matching, 24Q). Writing
  them again in SQL means two sets of rules that drift apart, and the "no two rule sets" lesson of migration 151 was
  costly. SQL is used only for what it is best at: the batch of clients due tonight, the idempotent upserts and the
  totals already worked out in the cloud (`tally_calc_*`, migrations 151/152: balances and ageing).

How a night goes:
1. A cron job runs every 10 minutes from 02:00 to 05:20 India time. Each run takes a batch of clients with no
   `night_runs` row for tonight (or a failed one) and calls `assistant-night` per client with a time budget, as gst-run does.
2. The function builds the client's books as the app holds them (`server/gst-run/engine.js` `books(rows)` and
   `data.ts`: tally_vouchers, tally_lines, tally_bills, tally_ledgers, client_book_items). It adds the bank statements
   (records `bank_stmt` / `bank_rows`), the Inbox (records `inbox`), 2B (client_book_items `twoB` / `reco2b` and the
   gst-2b-match runs) and the salary sheet (`salary`).
3. It runs the checks, then the self-answer step for each finding, then the entry checks.
4. It upserts the findings on `(firm, client, kind, key)`, makes a question only for a finding that ends in "ask" and
   has none yet, makes a draft entry only when all its checks pass, and writes `night_runs`.
5. A run that is cut off by its budget leaves the row `running`, and the next batch picks it up again. Because every
   write is an upsert on a stable key, a second run the same night changes nothing.

What has to be ported (moved, not rewritten) into `server/_shared/nightchecks.js` (plain JS; build.py puts it in the
app the same way it does gst3b.js, so the browser and the server share one copy):
- From **src/js/06-audit.js**: `Audit.isCash / isBankL / isLoan / isCapital / isDuties / isCreditor / isDebtor / isExpense`
  and the bodies of `checkSteps.cash40A3`, `cash269ST`, `duplicates`, `odd` (round sums, no narration) and the suspense
  part of `balances`. They read `S.books` and `Books.ledgerOf` today. They are moved to take the books as an argument,
  and 06-audit.js calls the moved copy (so the browser's audit stays the same: a differential test proves it).
- From **src/js/21 and 22**: `ledgerKey`, `decodeNarr`, `ruleHits / ruleLedger` (written rules) and the bank line's
  match to bills and sales invoices.
- From **src/js/11 GST2B / 32-itc-follow-up.js**: already in `server/_shared/gst3b.js` and `match2b.js`; reused as is.
- From **src/js/17-24q.js**: `TDS24Q.cols` and the reading of the salary sheet's months and totals.
- From **35-gst-filing.js and 09-tds.js**: due dates are already in gst3b.js (`GSTF.due`) and DueList (68). The
  Assistant does not repeat them: the Today and Compliance pages keep them. A month with no data that is close to a due
  date gets a higher place in the list.

No change to bridge-go, no new Tally request XML and no AI. Every rule is a fixed rule.

## 4. Each finding: the check, what it reuses, how FinCom answers it itself

The rule for "Resolved" is in §5. "Needs you" covers two candidates that fit, a near miss, or something only the
firm can decide.

| Finding | The check (reuses) | Self-answer sources, in order | If nothing is certain, ask |
|---|---|---|---|
| (a) Advance open over 60 days, paid or received | Party ledgers' bill-wise open items and "on account" from `tally_calc_ageing` (151; MIS.ageing / netOpen); advance ledgers by name and group (Audit.isLoan, /ADVANCE/) | A later purchase or sales bill of the same party that knocks it off (tally_bills); an adjusting journal of the same party and amount; an Inbox document naming the party with the same amount; a 2B bill of the same GSTIN and amount (then it becomes an entry, §6) | "₹2,50,000 advance to ABC Traders on 12-Aug is still open. Has the bill come?" |
| (a) Party balance on the wrong side | Parties.position at the night's date (151: `tally_balances_at`): debtor in credit, creditor in debit, over ₹1,000 | The same sources as above; a receipt or payment on account matching the balance | "₹62,000 is shown as paid in advance to Sample Tyres. Is a bill pending?" |
| (b) Cash over ₹10,000 | `checkSteps.cash40A3` (the per-day, per-party sum) | A bill in the books or the Inbox for the same party and amount (this only shows the bill exists; 40A(3) is still flagged to the firm under Needs you when it applies) | "₹15,000 paid in cash to Sample Hardware on 03-Nov. Please send the bill." |
| (b) Round sums | `checkSteps.odd` (round) | History: the same party and amount in 3 or more earlier months (rent, retainer) gives "Explained by history" | Asked only if over ₹50,000 and unexplained |
| (b) Big entry, no narration | `checkSteps.odd` (no narration) over ₹1,00,000 | A bill reference in the voucher; a bank line with a narration | "₹1,40,000 paid to X on 9-Nov has no narration. What is it for?" |
| (b) Expense jump | New: a month's total for each expense ledger (tally_calc) against its last 3 months' average: more than 3x and at least ₹50,000 more | One voucher making most of the jump that has a bill (an asset bought, a yearly fee); the same month a year before | "Repairs were ₹1,84,000 in October, against about ₹22,000 a month before. What was repaired?" |
| (b) Suspense not cleared | Suspense balance (Audit balances part) older than 30 days | A later entry clearing it | Needs you (the firm clears it), asked only if the owner chooses |
| (c) Bank line with no bill or invoice | Bank lines not posted, or posted to the party with no bill set against them (21/22 matching) | In this order: written rules (22); bill matching and sales-invoice matching (21, the Bank page's own); past entries for the same party (autopost's rules B1 to B4, 90-autopost.js, learnt only from people's approvals); 2B (a supplier bill the books do not have); salary sheet (a salary payment); TDS challans (65, tds-challan-match); GST payment (CIN or narration "GST"); loan or EMI pattern (same amount, same day each month, to a loan ledger) | "₹48,000 paid to Ramesh on 05-Nov: what is it for? A bill, salary or advance?" |
| (c) Month with no statement, or not posted up to date | For each bank account (Bank accounts setup) the months that have statement lines (records bank_stmt), against the books' last date | The Inbox (a statement waiting to be read); the bridge's last fetch (the books may be behind, not the bank) | "Please send the HDFC bank statement (account ending 2231) for October 2026." |
| (d) Bill in 2B not in books | 2B reconciliation (gst3b.js GST2B / match2b.js): "in 2B only" | The Inbox: a bill with the same GSTIN, number and amount. If found, FinCom makes a **draft entry** (§6), not a question | "Please send the bill SSC/1093 from Sample Supplier Co (₹36,580, October)." |
| (d) Month with no sales | No sales vouchers in a month that had them before, or a GSTR-1 month due | The Inbox (a sales register); the bridge (the books may not be read up to that day) | "There are no sales in the books for October 2026. Were there none, or are the bills still to come?" |
| (e) Month with no salary sheet | salary (client_book_items) months against months with salary entries | The Inbox (a salary sheet) | "Please send the salary sheet for October 2026." |
| (e) Salary paid does not match the sheet | Each month: the sheet's net pay against the salary payments in the bank and books (24Q's reading) | The difference is an advance or loan to staff, a reimbursement, or arrears found in the books | "October salary paid is ₹3,24,000 but the sheet says ₹3,12,400. What is the ₹11,600?" |

## 5. The confidence rule: "Resolved" against "Needs you" against "Ask"

**Resolved by FinCom** only when **all** of these hold (acceptance rule 1):
- **Same party.** The same ledger after `ledgerKey` / `namesKey` (server/_shared/names.js), or the same GSTIN or PAN.
  Similar names alone never count.
- **Amount within ₹1** (`|a - b| <= 1.00`). Or, for one advance against several bills, the bills add up to within ₹1.
- **Date in range.** For an advance, the bill is dated after it and within 365 days. For a bank line, the invoice is
  dated before it, or up to 7 days after for a receipt. A challan's date is the same as the bank date, or one bank day apart.
- **Not used before.** The document, entry or bank line is not already the evidence for another finding, and not
  already settled against something else (`night_findings.evidence` refs are checked across the client).
- **Exactly one candidate.** If two or more fit, nothing is picked: the finding goes to "Needs you" with every
  candidate (`candidates`).
- For a rule: a written rule (22) or an autopost rule learnt from a **person's** approval. Never a rule learnt from
  FinCom's own guesses.

**Needs you**: one candidate that fails exactly one test by a small margin (₹1.01 to 2%, a name that differs but has the
same GSTIN, a date a few days out of range); two or more candidates; a 40A(3) or 269ST point; suspense; a client with no
contact; anything where the firm must judge.

**Ask the client**: no candidate at all.

Every resolved finding shows its evidence (the entry, the document or the rule) and has **Undo**. Undo turns it into a
question (Draft), is logged, and its evidence can be used again.

## 6. Entries ready for you

Phase 1 sources: **an Inbox bill found for a 2B gap**, and **a bank line resolved by self-answer** (a challan, salary,
an invoice or bill, a rule). Phase 2 (shown as "Coming"): the GST set-off journal (`gstfJournal`, 35) and payroll journals.

Each entry is checked **before** it is shown. If any check fails, it is kept as `held` with why, under Needs you, and is
never shown as ready (acceptance rule 2):
- Dr = Cr to the paisa;
- every ledger is in the client's Tally ledgers (the cloud copy), or is flagged as **new**, which stops "ready";
- the date is not in a closed period (the client's closed periods, 47-closed-periods.js);
- no duplicate: the same party, bill number and amount, already posted (tally_vouchers) or already a draft or bill in
  FinCom (client_book_items entries, night_entries `dedupe` unique);
- the GST split adds up: taxable × rate = tax within ₹1 a line, CGST = SGST, and the IGST/CGST+SGST choice matches the place of supply.

**Approve goes through the existing path; no new path is built.**
- An Inbox bill becomes the same bill FinCom makes when the bill is read in Purchase (the reading in 01/19, the
  client's `entries`), so Approve is the review table's own approve. It then shows on the Post page under Ready to post.
- A bank line gets its ledger as a person's confirmation would give it ("confirm"), so Approve is the Bank page's own
  approve.
- From there it is the Post page, the post gate and the bridge, exactly as today (Bridge.post → tally_post_enqueue).
  The two pages show the same item, so they stay in step.
- Approve all applies only to the ticked entries. Reject keeps the entry, marked rejected, with who and when. Edit opens the
  entry in its own page (the bill drawer, or the bank line).

## 7. Questions to clients

- Words: one short plain sentence each, made from `facts` by a fixed template per kind (no AI). The owner can edit the words.
- One weekly list per client (`client_asks.week`, the Monday). A new finding joins this week's list.
- States: **Draft** (made by the night check) → **Asked** (sent) → **Answered** (a reply typed in, or a document came
  that needs reading) → **Closed** (by itself, or by a person). A closed or answered question is never made again for
  the same finding (`unique (finding_id)`).
- It **closes by itself** when a matching document arrives in the Inbox (19-document-inbox.js, Docq.jsx: same party
  or GSTIN and amount within ₹1, or the month asked for) or the entry appears in the books on the next night's run. The
  same §5 rule applies: certain, or it stays open.
- The owner approves first: tick, edit, **Send** (one press per client, or "Send all ticked" across clients in the
  build). The per-client switch "send missing-document reminders by itself" exists but is **OFF** by default. When on,
  it only resends questions already sent once that ask for a document, at most once a week.

## 8. The email path and the test-mode guard

**Email**: a new function `assistant-send`, following `server/support-mail/index.ts`: the person's token, the questions
read **as that person** (RLS decides what they can send), then `fetch("https://api.resend.com/emails")` with the
`RESEND_API_KEY` secret (set on the server, never in code or chat). The function takes question ids only. **The
addresses are always read from `client_contacts` on the server**, never from the request. The text is built by
`server/_shared/asks.js` from the ticked questions that are Draft or Asked, so nothing resolved can get in. Each send
writes `ask_sends` and `assistant_log` and marks the questions Asked.

**WhatsApp**: a `wa.me` link with the message ready (no Business API). The person's own WhatsApp opens and the person
presses send. FinCom marks the questions Asked when the link is opened (logged as `opened_link`).

**Test-mode guard (safe sending, acceptance rule 6).** It works in three layers:
1. **The firm's switch** `assistant_mail.real_send` is **false** by default. Only the firm's owner can change it, through
   `assistant_mail_set` (an owner check in SQL, logged). There is no write policy on the table.
2. **The server's switch** `ASSISTANT_MAIL_LIVE` (a function secret). Unless it is exactly `yes`, the function is in test
   mode **whatever the firm's switch says**. It is not set on staging. The owner decides when (see §11).
3. **In test mode** every email goes **only to the firm's own address** (`assistant_mail.test_to`, else the owner's
   sign-in email). The subject starts with `[TEST]` and the body starts with "[TEST: not sent to the client]" and lists
   the addresses it would have gone to. `ask_sends.sent_to` records where it really went. A unit test checks that no
   other address can reach Resend's `to`, cc or bcc in test mode.
   The WhatsApp link in test mode opens to the firm's own number.

Also: at most 1 email a client a day and 50 a firm a day; the From address is a verified sender on the firm's domain
in Resend; replies go to the firm's own address.

## 9. Acceptance rules (the owner: "completely error free")

1. **Resolved means certain.** A finding is Resolved only on an exact, rule-based match: same party (ledgerKey), amount
   within ₹1, date in range, and a document or entry not already used. Anything less stays "ask" or "needs you". Never
   guess; never resolve on similarity alone. If two candidates fit, do not pick: show both under Needs you.
2. **Entries are checked before they are shown.** Dr = Cr, ledgers exist in Tally (or are flagged as new), not in a closed
   period, no duplicate (same party, bill number and amount, posted or drafted), and the GST split adds up. If any check fails, the
   entry is not shown as ready.
3. **No silent writes.** Nothing posts, sends or changes the books without the owner's approval. Every action is
   logged (`assistant_log`) with its evidence and can be undone.
4. **Idempotent nightly runs.** Re-running the same night creates no duplicate findings, questions or drafts (the
   unique keys above). An answered question is never asked again.
5. **Tests.** Each check and each self-answer gets its own made-up cases: matches, near misses (₹1.01, wrong party,
   out-of-range date), ties, documents already used, and empty books. Where logic is reused from legacy, a differential test runs the
   browser's Audit (06) and `nightchecks.js` on the same fixture books and compares every finding.
6. **Safe sending.** On staging, email goes only to the firm's own address. The client's message is built only from
   "Still need from client" items. A test proves resolved items never appear in it (`tests/run_assistant_message.mjs`,
   already in this round: it passes).
7. **Reviews before any release.** An independent code review, then a separate check of every number against the source rows.

## 10. Risks

- **Wrong "Resolved"**: a resolved finding hides a real problem. Kept down by the strict rule in §5, Undo, and the folded
  list with its evidence for the owner to scan. Fixed rules only, no similarity matching.
- **Reused logic drifting**: if the browser and the night disagree, the owner sees two answers. One shared file
  (nightchecks.js) and the differential test prevent it.
- **Cloud copy not up to date**: the night reads only what the bridge last sent. A run uses the books' version and
  date ("books up to 20-Nov"). A month is called missing only if the bridge's read covers it (tally_period_days).
- **Edge function time**: large books (40,000+ entries). Budgeted per client as in gst-run, resumable, and only the
  last 13 months are read for most checks.
- **Email reaching a client from staging**: the three-layer guard in §8 and its test.
- **Name clash**: "FinCom Assistant" is the Ask FinCom chat (server/assistant, assistant_* tables). This page is "Daily
  Check"; its tables are `night_*`, `client_asks` and `client_contacts`, its functions `assistant-night` and `assistant-send`.
- **Clients' data in email**: only the question's words (party, amount, date) go out, to the client's own contacts.
  Nothing from another client is ever read into a message (one client per function call).
- **Size budgets**: legacy.js has 268 bytes left. All new code stays in lazy chunks and server files; only the route (about
  15 bytes) touches legacy.js.

## 11. The owner's decisions (21-Nov-2026: yes to every proposal)

1. **Name**: the page is **Daily Check** (not "Assistant"). Code: `app/src/screens/daily/`, homeTab `daily`. The server
   names (`assistant-night`, `assistant-send`, the tables) stay as drafted: they are not shown to anyone.
2. **Real sending**: `ASSISTANT_MAIL_LIVE` is never set on staging. On the live app only after the reviews (rule 7), and
   then each firm's owner still turns real sending on.
3. **From address**: the firm's own domain, verified in Resend; replies go to the firm.
4. **Thresholds** as proposed: advance 60 days; cash over ₹10,000; round sums over ₹50,000; no narration over
   ₹1,00,000; expense jump 3x and ₹50,000; wrong-side balance over ₹1,000; suspense older than 30 days.
5. **Night window** 02:00 to 05:20 India time; a **new list every Monday**, questions not sent carry over.
6. **Who sends**: only the firm's **owner** in phase 1 (`assistant-send` checks `members.role = 'owner'`; staff see the
   questions and may edit them).
7. **Reminders by itself**: off by default. When on, only document requests already asked once are sent again, at most
   once a week. Nothing else is ever sent by itself.
8. **Phase 2** journals (GST set-off, payroll) stay out of phase 1.

## 12. Build order (next round, after the owner's yes)

1. `nightchecks.js` (moved from 06/21/22/17) + the differential test; 06-audit.js calls it (legacy.js size checked).
2. Migration 206 for real (from the draft), with its own pg_stand test (RLS for owner, staff, look-only, another firm,
   anon; idempotent upserts), then applied to **staging only** by the owner.
3. `assistant-night` (findings, self-answer, entry checks) with the tests of rule 5; the cron job last.
4. `assistant-send` with the guard and its test; the page reading the tables instead of demo.js.
5. Approve wiring into the existing bill and bank approvals; the Post page check that both pages show the same item.
6. Independent review, then the number-by-number check against the source rows (rule 7).
