# 8. Backup and business continuity

Owner: Anshul Garg · Version 0.1 draft, 27 Sep 2026

## 8.1 Targets

| | Target |
|---|---|
| Recovery point: at most this much data may be lost | 24 hours (nightly backup). Minutes if Supabase point-in-time recovery (PITR) is on. |
| Recovery time: service back within | 4 working hours; 1 hour in the 5 days before a TDS or GST due date |

## 8.2 What is backed up

| What | How | Kept |
|---|---|---|
| Firm data: clients, records, books, members | `take_backup()` nightly at 01:00 IST (cron `tds-desk-nightly-backup`) into `backups` | Last 14 per firm |
| Whole database | Supabase daily backups. Add PITR on live, which is a paid add-on. | 7 days on Pro; PITR as configured |
| Documents (storage bucket `client-docs`) | Supabase storage. **Add** a weekly copy to a second place (for example an encrypted archive on the firm's Google Drive). | 8 weeks |
| Code | GitHub, plus the owner's Mac clone | Full history |
| Tally data | The client's own Tally backup. The bridge's nightly copy (day book and balances) is a convenience, not a backup. | Client's policy |

## 8.3 Restore test (quarterly)
1. On staging, read one firm's latest backup with `backup_data(id)`.
2. Load it into an empty staging firm, and check the counts of clients, records and books against the backup's own counts.
3. Time it. Record the date, the result and the time taken.

## 8.4 If Supabase is down
- Each signed-in computer keeps its working copy, so staff keep working. Sync resumes on its own when Supabase is back.
- Posting to Tally still works: it goes through the bridge and does not need the cloud.
- Claude and Google reading need the gateway. Built-in OCR still works.
- Tell firms by email or WhatsApp, with the expected time.

## 8.5 If GitHub Pages is down
- The live site is a single file. It can be served from any static host at short notice: Cloudflare Pages or Netlify, with `_headers` already in the repository.
- Keep a second host configured and tested once a year.

## 8.6 If the owner is unavailable (key person)
- A sealed note of the recovery steps, the console logins and the two-step recovery codes is kept with a director in a safe.
- `docs/` explains build, test and release.

## Evidence
- The restore test records.
- The Supabase backup settings.
- The sealed-note register.
