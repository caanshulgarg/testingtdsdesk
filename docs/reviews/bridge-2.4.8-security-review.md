# Security review: FinCom Bridge 2.4.8 (TallyPrime on any port; ledgers right after a link)

Reviewer: the review sessions of bridge-2.4.8-code-review.md, five rounds in fresh forked contexts, each covering
correctness and the owner's security rules (never another Windows user's Tally, the 2-second rule, one request in
flight). A pass by this session over the threats below was also made.

Claude Code's security-review command did not give a usable report. It ran against the main checkout (tax-accuracy),
which needs origin/HEAD, not against this branch. That temporary origin/HEAD was removed again.

Range: d1d7c038b..673783feb

## Threats looked at

1. **Another Windows user's program calling POST /ports/use.** The endpoint is behind the same gate as every address but
   /ping: the program on the other end of the connection must be this bridge's own Windows user (403 otherwise), and it
   must hold the bridge key. CORS allows only FinCom's origins (TestTypedPortOwnUserOnly).
2. **The bridge steered to another user's Tally.** A typed port is kept only in these cases:
   - Windows lists it as this user's TallyPrime by session, or its listening process's user SID is one of this
     bridge's;
   - or it is an unopenable TallyPrime program in the owner's session.

   Another user's Tally, a SID that is not this bridge's, an unopenable program in another session, and a program whose
   session Windows does not say are all refused, and nothing is sent to them (TestTypedPortRefused,
   TestTypedPortElevatedOwnAndStrictAnswer).

   The automatic plan applies the same rule to:
   - ports set by hand;
   - tally.ini's ports in the fallback (one tally.ini serves every user on a shared server).

   Such a port is mine:false and skipped with OnlyMySession (TestAnyPortSetPortOfOtherUserSkipped,
   TestAnyPortUnopenableOtherSessionSkipped).
3. **The bridge steered to another computer.** A typed port is refused when TallyHost names another computer, because
   ownership can be checked only locally. The connection and the request use the same host.
4. **Settings tampering.** /ports/use writes only TallyPorts = [an integer 1-65535], or "auto". The body's port must be
   a JSON whole number; anything else is refused, never taken as 0. guardPorts still runs at save.
5. **Tally held or flooded.**
   - The try is the light company list, TDSDeskCompanies exactly as built (the allow-list is unchanged).
   - It runs under the 2-second hard stop, through the per-port lock (one request in flight).
   - It gives way to postings, refuses at once while a posting runs, never sends the small check, and sends nothing once
     it has been given up.
6. **Untrusted answers.**
   - Another program's answer is parsed only when it starts with Tally's envelope; the Go XML decoder has no external
     entities.
   - The company names go back to the page as JSON. React renders them as text.
   - The bridge's words are shown as text (no innerHTML).
7. **Information shown.** A refusal names the other Windows user whose TallyPrime holds a port. The diagnosis has done
   this since 2.3.0, and it is shown only to this user's own programs holding the key. The reasons (nothing listening,
   not Tally) tell the caller whether a local port is open. That needs the bridge key; Low, accepted.

## Findings

- No High or Medium is open.
- Low, accepted: R3-2. A program started in this user's Windows session under another account ("Run as different
  user") counts as this user's when Windows will not let the bridge open it. This is the session rule tallyListeners has
  used since 2.3.0.
- Low, accepted: the local-port oracle in item 7.

## For the owner

- Nothing new is asked of Tally.
- POST /ports/use is a new local address of the bridge, with the same gate as every other address.

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
