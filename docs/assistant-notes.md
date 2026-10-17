# FinCom Assistant (step 1): notes

Branch `ask-fincom`. Function `fincom-assistant` (`server/assistant/`), migration 77, panel `app/src/parts/Assistant.jsx`
with `src/js/75-assistant.js`, "Check before filing" `src/js/76-prefiling.js` with `app/src/parts/PreFile.jsx`.
Tool modules for the audit and the reports: `docs/assistant-tools.md`.

## On by default (the owner's decision of 14-Oct-2026)

FinCom Assistant is ON for every firm unless the firm's owner switches it off (Settings › AI help › FinCom Assistant);
staff see the switch but cannot change it. There is no clients'-consent tick any more: the owner decided on 14-Oct-2026
to use it by default, and each person sees the notice "Questions may be processed by an AI provider; identifiers are
masked" the first time they open the assistant (the short note stays under the question box). The cost cap
(then Rs 150 a firm a day; a month's since 17-Oct-2026, below) stays on. Migration 82 makes a firm with no setting count as on; a firm whose owner switched it
off stays off. The same day's fix: the Settings page could stay on "Loading…" (or greyed) when the firm's setting was
first read before the sign-in had finished, and on a phone the Ask FinCom button covered the bottom bar's More (so
Settings could not be reached); the setting is now read again until known, and the button sits above the bar.

## A plain chat (the owner, 14-Oct-2026)

The panel reads like any chat app: the conversation top to bottom, the newest at the bottom (scrolled into view as it
streams), the question box fixed at the foot with the one Upload (paperclip; dropping files on the panel does the same).
No "Earlier in this conversation" block: past conversations only behind the History button. No green, amber or blue
labels: a small grey "Source: …" line at the end of a reply opens the detail (the entries the AI used, the web pages, the
figures recomputed). A reply shows once: the words, then the table with no repeated title or summary line (a table keeps
its title only beside others, and a tool's own note such as "Figures for the certificate – please confirm"). The line
"Questions may be processed by an AI provider; identifiers are masked. It reads, works out, drafts and exports; it never
posts, files or changes anything." is in Settings › AI help only (the one-time first-use notice stays). Inside nothing
changed: FinCom's figure still replaces the AI's (and says so), masking, the cap. Tests: run_assistant_ui.py ("chat:" checks).

## One Upload (the owner's request of 14-Oct-2026)

The panel's "Notice" button is now **Upload** (app/src/parts/asst-upload.js, `AUpload`): PDF, pictures, Excel/CSV, Word, JSON,
several at once or dropped on the panel. Each file is stored in the firm's private folder (a notice with the notices, the
rest under `uploads/`), recorded in `assistant_uploads` (migration 84) and told by FinCom's own rules first (no AI); only
when they cannot tell is Haiku asked (server/assistant/upload.ts, masked, against the daily cap). Then the next steps as
buttons, each the user's own click; nothing is posted or filed by itself:

| Found | Offered |
|---|---|
| a tax notice | the notice flow as before (one notice alone is attached to the next question at once) |
| a bill or invoice | Add to Purchase (or Sales, when the client issued it) for review |
| a register sheet, a GSTR-1 or GSTR-2B JSON | Import in Purchase / Import in Sales: the page's own import (upload pages, src/js/82-registers.js), for review; GSTR-2B to Purchase, GSTR-1 to Sales |
| a bank statement | Add to Bank for review |
| 26AS / AIS / TIS | Add to Reconciliations (26AS) |
| a certificate format, a signed statement | Use for a certificate: it goes to the certificate tool with the next question (every upload but a notice is in the conversation's files, `ASST.ups()`) |
| anything else | its summary, and Ask about it (its text goes with the question, masked; Sonnet, not the notice model) |
## The same day's other fixes (14-Oct-2026)

- **The testing strip covered Ask FinCom.** The strip along the bottom of the testing site and of review builds
  ("REVIEW BUILD – …") is measured as drawn and put on `:root` as `--bottom-banner-h` (0px without one;
  `bottomBannerH()` in src/js/01, run with `padForBars` on every drawing, resize and when the fonts load). Everything fixed
  to the bottom stands on it with `calc(var(--bottom-banner-h, 0px) + its own gap)`: Ask FinCom, the toasts, the undo
  snack, the phone's bottom bar, the action bar, sticky table footers and save bars; the pages' bottom padding adds it.
  No fixed numbers for the strip are left in build/test-style.html. Test: tests/run_bottom_banner_ui.py.
- **Raw keys in answers** ("disallowance30pct"). One label map for the fields of a tool's result,
  `server/_shared/assistant-labels.js` (plain JavaScript): FinCom's own line (router.ts describe()), the line under a table
  in the panel, `summaryLabels` beside each result the model reads (it is told to use those words), and a last pass over the
  model's answer (`relabelText`). "Disallowance u/s 40(a)(ia) – 30%", "payments in cash (%)" and so on.
- **A long client name on Ask FinCom** is cut with an ellipsis inside the button's width; the tooltip has the whole name.

## How a question is answered (cheapest first)

1. **Answer cache.** The first question of a conversation, asked again for the same client on the same books (the
   books' version, `asst_data_version`), is answered from `assistant_answers` at no cost. A question naming a relative
   period ("this year") is keyed by the day too. General questions keep 7 days, a client's 30.
2. **Keyword router** (`router.ts`, no model): the common questions go to their book tool by their words; FinCom writes
   the line above the table from the tool's own summary. Green. "check my Q2 26Q" opens FinCom's checklist.
3. **Haiku 5.5** picks one book tool when the words do not (effort low, 1,024 tokens). It never answers, reasons about
   tax, drafts or reads the Day Book. A choice that fails FinCom's check is tried once with Sonnet. A question it cannot
   route goes on and is logged as "fell through" (the owner sees them: candidates for new intents).
4. **Sonnet 5.5** (effort medium; `ASSISTANT_CHAT_EFFORT` can set low) for book questions that need reasoning, general
   tax questions and files; **Opus 5.5** (effort high) for notices, and for the audit and reports (steps 2 and 3).
   Thinking adaptive; no forced tool choice; strict tool schemas (FinCom retries once without strict if the API refuses
   them); the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) is ON for
   Sonnet and Opus (Haiku has none). The system prompt and tool list are frozen and cached for one hour; the turn is
   cached automatically. Web search (at most 3 a answer) and web fetch only for general questions and notices; Taxmann,
   SCC Online and Manupatra are blocked.

## What goes to the AI provider, and when

Only per question, while the firm's assistant is on (the default since 14-Oct-2026), with the first-use notice shown. Nothing for a
keyword answer, a cached answer or a check before filing. Otherwise: the question; for Haiku nothing else; for Sonnet or
Opus also the tool results the model asks for, as totals and at most 15 rows (the Day Book slice at most 150 entries,
six columns), and a notice the user attached. PANs, GSTINs, TANs, Aadhaar and phone numbers, and the names of parties the
question does not name, are replaced by tokens before sending and put back after (`mask.ts`; tested: no raw PAN or
GSTIN in any payload). **ZDR** is an organisation-level arrangement with Anthropic, not an API parameter: FinCom cannot
switch it on per request; if the firm's Anthropic organisation has it, it applies to every call.

## Notices

`record_notice` -> FinCom's checklist for the notice type and issues (`notices.ts`: ASMT-10, DRC-01/01A, REG-17/31,
143(1)(a), 143(2), 148/148A, 133(6), TDS default, 270A/271): each document ready from FinCom (made now from the book
tools: ITC books/2B/3B, reverse charge, purchase register, ledger extracts, payment proofs with UTR, turnover
books/GSTR-1/3B, 26AS against the books, TDS receivable, TDS deductee details with payments), you must attach, or not
applicable. The ready ones are Annexure 1..N. The reply must cite exactly those numbers (FinCom sends it back
otherwise). The reply pack (ZIP): the DRAFT reply in Word and PDF with the reference block, the annexures in Excel, a
Citations annexure, and an index of what the user must still add. The notice is tracked (`assistant_notices`): each
document ticked as attached, the reply date to the due list on a click, received -> drafted -> filed (with the
acknowledgement). FinCom files nothing.

## Case law

Only from a page found or read during that answer, with the case's name and the quoted line checked on the page's text
(the web fetch's text, or FinCom fetching a free public source itself). Otherwise "No verified case found for this
point." Case names the model writes without a verified citation are removed. Each citation: "Verify before filing".

## Cost guard

A rupee cap per firm per calendar month, by India's date (Rs 3,000 by default, at Rs 85 to the dollar; the owner sets both
in Settings › AI help). The owner's decision of 17-Oct-2026, migration 96 (it was Rs 150 a day, migration 77); shared by Ask
FinCom and the 2B matching. Each AI call's cost is worked out from the API's usage (`models.ts` prices) and added to the
day and the feature; the cap compares the month's days. At 80% a warning; at 100% no
new AI call; green answers, cached answers and checks before filing keep working. A second limit of 500 calls a day
stops a runaway loop. The log: question, tools, route, models, tokens, cost, time; never an answer or a figure.

Measured on the fixture questions (`tests/run_assistant_cost.py`; tokens estimated from what is sent, model mocked),
in rupees, before the levers (Opus medium for everything) and after:

| | cold before | cold after | warm before | warm after |
|---|---|---|---|---|
| 5 common book questions (keyword) | 12.28 | 0.00 | 8.39 | 0.00 |
| a filter Haiku routes | 1.72 | 0.11 | 1.72 | 0.01 |
| a Day Book question (Sonnet) | 2.84 | 4.66 | 2.84 | 1.57 |
| a tax-rate question (Sonnet + web) | 8.05 | 5.89 | 3.43 | 2.23 |
| the same again (answer cache) | 3.43 | 0.00 | - | - |
| an Excel file (Sonnet) | 1.66 | 0.98 | 1.66 | 0.97 |
| an ASMT-10 reply pack (Opus high) | 10.44 | 16.67 | 5.91 | 9.33 |
| all | 40.42 | 28.31 | 23.95 | 14.11 |

Cold: the first question of the hour (the one-hour cache is written at 2x). The notice costs more after: Opus at high
effort (the owner's choice) and the annexures it now reads. The batch API (half price) is not used by default.

## Known gaps

- The live smoke test needs the deployed function and a staging sign-in; see the release notes for whether it ran.
- `tally_mis` on the server (migration 14) leaves out a company's own primary groups from the P&L; the assistant's
  `asst_profit_loss` does not (it reads `groupInfo`).
- Sonnet at effort low was not compared with medium on real answers (that needs live calls); medium is the default.
