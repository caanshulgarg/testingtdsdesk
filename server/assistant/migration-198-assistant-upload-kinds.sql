-- Migration 198 (14-Nov-2026, branch next-fix-ask-thread-files). Ask FinCom used files attached earlier in the chat by their
-- names only; a CMA workbook and last year's balance sheet were recorded as "other". The Upload now names them
-- balance_sheet and cma (server/assistant/upload.ts, app/src/parts/asst-upload.js), and a later question reads such a
-- file again when the oldest upload record for its path says the asking member uploaded it (server/assistant/earlier.ts).
--
-- What it changes (no row, column or grant removed; every kind accepted before is still accepted):
--   1. assistant_uploads.kind (migration 84) also accepts 'balance_sheet' and 'cma'. The check is added NOT VALID and then
--      validated (the scan of the rows does not hold the table's strongest lock).
--   2. assistant_uploads_add (84's insert policy): a member adds a record as themself only (created_by = auth.uid(); the
--      column's default), so no member can record a file in another member's name.
--   3. a record keeps its owner: an update cannot change created_by, path, client_id or firm_id (a trigger; the step the
--      user picked, action, still changes as before).
-- Safe to run twice; one transaction (lock_timeout 10 s). Tested on pg_stand: tests/run_assistant_sql.py.

begin;
set local lock_timeout = '10s';

-- 1. the kinds
do $$
declare c text;
begin
  -- the kind's check, whatever it was named (84 left it to Postgres: assistant_uploads_kind_check)
  for c in select con.conname from pg_constraint con join pg_class t on t.oid = con.conrelid join pg_namespace n on n.oid = t.relnamespace
           where n.nspname = 'public' and t.relname = 'assistant_uploads' and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%kind%'
             and pg_get_constraintdef(con.oid) not like '%kind_by%' and pg_get_constraintdef(con.oid) not like '%balance_sheet%'
  loop
    execute format('alter table public.assistant_uploads drop constraint %I', c);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.assistant_uploads'::regclass and conname = 'assistant_uploads_kind_check') then
    alter table public.assistant_uploads add constraint assistant_uploads_kind_check
      check (kind in ('notice', 'bill', 'register', 'bank', 'as26', 'certificate', 'balance_sheet', 'cma', 'other')) not valid;
  end if;
end $$;
alter table public.assistant_uploads validate constraint assistant_uploads_kind_check;

-- 2. a record is added by its own uploader only
drop policy if exists assistant_uploads_add on public.assistant_uploads;
create policy assistant_uploads_add on public.assistant_uploads for insert to authenticated
  with check (firm_id = public.my_firm() and public.can_write() and created_by = auth.uid()
              and (path like public.my_firm()::text || '/%/uploads/%' or path like public.my_firm()::text || '/%/notices/%'));

-- 3. a record keeps its owner, path, client and firm
create or replace function public.assistant_uploads_keep_owner() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.created_by is distinct from old.created_by or new.path is distinct from old.path
     or new.client_id is distinct from old.client_id or new.firm_id is distinct from old.firm_id then
    raise exception 'an upload''s record keeps who uploaded it, its path and its client' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.assistant_uploads_keep_owner() from public, anon, authenticated;
drop trigger if exists assistant_uploads_keep_owner on public.assistant_uploads;
create trigger assistant_uploads_keep_owner before update on public.assistant_uploads
  for each row execute function public.assistant_uploads_keep_owner();

commit;
