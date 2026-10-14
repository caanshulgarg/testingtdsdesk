-- Migration 84 (14-Oct-2026, FinCom Assistant; branch assistant-upload). The owner's request of 14-Oct-2026: one
-- "Upload" in the Assistant instead of "Notice"; anything can be uploaded (PDF, picture, Excel/CSV, Word), several at
-- once. FinCom says what each file is (its own rules first, the AI only when they cannot tell), gives one line about it
-- and offers the next steps as buttons. It never posts or files anything by itself.
--
-- What it adds, add-only (no table, column, row or function removed; no stored value changed):
--   - the private bucket assistant-files (migration 77) accepts a firm's uploads under <firm>/<client>/uploads/...
--     (77 accepted only .../notices/...): a member who can write, of that firm only;
--   - assistant_uploads: one row a file (its name, size, the kind FinCom found, by rules or by the AI, the one-line
--     summary, the step the user picked), read by the firm, added and changed by members who can write.
-- 80 (tds-layout), 81 (depreciation), 82 (assistant default on) and 83 (certificates) are taken; this is 84. Safe to run twice; one
-- transaction (lock_timeout 10 s). Tested on pg_stand: tests/run_assistant_sql.py.

begin;
set local lock_timeout = '10s';

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'assistant files: add upload to own firm') then
    create policy "assistant files: add upload to own firm" on storage.objects for insert to authenticated
      with check (bucket_id = 'assistant-files' and (storage.foldername(name))[1] = public.my_firm()::text and (storage.foldername(name))[3] = 'uploads' and public.can_write());
  end if;
end $$;

create table if not exists public.assistant_uploads (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null default public.my_firm(),
  client_id text,
  path text not null,                               -- in the bucket assistant-files: <firm>/<client>/uploads/<stamp>-<name> (a notice: .../notices/...)
  name text not null,
  size bigint not null default 0,
  mime text,
  kind text not null default 'other' check (kind in ('notice', 'bill', 'register', 'bank', 'as26', 'certificate', 'other')),
  kind_by text not null default 'rules' check (kind_by in ('rules', 'ai', 'user')),
  summary text,
  action text,                                      -- the step the user picked (none is taken by itself)
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists assistant_uploads_client on public.assistant_uploads (firm_id, client_id, created_at desc);
alter table public.assistant_uploads enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_uploads' and policyname = 'assistant_uploads_read') then
    create policy assistant_uploads_read on public.assistant_uploads for select to authenticated using (firm_id = public.my_firm());
    create policy assistant_uploads_add on public.assistant_uploads for insert to authenticated with check (firm_id = public.my_firm() and public.can_write() and (path like public.my_firm()::text || '/%/uploads/%' or path like public.my_firm()::text || '/%/notices/%'));
    create policy assistant_uploads_change on public.assistant_uploads for update to authenticated using (firm_id = public.my_firm() and public.can_write()) with check (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.assistant_uploads from anon;
grant select, insert, update on public.assistant_uploads to authenticated;

commit;
