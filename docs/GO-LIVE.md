# FinCom go-live checklist

Refreshed 26-Oct-2026 (first written 10-Oct-2026). Written from the repository at staging-next `365bbb5f5` and from
read-only SELECTs on staging (project `qbocskaiewaxqcvaunzc`) on 26-Oct-2026. Nothing here has been run on live, and no
tool has read the live database. "Live" means app.fincom.live and its Supabase project; its id is never written here,
because a hook blocks it. "Staging" means staging.fincom.live and project `qbocskaiewaxqcvaunzc`.

The plan has three parts: this checklist, then **two clean rehearsals on a copy restored from live's backup**, then the
go-live day together. The owner opens the go-live window by lifting the hook himself and closes it by putting the hook
back. The plain-English version for the owner is `docs/GO-LIVE-SUMMARY.md`.

Who: **O** = owner, **C** = Claude. Every time is an estimate until the rehearsal measures it.

## 1. What differs between staging and live

### 1.0 What changed since 10-Oct

- **Migrations:** the list grows from 67 files to 104 (101 to run). 72–106 have run on staging, and so has 76 (db-speed). 97 (explicit
  grants) has not run on staging, because it changes nothing there. 91 is the exception: no record that it ran. Two
  staging-only cron files, 75b (Zoho) and 95b (2B match), name staging's address. Live needs go-live copies of them, and
  **those copies are not written yet** (1.1.1).
- **Supabase's grant change on 30-Oct-2026:** after that date a new table gets no automatic privileges. Every file from 98
  on carries its own GRANTs, and 97 runs last for the tables that existed on 20-Oct (1.1.4).
- **Edge functions:** 14 to deploy, up from 7. New are fincom-assistant, gst-2b-match, tds-challan-match, fincom-transcribe,
  mis-run and fincom-call, and zoho-books is optional. tally-ingest moves from v43 to v58 (`month_days`). Most functions
  are now deployed as pinned imports of a repository commit (1.2).
- **Secrets:** new platform keys `cf_realtime_app_id`, `cf_realtime_token` and `groq_api_key`. Optional ones are
  `cf_turn_key_id` / `cf_turn_key_token` and `resend_api_key` / `resend_from`. New Vault items are `zoho_cron_key`, made by
  75, and `gst_cron_key`, which mis-run and gst-2b-match now use too. There is a new `app_settings` row, `mis_run` (1.3).
- **Bridge:** 2.4.7 replaces 2.4.1. Its setup SHA-256 is `69aa6b742c74ec470c85b6f0b316580cf4741b0d54e81400418bfcd5c3448799`.
  2.4.7 pairs only with an app that has the SPAKE2 pairing (src/js/24-pair-spake.js), so the live app and the bridge go
  out together (1.5).
- **Meetings:** calls inside FinCom (migrations 102, 103 and 106, plus fincom-call) need Cloudflare Realtime keys. TURN is
  optional (1.7).
- **Hosting is open:** the owner says he "set up Cloudflare", and we don't yet know what that covers: DNS, Pages, or the
  call keys. The checklist works with either GitHub Pages or Cloudflare Pages for app.fincom.live. The DNS and hosting
  step is marked **"depends on owner's answer"** (1.4).

### 1.1 The database: what live has, and what it needs

Live was last known to run Build 199 (30-Sep-2026, bridge 1.14.6, the posting queue). That build came with these files,
which live should already have: `security/migration-1-functions.sql` (03b45bc3…), `security/migration-2-mfa-audit.sql`
(d387f6b8…), `books-sync/migration.sql` (ad7ed5c2…), `support/migration.sql` (5eabc7a5…), `tally-cloud/migration.sql`
(06f4b44c…), `-2-hardening` (cd33c652…), `-3-lookup` (3d41eb87…), `-4-want` (e8036cae…) and `-5-post-queue` (58dc3b13…).
Under them sits the base schema: 14 dashboard migrations, `tds_desk_core` … `nightly_backup_schedule`.

**Confirm this first.** The owner pastes this read-only query into live's SQL editor and sends back the result:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
select extname, extversion from pg_extension order by 1;
select jobname, schedule from cron.job order by 1;             -- fails if pg_cron is off: that is an answer too
select table_name from information_schema.tables where table_schema = 'public' order by 1;
select id from storage.buckets order by 1;
select pubname, tablename from pg_publication_tables where schemaname = 'public' order by 1, 2;
```

The list follows the fresh-database order in `docs/MIGRATION-ORDER.md`, which `tests/run_migration_order.py` checks.
Anything the inventory shows live already has is skipped.

- **Files to run:** 104 rows (steps 1–103, then 97 last), of which 101 run. Step 28 (31) is skipped by the owner's decision of 10-Oct-2026. Steps 72
  (75b) and 93 (95b) are staging-only: live runs their go-live copies once they are written, or leaves them out (1.1.1).
- **gst-taxpro schema:** add `gst-taxpro/golive/schema-golive.sql`, the go-live copy of `gst-taxpro/schema.sql` (1.1.1),
  if live has no `gst_sessions` table. Run it before step 13, because 16 alters `gst_sessions`.
- **The md5s:** each md5 is `md5sum` of the file at staging-next `365bbb5f5`.
- **Migration 76:** step 73 is the exception. It is **not on staging-next**. Its file is on branch `origin/db-speed`,
  commit `76c65c4b0`, and staging ran that exact text (md5 `20b9530e…`, in staging's piece store as `76-20b9530e`). Bring
  it onto the go-live branch byte for byte before the rehearsal, or take it from that commit.
- **Folders:** every path is under `server/`.
- **The notes:** "GO-LIVE COPY" means live runs the copy in 1.1.1 instead of the original. "CHANGES DATA" points to the
  dry runs in 1.1.2.

How each file ran on staging, as found on 26-Oct:

- **"tool, pieces"** means it is in staging's `fincom_migration_text` piece store and was applied md5-checked by Claude.
- **"tool, apply"** means it is in `supabase_migrations.schema_migrations`.
- **"owner, SQL editor"** comes from the run records in MIGRATION-ORDER/HANDOVER.
- **"present"** means the objects are on staging and the function bodies' md5(prosrc) equal the file's, but the repository
  does not record who ran it or how.
- **Steps 1–67** are all present on staging, checked by object on 26-Oct. 31 is absent, as decided. They ran as the notes
  say, otherwise by Claude's tool.

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
| 10 | 13 | `tally-cloud/golive/migration-13-golive.sql` | `23175e76972a90cf4e08cfeef0db568d` | **GO-LIVE COPY** of `migration-13-fast-sync.sql` (d142e44b…; 1.1.1). **CHANGES DATA**; makes queue `tally_work`, crons `tally-work`, `tally-post-requeue`, vault `tally_work_key`; sets `tally_devices.wake_token` on every row |
| 11 | 14 | `tally-cloud/migration-14-reports.sql` | `afd306f7a4c986374669c1a7131c17d8` |  |
| 12 | 15 | `tally-cloud/migration-15-books-live.sql` | `de5dae0db4fd08441a29366fbe1adb24` |  |
| 13 | 16 | `gst-taxpro/golive/migration-16-golive.sql` | `b6bf6a1c585e85547f011186a1fd0ea5` | **GO-LIVE COPY** of `migration-16-tax-accuracy.sql` (00463f7e…; 1.1.1): cron `gst-daily` |
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
| 28 | 31 | `tally-cloud/migration-31-clean-names.sql` | `45ed0b283c274132b3dc27abdd9527c8` | **SKIP** (owner, 10-Oct-2026; 1.1.3). Never ran on staging (no `raw_name` column there) |
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
| 59 | 68 | `tally-cloud/migration-68-alert-dismissals.sql` | `184e795994242b41f4edbaaaa7d530f9` | owner ran it in the SQL editor |
| 60 | 70 | `tally-cloud/migration-70-alert-dismissals-tighten.sql` | `3457411cc0bacfdbdc174191e0629b63` |  |
| 61 | 61 | `tally-cloud/migration-61-privileges.sql` | `cec075a148f26144fd1808c94b841684` | **RUN** (owner, 10-Oct-2026; 1.1.3). Brought over from perms-61 byte for byte (same md5). Placed where `tests/run_migration_order.py` runs it in both orders (after 70, before 62; passed 10-Oct); privileges only; closes members self-promotion and the anon TRUNCATE hole |
| 62 | 62 | `tally-cloud/migration-62-tds-rate-worked-out.sql` | `bcdfd7b72b1d69b429e6b15a5e9652c6` |  |
| 63 | 67 | `tally-cloud/migration-67-recorder-renumbered.sql` | `78676805ebdaf9b24e41bc2708ed0a90` | tested fresh order runs 67 before 63 (staging ran 63 first) |
| 64 | 63 | `tally-cloud/migration-63-recorder-repeat.sql` | `ff8011351b8856025710b68bad0b690c` |  |
| 65 | 64 | `tally-cloud/migration-64-pages-live.sql` | `0a91d37ab313331399dffdaf677de9e6` |  |
| 66 | 65 | `tally-cloud/migration-65-selfchecks.sql` | `51a224cf8e00b7a46da42da4694e8993` |  |
| 67 | 66 | `tally-cloud/migration-66-recorder-masters.sql` | `fea953435146ec8bdc3e77c5808e1714` |  |
| 68 | 72 | `tally-cloud/migration-72-gst-type.sql` | `885fc1ee46b8facb17173dfa560d9c4f` | Ran on staging 11-Oct by tool |
| 69 | 73 | `tally-cloud/migration-73-tds-fields.sql` | `c05257c2f0b80444ad4325db1bfd42a8` | Ran on staging 12-Oct by tool; new table `tally_tds_natures` |
| 70 | 74 | `tally-cloud/migration-74-payroll.sql` | `76dfd80eb3da740add5b30332511d046` | Ran on staging 12-Oct by tool; `tally_employees`, `tally_salary_pays` |
| 71 | 75 | `zoho-books/migration-75-zoho-books.sql` | `8d97596410a732522de77bb8f75ce4a6` | tool, pieces (13-Oct). Add-only; makes Vault `zoho_cron_key`; needs pgcrypto |
| 72 | 75b | `zoho-books/migration-75b-zoho-cron-staging.sql` | `9192cadeac2fdafed375421d2d499b57` | **STAGING ONLY**: names staging's address. Live needs a go-live copy (not written; 1.1.1), or leaves it out until Zoho is used on live |
| 73 | 76 | `tally-cloud/migration-76-db-speed.sql` (**branch db-speed, 76c65c4b0**) | `20b9530ee8d84c627ae2d905cb97ff8b` | tool, pieces (13-Oct). Speed only: 16 (18 with 75) foreign-key indexes, six policies re-made with `(select auth.uid())`, `id` primary keys on `tally_lines` / `tally_bills`. **Locks and rewrites the two biggest tables**, so the rehearsal must time it. Read back: the indexes, the six policies, the two keys; the performance advisor shows 0 unindexed_foreign_keys and 0 auth_rls_initplan |
| 74 | 77 | `assistant/migration-77-assistant.sql` | `f0a933e2493bc43e99f1d097564aee45` | tool, apply (13-Oct). 13 tables, 59 `asst_*` functions, bucket `assistant-files` |
| 75 | 78 | `assistant/migration-78-audit.sql` | `5529b3af73415f20754dbdeac16371aa` | tool, apply (13-Oct) |
| 76 | 79 | `assistant/migration-79-reports.sql` | `2c8aaa9f0b8a3a6d2afa7ec18fc76a4f` | tool, apply (13-Oct) |
| 77 | 80 | `tally-cloud/migration-80-challan-register.sql` | `defa81a2b49dbd19b6ef43f5d42567d5` | tool (14-Oct, fetched by pg_net, md5-checked); `tds_challan_allocations` |
| 78 | 81 | `assistant/migration-81-depreciation.sql` | `241e2857ca40568cc6b4f4028c1e1b76` | tool, pieces (14-Oct) |
| 79 | 82 | `assistant/migration-82-assistant-default-on.sql` | `559a8ef3c9ca5a3155c4f00ad1bcd4fd` | tool, pieces (14-Oct). Assistant on by default; changes no stored row on a fresh `assistant_settings` |
| 80 | 83 | `assistant/migration-83-certificates.sql` | `e24ea7e2589e67c052efb33b2baf6218` | tool, pieces (14-Oct). On staging the firm's certificate details were seeded afterwards; on live the owner fills them in Settings (nothing copied) |
| 81 | 84 | `assistant/migration-84-assistant-uploads.sql` | `4a9e81187ba929cf9e47a0b6bea3369b` | tool, pieces (14-Oct) |
| 82 | 85 | `assistant/migration-85-asst-span.sql` | `92ee1ce9a531156096118b9c602a68e6` | Ran on staging 14-Oct by tool; replaced by 86 straight after |
| 83 | 86 | `assistant/migration-86-asst-span-books.sql` | `2dd7ae32c764811624c1a994d51fa818` | Ran on staging 14-Oct by tool; read back `asst_span` prosrc `4e92a33c…` (also on staging 26-Oct) |
| 84 | 87 | `assistant/migration-87-rls-initplan.sql` | `991893ac65634ee4bc1c6dfabd5c0ad6` | Ran on staging 14-Oct by tool. Rewrites 10 read policies as `(select my_firm())` (the same rows) |
| 85 | 88 | `assistant/migration-88-ledger-names.sql` | `5699d4f5aaa37bee6e4cd32258ba490f` | Ran on staging 14-Oct by tool |
| 86 | 89 | `tally-cloud/migration-89-ledger-fetch.sql` | `1e5d9651425d79cade4469908921beed` | tool, pieces (15-Oct). Run 90 straight after it |
| 87 | 90 | `tally-cloud/migration-90-ledger-fetch-speed.sql` | `2d04572cf02b50916a0395ac609cb691` | tool, pieces. MIGRATION-ORDER still says "not run", but staging holds 90's text, so that line is out of date |
| 88 | 91 | `tally-cloud/migration-91-book-start.sql` | `369c8bc2bfee0b655aceb808c64e0cc0` | **CHANGES DATA**: sets `tally_books.from_date` / `open_as_on` for books with days held and no start. **No record that it ran on staging**: on 26-Oct, 2 of staging's 9 books would still be touched. Dry run: 1.1.2 |
| 89 | 92 | `tally-cloud/migration-92-settle-unnamed-deletes.sql` | `48247898a2bb16c889a0ebcdf7ec2b90` | tool, pieces (16-Oct). Settles held GUID-less deletes once. On live 0 rows, since the recorder (44) is new in the window |
| 90 | 93 | `gst-browser/migration-93-gst-portal-login.sql` | `7700714e59a4d8a58264d6e475bfd909` | tool, pieces. MIGRATION-ORDER still says "not run", but it is present |
| 91 | 94 | `gst-taxpro/migration-94-gst-filing.sql` | `3b220883a4f98680111edbd9d2663340` | tool, pieces |
| 92 | 95 | `gst-2b-match/migration-95-gst-2b-match.sql` | `5bd200e12467fe29f4d3cf8beaad6d8c` | tool, pieces. Then the gst-2b-match function |
| 93 | 95b | `gst-2b-match/migration-95b-gst-2b-match-cron-staging.sql` | `54f3c46e47842413490f1e6af8943675` | **STAGING ONLY**: names staging's address. Live needs a go-live copy (not written; 1.1.1), or leaves it out at first (2B matching then runs only when asked from the app) |
| 94 | 96 | `assistant/migration-96-assistant-monthly-cap.sql` | `9c08b441e7a5518e0b29f9e4ba9dc625` | tool, pieces. A firm's existing `assistant_caps` row gets `monthly_inr` 3000 |
| 95 | 98 | `tally-cloud/migration-98-period-pull.sql` | `105ee6905da7a94e1d062fdde95e5343` | tool, pieces (22-Oct, 05:55 UTC). 18 functions, all md5(prosrc) equal to the file's on 26-Oct. `tally_devices.period_fetch` default false |
| 96 | 99 | `zoho-books/migration-99-zoho-rolling-minute.sql` | `4a5191cd62fff7900876c4577a37bc22` | present (22-Oct; `zoho_api_take` a853b443…, the file's) |
| 97 | 100 | `mis-run/migration-100-mis-schedules.sql` | `b5ba9a5f6ee7f76f4ffdadf8e51616b3` | present (6 of 6 functions equal). Cron `mis-run-due`, bucket `mis-reports`. It reads its address from `app_settings` `mis_run`: set that on live (1.3). MIGRATION-ORDER still says "not run", but it is present |
| 98 | 101 | `security/migration-101-autopost.sql` | `f6176b57c76491a4f37e22e60627c979` | present: 7 functions; `sync_guard_autopost` matches the file with the whole-line comments left out, the other six exactly. Trigger on `clients` |
| 99 | 102 | `video-calls/migration-102-video-calls.sql` | `578b11f5e822af1b392b64be274f8daf` | present (5 of 5 functions equal). 12 tables; buckets `call-recordings`, `call-files`; cron `call-retention` 21:17 |
| 100 | 103 | `video-calls/migration-103-call-codes.sql` | `d45517beebe4fd486cacc4d93f17703e` | present (2 of 2 functions equal). Gives existing rooms a code: 0 on live (102 runs in the same window) |
| 101 | 104 | `tally-cloud/migration-104-tally-connect-steps.sql` | `55810ae17deb15c3479fd02cccaf418e` | tool, apply (24-Oct) |
| 102 | 105 | `tally-cloud/migration-105-gst-held-input.sql` | `71cd1ab8868f1d0d42f9cc725b166d92` | tool, apply (24-Oct). Replaces `tally_gst_summary` only |
| 103 | 106 | `video-calls/migration-106-call-lobby.sql` | `fabb6054a6c38c13372cd87cf6d14af9` | tool, apply (25-Oct). The header says the owner would run it in the SQL editor, but staging's migration list shows the tool ran it |
| **last** | 97 | `security/migration-97-explicit-grants.sql` | `336ff02ddf0a0330b50398a922acb09b` | **Runs after every other file** (1.1.4). Not run on staging, where it changes nothing |

Notes on the list:

- **"delete from":** in 6–11, 18, 19, 29, 37–44 and 48 the words are inside a function, so the file itself removes no
  rows. Only 23 deletes rows when it runs: it deletes `tally_ledger_day` rows and builds the same days again. Of the newer
  files, 93 and 101 have "delete from" only inside functions.
- **Files that change live data as they run:** 13, 23, 27, 32, 37 and **91**. 1.1.2 gives each a read-only dry run and a
  before/after check. 76 changes no values, but it rewrites `tally_lines` and `tally_bills` to add their `id` keys, so it
  is timed in the rehearsal.
- **The SQL-editor rule:** on staging the owner ran 43, 44, 48, 50, 55 and 68 in the SQL editor. On live, 48 and 50 must be
  run that way, by the owner. The others may go in md5-checked pieces, as on staging (`docs/HANDOVER.md`, "How to apply a
  migration"). Any file the tool times out on in the rehearsal joins the owner's list.
- **Extensions live needs:** pg_cron 1.6.4, pg_net 0.20.4, pgmq 1.5.1, supabase_vault 0.3.1, pgcrypto 1.3 and uuid-ossp
  1.1, as on staging (staging also has pg_stat_statements). The owner switches on any that are missing (Database →
  Extensions) before the migrations.

**What staging holds after all of this (26-Oct), which live must match after the window.** Times are UTC.

- **pg_cron (15 jobs):**
  - `tds-desk-nightly-backup` 19:30 (base)
  - `tally-work` every 30 s and `tally-post-requeue` every minute (13, go-live copy)
  - `gst-taxpro-refresh` */20 (schema.sql, go-live copy)
  - `gst-daily` 01:30–05:30 hourly (16, go-live copy)
  - `tally-recorder-drain` every 30 s, `tally-alert-gaps` */10, `tally-alert-silent` */30 03–13 Mon–Sat and
    `tally-alert-summary` 13:30 (47)
  - `tally-recorder-archive-trim` 21:17 (48)
  - `zoho-books-sync` */5 (75b, staging only)
  - `gst-2b-match-queue` */15 (95b, staging only)
  - `mis-run-due` */15 (100)
  - `call-retention` 21:17 (102)
- **pgmq queues:** `tally_work` (13) and `tally_recorder` (47).
- **Storage buckets (10, all private):**
  - `client-docs` and `doc-inbox` (base)
  - `support-files` (support)
  - `tally-days` and `tally-support` (tally-cloud)
  - `tally-uploads` (47)
  - `assistant-files` (77)
  - `mis-reports` (100)
  - `call-recordings` and `call-files` (102)
- **Realtime publication `supabase_realtime` (12 tables), each added by a migration:**
  - `clients`, `records` and `client_book_items` (12)
  - `tally_jobs` (13)
  - `tally_books` (15)
  - `tally_post_jobs` (26)
  - `tally_recorder_lines` (45)
  - `tally_alerts` (47)
  - `tally_book_changes`, `tally_sync_cursor`, `tally_month_locks` and `tally_tieouts` (64)

  Compare live's list after the window with the inventory query's last line.
- **Vault (names):**
  - `connector_signing_passphrase`, `gsp:taxpro:aspid` and `gsp:taxpro:password` (set by hand)
  - `gst_cron_key` (schema.sql)
  - `tally_work_key` (13)
  - `zoho_cron_key` (75)
  - on live and the rehearsal copy only, `fincom_project_url` (1.1.1)

  Staging also holds per-client `gsp:sess:*` and `gstportal:*` items written by the app. They are not copied.

#### 1.1.1 The go-live copies of 13, 16 and gst-taxpro/schema.sql (risk 1)

The originals name staging's address in their pg_cron jobs. Live runs these copies **instead of** the originals
(staging keeps the originals; they are not edited). Each copy is the original with three changes only: the job reads
this project's own address from a Vault secret, `fincom_project_url`, every time it runs (no project address is written
in the file); the file stops with a clear message, before changing anything, if that secret is missing, is not of the
form `https://<project id>.supabase.co`, or names staging; and it runs twice cleanly (13 adds `tally_jobs` to the realtime
publication only when it is not there yet; 16 and schema.sql now run in one transaction).

| Go-live copy (run on live) | md5 (**approved by the owner 10-Oct-2026**) | Replaces on live |
|---|---|---|
| `gst-taxpro/golive/schema-golive.sql` | `a3f27ffa473266bb46400b5925fefcea` | `gst-taxpro/schema.sql` (3adf1dc2779cef249651126c3bdc852b): cron `gst-taxpro-refresh`, vault `gst_cron_key` |
| `tally-cloud/golive/migration-13-golive.sql` | `23175e76972a90cf4e08cfeef0db568d` | `tally-cloud/migration-13-fast-sync.sql` (d142e44b596319a1e39fed77657e0929): crons `tally-work`, `tally-post-requeue` |
| `gst-taxpro/golive/migration-16-golive.sql` | `b6bf6a1c585e85547f011186a1fd0ea5` | `gst-taxpro/migration-16-tax-accuracy.sql` (00463f7e91b27e49fcf41c7c1e7bea9e): cron `gst-daily` |

**Before the first of them** (in step 5, before step 10 of the list), the owner sets the secret once in live's SQL
editor, with live's own address typed in by him:

```sql
select vault.create_secret('https://<live project id>.supabase.co', 'fincom_project_url', 'FinCom: this project''s own address, for its pg_cron jobs');
```

On the rehearsal copy, the same with the copy's address. To check later: `select net.http_post` calls go to
`(select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/…'`.

**Proved** by `tests/run_golive_cron.py` on a throwaway PostgreSQL (pg_stand, with stand-ins for Vault, pg_net and
pg_cron, and the real pgmq): without the secret, with staging's address, or with a wrong address each copy refuses and
leaves nothing; with it set, each copy runs twice cleanly; the four jobs are there once each and none holds an address;
run, `tally-work` calls `<address>/functions/v1/tally-ingest` and the two GST jobs `<address>/functions/v1/gst-taxpro`, each
with its key; a changed secret is followed at the next run; and the copies end with the same functions, columns, jobs and
schedules as the originals (40 checks, all passed).


**Added 26-Oct: the newer files that name staging's address, and the one that reads it from a setting.**

| File | What it does on staging | On live |
|---|---|---|
| `zoho-books/migration-75b-zoho-cron-staging.sql` | cron `zoho-books-sync`, the address written in | **A go-live copy is needed** (same pattern as the three above: the address from `fincom_project_url`, refuse staging). **Not written yet** (C, before the first rehearsal, with its test in `tests/run_golive_cron.py` and the owner's approval of its md5). Or leave it out until a client uses Zoho on live |
| `gst-2b-match/migration-95b-gst-2b-match-cron-staging.sql` | cron `gst-2b-match-queue`, the address written in | Same: **a go-live copy is needed, not written yet**. Or leave it out at first |
| `mis-run/migration-100-mis-schedules.sql` | cron `mis-run-due` reads `app_settings` row `mis_run` (`{"url": ".../functions/v1/mis-run"}`) | No copy needed. After the window, set the row to live's own address (1.3). Until it is set, the job sends nothing |

#### 1.1.2 Dry runs for the files that change data (risk 3)

For each of 13, 23, 27, 32 and 37: a **dry run** (read-only, counts exactly the rows the file will change) and a
**check** to run just before and just after the file. The owner pastes the dry runs into live's SQL editor **before
go** and sends the numbers; Claude runs the same in the rehearsal. Every query here only reads. They work both on live as
it is now (Build 199: the later columns and tables are not there yet) and in the window. A row that arrives between the
dry run and the file (a bridge still syncing) can change the number; so in the window, run the dry run again just
before the file: the number must not differ from the file's result.

`tests/run_golive_dryrun.py` takes these queries from this page and proves them on pg_stand with made-up rows: on Build
199's tables and on the tables as they are in the window, each dry run's number equals the rows the file's own
statements (copied word for word from the file) touched; the before/after checks behave as written below (60 checks,
all passed).

**The money check** (run before and after 23, 32 and 37; one row a book). Before and after must be the same. The one
allowed difference: after 23, if a day's ready totals (`day_totals_dr_cr`) were stale before, 23 rebuilds them from the
lines, so they can then differ; `lines_turnover` and `openings_total` must still be the same.

```sql
-- check money
select b.company, b.book_id,
       (select count(*) from public.tally_vouchers v where v.book_id = b.book_id) as entries,
       (select count(*) from public.tally_lines l where l.book_id = b.book_id) as lines,
       (select coalesce(sum(abs(l.amount)), 0) from public.tally_lines l where l.book_id = b.book_id) as lines_turnover,
       (select count(*) from public.tally_ledgers g where g.book_id = b.book_id) as ledgers,
       (select coalesce(sum(g.open), 0) from public.tally_ledgers g where g.book_id = b.book_id) as openings_total,
       (select coalesce(sum(d.dr), 0) || ' / ' || coalesce(sum(d.cr), 0) from public.tally_ledger_day d where d.book_id = b.book_id) as day_totals_dr_cr
  from public.tally_books b order by 1, 2;
-- end
```

**13** (fast sync): gives every Tally computer a new `wake_token`.

```sql
-- dry run 13
select 'tally_devices: a new wake_token' as rows_changed, count(*) as how_many
  from public.tally_devices t where to_jsonb(t)->>'wake_token' is null;
-- end
```
```sql
-- check 13
select count(*) as devices, count(*) filter (where to_jsonb(t)->>'wake_token' is null) as without_token,
       count(distinct to_jsonb(t)->>'wake_token') as different_tokens
  from public.tally_devices t;
-- end
```
After: `without_token` = 0 and `different_tokens` = `devices` (devices unchanged).

**23** (clean names): rewrites ledger, group, party and line names that hold line breaks, and deletes then builds again
the ready day totals of the days touched. "Rows rewritten" counts every row its updates touch (a clean twin of an
unclean ledger is touched to take the twins' openings, even if its values end the same).

```sql
-- dry run 23
with l as (select t.book_id, t.name, t.parent, to_jsonb(t) as j from public.tally_ledgers t),
     unclean as (select distinct book_id, btrim(regexp_replace(name, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g')) as nm
                   from l where name <> btrim(regexp_replace(name, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))),
     days as (select book_id, day from public.tally_ledger_day where ledger <> btrim(regexp_replace(ledger, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))
              union select book_id, day from public.tally_lines where ledger <> btrim(regexp_replace(ledger, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g')))
select 'tally_ledgers: rows rewritten' as rows_changed, count(*) as how_many from l
 where (book_id, btrim(regexp_replace(name, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))) in (select book_id, nm from unclean)
    or parent <> btrim(regexp_replace(parent, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))
    or coalesce(j->>'primary_group', '') <> btrim(regexp_replace(coalesce(j->>'primary_group', ''), '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))
    or coalesce(j->>'merged_into', '') <> btrim(regexp_replace(coalesce(j->>'merged_into', ''), '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))
    or exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(j->'chain') = 'array' then j->'chain' else '[]' end) c
                where c <> btrim(regexp_replace(c, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g')))
union all select 'tally_lines: ledger name cleaned', count(*) from public.tally_lines
 where ledger <> btrim(regexp_replace(ledger, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))
union all select 'tally_vouchers: party name cleaned', count(*) from public.tally_vouchers
 where party <> btrim(regexp_replace(party, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))
union all select 'tally_ledger_day: rows deleted (their days are built again)', count(*) from public.tally_ledger_day d
 where (d.book_id, d.day) in (select book_id, day from days)
union all select 'tally_ledger_day: days built again', count(*) from days
union all select 'tally_groups: rows rewritten', case when to_regclass('public.tally_groups') is null then 0 else
  (xpath('/row/c/text()', query_to_xml($q$
    with g as (select name, parent, btrim(regexp_replace(name, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g')) as nm,
                      row_number() over (partition by book_id, btrim(regexp_replace(name, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))
                                         order by (name = btrim(regexp_replace(name, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))) desc, (parent <> '') desc, name) as rn
                 from public.tally_groups)
    select count(*) as c from g where parent <> btrim(regexp_replace(parent, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g')) or (rn = 1 and name <> nm)
  $q$, false, true, '')))[1]::text::bigint end
union all select 'tally_bills: ledger name cleaned', case when to_regclass('public.tally_bills') is null then 0 else
  (xpath('/row/c/text()', query_to_xml($q$
    select count(*) as c from public.tally_bills where ledger <> btrim(regexp_replace(ledger, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))
  $q$, false, true, '')))[1]::text::bigint end;
-- end
```
```sql
-- check 23
select count(*) filter (where name <> btrim(regexp_replace(name, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g')) and to_jsonb(t)->>'merged_into' is null) as ledger_names_not_clean,
       (select count(*) from public.tally_lines where ledger <> btrim(regexp_replace(ledger, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))) as line_names_not_clean,
       (select count(*) from public.tally_vouchers where party <> btrim(regexp_replace(party, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))) as party_names_not_clean,
       (select count(*) from public.tally_ledger_day where ledger <> btrim(regexp_replace(ledger, '[ \t]*(&#13;|&#10;|\r|\n)+[ \t]*', ' ', 'g'))) as day_names_not_clean
  from public.tally_ledgers t;
-- end
```
After: all four 0. Plus the money check.

**27** (posting record): sets `postTo` on clients whose one Tally company has the same GSTIN, where none is chosen.

```sql
-- dry run 27
select 'clients: postTo set' as rows_changed, count(*) as how_many
  from public.clients cl
  join (select firm_id, client_id, min(company) as company, min(upper(btrim(coalesce(gstin, '')))) as gstin
          from public.tally_companies where client_id is not null
         group by firm_id, client_id having count(*) = 1) t on cl.firm_id = t.firm_id and cl.id = t.client_id
 where not coalesce(cl.deleted, false)
   and coalesce(btrim(cl.data->>'postTo'), '') = ''
   and t.gstin <> '' and t.gstin = upper(btrim(coalesce(nullif(cl.gstin, ''), cl.data->>'gstin', '')));
-- end
```
```sql
-- check 27
select count(*) filter (where coalesce(btrim(data->>'postTo'), '') <> '') as clients_with_post_to,
       count(*) filter (where data->>'postToBy' = 'auto') as set_automatically
  from public.clients where not coalesce(deleted, false);
-- end
```
After: `clients_with_post_to` grows by exactly the dry run's number (as does `set_automatically`). The file also lists
the clients it changed (its `returning`): keep that list.

**32** (sync safety): `origin` = 'fincom' on entries whose narration holds a TDSDesk id. (It also fills two new tables,
`tally_post_ids` and `tally_voucher_versions`, from the posting queue and the entries; no existing row changes there.)

```sql
-- dry run 32
select 'tally_vouchers: origin becomes fincom' as rows_changed, count(*) as how_many
  from public.tally_vouchers t
 where coalesce(to_jsonb(t)->>'origin', 'tally') = 'tally' and narration ~ 'TDSDesk:[A-Za-z0-9]';
-- end
```
**37** (follow-ups): fills `fincom_id` (and `origin`) from the narration on entries that have none.

```sql
-- dry run 37
select 'tally_vouchers: fincom_id and origin filled' as rows_changed, count(*) as how_many
  from public.tally_vouchers t
 where to_jsonb(t)->>'fincom_id' is null and narration ~ 'TDSDesk:[A-Za-z0-9._-]';
-- end
```
Check for 32 and 37 (run before and after each):

```sql
-- check 32 37
select coalesce(to_jsonb(t)->>'origin', '(no origin column yet)') as origin, count(*) as entries,
       count(to_jsonb(t)->>'fincom_id') as with_fincom_id,
       count(*) filter (where narration ~ 'TDSDesk:') as narration_has_tdsdesk_id
  from public.tally_vouchers t group by 1 order by 1;
-- end
```
After 32: the `fincom` row's `entries` grows by the dry run's number. After 37: `with_fincom_id` grows by the dry run's
number. Total entries the same. Plus the money check.

**91** (book start, added 26-Oct): sets `from_date`, and `open_as_on` where it is empty, on books that hold days but
have no start. The query comes from the file's own header. It is not yet covered by `tests/run_golive_dryrun.py`: C adds
it there before the first rehearsal. On live as it is today (Build 199) the columns it reads may not all be there yet, so
run it in the window, just before 91.

```sql
-- dry run 91 (from the file's header; run in the window)
select b.book_id, b.company, b.open_as_on,
       coalesce(u.first_from, d.first_day) as from_date_to_set,
       coalesce(b.open_as_on, coalesce(u.first_from, d.first_day) - 1) as open_as_on_to_set, d.days
  from public.tally_books b
  join (select book_id, count(*) as days, min(day) as first_day from public.tally_days group by book_id) d on d.book_id = b.book_id
  left join (select book_id, min(to_date(upload->>'from', 'YYYYMMDD')) as first_from
               from public.tally_jobs where kind = 'upload' and sealed and coalesce(upload->>'from', '') ~ '^[0-9]{8}$'
              group by book_id) u on u.book_id = b.book_id
 where b.from_date is null
 order by b.company;
-- end
```
After 91: the same query returns no rows, and no other book's `from_date` changed. Keep the list it printed before.

#### 1.1.3 Migrations 31 and 61, and live-members-fix.sql (owner's decisions of 10-Oct-2026)

- **31 (`tally-cloud/migration-31-clean-names.sql`): SKIP.** It is a one-time rewrite of names already kept (entities,
  two spaces read for a line break, twins with one key). It never ran on staging, which has lived without it since
  02-Oct; the tested order goes from 30 to 32 without it. Everything after it copes without it: 34, 36 and 41 check
  whether its column `before_clean` is there, 36 adds that column itself, and tally-ingest reads it only when present.
  Running it on live would be its first run anywhere, on real data, in an order nobody has tested. The names it would
  fix get fixed the normal way: tally-ingest cleans names on the way in, the next ledger list rebuilds the masters, and
  "Read the kept day books again" rebuilds a book's entries. If a book shows one ledger under two names after the
  go-live, read that book again.
- **61 (`tally-cloud/migration-61-privileges.sql`, md5 cec075a148f26144fd1808c94b841684): RUN**, as step 61 of the list
  (after 70, before 62: the order `tests/run_migration_order.py` runs it in, both orders, twice; 239 checks passed on
  10-Oct with the file in the tree). The file is now on tax-accuracy, byte for byte the perms-61 file, with its test
  `tests/run_migration61.py` (and its helper `tests/members_stand.py`): 67 checks passed. It ran on staging on 06-Oct.
  It only revokes privileges from anon and authenticated and checks itself at the end. It closes two holes live has
  today: anyone with the public key could empty (TRUNCATE) most public tables, and a staff member can make themselves
  owner with one request. A Build 199 tab left open would fail its writes, so it runs in the window and everyone reloads
  after; a page refused afterwards is fixed by the one grant its header names.
- **`live-members-fix.sql`** (perms-61, md5 fd84f633…; one statement: `revoke insert, update, delete on table
  public.members from authenticated`). The owner does not know whether it was run on live. He pastes this read-only
  query into live's SQL editor (tested on pg_stand both ways):

  ```sql
  select case when has_table_privilege('authenticated', 'public.members', 'INSERT')
                or has_table_privilege('authenticated', 'public.members', 'UPDATE')
                or has_table_privilege('authenticated', 'public.members', 'DELETE')
                or exists (select 1 from pg_attribute a where a.attrelid = 'public.members'::regclass and a.attnum > 0 and not a.attisdropped
                             and (has_column_privilege('authenticated', 'public.members', a.attname, 'INSERT')
                               or has_column_privilege('authenticated', 'public.members', a.attname, 'UPDATE')))
              then 'NOT applied: signed-in members can still write the members table'
              else 'applied: signed-in members cannot write the members table' end as live_members_fix;
  ```

  - **"applied"**: nothing to do; 61 runs as planned (it runs cleanly on top of the fix: tested).
  - **"NOT applied"**: the self-promotion hole is open on live today. Either the owner runs `live-members-fix.sql` now
    (it is safe and small, and closes it before the go-live), or he leaves it to 61 in the window, which does the same
    and more. In both cases, also look at the trail for anyone who used the hole (read-only; from the file's header):
    `select a.at, a.firm_id, a.user_id, a.detail from public.activity a where a.what = 'person.update' order by a.at desc;`
    and check that each person's role on the People page is the one they should have.


#### 1.1.4 Grants: migration 97 and the 30-Oct-2026 change

- From 30-Oct-2026, Supabase gives `anon` / `authenticated` / `service_role` no automatic privileges on new tables in
  `public`. A table made without GRANTs answers "permission denied" to the app and to the edge functions, service_role
  included.
- **97 runs last, after every file, whatever the date.** It writes out exactly what staging held on 20-Oct-2026 for the
  166 tables, views and sequences that existed then (`tests/fixtures/staging-grants-20261020.json`). It contains GRANTs
  only, and a relation live does not have is skipped with a notice. Check afterwards: the read-back in
  `tests/run_migration_grants.py` (step 3) gives on live the same privileges as the fixture.
- **Tables made after 20-Oct carry their own GRANTs** (the rule in `docs/MIGRATION-ORDER.md`), checked on 26-Oct:
  - 98 (`tally_period_pulls`, `tally_period_days` and a third table): 11 grant lines.
  - 100 (`mis_schedules`, `mis_runs`).
  - 101 (`autopost_claims`, `autopost_log`).
  - 102 (12 `call_*` tables).
  - 103 (`call_code_tries`, `call_captions`).
  - 104 (`tally_connect_steps`).
  - 106 (`call_watch`).
- **One difference to expect.** On staging, 98's two period tables were made before 30-Oct, so they also got the default
  `anon` / `authenticated` privileges. RLS has no policy there, so no rows reach those roles. On live they get only what
  the file grants (service_role). The rehearsal checks that the app's period-fetch screens still work. They read through
  functions, not the tables, but this is to be confirmed. The other new tables already have the narrow grants on staging,
  the same as live will have.

### 1.2 Edge functions (staging, read 26-Oct-2026)

Before deploying, the owner notes live's current version of each function: that is the way back. Most functions are now
deployed as a one-line `index.ts` that imports the repository file at a fixed commit (a "pinned import"). Supabase
bundles it at deploy time. On live, deploy **the same pins as staging**: that is what was tested. The files-based ones
are deployed with the files in `server/_shared/README.md`, always including `../_shared/cors.ts`.

| Function | Staging | verify_jwt | Source on staging (pin) | Live |
|---|---|---|---|---|
| tally-ingest | v58 | off | `server/tally-cloud/index.ts` @ `21edcfd26` (month_days); rollback on staging v57 @ `70815040d` | deploy; **re-run the 1.14.6 test against 21edcfd26 first** (risk 7) |
| gst-taxpro | v21 | off | `server/gst-taxpro/index.ts` @ `0823a1e23` | deploy (after 94/95) |
| fincom-assistant | v17 | off | `server/assistant/index.ts` @ `1de642a6b` | deploy (after 77–96) |
| gst-2b-match | v4 | off | `server/gst-2b-match/index.ts` @ `dfc79fbae` | deploy (after 95, before gst-taxpro uses it) |
| tds-challan-match | v3 | off | `server/tds-challan-match/index.ts` @ `d1169d304` | deploy |
| fincom-transcribe | v5 | off | `server/fincom-transcribe/index.ts` @ `fc9883ad3` | deploy (needs `groq_api_key`) |
| mis-run | v2 | off | `server/mis-run/index.ts` @ `bee47d200` | deploy (after 100) |
| fincom-call | v4 | off | `server/video-calls/index.ts` @ `365bbb5f5` | deploy (after 102/103/106) |
| zoho-books | v1 | off | `server/zoho-books/index.ts` @ `5279ae45b` | **optional**: only if Zoho is offered on live (needs the ZOHO_* secrets) |
| signin | v3 | off | `server/security/functions/signin` (files) | deploy (new on live) |
| admin | v14 | off | `server/security/functions/admin` (files) | deploy; set `APP_URL` (it defaults to staging) |
| gateway | v13 | off | `server/security/functions/gateway` (files) | deploy (bill reading: claude, google vision) |
| gst-api | v10 | off | `server/gst-api` (files) | deploy (uses fyn-relay) |
| support-mail | v10 | off | `server/support-mail` (files) | deploy |
| signup | v10 | off | **not in the repository** | leave live's own as it is |
| bank-scrub | v6 | **on** | ops tool, branch `ops-bankscrub` only | **not for live** |

That makes 13 functions to deploy, or 14 with zoho-books. Each deploy is checked by its CORS preflight from
app.fincom.live and by the version Supabase reports. tally-ingest is also checked by a bridge beat. The full ezbr SHA-256
of every staging deploy is in the 26-Oct inventory (`list_edge_functions`). Write live's own down as each one goes out.

### 1.3 Secrets and settings (names only)

**Edge Function secrets.** These are the names the code reads. The values are live's own. Supabase fills the
`SUPABASE_*` names itself.

- **Links and mail:** `APP_URL` = https://app.fincom.live/ (admin, support-mail); `RESEND_API_KEY`, `INVITE_MAIL_FROM`,
  `SUPPORT_MAIL_FROM` and `SUPPORT_MAIL_TO`; `ALLOWED_ORIGINS` (optional; app.fincom.live and fincom.live are already in
  `_shared/cors.ts`).
- **GST:** `FYN_BASE_URL`, `FYN_CLIENT_ID`, `FYN_CLIENT_SECRET`, `FYN_RELAY_URL` and `FYN_RELAY_KEY`; then `TAXPRO_ASP_ID`,
  `TAXPRO_ASP_PASSWORD`, `TAXPRO_BASE_URL`, `TAXPRO_EINV_URL`, `TAXPRO_TRACK_PATH`, `TAXPRO_EVC_PATH`,
  `TAXPRO_LEDGER_PATH`, `TAXPRO_R1_PATH`, `TAXPRO_R3B_PATH`, `TAXPRO_STATUS_PATH`, `TAXPRO_STATUS_TRIES`,
  `TAXPRO_STATUS_WAIT_MS` and `TAXPRO_FILE_LIVE`, plus the `TAXPRO_EINV_TEST_*` set.
- **Tally:** `TALLY_UPLOAD_PIECE`, `TALLY_UPLOAD_MAX_TAIL` and `TALLY_WORK_VT` (optional).
- **Zoho, only with zoho-books:** `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URI` (live's address),
  `ZOHO_ACCOUNTS_URL`, `ZOHO_API_URL`, `ZOHO_MIN_GAP_MS` and `ZOHO_RUN_SECS`.
- **Assistant tuning (optional):** `ASSISTANT_CHAT_EFFORT`. `FINCOM_SENTRY` needs no setting on live, because Sentry is
  on only for staging's host.
- **Not determined:** which of these staging actually has set. The tools here cannot list function secrets, so the owner
  checks staging's list (Edge Functions → Secrets) against this one before the rehearsal.

**Platform keys** (`public.platform_secrets`, set in FinCom's admin as the platform admin):

| Name | On staging (26-Oct) | Used by | Live |
|---|---|---|---|
| `claude_api_key` | yes | gateway, fincom-assistant, gst-2b-match, tds-challan-match, fincom-transcribe, fincom-call (notes) | needed |
| `google_vision_key` | yes | gateway | needed |
| `groq_api_key` | yes | fincom-transcribe, fincom-call (live subtitles) | needed for transcripts and subtitles |
| `cf_realtime_app_id`, `cf_realtime_token` | yes | fincom-call (Cloudflare Realtime SFU) | needed for meetings of more than 4, or behind strict networks (1.7) |
| `cf_turn_key_id`, `cf_turn_key_token` | **no** | fincom-call (TURN, added to the ICE servers when set) | optional |
| `resend_api_key`, `resend_from` | **no** | mis-run (MIS by email), fincom-call (emailed invites) | optional; without them MIS is in-app only and the host copies the invite link |
| `call_guest_secret` | yes | fincom-call | **not set by hand**: fincom-call makes it on first use |

**Vault:**

- set by the owner: `fincom_project_url` (live's own address, 1.1.1), `gsp:taxpro:aspid`, `gsp:taxpro:password` and
  `connector_signing_passphrase`;
- made by the migrations: `gst_cron_key` (schema-golive), `tally_work_key` (13) and `zoho_cron_key` (75).

**`app_settings`:**

- `signup`: live has its own.
- `mis_run` = `{"url": "https://<live project id>.supabase.co/functions/v1/mis-run"}`: set after mis-run is deployed. The
  owner types live's id himself.

**Auth:** Site URL https://app.fincom.live/ with the redirect `https://app.fincom.live/**`. Apply
docs/security/14-owner-actions.md item 4.

**Resend:** the domain fincom.live must be verified there, both for invites (`RESEND_API_KEY`) and for MIS and call mail
(`resend_api_key`).

### 1.4 The app build that points at live, and where it is hosted

- **How the database is chosen** (unchanged).
  - The source in `src/js` stays in its live form, with `CLOUD_DEFAULT` naming live's database. `build.py` checks this.
  - `python3 build.py --react` writes `app/legacy/live.js` (live) and `test.js`. Only in `test.js` does it swap in
    staging's address and key.
  - `npm run build` (in app/) makes `app/dist` with live.js, and `npm run build:test` makes `app/dist-test`.
  - `app/publish-preview.sh` builds only dist-test.
- **`app/publish-live.sh`** (written 10-Oct, **not run**, unchanged since; last commit 176dcfb68).
  - It does nothing unless `LIVE_GO=1`. With `DRY=1` as well it does everything except the push.
  - It refuses uncommitted changes, and any commit other than `LIVE_SOURCE_COMMIT` when that is set.
  - It builds `app/dist`, then stops unless dist's `legacy.js` names live's project id and nothing in dist names staging
    or carries Sentry.
  - The owner's settings go in `~/.fincom/live.env`, outside the repository:

    ```sh
    LIVE_PROJECT_ID=<live's project id>          # 20 letters and digits; the build must name it
    LIVE_SOURCE_COMMIT=<the staging-next commit the rehearsal passed with>
    ```

  - Run `cd app && npm ci && LIVE_GO=1 DRY=1 ./publish-live.sh`, read the list of files, then `LIVE_GO=1 ./publish-live.sh`.
- **What the script does** in a fresh clone of `caanshulgarg/tds-desk`, branch `main`:
  - The first time only, it keeps the old app by copying the root `index.html` to `retired/build-199/index.html`.
  - It copies the build on top of the root in one commit and pushes.
  - It never deletes a file, and never overwrites `CNAME` or `assets/connector/*`.
- **Putting the old app back** takes about a minute, in a clone of tds-desk on main:

  ```sh
  cp retired/build-199/index.html index.html && git commit -am "Put back Build 199" && git push origin main
  ```
  Or `git revert` the "Live: React FinCom" commit and push.
- **The live build must be the 2.4.7-pairing app.** It must be built from staging-next at or after the 2.4.7 publish
  (`ed38661ee`); `365bbb5f5` qualifies. An older app cannot pair a 2.4.7 bridge.

**Hosting and DNS for app.fincom.live: depends on the owner's answer.** On 10-Oct the owner said the live site is GitHub
Pages of `caanshulgarg/tds-desk`, branch `main`. He now says he "set up Cloudflare", and we don't know what that covers.
Both ways keep `publish-live.sh`, which pushes to tds-desk main:

| | A. GitHub Pages (as decided 10-Oct) | B. Cloudflare Pages |
|---|---|---|
| Serves | tds-desk main, root, via GitHub Pages | the same tds-desk main, connected to a Cloudflare Pages project (no build command; output = repository root) |
| DNS | `app` CNAME → `caanshulgarg.github.io`. If the zone is on Cloudflare, set the record to **DNS only** (grey cloud) so GitHub can issue the certificate | Cloudflare adds the `app` record itself when app.fincom.live is added as a custom domain of the Pages project. Then remove the custom domain from tds-desk's GitHub Pages settings, so two hosts do not claim it |
| Headers | GitHub ignores `_headers`; the CSP is in the page's meta tag (build.py) | Cloudflare applies `_headers`. **Today's `_headers` says `microphone=()`, which blocks the microphone in meetings.** It must change to `microphone=(self)` (and stay `camera=(self)`) before B is used, and the build must carry that `_headers` at the root (not checked: does dist include it?) |
| Way back | the put-back commit above | the same commit (Cloudflare rebuilds from main), or Cloudflare's "Rollback" on the previous deployment |
| Unknown | whether tds-desk's Pages and DNS are as on 10-Oct | whether a Pages project exists, which account holds fincom.live's DNS, and whether "Cloudflare" meant only the meeting keys |

Whichever is chosen, lower the `app` record's TTL to 300 s a day before, so a change or put-back takes effect quickly.

### 1.5 The bridge for live users: 2.4.7

- **The files.** Give live users **2.4.7**: setup `FinComBridge-Setup-2.4.7.exe`, SHA-256
  `69aa6b742c74ec470c85b6f0b316580cf4741b0d54e81400418bfcd5c3448799`; program `FinComBridge-2.4.7.exe`, SHA-256
  `a6ea2ec52f45d2fcd4bbd8731b814f3f0b95f46680f6a83f69e3cab6c6e8b546`. They are the same files as
  `assets-test/bridge-go/` (published to staging review on 25-Oct, docs/bridge-2.4.7-notes.md).
- **Where it looks.** A bridge whose `CloudUrl` is not staging takes https://app.fincom.live/ as its FinCom address, and
  looks for updates at **https://app.fincom.live/assets/bridge-go/latest.json**. Live therefore needs its own
  `latest.json`, with the same two SHA-256s and URLs under `https://app.fincom.live/assets/bridge-go/`. Staging's file
  points at `staging.fincom.live/review/…`. As on staging, there is no `.sig` (`requireSignature: false`), so each
  computer is installed by hand once.
- **Still open from 10-Oct: the live build does not ship the Go bridge.**
  - `app/vite.config.js` emits `assets/bridge-go` only for a test build with `FINCOM_SHIP_BRIDGE=1`.
  - `build.py`'s live form still hands out the old PowerShell setup (`bridge-setup`).
  - Live users get 2.4.7 only after a small reviewed change to both (C, before the rehearsal; the owner approves). Or C
    places the four files and a live `latest.json` in tds-desk under `assets/bridge-go/` by a separate reviewed commit.
- **Pairing.** 2.4.7 pairs only with the SPAKE2 app (1.4). Live's computers run PowerShell 1.14.x. The Go bridge adopts a
  1.15.0 key, so a 1.14 computer is paired again with a connect code, and its PowerShell bridge stops posting once 2.4.7
  is its main bridge.
- **Releases.** On staging, `tally_bridge_releases` has 4 rows, none approved and not withdrawn, and runs "any computer,
  no pilot". Live's table is empty. The owner decides whether live needs release rows before 2.4.7 is allowed.

### 1.6 Sentry (decision unchanged)

The organisation garg-shekhar-company has three projects: app …4724864, cloud …5118080 and bridge …5642368. The owner's
condition of 08-Oct allows staging only, and the code enforces it:

- `_shared/sentry.ts` is on only when `SUPABASE_URL` is staging's;
- the bridge's `crash.go` is on only for staging's host;
- a live app build carries no Sentry code, and `publish-live.sh` refuses one that does.

**Live goes without Sentry** unless the owner widens the condition, which needs a code change and a new review. The owner
confirms "no Sentry on live" as part of saying go.

### 1.7 Meetings (calls inside FinCom)

- **What it needs on live:**
  - migrations 102, 103 and 106;
  - fincom-call v4 and fincom-transcribe v5;
  - the buckets `call-recordings` / `call-files` and the cron `call-retention`;
  - the platform keys in 1.3.
- **Cloudflare Realtime (SFU).** Without `cf_realtime_app_id` / `cf_realtime_token`, calls fall back to peer-to-peer with
  STUN, and at most 4 people. The owner makes a Realtime app for live in Cloudflare (1.4 does not depend on this) and
  pastes its App ID and token as platform keys. A separate app from staging's is recommended, so usage and keys are kept
  apart.
- **TURN (optional).** `cf_turn_key_id` / `cf_turn_key_token` add Cloudflare TURN to the ICE servers, for people behind
  strict office firewalls. Staging has none set.
- **Links.** Invite and join links are made from the page the host is on. If that page is not one of FinCom's own sites,
  fincom-call falls back to staging's address (`server/video-calls/handler.ts`, `siteBase`), and zoho-books does the same
  in `backTo`. app.fincom.live is in the allowed list, so this only matters if the site moves to another name.
- **Smoke check:** a two-person test call with subtitles on (step 13).

## 2. The go-live day, in order

**Before the day:**

- two clean rehearsals (section 3);
- the owner's written "go";
- the open items closed:
  - the go-live copies of 75b/95b, or a decision to leave them out;
  - 76 on the go-live branch;
  - the bridge-shipping change;
  - the 1.14.6 test re-run against tally-ingest @ 21edcfd26;
  - the hosting answer;
  - `_headers` if Cloudflare Pages;
- PITR on for at least a day;
- the `app` DNS TTL lowered.

| # | Step | Who | Time | Check | Way back |
|---|---|---|---|---|---|
| 1 | Tell staff: no FinCom work and no posting during the window | O | 5 m | — | — |
| 2 | **Full backup of live** (section 4 A):<br>• note the newest scheduled backup<br>• check PITR is on<br>• download a full dump<br>• download every storage bucket's files (a database backup holds no files) | O | 45–60 m | the dump opens; per-bucket file counts noted | — |
| 3 | Run the inventory query (1.1). Write down live's function versions, the Build number on screen and the platform key names | O | 10 m | C compares with 1.1 / 1.2 | — |
| 4 | **Lift the hook** for this session (section 4 D); switch on any missing extensions | O | 5 m | C reads one harmless `select 1` | put the hook back |
| 5 | Set Vault `fincom_project_url` to live's own address (1.1.1) | O | 5 m | the go-live copies' own check passes | — |
| 6 | Run the live-members-fix check (1.1.3) and the dry runs (1.1.2) again | O, C | 15 m | the numbers equal the ones sent before go, or the difference is explained | — |
| 7 | **Migrations 1–103 in the order of 1.1:**<br>• 13, 16 and schema.sql as go-live copies; 75b/95b as copies or left out<br>• each file md5-checked, its functions read back by md5(prosrc)<br>• 48 and 50 by O in the SQL editor<br>• the dry runs again just before 13, 23, 27, 32, 37 and 91, with their checks after<br>• **97 last of all** | C (+O) | 4–5½ h | each file: md5 equal, functions matched; 1.1.2's checks agree; 97's read-back equals the fixture; cron / buckets / queues / publication match 1.1 | stop; restore from step 2 (PITR to before step 7, or the dump) |
| 8 | Vault and settings:<br>• check `gst_cron_key`, `tally_work_key` and `zoho_cron_key` were made<br>• the GSP items and `connector_signing_passphrase`<br>• Auth URLs<br>• platform keys (1.3) | O | 20 m | `select jobname, status from cron.job_run_details order by start_time desc limit 20` shows `tally-work` succeeding | — |
| 9 | Function secrets (1.3), then deploy the functions of 1.2 with staging's pins. Then set `app_settings` `mis_run` | C (O sets values) | 45 m | CORS preflight from app.fincom.live; versions noted; one bridge 1.14 beat answered | redeploy the versions noted in step 3 (new ones: delete) |
| 10 | **Hosting / DNS: depends on owner's answer** (1.4 A or B). Nothing to do if GitHub Pages already serves app.fincom.live and stays | O | 0–30 m | https://app.fincom.live/ answers with a valid certificate | the DNS record as it was (TTL 300 s) |
| 11 | Build and publish the live app with `publish-live.sh` (DRY first) | C | 30 m | app.fincom.live shows the new build stamp; sign-in works | put the old app back (1.4; about a minute) |
| 12 | Put bridge 2.4.7 and live's `latest.json` on the site; pair the first computer with a connect code | C, O | 20 m | the setup's SHA-256 matches; the Tally page shows 2.4.7; a beat within 1 minute | the computer keeps 1.14 until paired; the old setup is in tds-desk's history |
| 13 | Smoke checks:<br>• sign in (owner and one staff)<br>• open a client, upload a bill, Look up<br>• **Post to Tally into a test company**<br>• the `tally-recorder-drain` cron runs<br>• Ask FinCom answers<br>• a 2-person **test meeting** with subtitles<br>• one MIS run by hand | O, C | 45 m | each one passes | step 11's way back; the data stays |
| 14 | **Put the hook back**; tell staff to start | O | 5 m | C cannot reach live | — |

**Total: about 8–10 hours**, so plan a whole quiet day (a Sunday) and start early. The rehearsal replaces these times
with measured ones. Installing 2.4.7 on the rest of the computers (about 15 minutes each) can follow over the next days.

**Point of no return.** Once staff save work in the new app (after step 14), a restore loses that work. Until then the
backup from step 2 is a full way back. If any step fails, stop, decide together, and if needed restore (PITR to the
moment before step 7) and put the old app back.

## 3. Rehearsal (twice, before the real day)

1. **The copy.** The owner restores live's newest backup to a **new throwaway project** (section 4 C) and gives Claude
   its id. A Supabase branch starts empty, so it rehearses less. The hook stays on throughout. The copy has its own id,
   so the hook does not block it, and if the id given were live's, the hook would refuse every call.
2. **Treat it as live data.** The copy holds real clients. Claude reads only counts and totals from it. The owner deletes
   the project after each rehearsal.
3. **Run steps 3 and 5–13 exactly as in section 2, timing each.**
   - Set `fincom_project_url` and `app_settings` `mis_run` to the copy's own address, never staging's (the go-live
     copies refuse staging anyway).
   - Point a local live build (1.4, with the copy's id in a separate settings file), or a bridge's `CloudUrl`, at the
     copy.
   - Post into a test company only.
   - Use live's meeting keys, or none: a 2-person call works without the SFU.
   - A restore copies no storage files, so test uploads only.
4. **Record** for each file:
   - the minutes it took;
   - whether it ran in pieces or in the SQL editor;
   - any lock wait, especially 23, 32, 37, 45 and **76**;
   - the dry runs and checks of 1.1.2 before and after 13, 23, 27, 32, 37 and 91.
5. **Done when** every step passes **twice, from two separate restores**, and section 2's times are replaced with the
   measured ones. A failure means a fix, then two new clean passes.

## 4. What only the owner can do (with the clicks)

Menu names are as of Oct-2026 and may have moved a little in the dashboards.

- **A. Backup of live, including the files.**
  1. Supabase → live project → **Database → Backups → Scheduled backups**: note the newest, and **Download** it.
  2. A dump of your own on your computer. Get the connection string from **Project Settings → Database → Connection
     string** (URI). Then run `supabase db dump --db-url "<uri>" -f live-schema.sql`, the same with `--data-only -f
     live-data.sql`, and with `--role-only -f live-roles.sql`.
  3. Storage files. Count them with the read-only `select bucket_id, count(*), sum((metadata->>'size')::bigint) from
     storage.objects group by 1;`, then download each bucket: **Storage → bucket → select all → Download**. For many files,
     use the Supabase CLI's storage copy. Compare the counts.
  4. Keep the copies off Supabase: your laptop plus a Drive folder.
- **B. PITR.** Go to **Project Settings → Add-ons → Point in time recovery**, choose 7 days and confirm. It is a paid
  add-on and needs a Small compute or larger. Switch it on at least a day before. To use it: **Database → Backups → Point
  in time → choose the minute → Restore**.
- **C. Restore to a new project (for each rehearsal).**
  1. Go to **Database → Backups**, pick the newest backup and choose **Restore to a new project**. Use the name
     `fincom-rehearsal-1` (then `-2`) and the same region, then wait until it is ready.
  2. Send Claude the new project's id.
  3. If the dashboard does not offer this, create a new project and Claude writes the commands to load your dump into it.
  4. Afterwards: **Project Settings → General → Delete project**.
- **D. Lifting and restoring the hook (go-live day only).**
  1. In the working copy this session runs from, disable the `PreToolUse` entry that runs
     `.claude/hooks/block-production.sh` in `.claude/settings.json`. Change it locally only: never commit or push it.
     Claude never edits it.
  2. To put it back: `git checkout -- .claude/settings.json .claude/hooks/block-production.sh`. Claude then tries one
     call naming live, and it must be refused.
  3. The rehearsals never need the hook lifted.
- **E. Vault secrets.** Go to **Database → Vault → Add new secret**, or use the SQL in 1.1.1. Add `fincom_project_url`
  (live's own `https://<id>.supabase.co`), `gsp:taxpro:aspid`, `gsp:taxpro:password` and
  `connector_signing_passphrase`.
- **F. Function secrets.** Go to **Edge Functions → Secrets → Add** and add each name in 1.3 with live's values. Also
  compare staging's list with 1.3 before the rehearsal.
- **G. Platform keys.** In FinCom as the platform admin, open the admin's keys and set `claude_api_key`,
  `google_vision_key`, `groq_api_key`, `cf_realtime_app_id` and `cf_realtime_token`. Optionally also set
  `cf_turn_key_id` / `cf_turn_key_token` and `resend_api_key` / `resend_from`.
- **H. Resend domain.**
  1. resend.com → **Domains → Add domain** → `fincom.live`.
  2. Add the DNS records it shows (an MX and an SPF TXT on its sending subdomain, and the DKIM TXT
     `resend._domainkey`) wherever fincom.live's DNS is (Cloudflare, if that is what was set up). Then **Verify**.
  3. **API Keys → Create**, with sending access for fincom.live. Paste it as the function secret `RESEND_API_KEY` and the
     platform key `resend_api_key`.
- **I. Auth URLs.** Go to **Authentication → URL Configuration**. Set the Site URL to `https://app.fincom.live/` and add
  the Redirect URL `https://app.fincom.live/**`, then Save. Then do docs/security/14-owner-actions.md item 4.
- **J. Hosting / DNS: depends on your answer** (1.4).
  - **A, GitHub Pages:**
    1. tds-desk → **Settings → Pages**: Source "Deploy from a branch", `main`, `/ (root)`.
    2. Custom domain `app.fincom.live` → Save → **Enforce HTTPS**.
    3. DNS: `app` CNAME `caanshulgarg.github.io`. On Cloudflare, set it to **DNS only**.
  - **B, Cloudflare Pages:**
    1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → `caanshulgarg/tds-desk`.
    2. Production branch `main`, framework None, no build command, output = repository root → **Save and Deploy**.
    3. In the project: **Custom domains → Set up a custom domain** → `app.fincom.live`.
    4. Then remove the custom domain from tds-desk's GitHub Pages.
    5. Only after Claude's `_headers` change (microphone).
- **K. Meeting keys.**
  1. dash.cloudflare.com → **Realtime → Serverless SFU → Create application** ("FinCom live"). Copy the App ID and the
     App token into G.
  2. Optional: **Realtime → TURN Server → Create**. Copy the Turn token ID and the API token into G.
- **L.** Say **"go" in writing** after two clean rehearsals, and confirm "no Sentry on live".
- **M.** Run 48 and 50 (and any piece the tool times out on) in live's SQL editor.
- **N.** Paste the inventory query, the live-members-fix check and the dry runs before go, and send the results.
- **O.** Fill in `~/.fincom/live.env` (1.4).
- **P.** Install bridge 2.4.7 on each live user's computer (docs/bridge-2.4.7-test-sheet.txt) and pair each one with a
  connect code.
- **Q. Decide:**
  - Zoho on live (zoho-books, 75b copy);
  - the automatic 2B cron (95b copy);
  - bridge release rows;
  - which computers get 2.4.7 first;
  - **what "set up Cloudflare" covered**.

## 5. Risks and open questions

1. **Staging's address in cron files.**
   - 13, 16 and gst-taxpro/schema.sql: **addressed** by the go-live copies (1.1.1), which were tested and approved on
     10-Oct.
   - **75b and 95b: open.** Their go-live copies are not written yet. Until they are, leave both out on live.
2. **Live's starting point is not known.** The list assumes live has exactly Build 199. The inventory query decides; if
   live is ahead or behind, the list changes before anything runs.
3. **Data that migrations transform:** 13 (wake tokens), 23 (names, day totals rebuilt), 27 (`postTo`), 32 and 37
   (voucher origins), and **91** (book start dates). Only the backup undoes them. Each has a dry run and a check (1.1.2).
   91's dry run is not yet in `tests/run_golive_dryrun.py`, and **91 has no record of running on staging**.
4. **31 is skipped** (owner, 10-Oct). **61 runs**; old Build 199 tabs fail their writes afterwards, so everyone reloads.
   The live-members-fix status is unknown, so the check in 1.1.3 decides.
5. **76 is not on staging-next.** It lives on `origin/db-speed` (76c65c4b0), and staging ran that exact text. It must be
   brought over byte for byte. It also rewrites `tally_lines` / `tally_bills` to add their keys, so on live's data it may
   be the longest lock of the day. The rehearsal times it.
6. **Staff accounts:** invites need `APP_URL` and Resend, and every staff member must still sign in during step 13.
7. **Bridges 1.14 during and after the window.**
   - On 10-Oct `tests/run_bridge_1146_server.py` proved that tally-ingest **v43** accepts PowerShell 1.14.6.
   - Staging now runs **v58 (21edcfd26)**. **Re-run that test, plus `run_main_bridge_server.py` and
     `run_bridge_control_server.py`, against 21edcfd26 before the first rehearsal.**
   - Once 2.4.7 is a computer's main bridge, 1.14 on that computer is refused postings by design.
8. **The live build ships no Go bridge yet** (1.5): a small reviewed change is still needed. 2.4.7 needs the SPAKE2 app,
   so the app and the bridge go out together.
9. **Grants after 30-Oct** (1.1.4). 97 runs last, and the newer files carry their own GRANTs. 98's tables will be
   narrower on live than on staging, and the rehearsal confirms the period-fetch screens.
10. **Hosting unknown** (1.4). Cloudflare Pages would apply `_headers`, whose `microphone=()` breaks meetings until
    changed. Two hosts must not both claim app.fincom.live.
11. **Edge functions are pinned imports** of `caanshulgarg/testingtdsdesk` commits. A deploy fetches from GitHub at
    deploy time, so the repository must be reachable then. Running functions do not need it.
12. **signup's source is not in the repository.** Live keeps its own, untested against the new schema.
13. **What cannot be undone without a restore:**
    - the data changes in item 3;
    - the privileges revoked by 4, 58, 61 and 70;
    - pg_cron jobs that have already called out;
    - mail already sent (MIS, invites).
14. **The window's length** depends on live's data size, now with 37 more files. 23, 32, 37, 45 and 76 lock tables, and
    the rehearsal measures how long.
15. **Storage files** are in no database backup, and a restore to a new project copies none. The owner's download in
    step 2 is the only copy.
16. **Meetings' running costs:** Cloudflare Realtime, Groq and Claude. Recordings live in `call-recordings` until
    `call-retention` clears them. The owner confirms the budget before turning meetings on for staff.
17. **Stale lines in docs/MIGRATION-ORDER.md.** 90, 93, 100, 101, 102 and 103 still say "not run on staging", but all
    are present on 26-Oct. This checklist reflects what staging holds; MIGRATION-ORDER should be corrected in a separate
    change.
18. **Not determined from here:**
    - which Edge Function secrets staging has set (no tool lists them);
    - how 99–103 were applied on staging (they are not in the tool's migration list or the piece store; the bodies match
      the files);
    - whether 91 ran on staging;
    - live's current state (never read);
    - what the owner's Cloudflare set-up covers.
