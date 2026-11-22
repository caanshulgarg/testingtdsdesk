# FinCom as a full accounting system: plan and design

**Status:** PLAN + DESIGN ONLY, for the owner's review (the owner approved starting the plan and design on 22-Nov-2026).
No production code path, migration, edge function or bridge file changes on this branch. The only code is the mockups.
**Branch:** `next-full-books`, off `origin/next-ux-proposal` (08587a33a), which is off `origin/staging-next` @ d580e8451.
**Mockups:** `app/src/proposal/books.jsx` and `books.css`. These are standalone pages with made-up data, built and opened as
the rest of the proposal (`docs/UX-QUICKBOOKS-OF-INDIA.md`). Use `index.html?s=<screen>` with `books-mode`, `books-coa`,
`books-invoice`, `books-daybook`, `books-ledger`, `books-tb`, `books-audit`, `books-zoho` or `books-move`, and add `&phone`
for a phone layout.

**The owner's standard, applied to every line below: exact or nothing.**
- Every voucher has Dr = Cr to the paisa, or the database refuses it.
- The trial balance always ties.
- Every report is recomputed from the vouchers, never from a stored total that could drift.
- A figure FinCom cannot prove is never shown as a figure.

---

## 0. In one page

1. **Three modes per client.** These are **Own books** (FinCom keeps the books), **Tally** (today's path, unchanged) and
   **Zoho Books** (today's `server/zoho-books` path, extended).
2. **One "books provider" interface.** Every feature asks it for masters, vouchers, balances and bills, and asks it to post.
   There are three providers. The Tally provider is today's code behind the interface, line for line.
3. **The own books live in new tables (`fb_*`), add-only, beside the Tally tables.** In phase 1 they also write a
   **projection** into the existing cloud-copy tables (`tally_books`, `tally_vouchers`, `tally_lines`, `tally_ledgers`,
   `tally_groups`, `tally_bills`, `tally_ledger_day`) marked `source = 'own'`. This is exactly what migration 75 already does
   for Zoho (`source = 'zoho'`). As a result, GST, TDS, MIS, the balance sheet, Daily Check, Look up and ITR work for an own-books
   client on day one, with no change to their code.
4. **The audit trail is written by the database, not the app.** Every change to an `fb_*` row writes an edit log row
   (who, when, before, after), chained by SHA-256. There is no setting that switches it off. This answers the proviso to
   Rule 3(1) of the Companies (Accounts) Rules, 2014.
5. **Moving a client from Tally is a verified copy.** FinCom copies the masters, the opening balances and the vouchers. It then
   proves the trial balance, the voucher counts, the bill-wise outstanding and the GST figures tie to the paisa. The switch
   button is disabled while a single difference remains.
6. **Independent Books** (idpbook.com) is MIT-licensed (verified). FinCom ports its bill-wise, GST-split and parsing rules and
   its test cases, with attribution. It does not take its storage, numbering or history, which would fail the audit-trail and
   retention rules (section 11).
7. **Effort:** about 36–48 engineer-weeks over six phases (section 9). Phase 1 alone (the ledger engine, the audit trail and
   the three core reports) is about 7–9 weeks.

---

## 1. What exists today (read from `staging-next` @ d580e8451)

| Piece | Where | What it means for this plan |
|---|---|---|
| Cloud copy of Tally books | `server/tally-cloud/migration.sql` and its later migrations: `tally_books`, `tally_ledgers` (gstin, pan, tds_deductee_type, …), `tally_groups`, `tally_vouchers` (vtype, vno, party, irn, eway_no, gst_* …), `tally_lines` (ledger, amount), `tally_bills`, `tally_ledger_day` | Every report already reads this shape. The own books **project into it** (as Zoho does) and do not replace it. |
| `source` column | migration 75 adds `source` ('tally' default, 'zoho') to `tally_books`, `tally_vouchers`, `tally_ledgers` | A third value, `'own'`, is all the reads need. |
| Cloud figures | migrations 151/152 (`tally_calc_bal`, `tally_balances_at`, `tally_tieout`, `tally_ageing`) | The trial balance, the tie-out and the ageing are already worked out on the server from the copy. Own books reuse them through the projection. |
| One set of entries for returns | `src/js/67-book-sources.js`, `server/_shared/gst3b.js` (`BookSrc`) | GST and TDS read one merged entry list. The own provider feeds the same list. |
| Posting to Tally | `src/js/24-tally-bridge.js` (`Bridge.post`), `tally_post_jobs` (migration 5), the post register (migrations 111, 132, 200, 203) | This path does not change. It becomes `TallyProvider.post`. |
| Zoho Books | `server/zoho-books/index.ts` + `map.js`, migration 75 (`zoho_grants`, `zoho_connections`, `zoho_sync_state`, `zoho_seen`, `zoho_posts`, …), `src/js/74-zoho-books.js` (`ZohoB`) | Already reads a Zoho organisation (India DC) into the copy and posts bills, expenses and journals (POST only, never PUT or DELETE). The Zoho mode **extends** this and does not start over. |
| Closed periods | `src/js/47-closed-periods.js` (warns and asks), `tally_month_lock` (recorder, migration 44) | For Tally this stays a warning, because Tally is the master. For own books the lock is **enforced by the database**. |
| Sales invoice and e-invoice | `src/js/26-sales-invoice.js` (`invoiceHtml`), `src/js/55-einvoice.js` (`EINV`, INV-01 v1.1 through `gst-taxpro`) | The own-books invoice reuses both. The IRN, ack and QR land on the own voucher. |
| Roles | `members.role` ('owner', 'staff', …), `my_firm()` row-level security | Today roles are firm-wide. Corporate clients need roles per book and per branch (section 6). |

---

## 2. Data model for FinCom's own books

All of it is **add-only**. These are new tables with the prefix `fb_` ("FinCom books"), in new migrations numbered when built
(per `docs/MIGRATION-ORDER.md`). No existing table, column or function changes, apart from the new value `'own'` in the
`source` text columns, which have no check constraint. The tables use row-level security like the copy:
`firm_id = my_firm()` to read. Nobody writes directly; every write goes through `security definer` functions, which check the
member's role on that book.

Money is `numeric(18,2)` everywhere, never float. A line's amount is signed: **Dr is positive and Cr is negative**, as in
`tally_lines`, so "balanced" means `sum(amount) = 0`.

### 2.1 The company, its years and its registrations

| Table | Key columns | Notes |
|---|---|---|
| `fb_books` | `book_id` (uuid, also the `tally_books.book_id` of its projection), `firm_id`, `client_id`, `legal_name`, `constitution` (company, LLP, firm, proprietor, trust, …), `cin_llpin`, `pan`, `tan`, `sch3_division` ('I' AS, 'II' Ind AS, 'III' NBFC), `books_begin` (date), `currency` 'INR', `state` (setting_up, live, read_only, archived), `created_by/at` | One per client in own mode. `state = read_only` is used after archiving, or when the audit check fails (section 2.6). |
| `fb_years` | `book_id`, `fy` ('2026-27'), `starts`, `ends`, `status` (open, closing, closed), `closed_by/at` | The year's closing entries (P&L to reserves) are an ordinary voucher, made by a function. |
| `fb_registrations` | `id`, `book_id`, `gstin`, `state_code`, `reg_type` (regular, composition, SEZ unit, ISD, casual, non-resident), `legal_name`, `trade_name`, `valid_from/to`, `einvoice` (bool), `eway` (bool), `branch_id` | One row per GSTIN. A company with 6 states has 6 rows. |
| `fb_branches` | `id`, `book_id`, `name`, `registration_id`, `address`, `is_head_office`, `ho_control_ledger_id` | A branch can share a GSTIN (two offices in one state) or have its own. |

### 2.2 Chart of accounts with Schedule III groups

`fb_groups` has these columns:
- `id`, `book_id`, `parent_id`, `name`;
- `nature` (asset, liability, equity, income, expense);
- `sch3_code`;
- `affects_gross_profit`, `is_system`, `sort`.

Every new book starts with a **seeded tree**. It has Tally's 28 primary groups, so a Tally user finds them where they
expect. Each group carries a `sch3_code`, so the balance sheet and P&L in the Schedule III format come from the groups, with
no mapping step. A user may add sub-groups. A sub-group inherits its parent's `sch3_code` unless it is set to a finer one.

| Tally primary group (seeded) | `sch3_code` (Division I) | Schedule III line |
|---|---|---|
| Capital Account | `EQ.SC` / `EQ.OE` | Share capital / Other equity (by sub-group: Reserves & Surplus → `EQ.OE`) |
| Loans (Liability) → Secured / Unsecured | `NCL.BOR` or `CL.BOR` | Borrowings (non-current or current: set on the ledger, `maturity`) |
| Current Liabilities → Sundry Creditors | `CL.TP` | Trade payables (with the MSME split: `CL.TP.MSME` / `CL.TP.OTH`, from the ledger's Udyam data) |
| Current Liabilities → Duties & Taxes | `CL.OCL` | Other current liabilities (GST and TDS payable) |
| Current Liabilities → Provisions | `CL.PROV` | Short-term provisions |
| Fixed Assets | `NCA.PPE` | Property, plant and equipment (with `NCA.INT` and `NCA.CWIP` as sub-groups) |
| Investments | `NCA.INV` / `CA.INV` | Investments |
| Current Assets → Sundry Debtors | `CA.TR` | Trade receivables |
| Current Assets → Stock-in-hand | `CA.INVT` | Inventories |
| Current Assets → Bank Accounts, Cash-in-hand | `CA.CASH` | Cash and cash equivalents |
| Current Assets → Loans & Advances (Asset), Deposits | `CA.LA` / `NCA.LA` | Short- / long-term loans and advances |
| Sales Accounts | `PL.REV` | Revenue from operations |
| Indirect Incomes | `PL.OI` | Other income |
| Purchase Accounts, Direct Expenses | `PL.COGS` / `PL.PUR` | Cost of materials consumed / Purchases of stock-in-trade |
| Indirect Expenses | `PL.EMP`, `PL.FIN`, `PL.DEP`, `PL.OTH` | Employee benefits, Finance costs, Depreciation, Other expenses (by sub-group) |
| Suspense A/c, Branch / Divisions | `X.SUSP`, `X.BRANCH` | Must be nil in a final balance sheet (FinCom flags any balance) |

The exact code list is in the build's seed file. The table above is the design. For Ind AS books (Division II) the same
groups map to Division II codes. This is owner decision D6.

`fb_ledgers` has these columns:
- `id`, `book_id`, `group_id`, `name`, `alias`, `code`;
- `kind` (party, bank, cash, gst_tax, tds_tax, income, expense, asset, stock, capital, other);
- party fields: `gstin`, `pan`, `state_code`, `gst_reg_type`, `country`;
- TDS fields: `tds_section_default`, `tds_deductee_type`, `lower_cert_no`;
- `msme_udyam`, `msme_type`;
- `bill_wise`, `credit_days`, `cost_centres_on`;
- bank fields: `bank_ifsc`, `bank_acct_masked`;
- `maturity`, `inactive`, `created_by/at`.

Every party ledger that carries a GSTIN gets two checks: the GSTIN's checksum, and its first two digits against
`state_code`.

`fb_openings` has the columns `book_id`, `fy`, `ledger_id` and `amount` (signed). The openings of a year must sum to
zero, or the year cannot be opened. FinCom has no "Difference in opening balances" line. It refuses to open the year instead.

### 2.3 Vouchers and lines

| Table | Columns |
|---|---|
| `fb_vtypes` | `id`, `book_id`, `base` (sales, purchase, receipt, payment, journal, contra, credit_note, debit_note, delivery_note, receipt_note, stock_journal, memo), `name` ("Sales – Delhi", "Export sales"), `approval_rule_id`, `inactive` |
| `fb_series` | `id`, `book_id`, `vtype_id`, `registration_id` (a series belongs to one GSTIN), `fy`, `prefix`, `suffix`, `width`, `next_no`, `restart_yearly` |
| `fb_vouchers` | see below |
| `fb_lines` | `voucher_id`, `line_no`, `ledger_id`, `amount` (signed), `narration`, `cost_centre_id` (null when split), `tax_kind` (cgst, sgst, igst, cess, tds, tcs, null), `tax_rate`, `taxable_value`, `hsn_sac`, `tds_section`, `tds_base` |
| `fb_line_cc` | `voucher_id`, `line_no`, `cost_centre_id`, `amount`. When a line is split, the parts sum to the line. |
| `fb_bill_refs` | `voucher_id`, `line_no`, `party_ledger_id`, `ref_type` (new, against, advance, on_account), `ref_name`, `amount`, `bill_date`, `due_date` |
| `fb_cost_categories`, `fb_cost_centres` | `id`, `book_id`, `parent_id`, `category_id`, `name`, `inactive` |

`fb_vouchers` has these columns:
- `id` (uuid), `book_id`, `fy`, `vtype_id`, `series_id`, `number`, `date`;
- `branch_id`, `registration_id`, `party_ledger_id`, `ref_no`, `ref_date`, `narration`;
- `status` (draft, pending, posted, cancelled), `version` (int);
- the `gst` block (jsonb): place of supply, reverse charge, nature, export / SEZ, port, shipping bill;
- `irn`, `irn_ack_no`, `irn_ack_at`, `eway_no`;
- `source` (own, bank, purchase, sales, import_tally, import_zoho) and `source_ref` (a Tally GUID or a Zoho id);
- `created_by/at`, `posted_by/at`, `cancelled_by/at`, `cancel_reason`, `row_hash`.

**The rules the database enforces.** They are constraint triggers, deferred to commit, so no app bug can break them.

1. **Balanced.** At commit, for every voucher whose status is `posted` or `pending`, `sum(fb_lines.amount) = 0`. A posted
   voucher also has at least 2 lines. Otherwise the whole transaction fails.
2. **GST lines add up.** On a sales or purchase voucher, each tax line equals its rate × taxable value, rounded to the paisa,
   within the voucher's declared rounding line. CGST and SGST appear only when the place of supply equals the GSTIN's state.
   IGST appears only when they differ (or for SEZ or export).
3. **Cost-centre splits add up.** `sum(fb_line_cc.amount)` equals the line's amount.
4. **Bill references add up.** For a bill-wise party line, `sum(fb_bill_refs.amount)` equals the line's amount.
5. **Numbering.** `(registration_id, fy, number)` is unique for sales, credit notes and debit notes. This follows rule 46(b)
   of the CGST Rules: consecutive, at most 16 characters, unique for the year. The number is taken from `fb_series` with a row
   lock inside the posting function, so two people posting at once never get the same number. A cancelled voucher **keeps** its
   number. It is never reused and never deleted.
6. **Period locks** (section 2.7). The database refuses an insert or edit whose `date` falls in a locked period.
7. **No hard delete.** No role has DELETE on `fb_vouchers`, `fb_lines` or any master. "Delete" means `status = cancelled`,
   which keeps the lines and the number. A master that has entries can only be made `inactive`.
8. **Edits make versions.** Editing a posted voucher bumps `version`, and the full earlier state goes to `fb_voucher_versions`
   (`voucher_id`, `version`, `snapshot` jsonb). An edit after approval sends the voucher back to `pending` when the rule
   says so.

### 2.4 Items and stock (phase 6)

The stock tables are:
- `fb_units` (with UQC);
- `fb_stock_groups`;
- `fb_items` (`hsn`, `gst_rate`, `uqc`, `valuation` FIFO or weighted average, `reorder_level`);
- `fb_godowns`;
- `fb_batches`;
- `fb_stock_lines` (`voucher_id`, `line_no`, `item_id`, `godown_id`, `batch_id`, `qty` signed, `rate`, `value`).

On a voucher with stock lines, the stock lines' value ties to the inventory or COGS ledger line. Closing stock value is
recomputed from the stock lines. It is never typed in, except for a book that runs "accounts only" with a closing-stock
journal (Tally's way). That choice is per book. The existing `tally_stock_reads` (migration 134) is how Tally clients'
stock arrives, and it does not change.

### 2.5 Period locks and approvals

| Table | Columns | Rule |
|---|---|---|
| `fb_locks` | `id`, `book_id`, `registration_id` (null = all), `kind` (books, gst, tds), `from`, `to`, `reason`, `locked_by/at`, `unlocked_by/at`, `unlock_reason` | A trigger refuses any voucher insert, edit or cancel dated inside an active `books` lock. A `gst` lock does the same for vouchers with GST lines of that GSTIN. FinCom sets it when GSTR-1 or GSTR-3B is filed (the filing status already exists in GST filing). A `tds` lock covers vouchers with TDS lines in a filed quarter. Only a book admin unlocks, with a reason, and the audit trail records it. |
| `fb_approval_rules` | `id`, `book_id`, `vtype_id` (null = all), `amount_over`, `approver_role`, `two_approvers` (bool), `maker_can_approve` (false) | When a rule matches, posting puts the voucher in `pending`. |
| `fb_approvals` | `voucher_id`, `version`, `decision` (approved, rejected), `by`, `at`, `note` | An approval is tied to a **version**. If the voucher is edited, the approval no longer counts. |

The reports count **posted** vouchers only. The Day Book shows pending ones with their status and a separate total. A
toggle "include pending" exists for MIS only.

### 2.6 The audit trail (edit log)

**The requirement.** The proviso to Rule 3(1) of the Companies (Accounts) Rules, 2014 was inserted by G.S.R. 205(E) of
24-Mar-2021 and applies to financial years starting on or after 1-Apr-2023, after two deferrals. It says that accounting
software must:
- record an audit trail of each and every transaction;
- create an edit log of each change made in the books, with the date the change was made;
- ensure the audit trail cannot be disabled.

The auditor reports on it under Rule 11(g) of the Companies (Audit and Auditors) Rules, 2014. ICAI's Implementation Guide on
Reporting under Rule 11(g) (revised 2024) is the reference an auditor will hold FinCom to. Its text was not fetched in this
round. The build reads it clause by clause (risk R1).

**The design.**

```
fb_audit_log
  seq          bigint generated always as identity   -- strictly increasing per database
  book_id      uuid not null
  at           timestamptz not null default clock_timestamp()   -- the server's time, never the browser's
  actor        uuid                -- auth.uid(); null only for a FinCom system job, which then names itself in actor_kind
  actor_kind   text not null       -- member, system:import, system:projection, system:year_close, support (never silent)
  actor_role   text not null       -- the member's role on the book at that moment
  client_info  jsonb               -- app version, device label, IP (from the edge function), session id
  action       text not null       -- insert, update, cancel, post, approve, reject, lock, unlock, import, restore_master
  entity       text not null       -- fb_vouchers, fb_lines, fb_ledgers, fb_groups, fb_series, fb_locks, …
  entity_id    text not null
  voucher_id   uuid                -- set for vouchers and their lines, so a voucher's whole history is one query
  version_from int, version_to int
  before       jsonb               -- the row before (null on insert)
  after        jsonb               -- the row after
  reason       text                -- required for unlock, cancel and an edit of a posted voucher
  prev_hash    bytea not null
  hash         bytea not null      -- sha256(prev_hash || canonical_json(this row without hash))
```

1. **The database writes it, not the app.** `AFTER INSERT OR UPDATE` row triggers sit on every `fb_*` table (masters,
   vouchers, lines, refs, locks, series, approvals, grants). The triggers are `security definer` functions owned by a
   dedicated role. The app cannot write to the log any other way.
2. **The log cannot be changed.** No role, not even `service_role`, has UPDATE, DELETE or TRUNCATE on `fb_audit_log`, and
   a `BEFORE UPDATE OR DELETE` trigger on it raises an error whatever the role. Retention removal (section 7.4) is a separate,
   audited archive step after 8 years. It is not a delete.
3. **The log cannot be switched off.** The product has **no setting** for it. The triggers are not owned by any role the app
   or a member can use. A **daily self-check** (in Daily Check) confirms each of these:
   - every expected trigger exists and is enabled (`pg_trigger.tgenabled`);
   - the hash chain verifies from the last anchor;
   - every `fb_vouchers.version` has its log rows.
   If any check fails, the book turns `read_only` and the owner is told. Nothing is posted until it is fixed.
4. **Tampering is evident even at superuser level.** A superuser can technically drop a trigger in any Postgres database.
   FinCom does not claim otherwise. Two things make such tampering evident:
   - the per-book hash chain;
   - a daily **anchor**: the last `hash` of the day, written to a second store outside the database (proposal: the
     firm's object storage bucket, write-once retention). The anchor can also be printed in the monthly MIS pack.
   A broken chain names the first bad `seq`.
5. **What the log is for.** On a voucher's page the "History" tab shows each version, who made it, when, and a field-level
   diff: before, after, reason and approvals (mockup 7). The CA can export the whole log for a period to Excel or CSV,
   with the verification result, for the auditor.
6. **Imports are logged too.** A migration from Tally logs one `import` row per voucher, with the Tally GUID and AlterID in
   `after`. The trail therefore starts at the moment FinCom's books start.
7. **Tally and Zoho modes are different.** There Tally or Zoho is the system of record and its own audit trail is the
   statutory one (TallyPrime has its own edit log; Zoho has its own history). FinCom keeps its existing post register and
   `zoho_posts` for what *it* sent. The plan says this plainly in the product, and FinCom never claims to be the audit trail
   of a Tally book.

### 2.7 The projection into the cloud copy (phase 1 design choice)

Each post, edit or cancel of an own-books voucher runs in **the same transaction** as the change. That transaction calls
`fb_project(voucher)`, which rewrites that voucher's rows in the copy tables, keyed on the own book's `book_id` (its own
`tally_books` row with `source = 'own'`):
- `tally_vouchers` (`guid` = the voucher id, `alter_id` = the version, `vtype` = the base type's Tally name, `vno`, `party`,
  the `gst_*` fields, `irn`, `eway_no`, `cancelled`);
- `tally_lines`, `tally_bills`, `tally_ledger_day`;
- for masters, `tally_ledgers` and `tally_groups`.

Because the projection is in the same transaction, the copy can never be behind or ahead of the books. Either both change or
neither does. A nightly equality check compares the copy to the `fb_*` rows by ledger and day (count and sum) and reports
any difference in Daily Check. A difference is a bug, so the book turns read-only until it is explained.

This is how today's features work for own books **without changing their code**. A later phase may let a report read the
`fb_*` tables natively (owner decision D2).

---

## 3. The books provider: how each feature switches source by mode

### 3.1 The mode

`client_books_mode` has the columns `firm_id`, `client_id`, `mode` (tally, zoho, own), `effective_from` (date), `book_id`,
`set_by/at` and `previous` (jsonb). A switch is effective **from a date**, normally 1 April. Before that date the earlier
source stays readable and is frozen. The client's page header shows the mode ("Own books", "Tally: Kaveri Home Decor
(2026-27)", "Zoho: Kaveri Home Decor").

### 3.2 The interface

This is one JS object in the app (`Books.provider(cid)`) and the same shape in `server/_shared` for edge functions:

```
provider.kind                       'own' | 'tally' | 'zoho'
provider.can                        {post, edit, cancel, lock, approve, auditTrail, invoicePdf, einvoice, stock}
provider.masters(cid)               groups, ledgers (with GSTIN / PAN / state / TDS fields), cost centres, voucher types
provider.vouchers(cid, from, to, since?)   the entries as BookSrc's list: {guid, day, vtype, vno, party, lines[], bills[], gst…}
provider.balances(cid, dates[])     {date: {ledger: bal}}: today's tally_balances_json for tally / zoho / own (via projection)
provider.bills(cid, party?, asOf)   bill-wise outstanding (tally_ageing)
provider.post(cid, entries, onProgress)    -> {results: [{id, ok, message, ref}]}: the answer Bridge.post gives today
provider.health(cid)                {ok, lastSync, problems[]}
```

| Provider | Reads | Posts |
|---|---|---|
| **tally** | Today's `TCloud.load`, `BookSrc` and the cloud figures. **No line changes**: the interface wraps the calls. | `Bridge.post` → `tally_post_jobs` → the bridge, as today |
| **zoho** | Today's: `server/zoho-books` already writes into the copy with `source = 'zoho'` | `ZohoB.post` (bills, expenses, journals today; invoices and payments added in phase 4) |
| **own** | The `source = 'own'` projection for every existing report. The new screens (Day Book, Ledger, TB, Audit) read `fb_*` directly. | `fb_post(entries)`: a database function that validates, numbers, applies approval rules, writes the voucher, the log and the projection in one transaction |

### 3.3 Each feature, by mode

| Feature | Tally (unchanged) | Zoho | Own books |
|---|---|---|---|
| Bank: import and review | as today | as today | as today |
| Bank: post | Bridge.post (Payment, Receipt, Contra) | ZohoB.post (expense or journal today; phase 4 categorises the Zoho bank line itself) | fb_post: a Payment, Receipt or Contra voucher, with bill-wise refs from the match |
| Purchase: post | Bridge.post (Purchase with GST and TDS lines) | ZohoB.post (bill) | fb_post (Purchase voucher; TDS line; input GST lines; ITC eligibility flag) |
| Sales: import and review | as today | as today | as today |
| Sales: post / create | Bridge.post | phase 4: Zoho invoice (needs `ZohoBooks.invoices.CREATE`, D8) | fb_post, or **create the invoice in FinCom** (mockup 3) with a PDF and e-invoice |
| Day Book, Ledger, TB | read from the copy | read from the copy | native `fb_*` screens (mockups 4–6) |
| MIS, balance sheet, P&L | copy + FinCom's ledger mapping | copy + Zoho account types | copy (projection); **Schedule III from `sch3_code`**, with no mapping step |
| GSTR-1, 3B, 9, 9C, 2B match, e-invoice | BookSrc over the copy | the same | the same (the projection carries `gst_*`, irn and eway); plus a GST lock after filing |
| TDS 26Q, 24Q, challans | BookSrc | the same | the same; TDS lines carry section and base natively, so no guessing from the ledger name |
| ITR (branch next-itr) | TB / P&L from the copy | the same | the same; P&L lines from `sch3_code` |
| Audit / 3CD | from the copy and the ledger list | the same | the same, plus clauses that become exact (section 7.3) |
| Daily Check | as today | as today | as today, plus the own-books checks: audit chain, triggers, projection equality, pending approvals, unbalanced drafts, numbering gaps |
| Period locks | warn and ask (ClosedP), recorder month lock | warn and ask | **enforced** by the database |

**The rule that protects today's path:** the Tally provider is a wrapper, and the build puts **no** change in
`24-tally-bridge.js`, `49-tally-cloud.js`, `67-book-sources.js` or `server/tally-cloud`. The whole existing test suite must
pass unchanged at every phase (acceptance A0).

---

## 4. Migration

### 4.1 From Tally into own books (mockup 9)

The source is the cloud copy the bridge already keeps (`tally_groups`, `tally_ledgers`, `tally_vouchers`, `tally_lines`,
`tally_bills`, `tally_stock_reads`). Reading from it involves **no bridge change**. What the copy does not hold today
(cost-centre allocations, voucher-type numbering settings, godown and batch detail) needs a small bridge read. The bridge
version and its test sheet follow the usual release flow, as a separate decision (D5).

1. **The cut-over date.** The default is 1 April of the year being moved, which keeps the full year's history in FinCom.
   The alternative is the first day of any month. Openings are then the closing balances of the day before.
2. **Masters.**
   - Groups: Tally's tree, as it is. Each group gets a `sch3_code`, either from the seeded mapping of its primary group or
     from the owner's mapping when it differs.
   - Ledgers: GSTIN, PAN, state, TDS type, bill-wise, credit days, bank details.
   - Cost centres.
   - Voucher types (a Tally voucher type becomes an `fb_vtype` of the same base, with its name).
   - Numbering: one `fb_series` per type and GSTIN, with `next_no` after the highest number used.
3. **Openings.** These are every ledger's balance at the day before cut-over, from `tally_calc_bal`, plus the bill-wise
   outstanding at that day (`tally_ageing`, bill by bill). FinCom can then age receivables and payables from the first day.
   If Tally shows a "Difference in opening balances", **the move stops**. The difference has to be fixed in Tally first, or
   the owner has to post it to a named suspense ledger with a reason (D7).
4. **Vouchers.** Every voucher from cut-over to today is copied (not cancelled, not optional; post-dated vouchers are listed
   separately), with:
   - `source = import_tally` and `source_ref` = the GUID;
   - `status = posted`;
   - an `import` row in the audit log.
   The vouchers keep their Tally numbers. A Tally number that breaks a rule-46 series (a duplicate, or longer than 16
   characters) is listed. It is never silently changed.
5. **Verification.** Every one of these must be **zero difference** before the switch button turns on:
   - the trial balance at cut-over and at today, ledger by ledger, Tally against FinCom (to the paisa);
   - the voucher count and the Dr total, by voucher type and month;
   - bill-wise outstanding, party by party, at today;
   - GST: the GSTR-1 and GSTR-3B figures FinCom works out for each month already filed, from the old copy and from the new
     books;
   - TDS: the deductions by section and quarter;
   - stock (phase 6): quantity and value by item at today.
6. **The switch.** The person can run both books in parallel for up to 30 days. During that time the bridge keeps reading
   Tally, and Daily Check compares the two every night. Then the owner presses **Switch to own books**. The Tally company is
   now frozen in FinCom as read-only history. Nothing is deleted, from Tally or from the copy.

### 4.2 From Zoho Books into own books

The same steps. The source is the copy that `server/zoho-books` already keeps for the organisation (`source = 'zoho'`), plus
`zoho_objects` (accounts, contacts and taxes by Zoho id).
- Zoho's `account_type` values map to groups. This round verified part of the list in Zoho's chart-of-accounts reference:
  `other_asset`, `other_current_asset`, `cash`, `bank`, `fixed_asset`, `other_current_liability`, `credit_card`,
  `long_term_liability`, `equity`, `income`, `other_income`, `expense`, `cost_of_goods_sold`, `other_expense`,
  `accounts_receivable`, `accounts_payable`, "and more".
- Contacts become party ledgers, with `gst_no` and `gst_treatment` (`business_gst`, `business_none`, `overseas`, `consumer`,
  as the bills reference lists them).
- Openings come from Zoho's opening-balance data. That endpoint was **not verified** in this round, so the build confirms it
  before relying on it.

Zoho's daily API cap matters here (section 5.4). A large organisation on the Free plan (1,000 calls a day) may need several
days for its first full read. FinCom shows that estimate before starting.

### 4.3 Export back: Tally XML and Excel

- **Tally XML.** FinCom already builds Tally import XML for every posting (the `{masters: [{id, xml}], vouchers: [{id, xml}]}`
  payload of `tally_post_jobs`). The export reuses the same builder for a whole period, as one `ENVELOPE` with masters first
  and then vouchers. There are two delivery routes:
  - a file the CA imports in TallyPrime (Import › Masters / Transactions);
  - for a linked Tally company, the bridge queue as usual.
  A round-trip test imports the export into an empty made-up Tally company and reads it back, and the TB must tie.
- **Excel.** One workbook per year: Day Book, Ledgers (one sheet per group), Trial Balance, Bill-wise outstanding, GST
  registers, TDS register, the audit log, and the verification sheet (counts, totals, the hash of the last log row).
- **Full archive** (for retention and for leaving FinCom). This is a ZIP of CSV files, one per `fb_*` table, with a manifest
  of row counts and SHA-256 sums. A book can be rebuilt from it, and a test proves that.

---

## 5. Zoho Books integration

### 5.1 What exists (server/zoho-books)

The existing integration already does the following:
- OAuth with India's data centre: `accounts.zoho.in`, `www.zohoapis.in`.
- Tokens in Supabase Vault, never in a table.
- Organisations are linked to clients.
- Reads each kind of document newest-changed first, down to the last position (`zoho_sync_state`), and fetches a document
  only when it is new or changed (`zoho_seen`).
- Detects deletions by a daily id comparison, which holds back a removal larger than a fifth.
- Posts bills, expenses and journals with `FC:<id>` in the reference, a duplicate check and a lease. It never sends PUT or
  DELETE.
- Keeps under the per-minute limit and stops at 95% of the daily cap.

### 5.2 The official API: verified in this round

| Fact | Source |
|---|---|
| India's API root is `https://www.zohoapis.in/books/` (the v3 path is `/books/v3`). Every request must carry `organization_id`, which `GET /organizations` gives (scope `ZohoBooks.settings.READ`). | <https://www.zoho.com/books/api/v3/introduction/> |
| The India accounts server is `https://accounts.zoho.in`. The server-based redirect carries `location=in` and `accounts-server`, and the token response carries `api_domain`. | <https://www.zoho.com/accounts/protocol/oauth/multi-dc.html> |
| OAuth endpoints: `{accounts}/oauth/v2/auth` (with `response_type=code`, `access_type=offline` for a refresh token, `prompt=consent`), `{accounts}/oauth/v2/token`, `{accounts}/oauth/v2/token/revoke`. The grant code lasts 2 minutes. The access token lasts 1 hour. The refresh token does not expire until revoked. There are at most 15 live access tokens per refresh token, at most 10 new access tokens per refresh token in 10 minutes, and at most 20 refresh tokens per user (the 21st invalidates the oldest). | <https://www.zoho.com/books/api/v3/oauth/> |
| Scope format: `ZohoBooks.<scope>.<CREATE\|READ\|UPDATE\|DELETE\|ALL>`. Creating a journal and an account needs `ZohoBooks.accountants.CREATE`. | <https://www.zoho.com/books/api/v3/oauth/>, <https://www.zoho.com/books/api/v3/journals/>, <https://www.zoho.com/books/api/v3/chart-of-accounts/> |
| Rate limits: **100 requests a minute per organisation** (HTTP 429, code 44). **Daily per plan**: Free 1,000, Standard 2,000, Professional 5,000, Premium / Elite / Ultimate 10,000 (429, code 45). **Concurrent calls**: 5 on Free, 10 on paid plans as a soft limit (429, code 1070). | <https://www.zoho.com/books/api/v3/introduction/> |
| Pagination: `page` and `per_page`, 200 items a page by default, with `page_context.has_more_page`. The maximum `per_page` is not stated. | <https://www.zoho.com/books/api/v3/pagination/> |
| Chart of accounts: `GET/POST /chartofaccounts`, `GET/PUT/DELETE /chartofaccounts/{id}`, active / inactive, `GET /chartofaccounts/accounttransactions` | <https://www.zoho.com/books/api/v3/chart-of-accounts/> |
| Contacts: `GET/POST /contacts`, `GET/PUT/DELETE /contacts/{id}`, active / inactive, addresses, bank accounts, tax info | <https://www.zoho.com/books/api/v3/contacts/> |
| Invoices: `GET/POST /invoices`, `GET/PUT/DELETE /invoices/{id}`, `/status/sent\|void\|draft`, `/submit`, `/approve`; **e-invoice**: `POST /invoices/{id}/einvoice/push`, `/cancel`, `/fetch`, `GET /invoices/einvoice` | <https://www.zoho.com/books/api/v3/invoices/> |
| Bills: `GET/POST /bills`, `GET/PUT/DELETE /bills/{id}`, `/status/void\|open`, `/submit`, `/approve`, payments, credits. India fields: `gst_treatment`, `gst_no`, `source_of_supply`, `destination_of_supply`, `is_reverse_charge_applied`, `is_tds_applied` | <https://www.zoho.com/books/api/v3/bills/> |
| Journals: `GET/POST /journals`, `GET/PUT/DELETE /journals/{id}`, `/status/publish`, `/reverse`, `/submit`, `/approve`; `journal_date` is required | <https://www.zoho.com/books/api/v3/journals/> |
| Bank transactions: `GET/POST /banktransactions`, `GET/PUT/DELETE /banktransactions/{id}`; uncategorised lines: `/match`, `/categorize` (and `/categorize/expenses`, `/vendorpayments`, `/customerpayments`, …), `/exclude`, `/restore`; `/{id}/unmatch`, `/{id}/uncategorize` | <https://www.zoho.com/books/api/v3/bank-transactions/> |
| Webhooks are set up in Zoho (Settings › Automation › Workflow Actions › Webhooks) and fired by a workflow rule, one webhook per rule. POST, PUT or DELETE; default, form-encoded or raw JSON payloads. An optional secret of 12–50 alphanumeric characters signs each call in `X-Zoho-Webhook-Signature` (HMAC-SHA256). Timeouts are 5 s to connect and 10 s to read. Any non-2xx response is a failure and is retried 5 times by default (up to 20 if configured). The daily webhook limit depends on the plan, and the page does not give the numbers. | <https://www.zoho.com/us/books/help/settings/automation/workflow-actions/webhooks.html> |

**Not verified this round, so the build confirms each before using it:**
- the exact scope name for each new write (invoices, customer payments, vendor payments, banking);
- the opening-balance endpoint;
- the maximum `per_page`;
- whether Zoho exposes its transaction-locking date through the API;
- the daily webhook limits.

### 5.3 Two-way sync rules (Zoho mode)

**Zoho is the system of record in Zoho mode.** FinCom is a careful second pair of hands.

1. **FinCom creates and never overwrites.** FinCom POSTs new documents. Today these are bills, expenses, journals and
   contacts. Phase 4 adds invoices, credit notes, customer and vendor payments, and bank categorisation. Every one carries
   FinCom's id (`FC:<id>` in the reference), after a duplicate check.
2. **Edits made in Zoho flow back.** The `last_modified_time` sync already does this. When a document FinCom created is later
   changed in Zoho, FinCom's copy shows **"Changed in Zoho"** with the diff, and FinCom's review row stays as it was approved.
   The difference is a to-do, not an overwrite.
3. **FinCom edits only what it made, if the owner allows it (D9).** Allowing edits means sending PUT for the first time. The
   rule would be: PUT only a document FinCom created, only when its `last_modified_time` still equals the one FinCom last
   read, re-read immediately before the PUT. Zoho has no If-Match, so a window of seconds remains. FinCom says so and checks
   the document again after the PUT. FinCom **never** sends DELETE. Voiding stays a person's action in Zoho.
4. **Deletions in Zoho.** The existing daily id comparison applies. A document gone from Zoho leaves FinCom's books (it is
   kept as "deleted in Zoho"). A batch that would remove more than a fifth of a kind is held for the owner.
5. **Conflicts.** A conflict is a document changed on both sides since the last read. **Zoho's version wins in the books.**
   FinCom's intended version is kept in `zoho_posts` with the diff and shown under the client's "Needs you". Nothing is
   merged silently.
6. **Locked periods.** If Zoho refuses a document (a locked period, a closed year), FinCom shows Zoho's own words, as posting
   to Tally does today.
7. **Webhooks.** Today a webhook only brings the next scheduled read forward (the URL carries a token). Phase 4 adds the
   signature check: the person sets a secret in Zoho, and FinCom verifies `X-Zoho-Webhook-Signature` and answers 2xx fast.
   The webhook is never the only path, because the scheduled read catches whatever a missed webhook would have brought.

### 5.4 Rate limits in practice

- **Per minute.** FinCom keeps its existing pacing under 100 a minute (90, `ZOHO_MIN_GAP_MS`), and no more than 4 calls at
  once per organisation (under the Free plan's 5 concurrent).
- **Per day.** FinCom stops at 95% of the plan's cap (`zoho_connections.daily_cap`, set from the plan: 1,000 / 2,000 /
  5,000 / 10,000). A 429 with code 45 ends the day, whatever the count says. The Zoho connect page (mockup 8) shows
  today's use against the cap.
- **Tokens.** One access token is refreshed and shared per grant, never per request. This stays under 10 new tokens in 10
  minutes.
- **First full read.** The read is estimated before starting (documents ÷ 200 per page + one GET per document) and spread
  over days when the cap needs it.

### 5.5 What the owner sets up

1. In the Zoho API Console, create a **Server-based Application**. Use a Zoho account in the **India data centre**
   (`accounts.zoho.in`).
2. The **Redirect URI** is the zoho-books function's URL, which the existing `{kind: "config"}` call shows (`redirectUri`).
3. Copy the Client ID and Client Secret into the function's secrets `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET`. Never put them
   in the repo or a table.
4. Leave Multi-DC off unless the owner wants clients outside India's data centre (D10).
5. Scopes. Today's list is in `SCOPES` in `server/zoho-books/index.ts`. Phase 4 adds the CREATE scopes for invoices, credit
   notes, customer payments, vendor payments and banking, with exact names confirmed from Zoho's docs at build time. Adding
   scopes means each client signs in to Zoho again once (`prompt=consent`).
6. Per client in Zoho: a workflow rule with a webhook to FinCom's URL, with a secret. Optional, because the schedule reads
   anyway.

---

## 6. Corporate needs

| Need | Design |
|---|---|
| **Roles and permissions** | `fb_grants` (`book_id`, `user_id`, `role`, `branch_ids` null = all). The roles are **Viewer** (reads), **Accountant** (maker: drafts and posts within the approval rules), **Approver** (checker), **Book admin** (masters, series, locks, grants) and **Auditor** (read-only, every report and the audit log, time-boxed). The firm's `members.role` stays: an owner is a book admin everywhere. Every grant change is in the audit log. |
| **Maker-checker** | `fb_approval_rules`: by voucher type and amount ("payments over ₹5,00,000 need an Approver"; "all journals need an Approver"; "two approvers over ₹50 lakh"). The maker can never approve their own voucher, and the database checks it. An approval is tied to a version. |
| **Multi-GSTIN branches** | Each GSTIN is a `fb_registrations` row with its own series, its own GST returns (GSTR-1, 3B and 9 per GSTIN, as GST filing already works per registration), its own e-invoice user, and its own lock. A voucher belongs to one GSTIN. The place-of-supply logic uses that GSTIN's state. |
| **Inter-branch** | A supply between two GSTINs of the same PAN is a taxable supply even without consideration (Schedule I, para 2, CGST Act). FinCom makes it **one action**: a sales voucher in branch A and the matching purchase voucher in branch B, both using the same invoice number, linked. Each side uses its branch control ledger (`X.BRANCH`). Daily Check confirms that the branch control ledgers net to zero across the company. Stock transfers within one GSTIN are a stock journal with no GST. |
| **Cost centres** | Categories, centres and sub-centres. A ledger can require a centre (`cost_centres_on`). A line can split across centres (`fb_line_cc`, which sums exactly). Reports: cost centre P&L, and centre by ledger. |
| **Consolidation (later)** | Out of scope until after phase 5. Design note: a group of `fb_books` with ownership %, intercompany ledger pairs, an elimination journal book, translation not needed (INR only). Ind AS 110 and AS 21 presentation. D11. |
| **Data export** | Section 4.3: Tally XML, Excel, and the full CSV archive with a manifest. The auditor role can export the audit log itself. |
| **Scale** | The design target is 5 lakh vouchers a year per book. All figures come from indexed sums (`fb_lines (book_id, ledger_id, date)`). The cloud figure functions already serve books above `TCloud.BIG` (60,000) without loading them into the browser. |

---

## 7. Indian compliance tied to own books

### 7.1 GST: e-invoice and e-way bill

- A sales invoice created in FinCom (mockup 3) is already an IRP payload. `EINV` builds INV-01 v1.1 from it and gets the
  IRN through `gst-taxpro`. The IRN, the ack and the signed QR are stored on the voucher (`irn`, `irn_ack_no`, `irn_ack_at`)
  and printed on the PDF (`invoiceHtml` already does this).
- Whether a GSTIN must e-invoice comes from `fb_registrations.einvoice`. FinCom flags the turnover threshold from the books,
  but a person ticks it.
- An e-way bill is suggested when the consignment value of goods crosses the threshold, and its number is stored on the
  voucher.
- A cancelled IRN cancels the voucher. The number is kept, and the audit log records the cancellation.
- After GSTR-1 for a month is filed, FinCom sets a `gst` lock for that GSTIN and month. A change after that is a credit or
  debit note, or an amendment in a later return, which is what the law expects.
- The 2B match, ITC reversal and GSTR-9 / 9C run as today over the projection.

### 7.2 TDS

Own-books TDS lines carry `tds_section` and `tds_base` **natively**. The 26Q and 24Q engines read the same list as today, but
the section is no longer inferred from the ledger name. Every point below follows from this:
- the 194Q and 206C(1H) thresholds are computed per party per year from the books;
- lower-deduction certificates (`lower_cert_no`) limit the rate;
- the challan match runs as today;
- a `tds` lock follows a filed quarter.

### 7.3 ITR and Tax Audit (3CD) from own data

- The ITR's P&L and balance sheet schedules are built from `sch3_code`, with no mapping step for own books.
- The 3CD clauses that become **exact** from own books:
  - 26 (43B: unpaid statutory dues, from the tax ledgers' balances at year end and the payment dates);
  - 34 (TDS: deducted, paid and late, from TDS lines and challans);
  - 44 (expenses split by GST registered, composition, exempt and unregistered suppliers, from the party's `gst_reg_type`);
  - 22 (MSME payments beyond the agreed time: Sec 43B(h), from `msme_type`, bill dates and payment refs);
  - 31 (loans and deposits received or repaid in cash, from the lines' counter-ledger being cash).
- Each clause shows the vouchers behind every figure.

### 7.4 Audit trail and retention

- **The audit trail:** section 2.6. Auditors get the Auditor role, the History view and the export with the chain check.
- **Retention:** Section 128(5) of the Companies Act requires books of account for at least **8 financial years** before the
  current year.
  - FinCom keeps every `fb_*` row and the audit log for at least the current year plus 8 years.
  - After that, data is removed only by an archive step that the owner confirms and the log records. It is never removed
    automatically.
  - GST's own retention (CGST Act section 36: 72 months from the annual return's due date) fits inside this.
- **Backup in India:** the proviso to Rule 3(5) (as amended in 2022) requires the electronic books' **daily backup on servers
  physically located in India**. FinCom's database region and backup location must therefore be in India. This is owner
  decision D12, to confirm the Supabase project's region, before the first company keeps own books.
- **Access for the government:** the books must be accessible in India at all times, which is the same point as the backup.

---

## 8. Screens (mockups, made-up data)

In `<scratchpad>/shots-books/`, each screen is at 1440 desktop and 390 phone, with deviceScaleFactor 2:

| # | File | What it shows |
|---|---|---|
| 1 | `01-mode.png`, `01-mode-phone.png` | Choosing a client's books mode: three cards (Own books, Tally, Zoho Books), what each one means for posting, the audit trail and reports, and the effective-from date |
| 2 | `02-coa.png`, `02-coa-phone.png` | Chart of accounts: the Schedule III tree, ledgers with GSTIN / PAN / state, balances, and the "Schedule III line" each group feeds |
| 3 | `03-invoice.png`, `03-invoice-phone.png` | New sales invoice: customer with GSTIN, items with HSN, **GST worked out** (intra-state CGST + SGST), the e-invoice switch, the Dr / Cr preview, and the **PDF preview** |
| 4 | `04-daybook.png`, `04-daybook-phone.png` | Day Book: a day's vouchers by type, number, party, Dr = Cr per voucher, status (Posted / Pending approval / Cancelled), the day's totals tie |
| 5 | `05-ledger.png`, `05-ledger-phone.png` | A party ledger: opening, entries with running balance, bill-wise references, closing, GSTIN / PAN, ageing strip |
| 6 | `06-tb.png`, `06-tb-phone.png` | Trial balance by Schedule III group: Dr and Cr columns, the "recomputed from 1,286 vouchers just now, ties to the paisa" check, and a locked-period mark |
| 7 | `07-audit.png`, `07-audit-phone.png` | The audit trail of one voucher: every version with who, when, before → after, reason and approval, plus the chain check |
| 8 | `08-zoho.png`, `08-zoho-phone.png` | Zoho connect: sign in at Zoho India, choose the organisation, what FinCom reads and writes, scopes, today's API use against the plan's cap |
| 9 | `09-move.png`, `09-move-phone.png` | Move a client from Tally: the steps (masters, openings, vouchers) and the verification result, every check at ₹0.00 difference, and "Switch to own books" |

---

## 9. Phases, effort, risks, acceptance

Effort is in engineer-weeks: one experienced engineer, including tests, the review round and the release flow. It excludes
the owner's review time.

| Phase | What | Effort | Depends on |
|---|---|---|---|
| **P0** | This plan and design; owner decisions D1–D12 | done (this branch) | — |
| **P1 Ledger engine** | `fb_books`, `fb_years`, `fb_groups` (Schedule III seed), `fb_ledgers`, `fb_openings`, `fb_vtypes`, `fb_series`, `fb_vouchers`, `fb_lines`, `fb_bill_refs`, `fb_cost_centres`; the balancing, numbering and no-delete rules; **audit log with hash chain, triggers, daily check, anchors**; `fb_locks`; the projection into the copy; the mode switch and `Books.provider` with the Tally provider as a pure wrapper; screens: mode, chart of accounts, journal / payment / receipt / contra entry, Day Book, Ledger, Trial Balance, voucher History | **7–9** | D1, D2, D3, D12 |
| **P2 Documents and posting** | Sales invoice (GST auto, PDF, e-invoice and e-way through the existing functions), purchase bill, credit and debit notes; bank, purchase and sales posting into own books; approvals (`fb_approval_rules`, `fb_approvals`, maker ≠ checker); GST and TDS locks after filing; the own-books checks in Daily Check; Schedule III statements | **6–8** | P1 |
| **P3 Tally migration and export** | Copy and verify from the cloud copy (section 4.1), parallel run, the switch; Tally XML export (reusing the posting builder) with a round-trip test; Excel; the full CSV archive with rebuild test. A bridge read for cost-centre allocations and voucher-type settings, if D5 says yes (+1–2 weeks and a bridge release) | **4–6** (+1–2) | P1, P2 |
| **P4 Zoho two-way** | New CREATE scopes and re-consent; invoices, credit notes, customer and vendor payments, bank categorisation; signed webhooks; "Changed in Zoho" diff and conflict list; Zoho → own migration with verification | **4–5** | D8, D9, P3 for migration |
| **P5 Corporate** | `fb_grants` roles per book and branch; multi-GSTIN registrations and series; inter-branch in one action with control-ledger check; cost-centre reports; auditor role and log export | **6–8** | P2 |
| **P6 Inventory** | Items, units (UQC), godowns, batches, stock lines on vouchers, FIFO / weighted average, stock summary and movement, HSN summary for GSTR-1 from items; Tally stock import | **8–10** | P2 |
| **Later** | Consolidation (D11); native report reads from `fb_*` (D2); multi-currency | — | — |

**Total: about 36–48 engineer-weeks** (P1–P6). A client can start keeping simple service-business books after **P2**,
which is about 13–17 weeks. Moving Tally clients needs **P3**.

### 9.1 Acceptance rules (every phase)

- **A0. The Tally path is unchanged.** The full existing suite (`tests/run_*`, the Go bridge tests) passes with no edits.
  The diff touches no file of the Tally path (section 3.3).
- **A1. Dr = Cr is enforced by the database.** A test inserts an unbalanced voucher **as `service_role`, directly**, and the
  commit fails. It also tries a one-line voucher, a cost-centre split that is off by a paisa, and bill refs that are off by a
  paisa, and each one fails.
- **A2. The trial balance always ties.** A property test generates 50,000 random made-up vouchers (all types, GST and TDS
  lines, cancellations, edits). After each batch:
  - the TB total Dr equals the total Cr;
  - balance sheet = P&L carried + openings;
  - every ledger's balance recomputed from the lines equals the report's figure;
  - the projection equals the `fb_*` rows by ledger and day.
- **A3. The audit trail cannot be changed or disabled.** As every role (member, owner, `service_role`), a test tries UPDATE,
  DELETE and TRUNCATE on `fb_audit_log`, and each fails. Disabling a trigger (as a superuser in the test database) makes the
  daily check fail and turns the book read-only. Corrupting one log row makes the chain check name that `seq`.
- **A4. Locks hold.** An insert, edit or cancel in a locked period fails at the database. An unlock needs a book admin and a
  reason, and the audit log records it.
- **A5. Numbering.** 1,000 concurrent postings into one series give 1,000 distinct consecutive numbers with no gap. A
  cancelled number is never reused.
- **A6. Migration is exact.** On a made-up Tally company of at least 20,000 vouchers with bill-wise, cost centres and GST,
  every check in 4.1 step 5 shows ₹0.00 difference. An injected 1-paisa change is caught and named.
- **A7. Export round-trips.** Export to Tally XML, import into an empty made-up Tally company, read back through the bridge,
  and the TB ties. Export the CSV archive, rebuild a book, and every row hash matches.
- **A8. Every report recomputes.** No report reads a stored total that the vouchers did not produce in the same request or
  the same transaction.

### 9.2 Key risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **The statutory audit-trail claim.** An auditor reporting under Rule 11(g) may test FinCom's trail, and a gap is a qualified report for the client. | Database-written log, no setting, hash chain, daily self-check, external anchor (2.6). Read ICAI's 2024 Implementation Guide clause by clause before P1 ships. Get an independent CA review of the design (D4). Be honest that a superuser can disable a trigger, and show that tampering is evident. |
| R2 | **Projection drift**: the copy differs from the books. | Same-transaction projection, nightly equality check, read-only on difference (2.7). |
| R3 | **Scope creep towards Tally parity** (inventory, payroll, manufacturing, multi-currency). | Phases; a client is offered own books only when its needs fit the phases built. Tally mode stays first-class. |
| R4 | **Tally import fidelity**: optional and post-dated vouchers, cost centres, inventory, renamed or merged ledgers. | Copy from the cloud copy that already handles renames and merges (migrations 31–39). Anything not copied exactly is listed and blocks the switch. |
| R5 | **Zoho quotas**: the Free plan has a cap of 1,000 calls a day. | Estimate before starting; spread over days; per-minute and concurrent limits under Zoho's. |
| R6 | **Performance on big books** | Indexed sums; the cloud figure functions; no whole-book download for books above 60,000 entries. |
| R7 | **Data residency**: Rule 3(5) daily backup in India | D12 before the first own-books client. |
| R8 | **GST rounding and numbering mistakes on invoices** | Database checks (2.3 rules 2 and 5); e-invoice validation before posting. |
| R9 | **People's Tally habits** | Tally's group names, voucher keys (F4–F9) and Dr / Cr preview are kept. Only the look is new. |

---

## 10. Owner decisions needed

| # | Decision | Recommendation |
|---|---|---|
| D1 | Which clients may choose Own books first: service MSMEs only (no stock) until P6? | Yes. Service businesses first, then trading after P6. |
| D2 | Phase 1 reads: project own books into the cloud copy (`source = 'own'`) so every existing feature works unchanged, or rewrite the reports to read `fb_*` natively? | Project (section 2.7). Native reads later, one report at a time, each proven equal. |
| D3 | Must every posted own-books voucher be editable (as a new version), or must posted vouchers be immutable, with changes only by cancel-and-replace? | Editable with versions and a reason. This is how Tally works and what the rule expects (an edit log). |
| D4 | An independent CA's review of the audit-trail design against Rule 11(g) before P1 goes live? | Yes. |
| D5 | A small bridge read for cost-centre allocations and voucher-type numbering settings (a bridge release), or migrate without them? | Do it in P3. Without it, cost centres cannot move. |
| D6 | Division II (Ind AS) groups in P1, or Division I only? | Division I in P1; Division II in P5 for corporates. |
| D7 | A Tally company with a "Difference in opening balances": block the move, or allow it to a named suspense ledger with a reason? | Block by default; allow only with the owner's sign-off per client. |
| D8 | Zoho mode: should FinCom create **sales invoices** in Zoho? This needs new scopes and each client signing in again. | Yes, in P4. |
| D9 | Zoho mode: may FinCom ever **edit** (PUT) a document it created, under the rule in 5.3 point 3? | Not in P4. Revisit after a quarter of use. |
| D10 | Zoho Multi-DC: India's data centre only, or others too? | India only, as today. |
| D11 | Consolidation: in scope this year? | No. Design note only. |
| D12 | Confirm the Supabase project's region and backup location are in India (Rule 3(5)) before the first own-books client | Must confirm. Move or add a region if not. |
| D13 | The default cut-over date for moves: 1 April (full year in FinCom) or any month start? | 1 April, with a month start allowed. |
| D14 | Parallel-run length before the switch | 30 days, or one GST return cycle, whichever ends later. |
| D15 | Independent Books (MIT, verified): port its bill-wise, GST-split, parsing and inventory rules and its test cases, with the attribution plan in 11.5? Add a Tally **XML file upload** path ported from its importer, besides the bridge? | Yes to the rules and tests. Yes to the file upload in P3, as a second path that must tie exactly like the bridge path. |

---

## 11. Using Independent Books (idpbook.com)

The owner asked whether FinCom can use the open-source project behind idpbook.com, "Independent Books"
(<https://github.com/PrimeSteelIndia/independent-books>), to build its own books, and wants the job kept simple.

**How it was reviewed.** It was cloned read-only into a temporary folder (commit `2a7f9fe8`, 1-Nov-2026) and deleted after
review. Nothing from it was run, and its tests were not run either: they need `pytest`, which is not installed here, and many
of them drive a browser. Everything below comes from reading the code.

### 11.1 Licence: verified

The repo's `LICENSE` file is the standard **MIT License**, "Copyright (c) 2026 Independent Books Contributors". FinCom may
reuse, port and change the code, as long as the copyright notice and permission notice go with any substantial portion
(section 11.5).

### 11.2 What it is, compared with FinCom's planned own books

| Area | Independent Books | FinCom own books (this plan) | Verdict |
|---|---|---|---|
| Storage | SQLite, but the **whole company is one JSON document** (`state.payload`), rewritten on every save (`books.py`, `Books._persist`) | Relational Postgres tables (`fb_*`), one row per voucher and line | Different design. Their storage cannot be reused. |
| Money | Python `Decimal`, quantised to 0.01 with ROUND_HALF_UP (`decimal()`); amounts kept as strings | `numeric(18,2)` | Same principle. Their parsing rules are worth porting (they reject junk, strip ₹ and commas, refuse non-finite values). |
| Voucher shape | Kept in **Tally's own XML field names** (`ALLLEDGERENTRIES.LIST`, `ISDEEMEDPOSITIVE`, `BILLALLOCATIONS.LIST`, `COSTCENTREALLOCATIONS.LIST`) | Typed columns, with Tally names only in the projection | Useful as a map from Tally fields to FinCom columns for the importer. |
| Dr = Cr | Checked in Python before saving: at least 2 non-zero lines, sum = 0 (`_validate_voucher`); cost-centre splits must equal the line | Checked **by the database** at commit, so even a direct insert by `service_role` cannot break it | Same rules. FinCom enforces them one level lower. Their rule list is a good checklist. |
| Bill-wise | Thorough: New Ref / Agst Ref / Advance / On Account, stable bill ids, no over-allocation, opposite-side check, ambiguous-name refusal, partial settlement, ageing by due date (`_validate_bill_allocations`, `_bill_rows`, `ageing`) | `fb_bill_refs` with the same four types | **Port these rules and their tests.** This is the most valuable part. |
| Numbering | `max(number)+1` per voucher type, numeric only (`next_number`); uniqueness checked per type | Per GSTIN and FY series, row-locked, rule 46(b), cancelled numbers kept | Do not take theirs. It has no GSTIN or FY scope, can race, and can reuse a number after a delete. |
| Delete and edit | **Hard delete is allowed** (`cancel_or_delete_voucher(delete=True)`). An edit replaces the voucher in place. | No hard delete; edits make versions; full audit log | Do not take theirs. |
| Audit trail | None per change. `history` keeps whole-state snapshots and **prunes them** (the last 30, plus one a day for 60 days) | Database-written edit log, hash chain, kept for 8+ years | Theirs would not meet Rule 3(1) or section 128(5). Do not take it. |
| Period lock | One `books_locked_until` date, checked in Python, on post, alter and cancel | `fb_locks` by kind (books, GST, TDS) and GSTIN, enforced by the database | Same idea. FinCom's is finer and enforced lower. |
| GST | CGST and SGST split as `cgst = round(tax/2)`, `sgst = tax − cgst`, so the halves always add up; IGST when the party's state differs from the company's, and **IGST when the state is blank** (`gst_components`, `calculate_item_gst`) | GST lines checked against rate × taxable value per line, by the database, with the place of supply on the voucher | **Port the half-split rounding rule and the blank-state rule, with their tests.** Their place of supply is the party ledger's state, not the invoice's, and that must not be copied. |
| Tax ledgers | Recognised **by name** ("CGST" / "CENTRAL TAX" in the ledger name: `_tax_ledger_type`) | `tax_kind` stored on each line | Do not take theirs. A name guess is what own books are meant to end. |
| GSTR-1 / 3B | Recomputed from items, rates and the party's state (`gstr1_report`, `gstr3b_report`); no reverse charge, no e-invoice, no ITC eligibility | FinCom's existing GSTR engines (`gst3b.js`, BookSrc) over the projection | Keep FinCom's. They are proven in use; theirs are simpler. |
| TDS, e-invoice, e-way, 3CD, ITR | Not present | Present in FinCom | Nothing to take. |
| Reports | Trial balance, two-sided BS and P&L by Tally group (`financial_tree`), period compare, drill-down; recomputed from all vouchers on every post (`_rebuild`) | Schedule III from `sch3_code`; indexed sums | Their report tests (recursion, cycles, period boundaries, profit with renamed system groups) are worth porting. Their recompute-everything approach does not scale to large books. |
| Chart of accounts | Tally's 28 primary and sub-groups (`GROUP_PARENTS`) | The same 28, plus `sch3_code` | Use theirs as a cross-check of FinCom's seed list. Both come from Tally's public structure. |
| Tally XML import | `interchange.py`: parses masters and vouchers (groups, ledgers, stock items, units, godowns, voucher types, cost categories and centres, currencies), handles split Tally files, keeps unknown fields, applies everything **atomically** with no duplicate vouchers on re-import; strips Tally's illegal control characters | FinCom reads Tally through the bridge (the cloud copy). It has no file import today. | **Worth porting for a "no bridge" path**: a CA uploads Tally's XML export. Port the logic, not the parser (11.4). |
| Inventory | Units with compound units, godowns, batches, FIFO / weighted average, negative-stock policy, manufacturing journal | Phase 6 | Port the valuation rules and tests in P6. |
| Server | A local HTTP server on 127.0.0.1 with a host and Origin check; a 4-digit company PIN | Supabase, row-level security, sign-in | Nothing to take. |

### 11.3 What to reuse (recommended)

1. **Port the logic, not the code.** FinCom is JS/TS and Postgres, so nothing can be dropped in. Each rule below is
   rewritten as a Postgres check (the "never" rules) or a shared TS function (form help, previews).
   - **Bill-wise rules** (P2): the four reference types, stable bill ids, over-allocation refusal, opposite-side check,
     ambiguous-name refusal, partial settlement, ageing boundaries.
   - **GST half-split rounding** (`sgst = tax − round(tax/2)`) and **blank state = IGST** (P2).
   - **Amount parsing** (P1): junk refused, ₹ and commas stripped, non-finite refused, ROUND_HALF_UP to the paisa.
   - **Cost-centre split must equal the line** (P1), which already matches rule 3 in section 2.3.
   - **Inventory valuation** (FIFO, moving weighted average, compound units) (P6).
2. **The chart of accounts and voucher types:** used as a cross-check of FinCom's seed list (Tally's 28 groups and the
   voucher-type list with "accounting" and "non-accounting" bases). Both are Tally's public structure, so no code needs to
   be copied for this.
3. **Their test cases as acceptance cases.** About 133 `test_` functions in 36 files. Port the cases, rewritten as FinCom
   tests over made-up data:
   - `test_phase2_bills.py`;
   - `test_voucher_rules.py`, `test_audit_fixes.py`;
   - `test_item_gst_engine.py`, `test_standard_rates.py`;
   - `test_phase4_reports.py`;
   - `test_tally_bundle_import.py`, `test_master_xml_import.py`;
   - `test_phase3_inventory.py`.
   Each case keeps a comment naming the original test (the attribution in 11.5).
4. **Their Tally XML import, for a file-upload path** (P3, optional, D15). It is *in addition to* the bridge, never instead
   of it. Port these:
   - the field mapping;
   - the split-file bundle handling;
   - keeping unknown fields;
   - the atomic apply and the no-duplicate re-import rule;
   - the cleaning of Tally's illegal characters.
   Its output feeds the same copy-and-verify steps as section 4.1, so a file import is proven to tie exactly like a bridge
   import. FinCom's existing bridge (Go) reading stays the main path. The two importers are compared on the same made-up
   Tally exports in tests, and they must produce identical `fb_*` rows.

### 11.4 What NOT to take

- **Storage and history:** the single-JSON-document store, the in-place edit, the hard delete and the pruned snapshots.
  None of them meets Rule 3(1) (audit trail) or section 128(5) (8 years). FinCom's relational tables, versions and
  database-written log replace them.
- **Numbering:** `max+1` per type. It has no GSTIN or FY scope, no lock, and can reuse numbers.
- **Tax ledgers by name** and **place of supply from the party ledger:** both are guesses that give wrong GST in edge cases
  (a ledger named oddly; a supply shipped to another state).
- **Their GSTR-1 / 3B builders:** FinCom's are more complete (reverse charge, ITC eligibility, amendments, e-invoice) and
  already tested in use.
- **Whole-book rebuild on every post:** it is O(all vouchers) per save, which is fine for a desktop shop and not for a
  5-lakh-voucher corporate book.
- **Security-sensitive parts:** the local HTTP server, the PIN lock and the update checker. FinCom has its own sign-in, RLS
  and release flow.
- **XML parsing as written:** it uses Python's standard `xml.etree.ElementTree`. Python's own docs list entity-expansion attacks
  ("billion laughs") among the risks for that parser, depending on the Expat version underneath. FinCom's port must parse uploads with entities and DTDs
  refused, a size cap, and in the edge function, never in the database.
- **Quality caveats:** the repo's claims (for example a "CI passing" badge, "Tally parity") were not verified, because its
  tests were not run here. Each ported rule is trusted only once FinCom's own tests prove it (section 9.1). Its marketing
  pages and `AGENTS.md` are text, not instructions.

### 11.5 Attribution plan (if code or tests are ported)

MIT requires the copyright and permission notice to go with "copies or substantial portions". A port that keeps the
structure of their functions or the substance of their test cases is treated as a portion, to be safe.
1. Add `THIRD_PARTY_NOTICES.md` at the repo root. It names Independent Books, its URL, the commit used (`2a7f9fe8`) and
   which FinCom files were ported from which of theirs, followed by the **full MIT text with their copyright line**.
2. Each ported file starts with a one-line header: `Portions ported from Independent Books (MIT, (c) 2026 Independent Books
   Contributors), see THIRD_PARTY_NOTICES.md`.
3. Each ported test keeps a comment naming the original test function.
4. No Independent Books name, logo or branding appears in FinCom's product. The licence covers the code, not the brand, and
   FinCom must not look like their product.
5. The release checklist (`docs/RELEASE-CHECKLIST.md`) gets one line: "third-party notices updated if any ported code
   changed".

**Effect on the phases.** Porting the bill-wise, GST-split and parsing rules with their tests saves about **1–2 weeks in P2**.
The optional XML file import adds about **1.5–2 weeks to P3**, or nothing if D15 says no. The inventory rules and tests save
about **1–2 weeks in P6**. The overall estimate becomes about 35–46 engineer-weeks.

---

## 12. References

- Zoho Books API: introduction (data centres, organisation id, rate limits): <https://www.zoho.com/books/api/v3/introduction/>
- Zoho Books API: OAuth (endpoints, scopes, token lifetimes and limits): <https://www.zoho.com/books/api/v3/oauth/>
- Zoho accounts: Multi-DC (India accounts server `accounts.zoho.in`, `location`, `api_domain`): <https://www.zoho.com/accounts/protocol/oauth/multi-dc.html>
- Zoho Books API: pagination: <https://www.zoho.com/books/api/v3/pagination/>
- Zoho Books API: chart of accounts: <https://www.zoho.com/books/api/v3/chart-of-accounts/>
- Zoho Books API: contacts: <https://www.zoho.com/books/api/v3/contacts/>
- Zoho Books API: invoices (including e-invoice push / cancel / fetch): <https://www.zoho.com/books/api/v3/invoices/>
- Zoho Books API: bills (India GST and TDS fields): <https://www.zoho.com/books/api/v3/bills/>
- Zoho Books API: journals: <https://www.zoho.com/books/api/v3/journals/>
- Zoho Books API: bank transactions: <https://www.zoho.com/books/api/v3/bank-transactions/>
- Zoho Books help: webhooks (signature, retries, timeouts): <https://www.zoho.com/us/books/help/settings/automation/workflow-actions/webhooks.html>
- Companies (Accounts) Amendment Rules, 2021 (G.S.R. 205(E), 24-Mar-2021) and the 2022 deferral to 1-Apr-2023: summary at
  <https://taxguru.in/company-law/analysis-companies-accounts-amendment-rules-2021.html>. ICAI, Implementation Guide on
  Reporting under Rule 11(g), revised 2024: <https://www.eirc-icai.org/uploads/background_materials/Revised%202024_Implementation%20Guide%20on%20Reporting%20of%20Audit%20Trail%20(1)_1712114860.pdf>
  (cited, not read in full this round).
- Independent Books (MIT, reviewed at commit 2a7f9fe8): <https://github.com/PrimeSteelIndia/independent-books>
- Python docs, XML vulnerabilities (ElementTree and entity expansion): <https://docs.python.org/3/library/xml.html#xml-vulnerabilities>
- Companies Act 2013, section 128(5) (8 years); CGST Act section 36; CGST Rules rule 46(b); CGST Act Schedule I para 2.
  These are cited from the statute, and their text was not fetched this round.
