# FinCom Bridge 2.4.1 (branch release-241, from 2.4.0 as published: tax-accuracy 7c13c777)

The owner's decision of 09-Oct-2026: 2.4.1 ships WITHOUT the "two data locations" feature (the add-on's data folder, the
data id, 'other_source' lines, migration 71 and the Tally page's card). The final code review found two Highs in it (the
Tally read is not tied to the proven folder; an empty narration proves a forked copy), so the feature moved to 2.4.2,
built on branch next-241. 2.4.1 is 2.4.0 with the fixes below, ported from next-241.

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
