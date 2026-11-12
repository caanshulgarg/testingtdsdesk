-- Migration 168 (12-Nov-2026, branch next-gst-share): the GST share check against today's engine (gst-share-parity,
-- migration 164) runs every 5 minutes from 20:00 to 23:55 UTC (01:30 to 05:25 India time) instead of once at 21:17 UTC.
-- One run has a 1.5 s budget and checks only a few months on staging. gst-run (same commit) now skips a month and
-- registration already checked in the last 20 hours, so the night's runs together cover every month of every book.
-- The job's command is unchanged; cron.schedule with the same name replaces its schedule. Nothing else changes.
begin;

do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'migration 168: pg_cron, pg_net or Vault is not here: nothing to change';
  elsif not exists (select 1 from cron.job where jobname = 'gst-share-parity') then
    raise notice 'migration 168: no gst-share-parity job (migration 164 made none here): nothing to change';
  else
    perform cron.schedule('gst-share-parity', '*/5 20-23 * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/gst-run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
        body := jsonb_build_object('action', 'share_parity', 'book_id', d.book_id))
      from public.gst_share_books_all(200) d
    $job$);
  end if;
end $cron$;

commit;
