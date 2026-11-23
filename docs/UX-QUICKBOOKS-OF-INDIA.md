# FinCom: "the QuickBooks of India", a design proposal

**Status:** proposal for the owner's review. No live screen is changed by this branch.
**Branch:** `next-ux-proposal`, off `origin/staging-next` @ d580e8451.
**Mockups:** `app/src/proposal/` (standalone React pages with made-up data, not linked from the app). To build them:
`cd app && npx vite build --config src/proposal/vite.config.js --outDir <a folder outside the repo>`, then open
`index.html?s=home|client|new|search|bank|entry|tally|phone|phonebank|system`, adding `&theme=dark` or `&state=empty|loading|new`.

The goal is QuickBooks' *level* of simplicity and confidence, not its look. Nothing here copies its name, logo, colours,
layout or wording. FinCom keeps its indigo brand and Inter/Geist type, and it is built around what an Indian CA firm does
every day: Tally first, GST and TDS, ₹ in lakh and crore, and dates written as 21-Nov-2026.

---

## 1. Screenshots (for the morning review)

| # | File | What it shows |
|---|---|---|
| 1 | `01-home-firm.png` | The firm's Home: a greeting, 4 figures, one list of to-dos across all clients, what FinCom did overnight, and the next due dates |
| 2 | `02-client-home.png` | Client Home: money in and out, bank balance, GST and TDS to pay, **Do next** (3 actions), the 6-month chart, overnight work |
| 3 | `03-new-menu.png` | The global **+ New** menu: Record (Bill, Sale, Receipt, Payment, Journal, Contra, each with its Tally key) and Bring in (statement, bills, Excel, client) |
| 4 | `04-search.png` | **Ctrl+K** search across clients, parties, invoices and ledgers, plus actions |
| 5 | `05-bank-list.png` | The list pattern on Bank: account cards, filter chips with counts, a bulk bar, an expanded row with FinCom's match, a Problem row with its fix, and totals |
| 5b | `05b-bank-empty.png` | The same page with no statement: an empty state that says what to do |
| 5c | `05c-bank-loading.png` | The same page loading: a skeleton in the table's shape, with no spinner |
| 6 | `06-entry-form.png` | The form pattern: a bill with automatic GST (IGST, because the supplier is in another state), a TDS suggestion (194J), and a live Dr/Cr preview "as it goes to Tally" |
| 7 | `07-tally.png` | One Tally page: one status line, the 3-step set-up (2 done, 1 now), then Companies, Sent to Tally and Settings as tabs |
| 7b | `07b-tally-first-time.png` | The same page before anything is connected |
| 8 | `08-client-home-dark.png` | Client Home in dark mode |
| 9 | `09-system-sheet.png` | The design system on one sheet: the 5 status words, buttons, money and dates, skeletons, the undo toast |
| 10 | `10-phone-home.png` | Client Home on a phone (390 px), with 5 bottom tabs and + New in the middle |
| 11 | `11-phone-bank.png` | Bank on a phone: rows turn into cards, and the chips scroll sideways |
| 12 | `12-phone-home-dark.png` | Phone Client Home in dark mode |

All shots are at deviceScaleFactor 2: desktop at 1440 wide, phone at 390 wide.

---

## 2. The 15 biggest friction points (today's app)

These come from reading `app/src` at d580e8451 (Side.jsx, TopBar.jsx, Today.jsx, the Tally screens and parts, the styles)
and from the earlier full UI review of the test build. They are ordered by how much each one costs a user every day.

| # | Friction | Where | Effect |
|---|---|---|---|
| 1 | **Too many menu items.** Inside a client the sidebar has 17 items in 4 groups (Overview; Purchase, Bank, Sales, Transactions; TDS, GST, Reconciliations; From Tally, Reports, MIS, My MIS, Statements, Corporate, Audit, Look up, Letters; Client setup). The firm's menu is a different tree, and the Bank page swaps in a third menu (its own rail). | `Side.jsx tree()`, `parts/bank/Rail.jsx` | People hunt for things, and the menu changes shape as they move. |
| 2 | **Tally is in 8 places.** The sidebar's Tally page; the top bar's Tally icon and drawer; Integrations; Settings (Connect Tally, Books in the cloud, Sent to Tally); a client's From Tally; Client setup › Tally; Overview's "Link to Tally" card; Purchase's Post to Tally tab. That is 21 `Tally*` parts and about 1,460 lines in the Tally, TallySync and Integrations screens. | `screens/Tally.jsx`, `parts/Tally*.jsx`, `TopBar.jsx` | This is the owner's first complaint: a person cannot tell where to go or which step comes next. |
| 3 | **No single way to create something.** Each page has its own Upload in the top bar. There is no "new receipt", "new payment" or "new journal" anywhere, and no button that works the same on every page. | `TopBar.jsx` (one Upload per page) | It feels like a review tool, not accounting software. |
| 4 | **No global search.** You can switch clients (F3) and look up ledgers per client (Look up, "/"). Nothing finds a party, an invoice number, a GSTIN or an amount across clients. | `Switcher.jsx`, `books/Lookup.jsx` | "Where is that Sharma bill?" means opening clients one by one. |
| 5 | **Around 25 status words.** These include Needs you, To review, Ready, In Tally, Posted, Done, Check, Waiting, Filed, Open, Sent, Draft, Closed, Matched, Rejected, Queued, Pending, Not posted, Held, Failed, Errors, Approved, Due and Overdue, with different colours on different pages. | Most screens | People cannot learn what the words mean, so they read every row. |
| 6 | **One action, many names.** For example, "Bring ledgers from Tally", "Update now", "Check again", "Sync" and "Fetch" can mean the same thing, and the step text names a button that does not exist. | Tally page, panel and client box | People lose trust ("which button did it mean?"). |
| 7 | **Too many words.** State cells hold 2–3 paragraphs, the Overview checklist cards hold sentences, and help text sits inline instead of behind a "Details" expander. | Tally rows, Overview, set-up | This goes against the owner's "calm pages: few words, details on expand". |
| 8 | **Dead ends.** You see "Sign in to the firm account first…" with no Sign in button, and about 38 toasts end in "…first" with no action. | Many screens and toasts | People are stuck and must already know where the fix is. |
| 9 | **Client Overview leads with set-up, not money.** It shows a 6-card checklist and four "0" counters. It has no bank balance, no money in or out, no GST or TDS due, and nothing on what FinCom did. | `screens/Dash.jsx` | It does not answer a small-business owner's first question: "how am I doing, what do I owe?" |
| 10 | **The firm's home is split.** Today, Daily Check, Compliance and the Inbox tray each hold part of "what needs me". The overnight work (bills read, lines matched, entries posted) is in the bell and in Daily Check, not on the home page. | `Today.jsx`, `daily/`, `Compliance.jsx` | You need four places to plan the morning. |
| 11 | **Overlapping names and depth.** "Statements" (financial) sits next to bank statements, "MIS" next to "My MIS", and "Reports" next to both. Audit's tie-out and Reconciliations are separate. Every top page has a "← Back" button even when there is nothing to go back to. | Sidebar, `TopBar.jsx` | People open the wrong page, and the crumb is cut short ("Purcha…"). |
| 12 | **Empty states are uneven.** A red "Posting waits…" shows when nothing is waiting. Bank shows "— counted when Bank is opened". Some lists are simply blank. | Purchase › Ready to post, Overview | Red loses its meaning, and a blank page looks broken. |
| 13 | **Waiting feels slow.** There is a mix of "Opening FinCom", "Loading…" text (20 components), the thin top bar and "Opening…" on the client card. Posting waits for Tally's answer before the row changes. | `nav.js`, `parts/Loading.jsx`, `OpenLoader.jsx` | Even fast pages feel slow, and each click feels uncertain. |
| 14 | **Five table and filter patterns.** ListTable, FilterBar, ChipBar, Filters and ColFilterPop each behave a little differently. Bulk actions, totals and row details vary from page to page. | `parts/` | Each page has to be learned again. |
| 15 | **The phone layout is cramped.** The header takes 124–159 px. Today scrolls sideways. Totals become an unlabelled card. The firm and client bottom bars hold different tabs. There is no + New on a phone. | `arc-shell.css`, ListTable phone cards | A business owner checking on a phone sees about 60% content, and much of that is clutter. |

---

## 3. Design principles

1. **One job, one place.** Every task has exactly one home, and other places link to it. Tally lives on the Tally page; nothing else configures Tally.
2. **The answer first, details on expand.** A row shows one line. Why, how and history sit behind ▸ or a tab. A page shows at most about 40 words of prose before the first table or figure.
3. **Five status words, everywhere** (see §5). A colour always means the same thing.
4. **One main button per page**, named with a verb that says what happens: "Post 3 to Tally", "File GSTR-1", "Make challan". Never "Submit", "Proceed" or "Update now".
5. **Everything is one click from anywhere.** Use the 7-item menu, + New, Ctrl+K search and the client switcher. No feature sits deeper than menu › tab.
6. **Tally first.** Entries show "as it goes to Tally" (Dr/Cr, ledgers, voucher type). The voucher keys match Tally's (F4 Contra, F5 Payment, F6 Receipt, F7 Journal, F8 Sales, F9 Purchase). Ledger names are the client's Tally ledgers.
7. **Indian by default.** ₹ with Indian grouping (₹12,34,567), lakh and crore on summaries (₹12.4 L, ₹1.2 Cr), dates as 21-Nov-2026, FY 2026-27 and quarters, GSTIN, PAN and TAN shown as people know them, and GST and TDS sections written the way CAs write them (194C, 194J, GSTR-3B).
8. **Never a dead end.** Every "can't" carries its fix as a button.
9. **Feels instant.** Show a skeleton in the page's shape, never a spinner under 1 second. Change the row as soon as the person clicks, then confirm or roll back with a reason. Offer undo for 8 seconds instead of "Are you sure?".
10. **Calm.** Use white space and a few colour accents. Use tabs instead of stacked sections. Phone first for the owner's views (Home, Bank, approve), desktop first for the accountant's work.

---

## 4. Design tokens

The colours stay FinCom's (`src/css/app.css :root`, `app/src/styles/arc-tokens.css`); these are proven for contrast in light and dark mode. What is new is a strict scale for the rest, set out in `app/src/proposal/tokens.css`. In Phase 1 it moves into `arc-tokens.css`.

| Group | Tokens | Rule |
|---|---|---|
| Brand | `--brand #4338CA` (dark `#818CF8`), `--brand-tint`, `--on-brand` | Used only for the one primary button, the current menu item, links and focus |
| Surfaces | `--paper` (page), `--sheet` (cards), `--sheet-2` (inputs, chips), `--rule`, `--rule-soft`, `--rule-strong` | Cards sit on paper; no shadow heavier than `--lift` except popovers (`--float`) |
| Status | slate / amber / sky / emerald / rose tones (`--tone-*`, tints with `--tint`) | Used **only** for the 5 status words (§5) and due dates |
| Charts | `--money-in #0284C7` / `--money-out #4F46E5`; dark `#0891B2` / `#6366F1` | Checked with the colour-blindness validator: ΔE ≥ 10 for adjacent colours in both themes |
| Spacing | `--s1..--s7` = 4, 8, 12, 16, 24, 32, 48 px | Only these values |
| Type | `--t-xs 12`, `--t-sm 13`, `--t-md 14` (body), `--t-lg 16`, `--t-xl 20` (page title), `--t-2xl 28` (figures) | Inter for text, Geist for titles and figures; tabular digits for all money |
| Shape | `--r-sm 6`, `--r-md 10`, `--r-lg 14` | Controls use 9 px, cards use 14 px |
| Density | `--row-h 44px`, `--ctl-h 36px`, `--top-h 68px`, `--nav-w 236px` | One row height for every table (a "compact" choice keeps 36 px for accountants) |

---

## 5. Status words: one set, used everywhere

| Word | Tone | Means | Replaces today's |
|---|---|---|---|
| **New** | slate | It came in and nobody has looked at it yet | To read, Unread, Queued, Pending, Waiting |
| **To review** | amber | FinCom has a suggestion and a person must confirm it | Needs you, Check, Draft, Unmatched, Held |
| **Ready** | sky | It is confirmed and will be posted or filed | Ready to post, Approved, Matched, Open (return prepared) |
| **Done** | emerald | It is posted to Tally, filed or paid | In Tally, Posted, Filed, Sent, Closed, Synced |
| **Problem** | rose | It stopped; the row says why and has the fix as a button | Failed, Error(s), Rejected, Not posted, Stuck |

- A short "where" may follow: **Done · in Tally**, **Done · filed 18-Nov**, **To review · not linked**.
- Due dates are **not** a status. They are separate, coloured text: *Overdue 2 days* (red), *Due today* (amber), *Due 7-Dec* (grey).
- The counts on chips, menu badges and Home tiles use the same words.

---

## 6. Screen by screen

### Navigation (all pages)
- **Left menu, at most 7 items, the same shape everywhere.** A scope switcher at the top (firm, or a client: one click, type to filter, F3 kept) changes the items:
  - **Firm:** Home · Clients · Due dates · Daily Check · Tally (5).
  - **Client:** Home · Bank · Purchase · Sales · "GST · TDS · ITR" (one item) · Books · Tally (7).
  - Settings and Help move to the foot, under a one-line Tally status ("Tally connected · 2 min ago").
- How today's 17 client items fold in:
  - **Transactions** becomes the "All" tab of Purchase, Sales and Bank, and a tab in Books.
  - **TDS, GST and Reconciliations** become **GST · TDS · ITR** with tabs: GST, TDS, ITR, 26AS / 2B reconciliation.
  - **Reports, MIS, My MIS, Statements, Audit, Look up, Letters, Corporate and From Tally** become **Books** with tabs. From Tally becomes "Import" inside the Tally page's client view.
  - **Client setup** becomes the client switcher's "Client settings".
  - **The Bank rail** is dropped, and Bank uses the same menu.
- **Top bar:** page title (and crumb), **search (Ctrl+K)**, the page's own secondary action, **+ New** (primary), the bell and the user. There is no "← Back" on top-level pages.
- **+ New:**
  - Record: Bill, Sale invoice, Receipt, Payment, Journal, Contra, each showing its Tally key.
  - Bring in: Upload a bank statement, Upload bills, Import from Excel, New client.
  - Any file dropped on the menu is identified by FinCom.
  - On a firm page, + New first asks "For which client?" (with the last one used selected).
- **Search (Ctrl+K, or "/" on any page):**
  - One box for clients, parties (across clients), invoices and bills (by number or amount), ledgers, GSTIN, PAN and pages ("GSTR-1").
  - Results are grouped, with chips to narrow them. ↑↓ and Enter work.
  - Actions such as "New bill from Sharma Transport Co" appear in the results.

### Home (firm)
- A greeting and one line: the date, the number of clients and how many things need you.
- 4 tiles that each open a filtered list: Needs you · To review · Ready for Tally · Due this fortnight.
- **To-dos:** one list across clients, most urgent first. Each row has the client, the task, the due date, the status and one button. Chips filter it: All, Overdue, Today, Waiting on client, Mine. It replaces the split between Today, Compliance's overdue list and Daily Check's queue. Daily Check stays as the detailed page.
- **Overnight, FinCom…:** 4 figures (bills read, lines matched, entries posted, duplicates caught), with a link to see them client by client.
- **Coming up:** the next 4 due dates, with the number of clients for each.

### Client Home (replaces Overview)
- 5 money tiles: Money in (this month), Money out, Bank balance (all accounts), GST to pay, TDS to pay, each with its due date.
- **Do next:** exactly 3 actions, most urgent first, with one primary button.
- A chart of money in and out (3 months, 6 months or the FY), and the bank accounts with their balance and "as of" date.
- **Overnight, FinCom…:** what it read, matched, posted and checked for this client.
- The set-up checklist leaves the page and becomes a slim "2 of 6 set up ▸" line until it is done.

### The one Tally page
- **One status line** at the top: Connected (TallyPrime version, computer, last sync, N of M clients linked) with **Sync now**, or "Not connected yet. Three steps, about 5 minutes."
- **3 steps** in place of today's 6:
  1. Install FinCom Bridge.
  2. Turn on Tally's connection (shows the exact TallyPrime menu path, with a port to copy).
  3. Link each Tally company to its client (FinCom suggests the client).
  Done steps fold to one line. The current step has the only primary button.
- **Tabs:** Companies (Tally company ↔ client, status, last sync, Link) · Sent to Tally (history, with Problem rows and their fix) · Settings.
- **Details and help** (collapsed): bridge version, computers, log, and what FinCom reads and writes.
- **Everything else only links here.** The top bar's Tally icon becomes the sidebar foot's status line (it opens this page). Settings' Tally group, Integrations' Tally card, Client setup › Tally and Overview's card are removed or turned into links. A client's view of Tally (its company and its imports) is a filter of this same page.

### List and table pattern (Bank shown; Purchase, Sales, Clients, To-dos and GST registers use the same)
- Above the card: the context, such as account cards with balance and "as of" date.
- **Filter chips** with counts that use the status words, plus a dashed "+ filter" chip (party, amount, ledger). Search sits on the right, with the date range and download.
- **Bulk bar:** when rows are ticked, a tinted bar replaces the column header row. It shows "3 selected · ₹2,08,530", the main bulk action (Post 3 to Tally), Set ledger, Not business, and clear.
- **Row:** one line. ✦ marks FinCom's suggestion. Money-in figures are green, money-out figures stay in normal ink. The status pill is the last column.
- **Row expand** (▸): the match or suggestion, with Confirm, Pick another and Split. A **Problem** row always shows its reason and a fix button beneath it.
- **Totals footer:** rows shown out of the total, the closing balance, and sums of money out and money in.
- **Empty state:** an icon, one sentence on what this page is for, the main action, a second option ("Ask the client for it") and a line of reassurance.
- **Loading:** skeleton rows with the same height and columns as the real rows. Chip counts show "…".
- **Phone:** rows become two-line cards, the chips scroll sideways, and the bulk bar wraps.
- This means 1 table part replaces ListTable, FilterBar, ChipBar, Filters and ColFilterPop. Column filters stay as an option inside the "+ filter" chip.

### Form pattern (a bill shown; sale, receipt, payment, journal and contra use the same)
- **Left: the entry.**
  - The party is a searchable select that shows its GSTIN and state.
  - Then number, date, due date (with "30 days") and place of supply.
  - Lines: ledger, HSN/SAC, amount, GST rate, then tax worked out.
  - Enter on the last line adds a line.
  - An attached PDF says what FinCom read from it.
- **GST worked out (automatic):**
  - Supplier state compared with place of supply gives IGST, or CGST + SGST, explained in one line.
  - "Change" overrides it, for example for reverse charge or an SEZ supplier.
- **TDS suggested:**
  - FinCom suggests the section and rate from the ledger and party type.
  - It checks the year-to-date threshold against this party (for example 194J above ₹50,000).
  - It shows the amount to deduct, with Deduct ₹X / Not now.
  - It never deducts silently.
- **Right: "As it goes to Tally"** shows a live Dr/Cr voucher with totals and a **Balanced** check, and whether every ledger exists in Tally. The buttons are **Save and post to Tally** (Ctrl+Enter), Save and new, and Save draft. The draft saves itself as you type.
- **Errors** appear inline under the field and never as a toast. Esc cancels, and asks "Discard?" only if something was typed.

### Loading and feedback
- Use skeletons in the page's shape for anything over 150 ms, and nothing under that. Keep the thin top bar for page changes. Remove "Opening FinCom…", "Loading…" texts and spinners.
- **Optimistic updates:**
  - Post, confirm, link and mark as filed change the row at once.
  - A toast "3 lines posted to Tally · Undo" stays for 8 seconds.
  - If Tally refuses, the row turns **Problem** with the reason and a fix button.
- Use toasts only for results. Refusals appear on the spot, as an inline note with a button.

### Phone
- The top bar is 56 px: menu, client switcher, search and bell.
- The bottom tabs are Home · Bank · **+** · Returns · More, the same for every client. On firm pages they are Home · Clients · **+** · Due dates · More.
- Client Home on a phone shows the 5 tiles (2 per row), Do next (only the first action has a button), the chart, accounts and overnight work.
- Lists become cards. Forms become one column, with the Dr/Cr preview as a collapsible strip above the Save button.

---

## 7. Phased rollout

Effort is in developer-days for one experienced front-end developer working with the current codebase, including updating the Playwright suite. Risk mostly means **test churn and muscle memory**:
- 36 test files look up sidebar items (`data-side`, `.side-link`).
- 88 test files assert today's status words.

### Phase 1: quick wins, biggest change in feel (about 3 weeks)
| Item | What | Effort | Risk |
|---|---|---|---|
| 1. Navigation | 7-item menu with a scope switcher; fold the client items into tabs (Transactions, Returns, Books); drop the Bank rail; Settings and Help at the foot. All page addresses (`goClient("books:mis")` etc.) are kept, so links and tests that open pages directly still work | 4 d | **Medium**: 36 test files look up sidebar labels; people used to "MIS" in the menu need a week |
| 2. + New | A global menu with the Record and Bring in groups. In Phase 1, Record opens today's existing flows (upload or bill), Receipt, Payment, Journal and Contra open the Phase 3 form when it lands, and they are hidden until then | 2 d | Low |
| 3. Ctrl+K search | A palette over what is already loaded (clients, parties, ledgers, bills and invoices of open clients, pages, actions), plus a server query for invoice numbers and amounts across clients | 4 d | Low–Medium: the cross-client server query needs an index on bill number and amount |
| 4. Status words | One `STATUS` map and one `<Pill>` part; map the ~25 words to 5; rename chip, tab and badge counts | 3 d | **Medium**: 88 test files assert words, so it needs a careful find-and-replace and a re-run of the suite |
| 5. Skeletons | One `<Skeleton>` set (tiles, table rows, form); replace "Loading…" and "Opening…" in the 20 components that have it; Home, Bank, Purchase and Sales first | 3 d | Low |
| 6. One Tally page | One status line and 3 steps; Companies, Sent to Tally and Settings tabs; Details collapsed; the top-bar Tally icon, Settings' Tally group and the Integrations Tally card become links to the page | 5 d | **Medium**: the Tally tests (run_tally_*) need updating; the bridge itself is unchanged |
| | **Phase 1 total** | **~21 d** | |

### Phase 2: the two home pages and the list pattern (about 3 weeks)
| Item | Effort | Risk |
|---|---|---|
| Firm Home: to-dos across clients, overnight work, coming up (uses Daily Check's and Compliance's data; no new back end) | 4 d | Low |
| Client Home: money tiles, Do next ranking, chart, overnight work (money in and out from bank lines plus the books; GST and TDS due from existing registers) | 5 d | Medium: needs a clear rule for "money in" (bank receipts vs the sales register); it must agree with MIS |
| One list part (chips, bulk bar, row expand, totals, empty state, skeleton, phone cards) on Bank, Purchase and Sales, then Clients, To-dos and the GST registers | 7 d | Medium: the five filter parts are retired one page at a time |
| Empty states for every list (one sentence and one action) | 2 d | Low |

### Phase 3: the entry form and the phone (about 3–4 weeks)
| Item | Effort | Risk |
|---|---|---|
| A manual voucher form (bill, sale, receipt, payment, journal, contra) with live Dr/Cr, a GST auto-split by state, and TDS auto-suggest by section, threshold and party type, posting through the existing engine and bridge | 10 d | **High**: new accounting rules (reverse charge, SEZ, 194Q and 206C(1H) edge cases) need CA sign-off and tests; posting must match Tally exactly |
| Phone: a 56 px top bar, the same 5 bottom tabs everywhere, + New on the phone, a full pass over phone cards | 4 d | Low–Medium |
| Tally keys (F4–F9) inside FinCom (see decision D4) | 1 d | Low |

### Phase 4: polish (about 2 weeks)
| Item | Effort | Risk |
|---|---|---|
| Optimistic updates with Undo for post, confirm, link and mark as filed, and a rollback that gives a reason | 4 d | Medium: needs care with the posting queue's own states |
| A words pass on every page: ≤ 40 words before the first table, help behind Details, verb-first buttons, no "…first" toast without a button | 3 d | Low |
| Dark mode and contrast audit of the new parts; keyboard path through every new pattern | 2 d | Low |

---

## 8. What needs the owner's decision

| # | Decision | Options | Proposal |
|---|---|---|---|
| D1 | **The 7 client menu items** | (a) Home, Bank, Purchase, Sales, GST · TDS · ITR, Books, Tally; (b) merge Purchase and Sales into one "Bills & invoices" item and give MIS its own place | (a) |
| D2 | **The five status words** | New / To review / Ready / Done / Problem. Keep "In Tally" as its own word, or use "Done · in Tally"? | "Done · in Tally" |
| D3 | **Daily Check** | Keep it as a firm menu item, or fold it entirely into Home's to-dos | Keep it for now; Home shows its top items |
| D4 | **Tally keys** | F9, F8 and so on as FinCom shortcuts. Browsers use F5 for reload, so either Alt+F5 etc., or show the keys only as labels in + New | Labels in Phase 1; Alt+F-keys in Phase 3 |
| D5 | **"Money in / out" on Client Home** | From bank lines (cash basis), or from the books (sales and purchase registers) | Bank lines on the tile, books in MIS; the tile says which |
| D6 | **The Bank page's own rail** (approved earlier) | Drop it for the common menu, or keep it on Bank only | Drop it: one menu everywhere |
| D7 | **The manual voucher form** (Phase 3) | Build full entry in FinCom, or keep FinCom as "bring in, review, post" with Journal only | Build it: it is what makes FinCom feel like accounting software, not only a review tool |
| D8 | **Compact rows for accountants** | One row height (44 px) for all, or a "Compact" choice (36 px) in Settings | Offer the choice; default to 44 |
| D9 | **Order of rollout** | Phase 1 in one release, or item by item behind a "New look" switch for the firm | Item by item, with the switch, over 3 weekly releases |

---

## 9. What this branch contains

- `app/src/proposal/` holds the mockups (React, made-up data, own Vite config). Nothing in the live app imports them, and `app/index.html` does not reach them.
- `docs/UX-QUICKBOOKS-OF-INDIA.md` is this plan.
