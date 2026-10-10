# Security review: FinCom Bridge 2.4.1 (the fallback by number, the bank route's state, received_at)

Reviewed: 09-Oct-2026, release-241 against the published 2.4.0 (tax-accuracy). Read only.

## What 2.4.1 does

- The fallback by number: a created or altered line whose MasterID gave an older entry (below the starting point) or no
  voucher is asked ONCE by its type and number with the existing FinComVoucherByNumber, on its first fetch; the
  narration taken is Tally's, never the line's. The bridge's log says which rule refused a request by number.
- The bank route's state (the add-on line count, the MasterIDs it read and the ones the last list named) kept in
  bankdate.json with the counter, so a restart reads and sends nothing again.
- tally-ingest keeps the bridge's received_at in the line's payload, an ISO time not more than 5 minutes ahead.
- BridgeVersion 2.4.1; the allow-list decision line, the notes and the test sheet.

The data-locations feature (the add-on's data folder, other_source lines, dataSources, migration 71, the Tally page's
card) is NOT in 2.4.1: it moves to 2.4.2, with its reviews. SR-M1, SR-M2, SR2-M1 and SR2-M2 of next-241 are open there
and belong to 2.4.2.

## What holds

- **No request added or changed.** The fallback sends FinComVoucherByNumber exactly as built (shape 2167477221dc); the
  allow-list table and its hash are unchanged; the add-on is unchanged from 2.4.0.
- **The fallback's guards.** One day, from the company's starting day to today, within 3 days or just asked; only an
  answer of exactly one voucher is taken; Tally's AlterID must be above the starting point (liveVoucherWrong, with the
  MasterID cleared); once a line, within the 20 s limit, giving way to a posting; a MasterID answer of another type,
  date or number keeps 2.4.0's hold (review M1 of next-241).
- **The bank state file.** A fixed name under the bridge's own folder, never taken as a path; read back with MasterIDs
  as digits only and at most 20,000 a company.
- **received_at.** Checked for its form and that it is not in the future before it is kept; kept in the line's
  payload only; the row's own received_at stays the cloud's time.
- **No cloud or app change** beyond that field: no kind, table, function, grant, policy or Realtime change; the Sentry
  scrubber and the app are unchanged.
- **No secrets** in the code, tests, fixtures or docs.

## Findings

- **SR-L1.** received_at has no lower limit (any past time is kept); nothing reads it but the payload. For the next
  release: a lower limit if anything comes to rely on it.
- **SR-L2.** The fallback relies on a type and number being one voucher a day: a line carrying a copied voucher's ids
  can be matched to another entry with the same type and number on that day. Bounded by the guards above.
- **SR-L3.** bankdate.json is written once per add-on voucher line (disk writes in a burst; no security effect).

The Lows go to the next release. The open findings of next-241 (SR-M1, SR-M2, SR2-M1, SR2-M2) are 2.4.2's.

## Re-review (10-Oct-2026), the upgrade fix, range 751c1795..dc54ac4d

**The failure.** The real-Tally upgrade check (run 37981697177, upg u2): the first start of 2.4.1 over 2.4.0's
bankdate.json (no addonN, addon or listed) read and sent again, once, an entry 2.4.0's add-on line had already sent.

**The fix** (0404e68c, 7e84f5e0: bridge-go/bankdate.go +30/-1 and bridge-go/bankdate241older_test.go). A saved company
without the addonN key is marked older. At its first light check or nightly turn its counter becomes Tally's counter now
(never below the starting point), the line count is cleared, pending entries are kept, and one log line is written.
Only those two files changed outside docs/. The revert of 5eaafd2f is exact: assets-test/ and the release log are as at
7c13c777.

**Checked.**
- **No request added or changed.** bankFromOlder asks nothing of Tally or the cloud. The allow-list table and its hash
  are unchanged (TestAllowListUnchanged; release-check step 4). One-in-flight, recorderTC's deadline, the 2-second rule
  and own-Tally-only (ownPortErr runs before the state is touched) are unchanged.
- **Prospective only.** The counter is clamped to the starting point. Pending entries and the self-check's own mark are
  not moved.
- **The state file.** It is still the fixed name sp("bankdate.json") in the bridge's own folder and is never taken as a
  path. The new code only checks whether a key exists. The MasterID limits (digits only, at most 20,000 a company) are
  unchanged. readJSONFile has no size limit (as before; the file is the bridge's own). A damaged file reads as empty,
  which is safe: everything starts from Tally's counter.
- **Logging.** The new line gives the company name and a counter (ALTVCHID), as the other bank-route lines do. No
  narration, amounts, GUIDs or secrets.
- **No AI**, no secrets, no cloud or app change.
- go vet (Linux, Windows) clean. go test ./... passes (939 s). The two new tests and all 28 TestBankDate* and
  TestSelfCheck* tests pass. release-check.sh: steps 1-4 pass (step 4: allow-list sha256 3dd32c7ff3379136, as expected); it stops at step 5 only because the review notes name 751c1795 (the files after it: bankdate.go and bankdate241older_test.go).

**Findings at dc54ac4d: 0 High, 1 Medium (correctness, no security effect), 1 Low.** (see below: M1 and L1 now closed)
- **M1 (see the code note; bankdate.go:181-191).** The older mark is not saved. A save before the company's first check
  in 2.4.1, then a restart, loses it, and the u2 re-read and re-send comes back (reproduced with a probe test). There is
  no security effect, and no request is made that is not on the allow-list.
- **SR3-L1 (bankdate.go:353).** With the self-check off, a bank date set in the upgrade stretch is never sent and
  nothing says so. This goes against "nothing silently dropped" in a narrow window. Suggest a log line naming it when
  selfCheckOn() is false.

**M1/SR3-L1 fixed in 897f393b** (tax-accuracy fb38cf5a; delta dc54ac4d..fb38cf5a: bankdate.go and its test only).
- **The older mark is kept on disk.** It is written as `"older": true`, without the line count, by every bankSave
  caller. The write is atomic (temporary file and rename). The mark is cleared only by the company's own first check
  (bankFromOlder) and is never written for a company 2.4.1 made.
- **The new field.** It is only compared with `true`; there is no new path or parse surface.
- **The new log line.** It gives the company name only.
- **Checks.**
  - The M1 probe was re-run and passes.
  - go vet clean on Linux and on Windows.
  - go test ./... passes (952 s).
  - 30 of 30 TestBankDate* and TestSelfCheck* tests pass.
  - release-check.sh steps 1-4 pass (allow-list sha256 3dd32c7ff3379136, unchanged); it stops at step 5 only for the
    notes' range.
- **Status.** M1 closed; SR3-L1 closed. No new security finding.

Range: 7c13c777..fb38cf5a
