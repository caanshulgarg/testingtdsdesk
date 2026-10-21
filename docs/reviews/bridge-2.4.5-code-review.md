# Code review: FinCom Bridge 2.4.5 (ROUND 102: older entries for a chosen period, the exact ledger count, tally.ini, job files)

Reviewer: independent review sessions (Claude Code's code-review recipe, each a fresh forked context with no access beyond
the repository; high effort for rounds 1 to 4, medium for the short re-reviews), one round after each set of fixes, until
no High or Medium was left open. The security review is in bridge-2.4.5-security-review.md (same rounds, security focus
from round 3).

Range: 33994f94c..d25f13424

(next-245 from 33994f94c, the owner-approved forms; the two merges of staging-next, 0dd570063 and bd1f56247, bring the
published reports pack, the two-step QR fix and the FSX guards, out of scope here.)

## What 2.4.5 changes

- FinComDayHeads (one day FinCom listed; per voucher type only after a 2 s stop) and FinComLedgerIds (MasterIDs, rows
  counted), exactly as the owner approved on 21-Oct-2026; daypull.go, ledcount.go.
- tally.ini: the installer and the per-user / service first start add FinCom's add-on line (tallyini.go).
- Job files written atomically, never an update lost (jobfile.go); the old PowerShell bridge the same (TDSBridge.ps1).
- Migration 98, tally-ingest period_heads / period_entries / ledger_progress and periodDays; the app's
  "Bring older entries from Tally" (OlderEntries.jsx) and step 5's count.

## Rounds

| Round | Commit reviewed | Found | Fixed in |
|---|---|---|---|
| 1 | 33994f94c..98bf8e9c8 | 24 (6 serious: Pause did not stop the reads; days taken from the bridge by the next beat; entries with no ledger line never held; an upload day not retried; a locked month looping; the job-file flush could land an older update over a newer one) and 18 smaller (types with "&", keepHold, ledger count holds and poison, tally.ini put-back and marker, OlderEntries part, CRLF of TDSBridge.ps1, ...) | 9764b990f |
| 2 | 98bf8e9c8..9764b990f | 18: a day that never ends re-read every beat; upload days only in memory; "gone" taking an entry out on one empty answer; the round's end progress dropped; a transient cloud fault throwing work away; OlderEntries reload; ... | 0d9cd379d |
| 3 | 33994f94c..0d9cd379d (security focus) | 10: a same-named company copy could write into a book (no book-GUID check); Pause not refused server-side; refused bodies resent for ever; tally.ini link swap between check and write; no rate limit on the new kinds; ... | 449225509 |
| 4 | 0d9cd379d..449225509 | 10: fail-open GUID lookup; 429 dropping work; SameFile not protecting on Windows; save race; 4 MB truncation; ... | 052a92c41 |
| 5 | 449225509..052a92c41 | 6: one failing book blocking the others; a 429 dropping the round's end; backup Lstat error; empty-GUID progress; 400 too broad; parent junctions | cd3bb095f |
| 6 | 052a92c41..cd3bb095f | 3 Medium (413 loop; empty-GUID progress refused; EvalSymlinks too strict) | 612c345be |
| 7 | cd3bb095f..612c345be | 2 Medium (parent links; heartbeat GUID lookup narrower than deviceNamed) | c6237e388 |
| 8 | 612c345be..c6237e388 | 2 Medium: GUID lookup ambiguous between two same-named companies (fixed: no match then); every parent folder checked could refuse a TallyPrime installed under a mount point or OneDrive folder (accepted, Low here: the folders looked at are under Program Files only, whose parents are C:\ and Program Files; refused means only that the add-on line is not added, said in Help & support) | acaab4996 |
| 9 | c6237e388..acaab4996 | 1 Medium: the heartbeat GUID lookup sees only the last bridge's companies (info.bridges holds none) | d25f13424 (the lookup removed: ledger progress needs the book's recorded GUID whenever one is recorded) |

No High or Medium open at d25f13424. Each fix came with a test (Go: r245_test.go, r245ini_test.go, r245jobs_test.go;
SQL: tests/run_migration98.py; tally-ingest: tests/run_period_ingest.py; app: tests/run_older_entries_ui.py,
tests/run_tally_ini_ui.py).

## Lows left for 2.4.6

- The voucher-type list for a split is worked out on each beat that lists a day (grouping the book's entries and the
  year's day lists): cache it per pull.
- jobFiles.locks keeps one small mutex per job-file path written (cleared at the bridge's restart).
- A type used only on the slow day itself, not in the book nor in any other day's list, is not asked in a split: that
  day can be counted short; the per-day count is "at least".
- assets/connector/latest.json (signed) still names the old connector engine TDSBridge.ps1 that publish no longer ships:
  an old FinCom Connector below engine 1.14.6 gets 404 at its update check.
- The "User TDL = No: switch on" owner action (the owner's decision of 21-Oct-2026) is 2.4.6's first item.

The whole range reviewed, as release-check reads it (the last range in this note):

Range: 33994f94c..d25f13424
