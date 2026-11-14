-- Migration 198 (14-Nov-2026, branch next-fix-ask-thread-files). Ask FinCom used files attached earlier in the chat by their
-- names only; a CMA workbook and last year's balance sheet were recorded as "other". The Upload now names them
-- balance_sheet and cma (server/assistant/upload.ts, app/src/parts/asst-upload.js), so a later question and the tools
-- find them by their kind (server/assistant/earlier.ts).
--
-- What it changes, add-only: assistant_uploads.kind (migration 84) also accepts 'balance_sheet' and 'cma'. No row, column,
-- policy or grant is changed; every kind accepted before is still accepted. Safe to run twice; one transaction
-- (lock_timeout 10 s). Tested on pg_stand: tests/run_assistant_sql.py.

begin;
set local lock_timeout = '10s';

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
      check (kind in ('notice', 'bill', 'register', 'bank', 'as26', 'certificate', 'balance_sheet', 'cma', 'other'));
  end if;
end $$;

commit;
