-- Migration 208, part 2: the reminder timer for Daily Check (22-Nov-2026, branch next-daily-p2). A DRAFT, NOT run anywhere.
-- Run AFTER migration-208-daily-phase2.sql and after assistant-night is deployed again (its "remind" action).
-- Once a day at 10:13 India time (04:43 UTC) assistant-night sends the reminders the owners turned on ("Remind by itself",
-- off by default): remind_due picks them (at most weekly a client and a question), the guard decides the address (test
-- mode: the firm's own address only). The timer's key is Vault's gst_cron_key, as for the night (migration 206 cron).
-- cron.schedule with the same name replaces the job, so this is safe to run twice. To stop it:
-- select cron.unschedule('assistant-night-remind');
begin;
set local lock_timeout = '10s';

do $cron$
declare cmd text := $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/assistant-night',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
    body := jsonb_build_object('action', 'remind'),
    timeout_milliseconds := 120000)
$job$;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'migration 208 cron: pg_cron, pg_net or Vault is not here: nothing scheduled';
  elsif to_regprocedure('public.remind_due(boolean)') is null then
    raise exception 'migration 208 cron: run migration-208-daily-phase2.sql first';
  else
    perform cron.schedule('assistant-night-remind', '43 4 * * *', cmd);
  end if;
end $cron$;

commit;
