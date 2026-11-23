# Moving the reports onto FinCom Books: the plan (a later phase, P1d)

**Status:** PLAN ONLY. In phase 1 no existing report reads `fb_*`, and this branch changes none of them. This page says
how each report moves later, safely and one at a time. Plan sections 3.2 and 3.3, and acceptance rule A9, are the
basis: **a report moves only when it gives figures identical to the paisa on both inputs, for every staging client and
every period it covers.**

## The rule for every report

1. **One read layer.** `Books.read` (app) and `server/_shared/booksread.js` (edge functions) read only `fb_*`, through
   new readers in a later migration. They give **the shape the report already takes**, so no report engine changes,
   only its input:
   - `vouchers(cid, from, to)` gives BookSrc's entry list (`server/_shared/gst3b.js`): `{guid, date, vtype, vno, party,
     gstin, pos, lines: [{ledger, amount, hsn, rate}], bills, cc, cancel, optional, alter, src}`. It is built from
     `fb_vouchers` / `fb_lines` / `fb_bill_refs` / `fb_line_cc` at their current versions. The sign is turned back to
     the copy's: a credit positive, as the engines expect.
   - `balances(cid, dates)` gives the same `{date: {ledger: bal}}` as `tally_balances_json`, from `fb_closing`.
   - `masters(cid)` gives groups with `sch3_code`, and ledgers with GSTIN / PAN / state / TDS type.
   - `status(cid)` = `fb_status`, and the filing warning = `fb_filing_warning`.
2. **Proof before the switch (A9).** A harness (`tests/run_fbooks_parity.mjs` locally, and a staging job) runs the
   report's engine twice for every staging client and every period: once on today's input (BookSrc over the copy, the
   cloud figures) and once on `Books.read`. It compares the outputs field by field, to the paisa. Any difference is
   listed with the entries behind it, and the report does not switch.
3. **A flag per report and per firm.** The flag is `books_read.<report>` in the firm's settings; the default is the
   old input. It is turned on for one firm first (the owner's own), then for all. Turning it off is the rollback, and
   it needs no deploy.
4. **"Not in step" is shown, never hidden.** A report reading FinCom Books for a period that is not in step shows the
   banner. It warns only (D18). The figures shown are still FinCom Books', which equal the source's whenever the books
   are in step.
5. **Size.** Every switch is in lazy chunks. The legacy file's budget (≤ 600,000 B gzip) has almost no room, so the
   legacy screens call one small global (`Books.read`), loaded with the screen's own chunk.

## The order (the least risk first)

| Step | Report | Today's input | After | Proof to pass |
|---|---|---|---|---|
| 0 | **Filing warning** on GSTR-1, GSTR-3B, 26Q / 24Q (D18) | none | `fb_filing_warning(client, from, to)` before Submit: "FinCom Books is not in step with Tally for this period: … You can still file." Never blocks. | Shown on a not-in-step period, absent otherwise. Filing still works with the warning on screen. |
| 1 | **Day Book, Ledger, Trial balance** (Look up, Reports) | the copy / cloud figures (migrations 151 / 152) | `fb_daybook`, `fb_ledger`, `fb_tb` | Every ledger's balance at every month end, and every day's entries, equal. Already proven per ledger in `run_migration220.py` and `run_fbooks_ui.py`; the harness covers every client. |
| 2 | **Daily Check** | the copy | FinCom Books, plus the tie-out result, the sent-not-back list and the self-check | Each night's findings are identical on both inputs for 14 nights. |
| 3 | **MIS, balance sheet, P&L, My MIS** | copy + ledger list | `balances` + `sch3_code`, with the ledger list's choices kept as overrides | Every figure of every MIS pack and statement, for every month, equal. A Schedule III line that differs because the mapping differs is listed for the owner, never switched silently. |
| 4 | **TDS** (26Q, 24Q, challans) | BookSrc | `vouchers` | Every deduction by section, party and quarter, and every FVU file, byte-identical. |
| 5 | **GST** (GSTR-1, 3B, 9 / 9C, 2B match, e-invoice) | BookSrc, `gst3b.js`, gst-run | `vouchers`; the engines unchanged | Every table of every return for every month already filed, identical, plus the JSON byte-identical. GST is last among the returns because the filed returns are the strictest check. |
| 6 | **ITR, audit / 3CD** | TB / P&L from the copy | `balances` + `sch3_code` | The computation and every 3CD clause equal for AY 2026-27 on every client with books. |
| 7 | **Bank, purchase, sales "already in the books" checks** | the copy | `vouchers` | The same matches on every client's last three months. |

After every report has switched and run for a full return cycle with no difference, the copy (`tally_*`) stays as the
landing zone only (plan 0.5). Nothing is dropped.

## What each switch must not do

- It must not change the Tally path: the bridge, `24-tally-bridge.js`, `49-tally-cloud.js` and `server/tally-cloud`.
- It must not read a stored total. Every figure is recomputed from the entries (A8).
- It must not block a filing because of "Not in step" (D18: warn only).
- It must not count a `sent`, `held`, memo or cancelled entry in a total (D19).

## Effort

About 5–7 engineer-weeks (plan section 9, P1d), most of it the parity harness and the GST step. Each step is its own
branch with its own review.
