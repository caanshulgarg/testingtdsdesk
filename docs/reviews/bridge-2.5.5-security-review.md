# Security review: FinCom Bridge 2.5.5

Reviewers: one independent review session (the coordinator's), on ed7a618d8, reading the code only (no build or test
run); the code findings are in bridge-2.5.5-code-review.md.

Range: c4bf645d4..2e06a4f4e (the release, after the third review's fixes; this first review: c4bf645d4..ed7a618d8)

## tally.ini

- The write path is unchanged from 2.5.4 (tallyini.go tallyIniApply): only a tally.ini found next to a TallyPrime
  tally.exe (tallyIniDirsFn), Lstat first, the folder no link or junction (iniDirPlain), the file a plain file, the
  backup made new only (O_EXCL, never through a link), the file this Windows user may write, read back after. 2.5.5
  adds no new path and no new file: iniConnectPref only chooses the number written in "ServerPort = %d".
- Encoding and line endings: the file is decoded and encoded as before (iniDecode / iniEncode), lines split on \r?\n
  and joined with the file's own newline; nothing of the new code touches the text beyond that one number.
- A tally.ini every user shares is still never written (iniSharedFn checked both in iniLoginPort and after, in
  tallyIniApply); the per-login port is never offered there.
- A port the file names is never changed by the new rule. (As in 2.5.3: a file with "Client Server = Both" and no port
  while Tally listens on 9000 gets 9001; see the code review, P1. Availability, not a write outside the file.)

## The login name

- The Windows user name (ownerName: the Owner setting, else the process's user) is used only as input to a hash
  (loginport255.go loginFreePort); the result is an int in 9000-9099 outside PORT_AVOID, then range-checked again
  (iniconnect253.go:147). No part of the name is written to tally.ini, a path, a log line or a request. Nothing it
  contains (backslashes, white space, control characters, invalid UTF-16) can reach a file or Tally.

## Requests to Tally

- No request added and none changed (docs/tally-allowlist.md: only the stock row's words and the table hash;
  TestAllowListUnchanged). The ledger round's requests now carry the 2 s hard stop; the slow ledger's retry is the
  existing FinComLedgers request for one MasterID, under the same stop and the same one Tally lock.
- Availability: the daily retry of a skipped ledger can be a ledger that holds Tally for minutes (the bridge cannot
  tell, since every stop is now at 2 s); Tally's lock is held until it finishes, so postings wait up to
  TallyAbandonMaxSec (code review H1). No data leaves the computer because of it.

## Updates and signatures

- Not touched: no change to the update download, the signed list, the SHA-256 checks or requireSignature (still
  false: no code-signing key yet). Only BridgeVersion is 2.5.5 (util.go) and the version in tests and fixtures.

## Cloud

- No cloud code in the range. The ledger list's `skipped` (MasterID, name, why) is sent as before and is not read by
  the cloud (server/tally-cloud/index.ts applyLedgerList); nothing new is stored. The "why" strings are the bridge's
  own fixed words with a timestamp.

## Verdict

Ship, as far as security goes: no write outside the intended tally.ini, nothing from the login name reaches a file or
a request, no update or signature change. The availability point (H1) is a correctness fix in the code review.

## Second review

Reviewers: a second independent review session, on 0455fe936, reading the code only (no build or test run).

Range: c4bf645d4..0455fe936 (the fixes: ed7a618d8..0455fe936)

- Requests to Tally: none added or changed; the slow ledger's retry is the same FinComLedgers request for one
  MasterID, now only in the nightly run, giving way to a posting at the lock (t.yield) and not started while one goes.
  The availability point of the first review (H1) is closed for the single ledger: a ledger Tally keeps over 30 s, or
  past TallyAbandonMaxSec, is never asked again. The waiting for Tally's end (ledJudge) holds nothing itself; the lock
  is held exactly as before (holdUntilAnswered). Left: the chunk-level stops are not judged by Tally's time (code
  review N3), and one long stop poisons an ordinary ledger for good (N2): correctness, not security.
- tally.ini: the write path is unchanged; the new code adds a case where nothing is written (P1: a Tally program on
  9000 and a file whose connection is on with no port) and chooses the login's next port in 9000-9099 outside
  PORT_AVOID (P2). The Tally on 9000 is recognised by its program name only, not by its session or folder (code review
  N4): at worst a file is left as it was. Nothing of the login name reaches a file, a log line or a request.
- The outbox edit (removePoison, ledger-out.json) is the bridge's own file, written by the same saveFile as before.
- Updates and signatures: not touched.

Verdict (second review): ship, as far as security goes. The code review's verdict (fix first: N1) stands apart from
this.

## Third review

Reviewers: a third independent review session, on 353737f12, reading the code, with one targeted test run of the keepWait
and ledger tests (ok).

Range: c4bf645d4..353737f12 (new: 0455fe936..353737f12: N1, N2, N5; the keepWait merge with tally-ingest; the Update
now rule)

- Requests to Tally: none added or changed (tally-allowlist.md changes its words only). A pressed-on Update now sends
  the same requests under the 2 s stop, through the one gate, with postings first. The exception is the day book with
  ReadDays on (off by default): code review T5. The weekly retry of a ledger that hangs Tally is nightly only and gives
  way to a posting. Its hold, at most TallyAbandonMaxSec once a week at night, is an availability cost the owner
  accepted. The halving search now holds Tally somewhat more often (code review T3).
- keepWait words: these do not leak other Windows users' information. The reason is one of six codes. The words are fixed sentences
  (keepwait.go:41-61); only "stopped" carries text, the owner's own ReadStop reason from FinCom; "other" carries
  KeepFakeHold, in fake mode only. "queued" is fixed words plus the run kind, and "since" is a time. Nothing names a
  user, a company, a path or a window. The hold can be caused by another login's FinCom read (fincom-reading.txt in a
  shared or PowerShell sync folder) or by another login's Tally just opening; the beat then says only "FinCom is
  reading from Tally on this computer" or "Tally has just opened", with a time.
- tally-ingest (keepWaitOf, index.ts:2014-2019): it takes an object only, a reason from the list only, words and queued
  cut to 300, since only as an ISO time, and drops any other key. A beat without keepWait (a bridge before 2.5.5, or
  null) gives no field, and `said` compares null with null, so older bridges' beats and broadcasts are unchanged
  (tests/run_keepwait_ingest.py; the fixture carries keepWait null). The cut is by UTF-16 units, the pattern used
  throughout the ingest. The bridge's words are ASCII, and only the owner's own stop reason could be split at a
  surrogate. No page renders keepWait yet; when one does, it must render it as text, since a revoked or rogue
  device key could send any 300 letters.
- Cloud rate: a held run's push goes at most once a minute (bridgeTurn's turnPushAt), and keepWait changes the
  broadcast only when it changes. No spam. That push can race the round's write of the ledger outbox (code review
  T1). This is a correctness and data-loss issue, not exposure: nothing is sent that would not have been sent.
- Updates, signatures and tally.ini: not touched in this range.

Verdict (third review): ship, as far as security goes. The code review's verdict (fix first: T1, T2) stands apart from
this.

## Fourth review: ship

Reviewers: a short fourth independent review session (the coordinator's), of 353737f12..4793526ef (the third review's
fixes 65f6fdf99, the test-date fix 952eaf8f1 and the release docs). Verdict: ship, with small follow-ups worth doing in
the same release. Fixed in 2e06a4f4e (line numbers on 4793526ef):

1. keep.go:1446-1452: a run with an Update now queued behind it flushed to the cloud for up to 10 minutes before the
   Update now could start. Now it pushes once and ends, so the Update now starts at once (it pushes as it goes).
2. ReadDays (off by default) under pressOn: a day-book slice stopped at 2 s was halved, used a day's try and backed
   off. Now it gives way (errBackoff: the same slice after the stop's cool-down; no halving, no dayFail, no back-off);
   the FinComTag check (keep.go:989) uses dtc, so it too is under the 2 s stop when reading on.
3. keep.go:1268-1291: a queued Update now's 2 minutes counted from its start, not from the press. heldAt is now seeded
   from kwNowAt (kwNowPressOn returns it).
4. keep.go:1141 and the defer at 1233: a queued Update now that did not start (startKeepRun false: reading switched off
   or stopped) left kwNowAt set, so a later Update now could read on at once. It is now cleared (kwNowForget).
6. ledgers.go:763-764: mergeLedOut and setLedOutOpeningsAt took ledOutMu one after the other, so a push could read the
   outbox between them. Now one ledOutMu section (mergeLedOutLocked, setLedOutOpeningsAtLocked).

Also: TestLedger255SlowPatchLargeCompanyFinishes was flaky under load (a 2,000 chunk tripped the 500 ms stop). Its
RecorderLimitMs is now 1500, and its slow ledger 1.8 s, so it still trips the stop.

Tests for the fixes: go vet (Linux, Windows) and go test -run 'TestKeepNow|TestHeldRun|TestKeepWait|TestLedger255|
TestOutbox' passed at 2e06a4f4e (273 s). No new test was written for 1-4 and 6 (the coordinator asked for the targeted
run only); the release check's go test ./... runs the whole suite at the release head.

## The release

Range: c4bf645d4..2e06a4f4e (after the third review's fixes: 65f6fdf99, T1-T5, T7 and T8; 952eaf8f1, the dates of
TestOutboxPairAcrossFilesKept made relative to today, since its fixed October files had fallen outside the reader's
31-day window; 2e06a4f4e, the fourth review's follow-ups). go test ./... passed at 952eaf8f1 on 07-Nov-2026 with the
page tests run_tally_basics, run_tally_connect_steps and run_tally_port_step; release-check.sh at the release head
(docs/RELEASE-CHECKLIST.md, the 2.5.5 row).
