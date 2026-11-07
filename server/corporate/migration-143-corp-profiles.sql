-- Migration 143 (07-Nov-2026, branch next-corporate; Corporate phase 1, the owner's approved designs "Corporate and e-Forms"):
-- a company client's corporate profile, edited on the client's Corporate › Company profile page (app/src/screens/corp).
-- Needs only firms, members, my_firm() and can_write() (migration.sql), so it is independent of every other migration.
-- ADD-ONLY: one new table, its trigger function and trigger, its row security and its grants; nothing else touched, nothing
-- dropped, no row of any other table read or changed; safe to run twice; one transaction (lock_timeout 10 s).
--
--   corp_profiles   one row a client: the company's details (CIN, class, ROC, incorporation, registered office, capital,
--                   PAN/TAN/GSTIN, auditor and term, AGM dates, NIC activity, email ...) in `profile`; its directors and
--                   KMP, shareholders and charges as lists; the letterhead (logo, email). The page works the compliance
--                   health out from it; nothing here is computed.
--     firm_id      the firm (default my_firm()); client_id the client (the app's client id)
--     updated_by, updated_at   who changed it last and when: set by the database (corp_profiles_touch)
-- Row security: a firm's members read their firm's rows; its owner and staff (can_write()) add and change them, for their
-- own firm only; nobody deletes (no grant, no policy). The service role keeps all rights, as on every table.
-- Tested by tests/run_migration_corp.py (run three times, the row security, the checks, the rollback file).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

create table if not exists public.corp_profiles (
  firm_id uuid not null default public.my_firm() references public.firms(id) on delete cascade,
  client_id text not null,
  profile jsonb not null default '{}'::jsonb,
  directors jsonb not null default '[]'::jsonb,
  shareholders jsonb not null default '[]'::jsonb,
  charges jsonb not null default '[]'::jsonb,
  letterhead jsonb not null default '{}'::jsonb,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (firm_id, client_id),
  constraint corp_profiles_client check (char_length(client_id) between 1 and 200),
  constraint corp_profiles_shapes check (jsonb_typeof(profile) = 'object' and jsonb_typeof(directors) = 'array' and jsonb_typeof(shareholders) = 'array'
    and jsonb_typeof(charges) = 'array' and jsonb_typeof(letterhead) = 'object'),
  -- a logo of up to 150 KB is about 200 KB as text; the rest is a few KB
  constraint corp_profiles_sizes check (pg_column_size(profile) <= 200000 and pg_column_size(directors) <= 200000 and pg_column_size(shareholders) <= 200000
    and pg_column_size(charges) <= 200000 and pg_column_size(letterhead) <= 300000)
);

-- who and when, by the database; the firm and the client of a row never change
create or replace function public.corp_profiles_touch() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then new.firm_id := old.firm_id; new.client_id := old.client_id; end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
revoke all on function public.corp_profiles_touch() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'corp_profiles_touch' and tgrelid = 'public.corp_profiles'::regclass) then
    create trigger corp_profiles_touch before insert or update on public.corp_profiles for each row execute function public.corp_profiles_touch();
  end if;
end $$;

alter table public.corp_profiles enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corp_profiles' and policyname = 'corp_profiles_read') then
    create policy corp_profiles_read on public.corp_profiles for select to authenticated
      using (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corp_profiles' and policyname = 'corp_profiles_add') then
    create policy corp_profiles_add on public.corp_profiles for insert to authenticated
      with check (firm_id = (select public.my_firm()) and (select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corp_profiles' and policyname = 'corp_profiles_change') then
    create policy corp_profiles_change on public.corp_profiles for update to authenticated
      using (firm_id = (select public.my_firm()) and (select public.can_write()))
      with check (firm_id = (select public.my_firm()) and (select public.can_write()));
  end if;
end $$;
revoke all on public.corp_profiles from public, anon, authenticated;
grant select, insert, update on public.corp_profiles to authenticated;
grant all on public.corp_profiles to service_role;
grant execute on function public.corp_profiles_touch() to service_role;

commit;
