# Security review: FinCom Bridge 2.4.9 (older entries up to 100 at a time, FinComVoucherBatch)

Reviewer: the independent review session of bridge-2.4.9-code-review.md (one round). It did not write the change. It
checked the owner's standing rules:

- every request to Tally 2 s or less (payroll 3 s);
- one request in flight;
- postings first;
- Tally never freezes;
- only the approved fields kept, stripped before anything is logged, stored or sent;
- nothing sent short;
- only the exact approved shapes reach Tally;
- no AI.

Range: a9cbec7f8..86dc851b9

## Threats looked at

1. **A group request that is not exactly B4 or B5, or for a company or day not listed.** Three layers stop it:
   - checkAllowed: the allow-list plus pinned.go, which rebuilds the request with voucherBatchRebuild and compares it
     byte for byte;
   - datedRefused (tally.go, the "exception" class): voucherBatchExact accepts only the exact string the period fetch
     set in pull.batchAsk, under a stop of 2 s or less, for a company with a recorded starting point;
   - pull.batchAsk itself is built only from pullWork.it, the day FinCom listed.

   A changed FETCH, date, filter operator, extra OR term or 101st MasterID is refused (TestR249PinnedAndGuarded). Held,
   with the gaps S-3 and S-5 below.
2. **More than 100 MasterIDs.** The list form is capped at 100 (each one digits only, no leading zero, no duplicate).
   The range form has no count of its own: see S-4.
3. **A request while another is in flight, or during a posting.** FinComVoucherBatch goes through the same
   invokeTally / invokeTallyNow path as FinComVoucherObject:
   - recorderTC's yield refuses it while a posting is going on or an import is in flight;
   - enterTallyLock keeps one request at a time;
   - holdUntilAnswered keeps the lock after a stop until Tally finishes;
   - the shared retry schedule waits after a stop.

   Held.
4. **Tally freezing.** The 2 s hard stop applies (recorderTC limitMs 2000). A window hold of 2 s or more seen during a
   group stops the company (TestR249PullGroupWindowHoldStopsCompany). **Not fully held:** S-2.
5. **Only approved fields; nothing sent short.**
   - The FETCH holds only FinComVoucherObject's approved paths, plus the same fields under LEDGERENTRIES.
   - Every entry goes through fastStripWhy before it is kept, logged or sent.
   - Raw text reaches a log only as the first 120 characters of an answer without an ENVELOPE (as in 2.4.8).

   **Not held:** S-1.
6. **Payroll's 3 s and employees first.** A known payroll type is kept out of groups and read one by one (entryTC 3 s,
   pullEmpReady). A payroll type learned from a group's answer is left `single`. Held, except for the base-type case
   in S-1.
7. **No AI.** Nothing in the range calls a model or an outside service other than FinCom's existing period_entries.
   Held.

## Findings

### S-1 (High): pay-head lines are dropped without a hold, so an entry is sent short

batch249.go:158 and 164, with payroll.go:464-473.

batchConvert removes CATEGORYENTRY from every grouped entry before the strip. payrollLearn never learns Tally's base
types (Payment, Journal and the others) or entries not on the PaySlip view. So a salary Payment or pay-slip Journal
reaches FinCom without the pay-head lines FinComVoucherObject's path would write. When a pay-head amount cannot be
read, it also reaches FinCom without the hold that path would apply.

This was reproduced with a throwaway test (code review R1-1). It breaks "nothing is ever sent short" and "the same as
FinComVoucherObject".

**Fix:** an entry with a filled PAYHEADNAME under CATEGORYENTRY that is not already one of its ledger lines is read one
by one. Add fixtures and tests for it.

### S-2 (High): a freeze that continues after a 2 s stop is not seen, and the period goes on

batch249.go:319-351.

The window probe ends at the stop, while Tally is still on the group. In 2.4.8 a stop ended the period. In 2.4.9 the
day continues at half size, and every new day starts again at 100 (code review R1-4). A window hung for many seconds
after the stop is never measured. That is against "Tally never freezes" and "a 2 s window hold stops the company's
period".

**Fix:** keep watching the window until the late answer or the 20 s bound, and stop the company when the whole hold is
2 s or more, or when Tally did not finish within the bound (code review R1-2).

### S-3 (Medium): the dated guard does not check that the hard stop actually applies

batch249.go:139.

voucherBatchExact accepts any TC with 0 < limitMs <= 2000. invokeTallyNow applies the stop only for `copier &&
!person` TCs that are neither imports nor postings. A future caller with a person's TC, or a non-copier TC, would send
FinComVoucherBatch with no 2 s stop, and the guard would let it pass. The approval allows the older-entries fetch only.

**Fix:** require `tc.copier && !tc.person && tc.bg`. Better still, mark the TC as the period fetch's own (for example a
`tc.periodFetch` flag set in pullBatchStep) and require that flag.

### S-4 (Low): the range form's size is bounded only by the day's heads, not by the request

batch249.go:84-89 (voucherBatchRangeRequest), pinned.go (vchBatchID: pinOne(voucherBatchRebuild)).

The pin accepts `$MasterID >= a AND $MasterID <= b` for any a <= b. The "at most 100" of the range form rests on
batchGroup's check against the heads read earlier. Entries moved into the day inside a..b after the heads are answered
too. They are rejected as inexact, but only after Tally has done the work. With stale heads (code review R1-5) the
answer can hold more than 100 entries. The guard's equality with pull.batchAsk limits who can send it, so this is
Low.

**Fix:** state in the allow-list row that the range form is bounded by the heads read just before. Optionally refuse a
range in pullBatchStep when the heads are older than the bound of R1-5.

### S-5 (Low): the approved FETCH is not frozen

batch249.go:51-76.

FinComVoucherBatch's FETCH is computed from FinComVoucherObject's field lists. A future field approved for
FinComVoucherObject would silently widen FinComVoucherBatch, which the owner approved as an exact text. The pin
cannot catch it, because it rebuilds with the same function. Only TestR249RequestAsApproved compares it with the
capture.

**Fix:** a constant, or a hash checked at start-up, that refuses the request on a mismatch (code review R1-11).

### S-6 (Low): a bigger FinCom upload per flush

batch249.go:383, daypull.go:579.

One group can add 100 stripped entries to a single period_entries body, well past the 4 MB that 2.4.8 kept to. This is
not a confidentiality issue. It is an availability one: a 413 marks the day "upload by hand" (code review R1-3).

**Fix:** flush before a group, or split the body.

## Checks

- Allow-list and pin: TestR249RequestAsApproved, TestR249PinnedAndGuarded and TestR249VersionAllowList pass. The
  table hash of the other rows is unchanged.
- `go test -race -count=1 -run R249 .` passes. `go vet .` and `GOOS=windows go vet .` are clean.
- Log lines added in batch249.go carry only the company name, the day, MasterIDs, entry dates, group sizes and the
  hold time. No ledger names, amounts or party details are logged.
- No secrets, keys or production endpoints are in the range. The testdata is Educational-mode test data ("ZZ BIG
  TEST").

## Verdict

Not ready to release. S-1 and S-2 are each a breach of one of the owner's standing rules. Fix them, with tests, and
also code review R1-3 and R1-6 (the tdsgst and payg fixtures), before the 2.4.9 gate.

## Rounds 2 to 4 (each round's notes kept word for word: docs/reviews/review-249-round2.md, -round3.md, -round4.md)

- Round 2 (86dc851b9..f447764ca): H1 integrity (a learned "no type of supply" carried to other entries), M1 (learning by
  company name only), M2 availability (quadratic re-asks), L1, L2. Fixed in e65d62471 by removing the learning.
- Round 3 (f447764ca..e65d62471): S-1 and S-2 fixed at the shipped settings; S-3, S-6 fixed; S-4 fixed in effect; S-5
  fixed in part. New: M1 (freeze safety under TallyAbandonMaxSec 0), L1, L3, L5. Fixed in e16baaf86 (L5 a known limit).
- Round 4 (e65d62471..e16baaf86): no new security finding; request shapes unchanged (only b4-range.xml and b4-list.xml,
  FETCH frozen); freeze safety held under every setting.

High open: 0. Medium open: 0.

Range: a9cbec7f8..e16baaf86
