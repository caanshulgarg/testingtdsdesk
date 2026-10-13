-- migration-76-db-speed.sql (13-Oct-2026, branch db-speed; the owner's "Database speed up and remove the temporary counts
-- table ok" of 13-Oct-2026). From Supabase's performance advisor on staging, read again on 13-Oct-2026 18:04 UTC.
--
-- 1. An index on each foreign key the advisor lists as unindexed (unindexed_foreign_keys): 16 on the tables FinCom has had
--    since 74, plus the two on 75's Zoho tables (zoho_connections.grant_id, zoho_post_jobs.connection_id), which are made
--    only where 75 has run (a database without 75 has no such tables; nothing is made there).
--    Plain CREATE INDEX, not CONCURRENTLY: CONCURRENTLY cannot run inside a transaction, and these tables are small (the
--    largest, tally_sync_cursor, is under 100 kB on staging), so the short lock a plain create takes is acceptable.
-- 2. The six row-security policies the advisor lists under auth_rls_initplan, made again with each auth.uid() written as
--    (select auth.uid()), so it is worked out once per statement, not once per row. Each is otherwise exactly the
--    definition read from pg_policies on staging on 13-Oct-2026: the same table, command, role (authenticated), PERMISSIVE,
--    USING and WITH CHECK. Dropped and made again inside this one transaction, so no moment is without the policy.
-- 3. A primary key for tally_lines and tally_bills (the advisor's no_primary_key): a column `id bigint generated always as
--    identity`, the primary key, added only when the table has no primary key. Every insert into the two tables (the
--    ingest functions, migration-7 onwards) names its columns, so a new column changes none of them; the triggers on
--    tally_lines read book_id only. The identity sequences are not granted to anon or authenticated (nobody inserts
--    directly; the ingest functions are security definer and an identity column needs no right on its sequence).
-- 4. The advisor's unused indexes are left as they are (nothing dropped).
--
-- Runs after 74 (and after 75 where 75 runs); needs migration-2-mfa-audit (members, activity), 32, 36b, 44, 47, 49, 54, 55,
-- 68 (their tables). Add-only apart from the six policies made again; one transaction, lock_timeout 10 s, no row
-- deleted, safe twice. Tested by tests/run_migration76.py and tests/run_migration_order.py.
begin;
set local lock_timeout = '10s';

-- 1. indexes on the unindexed foreign keys
create index if not exists drop_keys_firm_id_idx on public.drop_keys (firm_id);
create index if not exists firm_modules_code_idx on public.firm_modules (code);
create index if not exists firms_plan_id_idx on public.firms (plan_id);
create index if not exists tally_alerts_book_id_idx on public.tally_alerts (book_id);
create index if not exists tally_bridge_alerts_device_id_idx on public.tally_bridge_alerts (device_id);
create index if not exists tally_bridge_alerts_firm_id_idx on public.tally_bridge_alerts (firm_id);
create index if not exists tally_bridge_ids_device_id_idx on public.tally_bridge_ids (device_id);
create index if not exists tally_bridge_prefs_firm_id_idx on public.tally_bridge_prefs (firm_id);
create index if not exists tally_bridge_release_log_firm_id_idx on public.tally_bridge_release_log (firm_id);
create index if not exists tally_companies_device_id_idx on public.tally_companies (device_id);
create index if not exists tally_company_lease_firm_id_idx on public.tally_company_lease (firm_id);
create index if not exists tally_member_bridges_device_id_idx on public.tally_member_bridges (device_id);
create index if not exists tally_post_checks_firm_id_idx on public.tally_post_checks (firm_id);
create index if not exists tally_post_marks_firm_id_idx on public.tally_post_marks (firm_id);
create index if not exists tally_sync_cursor_firm_id_idx on public.tally_sync_cursor (firm_id);
create index if not exists tally_tieouts_book_id_idx on public.tally_tieouts (book_id);
-- 75's two (zoho-books), only where 75 has run
do $zoho$ begin
  if to_regclass('public.zoho_connections') is not null then
    create index if not exists zoho_connections_grant_id_idx on public.zoho_connections (grant_id);
  end if;
  if to_regclass('public.zoho_post_jobs') is not null then
    create index if not exists zoho_post_jobs_connection_id_idx on public.zoho_post_jobs (connection_id);
  end if;
end $zoho$;

-- 2. the six policies, auth.uid() as (select auth.uid()); otherwise as on staging
drop policy if exists members_self on public.members;
create policy members_self on public.members as permissive for update to authenticated
  using ((user_id = (select auth.uid())))
  with check (((user_id = (select auth.uid())) and (firm_id = my_firm())));

drop policy if exists members_read on public.members;
create policy members_read on public.members as permissive for select to authenticated
  using (((user_id = (select auth.uid())) or (firm_id = my_firm()) or is_superadmin()));

drop policy if exists activity_write on public.activity;
create policy activity_write on public.activity as permissive for insert to authenticated
  with check (((firm_id = my_firm()) and (user_id = (select auth.uid()))));

drop policy if exists tally_post_row_flags_read on public.tally_post_row_flags;
create policy tally_post_row_flags_read on public.tally_post_row_flags as permissive for select to authenticated
  using (((firm_id = my_firm()) and ((kind = 'remove'::text) or (user_id = (select auth.uid())))));

drop policy if exists app_alert_dismissals_read_own on public.app_alert_dismissals;
create policy app_alert_dismissals_read_own on public.app_alert_dismissals as permissive for select to authenticated
  using (((user_id = (select auth.uid())) and (firm_id = my_firm())));

drop policy if exists app_alert_dismissals_add_own on public.app_alert_dismissals;
create policy app_alert_dismissals_add_own on public.app_alert_dismissals as permissive for insert to authenticated
  with check (((user_id = (select auth.uid())) and (firm_id = my_firm()) and (undone_at is null)));

-- 3. primary keys for tally_lines and tally_bills, only when the table has none
do $pk$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.tally_lines'::regclass and contype = 'p') then
    alter table public.tally_lines add column id bigint generated always as identity;
    alter table public.tally_lines add constraint tally_lines_pkey primary key (id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tally_bills'::regclass and contype = 'p') then
    alter table public.tally_bills add column id bigint generated always as identity;
    alter table public.tally_bills add constraint tally_bills_pkey primary key (id);
  end if;
end $pk$;
revoke all on sequence public.tally_lines_id_seq, public.tally_bills_id_seq from public, anon, authenticated;

commit;
