-- migration-95b-gst-2b-match-cron-staging (17-Oct-2026, round 72b). STAGING ONLY (live needs its own URL): every 15 minutes,
-- only when a run is waiting, the database's timer wakes gst-2b-match ({action: "queue"}) with gst-taxpro's cron key. A
-- backstop: gst-taxpro already wakes it after each 2B it fetches. Run after migration-95 and after the gst-2b-match function
-- is deployed. Safe twice (the job is replaced by name).
select cron.schedule('gst-2b-match-queue', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1/gst-2b-match',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
    body := '{"action":"queue"}'::jsonb)
  where exists (select 1 from public.gst_2b_runs where status = 'queued')
$$);
