# FinCom Bridge 2.5.3 (branch bridge-own-tally-253, from staging-next 3f242aa08, bridge 2.5.2)

The owner's report from NW144 (staging, 02/03-Nov-2026): Durgesh's own TallyPrime (company open, Server/Both on port
9070) was ignored by his bridge 2.5.2: the beat said tallyState "closed", open [], its ports 1318, 1536, 3035, 5487, 9089
"Tally of Windows session 0" (skipped) and 1817 ok:false with no error; 9070 not in the list at all, while the same
beat's tallyPort said 9070. The owner: "It should always show the user's computer linked.. it must not fail any which
way.. it should be like just login on any system." And (approved 03-Nov-2026): "it should open.. if anyone is trying to
connect with FinCom.. it should connect instantly."

**Shipped on reduced gates at the owner's request** (03-Nov-2026, through the coordinator: "Don't full check.. need basic
check first.. I need to do it real fast."): the new tests and `go test ./...` (in release-check.sh), Windows CI, the
real-Tally gate on TallyPrime 7.1 only with the upgrade from 2.5.2. Run AFTER publishing, in the background: the
real-Tally gate on 3.0, 4.1, 5.1 and 6.2 (results below when they end). No independent review session (the build
session's own pass: docs/reviews/bridge-2.5.3-{code,security}-review.md); the CI app shares not run for this build.

## The cause

1. A TallyPrime whose Windows session the bridge could not read (ProcessIdToSessionId refused: run as administrator, or
   another user's) was taken as session 0, and session 0 as another user's: skipped as "Tally of Windows session 0".
2. The heartbeat's list of ports was the list of the last company-list ask (open-companies.json), asked again only after
   an event. A Tally opened later on another port (9070) never reached it; the old port (1817) stayed in it, closed; so
   the beat said "closed", nothing was open, no event came, nothing asked again.
3. Automatic mode tried only the ports Windows' listener list showed; tally.ini's port was used only when Windows listed
   no programs at all.

## What is in 2.5.3

1. Finding the Tally is a chain that cannot silently end empty: the ports the settings name; every port of a TallyPrime in
   this user's session; every port of a TallyPrime whose owner is unknown (session not given, or session 0); every
   tally.ini's ServerPort and 9000; then other users' (listed, skipped). The session is asked of the Remote Desktop
   service when Windows refuses ProcessIdToSessionId.
2. Skipped only when Windows POSITIVELY places the Tally in another signed-in user's session, or (owner unknown) another
   FinCom Bridge of this computer already uses it (its /ping names its Tally ports). Otherwise an owner-unknown Tally is
   asked the existing company list (TDSDeskCompanies) and used when it answers; the cloud's lease still decides who reads
   or posts each company.
3. The heartbeat's list follows Windows' list now (no request to Tally for that); a Tally that appears is asked the
   company list at once in the background (once a minute at most, one in flight, postings first, 2 s stop) and the beat
   goes out right after. FinCom's Connect (/status?fresh=1) never takes a held list that no longer matches Windows, or one
   that held a port closed that takes a connection now: a Tally restarted is found within seconds.
4. Each port in the beat has a reason: open, busy, closed, not answering, owner unknown, another user, another bridge,
   not Tally; owner "unknown" when Windows did not say; the error words "owner unknown (Tally may be running as
   administrator)". The beat's tallyWhy (and /status's) says why none of the user's Tallys answers: "not answering",
   "owner unknown", "another user", "no Tally running in this login" ("" when one answers).
5. tally.ini (on the add-on's own path: backup first, no links, read back, put back): "Client Server" None or Client
   becomes Both; ServerPort kept when set, else added (9000, else the first port no other tally.ini names and nothing
   listens on, outside 9100..9199); nothing else changes; a file this Windows user may not write is not touched. The
   beat's tallyIni[].connect: "enabled; Tally needs one restart", "already", "cannot write", "unreadable"; tallyConnectSay
   "FinCom switched on Tally's connection. Close and reopen Tally once." while no Tally answers (24 hours at most). The
   app's line for it is a small follow-up (the field is in the beat and in /status).
6. No new Tally request and no request shape changed (the allow-list table's words for FinComStockInHand only).
7. Cloud: tally-ingest passes the new beat fields through (no migration).
8. One FinCom login for every user of a shared server (the owner, 03-Nov-2026): the browser finds its own Windows login's
   bridge by itself. /ping (which answers every local program) now carries `sameSession` and `bridgePort`; /status
   carries `sameSession` too. For each request the bridge finds the program at the other end of the connection
   (GetExtendedTcpTable, the row whose local end is the browser's port and whose remote end is the bridge's port), its
   session (ProcessIdToSessionId, else the Remote Desktop service) and compares it with its owner's sessions:
   `"sameSession": true` (the browser runs in this bridge's owner's session), `false` (another session),
   `"unknown"` (Windows did not say). The reply of `GET http://127.0.0.1:<port>/ping`, as before plus three fields:
   `{"ok": true, "bridge": "FinCom Tally Bridge", "version": "2.5.3", "impl": "go", "testMode": false, "runMode": "user",
   "pid": 1234, "loopSec": 3, "yours": true|false, "tallyPorts": [9070], "tallyPortsUnknown": [], "windowsUser":
   "NW144\\Durgesh", "sameSession": true|false|"unknown", "bridgePort": 9100}` (with "yours": true also bridgeId, port and
   the proofs as before). Each user's bridge already has its own port (the first free of 9100..9199, remembered), and the
   beat already carries it (bridgePort). The app tries the firm's bridges' ports on 127.0.0.1 and takes the one answering
   `"sameSession": true` (the field "yours", the same Windows user, says the same on a server where each person has
   their own Windows login).

## Known limits

- Where the Remote Desktop service also refuses the session, another user's Tally can be read by this bridge if that
  user's own bridge is not running (the owner's rule: never skip an owner-unknown Tally).
- A per-user ("Just for me") bridge usually may not write Program Files\TallyPrime\tally.ini: it says "cannot write";
  the setup run for all users (or by an administrator) switches it on.
- One tally.ini shared by several users of one install: the switch-on applies to all of them.

## Hemant's bridge (device 1dcec4b8-..., NW144\Hemant) still on 2.4.7

Its beat carries no update error: tally-ingest keeps no update fields from the beat (2.4.7 sends autoUpdate and
rolledBack, both dropped by the cloud's beat whitelist), and 2.4.7 keeps its update message (checkForUpdate's updLast)
on the computer only. The cause is on FinCom's side: the bridge's updater fetches latest.json AND latest.json.sig from
staging.fincom.live/review/assets/bridge-go/ and stops when the signature is missing ("The list of updates has no
signature, so nothing was changed."), and no bridge latest.json.sig has ever been published on staging (none in git
history for review/, next/ or assets-test/; docs/HANDOVER.md: "Bridges never auto-update on staging: no latest.json.sig
is published"). The firm has no held, withdrawn or rolled-back release (tally_bridge_releases, tally_bridge_rollbacks
empty), so the cloud would allow it. Hemant's bridge (and every staging bridge) takes a new version only from a setup run
by hand, until the owner decides to sign and publish latest.json.sig (connector/publish.py's key, from the vault). Not
changed here. A follow-up: let tally-ingest keep autoUpdate, rolledBack and the last update message from the beat.

## Gates (reduced, the owner's request of 03-Nov-2026)

| | |
|---|---|
| Setup | FinComBridge-Setup-2.5.3.exe, SHA-256 `5c971505d704599bb55f61d88221b770b102c24f6f200aadee808fb24a90d9a7`; program FinComBridge-2.5.3.exe `46a4cd608e87cf1636ccd67dd9d5c01850a53f0553637a4ac7e756791f2264a0`; built at 421e323d6 (bridge sources dec738975). The first 2.5.3 build (setup 84e2f8aa...dc22) was withdrawn unpublished after its gate's n2 |
| New tests | r253owntally_test.go, r253iniconnect_test.go (failed on 2.5.2's code first: the "Tally of Windows session 0" skip, the stale 1817 entry, the missing tally.ini port), r253session_windows_test.go |
| go test ./... | release-check.sh steps 1-6 passed at e31f22f03 (FORCE_REBUILD=1, never published): go vet Linux and Windows, go test ./..., size test, allow-list tests, go mod tidy, allow-list, reviews, test sheet |
| Windows CI | FinCom Bridge on Windows 41621441988 at e31f22f03: Windows go tests, build, setup install tests on windows-2025 and windows-2022, all green (the build commit 421e323d6 changes only the committed setup and docs) |
| Real Tally 7.1 + install over 2.5.2 | tally-versions g253, run 41624834556, the committed setup: c1, c2, n1 (installed over the published 2.5.2: version, port, key, settings carried), n2 (tally.ini Client Server = None switched to Both by the setup, ServerPort and every other line unchanged; the beat says "enabled; Tally needs one restart"), n3 (Tally restarted once: serves; Connect found the company 10.3 s after it was up), n4 (beat: reason open, no tallyWhy), n5 (worst 24 ms, one in flight): all PASS. Earlier runs: 41612077771 and 41621468074 (from source) |
| Not run (reduced gates) | the CI app shares (tests/ci), an independent review session |
| After publishing (background) | tally-versions g253 on TallyPrime 3.0, 4.1, 5.1, 6.2 with the published setup: run 41628510829, c1, c2, n1-n5 all PASS on all four (28 of 28; worst request 26 ms). Windows CI 41624835187 at the build commit 421e323d6: green |

## Published

Staging only, 03-Nov-2026: tally-ingest v71 (rollback v70); staging-next fast-forwarded to 421e323d6; next/ (main
c13d43622, build mw0lyix5-853a70) then promoted to review/ (main 17e9f3703); review/assets/bridge-go/latest.json names
2.5.3, the same blob as next/ (f5d48b1c). The local render of main's next/ files: FinCom's sign-in page, no page error.
Rollback of the page: app/rollback-review.sh.

## Deploy order

tally-ingest of this commit; publish the setup (review/ next then promoted).
