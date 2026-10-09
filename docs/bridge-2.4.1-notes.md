# FinCom Bridge 2.4.1 (branch release-241, from 2.4.0 as published: tax-accuracy 7c13c777)

The owner's decision of 09-Oct-2026: 2.4.1 ships WITHOUT the "two data locations" feature (the add-on's data folder, the
data id, 'other_source' lines, migration 71 and the Tally page's card). The final code review found two Highs in it (the
Tally read is not tied to the proven folder; an empty narration proves a forked copy), so the feature moved to 2.4.2,
built on branch next-241. 2.4.1 is 2.4.0 with the fixes below, ported from next-241.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.1.exe |
| Fingerprint | SHA-256 `79e95ba3bf701ed2222b769d207f5cc885980a51f1443ded74fbd0ce7a5ae06a` (FinComBridge-Setup-2.4.1.exe, built 10-Oct-2026 04:59 IST; compare with the .sha256 file next to the setup); program SHA-256 `f59866e0e2da9e2c028749633f447d136c383e3e747ba0f73b7ff26c54436eab` |
| Withdrawn | an earlier 2.4.1 build, setup SHA-256 `8c5b8b077a7249b17f404d5dc8723ba7af6c0107810696d3b08979de2f0975b3` (5eaafd2f), never published, reverted in 435cd08a: its real-Tally gate (run 37981697177) failed u2 on all five releases |
| Replaces | 2.4.0 (kept on the computer, so the tray can roll back to it) |

## What is in 2.4.1

1. **The fallback by number (the owner's approval of 09-Oct-2026, item 5; reverses 2.3.4's L5 for this case only).**
   A created or altered line whose MasterID answer is an older entry (below the starting point) or no voucher at all is
   asked FinComVoucherByNumber ONCE, on its first fetch (its type, number and date, from the starting day to today as
   voucherByNumberExact allows). The answer is taken only when exactly one voucher comes back and it passes
   liveVoucherWrong with the MasterID cleared. A MasterID answer of another type, date or number keeps 2.4.0's hold
   (review M1 of next-241: a renumbering gives the MasterID another number). The entry's narration is Tally's, never the
   line's (c.narr cleared before liveTakeBody). The held list still asks by MasterID alone. Words: "the voucher with that
   MasterID in this Tally is an older entry, not this save" (the older entry is never named). Tests: fallback241_test.go,
   TestR222FallbackByNumber, TestFast234MasterIDLineNeverByNumber. Ported: next-241 9f01278e and the M1 part of 8f87471c.
2. **The log's words (item 6).** FinComVoucherByNumber refused before sending says its own rule (voucherByNumberWhy):
   "the date is before the company's starting day (<d>)" or "older than 3 days and not just asked", not "reading old
   entries is off (ReadDays)".
3. **The bank route across a restart (the real-Tally dry run 37938029402, u2).** The count of the add-on's lines
   (addonN, addon, listed) is kept in bankdate.json with the counter it explains, in one atomic write; a restart (the
   upgrade, a reboot) no longer reads again and sends again, as 'altered' with source bankdate and the same AlterIDs, the
   entries those lines explained. Tests: bankdate241_test.go. Ported: next-241 a49f48c3.
4. **received_at kept** in tally-ingest's cleanRecorderLine (the bridge's own clock when it read the line, in the line's
   payload; one more than 5 minutes ahead is dropped). No migration: the database stores the payload as it is. Test:
   run_recorder_server.py.

5. **The bank route over an older bridge's state (the real-Tally gate 37981697177, upg u2).** On the first start after
   2.4.0 (whose bankdate.json has no add-on line count) the route takes Tally's counter as its starting point, as 2.4.0
   did at its own first check, instead of reading again and sending again what 2.4.0's add-on lines had sent; the mark
   is kept on disk ("older": true) until the company's own first check (re-review M1). A bank date set in that stretch
   is found by the nightly self-check; with the self-check off the log says the Day Book is needed (re-review L1).
   Tests: bankdate241older_test.go.

No migration. No change to the add-on: the add-on unchanged from 2.4.0 (no data-folder line). No request on the
allow-list and no request shape changed (docs/tally-allowlist.md: the decision line and the dated "re-measured on
2026-10-09" line). No AI in the bridge or the add-on.

## Not in 2.4.1

- The two data locations: moved to 2.4.2 (next-241).
- The app's Needs-you words and the 61-recorder.js 'baseline' fix: the app now ships from arc-ui; to be made there (the
  "older entry" words are Needs you, the Day Book; 'baseline' only for "starting point not recorded").
- The ledger page of next-ledpage241: app-side, arc-ui.

## Checks

go vet (Linux and Windows), go test -timeout 25m, release-check steps 1-4, CI and Windows CI on release-241.
