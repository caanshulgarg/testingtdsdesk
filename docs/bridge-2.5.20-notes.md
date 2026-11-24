# FinCom Bridge 2.5.20 – notes and test sheet (draft; branch next-bridge-2520, from 2.5.19 at 36e5ca1c3)

The version is not changed and nothing is built: 2.5.19's release check, build and the ZZ BIG TEST timings come first.
No new request to Tally is built or allow-listed. The same rules as before: a request at most 2 s, one in flight, postings
first, the typing gate. Use a test company with made-up entries only.

## What changes

1. **FinCom could not confirm in time: asked again, not stopped (P1).** Before each part of a posting from FinCom's queue
   the bridge asks FinCom whether it may still send it (post_ok). When FinCom's database is slow it answers "FinCom could
   not confirm in time …". Up to 2.5.19 the bridge stopped the posting there, and FinCom put it back a few minutes later.
   Now the bridge asks again up to 3 times, 10 s apart (about 30 s in all), and sends nothing meanwhile. If FinCom says
   yes, the posting goes on. If it is still unsure after the third ask, the bridge stops as before. Any other answer
   (stopped, cancelled, settled, another bridge's, held for checking) still stops at once. No answer at all still goes
   ahead, as the owner decided for 2.5.15. (jobs.go checkCloudBeforeSend; postOKUnsureWait, postOKUnsureTries.)

2. **A reply Tally made only partly: that part is read back (P2).** If Tally takes only some of a part (for example 49
   created and 1 refused because a ledger is missing), up to 2.5.19 every entry of the part was "needs review" and none
   went again by itself. Now the bridge looks for that part's entries by FinCom's mark: FinComTag, as built, one request
   for each date in the part (at most 10 dates). These are the same looks 2.5.19 makes before an entry is posted again
   (resentLook: 2 s stop, posting priority, whatever ReadDays says, the answer taken only when it is whole and for that
   date).
   - An entry that is found is posted and confirmed in Tally (its Tally id is kept). Found means made or altered by
     this request: its AlterID is above Tally's voucher counter (ALTVCHID), read again right before each part by the
     approved company check (FinComCompany, at most 2 s). A check that gives no numbers leaves the counter not known.
     An older entry that carries the same mark is not counted as found and never makes an entry "posted" (review of
     383aef7c9: counted, it could hide an entry Tally made without its mark, which would then go twice).
   - An entry that is not found is "refused by Tally" only when all of these hold: Tally's reply gave errors or line
     errors, no exception and no ignored entry, and every entry Tally says it made (CREATED + ALTERED) was found. It is
     then taken off this computer's record of sent entries, so Retry in FinCom sends it again.
   - Everything else is needs review, as before, and stays on the record:
     - an entry not found when Tally reported an exception or an ignored entry;
     - an entry not found when fewer were found than Tally says it made;
     - an entry whose mark only an older entry in Tally carries;
     - every entry when the voucher counter before the request is not known;
     - an entry without a mark or a date;
     - every entry of a part with more than 10 dates;
     - every entry when a look fails or is not answered.
   (post.go sendImport, readBackPart, readBackTags.)

3. **A posting waiting here for Tally keeps telling FinCom (P3).** If Tally is closed, or the company is not open, a
   posting the bridge took from FinCom's queue waits on this computer. Up to 2.5.19 it told FinCom only when something
   changed. After 2 hours with no word, FinCom put the posting back and said "restart FinCom Bridge". Now, while it
   waits, the bridge repeats its report every 20 minutes even if nothing changed. FinCom therefore keeps it as taken, with
   the bridge's own "Waiting for Tally: …" words (for example "Waiting for Tally: Open ZZ TEST in Tally to post"; a
   line that already starts "Waiting for" is sent as it is). (cloud.go syncCloudPosts, cloudPostWords, postStillEvery.)

4. **Reading from Tally is on by default (the owner, 23-Nov-2026).** ReadDays was off unless the settings file said
   true. Now it is on unless the file says otherwise.
   - A file with no ReadDays (or null) now reads days. The standard settings never write it, so "not set" and "off"
     stay apart.
   - A computer where someone wrote ReadDays false (or 0, or "") stays off.
   - A non-empty word such as "false" counted as on before and still does: write false, not "false".
   - The typing gate, postings first, the 2 s stop and one request in flight are unchanged.
   - Every existing test stand now says ReadDays false, the default it was written for (events_test.go bridgeFor).
     r2520_test.go tests the new default.
   (keep.go readDaysOn.)
   - Review of 2.5.20 (A1): the default turns on only the background Day Book rounds, each request under the 2 s stop
     (TC.dayRound). FinCom's direct reads (/vouchers, /daybook, /ledgerlines, /tags, /keepcheck, /readtest and the
     measuring tool's dated items), which can hold Tally up to TallyMaxSec (20 s) for a month at a time, stay refused
     exactly as before unless the settings file says ReadDays true (the JSON value true). (keep.go directReadsOn,
     tally.go datedRefused.)

5. **Review of 2.5.20.**
   - A2: the read back after a reply Tally made partly skips cancelled and optional entries, in the matching and in the
     count, as the look before a re-sent entry does. A cancelled earlier copy carrying the mark of an entry Tally refused
     no longer makes that entry "posted": it is refused by Tally and may go again. (post.go readBackTags.)
   - After P1's wait (about 30 s), the job looks again at a cancel, the bridge stopping and the company's lease (taken
     again when it ran low) before the part goes; a cancel during the wait ends the asking at once. (jobs.go.)

## Tests (bridge-go)

r2520_test.go:
- TestR2520UnsureAskedAgainThenGoes
- TestR2520UnsureThreeTimesStops
- TestR2520OtherStopAtOnce
- TestR2520MixedReplyReadBack
- TestR2520FewerFoundThanMade
- TestR2520ExceptionNotJudged
- TestR2520ReadBackNoAnswerAsBefore
- TestR2520WholeReplyNoReadBack
- TestR2520WaitingReportedAgain
- TestR2520ReadDaysDefaultOn
- TestR2520DirectReadsOnlyWhenReadDaysTrue (no ReadDays, null, true, false)
- TestR2520ReadBackSkipsCancelledAndOptional
- TestR2520UnsureWaitThenLooksAgain

The 2.5.19 tests whose rule this release changes are updated: TestPostNeedsReviewOnLineError (a part Tally made partly
is now read back). TestNeedsReviewJobEndsDone, TestPartialBatchNeedsReview and TestPartialBatchNotedOnDisk test what stays
needs review, so they run with the read back off (noReadBack).

## Checks on ZZ TEST (after the 2.5.19 items; also in docs/bridge-2.5.20-test-sheet.txt)

A. **Unsure.** FinCom staging under load, or a test cloud that answers post_ok "could not confirm in time" twice, then yes.
   You should see: the log says "asked again"; nothing reaches Tally for about 20 s; then the posting goes on to the end.
B. **Mixed reply.** Queue 3 made-up journal entries for one day, the third naming a ledger that is not in ZZ TEST.
   You should see:
   - one FinComTag request for that day after the import;
   - the first two Posted (in Tally);
   - the third "Not posted: Tally refused it" with Tally's words;
   - after the ledger is created, Retry sends only the third.
C. **Waiting report.** Close Tally, then queue a posting for this computer. Leave it for 45 minutes.
   You should see: the log shows a report to FinCom every 20 minutes. On the Post page the posting keeps the bridge's
   own "Waiting for Tally: …" words, and never "restart FinCom Bridge". Open Tally: it posts by itself.
D. **Reading on by default.**
   - On a computer whose settings file has no ReadDays: after the update, background reading reads the days FinCom asks
     for, still pausing while someone types.
   - On a computer with "ReadDays": false: nothing changes, and no old day is read.
