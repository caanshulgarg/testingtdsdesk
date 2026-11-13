# Code review: FinCom Bridge 2.5.16 (security work; older days read in the day; stops that lift by themselves; the by-type split; Tally's port)

Status: independent review pending. This file names the range to be reviewed; the reviewer's findings and the
coordinator's signature are added after the independent review. The release exe is built and release-check.sh is run
only after that review.

Range: c851cd1dc..053994f5d (origin/staging-next with 2.5.15 at c851cd1dc, which holds 2.5.15's signed commit 2bf75a4c7; the whole of 2.5.16 through the code and security reviews' fixes)

What the range holds:
1. The security work of 2.5.16 (e0c77945d to d2b7fd47a): the FVU path kept in local settings with its file checked;
   the service's settings in its own folder; recorder files private to each user; a key per browser; FinCom's sites by
   build; refusals logged with a cap; a held or unreadable progress.json handled; a tally.ini in TallyPrime's program
   folder never written; the service's start and command line; the review's lows. See the security review.
2. Older days read in the day (51a2b5a92, daypace2516.go): two tiers by what each request is measured to take for the
   company (0.3 s or less: 5 s after the last key in Tally; else 60 s); the day's list first, then entries one by one;
   groups, payroll, ranges and by-type lists heavy only; a window held 1 s demotes the form; the beat's lastKeyAt; a
   repeated typing refusal keeps its time fresh; the cloud's idle look counts lastKeyAt.
3. Stops lift by themselves (4ec2bf553, daystop2516.go; migration 197): a slow day stops that day only for 24 hours,
   then is tried again in the heavy tier; the upload is asked only on the 3rd separate day; a cloud without 197 stops
   the period as before; rows of another date skipped; slow marks and old period stops lift after 24 hours; the page's
   "Bringing in N missed days from Tally, M left".
4. The voucher-type split back on for very big days (900928f02): F2, the existing approved form, only for the day being
   read by type after its list was stopped at 2 s, heavy tier only, each under its 2 s stop.
5. Tally's port (bf0ebdf00, portwatch2516.go): Windows' port list watched every 3 s with a beat at once on a move;
   tallyPortNotSaved in the beat; the page tries its own bridge's port first and shows Copy port / Check it works.

The code review of d2b7fd47a to a87fd2260 (not ready: H1, M1, M2, L1-L7) and what was done (959101269):
- H1: a by-type list never closes a day: the bridge says partial; migration 197 marks the day split_open (a trigger on
  tally_period_days and tally_check_days): not done, its earlier count kept, until a whole list of the day clears it; the
  bridge holds the day 24 hours and asks its one-day list again. Tests: run_migration197.py "H1" (a Credit Note day),
  r2516review_test.go TestR2516SplitWithCreditNoteNotDone.
- M1: postings, saves waiting and the typing tier looked at again after the lock wait and the rest, right before the
  send (TC.sendYield). Test: TestR2516TypingDuringLockWait.
- M2 and L1: a list (one day or a range) with only another date's entries holds the day 24 hours through the day stop,
  counted toward the 3 days. Test: TestR2516DateNotAppliedHeld.
- L2: 3 day stops of one company within an hour: an hour's wait (TestR2516CompanyBrake).
- L3: a slow mark probed once a day with one entry; lifted only if it comes in time (TestR2516SlowMarkLiftsAfterADay).
- L4: the beat sends lastKeySec (seconds since, on the bridge's own clock); the cloud works out the moment.
- L5: held days a list handed back keep their last real hand-out (tally_period_unstamp).
- L6: docs/tally-allowlist.md is left as it is (the owner's rule). Note on its FinComDayHeads row: the row covers F1 and
  the by-type form F2 under the one id and the one measured time; since ROUND 103 F2 was refused at the gate. 2.5.16
  sends F2 again only for the day being read by type after its one-day list was stopped at 2 s, a type of that day's
  list, under its own 2 s stop (daypull.go dayHeadsExact). No request was added or changed (TestAllowListUnchanged).
- L7: the day-pace measures are kept per company GUID.
- The re-review (053994f5d): lastKeySec null is no key seen; a day read type by type counts toward the 3 days, so a day
  whose whole list never comes in time is offered for upload on the 3rd.

The owner's rules, as the author kept them (to be confirmed by the reviewer):
- Each Tally request 2 s at most (3 s a payroll entry), one in flight, postings and saves first, the typing gate kept.
- No new or changed Tally request XML: TestAllowListUnchanged, TestEveryRequestOnList, TestNoComputedFigure and
  TestUnknownRequestRefused green; docs/tally-allowlist.md unchanged by items 2-5.
- No shared tally.ini written; Tally never started.
- Cloud changes add-only: migration 197 (one new table, four new functions); tally-ingest additions.
- No real client names, keys or model ids in code, tests, logs or commits.

Tests run by the author: go vet (linux, windows); the day-pull, stop, split, port and allow-list tests against the
stand-in Tally (r2516pace_test.go, r2516stop_test.go, r2516split_test.go, r2516port_test.go and the earlier day-pull
suites); tests/run_migration197.py; tests/run_day_retry_ingest.py; tests/run_gap_post_ingest.py; the Tally page tests
(run_tally_connect_steps.py, run_tally_progress.py, run_tally_simple.py) and the page's size lines. What only Windows
can check is marked in docs/bridge-2.5.16-test-sheet.txt.
