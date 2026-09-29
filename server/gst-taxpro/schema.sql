-- Applied to staging (tds-desk-staging) on 29 Sep 2026; apply the same on live before gst-taxpro goes there.
-- Taxpayer portal sessions kept by the gst-taxpro function: one per firm and GSTIN, the auth token encrypted
-- (AES-GCM, key derived from the service key inside the function). No policies: only the service role reads it.
create table if not exists public.gst_sessions (
  firm_id uuid not null references public.firms(id) on delete cascade,
  gstin text not null,
  username text not null,
  token_enc text not null,
  expires_at timestamptz not null,
  connected_at timestamptz not null default now(),   -- when the OTP was last given
  refreshed_at timestamptz,
  last_error text,
  primary key (firm_id, gstin)
);
alter table public.gst_sessions enable row level security;
revoke all on public.gst_sessions from anon, authenticated;

-- the key the scheduled refresh shows the function; made here, never leaves the database
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'gst_cron_key', 'gst-taxpro scheduled refresh')
where not exists (select 1 from vault.secrets where name = 'gst_cron_key');

create or replace function public.gst_cron_ok(k text) returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'gst_cron_key' and decrypted_secret = k)
$$;
revoke all on function public.gst_cron_ok(text) from public, anon, authenticated;
grant execute on function public.gst_cron_ok(text) to service_role;

-- every 20 minutes: gst-taxpro renews the portal sessions that end within 40 minutes (on live: use live's project URL)
select cron.schedule('gst-taxpro-refresh', '*/20 * * * *', $$
  select net.http_post(
    url := 'https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1/gst-taxpro',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
    body := '{"action":"refresh-all"}'::jsonb)
  where exists (select 1 from public.gst_sessions where expires_at > now())
$$);
