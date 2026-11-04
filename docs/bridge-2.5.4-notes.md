# FinCom Bridge 2.5.4 (branch next-bridge-254, from staging-next e7f2f1990, bridge 2.5.3)

Prepared, built and tested; **not published**. It is released after signed automatic updates are live, so it reaches
every computer by itself and one computer after another (the owner, 04-Nov-2026). The owner's rules it follows: no
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
   unchanged. A list that does not come in 2 s keeps the last list, and that Tally's list is not asked again for 15 s,
   then 30 s, 1, 2, 4, 8 and at most 10 minutes; an answer in time ends the wait. While it waits nothing is sent for the
   list; the one in flight keeps Tally's lock until Tally finished it (one request in flight per Tally, postings first,
   as before). (tally.go `tallyRaw`, colist254.go, ports.go `openCompaniesAsk`.)
7. **The setup for all users ends only the service's own process** (`taskkill /FI "USERNAME eq SYSTEM"`), never the
   other Windows users' FinCom Bridges of a shared server; a tray icon still running from the folder is moved aside by
   the setup as before and restarts from the new program by itself. The uninstall for all users likewise ends only the
   service's and the person's own. (installer/FinComBridge.nsi.)
8. **The update never hangs anyone.**
   - Each bridge looks for an update after its schedule plus a random 0-60 minutes (`UpdateJitterMin`, 60), the first
     look 2 minutes plus that after the start, so the bridges of one server update one after another.
   - The download: 10 s to connect and for TLS, 30 s for the answer's head, 5 minutes for the whole; in the background.
   - One look at a time; the tray's "Check for updates" never waits for a download: it answers within 8 s and the look
     goes on in the background.
   - The new program is put in place (a rename: nothing stops), but the bridge starts again only when nothing goes to
     Tally: no posting being sent, no request at Tally, no request Tally is still on after the bridge stopped waiting for
     it (checked twice in a row). A posting only waiting for Tally resumes after the start, as before.
   - The new program is kept only when it works: its web server up and its main loop turning, within 6 minutes; else
     it stops with a failure (the process ends after 30 s if its loop is stuck), Windows' recovery or the per-user
     supervisor starts it again, and after three starts the previous one is put back (undoFailedUpdate, as before).
   - No window, no UAC prompt: the service (SYSTEM) or the per-user worker replaces its own program; the tray icon in
     each user's session restarts itself when it sees the new version (as before).

## Not changed / left for the owner

- A shared server where 2.5.3 already wrote "Client Server = Both" and a ServerPort into the shared tally.ini: 2.5.4
  does not undo it (undoing it could take away the port of the user whose Tally works now). The file's backup
  `tally.ini.fincom-bak` holds it as it was before FinCom first changed it.
- The last tie between two bridges that both cannot tell whose a Tally is (Windows gives neither its user nor its
  session) is still a tie-break (by user name now, not by bridge port). It is rare now that the Tally's user is read.
- FinCom (tally-ingest) keeps only the beat fields it knows: to show the new ones it needs `update` (the object above),
  `tallyWhy` value `connection off`, `tallyIni[].connect` value "off; shared by every user of this computer, not
  changed" and `tallyIni[].connectWhy`. Until then the person still gets the plain words through `tallyConnectSay`
  and `tallyIni[].why`, which FinCom passes today.

## Tests

`bridge-go/r254_test.go` (fixes 1-8) plus the existing suite: `go test -timeout 40m ./...` in bridge-go, `go vet` for
Linux and Windows, `GOOS=windows go build`. The version lines of the earlier releases' tests name 2.5.4 with 2.5.3 kept
as history.
