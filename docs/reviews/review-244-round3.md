# FinCom Bridge 2.4.4 ("payroll and salary TDS from Tally"): review, round 3

- Reviewer: Claude (Claude Code), an independent reviewer. I did not write this code.
- Date: 12-Oct-2026
- Range 1 (bridge + cloud): `ac37face07dca03f01dfeda3566e2b06e99022a5..4e8ce205ddbdad39372328fefa6f455e350d510c` (origin/next-payroll)
  - The head is as expected (`4e8ce205d`).
- Range 2 (app): `dbce3b97d887ee2c72cc089444680006e1efac3e...f2e59100881133d229a83f9b4fc9e1d2a9083a8a` (origin/arc-ui...origin/app-payroll), limited to `src/js app/src tests`
  - The merge base is arc-ui's tip, `dbce3b97d`. The head is as expected (`f2e591008`), and it merges next-payroll `4e8ce205d`.
  - The part of the diff that Range 1 covers is not reviewed again here. New in this range since round 2: `bf67c7ae5` (`tests/run_e2e_payroll_real.py`, `tests/fixtures/payroll-e2e/real-7.1/bodies.xml` and `SOURCE.txt`, one line in `tests/ci/tests.txt`).
- Rounds 1 and 2: origin/review-244-r1 and origin/review-244-r2 (`docs/reviews/review-244-round{1,2}.md`). The fix reviewed here is `4e8ce205ddbdad39372328fefa6f455e350d510c`.

This was a read-only combined code and security review. No code branch was changed, and no database, Tally or artifact was touched. Line numbers are on the heads above.

What I ran (in scratch worktrees of the two heads):
- On next-payroll (`4e8ce205d`), in `bridge-go`: `go vet . && go test -count=1 -run 'Payroll|Pay244|Employee|244|Allow|Pin|Shape|Release|Ledger|Fast|Day|Keep|Cloud|Round10' .`. Vet was clean, and the tests printed **ok** (135.4 s).
- On next-payroll: `node tests/run_parse_payroll.mjs` printed **ALL PASS**.
- On next-payroll, with Deno 2.1.4 (installed from npm into the scratchpad; the real binary, not npm's Node shim, because the shim leaves the function running on port 8000 when the test restarts it):
  - `python3 tests/run_payroll_ingest.py` printed **ALL OK: 0**.
  - `python3 tests/run_upload_split.py` exited 0 with 63 checks ok and none failed. That includes the new section E: no bank details in the days queued, and the uploaded file removed.
- On app-payroll (`f2e591008`):
  - `python3 build.py` exited 0.
  - `node tests/run_tds_tally.mjs` printed **all ok**.
  - `python3 tests/run_e2e_payroll.py` printed **ALL OK: 0**, through Postgres 16 and `tests/pg_stand.py`.
  - `python3 tests/run_e2e_payroll_real.py` printed **ALL OK: 0**. It reads `REAL=fixtures/payroll-e2e/real-7.1` (`run_e2e_payroll.py:51`).
- Not run: the full Go suite, `run_payroll_ui.py` and `run_migration74.py`.

## Findings

| Id | Severity | File:line | What | Why it matters | Fix |
|---|---|---|---|---|---|
| R3-M1 | Medium | `server/tally-cloud/index.ts:2583-2586`, `:2579`, `:2601`, `:2652` | The uploaded Day Book is removed from `tally-uploads` only on the success path: the piece whose `tally_upload_advance` moves the cursor to `end`. It stays in the bucket, whole, in four cases. (1) The job stops: any `Fatal` (`:2549` an entry over `MAX_TAIL`, `:2551` a day over `MAX_CARRY`, `:2462`, `:2495`) or the fifth failed try (`:2601`). Nothing removes the file there. (2) The last piece is killed after its advance commits and before the `remove` call, so its message is not archived. When it runs again, the file is still there, so it is read again. The advance answers `moved: false`, and the piece returns at `:2579`, before the removal. (3) `upload_done` refuses a stored file of another size (`:2652`, "upload it again"). The CA uploads again under a new job and path, and the first object is left. (4) Objects uploaded before this fix: round 2 asked for the owner's decision, and none is recorded. | Case (1) is most likely for exactly the companies with the most bank data. In the real 7.1 capture each employee's bank allocation is about 2.8 K characters (`full-SAL-PAY-NOV`: 44,776 characters for 3 employees). A salary payment to roughly 750 or more employees is over the 2 M-character `MAX_TAIL`, and a large company's salary day can pass `MAX_CARRY`. Either stops the job with a `Fatal`. The file then keeps every employee's account number, IFSC, name in favour and bank, and every member of the firm can read it (`migration-47:190`). The 2.4.4 notes (item 3) say the file "is removed from the tally-uploads bucket once its last piece is queued", which is true only when the job ends well. | Remove the file whenever the upload job ends, not only on `end`. (a) In `work()`'s give-up branch (`:2601`), for a message with `upload`, remove `m.upload.path`. (b) At `:2579`, when `adv.at === "end"`, still run the removal (`remove` is idempotent). (c) In `upload_done`'s 409 size branch, remove the object (service role). For objects already in the bucket, get the owner's decision; a one-off service-role sweep of `tally-uploads` objects whose job is `done` or `failed` would clear them. Add a test for (a) and (b) to `run_upload_split.py` section D/E. |
| R3-L1 | Low | `server/tally-cloud/index.ts:2569`, `:2575-2577`; `migration-13-fast-sync.sql:98`; `index.ts:2617-2618` with `src/js/49-tally-cloud.js:1086-1088` | Every piece's message is archived in `pgmq.a_tally_work` (`tally_work_done` → `pgmq.archive`, kept), and nothing trims that archive. Two things in it still carry raw Tally text. (a) The next piece's message carries `tail`: the text of the voucher cut at the range end, taken from the raw text (`text.slice(tailStart)`), not cleaned. Only `pend` is cleaned (`:2530`, `:2534`). When a salary payment spans a 4 MB boundary, its first part goes into the archive with the account numbers, IFSC, names in favour and bank of the employees in it. Section E does not reach this, because its file is one piece. (b) The old hand-over (`stage_days`, used when the cloud has no `upload_new`) queues the browser's raw day files, which are cleaned only when `ingestDaysRaw` keeps them. The archived message keeps them raw. Unlike `tally_recorder` (`migration-47:146-158`, trimmed after 90 days by migration 48), `tally_work`'s queue and archive are neither closed to the API roles nor trimmed. | Owner rule 5 and the notes say no bank field is kept in the cloud. This is a smaller exposure than R3-M1: one cut voucher per boundary, readable by the service role (and by the API roles only if the project exposes pgmq). But it is kept indefinitely. | Run `dropBankDetails` on `tail` before it goes into `next`. Cutting a tag in two at the range end is harmless here: the tail is re-joined and the whole voucher is cleaned again when it is pushed to `pend`. For `stage_days`, clean each day in `ingestDaysRaw` as now, and add a `tally_work` archive trim to the existing pg_cron job, plus the revoke and RLS that 47 gave `tally_recorder`. Both are add-only SQL. |
| R3-L2 | Low | `bridge-go/payroll.go:530-557`; `bridge-go/cloud.go:100-103` | `bankCleanOnce` holds the list of days to send again only in memory. (a) If `saveFile` fails part-way (`:535`, for example a day file held open by an antivirus or backup program on Windows), it returns without queuing the days it already rewrote, and without re-making their month files. On the next round those files are clean (`c == t`), so they are skipped. They are never queued, and the `tally-days` copy of those days keeps the bank details. Their `daybook-<ym>.xml` also keeps them until something else rewrites that month. (b) `addCloudDays` does nothing when `cloudOn()` is false (`cloud.go:101`), yet the mark is written (`:557`). A bridge whose cloud settings are missing on that first round never sends those days again. | This only leaves the cloud copy dirty after a failed write or a cloud that is switched off, so it is narrow. But the R2-L1 promise ("those days sent again so the cloud's copy is replaced") then fails silently. | Queue each day (and re-make its month) as soon as its file is rewritten, or on a write error still queue the days already done and re-make their months. In (b), when `!cloudOn()`, don't write the mark, so the clean (which is then a no-op on disk) queues on a later round. Alternatively, keep the list in a file beside the mark until it is queued. |

## Round-2 findings

- **R2-M1 (the employee's own BANKNAME on the Day Book path): fixed.**
  - `dropBankDetails` (Go `payroll.go:479-511`, JS `parse.js:545-557`) now takes `BANKNAME`, `BANKBRANCHNAME`, `BENEFICIARYCODE`, `SWIFTCODE` and `BANKPARTYNAME` out of a `BANKALLOCATIONS.LIST` only when its `BANKEMPLOYEENAME` has content.
  - The three bank elements are still taken out anywhere.
  - The two copies are the same regexes. Tag names match exactly: `TAXBANKNAME` and an allocation naming no employee are untouched, and the unit test checks both.
  - On the real 7.1 salary payment, each employee block's remaining fields are `DATE`, `INSTRUMENTDATE`, `NAME` (the voucher's own reference), `TRANSACTIONTYPE`, `STATUS`, `PAYMENTMODE`, `BANKEMPLOYEENAME`, the bank-reconciliation status and `AMOUNT`. None of them is a bank or personal field.
  - The payroll entry and the Day Book capture carry no PAN, date of birth, Aadhaar or account field.
  - `bodies.xml` (Range 2, what the bridge sent from real 7.1) has `BANKEMPLOYEENAME` and no `ACCOUNTNUMBER`, `IFSCODE`, `PAYMENTFAVOURING` or `BANKNAME`.
- **R2-M2 (a Day Book uploaded in FinCom kept whole): partly fixed.** Each voucher is cleaned as `uploadPiece` cuts it, in both the main and late passes (`:2530`, `:2534`), so the day files queued and kept are clean. The file is removed on the success path. I checked that the removal never loses an upload still needed:
  - It happens only when the advance moves the cursor to `end`. A late pass is queued before that (`:2570-2575`, `nextAt` is `late:<a>`), so it still has the file.
  - A failed piece that is retried before the end finds the file, because the file is not removed yet.
  - A piece that runs again after the removal finds no file. It reads the job's cursor (`tally_jobs.upload.at`, which `tally_upload_advance` sets at `migration-47:942`), sees it has moved past its own position, and ends quietly. Its work was queued by its first run, in the same transaction that moved the cursor.
  - A file that is missing while the cursor is still this piece's own position throws, as before.

  What is still open: the failure, crash and abandoned paths, and the objects already in the bucket (R3-M1); and the raw `tail` in the archived queue messages (R3-L1).
- **R2-L1 (day and month files kept by earlier bridges): fixed, with a narrow gap (R3-L2).**
  - `bankCleanOnce` runs once per company folder, marked by `bank-clean-244.txt`, at the start of every `invokeCloudPush`.
  - It takes `keepMu` with `TryLock`, which is the lock every writer of day files holds. Those writers are `step` (keep.go:812, which covers `saveKeepDaysChanged`, `useKeepPosted` and `ledgerList` → `renameKeepLedger`), `importKeepSeed` and `importKeepOpening`. So it never races the keeper, and it cannot deadlock: it never blocks, and `addCloudDays` and `readKeepState` take no `keepMu`.
  - It rewrites only the files whose text changes, and re-makes only month files that exist (`writeKeepMonthFile`, the same build as before, with no change to `keep.json`'s counts).
  - It queues those days, and the push cleans again. `ingestDaysRaw` upserts the `tally-days` object unconditionally (`index.ts:2237`), so the cloud's copy is replaced.
  - The `.idx` files (GUID and alter id) and `countVouchers` are unaffected by taking tags out. The test checks entries, the month file, the queue and the send.

  The gap is R3-L2: a partial write failure, or a cloud that is off on that first round, drops the re-send.

## Checked, no finding

- **Counts, GUIDs and the cloud's day logic.** They are unchanged by the fix. `dropBankDetails` works inside each voucher and leaves the `VOUCHER` tags, `DATE`, `GUID` and `ALTERID`, so `uploadPiece`'s day cut (taken from `v` before cleaning), `ext`, `seen`, `top`, `countVouchers` and `indexText` are the same. Section E and section C of `run_upload_split.py` (the same file twice doubles nothing) pass.
- **The Storage removal itself.** It uses the service-role client on the job's own path (`path === firm + "/" + job + ".xml"`, which `:2495` checks), so no other firm's object can be named. A `remove` error is logged and does not fail the piece.
- **`fake_supabase.py` DELETE.** It matches supabase-js's `remove()` (`DELETE /storage/v1/object/<bucket>` with `{prefixes}`). The test asserts both that the file is gone and that it was removed.
- **Range 2's new test.** `run_e2e_payroll_real.py` only re-runs `run_e2e_payroll.py` with `REAL`. The fixture is the stripped bodies of a test company (made-up "PE …" employees). It carries no bank or personal field, and the oracle is unchanged.
- **The rest of both ranges, re-read for anything new beyond the fix.** I re-checked these against the owner's rules:
  - the FinComEmployees request (twelve fields, payroll rows only, no second id);
  - the four ledger fields;
  - the kept list (`BANKEMPLOYEENAME` and `AMOUNT` only, the three bank elements refused);
  - the 3-second exception for payroll vouchers only, with 2 s and one request in flight otherwise;
  - the pinned allow-list;
  - migration 74 (add-only, RLS `firm_id = public.my_firm()`);
  - parse.js's `salpay` and pay-head rows;
  - the app's 2026-27 arithmetic (round 2's fixes; both e2e runs to the paisa).

  Nothing changed there since round 2 apart from the fix commit, and I found nothing new.
- **A note, not a finding.** The same `MAX_TAIL` and `MAX_CARRY` limits mean a Day Book upload of a company with a very large payroll entry or salary payment stops with words rather than being read. That is older than 2.4.4 and is said to the CA. It matters here only because of R3-M1.

Verdict: 0 High, 1 Medium, 2 Low.
