# FinCom Bridge 2.5.4 (branch next-bridge-254, from staging-next e7f2f1990, bridge 2.5.3)

Released to staging through the signed, gated automatic updates (the owner's pre-approval, 05-Nov-2026 ~01:00 IST,
quiet hours), after two independent review rounds (docs/reviews/bridge-2.5.4-code-review.md).

| Published | 05-Nov-2026 ~07:05 IST to staging review: next/ (main bf6778f50) then promoted to review/ (main d4ecee70a), build mw2vbdl8-7926e0 from staging-next 09333a1d1, FINCOM_SHIP_BRIDGE=1; review/assets/bridge-go/latest.json names 2.5.4 (sha256 b4892c09...c16a), latest.json.sig served 200 (the same bytes as assets-test's, which verify with the bridge's key), FinComBridge-2.5.4.exe 200 (11,586,560 bytes; de96e30c...927d on main), setup b0487938...b48c |
| Cloud | tally-ingest v74: the stub importing server/tally-cloud/index.ts at 09333a1d1 (keeps the new beat fields; on top of 0198950ca). Rollback: the stub at 0198950ca0059130b69044483fbec81a4e6901d0 (v73) |
| Gate | tally_bridge_update_target set to 2.5.4 at 01:29 UTC, right before the publish (one bridge per computer per 10 minutes, only while idle with Tally, at its own time to look) | The owner's rules it follows: no
hang on any computer; no false message; the open Tally in this login is always found; an update never hangs anyone.

No new Tally request and no request shape changed: only waits (2 s), caching of Windows' own lists, and order.

## What is in 2.5.4

1. **The update's state in the heartbeat.** The beat carries `update`: `checked` (the last look), `message` (its words,
   200 letters at most), `offered` (the version FinCom's list offered), `applying`, `checking` (a look going on now),
   `noAutoUpdate` and `next` (the next scheduled look). Before, this was only on the tray's /status, so nobody could see
   why a bridge did not update. (update.go `updateBeat`, cloud.go `beatBody`.)
2. **Windows' lists read once and shared.** The list of programs (`processes`) and the listener table
   (`listeningPorts`) are read at most once in 1.5 s and shared by every caller (before: a full snapshot per call, about
   27 callers). /ping's and /status's checks of the asking program (its Windows user and session) share one TCP-table
   read taken after the connection was accepted (`http.Server.ConnContext`): a connection is only ever looked up in a
   table taken while it was open, so a held row can never stand for another program's newer connection on the same
   ports. A row without a process (a closed connection) is never the asking program. (snapcache254.go, win_platform.go,
   win_peer.go, ownuser.go, server.go.)
3. **tally.ini's connection is not written in a file every user shares.** TallyPrime keeps "TallyPrime acts as" and
   its port only in the tally.ini next to tally.exe; it has no per-user copy and no documented start-up switch for
   another settings file or port (its command-line options load or skip TDLs and companies), and the bridge does not
   start Tally anyway. So on a computer several people use (Windows Server, the multi-session edition, more than one
   person signed in, or another login's Tally running) the connection settings are not written at all: the file's
   `connect` is "off; shared by every user of this computer, not changed", with plain words in `connectWhy` (and in `why`
   when the add-on step left none, so FinCom shows them today). "cannot write" has its plain words too. The restart words
   ("Close and reopen Tally once") are never given on a shared computer. On a computer one person uses the 2.5.3 step is
   unchanged (a port no other tally.ini names and nothing listens on). FinCom's add-on line (2.4.5) is unchanged.
   (iniconnect254.go, tallyini.go, iniconnect253.go `tallyConnectSay`.)
4. **"Your Tally's connection is off" first.** tallyWhy says `connection off` above "owner unknown" and "another user"
   (below "not answering") when Windows lists a Tally of this login, running a minute or more, that listens on no port;
   or, when Windows lists no programs, every port tried is closed and every tally.ini known says "cannot write" or
   "shared". tallyConnectSay then carries the fix in plain words: acts as Client / None ("F1 Help > Settings >
   Connectivity > TallyPrime acts as: Both, then close and reopen Tally"), its port used by another program (ask the
   computer's administrator for a port of your own), or set but not on yet (close and reopen Tally once).
   (owntally254.go, owntally253.go `tallyWhy`.)
5. **A Tally's owner settled by its Windows user.** The bridge reads the Windows user each Tally runs as (its token,
   else the Remote Desktop service's process list, which gives it also for a program run as administrator). In order:
   a Tally in one of the owner's sessions is this login's; else one running as the owner's own user is this login's
   (run as administrator: session not given, or session 0); one running as another person's user (S-1-5-21-...) is
   another login's and is never asked; service accounts are nobody's. Only a Tally whose user and session Windows both
   did not give stays "owner unknown", and only then is another bridge's claim consulted; the last tie between two
   bridges that both know nothing is broken by the Windows user's name, which stays the same for each login (bridge
   ports do not: two users' bridges have held 9102), and only for the same or no name by the bridge port.
   (ports.go `sessionOwner`, owntally253.go `claimWins`.)
6. **The company list 2 s at most.** TDSDeskCompanies (and TDSDeskCompanyInfo, one company's GSTIN / PAN) wait 2 s,
   whoever asks (they waited 8 s and 15 s; the typed port's look 3 s; the entry fetch's guard up to 8 s). The request is
   unchanged; Tally's answer that comes within the wait after the stop is kept as the answer (review B1, below). A list
   that does not come in 2 s keeps the last list, and (for an ask that is not fresh) that Tally's list is not asked again for 15 s,
   then 30 s, 1, 2, 4, 8 and at most 10 minutes; an answer in time ends the wait. While it waits nothing is sent for the
   list; the one in flight keeps Tally's lock until Tally finished it (one request in flight per Tally, postings first,
   as before). (tally.go `tallyRaw`, colist254.go, ports.go `openCompaniesAsk`.)
7. **The setup for all users ends only the service's own process** (`taskkill /FI "USERNAME eq SYSTEM"`), never the
   other Windows users' FinCom Bridges of a shared server; a tray icon still running from the folder is moved aside by
   the setup as before and restarts from the new program by itself. The uninstall for all users likewise ends only the
   service's and the person's own. (installer/FinComBridge.nsi.)
8. **The update never hangs anyone.**
   - A random wait before each look (`UpdateJitterMin`) is there but OFF by default (0): FinCom's update gate
     (migration 139) already lets one bridge of a computer through at a time, only while idle with Tally, and expects
     each look exactly 2 minutes after the start and then every 6 hours; a random wait would keep the bridge outside
     the gate's window for good.
   - The download: 10 s to connect and for TLS, 30 s for the answer's head, 5 minutes for the whole; in the background.
   - One look at a time; the tray's "Check for updates" never waits for a download: it answers within 8 s and the look
     goes on in the background; no look at all while an update waits to start again or has not run well yet (review S1).
   - The new program is put in place (a rename: nothing stops), but the bridge starts again only when nothing goes to
     Tally: no posting being sent, no request at Tally, no request Tally is still on after the bridge stopped waiting for
     it (checked twice in a row). A posting only waiting for Tally resumes after the start, as before.
   - The new program is kept only when it works: its web server up and its main loop turning, within 6 minutes; else
     it stops with a failure (the process ends after 30 s if its loop is stuck), Windows' recovery or the per-user
     supervisor starts it again, and after three starts the previous one is put back (undoFailedUpdate, as before).
   - No window, no UAC prompt: the service (SYSTEM) or the per-user worker replaces its own program; the tray icon in
     each user's session restarts itself when it sees the new version (as before).

## The independent review of f9f807b88, and its fixes

Each finding has a test in `bridge-go/r254review_test.go` that fails on f9f807b88 and passes now (the B2 kept-list
test needs the late answer, which f9f807b88 does not have).

- **B1 (blocker): a Tally that always takes 2-8 s for its list never had one.** The late answer is kept
  (late254.go): when the bridge stopped waiting for TDSDeskCompanies (or TDSDeskCompanyInfo) and Tally finishes it within
  the wait after the stop (TallyAbandonWaitSec, 20 s), its answer is kept with the Tally program then on the port, and
  the next ask for the very same request within a minute takes it (invokeTally, and the company list in
  openCompaniesAsk, marked `late`): nothing is sent again. Tally's "not responding" and "busy" marks go with it. One
  request in flight and the 2 s stop are unchanged (the lock is still held until Tally finished). A Tally restarted
  (another program on the port) never gets a kept answer.
- **B2 (blocker): the wait after a slow list held fresh asks.** It now holds only an ask that is not fresh (never a
  posting, Test connection or Connect), and a wait noted for another program on the port is dropped. A kept list (late,
  or the last list while a slow one waits) that does not name the company a posting wants: Tally itself is asked once
  more (findCompanyIn, `noLate`).
- **S1: "Check for updates" while an update waited re-applied it.** checkForUpdate returns at once while an update is
  in place and the bridge has not started again, or while update-pending.json says the new program has not run well
  yet (so FinComBridge.old.exe, the real previous version, is never replaced); the one-look flag stays until the
  restart. The wait for a quiet moment has a maximum (30 minutes): after it, the first quiet look (between two requests,
  never during one) starts it again.
- **S2: 2.5.3 and 2.5.4 bridges broke the tie differently.** /ping says `claimRule: "user"`; with a bridge whose /ping
  has none (before 2.5.4) the tie is the bridge port, as that bridge decides it.
- **S3: a GSTIN / PAN that did not come in 2 s was kept empty for 6 hours.** Nothing is kept for it; it is asked again
  after 5 minutes (or its late answer is taken).
- **S4: installer.** A FinComBridge.setup-old.exe still in use (a FinCom icon of another Windows user, now that only the
  service's own process is ended) is moved to a name of its own and removed at the next restart, so the setup's own
  move of the program never fails; the uninstall marks every such file for removal at the next restart and says why.
- **M1:** the 2.5.4 code no longer imports package testing (a hook the tests set).
- **M2:** a Microsoft Entra ID user (S-1-12-1-...) counts as a person's account, as S-1-5-21-... does.

## The re-review of 9c8546b75 (N1-N4), and its fixes

Tests in `bridge-go/r254review2_test.go` fail on 9c8546b75 and pass now.

- **N1:** the one-look flag stays only while an update this bridge put in place waits to start again; a look that only
  found update-pending.json clears it (before, a tray click in the new version's first minutes stopped all later
  updates until a restart).
- **N2:** a Tally whose last list is kept marked busy and does not name the company: "Tally is busy", never "not open".
- **N3:** a caller that waited for Tally's lock behind the slow list takes the late answer instead of sending the list again.
- **N4:** an answer in time drops an older late answer to the same request.

## FinCom's cloud (tally-ingest)

Keeps the new beat fields: `update`, tallyWhy `connection off`, tallyIni[].connect "off; shared by every user of this
computer, not changed" and tallyIni[].connectWhy (tests/run_beat254_ingest.py).

## Not changed / left for the owner

- A shared server where 2.5.3 already wrote "Client Server = Both" and a ServerPort into the shared tally.ini: 2.5.4
  does not undo it (undoing it could take away the port of the user whose Tally works now). The file's backup
  `tally.ini.fincom-bak` holds it as it was before FinCom first changed it.
- The last tie between two bridges that both cannot tell whose a Tally is (Windows gives neither its user nor its
  session) is still a tie-break (by user name now, not by bridge port). It is rare now that the Tally's user is read.
- FinCom's Tally page does not show the beat's `update` yet (it is kept in the device's beat for Help & support).

## Tests

`bridge-go/r254_test.go` (fixes 1-8) plus the existing suite: `go test -timeout 40m ./...` in bridge-go, `go vet` for
Linux and Windows, `GOOS=windows go build`. The version lines of the earlier releases' tests name 2.5.4 with 2.5.3 kept
as history.
