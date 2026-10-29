# Code review: FinCom Bridge 2.4.8 (ledgers right after a link; TallyPrime on any port)

Reviewer: review sessions run with Claude Code's code-review recipe. Each session was a fresh forked context that had
only the repository and the range. Every round's fixes were reviewed again in the next round.

Range: d1d7c038b..673783feb

Scope: bridge-go/anyport.go (new), ports.go, server.go (POST /ports/use), tally.go (TC.trial, TC.unplanned and the trial's
checks before the send), inflight.go (errProbeHold, abandonSlot.noMark), cloud.go and events.go (the links asked again
after a link, cd91bcaac), tray_text.go; the app's app/src/lib/tallyConnect.js (typePort) and
app/src/parts/TallyOneClick.jsx (next-tally-anyport, merged); tests/gen_post_shapes.js and its manifest.

## Round 1 (d1d7c038b..dd4606030): 10 findings, fixed in 66b710f85 and 84671c8ae

- R1-1 (Medium): the typed try could wait for Tally's lock with no limit and then keep a port after the page had given
  up. Fixed: a posting going on, or FinCom waiting for Tally, is refused at once. The try gives way to a posting and
  ends after 8 s, keeping nothing (TestTypedPortBusyAndBounded).
- R1-2 (Medium): the try could send the 10 s small check, and could overwrite the real Tally's stuck record. Fixed in
  rounds 2 to 4 (below; TestTypedPortLeavesRealTallyState, TestTypedPortNoSmallCheck).
- R1-3 (Medium): one odd answer hid a real Tally for 30 minutes. Fixed: only a non-empty answer that is not Tally's
  marks a port, and Tally's own answer clears the mark; the mark lasts 10 minutes at most
  (TestAnyPortTallyRefusalNotMarked).
- R1-4 (Medium): ownership was checked at 127.0.0.1 while the request went to TallyHost. Fixed: when TallyHost names
  another computer, the try is refused in words (TestTypedPortRemoteTallyHostRefused).
- R1-5 (Medium): a port set by hand, or tally.ini's port in the fallback, was never checked for whose it is. Fixed:
  Windows' owner of the listener decides (mine: false), and OnlyMySession then skips it
  (TestAnyPortSetPortOfOtherUserSkipped).
- R1-6 (Low): the plain reasons. Fixed.
- R1-7 (Low, kept): forgetPlanCache can race a company read already running, so the old list stands for up to
  StatusCacheSec (30 s).
- R1-8 (Low): "Find it by itself again" was missing when the bridge keeps a port and this browser has no pin. Fixed
  in the app (run_tally_oneclick check 13).
- R1-9 (Low): every Update now of a company not linked asked the cloud's links again. Fixed: once in 15 s per company
  (linknow248_test.go).
- R1-10 (Low): duplicated code. Fixed in part: tallyPortOpen is reused and the words are in one place.

## Round 2 (dd4606030..b59edad2d): 10 findings, fixed in 40fcf9d80

- The small check during the try is replaced by TC.trial: a port whose small check is due or pending gets nothing.
- A failure leaves no mark, so there is no save-and-restore of the shared stuck file.
- A try that was given up sends nothing.
- An empty answer does not end a mark.
- The typed port is kept only for Tally's envelope.
- Windows' "may not open" alone is not "another user's".
- The per-port owner check is kept 5 s.
- R2-5: the 1-minute limit on asking the links again was cut to 15 s, so a link made a little later still goes at once.

## Round 3 (b59edad2d..40fcf9d80): 10 findings, fixed in aee8cdf0b

- An unopenable program in another session is another user's.
- A trial on a port the bridge already uses (planned) keeps its marks; only an unplanned port leaves none, including at
  the long bound.
- One answer rule for the plan and the typed port.
- The trial looks at "given up" again before the send.
- errProbeHold replaces matching on the words.
- R3-2 (Low, kept): a program in this user's session that runs as another account counts as this user's. tallyListeners
  has decided "mine" by session since 2.3.0.

## Round 4 (40fcf9d80..aee8cdf0b): 3 Medium, 4 Low, fixed in 01c1edf25

- No small check is left by an unplanned trial at the long bound.
- "Given up" is looked at after the GentleMs rest.
- A <RESPONSE> is not kept as the company list.
- The plan and the typed port use one rule for an unopenable program.
- R4-6 and R4-7 (Low, kept): portPlanned rebuilds the plan once per click, and the session is read in two helpers.

## Round 5 (aee8cdf0b..01c1edf25): 2 Medium, fixed in fd2fb3dcb; 6 Low

- R5-1: Windows not saying the session of an unopenable program counts as another user's in the plan. It is not kept,
  and the typed port says "Windows did not say".
- R5-2: an unopenable program is this user's only when it is a TallyPrime program in one of the owner's sessions.
- Lows: the session is looked up only when Windows gave no user, and the answer patterns share one head (both fixed).
  Kept: the two checks before the send (before and after the rest) return two error kinds for the same event. An
  unplanned trial's late answer may clear a mark if the port joined the plan during its hold (up to TallyAbandonMaxSec).

## After round 5

673783feb: the recorder_lines and beat test fixtures name 2.4.8 (the version string only; no code change).

## Open

- No High or Medium is open.
- Lows kept: R1-7, R3-2, R4-6, R4-7, and the two Lows of round 5.

## The rules

- No request was added or changed; TestAllowListUnchanged and TestRelease248VersionAllowListUnchanged pass.
- Every typed try is the company list, TDSDeskCompanies exactly as built, under the 2-second stop through the one lock
  per Tally (TestTypedPortOneInFlight, TestTypedPortTimeoutTwoSeconds).
- Postings go first.
- Another user's Tally is never asked, by session or by SID (TestAnyPortAutoFindsOwnTallyAnyPort, TestTypedPortRefused,
  TestAnyPortUnopenableOtherSessionSkipped).

## Round 6: the build and the staging release (673783feb..a9cbec7f8)

ebc7aba31 adds the built setup and program (assets-test/bridge-go/FinComBridge-Setup-2.4.8.exe and its .sha256,
FinComBridge-2.4.8.exe), the release log row and the fingerprints. a9cbec7f8 moves 2.4.7's setup, program and
latest.json to bridge-go-old and makes latest.json name 2.4.8. Checked:
- the .sha256, the setup's bytes and latest.json agree (setup 030f4303...d83f, program 910c270f...3608);
- the setup was built by bridge-go/build.sh with POSTONLY=any from 673783feb's sources, after release-check passed at
  ce438bf9d;
- latest.json's addresses are the staging review site's;
- no source changed.

Range reviewed in all (for release-check.sh, which reads the last range named): d1d7c038b..a9cbec7f8
