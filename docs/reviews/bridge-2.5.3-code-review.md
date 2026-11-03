# Code review: FinCom Bridge 2.5.3 (the user's own Tally on a shared Windows server; Tally's connection in tally.ini)

Reviewer: the build session's own adversarial pass over the diff (as for 2.3.2), on the owner's reduced gates for this
fix of 03-Nov-2026 ("Don't full check.. need basic check first.. I need to do it real fast."). No independent review
session was run; one is owed after the release.

Range: 3f242aa08..cfd170de2

## The cause, found in the code (bridge 2.5.2)

1. win_platform.go processes(): `if ProcessIdToSessionId(pid) == nil { p.Session = s }`. When Windows refuses (a
   TallyPrime run as administrator; another user's process), Session stays 0. ports.go tallyListeners():
   `"mine": isMine(p.Session)`: session 0 is never the owner's, so the port went into the plan as mine=false and
   openCompaniesAsk skipped it with "Tally of Windows session 0" (the beat's text on NW144 for 1318, 1536, 3035, 5487, 9089
   on Durgesh's bridge and 9070 on Hemant's and saurabh's). anyport.go portOfOtherUser() also counted "Windows does not
   say" as another user's (R5-1).
2. ports.go openCompaniesCached() (the heartbeat's source): the list of ports is the file of the LAST company-list ask
   (open-companies.json), refreshed only after an event; it never looked at Windows' list again. Durgesh's file named
   1817 (his earlier Tally, closed since: ok:false with no error is exactly what openCompaniesCached makes of a held
   ok:true entry whose port is closed now) and never 9070 (opened later), so the beat said tallyState "closed" for ever,
   while the same beat's tallyPort (myTallyFor, read from Windows now) said 9070. Nothing open means no event, so nothing
   asked again: a dead end. TestR253BeatFollowsWindowsNotTheOldList reproduces it (failed on 2.5.2's code).
3. portPlan() in "auto" mode used only Windows' listener list: a Tally whose listener was missing from it (or whose
   program could not be matched) was never tried, whatever tally.ini said.

## The fix, checked

- proc.SessionUnknown; the session asked of the Remote Desktop service (WTSEnumerateProcessesW, kept 5 s) when
  ProcessIdToSessionId is refused; sessionOwner(): mine / other (a known session other than 0, not the owner's) /
  unknown. Only "other" is skipped. Session 0 (no signed-in user) is unknown, not another user's.
- portPlan(): settings' ports, own listeners, owner-unknown listeners, every tally.ini port and 9000 (FallbackPorts when
  Windows lists nothing), then other users' (skipped) - the chain cannot end empty; the bridge's own port never.
  Nothing is sent to a port where nothing listens (tallyPortOpen first, as before).
- An owner-unknown Tally is asked TDSDeskCompanies (the existing light request; invokeTally: 2 s stop for background,
  one in flight, postings first) unless another FinCom Bridge of this computer already uses it (its /ping's tallyPorts;
  an own Tally's claim always wins, of two owner-unknown claims the lower bridge port's); only for a Tally on this
  computer (tallyHostLocal). The cloud's lease (tally_company_lease) still decides who reads or posts a company.
- openCompaniesCached() follows portPlan() now (no request to Tally): a port no longer in the plan goes; a new or changed
  one is added and the company list is asked once in the background (askAfreshSoon: once a minute at most, never two at
  once, the beat sent right after). openCompaniesAsk(fresh=false) (FinCom's Connect: /status?fresh=1) takes a held list
  only while it matches the plan and no port it held closed takes a connection now (cacheMatches).
- Reasons per port (planEntry/portReason) and tallyWhy; tally-ingest passes reason, owner, tallyWhy, tallyConnectSay and
  tallyIni[].connect/serverPort through (anything else dropped).
- tally.ini (iniconnect253.go, on tallyIniApply's path): Client Server None/Client -> Both, the line's own spelling kept;
  ServerPort kept, else added (9000, else the first port no other tally.ini names and nothing listens on, outside
  9100..9199); the backup first; a file this user cannot open for writing is not touched ("cannot write"). The same
  read-back and put-back as the add-on line. Deviation noted: the write is in place with read-back and put-back (the
  2.4.5-reviewed path that keeps the file's permissions and never follows a link), not a rename.

- sameSession (ownuser.go sameSessionOf, win_peer.go platPeerSession): the TCP table's row for the browser's end
  (peerPidFrom, as the own-user check of 2.3.0), ProcessIdToSessionId, else the Remote Desktop service (5 s cache); true
  when the session is one of the owner's (isMine), false for another known session (session 0 too), "unknown" when no
  process or no session is found. On /ping and /status; not a Tally request. TestR253SameSession: same, another, session
  0, unknown, the browser's port used, /status.

## Findings of this pass

1. (Fixed in 9a3cf1a8c) The claim check would have skipped a remote TallyHost port when a local bridge used the same
   number: now only for a Tally on this computer.
2. (Fixed in 9a3cf1a8c) WTSEnumerateProcesses on every process listing: kept 5 s.
3. (Fixed in 9a3cf1a8c) The added port line was "Server Port"; TallyPrime writes "ServerPort" (proof72 p4): written so.
4. (Fixed in 56f2ecfa2) The background re-ask outlived tests and wrote bridge-go/sync/: inert under go test.
5. (Low, open) /ping tells any local program which Tally ports this bridge uses (no company, no key). A local program
   could pretend to be a bridge and claim a port; the cost is that an owner-unknown Tally is not used by this bridge
   (the person sees "another bridge"); a Tally positively the user's own is never affected.
6. (Low, open) Two users' bridges that both see the same owner-unknown Tally at the same moment, before either answered
   /ping: both may ask it the company list once; the cloud's lease still lets one read or post a company.
7. (Low, open) On a shared install (one tally.ini for every user) switching the connection on applies to every user of
   that install; the port is the file's own (kept) or 9000/free.

## Tests

r253owntally_test.go (each step of the chain; the Durgesh cases: own Tally reported as session 0, 9070 missing from the
scan, the stale beat list; claims; tallyWhy), r253iniconnect_test.go (off -> Both, Client and no port, already on, cannot
write, port clash, UTF-16 kept, Connect after Tally's restart). The 2.4.8 tests that encoded "Windows not saying = another
user's" and plans without 9000 were changed to the owner's new rule.
