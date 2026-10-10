# FinCom go-live checklist

Written 10-Oct-2026 from the repository only. Nothing here has been run on live, and no tool has read the live database.
"Live" means app.fincom.live and its Supabase project. Its id is never written here: a hook blocks it.
"Staging" means staging.fincom.live and project `qbocskaiewaxqcvaunzc`. The plan has three parts: this checklist, then a rehearsal on a copy, then the go-live together. The owner opens the
go-live window by lifting the hook himself, and closes it by putting the hook back.

## 1. What differs between staging and live

### 1.1 The database: what live has, and what it needs

Live runs Build 199 (30-Sep-2026, bridge 1.14.6, the posting queue). That build came with these files, which live
should already have: `security/migration-1-functions.sql` (03b45bc3…), `security/migration-2-mfa-audit.sql` (d387f6b8…),
`books-sync/migration.sql` (ad7ed5c2…), `support/migration.sql` (5eabc7a5…), `tally-cloud/migration.sql` (06f4b44c…),
`-2-hardening` (cd33c652…), `-3-lookup` (3d41eb87…), `-4-want` (e8036cae…) and `-5-post-queue` (58dc3b13…). Under
them is the base schema: 14 dashboard migrations (`tds_desk_core` … `nightly_backup_schedule`).

**Confirm this first.** The owner pastes this read-only query into live's SQL editor and sends back the result:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
select extname, extversion from pg_extension order by 1;
select jobname, schedule from cron.job order by 1;             -- fails if pg_cron is off: that is an answer too
select table_name from information_schema.tables where table_schema = 'public' order by 1;
select id from storage.buckets order by 1;
```

The list below starts after Build 199. It follows the fresh-database order in `docs/MIGRATION-ORDER.md`, which
`tests/run_migration_order.py` checks. Anything the inventory shows live already has is skipped. That gives **67 files: 66 to run, plus 31 for the owner to decide**. Add `gst-taxpro/schema.sql` (3adf1dc2…) if live has
no `gst_sessions` table. Its header says "apply the same on live before gst-taxpro goes there", and it also names
staging's address, so it is edited first like 13 and 16.
Every md5 is `md5sum` of the file on tax-accuracy at the commit of this document; 61's comes from branch `perms-61`.
Folders are under `server/`. "Edit first" means the file names staging's web address in a pg_cron job. Before it runs
on live, Claude puts live's address in, prints the new md5 and the diff, and the owner approves both.

| Step | No. | File | md5 | Note |
|---|---|---|---|---|
| 1 | 3 | `security/migration-3-phase2.sql` | `dd82d4d31e9fc5f541ae1be9053b86e1` | staging ran it as 3 parts (phase2_1..3) |
| 2 | 4 | `security/migration-4-revoke-grants.sql` | `5ce51578cefe818e12c657c64ce20199` |  |
| 3 | 6 | `tally-cloud/migration-6-groups-gst.sql` | `ef08912c31357f89d37da614af9e2521` | delete from: inside a function only |
| 4 | 7 | `tally-cloud/migration-7-bills.sql` | `e970b369c413addaf8b6c1a17abb6df6` | delete from: inside a function only |
| 5 | 8 | `tally-cloud/migration-8-year-openings.sql` | `11a318d62a21a188c67d983fe86175a9` | delete from: inside a function only |
| 6 | 9 | `tally-cloud/migration-9-ledger-twins.sql` | `b244505c209bd0d11a4683a2dafeeb11` |  |
| 7 | 10 | `tally-cloud/migration-10-find-optional.sql` | `70dabadba7d98e9bcee7450481241a42` |  |
| 8 | 11 | `tally-cloud/migration-11-ref-cmp.sql` | `0ff4296c3da61c4bc5e8140956762c03` | delete from: inside a function only |
| 9 | 12 | `books-sync/migration-12-live-items.sql` | `f9b346bbd1dc4e417ec5838f21d045f5` |  |
| 10 | 13 | `tally-cloud/migration-13-fast-sync.sql` | `d142e44b596319a1e39fed77657e0929` | **EDIT FIRST**: cron `tally-work` names staging's address; makes queue `tally_work`, crons `tally-work`, `tally-post-requeue`, vault `tally_work_key`; sets `tally_devices.wake_token` on every row |
| 11 | 14 | `tally-cloud/migration-14-reports.sql` | `afd306f7a4c986374669c1a7131c17d8` |  |
| 12 | 15 | `tally-cloud/migration-15-books-live.sql` | `de5dae0db4fd08441a29366fbe1adb24` |  |
| 13 | 16 | `gst-taxpro/migration-16-tax-accuracy.sql` | `00463f7e91b27e49fcf41c7c1e7bea9e` | **EDIT FIRST**: cron `gst-daily` names staging's address |
| 14 | 17 | `books-sync/migration-17-trash.sql` | `7a01401466398905161c22005d9695a7` |  |
| 15 | 18 | `tally-cloud/migration-18-gst-books.sql` | `2df63aba438de6968e42220d40149541` | delete from: inside a function only |
| 16 | 19 | `security/migration-19-sync-guard.sql` | `dd4c2e68b0687e116042c246a941b8e6` | delete from: inside a function only |
| 17 | 20 | `tally-cloud/migration-20-ledger-names.sql` | `7194eb9164463426f24f33beed4815cf` |  |
| 18 | 21 | `security/migration-21-firm-name.sql` | `6569965f8b8934a72cc2306427ac7068` |  |
| 19 | 22 | `tally-cloud/migration-22-main-bridge.sql` | `eedf48ecd2fac2691281f08af2142af1` |  |
| 20 | 23 | `tally-cloud/migration-23-clean-names.sql` | `7b73b6eb0faae107a9157bc4e395615a` | **CHANGES DATA**: cleans ledger/party names in the cloud copy; top-level `delete from tally_ledger_day` then rebuilds those days |
| 21 | 24 | `tally-cloud/migration-24-posting-guard.sql` | `ce7b5fbee6eff2bb3c8b4a8ac81b388b` |  |
| 22 | 25 | `security/migration-25-clear-ids.sql` | `d43411d6bd81627e643ba388e01e0dab` |  |
| 23 | 26 | `tally-cloud/migration-26-post-dismiss.sql` | `63dcd783bfab8ce229a080fd53ca12e7` |  |
| 24 | 27 | `tally-cloud/migration-27-post-record.sql` | `4988466f5599fa2c7712ddd8203b7f4d` | **CHANGES DATA**: sets `postTo` on clients whose one Tally company has the same GSTIN |
| 25 | 28 | `tally-cloud/migration-28-ledger-ids.sql` | `12a0901fd5ef8cfb78172f2ecf90f94c` |  |
| 26 | 29 | `security/migration-29-backups-history.sql` | `484b2c1997ea781c10befb96f18a87a1` | delete from: inside a function only |
| 27 | 30 | `security/migration-30-client-keys-kept.sql` | `321de21d22027a5336def15d380774bd` |  |
| 28 | 31 | `tally-cloud/migration-31-clean-names.sql` | `45ed0b283c274132b3dc27abdd9527c8` | **NOT run on staging** (no `raw_name` column there). Leave out unless the owner decides; it rewrites names |
| 29 | 32 | `tally-cloud/migration-32-sync-safety.sql` | `a04b1c71802bce5b7231306f63c393d6` | **CHANGES DATA**: `tally_vouchers.origin` = 'fincom' where the narration has a TDSDesk id |
| 30 | 33 | `tally-cloud/migration-33-ledger-lists.sql` | `1d64b0145738d7358d4ce42c63ecf0ca` |  |
| 31 | 35 | `tally-cloud/migration-35-bridge-control.sql` | `d13b234cbdb5e3429e23389acef742bd` | never run again after 34 |
| 32 | 34 | `tally-cloud/migration-34-ledger-safety.sql` | `1e29f3a8da71d67736dc65369d9828e5` | the REVIEWED text (staging has the first text, 2105b2d) |
| 33 | 36 | `tally-cloud/migration-36-ledger-rename.sql` | `166f1096cbb9226a80af196fa54119ae` | names staging only in a comment |
| 34 | 36b | `tally-cloud/migration-36b-post-acceptance.sql` | `4047c54c5cbf49e64358d755b36ba9a4` |  |
| 35 | 37 | `tally-cloud/migration-37-follow-ups.sql` | `de90f9101c304dc19d700e13b200dcff` | **CHANGES DATA**: backfills `fincom_id` / `origin`; delete from inside a function |
| 36 | 38 | `tally-cloud/migration-38-post-followups.sql` | `392da8a4ee657eec46af63826c540ae0` | delete from: inside a function only |
| 37 | 39 | `tally-cloud/migration-39-rename-map-empty-day.sql` | `07949919a81d81b9494c35c6b30ee16b` | delete from: inside a function only |
| 38 | 40 | `tally-cloud/migration-40-states-carried.sql` | `028081bc10d67ec3ad774943ae2ef60b` |  |
| 39 | 41 | `tally-cloud/migration-41-day-counts.sql` | `b432a6a6c05e5bfe4fb9eec95064fe22` | delete from: inside a function only |
| 40 | 42 | `tally-cloud/migration-42-empty-day-second-read.sql` | `473cf65d81adfd472e57c144da3c3105` | delete from: inside a function only |
| 41 | 43 | `tally-cloud/migration-43-posting-reply.sql` | `2c52a35f3b90eb0e5e192790ed42d4d3` | owner ran it in the SQL editor; delete from inside a function |
| 42 | 44 | `tally-cloud/migration-44-recorder.sql` | `81d51d1e05aa8f5f447274f85d0831c4` | owner ran it in the SQL editor; delete from inside a function |
| 43 | 45 | `tally-cloud/migration-45-bulk-posting.sql` | `efc9a03b8591502668225376f42352a8` |  |
| 44 | 46 | `tally-cloud/migration-46-trial-tools.sql` | `87f459be616d0a81f31b8d4cc6f42a96` |  |
| 45 | 47 | `tally-cloud/migration-47-recorder-queue-alerts.sql` | `8f92184de8faf1aa93eeda7b732194cf` | queue `tally_recorder`; crons `tally-recorder-drain`, `tally-alert-gaps`, `-silent`, `-summary`; bucket `tally-uploads` |
| 46 | 48 | `tally-cloud/migration-48-day-cache-once.sql` | `f4d876f13049a08515d7886d28c824fd` | **owner runs it in the SQL editor** (delete from in a function); cron `tally-recorder-archive-trim` |
| 47 | 49 | `tally-cloud/migration-49-post-row-flags.sql` | `42f74f61479fcdca171c9d304035e3d7` |  |
| 48 | 50 | `tally-cloud/migration-50-recorder-held.sql` | `9cd910b3c74f7af3d57774211966bfc8` | **owner runs it whole in the SQL editor** (the tool timed out on staging); updates held lines |
| 49 | 51 | `tally-cloud/migration-51-recorder-ids-mismatch.sql` | `4b0f920352d8dd8f54144b56ea8364e3` | updates held recorder lines (none on live) |
| 50 | 52 | `tally-cloud/migration-52-recorder-duplicate-needs-same-entry.sql` | `34ae5f2e6c4b0e9e775c3f2b7c235791` | updates held recorder lines (none on live) |
| 51 | 53 | `tally-cloud/migration-53-recorder-placeholder-settled.sql` | `c1226e6377df50960cd53b8e5f22781d` | updates recorder lines (none on live) |
| 52 | 54 | `tally-cloud/migration-54-post-target-bridge.sql` | `96318bf965a63180e6f22cb19e4281bd` |  |
| 53 | 55 | `tally-cloud/migration-55-settle-and-lease.sql` | `68711988926cd6cfae121cdade5d81bc` | owner pasted it on staging (tool timeout) |
| 54 | 56 | `tally-cloud/migration-56-keep-fields.sql` | `0f8456c18349c961d3d296d9da7819e5` |  |
| 55 | 57 | `tally-cloud/migration-57-entry-details.sql` | `8aa48ece4603360d12ab0fb04d42f03a` |  |
| 56 | 58 | `tally-cloud/migration-58-lows.sql` | `db5b429519308c9768f6e6e6befee08a` |  |
| 57 | 59 | `tally-cloud/migration-59-ledger-aliases.sql` | `882de3e601fb7b57a370ab275cbb61b9` |  |
| 58 | 60 | `tally-cloud/migration-60-recorder-lows.sql` | `adbec22537f274cc5deaf170a339095f` |  |
| 59 | 61 | `tally-cloud/migration-61-privileges.sql` | `cec075a148f26144fd1808c94b841684` | **only on branch perms-61** (not in tax-accuracy's tree): bring the file over first; closes members self-promotion |
| 60 | 68 | `tally-cloud/migration-68-alert-dismissals.sql` | `184e795994242b41f4edbaaaa7d530f9` | owner ran it in the SQL editor |
| 61 | 70 | `tally-cloud/migration-70-alert-dismissals-tighten.sql` | `3457411cc0bacfdbdc174191e0629b63` |  |
| 62 | 62 | `tally-cloud/migration-62-tds-rate-worked-out.sql` | `bcdfd7b72b1d69b429e6b15a5e9652c6` |  |
| 63 | 67 | `tally-cloud/migration-67-recorder-renumbered.sql` | `78676805ebdaf9b24e41bc2708ed0a90` | tested fresh order runs 67 before 63 (staging ran 63 first) |
| 64 | 63 | `tally-cloud/migration-63-recorder-repeat.sql` | `ff8011351b8856025710b68bad0b690c` |  |
| 65 | 64 | `tally-cloud/migration-64-pages-live.sql` | `0a91d37ab313331399dffdaf677de9e6` |  |
| 66 | 65 | `tally-cloud/migration-65-selfchecks.sql` | `51a224cf8e00b7a46da42da4694e8993` |  |
| 67 | 66 | `tally-cloud/migration-66-recorder-masters.sql` | `fea953435146ec8bdc3e77c5808e1714` |  |

- Some files contain the words "delete from". In 6–11, 18, 19, 29, 37–44 and 48 the words are inside a function, so the
migration itself removes no rows. Only 23 deletes rows when it runs: it deletes `tally_ledger_day` rows and builds the
same days again. In 31 the delete touches a temporary list only.
- Live has real data in the cloud copy, and these files change it as they run: 13, 23, 27, 32 and 37. In the rehearsal,
Claude takes counts and totals before and after each of them.
- The SQL editor rule: 43, 44, 48, 50, 55 and 68 were run by the owner in the SQL editor on staging. On live, 48 and 50
must be run that way, by the owner. The others may go in md5-checked pieces as on staging (`docs/HANDOVER.md`, "How to
apply a migration").
- **Extensions live needs** (staging has these): pg_cron 1.6.4, pg_net 0.20.4, pgmq 1.5.1, supabase_vault 0.3.1, pgcrypto
and uuid-ossp. The owner switches on any that are missing (Database → Extensions) before step 4 below.

**pg_cron jobs after the migrations** (as on staging; `tds-desk-nightly-backup` should already be there; times UTC):
`tally-work` every 30 s and `tally-post-requeue` every minute (13, edited); `gst-taxpro-refresh` */20 and `gst-daily`
01:30–05:30 hourly (schema.sql and 16, both edited); `tally-recorder-drain` every 30 s, `tally-alert-gaps` */10,
`tally-alert-silent` */30 03–13 Mon–Sat, `tally-alert-summary` 13:30 (47); `tally-recorder-archive-trim` 21:17 (48).
**pgmq queues:** `tally_work` (13) and `tally_recorder` (47). **Vault:** `tally_work_key` (made by 13) and `gst_cron_key`
(made by schema.sql). **Buckets:** `support-files`, `tally-days` and `tally-support` (should be there already), and
`tally-uploads` (47).

### 1.2 Edge functions (staging versions, read 10-Oct)

Deploy each one with the files listed in `server/_shared/README.md`. Always include `../_shared/cors.ts`. Before deploying, the owner
writes down live's current version of each function: that is the way back.

| Function | Staging | Source | Note |
|---|---|---|---|
| tally-ingest | v43 | server/tally-cloud (index.ts, parse.js, _shared/cors.ts, names.js, sentry.ts, sentry-scrub.js) | the index.ts deployed with comments stripped, SHA-256 82d4e873…18f7 (docs/bridge-2.4.1-notes.md); verify_jwt off |
| signin | v3 | server/security/functions/signin | new on live |
| admin | v14 | server/security/functions/admin | invite links go to `APP_URL`, which **defaults to staging**: set it on live |
| gateway | v13 | server/security/functions/gateway | bill reading (Claude, Google Vision) |
| gst-taxpro | v19 | server/gst-taxpro | |
| gst-api | v10 | server/gst-api | uses fyn-relay |
| support-mail | v10 | server/support-mail | |
| signup | v10 | **not in the repository** | leave live's own as it is |
### 1.3 Secrets and settings (names only)

- **Function secrets:** `APP_URL` = https://app.fincom.live/ (admin, support-mail); `INVITE_MAIL_FROM`,
  `RESEND_API_KEY`, `SUPPORT_MAIL_FROM`, `SUPPORT_MAIL_TO`; `ALLOWED_ORIGINS` (optional); `FYN_BASE_URL`,
  `FYN_CLIENT_ID`, `FYN_CLIENT_SECRET`, `FYN_RELAY_URL`, `FYN_RELAY_KEY`; `TAXPRO_ASP_ID`, `TAXPRO_ASP_PASSWORD`,
  `TAXPRO_BASE_URL`, `TAXPRO_EINV_URL`, `TAXPRO_TRACK_PATH`, the `TAXPRO_EINV_TEST_*` set; `TALLY_UPLOAD_PIECE`,
  `TALLY_UPLOAD_MAX_TAIL`, `TALLY_WORK_VT` (optional). Supabase fills the `SUPABASE_*` secrets itself.
- **Vault:** `gsp:taxpro:aspid`, `gsp:taxpro:password` and `connector_signing_passphrase`, as on staging.
- **Platform keys (FinCom admin):** `claude_api_key` and `google_vision_key`.
- **Auth:** Site URL https://app.fincom.live/, with redirect `https://app.fincom.live/**`. Apply the settings in
  docs/security/14-owner-actions.md item 4.
- **Resend:** the domain fincom.live must be verified there.

### 1.4 The app build that points at live

- **How the database is chosen.** The source in `src/js` stays in its live form: `CLOUD_DEFAULT` names live's
  database. `build.py` checks this. `python3 build.py --react` writes `app/legacy/live.js` (live) and `test.js`, and in
  `test.js` only it swaps in staging's address and key (`to_test`). `npm run build` (in app/) makes `app/dist` with
  live.js. `npm run build:test` makes `app/dist-test` with test.js.
- **The guard.** `app/publish-preview.sh` builds only dist-test and refuses to push unless `legacy.js` names staging
  and not live. **There is no live publish script yet.** For live, the same check runs the other way: dist's
  `legacy.js` must name live and must not name `qbocskaiewaxqcvaunzc`.
- **Build from the staging commit.** Build from the commit staging shows: pub-241 601e57ad (main b6d6fcdd; arc-ui
  840b5331 merged with tax-accuracy c89c58ff). Run `npm ci` first.
- **Hosting.** Per docs/setup.md, live is `caanshulgarg/tds-desk` on GitHub Pages: copy the files in and push. Staging's
  root forwards to /review/, and live needs the same root page. Confirm with the owner that app.fincom.live is that
  repository's Pages address: this session cannot read that repository.
- **Changes the live build needs:** vite.config.js ships `assets/bridge-go` only for a test build with
  `FINCOM_SHIP_BRIDGE=1`, and build.py's live form still hands out the old PowerShell setup (`bridge-setup`). For live
  users to get 2.4.1, both need a small reviewed change. (A live build has no Sentry; that is intended.)

### 1.5 The bridge for live users

- Give them **2.4.1, setup SHA-256 79e95ba3bf701ed2222b769d207f5cc885980a51f1443ded74fbd0ce7a5ae06a** (program
  f59866e0…6eab). These are the same files as `assets-test/bridge-go/`.
- A bridge whose `CloudUrl` is not staging takes https://app.fincom.live/ as its FinCom address (bridge-go/mode.go). It
  looks for updates at **https://app.fincom.live/assets/bridge-go/latest.json** and `latest.json.sig`.
  So live needs a `latest.json` whose two URLs point there; as on staging it has no `.sig`, so each computer is
  installed by hand.
- Live's computers run PowerShell bridge 1.14.x. The Go bridge adopts a 1.15.0 key (`adoptCloudKey`), so a 1.14
  computer is paired again with a connect code.

### 1.6 Sentry

There are three projects in the organisation garg-shekhar-company: app …4724864, cloud …5118080 and bridge …5642368.
The owner's condition of 08-Oct allows staging only, and the code enforces it (`sentry.ts` and `crash.go` are on
only for staging's host; a live build carries no Sentry code). Live goes without Sentry unless the owner widens the condition, which would need a code change and a new
review.

## 2. The go-live, in order

Who: O = owner, C = Claude. The times are estimates; the rehearsal replaces them with measured ones.

| # | Step | Who | Time | Check | Way back |
|---|---|---|---|---|---|
| 1 | Tell staff: no FinCom work and no posting during the window | O | 5 m | — | — |
| 2 | **Full backup of live:** Dashboard → Database → Backups (note the newest), switch on PITR if possible, download a full dump (`supabase db dump` or the dashboard's download), and download every storage bucket's files (a database backup holds no files) | O | 30–45 m | the dump file opens; bucket file counts noted | — |
| 3 | Run the inventory query (1.1); write down live's function versions and the Build number on screen | O | 10 m | C compares it with the list in 1.1 | — |
| 4 | **Lift the hook** for this session; switch on the missing extensions | O | 5 m | C reads one harmless `select 1` | put the hook back |
| 5 | Migrations in the order of 1.1, each md5-checked; 48 and 50 by O in the SQL editor; functions read back by md5(prosrc) as on staging | C (+O) | 2½–3½ h | each file: md5 equal, functions matched; after 23/27/32/37 the counts and totals agree | stop; restore from step 2 (or PITR to before step 5) |
| 6 | Vault and settings: `gst_cron_key`, the GSP items, Auth URLs, platform keys | O | 15 m | cron jobs listed; `tally-work` runs without an error in `cron.job_run_details` | — |
| 7 | Function secrets (1.3), then deploy the 7 functions; tally-ingest checked byte for byte | C | 30 m | CORS check from `server/_shared/README.md` against live; versions noted | redeploy the versions noted in step 3 |
| 8 | Build the live app (1.4), check that legacy.js names live, publish to tds-desk | C | 30 m | app.fincom.live shows the new build stamp; sign-in works | revert the tds-desk commit (Build 199 comes back) |
| 9 | Put the 2.4.1 files and latest.json on live; pair the first computer | C, O | 20 m | the setup's SHA-256 matches; the Tally page shows 2.4.1 | the old setup is still in tds-desk's history |
| 10 | Smoke checks: sign in (owner and one staff), open a client, upload a bill, Look up, **Post to Tally into a test company**, bridge beat within 1 minute, `tally-recorder-drain` cron runs | O, C | 30 m | each one passes | step 8's way back; the data stays |
| 11 | **Put the hook back**; tell staff to start | O | 5 m | C cannot reach live | — |

**Total: about 5½–7 hours**, so plan for a whole quiet day (a Sunday). Installing 2.4.1 on the rest of the computers
(about 15 minutes each) can follow over the next days.

**Point of no return.** Once staff save work in the new app (after step 11), a restore loses that work. Until then,
the backup from step 2 is a full way back.

## 3. Rehearsal

1. **The copy.** The owner makes it and gives Claude its id: best, a new throwaway project restored from live's backup
   (Dashboard → Backups → Restore to a new project). A Supabase branch is made from live's dashboard and starts empty,
   so it rehearses less. Claude checks the id is not live's before any call; the hook would also stop it.
2. **Treat it as live data.** The copy holds real clients. Claude reads only counts and totals from it. The owner
   deletes the project after the rehearsal.
3. **Run steps 3, 5, 6, 7 and 10 exactly as in section 2, timing each.** Edit 13, 16 and schema.sql for the copy's own
   address (never staging's: its cron would call staging). Point a local live build (1.4), or a bridge's `CloudUrl`,
   at the copy. Post into a test company only.
4. **Record** for each file: the minutes it took, whether it ran in pieces or in the SQL editor, and any lock wait.
   Record the trial balance and the live entry count of each book before and after 23, 27, 32 and 37.
5. **Done when** every step passes twice, from two separate restores, and section 2's times are replaced with the
   measured ones.

## 4. What only the owner can do

- Take the full backup of live (and of the storage files), and keep it off Supabase.
- Lift the block-production hook for the go-live window, and put it back the same day.
- Say "go", in writing, after the rehearsal has passed.
- Run 48 and 50 (and any piece the tool times out on) in live's SQL editor.
- Paste the inventory query and send back what it shows.
- Approve the edited 13, 16 and schema.sql (new md5s).
- Set the secret values: function secrets, vault, platform keys, Resend domain, Auth settings.
- Install bridge 2.4.1 on each live user's computer (NWS144 steps as in docs/bridge-2.4.1-test-sheet.txt), and pair
  each one with a connect code.
- Decide whether 31 runs, whether Sentry stays off on live, and which computers get the bridge.

## 5. Risks and open questions

1. **Staging's address is written into 13, 16 and gst-taxpro/schema.sql.** Run as they are, live's timers would call
   staging every 30 seconds. They must be edited, which gives them new md5s that the owner approves.
2. **Live's starting point is not known.** This list assumes live has exactly Build 199's files. The inventory query
   decides; if live is ahead or behind, the list changes before anything runs.
3. **Data that migrations transform:** 23 renames names and rebuilds `tally_ledger_day` days; 27 sets clients'
   `postTo`; 32 and 37 re-mark voucher origins; 13 gives every device a new wake token. None of these is undone by a later migration. Only the backup undoes them.
4. **31 never ran on staging** (`tally_ledgers.raw_name` is missing there), yet it is in the numbered chain. The tested
   order goes from 30 to 32 without it.
5. **61 is not on tax-accuracy** (only on `perms-61`). It narrows what `authenticated` may write on clients, records
   and activity. Old Build 199 tabs left open would then fail their writes. `live-members-fix.sql` (perms-61, md5
   fd84f633…) was for the owner to run on live: was it run?
6. **Staff accounts:** 61 closes members self-promotion; invites need `APP_URL` and Resend; the platform admin's
   second step (admin function) is not switched on. Check that every live staff member can still sign in during step 10.
7. **Bridges 1.14 during and after the window.** It is not tested whether tally-ingest v43 still accepts a 1.14
   PowerShell bridge. Until 2.4.1 is installed, a 1.14 computer may stop syncing or posting.
8. **The bridge release table.** On live, `tally_bridge_releases` and the allow-list are empty. Staging runs with "any
   computer, no pilot". The owner should check whether live needs the same release rows before 2.4.1 is allowed.
9. **No live publish script, and the live build ships no Go bridge** (1.4). A small change and its review are needed
   before the go-live.
10. **signup's source is not in the repository.** Live keeps its own copy, untested against the new schema.
11. **What cannot be undone without a restore:** the data changes in item 3, the privileges revoked by 4, 58, 61 and
    70, and pg_cron jobs that have already called out.
12. **The window's length depends on live's data size.** 23, 32, 37 and the RESTRICT swaps in 45 lock tables. The
    rehearsal measures how long.
