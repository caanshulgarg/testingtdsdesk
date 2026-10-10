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
`tests/run_migration_order.py` checks. Anything the inventory shows live already has is skipped. That gives **67 files: 66 to run, plus 31 for the owner to decide**. Add `gst-taxpro/golive/schema-golive.sql` (the go-live copy of
`gst-taxpro/schema.sql`, 1.1.1) if live has no `gst_sessions` table: its header says "apply the same on live before
gst-taxpro goes there". Run it before step 13 (16 alters `gst_sessions`).
Every md5 is `md5sum` of the file on tax-accuracy at the commit of this document; 61's comes from branch `perms-61`.
Folders are under `server/`. "GO-LIVE COPY" means the original names staging's web address in a pg_cron job, so live
runs the copy in 1.1.1 instead (nothing is edited by hand any more). "CHANGES DATA": see the dry runs in 1.1.2.

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
| 28 | 31 | `tally-cloud/migration-31-clean-names.sql` | `45ed0b283c274132b3dc27abdd9527c8` | **NOT run on staging** (no `raw_name` column there). **Recommended: skip** (1.1.3) |
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
| 59 | 61 | `tally-cloud/migration-61-privileges.sql` | `cec075a148f26144fd1808c94b841684` | **only on branch perms-61** (not in tax-accuracy's tree): bring the file over first; closes members self-promotion. **Recommended: run** (1.1.3) |
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
- Live has real data in the cloud copy, and these files change it as they run: 13, 23, 27, 32 and 37. 1.1.2 has, for
each, a read-only dry run that counts the rows it will change, and a check to run just before and just after it.
- The SQL editor rule: 43, 44, 48, 50, 55 and 68 were run by the owner in the SQL editor on staging. On live, 48 and 50
must be run that way, by the owner. The others may go in md5-checked pieces as on staging (`docs/HANDOVER.md`, "How to
apply a migration").
- **Extensions live needs** (staging has these): pg_cron 1.6.4, pg_net 0.20.4, pgmq 1.5.1, supabase_vault 0.3.1, pgcrypto
and uuid-ossp. The owner switches on any that are missing (Database → Extensions) before step 4 below.

**pg_cron jobs after the migrations** (as on staging; `tds-desk-nightly-backup` should already be there; times UTC):
`tally-work` every 30 s and `tally-post-requeue` every minute (13, go-live copy); `gst-taxpro-refresh` */20 and `gst-daily`
01:30–05:30 hourly (schema.sql and 16, go-live copies); `tally-recorder-drain` every 30 s, `tally-alert-gaps` */10,
`tally-alert-silent` */30 03–13 Mon–Sat, `tally-alert-summary` 13:30 (47); `tally-recorder-archive-trim` 21:17 (48).
**pgmq queues:** `tally_work` (13) and `tally_recorder` (47). **Vault:** `tally_work_key` (made by 13) and `gst_cron_key`
(made by schema.sql). **Buckets:** `support-files`, `tally-days` and `tally-support` (should be there already), and
`tally-uploads` (47).

#### 1.1.1 The go-live copies of 13, 16 and gst-taxpro/schema.sql (risk 1)

The originals name staging's address in their pg_cron jobs. Live runs these copies **instead of** the originals
(staging keeps the originals; they are not edited). Each copy is the original with three changes only: the job reads
this project's own address from a Vault secret, `fincom_project_url`, every time it runs (no project address is written
in the file); the file stops with a clear message, before changing anything, if that secret is missing, is not of the
form `https://<project id>.supabase.co`, or names staging; and it runs twice cleanly (13 adds `tally_jobs` to the realtime
publication only when it is not there yet; 16 and schema.sql now run in one transaction).

| Go-live copy (run on live) | md5 (for the owner to approve) | Replaces on live |
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

#### 1.1.3 Migrations 31 and 61: run or skip

- **31 (`tally-cloud/migration-31-clean-names.sql`): recommended SKIP.** It is a one-time rewrite of names already kept
  (entities, two spaces read for a line break, twins with one key). It never ran on staging, so staging, which is
  what was tested and reviewed, has lived without it since 02-Oct; the tested fresh order goes from 30 to 32 without it.
  Everything after it copes without it: 34, 36 and 41 check whether its column `before_clean` is there, 36 adds that
  column itself, and tally-ingest reads it only when present. Running it on live would be its first run anywhere on real
  data, after 36–66 instead of before them (an order nobody has tested), and it rewrites names in every table of the
  cloud copy. The names it would fix also get fixed the normal way: tally-ingest now cleans names on the way in, the
  next ledger list rebuilds the masters, and "Read the kept day books again" rebuilds a book's entries. If, after the
  go-live, a book shows one ledger under two names, read that book again rather than run 31.
- **61 (`tally-cloud/migration-61-privileges.sql`, branch perms-61, md5 cec075a148f26144fd1808c94b841684):
  recommended RUN**, as step 59. It ran on staging on 06-Oct and staging has worked with it since (pub-241 included). It
  closes two real holes that live has today: anyone with the public key could empty (TRUNCATE) most public tables, and a
  staff member can make themselves owner with one request (members self-promotion). It only revokes privileges (no row,
  table or policy removed) and checks itself at the end. Before it runs: bring the file (with `tests/run_migration61.py`)
  onto tax-accuracy and check the md5. Risks: a Build 199 tab left open would fail its writes, so it runs in the window
  while no one works and everyone reloads after; a page refused afterwards is fixed by the one grant its header names.
  If 61 is skipped, run `live-members-fix.sql` (perms-61, md5 fd84f633…) at least, unless the owner already did.

### 1.2 Edge functions (staging versions, read 10-Oct)

Deploy each one with the files listed in `server/_shared/README.md`. Always include `../_shared/cors.ts`. Before deploying, the owner
writes down live's current version of each function: that is the way back.

| Function | Staging | Source | Note |
|---|---|---|---|
| tally-ingest | v43 | server/tally-cloud (index.ts, parse.js, _shared/cors.ts, names.js, sentry.ts, sentry-scrub.js) | the index.ts deployed with comments stripped, SHA-256 82d4e873…18f7 (docs/bridge-2.4.1-notes.md); verify_jwt off. Accepts bridge 1.14.6 (risk 7) |
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
  and not live.
- **The live publish script: `app/publish-live.sh`** (written 10-Oct, **not run**). It does nothing unless `LIVE_GO=1`;
  with `DRY=1` as well it does everything except the push. It refuses a checkout with uncommitted changes (and, when
  `LIVE_SOURCE_COMMIT` is set, any commit other than that one), builds `app/dist` (`build.py --react`, `npm run build`),
  and stops unless dist's `legacy.js` names live's project id and nothing in dist names staging or carries Sentry. Then,
  like publish-preview.sh, it copies the build into one folder of the live site's repository, commits, and refuses to push
  if any file outside that folder would change. The repository holds no live project id: the owner writes his settings in
  **`~/.fincom/live.env`** (or the path in `LIVE_CONFIG`), outside the repository (the script refuses a settings file
  inside a git work tree that is not ignored there):

  ```sh
  LIVE_PROJECT_ID=<live's project id>          # 20 letters and digits; the build must name it
  LIVE_SITE_REPO=https://github.com/caanshulgarg/tds-desk.git
  LIVE_SITE_BRANCH=main                        # the branch Pages publishes from
  LIVE_FOLDER=app                              # the folder the build goes into (not the root)
  LIVE_SOURCE_COMMIT=601e57ad                  # optional: the commit staging shows
  LIVE_URL=https://app.fincom.live/app/        # optional: only printed
  ```
  Run: `cd app && npm ci && LIVE_GO=1 DRY=1 ./publish-live.sh`, read the list of files, then `LIVE_GO=1 ./publish-live.sh`.
  Tried here only on its refusals (no LIVE_GO, no settings file, staging's id, a settings file inside the repository, a
  wrong folder, uncommitted changes); a full dry run needs live's id, which this session may not name.
- **Build from the staging commit.** Build from the commit staging shows: pub-241 601e57ad (main b6d6fcdd; arc-ui
  840b5331 merged with tax-accuracy c89c58ff). Run `npm ci` first.
- **Hosting.** Per docs/setup.md (step 7), live is `caanshulgarg/tds-desk` on GitHub Pages (Build 199 is its root
  `index.html`, one file). The repository does not say that app.fincom.live is that repository's Pages address (this
  repository's own CNAME is staging.fincom.live; tds-desk cannot be read from this session): **owner question**. Because
  the script changes one folder only, the React build lands at `<site>/<folder>/` and Build 199's root page stays until a
  separate, reviewed one-file commit makes the root forward to the folder, as staging's root forwards to /review/
  (**owner question**: which folder, and when the root switches; switching it back is the way back).
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
| 5 | O sets the Vault secret `fincom_project_url` (1.1.1); O runs the dry runs again (1.1.2). Migrations in the order of 1.1 (13, 16 and schema.sql as go-live copies), each md5-checked; 48 and 50 by O in the SQL editor; functions read back by md5(prosrc) as on staging | C (+O) | 2½–3½ h | each file: md5 equal, functions matched; the checks of 1.1.2 before and after 13/23/27/32/37 agree with the dry runs | stop; restore from step 2 (or PITR to before step 5) |
| 6 | Vault and settings: `gst_cron_key` (made by schema.sql), the GSP items, Auth URLs, platform keys | O | 15 m | cron jobs listed; `tally-work` runs without an error in `cron.job_run_details` | — |
| 7 | Function secrets (1.3), then deploy the 7 functions; tally-ingest checked byte for byte | C | 30 m | CORS check from `server/_shared/README.md` against live; versions noted | redeploy the versions noted in step 3 |
| 8 | Build and publish the live app with `app/publish-live.sh` (1.4: DRY first; it checks legacy.js names live) | C | 30 m | app.fincom.live shows the new build stamp; sign-in works | revert the tds-desk commit (Build 199 comes back) |
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
3. **Run steps 3, 5, 6, 7 and 10 exactly as in section 2, timing each.** Set `fincom_project_url` on the copy to the copy's
   own address (never staging's: the go-live copies refuse it anyway). Point a local live build (1.4), or a bridge's `CloudUrl`,
   at the copy. Post into a test company only.
4. **Record** for each file: the minutes it took, whether it ran in pieces or in the SQL editor, and any lock wait.
   Run the dry runs and checks of 1.1.2 before and after 13, 23, 27, 32 and 37, and record them.
5. **Done when** every step passes twice, from two separate restores, and section 2's times are replaced with the
   measured ones.

## 4. What only the owner can do

- Take the full backup of live (and of the storage files), and keep it off Supabase.
- Lift the block-production hook for the go-live window, and put it back the same day.
- Say "go", in writing, after the rehearsal has passed.
- Run 48 and 50 (and any piece the tool times out on) in live's SQL editor.
- Paste the inventory query and send back what it shows.
- Approve the go-live copies of 13, 16 and schema.sql (md5s in 1.1.1), and set `fincom_project_url` in live's Vault.
- Run the dry runs of 1.1.2 in live's SQL editor before go and send the numbers.
- Fill in `~/.fincom/live.env` for `app/publish-live.sh` (1.4).
- Set the secret values: function secrets, vault, platform keys, Resend domain, Auth settings.
- Install bridge 2.4.1 on each live user's computer (NWS144 steps as in docs/bridge-2.4.1-test-sheet.txt), and pair
  each one with a connect code.
- Decide on 31 (recommended: skip) and 61 (recommended: run) (1.1.3), whether whether Sentry stays off on live, and which computers get the bridge.

## 5. Risks and open questions

1. **Staging's address is written into 13, 16 and gst-taxpro/schema.sql.** Run as they are, live's timers would call
   staging every 30 seconds. **Addressed:** live runs the go-live copies (1.1.1), which read the address from live's
   Vault and refuse staging's; tested. Left: the owner approves their md5s and sets the secret.
2. **Live's starting point is not known.** This list assumes live has exactly Build 199's files. The inventory query
   decides; if live is ahead or behind, the list changes before anything runs.
3. **Data that migrations transform:** 23 renames names and rebuilds `tally_ledger_day` days; 27 sets clients'
   `postTo`; 32 and 37 re-mark voucher origins; 13 gives every device a new wake token. None of these is undone by a later migration. Only the backup undoes them. **Addressed:** a dry run and a
   before/after check for each (1.1.2), tested; the owner runs the dry runs before go.
4. **31 never ran on staging** (`tally_ledgers.raw_name` is missing there), yet it is in the numbered chain. The tested
   order goes from 30 to 32 without it. **Recommended: skip** (1.1.3).
5. **61 is not on tax-accuracy** (only on `perms-61`). It narrows what `authenticated` may write on clients, records
   and activity. Old Build 199 tabs left open would then fail their writes. `live-members-fix.sql` (perms-61, md5
   fd84f633…) was for the owner to run on live: was it run? **Recommended: run 61** (1.1.3).
6. **Staff accounts:** 61 closes members self-promotion; invites need `APP_URL` and Resend; the platform admin's
   second step (admin function) is not switched on. Check that every live staff member can still sign in during step 10.
7. **Bridges 1.14 during and after the window.** **Tested 10-Oct:** tally-ingest as in the repository (staging's v43)
   accepts bridge 1.14.6. `tests/run_bridge_1146_server.py` (new; the real index.ts under Deno against the stand-in for
   Supabase) sends every call 1.14.6 makes, with its exact bodies (bridge/cloud.ps1 at f447539fe): hello, companies,
   ledgers, days (gz), state, beat, posts_take, posts_update; each is answered 200 with the fields 1.14.6 reads (links,
   done, updateNow, posts, the job with its payload), and a queued posting goes waiting → taken → running → done (14
   checks, all passed). `run_main_bridge_server.py` (133 checks) and `run_bridge_control_server.py` (61) also pass. What
   this does not cover: the database functions are stand-ins there (their SQL is tested by the migration tests); a
   posting made by the new app is not tried through 1.14.6's own PowerShell; and once a 2.x bridge is made a computer's
   main bridge, 1.14/1.15 on that computer is refused postings by design. During the window (before step 7) live still
   runs its own tally-ingest; 1.14 computers keep syncing, so the dry runs are repeated just before each file.
8. **The bridge release table.** On live, `tally_bridge_releases` and the allow-list are empty. Staging runs with "any
   computer, no pilot". The owner should check whether live needs the same release rows before 2.4.1 is allowed.
9. **The live build ships no Go bridge** (1.4). `app/publish-live.sh` now exists (not run). The bridge files and the
   root page still need a small reviewed change before the go-live.
10. **signup's source is not in the repository.** Live keeps its own copy, untested against the new schema.
11. **What cannot be undone without a restore:** the data changes in item 3, the privileges revoked by 4, 58, 61 and
    70, and pg_cron jobs that have already called out.
12. **The window's length depends on live's data size.** 23, 32, 37 and the RESTRICT swaps in 45 lock tables. The
    rehearsal measures how long.
13. **Owner questions (10-Oct):** (a) is app.fincom.live the GitHub Pages address of `caanshulgarg/tds-desk`, and from
    which branch does it publish? (b) which folder should the React build go into, and when does the root page switch to
    it? (c) approve the three go-live copies' md5s (1.1.1); (d) skip 31 and run 61, as recommended (1.1.3)? (e) was
    `live-members-fix.sql` run on live?
