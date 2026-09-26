# TDS Desk: architecture

TDS Desk is one HTML page that runs in the browser. It reads a client's books from Tally, works out TDS and GST returns, audits the books, and produces MIS. A small PowerShell program, the **Tally Bridge**, runs on the computer with Tally and lets the page talk to Tally. A Supabase project holds firm accounts, shared data and paid services.

```
 Browser: TDS Desk (index.html)  ──HTTP 127.0.0.1:9100──▶  Tally Bridge (TDSBridge.ps1)  ──XML──▶  TallyPrime (port 9000)
        │                                                        │
        │ HTTPS                                                   └─ nightly copy folder (day books, balances, ledgers)
        ▼
 Supabase: auth, firms, clients, records, wallet, storage buckets, edge functions (gateway, admin, signup)
```

## Where things are

| Path | What it is |
|---|---|
| `src/shell.html` | The page itself: `<head>`, the empty layout, and two placeholders, `{{CSS}}` and `{{JS}}`. |
| `src/css/app.css` | All the styles. |
| `src/js/NN-*.js` | The program, one file per part, joined in the order of `src/js/ORDER.json`. |
| `build.py` | Joins them into `site/index.html` (live) and `site-test/index.html` (test). |
| `build/test-style.html` | The orange TEST mark, added only to the test build. |
| `assets/` | Libraries loaded on demand (xlsx, pdf.js, Tesseract) and the bridge setup file. |
| `bridge/` | The Tally Bridge: `TDSBridge.ps1` (1.10.0), `additions.ps1` and `merge.py` (how 1.10 was made from 1.8.1), `ps5check.ps1` (refuses PowerShell 7-only syntax). |
| `tests/` | Rule tests on real books (Node), screen tests (Chromium through Playwright), bridge tests (PowerShell against a stand-in Tally). |
| `docs/` | This file, the test-writing guide and the setup guide. |

The source is kept in its **live** form. The test build differs only in browser storage names (`tdsdesk:` becomes `tdsdesk-test:`, and the two databases get `-test`), the TEST mark, and `APP_VERSION` starting with `TEST · `. `build.py` stops if any of these creep into the source.

## The program, part by part

Everything is plain JavaScript in one scope, no framework and no bundler. State lives in one object `S`; `render()` redraws the screen from it; clicks, typing and changes go through three document-level listeners that look at `data-*` attributes (`data-act="…"` for buttons, and one attribute per kind of choice).

| File | Holds |
|---|---|
| `00-core.js` | Rules and rates (`RULE_DEFAULTS`), storage (`lsGet`, IndexedDB), helpers (`num`, `r2`, `esc`, `fmtDate`), the state `S`, the purchase and bank posting logic, the shared layout. |
| `04-the-client-s-books-read-from-tally.js` | `Books`: reads the Day Book and ledger masters (XML, UTF-16 or UTF-8), keeps each voucher as `{id, date, type, no, ref, party, gstin, cmp, ent: [{l, a, r, b, c}], …}`. `a` is Tally's sign: a debit is negative. `b` holds bill-wise allocations, `c` cost centres. `Books.lines(v)` reads one voucher into value, tax by head, TDS and so on, by what each ledger is. |
| `05-tally-ledger-master.js` | `LedMaster`: what each GST and TDS ledger is, guessed from Tally and the day book, confirmed by the user. Also what TDS Desk posts to, templates across clients, and a copy of the master at each filing. |
| `06-audit.js` | `Audit`: rule-based checks, each returning findings with the problem, effect, recommendation, suggested journal entries and the vouchers behind it. Result codes, items put right, the final report, the Form 3CD draft. |
| `07-mis.js` | `MIS`: profit and loss by Tally group, ageing bill by bill, sales and purchases, cash flow, the 13-week forecast, ratios, cost centres, budget. |
| `08-gstr-9-and-gstr-9c.js` | `GST9`, `GST9C`: the year from the monthly figures. |
| `09-tds.js` | `TDS`: deductions, challans, interest and late fee, the 26Q and 24Q screens. |
| `10-…2b…` | `GST2B`: 2B against the purchase side of Tally, matched in tiers from certain to probable. |
| `12-gstr-1-and-gstr-3b…` | `GSTR`: outward and inward rows per month and registration, GSTR-1, 3B, their JSON. |
| `13`–`15` | Amendments (`GSTAmend`), advances (`GSTAdv`), ITC reversal (`GSTRev`). |
| `16`–`18` | The 26Q text file for the FVU, 24Q, certificates. |
| `41-books-sync.js` | `BookSync`: each client's TDS and GST work kept in the firm's database (below). |
| `19`–`27` | Document inbox, bank statements, written rules, column filters, the Tally Bridge client (`Bridge`, `TallyRead`), sales and marketplaces, the firm account. |

## Rules the code keeps

1. **Rules, not guesses.** Every figure comes from a fixed rule on the books, so the same books always give the same result. Audit and MIS runs carry a result code (a hash of the findings or figures); it changes only when the books change.
2. **Confirmed ledgers only for filing.** A return file (GSTR-1 JSON, 3B JSON, 26Q text, FVU) is made only when every GST and TDS ledger it uses is confirmed on the Tally ledgers tab.
3. **A voucher's registration comes from its tax ledgers**, not from the GSTIN Tally stamps on the voucher, which is often wrong in multi-registration companies.
4. **Tally's sign throughout:** in `ent`, a debit is negative and a credit positive. Foreign-currency amounts are read as the rupee value after the last `=`.
5. **Nothing is deleted without a trace.** Inbox records only change status; the bridge's FVU runs each get their own folder.
6. **Live stays untouched until test is checked.** Build, run the tests, push to the test site, check against the ZZ TEST company, then copy the identical build to live.

## GST: what each return is built from (build 134)

- **Lines.** The day book reader keeps, on every ledger line, the HSN (`h`), the GST rate (`gr`, the IGST rate from the rate details) and goods or services (`sp`): from the item for an item invoice, from the ledger line for a ledger invoice. `Books.lines(v).parts` splits a voucher rate by rate and HSN by HSN; the tax on the voucher is shared in proportion to what each part should carry, so the parts always add up to the voucher. A line with no rate takes whatever tax the rated lines do not explain.
- **Outward.** One row per invoice (`GSTR.outward`), with its parts. GSTR-1 items, B2CS, the HSN summary and 9C table 9 are built from the parts (`GSTR.partsOf`).
- **Inward.** `GSTR.inward` takes every purchase bill and every journal or payment that carries input tax, except the month's set-off (output tax on the same voucher) and tax only moved between ledgers (to a control account, or a rounding). This one list is 3B table 4, the input register and GSTR-9 table 6.
- **Reverse charge.** A voucher is reverse charge when Tally marks it so, or when it credits a ledger of type "GST, reverse charge" on the output side (a name like "07 RCM PAYABLE"). That credit is the liability (3.1(d)), not tax on the bill; the input tax beside it is 4(A)(3). A tax-only RCM journal gets its value from the rate in the narration, else 18%, marked as worked out.
- **Payment.** `GSTR.setOff` follows sections 49 and 49A with rule 88A. Reverse charge is paid in cash. Credit left over is carried to the next month (`GSTR.creditIn`), starting from the balance typed for the first month in the books (`books.gstOpen[reg]`).
- **Bank ledgers** are decided by the Tally group (Bank Accounts, Bank OD A/c, Bank OCC A/c, Cash-in-Hand), by name only where the masters have not been read.

## ITC follow-up (build 139)

`src/js/32-itc-follow-up.js` (`ITCT`). The list is never stored: `ITCT.items(reg)` works it out every time from `GST2B.run(reg)` (Tally's documents against every 2B brought in). Only what a person adds is kept, in `books.itcTrack[reg]`: `dec[key]` (the decision and note on a line), `sent[supplier]` (dates written to) and `contact[supplier]` (email, phone). Keys are the supplier's GSTIN (or name), the normalised document number and its direction, so a decision follows the bill from month to month and survives the day book being read again. A bill is judged only against the 2B of its own month; bills of months with no 2B here are "not checked yet". 3B on the 2B basis holds back bills not in 2B, takes the lower of Tally and 2B where they differ, and applies a supplier's credit note found in 2B unless it is marked rejected in IMS.

## Column filters on every table (build 137)

`src/js/31-grid-filters.js` (`GridF`) runs after every render and gives each `table.bk-table` a funnel on each heading, unless the table already has its own filters (bills, bank, sales: those use `colHead` in `23-column-filters.js`) or carries the class `gf-off`. It works on what is drawn: a column's values come from the first line of each cell, a column is treated as amounts when its heading has class `n` or nine in ten of its cells are numbers. Only data rows (one cell per heading, none spanning) are filtered; totals and section rows stay. The filter is kept in `S.gridF`, keyed by the screen (every `...Tab`, `...Part` and `...Scope` in `S`) and the table's headings, so it survives the screen being drawn again. A table with more than 18 rows scrolls inside its own box with the heading fixed (`gf-scroll`). A table that shows only its first rows is filtered on those rows only, so tables meant to be filtered should draw all of them.

## The Tally Bridge

`bridge/TDSBridge.ps1`, version 1.10.0, runs under Windows PowerShell 5.1, listens only on 127.0.0.1:9100, and needs the key shown in its window for everything except `/ping`. It finds which Tally (port) has the company open, in the signed-in Windows user's session.

| Address | Does |
|---|---|
| `/status`, `/companies`, `/diagnose` | What is open and reachable |
| `/ledgers`, `/vouchers`, `/ledgervouchers` | Masters and vouchers as JSON |
| `/daybook?from&to` | The Day Book as Tally exports it, three months at most at a time |
| `/balances?from&to` | Each ledger's balance at the day before and at the end |
| `/import`, `/unpost` | Posting entries into Tally, and taking one back |
| `/fvu` | Runs Protean's FVU on the 26Q text; returns `accepted`, the `.fvu` path and the error file |
| `/synced`, `/syncfile`, `/syncnow`, `/schedule` | The nightly copy: its list, its files, a copy now, and the Windows scheduled task |

`TDSBridge.ps1 -Sync` is what the scheduled task runs: it copies each open company's day book month by month, balances and ledgers into `sync/<company>/`, then stops.

## Supabase

Live project `nrtczucrlgalvtojwoes`; staging `qbocskaiewaxqcvaunzc` (ap-south-1) has the same 14 migrations, the nightly backup at 19:30 UTC, the `client-docs` and `doc-inbox` buckets, and the `gateway`, `admin` and `signup` functions. Row-level security keeps each firm to its own rows (`my_firm()`); a superadmin (`platform_admins`) sees all. Paid calls to Claude and Google Vision go through `gateway`, which checks the plan and balance and charges before calling.

Known issue on both: the gateway's refund calls `exec_refund`, which does not exist, so a failed provider call records the refund but does not restore the balance. `refund_charge` does both and should be called instead.

## Shared TDS and GST work (build 156)

Until build 155 everything under a client's books lived only in the browser that did it (IndexedDB `books:<cid>`), so two staff on one client could see different challans, 2B and returns filed, and a cleared browser lost the work.

Now the **work** part of the books (every key in `BOOKS_KEYS` except what is read from Tally: `vouchers`, `meta`, `under`, `states`, `groups`, `groupInfo`, `ledInfo`, `ledInfoAt`, `tb`, `mis`) is kept in Supabase, table `client_books`, one row per client, with a revision number. `server/books-sync/migration.sql` makes it.

- **Saving.** `saveBooks()` still writes this browser's copy, then `BookSync.schedule(cid)` sends the work 1.5 s later through `save_client_books(client, part, base, data)`. The save names the revision it was built on; the database refuses it if someone saved since.
- **A refused save** is merged three ways (`BookSync.merge`: what both started from, this browser, the database). Changes to different things are both kept; lists of items with an `id` (challans, certificates, assets) merge item by item; where both changed the same value the database's stays, this browser's whole copy goes to `client_books_history` with note `conflict`, and the person is told who changed what.
- **Receiving.** Opening a client's books, and every firm sync (45 s), fetch the row; a newer revision is merged in the same way.
- **History.** Every replaced revision is kept in `client_books_history`; the nightly `take_backup` now includes `client_books`.
- **Who may save.** Only through the function, only for one's own firm, only owner and staff (`can_write()`); look-only members read.
- **Without the migration** (or signed out) `BookSync` switches itself off and the books work in this browser as before; a line under the books' tabs says so.
- `BookSync.st` keeps, per client, the revision and copy last agreed with the database, also in IndexedDB as `booksync:<cid>`.
