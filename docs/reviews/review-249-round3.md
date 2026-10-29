# Review 249, round 3: the fixes of rounds 1 and 2 (FinComVoucherBatch)

Reviewer: an independent Claude session (did not write this code)
Date: 2026-10-29
Branch reviewed: next-bridge-249 at e65d62471
Earlier rounds: review-249-round1 (docs/reviews/bridge-2.4.9-code-review.md, bridge-2.4.9-security-review.md: R1-1..R1-12,
S-1..S-6), review-249-round2 (docs/reviews/review-249-round2.md: H1, M1-M3, L1-L4)

High: 0, Medium: 1, Low: 5

What was run (at e65d62471, linux/amd64):
- `cd bridge-go && flock /tmp/fincom-app.lock go test -count=1 -run 'R249' .`: ok (86.8 s).
- `flock /tmp/fincom-app.lock go test -race -count=1 -run 'R249' .`: **FAIL**, one data race in
  TestR249R1WindowWatchedAfterAStop (see L2). Re-run of the two R1-2 tests with `-race -count=4`: 1 of 4 failed the same way.
- `go vet .` and `GOOS=windows go vet .`: clean.
- Two throwaway probe tests (deleted, not committed; the tree was clean afterwards), quoted in M1 and L1.

No code was changed.

## Code review

Range: f447764ca..e65d62471

Files: bridge-go/batch249.go (batchEntry, batchConvertCat, batchHasItems, batchFetchOK, voucherBatchExact, pullBatchCo,
pullHeadsFresh, pullAwaitEarlier, pullBatchStep), bridge-go/daypull.go (pullWork.warmAt, pull.batchCo, pullHeadsStep,
pullFlush), bridge-go/r249round1_test.go, r249batch_test.go, r245_test.go, testdata/batch249/gate-7.1.zip, gate-3.0.zip,
docs/bridge-2.4.9-notes.md.

### Earlier findings

Round 1 (code):

- **R1-1 (High): Fixed.** batchEntry (batch249.go:387-397) runs the strip on the entry with and without the collection's
  CATEGORYENTRY lists and leaves the entry for FinComVoucherObject when the kept text or the hold differs. reBatchCat
  matches CATEGORYENTRY at any depth, so nested pay heads count too. TestR249R1PayHeadsOfABaseTypeNotTakenFromAGroup
  covers the base-type salary Journal, end to end. The gate's real salary payments (payg, 3.0 MasterIDs 46 and 48, and
  gate-*.zip) come out identical to FinComVoucherObject.
- **R1-2 (High): Fixed for the shipped setting; open when TallyAbandonMaxSec is 0.** After a stop, pullAwaitEarlier watches
  until the abandoned slot ends, and the hold is measured over the whole time. An unfinished group stops the company
  ("over2s"). Both tests pass. With TallyAbandonMaxSec 0 there is no slot to wait on: see M1.
- **R1-3 (Medium): Fixed.** pullFlush (daypull.go:963-993) sends at most pullFlushAt() entries and 4 MB (the first entry
  always), keeps the rest in w.got in order, and sends w.gone once, with the first body. Every caller is correct:
  - pullStep's flush branches call it again until w.got is empty;
  - the "wait" and "employees" branches send one body and leave the rest for the next turn;
  - a cloud failure keeps everything;
  - an "upload" answer ends the day (pullFinish), as before.

  No entry is sent twice or lost on a success path. TestR249R1UploadBodiesStaySmall covers it.
- **R1-4 (Medium): Fixed.** pull.batchCo (key `companyKey|lower(CGUID)`, under pull.mu) carries 50 or "one by one" to the
  company's next days, so the 2 s stop is met at most twice per company in a run. Both tests pass. For the lifetime, see L4.
- **R1-5 (Medium): Fixed.** w.warmAt is set when the heads finish and after each group that parses. A group due on heads
  older than DayPullHeadsFreshSec (default 60, at least 10) resets the heads and reads them again first.
  - **No loop and no starvation.** A re-read clears warmAt and does not count as a request. The next step is the heads
    request (F1, already approved). It sets warmAt again, and the step after it is the group, with only pullMayAsk and the
    flush check in between. So every re-read is followed by a group unless a pause of more than 60 s comes in that one gap.
    The worst case is one extra F1 per group, when FinCom is slower than 60 s per flush.
  - After a re-read the heads are newer than what FinCom was told. batchGroup uses the new heads, so a newly added entry
    inside a..b makes the group a list (B5) or the answer inexact. That is the safe side.
- **R1-6 (Medium): Fixed.** TestR249R1GateAnswersAsObject runs batchEntry over every entry of the gate's B4 and B5 answers
  (bdiff run 40815068422, 7.1 and 3.0). The answers include tdsgst, TDS challan payments, payroll salary payments per
  employee, stock journals and an optional entry. Every entry taken equals FinComVoucherObject's answer through the strip.
  There are also tests for an entry gone before its group and for a changed GUID.
  - Still not in the data: a cancelled entry (ISCANCELLED Yes appears in neither zip), and an entry the strip holds, on real
    answers. This is not rated, because every entry taken is compared field by field with FinComVoucherObject's answer.
- **R1-7 (Medium): Fixed.** The count is now `w.asked += len(g) - len(single)`, and the test asserts 4. The changed-GUID
  path is tested (TestR249R1GUIDChangedNotSentDayEnds): the entry is not sent, the day ends, and no group asks for it again.
- **R1-8 (Low): Note.** The code still halves once. The notes (point 4) now say "100, then 50: not 25 and less".
- **R1-9 (Low): Fixed.** reBatchInv takes each ALLINVENTORYENTRIES list up to its own end tag, and batchHasItems looks for a
  filled STOCKITEMNAME inside it. TestR249R1ItemRuleInsideItsList covers the accounting-invoice case.
- **R1-10 (Low): Fixed.** voucherBatchExact requires `copier && !person && bg`. The test covers non-copier and person TCs.
  It does not cover `bg` false, which costs one more case in the test.
- **R1-11 (Low): Fixed in part.** The FETCH is frozen by its SHA-256 (batchFetchSHA), and both builders refuse on a
  mismatch. The fallback is not one by one, as the notes and the test say: see L1.
- **R1-12 (Low): Note.** The behaviour is unchanged, as approved, and the log line gives the cause. The fix message says
  this note is in docs/bridge-2.4.9-notes.md, but the notes do not mention it. One sentence there would close it.

Round 2:

- **H1 (High): Fixed.** The type-of-supply learning is removed (batchTOS, Take/Probe/Learn, and the call in pullFetchStep).
  Nothing read from one entry is carried to another.
- **M1 (Medium): Fixed (obsolete).** No per-company learned state is left.
- **M2 (Medium): Fixed (obsolete).** There are no `again` re-asks. An entry with such a line is single and is read once.
- **M3 (Medium): Fixed in part.** A line with the tag left out now counts like an empty tag (batch249.go:241), and there is
  a test. The second case, a line with no nature and no taxability, is still taken: see L5.
- **L1 (Low): Fixed (obsolete).** There is no probe map.
- **L2 (Low): Fixed (obsolete).** There is no learned map.
- **L3 (Low): Fixed (obsolete).**
- **L4 (Low): Fixed.** The GST rule is tested on real 3.0 answers and in the pull loop
  (TestR249PullGSTLineWithoutTypeOneByOne), and on gate-3.0.zip (58 left, 78 identical, none differing).

### New findings

#### M1 (Medium): with TallyAbandonMaxSec 0, the window is still not watched after a stop, and the company is not stopped

batch249.go:487-490 (pullAwaitEarlier relies on earlierBusy), tally.go:605-609 (abandonMax() <= 0: the request is closed at
once, and no abandoned slot is registered).

TallyAbandonMaxSec is a supported keep, documented as "0 closes the request when the bridge gives up on it". With 0:
- earlierBusy(port) is false at once;
- pullAwaitEarlier returns true without waiting;
- `held(from)` is read at the 2 s stop, as in round 1.

Tally keeps working on a request whose connection was closed (inflight.go's own header), so a hold that grows after the
stop is not seen. The group is halved, and the next group of 50 can go into a Tally that is still busy with the stopped
one. That is R1-2 / S-2 again, under a non-default setting. In 2.4.8 any stop ended the company's period, whatever the
setting.

Probe (throwaway): TestR249R1WindowWatchedAfterAStop's scenario with `"TallyAbandonMaxSec":0`. Result: groups 1, stops []
(the company was not stopped; with 600 it is stopped, "window").

Suggested fix: when `abandonMax() <= 0`, treat a group's stop as 2.4.8 did (pullStopCompany "over2s"). Or keep the window
probe running for abandonWait() after the stop and stop the company on a hold of 2 s or more.

Suggested test: `TestR249R1WindowWatchedAfterAStopAbandonZero`, the same stand-ins with TallyAbandonMaxSec 0. Assert one
stop, "window" or "over2s", and no second group.

#### L1 (Low): a FETCH that no longer matches its hash stalls the period instead of reading one by one

batch249.go:315 (fetchVoucherBatch returns "not asked: a group ... could not be built"), batch249.go:532-537 (the default
branch: w.fails++, pullDrop after 5); docs/bridge-2.4.9-notes.md:72-73 and r249round1_test.go:356 say "one by one".

When batchFetchOK is false, every group step fails as an error that reached nothing:
- it is counted as "sent", which costs a turn;
- after 5 tries the day is dropped ("waiting");
- FinCom lists the day again, and its heads (F1) are read again each time.

No entry of any company is read. Nothing unapproved reaches Tally, so this is safe, but the period never moves and the
notes describe something else.

Probe (throwaway): batchFetchText changed, a day of 4 Sales entries. Result: groups 0, one by one 0, sent 0, the day
dropped; Tally saw only TDSDeskCompanies, TDSDeskCompanyInfo and FinComDayHeads.

Suggested fix: in pullBatchStep, `if !batchFetchOK() { w.oneByOne = true; return false, false, false }` before building
the group. Log it once.

Suggested test: extend TestR249R1FetchFrozen with a pull run on the changed FETCH. Assert no FinComVoucherBatch, 4
FinComVoucherObject reads, and 4 entries sent.

#### L2 (Low): `go test -race -run R249` fails: TestR249R1WindowWatchedAfterAStop races with the stop's background goroutine

r249round1_test.go:76-114, tally.go:972-981 (the goroutine that calls retryLift when the abandoned request ends),
r245_test.go:192 (the cleanup restores nowFn).

pullAwaitEarlier wakes when the slot leaves `earlier`. The retryLift goroutine wakes on the same `s.done`, with no ordering
between them. The test can end, and its cleanup can write nowFn, while retryLift reads it. This is a test-only race,
because production never swaps nowFn. But the release check "R249 -race clean", which held in round 1, now fails
intermittently (1 of 4 runs here).

Suggested fix: in the test, wait as TestR249R1StoppedGroupNotFinishedStopsCompany does (until !earlierBusyAny(), plus
retryLift's goroutine). Or let tests wait on a WaitGroup of those goroutines.

Suggested test: `go test -race -count=10 -run 'TestR249R1WindowWatchedAfterAStop' .` passes.

#### L3 (Low): pullAwaitEarlier can hold the period loop, and the bridge's stop, as long as TallyAbandonWaitSec

batch249.go:441-450, inflight.go:28-30 (abandonWait: keepNum, no upper clamp).

The wait runs on dayPullLoop's goroutine. It does not look at stopping(), and its bound is the unclamped
TallyAbandonWaitSec. At 20 s it is harmless, since Tally's lock is held meanwhile anyway, and postings and person requests
wait on that lock, not on this loop. A large keep (for example 600) makes a stop of the bridge wait up to that long,
behind a 50 ms sleep loop.

Suggested fix: `bound = min(abandonWait(), 60 s)`, and leave the loop when stopping().

Suggested test: TallyAbandonWaitSec 600 with a group that never ends. Set the stop flag, and assert pullTurn returns
within 1 s.

#### L4 (Low): pull.batchCo lasts for the whole run of the bridge, not the period

batch249.go:414-432, daypull.go:207.

The reduced size is never cleared:
- not when the company's period ends or is chosen again (ChosenAt);
- not at night;
- not after hours of good answers.

So one slow afternoon puts a company on one-by-one reads until the bridge restarts, which can be weeks. This is the safe
side (cost only), and it is bounded in memory by the number of companies. The notes say "for the rest of the bridge's run",
but round 1 (R1-4) and the approval spoke of the period.

Suggested fix: key the entry with it.ChosenAt as well, or clear the company's entry when its period is finished or chosen
again.

Suggested test: a company that went one by one, then its period chosen again (a new ChosenAt). Assert the first group is
100 again.

#### L5 (Low, the rest of round 2 M3): a 3.0 to 6.2 line with no GST nature and no taxability, and no type of supply, is still taken from a group

batch249.go:241.

The rule needs GSTOVRDNTAXABILITY or GSTOVRDNNATURE to be filled. Round 2's narrower rule ("any line whose group type of
supply is empty or missing, whatever the nature") was not adopted. Take a ledger whose GST details Tally resolves only in
the object export, for example one set to take its GST classification. If its group line gives empty nature, empty
taxability and empty type, while FinComVoucherObject gives "Goods", that entry is taken with a different
GSTOVRDNTYPEOFSUPPLY. The gate data (gate-3.0.zip, 136 entries) has no such line: every entry taken there is identical. So
this is unproven rather than shown, hence Low.

Suggested fix: on 3.0 to 6.2, leave any line that carries a LEDGERNAME or STOCKITEMNAME and an empty or missing
GSTOVRDNTYPEOFSUPPLY, whatever its nature. Or add such a ledger to the bdiff gate and keep its answers.

Suggested test: a converter test with a 3.0 group line with LEDGERNAME, an empty nature and taxability, and an empty type.
Assert batchEntry leaves it.

### Answers to the specific questions

- **An entry taken from a group differing from FinComVoucherObject's answer:** only L5 is left, and it is unproven. The
  pay-head, On Account and type-of-supply paths all leave the entry, and the gate's 212 entries taken are identical.
- **The heads re-read loop:** it cannot loop or starve (R1-5 above). The worst case is one extra F1 per group.
- **pullAwaitEarlier:** a 20 s block of the period loop only, harmless at the default (L3). It misjudges when
  TallyAbandonMaxSec is 0 (M1). With TallyAbandonWaitSec 0 it stops the company on any unfinished stop, which is the safe
  side.
- **pullFlush:** correct (R1-3 above). No entry is lost or sent twice, and gone is sent once.
- **pull.batchCo:** the key matches pullEmpKey (name and GUID). The lifetime is the run (L4).
- **Request shapes:** see the security review.

## Security review

Range: f447764ca..e65d62471

- **Request shapes:** no builder was added. voucherBatchRangeRequest and voucherBatchListRequest still build only the
  testdata/batch249/b4-range.xml and b4-list.xml forms (TestR249RequestAsApproved passes), now also gated by the FETCH's
  SHA-256. The heads re-read uses the existing F1 (dayHeadsRequest). Entries left by batchEntry go through the existing
  FinComVoucherObject request. The dated guard is narrower: it requires a copier's background TC that is not a person's.
  No other shape can be sent.
- **Integrity (nothing sent short; the same as FinComVoucherObject):**
  - S-1 (High): **Fixed** (R1-1).
  - Round 2 H1 and M1: **Fixed**, because the learning was removed.
  - The rest is L5.
- **Freeze safety:**
  - S-2 (High): **Fixed** at the shipped setting.
  - **Not fixed** under TallyAbandonMaxSec 0: M1 (Medium).
- **S-3 (Low): Fixed** (R1-10).
- **S-4 (Low): Fixed in effect.** Heads older than 60 s are read again before a range group (R1-5), so a range is bounded
  by heads at most 60 s old plus one group's time. The allow-list row was not changed to say so (a note).
- **S-5 (Low): Fixed in part.** The FETCH is frozen and a mismatch never widens the request. The fallback stalls instead of
  going one by one (L1, availability only).
- **S-6 (Low): Fixed** (R1-3).
- **Availability:**
  - M1 (the missed freeze);
  - L1 (stall on a FETCH mismatch);
  - L3 (the stop of the bridge held by a large TallyAbandonWaitSec);
  - round 2 M2 is gone.
- **Logs and secrets:** the new log lines carry the company, day, group size, MasterID range and seconds only. No ledger
  names, amounts or secrets. The gate zips are Educational-mode test data, as SOURCE.txt states.
- **Concurrency:** pull.batchCo is read and written under pull.mu. pullAwaitEarlier holds no lock while it sleeps. The one
  race found is test-only (L2).
- **No AI, nothing new sent outside:** the only cloud call is the existing period_entries, now split into smaller bodies.

Security findings, by severity: Medium 1 (M1), Low 3 (L1, L3, L5). They are the same items as the code review and are not
counted twice in the verdict.

## Verdict

High: 0, Medium: 1, Low: 5

Every High of rounds 1 and 2 is fixed at the shipped settings. Before the 2.4.9 gate:
- fix M1, or forbid TallyAbandonMaxSec 0 while groups are on;
- fix L2, so the `-race` check is clean again;
- correct the notes on the FETCH fallback (L1).
