# FinCom Bridge 2.4.4 ("payroll and salary TDS from Tally"): review, round 4

- Reviewer: Claude (Claude Code), an independent reviewer. I did not write this code.
- Date: 12-Oct-2026
- Range 1 (bridge + cloud): `ac37face07dca03f01dfeda3566e2b06e99022a5..9baf43d1112f0fdedb129cfee957968f2792b0e3` (origin/next-payroll)
  - The head is as expected (`9baf43d11`). New since round 3: `f041d539896d6c07c13e434eff16537dfea861b2` and `9baf43d1112f0fdedb129cfee957968f2792b0e3`.
- Range 2 (app): `dbce3b97d887ee2c72cc089444680006e1efac3e...df49f7b45b36e032959e33a530bfdad7fdad199e` (origin/arc-ui...origin/app-payroll), limited to `src/js app/src tests`
  - The merge base is arc-ui's tip, `dbce3b97d`. The head is as expected (`df49f7b45`), and it merges next-payroll `9baf43d11`.
  - Since round 3 (`f2e591008`), the only change in these paths is the merged `tests/run_upload_split.py` (18 lines, Range 1). Nothing app-only is new.
- Rounds 1 to 3: origin/review-244-r1, -r2 and -r3 (`docs/reviews/review-244-round{1,2,3}.md`).

This was a read-only combined code and security review. No code branch was changed, and no database, Tally or artifact was touched. Line numbers are on the heads above.

What I ran (in scratch worktrees of the two heads):
- On next-payroll (`9baf43d11`), in `bridge-go`: `go vet . && go test -count=1 -run 'Payroll|Pay244|Employee|244|Allow|Pin|Shape|Release|Ledger|Fast|Day|Keep|Cloud|Round10' .`. Vet was clean, and the tests printed **ok** (127.9 s).
- On next-payroll: `node tests/run_parse_payroll.mjs` printed **ALL PASS**.
- On next-payroll, with Deno 2.1.4 (the real binary, from npm's `@deno/linux-x64-glibc`, in the scratchpad):
  - `python3 tests/run_payroll_ingest.py` printed **ALL OK: 0**.
  - `python3 tests/run_upload_split.py`: exited 0 and printed **all passed** (68 checks ok, including the new E2, E3 and M4/L2 lines)
- On app-payroll (`df49f7b45`):
  - `python3 build.py`: exited 0
  - `node tests/run_tds_tally.mjs`: printed **all ok**
  - `python3 tests/run_e2e_payroll.py` (Postgres 16 through `tests/pg_stand.py`) printed **ALL OK: 0**
  - `python3 tests/run_e2e_payroll_real.py` printed **ALL OK: 0**
- A check of my own: `dropBankDetails` from `server/tally-cloud/parse.js` run on a salary payment cut inside an employee's bank allocation (the R4-L1 case below).
- Not run: the full Go suite, `run_payroll_ui.py` and `run_migration74.py`.

## Findings

| Id | Severity | File:line | What | Why it matters | Fix |
|---|---|---|---|---|---|
| R4-L1 | Low | `server/tally-cloud/index.ts:2542`; `server/tally-cloud/parse.js:545-557` | The R3-L1 fix cleans the carried `tail` with `dropBankDetails`, but that function only removes whole elements: `<TAG>…</TAG>`, and the employee's own bank only in a whole `<BANKALLOCATIONS.LIST>…</BANKALLOCATIONS.LIST>`. The tail ends wherever the 4 MB piece ends. When that falls inside an employee's bank allocation, that allocation is open, and everything already in it stays in the next piece's message (which `pgmq.a_tally_work` keeps). I ran `dropBankDetails` on a tail cut just before `</ACCOUNTNUMBER>`. It returned `<BANKEMPLOYEENAME>Ravi</BANKEMPLOYEENAME><BANKNAME>HDFC Bank</BANKNAME><ACCOUNTNUMBER>50100123456789`: the full account number and bank. A cut before `</PAYMENTFAVOURING>` keeps the name in favour, and a cut before `</AMOUNT>` keeps `BANKNAME`. The code's own comment ("a tag cut at the range end is whole again when the voucher is re-joined, and cleaned then") describes the queued day, not the archived message. Test E2 (`tests/run_upload_split.py:411-420`) puts the voucher 20,000 characters before the boundary. That cut is past the first employee, whose values are the ones it checks, so it does not reach this case. | At most one employee per piece boundary that falls in a salary payment, so it is narrow. But in the real 7.1 capture a salary payment is mostly bank allocations (about 2.8 K characters per employee), so when a payment spans a boundary, the cut is likely to land in one. R3-L1's aim, no bank field in the archive, then holds only partly. | Don't carry an open bank allocation as text. In the non-last piece, if the tail holds a `<BANKALLOCATIONS.LIST` with no closing tag that starts in this piece's bytes, end the piece at that point instead. Set `nextFrom` to its byte offset (`TextEncoder` length of the text before it for UTF-8, ×2 for UTF-16LE, less `tailLen`), and keep only the text before it in `tail`. Alternatively, carry `skip: "<TAG>"` for an open bank element and drop up to its closing tag in the next piece. Extend E2 with a cut placed inside the second employee's `ACCOUNTNUMBER`. |
| R4-L2 | Low | `server/tally-cloud/index.ts:2652-2665`, `:2667-2697`; `src/js/49-tally-cloud.js:1122-1143` | An upload whose file reached `tally-uploads` but whose `upload_done` never succeeds is never removed. `upload_new` creates the job and path. The browser sends the whole file by TUS and only then posts `upload_done`. If that post fails (network, a 5xx, its `tally_work_send` failing at `:2690-2693`), or the page is closed in between, the job stays unsealed and `queued`. Nothing in the function or in any migration removes an unsealed job's object. The browser keeps `{job, path, uploaded: true}` in IndexedDB and retries only if the same client, period and file size are uploaded again. R3-M1's three code paths (the give-up, the last piece run again, the size refusal) are all for jobs that were sealed or reached `upload_done`. Also, a failed `remove` at any of the four sites is only logged and never retried. | Same exposure as R3-M1, only rarer: the whole Day Book, with every employee's account number, IFSC and name in favour, readable by every member of the firm (`migration-47:188-190`). The notes (item 3) say the file is removed "whenever its job ends". An abandoned upload never ends. | No SQL is needed. In `work()` (or the existing jobs-load path), list upload jobs with `sealed = false` and `updated_at` older than, for example, 24 h. Remove `<firm>/<id>.xml` for each (service role) and mark the job `failed` ("the upload was not finished; upload again"). Treat a removal error at the end and give-up sites the same way: leave the job for this sweep (for example a `kept_file` flag in `upload`) rather than only logging it. |

## Round-3 findings

- **R3-M1 (the uploaded Day Book left in `tally-uploads` when the job does not end well): fixed for the cases named, with one residual (R4-L2).**
  - (1) Give-up: `work()` (`index.ts:2608-2617`) now removes `<firm>/<job>.xml` for a piece message (`upload` set) that is `Fatal` or on its fifth try. The path is built from the queued message's own `firm` and `job`, the same form `upload_new` issues (`:2657`) and `uploadPiece` insists on (`:2495`), so another file is never removed (test L2 checks this). A day message has no `upload`, so its failure does not remove a file whose later pieces are still running. Pieces run one at a time (each queues the next through `tally_upload_advance`), so no other piece of the same job is in flight when the file goes. Covered by the new M4 line.
  - (2) The last piece run again after its advance: `moved: false` with `at === "end"` (`:2581-2586`) now removes. `tally_upload_advance` (`migration-47:926-946`) returns the job's current cursor, and `end` is set only by the last piece, so this never removes a file that a later piece still needs. If the file is already gone, the earlier `!got` branch (`:2499-2505`) returns quietly first. There is no test for this branch. It is two lines, and it is correct as read.
  - (3) The size refusal: `upload_done`'s 409 (`:2676-2681`) removes `up.path`, the job's own path from the row and never the caller's. Covered by E3.
  - (4) Objects stored before 2.4.4 and the archive's earlier messages are now listed in `docs/bridge-2.4.4-notes.md` item 3 as left for the owner. That records the decision R2/R3 asked for. It is the owner's call.
  - One side effect, not a finding: after a 409 the browser's IndexedDB record still says `uploaded: true`. A retry of the same file posts `upload_done` again and now gets 404 ("finish the upload first") rather than 409. Neither lets that record upload again. A stored size that differs from the TUS `Upload-Length` is not expected in practice.
- **R3-L1 (raw text in archived queue messages): partly fixed (R4-L1).**
  - (b) `stage_days` (`:2632-2640`) now gunzips each day (capped at `MAX_DAY`), cleans it, and re-gzips only when something was taken out. A day it cannot open is queued as before and refused where it is read, so its raw content reaches the archive only if it is not a valid gzip of at most `MAX_DAY` bytes. That is acceptable.
  - (a) The tail is cleaned for whole elements only. See R4-L1.
  - The archive itself is not trimmed. That is the owner's decision under the migration-74-only brief, and it is noted in the notes.
- **R3-L2 (`bankCleanOnce` losing the re-send): fixed.**
  - `bridge-go/payroll.go:520-591`: a day file that fails to save no longer stops the round. The days already rewritten are put into `bank-clean-244-days.txt` and their months re-made. `bank-clean-244-disk.txt` is written only when every file was saved, so a failed file is retried on the next round.
  - With the cloud off, it returns before the final mark and before removing the days file, so the days are queued on a later round when `cloudOn()` is true.
  - The final mark is written only after the disk pass is complete and the days are queued.
  - I checked the cases: a failed write with the cloud on, a failed write with the cloud off, and the cloud off with no failure. No day is lost or queued twice, apart from a harmless re-queue, which the existing upsert absorbs. `payroll244bank_test.go` (`TestPayrollOldDayFilesCloudOffFirst`) covers the cloud-off case. The failed-write case has no test, and I traced it by reading.
  - Residual, not counted: `addCloudDays` (`cloud.go:100-113`) ignores the `appendText` error, and the days file is then removed (`payroll.go:584`). That is the same unchecked append every ordinary day goes through, so it is not specific to this fix.

## Checked, no finding

- Range 2: nothing app-only changed since round 3. `src/js/49-tally-cloud.js`'s upload flow (`storageUp`, TUS, `upload_done`) was re-read against the server changes, and it works with the new 409 removal and the give-up removal.
- The removal sites use the service-role client and only `<firm>/<job>.xml` paths taken from server-written rows or messages. No caller-supplied path is ever removed (`upload_done` compares `body.path` with the row's and removes the row's).
- `stage_days`' extra work runs only on the old hand-over: at most 62 days, each gunzipped and capped at `MAX_DAY`, and re-gzipped only when cleaned. It adds no new CPU risk worth noting.
- The owner rules, re-checked on the head:
  - FinComEmployees has twelve fields, payroll rows only, no second id.
  - The four ledger fields are `PAYTYPE`, `PAYSTATTYPE`, `ITCOMPONENT`, `FORPAYROLL`.
  - `BANKEMPLOYEENAME` and `AMOUNT` are kept. `ACCOUNTNUMBER`, `IFSCODE` and `PAYMENTFAVOURING` are dropped on every path: the bridge's day files, the bridge's send, `tally-ingest`'s keep, the upload split's queued days, and `stage_days`. The tail is the R4-L1 exception.
  - FinComVoucherObject waits up to 3 s only for payroll types (`payroll.go:374`, capped at 3000 ms). Every other request waits 2 s, with one request in flight.
  - No date of birth, Aadhaar, bank or other personal field is read.
  - Senior citizen is old regime only.
  - Migration 74 is add-only. The allow-list is pinned.
  - These are unchanged since round 3, and the tests above pass on them.
- Financial accuracy (tax year 2026-27, to the paisa): `run_tds_tally.mjs`, `run_e2e_payroll.py` and `run_e2e_payroll_real.py` pass on the merged head. No calculation code changed in round 3's fixes.

Verdict: 0 High, 0 Medium, 2 Low.
