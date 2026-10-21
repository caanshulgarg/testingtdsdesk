# FinCom Bridge 2.4.5 (branch next-245, from 2.4.4: staging-next ed0285027 with ROUND 101)

The owner's change and decisions of 21-Oct-2026 (ROUND 102): older entries come from Tally ONLY for a period the person
chooses in FinCom, one day at a time while Tally is idle; never a blanket fetch, and the Day Book report is not used for
it. Connect Tally's step 5 shows the exact ledger count. Exactly these Tally requests are added and nothing else is added
to any request: FinComDayHeads (a day's entry list), its per-voucher-type filter (only when a day's list passes 2 s), and
FinComLedgerIds (MasterIDs only, the rows counted), each EXACTLY as in docs/bridge-2.4.5-forms-for-owner.md.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.5.exe |
| Fingerprint | SHA-256 `2de26311a2827ced1a07b1406115bc2d93d01cd464c936826ab347b79b9fbfe8` (FinComBridge-Setup-2.4.5.exe, built 21-Oct-2026 15:11 IST; compare with the .sha256 file next to the setup); program SHA-256 `ed2e720b5d1fd5a8b7a2bb7198e24ade208f2096347fa60a31fadc21e2ab1961` |
| Replaces | 2.4.4 (kept on the computer, so the tray can roll back to it) |
| Published | not yet: the owner publishes after the report (migration 98 first, then tally-ingest, then the app and the setup) |

## What is in 2.4.5

1. **Older entries for a period the person chooses.** Books › From Tally, and Connect Tally after step 6, show "Bring older
   entries from Tally": a financial year (the last six), Whole year / Apr–Sep / Oct–Mar, Start, Pause, Resume. The halves are
   offered once the year is counted at more than 20,000 vouchers (the owner's decision). The cloud (migration 98) keeps the
   choice and hands the bridge, in the heartbeat's answer, at most three days at a time: first every day of the year to
   count (newest first), then the days of the part chosen that FinCom does not yet hold in full. For each day the bridge
   asks FinComDayHeads (GUID, MASTERID, ALTERID, DATE of that one day, SVFROMDATE = SVTODATE), sends the heads, and the
   cloud answers which entries it lacks (or holds at a lower AlterID); the bridge asks each with the existing
   FinComVoucherObject and sends them (`period_entries`, stored through tally_ingest_entries as live entries are). A day is
   done when FinCom holds every entry Tally lists for it. Progress: "8,412 of 12,960 vouchers (65%) · 4,548 left", the
   count built day by day (while counting: "Counting the year in Tally… 132 of 365 days"). Code: bridge-go/daypull.go.

2. **Over 2 s, one voucher type at a time.** When a day's list is stopped at 2 s, the same day is asked once per voucher
   type ($VoucherTypeName = the type; the six standard types and the book's own types the cloud lists). A type that still
   passes 2 s marks that day "upload by hand": the ONE quiet line the person sees, "Tally took too long to give 01-Jun-2026.
   Please upload that day's Day Book." with its Upload button (also a bell notice in the tray). A day whose rows carry
   another date, or an answer FinCom cannot read, gets the same kind of line ("FinCom could not read ..."). Nothing else
   about Tally is shown.

3. **The exact ledger count (Connect Tally step 5).** On the full ledger read (the "ledgers" wake) the bridge asks
   FinComLedgerIds once (MasterIDs only; when that one request is stopped at 2 s, in chunks of 2,000 MasterIDs) and counts
   the rows; the step shows "312 of 1,240 ledgers" as the read goes on (never going back within a round; the cloud's
   tally_ledger_progress). Code: bridge-go/ledcount.go.

4. **The add-on loaded at Tally's start (installer and per-user update).** For each TallyPrime found (the folders the
   bridge already knows, and Program Files\TallyPrime*), tally.ini gets `TDL = C:\ProgramData\FinCom\addon\FinComRecorder.tdl`
   after the last TDL line of its [Tally] section, and `User TDL = Yes` only if it has no User TDL line. A backup
   tally.ini.fincom-bak is written once (never overwritten); the file's encoding and line endings are kept; nothing is
   removed or reordered; a second run changes nothing. A tally.ini with `User TDL = No` is left untouched (the owner's
   default, decision pending) and reported in the heartbeat (`tallyIni`) for Help & support. The per-user worker and the
   service apply it again after an automatic update (marker fincom-tallyini-version.txt). Code: bridge-go/tallyini.go.

5. **Job files that never lose an update.** progress.json and the job files are written to a unique temporary file and
   replaced atomically, retried up to 24 times when Windows holds the file; an update that still cannot be written is kept
   and written later (never lost). The reader shares the file for read, write and delete and retries a missing or locked
   file. Code: bridge-go/jobfile.go; tests: r245jobs_test.go (reader and writer at once, run on Windows CI too).
   The old PowerShell bridge (bridge/TDSBridge.ps1, still 1.15.0) writes its progress the same way ([IO.File]::Replace,
   PowerShell 5.1-safe), and review/assets/connector/TDSBridge.ps1 is no longer shipped by publish (build.py drops it;
   publish-preview.sh refuses a build that carries it).

## The rules kept (plan section 3.2 and 6)

Every Tally request stops at 2 s; one request in flight per Tally; postings first (no day is asked while a posting or an
import is going); idle only (Tally running and answering, its window not hung, nobody
typing in Tally in the last 60 s, the retry schedule and the live queue clear, the company open by this Windows user, the
start point recorded); no AI in the bridge or the add-on; every Tally condition silent except the one "upload this day"
line. The bridge asks only days the cloud listed now (the ReadDays exception is per day, never a range).

Measured on real TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (tally-versions mode dbbig, run 39542962661, 30,009 entries,
50,000 ledgers; GitHub runners, not NWS144): FinComDayHeads one day of 2,216 entries 376 ms worst; one voucher type of a
day 1,080 ms worst (4.1, 503 Purchase entries); FinComLedgerIds 50,000 ledgers 405 ms worst. The allow-list carries 1.1 s
for FinComDayHeads (the per-type form's worst, not the plain day's 0.38 s).

## The cloud (migration 98, add-only; tally-ingest)

Migration 98 (`server/tally-cloud/migration-98-period-pull.sql`): tally_period_pulls, tally_period_days,
tally_ledger_progress (RLS on, service_role only, explicit GRANTs per ROUND 101) and thirteen functions (the app's
tally_period_choose / pause / status for signed-in members of the book's firm; tally-ingest's tally_period_next / heads /
upload / entries and tally_ledger_progress_save, service role only; five helpers nobody may call). tally-ingest: the
heartbeat answer carries `periodDays`; new kinds `period_heads`, `period_entries`, `ledger_progress`; the beat keeps
`tallyIni` and `periodPull`. Without 98 tally-ingest says nothing of older entries and the beat goes on as before.
Tests: run_migration98.py, run_period_ingest.py, run_older_entries_ui.py.

## Not in 2.4.5

- `User TDL = No` is not changed (the owner's decision pending); FinCom reports it only.
- assets/connector/latest.json still names the old PowerShell bridge at the staging root (signed; left as it is).

## Checks

go vet (Linux and Windows), go test, release-check steps 1-6, CI and Windows CI, the real-Tally gate on the committed setup
(tally-versions upg from 2.4.4 and g245 on all five releases).
