-- FinCom Assistant: CA certificates (turnover, net worth; the owner's request of 14-Oct-2026), branch `certificates`.
-- Tool: server/assistant/tools/certificates.ts (certificate_prepare). What this adds:
--   1. assistant_cert_settings: the firm's details for certificates, asked once in the chat (firm name, FRN, signing
--      partner, membership no., place, the letterhead kept in the bucket, the default format 'icai' or 'firm');
--   2. assistant_cert_formats: a format uploaded for a job (a bank's, a tender's), kept by name for reuse;
--   3. assistant_cert_figures: the figures of a client's year the user confirmed for a certificate (as per the signed
--      statements, typed, or from the books when the user said so), with where each came from. Rows are added, never
--      changed: the latest row for a client and year is used next time;
--   4. the bucket assistant-files: the browser may add a file the user uploads in the chat under
--      <firm>/<client or _firm>/uploads/ (a signed balance sheet, a format, a letterhead). Read stays as 77 has it (the
--      firm's own folder only).
-- The function writes 1-3 with the service role for the signed-in user's firm; the firm's members read them (RLS), and
-- nobody else. No UDIN is ever stored (FinCom never fills it).
-- ADD-ONLY: new tables and policies only; nothing dropped, no row deleted, no function replaced; safe to run twice; one
-- transaction (lock_timeout 10 s). Independent of 78-82. After 77 (the bucket). Tested: tests/run_migration83.py (pg_stand, twice).
begin;
set local lock_timeout = '10s';

create table if not exists public.assistant_cert_settings (
  firm_id uuid primary key references public.firms (id) on delete cascade,
  firm_name text, frn text, signatory text, designation text, membership_no text, place text,
  letterhead_path text, letterhead_footer_path text,                   -- in the bucket assistant-files: <firm>/_firm/settings/...
  default_format text not null default 'icai' check (default_format in ('icai', 'firm')),
  confirmed boolean not null default false,                            -- the owner said "use this letterhead and signatory"
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create table if not exists public.assistant_cert_formats (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  name text not null,
  path text not null,                                                  -- <firm>/_firm/settings/...
  kind text not null check (kind in ('docx', 'pdf')),
  fields jsonb not null default '[]'::jsonb,                           -- the placeholders and blanks found: [{key, label}]
  made_by uuid,
  made_at timestamptz not null default now()
);
create index if not exists assistant_cert_formats_firm on public.assistant_cert_formats (firm_id, made_at desc);
create table if not exists public.assistant_cert_figures (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.firms (id) on delete cascade,
  client_id text not null,
  fy text not null check (fy ~ '^\d{4}$'),                            -- the year from 1 April: '2025' is 2025-26
  basis text not null check (basis in ('signed', 'typed', 'books')),
  figures jsonb not null,                                              -- {turnover: {value, how, src}, share_capital: ...}
  made_by uuid,
  made_at timestamptz not null default now()
);
create index if not exists assistant_cert_figures_client on public.assistant_cert_figures (firm_id, client_id, fy, made_at desc);

alter table public.assistant_cert_settings enable row level security;
alter table public.assistant_cert_formats enable row level security;
alter table public.assistant_cert_figures enable row level security;
revoke all on public.assistant_cert_settings, public.assistant_cert_formats, public.assistant_cert_figures from anon;
revoke insert, update, delete, truncate on public.assistant_cert_settings, public.assistant_cert_formats, public.assistant_cert_figures from authenticated;
grant select on public.assistant_cert_settings, public.assistant_cert_formats, public.assistant_cert_figures to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_cert_settings' and policyname = 'assistant_cert_settings_read') then
    create policy assistant_cert_settings_read on public.assistant_cert_settings for select to authenticated using (firm_id = public.my_firm());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_cert_formats' and policyname = 'assistant_cert_formats_read') then
    create policy assistant_cert_formats_read on public.assistant_cert_formats for select to authenticated using (firm_id = public.my_firm());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_cert_figures' and policyname = 'assistant_cert_figures_read') then
    create policy assistant_cert_figures_read on public.assistant_cert_figures for select to authenticated using (firm_id = public.my_firm());
  end if;
  -- the browser adds a file uploaded in the chat: <firm>/<client or _firm>/uploads/<name>, by the firm's owner or staff
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'assistant files: add upload to own firm') then
    create policy "assistant files: add upload to own firm" on storage.objects for insert to authenticated
      with check (bucket_id = 'assistant-files' and (storage.foldername(name))[1] = public.my_firm()::text and (storage.foldername(name))[3] = 'uploads' and public.can_write());
  end if;
end $$;

commit;
