# FinCom Bridge 2.1.5: acceptance record (NWS144 pilot)

Fill this in by hand during the pilot (docs/RELEASE-CHECKLIST.md, steps 12 and 13). Leave nothing blank. If a step
does not apply, write "n/a" and give the reason.

## The build

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.1.5.exe |
| SHA-256 (from the .sha256 file) | f75dbcae652677592a8d657004399c14195c660c00c27af3003262135bb5fba3 |
| Git commit built | e6e070b (e6e070b review-notes fix; code at be5542f) |
| `release-check.sh` passed on (date, time) | |
| Code review note | docs/reviews/bridge-2.1.5-code-review.md, range: |
| Security review note | docs/reviews/bridge-2.1.5-security-review.md, range: |
| Allow-list hash (sha256 of docs/tally-allowlist.md) | aef526b9297155888057da9fb06cd9ef8e043d8a586999a02d39249a426d8d1e |

## Pilot on NWS144

| | |
|---|---|
| Marked for pilot in FinCom by, at | |
| Installed on NWS144 at | |
| Version shown in the tray / FinCom | |
| Pilot working day (date, from to) | |
| Test sheet (docs/bridge-2.1.5-test-sheet.txt) worked through by | |

## Results

| Check | Result | Notes |
|---|---|---|
| Every test sheet step passed (list the failures, if any) | | |
| Longest request of the day (type, seconds) | | |
| Requests over 20 s (number) | | |
| Self-stops (when, reason) | | |
| Posting during Update now: seconds until it reached Tally | | |
| Tally stayed usable for the operator all day (yes / no) | | |
| Pause / Resume worked | | |
| Nothing installed by itself on any other computer | | |
| Problems seen (none / describe) | | |

## Decision

| | |
|---|---|
| Accepted / not accepted | |
| Owner approval in FinCom by, at | |
| Signed (owner) | |
| Date | |

The other computers get 2.1.5 only after the approval above is recorded in FinCom. Copy the pilot start date and the
approval into the release log in docs/RELEASE-CHECKLIST.md.
