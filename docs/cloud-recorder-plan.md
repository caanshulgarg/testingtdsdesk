# Cloud side of the recorder: bursts, schedules, large uploads (plan, 04-Oct-2026; built after the trial)

## 1. Bursts: 2,000 recorder lines after a bulk posting
Measured on 04-Oct-2026 on a throwaway database built like run_migration44:
- the machine: this container, 4 CPUs, Postgres 16 with fsync on;
- the copy: 3,000 existing entries;
- the lines: 2,000 entries of 2-4 lines each, parsed by index.ts's own code;
- the median of 3 runs.
Scripts are in the session scratchpad (burst/).

| Path | Total for 2,000 | Per line | What one 500-line request waits for |
|---|---|---|---|
| Direct, 4 x 500 | 10.8 s | 5.4 ms | 2.6-3.9 s (up to 9.5 s when all fall on one day) |
| Direct, 40 x 50 | 11.0 s | 5.5 ms | 0.39 s per 50 |
| Direct, all on one day | 29.4 s | 14.7 ms | up to 9.5 s |
| Queue (pgmq), 4 messages of 500 | worker 11.8 s, in the background | 5.9 ms | 0.1-0.15 s (parse + send) |
| Short lines (FinCom's own entries), 4 x 500 | 1.6 s | 0.8 ms | 0.5 s |

- The edge function's own CPU is not the limit. Parsing 2,000 entries takes 0.16-0.3 s of CPU, against the 2 s per request.
- The database time is the limit, about 5.5 ms per full line.
- 40 % of that is the ledger-day cache, which is rebuilt once per line.

Recommendation:
- **The queue for full lines.** tally-ingest stores the request as one pgmq message of up to 500 parsed lines and answers
  the bridge "queued" at once. Per-line results come later through tally_recorder_lines, which Sync activity shows live.
  The worker applies one message per step. pg_cron calls a SQL drain function directly, with no HTTP hop.
  A 2,000-line burst is applied within about 12-45 s.
- **Small requests stay direct:** 50 lines or fewer, or short lines only.
- **The database fix:** rebuild the day cache once per call for all the days touched, not once per line. That takes about
  40 % off and removes the slow one-day case.
  - **The owner's condition (04-Oct):** this changes how the totals behind every report are produced, so its report gives,
    for the test book, before and after the change, the trial balance and the hash of the full tally_ledger_day content
    (every row: ledger, day, amount, dr, cr, n, sorted). It does so for three sends: a single entry, 500 lines on one day,
    and a send spanning 30 days.
  - All of them must be identical between the old way (once per line) and the new way (once per send). The test fails
    otherwise.

## 2. Scheduled jobs
- **What staging already has:** Supabase Pro, with pg_cron 1.6.4, pg_net 0.20.4, pgmq 1.5.1 and Vault, all in use. Five
  timers already run: the queue worker every 30 s, the posting requeue every minute, the nightly backup and two GST jobs.
- **The gap check:** pg_cron every 10 minutes runs tally_recorder_gap_check from the last heartbeat values.
- **The silent-PC check:** pg_cron every 30 minutes, 09:00-19:00 IST, Monday to Saturday, runs tally_recorder_silent.
- **The 7 pm summary:** pg_cron at 13:30 UTC.
- **Where results go:** each job writes a row to a stored-alerts table, which the app shows and marks as read.
- **Outside services:** e-mail or WhatsApp delivery needs a provider and its key, which we don't have. It is in-app first.
- Nothing is needed from the owner except running the migration.
- **The rule (owner, 04-Oct):** each scheduled job reads, and writes alert rows only. None calls Tally or a bridge; none
  changes an entry, a line, a ledger, a cursor or a posting.
  - Test: run every job on the test database and compare a hash of every other table before and after. Only the
    alerts table may differ.
  - The jobs' functions get no grant to write elsewhere.

## 3. Large Day Book uploads
- **Today:** the browser splits the file into days and hands it over in pieces of 4 MB or less. The page must stay open
  until the hand-over ends; the processing already runs from the queue.
- **Upload:** the browser compresses the file and uploads it to Storage with the resumable (TUS) upload, in 6 MB chunks.
  It resumes after a dropped connection and shows progress. Then one call starts the job; the page can be closed.
- **The worker:** reads the stored file in byte ranges of a few MB, each within the 2 s CPU limit, and cuts it into days
  on the existing queue (tally_work).
- **Progress:** the line "Day Book 2026-27: 143 of 365 days read" comes from the job row we already keep (tally_jobs). It
  shows words if a piece fails 5 times.
- **Duplicates:** the stored file is kept as the record. Uploading the same file twice doubles nothing, because every
  entry is keyed by its GUID.

None of this touches the add-on or asks Tally for anything.
