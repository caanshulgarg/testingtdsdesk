# Code review: FinCom Bridge 2.4.9 (older entries up to 100 at a time, FinComVoucherBatch)

Reviewer: an independent review session run with Claude Code. The session had only the repository and the range. It
did not write the change.

Range: a9cbec7f8..86dc851b9

Scope: bridge-go/batch249.go (new), daypull.go (pullFetchStep, pullWork, pull.batchAsk), tally.go (requestClass and
datedRefused for FinComVoucherBatch), pinned.go, allowlist.go, r249batch_test.go, testdata/batch249,
docs/tally-allowlist.md. The approval checked against is docs/bridge-2.4.9-forms-for-owner.md section 9 (B4, B5, the
converter rule, the slow-group rule), together with the owner's standing rules.

## Checks run (at 86dc851b9, linux/amd64)

- `flock /tmp/fincom-app.lock go test -count=1 -run 'R249|R245|AllowList|Pinned|Rebuilt' .`: ok (215 s).
- `go test -race -count=1 -run R249 .`: ok, no race reported.
- `go vet .` and `GOOS=windows go vet .`: clean.
- Throwaway probe tests (deleted, not committed) for findings 1 and 9 below. Their results are quoted in those
  findings.

## Round 1 (a9cbec7f8..86dc851b9): 12 findings

### R1-1 (High): the converter drops CATEGORYENTRY, so a pay-head entry of a Tally base type is sent short

batch249.go:158 and 164 (reBatchExtra, batchConvert), with batch249.go:273-279 and payroll.go:464-473.

**Problem.** batchConvert removes every top-level `CATEGORYENTRY.LIST` before fastStripWhy runs. The comment says this
is safe because "payroll entries are never in a group". But FinComVoucherObject's strip (fastvch.go:479 and 493) reads
CATEGORYENTRY / EMPLOYEEENTRIES / PAYHEADALLOCATIONS:

- it writes each pay head that is not already a ledger line as a ledger line, with the employees as its cost centres;
- it holds the entry (payBad / `lost`) when a pay-head amount cannot be read.

Only `payrollEntry(company, VOUCHERTYPENAME)` keeps an entry out of a group. payrollLearn deliberately never learns:

- Tally's base types (Payment, Journal, Receipt and the others; review 244 M1);
- an entry not on the PaySlip view (ASPAYSLIP No);
- more than 50 types.

So a Payment or Journal entry carrying employees' pay heads, such as a salary payment filled by Payroll Auto Fill or a
pay-slip Journal, goes into a group. Its pay-head lines are then silently lost. The strip cannot hold it, because the
lists it would have looked at are already gone.

Probe (throwaway test, deleted): a `Journal` entry with ASPAYSLIP Yes, one ledger line "Salary Payable", and a
CATEGORYENTRY pay head "Basic Pay" for one employee.

- `payrollEntry` gave false.
- `fastStripWhy(v)` (the object path) kept the "Basic Pay" line, why="".
- `fastStripWhy(batchConvert(v))` gave why="" with **no "Basic Pay" line**.

The entry would be sent to FinCom different from, and shorter than, FinComVoucherObject's answer. That breaks the owner's
"nothing is ever sent short" rule and the measured claim of identical fields.

**Fix.** Do not drop CATEGORYENTRY blindly. In fetchVoucherBatch, mark an entry `single` (read one by one) when its raw
block has a filled `PAYHEADNAME` under CATEGORYENTRY that is not already a ledger name of the entry. The simplest form:
run fastStripWhy on the converted entry both with and without CATEGORYENTRY, and send one by one when the two differ or
either holds.

**Test.** Add the entry above, and a Payment carrying EMPLOYEEENTRIES/PAYHEADALLOCATIONS, to testdata/batch249. Assert
that both are left to FinComVoucherObject and are never sent from the group.

### R1-2 (High): after a group is stopped at 2 s, Tally's window is no longer watched, and the day goes on

batch249.go:319-351, daypull.go:806-812 (the 2.4.8 behaviour), win_platform.go:662 (platWindowHold).

**Problem.** `held(...)` is called as soon as invokeTally returns. On a stop that is at the 2 s mark, while Tally is
still working on the group. invokeTallyNow keeps Tally's lock until Tally finishes (holdUntilAnswered), but nothing
watches the window during that tail. A hold that began after the send, for example at 0.4 s, reads as about 1.6 s at
the stop. It is under the limit, so the code takes the "halve" branch even if the window then stays hung for many
seconds.

In 2.4.8 any stop ended the company's period (`pullStopCompany(w, "over2s", ...)`), so this tail never mattered. In
2.4.9 a stopped group lets the period go on. The day is asked again at half size, and every later day starts again at
100 (R1-4). So a freeze of 2 s or more can pass unseen, against "a 2 s window hold stops the company's period"
(section 6 point 3 of the approval).

**Fix.** On errRecorderStop, keep the window probe running until the abandoned slot is done (`abandonSlot.done`, or
the 20 s TallyAbandonWaitSec bound), and decide on the whole hold. If Tally had not finished by the bound, or the hold
was 2 s or more, call pullStopCompany(w, "window", ...). Only a stop whose late answer came back with the window held
under 2 s should halve.

**Test.** A stand-in windowHoldFn whose spell grows after the stop (1.6 s at the stop, 2.5 s by the end of the late
answer) must stop the company, not halve.

### R1-3 (Medium): one group can push a FinCom upload far past 4 MB and 50 entries; a 413 then marks the whole day "upload by hand"

batch249.go:383 (`w.got = append(...)` for up to 100 entries in one step), daypull.go:579 (the flush check runs only
before a step), daypull.go:732-735 (a 413 leads to pullMarkUpload "shape").

**Problem.** Before 2.4.9, w.got grew by one entry a step, so a period_entries body stayed under about 4 MB plus one
entry. A group adds up to 100 stripped entries at once, on top of up to 49 entries and just under 4 MB. A day of large
item invoices (the 50-item invoice raw is 1.2 MB, testdata/batch249/3.0/obj-30010.xml) can produce a body several
times the old maximum. If FinCom answers 413, the day is marked to be uploaded by hand. That regresses days 2.4.8
read fine.

**Fix.** Flush before asking a group when `len(w.got) > 0`. Or split pullFlush into bodies of at most pullFlushAt()
entries and 4 MB each.

**Test.** A day of 100 entries of about 100 KB each must reach FinCom in more than one period_entries call, each under
4 MB.

### R1-4 (Medium): the slow-group state resets every day, so every slow day costs up to two requests over 2 s

batch249.go:303-307 and 344-350 (w.batchN and w.oneByOne live on pullWork, which is made new for each day).

**Problem.** "Halve, then one by one" applies per day. On a company whose days are all big (the measured 7,601-entry
day took 1.4 s for 100 entries, and a first group asked long after its heads took 3.1 s), every day starts again at
100: stop, 50, stop, then one by one. Over a year that is up to about 730 requests that Tally keeps working on after
the bridge stopped waiting. Each one holds Tally's lock for the tail (and see R1-2). In 2.4.8 the first such request
stopped the company.

**Fix.** Keep the reduced size per company for the rest of the period. After a day went one by one because of stops,
start the next day at the halved size or one by one. Or count the period's stops per company and stop it (`over2s`)
after a small number, such as 2.

**Test.** Two consecutive slow days: the second day's first group must not be 100.

### R1-5 (Medium): "a day's groups are asked straight after its FinComDayHeads" (approval section 6 point 1) is not enforced

batch249.go:301-320, daypull.go:560-592.

**Problem.** Between the heads (pullHeadsStep) and the first group come pullSendHeads (a FinCom call that can wait
pullWait, 60 s), pauses for someone using the computer, and the beat. Nothing limits how old the heads may be when the
first group goes. The approval's own measurement says a first group asked long after the heads took 3.1 s (run
40741546645). Late groups are also when heads go stale. An entry moved into the day inside a..b makes the answer
inexact (the day goes one by one); see also security S-4.

**Fix.** Record when the heads were answered. If more than a short bound has passed (for example 60 s) before the
first group, ask the day's heads again, or start that day at a small group size.

**Test.** Heads read, FinCom's heads call held for 2 minutes: the first group must not go on the old heads.

### R1-6 (Medium): the committed fixtures cover 9 entries per release; payroll, stock journals, TDS, bank allocations, cancelled and optional entries are not compared

testdata/batch249, r249batch_test.go:132-181 (TestR249ConverterMatchesObjectOnRealAnswers).

**Problem.** The allow-list row and the approval cite "150 of 150 entries identical". The repository checks only 9 per
release (5 + 4 vouchers: Receipt, Payment, Sales, Purchase, Journal, one 50-item invoice). Section 8 of the approval
says stock journals, TDS challan payments and salary payments with bank allocations per employee were not compared,
and that "the 2.4.9 gate runs the same diff on the tdsgst and payg companies before release". No such fixtures or
tests are in the range. Also missing:

- a payroll entry (R1-1 shows the gap);
- a cancelled entry and an optional entry;
- an entry whose GUID changed;
- an entry the strip holds (the `single` path, batch249.go:278-281);
- a deleted entry (the "missing" inexact case, batch249.go:285-292);
- an accounting-invoice entry with inventory allocations under ledger lines (R1-9).

**Fix.** Commit the gate's tdsgst and payg batch and object pairs, plus the cases above, and run the same
batch-against-object comparison on them. Gate the release on it.

### R1-7 (Medium): pullBatchStep counts a group's single entries as asked, and a GUID-changed entry is dropped without a test

batch249.go:366 (`w.asked += len(g)`) and 368-384.

**Problem.**

- Entries left `single` (payroll learned from the answer, or held by the strip) are counted in w.asked, then asked
  again one by one and counted again (daypull.go:822). The progress FinCom is told (pullNote) is overstated.
- An entry whose GUID changed is put in `in` and taken out of w.want, but it is neither in w.got nor in w.gone. That
  matches 2.4.8, but r249batch_test.go does not cover it. A later edit that moved `in[m] = true` below the GUID check
  would ask it again in every group without end.

**Fix.** Use `w.asked += len(g) - len(single)`. Add a test where the head's GUID differs from the answer's: the entry
is not sent, it leaves w.want, and the day finishes.

### R1-8 (Low): the code halves once, but the approval text reads "50, then 25..."

batch249.go:344-350 against docs/bridge-2.4.9-forms-for-owner.md section 6 point 2.

**Problem.** Section 6 point 2 says "half-size groups (50, then 25...)". Point 3 says "a half-size group also over 2 s
... one by one". The code follows point 3: one halving, then one by one. That is the stricter reading, but the
approved text is inconsistent with itself.

**Fix.** Keep the code. Correct the notes or test sheet so the owner sees "halve once, then one by one".

### R1-9 (Low): reBatchItem can match across the end of an empty item list

batch249.go:154 (`<ALLINVENTORYENTRIES\.LIST...>.*?<STOCKITEMNAME...`, with `(?s)`).

**Problem.** Non-item entries carry an empty `<ALLINVENTORYENTRIES.LIST>     </ALLINVENTORYENTRIES.LIST>` before
their ledger lines (testdata 3.0/batch-20260831-w5.xml:52). The lazy `.*?` runs past that closing tag to any later
`<STOCKITEMNAME>`, for example under `ALLLEDGERENTRIES.INVENTORYALLOCATIONS` (accounting-invoice mode). If the entry
also has LEDGERENTRIES, it is then treated as an item invoice and its ALLLEDGERENTRIES are dropped.

Probe (throwaway): such an entry matched the item rule, and its ALLLEDGERENTRIES were removed. In the fixtures it does
not happen, because non-item entries have no LEDGERENTRIES and STOCKITEMNAME is fetched only under
ALLINVENTORYENTRIES. It is still one regex away from a wrong ledger set.

**Fix.** Match each ALLINVENTORYENTRIES block to its own end tag (reuse the reBatchAllLed style), then look for a
filled STOCKITEMNAME inside that block only.

**Test.** The entry above keeps its ALLLEDGERENTRIES.

### R1-10 (Low): the dated guard trusts tc.limitMs but not that the stop applies

batch249.go:139 (voucherBatchExact) against tally.go (stopAt is set only when `tc.copier && !tc.person` and the request
is neither an import nor a posting).

**Problem.** The guard accepts any TC with 0 < limitMs <= 2000. A TC with copier false, or person true, gets no hard
stop at all, yet passes. Today only recorderTC reaches it, so this is latent.

**Fix.** Also require `tc.copier && !tc.person` in voucherBatchExact. Add that case to TestR249PinnedAndGuarded.

### R1-11 (Low): FinComVoucherBatch's FETCH is derived at init from FinComVoucherObject's lists

batch249.go:51-76 (batchFetchText built from liveFetchFields, liveKeepGST242, liveKeepTDS243 and liveKeepPay244).

**Problem.** Any later change to FinComVoucherObject's fields silently changes FinComVoucherBatch too. pinned.go
rebuilds it with the same function, so the pin still passes. Only TestR249RequestAsApproved (the byte comparison with
b4-range.xml) would notice. The approval was for this exact text.

**Fix.** Freeze it: a constant FETCH string, or a sha256 of batchFetchText checked at start-up. On a mismatch, refuse
FinComVoucherBatch and fall back to one by one.

### R1-12 (Low): an inexact or empty answer sends the rest of the day one by one, even for a cause that clears

batch249.go:352-355.

**Problem.** An ENVELOPE with no vouchers, for example a LINEERROR when the company was closed in between, or one entry
deleted between the heads and the group, sets w.oneByOne for the whole day. That is safe, but on a 7,601-entry day it
costs the whole gain. The approval asks for exactly this ("that day goes one by one"), so this is a note only.

**Fix (optional).** Log the cause in words and tell the owner. A deleted entry could instead be confirmed with
FinComVoucherObject and the group asked again without it.

## Summary

| # | Rating | Where | One line |
|---|---|---|---|
| R1-1 | High | batch249.go:158,164 | CATEGORYENTRY dropped: pay-head lines of base-type entries sent short |
| R1-2 | High | batch249.go:319-351 | window not watched after a stop; the day goes on |
| R1-3 | Medium | batch249.go:383, daypull.go:579 | flush can exceed 4 MB / 50; 413 then means upload by hand |
| R1-4 | Medium | batch249.go:303-350 | halving resets every day |
| R1-5 | Medium | batch249.go:301-320 | heads-then-groups timing not enforced |
| R1-6 | Medium | testdata/batch249 | 9 entries, not 150; no payroll/stock/TDS/bank/cancelled |
| R1-7 | Medium | batch249.go:366-384 | asked counted twice; GUID-changed path untested |
| R1-8 | Low | batch249.go:344 | approval text "50, then 25" vs one halving |
| R1-9 | Low | batch249.go:154 | item regex crosses list end |
| R1-10 | Low | batch249.go:139 | guard does not require copier / not person |
| R1-11 | Low | batch249.go:51-76 | FETCH derived, not frozen |
| R1-12 | Low | batch249.go:352 | whole day one by one on any inexact answer |

Not found:

- no request other than B4 or B5 can pass the pin plus the dated guard;
- the list form is capped at 100, with no duplicates and no leading zeros;
- one request in flight (enterTallyLock, holdUntilAnswered) and postings first (recorderTC.yield) are unchanged;
- no data race on pull.batchAsk (-race clean);
- the log lines carry only the company, the day, MasterIDs and dates.
