# Code review: FinCom Bridge 2.5.11 (why this login's TallyPrime is open but takes no connection)

Reviewers: the session that built it (a self-review against the owner's rules, below), then an independent review at
044b4a3ea (no request to another user's Tally, no privacy leak; ten fixes, made with tests in c28d45c94: see the end).

Range: da12b90e1..3f2908483 (released 2.5.10 to the withdrawal of the first build; the last commit moves the withdrawn
build's files only)

(bridge-go/: owntally2511.go (new: tallyOffOf, ownIniOf, virtualStoreOf / virtualStoreInis, ownTallyIniPorts, the
last-port memory, tallyOffBeat, diagIni), owntally254.go (connOffNow returns the details; connOffFn's third value),
owntally253.go (tallyWhy notes the last port; the details kept with the words), ports.go (the test file's "started";
portPlan tries this login's running Tally's tally.ini ports first; /diagnose's words and tallyOff), anyport.go
(resetIniPorts clears the new cache), cloud.go (the beat's tallyOff), server.go (/status's tallyOff); tests
r2511_test.go (new), r254_test.go (the words of 2.5.4's cases as 2.5.11 says them), rebuilt_test.go (the new state reset
per test). server/tally-cloud/index.ts (tallyOffOf). app: lib/tallySimple.js (offSay, checkedSay), lib/connectSteps.js
(step 3 from tallyOff), parts/TallySimple.jsx (ownTallys' "connection off" from tallyOff; the laptop's top line),
parts/TallyFetch.jsx (reachWords in the Entries cell's wait). tests: run_tally_off_ingest.py (new), run_check_again.py,
run_tally_connect_steps.py, run_tally_basics.py, run_tally_progress.py. The version 2.5.11 everywhere it is named.)

## The case (the owner's shared server, 09-Nov-2026)

This login's TallyPrime ran with a company open and listened on no port. The day before it listened on 9039, the
page's port for this login, typed in F1 > Settings > Connectivity but never saved in any tally.ini (the server is
shared, so the bridge writes none). 2.5.10's beat: tallyWhy "connection off", tallyConnectSay "set but not on yet.
Close and reopen Tally once" (the words for any Tally whose tally.ini says Both and whose port nobody holds), ports
9000 (another user's, skipped), 9114 / 9249 / 7845 closed. Reopening loads the same tally.ini, so the advice was wrong;
the page said "N bridges online, but Tally is not open" (checkedSay from tallyOpenOn alone), step 3 "reopen", and the
connection rows marked "connection off" only when exactly one port was closed.

## 1. The details and the words (owntally2511.go)

- tallyOffOf is called for this login's Tally (sessionOwner "mine", running a minute or more, listening on no port), as
  2.5.4's rule found it; nothing else decides "connection off". The details: the running tally.exe's folder name only
  (never the path: TestR2511Words), which tally.ini it reads (kind programFiles / virtualStore / exeFolder / none and
  the folder's name), the mode (Both / Server / Client / None, "" unknown), the port in it and the port it should take
  (9000 when none), the file's time and the process's start (UTC ISO) and whether the file changed after the start, who
  holds the port (otherUser with the short name, tally (owner unknown), program), this login's own port (clash only),
  the last port remembered and when.
- The words in order (after the independent review): mode not Both / Server (no tally.ini counts here, as 2.5.4); the
  port held by a Tally of another login (this login's own port, loginOwnPortFree with every listening port put aside,
  as the page counts it), by a Tally whose owner Windows did not give ("another program or a Tally run as
  administrator"), or by another program (2.5.4's words); reopen ONLY when tally.ini changed after this Tally started
  (a start time Windows did not give is never "after"); lost (a remembered port not listening now and not the port it
  should take, tally.ini not saved since that port answered); else nothing listening on its port. On a computer
  several logins use (iniSharedFn) or with a tally.ini this login may not write, the administrator's words with this
  login's own port instead of F1 > Ctrl+A (this login's VirtualStore copy is its own: Ctrl+A). Each case and its
  300-letter bound: TestR2511Words, TestR2511AdminWords, TestR2511LostAgainstWant.
- Day words: "Earlier today" / "Yesterday" / "On 07-Nov" by the computer's own calendar (TestR2511LastPort).
- 2.5.4's fallback (Windows lists no programs) is unchanged and carries no details.

## 2. The last port (owntally2511.go noteTallyPort)

- tallyWhy notes the first port in its list that answered (ok), is this login's (mine true) and not skipped: an
  owner-unknown or another login's Tally is never remembered (TestR2511LastPort). The file sync\tally-last-port.json
  (port, RFC3339 time) is written only when the port changes or an hour after the last write; read once a run, reset per
  test.

## 3. VirtualStore (owntally2511.go ownIniOf, virtualStoreInis)

- The copy of a tally.ini under Program Files / Program Files (x86) at %LOCALAPPDATA%\VirtualStore\<that folder's
  name>\<the rest> (the known-folder LOCALAPPDATA of the bridge's own user; as a service the owning user's profile
  by OwnerSid, else none), read only. For this login's own Tally the copy is taken only for a 32-bit (WOW64) Tally not
  run elevated (Windows redirects no other; IsWow64Process and the token's elevation, read with the path and start
  time); not known: the Program Files file, and tallyOff.iniUnsure says so. The other copy's port is kept as otherPort
  for the plan. Never written, no backup made (TestR2511VirtualStore). tallyIniDirsFn (the files the setup may add the
  add-on line to) is not changed: VirtualStore is never among the files written.

## 4. The plan (ports.go portPlan)

- ownTallyIniPorts (30 s cache): the ports of each running Tally of this login (its tally.ini and its VirtualStore
  copy) and every VirtualStore TallyPrime*\tally.ini of this login, before the other tally.ini ports and 9000. byPort
  marks each by Windows' listener; a closed port is sent nothing, as every tally.ini port before
  (TestR2511PlanHasOwnIniPort; another login's Tally's tally.ini is not read for it).

## 5. The beat, /status, /diagnose

- The beat and /status carry tallyOff only while tallyWhy is "connection off" (null otherwise); /diagnose gives the
  same words as its fix and tallyOff (TestR2511BeatCarriesTallyOff). tallyConnectSay carries the words as before.

## 6. The cloud (tallyOffOf)

- Kept only with tallyWhy "connection off"; a known reason or nothing; names cut to their last path part, 60 letters,
  no path characters; known kinds, modes and holders; ports 1-65535; ISO times; booleans only when true; the other
  user's name 40 letters, only with otherUser (run_tally_off_ingest.py). Not in the broadcast (the page reads the
  computer's beat; the broadcast's beat is merged into it, so nothing is lost).

## 7. The page

- checkedSay: no bridge with Tally open, a fresh bridge whose beat says connection off (tallyWhy or tallyOff): "N
  bridges online. Tally is open in your Windows login but takes no connection: <its words>"; the laptop's top line says
  it too (run_check_again.py M2).
- Step 3 with tallyOff: the bridge's words, its hook (reopen / lost / mode / clash / closed), the port to copy (the
  remembered one, this login's own, or the file's; none for reopen), the shared-settings warning unless the file is this
  login's VirtualStore copy or the case is reopen (run_tally_connect_steps.py 17). Without tallyOff (an older bridge):
  as before.
- The rows: with tallyOff the port it names is "connection off" however many are closed, and shown even when another
  login's Tally holds it (run_tally_basics.py 1c).
- The Entries cell: waiting for Tally to be free and the book's computer's fresh beat says no Tally of its login answers:
  "FinCom Bridge can't reach your Tally: <its words>" (else its reason in plain words), else as before
  (run_tally_progress.py 3 (2.5.11)).
- Main bundle 266,144 B gzip after the review's fixes (limit 266,240; the code is in the Tally chunks); legacy.js
  unchanged (615,218 B).

## Owner's rules

- No new request to Tally and no request changed (the allow-list's rows are 2.5.10's); the 2-second stop, one request in
  flight, postings first and the typing gate untouched.
- No tally.ini written by any of it; another user's never read for this login's Tally's words beyond the Program Files
  files the bridge already read (and its own VirtualStore).
- Made-up names only in the new tests.

## Verdict

Ship (self-review).

## The independent review (at 044b4a3ea) and its fixes (c28d45c94)

No request to another user's Tally, no privacy leak. Fixed before the release, each with a test:
1. "Reopen" only for a tally.ini changed after the start that says Both / Server with its port free; otherwise the
   mode's or the clash's words (TestR2511Words: None / Client changed after start; another login saved the shared file
   naming 9000, held by its Tally).
2. A shared computer or an unwritable tally.ini: the administrator's words, "each login its own TallyPrime folder and
   port (yours: <p>)", never Ctrl+A in F1 (TestR2511AdminWords); tallyOff.shared / unwritable; the page's
   shared-settings warning whenever the bridge says so, not only after a bridge write (run_tally_connect_steps.py 17);
   the cloud keeps 300 letters of the words (run_tally_off_ingest.py).
3. The remembered port compared with the port it should take (9000 when tally.ini names none), after the mode
   (TestR2511LostAgainstWant).
4. VirtualStore not chosen by date: only for a 32-bit Tally not run elevated; not known: Program Files', and said
   (TestR2511VirtualStore).
5. Service mode: the owning user's profile's VirtualStore, else none (vsLocalAppData; TestR2511VirtualStore: no folder,
   none read).
6. heldBy "tally" (owner unknown): "another program or a Tally run as administrator" (TestR2511Words).
7. No own port: "set a port of your own" (TestR2511Words).
8. /diagnose: one finding, one port, the words' (TestR2511DiagnoseOnePort).
9. tallyWhy once per beat (TestR2511BeatCarriesTallyOff); the last-port file at most hourly (kept).
10. The page's rows: the local status when present; no row from a beat over 3 minutes old (run_tally_basics.py 1c).
