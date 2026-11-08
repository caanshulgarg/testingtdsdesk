# Code review: FinCom Bridge 2.5.7 (the older-entries fast read, FastEntries, OFF by default)

Reviewers: two rounds of an independent review session (the coordinator's) on branch next-fast-entries. Round 1 on
0de692f49: findings 1-9 (two high, two medium, four low, one note); all fixed with tests in c9b3673fa. Round 2 on
c9b3673fa: nothing blocks. Verdict: ship with FastEntries OFF.

Range: 9bad8676c..7357e3e36 (2.5.6's release head to the version commit)

(bridge-go/: fastentries.go and fastentries_test.go (new); daypull.go (the hook, the LINEERROR fix on the per-day path,
30 listed days by day only with FastEntries on); allowlist.go, pinned.go, tally.go (the two window requests on the list,
pinned and guarded only while the switch is on); rebuilt_test.go (the stand Tally answers them). server/tally-cloud:
periodpace.js (new) and index.ts (30 days a beat by day only to a bridge whose beat says FastEntries is on; its speed
kept by book). app: lib/pullSpeed.js (new) and parts/TallyFetch.jsx (the time left from a fast bridge's speed). The
version 2.5.7 everywhere it is named (7357e3e36). The rest of the range is staging-next merged in, reviewed on its own.)

## What 2.5.7 changes

1. FastEntries (off by default): the older-entries read asks a window of 2 to 31 listed days in one heads request
   (FinComWindowHeads) and the wanted entries in groups across those days (FinComVoucherWindow, FinComVoucherBatch's
   frozen FETCH), with adaptive sizes and the fallbacks of docs/fast-entries-design.md. Nothing of it runs with the
   switch off.
2. The per-day path: a FinComDayHeads answer carrying LINEERROR is handled as an answer that cannot be read (counted,
   asked again later, the day left after five), never as a day of no entries.
3. BridgeVersion 2.5.7.

## What was checked and holds (with FastEntries off)

- The request table, its hash and "measured", and the heartbeat are 2.5.6's (the two rows are not on the list; the
  beat carries no periodPull.fast): TestFastRequestsAsInTheDoc, TestFastRateInBeat, TestAllowListUnchanged, the beat
  fixture.
- Both window ids are refused before sending (not on the list; the dated guard refuses them too): TestFastGuardOffByDefault.
- The cloud hands such a bridge 3 days by day, 30 at night, as before (periodpace_test.mjs); the page keeps the cloud's
  own estimate (pull_speed_test.mjs, run_older_entries_ui.py).

## Round 1 findings, fixed in c9b3673fa (each with a test)

1. Speed only with the switch on (bridge and cloud). 2. A window answered with LINEERROR or no list is a failure, never
   0 entries; the per-day path's LINEERROR too. 3. A 2 s stop on a window or group stops the company's read as the
   per-day path does, the size kept as a cap. 4. Failed windows counted per day; after 2 the per-day path. 5. The
   company list asked again after a wait. 6. The older database function's fallback never records a fast day as night.
   7. Speed matched by book (company GUID), period fetch days only. 8. The 60 s wait when FinCom does not answer;
   window days keyed by phase. 9. Off is byte-identical to staging-next for the request table and the beat.

## Tests

- go vet (Linux, Windows) and go test ./... at 7357e3e36; node server/tally-cloud/periodpace_test.mjs; node
  tests/pull_speed_test.mjs; tests/run_older_entries_ui.py, run_check_changes_ui.py, run_tally_ledger_bar.py;
  release-check.sh. (tests/run_tally_simple.py fails one check, "Till today", after midnight IST on unchanged
  staging-next 13a0f7598 too; not this range.)

## Verdict

Ship, with FastEntries off. Switching it on for any computer waits for the measurement of section 9b.
