-- GO-LIVE COPY of server/gst-taxpro/migration-16-tax-accuracy.sql (md5 00463f7e91b27e49fcf41c7c1e7bea9e), docs/GO-LIVE.md. Run this on live INSTEAD of the original; staging keeps the original.
-- The only differences: the pg_cron job reads this project's address from the Vault secret fincom_project_url at
-- every run (no project address is written here); the file refuses to run until that secret is set, and refuses
-- staging's address; and it runs in one transaction
-- (all or nothing). Run gst-taxpro/golive/schema-golive.sql before it (16 alters gst_sessions).
-- Set the secret once, before this file (the owner, in the SQL editor of the project it runs on):
--   select vault.create_secret('https://<project id>.supabase.co', 'fincom_project_url', 'FinCom: this project''s own address, for its pg_cron jobs');
-- Original below.
--
-- migration-16 (branch tax-accuracy): staging only (tds-desk-staging, qbocskaiewaxqcvaunzc). Additive: nothing dropped.
-- 1. Portal sessions kept in Vault (the token in vault.secrets; gst_sessions keeps its id), with the taxpayer's API
--    access period (chosen on the GST portal when API access is enabled) so FinCom can show it and remind 3 days before.
-- 2. gst_returns: GSTR-2B, filed GSTR-1 and filed GSTR-3B fetched through TaxPro, kept on the server per GSTIN and month.
-- 3. E-invoice (IRN) and e-way bill: the IRP / EWB login per GSTIN (password and tokens in Vault) and every IRN and
--    e-way bill made from FinCom.
-- 4. A daily run (07:00-11:00 IST, hourly until done): 2B from the 14th, filed GSTR-1 / 3B not yet kept, reminders.
-- TaxPro's keys go in Vault too, by you, in the dashboard (never in this file):
--   select vault.create_secret('<ASP id>', 'gsp:taxpro:aspid', 'TaxPro ASP id');
--   select vault.create_secret('<ASP password>', 'gsp:taxpro:password', 'TaxPro ASP password');
-- gst-taxpro reads them from there, and falls back to its environment (TAXPRO_ASP_ID / TAXPRO_ASP_PASSWORD) until they are.

begin;   -- go-live copy: all or nothing

-- ---------- go-live: this project's own address, from Vault (set by the owner first; see docs/GO-LIVE.md 1.1)
do $golive$
declare u text;
begin
  select decrypted_secret into u from vault.decrypted_secrets where name = 'fincom_project_url';
  if u is null or u !~ '^https://[a-z0-9]{20}\.supabase\.co$' then
    raise exception 'go-live copy: first set the Vault secret fincom_project_url to this project''s address, https://<project id>.supabase.co (no slash at the end)';
  end if;
  if position('qbocskaiewaxqcvaunzc' in u) > 0 then
    raise exception 'go-live copy: fincom_project_url names staging; staging keeps its original migration';
  end if;
end $golive$;

-- ---------- 1. sessions in Vault ----------
alter table public.gst_sessions add column if not exists token_secret uuid;         -- vault.secrets id: the auth token
alter table public.gst_sessions add column if not exists access_days int;           -- the period chosen on the portal (1-30)
alter table public.gst_sessions add column if not exists access_until timestamptz;  -- connected_at + that period
alter table public.gst_sessions add column if not exists reminded_at timestamptz;   -- the 3-days-before reminder
alter table public.gst_sessions add column if not exists ended_at timestamptz;      -- GSTN refused: a new OTP is needed
alter table public.gst_sessions alter column token_enc drop not null;               -- old rows keep it; new ones use Vault

-- a GST secret by name (only names starting gsp:), kept in Vault; for the gst-taxpro function (service role) only
create or replace function public.gsp_secret_put(p_name text, p_value text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if p_name !~ '^gsp:' then raise exception 'not a GST secret'; end if;
  select id into sid from vault.secrets where name = p_name;
  if sid is null then sid := vault.create_secret(p_value, p_name, 'FinCom GST (gst-taxpro)');
  else perform vault.update_secret(sid, p_value); end if;
  return sid;
end $$;
create or replace function public.gsp_secret_get(p_name text) returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name and p_name ~ '^gsp:'
$$;
revoke all on function public.gsp_secret_put(text, text) from public, anon, authenticated;
revoke all on function public.gsp_secret_get(text) from public, anon, authenticated;
grant execute on function public.gsp_secret_put(text, text) to service_role;
grant execute on function public.gsp_secret_get(text) to service_role;

-- ---------- 2. returns fetched through the API ----------
create table if not exists public.gst_returns (
  firm_id uuid not null references public.firms(id) on delete cascade,
  gstin text not null,
  form text not null check (form in ('2B', 'R1', '3B')),
  period text not null check (period ~ '^(0[1-9]|1[0-2])20\d\d$'),   -- MMYYYY
  status text not null default 'ok' check (status in ('ok', 'none', 'error')),   -- none: not generated / not filed yet
  data jsonb,
  error text,
  parts int,
  fetched_at timestamptz not null default now(),
  fetched_by uuid,                                     -- null: the daily run
  primary key (firm_id, gstin, form, period)
);
alter table public.gst_returns enable row level security;
do $$ begin if not exists (select 1 from pg_policies where tablename = 'gst_returns' and policyname = 'gst_returns_read') then
  create policy gst_returns_read on public.gst_returns for select to authenticated using ((firm_id = my_firm()) or is_superadmin()); end if; end $$;
revoke all on public.gst_returns from anon, authenticated;
grant select on public.gst_returns to authenticated;

-- ---------- 3. e-invoice and e-way bill ----------
create table if not exists public.gst_einv_accounts (
  firm_id uuid not null references public.firms(id) on delete cascade,
  gstin text not null,
  username text not null,                              -- the API user made on the IRP / EWB portal for the GSP
  token_until timestamptz,                             -- the e-invoice token (Vault: gsp:einv:<firm>:<gstin>:token)
  ewb_token_until timestamptz,                         -- the e-way bill token (Vault: gsp:ewb:<firm>:<gstin>:token)
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (firm_id, gstin)
);
alter table public.gst_einv_accounts enable row level security;
revoke all on public.gst_einv_accounts from anon, authenticated;

create table if not exists public.gst_einvoices (
  firm_id uuid not null references public.firms(id) on delete cascade,
  gstin text not null,
  doc_key text not null,                               -- FinCom's own id of the sales invoice
  client_id uuid,
  doc_type text, doc_no text, doc_date date,
  irn text, ack_no text, ack_dt timestamptz, signed_qr text, signed_invoice text,
  irn_status text check (irn_status in ('active', 'cancelled', 'failed')),
  cancelled_at timestamptz, cancel_reason text,
  ewb_no text, ewb_date timestamptz, ewb_valid_till timestamptz,
  ewb_status text check (ewb_status in ('active', 'cancelled', 'failed')),
  request jsonb, response jsonb, error text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (firm_id, gstin, doc_key)
);
alter table public.gst_einvoices enable row level security;
do $$ begin if not exists (select 1 from pg_policies where tablename = 'gst_einvoices' and policyname = 'gst_einvoices_read') then
  create policy gst_einvoices_read on public.gst_einvoices for select to authenticated using ((firm_id = my_firm()) or is_superadmin()); end if; end $$;
revoke all on public.gst_einvoices from anon, authenticated;
grant select on public.gst_einvoices to authenticated;

-- ---------- 4. the daily run: hourly 07:00-11:00 IST (01:30-05:30 UTC), each run picking up what the last left ----------
select cron.unschedule('gst-daily') where exists (select 1 from cron.job where jobname = 'gst-daily');
select cron.schedule('gst-daily', '30 1-5 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'fincom_project_url') || '/functions/v1/gst-taxpro',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
    body := '{"action":"daily"}'::jsonb,
    timeout_milliseconds := 150000)
$$);

commit;
