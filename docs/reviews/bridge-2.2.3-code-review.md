# Code review: FinCom Bridge 2.2.3 (the tray's "Test fetching an entry"; live files named d-Mon-yy)

Reviewed: 05-Oct-2026, by the reviewer in the Claude Code session, in one round (the owner's rule: one round; High and
Medium fixed, Lows to the next build). The bridge sources are read with `git diff b266f4f <to> -- bridge-go/
docs/tally-allowlist.md`. The app, server and migration files in the same range (the held-line wording, migration
53, the CI and test-runner changes) are not part of this build of the bridge; they have their own notes.

## What 2.2.3 does

Only these, nothing else:
- **"Test fetching an entry"** (ba799d4, c2621c1; the owner's request: PowerShell cannot be run on NWS144). A tray item,
  shown only while the owner's "Trial tools on this computer" is on. It asks a voucher's type, number and date
  (Receipt / 212 / 05-Oct-2026 by default) in a small input box, then a yes/no naming the open company, and sends the
  six forms of docs/diagnostics/2.2.2-fetch-check.ps1 for that one voucher (A by number as built, B with plain quote
  marks, C by MasterID as built, D without dates, E with d-MMM-yyyy dates, F by number without dates), one at a time,
  each capped at 25 s, never during a posting. C, D and E use the MasterID found by B, else A, else F, else one the
  person types (Cancel skips them). Each form goes under a measure-only id of its own (FinComFetchTestA..F), pinned
  to its builder and classified (dated / undated). Per form the local log holds the period sent, the time, the
  voucher count, the ids of up to 5 and the first 400 characters of the answer. Nothing is kept, nothing goes to the
  cloud.
- **Live add-on files named `<GUID>-5-Oct-26.txt`** (8bd8077; TallyPrime 7.1's @@FCRDay, d-Mon-yy) are read and dated
  by their name (liveFileDay, one function for liveFiles and the held re-scan); recorderSeen counts them, so the
  Tally page no longer says "not recording" for a company that records.

## What was checked

- **Person-only route.** /tray/fetchtest refuses any request with an Origin or a Sec-Fetch-Site/-Mode/-Dest header
  (a web page, FinCom's own included) with 403 and a log line, before anything else, as /tray/readtest does.
- **Trial-tools gating.** trialToolsErr() before any action; the tray item is listed only with trialTools on
  (TestTrialToolsSwitch pins the menu: id 24 after "Test reading from Tally").
- **Measure-only ids.** FinComFetchTestA..F are measureOnly on the allow-list; each is pinned (fetchTestRebuild rebuilds
  the request from its own company, date, type, number and MasterID and must match byte for byte), and classified in
  requestClass, so with ReadDays off only a person's TC (fetchTestTC, person: true) sends the dated ones. The
  bridge's own FinComVoucherByNumber / FinComVoucherByMaster ids are never sent as a person's.
- **One request at a time.** Every form goes through invokeTally (the Tally lock); a second test is refused while one
  is running or waiting for a MasterID (fetchTestMu, state "running" / "needMaster").
- **Never during a posting.** Refused before start (postingGoing or an import in flight) with plain words; checked again
  before each form, and a posting that starts stops the test there with a log line.
- **Inputs.** Type and number go through liveNumberText (no quote mark, no control character, 100 characters at most);
  the date through normDate and must round-trip as yyyymmdd; a typed MasterID is digits only, 18 at most. The filter
  is escaped by fcCollection; forms B and F put back only the plain quote marks (`&#34;` to `"`) in the filter's
  own SYSTEM element (LastIndex: after the company), so `&`, `<` and `>` stay escaped.
- **The input dialog (win_input.go).** Its own window on the calling goroutine's locked OS thread (the tray runs each
  command in a goroutine), one at a time (inputMu), its class and callback registered once, its own message loop
  ending on WM_DESTROY; OK reads the edit text, Cancel / Esc / close return false. The tray's PostQuitMessage goes to
  the tray thread, not this loop.
- **The allow-list rows and hash.** Six rows added in ba799d4 with their request hashes; the table matches the code
  (TestAllowListUnchanged); the beat fixture's allow-list hash follows (c2621c1).
- **File-name dates.** `\d{1,2}-[A-Za-z]{3}-\d{2}` added to reLiveFile and reLiveFileAnyCase; the greedy GUID group
  still leaves the whole date to the second group (a "-" must precede it); normDate parses d-Mon-yy (2-Jan-06) and a
  name whose letters are not a month gives "" and falls back to the file's last write, as before.

## Round 1 (b266f4f..99e75eb)

- **M1.** runFetchTest raised `measuring` for its whole run, including the wait of up to 10 minutes for the person's
  MasterID. While measuring is above 0 the measure-only gate is open for every caller and the self-watch neither stops
  reading on a request over the limit nor on Tally's silence (selfwatch.go), so the safety net for the recorder's
  background reads was off while a box waited on the screen. Fixed test-first: TestFetchTestMeasuringNotHeldWhileAsking
  (f6ce242, red: "measuring while asking the person: 1 (want 0)"), then measuring is raised around each form's
  invokeTally only (e23e03b).

No High.

Lows, accepted, listed for the next build:
- **L1.** After the 10-minute wait for a MasterID the bridge goes on without one; a MasterID typed after that is refused
  ("not waiting") and the tray asks again until Cancel. Harmless, but the words could say the wait ended.
- **L2.** A posting that starts while a form is already waiting for the Tally lock waits behind it (a person's request
  does not yield); at most 25 s, once, as the read test.
- **L3.** The tray's input box has no length limit on the edit line (the bridge refuses over 100 characters with plain
  words).
- **L4.** Comments in allowlist.go, fetchtest.go, pinned.go, tally.go and server.go say "2.2.2" for what ships in 2.2.3.

## After the round

e23e03b (the fix) and 4137429 (BridgeVersion 2.2.3, the version pins in three tests and two fixtures, the allow-list
decision line for 2.2.3). No other bridge source changed. The allow-list table is as committed in ba799d4.

Range: b266f4f..4137429
