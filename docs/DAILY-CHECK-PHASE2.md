# Daily Check, phase 2: FinCom prepares the remaining entries itself

Branch `next-daily-p2` (from `staging-next`, which holds phase 1). Designed and built 22-Nov-2026. **Nothing is applied,
deployed, published or merged**: the owner reviews the screenshots, then applies and deploys. Made-up data only, in the
tests and the screenshots. Phase 1 is `docs/ASSISTANT-PHASE1.md`.

## 0b. The final review of 96cb62381, and what changed

- A claim left by a closed tab is settled to approved ONLY with proof the voucher reached Tally: FinCom's id
  ("TDSDesk:dc-…") in the client's books, or the cloud's job reporting THIS voucher's result ok. A job still waiting,
  taken or running leaves it being approved; anything else (a draft saying posting or posted with no job, a job done with
  this voucher refused, a stopped job) goes back to ready ("Not confirmed in Tally" in the log). The server
  (`asst_draft_state`) and the night and page (`draftState`) read the per-voucher results by the same rule.
- The exclusion is month-specific (`excl:<reg>:<ym>:<voucher id>`): one hand journal can be excluded from several months.
- "That journal is not for <month>" is the owner's, enforced on the server (trigger `night_findings_exclude_owner`) and on
  the page.
- Ledgers named payroll, employee benefit or employee cost are salary-named: not the payroll's ledger, the month is Needs
  you.

## 0a. The re-review of 1e4b2f1f9 (N1-N5), and what changed

- **N1** "Another month's" is decided ONLY by lines: a tax-only entry is another month's set-off when its lines are that
  month's computed set-off within ₹1 a line. The narration never decides. `namesMonth` no longer reads a full date
  ("20/11/2026") as a month. Tested with the reviewer's case.
- **N2** A tax journal that may be the month's set-off is its own question (`setoff_exclude`, Needs you): "That journal is
  not for <month>" (recorded by finding_choose, logged) lets the month go on; "Not needed" stays. The set-off waiting on it
  is not shown twice.
- **N3** Exact or nothing: a set-off is ready ONLY for a month whose 3B is kept as filed (its copy); a filed date alone is
  Needs you: "keep this 3B as filed first". The AlterID inference of M2 is removed.
- **N4** Claims left by a closed tab are settled on the server (`entry_settle` each night, and in `entry_claim` for a stale
  claim): a live draft (posted or on its way) -> approved; a failed one, or none after 30 minutes -> ready, then the
  second check's "already approved" applies. A draft whose queued posting the cloud's queue stopped (failed, cancelled, or
  its result not ok) counts as failed and the entry is offered again (night, page and server alike).
- **N5** Salary is decided exactly: "yes" is the salary ledger the payroll uses (certain by name, or the owner's pick) and
  the other ledgers of its sub-group only when every ledger there is salary-named; another expense named like salary
  (salary, wages, remuneration, stipend, bonus, staff pay; not auditors' remuneration or staff welfare) is "maybe" and makes
  the month Needs you. Each entry counts for one month only (`salaryEntries`: a 1st-10th entry is lent to the month before
  only when that month has none of its own after the 10th).
- **Lows** Approve refuses when the books open here are not the book the night read (each journal carries its book); a
  ledger confirmed outside its group passes only for the role it was confirmed for.

## 0. The independent review of 3548a7b8a, and what changed

- **H1** The set-off already in the books is looked for from the month's start up to tonight (a set-off booked late by
  hand, after the filing date, anywhere in the look-back), under **any voucher type** (L5: tax-only by its lines, rounding
  at most ₹10). A tax-only entry there that is not clearly another month's (the same lines as another month's set-off, or a
  narration naming another month) is Needs you.
- **H2** Salary is booked for a month when a salary-like expense is debited by an entry dated in the month, or up to the
  10th of the next, or naming the month (`forMonth`, `namesMonth`, `salaryLike` in nightchecks: one rule for the payroll
  journal and the salary payments). Salary-like: named salary, wages, staff, remuneration, stipend or bonus, or in the
  salary ledger's own group when that is a sub-group (a primary group such as Indirect Expenses would make rent salary).
  The same gross: nothing; anything else: Needs you.
- **M1** `setoffMin` replaces the copy of GSTR.setOff: the least cash the law allows, found by its own method (49(5), 49A and
  88A as constraints; the one free choice, IGST credit's share to CGST, tried at every breakpoint), checked against a
  brute-force search of every legal allocation. `setoffLegal` now enforces 49A (no CGST or SGST credit while IGST credit is
  left that could pay); the reviewer's case (CGST 100, IGST credit 100, CGST credit 100) is tested. Ready only when the
  app's allocation is legal, pays exactly the least cash, and the journal follows it to the paisa.
- **M2** (replaced by N3) Filed with no copy kept: if an entry of the month has an AlterID above the highest the bridge had read by the end of
  the filing day (`tally_sync_reads`), or no read was made by then, Needs you ("keep the 3B as filed").
- **M3** Approve claims the entry on the server first (`entry_claim`: ready -> approving, one at a time), posts, then
  `entry_approved`; a failed post `entry_release`s it; a claim left 30 minutes may be taken again; the page shows "Being
  approved" meanwhile.
- **L1** A salary payment is resolved only to the paisa (₹0.01 to ₹1: Needs you). **L2** One net (`sheetNet`: less TDS, PT,
  PF, ESI) everywhere. **L3** FinCom's own posted monthly entries continue the pattern. **L4** Kept as filed with no
  filing date, past the due date: Needs you. **L6** The cash line compared exactly. **L7** lock_timeout in the cron file.
  **L8** No ledger of the role in the right group: the ones of that name elsewhere are offered as "Use X anyway (under
  Y)" (an explicit confirmation, then accepted), with the right group's ledgers, so it never stays stuck.

## 1. What it does, in one paragraph

Each night, after phase 1's checks, FinCom prepares four more kinds of entry from what it already holds: the **GST set-off
journal** of each month whose GSTR-3B is marked filed or kept as filed; the **payroll journal** of each month of the salary
sheet; each **salary payment** in the bank that pays one employee their net; and the **monthly entries** the books repeat
(rent, depreciation, interest, a retainer) when this month's is missing. Each is an entry on the existing **Entries** tab,
with its trace (where every figure comes from) and the checks it passed. Anything uncertain goes to **Needs you**, never to
Entries. **Nothing posts on its own**: the owner presses Approve, FinCom checks again, and the entry goes to Tally through
the existing path.

## 2. The screens (made-up data)

Screenshots in `scratchpad/shots-daily2/` (deviceScaleFactor 2, desktop 1440 and phone 390; each `-desktop` and `-phone`):
`1-entries` (the four entries collapsed, with phase 1's), `2-setoff-open`, `3-payroll-open`, `4-salary-payment-open`,
`5-rent-open`, `6-needs-you-pick-ledger`, `7-promotion-suggestion`, `8-trust-levels`, `9-reminder-switch`, and
`10-entries-setoff-open-dark-desktop`. Every entry in them was made by the real builders on made-up books
(`tests/daily2_fixture.mjs`), so the screens show exactly what the night would show.

Calm, as approved for phase 1: one line a row, details only when opened.
- **Entries**: `Journal · 20-Nov · GSTR-3B Oct 2026 · GST set-off · ₹1,57,500`, `Journal · 31-Oct · Salary sheet Oct 2026 ·
  Payroll`, `Payment · 01-Nov · Ravi Kumar · Salary sheet`, `Journal · 01-Nov · Sample Landlord · Monthly`. The same
  ✓ Checks chip, Approve and Reject icons and ticks as phase 1.
- **Opened**: the client and narration; Dr/Cr with totals; the trace (each GST head "tax = credit + cash"; each employee
  "gross − deductions = net"; "Same entry 3 months in a row (Aug–Oct 2026), ₹45,000 each, about the 1st" with the three
  entries); then one quiet line of the checks it passed. A journal FinCom made has no Edit: Reject it and enter it by hand.
- **Promotion suggestion** (owner only, top of Entries): "Sample Traders Pvt Ltd · Bank line booking: 23 approved as made.
  Move to "Do it, then tell me"?" with **Move** and **Not now**.
- **Needs you**: a ledger to pick shows the candidates as buttons and "Not needed" (no "Ask client": it is the firm's);
  the journal waiting on the pick is not listed twice. A set-off, payroll or monthly entry that cannot be made says why in
  one line ("Set-off Oct 2026: interest of about ₹106.52 (15 days late). Type the portal's figure on the GST page.").
- **Client setup › Company**: a card "What FinCom may do by itself": five rows (Bank line booking, Monthly entries, Payroll
  journal, GST set-off, New ledger), each a three-way switch (Ask first · Do, then tell · Quietly), a limit ("Never above ₹
  ___ alone") and one line: "For now every entry still waits for your Approve." The owner changes them; staff see them.
- **Remind by itself** (phase 1's switch in Contacts) now says what it does: on, "Documents asked for once are asked again,
  at most weekly. In test mode, to your firm only."; off, "Off: nothing is sent without you."
- Phone: the same, stacked; the Dr/Cr columns fit 390 px; no sideways scroll (tested).

## 3. Reuse map: nothing invented where the app has it

| Need | Reused | Where |
|---|---|---|
| The month's 3B, its set-off and its journal | `GSTR.threeB`, `GSTR.setOff` (sections 49, 49A, rule 88A), `GSTF.journal` (the GST page's "Set-off journal for Tally") | `server/_shared/gst3b.js` (the same object as legacy 12/35/37), run in the night inside nightinput's `withApp` and in the browser from legacy's globals |
| Interest and late fee | `GSTF.interest`, `GSTF.lateFee`, and the portal's own figures kept on the month (`portalInt`, `portalFee3`) | gst3b.js; the GST page's filing card (`app/src/screens/gst/Filing.jsx`) |
| "Filed" | the month's filed mark and kept copy (`gstFiled[reg][ym].r3b`, `.snap`, `GSTF.filed3b`) | gst3b.js / 35-gst-filing.js |
| The client's GST ledger names | FinCom's ledger list (`books.map`: kind, tax, side, reverse charge) and the cash ledger GST settings keep | the app's own; nothing guessed afresh |
| A set-off already in the books | phase 1's tax-only journal test (nightchecks `unusual`), reused as `taxOnly` | `dailyjournals.js` |
| The salary sheet | `client_book_items` "salary" (TDS24Q.fromFile, 17-24q.js), `sheetMonth`, `sheetNet` | `nightchecks.js` (now exported) |
| A salary line paying an employee | phase 1's bank self-answer (candidates, ties, near misses, the entry `bank_self_answer`, Approve = the Bank page's own `bankSetLedger`) | `nightchecks.js` step 4, extended |
| Entry checks | phase 1's `checkEntry` (Dr = Cr, ledgers in Tally, closed period) | `nightchecks.js` |
| Storage and idempotency | `night_findings` (unique kind+key), `night_entries` (unique dedupe), `night_apply`, `finding_choose`, `entry_decide` | migrations 206/207, unchanged |
| **Posting a journal** | **the existing path for a hand-made voucher**: `app/src/lib/asstEntries.js` (its checks `voucherProblems`, `postGate`, the ONE XML builder `draftVoucherXml`, `postDraft` → `Bridge.post`: the bridge here or the cloud's queue `tally_post_enqueue` / `tally_post_jobs`; the draft kept in `client_book_items` "asstEntries" with its log) | unchanged; Daily Check's drafts have ids `dc-…` and are never shown in the chat |
| Sending reminders | phase 1's guard (`sendguard.js` plan/mail), message (`asks.js`), send log (`ask_send_begin` / `ask_send_finish`) | unchanged |

### The Tally rule: checked, no new request
The existing path already posts **Journal vouchers with several ledger lines**: a purchase bill is posted as a Journal by
default (`billVt`: `co.voucherType || "Journal"`, src/js/03) with its expense, GST, TDS and party lines (`voucherXml`,
src/js/01), and Ask FinCom's drafts are posted as any voucher type with any number of lines (`draftVoucherXml`,
app/src/lib/asstEntries.js). Both go through `Bridge.post` → bridge-go `post.go` (any voucher XML, Import Data) or the cloud
queue `tally_post_jobs`. Daily Check's journals use `draftVoucherXml` **unchanged**. No new Tally request XML; bridge-go is
not changed.

## 4. How each builder works (server/_shared/dailyjournals.js)

**1. GST set-off.** For each of the last 6 months marked filed or kept as filed (monthly returns; a quarterly return is left
to the person): the app's journal (`GSTF.journal`): Dr each output ledger (credit used + cash), Cr each input ledger (credit
used), Dr the reverse-charge payable (paid in cash), Cr the GST cash ledger (all cash), paise of rounding on the last line.
Interest and late fee are added (Dr their expense ledgers, Cr the cash ledger) **only with the portal's figure**; one worked
out here and not confirmed is Needs you. Dated the 3B's filing date (else its due date). Not made when: the month has
nothing to set off (a zero month, or more credit notes than sales); the 3B kept as filed differs from the books now; a GST
ledger is missing from FinCom's list; a journal of the same lines is in the books in that month or the next; a different
tax journal there may be it (Needs you); Daily Check posted it already (its id in Tally's narration) or approved it.

**2. Payroll.** For each month of the sheet that has ended (last 6 months, not before the books begin): every employee
gross = net + TDS + professional tax + PF + ESI to the paisa (the sheet's own net when it has one); Dr salary (gross), Cr
TDS on salary, professional tax, PF, ESI payable, Cr salary payable (net). Dated the month's last day. Not made when:
surcharge or cess on the TDS, an employee twice, a row that does not add up, salary already booked that month (the same
gross: nothing; another amount: Needs you), a ledger not certain.

**Ledgers, certainly** (`pickLedger`): exactly one ledger matching the role's name AND in the role's group (salary in
expenses; TDS, PT, PF, ESI in Duties & Taxes or current liabilities; salary payable in current liabilities or provisions;
TDS on salary also by FinCom's kind "tds_payable" section 192, and preferred when several match). Two or none: a
`ledger_pick` finding under Needs you with the candidates; the person's pick is kept (finding_choose) and used every night
while that ledger is in Tally and in the group.

**3. Salary payments.** A bank line whose decoded name is the sheet's name (by `ledgerKey`), within ₹1 of that employee's
net, for the month it pays (a line by the 15th pays the month before), one row of that name: a ready bank entry against
salary payable, **only when** the salary payable ledger is certain and that month's payroll is booked to it (in the books, or
its Daily Check journal approved). Else Needs you. Phase 1's bulk "salary sheet total" match follows the same rule now.

**4. Monthly entries.** A journal with no bank or cash line (not tax-only, not salary) with the same ledgers on the same sides
once a month, 3 or more months in a row, amounts within 2% of each other. When the next month's is missing past its usual
day + 5 (a month-end pattern: the month's end + 5), it is proposed, dated the usual day: **ready only when the last three
were the very same lines to the paisa**; amounts that moved within 2% are Needs you ("enter it by hand"). Two months missed:
the pattern is broken, nothing. An entry that month to the same expense for about the amount (other ledgers): Needs you.

**Ids.** Each entry's dedupe is `setoff:<reg>:<ym>`, `payroll:<ym>`, `rec:<pattern>:<ym>`; its Tally id is
`voucherId(dedupe)` (`dc-…`, the same every night), stamped "TDSDesk:dc-…" in the narration as every FinCom voucher is.

## 5. Data model: migration 208 (a draft, NOT applied)

`server/assistant-night/migration-208-daily-phase2.sql` (md5 2b23b59718e58e261459519be17922d1) and
`server/assistant-night/migration-208-cron.sql` (md5 f1a2d0d8d49d70cf9faf8b30e834830b). One transaction each, lock_timeout
10 s, safe twice, add-only.
- Stops first unless 206 and 207 are in, and if any of its names (`daily_trust`, `trust_set`, `trust_dismiss`,
  `trust_stats`, `trust_kind_of`, `remind_due`, `remind_logged`) is already used by something else (checked by its comment
  mark, as 206).
- `night_findings.kind` may also be `setoff_due`, `payroll_due`, `recurring_due`, `ledger_pick`; `night_entries.source` may
  also be `gst_setoff`, `payroll`, `recurring`: each check dropped and made again with more values, **by name, only if it is
  206's** (as 207 did for `closed_by`). No row is changed; nothing of 206 or 207 is replaced (`night_apply`, `entry_decide`,
  `finding_choose` work as they are).
- `daily_trust (firm_id, client_id, kind, level 0..2 default 0, limit_amt >= 0, dismissed_at, set_by, set_at)`, primary key
  (firm, client, kind); kind `bank`, `recurring`, `payroll`, `setoff`, `new_ledger`, or `*` (the client's limit). RLS: the
  firm reads its rows; no write policy.
- `trust_set(client, kind, level, limit)` and `trust_dismiss(client, kind)`: the OWNER only (`asst_is_owner`), the client
  must be the firm's, logged (`daily_log` "trust", "trust_later"). `trust_stats()`: per client and kind, approvals through
  Daily Check since the last rejection, level change or put-off (the page's suggestion at 20).
- `remind_due(p_live)` and `remind_logged(...)`: service role only (assistant-night's timer).
- `entry_settle(firm, client, failed[])` (the night, service role) and `asst_draft_state` (internal) settle claims left by
  a closed tab from their drafts (review N4); `night_findings.kind` also allows `setoff_exclude` (N2).
- `entry_claim(id)`, `entry_release(id, why)`, `entry_approved(id, work_ref)` (review M3), owners and staff; with
  `night_entries.state` widened by name to allow `approving` (night_apply touches only ready, held and withdrawn).
- Grants: everything taken back from public, anon and authenticated; then authenticated: `select` on daily_trust, `execute` on
  trust_set / trust_dismiss / trust_stats; service_role: the table and the two reminder functions.
- `migration-208-cron.sql`: `assistant-night-remind`, daily at 04:43 UTC (10:13 India), Vault's `gst_cron_key` as the night's.

## 6. Acceptance rules (phase 1's seven, extended)

Phase 1's rules 1 to 7 stand. Phase 2 adds the owner's rules of 22-Nov-2026 ("every piece of work accurate, no errors"):

8. **Exact or nothing.** No entry is ready unless every figure traces to a source row: the 3B's figures, a salary sheet
   line, a bank line, or the prior months' entries; the trace is in its evidence. Uncertain: Needs you, never a guess.
   (Interest and late fee only with the portal's figure; a monthly entry only when the last three were the same.)
9. **Arithmetic proved.** Dr = Cr to the paisa. Set-off: each head's tax = credit used + cash paid, in the legal order (IGST
   first; CGST and SGST never across; cess only cess; cash only when no credit that may pay is left; reverse charge in cash),
   checked by `setoffLegal`; the total equals the app's 3B set-off exactly (a differential test). Payroll: gross = net +
   deductions for every employee and in total.
10. **The books first.** No entry when it or one of the same kind for the same month is in Tally (or the cloud copy) or
    approved and pending; ledgers in Tally and in the right groups (output and input GST in Duties & Taxes, the cash ledger in
    Duties & Taxes or current assets, salary in expenses, payables in liabilities); the period open.
11. **A second check before posting.** At Approve the same builder runs again on the books as they are now
    (`app/src/screens/daily/again.js`); anything different (a line, the date, a check, an entry or approval since) refuses:
    "Changed since last night. Run again." Then the existing path's own checks (ledgers in Tally, Dr = Cr, the post gate) and
    the bridge's own duplicate check by FinCom's id.
12. **Independent recomputation.** The set-off: the app's allocation must be legal and pay exactly the least cash found by an
    independent method (`setoffMin`, itself checked by brute force); the payroll: the builder and `payrollPlain` (paise)
    agree. Ready only then.
13. **Edge cases tested**: a zero tax month, more credit notes than sales (negative liability), reverse charge paid in cash
    only, interest and late fee, rounding (paise), an employee with no TDS, a mid-month joiner, a missing ledger, a closed
    period, the same night again.
14. **Trust levels never post by themselves in this phase** (decision D1); every level still waits for Approve. A level and
    the limit are set by the owner only, logged.
15. **Reminders only as phase 1's rule 7 says**: off by default; when on, only document requests already asked once, at most
    once a week a question and a client, through the same guard (test mode: the firm's own address only, whatever else says).

## 7. Tests (all made-up)

| Test | What | Result |
|---|---|---|
| `node tests/run_dailyjournals.mjs` (114 after the review: H1, H2, M1 incl. brute force and the reviewer's case, M2, L1-L5, L8) | the builders through the night's own path (gst-run engine, nightinput, the app's GSTR/GSTF): set-off (ready, missing ledger, zero month, negative liability, RCM only, interest and late fee, paise, in the books, a different tax journal, posted, pending, refused draft, closed period, changed since filed, wrong group, not filed, a tampered journal, the legal order); the **differential**: `setoffPlain` = `GSTR.setOff` on 3,000 random months to the paisa, the legal order on each, and the journal total = the 3B's credit + cash on made-up books; payroll (ready, net off by a paisa, PF/ESI, surcharge, twice, missing ledger, a tie, a person's pick, wrong group, booked, booked for another amount, pending, closed, month not over); salary payments (match, ₹1.01, the month, payroll not booked, two of a name, two payables); monthly (ready, not yet due, present, two months, broken, moved within 2%, outside 2%, booked another way, month-end, closed, from the bank, pending); every entry ready only with every check; trust gate and promotion; each twice | 129 passed |
| `node tests/run_daily_again.mjs` | the second check at Approve: unchanged goes on; a line, the date, a sale added, the sheet edited, a ledger gone, the period closed, booked by hand, approved already, posted already: refused | 17 passed |
| `python3 tests/run_migration208.py` (pg_stand, after 206 and 207, Supabase's default grants simulated) | stops before 207 and on a clash (nothing changed); safe twice; grants (public/anon nothing, authenticated minimal, service role the reminders); the widened checks; night_apply with phase 2 (idempotent, held, a pick kept, cleared); trust_set (owner only, logged, other firms, bad input, RLS, no direct writes); trust_stats (since rejection, put-off, level change); remind_due (off, never asked, 3 days, a week, document requests only, the owner who turned it on, server switch off, real sending needs a real ask, logged then 7 days, resolved, answered, owner inactive, not callable by a person) | 68 passed (the claim, the closed tab, the proof rule, the owner-only exclusion) |
| `deno test --no-check server/assistant-night/handler_test.ts` | the reminder action: the timer only; test mode to the firm only, marked; **never a client's address in test mode** across both firm switches and 4 server values; both switches: the client's; guard refusal, daily limit, Resend failing: logged | 5 passed |
| `node tests/run_nightchecks.mjs` | phase 1's, with the salary rule now strict (payroll booked, payable certain) | 127 passed |
| `python3 tests/run_daily_check_p2_ui.py` | the page: the four rows, opened (lines, trace, checks, no Edit), Approve refused by the second check (nothing posted or recorded), the suggestion (Move, Not now, staff none), the pick (no Ask client, not twice, finding_choose), Done, the trust card (owner, limit, staff), the reminder line, phone 390 | 34 passed |
| phase 1's `run_assistant_night.mjs`, `run_assistant_guard.mjs`, `run_assistant_message.mjs`, `run_nightchecks_diff.js`, `run_daily_check_ui.py`, `run_migration206.py`, `assistant-send/handler_test.ts`; `run_every_screen.py`, `run_legacy_room.py` | unchanged behaviour | passed (see the commit) |

## 8. Sizes (gzip, level 6 as phase 1 measured)

legacy.js **599,738** (unchanged; limit 600,000). Main index **260,646** (limit 264,192). Daily Check chunk 6,767; the second
check (`again`, with the builders) 13,802, loaded only when a journal is approved; the trust card is in the Settings chunk
(already lazy).

## 9. Owner decisions

- **D1 (STOP, needs the owner): posting with no one pressing Approve.** Trust levels 1 and 2 ("do it, then tell me", "do it
  quietly") would post without a person. Every posting path today runs from a person's session (`Bridge.post` from the
  browser: to the bridge here, or into `tally_post_jobs` through `tally_post_enqueue` with the person's sign-in). Posting at
  night would need a **new server path** that builds the voucher and queues it with no one signed in. Not built: the levels,
  their settings, the limit and the suggestions are built; `AUTO_POSTING = false` (server/_shared/dailytrust.js) keeps every
  level asking. To decide: whether a server path may enqueue Daily Check's journals (and under which limit), and how "undo
  within 24 hours" is done in Tally (through the existing undo of a posted entry).
- **D2: the kinds.** Bank line booking, monthly entries, payroll journal, GST set-off, new ledger (no Daily Check action makes
  a new ledger in phase 2; its level is kept for later). An Inbox bill for a 2B gap is not a kind of its own.
- **D3: the suggestion** after 20 approvals made as FinCom made them, since the last rejection, level change or "Not now";
  one level up at a time; the owner's press only.
- **D4: interest and late fee** go into the set-off only with the portal's figure typed on the GST page (FinCom's own figure
  is shown in Needs you, not used).
- **D5: a monthly entry** is ready only when the last three were identical; amounts that moved within 2% ask the person.
- **D6: the salary rule** of phase 1 (a bulk salary line against the sheet's total) now also needs the payroll booked to a
  certain salary payable (else Needs you). Phase 1's test was changed to say so.
- **D7: posting a journal** goes to Tally at once on Approve (the existing path for a hand-made voucher, as Ask FinCom's
  drafts do), not to the Post page's Ready list (that list holds bills and bank lines); the posting is recorded on the Post
  page as every posting is.
- **D8: reminders** are sent by the night function's own timer (verify_jwt is off there and it already checks the timer's
  key), on behalf of the owner who turned the switch on (if no longer an active owner, nothing is sent).

## 10. Files to apply and deploy (staging only, in this order; after the review)

1. `server/assistant-night/migration-208-daily-phase2.sql` (md5 2b23b59718e58e261459519be17922d1).
2. Deploy **assistant-night** again (it reads the drafts' `tally_post_jobs` and calls `entry_settle`; it imports `../_shared/dailyjournals.js`, `../_shared/dailytrust.js`, the changed
   `../_shared/nightchecks.js`, and `asks.js` / `sendguard.js` for the reminders). **assistant-send** is unchanged.
3. `server/assistant-night/migration-208-cron.sql` (md5 f1a2d0d8d49d70cf9faf8b30e834830b), once the function answers.
4. The app (the page and the trust card): with the next release, after the owner has seen the screenshots.
Secrets: none new (`RESEND_API_KEY`, `ASSISTANT_MAIL_FROM`; `ASSISTANT_MAIL_LIVE` stays unset on staging).

## 11. Left for the review and after

1. The independent code review, then a check of every number against the source rows (rule 7).
2. On staging after applying: one night on a test client with a filed 3B and a salary sheet; compare the set-off with the
   GST page's own "Set-off journal for Tally" and the payroll with the sheet.
3. The owner's decision D1.
4. Approve's success path (postDraft → Bridge.post) is the existing path's own and tested there; Daily Check's tests stop at
   the second check and the post gate.
