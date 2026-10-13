# Code review: FinCom Bridge 2.3.3 (a High in 2.3.2: a new save unsent behind the held backlog)

Reviewed: 07-Oct-2026, an adversarial self-review of the diff, by the author (the owner's rule for this release: written
from the diff after an honest adversarial self-review; any High or Medium fixed before the build).

Range: b1e5858..68d717c

Read with `git diff b1e5858 68d717c -- bridge-go/ tests/ docs/tally-allowlist.md`.

## What changed

- `bridge-go/recorder_live.go` `liveFetchBodies` and `bridge-go/recorder_resolve.go` `liveFetchByNumber`: an entry whose
  body is not there on its first attempt (the retry schedule waiting, a 2 s stop, no answer, a passing reason, the turn's
  20 s used, not found by its number yet) is sent at once, held, with plain words (`liveHeldNow`, `liveWaitWords`:
  "waiting: Tally took longer than 2 s; FinCom asks again at HH:MM", or "Tally busy", or "Tally has not shown this new
  entry yet"). It joins the held list marked fresh (`heldLine.Fresh`), due at the next try (`Last` empty when nothing was
  asked). A cancel asked for its GUID is held as one this Tally could not be asked about (`liveGuidUnproven`, asked again
  by itself). The 3-try counting (`again`, `c.tries`) and `waitRetry` are gone.
- `liveUploadStep`: a company whose first line waits for its first ask by number (`liveYoung`, the few seconds of
  RecorderNumberWaitMs) does not hold the queue head: the next company goes. A safety net: a line of the group still
  without its body after RecorderHoldAfterMs (4 s) goes up held ("FinCom is posting to Tally" during a posting), or a
  ledger goes without its body.
- `liveUploadOnce`: while live lines wait for their body, the resolver takes at most every other try of the retry
  schedule (`liveResolverTook`, `retryTakesNow`).
- `liveResolveTurn`: the newest first (fresh lines, the least asked first, then by when they joined); the owner's rule
  of 07-Oct-2026 evening: a held line is asked again **at most once** (`heldLine.Allow`, `Asked`; 2 for a new save held
  before Tally was asked at all), with one request (`liveResolveOne` no longer falls back to the number after the
  MasterID); an ask that stops, is not answered, or is answered without the entry ends the line at once with the Day
  Book words (`liveHeldSlowGiveUp`, `liveHeldOnceGiveUp`) as its `:resolved` line. The 1 h / 4 h ladder and the 10-minute /
  20-try re-asks are no longer reached. Nothing is asked for a company with no starting point yet (the request would be
  refused before sending): the line waits, its ask not spent.
- `bridge-go/inflight.go`, `bridge-go/tally.go` (`tallyRaw`, `enterTallyLock`, `invokeTallyNow`, `invokeTally`),
  `bridge-go/retry.go` (`retryLift`), `bridge-go/jobs.go`: brought in from next-inflight (72c6d36) with its tests
  (`inflight231_test.go`, `inflight232_test.go`): a request the bridge stops waiting for keeps its connection; its answer
  is read and discarded; the per-Tally lock is held until then (TallyAbandonMaxSec, 600 s, at most); a background request
  meanwhile is refused (as a retry wait), a person's read waits 20 s then is refused in plain words, a posting waits and
  says so. next-inflight's 20 s single-entry wait (`entryTC`) is not brought in.
- `bridge-go/retry.go` `retryTake(id)`: a small check (FinComCompany, FinComCompanyNumbers, TDSDeskCompanies, FinComFree)
  that found the schedule waiting has the next try kept for it, 120 s at most (RecorderSmallTrySec), so the slow-company
  rule sees another request answered in time between two entry stops. `slowco.go`: the window 15 minutes (was 10).
- `bridge-go/recorder_live.go` `liveBeat` / `liveQueueWaitWords`, `bridge-go/inflight.go` `earlierPageWords`,
  `bridge-go/cloud.go`: the beat's recorderState carries `heldAsking` per company; recorderWaitWords (already kept by the
  cloud and shown by the page) also says lines waiting 30 s or more, and "Tally is still finishing an earlier request".
- `bridge-go/util.go`: 2.3.3. `docs/tally-allowlist.md`: the decision line and a dated note (the table and its hash
  unchanged).
- Tests: `backlog233_test.go` (new, red first: 1e4d6c5); 2.3.2 tests changed where the owner's rules changed the
  behaviour (listed below); `tests/run_recorder_server.py` 2.3.3 (the cloud: a held line with no GUID, its `:resolved`
  applied once, the held row replaced, a second `:resolved` a duplicate).

## Tests changed, and why

Each encoded the behaviour this release removes on the owner's instructions:

- held at once instead of unsent until 3 stops: `slow232_test.go` (CompanyMarkedAfterTwoStops, FreezeDoesNotMark,
  FastCompanyUnaffected), `recorder_live_test.go` TestLiveBodyFetch, `recorder_probes_test.go`
  TestBodyFetchOffAfterSlowAnswer, `review222_test.go` TestR222HardTwoSecondStop, `review222e_test.go` (the decision
  log's words), `parta231_test.go` TestPartATurnTimeUsedNextTurn, `inflight231_test.go` TestInflightBusyFiveMinutesTenEntries;
- asked again once instead of 1 h / 4 h or 10 min x 20: `slow232_test.go` (HeldTimedOutBacksOffHours,
  CloudHeldLineTimedOut), `retry231_test.go` TestRetrySilentThreeMinutesThenAnswers, `review222_test.go`
  TestR222HeldTwentyTries, `body230_test.go` TestBody230RefetchSpacedAndStopped, `nws144_test.go` (ByNumberNoneOrTwo,
  HeldResolvedLater), `review222b_test.go` TestR222bPreMismatchFlagged;
- the version and the decision line: the version pins, `slow232_test.go` VersionAndDecisionLine (2.3.2 kept as
  history), `release_check_test.sh` green 5 / red 14, the fixtures' version.

## The independent review of the first build (07-Oct-2026, its range ending at ce79426), and what changed for it

No High; two Mediums, both against rule c (every line in FinCom within 10 s), fixed test-first (red at 22c7afe, fixed at
a6cfda0), and one Low fixed:

- **M1** (fixed). With Tally healthy the resolver ran before new saves and could ask 10 held lines at up to 2 s each (the
  every-other-try guard never tripped: `retryTakes` moves only while the schedule is active). Now live lines go first, and
  the resolver stops before each ask while a line read from the add-on waits (`liveQueueReady`; the resolver's own
  `:resolved` lines do not count): a save waits for one ask at most. Test: TestBacklog233M1SaveDuringHealthyResolverTurn
  (12 held lines answered at "1.5 s", a save during the turn, in the cloud within "10 s").
- **M2** (fixed). The body fetch read the whole group (8 saves at 1.8 s: 15 s for the first) before the safety net ran.
  Now, before each entry request of a group (by MasterID, by number, the by-number fallback), the lines not asked yet go
  up held once one of them has waited 4 s (`liveOverdue`); the ones read go with their bodies. Test:
  TestBacklog233M2BurstOfEight.
- **L1** (fixed). A held line's ask that a posting stopped after it reached Tally counts as its ask (`tallySent` moved),
  so Tally never gets two requests for one held line.
- **L2** (kept, the owner's one-request rule): no by-number fallback after a MasterID miss.
- The release-check note: the first build (ce79426, setup 3189a834..., never published) is reverted (cd5afb7) and 2.3.3
  was built again after these fixes (and once more after the re-review below).

The re-review of the fixes (07-Oct-2026, its range ending at a6cfda0) confirmed M1, M2 for vouchers and L1, and found two more,
both fixed test-first (red at 854a2af, fixed at 68d717c):

- **Medium: M2 for ledger lines** (fixed). The ledger loop had no 4 s check: a masters import of several ledgers at about
  1.8 s each held back the group's vouchers, bodies already read, for up to 20 s. Now, before each ledger request, once a
  line of the group has waited 4 s the ledgers not read yet go without their body (`liveLedgerLateWhy`; FinCom takes them
  from the ledger changes). Test: TestBacklog233M2LedgerBurst (8 ledgers at "1.8 s" with a voucher).
- **Low: L1 by the global counter** (fixed). "Reached Tally" was read from `tallySent`, which any request moves; an ask that
  waited for the lock or gave way before it was sent could be counted and its line ended unasked. Now the request itself
  says it was sent (`TC.sentOut`, set by `invokeTallyNow` once the request went). Test: TestBacklog233L1UnsentAskNotCounted.
- The second build (96ace3a, setup 71607195..., never published) is reverted (644907a); the reviews' range ends at the last
  code commit, 68d717c.

The real-Tally harness (`only=backlog233`) has these scenarios too: (8) a burst of 8 changed ledgers and a voucher at 1.8 s
each, and (6) 10 held lines of the small company answered in
1.5 s (the timing proxy holds each request; Tally itself is not busy then) with a new save made while they are asked, and
(7) a burst of 8 saves at 1.8 s each.

## Findings

No High. No Medium open. Checked on purpose:

### Checked and holding

1. **Every save reaches FinCom.** Each path out of `liveFetchBodies` / `liveFetchByNumber` that used to leave a voucher
   line unsent now sends it held; before each entry request the lines not asked yet go up held once one of the group has
   waited 4 s; the resolver yields before each ask to a waiting line. The only remaining waits are a posting (`gaveWay`,
   then the 4 s net) and a by-number line's few seconds before its first ask (it holds only its own company). Stand: no
   line over 5 s; a new save behind 40 held lines in under 1 s; a save during a healthy resolver turn, and 8 saves at
   "1.8 s", each within "10 s".
2. **The cloud keeps the held line and replaces it once.** Verified on the stand cloud (pg_stand, the real migrations):
   held with the words and no GUID, then `:resolved` applied, held row `replaced`, a second `:resolved` `duplicate`, the
   entry in the copy once. No cloud change.
3. **One request per old held line.** `liveResolveOne` asks by MasterID or by number, never both; the end is decided in the
   same turn's merge, under the held list's lock; an ended id is kept (`*.ended.txt`), so heldLines / refetch never bring
   it back.
4. **Nothing sent into a Tally still on an earlier request.** The per-Tally lock is held by the abandoned exchange until
   its answer (stand: at most 1 request at Tally at once with 40 lines asked; inflight tests: postings wait and are not
   lost; the 600 s bound releases it with one log line).
5. **A freeze still never marks.** The small check gets a try, but in a freeze it is not answered in time either, so the
   stops around it do not count (TestBacklog233FreezeStillDoesNotMark, TestSlow232FreezeDoesNotMark).
6. **Lock order.** `liveHeldAsking` takes heldMu then live.mu, as the resolver does; `liveBeat` calls it before live.mu.

### Lows (next release)

- L1. The words on a held line name the next try's time; when that ask stops too, the cloud keeps the earlier time until
  the end line comes (seconds later on a lifted schedule, minutes on a backed-off one).
- L2. A held line's one ask by MasterID no longer falls back to its number: a line whose MasterID names another, unsaved
  entry ends with the words instead of being found by number.
- L3. A voucher line of a source other than the add-on (B / C, unused since 2.3.1) that goes up held is not asked again.
- L4. `heldLine.Slow`, `liveSlowSpacing` and the 20-try words stay in the code, unreachable; to be removed.
- L5. The small-check reservation can delay an entry request up to 120 s when the small check that wanted the try does
  not come back for it (a posting started meanwhile, say).
