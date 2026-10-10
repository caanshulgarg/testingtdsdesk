# Code review: FinCom Bridge 2.3.2 (issue 232: a large company's entry fetch over 2 s)

Reviewed: 07-Oct-2026, an adversarial self-review of the diff, by the author (the owner's rule for this release: written
from the diff after an honest adversarial self-review; any High or Medium fixed before the build).

Range: 4163822..38acd92

Read with `git diff 4163822 38acd92 -- bridge-go/ app/ src/ tests/ docs/tally-allowlist.md`.

## What changed

- `bridge-go/slowco.go` (new): each background request that reached Tally is noted with its port and outcome (answered in
  time, or stopped / not answered); each company's entry fetch (FinComVoucherByMaster / ByNumber) with its time or "over
  2 s". A company whose entry fetch is stopped on 2 separate occasions, Tally answering other requests in time just
  before and just after each, is marked; kept in `sync\recorder-slow.json` with the bridge's version; lifted when the
  version differs; `slowBeat` for the heartbeat.
- `bridge-go/tally.go` `invokeTally`: the background path tells `slowNote` the outcome (the time from the existing
  `timed` callback, chained to any caller's).
- `bridge-go/recorder_live.go` `liveFetchBodies`, `bridge-go/recorder_resolve.go` `liveFetchByNumber`,
  `fetchVoucherByNumber`, `fetchVouchersByMasterIn`: no entry request for a marked company (`errSlowCompany`); its
  lines held at once with the owner's words (`slowWords`), final, never into the held list; a line held after its asks
  timed out carries one timed-out try (`slowHeld`).
- `bridge-go/recorder_resolve.go` `liveResolveTurn`: a held line's timed-out asks are counted (`heldLine.Slow`); the next
  ask comes 1 h after the first, 4 h after the second (`liveSlowSpacing`); the third ends it (`liveHeldSlowGiveUp`); a
  line of a marked company ends with `slowWords`, nothing asked. An ended line goes up as "<line id>:resolved" with no
  body and the words (`liveHeldEnd`), and its id is kept 7 days (`*.ended.txt`): `applyHeldLines`, `applyRefetch` and the
  resolver never take it again.
- `bridge-go/cloud.go`: `recorderBodyFetch` is `slowBeat()` (was always `{}`).
- `bridge-go/util.go`: 2.3.2. `docs/tally-allowlist.md`: the decision line only (the table and its hash unchanged).
- App: `src/js/49-tally-cloud.js` carries the bridge entry's `recorderOff` on each row; `app/src/screens/Tally.jsx`
  `SlowCompanies` shows one line per company for a bridge of 2.3.2 or later.

## Findings

No High. No Medium open. The points below were looked for on purpose; each is either fixed in the range or a Low.

### Checked and holding

1. **A whole-Tally freeze cannot mark a company by itself.** A stop counts only between two answers in time of other
   requests on the same Tally, each within 10 minutes, with no other request failing in between; the stops between the
   same two answers are one occasion, and 2 occasions are needed. Stops in one freeze (everything stopped, or only this
   company's entries tried) make at most one occasion; an answer in time to the company's own entry clears what was
   counted. Another company's entry stop is neutral (two large companies are both marked). Tests: `TestSlow232FreezeDoesNotMark`
   (both shapes of a freeze), `TestSlow232FastCompanyUnaffected` (one stop between answers: not marked).
2. **No entry request for a marked company, by any path.** The new-line fetch (by MasterID, by number), the held resolver
   (`liveResolveOne`, `liveResolveGuid`) and the cancel/delete proof all go through `fetchVouchersByMasterIn` /
   `fetchVoucherByNumber`, which refuse before sending; the callers also check first, so not even the company list is
   asked for them. `TestSlow232CompanyMarkedAfterTwoStops` counts the stand's requests over days of resolver turns.
3. **An ended line is never asked or sent again**, whatever FinCom lists: the cloud keeps listing a held line without a
   body (heldLines, refetch) for 7 days; `applyRefetch` would otherwise treat a ":resolved" sent without a body as an
   older bridge's and ask afresh (`Again`). The ended set closes that. `TestSlow232HeldTimedOutBacksOffHours` feeds both
   lists back for 7 days and counts requests and lines.
4. **Timed-out tries now count toward the end; never 7 days.** 1 h, then 4 h, then the end; the stops of the original
   fetch count as one (`slowHeld` set only when its asks were stopped or not answered). A line from FinCom's list gets 3
   timed-out asks (at once, +1 h, +4 h). An answered ask keeps the 10-minute spacing and the 20-try cap. Lines not asked
   because the retry schedule waited (nothing sent) are not counted, as before. Tests: `TestSlow232HeldTimedOutBacksOffHours`,
   `TestSlow232CloudHeldLineTimedOut`; 2.3.1's `TestRetrySilentThreeMinutesThenAnswers` updated to the new rule (each held
   line one timed-out ask, then 1 h), its other assertions unchanged.
5. **Small companies as in 2.3.1.** A company answering in time is never marked and its fetch path is unchanged; the only
   difference for it is b (a held line whose ask timed out waits 1 h, not the next retry try), which the owner asked for
   every held line. The whole existing suite passes; the tests changed are the version pins (and the two fixtures carrying the version), the decision-line tests and release_check_test's real-line cases (2.3.1's line kept as history), and two 2.3.1 tests that encoded the old re-ask of a timed-out held line at every retry try (`TestRetrySilentThreeMinutesThenAnswers`, `TestH1RetryCancelAfterTwoSecondStop`: now asked again after 1 h, their other assertions unchanged).
6. **The 2 s stop, the retry schedule, postings first, one request at a time** are untouched: `invokeTally` only adds an
   observation after `retryNote`; the callback is chained, never replaced. No request added or changed:
   `TestAllowListUnchanged` passes (hash unchanged).
7. **Locks.** `slowSt.mu` is never held while taking `live.mu` or `heldMu`; `slowNote` logs after unlocking; `heldGUID`
   (its own lock, a file read) is called under `slowSt.mu` only when a company is marked. `liveHeldEnd` takes `live.mu`
   after the resolver has released `heldMu` (the deferred ends run after the unlock).
8. **The beat shape fits the cloud unchanged.** tally-ingest's `cleanOffs` keeps `{off: true, seconds 0..3600, at <= 30,
   why <= 300}`: `seconds` is the limit (2), `at` an RFC 3339 time (25 characters), `why` under 300. `company`, `since`,
   `timesOver`, `lastMs` ride along in the beat and are dropped by the cloud (they are in the bridge's log and file).
9. **The page never shows 2.2.x's switch-off.** Gated on the bridge's version (2.3.2 or later);
   `run_tally_entry_fetch_off.py` (2.3.1 bridge with recorderOff) still passes; `run_tally_slow_company.py` covers both.

### Lows (not fixed in 2.3.2; for the next release)

- **L1** A false mark needs two separate freezes that each fall exactly on this company's entry ask with answers in time
  just before and after. If it happens the company's entries wait as held lines until the next bridge version (the Day
  Book settles them). By the owner's design: no manual resume.
- **L2** The ended line goes up as a second row ("<line id>:resolved", no body) beside the original held row; FinCom shows
  both held, the newer one with the Day Book words. The cloud keeps listing the original for 7 days (heldLines at most
  200, refetch at most 20, oldest first); the bridge ignores it. A cloud rule to stop listing a line whose ":resolved"
  row carries the Day Book words would remove the noise (a cloud change; the owner preferred none for 2.3.2).
- **L3** The give-up words for b are new ("Tally did not answer in time for this entry 3 times; upload that day's Day
  Book to settle it") rather than `liveHeldGiveUp`'s "after 20 tries", which would not be true here; both end with the
  Day Book words.
- **L4** The mark is keyed by the company's name (and its GUID when known): a company renamed in Tally is asked again
  until it is marked again.
- **L5** `heldLine.Slow` never resets: a line that once timed out keeps the hour spacing even if a later ask is answered
  (it still ends after 3 timed-out asks or 20 answered ones).
- **L6** The occasion counts are kept in memory only: a restart starts them again (the mark itself is on disk).

## Tests

- Go, written first (red output kept: `slow232-red.txt` in the session's scratchpad): `bridge-go/slow232_test.go`
  (8 tests). Full suite green, `go vet` (linux, windows) clean.
- App: `tests/run_tally_slow_company.py` (red before the page change, green after), with `run_tally_entry_fetch_off.py`
  and `run_tally_computers.py` green.
