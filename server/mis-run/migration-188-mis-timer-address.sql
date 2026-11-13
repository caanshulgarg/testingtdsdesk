-- migration-188-mis-timer-address.sql (13-Nov-2026, branch next-sec-db; the database review of 13-Nov-2026, item M3).
-- Written, NOT run yet: the owner reads it and runs it. Needs migration 100 (the timer mis-run-due, mis_schedules).
-- Why: the timer of the scheduled MIS reports (mis-run-due, migration 100; its minutes moved by 157) took the address it
-- calls from a row of public.app_settings (name 'mis_run') and sent the platform's timer key with the call. A row of a
-- table is the wrong place for where a key is sent, and app_settings could be read by every signed-in person. The
-- other timers (gst-run-warm, gst-share-*; migrations 153, 164, 170) take this project's own address from Vault
-- (fincom_project_url).
-- What it does:
--   1. mis-run-due: the same job, the same minutes, the same key and body, only when a schedule is due, as before; the
--      address is Vault's fincom_project_url || '/functions/v1/mis-run'. The app_settings row is no longer read by it
--      (the row is left where it is; nothing uses it). Done only where pg_cron, pg_net and Vault with both secrets
--      (gst_cron_key, fincom_project_url) are there; otherwise the job is left as it is and this says so.
--   2. app_settings: one more policy (restrictive, so it narrows whatever read policy is there): a signed-in person
--      reads the row 'signup' only (what signup_info gives anyone already); the platform administrator (is_superadmin,
--      two-step) every row. The functions that read or write settings (signup_info, admin_set_setting, the edge
--      functions with the service key) are not touched: they do not go through policies. The app reads no setting
--      from the table itself.
-- Before running: Vault's fincom_project_url must be this project's own address without a slash at its end (as the
-- gst-run timers need it already); then the address the timer used so far and the new one are the same.
-- Add-only: one policy added; one job's command changed in place (no job removed or added, no schedule changed); no
-- table, column, row or function changed. One transaction, lock_timeout 10 s; safe twice.
-- Tested by tests/run_migration188.py (pg_stand, stand-ins for pg_cron, pg_net and Vault).
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the timer's address
do $cron$
declare j record; n int := 0;
  cmd constant text := $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/mis-run',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
        body := '{"action":"due"}'::jsonb,
        timeout_milliseconds := 30000)
      where exists (select 1 from public.mis_schedules where enabled and next_run <= now())
        and coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url'), '') ~ '^https://[^/]+$'
    $job$;
begin
  if to_regclass('cron.job') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'migration 188: pg_cron, pg_net or Vault is not here: no timer to change';
  elsif not exists (select 1 from vault.decrypted_secrets where name = 'gst_cron_key')
     or not exists (select 1 from vault.decrypted_secrets where name = 'fincom_project_url' and decrypted_secret ~ '^https://[^/]+$') then
    raise notice 'migration 188: Vault has no gst_cron_key, or no fincom_project_url of the form https://host: mis-run-due is left as it is. Set them and run this file again.';
  else
    for j in select c.jobid from cron.job c where c.jobname = 'mis-run-due' and c.command is distinct from cmd loop
      perform cron.alter_job(job_id := j.jobid, command := cmd);
      n := n + 1;
    end loop;
    raise notice 'migration 188: mis-run-due changed in % job(s)', n;
  end if;
end $cron$;

-- ---------------------------------------------------------------- 2. who reads a setting through the table
do $pol$
begin
  if to_regclass('public.app_settings') is null
     or not exists (select 1 from pg_attribute a where a.attrelid = 'public.app_settings'::regclass and a.attname = 'name' and not a.attisdropped) then
    raise notice 'migration 188: public.app_settings (with its name column) is not on this database; no policy made';
  else
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_settings' and policyname = 'app_settings_open_rows') then
      create policy app_settings_open_rows on public.app_settings as restrictive for select to public
        using (name = 'signup' or (select public.is_superadmin()));
    end if;
  end if;
end $pol$;

commit;
