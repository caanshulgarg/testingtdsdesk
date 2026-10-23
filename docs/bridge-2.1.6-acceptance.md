# FinCom Bridge 2.1.6: acceptance record (NWS144 pilot)

Fill this in by hand during the pilot (docs/RELEASE-CHECKLIST.md, steps 12 and 13). Leave nothing blank. If a step
does not apply, write "n/a" and give the reason.

## The build

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.1.6.exe |
| SHA-256 (from the .sha256 file) | 101d793d483ae972b697cd592f02a5b1670cb1f7329524bb6cef4516ceb17c68 |
| Git commit built | 27aa360 (bridge sources), BridgeVersion 2.1.6, built 2026-10-03 11:50 UTC with POSTONLY="ZZ TEST" (the installer writes PostOnly ["ZZ TEST"]) |
| `release-check.sh` passed on (date, time) | 2026-10-03 11:48 UTC at d24bca8, checks 1 to 6 ok (check 4 by the 2.1.6-only exception) |
| Code review note | docs/reviews/bridge-2.1.6-code-review.md, range: be5542f..27aa360 (rounds 4 to 11) |
| Security review note | docs/reviews/bridge-2.1.6-security-review.md, range: be5542f..27aa360 (rounds 4 to 11) |
| Allow-list hash (sha256 of docs/tally-allowlist.md) | 7e721e8d616a630a14ccf7b509bd029bbe37fa1f0a6e738190aa5d8c2471d5d3 |

## Pilot on NWS144

| | |
|---|---|
| Marked for pilot in FinCom by, at | |
| Installed on NWS144 at | |
| Version shown in the tray / FinCom | |
| Pilot working day (date, from to) | |
| Test sheet (docs/bridge-2.1.6-test-sheet.txt) worked through by | |

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
