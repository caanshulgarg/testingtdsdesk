# Code review: FinCom Bridge 2.5.8 (a company opened in Tally shows within a minute, not up to 10)

Reviewer: the session that built it (a self-review against the owner's rules), on branch next-bridge-258. No
independent review session has looked at this range yet: one is to be done before the publish.

Range: 67646b38d..04938e593 (staging-next with 2.5.7 merged, to the version commit)

(bridge-go/: nocompany258.go and nocompany258_test.go (new); startpoint.go lightCompanyList (the short age while the
list is empty); ports.go openCompaniesAsk (each answer noted) and openCompaniesCachedOnce (a closed port open now, or
another Tally program on the port, asked at once); server.go /status?fresh=1 (a person's Check again asks Tally now)
and its sessions' askedAt / list; cloud.go beatParts (the beat's ports carry askedAt / list); rebuilt_test.go (the
notes reset per test). server/tally-cloud/index.ts: the beat's ports keep askedAt and list (PORT_LISTS), anything else
dropped as before. app: lib/tallySimple.js NO_CO_HELP, lib/connectSteps.js step 4's words. tests:
run_beat258_ingest.py (new), run_tally_simple.py, run_tally_connect_steps.py. The version 2.5.8 everywhere it is named.)

## The fault (the owner's server, 08-Nov-2026)

The beat repeats the list held (openCompaniesCached never asks Tally) and the light check asked TDSDeskCompanies again
only when the saved list was 10 minutes old. Tally answered at 07:16 with no company (just started); a company opened at
about 07:17 was seen at 07:27. askAfreshSoon fired only when Windows' port list changed; askAfreshNow was never called.

## What 2.5.8 changes

1. After this login's open Tally answered with no company, the light check asks the list again on a short age: 30 s
   for the first 3 minutes, then 1 minute, then 2 minutes while it stays empty (5 s early, so the 30 s beat never skips
   a turn). A list naming a company keeps its 10 minutes. When the short ask finds a company the beat goes at once.
2. A port the held list says closed that takes a connection now (cacheMatches' rule), or a port another Tally program
   (pid) holds now than the one that answered last, is asked at once (the once-a-minute wait between background asks
   not kept for it).
3. /status?fresh=1 (the Tally page's Check again through Bridge.refresh(true), Connect, the pairing) asks Tally now,
   never a list up to 30 s old; one at a time (a second press waits for the first and gets its answer).
4. The beat's ports, and /status's sessions, carry askedAt (the bridge's local time Tally last answered the list) and
   list ("named", "empty", "kept", "never"). Step 4 says "Tally answered at 07:16 with no company; checking again…"
   from them, and the new help line (Alt+F3, then F3).

## The owner's rules, checked

- No new request and no request shape changed: only TDSDeskCompanies (and, for a company seen for the first time,
  TDSDeskCompanyInfo and the light FinComCompany check, as before). TestAllowListUnchanged; the tests assert no other id.
- 2 s at most: every company-list ask is capped at colistMaxSec (tally.go) whoever asks; the background asks keep the
  2 s hard stop (bgCompaniesTC) and the shared retry schedule.
- One in flight: the Tally lock as before; askBgRunning for the background ask; personAskMu for Check again; the light
  check is one at a time (lightBusy).
- Postings first: the light check stops for a posting (lightCheckBlocked); the background and the person's asks give way
  to a posting that starts while they wait (yield); Check again during a posting shows the list held.
- Never while someone types in Tally: the new asks (1, 2, 3) wait while keepTypingNow says a key or click in Tally in the
  last second; the 10-minute ask is unchanged.
- No AI anywhere in this.

## Known, to watch

- A Tally left open on its company list (no company) for hours is asked every 2 minutes (each ask the light list, under
  2 s). The owner's choice; nothing else is sent.
- An own Tally that answers with an error (not "no company") is also on the short age, as its held list names no
  company; the shared retry schedule backs it off after a stop, as before.
- Check again is a person's ask (not a background one): the background reads wait their usual few seconds after it.
- The "Tally answered at" line seen from another computer needs the cloud change (tally-ingest) deployed; without it
  the page says the rest of step 4.

## Tests

- go vet (Linux, Windows); go test -timeout 40m ./... ; the new TestR258* (empty then a company: seen at the 30 s turn;
  the easing 30 s / 1 min / 2 min; a named list keeps 10 minutes; nothing while a posting runs or someone types; a
  closed port open now asked at once; another program on the port asked at once; Check again asks every press, one
  at a time, the plain status asks nothing; the beat's fields).
- tests/run_beat258_ingest.py and run_beat254_ingest.py (tally-ingest under Deno); tests/run_tally_simple.py and
  run_tally_connect_steps.py on the React build (step 4's words, the answer time, Check again reaching /status?fresh=1
  only with this login's bridge paired here). Main bundle 266,036 B gzip (limit 266,240); legacy.js unchanged.

## Verdict

Ship after an independent review session agrees.
