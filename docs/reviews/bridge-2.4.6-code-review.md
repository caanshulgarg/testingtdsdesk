# Code review: FinCom Bridge 2.4.6 (FinCom opens with the connect code filled in)

Reviewer: review sessions run with Claude Code's code-review recipe, each one a fresh forked context with access only to
the repository. Rounds 1 to 4 were high effort and rounds 5 to 7 medium (short re-reviews). After each set of fixes the
fixes were reviewed again, until no High or Medium was left open. The security review is in
bridge-2.4.6-security-review.md: round 3 there is security-only, and rounds 4 to 7 cover both.

Range: 69de7a79d..3f5575332

(next-246-pairopen starts at origin/next-245 69de7a79d, the published 2.4.5. Its last code commit is 3ff0fc423;
0b4c5929c and 3f5575332 change only the allow-list doc's decision line and the three tests that read it. Round 8 covers them.)

## What 2.4.6 changes (the owner's approval of 24-Oct-2026)

- Tray item "Connect FinCom on this computer...": it opens a fresh 10-minute connect window, as before. It now also
  opens FinCom's own address with `#pair=<code>`. The message reads "FinCom is opening in your browser ... If it doesn't,
  open <address> on this computer, go to the Tally page and type this code". It no longer mentions "Settings > Tally
  Bridge > Connect".
- First start after a setup run by a person (`install ... --pairopen`; a silent `/S` setup never passes it): the same,
  once per install. The ask is kept in the install's own record in the registry: `PairOpenDue`, and `PairOpenNow` for
  the Finish page's tick, under HKLM or HKCU `SOFTWARE\FinCom\Bridge`. Through the bridge (`POST /tray/pairopen
  {action:take}`), the owner's tray takes the ask, and only one tray can take it. That happens after the Finish page's
  2 minutes, or at once when "Open FinCom to connect" is ticked. When the box is unticked, `connect --skip` drops the ask.
  It only happens within a day of the install, and never on a computer that was connected to FinCom before. If FinCom
  was connected by typing the code first, the ask is dropped.
- Only the tray opens a browser. It must run in a signed-in session (never session 0), never as the service, and only
  when this process is the owner's account (the install's OwnerSid against the process token). It acts only when it
  sees the ask in the install's record itself, and only when the program on the bridge's port is this install's bridge
  (this user's own process, or the service's process ID from the service manager). The port is checked before the take
  and again right before FinCom opens.
- It opens only FinCom's own https sites, the same built-in list `allowedOrigin` trusts, now kept as one list
  (`fincomSites`). The address keeps only its path, with no query, user or port. Only the 6-digit code goes in the
  fragment, never the key.
- Nothing new is sent to Tally. The allow-list's table hash is unchanged (b4df290484f5..., as at 2.4.5;
  TestAllowListUnchanged, TestRelease246VersionAllowListUnchanged). The doc changed in words only: its decision line
  names 2.4.6, and there is a dated "no request measured again" line. No cloud or app change: the app already reads
  `#pair=` (src/js/49-tally-cloud.js).

## Rounds

| Round | Range reviewed | Found | Fixed in |
|---|---|---|---|
| 1 | 69de7a79d..6ddb3a7d8 | 10. The Finish page's choice was sent over the bridge's web server, which refuses a setup elevated as another administrator, so an unticked box was lost. A due file that cannot be removed was taken again on every look. "Connected" was judged by cloudOn(), which fails for a service whose key is still protected for the user. The mark was written before the install was known good. A non-FinCom address opened nothing and the message gave no hint. The connect retry took up to 105 s. Duplicated code-making and install blocks. The status read had side effects. | 03be7dcb0 |
| 2 | 6ddb3a7d8..03be7dcb0 | 10. Old asks were cleared only at the install's end, after early returns. A stuck ask was logged every 5 s. A connected computer's ask was never dropped. The uninstall list. A connect/take race left a stray "now". A tick with no ask did nothing. The plain path on a non-FinCom address showed nothing. DST shifted the grace. freshPairCode read under a second lock. The tray re-implemented openURL/showMessage. | ea5a44fe6 |
| 3 | 69de7a79d..ea5a44fe6 (security focus, see the security review) | 10 | fc7ea144c |
| 4 | ea5a44fe6..fc7ea144c | 6. The tray trusted any program on the port. The owner check was by short user name. Owner empty. Parsed twice. A misleading log reason. Uninstall of round-1/2 files. | 9bd853512 |
| 5 | fc7ea144c..9bd853512 | 6. A small clock step back dropped a ticked ask (age < 0). A time-of-check gap on the port. A service not started by the service manager never opens. A Windows test with a dead Skip. A test gap for the tick with the clock ahead. The port check ran on every poll. | 7283d4ad0 |
| 6 | 9bd853512..7283d4ad0 | 1 Medium: the check after the take lost the ask on a passing glitch and showed nothing. 2 Low: the double check was not documented, and the -1 sentinel. | 3ff0fc423 |
| 7 | 7283d4ad0..3ff0fc423 | 0 High, 0 Medium. 2 Low, below. | - |
| 8 | 3ff0fc423..3f5575332 (self-review: words and tests only) | 0. The decision line names 2.4.6 by the owner's standing decision of 2026-10-06, as 2.4.1's did. 2.4.5's decision is kept as "as for 2.4.5". The dated 2.4.6 line says no request was measured again. The table hash is unchanged (b4df2904...); TestAllowListUnchanged and TestRelease246VersionAllowListUnchanged pin it. release-check's check 4 needs this line. recorder_live_test reads the line for BridgeVersion, not for 2.4.5. | - |

Tests for each round's fixes were written in the same commit as the fixes. The feature itself was written test-first:
r246pair_test.go failed to build (undefined: browserFacts ...) before pairopen.go existed.

## Not changed (Low, recorded)

- L1 (round 7): if this install's own bridge took the ask but the port check kept failing for 4 seconds, the ask is used
  up. The person is told to use the tray item, and the code made stays valid but unshown for 10 minutes.
- L2 (round 7): on a computer already connected, a failed port check shows "To connect FinCom ..." words, which do not
  fit that case.
- L3 (round 5): an all-users bridge not started by the service manager (a copy started by hand) never opens FinCom by
  itself. The tray item still works.
- L4 (round 2): ticking "Open FinCom to connect" when the ask was never written (the registry write failed, logged in
  install.log) opens nothing. 2.4.5 always opened the FinCom home page.
- L5 (round 4): a tray whose settings have no OwnerSid (a hand-made config) shows the code but opens no browser.
- L6 (round 4): files written by the round-1/2 builds (pair-open-due.json, pair-open-now.txt) are not in the uninstall
  list. Those builds were never built into a setup or run on any computer.

## Tests

- New: bridge-go/r246pair_test.go (Linux; 19 tests) and bridge-go/r246pair_windows_test.go (the registry store, and the
  port check against this user's own listener; the Windows CI job runs `-run 'Windows|Shared'`).
- Changed: the version pins (2.4.5 to 2.4.6, kept as history), slow232's "newer version" (9.9.8), and the two JSON
  fixtures' version.
- The full gate is in docs/bridge-2.4.6-notes.md: go vet Linux and Windows, go test ./..., release_check_test.sh, and
  release-check.sh.
