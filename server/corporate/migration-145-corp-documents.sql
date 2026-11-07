-- Migration 145 (07-Nov-2026, branch next-corporate; Corporate phase 1, the owner's approved designs "ROC documents"): the
-- board resolutions, notices and minutes made for a company client on Corporate › Resolutions & minutes
-- (app/src/screens/corp/Docs.jsx). A row keeps the template and the values typed (the text is made from the template, on
-- the page, as Word and PDF); nothing is generated on the server.
-- Needs only firms, members, my_firm() and can_write() (migration.sql): independent of every other migration.
-- ADD-ONLY: one new table, its index, its trigger function and trigger, its row security and its grants; nothing else
-- touched, nothing dropped, no row of any other table read or changed; safe to run twice; one transaction.
--
--   corp_documents  one row a document: id (made by the app, so the page names a document before it is saved), template (the
--                   template's key, e.g. bank-open, minutes), title, kind resolution | notice | minutes, status draft |
--                   final, fields (the values), meeting_on (the meeting's date), letterhead (on letterhead or plain paper)
-- Row security: a firm's members read their firm's rows; its owner and staff (can_write()) add and change them, and remove
-- a DRAFT (a final document stays); for their own firm only. The service role keeps all rights.
-- A FINAL document is locked (the trigger): the only change it takes is its status back to 'draft', every other column as
-- it was, and only by the firm's owner (members.role = 'owner'); the service role (no auth.uid()) is not held.
-- Tested by tests/run_migration_corp.py.

begin;
set local lock_timeout = '10s';

create table if not exists public.corp_documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default public.my_firm() references public.firms(id) on delete cascade,
  client_id text not null,
  template text not null,
  title text not null default '',
  kind text not null default 'resolution',
  status text not null default 'draft',
  fields jsonb not null default '{}'::jsonb,
  meeting_on date,
  letterhead boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  constraint corp_documents_lens check (char_length(client_id) between 1 and 200 and char_length(title) <= 300),
  constraint corp_documents_template check (template ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  constraint corp_documents_kind check (kind in ('resolution', 'notice', 'minutes')),
  constraint corp_documents_status check (status in ('draft', 'final')),
  constraint corp_documents_fields check (jsonb_typeof(fields) = 'object' and pg_column_size(fields) <= 300000)
);
create index if not exists corp_documents_client on public.corp_documents (firm_id, client_id, updated_at desc);

create or replace function public.corp_documents_touch() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'final' then
      if new.status is distinct from 'draft' or new.template is distinct from old.template or new.title is distinct from old.title
         or new.kind is distinct from old.kind or new.fields is distinct from old.fields or new.meeting_on is distinct from old.meeting_on
         or new.letterhead is distinct from old.letterhead or new.client_id is distinct from old.client_id or new.firm_id is distinct from old.firm_id then
        raise exception 'corp_documents: a final document is locked; only its status goes back to draft' using errcode = '42501';
      end if;
      if auth.uid() is not null and not exists (select 1 from public.members m where m.user_id = auth.uid() and m.firm_id = old.firm_id
                                                 and m.role = 'owner' and coalesce(m.active, true)) then
        raise exception 'corp_documents: only the firm''s owner takes a final document back to draft' using errcode = '42501';
      end if;
    end if;
    new.id := old.id; new.firm_id := old.firm_id; new.client_id := old.client_id; new.created_by := old.created_by; new.created_at := old.created_at;
  else
    new.created_at := now(); new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
revoke all on function public.corp_documents_touch() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'corp_documents_touch' and tgrelid = 'public.corp_documents'::regclass) then
    create trigger corp_documents_touch before insert or update on public.corp_documents for each row execute function public.corp_documents_touch();
  end if;
end $$;

alter table public.corp_documents enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corp_documents' and policyname = 'corp_documents_read') then
    create policy corp_documents_read on public.corp_documents for select to authenticated
      using (firm_id = (select public.my_firm()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corp_documents' and policyname = 'corp_documents_add') then
    create policy corp_documents_add on public.corp_documents for insert to authenticated
      with check (firm_id = (select public.my_firm()) and (select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corp_documents' and policyname = 'corp_documents_change') then
    create policy corp_documents_change on public.corp_documents for update to authenticated
      using (firm_id = (select public.my_firm()) and (select public.can_write()))
      with check (firm_id = (select public.my_firm()) and (select public.can_write()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corp_documents' and policyname = 'corp_documents_remove') then
    create policy corp_documents_remove on public.corp_documents for delete to authenticated
      using (firm_id = (select public.my_firm()) and (select public.can_write()) and status = 'draft');
  end if;
end $$;
revoke all on public.corp_documents from public, anon, authenticated;
grant select, insert, update, delete on public.corp_documents to authenticated;
grant all on public.corp_documents to service_role;
grant execute on function public.corp_documents_touch() to service_role;

commit;
