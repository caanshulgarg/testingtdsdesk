-- migration-94-gst-filing (17-Oct-2026, branch next-gst-file; docs/gst-filing-api.md). Filing GSTR-1, IFF and GSTR-3B
-- through the GST API (gst-taxpro actions save, summary, confirm, proceed, evc_otp, file, track). Add-only: two new
-- tables, read by the firm's members, written only by the function (service role). Safe to run twice.
--   gst_filings     where each return stands: the payload saved, FinCom's figures, the portal's summary, the differences,
--                   who confirmed them (and the differences accepted, with the reason), the set-off, the ARN
--   gst_filing_log  every call: who, when, GSTIN, period, form, action, result, ARN. Never the OTP (no column for it).
begin;
set local lock_timeout = '10s';

create table if not exists public.gst_filings (
  firm_id uuid not null references public.firms(id) on delete cascade,
  gstin text not null check (gstin ~ '^\d{2}[A-Z0-9]{13}$'),
  form text not null check (form in ('R1', 'IFF', '3B')),
  period text not null check (period ~ '^(0[1-9]|1[0-2])20\d{2}$'),
  status text not null default 'saved' check (status in ('saved', 'summary', 'confirmed', 'proceeded', 'filed', 'failed')),
  save_ref text,
  save_state text,
  save_errors jsonb,
  payload jsonb,
  fincom_sum jsonb,
  portal_sum jsonb,
  diffs jsonb,
  offset_plan jsonb,
  confirmed_by uuid,
  confirmed_at timestamptz,
  confirmed_sum jsonb,
  accepted jsonb,
  accept_note text,
  proceeded_by uuid,
  proceeded_at timestamptz,
  otp_sent_at timestamptz,
  signatory_pan text check (signatory_pan is null or signatory_pan ~ '^[A-Z]{5}\d{4}[A-Z]$'),
  arn text,
  filed_at timestamptz,
  filed_by uuid,
  error text,
  saved_by uuid,
  saved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (firm_id, gstin, form, period)
);
alter table public.gst_filings enable row level security;
revoke all on public.gst_filings from anon, authenticated;
grant select on public.gst_filings to authenticated;
do $$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gst_filings' and policyname = 'gst_filings_read') then
  create policy gst_filings_read on public.gst_filings for select to authenticated using ((firm_id = (select my_firm())) or (select is_superadmin())); end if; end $$;

create table if not exists public.gst_filing_log (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.firms(id) on delete cascade,
  gstin text not null,
  form text not null,
  period text not null,
  action text not null check (action in ('save', 'summary', 'confirm', 'proceed', 'evc_otp', 'file', 'track')),
  by_user uuid,
  at timestamptz not null default now(),
  ok boolean not null,
  result text,
  arn text,
  ref text
);
create index if not exists gst_filing_log_return on public.gst_filing_log (firm_id, gstin, form, period, at);
alter table public.gst_filing_log enable row level security;
revoke all on public.gst_filing_log from anon, authenticated;
grant select on public.gst_filing_log to authenticated;
do $$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gst_filing_log' and policyname = 'gst_filing_log_read') then
  create policy gst_filing_log_read on public.gst_filing_log for select to authenticated using ((firm_id = (select my_firm())) or (select is_superadmin())); end if; end $$;

commit;
