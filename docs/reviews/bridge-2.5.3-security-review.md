# Security review: FinCom Bridge 2.5.3 (the user's own Tally on a shared Windows server; Tally's connection in tally.ini)

Reviewer: the build session's own adversarial pass over the diff, on the owner's reduced gates of 03-Nov-2026. No
independent review session was run; one is owed after the release.

Range: 3f242aa08..198e86e4d

## Another user's Tally

- Skipped exactly as before whenever Windows positively places it in another signed-in user's session (a non-zero session
  that is not the owner's), now also when that is learned from the Remote Desktop service. What changed: a Tally whose
  owner Windows does not give (session unreadable, or session 0) is asked the light company list (names, periods, GUID,
  BOOKSFROM; then GSTIN/PAN as for any Tally), unless another bridge of this computer uses it. On a server where the
  Remote Desktop service also refuses, another user's Tally can therefore be read by this bridge if that user's bridge
  is not running or does not answer /ping. Its companies then enter FinCom only under this bridge's firm and the cloud's
  lease per book; nothing is posted to a company FinCom did not send for this firm. This is the owner's explicit rule
  ("Never skip a Tally whose owner session cannot be determined"; "skipped only when POSITIVELY another logged-in user's").
- The typed port (POST /ports/use): an owner-unknown port is now kept when it answers as Tally and no other bridge here
  claims it (was refused).

## /ping

- New fields tallyPorts, tallyPortsUnknown, windowsUser for any caller (other users' bridges need them). No company
  names, no key, no data folder. A page cannot read it without an allowed Origin (CORS as before).
- A local program answering /ping as a bridge can only make this bridge leave an owner-unknown Tally alone (denial,
  shown as "another bridge"); it cannot make it use a Tally.

## tally.ini

- Written only on the add-on's reviewed path (2.4.5 R1-R6): the folder and file no link or junction, the file opened is
  the one looked at, the backup made new only (O_EXCL), read back, put back on any failure. A file this user cannot open
  for writing is not touched. Only "Client Server" (value) and a missing "ServerPort" line change; the port picked avoids
  other installs' ports, listening ports and the bridges' 9100..9199.
- Switching TallyPrime to "Both" makes it listen on its port on this computer as TallyPrime does when the user sets it in
  F1 > Settings > Connectivity; FinCom's add-on is still not added where User TDL = No.

## Requests to Tally

- No new request and no request shape changed (TestAllowListUnchanged; the stock row's words only). The owner-unknown and
  tally.ini ports get TDSDeskCompanies through invokeTally (allow-list, 2 s stop in the background, one in flight,
  postings first).

## Cloud

- tally-ingest keeps only the listed reason / tallyWhy values, owner "unknown", tallyConnectSay (200 characters) and
  tallyIni connect (four values) and serverPort (a number); anything else dropped. No migration.
