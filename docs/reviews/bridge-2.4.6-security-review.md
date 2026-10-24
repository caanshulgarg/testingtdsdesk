# Security review: FinCom Bridge 2.4.6 (FinCom opens with the connect code filled in)

Reviewer: review sessions run with Claude Code's code-review recipe, each a fresh forked context with only the
repository. These are the same rounds as the code review (bridge-2.4.6-code-review.md). Round 3 was security-only over
the whole range, and rounds 4 to 7 re-reviewed its fixes for correctness and security. Claude Code's security-review
command could not run in this session: it needs origin/HEAD in the checkout, the same limit as for 2.4.5. Its scope was
given to the round-3 session instead.

Range: 69de7a79d..0b4c5929c

## Security checks made (on the final code)

- **Origin allow-list.** `pairOpenURL` / `fincomPlainURL` accept only `https://` + one of `fincomSites`. That is the
  same built-in list `allowedOrigin` already trusts, kept as one variable. They refuse a user part, a port, an opaque URL,
  a lookalike host (`staging.fincom.live.evil.example`, `fincom.live.`, `xfincom.live`), `http:`, `javascript:` and
  `file:`. The query is dropped and the path kept. The code must be exactly 6 digits. An address that fails the check is
  never opened and never named next to a live code. Tests: TestPairOpenURLOnlyFinComSites,
  TestTrayConnectNotFinComSiteShowsCodeOnly, TestFirstStartNotFinComSite.
- **Who opens a browser.** Only the tray, and only in a session other than 0, not as the service, and only when the
  process token's SID is the install's OwnerSid (`mayOpenBrowser`). The bridge never opens one, so neither does the
  service. The tray already ends at its start for a user who is not the owner (runTray, unchanged). Tests:
  TestMayOpenBrowserOwnSessionOnly, TestFirstStartNotForServiceOrOtherUser. In those cases the ask is not even taken.
- **What travels.** The address carries only the 6-digit code, in the fragment, which never goes to a server. FinCom's
  page takes it off the address at once. The key never goes in the address. The code works exactly as before: one use,
  10 minutes, and five wrong tries close pairing. Opening a new window resets the tries, as `/paircode` always did.
  TestTrayConnectOpensFinComWithCode checks that the code from the address pairs once and not twice.
- **The install's ask is not a file in the owner's folder.** In round 3 the first design (pair-open-due.json in the
  bridge's Home) was found to give a standard-user owner an arbitrary delete as SYSTEM (a junction plus object-manager
  links), and the elevated setup the same. The ask now lives in the install's own record in the registry: HKLM
  `SOFTWARE\FinCom\Bridge` for the service, where only an administrator writes and users read, and HKCU for an install
  just for one user, where there is no privilege boundary. Uninstall already deletes that key. pairstore_windows.go;
  TestWindowsPairStoreRegistry on Windows.
- **`/tray/pairopen`.** This is a tray route: the key is needed, and a request with Origin or Sec-Fetch headers is
  refused (the existing `/tray/` rule). The own-user check applies, and the only action is `take`. One take succeeds;
  a second tray gets nothing (TestFirstStartOneTrayOnly). A web page, FinCom's own included, gets 403 and the ask stays
  (TestPairOpenRefusedForWebPages). Nobody but the tray can make the bridge open a browser: any key holder could already
  make a code with `/paircode`.
- **A program squatting on the bridge's port** (another Windows user's, while the owner's bridge is down). Such a program
  cannot write the install's record, so the tray acts only when it sees the ask there itself (`pairOpenAskedHere`). It
  checks that the program listening on the port is this install's bridge before the take, and again right before FinCom
  opens: this user's own process, or the FinCom Bridge service's process ID from the service manager (`trayBridgeIsOwn`).
  If the check fails, no code is shown. TestFirstStartPortNotOwn; TestWindowsBridgeIsOwnOn on Windows.
- **Stale asks.** An ask is dropped at the next install's start (before the bridge is restarted), when it is over a day
  old, when its time cannot be trusted, on a computer connected before (judged from the settings: a key still
  protected for the user counts too), when the code was typed by hand, or when the Finish page was left unticked. A
  silent `/S` setup never writes one. An ask that cannot be removed is said once and never taken again. Tests:
  TestInstallNotesFirstStart, TestFirstStartNotWhenConnectedOrPaired, TestFirstStartGraceClock,
  TestFirstStartNotTakenWhenStuck, TestConnectAfterTakeLeavesNoStray.
- **The Finish page.** It runs `FinComBridge.exe connect --first|--skip`, which changes only the install's record. It
  opens no browser itself: the setup may run as an administrator or as another account. 2.4.5's Finish page ran
  `ExecShell open ${FINCOM}` from the setup's own, possibly elevated, process; 2.4.6 no longer does.
- **Tally.** No request is added or changed, and nothing new is sent. The allow-list's table and its hash are unchanged
  (b4df290484f5..., as at 2.4.5). TestAllowListUnchanged and TestRelease246VersionAllowListUnchanged pin it. The doc's
  file hash moves from 6bf9d43c248e097c to 03784caabea64a2d only because of words (0b4c5929c): its decision line now
  names 2.4.6 by the owner's standing decision of 2026-10-06, and a dated line says no request was measured again.
  release-check needs the line to name the version built. The tests check that no request reaches the stand-in Tally
  during either trigger (`tallySent` unchanged).
- **No AI** in the bridge; nothing here calls a model.

## Round-3 findings and what was done

| # | Finding | Done |
|---|---|---|
| S1 | SYSTEM deletes fixed-name files in the owner-controlled folder (junction + object-manager links: an arbitrary delete as SYSTEM) | The ask moved to the install's registry record (fc7ea144c) |
| S2 | The elevated setup writes and deletes the same files, following links | The same move: connect and install change only the registry record |
| S3 | pairProof lets the code be recovered offline, and AllowedOrigins' defaults include `null` and `http://localhost` | **Not changed: pre-existing, for the owner** (below) |
| S4 | The tray trusts any program on the port | The record check, plus the port's owner checked before the take and before opening (fc7ea144c, 9bd853512, 7283d4ad0, 3ff0fc423) |
| S5 | Path and query kept; caanshulgarg.github.io serves the whole account | Query dropped. The origin list is the one the bridge already trusts for `/ping` and `/pair`, so it is not widened (below) |
| S6 | The ask has no expiry | Dropped after a day (fc7ea144c) |
| S7 | Owner check by short name; empty Owner passes | By SID, OwnerSid required (fc7ea144c, 9bd853512) |
| S8 | The server does not check the taker's session | Kept: the session is the tray's; any key holder could already make a code (`/paircode`). Recorded |
| S9 | A non-FinCom address named next to a live code | Never named (fc7ea144c) |
| S10 | The code sits in the browser's command line and history until FinCom takes it off | Inherent in the approved design (the code in the address); FinCom removes it at once. Recorded |

## For the owner (not changed in 2.4.6)

1. **The known pairing-proof risk is wider than "only FinCom's page".** While a connect window is open, `/ping` gives
   `pairProof = HMAC(code, nonce||id||port)` to any allowed Origin, and a 6-digit code can be recovered from one proof
   offline (10^6 HMACs). The bridge's default AllowedOrigins (config.go) also contain `"null"` (a sandboxed iframe on
   any website sends `Origin: null`) and `"http://localhost"` (any local web server). So while a window is open, any
   website could in principle get the proof, recover the code and call `/pair`. Browsers' local-network permission
   prompt (Chrome's "look for and connect to apps on this device") reduces this but does not remove it. This is in
   2.4.5 as published. Every bridge start opens a 15-minute window, and the tray item a 10-minute one. 2.4.6 does not
   widen it in kind: the tray item is unchanged, and the first start adds at most one 10-minute window per interactive
   install, which overlaps the start's own 15-minute window. A fix changes existing behaviour, so it needs the owner's
   OK first. Options: drop `null` and `localhost` from the defaults (check that nothing FinCom ships relies on them), or
   make the proof over a longer secret than the typed code (the study's suggestion).
2. The tray sends the bridge key to whatever program answers on the bridge's port every 5 seconds (trayCall, unchanged
   since 2.3.0). The first start no longer acts on such a program's answers, but the poll itself still sends the key.
   This is pre-existing and is for a later release.
