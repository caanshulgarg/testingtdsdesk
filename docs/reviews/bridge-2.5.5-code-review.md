# Code review: FinCom Bridge 2.5.5 (the full ledger read stopped at 2 s; a per-login port in tally.ini)

Reviewers: one independent review session (the coordinator's), on ed7a618d8, reading the code only (no build and no
test run: the review machine's disk was nearly full). Nothing was fixed here; each finding names the file and line on
ed7a618d8 and a scenario.

Range: c4bf645d4..952eaf8f1 (the release, after the third review's fixes; this first review: c4bf645d4..ed7a618d8)

(bridge-go/: ledgers.go, tdsnatures.go, iniconnect253.go, loginport255.go, tallyini.go, util.go, the version in the
tests and fixtures, tests/run_login_port.mjs; docs/tally-allowlist.md's 2.5.5 lines. server/tally-cloud/index.ts was
read for how the cloud takes a ledger list's `skipped`; it is not in the range.)

## What 2.5.5 changes

1. The full ledger read (Update now, the nightly run, the ledger wake): every request of the round (groups, natures of
   payment, each ledger chunk) has the 2 s hard stop (ledgerTC, ledChunkSec 3 s). A stopped chunk is halved 2000 to
   125 with only the 30 s stop cool-down; the 125 chunk stopped ends the turn (back-off) twice, the third time in a row
   it is halved down to one MasterID; a single MasterID stopped is skipped as "takes Tally longer than 2 s" and asked
   again alone at the first Update now / nightly run of each later day (slowRetryDue, slowRetry). A stopped group list
   no longer holds the ledgers (groupsStopped: the groups FinCom has are kept).
2. tally.ini only this login uses: when the bridge switches the connection on and the file names no port, the port
   FinCom's Tally page proposes for this login (loginOwnPort, a port of connectSteps.js ownPort / tallyPort.js
   freePort) is written when no other tally.ini names it and nothing listens on it; else the 2.5.3 choice.
3. BridgeVersion 2.5.5.

## What was checked and holds

- One request in flight: every new request (group list, natures, chunks, the slow retry) goes through invokeTally and
  the one Tally lock; a stopped request keeps the lock until Tally has finished it (holdUntilAnswered), and the next
  background request is refused during the 30 s cool-down (stopHeld, errBackoff) and while Tally is still on it
  (earlierRefusal). ledgerTC copies the TC and clears slotOut / sentOut; the keep run's TC is copier, not bg, not
  person, so limitMs really applies (tally.go:1184).
- Postings first: a posting still cancels a background read at the lock (enterTallyLock); no new path skips that.
- No hot loop: every `continue` in the round moves `after` (a skip, a retry read or kept skipped); every return after a
  stop is errBackoff (keep.go sleeps 5 s, nothing sent during the cool-down) or a plain error (setBgBackoff).
- The minStops counter is saved, reset by any chunk in time and by a new round, and counted only at the smallest
  chunk outside the halving to one MasterID.
- A ledger read again after a retry: removePoison, ledSlowTry entry dropped, the rows appended to the round's read; a
  ledger deleted in Tally answers with no rows and is then dropped as gone, as it should.
- tally.ini: the write path (Lstat, no links or junctions, O_EXCL backup, read back), the encoding and line endings
  (iniDecode / iniEncode, the file's own newline) are unchanged; the new code only chooses the number in
  "ServerPort = %d". A port the file names is kept; the per-login port is asked only when this write switches the
  connection on.
- loginport255.go matches tallyPort.js freePort for ordinary names: the same candidates (9000-9099 less PORT_AVOID),
  the same white space set and collapsing, h = h*31 + the first UTF-16 unit of each code point mod 9973, the same
  start, the same "first candidate" fallback; loginShort matches connectSteps.js short.

## Findings

- H1 (high, fix first): a ledger that hangs Tally is now taken as "slow" and asked again every day.
  ledgers.go:591-599 marks any single MasterID that was stopped as "takes Tally longer than 2 s", and slowRetry
  (ledgers.go:896-945) sends it again alone at the first Update now / nightly run of each day. With every request now
  stopped at 2 s (the stop fires before the 3 s wait, ledChunkSec), the old classification "does not answer and holds
  Tally" (addPoison, never asked again: the 696-699 incident of 02-Oct-2026) can no longer be reached from a stop, so a
  ledger that holds Tally for minutes is retried daily. Scenario: a ledger whose export keeps Tally busy 8 minutes is
  found by halving; the next morning a person clicks Update now, slowRetry sends it, the bridge stops waiting at 2 s,
  but Tally keeps the request and the bridge keeps Tally's lock until Tally finishes (holdUntilAnswered, up to
  TallyAbandonMaxSec 600 s); a FinCom posting made meanwhile waits up to 8 minutes, and Tally's window is frozen for
  the person at Tally, every day. Discovery itself also costs more hangs than 2.5.4: the 125 chunk now needs three
  stops (with back-offs) before the halving, where a 20 s timeout went into the halving at once. The bridge already
  knows how long Tally kept a stopped request (abandonSlot took / bound, read in invokeTally, tally.go:1032-1040), but
  ledgerTC drops slotOut, so the round cannot tell 2.5 s from 8 minutes. Suggested direction: classify by Tally's own
  finish time (finished within TallyAbandonWaitSec: slow, retried; later or at the bound: hangs, never retried), or
  retry only during the nightly run.
- M1 (medium): in the halving to one MasterID, one stop is taken as proof that a ledger is slow. The three-in-a-row
  guard (ledgers.go:555) applies only at the 125 chunk outside `iso`; below it every stop halves again and a single
  MasterID stopped once is skipped (ledgers.go:578-599). Scenario: the halving has begun, and the person at Tally opens
  a heavy report (or another login's Tally is busy on the same machine): each ledger asked alone is stopped at 2 s and
  skipped, one every ~30 s (the cool-down), so a 30-minute busy spell marks some 60 ordinary ledgers skipped. Held
  ones keep FinCom's old copy (ledgers.go:657-665); new ones are missing from FinCom until a later Update now / night
  run reaches each of them (once a day each). Suggest the same three-in-a-row rule (or one quiet re-ask) for the
  single MasterID before it is skipped.
- M2 (medium): a borderline Tally can keep a large company's round from ever finishing. In the halving, a chunk of
  62 in time doubles to 124 (62*2 < 125, ledgers.go:620-624) and stays in `iso`; if 124 ledgers take just over 2 s,
  the round goes 62 in time, 124 stopped (30 s cool-down), 62 in time... about 62 ledgers per 35-40 s. A company of
  50,000 ledgers then needs about 8-9 hours, more than LedgerResumeHours (6 h, ledgers.go:444), so the round starts
  again from MasterID 1 and ledger-read.jsonl is deleted: the full list never completes and FinCom never gets a
  complete round (no deletions, no openings round). In the same pattern each new run of three stops at 125 calls
  setBgBackoff again without a step in between that succeeds (keep.go:1340, 1355), so the back-offs grow to the
  30-minute maximum. Suggest the doubling to reach the smallest chunk (e.g. size*2 >= min-1, or min(size*2, min)), and
  that a round making progress is not restarted by age alone.
- L1 (low): the day's retry is used up without asking Tally. slowRetry (ledgers.go:907-913, 937-943) saves today
  before the send and gives it back only for gaveWay errors. errBooksFromUnknown (ledgers.go:162), a probe hold
  (tally.go:1448) and earlierRefusal (inflight.go:87, an errRetryWait) send nothing but keep the day's try. Scenario:
  two slow ledgers next to each other; the first one's retry is stopped, the second one's retry 30 s later finds Tally
  still on the first (earlierErr): it is not asked, and stays skipped one more day.
- L2 (low): slowRetry counts Tally closed (errClosed, tallyNoAnswer) as "still takes Tally longer than 2 s"
  (ledgers.go:924), and the halving still marks a single MasterID that met errClosed as "hangs Tally" for good
  (ledgers.go:600-602, as before 2.5.5). Scenario: the person closes Tally during the halving; one ordinary ledger is
  never asked again. More likely now, as the halving happens far more often.
- L3 (low): the natures of payment stopped at 2 s are dropped for the round without being counted (tdsnatures.go:
  151-170: a stop is not tallyNoAnswer, so natMiss does not grow and natOffVer is never set). A Tally whose natures
  always take over 2 s never sends them and says so only in the log, once per round. Not wrong, but the "Tally did
  not answer twice" rule no longer applies to them.
- L4 (low): a group list stopped in a company's first round sends the round with no groups (group-list.json does not
  exist yet; ledgers.go:681-689), and the round's end line counts the groups of the old file (ledgers.go:715). The next
  full read asks again, so this heals; a group list that always takes over 2 s is never refreshed and is said only in
  the log.
- L5 (low): setPoisonWhy appends a new `skipped` entry to ledger-out.json each day the ledger stays slow
  (ledgers.go:958-970), and a ledger cleared by slowRetry keeps its `skipped` entry in an outbox not yet sent (nothing
  removes it). Harmless today, because the cloud does not read `skipped` (below).
- P1 (low, as in 2.5.3/2.5.4, not a regression): "a working port is never changed" does not hold for a tally.ini with
  "Client Server = Both" and no ServerPort while the user's Tally listens on its default 9000. iniConnectPref
  (iniconnect253.go:143-152) does not prefer the login port there (right), but freeTallyPort sees 9000 as used by the
  Tally itself (iniPortUsed counts every listener, iniconnect253.go:194-201) and writes ServerPort = 9001; Tally moves
  at its next start. The new comment (iniconnect253.go:15, "a file whose connection is already on (its port works)")
  says otherwise; the test (loginport255_test.go:172) uses a `used` that is always false, so it does not show this.
- P2 (low): when the login's own port is taken, the bridge falls back to freeTallyPort (9000 first, iniconnect253.go:
  150-152), not to the login's next candidate as the page would (tallyPort.js freePort with that port seen). FinCom's
  Tally page may then show one port while tally.ini has another (9000, the one the page avoids).
- P3 (info): jsLower's final-sigma rule looks only at the next and previous rune being letters (loginport255.go:40);
  JavaScript skips case-ignorable characters. A lone UTF-16 surrogate in a Windows name becomes U+FFFD in Go. Only
  exotic names; the port then differs from the page's.
- P4 (info): with no Owner set, a bridge run as the service computes the port from "SYSTEM" (win_platform.go:484). The
  page uses the same reported user, so they agree; the port is simply not "the login's".

## Cloud side (server/tally-cloud/, a skipped ledger arriving in a normal list)

- The cloud keeps no "skipped" mark: applyLedgerList (server/tally-cloud/index.ts:1413 on) never reads body.skipped,
  and nothing else in server/ does. So there is nothing to clear when a skipped ledger arrives in a normal list: the
  row is upserted like any other. The skip is shown only by the bridge itself (reads.go:77 and 388, skippedLedgers from
  st.ledPoison), which removePoison does clear. The code's and the allow-list's words "named to FinCom" are true only
  for the bridge's local /ledgers answer, not for FinCom's cloud; a person who uses FinCom from another computer never
  learns a ledger is skipped. Not a 2.5.5 regression, but 2.5.5 makes skips far more frequent (H1, M1).

## Known limits (as the change states)

- A group list or natures list that always takes over 2 s is never read (L3, L4).
- A ledger that is truly slow on its own stays out of FinCom until a day it answers in 2 s.

## Tests

Not run here (disk). Read: ledgers255_test.go (halving, the smallest chunk's two clean ends, the group list stopped,
the slow ledger skipped, asked once a day, cleared), loginport255_test.go (the page's algorithm against node, written
for the own file, fall back, never a named port, shared computer, the production hook). Missing: a single MasterID
stopped once by a busy spell (M1), a stopped request Tally keeps for minutes (H1), the 62/124 pattern on a large list
(M2), and "Client Server = Both" with no port while Tally listens on 9000 (P1).

## Verdict

Fix first: H1 (a ledger that hangs Tally asked again daily, holding postings up to 10 minutes). M1 and M2 should be
fixed in the same pass; the rest can follow.

## Second review

Reviewers: a second independent review session, on 0455fe936, reading the code only (no build and no test run: the
review machine had about 350 MB of disk left). Line numbers are on 0455fe936.

Range: c4bf645d4..0455fe936 (the fixes: ed7a618d8..0455fe936, commits c7f1bf56e and 0455fe936)

### The first review's findings against the fixes

- H1: fixed for the single ledger. readLedgerChunkSlot keeps the stopped request's abandonSlot (k.tc is not bg, so
  invokeTally passes slotOut through to invokeTallyNow), ledJudge waits for slot.done without holding anything itself
  (the one lock stays with holdUntilAnswered, as before), and ledKept takes the stop plus Tally's own time after it;
  over LedgerHangSec (30 s) or ended by the long bound, the ledger is poisoned for good (slowSkipped reads the "why",
  and the hang words do not match it), also when found on the nightly retry. The retry is nightly only, gives way to a
  posting (slowRetryDue postingGoing, t.yield). So a ledger that hangs Tally holds postings at most once more after it
  is found, and only at night. Not covered: the chunk-level stops (N3).
- M1: fixed for the single ledger (oneStops, three stops in a row with the back-off between), but the hang path skips
  that rule and is permanent (N2); chunk sizes 2-124 in the halving still halve on one stop.
- M2: not fixed (N1). The back-off growth part is fixed (clearBgBackoff on a chunk in time, ledgers.go:638); the
  62/124 pattern is not, and the round's 6-hour restart (ledgers.go:458) is unchanged.
- L1: fixed (used() only on a stop or a timeout; refused, given way, books-from unknown keep the day's try).
- L2: fixed (errClosed on a single MasterID marks nothing, ledgers.go:575-579; slowRetry returns it without using the
  day). A Tally closed while it is still on a stopped single request ends that request quickly and counts as one
  "slow" stop (of three): harmless.
- L3: fixed as asked, with a side effect (N5).
- L5: fixed (withoutMid in addPoisonWhy / setPoisonWhy; removePoison clears the outbox not yet sent).
- P1: fixed for the plain case (iniconnect253.go:165); the Tally found on 9000 is not checked to be this login's or
  this file's (N4).
- P2: fixed as far as the bridge can see (loginOwnPortFree, loginport255.go:107); see N6.

### New findings

- N1 (medium, fix first): M2's oscillation is still there, and the regrowth adds it at every size. ledgers.go:642
  doubles a chunk in time up to 2,000 and keeps `iso` until 2,000 is reached; in `iso` the three-stop rule does not
  apply (ledgers.go:590 requires !iso), so a stopped chunk of 125 or less is halved at once (ledgers.go:613), and a
  larger one is halved by size/2. Scenario (M2's own): 125 stopped three times, halved to 62; 62 in time doubles to
  124 (min(2000, 124)); 124 stopped halves to 62; and so on: still about 62 ledgers per 35-40 s (each stop costs the
  30 s cool-down and freezes Tally for the person), and a 50,000-ledger company still passes LedgerResumeHours (6 h)
  and starts again from MasterID 1. New with the regrowth: after a genuinely slow ledger is found on a Tally that takes
  just over 2 s for ~1,000 ledgers, the round goes 512 in time, 1,024 stopped, 512, 1,024 stopped... to its end: a
  stop every other chunk, where before the fix it went on steadily at 125 with no stop. The test
  (TestLedger255SlowPatchLargeCompanyFinishes) has one slow ledger on an otherwise fast Tally, so it does not show
  either. Suggest: grow only until the first stop after the halving, then leave `iso` and keep that size for the rest
  of the round (or half of it); and keep the 125 floor's three-stop rule outside the single ledger.
- N2 (medium): one stop that Tally happens to keep over 30 s poisons an ordinary ledger for good, without the
  three-stop rule. ledJudge (ledgers.go:1052-1059) takes `hung` from a single observation; nothing ever clears a
  poisoned ledger (reads.go only shows it). Scenario: the halving is under way (a slow ledger found earlier, or a busy
  spell); the person at Tally opens a heavy report or runs a backup that takes 60 s; the next single ledger asked waits
  behind it inside Tally, is stopped at 2 s and finished by Tally at 45 s: it is marked "does not answer and holds
  Tally" and is never read again: its renames, opening and GSTIN never reach FinCom, and a new ledger never appears.
  2.5.4 had the same risk at its 20 s timeout, but the first 2.5.5 retried daily and M1 asked for three in a row.
  Suggest: a hang counts as one stop of the three (or needs two hangs in a row), and a hung ledger is retried rarely
  (e.g. weekly, nightly only) rather than never.
- N3 (low): the chunk-level stops are not judged by Tally's time. A ledger that hangs Tally for minutes is found
  through the 125 chunk's three stops (ledgers.go:590) and then the halving, each stop holding Tally's lock (and any
  posting) until Tally finishes: about two more holds than 2.5.4 (which went into the halving on its first 20 s
  timeout). Bounded and one-off per ledger. Suggest: a chunk stop that Tally kept over LedgerHangSec goes into the
  halving at once (the slot is already at hand there, ledgers.go:565).
- N4 (low): the P1 check takes any Tally program on 9000 as this file's Tally (iniconnect253.go:105: the name only;
  not sessionOwner, not the program's folder against this tally.ini's). Scenario: two TallyPrime installs of the same
  login, both "Client Server = Both" with no port, one running on 9000: neither file is given a port, so the two still
  clash on 9000 when both run (before: the other got 9001). Or another login's Tally on 9000 with this login's own
  tally.ini: this one is left on 9000 too. Nothing is written in either case (the status quo), and on a shared
  computer nothing was written anyway; when Windows does not give the listener table (netState not ok) the old 9001
  write still happens (iniPortUsed falls back to a connection). Suggest: match the listening process's path to this
  tally.ini's folder (proc.Path), else keep the old rule.
- N5 (low): two 2-second stops of the natures of payment in a row turn them off until the next bridge version
  (tdsnatures.go:160-169, natOffVer). Scenario: Update now twice while Tally is busy: the natures are not asked for
  months. Suggest: stops count apart from no-answers, or natOffVer only for errTimeout / errClosed as before, with the
  stops said only.
- N6 (low): the bridge's "taken" (iniPortUsed: every listener and every other tally.ini's named port) is wider than
  the page's (connectSteps.js ownPort: other logins' bridges' tallyPort only). A login port taken by a non-Tally
  program, or named by a TallyPrime install that is not running, gives the next port in the file while the page still
  shows the first. Better than 9000, but "page and bridge agree" holds only for ports the page also sees.
- N7 (info): the slow ledger's retry is nightly only (ledgers.go:930), and the nightly run needs Tally open at
  KeepDailyAt (19:00) and 15 quiet minutes; an office that closes Tally by 19:00 never retries, and a round resumed by
  a later Update now after the nightly run has passed the ledger does not retry it that day. As designed, said here so
  the "asked again at a later night's run" words are read with it.
- N8 (info): ledPend is in memory and keyed by company; a bridge restarted while a single ledger is pending asks it
  again with oneStops kept (fine), and a retry pending is judged by whichever run reaches the loop next (fine).

### Verdict (second review)

Fix first: N1 (M2 is not fixed, and the regrowth adds a stop every other chunk after a slow ledger is found). N2
should be in the same pass. H1, M1 (single ledger), L1, L2, L3, L5, P1 and P2 are fixed; N3-N6 can follow.

### Known, left as they are (the coordinator's decision, 07-Nov-2026)

N1, N2 and N5 are fixed on next-bridge-255 after 0455fe936. These stay as they are in 2.5.5 and are known:

- N3: the chunk-level stops are not judged by Tally's time; a ledger that hangs Tally costs about two more holds while
  it is found than in 2.5.4 (bounded, once per ledger).
- N4: the P1 check takes any Tally program listening on 9000 as this tally.ini's Tally (its name only, not its folder
  or Windows user); in the cases named nothing is written (the status quo).
- N6: the bridge's "taken" ports (every listener, every other tally.ini's port) are wider than the page's (other
  logins' bridges' Tally ports); for a port only the bridge sees taken, the file gets the login's next port while the
  page still shows the first.
- N7: a skipped ledger is asked again only at a nightly run (KeepDailyAt, Tally open, 15 quiet minutes); an office
  that closes Tally by then never retries it.
- N8: the pending single-ledger judgement is in memory, keyed by company; a bridge started again asks the ledger once
  more with the stop count kept.

## Third review

Reviewers: a third independent review session, on 353737f12, reading the code, with one targeted test run
(`go test -run 'TestKeepNow|TestHeldRunStillPushes|TestKeepWaitWords|TestLedger255'`: ok, 262 s; the build cache was
cleaned after). Line numbers are on 353737f12.

Range: c4bf645d4..353737f12 (new since the second review: 0455fe936..353737f12, commits 745ee07bd (N1, N2, N5),
a6ee58214 (the keepWait merge, with server/tally-cloud/index.ts) and 353737f12 (the Update now rule))

### The second review's findings against the fixes

- N1: fixed for what it named. When the chunks grow back and one is stopped, the size that last answered in time is
  kept for the rest of the round (ledgers.go:592-600, ls.keep) with the three-stop rule at it (ledgers.go:604), so the
  62/124 and 512/1,024 alternation is gone (TestLedger255GrowBackStopsAtFirstStop asserts no stop after the size is
  kept). Side effect in the halving search: T3.
- N2: fixed. A stop Tally kept over LedgerHangSec is one of the three in a row (ledJudge, ledgers.go:1083-1110), and a
  ledger skipped as hanging Tally is retried at a nightly run a week after its last try (slowRetryDue,
  ledgers.go:951-961; dates are yyyymmdd, so the string compare holds). A skip by 2.5.4 or earlier, with no date, is
  retried at the first nightly run: one hold at night, giving way to a posting. Leftover: T4.
- N5: fixed. A 2-second stop no longer counts toward natMiss (tdsnatures.go:166-168), so natOffVer is set only after
  two real no-answers. A stop sets natWaitNight: Update now and the ledger wake skip the natures (FinCom keeps the ones
  it has; ls.nat is not sent) until a nightly run reads them, which clears it (tdsnatures.go:135-140, 191).
- N3, N4, N6, N7, N8: left as the coordinator decided. N3 is now somewhat larger (T3).

### Checked and holds

- One Tally request in flight: nothing new reaches Tally outside the one gate. holdNow (keep.go:1580) only sleeps and
  asks Windows. ledJudge still waits for the stopped request's slot without sending anything.
- Postings first: the main loop still checks activeJobs after the hold and before any step (keep.go:1290). holdNow
  holds no Tally lock (it runs under keepMu, which postings do not take). A pressed-on slice goes through the gate like
  any read.
- The 2 s stop on the Update now path once pressOn is set: the company list (TDSDeskCompanies, capped at 2 s in
  tallyRaw), the company check (ledgerTC, keep.go:903; both forms), the group list (ledgerTC, ledgers.go:226), the
  chunks (readLedgerChunkSlot through ledgerTC), the natures (ledgerTC), and the count (recorderTC). The day book is
  the one exception (T5), and it is off by default.
- No hot loop: the pressOn branch `continue`s once and then passes the hold. holdNow polls every 200 ms for at most
  KeepNowYieldSec (20 s). Every other wait sleeps 2-5 s or until the back-off.
- Cloud rate: while a run is held, bridgeTurn pushes at most once in 60 s (turnPushAt). The beat is not sent more
  often, and tally-ingest broadcasts keepWait only when it changes (`said`; `since` changes only when the reason does).
- Races on kwRun, kwPending and keepWait: all reads and writes are under kwMu or keepWaitMu. pressOn is read and written
  only by the run's own goroutine. keepWaitBeat takes kwMu twice, and the worst a run ending in between can do is make
  one beat's words a little stale.

### New findings

- T1 (medium, fix first): a push that bridgeTurn starts while a run is held can still be going when the hold ends, and
  then it races the round's write of the ledger outbox, which can lose the round's ledger changes for good. Before
  a6ee58214 a turn push never started while a run was going, and the run pushed only between its own steps. Now
  events.go:353-356 starts `go invokeCloudPush()` whenever keepWaitWhy() != "". The hold can end (a 15 s pause in Tally, or
  pressOn) while that push is still in pushLedgerList: it read ledger-out.json and is waiting up to 120 s per batch
  on invokeCloud (ledgers.go:806-908). Meanwhile step completes a round: saveLedList (ledgers.go:749) and then
  mergeLedOut writes the new rows into ledger-out.json (ledgers.go:751). The push then removes the file
  (ledgers.go:895) or overwrites it with its own copy (ledgers.go:907). The new round's rows are gone, and since the
  held list was already saved, the next round sees no change: a new or renamed ledger never reaches FinCom until it
  changes again in Tally. addPoison, setPoisonWhy and removePoison write the same file mid-round (ledgers.go:1150,
  1175, 1203) and race in the same way. Scenario: the cloud refused the last ledger list (ledPushAfter, the outbox
  waits), or the outbox is a whole list of many batches. The person types in Tally, and an Update now waits and
  pushes. The person pauses, the round completes within the push's 120 s, and the merged rows are deleted. cloudMu does
  not help, because mergeLedOut is not under it. Suggest: have the held run push from its own goroutine, at most once a
  minute in the hold branch of keepWorker, and drop the keepWaitWhy() clause from bridgeTurn. Or guard ledger-out.json
  with one mutex in pushLedgerList and every writer.
- T2 (medium, fix first): an Update now pressed while another run is held does not get the 2-minute rule; it can wait
  up to KeepRunMin (30 minutes). The rule applies only when the run itself is "now" (keep.go:1281). A "now" that
  arrives while a nightly or ledgers run is going is only queued (startKeepRun, keep.go:1136-1150), and those runs keep
  waiting for a 15 s pause until runEnd (only a light run gives up after 2 minutes, keep.go:1274). Scenario: a posting
  with a new ledger starts the ledger wake (kind "ledgers"). The person goes on typing in Tally and presses Update now:
  the beat says "Update now is queued: Waiting: someone is working in Tally...", and nothing is read for up to 30
  minutes. The same happens with the nightly run, which can start while Tally is in use (its 15 quiet minutes are
  FinCom's, not Tally's). Suggest: in the hold branch, when kwPending.kind is "now", treat the current run as pressed
  (the same KeepNowWaitSec from when the Update now came in), or end it so the queued Update now starts and applies the
  rule itself.
- T3 (medium): the N1 fix makes the halving search for a slow ledger cost more stops. During the search, a chunk in time
  deletes `iso` and sets `grow` (ledgers.go:662-668), so the doubled next chunk, which holds the slow ledger, is a
  "growth" stop and sets keep = half (ledgers.go:592-600). Then, because `iso` is gone, the three-stop rule applies at
  that half (ledgers.go:604) before it is halved again. Before, a stop in `iso` halved at once. Each level of the search
  can now cost 4 stops and 2 back-offs (1 and 2 minutes) instead of 2 stops. A model of the state machine (2,000-ledger
  chunk, floor 125, one slow ledger) gives 23 stops on average (18.5 before), and at worst 31 stops and 14 back-offs
  (22 and 4 before). Every stop on a chunk that holds a ledger which hangs Tally keeps Tally's lock (and any posting)
  until Tally finishes (N3). Scenario: a ledger that hangs Tally for 2 minutes at MasterID 1,996: about 9 more holds
  than at 0455fe936 before it is found. Suggest: keep `iso` (immediate halving) until the single ledger is judged, and
  start `grow` only after it (ledJudge's skip, or the single ledger read in time).
- T4 (low): `oneHung` outlives a chunk read in time. ledgers.go:658 clears oneStops but not oneHung (which is cleared
  only at ledgers.go:1106). Scenario: a 45 s report makes one stop on ledger A count as hung. A is asked again and read
  in time. Later in the same round, ledger B is stopped 3 times, each finished in 3 s, and is marked "does not answer
  and holds Tally" (retried weekly, named so to FinCom) instead of slow (retried daily). This is N2's mislabel, moved
  to another ledger. Suggest: delete oneHung beside oneStops at :658.
- T5 (low): pressOn gives way while the person types only before ledger chunks and natures (holdNow). The company list
  (keep.go:1321), the company check (keep.go:903) and the group list (ledgers.go:478) are each sent once without a gap
  check (each is still under 2 s). The day book loop still asks keepHold() (keep.go:956). So with ReadDays on (it is
  off by default and never set from the cloud), a pressed-on Update now reads no days while the person works: it cycles
  every 5 s for up to 30 minutes (writeKeepLoad and invokeCloudPush each time). And at a 15 s pause it reads days with
  k.tc (CompanyCheckSec/20 s, not 2 s), which breaks the "every request ≤2 s" rule if the person comes back during one.
  Suggest: holdNow in the day loop, and ledgerTC for getDayBookXML when pressOn.
- T6 (low): as a service, idle comes from the tray, which posts it every 5 s (win_tray.go:306, sleep at :362), and
  platIdleSec returns it without adding the time since that post (win_platform.go:359-361). So keepTypingNow's 1 s
  gap is seen at 5 s granularity. A slice can start during typing (the tray last saw a pause), or wait up to 5 s past
  a real pause. Not a safety issue (each request is still under 2 s). Also, outside the service, keepTypingNow lists
  every process (localFrontIsTally) every 200 ms while the person types: noticeable CPU on a busy terminal server.
  Suggest: idle + time.Since(trayIdleAt), and a cached front-window check.
- T7 (low): keepWait stays set after the run leaves its loop. setKeepWait("", "") is called only in the defer
  (keep.go:1218). A run that breaks out of a hold (a light run after 2 minutes, runEnd, a pause) keeps the reason
  through keepReleaseLeases and the flush of up to 10 minutes (keep.go:1415-1423). The beat says "Waiting: someone is
  working in Tally" while nothing waits, and bridgeTurn's pushes run alongside the flush (serialised by cloudMu, so no
  harm beyond that). Suggest: clear it right after the loop.
- T8 (info): holdNow runs inside step under keepMu and after the inBudget check, so a step can run past KeepBudgetSec by
  up to KeepNowYieldSec per slice. FinCom's file imports, which take keepMu (keep.go:414, 452), wait that much longer.
  The beat's words say "2 minutes" even if KeepNowWaitSec is set to something else (keepwait.go:83).

### Verdict (third review)

Fix first: T1 (a held run's push can delete a completed round's ledger changes, and they are never sent) and T2 (the
2-minute rule does not apply to an Update now queued behind a held nightly or ledgers run). T3 and T4 belong in the
same pass, since both are small. N1, N2 and N5 are fixed. T5-T8 can follow.

### Known after the third review (the coordinator's decision, 07-Nov-2026)

T1, T2, T3, T4, T5, T7 and T8 are fixed on next-bridge-255 after 353737f12. T6 stays as it is in 2.5.5 and is known:

- T6: as a service, the idle time comes from the tray every 5 s and is not aged since; the 1 s typing gap is seen at
  5 s granularity (a slice may start during typing or wait up to 5 s past a pause; each request is still under 2 s).
  Outside the service, the typing check lists the processes every 200 ms while the person types.

## Fourth review

(Placeholder: a short fourth review of 353737f12..HEAD, the third review's fixes, is on its way. Its findings, and the
decision on each, go here.)

## The release

Range: c4bf645d4..952eaf8f1 (after the third review's fixes: 65f6fdf99, T1-T5, T7 and T8; 952eaf8f1, the dates of
TestOutboxPairAcrossFilesKept made relative to today, since its fixed October files had fallen outside the reader's
31-day window). go vet (Linux, Windows) and go test ./... passed at 952eaf8f1 on 07-Nov-2026, with the page tests
run_tally_basics, run_tally_connect_steps and run_tally_port_step.
