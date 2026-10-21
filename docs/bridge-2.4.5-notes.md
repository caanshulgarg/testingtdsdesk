# FinCom Bridge 2.4.5 (branch next-245, from 2.4.4: staging-next ed0285027 with ROUND 101)

The owner's change and decisions of 21-Oct-2026 (ROUND 102): older entries come from Tally ONLY for a period the person
chooses in FinCom, one day at a time while Tally is idle; never a blanket fetch, and the Day Book report is not used for
it. Connect Tally's step 5 shows the exact ledger count. Exactly these Tally requests are added and nothing else is added
to any request: FinComDayHeads (a day's entry list), its per-voucher-type filter (only when a day's list passes 2 s), and
FinComLedgerIds (MasterIDs only, the rows counted), each EXACTLY as in docs/bridge-2.4.5-forms-for-owner.md.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.5.exe |
| Fingerprint | SHA-256 `d39e146b92e4b5ea10cf04e84c7ad8ee230025d4ac80122767238a00fc1227a6` (FinComBridge-Setup-2.4.5.exe, built 21-Oct-2026 23:19 IST; compare with the .sha256 file next to the setup); program SHA-256 `b1c1ea76c728e7888ea8f5cd2f38d293b61e04f73736dd5fa467fff633373e07` |
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

2. **Freeze safety (ROUND 103, the owner's decision of 21-Oct-2026; replaces the by-type split of the first build).** A
   day's list stopped at 2 s, or Tally's window not answering for 2 s or more while it is at Tally (the bridge watches the
   window: WM_NULL every 200 ms with a 250 ms limit, nothing sent to Tally's port), STOPS reading older entries of that
   company: FinCom is told (period_stop), lists no more days of the period, and shows ONE quiet line, "Tally took too long
   to give 01-Jun-2026, so FinCom stopped reading older entries of <company>. Please upload the Day Book for the days still
   missing." with its Upload button (also a bell notice in the tray). It is never retried by itself: only the person
   choosing the period again in FinCom starts it again. The by-type form is no longer sent (it stays on the allow-list as
   approved). A day whose rows carry another date, or an answer FinCom cannot read, gets the one-day line ("FinCom could not
   read ..."). Nothing else about Tally is shown.

2a. **Off by default, per computer (ROUND 103).** Reading older entries runs only on a computer whose owner switched it on
   on FinCom's Tally page ("Reading older entries on this computer: on / off"; tally_devices.period_fetch, migration 98,
   owner only; staff see the state). The heartbeat answers periodFetch; while it is off no day is listed or read.

2b. **"Test reading old days (read-only)", a tray item (ROUND 103).** Before the switch goes on, the owner checks his own
   licensed Tally: the tray suggests the smallest company open (he says yes to one), and the bridge asks FinComDayHeads (the
   same approved form) for three days of the month before (the 1st, the 15th and the last day), one at a time, each under
   the 2 s stop, Tally's window watched; a stop ends the test there. The rows are counted only: nothing is kept, stored,
   posted or sent but the result, which the heartbeat carries to the Tally page: "Old-days test on <PC>: 0.21 s / 0.34 s /
   0.18 s · no freeze" (or the reason it stopped). Started by a person only: a web page is refused. Code: bridge-go/oldtest.go.

2c. **Night and Sunday pace (ROUND 103, the owner's decision of 21-Oct-2026, evening).** Outside office hours (20:00 to
   08:00 IST and all Sunday by default; an owner changes them per computer on FinCom's Tally page, "Faster reading of older
   entries outside office hours"; tally_devices.period_night_from / _to / _sunday, migration 98, tally_device_period_night,
   owner only) tally-ingest answers periodNight and lists up to 30 days a heartbeat (3 by day). The bridge then reads day
   after day while Tally is idle: up to 400 requests a turn with no rest between them (each one still after the six
   conditions, under its 2 s stop, one in flight, postings and saves first, the freeze safety), 200 entries a call to
   FinCom, and as soon as the listed days are done it asks FinCom for the next ones (an early heartbeat, at most one every
   10 s). The per-computer switch still wins. The progress line shows the time left at the pace FinCom hands days out now,
   from the last 30 minutes' speed ("8,412 of 12,960 vouchers (65%) · 4,548 left · about 1 h 40 min left at night pace";
   none while paused or stopped). Books › From Tally adds: "For a big company's first load, export the Day Book from Tally
   (Alt+E) and upload it here — minutes instead of hours." Hands-free reading is for gaps and small or medium clients.

2d. **Payroll in the older entries (ROUND 103, the owner's ask; his decision of 12-Oct-2026 kept).** A payroll voucher
   listed by FinComDayHeads (its type Tally's own Payroll, or a type this bridge has seen carrying employees' pay heads) goes
   through the 2.4.4 payroll path: FinComVoucherObject, every employee's pay-head allocations kept, a salary payment's
   BANKEMPLOYEENAME and AMOUNT only, the bank details stripped. Its entry request may take 3 s and its freeze-safety
   threshold (Tally's window not answering) is 3 s; every other request 2 s. Before the first payroll entry of the period
   the payroll's employees (FinComEmployees, 2.4.4's read) are read and taken by FinCom, so the entry's employee rows link;
   until then the payroll entry waits. A payroll voucher counts in the progress like any other. A custom payroll voucher
   type the bridge has not yet seen carrying pay heads keeps the 2 s limit on its first entry (as in 2.4.4).
   **The owner's decision of 21-Oct-2026 (review round 15, L3): YES — payroll vouchers only may hold Tally's window up to
   3 s, the same as their 3 s request stop; everything else stays 2 s** (FinComDayHeads, every other entry, and the
   employees' read inside the period fetch). Tests: TestR245PullPayrollWindowThreshold, TestR245R15EmployeesOver2sStops.
   Review round 15 (M1, M2, L2): while the employees are not in FinCom the day's other entries are read first; the
   employees are read one request a step, each after the six conditions (pause and read-stop included), Tally's window
   watched, and a request over its 2 s stop or a window held 2 s stops the company (never retried by itself); they are
   looked up for the day's own company GUID; the wait is bounded (3 tries a minute apart, 10 minutes a day: settings
   EmployeeWaitTries, EmployeeWaitMin), then what was read is sent, the day's payroll entries are left out and the day
   gets the one quiet "upload this day" line naming the payroll, and the other days and companies go on.

3. **The exact ledger count (Connect Tally step 5).** On the full ledger read (the "ledgers" wake) the bridge asks
   FinComLedgerIds once (MasterIDs only; when that one request is stopped at 2 s, in chunks of 2,000 MasterIDs) and counts
   the rows; the step shows "312 of 1,240 ledgers" as the read goes on (never going back within a round; the cloud's
   tally_ledger_progress). Code: bridge-go/ledcount.go.

4. **The add-on loaded at Tally's start (installer and per-user update).** For each TallyPrime found (the folders the
   bridge already knows, and Program Files\TallyPrime*), tally.ini gets `TDL = C:\ProgramData\FinCom\addon\FinComRecorder.tdl`
   after the last TDL line of its [Tally] section, and `User TDL = Yes` only if it has no User TDL line. A backup
   tally.ini.fincom-bak is written once (never overwritten); the file's encoding and line endings are kept; nothing is
   removed or reordered; a second run changes nothing. A tally.ini with `User TDL = No` is left untouched (the owner's
   default) and reported in the heartbeat (`tallyIni`) for Help & support. The per-user worker and the service apply it
   again after an automatic update (marker fincom-tallyini-version.txt). ROUND 103: every known tally.ini is looked at
   again, read only, at each start of the bridge and every 6 hours, so a `User TDL = No` put in later is reported too
   (states already / notadded / usertdl-no); the re-check never writes. Code: bridge-go/tallyini.go.

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
Review round 15: tally-ingest asks `tally_period_next_paced` only for the days left of the answer (every day stamped as
handed out is handed out; the pace said apart), the time left's speed is measured from each day's first hand-out
(`first_asked_at`, never overwritten), and a computer is handed at most one list of days every 5 s
(`tally_period_gate`; the key is left out otherwise, so the bridge keeps what it reads). A day whose payroll entries
were left out is kept with why "payroll".
Tests: run_migration98.py, run_period_ingest.py, run_older_entries_ui.py.

## Not in 2.4.5

- `User TDL = No` is not changed (the owner's decision pending); FinCom reports it only.
- assets/connector/latest.json still names the old PowerShell bridge at the staging root (signed; left as it is).

## Checks

go vet (Linux and Windows), go test, release-check steps 1-6, CI and Windows CI, the real-Tally gate on the committed setup
(tally-versions upg from 2.4.4 and g245 on all five releases).
