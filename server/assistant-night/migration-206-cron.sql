-- Migration 206, part 2: the night timer for Daily Check (22-Nov-2026, branch next-assistant). NOT run anywhere.
-- Run AFTER migration-206-assistant-night.sql and after the assistant-night function is deployed.
-- Every 10 minutes from 02:00 to 05:20 India time (20:30 to 23:50 UTC), the clients not checked tonight are each sent to
-- assistant-night, one light request each. night_due(null) takes as many a tick as the window needs (the clients left over
-- the ticks left, at most 60), each once a night; a stuck run is taken again after 30 minutes, at most 3 tries. At 05:35
-- (00:05 UTC) night_missed marks every client not reached and logs it, so no client is left out unseen. Each is sent to
-- assistant-night with the platform's cron key (Vault gst_cron_key, which the function checks with gst_cron_ok, as gst-run
-- and mis-run do). Only where pg_cron, pg_net and Vault are there. cron.schedule with the same name replaces the job, so
-- this is safe to run twice. Nothing else changes. To stop it: select cron.unschedule('assistant-night-a'); and '-b', '-missed'.
begin;

do $cron$
declare cmd text := $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/assistant-night',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
    body := jsonb_build_object('action', 'client', 'firm_id', d.firm_id, 'client_id', d.client_id),
    timeout_milliseconds := 120000)
  from public.night_due(null) d
$job$;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'migration 206 cron: pg_cron, pg_net or Vault is not here: nothing scheduled';
  elsif to_regprocedure('public.night_due(integer)') is null then
    raise exception 'migration 206 cron: run migration-206-assistant-night.sql first';
  else
    perform cron.schedule('assistant-night-a', '30-50/10 20 * * *', cmd);   -- 02:00, 02:10, 02:20 IST
    perform cron.schedule('assistant-night-b', '*/10 21-23 * * *', cmd);    -- 02:30 to 05:20 IST
    perform cron.schedule('assistant-night-missed', '5 0 * * *', 'select public.night_missed()');   -- 05:35 IST
  end if;
end $cron$;

commit;
