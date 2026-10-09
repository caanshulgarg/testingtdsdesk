# Code review: FinCom Bridge 2.4.1 (the fallback by number, the log's words, the bank route across a restart, received_at)

Reviewed: 09-Oct-2026, an independent review of origin/release-241 (751c1795) against origin/tax-accuracy 7c13c777 (the
published 2.4.0). Read with `git diff 7c13c777 751c1795 -- bridge-go/ server/ src/ app/src/ docs/tally-allowlist.md`.

The "two data locations" feature (the add-on's data folder, the data id, 'other_source' lines, migration 71, the Tally
page's card) and the ledger page were reviewed on next-241 (the independent review of 0f436f6c and three re-reviews up to
557834df). By the owner's decision of 09-Oct-2026 the data locations moved to 2.4.2 (branch next-241) after the last
re-review found two Highs in them (the Tally read not tied to the proven folder; an empty narration proving a forked
copy); those reviews belong to 2.4.2's note. The ledger page and the app's Needs-you words ship from arc-ui.

## What 2.4.1 does

- The fallback by number (the owner's approval of 09-Oct-2026, item 5; reverses 2.3.4's L5 for this case only): a created
  or altered line whose MasterID answer is an older entry (below the starting point) or no voucher is asked
  FinComVoucherByNumber once, on its first fetch; taken only when exactly one voucher comes back and it passes
  liveVoucherWrong with the MasterID cleared. Another type, date or number keeps 2.4.0's hold (review M1 of next-241); the
  entry's narration is Tally's. Words: "the voucher with that MasterID in this Tally is an older entry, not this save".
- The log's words (item 6): a refused FinComVoucherByNumber says its own rule (voucherByNumberWhy), not "ReadDays".
- The bank route keeps the add-on's line count (addonN, addon, listed) in bankdate.json with its counter, so a restart
  no longer reads and sends again the entries those lines explained.
- tally-ingest keeps the bridge's received_at in the line's payload (an ISO time at most 5 minutes ahead). No migration.

## Checked

- **Nothing of the data locations.** The add-on is byte-identical to 2.4.0's; no migration file and no SQL changed; no
  app change; nothing reads or writes dp=, a data id, 'other_source', data_proven, dataSources or verifyLines (the tests
  of release241_test.go assert it for the add-on and the notes).
- **Requests.** No request added or changed: the allow-list table and its hash unchanged (TestAllowListUnchanged); the
  decision line names 2.4.1 and the dated "re-measured on 2026-10-09" line is there (release-check step 4 passes). The
  fallback sends FinComVoucherByNumber exactly as built, under voucherByNumberExact (one day, from the starting day to
  today, within 3 days or a line just asked).
- **2-second rule, one request in flight.** The fallback runs inside the fetch turn on recorderTC with the turn's
  deadline; once on the first fetch; the held list asks by MasterID alone.
- **Own Tally only.** Unchanged; a company open in two of this user's Tallys is refused ("many").
- **Figures.** The fallback takes only a current voucher of this Tally above the starting point, with its own GUID, type,
  date, number and narration; nothing else moves a figure. received_at goes only into the payload: the column keeps the
  database's now(), so the ordering checks of 53 / 63 / 67 are unchanged.
- **SQL.** None in this release.
- **No AI** in the bridge or the add-on.

## The independent review (09-Oct-2026), range 7c13c777..751c1795

0 High, 0 Medium, 4 Low. go vet (Linux, Windows) clean; go test ./... passes (928 s, -timeout 25m); release-check.sh
passes steps 1-4 (step 5: this note); run_recorder_server.py passes (202 checks). Probes: a renumbered entry (Sales 6 with
MasterID 26500 now Sales 5) is held, never taken as MasterID 26501; the 09-Oct case (Sales 2026-27/GST/297, MasterID
25743 an older entry here) takes this Tally's own Sales 297 with Tally's narration.
- L1: recorder_live.go:2389, the comment still names "another type, date or number" and "a line of another data
  location ... (datasource.go)", which is not in this release; correct the comment.
- L2: the app (2.4.0's 61-recorder.js) reads the new "older entry" words as Needs-you 'other' with Apply now, which cannot
  apply a line held without its entry; to be made "upload that day's Day Book" in arc-ui (the notes say so).
- L3: without the data locations, a second copy's line whose MasterID is an older entry here now resolves to this Tally's
  own voucher of that number (a real entry, sent again at worst) instead of being held with words: the owner loses that
  signal. Two copies of one company are as in 2.4.0 until 2.4.2.
- L4: the bank route writes bankdate.json (up to 20,000 MasterIDs a company) on every add-on line and taken entry.
- Not run here: real Tally (the fallback on NWS144), the app's tests (no app change), staging (no migration).

Range: 7c13c777..751c1795
