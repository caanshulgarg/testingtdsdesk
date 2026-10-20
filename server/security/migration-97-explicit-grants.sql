-- migration-97-explicit-grants (20-Oct-2026, branch next-grants; ROUND 101). Why: from 30-Oct-2026 Supabase no longer
-- gives anon, authenticated and service_role automatic privileges on NEW tables, views and sequences in schema public.
-- Tables that exist keep theirs, so staging is unaffected; but every migration replayed on a database that does not have
-- the tables yet (the live project's go-live, a Supabase branch, a rehearsal copy, `db reset`) would make tables nobody
-- can reach through the Data API or the edge functions ("permission denied", service_role included). About half of our
-- migrations made tables relying on the old automatic privileges.
--
-- What it does: for each of the 166 relations below, the EXACT privileges staging has today, written out as GRANTs
-- (read-only from staging on 20-Oct-2026: tests/fixtures/staging-grants-20261020.json, which tests/run_migration_grants.py
-- compares against a fresh database). Nothing beyond what staging holds today is given to anyone.
--   - On staging it changes nothing (every grant is already held).
--   - On the live project and on fresh copies, run it AFTER all the other migrations: it gives the same access as staging.
--   - A relation that is not on the database is skipped with a notice (never an error).
--   - MAINTAIN (a PostgreSQL 17 privilege, held on staging) is granted only on PostgreSQL 17 or later.
--   - Left out: _bankscrub_baseline_20261013 (the owner is deciding whether it is locked or deleted).
-- Add-only: GRANTs only; nothing is taken away, dropped or deleted; the default privileges are left as they are; functions
-- are not touched (Supabase's change does not cover them). One transaction. Safe to run twice.
-- From now on every migration that makes a table in public grants its privileges in the same file (docs/MIGRATION-ORDER.md).
begin;
set local lock_timeout = '10s';

-- tables (118)
do $g$ begin
  if to_regclass('public.activity') is null then raise notice 'migration-97: public.activity is not on this database; skipped'; return; end if;
  grant select on table public.activity to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.activity to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.activity to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.app_alert_dismissals') is null then raise notice 'migration-97: public.app_alert_dismissals is not on this database; skipped'; return; end if;
  grant select on table public.app_alert_dismissals to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.app_alert_dismissals to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.app_alert_dismissals to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.app_settings') is null then raise notice 'migration-97: public.app_settings is not on this database; skipped'; return; end if;
  grant select on table public.app_settings to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.app_settings to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.app_settings to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_answers') is null then raise notice 'migration-97: public.assistant_answers is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_answers to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_answers to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_caps') is null then raise notice 'migration-97: public.assistant_caps is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_caps to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_caps to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_cert_figures') is null then raise notice 'migration-97: public.assistant_cert_figures is not on this database; skipped'; return; end if;
  grant select on table public.assistant_cert_figures to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_cert_figures to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_cert_figures to authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_cert_formats') is null then raise notice 'migration-97: public.assistant_cert_formats is not on this database; skipped'; return; end if;
  grant select on table public.assistant_cert_formats to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_cert_formats to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_cert_formats to authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_cert_settings') is null then raise notice 'migration-97: public.assistant_cert_settings is not on this database; skipped'; return; end if;
  grant select on table public.assistant_cert_settings to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_cert_settings to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_cert_settings to authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_chats') is null then raise notice 'migration-97: public.assistant_chats is not on this database; skipped'; return; end if;
  grant select, insert, update, delete on table public.assistant_chats to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_chats to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_chats to authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_files') is null then raise notice 'migration-97: public.assistant_files is not on this database; skipped'; return; end if;
  grant select, insert, update, delete on table public.assistant_files to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_files to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_files to authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_log') is null then raise notice 'migration-97: public.assistant_log is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_log to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_log to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_mismatch_status') is null then raise notice 'migration-97: public.assistant_mismatch_status is not on this database; skipped'; return; end if;
  grant select on table public.assistant_mismatch_status to authenticated;
  grant select, insert, references, trigger on table public.assistant_mismatch_status to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_mismatch_status to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_mismatches') is null then raise notice 'migration-97: public.assistant_mismatches is not on this database; skipped'; return; end if;
  grant select on table public.assistant_mismatches to authenticated;
  grant select, insert, references, trigger on table public.assistant_mismatches to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_mismatches to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_notice_events') is null then raise notice 'migration-97: public.assistant_notice_events is not on this database; skipped'; return; end if;
  grant select, insert, update, delete on table public.assistant_notice_events to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_notice_events to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_notice_events to authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_notices') is null then raise notice 'migration-97: public.assistant_notices is not on this database; skipped'; return; end if;
  grant select, insert, update, delete on table public.assistant_notices to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_notices to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_notices to authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_settings') is null then raise notice 'migration-97: public.assistant_settings is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_settings to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_settings to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_uploads') is null then raise notice 'migration-97: public.assistant_uploads is not on this database; skipped'; return; end if;
  grant select, insert, update, delete on table public.assistant_uploads to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_uploads to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_uploads to authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_usage') is null then raise notice 'migration-97: public.assistant_usage is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_usage to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_usage to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_usage_feature') is null then raise notice 'migration-97: public.assistant_usage_feature is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.assistant_usage_feature to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.assistant_usage_feature to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.auth_lockout') is null then raise notice 'migration-97: public.auth_lockout is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.auth_lockout to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.auth_lockout to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.backups') is null then raise notice 'migration-97: public.backups is not on this database; skipped'; return; end if;
  grant select on table public.backups to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.backups to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.backups to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.client_book_items') is null then raise notice 'migration-97: public.client_book_items is not on this database; skipped'; return; end if;
  grant select on table public.client_book_items to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.client_book_items to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.client_book_items to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.client_book_items_history') is null then raise notice 'migration-97: public.client_book_items_history is not on this database; skipped'; return; end if;
  grant select on table public.client_book_items_history to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.client_book_items_history to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.client_book_items_history to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.client_books') is null then raise notice 'migration-97: public.client_books is not on this database; skipped'; return; end if;
  grant select on table public.client_books to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.client_books to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.client_books to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.client_books_history') is null then raise notice 'migration-97: public.client_books_history is not on this database; skipped'; return; end if;
  grant select on table public.client_books_history to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.client_books_history to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.client_books_history to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.client_due_tasks') is null then raise notice 'migration-97: public.client_due_tasks is not on this database; skipped'; return; end if;
  grant select, insert, update, delete on table public.client_due_tasks to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.client_due_tasks to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.client_due_tasks to authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.clients') is null then raise notice 'migration-97: public.clients is not on this database; skipped'; return; end if;
  grant select on table public.clients to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.clients to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.clients to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.drop_keys') is null then raise notice 'migration-97: public.drop_keys is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.drop_keys to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.drop_keys to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.fincom_migration_text') is null then raise notice 'migration-97: public.fincom_migration_text is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.fincom_migration_text to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.fincom_migration_text to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.firm_modules') is null then raise notice 'migration-97: public.firm_modules is not on this database; skipped'; return; end if;
  grant select on table public.firm_modules to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.firm_modules to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.firm_modules to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.firms') is null then raise notice 'migration-97: public.firms is not on this database; skipped'; return; end if;
  grant select on table public.firms to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.firms to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.firms to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_2b_decisions') is null then raise notice 'migration-97: public.gst_2b_decisions is not on this database; skipped'; return; end if;
  grant select on table public.gst_2b_decisions to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_2b_decisions to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_2b_decisions to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_2b_inputs') is null then raise notice 'migration-97: public.gst_2b_inputs is not on this database; skipped'; return; end if;
  grant select on table public.gst_2b_inputs to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_2b_inputs to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_2b_inputs to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_2b_runs') is null then raise notice 'migration-97: public.gst_2b_runs is not on this database; skipped'; return; end if;
  grant select on table public.gst_2b_runs to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_2b_runs to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_2b_runs to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_einv_accounts') is null then raise notice 'migration-97: public.gst_einv_accounts is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_einv_accounts to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_einv_accounts to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_einvoices') is null then raise notice 'migration-97: public.gst_einvoices is not on this database; skipped'; return; end if;
  grant select on table public.gst_einvoices to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_einvoices to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_einvoices to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_filing_log') is null then raise notice 'migration-97: public.gst_filing_log is not on this database; skipped'; return; end if;
  grant select on table public.gst_filing_log to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_filing_log to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_filing_log to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_filings') is null then raise notice 'migration-97: public.gst_filings is not on this database; skipped'; return; end if;
  grant select on table public.gst_filings to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_filings to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_filings to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_helper_runs') is null then raise notice 'migration-97: public.gst_helper_runs is not on this database; skipped'; return; end if;
  grant select on table public.gst_helper_runs to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_helper_runs to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_helper_runs to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_portal_login_events') is null then raise notice 'migration-97: public.gst_portal_login_events is not on this database; skipped'; return; end if;
  grant select on table public.gst_portal_login_events to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_portal_login_events to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_portal_login_events to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_portal_logins') is null then raise notice 'migration-97: public.gst_portal_logins is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_portal_logins to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_portal_logins to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_returns') is null then raise notice 'migration-97: public.gst_returns is not on this database; skipped'; return; end if;
  grant select on table public.gst_returns to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_returns to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_returns to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.gst_sessions') is null then raise notice 'migration-97: public.gst_sessions is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.gst_sessions to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.gst_sessions to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.members') is null then raise notice 'migration-97: public.members is not on this database; skipped'; return; end if;
  grant select on table public.members to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.members to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.members to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.modules') is null then raise notice 'migration-97: public.modules is not on this database; skipped'; return; end if;
  grant select on table public.modules to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.modules to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.modules to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.plans') is null then raise notice 'migration-97: public.plans is not on this database; skipped'; return; end if;
  grant select on table public.plans to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.plans to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.plans to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.platform_admins') is null then raise notice 'migration-97: public.platform_admins is not on this database; skipped'; return; end if;
  grant select on table public.platform_admins to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.platform_admins to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.platform_admins to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.platform_secrets') is null then raise notice 'migration-97: public.platform_secrets is not on this database; skipped'; return; end if;
  grant select on table public.platform_secrets to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.platform_secrets to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.platform_secrets to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.records') is null then raise notice 'migration-97: public.records is not on this database; skipped'; return; end if;
  grant select on table public.records to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.records to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.records to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.support_messages') is null then raise notice 'migration-97: public.support_messages is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.support_messages to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.support_messages to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.support_tickets') is null then raise notice 'migration-97: public.support_tickets is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.support_tickets to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.support_tickets to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.sync_refused') is null then raise notice 'migration-97: public.sync_refused is not on this database; skipped'; return; end if;
  grant select on table public.sync_refused to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.sync_refused to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.sync_refused to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_alerts') is null then raise notice 'migration-97: public.tally_alerts is not on this database; skipped'; return; end if;
  grant select on table public.tally_alerts to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_alerts to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_alerts to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bank_allocs') is null then raise notice 'migration-97: public.tally_bank_allocs is not on this database; skipped'; return; end if;
  grant select on table public.tally_bank_allocs to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_bank_allocs to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_bank_allocs to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bills') is null then raise notice 'migration-97: public.tally_bills is not on this database; skipped'; return; end if;
  grant select on table public.tally_bills to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_bills to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_bills to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_book_changes') is null then raise notice 'migration-97: public.tally_book_changes is not on this database; skipped'; return; end if;
  grant select on table public.tally_book_changes to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_book_changes to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_book_changes to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_books') is null then raise notice 'migration-97: public.tally_books is not on this database; skipped'; return; end if;
  grant select on table public.tally_books to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_books to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_books to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bridge_alerts') is null then raise notice 'migration-97: public.tally_bridge_alerts is not on this database; skipped'; return; end if;
  grant select on table public.tally_bridge_alerts to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_bridge_alerts to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_bridge_alerts to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bridge_ids') is null then raise notice 'migration-97: public.tally_bridge_ids is not on this database; skipped'; return; end if;
  grant select on table public.tally_bridge_ids to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_bridge_ids to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_bridge_ids to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bridge_prefs') is null then raise notice 'migration-97: public.tally_bridge_prefs is not on this database; skipped'; return; end if;
  grant select on table public.tally_bridge_prefs to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_bridge_prefs to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_bridge_prefs to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bridge_release_log') is null then raise notice 'migration-97: public.tally_bridge_release_log is not on this database; skipped'; return; end if;
  grant select on table public.tally_bridge_release_log to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_bridge_release_log to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_bridge_release_log to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bridge_releases') is null then raise notice 'migration-97: public.tally_bridge_releases is not on this database; skipped'; return; end if;
  grant select on table public.tally_bridge_releases to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_bridge_releases to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_bridge_releases to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bridge_rollbacks') is null then raise notice 'migration-97: public.tally_bridge_rollbacks is not on this database; skipped'; return; end if;
  grant select on table public.tally_bridge_rollbacks to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_bridge_rollbacks to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_bridge_rollbacks to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_companies') is null then raise notice 'migration-97: public.tally_companies is not on this database; skipped'; return; end if;
  grant select on table public.tally_companies to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_companies to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_companies to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_company_lease') is null then raise notice 'migration-97: public.tally_company_lease is not on this database; skipped'; return; end if;
  grant select on table public.tally_company_lease to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_company_lease to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_company_lease to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_cost_allocs') is null then raise notice 'migration-97: public.tally_cost_allocs is not on this database; skipped'; return; end if;
  grant select on table public.tally_cost_allocs to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_cost_allocs to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_cost_allocs to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_days') is null then raise notice 'migration-97: public.tally_days is not on this database; skipped'; return; end if;
  grant select on table public.tally_days to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_days to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_days to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_devices') is null then raise notice 'migration-97: public.tally_devices is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_devices to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_devices to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_employees') is null then raise notice 'migration-97: public.tally_employees is not on this database; skipped'; return; end if;
  grant select on table public.tally_employees to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_employees to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_employees to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_groups') is null then raise notice 'migration-97: public.tally_groups is not on this database; skipped'; return; end if;
  grant select on table public.tally_groups to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_groups to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_groups to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_item_lines') is null then raise notice 'migration-97: public.tally_item_lines is not on this database; skipped'; return; end if;
  grant select on table public.tally_item_lines to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_item_lines to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_item_lines to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_jobs') is null then raise notice 'migration-97: public.tally_jobs is not on this database; skipped'; return; end if;
  grant select on table public.tally_jobs to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_jobs to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_jobs to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_ledger_aliases') is null then raise notice 'migration-97: public.tally_ledger_aliases is not on this database; skipped'; return; end if;
  grant select on table public.tally_ledger_aliases to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_ledger_aliases to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_ledger_aliases to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_ledger_day') is null then raise notice 'migration-97: public.tally_ledger_day is not on this database; skipped'; return; end if;
  grant select on table public.tally_ledger_day to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_ledger_day to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_ledger_day to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_ledger_fetch') is null then raise notice 'migration-97: public.tally_ledger_fetch is not on this database; skipped'; return; end if;
  grant select on table public.tally_ledger_fetch to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_ledger_fetch to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_ledger_fetch to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_ledger_lists') is null then raise notice 'migration-97: public.tally_ledger_lists is not on this database; skipped'; return; end if;
  grant select on table public.tally_ledger_lists to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_ledger_lists to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_ledger_lists to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_ledger_marks') is null then raise notice 'migration-97: public.tally_ledger_marks is not on this database; skipped'; return; end if;
  grant select on table public.tally_ledger_marks to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_ledger_marks to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_ledger_marks to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_ledger_rename_holds') is null then raise notice 'migration-97: public.tally_ledger_rename_holds is not on this database; skipped'; return; end if;
  grant select on table public.tally_ledger_rename_holds to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_ledger_rename_holds to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_ledger_rename_holds to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_ledger_rounds') is null then raise notice 'migration-97: public.tally_ledger_rounds is not on this database; skipped'; return; end if;
  grant select on table public.tally_ledger_rounds to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_ledger_rounds to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_ledger_rounds to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_ledgers') is null then raise notice 'migration-97: public.tally_ledgers is not on this database; skipped'; return; end if;
  grant select on table public.tally_ledgers to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_ledgers to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_ledgers to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_lines') is null then raise notice 'migration-97: public.tally_lines is not on this database; skipped'; return; end if;
  grant select on table public.tally_lines to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_lines to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_lines to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_member_bridges') is null then raise notice 'migration-97: public.tally_member_bridges is not on this database; skipped'; return; end if;
  grant select on table public.tally_member_bridges to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_member_bridges to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_member_bridges to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_month_locks') is null then raise notice 'migration-97: public.tally_month_locks is not on this database; skipped'; return; end if;
  grant select on table public.tally_month_locks to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_month_locks to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_month_locks to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_nothing_removed') is null then raise notice 'migration-97: public.tally_nothing_removed is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_nothing_removed to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_nothing_removed to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_post_checks') is null then raise notice 'migration-97: public.tally_post_checks is not on this database; skipped'; return; end if;
  grant select on table public.tally_post_checks to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_post_checks to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_post_checks to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_post_ids') is null then raise notice 'migration-97: public.tally_post_ids is not on this database; skipped'; return; end if;
  grant select on table public.tally_post_ids to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_post_ids to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_post_ids to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_post_jobs') is null then raise notice 'migration-97: public.tally_post_jobs is not on this database; skipped'; return; end if;
  grant select on table public.tally_post_jobs to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_post_jobs to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_post_jobs to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_post_marks') is null then raise notice 'migration-97: public.tally_post_marks is not on this database; skipped'; return; end if;
  grant select on table public.tally_post_marks to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_post_marks to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_post_marks to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_post_row_flags') is null then raise notice 'migration-97: public.tally_post_row_flags is not on this database; skipped'; return; end if;
  grant select on table public.tally_post_row_flags to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_post_row_flags to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_post_row_flags to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_post_windows') is null then raise notice 'migration-97: public.tally_post_windows is not on this database; skipped'; return; end if;
  grant select on table public.tally_post_windows to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_post_windows to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_post_windows to authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_read_stops') is null then raise notice 'migration-97: public.tally_read_stops is not on this database; skipped'; return; end if;
  grant select on table public.tally_read_stops to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_read_stops to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_read_stops to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_recorder_failures') is null then raise notice 'migration-97: public.tally_recorder_failures is not on this database; skipped'; return; end if;
  grant select on table public.tally_recorder_failures to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_recorder_failures to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_recorder_failures to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_recorder_lines') is null then raise notice 'migration-97: public.tally_recorder_lines is not on this database; skipped'; return; end if;
  grant select on table public.tally_recorder_lines to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_recorder_lines to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_recorder_lines to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_recorder_masters') is null then raise notice 'migration-97: public.tally_recorder_masters is not on this database; skipped'; return; end if;
  grant select on table public.tally_recorder_masters to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_recorder_masters to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_recorder_masters to authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_recorder_pending') is null then raise notice 'migration-97: public.tally_recorder_pending is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_recorder_pending to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_recorder_pending to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_recorder_restore_log') is null then raise notice 'migration-97: public.tally_recorder_restore_log is not on this database; skipped'; return; end if;
  grant select on table public.tally_recorder_restore_log to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_recorder_restore_log to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_recorder_restore_log to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_salary_pays') is null then raise notice 'migration-97: public.tally_salary_pays is not on this database; skipped'; return; end if;
  grant select on table public.tally_salary_pays to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_salary_pays to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_salary_pays to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_selfchecks') is null then raise notice 'migration-97: public.tally_selfchecks is not on this database; skipped'; return; end if;
  grant select on table public.tally_selfchecks to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_selfchecks to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_selfchecks to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_sync_cursor') is null then raise notice 'migration-97: public.tally_sync_cursor is not on this database; skipped'; return; end if;
  grant select on table public.tally_sync_cursor to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_sync_cursor to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_sync_cursor to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_sync_reads') is null then raise notice 'migration-97: public.tally_sync_reads is not on this database; skipped'; return; end if;
  grant select on table public.tally_sync_reads to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_sync_reads to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_sync_reads to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_tds_lines') is null then raise notice 'migration-97: public.tally_tds_lines is not on this database; skipped'; return; end if;
  grant select on table public.tally_tds_lines to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_tds_lines to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_tds_lines to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_tds_natures') is null then raise notice 'migration-97: public.tally_tds_natures is not on this database; skipped'; return; end if;
  grant select on table public.tally_tds_natures to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_tds_natures to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_tds_natures to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_tieouts') is null then raise notice 'migration-97: public.tally_tieouts is not on this database; skipped'; return; end if;
  grant select on table public.tally_tieouts to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_tieouts to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_tieouts to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_voucher_versions') is null then raise notice 'migration-97: public.tally_voucher_versions is not on this database; skipped'; return; end if;
  grant select on table public.tally_voucher_versions to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_voucher_versions to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_voucher_versions to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tally_vouchers') is null then raise notice 'migration-97: public.tally_vouchers is not on this database; skipped'; return; end if;
  grant select on table public.tally_vouchers to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_vouchers to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_vouchers to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.tds_challan_allocations') is null then raise notice 'migration-97: public.tds_challan_allocations is not on this database; skipped'; return; end if;
  grant select, insert on table public.tds_challan_allocations to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tds_challan_allocations to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tds_challan_allocations to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.usage_period') is null then raise notice 'migration-97: public.usage_period is not on this database; skipped'; return; end if;
  grant select on table public.usage_period to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.usage_period to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.usage_period to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.wallet_entries') is null then raise notice 'migration-97: public.wallet_entries is not on this database; skipped'; return; end if;
  grant select on table public.wallet_entries to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.wallet_entries to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.wallet_entries to anon, authenticated, service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.zoho_api_usage') is null then raise notice 'migration-97: public.zoho_api_usage is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.zoho_api_usage to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.zoho_api_usage to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.zoho_connections') is null then raise notice 'migration-97: public.zoho_connections is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.zoho_connections to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.zoho_connections to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.zoho_grants') is null then raise notice 'migration-97: public.zoho_grants is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.zoho_grants to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.zoho_grants to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.zoho_log') is null then raise notice 'migration-97: public.zoho_log is not on this database; skipped'; return; end if;
  grant select on table public.zoho_log to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.zoho_log to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.zoho_log to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.zoho_oauth_states') is null then raise notice 'migration-97: public.zoho_oauth_states is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.zoho_oauth_states to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.zoho_oauth_states to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.zoho_objects') is null then raise notice 'migration-97: public.zoho_objects is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.zoho_objects to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.zoho_objects to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.zoho_post_jobs') is null then raise notice 'migration-97: public.zoho_post_jobs is not on this database; skipped'; return; end if;
  grant select on table public.zoho_post_jobs to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.zoho_post_jobs to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.zoho_post_jobs to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.zoho_posts') is null then raise notice 'migration-97: public.zoho_posts is not on this database; skipped'; return; end if;
  grant select on table public.zoho_posts to authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.zoho_posts to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.zoho_posts to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.zoho_seen') is null then raise notice 'migration-97: public.zoho_seen is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.zoho_seen to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.zoho_seen to service_role'; end if;
end $g$;
do $g$ begin
  if to_regclass('public.zoho_sync_state') is null then raise notice 'migration-97: public.zoho_sync_state is not on this database; skipped'; return; end if;
  grant select, insert, update, delete, truncate, references, trigger on table public.zoho_sync_state to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.zoho_sync_state to service_role'; end if;
end $g$;

-- views (1)
do $g$ begin
  if to_regclass('public.tally_balances') is null then raise notice 'migration-97: public.tally_balances is not on this database; skipped'; return; end if;
  grant select on table public.tally_balances to anon, authenticated;
  grant select, insert, update, delete, truncate, references, trigger on table public.tally_balances to service_role;
  if current_setting('server_version_num')::int >= 170000 then execute 'grant maintain on table public.tally_balances to anon, authenticated, service_role'; end if;
end $g$;

-- sequences (47)
do $g$ begin
  if to_regclass('public.activity_id_seq') is null then raise notice 'migration-97: public.activity_id_seq is not on this database; skipped'; return; end if;
  grant usage, select on sequence public.activity_id_seq to authenticated;
  grant usage, select, update on sequence public.activity_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.app_alert_dismissals_id_seq') is null then raise notice 'migration-97: public.app_alert_dismissals_id_seq is not on this database; skipped'; return; end if;
  grant usage on sequence public.app_alert_dismissals_id_seq to authenticated;
  grant usage, select, update on sequence public.app_alert_dismissals_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_cert_figures_id_seq') is null then raise notice 'migration-97: public.assistant_cert_figures_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.assistant_cert_figures_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_log_id_seq') is null then raise notice 'migration-97: public.assistant_log_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.assistant_log_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_mismatch_status_id_seq') is null then raise notice 'migration-97: public.assistant_mismatch_status_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.assistant_mismatch_status_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.assistant_notice_events_id_seq') is null then raise notice 'migration-97: public.assistant_notice_events_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.assistant_notice_events_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.backups_id_seq') is null then raise notice 'migration-97: public.backups_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.backups_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.book_item_seq') is null then raise notice 'migration-97: public.book_item_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.book_item_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.client_book_items_history_id_seq') is null then raise notice 'migration-97: public.client_book_items_history_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.client_book_items_history_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.client_books_history_id_seq') is null then raise notice 'migration-97: public.client_books_history_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.client_books_history_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.gst_2b_runs_id_seq') is null then raise notice 'migration-97: public.gst_2b_runs_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.gst_2b_runs_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.gst_filing_log_id_seq') is null then raise notice 'migration-97: public.gst_filing_log_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.gst_filing_log_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.gst_helper_runs_id_seq') is null then raise notice 'migration-97: public.gst_helper_runs_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.gst_helper_runs_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.gst_portal_login_events_id_seq') is null then raise notice 'migration-97: public.gst_portal_login_events_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.gst_portal_login_events_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.gst_portal_logins_id_seq') is null then raise notice 'migration-97: public.gst_portal_logins_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.gst_portal_logins_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.support_messages_id_seq') is null then raise notice 'migration-97: public.support_messages_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.support_messages_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.support_tickets_num_seq') is null then raise notice 'migration-97: public.support_tickets_num_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.support_tickets_num_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.sync_refused_id_seq') is null then raise notice 'migration-97: public.sync_refused_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.sync_refused_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_alerts_id_seq') is null then raise notice 'migration-97: public.tally_alerts_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_alerts_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bank_allocs_id_seq') is null then raise notice 'migration-97: public.tally_bank_allocs_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_bank_allocs_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bills_id_seq') is null then raise notice 'migration-97: public.tally_bills_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_bills_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bridge_alerts_id_seq') is null then raise notice 'migration-97: public.tally_bridge_alerts_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_bridge_alerts_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bridge_ids_id_seq') is null then raise notice 'migration-97: public.tally_bridge_ids_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_bridge_ids_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bridge_release_log_id_seq') is null then raise notice 'migration-97: public.tally_bridge_release_log_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_bridge_release_log_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_bridge_rollbacks_id_seq') is null then raise notice 'migration-97: public.tally_bridge_rollbacks_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_bridge_rollbacks_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_cost_allocs_id_seq') is null then raise notice 'migration-97: public.tally_cost_allocs_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_cost_allocs_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_item_lines_id_seq') is null then raise notice 'migration-97: public.tally_item_lines_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_item_lines_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_ledger_marks_id_seq') is null then raise notice 'migration-97: public.tally_ledger_marks_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_ledger_marks_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_ledger_rename_holds_id_seq') is null then raise notice 'migration-97: public.tally_ledger_rename_holds_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_ledger_rename_holds_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_lines_id_seq') is null then raise notice 'migration-97: public.tally_lines_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_lines_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_month_locks_id_seq') is null then raise notice 'migration-97: public.tally_month_locks_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_month_locks_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_post_checks_id_seq') is null then raise notice 'migration-97: public.tally_post_checks_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_post_checks_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_post_marks_id_seq') is null then raise notice 'migration-97: public.tally_post_marks_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_post_marks_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_post_row_flags_id_seq') is null then raise notice 'migration-97: public.tally_post_row_flags_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_post_row_flags_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_post_windows_id_seq') is null then raise notice 'migration-97: public.tally_post_windows_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_post_windows_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_read_stops_id_seq') is null then raise notice 'migration-97: public.tally_read_stops_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_read_stops_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_recorder_failures_id_seq') is null then raise notice 'migration-97: public.tally_recorder_failures_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_recorder_failures_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_recorder_lines_id_seq') is null then raise notice 'migration-97: public.tally_recorder_lines_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_recorder_lines_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_recorder_masters_id_seq') is null then raise notice 'migration-97: public.tally_recorder_masters_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_recorder_masters_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_recorder_restore_log_id_seq') is null then raise notice 'migration-97: public.tally_recorder_restore_log_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_recorder_restore_log_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_salary_pays_id_seq') is null then raise notice 'migration-97: public.tally_salary_pays_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_salary_pays_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_selfchecks_id_seq') is null then raise notice 'migration-97: public.tally_selfchecks_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_selfchecks_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_tds_lines_id_seq') is null then raise notice 'migration-97: public.tally_tds_lines_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_tds_lines_id_seq to anon, authenticated, service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tally_tieouts_id_seq') is null then raise notice 'migration-97: public.tally_tieouts_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.tally_tieouts_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.tds_challan_allocations_id_seq') is null then raise notice 'migration-97: public.tds_challan_allocations_id_seq is not on this database; skipped'; return; end if;
  grant usage on sequence public.tds_challan_allocations_id_seq to authenticated;
  grant usage, select, update on sequence public.tds_challan_allocations_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.wallet_entries_id_seq') is null then raise notice 'migration-97: public.wallet_entries_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.wallet_entries_id_seq to service_role;
end $g$;
do $g$ begin
  if to_regclass('public.zoho_log_id_seq') is null then raise notice 'migration-97: public.zoho_log_id_seq is not on this database; skipped'; return; end if;
  grant usage, select, update on sequence public.zoho_log_id_seq to service_role;
end $g$;

commit;
