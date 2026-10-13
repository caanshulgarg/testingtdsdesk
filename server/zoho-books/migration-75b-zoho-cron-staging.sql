-- Migration 75b (13-Oct-2026, branch zoho-books): STAGING ONLY (tds-desk-staging, qbocskaiewaxqcvaunzc). Runs after 75.
-- Every five minutes pg_cron asks the zoho-books function to read the Zoho organisations that are due (each one's own
-- schedule, zoho_connections.next_sync_at, every 15 minutes by default, sooner after a Zoho webhook); nothing is sent when
-- none is due. The key it shows is zoho_cron_key (Vault, made by 75; never leaves the database). On live this needs live's
-- own URL in a file of its own. ADD-ONLY: one cron job made (or its schedule brought up to date, by name); nothing removed.
begin;
select cron.schedule('zoho-books-sync', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1/zoho-books',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-fincom-zoho-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'zoho_cron_key')),
    body := '{"kind":"sync"}'::jsonb,
    timeout_milliseconds := 150000)
  where exists (select 1 from public.zoho_connections c where c.status = 'connected' and coalesce(c.next_sync_at, now()) <= now())
$$);
commit;
