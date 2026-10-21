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
| 10 | d25f13424..438114131 (ROUND 103) | 2 High, 4 Medium: the window hold measured from before the send (a wait for Tally's lock counted as a freeze) and "no freeze" said when no window of Tally could be seen (a Windows service); an entry request over 2 s did not stop the period; an older choice's stop could stop a newer choice (tally_period_stop not tied to chosen_at, day not checked against the year); the by-type form still passed the gate; the re-check looked into folders the setup never knew and read files under the lock; the upload line offered only the days from the stop | 2b18c4072 |
| 11 | 438114131..556508c20 (the fixes, and the withdrawn 2.4.5 setup moved to assets-test/bridge-go-old unchanged) | none High or Medium (Low: the window probe's last pass can add up to 250 ms per hung window to the request's end; accepted) | - |
| 12 | 556508c20..7919db499 (ROUND 103, the owner's decisions of 21-Oct-2026 evening: the night/Sunday pace, payroll in the older-period fetch; one review pass of the bridge, the cloud, migration 98 and the app, the session's own, test-first fixes) | 1 Medium: at night the second company's tally_period_next call was given p_max 3 or less (the days left of the 30) and recorded the day pace for its book (the status line said "at day pace" at night); release245_test did not know tally_device_period_night. Low: a custom payroll voucher type this bridge has not yet seen carrying pay heads keeps the 2 s limit on its first entry (as in 2.4.4); the speed for the time left counts a day done at once (FinCom already held it) as fetched, so the first minutes' time left can be short | 7919db499 (p_max kept above 3 at night, the answer cut to what is left; tests/run_period_ingest.py) |
| 13 | 7919db499..9cf6e2f25 (the merge of staging-next 6ab4a38b8: per-account browser copies, already reviewed and published there; no file of bridge-go/, server/tally-cloud/ or the 2.4.5 app parts touched) | none | - |
| 14 | 1ecb71351..b747273fc (tests/run_period_ingest.py only: the office hours set around the hour the test runs at; no bridge, cloud or app file, the setup of 1ecb71351 unchanged) | none | - |
| 15 | 556508c20..b747273fc (read-only review of a git archive of b747273fc: the night/Sunday pace, payroll in the period fetch, migration 98's growth, tally-ingest, the app; notes in the session's review-245-r15) | 2 Medium: M1 a payroll entry waiting for its employees could hold the computer's whole period fetch for ever (no other day or company read, read entries not flushed, no upload line); M2 the employees' read inside the period fetch sent up to 30 requests back to back, past the six conditions and the window watch, a chunk over 2 s retried automatically. 6 Low: L1 night flag set before the list was filtered (early beats all night); L2 the employees check keyed by name; L3 the payroll window-hold at 3 s (the owner confirmed on 21-Oct-2026: payroll vouchers only up to 3 s, all else 2 s); L4 tally_period_next stamped days tally-ingest dropped, the ETA speed from an overwritten asked_at; L5 no cloud-side limit on early asks; L6 sign-out-everywhere and the legacy browser databases (staging-next's, out of 2.4.5's scope, not changed here) | 4d665b045 (test-first: r245r15_test.go, r245night_test.go B3, tests/run_migration98.py 2c/4e/6b, tests/run_period_ingest.py; migration 98 md5 105ee690...) |
| 16 | 4d665b045..0781ab261 (the merge of staging-next 8f5ad0b6d: .github/workflows/ci.yml only, the same ten shares next-245 had; both reasons kept) | none | - |

No High or Medium open at 2b18c4072 (ROUND 103 fixes: r103_test.go, r245_test.go, r245ini_test.go, allowlist_test.go; tests/run_migration98.py 4b; tests/run_period_ingest.py; tests/run_older_entries_ui.py 4b). Each fix came with a test (Go: r245_test.go, r245ini_test.go, r245jobs_test.go;
SQL: tests/run_migration98.py; tally-ingest: tests/run_period_ingest.py; app: tests/run_older_entries_ui.py,
tests/run_tally_ini_ui.py).

## Lows left for 2.4.6

- The voucher-type list for a split is worked out on each beat that lists a day (grouping the book's entries and the
  year's day lists): cache it per pull.
- jobFiles.locks keeps one small mutex per job-file path written (cleared at the bridge's restart).
- A type used only on the slow day itself, not in the book nor in any other day's list, is not asked in a split: that
  day can be counted short; the per-day count is "at least".
- assets/connector/latest.json (signed, unchanged) names https://staging.fincom.live/assets/connector/TDSBridge.ps1
  (engine 1.14.6, sha256 f47c4c9e...e5b81e06): that root copy on main is untouched by 2.4.5 (publish-preview only leaves
  it out of the React build it copies into react/ or review/; cp adds, never deletes), so the signed manifest still
  resolves and its hash still matches. Kept shipped unchanged until the owner re-signs a manifest without it (ROUND 103
  item 4); removing the file first would make an old FinCom Connector's update check fail.
- The "User TDL = No: switch on" owner action (the owner's decision of 21-Oct-2026) is 2.4.6's first item.

The whole range reviewed, as release-check reads it (the last range in this note):

Range: 33994f94c..0781ab261
