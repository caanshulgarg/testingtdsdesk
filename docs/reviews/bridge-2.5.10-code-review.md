# Code review: FinCom Bridge 2.5.10 (the pick-up acknowledgement, Stop posting's reasons, the bridge heals itself)

Reviewers: the session that built it (a self-review against the owner's rules, below). An independent review is to
follow before the release; this file names the range it is to cover.

Range: 1400f77d6..c936bdcf5 (released 2.5.9 to the version bump)

(bridge-go/: pickack.go (new), daypull.go (pullMayAskWhy: the six conditions with a reason code; applyPeriodDays notes
each book's hand-out and the days it will not read; pullStep says started / refused / queued), cloud.go (the beat's
pickups and lastStop; the heartbeat's retries and its wait), jobs.go (cancelAsked, cancelWords), server.go (/jobs/cancel
through cancelAsked; another login's refusal carries its code; /ping's beatSec), selfheal.go and keepalive.go (new),
win_keepalive.go (new), win_user.go (the supervisor: a stuck heartbeat, why the worker ended, the keep-alive task made),
mode.go (runStarted, beatWatch, runEnded), main.go ("keepalive"), config.go (the last log line kept for its kind),
platform_other.go; tests r2510pick_test.go, r2510heal_test.go, r2510version_test.go, win_keepalive_test.go (new),
r245_test.go (pullReset clears the acknowledgements). server/tally-cloud: index.ts (periodDays' kind, fillDaysOf,
pickupsOf, lastStopOf, info.lastStop, the broadcast), migration-149-bridge-stopped-alert.sql (new, not applied). app:
lib/pickAck.js, lib/bridgeStop.js (new); parts/TallyBtn.jsx, TallyFetch.jsx, TallyProgress.jsx, TallySimple.jsx,
TallyCheck.jsx, StuckJobs.jsx. tests: run_pickups_ingest.py, run_migration149.py, run_version2510.py,
pick_ack_test.mjs (new); run_tally_buttons.py, run_period_ingest.py. docs: MIGRATION-ORDER.md (149). The version
2.5.10 everywhere it is named.)

## 1. The pick-up acknowledgement

- The cloud names what each day is handed out for (periodDays' kind: period; check; fill when tally_check_days.source is
  'fill', one read per book only when check days are handed out). An older bridge ignores the key; with an older cloud the
  bridge takes check from the day's own flag, else period.
- The bridge (pickack.go) notes a hand-out per book and kind when FinCom names a new choice time, or lists it again after
  10 minutes unlisted (Bring missing days keeps the choice time). It says it only once the loop decided: started (the
  first request for it reached the gate to Tally, or the fast window had read it) with when and the first day; refused
  with a reason code from pullMayAskWhy (the same six conditions, same order, looked at where they always were) and fixed
  words (never a port, a computer, a login or Tally's text: TestR2510PickRefusalReasons); queued while another book's day
  is read. Days it will not read at all: another copy of the company (GUID), a company not held, stopped. At most 20, 30
  minutes each, the beat's list under 20 KB (TestR2510PickBeatBound); a start asks for the beat at once, a refusal at most
  every 15 s.
- The cloud keeps it on the computer's beat (info.beat.pickups; no migration): cleaned, merged with the beat before so two
  bridges of one computer keep theirs, 2 hours, at most 20, passed on at once on the broadcast.
- The page (lib/pickAck.js) takes a snapshot before the request and uses only an acknowledgement said after it (no clock
  compared): "Started at 10:42 IST on <login>'s Tally." or "Not started: <the bridge's words>." at once; none: the
  inference as before (run_tally_buttons.py 3b, 4; pick_ack_test.mjs). Check for changes shows the same line while it
  goes.

## 2. Stop posting's reasons

- What may be stopped is unchanged: cancelAsked calls cancelJob exactly where it was called before; the cloud's own
  cancel (cloud.go) still calls cancelJob (TestR2510StopPostingReasons ends with it). New: an answer that says why it
  could not: notHere, notFound, alreadySent (a finished posting is no longer marked), postingNow (the mark is still set:
  the request at Tally finishes, nothing after it goes; stopAsked true), otherLogin (another login's program; error and
  notYours as before, so the page's own handling is unchanged). The words never contain what the page reads as "did not
  answer".

## 3. The bridge heals itself

- The heartbeat loop's progress (beatLoopAt), noted at each turn and at each 5 s slice of its wait. The worker's own
  watchdog ends it (code 13, its reason written first) after 3 minutes without a move, only when something starts it
  again (the supervisor; a service's recovery); by hand it only says so. The supervisor also ends a worker whose /ping
  says its heartbeat has not moved for 5 minutes (the watchdog after the watchdog).
- Retries: 5, 10, 20 s, then the usual 30 s (with a longer CloudBeatSec, up to a minute), for ever; the cloud's idle
  connections dropped at the first failure, after a sleep (the wall clock moved over 2 minutes more than the wait) and
  after a network change (the addresses' fingerprint, looked at every 15 s; nothing of it is sent).
- lastStop: the supervisor writes why the worker ended (Go's panic exit 2, another code, ended as hung), the watchdog
  writes stall, the heartbeat's wait writes sleep; a run that finds its predecessor's mark (running.txt, refreshed every
  beat) without a newer reason writes unclean, or notRunning when the keep-alive task started it. Said in the beat for 6
  hours: times, the code, the kind of the last log line (logCategory; never its words). crash-log.txt keeps them, 256 KB,
  one earlier file.
- The keep-alive task (keepalive.go): schtasks /Create /F /TN "FinCom Bridge keep-alive (<login>)" /SC MINUTE /MO 5 /IT
  /TR "<exe>" keepalive --config "<settings>": no /RU, no /RL, no logon trigger (those need an administrator or a
  password); made by the supervisor's first start, again when the program or settings move, off with NoKeepAlive, removed
  by the per-user uninstall. "keepalive" does nothing while the user's supervisor runs or the setup's Stop is set. Refused
  for a path with a quote or a /TR over 261 characters (TestR2510KeepAliveTask). The Windows service keeps its recovery
  actions (unchanged); the keep-alive is for the per-user install.
- The cloud keeps lastStop on the beat and on the computer (info.lastStop, the newest). The page (lib/bridgeStop.js):
  every bridge of the firm silent over 10 minutes: "FinCom Bridge on the office Tally computer stopped answering at HH:MM
  IST" with what to do (the computer's name only under Advanced); a bridge heard now that says why it last ended:
  "FinCom Bridge restarted itself at HH:MM IST after <why>." Migration 149 (not applied): one bell line a stop.

## The owner's rules, checked

- No request added to the list and no request shape changed (TestAllowListUnchanged; the table's rows are 2.5.9's, the
  stock row's words aside). Nothing in parts 1-3 sends anything to Tally: the reasons are read from what the loop already
  looks at; the self-healing code touches only the heartbeat to FinCom, local files and the local process.
- 2 s, one in flight, postings first, the typing gate: unchanged (the loop's order and gates are as before; pullMayAsk is
  pullMayAskWhy without its code).
- No administrator rights: the task is a per-user one with /IT. No AI anywhere in this.

## Known, to watch

- A refusal is said as soon as the loop finds it (e.g. "someone is working in Tally"); it turns into "Started at …" when
  the bridge starts. A day this bridge finished in the last 2 minutes is not read again, so a hand-out of only such days
  says nothing (the page then infers as before).
- The bell line follows working hours only (as migration 47's); a computer turned off at 18:50 gets one line that day.
- The keep-alive needs Task Scheduler open to standard users (the Windows default); where a policy refuses it, the log
  says so and the bridge still starts at sign-in, as before.
