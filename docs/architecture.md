# FinCom: architecture

FinCom is one HTML page that runs in the browser. It reads a client's books from Tally, works out TDS and GST returns, audits the books, and produces MIS. A small PowerShell program, the **Tally Bridge**, runs on the computer with Tally and lets the page talk to Tally. A Supabase project holds firm accounts, shared data and paid services.

```
 Browser: FinCom (index.html)  ──HTTP 127.0.0.1:9100──▶  Tally Bridge (TDSBridge.ps1)  ──XML──▶  TallyPrime (port 9000)
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
| `05-tally-ledger-master.js` | `LedMaster`: what each GST and TDS ledger is, guessed from Tally and the day book, confirmed by the user. Also what FinCom posts to, templates across clients, and a copy of the master at each filing. |
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

## 2B & ITC (next-itc-simple, 24-Oct-2026)

Three tabs: **Input register** · **2B reconciliation** · **Final credit for 3B** (the ITC follow-up and Supplier health pages are gone; the follow-up is part of the reconciliation, its letters "Write to suppliers").

- **Lines** (`app/src/lib/itcFinal.js`, `ITCF`): every document `GST2B.run(reg)` pairs or leaves over, its chip in the month (Matched · In books, not in 2B · In 2B, not in books · Amount differs · Rejected/Pending in IMS · Carried forward) and one **Decision**: Take now · Take in a later month (with the month) · Take now though not in 2B · Follow up with supplier · Ask supplier to correct · Reverse / do not take · Book in Tally. A line nothing is decided on follows the rule 3B always had (bills not in 2B held back, a bill in a later 2B taken then, the lower of books and 2B, a supplier's credit note in 2B taken off, rejected in IMS not taken). A line not taken is carried forward month to month until taken or dropped.
- **One store** (`app/src/lib/itcSync.js`, `ITCDec`): `books.itcDec["<reg>|<line key>"] = {d, ym, note, at, by}` (in `BOOKS_KEYS`, one server item a line). The earlier `reco2b.tag` remarks and `itcTrack[reg].dec` decisions are read as decisions; the latest of the three wins.
- **3B**: `GSTR.threeBm` is wrapped: 4(A)(5) = the books' input tax of the month + each line's effect ((credit month = M ? amount : 0) − its books tax of M) + reclaimed + adjustments; adjustments (`books.itcAdj`, add / change / remove with a reason, kept in the trail) go on their own line (4(A)(1), (2), (3), (5), 4(B)(1), (2), 4(D)(2)); the payment is worked out again. The Final credit tab, the GSTR-3B screen and its JSON read this one figure.
- **Eligibility** (next-itc-excel-edit): each line's Eligible? (Eligible · Ineligible 17(5) · Not ours) is as the books have it (a bill marked ineligible in Tally, a 5% tour operator's bill) unless a person sets it (`itcDec[...].el`), on the Input register's bill or the 2B line, in the app or the Excel. Ineligible: the credit taken that month is reversed in 4(B)(1); Eligible on a bill Tally marks 17(5): that reversal is taken back; Not ours: not taken at all.
- **Excel** (`app/src/screens/gst/itcExcel.js`, ExcelJS, no macros; the Input register sheet editable too: Eligible?, ITC to take, Take in month, Note): Input register, 2B reconciliation (hidden key, locked data, Decision and month lists, formulas for the credit month and the month's ITC), Adjustments, Final credit for 3B (table 4 by formulas, the same rule), Summary, Write to suppliers, About. Upload Excel: a preview (decisions, notes, adjustments, the Excel's table 4 against FinCom's), Apply makes the file's decisions and adjustments FinCom's; an unknown key is refused.
- **Automatic matching** (`src/js/85`, `server/_shared/match2b.js`) runs silently: its AI pairs are pairs of `GST2B.run` (an "AI" tag on the line); "Match again" is under the tab's ⋯. Rules: the same GSTIN and number, dates in the same financial year, the tax within ₹1 each head: matched; a date or taxable value differing is a note on the line.

## GSTR-1 Excel: download, change, bring back (next-gstr1-excel, 24-Oct-2026)

GSTR-1's card has **Download Excel** and **Upload Excel** (`app/src/screens/gst/R1Excel.jsx`) beside its other actions (the words from 1600 px, an icon each from 1400 px; narrower, in the card's More, so the actions stay on one line), and **Undo upload** after one.

- **The workbook** (`app/src/screens/gst/r1Excel.js`, ExcelJS, no macros): a sheet a portal table with the offline tool's sheet names and column heads (b2b,sez,de · b2cl · exp · b2cs · exemp · cdnr · cdnur · b2ba · b2cla · expa · cdnra · cdnura · b2csa · at/atadj when the advances switch is on · hsn(b2b)/hsn(b2c), or hsn before Jan-2025 · docs · eco when there are operator sales), one Excel Table each, a row a document and rate. Every field is open; the hidden Key column names the line of the books (blank: added in Excel). Lists to the last of the spare rows (2,000 on the document and HSN sheets): place of supply, rate, invoice type, reverse charge, note type, UQC and the other codes. Formulas by structured reference (`T_b2b[[#This Row],[...]]`, so inserting or deleting rows never breaks them): the state from the GSTIN, a Check column (tax vs taxable × rate, value vs taxable + tax, place of supply vs the GSTIN's state); on the spare rows the tax itself (IGST, or CGST and SGST, from the place of supply against the registration's state). **Summary**: rows and totals per tax head per table by formulas over the Tables (as the GSTR-1 screen adds them: 9B as listed, 9C's credit notes less), HSN against tables 4 to 9, documents issued against the invoices listed. **About**: client, GSTIN, month, format.
- **The store** (`app/src/lib/gstr1Fix.js`, `R1Fix`): `books.r1Fix["<reg>|<yyyymm>"] = {cur: {mods: {lineKey: {field: value}}, dels: {lineKey: 1}, adds: [{id, t, f}], skip: {...}}, vers, log}` (in `BOOKS_KEYS`: one synced item a month; never written to Tally). A row deleted in Excel is excluded from GSTR-1, never deleted from the books. An amendment row (9A, 9C, 10), or a document missed earlier and reported now, taken out of the file is `GSTAmend`'s own choice `books.amendFix[id] = "skip"` (the store the amendments screen already had: reused). Each upload keeps the state before it (`vers`); **Undo** puts back the whole upload.
- **Where it is read**: `GSTR.toJson` is wrapped: the month's JSON is laid out as lines (keys from the books' JSON), the corrections laid over, the JSON put together again; the GSTR-1 screen (`portal.js` reads the JSON), the JSON for the portal, IFF and a QRMP quarter's GSTR-1 (the months' corrected tables together) all read it. `GSTR.threeBm` is wrapped too: the change to the JSON moves 3.1(a) (b) (c) (e) and 3.2 (`t.r1Fix`, a line in the 3.1 windows), the payment again; the carried credit is worked out again when the store changes. With no corrections nothing runs. Loaded in its own file (the first file is at its budget): fetched at boot and by the GST screen.
- **Upload**: the preview lists per table the rows added, left out and each field changed (now → Excel), the errors in words (GSTIN check digit, place of supply against the tax heads, a rate that is not a GST rate, tax not taxable × rate within ₹1, a number over 16 characters or with other characters, a number used twice or in another month of the year, HSN and UQC, a hidden key edited): Apply refused until fixed; the warnings (a date outside the month, the place of supply against the GSTIN's state) need a tick. Each table's totals: the Excel's Summary, FinCom's now and after Apply. A row without a key exactly like an entry added before is that entry (the same file twice changes nothing). Tests: `tests/run_gstr1_excel.js`, `tests/run_gstr1_excel.py`.

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

## The books in the cloud, and the FinCom Connector (bridge 1.13.0)

```
 TallyPrime ──XML──▶ Tally Bridge (keep in step: a few days at a time, then only changes)
                        │ changed days (gzip), ledgers, state ─── HTTPS, x-fincom-device key ───▶ tally-ingest (edge function)
                        │                                                                          │  checks the key (hash in tally_devices),
 FinCom Connector ──────┘ keeps the bridge running, shows it, updates it, sends its log             │  the company's link to a client (tally_companies)
 (Windows app)                                                                                      ▼
                                                   storage tally-days/<firm>/<book>/<yyyymm>/<day>.xml.gz   tally_vouchers, tally_lines,
                                                                                                    tally_ledger_day (ready totals), tally_ledgers
 FinCom (any computer or phone) ◀── tally_tb, tally_ledger, tally_status, tally_days_list (members of the firm only)
```

- **Load on Tally** (`bridge/keep.ps1`): every request to Tally is timed; the worker keeps its share of each Tally's time under
  `KeepSharePct` (10% in office hours, `KeepNightSharePct` 40% outside them). Each turn first asks Tally's own change counters
  (`TDSDeskKeepCo`: the company's AltVchID and AltMstID); when neither moved, nothing else is asked. Changes are looked for in the last
  three months every turn and in the whole period only when the counter says so. Slow and failed requests go in the log with their time;
  `sync/keep-load.json` has each Tally's share and each kind of request's average and slowest time.
- **Sending** (`bridge/cloud.ps1`): each day written to the copy is queued in `cloud-out.txt`; the queue goes in batches of about 3 MB,
  ledgers first, only for companies the cloud says are linked; nothing is lost without internet (the queue waits, with back-off).
  The computer's key (made in FinCom, Settings, Books in the cloud) is kept with Windows DPAPI for the signed-in user.
- **Cloud** (`server/tally-cloud/`): `migration.sql` (tables, row-level security, functions), `index.ts` (tally-ingest), `parse.js`
  (the day book read by FinCom's own rules; `tests/run_cloud_parse.mjs` checks it gives FinCom's figures on real books). One *book* per
  Tally company, so a client that keeps one company per year in Tally has a book a year; `tally_pick` chooses the book for a date.
- **FinCom** (`src/js/49-tally-cloud.js`, `TCloud`): Settings, Books in the cloud (connect this computer, remove one, link companies);
  Look up and Reports load the cloud copy when this computer has no bridge for the company, downloading only days that changed (kept in
  IndexedDB as `tcday:<book>:<day>`); a company of more than 60,000 entries is not loaded: its trial balance and ledgers come from the
  cloud's ready totals.
- **FinCom Connector** (`connector/`, C# for the .NET Framework 4.8 in Windows, built with Mono's `mcs` by `connector/build.sh`, published
  by `connector/publish.py` to `assets/connector/` with `latest.json`): installs into the bridge's folder for the Windows user, starts with
  Windows, runs the engine hidden and starts it again when it stops or stops answering (back-off; a script blocked by Windows or an
  antivirus is recognised and explained), checks Tally, the company, the cloud, disk and internet, shows the companies and the log, updates
  the engine and itself only with files matching their SHA-256 (and goes back when a new one does not start), and sends its log and
  details (no keys) to the `tally-support` bucket. `tests/run_connector.py` runs its self-test under Mono and opens its window on a virtual screen.
