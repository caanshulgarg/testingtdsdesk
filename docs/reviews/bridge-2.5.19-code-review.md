# Code review: FinCom Bridge 2.5.19 (Quit restarts the tray, heavy days read in MasterID bands, the FinCom Books masters and fields, the daily tie-out, and the look for FinCom's mark before a re-sent entry)

Status: independent code review, 23-Nov-2026, one round. It was a read-only review of the branch next-bridge-2519, in a
detached worktree at edad89a1c. Nothing was committed or pushed.

Two blockers (B1, B2), both in E (resent2519.go / jobs.go). Everything else has no blocker.

Range: b64a6d398..edad89a1c

The base is b64a6d398. The range holds:
- A, the tray Quit (7ad1de38c);
- the request drafts and the owner's decisions (f36e21443, 2b8ccdcec, a7174e47e);
- B1, C1 to C8 and E as built (30213f864);
- tally-ingest's "bands" (07db5d1b4);
- E's look again on a hand-back (edad89a1c).

I read `git diff b64a6d398..edad89a1c -- bridge-go docs server/tally-cloud`: 258 files, 218 of them golden testdata.

## What was reviewed

1. A, the tray Quit (trayquit2519.go, win_service.go trayKeeper, server.go /tray/quit, platform_other.go):
   - trayStartDueWhy holds a Quit for 10 minutes and then forgets it. After that, the 40 s "not reported" rule starts
     the icon as before. An icon the person started again by hand keeps reporting, so no second icon is started.
   - A new Quit starts the 10 minutes again. Signing out forgets the Quit.
   - The typing gate still holds every background read while no icon reports (fail closed; TestR2519TypingGateKeptAroundQuit).
   - The keeper only starts the icon in sessions it already walked; which sessions it walks has not changed.
   - Nothing here asks anything of Tally. The state is now built on every platform; the stubs left platform_other.go.

   No fault found.
2. B1, FinComDayHeadsPart (daybands2519.go, daypull.go, daypace2516.go, tally.go datedRefused / dayPartExact):
   - Order: the bands begin only after FinComDayHeads was stopped at 2 s, with the window held under 2 s. They come
     before the 2.5.16 split, and only when AltVchId is known.
   - Coverage: the bands run from 1 to AltVchId, end to end. Each band starts at the last b+1. The last band is always
     open-ended, because bandOpen is computed again after every band.
     - MasterIDs above a stale or low AltVchId fall in the open band. That covers entries a posting creates while the
       day is being read.
     - Sparse MasterIDs give empty bands, and the width doubles.
     - w.heads is a map keyed by MasterID, so nothing is counted twice. A Tally alteration keeps the MasterID.
   - A stop: the band is halved. For the open band the halving starts from max(width, span-a+1), and the band is then
     closed. A band of 200 or fewer that is stopped, a window held 2 s, a fixed cost over 1.7 s or 2,000 bands all stop
     the day for 24 h (pullStopDay).
   - Every row is checked: of the day asked (pullRowsSkip) and inside its band. An empty or non-numeric MasterID reads
     as 0, which is below a, so the day stops.
   - Heavy tier: pacePart is never small. pullYield and the typing gate run before each send, and the 2 s recorder
     stop applies.
   - The gate exception is narrow: only the exact band of the day being read now (pull.work under pull.mu), as built,
     with limitMs at most 2000.
   - tally-ingest: periodHeadsVia takes "bands" as "day". This is safe given the coverage above. A whole list still
     removes an entry only on the second whole list.
3. C1 to C4 and C6, the books masters (requests2519.go booksMasters, ledgers.go):
   - Each kind is one request per chunk, under the round's budget, holdNow and the 60 s heavy wait.
   - A stop or no answer skips that kind for the round, and the ledger list goes on. After two misses the kind is off
     until the next version.
   - Rows: stored fields only. Payroll cost centres are dropped.
   - C1 goes through ledgerPeriodExact (ledgerPeriodIDs).
   - C6 is not built while Confirmed2519GstRegs is off. Its pin rebuilds to "", so it is refused even if handed in.
4. C5, ISPOSTDATED (batch249.go, fastvch.go, fastentries.go):
   - FinComVoucherBatch's frozen FETCH gains ", ISPOSTDATED" at the end, with a new SHA. 2.5.18's SHA is kept for
     FinComVoucherWindow, which is unchanged.
   - FinComVoucherObject's FETCHLIST is unchanged; the field is only added to the strip's kept paths. See N3.
   - The 218 golden rewrites: one line each, and the only text inserted is `<ISPOSTDATED>No</ISPOSTDATED>`, with
     nothing removed. I checked this by script over `git diff -U0`.
5. C7, the ledger fields (ledgers.go, ledchanges.go, requests2519.go ledFetchNow / ledBooks2519):
   - The seven added names go at the end of the FETCH. The two lists still to confirm are asked only with
     Confirmed2519LedgerLists on.
   - The column layout: the held rows carry books at index 16 and the outbox at 17. A 2.5.18 row has no books column
     and is sent as before. ledger_changes keeps payArr()[:4] and then adds the object.
6. C8, the daily tie-out (requests2519.go tieOut, keep.go):
   - When: only with r.day and caughtUp, after the company's other reads, with the switch on.
   - Holds: not while a posting is going or holdNow says so, and only after 60 s of quiet. One request, under ledgerTC's
     2 s stop. groupClosingAsking lets only the exact request for today through, and only while it is being asked.
   - Once a day: tieout.json is keyed by companyKey and day.
     - gaveWay (nothing reached Tally) writes nothing, so the next catch-up tries again.
     - A stop, a window held 2 s or an unreadable answer is noted and tried tomorrow.
     - A refusal by the cloud is also noted, so it too waits until tomorrow; the paper says so.
   - Not built while Confirmed2519GroupClosing is off: the pin returns "".
7. E, the look before a re-sent entry (resent2519.go, jobs.go, tally.go): see B1 and B2.
   - Fine:
     - The look runs after the lease and the tallyWriter lock, before the first part.
     - A failed or stopped look sends nothing for that date (checkFailed / notSent).
     - The hand-back paths in newPostJob delete resentLooked.
     - An ordinary job asks nothing more.
   - The gate exception is narrow. FinComTag is "dated", so with ReadDays off it is refused unless:
     - tc.resentLook is set, which only resentLook sets;
     - the limit is 1 to 2000 ms;
     - the exact x is in resentAsk while that look is in flight;
     - x rebuilds byte for byte as tagCheckRequest for a single date.
   - Two jobs racing on the same x can only make a look fail, which is the safe way.
8. The "to confirm" switches: all four are cfgB, so off unless set. No code, default config or cloud path sets them.
   The tests turn them on only through r2519Confirm, which uses t.Cleanup.
9. The allow-list:
   - Seven rows say "allowed for 2.5.19 by the owner's decision of 2026-11-23, NOT yet measured", with maxSec 0 and
     no measuredOn (TestR2519OnTheList).
   - The four changed rows say so, and keep 2.5.18's worst case.
   - TestR2519TableOtherwise2518 rebuilds 2.5.18's table and gets its hash, 553a24ff...604d. So no other row changed.
   - docs/tally-allowlist.md matches the code (TestAllowListUnchanged passes) and its hash is 7e692656...a5f1.
10. Version: BridgeVersion is still 2.5.18 (util.go:21). See N6.

Tests run at edad89a1c (GOCACHE inside the worktree):
- `go vet ./...` on linux and with GOOS=windows: clean.
- `go test -count=1 -run 'TestR2519|AllowList|Pinned|DayPull|Post|TestPay244' ./...`: ok (222 s).
- The full `go test -count=1 -timeout 1700s ./...`: no test failed. The run hit its 28-minute limit while TestR2519BooksMasterStoppedNeverHoldsLedgers was running (31 s in). That test passed in the targeted run above. So the full suite has no result: run it again with a longer limit before release.

## Blockers

### B1: FIXED in 315b08c78. A resumed job uses an old look, taken before the lease was let go
Files: jobs.go:905-909, which sets `p["resentLooked"] = true` and saves it with progress.json; jobs.go:386-408
(resumePostJob, which keeps it).

resentLooked is written to progress.json with the job. Only the two hand-back paths in newPostJob clear it (jobs.go:242
and 283). resumePostJob does not clear it: it restarts an "interrupted" job after the bridge stopped, and the lease was
let go. jobWorker's own waitLease inside the part loop does not clear it either: it takes the lease again after losing
it.

Scenario:
1. A job holds a released entry X. The look finds no mark and progress.json is saved with resentLooked true.
2. The bridge stops before X's part is sent. X is not in flight, so it is not "unknown".
3. While the lease is free, X goes into Tally another way, for example the same FinCom entry posted from another
   computer.
4. The job is resumed. The look is skipped and X is posted a second time.

The paper (E.3.2) says the read is kept for the job only and "never used after the lease is let go". This is exactly
the case E is meant to catch.

Fix: keep "looked" in memory for one worker run, not in progress.json. Or delete resentLooked in resumePostJob and
whenever waitLease had to take the lease again. Add a test: look, stop the job before the part, put the mark in
Tally, resume, and expect nothing posted.

### B2: FIXED in 315b08c78. A look whose answer is not of the date asked is still used as "not there"
Files: resent2519.go:48 (goodDupAnswer), resent2519.go:52-55 (the rows of other dates are dropped, and the answer is
used); r2519req_test.go:713-737 (TestR2519ResentLookDateChecked requires a second copy).

FinComTag sends its period as plain yyyymmdd. The paper (E.2.2, E.3.3) says that if Tally does not apply it, rows of
other dates come back, and then "any row of another date: the answer is not used".

The code does the opposite. It drops the rows of other dates and treats what is left as Tally's full list for the
date. Scenario: a Tally that answers its current period, or any other period, instead of date D. X, posted earlier on
D, is not in the answer, so X is sent again: a double posting in the very failure mode the paper flags.
TestR2519ResentLookDateChecked writes this in. Tally answers every date, X's mark is in the answer on another date, and
the test expects two copies in Tally.

Also, goodDupAnswer only checks for `<ENVELOPE` with no LINEERROR. An answer cut short, with its envelope not closed,
reads as "no entries" and the entry is sent. The rest of the bridge refuses that (wholeEnvelope, cutAnswerWords).

Fix:
- Any VOUCHER row whose date is not the date asked makes the look fail for that date: checkFailed, not sent.
- Require wholeEnvelope(raw).
- Change the test so that it expects nothing sent and checkFailed. Add a cut-answer case.

Whether a mark found on another date should also hold the entry for a person is for the owner. That case is a posted
entry whose date someone changed in Tally.

## Non-blocking

- N1 (E): a re-sent entry can still go without a look in three cases.
  - Its XML carries no TDSDesk tag, or no valid date (resent2519.go:81). FinCom always tags, so this is theory.
  - The release names it by a form of the id that only acceptedKey matches. releaseFor (accepted.go:326) accepts
    `acceptedKey(rid, "") == key`, while resentIDs keys by the exact, trimmed id. Suggest building the ids through
    acceptedKey on both sides.
  - RecorderLimitMs is set to 0. Then limitMs is 0, resentAsking is false, and with ReadDays on the look goes through
    the general path with no 2 s stop. Floor it at 2000 for the look.
- N2 (E): E.3.4 says "a date stopped twice: those entries are held for a person". This is not built. Each hand-back
  looks again and sends nothing unchecked, which is safe but can repeat without end. Either build it or take it out of
  the paper.
- N3 (C5): the paper's C5 (docs/bridge-2.5.19-new-requests.md:331-336) says FinComVoucherObject's FETCHLIST gains
  `<FETCH>ISPOSTDATED</FETCH>`. The code leaves that request unchanged and only keeps the field from Tally's whole-voucher
  answer, and TestR2519PostDatedMark requires that. This is less than approved and adds no new shape, so it is safe.
  Correct the paper so that it describes what is built, and keep the C5 time check on the object request (item 6) anyway.
- N4 (B1): the first band is AltVchId/16. If AltVchId is far above the highest voucher MasterID, the first bands can
  be as heavy as the whole day. Each stop holds Tally until it answers, and then the band is halved, several times.
  This is safe under the rules, but the ZZ BIG TEST item "the highest voucher MasterID is not above AltVchId" should
  also record by how much it is above.
- N5 (C7): the first masters round after the update sees every ledger with the added fields as changed (a 2.5.18 row
  has no books column), so the whole list goes once. The same happens again when Confirmed2519LedgerLists is turned
  on. This is expected; say it in the test sheet.
- N6 (version): BridgeVersion is still 2.5.18, there is no 2.5.19 build, and latest.json and the checklist are
  unchanged. These are the release steps. booksMasters' "off until the bridge is updated" stamps st[...Off] with the
  version, so the bump must come before any field build.
- N7 (C1): bill openings in chunks of 500 up to the master bound means about 60 requests a round at 30,000 masters,
  on every masters round. Check whether once a day (as C8) would be enough before ZZ BIG TEST times it.
- N8 (tests): computedFigure's C8 exemption (allowlist_test.go groupClosingRead) checks against the builder itself.
  This is acceptable as the stock exemption is, and TestR2519RequestsAsTheOwnerApproved compares every builder against
  the paper's literal XML. There are no tests for an open band that is stopped and then closed, for MasterIDs above the
  span, or for B1 (resume) and B2 above.

## Verdict

Not ready to release as it stands. B1 and B2 must be fixed first. Both can let a re-sent entry be posted twice, which
is what E exists to prevent. Both fixes are small and local to resent2519.go and jobs.go.

A, B1 (the bands), C1 to C8, the allow-list rows, the switches and the golden rewrites are sound. Every new request is
still NOT measured, and the ZZ BIG TEST list in the paper is the gate for release.

## Fixes after the review (in 315b08c78, bridge-go only; to be re-reviewed)

Range of the fixes: edad89a1c..315b08c78

- B1: FIXED. The look is the worker run's own; progress.json no longer carries it (an old "resentLooked" is
  deleted). A resumed or handed-back job looks again, and the part loop looks again at the entries not yet sent
  whenever waitLease had to take the lease anew (leaseHeldPost before and after). Tests:
  TestR2519ResumedJobLooksAgain (an interrupted job whose progress says it looked, the mark put in Tally meanwhile:
  2 copies before, 1 after) and TestR2519LeaseRetakenLooksAgain (the lease runs out during part 1 while another
  computer posts entry 2: posted twice before, found and not sent after).
- B2: FIXED. resentLook requires wholeEnvelope and goodDupAnswer, and any VOUCHER of another date fails the look for
  that date (checkFailed, notSent). TestR2519ResentLookDateChecked now expects nothing sent;
  TestR2519ResentLookCutShort is new. Both sent a second copy before.
- N1: FIXED. No mark or no valid date: held for a person (needsReview, notSent). The ids are matched as releaseFor
  matches them (the raw id and acceptedKey). The look's stop is 2 s whatever RecorderLimitMs says (resentLimitMs).
  TestR2519ResentNoMarkHeld.
- N2: FIXED (built). A date whose look failed twice (resent-looks.json, by company and date; cleared by a look that
  answers): its entries are held for a person with plain words. TestR2519ResentLookFailedTwiceHeld.
- N3: FIXED in the paper: C5 says FinComVoucherObject's request is unchanged and only the strip keeps the field.
- N4: FIXED. The first band is cut to a sixteenth of the highest entry number the day lists have shown for the
  company when that is below AltVchId (TestR2519FirstBandByHighestEntry); the ZZ BIG TEST list records AltVchId and
  the highest MasterID and by how much.
- N5: FIXED in docs/bridge-2.5.19-test-sheet.txt (item 5).
- N6: open (the release steps: version, build, latest.json, checklist).
- N7: FIXED. C1 is read at most once a day (TestR2519BillOpeningsOnceADay: 4 requests in two rounds before, 2 after).
- N8: FIXED. TestR2519OpenBandStoppedThenClosed (the open band stopped, asked again closed in half, coverage end to end,
  two entries above the span read) and the B1/B2 tests above.
- The full suite was run with -timeout 60m (see the fix commit's report).
