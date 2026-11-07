-- Migration 144 (07-Nov-2026, branch next-corporate; Corporate phase 1): the e-Forms tracked for a company client, on the
-- client's Corporate › e-Forms page (app/src/screens/corp/Forms.jsx; the due dates are worked out by the app from
-- screens/corp/rules.js, each rule with its section). FinCom files nothing on the MCA portal: a row says how far the
-- preparation has got and, once the person has filed on the portal, the SRN and the date they typed in.
-- Needs only firms, members, my_firm() and can_write() (migration.sql): independent of every other migration, 143 included.
-- ADD-ONLY: one new table, its index, its trigger function and trigger, its row security and its grants; nothing else
-- touched, nothing dropped, no row of any other table read or changed; safe to run twice; one transaction.
--
--   corp_filings    one row a form tracked: an annual form of a year (ref "annual:<form>:<FY>[:<DIN or half>]") or a form
--                   started for an event (ref "event:<form>:<uuid>", event_on the event's date)
--     status        not_started | in_progress | ready | filed | not_needed; steps 0-4 (In progress (n of 4))
--     due_on        the due date the app worked out when the row was kept; srn / filed_on once filed (both needed);
--                   reason when not needed (needed)
--     data          what the form's builder keeps (AOC-4: the source, the figures and their edits, the attachments)
-- Row security: a firm's members read their firm's rows; its owner and staff (can_write()) add, change and remove them,
-- for their own firm only. The service role keeps all rights. Tested by tests/run_migration_corp.py.

begin;
set local lock_timeout = '10s';

create table if not exists public.corp_filings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default public.my_firm() references public.firms(id) on delete cascade,
  client_id text not null,
  ref text not null,
  form text not null,
  kind text not null default 'annual',
  period text not null default '',
  director text not null default '',
  status text not null default 'not_started',
  steps smallint not null default 0,
  due_on date,
  event_on date,
  srn text not null default '',
  filed_on date,
  reason text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint corp_filings_ref unique (firm_id, client_id, ref),
  constraint corp_filings_lens check (char_length(client_id) between 1 and 200 and char_length(ref) between 3 and 200 and char_length(period) <= 40
    and char_length(director) <= 200 and char_length(reason) <= 500),
  constraint corp_filings_form check (form ~ '^[A-Z0-9][A-Z0-9 -]{1,19}$'),
  constraint corp_filings_kind check (kind in ('annual', 'event')),
  constraint corp_filings_status check (status in ('not_started', 'in_progress', 'ready', 'filed', 'not_needed')),
  constraint corp_filings_steps check (steps between 0 and 4),
  constraint corp_filings_srn check (srn = '' or srn ~ '^[A-Z][A-Z0-9]{6,11}$'),
  constraint corp_filings_filed check (status <> 'filed' or (srn <> '' and filed_on is not null)),
  constraint corp_filings_not_needed check (status <> 'not_needed' or reason <> ''),
  constraint corp_filings_data check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 600000)
);
-- the unique (firm_id, client_id, ref) is the page's read (one client's rows); nothing else is looked up

create or replace function public.corp_filings_touch() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    new.firm_id := old.firm_id; new.client_id := old.client_id; new.ref := old.ref; new.created_by := old.created_by; new.created_at := old.created_at;
  else
    new.created_at := now(); new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
revoke all on function public.corp_filings_touch() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'corp_filings_touch' and tgrelid = 'public.corp_filings'::regclass) then
    create trigger corp_filings_touch before insert or update on public.corp_filings for each row execute function public.corp_filings_touch();
  end if;
end $$;

alter table public.corp_filings enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corp_filings' and policyname = 'corp_filings_read') then
    create policy corp_filings_read on public.corp_filings for select to authenticated
      using (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corp_filings' and policyname = 'corp_filings_add') then
    create policy corp_filings_add on public.corp_filings for insert to authenticated
      with check (firm_id = (select public.my_firm()) and (select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corp_filings' and policyname = 'corp_filings_change') then
    create policy corp_filings_change on public.corp_filings for update to authenticated
      using (firm_id = (select public.my_firm()) and (select public.can_write()))
      with check (firm_id = (select public.my_firm()) and (select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corp_filings' and policyname = 'corp_filings_remove') then
    create policy corp_filings_remove on public.corp_filings for delete to authenticated
      using (firm_id = (select public.my_firm()) and (select public.can_write()));
  end if;
end $$;
revoke all on public.corp_filings from public, anon, authenticated;
grant select, insert, update, delete on public.corp_filings to authenticated;
grant all on public.corp_filings to service_role;
grant execute on function public.corp_filings_touch() to service_role;

commit;
