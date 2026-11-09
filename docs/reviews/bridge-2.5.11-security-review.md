# Security review: FinCom Bridge 2.5.11

Reviewers: the session that built it (self-review).

Range: da12b90e1..044b4a3ea (released 2.5.10 to the version bump)

## Requests to Tally

- None added and none changed; the table's rows are 2.5.10's (allowed for 2.5.11 by the owner's standing decision of
  2026-10-06). The new ports in the plan are tried as every tally.ini port before: a port Windows shows closed is sent
  nothing.

## Files read and written

- Read only: the tally.ini next to this login's running tally.exe (as 2.5.4), and this login's own
  %LOCALAPPDATA%\VirtualStore\Program Files*\TallyPrime*\tally.ini (the known folder of the bridge's own Windows user).
  No tally.ini is written, no backup made, VirtualStore is never added to the files the setup may change.
- Written: sync\tally-last-port.json in the bridge's own data folder (a port number and a time), at most hourly.

## Data and the cloud

- The beat's tallyOff: folder names (never a path: a user's profile path never leaves the computer), kinds, the mode,
  port numbers, ISO times, booleans, and, when another login's Tally holds this login's port, that login's short
  Windows user name (the beat's ports already name it as "Tally of <user>"). The cloud keeps only these fields, cut,
  path characters stripped, and only with tallyWhy "connection off" (run_tally_off_ingest.py).
- /status and /diagnose (the local server, behind its existing checks) add the same details; /diagnose's tally.ini
  entry for this login's Tally names which copy was read.

## The page

- The bridge's words are shown as text (no markup); nothing new is asked of the bridge or the cloud.

## Verdict

Ship, as far as security goes.
